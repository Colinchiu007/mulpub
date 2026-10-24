// @ts-check
/**
 * explainer-edit-decisions — 上游 edit_decisions 产物的构造与自检
 *
 * ## 为什么要单独一个模块
 *
 * `explainer-prod-artifacts.js` 已承载 scene_plan + asset_manifest（贴 limit 500），
 * edit_decisions 塞进去会超限 ⇒ 拆开（**抽模块，不抬基线**）。
 *
 * ## 上游依据
 *
 * `skills/pipelines/explainer/edit-director.md`：
 *   Step 1 资产→时间轴映射；Step 2 cuts；Step 3 字幕（**强制开启**）；
 *   Step 4 音频层（ducking 必配）；Step 5 pacing；Step 6 完整性校验。
 *
 * ## 两条上游铁律（踩过才知道）
 *
 * 1. **按实际 narration 时长调整 cut**（上游 Pitfalls「Audio drift」）——
 *    但**不得侵占下一镜**（否则 primary cuts 重叠 ⇒ 违反 Step 6）。
 * 2. **转场不能全片同一个**（上游 Pitfalls「Same transition everywhere」）。
 */

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
  makeIssue,
  NARRATION_WPS_DOCUMENTARY,
  NARRATION_WPS_ENERGETIC,
  NARRATION_FILL_RATIO,
  DEFAULT_MIN_HOLD_SECONDS,
  DEFAULT_MAX_HOLD_SECONDS,
  TRANSITION_CYCLE,
  TYPE_DEFAULT_MOTION,
  IMAGE_EFFECTS,
  UPSTREAM_MOTION_ALIASES,
} = require('./explainer-shot-language')

/** 上游 edit-director Step 3 的字幕默认值（示例值） */
const DEFAULT_SUBTITLE = {
  style: 'word-by-word',
  font: 'Inter',
  font_size: 48,
  color: '#FFFFFF',
  background: '#00000088',
  position: 'bottom-center',
  max_words_per_line: 8,
}

/** 上游示例的转场时长（秒） */
const DEFAULT_TRANSITION_DURATION = 0.4

