export type WorkflowNodeStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
export type WorkflowRunStatus = "planning" | "running" | "accepting" | "succeeded" | "failed" | "cancelled";

export type WorkflowExecutionError = {
  code?: string;
  message?: string;
  retryable?: boolean;
  category?: string | null;
  status?: number | null;
  retryAfterMs?: number | null;
  requestId?: string | null;
  upstreamStatus?: number | null;
  routeExhausted?: boolean;
};

export type WorkflowExecutionResult = {
  status?: "succeeded" | "failed";
  output?: {
    text?: string;
    summary?: string;
    data?: unknown;
    artifacts?: Array<{
      type?: string;
      uri?: string | null;
      path?: string | null;
      url?: string | null;
      name?: string | null;
      mime?: string | null;
      mediaType?: string | null;
      resourceId?: string | null;
      slotId?: string | null;
      sourceNodeId?: string | null;
      sourceSlotId?: string | null;
      passThrough?: boolean;
      generated?: boolean;
    }>;
  };
  evidence?: unknown[];
  effects?: Array<{
    id?: string;
    type?: string;
    status?: string;
    summary?: string;
    command?: string | null;
    exitCode?: number | null;
    paths?: string[];
    completedAt?: string;
  }>;
  confidence?: number | null;
  diagnostics?: {
    provider?: string | null;
    model?: string | null;
    executorType?: string | null;
    taskId?: string | null;
    capabilityGrantId?: string | null;
    durationMs?: number | null;
    attempts?: number | null;
  };
  error?: WorkflowExecutionError | null;
};

export type WorkflowContextManifestItem = {
  id?: string | null;
  path?: string | null;
  relativePath?: string | null;
  mime?: string | null;
  size?: number;
  modifiedAt?: string | null;
  sha256?: string | null;
  usedByNodeIds?: string[];
};

export type WorkflowContextPackageSummary = {
  id?: string;
  nodeId?: string | null;
  root?: string | null;
  selectionPolicy?: string;
  manifest?: WorkflowContextManifestItem[];
  totalChars?: number;
  error?: { code?: string; message?: string } | null;
};

export type WorkflowInputBinding = {
  sourceNodeId: string;
  required?: boolean;
  acceptedStatuses?: WorkflowNodeStatus[];
  outputPath?: string | null;
};

export type WorkflowJoinPolicy = {
  mode?: "all_required" | string;
};

export type WorkflowOutputContract = {
  format?: "auto" | "text" | "structured_data" | "artifact" | "mixed" | string;
  requirements?: string[];
  requiredArtifactTypes?: string[];
};

export type WorkflowNodeSlot = {
  slotId: string;
  type: "text" | "image" | "video" | "file";
  semanticName: string;
  minCount: number;
  maxCount: number;
  required?: boolean;
  accept?: string[];
  sharedResourceKey?: string | null;
  distinctResourceKey?: string | null;
  passThroughFromSlotId?: string | null;
  origin?: {
    kind?: "workflow_input" | "upstream" | "fixed_attachment" | "generated" | string;
    nodeId?: string | null;
    nodeCode?: string | null;
    slotId?: string | null;
    attachmentId?: string | null;
    attachmentName?: string | null;
  };
};

export type WorkflowNodeContract = {
  version?: number;
  compiled?: boolean;
  compiledAt?: string | null;
  compiler?: string | null;
  inputContract?: { mode?: "declared" | "derived"; slots?: WorkflowNodeSlot[] };
  taskDefinition?: { text?: string };
  outputContract?: { slots?: WorkflowNodeSlot[] };
};

export type WorkflowSkillBinding = {
  id?: string;
  name?: string;
  version?: string | null;
  required?: boolean;
};

export type WorkflowValidationPolicy = {
  semanticReview?: "automatic" | "root_required" | "none" | string;
  minimumConfidence?: number | null;
  requireEvidence?: boolean;
};

export type WorkflowContextSelection = {
  protocolVersion?: number;
  needsLocalFiles?: boolean;
  scope?: string[];
  selectedUploadIds?: string[];
  searchHints?: string[];
  requiredEvidence?: string[];
  rationale?: string;
  source?: string;
};

export type WorkflowCanvasNode = {
  id: string;
  displayCode?: string;
  kind: "root" | "context" | "model" | "tool" | "agent" | string;
  title: string;
  statusLabel?: string;
  purpose?: string;
  provider?: string | null;
  model?: string | null;
  executorType?: "external_model" | "codex_subagent" | string | null;
  prompt?: string;
  dependsOn?: string[];
  inputBindings?: WorkflowInputBinding[];
  joinPolicy?: WorkflowJoinPolicy | null;
  outputContract?: WorkflowOutputContract | null;
  nodeContract?: WorkflowNodeContract | null;
  skillBindings?: WorkflowSkillBinding[];
  validationPolicy?: WorkflowValidationPolicy | null;
  acceptance?: string[];
  contextSelection?: WorkflowContextSelection | null;
  workflowRef?: {
    specId: string;
    version: number;
    graphHash: string;
  } | null;
  attachmentRefs?: Array<Record<string, unknown>>;
  status: WorkflowNodeStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  result?: WorkflowExecutionResult | null;
  risk?: string;
  attempt?: number;
  maxAttempts?: number;
  retrying?: boolean;
  lastRetryError?: WorkflowExecutionError | null;
  executorCandidates?: Array<{ provider?: string | null; model?: string | null; executorType?: string | null }>;
  executorChoice?: number;
  maxExecutorChoices?: number;
  totalAttempts?: number;
  executorHistory?: Array<{
    executorChoice?: number;
    executorType?: string | null;
    provider?: string | null;
    model?: string | null;
    status?: "succeeded" | "failed";
    attempts?: number;
    error?: WorkflowExecutionError | null;
    completedAt?: string | null;
  }>;
  displaySourceNodeId?: string;
  displayExecutorChoice?: number;
  coordination?: {
    mode?: "solo" | "parallel_candidate" | "review_gate" | string;
    parallelGroup?: string | null;
    reviewTargets?: string[];
  };
  blockedByReviewGate?: boolean;
  parallelTimeoutExhausted?: boolean;
  capabilityManifest?: {
    protocolVersion?: number;
    capabilities?: Array<{ id?: string; mode?: string }>;
  } | null;
  capabilityRequest?: {
    permissionProfile?: string;
    capabilities?: string[];
    resourceScope?: {
      workspace?: string;
      paths?: string[];
      uploads?: string[];
      network?: string[];
      applications?: string[];
    };
    actions?: string[];
    sideEffectPolicy?: string;
    delegation?: boolean;
    rationale?: string;
  } | null;
  capabilityGrant?: {
    id?: string;
    issuedBy?: string;
    workflowId?: string;
    nodeId?: string;
    taskId?: string;
    executorType?: string;
    permissionProfile?: string;
    capabilities?: string[];
    resources?: {
      workspaceRoot?: string | null;
      paths?: string[];
      uploadIds?: string[];
      network?: string[];
      applications?: string[];
      allowImplicitGlobalContext?: boolean;
    };
    actions?: string[];
    sideEffectPolicy?: string;
    delegation?: { allowed?: boolean; maxDepth?: number };
    rationale?: string;
    lease?: { issuedAt?: string; expiresAt?: string };
  } | null;
  localFileReview?: {
    capability?: string;
    status?: "available" | "preparing" | "granted" | "not_used" | "failed" | string;
    reason?: string | null;
    contextPackageId?: string | null;
    grant?: {
      id?: string;
      issuedBy?: string;
      access?: string;
      operations?: string[];
      delegation?: boolean;
      scope?: {
        workflowId?: string | null;
        nodeId?: string;
        root?: string;
        explicitPaths?: string[];
        contextPackageId?: string | null;
      };
    } | null;
    error?: { code?: string; message?: string } | null;
  } | null;
  contextPackage?: WorkflowContextPackageSummary | null;
  childWorkflow?: {
    id?: string;
    parentNodeId?: string;
    status?: string;
    startedAt?: string;
    completedAt?: string;
    steps?: Array<{
      id?: string;
      stage?: string;
      title?: string;
      detail?: string;
      status?: string;
      effect?: unknown;
      updatedAt?: string;
    }>;
  } | null;
};

export type WorkflowCanvasRun = {
  id: string;
  threadId: string;
  mode?: string;
  status: WorkflowRunStatus;
  sequence?: number;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  planCommittedAt?: string | null;
  completedAt?: string | null;
  prompt?: string;
  rationale?: string;
  goalContract?: {
    deliverable?: string;
    successCriteria?: string[];
    constraints?: string[];
    prohibitions?: string[];
  };
  complexityAssessment?: {
    level?: "simple" | "standard" | "complex" | string;
    score?: number;
    rationale?: string;
    factors?: string[];
    strategy?: "serial" | "parallel_review" | string;
    parallelReviewGroupCount?: number;
    maxParallelModels?: number;
  };
  contextPackage?: WorkflowContextPackageSummary | null;
  contextPackages?: Record<string, WorkflowContextPackageSummary>;
  finalTurnId?: string | null;
  finalResult?: WorkflowExecutionResult | null;
  metadata?: {
    attachments?: Array<{
      id?: string;
      name?: string;
      mime?: string | null;
      size?: number | null;
      local_path?: string | null;
      path?: string | null;
      url?: string | null;
      object_key?: string | null;
      material_id?: string | null;
      kind?: string;
      delivery?: string;
    }>;
    uploadManifest?: Array<{
      id?: string;
      name?: string;
      mime?: string | null;
      kind?: string;
      delivery?: string;
      path?: string | null;
    }>;
    [key: string]: unknown;
  };
  nodes: WorkflowCanvasNode[];
  error?: { code?: string; message?: string } | null;
};

export type WorkflowNodeDialogSkill = {
  id: string;
  label: string;
  description?: string;
};

export type WorkflowNodeDialogFavorite = {
  id: string;
  content: string;
};

export type WorkflowNodeDialogAttachment = {
  id: string;
  name: string;
  mime?: string | null;
  size?: number | null;
  iconUrl?: string | null;
  closeIconUrl?: string | null;
  previewUrl?: string | null;
  uploadStatus?: "uploading" | "uploaded" | "error";
  uploadError?: string | null;
};

export type WorkflowNodeExecutorOption = {
  executorType?: string | null;
  provider?: string | null;
  model?: string | null;
  label?: string | null;
  groupLabel?: string | null;
  priceLabel?: string | null;
};

export type WorkflowNodeDialogOptions = {
  editable?: boolean;
  sourceNodeId?: string | null;
  availableExecutors?: WorkflowNodeExecutorOption[];
  availableSkills?: WorkflowNodeDialogSkill[];
  favoritePrompts?: WorkflowNodeDialogFavorite[];
  attachments?: WorkflowNodeDialogAttachment[];
  dirty?: boolean;
  newNode?: boolean;
  saving?: boolean;
  suppressEntranceAnimation?: boolean;
};

export type WorkflowCanvasInsertTarget =
  | {
      placement: "parallel";
      layer: number;
      anchorNodeId?: string;
      anchorDisplayNodeId?: string;
      side?: "left" | "right";
    }
  | {
      placement: "between";
      previousLayer: number | null;
      nextLayer: number | null;
    };

export type WorkflowCanvasLayer = {
  layer: number;
  sourceNodeIds: string[];
};

export type WorkflowCanvasPoint = {
  x: number;
  y: number;
};

export type WorkflowCanvasObstacleRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const WORKFLOW_CANVAS_MIN_ZOOM = 0.5;
export const WORKFLOW_CANVAS_MAX_ZOOM = 2;

export function normalizeWorkflowCanvasZoom(value: number) {
  const finiteValue = Number.isFinite(value) ? value : 1;
  return Math.round(
    Math.min(
      WORKFLOW_CANVAS_MAX_ZOOM,
      Math.max(WORKFLOW_CANVAS_MIN_ZOOM, finiteValue),
    ) * 1_000,
  ) / 1_000;
}

export function workflowCanvasZoomFromWheel(
  currentZoom: number,
  deltaY: number,
  deltaMode = 0,
  pageSize = 800,
) {
  const normalizedCurrentZoom = normalizeWorkflowCanvasZoom(currentZoom);
  if (!Number.isFinite(deltaY) || deltaY === 0) return normalizedCurrentZoom;
  const deltaInPixels = deltaY * (
    deltaMode === 1
      ? 16
      : deltaMode === 2
        ? Math.max(1, pageSize)
        : 1
  );
  return normalizeWorkflowCanvasZoom(
    normalizedCurrentZoom * Math.exp(-deltaInPixels * 0.0015),
  );
}

export function workflowCanvasComposerBranchRoute({
  entry,
  target,
  wallTop,
  canvasWidth,
  obstacles,
}: {
  entry: WorkflowCanvasPoint;
  target: WorkflowCanvasPoint;
  wallTop: number;
  canvasWidth: number;
  obstacles: WorkflowCanvasObstacleRect[];
}) {
  const approachGap = 12;
  const obstacleGap = 14;
  const wallInset = 8;
  const laneInset = 24;
  const entryCornerRadius = 8;
  const wallCornerRadius = 14;
  const busStartX = wallInset + wallCornerRadius;
  const directPath = [
    `M ${entry.x} ${entry.y}`,
    `L ${wallInset - entryCornerRadius} ${entry.y}`,
    `Q ${wallInset} ${entry.y}, ${wallInset} ${entry.y - entryCornerRadius}`,
    `L ${wallInset} ${wallTop + wallCornerRadius}`,
    `Q ${wallInset} ${wallTop}, ${busStartX} ${wallTop}`,
    `L ${target.x} ${wallTop}`,
    `C ${target.x} ${wallTop + 8}, ${target.x} ${target.y - 10}, ${target.x} ${target.y}`,
  ].join(" ");
  const relevantObstacles = obstacles.filter((obstacle) => (
    obstacle.top < target.y - approachGap
    && obstacle.bottom > wallTop
  ));
  const directPathBlocked = relevantObstacles.some((obstacle) => (
    target.x > obstacle.left - obstacleGap
    && target.x < obstacle.right + obstacleGap
  ));
  if (!directPathBlocked) {
    return {
      path: directPath,
      routed: false,
      laneX: null,
      deletePoint: {
        x: target.x,
        y: (wallTop + target.y) / 2,
      },
    };
  }

  const minObstacleLeft = Math.min(...relevantObstacles.map((obstacle) => obstacle.left));
  const maxObstacleRight = Math.max(...relevantObstacles.map((obstacle) => obstacle.right));
  const laneCandidates = [
    minObstacleLeft - obstacleGap,
    maxObstacleRight + obstacleGap,
    laneInset,
    canvasWidth - laneInset,
  ]
    .filter((candidate) => (
      candidate >= laneInset
      && candidate <= canvasWidth - laneInset
      && relevantObstacles.every((obstacle) => (
        candidate <= obstacle.left - obstacleGap
        || candidate >= obstacle.right + obstacleGap
      ))
    ))
    .sort((left, right) => (
      Math.abs(left - entry.x) - Math.abs(right - entry.x)
      || left - right
    ));
  const laneX = laneCandidates[0];
  if (!Number.isFinite(laneX)) {
    return {
      path: directPath,
      routed: false,
      laneX: null,
      deletePoint: {
        x: target.x,
        y: (wallTop + target.y) / 2,
      },
    };
  }

  const approachY = Math.max(wallTop + 18, target.y - approachGap);
  const laneDirection = Math.sign(laneX - entry.x) || 1;
  const verticalDirection = Math.sign(approachY - entry.y) || -1;
  const targetDirection = Math.sign(target.x - laneX) || 1;
  const entryRadius = Math.min(8, Math.abs(laneX - entry.x) / 2);
  const approachRadius = Math.min(10, Math.abs(target.x - laneX) / 2);
  return {
    path: [
      `M ${entry.x} ${entry.y}`,
      `L ${laneX - laneDirection * entryRadius} ${entry.y}`,
      `Q ${laneX} ${entry.y}, ${laneX} ${entry.y + verticalDirection * entryRadius}`,
      `L ${laneX} ${approachY - verticalDirection * approachRadius}`,
      `Q ${laneX} ${approachY}, ${laneX + targetDirection * approachRadius} ${approachY}`,
      `L ${target.x - targetDirection * approachRadius} ${approachY}`,
      `Q ${target.x} ${approachY}, ${target.x} ${target.y}`,
    ].join(" "),
    routed: true,
    laneX,
    deletePoint: {
      x: laneX,
      y: (entry.y + approachY) / 2,
    },
  };
}

export function workflowCanvasNextDraftNodeTitle(
  existingTitles: string[],
  baseTitle: string,
) {
  const normalizedBaseTitle = baseTitle.trim();
  let highestSequence = 0;
  for (const rawTitle of existingTitles) {
    const title = String(rawTitle || "").trim();
    if (title === normalizedBaseTitle) {
      highestSequence = Math.max(highestSequence, 1);
      continue;
    }
    if (!title.startsWith(`${normalizedBaseTitle} `)) continue;
    const sequenceText = title.slice(normalizedBaseTitle.length + 1);
    if (!/^\d+$/.test(sequenceText)) continue;
    const sequence = Number(sequenceText);
    if (Number.isInteger(sequence) && sequence >= 2) {
      highestSequence = Math.max(highestSequence, sequence);
    }
  }
  return highestSequence > 0
    ? `${normalizedBaseTitle} ${highestSequence + 1}`
    : normalizedBaseTitle;
}

export type WorkflowCanvasEdgeLayout = {
  sourceId: string;
  targetId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceTitle: string;
  targetTitle: string;
  path: string;
  deleteX: number;
  deleteY: number;
  status: string;
};

export type WorkflowCanvasLayoutSnapshot = {
  width: number;
  height: number;
  edges: WorkflowCanvasEdgeLayout[];
  entryNodeIds: string[];
  nodePositions: Record<string, {
    x: number;
    y: number;
    layer: number;
  }>;
};

export type WorkflowNodeLogoKey =
  | "haolo"
  | "codex"
  | "claude"
  | "kimi"
  | "deepseek"
  | "gemini"
  | "grok"
  | "mimo"
  | "perplexity"
  | "doubao"
  | "qwen";

export type WorkflowNodeLogoUrls = Record<WorkflowNodeLogoKey, string>;

type LayoutNode = WorkflowCanvasNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  displayDependsOn: string[];
};

const NODE_WIDTH = 198;
const NODE_HEIGHT = 116.16;
const LAYER_GAP = 58 * (2 / 3);
const COLUMN_GAP = 28 * (2 / 3);
const CANVAS_HORIZONTAL_PADDING = 70;
const CANVAS_VERTICAL_PADDING = 50;
const EXECUTOR_DISPLAY_NODE_SEPARATOR = "::executor:";
const TERMINAL_WORKFLOW_RUN_STATUSES = new Set<WorkflowRunStatus>(["succeeded", "failed", "cancelled"]);

