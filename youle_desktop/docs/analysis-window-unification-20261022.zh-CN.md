# M1-454：Windows／移动官方策略历史窗口统一

2026-10-22，用户已确认并完成本地实现、自动化验收与 Android 覆盖安装。生产 API／Worker 和 Windows 发布包尚未更新。

## 生效规则

| 策略 | 后端默认历史上限 |
|---|---:|
| 订单流 | 200 根 |
| 均线、MACD、BOLL、RSI、KDJ、ICT／SMC、SMT | 500 根 |
| 裸 K、缠论、波浪、威科夫、谐波、图表形态、道氏、江恩 | 600 根 |
| VPVR | 用户提交的精确可见范围，20–600 根 |

移动端保留的趋势带入口同为 500 根。波浪后续自适应多周期历史、订单流真实成交与盘口数据采集均维持现有逻辑。

两端普通策略只提交 `analysisStrategy`，不从可见 K 线数、缩放、图表缓存或客户端策略表推算默认条数。Windows 分屏、捕获的旧目标、脱离图表入口与后台自动分析均沿用该规则；个人自定义策略本地取数维持原协议。`limit=600` 是兼容传输上限，后端实际按策略取 200／500／600 根，再冻结所选窗口。

显式 `windowCount`／`lookbackMs` 保留，时间范围优先；Windows 显式根数仍遵守原有最低准入数。新上市标的可少于默认上限，但不得绕过既有最低 K 线／已收盘 K 线要求。VPVR 仍要求精确起止时间，不得使用普通策略范围参数混入。

## 实现与兼容

- 后端 `app/mobile/analysis_window_policy.py` 为唯一默认映射。`trading-capabilities.strategies[].analysisWindow` 发布版本、策略及默认窗口，与 `history` 最低准入要求分开。
- `/market-snapshots?analysisStrategy=...` 要求登录、校验官方策略及范围；普通历史分页与不带新参数的旧客户端保留原行为。
- 冻结快照 `analysisWindow.policy` 保存版本、策略、模式和默认数，参与内容哈希。排队刷新沿用提交时的规则，不使用等待后新部署的默认值；付费后的恢复仍受原有私有检查点保护。
- 新协议中的短历史／显式根数不再触发旧 Windows 威科夫 240 根兼容扩展；无 policy 的旧任务继续原行为。未知 POST 结果重试复用原请求体、snapshotId 和幂等键，缩放变化不重取行情。
- 后续发布建议：先更新兼容旧快照的新 Worker，再更新 API，最后启用新客户端，并分别检查运行文件和新默认窗口。不能仅凭客户端已安装宣称后端规则在线生效。旧 API 会忽略新 query，按两端传入的兼容上限返回行情；500／200 的策略选择须新 API 生效。

## 验证证据

- Windows：457 项通过（361 项云请求／SDK／Renderer／17 策略×13 周期×4 分屏／幂等／自动任务，加 96 项指标／谐波／行情恢复）；TypeScript 检查及 Vite 270 模块隔离构建通过。
- Flutter：393 项通过。覆盖实际控制器的 17 策略×4 档缩放、未知提交结果重试、偏好与计划恢复，以及 Android／iOS、亮暗主题、简英繁的分析流／绘图／展示。`flutter analyze --no-pub` 无问题。
- 后端：109 项通过，含所有默认窗口、旧 limit 不改变服务端选择、精确范围、短历史、鉴权、VPVR、capabilities、排队冻结规则和旧威科夫兼容。
- 实际 Windows runtime＋SDK 与实际 Dart controller＋repository 各捕获 68 组请求，经过同一个冻结行情 ASGI 接口；68 组完整快照相等，普通策略额外 48 次跨缩放比较相等。
- 34 组官方策略×多空冻结输入经上述接口后交给真实 Node 确定性引擎，全部结果相等；16 组存在候选，入场、止损、全部目标、触发与回踩条件均相同。此项没有调用付费模型，不能解释为真实行情胜率或独立模型逐值确定性保证。
- Android：2026-10-22 22:02:24 +08:00，按 `Run-Mobile.ps1 -Offline` Release x64 `0.1.7+8` 重建、保留数据安装并重启。设备／本地 APK SHA256 均 `161c0cacb29d3163b9b6a11682af4b5911e8eef1d920c2562019f1aa59c3b49b`，757 个构建输入稳定，包内三份图表资源匹配，MainActivity 前台，PID 21483，当前进程致命标记 0。模拟器为 host NVIDIA OpenGL／禁 Vulkan／无快照；未操作原生 UI，iOS 原生构建未执行。

初轮测试发现新增移动夹具误用 `@策略` 选择指标，已按实际 `@指标` 入口修正；已有后端最低历史夹具缺少后来新增的 `marketKey`，仅补齐夹具，未放宽产品校验。首轮 Vite 命令未指定项目配置而找不到入口，改为根目录显式指定 `youle_desktop/vite.config.mjs` 后通过。失败日志单独保留，不计入通过数。

## 证据位置和范围

- Windows：根目录 `.cache/analysis-window-M1-454/` 的请求捕获、测试、类型检查、构建和安装核验日志。
- 后端：根目录 `.cache/analysis-window-M1-454-backend-final.log`、`window-parity-fixtures.json`、`window-parity-engine-inputs.json`、`window-parity-engine-results.json`；可复跑入口 `tests/manual/analysis_window_client_parity.py` 与 `window_parity_engines.mjs`。
- 移动：`release/verification-20261022/analysis-window-M1-454/installed.json`、构建前输入哈希及构建日志。

本次统一分析历史，不合并两个独立 run，不修改旧计划、模型选择或价格格式化。若账户快照、行情末根状态、用户偏好或模型选择不同，独立计划仍可能不同。工作区其他任务的图表／网络／部署等改动保留；本轮未提交、推送、部署、提高正式版本或发布渠道。
