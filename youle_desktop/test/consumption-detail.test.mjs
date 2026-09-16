import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  businessModelDisplayName,
  normalizeBusinessModelPoolsState,
} from "../src/renderer/business-model-pools.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const apiClientSource = readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");
const mainProcessSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

const loadingHarness = rendererSource.then((renderer) => {
  const source = [
    sourceBlock(renderer, "let consumptionRequestSeq", "let consumptionPageScrollabilityFrame"),
    sourceBlock(renderer, "function consumptionPayload", "function formatConsumptionToken"),
    sourceBlock(renderer, "async function loadConsumptionData", "async function exportConsumptionReport"),
    "resetConsumptionData(); return { load: loadConsumptionData, reset: resetConsumptionData };",
  ].join("\n");
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
});

async function createLoadingHarness(overrides = {}) {
  const state = {
    auth: { authenticated: true, profile: { id: "account-a" }, baseUrl: "https://haolo.example" },
    settings: { language: "zh-CN" },
    activeView: "consumption",
    consumption: { unit: "points", pageSize: 6 },
  };
  const calls = [];
  const renders = [];
  const toasts = [];
  const api = {};
  for (const section of ["overview", "calendar", "records"]) {
    api[`getConsumption${section[0].toUpperCase()}${section.slice(1)}`] = (params) => {
      calls.push({ section, params });
      return overrides[section]?.(params) ?? Promise.resolve({ section });
    };
  }
  if (overrides.history) api.syncConsumptionHistory = (params) => {
    calls.push({ section: "history", params });
    return overrides.history(params);
  };
  const snapshot = () => JSON.stringify(state.auth);
  const dependencies = {
    state, api,
    render: () => renders.push(structuredClone(state.consumption)),
    reportConsumptionAppEntryOnce: () => overrides.entry?.() ?? Promise.resolve(),
    consumptionRuntimeStateQuery: () => ({ activeInteractionIds: [], activeConversationIds: [] }),
    authProfileRefreshSnapshot: snapshot,
    canApplyProfileRefreshResult: (value) => state.auth.authenticated && snapshot() === value,
    showToast: (message) => toasts.push(message),
    errorMessage: (error) => error.message,
    currentConsumptionMonth: () => "2026-08",
    window: { clearTimeout },
    console: { warn() {} },
  };
  const controls = Function(...Object.keys(dependencies), await loadingHarness)(...Object.values(dependencies));
  return { ...controls, state, calls, renders, toasts };
}

const flushConsumptionRequests = () => new Promise((resolve) => setImmediate(resolve));

test("records paint before slow app-entry and calendar requests, and history sync stays in the background", async () => {
  const entry = Promise.withResolvers();
  const calendar = Promise.withResolvers();
  const history = Promise.withResolvers();
  const harness = await createLoadingHarness({
    entry: () => entry.promise,
    calendar: () => calendar.promise,
    history: () => history.promise,
  });
  const pending = harness.load();
  await flushConsumptionRequests();
  assert.deepEqual(harness.calls.map(({ section }) => section), ["calendar", "records"]);
  assert.deepEqual(harness.state.consumption.records, { section: "records" });
  assert.equal(harness.state.consumption.overview, null);
  assert.equal(harness.state.consumption.calendar, null);
  assert.ok(harness.renders.some((frame) => frame.records && !frame.calendar && frame.loading));
  assert.ok(harness.calls.every(({ params }) => !params.includeHistory));

  entry.resolve();
  await flushConsumptionRequests();
  assert.deepEqual(harness.state.consumption.overview, { section: "overview" });
  calendar.resolve({ days: [{ date: "2026-08-27", points: 1 }] });
  await pending;
  assert.equal(harness.state.consumption.loading, false);
  assert.equal(harness.state.consumption.loaded, true);
  assert.equal(harness.state.consumption.historySyncing, true);

  harness.state.consumption.range = "today";
  history.resolve({ synced: true });
  await flushConsumptionRequests();
  assert.equal(harness.state.consumption.historySyncing, false);
  assert.equal(harness.calls.filter(({ section }) => section === "history").length, 1);
  assert.equal(harness.calls.filter(({ section }) => section === "records").at(-1).params.range, "today");
});

test("one failed consumption panel does not discard successful panels", async () => {
  const calendar = Promise.withResolvers();
  const harness = await createLoadingHarness({
    overview: async () => { throw new Error("overview unavailable"); },
    calendar: () => calendar.promise,
  });
  const pending = harness.load();
  await flushConsumptionRequests();
  assert.deepEqual(harness.state.consumption.records, { section: "records" });
  calendar.resolve({ days: [] });
  await pending;
  assert.deepEqual(harness.state.consumption.calendar, { days: [] });
  assert.equal(harness.state.consumption.loading, false);
  assert.equal(harness.toasts.length, 1);
});

test("matching consumption requests share work and late filter results cannot overwrite newer data", async () => {
  const firstRecords = Promise.withResolvers();
  const nextRecords = Promise.withResolvers();
  const harness = await createLoadingHarness({
    records: ({ range }) => range === "30d" ? firstRecords.promise : nextRecords.promise,
  });
  const first = harness.load({ quiet: true });
  const duplicate = harness.load();
  await flushConsumptionRequests();
  assert.equal(harness.calls.length, 3);
  harness.state.consumption.range = "today";
  const next = harness.load();
  nextRecords.resolve({ items: ["today"] });
  await next;
  firstRecords.resolve({ items: ["old-range"] });
  await Promise.all([first, duplicate]);
  assert.deepEqual(harness.state.consumption.records, { items: ["today"] });
  assert.equal(harness.state.consumption.loading, false);
  assert.equal(harness.toasts.length, 0);
});

test("calendar month labels change only when that month's response is applied", async () => {
  const calendar = Promise.withResolvers();
  const harness = await createLoadingHarness({ calendar: () => calendar.promise });
  const pending = harness.load({ month: "2026-07" });
  await flushConsumptionRequests();
  assert.equal(harness.state.consumption.month, "2026-08");
  calendar.resolve({ days: [{ date: "2026-07-31" }] });
  await pending;
  assert.equal(harness.state.consumption.month, "2026-07");
  assert.equal(harness.state.consumption.calendar.days[0].date, "2026-07-31");
});

