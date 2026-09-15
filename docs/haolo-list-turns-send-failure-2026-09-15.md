# 发送失败：list_turns is not supported yet

日期：2026-09-15。

## 结论与证据边界

已在仓库随包运行时 `0.153.4` 中复现截图的完全相同错误。可复现条件是：会话记录/运行中会话使用 `paginated` 历史格式，但 SQLite 索引 `threads.history_mode` 仍为 `legacy`。发送前恢复会话需要读取历史分页游标，格式校验失败导致 JSON-RPC `-32601`，随后客户端显示“发送失败”。

这证明了本地会话历史索引不一致可以造成截图现象，并不证明截图电脑一定发生了这一种异常。上游同一错误还覆盖索引数据库不可用、会话索引记录缺失或存储实现不支持该接口等情况。

本机日志未找到截图诊断编号 `H-20260915141152-8C29C3E6`。本机实际用户数据中只读抽查的 99 个会话，其文件格式与索引格式均一致。因此尚不能确定截图电脑上异常的形成原因；需要该编号对应的日志和目标会话索引元数据。

## 客户端失败链路

1. `youle_desktop/src/main/main.mjs` 的 `codex:sendMessage` 在 `turn/start` 之前调用 `thread/resume`。
2. 上游 `0.153.4` 在恢复 paginated 会话时调用 `paginated_resume_backwards_cursors`，内部调用存储层 `list_turns`。
3. `validate_thread_for_paginated_reads` 检查索引数据库、会话记录以及 `history_mode`。索引记录为 `legacy` 时返回 Unsupported。
4. 上游映射为 `list_turns is not supported yet`；桌面主进程传播异常，Renderer 的 `sendAgentText` 显示错误及诊断编号。
5. 在此复现条件下，失败发生于本地恢复步骤，尚未发起本轮模型请求。

源码依据：

- [上游运行时历史索引校验](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/thread-store/src/local/thread_history/read.rs#L176)
- [上游恢复分页游标](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/app-server/src/request_processors/thread_processor.rs#L3354)

## 隔离复现与恢复验证

使用独立临时目录、无真实凭据的本地 HTTP 模型桩和实际 `haolo_ai.exe`。只修改测试目录的索引，未修改真实会话、账号配置或已安装程序。

随包文件 SHA-256：`444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b`，与 `resources/bin/codex-runtime.json` 一致。

| 操作 | 结果 |
| --- | --- |
| 新建会话，完成一轮本地模型桩应答 | completed |
| 仅将测试索引的 history_mode 改为 legacy，保留实际 paginated 记录 | 建立格式不一致条件 |
| thread/resume | list_turns is not supported yet，-32601 |
| thread/resume，excludeTurns: true | 同样失败 |
| thread/read，includeTurns: true | 同样失败 |
| thread/read，includeTurns: false | 元数据仍可读 |
| 重启隔离运行时，再恢复同一会话 | 同样失败 |
| 将测试索引校正回与记录一致的 paginated | 恢复成功，原一轮历史可读 |
| 在原测试会话发送下一轮 | completed；本地模型桩总请求数为 2 |

原始复现结果位于仓库临时目录 `.codex-tmp/list-turns-JnXb6g/evidence.json`，诊断脚本为 `.codex-tmp/probe-list-turns.mjs`。运行脚本时设置 `PROBE_STALE_INDEX=true` 可重放上述条件。

## 初次排查的处理方向

- 先通过诊断日志关联目标会话，再只读核对实际运行时版本、会话文件格式及索引元数据。不能仅凭“最新版本”推断运行时版本或具体诱因。
- 经验证为索引格式不一致后，备份并针对该会话修复索引，再验证原历史可读、原会话可续聊。上述测试中的改写只用于人工构造的已知条件，不是针对用户数据的通用修复命令。
- 产品修复应补充对此类历史索引错误的识别和恢复流程；仅增加 `excludeTurns: true` 无法修复本次复现问题。

## 正式修复（2026-09-15）

用户要求彻底修复后，已新增 `youle_desktop/src/main/thread-history-recovery.mjs`，接入 `AppServerClient.request`。普通发送前恢复、前后台历史加载、会话引用、历史分页共用同一恢复入口。

- 仅处理历史 RPC 返回的精确 `list_turns` / `list_items` Unsupported 错误；读取运行时生效的 `sqlite_home` 后定位索引。
- 校验会话 ID、文件归属、完整 session_meta 头及实际 `paginated` 格式。只有索引错误标记为 `legacy` 时才更正该行的 `history_mode`。
- 在数据库事务中先写入并 fsync 可逆更改备份，再复核文件头，使用带旧值条件的 UPDATE 提交。备份放在实际 SQLite 目录下的 `haolo-history-index-recovery`，只含修改字段与文件头哈希，不含对话正文。
- 合并同会话并发修复；数据库繁忙时异步短暂退避。原历史请求只重试一次，保留原会话 ID 与请求参数。`turn/start` 不参与自动重放。
- 缺失或不可用的数据库、缺失索引、无法验证的文件、未知格式、备份失败等情况保留数据并明确返回恢复失败原因，不清空数据库、不新建替代会话，也不把未解决的问题当作成功。
- 新增 `thread_history_index` 诊断分类，并在 app-server 日志记录脱敏后的恢复结果。

### 验证

- 新增恢复模块测试覆盖格式校验、原记录和其他索引字段不变、备份、事务回滚、文件并发替换、数据库忙、独立 sqlite_home、并发合并、原参数重试、重试上限及真实 AppServerClient 入口。
- App Server、诊断、前后台历史加载、模型选择、压缩、交易专家记录持久化、运行时文件及自动恢复相关回归通过；类型检查通过。
- `node youle_desktop/scripts/smoke-thread-history-recovery.mjs`：使用实际随包运行时、桌面 WebSocket 客户端与本地模型桩，依次验证正在运行时恢复、历史读取恢复、运行时重启后恢复和原会话继续追问。
- 同一 smoke 在 Electron `39.8.10` / Node `22.22.1` 下通过。最后保留两轮原会话历史；第二次模型输入包含第一轮问答；两条用户消息仅产生两次模型请求。

修复已落入源码；尚未打包、推送或发布。截图电脑需要安装包含该修复的客户端后，才能使用自动恢复逻辑。截图对应数据若属于另一种未验证的存储损坏，仍需其诊断日志确认；本实现不会对不确定的数据进行猜测性重写。
