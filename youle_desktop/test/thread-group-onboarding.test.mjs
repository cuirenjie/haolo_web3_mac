import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadOnboardingModule() {
  const source = await readFile(new URL("../src/renderer/thread-group-onboarding.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  return import(moduleUrl);
}

const onboardingModule = loadOnboardingModule();
const defaultGroupId = "__youle_default_thread_group__";

function state(overrides = {}) {
  return {
    defaultGroupId,
    groups: [{ id: defaultGroupId }],
    threads: [{ blank: true }],
    autoTaskCount: 0,
    hasPendingGroup: false,
    ...overrides,
  };
}

test("treats a first-run default blank thread as thread group onboarding empty", async () => {
  const { isThreadGroupOnboardingEmptyState } = await onboardingModule;

  assert.equal(isThreadGroupOnboardingEmptyState(state()), true);
});

test("keeps onboarding empty while only connection placeholders are present", async () => {
  const { isThreadGroupOnboardingEmptyState } = await onboardingModule;

  assert.equal(isThreadGroupOnboardingEmptyState(state({ threads: [{ blank: true }, { placeholder: true }] })), true);
});

test("leaves onboarding empty after importing or creating a user group", async () => {
  const { isThreadGroupOnboardingEmptyState } = await onboardingModule;

  assert.equal(isThreadGroupOnboardingEmptyState(state({ groups: [{ id: defaultGroupId }, { id: "study" }] })), false);
  assert.equal(isThreadGroupOnboardingEmptyState(state({ hasPendingGroup: true })), false);
});

test("leaves onboarding empty after the first real task thread appears", async () => {
  const { isThreadGroupOnboardingEmptyState } = await onboardingModule;

  assert.equal(isThreadGroupOnboardingEmptyState(state({ threads: [{ blank: true }, {}] })), false);
  assert.equal(isThreadGroupOnboardingEmptyState(state({ autoTaskCount: 1 })), false);
});

test("discards deleted group blank task placeholders instead of migrating them", async () => {
  const { shouldDiscardDeletedThreadGroupBlankThread } = await onboardingModule;

  assert.equal(
    shouldDiscardDeletedThreadGroupBlankThread(
      { groupId: "imported-group", localBlank: true, groupBlank: true, empty: true },
      "imported-group",
    ),
    true,
  );
  assert.equal(
    shouldDiscardDeletedThreadGroupBlankThread(
      { groupId: "imported-group", localBlank: true, groupBlank: true, empty: false },
      "imported-group",
    ),
    false,
  );
  assert.equal(
    shouldDiscardDeletedThreadGroupBlankThread(
      { groupId: "imported-group", localBlank: false, groupBlank: false, empty: true },
      "imported-group",
    ),
    false,
  );
  assert.equal(
    shouldDiscardDeletedThreadGroupBlankThread(
      { groupId: "other-group", localBlank: true, groupBlank: true, empty: true },
      "imported-group",
    ),
    false,
  );
});

test("activates the top-level blank task only when the discarded group placeholder was current", async () => {
  const { shouldActivateTopLevelBlankAfterDiscard } = await onboardingModule;

  assert.equal(shouldActivateTopLevelBlankAfterDiscard("group-blank", "group-blank"), true);
  assert.equal(shouldActivateTopLevelBlankAfterDiscard("group-blank", "top-level-blank"), false);
  assert.equal(shouldActivateTopLevelBlankAfterDiscard(null, "top-level-blank"), false);
});

test("hides only the default group title from the conversation list", async () => {
  const { shouldRenderThreadGroupInConversationList } = await onboardingModule;

  assert.equal(shouldRenderThreadGroupInConversationList(defaultGroupId, defaultGroupId), false);
  assert.equal(shouldRenderThreadGroupInConversationList(null, defaultGroupId), false);
  assert.equal(shouldRenderThreadGroupInConversationList("study", defaultGroupId), true);
});

test("labels the default conversation list group as recent", async () => {
  const { threadGroupConversationListDisplayName } = await onboardingModule;

  assert.equal(threadGroupConversationListDisplayName(defaultGroupId, "默认分组", defaultGroupId, "最近"), "最近");
  assert.equal(threadGroupConversationListDisplayName("study", "Study", defaultGroupId, "最近"), "Study");
});

test("migrates the legacy Trading Expert project into recent without changing explicit user groups", async () => {
  const { migrateLegacyRecentThreadGroupPreferences } = await onboardingModule;
  const migration = migrateLegacyRecentThreadGroupPreferences(
    [
      { id: defaultGroupId, name: "默认分组" },
      { id: "legacy-trading", name: "交易专家" },
      { id: "study", name: "Study" },
    ],
    {
      "trading-thread": "legacy-trading",
      "study-thread": "study",
      "local-blank": "legacy-trading",
    },
    { "study-thread": "multi-agent" },
    {
      defaultGroupId,
      defaultGroupName: "默认分组",
      legacyTradingGroupName: "交易专家",
      isVolatileThreadId: (threadId) => threadId === "local-blank",
    },
  );

  assert.deepEqual([...migration.recentAliasIds].sort(), [defaultGroupId, "legacy-trading"].sort());
  assert.deepEqual([...migration.legacyTradingGroupIds], ["legacy-trading"]);
  assert.equal(migration.threadModes["trading-thread"], "execution");
  assert.equal(migration.threadModes["study-thread"], "multi-agent");
  assert.equal(migration.threadModes["local-blank"], undefined);
});

test("shows the composer group picker only for the top-level blank task", async () => {
  const { isTopLevelBlankTaskPlaceholder, shouldRenderComposerGroupPicker } = await onboardingModule;

  assert.equal(isTopLevelBlankTaskPlaceholder({ blank: true, groupBlank: false }), true);
  assert.equal(isTopLevelBlankTaskPlaceholder({ blank: true, groupBlank: true }), false);
  assert.equal(isTopLevelBlankTaskPlaceholder({ blank: false, groupBlank: false }), false);
  assert.equal(shouldRenderComposerGroupPicker({ blank: true, groupBlank: false }), true);
  assert.equal(shouldRenderComposerGroupPicker({ blank: true, groupBlank: true }), false);
  assert.equal(shouldRenderComposerGroupPicker({ blank: false, groupBlank: false }), false);
});
