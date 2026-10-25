import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import { translateAppText, translateDrawingText } from "../src/renderer/app-language.mjs";
import { DRAWING_MENU_SECTIONS } from "../src/renderer/trading-drawing-catalog.ts";

const HAN_TEXT_PATTERN = /\p{Script=Han}/u;
const RENDERER_ROOT = fileURLToPath(new URL("../src/renderer", import.meta.url));
const TRADING_STRATEGY_ROOT = fileURLToPath(new URL("../resources/trading-strategies/builtins", import.meta.url));
const SOURCE_EXTENSION_PATTERN = /\.(?:html|js|mjs|ts)$/u;
// These modules render inside data-i18n-drawing; do not bypass their scoped
// translator or omit them from the corpus audit. Tool/section semantics and
// complete dynamic messages are also exercised by trading-drawing-language.
const DRAWING_SOURCE_FILES = new Set([
  "trading-drawing-catalog.ts", "trading-drawing-extra-tools.ts", "trading-expert-drawing.ts",
  "color-picker.ts", "trading-chart-screenshot.ts", "trading-fibonacci-settings.ts",
  "trading-horizontal-line-settings.ts", "trading-position-settings.ts",
  "trading-regression-settings.ts", "trading-volume-settings.ts",
  "trading-info-line.ts",
]);
const DRAWING_SECTION_LABELS = new Set([
  ...DRAWING_MENU_SECTIONS.flatMap((group) => group.sections.map((section) => section.label)),
  "视图与历史",
]);

function auditTranslation(text, file, locale = "en") {
  if (!DRAWING_SOURCE_FILES.has(path.basename(file))) return translateAppText(text, locale);
  const whole = translateDrawingText(text, locale, DRAWING_SECTION_LABELS.has(text));
  if (!HAN_TEXT_PATTERN.test(whole)) return whole;
  // Tables localize each default cell; status messages are delimited by middots.
  return text.split(/\s*\|\s*|(?:^|\s+)·\s*/u).map((part) =>
    translateDrawingText(part, locale, DRAWING_SECTION_LABELS.has(part)),
  ).join(" | ");
}

function rendererSourceFiles(directory = RENDERER_ROOT) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return [".cache", "dist", "node_modules"].includes(entry.name) ? [] : rendererSourceFiles(entryPath);
    if (!SOURCE_EXTENSION_PATTERN.test(entry.name)) return [];
    if (entry.name.startsWith("app-language")) return [];
    return [entryPath];
  });
}

