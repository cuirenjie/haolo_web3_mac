import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);
const renderer = await readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);

test("the chat scrollbar stays outside the east window resize hit zone", () => {
  assert.match(
    styles,
    /html:not\(\.window-maximized\) body\.desktop-app-window-mode \.desktop-body\.right-panel-collapsed > \.chat-panel \.message-area\s*{[^}]*margin-right:\s*var\(--window-resize-hit-zone\);[^}]*}/,
  );
});

test("the system dashboard scrollbar stays outside the east window resize hit zone", () => {
  assert.match(
    styles,
    /html:not\(\.window-maximized\) body\.desktop-app-window-mode \.desktop-body:not\(\.right-panel-collapsed\) > \.agent-panel \.workflow\s*{[^}]*margin-right:\s*var\(--window-resize-hit-zone\);[^}]*}/,
  );
});

test("the workflow canvas scrollbar stays outside the east window resize hit zone", () => {
  assert.match(
    styles,
    /html:not\(\.window-maximized\) body\.desktop-app-window-mode \.desktop-body:not\(\.right-panel-collapsed\) > \.agent-panel \.cluster-workflow-shell:not\(\.has-inspector\) > \.cluster-workflow-viewport\s*{[^}]*margin-right:\s*var\(--window-resize-hit-zone\);[^}]*}/,
  );
});

test("right-edge scrollbar detection is global instead of a panel whitelist", () => {
  assert.match(
    renderer,
    /root\.querySelectorAll<HTMLElement>\("\*"\)[\s\S]*?supportsVisibleWindowScrollbar\(style\.overflowX\)[\s\S]*?supportsVisibleWindowScrollbar\(style\.overflowY\)/,
  );
  assert.doesNotMatch(
    renderer,
    /const selector = state\.rightCollapsed\s*\?/,
  );
});

test("the subagent dashboard output keeps symmetrical horizontal insets", () => {
  assert.match(
    styles,
    /html:not\(\.window-maximized\) body\.desktop-app-window-mode \.desktop-body:not\(\.right-panel-collapsed\) > \.agent-panel \.subagent-output-workflow\s*{[^}]*margin-right:\s*0;[^}]*}/,
  );
  assert.match(
    styles,
    /\.subagent-output-workflow\s*{[^}]*--subagent-output-scrollbar-width:\s*0px;[^}]*padding:\s*12px calc\(12px - var\(--subagent-output-scrollbar-width\)\) 22px 12px;[^}]*}/,
  );
});
