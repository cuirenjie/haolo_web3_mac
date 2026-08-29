export const GPT_PLAN_MODE_PROMPT_START =
  "<haolo_gpt_plan_default_execution_guidance>";
export const GPT_PLAN_MODE_PROMPT_END =
  "</haolo_gpt_plan_default_execution_guidance>";

export const GPT_PLAN_PROCESS_START = "<haolo_plan_process>";
export const GPT_PLAN_PROCESS_END = "</haolo_plan_process>";
export const GPT_PLAN_FINAL_START = "<haolo_plan_final>";
export const GPT_PLAN_FINAL_END = "</haolo_plan_final>";

export const GPT_PLAN_MODE_DEFAULT_EXECUTION_INSTRUCTIONS = [
  GPT_PLAN_MODE_PROMPT_START,
  "When this GPT model writes or revises a plan, apply the planning guidance from Haolo's default execution mode:",
  "- Use a plan for non-trivial, multi-step work where sequencing, ambiguity, or checkpoints materially help.",
  "- Break the work into meaningful, logically ordered steps whose completion can be verified.",
  "- Do not pad simple work with filler steps or merely restate the request.",
  "- Include only actions that the eventual executor can actually perform and validate.",
  "- Keep the plan focused, concrete, and proportionate to the task; update it when evidence changes an assumption.",
  "- Write only high-quality plans, never vague placeholders such as \"implement it\", \"test it\", or \"finish it\".",
  "For every response in this mode, use the following visible presentation protocol:",
  `- Before the final answer, emit one to five concise, user-facing progress summaries. Wrap each summary in ${GPT_PLAN_PROCESS_START} and ${GPT_PLAN_PROCESS_END}.`,
  "- A progress summary may state the current interpretation, an important constraint, a decision checkpoint, or the next planning step.",
  "- Progress summaries are public status updates, not private chain-of-thought. Never reveal hidden reasoning, internal policies, scratch work, token-by-token deliberation, or unverifiable mental steps.",
  `- Wrap the complete deliverable in ${GPT_PLAN_FINAL_START} and ${GPT_PLAN_FINAL_END}. The final section must be self-contained and must not depend on the progress summaries remaining expanded.`,
  "- Output only those tagged sections, in order. Never mention or escape the protocol tags.",
  "These rules constrain presentation and planning quality only. Always answer the user's request directly and completely inside the final section.",
  GPT_PLAN_MODE_PROMPT_END,
].join("\n");

export function isGptPlanModeProviderRequest(params = {}) {
  const modelPool = normalizedToken(params.modelPool || params.model_pool);
  const modelCapability = normalizedToken(
    params.modelCapability || params.model_capability,
  );
  if (
    modelPool !== "question_answer"
    || modelCapability !== "question_answer"
    || isGroupChatRequest(params)
  ) {
    return false;
  }
  return (
    normalizedToken(params.provider) === "codex"
    && /^gpt(?:-|$)/i.test(String(params.model || "").trim())
    && isExplicitGptPlanModeRequest(params)
  );
}

function isExplicitGptPlanModeRequest(params = {}) {
  if (
    params.gptPlanMode === true
    || params.gpt_plan_mode === true
    || params.planMode === true
    || params.plan_mode === true
  ) return true;
  return [params.presentationMode, params.presentation_mode]
    .some((value) => normalizedToken(value) === "plan");
}

export function providerMessagesWithGptPlanModePrompt(messages, params = {}) {
  if (!isGptPlanModeProviderRequest(params)) return messages;
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  if (
    normalizedMessages.some(
      (message) =>
        message?.role === "system"
        && String(message.content || "").includes(GPT_PLAN_MODE_PROMPT_START),
    )
  ) {
    return normalizedMessages;
  }
  return [
    {
      role: "system",
      content: GPT_PLAN_MODE_DEFAULT_EXECUTION_INSTRUCTIONS,
    },
    ...normalizedMessages,
  ];
}

export function createGptPlanModeStreamAdapter(callback) {
  const parser = createGptPlanModePresentationParser();
  let rawText = "";
  let finished = false;

  const emitPresentationEvents = (events) => {
    if (typeof callback !== "function") return;
    for (const event of events) callback(event);
  };

  const finishParser = () => {
    if (finished) return;
    finished = true;
    emitPresentationEvents(parser.finish());
  };

  return {
    onEvent(event = {}) {
      const phase = normalizedToken(event?.phase);
      if (phase === "delta") {
        const delta = String(event?.delta || "");
        rawText += delta;
        emitPresentationEvents(parser.push(delta));
        return;
      }
      if (phase === "completed") finishParser();
      callback?.(event);
    },
    reconcile(text) {
      const completeText = String(text || "");
      if (!finished) {
        if (completeText.startsWith(rawText)) {
          const missing = completeText.slice(rawText.length);
          rawText = completeText;
          emitPresentationEvents(parser.push(missing));
        } else if (!rawText) {
          rawText = completeText;
          emitPresentationEvents(parser.push(completeText));
        }
        finishParser();
      }
      return parseGptPlanModePresentation(completeText);
    },
  };
}

