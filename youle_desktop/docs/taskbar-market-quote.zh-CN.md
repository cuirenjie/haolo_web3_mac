# Windows 任务栏行情

当前 K 线工作区通过 `app:setTaskbarMarketQuote` 每秒同步所选主图交易对。任务栏行情窗第一行显示品种及合约类型，第二行显示与顶部收藏栏同口径的最新价和 24 小时涨跌幅。价格变化保留 800 毫秒红绿提示，涨跌幅独立着色。切换品种只允许使用新交易对的统计或 ticker，加载中显示 `--`。

Windows 原生任务栏按钮不提供两行彩色内容接口，因此采用独立、无焦点、无任务栏按钮的透明 Electron 窗口。只读 PowerShell/.NET UI Automation 辅助进程读取主任务栏按钮边界；优先选择 HaoLo 图标右侧空隙，按空间在 132–161 DIP 间调整宽度。被其他按钮占用时寻找右侧可用空隙，没有足够空间则隐藏。它不会修改任务栏设置、固定顺序，也不向 Explorer 注入代码。窗口跟随系统任务栏亮暗主题，点击恢复客户端。

客户端最小化时保持行情更新；离开 K 线工作区、关闭到托盘、退出客户端、Renderer 崩溃／刷新、任务栏自动隐藏或前台全屏时隐藏。几何信息超过 4 秒未刷新时隐藏，Renderer 超过 10 秒未同步时释放窗口和辅助进程。辅助进程异常退出后间隔 30 秒重试，父进程退出或 stdin 关闭时自动结束。目前定位主屏幕水平任务栏；无法确认 Haolo 图标位置时不显示。

本功能复用工作区已有行情，不增加行情网络订阅。活动行情窗启用期间关闭主 Renderer 的后台节流，工作区本身仍使用既有后台绘制节流；停止时恢复 Chromium 默认后台节流。

在仓库根目录验证：

```powershell
node --test youle_desktop/test/taskbar-market-quote.test.mjs youle_desktop/test/taskbar-unread-badge.test.mjs
node youle_desktop/scripts/typecheck.mjs
& .\youle_desktop\node_modules\.bin\electron.cmd youle_desktop/scripts/taskbar-market-quote-qa.cjs
```

原生烟测需要任务栏已有 HaoLo 图标，且其右侧存在至少 132 DIP 空隙。使用隔离 profile 和示例行情，结束自动清理；浅色／深色截图写入 `output/taskbar-market-quote-qa/`。不连接账户、不改变正在运行的客户端状态。新增主进程模块沿用现有 `src/main/*.mjs` 与 `src/main/*.cjs` 打包范围，开发版需重启主进程加载 IPC 和窗口控制器。
