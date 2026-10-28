import { vietnameseText } from '../shared/vietnamese.mjs';
import { withKoreanVariants } from '../shared/korean.mjs';
import QRCode from 'qrcode';
import { cloudPlanCard } from '../main/cloud-plan-contract.mjs';
import { executionPlanCardHeading, executionPlanCardBody } from '../main/execution-plan-card-view.mjs';
import { executionPlanDisplayLines, executionPlanBinanceMarketDetails, type ExecutionPlanCandidate } from './execution-plans.ts';
import { createPlanDialog, planMenuText } from './execution-plan-menu.ts';

export type PlanShareSnapshot = { title: string; venue: string; badges: string[]; entry: string; stop: string; targets: Array<{price: string; ratio: string}>; expiresAt: number | null; long: boolean };
type Invitation = {id: string; code: string; url: string};
const copy = withKoreanVariants({
  'zh-CN': ['入场触发价','止损价','第{n}止盈','盈亏比','有效至','交易迷茫用HaoLo','官网下载：haolo.com','邀请二维码','复制图片','保存图片','正在准备计划图片…','请先在邀请中心设置邀请链接。','打开邀请中心','重试','图片已复制','图片已保存','准备分享失败，请重试'],
  'zh-TW': ['入場觸發價','止損價','第{n}止盈','盈虧比','有效至','交易迷茫用HaoLo','官網下載：haolo.com','邀請二維碼','複製圖片','儲存圖片','正在準備計畫圖片…','請先在邀請中心設定邀請連結。','開啟邀請中心','重試','圖片已複製','圖片已儲存','準備分享失敗，請重試'],
  en: ['Entry trigger','Stop loss','Take profit {n}','R/R','Valid until','Trade with clarity. HaoLo.','Download: haolo.com','Invitation QR code','Copy image','Save image','Preparing plan image…','Set up an invitation link in the invitation center first.','Invitation center','Retry','Image copied','Image saved','Unable to prepare sharing. Try again.'],
});
const words = (language: string) => copy[language as keyof typeof copy] || copy['zh-CN'];

// Explicit presentation allowlist: never export account sizing, balances, PnL,
// raw reports, source conversation IDs or authenticated URLs.
export function planShareSnapshot(candidate: ExecutionPlanCandidate, language: string): PlanShareSnapshot {
  const host = document.createElement('div');
  host.innerHTML = candidate.cloudReport ? cloudPlanCard(candidate.cloudReport, {language})?.html || ''
    : executionPlanCardHeading(candidate.title, executionPlanDisplayLines(candidate.content), language)
      + executionPlanCardBody(executionPlanDisplayLines(candidate.content), language);
  const text = (selector: string) => host.querySelector(selector)?.textContent?.trim() || '';
  const prices = [...host.querySelectorAll('.execution-plan-price')].map(node => node.textContent?.trim() || '');
  if (prices.length !== 2) throw new Error('PLAN_SHARE_UNAVAILABLE');
  const remote = candidate.cloudReport?.planRecords[0];
  const expiry = Number(remote?.expiresAt ?? candidate.cloudReport?.executionPlan.entryCondition?.expiresAt);
  const market = candidate.cloudReport?.marketId || `BINANCE:FUTURES:${executionPlanBinanceMarketDetails(candidate).symbol || ''}`;
  const symbol = market.split(':').at(-1) || '';
  const pair = symbol.replace(/(USDT|USDC|BUSD)$/, '/$1');
  const interval = text('.execution-plan-heading h2').split(' · ')[1] || /(?:永续|永續|perpetual)\s+(\d+[mhdw])/i.exec(candidate.title)?.[1] || '';
  const venue = market.startsWith('BINANCE:') ? (market.includes(':FUTURES:')
    ? language === 'vi' ? vietnameseText("Binance 無期限先物") : language === 'ja' ? 'Binance 無期限先物' : language === 'ko' ? '바이낸스 무기한 선물' : language === 'en' ? 'Binance Perpetual' : language === 'zh-TW' ? '幣安永續' : '币安永续'
    : language === 'vi' ? vietnameseText("Binance 現物") : language === 'ja' ? 'Binance 現物' : language === 'ko' ? '바이낸스 현물' : language === 'en' ? 'Binance Spot' : language === 'zh-TW' ? '幣安現貨' : '币安现货') : market.split(':')[0];
  return Object.freeze({ title: `${pair} · ${interval}`, venue,
    badges: [...host.querySelectorAll('.execution-plan-badge')].map(node => node.textContent?.trim() || ''),
    entry: prices[0], stop: prices[1], long: host.querySelector('.execution-plan-price')?.classList.contains('bullish') === true,
    targets: [...host.querySelectorAll('.execution-plan-target')].map(node => ({
      price: node.querySelector('.execution-plan-target-main strong')?.textContent?.trim() || '',
      ratio: node.querySelector('.execution-plan-ratio')?.textContent?.trim() || '',
    })), expiresAt: Number.isFinite(expiry) && expiry > 0 ? expiry : null });
}

