import { app, BrowserWindow } from 'electron/main';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.tmp', 'watchlist-english-20261016');
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
async function main() {
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false, root: path.join(root, 'src/renderer'),
  server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root] } },
});
await server.listen();
await app.whenReady();
const window = new BrowserWindow({ show: false, width: 1440, height: 960,
  webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true } });
const js = source => window.webContents.executeJavaScript(source, true);
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const records = [];
let exitCode = 0;
try {
  const url = `${server.resolvedUrls.local[0]}@fs/${path.join(root, 'test/fixtures/trading-watchlist.html').replaceAll('\\', '/')}`;
  console.log('Loading watchlist fixture');
  await Promise.race([window.loadURL(url), new Promise((_, reject) => setTimeout(() => reject(Error('Fixture load timed out')), 30000))]);
  console.log('Waiting for watchlist fixture');
  for (let i = 0; i < 200 && !await js('window.ready === true'); i++) await pause();
  if (!await js('window.ready === true')) throw Error('Watchlist fixture did not initialize');
  console.log('Watchlist fixture ready');
  await js(`document.querySelector('.qa-titlebar').outerHTML = '<header class="app-titlebar"><button class="titlebar-profile"><span class="titlebar-profile-name">Alexandria</span></button><nav class="titlebar-primary-actions"><div class="titlebar-channel-action"><button class="titlebar-primary-action titlebar-channel-trigger"><span class="titlebar-channel-label">连手机</span></button></div></nav><div class="titlebar-drag-region"><div class="titlebar-market-favorites-host" data-titlebar-market-favorites-host></div></div><div class="window-controls"><button class="window-control">−</button><button class="window-control">□</button><button class="window-control">×</button></div></header>'; workspace.syncTitlebarFavoriteTickerHost(); workspace.watchlist.addMarkets(qaMarkets); workspace.watchlistPanel.refresh(); qaSetLanguage('en');`);
  for (const width of [1000, 1440, 1920]) {
    console.log(`Auditing workspace width ${width}`);
    window.setContentSize(width, 900);
    for (const panelWidth of [280, 330, 420]) {
      for (const theme of ['light', 'dark']) {
        for (const font of ['default', 'large']) {
          await js(`layout.style.setProperty('--trading-expert-panel-width','${panelWidth}px');document.documentElement.dataset.theme='${theme}';document.documentElement.dataset.fontSize='${font}';`);
          for (const group of ['watchlist', 'tradfi', 'indices']) {
            await js(`document.querySelector('[data-group-id="${group}"]').click()`);
            await pause();
            const result = await js(`(${inspect.toString()})()`);
            records.push({ width, panelWidth, theme, font, group, ...result });
            if (width === 1440 && panelWidth === 330 && font === 'large') {
              await writeFile(path.join(output, `${theme}-${group}.png`), (await window.webContents.capturePage()).toPNG());
            }
          }
        }
      }
    }
  }
  await js(`document.querySelector('[data-group-id="watchlist"]').click(); document.querySelector('[data-watchlist-action="new-group"]').click()`);
  await pause();
  records.push({ name: 'new-group-dialog', ...await js(`(${inspect.toString()})()`) });
  await js(`document.querySelector('[data-watchlist-close]').click(); document.querySelector('[data-group-id="indices"]').click()`);
  await pause();
  await js(`document.querySelector('[data-watchlist-action="index-detail"]').click()`);
  await pause();
  records.push({ name: 'index-history-dialog', ...await js(`(${inspect.toString()})()`) });
  const failures = records.filter(record => record.issues.length);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ records, failures }, null, 2));
  console.log(JSON.stringify({ states: records.length, failures: failures.length, output }));
  if (failures.length) { console.log(JSON.stringify(failures.slice(0, 6), null, 2)); exitCode = 1; }
} catch (error) { console.error(error); exitCode = 1; }
finally { window.destroy(); await server.close(); app.exit(exitCode); }
}
void main().catch(error => { console.error(error); app.exit(1); });

function inspect() {
  const issues = [];
  const sections = [...document.querySelectorAll('.app-titlebar,.trading-watchlist-tabs,.trading-watchlist-head,.trading-watchlist-row,.trading-watchlist-dialog[open]')];
  const visible = element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  for (const section of sections) {
    if (!visible(section)) continue;
    const texts = [];
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent.trim();
      if (!text || !visible(parent)) continue;
      if (/\p{Script=Han}/u.test(text) && !parent.closest('[data-i18n-skip]')) issues.push(`Chinese residue: ${text}`);
      const range = document.createRange(); range.selectNodeContents(node);
      const style = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      for (const rect of range.getClientRects()) {
        // Ellipsis clips an intentionally shortened name to its own column.
        const clipped = style.overflow === 'hidden' || style.textOverflow === 'ellipsis';
        const r = { left: Math.max(rect.left, clipped ? box.left : rect.left), right: Math.min(rect.right, clipped ? box.right : rect.right), top: rect.top, bottom: rect.bottom };
        if (r.right > r.left) texts.push({ node, text, ...r });
      }
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      // Chromium can expose both the full run and the ellipsis fragment for
      // one text node. Only distinct labels can collide with each other.
      if (a.node === b.node) continue;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push(`Text overlap: ${a.text} / ${b.text}`);
    }
    if (section.scrollWidth > section.clientWidth + 2) issues.push(`Overflow: ${section.className}`);
  }
  const channel = document.querySelector('.titlebar-primary-actions').getBoundingClientRect();
  const rail = document.querySelector('.titlebar-market-favorites-host').getBoundingClientRect();
  if (channel.right > rail.left + 1) issues.push('Phone action overlaps ticker rail');
  for (const overview of document.querySelectorAll('.trading-market-overview')) {
    if (!visible(overview)) continue;
    const box = overview.getBoundingClientRect();
    const right = box.right - parseFloat(getComputedStyle(overview).paddingRight);
    const children = [...overview.children].filter(visible).filter(child => getComputedStyle(child).position !== 'absolute');
    for (const child of children) {
      const bounds = child.getBoundingClientRect();
      if (bounds.right > right + 1) issues.push(`Chart toolbar escapes its reserved area: ${child.className}`);
    }
    for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
      const a = children[i].getBoundingClientRect(), b = children[j].getBoundingClientRect();
      if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) issues.push('Chart toolbar controls overlap');
    }
  }
  return { issues: [...new Set(issues)] };
}
