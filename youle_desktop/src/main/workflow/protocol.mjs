import crypto from "node:crypto";
import {
  WORKFLOW_EXECUTOR_TYPES,
  isWorkflowAgentExecutorType,
  normalizeNodeCapabilityRequest,
  normalizeWorkflowExecutorType,
} from "./executor-boundary.mjs";

export const WORKFLOW_PROTOCOL_VERSION = 1;
const MAX_MODEL_EXECUTOR_CANDIDATES = 3;
const DEFAULT_MAX_PARALLEL_MODELS_PER_GROUP = 2;
const USER_REQUEST_MAX_PARALLEL_MODELS_PER_GROUP = 3;

export const WORKFLOW_RUN_STATUSES = Object.freeze([
  "planning",
  "running",
  "accepting",
  "succeeded",
  "failed",
  "cancelled",
]);

export const WORKFLOW_NODE_STATUSES = Object.freeze([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);

export const WORKFLOW_EXECUTION_RESULT_STATUSES = Object.freeze([
  "succeeded",
  "partial",
  "failed",
  "blocked",
]);

const RUN_STATUS_SET = new Set(WORKFLOW_RUN_STATUSES);
const NODE_STATUS_SET = new Set(WORKFLOW_NODE_STATUSES);
const EXECUTION_RESULT_STATUS_SET = new Set(WORKFLOW_EXECUTION_RESULT_STATUSES);

export function requestedParallelModelCount(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const countToken = String.raw`([一二两三四五六七八九十\d]+)`;
  const subject = String.raw`(?:模型|节点|智能体|agents?|models?|nodes?)`;
  const parallel = String.raw`(?:并行|同时运行|同步执行|parallel|concurrent)`;
  const patterns = [
    new RegExp(`${countToken}\\s*(?:个|名|路)?\\s*${parallel}(?:的)?\\s*${subject}`, "i"),
    new RegExp(`${countToken}\\s*(?:个|名|路)?\\s*${subject}(?:的)?\\s*${parallel}`, "i"),
    new RegExp(`${parallel}\\s*(?:派出|调用|安排|使用|让)?\\s*${countToken}\\s*(?:个|名|路)?\\s*${subject}`, "i"),
  ];
  const token = patterns.map((pattern) => text.match(pattern)?.[1]).find(Boolean);
  const parsed = parseRequestedCountToken(token);
  if (parsed == null || parsed < 2) return null;
  return Math.min(USER_REQUEST_MAX_PARALLEL_MODELS_PER_GROUP, parsed);
}

function parseRequestedCountToken(value) {
  const token = String(value || "").trim();
  if (!token) return null;
  if (/^\d+$/.test(token)) return Number(token);
  const chineseNumbers = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return chineseNumbers[token] ?? null;
}

export function workflowId(prefix = "run") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function isoNow() {
  return new Date().toISOString();
}

export function normalizeExecutionResult(value = {}, fallback = {}) {
  const declaredStatus = String(value?.status || "").trim().toLowerCase();
  const status = EXECUTION_RESULT_STATUS_SET.has(declaredStatus)
    ? declaredStatus
    : value?.ok === false ? "failed" : "succeeded";
  const outputText = firstText(value?.outputText, value?.output, value?.text, fallback?.outputText);
  const errorText = firstText(value?.error?.message, value?.error, fallback?.error);
  return {
    protocolVersion: WORKFLOW_PROTOCOL_VERSION,
    status,
    output: {
      text: outputText,
      summary: firstText(
        value?.chatSummary,
        value?.chat_summary,
        value?.output?.summary,
        fallback?.chatSummary,
        fallback?.chat_summary,
      ),
      data: serializableObject(value?.data),
      artifacts: normalizeArtifacts(value?.artifacts),
    },
    evidence: normalizeEvidence(value?.evidence),
    effects: normalizeEffects(value?.effects),
    unresolved: normalizeEvidence(value?.unresolved),
    suggestedNextSteps: normalizeEvidence(
      value?.suggestedNextSteps || value?.suggested_next_steps,
    ),
    confidence: clampConfidence(value?.confidence ?? fallback?.confidence),
    diagnostics: {
      provider: firstText(value?.provider, fallback?.provider) || null,
      model: firstText(value?.model, fallback?.model) || null,
      executorType: firstText(value?.executorType, fallback?.executorType) || null,
      taskId: firstText(value?.taskId, fallback?.taskId) || null,
      capabilityGrantId: firstText(
        value?.capabilityGrantId,
        fallback?.capabilityGrantId,
      ) || null,
      durationMs: finiteNonNegative(value?.durationMs ?? fallback?.durationMs),
      attempts: Math.max(1, Math.floor(Number(value?.attempts ?? fallback?.attempts ?? 1) || 1)),
    },
    error: status !== "succeeded" && (status === "failed" || status === "blocked" || value?.error)
      ? {
          code: firstText(value?.error?.code, value?.code, fallback?.code) || "NODE_EXECUTION_FAILED",
          message: errorText || "Node execution failed.",
          retryable: value?.error?.retryable === true || value?.retryable === true,
          category: firstText(value?.error?.category, value?.category, fallback?.category) || null,
          status: optionalFiniteNonNegative(value?.error?.status ?? value?.statusCode ?? fallback?.status),
          retryAfterMs: optionalFiniteNonNegative(
            value?.error?.retryAfterMs
            ?? value?.error?.retry_after_ms
            ?? value?.retryAfterMs
            ?? fallback?.retryAfterMs,
          ),
          requestId: firstText(
            value?.error?.requestId,
            value?.error?.request_id,
            value?.requestId,
            fallback?.requestId,
          ) || null,
          upstreamStatus: optionalFiniteNonNegative(
            value?.error?.upstreamStatus
            ?? value?.error?.upstream_status
            ?? value?.upstreamStatus
            ?? fallback?.upstreamStatus,
          ),
          routeExhausted: value?.error?.routeExhausted === true
            || value?.error?.route_exhausted === true
            || value?.routeExhausted === true,
        }
      : null,
    raw: value?.raw === undefined ? null : value.raw,
  };
}

export function nodePromptWithOutputRequirements(prompt, requirements = []) {
  const basePrompt = String(prompt || "").trim();
  const normalizedRequirements = normalizeStringList(requirements);
  const missingRequirements = normalizedRequirements.filter((requirement) => (
    !basePrompt.includes(requirement)
  ));
  if (!missingRequirements.length) return basePrompt;
  return [
    basePrompt,
    `输出要求：\n- ${missingRequirements.join("\n- ")}`,
  ].filter(Boolean).join("\n\n");
}

export function normalizeWorkflowPlan(value, registry, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const providers = new Set((registry || []).map((item) => String(item.provider || "").trim()).filter(Boolean));
  const usedIds = new Set();
  const sourceNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const nodes = [];
  for (let index = 0; index < sourceNodes.length; index += 1) {
    const item = sourceNodes[index] || {};
    const requestedExecutorType = normalizeWorkflowExecutorType(
      item.executorType || item.executor_type || item.kind,
      WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
    );
    const implicitRegistryEntry = requestedExecutorType === WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT
      ? (registry || []).find((entry) => (
          normalizeWorkflowExecutorType(entry?.executorType) === WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT
        ))
      : null;
    const provider = String(item.provider || implicitRegistryEntry?.provider || "").trim().toLowerCase();
    if (!providers.has(provider)) continue;
    const providerRegistryEntries = (registry || []).filter((entry) => entry.provider === provider);
    const registryEntry = providerRegistryEntries.find((entry) => (
      entry.provider === provider
      && normalizeWorkflowExecutorType(entry.executorType) === requestedExecutorType
    )) || {};
    if (providerRegistryEntries.length && !registryEntry.provider) continue;
    const executorType = normalizeWorkflowExecutorType(
      registryEntry.executorType,
      requestedExecutorType,
    );
    const executorCandidates = normalizeExecutorCandidates(
      { ...item, provider },
      registry || [],
      providers,
      executorType,
    );
    if (!executorCandidates.length) continue;
    const primaryExecutor = executorCandidates[0];
    const contextSelection = normalizeNodeContextSelection(item, options.uploadManifest);
    const prompt = firstText(
      item.prompt,
      item.instructions,
      "请分析用户任务，并给出对最终交付最有价值的结论。",
    ) || "";
    const legacyOutputRequirements = normalizeStringList([
      ...normalizeStringList(item?.outputContract?.requirements || item?.output_contract?.requirements),
      ...normalizeStringList(item.acceptance || item.acceptanceCriteria || item.acceptance_criteria),
    ]);
    let id = safeNodeId(item.id || `${provider}-${index + 1}`);
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    nodes.push({
      id,
      kind: isWorkflowAgentExecutorType(executorType)
        ? "agent"
        : executorType === WORKFLOW_EXECUTOR_TYPES.TOOL ? "tool" : "model",
      executorType,
      title: firstText(item.title, registryEntry.name, provider) || provider,
      purpose: firstText(item.purpose, item.role, "分析当前任务") || "分析当前任务",
      provider: primaryExecutor?.provider || provider,
      model: primaryExecutor?.model || firstText(registryEntry.model) || null,
      executorCandidates,
      prompt: nodePromptWithOutputRequirements(prompt, legacyOutputRequirements),
      dependsOn: normalizeStringList(item.dependsOn || item.depends_on).filter((idValue) => idValue !== id),
      contextSelection,
      needsLocalContext: contextSelection.needsLocalFiles,
      capabilityRequest: normalizeNodeCapabilityRequest(
        item.capabilityRequest || item.capability_request || item.permissions,
        executorType,
      ),
      risk: normalizeRisk(item.risk),
      acceptance: [],
      coordination: isWorkflowAgentExecutorType(executorType)
        ? { mode: "solo", parallelGroup: null, reviewTargets: [] }
        : normalizeCoordination(item),
    });
  }
  const validIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    node.dependsOn = node.dependsOn.filter((id) => validIds.has(id));
    node.coordination.reviewTargets = node.coordination.reviewTargets.filter((id) => (
      validIds.has(id) && id !== node.id
    ));
  }
  removeDependencyCycles(nodes);
  const collaboration = enforceParallelReviewTopology(nodes, registry || [], {
    requestedParallelModels: requestedParallelModelCount(options.userPrompt),
  });
  removeDependencyCycles(nodes);
  const complexityAssessment = normalizeComplexityAssessment(
    source.complexityAssessment || source.complexity_assessment,
    collaboration.groupCount,
    collaboration.maxParallelModels,
  );
  return {
    protocolVersion: WORKFLOW_PROTOCOL_VERSION,
    goalContract: normalizeGoalContract(
      source.goalContract || source.goal_contract,
      { userPrompt: options.userPrompt },
    ),
    complexityAssessment,
    rationale: firstText(source.rationale, source.reasoning, source.summary) || "",
    nodes,
    finalAcceptancePrompt: normalizeFinalAcceptancePrompt(
      firstText(source.finalAcceptancePrompt, source.final_acceptance_prompt),
      options.userPrompt,
    ),
  };
}

