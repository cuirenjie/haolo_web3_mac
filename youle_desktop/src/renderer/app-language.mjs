import {
  SIMPLIFIED_UI_CHARACTERS,
  TRADITIONAL_UI_CHARACTERS,
} from "./app-language-traditional-map.mjs";
import { GENERATED_ENGLISH_UI_PHRASES } from "./app-language-en-generated.mjs";
import { GENERATED_TRADITIONAL_UI_PHRASES } from "./app-language-zh-tw-generated.mjs";

export const APP_LANGUAGE_STORAGE_KEY = "haolo.appearance.language";

export const APP_LANGUAGES = Object.freeze(["en", "zh-CN", "zh-TW"]);

const ENGLISH_UI_PHRASES = Object.freeze({
  "请确认": "Please confirm",
  "确定": "Confirm",
  "确认": "Confirm",
  "取消": "Cancel",
  "关闭": "Close",
  "保存": "Save",
  "删除": "Delete",
  "编辑": "Edit",
  "重命名": "Rename",
  "创建": "Create",
  "添加": "Add",
  "移除": "Remove",
  "返回": "Back",
  "继续": "Continue",
  "完成": "Done",
  "重试": "Retry",
  "刷新": "Refresh",
  "搜索": "Search",
  "清空": "Clear",
  "复制": "Copy",
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
  "当前版本": "Current version",
  "暂无更新说明。": "No release notes available.",
  "发现必须更新版本": "Required update available",
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
  "在系统看板中查看": "View in the system dashboard",
  "请输入": "Enter ",
  "”后，与它相连的线也会删除，不会自动跨过该节点重连。": "”. Its connections will also be deleted and will not be reconnected around the node automatically.",
  "在": "at",
  "订单号：": "Order number: ",
  "请使用": "Use ",
  "支付 USDT，并确保收款账号和三位小数金额完全一致。": " to pay USDT. Make sure the recipient account and three-decimal amount match exactly.",
  "会员服务协议》  · 订单号": "Membership Service Agreement · Order number ",
  "会员服务协议》  · 订单编号": "Membership Service Agreement · Order number ",
  "请通过": "Pay through ",
  "网络支付 USDT，金额必须精确到三位小数。": ". Pay USDT on this network using the exact three-decimal amount.",
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
  "等级": "Level",
  "积分余额": "Points balance",
  "订阅余额": "Subscription balance",
  "基础版": "Basic",
  "专业版": "Professional",
  "旗舰版": "Flagship",
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

const HAN_TEXT_PATTERN = /[\u3400-\u9fff]/u;
const LATIN_BUTTON_TEXT_PATTERN = /[A-Za-z]/u;
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
  ".conversation-row-title",
  ".titlebar-profile-name",
  ".row-name-text",
  ".thread-history-entry-text",
  ".thread-history-option-text",
  ".composer-thread-reference-name",
  ".library-preview-content",
  ".settings-storage-copy strong",
].join(",");

let currentAppLanguage = "en";
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
  return isAppLanguage(value) ? value : "en";
}

export function loadAppLanguage(storage = globalThis.localStorage) {
  try {
    return normalizeAppLanguage(storage?.getItem?.(APP_LANGUAGE_STORAGE_KEY));
  } catch {
    return "en";
  }
}

export function appLanguageLocale(language = currentAppLanguage) {
  const normalized = normalizeAppLanguage(language);
  return normalized === "en" ? "en-US" : normalized;
}

export function appLanguageOptions(language = currentAppLanguage) {
  const normalized = normalizeAppLanguage(language);
  if (normalized === "zh-CN") {
    return [
      { value: "en", label: "英语" },
      { value: "zh-CN", label: "简体中文" },
      { value: "zh-TW", label: "繁体中文" },
    ];
  }
  if (normalized === "zh-TW") {
    return [
      { value: "en", label: "英語" },
      { value: "zh-CN", label: "簡體中文" },
      { value: "zh-TW", label: "繁體中文" },
    ];
  }
  return [
    { value: "en", label: "English" },
    { value: "zh-CN", label: "Simplified Chinese" },
    { value: "zh-TW", label: "Traditional Chinese" },
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
  const source = String(value ?? "");
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
  const translated = translateAppText(source, language);
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
