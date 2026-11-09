/**
 * 桌面计划小人 · 透明悬浮桌宠（Electron 壳）
 * 用法：electron.exe <本目录>（见桌面启动器 桌面小人.bat）
 * - 透明无边框置顶小窗，加载 ui/pet.html
 * - 主页面（index.html）在本壳内打开时与桌宠同 localStorage → 数据实时联动
 * - 拖动：按住桌宠空白区域拖动；点击小人本体打开主计划页
 */
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const UI_DIR = path.join(__dirname, '..', 'ui');

function createMainWindow() {
  const w = new BrowserWindow({
    width: 1180,
    height: 820,
    autoHideMenuBar: true,
    title: '桌面计划小人',
    backgroundColor: '#f4f6fb',
    webPreferences: { sandbox: true },
  });
  Menu.setApplicationMenu(null);
  w.loadFile(path.join(UI_DIR, 'index.html'));
  return w;
}

function createPetWindow() {
  const pet = new BrowserWindow({
    width: 260,
    height: 340,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 200,
    minHeight: 260,
    webPreferences: { sandbox: true },
  });
  // 置顶到最高层级（高于普通窗口，低于任务管理器）
  pet.setAlwaysOnTop(true, 'screen-saver');
  pet.loadFile(path.join(UI_DIR, 'pet.html'));

  // 桌宠页里的链接（点小人开主页面）：拦截为同壳内新窗口（同 session → 同 localStorage）
  pet.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('index.html')) {
      createMainWindow();
    }
    return { action: 'deny' };
  });
  return pet;
}

app.whenReady().then(() => {
  // 命令行带 --main 时直接开主页面（桌面小人-主页.bat 用）
  if (process.argv.includes('--main')) {
    createMainWindow();
  } else {
    createPetWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
