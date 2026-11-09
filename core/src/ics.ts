/**
 * ICS 日历文件导入解析（iCalendar / RFC 5545 子集）
 *
 * 解析 VEVENT 块，映射到本项目 FixedEvent 模型：
 * - RRULE FREQ=DAILY            → 每日重复
 * - RRULE FREQ=WEEKLY;BYDAY=…   → 按周重复（保留 BYDAY）
 * - 无 RRULE                    → 仅一次（effectiveFrom = effectiveUntil = 当天）
 * - 全天事件（VALUE=DATE 无具体时刻）→ 跳过并计入 skipped（整天占用无法编排）
 *
 * 时间格式支持：20261109T083000（本地时刻）、20261109T083000Z（UTC，按本地解读）、
 * 20261109（全天）；带 TZID 参数的按本地时刻解读（v0.1 不做时区换算）。
 */
import type { FixedEvent } from './types';

/** BYDAY 缩写 → 星期序号（0=周日） */
const BYDAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** 解析 ICS 日期时刻值为 { date, minutes, allDay }；minutes 为当天分钟数 */
function parseIcsDateTime(value: string): { date: string; minutes: number; allDay: boolean } {
  const v = value.trim();
  // 全天：YYYYMMDD
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) {
    return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, minutes: 0, allDay: true };
  }
  // 时刻：YYYYMMDDTHHMMSS（可带 Z 或毫秒）
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(v);
  if (m) {
    return {
      date: `${m[1]}-${m[2]}-${m[3]}`,
      minutes: Number(m[4]) * 60 + Number(m[5]),
      allDay: false,
    };
  }
  return { date: '', minutes: 0, allDay: true };
}

/** 分钟数 → HH:MM；1440 → '24:00' */
function toHHMM(minutes: number): string {
  const clamped = Math.min(Math.max(minutes, 0), 1440);
  const h = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** 规范化 RRULE：仅保留本项目支持的 DAILY / WEEKLY;BYDAY 形式 */
function normalizeRrule(rrule: string, startDate: string): string {
  const freq = /FREQ=(DAILY|WEEKLY)/i.exec(rrule);
  if (!freq) return ''; // MONTHLY/YEARLY 等暂不支持 → 退化为仅一次
  if (freq[1].toUpperCase() === 'DAILY') return 'FREQ=DAILY';
  const byday = /BYDAY=([A-Z,]+)/i.exec(rrule);
  if (byday) {
    const days = byday[1].split(',').map((d) => d.trim().toUpperCase())
      .filter((d) => BYDAY_MAP[d] !== undefined);
    if (days.length) return `FREQ=WEEKLY;BYDAY=${days.join(',')}`;
  }
  // WEEKLY 无 BYDAY → 按开始日的星期重复
  const dow = new Date(`${startDate}T00:00`).getDay();
  const token = Object.keys(BYDAY_MAP).find((k) => BYDAY_MAP[k] === dow) || 'MO';
  return `FREQ=WEEKLY;BYDAY=${token}`;
}

export interface IcsParseResult {
  events: FixedEvent[];
  /** 跳过的事件数（全天事件等无法编排的） */
  skipped: number;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `ics-${Date.now().toString(36)}-${seq}`;
}

/** 解析 ICS 文本为 FixedEvent 列表（纯函数，不抛错：坏块跳过） */
export function parseIcs(text: string): IcsParseResult {
  // 1) 展开折行：以空格/制表符开头的行属于上一行
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  const events: FixedEvent[] = [];
  let skipped = 0;
  let cur: { summary: string; dtstart?: ReturnType<typeof parseIcsDateTime>; dtend?: ReturnType<typeof parseIcsDateTime>; rrule: string } | null = null;

  const flush = () => {
    if (!cur) return;
    try {
      if (cur.summary && cur.dtstart && cur.dtend && !cur.dtstart.allDay && !cur.dtend.allDay) {
        const startMin = cur.dtstart.minutes;
        let endMin = cur.dtend.minutes;
        // 跨天：结束时刻早于开始时刻 → 收缩为当天结束（24:00）
        if (endMin <= startMin) endMin = 1440;
        events.push({
          id: nextId(),
          title: cur.summary,
          startTime: toHHMM(startMin),
          endTime: endMin >= 1440 ? '24:00' : toHHMM(endMin),
          rrule: normalizeRrule(cur.rrule, cur.dtstart.date),
          effectiveFrom: cur.dtstart.date,
        });
      } else {
        skipped += 1; // 全天事件或缺关键字段
      }
    } catch (e) {
      skipped += 1;
    }
    cur = null;
  };

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) { cur = { summary: '', rrule: '' }; continue; }
    if (line.startsWith('END:VEVENT')) { flush(); continue; }
    if (!cur) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = left.split(';')[0].toUpperCase();

    if (name === 'SUMMARY') {
      cur.summary = value.replace(/\\,/g, ',').replace(/\\n/g, ' ').trim();
    } else if (name === 'DTSTART') {
      cur.dtstart = parseIcsDateTime(value);
    } else if (name === 'DTEND') {
      cur.dtend = parseIcsDateTime(value);
    } else if (name === 'RRULE') {
      cur.rrule = value;
    }
  }

  return { events, skipped };
}

/** 从 RRULE 判断某日期是否命中（供 UI 预览用；引擎内已含同逻辑） */
export function icsWeekdayHit(rrule: string, date: string): boolean {
  if (rrule.includes('DAILY')) return true;
  const m = /BYDAY=([A-Z,]+)/.exec(rrule);
  if (!m) return true;
  const dow = new Date(`${date}T00:00`).getDay();
  return m[1].split(',').some((d) => BYDAY_MAP[d.trim()] === dow);
}
