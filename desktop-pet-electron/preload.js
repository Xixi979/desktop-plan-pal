/**
 * 桌宠 preload：向渲染进程安全暴露窗口移动接口
 * sandbox 模式下渲染进程无 Node 能力，通过 contextBridge 提供最小 API。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('PetNative', {
  /** 按增量移动桌宠窗口（拖拽用） */
  moveBy: (dx, dy) => ipcRenderer.send('pet-move', dx, dy),
});
