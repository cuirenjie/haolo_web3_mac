# TradingView 画布交互对齐（M1-315）

日期：2026-09-19。验收范围：当前 K 线工作区的主图、指标窗格与独立分屏，包括鼠标/键盘导航、临时测量、局部放大、坐标轴和自动适配。以用户本次要求替代 M1-314 的自定义 Shift 框选规则。

## 操作契约

| 操作 | 当前行为 |
|---|---|
| 左键水平拖动 | 平移时间范围，保留 Auto 状态 |
| 左键纵向/斜向拖动 | 移动价格范围；超过 4px 纵向阈值进入手动范围 |
| 普通滚轮 | 默认以右端为锚点缩放时间轴 |
| Ctrl / Command + 滚轮 | 始终以光标为锚点聚焦缩放 |
| Shift + 滚轮 | 只横向平移；兼容浏览器已转换为 deltaX 的事件，不重复缩放 |
| 价格轴拖动 / 滚轮 | 缩放该窗格纵轴；线性、对数、百分比均可用 |
| 时间轴拖动 | 调整横轴比例；时间轴保持可见 |
| 双击价格轴 | 恢复该轴自动适配 |
| 双击时间轴 | 使用底层原生时间轴复位 |
| Shift + 点击两点或拖动空白画布 | 临时测量价格差、百分比、K 线数量、时间及可用成交量，不保存绘图、不修改撤销栈；单击、Esc、轴操作、视口/尺寸或源数据变化时清除，避免显示失效结果 |
| 点击左侧放大镜，再点击两点或拖动框选 | 同时放大选中的时间、价格范围，完成后退出工具；Esc 取消 |
| 左侧尺子 | 启用相同的临时测量工具；预测工具组中的持久测量绘图继续独立保存 |
| 左侧缩小 / 底部 +、− | 缩放当前图表；底部左右箭头平移，复位按钮重置 |
| A / L | 右侧坐标轴下方切换自动适配 / 对数模式，选中状态可见 |
| Alt + R / 图表右键“重置图表” | 立即恢复默认时间比例、最新数据位置和各纵轴 Auto；后续滚轮不会受到未结束的复位动画干扰 |
| ← / →，Ctrl + ← / → | 当前图表按一根 / 多根 K 线平移 |
| Ctrl + ↑ / ↓ | 当前图表放大 / 缩小 |
| Alt + L / P / I | 当前价格轴切换对数 / 百分比 / 反转 |
| 双击绘图区 / Ctrl + 双击 | 最大化恢复指标窗格 / 收起恢复当前窗格 |
| Alt + Enter / Alt + 点击绘图区 | 在多图布局中最大化或恢复当前图表 |
| Alt + T / F / H / V | 当前绘图控制器选中趋势线 / 斐波那契回撤 / 水平线 / 垂直线 |
| Shift + 拖动现有绘图 | 约束为水平或垂直移动，避免与临时测量竞争事件 |
| Ctrl + Z / Y，Ctrl + Shift + Z | 手工绘图撤销 / 重做；输入框和编辑器保留自己的快捷键 |

图表导航快捷键绑定到获得焦点的画布。切换主图、指标窗格和分屏时同步激活正确的绘图控制器；输入框、表单、右键菜单和对话框不触发图表导航。浏览器原生触控拖动与双指缩放继续使用 Lightweight Charts 手势。

官方核验来源：[快捷键](https://tradingview.com/charting-library-docs/latest/configuration/Shortcuts/)、[Shift 临时测量](https://www.tradingview.com/support/solutions/43000537228-how-to-use-measure-tool-quickly/)、[绘图工具与放大工具](https://www.tradingview.com/chart/TSLA/qw8dRAeQ-TradingView-Masterclass-How-To-Use-Drawing-Tools/)、[Ctrl 聚焦缩放](https://www.tradingview.com/blog/en/stay-in-focus-15704/)、[图表设置与导航](https://www.tradingview.com/support/solutions/43000748166-how-to-configure-your-supercharts/)。

## 实现与兼容性

- 主图和分屏复用 `TradingChartNavigation`，通过回调与现有行情、绘图和主题系统衔接。
- 修正 `rightBarStaysOnScroll` 映射反向：`true` 固定右端，`false` 固定光标。设置结构升级至 v4，旧版锚点迁移为 TradingView 默认右端缩放；v4 之后用户明确选择的光标偏好保留，Ctrl 不再反转该偏好。
- 普通行情刷新、历史前补和主题切换继续保留手动价格范围。只在坐标模式改变时重置 Auto。
- 补齐 Lightweight Charts 5.1 原生不支持的百分比价格轴拖动。框选根据原生坐标反算价格；百分比范围采用选区新的首根可见 K 线基值。M1-317 已删除不稳定的对数偏移推算，使用公开 autoscaleInfoProvider 让库原生转换原始价格区间，再同步冻结范围并恢复每条序列的 provider，覆盖窄幅、极小价格、负值及跨零指标。
- 分屏局部坐标选择由统一设置函数提交并与实际价格轴比较；主题/样式同步保留局部选择，共享坐标模式真正改变时仍同步分屏。
- 测量、导航按钮和菜单使用亮暗主题语义色，覆盖悬停、按下、选中、焦点、禁用和展开状态。菜单支持上下键与 Esc。取消、失焦、第二触点、行情切换及销毁清理临时手势。
- 底层仍是当前项目的 Lightweight Charts 5.1；此次验收的是上表的操作契约。未引入 TradingView Supercharts 产品或 Advanced Charts SDK。

## 验证记录

- 导航行为测试 18 项，覆盖事件所有权、轴缩放、锚点、Shift 测量、两次点击/反向框选、自动适配、焦点隔离、取消/销毁、非线性坐标及主题。
- 新增设置迁移回归；相关图表、指标、布局、历史、绘图与视口测试合计 200 项，195 通过。5 项失败分别为收藏栏源码形状、分屏分析调用形状、提及 token、旧加号菜单、VPVR reload 签名；使用 HEAD 原始 Renderer 源码重新运行相同五项，全部复现，未隐瞒既有失败。
- 类型检查通过；生产构建通过，保留原有 chunk 体积提示。
- Electron 39 使用原生鼠标和键盘事件，在明暗主题各验证主图与分屏：横纵拖动、轴拖动/滚轮、普通/修饰键滚轮、测量、两次点击及拖动框选、快捷键、主题/行情保持、时间轴、窗格与分屏最大化恢复、输入框隔离。三种坐标模式 × 普通/极小价格 × 两种主题共 12 组框选几何检查通过。
- 主图/指标窗格切换后，放大工具保持正确选中；取消后按钮状态恢复。模拟行情目录为空时夹具产生的两条目录加载日志为预期测试条件。

可复现原生输入验收：从 `youle_desktop` 启动 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5183 --strictPort`，另一个终端运行 `node node_modules/electron/cli.js scripts/trading-chart-navigation-visual-qa.cjs`。夹具为 `test/fixtures/trading-chart-navigation.html`，仅使用模拟行情及隔离的测试用户目录，不连接真实交易账户。结果和双主题截图写到 `.cache/tradingview-navigation/`。

此次为本地源码与验证交付。未修改客户端发行版本，未打包、安装、提交、推送或发布。

## M1-317 审查修复

M1-316 发现的空图、分屏坐标切换和过期测量问题已实施修复；详细根因、实现和验收记录见 [审查及修复记录](tradingview-chart-review-20260919.zh-CN.md)。新增持久集成脚本 `scripts/trading-chart-navigation-regression-qa.cjs`，沿用上述 Vite 和隔离行情夹具，结果输出 `.cache/tradingview-regression/`。
