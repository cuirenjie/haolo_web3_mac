# UI-MACD-PALETTE-001（2026-10-30）

用户要求在 MACD 柱设置下增加“MACD柱颜色”，提供“绿涨红跌”和“红涨绿跌”；随后要求各端删除“空心柱仅显示边框，柱高和颜色保持不变。”这句提示。

Windows、桌面 Web、共享 Android/iOS 页面和移动 Web 已实现。默认和恢复默认均为绿涨红跌；沿用页面的保存/取消流程。配色按 MACD 值正负切换，历史数据、实时更新和 Windows 分屏均应用；指标数值、柱形、DIF/DEA、K 线及成交量设置独立。移动端旧单色设置仍可读取，选择新配色后恢复双色柱。

账号字段为 `indicator.sub:macd.series.histogram.histogramPalette`，仅接受 `green-up` / `red-up`。配套校验位于规范业务后端 `haolo_front_web3/youle_mas-dev/backend/app/mobile/client_settings.py`。Windows 保存的自动绿色色值在移动端按自动配色读取，避免覆盖红涨方案。

Web 冻结来源保持原样：`haolo_web/src/build/macd-palette-patch.json` 与 `haolo_android_web/adapters/*macd*` 保存已审核的源文件差异及摘要，变换要求上下文唯一，来源变化时失败。移动 Web 通过原提取和图表打包脚本生成；不能手改 vendor 或仅修改提取产物。

本地验证：Windows 81 项相关测试、类型检查及隔离 Vite 构建通过；桌面 Web 2 项适配测试、两主题真实页面保存/重载/取消/恢复测试及构建通过，已检查删除提示后的截图。移动端相关 Flutter 37 项通过，最终增量 13 项通过；移动 Web 六语言双主题 12 项通过。原生图表 171 项通过，原生与移动 Web 实际图表浏览器测试均覆盖双色历史柱、实时更新、恢复默认及其他图形不变。后端相关测试 37 项通过。

本轮只实现和验证源码；未提交、推送、部署、升版、生成正式安装包、安装或重启应用。线上账号同步需配套后端和客户端发布；iOS 原生构建与真机验收未在本轮执行。

最终补验：移动 Dart 相关源文件与新增测试分析无问题；移动 Web Wasm release 构建及组合桌面 Web 的类型检查、Vite 构建通过，均输出隔离候选。各仓库本次文件差异空白检查通过。
