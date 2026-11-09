import { describe, expect, it } from 'vitest';
import { parseTimetableLine, parseTimetableLines, parseTimetableGrid, PERIOD_STARTS, type GridWord } from '../src/timetable.ts';

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

  it('OCR 噪声：字间空格、节误认为贡（真实 Tesseract 输出形态）', () => {
    const d1 = parseTimetableLine('高 等 数学 周一 08:00-09:40');
    expect(d1!.title).toBe('高等数学');
    expect(d1!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    const d2 = parseTimetableLine('大 学 英语 星期 三 第 3-4 贡');
    expect(d2!.title).toBe('大学英语');
    expect(d2!.startTime).toBe(PERIOD_STARTS[2]);
    expect(d2!.rrule).toContain('WE');
    const d3 = parseTimetableLine('体育 周 五 14:00-15:40');
    expect(d3!.title).toBe('体育');
    expect(d3!.rrule).toBe('FREQ=WEEKLY;BYDAY=FR');
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

// ---------------------------------------------------------------------------
// 网格课表（教务系统「节次 × 星期」矩阵表，OCR 词级包围盒输入）
// ---------------------------------------------------------------------------

/** 造一个网格课表的 OCR 词序列：3 列（一/三/五）× 5 行已知节次 */
function buildGridWords(opts: {
  moCourse: string;      // 周一 1-2 节课名
  weCourse: string;      // 周三 3-4 节课名
  frCourse?: string;     // 周五 6-7 节课名（可选）
  skipRowNums?: number[];// 模拟 OCR 漏识的行头数字
  typoSecondRow?: boolean; // 第二行课名带 OCR 错字（测相似合并）
}): GridWord[] {
  const ws: GridWord[] = [];
  const cols = [
    { day: '一', cx: 178 },
    { day: '三', cx: 340 },
    { day: '五', cx: 506 },
  ];
  // 表头：星期X（星期 + 单字，词框可重叠）
  for (const c of cols) {
    ws.push({ text: '星期', x0: c.cx - 22, y0: 62, x1: c.cx - 2, y1: 76 });
    ws.push({ text: c.day, x0: c.cx - 3, y0: 58, x1: c.cx + 12, y1: 85 });
  }
  ws.push({ text: '节次', x0: 11, y0: 65, x1: 40, y1: 80 });
  // 行头数字（节次列）：1,3,5（可跳过部分）
  const a = 64.2; // y(p) = a + 47.3p
  for (const p of [1, 3, 5]) {
    if (opts.skipRowNums?.includes(p)) continue;
    ws.push({ text: String(p), x0: 43, y0: a + 47.3 * p - 5, x1: 55, y1: a + 47.3 * p + 6 });
  }
  // 课程单元：每个被占节次行都重复「课名 + 地点」两行文字
  const put = (cx: number, p: number, course: string, typo: boolean) => {
    const yC = a + 47.3 * p;
    const name = typo ? course.slice(0, -1) + (course.slice(-1) === '析' ? '雪' : '握') : course;
    // 课名拆成 2 字词（第一行，中心 yC-8）
    for (let i = 0; i < name.length; i += 2) {
      const seg = name.slice(i, i + 2);
      const x0 = cx - seg.length * 7 + i * 14;
      ws.push({ text: seg, x0, y0: yC - 14, x1: x0 + seg.length * 14, y1: yC - 2 });
    }
    // 地点行（第二行，中心 yC+12，行距 20 > 阈值 47.3*0.35≈16.6）
    ws.push({ text: '丰台校区', x0: cx - 40, y0: yC + 6, x1: cx + 8, y1: yC + 18 });
    ws.push({ text: '401', x0: cx + 12, y0: yC + 6, x1: cx + 40, y1: yC + 18 });
  };
  for (const p of [1, 2]) put(178, p, opts.moCourse, !!opts.typoSecondRow && p === 2);
  for (const p of [3, 4]) put(340, p, opts.weCourse, false);
  if (opts.frCourse) for (const p of [6, 7]) put(506, p, opts.frCourse, false);
  return ws;
}

/** 第 p 节的结束时间 = 第 p 节开始 + 45 分钟（与 periodsToTime 一致） */
function endOf(p: number): string {
  const [h, m] = PERIOD_STARTS[p - 1].split(':').map(Number);
  const t = h * 60 + m + 45;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

describe('parseTimetableGrid 网格课表', () => {
  it('基本识别：列头星期 + 行头节次 → 课程草稿，相邻节次合并', () => {
    const r = parseTimetableGrid(buildGridWords({ moCourse: '高等数学', weCourse: '大学英语' }));
    expect(r.drafts.length).toBe(2);
    const mo = r.drafts.find((d) => d.rrule.endsWith('MO'))!;
    expect(mo.title).toBe('高等数学');
    expect(mo.startTime).toBe(PERIOD_STARTS[0]);
    expect(mo.endTime).toBe(endOf(2));
    const we = r.drafts.find((d) => d.rrule.endsWith('WE'))!;
    expect(we.title).toBe('大学英语');
    expect(we.startTime).toBe(PERIOD_STARTS[2]);
  });

  it('行头数字缺失（OCR 漏识）仍可线性拟合；节次列噪声被忽略', () => {
    const ws = buildGridWords({ moCourse: '高等数学', weCourse: '大学英语', skipRowNums: [3] });
    ws.push({ text: '中', x0: 46, y0: 106, x1: 53, y1: 117 });   // 行头 2 误读为汉字
    ws.push({ text: '个', x0: 46, y0: 295, x1: 53, y1: 306 });   // 杂字
    const r = parseTimetableGrid(ws);
    expect(r.drafts.length).toBe(2);
    expect(r.drafts[0].title).toBe('高等数学');
  });

  it('同一门课上下行 OCR 错字 → 按相似度合并为一个时间段', () => {
    const r = parseTimetableGrid(buildGridWords({ moCourse: '财务报表分析', weCourse: '大学英语', typoSecondRow: true }));
    const mo = r.drafts.filter((d) => d.rrule.endsWith('MO'));
    expect(mo.length).toBe(1);
    expect(mo[0].startTime).toBe(PERIOD_STARTS[0]);
    expect(mo[0].endTime).toBe(endOf(2));
  });

  it('周五 6-7 节 → 13:30-15:05（默认作息表）', () => {
    const r = parseTimetableGrid(buildGridWords({ moCourse: '高等数学', weCourse: '大学英语', frCourse: '期货交易与投资实务' }));
    const fr = r.drafts.find((d) => d.rrule.endsWith('FR'))!;
    expect(fr.title).toBe('期货交易与投资实务');
    expect(fr.startTime).toBe('13:30');
    expect(fr.endTime).toBe('15:05');
  });

  it('非网格输入（无星期列头）→ 返回空，交回文字行解析', () => {
    const r = parseTimetableGrid([
      { text: '高等数学', x0: 100, y0: 100, x1: 180, y1: 120 },
      { text: '周一', x0: 200, y0: 100, x1: 240, y1: 120 },
      { text: '08:00-09:40', x0: 260, y0: 100, x1: 360, y1: 120 },
    ]);
    expect(r.drafts.length).toBe(0);
  });

  it('13 节制作息表：第 11-13 节 → 18:50-21:15', () => {
    expect(PERIOD_STARTS.length).toBe(13);
    const d = parseTimetableLine('商品期货与衍生品 周二 第11-13节');
    expect(d).not.toBeNull();
    expect(d!.startTime).toBe('18:50');
    expect(d!.endTime).toBe('21:15');
  });
});