export function workflowCanvasGridRowXPositions(
  canvasWidth: number,
  nodeCount: number,
) {
  const count = Math.max(0, Math.floor(nodeCount));
  if (!count) return [];
  const rowWidth = count * NODE_WIDTH + Math.max(0, count - 1) * COLUMN_GAP;
  const resolvedCanvasWidth = Math.max(
    Number.isFinite(canvasWidth) ? canvasWidth : 0,
    workflowCanvasGridMinimumWidth(count),
  );
  const left = Math.max(
    CANVAS_HORIZONTAL_PADDING,
    (resolvedCanvasWidth - rowWidth) / 2,
  );
  return Array.from(
    { length: count },
    (_, index) => {
      const coordinate = left + index * (NODE_WIDTH + COLUMN_GAP);
      const nearestInteger = Math.round(coordinate);
      return Math.abs(coordinate - nearestInteger) < 0.000000001
        ? nearestInteger
        : coordinate;
    },
  );
}

export function workflowCanvasGridMinimumWidth(nodeCount: number) {
  const count = Math.max(1, Math.floor(nodeCount));
  return (
    count * NODE_WIDTH
    + Math.max(0, count - 1) * COLUMN_GAP
    + CANVAS_HORIZONTAL_PADDING * 2
  );
}

export function workflowCanvasGridLayerY(layer: number) {
  return CANVAS_VERTICAL_PADDING
    + Math.max(0, Math.floor(layer)) * (NODE_HEIGHT + LAYER_GAP);
}

export function isWorkflowSystemNode(node: WorkflowCanvasNode) {
  return node.kind === "root" || node.kind === "context";
}

export function isTerminalWorkflowRun(run: WorkflowCanvasRun) {
  return TERMINAL_WORKFLOW_RUN_STATUSES.has(run.status);
}

export function workflowCanvasPresentationNodes(run: WorkflowCanvasRun): WorkflowCanvasNode[] {
  const nodes = run.nodes || [];
  if (!isTerminalWorkflowRun(run)) return nodes;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visibleNodes = nodes.filter((node) => !isWorkflowSystemNode(node));
  if (visibleNodes.length === nodes.length) return nodes;

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const resolveVisibleDependencies = (
    dependencyIds: string[],
    visited = new Set<string>(),
  ): string[] => dependencyIds.flatMap((dependencyId) => {
    if (visibleIds.has(dependencyId)) return [dependencyId];
    if (visited.has(dependencyId)) return [];
    const dependency = nodeById.get(dependencyId);
    if (!dependency || !isWorkflowSystemNode(dependency)) return [];
    const nextVisited = new Set(visited);
    nextVisited.add(dependencyId);
    return resolveVisibleDependencies(dependency.dependsOn || [], nextVisited);
  });

  return visibleNodes.map((node) => ({
    ...node,
    dependsOn: [...new Set(resolveVisibleDependencies(node.dependsOn || []))],
  }));
}

export function workflowCanvasRuntimeEntryNodeIds(
  run: WorkflowCanvasRun,
): string[] | null {
  if (!isTerminalWorkflowRun(run)) {
    const firstSystemNode = (run.nodes || []).find((node) => (
      node.id === "root-plan" && isWorkflowSystemNode(node)
    )) || (run.nodes || []).find(isWorkflowSystemNode);
    if (firstSystemNode) return [firstSystemNode.id];
  }

  const metadata = run.metadata || {};
  const contract = metadata.invocationContract;
  const invocation = metadata.workflowInvocation;
  const rawEntryNodeIds = contract && typeof contract === "object" && !Array.isArray(contract)
    && Array.isArray((contract as Record<string, unknown>).entryNodeIds)
    ? (contract as Record<string, unknown>).entryNodeIds as unknown[]
    : invocation && typeof invocation === "object" && !Array.isArray(invocation)
      && Array.isArray((invocation as Record<string, unknown>).entryNodeIds)
      ? (invocation as Record<string, unknown>).entryNodeIds as unknown[]
      : null;
  if (!rawEntryNodeIds) return null;

  const sourceNodeIds = new Set(
    (run.nodes || []).filter((node) => !isWorkflowSystemNode(node)).map((node) => node.id),
  );
  const displayNodes = workflowCanvasDisplayNodes(workflowCanvasPresentationNodes(run));
  const displayNodeIds = new Set(displayNodes.map((node) => node.id));
  const activeDisplayIdBySourceId = new Map<string, string>();
  for (const node of displayNodes) {
    activeDisplayIdBySourceId.set(node.displaySourceNodeId || node.id, node.id);
  }
  return [...new Set(rawEntryNodeIds
    .map((nodeId) => String(nodeId || "").trim())
    .filter(Boolean)
    .map((nodeId) => sourceNodeIds.has(nodeId)
      ? activeDisplayIdBySourceId.get(nodeId) || nodeId
      : displayNodeIds.has(nodeId) ? nodeId : "")
    .filter(Boolean))];
}

export function workflowCanvasEditableLayers(
  run: WorkflowCanvasRun,
  layoutSnapshot: WorkflowCanvasLayoutSnapshot | null = null,
): WorkflowCanvasLayer[] {
  const sourceIdsByLayer = new Map<number, string[]>();
  const layout = layoutWorkflowGraph(workflowCanvasPresentationNodes(run));
  const orderedLayout = [...layout].sort((left, right) => {
    const leftPosition = layoutSnapshot?.nodePositions[left.id];
    const rightPosition = layoutSnapshot?.nodePositions[right.id];
    const leftLayer = leftPosition?.layer ?? left.layer;
    const rightLayer = rightPosition?.layer ?? right.layer;
    return leftLayer - rightLayer
      || (leftPosition?.x ?? left.x) - (rightPosition?.x ?? right.x);
  });
  for (const node of orderedLayout) {
    const layer = layoutSnapshot?.nodePositions[node.id]?.layer ?? node.layer;
    const sourceNodeId = node.displaySourceNodeId || node.id;
    const sourceNodeIds = sourceIdsByLayer.get(layer) || [];
    if (!sourceNodeIds.includes(sourceNodeId)) sourceNodeIds.push(sourceNodeId);
    sourceIdsByLayer.set(layer, sourceNodeIds);
  }
  return [...sourceIdsByLayer.entries()]
    .sort(([left], [right]) => left - right)
    .map(([layer, sourceNodeIds]) => ({ layer, sourceNodeIds }));
}

export function insertWorkflowCanvasNode(
  run: WorkflowCanvasRun,
  insertedNode: WorkflowCanvasNode,
  target: WorkflowCanvasInsertTarget,
  layoutSnapshot: WorkflowCanvasLayoutSnapshot | null = null,
): WorkflowCanvasRun {
  const layers = workflowCanvasEditableLayers(run, layoutSnapshot);
  const clonedNodes = run.nodes.map(cloneWorkflowCanvasNodeForRevision);
  const rawNodeById = new Map(clonedNodes.map((node) => [node.id, node]));
  const layerByNumber = new Map(layers.map((layer) => [layer.layer, layer]));
  const insertedNodeId = insertedNode.id;
  let nextNodes = clonedNodes;
  let preparedNode = cloneWorkflowCanvasNodeForRevision(insertedNode);
  let insertionIndex = clonedNodes.length;

  if (target.placement === "parallel") {
    const rowSourceIds = layerByNumber.get(target.layer)?.sourceNodeIds || [];
    const rowSourceIdSet = new Set(rowSourceIds);
    const upstreamIds = uniqueWorkflowNodeIds(rowSourceIds.flatMap((nodeId) => (
      rawNodeById.get(nodeId)?.dependsOn || []
    )));
    preparedNode = workflowNodeWithDependencies(preparedNode, upstreamIds);
    const rowIndexes = rowSourceIds
      .map((nodeId) => clonedNodes.findIndex((node) => node.id === nodeId))
      .filter((index) => index >= 0);
    const anchorRowIndex = target.anchorNodeId
      ? rowSourceIds.indexOf(target.anchorNodeId)
      : -1;
    const requestedRowIndex = anchorRowIndex >= 0 && target.side
      ? anchorRowIndex + (target.side === "right" ? 1 : 0)
      : rowSourceIds.length;
    const nextRowNodeId = rowSourceIds[requestedRowIndex];
    const nextRowNodeIndex = nextRowNodeId
      ? clonedNodes.findIndex((node) => node.id === nextRowNodeId)
      : -1;
    insertionIndex = nextRowNodeIndex >= 0
      ? nextRowNodeIndex
      : rowIndexes.length
        ? Math.max(...rowIndexes) + 1
        : clonedNodes.length;
    nextNodes = clonedNodes.map((node) => {
      if (!(node.dependsOn || []).some((dependencyId) => rowSourceIdSet.has(dependencyId))) {
        return node;
      }
      const nextDependencies = uniqueWorkflowNodeIds([...(node.dependsOn || []), insertedNodeId]);
      return workflowNodeWithReviewTargets(
        workflowNodeWithDependencies(node, nextDependencies),
        uniqueWorkflowNodeIds([...(node.coordination?.reviewTargets || []), insertedNodeId]),
      );
    });
  } else {
    const previousSourceIds = target.previousLayer == null
      ? []
      : layerByNumber.get(target.previousLayer)?.sourceNodeIds || [];
    const nextSourceIds = target.nextLayer == null
      ? []
      : layerByNumber.get(target.nextLayer)?.sourceNodeIds || [];
    const upstreamIds = previousSourceIds.length
      ? previousSourceIds
      : uniqueWorkflowNodeIds(nextSourceIds.flatMap((nodeId) => (
          rawNodeById.get(nodeId)?.dependsOn || []
        )));
    preparedNode = workflowNodeWithDependencies(preparedNode, upstreamIds);
    const replacedDependencyIds = new Set(upstreamIds);
    const nextSourceIdSet = new Set(nextSourceIds);
    nextNodes = clonedNodes.map((node) => {
      if (!nextSourceIdSet.has(node.id)) return node;
      const nextDependencies = replaceWorkflowNodeIds(
        node.dependsOn || [],
        replacedDependencyIds,
        insertedNodeId,
      );
      const nextReviewTargets = node.coordination?.reviewTargets?.length
        ? replaceWorkflowNodeIds(
            node.coordination.reviewTargets,
            replacedDependencyIds,
            insertedNodeId,
          )
        : [];
      return workflowNodeWithReviewTargets(
        workflowNodeWithDependencies(node, nextDependencies),
        nextReviewTargets,
      );
    });
    const nextIndexes = nextSourceIds
      .map((nodeId) => clonedNodes.findIndex((node) => node.id === nodeId))
      .filter((index) => index >= 0);
    insertionIndex = nextIndexes.length ? Math.min(...nextIndexes) : clonedNodes.length;
  }

  nextNodes.splice(insertionIndex, 0, preparedNode);
  return { ...run, nodes: nextNodes };
}

export function deleteWorkflowCanvasNode(
  run: WorkflowCanvasRun,
  nodeId: string,
): WorkflowCanvasRun {
  const deletedNode = run.nodes.find((node) => node.id === nodeId);
  if (!deletedNode || isWorkflowSystemNode(deletedNode)) return run;
  const nextNodes = run.nodes
    .filter((node) => node.id !== nodeId)
    .map((sourceNode) => {
      const node = cloneWorkflowCanvasNodeForRevision(sourceNode);
      const hasDeletedDependency = (node.dependsOn || []).includes(nodeId);
      const nextDependencies = hasDeletedDependency
        ? uniqueWorkflowNodeIds((node.dependsOn || []).filter((dependencyId) => (
            dependencyId !== nodeId && dependencyId !== node.id
          )))
        : node.dependsOn || [];
      const nextNode = hasDeletedDependency
        ? workflowNodeWithDependencies(node, nextDependencies)
        : node;
      if (!nextNode.coordination?.reviewTargets?.includes(nodeId)) return nextNode;
      return workflowNodeWithReviewTargets(
        nextNode,
        nextNode.coordination.reviewTargets.filter((reviewTargetId) => (
          reviewTargetId !== nodeId
        )),
      );
    });
  return { ...run, nodes: nextNodes };
}

export function deleteWorkflowCanvasEdge(
  run: WorkflowCanvasRun,
  sourceNodeId: string,
  targetNodeId: string,
): WorkflowCanvasRun {
  const targetNodeIndex = run.nodes.findIndex((node) => node.id === targetNodeId);
  const targetNode = run.nodes[targetNodeIndex];
  if (
    !targetNode
    || isWorkflowSystemNode(targetNode)
    || !(targetNode.dependsOn || []).includes(sourceNodeId)
  ) return run;
  const nextTargetNode = workflowNodeWithReviewTargets(
    workflowNodeWithDependencies(
      cloneWorkflowCanvasNodeForRevision(targetNode),
      (targetNode.dependsOn || []).filter((dependencyId) => dependencyId !== sourceNodeId),
    ),
    (targetNode.coordination?.reviewTargets || []).filter(
      (reviewTargetId) => reviewTargetId !== sourceNodeId,
    ),
  );
  const nextNodes = [...run.nodes];
  nextNodes[targetNodeIndex] = nextTargetNode;
  return {
    ...run,
    nodes: nextNodes,
  };
}

export function connectWorkflowCanvasEdge(
  run: WorkflowCanvasRun,
  sourceNodeId: string,
  targetNodeId: string,
): WorkflowCanvasRun {
  const sourceNode = run.nodes.find((node) => node.id === sourceNodeId);
  const targetNodeIndex = run.nodes.findIndex((node) => node.id === targetNodeId);
  const targetNode = run.nodes[targetNodeIndex];
  if (
    !sourceNode
    || !targetNode
    || sourceNodeId === targetNodeId
    || isWorkflowSystemNode(targetNode)
    || (targetNode.dependsOn || []).includes(sourceNodeId)
    || workflowNodeDependsOn(run, sourceNodeId, targetNodeId)
  ) return run;
  const withDependency = workflowNodeWithDependencies(
    cloneWorkflowCanvasNodeForRevision(targetNode),
    [...(targetNode.dependsOn || []), sourceNodeId],
  );
  const nextTargetNode = targetNode.coordination?.mode === "review_gate"
    ? workflowNodeWithReviewTargets(
        withDependency,
        [...(targetNode.coordination.reviewTargets || []), sourceNodeId],
      )
    : withDependency;
  const nextNodes = [...run.nodes];
  nextNodes[targetNodeIndex] = nextTargetNode;
  return {
    ...run,
    nodes: nextNodes,
  };
}

function workflowNodeDependsOn(
  run: WorkflowCanvasRun,
  nodeId: string,
  dependencyId: string,
  visited = new Set<string>(),
): boolean {
  if (visited.has(nodeId)) return false;
  visited.add(nodeId);
  const node = run.nodes.find((candidate) => candidate.id === nodeId);
  return (node?.dependsOn || []).some((candidateId) => (
    candidateId === dependencyId
    || workflowNodeDependsOn(run, candidateId, dependencyId, visited)
  ));
}

function cloneWorkflowCanvasNodeForRevision(node: WorkflowCanvasNode): WorkflowCanvasNode {
  return {
    ...node,
    dependsOn: [...(node.dependsOn || [])],
    inputBindings: node.inputBindings?.map((binding) => ({
      ...binding,
      acceptedStatuses: binding.acceptedStatuses
        ? [...binding.acceptedStatuses]
        : binding.acceptedStatuses,
    })),
    coordination: node.coordination
      ? {
          ...node.coordination,
          reviewTargets: node.coordination.reviewTargets
            ? [...node.coordination.reviewTargets]
            : node.coordination.reviewTargets,
        }
      : node.coordination,
  };
}

function uniqueWorkflowNodeIds(nodeIds: string[]) {
  return [...new Set(nodeIds.map((nodeId) => String(nodeId || "").trim()).filter(Boolean))];
}

function replaceWorkflowNodeIds(
  currentIds: string[],
  replacedIds: Set<string>,
  insertedNodeId: string,
) {
  let replaced = false;
  const nextIds = currentIds.flatMap((nodeId) => {
    if (!replacedIds.has(nodeId)) return [nodeId];
    if (replaced) return [];
    replaced = true;
    return [insertedNodeId];
  });
  if (!replaced) nextIds.push(insertedNodeId);
  return uniqueWorkflowNodeIds(nextIds);
}

function workflowNodeWithDependencies(
  node: WorkflowCanvasNode,
  dependencies: string[],
): WorkflowCanvasNode {
  const normalizedDependencies = uniqueWorkflowNodeIds(dependencies);
  const existingBindings = new Map(
    (node.inputBindings || []).map((binding) => [binding.sourceNodeId, binding]),
  );
  const inputBindings = normalizedDependencies.map((sourceNodeId) => {
    const existing = existingBindings.get(sourceNodeId);
    return {
      sourceNodeId,
      required: true,
      acceptedStatuses: ["succeeded"] as WorkflowNodeStatus[],
      outputPath: existing?.outputPath || null,
    };
  });
  const joinPolicy = normalizedDependencies.length
    ? {
        mode: "all_required",
      }
    : null;
  return {
    ...node,
    dependsOn: normalizedDependencies,
    inputBindings,
    joinPolicy,
  };
}

function workflowNodeWithReviewTargets(
  node: WorkflowCanvasNode,
  reviewTargets: string[],
) {
  if (!node.coordination) return node;
  return {
    ...node,
    coordination: {
      ...node.coordination,
      reviewTargets: uniqueWorkflowNodeIds(reviewTargets),
    },
  };
}

export function workflowCanvasDisplayNodes(nodes: WorkflowCanvasNode[]): WorkflowCanvasNode[] {
  const expansions = nodes.map((node) => expandWorkflowCanvasNode(node));
  const activeDisplayIdBySourceId = new Map(expansions.map((expansion) => [
    expansion.sourceId,
    expansion.activeDisplayId,
  ]));
  return expansions.flatMap((expansion) => expansion.nodes).map((node) => ({
    ...node,
    dependsOn: (node.dependsOn || []).map((dependencyId) => (
      activeDisplayIdBySourceId.get(dependencyId) || dependencyId
    )),
  }));
}

function expandWorkflowCanvasNode(node: WorkflowCanvasNode) {
  const currentChoice = Math.max(1, Number(node.executorChoice) || 1);
  const historyByChoice = new Map<number, NonNullable<WorkflowCanvasNode["executorHistory"]>[number]>();
  for (const entry of node.kind === "model" || node.kind === "agent" ? node.executorHistory || [] : []) {
    const choice = Math.max(1, Number(entry.executorChoice) || 1);
    if (choice < currentChoice) historyByChoice.set(choice, entry);
  }
  const previousExecutors = [...historyByChoice.entries()].sort(([left], [right]) => left - right);
  if (!previousExecutors.length) {
    return { sourceId: node.id, activeDisplayId: node.id, nodes: [node] };
  }
  const activeDisplayId = executorDisplayNodeId(node.id, currentChoice);
  return {
    sourceId: node.id,
    activeDisplayId,
    nodes: [
      ...previousExecutors.map(([choice, entry]) => workflowExecutorHistoryNode(node, choice, entry)),
      {
        ...node,
        id: activeDisplayId,
        displaySourceNodeId: node.id,
        displayExecutorChoice: currentChoice,
      },
    ],
  };
}

