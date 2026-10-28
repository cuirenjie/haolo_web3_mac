import assert from 'node:assert/strict';
import {cloudPlanCard} from '../../src/main/cloud-plan-contract.mjs';
import {executionPlanStickyHtml} from '../../src/main/execution-plan-sticky-view.mjs';

// Sticky notes keep the frozen card body and put its action beside the controls.
// Compare both parts, including exactly one action, rather than requiring the
// chat card's inline-action HTML to be an unchanged substring of the note.
export function assertStickyCardParity(report, language) {
  const before = structuredClone(report);
  const card = cloudPlanCard(report, {language, separateAction: true});
  const html = executionPlanStickyHtml({cloudReport: report, language, title: card.title});
  assertSeparatedCardParity(html, report, language);
  assert.deepEqual(report, before, 'sticky rendering never mutates the receipt');
  return html;
}

export function assertSeparatedCardParity(html, report, language) {
  const card = cloudPlanCard(report, {language, separateAction: true});
  assert.ok(html.includes(card.html), 'surface preserves the complete frozen card body');
  if (card.actionHtml) {
    assert.equal(html.split(card.actionHtml).length - 1, 1, 'sticky shows the action exactly once');
    const footer = html.indexOf('class="execution-plan-inline-footer"');
    assert.ok(footer >= 0, 'surface includes its action footer');
    assert.ok(html.indexOf(card.actionHtml) > footer, 'action belongs to the footer');
  }
  return html;
}
