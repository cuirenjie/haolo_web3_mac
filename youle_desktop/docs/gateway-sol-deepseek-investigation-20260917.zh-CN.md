# Sol 大量失败与 DeepSeek 记录排查

日期：2026-09-17；任务：M1-311。范围：生产网关只读查询、发布包核对、隔离本机原生运行时复现。没有修改产品源码、生产配置、账户权限或部署服务。

## 结论

这是三个不同问题的叠加，不能解释成“DeepSeek 完全没有成功”或“所有用户没有升级”。

1. 网关有 DeepSeek 成功记录。按北京时间 00:12:00–01:12:00、后台实际成功/失败判定重建，合计恰好 490 条：DeepSeek 成功 115、Sol 成功 72、Sol 失败 303。最近一条 DeepSeek 在 00:59:37，倒序第 37 条，即每页 10 条时第 4 页；截图是第 2 页。该窗口是根据截图排序和总数重建，不声称知道截图精确拍摄秒数。
2. 截图账号（网关用户 1517）在核查区间确实没有 DeepSeek 用量记录。其他账号的成功不能证明该账号切换过。其 00:05–01:05 有 22 条 Sol WebSocket 失败、1 条 Sol 流失败，另有 2 条 Sol 成功。
3. 当前代码实现的是“符合条件的整轮最终失败后启用备用”，不是“网关任意一条失败后下一轮必切”。此外，交易意图识别和预警意图编译明确不读取备用窗口，也不走 DeepSeek 故障恢复。这两项均已用生产函数/真实内核复现。

## 生产故障证据

截图中的 01:01:08、01:01:21、01:02:39、01:02:51、01:03:04、01:03:13、01:03:26、01:03:38 均与数据库事件对应（例如 #41630、#41631、#41632–41637）。这些错误具有相同结构：

```text
model = gpt-5.6-sol
status_code = 101
error_type = websocket_error
request_type = 3
websocket_close_code = 1013
request_outcome = failed
acquire upstream websocket: ... upstream websocket is busy,
please retry later: context deadline exceeded
```

HTTP 101 仅表示 WebSocket 已升级，不代表模型完成；当前网关正确把 websocket_error / stream_error 计为失败。不能用旧排查脚本中的 `status_code >= 400` 独立统计，本次按 `OpsRequestFailedSQL` 和 `OpsUsageSucceededSQL` 重建。

生产 `sub2api-green` 同时段日志显示 `ingress_ws_upstream_acquire_fail`，`reason=acquire_timeout`、`dial_status=0`、`dial_class=ctx_deadline_exceeded`、`proxy_enabled=true`，涉及账号 16 和 67，目标为 chatgpt.com 的 Responses WebSocket。01:00:20.882 的账号 67 日志与用户 1517 的 #41622 对应到毫秒。

因此直接故障点在**网关获取上游 WebSocket 连接阶段超时**。错误文案的 busy 由网关生成；目前不能进一步断言一定是账号额度、连接池满、代理故障或上游整体过载。数据库账号列为空也不能推断完全没有选择过账号：实际网关日志已记录账号 67。

另有 01:04:47 的 #41640 是 HTTP/SSE 已返回 200 后的 `server_is_overloaded` / `stream_error`，需与前面的 WS 获取超时区分。

该账号 00:50:31 的 Sol HTTP 成功及 01:01:37 的 Sol WS 成功证明其在部分失败之后仍有 Sol 流量；01:11:21–01:11:54 又有四条 Sol 成功。网关日志本身不包含客户端的 `willRetry`、最终 turn 状态、备用状态文件和请求业务角色，不能据此断定每条错误对应一次用户点击。

## 客户端行为与可重复证据

### 1. 网关请求失败不等于客户端整轮失败

- `main.mjs::automaticTurnRecoveryTerminalStatus` 只识别 `turn/failed` 或失败状态的 `turn/completed`。
- `automaticTurnRecoveryDecision` 只有协调器返回 scheduled / cooling_down 时才调用 `AnalysisModelRecoveryStore.activate`。
- `isRecoverableAutomaticTurnFailure` 明确排除 `willRetry=true`，避免与仍在进行的原生重试重叠。
- 默认 Sol 配置开启 WebSocket，`request_max_retries=2`、`stream_max_retries=3`；这些参数并不等于总计只会产生三次网关请求。
- 理论复核的 Provider 同样在调用最终失败后才触发 onRecovery。原生内核重试后成功时，Provider 没有异常可捕获，备用状态不会启用。

