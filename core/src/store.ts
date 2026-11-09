/**
 * 数据层：ChangeLog（变更日志）驱动的本地存储（v0.1，零依赖）
 *
 * 设计要点（对应整体方案第三、六节）：
 * - 所有写操作追加 ChangeLogEntry（唯一同步单位），单向追加；
 * - 定期落 Snapshot（快照）收缩日志；启动时 快照 + 增量日志重放 恢复状态；
 * - 存储后端通过 StorageAdapter 抽象：Node 文件（FileAdapter）/ 内存（MemoryAdapter）/
 *   浏览器 localStorage（由 UI 层实现同接口）——为 v0.3 同步与 SQLite 替换留好接口。
 *
 * 约束：仅使用可擦除 TS 语法（无参数属性/枚举），支持 Node --experimental-strip-types 直接运行。
 */

import type {
  ChangeLogEntry, ExecutionLog, FixedEvent, IntensityProfile, Task,
} from './types.ts';

// ---------------------------------------------------------------------------
// 存储适配器抽象
// ---------------------------------------------------------------------------

/** 数据快照：某 seq 时刻的全量状态，用于启动加速与日志收缩 */
export interface Snapshot {
  seq: number;
  tasks: Task[];
  fixedEvents: FixedEvent[];
  intensity: IntensityProfile | null;
  executionLogs: ExecutionLog[];
}

export interface StorageAdapter {
  appendEntry(entry: ChangeLogEntry): void | Promise<void>;
  readEntries(): ChangeLogEntry[] | Promise<ChangeLogEntry[]>;
  saveSnapshot(snapshot: Snapshot): void | Promise<void>;
  loadSnapshot(): Snapshot | null | Promise<Snapshot | null>;
}

/** 内存适配器：测试与浏览器兜底用 */
export class MemoryAdapter {
  entries: ChangeLogEntry[];
  snapshot: Snapshot | null;

  constructor() {
    this.entries = [];
    this.snapshot = null;
  }

  appendEntry(entry: ChangeLogEntry): void {
    this.entries.push(entry);
  }

  readEntries(): ChangeLogEntry[] {
    return [...this.entries];
  }

  saveSnapshot(snapshot: Snapshot): void {
    this.snapshot = JSON.parse(JSON.stringify(snapshot));
  }

  loadSnapshot(): Snapshot | null {
    return this.snapshot ? JSON.parse(JSON.stringify(this.snapshot)) : null;
  }
}

/** 文件适配器：Node 端落盘（changelog.jsonl 追加 + snapshot.json）；动态 import，浏览器构建不触发 */
export class FileAdapter {
  baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private async fs(): Promise<typeof import('node:fs/promises')> {
    return import('node:fs/promises');
  }

  async appendEntry(entry: ChangeLogEntry): Promise<void> {
    const fs = await this.fs();
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(`${this.baseDir}/changelog.jsonl`, JSON.stringify(entry) + '\n', 'utf8');
  }

