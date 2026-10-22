import { cloudPlanCard, legacyReportCandidates, selectCloudPlan } from '../main/cloud-plan-contract.mjs';
import { executionPlanCardBody, executionPlanCardHeading } from '../main/execution-plan-card-view.mjs';
import { executionPlanDisplayLines } from './execution-plans.ts';

type Tone = 'bullish' | 'bearish' | 'muted';
type Detail = { label: string; value: string; tone: Tone };
export type ExternalPlanImage = {
  title: string;
  badges: Array<{ text: string; tone: Tone | 'strategy' }>;
  metrics: Array<{ label: string; price: string; tone: Tone; detail: Detail | null }>;
  targets: Array<{ label: string; price: string; ratio: string; amount: Detail | null; profit: Detail | null }>;
  notes: string[];
};

// Reuse the exact card formatter, including server account sizing and cumulative
// net PnL. This private reply is distinct from the public invitation share image.
export function externalTradingPlanCardMarkup(result: { cloudReports?: any[]; report?: string }, language: string) {
  if (result.cloudReports?.length) {
    return result.cloudReports.flatMap(report => report.planRecords.map((remote: any) =>
      cloudPlanCard(selectCloudPlan(report, remote), { language, hideExpiry: true, separateAction: true })?.html || '',
    )).filter(Boolean);
  }
  return legacyReportCandidates(result.report || '').map((candidate: any) => {
    const lines = executionPlanDisplayLines(candidate.content);
    return executionPlanCardHeading(candidate.title, lines, language) + executionPlanCardBody(lines, language, { hideAction: true });
  });
}

