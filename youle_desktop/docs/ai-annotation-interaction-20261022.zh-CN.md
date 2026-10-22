# M1-448：AI 标注拖动画布与圆形删除按钮

日期：2026-10-22。状态：源码与隔离验收完成。

用户要求鼠标位于 AI 文字标注时可以上下左右拖动画布，悬浮时在右上角显示黑底白色 × 删除按钮；追加要求按钮为圆形。

## 实现

- 原 AI 文字透明命中区域使用 `pointer-events: all`，挡住了底层图表的原生鼠标拖动。现在文字与透明区域均透传鼠标，使用独立 `TradingAiAnnotationHover` 根据实际布局检查悬浮位置，每帧合并处理，只有删除按钮参与点击命中。
- 按钮为直径 18 CSS 像素的黑色圆形、白色 ×，位于标注右上角，并限制在绘图区内。支持移入按钮、绘图重绘后继续点击、键盘聚焦及 Enter／空格删除。手工绘制期间隐藏按钮；按钮操作不启动图表拖动。
- 单条删除移除对应文字及其引线，沿用 AI 独立存储、当前历史绘图集和市场／周期／会话隔离，不修改其他几何图形、手工绘图和手工撤销状态。
- 空绘图集保留修订身份，防止删除最后一条标注后重载或同修订回执将其恢复。播放期间删除的对象在最终完整补丁保存时继续排除，后续新分析／新修订仍可生成新的标注。
- 删除文案与无障碍标签支持简中、英文、繁中；亮暗主题均使用用户指定的黑色圆形和白色 ×。

## 验证

- 108/108 Node 回归通过：绘图历史集（含新增单条／最后一条删除持久化）、图表导航、语言、文字布局、十字光标、逐笔播放及 AI 原生样式。
- `scripts/trading-ai-annotation-interaction-qa.cjs` 在隔离 Electron 实际图表中通过 130 项检查：三语 × 双主题、圆形外观、原生鼠标四向拖动（note 和 text）、滚轮缩放、按钮点击不移动图表、重绘时悬浮稳定、键盘删除、手工内容隔离、历史切换、重复回执、页面重载、最后一条删除和播放结束不恢复。
- 六张截图中已目视检查亮色简中与暗色英文。回执、截图位于 `youle_desktop/.cache/ai-annotation-interaction-M1-448/`。
- TypeScript 与 269 模块隔离 Vite 构建通过，构建仅既有大块提示；`git diff --check` 通过。构建输出位于同一证据目录的 `build/`，没有覆盖开发／发布产物。

从规范 Git 根 `D:/haolo_windows_web3` 复现：

```powershell
pnpm --dir youle_desktop run typecheck
pnpm --dir youle_desktop test test/trading-ai-drawing-sets.test.mjs test/trading-chart-navigation.test.mjs test/trading-drawing-language.test.mjs test/trading-drawing-labels.test.mjs test/trading-drawing-crosshair.test.mjs test/trading-ai-playback-motion.test.mjs test/trading-ai-native-style.test.mjs
pnpm --dir youle_desktop exec vite --host 127.0.0.1 --port 5213 --strictPort
pnpm --dir youle_desktop exec electron scripts/trading-ai-annotation-interaction-qa.cjs
pnpm --dir youle_desktop exec vite build --outDir ../../.cache/ai-annotation-interaction-M1-448/build
```

使用隔离用户目录与合成行情，阻断外部网络；未操作用户窗口、真实分析或账户。未提交、推送、打包、发布或重启用户开发版。保留工作区内其他会话的价格轴、动画、任务栏和桌面快捷方式改动。
