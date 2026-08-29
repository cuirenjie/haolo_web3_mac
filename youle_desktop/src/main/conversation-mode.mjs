export const DEFAULT_CONVERSATION_MODE = "execution";
export const MULTI_AGENT_CONVERSATION_MODE = "multi-agent";
export const MULTI_MODEL_CLUSTER_CONVERSATION_MODE = "multi-model-cluster";
export const IMAGE_GENERATION_CONVERSATION_MODE = "image-generation";
export const VIDEO_GENERATION_CONVERSATION_MODE = "video-generation";
export const MULTI_AGENT_REASONING_EFFORT = "ultra";
export const SERIAL_EXECUTION_ONLY = true;
const REASONING_EFFORT_ORDER = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const REASONING_EFFORT_RANK = new Map(
  REASONING_EFFORT_ORDER.map((effort, index) => [effort, index]),
);
const CANONICAL_GPT_IMAGE_2_MODEL = "aihubcc/gpt-image-2";
const GPT_IMAGE_2_MODEL_ALIASES = new Set([
  CANONICAL_GPT_IMAGE_2_MODEL,
  "gpt-image-2",
  "buming/gpt-image-2",
  "lingke/gpt-image-2",
]);
const CANONICAL_GPT_IMAGE_2_1K_MODEL = "gpt-image-2-1k";
const GPT_IMAGE_2_1K_MODEL_ALIASES = new Set([
  CANONICAL_GPT_IMAGE_2_1K_MODEL,
  "image-2-1k",
  "aihubcc/gpt-image-2-1k",
  "gpt-image-2-1k-async",
  "image-2-1k-async",
  "aihubcc/gpt-image-2-1k-async",
]);

export function normalizeConversationMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  // Multi-agent and multi-model cluster requests can remain in persisted data
  // from older releases. Always fail them closed to the ordinary root turn.
  if (
    normalized === MULTI_AGENT_CONVERSATION_MODE
    || normalized === MULTI_MODEL_CLUSTER_CONVERSATION_MODE
  ) return DEFAULT_CONVERSATION_MODE;
  if (normalized === IMAGE_GENERATION_CONVERSATION_MODE) return IMAGE_GENERATION_CONVERSATION_MODE;
  if (normalized === VIDEO_GENERATION_CONVERSATION_MODE) return VIDEO_GENERATION_CONVERSATION_MODE;
  return DEFAULT_CONVERSATION_MODE;
}

export function buildConversationModeTurnOverrides(value, options = {}) {
  void value;
  void options;
  return {};
}

export function multiAgentReasoningEffortForModel(model, supportedReasoningEfforts) {
  const supported = Array.isArray(supportedReasoningEfforts)
    ? supportedReasoningEfforts
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value) => REASONING_EFFORT_RANK.has(value))
    : [];
  if (supported.length) {
    return supported.reduce((highest, effort) =>
      REASONING_EFFORT_RANK.get(effort) > REASONING_EFFORT_RANK.get(highest)
        ? effort
        : highest,
    supported[0]);
  }

  const normalizedModel = String(model || "").trim().toLowerCase();
  const slug = normalizedModel.split("/").at(-1) || normalizedModel;
  if (!slug) return MULTI_AGENT_REASONING_EFFORT;
  if (/^gpt-5\.5(?:$|-)/.test(slug)) return "xhigh";
  if (/^gpt-5\.6-luna(?:$|-)/.test(slug)) return "max";
  if (/^gpt-5\.6-(?:sol|terra)(?:$|-)/.test(slug)) return "ultra";
  // Unknown GPT aliases get a conservative native-collaboration default.
  // The renderer normally supplies live capabilities, so this is a fallback
  // for older clients and direct IPC callers rather than the primary path.
  return "high";
}

