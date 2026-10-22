import assert from "node:assert/strict";
import test from "node:test";
import { renderTradingAnswer } from "./helpers/trading-answer-presentation.mjs";
import { cloudAccountPlanCardFixture } from "./support/cloud-plan-card-fixture.mjs";

const card = { id: "plan", turnId: "turn", type: "agentMessage", phase: "final_answer",
  text: "Supporting analysis detail", __youleExecutionPlanPresentation: "execution-plan",
  __youleNativeResponseComplete: false, __youleCloudReports: [cloudAccountPlanCardFixture()] };
const answer = { id: "answer", turnId: "turn", type: "agentMessage", phase: "final_answer", text: "Direct answer to the user" };
const progress = { id: "progress", turnId: "turn", type: "agentMessage", phase: "commentary", text: "Reading market data" };

for (const expanded of [false, true]) {
  test(`processed stays above every answer while ${expanded ? "expanding" : "folding"} only process messages`, () => {
    const rendered = renderTradingAnswer([progress, answer, card], { expanded });
    assert.deepEqual(rendered.messages.map(message => message.id), expanded ? ["progress", "plan", "answer"] : ["plan", "answer"]);
    assert.equal(rendered.html.includes(progress.text), expanded);
    assert.ok(rendered.html.includes(card.text));
    assert.ok(rendered.html.includes(answer.text));
    assert.ok(rendered.html.indexOf("turn-result-toggle") < rendered.html.indexOf(card.text));
    assert.ok(rendered.html.indexOf(card.text) < rendered.html.indexOf("message-execution-plan-list"));
    assert.ok(rendered.html.indexOf("message-execution-plan-list") < rendered.html.indexOf(answer.text));
    assert.equal((rendered.html.match(/data-action="toggle-turn-result"/g) || []).length, 1);
    assert.match(rendered.html, new RegExp(`aria-expanded="${expanded}"`));
    assert.match(rendered.html, /data-execution-plan-message-id="plan"/);
    assert.match(rendered.html, /message-add-to-plan/);
    assert.match(rendered.html, /data-message-execution-plan-action="sticky"/);
    assert.deepEqual(rendered.bindings, ["fixture\u0000plan\u00000"], "card operations retain the original source");
  });
}

test("unfinished turns retain their report body until the answer completes", () => {
  const rendered = renderTradingAnswer([answer, card], { complete: false });
  assert.ok(rendered.html.includes(card.text));
  assert.ok(rendered.html.includes(answer.text));
  assert.doesNotMatch(rendered.html, /turn-result-toggle/);
});

test("without process messages the top processed entry is a status, and every answer remains visible", () => {
  const rendered = renderTradingAnswer([answer, card]);
  assert.match(rendered.html, /role="status"/);
  assert.doesNotMatch(rendered.html, /data-action="toggle-turn-result"/);
  assert.ok(rendered.html.indexOf("turn-result-toggle") < rendered.html.indexOf(card.text));
  assert.ok(rendered.html.indexOf("message-execution-plan-list") < rendered.html.indexOf(answer.text));
});

test("an unavailable card cannot erase the supporting text, attachments or actions", () => {
  for (const extra of [
    { __youleCloudReports: undefined },
    { attachments: [{ path: "report.pdf" }] },
    { actions: [{ id: "retry", label: "Retry" }] },
  ]) {
    const rendered = renderTradingAnswer([{ ...card, ...extra }, answer]);
    assert.ok(rendered.html.includes(card.text));
    assert.ok(rendered.html.includes(answer.text));
    if (extra.attachments) assert.match(rendered.html, /Requested file/);
    if (extra.actions) assert.match(rendered.html, /Retry/);
  }
});