function workflowExecutorHistoryNode(
  node: WorkflowCanvasNode,
  choice: number,
  entry: NonNullable<WorkflowCanvasNode["executorHistory"]>[number],
): WorkflowCanvasNode {
  const attempts = Math.max(1, Number(entry.attempts) || 1);
  const status = entry.status === "succeeded" ? "succeeded" : "failed";
  const error = status === "failed"
    ? entry.error || { code: "NODE_EXECUTION_FAILED", message: "模型候选执行失败", retryable: false }
    : null;
  return {
    ...node,
    id: executorDisplayNodeId(node.id, choice),
    provider: entry.provider || null,
    model: entry.model || null,
    status,
    completedAt: entry.completedAt || null,
    result: {
      status,
      output: { text: "", data: null, artifacts: [] },
      evidence: [],
      confidence: null,
      diagnostics: {
        provider: entry.provider || null,
        model: entry.model || null,
        durationMs: null,
        attempts,
      },
      error,
    },
    attempt: attempts,
    retrying: false,
    lastRetryError: error,
    executorChoice: choice,
    totalAttempts: attempts,
    executorHistory: [],
    displaySourceNodeId: node.id,
    displayExecutorChoice: choice,
  };
}

function executorDisplayNodeId(sourceNodeId: string, choice: number) {
  return choice <= 1 ? sourceNodeId : `${sourceNodeId}${EXECUTOR_DISPLAY_NODE_SEPARATOR}${choice}`;
}

export function renderWorkflowCanvas(
  run: WorkflowCanvasRun,
  selectedNodeId: string | null = null,
  logoUrls: WorkflowNodeLogoUrls | null = null,
  layoutSnapshot: WorkflowCanvasLayoutSnapshot | null = null,
) {
  const resolvedLayoutSnapshot = layoutSnapshot
    ? snapWorkflowCanvasLayoutToGrid(run, layoutSnapshot, layoutSnapshot.width)
    : captureWorkflowCanvasLayout(run);
  const layout = workflowCanvasLayout(run, resolvedLayoutSnapshot);
  const width = Math.max(
    resolvedLayoutSnapshot?.width || 0,
    workflowCanvasWidth(layout),
    ...layout.map((node) => node.x + node.width + CANVAS_HORIZONTAL_PADDING),
  );
  const height = Math.max(
    360,
    resolvedLayoutSnapshot?.height || 0,
    ...layout.map((node) => node.y + node.height + CANVAS_VERTICAL_PADDING),
  );
  const edges = resolvedLayoutSnapshot?.edges || workflowEdges(layout);
  const entryNodeIds = new Set(
    resolvedLayoutSnapshot?.entryNodeIds
    || layout.filter((node) => node.displayDependsOn.length === 0).map((node) => node.id),
  );
  const entryNodes = layout.filter((node) => entryNodeIds.has(node.id));
  const editable = isTerminalWorkflowRun(run);
  return `
    <section class="cluster-workflow-shell" data-workflow-run-id="${attr(run.id)}" data-workflow-thread-id="${attr(run.threadId)}">
      <div class="cluster-workflow-viewport" aria-label="工作流画布；滚轮缩放，拖拽空白处任意移动">
        <div class="cluster-workflow-canvas">
          <div class="workflow-grid" aria-hidden="true"></div>
          ${layout.length === 0 ? `
            <div class="workflow-canvas-empty-hint" role="status" aria-label="右键添加节点">
              <span>右键添加节点</span>
            </div>
          ` : ""}
          <div class="workflow-graph" style="width:${width}px;height:${height}px">
            <svg class="workflow-edges" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ${editable ? 'role="group" aria-label="工作流连接"' : 'aria-hidden="true"'}>
              <defs>
                <marker id="workflow-arrow-${attr(run.id)}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 8 4 L 0 8 z"></path>
                </marker>
              </defs>
              ${edges.map((edge) => `
                <g class="workflow-edge-group">
                  <path class="workflow-edge ${attr(edge.status)}" data-workflow-edge-source="${attr(edge.sourceId)}" data-workflow-edge-target="${attr(edge.targetId)}" d="${edge.path}" marker-end="url(#workflow-arrow-${attr(run.id)})" aria-hidden="true"></path>
                  ${editable ? `
                    <path class="workflow-edge-hit" d="${edge.path}" aria-hidden="true"></path>
                    <foreignObject class="workflow-edge-delete-wrap" x="${edge.deleteX - 14}" y="${edge.deleteY - 14}" width="28" height="28">
                      <div class="workflow-edge-delete-anchor" xmlns="http://www.w3.org/1999/xhtml">
                        <button
                          type="button"
                          class="workflow-node-delete workflow-edge-delete"
                          data-action="delete-workflow-edge"
                          data-workflow-thread-id="${attr(run.threadId)}"
                          data-workflow-edge-source="${attr(edge.sourceNodeId)}"
                          data-workflow-edge-target="${attr(edge.targetNodeId)}"
                          data-workflow-edge-display-source="${attr(edge.sourceId)}"
                          data-workflow-edge-display-target="${attr(edge.targetId)}"
                          aria-label="删除${attr(edge.sourceTitle)}到${attr(edge.targetTitle)}的连接"
                          title="删除连接"
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"></path></svg>
                        </button>
                      </div>
                    </foreignObject>
                  ` : ""}
                </g>
              `).join("")}
            </svg>
            ${editable ? `
              <svg class="workflow-edge-preview" data-workflow-edge-preview viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" hidden>
                <path class="workflow-edge-preview-line" data-workflow-edge-preview-path></path>
              </svg>
            ` : ""}
            ${layout.map((node) => renderWorkflowNode(
              node,
              run.threadId,
              node.id === selectedNodeId,
              logoUrls,
              entryNodeIds.has(node.id),
              editable,
            )).join("")}
          </div>
        </div>
      </div>
      <svg class="workflow-composer-connector" data-workflow-composer-connector ${editable ? 'role="group" aria-label="输入框入口连接"' : 'aria-hidden="true"'} hidden>
        ${entryNodes.map((node) => `
          <g class="workflow-edge-group workflow-composer-edge-group" data-workflow-composer-entry-target="${attr(node.id)}">
            <path class="workflow-composer-connector-line" data-workflow-composer-edge-path aria-hidden="true"></path>
            ${editable ? `
              <path class="workflow-edge-hit workflow-composer-edge-hit" data-workflow-composer-edge-hit aria-hidden="true"></path>
              <foreignObject class="workflow-edge-delete-wrap workflow-composer-edge-delete-wrap" width="28" height="28">
                <div class="workflow-edge-delete-anchor" xmlns="http://www.w3.org/1999/xhtml">
                  <button
                    type="button"
                    class="workflow-node-delete workflow-edge-delete"
                    data-action="delete-workflow-composer-edge"
                    data-workflow-thread-id="${attr(run.threadId)}"
                    data-workflow-composer-edge-target="${attr(node.id)}"
                    aria-label="删除输入框到${attr(node.title)}的连接"
                    title="删除连接"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"></path></svg>
                  </button>
                </div>
              </foreignObject>
            ` : ""}
          </g>
        `).join("")}
      </svg>
    </section>
  `;
}

export function captureWorkflowCanvasLayout(
  run: WorkflowCanvasRun,
): WorkflowCanvasLayoutSnapshot {
  const layout = layoutWorkflowGraph(workflowCanvasPresentationNodes(run));
  const runtimeEntryNodeIds = workflowCanvasRuntimeEntryNodeIds(run);
  const snapshot: WorkflowCanvasLayoutSnapshot = {
    width: Math.max(
      workflowCanvasWidth(layout),
      ...layout.map((node) => node.x + node.width + CANVAS_HORIZONTAL_PADDING),
    ),
    height: Math.max(
      360,
      ...layout.map((node) => node.y + node.height + CANVAS_VERTICAL_PADDING),
    ),
    edges: workflowEdges(layout),
    entryNodeIds: runtimeEntryNodeIds ?? layout
      .filter((node) => node.displayDependsOn.length === 0)
      .map((node) => node.id),
    nodePositions: Object.fromEntries(layout.map((node) => [
      node.id,
      {
        x: node.x,
        y: node.y,
        layer: node.layer,
      },
    ])),
  };
  return snapWorkflowCanvasLayoutToGrid(run, snapshot, snapshot.width);
}

export function removeWorkflowCanvasEdgeFromLayoutSnapshot(
  snapshot: WorkflowCanvasLayoutSnapshot,
  sourceId: string,
  targetId: string,
): WorkflowCanvasLayoutSnapshot {
  return {
    ...snapshot,
    edges: snapshot.edges.filter((edge) => (
      edge.sourceId !== sourceId || edge.targetId !== targetId
    )),
  };
}

export function removeWorkflowCanvasComposerEdgeFromLayoutSnapshot(
  snapshot: WorkflowCanvasLayoutSnapshot,
  targetId: string,
): WorkflowCanvasLayoutSnapshot {
  if (!snapshot.entryNodeIds.includes(targetId)) return snapshot;
  return {
    ...snapshot,
    entryNodeIds: snapshot.entryNodeIds.filter((nodeId) => nodeId !== targetId),
  };
}

export function addWorkflowCanvasComposerEdgeToLayoutSnapshot(
  snapshot: WorkflowCanvasLayoutSnapshot,
  targetId: string,
): WorkflowCanvasLayoutSnapshot {
  if (
    !snapshot.nodePositions[targetId]
    || snapshot.entryNodeIds.includes(targetId)
  ) return snapshot;
  return {
    ...snapshot,
    entryNodeIds: [...snapshot.entryNodeIds, targetId],
  };
}

export function addWorkflowCanvasEdgeToLayoutSnapshot(
  snapshot: WorkflowCanvasLayoutSnapshot,
  run: WorkflowCanvasRun,
  sourceId: string,
  targetId: string,
): WorkflowCanvasLayoutSnapshot {
  if (snapshot.edges.some((edge) => (
    edge.sourceId === sourceId && edge.targetId === targetId
  ))) return snapshot;
  const layout = workflowCanvasLayout(run, snapshot);
  const source = layout.find((node) => node.id === sourceId);
  const target = layout.find((node) => node.id === targetId);
  if (!source || !target || source.layer >= target.layer) return snapshot;
  const edge = workflowEdges([
    {
      ...source,
      displayDependsOn: [],
    },
    {
      ...target,
      displayDependsOn: [source.id],
    },
  ])[0];
  if (!edge) return snapshot;
  return {
    ...snapshot,
    edges: [...snapshot.edges, edge],
  };
}

export function reconcileWorkflowCanvasEdgeConnection(
  run: WorkflowCanvasRun,
  snapshot: WorkflowCanvasLayoutSnapshot,
  sourceNodeId: string,
  targetNodeId: string,
  displaySourceId: string,
  displayTargetId: string,
) {
  const targetNode = run.nodes.find((node) => node.id === targetNodeId);
  const semanticEdgeExists = Boolean(
    targetNode && (targetNode.dependsOn || []).includes(sourceNodeId),
  );
  const displayEdgeExists = snapshot.edges.some((edge) => (
    edge.sourceId === displaySourceId && edge.targetId === displayTargetId
  ));
  const nextRun = connectWorkflowCanvasEdge(run, sourceNodeId, targetNodeId);
  const nextSnapshot = addWorkflowCanvasEdgeToLayoutSnapshot(
    snapshot,
    nextRun,
    displaySourceId,
    displayTargetId,
  );
  const semanticEdgeReady = semanticEdgeExists || nextRun !== run;
  const displayEdgeReady = (
    displayEdgeExists
    || nextSnapshot.edges.length === snapshot.edges.length + 1
  );
  const changed = nextRun !== run || nextSnapshot !== snapshot;
  if (!semanticEdgeReady || !displayEdgeReady || !changed) return null;
  return {
    run: nextRun,
    layoutSnapshot: nextSnapshot,
  };
}

export function workflowCanvasNestedConnectionIssue(
  run: WorkflowCanvasRun,
  nestedNodeIds: string[] | null = null,
) {
  const byId = new Map(run.nodes.map((node) => [node.id, node]));
  const requested = nestedNodeIds ? new Set(nestedNodeIds) : null;
  for (const nestedNode of run.nodes) {
    if (!nestedNode.workflowRef || (requested && !requested.has(nestedNode.id))) continue;
    const nestedContract = nestedNode.nodeContract;
    if (nestedContract?.compiled !== true) {
      return `历史画布节点 ${workflowCanvasNodeName(nestedNode)} 的输入输出类型尚未定义，不能添加或连接。`;
    }
    const inputSlots = nestedContract.inputContract?.slots || [];
    const outputSlots = nestedContract.outputContract?.slots || [];
    const upstreamNodes = (nestedNode.dependsOn || [])
      .map((nodeId) => byId.get(nodeId))
      .filter((node): node is WorkflowCanvasNode => Boolean(node));
    if (upstreamNodes.length) {
      const upstreamSlots = upstreamNodes.flatMap(workflowCanvasEffectiveOutputSlots);
      if (!workflowCanvasSlotSetsCompatible(upstreamSlots, inputSlots, true)) {
        return `上游输出不符合历史画布“${workflowCanvasNodeName(nestedNode)}”的固定输入要求（需要${workflowCanvasSlotSummary(inputSlots)}）。`;
      }
    }
    for (const downstreamNode of run.nodes.filter((node) => (
      (node.dependsOn || []).includes(nestedNode.id) && !node.workflowRef
    ))) {
      const acceptedSlots = (downstreamNode.nodeContract?.inputContract?.slots || [])
        .filter((slot) => slot.origin?.kind !== "fixed_attachment");
      if (downstreamNode.nodeContract?.compiled !== true) continue;
      if (!acceptedSlots.length || !workflowCanvasSlotSetsCompatible(outputSlots, acceptedSlots, false)) {
        return `历史画布“${workflowCanvasNodeName(nestedNode)}”的固定输出（${workflowCanvasSlotSummary(outputSlots)}）不符合下游节点“${workflowCanvasNodeName(downstreamNode)}”的输入要求。`;
      }
    }
  }
  return null;
}

function workflowCanvasEffectiveOutputSlots(node: WorkflowCanvasNode): WorkflowNodeSlot[] {
  const slots = node.nodeContract?.outputContract?.slots || [];
  if (slots.length) return slots;
  const format = String(node.outputContract?.format || "").trim().toLowerCase();
  if (!format || format === "auto" || format === "text") {
    return [workflowCanvasLegacySlot(node, "text", "文字", [])];
  }
  if (format === "structured_data") {
    return [workflowCanvasLegacySlot(node, "file", "结构化数据", ["application/json", ".json"] )];
  }
  if (format === "artifact" || format === "mixed") {
    const accepts = (node.outputContract?.requiredArtifactTypes || []).map((value) => (
      value.startsWith(".") || value.includes("/") ? value : `.${value}`
    ));
    return [
      ...(format === "mixed" ? [workflowCanvasLegacySlot(node, "text", "文字", [])] : []),
      workflowCanvasLegacySlot(node, "file", "文件", accepts),
    ];
  }
  return [];
}

function workflowCanvasLegacySlot(
  node: WorkflowCanvasNode,
  type: WorkflowNodeSlot["type"],
  semanticName: string,
  accept: string[],
): WorkflowNodeSlot {
  return {
    slotId: `legacy_${node.id}_${type}_${semanticName}`,
    type,
    semanticName,
    minCount: 1,
    maxCount: 1,
    required: true,
    accept,
    origin: { kind: "generated" },
  };
}

function workflowCanvasSlotSetsCompatible(
  sourceSlots: WorkflowNodeSlot[],
  targetSlots: WorkflowNodeSlot[],
  exact: boolean,
) {
  if (exact && sourceSlots.length !== targetSlots.length) return false;
  if (!sourceSlots.length) return targetSlots.every((slot) => slot.minCount === 0);
  const used = new Set<number>();
  const match = (sourceIndex: number): boolean => {
    if (sourceIndex >= sourceSlots.length) return true;
    for (let targetIndex = 0; targetIndex < targetSlots.length; targetIndex += 1) {
      if (used.has(targetIndex)) continue;
      if (!workflowCanvasSlotsCompatible(sourceSlots[sourceIndex], targetSlots[targetIndex])) continue;
      used.add(targetIndex);
      if (match(sourceIndex + 1)) return true;
      used.delete(targetIndex);
    }
    return false;
  };
  return match(0);
}

function workflowCanvasSlotsCompatible(source: WorkflowNodeSlot, target: WorkflowNodeSlot) {
  if (source.type !== target.type) return false;
  if (source.minCount < target.minCount || source.maxCount > target.maxCount) return false;
  const targetAccept = [...new Set((target.accept || []).map(workflowCanvasAcceptToken).filter(Boolean))];
  if (!targetAccept.length) return true;
  const sourceAccept = [...new Set((source.accept || []).map(workflowCanvasAcceptToken).filter(Boolean))];
  if (!sourceAccept.length) return false;
  return sourceAccept.every((sourceToken) => targetAccept.some((targetToken) => (
    sourceToken === targetToken
    || targetToken === "*"
    || targetToken === "*/*"
    || (targetToken.endsWith("/*") && sourceToken.startsWith(targetToken.slice(0, -1)))
    || workflowCanvasAcceptFamily(sourceToken) === workflowCanvasAcceptFamily(targetToken)
  )));
}

function workflowCanvasAcceptToken(value: string) {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return "";
  return token.startsWith(".") || token.includes("/") || token.includes("*")
    ? token
    : `.${token}`;
}

function workflowCanvasAcceptFamily(value: string) {
  if ([".doc", "application/msword"].includes(value)) return "word-doc";
  if ([
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ].includes(value)) return "word-docx";
  return value;
}

function workflowCanvasSlotSummary(slots: WorkflowNodeSlot[]) {
  if (!slots.length) return "无额外输入";
  return slots.map((slot) => {
    const count = slot.minCount === slot.maxCount
      ? `${slot.minCount} 个`
      : `${slot.minCount}-${slot.maxCount} 个`;
    return `${count}${slot.semanticName}`;
  }).join("、");
}

function workflowCanvasNodeName(node: WorkflowCanvasNode) {
  return node.displayCode || node.title || node.id;
}

export function deleteWorkflowCanvasNodeFromLayoutSnapshot(
  snapshot: WorkflowCanvasLayoutSnapshot,
  previousRun: WorkflowCanvasRun,
  nextRun: WorkflowCanvasRun,
  deletedNodeId: string,
): WorkflowCanvasLayoutSnapshot {
  const previousLayout = layoutWorkflowGraph(workflowCanvasPresentationNodes(previousRun));
  const nextLayout = layoutWorkflowGraph(workflowCanvasPresentationNodes(nextRun));
  const deletedDisplayNodeIds = new Set(
    previousLayout
      .filter((node) => (node.displaySourceNodeId || node.id) === deletedNodeId)
      .map((node) => node.id),
  );
  const nextDisplayNodeIds = new Set(nextLayout.map((node) => node.id));
  const previousNaturalEdgeKeys = new Set(
    workflowEdges(previousLayout)
      .map((edge) => workflowCanvasEdgeKey(edge.sourceId, edge.targetId)),
  );
  const nextNaturalEdges = workflowEdges(nextLayout);
  const nextNaturalEdgeKeys = new Set(
    nextNaturalEdges.map((edge) => workflowCanvasEdgeKey(edge.sourceId, edge.targetId)),
  );
  let nextSnapshot: WorkflowCanvasLayoutSnapshot = {
    ...snapshot,
    nodePositions: Object.fromEntries(
      Object.entries(snapshot.nodePositions).filter(([nodeId]) => (
        nextDisplayNodeIds.has(nodeId) && !deletedDisplayNodeIds.has(nodeId)
      )),
    ),
    edges: snapshot.edges.filter((edge) => (
      !deletedDisplayNodeIds.has(edge.sourceId)
      && !deletedDisplayNodeIds.has(edge.targetId)
      && nextNaturalEdgeKeys.has(workflowCanvasEdgeKey(edge.sourceId, edge.targetId))
    )),
    entryNodeIds: snapshot.entryNodeIds.filter((nodeId) => (
      nextDisplayNodeIds.has(nodeId) && !deletedDisplayNodeIds.has(nodeId)
    )),
  };
  for (const edge of nextNaturalEdges) {
    if (previousNaturalEdgeKeys.has(workflowCanvasEdgeKey(edge.sourceId, edge.targetId))) continue;
    nextSnapshot = addWorkflowCanvasEdgeToLayoutSnapshot(
      nextSnapshot,
      nextRun,
      edge.sourceId,
      edge.targetId,
    );
  }
  return snapWorkflowCanvasLayoutToGrid(
    nextRun,
    nextSnapshot,
    nextSnapshot.width,
  );
}