function enforceParallelReviewTopology(nodes, registry, options = {}) {
  const requestedParallelModels = Number(options.requestedParallelModels) || null;
  const requestedGroupId = requestedParallelModels
    ? ensureRequestedParallelCandidateCount(nodes, registry, requestedParallelModels)
    : null;
  const groups = new Map();
  for (const node of nodes) {
    if (node.coordination.mode !== "parallel_candidate" || !node.coordination.parallelGroup) continue;
    const group = groups.get(node.coordination.parallelGroup) || [];
    group.push(node);
    groups.set(node.coordination.parallelGroup, group);
  }

  let groupCount = 0;
  let maxParallelModels = 1;
  for (const [groupId, sourceCandidates] of groups) {
    const targetCandidateCount = groupId === requestedGroupId
      ? requestedParallelModels
      : DEFAULT_MAX_PARALLEL_MODELS_PER_GROUP;
    const candidates = sourceCandidates.slice(0, targetCandidateCount);
    for (const extra of sourceCandidates.slice(targetCandidateCount)) {
      extra.coordination = { mode: "solo", parallelGroup: null, reviewTargets: [] };
    }
    if (candidates.length !== targetCandidateCount) {
      for (const candidate of candidates) {
        candidate.coordination = { mode: "solo", parallelGroup: null, reviewTargets: [] };
      }
      continue;
    }

    groupCount += 1;
    maxParallelModels = Math.max(maxParallelModels, candidates.length);
    const candidateIds = candidates.map((candidate) => candidate.id);
    const candidateIdSet = new Set(candidateIds);
    const sharedDependencies = [...new Set(candidates.flatMap((candidate) => candidate.dependsOn))]
      .filter((dependencyId) => !candidateIdSet.has(dependencyId));
    for (const candidate of candidates) candidate.dependsOn = [...sharedDependencies];

    let reviewer = nodes.find((node) => (
      node.coordination.mode === "review_gate"
      && (
        node.coordination.parallelGroup === groupId
        || candidateIds.every((candidateId) => node.coordination.reviewTargets.includes(candidateId))
      )
    ));
    if (!reviewer) {
      reviewer = synthesizedReviewNode(groupId, candidates, nodes, registry);
      nodes.push(reviewer);
    }
    reviewer.coordination = {
      mode: "review_gate",
      parallelGroup: groupId,
      reviewTargets: candidateIds,
    };
    reviewer.dependsOn = [...new Set([
      ...reviewer.dependsOn.filter((dependencyId) => !candidateIdSet.has(dependencyId)),
      ...candidateIds,
    ])];
    ensureIndependentReviewer(reviewer, candidates, registry);

    for (const downstream of nodes) {
      if (downstream.id === reviewer.id || candidateIdSet.has(downstream.id)) continue;
      if (!downstream.dependsOn.some((dependencyId) => candidateIdSet.has(dependencyId))) continue;
      downstream.dependsOn = [
        ...downstream.dependsOn.filter((dependencyId) => !candidateIdSet.has(dependencyId)),
        reviewer.id,
      ];
    }
  }
  return { groupCount, maxParallelModels };
}

