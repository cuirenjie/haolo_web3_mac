# 传统金融图标与关注列表（2026-10-26）

关注列表增加 KORU、SPCX、TSLA，共 11 个 USDT 永续推荐项，沿用紧凑布局与逐项添加、移除交互。

## 原图与统一入口

- 来源：币安 `https://www.binance.com/en/markets/tradfi` 股票列表和公开合约图标接口；股票页已核对的 31 个文件名优先于合约图标，包含截图中的全部 10 个品牌。SPCX 使用完整 SpaceX 字标。
- 下载并内置 227 张原始 PNG/JPEG，覆盖抓取时全部 224 个传统金融合约标的；另有股票页补充标的及 XAUT。原始文件共约 2.03 MB，不重绘、不改色、不改变原图像素。
- `src/renderer/assets/binance-tradfi/sources.json` 记录每个文件的公开来源与 SHA-256；`scripts/sync-binance-tradfi-logos.mjs` 可刷新资源和生成 TypeScript URL 映射。股票页文件名变动需核对后更新脚本中的映射。
- `renderTradingMarketAssetLogo` 统一服务主图、分屏、市场搜索、自选/推荐、预警；Finnhub 同品牌也使用相同图标。97 个明确的 bStocks 别名指向其标的品牌。
- 已收录图片优先离线加载，失败后使用相同官方源；未知股票尝试币安股票静态目录，缺失时保留本地兜底。A 股和没有对应官方资源的指数保持原标识。
- 图片加载缓存按实际来源区分，避免同名加密资产与股票串图；原油 CL 与 Colgate 的 CL 股票按资产类别区分。

## 验收

- 类型检查、前端生产构建、客服知识包生成通过。
- 自选/星标同步/布局/图标专项单元测试 83 项通过；传统金融原图与兜底专项 1 项通过。
- 图标 Electron 验收 13 项通过：227 张内置图片解码、明暗主题、刷新复用、分组/排序、主图/分屏、搜索、故障恢复、同名资产隔离。
- 关注列表 Electron 验收通过：11 项、添加/撤销/持久化、中英繁韩、280/330 宽度、小窗口大字体滚动与键盘焦点。
- 扩展运行完整指标测试文件时，其导入 `trading-expert-market.ts` 的现有链路加载 `market-news.css`，原生 Node 报 `ERR_UNKNOWN_FILE_EXTENSION`。本任务未修改该链路；图标专项及 Electron 浏览器集成验收通过。
- 截图及日志：`output/tradfi-icons-20261026/`。尚未打包、签名或发布安装包。
