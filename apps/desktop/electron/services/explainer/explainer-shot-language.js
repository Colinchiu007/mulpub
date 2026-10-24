// @ts-check
/**
 * explainer-prod-artifacts — 生产五阶段的上游 artifact 契约
 *
 * 覆盖上游 OpenMontage `animated-explainer` 的五个生产阶段产物：
 *   scenes   → scene_plan
 *   assets   → asset_manifest
 *   editing  → edit_decisions
 *   compose  → render_report + final_review
 *   publish  → publish_log
 *
 * ## 与 explainer-artifacts.js 的分工（不重复实现）
 *
 * `explainer-artifacts.js`（P2a）提供**通用能力**：schema 驱动的归一化（`fillRequired`）、
 * JSON 抽取（`parseJsonArtifact`）、schema 校验（`validateArtifact`）、以及前生产三阶段的
 * 构造器与计数自检。本模块只提供**生产五阶段特有**的东西：
 *   ① 结构化镜头语言 → 生图提示词的**确定性组装**；
 *   ② edit_decisions 的时间轴映射 / cuts / 字幕 / 音频层 / pacing 自检；
 *   ③ render_report / final_review 的**产物有效性**读数装配；
 *   ④ publish_log 的条目化。
 *
 * ## 三条硬纪律（从 P2a 继承，改一条就会制造假绿）
 *
 * 1. **不手写字段缺省** —— schema 是唯一真源；缺什么由 schema 说。
 * 2. **「补齐」与「达标」是两个量** —— 计数型判据按 `metadata.source_counts` 的**原始计数**判定。
 *    （`fillRequired` 会按 `minItems` 补数组 ⇒ 用补齐后的长度判 ⇒ 永远绿。）
 * 3. **缺项显式标注，不静默省略** —— 上游 scene-director Step 4c：
 *    「Silent omission is the most common failure mode and produces unpredictable model output」。
 *
 * ## 为什么「运动名」不能照抄上游
 *
 * 上游 `edit_decisions.cuts[].transform.animation` 的示例是 `ken-burns-slow-zoom` 这类**概念名**，
 * 但本仓的合成层（`story2video-compose-engine.js` 的 `buildImageEffectFilter`）只认
 * `zoom-in` / `zoom-out` / `pan-left` / `pan-right` / `pan-up` / `pan-down` / `zoom-pan` /
 * `rotate` / `blur-in` / `none`。
 * ⇒ 写上游概念名 ⇒ 合成层不认 ⇒ **静默无动效**（不报错、不降级）。
 * ⇒ 本模块只写**仓内真实可执行**的取值，并把上游概念名的映射记进 `metadata.motion_aliases`。
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
  validateArtifact,
} = require('./explainer-artifacts')

// ---------------------------------------------------------------------------
// 常量（全部有上游/仓内权威来源，不得凭印象写）
// ---------------------------------------------------------------------------

/** 上游 scene-director Step 6「Variety check」：至少 3 种 scene type */
const SCENE_TYPE_MIN_DISTINCT = 3
/** 上游 scene-director Step 6：不超过 3 个连续同 type（即连续 3 个同 type 即违规） */
const SCENE_TYPE_MAX_CONSECUTIVE = 3

/** shot_language 的枚举（逐字取自上游 scene_plan.schema.json） */
const SHOT_SIZE_VALUES = [
  'extreme_wide', 'wide', 'medium_wide', 'medium', 'medium_close',
  'close_up', 'extreme_close_up', 'over_shoulder', 'insert', 'establishing',
]
const CAMERA_MOVEMENT_VALUES = [
  'static', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'dolly_in', 'dolly_out',
  'tracking_left', 'tracking_right', 'crane_up', 'crane_down', 'handheld', 'steadicam',
  'whip_pan', 'orbital', 'zoom_in', 'zoom_out', 'rack_focus',
]
const LENS_MM_VALUES = [14, 24, 35, 50, 85, 135, 200]
const LIGHTING_KEY_VALUES = [
  'high_key', 'low_key', 'natural', 'golden_hour', 'blue_hour', 'tungsten_warm',
  'neon', 'silhouette', 'rim_lit', 'volumetric', 'overcast_soft',
]
const DEPTH_OF_FIELD_VALUES = ['shallow', 'medium', 'deep']
const COLOR_TEMPERATURE_VALUES = ['cool', 'neutral', 'warm', 'mixed']

