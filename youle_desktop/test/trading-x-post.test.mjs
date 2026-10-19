import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeXPostUrl } from '../src/shared/trading-x-post.mjs';
import { getTradingXPost } from '../src/main/trading-x-post.mjs';

const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const metadata = id => ({ id_str: id, text: '真实帖子正文 <script>只是文字</script>', created_at: '2026-10-19T05:56:05Z',
  user: { name: 'dragon', screen_name: 'dragono64v', profile_image_url_https: 'https://pbs.twimg.com/profile_images/123/avatar.jpg' } });

test('X and legacy Twitter links normalize to an individual post, dropping tracking and media suffixes', () => {
  for (const host of ['x.com', 'www.x.com', 'twitter.com', 'mobile.twitter.com']) {
    assert.deepEqual(normalizeXPostUrl(`https://${host}/dragon/status/2112060195304354041/photo/1?s=20#photo`), {
      id: '2112060195304354041', handle: 'dragon', url: 'https://x.com/dragon/status/2112060195304354041',
    });
  }
  assert.equal(normalizeXPostUrl('https://x.com/i/web/status/2112060195304354041').handle, '');
});

test('Other platforms, profile pages, spoofed hosts, credentials and unsafe schemes never reach the network', async () => {
  for (const url of ['https://example.com/dragon/status/123456', 'https://x.com.evil.test/dragon/status/123456',
    'https://x.com@evil.test/dragon/status/123456', 'https://user:pass@x.com/dragon/status/123456',
    'http://x.com/dragon/status/123456', 'javascript:alert(1)', 'https://x.com/dragon',
    'https://x.com/dragon/status/not-a-number', 'https://x.com:8080/dragon/status/123456']) {
    assert.equal(normalizeXPostUrl(url), null, url);
    await assert.rejects(getTradingXPost(url, { fetchImpl: () => assert.fail('invalid link fetched') }), /只能添加/);
  }
});

test('Public post data is read from the fixed embed endpoint and cached across tracking URLs', async () => {
  const id = '2112060195304354001'; let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(new URL(url).origin, 'https://cdn.syndication.twimg.com');
    assert.equal(new URL(url).searchParams.get('id'), id);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return response(metadata(id));
  };
  const post = await getTradingXPost(`https://x.com/dragon/status/${id}`, { fetchImpl });
  assert.equal(post.authorName, 'dragon'); assert.equal(post.body, metadata(id).text);
  assert.equal(post.avatarUrl, metadata(id).user.profile_image_url_https);
  assert.deepEqual(await getTradingXPost(`https://twitter.com/dragon/status/${id}?s=20`, { fetchImpl }), post);
  assert.equal(calls, 1);
});

test('Wrong post IDs cannot supply a card; the official oEmbed fallback remains available', async () => {
  const id = '2112060195304354002'; const urls = [];
  const post = await getTradingXPost(`https://x.com/dragon/status/${id}`, { fetchImpl: async url => {
    urls.push(url);
    return urls.length === 1 ? response(metadata('999999')) : response({ author_name: 'dragon', html: '<blockquote><p>Fallback text</p></blockquote>' });
  } });
  assert.equal(new URL(urls[1]).origin, 'https://publish.twitter.com');
  assert.ok(post.html.includes('Fallback text')); assert.equal(post.body, undefined);
  assert.ok(Number.isFinite(Date.parse(post.createdAt)));
});

test('Arbitrary external avatar URLs are discarded', async () => {
  const id = '2112060195304354003', data = metadata(id);
  data.user.profile_image_url_https = 'https://evil.test/avatar.jpg';
  assert.equal((await getTradingXPost(`https://x.com/dragon/status/${id}`, { fetchImpl: async () => response(data) })).avatarUrl, '');
});

test('Missing, private, oversized or unreachable posts report failure without inventing card content', async () => {
  const attempts = [async () => new Response('{}', { status: 404 }), async () => response({}),
    async () => new Response('{}', { headers: { 'content-length': '1000001' } }), async () => { throw new Error('offline'); }];
  for (const [index, fetchImpl] of attempts.entries()) {
    await assert.rejects(getTradingXPost(`https://x.com/dragon/status/21120601953043540${10 + index}`, { fetchImpl }), /无法读取该帖子/);
  }
});
