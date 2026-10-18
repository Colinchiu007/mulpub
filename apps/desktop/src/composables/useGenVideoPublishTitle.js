// @ts-check
/**
 * useGenVideoPublishTitle — 热门选题【去发布】的标题生成与 query 组装
 * （fix-hot-topics-genvideo-title，2026-10-17）。
 *
 * 为什么独立成模块：`useHotTopicsGenVideo.js` 加入标题生成后到 544 行，
 * 越过 `check-max-lines` 的 500 行新代码红线（债务熔断检查 NEW_OVER_LIMIT）。
 * 该门禁给的处方是「按既有 mixin/composable 范式拆分」——本文件就是那次拆分。
 *
 * 职责边界（只有两件事）：
 *   ① 按三级降级链产出标题（AI 爆款标题 → 原始选题 → 不注入）；
 *   ② 把标题与来源标注组装进 /publish 的 query。
 * 不持有编排状态，不改流水线流程；输入全部由调用方传入，可脱离 Vue 单测。
 */
import { modelProviderGetDefault, aiGenerateGenVideoTitle } from '@/api/publisher'
import { resolveGenVideoTitle, GEN_VIDEO_TITLE_MAX } from '@/features/publish/gen-video-title'
import { buildPublishFromProject, publishDataToQuery } from '@/features/publish/publish-from-project'

/**
 * 查询默认文字推理模型是否可用。
 * 抛错一律按不可用处理 —— 查不到模型是**合法状态**，该走降级而不是报错。
 * @returns {Promise<boolean>}
 */
export async function isTextModelAvailable () {
  try {
    const def = await modelProviderGetDefault('llm')
    return def?.code === 0 && Boolean(def?.data?.id)
  } catch (_) {
    return false
  }
}

/**
 * 按需生成 AI 爆款标题；无模型/失败/空一律返回空串（调用方据此降级）。
 * @param {{topicText: string, bodyText: string}} input
 * @returns {Promise<string>}
 */
export async function generateGenVideoTitle (input) {
  try {
    const res = await aiGenerateGenVideoTitle({ ...input, max: GEN_VIDEO_TITLE_MAX })
    if (res?.code === 0 && res?.data?.success) return String(res.data.title || '')
  } catch (_) { /* 失败由降级链兜住 */ }
  return ''
}

/**
 * 组装 /publish 的 query（有项目沿用 publishDataToQuery；run-only 只带 video_path），
 * 再用降级链结果覆盖 title 并写 title_source / title_reason。
 *
 * @param {{videoPath: string, project: object|null, topicText: string, bodyText: string}} input
 * @returns {Promise<object>} 可直接作为 router.push query 的对象
 */
export async function buildGenVideoPublishQuery ({ videoPath, project, topicText, bodyText }) {
  const aiAvailable = await isTextModelAvailable()
  const aiTitle = aiAvailable ? await generateGenVideoTitle({ topicText, bodyText }) : ''

  // 降级链决策（纯函数，单一真源）
  const { title, source } = resolveGenVideoTitle({ topicText, aiTitle, aiAvailable, max: GEN_VIDEO_TITLE_MAX })

  let query
  if (project && typeof project === 'object') {
    // 有项目：content/tags 语义不变（与视频创作页/结果页同源）
    query = publishDataToQuery(buildPublishFromProject({ ...project, videoPath }))
  } else {
    // run-only：只交接成片路径，不得注入 content/tags
    query = { type: 'video', video_path: encodeURIComponent(videoPath) }
  }

  // 标题覆盖 + 来源标注（发布页据此显示三态来源提示）
  if (title) {
    query.title = encodeURIComponent(title)
    query.title_source = source
    if (source === 'topic') query.title_reason = aiAvailable ? 'failed' : 'no-model'
  } else {
    delete query.title
  }
  return query
}

export { GEN_VIDEO_TITLE_MAX }
