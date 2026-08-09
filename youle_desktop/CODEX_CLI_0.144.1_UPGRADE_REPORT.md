# Codex CLI 0.144.1 升级兼容报告

日期：2026-07-11

## 结论

客户端捆绑的 Codex CLI 已从 `0.142.3` 升级为官方稳定版 `0.144.1`。升级保留现有 `haolo_ai` Provider、272K 输入窗口、244.8K 自动压缩阈值、审批策略、沙箱策略和现有会话存储位置。默认模型从 Codex 不认识的裸别名 `gpt-5.6` 改为规范型号 `gpt-5.6-terra`。

官方发布页：<https://github.com/openai/codex/releases/tag/rust-v0.144.1>

## 运行时资产

| 文件 | SHA-256 |
|---|---|
| `haolo_ai.exe` | `cbacbb9726262ef558b4af0438a1b2a5bba9076132401d947b5b4d2bf92ab0e4` |
| `codex-command-runner.exe` | `712f535d0a01f28adfe22b13f6a222d2a54f6f0956b25520c7ca70c042bf2d81` |
| `codex-windows-sandbox-setup.exe` | `eb4d4cc098de57a0b9c9d8ec184d5346b4735e3bd65c39ce92269969d2ed643e` |

三个文件的 Authenticode 签名均有效，签名主体为 OpenAI OpCo, LLC。版本和哈希记录在 `resources/bin/codex-runtime.json`，可运行以下命令复验：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-runtime.ps1
```

Windows helper 必须与主程序同目录、同版本。单独替换主 EXE 会导致 workspace-write 沙箱命令失败，因此打包配置和 CI 已同时覆盖三个文件。

## 兼容性对比

以两枚实际二进制生成的 experimental JSON Schema 为准：

- 客户端当前使用的 `initialize`、`model/list`、`config/read`、`skills/list`、`thread/start`、`thread/resume`、`thread/list`、`thread/archive`、`thread/compact/start`、`turn/start`、`turn/interrupt`、`turn/steer` 均保留，必填字段不变。
- ServerNotification 和 ServerRequest 方法集合没有删除。
- 新版用 `thread/items/list` 替代 `thread/turns/items/list`，并增加 `environment/info`；当前业务未调用这些方法。
- `thread/start` 新增的 `allowProviderModelFallback`、`historyMode` 等字段均为可选字段；默认历史模式保持 legacy，不改变当前会话读取方式。
- 现有配置在新旧两版的 `config/read` 结果一致：272,000 context、244,800 auto compact、scope=total、on-request、workspace-write。

旧配置中的 `disable_response_storage` 不是两版官方支持字段，严格模式都会拒绝。它已被移除；`haolo_ai` 属于自定义 Responses Provider，Codex 两版都会发送 `store=false`，因此实际存储行为不变。

## 随升级修复的协议问题

- 同时兼容官方 `item/tool/requestUserInput` 和旧客户端写法 `tool/requestUserInput`。
- 用户答案改为官方要求的 `{ answers: string[] }` 结构。
- `item/permissions/requestApproval` 改为返回 `{ permissions, scope }`。
- 实现 `currentTime/read` 的整数 Unix 秒响应。

这些问题在旧版也存在，但新版相关能力稳定后更容易触发，因此在切换前一并修正。

## 验证结果

- SHA-256、OpenAI Authenticode、`codex-cli 0.144.1`：通过。
- 严格配置启动、`/readyz`、WebSocket initialize：通过。
- `model/list` 同时识别 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`：通过。
- 复制真实运行时状态后，新版列出 25 个会话并恢复抽样旧会话的 3 个 turn：通过。
- SQLite/rollout 盘点为 25 个 rollout、26 个 DB row；旧版基线结果相同，扫描错误为 0，不是升级回归。
- 三个模型分别完成真实上游回合：通过。
- Terra 真实执行 commandExecution 和 apply_patch，且沙箱文件内容正确：通过。
- 真实“普通回合 → context compaction → 压缩后继续回合”：通过，压缩约 8.1 秒。
- Node 测试：311 项全部通过；升级相关定向测试：23 项全部通过。
- TypeScript 检查、Vite production build：通过。
- 临时 `win-unpacked` 打包：通过；打包后的三个运行时文件、签名、哈希和 sandbox 命令均通过。

## 回滚

本地验证期间已使用同版本的 `0.142.3` 主程序和 helper 完成 app-server 启动、配置读取、Terra 线程创建与 Windows sandbox 回滚测试；这些临时验证产物不纳入版本库或安装包。

生产发布回滚应优先使用上一版安装包或更新系统的版本回退。若需本地复验，必须从上一版安装包提取同版本的主程序、command runner 和 sandbox helper，不能只替换主 EXE。

## 尚未包含的下一阶段

本次只升级 CLI 并保持当前上下文预算不变。百万级上下文所需的定制模型目录、922K 安全输入预算、800K 压缩阈值及服务端同流压缩属于下一阶段，不应与本次低风险二进制升级同时放量。
