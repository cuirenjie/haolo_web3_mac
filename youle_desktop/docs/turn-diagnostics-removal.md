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
2. 删除 `src/main/turn-diagnostics.mjs`。
3. 删除 `test/turn-diagnostics.test.mjs` 和 `test/turn-diagnostics-ui.test.mjs`。
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

## 用户机器上的历史文件

诊断运行文件位于 Electron `userData/logs` 下：

- `turn-diagnostics.jsonl`
- `turn-diagnostics.jsonl.1`

卸载代码不会自动删除用户机器上已经生成的文件。如需清除历史诊断数据，应在确认具体 `userData` 目录后，仅删除上述两个明确文件，不要递归删除整个日志目录。

