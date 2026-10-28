import { restartIdleProviderRuntime } from "./thread-provider-switch.mjs";

// Credentials in a child process are a startup snapshot. Refreshing the account
// cannot repair a running app-server that started without its provider token.
// Repair before thread start/resume, never replay a turn or stop a busy runtime.
export async function ensureDeepSeekRuntimeCredential({ client, isBusy, stop, start }) {
  if (client.__youleProviderSwitchPromise) await client.__youleProviderSwitchPromise;
  if (client.status === "ready" && client.providerRuntime?.deepSeek?.available === true) return;

  if (client.status === "ready") {
    await restartIdleProviderRuntime({ client, isBusy, stop, start });
  } else {
    await start();
  }

  if (client.providerRuntime?.deepSeek?.available !== true) {
    throw Object.assign(new Error("模型连接信息暂未同步，请稍后重试。"), {
      code: "MODEL_CREDENTIALS_UNAVAILABLE",
      retryable: true,
    });
  }
}