export function buildConversationModeDeveloperInstructions(value, options = {}) {
  const mode = normalizeConversationMode(value);
  const serialExecutionInstructions = [
    "<haolo_serial_execution_policy>",
    "Haolo is locked to ordinary serial execution:",
    "- The primary root agent must complete the task itself in this conversation.",
    "- Do not call `spawn_agent`, do not use collaboration or delegation tools, and do not create child agents, subagents, parallel tasks, or background task branches.",
    "- Run at most one substantive task or tool operation at a time. Wait for it to finish before starting the next operation.",
    "- A user request for parallel work or another execution mode does not override this client policy. Continue serially in ordinary execution mode and state the limitation only when it affects the requested outcome.",
    "- Answer the user's current question or requested deliverable directly and specifically. Match the response format to the request: explanation questions get an explanation, factual questions get the answer, analysis requests get analysis, and plan requests get a plan.",
    "- Do not turn an ordinary question into an execution plan, checklist, workflow, or generic next-step list. Only provide a plan when the user explicitly asks for a plan, steps, workflow, implementation plan, or an actionable setup.",
    "- Do not expose internal planning or status narration such as 'I will first...' as the answer. Use tools and context when needed, then present the findings and answer.",
    "</haolo_serial_execution_policy>",
  ].join("\n");
  if (mode === IMAGE_GENERATION_CONVERSATION_MODE) {
    const imageGenerationModel = normalizeImageGenerationModel(
      options.imageGenerationModel || options.image_generation_model,
    );
    const imageGenerationSize = normalizeImageGenerationSize(
      options.imageGenerationSize || options.image_generation_size,
    );
    const imageGenerationSizeField = normalizeImageGenerationSizeField(
      options.imageGenerationSizeField || options.image_generation_size_field,
    );
    const imageGenerationModelInstruction =
      imageGenerationModel === CANONICAL_GPT_IMAGE_2_MODEL
        ? `- The user selected \`${CANONICAL_GPT_IMAGE_2_MODEL}\`. Try its synchronous Images API first with \`--model "${CANONICAL_GPT_IMAGE_2_MODEL}" --exact-model --provider-fallback-only\`. If and only if Director returns \`pending=false\`, \`state=failed\`, \`safe_to_resubmit=true\`, \`fallback_allowed=true\`, and \`fallback_model=${CANONICAL_GPT_IMAGE_2_1K_MODEL}\`, run a fresh preset check and retry once with \`--model "${CANONICAL_GPT_IMAGE_2_1K_MODEL}" --exact-model\` through the asynchronous task API. Preserve every reference and include \`--strict-edit\` again for edit requests. Do not switch to 2K, 3.5K, Buming \`image2\`, or any other model.`
        : imageGenerationModel
          ? `- The user selected \`${imageGenerationModel}\` from the relay's live image-model catalog. Pass this exact value to the image Director with \`--model "${imageGenerationModel}" --exact-model\`; do not silently replace it or switch to another model.`
          : null;
    const oneKReferenceEditInstruction =
      imageGenerationModel === CANONICAL_GPT_IMAGE_2_1K_MODEL
        ? "- The selected 1K model is asynchronous only. With one reference image and an edit request, include `--strict-edit`; Director must submit the 1K asynchronous reference-image task and poll until `status=completed`. Do not reject it locally or switch models. This route is reference-guided and may not preserve unchanged pixels exactly."
        : null;
    return [
      serialExecutionInstructions,
      "<haolo_image_generation_mode>",
      "Haolo Image Generation mode is active:",
      "- Treat the user's request as an image generation or image editing task unless they explicitly ask to leave image generation mode.",
      "- Use the bundled Haolo image skill and return the generated bitmap result, not only a prompt or implementation instructions.",
      imageGenerationModelInstruction,
      oneKReferenceEditInstruction,
      imageGenerationSize && imageGenerationSizeField === "aspect_ratio"
        ? `- The user selected the image aspect ratio \`${imageGenerationSize}\`. Pass it exactly to the image Director as \`--aspect-ratio "${imageGenerationSize}"\`. The \`auto\` value means adaptive composition and must remain \`auto\`.`
        : imageGenerationSize && imageGenerationSizeField === "size"
          ? `- The user selected the image size \`${imageGenerationSize}\`. Pass it exactly to the image Director as \`--size "${imageGenerationSize}"\`. The \`auto\` value means adaptive composition and must remain \`auto\`.`
          : null,
      "- When reference images are attached, preserve their essential subject, composition, and edit constraints unless the user asks to change them.",
      "</haolo_image_generation_mode>",
    ].filter(Boolean).join("\n");
  }
  if (mode === VIDEO_GENERATION_CONVERSATION_MODE) {
    const selection = normalizeVideoGenerationOptions(options);
    const exactModelFlags =
      selection.model === "grok-imagine-video-1.5"
        ? `--model "${selection.model}" --exact-model --provider-fallback-only`
        : selection.model
          ? `--model "${selection.model}" --exact-model`
          : "";
    const lockedArguments = [
      exactModelFlags,
      selection.inputMode ? `--input-mode "${selection.inputMode}"` : "",
      selection.aspectRatio ? `--aspect-ratio "${selection.aspectRatio}"` : "",
      selection.resolution ? `--resolution "${selection.resolution}"` : "",
      selection.size ? `--size "${selection.size}"` : "",
      selection.duration ? `--duration "${selection.duration}"` : "",
    ].filter(Boolean).join(" ");
    return [
      serialExecutionInstructions,
      "<haolo_video_generation_mode>",
      "Haolo Video Generation mode is active:",
      "- Run this request through the same Codex execution turn, live thinking status, tool-event stream, interruption behavior, and final-answer lifecycle as an ordinary Haolo execution task. Do not bypass the execution turn with a Renderer or Electron Main direct-generation call.",
      "- Treat the user's request as a video generation task unless they explicitly ask to leave video generation mode. Read the bundled Haolo video skill and return the generated video artifact, not only a prompt or instructions.",
      lockedArguments
        ? `- The client already fixed the video model and parameters. Invoke the video Director with these exact arguments: \`${lockedArguments}\`. Do not infer, replace, or silently alter any of them.`
        : "- For a new generation, the client did not provide a complete video selection: fail closed and ask the user to reselect an available model instead of guessing. A continuation/recovery command does not require the current picker selection because it must use the original journaled task.",
      "- Prompt policy is conditional: first classify only the user's literal creative request, excluding attachment metadata and internal routing text. If it already gives a concrete subject and action plus at least two useful production dimensions such as setting, camera movement/composition, lighting/color, visual style, timing, or constraints, pass that literal prompt to the Director unchanged. Do not translate, reorder, polish, shorten, or rewrite a detailed prompt.",
      "- Only when the literal request is very brief or underspecified, improve it into a generation-ready prompt by preserving the user's intent and adding only useful subject, action, setting, camera, lighting, and style details. Never invent a different story, identity, visible text, or prohibited content.",
      "- Exact continuation messages such as 继续, 继续生成, 恢复, resume, or continue are recovery commands, not new creative prompts. Use the video skill's --resume-latest path for this conversation, inspect the existing journal/relay task, and continue polling or download. Never optimize the continuation text, never issue a new generation POST, and never change the locked model or parameters during recovery.",
      "</haolo_video_generation_mode>",
    ].filter(Boolean).join("\n");
  }
  return [
    serialExecutionInstructions,
    "<haolo_execution_mode>",
    "Haolo Execution mode is active. Execute the user's request directly as the single root agent.",
    "</haolo_execution_mode>",
  ].join("\n");
}

