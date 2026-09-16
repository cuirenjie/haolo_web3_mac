import {
  SIMPLIFIED_UI_CHARACTERS,
  TRADITIONAL_UI_CHARACTERS,
} from "./app-language-traditional-map.mjs";
import { GENERATED_ENGLISH_UI_PHRASES } from "./app-language-en-generated.mjs";
import { GENERATED_TRADITIONAL_UI_PHRASES } from "./app-language-zh-tw-generated.mjs";

export const APP_LANGUAGE_STORAGE_KEY = "haolo.appearance.language";

export const APP_LANGUAGES = Object.freeze(["en", "zh-CN", "zh-TW"]);

const ENGLISH_UI_PHRASES = Object.freeze({
  "正在由大模型识别问题意图；需要盘面时将进入行情分析与画线智能体。": "The model is identifying the intent. Market questions will continue with the market-analysis and chart-drawing agents.",
  "会话记录将在后台自动重试保存，盘面分析继续。": "The conversation will retry saving in the background while market analysis continues.",
  "会话记录将在后台自动重试保存，不影响本次回答。": "The conversation will retry saving in the background without affecting this response.",
  "交易会话任务仍在初始化": "The trading conversation task is still initializing",
  "当前盘面问题": "Current market question",
  "关于“": "Regarding “",
  "”：当前无法取得至少两根可核验的实时 K 线，因此现在不能负责任地给出多空、入场价或目标位。": "”: fewer than two verifiable real-time candles are available, so no responsible direction, entry, or target can be given yet.",
  "我没有用旧行情或臆测数字替代实时盘面。行情连接恢复后，沿用同一问题即可自动读取当前图表并重新计算。": "I did not substitute stale market data or invented numbers for the live market. Once the connection recovers, ask the same question to read the current chart and recalculate automatically.",
  "正在按你的要求打开": "Opening as requested: ",
  "的目标 K 线；未指定周期时继承发送时左侧图表周期，未指定市场类型时优先匹配当前可用市场。": " target candles. If no interval is specified, the left chart interval at send time is used; if no market type is specified, the currently available market is preferred.",
  "已按你的要求停止本次盘面分析。": "This market analysis was stopped as requested.",
  "已完成盘面数据可用性检查，并给出与当前可验证信息匹配的回答。": "Market-data availability has been checked, and the response matches the currently verifiable information.",
  "增强暂不可用，已自动切换到通用价格结构链路继续回答。": "Enhanced analysis is temporarily unavailable. Continuing with the general price-structure path.",
  "通用价格结构": "general price structure",
  "根 K 线的兼容分析": " candles for compatible analysis",
  "与安全绘图": " and safe chart drawing",
  "币安已经连接成功。": "Binance is connected.",
  "Haolo 会结合你的账户余额、持仓和风险敞口提供更有针对性的分析。": "Haolo will use your account balance, positions, and risk exposure to provide more targeted analysis.",
  "查看教學": "View tutorial",
  "查看教学": "View tutorial",
  "暂时无法打开支付教程，请稍后重试。": "Unable to open the payment tutorial right now. Please try again later.",
  "Telegram-\u597d\u54af": "Telegram-HaoLo",
  "日线": "Daily",
  "周线": "Weekly",
  "震荡等待": "Range-bound; wait",
  "基于当前": "Based on the current ",
  "已收盘 K 线，盘面暂时": " closed candles, the market is currently ",
  "；做多需等待收盘站上": "; a long setup requires a close above ",
  "，止损失效参考": ", with invalidation near ",
  "；做空需等待收盘跌破": "; a short setup requires a close below ",
  "；站上": "; consider a long only above ",
  "后再考虑多，跌破": ", or a short only below ",
  "后再考虑空，区间中间不追单。": ". Avoid chasing trades in the middle of the range.",
  "当前关键支撑约为": "Current key support is approximately ",
  "，关键压力约为": ", and key resistance is approximately ",
  "；价格没有有效离开这个区间前按震荡处理。": ". Treat price as range-bound until it decisively leaves this range.",
  "，依据是最近价格变化": ", based on the latest price change of ",
  "%，且现价位于": "%, with the current price inside the ",
  "结构区间内。": " structure range.",
  "；上破": "; a break above ",
  "才确认转强，跌破": " confirms strength, while a break below ",
  "才确认转弱。": " confirms weakness.",
  "指定分析增强暂时不可用，本次已自动采用本地确定性价格结构引擎；结论和画线只引用当前真实 K 线。": "The requested analysis enhancement is temporarily unavailable, so the local deterministic price-structure engine was used. Conclusions and drawings reference only the current real candles.",
  "本次由本地确定性价格结构引擎完成。": "Completed by the local deterministic price-structure engine.",
  "，本次已自动采用本地确定性价格结构引擎；结论和画线只引用当前真实 K 线。": ". The local deterministic price-structure engine was used. Conclusions and drawings reference only the current real candles.",
  "，已自动切换到本地确定性价格结构分析。": ". Switched to local deterministic price-structure analysis.",
  "- 当前价：": "- Current price: ",
  "- 支撑 / 压力：": "- Support / resistance: ",
  "- 多头触发 / 失效 / 目标：": "- Long trigger / invalidation / target: ",
  "- 空头触发 / 失效 / 目标：": "- Short trigger / invalidation / target: ",
  "- 数据范围：": "- Data range: ",
  "K 线，最新数据": " candles; latest data ",
  "以上是条件式盘面判断，不是收益承诺；未收盘突破不作为确认。": "This is conditional market analysis, not a promise of returns. An unclosed breakout is not confirmation.",
  "本地确定性价格结构引擎": "Local deterministic price-structure engine",
  "· 待收盤": " · awaiting close",
  "· 待收盘": " · awaiting close",
  "蠟燭形態": "Candlestick pattern",
  "蜡烛形态": "Candlestick pattern",
  "## 辅助分屏说明": "## Auxiliary pane notes",
  "：该辅助分屏暂未纳入主图结论；主图分析和回答不受影响。": ": this auxiliary pane is not included in the main-chart conclusion; the main-chart analysis and response are unaffected.",
  "更改样式、图标颜色、开盘时间、工具栏等": "Change styles, icon colors, market open time, toolbar, and more",
  "主图分析继续有效；已纳入": "The main-chart analysis remains valid; ",
  "个辅助分屏暂未参与结论。": " auxiliary panes were not included in the conclusion.",
  "暂未找到": "Could not find ",
  "的可用行情，已自动改为分析发送时的当前图表": " market data. Falling back to the current chart at send time: ",
  "K 线快照；切换交易对或会话不会改变本次任务目标。": " candle snapshot. Switching the trading pair or conversation will not change this task's target.",
  "指定行情暂时不可用，已自动回到发送时的当前图表": "The requested market data is temporarily unavailable. Falling back to the current chart at send time: ",
  "增强暂不可用，已自动切换到本地确定性价格结构分析。": "Enhanced analysis is temporarily unavailable. Switched to local deterministic price-structure analysis.",
  "画布提交暂时不可用，分析结果已保留；图表恢复后可按同一目标重新绘制。": "Canvas submission is temporarily unavailable. The analysis result was preserved and can be redrawn for the same target after the chart recovers.",
  "绘图目标与任务快照不一致：": "The drawing target does not match the task snapshot: ",
  "Drawing Patch 未能应用到目标会话": "The drawing patch could not be applied to the target conversation",
  "请确认": "Please confirm",
  "确定": "Confirm",
  "确认": "Confirm",
  "取消": "Cancel",
  "关闭": "Close",
  "保存": "Save",
  "删除": "Delete",
  "删除指定会话": "Delete selected conversations",
  "处理中…": "Working…",
  "无法读取完整会话列表，请稍后重试": "Unable to load the complete conversation list. Please try again later.",
  "本组暂无可删除的会话": "There are no conversations to delete in this group",
  "分组：": "Group: ",
  "会话数量：": "Conversations: ",
  "请选择要删除的会话，可多选。": "Select the conversations to delete. You can select more than one.",
  "仅删除勾选的会话，删除后不可恢复。未勾选的会话、分组及文件夹将保留。": "Only selected conversations will be deleted. This cannot be undone. Unselected conversations, the group and its folder will be kept.",
  "如勾选自动任务，对应任务也将停止执行。": "Selected scheduled tasks will also stop running.",
  "已选择：": "Selected: ",
  "所选会话中有会话正在运行，请等待完成或停止后再删除": "Some selected conversations are running. Wait for them to finish or stop them before deleting.",
  "部分所选会话未删除，请稍后重试": "Some selected conversations were not deleted. Please try again later.",
  "所选会话已删除": "Selected conversations have been deleted",
  "编辑": "Edit",
  "重命名": "Rename",
  "创建": "Create",
  "添加": "Add",
  "点击+调用策略、指标、预警和文件": "Click + to use strategies, indicators, alerts, and files",
  "点击+调用策略、指标、预警和文档": "Click + to use strategies, indicators, alerts, and files",
  "移除": "Remove",
  "返回": "Back",
  "继续": "Continue",
  "完成": "Done",
  "重试": "Retry",
  "该交易对已下架或不受 Binance 支持": "This trading pair is delisted or unsupported by Binance",
  "，点击返回 BTC/USDT": ". Click to return to BTC/USDT",
  "刷新": "Refresh",
  "搜索": "Search",
  "清空": "Clear",
  "复制": "Copy",
  "放大": "Zoom in",
  "缩小": "Zoom out",
  "便利贴": "Sticky note",
  "AI 文字标注字号调节": "Adjust AI annotation text size",
  "缩小当前图表全部标注文字": "Decrease all annotation text on the current chart",
  "放大当前图表全部标注文字": "Increase all annotation text on the current chart",
  "当前图表全部标注文字": "all annotation text on the current chart",
  "当前图表全部 AI 标注已": "All AI annotations on the current chart have been",
  "AI 标注：": "AI annotation: ",
  "；当前字号": "; current font size",
  "当前图表全部 AI 标注字号，所在标注当前": "All AI annotation text sizes on the current chart; selected annotation is currently",
  "当前图表全部 AI 标注字号": "All AI annotation text sizes on the current chart",
  "执行卡片文字与便利贴操作": "Execution card text and sticky-note controls",
  "暂时无法读取这张执行卡片，请刷新后重试": "This execution card is temporarily unavailable. Refresh and try again.",
  "当前版本暂不支持桌面便利贴": "This version does not support desktop sticky notes.",
  "执行卡片便利贴已固定到桌面": "The execution-card sticky note is pinned to your desktop.",
  "便利贴窗口未创建": "The sticky-note window was not created.",
  "创建便利贴失败：": "Failed to create sticky note: ",
  "绘图目标工作区已失效": "The drawing target workspace is no longer active",
  "绘图目标与当前行情不一致：": "The drawing target does not match the current market: ",
  "Drawing Patch 未能应用到当前图表": "The drawing patch could not be applied to the current chart",
  "K 线及低周期子浪。": "candles and lower-timeframe subwaves.",
  "发送时行情快照不足": "The market snapshot captured at send time is insufficient",
  "分屏行情已过期，本次分析跳过该分屏并以主图当前行情为准": "This pane's market data is stale. This analysis skips the pane and uses the main chart's current market data.",
  "正在强制刷新当前行情快照（忽略缓存）后再分析。": "Refreshing the current market snapshot without using the cache before analysis.",
  "当前行情快照不足": "The current market snapshot is insufficient",
  "未返回可用的当前 K 线数据": "No usable current candle data was returned",
  "当前行情快照刷新未完成，已阻止使用旧 K 线分析": "The current market snapshot refresh did not complete. Analysis using stale candles was blocked.",
  "行情已切换，请重新发起分析": "The market or interval has changed. Please start the analysis again.",
  "下载": "Download",
  "上传": "Upload",
  "导入": "Import",
  "导出": "Export",
  "设置": "Settings",
  "设置分类": "Settings categories",
  "个人资料": "Profile",
  "消耗明细": "Usage details",
  "模型服务": "Model services",
  "通用设置": "General",
  "关于&反馈": "About & feedback",
  "邀请有礼": "Referral rewards",
  "推广会员，获得 USDT 返佣": "Refer members and earn USDT commission",
  "退出登录": "Sign out",
  "退出中...": "Signing out...",
  "固定在桌面任务栏": "Pin to taskbar",
  "固定在开始菜单": "Pin to Start menu",
  "开机启动": "Launch at startup",
  "消息弹窗": "Task notifications",
  "主题外观": "Appearance",
  "白天模式": "Light",
  "夜间模式": "Dark",
  "字体大小": "Font size",
  "小": "Small",
  "默认": "Default",
  "中": "Medium",
  "大": "Large",
  "语言": "Language",
  "英语": "English",
  "简体中文": "Simplified Chinese",
  "繁体中文": "Traditional Chinese",
  "选择界面语言": "Select interface language",
  "用户数据": "User data",
  "导出中": "Exporting",
  "导入中": "Importing",
  "用户安装目录地址": "Installation directory",
  "导出诊断报告": "Export diagnostics",
  "导出中…": "Exporting…",
  "检查更新": "Check for updates",
  "检查中...": "Checking...",
  "下载中...": "Downloading...",
  "意见反馈": "Feedback",
  "用户协议": "Terms of service",
  "隐私政策": "Privacy policy",
  "进入官网": "Visit website",
  "客服微信": "WeChat support",
  "联系Telegram": "Contact Telegram",
  "联系客服": "Contact support",
  "暂时无法打开网页版客服，请稍后重试。": "Unable to open web support right now. Please try again later.",
  "当前版本": "Current version",
  "暂无更新说明。": "No release notes available.",
  "发现必须更新版本": "Required update available",
  "此版本必须更新后才能继续使用。": "You must install this update to continue using Haolo.",
  "发现新版本": "Update available",
  "最新版本": "Latest version",
  "安装包大小": "Installer size",
  "下载进度": "Download progress",
  "下载完成": "Download complete",
  "下载中": "Downloading",
  "下载更新": "Download update",
  "稍后更新": "Update later",
  "立即安装": "Install now",
  "新任务": "New task",
  "账户": "Account",
  "计划": "Plans",
  "预警": "Alerts",
  "项目": "Projects",
  "联系人": "Contacts",
  "新的请求": "New requests",
  "智能体": "Agents",
  "大模型": "Models",
  "GPT-6 Astra 大模型": "GPT-6 Astra model",
  "技能": "Skills",
  "技能/插件": "Skills / plugins",
  "技能和插件": "Skills and plugins",
  "插件": "Plugins",
  "技能广场": "Skill marketplace",
  "我的技能": "My skills",
  "发现": "Discover",
  "素材": "Library",
  "结果": "Results",
  "自动任务": "Automations",
  "任务": "Tasks",
  "系统面板": "System panel",
  "系统看板": "System dashboard",
  "群聊": "Group chat",
  "频道": "Channel",
  "历史记录": "History",
  "搜索联系人": "Search contacts",
  "清空联系人搜索": "Clear contact search",
  "联系人加载中...": "Loading contacts...",
  "暂无联系人": "No contacts yet",
  "搜索中...": "Searching...",
  "没有找到匹配的联系人": "No matching contacts",
  "邀请联系人": "Invite contacts",
  "添加联系人": "Add contacts",
  "开始对话": "Start conversation",
  "添加到频道": "Add to channel",
  "请选择要调用桌面智能体的联系人": "Select contacts to use desktop agents",
  "已是联系人": "Already a contact",
  "待你验证": "Awaiting your approval",
  "昵称": "Nickname",
  "请输入昵称": "Enter a nickname",
  "邀请码": "Referral code",
  "邀请码（选填）": "Referral code (optional)",
  "请输入邀请码": "Enter referral code",
  "点击设置头像": "Choose profile picture",
  "手机号": "Phone number",
  "邮箱": "Email",
  "验证码": "Verification code",
  "发送验证码": "Send code",
  "重新发送": "Resend",
  "发送中…": "Sending…",
  "登录": "Sign in",
  "注册": "Sign up",
  "激活": "Activate",
  "下一步": "Next",
  "上一步": "Previous",
  "手机号登录": "Sign in with phone",
  "邮箱登录": "Sign in with email",
  "微信登录": "Sign in with WeChat",
  "请输入手机号": "Enter phone number",
  "请输入邮箱": "Enter email address",
  "请输入验证码": "Enter verification code",
  "请输入 6 位验证码": "Enter the 6-digit code",
  "搜索技能": "Search skills",
  "没有匹配的技能": "No matching skills",
  "技能详情": "Skill details",
  "安装": "Install",
  "卸载": "Uninstall",
  "已安装": "Installed",
  "安装中...": "Installing...",
  "卸载中...": "Uninstalling...",
  "启用": "Enable",
  "停用": "Disable",
  "已启用": "Enabled",
  "已停用": "Disabled",
  "连接": "Connect",
  "断开连接": "Disconnect",
  "已连接": "Connected",
  "未连接": "Not connected",
  "连接 GitHub": "Connect GitHub",
  "重新连接 GitHub": "Reconnect GitHub",
  "等待 GitHub 授权…": "Waiting for GitHub authorization…",
  "刷新状态": "Refresh status",
  "授权仓库": "Authorize repositories",
  "查看 GitHub 账号": "View GitHub account",
  "断开中…": "Disconnecting…",
  "GitHub 授权已过期": "GitHub authorization expired",
  "尚未连接 GitHub": "GitHub is not connected",
  "重新授权后即可继续以本人身份操作": "Reauthorize to continue as yourself",
  "连接时会跳转到 GitHub 官方授权页": "You will be redirected to GitHub for authorization",
  "API 密钥": "API key",
  "密钥": "Secret key",
  "显示密钥": "Show secret",
  "隐藏密钥": "Hide secret",
  "提交": "Submit",
  "绑定 Binance API": "Connect Binance API",
  "验证邮箱并解除绑定": "Verify email and disconnect",
  "去绑定": "Connect now",
  "查看教程": "View tutorial",
  "还未绑定 API": "API not connected",
  "账户数据加载失败": "Failed to load account data",
  "正在加载 Binance 账户数据": "Loading Binance account data",
  "预估总资产": "Estimated total assets",
  "保证金余额": "Margin balance",
  "今日盈亏": "Today's P&L",
  "今日已实现盈亏": "Today's realized P&L",
  "钱包余额 (USD)": "Wallet balance (USD)",
  "未实现盈亏 (USD)": "Unrealized P&L (USD)",
  "可用余额 (USD)": "Available balance (USD)",
  "占用保证金 (USD)": "Used margin (USD)",
  "资产": "Assets",
  "持仓": "Positions",
  "当前委托": "Open orders",
  "仓位历史": "Position history",
  "收益日历": "Profit calendar",
  "暂无持仓": "No positions",
  "暂无当前委托": "No open orders",
  "暂无仓位历史": "No position history",
  "正在刷新账户数据": "Refreshing account data",
  "刷新账户数据": "Refresh account data",
  "正在刷新": "Refreshing",
  "解除绑定": "Disconnect",
  "隐藏资产": "Hide balances",
  "显示资产": "Show balances",
  "本月": "This month",
  "查看上个月": "View previous month",
  "查看下个月": "View next month",
  "盈利": "Profit",
  "亏损": "Loss",
  "无交易": "No trades",
  "盈亏已隐藏": "P&L hidden",
  "空": "Short",
  "多": "Long",
  "全仓": "Cross",
  "逐仓": "Isolated",
  "永续": "Perpetual",
  "交易专家": "Trading expert",
  "视频专家": "Video expert",
  "策略": "Strategies",
  "指标": "Indicators",
  "知识库": "Knowledge base",
  "自定义指标": "Custom indicators",
  "趋势带": "Trend band",
  "缠论": "Chan Theory",
  "订单流": "Order Flow",
  "波浪理论": "Elliott Wave Theory",
  "威科夫": "Wyckoff Method",
  "谐波形态": "Harmonic Patterns",
  "图表形态学": "Chart Patterns",
  "裸K分析": "Price Action",
  "道氏理论": "Dow Theory",
  "江恩理论": "Gann Theory",
  "SMT 背离": "SMT Divergence",
  "布林带": "Bollinger Bands",
  "均线": "Moving Averages",
  "基于确定性缠论结构分析当前K线并生成可验证的条件执行方案": "Analyze the current candlestick chart with deterministic Chan structures and generate a verifiable conditional execution plan.",
  "结合真实主动成交盘口深度持仓量与市场结构生成订单流执行方案": "Combine real aggressive trades, order-book depth, open interest, and market structure to generate an order-flow execution plan.",
  "严格按艾略特波浪硬规则复核主备计数并生成条件式执行方案": "Validate primary and alternate Elliott Wave counts against strict rules and generate a conditional execution plan.",
  "依据量价交易区间阶段与事件证据生成威科夫条件执行方案": "Use volume-price trading ranges, phases, and event evidence to generate a Wyckoff conditional execution plan.",
  "识别七种谐波形态、PRZ 与确认条件并生成可执行方案": "Identify seven harmonic patterns, potential reversal zones (PRZ), and confirmation conditions to generate an actionable plan.",
  "识别反转、延续与双向图表形态并生成标准条件式执行方案": "Identify reversal, continuation, and bilateral chart patterns and generate a standard conditional execution plan.",
  "仅用OHLC识别市场结构、K线形态并生成条件执行场景": "Use OHLC data only to identify market structure and candlestick patterns, and generate conditional execution scenarios.",
  "识别三层趋势、收盘确认与次级回撤，输出条件执行方案": "Identify primary, secondary, and minor trends, close confirmation, and secondary retracements to produce a conditional execution plan.",
  "校准价格与时间尺度，绘制江恩角度线、方格、轮中轮和数字螺旋价位": "Calibrate price and time scales, and draw Gann angles, grids, Wheels within Wheels, and numerical spiral price levels.",
  "用相关市场与 Hyperliquid 数据确认跨市场背离": "Confirm cross-market divergence using correlated markets and Hyperliquid data.",
  "识别流动性、结构转变、FVG/OB，并输出条件方案": "Identify liquidity, market structure shifts, fair value gaps (FVG), and order blocks (OB) to produce a conditional plan.",
  "分析布林带压缩扩张、沿带运行和经典形态并生成条件执行方案": "Analyze Bollinger Band squeezes and expansions, band walks, and classic patterns to generate a conditional execution plan.",
  "分析均线排列、交叉、粘合发散与回踩并生成条件执行方案": "Analyze moving-average alignment, crossovers, convergence and divergence, and pullbacks to generate a conditional execution plan.",
  "分析八大经典形态、交叉、动能与顶底背离并生成条件方案": "Analyze eight classic MACD patterns, crossovers, momentum, and bullish or bearish divergences to generate a conditional plan.",
  "分析RSI超买超卖、中心线、失败摆动与背离并生成条件执行方案": "Analyze RSI overbought and oversold levels, centerline behavior, failure swings, and divergences to generate a conditional execution plan.",
  "分析KDJ金叉死叉、超买超卖、钝化状态与背离形态并生成条件执行方案": "Analyze KDJ golden and death crosses, overbought and oversold conditions, saturation, and divergences to generate a conditional execution plan.",
  "分析可见范围成交量分布、POC、价值区、关键支撑阻力与市场接受度": "Analyze visible-range volume distribution, POC, value areas, key support and resistance levels, and market acceptance.",
  "通过趋势蜡烛与均线带识别行情方向，辅助观察趋势延续与转折": "Identify market direction with trend candles and moving-average bands, helping assess continuation and reversals.",
  "请输入任务说明": "Enter the mission statement",
  "交易对": "Trading pair",
  "周期": "Interval",
  "周期已自动应用。": "Intervals applied automatically.",
  "行情": "Market",
  "现货": "Spot",
  "合约": "Futures",
  "市价": "Market",
  "限价": "Limit",
  "买入": "Buy",
  "卖出": "Sell",
  "止盈": "Take profit",
  "止损": "Stop loss",
  "价格": "Price",
  "数量": "Quantity",
  "方向": "Direction",
  "状态": "Status",
  "时间": "Time",
  "详情": "Details",
  "备注": "Notes",
  "名称": "Name",
  "描述": "Description",
  "类型": "Type",
  "来源": "Source",
  "操作": "Actions",
  "全部": "All",
  "未开始": "Not started",
  "进行中": "In progress",
  "已完成": "Completed",
  "已取消": "Cancelled",
  "失败": "Failed",
  "成功": "Succeeded",
  "等待中": "Waiting",
  "加载中...": "Loading...",
  "加载中…": "Loading…",
  "暂无数据": "No data",
  "暂无内容": "No content",
  "暂无结果": "No results",
  "暂无记录": "No records",
  "发生错误": "Something went wrong",
  "未知错误": "Unknown error",
  "创建新任务": "Create new task",
  "输入@引用附件/技能/会话/提示词": "Type @ to reference attachments, skills, conversations, or prompts",
  "描述你想生成的图片，可输入@引用参考图": "Describe the image you want to create; type @ to add references",
  "输入提示词生成视频": "Enter a prompt to generate a video",
  "上传首帧图，按照你的提示生成视频": "Upload a first frame and describe the video",
  "发送": "Send",
  "停止": "Stop",
  "语音输入": "Voice input",
  "添加附件": "Add attachment",
  "选择模型": "Select model",
  "选择模式": "Select mode",
  "普通对话": "Chat",
  "图片生成": "Image generation",
  "视频生成": "Video generation",
  "深度研究": "Deep research",
  "计划模式": "Plan mode",
  "执行模式": "Execution mode",
  "思考与规划": "Reasoning and planning",
  "整理执行计划": "Preparing execution plan",
  "读取文件": "Reading files",
  "查找内容": "Searching content",
  "检查环境": "Checking environment",
  "安装依赖": "Installing dependencies",
  "运行检查": "Running checks",
  "执行命令": "Running command",
  "生成图片": "Generating image",
  "生成视频": "Generating video",
  "执行请求": "Processing request",
  "回写聊天结果": "Posting chat result",
  "正在处理": "Processing",
  "处理完成": "Complete",
  "处理失败": "Failed",
  "等待确认": "Awaiting confirmation",
  "等待处理": "Waiting",
  "任务已完成": "Task complete",
  "任务已成功完成。您可以在编辑器中查看结果。": "The task completed successfully. You can view the result in the app.",
  "计划状态已更新": "Plan status updated",
  "执行计划": "Execution plan",
  "当前状态": "Current status",
  "监控中": "Monitoring",
  "监控入场": "Entry monitoring",
  "监控风控": "Risk monitoring",
  "已触发": "Triggered",
  "已暂停": "Paused",
  "待执行": "Pending",
  "执行中": "Active",
  "预警已触发": "Alert triggered",
  "交易条件": "Trading condition",
  "触发时间": "Triggered at",
  "今天": "Today",
  "昨天": "Yesterday",
  "刚刚": "Just now",
  "分钟前": "minutes ago",
  "小时前": "hours ago",
  "天前": "days ago",
  "年": "year",
  "月": "month",
  "日": "day",
  "开始": "Start",
  "开": "Open",
  "高": "High",
  "低": "Low",
  "收": "Close",
  "涨幅": "Change",
  "振幅": "Amplitude",
  "币安": "Binance",
  "1日": "1 day",
  "5分": "5 min",
  "15分": "15 min",
  "天才交易员，你好！我是 Haolo，你的全能交易助理。接下来我们会通过几段简短对话了解你的交易偏好。现在可以开始吗？": "Hello, trader! I'm Haolo, your all-in-one trading assistant. A few short questions will help me understand your trading preferences. Ready to begin?",
  "请输入 Binance API Key": "Enter your Binance API Key",
  "请输入 Binance Secret Key": "Enter your Binance Secret Key",
  "我们已向": "We sent ",
  "发送 6 位验证码，请在 30 分钟内输入。": " a 6-digit verification code. Enter it within 30 minutes.",
  "API Secret 只在主进程使用系统安全存储加密保存，不会进入聊天、日志或数据导出。": "The API Secret is encrypted using secure system storage in the main process. It is never included in chats, logs, or data exports.",
  "验证并解除…": "Verifying and disconnecting…",
  "校验并绑定…": "Validating and connecting…",
  "BTC 永续 1小时收盘时，MA5 下穿 MA20 且 MACD DIF 下穿零轴后提醒。": "Alert when BTC perpetual closes on the 1-hour chart with MA5 crossing below MA20 and MACD DIF crossing below zero.",
  "ETH 永续 15分钟盘中触碰已绑定趋势线时提醒。": "Alert when ETH perpetual touches the linked trend line on the 15-minute chart.",
  "SOL 放量突破前高": "SOL breaks the previous high on rising volume",
  "SOL 永续 4小时收盘突破前高且成交量超过均量 2 倍。": "Alert when SOL perpetual closes above the previous high on the 4-hour chart with volume above twice the average.",
  "BTC 多周期趋势共振": "BTC multi-timeframe trend alignment",
  "BTC 1小时趋势向上，同时 15分钟 RSI 从超卖区回升。": "BTC is trending upward on the 1-hour chart while the 15-minute RSI recovers from oversold levels.",
  "[...引用内容过长，已保留首尾并省略中间部分...]": "[...Referenced content is too long; the beginning and end were kept and the middle was omitted...]",
  "API Key 仅发送到 Electron 主进程，并通过系统安全存储加密；不会写入聊天记录、localStorage、Haolo 配置或用户数据导出。外部模型当前没有终端、文件读写或工具权限。": "The API Key is sent only to the Electron main process and encrypted using secure system storage. It is not written to chats, localStorage, HaoLo configuration, or user data exports. External models have no terminal, file, or tool access.",
  "API 站点": "API endpoint",
  "OKX内部转账": "OKX internal transfer",
  "OKX站内转账": "OKX internal transfer",
  "[过程输出过长，已截断早期内容以保护内存]": "[Process output was too long; earlier content was truncated to protect memory]",
  "GPT 是由 OpenAI 开发的生成式人工智能模型，能够通过自然语言与用户交流，帮助完成写作、学习、编程、分析、创意设计和办公自动化等多种任务。": "GPT is a generative AI model developed by OpenAI. It communicates through natural language and can help with writing, learning, programming, analysis, creative design, office automation, and more.",
  "[续]": "[Continued]",
  "[历史输出过长，已省略中间内容]": "[Historical output was too long; middle content was omitted]",
  "草稿": "Draft",
  "已验证": "Verified",
  "头脑风暴  SVG信息图  前端设计": "Brainstorming  SVG infographics  Front-end design",
  "合集内的工具(": "Tools in this collection (",
  ".zip 文件内需包含 YAML 格式的技能名称和描述": "The .zip file must contain the skill name and description in YAML format",
  "收起预览": "Collapse preview",
  "展开预览": "Expand preview",
  "仅预览前": "Previewing only the first ",
  "可通过下载打开。": "; download the complete file to open it.",
  "页": "page",
  "例如 8645954210:AAHHJ...hbKhQ": "For example: 8645954210:AAHHJ...hbKhQ",
  "去 Telegram 给": "Open Telegram and message ",
  "发消息，或把它加入群聊后 @ 它。": ", or add it to a group chat and mention it with @.",
  "[草稿]": "[Draft]",
  "请输入两个字": "Enter two characters",
  "填写文件夹名": "Enter a folder name",
  "填写分组": "Enter a group",
  "」吗？删除后可重新添加。": "”? You can add it again after deletion.",
  "确定要删除「": "Delete “",
  "」吗？删除后插件文件会从本地插件目录移除。": "”? The plugin files will be removed from the local plugin directory.",
  "来自": "From",
  "· 最近2条消息": "· 2 most recent messages",
  "群昵称": "Group nickname",
  "确定将“": "Remove “",
  "”移出本群吗？移出后将不再接收群消息或参与回应。": "” from this group? They will no longer receive group messages or participate in replies.",
  "选择分组，当前为": "Select group; current group: ",
  "不选择分组": "No group",
  "正在加载会话记录...": "Loading conversation history...",
  "点击在": "Click to view on",
  "清除所选分组": "Clear selected group",
  "请选择分组": "Select a group",
  "已选择分组，创建自动任务后生效": "Group selected. It will apply when the automation is created.",
  "已选择分组，发送任务后会话将归入该分组": "Group selected. This task will move to it when you send a message.",
  "在系统看板中查看": "View in the system dashboard",
  "请输入": "Enter ",
  "”后，与它相连的线也会删除，不会自动跨过该节点重连。": "”. Its connections will also be deleted and will not be reconnected around the node automatically.",
  "在": "at",
  "订单号：": "Order number: ",
  "请使用": "Use ",
  "会员服务协议》  · 订单号": "Membership Service Agreement · Order number ",
  "会员服务协议》  · 订单编号": "Membership Service Agreement · Order number ",
  "请通过": "Pay through ",
  "网络支付 USDT，": "network to pay USDT. ",
  "扣除手续费后，到账金额必须和支付金额一致，精确到三位小数。": "After fees are deducted, the amount received must match the payment amount, to exactly three decimal places.",
  "网络支付 USDT。": "network to pay USDT. ",
  "该地址仅用于本订单，金额按商品固定面额核对。": "This address is reserved for this order and checked against the fixed plan price.",
  "临时地址": "Temporary address",
  "正在向后端申请本订单的专属收款信息。": "Requesting dedicated payment details for this order.",
  "支付接口返回的到账金额无效": "The payment API returned an invalid received amount",
  "已到账 ": "Received ",
  "还需补付 ": "Still due ",
  "USDT  还需补付": "USDT · Still due",
  "请继续向同一临时地址补足，系统会累计到账金额。": "Send the remaining amount to the same temporary address. Received payments are accumulated.",
  "等待补足金额": "Waiting for the remaining amount",
  "临时地址不会分配给其他订单": "This temporary address will not be assigned to another order",
  "到账金额超过订单面额，已转入人工核对；请勿再次付款。": "The amount received exceeds the order total and is under manual review. Do not pay again.",
  "付款已超过自动处理时限，已转入人工核对；请勿重复付款。": "The payment arrived after the automatic-processing window and is under manual review. Do not pay again.",
  "订单已过期且只收到部分款项，已转入人工核对；请勿继续付款。": "The order expired after receiving only part of the payment and is under manual review. Do not send another payment.",
  "实扣": "Amount charged",
  "上一页": "Previous page",
  "下一页": "Next page",
  "充值": "Top up",
  "充值记录": "Payment history",
  "支付方式": "Payment methods",
  "支付步骤": "payment steps",
  "付款步骤": "payment steps",
  "複製": "Copy",
  "USDT 收款二维码": "USDT payment QR code",
  "USDT 收款二維碼": "USDT payment QR code",
  "选择适合你的订阅": "Choose the subscription that fits you",
  "WEB3免费": "WEB3 Free",
  "体验版": "Trial",
  "体验版订阅": "Trial subscription",
  "3天": "3 days",
  "总额度 100 积分·3天会员": "100 total points · 3-day membership",
  "首次开通专享，体验 AI 行情解读与基础交易分析。": "A first-time offer for trying AI market insights and basic trading analysis.",
  "支付成功后 100 积分立即到账": "100 points are credited immediately after payment.",
  "从开通时刻起精确 72 小时有效": "Valid for exactly 72 hours from activation.",
  "到期剩余积分立即清零，每个账户限开通一次": "Unused points are cleared at expiry; limited to one activation per account.",
  "首次专享": "First-time offer",
  "已开通过": "Already activated",
  "体验版仅限每个账户开通一次": "The trial can be activated only once per account.",
  "请先开通体验版或其他套餐": "Activate the trial or another plan first.",
  "当前没有可用积分，请开通体验版或其他套餐后再提问": "You have no available points. Activate the trial or another plan before asking the model.",
  "当前未开通有效体验版或其他套餐，请先开通后再使用盘面分析": "Activate a valid trial or another plan before using market analysis.",
  "暂时无法验证会员权益，请稍后重试": "Unable to verify membership access right now. Please try again shortly.",
  "确认支付信息": "Confirm payment details",
  "确认套餐和支付方式后，再生成本次支付订单。": "Confirm the plan and payment method before generating this payment order.",
  "生成支付信息": "Generate payment details",
  "查看套餐": "View plans",
  "等级": "Level",
  "积分余额": "Points balance",
  "订阅余额": "Subscription balance",
  "基础版": "Basic",
  "专业版": "Professional",
  "旗舰版": "Flagship",
  "月付": "Monthly",
  "年付": "Annual",
  "基础版年付订阅": "Basic annual subscription",
  "专业版年付订阅": "Professional annual subscription",
  "旗舰版年付订阅": "Flagship annual subscription",
  "每月 300 订阅积分·1个月会员": "300 subscription points per month · 1 month of membership",
  "每月 600 订阅积分·1个月会员": "600 subscription points per month · 1 month of membership",
  "每月 1,000 订阅积分·1个月会员": "1,000 subscription points per month · 1 month of membership",
  "10 USDT获得30永久积分": "10 USDT for 30 permanent points",
  "订阅类型": "Subscription type",
  "选择适合你的订阅": "Choose your subscription",
  "每年节省": "Annual savings",
  "% 折扣）": "% discount)",
  "我没有用旧行情或臆测数字替代实时盘面。目标行情或连接恢复后，沿用同一问题即可重新读取指定交易对并重新计算。": "No stale market data or guessed numbers were used in place of live data. Once the target market or connection recovers, retry this question to reload the specified pair and recalculate.",
  "的目标 K 线；未指定周期时使用币安 USDT 永续合约 1 小时周期。": " candles; when no timeframe is specified, the default is Binance USDT perpetuals on the 1-hour chart.",
  "；你问的是空单平仓：反弹并收盘站上压力": "; for your short exit: if price rebounds and closes above resistance at ",
  "附近先减仓或平仓，跌破支撑": " consider reducing or closing near that level; below support at ",
  "后再观察是否继续持有。": ", reassess whether to keep holding.",
  "；你问的是多单处理：收盘跌破支撑": "; for your long position: if price closes below support at ",
  "附近先减仓或平仓，站上压力": " consider reducing or closing near that level; above resistance at ",
  "；这是仓位管理问题，先以支撑": "; for position management, use support at ",
  "和压力": " and resistance at ",
  "作为减仓或继续持有边界，不能只按仓位文字判断。": " as boundaries for reducing or holding; the position description alone is insufficient.",
  "仓位管理": "Position management",
  "直接回答": "Direct answer",
  "盘面依据": "Market evidence",
  "当前盘面更接近": "The current market is closer to ",
  "，现价约": ", with the current price near ",
  "关键位置：支撑": "Key levels: support at ",
  "，压力": ", resistance at ",
  "数据范围：": "Data coverage: ",
  "隐藏字号调节": "Hide font-size controls",
  "已按最新行情完成复核，正在直接回答本次仓位问题。": "Latest market data reviewed. Preparing a direct answer to your position question.",
  "积分包": "Points pack",
  "永久积分": "Permanent points",
  "当前永久积分余额": "Current permanent points balance",
  "永久积分，订阅到期后仍可使用。": "Permanent points remain usable after the subscription expires.",
  "永久积分已到账，订阅到期后仍可使用。": "Permanent points have been credited and remain usable after subscription expiry.",
  "年付方案，按月获得订阅积分。": "Annual plan with points credited monthly.",
  "29 USDT/月·一次支付348 USDT": "29 USDT/month · one payment of 348 USDT",
  "49 USDT/月·一次支付588 USDT": "49 USDT/month · one payment of 588 USDT",
  "59 USDT/月·一次支付708 USDT": "59 USDT/month · one payment of 708 USDT",
  "每月获得300订阅积分，连续12个月": "300 subscription points each month for 12 months",
  "每月获得600订阅积分，连续12个月": "600 subscription points each month for 12 months",
  "每月获得1,000订阅积分，连续12个月": "1,000 subscription points each month for 12 months",
  "一次支付 29 × 12 = 348 USDT": "One payment: 29 × 12 = 348 USDT",
  "一次支付 49 × 12 = 588 USDT": "One payment: 49 × 12 = 588 USDT",
  "一次支付 59 × 12 = 708 USDT": "One payment: 59 × 12 = 708 USDT",
  "每月获得 300 订阅积分": "300 subscription points every month",
  "每月获得 600 订阅积分": "600 subscription points every month",
  "每月获得 1,000 订阅积分": "1,000 subscription points every month",
  "支付成功后30永久积分到账": "30 permanent points credited after payment",
  "优先扣除订阅积分，余额不足再扣永久积分": "Subscription points are used first, then permanent points",
  "30积分包": "30-point pack",
  "适合日常看盘、行情问答与基础策略分析。": "For everyday market monitoring, market Q&A, and basic strategy analysis.",
  "适合持续行情研判、多策略分析与交易计划制定。": "For ongoing market assessment, multi-strategy analysis, and trading-plan development.",
  "适合高频行情分析、复杂策略研究与专业交易辅助。": "For high-frequency market analysis, advanced strategy research, and professional trading assistance.",
  "半年": "six months",
  "支付成功后 1,000 积分立即到账": "1,000 points are credited immediately after payment.",
  "支付成功后 6,000 积分立即到账": "6,000 points are credited immediately after payment.",
  "支付成功后 12,000 积分立即到账": "12,000 points are credited immediately after payment.",
  "1个月有效，未用完到期清零": "Valid for one month; unused points expire at the end of the term.",
  "6个月有效，未用完到期清零": "Valid for six months; unused points expire at the end of the term.",
  "12个月有效，未用完到期清零": "Valid for 12 months; unused points expire at the end of the term.",
  "支持全部基础 AI 能力": "Includes all core AI capabilities.",
  "提前续费时积分叠加、期限顺延": "Early renewal adds points and extends the subscription term.",
  "提前升级时积分叠加、期限顺延": "Early upgrades add points and extend the subscription term.",
  "币安内部转账": "Binance internal transfer",
  "币安站内转账": "Binance internal transfer",
  "币安链BSC 网络": "BNB Smart Chain",
  "波场TRON 网络": "TRON",
  "Arbitrum One 网络": "Arbitrum One",
  "收款账号": "Recipient account",
  "支付金额": "Amount to pay",
  "金额必须完全一致": "Amount must match exactly",
  "实付": "Amount paid",
  "检测到账中": "Checking payment",
  "订单剩余：": "Order expires in: ",
  "剩余": "remaining",
  "累计Token数": "Total tokens",
  "累计积分数": "Total points",
  "最高单日消耗": "Highest daily usage",
  "最长任务时长": "Longest task",
  "登录天数": "Days active",
  "每日 Token 消耗": "Daily token usage",
  "每日积分消耗": "Daily points usage",
  "使用明细": "Usage details",
  "积分消耗": "Points usage",
  "Token消耗": "Token usage",
  "计费项目": "Billing item",
  "实际调用": "Actual calls",
  "任务与计费说明": "Task and billing details",
  "实扣Token": "Tokens charged",
  "实扣积分": "Points charged",
  "当前套餐：": "Current plan: ",
  "关闭确认": "Close confirmation",
  "实时": "Real-time",
  "多条件": "Multiple conditions",
  "仅一次": "Once",
  "重复监控": "Repeat monitoring",
  "随方案托管": "Managed with plan",
  "MA5/MA20死叉预警": "MA5/MA20 bearish crossover alert",
  "MA5/MA20 死叉且 MACD 下穿零轴": "MA5/MA20 bearish crossover + MACD below zero",
  "收盘确认": "On close",
  "多个条件": "Mixed conditions",
  "盘中实时": "Real-time",
  "一次性": "Once",
  "随计划自动管理": "Managed with plan",
  "您的HaoLo号：": "Your HaoLo ID: ",
  "HaoLo号：": "HaoLo ID: ",
  "HaoLo号:": "HaoLo ID: ",
  "HaoLo号": "HaoLo ID",
  "查看订阅余额明细": "View subscription balance details",
  "订阅套餐：": "Subscription plan: ",
  "订阅余额一共": "Total subscription balance: ",
  "已到账": "Credited",
  "剩余未到账": "Pending credit",
  "会员到期时间": "Membership expiration",
  "会员到期": "Membership expired",
  "下次到账时间": "Next credit date",
  "正在检查本地路径": "Checking local path",
  "主题；切换主题后可分别设置另一套颜色。": " theme; switch themes to configure a separate color set.",
  "XABCD 形态": "XABCD pattern",
  "ABCD 形态": "ABCD pattern",
  "项": "items",
  "展开": "Expand",
  "MACD柱": "MACD histogram",
  "## 未完成的分屏": "## Incomplete split chart",
  "最多展示": "Show up to ",
  "增加": "Increase",
  "减少": "Decrease",
  "MACD 副图绘制目标已失效": "The MACD pane drawing target is no longer valid",
  "分屏图表": "Split chart",
  "图表": "Chart",
  "推动浪完成后应继续检查完整调整：Zigzag 必须有 5-3-5 内部证据，Flat/Expanded Flat/Running Flat 必须有 3-3-5 内部证据，Double Three 的 W、X、Y 都必须是已验证调整结构；W 与 Y 的内部三段应具体标为 W:a、W:b、W 与 Y:a、Y:b、Y。端点比例只能用于候选排序，不能替代内部结构证明。若证据不足，直接说明无法确认，不得用“暂定”包装违反硬规则的 5 浪、ABC 或 WXY。": "After an impulse wave completes, continue checking for a complete correction. A Zigzag requires 5-3-5 internal evidence; Flat, Expanded Flat, and Running Flat require 3-3-5 internal evidence; and every W, X, and Y in a Double Three must be a verified corrective structure. Label the three internal segments of W and Y specifically as W:a, W:b, W and Y:a, Y:b, Y. Endpoint ratios may rank candidates but cannot replace internal-structure evidence. If evidence is insufficient, state that it cannot be confirmed; never use a tentative label to disguise a 5-wave, ABC, or WXY structure that violates hard rules.",
  "工作流连接": "Workflow connection",
  "输入框入口连接": "Composer input connection",
  "删除输入框到": "Delete the connection from the composer to ",
  "已上传文件，左右滚动查看更多": "Uploaded files; scroll horizontally to see more",
  "连接到此节点": "Connect to this node",
  "从此节点开始连接": "Start a connection from this node",
  "工作流执行中，节点暂不可查看": "The workflow is running; this node cannot be viewed yet",
  "我会重点检查：": "I will focus on checking:",
  "（拖动调整顺序）": " (drag to reorder)",
  "窗布局": "-pane layout",
  "回到底部": "Scroll to bottom",
});

