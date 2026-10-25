import { newsArticleUrl } from './news-feed.mjs';

export function createNewsWindows({ BrowserWindow, screen, html, theme, language, openExternal, dismiss }) {
  const windows = new Map();
  let shuttingDown = false;
  function layout() {
    const area = screen.getPrimaryDisplay().workArea;
    [...windows.values()].forEach((window, index) => {
      if (!window.isDestroyed()) window.setPosition(Math.round(area.x + area.width - 408), Math.round(area.y + area.height - 256 - index * 244));
    });
  }
  function update(items) {
    if (shuttingDown) return;
    for (const [id, window] of windows) if (!items.some(item => item.id === id)) { windows.delete(id); if (!window.isDestroyed()) window.close(); }
    const capacity = Math.max(1, Math.min(3, Math.floor((screen.getPrimaryDisplay().workArea.height - 20) / 244)));
    for (const item of items.slice(0, capacity)) {
      if (windows.has(item.id)) continue;
      const window = new BrowserWindow({ width: 392, height: 236, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      windows.set(item.id, window);
      const finish = () => { try { dismiss(item.id); } catch { /* Keep visible if the durable dismissal could not be written. */ } };
      window.removeMenu(); window.setAlwaysOnTop(true, 'screen-saver');
      if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      void window.loadURL(`data:text/html;base64,${Buffer.from(html({ title: item.title, body: item.summary, theme: theme(), language: language(), news: true })).toString('base64')}`).catch(() => { if (!window.isDestroyed()) window.close(); });
      window.once('ready-to-show', () => { if (!window.isDestroyed() && !shuttingDown) window.showInactive(); });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
        if (url === 'youle-notification://open') void openExternal(newsArticleUrl(item.articleId, language())).then(finish).catch(() => {});
        if (url === 'youle-notification://close') finish();
      });
      window.webContents.on('before-input-event', (_event, input) => { if (input.key === 'Escape') finish(); });
      window.on('closed', () => { windows.delete(item.id); layout(); });
    }
    layout();
  }
  screen.on('display-metrics-changed', layout);
  return { update, stop() { shuttingDown = true; screen.removeListener('display-metrics-changed', layout); for (const window of windows.values()) if (!window.isDestroyed()) window.close(); windows.clear(); } };
}
