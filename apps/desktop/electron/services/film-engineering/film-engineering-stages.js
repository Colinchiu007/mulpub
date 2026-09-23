// @ts-check
'use strict'
/**
 * film-engineering-stages - film-engineering（影视工程）流水线的自定义阶段执行器
 *
 * 阶段链（与 PIPELINES 注册的 film-engineering 流水线配套）：
 *   - film_load_template:   加载 film-kit 模板（fail-closed）
 *   - film_adapt_script:    剧本套用（分场 → Hell Grind 模板映射 → adaptedShots）
 *   - film_select_shots:    分镜选择过滤（kit shotId 或 adapt-*）
 *   - film_export_prompts:  导出选中分镜提示词（JSON/Markdown）
 *
 * 注册方式：container.setup.js 中调用 registerFilmEngineeringStages(pipelineEngine)
 */

const { loadFilmKit } = require('./kit-loader')
const { ShotLibrary } = require('./shot-library')
const { ScriptAdapter } = require('./script-adapt')

const FILM_STAGE_TYPES = {
  LOAD_TEMPLATE: 'film_load_template',
  ADAPT_SCRIPT: 'film_adapt_script',
  SELECT_SHOTS: 'film_select_shots',
  EXPORT_PROMPTS: 'film_export_prompts',
}

/**
 * 注册 film-engineering 流水线的自定义阶段执行器
 * @param {object} pipelineEngine - PipelineEngine 实例
 * @returns {{success: boolean, error?: string, registered?: string[]}}
 */
