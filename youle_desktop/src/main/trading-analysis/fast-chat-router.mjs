export const TRADING_EXPERT_FAST_CHAT_MODEL = "gpt-5.6-sol";
import { assistantOutputLanguageInstruction } from "../assistant-output-language.mjs";
import { isExplicitMarketAnalysisRequest } from "./request-routing-policy.mjs";

export const TRADING_EXPERT_FAST_CHAT_SOURCE = "trading-expert-fast-chat";
export const TRADING_EXPERT_FAST_CHAT_HANDOFF_TOOL = "handoff_to_agent";

const MAX_FAST_CHAT_TEXT_CHARS = 12_000;

const CHART_OR_MARKET_PATTERNS = [
  /^(?:帮我|请)?(?:分析|看下|看看|看盘|复盘|刷新|更新)(?:一下|下|吧|盘面|走势|行情)?[。.!！?？]*$/iu,
  /(?:画线|划线|标注|支撑位|压力位|阻力位|趋势线|通道线|斐波那契|形态|波浪|缠论|威科夫|谐波|订单流|盘口|成交量|量价|k\s*线|蜡烛图|图表|盘面|看盘|技术分析)/iu,
  /(?:帮我|请|给我|现在|当前|实时|最新|今天|此刻).{0,24}(?:分析|判断|看看|看下|解读|预测|走势|行情|价格|点位|入场|止损|止盈|做多|做空)/iu,
  /(?:btc|eth|sol|bnb|xrp|doge|usdt|比特币|以太坊|币安币|黄金|原油|纳指|标普|股票|期货|永续).{0,32}(?:现在|当前|实时|最新|今天|行情|走势|价格|点位|分析|怎么看)/iu,
  /(?:chart|candlestick|draw\s+(?:a\s+)?line|support|resistance|order\s*flow|volume\s*profile|technical\s+analysis)/iu,
  /(?:current|live|latest|today|right\s+now).{0,32}(?:market|price|chart|trend|setup|entry|stop|target|analysis)/iu,
];

const CURRENT_CHART_PATTERNS = [
  /(?:当前|现在|实时|左侧|这张|这幅|这根|眼前).{0,20}(?:k\s*线|蜡烛|图表|盘面|走势|行情|价格线)/iu,
  /(?:this|the\s+current|on[- ]?screen|left[- ]?hand).{0,20}(?:chart|candlestick|market|price\s+action)/iu,
];

const PRIVATE_CONTEXT_PATTERNS = [
  /(?:我的|本人|我目前|我现在).{0,16}(?:账户|账号|仓位|持仓|余额|资产|资金|保证金|杠杆|订单|挂单|委托|成交记录|交易记录|盈亏|收益|成本价|爆仓价|强平价|风险偏好|交易偏好|个人策略)/iu,
  /(?:查看|读取|查询|检查|根据).{0,12}(?:账户|仓位|持仓|余额|资产|保证金|订单|挂单|委托|成交记录|交易记录|盈亏|成本价|爆仓价|强平价|风险偏好|交易偏好|个人策略)/iu,
  /(?:记忆|记住|忘记|你了解我|关于我的偏好)/iu,
  /(?:my|mine).{0,16}(?:account|portfolio|position|balance|margin|leverage|open\s+orders?|order\s+history|trade\s+history|pnl|risk\s+profile|preference|strategy)/iu,
  /(?:check|read|show|use).{0,12}(?:account|portfolio|position|balance|margin|open\s+orders?|order\s+history|trade\s+history|pnl|risk\s+profile|preference)/iu,
  /(?:memory|remember|forget\s+(?:me|my)|what\s+do\s+you\s+know\s+about\s+me)/iu,
];

const PUBLIC_CONCEPT_PATTERNS = [
  /(?:什么是|是什么意思|含义是什么|如何理解|怎么理解|原理|概念|定义|介绍一下|解释一下|科普|区别|有什么区别|如何计算|怎么计算|公式|优缺点|适用场景)/iu,
  /(?:是什么|为何|为什么|有什么用|怎么用|如何使用)[？?。.!！]?$/iu,
  /(?:what\s+is|what\s+are|define|definition|explain|concept|how\s+(?:does|do|is|are)|formula|calculate|difference\s+between|pros?\s+and\s+cons?)/iu,
];

