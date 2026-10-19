# 画线工具栏选中状态修复（2026-10-19）

用户截图红框对应尺子形状的“快速测量”按钮。

## 根因与修复

- 快速测量、框选放大和部分开关已有 `active` / `aria-pressed` 状态，但选中样式仍为透明背景，前景色与普通图标近似。浅色实测为 `#262626`，普通图标为 `#131722`，肉眼难以区分。统一使用持续可见的选中背景，鼠标移开后保持，悬浮样式不会覆盖选中状态。根据用户后续截图反馈，选中色调整为浅灰底 `#f0f0f0`、深色图标 `#131722`；深色主题使用灰底 `#2a2e39`、浅色图标 `#d1d4dc`。组主按钮、测量/框选、开关、工具菜单、磁铁模式菜单及收藏栏共用该配色。
- 导航测量或框选启用时，绘图控制器仍记住光标工具，造成光标与导航按钮同时高亮。状态刷新以当前导航工具优先，退出或完成后恢复记住的光标。
- 原先先更新工具选中状态，再刷新组主按钮和收藏栏；新建的收藏按钮可能遗漏选中状态。现在先更新按钮内容，再统一同步主按钮、菜单项及收藏按钮的 `active`、`aria-pressed` / `aria-checked`。
- 主按钮、普通工具菜单及收藏工具均补齐可见选中样式。磁铁、保持绘图、锁定、显隐保持各自独立开关语义；截图、清空、撤销、重做和缩小仍是一次性命令。
- 再次点击当前测量或框选按钮会取消工具；图表外部点击处理会保留本工作区这两个按钮的状态，直到 `click` 判断取消或切换，避免 `pointerdown` 提前重置状态导致再次启用。其他工作区和外部控件仍按原逻辑取消。
- 组主按钮、菜单项、收藏工具及相同符号支持再次点击取消；不同符号正常切换。取消会丢弃未完成的预览，保留已完成绘图，恢复记住的普通光标；橡皮擦不会被当成默认光标重新启用。默认十字光标重复点击保持默认状态，符号组的展开箭头仍可直接打开选择菜单。
- 强/弱磁铁菜单中重复点击当前模式关闭磁吸，选择不同模式开启对应强度。程序内部的 `selectTool` 保持明确选择语义，只有用户的工具按钮点击执行切换。

## 验证

所有命令在 `C:\Users\潘艳芳\Documents\ChatGPT\haolo_windows_web3\` 执行。

- `pnpm --dir youle_desktop exec vite --host 127.0.0.1 --port 5199 --strictPort`
- `pnpm --dir youle_desktop exec electron scripts/trading-drawing-toolbar-state-qa.cjs`
  - 隔离 Electron 配置和模拟行情，使用真实鼠标、键盘输入。
  - 浅色、深色分别验证 99 个常规工具、3 类符号工具、图片及帖子弹窗，共 104 个工具入口。
  - 验证测量与框选的启用、重复点击取消、互相切换、Esc 退出及两次点击完成；取消进行中的测量/框选不改变可见范围、不残留预览；99 个常规工具主按钮重复点击恢复光标；四个开关及强/弱磁铁模式重复切换；收藏栏、菜单和键盘切换；草稿取消保留已完成绘图；同类符号切换/取消；普通绘制完成恢复光标、保持绘图模式保留工具；一次性命令不残留选中状态。
  - 验证主图/分屏切换后的共用工具栏状态。
  - 报告：`.cache/drawing-toolbar-state-qa/report.json`；修复前实测：同目录 `baseline.json`；浅深主题截图：`light-measure-selected.png`、`dark-measure-selected.png`、`light-zoom-selected.png`、`dark-zoom-selected.png`；分屏截图：`dark-split-measure-selected.png`。
- `node --test youle_desktop/test/trading-chart-navigation.test.mjs youle_desktop/test/trading-expert-drawing-tools.test.mjs youle_desktop/test/trading-drawing-magnet.test.mjs youle_desktop/test/trading-drawing-language.test.mjs`：109 项通过，包含本工作区导航按钮保留点击前状态、其他工作区按钮仍取消的回归。
- `pnpm --dir youle_desktop run typecheck`：通过。
- `pnpm --dir youle_desktop run build`：通过，保留既有大分块提示。

本轮修改源码并更新开发资源，保留工作区原有改动；未提交 Git、制作安装包或发布更新。
