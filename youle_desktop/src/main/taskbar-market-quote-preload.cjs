const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("taskbarQuote", {
  onQuote(callback) {
    ipcRenderer.on("taskbar-market-quote:render", (_event, value) => callback(value));
  },
  activate() {
    ipcRenderer.send("taskbar-market-quote:activate");
  },
});