const CONVERSATION_HISTORY_PATTERNS = [
  /(?:刚才|方才|上一条|上一个|上一轮|前面|之前|你说的|你提到的|按你说的|继续|接着|再展开|这个|那个|上述|上面).{0,32}(?:回答|分析|结论|建议|图|线|位置|价位|点位|方案|内容|问题|说法|目标|止损)?/iu,
  /(?:as\s+you\s+said|your\s+(?:last|previous)\s+(?:answer|analysis)|continue|follow\s+up|above|earlier|previously|that\s+(?:answer|analysis|level|price|target))/iu,
];

const CURRENT_EXTERNAL_INFO_PATTERNS = [
  /(?:最新|今天|今日|刚刚|实时|目前|现在).{0,40}(?:新闻|消息|公告|政策|法规|利率|数据|财报|排名|人物|ceo|总统|主席|发布日期|版本|价格)/iu,
  /(?:搜索|上网|联网|查一下|查新闻|查资料|打开网页|浏览网页)/iu,
  /(?:latest|today|current|real[- ]?time|breaking).{0,40}(?:news|announcement|policy|law|rate|data|earnings|ranking|ceo|president|release|version|price)/iu,
  /(?:search\s+(?:the\s+)?web|browse|look\s+it\s+up|open\s+(?:the\s+)?(?:site|page|url))/iu,
];

const ACTION_OR_LOCAL_RESOURCE_PATTERNS = [
  /(?:打开|关闭|创建|修改|编辑|删除|保存|导出|下载|上传|发送|发布|安装|卸载|运行|执行|调用|切换).{0,40}(?:文件|目录|代码库|项目|应用|设置|策略|预警|订单|仓位|网页|浏览器|终端|命令|脚本|插件|技能)/iu,
  /(?:下单|撤单|平仓|买入|卖出|设置预警|创建策略|保存策略)/iu,
  /(?:文件|附件|图片|截图|视频|音频|路径|目录|代码库|项目|工作区|本机|电脑|剪贴板|终端|shell|命令行|数据库|接口|api\s*key|密钥|令牌|token)/iu,
  /(?:open|close|create|modify|edit|delete|save|export|download|upload|send|publish|install|uninstall|run|execute|call|switch).{0,40}(?:file|folder|repository|project|app|setting|strategy|alert|order|position|browser|terminal|command|script|plugin|skill)/iu,
  /(?:place|cancel|close).{0,12}(?:order|position)|(?:buy|sell).{0,12}(?:btc|eth|stock|coin|contract)/iu,
  /(?:attachment|image|screenshot|video|audio|path|directory|repository|workspace|local\s+machine|clipboard|shell|database|api\s*key|secret|token)/iu,
];

const DIRECT_EXECUTION_ACTION = /(?:下单|撤单|立即平仓|直接平仓|替我买入|帮我买入|替我卖出|帮我卖出|设置预警|创建策略|保存策略|place\s+(?:an?\s+)?order|cancel\s+(?:the\s+)?order|close\s+(?:the\s+)?position)/iu;

export const TRADING_EXPERT_FAST_CHAT_POLICY = [
  "You are HaoLo's low-latency public question-answer lane.",
  "Follow the appended app output-language instruction when present; otherwise answer in the user's language. Keep the answer direct and useful.",
  "You receive only the current public question. You cannot access conversation history, memory, account data, balances, positions, orders, private preferences, the current chart, live market data, files, attachments, the web, the desktop, or any action tools.",
  `If the request needs any unavailable context, current or changing information, personalized financial guidance, chart inspection or drawing, local resources, an action, or prior conversation context, call ${TRADING_EXPERT_FAST_CHAT_HANDOFF_TOOL} exactly once and emit no user-facing text.`,
  "For stable public knowledge, definitions, explanations, writing, translation, brainstorming, and casual conversation, answer directly without calling the tool.",
  "Never imply that you inspected data or context you did not receive.",
].join("\n");