function ensureRequestedParallelCandidateCount(nodes, registry, requestedParallelModels) {
  const groupedCandidates = new Map();
  for (const node of nodes) {
    if (node.coordination.mode !== "parallel_candidate" || !node.coordination.parallelGroup) continue;
    const group = groupedCandidates.get(node.coordination.parallelGroup) || [];
    group.push(node);
    groupedCandidates.set(node.coordination.parallelGroup, group);
  }
  let requestedGroup = [...groupedCandidates.entries()]
    .sort((left, right) => right[1].length - left[1].length)[0] || null;
  if (!requestedGroup) {
    const anchor = nodes.find((node) => node.coordination.mode === "solo");
    if (!anchor) return null;
    const groupId = "user-requested-parallel";
    anchor.coordination = { mode: "parallel_candidate", parallelGroup: groupId, reviewTargets: [] };
    requestedGroup = [groupId, [anchor]];
  }

  const [groupId, candidates] = requestedGroup;
  while (candidates.length < requestedParallelModels) {
    const synthesized = synthesizedParallelCandidate(groupId, candidates, nodes, registry);
    if (!synthesized) break;
    const insertionIndex = Math.max(...candidates.map((candidate) => nodes.indexOf(candidate))) + 1;
    nodes.splice(insertionIndex, 0, synthesized);
    candidates.push(synthesized);
  }
  return candidates.length >= requestedParallelModels ? groupId : null;
}

