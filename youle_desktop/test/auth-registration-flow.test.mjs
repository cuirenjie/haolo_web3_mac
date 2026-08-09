import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("renderer exposes unified identifier and secondary verification steps", () => {
  assert.match(rendererSource, /placeholder="支持手机号\/邮箱地址"/);
  assert.match(rendererSource, /step: "identifier"[\s\S]*"wechatEmail"[\s\S]*"wechatQr"[\s\S]*"secondary"[\s\S]*"code"[\s\S]*"activate"/);
  assert.match(rendererSource, /verificationStage: "primary" \| "secondary"/);
  assert.match(rendererSource, /function renderLoginSecondaryStep/);
  assert.match(rendererSource, /验证码已发送至[\s\S]*challengeMaskedIdentifier\(\)/);
});

test("secondary send and verify carry the registration token", () => {
  assert.match(rendererSource, /api\.sendOtp\([\s\S]*registrationToken: isSecondary \? state\.login\.registrationToken : undefined/);
  assert.match(
    rendererSource,
    /api\.verifyOtp\([\s\S]*registrationToken: verificationStage === "secondary" \? state\.login\.registrationToken : undefined/,
  );
});

test("registration reaches profile completion only after the secondary OTP", () => {
  assert.match(rendererSource, /if \(verificationStage === "primary"\)[\s\S]*state\.login\.step = "secondary"/);
  assert.match(rendererSource, /else \{[\s\S]*state\.login\.step = "activate"/);
  assert.match(rendererSource, /api\.completeRegistration\([\s\S]*registrationToken: state\.login\.registrationToken/);
});

test("secondary verification preserves optional profile requirements from the primary handoff", () => {
  assert.match(
    rendererSource,
    /firstBoolean\(session\?\.inviteRequired, session\?\.invite_required\) \?\?[\s\S]*verificationStage === "primary" \? true : state\.login\.inviteRequired/,
  );
  assert.match(
    rendererSource,
    /firstBoolean\(session\?\.nicknameRequired, session\?\.nickname_required\) \?\?[\s\S]*verificationStage === "primary" \? true : state\.login\.nicknameRequired/,
  );
});

test("tokenless registration handoffs do not restart the authenticated client", () => {
  const handler = mainSource.slice(
    mainSource.indexOf('ipcMain.handle("youle:verifyOtp"'),
    mainSource.indexOf('ipcMain.handle("youle:completeRegistration"'),
  );
  assert.match(handler, /if \(session\?\.authenticated\)/);
  assert.match(handler, /restartClientAfterAuthChange\(\)/);
});

test("desktop WeChat flow reports an actionable server-upgrade error", () => {
  assert.match(rendererSource, /wechat client login is not enabled yet/i);
  assert.match(rendererSource, /当前服务端版本尚未支持桌面端微信登录，请更新服务端后重试/);
  assert.match(
    rendererSource,
    /async function startLoginWechatFlow[\s\S]*state\.login\.error = loginAuthErrorMessage\(error\)/,
  );
});

test("desktop login defaults to the native WeChat QR and keeps the original OTP form behind a text switch", () => {
  assert.match(
    rendererSource,
    /const wechatConfigPromise = loadLoginWechatConfig\(\)[\s\S]*await wechatConfigPromise[\s\S]*await startLoginWechatFlow\("login"\)/,
  );
  const identifierStep = rendererSource.slice(
    rendererSource.indexOf("function renderLoginIdentifierStep"),
    rendererSource.indexOf("function renderLoginSecondaryStep"),
  );
  assert.match(identifierStep, /renderLoginBrand\(\)[\s\S]*placeholder="支持手机号\/邮箱地址"[\s\S]*renderLoginAgreement\(\)/);
  assert.doesNotMatch(identifierStep, /login-auth-method-tabs/);
  assert.match(identifierStep, /renderLoginMethodSwitch\("switch-login-wechat", "切换微信登录"\)/);

  const wechatStep = rendererSource.slice(
    rendererSource.indexOf("function renderLoginWechatQrStep"),
    rendererSource.indexOf("function shouldShowContactsSearchResults"),
  );
  assert.match(wechatStep, /renderLoginBrand\(\)[\s\S]*login-wechat-primary-panel[\s\S]*微信登录二维码/);
  assert.match(wechatStep, /iframe data-login-wechat-qr[\s\S]*title="微信登录二维码"/);
  assert.doesNotMatch(wechatStep, /allow-top-navigation/);
  assert.match(wechatStep, /renderLoginMethodSwitch\("switch-login-otp", "切换邮箱\/手机"\)/);
  assert.match(wechatStep, /data-action="back-login-wechat">返回填写资料<\/button>/);
  assert.doesNotMatch(wechatStep, /绑定微信并完成注册/);
  assert.doesNotMatch(wechatStep, /renderLoginAuthMethodTabs/);
  assert.match(wechatStep, /class="login-wechat-retry" data-action="retry-login-wechat"/);
  assert.doesNotMatch(wechatStep, /class="primary-button login-submit login-wechat-retry"/);
  assert.match(rendererSource, /data-action="switch-login-wechat"[\s\S]*startLoginWechatFlow\("login"\)/);
  assert.match(rendererSource, /data-action="switch-login-otp"[\s\S]*state\.login\.step = "identifier"/);
  assert.match(stylesSource, /\.login-auth-method-switch[\s\S]*color: #a1a1aa/);
  assert.match(
    stylesSource,
    /\.login-wechat-primary-panel \.login-wechat-actions[\s\S]*margin-top: 15px/,
  );
  assert.match(
    stylesSource,
    /\.login-card \.login-wechat-retry[\s\S]*background: transparent;[\s\S]*color: #a1a1aa;[\s\S]*font-size: calc\(12px \+ var\(--app-font-size-offset\)\)/,
  );
  assert.match(
    stylesSource,
    /\.login-wechat-primary-panel \.login-wechat-qr-frame[\s\S]*width: min\(200px, 100%\)[\s\S]*height: 229\.333px/,
  );
  assert.match(
    stylesSource,
    /\.login-wechat-primary-panel \.login-wechat-qr-frame iframe[\s\S]*transform: scale\(0\.666667\)/,
  );
  assert.match(
    stylesSource,
    /\.login-wechat-primary-panel \.login-wechat-qr-frame \{\s*border: 0;\s*border-radius: 0;/,
  );
  assert.match(
    stylesSource,
    /\.login-wechat-primary-panel \.login-wechat-qr-loading \{\s*border: 0;\s*border-radius: 0;\s*background: transparent;/,
  );
  assert.match(
    stylesSource,
    /html\[data-theme="dark"\] \.login-wechat-qr-frame iframe \{\s*filter: brightness\(0\.62\) contrast\(1\.2\);/,
  );
  assert.match(rendererSource, /function loginWindowMode\(\): WindowMode \{\s*if \(state\.login\.step === "activate"/);
  assert.doesNotMatch(rendererSource, /state\.login\.wechatIntent === "register"\) return "loginWechat"/);
});

test("desktop WeChat login mirrors the web polling and registration handoff", () => {
  assert.match(rendererSource, /function loginWechatFlowReady[\s\S]*"authorized"[\s\S]*"needs_email"/);
  assert.match(
    rendererSource,
    /function loginWechatFlowExchangeReady[\s\S]*loginWechatFlowReady\(status\) \|\| status === "authenticated"/,
  );
  assert.match(rendererSource, /function pollLoginWechatFlow[\s\S]*getWechatAuthFlowStatus/);
  assert.match(
    rendererSource,
    /step: "identifier"[\s\S]*"wechatQr"[\s\S]*"wechatLoading"[\s\S]*"secondary"/,
  );
  assert.match(
    rendererSource,
    /function bindLoginWechatQrFrameEvents[\s\S]*initialLoadComplete[\s\S]*showLoginWechatLoadingStep\(\)[\s\S]*pollLoginWechatFlow\(\)/,
  );
  assert.match(
    rendererSource,
    /function loginWechatFlowViewActive\(\) \{\s*return state\.login\.step === "wechatQr" \|\| state\.login\.step === "wechatLoading";/,
  );
  assert.match(
    rendererSource,
    /state\.login\.step === "wechatLoading"[\s\S]*renderLoginRestoreStep\(\{ pendingWechat: true \}\)/,
  );
  const wechatPollSource = rendererSource.slice(
    rendererSource.indexOf("async function pollLoginWechatFlow"),
    rendererSource.indexOf("async function exchangeLoginWechatFlow"),
  );
  assert.match(
    wechatPollSource,
    /wechatIntent === "login"[\s\S]*loginWechatFlowExchangeReady\(state\.login\.wechatStatus\)[\s\S]*if \(flowReady\)[\s\S]*showLoginWechatLoadingStep\(\)[\s\S]*exchangeLoginWechatFlow\(flow\)/,
  );
  assert.ok(
    wechatPollSource.indexOf("if (flowReady)") < wechatPollSource.indexOf("if (loginWechatFlowTerminal"),
    "authenticated login flows must exchange before terminal-state handling",
  );
  assert.match(
    wechatPollSource,
    /loginWechatExchangeAttempts \+= 1;[\s\S]*const exchanged = await exchangeLoginWechatFlow\(flow\);[\s\S]*if \(exchanged \|\| loginWechatExchangeAttempts >= 2\) return;/,
  );
  assert.match(wechatPollSource, /else if \(loginWechatFlowTerminal/);
  assert.match(rendererSource, /function resetLoginWechatFlow[\s\S]*loginWechatExchangeAttempts = 0;/);
  assert.match(rendererSource, /async function exchangeLoginWechatFlow[\s\S]*return true;[\s\S]*return false;/);
  assert.match(rendererSource, /正常轮询不重建 iframe/);
  assert.match(rendererSource, /session\?\.mode === "wechat_required"[\s\S]*startLoginWechatFlow\("register"/);
  assert.match(rendererSource, /wechatFlowId: isWechatEmail \? wechatFlow\?\.flow_id/);
  assert.match(rendererSource, /wechatFlowId: registrationWechatFlow\?\.flow_id/);
  assert.match(rendererSource, /const seq = \+\+loginWechatFlowSeq[\s\S]*if \(seq !== loginWechatFlowSeq\) return/);
  assert.match(rendererSource, /completeLoginWechatRegistration[\s\S]*finishLoginRegistration\(session\);\s*render\(\)/);
  assert.match(rendererSource, /function finishLoginRegistration[\s\S]*state\.login\.step = "success"/);
  const registrationCompletionSource = rendererSource.slice(
    rendererSource.indexOf("async function completeLoginWechatRegistration"),
    rendererSource.indexOf("async function activateRegisteredUser"),
  );
  assert.match(
    registrationCompletionSource,
    /loginWechatBindingConflict\(error\)[\s\S]*restartLoginWechatRegistrationAfterBindingConflict\(\)[\s\S]*return;[\s\S]*state\.login\.step = "activate"/,
  );
  assert.match(
    rendererSource,
    /LOGIN_WECHAT_BINDING_CONFLICT_MESSAGE = "该微信已绑定其他账号，请更换微信扫码"[\s\S]*startLoginWechatFlow\([\s\S]*"register",[\s\S]*state\.login\.registrationToken,[\s\S]*LOGIN_WECHAT_BINDING_CONFLICT_MESSAGE/,
  );
  assert.match(
    rendererSource,
    /state\.login\.wechatIntent === "register" && state\.login\.wechatStatus === "conflict"[\s\S]*restartLoginWechatRegistrationAfterBindingConflict\(\)/,
  );
  assert.match(rendererSource, /state\.login\.step = registrationFlow \? "wechatQr" : "identifier"/);
  assert.match(mainSource, /ipcMain\.handle\("youle:exchangeWechatAuthFlow"[\s\S]*if \(session\?\.authenticated\)/);
});

test("last logged-in avatar and name are cached for login and WeChat loading screens", () => {
  assert.match(rendererSource, /LAST_LOGIN_IDENTITY_STORAGE_KEY = "haolo\.auth\.last_login_identity"/);
  assert.match(rendererSource, /let cachedLoginIdentity = loadCachedLoginIdentity\(\)/);
  assert.match(
    rendererSource,
    /function loadCachedLoginIdentity[\s\S]*localStorage\.getItem\(LAST_LOGIN_IDENTITY_STORAGE_KEY\)/,
  );
  assert.match(
    rendererSource,
    /function applyAuthSession[\s\S]*state\.auth\.authenticated && state\.auth\.profile[\s\S]*persistLastLoginIdentity\(state\.auth\.profile\)/,
  );

  const restoreStep = rendererSource.slice(
    rendererSource.indexOf("function renderLoginRestoreStep"),
    rendererSource.indexOf("function renderLoginBrand"),
  );
  assert.match(restoreStep, /cachedLoginIdentity\?\.avatarUrl/);
  assert.match(restoreStep, /cachedLoginIdentity\?\.name/);

  const loginBrand = rendererSource.slice(
    rendererSource.indexOf("function renderLoginBrand"),
    rendererSource.indexOf("function renderLoginIdentifierStep"),
  );
  assert.match(loginBrand, /cachedLoginIdentity\?\.avatarUrl/);
  assert.match(loginBrand, /login-logo-user/);
});

test("leaving an OTP step invalidates an in-flight send without leaving the form busy", () => {
  const handler = rendererSource.slice(
    rendererSource.indexOf("'[data-action=\"back-login-email\"]'"),
    rendererSource.indexOf("'[data-action=\"restart-login\"]'"),
  );
  assert.match(handler, /state\.login\.busy = null/);
  assert.match(handler, /loginModeCheckSeq \+= 1/);
});
