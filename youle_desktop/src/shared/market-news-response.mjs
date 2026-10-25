// News data is external content, including attributes and vote responses.
const fail = () => { throw Error('INVALID_NEWS_RESPONSE'); };
const text = value => typeof value === 'string';
const count = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && /^\d{1,20}$/.test(value);

export function normalizeNewsVote(value, expectedId) {
  if (!value || value.id !== expectedId || !id(value.id)
    || ![-1, 0, 1].includes(value.vote) || !count(value.bullish) || !count(value.bearish)) fail();
  return { id: value.id, vote: value.vote, bullish: value.bullish, bearish: value.bearish };
}

export function normalizeNewsItem(value) {
  if (!value || !id(value.id) || !text(value.title) || !text(value.content)
    || !Number.isFinite(value.timestamp) || value.timestamp < 0
    || !Number.isFinite(new Date(value.timestamp * 1000).getTime()) || !Array.isArray(value.markets)) fail();
  const votes = normalizeNewsVote(value, value.id);
  const markets = value.markets.map(market => {
    if (!market || !['coin', 'quote', 'symbol', 'venue', 'marketType'].every(key => text(market[key]))
      || !(market.changePercent === null || Number.isFinite(market.changePercent))) fail();
    return { coin: market.coin, quote: market.quote, symbol: market.symbol, venue: market.venue,
      marketType: market.marketType, changePercent: market.changePercent };
  });
  return { ...votes, title: value.title, content: value.content, timestamp: value.timestamp,
    important: value.important === true, source: '', url: '', markets };
}
