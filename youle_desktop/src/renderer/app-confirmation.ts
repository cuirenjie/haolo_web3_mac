export type AppConfirmationTone = "primary" | "danger";

export type AppConfirmationOptions = {
  title: string;
  message: string;
  detail?: string | null;
  confirmLabel?: string;
  cancelLabel?: string | null;
  tone?: AppConfirmationTone;
};

type QueuedConfirmation = {
  options: AppConfirmationOptions;
  items?: AppConfirmationItem[];
  resolve: (result: { confirmed: boolean; selectedIds: string[] }) => void;
};

export type AppConfirmationItem = { id: string; label: string };

const confirmationQueue: QueuedConfirmation[] = [];
let confirmationActive = false;

export async function confirmInApp(options: AppConfirmationOptions): Promise<boolean> {
  return (await enqueueConfirmation(options)).confirmed;
}

export async function confirmSelectionInApp(
  options: AppConfirmationOptions,
  items: AppConfirmationItem[],
): Promise<string[] | null> {
  const result = await enqueueConfirmation(options, items);
  return result.confirmed ? result.selectedIds : null;
}

function enqueueConfirmation(options: AppConfirmationOptions, items?: AppConfirmationItem[]) {
  return new Promise<{ confirmed: boolean; selectedIds: string[] }>((resolve) => {
    confirmationQueue.push({ options, items: items?.map((item) => ({ ...item })), resolve });
    showNextConfirmation();
  });
}

function showNextConfirmation() {
  if (confirmationActive) return;
  const request = confirmationQueue.shift();
  if (!request) return;
  confirmationActive = true;

  const options = normalizeConfirmationOptions(request.options);
  const previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const appRoot = document.querySelector<HTMLElement>("#app");
  const wasInert = appRoot?.inert ?? false;
  if (appRoot) appRoot.inert = true;

  const host = document.createElement("div");
  host.className = "app-confirmation-host";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop app-confirmation-backdrop";
  backdrop.dataset.appConfirmationAction = "cancel";

  const dialog = document.createElement("dialog");
  dialog.className = "thread-delete-dialog app-confirmation-dialog";
  dialog.open = true;
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;

  const titleId = `app-confirmation-title-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const messageId = `${titleId}-message`;
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-describedby", messageId);

  const section = document.createElement("section");
  const title = document.createElement("h2");
  title.id = titleId;
  title.textContent = options.title;
  const message = document.createElement("p");
  message.id = messageId;
  message.className = "app-confirmation-message";
  message.textContent = options.message;
  section.append(title, message);

  if (options.detail) {
    const detail = document.createElement("p");
    detail.className = "app-confirmation-detail";
    detail.textContent = options.detail;
    section.append(detail);
  }

  const footer = document.createElement("footer");
  let cancelButton: HTMLButtonElement | null = null;
  if (options.cancelLabel) {
    cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "thread-dialog-secondary";
    cancelButton.dataset.appConfirmationAction = "cancel";
    cancelButton.textContent = options.cancelLabel;
    footer.append(cancelButton);
  }

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = options.tone === "danger"
    ? "thread-dialog-danger"
    : "thread-dialog-primary";
  confirmButton.dataset.appConfirmationAction = "confirm";
  confirmButton.textContent = options.confirmLabel;
  footer.append(confirmButton);
  if (!cancelButton) footer.classList.add("single-action");

  const selectedIds = new Set<string>();
  if (request.items) {
    const items = request.items;
    dialog.classList.add("app-selection-confirmation-dialog");
    const summary = document.createElement("p");
    summary.className = "app-confirmation-selection-summary";
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    summary.setAttribute("aria-atomic", "true");
    const list = document.createElement("div");
    list.className = "app-confirmation-selection-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-labelledby", messageId);
    const updateSelection = () => {
      summary.textContent = `已选择：${selectedIds.size} / ${items.length}`;
      confirmButton.disabled = selectedIds.size === 0;
    };
    for (const item of items) {
      const row = document.createElement("label");
      row.className = "app-confirmation-selection-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = item.id;
      checkbox.className = "app-confirmation-selection-checkbox";
      const label = document.createElement("span");
      label.className = "app-confirmation-selection-label";
      label.setAttribute("data-i18n-skip", "");
      label.textContent = item.label;
      label.title = item.label;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedIds.add(item.id);
        else selectedIds.delete(item.id);
        updateSelection();
      });
      row.append(checkbox, label);
      list.append(row);
    }
    updateSelection();
    section.append(summary, list);
  }

  section.append(footer);
  dialog.append(section);
  host.append(backdrop, dialog);
  document.body.append(host);

  let settled = false;
  const finish = (confirmed: boolean) => {
    if (settled || (confirmed && confirmButton.disabled)) return;
    settled = true;
    document.removeEventListener("keydown", onKeyDown, true);
    host.remove();
    if (appRoot) appRoot.inert = wasInert;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    request.resolve({ confirmed, selectedIds: confirmed ? [...selectedIds] : [] });
    confirmationActive = false;
    showNextConfirmation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && options.cancelLabel) {
      event.preventDefault();
      finish(false);
      return;
    }
    if (event.key === "Enter" && event.target === dialog) {
      event.preventDefault();
      finish(true);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
      event.preventDefault();
      first.focus();
    }
  };

  host.addEventListener("click", (event) => {
    const action = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-app-confirmation-action]")?.dataset.appConfirmationAction
      : null;
    if (action === "confirm") finish(true);
    else if (action === "cancel" && options.cancelLabel) finish(false);
  });
  document.addEventListener("keydown", onKeyDown, true);
  window.requestAnimationFrame(() => {
    if (!settled) (cancelButton || dialog.querySelector<HTMLElement>("input:not(:disabled)") || confirmButton).focus({ preventScroll: true });
  });
}

function normalizeConfirmationOptions(options: AppConfirmationOptions) {
  return {
    title: String(options.title || "请确认").trim() || "请确认",
    message: String(options.message || "").trim(),
    detail: String(options.detail || "").trim(),
    confirmLabel: String(options.confirmLabel || "确定").trim() || "确定",
    cancelLabel: options.cancelLabel === null
      ? null
      : String(options.cancelLabel || "取消").trim() || "取消",
    tone: options.tone === "danger" ? "danger" as const : "primary" as const,
  };
}