export function insertWorkflowCanvasNodeIntoLayoutSnapshot(
  snapshot: WorkflowCanvasLayoutSnapshot,
  run: WorkflowCanvasRun,
  insertedNodeId: string,
  target: WorkflowCanvasInsertTarget,
  point: WorkflowCanvasPoint,
  allowEdgePosition = false,
  requestedCanvasWidth = snapshot.width,
): WorkflowCanvasLayoutSnapshot {
  const layerStep = NODE_HEIGHT + LAYER_GAP;
  const nodePositions = Object.fromEntries(
    Object.entries(snapshot.nodePositions).map(([nodeId, position]) => [
      nodeId,
      { ...position },
    ]),
  );
  let insertedLayer: number;
  let insertedY: number;
  let existingPositionsChanged = false;
  let desiredX = Math.max(CANVAS_HORIZONTAL_PADDING, point.x - NODE_WIDTH / 2);

  if (target.placement === "parallel") {
    insertedLayer = target.layer;
    const rowPositions = Object.values(nodePositions)
      .filter((position) => position.layer === target.layer);
    insertedY = rowPositions.length
      ? Math.min(...rowPositions.map((position) => position.y))
      : Math.max(CANVAS_VERTICAL_PADDING, point.y - NODE_HEIGHT / 2);
  } else {
    desiredX = workflowCanvasBetweenInsertionX(
      nodePositions,
      target.previousLayer,
      target.nextLayer,
      point.x,
    );
    insertedLayer = target.previousLayer == null
      ? target.nextLayer ?? 0
      : target.previousLayer + 1;
    const previousRowPositions = target.previousLayer == null
      ? []
      : Object.values(nodePositions)
          .filter((position) => position.layer === target.previousLayer);
    insertedY = previousRowPositions.length
      ? Math.max(...previousRowPositions.map((position) => position.y)) + layerStep
      : CANVAS_VERTICAL_PADDING;
    if (target.nextLayer != null) {
      existingPositionsChanged = true;
      for (const position of Object.values(nodePositions)) {
        if (position.layer < target.nextLayer) continue;
        position.layer += 1;
        position.y += layerStep;
      }
    }
  }

  const insertedDisplayNodes = layoutWorkflowGraph(workflowCanvasPresentationNodes(run))
    .filter((node) => (node.displaySourceNodeId || node.id) === insertedNodeId);
  for (const [index, node] of insertedDisplayNodes.entries()) {
    const parallelPlacement = target.placement === "parallel"
      ? workflowCanvasParallelInsertionX(
          nodePositions,
          insertedLayer,
          point.x + index * (NODE_WIDTH + COLUMN_GAP),
          target,
          allowEdgePosition,
        )
      : null;
    existingPositionsChanged ||= parallelPlacement?.positionsChanged || false;
    nodePositions[node.id] = {
      x: parallelPlacement?.x ?? workflowCanvasVacantNodeX(
          nodePositions,
          insertedLayer,
          desiredX + index * (NODE_WIDTH + COLUMN_GAP),
        ),
      y: insertedY,
      layer: insertedLayer,
    };
  }

  const minimumNodeX = Math.min(
    CANVAS_HORIZONTAL_PADDING,
    ...Object.values(nodePositions).map((position) => position.x),
  );
  const leftExpansion = Math.max(0, CANVAS_HORIZONTAL_PADDING - minimumNodeX);
  if (leftExpansion > 0) {
    existingPositionsChanged = true;
    for (const position of Object.values(nodePositions)) {
      position.x += leftExpansion;
    }
  }

  const naturalLayout = layoutWorkflowGraph(workflowCanvasPresentationNodes(run));
  const naturalEdges = workflowEdges(naturalLayout);
  const naturalEdgeKeys = new Set(
    naturalEdges.map((edge) => workflowCanvasEdgeKey(edge.sourceId, edge.targetId)),
  );
  const retainedEdges = snapshot.edges.filter((edge) => naturalEdgeKeys.has(
    workflowCanvasEdgeKey(edge.sourceId, edge.targetId),
  ));
  const naturalEntryNodeIds = new Set(
    naturalLayout
      .filter((node) => node.displayDependsOn.length === 0)
      .map((node) => node.id),
  );
  const firstLayer = Math.min(
    insertedLayer,
    ...Object.values(nodePositions).map((position) => position.layer),
  );
  const entryNodeIds = snapshot.entryNodeIds.filter((nodeId) => Boolean(nodePositions[nodeId]));
  if (insertedLayer === firstLayer) {
    for (const node of insertedDisplayNodes) {
      if (naturalEntryNodeIds.has(node.id) && !entryNodeIds.includes(node.id)) {
        entryNodeIds.push(node.id);
      }
    }
  }

  let nextSnapshot: WorkflowCanvasLayoutSnapshot = {
    width: Math.max(
      requestedCanvasWidth,
      snapshot.width + leftExpansion,
      ...Object.values(nodePositions).map((position) => (
        position.x + NODE_WIDTH + CANVAS_HORIZONTAL_PADDING
      )),
    ),
    height: Math.max(
      360,
      snapshot.height,
      ...Object.values(nodePositions).map((position) => (
        position.y + NODE_HEIGHT + CANVAS_VERTICAL_PADDING
      )),
    ),
    edges: existingPositionsChanged ? [] : retainedEdges,
    entryNodeIds,
    nodePositions,
  };
  if (existingPositionsChanged) {
    for (const edge of retainedEdges) {
      nextSnapshot = addWorkflowCanvasEdgeToLayoutSnapshot(
        nextSnapshot,
        run,
        edge.sourceId,
        edge.targetId,
      );
    }
  }
  for (const edge of naturalEdges) {
    if (edge.sourceNodeId !== insertedNodeId && edge.targetNodeId !== insertedNodeId) continue;
    nextSnapshot = addWorkflowCanvasEdgeToLayoutSnapshot(
      nextSnapshot,
      run,
      edge.sourceId,
      edge.targetId,
    );
  }
  return snapWorkflowCanvasLayoutToGrid(
    run,
    nextSnapshot,
    requestedCanvasWidth,
  );
}

export function moveWorkflowCanvasNodeToTarget(
  run: WorkflowCanvasRun,
  snapshot: WorkflowCanvasLayoutSnapshot,
  movedNodeId: string,
  target: WorkflowCanvasInsertTarget,
  point: WorkflowCanvasPoint,
  movedDisplayNodeId = movedNodeId,
  requestedCanvasWidth = snapshot.width,
): {
  run: WorkflowCanvasRun;
  layoutSnapshot: WorkflowCanvasLayoutSnapshot;
  moved: boolean;
} {
  const movedNode = run.nodes.find((node) => node.id === movedNodeId);
  if (!movedNode || isWorkflowSystemNode(movedNode)) {
    return { run, layoutSnapshot: snapshot, moved: false };
  }
  const sourceDisplayNodeIds = layoutWorkflowGraph(workflowCanvasPresentationNodes(run))
    .filter((node) => (node.displaySourceNodeId || node.id) === movedNodeId)
    .map((node) => node.id);
  if (sourceDisplayNodeIds.length > 1) {
    return moveWorkflowCanvasDisplayNodeToTarget(
      run,
      snapshot,
      movedDisplayNodeId,
      target,
      point,
      requestedCanvasWidth,
    );
  }

  const reducedRun = detachWorkflowCanvasNodeForMove(run, movedNodeId);
  const remainingVisibleNodes = workflowCanvasPresentationNodes(reducedRun);
  if (!remainingVisibleNodes.length) {
    return { run, layoutSnapshot: snapshot, moved: false };
  }
  const reducedSnapshot = deleteWorkflowCanvasNodeFromLayoutSnapshot(
    snapshot,
    run,
    reducedRun,
    movedNodeId,
  );
  const remainingLayers = [...new Set(
    Object.entries(snapshot.nodePositions)
      .filter(([nodeId]) => !sourceDisplayNodeIds.includes(nodeId))
      .map(([, position]) => position.layer),
  )].sort((left, right) => left - right);
  const compactLayerByOriginalLayer = new Map(
    remainingLayers.map((layer, index) => [layer, index]),
  );
  const remappedTarget: WorkflowCanvasInsertTarget = target.placement === "parallel"
    ? {
        ...target,
        layer: compactLayerByOriginalLayer.get(target.layer) ?? target.layer,
      }
    : {
        ...target,
        previousLayer: target.previousLayer == null
          ? null
          : compactLayerByOriginalLayer.get(target.previousLayer) ?? target.previousLayer,
        nextLayer: target.nextLayer == null
          ? null
          : compactLayerByOriginalLayer.get(target.nextLayer) ?? target.nextLayer,
      };
  const nextRun = insertWorkflowCanvasNode(
    reducedRun,
    movedNode,
    remappedTarget,
    reducedSnapshot,
  );
  const insertedSnapshot = insertWorkflowCanvasNodeIntoLayoutSnapshot(
    reducedSnapshot,
    nextRun,
    movedNodeId,
    remappedTarget,
    point,
    true,
    requestedCanvasWidth,
  );
  const compactedSnapshot = compactWorkflowCanvasLayoutRows(
    nextRun,
    insertedSnapshot,
    requestedCanvasWidth,
  );
  const runChanged = JSON.stringify(nextRun.nodes) !== JSON.stringify(run.nodes);
  const layoutChanged = JSON.stringify(compactedSnapshot) !== JSON.stringify(snapshot);
  return {
    run: nextRun,
    layoutSnapshot: compactedSnapshot,
    moved: runChanged || layoutChanged,
  };
}

export function snapWorkflowCanvasLayoutToGrid(
  run: WorkflowCanvasRun,
  snapshot: WorkflowCanvasLayoutSnapshot,
  requestedCanvasWidth = snapshot.width,
): WorkflowCanvasLayoutSnapshot {
  const naturalLayout = layoutWorkflowGraph(workflowCanvasPresentationNodes(run));
  const naturalOrder = new Map(naturalLayout.map((node, index) => [node.id, index]));
  const rowsByLayer = new Map<number, Array<{
    nodeId: string;
    x: number;
  }>>();
  for (const node of naturalLayout) {
    const position = snapshot.nodePositions[node.id] || node;
    const layer = Number.isFinite(position.layer) ? position.layer : node.layer;
    const row = rowsByLayer.get(layer) || [];
    row.push({ nodeId: node.id, x: position.x });
    rowsByLayer.set(layer, row);
  }
  const orderedRows = [...rowsByLayer.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, row]) => row.sort((left, right) => (
      left.x - right.x
      || (naturalOrder.get(left.nodeId) || 0) - (naturalOrder.get(right.nodeId) || 0)
    )));
  const maxColumns = Math.max(1, ...orderedRows.map((row) => row.length));
  const minimumWidth = workflowCanvasGridMinimumWidth(maxColumns);
  const width = Math.max(
    minimumWidth,
    Number.isFinite(requestedCanvasWidth) ? requestedCanvasWidth : 0,
  );
  const nodePositions: WorkflowCanvasLayoutSnapshot["nodePositions"] = {};
  orderedRows.forEach((row, layer) => {
    const rowXPositions = workflowCanvasGridRowXPositions(width, row.length);
    row.forEach((entry, index) => {
      nodePositions[entry.nodeId] = {
        x: rowXPositions[index],
        y: workflowCanvasGridLayerY(layer),
        layer,
      };
    });
  });
  const height = Math.max(
    360,
    ...Object.values(nodePositions).map((position) => (
      position.y + NODE_HEIGHT + CANVAS_VERTICAL_PADDING
    )),
  );
  const edgeSourcesByTarget = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    if (!nodePositions[edge.sourceId] || !nodePositions[edge.targetId]) continue;
    const sources = edgeSourcesByTarget.get(edge.targetId) || [];
    if (!sources.includes(edge.sourceId)) sources.push(edge.sourceId);
    edgeSourcesByTarget.set(edge.targetId, sources);
  }
  const positionedLayout = workflowCanvasLayout(run, {
    ...snapshot,
    width,
    height,
    nodePositions,
  }).map((node) => ({
    ...node,
    displayDependsOn: edgeSourcesByTarget.get(node.id) || [],
  }));
  return {
    ...snapshot,
    width,
    height,
    nodePositions,
    edges: workflowEdges(positionedLayout),
    entryNodeIds: snapshot.entryNodeIds.filter((nodeId) => Boolean(nodePositions[nodeId])),
  };
}

function moveWorkflowCanvasDisplayNodeToTarget(
  run: WorkflowCanvasRun,
  snapshot: WorkflowCanvasLayoutSnapshot,
  movedDisplayNodeId: string,
  target: WorkflowCanvasInsertTarget,
  point: WorkflowCanvasPoint,
  requestedCanvasWidth: number,
): {
  run: WorkflowCanvasRun;
  layoutSnapshot: WorkflowCanvasLayoutSnapshot;
  moved: boolean;
} {
  const originalPosition = snapshot.nodePositions[movedDisplayNodeId];
  if (!originalPosition) {
    return { run, layoutSnapshot: snapshot, moved: false };
  }
  const nodePositions = Object.fromEntries(
    Object.entries(snapshot.nodePositions)
      .filter(([nodeId]) => nodeId !== movedDisplayNodeId)
      .map(([nodeId, position]) => [nodeId, { ...position }]),
  );
  const layerStep = NODE_HEIGHT + LAYER_GAP;
  let insertedLayer: number;
  let insertedY: number;
  let insertedX: number;

  if (target.placement === "parallel") {
    insertedLayer = target.layer;
    const rowPositions = Object.values(nodePositions)
      .filter((position) => position.layer === insertedLayer);
    insertedY = rowPositions.length
      ? Math.min(...rowPositions.map((position) => position.y))
      : Math.max(CANVAS_VERTICAL_PADDING, point.y - NODE_HEIGHT / 2);
    insertedX = workflowCanvasParallelInsertionX(
      nodePositions,
      insertedLayer,
      point.x,
      target,
      true,
    ).x;
  } else {
    insertedLayer = target.previousLayer == null
      ? target.nextLayer ?? 0
      : target.previousLayer + 1;
    const previousRowPositions = target.previousLayer == null
      ? []
      : Object.values(nodePositions)
          .filter((position) => position.layer === target.previousLayer);
    insertedY = previousRowPositions.length
      ? Math.max(...previousRowPositions.map((position) => position.y)) + layerStep
      : CANVAS_VERTICAL_PADDING;
    insertedX = workflowCanvasBetweenInsertionX(
      nodePositions,
      target.previousLayer,
      target.nextLayer,
      point.x,
    );
    if (target.nextLayer != null) {
      for (const position of Object.values(nodePositions)) {
        if (position.layer < target.nextLayer) continue;
        position.layer += 1;
        position.y += layerStep;
      }
    }
  }
  nodePositions[movedDisplayNodeId] = {
    x: insertedX,
    y: insertedY,
    layer: insertedLayer,
  };
  const nextSnapshot = compactWorkflowCanvasLayoutRows(run, {
    ...snapshot,
    nodePositions,
  }, requestedCanvasWidth);
  return {
    run,
    layoutSnapshot: nextSnapshot,
    moved: JSON.stringify(nextSnapshot) !== JSON.stringify(snapshot),
  };
}

function detachWorkflowCanvasNodeForMove(
  run: WorkflowCanvasRun,
  movedNodeId: string,
): WorkflowCanvasRun {
  const movedNode = run.nodes.find((node) => node.id === movedNodeId);
  if (!movedNode || isWorkflowSystemNode(movedNode)) return run;
  const upstreamNodeIds = uniqueWorkflowNodeIds(
    (movedNode.dependsOn || []).filter((nodeId) => nodeId !== movedNodeId),
  );
  const nextNodes = run.nodes
    .filter((node) => node.id !== movedNodeId)
    .map((sourceNode) => {
      const node = cloneWorkflowCanvasNodeForRevision(sourceNode);
      const nextDependencies = uniqueWorkflowNodeIds(
        (node.dependsOn || []).flatMap((dependencyId) => (
          dependencyId === movedNodeId ? upstreamNodeIds : [dependencyId]
        )),
      ).filter((dependencyId) => dependencyId !== node.id);
      const nextReviewTargets = uniqueWorkflowNodeIds(
        (node.coordination?.reviewTargets || []).flatMap((reviewTargetId) => (
          reviewTargetId === movedNodeId ? upstreamNodeIds : [reviewTargetId]
        )),
      ).filter((reviewTargetId) => reviewTargetId !== node.id);
      return workflowNodeWithReviewTargets(
        workflowNodeWithDependencies(node, nextDependencies),
        nextReviewTargets,
      );
    });
  return { ...run, nodes: nextNodes };
}

function compactWorkflowCanvasLayoutRows(
  run: WorkflowCanvasRun,
  snapshot: WorkflowCanvasLayoutSnapshot,
  requestedCanvasWidth = snapshot.width,
): WorkflowCanvasLayoutSnapshot {
  const nodePositions = Object.fromEntries(
    Object.entries(snapshot.nodePositions).map(([nodeId, position]) => [
      nodeId,
      { ...position },
    ]),
  );
  const orderedLayers = [...new Set(
    Object.values(nodePositions).map((position) => position.layer),
  )].sort((left, right) => left - right);
  const compactLayerByOriginalLayer = new Map(
    orderedLayers.map((layer, index) => [layer, index]),
  );
  const layerStep = NODE_HEIGHT + LAYER_GAP;
  for (const position of Object.values(nodePositions)) {
    const compactLayer = compactLayerByOriginalLayer.get(position.layer) ?? 0;
    position.layer = compactLayer;
    position.y = CANVAS_VERTICAL_PADDING + compactLayer * layerStep;
  }
  const positionedSnapshot: WorkflowCanvasLayoutSnapshot = {
    ...snapshot,
    width: Math.max(
      snapshot.width,
      ...Object.values(nodePositions).map((position) => (
        position.x + NODE_WIDTH + CANVAS_HORIZONTAL_PADDING
      )),
    ),
    height: Math.max(
      360,
      ...Object.values(nodePositions).map((position) => (
        position.y + NODE_HEIGHT + CANVAS_VERTICAL_PADDING
      )),
    ),
    nodePositions,
    edges: [],
  };
  const positionedLayout = workflowCanvasLayout(run, positionedSnapshot);
  return snapWorkflowCanvasLayoutToGrid(run, {
    ...positionedSnapshot,
    edges: workflowEdges(positionedLayout),
  }, requestedCanvasWidth);
}

