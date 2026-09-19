// Invoke only as part of an explicitly authorized release, after publishing
// the full installer. No release record, DNS or client version is changed here.
import fs from "node:fs/promises";
import path from "node:path";
import { parseBlockMap } from "../src/main/app-update-differential.mjs";

const [installer, version] = process.argv.slice(2);
if (!installer || !/^\d+\.\d+\.\d+$/.test(version || "") || !installer.endsWith(".exe")) throw Error("usage: node upload-update-blockmap.mjs INSTALLER.exe VERSION");
const secret = process.env.HAOLO_APP_UPDATE_ADMIN_KEY;
if (!secret) throw Error("HAOLO_APP_UPDATE_ADMIN_KEY is required (never pass secrets on the command line)");
const bytes = await fs.readFile(installer + ".blockmap");
parseBlockMap(bytes, (await fs.stat(installer)).size);
const form = new FormData();
form.set("arch", "x64"); form.set("client_variant", "haolo_windows_web3");
form.set("file", new Blob([bytes], { type: "application/octet-stream" }), path.basename(installer) + ".blockmap");
const response = await fetch(`https://haolo.com/api/app-updates/admin/windows/${version}/blockmap`, {
  method: "POST", headers: { "X-App-Update-Admin-Key": secret }, body: form,
  redirect: "error", signal: AbortSignal.timeout(60000),
});
if (!response.ok) throw Error(`blockmap upload failed: HTTP ${response.status}`);
const result = await response.json();
console.log(JSON.stringify({ version: result.version, clientVariant: result.client_variant, published: true }));
