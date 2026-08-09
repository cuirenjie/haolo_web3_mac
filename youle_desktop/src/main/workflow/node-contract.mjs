import crypto from "node:crypto";

export const WORKFLOW_NODE_CONTRACT_VERSION = 1;
export const WORKFLOW_SLOT_TYPES = Object.freeze(["text", "image", "video", "file"]);

const SLOT_TYPE_SET = new Set(WORKFLOW_SLOT_TYPES);
const PROMPT_LABELS = Object.freeze({
  input: "输入：",
  task: "任务：",
  output: "输出：",
});

export function emptyWorkflowNodePrompt() {
  return `${PROMPT_LABELS.input}\n\n${PROMPT_LABELS.task}\n\n${PROMPT_LABELS.output}`;
}

export function splitWorkflowNodePrompt(value) {
  const text = String(value || "").replaceAll("\r\n", "\n");
  const inputAt = text.indexOf(PROMPT_LABELS.input);
  const taskAt = text.indexOf(PROMPT_LABELS.task);
  const outputAt = text.indexOf(PROMPT_LABELS.output);
  if (inputAt < 0 || taskAt <= inputAt || outputAt <= taskAt) {
    return {
      controlled: false,
      input: "",
      task: text.trim(),
      output: "",
    };
  }
  return {
    controlled: true,
    input: text.slice(inputAt + PROMPT_LABELS.input.length, taskAt).trim(),
    task: text.slice(taskAt + PROMPT_LABELS.task.length, outputAt).trim(),
    output: text.slice(outputAt + PROMPT_LABELS.output.length).trim(),
  };
}

export function composeWorkflowNodePrompt({ input = "", task = "", output = "" } = {}) {
  return [
    PROMPT_LABELS.input,
    String(input || "").trim(),
    "",
    PROMPT_LABELS.task,
    String(task || "").trim(),
    "",
    PROMPT_LABELS.output,
    String(output || "").trim(),
  ].join("\n").trimEnd();
}

export function normalizeWorkflowSlot(value = {}, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const type = SLOT_TYPE_SET.has(String(source.type || "").toLowerCase())
    ? String(source.type).toLowerCase()
    : "file";
  const semanticName = String(
    source.semanticName || source.semantic_name || source.name || slotTypeLabel(type),
  ).trim() || slotTypeLabel(type);
  const minCount = Math.max(0, Math.floor(Number(source.minCount ?? source.min_count ?? 1) || 0));
  const maxCandidate = Math.floor(Number(source.maxCount ?? source.max_count ?? (minCount || 1)));
  const maxCount = Math.max(minCount, Number.isFinite(maxCandidate) ? maxCandidate : minCount || 1);
  const origin = normalizeSlotOrigin(source.origin || source.source, options.defaultOrigin);
  const sharedResourceKey = optionalText(
    source.sharedResourceKey || source.shared_resource_key || source.shareKey || source.share_key,
  );
  const distinctResourceKey = optionalText(
    source.distinctResourceKey || source.distinct_resource_key || source.distinctKey || source.distinct_key,
  );
  const stableSeed = [
    options.nodeId || "node",
    options.direction || "slot",
    type,
    semanticName,
    sharedResourceKey || "",
    distinctResourceKey || "",
    options.index ?? 0,
  ].join("|");
  return {
    slotId: String(source.slotId || source.slot_id || deterministicSlotId(stableSeed)),
    type,
    semanticName,
    minCount,
    maxCount,
    required: source.required !== false && minCount > 0,
    accept: uniqueStrings(source.accept || source.extensions || source.mimeTypes || source.mime_types),
    sharedResourceKey,
    distinctResourceKey,
    origin,
    passThroughFromSlotId: optionalText(
      source.passThroughFromSlotId || source.pass_through_from_slot_id,
    ),
  };
}

