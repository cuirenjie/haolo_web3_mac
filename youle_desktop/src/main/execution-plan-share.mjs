import { vietnameseText } from '../shared/vietnamese.mjs';
import fs from 'node:fs/promises';
// Same ownership and public-resolution contract as mobile invitation_share.dart.
export function parsePlanInvitation(row) {
  if (row?.status !== 'active' || typeof row.id !== 'string' || !row.id
    || typeof row.code !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(row.code) || typeof row.url !== 'string' || row.url.length > 512) return null;
  try {
    const url = new URL(row.url), keys = [...url.searchParams.keys()];
    if (url.protocol !== 'https:' || !['haolo.com', 'www.haolo.com'].includes(url.hostname)
      || url.port || url.username || url.password || url.pathname !== '/' || url.hash || keys.length !== 2
      || url.searchParams.getAll('invite').length !== 1 || url.searchParams.get('invite') !== row.code
      || url.searchParams.getAll('referral_token').length !== 1
      || !/^[A-Za-z0-9_-]{1,128}$/.test(url.searchParams.get('referral_token') || '')) return null;
    return {id: row.id, code: row.code, url: row.url};
  } catch { return null; }
}
export async function verifyPlanInvitation(client, id) {
  await client.load(); client.requireAuth();
  const revision = client.authRevision;
  const check = () => { if (revision !== client.authRevision) throw new Error('SESSION_CHANGED'); client.requireAuth(); };
  const result = await client.requestJson(new URL('/api/referrals/me/links', client.baseUrl).href, {
    method: 'GET', headers: client.clientHeaders({auth: true}),
  });
  check();
  if (!Array.isArray(result?.items)) throw new Error('INVITATION_UNAVAILABLE');
  const links = result.items.map(parsePlanInvitation).filter(Boolean);
  const selectedId = id || links[0]?.id;
  if (!selectedId) throw new Error('INVITATION_SETUP_REQUIRED');
  const matches = links.filter(link => link.id === selectedId);
  if (matches.length !== 1) throw new Error('INVITATION_UNAVAILABLE');
  const link = matches[0], token = new URL(link.url).searchParams.get('referral_token');
  const resolve = new URL('/api/referrals/public/resolve', client.baseUrl);
  resolve.searchParams.set('invite_code', link.code); resolve.searchParams.set('referral_token', token);
  const response = await client.requestJson(resolve.href, {method: 'GET', headers: client.clientHeaders({auth: false})});
  check();
  if (response?.valid !== true || response.invite_code !== link.code || response.referral_token !== token) throw new Error('INVITATION_UNAVAILABLE');
  return link;
}

export async function savePlanShareImage({dataUrl, window, dialog, language, valid = () => true}) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 16_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error('INVALID_PLAN_IMAGE');
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('INVALID_PLAN_IMAGE');
  const result = await dialog.showSaveDialog(window, {
    title: language === 'vi' ? vietnameseText("取引計画の画像を保存") : language === 'ja' ? '取引計画の画像を保存' : language === 'ko' ? '계획 이미지 저장' : language === 'en' ? 'Save plan image' : language === 'zh-TW' ? '儲存計畫圖片' : '保存计划图片',
    defaultPath: `HaoLo-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    filters: [{name: 'PNG', extensions: ['png']}],
  });
  if (result.canceled || !result.filePath || !valid()) return {saved: false};
  await fs.writeFile(result.filePath, bytes);
  return {saved: true};
}