export const TRADING_EXPERT_FAST_CHAT_TOOLS = [{
  type: "function",
  function: {
    name: TRADING_EXPERT_FAST_CHAT_HANDOFF_TOOL,
    description: "Escalate this request to HaoLo's root agent because private context, tools, current data, chart inspection, conversation history, or an action is required.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "A short capability-based reason for the escalation. Do not include private data.",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
}];

export function tradingExpertFastChatEnabled(env = process.env) {
  return String(env?.HAOLO_TRADING_EXPERT_FAST_CHAT || "1").trim() !== "0";
}

export function classifyTradingExpertFastChatRoute(params = {}, options = {}) {
  const text = sanitizeFastChatText(params.text);
  const enabled = options.enabled ?? tradingExpertFastChatEnabled(options.env);
  if (!enabled) return route("agent", "feature-disabled");
  if (!text) return route("agent", "empty-question");
  if (DIRECT_EXECUTION_ACTION.test(text)) {
    return route("agent", "execution-action-required");
  }
  if (isExplicitMarketAnalysisRequest(text)) {
    return route("chart-router", "deterministic-market-analysis");
  }
  if (params.hasAttachments === true || params.hasImageAttachment === true) {
    return route("agent", "attachment-required");
  }
  if (params.hasQuote === true || params.hasThreadReferences === true) {
    return route("agent", "referenced-context-required");
  }
  if (matchesAny(text, PRIVATE_CONTEXT_PATTERNS)) {
    return route("agent", "private-context-required");
  }
  if (matchesAny(text, CONVERSATION_HISTORY_PATTERNS)) {
    return route("agent", "conversation-history-required");
  }
  if (matchesAny(text, CURRENT_EXTERNAL_INFO_PATTERNS)) {
    return route("agent", "current-external-information-required");
  }
  if (matchesAny(text, ACTION_OR_LOCAL_RESOURCE_PATTERNS)) {
    return route("agent", "tool-or-local-resource-required");
  }
  if (matchesAny(text, CURRENT_CHART_PATTERNS)) {
    return route("chart-router", "current-chart-required");
  }
  if (matchesAny(text, PUBLIC_CONCEPT_PATTERNS)) {
    return route("direct", "stable-public-concept");
  }
  if (matchesAny(text, CHART_OR_MARKET_PATTERNS)) {
    return route("chart-router", "chart-or-market-analysis-possible");
  }
  return route("direct", "public-current-question");
}

export function buildTradingExpertFastChatRequest(params = {}) {
  const text = sanitizeFastChatText(params.text);
  if (!text) throw new Error("Fast chat requires a non-empty question");
  return {
    provider: "codex",
    model: TRADING_EXPERT_FAST_CHAT_MODEL,
    modelPool: "question_answer",
    modelCapability: "question_answer",
    sourceType: TRADING_EXPERT_FAST_CHAT_SOURCE,
    interactionId: String(params.interactionId || "").trim(),
    conversationId: String(params.threadId || "").trim(),
    threadId: String(params.threadId || "").trim(),
    text,
    messages: [
      {
        role: "developer",
        content: [
          TRADING_EXPERT_FAST_CHAT_POLICY,
          assistantOutputLanguageInstruction(params.language),
        ].filter(Boolean).join("\n\n"),
      },
      { role: "user", content: text },
    ],
    reasoningEffort: "low",
    fixedReasoningEffort: "low",
    stream: true,
    emitTextDeltas: true,
    tools: TRADING_EXPERT_FAST_CHAT_TOOLS,
    toolChoice: "auto",
    maxTransportAttempts: 1,
  };
}

export function normalizeTradingExpertFastChatResult(result = {}) {
  const toolCalls = Array.isArray(result?.toolCalls)
    ? result.toolCalls
    : Array.isArray(result?.tool_calls)
      ? result.tool_calls
      : [];
  if (toolCalls.length) {
    if (
      toolCalls.length !== 1
      || String(toolCalls[0]?.function?.name || toolCalls[0]?.name || "").trim()
        !== TRADING_EXPERT_FAST_CHAT_HANDOFF_TOOL
    ) {
      return { route: "handoff", reason: "unexpected-tool-protocol" };
    }
    return {
      route: "handoff",
      reason: handoffReason(toolCalls[0]) || "model-requested-agent",
    };
  }
  const text = String(result?.text || result?.message || result?.content || "")
    .replace(/\0/g, "")
    .trim();
  if (!text) return { route: "handoff", reason: "empty-direct-response" };
  return { route: "direct", text };
}

function route(value, reason) {
  return { route: value, reason, model: TRADING_EXPERT_FAST_CHAT_MODEL };
}

function sanitizeFastChatText(value) {
  return String(value || "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, MAX_FAST_CHAT_TEXT_CHARS);
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function handoffReason(call) {
  const raw = call?.function?.arguments ?? call?.arguments;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return sanitizeReason(raw.reason);
  }
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return sanitizeReason(parsed?.reason);
  } catch {
    return null;
  }
}

function sanitizeReason(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || null;
}
