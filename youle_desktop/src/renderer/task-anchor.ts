export const TASK_ANCHOR_RULE_VERSION = 2;

const TASK_ANCHOR_FOCUS_MAX_LENGTH = 320;

// Deliverables get a scoring advantage over subject-matter words. This keeps
// "use a hotel report to make a PPT" anchored to the requested PPT, while a
// plain "find a hotel" request can still use the hotel topic as its anchor.
export const TASK_ANCHOR_DELIVERABLE_HINTS: Array<[RegExp, string]> = [
  [/白皮书|蓝皮书/u, "白皮"],
  [/PPT|ppt|幻灯片|演示文稿/u, "演示"],
  [/Word|word|文档|docx?/u, "文档"],
  [/Excel|excel|表格|xlsx?|csv/u, "表格"],
  [/图片|照片|截图|海报|封面图|配图/u, "图片"],
  [/视频|短片|剪辑/u, "视频"],
  [/简历/u, "简历"],
  [/合同|协议/u, "合同"],
  [/会议纪要|纪要/u, "纪要"],
  [/论文/u, "论文"],
  [/周报/u, "周报"],
  [/报告/u, "报告"],
  [/方案/u, "方案"],
  [/邮件/u, "邮件"],
  [/译文|翻译/u, "翻译"],
  [/代码|程序|脚本/u, "代码"],
  [/网站|网页|页面/u, "网站"],
  [/行程/u, "行程"],
  [/攻略/u, "攻略"],
  [/报价/u, "报价"],
  [/预算/u, "预算"],
  [/清单/u, "清单"],
  [/大纲|提纲/u, "大纲"],
  [/文案/u, "文案"],
];

export const TASK_ANCHOR_TOPIC_HINTS: Array<[RegExp, string]> = [
  [/火锅/u, "火锅"],
  [/机票|航班|直飞|机场|航司/u, "机票"],
  [/酒店|民宿|住宿/u, "酒店"],
  [/高铁|火车|动车/u, "高铁"],
  [/发票|报销/u, "发票"],
  [/餐厅|饭店|美食|吃什么/u, "美食"],
  [/招生|升学|择校|入学/u, "升学"],
  [/运营|增长|投放|营销/u, "运营"],
  [/旅游|旅行|周末/u, "旅行"],
  [/天气/u, "天气"],
  [/股票|个股|板块|市值|PE/u, "股票"],
  [/游戏/u, "游戏"],
  [/配置/u, "配置"],
  [/环境变量|开发环境/u, "环境"],
  [/文件夹|目录|文件/u, "文件"],
  [/快递/u, "快递"],
  [/外卖/u, "外卖"],
  [/数据/u, "数据"],
];

const TASK_ANCHOR_STOPWORDS = new Set([
  "帮我",
  "请帮",
  "查询",
  "一下",
  "一个",
  "一份",
  "一篇",
  "这个",
  "那个",
  "哪里",
  "在哪",
  "怎么",
  "什么",
  "有没有",
  "最好",
  "最有",
  "根据",
  "今天",
  "明天",
  "昨天",
  "下周",
  "周末",
  "上午",
  "下午",
  "晚上",
  "时候",
  "可以",
  "需要",
  "我要",
  "我想",
  "我在",
  "给我",
  "给你",
  "你的",
  "我的",
  "帮忙",
  "整理",
  "生成",
  "总结",
  "推荐",
  "查找",
  "看看",
  "分析",
  "对比",
  "参考",
  "参照",
  "内容",
  "以下",
]);

const TASK_ANCHOR_REFERENCE_SECTION_PATTERN =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:以下(?:是|为).{0,20}(?:参考|原文|框架|材料|素材|内容)|参考(?:内容|资料|文本|框架)|原文|素材|文章)(?:如下)?\s*[:：]/iu;

const TASK_ANCHOR_OUTPUT_CONTEXT_PATTERN =
  /(?:生成|制作|创建|撰写|编写|输出|导出|产出|交付|整理成|转换成|改写成|优化|完善|修改|润色|写|做|给我|需要|想要|要)(?:一份|一个|一篇|一版|一套)?[^，。！？；:\n]{0,24}$/u;

const TASK_ANCHOR_REFERENCE_CONTEXT_PATTERN =
  /(?:参考|参照|基于|按照|根据|阅读|查看|结合|对照|使用|以)(?:这|该|我的|以下|附件|一份|一个|一篇|给你的)?[^，。！？；:\n]{0,14}$/u;

const TASK_ANCHOR_REFERENCE_SUFFIX_PATTERN = /^(?:作为|用作|拿来|为)?[^，。！？；:\n]{0,6}(?:参考|样例|范例|模板)/u;

