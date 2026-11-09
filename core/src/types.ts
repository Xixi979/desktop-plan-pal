/**
 * 桌面计划小人 — 排程引擎数据模型（骨架）
 *
 * 对应设计文档《整体方案》第三节。核心原则：
 * - Task（要做什么）与 Block（什么时候做）分离，重排只动 Block 不动 Task；
 * - 所有写操作追加 ChangeLog，作为同步与撤销的基础。
 */

/** 计划状态机：草稿 → 已排布 → 进行中 → 完成/超时顺延/取消 */
export type TaskStatus = 'draft' | 'scheduled' | 'in_progress' | 'done' | 'deferred' | 'cancelled';

/** 达标要求：一条可勾选的完成标准；全部勾完即任务达标（自动标记 done） */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  doneAt?: string;               // 勾选时间（复盘统计用）
}

/** 计划录入来源：一句话文本 / 图片识别 / 链接识别 / 手动表单 */
export type TaskSource = 'text' | 'image' | 'link' | 'manual';

/** 时间块类型 */
export type BlockType = 'fixed' | 'flexible' | 'break' | 'buffer';

/** 计划：要做什么 */
export interface Task {
  id: string;
  title: string;
  category: string;              // 类别：学习/英语/健身/工作...
  estimatedMinutes: number;      // 预估总时长
  deadline?: string;             // DDL（ISO 8601）
  priority: number;              // 1-5，越大越优先
  splittable: boolean;           // 能否切成多个小块
  minBlockMinutes: number;       // 最小块长
  location?: string;             // 地点约束（如"图书馆"）
  dependsOn?: string[];          // 依赖的任务 id（须在其后）
  status: TaskStatus;
  // ---- v0.1.5 新增：达标机制与多通道录入 ----
  checklist?: ChecklistItem[];   // 达标要求列表（全部勾完 → 任务完成）
  folderPath?: string;           // 关联资料文件夹：该任务产出的文件统一放这里（桌面端经 Tauri 打开/创建）
  source?: TaskSource;           // 录入通道
  imageUrl?: string;             // source=image 时保存的压缩预览（dataURL，≤640px）
  linkUrl?: string;              // source=link 时保存的原始链接
}

/** 时间块：什么时候做（排程引擎产出；用户拖拽后加 locked 标记） */
export interface Block {
  id: string;
  taskId: string | null;         // null 表示固定事件/休息等非任务块
  start: string;                 // ISO 8601
  end: string;
  type: BlockType;
  locked: boolean;               // 锁定后增量重排不移动
  progress: number;              // 0-1，长任务拆多块时记录进度比例
}

/** 固定事件：课表、例会、睡眠（不可移动） */
export interface FixedEvent {
  id: string;
  title: string;
  startTime: string;             // "HH:mm"，当日开始时刻
  endTime: string;               // "HH:mm"，"24:00" 表示到当日午夜
  rrule: string;                 // RFC 5545 重复规则（支持 FREQ=DAILY / WEEKLY;BYDAY=MO,TU）；空串表示仅在 effectiveFrom 当天一次性发生
  effectiveFrom: string;         // "YYYY-MM-DD"
  effectiveUntil?: string;       // 支持学期周期
  exceptions?: string[];         // 例外日期
}

/** 强度参数：用户可动态调节的"负荷旋钮"，带生效日期支持历史复现 */
export interface IntensityProfile {
  id: string;
  effectiveDate: string;
  dailyLoadCapMinutes: number;         // 每日总负荷上限
  blockMaxMinutes: number;             // 单块时长上限（如 90）
  blockMinMinutes: number;             // 单块时长下限（如 25）
  minBreakMinutes: number;             // 最小休息间隔
  consecutiveWorkCapMinutes: number;   // 连续工作上限
  energyCurve: number[];               // 24h 精力权重向量（早起型/夜猫型）
  categoryQuotas: Record<string, number>; // 各类别每日配额（分钟）
  nudgeLevel: number;                  // 催促力度 1-3
}

/** 执行记录：实际执行 vs 计划，用于统计与参数学习 */
export interface ExecutionLog {
  id: string;
  blockId: string;
  actualStart: string;
  actualEnd: string;
  completionRate: number;        // 0-1
}

/** 变更日志：唯一同步单位，单向追加 */
export interface ChangeLogEntry {
  seq: number;                   // 单调递增序号
  entity: 'task' | 'block' | 'fixedEvent' | 'intensityProfile' | 'executionLog';
  entityId: string;
  op: 'create' | 'update' | 'delete';
  timestamp: string;
  deviceId: string;
  payload: unknown;              // 变更内容（加密前的明文仅存本地）
}
