/**
 * 桌面计划小人 — 排程引擎
 *
 * 对应设计文档《整体方案》第四节。v0.1 采用「贪心 + 多因子评分」：
 * 引擎纯函数化（输入任务/课表/参数 → 输出 Block 列表），不依赖 UI，
 * 可单元测试、可被手机端复用。
 *
 * 时间约定：所有 ISO 字符串均为本地朴素时间（无时区后缀），
 * 内部统一转为「分钟数」做区间运算。
 */

import type { Block, FixedEvent, IntensityProfile, Task } from './types.ts';

// ---------------------------------------------------------------------------
// 时间工具
// ---------------------------------------------------------------------------

const MIN = 60_000;
/** 链式连续工作判定：两次工作间隔小于该阈值视为同一连续链（分钟） */
const CHAIN_GAP_THRESHOLD = 15;

export function toMin(iso: string): number {
  return Math.floor(new Date(iso).getTime() / MIN);
}

export function toIso(minutes: number): string {
  const d = new Date(minutes * MIN);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "YYYY-MM-DD" → 当日 00:00 的分钟数 */
function dayStartMin(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / MIN);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0=周日 … 6=周六
}

// ---------------------------------------------------------------------------
// 固定事件展开（最小 RRULE 支持：DAILY / WEEKLY;BYDAY / 一次性）
// ---------------------------------------------------------------------------

const BYDAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function occursOn(ev: FixedEvent, date: string): boolean {
  if (!ev.rrule) return date === ev.effectiveFrom;
  if (date < ev.effectiveFrom) return false;
  if (ev.effectiveUntil && date > ev.effectiveUntil) return false;
  if (ev.exceptions?.includes(date)) return false;
  const freq = /FREQ=(DAILY|WEEKLY)/.exec(ev.rrule)?.[1];
  if (freq === 'DAILY') return true;
  if (freq === 'WEEKLY') {
    const byday = /BYDAY=([A-Z,]+)/.exec(ev.rrule)?.[1];
    if (!byday) return weekdayOf(date) === weekdayOf(ev.effectiveFrom);
    return byday.split(',').some((k) => BYDAY_MAP[k] === weekdayOf(date));
  }
  return false;
}

