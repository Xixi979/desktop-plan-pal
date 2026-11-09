/**
 * 浏览器构建脚本：把 core 的 TS 源码剥离类型后打包为自包含单文件 UI。
 *
 * 用法：node core/scripts/build-browser.mjs（在仓库根目录或任意位置均可）
 * 产物：ui/index.html（零依赖，双击即可打开，也可发布为在线链接）
 *
 * 原理：Node 22 的 stripTypeScriptTypes 剥离类型注解 → 去掉 ESM export 前缀 →
 * 挂载 window.Engine / window.Store → 与 UI 脚本、样式一起内联进单个 HTML。
 */

import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function toBrowserJs(srcPath, globalName, exportNames) {
  const stripped = stripTypeScriptTypes(read(srcPath), { mode: 'strip' });
  const js = stripped.replace(/^export\s+/gm, '');
  // 语法自检（不执行）
  new Function(js);
  return `${js}\nwindow.${globalName} = { ${exportNames.join(', ')} };\n`;
}

const engineJs = toBrowserJs('core/src/engine.ts', 'Engine', [
  'toMin', 'toIso', 'occursOn', 'buildFreeSlots', 'scorePlacement',
  'validateConstraints', 'greedySchedule', 'incrementalReschedule',
]);

const storeJs = toBrowserJs('core/src/store.ts', 'Store', [
  'PlanStore', 'MemoryAdapter', 'FileAdapter',
]);

const checklistJs = toBrowserJs('core/src/checklist.ts', 'Checklist', [
  'mergeChecklist',
]);

const icsJs = toBrowserJs('core/src/ics.ts', 'Ics', [
  'parseIcs',
]);

const nlpJs = toBrowserJs('core/src/nlp.ts', 'Nlp', [
  'parseRule', 'parseViaLLM', 'parseDual',
]);

const timetableJs = toBrowserJs('core/src/timetable.ts', 'Timetable', [
  'parseTimetableLine', 'parseTimetableLines',
]);

const appJs = read('ui/src/app.js');
const petJs = read('ui/src/pet.js');
const css = read('ui/src/style.css');
const BUILD_TAG = `v0.2.5 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

const html = `<!DOCTYPE html>
<!-- 本文件由 core/scripts/build-browser.mjs 自动生成，请勿手改；修改 ui/src/ 下源码后重新构建 -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>桌面计划小人 · v0.2</title>
<style>
${css}
</style>
<script>
// ES5 兼容性预检：老内核浏览器无法解析新版 JS 时给出明确提示（本段必须用 ES5 写法）
window.__PLAN_PAL_COMPAT__ = (function () {
  try { new Function('var a = {b:1}; return a?.b ?? 0;'); return true; }
  catch (e) { return false; }
})();
</script>
</head>
<body>
<script>
// 兼容性横幅（ES5，早于应用脚本执行）
if (!window.__PLAN_PAL_COMPAT__) {
  document.write('<div style="position:fixed;inset:0;z-index:999999;background:#fff;color:#b91c1c;'
    + 'font:16px/1.8 sans-serif;padding:40px;text-align:center">'
    + '<h2 style="color:#b91c1c">⚠️ 浏览器内核过旧</h2>'
    + '<p>桌面计划小人需要较新的浏览器内核（Chrome 80+ / Edge 80+ / Firefox 80+）。<br>'
    + '当前浏览器无法运行本应用，请使用系统自带 Microsoft Edge 打开本文件，<br>'
    + '或安装最新版 Edge / Chrome。</p></div>');
}
</script>
<div id="pet"><div id="pet-bubble">加载中…</div></div>
<header>
  <h1>桌面计划小人 <span class="ver">${BUILD_TAG}</span></h1>
  <div class="header-actions">
    <button id="btn-reschedule">🔄 重新排程</button>
    <button id="btn-undo">↩️ 撤销</button>
    <button id="btn-export">📤 导出数据</button>
    <button id="btn-import">📥 导入备份</button>
    <input id="import-file" type="file" accept=".json,application/json" hidden>
    <button id="btn-clear" class="danger">🗑️ 清空数据</button>
  </div>
