/* 桌面计划小人 v0.1 界面逻辑（纯 JS，无依赖）
 * v0.1.5 新增：多通道录入（一句话/图片/链接）、达标清单（逐条打勾）、计划关联文件夹 */
(function () {
  'use strict';
  const Engine = window.Engine;
  const Store = window.Store;
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  /** HTML 转义：所有用户输入内容插入 DOM 前必须经过这里 */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---- 浏览器存储适配器（与 core 的 StorageAdapter 接口一致）----
  class LocalStorageAdapter {
    constructor(key) { this.key = key; }
    log() {
      try { return JSON.parse(localStorage.getItem(this.key + '.log') || '[]'); }
      catch (e) { return []; }
    }
    appendEntry(e) {
      const a = this.log();
      a.push(e);
      localStorage.setItem(this.key + '.log', JSON.stringify(a));
    }
    readEntries() { return this.log(); }
    saveSnapshot(s) { localStorage.setItem(this.key + '.snap', JSON.stringify(s)); }
    loadSnapshot() {
      try { return JSON.parse(localStorage.getItem(this.key + '.snap') || 'null'); }
      catch (e) { return null; }
    }
  }

  const CATEGORY_COLORS = {
    学习: '#7c9cf5', 英语: '#f5a97c', 健身: '#7cd6a0', 阅读: '#c47cf5',
    刷题: '#f5d47c', 报告: '#7cc4f5', 其他: '#b0b7c3',
  };
  const colorOf = (c) => CATEGORY_COLORS[c] || CATEGORY_COLORS['其他'];

  const ENERGY_PRESETS = {
    early: [1,1,1,1,1,1,2,3,4,5,5,4,4,3,3,3,3,2,2,2,1,1,1,1],
    night: [1,1,1,1,2,2,2,2,3,3,3,3,3,3,3,4,4,4,5,5,5,4,3,2],
    flat: new Array(24).fill(3),
  };

  const store = new Store.PlanStore(new LocalStorageAdapter('plan-pal'), 'browser');
  let blocks = [];

  // ---- 一句话解析（规则版；LLM 双路由在 v0.2 接入）----
  function parseQuick(text) {
    const t = text.trim();
    const mh = /(\d+(?:\.\d+)?)\s*(?:个)?小时(半)?/.exec(t);
    const mm = /(\d+)\s*分钟/.exec(t);
    let minutes = 60;
    if (mh) minutes = Math.round(parseFloat(mh[1]) * 60 + (mh[2] ? 30 : 0));
    else if (mm) minutes = parseInt(mm[1], 10);

    const base = new Date();
    const at = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T22:00`;
    let deadline = null;
    const iso = /(\d{4}-\d{2}-\d{2})/.exec(t);
    const md = /(\d{1,2})月(\d{1,2})[日号]/.exec(t);
    const rel = /(今天|明天|后天)/.exec(t);
    const wk = /(?:周|星期)([一二三四五六日天])/.exec(t);
    if (iso) deadline = iso[1] + 'T22:00';
    else if (md) deadline = at(new Date(base.getFullYear(), +md[1] - 1, +md[2]));
    else if (rel) {
      const off = { 今天: 0, 明天: 1, 后天: 2 }[rel[1]];
      deadline = at(new Date(base.getTime() + off * 86400000));
    } else if (wk) {
      const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
      let diff = (map[wk[1]] - base.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      deadline = at(new Date(base.getTime() + diff * 86400000));
    }

    const catMap = [['单词', '英语'], ['英语', '英语'], ['健身', '健身'], ['运动', '健身'],
      ['刷题', '刷题'], ['习题', '刷题'], ['作业', '刷题'], ['阅读', '阅读'],
      ['读书', '阅读'], ['实验', '报告'], ['报告', '报告'], ['复习', '学习']];
    let category = '学习';
    for (const [k, v] of catMap) { if (t.includes(k)) { category = v; break; } }

    const title = t
      .replace(/(\d+(?:\.\d+)?)\s*(?:个)?小时(半)?|(\d+)\s*分钟/g, '')
      .replace(/(今天|明天|后天|周[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]|\d{4}-\d{2}-\d{2})之?前?(完成|搞定|结束)/g, '')
      .replace(/(今天|明天|后天|周[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]|\d{4}-\d{2}-\d{2})/g, '')
      .trim() || '新计划';

    return {
      title, category, estimatedMinutes: minutes,
      priority: /紧急|尽快|ASAP/.test(t) ? 5 : 3,
      splittable: minutes >= 50, minBlockMinutes: Math.min(25, minutes),
      deadline,
    };
  }

  // ---- 链接识别（本地规则版）----
  const SITE_MAP = [
    [/bilibili\.com|b23\.tv/, 'B站视频', '学习'],
    [/github\.com/, 'GitHub 仓库', '学习'],
    [/docs\.qq\.com/, '腾讯文档', '报告'],
    [/mp\.weixin\.qq\.com/, '微信公众号文章', '阅读'],
    [/zhihu\.com/, '知乎', '阅读'],
    ['icourse163.org', '慕课网课', '学习'],
    ['xuetangx.com', '学堂在线', '学习'],
    ['chaoxing.com', '超星学习通', '学习'],
    ['arxiv.org', 'arXiv 论文', '学习'],
    ['cnki.net', '知网文献', '学习'],
    ['edu.cn', '教务/学校页面', '其他'],
  ];
  function parseLink(raw) {
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw.trim() : 'https://' + raw.trim()); }
    catch (e) { return null; }
    let site = '网页', cat = '学习';
    for (const [pat, name, c] of SITE_MAP) {
      const hit = pat instanceof RegExp ? pat.test(u.hostname) : u.hostname.includes(pat);
      if (hit) { site = name; cat = c; break; }
    }
    // 标题建议：取路径最后一段有意义的内容（支持中文 slug）
    let slug = '';
    const segs = u.pathname.split('/').filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = decodeURIComponent(segs[i]);
      if (/[\u4e00-\u9fa5A-Za-z]{2,}/.test(s) && !/^(index|html?|main)$/i.test(s)) { slug = s; break; }
    }
    if (!slug && u.searchParams.get('title')) slug = u.searchParams.get('title');
    const title = slug ? `${site}：${slug}` : site;
    return { url: u.href, site, title, category: cat };
  }

  // ---- 图片录入（本地规则版：压缩预览 + 文件名/备注识别；OCR 在 v0.2 接入）----
  function compressImage(file, maxW = 640) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }
  let pendingImage = null; // { dataUrl, name }
  async function acceptImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const dataUrl = await compressImage(file);
      pendingImage = { dataUrl, name: file.name.replace(/\.[a-z0-9]+$/i, '') };
      $('img-thumb').src = dataUrl;
      $('img-title').value = pendingImage.name || '';
      $('img-confirm').classList.remove('hidden');
    } catch (e) { alert(e.message); }
  }
  function addImageTask() {
    if (!pendingImage) return;
    const note = $('img-note').value.trim();
    const parsed = note ? parseQuick(note) : null;
    const minutes = parseInt($('img-min').value, 10) || (parsed ? parsed.estimatedMinutes : 60);
    store.addTask({
      title: $('img-title').value.trim() || '图片计划',
      category: parsed ? parsed.category : '其他',
      estimatedMinutes: minutes,
      priority: parsed ? parsed.priority : 3,
      splittable: minutes >= 50, minBlockMinutes: Math.min(25, minutes),
      deadline: parsed ? parsed.deadline : null,
      source: 'image',
      imageUrl: pendingImage.dataUrl,
      folderPath: null, checklist: [],
    }).then(() => {
      pendingImage = null;
      $('img-note').value = '';
      $('img-confirm').classList.add('hidden');
      $('img-thumb').src = '';
      $('img-file').value = '';
      renderTasks(); reschedule();
    });
  }

  let pendingLink = null;
  function parseLinkInput() {
    const r = parseLink($('link-input').value);
    if (!r) { $('link-preview').textContent = '⚠️ 无法识别该链接，请检查格式'; return; }
    pendingLink = r;
    $('link-preview').textContent = `→ 识别为「${r.site}」 建议类别：${r.category}`;
    $('link-title').value = r.title;
    $('link-cat').value = r.category;
    $('link-confirm').classList.remove('hidden');
  }
  function addLinkTask() {
    if (!pendingLink) return;
    const minutes = parseInt($('link-min').value, 10) || 60;
    store.addTask({
      title: $('link-title').value.trim() || pendingLink.site,
      category: $('link-cat').value.trim() || pendingLink.category,
      estimatedMinutes: minutes,
      priority: 3, splittable: minutes >= 50, minBlockMinutes: Math.min(25, minutes),
      deadline: null,
      source: 'link', linkUrl: pendingLink.url,
      folderPath: null, checklist: [],
    }).then(() => {
      pendingLink = null;
      $('link-input').value = '';
      $('link-preview').textContent = '';
      $('link-confirm').classList.add('hidden');
      renderTasks(); reschedule();
    });
  }

  // ---- 达标清单 ----
  const ckId = () => 'ck-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function ckStats(t) {
    const list = t.checklist || [];
    return { total: list.length, done: list.filter((c) => c.done).length };
  }
  async function addCheckItem(tid, text) {
    const t = store.getTask(tid);
    if (!t || !text.trim()) return;
    const list = [...(t.checklist || []), { id: ckId(), text: text.trim(), done: false }];
    await store.updateTask(tid, { checklist: list });
    renderTasks();
  }
  async function toggleCheck(tid, ckid, checked) {
    const t = store.getTask(tid);
    if (!t) return;
    const wasDone = t.status === 'done';
    const list = (t.checklist || []).map((c) => c.id === ckid
      ? { ...c, done: checked, doneAt: checked ? new Date().toISOString() : undefined } : c);
    await store.updateTask(tid, { checklist: list }); // 达标自动完成/回退规则在数据层统一生效
    const nowDone = store.getTask(tid)?.status === 'done';
    renderTasks();
    if (wasDone !== nowDone) reschedule(); // 完成状态变化后腾出/释放时间，重排剩余计划
  }

  // ---- 文件夹 ----
  async function saveFolder(tid) {
    const input = document.querySelector(`input[data-folder="${tid}"]`);
    if (!input) return;
    await store.updateTask(tid, { folderPath: input.value.trim() || undefined });
    renderTasks();
  }
  async function copyFolder(tid) {
    const t = store.getTask(tid);
    if (!t || !t.folderPath) return;
    try { await navigator.clipboard.writeText(t.folderPath); } catch (e) { /* 忽略 */ }
  }

  // ---- 排程 ----
  function reschedule() {
    const tasks = store.listTasks().filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    const day = todayStr();
    const r = Engine.greedySchedule(
      tasks, store.listFixedEvents(), store.getIntensity(),
      day + 'T00:00', day + 'T24:00',
    );
    blocks = r.blocks;
    localStorage.setItem('plan-pal.blocks', JSON.stringify(blocks));
    renderTimeline();
    renderWarnings(r.capacityWarnings);
    updatePet();
  }

  function renderWarnings(list) {
    $('warnings').innerHTML = (list || []).map((w) =>
      `<div class="warning">⚠️ ${esc(w.message)}</div>`).join('');
  }

  // ---- 时间轴渲染（07:00-24:00）----
  const PXH = 44; // 每小时像素
  function renderTimeline() {
    const tl = $('timeline');
    const dayStart = 7 * 60, dayEnd = 24 * 60;
    tl.style.height = ((dayEnd - dayStart) / 60) * PXH + 'px';
    let html = '';
    for (let h = 7; h <= 23; h++) {
      const top = ((h * 60 - dayStart) / 60) * PXH;
      html += `<div class="hour-line" style="top:${top}px"><span>${pad(h)}:00</span></div>`;
    }
    const events = store.listFixedEvents();
    const day = todayStr();
    for (const ev of events) {
      if (!Engine.occursOn(ev, day)) continue;
      const s = ev.startTime.split(':').map(Number);
      const e = ev.endTime === '24:00' ? [24, 0] : ev.endTime.split(':').map(Number);
      const sm = s[0] * 60 + s[1], em = e[0] * 60 + e[1];
      if (em <= dayStart || sm >= dayEnd) continue;
      const top = (Math.max(sm, dayStart) - dayStart) / 60 * PXH;
      const h = (Math.min(em, dayEnd) - Math.max(sm, dayStart)) / 60 * PXH;
      html += `<div class="block fixed" style="top:${top}px;height:${h}px" title="${esc(ev.title)}">
        <span class="b-title">🔒 ${esc(ev.title)}</span></div>`;
    }
    for (const b of blocks) {
      const sm = Engine.toMin(b.start) && new Date(b.start).getHours() * 60 + new Date(b.start).getMinutes();
      const em = new Date(b.end).getHours() * 60 + new Date(b.end).getMinutes();
      if (em <= dayStart || sm >= dayEnd) continue;
      const task = b.taskId ? store.getTask(b.taskId) : null;
      const label = b.type === 'break' ? '☕ 休息' : (task ? task.title : '计划');
      const color = b.type === 'break' ? '#86efac' : (task ? colorOf(task.category) : '#b0b7c3');
      const top = (Math.max(sm, dayStart) - dayStart) / 60 * PXH;
      const h = (Math.min(em, dayEnd) - Math.max(sm, dayStart)) / 60 * PXH;
      html += `<div class="block ${b.type}" style="top:${top}px;height:${h - 2}px;background:${color}" title="${esc(label)}">
        <span class="b-title">${esc(label)} · ${b.start.slice(11)}-${b.end.slice(11)}</span></div>`;
    }
    const nm = nowMinutes();
    if (nm > dayStart && nm < dayEnd) {
      html += `<div class="now-line" style="top:${(nm - dayStart) / 60 * PXH}px"></div>`;
    }
    tl.innerHTML = html;
    $('today-label').textContent = `（${day} 周${'日一二三四五六'[new Date().getDay()]}）`;
  }

  // ---- 任务列表（含达标清单 + 文件夹 + 附件详情）----
  function renderTasks() {
    const tasks = store.listTasks();
    $('task-list').innerHTML = tasks.map((t) => {
      const ck = ckStats(t);
      const badges = [
        t.source === 'image' && t.imageUrl ? '<span class="badge" title="来自图片录入">🖼️</span>' : '',
        t.source === 'link' && t.linkUrl ? '<span class="badge" title="来自链接录入">🔗</span>' : '',
        t.folderPath ? '<span class="badge" title="已关联资料文件夹">📁</span>' : '',
        ck.total ? `<span class="badge ck-badge" title="达标进度">${ck.done}/${ck.total}</span>` : '',
      ].join('');
      const ckHtml = (t.checklist || []).map((c) => `
        <label class="ck-item ${c.done ? 'ck-done' : ''}">
          <input type="checkbox" data-act="ck-toggle" data-tid="${t.id}" data-ckid="${c.id}" ${c.done ? 'checked' : ''}>
          <span>${esc(c.text)}</span>
        </label>`).join('');
      return `
      <li class="${t.status === 'done' ? 'done' : ''}">
        <div class="t-main">
          <span class="dot" style="background:${colorOf(t.category)}"></span>
          <b>${esc(t.title)}</b>${badges}
          <span class="meta">${esc(t.category)} · ${t.estimatedMinutes}分钟 · 优先级${t.priority}${t.deadline ? ' · DDL ' + esc(t.deadline.replace('T', ' ')) : ''}</span>
          <span class="ops">
            <button data-act="done" data-id="${t.id}" title="完成">✔</button>
            <button data-act="del" data-id="${t.id}" title="删除">✕</button>
          </span>
        </div>
        <details class="t-detail">
          <summary>达标要求 & 资料</summary>
          <div class="ck-box">
            ${ckHtml || '<p class="hint">还没有达标要求，添加后逐条打勾，全部完成即自动达标 ✔</p>'}
            <div class="row ck-add-row">
              <input data-ck-input="${t.id}" placeholder="添加达标要求，如：完成第3章习题并自查" style="flex:1;min-width:180px">
              <button data-act="ck-add" data-id="${t.id}">➕ 加一条</button>
            </div>
          </div>
          <div class="folder-box row">
            <span title="该任务产出的文件统一放这里">📁</span>
            <input data-folder="${t.id}" placeholder="资料文件夹路径，如 C:\\Users\\你\\Desktop\\高数作业" value="${esc(t.folderPath || '')}" style="flex:1;min-width:180px">
            <button data-act="folder-save" data-id="${t.id}" title="保存路径">保存</button>
            <button data-act="folder-copy" data-id="${t.id}" title="复制路径">📋</button>
            ${window.__TAURI__ ? `<button data-act="folder-open" data-id="${t.id}" title="打开文件夹">📂</button>` : ''}
          </div>
          ${t.imageUrl ? `<div class="attach-box"><img src="${t.imageUrl}" alt="附件图片" class="attach-img"></div>` : ''}
          ${t.linkUrl ? `<div class="attach-box">🔗 <a href="${esc(t.linkUrl)}" target="_blank" rel="noopener">${esc(t.linkUrl)}</a></div>` : ''}
        </details>
      </li>`;
    }).join('') || '<li class="empty">还没有计划，试试上方三种录入方式：一句话 / 图片 / 链接～</li>';
  }

  function renderEvents() {
    const evs = store.listFixedEvents();
    $('evt-list').innerHTML = evs.map((e) => `
      <li><span class="dot" style="background:#94a3b8"></span>
        <b>${esc(e.title)}</b>
        <span class="meta">${e.startTime}-${e.endTime} · ${e.rrule.includes('DAILY') ? '每天' : e.rrule ? '按周重复' : '仅一次'}</span>
        <span class="ops"><button data-act="delevt" data-id="${e.id}" title="删除">✕</button></span>
      </li>`).join('') || '<li class="empty">还没有固定安排，可点击「载入示例课表」</li>';
  }

  // ---- 小人 ----
  function updatePet() {
    const pet = $('pet');
    const bubble = $('pet-bubble');
    const nm = nowMinutes();
    const current = blocks.find((b) => {
      const s = new Date(b.start).getHours() * 60 + new Date(b.start).getMinutes();
      const e = new Date(b.end).getHours() * 60 + new Date(b.end).getMinutes();
      return s <= nm && nm < e;
    });
    if (current) {
      const task = current.taskId ? store.getTask(current.taskId) : null;
      const end = new Date(current.end).getHours() * 60 + new Date(current.end).getMinutes();
      if (current.type === 'break') {
        pet.firstChild.textContent = '🍵';
        bubble.textContent = `休息中，还剩 ${end - nm} 分钟～`;
      } else if (task && task.checklist && task.checklist.length) {
        const ck = ckStats(task);
        pet.firstChild.textContent = '🧑‍💻';
        bubble.textContent = `正在做「${task.title}」，达标 ${ck.done}/${ck.total}，还剩 ${end - nm} 分钟！`;
      } else {
        pet.firstChild.textContent = '🧑‍💻';
        bubble.textContent = `正在做「${task ? task.title : '计划'}」，还剩 ${end - nm} 分钟！`;
      }
      return;
    }
    const next = blocks
      .filter((b) => new Date(b.start).getHours() * 60 + new Date(b.start).getMinutes() > nm)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    pet.firstChild.textContent = '🚶';
    bubble.textContent = next
      ? `接下来 ${next.start.slice(11)}：${next.taskId && store.getTask(next.taskId) ? store.getTask(next.taskId).title : '计划'}`
      : '今天的计划都完成啦，好好休息！';
  }

  // ---- 事件绑定 ----
  function bindTabs() {
    $('entry-tabs').onclick = (ev) => {
      const tab = ev.target.closest('.tab');
      if (!tab) return;
      for (const b of $('entry-tabs').querySelectorAll('.tab')) b.classList.toggle('active', b === tab);
      for (const pane of document.querySelectorAll('#panel-quick .tabpane')) {
        pane.classList.toggle('hidden', pane.id !== 'pane-' + tab.dataset.tab);
      }
    };
  }

  function bind() {
    bindTabs();
    // 通道一：一句话
    $('quick-add').onclick = async () => {
      const parsed = parseQuick($('quick-input').value);
      $('quick-preview').textContent = `→ 「${parsed.title}」 ${parsed.category} ${parsed.estimatedMinutes}分钟 优先级${parsed.priority}${parsed.deadline ? ' DDL ' + parsed.deadline.replace('T', ' ') : ''}`;
      await store.addTask({ ...parsed, source: 'text', folderPath: null, checklist: [] });
      $('quick-input').value = '';
      renderTasks();
      reschedule();
    };
    // 通道二：图片
    $('img-drop').onclick = () => $('img-file').click();
    $('img-file').onchange = () => acceptImageFile($('img-file').files[0]);
    $('img-drop').ondragover = (e) => { e.preventDefault(); $('img-drop').classList.add('dragging'); };
    $('img-drop').ondragleave = () => $('img-drop').classList.remove('dragging');
    $('img-drop').ondrop = (e) => {
      e.preventDefault();
      $('img-drop').classList.remove('dragging');
      acceptImageFile(e.dataTransfer.files[0]);
    };
    // Ctrl+V 直接粘贴截图
    document.addEventListener('paste', (e) => {
      if (!$('pane-image') || $('pane-image').classList.contains('hidden')) return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) acceptImageFile(item.getAsFile());
    });
    $('img-add').onclick = addImageTask;
    // 通道三：链接
    $('link-parse').onclick = parseLinkInput;
    $('link-input').onkeydown = (e) => { if (e.key === 'Enter') parseLinkInput(); };
    $('link-add').onclick = addLinkTask;

    // 计划列表：按钮点击 + 勾选 + 回车加达标项
    $('task-list').onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === 'done') {
        const t = store.getTask(id);
        const ck = ckStats(t);
        if (ck.total > 0 && ck.done < ck.total &&
            !confirm(`「${t.title}」还有 ${ck.total - ck.done} 项达标要求未完成，确定直接标记完成？`)) return;
        await store.updateTask(id, { status: 'done' });
      } else if (btn.dataset.act === 'del') {
        await store.deleteTask(id);
      } else if (btn.dataset.act === 'ck-add') {
        const input = document.querySelector(`input[data-ck-input="${id}"]`);
        if (input) { await addCheckItem(id, input.value); }
        return; // addCheckItem 内部已渲染
      } else if (btn.dataset.act === 'folder-save') {
        await saveFolder(id);
        return;
      } else if (btn.dataset.act === 'folder-copy') {
        await copyFolder(id);
        return;
      } else if (btn.dataset.act === 'folder-open') {
        // Tauri 桌面端：调用 rust 侧 open_folder 命令（v0.2 接入）；浏览器端降级为复制
        await copyFolder(id);
        return;
      }
      renderTasks();
      reschedule();
    };
    $('task-list').onchange = (ev) => {
      const cb = ev.target.closest('input[data-act="ck-toggle"]');
      if (!cb) return;
      toggleCheck(cb.dataset.tid, cb.dataset.ckid, cb.checked);
    };
    $('task-list').onkeydown = (ev) => {
      const input = ev.target.closest('input[data-ck-input]');
      if (input && ev.key === 'Enter') addCheckItem(input.dataset.ckInput, input.value);
    };
    $('evt-add').onclick = async () => {
      const title = $('evt-title').value.trim();
      if (!title) return;
      await store.addFixedEvent({
        title,
        startTime: $('evt-start').value || '08:00',
        endTime: $('evt-end').value || '09:40',
        rrule: $('evt-freq').value === 'daily' ? 'FREQ=DAILY' : '',
        effectiveFrom: todayStr(),
      });
      $('evt-title').value = '';
      renderEvents();
      reschedule();
    };
    $('evt-sample').onclick = async () => {
      const have = (t) => store.listFixedEvents().some((e) => e.title === t);
      const day = todayStr();
      if (!have('睡眠')) await store.addFixedEvent({ title: '睡眠', startTime: '00:00', endTime: '07:00', rrule: 'FREQ=DAILY', effectiveFrom: '2026-11-01' });
      if (!have('高数课')) await store.addFixedEvent({ title: '高数课', startTime: '08:00', endTime: '09:40', rrule: 'FREQ=WEEKLY;BYDAY=MO', effectiveFrom: '2026-11-02' });
      if (!have('专业课')) await store.addFixedEvent({ title: '专业课', startTime: '10:00', endTime: '11:40', rrule: 'FREQ=WEEKLY;BYDAY=MO', effectiveFrom: '2026-11-02' });
      if (!have('体育课')) await store.addFixedEvent({ title: '体育课', startTime: '14:00', endTime: '15:40', rrule: 'FREQ=WEEKLY;BYDAY=MO', effectiveFrom: '2026-11-02' });
      renderEvents();
      reschedule();
    };
    $('btn-reschedule').onclick = reschedule;
    $('btn-undo').onclick = async () => {
      if (await store.undo()) { renderTasks(); renderEvents(); reschedule(); }
    };
    $('btn-export').onclick = () => {
      const data = {
        tasks: store.listTasks(), fixedEvents: store.listFixedEvents(),
        intensity: store.getIntensity(), blocks,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `plan-pal-${todayStr()}.json`;
      a.click();
    };
    $('btn-clear').onclick = () => {
      if (!confirm('确定清空本机所有数据？（不可恢复）')) return;
      localStorage.removeItem('plan-pal.log');
      localStorage.removeItem('plan-pal.snap');
      localStorage.removeItem('plan-pal.blocks');
      location.reload();
    };
    // 强度参数：修改即保存并重排
    const paramIds = [['p-load', 'dailyLoadCapMinutes'], ['p-bmax', 'blockMaxMinutes'],
      ['p-bmin', 'blockMinMinutes'], ['p-break', 'minBreakMinutes'], ['p-chain', 'consecutiveWorkCapMinutes']];
    for (const [id, key] of paramIds) {
      $(id).onchange = async () => {
        const p = store.getIntensity();
        p[key] = parseInt($(id).value, 10) || p[key];
        await store.setIntensity(p);
        reschedule();
      };
    }
    $('p-energy').onchange = async () => {
      const p = store.getIntensity();
      p.energyCurve = ENERGY_PRESETS[$('p-energy').value];
      await store.setIntensity(p);
      reschedule();
    };
  }

  function fillParams() {
    const p = store.getIntensity();
    if (!p) return;
    $('p-load').value = p.dailyLoadCapMinutes;
    $('p-bmax').value = p.blockMaxMinutes;
    $('p-bmin').value = p.blockMinMinutes;
    $('p-break').value = p.minBreakMinutes;
    $('p-chain').value = p.consecutiveWorkCapMinutes;
  }

  // ---- 启动 ----
  (async function init() {
    await store.open();
    if (!store.getIntensity()) {
      await store.setIntensity({
        id: 'default', effectiveDate: todayStr(),
        dailyLoadCapMinutes: 360, blockMaxMinutes: 90, blockMinMinutes: 25,
        minBreakMinutes: 10, consecutiveWorkCapMinutes: 120,
        energyCurve: ENERGY_PRESETS.early, categoryQuotas: {}, nudgeLevel: 2,
      });
    }
    try { blocks = JSON.parse(localStorage.getItem('plan-pal.blocks') || '[]'); } catch (e) { blocks = []; }
    fillParams();
    bind();
    renderTasks();
    renderEvents();
    if (!blocks.length) reschedule(); else { renderTimeline(); renderWarnings([]); }
    updatePet();
    setInterval(updatePet, 15000);
    setInterval(renderTimeline, 60000); // 刷新当前时间线
  })();
})();