const TRADITIONAL_UI_PHRASES = Object.freeze({
  "周期已自动应用。": "週期已自動套用。",
  "此版本必须更新后才能继续使用。": "此版本必須更新後才能繼續使用。",
  "WEB3免费": "WEB3免費",
  "体验版": "體驗版",
  "体验版订阅": "體驗版訂閱",
  "总额度 100 积分·3天会员": "總額度 100 積分·3天會員",
  "首次开通专享，体验 AI 行情解读与基础交易分析。": "首次開通專享，體驗 AI 行情解讀與基礎交易分析。",
  "支付成功后 100 积分立即到账": "支付成功後 100 積分立即到賬",
  "扣除手续费后，到账金额必须和支付金额一致，精确到三位小数。": "扣除手續費後，到賬金額必須和支付金額一致，精確到三位小數。",
  "网络支付 USDT。": "網路支付 USDT。",
  "该地址仅用于本订单，金额按商品固定面额核对。": "此地址僅用於本訂單，金額按商品固定面額核對。",
  "临时地址": "臨時地址",
  "正在向后端申请本订单的专属收款信息。": "正在向後端申請本訂單的專屬收款資訊。",
  "支付接口返回的到账金额无效": "支付介面返回的到帳金額無效",
  "已到账 ": "已到帳 ",
  "还需补付 ": "仍需補付 ",
  "USDT  还需补付": "USDT · 仍需補付",
  "请继续向同一临时地址补足，系统会累计到账金额。": "請繼續向同一臨時地址補足，系統會累計到帳金額。",
  "等待补足金额": "等待補足金額",
  "临时地址不会分配给其他订单": "此臨時地址不會分配給其他訂單",
  "到账金额超过订单面额，已转入人工核对；请勿再次付款。": "到帳金額超過訂單面額，已轉入人工核對；請勿再次付款。",
  "付款已超过自动处理时限，已转入人工核对；请勿重复付款。": "付款已超過自動處理時限，已轉入人工核對；請勿重複付款。",
  "订单已过期且只收到部分款项，已转入人工核对；请勿继续付款。": "訂單已到期且只收到部分款項，已轉入人工核對；請勿繼續付款。",
  "从开通时刻起精确 72 小时有效": "從開通時刻起精確 72 小時有效",
  "到期剩余积分立即清零，每个账户限开通一次": "到期剩餘積分立即清零，每個帳戶限開通一次",
  "首次专享": "首次專享",
  "已开通过": "已開通過",
  "体验版仅限每个账户开通一次": "體驗版僅限每個帳戶開通一次",
  "请先开通体验版或其他套餐": "請先開通體驗版或其他套餐",
  "当前没有可用积分，请开通体验版或其他套餐后再提问": "當前沒有可用積分，請開通體驗版或其他套餐後再提問",
  "当前未开通有效体验版或其他套餐，请先开通后再使用盘面分析": "目前未開通有效體驗版或其他套餐，請先開通後再使用盤面分析",
  "暂时无法验证会员权益，请稍后重试": "暫時無法驗證會員權益，請稍後重試",
  "确认支付信息": "確認支付資訊",
  "确认套餐和支付方式后，再生成本次支付订单。": "確認方案和支付方式後，再產生本次支付訂單。",
  "生成支付信息": "產生支付資訊",
  "查看套餐": "查看套餐",
  "适合日常看盘、行情问答与基础策略分析。": "適合日常看盤、行情問答與基礎策略分析。",
  "适合持续行情研判、多策略分析与交易计划制定。": "適合持續行情研判、多策略分析與交易計劃制定。",
  "适合高频行情分析、复杂策略研究与专业交易辅助。": "適合高頻行情分析、複雜策略研究與專業交易輔助。",
  "该交易对已下架或不受 Binance 支持": "該交易對已下架或不受 Binance 支援",
  "，点击返回 BTC/USDT": "，點擊返回 BTC/USDT",
  "联系Telegram": "聯絡 Telegram",
  "联系客服": "聯絡客服",
  "暂时无法打开网页版客服，请稍后重试。": "暫時無法開啟網頁版客服，請稍後再試。",
  "软件": "軟體",
  "设置": "設定",
  "用户": "使用者",
  "用户数据": "使用者資料",
  "数据": "資料",
  "信息": "資訊",
  "视频": "影片",
  "默认": "預設",
  "反馈": "回饋",
  "网络": "網路",
  "链接": "連結",
  "文件夹": "資料夾",
  "文件": "檔案",
  "导入": "匯入",
  "导出": "匯出",
  "加载": "載入",
  "保存": "儲存",
  "登录": "登入",
  "退出登录": "登出",
  "账户": "帳戶",
  "账号": "帳號",
  "联系人": "聯絡人",
  "搜索": "搜尋",
  "项目": "專案",
  "创建": "建立",
  "删除": "刪除",
  "添加": "新增",
  "点击+调用策略、指标、预警和文件": "點擊+調用策略、指標、預警和檔案",
  "点击": "點擊",
  "通过": "透過",
  "支持": "支援",
  "服务器": "伺服器",
  "本地": "本機",
  "后台": "背景",
  "代码": "程式碼",
  "程序": "程式",
  "应用": "應用程式",
  "鼠标": "滑鼠",
  "打印": "列印",
  "硬盘": "硬碟",
  "内存": "記憶體",
});

