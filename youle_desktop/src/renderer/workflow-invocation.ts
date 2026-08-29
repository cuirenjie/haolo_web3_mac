import type { MessageAttachment } from "./domain";
import type { WorkflowCanvasNode, WorkflowNodeSlot } from "./workflow-canvas";

type WorkflowInvocationNode = Pick<
  WorkflowCanvasNode,
  "id" | "kind" | "title" | "dependsOn" | "nodeContract"
> & { displayCode?: string | null };

export type WorkflowInvocationSlot = WorkflowNodeSlot & {
  targetNodeIds: string[];
  targetNodeCodes: Array<string | null>;
};

export type WorkflowInvocationContract = {
  version: 1;
  entryNodeIds: string[];
  slots: WorkflowInvocationSlot[];
};

export function workflowInvocationUsesMainText(
  contract: WorkflowInvocationContract | null | undefined,
) {
  if (!contract) return true;
  return contract.slots.filter((slot) => slot.type === "text").length === 1;
}

export function workflowInvocationExecutionPrompt(value: unknown) {
  return String(value || "").trim()
    || "请按当前冻结画布使用已经提供的结构化入口输入完成本次运行。";
}

export function workflowInvocationContractFromMetadata(
  metadata: unknown,
): WorkflowInvocationContract | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const candidate = (metadata as Record<string, unknown>).invocationContract;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const source = candidate as Record<string, unknown>;
  if (source.version !== 1 || !Array.isArray(source.entryNodeIds) || !Array.isArray(source.slots)) {
    return null;
  }
  const entryNodeIds = source.entryNodeIds
    .map((nodeId) => String(nodeId || "").trim())
    .filter(Boolean);
  if (!entryNodeIds.length || source.slots.some((slot) => !isPersistedWorkflowInvocationSlot(slot))) {
    return null;
  }
  return {
    version: 1,
    entryNodeIds: [...new Set(entryNodeIds)],
    slots: source.slots.map((sourceSlot) => {
      const slot = sourceSlot as WorkflowInvocationSlot;
      return {
        ...slot,
        accept: Array.isArray(slot.accept) ? [...slot.accept] : [],
        origin: slot.origin ? { ...slot.origin } : slot.origin,
        targetNodeIds: [...slot.targetNodeIds],
        targetNodeCodes: Array.isArray(slot.targetNodeCodes)
          ? [...slot.targetNodeCodes]
          : slot.targetNodeIds.map(() => null),
      };
    }),
  };
}

function isPersistedWorkflowInvocationSlot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const slot = value as Record<string, unknown>;
  return (
    typeof slot.slotId === "string"
    && ["text", "image", "video", "file"].includes(String(slot.type || ""))
    && typeof slot.semanticName === "string"
    && Number.isFinite(slot.minCount)
    && Number.isFinite(slot.maxCount)
    && Array.isArray(slot.targetNodeIds)
    && slot.targetNodeIds.every((nodeId) => typeof nodeId === "string" && nodeId.trim())
  );
}

export type WorkflowInvocationPreparation = {
  valid: boolean;
  message: string | null;
  values: Record<string, unknown[]>;
  usedAttachmentIds: string[];
  extraAttachmentIds: string[];
};

export type WorkflowInvocationTopologyValidation = {
  valid: boolean;
  message: string | null;
  entryNodeIds: string[];
  scopeNodeIds: string[];
  sinkNodeIds: string[];
};

type WorkflowInvocationSlotCandidate = {
  slot: WorkflowNodeSlot;
  nodeId: string;
  nodeCode: string | null;
  typeOrdinal: number;
};

export function buildWorkflowInvocationContract(
  nodes: WorkflowInvocationNode[],
  requestedEntryNodeIds: string[],
): WorkflowInvocationContract {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const entryNodeIds = [...new Set(requestedEntryNodeIds.filter((nodeId) => byId.has(nodeId)))];
  const candidates: WorkflowInvocationSlotCandidate[] = [];
  const slots: WorkflowInvocationSlot[] = [];
  const sharedSlots = new Map<string, WorkflowInvocationSlot>();

  for (const nodeId of entryNodeIds) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const typeOrdinals = new Map<WorkflowNodeSlot["type"], number>();
    for (const sourceSlot of node.nodeContract?.inputContract?.slots || []) {
      if (!isRuntimeWorkflowInputSlot(sourceSlot)) continue;
      const slot = normalizeInvocationSlot(sourceSlot, nodeId);
      const typeOrdinal = typeOrdinals.get(slot.type) || 0;
      typeOrdinals.set(slot.type, typeOrdinal + 1);
      candidates.push({
        slot,
        nodeId,
        nodeCode: node.displayCode || null,
        typeOrdinal,
      });
    }
  }

  for (const candidate of candidates) {
    const { slot, nodeId, nodeCode } = candidate;
    const lookupKey = workflowInvocationSharedLookupKey(candidate, candidates);
    const existing = sharedSlots.get(lookupKey);
    if (existing) {
      if (!existing.targetNodeIds.includes(nodeId)) {
        existing.targetNodeIds.push(nodeId);
        existing.targetNodeCodes.push(nodeCode);
      }
      sharedSlots.set(slot.slotId, existing);
      continue;
    }
      const invocationSlot: WorkflowInvocationSlot = {
        ...slot,
        targetNodeIds: [nodeId],
        targetNodeCodes: [nodeCode],
      };
      slots.push(invocationSlot);
      sharedSlots.set(lookupKey, invocationSlot);
      sharedSlots.set(slot.slotId, invocationSlot);
  }

  return { version: 1, entryNodeIds, slots };
}

