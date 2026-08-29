import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("src/renderer", import.meta.url));
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