</header>
<main>
  <nav id="panel-nav">
    <button data-panel="panel-quick" class="nav-btn">⚡ 加计划</button>
    <button data-panel="panel-events" class="nav-btn">📅 固定课表</button>
    <button data-panel="panel-params" class="nav-btn">🎛️ 强度参数</button>
    <button data-panel="panel-timeline" class="nav-btn">🕐 今日时间轴</button>
    <span class="nav-hint">点击展开 / 收起板块 · 计划列表始终显示</span>
  </nav>
  <section class="panel wide" id="panel-tasks">
    <h2>📝 计划列表</h2>
    <div class="row form">
      <input id="task-title" placeholder="标题">
      <input id="task-cat" placeholder="类别" value="学习" style="max-width:90px">
      <input id="task-min" type="number" placeholder="分钟" value="60" style="max-width:80px">
      <input id="task-pri" type="number" min="1" max="5" value="3" style="max-width:60px" title="优先级1-5">
      <input id="task-ddl" type="datetime-local" style="max-width:200px">
      <button id="task-add">➕</button>
    </div>
    <ul id="task-list"></ul>
  </section>
  <section class="panel" id="panel-quick">
    <h2>⚡ 加计划</h2>
    <div class="tabs" id="entry-tabs">
      <button class="tab active" data-tab="text">⌨️ 一句话</button>
      <button class="tab" data-tab="image">🖼️ 图片</button>
      <button class="tab" data-tab="link">🔗 链接</button>
    </div>
    <div class="tabpane" id="pane-text">
      <div class="row">
        <input id="quick-input" placeholder="例如：写实验报告 3小时 周五前（自动识别时长/DDL/类别）">
        <button id="quick-add">添加</button>
      </div>
      <div id="quick-preview" class="preview"></div>
    </div>
    <div class="tabpane hidden" id="pane-image">
      <div id="img-drop">点击选择 / 拖入图片（可多选）/ Ctrl+V 粘贴截图（如课程表、作业要求）</div>
      <input id="img-file" type="file" accept="image/*" multiple hidden>
      <div id="img-confirm" class="hidden">
        <div id="img-thumbs" class="img-thumbs"></div>
        <div class="row form">
          <select id="img-target" title="新建计划，或补充到已有计划"><option value="new">➕ 新建计划</option></select>
          <input id="img-title" placeholder="计划名称（可自定义）" style="flex:1;min-width:150px">
          <input id="img-cat" placeholder="类别" value="学习" style="max-width:80px">
          <input id="img-min" type="number" value="60" title="预计分钟" style="max-width:70px">
          <button id="img-add">添加计划</button>
        </div>
        <input id="img-note" placeholder="备注 / 达标要求：用「、」或「；」分隔多条，如：看完第一课、做课后习题、整理错题 2小时 周五前" style="width:100%">
        <div id="img-feedback" class="preview"></div>
        <p class="hint">达标要求自动解析：备注按「、；」拆分逐条生成，文件名/链接也会生成对应条目；自动合并进目标计划——重复不加、缺的补上、同来源变动的更新。</p>
      </div>
      <p class="hint">当前为本地规则版：自动取文件名 + 备注识别时长/DDL；图片内文字 OCR 识别将在 v0.2 接入。</p>
    </div>
    <div class="tabpane hidden" id="pane-link">
      <div class="row">
        <input id="link-input" placeholder="粘贴链接（可多条，空格或换行分隔）：B站视频 / GitHub / 在线文档 / 网课…" style="flex:1;min-width:220px">
        <button id="link-parse">识别</button>
      </div>
      <div id="link-confirm" class="hidden">
        <div id="link-list" class="link-list"></div>
        <div class="row form">
          <select id="link-target" title="新建计划，或补充到已有计划"><option value="new">➕ 新建计划</option></select>
          <input id="link-title" placeholder="计划名称（可自定义）" style="flex:1;min-width:150px">
          <input id="link-cat" placeholder="类别" value="学习" style="max-width:80px">
          <input id="link-min" type="number" value="60" title="预计分钟" style="max-width:70px">
          <button id="link-add">添加计划</button>
        </div>
        <input id="link-note" placeholder="备注 / 达标要求：用「、」或「；」分隔多条，如：看完视频、做笔记 1小时" style="width:100%">
        <div id="link-preview" class="preview"></div>
        <p class="hint">达标要求自动解析：每条链接生成「查看内容 + 整理要点」条目，备注拆分逐条生成；自动合并——重复不加、缺的补上、同链接变动的更新。</p>
      </div>
      <p class="hint">当前为本地规则识别（站点/标题建议）；联网抓取网页标题将在 v0.2 接入 LLM 双路由。</p>
    </div>
  </section>
  <section class="panel" id="panel-events">
    <h2>📅 固定安排（课表）</h2>
    <div class="row form">
      <input id="evt-title" placeholder="名称">
      <input id="evt-start" type="time" value="08:00" style="max-width:110px">
      <input id="evt-end" type="time" value="09:40" style="max-width:110px">
      <select id="evt-freq" style="max-width:110px">
        <option value="daily">每天</option>
        <option value="once">仅一次</option>
      </select>
      <button id="evt-add">➕</button>
      <button id="evt-sample" title="载入睡眠+三节课的示例课表">载入示例课表</button>
      <button id="evt-ics" title="导入 .ics 日历文件（导出自教务系统 / Outlook / Google 日历）">📥 导入ICS</button>
      <input id="ics-file" type="file" accept=".ics,text/calendar" hidden>
      <button id="evt-img" title="拍下或截图课表，自动识别每门课的时间和星期">📷 图片导入课表</button>
      <input id="evt-img-file" type="file" accept="image/*" hidden>
      <span id="ics-result" class="ics-result"></span>
    </div>
    <ul id="evt-list"></ul>
  </section>
  <section class="panel" id="panel-params">
    <h2>🎛️ 强度参数</h2>
    <div class="grid params">
      <label>日负荷上限(分) <input id="p-load" type="number"></label>
      <label>单块上限(分) <input id="p-bmax" type="number"></label>
      <label>单块下限(分) <input id="p-bmin" type="number"></label>
      <label>最小休息(分) <input id="p-break" type="number"></label>
      <label>连续工作上限(分) <input id="p-chain" type="number"></label>
      <label>精力类型
        <select id="p-energy">
          <option value="early">早起型</option>
          <option value="night">夜猫型</option>
          <option value="flat">全天平均</option>
        </select>
      </label>
    </div>
    <details style="margin-top:10px">
      <summary style="cursor:pointer;color:#6b7280;font-size:13px;user-select:none">🤖 AI 智能解析设置（可选，不填则用本地规则）</summary>
      <div class="grid params" style="margin-top:8px">
        <label>接口地址 (OpenAI 兼容) <input id="llm-endpoint" placeholder="https://api.openai.com/v1/chat/completions" style="width:100%"></label>
        <label>模型名 <input id="llm-model" placeholder="gpt-4o-mini" style="width:100%"></label>
        <label style="grid-column:1/-1">API Key <input id="llm-key" type="password" placeholder="sk-..." style="width:100%"></label>
      </div>
      <div class="row" style="margin-top:8px">
        <button id="llm-save" class="mini">💾 保存 AI 设置</button>
        <button id="llm-clear" class="mini">🧹 清除（只用规则解析）</button>
        <span id="llm-status" class="hint" style="margin:0"></span>
      </div>
      <p class="hint">配置后，一句话加计划将先交给大模型理解（更懂「下周三前把PPT弄好」这类复杂表达），8 秒无响应或失败自动退回本地规则解析。Key 仅保存在本机浏览器。</p>
    </details>
  </section>
  <section class="panel wide" id="panel-timeline">
    <h2>🕐 今日时间轴 <span id="today-label"></span>
      <button id="view-toggle" class="mini" title="切换日/周视图">切周视图</button></h2>
    <div id="warnings"></div>
    <div id="timeline-wrap"><div id="timeline"></div></div>
    <div id="week-view" class="hidden"></div>
  </section>
