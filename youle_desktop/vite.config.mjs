import { defineConfig } from "vite";
import { createRequire } from "node:module";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve the renderer root through the filesystem so Vite uses the canonical
// Windows path even when the workspace is launched through a subst drive
// (for example H:\\). Without this, `new URL(..., import.meta.url)` asset
// references are rewritten to `/@fs/C:/...` paths that the dev server rejects,
// leaving every imported image as a broken `<img>`.
const root = fs.realpathSync(fileURLToPath(new URL("src/renderer", import.meta.url)));
const require = createRequire(import.meta.url);
const packageJson = require("./package.json");
const manualDevelopmentRestart =
  process.env.HAOLO_DESKTOP_MANUAL_RESTART === "1";

export default defineConfig({
  root,
  base: "./",
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version),
  },
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
    hmr: manualDevelopmentRestart ? false : undefined,
  },
  build: {
    outDir: path.resolve(root, "../../dist/renderer"),
    emptyOutDir: true,
  },
});
