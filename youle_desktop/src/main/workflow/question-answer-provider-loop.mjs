import { questionAnswerToolMessage } from "./question-answer-workspace-tools.mjs";
import { runReadOnlyModelOperationWithRecovery } from "../model-transport-recovery.mjs";

const DEFAULT_MAX_TOOL_EVIDENCE_CHARS = 1_200_000;
const MAX_NO_PROGRESS_ROUNDS = 2;

export async function invokeQuestionAnswerProvider({
  send,
  params,
  messages,
  workspaceTools,
  supportsStatefulContinuation = false,
  maxToolEvidenceChars = DEFAULT_MAX_TOOL_EVIDENCE_CHARS,
  onProgress,
  waitForRetry,
} = {}) {
  if (typeof send !== "function") {
    throw new Error("A question-answer provider send function is required.");
  }
  const cleanParams = withoutRendererToolOverrides(params);
  const maxTransportAttempts = optionalPositiveInteger(
    params?.maxTransportAttempts ?? params?.max_transport_attempts,
  );
  let streamRoundSequence = 0;
  const nextStreamRound = () => ++streamRoundSequence;
  if (!supportsStatefulContinuation || !workspaceTools?.definitions) {
    return sendProviderRound({
      send,
      request: { ...cleanParams, messages },
      round: 1,
      onProgress,
      nextStreamRound,
      waitForRetry,
      maxTransportAttempts,
    });
  }
  const tools = workspaceTools.definitions();
  if (!tools.length) {
    return sendProviderRound({
      send,
      request: { ...cleanParams, messages },
      round: 1,
      onProgress,
      nextStreamRound,
      waitForRetry,
      maxTransportAttempts,
    });
  }

  const workingMessages = [...messages];
  let toolRounds = 0;
  let toolCalls = 0;
  let toolEvidenceChars = 0;
  let noProgressRounds = 0;
  try {
    for (;;) {
      const providerRound = toolRounds + 1;
      const result = await sendProviderRound({
        send,
        request: {
          ...cleanParams,
          messages: workingMessages,
          tools,
          toolChoice: "auto",
        },
        round: providerRound,
        onProgress,
        nextStreamRound,
        waitForRetry,
        maxTransportAttempts,
      });
      const calls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
      if (!calls.length) {
        return {
          ...result,
          localFileToolTrace: {
            protocolVersion: 1,
            supported: true,
            rounds: toolRounds,
            calls: toolCalls,
            evidenceChars: toolEvidenceChars,
            stoppedForNoProgress: false,
            stoppedForContextCapacity: false,
          },
        };
      }

      toolRounds += 1;
      toolCalls += calls.length;
      emitProgress(onProgress, {
        stepId: `file-tools-${toolRounds}`,
        stage: "provider_file_tools",
        status: "running",
        title: "模型正在继续读取资料",
        detail: fileToolRoundDetail(calls),
      });
      workingMessages.push(
        result?.assistantMessage || {
          role: "assistant",
          content: "",
          tool_calls: calls,
        },
      );
      let roundHasNewEvidence = false;
      let roundEvidenceChars = 0;
      for (const call of calls) {
        const toolResult = await workspaceTools.execute(call);
        roundHasNewEvidence ||= toolResult?.newEvidence === true;
        const message = questionAnswerToolMessage(call, toolResult);
        roundEvidenceChars += message.content.length;
        toolEvidenceChars += message.content.length;
        workingMessages.push(message);
      }
      emitProgress(onProgress, {
        stepId: `file-tools-${toolRounds}`,
        stage: "provider_file_tools",
        status: "completed",
        title: "模型已取得补充资料",
        detail: `${calls.length} 次只读操作已完成，新增约 ${formatCharCount(roundEvidenceChars)} 字符证据`,
      });
      noProgressRounds = roundHasNewEvidence ? 0 : noProgressRounds + 1;
      const stoppedForNoProgress = noProgressRounds >= MAX_NO_PROGRESS_ROUNDS;
      const stoppedForContextCapacity = (
        toolEvidenceChars >= positiveInteger(
          maxToolEvidenceChars,
          DEFAULT_MAX_TOOL_EVIDENCE_CHARS,
        )
      );
      if (!stoppedForNoProgress && !stoppedForContextCapacity) continue;

      const finalResult = await sendProviderRound({
        send,
        request: {
          ...cleanParams,
          messages: providerMessagesWithoutToolProtocol(workingMessages, {
            reason: stoppedForNoProgress
              ? "Repeated file-tool requests produced no new evidence."
              : "The read-only file evidence reached the current request's safe context capacity.",
          }),
        },
        round: toolRounds + 1,
        onProgress,
        nextStreamRound,
        waitForRetry,
        maxTransportAttempts,
      });
      return {
        ...finalResult,
        localFileToolTrace: {
          protocolVersion: 1,
          supported: true,
          rounds: toolRounds,
          calls: toolCalls,
          evidenceChars: toolEvidenceChars,
          stoppedForNoProgress,
          stoppedForContextCapacity,
        },
      };
    }
  } catch (error) {
    if (!isToolProtocolUnsupported(error)) throw error;
    emitProgress(onProgress, {
      stepId: "file-tool-fallback",
      stage: "provider_file_tool_fallback",
      status: "completed",
      title: "改用已整理的本地资料",
      detail: "所选模型不支持只读工具协议，将使用已经提交的完整资料上下文继续回答",
    });
    const fallbackResult = await sendProviderRound({
      send,
      request: {
        ...cleanParams,
        messages: providerMessagesWithoutToolProtocol(workingMessages, {
          reason: "The selected provider does not support the read-only tool protocol. Use the broad file context already supplied by Haolo.",
        }),
      },
      round: toolRounds + 1,
      onProgress,
      nextStreamRound,
      waitForRetry,
      maxTransportAttempts,
    });
    return {
      ...fallbackResult,
      localFileToolTrace: {
        protocolVersion: 1,
        supported: false,
        rounds: toolRounds,
        calls: toolCalls,
        evidenceChars: toolEvidenceChars,
        fallback: "broad_host_context",
        error: {
          code: "PROVIDER_TOOL_PROTOCOL_UNSUPPORTED",
          message: String(error?.message || error),
        },
      },
    };
  }
}