</main>
<footer>桌面计划小人 · 本地优先 · 数据仅保存在本机浏览器 · <a href="https://github.com/Xixi979/desktop-plan-pal" target="_blank">GitHub</a></footer>
<script>
${engineJs}
</script>
<script>
${storeJs}
</script>
<script>
${checklistJs}
${icsJs}
</script>
<script>
${nlpJs}
${timetableJs}
</script>
<script>
${petJs}
</script>
<script>
${appJs}
</script>
</body>
</html>
`;

writeFileSync(join(root, 'ui', 'index.html'), html, 'utf8');

// 自测页：index.html + 测试注入脚本（真实点击自测，无头 Edge 运行后检查 selftest-out）
const selftestJs = read('ui/selftest.inject.js');
const selftestHtml = html.replace(
  '</body>',
  '<div id="selftest-out" style="position:fixed;top:0;left:0;z-index:99999;background:#ff0;color:#000;font-size:10px;white-space:pre-wrap;max-width:100%">pending</div>\n<script>\n'
    + selftestJs + '\n</script>\n</body>',
);
writeFileSync(join(root, 'ui', 'selftest.html'), selftestHtml, 'utf8');

// 桌宠独立小窗（Edge --app 模式打开，悬浮桌面）：只含小人 + 气泡，读共享 localStorage 联动
const petStandaloneJs = read('ui/src/pet-standalone.js');
const petHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>计划小人</title>
<style>
${css}
html, body {
  margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
  background: linear-gradient(160deg, #1e2440 0%, #2a3358 60%, #35406b 100%);
  border-radius: 14px; user-select: none;
}
/* Electron 透明壳：背景全透明，只剩小人与气泡浮在桌面上 */
html.in-electron, body.in-electron { background: transparent !important; border-radius: 0; }
/* 关闭按钮：挂在小人右上角，鼠标悬停到小人上才浮现 */
.pet-win-close {
  display: none; position: absolute; top: -6px; right: -6px; z-index: 100;
  width: 22px; height: 22px; border: none; border-radius: 50%;
  background: rgba(30,36,64,.55); color: #fff;
  font-size: 12px; line-height: 22px; text-align: center; cursor: pointer;
}
#pet:hover .pet-win-close { display: block; }
.pet-win-close:hover { background: #e5484d; color: #fff; }
#pet {
  position: fixed; left: calc(50% - 75px); right: auto; bottom: 18px;
  width: 150px; height: 150px;
}
#pet-bubble {
  left: 50%; right: auto; transform: translateX(-50%); bottom: calc(100% + 10px);
  max-width: 230px; font-size: 13px;
}
</style>
</head>
<body>
<div id="pet"><div id="pet-bubble">加载中…</div></div>
<script>
${petJs}
</script>
<script>
${petStandaloneJs}
</script>
</body>
</html>
`;
writeFileSync(join(root, 'ui', 'pet.html'), petHtml, 'utf8');

console.log(`✓ 已生成 ui/index.html（${(html.length / 1024).toFixed(1)} KB，自包含单文件）`);
console.log(`✓ 已生成 ui/selftest.html（${(selftestHtml.length / 1024).toFixed(1)} KB，自测页）`);
console.log(`✓ 已生成 ui/pet.html（${(petHtml.length / 1024).toFixed(1)} KB，桌面悬浮小人窗）`);