const HAN_TEXT_PATTERN = /\p{Script=Han}/u;
const LATIN_BUTTON_TEXT_PATTERN = /[A-Za-z]/u;
const TRADING_PERIOD_LABEL_PATTERN = /^(\s*)(\d+)\s*(秒|分|时|日|周|月|年)(\s*)$/u;
const ENGLISH_TRADING_PERIOD_UNITS = Object.freeze({
  秒: "S",
  分: "M",
  时: "H",
  日: "D",
  周: "W",
  月: "MO",
  年: "Y",
});
const TRANSLATABLE_ATTRIBUTES = Object.freeze(["aria-label", "title", "placeholder"]);
const APP_OWNED_LOCALIZATION_SELECTOR = "[data-i18n-owned]";
const SKIP_LOCALIZATION_SELECTOR = [
  "[data-i18n-skip]",
  "[contenteditable='true']",
  "textarea",
  "pre",
  "code",
  ".message-text",
  ".markdown-body",
  ".message-markdown",
  ".message-content-text",
  ".message-user-content",
  ".message-assistant-content",
  ".execution-plan-card-content",
  ".conversation-row-title",
  ".titlebar-profile-name",
  ".row-name-text",
  ".thread-history-entry-text",
  ".thread-history-option-text",
  ".composer-thread-reference-name",
  ".library-preview-content",
  ".settings-storage-copy strong",
].join(",");