/**
 * 仓内合成层**真实可执行**的 imageEffect 取值
 * （真源：`story2video-compose-engine.js` 的 `buildImageEffectFilter` 的 switch 分支）。
 * ⚠️ 不在白名单里的运动名一律回落 `none` 并记 issue —— 写进去合成层不认 ⇒ 静默无动效。
 */
const IMAGE_EFFECTS = [
  'none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right',
  'pan-up', 'pan-down', 'zoom-pan', 'rotate', 'blur-in',
]

/** 上游概念名 → 仓内可执行名（记进 metadata，不静默换名） */
const UPSTREAM_MOTION_ALIASES = {
  'ken-burns-slow-zoom': 'zoom-in',
  'ken-burns': 'zoom-in',
  'slow-zoom': 'zoom-in',
  'pan-left': 'pan-left',
  'pan-right': 'pan-right',
  'static': 'none',
  'none': 'none',
}

/** 上游 edit-director Step 4b：语速区间（词/秒） */
const NARRATION_WPS_DOCUMENTARY = [2.0, 2.5]
const NARRATION_WPS_ENERGETIC = [2.5, 3.0]
/** 上游 edit-director Step 4b：旁白目标占视频时长的比例区间 */
const NARRATION_FILL_RATIO = [0.85, 0.90]
/** 场景间隙上限（秒）—— 超过就是黑帧 */
const MAX_SCENE_GAP_SECONDS = 1
/** cut 时长默认区间（秒）—— 上游 playbook 的 pacing_rules，缺省值 */
const DEFAULT_MIN_HOLD_SECONDS = 3
const DEFAULT_MAX_HOLD_SECONDS = 15
/** 转场轮换池（上游 Pitfall：不能全片同一个转场） */
const TRANSITION_CYCLE = ['fade', 'dissolve', 'wipe']
/** scene type → 默认图片运动（上游 edit-director Step 2 的 transform.animation 语义） */
const TYPE_DEFAULT_MOTION = {
  text_card: 'none',
  diagram: 'none',
  animation: 'none',
  transition: 'none',
  talking_head: 'zoom-in',
  broll: 'zoom-in',
  character_scene: 'zoom-in',
  generated: 'zoom-in',
  screen_recording: 'none',
}

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

function makeIssue (code, message, severity = 'warn') {
  return { code, message, severity }
}

/**
 * 取一个「受白名单约束」的枚举值。
 * @returns {{ value: string, issue: object|null }}
 *   缺失或越界都返回空串；越界额外给 issue（缺失不额外报 —— 缺失由组装器显式标注「未指定」）。
 */
function enumValue (raw, allowed) {
  const value = asText(raw)
  if (!value) return { value: '', issue: null }
  if (allowed.includes(value)) return { value, issue: null }
  return {
    value: '',
    issue: makeIssue('SHOT_VALUE_OUT_OF_ENUM', '取值「' + value + '」不在允许枚举内，已按「未指定」处理'),
  }
}

/** 镜头语言 → 生图提示词（确定性组装，见 PRD §17.5.1） */
function assembleShotPrompt (scene, options = {}) {
  const issues = []
  const shot = asObject(scene.shot_language)
  const segments = []

  const style = asText(options.imageStyle)
  if (style) segments.push(style)

  const description = asText(scene.description)
  segments.push(description || '未指定')

  const shotSize = enumValue(shot.shot_size, SHOT_SIZE_VALUES)
  if (shotSize.issue) issues.push(shotSize.issue)
  segments.push('镜头：' + (shotSize.value || '未指定'))

  const cameraMovement = enumValue(shot.camera_movement, CAMERA_MOVEMENT_VALUES)
  if (cameraMovement.issue) issues.push(cameraMovement.issue)
  segments.push('运镜：' + (cameraMovement.value || '未指定'))

  const lensRaw = shot.lens_mm
  let lensText = '未指定'
  if (lensRaw !== undefined && lensRaw !== null && lensRaw !== '') {
    const lensNum = Number(lensRaw)
    if (LENS_MM_VALUES.includes(lensNum)) lensText = String(lensNum) + 'mm 镜头'
    else issues.push(makeIssue('SHOT_VALUE_OUT_OF_ENUM', '焦段「' + lensRaw + '」不在允许枚举内，已按「未指定」处理'))
  }
  segments.push('焦段：' + lensText)

  const lighting = enumValue(shot.lighting_key, LIGHTING_KEY_VALUES)
  if (lighting.issue) issues.push(lighting.issue)
  segments.push('光线：' + (lighting.value || '未指定'))

  const dof = enumValue(shot.depth_of_field, DEPTH_OF_FIELD_VALUES)
  if (dof.issue) issues.push(dof.issue)
  segments.push('景深：' + (dof.value || '未指定'))

  const colorTemp = enumValue(shot.color_temperature, COLOR_TEMPERATURE_VALUES)
  if (colorTemp.issue) issues.push(colorTemp.issue)
  segments.push('色温：' + (colorTemp.value || '未指定'))

  const textures = asArray(scene.texture_keywords).map(t => asText(t)).filter(Boolean)
  if (textures.length) segments.push(textures.join('，'))

  return { prompt: segments.filter(Boolean).join('，'), issues }
}

