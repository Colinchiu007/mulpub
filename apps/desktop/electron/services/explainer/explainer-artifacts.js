'use strict'
/**
 * explainer-artifacts — 上游 OpenMontage artifact 的构造器 + 归一化 + 机械自检
 *
 * ## 定位
 *
 * 桌面端的 explainer 三个前生产阶段（research / proposal / script）此前**只出散文**：
 * LLM 返回一段文本，阶段直接把文本塞进 `context.research` / `context.proposal` / `context.script`。
 * 上游 OpenMontage 的对应阶段产出的是**带硬指标的结构化 artifact**（research_brief /
 * proposal_packet / script），并由 EP 做「REVIEW + GATE DECISION」。
 *
 * 本模块负责三件事（**不含**阶段编排与审批门 —— 那是 P3/P4 的事）：
 * ① **归一化**：把 LLM 的松散输出收敛成符合上游 schema 的 artifact（脏值收敛成缺省，不抛错）。
 * ② **schema 校验**：用 P1 搬进来的上游 schema 逐个校验（P1 的 `artifact-schema-validator`）。
 * ③ **机械自检**：把上游 YAML 里**计数型**的 `success_criteria` 落成可执行断言
 *    （不可机械判的项不写成自动断言 —— 那是人工审批要点，见 PRD §16）。
 *
 * ## 为什么「归一化」与「校验」要分开
 *
 * 归一化负责**能救的救**（缺省值、类型收敛、字符串修剪）；
 * 校验负责**救不了的报错**（缺 required、枚举越界、计数不达标）。
 * ⚠ 两者混在一起 ⇒ 校验会永远绿（因为归一化把违规都补上了）⇒ 假绿。
 * ⇒ 本模块的顺序恒为：**先归一化 → 再 schema 校验 → 再计数自检**，
 *    且**归一化不得补齐计数型指标**（如 data_points 不足 3 条时**不补**，让自检报出来）。
 */

const { validate, loadSchema } = require('./artifact-schema-validator')

/**
 * 按 schema **递归补齐必填字段的缺省值**（其余字段原样透传）。
 *
 * ## 为什么用「schema 驱动」而不是逐字段手写缺省
 *
 * 手写缺省 = **凭想象猜字段**（本次实测：把 `landscape` 当字符串、`data_points[].value`
 * 当合法字段、`selected_concept` 当字符串 —— 全部与上游 schema 相反 ⇒ 产物一律不合法）。
 * ⇒ 改为「**schema 说缺什么就补什么**」：schema 是唯一真源 ⇒ 不会猜错、也不会漏。
 *
 * ⚠ 补齐**只针对 required**：不新增 schema 未声明的字段（否则 additionalProperties:false 会拒）。
 * ⚠ 数组的 `minItems` 若 > 0 则补空位占位（由调用方决定是否有真实内容）。
 *
 * @param {*} value 当前值
 * @param {object} schema 当前节点的 schema
 * @param {object} root 根 schema（$ref 解析用）
 * @returns {*} 补齐后的值
 */
function fillRequired (value, schema, root) {
  if (!schema || typeof schema !== 'object') return value
  if (schema.$ref) {
    const segs = String(schema.$ref).slice(2).split('/')
    let node = root
    for (const seg of segs) node = node && node[seg]
    return node ? fillRequired(value, node, root) : value
  }
  if (schema.type === 'object' || schema.properties) {
    const out = (value && typeof value === 'object' && !Array.isArray(value)) ? { ...value } : {}
    const props = schema.properties || {}
    const required = new Set(schema.required || [])
    // ⚠ **遍历全部 properties**（不只 required）：存在的字段一律递归（这样非必填数组的
    // minItems 也能被补足）；**只有** required 且缺失的字段才补缺省值。
    // ⚠ 只递归 required 会漏：「key_points」非必填但有 minItems=2 ⇒ 不补 ⇒ schema 判红。
    for (const key of Object.keys(props)) {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = fillRequired(out[key], props[key], root)
        continue
      }
      if (required.has(key)) out[key] = fillRequired(undefined, props[key], root)
    }
    return out
  }
  if (schema.type === 'array') {
    const arr = Array.isArray(value) ? value.slice() : []
    const min = typeof schema.minItems === 'number' ? schema.minItems : 0
    while (arr.length < min) arr.push(fillRequired(undefined, schema.items, root))
    if (schema.items && !Array.isArray(schema.items)) {
      for (let i = 0; i < arr.length; i++) arr[i] = fillRequired(arr[i], schema.items, root)
    }
    return arr
  }
  if (value === undefined || value === null) {
    if (schema.default !== undefined) return schema.default
    if (schema.const !== undefined) return schema.const
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
    switch (schema.type) {
      case 'string': return schema.format === 'date' ? new Date().toISOString().slice(0, 10)
        : schema.format === 'date-time' ? new Date().toISOString() : ''
      case 'number': case 'integer': return typeof schema.minimum === 'number' ? schema.minimum : 0
      case 'boolean': return false
      case 'array': return []
      case 'object': return {}
      default: return null
    }
  }
  if (schema.type === 'string' && typeof value !== 'string') return String(value)
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value !== 'number') {
    return typeof schema.minimum === 'number' ? schema.minimum : 0
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') return Boolean(value)
  return value
}

