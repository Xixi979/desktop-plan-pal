/* 桌面计划小人 v0.1 界面逻辑（纯 JS，无依赖） */
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
      `<div class="warning">⚠️ ${w.message}</div>`).join('');
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
      html += `<div class="block fixed" style="top:${top}px;height:${h}px" title="${ev.title}">
        <span class="b-title">🔒 ${ev.title}</span></div>`;
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
      html += `<div class="block ${b.type}" style="top:${top}px;height:${h - 2}px;background:${color}" title="${label}">
        <span class="b-title">${label} · ${b.start.slice(11)}-${b.end.slice(11)}</span></div>`;
    }
    const nm = nowMinutes();
    if (nm > dayStart && nm < dayEnd) {
      html += `<div class="now-line" style="top:${(nm - dayStart) / 60 * PXH}px"></div>`;
    }
    tl.innerHTML = html;
    $('today-label').textContent = `（${day} 周${'日一二三四五六'[new Date().getDay()]}）`;
  }

  // ---- 任务 / 事件列表 ----
  function renderTasks() {
    const tasks = store.listTasks();
    $('task-list').innerHTML = tasks.map((t) => `
      <li class="${t.status === 'done' ? 'done' : ''}">
        <span class="dot" style="background:${colorOf(t.category)}"></span>
        <b>${t.title}</b>
        <span class="meta">${t.category} · ${t.estimatedMinutes}分钟 · 优先级${t.priority}${t.deadline ? ' · DDL ' + t.deadline.replace('T', ' ') : ''}</span>
        <span class="ops">
          <button data-act="done" data-id="${t.id}" title="完成">✔</button>
          <button data-act="del" data-id="${t.id}" title="删除">✕</button>
        </span>
      </li>`).join('') || '<li class="empty">还没有计划，用上面的一句话输入试试～</li>';
  }

  function renderEvents() {
    const evs = store.listFixedEvents();
    $('evt-list').innerHTML = evs.map((e) => `
      <li><span class="dot" style="background:#94a3b8"></span>
        <b>${e.title}</b>
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
  function bind() {
    $('quick-add').onclick = async () => {
      const parsed = parseQuick($('quick-input').value);
      $('quick-preview').textContent = `→ 「${parsed.title}」 ${parsed.category} ${parsed.estimatedMinutes}分钟 优先级${parsed.priority}${parsed.deadline ? ' DDL ' + parsed.deadline.replace('T', ' ') : ''}`;
      await store.addTask(parsed);
      $('quick-input').value = '';
      renderTasks();
      reschedule();
    };
    $('task-add').onclick = async () => {
      const title = $('task-title').value.trim();
      if (!title) return;
      await store.addTask({
        title,
        category: $('task-cat').value.trim() || '其他',
        estimatedMinutes: parseInt($('task-min').value, 10) || 60,
        priority: parseInt($('task-pri').value, 10) || 3,
        splittable: (parseInt($('task-min').value, 10) || 60) >= 50,
        minBlockMinutes: 25,
        deadline: $('task-ddl').value || null,
      });
      $('task-title').value = '';
      renderTasks();
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
      localStorage.removeItem('plan-pal.log');
      localStorage.removeItem('plan-pal.snap');
      localStorage.removeItem('plan-pal.blocks');
      location.reload();
    };
    $('task-list').onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === 'done') {
        await store.updateTask(id, { status: 'done' });
      } else if (btn.dataset.act === 'del') {
        await store.deleteTask(id);
      }
      renderTasks();
      reschedule();
    };
    $('evt-list').onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn || btn.dataset.act !== 'delevt') return;
      await store.removeFixedEvent(btn.dataset.id);
      renderEvents();
      reschedule();
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