function workflowCanvasBetweenInsertionX(
  nodePositions: WorkflowCanvasLayoutSnapshot["nodePositions"],
  previousLayer: number | null,
  nextLayer: number | null,
  pointerX: number,
) {
  const positionsInLayer = (layer: number | null) => (
    layer == null
      ? []
      : Object.values(nodePositions).filter((position) => position.layer === layer)
  );
  const previousRow = positionsInLayer(previousLayer);
  const nextRow = positionsInLayer(nextLayer);
  const alignmentTolerance = 0.01;
  const sharedColumns = previousRow.flatMap((previousPosition) => (
    nextRow
      .filter((nextPosition) => (
        Math.abs(previousPosition.x - nextPosition.x) <= alignmentTolerance
      ))
      .map((nextPosition) => (previousPosition.x + nextPosition.x) / 2)
  ));
  const candidates = (sharedColumns.length
    ? sharedColumns
    : [...previousRow, ...nextRow].map((position) => position.x))
    .filter((candidate, index, values) => (
      values.findIndex((value) => Math.abs(value - candidate) <= alignmentTolerance) === index
    ))
    .sort((left, right) => (
      Math.abs(pointerX - (left + NODE_WIDTH / 2))
      - Math.abs(pointerX - (right + NODE_WIDTH / 2))
    ));
  return candidates[0]
    ?? Math.max(CANVAS_HORIZONTAL_PADDING, pointerX - NODE_WIDTH / 2);
}

function workflowCanvasParallelInsertionX(
  nodePositions: WorkflowCanvasLayoutSnapshot["nodePositions"],
  layer: number,
  pointerX: number,
  target: Extract<WorkflowCanvasInsertTarget, { placement: "parallel" }>,
  allowEdgePosition = false,
) {
  const row = Object.entries(nodePositions)
    .filter(([, position]) => position.layer === layer)
    .sort(([, left], [, right]) => left.x - right.x);
  if (!row.length) {
    return {
      x: Math.max(CANVAS_HORIZONTAL_PADDING, pointerX - NODE_WIDTH / 2),
      positionsChanged: false,
    };
  }
  const firstPosition = row[0][1];
  const lastPosition = row.at(-1)![1];
  if (
    allowEdgePosition
    && (
    pointerX < firstPosition.x - COLUMN_GAP
    || pointerX > lastPosition.x + NODE_WIDTH + COLUMN_GAP
    )
  ) {
    return {
      x: workflowCanvasVacantNodeX(
        nodePositions,
        layer,
        Math.max(CANVAS_HORIZONTAL_PADDING, pointerX - NODE_WIDTH / 2),
      ),
      positionsChanged: false,
    };
  }
  const anchoredIndex = target.anchorDisplayNodeId
    ? row.findIndex(([nodeId]) => nodeId === target.anchorDisplayNodeId)
    : -1;
  const nearestIndex = anchoredIndex >= 0
    ? anchoredIndex
    : row.reduce((bestIndex, [, position], index) => {
        const distance = Math.abs(pointerX - (position.x + NODE_WIDTH / 2));
        const bestPosition = row[bestIndex]?.[1];
        const bestDistance = bestPosition
          ? Math.abs(pointerX - (bestPosition.x + NODE_WIDTH / 2))
          : Number.POSITIVE_INFINITY;
        return distance < bestDistance ? index : bestIndex;
      }, 0);
  const nearest = row[nearestIndex][1];
  const insertBeforeNearest = anchoredIndex >= 0 && target.side
    ? target.side === "left"
    : pointerX < nearest.x + NODE_WIDTH / 2;
  const step = NODE_WIDTH + COLUMN_GAP;
  const direction = insertBeforeNearest ? -1 : 1;
  let candidateX = nearest.x + direction * step;
  const spacingTolerance = 0.01;
  const candidateVacant = () => row.every(([, position]) => (
      candidateX + NODE_WIDTH + COLUMN_GAP <= position.x + spacingTolerance
      || candidateX + spacingTolerance >= position.x + NODE_WIDTH + COLUMN_GAP
    ));
  while (!candidateVacant()) candidateX += direction * step;
  return { x: candidateX, positionsChanged: false };
}

function workflowCanvasVacantNodeX(
  nodePositions: WorkflowCanvasLayoutSnapshot["nodePositions"],
  layer: number,
  requestedX: number,
) {
  const occupied = Object.values(nodePositions)
    .filter((position) => position.layer === layer)
    .sort((left, right) => left.x - right.x);
  const candidates = [
    requestedX,
    ...occupied.flatMap((position) => [
      position.x - NODE_WIDTH - COLUMN_GAP,
      position.x + NODE_WIDTH + COLUMN_GAP,
    ]),
  ]
    .filter((candidate) => candidate >= CANVAS_HORIZONTAL_PADDING)
    .filter((candidate, index, values) => values.indexOf(candidate) === index)
    .sort((left, right) => Math.abs(left - requestedX) - Math.abs(right - requestedX));
  return candidates.find((candidate) => occupied.every((position) => (
    candidate + NODE_WIDTH + COLUMN_GAP <= position.x
    || candidate >= position.x + NODE_WIDTH + COLUMN_GAP
  ))) ?? CANVAS_HORIZONTAL_PADDING;
}

function workflowCanvasEdgeKey(sourceId: string, targetId: string) {
  return `${sourceId}\u0000${targetId}`;
}

function workflowCanvasLayout(
  run: WorkflowCanvasRun,
  snapshot: WorkflowCanvasLayoutSnapshot | null,
) {
  const layout = layoutWorkflowGraph(workflowCanvasPresentationNodes(run));
  if (!snapshot) return layout;
  return layout.map((node) => {
    const position = snapshot.nodePositions[node.id];
    return position
      ? {
          ...node,
          x: position.x,
          y: position.y,
          layer: position.layer,
        }
      : node;
  });
}

export function renderWorkflowNodeDialog(
  run: WorkflowCanvasRun,
  nodeId: string,
  logoUrls: WorkflowNodeLogoUrls | null = null,
  options: WorkflowNodeDialogOptions = {},
) {
  const displayNodes = workflowCanvasDisplayNodes(run.nodes || []);
  const node = displayNodes.find((item) => item.id === nodeId);
  if (!node) return "";
  const sourceNodeId = options.sourceNodeId || node.displaySourceNodeId || node.id;
  const sourceNode = (run.nodes || []).find((item) => item.id === sourceNodeId) || node;
  if (isTerminalWorkflowRun(run) && isWorkflowSystemNode(sourceNode)) return "";
  if (options.editable) {
    return renderWorkflowNodeEditDialog(
      run,
      sourceNode,
      logoUrls,
      options,
    );
  }
  const logoKey = workflowNodeLogoKey(node);
  const logoUrl = logoUrls?.[logoKey] || logoUrls?.haolo || "";
  const result = node.result || null;
  const diagnostics = result?.diagnostics || null;
  const dependencyNames = (node.dependsOn || []).map((dependencyId) => (
    displayNodes.find((item) => item.id === dependencyId)?.title || dependencyId
  ));
  const collaborationDetails = workflowNodeCollaborationDetails(node, displayNodes);
  const metrics = [
    node.executorType ? `执行器：${workflowExecutorTypeLabel(node.executorType)}` : "",
    node.provider ? `服务商：${workflowProviderLabel(node.provider)}` : "",
    node.model ? `模型：${node.model}` : "",
    Number(node.maxExecutorChoices) > 1 ? `模型选择：${Math.max(1, Number(node.executorChoice) || 1)}/${Number(node.maxExecutorChoices)}` : "",
    typeof diagnostics?.durationMs === "number" ? `耗时：${formatDuration(diagnostics.durationMs)}` : "",
    typeof diagnostics?.attempts === "number" ? `累计尝试：${diagnostics.attempts} 次` : "",
    typeof result?.confidence === "number" ? `置信度：${Math.round(result.confidence <= 1 ? result.confidence * 100 : result.confidence)}%` : "",
  ].filter(Boolean);
  const outputText = result?.output?.text || result?.error?.message || "";
  const failureDiagnostics = workflowFailureDiagnostics(result?.error);
  const structuredOutput = result?.output?.data == null ? "" : detailText(result.output.data);
  const evidence = result?.evidence?.length ? detailText(result.evidence) : "";
  const effects = result?.effects?.length ? renderAgentEffects(result.effects) : "";
  const artifacts = result?.output?.artifacts || [];
  const nodeContextPackage = node.kind === "context" ? run.contextPackage : node.contextPackage;
  const contextFiles = nodeContextPackage?.manifest || [];
  const localFileReview = node.kind === "model" || node.kind === "agent"
    ? renderLocalFileReview(node, nodeContextPackage)
    : "";
  const executorAuthorization = node.executorType
    ? renderExecutorAuthorization(node)
    : "";
  const childWorkflow = node.kind === "agent"
    ? renderChildWorkflow(node)
    : "";
  const timing = [
    node.startedAt ? `开始：${formatTimestamp(node.startedAt)}` : "",
    node.completedAt ? `完成：${formatTimestamp(node.completedAt)}` : "",
  ].filter(Boolean);
  const dialogTitleId = `workflow-node-dialog-title-${safeId(node.id)}`;
  const continuationClass = options.suppressEntranceAnimation
    ? " workflow-node-dialog-continuation"
    : "";

  return `
    <div class="modal-backdrop workflow-node-dialog-backdrop${continuationClass}" data-action="close-workflow-node-dialog"></div>
    <dialog class="workflow-node-dialog${continuationClass}" open aria-modal="true" aria-labelledby="${attr(dialogTitleId)}">
      <header class="workflow-node-dialog-header">
        <span class="workflow-node-avatar provider-${attr(logoKey)}${node.kind === "file" ? " file-node" : ""}" data-workflow-model-logo="${attr(logoKey)}">${workflowNodeAvatarContent(node, logoUrl)}</span>
        <div class="workflow-node-dialog-identity">
          <span>节点详情</span>
          <h2 id="${attr(dialogTitleId)}">${displayHtml(node.title)}</h2>
          <p>${displayHtml(workflowNodeExecutorSubtitle(node))}</p>
        </div>
        <span class="workflow-node-status ${attr(node.status)}">${node.status === "running" ? '<i aria-hidden="true"></i>' : ""}${displayHtml(nodeStatusLabel(node.status, node))}</span>
        <button type="button" class="workflow-node-dialog-close" data-action="close-workflow-node-dialog" aria-label="关闭节点详情">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.2 5.2 10 10m0 0 4.8 4.8M10 10l4.8-4.8M10 10l-4.8 4.8"></path></svg>
        </button>
      </header>
      <div class="workflow-node-dialog-body">
        <div class="workflow-node-dialog-grid">
          ${dialogSection("节点职责", node.purpose || "暂无节点职责说明", "summary")}
          ${dialogSection("执行概况", `
            <div class="workflow-node-dialog-metrics">
              ${metrics.length ? metrics.map((metric) => `<span>${displayHtml(metric)}</span>`).join("") : "<span>暂无执行指标</span>"}
            </div>
            ${timing.length ? `<div class="workflow-node-dialog-timing">${timing.map((item) => `<span>${displayHtml(item)}</span>`).join("")}</div>` : ""}
          `, "overview", true)}
          ${node.prompt ? dialogSection("执行指令", node.prompt, "prompt wide") : ""}
          ${executorAuthorization ? dialogSection("执行器与授权", executorAuthorization, "executor-authorization wide", true) : ""}
          ${collaborationDetails ? dialogSection("协作策略", collaborationDetails, "collaboration wide") : ""}
          ${localFileReview ? dialogSection("本地文件审查", localFileReview, "local-file-review wide", true) : ""}
          ${childWorkflow ? dialogSection("子 Agent 执行步骤", childWorkflow, "child-workflow wide", true) : ""}
          ${dependencyNames.length ? dialogSection("依赖节点", `<div class="workflow-node-dialog-chips">${dependencyNames.map((name) => `<span>${displayHtml(name)}</span>`).join("")}</div>`, "dependencies wide", true) : ""}
          ${dialogSection(result?.error ? "失败信息" : "节点输出", outputText || outputLabel(node), `${result?.error ? "failed " : ""}output wide`, false, true)}
          ${failureDiagnostics ? dialogSection("故障诊断", failureDiagnostics, "failure-diagnostics wide", false, true) : ""}
          ${structuredOutput ? dialogSection("结构化数据", structuredOutput, "data wide", false, true) : ""}
          ${evidence ? dialogSection("执行证据", evidence, "evidence wide", false, true) : ""}
          ${effects ? dialogSection("已发生的执行副作用", effects, "effects wide", true) : ""}
          ${node.executorHistory?.length ? dialogSection(node.kind === "agent" ? "执行记录" : "模型替补记录", renderExecutorHistory(node.executorHistory), "executor-history wide", true) : ""}
          ${artifacts.length ? dialogSection("交付文件", renderArtifactList(artifacts), "artifacts wide", true) : ""}
          ${contextFiles.length ? dialogSection("上下文文件", renderContextFiles(contextFiles), "context wide", true) : ""}
          ${node.risk ? dialogSection("风险提示", node.risk, "risk wide") : ""}
        </div>
      </div>
    </dialog>
  `;
}

function renderWorkflowNodeEditDialog(
  run: WorkflowCanvasRun,
  node: WorkflowCanvasNode,
  logoUrls: WorkflowNodeLogoUrls | null,
  options: WorkflowNodeDialogOptions,
) {
  const logoKey = workflowNodeLogoKey(node);
  const dialogTitleId = `workflow-node-dialog-title-${safeId(node.id)}`;
  const executionNode = node.kind === "model" || node.kind === "agent";
  const inputBindings = normalizedWorkflowInputBindings(node);
  const availableSkills = mergeWorkflowDialogSkills(
    options.availableSkills || [],
    node.skillBindings || [],
  );
  const promptSections = workflowControlledPromptSections(node);
  const editorTask = workflowEditorPromptWithSkillMentions(
    promptSections.task,
    node.skillBindings || [],
    availableSkills,
  );
  const newAgentNode = options.newNode === true && (
    node.kind === "agent" || node.executorType === "codex_subagent"
  );
  const executorOptions = workflowExecutorOptions(
    run.nodes || [],
    node,
    options.availableExecutors || [],
    newAgentNode
      ? {
          availableOnly: true,
          executorType: "codex_subagent",
          requireModel: true,
        }
      : {},
  );
  const executorGroups = workflowExecutorOptionGroups(executorOptions);
  const configuredExecutor = workflowExecutorOptionValue({
    executorType: node.executorType,
    provider: node.provider,
    model: node.model,
  });
  const selectedExecutorOption = executorOptions.find((candidate) => (
    workflowExecutorOptionValue(candidate) === configuredExecutor
  )) || executorOptions[0] || null;
  const selectedExecutor = selectedExecutorOption
    ? workflowExecutorOptionValue(selectedExecutorOption)
    : "";
  const editorLogoKey = executionNode && selectedExecutorOption
    ? workflowExecutorLogoKey(selectedExecutorOption)
    : logoKey;
  const editorLogoUrl = logoUrls?.[editorLogoKey] || logoUrls?.haolo || "";
  const executorUnavailable = executionNode && !selectedExecutorOption;
  const continuationClass = options.suppressEntranceAnimation
    ? " workflow-node-dialog-continuation"
    : "";
  const attachments = options.attachments || [];
  const favoritePrompts = options.favoritePrompts || [];
  const saving = options.saving === true;

  return `
    <div class="modal-backdrop workflow-node-dialog-backdrop${continuationClass}" data-action="close-workflow-node-dialog"></div>
    <dialog class="workflow-node-dialog workflow-node-edit-dialog${continuationClass}" open aria-modal="true" aria-labelledby="${attr(dialogTitleId)}">
      <form class="workflow-node-edit-form" data-workflow-node-edit-form data-workflow-thread-id="${attr(run.threadId)}" data-workflow-node-id="${attr(node.id)}" aria-busy="${saving ? "true" : "false"}">
        <header class="workflow-node-dialog-header">
          <span class="workflow-node-avatar provider-${attr(editorLogoKey)}${node.kind === "file" ? " file-node" : ""}" data-workflow-node-edit-avatar data-workflow-model-logo="${attr(editorLogoKey)}">${workflowNodeAvatarContent(node, editorLogoUrl, editorLogoKey)}</span>
          <div class="workflow-node-dialog-identity">
            <h2 id="${attr(dialogTitleId)}">${node.displayCode ? `<span class="workflow-node-display-code">节点 ${displayHtml(node.displayCode)}</span>` : ""}${displayHtml(node.title)}</h2>
          </div>
          <button type="button" class="workflow-node-dialog-close" data-action="close-workflow-node-dialog" aria-label="关闭节点编辑器"${saving ? " disabled" : ""}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.2 5.2 10 10m0 0 4.8 4.8M10 10l4.8-4.8M10 10l-4.8 4.8"></path></svg>
          </button>
        </header>
        <div class="workflow-node-dialog-body"${saving ? ' inert aria-disabled="true"' : ""}>
          <div class="workflow-node-editor-grid">
            ${editorSection("节点提示词", `
              <label class="workflow-node-editor-field workflow-node-prompt-field">
                <div class="workflow-node-prompt-control">
                  ${renderWorkflowNodeDialogAttachments(attachments)}
                  <div class="workflow-node-contract-editor">
                    <label class="workflow-node-contract-field${inputBindings.length ? " derived" : ""}">
                      <span>输入：</span>
                      ${inputBindings.length ? `
                        <textarea name="inputDefinition" hidden aria-hidden="true" tabindex="-1">${html(promptSections.input)}</textarea>
                        <p class="workflow-node-derived-input-note">由连接线和上游节点输出自动生成，不可直接修改</p>
                      ` : `
                        <textarea
                          name="inputDefinition"
                          rows="3"
                          placeholder="说明运行时需要提供什么，例如：一张产品图和一个 txt 文档"
                          data-workflow-node-mention-input
                          required
                        >${html(promptSections.input)}</textarea>
                      `}
                    </label>
                    <label class="workflow-node-contract-field task">
                      <span>任务：</span>
                      <div class="workflow-node-prompt-input-wrap">
                        <div class="workflow-node-prompt-highlight" data-workflow-node-prompt-highlight aria-hidden="true"></div>
                        <textarea
                          name="taskDefinition"
                          rows="5"
                          placeholder="说明这个节点要完成什么；输入 @ 可以调用 Skill"
                          data-workflow-node-mention-input
                          data-workflow-node-prompt
                          ${executionNode ? "required" : ""}
                        >${html(editorTask)}</textarea>
                      </div>
                    </label>
                    <label class="workflow-node-contract-field">
                      <span>输出：</span>
                      <textarea
                        name="outputDefinition"
                        rows="3"
                        placeholder="说明要输出什么，例如：与输入相同的图片和一个处理后的 txt 文件"
                        data-workflow-node-mention-input
                        required
                      >${html(promptSections.output)}</textarea>
                    </label>
                  </div>
                  <div class="workflow-node-prompt-toolbar">
                    <div class="workflow-node-prompt-toolbar-left">
                      <input type="file" multiple hidden data-workflow-node-file-input />
                      <button
                        type="button"
                        class="workflow-node-attachment-trigger"
                        data-action="pick-workflow-node-files"
                        title="添加附件"
                        aria-label="添加附件"
                      >
                        <span>添加附件</span>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V19M5 12H19"></path></svg>
                      </button>
                    </div>
                    ${executionNode ? `
                      <div class="workflow-node-executor-picker">
                        <select name="executor" aria-label="选择模型" tabindex="-1" aria-hidden="true" ${executorUnavailable ? "disabled" : ""}>
                          ${executorOptions.map((candidate) => {
                            const value = workflowExecutorOptionValue(candidate);
                            return `<option value="${attr(value)}"${value === selectedExecutor ? " selected" : ""}>${displayHtml(workflowExecutorModelLabel(candidate))}</option>`;
                          }).join("")}
                        </select>
                        <div class="chat-title-group-wrap">
                          <div class="chat-title-group-control">
                            <button
                              type="button"
                              class="chat-title-group-button composer-model-button"
                              data-action="toggle-workflow-node-executor-menu"
                              aria-haspopup="menu"
                              aria-expanded="false"
                              aria-label="选择模型"
                              title="选择模型"
                              ${executorUnavailable ? "disabled" : ""}
                            >
                              <span>${displayHtml(
                                selectedExecutorOption
                                  ? workflowExecutorModelLabel(selectedExecutorOption)
                                  : "暂无可用执行模型",
                              )}</span>
                              <svg viewBox="0 0 16 16" aria-hidden="true" draggable="false"><path d="m4 6 4 4 4-4"></path></svg>
                            </button>
                          </div>
                        </div>
                        <div class="chat-title-group-menu composer-model-menu grouped workflow-node-executor-menu hidden" data-workflow-node-executor-menu role="menu" aria-label="选择模型">
                          ${executorGroups.length
                            ? executorGroups.map((group) => `
                              <section class="composer-model-group" role="group" aria-label="${attr(group.label)}">
                                <div class="composer-model-group-title">${displayHtml(group.label)}</div>
                                ${group.options.map((candidate) => {
                                  const value = workflowExecutorOptionValue(candidate);
                                  const candidateLogoKey = workflowExecutorLogoKey(candidate);
                                  const selected = value === selectedExecutor;
                                  return `
                                    <button
                                      type="button"
                                      class="${selected ? "active" : ""}"
                                      data-workflow-node-executor-value="${attr(value)}"
                                      data-workflow-model-logo="${attr(candidateLogoKey)}"
                                      role="menuitemradio"
                                      aria-checked="${selected ? "true" : "false"}"
                                    >
                                      <span class="composer-model-option-name">${displayHtml(workflowExecutorModelLabel(candidate))}</span>
                                      ${candidate.priceLabel ? `<span class="composer-model-option-price">${displayHtml(candidate.priceLabel)}</span>` : ""}
                                    </button>
                                  `;
                                }).join("")}
                              </section>
                            `).join("")
                            : `<div class="composer-model-menu-empty">暂无可用执行模型</div>`}
                        </div>
                      </div>
                    ` : ""}
                  </div>
                  ${renderWorkflowNodeMentionMenu(
                    availableSkills,
                    favoritePrompts,
                    [promptSections.input, editorTask, promptSections.output]
                      .filter(Boolean)
                      .join("\n"),
                  )}
                </div>
              </label>
            `, "prompt wide")}
          </div>
        </div>
        <footer class="workflow-node-edit-footer">
          <div>
            <button type="button" class="workflow-node-edit-button secondary" data-action="close-workflow-node-dialog"${saving ? " disabled" : ""}>取消</button>
            <button type="submit" class="workflow-node-edit-button primary"${saving ? " disabled" : ""}>${saving ? "Haolo 正在分析…" : "保存修改"}</button>
          </div>
        </footer>
      </form>
    </dialog>
  `;
}