test("background history failures retain visible consumption data without retry storms", async () => {
  const harness = await createLoadingHarness({ history: async () => { throw new Error("export unavailable"); } });
  await harness.load();
  await flushConsumptionRequests();
  await harness.load();
  assert.equal(harness.state.consumption.loaded, true);
  assert.equal(harness.state.consumption.historySyncing, false);
  assert.equal(harness.calls.filter(({ section }) => section === "history").length, 1);
  assert.equal(harness.toasts.length, 0);
});

test("history completion refreshes current filters instead of reusing a pre-backfill request", async () => {
  const history = Promise.withResolvers();
  const beforeBackfill = Promise.withResolvers();
  const beforeBackfillCalendar = Promise.withResolvers();
  let recordsRequest = 0;
  let calendarRequest = 0;
  const harness = await createLoadingHarness({
    history: () => history.promise,
    records: () => ++recordsRequest === 2 ? beforeBackfill.promise : Promise.resolve({ revision: recordsRequest }),
    calendar: ({ month }) => ++calendarRequest === 2 ? beforeBackfillCalendar.promise : Promise.resolve({ month }),
  });
  await harness.load();
  harness.state.consumption.range = "today";
  const olderPoll = harness.load({ quiet: true, month: "2026-07" });
  history.resolve({ synced: true });
  await flushConsumptionRequests();
  assert.equal(recordsRequest, 3);
  assert.deepEqual(harness.state.consumption.records, { revision: 3 });
  assert.equal(harness.state.consumption.month, "2026-07");
  assert.equal(harness.state.consumption.calendar.month, "2026-07");
  beforeBackfill.resolve({ revision: 2 });
  beforeBackfillCalendar.resolve({ month: "2026-07", outdated: true });
  await olderPoll;
  assert.deepEqual(harness.state.consumption.records, { revision: 3 });
  assert.equal(harness.state.consumption.historySyncing, false);
});

test("account reset discards cached bills and ignores late foreground and background responses", async () => {
  const records = Promise.withResolvers();
  const history = Promise.withResolvers();
  const foreground = await createLoadingHarness({ records: () => records.promise });
  const pending = foreground.load();
  foreground.reset();
  records.resolve({ items: ["previous-account"] });
  await pending;
  assert.equal(foreground.state.consumption.records, null);
  assert.equal(foreground.state.consumption.loaded, false);

  const background = await createLoadingHarness({ history: () => history.promise });
  await background.load();
  const callsBeforeReset = background.calls.length;
  background.reset();
  history.resolve({ synced: true });
  await flushConsumptionRequests();
  assert.equal(background.calls.length, callsBeforeReset);
  assert.equal(background.state.consumption.records, null);
  assert.equal(background.state.consumption.historySyncing, false);
});