export function normalizeWorkflowNodeContract(value = {}, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const inputSource = source.inputContract || source.input_contract || {};
  const taskSource = source.taskDefinition || source.task_definition || {};
  const outputSource = source.outputContract || source.output_contract || {};
  return {
    version: WORKFLOW_NODE_CONTRACT_VERSION,
    compiled: source.compiled === true,
    compiledAt: optionalText(source.compiledAt || source.compiled_at),
    compiler: optionalText(source.compiler),
    inputContract: {
      mode: inputSource.mode === "derived" ? "derived" : "declared",
      slots: normalizeSlotList(inputSource.slots, {
        nodeId: options.nodeId,
        direction: "input",
        defaultOrigin: inputSource.mode === "derived" ? "upstream" : "workflow_input",
      }),
    },
    taskDefinition: {
      text: String(taskSource.text || source.task || "").trim(),
    },
    outputContract: {
      slots: normalizeSlotList(outputSource.slots, {
        nodeId: options.nodeId,
        direction: "output",
        defaultOrigin: "generated",
      }),
    },
  };
}

export function compileWorkflowNodeContractPayload(value = {}, options = {}) {
  const nodeId = String(options.nodeId || value.nodeId || value.node_id || "node");
  const taskDefinition = String(value.taskDefinition?.text || value.task || "").trim();
  const contract = normalizeWorkflowNodeContract({
    compiled: true,
    compiledAt: options.compiledAt || new Date().toISOString(),
    compiler: options.compiler || "haolo-codex-semantic-compiler",
    inputContract: {
      mode: options.inputMode === "derived" ? "derived" : "declared",
      slots: value.inputSlots || value.input_slots || [],
    },
    taskDefinition: { text: taskDefinition },
    outputContract: {
      slots: value.outputSlots || value.output_slots || [],
    },
  }, { nodeId });
  const passThroughMappings = Array.isArray(value.passThroughMappings || value.pass_through_mappings)
    ? value.passThroughMappings || value.pass_through_mappings
    : [];
  for (const mapping of passThroughMappings) {
    const outputIndex = Math.floor(Number(mapping?.outputIndex ?? mapping?.output_index));
    const inputIndex = Math.floor(Number(mapping?.inputIndex ?? mapping?.input_index));
    const outputSlot = contract.outputContract.slots[outputIndex];
    const inputSlot = contract.inputContract.slots[inputIndex];
    if (!outputSlot || !inputSlot) continue;
    outputSlot.passThroughFromSlotId = inputSlot.slotId;
  }
  return contract;
}

export function reconcileWorkflowNodeContracts(nodes = [], resources = {}) {
  const normalized = nodes.map((node) => ({ ...node }));
  const byId = new Map(normalized.map((node) => [node.id, node]));
  const ordered = topologicalWorkflowNodes(normalized);
  for (const node of ordered) {
    const current = normalizeWorkflowNodeContract(node.nodeContract || node.node_contract, {
      nodeId: node.id,
    });
    const directUpstream = (node.dependsOn || []).map((id) => byId.get(id)).filter(Boolean);
    const derivedSlots = directUpstream.flatMap((upstream) => {
      const upstreamContract = normalizeWorkflowNodeContract(
        upstream.nodeContract || upstream.node_contract,
        { nodeId: upstream.id },
      );
      return upstreamContract.outputContract.slots.map((slot, index) => normalizeWorkflowSlot({
        ...slot,
        slotId: slot.slotId,
        origin: {
          kind: "upstream",
          nodeId: upstream.id,
          nodeCode: upstream.displayCode || null,
          slotId: slot.slotId,
        },
      }, { nodeId: node.id, direction: "input", index }));
    });
    const fixedSlots = fixedAttachmentSlots(node, resources);
    const fixedNestedBoundary = Boolean(
      node.workflowRef?.specId || node.workflow_ref?.spec_id,
    );
    current.inputContract = fixedNestedBoundary
      ? {
          mode: "declared",
          slots: current.inputContract.slots.filter((slot) => (
            slot.origin.kind !== "fixed_attachment"
          )),
        }
      : {
          mode: directUpstream.length ? "derived" : "declared",
          slots: directUpstream.length
            ? [...derivedSlots, ...fixedSlots]
            : [
                ...current.inputContract.slots.filter((slot) => slot.origin.kind !== "fixed_attachment"),
                ...fixedSlots,
              ],
        };
    node.nodeContract = current;
    const promptSections = splitWorkflowNodePrompt(node.prompt);
    node.prompt = composeWorkflowNodePrompt({
      input: renderWorkflowSlotList(current.inputContract.slots),
      task: current.taskDefinition.text || promptSections.task,
      output: renderWorkflowSlotList(current.outputContract.slots),
    });
  }
  return normalized;
}

