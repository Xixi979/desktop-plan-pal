/**
 * 自然语言解析测试（v0.2）—— 规则引擎 + LLM 双路由
 */

import { describe, expect, it } from 'vitest';
import { parseDeadline, parseDual, parseRule, parseViaLLM } from '../src/nlp.ts';

// 固定「现在」：2026-11-09 17:00（周一）
const NOW = new Date(2026, 10, 9, 17, 0, 0);

describe('parseRule 本地规则解析', () => {
  it('时长：半小时 / 一个半小时 / 45分钟 / 1.5小时', () => {
    expect(parseRule('背单词 半小时', NOW).estimatedMinutes).toBe(30);
    expect(parseRule('整理笔记 一个半小时', NOW).estimatedMinutes).toBe(90);
    expect(parseRule('刷题 45分钟', NOW).estimatedMinutes).toBe(45);
    expect(parseRule('写作业1.5小时', NOW).estimatedMinutes).toBe(90);
  });

  it('时刻：明天下午3点 → 明天 T15:00；周五晚上8点 → 周五 T20:00', () => {
    expect(parseRule('明天下午3点交实验报告', NOW).deadline).toBe('2026-11-10T15:00');
    expect(parseRule('周五晚上8点半之前看B站网课', NOW).deadline).toBe('2026-11-13T20:30');
  });

  it('优先级：紧急5 / 重要4 / 重要紧急5 / 不急2 / 默认3', () => {
    expect(parseRule('马上交材料', NOW).priority).toBe(5);
    expect(parseRule('重要：复习重点章节', NOW).priority).toBe(4);
    expect(parseRule('重要且紧急的汇报', NOW).priority).toBe(5);
    expect(parseRule('整理衣柜，不急', NOW).priority).toBe(2);
    expect(parseRule('看会书', NOW).priority).toBe(3);
  });

  it('类别：英语/健身/报告/工作/生活 关键词映射', () => {
    expect(parseRule('背英语单词', NOW).category).toBe('英语');
    expect(parseRule('去健身房跑步', NOW).category).toBe('健身');
    expect(parseRule('写实验报告', NOW).category).toBe('报告');
    expect(parseRule('写周报', NOW).category).toBe('工作');
    expect(parseRule('打扫房间', NOW).category).toBe('生活');
  });

  it('标题清洗：去掉时长/日期时刻/动词残留，保留任务主体', () => {
    expect(parseRule('明天下午3点前完成 英语单词 30分钟', NOW).title).toBe('英语单词');
    expect(parseRule('帮我整理周报 1小时', NOW).title).toBe('整理周报');
    expect(parseRule('周五晚上8点看网课', NOW).title).toBe('看网课');
  });

  it('parseDeadline：绝对日期（已过的月日自动推到明年）', () => {
    expect(parseDeadline('2026-12-01 之前', NOW)).toBe('2026-12-01T22:00');
    expect(parseDeadline('1月5日交', NOW)).toBe('2027-01-05T22:00'); // 2026-01-05 已过
  });

  it('无时长默认 60 分钟，长任务可拆分', () => {
    const r = parseRule('复习高数', NOW);
    expect(r.estimatedMinutes).toBe(60);
    expect(r.splittable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LLM 双路由（mock fetch）
// ---------------------------------------------------------------------------

function mockLlmFetch(content: string, ok = true) {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => (ok ? { choices: [{ message: { content } }] } : {}),
  })) as any;
}

const LLM_CFG = { endpoint: 'https://llm.example/v1/chat/completions', apiKey: 'k-test', model: 'test-model' };

describe('parseViaLLM / parseDual 双路由', () => {
  const GOOD_JSON = JSON.stringify({
    title: '准备组会汇报PPT', category: '报告', estimatedMinutes: 120,
    priority: 4, deadline: '2026-11-11T18:00',
  });

  it('LLM 成功：解析 JSON 输出，via=llm', async () => {
    const r = await parseViaLLM('下周三组会前把PPT做好，挺重要的', LLM_CFG, NOW, mockLlmFetch(GOOD_JSON));
    expect(r.via).toBe('llm');
    expect(r.title).toBe('准备组会汇报PPT');
    expect(r.estimatedMinutes).toBe(120);
    expect(r.priority).toBe(4);
    expect(r.deadline).toBe('2026-11-11T18:00');
  });

  it('LLM 输出夹杂 markdown 围栏也能截取 JSON', async () => {
    const wrapped = '```json\n' + GOOD_JSON + '\n```';
    const r = await parseViaLLM('x', LLM_CFG, NOW, mockLlmFetch(wrapped));
    expect(r.via).toBe('llm');
    expect(r.title).toBe('准备组会汇报PPT');
  });

  it('LLM 失败（HTTP 500）→ parseDual 降级规则版', async () => {
    const r = await parseDual('背单词 半小时', { llm: LLM_CFG, now: NOW, fetchFn: mockLlmFetch('err', false) });
    expect(r.via).toBe('rule');
    expect(r.estimatedMinutes).toBe(30);
    expect(r.category).toBe('英语');
  });

  it('LLM 返回非法 JSON → 降级规则版', async () => {
    const r = await parseDual('明天下午跑步 40分钟', { llm: LLM_CFG, now: NOW, fetchFn: mockLlmFetch('好的，我明白了') });
    expect(r.via).toBe('rule');
    expect(r.estimatedMinutes).toBe(40);
  });

  it('无 LLM 配置 → 直接走规则版', async () => {
    const r = await parseDual('阅读论文 2小时', { llm: null, now: NOW });
    expect(r.via).toBe('rule');
    expect(r.estimatedMinutes).toBe(120);
    expect(r.category).toBe('阅读');
  });
});
