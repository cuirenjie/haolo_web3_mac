// Explicit cloud null means "restore the shared theme-aware color". Missing
// cloud fields continue using the existing local defaults, without migration.
const palettes = {
  blue: ['#2568c4', '#62a5ff'], yellow: ['#986800', '#ffc342'], purple: ['#9956b3', '#dd90ed'],
  green: ['#168572', '#42d4b0'], red: ['#ce4053', '#fa8190'], teal: ['#1fc5a7', '#40d9bd'],
  orange: ['#ffb400', '#ffc342'], bar: ['#2eb35b', '#2eb35b'], vpvr: ['#5b95e5', '#5b95e5'],
};
const lines: Record<string, Record<string, keyof typeof palettes>> = {
  'main:ma': { short: 'blue', medium: 'yellow', long: 'purple', extraLong: 'green', ultraLong: 'red' },
  'main:ema': { short: 'blue', medium: 'yellow', long: 'purple', extraLong: 'green', ultraLong: 'red' },
  'main:boll': { upper: 'blue', middle: 'yellow', lower: 'purple' },
  'main:td': { buy: 'green', sell: 'red' }, 'main:bbi': { bbi: 'blue' },
  'main:vpvr': { volume: 'vpvr', poc: 'vpvr' },
  'sub:volume': { volume: 'bar', ma5: 'teal', ma10: 'orange' },
  'sub:macd': { histogram: 'bar', dif: 'teal', dea: 'orange' },
  'sub:rsi': { rsi: 'blue' }, 'sub:obv': { obv: 'blue' },
  'sub:kdj': { k: 'blue', d: 'yellow', j: 'purple' },
  'sub:adx': { positiveDi: 'blue', negativeDi: 'yellow', adx: 'purple' },
};
export function sharedDefaultIndicatorColor(key: string, dark: boolean) {
  const match = /^indicator\.([^.]+)\.series\.([^.]+)\.color$/.exec(key);
  const palette = match && lines[match[1]]?.[match[2]];
  return palette ? palettes[palette][dark ? 1 : 0] : null;
}
