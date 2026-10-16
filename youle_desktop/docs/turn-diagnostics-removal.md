# 好咯逐轮诊断功能的可删除边界

统一标签：`HAOLO-TURN-DIAGNOSTICS`

这套诊断能力是旁路功能。所有与逐轮诊断记录、诊断编号和报告导出有关的接入点，都使用以下标签之一：

- `HAOLO-TURN-DIAGNOSTICS-BEGIN` / `HAOLO-TURN-DIAGNOSTICS-END`
- `HAOLO-TURN-DIAGNOSTICS-MODULE`
- `HAOLO-TURN-DIAGNOSTICS-TEST`

## 查找全部接入点

在仓库根目录运行：

```powershell
rg -n "HAOLO-TURN-DIAGNOSTICS" src test docs
```

## 完整删除步骤

1. 删除所有 `BEGIN` 与对应 `END` 之间的代码，包括标签注释。
2. 删除 `src/main/turn-diagnostics.mjs` 和 `src/main/diagnostic-support-evidence.mjs`。
3. 删除 `test/turn-diagnostics.test.mjs`、`test/turn-diagnostics-ui.test.mjs` 和 `test/diagnostic-support-evidence.test.mjs`。
4. 删除本说明文件。
5. 运行类型检查、诊断邻近测试和生产构建。

```powershell
pnpm run typecheck
node --test test/gateway-timeout-ui.test.mjs test/turn-result-pending-status.test.mjs test/app-server-client.test.mjs
pnpm run build
```

## 有意保留的非日志改进

以下改动没有使用诊断标签，删除日志能力时应保留：

- 对嵌套 `codexErrorInfo.additionalDetails` 的错误原因提取。
- 对并发限制、429、身份验证、流中断、超时和上游 5xx 的明确失败文案。
- 发送异常分支中未定义变量引用的修复。
- 设置页通用数据按钮的明暗主题交互样式；这些样式也服务于用户数据导入导出。
- 转录模块的可选 `onDiagnostic` 观察回调；未提供回调时不产生事件，观察者异常不影响保存或恢复。

## 一键导出会话证据（M1-344）

设置页的“导出诊断报告”仍保存一个 JSON 文件，保留原有运行状态和逐轮事件，并增加 `supportEvidence`：

- `indexes`：当前及相关工作区的转录索引状态、相关会话条目及别名；记录缺失、损坏、路径越界、截断和文件哈希。导出使用独立只读读取，不调用会修复或隔离文件的索引加载器。
- `rollouts`：优先当前会话，再采集近 72 小时相关交易会话。即使索引缺失，仍扫描实际会话文件查找交易转录。每项 `jsonl` 是脱敏后的 JSONL 文本，保留用户／助手正文、转录角色、阶段和时间；不是用于恢复的原始备份。
- `persistenceLog`：保存、注入、校验、标题更新、后台重试和历史恢复事件。错误只记录脱敏信息，线程和目录使用哈希关联。
- `omissions`：未采集原因。最多扫描 16 个工作区、512 个目录和 10000 个条目，读取总量 24 MiB，最多 12 个会话；单文件读取末尾 2 MiB，正文单项最多 24000 字符，证据输出目标上限 8 MiB。索引读取文件头，超过 2 MiB 时标记 `too_large`。超限或缺失不阻止基础报告导出。

会话证据包含脱敏后的对话内容，按钮旁提供简／繁／英提示，仅发送给官方客服。采集排除 auth/config 等凭据文件、工具输出、命令、系统／开发者指令和附件；正文中的常见密钥、令牌、邮箱、URL、本机路径也脱敏。目录链接不遍历，索引中的路径不作为任意文件读取入口。

新增保存／恢复日志从运行本版本开始记录；历史版本未记录的错误无法追补。旧版本的现存会话和索引仍可采集。分析算法和会话恢复行为不因导出改变；导出报告不等于已经修复会话空白问题。

## 用户机器上的历史文件

诊断运行文件位于 Electron `userData/logs` 下：

- `turn-diagnostics.jsonl`
- `turn-diagnostics.jsonl.1`
- `trading-transcript-diagnostics.jsonl`
- `trading-transcript-diagnostics.jsonl.1`

新增转录事件日志单文件约 1 MiB 后轮转，保留一份历史文件。卸载代码不会自动删除用户机器上已经生成的文件。如需清除历史诊断数据，应在确认具体 `userData` 目录后，仅删除上述四个明确文件，不要递归删除整个日志目录。