function chineseLiteralFragments(source, file) {
  const fragments = [];
  const separator = "\n"; // DOM text nodes are localized independently.
  const append = (literal) => {
    // Font probes and private model instructions are not rendered UI copy.
    if (literal === 'Mg中文' || literal.startsWith('{"intent":') || /^(你正在代表当前桌面端|身份与品牌规则：|如果用户是在请求查找、读取|用户任务中的“你们”)/.test(literal)) return;
    // A template boundary inside an HTML attribute is not a text node.
    if (/^[^<>]*["']\s+(?:role|title|aria-label)=/.test(literal)) return;
    literal = literal.replace(/&#(x[\da-f]+|\d+);/giu, (entity, code) => {
      const point = code[0].toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
    for (const match of literal.matchAll(/(?:aria-label|placeholder|title)="([^"]*)/gsu)) {
      append(match[1]);
    }
    // Attribute-only helper arguments have no visible text node.
    if (/^\s*(?:[\w-]+="[^"]*"\s*)+$/u.test(literal)) return;
    const visibleText = literal
      .replace(/<[^>]+>/gsu, separator)
      .replace(/<[^>]*$/gsu, separator)
      .replace(/^[^<]*>/gsu, separator);
    for (const part of visibleText.split(/\r?\n/u)) {
      const text = part.trim();
      if (HAN_TEXT_PATTERN.test(text)) fragments.push(text);
    }
  };
  if (path.extname(file) === ".html") {
    append(source);
    return fragments;
  }
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const visit = (node) => {
    // Font probes measure CJK glyphs; their contents are never displayed.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "measureText") return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      append(node.text);
    } else if (ts.isTemplateExpression(node)) {
      if (DRAWING_SOURCE_FILES.has(path.basename(file))) {
        // The drawing translator intentionally matches whole templates, not
        // fragments such as "个端点". Keep them whole with a numeric sample.
        // Literal conditional branches are visited below as well.
        const sample = (expression) => ts.isStringLiteral(expression)
          ? expression.text
          : ts.isConditionalExpression(expression) ? sample(expression.whenTrue) : "2";
        append(node.head.text + node.templateSpans.map((span) => sample(span.expression) + span.literal.text).join(""));
      } else {
        append(node.head.text);
        for (const span of node.templateSpans) append(span.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return fragments;
}

for (const locale of ["en", "ko"]) test(`every renderer-owned Chinese literal has a Han-free ${locale} presentation`, () => {
  const failures = [];
  for (const file of rendererSourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    for (const text of chineseLiteralFragments(source, file)) {
      const translated = auditTranslation(text, file, locale);
      if (!HAN_TEXT_PATTERN.test(translated)) continue;
      failures.push({
        file: path.relative(RENDERER_ROOT, file),
        source: text,
        translated,
      });
    }
  }
  if (process.env.HAOLO_I18N_MISSING_DIR) {
    fs.mkdirSync(process.env.HAOLO_I18N_MISSING_DIR, {recursive:true});
    fs.writeFileSync(path.join(process.env.HAOLO_I18N_MISSING_DIR, `renderer-${locale}.json`),JSON.stringify(failures,null,2));
  }
  assert.deepEqual(failures, []);
});

test("the corpus audit covers scoped drawing templates and still rejects unknown copy", () => {
  const file = "trading-expert-drawing.ts";
  const snippets = [
    'const hint = `依次点击图表设置 ${pointCount} 个端点；完成后可拖动端点调整`;',
    'const heading = `<h3 data-i18n-drawing-section>视图与历史</h3>${items}`;',
    'const hint = "每行一行表格，用 | 分隔列";',
    'const rows = "项目 | 数值\\n价格 | 0";',
  ];
  for (const snippet of snippets) {
    const fragments = chineseLiteralFragments(snippet, file);
    assert.ok(fragments.length > 0, snippet);
    for (const text of fragments) assert.doesNotMatch(auditTranslation(text, file), HAN_TEXT_PATTERN, text);
  }
  const unknown = chineseLiteralFragments('const text = "未收录龘龘提示";', file);
  assert.equal(unknown.length, 1);
  assert.match(auditTranslation(unknown[0], file), HAN_TEXT_PATTERN);
  assert.equal(auditTranslation("置顶", "main.ts"), "Top");
  assert.equal(auditTranslation("置顶", file), "Pin");
});

test("every bundled strategy and indicator card has curated Han-free English metadata", () => {
  const failures = [];
  for (const entry of fs.readdirSync(TRADING_STRATEGY_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const strategyRoot = path.join(TRADING_STRATEGY_ROOT, entry.name);
    const manifestPath = path.join(strategyRoot, "strategy.json");
    const metadataPath = path.join(strategyRoot, "agents", "openai.yaml");
    const values = [];
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (typeof manifest?.display?.name === "string") values.push(manifest.display.name);
    }
    if (fs.existsSync(metadataPath)) {
      const metadata = fs.readFileSync(metadataPath, "utf8");
      for (const key of ["display_name", "short_description"]) {
        const match = metadata.match(new RegExp(`^\\s*${key}:\\s*["']([^"']*)["']`, "m"));
        if (match?.[1]) values.push(match[1]);
      }
    }
    for (const source of values) {
      const translated = translateAppText(source, "en");
      if (!HAN_TEXT_PATTERN.test(translated)) continue;
      failures.push({ strategyId: entry.name, source, translated });
    }
  }
  assert.deepEqual(failures, []);
});