function synthesizedParallelCandidate(groupId, candidates, nodes, registry) {
  const existingReviewer = nodes.find((node) => (
    node.coordination.mode === "review_gate"
    && node.coordination.parallelGroup === groupId
  ));
  const excludedProviders = new Set([
    ...candidates.map((candidate) => candidate.provider),
    existingReviewer?.provider,
  ].filter(Boolean));
  const executorCandidates = independentExecutorCandidates([], excludedProviders, registry);
  const primary = executorCandidates[0];
  const anchor = candidates[0];
  if (!primary || !anchor) return null;
  const ordinal = candidates.length + 1;
  return {
    id: uniqueNodeId(`${groupId}-candidate-${ordinal}`, new Set(nodes.map((node) => node.id))),
    kind: "model",
    executorType: WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
    title: `${primary.provider} 独立候选 ${ordinal}`,
    purpose: anchor.purpose,
    provider: primary.provider,
    model: primary.model,
    executorCandidates,
    prompt: `请作为第 ${ordinal} 路独立模型完成同一关键目标。${anchor.prompt}`,
    dependsOn: [...anchor.dependsOn],
    contextSelection: anchor.contextSelection,
    needsLocalContext: anchor.needsLocalContext,
    capabilityRequest: normalizeNodeCapabilityRequest(
      null,
      WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
    ),
    risk: anchor.risk,
    acceptance: [],
    coordination: {
      mode: "parallel_candidate",
      parallelGroup: groupId,
      reviewTargets: [],
    },
  };
}

