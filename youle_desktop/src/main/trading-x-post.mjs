import { normalizeXPostUrl } from '../shared/trading-x-post.mjs';

const cache = new Map();
async function jsonResponse(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > 1_000_000) throw new Error('Response too large');
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error('Response too large');
  return JSON.parse(text);
}

export async function getTradingXPost(value, { fetchImpl = fetch } = {}) {
  const post = normalizeXPostUrl(value);
  if (!post) throw new Error('只能添加 X / Twitter 帖子链接');
  const saved = cache.get(post.id);
  if (saved && Date.now() - saved.time < 300000) return saved.value;
  let result;
  try {
    // Public embed metadata used by X's embedded-post widget. This is a
    // deterministic embed token, not an account/API credential.
    const token = (Number(post.id) / 1e15 * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    const data = await jsonResponse(fetchImpl, `https://cdn.syndication.twimg.com/tweet-result?id=${post.id}&lang=zh-cn&token=${token}`);
    if (String(data.id_str) !== post.id || typeof data.text !== 'string' || !data.user?.screen_name) throw new Error('Post unavailable');
    const avatar = String(data.user.profile_image_url_https ?? '');
    result = { url: post.url, authorName: String(data.user.name ?? '').slice(0,100), handle: String(data.user.screen_name).slice(0,30),
      body: data.text.slice(0,12000), createdAt: String(data.created_at ?? ''),
      avatarUrl: /^https:\/\/pbs\.twimg\.com\/profile_images\//.test(avatar) ? avatar : '' };
  } catch {
    try {
      const data = await jsonResponse(fetchImpl, `https://publish.twitter.com/oembed?url=${encodeURIComponent(post.url)}&omit_script=true&dnt=true`);
      if (typeof data.html !== 'string' || !data.author_name) throw new Error('Post unavailable');
      result = { url: post.url, authorName: String(data.author_name).slice(0,100), handle: post.handle,
        html: data.html.slice(0,40000), createdAt: new Date(Number((BigInt(post.id) >> 22n) + 1288834974657n)).toISOString(), avatarUrl: '' };
    } catch { throw new Error('无法读取该帖子，请检查链接或网络后重试'); }
  }
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(post.id, { time: Date.now(), value: result });
  return result;
}
