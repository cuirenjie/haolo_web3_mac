const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("haoloExecutionPlanSticky", Object.freeze({
  resizeLive: (params) => ipcRenderer.send("executionPlanSticky:resize-live", params),
  resizeCommit: (params) => ipcRenderer.send("executionPlanSticky:resize-commit", params),
}));
