import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("contact directory search combines local name/detail matches with account results", async () => {
  const source = await mainSource;
  const listBlock = sourceBlock(source, "function contactsForList", "function contactDirectoryProfiles");
  const matchBlock = sourceBlock(source, "function contactMatchesQuery", "function selectedContact");
  const apiMappingBlock = sourceBlock(source, "function contactProfileFromApiUser", "function contactRequestFromApi");
  const searchBlock = sourceBlock(source, "async function searchContactsUsers", "function resetContactsRemoteSearch");

  assert.match(listBlock, /contactDirectoryProfiles\(\)\.filter\(\(contact\) => contactMatchesQuery\(contact, query\)\)/);
  assert.match(listBlock, /mergeUniqueContacts\(localMatches, remoteMatches\)/);
  assert.match(matchBlock, /contact\.summary/);
  assert.match(matchBlock, /contact\.features/);
  assert.match(matchBlock, /contact\.agent/);
  assert.match(
    apiMappingBlock,
    /firstString\(user\.agent_name,\s*user\.agentName\)\s*\|\|\s*contactAgentDisplayName\(displayName\)/,
  );
  assert.match(searchBlock, /if \(!api\.searchContacts \|\| !isValidContactSearchQuery\(query\)\)/);
});

test("specialized providers stay available to existing flows but are hidden from the agent directory", async () => {
  const source = await mainSource;
  const visibilityBlock = sourceBlock(
    source,
    "function shouldShowContactInDirectory",
    "function isVisibleAgentDirectoryContact",
  );

  assert.match(visibilityBlock, /contact\.id === VIDEO_EXPERT_CONTACT_ID\) return false/);
  assert.match(visibilityBlock, /contact\.id === TRADING_EXPERT_CONTACT_ID\) return false/);
  assert.match(visibilityBlock, /contact\.id === PROVIDER_CHAT_META\.perplexity\.id\) return false/);
  assert.match(source, /selectedContactId: HAOLO_CONTACT_ID/);
  assert.match(source, /\[VIDEO_EXPERT_PROVIDER\]: \{ id: VIDEO_EXPERT_CONTACT_ID/);
  assert.match(source, /perplexity: \{ id: "agent-perplexity"/);
});

test("contact directory keeps Haolo in 智能体 and lists provider models under 大模型", async () => {
  const source = await mainSource;
  const profiles = sourceBlock(source, "const CONTACT_PROFILES", "const state:");
  const groups = sourceBlock(source, "function renderContactsSections", "function renderContactsLoadHint");

  const haoloProfile = sourceBlock(profiles, "id: HAOLO_CONTACT_ID", "id: VIDEO_EXPERT_CONTACT_ID");
  assert.match(haoloProfile, /section: "agents"/);

  for (const contactId of ["agent-claude", "agent-gpt", "agent-kimi", "agent-deepseek", "agent-gemini", "agent-grok", "agent-mimo", "agent-perplexity", "agent-doubao", "agent-qwen"]) {
    const start = profiles.indexOf(`id: "${contactId}"`);
    assert.notEqual(start, -1, `missing model contact: ${contactId}`);
    assert.match(profiles.slice(start, start + 180), /section: "models"/);
  }

  assert.match(groups, /renderContactGroup\("agents", "智能体", agents\)/);
  assert.match(groups, /renderContactGroup\("models", "大模型", models\)/);
  assert.ok(
    groups.indexOf('renderContactGroup("agents", "智能体", agents)') <
      groups.indexOf('renderContactGroup("models", "大模型", models)'),
    "智能体 group should render above 大模型",
  );
});

