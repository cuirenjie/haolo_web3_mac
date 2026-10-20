import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFICIAL_TRADING_CATALOG } from "../src/shared/official-trading-catalog.mjs";

const root = fileURLToPath(new URL("../resources/default-haolo-ai/skills/", import.meta.url));
const check = process.argv.includes("--check");
for (const strategy of OFFICIAL_TRADING_CATALOG) {
  if (!strategy.enabled) continue;
  const name = `trading-analysis-${strategy.id}`;
  const aliases = [strategy.display.name, ...strategy.mentions.aliases].slice(0, 5).join(", ");
  const description = `Analyze current markets using Haolo's ${strategy.display.name} cloud ${strategy.display.group}. Use when the user selects or requests ${aliases}. ${strategy.id === "price-action" ? "Default for position adjustment without an explicitly selected strategy." : "Preserve explicit selection of this strategy."}`;
  const content = `---
name: ${name}
description: ${JSON.stringify(description)}
---

Read \`haolo_market\` context/catalog and load trading-account-read; call \`haolo_account_read\` before analysis. Read effective trading preferences via personal_context. Call \`haolo_analysis\` with exact strategyId \`${strategy.id}\`, the user's trading instruction, and \`positionManagementRequested: true\` for actual position management.

Preserve the requested exchange, spot/futures, symbol, interval and horizon. Default to drawingRequested true for live decisions; explicit no-drawing wins. Then load trading-chart-draw and trading-plan-present and consume the SAME analysisRef. Cloud engine facts, model selection, risk controls, left/right/automatic entry and original price levels remain authoritative. Missing coverage, unsupported markets and no-candidate results must remain explicit; never substitute another strategy silently or invent executable levels.

For a concept-only question explain the theory without running live analysis. For multiple explicitly selected strategies run each separately and summarize their agreements/conflicts; do not blend their prices into a new executable plan. Reuse existing analysis for display-only follow-ups. This skill never creates orders.
`;
  const file = path.join(root, name, "SKILL.md");
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") !== content) throw new Error(`Outdated trading Skill: ${name}`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}
console.log(`${check ? "Verified" : "Generated"} ${OFFICIAL_TRADING_CATALOG.filter(s => s.enabled).length} independent analysis Skills.`);
