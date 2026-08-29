# Haolo Chrome 协议 v1

状态：Phase 0 冻结候选；实现、测试与灰度过程中只能增加向后兼容的可选字段，改变既有语义必须升级主版本。

## 参与方

```text
Codex → Chrome MCP → Desktop Broker → Native Host → MV3 Extension
```

- Codex 只提出工具请求。
- MCP 只暴露固定工具，不暴露任意 JavaScript 或任意 CDP 命令。
- Desktop Broker 是站点、任务、标签页、效果和审批的最终策略执行点。
- Native Host 负责协议桥接，不签发权限。
- 扩展只执行 Broker 已授权并绑定到当前页面状态的动作。

## 请求信封

所有跨进程消息必须携带：

```json
{
  "protocolVersion": 1,
  "type": "tool.call",
  "requestId": "uuid",
  "sessionId": "ephemeral-session",
  "profileId": "local-random-profile-instance",
  "threadId": "codex-thread",
  "turnId": "codex-turn",
  "taskId": "chrome-task",
  "grantId": "chrome_grant_uuid",
  "timestamp": "ISO-8601",
  "payload": {}
}
```

`requestId` 用于响应关联，`taskId + operationId` 用于效果去重。扩展实例 ID 由每个 Chrome Profile 的扩展本地随机生成，不读取 Google 账号身份。

## 工具集合

工具的机器可读定义位于 `src/main/chrome/contract.mjs`。v1 分为：

- 观察与控制面：`chrome_status`、`cancel_task`、`list_tabs`、`read_page`、`read_selection`、`capture_view`、`wait_for`。
- 普通操作：`navigate`、`click`、`type_text`、`select_option`、`scroll`、`press_key`。
- 两阶段效果：`prepare_external_action`、`commit_external_action`、`upload_file`、`download`。
- 单次敏感读取：`read_history`。

## 页面快照

扩展返回的页面内容必须先经过 Broker 清洗：

- 文本有长度上限；元素数量有上限。
- 密码、隐藏字段、支付、OTP、WebAuthn 等敏感控件不进入模型上下文。
- 页面内容统一携带 `trust=untrusted_web_content` 和 `instructionAuthority=none`。
- URL 移除用户名、密码和 fragment；日志不保存 Cookie、令牌或表单秘密。

## 授权

CapabilityGrant 至少绑定：thread、turn、task、profile、tab、origin、tool、artifact 和过期时间。模型只看到 Grant 引用，不能扩张或转授权。

- 跨 origin 导航后必须重新校验站点策略。
- `chrome:`、`file:`、`javascript:`、`data:`、扩展页和 DevTools 页默认拒绝。
- 浏览历史只接受单次授权，不能进入永久允许列表。
- 上传只能引用当前任务显式授权的 Artifact。

## 两阶段效果

外部写入先 `prepare`，生成目标、摘要、origin、tab、参数哈希和过期时间；用户或预授权策略确认后，Broker 签发一次性 approval token；`commit` 消耗 token 并用 idempotency key 去重。超时、重放或状态不匹配时失败关闭。

## 错误分类

```text
validation | policy | routing | transport | protocol | execution | timeout | cancelled
```

错误必须包含稳定 code、可读 message、category、retryable。权限错误不得通过重试变成允许。