test("consumption detail is a standalone API-backed view below profile settings", async () => {
  const [renderer, apiClient, mainProcess, preload] = await Promise.all([
    rendererSource,
    apiClientSource,
    mainProcessSource,
    preloadSource,
  ]);
  const settings = sourceBlock(renderer, "function renderSettingsDialog", "function renderSettingsUserDataRow");
  const page = sourceBlock(renderer, "function renderConsumptionPage", "function renderConsumptionCalendar");
  const loader = sourceBlock(renderer, "async function loadConsumptionData", "function openConsumptionPage");
  const opener = sourceBlock(renderer, "function openConsumptionPage", "function syncConsumptionRefreshTimer");

  assert.ok(settings.indexOf('data-settings-tab="profile"') < settings.indexOf('data-action="open-consumption"'));
  assert.ok(settings.indexOf('data-action="open-consumption"') < settings.indexOf('data-settings-tab="general"'));
  assert.match(opener, /state\.settingsOpen = false/);
  assert.match(opener, /state\.activeView = "consumption"/);
  assert.match(page, /renderPageHomeButton\(\)/);
  assert.doesNotMatch(page, /history\.back/);
  assert.doesNotMatch(page, /data-action="export-consumption"|consumption-export/);
  assert.match(renderer, /consumption:\s*\{\s*unit:\s*"points"/);
  assert.match(page, /data-consumption-unit="token"/);
  assert.match(page, /data-consumption-unit="points"/);
  assert.ok(
    page.indexOf('data-consumption-unit="points"') < page.indexOf('data-consumption-unit="token"'),
    "points consumption must be the first and default unit option",
  );
  assert.match(page, /title="当前永久积分余额"[\s\S]*?<span>永久积分<\/span>/);
  assert.match(page, /class="\$\{unit === "points" \? "active" : ""\}" data-consumption-unit="points">积分消耗<\/button>/);
  assert.match(page, />Token消耗<\/button>/);
  assert.match(page, /累计\$\{unit === "points" \? "积分" : "Token"\}数/);
  assert.match(page, /\$\{unit === "points" \? "每日积分消耗" : "每日 Token 消耗"\}/);
  assert.match(page, /data-consumption-range="\$\{range\}"/);
  assert.match(page, /showRecordsSkeleton \? renderConsumptionRecordsSkeleton\(\) : renderConsumptionRecords\(recordsData\)/);
  assert.match(page, /overview\.peak_daily_tokens, overview\.peak_daily_points \?\? overview\.peak_daily_usd\)[\s\S]*?<span>最高单日消耗<\/span>/);
  assert.doesNotMatch(page, /峰值\$\{unit/);
  assert.doesNotMatch((await stylesSource), /\.consumption-profile-person > div\s*\{[^}]*transform:/s);
  assert.match(loader, /Promise\.all/);
  assert.match(loader, /await reportConsumptionAppEntryOnce\(\)/);
  assert.match(loader, /loadSection\("overview", async \(\) => \{\s*await reportConsumptionAppEntryOnce\(\)/);
  assert.match(loader, /getConsumptionOverview/);
  assert.match(loader, /getConsumptionCalendar/);
  assert.match(loader, /getConsumptionCalendar!\(\{ month: requestedMonth, unit: requestedUnit \}\)/);
  assert.doesNotMatch(loader, /includeHistory:\s*true/);
  assert.match(loader, /void syncConsumptionHistoryInBackground\(\)/);
  assert.match(loader, /getConsumptionRecords/);
  assert.match(loader, /language:\s*state\.settings\.language/);
  assert.doesNotMatch(renderer, /mergeConsumptionOverview|consumptionHistoryMonthSummary|historyMonths/);
  assert.match(loader, /showToast\("当前客户端版本暂不支持消耗明细接口", 5000\)/);
  assert.match(loader, /showToast\(`消耗明细加载失败：\$\{errorMessage\(error\)\}`, 6000\)/);
  assert.doesNotMatch(page, /consumption-error|state\.consumption\.error/);
  assert.doesNotMatch(await stylesSource, /\.consumption-error\b/);
  assert.match(renderer, /consumptionAppEntryRetryTimer = window\.setTimeout/);
  assert.match(renderer, /reportConsumptionAppEntryOnce\(\);\s*\}, 30_000\)/);

  assert.match(apiClient, /DEFAULT_CONSUMPTION_PATH = "\/api\/consumption\/me"/);
  assert.match(apiClient, /language:\s*normalizeConsumptionLanguage\(params\.language\)/);
  assert.match(mainProcess, /language:\s*normalizeAppLanguage\(params\.language \|\| appLanguage\(\)\)/);
  for (const operation of ["reportConsumptionAppEntry", "reportConsumptionEvent", "getConsumptionOverview", "getConsumptionCalendar", "syncConsumptionHistory", "getConsumptionRecords", "exportConsumptionReport"]) {
    assert.match(mainProcess, new RegExp(`youle:${operation}`));
    assert.match(preload, new RegExp(operation));
  }
});

test("consumption detail reveals each panel independently with themed loading feedback", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const profileSkeleton = sourceBlock(renderer, "function renderConsumptionProfileSkeleton", "function renderConsumptionCalendarSkeleton");
  const calendarSkeleton = sourceBlock(renderer, "function renderConsumptionCalendarSkeleton", "function renderConsumptionRecordsSkeleton");
  const recordsSkeleton = sourceBlock(renderer, "function renderConsumptionRecordsSkeleton", "function renderConsumptionPage");
  const page = sourceBlock(renderer, "function renderConsumptionPage", "function renderConsumptionCalendar");
  const loader = sourceBlock(renderer, "async function loadConsumptionData", "async function exportConsumptionReport");
  const opener = sourceBlock(renderer, "function openConsumptionPage", "function syncConsumptionRefreshTimer");
  const loadingStyles = sourceBlock(styles, ".consumption-loading {", ".consumption-skeleton {");
  const skeletonStyles = sourceBlock(styles, ".consumption-skeleton {", ".consumption-profile-card,");

  assert.match(page, /const showSkeleton = state\.consumption\.loading && !state\.consumption\.loaded/);
  assert.match(page, /aria-busy="\$\{showSkeleton\}"/);
  assert.match(page, /<strong>\$\{escapeHtml\(currentProfileBalance\(\)\)\}<\/strong>/);
  for (const section of ["Overview", "Calendar", "Records"]) {
    assert.match(page, new RegExp(`const show${section}Skeleton = state\\.consumption\\.loading && !state\\.consumption\\.${section.toLowerCase()}`));
    assert.match(page, new RegExp(`aria-busy="\\$\\{show${section}Skeleton\\}"`));
  }
  assert.match(page, /showOverviewSkeleton \? renderConsumptionProfileSkeleton\(unit\)/);
  assert.match(page, /showCalendarSkeleton \? renderConsumptionCalendarSkeleton\(\)/);
  assert.match(page, /showRecordsSkeleton \? renderConsumptionRecordsSkeleton\(\)/);
  assert.match(page, /state\.consumption\.historySyncing\) && !showRecordsSkeleton \? `<div class="consumption-loading" role="status">正在同步实际账单…<\/div>`/);
  assert.ok(
    opener.indexOf("state.consumption.loading = true") < opener.indexOf("render()"),
    "the first consumption-page paint must already be in its skeleton state",
  );
  assert.doesNotMatch(opener, /state\.consumption\.loaded\s*=/);
  assert.match(loader, /state\.consumption\.loaded = true/);
  assert.match(profileSkeleton, /consumption-skeleton-avatar/);
  assert.match(profileSkeleton, /consumption-skeleton-profile-name/);
  assert.match(profileSkeleton, /consumption-skeleton-metric/);
  assert.match(calendarSkeleton, /length: dayCount/);
  assert.match(calendarSkeleton, /consumption-skeleton-calendar-day/);
  assert.match(recordsSkeleton, /length: state\.consumption\.pageSize/);
  assert.match(recordsSkeleton, /consumption-skeleton-record-(?:token|model|type|title|status|excerpt)/);
  assert.match(recordsSkeleton, /consumption-skeleton-pagination/);
  assert.match(skeletonStyles, /\.consumption-skeleton::after[\s\S]*animation:\s*consumption-skeleton-shimmer/);
  assert.match(skeletonStyles, /\.consumption-skeleton-avatar\s*\{[^}]*width:\s*80px;[^}]*height:\s*80px;[^}]*border-radius:\s*50%/s);
  assert.match(styles, /\.consumption-profile-person > img\s*\{[^}]*width:\s*80px;[^}]*height:\s*80px;[^}]*border-radius:\s*50%/s);
  assert.match(skeletonStyles, /\.consumption-skeleton-calendar-day\s*\{[^}]*min-height:\s*63px/);
  assert.match(styles, /@keyframes consumption-skeleton-shimmer/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.consumption-skeleton::after\s*\{\s*animation:\s*none/);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-skeleton\s*\{[^}]*background:\s*#283649/);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-loading\s*\{[^}]*color:\s*#a8c7ee/);
  assert.match(loadingStyles, /position:\s*absolute/);
  assert.match(loadingStyles, /left:\s*50%/);
  assert.match(loadingStyles, /transform:\s*translateX\(-50%\)/);
  assert.match(loadingStyles, /font-size:\s*calc\(14px \+ var\(--app-font-size-offset\)\)/);
});

test("opening settings quietly prefetches consumption data and the detail page reuses it", async () => {
  const renderer = await rendererSource;
  const settingsOpener = sourceBlock(renderer, "function openSettingsDialog", "function selectAppTheme");
  const prefetcher = sourceBlock(renderer, "function prefetchConsumptionData", "function openConsumptionPage");
  const pageOpener = sourceBlock(renderer, "function openConsumptionPage", "function syncConsumptionRefreshTimer");

  assert.match(renderer, /let consumptionPrefetchPromise: Promise<void> \| null = null/);
  assert.match(settingsOpener, /void prefetchConsumptionData\(\)/);
  assert.match(prefetcher, /if \(!state\.auth\.authenticated \|\| consumptionPrefetchPromise\) return consumptionPrefetchPromise/);
  assert.match(prefetcher, /loadConsumptionData\(\{ quiet: true, suppressError: true \}\)/);
  assert.match(prefetcher, /consumptionPrefetchPromise === request/);
  assert.match(pageOpener, /const pendingPrefetch = consumptionPrefetchPromise/);
  assert.match(pageOpener, /if \(state\.consumption\.loaded\) return/);
  assert.match(pageOpener, /if \(pendingPrefetch\)[\s\S]*?pendingPrefetch\.then/);
  assert.match(pageOpener, /!state\.consumption\.loaded && !state\.consumption\.loading[\s\S]*?loadConsumptionData\(\)/);
});

