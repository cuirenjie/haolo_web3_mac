# M1-351 Windows dev 回归测试修复

日期：2026-10-17。基线：`7dd589d02a14c8b0d84f01ec0a41daaa9eef7e52`。
工作目录与 Git 根目录：`C:\Users\潘艳芳\Documents\ChatGPT\haolo_windows_web3`。

用户要求检查并修复上次提交验证的 14 项失败，验证通过后提交远端 dev。基线同组为 233 项、219 通过、14 失败。本轮修改测试与验收记录；核查结果为测试执行方式、翻译作用域和过时源码／布局契约问题，没有据此修改已实现的业务行为。

## 逐项核查

| 原始失败 | 原因与修复 |
|---|---|
| Renderer 英文无汉字扫描 | 新绘图模块使用独立词表，扫描却调用通用翻译并拆开完整动态模板。按绘图作用域、分组标题和默认表格单元格检查；保留全部模块扫描，完整模板使用代表性数字，新增未知文案仍失败及通用／绘图术语隔离检查。 |
| Sidebar actions follow Codex order | 标题栏已改为“连手机”直接菜单，旧断言仍要求“更多”子菜单和自动任务图标。按当前菜单契约验证。 |
| Sidebar recharge navigation | `openRechargePage(targetModel?: string)` 已含 TypeScript 类型，VM 直接执行导致语法错误。先转译再执行实际函数，注入依赖；仍检查会话保存、页面跳转、刷新资料及设置窗口不打开。 |
| Titlebar more menu | 改为检查直接菜单开／关的实际 HTML、ARIA 状态及渠道项目；自动任务入口在计划页，继续检查创建对话框绑定。 |
| Every visible split pane | 播放前新增聚焦回调、辅助失败提示已本地化、通用分析新增独立恢复报告。验证原 options 和聚焦回调，保留失败记录／主图有效提示；使用 AST 逐一检查五个分析方法各自调用分屏分析并合并其报告及叙述，替代全文件调用次数统计。 |
| Trading Expert dedicated presentation | 同上，标题栏不再有自动任务按钮；检查“连手机”入口与计划页创建入口。 |
| Collapsed progress mid-click | 左侧栏按钮已移动至标题栏，选择器范围为 `.trading-expert-shell`；保留指针交互期间禁止替换控件的检查。 |
| Default model and media models | 当前显式选择绕过自动恢复策略，且先做显示模型迁移、再确定 Provider。检查选择优先级、迁移、显式选择、GPT／DeepSeek Provider 和固定推理强度。 |
| Atomic mention tokens | 当前使用本地化 token，同时保留中文规范 token 供原子编辑；继续验证两类 token、插入位置、草稿保存和高亮。 |
| Plus attachment picker | 原生文件对话框已使用 `mainUiText`，不再内嵌中文按钮数组；检查三种语义按钮、取消响应及文件／目录选项。 |
| Compact period bar | 周期栏允许收缩，行情标题允许换行，使用 36px 最小高度。更新布局契约，保留横向滚动与交互样式检查。 |
| Favorites persistence and sorting | 排序控制器现支持横／纵轴，键值与浮层背景均按轴选择。更新源码契约，新增实际键盘事件覆盖两个轴、Alt、越界、禁用及重排后的 ARIA 位置。 |
| Main studies and drawing rail | 绘图样式已迁入被导入的独立 CSS，侧栏宽度为 52px。测试读取两个样式文件，校验导入、宽度变量及底部指标栏对齐。 |
| Live candles and rate limits | 限流同时识别 418、429、rateLimited，并通过 `binanceMarketRetryAfterMs` 区分直连封禁与网关缓存。保留这些边界检查并运行相邻冷却测试。 |

## 验证

- 原 11 个文件全部纳入最终运行，新增语言扫描自检后该组为 **234/234**；原 14 个失败均恢复通过，无跳过或删除测试。
- 加入收藏排序、Binance 限流、绘图视口、分析结果语言、模型选择和计划导航后，**17 个文件、308/308 通过**，零失败、零跳过。
- `node youle_desktop/scripts/typecheck.mjs` 通过。
- `pnpm --dir youle_desktop run build` 通过，仅保留已有的大分块提示。
- `git diff --check` 通过。未运行整个仓库的全部测试，未执行真实模型／真实账户调用或实机 UI 验收。

最终回归命令，从固定仓库根目录执行：

```powershell
$tests = @(
  'conversation-list-minimal', 'trading-chart-navigation',
  'trading-expert-drawing-tools', 'trading-expert-layout',
  'trading-drawing-defaults', 'trading-drawing-extra-tools',
  'trading-drawing-language', 'trading-drawing-pane-clipping',
  'manual-drawing-sync', 'app-language', 'app-language-no-han',
  'trading-expert-favorite-ticker-sort', 'trading-expert-binance-rate-limit',
  'trading-analysis-viewport', 'trading-analysis-result-language',
  'trading-model-selection', 'alerts-auto-tasks-navigation'
)
$testFiles = $tests | ForEach-Object { "youle_desktop/test/$_.test.mjs" }
node --experimental-strip-types --test @testFiles
```

本地证据位于仓库根目录 `.cache/dev-test-repair/`：`baseline.jsonl`、`iteration-1/2/3.jsonl`、`final-tests.jsonl`、`test-files.txt`、`typecheck.log`、`build.log`。最终运行使用同一 Node test runner 的精简报告器保存汇总，退出码为 0；报告器不修改测试或结果。缓存及已有 `youle_desktop/output/` 保留本地，不随源码提交。
