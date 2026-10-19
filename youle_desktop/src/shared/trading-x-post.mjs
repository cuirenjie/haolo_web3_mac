export function normalizeXPostUrl(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com','mobile.x.com'].includes(url.hostname.toLowerCase())) return null;
    const match = /^\/(?:([a-zA-Z0-9_]{1,15})\/status|i\/web\/status)\/(\d{6,22})(?:\/(?:photo|video)\/\d+)?\/?$/.exec(url.pathname);
    if (!match) return null;
    return { id: match[2], handle: match[1] ?? '', url: `https://x.com/${match[1] ?? 'i/web'}/status/${match[2]}` };
  } catch { return null; }
}
