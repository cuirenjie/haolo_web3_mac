import {
  SIMPLIFIED_UI_CHARACTERS,
  TRADITIONAL_UI_CHARACTERS,
} from "./app-language-traditional-map.mjs";
import { GENERATED_ENGLISH_UI_PHRASES } from "./app-language-en-generated.mjs";
import { REVIEWED_ENGLISH_UI_PHRASES } from "./app-language-en-reviewed.mjs";
import { PRODUCT_ENGLISH_UI_PHRASES } from "./app-language-en-product.mjs";
import { GENERATED_TRADITIONAL_UI_PHRASES } from "./app-language-zh-tw-generated.mjs";
import { englishDrawingText } from "./app-language-en-drawing.mjs";

export const APP_LANGUAGE_STORAGE_KEY = "haolo.appearance.language";

export const APP_LANGUAGES = Object.freeze(["en", "zh-CN", "zh-TW"]);

const ENGLISH_UI_PHRASES = Object.freeze({
  "桌面快捷方式": "Desktop shortcut",
  "创建桌面快捷方式": "Create desktop shortcut",
  "桌面快捷方式已就绪": "Desktop shortcut is ready",
  "桌面快捷方式设置失败：": "Failed to update desktop shortcut: ",
  "无法更新桌面快捷方式，请检查桌面目录权限后重试。": "Could not update the desktop shortcut. Check the desktop folder permissions and try again.",
  "收益曲线": "Profit chart",
  "收益率曲线": "Return chart",
  "收益额曲线": "Profit chart",
  "收益率": "Return",
  "收益额": "Profit",
  "收益类型": "Profit display",
  "选择周期": "Select period",
  "{days}日": "{days}D",
  "资产已隐藏": "Balances hidden",
  "暂无历史收益数据": "No profit history yet",
  "正在加载收益曲线…": "Loading profit chart…",
  "收益分析暂时不可用，请刷新重试": "Profit data is unavailable. Please refresh to retry.",
  "已实现盈亏 ÷ 开仓成交金额 × 100%": "Realized P&L ÷ opening notional × 100%",
  "已實現盈虧 ÷ 開倉成交金額 × 100%": "Realized P&L ÷ opening notional × 100%",
  "请重启开发客户端，加载独立渠道上下文功能。": "Restart the development client to load independent channel contexts.",
  "Codex 未返回最终答复。": "Codex did not return a final answer.",
  "渠道消息处理失败：": "Channel message failed: ",
  "移除所有绘图": "Remove all drawings",
  "SVG信息图": "SVG infographic",
  "會員服務協議》": "Membership Service Agreement",
  "会员服务协议》": "Membership Service Agreement",
  "· 訂單編號": "· Order number", "· 订单号": "· Order number",
  "还需补付": "Additional payment required",
  "此分屏的行情快照尚未就绪。": "The market snapshot for this chart pane is not ready yet.",
  "此分屏的行情快照尚未就緒。": "The market snapshot for this chart pane is not ready yet.",
  "分析已完成，图表绘制未完成。": "Analysis is complete, but chart drawing is incomplete.",
  "分析已完成，圖表繪製未完成。": "Analysis is complete, but chart drawing is incomplete.",
  "分析已完成，等待展示结果。": "Analysis is complete and ready to present.",
  "分析已完成，等待展示結果。": "Analysis is complete and ready to present.",
  "行情分析已完成，正在整理持仓评估所需证据。": "Market analysis completed. Preparing evidence for the position review.",
  "行情分析已完成，正在整理持倉評估所需證據。": "Market analysis completed. Preparing evidence for the position review.",
  "已保存 · 未激活提醒": "Saved · Reminder inactive",
  "已儲存 · 未啟用提醒": "Saved · Reminder inactive",
  "激活提醒": "Activate reminder", "啟用提醒": "Activate reminder",
  "正在激活提醒…": "Activating reminder…", "正在啟用提醒…": "Activating reminder…",
  "提醒已激活": "Reminder activated", "提醒已啟用": "Reminder activated",
  "激活未确认，计划仍已保存": "Activation is unconfirmed; the plan is still saved",
  "啟用未確認，計畫仍已儲存": "Activation is unconfirmed; the plan is still saved",
  "正在儲存計畫…": "Saving plan…", "計畫儲存失敗": "Failed to save plan",
  "提醒已激活，本机缓存写入失败，请刷新计划列表核对": "Reminder activated, but the local cache could not be updated. Refresh the plan list to verify.",
  "提醒已啟用，本機快取寫入失敗，請重新整理計畫清單核對": "Reminder activated, but the local cache could not be updated. Refresh the plan list to verify.",
  "预警未确认激活": "Alert activation is unconfirmed", "提醒未確認啟用": "Alert activation is unconfirmed",
  "計畫已結束": "Plan ended",
  "当前版本暂不支持图表截图": "Chart screenshots are not supported in this version",
  "交易图表截图区域无效": "Invalid chart screenshot area",
  "透明度": "Opacity", "选择图片": "Choose image", "JPG, PNG或WEBP": "JPG, PNG or WEBP",
  "请选择 JPG、PNG 或 WEBP 图片": "Choose a JPG, PNG or WEBP image",
  "最大图像大小2MB": "Maximum image size: 2 MB",
  "无法载入图片": "Unable to load image", "无法保存图片": "Unable to save image",
  "行情网关繁忙": "Market gateway is busy",
  "行情网关请求频率受限": "Market gateway rate limit reached",
  "客户端行情请求正在排队": "Client market requests are queued",
  "Binance 行情请求频率受限": "Binance market data rate limit reached",
  "，约": ", about ",
  "更新延迟，显示上次数据": "Update delayed; showing previous data",
  "该指数暂无可用历史数据": "No historical data is available for this index",
  "图表暂不可用，请重试": "Chart unavailable. Please try again.",
  "该指数不支持此周期，请选择已支持的周期。": "This interval is unavailable for this index. Choose a supported interval.",
  "样式": "Style", "交易分析未返回有效结果": "Trading analysis returned no valid result",
  "左肩": "Left shoulder", "头部": "Head", "右肩": "Right shoulder",
  "入場": "Entry", "入场": "Entry",
  "已平仓": "Closed", "开仓": "Open", "风险/回报比": "Risk/reward ratio",
  "同根 K 线同时触及止盈止损，按止损计算": "Both levels touched in the same bar; stop is assumed first",
  "每分钟": "Every minute", "每时": "Hourly", "获取时间": "Fetched",
  "涨跌幅为24小时口径。": "Changes cover 24 hours.",
  "帖子": "X post", "插入指向X帖子的链接": "Insert a link to an X post",
  "请重启客户端后再添加帖子": "Restart the app before adding a post",
  "无法读取该帖子，请检查链接或网络后重试": "Unable to load this post. Check the link or network and try again.",
  "已清除本次待确认草稿和模拟图层。": "The pending draft and simulation overlay have been cleared.",
  "这是规则理解演示，不代表收益回测或未来预测。": "This demonstrates the interpreted rules. It is not a performance backtest or forecast.",
  "请核对模拟 K 线与文字条件。回复“确认”后才会": "Review the simulated candles and conditions. Reply “Confirm” to ",
  "请核对模拟 K 线与文字条件。明确表示接受当前模拟后才会": "Review the simulated candles and conditions. Clearly accept this simulation to ",
  "明确表示接受当前模拟后才会创建监控": "Monitoring is created only after you clearly accept this simulation",
  "；也可以取消，或直接说明需要修改的条件。": "; you may also cancel or describe the conditions to change.",
  "；回复“取消”，或直接说明需要修改的条件。": "; reply “Cancel”, or describe the conditions to change.",
  "创建监控": "create monitoring",
  "确定删除这个计划吗？": "Delete this plan?",
  "本轮没有确认当前预演。请回复“确认并启用”，或说明需要修改的规则后重新模拟。": "The current preview was not confirmed. Reply “Confirm and activate”, or describe changes and simulate again.",
  "本轮没有确认当前模拟。请回复“确认”，或说明需要修改的条件后重新模拟。": "The current simulation was not confirmed. Reply “Confirm”, or describe changes and simulate again.",
  "请说明是接受当前模拟、修改条件，还是取消；明确接受后才会创建预警。": "Please say whether you accept this simulation, want changes, or want to cancel. The alert is created only after clear acceptance.",
  "本轮没有确认当前模拟。请说明需要修改的条件后重新模拟，或明确接受当前模拟。": "This reply did not confirm the simulation. Describe changes to simulate again, or clearly accept the current simulation.",
  "仓位调整方案": "Position management plan",
  "倉位調整方案": "Position management plan",
  "添加自定义颜色": "Add custom color", "不透明度": "Opacity", "不透明度百分比": "Opacity percentage",
  "十六进制颜色": "Hex color", "饱和度和明度": "Saturation and brightness", "色相": "Hue", "增加": "Add", "返回色板": "Back to palette",
  "MACD柱样式": "MACD histogram style",
  "成交量样式": "Volume bar style",
  "实心柱": "Solid bars",
  "空心柱": "Hollow bars",
  "空心柱仅显示边框，柱高和颜色保持不变。": "Hollow bars show only an outline, keeping the same height and colors.",
  "周期设置": "Timeframe settings",
  "关闭指标设置": "Close indicator settings",
  "隐藏绘图": "Hide drawings",
  "隐藏AI画线": "Hide AI drawings",
  "隐藏手动画线": "Hide manual drawings",
  "隐藏AI绘图": "Hide AI drawings",
  "隐藏手动绘图": "Hide manual drawings",
  "隐藏仓位线": "Hide position lines",
  "隐藏计划线": "Hide plan lines",
  "仅影响当前会话，隐藏不会删除画线。": "Applies only to this conversation. Hiding preserves your drawings.",
  "API Key 无效，请重新绑定": "Invalid API Key. Please reconnect your account.",
  "账户数据请求繁忙，稍后自动重试。": "Account data requests are busy. Retrying automatically shortly.",
  "币安暂时限制请求，稍后自动重试。": "Binance is limiting requests. Retrying automatically shortly.",
  "请求繁忙，请稍后重试。": "Requests are busy. Please try again shortly.",
  "此 Binance 连接已解绑，请关闭窗口后重新绑定。": "This Binance connection was disconnected. Close this dialog and reconnect your account.",
  "尚未完成 Binance API 绑定，请重新绑定。": "Binance API setup is incomplete. Please reconnect your account.",
  "已达到账户连接数量上限，请解除不用的连接后重试。": "The account connection limit has been reached. Disconnect an unused connection and try again.",
  "已达到设备数量上限，请移除不用的设备后重试。": "The device limit has been reached. Remove an unused device and try again.",
  "本次请求与之前的操作冲突，请关闭窗口后重试。": "This request conflicts with an earlier operation. Close this dialog and try again.",
  "重新绑定": "Reconnect",
  "重新绑定 Binance API": "Reconnect Binance API",
  "验证并重新绑定": "Verify and reconnect",
  "仅申请账户读取权限，Haolo 不会通过此连接下单。": "Read-only account access. Haolo will not place orders through this connection.",
  "1. 入场方式": "1. Entry approach",
  "2. 单笔风险控制": "2. Risk per trade",
  "3. 浮盈保护和盈亏比": "3. Profit protection and risk/reward",
  "4. 分析方式和交易纪律": "4. Analysis and trading discipline",
  "你倾向于哪种入场方式？": "Which entry approach do you prefer?",
  "左侧入场": "Anticipatory entry",
  "右侧入场": "Confirmation-based entry",
  "在结构反应区提前参与，仍须满足结构证据与风险要求。": "Consider entry at a structural reaction zone, subject to sufficient evidence and risk limits.",
  "等待执行周期的确认条件成立后再考虑入场。": "Wait for confirmation on the execution timeframe before considering entry.",
  "左侧和右侧以执行周期为准，与做多做空无关。手动选择不会自动切换；修改仅用于新分析。": "The entry approach refers to the execution timeframe, independently of long or short direction. Manual selections will not switch automatically. Changes apply only to new analyses.",
  "未保存的修改": "Unsaved changes",
  "已保存的偏好": "Saved preference",
  "产品默认值": "Product default",
  "核对本地与云端的交易偏好": "Review local and cloud trading preferences",
  "请选择需要保留的答案。核对完成后，新分析才会使用云端配置。": "Choose the answers to keep. New analysis can use the cloud configuration after this review.",
  "本地保存的答案": "Answer saved on this device",
  "云端保存的答案": "Answer saved in the cloud",
  "部分旧设置需要重新核对。原始记录仍保留在本机。": "Some earlier settings need review. Their original records remain on this device.",
  "查看本地原始记录": "View original local records",
  "使用选中的答案": "Use selected answers",
  "使用云端配置，保留本地记录": "Use cloud settings and keep local records",
  "其他设备已修改交易偏好，请重新加载后核对；本次修改尚未保存。": "Trading preferences changed on another device. Reload and review them; these edits have not been saved.",
  "保存结果待确认": "Save confirmation pending",
  "重试确认": "Retry confirmation",
  "待核对的修改": "Changes to review",
  "配置已更新": "Settings updated",
  "本次交易偏好已保存，但随后有其他更新。请重新打开交易偏好，核对最新配置。": "Your trading preferences were saved, then updated again. Reopen trading preferences to review the latest settings.",
  "服务器已接受保存，但暂时无法确认最新配置。你的修改已保留，请重试确认。": "The server accepted your save, but the latest settings could not be confirmed. Your edits are retained. Retry to confirm.",
  "未收到完整的保存回执，暂时无法确认是否保存成功。你的修改已保留，请重试确认。": "The save response was interrupted, so the result could not be confirmed. Your edits are retained. Retry to confirm.",
  "请先核对本地与云端的交易偏好。": "Review the local and cloud trading preferences first.",
  "自定义内容无法明确理解或与其他设置冲突，请修改。": "This custom answer is unclear or conflicts with other settings. Please revise it.",
  "交易偏好": "Trading preferences",
  "请设置交易偏好，新增左侧入场策略": "Please set your trading preferences. Left-side entry strategies are now available.",
  "天才交易员，你好！我是 Haolo，你的全能交易助理。默认交易偏好已生效。点击“开始”可前往设置查看和修改交易偏好。": "Hello, trader! I'm Haolo, your all-in-one trading assistant. Default trading preferences are already active. Select Start to view or change them in Settings.",
  "1. 单笔风险控制": "1. Risk per trade",
  "2. 浮盈保护和盈亏比": "2. Profit protection and risk/reward",
  "3. 分析方式和交易纪律": "3. Analysis and trading discipline",
  "单笔风险控制": "Risk per trade",
  "浮盈保护和盈亏比": "Profit protection and risk/reward",
  "分析方式和交易纪律": "Analysis and trading discipline",
  "按止损后的实际亏损计算，包含手续费和预估滑点，不是保证金比例。": "Based on actual loss at the stop, including fees and estimated slippage, rather than margin size.",
  "1R 代表最初承担的风险。保本位置包含交易成本，净盈亏比 1:0.4 表示盈利空间至少是止损风险的 0.4 倍。": "1R is the initial risk. Break-even includes trading costs. A net risk/reward ratio of 1:0.4 requires potential profit of at least 0.4 times the stop-loss risk.",
  "已选中你保存的答案，修改后点击下方保存。": "Your saved answers are selected. Save below after making changes.",
  "未设置的项目已按默认交易偏好生效，修改后点击保存。": "Default trading preferences already apply to unset options. Save only after making changes.",
  "正在读取交易偏好…": "Loading trading preferences…",
    "正在校验并保存…": "Validating and saving…",
    "保存失败": "Save failed",
    "自定义内容会先由 AI 理解并校验，全部通过后才会保存生效；无法理解或与题目无关时将提示保存失败。": "AI checks custom answers before saving. All answers must be clear and relevant to their questions; otherwise, saving fails and your existing preferences stay in effect.",
    "内容为空或过长，请简化后重试。": "The content is empty or too long. Please revise it and retry.",
    "交易偏好表单已失效，请重新打开设置。": "The preference form is no longer valid. Please reopen settings.",
    "自定义内容与此题无关，请按题目重新填写。": "This custom answer does not match the question. Please revise it.",
    "无法明确理解自定义要求，请补充清晰的数值、口径或条件。": "The custom requirements are unclear. Please specify the values, basis or conditions.",
    "自定义要求与其他设置或基础交易规则冲突，请修改。": "These requirements conflict with other preferences or basic trading rules. Please revise them.",
    "该自定义要求无法落实为交易偏好，请修改。": "These requirements cannot be applied as trading preferences. Please revise them.",
    "大模型未能返回有效的理解结果，请重试。": "AI did not return a valid interpretation. Please retry.",
    "大模型理解结果不完整，请重试。": "The AI interpretation is incomplete. Please retry.",
    "大模型理解结果无效，请重试。": "The AI interpretation is invalid. Please retry.",
    "大模型返回了不一致的理解结果，请重试。": "The AI interpretation is inconsistent. Please retry.",
    "大模型暂不可用，请稍后重试。": "AI is temporarily unavailable. Please retry later.",
    "大模型理解服务暂不可用或请求超时，请稍后重试。": "AI is unavailable or the request timed out. Please retry later.",
    "交易偏好正在保存，请稍候。": "Trading preferences are being saved. Please wait.",
    "登录账号已变化，请重新打开交易偏好。": "The signed-in account changed. Please reopen trading preferences.",
    "交易偏好保存失败，请重试。": "Trading preferences could not be saved. Please retry.",
    "单笔最大亏损须为账户净值的 0.01%–100%。": "Maximum loss per trade must be 0.01%–100% of account equity.",
    "净收益风险倍数须大于 0 且不超过 100。": "The net reward-to-risk multiple must be greater than 0 and at most 100.",
    "请明确保本触发的 R 倍数，或说明不自动移动保本。": "Specify the R multiple that triggers break-even, or disable automatic break-even.",
    "自定义内容过长，请简化后重试。": "The custom answers are too long. Please shorten them and retry.",
    "浏览器预览无法使用大模型，请在桌面客户端保存自定义偏好。": "AI is unavailable in browser preview. Save custom preferences in the desktop client.",
  "交易偏好读取失败，请重试。": "Could not load trading preferences. Please retry.",
  "交易偏好保存失败，已保留你的修改，请重试。": "Could not save trading preferences. Your changes are retained. Please retry.",
  "自定义说明合计请控制在 2000 字以内。": "Keep all custom notes within 2,000 characters.",
  "补充偏好说明": "Additional preference notes",
  "交易偏好已保存": "Trading preferences saved",
  "有未保存的修改": "Unsaved changes",
  "单笔最大亏损占账户净值的比例": "Maximum loss per trade as a percentage of account equity",
  "2%（推荐）": "2% (recommended)",
  "例如：1.5%，仅在信号充分时交易": "Example: 1.5%, only trade with sufficient signals",
  "何时将止损移动到保本位置？": "When should the stop move to break even?",
  "浮盈达到 0.5R": "At 0.5R unrealized profit",
  "浮盈达到 1R（推荐）": "At 1R unrealized profit (recommended)",
  "浮盈达到 1.5R": "At 1.5R unrealized profit",
  "浮盈达到 2R": "At 2R unrealized profit",
  "不自动移动保本": "Do not automatically move the stop to break even",
  "例如：1.2R，保本时覆盖手续费和滑点；或填写“不移动保本”及说明": "Example: 1.2R, include fees and slippage; or choose the option above to disable break-even stops",
  "最低可接受的净盈亏比": "Minimum net risk/reward ratio",
  "1:0.4（推荐）": "1:0.4 (recommended)",
  "例如：1:1.8，仅考虑扣除交易成本后的盈利空间": "Example: 1:1.8, use profit after trading costs",
  "默认分析方式": "Default analysis style",
  "简洁，遇到高风险时详细说明（推荐）": "Concise, with detail for high risk (recommended)",
  "详细，展开分析依据和过程": "Detailed, including reasoning and process",
  "例如：先给结论，再用三条要点解释原因": "Example: give the conclusion first, then explain it in three points",
  "持仓分析和交易计划的内容": "Position analysis and trading plan content",
  "固定包含完整分析栏目（推荐）": "Always include all analysis sections (recommended)",
  "根据当前问题按需选择栏目": "Choose sections to suit the current question",
  "例如：固定包含关键价位、止损、止盈和失效条件": "Example: always include key levels, stop loss, take profit and invalidation",
  "需要补充的交易纪律": "Additional trading rules",
  "不允许亏损加仓": "Do not add to losing positions",
  "不做逆势交易": "Do not trade against the trend",
  "不在重大数据公布前开仓": "Do not open positions before major data releases",
  "不追涨杀跌": "Do not chase rallies or sell into sharp declines",
  "暂无补充，沿用基础交易纪律": "No additional rules; keep the basic trading discipline",
  "填写其他纪律或具体说明，可与上面的选项一起勾选": "Add other rules or details; you can also select the options above",
  "请选择一个选项后继续。": "Select an option to continue.",
  "请填写自定义内容，或选择其他选项。": "Enter your custom answer or choose another option.",
  "自定义内容请控制在 280 字以内。": "Keep custom answers within 280 characters.",
  "请选择有效选项。": "Select a valid option.",
  "暂无补充不能与其他纪律同时选择。": "No additional rules cannot be selected with other rules.",
  "请以 0.01%–100% 的比例开头，说明写在逗号后，例如：1.5%，仅在信号充分时交易。": "Start with a percentage from 0.01% to 100%, then add details after a comma. Example: 1.5%, only trade with sufficient signals.",
  "请以 0.01R–100R 开头，例如：1.2R，说明写在逗号后；也可以填写“不移动保本”。": "Start with a value from 0.01R to 100R, such as 1.2R, then add details after a comma. You can also choose the option to disable break-even stops.",
  "请以 1:正数 开头，收益倍数不超过 100，例如：1:1.8，说明写在逗号后。": "Start with 1: followed by a positive number no greater than 100, such as 1:1.8. Add details after a comma.",
  "选择后确认，可随时修改自定义内容": "Confirm your selections; custom answers are editable",
  "可多选": "Select multiple",
  "单选": "Select one",
  "正在保存…": "Saving…",
  "重试保存": "Retry saving",
  "请点击“重试保存”，我会保留你刚才的答案并再次保存。": "Click Retry saving. Your answers will be kept and saved again.",
  "单笔亏损比例需要在账户净值的 0.01%–100% 之间，例如“2%”或“10%”。": "The loss per trade must be between 0.01% and 100% of account equity, for example 2% or 10%.",
  "确认并保存": "Confirm and save",
  "确认并继续": "Confirm and continue",
  "按包含手续费和预估滑点后的实际亏损计算，不是保证金比例。账户净值为 10,000 USDT 时，2% 代表最多亏损约 200 USDT。": "Use the actual loss including fees and estimated slippage, rather than margin. With 10,000 USDT in equity, 2% means a maximum loss of about 200 USDT.",
  "请选择下方的风险比例，或勾选“自定义”填写比例和说明。确认后继续下一组。": "Choose a risk percentage below or select Custom to enter a percentage and details. Confirm to continue.",
  "1R 代表最初承担的风险。保本位置包含手续费和预估滑点；净盈亏比 1:0.4 表示盈利空间至少是止损风险的 0.4 倍。": "1R is the initial risk. Break-even levels include fees and estimated slippage. A net risk/reward ratio of 1:0.4 means potential profit is at least 0.4 times the stop-loss risk.",
  "请分别选择保本条件和最低净盈亏比。每项都可以勾选“自定义”填写数值和说明。": "Choose the break-even condition and minimum net risk/reward ratio separately. Each supports a custom value and details.",
  "完整分析栏目包括：仓位健康度、风险校验、关键价位、入场条件、止损、止盈、仓位大小和失效条件。": "The full analysis includes position health, risk checks, key levels, entry conditions, stop loss, take profit, position size and invalidation.",
  "请选择分析方式和内容，交易纪律可多选，也可以勾选“自定义”补充要求。确认后保存。": "Choose the analysis style and content. Select multiple trading rules or add custom requirements, then confirm to save.",
  "你的自定义说明：": "Your custom details: ",
  "包含近期会话内容，请仅发送给官方客服。": "Includes recent conversation content. Share only with official support.",
  "确定性结构已完成": "Deterministic structure is ready",
  "正在进行模型复核": "Reviewing with the model",
  "账户只读快照已准备完成": "Read-only account snapshot is ready",
  "正在合并执行计划": "Merging the execution plan",
  "账户只读快照暂不可用": "Read-only account snapshot is unavailable",
  "继续使用无账户上下文分析": "Continuing without account context",
  "模型复核已完成": "Model review completed",
  "正在整理结果": "Preparing the result",
  "最多同时选择3个不同策略": "You can select up to 3 different strategies at once",
  "最多同时选择3个不同策略。": "You can select up to 3 different strategies at once.",
  "分析阶段已完成": "Analysis stage completed",
  "连手机": "Connect phone",
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
  "框选放大（点击起点和终点，或拖动框选）": "Zoom area (click two points or drag a rectangle)",
  "快速测量（Shift + 点击或拖动）": "Measure (Shift + click or drag)",
  "重置图表（Alt + R）": "Reset chart (Alt + R)",
  "重置图表": "Reset chart",
  "锁定 K 线": "Lock candles",
  "开启后，价格随可见 K 线自动适配；关闭后可自由上下拖动。": "When enabled, prices auto-fit visible candles. Turn off to drag vertically.",
  "恢复默认缩放并回到最新 K 线。": "Restore the default zoom and return to the latest candle.",
  "自动适配价格": "Auto scale",
  "锁定并自动适配价格": "Lock and auto-fit prices",
  "已锁定：随可见 K 线自动适配价格（点击恢复自由拖动）": "Locked: auto-fit visible candles (click to resume free dragging)",
  "自由拖动（点击锁定并自动适配价格）": "Free dragging (click to lock and auto-fit prices)",
  "默认以鼠标位置缩放；滚轮或键盘加减键缩放时，价格轴随可见 K 线自动适配，完整显示最高价和最低价。手动调轴后，下次缩放或双击价格轴会恢复自动适配，不影响成交量等副图。": "Zoom follows the cursor by default. Wheel and keyboard plus/minus zoom automatically fit the visible candle highs and lows. After a manual price adjustment, zoom again or double-click the price axis to restore auto scale. Volume and other indicator axes are unaffected.",
  "主图价格坐标": "Main chart price scale",
  "主图": "Main",
  "自动适配主图价格": "Auto scale main chart prices",
  "自动适配副图": "Auto scale indicator pane",
  "主图自动适配：已开启（点击关闭）": "Main chart auto scale: on (click to turn off)",
  "主图自动适配：已关闭（点击适配可见 K 线）": "Main chart auto scale: off (click to fit visible candles)",
  "主图对数坐标：已开启（点击恢复线性坐标）": "Main chart log scale: on (click for linear scale)",
  "主图对数坐标：已关闭（点击开启）": "Main chart log scale: off (click to turn on)",
  "对数坐标（Alt + L）": "Logarithmic scale (Alt + L)",
  "百分比坐标（Alt + P）": "Percentage scale (Alt + P)",
  "反转坐标（Alt + I）": "Invert scale (Alt + I)",
  "向左移动": "Scroll left",
  "向右移动": "Scroll right",
  "K 线图表": "Price chart",
  "图表操作栏": "Chart controls",
  "拖动可移动图表操作栏": "Drag to move the chart controls",
  "隐藏图表操作栏（移出图表后重新进入可恢复）": "Hide chart controls (leave and re-enter the chart to restore)",
  "隐藏字号调节（移出图表后重新进入可恢复）": "Hide text size controls (leave and re-enter the chart to restore)",
  "根 K 线": "bars",
  "以光标位置缩放 K 线（Ctrl + 滚轮始终聚焦光标）": "Zoom at cursor (Ctrl + wheel always focuses the cursor)",
  "以最右侧位置缩放 K 线（Ctrl + 滚轮聚焦光标）": "Zoom at right edge (Ctrl + wheel focuses the cursor)",
  "缩小": "Zoom out",
  "便利贴": "Sticky note",
  "AI 文字标注字号调节": "Adjust AI annotation text size",
  "拖动可移动字号工具栏": "Drag to move the text size toolbar",
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
  "客服": "Support",
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
  "今日": "Today",
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
  "会员充值": "Membership",
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
  "您的积分不足，请充值或开通会员": "You do not have enough points. Recharge or activate a membership.",
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
  "删除 AI 标注": "刪除 AI 標註",
  "AI 标注已删除": "AI 標註已刪除",
  "桌面快捷方式": "桌面捷徑",
  "创建桌面快捷方式": "建立桌面捷徑",
  "桌面快捷方式已就绪": "桌面捷徑已就緒",
  "桌面快捷方式设置失败：": "桌面捷徑設定失敗：",
  "无法更新桌面快捷方式，请检查桌面目录权限后重试。": "無法更新桌面捷徑，請檢查桌面目錄權限後重試。",
  "周期设置": "週期設定",
  "指标设置": "指標設定",
  "关闭指标设置": "關閉指標設定",
  "API Key 无效，请重新绑定": "API Key 無效，請重新綁定",
  "账户数据请求繁忙，稍后自动重试。": "帳戶資料請求繁忙，稍後自動重試。",
  "币安暂时限制请求，稍后自动重试。": "幣安暫時限制請求，稍後自動重試。",
  "请求繁忙，请稍后重试。": "請求繁忙，請稍後重試。",
  "此 Binance 连接已解绑，请关闭窗口后重新绑定。": "此 Binance 連線已解除綁定，請關閉視窗後重新綁定。",
  "尚未完成 Binance API 绑定，请重新绑定。": "尚未完成 Binance API 綁定，請重新綁定。",
  "已达到账户连接数量上限，请解除不用的连接后重试。": "已達到帳戶連線數量上限，請解除不用的連線後重試。",
  "已达到设备数量上限，请移除不用的设备后重试。": "已達到裝置數量上限，請移除不用的裝置後重試。",
  "本次请求与之前的操作冲突，请关闭窗口后重试。": "本次請求與之前的操作衝突，請關閉視窗後重試。",
  "重新绑定": "重新綁定",
  "重新绑定 Binance API": "重新綁定 Binance API",
  "验证并重新绑定": "驗證並重新綁定",
  "核对本地与云端的交易偏好": "核對本機與雲端的交易偏好",
  "请选择需要保留的答案。核对完成后，新分析才会使用云端配置。": "請選擇需要保留的答案。核對完成後，新分析才會使用雲端設定。",
  "本地保存的答案": "本機儲存的答案",
  "云端保存的答案": "雲端儲存的答案",
  "部分旧设置需要重新核对。原始记录仍保留在本机。": "部分舊設定需要重新核對。原始記錄仍保留在本機。",
  "查看本地原始记录": "查看本機原始記錄",
  "使用选中的答案": "使用選取的答案",
  "使用云端配置，保留本地记录": "使用雲端設定，保留本機記錄",
  "其他设备已修改交易偏好，请重新加载后核对；本次修改尚未保存。": "其他裝置已修改交易偏好，請重新載入後核對；本次修改尚未儲存。",
  "保存结果待确认": "儲存結果待確認",
  "重试确认": "重試確認",
  "待核对的修改": "待核對的修改",
  "配置已更新": "設定已更新",
  "本次交易偏好已保存，但随后有其他更新。请重新打开交易偏好，核对最新配置。": "本次交易偏好已儲存，但隨後有其他更新。請重新開啟交易偏好，核對最新設定。",
  "服务器已接受保存，但暂时无法确认最新配置。你的修改已保留，请重试确认。": "伺服器已接受儲存，但暫時無法確認最新設定。你的修改已保留，請重試確認。",
  "未收到完整的保存回执，暂时无法确认是否保存成功。你的修改已保留，请重试确认。": "未收到完整的儲存回執，暫時無法確認是否儲存成功。你的修改已保留，請重試確認。",
  "请先核对本地与云端的交易偏好。": "請先核對本機與雲端的交易偏好。",
  "请设置交易偏好，新增左侧入场策略": "請設定交易偏好，新增左側入場策略",
  "自定义内容无法明确理解或与其他设置冲突，请修改。": "無法明確理解自訂內容，或其與其他設定衝突，請修改。",
  "包含近期会话内容，请仅发送给官方客服。": "包含近期對話內容，請僅傳送給官方客服。",
  "连手机": "連接手機",
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
  "您的积分不足，请充值或开通会员": "您的積分不足，請充值或開通會員",
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
let traditionalEnglishPhrases = null;
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
  ...REVIEWED_ENGLISH_UI_PHRASES,
  ...PRODUCT_ENGLISH_UI_PHRASES,
}).filter(([source]) => !/\b(?:aria-[\w-]+|data-[\w-]+|class|role|title|style)=|<\/?[a-z][^>]*>/iu.test(source));
const ENGLISH_UI_EXACT = Object.freeze({
  ...GENERATED_ENGLISH_UI_PHRASES,
  ...ENGLISH_UI_PHRASES,
  ...REVIEWED_ENGLISH_UI_PHRASES,
  ...PRODUCT_ENGLISH_UI_PHRASES,
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
  traditionalEnglishPhrases = null;
  translationCache.clear();
}

configureTraditionalCharacterMap(SIMPLIFIED_UI_CHARACTERS, TRADITIONAL_UI_CHARACTERS);

function reviewedTraditionalEnglish() {
  if (traditionalEnglishPhrases) return traditionalEnglishPhrases;
  const phrases = Object.create(null);
  for (const catalog of [ENGLISH_UI_PHRASES, REVIEWED_ENGLISH_UI_PHRASES, PRODUCT_ENGLISH_UI_PHRASES]) {
    for (const [source, english] of Object.entries(catalog)) {
      const traditional = exactTranslation(source, TRADITIONAL_UI_EXACT)
        ?? simplifiedToTraditionalCharacters(replacePhrases(source, TRADITIONAL_UI_ENTRIES));
      phrases[traditional] = english;
    }
  }
  traditionalEnglishPhrases = phrases;
  return phrases;
}

export function translateAppText(value, language = currentAppLanguage) {
  const source = String(value ?? "").replace(/\bDeepSeek\s+V4\.1\s+Flash\b/gi, "GPT-6 Astra");
  if (!source || !HAN_TEXT_PATTERN.test(source)) return source;
  const normalized = normalizeAppLanguage(language);
  const canonicalSource = traditionalToSimplifiedCharacters(source);
  if (normalized === "zh-CN") return canonicalSource;
  const cacheKey = `${normalized}\u0000${source}`;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const exact = (normalized === "en"
    ? exactTranslation(source, ENGLISH_UI_EXACT) ?? exactTranslation(source, reviewedTraditionalEnglish())
    : null) ?? exactTranslation(
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

export function translateDrawingText(value, language = currentAppLanguage, section = false) {
  const source = String(value ?? "");
  if (!HAN_TEXT_PATTERN.test(source)) return source;
  if (normalizeAppLanguage(language) !== "en") return translateAppText(source, language);
  return englishDrawingText(traditionalToSimplifiedCharacters(source), section) ?? translateAppText(source, language);
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
    && !button.hasAttribute("data-i18n-wrap")
    && labels.length === 1
    && LATIN_BUTTON_TEXT_PATTERN.test(String(labels[0].nodeValue ?? ""));
  button.toggleAttribute("data-i18n-single-line", isSingleEnglishLabel);
}

function localizeTextNode(node, language) {
  if (shouldSkipLocalization(node)) return;
  const current = String(node.nodeValue ?? "");
  const previous = textLocalizationSources.get(node);
  const source = !previous || current !== previous.rendered ? current : previous.source;
  const translated = node.parentElement?.closest?.("[data-i18n-drawing]")
    ? translateDrawingText(source, language, Boolean(node.parentElement.closest("[data-i18n-drawing-section]")))
    : node.parentElement?.closest?.("[data-i18n-trading-period-label]")
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
    const translated = element.closest?.("[data-i18n-drawing]")
      ? translateDrawingText(source, language)
      : translateAppText(source, language);
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
