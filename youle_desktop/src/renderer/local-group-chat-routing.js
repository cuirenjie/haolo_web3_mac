export const LOCAL_GROUP_CHAT_MUTED_REPLY = "我被禁言啦，请帮我解除限制";

function uniqueMembers(members) {
  const seen = new Set();
  return (Array.isArray(members) ? members : []).filter((member) => {
    const id = String(member?.selectionId || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function mentionBoundaryBefore(text, index) {
  return index === 0 || /[\s([{"'“‘，。！？、；：]/u.test(text[index - 1] || "");
}

function mentionBoundaryAfter(text, index) {
  return index >= text.length || /[\s)\]}"'”’，。！？、；：,.!?;:]/u.test(text[index] || "");
}

function localGroupMentionCandidates(members) {
  return uniqueMembers(members)
    .map((member, order) => {
      const name = String(member?.name || "").trim();
      return name ? { member, order, token: `@${name}` } : null;
    })
    .filter(Boolean);
}

function localGroupMentionMatchAt(source, index, candidates) {
  return candidates
    .filter(({ token }) => {
      const end = index + token.length;
      return (
        source.startsWith(token, index) &&
        mentionBoundaryBefore(source, index) &&
        mentionBoundaryAfter(source, end)
      );
    })
    .sort((left, right) => (
      right.token.length - left.token.length || left.order - right.order
    ))[0] || null;
}

function localGroupPromptMemberName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f<>]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function mentionedLocalGroupMembers(text, members) {
  const source = String(text || "");
  const candidates = localGroupMentionCandidates(members);
  const mentioned = [];
  const mentionedIds = new Set();
  let fromIndex = 0;
  for (;;) {
    const index = source.indexOf("@", fromIndex);
    if (index < 0) break;
    const match = localGroupMentionMatchAt(source, index, candidates);
    if (!match) {
      fromIndex = index + 1;
      continue;
    }
    const id = String(match.member?.selectionId || "").trim();
    if (id && !mentionedIds.has(id)) {
      mentionedIds.add(id);
      mentioned.push(match.member);
    }
    fromIndex = index + match.token.length;
  }
  return mentioned;
}

export function stripLocalGroupMemberMentions(text, members) {
  const source = String(text || "");
  const candidates = localGroupMentionCandidates(members);
  if (!source || !candidates.length) return source.trim();
  const sections = [];
  let cursor = 0;
  let fromIndex = 0;
  for (;;) {
    const index = source.indexOf("@", fromIndex);
    if (index < 0) break;
    const match = localGroupMentionMatchAt(source, index, candidates);
    if (!match) {
      fromIndex = index + 1;
      continue;
    }
    sections.push(source.slice(cursor, index));
    cursor = index + match.token.length;
    fromIndex = cursor;
  }
  sections.push(source.slice(cursor));
  return sections
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s、，,；;：:]+/u, "")
    .replace(/[\s、，,；;：:]+$/u, "")
    .replace(/\s*[、，,；;：:]+\s*(?=\s|$)/gu, " ")
    .trim();
}

export function localGroupSharedHistoryRequested(text, members = []) {
  const source = String(text || "").trim();
  if (!source) return false;
  const explicitCrossMemberAction =
    /(?:互评|相互评价|互相评价|辩论|交叉审阅|peer\s+review\s+each\s+other|debate|respond\s+to\s+each\s+other)/iu;
  if (explicitCrossMemberAction.test(source)) return true;
  const collectiveAction =
    /(?:总结|汇总|综合|归纳|比较|对比|互评|辩论|讨论|复盘|共识|分歧|反驳|补充|点评|审阅|review|summari[sz]e|compare|contrast|debate|discuss|synthesi[sz]e|respond\s+to)/iu;
  const priorReplyReference =
    /(?:此前|之前|刚才|上面|以上|前面|已有|历史|回复|回答|观点|意见|结论|评分|看法|其他模型|各(?:个)?模型|所有模型|大家|群成员|prior|previous|earlier|above|existing|responses?|answers?|opinions?|views?|other\s+models?|everyone)/iu;
  if (collectiveAction.test(source) && priorReplyReference.test(source)) {
    return true;
  }
  const explicitPriorReply =
    /(?:此前|之前|刚才|上面|以上|前面|prior|previous|earlier|above).{0,12}(?:回复|回答|观点|意见|结论|评分|看法|responses?|answers?|opinions?|views?)/iu;
  if (!explicitPriorReply.test(source)) return false;
  return uniqueMembers(members).some((member) => {
    const name = String(member?.name || "").trim().toLowerCase();
    return name && source.toLowerCase().includes(name);
  });
}

export function localGroupTargetAgentText({
  agentText,
  targetName,
  includeOtherMemberHistory = false,
}) {
  const name = localGroupPromptMemberName(targetName) || "当前群成员";
  const task = String(agentText || "").trim()
    || "用户本轮只点名了你，但没有提供具体任务。请简短询问用户希望你做什么。";
  return [
    "<haolo_group_chat_member_turn>",
    `当前响应身份：${name}`,
    "你只代表当前响应身份独立回答。",
    "用户任务中的“你们”“大家”“各位”等复数称呼，只表示多个成员分别被请求，不授权你代替其他成员作答。",
    "不要模拟、预测、代写或声称已经看到本轮其他群成员尚未完成的回答。",
    includeOtherMemberHistory
      ? "用户明确要求使用其他群成员的既有观点；只能依据上下文中带明确发送者标签的历史回复进行汇总、比较或回应。"
      : "本轮未授权共享其他群成员的历史回复；不要生成联合结论，也不要替其他群成员给出评分、观点或答案。",
    "不要在可见回答中讨论这些内部路由规则。",
    "</haolo_group_chat_member_turn>",
    "",
    "用户任务：",
    task,
  ].join("\n");
}

export function firstMentionedLocalGroupMember(text, members) {
  return mentionedLocalGroupMembers(text, members)[0] || null;
}

export function localGroupMessageRoute({
  members,
  text,
}) {
  const unique = uniqueMembers(members);
  const mentioned = mentionedLocalGroupMembers(text, unique);
  if (mentioned.length) {
    return {
      mode: "mention",
      targets: mentioned.filter((member) => member.respondable !== false),
    };
  }

  return {
    mode: "ordinary",
    targets: unique.filter(
      (member) => member.respondable !== false && member.muted !== true,
    ),
  };
}