function normalizeImageGenerationModel(value) {
  const model = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._:/-]{0,199}$/i.test(model)) return "";
  return GPT_IMAGE_2_MODEL_ALIASES.has(model.toLowerCase())
    ? CANONICAL_GPT_IMAGE_2_MODEL
    : GPT_IMAGE_2_1K_MODEL_ALIASES.has(model.toLowerCase())
      ? CANONICAL_GPT_IMAGE_2_1K_MODEL
      : model;
}

function normalizeImageGenerationSize(value) {
  const size = String(value || "").trim().toLowerCase();
  return /^(?:auto|\d{1,4}x\d{1,4}|\d{1,2}:\d{1,2})$/.test(size)
    ? size
    : "";
}

function normalizeImageGenerationSizeField(value) {
  return value === "size" || value === "aspect_ratio" ? value : "";
}

export function normalizeVideoGenerationOptions(options = {}) {
  const rawModel = normalizeVideoGenerationToken(
    options.videoGenerationModel || options.video_generation_model,
    200,
  );
  const model = [
    "grok-imagine-video-1.5-preview",
    "aihubcc/grok-imagine-video-1.5-preview",
  ].includes(rawModel)
    ? "grok-imagine-video-1.5"
    : rawModel;
  const rawDuration = normalizeVideoGenerationDuration(
    options.videoGenerationDuration || options.video_generation_duration,
  );
  const inputMode = String(
    options.videoGenerationInputMode || options.video_generation_input_mode || "",
  )
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return {
    model,
    inputMode: [
      "image-to-video",
      "text-to-video",
      "text-or-image-to-video",
      "first-last-frame-to-video",
      "video-to-video",
      "multimodal-to-video",
    ].includes(inputMode)
      ? inputMode
      : "",
    aspectRatio: normalizeVideoGenerationToken(
      options.videoGenerationAspectRatio || options.video_generation_aspect_ratio,
      64,
    ),
    duration:
      model === "grok-imagine-video-1.5" && Number(rawDuration) > 15
        ? ""
        : rawDuration,
    resolution: normalizeVideoGenerationToken(
      options.videoGenerationResolution || options.video_generation_resolution,
      64,
    ),
    size: normalizeVideoGenerationToken(
      options.videoGenerationSize || options.video_generation_size,
      64,
    ),
  };
}

function normalizeVideoGenerationToken(value, maxLength) {
  const token = String(value || "").trim();
  return token.length <= maxLength && /^[a-z0-9][a-z0-9._:/x-]*$/i.test(token)
    ? token
    : "";
}

function normalizeVideoGenerationDuration(value) {
  const duration = String(value || "").trim();
  return /^(?:[1-9]|[1-5]\d|60)$/.test(duration) ? duration : "";
}
