'use strict'

const { loadSchema } = require('./artifact-schema-validator')
const {
  ARTIFACT_VERSION,
  fillRequired,
  asText,
  asArray,
  asObject,
  asNumber,
} = require('./explainer-artifacts')
const {
  SCENE_TYPE_MIN_DISTINCT,
  SCENE_TYPE_MAX_CONSECUTIVE,
  SHOT_SIZE_VALUES,
  CAMERA_MOVEMENT_VALUES,
  LENS_MM_VALUES,
  LIGHTING_KEY_VALUES,
  DEPTH_OF_FIELD_VALUES,
  COLOR_TEMPERATURE_VALUES,
  makeIssue,
  assembleShotPrompt,
  requiresTextCard,
  MAX_SCENE_GAP_SECONDS,
} = require('./explainer-shot-language')

// ---------------------------------------------------------------------------
// scene_plan
// ---------------------------------------------------------------------------

/** scene_plan.scenes[].type 的合法取值（逐字取自上游 schema） */
const SCENE_TYPES = [
  'talking_head', 'broll', 'animation', 'character_scene', 'diagram',
  'text_card', 'transition', 'generated', 'screen_recording',
]

/**
 * 把 LLM 的松散场景输出归一化成上游 scene_plan。
 *
 * ## 时间轴怎么来
 *
 * 上游 scene-director Step 6 要求「Scenes span the full script duration
 * (first scene starts at 0s, last scene ends at total_duration)」。
 * LLM 通常给的是**每镜时长**而不是绝对时间 ⇒ 本函数按顺序累积出时间轴；
 * 若累积总时长与脚本目标时长偏差 > 5%，按比例缩放（**结构一致性归一化**，
 * 不是质量阈值 —— 质量阈值另由自检判）。
 *
 * @param {object} raw LLM 原始输出（{scenes:[...]} 或裸数组）
 * @param {{ targetDurationSeconds?: number, stylePlaybook?: string }} ctx
 */
