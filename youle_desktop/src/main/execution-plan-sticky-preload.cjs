const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("haoloExecutionPlanSticky", Object.freeze({
  moveLive: (params) => ipcRenderer.send("executionPlanSticky:move-live", params),
  moveCommit: (params) => ipcRenderer.send("executionPlanSticky:move-commit", params),
  resizeLive: (params) => ipcRenderer.send("executionPlanSticky:resize-live", params),
  resizeCommit: (params) => ipcRenderer.send("executionPlanSticky:resize-commit", params),
}));