export function providerMessagesWithoutToolProtocol(messages, { reason } = {}) {
  const normalized = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role === "tool") {
      normalized.push({
        role: "system",
        content: [
          "<haolo_read_only_tool_result>",
          String(message.content || ""),
          "</haolo_read_only_tool_result>",
        ].join("\n"),
      });
      continue;
    }
    if (message?.role === "assistant" && Array.isArray(message.tool_calls)) {
      const content = String(message.content || "").trim();
      if (content) normalized.push({ role: "assistant", content });
      continue;
    }
    normalized.push(message);
  }
  normalized.push({
    role: "system",
    content: [
      "Haolo has finished the read-only file evidence phase.",
      String(reason || "").trim(),
      "Answer the user's original request now using all supplied evidence. Do not ask the user to paste files that are already present in the context.",
    ].filter(Boolean).join("\n"),
  });
  return normalized;
}

export function isToolProtocolUnsupported(error) {
  const status = Number(error?.status);
  if (![400, 404, 405, 415, 422, 501].includes(status)) return false;
  const text = [
    error?.message,
    error?.code,
    error?.payload?.error?.message,
    error?.payload?.message,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return (
    text.includes("tool")
    || text.includes("function")
    || text.includes("unsupported")
    || text.includes("not support")
  );
}

function withoutRendererToolOverrides(params) {
  const clean = { ...(params || {}) };
  delete clean.tools;
  delete clean.toolChoice;
  delete clean.tool_choice;
  delete clean.functions;
  delete clean.function_call;
  delete clean.maxTransportAttempts;
  delete clean.max_transport_attempts;
  return clean;
}

function withQuestionAnswerStreaming(params, onProgress, round) {
  const originalOnEvent =
    typeof params?.onEvent === "function"
      ? params.onEvent
      : null;
  return {
    ...(params || {}),
    // Plan-mode generation is always streamed. The provider transport then
    // uses independent first-byte and inactivity watchdogs instead of a fixed
    // total-response deadline.
    stream: true,
    onEvent: (event) => {
      const taggedEvent = {
        ...(event || {}),
        round,
      };
      try {
        originalOnEvent?.(taggedEvent);
      } finally {
        emitQuestionAnswerStreamProgress(onProgress, taggedEvent);
      }
    },
  };
}

function emitQuestionAnswerStreamProgress(onProgress, event) {
  const phase = String(event?.phase || "").trim().toLowerCase();
  if (phase !== "streaming" && phase !== "completed") return;
  const receivedChars = Math.max(0, Number(event?.receivedChars) || 0);
  emitProgress(onProgress, {
    stepId: "provider-stream",
    stage: "provider_stream",
    status: phase === "completed" ? "completed" : "running",
    title: phase === "completed" ? "模型流式回答已接收" : "模型正在流式生成回答",
    detail: receivedChars
      ? `已持续接收约 ${formatCharCount(receivedChars)} 字符，连接保持活跃`
      : "已收到模型流式响应，连接保持活跃",
  });
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : fallback;
}

function optionalPositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : Number.POSITIVE_INFINITY;
}

