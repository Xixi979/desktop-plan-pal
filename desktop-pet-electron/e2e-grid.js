/** v0.2.6 端到端验证：构建产物页面 + 真实 123.jpg OCR 词数据 → parseTimetableGrid */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true } });
  await win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  const wc = win.webContents;
  const words = JSON.parse(fs.readFileSync(path.join(__dirname, 'diag-tt-out.json'), 'utf8')).words
    .map((w) => ({ text: w.t, x0: w.x, y0: w.y, x1: w.x1, y1: w.y1 }));
  const script = `
    (function () {
      if (!window.Timetable || !window.Timetable.parseTimetableGrid) return 'NO_GRID_FN';
      const r = window.Timetable.parseTimetableGrid(${JSON.stringify(words)});
      return JSON.stringify(r);
    })()
  `;
  const out = await wc.executeJavaScript(script, false);
  const r = JSON.parse(out);
  console.log('E2E drafts:', r.drafts.length, 'skipped:', r.skipped);
  for (const t of r.drafts) console.log(' ', t.rrule.padEnd(26), t.startTime + '-' + t.endTime, t.title);
  const ok = r.drafts.length === 9;
  console.log(ok ? 'E2E_PASS' : 'E2E_FAIL');
  app.quit();
});