export function renderWorkflowNodeDialogAttachments(
  attachments: WorkflowNodeDialogAttachment[],
) {
  return `
    <div class="workflow-node-attachments-wrap${attachments.length ? "" : " hidden"}" data-workflow-node-attachments-wrap>
      <button class="attachment-scroll-button left" type="button" data-workflow-node-attachment-scroll="left" aria-label="向左查看附件" hidden>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"></path></svg>
      </button>
      <div
        class="workflow-node-attachments pending-attachments${attachments.length ? "" : " hidden"}"
        data-workflow-node-attachments
        aria-live="polite"
        aria-label="已上传文件，左右滚动查看更多"
        tabindex="0"
      >
        ${attachments.map((attachment) => {
          const status = attachment.uploadStatus || "uploaded";
          const statusLabel = status === "uploading"
            ? "上传中"
            : status === "error"
              ? attachment.uploadError || "上传失败"
              : formatWorkflowAttachmentSize(attachment.size);
          return `
            <span
              class="pending-file ${attr(status)}"
              data-workflow-node-attachment-id="${attr(attachment.id)}"
              title="${attr(attachment.name)}"
            >
              <button
                type="button"
                class="pending-file-open-button"
                data-open-workflow-node-attachment="${attr(attachment.id)}"
                aria-label="${attr(`打开 ${attachment.name}`)}"
              >
                ${attachment.iconUrl
                  ? `<img src="${attr(attachment.iconUrl)}" alt="" />`
                  : `<svg class="workflow-node-attachment-fallback-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h6.8L18.5 8v12.5H7z"></path><path d="M13.5 3.5V8h5"></path></svg>`}
                <span>
                  <strong>${displayHtml(attachment.name)}</strong>
                  <small>${displayHtml(statusLabel)}</small>
                </span>
              </button>
              <button
                type="button"
                data-remove-workflow-node-attachment="${attr(attachment.id)}"
                aria-label="${attr(`移除 ${attachment.name}`)}"
              >
                ${attachment.closeIconUrl
                  ? `<img class="button-close-icon" src="${attr(attachment.closeIconUrl)}" alt="" />`
                  : `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"></path></svg>`}
              </button>
            </span>
          `;
        }).join("")}
      </div>
      <button class="attachment-scroll-button right" type="button" data-workflow-node-attachment-scroll="right" aria-label="向右查看附件" hidden>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
      </button>
    </div>
  `;
}

function formatWorkflowAttachmentSize(value: number | null | undefined) {
  const size = Math.max(0, Number(value) || 0);
  if (!size) return "文件";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function editorSection(title: string, content: string, className = "") {
  return `
    <section class="workflow-node-editor-section ${attr(className)}">
      <h3>${displayHtml(title)}</h3>
      <div class="workflow-node-editor-section-body">${content}</div>
    </section>
  `;
}

function editorSelectOptions(options: Array<[string, string]>, selected: string) {
  return options.map(([value, label]) => (
    `<option value="${attr(value)}"${value === selected ? " selected" : ""}>${displayHtml(label)}</option>`
  )).join("");
}

function workflowEditorPromptWithSkillMentions(
  prompt: string,
  bindings: WorkflowSkillBinding[],
  availableSkills: WorkflowNodeDialogSkill[],
) {
  const skillById = new Map(availableSkills.map((skill) => [skill.id, skill]));
  const missingTokens = bindings.flatMap((binding) => {
    const id = binding.id || binding.name || "";
    if (!id) return [];
    const skill = skillById.get(id);
    const label = skill?.label || binding.name || binding.id || "";
    if (!label || workflowPromptContainsSkillMention(prompt, id, label)) return [];
    return [`@${label}`];
  });
  return missingTokens.length
    ? `${missingTokens.join(" ")}${prompt ? `\n\n${prompt}` : ""}`
    : prompt;
}

function workflowPromptContainsSkillMention(
  prompt: string,
  skillId: string,
  skillLabel: string,
) {
  const normalizedPrompt = prompt.toLocaleLowerCase("zh-CN");
  return [skillLabel, skillId]
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => normalizedPrompt.includes(`@${value.toLocaleLowerCase("zh-CN")}`));
}

function renderWorkflowNodeMentionMenu(
  skills: WorkflowNodeDialogSkill[],
  favoritePrompts: WorkflowNodeDialogFavorite[],
  prompt: string,
) {
  return `
    <div class="workflow-node-mention-popover hidden" data-workflow-node-mention-popover>
      <div class="workflow-node-mention-root" data-workflow-node-mention-root-menu role="menu" aria-label="@ 菜单">
        <button type="button" class="workflow-node-mention-root-item active" data-workflow-node-mention-root="favorites" role="menuitem" aria-haspopup="menu" aria-expanded="false">
          <span>已收藏提示词</span>
          <span class="composer-prompt-favorite-root-add" data-workflow-node-add-prompt-favorite>添加</span>
        </button>
        <button type="button" class="workflow-node-mention-root-item" data-workflow-node-mention-root="skills" role="menuitem" aria-haspopup="menu" aria-expanded="false">
          <span>技能/插件</span>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
        </button>
      </div>
      <div class="workflow-node-mention-submenu composer-prompt-favorite-submenu${favoritePrompts.length === 1 ? " is-single" : ""} hidden" data-workflow-node-mention-submenu="favorites" role="listbox" aria-label="已收藏提示词">
        ${favoritePrompts.length >= 2 ? renderWorkflowNodeMentionSearch("favorites", "搜索提示词") : ""}
        <div class="workflow-node-mention-options composer-prompt-favorite-list">
          ${favoritePrompts.length
            ? favoritePrompts.map((favorite) => `
              <div
                class="composer-prompt-favorite-row"
                data-workflow-node-favorite-id="${attr(favorite.id)}"
                data-workflow-node-favorite-content="${attr(favorite.content)}"
                data-workflow-node-mention-search="${attr(favorite.content.toLocaleLowerCase("zh-CN"))}"
                role="option"
                aria-selected="false"
              >
                <button type="button" class="composer-prompt-favorite-main" title="${attr(favorite.content)}">
                  <span>${displayHtml(workflowFavoritePreview(favorite.content))}</span>
                </button>
                <button type="button" class="composer-prompt-favorite-edit" data-workflow-node-edit-prompt-favorite="${attr(favorite.id)}" aria-label="编辑提示词"><span>编辑</span></button>
              </div>
            `).join("")
            : '<div class="workflow-node-mention-empty">当前没有已收藏提示词</div>'}
          <div class="workflow-node-mention-empty hidden" data-workflow-node-mention-empty="favorites">没有匹配的提示词</div>
        </div>
      </div>
      <div class="workflow-node-mention-submenu hidden" data-workflow-node-mention-submenu="skills" role="menu" aria-label="技能/插件">
        ${renderWorkflowNodeMentionSearch("skills", "搜索技能")}
        <div class="workflow-node-mention-options" role="listbox">
          ${skills.length ? skills.map((skill) => {
            const selected = workflowPromptContainsSkillMention(prompt, skill.id, skill.label);
            return `
              <button
                type="button"
                class="workflow-node-skill-option${selected ? " selected" : ""}"
                data-workflow-node-skill-id="${attr(skill.id)}"
                data-workflow-node-skill-label="${attr(skill.label)}"
                data-workflow-node-mention-search="${attr(`${skill.label} ${skill.id}`.toLocaleLowerCase("zh-CN"))}"
                role="option"
                aria-selected="${selected ? "true" : "false"}"
              >
                <span><b>${displayHtml(skill.label)}</b>${skill.description ? `<small>${displayHtml(skill.description)}</small>` : ""}</span>
                ${selected ? '<i aria-hidden="true">已使用</i>' : ""}
              </button>
            `;
          }).join("") : '<p class="workflow-node-mention-empty">当前没有可用的技能/插件</p>'}
          <p class="workflow-node-mention-empty hidden" data-workflow-node-mention-empty="skills">没有匹配的技能/插件</p>
        </div>
      </div>
    </div>
  `;
}

function renderWorkflowNodeMentionSearch(
  submenu: "favorites" | "skills",
  placeholder: string,
) {
  return `
    <label class="workflow-node-mention-search composer-skill-search">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"></circle><path d="m12.5 12.5 4 4"></path></svg>
      <input type="text" placeholder="${attr(placeholder)}" autocomplete="off" spellcheck="false" data-workflow-node-mention-search-input="${submenu}" />
    </label>
  `;
}

function workflowFavoritePreview(content: string) {
  const text = String(content || "").trim();
  const breakIndexes = [
    text.indexOf("\r"),
    text.indexOf("\n"),
    text.indexOf("。"),
    text.indexOf("."),
  ]
    .filter((index) => index >= 0)
    .map((index) =>
      text[index] === "。" || text[index] === "." ? index + 1 : index,
    );
  const end = breakIndexes.length ? Math.min(...breakIndexes) : text.length;
  const preview = text.slice(0, end).trim() || text;
  return text.slice(end).trim() ? `${preview}...` : preview;
}

function normalizedWorkflowInputBindings(node: WorkflowCanvasNode): WorkflowInputBinding[] {
  if (node.inputBindings?.length) {
    return node.inputBindings
      .filter((binding) => binding?.sourceNodeId)
      .map((binding) => ({
        sourceNodeId: binding.sourceNodeId,
        required: binding.required !== false,
        acceptedStatuses: binding.acceptedStatuses?.length ? binding.acceptedStatuses : ["succeeded"],
        outputPath: binding.outputPath || null,
      }));
  }
  return (node.dependsOn || []).map((sourceNodeId) => ({
    sourceNodeId,
    required: true,
    acceptedStatuses: ["succeeded"],
    outputPath: null,
  }));
}

