// @ts-check
/**
 * 热门选题「生成视频」流水线目录 —— 纯函数契约（hot-topics-pipeline-picker，2026-10-17）。
 *
 * 为什么单独成模块：
 *  - 下拉里的「哪些流水线能从选题文本启动 / 哪些必须禁用 / 禁用原因 / 排序 / 阶段名 / 启动参数」
 *    是纯数据决策，与 Vue 无关；抽出来才能不挂组件地穷举分类与参数分支（组件测试只验交互）。
 *  - 流水线清单的唯一真源仍是主进程 pipelineList；本模块**不新增枚举真源**，只对返回的
 *    名字做前端可执行性分类（fail-closed：不认识的一律禁用）。
 */
import {
  PIPELINE_REGISTRY,
  getPipelineName,
  getPipelineCategory,
  getPipelineDescription,
} from '@/i18n/pipeline-labels'
import {
  buildStory2VideoTextConfigFromSnapshot,
  resolveS2VConfigsFromSnapshot,
  getStory2VideoOutputAspectRatio,
} from '@/story2video/s2v-config-snapshot'

/** 默认流水线：主【生成视频】按钮与回退项使用（与既有行为一致，不得随意改）。 */
export const DEFAULT_GEN_VIDEO_PIPELINE = 'story2video-compose'
export const STORY2VIDEO_PIPELINE = 'story2video-compose'

/**
 * 文本驱动、且能从「一段改写文案」直接启动的自动流水线。
 * 依据：CreateView.isAutoPipeline + 各 stage 执行器读取 params.text 作为主题
 * （explainer/documentary/videogen 三族）。framework-smoke 虽也能被 startExplainerPipeline
 * 启动，但它是内部冒烟测试（生成 testsrc 视频），不属"视频创作"，故不放进可执行集合。
 */
const TEXT_AUTO_PIPELINES = Object.freeze([
  'animated-explainer',
  'documentary-montage',
  'animation',
  'avatar-spokesperson',
  'character-animation',
  'hybrid',
])

/** 需要先导入视频/音频素材的流水线（从选题只有文本，启动必然失败）。 */
const NEEDS_MEDIA_PIPELINES = Object.freeze([
  'talking-head',
  'cinematic',
  'clip-factory',
  'localization-dub',
  'podcast-repurpose',
])

/** 有独立页面、不走通用生成流程的流水线。 */
const DEDICATED_PAGE_PIPELINES = Object.freeze(['film-engineering'])

/** 内部调试/冒烟流水线，不对用户暴露为创作选项。 */
const INTERNAL_PIPELINES = Object.freeze(['framework-smoke'])

const KNOWN_ENABLED = new Set([STORY2VIDEO_PIPELINE, ...TEXT_AUTO_PIPELINES])

/** i18n key：禁用原因（zh/en 成对，见 locales/hot-topics/*.js）。 */
export const PIPELINE_DISABLED_REASON_KEYS = Object.freeze({
  'needs-media': 'hotTopics.genVideoPipelineNeedsMedia',
  dedicated: 'hotTopics.genVideoPipelineDedicated',
  internal: 'hotTopics.genVideoPipelineInternal',
  unavailable: 'hotTopics.genVideoPipelineUnavailable',
  unsupported: 'hotTopics.genVideoPipelineUnsupported',
})

/**
 * 流水线运行模式（决定启动参数分支与禁用原因）。
 * @param {unknown} name
 * @returns {'story2video'|'text-auto'|'needs-media'|'dedicated'|'internal'|'unavailable'|'unsupported'}
 */
export function getPipelineRunMode(name) {
  const id = typeof name === 'string' ? name.trim() : ''
  if (!id) return 'unsupported'
  if (id === STORY2VIDEO_PIPELINE) return 'story2video'
  if (TEXT_AUTO_PIPELINES.includes(id)) return 'text-auto'
  if (NEEDS_MEDIA_PIPELINES.includes(id)) return 'needs-media'
  if (DEDICATED_PAGE_PIPELINES.includes(id)) return 'dedicated'
  if (INTERNAL_PIPELINES.includes(id)) return 'internal'
  return 'unsupported'
}

/**
 * 该流水线能否从「热门选题的改写文本」直接启动生成流程。
 * 规则：只有 story2video 与文本驱动自动流水线可执行；available === false 一律不可执行
 * （主进程尚未实现执行引擎）。未知名字 fail-closed。
 * @param {unknown} name
 * @param {unknown} [available]
 */
export function isPipelineRunnableFromTopic(name, available = undefined) {
  const mode = getPipelineRunMode(name)
  if (mode !== 'story2video' && mode !== 'text-auto') return false
  if (available === false) return false
  return KNOWN_ENABLED.has(String(name || '').trim())
}

/**
 * 禁用原因的 i18n key；可执行项返回 null。
 * @param {unknown} name
 * @param {unknown} [available]
 * @returns {string|null}
 */
