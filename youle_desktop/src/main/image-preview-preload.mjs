import { contextBridge, ipcRenderer } from "electron/renderer";

contextBridge.exposeInMainWorld("youleImagePreview", {
  save: () => ipcRenderer.invoke("youle:imagePreviewSave"),
  close: () => ipcRenderer.invoke("youle:imagePreviewClose"),
});