/** 固定事件在 date 当天的占用区间 [start, end)（分钟数） */
function occupiedInterval(ev: FixedEvent, date: string): [number, number] {
  const start = dayStartMin(date) + parseHHMM(ev.startTime);
  const end = ev.endTime === '24:00'
    ? dayStartMin(date) + 1440
    : dayStartMin(date) + parseHHMM(ev.endTime);
  return [start, Math.max(start, end)];
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// 第一步：空闲槽位构造
// ---------------------------------------------------------------------------

export interface FreeSlot {
  start: string;
  end: string;
}

/**
 * 从固定事件中挖去已占用时间，得到 date 当天的自由时段。
 * 短于 blockMinMinutes 的碎片槽直接丢弃（避免产生排不了的小缝）。
 */
export function buildFreeSlots(
  date: string,
  fixedEvents: FixedEvent[],
  profile: IntensityProfile,
): FreeSlot[] {
  const dayStart = dayStartMin(date);
  const dayEnd = dayStart + 1440;

  const occupied = fixedEvents
    .filter((ev) => occursOn(ev, date))
    .map((ev) => occupiedInterval(ev, date))
    .sort((a, b) => a[0] - b[0]);

  // 合并重叠区间
  const merged: [number, number][] = [];
  for (const [s, e] of occupied) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  // 取补集
  const slots: FreeSlot[] = [];
  let cursor = dayStart;
  for (const [s, e] of merged) {
    if (s > cursor) pushSlot(cursor, s);
    cursor = Math.max(cursor, e);
  }
  if (cursor < dayEnd) pushSlot(cursor, dayEnd);

  function pushSlot(s: number, e: number) {
    if (e - s >= profile.blockMinMinutes) slots.push({ start: toIso(s), end: toIso(e) });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// 第二步：多因子评分
// ---------------------------------------------------------------------------

export interface ScoreFactors {
  deadlineUrgency: number;   // DDL 紧迫度（0-1）：越近越高；无 DDL 给基础分 0.2
  priority: number;          // 优先级归一化（priority/5）
  energyMatch: number;       // 该时段精力权重归一化（0-1）
  slotFit: number;           // 槽长与所需块长的贴合度（0-1）
  diversityPenalty: number;  // 多样性惩罚（纯函数版恒为 0，贪心中按当日同类别块数追加）
}

/** 评分权重：DDL 紧迫度 > 精力匹配 > 优先级 = 碎片适配 */
const WEIGHTS = { urgency: 0.35, priority: 0.2, energy: 0.25, fit: 0.2 };

export function scorePlacement(
  task: Task,
  slot: FreeSlot,
  profile: IntensityProfile,
): { score: number; factors: ScoreFactors } {
  const slotLen = toMin(slot.end) - toMin(slot.start);

  const deadlineUrgency = task.deadline
    ? clamp(1 - (toMin(task.deadline) - toMin(slot.start)) / (14 * 1440), 0.05, 1)
    : 0.2;

  const priority = task.priority / 5;

  const hour = new Date(slot.start).getHours();
  const curve = profile.energyCurve;
  const energyMatch = curve.length ? curve[hour % 24] / Math.max(...curve) : 1;

  const needed = Math.min(task.estimatedMinutes, profile.blockMaxMinutes);
  const slotFit = needed > 0 ? Math.min(1, slotLen / needed) : 1;

  const factors: ScoreFactors = {
    deadlineUrgency, priority, energyMatch, slotFit, diversityPenalty: 0,
  };
  const score =
    WEIGHTS.urgency * deadlineUrgency +
    WEIGHTS.priority * priority +
    WEIGHTS.energy * energyMatch +
    WEIGHTS.fit * slotFit;
  return { score, factors };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// ---------------------------------------------------------------------------
// 第三步：约束校验
// ---------------------------------------------------------------------------

/** 约束校验：单次放置是否违反强度约束（重叠/日负荷/连续链/最小休息间隔） */
export function validateConstraints(
  candidate: Block,
  existingBlocks: Block[],
  profile: IntensityProfile,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const cs = toMin(candidate.start);
  const ce = toMin(candidate.end);
  const day = candidate.start.slice(0, 10);

  // 1. 不重叠
  if (existingBlocks.some((b) => {
    const bs = toMin(b.start), be = toMin(b.end);
    return cs < be && bs < ce;
  })) violations.push('overlap');

  // 2. 日负荷上限（仅统计当日弹性任务块）
  const dailyLoad = existingBlocks
    .filter((b) => b.type === 'flexible' && b.start.slice(0, 10) === day)
    .reduce((acc, b) => acc + (toMin(b.end) - toMin(b.start)), 0);
  if (dailyLoad + (ce - cs) > profile.dailyLoadCapMinutes) violations.push('dailyLoadCap');

  // 3. 最小休息间隔：与既有块相邻时，间隔必须 ≥ minBreakMinutes
  for (const b of existingBlocks) {
    const bs = toMin(b.start), be = toMin(b.end);
    const gapBefore = cs - be;
    const gapAfter = bs - ce;
    if (gapBefore >= 0 && gapBefore < profile.minBreakMinutes) violations.push('minBreak');
    if (gapAfter >= 0 && gapAfter < profile.minBreakMinutes) violations.push('minBreak');
  }

  // 4. 连续工作上限：与候选块连成链后的总工作时长不得超过上限
  const chain = chainWorkMinutes(cs, ce, existingBlocks);
  if (chain > profile.consecutiveWorkCapMinutes) violations.push('consecutiveCap');

  return { ok: violations.length === 0, violations };
}

/** 计算与 [s,e) 通过"间隔 < CHAIN_GAP_THRESHOLD"相连的所有弹性块的总工作时长（含候选块本身） */
function chainWorkMinutes(s: number, e: number, blocks: Block[]): number {
  const intervals = blocks
    .filter((b) => b.type === 'flexible')
    .map((b) => [toMin(b.start), toMin(b.end)] as [number, number]);
  const set: [number, number][] = [[s, e]];
  let changed = true;
  while (changed) {
    changed = false;
    for (const iv of intervals) {
      if (set.some(([a, b]) => iv[0] < b + CHAIN_GAP_THRESHOLD && a - CHAIN_GAP_THRESHOLD < iv[1])) {
        if (!set.some(([a, b]) => iv[0] === a && iv[1] === b)) { set.push(iv); changed = true; }
      }
    }
  }
  return set.reduce((acc, [a, b]) => acc + (b - a), 0);
}

// ---------------------------------------------------------------------------
// 容量预警
// ---------------------------------------------------------------------------

export interface CapacityWarning {
  taskId: string;
  message: string;
}

// ---------------------------------------------------------------------------
// 贪心排程
// ---------------------------------------------------------------------------

let blockSeq = 0;
function nextBlockId(): string {
  return `blk-${(++blockSeq).toString(36)}-${Date.now().toString(36).slice(-4)}`;
}

interface WorkSlot { date: string; start: number; end: number }

/**
 * 贪心排程：任务按「优先级降序 → DDL 升序」逐个放置到评分最高的空闲槽。
 * 放置后自动收缩槽位并预留最小休息间隔；连续工作达到上限时插入休息块；
 * DDL 前容量不足时产出 CapacityWarning。
 */
export function greedySchedule(
  tasks: Task[],
  fixedEvents: FixedEvent[],
  profile: IntensityProfile,
  rangeStart: string,
  rangeEnd: string,
): { blocks: Block[]; unplaced: Task[]; capacityWarnings: CapacityWarning[] } {
  const blocks: Block[] = [];
  const unplaced: Task[] = [];
  const warnings: CapacityWarning[] = [];
  const dailyLoad = new Map<string, number>();       // date → 弹性块总分钟
  const categoryLoad = new Map<string, number>();    // date|category → 分钟
  const sameCatCount = new Map<string, number>();    // date|category → 已放置块数（多样性惩罚）

  // 构造日期范围内的全部空闲槽
  const slots: WorkSlot[] = [];
  let d = rangeStart.slice(0, 10);
  const endDate = rangeEnd.slice(0, 10);
  for (let i = 0; d <= endDate && i < 60; i++, d = addDays(d, 1)) {
    for (const fs of buildFreeSlots(d, fixedEvents, profile)) {
      slots.push({ date: d, start: toMin(fs.start), end: toMin(fs.end) });
    }
  }

  const sorted = [...tasks].sort((a, b) =>
    b.priority - a.priority ||
    (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') ||
    b.estimatedMinutes - a.estimatedMinutes);

  // 预检：不可拆分且超出单块上限 → 直接无法排布
  const remainingMap = new Map<string, number>();
  for (const task of sorted) {
    remainingMap.set(task.id, task.estimatedMinutes);
    if (!task.splittable && task.estimatedMinutes > profile.blockMaxMinutes) {
      remainingMap.set(task.id, 0);
      unplaced.push(task);
      if (task.deadline) pushCapacityWarning(task, task.estimatedMinutes);
    }
  }

  // 轮转扫描：每一轮按优先级顺序给每个未完成任务放置一个块。
  // 这样高优先级任务优先排入，且同一任务的多个块自然被其他任务交错，
  // 多样性惩罚（同类别当日块数越多降权越多）则引导块分散到不同日期/时段。
  let progress = true;
  while (progress) {
    progress = false;
    for (const task of sorted) {
      const remaining = remainingMap.get(task.id) ?? 0;
      if (remaining <= 0) continue;
      const deadlineMin = task.deadline ? toMin(task.deadline) : Number.POSITIVE_INFINITY;

      // 评分并排序所有候选槽（多样性惩罚参与排序）
      const candidates = slots
        .map((s, idx) => {
          const base = scorePlacement(task, { start: toIso(s.start), end: toIso(s.end) }, profile).score;
          const diversityPenalty = 0.1 * (sameCatCount.get(`${s.date}|${task.category}`) ?? 0);
          return { idx, s, score: base - diversityPenalty };
        })
        .filter(({ s }) => s.end - s.start >= Math.max(profile.blockMinMinutes,
          task.splittable ? 0 : task.estimatedMinutes))
        .sort((a, b) => b.score - a.score);

      candidateLoop:
      for (const { idx, s } of candidates) {
        const date = s.date;
        // attempt 循环：链满插入休息块后重试同一槽位
        for (let attempt = 0; attempt < 4; attempt++) {
          // 候选块长度
          let chunk = task.splittable
            ? Math.min(remaining, profile.blockMaxMinutes, s.end - s.start)
            : task.estimatedMinutes;
          if (chunk < profile.blockMinMinutes) continue candidateLoop;
          // DDL 截断：块必须完完全全落在 DDL 之前
          if (s.start + chunk > deadlineMin) chunk = deadlineMin - s.start;
          if (chunk < profile.blockMinMinutes) continue candidateLoop;
          // 类别配额
          const catKey = `${date}|${task.category}`;
          const quota = profile.categoryQuotas[task.category];
          if (quota != null && (categoryLoad.get(catKey) ?? 0) + chunk > quota) continue candidateLoop;

          const start = s.start;
          // 连续工作上限：必要时压缩块长
          const chain = chainWorkMinutes(start, start + chunk, blocks);
          if (chain > profile.consecutiveWorkCapMinutes) {
            const others = chain - chunk;
            chunk = profile.consecutiveWorkCapMinutes - others;
            if (chunk < profile.blockMinMinutes) {
              // 链已满：插入一个休息块（15 分钟），为后续工作断链，然后重试本槽位
              const breakEnd = start + CHAIN_GAP_THRESHOLD;
              blocks.push({ id: nextBlockId(), taskId: null, start: toIso(start),
                end: toIso(breakEnd), type: 'break', locked: false, progress: 0 });
              s.start = breakEnd + profile.minBreakMinutes;
              if (s.start + profile.blockMinMinutes > s.end) removeSlot(idx);
              continue;
            }
          }
          const end = start + chunk;
          const candidate: Block = { id: nextBlockId(), taskId: task.id, start: toIso(start),
            end: toIso(end), type: 'flexible', locked: false, progress: 0 };

          const v = validateConstraints(candidate, blocks, profile);
          if (!v.ok) continue candidateLoop;

          // 提交放置
          blocks.push(candidate);
          dailyLoad.set(date, (dailyLoad.get(date) ?? 0) + chunk);
          categoryLoad.set(catKey, (categoryLoad.get(catKey) ?? 0) + chunk);
          sameCatCount.set(catKey, (sameCatCount.get(catKey) ?? 0) + 1);
          // 收缩槽位并预留最小休息间隔
          s.start = end + profile.minBreakMinutes;
          if (s.start + profile.blockMinMinutes > s.end) removeSlot(idx);

          remainingMap.set(task.id, remaining - chunk);
          progress = true;
          break candidateLoop;
        }
      }
    }
  }

  // 收尾：仍有剩余时长未排布的任务进入 unplaced，DDL 任务产出容量预警
  for (const task of sorted) {
    const remaining = remainingMap.get(task.id) ?? 0;
    if (remaining > 0) {
      unplaced.push(task);
      if (task.deadline) pushCapacityWarning(task, remaining);
    }
  }

  function removeSlot(idx: number) {
    const i = slots.findIndex((_, i2) => i2 === idx);
    if (i >= 0) slots.splice(i, 1);
  }
  function pushCapacityWarning(task: Task, remainingMin: number) {
    warnings.push({
      taskId: task.id,
      message: `「${task.title}」在 DDL ${task.deadline} 前还有 ${remainingMin} 分钟排不下，建议提高每日负荷上限、拆分任务或调整 DDL。`,
    });
  }

  return { blocks, unplaced, capacityWarnings: warnings };
}

// ---------------------------------------------------------------------------
// 第四步（v0.2）：增量重排
// ---------------------------------------------------------------------------

/**
 * 增量重排：只重排「未开始且未锁定」的块；用户手动拖过的块默认加锁；
 * 超时任务的剩余时长重新入队，优先占用最近的低价值空闲槽。
 */
export function incrementalReschedule(
  blocks: Block[],
  tasks: Task[],
  fixedEvents: FixedEvent[],
  profile: IntensityProfile,
  fromTime: string,
): { blocks: Block[]; warnings: CapacityWarning[] } {
  // TODO(v0.2)
  void blocks; void tasks; void fixedEvents; void profile; void fromTime;
  return { blocks: [], warnings: [] };
}