export function externalPlanImageSnapshot(markup: string): ExternalPlanImage | null {
  const host = document.createElement('div');
  host.innerHTML = markup;
  const text = (node: Element | null | undefined) => node?.textContent?.trim() || '';
  const tone = (node: Element | null | undefined): Tone => node?.matches('.bullish, .execution-plan-card-number-bullish') ? 'bullish'
    : node?.matches('.bearish, .execution-plan-card-number-bearish') ? 'bearish' : 'muted';
  const detail = (node: Element | null | undefined): Detail | null => {
    if (!node) return null;
    const value = node.querySelector('span');
    return { label: [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(), value: text(value), tone: tone(value) };
  };
  const metrics = [...host.querySelectorAll('.execution-plan-metric')].map(node => ({
    label: text(node.querySelector('.execution-plan-card-label')),
    price: text(node.querySelector('.execution-plan-price')), tone: tone(node.querySelector('.execution-plan-price')),
    detail: detail(node.querySelector('.execution-plan-account-detail')),
  }));
  // Waiting/observation reports are not executable price cards.
  if (metrics.length !== 2 || metrics.some(metric => !metric.price)) return null;
  return {
    title: text(host.querySelector('.execution-plan-heading h2')),
    badges: [...host.querySelectorAll('.execution-plan-badge')].map(node => ({ text: text(node), tone: node.classList.contains('strategy') ? 'strategy' : tone(node) })),
    metrics,
    targets: [...host.querySelectorAll('.execution-plan-target')].map(node => ({
      label: text(node.querySelector('.execution-plan-target-main .execution-plan-card-label')),
      price: text(node.querySelector('.execution-plan-target-main strong')), ratio: text(node.querySelector('.execution-plan-ratio')),
      amount: detail(node.querySelector('.execution-plan-target-amount')), profit: detail(node.querySelector('.execution-plan-target-profit')),
    })),
    notes: [...host.querySelectorAll('.execution-plan-details')].map(text).filter(Boolean),
  };
}

// Draw a fresh PNG from the frozen card fields; never capture a window or DOM.
// The fixed light palette matches the requested mobile card in either app theme.
export async function renderExternalTradingPlanImage(plan: ExternalPlanImage) {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas'), scale = 3, width = 400;
  const colors = { text: '#18191c', muted: '#6c707a', bullish: '#25854c', bearish: '#cb3e50', strategy: '#9a6700' };
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PLAN_IMAGE_CANVAS_UNAVAILABLE');
  const font = (size: number, bold = false) => `${bold ? 700 : 400} ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  const measure = (value: string, size: number, bold = false) => { ctx.font = font(size, bold); return ctx.measureText(value).width; };
  const wrap = (value: string, maxWidth: number, size: number, bold = false) => {
    const rows: string[] = []; let row = '';
    for (const char of value) {
      if (row && measure(row + char, size, bold) > maxWidth) { rows.push(row); row = ''; }
      row += char;
    }
    if (row) rows.push(row);
    return rows;
  };
  const titleRows = wrap(plan.title, 332, 24, true);
  const badgeWidths = plan.badges.map(b => Math.min(350, measure(b.text, 18, true) + 16));
  const badgesWidth = badgeWidths.reduce((total, w) => total + w + 10, 0);
  const inlineBadges = titleRows.length === 1 && measure(plan.title, 24, true) + 12 + badgesWidth <= 330;
  ctx.font = font(24, true); ctx.textBaseline = 'top';
  const titleInk = ctx.measureText(titleRows[0] || '');
  const titleCenterY = 26 + (titleInk.actualBoundingBoxDescent - titleInk.actualBoundingBoxAscent) / 2;
  let badgeX = inlineBadges ? 24 + measure(plan.title, 24, true) + 12 : 24;
  let badgeY = inlineBadges ? titleCenterY - 15 : 26 + titleRows.length * 32 + 7;
  const badgePositions = badgeWidths.map(w => {
    if (badgeX + w > 376) { badgeX = 24; badgeY += 40; }
    const position = { x: badgeX, y: badgeY, width: w }; badgeX += w + 10;
    return position;
  });
  const headerHeight = Math.max(titleRows.length * 32, plan.badges.length ? badgeY + 30 - 26 : 0);
  const metricsY = 26 + headerHeight + 22;
  const targetY = metricsY + 122;
  const noteRows = plan.notes.flatMap(note => wrap(note, 352, 16));
  const height = Math.max(290, targetY + plan.targets.length * 75 + 18 + noteRows.length * 24);
  canvas.width = width * scale; canvas.height = height * scale;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#e6e7eb'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(.5, .5, width - 1, height - 1, 28); ctx.stroke();
  const drawText = (value: string, x: number, y: number, max: number, size: number, color: string, bold = false) => {
    // Preserve every digit by fitting the text instead of truncating it.
    while (measure(value, size, bold) > max && size > 10) size -= .5;
    ctx.font = font(size, bold); ctx.fillStyle = color; ctx.textBaseline = 'top'; ctx.fillText(value, x, y, max);
  };
  titleRows.forEach((row, index) => drawText(row, 24, 26 + index * 32, 332, 24, colors.text, true));
  plan.badges.forEach((badge, index) => {
    const { x, y, width: w } = badgePositions[index];
    ctx.fillStyle = colors[badge.tone]; ctx.beginPath(); ctx.roundRect(x, y, w, 30, 3); ctx.fill();
    // Canvas "top" is a font baseline, not the glyph's painted top. Center the
    // actual ink bounds so CJK fallback glyphs and Latin labels both align.
    let size = 18;
    while (measure(badge.text, size, true) > w - 16 && size > 10) size -= .5;
    ctx.font = font(size, true); ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff';
    const ink = ctx.measureText(badge.text), fit = Math.min(1, (w - 16) / ink.width);
    ctx.fillText(badge.text,
      x + w / 2 + (ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) * fit / 2,
      y + 15 + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2, w - 16);
  });
  ctx.strokeStyle = colors.muted; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(364, titleCenterY - 6); ctx.lineTo(369, titleCenterY); ctx.lineTo(364, titleCenterY + 6); ctx.stroke();
  const drawDetail = (detail: Detail | null, x: number, y: number, max: number) => {
    if (!detail) return;
    let size = 17;
    while (measure(`${detail.label} ${detail.value}`, size) > max && size > 10) size -= .5;
    const labelWidth = measure(`${detail.label} `, size);
    drawText(detail.label, x, y, max, size, colors.muted);
    drawText(detail.value, x + labelWidth, y, max - labelWidth, size, colors[detail.tone]);
  };
  plan.metrics.forEach((metric, index) => {
    const x = index ? 256 : 24, max = index ? 120 : 220;
    drawText(metric.label, x, metricsY, max, 18, colors.strategy, true);
    drawText(metric.price, x, metricsY + 35, max, 28, colors[metric.tone], true);
    drawDetail(metric.detail, x, metricsY + 78, max);
  });
  plan.targets.forEach((target, index) => {
    const y = targetY + index * 75;
    let size = 20;
    while (measure(target.label, 18, true) + measure(` ${target.price}`, size, true) > 220 && size > 10) size -= .5;
    drawText(target.label, 24, y, 220, 18, colors.strategy, true);
    const labelWidth = measure(target.label, 18, true);
    drawText(` ${target.price}`, 24 + labelWidth, y - 1, 220 - labelWidth, size, colors.text, true);
    drawText(target.ratio, 256, y + 1, 120, 17, colors.muted);
    drawDetail(target.amount, 24, y + 32, 220);
    drawDetail(target.profit, 256, y + 32, 120);
  });
  noteRows.forEach((row, index) => drawText(row, 24, targetY + plan.targets.length * 75 + index * 24, 352, 16, colors.muted));
  return canvas.toDataURL('image/png');
}

export async function createExternalTradingReplyPlanAttachments(items: Array<{ id?: string; text?: string; __youleExecutionPlanPresentation?: unknown; __youleCloudReports?: any[] }>, language: string,
  save: (params: { dataUrl: string }) => Promise<any>) {
  // The caller supplies only this inbound message's scoped reply items. Generate
  // anew at delivery, including cached analysis replays; never reuse old PNGs.
  const images = items.filter(item => item.__youleExecutionPlanPresentation === 'execution-plan')
    .flatMap(item => externalTradingPlanCardMarkup({ cloudReports: item.__youleCloudReports, report: item.text }, language))
    .map(externalPlanImageSnapshot).filter((plan): plan is ExternalPlanImage => plan !== null);
  const attachments = [];
  for (const plan of images) {
    const file = await save({ dataUrl: await renderExternalTradingPlanImage(plan) });
    if (!file?.path || file.ok === false) throw new Error('PLAN_IMAGE_SAVE_FAILED');
    attachments.push({ name: file.name, mime: 'image/png', size: file.size, path: file.path, local_path: file.path });
  }
  return attachments;
}