test("consumption detail only scrolls when its content exceeds the viewport", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const pageScroll = sourceBlock(
    styles,
    ".consumption-page-scroll {",
    ".consumption-page-scroll.is-scrollable {",
  );
  const scrollablePage = sourceBlock(
    styles,
    ".consumption-page-scroll.is-scrollable {",
    ".consumption-page-scroll::-webkit-scrollbar {",
  );
  const scrollabilitySync = sourceBlock(
    renderer,
    "function syncConsumptionPageScrollability",
    "function scheduleConsumptionPageScrollabilitySync",
  );

  assert.match(pageScroll, /overflow-x:\s*hidden/);
  assert.match(pageScroll, /overflow-y:\s*hidden/);
  assert.match(pageScroll, /overscroll-behavior-y:\s*none/);
  assert.match(scrollablePage, /overflow-y:\s*auto/);
  assert.match(scrollablePage, /overscroll-behavior-y:\s*contain/);
  assert.match(scrollabilitySync, /getComputedStyle\(scroller\)\.paddingBottom/);
  assert.match(scrollabilitySync, /scrollHeight - trailingPadding > scroller\.clientHeight \+ 1/);
  assert.match(scrollabilitySync, /classList\.toggle\("is-scrollable", scrollable\)/);
  assert.match(scrollabilitySync, /scroller\.scrollTop = 0/);
  assert.match(renderer, /window\.addEventListener\("resize", scheduleConsumptionPageScrollabilitySync/);
  assert.match(renderer, /scheduleConsumptionPageScrollabilitySync\(\);[\s\S]*?queueMarketplaceFillCheck\(\)/);
  assert.match(styles, /\.consumption-calendar-card,\s*\.consumption-records-card\s*\{[^}]*height:\s*575px/s);
});

test("consumption export retains its save implementation without exposing a UI action", async () => {
  const renderer = await rendererSource;
  const exporter = sourceBlock(renderer, "async function exportConsumptionReport", "function openConsumptionPage");
  assert.match(exporter, /api\.exportConsumptionReport\(\{ unit: state\.consumption\.unit \}\)/);
  assert.match(exporter, /state\.consumption\.exporting = true/);
  assert.match(exporter, /result\?\.canceled/);
  assert.match(exporter, /使用数据已保存/);
  assert.doesNotMatch(renderer, /data-action="export-consumption"/);
  assert.doesNotMatch(renderer, /void exportConsumptionReport\(\)/);
});

test("consumption model names cover server labels and historical IDs before the catalog loads", () => {
  const empty = normalizeBusinessModelPoolsState({});
  const configured = normalizeBusinessModelPoolsState({
    configured: true,
    pools: [{ id: "execution", models: [
      { id: "deepseek-flash", displayName: "DeepSeek V4.1 Flash" },
      { id: "legacy-flash-alias", displayName: "DeepSeek V4.1 Flash", enabled: false },
    ] }],
  });
  for (const catalog of [empty, configured]) {
    for (const name of ["deepseek-flash", "deepseek-v4-flash", "DeepSeek V4.1 Flash", " DEEPSEEK V4.1 FLASH "]) {
      assert.equal(businessModelDisplayName(catalog, name), "GPT-6 Astra");
    }
    assert.equal(businessModelDisplayName(catalog, "deepseek-v4-pro"), "deepseek-v4-pro");
  }
  assert.equal(businessModelDisplayName(configured, "legacy-flash-alias"), "GPT-6 Astra");
});

test("consumption export stays absent in light and dark themes for both units and loading states", async () => {
  const source = sourceBlock(await rendererSource, "function renderConsumptionPage", "function renderConsumptionCalendar");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const theme of ["light", "dark"]) {
    for (const unit of ["points", "token"]) {
      for (const loading of [false, true]) {
        const dependencies = {
          state: {
            auth: { profile: {} },
            settings: { theme, language: "zh-CN" },
            consumption: { unit, loading, loaded: !loading, month: "2026-09", range: "30d", exporting: loading },
          },
          api: { exportConsumptionReport: () => { throw new Error("Export must not be invoked"); } },
          consumptionPayload: (value) => value || {},
          firstString: (...values) => values.find((value) => typeof value === "string" && value) || "",
          currentMembershipPlan: () => ({ subscribed: false }),
          currentProfileAvatar: () => "avatar.png",
          currentProfileName: () => "Haolo",
          currentProfileShortId: () => "11002",
          currentProfileBalance: () => "930.89",
          currentConsumptionMonth: () => "2026-09",
          escapeHtml: String,
          escapeAttr: String,
          builtInAvatarEdgeCropClassAttribute: () => "",
          renderPageHomeButton: () => "",
          renderMembershipBadge: () => "",
          renderConsumptionLevelIcons: () => "",
          formatConsumptionAmount: () => "0",
          formatConsumptionDuration: () => "0",
          formatConsumptionLoginDays: () => "0",
          consumptionMonthLabel: String,
          renderConsumptionProfileSkeleton: () => "",
          renderConsumptionCalendarSkeleton: () => "",
          renderConsumptionRecordsSkeleton: () => "",
          renderConsumptionCalendar: () => "",
          renderConsumptionRecords: () => "",
        };
        const html = Function(...Object.keys(dependencies), `${compiled}; return renderConsumptionPage();`)(...Object.values(dependencies));
        assert.doesNotMatch(html, /export-consumption|consumption-export|导出/);
        assert.match(html, /data-consumption-unit="points"/);
        assert.match(html, /data-consumption-unit="token"/);
        assert.match(html, new RegExp(`class="active" data-consumption-unit="${unit}"`));
      }
    }
  }
});

