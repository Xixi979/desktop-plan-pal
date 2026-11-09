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
      renderTasks(); reschedule();
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
      renderTasks(); reschedule();
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
          ${(t.linkUrls || []).length ? `<div class="attach-box">${(t.linkUrls || []).map((u) =>
            `🔗 <a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join('<br>')}</div>`
            : (t.linkUrl ? `<div class="attach-box">🔗 <a href="${esc(t.linkUrl)}" target="_blank" rel="noopener">${esc(t.linkUrl)}</a></div>` : '')}
          ${imgCount ? '<div class="attach-box">🖼️ 已附图片资料（不在列表中展示大图，录入确认区可查看）</div>' : ''}
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
    // 通道一：一句话（同名计划自动并入并完善达标要求）
    $('quick-add').onclick = async () => {
      const raw = $('quick-input').value;
      const parsed = parseQuick(raw);
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
      reschedule();
    };
    // 手动表单添加（标题/类别/分钟/优先级/DDL）
    $('task-add').onclick = async () => {
      const title = $('task-title').value.trim();
      if (!title) return;
      const minutes = parseInt($('task-min').value, 10) || 60;
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
      reschedule();
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
    // 课表列表：删除按钮（✕）
    $('evt-list').onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn || btn.dataset.act !== 'delevt') return;
      await store.removeFixedEvent(btn.dataset.id);
      renderEvents();
      reschedule();
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