export function workflowNestedBoundaryContract(value, options = {}) {
  const nodes = Array.isArray(value?.nodes) ? value.nodes : [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const invocation = workflowInvocationContract(value);
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const node of nodes) {
    for (const dependencyId of node.dependsOn || []) {
      outgoing.get(dependencyId)?.push(node.id);
    }
  }
  const scope = new Set();
  const queue = [...invocation.entryNodeIds];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || scope.has(nodeId) || !byId.has(nodeId)) continue;
    scope.add(nodeId);
    queue.push(...(outgoing.get(nodeId) || []));
  }
  const sinkNodeIds = [...scope].filter((nodeId) => (
    !(outgoing.get(nodeId) || []).some((targetNodeId) => scope.has(targetNodeId))
  ));
  if (sinkNodeIds.length !== 1) {
    return {
      version: 1,
      valid: false,
      message: "历史画布必须具有唯一的最终输出节点。",
      entryNodeIds: invocation.entryNodeIds,
      sinkNodeIds,
      nodeContract: null,
    };
  }
  const sinkNode = byId.get(sinkNodeIds[0]);
  const sinkContract = normalizeWorkflowNodeContract(
    sinkNode?.nodeContract || sinkNode?.node_contract,
    { nodeId: sinkNode?.id },
  );
  const sinkOutputSlots = sinkContract.outputContract.slots.length
    ? sinkContract.outputContract.slots
    : legacyWorkflowOutputSlots(sinkNode);
  if (!sinkOutputSlots.length) {
    return {
      version: 1,
      valid: false,
      message: "历史画布的最终节点尚未定义输出类型。",
      entryNodeIds: invocation.entryNodeIds,
      sinkNodeIds,
      nodeContract: null,
    };
  }
  const nodeId = String(options.nodeId || "nested_workflow");
  const hasLegacyEntry = invocation.entryNodeIds.some((entryNodeId) => {
    const entry = byId.get(entryNodeId);
    return normalizeWorkflowNodeContract(
      entry?.nodeContract || entry?.node_contract,
      { nodeId: entryNodeId },
    ).compiled !== true;
  });
  const boundaryInputSlots = invocation.slots.length
    ? invocation.slots
    : hasLegacyEntry
      ? [{
          type: "text",
          semanticName: "提示词",
          minCount: 1,
          maxCount: 1,
          required: true,
          accept: [],
        }]
      : [];
  const inputSlots = boundaryInputSlots.map((slot) => ({
    ...slot,
    targetNodeIds: undefined,
    targetNodeCodes: undefined,
    origin: { kind: "workflow_input" },
    passThroughFromSlotId: null,
  }));
  const outputSlots = sinkOutputSlots.map((slot) => ({
    ...slot,
    origin: { kind: "generated" },
    passThroughFromSlotId: null,
  }));
  const nodeContract = normalizeWorkflowNodeContract({
    compiled: true,
    compiler: "haolo-nested-workflow-boundary",
    inputContract: { mode: "declared", slots: inputSlots },
    taskDefinition: {
      text: String(options.task || "完整执行引用的冻结历史画布，并返回其唯一最终节点的输出。"),
    },
    outputContract: { slots: outputSlots },
  }, { nodeId });
  return {
    version: 1,
    valid: true,
    message: null,
    entryNodeIds: invocation.entryNodeIds,
    sinkNodeIds,
    nodeContract,
  };
}