function buildScenePlan (raw, ctx = {}) {
  const issues = []
  const schema = loadSchema('scene_plan')
  const sourceScenes = Array.isArray(raw) ? raw : asArray(asObject(raw).scenes)
  const target = asNumber(ctx.targetDurationSeconds, 0)

  // ① 先算每镜时长（LLM 的 duration / duration_seconds / 时长档位）
  const durations = sourceScenes.map((item) => {
    const obj = asObject(item)
    const d = asNumber(obj.duration_seconds, asNumber(obj.duration, 0))
    return d > 0 ? d : 0
  })
  const sum = durations.reduce((a, b) => a + b, 0)

  // ② 时间轴：累积；若与目标偏差过大则按比例缩放
  let scale = 1
  if (target > 0 && sum > 0) {
    const deviation = Math.abs(sum - target) / target
    if (deviation > 0.05) {
      scale = target / sum
      issues.push(makeIssue('SCENE_TIMELINE_RESCALED',
        '场景时长合计 ' + sum.toFixed(2) + ' 秒与目标 ' + target + ' 秒偏差 ' +
        (deviation * 100).toFixed(1) + '%，已按比例缩放到 ' + scale.toFixed(4), 'info'))
    }
  }

  // ③ 逐镜归一化
  const scenes = []
  let cursor = 0
  sourceScenes.forEach((item, index) => {
    const obj = asObject(item)
    const duration = durations[index] * scale
    const start = cursor
    const end = cursor + duration
    cursor = end

    const typeRaw = asText(obj.type)
    const type = SCENE_TYPES.includes(typeRaw) ? typeRaw : 'generated'
    if (typeRaw && !SCENE_TYPES.includes(typeRaw)) {
      issues.push(makeIssue('SCENE_TYPE_OUT_OF_ENUM',
        '第 ' + (index + 1) + ' 镜的 type「' + typeRaw + '」不在允许枚举内，已回落 generated'))
    }

    // ⚠ **旧格式降级**：P2b 之前 LLM 产的是 `{prompt, text, duration}`（散文提示词）。
    //   若 LLM 没按新格式返回，产物会「schema 合法但内容空洞」（无描述、无镜头语言）。
    //   ⇒ 把旧 `prompt` 映射成 `description`（保底可渲染），并**显式记 issue**，不静默接受。
    let description = asText(obj.description)
    if (!description) {
      const legacyPrompt = asText(obj.prompt)
      if (legacyPrompt) {
        description = legacyPrompt
        issues.push(makeIssue('SCENE_LEGACY_FORMAT',
          '第 ' + (index + 1) + ' 镜是旧格式（有 prompt 无 description），已把 prompt 映射为 description；' +
          '该镜没有结构化镜头语言，生图提示词的相关维度会标为「未指定」', 'warn'))
      }
    }

    const scene = {
      id: asText(obj.id) || ('scene-' + (index + 1)),
      type,
      description,
      start_seconds: Number(start.toFixed(3)),
      end_seconds: Number(end.toFixed(3)),
    }
    if (asText(obj.script_section_id)) scene.script_section_id = asText(obj.script_section_id)
    if (asText(obj.framing)) scene.framing = asText(obj.framing)
    if (asText(obj.movement)) scene.movement = asText(obj.movement)
    if (asText(obj.transition_in)) scene.transition_in = asText(obj.transition_in)
    if (asText(obj.transition_out)) scene.transition_out = asText(obj.transition_out)
    if (asText(obj.overlay_notes)) scene.overlay_notes = asText(obj.overlay_notes)
    if (asText(obj.shot_intent)) scene.shot_intent = asText(obj.shot_intent)
    if (asText(obj.narrative_role)) scene.narrative_role = asText(obj.narrative_role)
    if (asText(obj.information_role)) scene.information_role = asText(obj.information_role)
    if (typeof obj.hero_moment === 'boolean') scene.hero_moment = obj.hero_moment

    // shot_language：逐字段按白名单收敛（越界 → 该维度不写，组装时标「未指定」）
    const shot = asObject(obj.shot_language)
    if (Object.keys(shot).length) {
      const out = {}
      if (SHOT_SIZE_VALUES.includes(asText(shot.shot_size))) out.shot_size = asText(shot.shot_size)
      if (CAMERA_MOVEMENT_VALUES.includes(asText(shot.camera_movement))) out.camera_movement = asText(shot.camera_movement)
      const lens = Number(shot.lens_mm)
      if (LENS_MM_VALUES.includes(lens)) out.lens_mm = lens
      if (LIGHTING_KEY_VALUES.includes(asText(shot.lighting_key))) out.lighting_key = asText(shot.lighting_key)
      if (DEPTH_OF_FIELD_VALUES.includes(asText(shot.depth_of_field))) out.depth_of_field = asText(shot.depth_of_field)
      if (COLOR_TEMPERATURE_VALUES.includes(asText(shot.color_temperature))) out.color_temperature = asText(shot.color_temperature)
      if (Object.keys(out).length) scene.shot_language = out
    }

    const textures = asArray(obj.texture_keywords).map(t => asText(t)).filter(Boolean)
    if (textures.length) scene.texture_keywords = textures

    const requiredAssets = asArray(obj.required_assets)
      .map(a => {
        const ao = asObject(a)
        const at = asText(ao.type)
        const asrc = asText(ao.source)
        return {
          type: at,
          description: asText(ao.description),
          source: ['generate', 'source', 'provided', 'record'].includes(asrc) ? asrc : 'generate',
        }
      })
      .filter(a => a.description)
    if (requiredAssets.length) scene.required_assets = requiredAssets

    // 文字场景强制 text_card（上游铁律：AI 生图会编造文字）
    const textCard = requiresTextCard(scene)
    if (textCard.must && scene.type !== 'text_card') {
      issues.push(makeIssue('TEXT_SCENE_MUST_BE_TEXT_CARD',
        '场景「' + scene.id + '」' + textCard.reason + '，已强制改为 text_card（原 type=' + scene.type + '）', 'error'))
      scene.type = 'text_card'
    }

    scenes.push(scene)
  })

  const plan = {
    version: ARTIFACT_VERSION,
    scenes,
    metadata: {
      // ⚠ 原始计数快照：**计数型自检按它判定**（归一化会补齐 ⇒ 用补齐后的长度判会永远绿）
      source_counts: {
        scenes: sourceScenes.length,
        // ⚠ 只数**枚举内**的 type：越界值会回落 'generated'，
        //   若把越界值也算一种 ⇒ 原始计数偏高 ⇒ 多样性判据可能**假绿**。
        scene_types: new Set(sourceScenes
          .map(s => asText(asObject(s).type))
          .filter(t => t && SCENE_TYPES.includes(t))).size,
      },
      issues,
    },
  }
  if (asText(ctx.stylePlaybook)) plan.style_playbook = asText(ctx.stylePlaybook)

  const filled = fillRequired(plan, schema, schema)
  return filled
}

