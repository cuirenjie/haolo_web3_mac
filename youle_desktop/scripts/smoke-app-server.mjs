import { AppServerClient, defaultWorkspace, resolveCodexCommand } from "../src/main/app-server-client.mjs";

const workspace = defaultWorkspace();
const command = resolveCodexCommand(workspace);
const client = new AppServerClient({ cwd: workspace, codexCommand: command });

client.on("log", (entry) => {
  if (/error|panic|failed/i.test(entry.line)) {
    console.error(`[${entry.stream}] ${entry.line}`);
  }
});

try {
  const status = await client.start();
  console.log(`app-server ready on port ${status.port}`);
  console.log(`codex command: ${status.command}`);
  const init = status.init || {};
  console.log(`codex home: ${init.codexHome || "unknown"}`);
  const thread = await client.request("thread/start", {
    cwd: workspace,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    personality: "friendly",
    ephemeral: true,
  });
  console.log(`thread started: ${thread.thread.id}`);
  await client.stop();
  console.log("smoke ok");
} catch (error) {
  await client.stop().catch(() => {});
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}