export function hydrateNestedWorkflowNodeContracts(nodes = [], options = {}) {
  if (typeof options.resolveSpec !== "function") return nodes.map((node) => ({ ...node }));
  return nodes.map((node) => {
    const reference = node.workflowRef || node.workflow_ref;
    const specId = String(reference?.specId || reference?.spec_id || "").trim();
    const version = Number(reference?.version);
    if (!specId || !version) return { ...node };
    const nestedSpec = options.resolveSpec(specId, version);
    if (!nestedSpec) return { ...node };
    const current = normalizeWorkflowNodeContract(node.nodeContract || node.node_contract, {
      nodeId: node.id,
    });
    const boundary = workflowNestedBoundaryContract(nestedSpec, {
      nodeId: node.id,
      task: current.taskDefinition.text || node.purpose || node.prompt,
    });
    if (!boundary.valid || !boundary.nodeContract) return { ...node };
    const nodeContract = {
      ...boundary.nodeContract,
      taskDefinition: {
        text: current.taskDefinition.text
          || boundary.nodeContract.taskDefinition.text,
      },
    };
    return {
      ...node,
      nodeContract,
      outputContract: legacyOutputContractFromSlots(nodeContract.outputContract.slots),
      prompt: composeWorkflowNodePrompt({
        input: renderWorkflowSlotList(nodeContract.inputContract.slots),
        task: nodeContract.taskDefinition.text,
        output: renderWorkflowSlotList(nodeContract.outputContract.slots),
      }),
    };
  });
}

function legacyOutputContractFromSlots(slots) {
  const hasText = slots.some((slot) => slot.type === "text");
  const artifactSlots = slots.filter((slot) => slot.type !== "text");
  const format = artifactSlots.length
    ? hasText ? "mixed" : "artifact"
    : "text";
  const requiredArtifactTypes = uniqueStrings(artifactSlots.flatMap((slot) => (
    slot.accept || []
  )));
  return {
    format,
    requirements: [],
    requiredArtifactTypes,
  };
}

export function nestedWorkflowConnectionIssues(nodes = [], options = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const requestedNodeIds = Array.isArray(options.nodeIds)
    ? new Set(options.nodeIds.map((nodeId) => String(nodeId || "")).filter(Boolean))
    : null;
  const errors = [];
  for (const nestedNode of nodes) {
    if (!nestedNode.workflowRef && !nestedNode.workflow_ref) continue;
    if (requestedNodeIds && !requestedNodeIds.has(nestedNode.id)) continue;
    const nestedContract = normalizeWorkflowNodeContract(
      nestedNode.nodeContract || nestedNode.node_contract,
      { nodeId: nestedNode.id },
    );
    if (nestedContract.compiled !== true) {
      errors.push({
        code: "WORKFLOW_NESTED_BOUNDARY_UNDEFINED",
        message: `历史画布节点 ${workflowNodeName(nestedNode)} 的输入输出类型尚未定义。`,
        nodeId: nestedNode.id,
        sourceNodeId: null,
      });
      continue;
    }
    const upstreamNodes = (nestedNode.dependsOn || []).map((nodeId) => byId.get(nodeId)).filter(Boolean);
    if (upstreamNodes.length) {
      const upstreamSlots = upstreamNodes.flatMap(effectiveWorkflowOutputSlots);
      if (!workflowSlotSetsCompatible(upstreamSlots, nestedContract.inputContract.slots, true)) {
        errors.push({
          code: "WORKFLOW_NESTED_INPUT_CONTRACT_MISMATCH",
          message: `上游输出与历史画布节点 ${workflowNodeName(nestedNode)} 的固定输入要求不一致（需要${workflowSlotSummary(nestedContract.inputContract.slots)}）。`,
          nodeId: nestedNode.id,
          sourceNodeId: upstreamNodes[0]?.id || null,
        });
      }
    }
    for (const downstreamNode of nodes.filter((node) => (
      (node.dependsOn || []).includes(nestedNode.id)
      && !node.workflowRef
      && !node.workflow_ref
    ))) {
      const downstreamContract = normalizeWorkflowNodeContract(
        downstreamNode.nodeContract || downstreamNode.node_contract,
        { nodeId: downstreamNode.id },
      );
      const acceptedSlots = downstreamContract.inputContract.slots.filter((slot) => (
        slot.origin.kind !== "fixed_attachment"
      ));
      if (downstreamContract.compiled !== true) continue;
      if (
        !acceptedSlots.length
        || !workflowSlotSetsCompatible(
          nestedContract.outputContract.slots,
          acceptedSlots,
          false,
        )
      ) {
        errors.push({
          code: "WORKFLOW_NESTED_OUTPUT_CONTRACT_MISMATCH",
          message: `历史画布节点 ${workflowNodeName(nestedNode)} 的固定输出（${workflowSlotSummary(nestedContract.outputContract.slots)}）不符合下游节点 ${workflowNodeName(downstreamNode)} 的输入要求。`,
          nodeId: downstreamNode.id,
          sourceNodeId: nestedNode.id,
        });
      }
    }
  }
  return errors;
}