type TaskAnchorHintCandidate = {
  anchor: string;
  index: number;
  length: number;
  deliverable: boolean;
  order: number;
};

export function taskAnchorFromPromptText(text: string, fallback = "") {
  const prompt = cleanTaskAnchorPrompt(text);
  if (!prompt) return normalizeTaskAnchorText(fallback);
  return taskAnchorHintFromPrompt(prompt) || taskAnchorCandidateFromPrompt(stripTaskAnchorLeadIn(prompt)) || normalizeTaskAnchorText(fallback);
}

export function cleanTaskAnchorPrompt(text: string) {
  const withoutReferences = taskAnchorInstructionText(String(text || ""));
  return withoutReferences
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[A-Za-z]:[\\/][^\s，。！？；、]+/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

export function taskAnchorInstructionText(text: string) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  const referenceSection = TASK_ANCHOR_REFERENCE_SECTION_PATTERN.exec(normalized);
  const instruction = referenceSection && referenceSection.index >= 8 ? normalized.slice(0, referenceSection.index) : normalized;
  return instruction.slice(0, TASK_ANCHOR_FOCUS_MAX_LENGTH);
}

function taskAnchorHintFromPrompt(prompt: string) {
  const candidates = [
    ...taskAnchorHintCandidates(prompt, TASK_ANCHOR_DELIVERABLE_HINTS, true),
    ...taskAnchorHintCandidates(prompt, TASK_ANCHOR_TOPIC_HINTS, false),
  ];
  let best: TaskAnchorHintCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = taskAnchorHintCandidateScore(prompt, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return normalizeTaskAnchorText(best?.anchor);
}

function taskAnchorHintCandidates(prompt: string, hints: Array<[RegExp, string]>, deliverable: boolean) {
  const candidates: TaskAnchorHintCandidate[] = [];
  hints.forEach(([pattern, anchor], order) => {
    const flags = `${pattern.flags.replace(/[gy]/g, "")}g`;
    const matcher = new RegExp(pattern.source, flags);
    for (const match of prompt.matchAll(matcher)) {
      candidates.push({
        anchor,
        index: match.index ?? 0,
        length: match[0]?.length || 1,
        deliverable,
        order,
      });
    }
  });
  return candidates;
}

function taskAnchorHintCandidateScore(prompt: string, candidate: TaskAnchorHintCandidate) {
  const before = prompt.slice(Math.max(0, candidate.index - 36), candidate.index);
  const after = prompt.slice(candidate.index + candidate.length, candidate.index + candidate.length + 14);
  let score = 1_000 - candidate.index - candidate.order / 100;
  if (candidate.deliverable) score += 220;
  if (candidate.deliverable && TASK_ANCHOR_OUTPUT_CONTEXT_PATTERN.test(before)) score += 600;
  if (TASK_ANCHOR_REFERENCE_CONTEXT_PATTERN.test(before)) score -= 480;
  if (TASK_ANCHOR_REFERENCE_SUFFIX_PATTERN.test(after)) score -= 480;
  return score;
}

function stripTaskAnchorLeadIn(prompt: string) {
  return prompt.replace(/^(?:(?:请|麻烦|请你|能否|可以)?(?:帮我|给我)|我(?:想|要|需要|在)|请|麻烦|以我给你的)/u, "");
}

function taskAnchorCandidateFromPrompt(prompt: string) {
  const chunks = prompt.match(/[\u3400-\u9fff\uf900-\ufaff]{2,}/g) || [];
  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  chunks.forEach((chunk, chunkIndex) => {
    for (let index = 0; index <= chunk.length - 2; index += 1) {
      const candidate = chunk.slice(index, index + 2);
      if (!isTaskAnchorCandidateText(candidate)) continue;
      let score = 100 - chunkIndex * 8 - index;
      const nextChar = chunk[index + 2] || "";
      if (/[店票表稿图码文书菜房车]/u.test(candidate[1] || "") || /[店票表稿图码文书菜房车]/u.test(nextChar)) score += 14;
      if (index === 0) score += 4;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  });
  return normalizeTaskAnchorText(best);
}

function isTaskAnchorCandidateText(text: string) {
  if (!text || TASK_ANCHOR_STOPWORDS.has(text)) return false;
  if (/^[年月日时分秒上下左右前后东西南北今天明昨周末]+$/u.test(text)) return false;
  return /[\u3400-\u9fff\uf900-\ufaff]{2}/u.test(text);
}

export function normalizeTaskAnchorText(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw || raw === "新任务") return "";
  const chinese = raw.match(/[\u3400-\u9fff\uf900-\ufaff]/g);
  if (chinese && chinese.length >= 2) return chinese.slice(0, 2).join("");
  const ascii = raw.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return ascii.length >= 2 ? ascii.slice(0, 2) : "";
}
