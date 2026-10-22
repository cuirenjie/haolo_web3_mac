# 账户页今日盈亏刷新修复（2026-10-23）

状态：前后端源码完成，本地测试通过；未部署、未上传更新包、未制作安装包、未提交 Git。

## 问题与行为

原先核心余额先返回，后台收益查询完成后没有通知页面，往往要等下一轮核心刷新才能显示。收益查询还重复读取核心账户数据；服务端收益缓存只在单进程内有效，多个 API 进程及账户会竞争较小的 today_pnl 配额。额度延后被表现为没有解释的 `—`。

现在核心余额仍先返回，今日收益独立查询并通过 main → preload → renderer 的 `binanceAccount:pnl` 事件更新。页面等待时显示“更新中 / 等待更新”；完整查询确认当天无已实现收益时显示真实的 `0.00`。失败、未完成分页、过期值不会变成零。

沿用账户卡原有口径：今日已实现盈亏为当天 `REALIZED_PNL`，今日盈亏为它加当前未实现盈亏。收益曲线及日历的净收益口径没有改变。

## 实现范围

- `src/main/binance-account/snapshot-components.mjs`：独立完成通知、刷新和退避定时器、60 秒原始观测有效期、服务端时间投影、当地午夜到期；离开页面后停止持续查询，但仍发出到期清空事件。
- `src/main/youle-api-client.mjs`：依据核心响应的 `pnlEndpointVersion: 1` 使用 `/today-pnl`；旧服务端继续走既有 snapshot 参数契约。
- `src/main/main.mjs`、`src/main/preload.mjs`：传递公开的收益补丁，不携带凭据或旧余额。
- `src/renderer/binance-account-pnl.ts`、`main.ts`：按随机作用域、绑定版本及递增序号合并；收益始终与当前最新余额/浮盈计算。支持完成事件先于首次 IPC 响应，也支持该竞态下的凭据失效恢复。
- `binance-account-ui.ts`、`styles.css`、`app-language.mjs`：简中、英文、繁中及明暗主题共用等待样式；隐藏余额时不暴露状态。
- 对应业务后端见 `D:/haolo_front_web3/youle_mas-dev/backend/docs/account-pnl-refresh-20261023.zh-CN.md`。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 客户端账户系列、限流、API 客户端和传输回归 | 230 / 230 通过，无跳过 |
| TypeScript 类型检查 | 通过 |
| 独立目录 Vite renderer 构建 | 通过；存在原有大体积 chunk 提示 |
| 后端账户/限流及真实 PostgreSQL 集成 | 121 / 121 通过，无跳过 |
| 两个独立 uvicorn 进程、真实 HTTP 和 PostgreSQL、两个 SDK 客户端 | 只发出 1 次签名 income 查询；核心 account 各读 1 次，没有为收益重复读取核心 |
| SDK → 实际 main handler → 实际 preload → renderer 合并/渲染 | 435 ms / 880 ms 收到并展示收益，无第二轮核心请求 |
| Electron 实际 renderer：3 语言 × 2 主题 × 2 宽度 | 12 / 12，通过等待→真实零、旧序号/错绑定忽略、无新增核心读取、无溢出/页面错误；事件到显示最慢 9 ms |

HTTP 链路测试使用真实路由、签名读取代码及 Lua，但交易所由本地 `httpx.MockTransport` 提供固定的合成余额与收益；身份依赖也只在测试 fixture 中替换。它验证端到端软件契约，不代表真实币安网络延迟或生产验收。

额外覆盖：限流 61 秒退避、旧观测复用不延长有效期、软刷新失败后到期清空、午夜、重绑后的迟到核心/收益响应、账号切换、失效凭据先到事件及现有重新绑定流程。

## 本机复现

所有命令从 `D:/haolo_windows_web3` Git 根运行。

```powershell
$tests = @(Get-ChildItem -LiteralPath 'youle_desktop/test' -File |
  Where-Object { $_.Name -like 'binance-account-*.test.mjs' } |
  ForEach-Object { $_.FullName })
$tests += @('youle_desktop/test/binance-quota-governance.test.mjs',
  'youle_desktop/test/youle-api-client.test.mjs',
  'youle_desktop/test/youle-api-service-transport.test.mjs')
node --experimental-strip-types --test @tests
node youle_desktop/scripts/typecheck.mjs
node youle_desktop/node_modules/vite/bin/vite.js build `
  --config youle_desktop/vite.config.mjs `
  --outDir D:/haolo_windows_web3/youle_desktop/.cache/account-pnl-20261023/renderer-build
```

界面脚本 `scripts/account-pnl-ui-qa.cjs` 使用独立 Electron profile、隐藏窗口并阻断 HTTP(S) 出网，读取上面的隔离构建。应通过 Electron 运行，不启动用户的正式应用。

双进程链路先按后端文档启动两个 loopback fixture，再运行：

```powershell
$env:HAOLO_PNL_FIXTURE_ORIGINS='http://127.0.0.1:18543,http://127.0.0.1:18544'
node --experimental-strip-types youle_desktop/scripts/account-pnl-chain-qa.mjs
```

本次本地证据在 `youle_desktop/.cache/account-pnl-20261023/`：`windows-tests.log`、`build.log`、`chain.json`、`ui/results.json`、24 张等待/零值截图。该目录是测试产物，不属于发布内容。

## 容量边界与交付边界

固定出口的 1800 权重/分钟上限、交易所 429/418 冷却仍然有效。合成负载中的 19 账户收益有效占比从 42.11% 提升为 76.96%，38 账户饱和场景为 34.14%；这不是线上 SLA。负载不足以支持全部账户每分钟完整读取时，页面会按真实状态等待并自动恢复，不通过延长过期数值或填零掩盖限流。完整假设及核心通道保护结果见后端文档。

此次没有改变任何线上服务或已安装客户端。后续发布需单独授权，并按多会话规范协调后端 API、独立 Worker 的共享限流代码及 Windows 签名更新包；兼容旧端的能力不等于已完成部署验收。
