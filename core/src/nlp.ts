/**
 * 自然语言解析（v0.2）—— LLM 双路由
 *
 * 路由策略：
 *  - parseRule：零依赖本地规则引擎（默认，永远可用）；
 *  - parseViaLLM：OpenAI 兼容 chat/completions 接口（可选配置）；
 *  - parseDual：双路由入口 —— 配置了 LLM 则先走 LLM（带超时），
 *    失败/超时/无配置自动降级规则版，结果带 via 字段标识来源。
 *
 * 兼容性：禁用 ?. ?? replaceAll 等 ES2020+ 语法（构建产物需 Chrome60+）。
 */

export interface NlpResult {
  title: string;
  category: string;
  estimatedMinutes: number;
  priority: number;          // 1-5，5 最紧急
  splittable: boolean;
  minBlockMinutes: number;
  deadline: string | null;   // "YYYY-MM-DDTHH:mm" 或 null
  via: 'rule' | 'llm';
}

export interface LlmConfig {
  endpoint: string;          // 如 https://api.openai.com/v1/chat/completions
  apiKey: string;
  model: string;             // 如 gpt-4o-mini
}

const WEEK_MAP: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

function pad(n: number): string { return String(n).padStart(2, '0'); }

function isoAt(d: Date, hh: number, mm: number): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hh)}:${pad(mm)}`;
}

/** 解析「下午3点 / 晚上8点半 / 早上9点20 / 中午12点」→ [hour, minute]；无时刻返回 null */
function parseClock(t: string): [number, number] | null {
  const m = /(凌晨|早上|上午|中午|下午|傍晚|晚上)?(\d{1,2})[点:：时](半|(\d{1,2})分?)?/.exec(t);
  if (!m) return null;
  let h = parseInt(m[2], 10);
  let min = m[3] === '半' ? 30 : m[4] ? parseInt(m[4], 10) : 0;
  if (h > 23) return null;
  const tag = m[1] || '';
  if (h < 12 && (tag === '下午' || tag === '傍晚' || tag === '晚上')) h += 12;
  if (tag === '中午' && h < 12) h += 0; // 中午12点保持 12
  return [h, min];
}

/** 解析时长：小时（含「半小时」「一个半小时」「1.5小时」）优先于分钟 */
function parseMinutes(t: string): number | null {
  // 先匹配「N个半小时 / 一个半小时 / 半小时」组合（避免被「半|0.5小时」抢匹配）
  const combo = /(?:(\d+(?:\.\d+)?|一))?个?半小时/.exec(t);
  if (combo) {
    const n = combo[1] ? (combo[1] === '一' ? 1 : parseFloat(combo[1])) : 0;
    return Math.round(n * 60 + 30);
  }
  const mh = /(\d+(?:\.\d+)?)(?:个)?小时(半)?/.exec(t);
  if (mh) return Math.round(parseFloat(mh[1]) * 60 + (mh[2] ? 30 : 0));
  const mm = /(\d+)\s*分钟/.exec(t);
  if (mm) return parseInt(mm[1], 10);
  return null;
}

/** 解析截止日期（相对与绝对）+ 时刻 → "YYYY-MM-DDTHH:mm" | null */
export function parseDeadline(text: string, now?: Date): string | null {
  const base = now || new Date();
  const t = text;
  let dayOff: number | null = null; // 相对天数
  let dateStr: string | null = null;

  const iso = /(\d{4}-\d{2}-\d{2})/.exec(t);
  const md = /(\d{1,2})月(\d{1,2})[日号]/.exec(t);
  const rel = /(今天|今晚|明天|明晚|后天|大后天)/.exec(t);
  const wk = /(?:周|星期)([一二三四五六日天])/.exec(t);

  if (iso) dateStr = iso[1];
  else if (md) {
    const y = base.getFullYear();
    let dt = new Date(y, +md[1] - 1, +md[2]);
    if (dt < new Date(y, base.getMonth(), base.getDate())) dt = new Date(y + 1, +md[1] - 1, +md[2]); // 已过的月日 → 明年
    dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  } else if (rel) {
    dayOff = { 今天: 0, 今晚: 0, 明天: 1, 明晚: 1, 后天: 2, 大后天: 3 }[rel[1]];
  } else if (wk) {
    let diff = (WEEK_MAP[wk[1]] - base.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    dayOff = diff;
  } else {
    return null;
  }

  const clock = parseClock(t);
  const hh = clock ? clock[0] : 22;
  const mm2 = clock ? clock[1] : 0;

  if (dateStr) {
    // 绝对日期 + 可选时刻（「3月5日下午3点」已在同一文本中）
    return dateStr + 'T' + pad(hh) + ':' + pad(mm2);
  }
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (dayOff || 0));
  return isoAt(d, hh, mm2);
}

function parsePriority(t: string): number {
  const urgent = /紧急|尽快|马上|立刻|ASAP/i.test(t);
  const important = /重要|关键/.test(t);
  const relaxed = /不急|慢慢来|有空/.test(t);
  if (urgent && important) return 5;
  if (urgent) return 5;
  if (important) return 4;
  if (relaxed) return 2;
  return 3;
}

const CAT_MAP: Array<[string, string]> = [
  ['单词', '英语'], ['英语', '英语'], ['听力', '英语'], ['口语', '英语'],
  ['健身', '健身'], ['运动', '健身'], ['跑步', '健身'], ['游泳', '健身'],
  ['刷题', '刷题'], ['习题', '刷题'], ['作业', '刷题'], ['真题', '刷题'],
  ['阅读', '阅读'], ['读书', '阅读'], ['看书', '阅读'],
  ['实验', '报告'], ['报告', '报告'], ['论文', '报告'], ['PPT', '报告'],
  ['复习', '学习'], ['预习', '学习'], ['背', '学习'],
  ['开会', '工作'], ['汇报', '工作'], ['周报', '工作'], ['邮件', '工作'],
  ['买菜', '生活'], ['打扫', '生活'], ['洗', '生活'], ['缴费', '生活'],
];

function parseCategory(t: string): string {
  for (const [k, v] of CAT_MAP) { if (t.indexOf(k) >= 0) return v; }
  return '学习';
}

/** 标题清洗：去掉时长、日期时刻、动词残留，保留任务主体 */
function cleanTitle(t: string): string {
  return t
    .replace(/\d+(?:\.\d+)?\s*(?:个)?小时(半)?|\d+\s*分钟|(半|0\.5)小时/g, '')
    .replace(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\d{1,2}[点:：时](半|\d{1,2}分?)?/g, '')
    .replace(/(今天|今晚|明天|明晚|后天|大后天|(周|星期)[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]|\d{4}-\d{2}-\d{2})之?前?(完成|搞定|结束|弄完)/g, '')
    .replace(/(今天|今晚|明天|明晚|后天|大后天|(周|星期)[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]|\d{4}-\d{2}-\d{2})/g, '')
    .replace(/^(?:帮我|请|记得|要|先|再|去|把)(?=[\u4e00-\u9fa5A-Za-z])/g, '')
    .replace(/^[、,，。\s]+|[、,，。\s]+$/g, '')
    .trim() || '新计划';
}

/** 本地规则解析（默认路由，永远可用） */
export function parseRule(text: string, now?: Date): NlpResult {
  const t = text.trim();
  const minutes = parseMinutes(t) || 60;
  return {
    title: cleanTitle(t),
    category: parseCategory(t),
    estimatedMinutes: minutes,
    priority: parsePriority(t),
    splittable: minutes >= 50,
    minBlockMinutes: Math.min(25, minutes),
    deadline: parseDeadline(t, now),
    via: 'rule',
  };
}

/**
 * LLM 路由：OpenAI 兼容 chat/completions。
 * fetchFn 便于测试注入 mock；默认全局 fetch。超时由调用方控制（AbortSignal 或本函数 8s）。
 */
export async function parseViaLLM(
  text: string,
  config: LlmConfig,
  now?: Date,
  fetchFn?: typeof fetch,
): Promise<NlpResult> {
  const f = fetchFn || fetch;
  const base = now || new Date();
  const todayStr = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  const weekday = '日一二三四五六'[base.getDay()];
  const sys = [
    '你是计划助手。从用户的一句话中抽取计划字段，只输出 JSON，不要输出其他文字。',
    '字段：title(简短标题)、category(学习/健身/刷题/阅读/报告/工作/生活/英语之一)、',
    'estimatedMinutes(数字,分钟,默认60)、priority(1-5,5最紧急)、',
    'deadline("YYYY-MM-DDTHH:mm"或null)。今天是 ' + todayStr + '（周' + weekday + '）。',
    '相对时间按今天推算；没有明确时刻的 DDL 默认 22:00。',
  ].join('');
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  try {
    const res = await f(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: text }],
        temperature: 0,
        max_tokens: 200,
      }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new Error('LLM HTTP ' + res.status);
    const data: any = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content) : '';
    const jm = content.indexOf('{');
    const je = content.lastIndexOf('}');
    if (jm < 0 || je <= jm) throw new Error('LLM 无 JSON 输出');
    const j = JSON.parse(content.slice(jm, je + 1));
    const minutes = Number(j.estimatedMinutes) > 0 ? Math.round(Number(j.estimatedMinutes)) : 60;
    return {
      title: String(j.title || '').trim() || parseRule(text, base).title,
      category: String(j.category || '学习'),
      estimatedMinutes: minutes,
      priority: Math.min(5, Math.max(1, Number(j.priority) || 3)),
      splittable: minutes >= 50,
      minBlockMinutes: Math.min(25, minutes),
      deadline: j.deadline ? String(j.deadline) : null,
      via: 'llm',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 双路由入口：有配置走 LLM，任何失败降级规则版。
 */
export async function parseDual(
  text: string,
  opts: { llm?: LlmConfig | null; now?: Date; fetchFn?: typeof fetch },
): Promise<NlpResult> {
  if (opts.llm && opts.llm.endpoint && opts.llm.apiKey && opts.llm.model) {
    try {
      return await parseViaLLM(text, opts.llm, opts.now, opts.fetchFn);
    } catch (e) { /* 降级规则版 */ }
  }
  return parseRule(text, opts.now);
}