function effectiveWorkflowOutputSlots(node) {
  const contract = normalizeWorkflowNodeContract(
    node?.nodeContract || node?.node_contract,
    { nodeId: node?.id },
  );
  return contract.outputContract.slots.length
    ? contract.outputContract.slots
    : legacyWorkflowOutputSlots(node);
}

function legacyWorkflowOutputSlots(node) {
  const legacy = node?.outputContract || node?.output_contract;
  const format = String(legacy?.format || "").trim().toLowerCase();
  if (!format || format === "auto" || format === "text") {
    return [normalizeWorkflowSlot({
      type: "text",
      semanticName: "文字",
      minCount: 1,
      maxCount: 1,
      origin: { kind: "generated" },
    }, { nodeId: node?.id, direction: "output", index: 0 })];
  }
  if (format === "structured_data") {
    return [normalizeWorkflowSlot({
      type: "file",
      semanticName: "结构化数据",
      minCount: 1,
      maxCount: 1,
      accept: ["application/json", ".json"],
      origin: { kind: "generated" },
    }, { nodeId: node?.id, direction: "output", index: 0 })];
  }
  const requiredTypes = uniqueStrings(
    legacy?.requiredArtifactTypes || legacy?.required_artifact_types,
  ).map((value) => value.startsWith(".") || value.includes("/") ? value : `.${value}`);
  if (format === "artifact" || format === "mixed") {
    const slots = [];
    if (format === "mixed") {
      slots.push(normalizeWorkflowSlot({
        type: "text",
        semanticName: "文字",
        origin: { kind: "generated" },
      }, { nodeId: node?.id, direction: "output", index: 0 }));
    }
    slots.push(normalizeWorkflowSlot({
      type: "file",
      semanticName: "文件",
      accept: requiredTypes,
      origin: { kind: "generated" },
    }, { nodeId: node?.id, direction: "output", index: slots.length }));
    return slots;
  }
  return [];
}

export function workflowSlotSetsCompatible(sourceSlots = [], targetSlots = [], exact = true) {
  if (exact && sourceSlots.length !== targetSlots.length) return false;
  if (!sourceSlots.length) return targetSlots.every((slot) => Number(slot.minCount) === 0);
  const used = new Set();
  const match = (sourceIndex) => {
    if (sourceIndex >= sourceSlots.length) return true;
    for (let targetIndex = 0; targetIndex < targetSlots.length; targetIndex += 1) {
      if (used.has(targetIndex)) continue;
      if (!workflowSlotsCompatible(sourceSlots[sourceIndex], targetSlots[targetIndex])) continue;
      used.add(targetIndex);
      if (match(sourceIndex + 1)) return true;
      used.delete(targetIndex);
    }
    return false;
  };
  return match(0);
}

