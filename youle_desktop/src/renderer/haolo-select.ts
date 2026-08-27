export type HaoloSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type HaoloSelectConfig = {
  id: string;
  value: string;
  options: HaoloSelectOption[];
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  inputAttributes?: Record<string, string | boolean>;
  translateLabels?: boolean;
};

export function renderHaoloSelect(config: HaoloSelectConfig) {
  const selected = config.options.find(
    (option) => option.value === config.value,
  ) ||
    config.options.find((option) => !option.disabled) ||
    config.options[0] || { value: config.value, label: config.value };
  const className = [
    "haolo-select",
    config.className,
    config.disabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inputAttributes = Object.entries(config.inputAttributes || {})
    .map(([name, value]) => value === false
      ? ""
      : value === true
        ? escapeAttr(name)
        : `${escapeAttr(name)}="${escapeAttr(value)}"`)
    .filter(Boolean)
    .join(" ");
  const triggerId = `${config.id}-trigger`;
  const menuId = `${config.id}-menu`;
  const labelId = `${config.id}-label`;
  const valueId = `${config.id}-value`;
  const labelAttributes = config.translateLabels === false ? ' data-i18n-skip translate="no"' : "";

  return `
    <span class="${className}" data-haolo-select>
      <input type="hidden" value="${escapeAttr(selected.value)}" ${inputAttributes} />
      <span id="${escapeAttr(labelId)}" class="haolo-select-sr-label">${escapeHtml(config.ariaLabel)}</span>
      <button
        type="button"
        id="${escapeAttr(triggerId)}"
        class="haolo-select-trigger"
        data-haolo-select-trigger
        aria-labelledby="${escapeAttr(labelId)} ${escapeAttr(valueId)}"
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-controls="${escapeAttr(menuId)}"
        ${config.disabled ? "disabled" : ""}
      >
        <span id="${escapeAttr(valueId)}" data-haolo-select-label${labelAttributes}>${escapeHtml(selected.label)}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <span
        id="${escapeAttr(menuId)}"
        class="haolo-select-menu"
        data-haolo-select-menu
        role="listbox"
        aria-labelledby="${escapeAttr(labelId)}"
        hidden
      >
        ${config.options
          .map((option) => {
            const isSelected = option.value === selected.value;
            return `
            <button
              type="button"
              class="haolo-select-option ${isSelected ? "selected" : ""}"
              data-haolo-select-value="${escapeAttr(option.value)}"
              data-haolo-select-option-label="${escapeAttr(option.label)}"${labelAttributes}
              role="option"
              aria-selected="${isSelected ? "true" : "false"}"
              tabindex="-1"
              ${option.disabled ? "disabled" : ""}
            >${escapeHtml(option.label)}</button>
          `;
          })
          .join("")}
      </span>
    </span>
  `;
}

export function bindHaoloSelects(scope: HTMLElement) {
  const pickers = [
    ...scope.querySelectorAll<HTMLElement>("[data-haolo-select]"),
  ];
  if (!pickers.length) return;

  const triggerFor = (picker: HTMLElement) =>
    picker.querySelector<HTMLButtonElement>("[data-haolo-select-trigger]");
  const menuFor = (picker: HTMLElement) =>
    picker.querySelector<HTMLElement>("[data-haolo-select-menu]");
  const allOptionsFor = (picker: HTMLElement) => [
    ...picker.querySelectorAll<HTMLButtonElement>("[data-haolo-select-value]"),
  ];
  const optionsFor = (picker: HTMLElement) => [
    ...picker.querySelectorAll<HTMLButtonElement>(
      "[data-haolo-select-value]:not(:disabled)",
    ),
  ];
  const closePicker = (picker: HTMLElement, restoreFocus = false) => {
    const trigger = triggerFor(picker);
    const menu = menuFor(picker);
    picker.classList.remove("open", "opens-above");
    trigger?.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
    if (restoreFocus) trigger?.focus();
  };
  const closeAll = (except: HTMLElement | null = null) => {
    pickers.forEach((picker) => {
      if (picker !== except) closePicker(picker);
    });
  };
  const focusOption = (
    picker: HTMLElement,
    target: "first" | "last" | "selected",
  ) => {
    const options = optionsFor(picker);
    const option =
      target === "first"
        ? options[0]
        : target === "last"
          ? options.at(-1)
          : options.find(
              (candidate) => candidate.getAttribute("aria-selected") === "true",
            ) || options[0];
    option?.focus();
  };
  const openPicker = (
    picker: HTMLElement,
    focusTarget?: "first" | "last" | "selected",
  ) => {
    const trigger = triggerFor(picker);
    const menu = menuFor(picker);
    if (!trigger || !menu || trigger.disabled) return;
    closeAll(picker);
    picker.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    menu.hidden = false;

    const triggerRect = trigger.getBoundingClientRect();
    const menuHeight = menu.getBoundingClientRect().height;
    let topEdge = 0;
    let bottomEdge = window.innerHeight;
    let ancestor = picker.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) {
        const boundary = ancestor.getBoundingClientRect();
        topEdge = Math.max(topEdge, boundary.top);
        bottomEdge = Math.min(bottomEdge, boundary.bottom);
      }
      ancestor = ancestor.parentElement;
    }
    const spaceAbove = triggerRect.top - topEdge;
    const spaceBelow = bottomEdge - triggerRect.bottom;
    picker.classList.toggle(
      "opens-above",
      spaceBelow < menuHeight + 6 && spaceAbove > spaceBelow,
    );

    if (focusTarget)
      window.requestAnimationFrame(() => {
        if (picker.isConnected) focusOption(picker, focusTarget);
      });
  };
  const selectOption = (picker: HTMLElement, option: HTMLButtonElement) => {
    const input = picker.querySelector<HTMLInputElement>(
      'input[type="hidden"]',
    );
    const label = picker.querySelector<HTMLElement>(
      "[data-haolo-select-label]",
    );
    const value = option.dataset.haoloSelectValue;
    if (!input || value === undefined || option.disabled) return;

    const optionLabel =
      option.dataset.haoloSelectOptionLabel ||
      option.textContent?.trim() ||
      value;
    input.value = value;
    if (label) label.textContent = optionLabel;
    allOptionsFor(picker).forEach((candidate) => {
      const selected = candidate === option;
      candidate.classList.toggle("selected", selected);
      candidate.setAttribute("aria-selected", selected ? "true" : "false");
    });
    closePicker(picker, true);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  pickers.forEach((picker) => {
    const trigger = triggerFor(picker);
    const menu = menuFor(picker);
    if (!trigger || !menu) return;

    trigger.addEventListener("click", () => {
      if (picker.classList.contains("open")) closePicker(picker);
      else openPicker(picker);
    });
    trigger.addEventListener("keydown", (event) => {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Home" ||
        event.key === "End"
      ) {
        event.preventDefault();
        const target =
          event.key === "ArrowUp" || event.key === "End"
            ? "last"
            : event.key === "Home"
              ? "first"
              : "selected";
        openPicker(picker, target);
      } else if (event.key === "Escape" && picker.classList.contains("open")) {
        event.preventDefault();
        closePicker(picker);
      }
    });
    menu.addEventListener("mousedown", (event) => {
      const option = (
        event.target as Element | null
      )?.closest<HTMLButtonElement>("[data-haolo-select-value]");
      if (!option || option.disabled || !picker.contains(option)) return;
      // Keep focus on the trigger until the ensuing click selects the option.
      // Otherwise Chromium can focus <body> for tabindex=-1 options, causing
      // focusout to hide the menu between mouse down and mouse up.
      event.preventDefault();
    });
    menu.addEventListener("click", (event) => {
      const option = (
        event.target as Element | null
      )?.closest<HTMLButtonElement>("[data-haolo-select-value]");
      if (option && picker.contains(option)) selectOption(picker, option);
    });
    menu.addEventListener("keydown", (event) => {
      const options = optionsFor(picker);
      const active = (
        event.target as Element | null
      )?.closest<HTMLButtonElement>("[data-haolo-select-value]");
      const index = active ? options.indexOf(active) : -1;
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker(picker, true);
      } else if (event.key === "Tab") {
        closePicker(picker);
      } else if (event.key === "Enter" || event.key === " ") {
        if (!active) return;
        event.preventDefault();
        selectOption(picker, active);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : event.key === "ArrowDown"
                ? (index + 1 + options.length) % options.length
                : (index - 1 + options.length) % options.length;
        options[nextIndex]?.focus();
      }
    });
    picker.addEventListener("focusout", () => {
      queueMicrotask(() => {
        if (picker.isConnected && !picker.contains(document.activeElement))
          closePicker(picker);
      });
    });
  });

  scope.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-haolo-select]"))
      closeAll();
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: unknown) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
