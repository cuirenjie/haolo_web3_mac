import { app, BrowserWindow } from "electron/main";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".tmp", "trading-market-picker-qa");
app.setPath("userData", path.join(output, "profile"));
app.disableHardwareAcceleration();
const report = { checks: [], screenshots: [], errors: [] };
let server, window;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  try {
    await mkdir(output, { recursive: true });
    server = await createServer({
      configFile: false,
      root: path.join(root, "src", "renderer"),
      server: { host: "127.0.0.1", port: 5201, strictPort: true, hmr: false, fs: { allow: [root] } },
      clearScreen: false,
    });
    await server.listen();
    await app.whenReady();
    window = new BrowserWindow({
      show: false, width: 1200, height: 900,
      webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true },
    });
    const js = (source) => window.webContents.executeJavaScript(source, true);
    const fixture = path.join(root, "test", "fixtures", "trading-watchlist.html").replaceAll("\\", "/");
    await window.loadURL(`http://127.0.0.1:5201/@fs/${fixture}`);
    for (let attempt = 0; !(await js("window.ready === true")); attempt++) {
      assert.equal(await js("window.qaError || ''"), "");
      assert.ok(attempt < 150, "fixture loads");
      await pause(100);
    }
    const geometry = () => js(`(() => {
      const picker = workspace.picker;
      const head = picker.querySelector('.trading-market-picker-head');
      const heading = head.lastElementChild;
      const range = document.createRange(); range.selectNodeContents(heading);
      const text = range.getBoundingClientRect(), box = heading.getBoundingClientRect();
      const center = el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
      const rows = [...workspace.marketList.querySelectorAll('.trading-market-row')];
      const gap = getComputedStyle(picker).columnGap;
      return {
        name: heading.textContent, title: heading.title, gap, width: picker.getBoundingClientRect().width,
        textFits: text.left >= box.left - 0.5 && text.right <= box.right + 0.5,
        withinPicker: box.right <= picker.getBoundingClientRect().right,
        overflow: workspace.marketList.scrollWidth - workspace.marketList.clientWidth,
        visibleRows: workspace.marketList.clientHeight / rows[0].getBoundingClientRect().height,
        rows: rows.map(row => {
          const cells = [...row.children].filter(el => !el.matches('.trading-market-row-select'));
          const favorite = cells[4].getBoundingClientRect(), checkbox = cells[5].getBoundingClientRect();
          const deltas = cells.map((cell, i) => i < 4
            ? cell.getBoundingClientRect().left - head.children[i].getBoundingClientRect().left
            : center(cell) - center(head.children[i]));
          return {
            aligned: deltas.every(delta => Math.abs(delta) <= 0.5), deltas,
            actionGap: checkbox.left - favorite.right,
            hit: row.getBoundingClientRect().top >= workspace.marketList.getBoundingClientRect().top
              && row.getBoundingClientRect().bottom <= workspace.marketList.getBoundingClientRect().bottom
              ? document.elementFromPoint(center(cells[5]), checkbox.top + checkbox.height / 2) === cells[5] : true,
          };
        }),
      };
    })()`);
    const validate = (g, context) => {
      assert.ok(g.textFits && g.withinPicker, `${context}: full name ${JSON.stringify(g)}`);
      assert.ok(g.overflow <= 1, `${context}: no horizontal overflow`);
      assert.ok(g.visibleRows >= 5 && g.visibleRows < 7, `${context}: six-row viewport`);
      assert.ok(g.rows.length >= 18, `${context}: scrollable results`);
      assert.ok(g.rows.every(row => row.aligned && row.actionGap >= 4 && row.hit), `${context}: aligned, separate clickable actions ${JSON.stringify(g)}`);
    };
    await js("workspace.watchlist.addGroup('测试列'); workspace.setPickerOpen(true)");
    for (const theme of ["light", "dark"]) {
      for (const width of [668, 568, 428]) {
        await js(`workspace.picker.style.width='${width}px'`);
        for (const fontOffset of [0, 4]) {
          for (const name of ["自选", "我爱你", "五个字分组", "WWWWW", "🚀🚀🚀🚀🚀"]) {
            await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};
              document.documentElement.style.setProperty('--app-font-size-offset', '${fontOffset}px');
              workspace.watchlist.activeGroup.name=${JSON.stringify(name)}; workspace.syncWatchlistPicker()`);
            const result = await geometry();
            const context = `${theme}, picker ${width}, font +${fontOffset}, ${name}`;
            assert.equal(result.name, name);
            assert.equal(result.title, name);
            validate(result, context);
            report.checks.push(context);
          }
        }
      }
      await js("workspace.picker.style.removeProperty('width'); document.documentElement.style.removeProperty('--app-font-size-offset'); workspace.watchlist.activeGroup.name='五个字分组'; workspace.syncWatchlistPicker()");
      await pause(100);
      const before = await geometry();
      await js("workspace.marketList.scrollTop=workspace.marketList.scrollHeight");
      validate(await geometry(), `${theme}: scrolled rows`);
      await js("workspace.marketList.scrollTop=0; workspace.watchlist.activeGroup.name='我爱你'; workspace.syncWatchlistPicker()");
      const short = await geometry();
      assert.ok(short.rows[0].actionGap < before.rows[0].actionGap, `${theme}: spacing adapts to name length`);
      await js("workspace.marketList.querySelector('.trading-watchlist-checkbox').click()");
      assert.equal(await js("workspace.picker.hidden"), false, "membership keeps picker open");
      assert.equal(await js("workspace.marketList.querySelector('.trading-watchlist-checkbox').checked"), true);
      const screenshot = path.join(output, `picker-${theme}.png`);
      await writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
      report.screenshots.push(screenshot);
      await js("workspace.marketList.querySelector('.trading-watchlist-checkbox').click(); workspace.setPickerOpen(false)");
      assert.equal(await js("getComputedStyle(workspace.picker).display"), "none", "closed picker is hidden");
      await js("workspace.setPickerOpen(true)");
      report.checks.push(`${theme}: scrolling, automatic spacing, membership and close/reopen`);
    }
    assert.equal(await js("window.qaError || ''"), "");
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error.stack || String(error));
  } finally {
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    window?.destroy();
    await server?.close();
    app.exit(report.status === "passed" ? 0 : 1);
  }
}
void main().catch((error) => {
  process.stderr.write(String(error));
  app.exit(1);
});
