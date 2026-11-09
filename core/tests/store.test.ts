/**
 * 数据层测试（v0.1）：ChangeLog 驱动存储 + 快照恢复 + 撤销
 */

import { describe, expect, it } from 'vitest';
import { FileAdapter, MemoryAdapter, PlanStore } from '../src/store.ts';
import type { IntensityProfile, Task } from '../src/types.ts';

const DATE = '2026-11-09';

function mkTaskInput(p: Partial<Task> = {}): Omit<Task, 'id' | 'status'> {
  return {
    title: '写实验报告', category: '学习', estimatedMinutes: 180,
    priority: 3, splittable: true, minBlockMinutes: 25, ...p,
  };
}

const PROFILE: IntensityProfile = {
  id: 'p1', effectiveDate: DATE, dailyLoadCapMinutes: 360,
  blockMaxMinutes: 90, blockMinMinutes: 25, minBreakMinutes: 10,
  consecutiveWorkCapMinutes: 120,
  energyCurve: new Array(24).fill(3), categoryQuotas: {}, nudgeLevel: 2,
};

describe('PlanStore 基本操作（MemoryAdapter）', () => {
  it('创建 / 更新 / 删除任务', async () => {
    const store = new PlanStore(new MemoryAdapter(), 'dev-a');
    await store.open();

    const t1 = await store.addTask(mkTaskInput());
    const t2 = await store.addTask(mkTaskInput({ title: '背单词', category: '英语', estimatedMinutes: 60 }));
    expect(store.listTasks()).toHaveLength(2);

    const updated = await store.updateTask(t1.id, { priority: 5, status: 'scheduled' });
    expect(updated.priority).toBe(5);
    expect(store.getTask(t1.id)?.status).toBe('scheduled');

    await store.deleteTask(t2.id);
    expect(store.listTasks()).toHaveLength(1);
    expect(store.listTasks()[0].id).toBe(t1.id);
  });

  it('快照 + 日志重放：重新 open 后状态完整恢复', async () => {
    const adapter = new MemoryAdapter();
    const storeA = new PlanStore(adapter, 'dev-a');
    await storeA.open();
    const t = await storeA.addTask(mkTaskInput());
    await storeA.updateTask(t.id, { estimatedMinutes: 240 });
    await storeA.addFixedEvent({
      title: '睡眠', startTime: '00:00', endTime: '07:00',
      rrule: 'FREQ=DAILY', effectiveFrom: '2026-11-01',
    });
    await storeA.setIntensity(PROFILE);

    const storeB = new PlanStore(adapter, 'dev-a');
    await storeB.open();
    expect(storeB.listTasks()).toHaveLength(1);
    expect(storeB.getTask(t.id)?.estimatedMinutes).toBe(240);
    expect(storeB.listFixedEvents()).toHaveLength(1);
    expect(storeB.getIntensity()?.dailyLoadCapMinutes).toBe(360);
  });

  it('撤销：undo 回滚最近的 update / create', async () => {
    const store = new PlanStore(new MemoryAdapter(), 'dev-a');
    await store.open();
    const t = await store.addTask(mkTaskInput());
    await store.updateTask(t.id, { title: '改过的标题' });
    expect(store.getTask(t.id)?.title).toBe('改过的标题');

    expect(await store.undo()).toBe(true);
    expect(store.getTask(t.id)?.title).toBe('写实验报告');

    expect(await store.undo()).toBe(true);
    expect(store.getTask(t.id)).toBeUndefined();

    expect(await store.undo()).toBe(false);
  });

  it('seq 单调递增且重放后不回退', async () => {
    const adapter = new MemoryAdapter();
    const storeA = new PlanStore(adapter, 'dev-a');
    await storeA.open();
    const seqBefore = storeA.seq;
    await storeA.addTask(mkTaskInput());
    expect(storeA.seq).toBeGreaterThan(seqBefore);

    const storeB = new PlanStore(adapter, 'dev-a');
    await storeB.open();
    expect(storeB.seq).toBe(storeA.seq);
  });
});

describe('FileAdapter 文件落盘', () => {
  it('changelog.jsonl 追加 + 重新 open 从磁盘恢复', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const baseDir = path.join(os.tmpdir(), `plan-pal-test-${Date.now()}`);
    const adapter = new FileAdapter(baseDir);

    const storeA = new PlanStore(adapter, 'dev-a');
    await storeA.open();
    await storeA.addTask(mkTaskInput());
    await storeA.addTask(mkTaskInput({ title: '背单词', estimatedMinutes: 60 }));

    const storeB = new PlanStore(adapter, 'dev-a');
    await storeB.open();
    expect(storeB.listTasks()).toHaveLength(2);

    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(`${baseDir}/changelog.jsonl`, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines.length).toBe(2); // 恰好两条 create；open 只写 snapshot.json 不追加日志
    await fs.rm(baseDir, { recursive: true, force: true });
  });
});
