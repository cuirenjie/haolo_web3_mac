# Windows → macOS 网络增量融合记录

日期：2026-09-14。关联执行任务：M2-020；M2-013 原生产验收阻塞保持。

## 范围与来源

- Mac 基线：`dev@f08676f6877701061855e66bce40ec94d959e1dd`。
- Windows 来源：`haolo_windows_web3` 的 `windows/dev`，新增范围 `755d29f..526acbb`，共一个提交、36 个文件。
- 来源提交：`526acbb35e0e1eb4b31672d1c2e9b077e56d2508`，`fix(desktop): improve account and market network resilience`。
- 本地导入：`f74f471d3dbb380d53a4ddf0527d2bcfd012cdef`，采用既有 `cherry-pick -x` 增量移植方式，并保留来源哈希。两个仓库没有共同祖先。
- 当前状态：本轮源码融合及本机验收已完成。交付前再次核对远端，Windows `dev` 仍为 `526acbb`，Mac `origin/dev` 仍为 `f08676f`。

## 融合结果

账号业务和更新检查接入独立 Electron session 的系统代理传输，支持代理配置恢复及经校验的账号同站别名回退。网络自动重试限于无正文的 GET/HEAD；写请求发生连接错误后不自动重放。下载和模型传输保持各自原有入口。

Binance 网关增加香港 GA 候选地址、保留 Host/SNI 和证书校验的健康选路、失败地址暂缓、控制请求和 WebSocket 完整握手截止时间。公共行情 5xx 不再胜过健康回退线路。Hyperliquid 增加相同查询合并、正文超时、预警握手恢复和迟到事件隔离；仍为外部直连。

主进程冲突保留了 Mac 的 `systemPreferences`，同时引入新 `session`。更新检查在原架构回退循环内使用 `fetchServiceJson`，保留配置架构、当前 CPU 架构和 universal 的去重回退、Web3 渠道隔离及服务端 `force_update` 决定。

远端 36 个变更文件中，31 个最终内容与来源 Git blob 完全一致。其余差异如下：

| 文件 | 保留的 Mac 差异 |
| --- | --- |
| `src/main/main.mjs` | 平台窗口、权限、更新架构、运行时及既有会话维护；在原逻辑中接入新网络传输 |
| `src/main/binance-gateway-client.mjs` | 网关客户端标识按宿主平台选择，Mac 继续使用 `macos-desktop` |
| `src/main/binance-network-router.mjs` | 保留已有截止时间及竞速计时器引用，避免进程提前结束请求 |
| `src/main/youle-api-client.mjs` | Mac 客户端标识、历史会话刷新兼容、余额请求合并和认证版本隔离缓存 |
| `docs/trading-expert-realtime-ai-execution-plan.zh-CN.md` | 同时保留本地及 Windows 历史日志；原历史测试计数不追溯改写，当前焦点按 Mac 本轮任务更新 |

Renderer 与网关服务相对 `f08676f` 没有变更。上一轮 R1–R5 的共享画线、UTC 日历周期、月/年预警明确拒绝、主图边界和英文仓位答案，以及此前行情新鲜度、切换竞态等修复均保留；月/年预警完整调度没有在本轮扩展。

## 本机验收

| 检查 | 结果 |
| --- | --- |
| Mac 更新与会话兼容专项 | 12/12 通过，其中新增 8 项执行生产更新函数的行为回归 |
| 桌面全量 | 2805 项：2801 通过、0 失败、4 项按平台跳过；文件并发 2 |
| Binance 网关全量 | 54/54 通过 |
| TypeScript | 通过 |
| Vite 生产构建 | 184 modules，通过；保留既有大 chunk 提示 |
| Mac 运行时 | Codex 0.144.1 arm64/x64 与两个 rg 的架构、哈希、运行时签名校验通过 |
| Electron 41.10.2 本地代理烟测 | 5/5 通过：直连、阻断直连 DNS、代理账户/导出/SSE、失效代理恢复、写请求不重放 |
| 变更 JavaScript 语法 | 33 个文件通过 |
| `git diff --check` | 通过 |

新增更新回归覆盖 Apple Silicon 回退、Intel 三架构顺序、可用架构短路与强更标志、错渠道拒绝、HTTP 失败、JSON 正文截止时间、Windows 无架构参数及无更新终态。执行生产函数和真实 `fetchServiceJson`，仅替换网络与 Electron 环境，不启动业务客户端。

首轮桌面 2797 项中 2792 通过、1 失败、4 跳过，失败为 `auth-session-lifecycle.test.mjs` 仍要求构造器在 `networkFetch` 参数后立即结束；断言已纳入新增 `serviceFetch` 参数，并保留全部原会话维护要求。随后全量 2805 项中 2800 通过、1 失败、4 跳过，唯一失败是未改动的飞书测试在清理临时目录时出现 `ENOTEMPTY`；该用例的行为断言已经通过，单项复测 1/1 通过。最后一轮降低文件并发至 2，全部 2805 项中 2801 通过、0 失败、4 项按平台跳过，耗时约 91 秒；结果单独记录，没有修改范围外飞书业务实现。

日志位于 `.git/windows-sync-20260914-` 前缀：`compatibility-tests.log`、`desktop-tests.log`、`desktop-tests-final.log`、`desktop-tests-accepted.log`、`cleanup-retry.log`、`gateway-tests.log`、`typecheck.log`、`build.log`、`mac-runtimes.log`、`electron-smoke.log`、`electron-smoke.json` 和 `integrity.json`。Electron 烟测使用独立临时用户目录和本地 HTTP/代理服务，未加 `--live`，没有使用真实账号、令牌或线上写请求。

## 本地工作保护与交付边界

- 保护分支：`codex/backup-before-windows-sync-20260914`；原未提交内容备份为 stash `e5b34bd7ce36c12ba9b59cf25b1b2ce83ea13a8c` 和 `.git/windows-sync-20260914-local.patch`，均保留。
- 原 `package.json`、`package-lock.json` 已从 stash 恢复，逐字节一致，应用版本保持 0.1.167；原打包日志逐条保留。版本和原打包日志继续留作未提交改动。
- 本轮导入及兼容验收仅在本地 `dev` 提交，没有推送、重新打包、部署、修改 DNS/CDN 或重启现有客户端。
- 现存 `release/好咯-0.1.167-universal.dmg` 是 `f08676f` 加原版本更新的历史产物，不包含本次 `526acbb` 增量。其原 SHA-256 为 `2e897de40f7366e4a9f7b09dbfbfc0743ffafa34db785a91098fa4ecdb801fa7`。
- 上游文档中的 Windows/线上 DNS/CDN 记录作为来源证据保留，并非本轮 Mac 实测。M2-020 的真实登录 Binance REST/WS/只读 CONNECT 和 Hyperliquid 香港转发仍待后续验收；M2-013 多 EIP、三网与 72 小时生产验收未完成。
