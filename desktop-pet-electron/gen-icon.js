/**
 * 生成应用图标 icon.png：加载 pet.html，截取 .pet-svg 元素区域
 * 用法：electron.exe desktop-pet-electron/gen-icon.js（一次性工具）
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 260,
    height: 340,
    show: true,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    webPreferences: { sandbox: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'ui', 'pet.html'));
  // 等动画与渲染稳定
  await new Promise((r) => setTimeout(r, 2000));

  const wc = win.webContents;
  const rect = await wc.executeJavaScript(`
    (function () {
      var el = document.querySelector('.pet-svg');
      var r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()
  `);
  const scale = await wc.executeJavaScript('window.devicePixelRatio || 1');
  const img = await wc.capturePage();
  const cropped = img.crop({
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  });
  const out = path.join(__dirname, 'icon.png');
  fs.writeFileSync(out, cropped.toPNG());
  console.log('ICON_OK', Math.round(rect.width * scale) + 'x' + Math.round(rect.height * scale), '->', out);
  app.quit();
});
