# Windows / 移动端新任务自动共享手绘（MOB-034）

2026-10-03 用户修正：只有“新任务”中的手工画线按账号和市场自动共享，不要求选同一个任务。已移除工具栏共享任务入口、选择弹窗、UUIDv5会话映射、显式绑定和切换市场专用事件。两端本地任务ID可以不同，例：Windows新任务币安USDM ETH/USDT画线，移动新任务打开同市场自动显示。

main.ts 使用真实 isBlankNewThread 状态，trading-expert-market.ts 传给主图、指标副图和分屏。进入历史或首轮对话时关闭自动共享，原生会话存储保留当时手绘；历史任务编辑不上传共享画布，重新进入新任务恢复账号对应市场。同步不复制Codex聊天、AI结果或历史任务。原几何、多次落点和74种工具保持。

renderer/manual-drawing-sync.ts 保留逐图形副本和离线outbox；本机缓存键含账号 / 市场 / 本地写入实例 / scope，网络请求只含市场，没有任务编号。跨新任务缓存复用不改变编辑时间，未打开的旧新任务outbox在前台续传；旧显式任务绑定和旧历史缓存不会批量汇入共享画布。新任务旧本机线仅按原账号低优先级迁移，云端墓碑优先。

main/manual-drawing-sync.mjs 仅支持session/read/write，经主进程鉴权访问固定 /api/mobile/v1/new-task/manual-sync。Token不进入Renderer。schemaVersion4，UTC毫秒；逐图形比较changedAt / changeId，修改和删除采用相同规则，独立新增合并。冻结幂等正文跨重启重试，回执后再读当前云端；非法未来时钟明确拒绝后才能校正。

市场规范：BINANCE:FUTURES→binance:usdm，SPOT独立，交易所和类型不同不混线；indicator:macd→indicator:MACD。共享市场跨周期显示，面板按scope过滤。后台自动指用户无需选择，客户端前台约5秒轮询 / 编辑350ms去抖；离线及操作系统挂起不保证实时，设备时钟有精度边界。

验证：自动共享、不同任务ID、修改 / 删除、ETH / BTC / 现货隔离、历史冻结、迟到响应、账号隔离、时钟与幂等专项通过；TypeScript及Vite构建通过。原绘图及会话相关套件55项通过，1项既有AI分屏正则失败（HEAD同样不匹配），未扩改该逻辑。移动相关101项通过，后端87项通过。详见移动 docs/PROJECT_MEMORY.md 本日MOB-034追加及backend合约。

当前为本地代码和构建验证。生产需部署新接口并更新两端；本轮未部署后端、未生成Windows安装器、未提交 / 推送，未宣称生产双端联调通过。
