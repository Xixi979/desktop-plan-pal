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

const appJs = read('ui/src/app.js');
const css = read('ui/src/style.css');

const html = `<!DOCTYPE html>
<!-- 本文件由 core/scripts/build-browser.mjs 自动生成，请勿手改；修改 ui/src/ 下源码后重新构建 -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>桌面计划小人 · v0.1</title>
<style>
${css}
</style>
</head>
<body>
<div id="pet">🧑‍💻<div id="pet-bubble">加载中…</div></div>
<header>
  <h1>桌面计划小人 <span class="ver">v0.1</span></h1>
  <div class="header-actions">
    <button id="btn-reschedule">🔄 重新排程</button>
    <button id="btn-undo">↩️ 撤销</button>
    <button id="btn-export">📤 导出数据</button>
    <button id="btn-clear" class="danger">🗑️ 清空数据</button>
  </div>
</header>
<main>
  <section class="panel" id="panel-quick">
    <h2>⚡ 一句话加计划</h2>
    <div class="row">
      <input id="quick-input" placeholder="例如：写实验报告 3小时 周五前（自动识别时长/DDL/类别）">
      <button id="quick-add">添加</button>
    </div>
    <div id="quick-preview" class="preview"></div>
  </section>
  <section class="panel">
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
  <section class="panel">
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
    </div>
    <ul id="evt-list"></ul>
  </section>
  <section class="panel">
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
  </section>
  <section class="panel wide">
    <h2>🕐 今日时间轴 <span id="today-label"></span></h2>
    <div id="warnings"></div>
    <div id="timeline-wrap"><div id="timeline"></div></div>
  </section>
</main>
<footer>桌面计划小人 · 本地优先 · 数据仅保存在本机浏览器 · <a href="https://github.com/" target="_blank">GitHub</a></footer>
<script>
${engineJs}
</script>
<script>
${storeJs}
</script>
<script>
${appJs}
</script>
</body>
</html>
`;

writeFileSync(join(root, 'ui', 'index.html'), html, 'utf8');
console.log(`✓ 已生成 ui/index.html（${(html.length / 1024).toFixed(1)} KB，自包含单文件）`);
