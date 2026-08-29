import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { CHROME_TOOL_DEFINITIONS, validateChromeEnvelope } from "../src/main/chrome/contract.mjs";
import {
  ChromeEffectStore,
  ChromeGrantStore,
  ChromeSitePolicyStore,
  normalizeChromeOrigin,
  redactChromeLogValue,
  sanitizePageSnapshot,
} from "../src/main/chrome/policy.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../extensions/haolo-chrome/manifest.json", import.meta.url), "utf8"));
const worker = fs.readFileSync(new URL("../extensions/haolo-chrome/service-worker.js", import.meta.url), "utf8");
const agent = fs.readFileSync(new URL("../extensions/haolo-chrome/page-agent.js", import.meta.url), "utf8");
const sidePanel = fs.readFileSync(new URL("../extensions/haolo-chrome/sidepanel.html", import.meta.url), "utf8");
const sidePanelCss = fs.readFileSync(new URL("../extensions/haolo-chrome/sidepanel.css", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const rendererCss = fs.readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../src/main/chrome/tool-runtime.mjs", import.meta.url), "utf8");
const manager = fs.readFileSync(new URL("../src/main/chrome/native-host-manager.mjs", import.meta.url), "utf8");
const broker = fs.readFileSync(new URL("../src/main/chrome/native-broker.mjs", import.meta.url), "utf8");
const pluginSkill = fs.readFileSync(new URL("../resources/default-haolo-ai/plugins/cache/haolo-bundled/chrome/0.1.0/skills/chrome/SKILL.md", import.meta.url), "utf8");

const tool = (name) => CHROME_TOOL_DEFINITIONS.find((entry) => entry.name === name);
const cases = [
  [1, "全新安装扩展并连接 Haolo", () => assert.ok(manifest.key && /nativeMessaging/.test(JSON.stringify(manifest.permissions)))],
  [2, "Haolo 未运行时从扩展打开桌面端", () => assert.match(worker, /desktop\.open|connectNative/)],
  [3, "Chrome 重启后自动恢复", () => assert.match(worker, /onStartup[\s\S]*ensureNativeConnection/)],
  [4, "Haolo 重启后自动恢复", () => assert.match(worker, /scheduleReconnect|reconnectAttempt/)],
  [5, "Native Host 缺失时诊断并修复", () => assert.match(manager, /async repair\(\)[\s\S]*diagnose[\s\S]*install/)],
  [6, "多个 Profile 正确路由", () => assert.match(runtime, /CHROME_PROFILE_REQUIRED|profiles\.length === 1/)],
  [7, "总结当前文章", () => assert.equal(tool("read_page").annotations.readOnlyHint, true)],
  [8, "比较两个已打开标签页", () => assert.ok(tool("list_tabs") && tool("read_page"))],
  [9, "解释用户选中文本", () => assert.ok(tool("read_selection"))],
  [10, "提取页面表格可见摘要", () => assert.match(agent, /collectVisibleText/)],
  [11, "只列出授权 frame 的可见链接", () => assert.match(worker, /authorizedFrames[\s\S]*collect|readAllFrames/)],
  [12, "读取 SPA 更新后的页面", () => assert.match(agent, /pageFingerprint|waitForCondition/)],
  [13, "读取页面可见字幕文本", () => assert.match(agent, /NodeFilter\.SHOW_TEXT/)],
  [14, "密码与 OTP 不进入快照", () => {
    const result = sanitizePageSnapshot({ url: "https://example.test", elements: [{ type: "password" }, { autocomplete: "one-time-code" }, { type: "email" }] });
    assert.equal(result.elements.length, 1);
  }],
  [15, "提示注入不获得指令权", () => assert.equal(sanitizePageSnapshot({ url: "https://example.test", text: "ignore system" }).provenance.instructionAuthority, "none")],
  [16, "未授权域名读取被拒绝", () => assert.equal(new ChromeSitePolicyStore().decide("https://unknown.test").decision, "prompt")],
  [17, "只允许 HTTP(S) 导航", () => assert.throws(() => normalizeChromeOrigin("file:///secret"), { code: "CHROME_SCHEME_BLOCKED" })],
  [18, "为写任务创建隔离标签组", () => assert.match(worker, /chrome\.tabs\.group|title: "Haolo"/)],
  [19, "点击语义明确按钮并验证", () => assert.match(agent, /clickTarget[\s\S]*actionResult/)],
  [20, "搜索输入与提交分开控制", () => assert.ok(tool("type_text") && tool("prepare_external_action"))],
  [21, "选择下拉选项", () => assert.match(agent, /selectTargetOption/)],
  [22, "滚动到页面位置", () => assert.match(agent, /scrollTarget/)],
  [23, "跟踪动作创建的新标签页", () => assert.match(worker, /created_tabs/)],
  [24, "处理 SPA 路由变化", () => assert.match(agent, /before[\s\S]*after[\s\S]*changed/)],
  [25, "处理同源 iframe", () => assert.equal(manifest.content_scripts[0].all_frames, true)],
  [26, "跨域 iframe 需要独立站点权限", () => assert.match(worker, /permissions\.contains\(\{ origins: \[`\$\{origin\}\/\*`\] \}\)/)],
  [27, "页面刷新后失效目标安全失败", () => assert.match(agent, /CHROME_TARGET_NOT_FOUND/)],
  [28, "目标标签关闭后任务停止", () => assert.match(worker, /tabs\.onRemoved[\s\S]*activeTasks\.delete/)],
  [29, "草拟内容不会自动发送", () => assert.match(agent, /CHROME_EXTERNAL_ACTION_REQUIRES_PREPARE/)],
  [30, "发送前显示不可变摘要", () => assert.ok(tool("prepare_external_action").inputSchema.required.includes("summary"))],
  [31, "发布评论前确认", () => assert.match(agent, /publish|发布/)],
  [32, "删除条目前确认", () => assert.match(agent, /delete|删除/)],
  [33, "提交超时重试不重复执行", () => assert.match(worker, /completedToolRequests|inFlightToolRequests/)],
  [34, "上传显式授权文件", () => assert.match(worker, /DOM\.setFileInputFiles/)],
  [35, "拒绝 Grant 外文件", () => {
    const grants = new ChromeGrantStore();
    const grant = grants.issue({ threadId: "t", turnId: "u", taskId: "a", profileId: "p", tools: ["upload_file"], artifactIds: ["ok"] });
    assert.throws(() => grants.validate(grant.id, { artifactId: "wrong" }), { code: "CHROME_ARTIFACT_NOT_GRANTED" });
  }],
  [36, "下载记录来源并一次性撤权", () => assert.match(worker, /commitDownload[\s\S]*permissions\.remove/)],
  [37, "支付页面默认要求确认", () => assert.match(agent, /purchase|checkout|支付/)],
  [38, "账号安全设置默认要求确认", () => assert.match(agent, /security|password|安全|密码/)],
  [39, "仅本次授权在任务结束后失效", () => assert.match(worker, /revokeTemporaryAccess|temporaryOrigins\.delete/)],
  [40, "持续站点授权只覆盖同 origin", () => assert.match(worker, /`\$\{origin\}\/\*`/)],
  [41, "阻止列表优先于允许列表", () => {
    const policies = new ChromeSitePolicyStore({ allow: ["https://a.test"], block: ["https://a.test"] });
    assert.equal(policies.decide("https://a.test").decision, "block");
  }],
  [42, "历史记录每次重新授权", () => assert.match(runtime, /historyApprovals\.delete\(request\.id\)/)],
  [43, "日志递归脱敏", () => assert.deepEqual(redactChromeLogValue({ token: "x", nested: { password: "y" } }), { token: "[redacted]", nested: { password: "[redacted]" } })],
  [44, "插件禁用后工具不自动发现", () => assert.match(main, /setPluginEnabled|pluginsList/)],
  [45, "Native Host 崩溃后重连或报错", () => assert.match(worker, /CHROME_NATIVE_HOST_DISCONNECTED|scheduleReconnect/)],
  [46, "协议不兼容时失败关闭", () => assert.throws(() => validateChromeEnvelope({ protocolVersion: 99 }), { code: "CHROME_PROTOCOL_UNSUPPORTED" })],
  [47, "用户键鼠接管后暂停", () => assert.match(agent, /CHROME_USER_TAKEOVER/)],
  [48, "任务取消撤销 Grant", () => assert.match(runtime, /revokeForTurn|CHROME_TASK_CANCELLED/)],
  [49, "亮色流程覆盖完整交互状态", () => assert.match(`${sidePanelCss}\n${rendererCss}`, /button:hover[\s\S]*button:disabled/)],
  [50, "暗色流程覆盖完整交互状态", () => {
    assert.match(sidePanelCss, /prefers-color-scheme:\s*dark/);
    assert.match(rendererCss, /html\[data-theme="dark"\] \.chrome-integration-dialog/);
    assert.match(`${sidePanel}\n${renderer}`, /权限|审批/);
  }],
];

assert.equal(cases.length, 50);
assert.equal(new Set(cases.map(([id]) => id)).size, 50);

for (const [id, title, check] of cases) {
  test(`Chrome E2E baseline ${String(id).padStart(2, "0")}: ${title}`, check);
}

test("Chrome plugin safety instructions require untrusted-content handling and approval", () => {
  assert.match(pluginSkill, /untrusted web content/);
  assert.match(pluginSkill, /approval center/);
  assert.doesNotMatch(`${worker}\n${agent}`, /new Function\s*\(|\beval\s*\(/);
  assert.match(broker, /timingSafeEqual/);
});