  async readEntries(): Promise<ChangeLogEntry[]> {
    const fs = await this.fs();
    try {
      const raw = await fs.readFile(`${this.baseDir}/changelog.jsonl`, 'utf8');
      return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    const fs = await this.fs();
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(`${this.baseDir}/snapshot.json`, JSON.stringify(snapshot), 'utf8');
  }

  async loadSnapshot(): Promise<Snapshot | null> {
    const fs = await this.fs();
    try {
      return JSON.parse(await fs.readFile(`${this.baseDir}/snapshot.json`, 'utf8'));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// PlanStore：状态仓库（重放 + 提交 + 撤销）
// ---------------------------------------------------------------------------

export class PlanStore {
  adapter: StorageAdapter;
  deviceId: string;
  seq: number;
  private tasks: Map<string, Task>;
  private fixedEvents: Map<string, FixedEvent>;
  private executionLogs: ExecutionLog[];
  private intensity: IntensityProfile | null;
  private history: ChangeLogEntry[];
  private idCounter: number;

  constructor(adapter: StorageAdapter, deviceId: string) {
    this.adapter = adapter;
    this.deviceId = deviceId;
    this.seq = 0;
    this.tasks = new Map();
    this.fixedEvents = new Map();
    this.executionLogs = [];
    this.intensity = null;
    this.history = [];
    this.idCounter = 0;
  }

  /** 启动恢复：快照 + 重放增量日志（seq 大于快照的部分），然后落一次新快照收缩日志 */
  async open(): Promise<void> {
    const snap = await this.adapter.loadSnapshot();
    if (snap) {
      this.seq = snap.seq;
      this.tasks = new Map(snap.tasks.map((t) => [t.id, t]));
      this.fixedEvents = new Map(snap.fixedEvents.map((e) => [e.id, e]));
      this.executionLogs = snap.executionLogs || [];
      this.intensity = snap.intensity || null;
    }
    const entries = await this.adapter.readEntries();
    for (const entry of entries) {
      if (entry.seq > this.seq) {
        this.replay(entry);
        this.seq = entry.seq;
      }
      this.history.push(entry);
    }
    await this.saveSnapshot();
  }

  /** 重放单条日志到内存状态（纯状态变更，无 IO） */
  private replay(entry: ChangeLogEntry): void {
    switch (entry.entity) {
      case 'task': {
        if (entry.op === 'create') this.tasks.set(entry.entityId, entry.payload.after);
        else if (entry.op === 'update') {
          const t = this.tasks.get(entry.entityId);
          if (t) Object.assign(t, entry.payload.after);
        } else this.tasks.delete(entry.entityId);
        break;
      }
      case 'fixedEvent': {
        if (entry.op === 'create') this.fixedEvents.set(entry.entityId, entry.payload.after);
        else if (entry.op === 'update') {
          const ev = this.fixedEvents.get(entry.entityId);
          if (ev) Object.assign(ev, entry.payload.after);
        } else this.fixedEvents.delete(entry.entityId);
        break;
      }
      case 'intensityProfile': {
        if (entry.op === 'create' || entry.op === 'update') this.intensity = entry.payload.after;
        break;
      }
      case 'executionLog': {
        if (entry.op === 'create') this.executionLogs.push(entry.payload.after);
        break;
      }
    }
  }

  private nextId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${(++this.idCounter).toString(36)}`;
  }

  /** 提交一条变更：深拷贝冻结（防对象别名污染）→ 重放内存 → 追加日志 → 记入历史 */
  private async commit(
    entity: ChangeLogEntry['entity'],
    entityId: string,
    op: ChangeLogEntry['op'],
    payload: unknown,
  ): Promise<ChangeLogEntry> {
    const entry: ChangeLogEntry = JSON.parse(JSON.stringify({
      seq: ++this.seq,
      entity, entityId, op,
      timestamp: new Date().toISOString(),
      deviceId: this.deviceId,
      payload,
    }));
    this.replay(entry);
    this.history.push(entry);
    await this.adapter.appendEntry(entry);
    return entry;
  }

  /** 落快照（收缩日志的依据） */
  async saveSnapshot(): Promise<void> {
    await this.adapter.saveSnapshot({
      seq: this.seq,
      tasks: [...this.tasks.values()],
      fixedEvents: [...this.fixedEvents.values()],
      intensity: this.intensity,
      executionLogs: [...this.executionLogs],
    });
  }

  /**
   * 导入恢复：用备份 JSON（btn-export 导出的格式）整体替换当前状态。
   * 全量替换语义；导入边界处清空撤销历史（不可跨导入撤销）。
   * 校验宽松但必须有 tasks / fixedEvents 数组字段，否则抛错。
   */
  async restoreAll(data: {
    tasks?: Task[];
    fixedEvents?: FixedEvent[];
    intensity?: IntensityProfile | null;
    executionLogs?: ExecutionLog[];
  }): Promise<{ tasks: number; events: number }> {
    if (!Array.isArray(data.tasks) || !Array.isArray(data.fixedEvents)) {
      throw new Error('备份文件格式不正确（缺少 tasks / fixedEvents）');
    }
    this.tasks = new Map(data.tasks.map((t) => [t.id, t]));
    this.fixedEvents = new Map(data.fixedEvents.map((e) => [e.id, e]));
    this.executionLogs = data.executionLogs || [];
    this.intensity = data.intensity || null;
    this.history.length = 0;
    await this.saveSnapshot();
    return { tasks: this.tasks.size, events: this.fixedEvents.size };
  }

  // ---- 任务 ----

  async addTask(input: Omit<Task, 'id' | 'status'>): Promise<Task> {
    const task: Task = { ...input, id: this.nextId('task'), status: 'draft' };
    await this.commit('task', task.id, 'create', { after: task });
    return task;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const before = this.tasks.get(id);
    if (!before) throw new Error(`task not found: ${id}`);
    const after: Task = { ...before, ...patch };
    // 达标规则（业务层强制，UI/同步/手机端一致生效）：
    // 有达标清单且全部勾完 → 自动完成；取消任一勾选 → 自动回退为已排布
    const ck = after.checklist;
    if (ck && ck.length > 0) {
      const allDone = ck.every((c) => c.done);
      if (allDone && after.status !== 'done' && after.status !== 'cancelled') after.status = 'done';
      if (!allDone && after.status === 'done') after.status = 'scheduled';
    }
    await this.commit('task', id, 'update', { before, after });
    return after;
  }

  async deleteTask(id: string): Promise<void> {
    const before = this.tasks.get(id);
    if (!before) return;
    await this.commit('task', id, 'delete', { before });
  }

  // ---- 固定事件 ----

  async addFixedEvent(input: Omit<FixedEvent, 'id'>): Promise<FixedEvent> {
    const ev: FixedEvent = { ...input, id: this.nextId('evt') };
    await this.commit('fixedEvent', ev.id, 'create', { after: ev });
    return ev;
  }

  async removeFixedEvent(id: string): Promise<void> {
    const before = this.fixedEvents.get(id);
    if (!before) return;
    await this.commit('fixedEvent', id, 'delete', { before });
  }

  // ---- 强度参数 / 执行记录 ----

  async setIntensity(profile: IntensityProfile): Promise<void> {
    await this.commit('intensityProfile', profile.id, 'update', {
      before: this.intensity, after: profile,
    });
  }

  async addExecutionLog(input: Omit<ExecutionLog, 'id'>): Promise<ExecutionLog> {
    const log: ExecutionLog = { ...input, id: this.nextId('log') };
    await this.commit('executionLog', log.id, 'create', { after: log });
    return log;
  }

  // ---- 查询 ----

  listTasks(): Task[] {
    return [...this.tasks.values()];
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listFixedEvents(): FixedEvent[] {
    return [...this.fixedEvents.values()];
  }

  getIntensity(): IntensityProfile | null {
    return this.intensity;
  }

  /** 撤销最近一条变更（追加补偿条目，日志本身不可变；补偿条目自身不可再撤销） */
  async undo(): Promise<boolean> {
    let target = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i];
      // 跳过强度参数（配置类操作不参与撤销）与历史补偿条目（防止来回翻转）
      if (entry.entity === 'intensityProfile') continue;
      if (entry.payload && entry.payload.__undoCompensation) continue;
      target = i;
      break;
    }
    if (target < 0) return false;
    const entry = this.history[target];
    this.history.splice(target, 1);
    if (entry.op === 'create') {
      await this.commit(entry.entity, entry.entityId, 'delete',
        { before: entry.payload.after, __undoCompensation: true });
    } else if (entry.op === 'update') {
      await this.commit(entry.entity, entry.entityId, 'update',
        { before: entry.payload.after, after: entry.payload.before, __undoCompensation: true });
    } else {
      await this.commit(entry.entity, entry.entityId, 'create',
        { after: entry.payload.before, __undoCompensation: true });
    }
    await this.saveSnapshot();
    return true;
  }
}
