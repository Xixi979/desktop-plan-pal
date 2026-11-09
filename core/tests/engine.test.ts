/**
 * 排程引擎测试用例（v0.1）
 *
 * 测试框架：Vitest。用例与设计文档 4.2-4.4 节一一对应。
 * 统一使用固定日期 2026-11-09（周一），保证测试确定性。
 */

import { describe, expect, it } from 'vitest';
import {
  buildFreeSlots, greedySchedule, scorePlacement, validateConstraints,
} from '../src/engine.ts';
import type { Block, FixedEvent, IntensityProfile, Task } from '../src/types.ts';

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

const DATE = '2026-11-09'; // 周一

/** 早起型精力曲线：上午 9-10 点最高（5），深夜最低（1） */
const PROFILE: IntensityProfile = {
  id: 'p1',
  effectiveDate: DATE,
  dailyLoadCapMinutes: 360,
  blockMaxMinutes: 90,
  blockMinMinutes: 25,
  minBreakMinutes: 10,
  consecutiveWorkCapMinutes: 120,
  energyCurve: [1, 1, 1, 1, 1, 1, 2, 3, 4, 5, 5, 4, 4, 3, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1],
  categoryQuotas: { 英语: 60 },
  nudgeLevel: 2,
};

/** 每日睡眠 00:00-07:00 */
const SLEEP: FixedEvent = {
  id: 'ev-sleep', title: '睡眠', startTime: '00:00', endTime: '07:00',
  rrule: 'FREQ=DAILY', effectiveFrom: '2026-11-01',
};

function mkTask(p: Partial<Task> & { id: string; title: string }): Task {
  return {
    category: '学习', estimatedMinutes: 60, priority: 3, splittable: true,
    minBlockMinutes: 25, status: 'draft', ...p,
  };
}

function workBlocksOf(blocks: Block[], taskId: string): Block[] {
  return blocks.filter((b) => b.taskId === taskId && b.type === 'flexible');
}

describe('buildFreeSlots 空闲槽构造', () => {
  it('无固定事件时，扣除睡眠后全天为单个空闲槽', () => {
    const slots = buildFreeSlots(DATE, [SLEEP], PROFILE);
    expect(slots).toHaveLength(1);
    expect(slots[0].start).toBe('2026-11-09T07:00');
    // 注：引擎统一输出本地朴素时间，当日 24:00 表示为次日 00:00
    expect(slots[0].end).toBe('2026-11-10T00:00');
  });

  it('一节 08:00-09:40 的周一课 → 产出 [07:00-08:00] 与 [09:40-24:00] 两个槽', () => {
    const klass: FixedEvent = {
      id: 'ev-math', title: '高数课', startTime: '08:00', endTime: '09:40',
      rrule: 'FREQ=WEEKLY;BYDAY=MO', effectiveFrom: '2026-11-02',
    };
    const slots = buildFreeSlots(DATE, [SLEEP, klass], PROFILE);
    expect(slots).toHaveLength(2);
    expect(slots[0].start).toBe('2026-11-09T07:00');
    expect(slots[0].end).toBe('2026-11-09T08:00');
    expect(slots[1].start).toBe('2026-11-09T09:40');
  });

  it('边界：课程紧邻时（09:40 结束、10:00 开始）中间 20 分钟 < blockMinMinutes，应被丢弃', () => {
    const a: FixedEvent = { id: 'a', title: '课A', startTime: '08:00', endTime: '09:40', rrule: 'FREQ=DAILY', effectiveFrom: DATE };
    const b: FixedEvent = { id: 'b', title: '课B', startTime: '10:00', endTime: '11:40', rrule: 'FREQ=DAILY', effectiveFrom: DATE };
    const slots = buildFreeSlots(DATE, [SLEEP, a, b], PROFILE);
    // 09:40-10:00 只有 20 分钟，必须被丢弃
    expect(slots.some((s) => s.start === '2026-11-09T09:40')).toBe(false);
    expect(slots).toHaveLength(2); // 07:00-08:00 与 11:40-24:00
  });

  it('rrule 展开：周二的课不在周一占用；exceptions 日期不占用', () => {
    const tue: FixedEvent = {
      id: 't', title: '周二课', startTime: '08:00', endTime: '09:40',
      rrule: 'FREQ=WEEKLY;BYDAY=TU', effectiveFrom: '2026-11-02',
    };
    expect(buildFreeSlots(DATE, [SLEEP, tue], PROFILE)).toHaveLength(1); // 周一不受影响

    const withException: FixedEvent = {
      id: 'e', title: '调休停课', startTime: '08:00', endTime: '09:40',
      rrule: 'FREQ=WEEKLY;BYDAY=MO', effectiveFrom: '2026-11-02',
      exceptions: [DATE],
    };
    expect(buildFreeSlots(DATE, [SLEEP, withException], PROFILE)).toHaveLength(1);
  });
});

