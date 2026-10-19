import { translateDrawingText, type AppLanguage } from './app-language.mjs';

const pendingCaptures = new WeakSet<HTMLElement>();
const toastTimers = new WeakMap<HTMLElement, number>();

function showScreenshotNotice(workspace: HTMLElement, message: string) {
  let notice = workspace.querySelector<HTMLElement>('[data-chart-screenshot-notice]');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'trading-chart-screenshot-notice';
    notice.dataset.chartScreenshotNotice = '';
    notice.setAttribute('data-i18n-drawing', '');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    workspace.append(notice);
  }
  window.clearTimeout(toastTimers.get(workspace));
  notice.textContent = translateDrawingText(message, (document.documentElement.dataset.language || 'zh-CN') as AppLanguage);
  notice.hidden = false;
  toastTimers.set(workspace, window.setTimeout(() => { notice.hidden = true; }, 4000));
}

export async function captureTradingChartToDesktop(toolbar: HTMLElement) {
  const workspace = toolbar.closest<HTMLElement>('[data-trading-market-workspace]');
  const content = workspace?.querySelector<HTMLElement>('.trading-market-content');
  if (!workspace || !content || pendingCaptures.has(workspace)) return;
  const button = toolbar.querySelector<HTMLButtonElement>('[data-drawing-action="screenshot"]');
  const previousNotice = workspace.querySelector<HTMLElement>('[data-chart-screenshot-notice]');
  if (previousNotice) previousNotice.hidden = true;
  pendingCaptures.add(workspace);
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  content.classList.add('trading-chart-capturing');
  try {
    if (!window.codexDesktop?.captureTradingChart) throw new Error('当前版本暂不支持图表截图');
    // Capture the composed chart, including canvas panes, SVG drawings and DOM
    // labels. Wait for transient drawing controls to disappear before capture.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const bounds = content.getBoundingClientRect();
    if (!content.isConnected || bounds.width <= 0 || bounds.height <= 0) throw new Error('交易图表截图区域无效');
    const result = await window.codexDesktop.captureTradingChart({
      destination: 'desktop',
      rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    });
    if (!result?.ok) throw new Error(result?.message || '图表截图失败，请重试');
    showScreenshotNotice(workspace, result.copied === true
      ? '截图已经保存在桌面'
      : '截图已经保存在桌面，但复制到剪贴板失败，请重试');
  } catch (error) {
    console.warn('Trading chart screenshot failed', error);
    showScreenshotNotice(workspace, '图表截图失败，请重试');
  } finally {
    content.classList.remove('trading-chart-capturing');
    pendingCaptures.delete(workspace);
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}