/**
 * scene_plan 的机械自检。
 *
 * ⚠ **多样性按原始计数判定**：归一化不补 scenes 数组（minItems=1 只补 1 个），
 *   但 type 多样性若按补齐后的长度判，会被「回落 generated」稀释 ⇒ 用 source_counts。
 */
function checkScenePlanCriteria (plan) {
  const issues = []
  const scenes = asArray(asObject(plan).scenes)
  if (scenes.length === 0) {
    issues.push(makeIssue('EMPTY_SCENE_PLAN', 'scene_plan 没有任何场景', 'error'))
    return issues
  }

  const sourceCounts = asObject(asObject(asObject(plan).metadata).source_counts)
  const rawTypeCount = Number(sourceCounts.scene_types)
  const distinctTypes = new Set(scenes.map(s => asText(asObject(s).type)).filter(Boolean))
  // ⚠ 用原始计数（LLM 真的给了几种 type），不是归一化后的种类数
  const effectiveDistinct = Number.isFinite(rawTypeCount) ? rawTypeCount : distinctTypes.size
  if (effectiveDistinct < SCENE_TYPE_MIN_DISTINCT) {
    issues.push(makeIssue('INSUFFICIENT_SCENE_TYPES',
      'scene type 至少 ' + SCENE_TYPE_MIN_DISTINCT + ' 种，实际 ' + effectiveDistinct + ' 种', 'error'))
  }

  // 连续同 type 检查
  let run = 1
  let maxRun = 1
  for (let i = 1; i < scenes.length; i++) {
    const prev = asText(asObject(scenes[i - 1]).type)
    const cur = asText(asObject(scenes[i]).type)
    if (prev && prev === cur) { run++; if (run > maxRun) maxRun = run } else run = 1
  }
  if (maxRun >= SCENE_TYPE_MAX_CONSECUTIVE) {
    issues.push(makeIssue('TOO_MANY_CONSECUTIVE_SAME_TYPE',
      '连续同 type 最多 ' + (SCENE_TYPE_MAX_CONSECUTIVE - 1) + ' 个，实际出现 ' + maxRun + ' 个连续同 type', 'error'))
  }

  // 覆盖检查：首尾连续、无 >1s 间隙
  const first = asNumber(asObject(scenes[0]).start_seconds, -1)
  const lastScene = asObject(scenes[scenes.length - 1])
  const last = asNumber(lastScene.end_seconds, -1)
  if (Math.abs(first) > 0.001) {
    issues.push(makeIssue('TIMELINE_NOT_START_AT_ZERO', '第一个场景的 start_seconds 是 ' + first + '，应为 0', 'error'))
  }
  for (let i = 1; i < scenes.length; i++) {
    const prevEnd = asNumber(asObject(scenes[i - 1]).end_seconds, 0)
    const curStart = asNumber(asObject(scenes[i]).start_seconds, 0)
    const gap = curStart - prevEnd
    if (gap > MAX_SCENE_GAP_SECONDS + 0.001) {
      issues.push(makeIssue('TIMELINE_GAP_TOO_LARGE',
        '第 ' + (i + 1) + ' 镜与上一镜之间有 ' + gap.toFixed(2) + ' 秒间隙（上限 ' + MAX_SCENE_GAP_SECONDS + ' 秒，会有黑帧）', 'error'))
    }
  }
  if (last <= 0) {
    issues.push(makeIssue('TIMELINE_EMPTY', '最后一个场景的 end_seconds 是 ' + last, 'error'))
  }

  // 缺 shot_language 的场景：显式提示（组装时会标「未指定」）
  const missingShot = scenes.filter(s => !asObject(asObject(s).shot_language).shot_size)
  if (missingShot.length) {
    issues.push(makeIssue('SCENE_MISSING_SHOT_LANGUAGE',
      missingShot.length + ' 个场景缺 shot_language，组装时这些维度会标为「未指定」', 'warn'))
  }

  return issues
}
// ---------------------------------------------------------------------------
// asset_manifest
// ---------------------------------------------------------------------------