function mergeWorkflowDialogSkills(
  skills: WorkflowNodeDialogSkill[],
  bindings: WorkflowSkillBinding[],
) {
  const merged = new Map<string, WorkflowNodeDialogSkill>();
  for (const skill of skills) {
    if (!skill?.id) continue;
    merged.set(skill.id, skill);
  }
  for (const binding of bindings) {
    const id = binding.id || binding.name;
    if (!id || merged.has(id)) continue;
    merged.set(id, {
      id,
      label: binding.name || binding.id || id,
      description: binding.version ? `已绑定版本 ${binding.version}` : "来自已执行节点定义",
    });
  }
  return [...merged.values()].sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

function workflowExecutorOptions(
  nodes: WorkflowCanvasNode[],
  currentNode: WorkflowCanvasNode,
  availableExecutors: WorkflowNodeExecutorOption[] = [],
  constraints: {
    availableOnly?: boolean;
    executorType?: string | null;
    requireModel?: boolean;
  } = {},
) {
  const options: WorkflowNodeExecutorOption[] = [];
  const optionIndexByKey = new Map<string, number>();
  const add = (candidate: WorkflowNodeExecutorOption) => {
    const normalized = {
      executorType: candidate.executorType || "external_model",
      provider: candidate.provider || null,
      model: candidate.model || null,
      label: candidate.label || null,
      groupLabel: candidate.groupLabel || null,
      priceLabel: candidate.priceLabel || null,
    };
    if (
      constraints.executorType
      && normalized.executorType !== constraints.executorType
    ) return;
    if (constraints.requireModel && !normalized.model) return;
    const key = workflowExecutorOptionValue(normalized);
    const existingIndex = optionIndexByKey.get(key);
    if (existingIndex !== undefined) {
      if (
        (!options[existingIndex].label && normalized.label)
        || (!options[existingIndex].groupLabel && normalized.groupLabel)
        || (!options[existingIndex].priceLabel && normalized.priceLabel)
      ) {
        options[existingIndex] = {
          ...options[existingIndex],
          label: options[existingIndex].label || normalized.label,
          groupLabel: options[existingIndex].groupLabel || normalized.groupLabel,
          priceLabel: options[existingIndex].priceLabel || normalized.priceLabel,
        };
      }
      return;
    }
    optionIndexByKey.set(key, options.length);
    options.push(normalized);
  };
  if (!constraints.availableOnly) {
    add(currentNode);
    for (const candidate of currentNode.executorCandidates || []) {
      add({
        executorType: candidate.executorType || currentNode.executorType,
        provider: candidate.provider,
        model: candidate.model,
      });
    }
  }
  for (const candidate of availableExecutors) {
    add(candidate);
  }
  if (!constraints.availableOnly) {
    for (const node of nodes) {
      if (node.kind !== "model" && node.kind !== "agent") continue;
      add(node);
      for (const candidate of node.executorCandidates || []) {
        add({
          ...candidate,
          executorType: candidate.executorType || node.executorType,
        });
      }
    }
  }
  return options;
}

function workflowControlledPromptSections(node: WorkflowCanvasNode) {
  const prompt = String(node.prompt || "").replaceAll("\r\n", "\n");
  const inputLabel = "输入：";
  const taskLabel = "任务：";
  const outputLabel = "输出：";
  const inputAt = prompt.indexOf(inputLabel);
  const taskAt = prompt.indexOf(taskLabel);
  const outputAt = prompt.indexOf(outputLabel);
  if (inputAt >= 0 && taskAt > inputAt && outputAt > taskAt) {
    return {
      input: prompt.slice(inputAt + inputLabel.length, taskAt).trim(),
      task: localizedWorkflowTaskText(
        prompt.slice(taskAt + taskLabel.length, outputAt),
      ),
      output: prompt.slice(outputAt + outputLabel.length).trim(),
    };
  }
  const inputSlots = node.nodeContract?.inputContract?.slots || [];
  const outputSlots = node.nodeContract?.outputContract?.slots || [];
  return {
    input: renderWorkflowContractSlots(inputSlots),
    task: localizedWorkflowTaskText(
      node.nodeContract?.taskDefinition?.text || prompt,
    ),
    output: renderWorkflowContractSlots(outputSlots),
  };
}

function localizedWorkflowTaskText(value: string) {
  const task = String(value || "").trim();
  if (
    task
    === "Given the user's runtime prompt text, produce a text output that follows and answers that prompt."
  ) {
    return "根据用户在运行时提供的提示词，生成符合提示词要求并作出回答的文本输出。";
  }
  return task;
}

function renderWorkflowContractSlots(slots: WorkflowNodeSlot[]) {
  if (!slots.length) return "";
  return slots.map((slot) => {
    const source = slot.origin?.kind === "upstream"
      ? `（来自节点 ${slot.origin.nodeCode || slot.origin.nodeId || "上游"}）`
      : slot.origin?.kind === "fixed_attachment"
        ? `（固定附件：${slot.origin.attachmentName || slot.semanticName}）`
        : "";
    const count = slot.minCount === 1 && slot.maxCount === 1
      ? ""
      : `（${slot.minCount}-${slot.maxCount} 个）`;
    return `- ${slot.semanticName}${count}${source}`;
  }).join("\n");
}

function workflowExecutorOptionValue(candidate: {
  executorType?: string | null;
  provider?: string | null;
  model?: string | null;
}) {
  return [
    candidate.executorType || "external_model",
    candidate.provider || "",
    candidate.model || "",
  ].join("|");
}

function workflowExecutorModelLabel(candidate: {
  executorType?: string | null;
  provider?: string | null;
  model?: string | null;
  label?: string | null;
}) {
  return candidate.label
    || candidate.model
    || workflowProviderLabel(candidate.provider || "")
    || "默认模型";
}

function workflowExecutorLogoKey(candidate: {
  provider?: string | null;
  model?: string | null;
  groupLabel?: string | null;
}): WorkflowNodeLogoKey {
  return modelLogoKey(candidate.model)
    || modelLogoKey(candidate.provider)
    || modelLogoKey(candidate.groupLabel)
    || "haolo";
}

function workflowExecutorOptionGroups<T extends {
  executorType?: string | null;
  provider?: string | null;
  model?: string | null;
  groupLabel?: string | null;
}>(options: T[]) {
  const groups = new Map<string, T[]>();
  for (const option of options) {
    const label = option.groupLabel || workflowExecutorGroupLabel(option);
    const items = groups.get(label) || [];
    items.push(option);
    groups.set(label, items);
  }
  return [...groups.entries()].map(([label, groupedOptions]) => ({
    label,
    options: groupedOptions,
  }));
}

function workflowExecutorGroupLabel(candidate: {
  provider?: string | null;
  model?: string | null;
}) {
  const model = String(candidate.model || "").toLocaleLowerCase("en-US");
  if (model.startsWith("gpt-")) return "GPT系列";
  if (model.startsWith("gemini-")) return "Gemini系列";
  if (model.startsWith("claude-")) return "Claude系列";
  if (model.startsWith("doubao-")) return "Doubao系列";
  if (model.startsWith("grok-")) return "Grok系列";
  if (model.startsWith("kimi-")) return "Kimi系列";
  if (model.startsWith("deepseek-")) return "DeepSeek系列";
  const provider = workflowProviderLabel(candidate.provider || "");
  return provider ? `${provider}系列` : "其他模型";
}

function workflowFailureDiagnostics(error?: WorkflowExecutionError | null) {
  if (!error) return "";
  return [
    error.code ? `错误码：${error.code}` : "",
    error.category ? `分类：${error.category}` : "",
    typeof error.status === "number" && error.status > 0 ? `客户端状态：HTTP ${error.status}` : "",
    typeof error.upstreamStatus === "number" && error.upstreamStatus > 0
      ? `真实上游状态：HTTP ${error.upstreamStatus}`
      : "",
    error.requestId ? `请求 ID：${error.requestId}` : "",
    typeof error.retryAfterMs === "number" && error.retryAfterMs > 0
      ? `建议等待：${formatDuration(error.retryAfterMs)}`
      : "",
    error.routeExhausted ? "中转路由：账号级切换已耗尽" : "",
    `可重试：${error.retryable === true ? "是" : "否"}`,
  ].filter(Boolean).join("\n");
}

export function renderWorkflowToolbar(
  _run: WorkflowCanvasRun,
  options: { showExit?: boolean } = {},
) {
  return `
    <div class="cluster-workflow-toolbar">
      <span class="cluster-workflow-toolbar-title" role="heading" aria-level="2">画布</span>
      ${options.showExit
        ? `<button
            type="button"
            class="cluster-workflow-exit"
            data-action="exit-workflow-canvas"
            aria-label="退出画布并返回新任务"
          >退出画布</button>`
        : ""}
    </div>
  `;
}

export function workflowCanvasPreferredPanelWidth(nodes: WorkflowCanvasNode[]) {
  return workflowCanvasWidth(layoutWorkflowGraph(nodes));
}

export function workflowCanvasMaxParallelNodeCount(nodes: WorkflowCanvasNode[]) {
  return workflowCanvasMaxLayerNodeCount(layoutWorkflowGraph(nodes));
}

export function layoutWorkflowGraph(nodes: WorkflowCanvasNode[]): LayoutNode[] {
  const displayNodes = workflowCanvasDisplayNodes(nodes);
  const byId = new Map<string, WorkflowCanvasNode>(displayNodes.map((node) => [node.id, node]));
  const originalOrder = new Map(displayNodes.map((node, index) => [node.id, index]));
  const displayDependencies = workflowDisplayDependencies(displayNodes);
  const layerMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const layerFor = (node: WorkflowCanvasNode): number => {
    if (layerMemo.has(node.id)) return layerMemo.get(node.id)!;
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    const dependencies = (displayDependencies.get(node.id) || [])
      .map((id) => byId.get(id))
      .filter((item): item is WorkflowCanvasNode => Boolean(item));
    const layer = dependencies.length ? Math.max(...dependencies.map(layerFor)) + 1 : 0;
    visiting.delete(node.id);
    layerMemo.set(node.id, layer);
    return layer;
  };
  const groups = new Map<number, WorkflowCanvasNode[]>();
  for (const node of displayNodes) {
    const layer = layerFor(node);
    const group = groups.get(layer) || [];
    group.push(node);
    groups.set(layer, group);
  }
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => left - right);
  const children = workflowDisplayChildren(displayNodes, displayDependencies);
  const positionByNodeId = new Map<string, number>();
  const recordGroupPositions = (group: WorkflowCanvasNode[]) => {
    group.forEach((node, index) => positionByNodeId.set(node.id, index));
  };
  orderedGroups.forEach(([, group]) => recordGroupPositions(group));
  for (let pass = 0; pass < 4; pass += 1) {
    for (let index = 1; index < orderedGroups.length; index += 1) {
      sortLayoutGroup(orderedGroups[index][1], displayDependencies, positionByNodeId, originalOrder);
      recordGroupPositions(orderedGroups[index][1]);
    }
    for (let index = orderedGroups.length - 2; index >= 0; index -= 1) {
      sortLayoutGroup(orderedGroups[index][1], children, positionByNodeId, originalOrder);
      recordGroupPositions(orderedGroups[index][1]);
    }
  }
  const maxColumns = Math.max(1, ...orderedGroups.map(([, group]) => group.length));
  const contentWidth = maxColumns * NODE_WIDTH + (maxColumns - 1) * COLUMN_GAP;
  return orderedGroups.flatMap(([layer, group]) => {
    const groupWidth = group.length * NODE_WIDTH + Math.max(0, group.length - 1) * COLUMN_GAP;
    const left = CANVAS_HORIZONTAL_PADDING + Math.max(0, (contentWidth - groupWidth) / 2);
    return group.map((node, index) => ({
      ...node,
      x: left + index * (NODE_WIDTH + COLUMN_GAP),
      y: CANVAS_VERTICAL_PADDING + layer * (NODE_HEIGHT + LAYER_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      layer,
      displayDependsOn: displayDependencies.get(node.id) || [],
    }));
  });
}

function parallelModelGroupLabel(count: number) {
  return count === 3 ? "三模型并行" : "双模型并行";
}

function workflowCanvasWidth(layout: LayoutNode[]) {
  const columnCount = Math.max(1, workflowCanvasMaxLayerNodeCount(layout));
  return (
    columnCount * NODE_WIDTH +
    Math.max(0, columnCount - 1) * COLUMN_GAP +
    CANVAS_HORIZONTAL_PADDING * 2
  );
}

function workflowCanvasMaxLayerNodeCount(layout: LayoutNode[]) {
  const columnsByLayer = new Map<number, number>();
  for (const node of layout) {
    columnsByLayer.set(node.layer, (columnsByLayer.get(node.layer) || 0) + 1);
  }
  return Math.max(0, ...columnsByLayer.values());
}

function renderWorkflowNode(
  node: LayoutNode,
  threadId: string,
  selected: boolean,
  logoUrls: WorkflowNodeLogoUrls | null,
  entryNode: boolean,
  interactive: boolean,
) {
  const output = node.result?.output?.text || node.result?.error?.message || "";
  const status = node.status;
  const logoKey = workflowNodeLogoKey(node);
  const logoUrl = logoUrls?.[logoKey] || logoUrls?.haolo || "";
  const collaborationClass = node.coordination?.mode === "parallel_candidate"
    ? "parallel-candidate"
    : node.coordination?.mode === "parallel_rescue"
      ? "parallel-rescue"
    : node.coordination?.mode === "review_gate"
      ? "review-gate"
      : "";
  const classTail = [selected ? "selected" : "", collaborationClass].filter(Boolean).join(" ");
  const className = `workflow-node ${node.kind} ${status} ${classTail}`;
  const sourceNodeId = node.displaySourceNodeId || node.id;
  const inputPortAttributes = interactive
    ? ` data-workflow-node-port="input" data-workflow-thread-id="${attr(threadId)}" data-workflow-node-id="${attr(sourceNodeId)}" data-workflow-display-node-id="${attr(node.id)}" title="连接到此节点"`
    : "";
  const outputPortAttributes = interactive
    ? ` data-workflow-node-port="output" data-workflow-thread-id="${attr(threadId)}" data-workflow-node-id="${attr(sourceNodeId)}" data-workflow-display-node-id="${attr(node.id)}" title="从此节点开始连接"`
    : "";
  const interactionAttributes = interactive
    ? `data-action="open-workflow-node-dialog" aria-haspopup="dialog" aria-label="查看${attr(node.title)}节点详情"`
    : `disabled aria-label="${attr(node.title)}节点，工作流执行中不可查看" title="工作流执行中，节点暂不可查看"`;
  return `
    <button type="button" class="${attr(className)}"
      style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px"
      ${interactionAttributes} data-workflow-thread-id="${attr(threadId)}" data-workflow-node-id="${attr(node.id)}"
      data-workflow-source-node-id="${attr(sourceNodeId)}"
      data-workflow-node-layer="${node.layer}"
      data-workflow-entry-node="${entryNode ? "true" : "false"}"
      ${interactive ? 'data-workflow-node-draggable="true"' : ""}>
      <span class="workflow-node-input workflow-node-port"${inputPortAttributes} aria-hidden="true"></span>
      <span class="workflow-node-output workflow-node-port"${outputPortAttributes} aria-hidden="true"></span>
      <span class="workflow-node-topline">
        <span class="workflow-node-avatar provider-${attr(logoKey)}${node.kind === "file" ? " file-node" : ""}" data-workflow-model-logo="${attr(logoKey)}">${workflowNodeAvatarContent(node, logoUrl)}</span>
        <span class="workflow-node-identity"><span class="workflow-node-title">${displayHtml(node.title)}</span><small>${displayHtml(workflowNodeExecutorSubtitle(node))}</small></span>
        <span class="workflow-node-status ${attr(status)}">${status === "running" ? '<i aria-hidden="true"></i>' : ""}${displayHtml(nodeStatusLabel(status, node))}</span>
      </span>
      <span class="workflow-node-purpose">${displayHtml(node.purpose || "等待任务说明")}</span>
      <span class="workflow-node-foot">
        <span>${displayHtml(inputLabel(node))}</span>
        <span>${output ? displayHtml(shortText(output, 22)) : displayHtml(outputLabel(node))}</span>
      </span>
    </button>
    ${interactive ? `
      <button
        type="button"
        class="workflow-node-delete workflow-node-card-delete"
        style="left:${node.x + node.width - 12}px;top:${node.y - 12}px"
        data-action="open-workflow-node-delete"
        data-workflow-thread-id="${attr(threadId)}"
        data-workflow-node-id="${attr(sourceNodeId)}"
        aria-label="删除${attr(node.title)}节点"
        title="删除节点"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"></path></svg>
      </button>
    ` : ""}
  `;
}

function workflowEdges(nodes: LayoutNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  let leftLaneCount = 0;
  let rightLaneCount = 0;
  const edges: WorkflowCanvasEdgeLayout[] = [];
  for (const target of nodes) {
    for (const sourceId of target.displayDependsOn) {
      const source = byId.get(sourceId);
      if (!source) continue;
      const startX = source.x + source.width / 2;
      const startY = source.y + source.height;
      const endX = target.x + target.width / 2;
      const endY = target.y;
      const spansMultipleLayers = target.layer - source.layer > 1;
      let path: string;
      let pathPoints: WorkflowCanvasPoint[];
      if (spansMultipleLayers) {
        const useLeftLane = startX < endX || (startX === endX && leftLaneCount <= rightLaneCount);
        const laneX = useLeftLane
          ? Math.max(6, minX - 18 - leftLaneCount++ * 12)
          : maxX + 18 + rightLaneCount++ * 12;
        const shoulder = Math.min(30, Math.max(20, (endY - startY) * 0.12));
        path = `M ${startX} ${startY} C ${startX} ${startY + shoulder / 2}, ${laneX} ${startY + shoulder / 2}, ${laneX} ${startY + shoulder} L ${laneX} ${endY - shoulder} C ${laneX} ${endY - shoulder / 2}, ${endX} ${endY - shoulder / 2}, ${endX} ${endY}`;
        const firstCurve = sampleWorkflowCubicBezier(
          { x: startX, y: startY },
          { x: startX, y: startY + shoulder / 2 },
          { x: laneX, y: startY + shoulder / 2 },
          { x: laneX, y: startY + shoulder },
        );
        const laneEnd = { x: laneX, y: endY - shoulder };
        const finalCurve = sampleWorkflowCubicBezier(
          laneEnd,
          { x: laneX, y: endY - shoulder / 2 },
          { x: endX, y: endY - shoulder / 2 },
          { x: endX, y: endY },
        );
        pathPoints = [...firstCurve, laneEnd, ...finalCurve.slice(1)];
      } else {
        const control = Math.max(28, (endY - startY) * 0.48);
        path = `M ${startX} ${startY} C ${startX} ${startY + control}, ${endX} ${endY - control}, ${endX} ${endY}`;
        pathPoints = sampleWorkflowCubicBezier(
          { x: startX, y: startY },
          { x: startX, y: startY + control },
          { x: endX, y: endY - control },
          { x: endX, y: endY },
        );
      }
      const deletePoint = workflowPointAlongPolyline(pathPoints, 1 / 3);
      edges.push({
        sourceId,
        targetId: target.id,
        sourceNodeId: source.displaySourceNodeId || source.id,
        targetNodeId: target.displaySourceNodeId || target.id,
        sourceTitle: source.title,
        targetTitle: target.title,
        path,
        deleteX: deletePoint.x,
        deleteY: deletePoint.y,
        status: [
          source.status === "failed" || target.status === "failed" ? "failed" : source.status === "succeeded" ? "succeeded" : "pending",
          target.coordination?.mode === "review_gate" ? "review-gate" : "",
        ].filter(Boolean).join(" "),
      });
    }
  }
  return edges;
}

function sampleWorkflowCubicBezier(
  start: WorkflowCanvasPoint,
  firstControl: WorkflowCanvasPoint,
  secondControl: WorkflowCanvasPoint,
  end: WorkflowCanvasPoint,
  steps = 32,
) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    const remaining = 1 - progress;
    const startWeight = remaining ** 3;
    const firstControlWeight = 3 * remaining ** 2 * progress;
    const secondControlWeight = 3 * remaining * progress ** 2;
    const endWeight = progress ** 3;
    return {
      x: start.x * startWeight
        + firstControl.x * firstControlWeight
        + secondControl.x * secondControlWeight
        + end.x * endWeight,
      y: start.y * startWeight
        + firstControl.y * firstControlWeight
        + secondControl.y * secondControlWeight
        + end.y * endWeight,
    };
  });
}

function workflowPointAlongPolyline(
  points: WorkflowCanvasPoint[],
  fraction: number,
) {
  const fallback = points[0] || { x: 0, y: 0 };
  if (points.length < 2) return fallback;
  const segmentLengths = points.slice(1).map((point, index) => (
    Math.hypot(
      point.x - points[index].x,
      point.y - points[index].y,
    )
  ));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (totalLength <= 0) return fallback;
  const targetLength = totalLength * Math.min(1, Math.max(0, fraction));
  let traversedLength = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (traversedLength + segmentLength < targetLength) {
      traversedLength += segmentLength;
      continue;
    }
    const segmentProgress = segmentLength > 0
      ? (targetLength - traversedLength) / segmentLength
      : 0;
    return {
      x: points[index].x + (points[index + 1].x - points[index].x) * segmentProgress,
      y: points[index].y + (points[index + 1].y - points[index].y) * segmentProgress,
    };
  }
  return points.at(-1) || fallback;
}

function workflowDisplayDependencies(nodes: WorkflowCanvasNode[]) {
  const validIds = new Set(nodes.map((node) => node.id));
  const root = nodes.find((node) => node.kind === "root") || null;
  const bridge = root ? nodes.find((node) => node.id !== root.id) || null : null;
  const bridgeSourceId = bridge?.displaySourceNodeId || bridge?.id || null;
  const bridgeTarget = bridgeSourceId
    ? nodes.filter((node) => (node.displaySourceNodeId || node.id) === bridgeSourceId).at(-1) || bridge
    : null;
  const dependencies = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.id === root?.id) {
      dependencies.set(node.id, []);
      continue;
    }
    if (root && bridgeSourceId && (node.displaySourceNodeId || node.id) === bridgeSourceId) {
      dependencies.set(node.id, [root.id]);
      continue;
    }
    const nodeDependencies = (node.dependsOn || [])
      .filter((id) => validIds.has(id) && id !== node.id)
      .map((id) => root && bridgeTarget && id === root.id ? bridgeTarget.id : id);
    dependencies.set(node.id, [...new Set(nodeDependencies)]);
  }
  return reduceTransitiveDisplayDependencies(dependencies);
}

function reduceTransitiveDisplayDependencies(dependencies: Map<string, string[]>) {
  return new Map([...dependencies.entries()].map(([nodeId, nodeDependencies]) => [
    nodeId,
    nodeDependencies.filter((candidate) => !nodeDependencies.some((other) => (
      other !== candidate && isDisplayAncestor(candidate, other, dependencies)
    ))),
  ]));
}

function isDisplayAncestor(
  ancestorId: string,
  nodeId: string,
  dependencies: Map<string, string[]>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(nodeId)) return false;
  visited.add(nodeId);
  return (dependencies.get(nodeId) || []).some((dependencyId) => (
    dependencyId === ancestorId || isDisplayAncestor(ancestorId, dependencyId, dependencies, visited)
  ));
}

function workflowDisplayChildren(nodes: WorkflowCanvasNode[], dependencies: Map<string, string[]>) {
  const children = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const [nodeId, nodeDependencies] of dependencies) {
    for (const dependencyId of nodeDependencies) children.get(dependencyId)?.push(nodeId);
  }
  return children;
}

function sortLayoutGroup(
  group: WorkflowCanvasNode[],
  relations: Map<string, string[]>,
  positionByNodeId: Map<string, number>,
  originalOrder: Map<string, number>,
) {
  const blocksBySourceId = new Map<string, WorkflowCanvasNode[]>();
  for (const node of group) {
    const sourceId = node.displaySourceNodeId || node.id;
    const block = blocksBySourceId.get(sourceId) || [];
    block.push(node);
    blocksBySourceId.set(sourceId, block);
  }
  const blocks = [...blocksBySourceId.values()];
  blocks.sort((left, right) => {
    const leftPosition = blockRelationBarycenter(left, relations, positionByNodeId);
    const rightPosition = blockRelationBarycenter(right, relations, positionByNodeId);
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    return Math.min(...left.map((node) => originalOrder.get(node.id) || 0))
      - Math.min(...right.map((node) => originalOrder.get(node.id) || 0));
  });
  for (const block of blocks) {
    block.sort((left, right) => (
      (Number(left.displayExecutorChoice) || 1) - (Number(right.displayExecutorChoice) || 1)
      || (originalOrder.get(left.id) || 0) - (originalOrder.get(right.id) || 0)
    ));
  }
  group.splice(0, group.length, ...blocks.flat());
}

