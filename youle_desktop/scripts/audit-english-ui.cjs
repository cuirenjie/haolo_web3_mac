const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

import("./audit-english-ui.mjs").catch((error) => {
  const resultPath = path.join(os.tmpdir(), "haolo-english-ui-audit-result.json");
  fs.writeFileSync(resultPath, `${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.stack || error.message : String(error),
  }, null, 2)}\n`, "utf8");
  app.exit(1);
});
