'use strict'
/**
 * explainer-preprod-stages — 前生产三阶段（research / proposal / script）的执行器
 *
 * ## 为什么单独成文件
 *
 * `explainer-stages.js` 在本片之前已 474 行（仓库对该文件的**零容差**上限是 500 行）⇒
 * 「把产物对齐的逻辑继续堆进去」会当场触发 `TARGET_GREW` ⇒ 按仓库纪律**抽模块**而非抬基线。
 *
 * ## 本模块负责什么
 *
 * 三个阶段各做四件事（顺序恒定，**不可调换**）：
 * ① 用**结构化提示词**让 LLM 出 JSON（不再是散文）；
 * ② 解析 + **归一化**成上游 artifact（脏值收敛，见 `explainer-artifacts.js`）；
 * ③ 用**上游 schema** 校验（P1 搬进来的逐字副本）；
 * ④ 跑**计数型** success_criteria 自检（不可机械判的项归人工审批门，不写成自动断言）。
 *
 * ⚠ 任一步失败 ⇒ **fail-closed**（返回 `{success:false, error}`），
 * **不产出半成品**（半成品会让下游阶段拿着缺字段的产物继续跑，问题被推到更远的地方才炸）。
 */

const { emitStageStart, emitStageComplete } = require('../stage-progress')
// ⚠ 与 scenes 阶段**共用**同一份 LLM 调用实现（单一真源；语义与原实现一字未改）
const { callDefaultLlm } = require('./llm-call')

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



/** 把校验/自检的 issues 汇总成一条可读错误（带字段路径） */
function formatIssues (prefix, schemaErrors, criteriaIssues) {
  const parts = []
  if (schemaErrors && schemaErrors.length) {
    parts.push('schema 校验失败 ' + schemaErrors.length + ' 处：' +
      schemaErrors.slice(0, 5).map(e => e.path + ' ' + e.keyword + '（' + e.message + '）').join('；'))
  }
  if (criteriaIssues && criteriaIssues.length) {
    parts.push('success_criteria 未达标：' +
      criteriaIssues.map(i => i.code + '（' + i.message + '）').join('；'))
  }
  return prefix + '：' + parts.join(' | ')
}

// ── 提示词（结构化输出） ───────────────────────────────────────────────

function buildResearchPrompt (topic, options = {}) {
  const scope = typeof options.scope === 'string' && options.scope.trim()
    ? '\n内容范围：' + options.scope.trim() : ''
  const referenceHint = options.hasReference
    ? '\n**参考视频驱动**：本次有参考视频分析结果（video_analysis_brief）。研究焦点转向「参考片**没有**覆盖的是什么？我们的版本怎么**不同且更好**？」，并在 reference_context 里写清「参考覆盖了什么 / 漏了什么 / 可验证的声明 / 领域变化」，angles_discovered 要显式对位参考片。'
    : ''
  return {
    system: '你是资深视频研究员。为讲解视频做**结构化研究**，只输出严格 JSON 对象，不要任何解释文字或 markdown 围栏。' +
      '结构：{"topic": string, "research_date": "YYYY-MM-DD", "landscape": string,' +
      '"data_points": [{"claim": string, "value": string, "source_url": string}]（至少 3 条，来源要具体，不要空泛）, ' +
      '"audience_insights": [{"question": string, "source": string}]（观众真实疑问，至少 2 条）, ' +
      '"angles_discovered": [{"angle": string, "why_interesting": string}]（至少 3 个**真正不同**的角度）, ' +
      '"sources": [{"title": string, "url": string, "publisher": string}]（至少 5 条，每条必须有 url）, ' +
      '"research_summary": string}。' +
      '⚠ 只输出 JSON。⚠ 不得编造不存在的来源；sources 的 url 必须是真实存在的地址。' +
      referenceHint,
    user: '主题：' + String(topic || '').trim() + scope + referenceHint,
  }
}

