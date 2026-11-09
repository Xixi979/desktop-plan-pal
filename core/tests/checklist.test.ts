/**
 * 达标要求智能合并测试：去重 / 补充 / 同源变动更新 / 手动条目保护
 */

import { describe, expect, it } from 'vitest';
import { mergeChecklist } from '../src/checklist.ts';

const ck = (text, key = undefined) => ({ id: 'ck-' + Math.random().toString(36).slice(2, 8), text, done: false, key });

describe('mergeChecklist 智能合并', () => {
  it('重复文本跳过，新文本追加', () => {
    const existing = [ck('完成第3章习题'), ck('对答案并订正')];
    const incoming = [ck('完成第3章习题'), ck('整理错题本')];
    const r = mergeChecklist(existing, incoming);
    expect(r.list).toHaveLength(3);
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.updated).toBe(0);
    // 忽略空白/大小写也算重复
    const r2 = mergeChecklist(existing, [ck('完成第3章习题  ')]);
    expect(r2.added).toBe(0);
    expect(r2.skipped).toBe(1);
  });

  it('同 key 且文本变动 → 更新文本并重置完成状态', () => {
    const old = {
      id: 'ck-old', text: '看完链接：B站视频 第一课', done: true,
      doneAt: '2026-11-09T10:00:00.000Z', key: 'link:https://b23.tv/x',
    };
    const incoming = [ck('看完链接：B站视频 第一课+第二课', 'link:https://b23.tv/x')];
    const r = mergeChecklist([old], incoming);
    expect(r.updated).toBe(1);
    expect(r.list).toHaveLength(1);
    expect(r.list[0].text).toBe('看完链接：B站视频 第一课+第二课');
    expect(r.list[0].done).toBe(false);      // 内容变了需重做
    expect(r.list[0].id).toBe('ck-old');     // 保留原 id，勾选历史可追溯
  });

  it('同 key 且文本未变（但与整体不完全一致）→ 视为重复跳过', () => {
    const old = { id: 'ck-a', text: '处理图片资料：课表.jpg', done: false, key: 'img:课表.jpg' };
    const r = mergeChecklist([old], [ck('处理图片资料：课表.jpg', 'img:课表.jpg')]);
    expect(r.updated).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.list).toHaveLength(1);
  });

  it('无 key 的手动条目永远不会被自动改写', () => {
    const manual = { id: 'ck-m', text: '自己手动加的要求', done: false };
    const r = mergeChecklist([manual], [ck('自己手动加的要求（改动版）', 'img:x.jpg')]);
    expect(r.list).toHaveLength(2);
    expect(r.list[0].text).toBe('自己手动加的要求');
    expect(r.list[1].text).toBe('自己手动加的要求（改动版）');
  });

  it('空已有列表 / 空传入列表边界', () => {
    const r1 = mergeChecklist(undefined, [ck('完成')]);
    expect(r1.added).toBe(1);
    const r2 = mergeChecklist([ck('完成')], []);
    expect(r2.list).toHaveLength(1);
    expect(r2.added + r2.updated + r2.skipped).toBe(0);
  });
});
