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

/** 节次 → 上课开始时间（默认作息：首都经济贸易大学 13 节制，据教务处课程作息表） */
export const PERIOD_STARTS: string[] = [
  '08:00', '08:50', '09:55', '10:45', '11:35', '13:30', '14:20', '15:25', '16:15',
  '18:00', '18:50', '19:40', '20:30',
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

/** OCR 词级输出（带包围盒，用于网格课表识别） */
export interface GridWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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

// ---------------------------------------------------------------------------
// 网格课表识别（教务系统导出的「节次 × 星期」矩阵表）
// 思路：用 OCR 词级包围盒定位 1) 列头「星期X」→ 每天的 x 中心；
// 2) 行头数字（节次列）→ 行 y 坐标的线性拟合；再把内容词按 (x,y) 归入
// (星期, 节次) 单元格，取每格第一行为课名，相邻同课名节次合并为一段。
// ---------------------------------------------------------------------------

interface DayCol {
  day: string;
  cx: number;
  y1: number;
}

function isJunkWord(t: string): boolean {
  return !t || !/[\u4e00-\u9fffA-Za-z0-9]/.test(t) || /^[|"'“”‘’.,、。()（）{}[\]<>-]+$/.test(t);
}

/** 词的几何中心 */
function wc(w: GridWord): { x: number; y: number } {
  return { x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 };
}

/** 课名相似度（同一门课上下两行 OCR 结果常有 1~2 字误差）：按字符多重集重合率判断 */
function similarTitle(u: string, v: string): boolean {
  if (u === v) return true;
  const maxLen = Math.max(u.length, v.length);
  if (maxLen < 4) return false;
  const cnt = new Map<string, number>();
  for (const ch of u) cnt.set(ch, (cnt.get(ch) || 0) + 1);
  let common = 0;
  for (const ch of v) {
    const c = cnt.get(ch) || 0;
    if (c > 0) { cnt.set(ch, c - 1); common += 1; }
  }
  return common / maxLen >= 0.6;
}

export function parseTimetableGrid(words: GridWord[]): { drafts: TtDraft[]; skipped: number } {
  const ws = (words || [])
    .map((w) => ({ ...w, text: (w.text || '').replace(/\s+/g, '') }))
    .filter((w) => w.text && isJunkWord(w.text) === false && w.x1 > w.x0 && w.y1 > w.y0);
  if (ws.length < 8) return { drafts: [], skipped: 0 };

  // 1) 列头：星期X（词组「星期 + 一」或单词「星期一」）
  const rawCols: DayCol[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    let m = /^(?:星期|周)([一二三四五六日天])$/.exec(w.text);
    if (m) {
      rawCols.push({ day: m[1], cx: wc(w).x, y1: w.y1 });
      continue;
    }
    if (/^(星期|周)$/.test(w.text)) {
      const cand = ws.find(
        (q) => q !== w && /^[一二三四五六日天]$/.test(q.text)
          && q.x0 >= w.x0 + 0.25 * (w.x1 - w.x0) - 2 && q.x0 <= w.x1 + 40
          && Math.min(w.y1, q.y1) - Math.max(w.y0, q.y0) > 0.3 * Math.min(w.y1 - w.y0, q.y1 - q.y0),
      );
      if (cand) rawCols.push({ day: cand.text, cx: (w.x0 + cand.x1) / 2, y1: Math.max(w.y1, cand.y1) });
    }
  }
  rawCols.sort((a, b) => a.cx - b.cx);
  const cols: DayCol[] = [];
  for (const c of rawCols) {
    const prev = cols[cols.length - 1];
    if (prev && prev.day === c.day && Math.abs(prev.cx - c.cx) < 50) continue;
    cols.push(c);
  }
  if (cols.length < 2) return { drafts: [], skipped: 0 }; // 不是网格课表
  const headerMaxY = Math.max(...cols.map((c) => c.y1));

  // 2) 行头节次数字（位于节次列的 1~15 数字），线性拟合 y = a + b*p
  const nums: { p: number; y: number }[] = [];
  for (const w of ws) {
    if (/^\d{1,2}$/.test(w.text) && w.x1 < cols[0].cx - 80) {
      const p = parseInt(w.text, 10);
      if (p >= 1 && p <= 15 && !nums.some((n) => n.p === p)) nums.push({ p, y: wc(w).y });
    }
  }
  nums.sort((a, b) => a.p - b.p);
  if (nums.length < 2) return { drafts: [], skipped: 0 };
  const fit = (pts: { p: number; y: number }[]) => {
    const n = pts.length;
    const sx = pts.reduce((s, v) => s + v.p, 0);
    const sy = pts.reduce((s, v) => s + v.y, 0);
    const sxx = pts.reduce((s, v) => s + v.p * v.p, 0);
    const sxy = pts.reduce((s, v) => s + v.p * v.y, 0);
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx); // 行距（px/节）
    return { b, a: (sy - b * sx) / n };
  };
  let fitRes = fit(nums);
  // 离群点剔除（节次列 OCR 误读数字会污染拟合）：残差 > 0.6 行距的丢弃后重拟合
  let inliers = nums.filter((v) => Math.abs(v.y - (fitRes.a + fitRes.b * v.p)) <= 0.6 * Math.abs(fitRes.b));
  if (inliers.length >= 2 && inliers.length < nums.length) {
    const refit = fit(inliers);
    if (refit.b > 5 && refit.b < 200) fitRes = refit;
  }
  const { a, b } = fitRes;
  if (!(b > 5) || !(b < 200)) return { drafts: [], skipped: 0 };

  // 3) 内容词 → (列, 节次) 单元格
  const leftCut = cols[0].cx - 110; // 节次列/页边噪声的右界
  let maxP = nums[nums.length - 1].p;
  const contentXLimit = cols[cols.length - 1].cx + 150;
  for (const w of ws) {
    if (wc(w).x < leftCut) continue;
    const p = Math.round((wc(w).y - a) / b);
    if (p > maxP && p <= 15) maxP = p;
  }
  const cell = new Map<string, { text: string; x0: number; y0: number; x1: number; y1: number }[]>();
  let skipped = 0;
  for (const w of ws) {
    const c = wc(w);
    if (c.x < leftCut || c.x > contentXLimit) continue;
    let p = Math.round((c.y - a) / b);
    if (p < 1) {
      if (c.y > headerMaxY) p = 1; // 紧贴表头的第一行
      else continue;
    }
    if (p > maxP) continue;
    let ci = 0;
    let best = Infinity;
    for (let i = 0; i < cols.length; i++) {
      const d = Math.abs(c.x - cols[i].cx);
      if (d < best) { best = d; ci = i; }
    }
    const key = `${ci}:${p}`;
    if (!cell.has(key)) cell.set(key, []);
    cell.get(key)!.push({ text: w.text, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 });
  }

  // 4) 每格取第一文本行为课名（其余为教室地点，忽略）
  const titles: { ci: number; p: number; title: string }[] = [];
  for (const [key, list] of cell) {
    const [ciS, pS] = key.split(':');
    const ci = parseInt(ciS, 10);
    const p = parseInt(pS, 10);
    list.sort((u, v) => (u.y0 + u.y1) / 2 - (v.y0 + v.y1) / 2);
    const lineThr = Math.max(8, b * 0.35); // 行内聚类阈值随行距缩放
    const lineYs: number[] = [wc(list[0]).y];
    const lines: { text: string; x0: number }[][] = [[{ text: list[0].text, x0: list[0].x0 }]];
    for (let i = 1; i < list.length; i++) {
      if (Math.abs(wc(list[i]).y - lineYs[lineYs.length - 1]) > lineThr) {
        lines.push([]);
        lineYs.push(wc(list[i]).y);
      } else {
        lineYs[lineYs.length - 1] = wc(list[i]).y;
      }
      lines[lines.length - 1].push({ text: list[i].text, x0: list[i].x0 });
    }
    const title = lines[0].sort((u, v) => u.x0 - v.x0).map((w) => w.text).join('').replace(/\s+/g, '');
    if (!/[\u4e00-\u9fff]/.test(title)) { skipped += 1; continue; }
    if (/校区/.test(title) && lines.length > 1) { skipped += 1; continue; }
    titles.push({ ci, p, title });
  }

  // 5) 同列相邻节次课名相似（OCR 误差容忍）合并 → 时间段
  titles.sort((u, v) => u.ci - v.ci || u.p - v.p);
  const drafts: TtDraft[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < titles.length) {
    let j = i;
    while (
      j + 1 < titles.length
      && titles[j + 1].ci === titles[i].ci
      && titles[j + 1].p === titles[j].p + 1
      && similarTitle(titles[i].title, titles[j + 1].title)
    ) j += 1;
    const col = cols[titles[i].ci];
    const span = periodsToTime(titles[i].p, titles[j].p);
    if (span) {
      const rrule = `FREQ=WEEKLY;BYDAY=${BYDAY_BY_DAY[col.day]}`;
      const key = `${titles[i].title}|${span.start}|${span.end}|${rrule}`;
      if (!seen.has(key)) {
        seen.add(key);
        drafts.push({ title: titles[i].title, startTime: span.start, endTime: span.end, rrule });
      }
    } else {
      skipped += 1;
    }
    i = j + 1;
  }
  return { drafts, skipped };
}