function normalizeNodeContextSelection(item, uploadManifest = []) {
  const raw = (
    item?.contextSelection
    || item?.context_selection
    || item?.inputSelection
    || item?.input_selection
  );
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const manifest = Array.isArray(uploadManifest)
    ? uploadManifest.filter((upload) => upload && typeof upload === "object" && !Array.isArray(upload))
    : [];
  const needsLocalFiles = source.needsLocalFiles === true
    || source.needs_local_files === true
    || (!raw && (item?.needsLocalContext === true || item?.needs_local_context === true));
  const scope = normalizeStringList(source.scope || source.scopes)
    .map((value) => value.toLowerCase())
    .filter((value) => value === "current_group" || value === "uploads");
  if (needsLocalFiles && !scope.length) scope.push("current_group");

  const requestedUploads = new Set(
    normalizeStringList(source.selectedUploads || source.selected_uploads)
      .map((value) => value.toLowerCase()),
  );
  const selectedUploadIds = manifest
    .filter((upload) => {
      const identities = [
        upload.id,
        upload.name,
        upload.path,
        upload.local_path,
      ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
      return identities.some((value) => requestedUploads.has(value));
    })
    .map((upload) => String(upload.id || "").trim())
    .filter(Boolean);

  // Old persisted/planner envelopes did not have contextSelection. Preserve their
  // attachment delivery only as a compatibility path; new plans must select inputs.
  if (!raw && !requestedUploads.size) {
    selectedUploadIds.push(
      ...manifest.map((upload) => String(upload.id || "").trim()).filter(Boolean),
    );
  }

  return {
    protocolVersion: 1,
    needsLocalFiles,
    scope: [...new Set(scope)],
    selectedUploadIds: [...new Set(selectedUploadIds)],
    searchHints: normalizeStringList(source.searchHints || source.search_hints).slice(0, 32),
    requiredEvidence: normalizeStringList(
      source.requiredEvidence || source.required_evidence,
    ).slice(0, 32),
    rationale: firstText(source.rationale, source.reason) || "",
    source: raw ? "haolo_semantic_plan" : "legacy_plan_compatibility",
  };
}

function synthesizedReviewNode(groupId, candidates, nodes, registry) {
  const id = uniqueNodeId(`${groupId}-review`, new Set(nodes.map((node) => node.id)));
  const excludedProviders = new Set(candidates.map((candidate) => candidate.provider));
  const externalRegistry = externalModelRegistry(registry);
  const reviewerEntry = externalRegistry.find((entry) => !excludedProviders.has(entry.provider))
    || externalRegistry[0]
    || {};
  const executorCandidates = independentExecutorCandidates([], excludedProviders, registry);
  return {
    id,
    kind: "model",
    executorType: WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
    title: "独立交叉审核",
    purpose: `汇总 ${candidates.length} 路独立结果，核验冲突、证据与成功标准后再放行下游`,
    provider: executorCandidates[0]?.provider || reviewerEntry.provider || null,
    model: executorCandidates[0]?.model || reviewerEntry.model || null,
    executorCandidates,
    prompt: `请独立比较全部 ${candidates.length} 路候选结果，逐项核验事实、逻辑、遗漏和成功标准。明确给出通过、需修订或不可继续的结论，并提供可供下游直接执行的定向修订意见。`,
    dependsOn: candidates.map((candidate) => candidate.id),
    contextSelection: normalizeNodeContextSelection({ needsLocalContext: false }),
    needsLocalContext: false,
    capabilityRequest: normalizeNodeCapabilityRequest(
      null,
      WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
    ),
    risk: "medium",
    acceptance: [],
    coordination: {
      mode: "review_gate",
      parallelGroup: groupId,
      reviewTargets: candidates.map((candidate) => candidate.id),
    },
  };
}

function ensureIndependentReviewer(reviewer, candidates, registry) {
  const excludedProviders = new Set(candidates.map((candidate) => candidate.provider));
  const independent = independentExecutorCandidates(reviewer.executorCandidates, excludedProviders, registry);
  if (!independent.length) return;
  reviewer.executorCandidates = independent;
  reviewer.provider = independent[0].provider;
  reviewer.model = independent[0].model;
}

function independentExecutorCandidates(source, excludedProviders, registry) {
  const candidates = [];
  const used = new Set();
  const add = (candidate) => {
    const provider = String(candidate?.provider || "").trim().toLowerCase();
    if (!provider || excludedProviders.has(provider)) return;
    const resolved = resolveRegisteredExecutor(candidate, registry);
    if (!resolved) return;
    const key = `${resolved.provider}\u0000${resolved.model || ""}`;
    if (used.has(key)) return;
    used.add(key);
    candidates.push(resolved);
  };
  (source || []).forEach(add);
  externalModelRegistry(registry).forEach(add);
  return candidates.slice(0, MAX_MODEL_EXECUTOR_CANDIDATES);
}

function externalModelRegistry(registry) {
  return (registry || []).filter((entry) => (
    normalizeWorkflowExecutorType(entry?.executorType) === WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL
  ));
}

function uniqueNodeId(value, usedIds) {
  const base = safeNodeId(value);
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  return id;
}

function normalizeCoordination(item) {
  const source = item?.coordination && typeof item.coordination === "object"
    ? item.coordination
    : item?.collaboration && typeof item.collaboration === "object"
      ? item.collaboration
      : {};
  const requestedMode = firstText(
    source.mode,
    source.role,
    item?.coordinationMode,
    item?.coordination_mode,
  ).toLowerCase();
  const mode = ["parallel", "candidate", "parallel_candidate"].includes(requestedMode)
    ? "parallel_candidate"
    : ["review", "reviewer", "review_gate"].includes(requestedMode)
      ? "review_gate"
      : "solo";
  const rawParallelGroup = firstText(
      source.parallelGroup,
      source.parallel_group,
      source.group,
      item?.parallelGroup,
      item?.parallel_group,
    );
  const parallelGroup = mode === "solo" || !rawParallelGroup ? null : safeNodeId(rawParallelGroup);
  return {
    mode,
    parallelGroup: parallelGroup || null,
    reviewTargets: mode === "review_gate"
      ? normalizeStringList(
        source.reviewTargets
        || source.review_targets
        || item?.reviewTargets
        || item?.review_targets,
      ).map(safeNodeId)
      : [],
  };
}

function normalizeComplexityAssessment(value, parallelReviewGroupCount, maxParallelModels) {
  const source = value && typeof value === "object" ? value : {};
  const levelText = firstText(source.level, source.complexity).toLowerCase();
  let level = levelText === "complex" || levelText === "high" || levelText === "复杂"
    ? "complex"
    : levelText === "standard" || levelText === "medium" || levelText === "标准"
      ? "standard"
      : "simple";
  if (parallelReviewGroupCount > 0 && level === "simple") level = "standard";
  const scoreValue = Number(source.score);
  const score = Number.isFinite(scoreValue)
    ? Math.max(1, Math.min(5, Math.round(scoreValue)))
    : level === "complex" ? 5 : level === "standard" ? 3 : 1;
  const useParallelReview = parallelReviewGroupCount > 0;
  return {
    level,
    score,
    rationale: firstText(source.rationale, source.reasoning, source.reason) || "",
    factors: normalizeStringList(source.factors || source.reasons),
    strategy: useParallelReview ? "parallel_review" : "serial",
    parallelReviewGroupCount,
    maxParallelModels: useParallelReview ? maxParallelModels : 1,
  };
}

function normalizeExecutorCandidates(
  item,
  registry,
  providers,
  executorType = WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
) {
  const primaryProvider = String(item?.provider || "").trim().toLowerCase();
  const normalizedExecutorType = normalizeWorkflowExecutorType(executorType);
  const compatibleRegistry = (registry || []).filter((entry) => (
    normalizeWorkflowExecutorType(entry?.executorType) === normalizedExecutorType
  ));
  const primaryRegistryEntry = compatibleRegistry.find((entry) => entry.provider === primaryProvider) || {};
  const requested = [
    { provider: primaryProvider, model: firstText(item?.model, primaryRegistryEntry.model) || null },
    ...candidateList(item?.executorCandidates || item?.executor_candidates || item?.candidates),
    ...candidateList(item?.fallbacks || item?.fallbackModels || item?.fallback_models),
  ];
  const candidates = [];
  const used = new Set();
  const add = (candidate) => {
    const provider = String(candidate?.provider || "").trim().toLowerCase();
    if (!providers.has(provider)) return;
    const resolved = resolveRegisteredExecutor(candidate, compatibleRegistry);
    if (!resolved) return;
    const key = `${resolved.provider}\u0000${resolved.model || ""}`;
    if (used.has(key)) return;
    used.add(key);
    candidates.push(resolved);
  };
  requested.forEach(add);
  const agentExecutor = isWorkflowAgentExecutorType(normalizedExecutorType);
  if (!agentExecutor) {
    for (const entry of compatibleRegistry) {
      if (candidates.length >= MAX_MODEL_EXECUTOR_CANDIDATES) break;
      add(entry);
    }
  }
  return candidates.slice(
    0,
    agentExecutor ? 1 : MAX_MODEL_EXECUTOR_CANDIDATES,
  ).map((candidate) => (
    agentExecutor
      ? { ...candidate, executorType: normalizedExecutorType }
      : candidate
  ));
}

function resolveRegisteredExecutor(candidate, registry) {
  const provider = String(candidate?.provider || "").trim().toLowerCase();
  if (!provider) return null;
  const providerEntries = (registry || []).filter(
    (entry) => String(entry?.provider || "").trim().toLowerCase() === provider,
  );
  if (!providerEntries.length) return null;
  const requestedModel = firstText(candidate?.model);
  const lookup = requestedModel.toLowerCase();
  const exact = lookup
    ? providerEntries.find((entry) => {
        const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
        return [
          entry?.model,
          entry?.name,
          entry?.displayName,
          entry?.display_name,
          ...aliases,
        ].some((value) => String(value || "").trim().toLowerCase() === lookup);
      })
    : null;
  const selected = exact || providerEntries[0];
  const model = firstText(selected?.model);
  return model ? { provider, model } : null;
}

function candidateList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((candidate) => {
    if (typeof candidate === "string") return { provider: candidate };
    return candidate && typeof candidate === "object" ? candidate : {};
  });
}

