// @ts-check
/**
 * explainer-stages - animated-explainer（AI 讲解视频）流水线的自定义阶段执行器
 *
 * 注册与 animated-explainer 流水线配套的 8 个 STAGE_TYPES：
 *   - explainer_research:          主题 → research_brief artifact（P2a）
 *   - explainer_proposal:          → proposal_packet artifact（P2a）
 *   - explainer_script:            → script artifact（P2a）
 *   - explainer_scenes:            → scene_plan artifact（结构化镜头语言，P2b）
 *   - explainer_generate_assets:   → asset_manifest artifact（复用 story2video_generate_assets，P2b）
 *   - explainer_editing:           → edit_decisions artifact（真剪辑决策，P2b）
 *   - explainer_compose:           → render_report + final_review artifact（P2b）
 *   - explainer_publish:           → publish_log artifact（P2b）
 *
 * ## 为什么 compose / publish 用**专属** type
 *
 * 内置 `compose` / `publish`（`stage-executor.js`）是 story2video 等 5 条流水线共用的
 * ⇒ 改它们的输出形态会破坏那 5 条线。
 * ⇒ explainer 用 `explainer_compose` / `explainer_publish` 两个独立 key
 *   （`execute` 是「自定义 executor 优先」，key 不重叠 ⇒ 零侵入）。
 * ⇒ `pipeline-engine.js` 里只**换 type 字符串**（行数不变）⇒ 不撞点名还账的零容差天花板。
 *
 * 注册方式：在 container.setup.js 中调用 registerExplainerStages(pipelineEngine)
 */

'use strict'

const preprodPrompts = require('./explainer/explainer-preprod-stages')
const prodStages = require('./explainer/explainer-prod-stages')
const reviewStages = require('./explainer/explainer-review-stages')

const {
  createResearchExecutor,
  createProposalExecutor,
  createScriptExecutor,
} = preprodPrompts

const EXPLAINER_STAGE_TYPES = {
  RESEARCH: 'explainer_research',
  PROPOSAL: 'explainer_proposal',
  SCRIPT: 'explainer_script',
  SCENES: 'explainer_scenes',
  GENERATE_ASSETS: 'explainer_generate_assets',
  EDITING: 'explainer_editing',
  COMPOSE: 'explainer_compose',
  PUBLISH: 'explainer_publish',
}

/**
 * 注册 animated-explainer 流水线的自定义阶段执行器
 * @param {object} pipelineEngine - PipelineEngine 实例（需已注入 serviceBus）
 * @returns {{success: boolean, error?: string, registered?: string[]}}
 */
function registerExplainerStages (pipelineEngine) {
  if (!pipelineEngine || !pipelineEngine.stageExecutor) {
    return {
      success: false,
      error: 'PipelineEngine.stageExecutor not configured (ServiceBus missing)',
    }
  }

  const registered = []

  const executors = [
    [EXPLAINER_STAGE_TYPES.RESEARCH, createResearchExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.PROPOSAL, createProposalExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.SCRIPT, createScriptExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.SCENES, prodStages.createScenePlanExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.GENERATE_ASSETS, prodStages.createAssetsExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.EDITING, prodStages.createEditingExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.COMPOSE, reviewStages.createComposeExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.PUBLISH, reviewStages.createPublishExecutor(pipelineEngine)],
  ]

  for (const [stageType, executor] of executors) {
    pipelineEngine.registerStageExecutor(stageType, executor)
    registered.push(stageType)
  }

  return { success: true, registered }
}

module.exports = {
  EXPLAINER_STAGE_TYPES,
  // 三个前生产阶段的提示词已抽到 explainer/explainer-preprod-stages.js
  // 五个生产阶段的实现已抽到 explainer/explainer-prod-stages.js + explainer/explainer-review-stages.js
  // （explainer-stages.js 只做**注册**，不堆实现）
  buildResearchPrompt: preprodPrompts.buildResearchPrompt,
  buildProposalPrompt: preprodPrompts.buildProposalPrompt,
  buildScriptPrompt: preprodPrompts.buildScriptPrompt,
  buildScenePlanPrompt: prodStages.buildScenePlanPrompt,
  parseScenesArray: prodStages.parseScenesArray,
  fallbackScenes: prodStages.fallbackScenes,
  linkScenesToSections: prodStages.linkScenesToSections,
  adaptScenesForAssets: prodStages.adaptScenesForAssets,
  registerExplainerStages,
}
