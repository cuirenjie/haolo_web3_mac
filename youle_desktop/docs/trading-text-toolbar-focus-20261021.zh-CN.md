# 文字输入期间工具栏点击失效修复（2026-10-21）

## 现象与根因

新建文字后，直接点击编辑、颜色、背景、字号或加粗按钮，文字输入框与工具栏消失，按钮没有执行。已在隔离 Electron 环境用真实鼠标事件复现：空白草稿点击加粗后，绘图数量变为 0、编辑器被移除、工具栏隐藏，加粗未生效。修复前记录位于 `.cache/text-toolbar-qa/baseline.json`。

文档捕获阶段的 `pointerdown` 将工具栏也当作文字输入框外部，在按钮收到 `click` 前结束编辑；空白草稿随之被丢弃。输入框的 `blur` 还会独立结束编辑。颜色面板挂载在顶层，不能仅用工具栏的 DOM 包含关系判断。此外，图表导航会把工具栏拖动把手当作画布操作，抢走输入焦点。

## 修改

- 将输入框、当前工具栏及其所属颜色面板识别为同一编辑区域；其他控件及其他工具栏的颜色面板仍属于外部。
- 工具栏普通按钮和拖动把手不抢走输入焦点，颜色面板中的文本、数字和滑块控件保留原生交互。输入框的 DOM 节点、待输入文字和输入法组合状态不会被样式更新重建。
- 失焦进入编辑区域内控件时继续编辑；通过键盘离开整个区域时提交文字。点击外部、Enter 保存及 Esc 取消保留原有语义。
- 图表导航及画布背景点击忽略 `role=toolbar` 内部操作，避免拖动工具栏同时触发图表操作。
- 锁定前先保存正在输入的文字，避免编辑器因绘图锁定而取消未保存内容。

## 验证

所有命令均从 `C:/Users/潘艳芳/Documents/ChatGPT/haolo_windows_web3` 执行。

- `pnpm --dir youle_desktop exec vite --host 127.0.0.1 --port 5199 --strictPort`
- `pnpm --dir youle_desktop exec electron scripts/trading-text-toolbar-qa.cjs`：128 项检查通过。采用模拟行情、独立 Electron 配置、真实鼠标与键盘事件，并在页面加载后启用 Chromium 焦点模拟，确保隐藏测试窗口也派发真实 focus/blur 事件。
  - 浅色、深色下分别覆盖空白草稿与已输入中文；编辑、加粗、字号、文字颜色、自定义颜色、背景颜色及不透明度；继续输入、Enter、Esc、外部点击、键盘焦点、输入法组合状态、工具栏拖动、重置样式、锁定、隐藏、删除及重载保存。
  - 共用行内编辑器的便笺、图钉、表格、标注、评论、路标和趋势线文字也通过颜色修改及保存检查。
  - 报告与截图：`.cache/text-toolbar-qa/report.json`、`light-typed-styled.png`、`dark-typed-styled.png`。
- `$env:HAOLO_QA_PORT='5199'; pnpm --dir youle_desktop exec electron scripts/color-picker-qa.cjs`：共享颜色选择器的色板、自定义色、透明度、弹窗取消、三种语言和两种主题回归通过。
- `node --test youle_desktop/test/trading-expert-drawing-tools.test.mjs youle_desktop/test/trading-drawing-labels.test.mjs youle_desktop/test/color-picker.test.mjs youle_desktop/test/trading-drawing-visibility.test.mjs`：71 项通过。
- `node --test youle_desktop/test/trading-chart-navigation.test.mjs`：46 项通过，包括新增的工具栏把手不抢焦点、不平移或缩放图表检查。
- `pnpm --dir youle_desktop run typecheck`：通过。
- `pnpm --dir youle_desktop run build`：通过，仍有既有的大分块提示。

本轮修复源码并构建本地渲染资源，未提交 Git、制作安装包或发布更新。