export function normalizeGoalContract(value = {}, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const userPrompt = firstText(options.userPrompt, options.user_prompt);
  const userRequestedPlanningOnly = userExplicitlyRequestsPlanningOnly(userPrompt);
  let successCriteria = normalizeStringList(source.successCriteria || source.success_criteria);
  let constraints = normalizeStringList(source.constraints);
  let prohibitions = normalizeStringList(source.prohibitions || source.forbidden);
  const plannerPolicyLeaked = Boolean(
    userPrompt
    && !userRequestedPlanningOnly
    && (
      [firstText(source.deliverable, source.finalDeliverable, source.final_deliverable), ...successCriteria, ...constraints, ...prohibitions]
        .some(isPlannerPolicyLeak)
      || isWorkflowPlanSubstitution(
        firstText(source.deliverable, source.finalDeliverable, source.final_deliverable),
        userPrompt,
      )
    )
  );
  if (userPrompt && !userRequestedPlanningOnly) {
    successCriteria = successCriteria.filter((item) => !isPlannerPolicyLeak(item));
    constraints = constraints.filter((item) => !isPlannerPolicyLeak(item));
    prohibitions = prohibitions.filter((item) => !isPlannerPolicyLeak(item));
  }
  if (plannerPolicyLeaked) {
    successCriteria = [
      ...successCriteria,
      "直接完成用户请求的最终交付物，不停留在规划、方案、大纲、蓝图或后续操作建议。",
    ];
  }
  return {
    deliverable: userPrompt || firstText(source.deliverable, source.finalDeliverable, source.final_deliverable) || "完成用户提出的任务并给出可验证结果",
    successCriteria: [...new Set(successCriteria)],
    constraints,
    prohibitions,
  };
}