let currentAppLanguage = "zh-CN";
let traditionalCharacterMap = null;
let simplifiedCharacterMap = null;
let languageObserver = null;
const translationCache = new Map();
const textLocalizationSources = new WeakMap();
const attributeLocalizationSources = new WeakMap();

function entriesByLength(record) {
  return Object.entries(record).sort(([left], [right]) => right.length - left.length);
}

const ENGLISH_UI_ENTRIES = entriesByLength({
  ...GENERATED_ENGLISH_UI_PHRASES,
  ...ENGLISH_UI_PHRASES,
});
const ENGLISH_UI_EXACT = Object.freeze({
  ...GENERATED_ENGLISH_UI_PHRASES,
  ...ENGLISH_UI_PHRASES,
});
const TRADITIONAL_UI_ENTRIES = entriesByLength({
  ...GENERATED_TRADITIONAL_UI_PHRASES,
  ...TRADITIONAL_UI_PHRASES,
});
const TRADITIONAL_UI_EXACT = Object.freeze({
  ...GENERATED_TRADITIONAL_UI_PHRASES,
  ...TRADITIONAL_UI_PHRASES,
});

function invertTraditionalPhrases(record) {
  const inverted = {};
  for (const [simplified, traditional] of Object.entries(record)) {
    if (HAN_TEXT_PATTERN.test(traditional) && !inverted[traditional]) inverted[traditional] = simplified;
  }
  return inverted;
}

