import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import { translateAppText } from "../src/renderer/app-language.mjs";

const HAN_TEXT_PATTERN = /\p{Script=Han}/u;
const RENDERER_ROOT = fileURLToPath(new URL("../src/renderer", import.meta.url));
const TRADING_STRATEGY_ROOT = fileURLToPath(new URL("../resources/trading-strategies/builtins", import.meta.url));
const SOURCE_EXTENSION_PATTERN = /\.(?:html|js|mjs|ts)$/u;

function rendererSourceFiles(directory = RENDERER_ROOT) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return rendererSourceFiles(entryPath);
    if (!SOURCE_EXTENSION_PATTERN.test(entry.name)) return [];
    if (entry.name.startsWith("app-language")) return [];
    return [entryPath];
  });
}

function chineseLiteralFragments(source, file) {
  const fragments = [];
  const append = (literal) => {
    literal = literal.replace(/&#(x[\da-f]+|\d+);/giu, (entity, code) => {
      const point = code[0].toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
    for (const match of literal.matchAll(/(?:aria-label|placeholder|title)="([^"]*)/gsu)) {
      append(match[1]);
    }
    const visibleText = literal
      .replace(/<[^>]+>/gsu, " ")
      .replace(/<[^>]*$/gsu, " ")
      .replace(/^[^<]*>/gsu, " ");
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
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      append(node.text);
    } else if (ts.isTemplateExpression(node)) {
      append(node.head.text);
      for (const span of node.templateSpans) append(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return fragments;
}

test("every renderer-owned Chinese literal has a Han-free English presentation", () => {
  const failures = [];
  for (const file of rendererSourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    for (const text of chineseLiteralFragments(source, file)) {
      const translated = translateAppText(text, "en");
      if (!HAN_TEXT_PATTERN.test(translated)) continue;
      failures.push({
        file: path.relative(RENDERER_ROOT, file),
        source: text,
        translated,
      });
    }
  }
  assert.deepEqual(failures, []);
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