describe('scorePlacement 多因子评分', () => {
  const slot = { start: `${DATE}T08:00`, end: `${DATE}T10:00` };

  it('DDL 明天到期的任务得分显著高于 DDL 下周的任务', () => {
    const urgent = mkTask({ id: 't1', title: '急', deadline: '2026-11-10T23:00' });
    const relaxed = mkTask({ id: 't2', title: '缓', deadline: '2026-11-23T23:00' });
    const a = scorePlacement(urgent, slot, PROFILE).score;
    const b = scorePlacement(relaxed, slot, PROFILE).score;
    expect(a).toBeGreaterThan(b);
  });

  it('高优先级任务得分高于低优先级', () => {
    const a = scorePlacement(mkTask({ id: 'a', title: 'A', priority: 5 }), slot, PROFILE).score;
    const b = scorePlacement(mkTask({ id: 'b', title: 'B', priority: 1 }), slot, PROFILE).score;
    expect(a).toBeGreaterThan(b);
  });

  it('精力匹配：早起型用户 + 刷题任务 → 上午槽得分高于深夜槽', () => {
    const task = mkTask({ id: 't', title: '刷题' });
    const morning = { start: `${DATE}T08:00`, end: `${DATE}T10:00` };
    const night = { start: `${DATE}T22:00`, end: `${DATE}T23:00` };
    expect(scorePlacement(task, morning, PROFILE).score)
      .toBeGreaterThan(scorePlacement(task, night, PROFILE).score);
  });

  it('碎片适配：槽长 60 分钟、任务需 60 分钟 → 满分；槽长 59 分钟 → 降分', () => {
    const task = mkTask({ id: 't', title: 'T', estimatedMinutes: 60 });
    const fitFull = scorePlacement(task, { start: `${DATE}T08:00`, end: `${DATE}T09:00` }, PROFILE);
    const fitShort = scorePlacement(task, { start: `${DATE}T08:00`, end: `${DATE}T08:59` }, PROFILE);
    expect(fitFull.factors.slotFit).toBe(1);
    expect(fitShort.factors.slotFit).toBeLessThan(1);
  });
});