const TRADITIONAL_TO_SIMPLIFIED_ENTRIES = entriesByLength({
  ...invertTraditionalPhrases(GENERATED_TRADITIONAL_UI_PHRASES),
  ...invertTraditionalPhrases(TRADITIONAL_UI_PHRASES),
});

export function isAppLanguage(value) {
  return APP_LANGUAGES.includes(value);
}

export function normalizeAppLanguage(value) {
  return isAppLanguage(value) ? value : "zh-CN";
}

export function readStoredAppLanguage(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem?.(APP_LANGUAGE_STORAGE_KEY);
    return isAppLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export function loadAppLanguage(storage = globalThis.localStorage) {
  return readStoredAppLanguage(storage) || "zh-CN";
}

export function resolveAppLanguagePreference({
  currentLanguage = "zh-CN",
  mainLanguage = null,
  mainPreferenceStored = false,
  rendererLanguage = null,
  userSelected = false,
} = {}) {
  const normalizedCurrentLanguage = normalizeAppLanguage(currentLanguage);
  if (userSelected) return normalizedCurrentLanguage;
  if (mainPreferenceStored && isAppLanguage(mainLanguage)) return mainLanguage;
  if (isAppLanguage(rendererLanguage)) return rendererLanguage;
  if (isAppLanguage(mainLanguage)) return mainLanguage;
  return normalizedCurrentLanguage;
}

export function appLanguageLocale(language = currentAppLanguage) {
  const normalized = normalizeAppLanguage(language);
  return normalized === "en" ? "en-US" : normalized;
}

export function getCurrentAppLanguage() {
  return currentAppLanguage;
}

export function appLanguageOptions() {
  // Native names stay recognizable even when the current UI language is unfamiliar.
  return [
    { value: "en", label: "English" },
    { value: "zh-CN", label: "简体中文" },
    { value: "zh-TW", label: "繁體中文" },
  ];
}

function replacePhrases(value, entries) {
  let translated = value;
  for (const [source, target] of entries) {
    if (translated.includes(source)) translated = translated.split(source).join(target);
  }
  return translated;
}

function simplifiedToTraditionalCharacters(value) {
  if (!traditionalCharacterMap) return value;
  let translated = "";
  for (const character of value) translated += traditionalCharacterMap.get(character) || character;
  return translated;
}

function traditionalToSimplifiedCharacters(value) {
  if (!simplifiedCharacterMap) return value;
  if (!Array.from(value).some((character) => simplifiedCharacterMap.has(character))) return value;
  const phraseNormalized = replacePhrases(value, TRADITIONAL_TO_SIMPLIFIED_ENTRIES);
  let translated = "";
  for (const character of phraseNormalized) translated += simplifiedCharacterMap.get(character) || character;
  return translated;
}

function exactTranslation(value, record) {
  const trimmed = value.trim();
  const translated = record[trimmed];
  if (!translated) return null;
  const start = value.indexOf(trimmed);
  return `${value.slice(0, start)}${translated}${value.slice(start + trimmed.length)}`;
}

export function configureTraditionalCharacterMap(simplified, traditional) {
  const source = Array.from(String(simplified || ""));
  const target = Array.from(String(traditional || ""));
  const map = new Map();
  const reverseMap = new Map();
  for (let index = 0; index < Math.min(source.length, target.length); index += 1) {
    if (source[index] !== target[index]) {
      map.set(source[index], target[index]);
      if (!reverseMap.has(target[index])) reverseMap.set(target[index], source[index]);
    }
  }
  traditionalCharacterMap = map;
  simplifiedCharacterMap = reverseMap;
}

configureTraditionalCharacterMap(SIMPLIFIED_UI_CHARACTERS, TRADITIONAL_UI_CHARACTERS);

export function translateAppText(value, language = currentAppLanguage) {
  const source = String(value ?? "").replace(/\bDeepSeek\s+V4\.1\s+Flash\b/gi, "GPT-6 Astra");
  if (!source || !HAN_TEXT_PATTERN.test(source)) return source;
  const normalized = normalizeAppLanguage(language);
  const canonicalSource = traditionalToSimplifiedCharacters(source);
  if (normalized === "zh-CN") return canonicalSource;
  const cacheKey = `${normalized}\u0000${source}`;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const exact = exactTranslation(
    canonicalSource,
    normalized === "zh-TW" ? TRADITIONAL_UI_EXACT : ENGLISH_UI_EXACT,
  );
  const translated = exact ?? (normalized === "zh-TW"
    ? simplifiedToTraditionalCharacters(replacePhrases(canonicalSource, TRADITIONAL_UI_ENTRIES))
    : replacePhrases(canonicalSource, ENGLISH_UI_ENTRIES));
  if (translationCache.size >= 6_000) translationCache.clear();
  translationCache.set(cacheKey, translated);
  return translated;
}

export function translateTradingPeriodLabel(value, language = currentAppLanguage) {
  const source = String(value ?? "");
  const normalized = normalizeAppLanguage(language);
  const canonicalSource = traditionalToSimplifiedCharacters(source);
  if (normalized !== "en") return translateAppText(canonicalSource, normalized);
  const match = TRADING_PERIOD_LABEL_PATTERN.exec(canonicalSource);
  if (!match) return translateAppText(canonicalSource, normalized);
  return `${match[1]}${match[2]}${ENGLISH_TRADING_PERIOD_UNITS[match[3]]}${match[4]}`;
}

// Chart text must be translated as a complete annotation, before SVG wrapping.
// Translating individual tspans can split terms such as 中枢 into unrelated UI words.
const TRADING_ANNOTATION_ENGLISH_ENTRIES = entriesByLength({
  "看涨": "bullish", "看跌": "bearish", "多头": "bullish", "空头": "bearish", "中性": "neutral",
  "支撑": "support", "压力": "resistance", "位移": "displacement", "等待收盘确认": "wait for close confirmation",
  "已确认": "confirmed", "未确认": "unconfirmed", "有效": "active", "失效": "invalidated", "部分回补": "partially filled",
  "主要订单区": "order block", "关键反转区": "breaker block", "回调缺口": "bullish fair value gap", "反弹缺口": "bearish fair value gap",
  "上方止损集中区": "buy-side liquidity", "下方止损集中区": "sell-side liquidity", "主动买入失衡区": "buy imbalance zone", "主动卖出失衡区": "sell imbalance zone",
  "大额主动买入": "large aggressive buys", "大额主动卖出": "large aggressive sells", "成交密集价": "point of control",
  "趋势转多": "bullish shift", "趋势转空": "bearish shift", "趋势转": "trend shift",
  "当前结构": "current structure", "关键价位": "key levels", "区间内等待": "wait inside the range", "收盘站稳": "hold above at close", "跌破": "below", "上破": "above",
  "已收盘 K 线": "closed candle", "已收盘K线": "closed candle", "当前周期": "current timeframe", "当前价格": "current price",
  "1分钟": "1m", "3分钟": "3m", "5分钟": "5m", "15分钟": "15m", "30分钟": "30m", "1小时": "1H", "2小时": "2H", "4小时": "4H", "6小时": "6H", "12小时": "12H",
  "盘面暂时偏多": "the market is temporarily bullish", "盘面暂时偏空": "the market is temporarily bearish", "盘面暂时中性": "the market is temporarily neutral",
  "订单流分析已完成": "order-flow analysis complete", "订单流与市场结构复核": "order-flow and market-structure review",
  "ICT 市场结构": "ICT market structure", "ICT/SMC 已完成": "ICT/SMC analysis complete", "等待流动性": "wait for liquidity",
  "多头收盘触发": "bullish close trigger", "空头收盘触发": "bearish close trigger", "多头失效": "bullish invalidation", "空头失效": "bearish invalidation",
  "扫描已经正常完成": "scan completed", "暂无有效": "no valid", "继续等待": "continue waiting",
  "隐藏看涨背离": "hidden bullish divergence", "隐藏看跌背离": "hidden bearish divergence",
  "顶背离": "bearish divergence", "底背离": "bullish divergence",
  "暂无有效交叉/背离，继续等待": "no valid crossover or divergence; wait",
  "暂无确认背离/失败摆动，继续等待": "no confirmed divergence or failure swing; wait",
  "看涨失败摆动": "bullish failure swing", "看跌失败摆动": "bearish failure swing",
  "收盘确认": "confirmed at close", "仅观察": "watch only",
  "金叉": "bullish crossover", "死叉": "bearish crossover",
  "超买区": "overbought zone", "超卖区": "oversold zone", "中性区": "neutral zone",
  "上破关键高点": "break above key high", "跌破关键低点": "break below key low",
  "趋势转多": "bullish shift", "趋势转空": "bearish shift",
  "上方止损集中区": "buy-side liquidity", "下方止损集中区": "sell-side liquidity",
  "扫低后收回": "low swept and reclaimed", "扫高后回落": "high swept and rejected",
  "回调缺口": "bullish fair value gap", "反弹缺口": "bearish fair value gap",
  "关键反转区": "breaker block", "主要订单区": "order block",
  "成交密集价": "point of control", "大额主动买入": "large aggressive buys", "大额主动卖出": "large aggressive sells",
  "主动买入密集区": "aggressive buying zone", "主动卖出密集区": "aggressive selling zone",
  "主动买入失衡区": "buy imbalance zone", "主动卖出失衡区": "sell imbalance zone",
  "低位金叉": "low-zone bullish crossover", "高位金叉": "high-zone bullish crossover", "中位金叉": "mid-zone bullish crossover",
  "低位死叉": "low-zone bearish crossover", "高位死叉": "high-zone bearish crossover", "中位死叉": "mid-zone bearish crossover",
  "进入超卖区": "entered oversold zone", "离开超卖区": "exited oversold zone",
  "进入超买区": "entered overbought zone", "离开超买区": "exited overbought zone",
  "上穿 50 中轴": "crossed above the 50 midline", "下穿 50 中轴": "crossed below the 50 midline",
  "D线离开超卖区": "D exited oversold zone", "D线离开超买区": "D exited overbought zone",
  "J线跌破0": "J crossed below 0", "J线上穿100": "J crossed above 100",
  "主计数失效": "main count invalidation", "主计数确认": "main count confirmation",
  "主计数": "main count", "备选": "alternative",
  "已验证倾斜5浪": "validated five-wave diagonal", "标准5浪推动": "five-wave impulse",
  "倾斜5浪": "five-wave diagonal", "标准5浪": "five-wave impulse",
  "WXY调整": "WXY correction", "ABC调整": "ABC correction",
  "区间上沿": "range high", "区间下沿": "range low",
  "吸筹候选条件目标": "accumulation candidate target", "派发候选条件目标": "distribution candidate target",
  "初步支撑": "preliminary support", "初步供应": "preliminary supply",
  "恐慌抛售": "selling climax", "抢购高潮": "buying climax", "自动反应": "automatic reaction",
  "二次测试": "secondary test", "假跌破后收回": "false breakdown reclaimed", "假上破后回落": "false breakout rejected",
  "缩量确认": "low-volume confirmation", "放量上破": "high-volume breakout", "放量下破": "high-volume breakdown",
  "回踩支撑": "support retest", "反抽受压": "resistance retest",
  "关键价位": "key levels", "区间内等待": "wait inside the range", "震荡等待": "ranging; wait",
  "上方压力": "resistance above", "下方支撑": "support below",
  "收盘站稳后再考虑偏多": "consider a bullish bias after a close above",
  "收盘跌破后再考虑偏空": "consider a bearish bias after a close below",
  "上破": "above", "跌破": "below", "偏多": "bullish", "偏空": "bearish",
  "结论": "outlook", "压力": "resistance", "支撑": "support", "确认": "confirmation",
  "中枢": "central zone", "D线": "D line",
}).map(([source, target]) => [source, ` ${target} `]);

export function translateTradingAnnotationText(value, language = currentAppLanguage) {
  const source = String(value ?? "");
  if (!source || !HAN_TEXT_PATTERN.test(source)) return source;
  if (normalizeAppLanguage(language) !== "en") return translateAppText(source, language);
  const canonical = traditionalToSimplifiedCharacters(source);
  const price = "([\\d,.+eE−-]+)";
  let match = new RegExp(`^末端向(上|下)笔[：:]\\s*${price}\\s*→\\s*${price}[；;]\\s*最新确认为(顶|底)分型[。.]?$`, "u").exec(canonical);
  if (match) {
    return `Latest ${match[1] === "上" ? "up" : "down"} stroke: ${match[2]} → ${match[3]}; confirmed ${match[4] === "顶" ? "top" : "bottom"} fractal.`;
  }
  match = new RegExp(`^最近中枢\\s*${price}[–—-]${price}[：:]\\s*最新收盘(位于中枢上方|位于中枢下方|仍在中枢内部)[；;]\\s*关注离开后的回抽确认[。.]?$`, "u").exec(canonical);
  if (match) {
    const position = match[3] === "位于中枢上方" ? "above" : match[3] === "位于中枢下方" ? "below" : "inside";
    return `Latest central zone ${match[1]}–${match[2]}; close ${position} the zone. Watch the post-breakout retest.`;
  }
  match = new RegExp(`^前序关键(顶|底)分型\\s*${price}[：:]\\s*(末笔起点|最近结构参照)[；;]\\s*(跌回关键低点下方则上行结构转弱|升回关键高点上方则下行结构转弱)[。.]?$`, "u").exec(canonical);
  if (match) {
    const reference = match[3] === "末笔起点" ? "stroke origin" : "structure reference";
    const condition = match[4].startsWith("跌") ? "Below the key low weakens the up structure" : "Above the key high weakens the down structure";
    return `Prior ${match[1] === "顶" ? "top" : "bottom"} fractal ${match[2]} (${reference}). ${condition}.`;
  }
  const summary = /^盘面结论[：:]\s*(.*)$/su.exec(canonical);
  if (summary && !HAN_TEXT_PATTERN.test(summary[1])) return `Summary: ${summary[1]}`;
  // Authored analysis content is user history. If it cannot be translated
  // losslessly, keep the source instead of replacing it with an error notice.
  if (summary) return source;
  if (canonical === "起") return "Start";
  const annotation = replacePhrases(canonical, TRADING_ANNOTATION_ENGLISH_ENTRIES)
    .replace(/（(\d+)处）/gu, " ($1 zones)")
    .replace(/（/gu, " (").replace(/）/gu, ")")
    .replace(/：/gu, ": ").replace(/；/gu, "; ").replace(/，/gu, ", ").replace(/。/gu, ".")
    .replace(/｜/gu, " | ").replace(/\s+([:;,.])/gu, "$1").replace(/\s+/gu, " ").trim();
  const translated = HAN_TEXT_PATTERN.test(annotation) ? translateAppText(canonical, "en") : annotation;
  return /\p{Script=Han}/u.test(translated) ? source : translated;
}

function shouldSkipLocalization(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (element?.closest?.(APP_OWNED_LOCALIZATION_SELECTOR)) return false;
  return Boolean(element?.closest?.(SKIP_LOCALIZATION_SELECTOR));
}

function shouldSkipAttributeLocalization(element) {
  if (element?.closest?.(APP_OWNED_LOCALIZATION_SELECTOR)) return false;
  // Textarea values are user-authored content and stay untouched, but their
  // placeholder/title/aria-label are application-owned interface copy.
  if (element?.matches?.("textarea")) {
    return Boolean(element.closest?.("[data-i18n-skip]"));
  }
  return shouldSkipLocalization(element);
}

function simpleButtonLabelNodes(button) {
  const labels = [];
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const owner = node.parentElement;
    const value = String(node.nodeValue ?? "").replace(/\s+/g, " ").trim();
    if (value && !owner?.closest?.('[aria-hidden="true"]')) labels.push(node);
    if (labels.length > 1) break;
    node = walker.nextNode();
  }
  return labels;
}

