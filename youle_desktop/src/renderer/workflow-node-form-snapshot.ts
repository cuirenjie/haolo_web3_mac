export const WORKFLOW_NODE_PROMPT_FIELD_NAMES = [
  "inputDefinition",
  "taskDefinition",
  "outputDefinition",
] as const;

export type WorkflowNodePromptFieldName =
  (typeof WORKFLOW_NODE_PROMPT_FIELD_NAMES)[number];

export type WorkflowNodeFormSnapshot = {
  threadId: string;
  nodeId: string;
  inputDefinition: string;
  taskDefinition: string;
  outputDefinition: string;
  executor: string;
  dialogScrollTop: number;
  focus: {
    fieldName: WorkflowNodePromptFieldName;
    selectionStart: number;
    selectionEnd: number;
    scrollTop: number;
  } | null;
};

type WorkflowNodeValueControl = {
  value: string;
  defaultValue?: string;
  options?: ArrayLike<{
    value: string;
    defaultSelected?: boolean;
  }>;
  disabled?: boolean;
  readOnly?: boolean;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  scrollTop?: number;
  focus?: (options?: FocusOptions) => void;
  setSelectionRange?: (start: number, end: number) => void;
};

function workflowNodeControlInitialValue(
  control: WorkflowNodeValueControl,
) {
  const options = control.options ? Array.from(control.options) : [];
  if (options.length) {
    return (
      options.find((option) => option.defaultSelected)?.value
      ?? options[0]?.value
      ?? ""
    );
  }
  return typeof control.defaultValue === "string"
    ? control.defaultValue
    : control.value;
}

function workflowNodeNamedControl(
  form: HTMLFormElement,
  name: string,
): WorkflowNodeValueControl | null {
  const control = form.elements.namedItem(name) as
    | (WorkflowNodeValueControl & Element)
    | null;
  return control && typeof control.value === "string" ? control : null;
}

function workflowNodeFormIdentity(form: HTMLFormElement) {
  return {
    threadId: String(form.dataset.workflowThreadId || "").trim(),
    nodeId: String(form.dataset.workflowNodeId || "").trim(),
  };
}

function workflowNodeFormMatchesSnapshot(
  form: HTMLFormElement,
  snapshot: WorkflowNodeFormSnapshot,
) {
  const identity = workflowNodeFormIdentity(form);
  return (
    Boolean(identity.threadId && identity.nodeId) &&
    identity.threadId === snapshot.threadId &&
    identity.nodeId === snapshot.nodeId
  );
}

export function captureWorkflowNodeFormSnapshot(
  form: HTMLFormElement | null,
): WorkflowNodeFormSnapshot | null {
  if (!form) return null;
  const identity = workflowNodeFormIdentity(form);
  if (!identity.threadId || !identity.nodeId) return null;

  const promptControls = Object.fromEntries(
    WORKFLOW_NODE_PROMPT_FIELD_NAMES.map((name) => [
      name,
      workflowNodeNamedControl(form, name),
    ]),
  ) as Record<WorkflowNodePromptFieldName, WorkflowNodeValueControl | null>;
  const activeElement = form.ownerDocument?.activeElement || null;
  const focusedFieldName = WORKFLOW_NODE_PROMPT_FIELD_NAMES.find(
    (name) => promptControls[name] === activeElement,
  );
  const focusedControl = focusedFieldName
    ? promptControls[focusedFieldName]
    : null;
  const executor = workflowNodeNamedControl(form, "executor");
  const dialogBody = form.querySelector<HTMLElement>(
    ".workflow-node-dialog-body",
  );

  return {
    ...identity,
    inputDefinition: promptControls.inputDefinition?.value || "",
    taskDefinition: promptControls.taskDefinition?.value || "",
    outputDefinition: promptControls.outputDefinition?.value || "",
    executor: executor?.value || "",
    dialogScrollTop: dialogBody?.scrollTop || 0,
    focus:
      focusedFieldName && focusedControl
        ? {
            fieldName: focusedFieldName,
            selectionStart:
              focusedControl.selectionStart ?? focusedControl.value.length,
            selectionEnd:
              focusedControl.selectionEnd ?? focusedControl.value.length,
            scrollTop: focusedControl.scrollTop || 0,
          }
        : null,
  };
}

export function workflowNodeFormMatchesInitialValues(
  form: HTMLFormElement | null,
) {
  if (!form) return false;
  for (const name of WORKFLOW_NODE_PROMPT_FIELD_NAMES) {
    const control = workflowNodeNamedControl(form, name);
    if (
      !control
      || control.value !== workflowNodeControlInitialValue(control)
    ) {
      return false;
    }
  }
  const executor = workflowNodeNamedControl(form, "executor");
  return (
    !executor
    || executor.value === workflowNodeControlInitialValue(executor)
  );
}

export function restoreWorkflowNodeFormSnapshot(
  form: HTMLFormElement | null,
  snapshot: WorkflowNodeFormSnapshot | null,
) {
  if (!form || !snapshot || !workflowNodeFormMatchesSnapshot(form, snapshot)) {
    return false;
  }

  for (const name of WORKFLOW_NODE_PROMPT_FIELD_NAMES) {
    const control = workflowNodeNamedControl(form, name);
    if (control && !control.readOnly) control.value = snapshot[name];
  }
  const executor = workflowNodeNamedControl(form, "executor");
  if (executor && snapshot.executor) executor.value = snapshot.executor;
  const dialogBody = form.querySelector<HTMLElement>(
    ".workflow-node-dialog-body",
  );
  if (dialogBody) dialogBody.scrollTop = snapshot.dialogScrollTop;
  return true;
}

export function restoreWorkflowNodeFormFocus(
  form: HTMLFormElement | null,
  snapshot: WorkflowNodeFormSnapshot | null,
) {
  if (
    !form ||
    !snapshot?.focus ||
    !workflowNodeFormMatchesSnapshot(form, snapshot)
  ) {
    return false;
  }
  const control = workflowNodeNamedControl(form, snapshot.focus.fieldName);
  if (!control || control.disabled || control.readOnly || !control.focus) {
    return false;
  }

  const valueLength = control.value.length;
  const selectionStart = Math.min(snapshot.focus.selectionStart, valueLength);
  const selectionEnd = Math.min(snapshot.focus.selectionEnd, valueLength);
  control.focus({ preventScroll: true });
  control.setSelectionRange?.(selectionStart, selectionEnd);
  control.scrollTop = snapshot.focus.scrollTop;
  return true;
}
