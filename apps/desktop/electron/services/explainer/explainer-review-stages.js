// @ts-check
/**
 * explainer-review-stages — compose / publish 两个阶段的执行器（产出上游 review 类 artifact）
 *
 * ## 为什么单独一个模块
 *
 * `explainer-prod-stages.js` 已承载 scenes / assets / editing（贴 limit 500），
 * compose / publish 含 IO 探测（ffprobe / 抽帧 / 响度）⇒ 拆开（**抽模块，不抬基线**）。
 *
 * ## 为什么 compose / publish 用专属 type
 *
 * 内置 `compose` / `publish`（`stage-executor.js` 的 `STAGE_TYPES.COMPOSE` / `PUBLISH`）
 * 是 story2video 等 5 条流水线共用的 ⇒ 改它们的输出形态会破坏那 5 条线。
 * ⇒ explainer 用 `explainer_compose` / `explainer_publish` 两个独立 key
 *   （`execute` 是「自定义 executor 优先」，key 不重叠 ⇒ 零侵入）。
 *
 * ## 内层调用必须把 stage.options 原样带过去
 *
 * 内置 compose 读 `stage.options` 的 18 个白名单 key（transition / imageEffect / resolution /
 * fps / format / bgmPath / voiceVolume / defaultSceneDuration …）⇒ 丢了就静默用默认值。
 * ⚠ 且**行数不变**的改法（`pipeline-engine.js` 里只换 type 字符串）才不会撞点名还账的零容差天花板。
 *
 * ## 成败判据是**产物有效性**，不是进程退出码
 *
 * 仓内既有事实：Remotion 渲染实测「CLI 抛 TimeoutError 但 mp4 完全有效」。
 * ⇒ 这里以 ffprobe 可读 + 抽帧有效 + 音轨非静音为准。
 */

'use strict'

const {
  validateArtifact,
  asText,
  asObject,
  asNumber,
} = require('./explainer-artifacts')
const {
  buildRenderReport,
  buildFinalReview,
  buildPublishLog,
  checkPublishLogCriteria,
} = require('./explainer-prod-review')
const {
  probeContainer,
  sampleFrames,
  measureLoudness,
} = require('./explainer-media-probe')

/**
 * compose 阶段：先跑内置合成，再探测产物，最后装配 render_report + final_review。
 *
 * @param {object} pipelineEngine
 */
function createComposeExecutor (pipelineEngine) {
  return async ({ runId, stage, params, context, onProgress }) => {
    const options = stage.options || {}
    // ⚠ 内层调用的 stage 必须**原样带 options**（内置 compose 读它的白名单 key）
    const inner = await pipelineEngine.stageExecutor.execute({
      runId,
      stage: { name: 'compose', type: 'compose', options },
      params,
      context,
      onProgress,
    })
    if (!inner.success) return inner

    const output = asObject(inner.output)
    const videoPath = asText(output.videoPath) || asText(context.videoPath)

    // 产物有效性探测（IO；失败不阻断，但要记进 final_review）
    const probe = await probeContainer(videoPath)
    const frames = await sampleFrames(videoPath, {
      count: 4,
      durationSeconds: asNumber(probe.duration_seconds, 0),
    })
    const loudness = await measureLoudness(videoPath)

    const editDecisions = asObject(context.editing)
    const proposal = asObject(context.proposal)
    const renderReport = buildRenderReport(output, {
      probe,
      editDecisions,
      renderTimeSeconds: asNumber(context.compose_started_at)
        ? (Date.now() - asNumber(context.compose_started_at)) / 1000
        : 0,
      videoPath,
    })
    const renderValidation = validateArtifact('render_report', renderReport)
    if (!renderValidation.ok) {
      return {
        success: false,
        error: 'render_report 不符合上游 schema：' +
          renderValidation.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
      }
    }

    const finalReview = buildFinalReview({}, {
      probe,
      frames,
      loudness,
      renderReport,
      editDecisions,
      videoPath,
      lockedRuntime: asText(asObject(proposal.production_plan).render_runtime),
      // ⚠ 实际 runtime：本仓 compose 仍是 ffmpeg（P5 才接 Remotion）⇒ 如实上报
      actualRuntime: 'ffmpeg',
      approvalStatus: asText(asObject(proposal.approval).status),
    })
    const reviewValidation = validateArtifact('final_review', finalReview)
    if (!reviewValidation.ok) {
      return {
        success: false,
        error: 'final_review 不符合上游 schema：' +
          reviewValidation.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
      }
    }

    return {
      success: true,
      output: { render_report: renderReport, final_review: finalReview },
      // ⚠ final_review.status = 'fail' 时**不把成片当完成品**（上游 schema 明写）
      //   但**不阻断流水线** —— 成片在盘上，阻断只会让用户拿不到。
      issues: asArray(asObject(finalReview.metadata).issues),
      reviewStatus: asText(finalReview.status),
    }
  }
}

/**
 * publish 阶段：跑内置发布，再登记成上游 publish_log。
 */
function createPublishExecutor (pipelineEngine) {
  return async ({ stage, params, context, onProgress }) => {
    const inner = await pipelineEngine.stageExecutor.execute({
      stage: { name: 'publish', type: 'publish', options: stage.options || {}, platforms: stage.platforms },
      params,
      context,
      onProgress,
    })
    if (!inner.success) return inner

    const log = buildPublishLog(inner.output, {
      videoPath: asText(asObject(inner.output).videoPath) || asText(context.videoPath),
      platforms: asArray(stage.platforms || (stage.options || {}).platforms),
    })
    const validation = validateArtifact('publish_log', log)
    if (!validation.ok) {
      return {
        success: false,
        error: 'publish_log 不符合上游 schema：' +
          validation.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
      }
    }
    const issues = checkPublishLogCriteria(log)
    return { success: true, output: log, issues }
  }
}

module.exports = {
  createComposeExecutor,
  createPublishExecutor,
}
