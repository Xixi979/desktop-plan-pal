/** 自测页回归：加载 ui/selftest.html + 注入 selftest.inject.js，等待 DONE */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true } });
  await win.loadFile(path.join(__dirname, '..', 'ui', 'selftest.html'));
  const wc = win.webContents;
  const inject = fs.readFileSync(path.join(__dirname, '..', 'ui', 'selftest.inject.js'), 'utf8');
  await wc.executeJavaScript(inject, false);
  const start = Date.now();
  let last = '';
  while (Date.now() - start < 60000) {
    await new Promise((r) => setTimeout(r, 1500));
    last = await wc.executeJavaScript('document.getElementById("selftest-out").textContent', false);
    if (last.includes('DONE')) break;
  }
  console.log(last);
  const fails = last.split('\n').filter((l) => l.includes(': FAIL'));
  console.log(fails.length ? 'SELFTEST_FAIL (' + fails.length + ')' : 'SELFTEST_PASS');
  app.quit();
});