test("calendar colors and record rendering preserve the billing contract", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const calendar = sourceBlock(renderer, "function renderConsumptionCalendar", "function consumptionRecordJumpTarget");
  const calendarToolbar = sourceBlock(styles, ".consumption-calendar-toolbar {", ".consumption-calendar-toolbar button {");
  const records = sourceBlock(renderer, "function renderConsumptionRecords", "function consumptionRuntimeStateQuery");

  assert.match(calendar, /item\?\.color_level/);
  const pointsFormatter = sourceBlock(renderer, "function formatConsumptionPoints", "function formatConsumptionAmount");
  assert.match(pointsFormatter, /Math\.trunc\(amount\) === 0 \? 6 : 4/);
  assert.match(pointsFormatter, /Math\.trunc\(amount \* scale\) \/ scale/);
  assert.match(pointsFormatter, /toFixed\(fractionDigits\)/);
  const formatPoints = Function(
    `"use strict"; ${pointsFormatter.replace("(value: unknown): string", "(value)")}; return formatConsumptionPoints;`,
  )();
  assert.equal(formatPoints(7.9120370555), "7.9120");
  assert.equal(formatPoints(7.85917996), "7.8591");
  assert.equal(formatPoints(0.0401205001), "0.040120");
  assert.equal(formatPoints(0), "0.000000");
  const recordPoints = sourceBlock(renderer, "function formatConsumptionRecordPoints", "function formatConsumptionRecordAmount");
  assert.match(recordPoints, /return formatConsumptionPoints\(value\)/);
  assert.match(calendar, /formatConsumptionCalendarAmount\(tokens, points\)/);
  const calendarPoints = sourceBlock(renderer, "function formatConsumptionCalendarPoints", "function formatConsumptionCalendarAmount");
  assert.match(calendarPoints, /Math\.trunc\(amount\) === 0 \? 5 : 3/);
  assert.match(calendarPoints, /Math\.trunc\(amount \* scale\) \/ scale/);
  assert.match(calendarPoints, /toFixed\(fractionDigits\)/);
  assert.doesNotMatch(calendarPoints, /formatConsumptionPoints\(value\)/);
  const formatCalendarPoints = Function(
    `"use strict"; ${calendarPoints.replace("(value: unknown): string", "(value)")}; return formatConsumptionCalendarPoints;`,
  )();
  assert.equal(formatCalendarPoints(0.0528570955), "0.05285");
  assert.equal(formatCalendarPoints(7.85917996), "7.859");
  assert.equal(formatCalendarPoints(0.1), "0.10000");
  assert.equal(formatCalendarPoints(1), "1.000");
  const calendarAmount = sourceBlock(renderer, "function formatConsumptionCalendarAmount", "function consumptionRecordDisplayUnit");
  assert.match(calendarAmount, /state\.consumption\.unit === "points"/);
  assert.match(calendarAmount, /amount === 0 \? "--" : formatConsumptionCalendarPoints\(amount\)/);
  assert.match(calendarAmount, /if \(amount === 0\) return "--"/);
  assert.match(calendarAmount, /Math\.round\(amount \/ 10_000\)/);
  assert.match(calendarAmount, /Math\.round\(amount \/ 100_000_000\)/);
  assert.match(records, /consumptionRecordDisplayUnit\(item\)/);
  assert.match(records, /formatConsumptionRecordAmount\(item\?\.tokens, item\?\.points \?\? item\?\.usd, displayUnit\)/);
  assert.doesNotMatch(records, /formatConsumptionAmount\(item\?\.tokens, item\?\.points \?\? item\?\.usd, displayUnit\)/);
  const recordDisplayUnit = sourceBlock(renderer, "function consumptionRecordDisplayUnit", "function formatConsumptionDuration");
  assert.match(recordDisplayUnit, /return state\.consumption\.unit/);
  assert.doesNotMatch(recordDisplayUnit, /tokens === 0 && points > 0/);
  assert.doesNotMatch(recordDisplayUnit, /return "points"/);
  const executionDuration = sourceBlock(
    renderer,
    "function formatConsumptionExecutionDuration",
    "function formatEnglishConsumptionExecutionDuration",
  );
  const formatExecutionDuration = Function(
    `"use strict"; ${executionDuration.replace("(value: unknown): string", "(value)")}; return formatConsumptionExecutionDuration;`,
  )();
  const englishExecutionDuration = sourceBlock(
    renderer,
    "function formatEnglishConsumptionExecutionDuration",
    "function consumptionDurationDisplay",
  );
  const formatEnglishExecutionDuration = Function(
    `"use strict"; ${englishExecutionDuration.replace("(value: unknown): string", "(value)")}; return formatEnglishConsumptionExecutionDuration;`,
  )();
  assert.equal(formatExecutionDuration(0), "时长未完整上报");
  assert.equal(formatExecutionDuration(480), "不足1秒");
  assert.equal(formatExecutionDuration(126000), "2分6秒");
  assert.equal(formatEnglishExecutionDuration(0), "Duration unavailable");
  assert.equal(formatEnglishExecutionDuration(126000), "2m 6s");
  assert.match(records, /item\?\.duration_ms/);
  assert.match(records, /firstString\(item\?\.status\) \|\| "unknown"/);
  assert.match(
    records,
    /firstString\(item\?\.status_label, item\?\.statusLabel\) \|\|\s*consumptionStatusFallbackLabel\(status\)/,
  );
  assert.match(records, /firstString\(item\?\.question\) \|\| "未命名任务"/);
  assert.match(records, /firstString\(item\?\.answer_excerpt, item\?\.answerExcerpt\) \|\| ""/);
  assert.match(records, /firstString\(item\?\.type\) \|\| "-"/);
  assert.match(records, /item\.models\s*\.filter\(/);
  assert.match(records, /businessModelDisplayName\(businessModelPoolsState, model\)/);
  assert.doesNotMatch(records, /consumptionModelDisplayName|consumptionRecord(?:TypeLabel|Question|Status|AnswerExcerpt)/);
  for (const removedConversion of [
    "function consumptionModelDisplayName",
    "function consumptionStatusLabel",
    "function consumptionRecordTypeLabel",
    "function consumptionRecordIsSubagent",
    "function consumptionRecordQuestion",
    "function consumptionRecordSubagentActivity",
    "function consumptionRecordHasLiveExecution",
    "function consumptionRecordStatus",
    "function consumptionRecordAnswerExcerpt",
  ]) {
    assert.doesNotMatch(renderer, new RegExp(removedConversion));
  }
  const fallbackStatusLabel = sourceBlock(
    renderer,
    "function consumptionStatusFallbackLabel",
    "function renderConsumptionRecords",
  );
  for (const [status, label] of [
    ["complete", "已完成"],
    ["completed", "已完成"],
    ["running", "执行中"],
    ["pending", "待完成"],
    ["waiting", "等待中"],
    ["failed", "失败"],
    ["canceled", "已取消"],
    ["cancelled", "已取消"],
  ]) {
    assert.match(fallbackStatusLabel, new RegExp(`${status}: "${label}"`));
  }
  assert.match(fallbackStatusLabel, /\|\| "状态未知"/);
  assert.match(records, /<th>实扣\$\{state\.consumption\.unit === "points" \? "积分" : "Token"\}<\/th><th>计费项目<\/th><th>实际调用<\/th><th>任务与计费说明<\/th>/);
  assert.match(records, /item\?\.task_kind/);
  assert.match(records, /item\?\.usage_event_count/);
  assert.match(records, /item\?\.billing_explanation/);
  assert.match(records, /item\?\.call_summary/);
  assert.match(records, /data-i18n-skip/);
  assert.match(records, /consumptionDurationDisplay\(item\)/);
  assert.doesNotMatch(renderer, /consumption-billing-note|按实际模型调用计费|缺少完整时长时会明确标注/);
  assert.match(records, /status-\$\{escapeAttr\(status\)\}/);
  for (let level = 1; level <= 5; level += 1) {
    assert.match(styles, new RegExp(`\\.consumption-day\\.level-${level}`));
  }
  assert.match(calendarToolbar, /margin:\s*0 0 12px/);
  assert.match(calendarToolbar, /transform:\s*translateX\(4px\)/);
  assert.doesNotMatch(calendarToolbar, /margin:\s*-5px/);
  assert.match(styles, /\.consumption-calendar-toolbar strong\s*\{[^}]*font-size:\s*calc\(13px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(styles, /\.consumption-calendar-card \.consumption-color-key\s*\{[^}]*transform:\s*translateX\(8px\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-page/);
  for (let level = 1; level <= 5; level += 1) {
    assert.match(styles, new RegExp(`html\\[data-theme="dark"\\] \\.consumption-day\\.level-${level}`));
    assert.match(styles, new RegExp(`html\\[data-theme="dark"\\] \\.consumption-color-key \\.level-${level}`));
  }
  const darkCalendar = sourceBlock(
    styles,
    'html[data-theme="dark"] .consumption-calendar-toolbar,',
    'html[data-theme="dark"] .consumption-table th {',
  );
  assert.doesNotMatch(darkCalendar, /background:\s*#(?:fff|eff5ff|d8e8ff|a9caff)\b/i);
  assert.match(darkCalendar, /\.consumption-day\.selected\s*\{[^}]*border-color:\s*#a9c9ff;[^}]*0 0 0 2px rgba\(78, 139, 244, \.2\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-range-toggle\s*\{[^}]*border-color:\s*rgba\(126, 148, 181, \.3\);[^}]*background:\s*#151e2b;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-unit-toggle button\.active,\s*html\[data-theme="dark"\] \.consumption-range-toggle button\.active\s*\{[^}]*background:\s*linear-gradient\(180deg, #2b4264 0%, #243a59 100%\);[^}]*color:\s*#dbe9ff;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-profile-card,\s*html\[data-theme="dark"\] \.consumption-calendar-card,\s*html\[data-theme="dark"\] \.consumption-records-card\s*\{[^}]*background:\s*#192331;[^}]*border-color:\s*#2b394c;[^}]*box-shadow:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-table th\s*\{[^}]*color:\s*#95a7c0;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-table td\s*\{[^}]*border-color:\s*#2a3748;[^}]*color:\s*#d7e1ef;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-detail-title \.status-running\s*\{[^}]*background:\s*rgba\(55, 132, 247, \.18\);[^}]*color:\s*#78b3ff;[^}]*box-shadow:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-detail-title \.status-complete\s*\{[^}]*background:\s*rgba\(36, 176, 101, \.16\);[^}]*color:\s*#64d996;[^}]*box-shadow:/s);
  for (const status of ["pending", "waiting", "failed", "canceled"]) {
    assert.match(styles, new RegExp(`html\\[data-theme="dark"\\] \\.consumption-detail-title \\.status-${status}`));
  }
  assert.match(styles, /\.consumption-detail-title \.status-pending\s*\{[^}]*background:\s*#fff0d5;[^}]*color:\s*#c86c00;/s);
  assert.doesNotMatch(styles, /consumption-billing-note/);
  for (const kind of [
    "subtask",
    "canvas_planning",
    "canvas_context",
    "canvas_validation",
    "canvas_media",
    "system_prewarm",
    "media",
    "model_call",
  ]) {
    assert.match(styles, new RegExp(`\\.consumption-task-kind\\.kind-${kind}`));
    assert.match(styles, new RegExp(`html\\[data-theme="dark"\\] \\.consumption-task-kind\\.kind-${kind}`));
  }
  assert.match(styles, /\.consumption-unit-toggle button:focus-visible,[\s\S]*?\.consumption-pagination button:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-unit-toggle button:not\(:disabled\):hover/);
});

test("consumption model names follow the transit business model display names", () => {
  const pools = normalizeBusinessModelPoolsState({
    configured: true,
    catalog_version: 9,
    pools: [
      {
        id: "execution",
        enabled: true,
        capabilities: ["root_execution"],
        models: [
          {
            id: "gpt-5.5",
            display_name: "后台 GPT 5.5",
            enabled: true,
          },
        ],
      },
      {
        id: "media_creation",
        enabled: true,
        capabilities: ["video_generation"],
        models: [
          {
            id: "grok-imagine-video-1.5-preview",
            display_name: "grok-video-1.5",
            enabled: true,
          },
          {
            id: "Seedance-2.0-720p",
            display_name: "seedance2-720p",
            enabled: false,
          },
        ],
      },
    ],
  });

  assert.equal(
    businessModelDisplayName(pools, "grok-imagine-video-1.5-preview"),
    "grok-video-1.5",
  );
  assert.equal(
    businessModelDisplayName(pools, "seedance-2.0-720P"),
    "seedance2-720p",
  );
  assert.equal(businessModelDisplayName(pools, "gpt-5.5"), "后台 GPT 5.5");
  assert.equal(
    businessModelDisplayName(pools, "unconfigured-model"),
    "unconfigured-model",
  );
});

test("calendar dates select one day and clear the preset range highlight", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const page = sourceBlock(renderer, "function renderConsumptionPage", "function renderConsumptionCalendar");
  const calendar = sourceBlock(renderer, "function renderConsumptionCalendar", "function consumptionRecordJumpTarget");
  const loader = sourceBlock(renderer, "async function loadConsumptionData", "async function exportConsumptionReport");

  assert.match(renderer, /consumption:\s*{[\s\S]*?selectedDate:\s*null/);
  assert.match(page, /consumption-records-heading/);
  assert.match(page, /consumptionDateLabel\(state\.consumption\.selectedDate\)/);
  assert.match(page, /!state\.consumption\.selectedDate && state\.consumption\.range === range/);
  assert.match(calendar, /data-consumption-date="\$\{escapeAttr\(dateValue\)\}"/);
  assert.match(calendar, /state\.consumption\.selectedDate === dateValue/);
  assert.match(renderer, /querySelectorAll<HTMLButtonElement>\("\[data-consumption-date\]"\)/);
  assert.match(renderer, /state\.consumption\.selectedDate = selectedDate/);
  assert.match(renderer, /state\.consumption\.selectedDate = null/);
  assert.match(loader, /date:\s*state\.consumption\.selectedDate/);
  assert.match(styles, /\.consumption-day\.selected\s*\{[^}]*border-color:\s*var\(--brand-blue\)/s);
  assert.match(styles, /\.consumption-records-heading small\s*\{[^}]*color:\s*#8a96a9/s);
});

test("calendar month navigation commits the new month with its fetched days", async () => {
  const renderer = await rendererSource;
  const page = sourceBlock(renderer, "function renderConsumptionPage", "function renderConsumptionCalendar");
  const monthLabel = sourceBlock(renderer, "function consumptionMonthLabel", "function consumptionDateLabel");
  const loader = sourceBlock(renderer, "async function loadConsumptionData", "async function exportConsumptionReport");
  const monthNavigation = sourceBlock(
    renderer,
    'querySelectorAll<HTMLButtonElement>("[data-consumption-month]")',
    'querySelectorAll<HTMLButtonElement>("[data-consumption-page]")',
  );

  assert.match(page, /data-consumption-month="prev"[^>]*state\.consumption\.loading/);
  assert.match(page, /data-consumption-month="next"[^>]*state\.consumption\.loading/);
  assert.match(monthLabel, /Intl\.DateTimeFormat\(appLanguageLocale\(state\.settings\.language\)/);
  assert.match(monthLabel, /Date\.UTC\(year, monthNumber - 1, 1\)/);
  assert.match(loader, /const requestedMonth = options\.month \?\? consumptionPendingMonth \?\? state\.consumption\.month/);
  assert.match(loader, /getConsumptionCalendar!\(\{ month: requestedMonth/);
  assert.match(loader, /const result = await fetchResult\(\);[\s\S]*if \(!isCurrent\(\)\) return;[\s\S]*if \(section === "calendar"\) state\.consumption\.month = requestedMonth/);
  assert.match(monthNavigation, /void loadConsumptionData\(\{ month \}\)/);
  assert.doesNotMatch(monthNavigation, /state\.consumption\.month = month/);
});

test("consumption status conversion is finalized by the API using desktop runtime facts", async () => {
  const renderer = await rendererSource;
  const runtimeState = sourceBlock(renderer, "function consumptionRuntimeStateQuery", "async function loadConsumptionData");
  const loader = sourceBlock(renderer, "async function loadConsumptionData", "async function exportConsumptionReport");

  assert.match(runtimeState, /activeTurnIdForThread\(normalizedThreadId\)/);
  assert.match(runtimeState, /activeCodexThreadIds/);
  assert.match(runtimeState, /Object\.entries\(state\.providerBusy\)/);
  assert.match(runtimeState, /subagentActivityByThreadId\.entries\(\)/);
  assert.match(runtimeState, /if \(!activity\.busy\) continue/);
  assert.match(loader, /runtimeStateProvided:\s*true/);
  assert.match(loader, /activeInteractionIds:\s*runtimeState\.activeInteractionIds/);
  assert.match(loader, /activeConversationIds:\s*runtimeState\.activeConversationIds/);
});

test("consumption records fit the card without a draggable horizontal scrollbar", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const recordsCard = sourceBlock(styles, ".consumption-records-card {", ".consumption-calendar-card > header");
  const tableWrap = sourceBlock(styles, ".consumption-table-wrap", ".consumption-table {");
  const table = sourceBlock(styles, ".consumption-table {", ".consumption-table th {");
  const tableHeader = sourceBlock(styles, ".consumption-table th {", ".consumption-table td {");
  const tableCell = sourceBlock(styles, ".consumption-table td {", ".consumption-table th:nth-child(1)");
  const pagination = sourceBlock(styles, ".consumption-pagination {", ".consumption-pagination button {");
  const paginationButton = sourceBlock(styles, ".consumption-pagination button {", ".consumption-pagination button:disabled");
  const calendarToolbarButton = sourceBlock(styles, ".consumption-calendar-toolbar button {", ".consumption-calendar-toolbar button > span,");

  assert.match(renderer, /consumption:\s*{[\s\S]*?pageSize:\s*6/);
  assert.match(recordsCard, /overflow:\s*hidden/);
  assert.match(tableWrap, /margin:\s*0 8px/);
  assert.match(tableWrap, /transform:\s*translateY\(-5px\)/);
  assert.match(tableWrap, /overflow:\s*clip/);
  assert.match(tableWrap, /overscroll-behavior:\s*none/);
  assert.match(tableWrap, /touch-action:\s*pan-y/);
  assert.doesNotMatch(tableWrap, /overflow-x:\s*(?:auto|scroll)/);
  assert.match(table, /min-width:\s*0/);
  assert.match(table, /max-width:\s*100%/);
  assert.doesNotMatch(table, /min-width:\s*760px/);
  assert.match(tableHeader, /font-weight:\s*400/);
  assert.match(tableHeader, /border-bottom:\s*0/);
  assert.match(tableCell, /height:\s*73px/);
  assert.match(styles, /\.consumption-table td:first-child > strong\s*\{\s*font-weight:\s*400;/);
  assert.match(styles, /\.consumption-detail-title strong\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(styles, /\.consumption-records-empty\s*\{[^}]*font-size:\s*calc\(13px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(styles, /\.consumption-table tbody tr:last-child td\s*\{\s*border-bottom:\s*0/);
  assert.match(pagination, /bottom:\s*13px/);
  assert.doesNotMatch(pagination, /transform:\s*scale/);
  assert.match(paginationButton, /width:\s*22px/);
  assert.match(paginationButton, /font-size:\s*calc\(23px/);
  assert.match(calendarToolbarButton, /width:\s*22px/);
  assert.match(calendarToolbarButton, /height:\s*22px/);
  assert.match(calendarToolbarButton, /border:\s*1px solid #cfd8e6/);
  assert.match(calendarToolbarButton, /border-radius:\s*5px/);
  assert.match(styles, /\.consumption-calendar-toolbar button:first-child\s*\{[^}]*margin-right:\s*5px;/s);
  assert.match(styles, /\.consumption-calendar-toolbar button:last-child\s*\{[^}]*margin-left:\s*5px;/s);
  assert.match(styles, /\.consumption-calendar-toolbar button:hover:not\(:disabled\),\s*\.consumption-pagination button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#eef4ff;[^}]*color:\s*#075dff;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-calendar-toolbar button,\s*html\[data-theme="dark"\] \.consumption-pagination button\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;[^}]*border:\s*1px solid rgba\(126, 148, 181, \.28\);[^}]*border-radius:\s*5px;[^}]*background:\s*transparent;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.consumption-calendar-toolbar button:hover:not\(:disabled\),\s*html\[data-theme="dark"\] \.consumption-pagination button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#223047;[^}]*color:\s*#8eb8ff;/s);
  assert.match(styles, /\.consumption-calendar-toolbar button > span,\s*\.consumption-pagination button > span\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*place-items:\s*center;[^}]*transform:\s*translateY\(-4px\);/s);
  assert.match(renderer, /aria-label="上一页"[^>]*><span aria-hidden="true">‹<\/span>/);
  assert.match(renderer, /aria-label="下一页"[^\r\n]*<span aria-hidden="true">›<\/span>/);
});

test("consumption record rows reuse history navigation to open and highlight their question bubble", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const opener = sourceBlock(renderer, "function openConsumptionRecord", "function renderConsumptionRecords");
  const records = sourceBlock(renderer, "function renderConsumptionRecords", "async function loadConsumptionData");
  const resolver = sourceBlock(renderer, "function resolveConsumptionRecordJumpMessageId", "function threadHistoryMessageSignature");

  assert.match(records, /data-consumption-record-index="\$\{index\}"/);
  assert.match(records, /tabindex="0" role="link"/);
  assert.match(opener, /requestThreadHistoryJump\(/);
  assert.match(opener, /turnId:\s*target\.turnId/);
  assert.match(opener, /question:\s*target\.question/);
  assert.match(resolver, /itemTurnId\(state\.items\[target\.threadId\]\?\.\[message\.id\]\) === target\.fallbackTurnId/);
  assert.match(resolver, /bestConsumptionRecordQuestionMatch/);
  assert.match(renderer, /querySelectorAll<HTMLTableRowElement>\("\[data-consumption-record-index\]"\)/);
  assert.match(renderer, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(styles, /tr\[data-consumption-record-index\]\s*\{\s*cursor:\s*pointer/);
  assert.match(styles, /tr\[data-consumption-record-index\]:hover td/);
  assert.match(styles, /\.consumption-detail-title\s*\{[^}]*width:\s*100%[^}]*justify-content:\s*space-between/s);
  assert.match(styles, /\.consumption-detail-title span\s*\{[^}]*margin-left:\s*auto/s);
  assert.match(styles, /\.consumption-task-kind\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(styles, /\.consumption-call-model\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/s);
  assert.match(styles, /\.consumption-table th:nth-child\(2\), \.consumption-table td:nth-child\(2\),[\s\S]*?padding-left:\s*14px/s);
});

test("all supported task sources report one interaction lifecycle", async () => {
  const [renderer, mainProcess, apiClient] = await Promise.all([rendererSource, mainProcessSource, apiClientSource]);

  assert.match(renderer, /sourceType: "wechat"/);
  assert.match(renderer, /sourceType: "feishu"/);
  assert.match(renderer, /sourceType: "telegram"/);
  assert.match(renderer, /sourceType: selectedProvider/);
  assert.match(renderer, /sourceType: "video"/);
  assert.match(mainProcess, /sourceType: "auto_task"/);
  assert.match(mainProcess, /interactionId: String\(turnId\)/);
  assert.match(mainProcess, /appendQuestion: true/);
  assert.match(mainProcess, /interaction\.question = \[String\(interaction\.question/);
  assert.match(mainProcess, /consumptionInteractionByChildThreadId/);
  assert.match(mainProcess, /rememberPendingConsumptionChildInteraction\(\[parentThreadId\], threadId\)/);
  assert.match(mainProcess, /record\.pendingCompletion/);
  assert.match(mainProcess, /buildSubagentConsumptionRecord\(record,/);
  assert.match(mainProcess, /interactionId: normalizedTurnId/);
  assert.match(mainProcess, /startConsumptionChildInteraction\(threadId, turnId\)/);
  assert.match(mainProcess, /recordArtifactAgentMessageNotification\(message, \{ threadId, turnId \}\)/);
  assert.match(mainProcess, /completeConsumptionChildInteraction\(threadId,\s*\{/);
  assert.match(mainProcess, /answer: finalMessage/);
  assert.match(mainProcess, /createSerializedConsumptionReporter/);
  assert.match(mainProcess, /question: visibleQuestion/);
  assert.match(renderer, /visibleQuestion: request\.prompt/);
  assert.match(renderer, /steerExternalChannelBusyMessage\("wechat"/);
  assert.match(renderer, /steerExternalChannelBusyMessage\("feishu"/);
  assert.match(renderer, /steerExternalChannelBusyMessage\("telegram"/);
  assert.match(apiClient, /"X-Haolo-Interaction-ID"/);
  assert.match(apiClient, /"X-Haolo-Conversation-ID"/);
  assert.match(apiClient, /"X-Haolo-Source-Type"/);
});