function workflowSlotsCompatible(source, target) {
  if (source.type !== target.type) return false;
  if (
    Number(source.minCount) < Number(target.minCount)
    || Number(source.maxCount) > Number(target.maxCount)
  ) return false;
  const targetAccept = uniqueStrings(target.accept).map(normalizeAcceptToken);
  if (!targetAccept.length) return true;
  const sourceAccept = uniqueStrings(source.accept).map(normalizeAcceptToken);
  if (!sourceAccept.length) return false;
  return sourceAccept.every((sourceToken) => (
    targetAccept.some((targetToken) => workflowAcceptTokenMatches(sourceToken, targetToken))
  ));
}

function workflowAcceptTokenMatches(source, target) {
  if (source === target || target === "*/*" || target === "*") return true;
  if (target.endsWith("/*") && source.startsWith(target.slice(0, -1))) return true;
  return workflowAcceptFamily(source) === workflowAcceptFamily(target);
}

function normalizeAcceptToken(value) {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return "";
  return token.startsWith(".") || token.includes("/") || token.includes("*")
    ? token
    : `.${token}`;
}

function workflowAcceptFamily(value) {
  if ([".doc", "application/msword"].includes(value)) return "word-doc";
  if ([
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ].includes(value)) return "word-docx";
  return value;
}

function workflowSlotSummary(slots) {
  if (!slots.length) return "无额外输入";
  return slots.map((slot) => {
    const count = slot.minCount === slot.maxCount
      ? `${slot.minCount} 个`
      : `${slot.minCount}-${slot.maxCount} 个`;
    return `${count}${slot.semanticName || slotTypeLabel(slot.type)}`;
  }).join("、");
}

function workflowNodeName(node) {
  return node.displayCode || node.title || node.id;
}

export function workflowInvocationContract(value, requestedEntryNodeIds = null) {
  const nodes = Array.isArray(value?.nodes) ? value.nodes : [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const entryIds = Array.isArray(requestedEntryNodeIds)
    ? requestedEntryNodeIds
    : (value?.entryBindings || []).map((binding) => binding?.targetNodeId).filter(Boolean);
  const candidates = [];
  const slots = [];
  const shared = new Map();
  for (const nodeId of entryIds) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const contract = normalizeWorkflowNodeContract(node.nodeContract || node.node_contract, { nodeId });
    const typeOrdinals = new Map();
    for (const slot of contract.inputContract.slots) {
      if (slot.origin.kind === "fixed_attachment" || slot.origin.kind === "upstream") continue;
      const typeOrdinal = typeOrdinals.get(slot.type) || 0;
      typeOrdinals.set(slot.type, typeOrdinal + 1);
      candidates.push({ slot, nodeId, nodeCode: node.displayCode || null, typeOrdinal });
    }
  }

  for (const candidate of candidates) {
    const { slot, nodeId, nodeCode } = candidate;
    const lookupKey = workflowInvocationSharedLookupKey(candidate, candidates);
    const target = shared.get(lookupKey);
    if (target) {
      if (!target.targetNodeIds.includes(nodeId)) {
        target.targetNodeIds.push(nodeId);
        target.targetNodeCodes.push(nodeCode);
      }
      shared.set(slot.slotId, target);
      continue;
    }
    const invocationSlot = {
      ...slot,
      targetNodeIds: [nodeId],
      targetNodeCodes: [nodeCode],
    };
    slots.push(invocationSlot);
    shared.set(lookupKey, invocationSlot);
    shared.set(slot.slotId, invocationSlot);
  }
  return { version: 1, entryNodeIds: [...entryIds], slots };
}

