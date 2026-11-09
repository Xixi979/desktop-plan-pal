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
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  /** 轻提示（Toast）：替代静默 return，操作无效果时必须给用户反馈 */
  let toastTimer = null;
  function showToast(msg) {
    let el = document.getElementById('pp-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pp-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ---- 浏览器存储适配器（与 core 的 StorageAdapter 接口一致；经 LS 安全读写）----
  class LocalStorageAdapter {
    constructor(key) { this.key = key; }
    log() {
      try { return JSON.parse(LS.get(this.key + '.log') || '[]'); }
      catch (e) { return []; }
    }
    appendEntry(e) {
      const a = this.log();
      a.push(e);
      LS.set(this.key + '.log', JSON.stringify(a));
    }
    readEntries() { return this.log(); }
    saveSnapshot(s) { LS.set(this.key + '.snap', JSON.stringify(s)); }
    loadSnapshot() {
      try { return JSON.parse(LS.get(this.key + '.snap') || 'null'); }
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
  window.__pal = { store }; // 自测/调试句柄
  let blocks = [];

  // ---- 安全存储：预览沙盒/隐私模式下 localStorage 可能被禁用（访问即抛错），
  //      统一经 LS 读写，不可用时自动降级为内存存储（本次会话数据不持久化）----
  const LS_MEM = {};
  const LS = {
    ok: (() => {
      try { localStorage.setItem('__plan_pal_test', '1'); localStorage.removeItem('__plan_pal_test'); return true; }
      catch (e) { return false; }
    })(),
    get(k) { try { return localStorage.getItem(k); } catch (e) { return k in LS_MEM ? LS_MEM[k] : null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { LS_MEM[k] = v; } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) { delete LS_MEM[k]; } },
  };
  if (!LS.ok) {
    window.addEventListener('DOMContentLoaded', () => {
      const b = $('pet-bubble');
      if (b) b.textContent = '⚠️ 当前环境不支持本地存储，数据仅本次会话有效（双击本地文件打开即可持久化）';
    });
  }
  // ---- 可见错误横幅：任何脚本错误都显示在页面顶部，避免"静默失灵"----
  window.onerror = (msg, src, line) => {
    let el = document.getElementById('err-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'err-banner';
      document.body.prepend(el);
    }
    el.textContent = `⚠️ 页面脚本错误：${msg}（第 ${line || '?'} 行）`;
    return false;
  };

  // ---- 一句话解析（v0.2 双路由：下沉到 core/src/nlp.ts，本地规则 + 可选 LLM，LLM 失败自动降级）----
  function parseQuick(text) {
    const r = Nlp.parseRule(text);
    return {
      title: r.title, category: r.category, estimatedMinutes: r.estimatedMinutes,
      priority: r.priority, splittable: r.splittable, minBlockMinutes: r.minBlockMinutes,
      deadline: r.deadline, via: r.via,
    };
  }

  /** LLM 配置（存 LS，强度参数面板「AI 设置」维护）；无配置返回 null */
  function getLlmConfig() {
    try {
      const c = JSON.parse(LS.get('plan-pal.llm') || 'null');
      if (c && c.endpoint && c.apiKey && c.model) return c;
    } catch (e) { /* 忽略 */ }
    return null;
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

  // ---- 达标要求自动解析（规则版；LLM 双路由在 v0.2 接入）----
  // 备注/文本按「、；;换行/然后」拆分为多条达标要求，剔除时长词
  function splitSteps(text) {
    return (text || '')
      .split(/[、；;\n]+|然后|接着/)
      .map((s) => s.replace(/\d+(?:\.\d+)?\s*(?:个)?小时(半)?|\d+\s*分钟/g, '').trim())
      .filter((s) => s.length >= 2);
  }
  function genChecklistFromEntry({ note, fileNames, links, title }) {
    const items = [];
    for (const s of splitSteps(note)) items.push({ key: 'note', text: s });
    for (const n of fileNames || []) items.push({ key: 'img:' + n, text: `处理图片资料：${n}` });
    for (const l of links || []) {
      items.push({ key: 'link:main:' + l, text: `查看/学习完链接内容：${l}` });
      items.push({ key: 'link:note:' + l, text: '整理该链接内容的要点或笔记' });
    }
    if (!items.length && title) items.push({ key: 'auto', text: `完成「${title}」` });
    return items.map((it) => ({ id: ckId(), text: it.text, done: false, key: it.key }));
  }

  // ---- 计划提交：新建，或智能合并进已有计划（重复不加/缺的补/同源变动更新）----
  const normTitle = (s) => (s || '').replace(/\s+/g, '');
  async function submitPlan(pane, base, extras) {
    // pane: 'img' | 'link'；base: {title, category, minutes, priority, deadline}
    // extras: { images, linkUrls, checklist, source }
    const sel = $(pane + '-target');
    const targetId = sel ? sel.value : 'new';
    if (targetId !== 'new') {
      const t = store.getTask(targetId);
      if (!t) return null;
      const r = Checklist.mergeChecklist(t.checklist, extras.checklist);
      await store.updateTask(targetId, {
        checklist: r.list,
        images: [...(t.images || []), ...(extras.images || [])].slice(0, 12),
        linkUrls: [...(t.linkUrls || []), ...(extras.linkUrls || [])]
          .filter((u, i, a) => a.indexOf(u) === i),
      });
      return { merged: t.title, added: r.added, updated: r.updated, skipped: r.skipped };
    }
    const images = extras.images || [];
    const created = await store.addTask({
      title: base.title, category: base.category || '学习',
      estimatedMinutes: base.minutes, priority: base.priority == null ? 3 : base.priority,
      splittable: base.minutes >= 50, minBlockMinutes: Math.min(25, base.minutes),
      deadline: base.deadline || null,
      source: extras.source, folderPath: null,
      checklist: extras.checklist,
      ...(images.length ? { images } : {}),
      ...(extras.linkUrls && extras.linkUrls.length
        ? { linkUrls: extras.linkUrls, linkUrl: extras.linkUrls[0] } : {}),
    });
    return { created: created.title, added: extras.checklist.length, updated: 0, skipped: 0 };
  }
  function fmtResult(res) {
    if (!res) return '⚠️ 目标计划不存在';
    if (res.merged) {
      return `已并入「${res.merged}」：新增 ${res.added} 条、更新 ${res.updated} 条、跳过重复 ${res.skipped} 条达标要求`;
    }
    return `已新建计划「${res.created}」，自动生成 ${res.added} 条达标要求`;
  }

  // ---- 目标计划下拉：新建 or 合并到已有计划 ----
  function populateTargetSelects() {
    for (const pane of ['img', 'link']) {
      const sel = $(pane + '-target');
      if (!sel) continue;
      const prev = sel.value;
      const tasks = store.listTasks().filter((t) => t.status !== 'done' && t.status !== 'cancelled');
      sel.innerHTML = '<option value="new">➕ 新建计划</option>' +
        tasks.map((t) => `<option value="${t.id}">并入：${esc(t.title)}</option>`).join('');
      // 尽量保持用户上一次的选择
      if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    }
  }

  // ---- 图片 OCR 文字识别（Tesseract.js 中文，按需从 CDN 加载；失败自动降级）----
  let ocrScriptLoading = false;
  function ensureTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (ocrScriptLoading) return Promise.resolve(null);
    ocrScriptLoading = true;
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      const done = (t) => { ocrScriptLoading = false; resolve(t); };
      s.onload = () => done(window.Tesseract || null);
      s.onerror = () => done(null);
      document.head.appendChild(s);
      setTimeout(() => done(window.Tesseract || null), 20000);
    });
  }
  async function ocrPendingImages() {
    if (!pendingImages.length) return;
    const T = await ensureTesseract();
    if (!T) {
      $('img-feedback').textContent = '⚠️ 文字识别引擎不可用（无网络或加载超时），已按文件名生成达标要求';
      return;
    }
    try {
      const linesAll = [];
      for (let i = 0; i < pendingImages.length; i++) {
        $('img-feedback').textContent = `🔍 正在识别第 ${i + 1}/${pendingImages.length} 张图片的文字（首次需下载中文模型，请稍候）…`;
        const r = await T.recognize(pendingImages[i].ocrUrl || pendingImages[i].dataUrl, 'chi_sim+eng');
        const lines = (r.data.text || '').split(/\n+/)
          .map((s) => s.replace(/\s+/g, ' ').trim())
          .filter((s) => s.length >= 2 && !/^[\s\d\p{P}]*$/u.test(s));
        linesAll.push(...lines);
      }
      if (linesAll.length) {
        // 识别行并入备注（保留用户已填内容，去重）
        const userLines = splitSteps($('img-note').value);
        const merged = [...new Set([...userLines, ...linesAll])].join('、');
        $('img-note').value = merged;
        $('img-feedback').textContent = `✓ 已从图片识别出 ${linesAll.length} 行文字并并入达标要求来源（备注栏可编辑）`;
      } else {
        $('img-feedback').textContent = '⚠️ 图片中未识别出有效文字，已按文件名生成达标要求';
      }
    } catch (e) {
      $('img-feedback').textContent = '⚠️ 文字识别失败（' + (e.message || '未知错误') + '），已按文件名生成达标要求';
    }
  }

  // ---- 图片录入（多张；本地规则版：压缩预览 + 文件名/备注/OCR 识别）----
  function compressImage(file, maxW = 480, quality = 0.6) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL('image/jpeg', quality);
        // OCR 用更高分辨率版本（不持久化，仅内存）
        let ocrUrl = dataUrl;
        if (img.width > maxW) {
          const s2 = Math.min(1, 1200 / img.width);
          const c2 = document.createElement('canvas');
          c2.width = Math.round(img.width * s2);
          c2.height = Math.round(img.height * s2);
          c2.getContext('2d').drawImage(img, 0, 0, c2.width, c2.height);
          ocrUrl = c2.toDataURL('image/jpeg', 0.85);
        }
        URL.revokeObjectURL(url);
        resolve({ name: file.name.replace(/\.[a-z0-9]+$/i, '') || '图片', dataUrl, ocrUrl });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }
  let pendingImages = []; // { name, dataUrl, ocrUrl }
  function renderImgThumbs() {
    $('img-thumbs').innerHTML = pendingImages.map((im, i) => `
      <span class="img-chip"><img src="${im.dataUrl}" alt="${esc(im.name)}">
        <button class="chip-x" data-img-x="${i}" title="移除">×</button></span>`).join('');
    $('img-confirm').classList.toggle('hidden', pendingImages.length === 0);
    if (pendingImages.length && !$('img-title').value) {
      $('img-title').value = pendingImages.length === 1 ? pendingImages[0].name : `图片计划（${pendingImages.length} 张）`;
    }
  }
  async function acceptImageFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/')).slice(0, 12);
    if (!files.length) return;
    for (const f of files) {
      try { pendingImages.push(await compressImage(f)); } catch (e) { alert(e.message); }
    }
    renderImgThumbs();
    $('img-feedback').textContent = '🔍 准备识别图片文字…';
    ocrPendingImages(); // 自动解析图片内容 → 并入备注 → 提交时生成达标要求
  }
  async function addImageTask() {
    if (!pendingImages.length) return;
    const note = $('img-note').value.trim();
    const parsed = parseQuick(note || $('img-title').value);
    const minutes = parseInt($('img-min').value, 10) || parsed.estimatedMinutes;
    const checklist = genChecklistFromEntry({
      note, title: $('img-title').value.trim() || '图片计划',
      fileNames: pendingImages.map((im) => im.name),
    });
    const res = await submitPlan('img', {
      title: $('img-title').value.trim() || '图片计划',
      category: $('img-cat').value.trim() || parsed.category,
      minutes,
    }, { images: pendingImages, checklist, source: 'image' });
    $('img-feedback').textContent = res ? fmtResult(res) : '⚠️ 目标计划不存在';
    if (res) {
      pendingImages = [];
      $('img-note').value = '';
      $('img-title').value = '';
      $('img-file').value = '';
      renderImgThumbs();
      renderTasks(); reschedule('incremental');
    }
  }

  // ---- 链接录入（多条）----
  let pendingLinks = []; // parseLink() 结果数组
  function renderLinkList() {
    $('link-list').innerHTML = pendingLinks.map((r, i) => `
      <div class="link-chip">🔗 ${esc(r.site)}：${esc(r.title)}
        <button class="chip-x" data-link-x="${i}" title="移除">×</button></div>`).join('');
    $('link-confirm').classList.toggle('hidden', pendingLinks.length === 0);
    if (pendingLinks.length && !$('link-title').value) {
      $('link-title').value = pendingLinks.length === 1
        ? pendingLinks[0].title
        : `链接计划（${pendingLinks.length} 条）`;
    }
  }
  function parseLinkInput() {
    const parts = $('link-input').value.split(/[\s\n]+/).filter(Boolean);
    if (!parts.length) { $('link-preview').textContent = '⚠️ 请先粘贴链接'; return; }
    const ok = [], bad = [];
    for (const p of parts) {
      const r = parseLink(p);
      if (r) ok.push(r); else bad.push(p);
    }
    pendingLinks = [...pendingLinks, ...ok.filter((r) => !pendingLinks.some((x) => x.url === r.url))];
    $('link-preview').textContent = bad.length
      ? `⚠️ 无法识别：${bad.join('、')}` : `✓ 已识别 ${ok.length} 条链接`;
    renderLinkList();
    populateTargetSelects();
  }
  async function addLinkTask() {
    if (!pendingLinks.length) return;
    const note = $('link-note').value.trim();
    const parsed = parseQuick(note || $('link-title').value);
    const minutes = parseInt($('link-min').value, 10) || 60;
    const urls = pendingLinks.map((r) => r.url);
    const checklist = genChecklistFromEntry({ note, links: urls });
    const res = await submitPlan('link', {
      title: $('link-title').value.trim() || '链接计划',
      category: $('link-cat').value.trim() || pendingLinks[0].category,
      minutes,
    }, { linkUrls: urls, checklist, source: 'link' });
    $('link-preview').textContent = res ? fmtResult(res) : '⚠️ 目标计划不存在';
    if (res) {
      pendingLinks = [];
      $('link-input').value = '';
      $('link-note').value = '';
      $('link-title').value = '';
      renderLinkList();
      renderTasks(); reschedule('incremental');
    }
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
    const nowDone = (store.getTask(tid) || {}).status === 'done';
    renderTasks();
    if (wasDone !== nowDone) reschedule('incremental'); // 完成状态变化后腾出/释放时间，增量重排剩余计划
  }

  // ---- 文件夹 ----
  // v0.2.1 浏览器兜底：支持 File System Access API（Edge/Chrome）时可直接选择文件夹并列出资料清单；
  // handle 仅存内存（会话级），folderPath 持久化的是文件夹名/路径字符串，Tauri 桌面端仍用路径打开。
  const CAN_PICK_DIR = typeof window.showDirectoryPicker === 'function';
  const dirHandles = new Map(); // taskId → FileSystemDirectoryHandle

  async function saveFolder(tid) {
    const input = document.querySelector(`input[data-folder="${tid}"]`);
    if (!input) return;
    await store.updateTask(tid, { folderPath: input.value.trim() || undefined });
    renderTasks();
  }
  async function copyFolder(tid) {
    const t = store.getTask(tid);
    if (!t || !t.folderPath) return;
    try {
      await navigator.clipboard.writeText(t.folderPath);
      showToast('📁 路径已复制');
    } catch (e) { showToast('复制失败，请手动选择路径文本复制'); }
  }
  /** 浏览器选择文件夹：读出文件清单展示（最多 8 个 + 省略） */
  async function pickFolder(tid) {
    if (!CAN_PICK_DIR) { showToast('当前环境不支持选择文件夹，请手动粘贴路径'); return; }
    let handle;
    try {
      handle = await window.showDirectoryPicker();
    } catch (e) { return; // 用户取消
    }
    dirHandles.set(tid, handle);
    const names = [];
    try {
      for await (const [name, h] of handle.entries()) {
        if (names.length >= 9) break;
        if (h.kind === 'file') names.push(name);
      }
    } catch (e) { /* 权限受限时忽略清单 */ }
    await store.updateTask(tid, { folderPath: handle.name });
    showToast(`📁 已关联「${handle.name}」${names.length ? `，发现 ${names.length} 个文件` : ''}`);
    renderTasks();
  }
  /** 文件夹资料清单徽标（选过文件夹的会话内展示） */
  async function folderListing(tid) {
    const handle = dirHandles.get(tid);
    if (!handle) return '';
    const names = [];
    try {
      for await (const [name, h] of handle.entries()) {
        if (names.length >= 8) break;
        if (h.kind === 'file') names.push(name);
      }
    } catch (e) { return ''; }
    if (!names.length) return '';
    const more = names.length >= 8 ? ' …' : '';
    return `<div class="attach-box">📄 ${esc(handle.name)}：${names.map(esc).join('、')}${more}</div>`;
  }

  // ---- 排程 ----
  // mode='incremental'：增量重排（保留已开始/锁定块，只排剩余），用于新增任务与达标状态变化；
  // 默认全量重排：用于课表变更、撤销、导入、参数调整等结构性变化。
  function reschedule(mode) {
    const tasks = store.listTasks().filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    const day = todayStr();
    if (mode === 'incremental' && blocks.length) {
      const now = new Date();
      const from = day + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
      const r = Engine.incrementalReschedule(
        blocks, tasks, store.listFixedEvents(), store.getIntensity(), from,
      );
      blocks = r.blocks;
      LS.set('plan-pal.blocks', JSON.stringify(blocks));
      renderTimeline();
      renderWarnings(r.warnings);
      updatePet();
      return;
    }
    const r = Engine.greedySchedule(
      tasks, store.listFixedEvents(), store.getIntensity(),
      day + 'T00:00', day + 'T24:00',
    );
    blocks = r.blocks;
    LS.set('plan-pal.blocks', JSON.stringify(blocks));
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

  // ---- 周视图（本周一~周日，7 列日程概览）----
  let weekMode = false;
  function weekDates() {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 周一=0
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    });
  }
  function renderWeek() {
    const days = weekDates();
    const events = store.listFixedEvents();
    $('week-view').innerHTML = days.map((day, i) => {
      const items = [];
      for (const ev of events) {
        if (!ev.rrule || !Engine.occursOn(ev, day)) continue;
        items.push({ start: ev.startTime, end: ev.endTime, label: `🔒 ${ev.title}`, color: '#cbd5e1' });
      }
      for (const b of blocks) {
        if (!b.start.startsWith(day)) continue;
        const task = b.taskId ? store.getTask(b.taskId) : null;
        const label = b.type === 'break' ? '☕ 休息' : (task ? task.title : '计划');
        const color = b.type === 'break' ? '#86efac' : (task ? colorOf(task.category) : '#b0b7c3');
        items.push({ start: b.start.slice(11), end: b.end.slice(11), label, color });
      }
      items.sort((a, b2) => a.start.localeCompare(b2.start));
      const isToday = day === todayStr();
      return `<div class="week-col ${isToday ? 'today' : ''}">
        <div class="week-head">周${'一二三四五六日'[i === 6 ? 6 : i]}<small>${day.slice(5)}</small></div>
        <div class="week-body">${items.map((it) => `
          <div class="week-item" style="border-left-color:${it.color}" title="${esc(it.label)} ${it.start}-${it.end}">
            <small>${it.start}</small> ${esc(it.label)}</div>`).join('') || '<p class="hint">空</p>'}</div>
      </div>`;
    }).join('');
  }
  function setViewMode(week) {
    weekMode = week;
    $('week-view').classList.toggle('hidden', !week);
    $('timeline-wrap').classList.toggle('hidden', week);
    $('view-toggle').textContent = week ? '切日视图' : '切周视图';
    if (week) renderWeek();
  }
  $('view-toggle').onclick = () => setViewMode(!weekMode);

  // ---- 任务列表（含达标清单 + 文件夹 + 附件详情）----
  function renderTasks() {
    populateTargetSelects();
    const tasks = store.listTasks();
    $('task-list').innerHTML = tasks.map((t) => {
      const ck = ckStats(t);
      const imgCount = (t.images || []).length + (t.imageUrl ? 1 : 0);
      const linkCount = (t.linkUrls || []).length || (t.linkUrl ? 1 : 0);
      const badges = [
        imgCount ? `<span class="badge" title="附有图片资料">🖼️ ×${imgCount}</span>` : '',
        linkCount ? `<span class="badge" title="附有链接">🔗 ×${linkCount}</span>` : '',
        t.folderPath ? '<span class="badge" title="已关联资料文件夹">📁</span>' : '',
        ck.total ? `<span class="badge ck-badge" title="达标进度">${ck.done}/${ck.total}</span>` : '',
      ].join('');
      const ckHtml = (t.checklist || []).map((c) => `
        <div class="ck-item ${c.done ? 'ck-done' : ''}" data-ckrow="${c.id}">
          <label class="ck-main">
            <input type="checkbox" data-act="ck-toggle" data-tid="${t.id}" data-ckid="${c.id}" ${c.done ? 'checked' : ''}>
            <span>${esc(c.text)}</span>
          </label>
          <span class="ck-ops">
            <button data-act="ck-edit" data-tid="${t.id}" data-ckid="${c.id}" title="修改这条要求">✏️</button>
            <button data-act="ck-del" data-tid="${t.id}" data-ckid="${c.id}" title="删除这条要求">✕</button>
          </span>
        </div>`).join('');
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
            ${CAN_PICK_DIR ? `<button data-act="folder-pick" data-id="${t.id}" title="选择文件夹并列出资料">📂 选择</button>` : ''}
            ${window.__TAURI__ ? `<button data-act="folder-open" data-id="${t.id}" title="打开文件夹">📂 打开</button>` : ''}
          </div>
          <div data-folder-list="${t.id}"></div>
          ${(t.linkUrls || []).length ? `<div class="attach-box">${(t.linkUrls || []).map((u) =>
            `🔗 <a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join('<br>')}</div>`
            : (t.linkUrl ? `<div class="attach-box">🔗 <a href="${esc(t.linkUrl)}" target="_blank" rel="noopener">${esc(t.linkUrl)}</a></div>` : '')}
          ${imgCount ? '<div class="attach-box">🖼️ 已附图片资料（不在列表中展示大图，录入确认区可查看）</div>' : ''}
        </details>
      </li>`;
    }).join('') || '<li class="empty">还没有计划，试试上方三种录入方式：一句话 / 图片 / 链接～</li>';
    // 异步填充文件夹资料清单（选过文件夹的会话内）
    for (const t of tasks) {
      if (!dirHandles.has(t.id)) continue;
      folderListing(t.id).then((html) => {
        const el = document.querySelector(`[data-folder-list="${t.id}"]`);
        if (el && html) el.innerHTML = html;
      });
    }
  }

  /** BYDAY 代码 → 中文星期（如 MO,TU → 周一、周二） */
  function bydayLabel(rrule) {
    const m = (rrule || '').match(/BYDAY=([A-Z,]+)/);
    if (!m) return '按周重复';
    const names = { MO: '一', TU: '二', WE: '三', TH: '四', FR: '五', SA: '六', SU: '日' };
    return m[1].split(',').map((d) => '周' + (names[d.trim()] || d)).join('、');
  }
  function renderEvents() {
    const evs = store.listFixedEvents();
    $('evt-list').innerHTML = evs.map((e) => `
      <li><span class="dot" style="background:#94a3b8"></span>
        <b>${esc(e.title)}</b>
        <span class="meta">${e.startTime}-${e.endTime} · ${e.rrule.includes('DAILY') ? '每天' : e.rrule ? bydayLabel(e.rrule) : '仅一次'}</span>
        <span class="ops">
          <button data-act="editevt" data-id="${e.id}" title="修改这门课">✏️</button>
          <button data-act="delevt" data-id="${e.id}" title="删除">✕</button>
        </span>
      </li>`).join('') || '<li class="empty">还没有固定安排，可点击「载入示例课表」，或用「📷 图片导入课表」</li>';
  }

  // ---- 小人（v0.2：Sprite 状态机，由计划数据驱动 Pet.setState） ----
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
        Pet.setState('break', `休息中，还剩 ${end - nm} 分钟～`);
      } else if (task && task.checklist && task.checklist.length) {
        const ck = ckStats(task);
        const msg = `正在做「${task.title}」，达标 ${ck.done}/${ck.total}，还剩 ${end - nm} 分钟！`;
        // 达标全勾但块还没结束 → 庆祝
        if (ck.done >= ck.total && task.status !== 'done') Pet.setState('happy', `「${task.title}」达标啦，太棒了！🎉`);
        else Pet.setState('working', msg);
      } else {
        Pet.setState('working', `正在做「${task ? task.title : '计划'}」，还剩 ${end - nm} 分钟！`);
      }
      return;
    }
    // 深夜（23:00 后 / 6:00 前）→ 打瞌睡
    if (nm >= 23 * 60 || nm < 6 * 60) {
      Pet.setState('sleeping', '夜深了，小人先睡啦… zzZ');
      return;
    }
    // 今天所有任务全部完成 → 庆祝
    const tasks = store.listTasks();
    const todayTasks = tasks.filter((t) => t.status !== 'done');
    if (tasks.length && !todayTasks.length) {
      Pet.setState('happy', '今天的计划都完成啦，好好休息！🎉');
      return;
    }
    // 今天剩余待办总时长超出每日容量 → 疲惫提醒
    const ity = store.getIntensity();
    const cap = ity ? ity.dailyLoadCapMinutes : 360;
    const todayStr0 = todayStr();
    let load = 0;
    for (const b of blocks) {
      if (b.type === 'break' || b.taskId == null) continue;
      if (b.start.slice(0, 10) !== todayStr0) continue;
      const t = store.getTask(b.taskId);
      if (!t || t.status === 'done') continue;
      load += Math.round((new Date(b.end) - new Date(b.start)) / 60000);
    }
    if (load > cap) {
      Pet.setState('tired', `今天还有 ${Math.round(load / 60 * 10) / 10} 小时任务，超过容量 ${cap} 分钟，考虑砍掉或顺延一些吧…`);
      return;
    }
    const next = blocks
      .filter((b) => new Date(b.start).getHours() * 60 + new Date(b.start).getMinutes() > nm)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    Pet.setState('idle', next
      ? `接下来 ${next.start.slice(11)}：${next.taskId && store.getTask(next.taskId) ? store.getTask(next.taskId).title : '计划'}`
      : '今天暂时没有安排啦，去「⚡加计划」里添加吧！');
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

  // ---- 板块折叠导航：除计划列表外默认隐藏，单按钮展开/收起 ----
  const COLLAPSIBLE = ['panel-quick', 'panel-events', 'panel-params', 'panel-timeline'];
  function bindNav() {
    $('panel-nav').onclick = (ev) => {
      const b = ev.target.closest('.nav-btn');
      if (!b) return;
      const p = $(b.dataset.panel);
      const show = p.classList.contains('hidden');
      p.classList.toggle('hidden', !show);
      b.classList.toggle('active', show);
    };
  }
  function collapseAllPanels() {
    for (const id of COLLAPSIBLE) $(id).classList.add('hidden');
  }

  function bind() {
    bindTabs();
    bindNav();
    // 通道一：一句话（同名计划自动并入并完善达标要求；v0.2 双路由解析）
    $('quick-add').onclick = async () => {
      const raw = $('quick-input').value;
      if (!raw.trim()) { showToast('请先输入计划内容，如：写实验报告 3小时 周五前'); $('quick-input').focus(); return; }
      let parsed = parseQuick(raw);
      // 双路由：配置了 LLM 则尝试智能解析（失败/超时自动降级规则版）
      const llm = getLlmConfig();
      if (llm) {
        try {
          const r2 = await Nlp.parseDual(raw, { llm });
          parsed = {
            title: r2.title, category: r2.category, estimatedMinutes: r2.estimatedMinutes,
            priority: r2.priority, splittable: r2.splittable, minBlockMinutes: r2.minBlockMinutes,
            deadline: r2.deadline, via: r2.via,
          };
        } catch (e) { showToast('AI 解析失败，已用规则解析'); }
      }
      const target = store.listTasks().find((t) =>
        t.status !== 'done' && t.status !== 'cancelled' && normTitle(t.title) === normTitle(parsed.title));
      const checklist = genChecklistFromEntry({ note: raw, title: parsed.title });
      if (target) {
        const r = Checklist.mergeChecklist(target.checklist, checklist);
        await store.updateTask(target.id, { checklist: r.list });
        $('quick-preview').textContent = `→ 已并入已有计划「${target.title}」：新增 ${r.added}、更新 ${r.updated}、跳过重复 ${r.skipped} 条达标要求`;
      } else {
        $('quick-preview').textContent = `→ 「${parsed.title}」 ${parsed.category} ${parsed.estimatedMinutes}分钟 优先级${parsed.priority}${parsed.deadline ? ' DDL ' + parsed.deadline.replace('T', ' ') : ''} · 自动生成 ${checklist.length} 条达标要求`;
        await store.addTask({ ...parsed, source: 'text', folderPath: null, checklist });
      }
      $('quick-input').value = '';
      renderTasks();
      reschedule('incremental');
    };
    // 手动表单添加（标题/类别/分钟/优先级/DDL）
    $('task-add').onclick = async () => {
      const title = $('task-title').value.trim();
      if (!title) { showToast('请先填写计划名称'); $('task-title').focus(); return; }
      const minutes = parseInt($('task-min').value, 10) || 60;
      if (!(minutes > 0)) { showToast('预计分钟需为正整数'); $('task-min').focus(); return; }
      await store.addTask({
        title,
        category: $('task-cat').value.trim() || '其他',
        estimatedMinutes: minutes,
        priority: parseInt($('task-pri').value, 10) || 3,
        splittable: minutes >= 50,
        minBlockMinutes: Math.min(25, minutes),
        deadline: $('task-ddl').value || null,
        source: 'manual', folderPath: null,
        checklist: [{ id: ckId(), text: `完成「${title}」`, done: false, key: 'auto' }],
      });
      $('task-title').value = '';
      renderTasks();
      reschedule('incremental');
    };
    // 通道二：图片（多选 / 多拖 / 多粘贴）
    $('img-drop').onclick = () => $('img-file').click();
    $('img-file').onchange = () => acceptImageFiles($('img-file').files);
    $('img-drop').ondragover = (e) => { e.preventDefault(); $('img-drop').classList.add('dragging'); };
    $('img-drop').ondragleave = () => $('img-drop').classList.remove('dragging');
    $('img-drop').ondrop = (e) => {
      e.preventDefault();
      $('img-drop').classList.remove('dragging');
      acceptImageFiles(e.dataTransfer.files);
    };
    // Ctrl+V 直接粘贴截图（可多张）
    document.addEventListener('paste', (e) => {
      if (!$('pane-image') || $('pane-image').classList.contains('hidden')) return;
      const files = [...((e.clipboardData && e.clipboardData.items) || [])]
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile()).filter(Boolean);
      if (files.length) acceptImageFiles(files);
    });
    $('img-add').onclick = addImageTask;
    // 缩略图 / 链接条目的移除按钮
    $('img-thumbs').onclick = (e) => {
      const b = e.target.closest('button[data-img-x]');
      if (!b) return;
      pendingImages.splice(+b.dataset.imgX, 1);
      renderImgThumbs();
    };
    $('link-list').onclick = (e) => {
      const b = e.target.closest('button[data-link-x]');
      if (!b) return;
      pendingLinks.splice(+b.dataset.linkX, 1);
      renderLinkList();
    };
    // 通道三：链接（多条）
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
      } else if (btn.dataset.act === 'ck-del') {
        const t = store.getTask(btn.dataset.tid);
        if (!t || !t.checklist) return;
        const item = t.checklist.find((c) => c.id === btn.dataset.ckid);
        if (!item) return;
        await store.updateTask(t.id, { checklist: t.checklist.filter((c) => c.id !== item.id) });
        showToast('已删除该条达标要求');
        renderTasks();
        reschedule();
        return;
      } else if (btn.dataset.act === 'ck-edit') {
        const row = btn.closest('.ck-item');
        const t = store.getTask(btn.dataset.tid);
        const item = t && t.checklist ? t.checklist.find((c) => c.id === btn.dataset.ckid) : null;
        if (!row || !item) return;
        const span = row.querySelector('.ck-main span');
        if (!span || row.querySelector('.ck-edit-input')) return;
        const editor = document.createElement('input');
        editor.className = 'ck-edit-input';
        editor.value = item.text;
        span.replaceWith(editor);
        editor.focus();
        editor.select();
        const save = async () => {
          const val = editor.value.trim();
          if (!val) { showToast('内容不能为空，已还原'); }
          else if (val !== item.text) {
            await store.updateTask(t.id, {
              checklist: t.checklist.map((c) => (c.id === item.id ? Object.assign({}, c, { text: val }) : c)),
            });
            showToast('✓ 已修改达标要求');
          }
          renderTasks();
        };
        editor.addEventListener('keydown', (e2) => {
          if (e2.key === 'Enter') { e2.preventDefault(); editor.blur(); }
          if (e2.key === 'Escape') { editor.value = item.text; editor.blur(); }
        });
        editor.addEventListener('blur', save, { once: true });
        return;
      } else if (btn.dataset.act === 'folder-save') {
        await saveFolder(id);
        return;
      } else if (btn.dataset.act === 'folder-copy') {
        await copyFolder(id);
        return;
      } else if (btn.dataset.act === 'folder-pick') {
        await pickFolder(id);
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
    // 课表列表：编辑（✏️）/ 删除（✕）/ 行内保存
    $('evt-list').onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.act === 'delevt') {
        await store.removeFixedEvent(btn.dataset.id);
        renderEvents();
        reschedule();
        return;
      }
      if (btn.dataset.act === 'editevt') {
        const e = store.listFixedEvents().find((x) => x.id === btn.dataset.id);
        if (!e) return;
        const li = btn.closest('li');
        const byday = (e.rrule.match(/BYDAY=([A-Z,]+)/) || [])[1] || '';
        const BY2NUM = { MO: '1', TU: '2', WE: '3', TH: '4', FR: '5', SA: '6', SU: '7' };
        const dayVal = e.rrule.includes('DAILY') ? 'daily'
          : byday && BY2NUM[byday.split(',')[0]] ? BY2NUM[byday.split(',')[0]] : 'once';
        li.innerHTML = `
          <span class="dot" style="background:#94a3b8"></span>
          <input class="ee-title" value="${esc(e.title)}" style="flex:1;min-width:90px">
          <input type="time" class="ee-start" value="${e.startTime}" style="max-width:96px">
          <input type="time" class="ee-end" value="${e.endTime}" style="max-width:96px">
          <select class="ee-day" style="max-width:88px">
            <option value="daily">每天</option>
            <option value="1">周一</option><option value="2">周二</option>
            <option value="3">周三</option><option value="4">周四</option>
            <option value="5">周五</option><option value="6">周六</option>
            <option value="7">周日</option>
            <option value="once">仅一次</option>
          </select>
          <button data-act="ee-save" data-id="${e.id}" title="保存修改">✓</button>
          <button data-act="ee-cancel" title="取消修改">✗</button>`;
        li.querySelector('.ee-day').value = dayVal;
        li.querySelector('.ee-title').focus();
        return;
      }
      if (btn.dataset.act === 'ee-cancel') {
        renderEvents();
        return;
      }
      if (btn.dataset.act === 'ee-save') {
        const li = btn.closest('li');
        const title = li.querySelector('.ee-title').value.trim();
        if (!title) { showToast('名称不能为空'); li.querySelector('.ee-title').focus(); return; }
        const startTime = li.querySelector('.ee-start').value || '08:00';
        const endTime = li.querySelector('.ee-end').value || '09:40';
        if (endTime <= startTime) { showToast('结束时间必须晚于开始时间'); return; }
        const dayVal = li.querySelector('.ee-day').value;
        const NUM2BY = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' };
        const rrule = dayVal === 'daily' ? 'FREQ=DAILY'
          : dayVal === 'once' ? '' : `FREQ=WEEKLY;BYDAY=${NUM2BY[dayVal]}`;
        try {
          await store.updateFixedEvent(btn.dataset.id, { title, startTime, endTime, rrule });
          showToast('✓ 已修改课程安排');
        } catch (e) {
          showToast('修改失败：' + e.message);
          return;
        }
        renderEvents();
        reschedule();
        return;
      }
    };
    // 编辑行内按回车直接保存
    $('evt-list').onkeydown = (ev) => {
      if (ev.key !== 'Enter') return;
      const input = ev.target.closest('.ee-title, .ee-start, .ee-end');
      if (!input) return;
      const li = input.closest('li');
      const save = li.querySelector('button[data-act="ee-save"]');
      if (save) save.click();
    };
    $('evt-add').onclick = async () => {
      const title = $('evt-title').value.trim();
      if (!title) { showToast('请先填写安排名称，如：高数课'); $('evt-title').focus(); return; }
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
    $('evt-ics').onclick = () => $('ics-file').click();
    $('ics-file').onchange = async () => {
      const file = $('ics-file').files[0];
      if (!file) return;
      if (!window.Ics) {
        $('ics-result').textContent = '⚠️ 页面版本过旧（缺少ICS模块）——请关闭本窗口，重新双击小人打开新版';
        $('ics-file').value = '';
        return;
      }
      try {
        const text = await file.text();
        const { events, skipped } = Ics.parseIcs(text);
        if (!events.length && !skipped) {
          $('ics-result').textContent = '⚠️ 未识别到有效日程（确认是 .ics 文件）';
          return;
        }
        // 去重：同名同时段的事件不重复导入
        const existing = new Set(store.listFixedEvents().map((e) => `${e.title}|${e.startTime}|${e.endTime}|${e.rrule}`));
        let added = 0;
        for (const ev of events) {
          const key = `${ev.title}|${ev.startTime}|${ev.endTime}|${ev.rrule}`;
          if (existing.has(key)) continue;
          existing.add(key);
          await store.addFixedEvent(ev);
          added += 1;
        }
        $('ics-result').textContent = `✓ 导入 ${added} 条固定安排` + (skipped ? `，跳过 ${skipped} 条（全天事件等）` : '');
        renderEvents();
        reschedule();
      } catch (e) {
        $('ics-result').textContent = '✗ 导入失败：' + e.message;
      }
      $('ics-file').value = '';
    };
    // 课表图片导入：OCR 识别文字行 → Timetable 解析 → 去重入库
    $('evt-img').onclick = () => $('evt-img-file').click();
    $('evt-img-file').onchange = async () => {
      const file = $('evt-img-file').files[0];
      if (!file) return;
      if (!window.Timetable) {
        $('ics-result').textContent = '⚠️ 页面版本过旧（缺少课表模块）——请关闭本窗口，重新双击小人打开新版';
        $('evt-img-file').value = '';
        return;
      }
      $('ics-result').textContent = '🔍 正在识别课表图片（首次需下载中文模型，请稍候）…';
      try {
        const T = await ensureTesseract();
        if (!T) {
          $('ics-result').textContent = '⚠️ 文字识别引擎不可用（无网络或加载超时）——可改用「📥 导入ICS」或手动添加';
          return;
        }
        const ocr = await compressImage(file, 1400, 0.8);
        const r = await T.recognize(ocr.ocrUrl || ocr.dataUrl, 'chi_sim+eng');
        const lines = (r.data.text || '').split(/\n+/)
          .map((s) => s.replace(/\s+/g, ' ').trim())
          .filter((s) => s.length >= 3);
        if (!lines.length) {
          $('ics-result').textContent = '⚠️ 图片中未识别出文字（照片要清晰、课表文字方向要正）';
          return;
        }
        const { drafts, skipped } = window.Timetable.parseTimetableLines(lines);
        if (!drafts.length) {
          $('ics-result').textContent = '⚠️ 识别到 ' + lines.length + ' 行文字，但没有「课名 + 周X + 时间/节次」格式的课程行——可手动添加，每行示例：高等数学 周一 08:00-09:40';
          return;
        }
        // 去重：同名同时段不重复导入
        const existing = new Set(store.listFixedEvents().map((e) => `${e.title}|${e.startTime}|${e.endTime}|${e.rrule}`));
        let added = 0;
        for (const d of drafts) {
          const key = `${d.title}|${d.startTime}|${d.endTime}|${d.rrule}`;
          if (existing.has(key)) continue;
          existing.add(key);
          await store.addFixedEvent(d);
          added += 1;
        }
        $('ics-result').textContent = `✓ 已从课表图片导入 ${added} 门课`
          + (added < drafts.length ? `（${drafts.length - added} 门已存在跳过）` : '')
          + (skipped.length ? `，${skipped.length} 行无法识别已跳过` : '')
          + '。每门课悬停后点 ✏️ 可修改';
        renderEvents();
        reschedule();
      } catch (e) {
        $('ics-result').textContent = '✗ 课表识别失败：' + (e.message || String(e) || '未知错误');
      }
      $('evt-img-file').value = '';
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
    $('btn-import').onclick = () => $('import-file').click();
    $('import-file').onchange = async () => {
      const file = $('import-file').files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!confirm('导入备份会覆盖当前所有计划与课表，确定继续？')) return;
        const r = await store.restoreAll(data);
        showToast(`已恢复：${r.tasks} 条计划、${r.events} 条固定安排`);
        renderTasks();
        renderEvents();
        fillParams();
        reschedule();
      } catch (e) {
        showToast('导入失败：' + e.message);
      }
      $('import-file').value = '';
    };
    $('btn-clear').onclick = () => {
      if (!confirm('确定清空本机所有数据？（不可恢复）')) return;
      LS.remove('plan-pal.log');
      LS.remove('plan-pal.snap');
      LS.remove('plan-pal.blocks');
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
    // AI 智能解析设置（存 LS；key 仅本机）
    $('llm-save').onclick = () => {
      const endpoint = $('llm-endpoint').value.trim();
      const model = $('llm-model').value.trim();
      const apiKey = $('llm-key').value.trim();
      if (!endpoint || !model || !apiKey) { showToast('接口地址、模型名、Key 都要填哦'); return; }
      LS.set('plan-pal.llm', JSON.stringify({ endpoint, model, apiKey }));
      $('llm-status').textContent = '✓ 已保存，一句话加计划将优先用 AI 解析';
      showToast('AI 智能解析已开启');
    };
    $('llm-clear').onclick = () => {
      LS.set('plan-pal.llm', '');
      $('llm-status').textContent = '已清除，使用本地规则解析';
      showToast('已清除 AI 设置');
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
    // 回填 AI 设置
    const llm = getLlmConfig();
    if (llm) {
      $('llm-endpoint').value = llm.endpoint;
      $('llm-model').value = llm.model;
      $('llm-key').value = llm.apiKey;
      $('llm-status').textContent = '✓ AI 智能解析已开启';
    }
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
    try { blocks = JSON.parse(LS.get('plan-pal.blocks') || '[]'); } catch (e) { blocks = []; }
    collapseAllPanels(); // 极简模式：默认只显示计划列表
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
