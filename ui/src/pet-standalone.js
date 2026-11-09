/**
 * 桌宠独立窗逻辑（pet.html 专用）
 * - 与主页面同源（file://），直接读共享 localStorage：
 *     plan-pal.blocks → 当前排程块
 *     plan-pal.snap   → 任务标题/达标/强度快照
 * - 主页面任何改动（storage 事件）→ 桌宠状态实时联动
 * - 点击小人 → 打开主计划页
 */
(function () {
  'use strict';

  var PAD = function (n) { return (n < 10 ? '0' : '') + n; };

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }

  function readJson(k, fallback) {
    try {
      var v = JSON.parse(lsGet(k) || 'null');
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function todayStr(d) {
    return d.getFullYear() + '-' + PAD(d.getMonth() + 1) + '-' + PAD(d.getDate());
  }

  /** 主循环：按计划数据计算状态并驱动小人 */
  function tick() {
    var blocks = readJson('plan-pal.blocks', []);
    var snap = readJson('plan-pal.snap', null);
    var tasks = (snap && snap.tasks) || [];
    var now = new Date();
    var nm = now.getHours() * 60 + now.getMinutes();
    var today = todayStr(now);

    // 深夜/凌晨 → 打瞌睡
    if (nm < 6 * 60 || nm >= 23 * 60) {
      Pet.setState('sleeping', '夜深了，早点休息哦～');
      return;
    }

    // 当前进行中的块
    var current = null;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b || !b.start || !b.end) continue;
      var s = new Date(b.start);
      var e = new Date(b.end);
      var sm = s.getHours() * 60 + s.getMinutes();
      var em = e.getHours() * 60 + e.getMinutes();
      if (todayStr(s) === today && sm <= nm && nm < em) { current = b; break; }
    }

    if (current) {
      var task = null;
      for (var j = 0; j < tasks.length; j++) { if (tasks[j].id === current.taskId) { task = tasks[j]; break; } }
      var endM = new Date(current.end);
      var left = endM.getHours() * 60 + endM.getMinutes() - nm;
      if (current.type === 'break') {
        Pet.setState('break', '休息中，还剩 ' + left + ' 分钟～');
      } else if (task && task.checklist && task.checklist.length) {
        var done = 0;
        for (var k = 0; k < task.checklist.length; k++) { if (task.checklist[k].done) done++; }
        Pet.setState('working', '「' + task.title + '」达标 ' + done + '/' + task.checklist.length + '，还剩 ' + left + ' 分钟');
      } else {
        Pet.setState('working', '正在做「' + (task ? task.title : '计划') + '」，还剩 ' + left + ' 分钟');
      }
      return;
    }

    // 今日任务是否全部完成 → 庆祝
    var remaining = 0;
    var remainingMin = 0;
    for (var m = 0; m < tasks.length; m++) {
      var t = tasks[m];
      if (t.status !== 'done' && t.status !== 'cancelled') {
        remaining++;
        remainingMin += t.estimatedMinutes || 60;
      }
    }
    if (tasks.length > 0 && remaining === 0) {
      Pet.setState('happy', '今天的计划全部完成啦，撒花！🎉');
      return;
    }

    // 超载 → 疲惫（今日剩余时长超过每日容量上限）
    var cap = (snap && snap.intensity && snap.intensity.dailyLoadCapMinutes) || 480;
    if (remainingMin > cap) {
      Pet.setState('tired', '今天还有 ' + remaining + ' 件事（约 ' + remainingMin + ' 分钟），记得劳逸结合');
      return;
    }

    // 否则待机 + 下一块预告
    var next = null;
    for (var n = 0; n < blocks.length; n++) {
      var nb = blocks[n];
      if (!nb || !nb.start) continue;
      var ns = new Date(nb.start);
      if (todayStr(ns) === today && ns.getHours() * 60 + ns.getMinutes() > nm) {
        if (!next || nb.start < next.start) next = nb;
      }
    }
    if (next) {
      var ntask = null;
      for (var p = 0; p < tasks.length; p++) { if (tasks[p].id === next.taskId) { ntask = tasks[p]; break; } }
      Pet.setState('idle', '接下来 ' + next.start.slice(11, 16) + '：' + (ntask ? ntask.title : '计划'));
    } else {
      Pet.setState('idle', remaining > 0
        ? '今天暂无安排，还有 ' + remaining + ' 件事等你排上日程～'
        : '暂无计划，点我可以添加哦～');
    }
  }

  // 主页面数据变化 → 实时联动
  window.addEventListener('storage', function (e) {
    if (e.key === 'plan-pal.blocks' || e.key === 'plan-pal.snap') tick();
  });

  // 点击小人 → 打开主计划页（Electron 壳内由 main.js 拦截为同 session 新窗口）
  function bindOpen() {
    var pet = document.getElementById('pet');
    if (!pet) return;
    pet.style.cursor = 'pointer';
    pet.addEventListener('click', function () {
      try { window.open('index.html', '_blank'); } catch (e) { /* 忽略 */ }
    });
  }

  /** Electron 壳适配：透明背景 + 整窗拖动 + 小人右上角悬停关闭按钮 */
  function setupElectron() {
    var isElectron = /Electron/i.test(navigator.userAgent);
    if (!isElectron) return;
    document.documentElement.classList.add('in-electron');
    document.body.classList.add('in-electron');
    // 整窗可拖动；小人本体与关闭按钮可点击（no-drag）
    document.documentElement.style.webkitAppRegion = 'drag';
    var pet = document.getElementById('pet');
    if (pet) pet.style.webkitAppRegion = 'no-drag';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'pet-win-close';
    closeBtn.textContent = '✕';
    closeBtn.title = '关闭桌宠';
    closeBtn.style.webkitAppRegion = 'no-drag';
    closeBtn.addEventListener('click', function () {
      try { window.close(); } catch (e) { /* 忽略 */ }
    });
    // 挂在小人容器内：贴着小人右上角，悬停到小人上才显示
    if (pet) pet.appendChild(closeBtn);
  }

  function boot() {
    setupElectron();
    Pet.mount();
    bindOpen();
    tick();
    setInterval(tick, 30 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
