import readline from "node:readline";

const baseUrl = process.env.HAOLO_BUSINESS_BROKER_URL;
const token = process.env.HAOLO_BUSINESS_BROKER_TOKEN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl || "") || !token) {
  throw new Error("Haolo business Host is unavailable.");
}
async function host(route, body = {}) {
  const response = await fetch(`${baseUrl}/v1/tools/${route}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error?.message || "Business tool failed.");
  return value;
}
async function handle(message) {
  if (message.id === undefined) return;
  try {
    let result;
    if (message.method === "initialize") result = {
      protocolVersion: message.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} }, serverInfo: { name: "haolo-business", version: "1.0.0" },
    };
    else if (message.method === "ping") result = {};
    else if (message.method === "tools/list") result = await host("list");
    else if (message.method === "tools/call") {
      try {
        const value = await host("call", { tool: message.params?.name, arguments: message.params?.arguments || {} });
        result = { content: [{ type: "text", text: JSON.stringify(value) }] };
      } catch (error) {
        result = { isError: true, content: [{ type: "text", text: error.message }] };
      }
    } else {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown method" } })}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error.message } })}\n`);
  }
}
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", line => {
  try { void handle(JSON.parse(line)); } catch { /* Ignore malformed transport frames. */ }
});
