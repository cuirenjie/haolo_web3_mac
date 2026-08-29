import os from "node:os";
import path from "node:path";
import { WechatExternalChannelServer } from "../src/main/wechat-external-channel-server.mjs";

const stateDir = process.env.YOULE_WECHAT_EXTERNAL_CHANNEL_STATE_DIR || path.join(os.tmpdir(), "haolo_desktop-wechat-channel");
const server = new WechatExternalChannelServer({
  host: process.env.YOULE_EXTERNAL_CHANNELS_HOST || "127.0.0.1",
  port: Number(process.env.YOULE_EXTERNAL_CHANNELS_PORT || 8010),
  statePath: path.join(stateDir, "state.json"),
  logPath: path.join(stateDir, "server.log"),
});

const status = await server.start();
console.log(`WeChat external channel backend ready on http://${status.host}:${status.port}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void server.stop().finally(() => process.exit(0));
  });
}
