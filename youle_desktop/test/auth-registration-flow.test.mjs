import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const apiClientSource = await readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("web3 login presents email as its only authentication method", () => {
  const identifierStep = rendererSource.slice(
    rendererSource.indexOf("function renderLoginIdentifierStep"),
    rendererSource.indexOf("function renderLoginSecondaryStep"),
  );
  assert.match(identifierStep, /type="email"[\s\S]*placeholder="请输入邮箱地址"[\s\S]*autocomplete="email"/);
  assert.doesNotMatch(identifierStep, /手机号|switch-login-wechat|微信登录/);
  assert.match(rendererSource, /function loginWechatAvailable\(\) \{\s*return false;/);
});

test("web3 startup and logout never launch a WeChat authentication flow", () => {
  const bootSource = rendererSource.slice(
    rendererSource.indexOf("async function boot()"),
    rendererSource.indexOf("async function shouldPreserveAppWindowModeForBoot"),
  );
  assert.doesNotMatch(bootSource, /loadLoginWechatConfig|startLoginWechatFlow/);

  const logoutSource = rendererSource.slice(
    rendererSource.indexOf("async function logoutFromYoule"),
    rendererSource.indexOf("function handleAuthExpired"),
  );
  assert.doesNotMatch(logoutSource, /startLoginWechatFlow/);
});

test("web3 identifier validation only accepts normalized email addresses", () => {
  assert.match(
    rendererSource,
    /function currentLoginIdentifier[\s\S]*normalizeAuthIdentifier\(state\.login\.identifier, "email"\)[\s\S]*channel: "email"/,
  );
  assert.match(rendererSource, /请输入正确的邮箱地址/);
});

test("web3 sends its client variant on send, verify, and registration completion", () => {
  assert.match(rendererSource, /AUTH_CLIENT_VARIANT = "haolo_windows_web3"/);
  const sendSource = rendererSource.slice(
    rendererSource.indexOf("async function sendLoginCode"),
    rendererSource.indexOf("async function verifyLoginCode"),
  );
  const verifySource = rendererSource.slice(
    rendererSource.indexOf("async function verifyLoginCode"),
    rendererSource.indexOf("async function loginRegistrationAvatarPayload"),
  );
  const completeSource = rendererSource.slice(
    rendererSource.indexOf("async function submitLoginRegistration"),
    rendererSource.indexOf("function finishLoginRegistration"),
  );
  assert.match(sendSource, /api\.sendOtp\([\s\S]*clientVariant: AUTH_CLIENT_VARIANT/);
  assert.match(verifySource, /api\.verifyOtp\([\s\S]*clientVariant: AUTH_CLIENT_VARIANT/);
  assert.match(completeSource, /api\.completeRegistration\([\s\S]*clientVariant: AUTH_CLIENT_VARIANT/);
  assert.match(apiClientSource, /client_variant: clientVariant/);
  assert.match(apiClientSource, /formData\.append\("client_variant", clientVariant\)/);
});

test("new web3 email users proceed directly to profile completion", () => {
  const verifySource = rendererSource.slice(
    rendererSource.indexOf("async function verifyLoginCode"),
    rendererSource.indexOf("async function loginRegistrationAvatarPayload"),
  );
  assert.match(verifySource, /if \(registrationToken\)[\s\S]*state\.login\.primaryChannel = channel;[\s\S]*state\.login\.step = "activate"/);
  assert.doesNotMatch(verifySource, /state\.login\.step = "secondary"|oppositeAuthChannel/);

  const activateSource = rendererSource.slice(
    rendererSource.indexOf("async function activateRegisteredUser"),
    rendererSource.indexOf("async function enterAuthenticatedApp"),
  );
  assert.match(activateSource, /当前服务端尚未支持 Web3 邮箱注册/);
  assert.doesNotMatch(activateSource, /startLoginWechatFlow/);
});

test("email login and registration retain light and dark interaction styling", () => {
  assert.match(stylesSource, /\.login-card input:focus/);
  assert.match(stylesSource, /\.login-card \.login-submit:hover/);
  assert.match(stylesSource, /\.login-card \.login-submit:disabled/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.login-card/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.login-card input,[\s\S]*\.login-card input:focus/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.login-card \.login-submit:hover/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.login-card \.login-submit:disabled/);
});

test("tokenless registration handoffs do not restart the authenticated client", () => {
  const handler = mainSource.slice(
    mainSource.indexOf('ipcMain.handle("youle:verifyOtp"'),
    mainSource.indexOf('ipcMain.handle("youle:completeRegistration"'),
  );
  assert.match(handler, /if \(session\?\.authenticated\)/);
  assert.match(handler, /restartClientAfterAuthChange\(\)/);
});

test("last logged-in avatar and name remain cached on the email login screen", () => {
  assert.match(rendererSource, /LAST_LOGIN_IDENTITY_STORAGE_KEY = "haolo\.auth\.last_login_identity"/);
  assert.match(rendererSource, /let cachedLoginIdentity = loadCachedLoginIdentity\(\)/);
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