function buildProposalPrompt (researchBrief, options = {}) {
  const brief = typeof researchBrief === 'string' ? researchBrief : JSON.stringify(researchBrief || {})
  const budget = options.budgetUsd === undefined || options.budgetUsd === null
    ? '（未指定）' : String(options.budgetUsd)
  return {
    system: '你是视频制片人。基于研究结果提出**可批准的方案**。只输出严格 JSON 对象，不要解释文字或 markdown 围栏。' +
      '结构：{"concept_options": [{"concept_id": string, "title": string, "hook": string, "target_audience": string, ' +
      '"core_message": string, "tone": string, "narrative_structure": string, "key_points": [string], ' +
      '"suggested_playbook": string, "estimated_cost_usd": number|null}]（**至少 3 个真正不同的概念**：结构/钩子/受众都要不同）, ' +
      '"selected_concept": string（指向某个 concept_id）, ' +
      '"production_plan": {"render_runtime": "remotion|ffmpeg", "renderer_family": string, "tools": [string], ' +
      '"image_style": string, "voice_plan": string, "target_duration_seconds": number}, ' +
      '"cost_estimate": {"total_usd": number|null, "pricing_status": string, "line_items": [{"tool": string, "scope": string, "cost_usd": number|null, "pricing_status": string}]}, ' +
      '"approval": {"status": "pending", "notes": string}}。' +
      '⚠ 只输出 JSON。⚠ cost_estimate 必须**逐项**列出（line_items），单价未知就写 null 且 pricing_status="unknown"，**不要编造单价**。',
    user: '研究结果：\n' + brief + '\n\n预算上限（美元）：' + budget,
  }
}

function buildScriptPrompt (proposalPacket, options = {}) {
  const packet = typeof proposalPacket === 'string' ? proposalPacket : JSON.stringify(proposalPacket || {})
  const research = options.researchBrief
    ? ('\n\n研究结果（用于把真实数据写进文案）：\n' +
      (typeof options.researchBrief === 'string' ? options.researchBrief : JSON.stringify(options.researchBrief)))
    : ''
  return {
    system: '你是视频编剧。基于已批准的方案写**逐段旁白脚本**。只输出严格 JSON 对象，不要解释文字或 markdown 围栏。' +
      '结构：{"title": string, "total_duration_seconds": number, ' +
      '"voice_performance": {"performance_intent": string, "pacing_profile": "contemplative|conversational|energetic|technical|cinematic|custom", ' +
      '"energy_curve": string, "pause_policy": string, "sample_section_id": string, "provider_notes": {"key": string}}, ' +
      '"sections": [{"id": string, "label": string, "text": string（这一段的旁白）, "start_seconds": number, "end_seconds": number, ' +
      '"speaker_directions": string, ' +
      '"delivery_cues": {"pace": "slow|measured|conversational|brisk|fast|custom", "energy": string, "emphasis_words": [string], ' +
      '"pause_before_seconds": number, "pause_after_seconds": number, "delivery_note": string, "provider_text": string}, ' +
      '"enhancement_cues": [{"type": "overlay|broll|diagram|stat_card|code_snippet|animation", "description": string, "duration_seconds": number}]}]}。' +
      '⚠ 只输出 JSON。⚠ sections 必须覆盖完整脚本（无空隙），时长总和 ≈ total_duration_seconds。' +
      '⚠ 叙事弧：hook → setup → build → climax → landing。⚠ enhancement_cues 密度约每 8-10 秒一个。',
    user: '已批准的方案：\n' + packet + research,
  }
}

// ── 三个阶段的执行器 ─────────────────────────────────────────────────

function createResearchExecutor (pipelineEngine) {
  return async ({ stage, params, context, onProgress }) => {
    const aiGenerator = (pipelineEngine && pipelineEngine.aiGenerator) || null
    if (!aiGenerator) return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
    const topic = typeof params.text === 'string' ? params.text.trim() : ''
    if (!topic) return { success: false, error: 'animated-explainer research 需要非空主题（params.text）' }

    // 参考视频驱动的生产：若上游提供了 video_analysis_brief，则走「差异化」研究分支
    const referenceBrief = context && context.video_analysis_brief ? context.video_analysis_brief : null
    const { system, user } = buildResearchPrompt(topic, {
      ...(stage.options || {}),
      hasReference: Boolean(referenceBrief),
    })
    try {
      emitStageStart(onProgress, { messageKey: 'stageProgress.explainerResearch' })
      const raw = await callDefaultLlm(aiGenerator, system, user, 8000)
      const parsed = parseJsonArtifact(raw)
      if (!parsed) {
        return { success: false, error: 'research 失败：模型未返回可解析的 JSON（research_brief 必须是对象）' }
      }
      const brief = buildResearchBrief(parsed, {
        topic,
        retrieval: 'model_knowledge',
        referenceContext: referenceBrief ? {
          covered: (referenceBrief.content_analysis && referenceBrief.content_analysis.topics) || [],
          key_claims: (referenceBrief.content_analysis && referenceBrief.content_analysis.key_claims) || [],
          differentiation_seeds:
            (referenceBrief.replication_guidance && referenceBrief.replication_guidance.creative_differentiation_seeds) || [],
          elements_to_replicate:
            (referenceBrief.replication_guidance && referenceBrief.replication_guidance.key_elements_to_replicate) || [],
        } : null,
      })
      const schemaResult = validateArtifact('research_brief', brief)
      const criteriaIssues = checkResearchBriefCriteria(brief)
      if (!schemaResult.ok || criteriaIssues.length) {
        return {
          success: false,
          error: formatIssues('research 未通过', schemaResult.errors, criteriaIssues),
          artifact: brief,
        }
      }
      emitStageComplete(onProgress, { messageKey: 'stageProgress.explainerResearchComplete', summaryKey: 'stageProgress.explainerResearchSummary' })
      return { success: true, output: brief }
    } catch (error) {
      return { success: false, error: 'research 失败：' + (error && error.message ? error.message : String(error)) }
    }
  }
}

