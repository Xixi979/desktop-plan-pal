/**
 * 桌面计划小人 — 排程引擎（骨架）
 *
 * 对应设计文档《整体方案》第四节。v0.1 采用「贪心 + 多因子评分」：
 * 引擎必须纯函数化（输入任务/课表/参数 → 输出 Block 列表），不依赖 UI，
 * 保证可单元测试、可被手机端复用。
 */

import type { Block, FixedEvent, IntensityProfile, Task } from './types';

/** 空闲槽位：从固定事件中挖去已占用时间后得到的自由时段 */
export interface FreeSlot {
  start: string;
  end: string;
}

/**
 * 第一步：构造空闲槽位。
 * 输入某天的固定事件列表，输出当日自由时段（已排除课表/睡眠/例会）。
 */
export function buildFreeSlots(
  date: string,
  fixedEvents: FixedEvent[],
  profile: IntensityProfile,
): FreeSlot[] {
  // TODO(v0.1)：展开 rrule → 当日占用区间 → 取补集 → 得到 FreeSlot[]
  void date; void fixedEvents; void profile;
  return [];
}

/** 排程候选放置点的多因子评分因子 */
export interface ScoreFactors {
  deadlineUrgency: number;   // DDL 紧迫度：越近权重越高
  priority: number;          // 任务优先级
  energyMatch: number;       // 任务类别 × 该时段精力权重的匹配度
  slotFit: number;           // 剩余槽长与所需块长的贴合程度（碎片适配）
  diversityPenalty: number;  // 多样性惩罚：避免一整天连续同一任务
}

/**
 * 第二步：对每个（任务 × 空闲槽）候选放置点打分，分高者优先放置。
 */
export function scorePlacement(
  task: Task,
  slot: FreeSlot,
  profile: IntensityProfile,
): { score: number; factors: ScoreFactors } {
  // TODO(v0.1)：五因子加权求和，权重初版写死、后续可配置
  void task; void slot; void profile;
  return { score: 0, factors: {
    deadlineUrgency: 0, priority: 0, energyMatch: 0, slotFit: 0, diversityPenalty: 0,
  } };
}

/**
 * 第三步：贪心放置 + 强度约束校验。
 * 放置后检查日负荷上限、单块时长、连续工作上限、最小休息间隔、类别配额；
 * 不满足则切分（任务可拆分时）或顺延到下一个槽位。
 */
export function greedySchedule(
  tasks: Task[],
  fixedEvents: FixedEvent[],
  profile: IntensityProfile,
  rangeStart: string,
  rangeEnd: string,
): { blocks: Block[]; unplaced: Task[]; capacityWarnings: CapacityWarning[] } {
  // TODO(v0.1)：按评分降序逐个放置 → validateConstraints → 记录放不下的任务
  void tasks; void fixedEvents; void profile; void rangeStart; void rangeEnd;
  return { blocks: [], unplaced: [], capacityWarnings: [] };
}

/** 容量预警：DDL 前排不下时提前告知用户 */
export interface CapacityWarning {
  taskId: string;
  message: string; // 如"周四前写不完实验报告，建议每天加 40 分钟或申请延期"
}

/** 约束校验：单次放置是否违反强度约束 */
export function validateConstraints(
  candidate: Block,
  existingBlocks: Block[],
  profile: IntensityProfile,
): { ok: boolean; violations: string[] } {
  // TODO(v0.1)：逐项检查强度约束，返回违反项列表
  void candidate; void existingBlocks; void profile;
  return { ok: true, violations: [] };
}

/**
 * 第四步（v0.2）：增量重排。
 * 触发：新增计划 / 手动拖拽 / 任务超时 / 强度参数变更 / 固定事件变更。
 * 原则：只重排「未开始且未锁定」的块；用户手动拖过的块默认加锁；
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

/**
 * （v0.4 进阶）约束求解优化：OR-Tools CP-SAT（Python 边车进程）。
 * 硬约束：不重叠、不进课表、不超负荷；软约束：精力匹配、偏好时段、间隔休息。
 * 策略：贪心结果先展示，求解器后台异步优化后替换（"先快后好"）。
 */