/** asset_manifest.assets[].type 的合法取值（逐字取自上游 schema） */
const ASSET_TYPES = [
  'image', 'video', 'audio', 'narration', 'music', 'sfx', 'diagram', 'animation',
  '3d_asset', '3d_world', 'code_snippet', 'subtitle', 'font', 'lut',
]

/**
 * 把 assets 阶段的产物登记成上游 asset_manifest。
 *
 * ## 提示词从哪来
 *
 * ⚠ `scene_plan` 的 schema 是 `additionalProperties:false` 且**没有 prompt 字段**
 *   ⇒ 组装后的生图提示词**不能**塞进 scene_plan。
 *   ⇒ 它落在本产物的 `assets[].prompt`（schema 里有这个字段），
 *     同时 scene_plan.metadata 里留一份 prompts 映射便于追溯。
 *
 * @param {object} raw assets 阶段的输出（{scenes:[{imagePath,audioPath,duration,...}]}）
 * @param {{ scenePlan?: object, imageStyle?: string, sourceTool?: string }} ctx
 */
function buildAssetManifest (raw, ctx = {}) {
  const issues = []
  const schema = loadSchema('asset_manifest')
  const scenePlan = asObject(ctx.scenePlan)
  const scenes = asArray(asObject(raw).scenes)
  const planScenes = asArray(scenePlan.scenes)
  const sourceTool = asText(ctx.sourceTool) || 'unknown'

  const assets = []
  const prompts = {}
  let totalCost = 0

  scenes.forEach((item, index) => {
    const obj = asObject(item)
    const planScene = asObject(planScenes[index])
    const sceneId = asText(planScene.id) || ('scene-' + (index + 1))
    const text = asText(obj.text)

    // 生图提示词：由结构化镜头语言**确定性组装**（无 shot_language 时回落场景描述）
    const assembled = assembleShotPrompt(planScene, { imageStyle: ctx.imageStyle })
    for (const issue of assembled.issues) issues.push(issue)
    const prompt = assembled.prompt
    if (prompt) prompts[sceneId] = prompt

    const imagePath = asText(obj.imagePath) || asText(obj.image_path) || asText(obj.path)
    if (imagePath) {
      assets.push({
        id: 'asset-' + sceneId + '-image',
        type: 'image',
        path: imagePath,
        source_tool: sourceTool,
        scene_id: sceneId,
        prompt,
        cost_usd: 0,
      })
    }

    const audioPath = asText(obj.audioPath) || asText(obj.audio_path)
    if (audioPath) {
      const duration = asNumber(obj.duration, 0)
      assets.push({
        id: 'asset-' + sceneId + '-narration',
        type: 'narration',
        path: audioPath,
        source_tool: asText(obj.ttsProvider) || sourceTool,
        scene_id: sceneId,
        cost_usd: 0,
        duration_seconds: duration,
      })
    }

    const videoPath = asText(obj.videoPath)
    if (videoPath && !imagePath) {
      assets.push({
        id: 'asset-' + sceneId + '-video',
        type: 'video',
        path: videoPath,
        source_tool: sourceTool,
        scene_id: sceneId,
        prompt,
        cost_usd: 0,
        duration_seconds: asNumber(obj.duration, 0),
      })
    }

    if (!imagePath && !audioPath && !videoPath) {
      issues.push(makeIssue('SCENE_WITHOUT_ASSET', '场景「' + sceneId + '」没有任何可用资产路径', 'error'))
    }
    if (text) {
      issues.push(makeIssue('SCENE_TEXT_NOT_IN_MANIFEST', '场景「' + sceneId + '」的旁白文本已登记在 narration 资产里（时长 ' + asNumber(obj.duration, 0) + ' 秒）', 'info'))
    }
  })

  for (const asset of assets) totalCost += asNumber(asset.cost_usd, 0)

  const manifest = {
    version: ARTIFACT_VERSION,
    assets,
    total_cost_usd: Number(totalCost.toFixed(4)),
    metadata: {
      source_counts: { assets: assets.length, scenes: scenes.length },
      prompts,
      // ⚠ 无单价表 ⇒ 金额为 0；必须标注「单价未知」，**不让 0 元被读成不要钱**
      cost_note: '本仓暂无模型单价表，cost_usd 记 0（单价未知），不代表免费',
      issues,
    },
  }
  return fillRequired(manifest, schema, schema)
}

