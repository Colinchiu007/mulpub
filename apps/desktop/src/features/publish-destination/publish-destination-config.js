// @ts-check
/**
 * publish-destination-config — 「去发布」弹窗的「流水线 / 配置」选择纯函数契约
 * （publish-config-picker，2026-10-21）。
 *
 * 为什么要单独成模块：
 *  - 弹窗组件只负责「取数 + 渲染 + 派发」，「哪些流水线能选」「某条配置档案算不算合法」
 *    「切流水线后原来的选择还算不算数」都是纯数据决策，抽出来才能不挂组件地穷举分支
 *    （组件测试只验交互，纯函数测试穷举数据校验）。
 *  - 配置档案的合法性判据必须与主进程服务（electron/services/story2video-config-profiles.js）
 *    同口径：非法 id / 非法 pipelineId / 空名称都不得进入下拉，否则用户会选到一条
 *    「点了就报错」的档案。
 *
 * 单一真源：
 *  - 流水线清单 = `@/i18n/pipeline-labels` 的 TEXT_BASED_PIPELINE_IDS（文案型流水线，
 *    与创作页「带文案进入时灰显非文案型流水线」同一判据）。素材型/录屏型/内部冒烟流水线
 *    不在清单内——它们接不了「一段改写文案」，放进下拉只会让用户选到跑不起来的项。
 *  - 配置档案清单 = 主进程 story2video:config-profile-list（设备级 userData 持久化）。
 */

/** 配置档案 id 合法形态（与主进程 isSafeProfileId 同口径）。 */
export const CONFIG_PROFILE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/

/** 配置档案所属流水线 id 合法形态（与主进程 isSafePipelineId 同口径）。 */
export const CONFIG_PROFILE_PIPELINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * 归一化主进程返回的配置档案列表：丢弃非法条目，保留其余（不因一条坏数据让整列表变空）。
 * @param {unknown} raw
 * @returns {Array<{id: string, name: string, pipelineId: string, updatedAt: number}>}
 */
export function normalizeConfigProfiles (raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const pipelineId = typeof item.pipelineId === 'string' ? item.pipelineId.trim() : ''
    if (!CONFIG_PROFILE_ID_PATTERN.test(id)) continue
    if (!name) continue
    if (!CONFIG_PROFILE_PIPELINE_ID_PATTERN.test(pipelineId)) continue
    const updatedAt = Number(item.updatedAt)
    out.push({
      id,
      name,
      pipelineId,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    })
  }
  return out
}

/**
 * 取某条流水线的配置档案（按更新时间倒序，与「我的配置」列表同序）。
 * @param {unknown} profiles
 * @param {unknown} pipelineId
 * @returns {Array<{id: string, name: string, pipelineId: string, updatedAt: number}>}
 */
export function filterConfigProfilesByPipeline (profiles, pipelineId) {
  const id = typeof pipelineId === 'string' ? pipelineId.trim() : ''
  if (!id) return []
  const list = Array.isArray(profiles) ? profiles : []
  return list
    .filter(item => item && item.pipelineId === id)
    .slice()
    .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
}

/**
 * 解析当前「配置」下拉的选项与选中项。
 *
 * 规则（逐条对应 PRD §3.3）：
 *  - 选项 = 所选流水线的配置档案（updatedAt 倒序）。
 *  - 该流水线一条配置都没有 ⇒ 选项为空数组、选中项为空串（触发器显示「默认」，下拉内容为空）。
 *  - 传入的 selectedId 不在选项里（切流水线 / 配置被删）⇒ 选中项回落为空串，
 *    绝不保留一个「指向不存在档案」的选中态。
 *
 * @param {unknown} profiles 已归一化的档案列表
 * @param {unknown} pipelineId
 * @param {unknown} selectedId
 * @returns {{ options: Array<{id: string, name: string}>, selectedId: string, selectedName: string }}
 */
export function resolveConfigSelection (profiles, pipelineId, selectedId) {
  const options = filterConfigProfilesByPipeline(profiles, pipelineId)
    .map(item => ({ id: item.id, name: item.name }))
  const wanted = typeof selectedId === 'string' ? selectedId.trim() : ''
  const matched = wanted ? options.find(item => item.id === wanted) : null
  return {
    options,
    selectedId: matched ? matched.id : '',
    selectedName: matched ? matched.name : '',
  }
}

/**
 * 「去发布 → 视频创作」交接给创作页的 query 键名（弹窗侧与创作页侧的**唯一契约**）。
 * 三个入口（改写页/采集页/热门选题页）各自拼 query 极易漂移（键名对不上 = 配置静默丢失），
 * 故收敛到这一处常量 + 下面的构造函数。
 */
export const CREATE_HANDOFF_QUERY_KEYS = Object.freeze({
  draft: 'draft',
  pipeline: 'pipeline',
  configProfile: 'configProfile',
})

/**
 * 构造「跳转到创作页」的 query。
 *
 * 规则：
 *  - 草稿 id 为空 ⇒ 不带 draft 键（调用方据此放弃跳转，而不是带一个空串过去）。
 *  - 流水线 id 为空 ⇒ 不带 pipeline 键（创作页会走默认选择流程）。
 *  - 配置档案 id 为空或非法 ⇒ **不带** configProfile 键（= 不套用任何配置，用流水线默认参数）。
 *    传空串过去会被创作页当成「指定了一个叫空串的配置」而报错。
 *
 * @param {{ draftId?: unknown, pipelineId?: unknown, configProfileId?: unknown }} input
 * @returns {Record<string, string>}
 */
export function buildCreateHandoffQuery (input) {
  const source = input && typeof input === 'object' ? input : {}
  const query = {}
  const draftId = typeof source.draftId === 'string' ? source.draftId.trim() : ''
  if (draftId) query[CREATE_HANDOFF_QUERY_KEYS.draft] = draftId
  const pipelineId = typeof source.pipelineId === 'string' ? source.pipelineId.trim() : ''
  if (pipelineId) query[CREATE_HANDOFF_QUERY_KEYS.pipeline] = pipelineId
  const configProfileId = typeof source.configProfileId === 'string' ? source.configProfileId.trim() : ''
  if (configProfileId && CONFIG_PROFILE_ID_PATTERN.test(configProfileId)) {
    query[CREATE_HANDOFF_QUERY_KEYS.configProfile] = configProfileId
  }
  return query
}

/**
 * 构造「去发布 → 生成视频」的最终选择载荷。
 *
 * 契约：`publish-video` 事件第一个参数仍是流水线 id（保持既有调用方兼容），
 * 第二个参数是新增的配置选择详情。配置为空（默认）时 configProfileId 为空串，
 * 调用方据此**不**传 configProfile 查询参数（而不是传一个空串过去）。
 *
 * @param {{ pipelineId?: unknown, configProfileId?: unknown, configProfileName?: unknown }} input
 * @returns {{ pipelineId: string, configProfileId: string, configProfileName: string }}
 */
export function buildPublishVideoSelection (input) {
  const source = input && typeof input === 'object' ? input : {}
  const pipelineId = typeof source.pipelineId === 'string' ? source.pipelineId.trim() : ''
  const configProfileId = typeof source.configProfileId === 'string' ? source.configProfileId.trim() : ''
  const configProfileName = typeof source.configProfileName === 'string' ? source.configProfileName.trim() : ''
  return {
    pipelineId,
    configProfileId: CONFIG_PROFILE_ID_PATTERN.test(configProfileId) ? configProfileId : '',
    configProfileName,
  }
}