test("contact directory group controls retain readable dark interaction states", async () => {
  const styles = await stylesSource;

  assert.match(styles, /html\[data-theme="dark"\] \.contacts-group-toggle,\s*[\s\S]*color: var\(--text-primary-soft\);/);
  assert.match(styles, /html\[data-theme="dark"\] \.contacts-group-toggle:hover,\s*html\[data-theme="dark"\] \.contacts-group-toggle:focus-visible,[\s\S]*background: rgba\(255, 255, 255, 0\.055\);/);
  assert.match(styles, /html\[data-theme="dark"\] \.contacts-group-toggle:active\s*\{\s*background: var\(--surface-active-translucent\);/);
  assert.match(styles, /html\[data-theme="dark"\] \.contacts-group-toggle:focus-visible\s*\{\s*outline-color: #5b9dff;/);
  assert.match(styles, /html\[data-theme="dark"\] \.contacts-group-toggle\[aria-expanded="true"\]\s*\{\s*color: var\(--text-primary-soft\);/);
});

test("contact search results highlight matched name and detail text in blue", async () => {
  const source = await mainSource;
  const renderBlock = sourceBlock(source, "function renderContactSearchRow", "function contactSearchAction");
  const styles = await stylesSource;

  assert.match(renderBlock, /renderHighlightedContactSearchText\(contact\.name, query\)/);
  assert.match(renderBlock, /renderHighlightedContactSearchText\(detail, query\)/);
  assert.match(renderBlock, /<mark class="contact-search-highlight">/);
  assert.match(styles, /\.contact-search-highlight\s*\{[^}]*background:\s*transparent;[^}]*color:\s*#0088ff;[^}]*font-weight:\s*700;/s);
});

test("contact search renders the shared clear button and restores the directory", async () => {
  const source = await mainSource;
  const pageBlock = sourceBlock(source, "function renderContactsPage", "function contactSearchExecutedForCurrentQuery");
  const eventsBlock = sourceBlock(source, "function bindEvents", "function openChannelDialog");

  assert.match(pageBlock, /hasSearchText[\s\S]*class="contacts-search-clear"/);
  assert.match(pageBlock, /data-action="clear-contacts-search"/);
  assert.match(pageBlock, /<img class="button-close-icon" src="\$\{escapeAttr\(HOME_ICON_URL\.close\)\}" alt="" \/>/);
  assert.match(eventsBlock, /\[data-action="clear-contacts-search"\][\s\S]*state\.contactsSearch = "";/);
  assert.match(eventsBlock, /resetContactsRemoteSearch\(\);[\s\S]*resetContactsSelectionForSearch\(\);[\s\S]*#contactsSearch/);
});

test("Haolo opens its profile first and starts an execution task only from the message button", async () => {
  const source = await mainSource;
  const haoloProfile = sourceBlock(source, "id: HAOLO_CONTACT_ID", "id: VIDEO_EXPERT_CONTACT_ID");
  assert.match(haoloProfile, /summary: "Haolo 是你的智能体操作系统/);
  assert.match(haoloProfile, /developer: "Haolo"/);
  assert.match(haoloProfile, /features: \["复杂任务执行", "智能问答与内容创作", "多 Agent 协作"\]/);

  const selectedContactBlock = sourceBlock(source, "function selectedContact", "function resetContactsSelectionForSearch");
  assert.match(selectedContactBlock, /visibleContacts\.find\(\(contact\) => contact\.id === selectedId\)/);
  assert.doesNotMatch(selectedContactBlock, /!isHaoloContact/);

  const contactSelectionBlock = sourceBlock(
    source,
    '.querySelectorAll<HTMLButtonElement>("[data-contact-id]")',
    ".querySelectorAll<HTMLElement>('[data-action=\"open-add-contact\"]')",
  );
  assert.match(contactSelectionBlock, /state\.selectedContactId = contactId/);
  assert.doesNotMatch(contactSelectionBlock, /openHaoloContactNewThread/);

  const messageBlock = sourceBlock(source, "async function messageContact", "async function openHaoloContactNewThread");
  assert.match(messageBlock, /if \(isHaoloContact\(contact\)\)/);
  assert.match(messageBlock, /await openHaoloContactNewThread\(\)/);

  const actionBlock = sourceBlock(source, "function renderContactProfileActions", "function renderAgentContactDetails");
  assert.match(actionBlock, /data-action="message-contact"/);
});

test("selecting an agent preserves the contact directory scroll position", async () => {
  const source = await mainSource;
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const scrollBlock = sourceBlock(
    source,
    "function currentContactsListScrollState",
    "function currentSkillsPlazaScrollState",
  );

  assert.match(renderBlock, /const previousContactsListScroll = currentContactsListScrollState\(\)/);
  assert.match(renderBlock, /restoreContactsListScrollTop\(previousContactsListScroll\)/);
  assert.match(scrollBlock, /state\.activeView !== "contacts"/);
  assert.match(scrollBlock, /root\.querySelector<HTMLDivElement>\("\.contacts-rows"\)/);
  assert.match(scrollBlock, /key: contactsListScrollKey\(\)/);
  assert.match(scrollBlock, /scrollTop: scroller\.scrollTop/);
  assert.match(scrollBlock, /previous\.key !== contactsListScrollKey\(\)/);
  assert.match(scrollBlock, /scroller\.scrollTop = previous\.scrollTop/);
  assert.match(scrollBlock, /window\.requestAnimationFrame\(restore\)/);
});