function syncEnglishButtonLayout(node, language) {
  const button = node.parentElement?.closest?.("button");
  if (!button) return;
  const labels = simpleButtonLabelNodes(button);
  const isSingleEnglishLabel = language === "en"
    && labels.length === 1
    && LATIN_BUTTON_TEXT_PATTERN.test(String(labels[0].nodeValue ?? ""));
  button.toggleAttribute("data-i18n-single-line", isSingleEnglishLabel);
}

function localizeTextNode(node, language) {
  if (shouldSkipLocalization(node)) return;
  const current = String(node.nodeValue ?? "");
  const previous = textLocalizationSources.get(node);
  const source = !previous || current !== previous.rendered ? current : previous.source;
  const translated = node.parentElement?.closest?.("[data-i18n-trading-period-label]")
    ? translateTradingPeriodLabel(source, language)
    : translateAppText(source, language);
  textLocalizationSources.set(node, { source, rendered: translated });
  if (translated !== current) node.nodeValue = translated;
  syncEnglishButtonLayout(node, language);
}

function localizeElementAttributes(element, language) {
  if (shouldSkipAttributeLocalization(element)) return;
  let sources = attributeLocalizationSources.get(element);
  if (!sources) {
    sources = new Map();
    attributeLocalizationSources.set(element, sources);
  }
  for (const name of TRANSLATABLE_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const previous = sources.get(name);
    const source = !previous || value !== previous.rendered ? value : previous.source;
    const translated = translateAppText(source, language);
    sources.set(name, { source, rendered: translated });
    if (translated !== value) element.setAttribute(name, translated);
  }
}

