const { app } = require("electron");

import("./audit-i18n-layout.mjs").catch((error) => {
  console.error(error);
  app.exit(1);
});