describe('greedySchedule 贪心排程 + 约束校验', () => {
  it('不重叠：产出 Block 两两不相交，且落在空闲时段内', () => {
    const { blocks } = greedySchedule(
      [mkTask({ id: 'a', title: 'A' }), mkTask({ id: 'b', title: 'B' })],
      [SLEEP], PROFILE, `${DATE}T00:00`, `${DATE}T24:00`,
    );
    const sorted = [...blocks].sort((x, y) => x.start.localeCompare(y.start));
    for (let i = 1; i < sorted.length; i++) {
      expect(toMinLocal(sorted[i].start)).toBeGreaterThanOrEqual(toMinLocal(sorted[i - 1].end));
    }
    for (const b of blocks) {
      expect(b.start >= '2026-11-09T07:00').toBe(true); // 不进睡眠时段
    }
  });

  it('日负荷上限：dailyLoadCapMinutes=360 时，弹性块总时长 ≤ 360 分钟', () => {
    const tasks = [1, 2, 3, 4, 5].map((i) =>
      mkTask({ id: `t${i}`, title: `T${i}`, estimatedMinutes: 90 }));
    const { blocks, unplaced } = greedySchedule(tasks, [SLEEP], PROFILE, `${DATE}T00:00`, `${DATE}T24:00`);
    const total = blocks.filter((b) => b.type === 'flexible')
      .reduce((acc, b) => acc + (toMinLocal(b.end) - toMinLocal(b.start)), 0);
    expect(total).toBeLessThanOrEqual(360);
    expect(unplaced.length).toBeGreaterThanOrEqual(1);
  });

  it('连续工作上限：达到上限时自动插入休息块，任意连续链 ≤ 120 分钟', () => {
    const { blocks } = greedySchedule(
      [mkTask({ id: 'long', title: '长任务', estimatedMinutes: 180 })],
      [SLEEP], PROFILE, `${DATE}T00:00`, `${DATE}T24:00`,
    );
    expect(blocks.some((b) => b.type === 'break')).toBe(true);
    // 计算任意连续工作链（间隔 < 15 分钟视为同链）
    const work = blocks.filter((b) => b.type === 'flexible')
      .map((b) => [toMinLocal(b.start), toMinLocal(b.end)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let chain = 0; let lastEnd = -Infinity;
    for (const [s, e] of work) {
      if (s - lastEnd < 15) chain += e - s;
      else chain = e - s;
      lastEnd = e;
      expect(chain).toBeLessThanOrEqual(120);
    }
    const total = work.reduce((acc, [s, e]) => acc + e - s, 0);
    expect(total).toBe(180);
  });

  it('最小休息间隔：任意两个相邻弹性块之间间隔 ≥ minBreakMinutes', () => {
    const { blocks } = greedySchedule(
      [mkTask({ id: 'a', title: 'A', estimatedMinutes: 60 }),
       mkTask({ id: 'b', title: 'B', estimatedMinutes: 60 })],
      [SLEEP], PROFILE, `${DATE}T00:00`, `${DATE}T24:00`,
    );
    const flex = blocks.filter((b) => b.type === 'flexible')
      .map((b) => [toMinLocal(b.start), toMinLocal(b.end)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < flex.length; i++) {
      expect(flex[i][0] - flex[i - 1][1]).toBeGreaterThanOrEqual(10);
    }
  });

  it('类别配额：categoryQuotas.英语=60 时，英语块当日总时长 ≤ 60 分钟', () => {
    const tasks = [
      mkTask({ id: 'e1', title: '英语1', category: '英语', estimatedMinutes: 60 }),
      mkTask({ id: 'e2', title: '英语2', category: '英语', estimatedMinutes: 60 }),
    ];
    const { blocks, unplaced } = greedySchedule(tasks, [SLEEP], PROFILE, `${DATE}T00:00`, `${DATE}T24:00`);
    const english = blocks.filter((b) => b.type === 'flexible')
      .reduce((acc, b) => acc + (toMinLocal(b.end) - toMinLocal(b.start)), 0);
    expect(english).toBeLessThanOrEqual(60);
    expect(unplaced.map((t) => t.id)).toContain('e2');
  });

  it('切分：3h 可拆分任务在 90 分钟块上限下 → 拆为多个块，块长均 ≥ minBlockMinutes 且总和 = 180', () => {
    const { blocks } = greedySchedule(
      [mkTask({ id: 'split', title: '大任务', estimatedMinutes: 180 })],
      [SLEEP], PROFILE, `${DATE}T00:00`, `${DATE}T24:00`,
    );
    const chunks = workBlocksOf(blocks, 'split');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(toMinLocal(c.end) - toMinLocal(c.start)).toBeGreaterThanOrEqual(25);
    }
    const total = chunks.reduce((acc, c) => acc + (toMinLocal(c.end) - toMinLocal(c.start)), 0);
    expect(total).toBe(180);
  });

  it('不可拆分任务 > 单块上限且无足够长槽 → 进入 unplaced 而非违规放置', () => {
    const { blocks, unplaced } = greedySchedule(
      [mkTask({ id: 'big', title: '整块任务', estimatedMinutes: 120, splittable: false })],
      [SLEEP], PROFILE, `${DATE}T00:00`, `${DATE}T24:00`,
    );
    expect(unplaced.map((t) => t.id)).toContain('big');
    expect(workBlocksOf(blocks, 'big')).toHaveLength(0);
  });

  it('多样性：同类别任务被降权，另一个不同类别任务先被安排', () => {
    // 链上限调高以隔离变量：本用例只验证多样性惩罚，不验证连续链约束
    const flat: IntensityProfile = {
      ...PROFILE, categoryQuotas: {},
      energyCurve: new Array(24).fill(5), consecutiveWorkCapMinutes: 240,
    };
    // 单一大空闲槽 07:00-24:00
    // 英语任务 120 分钟（拆两块）：第一块立即排入；第二块因多样性惩罚（-0.1）
    // 得分低于优先级更低的学习任务（优先级差 0.08 < 惩罚 0.1）→ 学习任务先被安排
    const { blocks } = greedySchedule(
      [mkTask({ id: 'en', title: '英语', category: '英语', priority: 5, estimatedMinutes: 120 }),
       mkTask({ id: 'study', title: '学习', category: '学习', priority: 3, estimatedMinutes: 60 })],
      [SLEEP], flat, `${DATE}T00:00`, `${DATE}T24:00`,
    );
    const flex = blocks.filter((b) => b.type === 'flexible').sort((a, b) => a.start.localeCompare(b.start));
    // 学习任务插在英语的两块之间
    expect(flex[0]?.taskId).toBe('en');
    expect(flex[1]?.taskId).toBe('study');
    expect(flex[2]?.taskId).toBe('en');
  });

  it('validateConstraints：重叠块被拒绝', () => {
    const existing: Block[] = [{ id: 'x', taskId: 't', start: `${DATE}T10:00`, end: `${DATE}T11:00`, type: 'flexible', locked: false, progress: 0 }];
    const candidate: Block = { id: 'y', taskId: 't', start: `${DATE}T10:30`, end: `${DATE}T11:30`, type: 'flexible', locked: false, progress: 0 };
    expect(validateConstraints(candidate, existing, PROFILE).ok).toBe(false);
    const okCandidate: Block = { ...candidate, start: `${DATE}T11:10`, end: `${DATE}T12:00` };
    expect(validateConstraints(okCandidate, existing, PROFILE).ok).toBe(true);
  });
});

describe('容量预警（DDL 容量复检）', () => {
  it('DDL 前自由容量 < 任务时长 → 产出 CapacityWarning', () => {
    // 白天 07:00-12:00、14:00-18:00 全被占用，DDL 18:00 → DDL 前仅剩 12:00-14:00 = 120 分钟
    const busy: FixedEvent[] = [
      SLEEP,
      { id: 'm', title: '上午满课', startTime: '07:00', endTime: '12:00', rrule: 'FREQ=DAILY', effectiveFrom: DATE },
      { id: 'n', title: '下午满课', startTime: '14:00', endTime: '18:00', rrule: 'FREQ=DAILY', effectiveFrom: DATE },
    ];
    const { unplaced, capacityWarnings } = greedySchedule(
      [mkTask({ id: 'report', title: '实验报告', estimatedMinutes: 180, deadline: `${DATE}T18:00` })],
      busy, PROFILE, `${DATE}T00:00`, `${DATE}T24:00`,
    );
    expect(unplaced.map((t) => t.id)).toContain('report');
    expect(capacityWarnings.length).toBeGreaterThanOrEqual(1);
    expect(capacityWarnings[0].message).toContain('实验报告');
  });

  it('容量足够 → 不产生警告', () => {
    const { capacityWarnings } = greedySchedule(
      [mkTask({ id: 'easy', title: '轻松任务', estimatedMinutes: 60, deadline: '2026-11-10T23:00' })],
      [SLEEP], PROFILE, `${DATE}T00:00`, `${DATE}T24:00`,
    );
    expect(capacityWarnings).toHaveLength(0);
  });
});

describe('incrementalReschedule 增量重排（v0.2 实现）', () => {
  it.skip('TODO(v0.2)：锁定块不动：新增任务重排后，locked=true 的块 start/end 不变', () => {});
  it.skip('TODO(v0.2)：已完成/进行中的块不动，只重排未来未锁定块', () => {});
  it.skip('TODO(v0.2)：超时顺延：某块未完成 → 剩余时长重新入队', () => {});
  it.skip('TODO(v0.2)：强度参数收紧后重排 → 日负荷不超新上限', () => {});
  it.skip('TODO(v0.2)：幂等性：无新增/变更时调用重排 → 输出与输入一致', () => {});
});

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function toMinLocal(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 60_000);
}