const ARTIFACT_VERSION = '1.0'

/** 上游 research_brief 的计数型 success_criteria */
const RESEARCH_MIN_DATA_POINTS = 3
const RESEARCH_MIN_ANGLES = 3
const RESEARCH_MIN_SOURCES = 5

/** 上游 proposal_packet 的计数型 success_criteria */
const PROPOSAL_MIN_CONCEPTS = 3

/** 上游 script 的计数型 success_criteria（时长 ±10%） */
const SCRIPT_DURATION_TOLERANCE = 0.1

function asText (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function asArray (value) {
  return Array.isArray(value) ? value : []
}

function asObject (value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * 从 LLM 输出里提取 JSON 对象/数组（容忍 markdown 围栏、说明文字、对象包装）。
 * 口径与上游 `parseScenesJson` 一致，但改为**对象优先**（artifact 都是对象）。
 * @param {string} text LLM 原始输出
 * @returns {object|null}
 */
function parseJsonArtifact (text) {
  const source = asText(text)
  if (!source) return null
  try {
    const parsed = JSON.parse(source)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed)) return { items: parsed }
  } catch (_) { /* 落到下面的兜底解析 */ }
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(source.slice(start, end + 1))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (_) { /* 继续 */ }
  }
  return null
}

/** 数字收敛：非法值回落缺省 */
function asNumber (value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 归一化 research_brief。
 *
 * ⚠ **不补齐计数型指标**：data_points / angles_discovered / sources 不足时**保持原样**，
 * 让机械自检把它们报出来（归一化补齐 ⇒ 计数自检永远绿 ⇒ 假绿）。
 * ⚠ **口径偏离必须显式登记**：桌面端**没有**通用 web search（实测 adapters 全 60 个零 search 类）
 *   ⇒ sources 只能是「**模型知识引用**」⇒ 写进 `metadata.retrieval`（`metadata` 是开放 object，
 *   而顶层 `additionalProperties:false` 不允许在别处加字段）。
 *   ⚠ 绝不能让 LLM 编 URL（schema 能过、语义是假的，比没有更坏）。
 *
 * @param {object} raw LLM 解析出的对象
 * @param {{ topic: string, retrieval?: string, referenceContext?: object|null }} ctx
 * @returns {object} research_brief
 */
function buildResearchBrief (raw, ctx = {}) {
  const schema = loadSchema('research_brief')
  const source = asObject(raw)
  const brief = fillRequired(source, schema, schema)
  brief.version = ARTIFACT_VERSION
  brief.topic = asText(source.topic) || asText(ctx.topic)
  if (!Array.isArray(brief.data_points)) brief.data_points = []
  if (!Array.isArray(brief.angles_discovered)) brief.angles_discovered = []
  if (!Array.isArray(brief.sources)) brief.sources = []
  // 逐条补 sources 的必填字段（url / title）——LLM 常只给其中一个
  brief.sources = brief.sources.map(item => {
    const o = asObject(item)
    const url = asText(o.url)
    return { ...o, url, title: asText(o.title) || url }
  }).filter(item => item.url || item.title)
  brief.data_points = brief.data_points
    .map(item => (typeof item === 'string' ? { claim: item.trim() } : asObject(item)))
    .filter(item => item.claim)
  brief.angles_discovered = brief.angles_discovered
    .map(item => (typeof item === 'string' ? { name: item.trim() } : asObject(item)))
    .filter(item => item.name)
  const metadata = asObject(brief.metadata)
  // ⚠ **原始计数快照**：归一化会按 schema 的 minItems 补齐数组元素
  //   （实测 concept_options 的 minItems=3 ⇒ 1 个概念被补成 3 个 ⇒ 计数自检会**假绿**）
  //   ⇒ 把「LLM 原始给了多少」记进 metadata，计数自检按它判定 ⇒ 补齐救不了。
  metadata.source_counts = {
    data_points: asArray(source.data_points).length,
    angles_discovered: asArray(source.angles_discovered).length,
    sources: asArray(source.sources).length,
  }
  metadata.retrieval = asText(ctx.retrieval) || 'model_knowledge'
  // 参考视频驱动的生产：上游 research-director 的 Step 0 要求把「参考覆盖了什么/漏了什么」
  // 写进 research_brief，且 angles_discovered 要对位参考片。
  const ref = asObject(ctx.referenceContext)
  if (Object.keys(ref).length) metadata.reference_context = ref
  brief.metadata = metadata
  return brief
}

/**
 * 归一化 proposal_packet。
 *
 * ⚠ **approval.status 强制为 `pending`**：审批只能由 P3 的 G1 门（人点批准）写入 ⇒
 *   LLM **无权**自己把 status 写成 approved（否则「未审批就花钱」的闸门形同虚设）。
 * ⚠ `production_plan.render_runtime` 是 **required**（enum: remotion | hyperframes | ffmpeg）⇒
 *   归一化时不能留空（schema 会拒）；缺省取 'remotion'（**并在 metadata 标注这是缺省而非用户选择**）。
 *
 * @param {object} raw LLM 解析出的对象
 * @param {{ researchBrief?: object, budgetUsd?: number|null }} ctx
 * @returns {object} proposal_packet
 */
function buildProposalPacket (raw, ctx = {}) {
  const schema = loadSchema('proposal_packet')
  const source = asObject(raw)
  const packet = fillRequired(source, schema, schema)
  packet.version = ARTIFACT_VERSION
  if (!Array.isArray(packet.concept_options)) packet.concept_options = []
  packet.concept_options = packet.concept_options
    .map((item, index) => {
      const o = asObject(item)
      const id = asText(o.id) || ('concept-' + (index + 1))
      return { ...o, id, title: asText(o.title) || id, hook: asText(o.hook) }
    })
    .filter(item => item.title)
  // selected_concept 是**对象** {concept_id, rationale, modifications}（不是字符串）
  const rawSelected = source.selected_concept
  const selectedObj = typeof rawSelected === 'string'
    ? { concept_id: rawSelected }
    : asObject(rawSelected)
  const selectedId = asText(selectedObj.concept_id) ||
    (packet.concept_options.length ? packet.concept_options[0].id : '')
  packet.selected_concept = {
    ...selectedObj,
    concept_id: selectedId,
    rationale: asText(selectedObj.rationale),
    modifications: Array.isArray(selectedObj.modifications) ? selectedObj.modifications : [],
  }
  const plan = asObject(packet.production_plan)
  const runtimeFromLlm = asText(plan.render_runtime)
  plan.render_runtime = runtimeFromLlm || 'remotion'
  plan.renderer_family = asText(plan.renderer_family) || 'explainer-data'
  packet.production_plan = plan
  // cost_estimate：required 的 total_estimated_usd / line_items[].estimated_usd 是 number
  // ⚠ 本仓**无单价表**（BYOK 场景 cost 恒 NULL）⇒ 金额缺省 0，
  //   但**必须**在 notes 里写明「单价未知」，否则 0 会被读成「不要钱」。
  const cost = asObject(packet.cost_estimate)
  if (!Array.isArray(cost.line_items)) cost.line_items = []
  cost.line_items = cost.line_items.map(item => {
    const o = asObject(item)
    return {
      ...o,
      tool: asText(o.tool),
      operation: asText(o.operation),
      estimated_usd: typeof o.estimated_usd === 'number' ? o.estimated_usd : 0,
    }
  }).filter(item => item.tool)
  cost.total_estimated_usd = typeof cost.total_estimated_usd === 'number'
    ? cost.total_estimated_usd
    : cost.line_items.reduce((sum, item) => sum + (item.estimated_usd || 0), 0)
  cost.budget_verdict = asText(cost.budget_verdict) || 'within_budget'
  if (ctx.budgetUsd !== undefined && ctx.budgetUsd !== null) cost.budget_cap_usd = Number(ctx.budgetUsd)
  packet.cost_estimate = cost
  // approval：强制 pending（审批只能由人给）
  const approval = asObject(packet.approval)
  approval.status = 'pending'
  if (ctx.budgetUsd !== undefined && ctx.budgetUsd !== null) {
    approval.approved_budget_usd = Number(ctx.budgetUsd)
  }
  packet.approval = approval
  const metadata = asObject(packet.metadata)
  // ⚠ render_runtime 的来源判定必须读**原始**输入（归一化后它已被补成 'remotion'）
  metadata.render_runtime_source = asText(asObject(source.production_plan).render_runtime) ? 'llm' : 'default'
  metadata.source_counts = {
    concept_options: asArray(source.concept_options).length,
  }
  packet.metadata = metadata
  return packet
}

/**
 * 归一化 script。
 * @param {object} raw LLM 解析出的对象
 * @param {{ proposalPacket?: object, targetDurationSeconds?: number }} ctx
 * @returns {object} script
 */
function buildScript (raw, ctx = {}) {
  const schema = loadSchema('script')
  const source = asObject(raw)
  const script = fillRequired(source, schema, schema)
  script.version = ARTIFACT_VERSION
  if (!Array.isArray(script.sections)) script.sections = []
  script.sections = script.sections
    .map((item, index) => {
      const o = asObject(item)
      return {
        ...o,
        id: asText(o.id) || ('section-' + (index + 1)),
        text: asText(o.text),
        start_seconds: typeof o.start_seconds === 'number' ? o.start_seconds : index * 5,
        end_seconds: typeof o.end_seconds === 'number' ? o.end_seconds : (index + 1) * 5,
      }
    })
    .filter(section => section.text)
  const voice = asObject(script.voice_performance)
  voice.pacing_profile = asText(voice.pacing_profile) || 'conversational'
  script.voice_performance = voice
  const plan = asObject(ctx.proposalPacket).production_plan
  const target = asNumber(ctx.targetDurationSeconds, 0) || asNumber(asObject(plan).target_duration_seconds, 0)
  // ⚠ `fillRequired` 对 number 的缺省是 `minimum`（=1）⇒ **1 是「补出来的」不是「真值」**
  //   ⇒ 用 <= 1 判定「无有效时长」，否则会把 1 秒当真实时长（实测踩到）。
  const hasRealDuration = Number.isFinite(script.total_duration_seconds) && script.total_duration_seconds > 1
  if (!hasRealDuration && target) script.total_duration_seconds = target
  if (!hasRealDuration && !target) {
    script.total_duration_seconds = script.sections.reduce((sum, s) => Math.max(sum, s.end_seconds), 0)
  }
  return script
}

/**
 * research_brief 的计数型自检（机械可判的部分）。
 * ⚠ **不可机械判的项**（上游 review_focus 里的「数据点具体有出处」「角度真正不同」等）
 *    **不写成自动断言** —— 它们是**人工审批要点**（P3 的 G1 门展示），不是自动判据。
 * @param {object} brief research_brief
 * @returns {Array<{code: string, message: string}>} 空数组 = 达标
 */
function checkResearchBriefCriteria (brief) {
  const issues = []
  // ⚠ 判定用**原始计数**（metadata.source_counts）：归一化会按 schema 的 minItems 补齐
  //   ⇒ 用补齐后的长度判 ⇒ 计数自检永远绿 ⇒ 假绿。
  const sourceCounts = asObject(asObject(brief.metadata).source_counts)
  const countOf = (key, fallback) => {
    const v = Number(sourceCounts[key])
    return Number.isFinite(v) ? v : fallback
  }
  const dataPointCount = countOf('data_points', asArray(brief.data_points).length)
  const angleCount = countOf('angles_discovered', asArray(brief.angles_discovered).length)
  const sourceCount = countOf('sources', asArray(brief.sources).length)
  if (dataPointCount < RESEARCH_MIN_DATA_POINTS) {
    issues.push({
      code: 'INSUFFICIENT_DATA_POINTS',
      message: 'data_points 至少 ' + RESEARCH_MIN_DATA_POINTS + ' 条，实际 ' + dataPointCount + ' 条',
    })
  }
  if (angleCount < RESEARCH_MIN_ANGLES) {
    issues.push({
      code: 'INSUFFICIENT_ANGLES',
      message: 'angles_discovered 至少 ' + RESEARCH_MIN_ANGLES + ' 个，实际 ' + angleCount + ' 个',
    })
  }
  if (sourceCount < RESEARCH_MIN_SOURCES) {
    issues.push({
      code: 'INSUFFICIENT_SOURCES',
      message: 'sources 至少 ' + RESEARCH_MIN_SOURCES + ' 条，实际 ' + sourceCount + ' 条',
    })
  }
  const noUrl = asArray(brief.sources).filter(s => !asText(asObject(s).url))
  if (noUrl.length) {
    issues.push({ code: 'SOURCE_WITHOUT_URL', message: 'sources 里有 ' + noUrl.length + ' 条缺 url' })
  }
  return issues
}

/**
 * proposal_packet 的计数型自检。
 * @param {object} packet proposal_packet
 * @returns {Array<{code: string, message: string}>}
 */
function checkProposalCriteria (packet) {
  const issues = []
  // ⚠ 同上：用**原始计数**判定（归一化会按 minItems 补齐概念 ⇒ 补齐会让计数假绿）
  const sourceCount = Number(asObject(asObject(packet.metadata).source_counts).concept_options)
  const conceptCount = Number.isFinite(sourceCount)
    ? sourceCount
    : asArray(packet.concept_options).length
  if (conceptCount < PROPOSAL_MIN_CONCEPTS) {
    issues.push({
      code: 'INSUFFICIENT_CONCEPT_OPTIONS',
      message: 'concept_options 至少 ' + PROPOSAL_MIN_CONCEPTS + ' 个，实际 ' + conceptCount + ' 个',
    })
  }
  const ids = asArray(packet.concept_options).map(c => asText(asObject(c).id))
  const selectedId = asText(asObject(packet.selected_concept).concept_id)
  if (selectedId && !ids.includes(selectedId)) {
    issues.push({
      code: 'SELECTED_CONCEPT_NOT_FOUND',
      message: 'selected_concept.concept_id 指向的 id 不在 concept_options 内',
    })
  }
  if (asArray(asObject(packet.cost_estimate).line_items).length === 0) {
    issues.push({ code: 'NO_COST_LINE_ITEMS', message: 'cost_estimate 没有任何 line_items（逐项成本缺失）' })
  }
  return issues
}

/**
 * script 的计数型自检（时长 ±10%）。
 * @param {object} script script
 * @param {{ targetDurationSeconds?: number }} ctx
 * @returns {Array<{code: string, message: string}>}
 */
function checkScriptCriteria (script, ctx = {}) {
  const issues = []
  const target = asNumber(ctx.targetDurationSeconds, 0)
  const actual = asNumber(script.total_duration_seconds, 0)
  if (!target) return issues
  if (!actual) {
    issues.push({ code: 'MISSING_DURATION', message: 'script 缺少 total_duration_seconds' })
    return issues
  }
  const deviation = Math.abs(actual - target) / target
  if (deviation > SCRIPT_DURATION_TOLERANCE) {
    issues.push({
      code: 'DURATION_OUT_OF_TOLERANCE',
      message: '总时长 ' + actual + ' 秒与目标 ' + target + ' 秒偏差 ' +
        (deviation * 100).toFixed(1) + '%，超过 ±' + (SCRIPT_DURATION_TOLERANCE * 100) + '%',
    })
  }
  return issues
}

/**
 * 校验一个 artifact 并返回结构化结果。
 * @param {string} schemaName SCHEMA_FILES 的键
 * @param {object} artifact 待校验产物
 * @returns {{ ok: boolean, errors: Array<{path: string, keyword: string, message: string}> }}
 */
function validateArtifact (schemaName, artifact) {
  return validate(artifact, schemaName)
}

module.exports = {
  ARTIFACT_VERSION,
  RESEARCH_MIN_DATA_POINTS,
  RESEARCH_MIN_ANGLES,
  RESEARCH_MIN_SOURCES,
  PROPOSAL_MIN_CONCEPTS,
  SCRIPT_DURATION_TOLERANCE,
  parseJsonArtifact,
  buildResearchBrief,
  buildProposalPacket,
  buildScript,
  checkResearchBriefCriteria,
  checkProposalCriteria,
  checkScriptCriteria,
  validateArtifact,
  // ⚠ 下面 5 个是**生产五阶段模块的复用入口**（explainer-prod-artifacts / -edit-decisions /
  // -prod-review 都从这里取），**不重复实现** —— 重复实现 ⇒ 两份真源必然漂移。
  fillRequired,
  asText,
  asArray,
  asObject,
  asNumber,
}
