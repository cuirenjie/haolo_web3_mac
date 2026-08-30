import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function cssBlock(source, selector) {
  const marker = `${selector} {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing CSS block: ${selector}`);
  const end = source.indexOf("\n}", start + marker.length);
  assert.notEqual(end, -1, `unterminated CSS block: ${selector}`);
  return source.slice(start, end + 2);
}

function pxDeclaration(block, property) {
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*(-?\\d+(?:\\.\\d+)?)px\\b`));
  assert.ok(match, `missing pixel declaration: ${property}`);
  return Number(match[1]);
}

function percentPlusPxDeclaration(block, property) {
  const match = block.match(
    new RegExp(`(?:^|\\n)\\s*${property}:\\s*calc\\(100% \\+ (-?\\d+(?:\\.\\d+)?)px\\)`),
  );
  assert.ok(match, `missing calc(100% + px) declaration: ${property}`);
  return Number(match[1]);
}

function boxShorthand(block, property) {
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*([^;]+);`));
  assert.ok(match, `missing box shorthand: ${property}`);
  const values = match[1]
    .trim()
    .split(/\s+/)
    .map((value) => {
      assert.match(value, /^-?\d+(?:\.\d+)?(?:px)?$/, `unsupported ${property} value: ${value}`);
      return Number.parseFloat(value);
    });

  if (values.length === 1) return [values[0], values[0], values[0], values[0]];
  if (values.length === 2) return [values[0], values[1], values[0], values[1]];
  if (values.length === 3) return [values[0], values[1], values[2], values[1]];
  assert.equal(values.length, 4, `unsupported ${property} shorthand length`);
  return values;
}

test("composer reserves at least eight pixels between its input and bottom controls", async () => {
  const styles = await stylesSource;
  const composer = cssBlock(styles, ".composer");
  const input = cssBlock(styles, ".composer-input-wrap");
  const attachmentWrap = cssBlock(styles, ".pending-attachments-wrap");
  const attachmentRail = cssBlock(styles, ".pending-attachments");
  const quote = cssBlock(styles, ".composer-quote-preview");
  const tools = cssBlock(styles, ".composer-tools");
  const toolButton = cssBlock(styles, ".composer-icon-btn");
  const modelPicker = cssBlock(styles, ".composer-model-picker");
  const sendButton = cssBlock(styles, ".send-button");

  const [paddingTop, , paddingBottom] = boxShorthand(composer, "padding");
  const [quoteMarginTop, , quoteMarginBottom] = boxShorthand(quote, "margin");
  const minHeight = pxDeclaration(composer, "min-height");
  const borderTop = pxDeclaration(composer, "border-top");
  const inputHeight = pxDeclaration(input, "height");
  const attachmentFlowHeight =
    pxDeclaration(attachmentWrap, "margin-top") +
    pxDeclaration(attachmentRail, "height") +
    pxDeclaration(attachmentWrap, "margin-bottom");
  const quoteFlowHeight = quoteMarginTop + pxDeclaration(quote, "height") + quoteMarginBottom;

  const controls = [
    {
      name: "tools",
      bottom: pxDeclaration(tools, "bottom"),
      height: pxDeclaration(toolButton, "height"),
    },
    {
      name: "model picker",
      bottom: pxDeclaration(modelPicker, "bottom"),
      height: pxDeclaration(modelPicker, "height"),
    },
    {
      name: "send button",
      bottom: pxDeclaration(sendButton, "bottom"),
      height: pxDeclaration(sendButton, "height"),
    },
  ];
  const scenarios = [
    { name: "plain input", flowBeforeInput: 0 },
    { name: "attachment", flowBeforeInput: attachmentFlowHeight },
    { name: "quote", flowBeforeInput: quoteFlowHeight },
    { name: "attachment and quote", flowBeforeInput: attachmentFlowHeight + quoteFlowHeight },
  ];

  for (const scenario of scenarios) {
    const inputBottom = borderTop + paddingTop + scenario.flowBeforeInput + inputHeight;
    const naturalHeight = inputBottom + paddingBottom;
    const composerHeight = Math.max(minHeight, naturalHeight);

    for (const control of controls) {
      const controlTop = composerHeight - control.bottom - control.height;
      const gap = controlTop - inputBottom;
      assert.ok(
        gap >= 8,
        `${scenario.name}: ${control.name} overlaps the composer input (gap ${gap}px)`,
      );
    }
  }
});

test("video expert composer inherits the exact base composer dimensions and spacing", async () => {
  const styles = await stylesSource;
  assert.doesNotMatch(styles, /\.video-expert-composer\s*\{/);
  assert.doesNotMatch(styles, /\.video-expert-input-wrap\s*\{/);
});

test("new-task group picker sits above the composer and aligns with the input cursor", async () => {
  const styles = await stylesSource;
  const composer = cssBlock(styles, ".composer");
  const picker = cssBlock(styles, ".composer-context-group-picker");

  const [, , , composerPaddingLeft] = boxShorthand(composer, "padding");
  assert.equal(pxDeclaration(picker, "left"), composerPaddingLeft - 5);
  assert.match(picker, /bottom:\s*calc\(100% \+ 5px\);/);
  assert.match(picker, /position:\s*absolute;/);
});

test("generic @ cascade stays above the new-task group picker without overlapping it", async () => {
  const styles = await stylesSource;
  const pickerDimensions = cssBlock(styles, ".composer-group-picker");
  const picker = cssBlock(styles, ".composer-context-group-picker");
  const mentionWithPicker = cssBlock(
    styles,
    ".composer:has(.composer-context-group-picker) .composer-skill-popover",
  );

  const gap =
    percentPlusPxDeclaration(mentionWithPicker, "bottom") -
    percentPlusPxDeclaration(picker, "bottom") -
    pxDeclaration(pickerDimensions, "height");
  assert.equal(gap, 8);
});

test("Trading Expert @ cascade stays anchored to the footer plus button", async () => {
  const styles = await stylesSource;
  const tradingExpertMention = cssBlock(
    styles,
    ".desktop-body.trading-expert-layout\n  > .trading-expert-panel\n  > .composer:has(.composer-context-group-picker)\n  .trading-expert-mention-popover",
  );

  assert.match(tradingExpertMention, /z-index:\s*30;/);
  assert.match(tradingExpertMention, /bottom:\s*calc\(8px \+ 28px \+ 8px\);/);
});

test("composer upload plus stays centered in a circular hover target", async () => {
  const styles = await stylesSource;
  const uploadButton = cssBlock(styles, ".composer-upload-button");

  assert.match(uploadButton, /display:\s*grid;/);
  assert.match(uploadButton, /place-items:\s*center;/);
  assert.match(uploadButton, /border-radius:\s*50%;/);
  assert.match(uploadButton, /padding:\s*0;/);
});

test("composer dropdown chevrons use sixty percent of their original stroke weight", async () => {
  const styles = await stylesSource;
  const groupChevron = cssBlock(
    styles,
    ".composer-context-group-picker .chat-title-group-button svg",
  );
  const modeChevron = cssBlock(styles, ".composer-mode-trigger-chevron");
  const modelChevron = cssBlock(
    styles,
    ".composer-model-picker .composer-model-button svg:last-child",
  );

  assert.match(groupChevron, /stroke-width:\s*1\.08;/);
  assert.match(modeChevron, /stroke-width:\s*1\.02;/);
  assert.match(modelChevron, /stroke-width:\s*1\.08;/);
});