function createProposalExecutor (pipelineEngine) {
  return async ({ stage, context, onProgress }) => {
    const aiGenerator = (pipelineEngine && pipelineEngine.aiGenerator) || null
    if (!aiGenerator) return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
    const research = context ? context.research : null
    const hasResearch = research && (typeof research === 'string' ? research.trim() : Object.keys(research).length)
    if (!hasResearch) return { success: false, error: 'animated-explainer proposal 需要 context.research' }
    const { system, user } = buildProposalPrompt(research, {
      ...(stage.options || {}),
      budgetUsd: (stage.options && stage.options.budgetUsd) || null,
    })
    try {
      emitStageStart(onProgress, { messageKey: 'stageProgress.explainerProposal' })
      const raw = await callDefaultLlm(aiGenerator, system, user, 8000)
      const parsed = parseJsonArtifact(raw)
      if (!parsed) {
        return { success: false, error: 'proposal 失败：模型未返回可解析的 JSON（proposal_packet 必须是对象）' }
      }
      const packet = buildProposalPacket(parsed, {
        researchBrief: research,
        budgetUsd: (stage.options && stage.options.budgetUsd) || null,
      })
      const schemaResult = validateArtifact('proposal_packet', packet)
      const criteriaIssues = checkProposalCriteria(packet)
      if (!schemaResult.ok || criteriaIssues.length) {
        return {
          success: false,
          error: formatIssues('proposal 未通过', schemaResult.errors, criteriaIssues),
          artifact: packet,
        }
      }
      emitStageComplete(onProgress, { messageKey: 'stageProgress.explainerProposalComplete', summaryKey: 'stageProgress.explainerProposalSummary' })
      return { success: true, output: packet }
    } catch (error) {
      return { success: false, error: 'proposal 失败：' + (error && error.message ? error.message : String(error)) }
    }
  }
}

function createScriptExecutor (pipelineEngine) {
  return async ({ stage, context, onProgress }) => {
    const aiGenerator = (pipelineEngine && pipelineEngine.aiGenerator) || null
    if (!aiGenerator) return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
    const proposal = context ? context.proposal : null
    const hasProposal = proposal && (typeof proposal === 'string' ? proposal.trim() : Object.keys(proposal).length)
    if (!hasProposal) return { success: false, error: 'animated-explainer script 需要 context.proposal' }
    const targetDuration = proposal && proposal.production_plan
      ? Number(proposal.production_plan.target_duration_seconds) || 0
      : 0
    const { system, user } = buildScriptPrompt(proposal, {
      ...(stage.options || {}),
      researchBrief: context ? context.research : null,
    })
    try {
      emitStageStart(onProgress, { messageKey: 'stageProgress.explainerScript' })
      const raw = await callDefaultLlm(aiGenerator, system, user, 9000)
      const parsed = parseJsonArtifact(raw)
      if (!parsed) {
        return { success: false, error: 'script 失败：模型未返回可解析的 JSON（script 必须是对象）' }
      }
      const script = buildScript(parsed, { proposalPacket: proposal, targetDurationSeconds: targetDuration })
      const schemaResult = validateArtifact('script', script)
      const criteriaIssues = checkScriptCriteria(script, { targetDurationSeconds: targetDuration })
      if (!schemaResult.ok || criteriaIssues.length) {
        return {
          success: false,
          error: formatIssues('script 未通过', schemaResult.errors, criteriaIssues),
          artifact: script,
        }
      }
      emitStageComplete(onProgress, { messageKey: 'stageProgress.explainerScriptComplete', summaryKey: 'stageProgress.explainerScriptSummary' })
      return { success: true, output: script }
    } catch (error) {
      return { success: false, error: 'script 失败：' + (error && error.message ? error.message : String(error)) }
    }
  }
}

module.exports = {
  callDefaultLlm,
  buildResearchPrompt,
  buildProposalPrompt,
  buildScriptPrompt,
  createResearchExecutor,
  createProposalExecutor,
  createScriptExecutor,
  formatIssues,
}
