# DeepSeek 1017 Windows 客户端复验（2026-10-17）

本次原生运行时复验发现：原客户端仍将 DeepSeek 标为纯文本，并拒绝恢复带图片历史的任务。因此仅发布后端不足以覆盖 Windows 图片兜底；本次已修复能力目录、模型选择、发送与历史检查。视频仍不支持，根编排、工具授权和用户模型 Key 隔离不变。三语提示同步，沿用明暗主题共用的高对比度提示样式。

## 实测范围

在本机 Windows 启动随客户端捆绑的真实 `haolo_ai.exe`（codex-cli 0.157.1），使用独立临时运行目录。测试连接生产模型池，读取现有登录的已授权凭据；只在测试 relay 注入 GPT 失败，真实调用 `deepseek-flash`。执行生产发送／模型切换函数、自动恢复协调器与原生 app-server；没有通过 Electron 界面点击验收。

- 修复前：图片历史触发 `start_failed`，没有发出 DeepSeek 请求。失败回执保留在本机 `output/deepseek-1017/baseline-K9Thf0/receipt.json`。
- 修复后：同一任务 `gpt-5.6-sol → deepseek-flash/max`；图片保留在两次真实请求中；只读合成工具 `read_fixture_code` 调用一次，返回数字 731；最终回答 `Red; numeric value: 731.`。
- 两次模型请求均 HTTP 200。网关实际上游均为 `deepseek-flash`，每请求各一条用量和一条扣费去重记录；没有重复扣费。不是支付／充值测试。
- 170 项相关回归全部通过；类型检查与 Vite 构建通过。初次测试在中文 TEMP 路径下有一个既有 ASCII 路径夹具断言失败，最终仅为测试进程设置独立 ASCII TEMP 后通过，未改系统环境。
- 机器回执见 [deepseek-1017-native.json](verification/deepseek-1017-native.json)。完整私有实验记录保留在本机 output，不包含在安装包中。

## 发布边界

此记录证明修复源码与真实 Windows 原生运行时的恢复链路，不代表已发布 Windows 安装包或已更新用户机器。当前包版本仍为 0.1.180；现有安装包要获得图片兜底修复，需要按独立 EV 签名发布流程构建和更新。移动端附件工具顺序问题另由业务后端修复 `b86aea6` 处理，不属于 Windows 修改。
