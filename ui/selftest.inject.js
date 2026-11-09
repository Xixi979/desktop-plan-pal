(async () => {
  const out = [];
  const paint = () => { document.getElementById('selftest-out').textContent = 'SELFTEST\n' + out.join('\n'); };
  const tryStep = async (name, fn) => {
    try { await fn(); out.push(name + ': OK'); }
    catch (e) { out.push(name + ': FAIL ' + ((e && e.message) || e)); }
    paint();
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $id = (i) => document.getElementById(i);
  out.push('err-banner: ' + ($id('err-banner') ? ($id('err-banner').textContent || '(空)') : '(未创建)'));
  paint();
  await tryStep('导航展开加计划', async () => {
    const btn = document.querySelector('#panel-nav button[data-panel="panel-quick"]');
    if (!btn) throw new Error('导航按钮不存在');
    btn.click(); await sleep(100);
    if ($id('panel-quick').classList.contains('hidden')) throw new Error('面板未展开');
  });
  await tryStep('图片Tab', async () => {
    const tab = document.querySelector('#entry-tabs .tab[data-tab="image"]');
    if (!tab) throw new Error('Tab不存在');
    tab.click(); await sleep(100);
    if ($id('pane-image').classList.contains('hidden')) throw new Error('未切换');
  });
  await tryStep('链接Tab', async () => {
    document.querySelector('#entry-tabs .tab[data-tab="link"]').click(); await sleep(100);
    if ($id('pane-link').classList.contains('hidden')) throw new Error('未切换');
  });
  await tryStep('一句话添加', async () => {
    document.querySelector('#entry-tabs .tab[data-tab="text"]').click();
    $id('quick-input').value = '自测任务 30分钟';
    $id('quick-add').click(); await sleep(600);
    if (!$id('task-list').innerHTML.includes('自测任务')) throw new Error('列表未出现');
  });
  await tryStep('手动表单添加', async () => {
    $id('task-title').value = '手动自测';
    $id('task-add').click(); await sleep(600);
    if (!$id('task-list').innerHTML.includes('手动自测')) throw new Error('列表未出现');
  });
  await tryStep('课表添加', async () => {
    $id('panel-events').classList.remove('hidden');
    $id('evt-title').value = '自测课';
    $id('evt-add').click(); await sleep(500);
    if (!$id('evt-list').innerHTML.includes('自测课')) throw new Error('课表未出现');
  });

  await tryStep('周视图切换', async () => {
    document.getElementById('view-toggle').click(); await sleep(150);
    if (document.getElementById('week-view').classList.contains('hidden')) throw new Error('周视图未显示');
    document.getElementById('view-toggle').click(); await sleep(150);
    if (!document.getElementById('week-view').classList.contains('hidden')) throw new Error('日视图未恢复');
  });

  await tryStep('空标题点击➕弹提示', async () => {
    document.getElementById('task-title').value = '';
    document.getElementById('task-add').click(); await sleep(200);
    const toast = document.getElementById('pp-toast');
    if (!toast || !toast.classList.contains('show')) throw new Error('未弹提示');
    if (document.getElementById('task-list').innerHTML.includes('未命名')) throw new Error('不应添加');
  });
  await tryStep('填名称后➕正常添加', async () => {
    document.getElementById('task-title').value = '提示测试';
    document.getElementById('task-add').click(); await sleep(400);
    if (!document.getElementById('task-list').innerHTML.includes('提示测试')) throw new Error('未添加');
  });

  // v0.2 增量重排：新加任务后时间轴应出现排程块（增量路径走通）
  await tryStep('增量重排生效', async () => {
    document.getElementById('task-title').value = '增量自测';
    document.getElementById('task-add').click(); await sleep(600);
    const tl = document.getElementById('timeline');
    if (!tl || !tl.querySelector('.block')) throw new Error('时间轴无排程块');
  });

  // v0.2 小人状态机
  await tryStep('小人SVG渲染', async () => {
    if (!document.querySelector('#pet .pet-svg')) throw new Error('SVG未渲染');
    const pet = document.getElementById('pet');
    if (!/st-\w+/.test(pet.className)) throw new Error('无初始状态类: ' + pet.className);
  });
  await tryStep('小人六态切换', async () => {
    if (!window.Pet) throw new Error('Pet 模块未挂载');
    const states = ['working', 'break', 'happy', 'tired', 'sleeping', 'idle'];
    const pet = document.getElementById('pet');
    for (const st of states) {
      window.Pet.setState(st, '测试' + st);
      await sleep(80);
      if (!pet.classList.contains('st-' + st)) throw new Error('状态 ' + st + ' 未生效，当前 ' + pet.className);
    }
    if (!document.getElementById('pet-bubble').textContent.includes('测试idle')) throw new Error('气泡未更新');
  });
  // v0.2.3 达标条目编辑 / 删除
  await tryStep('达标条目悬停出现修改删除按钮', async () => {
    const row = document.querySelector('#task-list .ck-item');
    if (!row) throw new Error('无达标条目');
    if (!row.querySelector('button[data-act="ck-edit"]') || !row.querySelector('button[data-act="ck-del"]')) {
      throw new Error('缺少 ck-edit / ck-del 按钮');
    }
  });
  await tryStep('达标条目删除生效', async () => {
    const row = document.querySelector('#task-list .ck-item');
    const tid = row.querySelector('button[data-act="ck-del"]').dataset.tid;
    const before = window.__pal.store.getTask(tid).checklist.length;
    row.querySelector('button[data-act="ck-del"]').click();
    await sleep(400);
    const after = window.__pal.store.getTask(tid).checklist.length;
    if (after !== before - 1) throw new Error('删除前 ' + before + ' 后 ' + after);
  });
  await tryStep('达标条目内联修改保存', async () => {
    const row = document.querySelector('#task-list .ck-item');
    const btn = row.querySelector('button[data-act="ck-edit"]');
    btn.click(); await sleep(150);
    const editor = row.querySelector('.ck-edit-input');
    if (!editor) throw new Error('编辑框未出现');
    editor.value = '自测修改后的达标要求';
    editor.dispatchEvent(new Event('blur'));
    await sleep(400);
    const tid = btn.dataset.tid;
    const hit = window.__pal.store.getTask(tid).checklist.some((c) => c.text === '自测修改后的达标要求');
    if (!hit) throw new Error('修改未保存');
  });
  out.push('DONE');
  paint();
})();
