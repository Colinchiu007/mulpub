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
  asArray,
  asObject,
  asNumber,
} = require('./explainer-artifacts')
const { resolveSceneSource } = require('./explainer-prod-stages')
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
 * asset_manifest → 内置 compose 消费的**旧形态** `{scenes:[...]}`（消费点适配）。
 *
 * ⚠ **为什么必须适配**：内置 compose（`story2video-compose-engine.js`）读的是
 *   `scene.imagePath` / `scene.audioPath` / `scene.duration`（:979/:984/:1104），
 *   而本片把 assets 阶段的产物换成了上游 `asset_manifest`（`{version, assets:[...]}`）
 *   ⇒ 直接喂过去 ⇒ 内置 compose 报「Invalid assetManifest: missing scenes or image/audio pairs」。
 *
 * ⚠ **适配放在消费点，不改产物**：`context.assets` 仍是**纯 artifact**（不含 `scenes` 字段
 *   —— asset_manifest 的 schema 是 `additionalProperties:false`，多一个字段就 schema 判红）。
 *
 * ⚠ `duration` 取**旁白资产的真实时长**（duration_seconds）⇒ 内置 compose 因此按
 *   **实际 narration 时长**对齐画面（上游 Audio drift 要求），而不是按计划时长。
 *
 * @param {object} manifest asset_manifest artifact
 * @param {object} scenePlan scene_plan artifact
 * @param {object} script script artifact（取旁白文本）
 * @returns {Array<object>} 旧形态场景数组
 */
function assetManifestToLegacyScenes (manifest, scenePlan, script) {
  const assets = asArray(asObject(manifest).assets)
  const scenes = asArray(asObject(scenePlan).scenes)
  const sections = asArray(asObject(script).sections)

  const byScene = new Map()
  for (const asset of assets) {
    const obj = asObject(asset)
    const sceneId = asText(obj.scene_id)
    if (!sceneId) continue
    if (!byScene.has(sceneId)) byScene.set(sceneId, {})
    const bucket = byScene.get(sceneId)
    const type = asText(obj.type)
    if (type === 'image') bucket.imagePath = asText(obj.path)
    else if (type === 'narration' || type === 'audio') {
      bucket.audioPath = asText(obj.path)
      bucket.duration = asNumber(obj.duration_seconds, 0)
    }
  }

  return scenes.map((scene) => {
    const obj = asObject(scene)
    const sceneId = asText(obj.id)
    const bucket = byScene.get(sceneId) || {}
    const sectionId = asText(obj.script_section_id)
    const section = sections.find(s => asText(asObject(s).id) === sectionId)
    return {
      scene_id: sceneId,
      text: section ? asText(asObject(section).text) : '',
      imagePath: bucket.imagePath || null,
      audioPath: bucket.audioPath || null,
      duration: bucket.duration || 0,
    }
  })
}

/**
 * 合成产物 + 两个 artifact 的合并（抽成纯函数以便单测）。
 *
 * ⚠ **必须保留 compose 原始输出**（videoPath / fileSize / segmentCount / duration）：
 *   下一个阶段是内置 publish 阶段，它从 `context.compose` 读 videoPath 去找成片
 *   ⇒ 只输出两个 artifact 会让 publish 拿不到片（**静默失败**：不发布也不报错）。
 */
function composeOutputWithArtifacts (rawOutput, renderReport, finalReview) {
  return { ...asObject(rawOutput), render_report: renderReport, final_review: finalReview }
}

/**
 * compose 阶段：先跑内置合成，再探测产物，最后装配 render_report + final_review。
 *
 * @param {object} pipelineEngine
 */
function createComposeExecutor (pipelineEngine) {
  return async ({ runId, stage, params, context, onProgress }) => {
    const options = stage.options || {}
    // ⚠ **消费点适配**：内置 compose 读旧形态 `context.assets.scenes[]`，
    //   而本片的 assets 产物是上游 asset_manifest ⇒ 先转回旧形态再喂给它
    //   （`context.assets` 本身仍是纯 artifact，不加 scenes 字段）。
    const sceneSource = resolveSceneSource(context)
    const legacyScenes = assetManifestToLegacyScenes(
      asObject(context.assets), sceneSource.plan, asObject(context.script),
    )
    const legacyContext = legacyScenes.length
      ? { ...context, assets: { scenes: legacyScenes } }
      : context
    // ⚠ 内层调用的 stage 必须**原样带 options**（内置 compose 读它的白名单 key）
    // ⚠ **且必须带 inputFrom**：`_resolveInput`（stage-executor.js:977）按 `context[stage.inputFrom]`
    //   取输入；漏了它就会走 fallback（读 params.assets / params.text）⇒ 拿到 null
    //   ⇒ 内置 compose 报「Invalid assetManifest: missing scenes or image/audio pairs」。
    const inner = await pipelineEngine.stageExecutor.execute({
      runId,
      stage: { name: 'compose', type: 'compose', options, inputFrom: 'assets' },
      params,
      context: legacyContext,
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
      output: composeOutputWithArtifacts(output, renderReport, finalReview),
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
      // ⚠ 同样必须带 inputFrom: 'compose'（内置 publish 从 context.compose 读 videoPath）
      stage: { name: 'publish', type: 'publish', options: stage.options || {}, platforms: stage.platforms, inputFrom: 'compose' },
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
  assetManifestToLegacyScenes,
  composeOutputWithArtifacts,
  createComposeExecutor,
  createPublishExecutor,
}
