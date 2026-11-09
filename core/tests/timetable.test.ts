import { describe, expect, it } from 'vitest';
import { parseTimetableLine, parseTimetableLines, PERIOD_STARTS } from '../src/timetable.ts';

describe('parseTimetableLine 单行解析', () => {
  it('完整行：标题 + 星期 + 时钟时间', () => {
    const d = parseTimetableLine('高等数学 周一 08:00-09:40');
    expect(d).not.toBeNull();
    expect(d!.title).toBe('高等数学');
    expect(d!.startTime).toBe('08:00');
    expect(d!.endTime).toBe('09:40');
    expect(d!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  it('节次表达：第3-4节 → 默认作息时间', () => {
    const d = parseTimetableLine('大学英语 星期三 第3-4节');
    expect(d).not.toBeNull();
    expect(d!.startTime).toBe(PERIOD_STARTS[2]);
    // 第4节开始 + 45 分钟
    const [h, m] = PERIOD_STARTS[3].split(':').map(Number);
    const endMin = h * 60 + m + 45;
    expect(d!.endTime).toBe(`${Math.floor(endMin / 60)}:${String(endMin % 60).padStart(2, '0')}`.replace(/^(\d):/, '0$1:'));
    expect(d!.rrule).toContain('WE');
  });

  it('紧凑表达：体育 周二第5节（单节）', () => {
    const d = parseTimetableLine('体育 周二第5节');
    expect(d).not.toBeNull();
    expect(d!.title).toBe('体育');
    expect(d!.startTime).toBe(PERIOD_STARTS[4]);
  });

  it('括号周次与单双周注记被忽略', () => {
    const d = parseTimetableLine('数据结构 周四 10:00-11:45 (1-16周) 单周');
    expect(d).not.toBeNull();
    expect(d!.title).toBe('数据结构');
    expect(d!.startTime).toBe('10:00');
    expect(d!.endTime).toBe('11:45');
    expect(d!.rrule).toBe('FREQ=WEEKLY;BYDAY=TH');
  });

  it('多星期：周一和周三都有', () => {
    const d = parseTimetableLine('概率论 周一、周三 14:00-15:40');
    expect(d).not.toBeNull();
    expect(d!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('缺星期或缺时间 → null（跳过）', () => {
    expect(parseTimetableLine('高等数学 08:00-09:40')).toBeNull();
    expect(parseTimetableLine('高等数学 周一')).toBeNull();
    expect(parseTimetableLine('ab')).toBeNull();
    expect(parseTimetableLine('')).toBeNull();
  });
});

describe('parseTimetableLines 批量解析', () => {
  it('多行混合：可解析行 + 跳过行', () => {
    const r = parseTimetableLines([
      '高等数学 周一 08:00-09:40',
      '大学英语 星期三 第3-4节',
      '这是课表标题不是课程行',
      '',
    ]);
    expect(r.drafts.length).toBe(2);
    expect(r.skipped.length).toBe(1);
    expect(r.drafts[0].title).toBe('高等数学');
    expect(r.drafts[1].rrule).toContain('WE');
  });

  it('同名同时段去重由调用方处理，这里保证草稿字段完整', () => {
    const r = parseTimetableLines(['体育 周二第5节', '体育 周二第5节']);
    expect(r.drafts.length).toBe(2);
    for (const d of r.drafts) {
      expect(d.title).toBe('体育');
      expect(d.endTime > d.startTime).toBe(true);
    }
  });
});
