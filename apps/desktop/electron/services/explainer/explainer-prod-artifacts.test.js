// @vitest-environment node
// @ts-check
/**
 * explainer-prod-artifacts.test.js — 生产五阶段产物的构造 / schema 合法性 / 机械自检
 *
 * ## 覆盖四条线
 *
 * ① **组装线**：结构化镜头语言 → 确定性提示词；场景 → scene_plan；资产 → asset_manifest；
 *    场景+资产 → edit_decisions；产物 → render_report / final_review / publish_log。
 * ② **schema 合法性线**：每个产物都必须通过 P1 搬进来的**上游 schema**（不是自造判据）。
 * ③ **机械自检线**：上游的计数型 / 结构型判据必须被机械判出来。
 * ④ **反向断言线**：不该被自动判的项**不塞进自检结果**；未获批准的 runtime 漂移**不判违规**。
 *
 * ## 关键设计（对应 PRD §17）
 *
 * ⚠ **「补齐」与「达标」是两个量**：多样性判据按 `metadata.source_counts` 的**原始计数**判定。
 *   本文件用「LLM 只给 2 种 type ⇒ 必须报 INSUFFICIENT_SCENE_TYPES」锁住。
 * ⚠ **缺项显式标注，不静默省略**：缺 shot_language 的维度必须出现「未指定」。
 * ⚠ **运动名必须是仓内真实可执行值**：上游的 `ken-burns-slow-zoom` 在本仓合成层不认。
 * ⚠ **runtime 漂移分两种**：锁定值已获批准 ⇒ 违规（error）；未获批准（P2a 的缺省）⇒ 待办（info）。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { validateArtifact } = require('./explainer-artifacts')
const {
  buildScenePlan,
  checkScenePlanCriteria,
  buildAssetManifest,
  checkAssetManifestCriteria,
} = require('./explainer-prod-artifacts')
const {
  buildEditDecisions,
  checkEditDecisionsCriteria,
} = require('./explainer-edit-decisions')
const {
  buildRenderReport,
  buildFinalReview,
  buildPublishLog,
  checkPublishLogCriteria,
} = require('./explainer-prod-review')
const {
  assembleShotPrompt,
  requiresTextCard,
} = require('./explainer-shot-language')

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function rawScenes (overrides = {}) {
  return {
    scenes: [
      {
        id: 'scene-1',
        type: 'broll',
        description: '一个人坐在桌前盯着电脑屏幕发呆',
        duration: 6,
        script_section_id: 's1',
        shot_intent: '建立情境',
        shot_language: {
          shot_size: 'medium',
          camera_movement: 'static',
          lens_mm: 50,
          lighting_key: 'natural',
          depth_of_field: 'medium',
          color_temperature: 'neutral',
        },
        texture_keywords: ['clean', 'soft'],
      },
      {
        id: 'scene-2',
        type: 'diagram',
        description: '流程图展示任务被拆解的过程',
        duration: 8,
        script_section_id: 's2',
        shot_language: { shot_size: 'wide', camera_movement: 'static' },
      },
      {
        id: 'scene-3',
        type: 'generated',
        description: '抽象情绪插画',
        duration: 6,
        script_section_id: 's3',
        shot_language: { shot_size: 'close_up', camera_movement: 'dolly_in' },
      },
    ],
    ...overrides,
  }
}

function scriptArtifact (overrides = {}) {
  return {
    version: '1.0',
    title: '拖延症',
    total_duration_seconds: 20,
    sections: [
      { id: 's1', text: '你有没有想过为什么总是拖到最后才开始做？', start_seconds: 0, end_seconds: 6 },
      { id: 's2', text: '拖延其实是情绪调节的问题，不是时间管理的问题。', start_seconds: 6, end_seconds: 14 },
      { id: 's3', text: '改变的第一步，是先接受这个事实。', start_seconds: 14, end_seconds: 20 },
    ],
    ...overrides,
  }
}

function manifestAsset (overrides = {}) {
  return {
    assets: [
      { id: 'asset-scene-1-image', type: 'image', path: '/tmp/a1.png', source_tool: 'sd', scene_id: 'scene-1' },
      { id: 'asset-scene-1-narration', type: 'narration', path: '/tmp/a1.mp3', source_tool: 'edge-tts', scene_id: 'scene-1', duration_seconds: 5.8 },
      { id: 'asset-scene-2-image', type: 'image', path: '/tmp/a2.png', source_tool: 'sd', scene_id: 'scene-2' },
      { id: 'asset-scene-2-narration', type: 'narration', path: '/tmp/a2.mp3', source_tool: 'edge-tts', scene_id: 'scene-2', duration_seconds: 7.6 },
      { id: 'asset-scene-3-image', type: 'image', path: '/tmp/a3.png', source_tool: 'sd', scene_id: 'scene-3' },
      { id: 'asset-scene-3-narration', type: 'narration', path: '/tmp/a3.mp3', source_tool: 'edge-tts', scene_id: 'scene-3', duration_seconds: 6.1 },
    ],
    total_cost_usd: 0,
    metadata: { issues: [] },
    ...overrides,
  }
}

function codes (issues) {
  return issues.map(i => i.code)
}

// ---------------------------------------------------------------------------
// ① 提示词组装
// ---------------------------------------------------------------------------

describe('explain 提示词组装：结构化镜头语言 → 确定性提示词', () => {
  it('完整 shot_language ⇒ 七段按固定顺序出现', () => {
    const scene = rawScenes().scenes[0]
    const { prompt, issues } = assembleShotPrompt(scene, { imageStyle: 'cinematic' })
    expect(issues).toEqual([])
    expect(prompt).toContain('cinematic')
    expect(prompt).toContain(scene.description)
    expect(prompt).toContain('镜头：medium')
    expect(prompt).toContain('运镜：static')
    expect(prompt).toContain('50mm 镜头')
    expect(prompt).toContain('光线：natural')
    expect(prompt).toContain('景深：medium')
    expect(prompt).toContain('色温：neutral')
    expect(prompt).toContain('clean，soft')
    // 顺序：主体 → 镜别 → 运镜 → 焦段 → 光位 → 景深 → 色温
    const order = ['镜头：', '运镜：', '焦段：', '光线：', '景深：', '色温：']
    const positions = order.map(k => prompt.indexOf(k))
    expect(positions.every(p => p >= 0)).toBe(true)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
  })

  it('缺 shot_language 的维度必须显式标注「未指定」，不得静默省略', () => {
    const { prompt } = assembleShotPrompt({ description: '主体' }, {})
    expect(prompt).toContain('镜头：未指定')
    expect(prompt).toContain('运镜：未指定')
    expect(prompt).toContain('焦段：未指定')
    expect(prompt).toContain('光线：未指定')
    expect(prompt).toContain('景深：未指定')
    expect(prompt).toContain('色温：未指定')
  })

  it('枚举外的取值 ⇒ 该维度标「未指定」**并**记 issue（不静默映射到最近值）', () => {
    const { prompt, issues } = assembleShotPrompt({
      description: '主体',
      shot_language: { shot_size: '超广角', lens_mm: 99 },
    }, {})
    expect(prompt).toContain('镜头：未指定')
    expect(prompt).toContain('焦段：未指定')
    expect(codes(issues)).toContain('SHOT_VALUE_OUT_OF_ENUM')
    expect(issues.length).toBe(2)
  })

  it('缺 description ⇒ 主体位置标「未指定」', () => {
    const { prompt } = assembleShotPrompt({}, {})
    expect(prompt.startsWith('未指定')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ② text_card 强制判定
// ---------------------------------------------------------------------------

describe('explain 文字场景必须判为 text_card', () => {
  it('描述含行动号召 ⇒ 判为必须 text_card', () => {
    const r = requiresTextCard({ description: '画面显示行动号召：立即点击订阅' })
    expect(r.must).toBe(true)
    expect(r.reason).toContain('CTA')
  })

  it('描述含联系方式 ⇒ 判为必须 text_card', () => {
    const r = requiresTextCard({ description: '结尾展示客服电话 400-123-4567' })
    expect(r.must).toBe(true)
  })

  it('普通描述 ⇒ 不判', () => {
    const r = requiresTextCard({ description: '一个人坐在桌前盯着屏幕' })
    expect(r.must).toBe(false)
    expect(r.reason).toBe('')
  })

  it('buildScenePlan 把含文字的场景强制改成 text_card 并记 issue', () => {
    const raw = rawScenes()
    raw.scenes[2].description = '画面出现品牌名与地址信息'
    const plan = buildScenePlan(raw, { targetDurationSeconds: 20 })
    expect(plan.scenes[2].type).toBe('text_card')
    expect(codes(plan.metadata.issues)).toContain('TEXT_SCENE_MUST_BE_TEXT_CARD')
  })
})

// ---------------------------------------------------------------------------
// ③ scene_plan
// ---------------------------------------------------------------------------

describe('explain scene_plan 构造与自检', () => {
  it('产物必须通过上游 schema', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const result = validateArtifact('scene_plan', plan)
    expect(result.ok).toBe(true)
  })

  it('时间轴按顺序累积，首镜从 0 起、末镜结束于总时长', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    expect(plan.scenes[0].start_seconds).toBe(0)
    expect(plan.scenes[0].end_seconds).toBe(6)
    expect(plan.scenes[1].start_seconds).toBe(6)
    expect(plan.scenes[2].end_seconds).toBe(20)
  })

  it('时长合计与目标偏差过大 ⇒ 按比例缩放并记 issue（结构一致性归一化）', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 40 })
    expect(codes(plan.metadata.issues)).toContain('SCENE_TIMELINE_RESCALED')
    expect(plan.scenes[plan.scenes.length - 1].end_seconds).toBeCloseTo(40, 1)
  })

  it('type 不在枚举内 ⇒ 回落 generated 并记 issue（不静默）', () => {
    const raw = rawScenes()
    raw.scenes[0].type = '不存在的类型'
    const plan = buildScenePlan(raw, { targetDurationSeconds: 20 })
    expect(plan.scenes[0].type).toBe('generated')
    expect(codes(plan.metadata.issues)).toContain('SCENE_TYPE_OUT_OF_ENUM')
  })

  it('★ 多样性按**原始计数**判定：LLM 只给 2 种 type ⇒ 必须报红（补齐救不了它）', () => {
    const raw = rawScenes()
    // 三镜都改成同一种 type（原始计数 = 1 种）
    raw.scenes[0].type = 'broll'
    raw.scenes[1].type = 'broll'
    raw.scenes[2].type = 'broll'
    const plan = buildScenePlan(raw, { targetDurationSeconds: 20 })
    const issues = checkScenePlanCriteria(plan)
    expect(codes(issues)).toContain('INSUFFICIENT_SCENE_TYPES')
  })

  it('★ 越界的 type 不算一种：原始只有 1 种合法 type ⇒ 必须报红（回落 generated 不能凑够 3 种）', () => {
    // ⚠ 这条锁住「原始计数只数枚举内的 type」：若把越界值也算一种，
    //   原始计数会算成 2 种 ⇒ 归一化后也是 2 种 ⇒ 判据不红 ⇒ **假绿**。
    // 场景：2 种**合法** type + 1 个越界（越界回落 generated ⇒ 归一化后变成 3 种）
    //  ⇒ 归一化后长度是 3（不报红），但原始合法 type 只有 2 种（**必须报红**）
    const raw = rawScenes()
    raw.scenes[0].type = 'broll'
    raw.scenes[1].type = 'diagram'
    raw.scenes[2].type = '不存在的类型'
    const plan = buildScenePlan(raw, { targetDurationSeconds: 20 })
    expect(plan.scenes[2].type).toBe('generated')
    expect(new Set(plan.scenes.map(s => s.type)).size).toBe(3)   // 归一化后确实是 3 种
    expect(plan.metadata.source_counts.scene_types).toBe(2)        // 但原始合法只有 2 种
    expect(codes(checkScenePlanCriteria(plan))).toContain('INSUFFICIENT_SCENE_TYPES')
  })

  it('连续 3 个同 type ⇒ 报 TOO_MANY_CONSECUTIVE_SAME_TYPE', () => {
    const raw = rawScenes()
    raw.scenes[1].type = 'broll'
    raw.scenes[2].type = 'broll'
    const plan = buildScenePlan(raw, { targetDurationSeconds: 20 })
    expect(codes(checkScenePlanCriteria(plan))).toContain('TOO_MANY_CONSECUTIVE_SAME_TYPE')
  })

  it('连续 2 个同 type ⇒ 不报连续同 type', () => {
    const raw = rawScenes()
    raw.scenes[1].type = 'broll'
    const plan = buildScenePlan(raw, { targetDurationSeconds: 20 })
    expect(codes(checkScenePlanCriteria(plan))).not.toContain('TOO_MANY_CONSECUTIVE_SAME_TYPE')
  })

  it('缺 shot_language 的场景 ⇒ 记提示 issue（组装时该维度标未指定）', () => {
    const raw = rawScenes()
    delete raw.scenes[0].shot_language
    const plan = buildScenePlan(raw, { targetDurationSeconds: 20 })
    expect(codes(checkScenePlanCriteria(plan))).toContain('SCENE_MISSING_SHOT_LANGUAGE')
  })
})

// ---------------------------------------------------------------------------
// ④ asset_manifest
// ---------------------------------------------------------------------------

describe('explain asset_manifest 构造与自检', () => {
  function assetsRaw () {
    return {
      scenes: [
        { imagePath: '/tmp/a1.png', audioPath: '/tmp/a1.mp3', duration: 5.8 },
        { imagePath: '/tmp/a2.png', audioPath: '/tmp/a2.mp3', duration: 7.6 },
        { imagePath: '/tmp/a3.png', audioPath: '/tmp/a3.mp3', duration: 6.1 },
      ],
    }
  }

  it('产物必须通过上游 schema', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const manifest = buildAssetManifest(assetsRaw(), { scenePlan: plan, imageStyle: 'cinematic' })
    const result = validateArtifact('asset_manifest', manifest)
    expect(result.ok).toBe(true)
  })

  it('每镜的图片与旁白各登记一条资产', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const manifest = buildAssetManifest(assetsRaw(), { scenePlan: plan })
    expect(manifest.assets.length).toBe(6)
    expect(manifest.assets.filter(a => a.type === 'image').length).toBe(3)
    expect(manifest.assets.filter(a => a.type === 'narration').length).toBe(3)
  })

  it('★ 组装出的提示词落在 asset_manifest 的 assets[].prompt（scene_plan 装不下）', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const manifest = buildAssetManifest(assetsRaw(), { scenePlan: plan, imageStyle: 'cinematic' })
    const image = manifest.assets.find(a => a.type === 'image')
    expect(image.prompt).toContain('镜头：medium')
    expect(image.prompt).toContain('cinematic')
    // scene_plan 本身装不下 prompt（schema 是 additionalProperties:false）
    expect(Object.prototype.hasOwnProperty.call(plan.scenes[0], 'prompt')).toBe(false)
  })

  it('无单价表 ⇒ 金额为 0 且显式标注「单价未知」（不让 0 元被读成不要钱）', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const manifest = buildAssetManifest(assetsRaw(), { scenePlan: plan })
    expect(manifest.total_cost_usd).toBe(0)
    expect(manifest.metadata.cost_note).toContain('单价未知')
  })

  it('资产的 scene_id 不在 scene_plan ⇒ 报红', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const manifest = buildAssetManifest(assetsRaw(), { scenePlan: plan })
    manifest.assets[0].scene_id = 'scene-不存在'
    expect(codes(checkAssetManifestCriteria(manifest, { scenePlan: plan }))).toContain('ASSET_SCENE_ID_UNKNOWN')
  })

  it('某场景没有任何资产 ⇒ 报红', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const manifest = buildAssetManifest(assetsRaw(), { scenePlan: plan })
    manifest.assets = manifest.assets.filter(a => a.scene_id !== 'scene-2')
    expect(codes(checkAssetManifestCriteria(manifest, { scenePlan: plan }))).toContain('SCENE_WITHOUT_ASSET')
  })

  it('total_cost_usd 与各资产之和不符 ⇒ 报红', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const manifest = buildAssetManifest(assetsRaw(), { scenePlan: plan })
    manifest.total_cost_usd = 99
    expect(codes(checkAssetManifestCriteria(manifest, { scenePlan: plan }))).toContain('TOTAL_COST_MISMATCH')
  })
})

// ---------------------------------------------------------------------------
// ⑤ edit_decisions
// ---------------------------------------------------------------------------

describe('explain edit_decisions 构造与自检', () => {
  function build (overrides = {}) {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const manifest = manifestAsset()
    const decisions = buildEditDecisions({}, {
      scenePlan: plan,
      assetManifest: manifest,
      script: scriptArtifact(),
      renderRuntime: 'remotion',
      ...overrides,
    })
    return { plan, manifest, decisions }
  }

  it('产物必须通过上游 schema', () => {
    const { decisions } = build()
    const result = validateArtifact('edit_decisions', decisions)
    expect(result.ok).toBe(true)
  })

  it('每个场景一个 primary cut，source 引用有效 asset_id', () => {
    const { decisions } = build()
    expect(decisions.cuts.length).toBe(3)
    expect(decisions.cuts.every(c => c.layer === 'primary')).toBe(true)
    expect(decisions.cuts[0].source).toBe('asset-scene-1-image')
  })

  it('★ render_runtime 原样携带（proposal 锁定值不得被 edit 改写）', () => {
    const { decisions } = build({ renderRuntime: 'ffmpeg' })
    expect(decisions.render_runtime).toBe('ffmpeg')
  })

  it('★ 运动名必须是仓内真实可执行的 imageEffect（上游 ken-burns 会被映射并登记）', () => {
    const { decisions } = build({ options: { motion: 'ken-burns-slow-zoom' } })
    expect(decisions.cuts[0].transform.animation).toBe('zoom-in')
    expect(decisions.metadata.motion_aliases['ken-burns-slow-zoom']).toBe('zoom-in')
  })

  it('未在白名单的运动名 ⇒ 回落 none（不写合成层不认的值）', () => {
    const { decisions } = build({ options: { motion: '会飞的光效' } })
    expect(['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'zoom-pan', 'rotate', 'blur-in'])
      .toContain(decisions.cuts[0].transform.animation)
  })

  it('转场不全片同一个（上游 Pitfall）', () => {
    const { decisions } = build()
    const transitions = new Set(decisions.cuts.map(c => c.transition_in))
    expect(transitions.size).toBeGreaterThan(1)
  })

  it('字幕强制开启', () => {
    const { decisions } = build()
    expect(decisions.subtitles.enabled).toBe(true)
    expect(decisions.subtitles.max_words_per_line).toBe(8)
  })

  it('★ 按实际旁白时长校正 cut，但不得侵占下一镜（避免 primary cuts 重叠）', () => {
    const { plan, manifest, decisions } = build()
    // scene-1 的旁白真实时长 5.8s，scene-2 从 6s 起 ⇒ 不该越界
    expect(decisions.cuts[0].out_seconds).toBeCloseTo(5.8, 2)
    expect(decisions.cuts[0].out_seconds).toBeLessThanOrEqual(6)
    // ⚠ 「总是按实际旁白时长对齐」（不设偏差阈值）⇒ 三个场景**都**有漂移记录
    expect(decisions.metadata.timing_adjustments).toHaveLength(3)
    expect(decisions.metadata.timing_adjustments[0].actual_narration_seconds).toBeCloseTo(5.8, 2)
    expect(manifest.assets.length).toBeGreaterThan(0)
    expect(plan.scenes.length).toBe(3)
  })

  it('旁白时长超出下一镜 ⇒ 被截到下一镜起点（不产生重叠）', () => {
    const plan = buildScenePlan(rawScenes(), { targetDurationSeconds: 20 })
    const manifest = manifestAsset()
    manifest.assets.find(a => a.id === 'asset-scene-1-narration').duration_seconds = 9
    const decisions = buildEditDecisions({}, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(decisions.cuts[0].out_seconds).toBeCloseTo(6, 3)
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(codes(issues)).not.toContain('PRIMARY_CUTS_OVERLAP')
  })

  it('cut 的 source 指向不存在的资产 ⇒ 报红', () => {
    const { plan, manifest, decisions } = build()
    decisions.cuts[0].source = 'asset-不存在'
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(codes(issues)).toContain('CUT_SOURCE_UNKNOWN')
  })

  it('primary cuts 重叠 ⇒ 报红', () => {
    const { plan, manifest, decisions } = build()
    decisions.cuts[1].in_seconds = 1
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(codes(issues)).toContain('PRIMARY_CUTS_OVERLAP')
  })

  it('切掉一个 cut ⇒ 对应场景报「没有对应的 cut」', () => {
    const { plan, manifest, decisions } = build()
    decisions.cuts.splice(1, 1)
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(codes(issues)).toContain('SCENE_WITHOUT_CUT')
  })

  it('cut 时长低于下限 ⇒ 报 pacing issue', () => {
    const { plan, manifest, decisions } = build({ options: { minHoldSeconds: 10 } })
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(codes(issues)).toContain('CUT_TOO_SHORT')
  })

  it('全部 cut 同一转场 ⇒ 报转场多样性 issue', () => {
    const { plan, manifest, decisions } = build()
    decisions.cuts.forEach(c => { c.transition_in = 'fade' })
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(codes(issues)).toContain('ALL_CUTS_SAME_TRANSITION')
  })

  it('字幕被关掉 ⇒ 报红（上游要求 explainer 内容强制字幕）', () => {
    const { plan, manifest, decisions } = build()
    decisions.subtitles.enabled = false
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(codes(issues)).toContain('SUBTITLES_DISABLED')
  })

  it('配了音乐但没开 ducking ⇒ 报红', () => {
    const { plan, manifest, decisions } = build()
    decisions.audio.music = { asset_id: 'music-bg', volume: 0.08 }
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(codes(issues)).toContain('MUSIC_DUCKING_MISSING')
  })

  it('配了音乐且开了 ducking ⇒ 不报', () => {
    const { plan, manifest, decisions } = build({ options: { music: { asset_id: 'music-bg' } } })
    expect(decisions.audio.music.ducking.enabled).toBe(true)
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: scriptArtifact() })
    expect(codes(issues)).not.toContain('MUSIC_DUCKING_MISSING')
  })

  it('旁白语速超出区间 ⇒ 报 issue 并给建议', () => {
    const { plan, manifest, decisions } = build()
    const fast = scriptArtifact({
      sections: [
        { id: 's1', text: '一二三四五六七八九十', start_seconds: 0, end_seconds: 6 },
        { id: 's2', text: '一二三四五六七八九十', start_seconds: 6, end_seconds: 14 },
        { id: 's3', text: '一二三四五六七八九十', start_seconds: 14, end_seconds: 20 },
      ],
    })
    const issues = checkEditDecisionsCriteria(decisions, { scenePlan: plan, assetManifest: manifest, script: fast })
    expect(codes(issues)).toContain('NARRATION_RATE_OUT_OF_RANGE')
  })
})

// ---------------------------------------------------------------------------
// ⑥ final_review / runtime 漂移
// ---------------------------------------------------------------------------

describe('explain final_review 与 runtime 漂移检测', () => {
  function reviewCtx (overrides = {}) {
    return {
      probe: {
        valid_container: true, duration_seconds: 20, resolution: '1920x1080', fps: 30,
        has_audio: true, codec: 'h264', file_size_bytes: 123456, issues: [],
      },
      frames: {
        frames_sampled: 4, frame_paths: ['/tmp/f1.png', '/tmp/f2.png', '/tmp/f3.png', '/tmp/f4.png'],
        black_frames_detected: false, broken_overlays: false, missing_assets: false,
        unreadable_text: false, issues: [], checks_not_performed: ['unreadable_text', 'broken_overlays', 'missing_assets'],
      },
      loudness: { mean_volume_db: -30, max_volume_db: -12, is_silent: false, has_audio: true, issues: [] },
      renderReport: { render_grammar: 'explainer-data', outputs: [{ path: '/tmp/out.mp4' }] },
      editDecisions: { cuts: [{ transform: { animation: 'zoom-in' } }, { transform: { animation: 'none' } }], subtitles: { enabled: true } },
      lockedRuntime: 'remotion',
      actualRuntime: 'ffmpeg',
      approvalStatus: 'pending',
      ...overrides,
    }
  }

  it('产物必须通过上游 schema', () => {
    const review = buildFinalReview({}, reviewCtx())
    const result = validateArtifact('final_review', review)
    expect(result.ok).toBe(true)
  })

  it('★ 锁定值未获批准时的漂移 ⇒ 记为待办（info），**不判违规、不降 status**', () => {
    const review = buildFinalReview({}, reviewCtx({ approvalStatus: 'pending' }))
    expect(review.checks.promise_preservation.runtime_swap_detected).toBe(true)
    expect(review.status).toBe('pass')
    expect(codes(review.metadata.issues)).toContain('RUNTIME_SWAP_PENDING_CONFIRMATION')
    expect(codes(review.metadata.issues)).not.toContain('RUNTIME_SWAP_VIOLATION')
  })

  it('★ 锁定值已获批准时的漂移 ⇒ 判违规（error）并降 status', () => {
    const review = buildFinalReview({}, reviewCtx({ approvalStatus: 'approved' }))
    expect(review.checks.promise_preservation.runtime_swap_detected).toBe(true)
    expect(review.status).toBe('revise')
    expect(codes(review.metadata.issues)).toContain('RUNTIME_SWAP_VIOLATION')
  })

  it('runtime 一致 ⇒ 不报漂移', () => {
    const review = buildFinalReview({}, reviewCtx({ actualRuntime: 'remotion' }))
    expect(review.checks.promise_preservation.runtime_swap_detected).toBe(false)
    expect(review.checks.promise_preservation.runtime_swap_check).toContain('ok')
  })

  it('产物容器无效 ⇒ status = fail 且 recommended_action = re_render', () => {
    const review = buildFinalReview({}, reviewCtx({ probe: { valid_container: false, duration_seconds: 0, resolution: '', fps: 0, has_audio: false, codec: '', file_size_bytes: 0, issues: ['读不到时长'] } }))
    expect(review.status).toBe('fail')
    expect(review.recommended_action).toBe('re_render')
  })

  it('★ 音轨静音 ⇒ status = fail（「有音轨」对静音缺陷失明，必须靠响度读数）', () => {
    const review = buildFinalReview({}, reviewCtx({
      loudness: { mean_volume_db: -91, max_volume_db: -91, is_silent: true, has_audio: true, issues: ['静音'] },
    }))
    expect(review.checks.audio_spotcheck.unexpected_silence).toBe(true)
    expect(review.status).toBe('fail')
    expect(codes(review.metadata.issues)).toContain('AUDIO_IS_SILENT')
  })

  it('抽帧少于 4 帧 ⇒ 报红（schema 的 frames_sampled minimum = 4）', () => {
    const review = buildFinalReview({}, reviewCtx({
      frames: { frames_sampled: 2, frame_paths: [], black_frames_detected: false, broken_overlays: false, missing_assets: false, unreadable_text: false, issues: [], checks_not_performed: [] },
    }))
    expect(codes(review.metadata.issues)).toContain('TOO_FEW_SAMPLED_FRAMES')
  })

  it('不可机械判的三项登记在 checks_not_performed（不假装判过）', () => {
    const review = buildFinalReview({}, reviewCtx())
    expect(review.metadata.checks_not_performed).toEqual(['unreadable_text', 'broken_overlays', 'missing_assets'])
  })

  it('render_report 字段来自实测读数而不是意图参数', () => {
    const report = buildRenderReport({ videoPath: '/tmp/out.mp4' }, {
      probe: { valid_container: true, duration_seconds: 20.5, resolution: '1920x1080', fps: 30, has_audio: true, codec: 'h264', file_size_bytes: 999, issues: [] },
      editDecisions: { renderer_family: 'explainer-data' },
    })
    expect(report.outputs[0].duration_seconds).toBe(20.5)
    expect(report.outputs[0].resolution).toBe('1920x1080')
    const result = validateArtifact('render_report', report)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ⑦ publish_log
// ---------------------------------------------------------------------------

describe('explain publish_log', () => {
  it('产物必须通过上游 schema', () => {
    const log = buildPublishLog({ publishedTo: ['bilibili'] }, {})
    const result = validateArtifact('publish_log', log)
    expect(result.ok).toBe(true)
  })

  it('★ 未开启发布 ⇒ 记一条 draft 条目（不是 0 条，0 条会静默通过）', () => {
    const log = buildPublishLog({ skipped: true, publishedTo: [], failedPlatforms: [] }, {})
    expect(log.entries.length).toBe(1)
    expect(log.entries[0].status).toBe('draft')
  })

  it('failed 条目必须带 error', () => {
    const log = buildPublishLog({ failedPlatforms: ['douyin'] }, {})
    expect(log.entries[0].status).toBe('failed')
    expect(log.entries[0].error).toBeTruthy()
    expect(codes(checkPublishLogCriteria(log))).not.toContain('FAILED_ENTRY_WITHOUT_ERROR')
  })

  it('failed 条目缺 error ⇒ 报红', () => {
    const log = buildPublishLog({ failedPlatforms: ['douyin'] }, {})
    delete log.entries[0].error
    expect(codes(checkPublishLogCriteria(log))).toContain('FAILED_ENTRY_WITHOUT_ERROR')
  })

  it('published 条目缺 url / video_id ⇒ 报红', () => {
    const log = buildPublishLog({ publishedTo: ['bilibili'] }, {})
    expect(codes(checkPublishLogCriteria(log))).toContain('PUBLISHED_ENTRY_WITHOUT_URL')
  })

  it('空 entries ⇒ 报红', () => {
    expect(codes(checkPublishLogCriteria({ entries: [] }))).toContain('EMPTY_PUBLISH_LOG')
  })
})

// ---------------------------------------------------------------------------
// ⑧ 场景来源解析（三种形态）与 compose 输出合并
// ---------------------------------------------------------------------------

describe('explain 场景来源解析与 compose 输出合并', () => {
  const { resolveSceneSource, adaptScenesForAssets } = require('./explainer-prod-stages')
  const { composeOutputWithArtifacts, assetManifestToLegacyScenes } = require('./explainer-review-stages')

  const planObject = {
    version: '1.0',
    scenes: [
      { id: 'scene-1', type: 'broll', description: '主体', start_seconds: 0, end_seconds: 6,
        script_section_id: 's1', shot_language: { shot_size: 'medium' } },
      { id: 'scene-2', type: 'diagram', description: '流程', start_seconds: 6, end_seconds: 14,
        script_section_id: 's2', shot_language: { shot_size: 'wide' } },
    ],
  }
  const script = { sections: [{ id: 's1', text: '第一段', start_seconds: 0, end_seconds: 6 }] }

  it('★ 认「context.scenes 是 scene_plan 对象」这一形态（本仓阶段名叫 scenes ⇒ 产物落在这里）', () => {
    const src = resolveSceneSource({ scenes: planObject })
    expect(src.legacy).toBe(false)
    expect(src.scenes).toHaveLength(2)
    expect(src.plan).toBe(planObject)
  })

  it('认「context.scene_plan 是对象」这一形态（按上游阶段名对齐的键）', () => {
    const src = resolveSceneSource({ scene_plan: planObject })
    expect(src.legacy).toBe(false)
    expect(src.scenes).toHaveLength(2)
  })

  it('认「context.scenes 是旧形态数组」这一形态（断点续跑的旧 run 上下文）', () => {
    const legacy = [{ prompt: 'p1', text: 't1', duration: 6 }]
    const src = resolveSceneSource({ scenes: legacy })
    expect(src.legacy).toBe(true)
    expect(src.scenes).toEqual(legacy)
  })

  it('★ assets 适配：context.scenes 是对象形态时也要能取出场景并组装提示词', () => {
    const adapted = adaptScenesForAssets({ scenes: planObject, script }, { imageStyle: 'cinematic' })
    expect(adapted.scenes).toHaveLength(2)
    expect(adapted.scenes[0].prompt).toContain('镜头：medium')
    expect(adapted.scenes[0].text).toContain('第一段')
  })

  it('★ asset_manifest → 内置 compose 的旧形态（消费点适配）', () => {
    const manifest = {
      version: '1.0',
      assets: [
        { id: 'asset-scene-1-image', type: 'image', path: '/a1.png', source_tool: 'sd', scene_id: 'scene-1' },
        { id: 'asset-scene-1-narration', type: 'narration', path: '/a1.mp3', source_tool: 'tts', scene_id: 'scene-1', duration_seconds: 5.8 },
        { id: 'asset-scene-2-image', type: 'image', path: '/a2.png', source_tool: 'sd', scene_id: 'scene-2' },
        { id: 'asset-scene-2-narration', type: 'narration', path: '/a2.mp3', source_tool: 'tts', scene_id: 'scene-2', duration_seconds: 7.6 },
      ],
      total_cost_usd: 0,
    }
    const legacy = assetManifestToLegacyScenes(manifest, planObject, script)
    expect(legacy).toHaveLength(2)
    expect(legacy[0].imagePath).toBe('/a1.png')
    expect(legacy[0].audioPath).toBe('/a1.mp3')
    // ⚠ duration 取**旁白真实时长**（不是计划时长）⇒ 内置 compose 按实际音频对齐
    expect(legacy[0].duration).toBe(5.8)
    expect(legacy[0].text).toContain('第一段')
  })

  it('★ compose 输出必须保留原始 videoPath（内置 publish 阶段从 context.compose 读它）', () => {
    const merged = composeOutputWithArtifacts(
      { videoPath: '/tmp/out.mp4', fileSize: 123, segmentCount: 2, duration: 20 },
      { version: '1.0', outputs: [] },
      { version: '1.0', status: 'pass' },
    )
    expect(merged.videoPath).toBe('/tmp/out.mp4')
    expect(merged.fileSize).toBe(123)
    expect(merged.render_report).toBeTruthy()
    expect(merged.final_review).toBeTruthy()
  })
})