export function getPipelineDisabledReasonKey(name, available = undefined) {
  if (isPipelineRunnableFromTopic(name, available)) return null
  if (available === false) return PIPELINE_DISABLED_REASON_KEYS.unavailable
  const mode = getPipelineRunMode(name)
  if (mode === 'needs-media') return PIPELINE_DISABLED_REASON_KEYS['needs-media']
  if (mode === 'dedicated') return PIPELINE_DISABLED_REASON_KEYS.dedicated
  if (mode === 'internal') return PIPELINE_DISABLED_REASON_KEYS.internal
  return PIPELINE_DISABLED_REASON_KEYS.unsupported
}

/**
 * 所选流水线的真实阶段名（来自 pipeline-labels 的单一 Registry；未知返回 []）。
 * 弹窗阶段 = ['rewrite_copy', ...本函数返回值]。
 * @param {unknown} name
 * @returns {string[]}
 */
export function getPipelineStageNames(name) {
  const id = typeof name === 'string' ? name.trim() : ''
  const stages = id ? PIPELINE_REGISTRY[id]?.stages : null
  return Array.isArray(stages) ? stages.slice() : []
}

/**
 * 归一化主进程 pipelineList 返回值：丢弃非法/重复条目，保持原顺序。
 * @param {unknown} rawList
 * @returns {Array<{name: string, available: boolean|undefined}>}
 */
export function normalizePipelineList(rawList) {
  const seen = new Set()
  const out = []
  for (const item of Array.isArray(rawList) ? rawList : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({
      name,
      available: typeof item.available === 'boolean' ? item.available : undefined,
    })
  }
  return out
}

/**
 * 构造下拉选项：可执行项在前、不可执行项在后，各自保持主进程返回顺序。
 * @param {unknown} rawList
 * @param {(key: string) => string} t
 * @returns {Array<{name:string,label:string,categoryLabel:string,description:string,enabled:boolean,reasonKey:string|null,reasonText:string,isDefault:boolean}>}
 */
export function buildGenVideoPipelineOptions(rawList, t) {
  const translate = typeof t === 'function' ? t : (key) => key
  const normalized = normalizePipelineList(rawList)
  const mapped = normalized.map((item) => {
    const enabled = isPipelineRunnableFromTopic(item.name, item.available)
    const reasonKey = enabled ? null : getPipelineDisabledReasonKey(item.name, item.available)
    return {
      name: item.name,
      label: getPipelineName(translate, item.name),
      categoryLabel: getPipelineCategory(translate, PIPELINE_REGISTRY[item.name]?.category || 'custom'),
      description: getPipelineDescription(translate, item.name),
      enabled,
      reasonKey,
      reasonText: reasonKey ? String(translate(reasonKey)) : '',
      isDefault: item.name === DEFAULT_GEN_VIDEO_PIPELINE,
    }
  })
  return [
    ...mapped.filter((item) => item.enabled),
    ...mapped.filter((item) => !item.enabled),
  ]
}

/**
 * 按所选流水线构造 `pipelineStartOrchestrated` 的启动参数（纯函数，便于单测穷举）。
 *
 * - story2video-compose：完整 story2videoTextConfig（与 CreateView.startOrchestratedPipeline 同源）。
 * - 文本驱动自动流水线：与 CreateView.startExplainerPipeline 同口径（text + 输出参数）。
 * - 其它流水线：返回 null（调用方必须拒绝启动；UI 已禁用，这里是第二道防线）。
 *
 * @param {{pipelineName: unknown, text: unknown, snapshot?: unknown, uiLocale?: unknown}} input
 * @returns {object|null}
 */
export function buildGenVideoStartParams({ pipelineName, text, snapshot = null, uiLocale = '' } = {}) {
  const name = typeof pipelineName === 'string' ? pipelineName.trim() : ''
  const content = typeof text === 'string' ? text : ''
  if (!name || !content.trim()) return null
  const mode = getPipelineRunMode(name)
  if (mode === 'story2video') {
    return {
      text: content,
      inputMode: 'text',
      checkpointPolicy: 'none',
      autoAdvance: true,
      background: true,
      uiLocale: typeof uiLocale === 'string' ? uiLocale : '',
      story2videoTextConfig: buildStory2VideoTextConfigFromSnapshot(content, snapshot),
    }
  }
  if (mode !== 'text-auto') return null
  const { s2vOutputConfig } = resolveS2VConfigsFromSnapshot(snapshot)
  const resolution = s2vOutputConfig.resolution
  return {
    text: content,
    inputMode: 'text',
    checkpointPolicy: 'none',
    autoAdvance: true,
    background: true,
    uiLocale: typeof uiLocale === 'string' ? uiLocale : '',
    // 与 CreateView data() 默认值一致：非 S2V 自动流水线没有独立配置面板，沿用创作页默认。
    storyboardMode: 'auto',
    style: 'clean-professional',
    resolution,
    aspectRatio: getStory2VideoOutputAspectRatio(resolution),
    fps: s2vOutputConfig.fps,
    format: s2vOutputConfig.format,
  }
}

/** 测试与 UI 展示用：可执行流水线集合（只读）。 */
export function listRunnablePipelineNames() {
  return [STORY2VIDEO_PIPELINE, ...TEXT_AUTO_PIPELINES]
}
