// Isolated UI regression using production question rendering, event bindings,
// validation and memory payloads. No user profile, account or model is touched.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const project = path.resolve(__dirname, "..");
const output = path.join(project, ".cache", "trading-preference-choices-qa");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, "profile"));
app.disableHardwareAcceleration();

(async () => {
  const { harnessSource } = await import(pathToFileURL(path.join(project, "test/helpers/trading-preference-harness.mjs")));
  const styles = fs.readFileSync(path.join(project, "src/renderer/styles.css"), "utf8");
  const fixture = path.join(output, "choices.html");
  fs.writeFileSync(fixture, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${styles}</style>
    <style>body{display:block;background:var(--bg);color:var(--text);margin:0;overflow:hidden}header{height:52px;padding:16px;font-weight:600;border-bottom:1px solid var(--border)}#messageScroller{height:calc(100vh - 52px);padding:16px;overflow:auto}.message-stack{width:100%;max-width:100%}.message-row{margin:16px 0}.message-text{white-space:pre-wrap}.message-bubble{max-width:100%}</style></head>
    <body><header>配置交易偏好</header><main id="messageScroller"></main><script type="module">import {localizeAppTree} from ${JSON.stringify(pathToFileURL(path.join(project, "src/renderer/app-language.mjs")).href)};window.localize=localizeAppTree;</script></body></html>`, "utf8");
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 460, height: 1450, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  const bootstrap = `${harnessSource}
    window.esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    window.redraw = () => {
      document.querySelector('#messageScroller').innerHTML = Object.values(h.state.items[h.state.currentThreadId] || {}).map(item => {
        const message = {id:item.id, conversation_id:h.state.currentThreadId};
        return '<article class="message-row from-agent" data-message-id="'+esc(item.id)+'"><div class="message-stack trading-preference-choice-stack"><div class="message-meta">'+(item.role === 'user' ? '我' : 'Haolo')+'</div><div class="message-bubble agent-bubble"><div class="message-text">'+esc(item.text)+'</div></div>'+h.renderTradingPreferenceChoices(message)+'</div></article>';
      }).join('');
      document.querySelectorAll('[data-trading-preference-form]').forEach(form => { h.bindTradingPreferenceChoiceForm(form); h.bindTradingPreferenceChoiceForm(form); });
    };
    window.h = createHarness({window, root:document, HTMLInputElement, HTMLTextAreaElement, render:redraw, suppressScrollDetection(){}, updateMessageScrollBottomButton(){}});
    window.choose = (field, value) => document.querySelector('[data-preference-field="'+field+'"] input[value="'+value+'"]').click();
    window.fill = (field, text) => {const input = document.querySelector('[data-preference-custom="'+field+'"]'); input.value=text; input.dispatchEvent(new Event('input',{bubbles:true}));};
    window.submit = () => document.querySelector('[data-trading-preference-form]').requestSubmit();
    h.startLegacyFixture();
  `;
  const report = { themes: [], layouts: [], errors };
  for (const theme of ["light", "dark"]) {
    await win.loadFile(fixture);
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await js(bootstrap);
    const stage = () => js('h.flows.get("qa-thread")?.stage');
    assert.equal(await stage(), 1);
    assert.equal(await js('document.querySelectorAll("[data-trading-preference-form]").length'), 1);
    await js('choose("risk","custom")');
    assert.equal(await js('document.activeElement.dataset.preferenceCustom'), "risk");
    await js('submit()');
    assert.equal(await stage(), 1);
    assert.equal(await js('document.querySelector(".trading-preference-choice-error").hidden'), false);
    assert.equal(await js('document.activeElement.dataset.preferenceCustom'), "risk");
    await js('fill("risk", "-2%"); submit()');
    assert.equal(await stage(), 1);
    await js('fill("risk", "1.25%，每日最多两次交易"); redraw()');
    assert.equal(await js('document.querySelector("[data-preference-custom=risk]").value'), "1.25%，每日最多两次交易");
    for (const language of ["en", "zh-TW", "zh-CN"]) {
      await js(`localize(document.querySelector('[data-trading-preference-form]'), ${JSON.stringify(language)})`);
      assert.equal(await js('document.querySelector("[data-preference-custom=risk]").value'), "1.25%，每日最多两次交易");
      if (language === "en") assert.doesNotMatch(await js('document.querySelector("[data-trading-preference-form]").innerText'), /\p{Script=Han}/u);
    }
    // An event from a detached/stale question must not submit on another thread.
    await js('h.state.currentThreadId="another-thread"; submit(); h.state.currentThreadId="qa-thread"');
    assert.equal(await stage(), 1);
    await pause();
    fs.writeFileSync(path.join(output, `${theme}-risk.png`), (await win.webContents.capturePage()).toPNG());
    await js('submit()');
    assert.equal(await stage(), 2);
    assert.equal(await js('document.querySelectorAll("[data-trading-preference-form]").length'), 1);
    await js('choose("breakEven","custom"); fill("breakEven","1.2R，覆盖交易成本"); choose("ratio","custom"); fill("ratio","1:1.8，仅考虑净盈利")');
    await pause();
    fs.writeFileSync(path.join(output, `${theme}-protection.png`), (await win.webContents.capturePage()).toPNG());
    await js('submit()');
    assert.equal(await stage(), 3);
    await js('choose("style","custom"); fill("style","先给结论，再用三个理由解释"); choose("sections","adaptive"); choose("discipline","no-add"); choose("discipline","news"); choose("discipline","custom"); fill("discipline","每天最多两笔，周末休息 <img src=x onerror=alert(1)>")');
    assert.deepEqual(await js('h.flows.get("qa-thread").choiceDraft.discipline.selected'), ["no-add", "news", "custom"]);
    await js('redraw()');
    assert.equal(await js('document.querySelectorAll("img").length'), 0);
    assert.match(await js('document.querySelector("[data-preference-custom=discipline]").value'), /<img src=x/);
    await js('localize(document.querySelector("[data-trading-preference-form]"), "en")');
    assert.doesNotMatch(await js('document.querySelector("[data-trading-preference-form]").innerText'), /\p{Script=Han}/u);
    assert.equal(await js('document.querySelector("[data-preference-custom=style]").value'), "先给结论，再用三个理由解释");
    await js('localize(document.querySelector("[data-trading-preference-form]"), "zh-CN")');
    for (const width of [280, 340, 410]) {
      await js(`document.querySelector('#messageScroller').style.width='${width}px'`);
      const layout = await js(`(() => {
        const form=document.querySelector('[data-trading-preference-form]');
        const box=form.getBoundingClientRect();
        const overflow=[...form.querySelectorAll('fieldset,label,textarea,button')].filter(el=>!el.hidden).filter(el=>el.getBoundingClientRect().right>box.right+1 || el.getBoundingClientRect().left<box.left-1).length;
        return {width:${width}, overflow, horizontal:form.scrollWidth>form.clientWidth+1};
      })()`);
      assert.equal(layout.overflow, 0);
      assert.equal(layout.horizontal, false);
      report.layouts.push({ theme, ...layout });
    }
    await js('document.querySelector("#messageScroller").style.width=""');
    await pause();
    fs.writeFileSync(path.join(output, `${theme}-discipline.png`), (await win.webContents.capturePage()).toPNG());
    await js('h.runtime.failSave=true; submit(); submit()');
    await pause();
    assert.equal(await stage(), "save-error");
    assert.equal(await js('h.runtime.saves.length'), 1);
    assert.equal(await js('document.querySelector("button[type=submit]").textContent'), "重试保存");
    await js('h.runtime.failSave=false; submit()');
    await pause();
    assert.equal(await stage(), undefined);
    const saves = await js('h.runtime.saves');
    assert.equal(saves.length, 2);
    assert.deepEqual(saves[0], saves[1]);
    const values = Object.fromEntries(saves[1].entries.map(entry => [entry.key, entry.value]));
    assert.equal(values.max_loss_per_trade_percent, 1.25);
    assert.equal(values.break_even_trigger_r, 1.2);
    assert.equal(values.minimum_risk_reward_ratio, 1.8);
    assert.equal(values.trading_analysis_style, "先给结论，再用三个理由解释");
    assert.match(values.user_custom_rules, /不允许亏损加仓；不在重大数据公布前开仓；每天最多两笔/);
    assert.match(values.user_preference_notes, /每日最多两次交易[\s\S]*覆盖交易成本[\s\S]*仅考虑净盈利[\s\S]*先给结论/);
    assert.equal(await js('document.querySelectorAll("[data-trading-preference-form]").length'), 0);
    assert.equal(await js('h.runtime.transcripts.length'), 1);
    report.themes.push({ theme, saves: saves.length, values });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, themes: report.themes.length, layouts: report.layouts.length, output }));
  win.destroy();
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