function workflowInvocationSharedLookupKey(candidate, candidates) {
  const { slot, nodeId } = candidate;
  const distinctKey = String(slot.distinctResourceKey || "").trim();
  if (distinctKey) return `distinct:${slot.type}:${distinctKey}`;
  const sharedKey = String(slot.sharedResourceKey || "").trim();
  const peers = candidates.filter((other) => (
    other !== candidate
    && other.nodeId !== nodeId
    && workflowInvocationSlotsCanShare(slot, other.slot)
  ));
  if (sharedKey) {
    const aliasedPeer = peers.find((other) => other.slot.slotId === sharedKey);
    if (aliasedPeer) {
      const aliasedDistinctKey = String(aliasedPeer.slot.distinctResourceKey || "").trim();
      return aliasedDistinctKey
        ? `distinct:${slot.type}:${aliasedDistinctKey}`
        : aliasedPeer.slot.slotId;
    }
    if (peers.some((other) => String(other.slot.sharedResourceKey || "").trim() === sharedKey)) {
      return `shared:${slot.type}:${sharedKey}`;
    }
    const unkeyedPeers = peers.filter((other) => (
      !String(other.slot.sharedResourceKey || "").trim()
      && !String(other.slot.distinctResourceKey || "").trim()
    ));
    if (unkeyedPeers.length === 1) return unkeyedPeers[0].slot.slotId;
    return `shared:${slot.type}:${sharedKey}`;
  }

  const explicitAliases = peers.filter((other) => (
    String(other.slot.sharedResourceKey || "").trim() === slot.slotId
  ));
  if (explicitAliases.length) return slot.slotId;
  const unkeyedPeers = peers.filter((other) => (
    !String(other.slot.sharedResourceKey || "").trim()
    && !String(other.slot.distinctResourceKey || "").trim()
  ));
  const legacyKeyedPeers = peers.filter((other) => (
    String(other.slot.sharedResourceKey || "").trim()
    && !String(other.slot.distinctResourceKey || "").trim()
  ));
  if (legacyKeyedPeers.length && !unkeyedPeers.length) return slot.slotId;
  return workflowInvocationDefaultSharedLookupKey(candidate);
}

