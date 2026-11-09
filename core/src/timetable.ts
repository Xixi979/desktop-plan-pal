/**
 * 课表图片/文字解析（v0.2.5）
 * 输入：OCR 识别出的文字行（每行一门课或一段课表信息）
 * 输出：固定安排草稿（FixedEvent 去掉 id）
 *
 * 支持的行样式示例：
 *  - 高等数学 周一 08:00-09:40
 *  - 大学英语 星期三 第3-4节
 *  - 体育 周二第5节
 *  - 数据结构 周四 10:00-11:45 (1-16周)  ← 周次信息忽略，按每周重复
 *  - 单周/双周标注同样忽略（按每周重复，可导入后手动调整）
 */

/** 节次 → 上课时间（24h，默认本科常见作息；每节 45 分钟） */
export const PERIOD_STARTS: string[] = [
  '08:00', '08:55', '10:00', '10:55', '14:00', '14:55', '16:00', '16:55', '19:00', '19:55',
];

const BYDAY_BY_DAY: Record<string, string> = {
  一: 'MO', 二: 'TU', 三: 'WE', 四: 'TH', 五: 'FR', 六: 'SA', 日: 'SU', 天: 'SU',
};

export interface TtDraft {
  title: string;
  startTime: string;
  endTime: string;
  rrule: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 节次区间 → 起止时间；返回 null 表示无法解析 */
function periodsToTime(a: number, b: number): { start: string; end: string } | null {
  if (a < 1 || b > PERIOD_STARTS.length || a > b) return null;
  const start = PERIOD_STARTS[a - 1];
  const endBase = PERIOD_STARTS[b - 1];
  const [h, m] = endBase.split(':').map((x) => parseInt(x, 10));
  const endMin = h * 60 + m + 45; // 每节 45 分钟
  return { start, end: `${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}` };
}

/**
 * 解析一行课表文字 → 草稿；无星期或无时间信息时返回 null
 */
export function parseTimetableLine(line: string): TtDraft | null {
  let t = line.replace(/\s+/g, ' ').trim();
  if (t.length < 3) return null;
  // OCR 常见误认：「节」→「贡/贝」等（仅限紧跟数字后的上下文）
  t = t.replace(/(\d)\s*[贡貝贝](?![\u4e00-\u9fff])/g, '$1节');
  // 中文之间的空格（OCR 分词噪声）：逐对折叠
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
  }

  // 1) 星期（可多个：周一、周三；容忍「周 五」式空格）
  const days: string[] = [];
  const dayRe = /(?:周|星期)\s*([一二三四五六日天])/g;
  let dm: RegExpExecArray | null;
  while ((dm = dayRe.exec(t)) !== null) {
    const code = BYDAY_BY_DAY[dm[1]];
    if (code && !days.includes(code)) days.push(code);
  }

  // 2) 时间：优先 HH:MM-HH:MM，其次 第N-M节 / 第N节 / N-M节
  let start = '';
  let end = '';
  const clockRe = /(\d{1,2})[:：点](\d{2})?\s*[-–—~至到]\s*(\d{1,2})[:：点](\d{2})?/;
  const cm = clockRe.exec(t);
  if (cm) {
    start = `${pad2(+cm[1])}:${cm[2] ? cm[2] : '00'}`;
    end = `${pad2(+cm[3])}:${cm[4] ? cm[4] : '00'}`;
  } else {
    const perRe = /第?\s*(\d{1,2})\s*(?:[-–—~至到]\s*第?\s*(\d{1,2}))?\s*节/;
    const pm = perRe.exec(t);
    if (pm) {
      const a = parseInt(pm[1], 10);
      const b = pm[2] ? parseInt(pm[2], 10) : a;
      const span = periodsToTime(a, b);
      if (span) { start = span.start; end = span.end; }
    }
  }
  if (!days.length || !start || !end) return null;

  // 3) 标题清洗：去掉星期/时间/节次/周次/单双周等结构词
  const title = t
    .replace(/(?:周|星期)[一二三四五六日天]/g, ' ')
    .replace(/\d{1,2}[:：点]\d{2}?\s*[-–—~至到]\s*\d{1,2}[:：点]\d{2}?/g, ' ')
    .replace(/第?\s*\d{1,2}\s*(?:[-–—~至到]\s*第?\s*\d{1,2})?\s*节/g, ' ')
    .replace(/[（(][^）)]*[）)]/g, ' ') // (1-16周) 等括号注记
    .replace(/单双周|单周|双周|每周|全周/g, ' ')
    .replace(/[\d]{1,2}-[\d]{1,2}周/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s、,，。.\-—]+|[\s、,，。.\-—]+$/g, '')
    .trim();
  if (!title) return null;

  return {
    title,
    startTime: start,
    endTime: end,
    rrule: `FREQ=WEEKLY;BYDAY=${days.join(',')}`,
  };
}

/**
 * 批量解析：多行 → 草稿数组（跳过无法解析的行，可带原始行便于提示）
 */
export function parseTimetableLines(lines: string[]): { drafts: TtDraft[]; skipped: string[] } {
  const drafts: TtDraft[] = [];
  const skipped: string[] = [];
  for (const raw of lines) {
    const line = (raw || '').trim();
    if (!line) continue;
    const d = parseTimetableLine(line);
    if (d) drafts.push(d);
    else if (line.length >= 3) skipped.push(line);
  }
  return { drafts, skipped };
}