function registerFilmEngineeringStages (pipelineEngine) {
  if (!pipelineEngine || !pipelineEngine.stageExecutor) {
    return { success: false, error: 'PipelineEngine.stageExecutor not configured (ServiceBus missing)' }
  }

  const registered = []
  const log = pipelineEngine.log && typeof pipelineEngine.log.warn === 'function'
    ? pipelineEngine.log
    : { info () {}, warn () {}, error () {} }

  // context 解析兼容：引擎按 stage 名嵌套写入（run.context[stageName]=output）与单测/initialContext 直供的扁平键。
  const ctxFlatOrNested = (context, flatKey, producerStage) => {
    if (context && context[flatKey] !== undefined && context[flatKey] !== null) return context[flatKey]
    if (context && producerStage && context[producerStage] && context[producerStage][flatKey] !== undefined) return context[producerStage][flatKey]
    return undefined
  }

  pipelineEngine.registerStageExecutor(
    FILM_STAGE_TYPES.LOAD_TEMPLATE,
    async ({ params, context }) => {
      const existing = ctxFlatOrNested(context, 'template', 'load_template')
      if (existing && existing.manifest && existing.shots) {
        return { success: true, output: { template: existing } }
      }
      const kitDir = params && params.kitDir
      if (typeof kitDir !== 'string' || !kitDir) {
        // 出片流（勾选分镜直接生成）：无需模板，selectedShots 已由 initialContext 提供 → 直通。
        const selected = ctxFlatOrNested(context, 'selectedShots', 'select_shots')
        if (Array.isArray(selected) && selected.length > 0) {
          return { success: true, output: { template: null, passthrough: true } }
        }
        // 收口合成流（9.3 冒烟回归）：仅携带 renderManifest 的 compose run 无需模板 → 直通。
        const mf = ctxFlatOrNested(context, 'renderManifest', null)
        if (Array.isArray(mf) && mf.length > 0) {
          return { success: true, output: { template: null, passthrough: true, manifestMode: true } }
        }
        return { success: false, error: 'film_load_template 需要 params.kitDir' }
      }
      const loaded = loadFilmKit({ kitDir })
      if (!loaded.ok) {
        return { success: false, error: 'FILM_KIT_UNAVAILABLE: ' + loaded.error }
      }
      return {
        success: true,
        output: {
          template: {
            manifest: loaded.kit.manifest,
            shots: loaded.kit.shots,
            references: loaded.kit.references,
            doctrine: loaded.kit.doctrine,
          },
        },
      }
    },
  )
  registered.push(FILM_STAGE_TYPES.LOAD_TEMPLATE)

  pipelineEngine.registerStageExecutor(
    FILM_STAGE_TYPES.ADAPT_SCRIPT,
    async ({ params, context }) => {
      const script = params && params.script
      // 出片流：未提供 params.script（undefined）表示不做剧本套用 → 直通（保留既有 adaptedShots）。
      // 注意：script='' 属作者流空剧本，仍走下方适配器 fail-closed（匹配 /剧本/）。
      if (typeof script !== 'string') {
        const passthroughAdapted = ctxFlatOrNested(context, 'adaptedShots', 'adapt_script')
        return {
          success: true,
          output: {
            adaptedShots: Array.isArray(passthroughAdapted) ? passthroughAdapted : [],
            llmEnhanced: false,
            warnings: [],
            passthrough: true,
          },
        }
      }
      const template = ctxFlatOrNested(context, 'template', 'load_template')
      if (!template || !template.shots || template.shots.length === 0) {
        return { success: false, error: 'film_adapt_script 需要 context.template（先执行 film_load_template）' }
      }
      const characterMap = params && params.characterMap
      const llmEnabled = !!(params && params.llmEnabled)
      const adapter = new ScriptAdapter({
        kit: {
          manifest: template.manifest,
          shots: template.shots,
          references: template.references || {},
          doctrine: template.doctrine || { blocks: [], rules: [], glossary: [] },
        },
        llm: null,
        log,
      })
      const result = await adapter.adaptScript({
        script,
        characterMap,
        templateShots: template.shots,
        llmEnabled: false,
      })
      if (!result.ok) {
        return { success: false, error: 'film_adapt_script 失败: ' + result.error }
      }
      return {
        success: true,
        output: {
          adaptedShots: result.adaptedShots,
          llmEnhanced: llmEnabled ? result.llmEnhanced : false,
          warnings: result.warnings || [],
        },
      }
    },
  )
  registered.push(FILM_STAGE_TYPES.ADAPT_SCRIPT)

  pipelineEngine.registerStageExecutor(
    FILM_STAGE_TYPES.SELECT_SHOTS,
    async ({ params, context }) => {
      const template = ctxFlatOrNested(context, 'template', 'load_template')
      const nestedAdapted = ctxFlatOrNested(context, 'adaptedShots', 'adapt_script')
      const adaptedShots = Array.isArray(nestedAdapted) ? nestedAdapted : []
      const ids = params && params.selectedShotIds
      if (!Array.isArray(ids) || ids.length === 0) {
        // 出片流：无 selectedShotIds → 直通已选分镜（initialContext 直供或前序 select_shots 输出）。
        const existingSelected = ctxFlatOrNested(context, 'selectedShots', 'select_shots')
        if (Array.isArray(existingSelected) && existingSelected.length > 0) {
          return { success: true, output: { selectedShots: existingSelected, passthrough: true } }
        }
        // 收口合成流（9.3 冒烟回归）：manifest-only compose run 无分镜可选 → 空选择直通。
        const mfSel = ctxFlatOrNested(context, 'renderManifest', null)
        if (Array.isArray(mfSel) && mfSel.length > 0) {
          return { success: true, output: { selectedShots: [], passthrough: true, manifestMode: true } }
        }
        return { success: false, error: 'film_select_shots 需要非空 params.selectedShotIds' }
      }
      if (!template || !template.shots) {
        return { success: false, error: 'film_select_shots 需要 context.template' }
      }
      if (ids.length > 50) {
        return { success: false, error: 'film_select_shots 一次最多选择 50 个分镜' }
      }
      const byId = new Map()
      for (const s of template.shots) byId.set(s.shotId, s)
      for (const a of adaptedShots) byId.set(a.shotId, a)
      const selected = []
      for (const id of ids) {
        if (typeof id !== 'string' || !id.trim()) {
          return { success: false, error: 'film_select_shots 含非法分镜 id' }
        }
        const shot = byId.get(id)
        if (!shot) return { success: false, error: 'film_select_shots 分镜不存在: ' + id }
        selected.push(shot)
      }
      return { success: true, output: { selectedShots: selected } }
    },
  )
  registered.push(FILM_STAGE_TYPES.SELECT_SHOTS)

  pipelineEngine.registerStageExecutor(
    FILM_STAGE_TYPES.EXPORT_PROMPTS,
    async ({ params, context }) => {
      const nestedSelected = ctxFlatOrNested(context, 'selectedShots', 'select_shots')
      const selectedShots = Array.isArray(nestedSelected) ? nestedSelected : []
      if (selectedShots.length === 0) {
        // 收口合成流（9.3 冒烟回归）：manifest-only compose run 无提示词可导 → 空导出直通。
        const mfExp = ctxFlatOrNested(context, 'renderManifest', null)
        if (Array.isArray(mfExp) && mfExp.length > 0) {
          return {
            success: true,
            output: {
              export: { json: '[]', markdown: '' },
              fileName: 'film-engineering-prompts-' + new Date().toISOString().slice(0, 10) + '.json',
              passthrough: true,
              manifestMode: true,
            },
          }
        }
        return { success: false, error: 'film_export_prompts 需要 context.selectedShots（先执行 film_select_shots）' }
      }
      const format = (params && params.format) || 'json'
      const json = JSON.stringify(selectedShots.map((s) => ({
        shotId: s.shotId,
        sceneId: s.sceneId,
        prompt: s.prompt,
        model: s.model,
        refTokens: s.refTokens || [],
      })), null, 2)
      const markdown = selectedShots.map((s, i) => {
        const header = '## [' + (i + 1) + '] ' + s.sceneId + ' · ' + s.model
        return header + '\n\n' + s.prompt
      }).join('\n\n---\n\n')
      const out = { json, markdown }
      if (format !== 'json' && format !== 'markdown') {
        return { success: false, error: 'film_export_prompts 未知格式: ' + format }
      }
      return {
        success: true,
        output: {
          export: out,
          fileName: 'film-engineering-prompts-' + new Date().toISOString().slice(0, 10) + '.' + format,
        },
      }
    },
  )
  registered.push(FILM_STAGE_TYPES.EXPORT_PROMPTS)

  return { success: true, registered }
}

module.exports = {
  FILM_STAGE_TYPES,
  registerFilmEngineeringStages,
}