function workflowInvocationSharedLookupKey(
  candidate: WorkflowInvocationSlotCandidate,
  candidates: WorkflowInvocationSlotCandidate[],
) {
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

function workflowInvocationDefaultSharedLookupKey(candidate: WorkflowInvocationSlotCandidate) {
  const { slot, typeOrdinal } = candidate;
  const accept = [...new Set((slot.accept || [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean))]
    .sort()
    .join(",");
  return `default:${slot.type}:${typeOrdinal}:${slot.minCount}:${slot.maxCount}:${accept}`;
}

function workflowInvocationSlotsCanShare(
  left: WorkflowNodeSlot,
  right: WorkflowNodeSlot,
) {
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

export function validateWorkflowInvocationTopology(
  nodes: WorkflowInvocationNode[],
  requestedEntryNodeIds: string[],
): WorkflowInvocationTopologyValidation {
  const executableNodes = nodes.filter((node) => node.kind !== "root" && node.kind !== "context");
  const byId = new Map(executableNodes.map((node) => [node.id, node]));
  const entryNodeIds = [...new Set(requestedEntryNodeIds.filter((nodeId) => byId.has(nodeId)))];
  if (!entryNodeIds.length) {
    return {
      valid: false,
      message: "请先将输入框连接到至少一个可执行节点。",
      entryNodeIds,
      scopeNodeIds: [],
      sinkNodeIds: [],
    };
  }

  const outgoing = new Map(executableNodes.map((node) => [node.id, [] as string[]]));
  for (const node of executableNodes) {
    for (const sourceNodeId of node.dependsOn || []) {
      outgoing.get(sourceNodeId)?.push(node.id);
    }
  }
  const scope = new Set<string>();
  const queue = [...entryNodeIds];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || scope.has(nodeId)) continue;
    scope.add(nodeId);
    queue.push(...(outgoing.get(nodeId) || []));
  }

  const entrySet = new Set(entryNodeIds);
  for (const nodeId of scope) {
    if (entrySet.has(nodeId)) continue;
    const node = byId.get(nodeId);
    const missingSourceId = (node?.dependsOn || []).find((sourceNodeId) => (
      byId.has(sourceNodeId) && !scope.has(sourceNodeId)
    ));
    if (missingSourceId) {
      const sourceNode = byId.get(missingSourceId);
      return {
        valid: false,
        message: `当前运行链路缺少节点 ${sourceNode?.displayCode || sourceNode?.title || missingSourceId} 的输出`,
        entryNodeIds,
        scopeNodeIds: [...scope],
        sinkNodeIds: [],
      };
    }
  }

  const sinkNodeIds = [...scope].filter((nodeId) => (
    !(outgoing.get(nodeId) || []).some((targetNodeId) => scope.has(targetNodeId))
  ));
  if (sinkNodeIds.length !== 1) {
    return {
      valid: false,
      message: "运行链路只能输出一个结果",
      entryNodeIds,
      scopeNodeIds: [...scope],
      sinkNodeIds,
    };
  }
  return {
    valid: true,
    message: null,
    entryNodeIds,
    scopeNodeIds: [...scope],
    sinkNodeIds,
  };
}

export function prepareWorkflowInvocationValues(params: {
  contract: WorkflowInvocationContract;
  mainText?: string;
  namedTextValues?: Record<string, string>;
  attachments?: MessageAttachment[];
}): WorkflowInvocationPreparation {
  const slots = params.contract.slots || [];
  const textSlots = slots.filter((slot) => slot.type === "text");
  const mediaSlots = slots.filter((slot) => slot.type !== "text");
  const namedTextValues = params.namedTextValues || {};
  const attachments = params.attachments || [];
  const values: Record<string, unknown[]> = {};

  for (const slot of textSlots) {
    const source = textSlots.length === 1
      ? String(params.mainText ?? namedTextValues[slot.slotId] ?? "").trim()
      : String(namedTextValues[slot.slotId] || "").trim();
    values[slot.slotId] = source ? [source] : [];
  }

  const unused = attachments.map((attachment, index) => ({ attachment, index }));
  const usedAttachmentIds: string[] = [];
  for (const slot of mediaSlots) {
    const assigned: MessageAttachment[] = [];
    while (assigned.length < slot.maxCount) {
      const candidateIndex = unused.findIndex(({ attachment }) => attachmentMatchesWorkflowSlot(attachment, slot));
      if (candidateIndex < 0) break;
      const [{ attachment }] = unused.splice(candidateIndex, 1);
      assigned.push(attachment);
      const attachmentId = String(attachment.id || attachment.object_key || attachment.name || "").trim();
      if (attachmentId) usedAttachmentIds.push(attachmentId);
    }
    values[slot.slotId] = assigned;
  }

  const invalidSlots = slots.filter((slot) => {
    const count = values[slot.slotId]?.length || 0;
    return count < slot.minCount || count > slot.maxCount;
  });
  const extraAttachmentIds = unused.map(({ attachment, index }) => (
    String(attachment.id || attachment.object_key || attachment.name || `attachment-${index + 1}`)
  ));
  const valid = invalidSlots.length === 0 && extraAttachmentIds.length === 0;
  return {
    valid,
    message: valid
      ? null
      : invalidSlots.length
        ? workflowInvocationRequirementMessage(slots)
        : "上传了当前运行入口未声明的额外输入。",
    values,
    usedAttachmentIds,
    extraAttachmentIds,
  };
}

export function workflowInvocationRequirementMessage(slots: WorkflowInvocationSlot[]) {
  const required = slots.filter((slot) => slot.minCount > 0);
  if (!required.length) return "请填写当前运行所需的输入。";
  return `请提供${joinChineseList(required.map(workflowSlotRequirementText))}`;
}

export function workflowSlotRequirementText(slot: WorkflowInvocationSlot) {
  const name = String(slot.semanticName || slotTypeLabel(slot.type)).trim();
  if (slot.minCount === 1 && slot.maxCount === 1) return `1 个${name}`;
  if (slot.minCount === slot.maxCount) return `${slot.minCount} 个${name}`;
  return `${slot.minCount}-${slot.maxCount} 个${name}`;
}

export function attachmentMatchesWorkflowSlot(
  attachment: MessageAttachment,
  slot: WorkflowNodeSlot,
) {
  const mime = String(attachment.mime || "").trim().toLowerCase();
  const name = String(attachment.name || "").trim().toLowerCase();
  const type = workflowAttachmentType(attachment);
  if (type !== slot.type) return false;
  const accept = (slot.accept || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  if (!accept.length) return true;
  return accept.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return mime.startsWith(rule.slice(0, -1));
    return mime === rule;
  });
}

