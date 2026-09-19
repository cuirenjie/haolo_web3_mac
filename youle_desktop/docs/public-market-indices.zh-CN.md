# 免费公开指数数据

“指数”分类使用公开只读接口，不需要用户注册、购买套餐或提供 API Key。

## 当前覆盖

| 来源 | 指数 | 历史窗口 |
| --- | --- | --- |
| Alternative.me | 恐惧与贪婪指数 FGI | 最近 31 个每日样本 |
| Binance | BTC/USDT、ETH/USDT 多空人数比 | 各自最近 169 个小时样本 |
| Binance | BTC/USDT、ETH/USDT 大户多空人数比 | 各自最近 169 个小时样本 |
| Binance | BTC/USDT、ETH/USDT 大户多空持仓比 | 各自最近 169 个小时样本 |

币安传统金融永续合约沿用“传统金融”分类的完整交易目录和现有 K 线。
上述 7 项指数为点值统计，点击显示历史折线，不把它们生成虚假的 OHLC K 线。

## 接口

- Alternative.me：`GET https://api.alternative.me/fng/?limit=31`。自行检查最新数据可以在浏览器打开 `https://api.alternative.me/fng/?limit=2`。
- Binance：`GET /futures/data/globalLongShortAccountRatio`、`/futures/data/topLongShortAccountRatio`、`/futures/data/topLongShortPositionRatio`。固定使用 `symbol=BTCUSDT/ETHUSDT`、`period=1h`、`limit=169`。
- [Alternative.me 官方说明及来源标注要求](https://alternative.me/crypto/fear-and-greed-index/#api)
- [Binance 官方文档](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio)

## 更新与异常

主进程通过 `marketData:getPublicIndices` 提供固定的数据集合；渲染进程不能指定请求 URL。币安请求继续使用现有网络路由、调度和只读路由白名单，Alternative.me 使用客户端网络通道。

进入交易界面即静默预加载指数，无需点击分类；可见的指数页每分钟刷新，其他分类下每 5 分钟保持缓存，窗口隐藏时暂停，销毁交易界面后停止。切换分类直接使用已加载的数据。传统金融目录也在图表初始化后自动加载，合约目录一到即显示，不等待现货目录。界面不显示加载提示或底部“来源／刷新”栏，单项指数和详情保留来源标注。

主进程合并并发请求，FGI 缓存 10 分钟，币安比值缓存 5 分钟；每批最多 3 个请求。自动网络模式下，旧行情网关对上述三个指数路径返回 404 时继续尝试 Binance，404 不再抢先覆盖正常直连结果；显式网关模式保持原行为。首次失败展示“暂不可用”；已有数据时保留原始数据时间并标记“更新延迟”，不会用 0 替代缺失值。FGI 超过 36 小时、币安样本超过 3 小时也会标为延迟。

24H 涨幅根据样本时间匹配 24 小时前的值，表示指数或比值自身的相对变化。基准样本缺失、间隔偏差过大或基准为 0 时展示 `--`。列表和历史窗口均保留可点击的来源标注。

无需在客户端输入 API Key。未来增加其他数据源时，独立核对其权限、频率和展示要求。