/**
 * 判断某个场景是否**必须**是 `text_card`。
 *
 * 上游 scene-director Common Pitfalls 原文：
 * 「Using `generated` type for CTA/closing screens with exact text:
 *   AI image models hallucinate text — wrong business names, misspelled words,
 *   wrong phone numbers. Any scene with verbatim text (CTA, business info,
 *   contact details, legal) MUST be `type: "text_card"` so Remotion renders
 *   the text exactly.」
 *
 * @param {object} scene scene_plan 的场景项
 * @returns {{ must: boolean, reason: string }}
 */
function requiresTextCard (scene) {
  const obj = asObject(scene)
  const sources = [
    ['description', asText(obj.description)],
    ['overlay_notes', asText(obj.overlay_notes)],
  ]
  const requiredAssets = asArray(obj.required_assets).map(a => asText(asObject(a).description))
  const signals = [
    { label: 'CTA/行动号召', re: /(行动号召|立即|点击|关注|订阅|购买|注册|下载|试用|call[\s-]?to[\s-]?action|cta\b)/i },
    { label: '联系方式', re: /(电话|手机号|联系方式|邮箱|微信号|公众号|客服|hotline|contact\b|@\w+\.\w+)/i },
    { label: '业务信息', re: /(价格|优惠|折扣|地址|门店|营业时间|品牌名|网址|www\.|https?:\/\/)/i },
    { label: '法务/免责', re: /(免责声明|版权|©|备案|条款|政策|隐私)/i },
    { label: '逐字标题', re: /(标题|文案|大字|字幕文本|标题卡|文字卡)/i },
    // ⚠ 逐字文字的**画面形态**：「一张写着"懒"字的白色标签」—— 引号里是画面上的字
    { label: '画面逐字文字', re: /(写着|显示|印着|标着)\s*["“][^"”]{1,12}["”]?\s*字|文字标签|字被揭开/ },
  ]
  const haystacks = sources.map(([field, text]) => [field, text]).concat(requiredAssets.map((t, i) => ['required_assets[' + i + ']', t]))
  for (const [field, text] of haystacks) {
    if (!text) continue
    for (const signal of signals) {
      if (signal.re.test(text)) {
        return { must: true, reason: '字段 ' + field + ' 含' + signal.label + '信号「' + signal.re.source + '」' }
      }
    }
  }
  return { must: false, reason: '' }
}

module.exports = {
  SCENE_TYPE_MIN_DISTINCT,
  SCENE_TYPE_MAX_CONSECUTIVE,
  SHOT_SIZE_VALUES,
  CAMERA_MOVEMENT_VALUES,
  LENS_MM_VALUES,
  LIGHTING_KEY_VALUES,
  DEPTH_OF_FIELD_VALUES,
  COLOR_TEMPERATURE_VALUES,
  IMAGE_EFFECTS,
  UPSTREAM_MOTION_ALIASES,
  NARRATION_WPS_DOCUMENTARY,
  NARRATION_WPS_ENERGETIC,
  NARRATION_FILL_RATIO,
  MAX_SCENE_GAP_SECONDS,
  DEFAULT_MIN_HOLD_SECONDS,
  DEFAULT_MAX_HOLD_SECONDS,
  TRANSITION_CYCLE,
  TYPE_DEFAULT_MOTION,
  makeIssue,
  enumValue,
  assembleShotPrompt,
  requiresTextCard,
}
