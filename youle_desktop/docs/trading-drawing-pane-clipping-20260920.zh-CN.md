# 绘图越界覆盖副图修复（M1-320）

用户截图中的蓝色结构线及 HH/HL 文字在平移价格视图后进入成交量副图。根因是 `TradingDrawingController.plotBounds()` 对主图读取 `chart.options().height`：该高度包含全部副图、分隔条和时间轴，导致 SVG 虽然设置了 `overflow: hidden`，裁剪区域仍然覆盖整张图表。

现统一读取所属 `chart.panes()[paneIndex].getHeight()`。主图、分屏主图及副图绘图各自使用实际窗格边界；SVG viewport、AI/手工绘图、文字布局、命中区域、选中手柄和播放光标共用同一边界。仍使用图表缓存尺寸，不在拖动帧增加 DOM 测量；时间/价格锚点与绘图持久化不变。现有导航重绘机制在平移、缩放、分隔条拖动、窗格重建和窗口尺寸变化后同步尺寸。

验证：

- 修复前 3 条边界断言失败；修复后新增窗格/渲染回归及原性能回归 5/5 通过。
- Electron 使用隔离数据与真实鼠标输入，浅色/深色 × 主图/分屏共 44 项检查、12 次原生拖动通过。覆盖 AI 折线、HH/HL、区域标签、手工矩形/斐波那契、选中手柄、光标、绘图模式命中、平移、价格轴缩放、滚轮、副图分隔条、VOLUME/MACD/RSI 增删、窗口尺寸和主题切换。
- 对副图及时间轴区域做绘图层显示/隐藏的逐像素比较；修复前复现越界，修复后每组差异均为 0。平移/缩放不改变保存的绘图锚点。副图绘图命中不能进入相邻窗格。已人工检查明暗主题截图。
- 定向扩大回归 107/108 通过；唯一失败为 `trading-expert-drawing-tools.test.mjs` 的旧分屏 `playAiDrawingPatch(patch, options)` 源码形状断言，同一正则在修改前 HEAD 同样失败，与本次边界改动无关。
- `node scripts/typecheck.mjs`、Vite production build、`git diff --check` 通过。没有新增颜色或主题样式，复用现有明暗绘图语义。

可复现脚本：`scripts/trading-drawing-pane-clipping-qa.cjs`（先在 127.0.0.1:5183 启动 Vite，再用 Electron 运行）。证据位于 `.cache/drawing-pane-clipping/report.json`、`tests.log`、`typecheck.log`、`build.log` 及 `{light,dark}-{main,split}-{before,after,multiple-indicators}.png`。

本项源码与验证完成，无本项阻塞；保留工作区原有未提交改动。本轮未打包 Windows 安装包、安装、提交、推送或发布。
