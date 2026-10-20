// Product name aliases, not an intent router. Availability is always checked
// against the live market catalog before opening a chart.
// Preserves all 59 historical aliases / 35 symbols from M1-269 and M1-270:
// haolo_windows_web3 d6c75c440419b5fc463ab5a79be9770e3414e107,
// youle_desktop/src/main/trading-analysis/request-routing-policy.mjs NAMED_ASSETS.
// Rechecked against origin/dev 8bb2262efe2ed294354e8919271fc53915e58b29.
export const TRADING_MARKET_ALIASES = Object.freeze([
  ["比特币", "BTCUSDT"], ["大饼", "BTCUSDT"],
  ["以太坊", "ETHUSDT"], ["以太", "ETHUSDT"],
  ["币安币", "BNBUSDT"], ["狗狗币", "DOGEUSDT"], ["瑞波币", "XRPUSDT"], ["索拉纳", "SOLUSDT"],
  ["布伦特原油", "BZUSDT"], ["布倫特原油", "BZUSDT"], ["布伦特", "BZUSDT"], ["布倫特", "BZUSDT"],
  ["WTI原油", "CLUSDT"], ["WTI", "CLUSDT"], ["美原油", "CLUSDT"], ["原油", "CLUSDT"],
  ["美光", "MUUSDT"], ["美光科技", "MUUSDT"],
  ["SKHYNIX", "SKHYNIXUSDT"], ["海力士", "SKHYNIXUSDT"], ["SK海力士", "SKHYNIXUSDT"],
  ["闪迪", "SNDKUSDT"], ["閃迪", "SNDKUSDT"],
  ["英伟达", "NVDAUSDT"], ["英偉達", "NVDAUSDT"], ["辉达", "NVDAUSDT"], ["輝達", "NVDAUSDT"],
  ["特斯拉", "TSLAUSDT"],
  ["黄金", "XAUUSDT"], ["黃金", "XAUUSDT"], ["白银", "XAGUSDT"], ["白銀", "XAGUSDT"],
  ["铂金", "XPTUSDT"], ["鉑金", "XPTUSDT"], ["钯金", "XPDUSDT"], ["鈀金", "XPDUSDT"],
  ["铜", "COPPERUSDT"], ["銅", "COPPERUSDT"], ["天然气", "NATGASUSDT"], ["天然氣", "NATGASUSDT"],
  ["英特尔", "INTCUSDT"], ["英特爾", "INTCUSDT"], ["罗宾汉", "HOODUSDT"], ["羅賓漢", "HOODUSDT"],
  ["微策略", "MSTRUSDT"], ["亚马逊", "AMZNUSDT"], ["亞馬遜", "AMZNUSDT"],
  ["帕兰泰尔", "PLTRUSDT"], ["帕蘭泰爾", "PLTRUSDT"],
  ["微软", "MSFTUSDT"], ["微軟", "MSFTUSDT"], ["博通", "AVGOUSDT"], ["阿里巴巴", "BABAUSDT"],
  ["摩根大通", "JPMUSDT"], ["西部数据", "WDCUSDT"], ["西部數據", "WDCUSDT"], ["太空探索", "SPCXUSDT"],
  ["伯克希尔", "BRKBUSDT"], ["伯克希爾", "BRKBUSDT"], ["苹果", "AAPLUSDT"], ["蘋果", "AAPLUSDT"],
  ["谷歌", "GOOGLUSDT"], ["Google", "GOOGLUSDT"], ["Alphabet", "GOOGLUSDT"],
  ["币安人生", "币安人生USDT"], ["幣安人生", "币安人生USDT"], ["龙虾", "龙虾USDT"], ["龍蝦", "龙虾USDT"],
].map(entry => Object.freeze(entry)));

const aliases = new Map(TRADING_MARKET_ALIASES.map(([name, symbol]) => [name.toUpperCase(), symbol]));
export function resolveTradingMarketAlias(value) {
  const name = String(value || "").replace(/\s+/g, "").toUpperCase();
  return aliases.get(name) || null;
}
