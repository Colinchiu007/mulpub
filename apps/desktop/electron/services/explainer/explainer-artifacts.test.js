// @vitest-environment node
// @ts-check
/**
 * explainer-artifacts.test.js — 前生产三阶段产物的构造器 / 校验 / 计数自检
 *
 * ## 覆盖四条线
 *
 * ① **归一化线**：LLM 的松散输出 ⇒ 符合上游 schema 的 artifact（脏值收敛、缺省补齐）。
 * ② **schema 合法性线**：归一化后的产物必须通过 P1 搬进来的上游 schema。
 * ③ **计数自检线**：上游 YAML 的**计数型** success_criteria 必须被机械判出来。
 * ④ **不该被自动判的**：不可机械判的项**不写成自动断言**（那是人工审批要点）——
 *    本文件用「不把不可判项塞进自检结果」这条反向断言锁住它。
 *
 * ## 关键设计（踩过的坑）
 *
 * ⚠ **归一化不能补齐计数型指标**：若归一化把 data_points 不足 3 条也补成 3 条 ⇒
 *   计数自检永远绿 ⇒ **假绿**。本文件用「LLM 给 1 条数据点 ⇒ 自检必须报 INSUFFICIENT_DATA_POINTS」锁住。
 * ⚠ **归一化是 schema 驱动的**（按 schema 补必填），不是手写字段缺省 ⇒ 不会猜错字段。
 * ⚠ **`approval.status` 强制 pending**：LLM 无权自己批准（否则「未审批就花钱」的闸门形同虚设）。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  parseJsonArtifact,
  buildResearchBrief,
  buildProposalPacket,
  buildScript,
  checkResearchBriefCriteria,
  checkProposalCriteria,
  checkScriptCriteria,
  validateArtifact,
} = require('./explainer-artifacts')

function researchRaw (overrides = {}) {
  return {
    topic: '拖延症',
    research_date: '2026-10-24',
    landscape: { existing_content: [], saturated_angles: [], underserved_gaps: [] },
    data_points: [1, 2, 3].map(i => ({ claim: '点' + i, source_url: 'https://example.com/d' + i, credibility: 'primary_source' })),
    audience_insights: { common_questions: ['为什么？'], misconceptions: [], knowledge_level: '入门', pain_points: [] },
    angles_discovered: [1, 2, 3].map(i => ({ name: '角' + i, hook: '钩' + i, type: 'trending', why_now: '现在' })),
    sources: [1, 2, 3, 4, 5].map(i => ({ url: 'https://example.com/s' + i, title: '源' + i })),
    ...overrides,
  }
}

function proposalRaw (overrides = {}) {
  const concept = (id, title) => ({
    id, title, hook: '钩', narrative_structure: 'journey', visual_approach: '时间线',
    suggested_playbook: 'clean-professional', target_audience: '读者', target_platform: 'youtube',
    target_duration_seconds: 60, key_points: ['a', 'b'], core_message: '核心', tone: '平实',
    why_this_works: '有据',
  })
  return {
    concept_options: [concept('c1', '主线'), concept('c2', '视角'), concept('c3', '产业')],
    selected_concept: { concept_id: 'c1', rationale: '覆盖广', modifications: [] },
    production_plan: {
      pipeline: 'animated-explainer', playbook: 'clean-professional',
      stages: [{ stage: 'assets', tools: ['image_selector'], approach: '逐场景' }],
      quality_tradeoffs: [], alternative_paths: [],
      delivery_promise: { promise_type: 'data_explainer', motion_required: true, source_required: false, tone_mode: 'conversational', quality_floor: 'presentable' },
      renderer_family: 'explainer-data', render_runtime: 'remotion', composition_mode: 'templated',
      art_direction: '克制',
    },
    cost_estimate: {
      total_estimated_usd: 0,
      line_items: [{ tool: 'image_selector', operation: 'per scene', quantity: 3, estimated_usd: 0 }],
      budget_verdict: 'within_budget',
    },
    approval: { status: 'pending', user_notes: '' },
    ...overrides,
  }
}

describe('parseJsonArtifact — LLM 输出的 JSON 提取', () => {
  it('直接是 JSON ⇒ 原样取回', () => {
    expect(parseJsonArtifact('{"a":1}')).toEqual({ a: 1 })
  })

  it('带 markdown 围栏 ⇒ 剥围栏取回', () => {
    expect(parseJsonArtifact('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('夹在说明文字里 ⇒ 取出对象段', () => {
    expect(parseJsonArtifact('好的：\n{"a":2}\n完毕')).toEqual({ a: 2 })
  })

  it('非 JSON ⇒ 返回 null（不抛错，调用方 fail-closed）', () => {
    expect(parseJsonArtifact('完全不是 JSON')).toBeNull()
    expect(parseJsonArtifact('')).toBeNull()
  })
})

describe('buildResearchBrief — 归一化 + schema + 计数自检', () => {
  it('归一化后通过上游 research_brief schema', () => {
    const brief = buildResearchBrief(researchRaw(), { topic: '拖延症' })
    const result = validateArtifact('research_brief', brief)
    expect(result.errors.map(e => e.path + ':' + e.keyword)).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('metadata.retrieval 记为 model_knowledge（桌面端无通用 web search ⇒ 非实时检索）', () => {
    const brief = buildResearchBrief(researchRaw(), { topic: '拖延症' })
    expect(brief.metadata.retrieval).toBe('model_knowledge')
  })

  it('参考视频上下文写进 metadata.reference_context', () => {
    const brief = buildResearchBrief(researchRaw(), {
      topic: 'x',
      referenceContext: { covered: ['A'], differentiation_seeds: ['B'] },
    })
    expect(brief.metadata.reference_context.covered).toEqual(['A'])
  })

  it('计数达标时自检为空', () => {
    const brief = buildResearchBrief(researchRaw(), { topic: 'x' })
    expect(checkResearchBriefCriteria(brief)).toEqual([])
  })

  it('⚠ 归一化**不补齐**计数型指标：只给 1 条数据点 ⇒ 自检必须报出来（否则是假绿）', () => {
    const brief = buildResearchBrief(researchRaw({ data_points: [{ claim: '只有一个', source_url: 'https://e.com/1', credibility: 'primary_source' }] }), { topic: 'x' })
    const issues = checkResearchBriefCriteria(brief)
    expect(issues.map(i => i.code)).toContain('INSUFFICIENT_DATA_POINTS')
  })

  it('来源少于 5 条 ⇒ 报 INSUFFICIENT_SOURCES', () => {
    const brief = buildResearchBrief(researchRaw({ sources: [{ url: 'https://e.com/1', title: 's' }] }), { topic: 'x' })
    expect(checkResearchBriefCriteria(brief).map(i => i.code)).toContain('INSUFFICIENT_SOURCES')
  })

  it('来源缺 url ⇒ 报 SOURCE_WITHOUT_URL', () => {
    const brief = buildResearchBrief(researchRaw({ sources: [{ title: '无 url' }] }), { topic: 'x' })
    expect(checkResearchBriefCriteria(brief).map(i => i.code)).toContain('SOURCE_WITHOUT_URL')
  })
})

describe('buildProposalPacket — 归一化 + 审批闸门', () => {
  it('归一化后通过上游 proposal_packet schema', () => {
    const packet = buildProposalPacket(proposalRaw(), {})
    const result = validateArtifact('proposal_packet', packet)
    expect(result.errors.map(e => e.path + ':' + e.keyword)).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('⚠ LLM 若自称 approved 也会被强制改回 pending（审批只能由人给）', () => {
    const packet = buildProposalPacket(proposalRaw({
      approval: { status: 'approved', approved_budget_usd: 99 },
    }), {})
    expect(packet.approval.status).toBe('pending')
  })

  it('概念少于 3 个 ⇒ 自检报 INSUFFICIENT_CONCEPT_OPTIONS', () => {
    const raw = proposalRaw()
    const packet = buildProposalPacket({ ...raw, concept_options: [raw.concept_options[0]] }, {})
    expect(checkProposalCriteria(packet).map(i => i.code)).toContain('INSUFFICIENT_CONCEPT_OPTIONS')
  })

  it('selected_concept 指向不存在的 id ⇒ 报 SELECTED_CONCEPT_NOT_FOUND', () => {
    const packet = buildProposalPacket(proposalRaw({
      selected_concept: { concept_id: '不存在', rationale: '', modifications: [] },
    }), {})
    expect(checkProposalCriteria(packet).map(i => i.code)).toContain('SELECTED_CONCEPT_NOT_FOUND')
  })

  it('无 line_items ⇒ 报 NO_COST_LINE_ITEMS（逐项成本不能缺）', () => {
    const packet = buildProposalPacket(proposalRaw({
      cost_estimate: { total_estimated_usd: 0, line_items: [], budget_verdict: 'within_budget' },
    }), {})
    expect(checkProposalCriteria(packet).map(i => i.code)).toContain('NO_COST_LINE_ITEMS')
  })

  it('render_runtime 缺失时归一化补 remotion，并在 metadata 标注是缺省而非用户选择', () => {
    const raw = proposalRaw()
    delete raw.production_plan.render_runtime
    const packet = buildProposalPacket(raw, {})
    expect(packet.production_plan.render_runtime).toBe('remotion')
    expect(packet.metadata.render_runtime_source).toBe('default')
  })
})

describe('buildScript — 归一化 + 时长自检', () => {
  function scriptRaw (overrides = {}) {
    return {
      title: '拖延症',
      total_duration_seconds: 60,
      voice_performance: { performance_intent: '讲清楚', pacing_profile: 'conversational', sample_section_id: 's1' },
      sections: [{
        id: 's1', text: '第一段。', start_seconds: 0, end_seconds: 60,
        delivery_cues: { pace: 'measured', energy: '中', emphasis_words: ['第一段'], provider_text: '第一段。' },
        enhancement_cues: [{ type: 'overlay', description: '时间线' }],
      }],
      ...overrides,
    }
  }

  it('归一化后通过上游 script schema', () => {
    const script = buildScript(scriptRaw(), { targetDurationSeconds: 60 })
    const result = validateArtifact('script', script)
    expect(result.errors.map(e => e.path + ':' + e.keyword)).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('时长与目标偏差 ≤10% ⇒ 自检为空', () => {
    const script = buildScript(scriptRaw(), { targetDurationSeconds: 60 })
    expect(checkScriptCriteria(script, { targetDurationSeconds: 60 })).toEqual([])
  })

  it('时长偏差 >10% ⇒ 报 DURATION_OUT_OF_TOLERANCE', () => {
    const script = buildScript(scriptRaw({ total_duration_seconds: 120 }), { targetDurationSeconds: 60 })
    expect(checkScriptCriteria(script, { targetDurationSeconds: 60 }).map(i => i.code)).toContain('DURATION_OUT_OF_TOLERANCE')
  })

  it('缺 total_duration_seconds ⇒ 用提案的目标时长兜底', () => {
    const raw = scriptRaw()
    delete raw.total_duration_seconds
    const script = buildScript(raw, { targetDurationSeconds: 45 })
    expect(script.total_duration_seconds).toBe(45)
  })
})

describe('不可机械判的项不进自动自检（反向断言）', () => {
  it('自检结果只含计数/引用类 code，不含「概念是否真正不同」这类主观判断', () => {
    const packet = buildProposalPacket(proposalRaw(), {})
    const codes = checkProposalCriteria(packet).map(i => i.code)
    for (const code of codes) {
      expect(code).toMatch(/^(INSUFFICIENT_|SELECTED_|NO_)/)
    }
  })
})