/** 统计「词数」：中文按字计、英文按空白分词计（混合文本的稳妥近似） */
function countWords (text) {
  const value = asText(text)
  if (!value) return 0
  const cjk = (value.match(/[㐀-鿿]/g) || []).length
  const latin = (value.replace(/[㐀-鿿]/g, ' ').match(/[A-Za-z0-9']+/g) || []).length
  return cjk + latin
}

/** 把运动名收敛成**仓内合成层真实可执行**的取值 */
function resolveMotion (raw, fallback) {
  const name = asText(raw)
  if (!name) return { value: fallback, alias: '' }
  if (IMAGE_EFFECTS.includes(name)) return { value: name, alias: '' }
  const mapped = UPSTREAM_MOTION_ALIASES[name]
  if (mapped) return { value: mapped, alias: name }
  return { value: fallback, alias: name }
}

/**
 * 构造 edit_decisions。
 *
 * @param {object} raw 保留位（当前 edit 阶段由代码确定性生成，不消费 LLM 输出）
 * @param {object} ctx
 *   - scenePlan: scene_plan artifact
 *   - assetManifest: asset_manifest artifact
 *   - script: script artifact（取每节的旁白文本做词数预算）
 *   - renderRuntime: proposal 阶段锁定的 runtime（**原样携带**）
 *   - rendererFamily: 提案阶段的创作语法（缺省 'explainer-data'）
 *   - options: { transition, minHoldSeconds, maxHoldSeconds, subtitle*, narrationPace, music }
 */
function buildEditDecisions (raw, ctx = {}) {
  const issues = []
  const schema = loadSchema('edit_decisions')
  const options = asObject(ctx.options)
  const planScenes = asArray(asObject(ctx.scenePlan).scenes)
  const manifestAssets = asArray(asObject(ctx.assetManifest).assets)
  const scriptSections = asArray(asObject(ctx.script).sections)

  const minHold = asNumber(options.minHoldSeconds, DEFAULT_MIN_HOLD_SECONDS)
  const maxHold = asNumber(options.maxHoldSeconds, DEFAULT_MAX_HOLD_SECONDS)
  const motionAliases = {}

  const assetsByScene = new Map()
  for (const asset of manifestAssets) {
    const obj = asObject(asset)
    const sceneId = asText(obj.scene_id)
    if (!sceneId) continue
    if (!assetsByScene.has(sceneId)) assetsByScene.set(sceneId, [])
    assetsByScene.get(sceneId).push(obj)
  }

  const cuts = []
  const narrationSegments = []
  const timingAdjustments = []

  planScenes.forEach((planScene, index) => {
    const scene = asObject(planScene)
    const sceneId = asText(scene.id) || ('scene-' + (index + 1))
    const sceneAssets = assetsByScene.get(sceneId) || []

    const visual = sceneAssets.find(a => asText(a.type) === 'image')
      || sceneAssets.find(a => asText(a.type) === 'video')
      || sceneAssets.find(a => asText(a.type) === 'diagram')
    const narration = sceneAssets.find(a => asText(a.type) === 'narration' || asText(a.type) === 'audio')

    const inSeconds = asNumber(scene.start_seconds, 0)
    const plannedOut = asNumber(scene.end_seconds, inSeconds)
    let outSeconds = plannedOut
    let nextStart = Infinity
    if (index + 1 < planScenes.length) {
      nextStart = asNumber(asObject(planScenes[index + 1]).start_seconds, Infinity)
    }

    // ⚠ 上游 Pitfall「Audio drift」：按**实际** narration 时长校正，但不得侵占下一镜
    const actualDuration = narration ? asNumber(narration.duration_seconds, 0) : 0
    // ⚠ 上游 Pitfall「Audio drift」：**总是**按实际 narration 时长对齐（不设「偏差大才校正」的阈值
    //   —— 那种阈值会让「差 0.4 秒」的真实漂移悄悄留在画面上）。
    //   0.05s 只是浮点容差（避免 5.8 vs 5.8000000001 触发无意义的 issue）。
    if (actualDuration > 0 && Math.abs(actualDuration - (plannedOut - inSeconds)) > 0.05) {
      const corrected = inSeconds + actualDuration
      const bounded = nextStart === Infinity ? corrected : Math.min(corrected, nextStart)
      timingAdjustments.push({
        scene_id: sceneId,
        planned_out_seconds: plannedOut,
        actual_out_seconds: bounded,
        actual_narration_seconds: actualDuration,
        clipped_to_next_scene: bounded < corrected,
      })
      outSeconds = bounded
      issues.push(makeIssue('CUT_RETIMED_TO_ACTUAL_NARRATION',
        '场景「' + sceneId + '」按实际旁白时长校正：计划 ' + plannedOut.toFixed(2) +
        ' 秒 → ' + bounded.toFixed(2) + ' 秒' +
        (bounded < corrected ? '（已截到下一镜起点，避免 primary cuts 重叠）' : '')))
    }

    if (!visual) {
      issues.push(makeIssue('SCENE_WITHOUT_VISUAL_ASSET',
        '场景「' + sceneId + '」没有可用的视觉资产，已跳过该镜的 cut', 'error'))
      return
    }

    const motion = resolveMotion(options.motion, TYPE_DEFAULT_MOTION[asText(scene.type)] || 'none')
    if (motion.alias) motionAliases[motion.alias] = motion.value

    const transition = TRANSITION_CYCLE[index % TRANSITION_CYCLE.length]
    cuts.push({
      id: 'cut-' + (index + 1),
      source: asText(visual.id),
      in_seconds: Number(inSeconds.toFixed(3)),
      out_seconds: Number(Math.max(outSeconds, inSeconds).toFixed(3)),
      layer: 'primary',
      transform: { scale: 1, position: 'center', animation: motion.value },
      transition_in: transition,
      transition_out: transition,
      transition_duration: DEFAULT_TRANSITION_DURATION,
      reason: asText(scene.shot_intent) || asText(scene.information_role),
    })

    if (narration) {
      narrationSegments.push({
        asset_id: asText(narration.id),
        start_seconds: Number(inSeconds.toFixed(3)),
        end_seconds: Number(Math.max(outSeconds, inSeconds).toFixed(3)),
      })
    }
  })

  // 字幕（上游 Step 3：**强制开启**）
  const subtitles = {
    enabled: true,
    style: asText(options.subtitleStyle) || DEFAULT_SUBTITLE.style,
    font: asText(options.subtitleFont) || DEFAULT_SUBTITLE.font,
    font_size: asNumber(options.subtitleFontSize, DEFAULT_SUBTITLE.font_size),
    color: asText(options.subtitleColor) || DEFAULT_SUBTITLE.color,
    background: asText(options.subtitleBackground) || DEFAULT_SUBTITLE.background,
    position: asText(options.subtitlePosition) || DEFAULT_SUBTITLE.position,
    max_words_per_line: asNumber(options.maxWordsPerLine, DEFAULT_SUBTITLE.max_words_per_line),
  }
  if (!narrationSegments.length) {
    issues.push(makeIssue('SUBTITLE_WITHOUT_SOURCE',
      '没有旁白音频，字幕已启用但缺少可推导的时间轴来源（source 留空）', 'warn'))
  }

  // 音频层（上游 Step 4）
  const audio = { narration: { segments: narrationSegments } }
  const musicAssetId = asText(asObject(options.music).asset_id)
  if (musicAssetId) {
    audio.music = {
      asset_id: musicAssetId,
      volume: asNumber(asObject(options.music).volume, 0.08),
      fade_in_seconds: asNumber(asObject(options.music).fade_in_seconds, 2),
      fade_out_seconds: asNumber(asObject(options.music).fade_out_seconds, 3),
      // ⚠ 上游 Pitfall「No ducking」：有音乐就必须配 ducking
      ducking: {
        enabled: true,
        threshold_db: asNumber(asObject(asObject(options.music).ducking).threshold_db, -3),
        reduction_db: asNumber(asObject(asObject(options.music).ducking).reduction_db, -8),
        attack_ms: asNumber(asObject(asObject(options.music).ducking).attack_ms, 200),
        release_ms: asNumber(asObject(asObject(options.music).ducking).release_ms, 500),
      },
    }
  }

  const decisions = {
    version: ARTIFACT_VERSION,
    cuts,
    subtitles,
    audio,
    render_runtime: asText(ctx.renderRuntime) || 'remotion',
    renderer_family: asText(ctx.rendererFamily) || 'explainer-data',
    metadata: {
      source_counts: { cuts: cuts.length, narration_segments: narrationSegments.length },
      issues,
      motion_aliases: motionAliases,
      timing_adjustments: timingAdjustments,
      renderer_family_source: asText(ctx.rendererFamily) ? 'proposal' : 'default',
      // ⚠ **pacing 阈值落进产物** ⇒ 自检不依赖调用方是否记得传 options
      //   （传了以 ctx.options 为准；没传就读这里 ⇒ 不会出现「静默用默认值」的假绿）
      hold_bounds: { min_seconds: minHold, max_seconds: maxHold },
    },
  }
  return fillRequired(decisions, schema, schema)
}

/**
 * edit_decisions 的机械自检（上游 Step 5 + Step 6）。
 * @param {object} decisions
 * @param {{ scenePlan?: object, assetManifest?: object, script?: object, options?: object }} ctx
 */
function checkEditDecisionsCriteria (decisions, ctx = {}) {
  const issues = []
  const obj = asObject(decisions)
  const cuts = asArray(obj.cuts)
  const options = asObject(ctx.options)
  const bounds = asObject(asObject(decisions).metadata).hold_bounds
  const minHold = asNumber(options.minHoldSeconds, asNumber(bounds.min_seconds, DEFAULT_MIN_HOLD_SECONDS))
  const maxHold = asNumber(options.maxHoldSeconds, asNumber(bounds.max_seconds, DEFAULT_MAX_HOLD_SECONDS))

  if (cuts.length === 0) {
    issues.push(makeIssue('EMPTY_EDIT_DECISIONS', 'edit_decisions 没有任何 cut', 'error'))
    return issues
  }

  const assetIds = new Set(asArray(asObject(ctx.assetManifest).assets).map(a => asText(asObject(a).id)).filter(Boolean))
  const planScenes = asArray(asObject(ctx.scenePlan).scenes)
  const totalDuration = planScenes.length
    ? asNumber(asObject(planScenes[planScenes.length - 1]).end_seconds, 0)
    : asNumber(asObject(cuts[cuts.length - 1]).out_seconds, 0)

  // ① 覆盖：首 cut 从 0 起，末 cut 结束于总时长
  const firstIn = asNumber(asObject(cuts[0]).in_seconds, -1)
  if (Math.abs(firstIn) > 0.001) {
    issues.push(makeIssue('CUTS_NOT_START_AT_ZERO', '第一个 cut 的 in_seconds 是 ' + firstIn + '，应为 0', 'error'))
  }
  const lastOut = asNumber(asObject(cuts[cuts.length - 1]).out_seconds, 0)
  if (totalDuration > 0 && Math.abs(lastOut - totalDuration) > 0.5) {
    issues.push(makeIssue('CUTS_NOT_COVER_TOTAL',
      '最后一个 cut 结束于 ' + lastOut.toFixed(2) + ' 秒，总时长是 ' + totalDuration.toFixed(2) + ' 秒', 'error'))
  }

  // ② primary cuts 不重叠
  const primaries = cuts.filter(c => (asText(asObject(c).layer) || 'primary') === 'primary')
  for (let i = 1; i < primaries.length; i++) {
    const prevOut = asNumber(asObject(primaries[i - 1]).out_seconds, 0)
    const curIn = asNumber(asObject(primaries[i]).in_seconds, 0)
    if (curIn < prevOut - 0.001) {
      issues.push(makeIssue('PRIMARY_CUTS_OVERLAP',
        '第 ' + (i + 1) + ' 个 primary cut 从 ' + curIn + ' 秒开始，早于上一镜的结束 ' + prevOut + ' 秒', 'error'))
    }
  }

  // ③ 每个 scene 至少一个 cut（按 cut 的顺序对应 scene）
  const covered = new Set()
  cuts.forEach((cut, i) => {
    const planScene = asObject(planScenes[i])
    if (planScene.id) covered.add(asText(planScene.id))
  })
  for (const planScene of planScenes) {
    const id = asText(asObject(planScene).id)
    if (id && !covered.has(id)) {
      issues.push(makeIssue('SCENE_WITHOUT_CUT', '场景「' + id + '」没有对应的 cut', 'error'))
    }
  }

  // ④ 每个 cut 的 source 必须是有效 asset_id
  for (const cut of cuts) {
    const source = asText(asObject(cut).source)
    if (assetIds.size && !assetIds.has(source)) {
      issues.push(makeIssue('CUT_SOURCE_UNKNOWN',
        'cut「' + asText(asObject(cut).id) + '」的 source「' + source + '」不在 asset_manifest 里', 'error'))
    }
  }

  // ⑤ narration segments 有序且不重叠
  const segments = asArray(asObject(asObject(obj.audio).narration).segments)
  for (let i = 1; i < segments.length; i++) {
    const prevEnd = asNumber(asObject(segments[i - 1]).end_seconds, 0)
    const curStart = asNumber(asObject(segments[i]).start_seconds, 0)
    if (curStart < prevEnd - 0.001) {
      issues.push(makeIssue('NARRATION_SEGMENTS_OVERLAP',
        '第 ' + (i + 1) + ' 段旁白从 ' + curStart + ' 秒开始，早于上一段的结束 ' + prevEnd + ' 秒', 'error'))
    }
  }

  // ⑥ pacing：cut 时长区间
  for (const cut of cuts) {
    const inS = asNumber(asObject(cut).in_seconds, 0)
    const outS = asNumber(asObject(cut).out_seconds, 0)
    const dur = outS - inS
    if (dur < minHold - 0.001) {
      issues.push(makeIssue('CUT_TOO_SHORT', 'cut「' + asText(asObject(cut).id) + '」时长 ' + dur.toFixed(2) + ' 秒，低于下限 ' + minHold + ' 秒', 'warn'))
    }
    if (dur > maxHold + 0.001) {
      issues.push(makeIssue('CUT_TOO_LONG', 'cut「' + asText(asObject(cut).id) + '」时长 ' + dur.toFixed(2) + ' 秒，高于上限 ' + maxHold + ' 秒', 'warn'))
    }
  }

  // ⑦ 转场多样性
  const transitions = new Set(cuts.map(c => asText(asObject(c).transition_in)).filter(Boolean))
  if (transitions.size <= 1 && cuts.length > 1) {
    issues.push(makeIssue('ALL_CUTS_SAME_TRANSITION', '所有 cut 用了同一个转场（' + Array.from(transitions).join(',') + '）', 'warn'))
  }

  // ⑧ 字幕已启用
  if (asObject(obj.subtitles).enabled !== true) {
    issues.push(makeIssue('SUBTITLES_DISABLED', '字幕未启用（上游要求 explainer 内容强制字幕）', 'error'))
  }

  // ⑨ 旁白预算（上游 Step 4b）
  const sections = asArray(asObject(ctx.script).sections)
  const totalWords = sections.reduce((acc, s) => acc + countWords(asObject(s).text), 0)
  const narrationSeconds = segments.reduce((acc, s) => acc + Math.max(0, asNumber(asObject(s).end_seconds, 0) - asNumber(asObject(s).start_seconds, 0)), 0)
  if (narrationSeconds > 0 && totalWords > 0) {
    const wps = totalWords / narrationSeconds
    const range = asText(options.narrationPace) === 'energetic' ? NARRATION_WPS_ENERGETIC : NARRATION_WPS_DOCUMENTARY
    if (wps < range[0] - 0.001 || wps > range[1] + 0.001) {
      issues.push(makeIssue('NARRATION_RATE_OUT_OF_RANGE',
        '旁白语速 ' + wps.toFixed(2) + ' 词/秒，超出目标区间 ' + range[0] + '–' + range[1] + '（建议削词或延长画面）', 'warn'))
    }
    if (totalDuration > 0) {
      const fill = narrationSeconds / totalDuration
      if (fill < NARRATION_FILL_RATIO[0] - 0.001 || fill > NARRATION_FILL_RATIO[1] + 0.001) {
        issues.push(makeIssue('NARRATION_FILL_OUT_OF_RANGE',
          '旁白时长占视频 ' + (fill * 100).toFixed(1) + '%，目标区间 ' +
          (NARRATION_FILL_RATIO[0] * 100) + '%–' + (NARRATION_FILL_RATIO[1] * 100) + '%', 'warn'))
      }
    }
  }

  // ⑩ 有音乐必须配 ducking
  const music = asObject(asObject(obj.audio).music)
  if (asText(music.asset_id) && asObject(music.ducking).enabled !== true) {
    issues.push(makeIssue('MUSIC_DUCKING_MISSING', '配了音乐但没有开 ducking（旁白会被音乐盖住）', 'error'))
  }

  return issues
}

module.exports = {
  buildEditDecisions,
  checkEditDecisionsCriteria,
  countWords,
  resolveMotion,
  DEFAULT_SUBTITLE,
  DEFAULT_TRANSITION_DURATION,
}
