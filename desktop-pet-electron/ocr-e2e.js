/** OCR 端到端验证（真实 Electron 环境）：加载 e2e 页 → 等待完成 → 输出结果 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 500,
    height: 400,
    show: false,
    webPreferences: { sandbox: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'ui', 'ocr-e2e-tmp.html'));
  const wc = win.webContents;
  const start = Date.now();
  let last = '';
  while (Date.now() - start < 120000) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      last = await wc.executeJavaScript('document.getElementById("out").textContent', false);
      if (last.includes('E2E_DONE') || last.includes('E2E_ERR') || last.includes('TESSERACT_FAIL')) break;
    } catch (e) { /* 页面尚在初始化 */ }
  }
  console.log('E2E_RESULT>>>', last.replace(/\n/g, ' | '));
  app.quit();
});
