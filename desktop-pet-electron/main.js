/**
 * 桌面计划小人 · 透明悬浮桌宠（Electron 壳）
 * 用法：electron.exe <本目录>（见桌面启动器 桌面小人.bat）
 * - 透明无边框置顶小窗，加载 ui/pet.html
 * - 主页面（index.html）在本壳内打开时与桌宠同 localStorage → 数据实时联动
 * - 拖动：按住桌宠空白区域拖动；点击小人本体打开主计划页
 */
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const UI_DIR = path.join(__dirname, '..', 'ui');

/**
 * 数据迁移：--import <json 文件>
 * 把 Edge 版导出的 plan-pal.* 键值 JSON 写入本壳 localStorage（首次 loadFile 建 origin）。
 * 生成方式：Edge 打开 ui/dump-tmp.html 导出，或手动「📦 导出备份」后再转格式。
 */
async function importData(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  const w = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  await w.loadFile(path.join(UI_DIR, 'index.html'));
  const sets = Object.keys(data)
    .map((k) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(data[k])});`)
    .join('\n');
  const verify = `
    ${sets}
    (${Object.keys(data).map((k) => `localStorage.getItem(${JSON.stringify(k)})`).join(' + ')});
  `;
  const check = await w.webContents.executeJavaScript(verify, false);
  const expected = Object.keys(data).map((k) => data[k]).join('');
  console.log(check === expected
    ? `IMPORT_OK keys=${Object.keys(data).length}`
    : `IMPORT_MISMATCH expected=${expected.length} got=${check ? check.length : 'null'}`);
  app.quit();
}

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
  // 数据迁移模式：--import <json> → 写入 localStorage 后退出
  const importIdx = process.argv.indexOf('--import');
  if (importIdx !== -1 && process.argv[importIdx + 1]) {
    importData(process.argv[importIdx + 1]).catch((e) => {
      console.error('IMPORT_FAIL', e.message);
      app.quit();
    });
    return;
  }

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