export function parseGptPlanModePresentation(text) {
  const parser = createGptPlanModePresentationParser();
  const events = [...parser.push(String(text || "")), ...parser.finish()];
  const processSegments = [];
  let finalText = "";
  for (const event of events) {
    if (event.phase === "plan_process_delta") {
      const index = positiveInteger(event.segmentIndex, 1) - 1;
      processSegments[index] = `${processSegments[index] || ""}${event.delta}`;
    } else if (event.phase === "delta") {
      finalText += event.delta;
    }
  }
  const normalizedSegments = processSegments
    .map((segment) => String(segment || "").trim())
    .filter(Boolean);
  const normalizedFinal = finalText.trim();
  return {
    structured: parser.structured(),
    processSegments: normalizedSegments,
    finalText:
      normalizedFinal
      || normalizedSegments.at(-1)
      || stripGptPlanModePresentationTags(text).trim(),
  };
}

export function stripGptPlanModePresentationTags(text) {
  return String(text || "")
    .split(GPT_PLAN_PROCESS_START).join("")
    .split(GPT_PLAN_PROCESS_END).join("")
    .split(GPT_PLAN_FINAL_START).join("")
    .split(GPT_PLAN_FINAL_END).join("");
}

function createGptPlanModePresentationParser() {
  const openMarkers = [
    { marker: GPT_PLAN_PROCESS_START, section: "process" },
    { marker: GPT_PLAN_FINAL_START, section: "final" },
  ];
  let buffer = "";
  let mode = "detect";
  let section = null;
  let segmentIndex = 0;
  let didStructure = false;
  let closedFinal = false;

  const emit = (phase, delta) => {
    if (!delta) return [];
    return [{
      phase,
      delta,
      ...(phase === "plan_process_delta" ? { segmentIndex } : {}),
    }];
  };

  const consume = (finishing = false) => {
    const events = [];
    for (;;) {
      if (mode === "fallback") {
        if (buffer) events.push(...emit("delta", buffer));
        buffer = "";
        break;
      }

      if (mode === "detect") {
        const leadingWhitespace = buffer.match(/^\s*/)?.[0] || "";
        const candidate = buffer.slice(leadingWhitespace.length);
        const fullMarker = openMarkers.find(({ marker }) =>
          candidate.startsWith(marker)
        );
        if (fullMarker) {
          mode = "structured";
          didStructure = true;
          buffer = candidate;
          continue;
        }
        const partialMarker = openMarkers.some(({ marker }) =>
          marker.startsWith(candidate)
        );
        if (!finishing && (!candidate || partialMarker)) break;
        mode = "fallback";
        continue;
      }

      if (!section) {
        buffer = buffer.replace(/^\s+/, "");
        if (!buffer) break;
        const opening = openMarkers.find(({ marker }) =>
          buffer.startsWith(marker)
        );
        if (opening) {
          buffer = buffer.slice(opening.marker.length);
          section = opening.section;
          if (section === "process") segmentIndex += 1;
          continue;
        }
        const partialOpening = openMarkers.some(({ marker }) =>
          marker.startsWith(buffer)
        );
        if (!finishing && partialOpening) break;
        // Preserve malformed or untagged trailing output as part of the final
        // answer instead of dropping model text.
        section = "final";
        continue;
      }

      const closing = section === "process"
        ? GPT_PLAN_PROCESS_END
        : GPT_PLAN_FINAL_END;
      const closingIndex = buffer.indexOf(closing);
      if (closingIndex >= 0) {
        const content = buffer.slice(0, closingIndex);
        events.push(...emit(
          section === "process" ? "plan_process_delta" : "delta",
          content,
        ));
        buffer = buffer.slice(closingIndex + closing.length);
        if (section === "final") closedFinal = true;
        section = null;
        continue;
      }

      if (finishing) {
        events.push(...emit(
          section === "process" ? "plan_process_delta" : "delta",
          buffer,
        ));
        buffer = "";
        break;
      }

      const heldSuffixLength = longestSuffixThatPrefixes(buffer, closing);
      const safeLength = buffer.length - heldSuffixLength;
      if (safeLength <= 0) break;
      events.push(...emit(
        section === "process" ? "plan_process_delta" : "delta",
        buffer.slice(0, safeLength),
      ));
      buffer = buffer.slice(safeLength);
      break;
    }
    return events;
  };

  return {
    push(delta) {
      if (closedFinal) return [];
      buffer += String(delta || "").replace(/\0/g, "");
      return consume(false);
    },
    finish() {
      return consume(true);
    },
    structured() {
      return didStructure;
    },
  };
}

function longestSuffixThatPrefixes(value, marker) {
  const maxLength = Math.min(String(value || "").length, marker.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (marker.startsWith(value.slice(-length))) return length;
  }
  return 0;
}

function isGroupChatRequest(params) {
  return Boolean(
    params.groupChatContextPreparationId
    || params.group_chat_context_preparation_id
    || params.groupChatThreadId
    || params.group_chat_thread_id
    || params.groupChatMemberId
    || params.group_chat_member_id,
  );
}

function normalizedToken(value) {
  return String(value || "").trim().toLowerCase();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : fallback;
}
