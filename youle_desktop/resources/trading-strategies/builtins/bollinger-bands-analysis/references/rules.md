# Bollinger Bands deterministic rules v1

## Formula and completion

- Defaults: period 20, simple moving average, multiplier 2.
- `middle = SMA(close, 20)`.
- `upper = middle + 2 × population standard deviation(close, 20)`.
- `lower = middle − 2 × population standard deviation(close, 20)`.
- `BandWidth = (upper − lower) / middle`; `%B = (close − lower) / (upper − lower)`.
- Only closed candles participate. The current live candle is excluded from state, pattern, drawing, and execution confirmation.

## Interpretation

- Upper/lower bands define relative high/low. A tag is not by itself a sell/buy signal.
- 单次触轨只代表相对高低，不得直接解释成超买、超卖、反转或下单信号。
- A close outside a band is initially continuation evidence, not an automatic reversal.
- A squeeze is low BandWidth relative to its own bounded history. It anticipates a volatility expansion but has no direction before a confirmed breakout.
- A band walk requires repeated closes in the outer half of the bands, repeated proximity to the same outer band, and a middle-band slope in the same direction.
- BandWidth expansion without a confirmed price event is descriptive only.

## Confirmed structures

- Squeeze breakout: BandWidth was recently at or below the 20th percentile of its lookback, then expands and two consecutive closed candles finish beyond the same outer band. The second close is the confirmation point.
- Head fake: after a squeeze, a closed candle breaks one outer band, then within three closed candles returns inside and closes through the middle band in the opposite direction.
- M top: two confirmed high pivots separated by a confirmed intervening low. The first high tags/exceeds the upper band, the second high is comparable or higher in price but remains below its upper band, and a later closed candle breaks the intervening low.
- W bottom: two confirmed low pivots separated by a confirmed intervening high. The first low tags/breaks the lower band, the second low is comparable or lower in price but remains above its lower band, and a later closed candle breaks the intervening high.
- M 顶与 W 底都必须由右侧 K 线确认摆动点，并由已收盘 K 线完成颈线确认。
- Pivots require right-side candles. A developing second top/bottom without the neckline break is reported as forming, not executable.

## Execution

- All scenarios remain `wait` until a closed price condition is satisfied.
- Confirmed bullish/bearish breakout: trigger is the confirmation close/outer-band boundary, invalidation is the opposite side of the squeeze range, and targets are 1R/2R.
- Confirmed W/M pattern: trigger is the neckline break, invalidation is the second pivot extreme, and targets are 1R/2R.
- Band walk: do not chase the band. Wait for a pullback to the middle/inner area and a closed reclaim/rejection before any price plan.
- Squeeze without direction and no-pattern states have no fabricated entry, stop, or targets.
- Plans expire after four current-period bars and cancel on opposite-band confirmation, a close through the structural invalidation, stale data, or loss of required candle coverage.

## Knowledge boundary

These rules follow John Bollinger's official definitions: tags are not signals, prices may walk a band, outside closes are initially continuation signals, traditional bands use SMA, %B describes relative location, and BandWidth identifies squeezes. They do not prove future direction or guarantee a trade outcome.