/**
 * asset_manifest 的机械自检。
 * @param {object} manifest
 * @param {{ scenePlan?: object }} ctx
 */
function checkAssetManifestCriteria (manifest, ctx = {}) {
  const issues = []
  const obj = asObject(manifest)
  const assets = asArray(obj.assets)
  const planScenes = asArray(asObject(ctx.scenePlan).scenes)
  const planIds = planScenes.map(s => asText(asObject(s).id)).filter(Boolean)

  if (assets.length === 0) {
    issues.push(makeIssue('EMPTY_ASSET_MANIFEST', 'asset_manifest 没有任何资产', 'error'))
    return issues
  }

  // 每个 scene 至少一条资产
  for (const sceneId of planIds) {
    const hit = assets.filter(a => asText(asObject(a).scene_id) === sceneId)
    if (hit.length === 0) {
      issues.push(makeIssue('SCENE_WITHOUT_ASSET', '场景「' + sceneId + '」在 asset_manifest 里没有任何资产', 'error'))
    }
  }
  // 资产的 scene_id 必须能对上 scene_plan
  for (const asset of assets) {
    const sceneId = asText(asObject(asset).scene_id)
    if (planIds.length && !planIds.includes(sceneId)) {
      issues.push(makeIssue('ASSET_SCENE_ID_UNKNOWN',
        '资产「' + asText(asObject(asset).id) + '」的 scene_id「' + sceneId + '」不在 scene_plan 里', 'error'))
    }
  }
  // total_cost_usd 必须等于各资产之和
  const sum = assets.reduce((acc, a) => acc + asNumber(asObject(a).cost_usd, 0), 0)
  const declared = asNumber(obj.total_cost_usd, -1)
  if (Math.abs(sum - declared) > 0.0001) {
    issues.push(makeIssue('TOTAL_COST_MISMATCH',
      'total_cost_usd 记 ' + declared + '，但各资产 cost_usd 之和是 ' + Number(sum.toFixed(4)), 'error'))
  }
  return issues
}

module.exports = {
  buildScenePlan,
  checkScenePlanCriteria,
  buildAssetManifest,
  checkAssetManifestCriteria,
  SCENE_TYPES,
  ASSET_TYPES,
}