export async function renderPlanShareImage(plan: PlanShareSnapshot, link: Invitation, language: string) {
  const t = words(language), canvas = document.createElement('canvas');
  canvas.width = 1220; canvas.height = 1290 + Math.max(0, plan.targets.length - 3) * 90;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.fillStyle = '#202124'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const text = (value: string, x: number, y: number, width: number, size: number, color = '#f7f8fa', bold = false) => {
    ctx.font = `${bold ? 700 : 400} ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    while (ctx.measureText(value).width > width && size > 20) ctx.font = `${bold ? 700 : 400} ${--size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = color; ctx.textBaseline = 'top'; ctx.fillText(value, x, y, width);
  };
  text(plan.title, 64, 64, 1092, 64, undefined, true);
  text(plan.badges.join('   '), 64, 155, 1092, 38, '#d6a744');
  text(plan.venue, 64, 215, 1092, 30, '#c1c6ce');
  text(t[0], 64, 280, 680, 42); text(t[1], 810, 280, 346, 42);
  text(plan.entry, 64, 350, 680, 66, plan.long ? '#7ae3a2' : '#ff7f9f', true);
  text(plan.stop, 810, 350, 346, 66, plan.long ? '#ff7f9f' : '#7ae3a2', true);
  if (plan.expiresAt) text(`${t[4]} ${new Date(plan.expiresAt).toLocaleString(language, {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}`, 64, 460, 1092, 30, '#c1c6ce');
  plan.targets.forEach((target, index) => {
    text(`${t[2].replace('{n}', String(index + 1))}: ${target.price}`, 64, 570 + index * 90, 700, 42, undefined, true);
    text(target.ratio, 810, 575 + index * 90, 346, 32, '#c1c6ce');
  });
  const footerY = canvas.height - 350;
  text(t[5], 64, footerY + 35, 780, 48, undefined, true);
  text(t[6], 64, footerY + 125, 780, 32, '#c1c6ce');
  const qr = new Image();
  qr.src = await QRCode.toDataURL(link.url, {width: 240, margin: 2, errorCorrectionLevel: 'M'});
  await qr.decode();
  ctx.drawImage(qr, 916, footerY, 240, 240);
  text(t[7], 916, footerY + 256, 240, 26, '#c1c6ce');
  return canvas.toDataURL('image/png');
}

export async function showPlanShare(candidate: ExecutionPlanCandidate, language: string, deps: {
  valid(): boolean; verify(id?: string): Promise<Invitation>;
  copy(dataUrl: string): Promise<unknown>; save(dataUrl: string): Promise<boolean>; setup(): void;
}) {
  const snapshot = planShareSnapshot(candidate, language), t = words(language);
  const dialog = createPlanDialog(planMenuText('share', language), 'execution-plan-share-dialog');
  const title = document.createElement('h2'); title.textContent = planMenuText('share', language);
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const image = document.createElement('img'); image.className = 'execution-plan-share-preview'; image.alt = snapshot.title; image.hidden = true;
  const footer = document.createElement('footer');
  dialog.append(title, status, image, footer);
  let link: Invitation | undefined, dataUrl = '', busy = false;
  const valid = () => dialog.isConnected && deps.valid();
  const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = action; footer.append(b); return b; };
  const close = button(planMenuText('close', language), () => dialog.close());
  const retry = button(t[13], () => { void load(); }); retry.hidden = true;
  const setup = button(t[12], deps.setup); setup.hidden = true;
  const copyButton = button(t[8], () => { void exportImage('copy'); });
  const saveButton = button(t[9], () => { void exportImage('save'); });
  const toggle = () => { copyButton.disabled = saveButton.disabled = busy || !dataUrl; retry.disabled = busy; };
  const fail = (error: unknown) => {
    retry.hidden = false;
    dataUrl = ''; image.hidden = true; setup.hidden = !/INVITATION_SETUP_REQUIRED|referral_wallet_required/.test(String(error));
    status.textContent = setup.hidden ? t[16] : t[11];
  };
  async function load() {
    if (busy || !valid()) return;
    busy = true; status.textContent = t[10]; setup.hidden = true; retry.hidden = true; toggle();
    try {
      const verified = await deps.verify(link?.id); if (!valid()) return;
      dataUrl = await renderPlanShareImage(snapshot, verified, language); if (!valid()) return;
      link = verified; image.src = dataUrl; image.hidden = false; status.textContent = '';
    } catch (error) { if (valid()) fail(error); }
    finally { busy = false; toggle(); if (!deps.valid() && dialog.isConnected) dialog.close(); }
  }
  async function exportImage(action: 'copy' | 'save') {
    if (busy || !dataUrl || !link || !valid()) return;
    busy = true; toggle();
    try {
      const verified = await deps.verify(link.id); if (!valid()) return;
      if (verified.url !== link.url) { dataUrl = await renderPlanShareImage(snapshot, verified, language); if (!valid()) return; image.src = dataUrl; link = verified; }
      if (action === 'copy') { await deps.copy(dataUrl); if (valid()) status.textContent = t[14]; }
      else if (await deps.save(dataUrl)) { if (valid()) status.textContent = t[15]; }
    } catch (error) { if (valid()) fail(error); }
    finally { busy = false; toggle(); if (!deps.valid() && dialog.isConnected) dialog.close(); }
  }
  close.focus(); await load();
}
