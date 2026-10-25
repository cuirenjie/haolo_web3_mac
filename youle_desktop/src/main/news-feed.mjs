import fs from 'node:fs';
import path from 'node:path';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validNewsItem(item) {
  return item && uuid(item.id) && uuid(item.articleId) && Number.isSafeInteger(item.sequence) && item.sequence > 0
    && typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 160
    && typeof item.summary === 'string' && item.summary.length <= 400;
}
export function newsArticleUrl(id, locale = 'zh-CN') {
  if (!uuid(id)) throw new Error('NEWS_ID_INVALID');
  locale = /^en(?:-|$)/i.test(locale) ? 'en' : /^ko(?:-|$)/i.test(locale) ? 'ko' : /^zh-(?:TW|Hant)(?:-|$)/i.test(locale) ? 'zh-Hant' : 'zh-CN';
  return `https://haolo.com/api/news/read/${encodeURIComponent(id)}?lang=${encodeURIComponent(['zh-CN','zh-Hant','en','ko'].includes(locale) ? locale : 'zh-CN')}`;
}

// Public articles only. Persist the queue before advancing its cursor, and only
// remove a popup after an explicit click/close. App shutdown is not dismissal.
export function createNewsFeed({ file, fetchFeed, changed, intervalMs = 30000 }) {
  let state = { cursor: 0, pending: [] }, timer, inFlight, stopped = true;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(saved.cursor) || saved.cursor < 0 || !Array.isArray(saved.pending) || saved.pending.some(item => !validNewsItem(item))) throw new Error('NEWS_STATE_INVALID');
    state = { cursor: saved.cursor, pending: saved.pending };
  } catch (error) { if (error.code !== 'ENOENT') console.warn('[news] queue recovery failed'); }
  function save(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    state = next;
  }
  function publish() { if (!stopped) changed([...state.pending]); }
  async function poll() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      if (state.pending.length >= 200) return;
      const reply = await fetchFeed(state.cursor);
      if (stopped) return;
      if (!Array.isArray(reply.items) || reply.items.length > 50 || !Number.isSafeInteger(reply.nextCursor) || reply.nextCursor < state.cursor) throw new Error('NEWS_FEED_INVALID');
      let cursor = state.cursor;
      for (const item of reply.items) {
        if (!validNewsItem(item) || item.sequence <= cursor || item.sequence > reply.nextCursor) throw new Error('NEWS_FEED_INVALID');
        cursor = item.sequence;
      }
      if (reply.items.length && cursor !== reply.nextCursor) throw new Error('NEWS_FEED_INVALID');
      const known = new Set(state.pending.map(item => item.id));
      save({ cursor: reply.nextCursor, pending: [...state.pending, ...reply.items.filter(item => !known.has(item.id))] });
      publish();
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  function schedule() { if (stopped) return; timer = setTimeout(async () => { try { await poll(); } catch { /* Retry without consuming the cursor. */ } finally { schedule(); } }, intervalMs); timer.unref?.(); }
  return {
    start() { if (!stopped) return; stopped = false; publish(); void poll().catch(() => {}); schedule(); },
    stop() { stopped = true; clearTimeout(timer); },
    refresh: poll,
    dismiss(id) { save({ ...state, pending: state.pending.filter(item => item.id !== id) }); publish(); },
    snapshot: () => ({ cursor: state.cursor, pending: [...state.pending] }),
  };
}