async function sendProviderRound({
  send,
  request,
  round,
  onProgress,
  nextStreamRound,
  waitForRetry,
  maxTransportAttempts,
}) {
  const progress = providerSubmissionProgress(request, round);
  emitProgress(onProgress, {
    stepId: `provider-round-${round}`,
    stage: "provider_request",
    status: "running",
    title: progress.title,
    detail: progress.detail,
  });
  const result = await runReadOnlyModelOperationWithRecovery({
    signal: request?.signal,
    waitForRetry,
    operation: async () => {
      const streamRound = typeof nextStreamRound === "function"
        ? nextStreamRound()
        : round;
      const streamingRequest = withQuestionAnswerStreaming(
        request,
        onProgress,
        streamRound,
      );
      streamingRequest.onEvent({
        phase: "started",
        round: streamRound,
      });
      return send(streamingRequest);
    },
    onRetry: ({ nextAttempt, delayMs, lowFrequency }) => {
      emitProgress(onProgress, {
        stepId: `provider-recovery-${round}`,
        stage: "provider_transport_recovery",
        status: "running",
        title: lowFrequency
          ? "模型连接仍不稳定，已转为低频自动恢复"
          : "模型连接中断，正在自动恢复",
        detail: lowFrequency
          ? `系统会每 ${Math.max(1, Math.round(delayMs / 1_000))} 秒继续尝试，直到成功或你取消任务`
          : `将在约 ${Math.max(1, Math.round(delayMs / 1_000))} 秒后进行第 ${nextAttempt} 次连接`,
      });
    },
    maxAttempts: maxTransportAttempts,
  });
  const calls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
  emitProgress(onProgress, {
    stepId: `provider-round-${round}`,
    stage: "provider_request",
    status: "completed",
    title: calls.length ? "模型已返回资料请求" : "模型已返回回答",
    detail: calls.length
      ? `模型还需要 ${calls.length} 次本地只读操作`
      : "已收到模型输出，正在完成结果整理",
  });
  return result;
}

function providerSubmissionProgress(request, round) {
  if (round > 1) {
    return {
      title: "正在提交补充资料",
      detail: "仅提交本轮新增证据，正在等待所选模型返回数据",
    };
  }
  const attachments = Array.isArray(request?.attachments) ? request.attachments : [];
  const hasVideo = attachments.some((attachment) => (
    String(attachment?.mime || "").trim().toLowerCase().startsWith("video/")
  ));
  const hasImage = attachments.some((attachment) => (
    String(attachment?.mime || "").trim().toLowerCase().startsWith("image/")
  ));
  const messages = Array.isArray(request?.messages) ? request.messages : [];
  const hasSelectedFileContext = messages.some((message) => (
    String(message?.content || "").includes("<haolo_question_answer_file_context>")
  ));
  if (hasVideo || hasImage) {
    const mediaLabel = hasVideo && hasImage ? "图片、视频" : hasVideo ? "视频" : "图片";
    return {
      title: `正在提交${mediaLabel}与问题`,
      detail: hasSelectedFileContext
        ? `正在提交原生${mediaLabel}附件和 Haolo 语义选中的必要文件资料`
        : `仅提交原生${mediaLabel}附件和用户问题，不附带分组文件上下文`,
    };
  }
  return {
    title: "正在提交任务资料",
    detail: hasSelectedFileContext
      ? "正在提交 Haolo 语义选中的必要文件资料"
      : "正在提交用户问题，不附带本地文件上下文",
  };
}

function fileToolRoundDetail(calls) {
  const names = [...new Set(
    calls
      .map((call) => String(call?.function?.name || call?.name || "").trim())
      .filter(Boolean),
  )];
  const labels = names.map((name) => (
    name === "haolo_workspace_read"
      ? "读取文件"
      : name === "haolo_workspace_search"
        ? "搜索内容"
        : name === "haolo_workspace_list"
          ? "浏览目录"
          : "只读检查"
  ));
  return `${calls.length} 次操作：${labels.join("、") || "补充本地证据"}`;
}

function emitProgress(callback, event) {
  if (typeof callback === "function") callback(event);
}

function formatCharCount(value) {
  const count = Math.max(0, Number(value) || 0);
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`;
  return `${(count / 1_000_000).toFixed(1)}m`;
}