隔离本机测试直接启动 0.1.169 `win-unpacked` 中的 `haolo_ai.exe`，沿用当前无凭证模板的 Sol 重试参数。模拟服务仅监听 loopback，不连接生产，不发送真实问题或行情。WebSocket 固定关闭码 1013，HTTP 返回合成成功结果；原生通知交给从生产源码提取的 `automaticTurnRecoveryDecision` 及真实 Store/Coordinator：

```text
第一次分析：Sol WS × 5 失败 → Sol HTTP 成功 → turn completed
客户端通知：Reconnecting... 2/3、3/3，willRetry=true
备用状态：null
用户再次分析：Sol HTTP 成功，仍无 DeepSeek 请求
```

随后向同一生产判断函数注入最终过载失败通知，成功得到 scheduled、deepseek-flash/max，Store 开启一小时窗口。这证明“最终失败切换”路径有效，也证明它没有覆盖“底层错误但最终恢复成功”的路径。不能把该合成终态当作截图设备的实际终态。

### 2. 一小时备用期并未覆盖所有分析相关模型调用

`trading-analysis/app-server-provider.mjs` 明确排除：

```javascript
const recoverableReview = !String(request.task || "").endsWith("-request-routing")
  && request.task !== "trading_alert_intent_compile";
const policy = recoverableReview ? options.selectModel?.(modelId) : null;
if (!recoverableReview) return operation(selection);
```

对同一个已激活的真实 Store 和生产 Provider 调用，结果是：

| 请求 | 实际模型 |
| --- | --- |
| general-request-routing | gpt-5.6-sol |
| price-action-theory-review | deepseek-flash |

所以“备用期内仍出现 Sol”也不能单独证明 Store 失效。意图识别和预警编译保留原策略，是 ADR-023/024 的已有边界；若产品要求整个再次分析流程都切备用，需要明确扩展这个范围。

## 发布包与后台显示

最新 Windows 0.1.169 发布记录为北京时间 00:19:50，完整下载验证在 00:22:34 完成。此包基于 2bc92db，包含一小时窗口和正式模型 ID `deepseek-flash`。本次直接读取 app.asar，验证以下四个模块与当前源码逐字节一致：main、analysis-model-policy、trading-analysis/app-server-provider、app-server-client。

不能继续使用旧文档“0.1.169 尚未包含修改”的说法。同一天存在多次同版本构建，单看 0.1.169 也不足以确认具体构建。用户暂不清楚截图设备版本；网关 `haolo_desktop/0.153.4` 是内核版本，不能拿它当客户端安装包版本。

DeepSeek 使用分组 15，上游账号 68；该分组的网关 platform 也是 openai，所以后台 OPENAI 标签本身不能区分 Sol 和 DeepSeek。请求明细继承全局 group_id/platform 筛选，并按时间倒序分页；本次未找到该列表代码按模型名专门隐藏 DeepSeek 的逻辑。115 条成功来自其他两个网关用户，不能归因于截图账号的故障恢复。

## 后续处理方向与尚缺的证据

- 若以“遇到可恢复的 Sol 服务故障后，下次分析必须切 DeepSeek”为产品目标，应把**记录后续请求使用的备用状态**与**是否立即续开当前轮次**分开；可恢复的重连通知可以激活后续窗口，当前活动轮次仍保持唯一所有者。鉴权、余额、取消、权限、无效请求等硬失败继续排除，不能取消全部护栏。
- 若“全局”包含分析前的意图识别，应让该入口读取同一窗口，并验证预警编译是否也在所需范围内。不能只改分析复核的最终 catch。
- 网关上游 WS 获取超时是独立问题，应进一步核对当时代理连通性、拨号时限和连接池证据，再决定 WS 降级/熔断策略。本次不把 timeout 直接归因为连接池耗尽。
- 要解释该设备 01:04:47 最终过载后仍继续 Sol 的确切原因，仍需该设备的构建标识、对应 turn 终态、业务角色及 `analysis-model-recovery.json`。目前能确认代码边界与可复现路径，不能在缺少这些证据时断言旧版、用户取消或意图路由中的某一个必然发生。

## 验证与证据位置

- 本次原生内核复现与生产策略断言通过；结果见仓库 `.codex-tmp/gateway-fallback-20260917/runtime-result.json`，复现脚本为同目录 `reproduce.mjs`。
- 33/33 相关测试通过：analysis-model-recovery、analysis-model-policy、deepseek-recovery-runtime、deepseek-trading-recovery。
- 生产查询均在 BEGIN READ ONLY 事务中，设置 15 秒 statement_timeout；只读取必要监控字段，没有读取请求正文、模型输出或凭据。
- 本地证据目录另有 initial/summary/display/screenshot 的 SQL 与 JSONL、regression.log。未修改 UI，无明暗主题变更；未提交、推送、打包或发布。