export function workflowAttachmentType(
  attachment: Pick<MessageAttachment, "mime" | "name">,
): "image" | "video" | "file" {
  const mime = String(attachment.mime || "").trim().toLowerCase();
  const name = String(attachment.name || "").trim().toLowerCase();
  if (mime.startsWith("image/") || [".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"].some((extension) => name.endsWith(extension))) {
    return "image";
  }
  if (mime.startsWith("video/") || [".m4v", ".mkv", ".mov", ".mp4", ".webm"].some((extension) => name.endsWith(extension))) {
    return "video";
  }
  return "file";
}

function isRuntimeWorkflowInputSlot(slot: WorkflowNodeSlot) {
  const origin = String(slot.origin?.kind || "workflow_input");
  return origin !== "fixed_attachment" && origin !== "upstream";
}

function normalizeInvocationSlot(slot: WorkflowNodeSlot, nodeId: string): WorkflowNodeSlot {
  const minCount = Math.max(0, Math.floor(Number(slot.minCount) || 0));
  const maxCount = Math.max(minCount, Math.floor(Number(slot.maxCount) || minCount || 1));
  return {
    ...slot,
    slotId: String(slot.slotId || `${nodeId}-input`).trim(),
    semanticName: String(slot.semanticName || slotTypeLabel(slot.type)).trim(),
    minCount,
    maxCount,
    required: minCount > 0,
    accept: [...new Set((slot.accept || []).map((value) => String(value || "").trim()).filter(Boolean))],
  };
}

function slotTypeLabel(type: WorkflowNodeSlot["type"]) {
  return ({ text: "文字", image: "图片", video: "视频", file: "文件" })[type] || "文件";
}

function joinChineseList(values: string[]) {
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]}和${values[1]}`;
  return `${values.slice(0, -1).join("、")}和${values.at(-1)}`;
}