function blockRelationBarycenter(
  nodes: WorkflowCanvasNode[],
  relations: Map<string, string[]>,
  positionByNodeId: Map<string, number>,
) {
  const positions = nodes
    .map((node) => relationBarycenter(node.id, relations, positionByNodeId))
    .filter((position) => position !== Number.MAX_SAFE_INTEGER);
  return positions.length
    ? positions.reduce((sum, position) => sum + position, 0) / positions.length
    : Number.MAX_SAFE_INTEGER;
}

function relationBarycenter(nodeId: string, relations: Map<string, string[]>, positionByNodeId: Map<string, number>) {
  const positions = (relations.get(nodeId) || [])
    .map((id) => positionByNodeId.get(id))
    .filter((position): position is number => typeof position === "number");
  return positions.length
    ? positions.reduce((sum, position) => sum + position, 0) / positions.length
    : Number.MAX_SAFE_INTEGER;
}

function dialogSection(
  title: string,
  content: string,
  className = "",
  rawHtml = false,
  preformatted = false,
) {
  const body = preformatted
    ? `<pre>${displayHtml(content)}</pre>`
    : rawHtml
      ? content
      : `<p>${displayHtml(content)}</p>`;
  return `
    <section class="workflow-node-dialog-section ${attr(className)}">
      <h3>${displayHtml(title)}</h3>
      ${body}
    </section>
  `;
}

function renderArtifactList(artifacts: NonNullable<WorkflowExecutionResult["output"]>["artifacts"]) {
  return `<ul class="workflow-node-dialog-list">${(artifacts || []).map((artifact) => {
    const label = artifact.name || artifact.uri || "未命名交付文件";
    const meta = [artifact.type, artifact.uri && artifact.name ? artifact.uri : ""].filter(Boolean).join(" · ");
    return `<li><span>${displayHtml(label)}</span>${meta ? `<small>${displayHtml(meta)}</small>` : ""}</li>`;
  }).join("")}</ul>`;
}

function renderContextFiles(files: WorkflowContextManifestItem[]) {
  return `<ul class="workflow-node-dialog-list">${(files || []).map((file) => {
    const label = file.relativePath || file.path || "未命名上下文文件";
    const meta = [file.mime, typeof file.size === "number" ? formatFileSize(file.size) : ""].filter(Boolean).join(" · ");
    return `<li><span>${displayHtml(label)}</span>${meta ? `<small>${displayHtml(meta)}</small>` : ""}</li>`;
  }).join("")}</ul>`;
}

function renderExecutorAuthorization(node: WorkflowCanvasNode) {
  const request = node.capabilityRequest;
  const grant = node.capabilityGrant;
  const permissionProfile = grant?.permissionProfile || request?.permissionProfile || "read_only";
  const capabilities = grant?.capabilities || request?.capabilities || [];
  const actions = grant?.actions || request?.actions || [];
  const workspace = grant?.resources?.workspaceRoot || request?.resourceScope?.workspace || "";
  const metrics = [
    `类型：${workflowExecutorTypeLabel(node.executorType || "")}`,
    `权限档位：${workflowPermissionProfileLabel(permissionProfile)}`,
    `副作用策略：${workflowSideEffectPolicyLabel(grant?.sideEffectPolicy || request?.sideEffectPolicy || "none")}`,
    `转授权：${grant?.delegation?.allowed === true || request?.delegation === true ? "允许" : "禁止"}`,
  ];
  const details = [
    grant?.id ? `运行时授权：${grant.id}` : "运行时授权：等待 Haolo 按节点签发",
    grant?.issuedBy ? `签发方：${grant.issuedBy === "root-codex" ? "Haolo" : grant.issuedBy}` : "",
    grant?.taskId ? `执行任务：${grant.taskId}` : "",
    workspace ? `工作区范围：${workspace}` : "",
    capabilities.length ? `能力：${capabilities.join("、")}` : "",
    actions.length ? `动作：${actions.join("、")}` : "",
    grant?.resources?.network?.length ? `网络：${grant.resources.network.join("、")}` : "",
    grant?.resources?.applications?.length ? `应用：${grant.resources.applications.join("、")}` : "",
    grant?.resources?.allowImplicitGlobalContext === false ? "隐式全局上下文：禁止" : "",
    grant?.lease?.expiresAt ? `授权到期：${formatTimestamp(grant.lease.expiresAt)}` : "",
    grant?.rationale || request?.rationale || "",
  ].filter(Boolean);
  return [
    `<div class="workflow-node-dialog-metrics">${metrics.map((metric) => `<span>${displayHtml(metric)}</span>`).join("")}</div>`,
    `<ul class="workflow-node-dialog-list">${details.map((detail) => `<li><span>${displayHtml(detail)}</span></li>`).join("")}</ul>`,
  ].join("");
}

function renderChildWorkflow(node: WorkflowCanvasNode) {
  const steps = node.childWorkflow?.steps || [];
  if (!steps.length) {
    return `<div class="workflow-agent-steps-empty">${displayHtml(
      node.status === "pending" ? "节点开始后会在这里展开子 Agent 的实际执行步骤。" : "暂未收到可展示的执行步骤。",
    )}</div>`;
  }
  return `<ol class="workflow-agent-steps">${steps.map((step) => `
    <li class="${attr(step.status || "running")}">
      <i aria-hidden="true"></i>
      <span>
        <strong>${displayHtml(step.title || step.stage || "执行步骤")}</strong>
        ${step.detail ? `<small>${displayHtml(step.detail)}</small>` : ""}
      </span>
      <em>${displayHtml(workflowAgentStepStatusLabel(step.status || "running"))}</em>
    </li>
  `).join("")}</ol>`;
}

function renderAgentEffects(effects: NonNullable<WorkflowExecutionResult["effects"]>) {
  return `<ul class="workflow-node-dialog-list">${effects.map((effect) => {
    const title = effect.type === "commandExecution"
      ? "命令执行"
      : effect.type === "fileChange"
        ? "文件变更"
        : effect.type || "执行活动";
    const detail = [
      effect.summary,
      effect.paths?.length ? effect.paths.join("、") : "",
      typeof effect.exitCode === "number" ? `退出码 ${effect.exitCode}` : "",
    ].filter(Boolean).join(" · ");
    return `<li><span>${displayHtml(title)}</span>${detail ? `<small>${displayHtml(detail)}</small>` : ""}</li>`;
  }).join("")}</ul>`;
}

function renderLocalFileReview(
  node: WorkflowCanvasNode,
  contextPackage: WorkflowContextPackageSummary | null | undefined,
) {
  const review = node.localFileReview;
  const hasCapability = node.capabilityManifest?.capabilities?.some(
    (capability) => capability.id === "local.files.review",
  );
  if (!review && !hasCapability) return "";
  const status = review?.status || "available";
  const statusLabel = localFileReviewStatusLabel(status);
  const legacyGrant = review?.grant;
  const grant = node.capabilityGrant;
  const access = grant?.permissionProfile || legacyGrant?.access;
  const delegationAllowed = grant?.delegation?.allowed ?? legacyGrant?.delegation;
  const grantId = grant?.id || legacyGrant?.id;
  const grantIssuer = grant?.issuedBy || legacyGrant?.issuedBy;
  const grantRoot = grant?.resources?.workspaceRoot || legacyGrant?.scope?.root;
  const metrics = [
    `能力：${review?.capability || "local.files.review"}`,
    `状态：${statusLabel}`,
    access ? `访问：${workflowPermissionProfileLabel(access)}` : "",
    grant || legacyGrant ? `转授权：${delegationAllowed === false ? "禁止" : "未声明"}` : "",
    contextPackage ? `材料包：${contextPackage.manifest?.length || 0} 个文件` : "",
  ].filter(Boolean);
  const details = [
    review?.reason ? `启用依据：${localFileReviewReasonLabel(review.reason)}` : "",
    grantId ? `授权编号：${grantId}` : "",
    grantIssuer ? `签发方：${grantIssuer === "root-codex" ? "Haolo" : grantIssuer}` : "",
    grantRoot ? `范围根目录：${grantRoot}` : "",
    review?.error?.message ? `读取失败：${review.error.message}` : "",
  ].filter(Boolean);
  return [
    `<div class="workflow-node-dialog-metrics">${metrics.map((metric) => `<span>${displayHtml(metric)}</span>`).join("")}</div>`,
    details.length ? `<ul class="workflow-node-dialog-list">${details.map((detail) => `<li><span>${displayHtml(detail)}</span></li>`).join("")}</ul>` : "",
  ].join("");
}

function localFileReviewStatusLabel(status: string) {
  if (status === "available") return "可用，等待 Haolo 按节点判断";
  if (status === "preparing") return "正在组装本节点只读材料";
  if (status === "granted") return "已启用";
  if (status === "not_used") return "本节点未启用";
  if (status === "failed") return "材料读取失败";
  return status;
}

function localFileReviewReasonLabel(reason: string) {
  if (reason === "codex_subagent_direct_capability_grant") return "Haolo 子 Agent 通过主编排签发的节点授权直接访问";
  if (reason === "user_requested_all_model_nodes") return "用户明确要求全部模型节点审查本地文件";
  if (reason === "user_intent_and_planner_request") return "用户目标需要本地材料，且规划器声明本节点需要";
  if (reason === "user_intent_and_node_task") return "用户目标和本节点职责共同需要本地材料";
  if (reason === "node_runtime_explicit_local_task") return "本节点运行时任务明确引用本地材料";
  if (reason === "node_does_not_need_local_context") return "本节点职责不需要本地材料";
  if (reason === "no_local_context_evidence") return "未发现本节点需要本地材料的证据";
  return reason;
}

function workflowExecutorTypeLabel(value: string) {
  if (value === "codex_subagent") return "Haolo 子 Agent";
  if (value === "external_model") return "外部模型";
  return value || "未定义";
}

function workflowPermissionProfileLabel(value: string) {
  if (value === "read_only") return "只读";
  if (value === "workspace_write") return "当前工作区读写";
  if (value === "full_access") return "完整授权范围";
  return value;
}

function workflowSideEffectPolicyLabel(value: string) {
  if (value === "none") return "无副作用";
  if (value === "reversible") return "允许可补偿变更";
  if (value === "two_phase_commit") return "两阶段提交";
  return value;
}

function workflowAgentStepStatusLabel(value: string) {
  if (value === "succeeded" || value === "completed") return "完成";
  if (value === "failed") return "失败";
  return "执行中";
}

function renderExecutorHistory(history: NonNullable<WorkflowCanvasNode["executorHistory"]>) {
  return `<ul class="workflow-node-dialog-list">${history.map((entry) => {
    const choice = Math.max(1, Number(entry.executorChoice) || 1);
    const identity = [entry.model, entry.provider && entry.provider !== entry.model ? workflowProviderLabel(entry.provider) : ""]
      .filter(Boolean)
      .join(" · ");
    const outcome = entry.status === "succeeded" ? "成功" : "失败";
    const detail = [`第 ${choice} 选择`, `${Math.max(1, Number(entry.attempts) || 1)} 次尝试`, outcome, entry.error?.message || ""]
      .filter(Boolean)
      .join(" · ");
    return `<li><span>${displayHtml(identity || `候选模型 ${choice}`)}</span><small>${displayHtml(detail)}</small></li>`;
  }).join("")}</ul>`;
}

function workflowNodeCollaborationDetails(node: WorkflowCanvasNode, nodes: WorkflowCanvasNode[]) {
  if (node.coordination?.mode === "parallel_candidate") {
    const peers = nodes.filter((candidate) => (
      candidate.coordination?.mode === "parallel_candidate"
      && candidate.coordination.parallelGroup === node.coordination?.parallelGroup
    ));
    const peerNames = peers.map((candidate) => candidate.title).join("、");
    const candidateCount = new Set(peers.map((candidate) => candidate.displaySourceNodeId || candidate.id)).size;
    return `${parallelModelGroupLabel(candidateCount)}候选 · 组 ${node.coordination.parallelGroup || "未命名"}${peerNames ? ` · ${peerNames}` : ""}。${candidateCount} 路独立产出完成后，必须汇入独立审核节点。`;
  }
  if (node.coordination?.mode === "review_gate") {
    const targets = (node.coordination.reviewTargets || []).map((targetId) => (
      nodes.find((candidate) => candidate.id === targetId)?.title || targetId
    ));
    return `独立审核门 · 汇聚 ${targets.length || 2} 路候选${targets.length ? `（${targets.join("、")}）` : ""}。审核完成后才放行下游。`;
  }
  if (node.coordination?.mode === "parallel_rescue") {
    return `条件接替节点 · 仅因并行组“${node.coordination.parallelGroup || "未命名"}”的两个主节点都各自连续 3 次连接超时而动态派出；派出时两路主节点均已结束。`;
  }
  if (node.blockedByReviewGate) return "上游独立审核未形成可用结论，本节点已被审核门阻止。";
  return "";
}

function detailText(value: unknown, limit = 12000) {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value ?? "");
    }
  }
  const normalized = text.trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}\n…内容已截断` : normalized;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))} ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)} 秒`;
  return `${Math.floor(durationMs / 60000)} 分 ${Math.round(durationMs % 60000 / 1000)} 秒`;
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeId(value: string) {
  return String(value || "node").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function nodeStatusLabel(status: WorkflowNodeStatus, node?: WorkflowCanvasNode) {
  if (node?.statusLabel) return node.statusLabel;
  if (status === "running" && node?.retrying) {
    return `重连 ${Math.max(2, Number(node.attempt) || 2)}/${Math.max(3, Number(node.maxAttempts) || 3)}`;
  }
  if (status === "running" && Number(node?.executorChoice) > 1) {
    return `替补 ${Number(node?.executorChoice)}/${Math.max(Number(node?.executorChoice), Number(node?.maxExecutorChoices) || 3)}`;
  }
  return ({ pending: "等待", running: "执行中", succeeded: "完成", failed: "失败", skipped: "跳过", cancelled: "取消" } as const)[status] || status;
}

function nodeKindLabel(kind: string) {
  return ({ root: "haolo agent", context: "Context Broker", model: "Model", agent: "Agent Host", tool: "Tool", file: "本地文件" } as Record<string, string>)[kind] || kind;
}

function workflowNodeExecutorSubtitle(node: WorkflowCanvasNode) {
  if (node.executorType === "codex_subagent") {
    return `Haolo 子 Agent · ${node.model || "默认模型"}`;
  }
  if (node.executorType === "external_model") {
    return node.model || "外部模型";
  }
  return node.model || nodeKindLabel(node.kind);
}

function workflowProviderLabel(provider: string) {
  const normalized = String(provider || "").trim().toLowerCase();
  return normalized.includes("codex") ? "Haolo" : provider;
}

function providerGlyph(node: WorkflowCanvasNode) {
  if (node.kind === "root") return "H";
  if (node.kind === "context") return "⌁";
  if (node.kind === "file") return "文";
  return String(node.title || node.provider || "M").trim().slice(0, 1).toUpperCase();
}

function workflowNodeAvatarContent(
  node: WorkflowCanvasNode,
  logoUrl: string,
  logoKey: WorkflowNodeLogoKey = workflowNodeLogoKey(node),
) {
  if (node.kind === "file") {
    return `
      <svg class="workflow-file-node-icon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5.4 2.8h5.8l3.4 3.5v10.9H5.4z"></path>
        <path d="M11.2 2.8v3.6h3.4M7.8 10.2h4.4M7.8 13.2h3.3"></path>
      </svg>
    `;
  }
  const darkThemeClass = logoKey === "codex"
    ? ' class="dark-theme-white-agent-icon"'
    : "";
  return logoUrl
    ? `<img src="${attr(logoUrl)}"${darkThemeClass} alt="" aria-hidden="true" />`
    : displayHtml(providerGlyph(node));
}

export function workflowNodeLogoKey(node: WorkflowCanvasNode): WorkflowNodeLogoKey {
  if (node.kind === "root") return "haolo";
  if (node.executorType === "codex_subagent") return "haolo";
  return modelLogoKey(node.model) || modelLogoKey(node.provider) || "haolo";
}

function modelLogoKey(value: unknown): Exclude<WorkflowNodeLogoKey, "haolo"> | null {
  const identity = String(value ?? "").trim().toLowerCase();
  if (!identity) return null;
  const matches = (aliases: string[]) => aliases.some((alias) => (
    identity === alias || new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`).test(identity)
  ));
  if (matches(["gpt", "openai", "chatgpt", "codex"])) return "codex";
  if (matches(["claude", "anthropic", "sonnet", "fable"])) return "claude";
  if (matches(["kimi", "moonshot"])) return "kimi";
  if (matches(["deepseek"])) return "deepseek";
  if (matches(["gemini", "google"])) return "gemini";
  if (matches(["grok", "xai"])) return "grok";
  if (matches(["mimo", "xiaomi"])) return "mimo";
  if (matches(["perplexity", "sonar"])) return "perplexity";
  if (matches(["doubao", "volcengine", "bytedance"])) return "doubao";
  if (/^qwen(?:\d|[-._]|$)/.test(identity) || matches(["tongyi", "alibaba", "dashscope"])) return "qwen";
  return null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inputLabel(node: WorkflowCanvasNode) {
  if (node.kind === "root" && node.id.includes("plan")) return "目标";
  if (node.kind === "context") return "本地只读";
  if (node.kind === "file") return "本地只读";
  if (node.kind === "agent") return "授权执行";
  if (node.coordination?.mode === "parallel_candidate") return "并行候选";
  if (node.coordination?.mode === "parallel_rescue") return "双路超时接替";
  if (node.coordination?.mode === "review_gate") return `审核 ${(node.coordination.reviewTargets || []).length || 2} 路`;
  return `${(node.dependsOn || []).length} 输入`;
}

function outputLabel(node: WorkflowCanvasNode) {
  if (node.status === "pending") return "等待输出";
  if (node.status === "running") return node.kind === "agent" ? "操作中…" : "生成中…";
  return "无输出";
}

function shortText(value: string, limit: number) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function html(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

export function workflowDisplayText(value: unknown) {
  return String(value ?? "")
    .replace(/\b(?:haolo\s*\/\s*)?codex[_\s-]*subagent\b/gi, "Haolo 子 Agent")
    .replace(/根\s*codex\b/gi, "Haolo")
    .replace(/\broot\s+codex\b/gi, "Haolo")
    .replace(/\bcodex\b/gi, "Haolo")
    .replace(/根\s*Haolo\b/g, "Haolo")
    .replace(/\bHaolo\s*\/\s*Haolo\b/gi, "Haolo");
}

function displayHtml(value: unknown) {
  return html(workflowDisplayText(value));
}

function attr(value: unknown) {
  return html(value).replace(/`/g, "&#96;");
}
