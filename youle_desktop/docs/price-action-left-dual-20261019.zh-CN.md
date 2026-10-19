# M1-381 裸 K 双路线左侧卡片与链路

2026-10-19，源码与本地隔离验收完成，生产未启用。

客户端接收云端冻结的 4h 收回跟进和 1h 触区方案，不在客户端计算交易价。聊天、保存计划和便利贴显示路线、报价时是否满足做多／做空条件、参考行情时间、成本、最长持有时间以及 4h 浮盈保护说明。超过 30 秒的旧报价不再显示当前可入场；原右侧卡片保持。

观察卡片展示真实支撑／阻力区域、各路线确认条件、失效规则和 15 分钟观察有效期。未通过入场和风控的预案没有服务器计划记录、激活按钮或便利贴入口；历史恢复不能使其成为交易计划。区域不足时明确说明，不编造价位。

三语（简体／繁体／英文）和亮暗主题一起验收。79 项卡片、账户展示、原右侧、历史恢复及错误提示回归通过；72 组／168 个隔离 Electron 界面实例的常规与窄大字布局通过，并已检查截图；TypeScript 和 Vite 构建通过。真实 SDK 通过本地 HTTP 接入后端 PostgreSQL 与 Node，验证两路线、左右方向、自动选择、只读账户测算、保存／恢复／激活与提醒。交易所和模型为受控夹具，无真实下单或用户数据变更。

关键文件：`src/main/price-action-left-card.mjs`、`cloud-plan-contract.mjs`、`execution-plan-card-view.mjs`、`execution-plan-sticky-view.mjs`、`trading-strategy-runtime/cloud-error.mjs`；Renderer 仅增加只读卡片分支。多段卡片说明从便利贴测宽探针中排除，避免新长文本撑大窗口。

复验命令须从 `C:/Users/潘艳芳/Documents/ChatGPT/haolo_windows_web3` 执行：

```powershell
node --experimental-transform-types --test youle_desktop/test/price-action-left-dual-card.test.mjs youle_desktop/test/cloud-plan-card-view.test.mjs youle_desktop/test/cloud-plan-account-view.test.mjs youle_desktop/test/cloud-right-compatibility.test.mjs youle_desktop/test/cloud-result-restoration.test.mjs youle_desktop/test/cloud-strategy-error.test.mjs
node --experimental-transform-types youle_desktop/scripts/price-action-left-card-qa.mjs
node youle_desktop/scripts/typecheck.mjs
node youle_desktop/node_modules/vite/bin/vite.js build --config youle_desktop/vite.config.mjs
```

证据位于 `.cache/left-dual-client-regression.log`、`.cache/left-dual-build.log`、`.cache/price-action-left-card-qa/`。完整参数、后端链路与启用门槛记录在业务后端仓库 `docs/price-action-left-dual-implementation-20261019.md`。

默认开关关闭，收益验证尚未通过；本次功能验收不保证胜率或扣费收益。未提交、部署、打包或重启用户开发窗口，其他会话改动保留。
