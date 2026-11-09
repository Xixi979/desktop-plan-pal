import { describe, it, expect } from 'vitest';
import { parseIcs, icsWeekdayHit } from '../src/ics.ts';

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//CN',
  'BEGIN:VEVENT',
  'SUMMARY:高等数学',
  'DTSTART;TZID=Asia/Shanghai:20261102T080000',
  'DTEND;TZID=Asia/Shanghai:20261102T094000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:晚自习',
  'DTSTART:20261109T190000',
  'DTEND:20261109T210000',
  'RRULE:FREQ=DAILY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:班会',
  'DTSTART:20261112T140000',
  'DTEND:20261112T153000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:运动会（全天）',
  'DTSTART;VALUE=DATE:20261120',
  'DTEND;VALUE=DATE:20261121',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:跨天活动',
  'DTSTART:20261125T220000',
  'DTEND:20261126T010000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('ICS 日历导入解析', () => {
  it('解析每周重复课程（BYDAY 保留）', () => {
    const { events, skipped } = parseIcs(SAMPLE);
    const math = events.find((e) => e.title === '高等数学');
    expect(math).toBeTruthy();
    expect(math.startTime).toBe('08:00');
    expect(math.endTime).toBe('09:40');
    expect(math.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(math.effectiveFrom).toBe('2026-11-02');
    expect(skipped).toBe(1); // 全天运动会
  });

  it('解析每日重复与仅一次事件', () => {
    const { events } = parseIcs(SAMPLE);
    const study = events.find((e) => e.title === '晚自习');
    expect(study.rrule).toBe('FREQ=DAILY');
    const meeting = events.find((e) => e.title === '班会');
    expect(meeting.rrule).toBe('');
    expect(meeting.startTime).toBe('14:00');
    expect(meeting.endTime).toBe('15:30');
  });

  it('跨天事件收缩为当天 24:00', () => {
    const { events } = parseIcs(SAMPLE);
    const long = events.find((e) => e.title === '跨天活动');
    expect(long.endTime).toBe('24:00');
  });

  it('折行（RFC 5545 续行）与转义字符正确处理', () => {
    const folded = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:数据结构\\,',
      '  第一章复习',
      'DTSTART:20261110T100000',
      'DTEND:20261110T113000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const { events } = parseIcs(folded);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('数据结构, 第一章复习');
  });

  it('WEEKLY 无 BYDAY 时按开始日星期重复；非法输入不抛错', () => {
    const { events, skipped } = parseIcs('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:周会\n'
      + 'DTSTART:20261109T090000\nDTEND:20261109T100000\nRRULE:FREQ=WEEKLY\nEND:VEVENT\n垃圾数据\nEND:VCALENDAR');
    // 2026-11-09 是周一
    expect(events[0].rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(icsWeekdayHit(events[0].rrule, '2026-11-16')).toBe(true);
    expect(icsWeekdayHit(events[0].rrule, '2026-11-17')).toBe(false);
    const bad = parseIcs('完全不是 ICS 的内容');
    expect(bad.events).toHaveLength(0);
    expect(bad.skipped).toBe(0);
  });
});
