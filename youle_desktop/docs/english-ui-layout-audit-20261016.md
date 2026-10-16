# 英文界面与布局审计 · 2026-10-16

本轮针对 Windows 截图中的 `Close起自选`、`指Number`、连接手机按钮与行情标签重叠、自选价格／涨幅表头挤压，以及移动端英文／大字号布局进行排查。两个项目均在用户指定的 Git 根目录修改，保留已有报告生成、发布配置和测试改动。

## Windows 修改

- `app-language-en-reviewed.mjs` 与 `app-language-en-product.mjs` 合计340条独立词条，使用完整专业英文替代逐字拼接。包括 Watchlist、Indices、Last price、24h change、Custom timeframe、Margin、Liquidation price、账户绑定、支付、同步及指数说明。扫描覆盖 renderer 与随包策略的系统文案；用户撰写的消息、会话名称和交易标的标识不属于系统词条。
- 翻译先匹配原始完整短语，再处理规范化文本；增加已审校繁体词条的英文映射，修复繁体切换英文时的错误拼接。片段替换排除历史生成词典中误收的HTML源码。
- 标题栏行情轨道改为随个人信息和手机连接按钮正常排列；图表工具栏空间不足时分行。行情表格保留价格／涨幅列最小空间，分组栏可换行，英文表头可换行，排序箭头拥有独立宽度。顶部交易对与合约标签之间补空格。
- 专项审计使用现有页面及真实行情组件的隔离夹具；窄窗、大字号、明暗主题、下拉框与语言往返均纳入回归。隐藏窗口的几何审计明确使用DOM激活，不声称验证原生鼠标输入。

## 验证与复现

在 Windows 仓库根目录执行：

```powershell
node youle_desktop/scripts/typecheck.mjs
node youle_desktop/node_modules/vite/bin/vite.js build --config youle_desktop/vite.config.mjs
node --test youle_desktop/test/app-language.test.mjs youle_desktop/test/app-language-no-han.test.mjs youle_desktop/test/i18n-layout-regression.test.mjs youle_desktop/test/english-product-copy.test.mjs youle_desktop/test/trading-watchlist.test.mjs
& youle_desktop/node_modules/.bin/electron.cmd youle_desktop/scripts/audit-watchlist-english.mjs
$env:HAOLO_I18N_BUTTON_QA_QUICK='1'
$env:HAOLO_I18N_QA_DOM_INPUT='1'
& youle_desktop/node_modules/.bin/electron.cmd youle_desktop/scripts/audit-i18n-layout.cjs
```

- 文案／布局契约／自选回归53项通过；TypeScript检查及Vite构建通过。
- 行情专项110个状态：窗口1000／1440／1920，右栏280／330／420，默认／大字号，双主题，三个内置分组及新建分组／指数历史对话框。报告 `.tmp/watchlist-english-20261016/report.json`，零失败。
- 主界面审计：主页、个人菜单、资料设置、设置、消费记录、预警；24个页面／主题／100%与150%缩放组合，20个下拉状态，2368个字形样本，最终零失败。报告 `.tmp/english-layout-20261016/report.json`。语言持久化及三语往返在前序完整轮次执行，最终仅CSS／检测器复跑可设置 `HAOLO_I18N_QA_SKIP_LANGUAGE_TRANSITIONS=1`。
- 检测器保留可见文字交叠、控件边界、溢出与汉字残留检查。允许显式标记的表头换行；工具栏的隐藏绝对定位提示框不按scroll extent误判，仍独立检查实际子控件边界。

## 移动端结果

在 `haolo_android_web3` 补齐“删除／完成／设置”；大字号行情行允许增高并保留完整数字，自选按钮约束最大宽度。23页面 × Android/iOS共享Widget × 双主题 × 三种宽度／字号配置，共276组专项布局。相关测试303通过，会员／支付／邀请／设置／行情／绘图扩展449通过，两个运行均有同一个既有外部Windows行情样本比较跳过；不将两组计数相加为独立测试总数。共享Web图表文案／时间轴20项通过，完整Dart静态分析无问题。

充值历史的两张旧golden曾随实际日期失败：仅为用例注入固定日期，原基准图没有更新，复跑全部通过。Android经规定host链路保留数据覆盖安装并启动，设备与本地APK哈希一致，详见移动仓库 `verification/2026-10-16/english-installed.json` 与项目记忆。

未提交、推送或发布。本轮Windows只构建了开发资源，没有生成新安装包；移动端为开发签名Release安装，版本仍0.1.3+4。移动UI遵守项目要求由用户实机复核；iOS仅覆盖共享Widget，未进行原生构建或真机验收。测试夹具和短时启动检查不能替代所有真实账号、远程数据、原生设备及长期运行状态的验收。