export function finalDeliveryValidationError(userPrompt, outputText) {
  const output = String(outputText || "").trim();
  if (!output) return "最终验收未返回可见交付内容。";
  if (userExplicitlyRequestsPlanningOnly(userPrompt)) return null;
  if (isPlannerPolicyLeak(output.slice(0, 2_000))) {
    return "最终结果仍停留在规划阶段，没有执行原始用户任务。";
  }
  return null;
}

function normalizeFinalAcceptancePrompt(value, userPrompt) {
  const prompt = String(value || "").trim();
  if (!String(userPrompt || "").trim() || userExplicitlyRequestsPlanningOnly(userPrompt)) return prompt;
  if (!prompt || isPlannerPolicyLeak(prompt) || isWorkflowPlanSubstitution(prompt, userPrompt)) {
    return "以原始用户请求为唯一目标，综合节点结果后立即完成并交付最终成果；不得停留在规划、方案、大纲、蓝图或让用户后续自行完成。";
  }
  return prompt;
}

function userExplicitlyRequestsPlanningOnly(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/(?:不要|不能|不得|别).{0,6}(?:只|仅).{0,8}(?:规划|计划|方案|大纲|蓝图)/i.test(text)) {
    return false;
  }
  return /(?:只|仅).{0,6}(?:做|要|需|需要|输出|提供|给出)?\s*(?:规划|计划|方案|大纲|蓝图)|(?:不要|无需|不必|别).{0,12}(?:执行|实施|动手|写(?:出)?(?:正文|成文)|创作正文|生成(?:成品|正文))|\b(?:plan|planning|outline)\s+only\b|\bdo\s+not\s+(?:execute|implement|write\s+the\s+(?:draft|article|story))\b/i.test(text);
}