function workflowInvocationDefaultSharedLookupKey(candidate) {
  const { slot, typeOrdinal } = candidate;
  const accept = [...new Set((slot.accept || [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean))]
    .sort()
    .join(",");
  return `default:${slot.type}:${typeOrdinal}:${slot.minCount}:${slot.maxCount}:${accept}`;
}

function workflowInvocationSlotsCanShare(left, right) {
  if (
    left.type !== right.type
    || left.minCount !== right.minCount
    || left.maxCount !== right.maxCount
  ) return false;
  const leftAccept = new Set((left.accept || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  const rightAccept = new Set((right.accept || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  if (!leftAccept.size || !rightAccept.size) return true;
  return [...leftAccept].some((value) => rightAccept.has(value));
}

export function validateWorkflowInvocationValues(contract, values = {}) {
  const supplied = values && typeof values === "object" ? values : {};
  const errors = [];
  const known = new Set((contract?.slots || []).map((slot) => slot.slotId));
  for (const slot of contract?.slots || []) {
    const list = Array.isArray(supplied[slot.slotId])
      ? supplied[slot.slotId]
      : supplied[slot.slotId] == null ? [] : [supplied[slot.slotId]];
    if (list.length < slot.minCount || list.length > slot.maxCount) {
      errors.push({
        code: "WORKFLOW_INPUT_SLOT_COUNT_INVALID",
        slotId: slot.slotId,
        message: inputSlotRequirementMessage(slot),
      });
    }
  }
  for (const slotId of Object.keys(supplied)) {
    if (!known.has(slotId) && supplied[slotId] != null) {
      errors.push({
        code: "WORKFLOW_INPUT_SLOT_UNKNOWN",
        slotId,
        message: "上传了当前运行入口未声明的额外输入。",
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

export function renderWorkflowSlotList(slots = []) {
  if (!slots.length) return "待定义";
  const counts = new Map();
  return slots.map((slot) => {
    const typeLabel = slotTypeLabel(slot.type);
    const next = (counts.get(slot.type) || 0) + 1;
    counts.set(slot.type, next);
    const name = slot.semanticName || `${typeLabel}${next}`;
    const source = slot.origin.kind === "upstream"
      ? `（来自节点 ${slot.origin.nodeCode || slot.origin.nodeId || "上游"}）`
      : slot.origin.kind === "fixed_attachment"
        ? `（固定附件：${slot.origin.attachmentName || name}）`
        : "";
    const quantity = slot.minCount === 1 && slot.maxCount === 1
      ? ""
      : `（${slot.minCount}-${slot.maxCount} 个）`;
    return `- ${name}${quantity}${source}`;
  }).join("\n");
}

export function workflowDisplayCode(index) {
  let value = Math.max(0, Math.floor(Number(index) || 0));
  let output = "";
  do {
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return output;
}

function fixedAttachmentSlots(node, resources) {
  const attachments = Array.isArray(resources?.attachments) ? resources.attachments : [];
  const byId = new Map(attachments.map((attachment) => [String(attachment?.id || ""), attachment]));
  return (node.attachmentRefs || []).map((reference, index) => {
    const attachmentId = String(reference?.id || reference || "");
    const attachment = byId.get(attachmentId) || reference || {};
    const type = attachmentType(attachment);
    const name = String(attachment?.name || attachmentId || `${slotTypeLabel(type)}${index + 1}`);
    return normalizeWorkflowSlot({
      slotId: `fixed_${node.id}_${shortHash(attachmentId || name)}`,
      type,
      semanticName: name,
      minCount: 1,
      maxCount: 1,
      required: true,
      accept: [attachment?.mime].filter(Boolean),
      origin: {
        kind: "fixed_attachment",
        attachmentId,
        attachmentName: name,
      },
    }, { nodeId: node.id, direction: "input", index });
  });
}

function normalizeSlotList(value, options) {
  if (!Array.isArray(value)) return [];
  return value.map((slot, index) => normalizeWorkflowSlot(slot, { ...options, index }));
}

function normalizeSlotOrigin(value, fallback = "workflow_input") {
  if (typeof value === "string") return { kind: value };
  const source = value && typeof value === "object" ? value : {};
  const requested = String(source.kind || fallback || "workflow_input");
  const kind = ["workflow_input", "upstream", "fixed_attachment", "generated"].includes(requested)
    ? requested
    : fallback;
  return {
    kind,
    nodeId: optionalText(source.nodeId || source.node_id),
    nodeCode: optionalText(source.nodeCode || source.node_code),
    slotId: optionalText(source.slotId || source.slot_id),
    attachmentId: optionalText(source.attachmentId || source.attachment_id),
    attachmentName: optionalText(source.attachmentName || source.attachment_name),
  };
}

function topologicalWorkflowNodes(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set();
  const output = [];
  const visit = (node) => {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    for (const dependencyId of node.dependsOn || []) visit(byId.get(dependencyId));
    output.push(node);
  };
  nodes.forEach(visit);
  return output;
}

function attachmentType(attachment) {
  const mime = String(attachment?.mime || attachment?.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

function inputSlotRequirementMessage(slot) {
  const count = slot.minCount === slot.maxCount
    ? `${slot.minCount} 个`
    : `${slot.minCount}-${slot.maxCount} 个`;
  return `请提供${count}${slot.semanticName || slotTypeLabel(slot.type)}`;
}

function slotTypeLabel(type) {
  return ({ text: "文字", image: "图片", video: "视频", file: "文件" })[type] || "文件";
}

function deterministicSlotId(seed) {
  return `slot_${shortHash(seed)}`;
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function uniqueStrings(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))];
}

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}
