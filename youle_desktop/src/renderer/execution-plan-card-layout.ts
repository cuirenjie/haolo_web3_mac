// Measure the production plan grid so notes follow the current window and
// application text size even when the user creates them from the chat page.
export function executionPlanStickyLayout(host: HTMLElement | null) {
  if (!host) return { cardWidth: 248, fontSize: 12, baseFontSize: 12 };
  const sidebar = host.querySelector<HTMLElement>(":scope > .chat-list");
  const pageWidth = host.clientWidth - (sidebar?.getBoundingClientRect().width || 0);
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, {
    position: "fixed", left: "-10000px", top: "0",
    width: `${pageWidth}px`, visibility: "hidden", pointerEvents: "none",
  });
  probe.innerHTML = '<section class="execution-plan-list"><article class="execution-plan-card execution-plan-surface"></article></section>';
  host.append(probe);
  try {
    const card = probe.querySelector<HTMLElement>(".execution-plan-card")!;
    // Resolve calc() and the application's font-size offset through CSS.
    const label = document.createElement("span");
    label.className = "execution-plan-card-label";
    card.append(label);
    const fontSize = parseFloat(getComputedStyle(label).fontSize) || 12;
    return { cardWidth: card.getBoundingClientRect().width, fontSize, baseFontSize: fontSize };
  } finally {
    probe.remove();
  }
}