function isPlannerPolicyLeak(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /(?:只|仅)做规划|只输出(?:工作流)?(?:计划|规划)|不(?:直接)?执行(?:用户|实际)?任务|不得执行(?:实际)?(?:写作|创作)?任务|不直接(?:创作|撰写|写出|生成)(?:小说)?正文|不要(?:创作|撰写|写出|生成)(?:小说)?正文|适合.{0,12}(?:扩写|继续创作)|(?:供|让).{0,12}(?:用户|作者).{0,12}(?:扩写|继续创作|完成正文)|\b(?:plan|planning)\s+only\b|\bdo\s+not\s+execute\s+the\s+user(?:'s)?\s+task\b/i.test(text);
}

function isWorkflowPlanSubstitution(value, userPrompt) {
  const text = String(value || "").trim();
  if (!text || userExplicitlyRequestsWorkflowPlan(userPrompt)) return false;
  return /(?:多模型|执行|创作)?工作流(?:的)?(?:计划|规划|蓝图)|(?:模型节点|多模型).{0,16}(?:编排计划|协作流程)/i.test(text);
}

function userExplicitlyRequestsWorkflowPlan(value) {
  return /(?:请|帮我|给我|我要|需要|制定|设计|创建|搭建|输出).{0,32}(?:工作流|执行图|流程图|workflow)/i.test(
    String(value || "").trim(),
  );
}

export function publicWorkflowRun(run) {
  if (!run || typeof run !== "object") return null;
  return JSON.parse(JSON.stringify(run, (_key, value) => {
    if (value instanceof Error) return { message: value.message, name: value.name };
    return value;
  }));
}

export function isTerminalWorkflowRun(run) {
  return run?.status === "succeeded" || run?.status === "failed" || run?.status === "cancelled";
}

export function assertWorkflowRun(run) {
  if (!run?.id || !run?.threadId) throw new Error("Invalid workflow run identity.");
  if (!RUN_STATUS_SET.has(run.status)) throw new Error(`Invalid workflow run status: ${run.status}`);
  for (const node of run.nodes || []) {
    if (!node?.id || !NODE_STATUS_SET.has(node.status)) {
      throw new Error(`Invalid workflow node: ${node?.id || "unknown"}`);
    }
  }
  return run;
}

function removeDependencyCycles(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (node) => {
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    node.dependsOn = node.dependsOn.filter((dependencyId) => {
      const dependency = byId.get(dependencyId);
      if (!dependency || visiting.has(dependencyId)) return false;
      visit(dependency);
      return true;
    });
    visiting.delete(node.id);
    visited.add(node.id);
  };
  nodes.forEach(visit);
}

function safeNodeId(value) {
  return String(value || "node")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "node";
}

function normalizeRisk(value) {
  const risk = String(value || "low").trim().toLowerCase();
  return risk === "high" || risk === "medium" ? risk : "low";
}

function normalizeStringList(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 50);
}

function normalizeArtifacts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { type: "reference", uri: item, name: null };
      if (!item || typeof item !== "object") return null;
      return {
        type: firstText(item.type, "reference") || "reference",
        uri: firstText(item.uri, item.path, item.url) || null,
        name: firstText(item.name, item.title) || null,
      };
    })
    .filter(Boolean);
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? { summary: item } : serializableObject(item))
    .filter(Boolean)
    .slice(0, 100);
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeEffects(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? { type: "activity", summary: item } : serializableObject(item))
    .filter(Boolean)
    .slice(0, 500);
}

function optionalFiniteNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  return finiteNonNegative(value);
}

function serializableObject(value) {
  if (!value || typeof value !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