export function localizeAppTree(root, language = currentAppLanguage) {
  if (!root || typeof document === "undefined") return;
  const normalized = normalizeAppLanguage(language);
  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root, normalized);
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE) localizeElementAttributes(root, normalized);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node, normalized);
    else localizeElementAttributes(node, normalized);
    node = walker.nextNode();
  }
}

export function applyAppLanguage(language, { persist = false, root = null } = {}) {
  const normalized = normalizeAppLanguage(language);
  currentAppLanguage = normalized;
  if (typeof document !== "undefined") {
    document.documentElement.lang = appLanguageLocale(normalized);
    document.documentElement.dataset.language = normalized;
    localizeAppTree(root || document.querySelector("#app"), normalized);
  }
  if (persist) {
    try {
      globalThis.localStorage?.setItem?.(APP_LANGUAGE_STORAGE_KEY, normalized);
    } catch {
      // Language switching remains available when persistent storage is blocked.
    }
  }
  return normalized;
}

export function observeAppLanguage(root) {
  languageObserver?.disconnect?.();
  languageObserver = null;
  if (!root || typeof MutationObserver === "undefined") return () => {};
  languageObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") localizeAppTree(mutation.target, currentAppLanguage);
      for (const node of mutation.addedNodes) localizeAppTree(node, currentAppLanguage);
      if (mutation.type === "attributes") localizeAppTree(mutation.target, currentAppLanguage);
    }
  });
  languageObserver.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRIBUTES,
  });
  return () => {
    languageObserver?.disconnect?.();
    languageObserver = null;
  };
}
