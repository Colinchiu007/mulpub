// @ts-check
'use strict'
/**
 * 影视工程 v2 · F-A「分镜提示词三分」契约测试
 *
 * 覆盖跨 5 个模块的一条链：
 *   kit-loader（归一化 + 合计上限）→ script-adapt（拼装逐字不变 + 运动子集）
 *   → auto-plan（派生三分）→ auto-project（落盘）→ video-gen / film-engineering-service（消费）
 *
 * 为什么单独成文件：这条契约**横跨 5 个模块**，拆进各自的测试文件会让「三分在链路上没有断点」
 * 这件事无人负责（跨模块契约没有归属单元）。仓内已有同型先例：
 * `film-engineering-adapt-contract.test.js`、`film-pipeline-contract.test.js`。
 *
 * 测试固定使用 os.tmpdir() 下随机隔离目录，禁止触碰仓库内共享文件。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { loadFilmKit } = require('./kit-loader')
const { FILM_PROMPT_BUNDLE_MAX_LEN, SHOT_PROMPT_FIELDS } = require('./shot-prompts')
const { buildTemplatePrompt, buildTemplatePromptParts, buildMotionPrompt } = require('./script-adapt')
const { planAutoShots } = require('./auto-plan')
const { buildShotSubmitPayload } = require('./video-gen')
const { createProject } = require('./auto-project')

const UUID = '3caa2f3a-52b5-4293-9237-0c8f76c7158a'

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'film-triple-test-'))
}

function makeKit (shots) {
  return {
    manifest: {
      schemaVersion: 1,
      filmMeta: {
        title: 'Film Project Case',
        durationSec: 5706,
        logline: 'Street kids gain powers to fight ancient evil.',
        characters: [{ name: 'ROKO', descriptor: 'Determined street kid' }],
      },
      scenes: [
        { id: 'cold-open', name: '1. COLD OPEN', count: 12, parentId: null, level: 0 },
        { id: 'scene-25', name: 'Scene 25', count: 4555, parentId: null, level: 0 },
      ],
    },
    shots: shots || [
      {
        shotId: '11111111-1111-4111-8111-111111111111',
        sceneId: 'scene-25',
        prompt: 'EXT. CITY STREET - NIGHT\n[CHARACTER: ROKO] runs toward camera.\nGEO SPATIAL LAYOUT: ...',
        model: 'seedance_2_0',
        refTokens: [UUID],
      },
    ],
    references: { [UUID]: { kind: 'character', name: 'ROKO', imageUrls: ['https://cdn.example.com/roko.png'] } },
    doctrine: {
      blocks: [{ key: 'geo_spatial_layout', label: 'GEO SPATIAL LAYOUT', zh: '地理空间布局', en: 'Geo spatial layout' }],
      rules: [{ key: 'batch-10-15', title: 'Batch iteration 10-15', zh: '批量迭代 10-15 法则', en: 'Batch 10-15 rule' }],
      glossary: [{ term: 'seedance', zh: '种子舞', en: 'Seedance' }],
    },
  }
}

function writeKit (dir, kit) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'film-manifest.json'), JSON.stringify(kit.manifest))
  fs.writeFileSync(path.join(dir, 'shot-library.json'), JSON.stringify(kit.shots))
  fs.writeFileSync(path.join(dir, 'reference-registry.json'), JSON.stringify(kit.references))
  fs.writeFileSync(path.join(dir, 'prompt-doctrine.json'), JSON.stringify(kit.doctrine))
}

describe('F-A · kit 归一化：三分提示词', () => {
  it('存量分镜（只有 prompt）归一化为 imagePrompt=prompt、videoPrompt=空、endFramePrompt=空', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit())
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(true)
    const shot = r.kit.shots[0]
    expect(shot.imagePrompt).toBe(shot.prompt)
    expect(shot.videoPrompt).toBe('')
    expect(shot.endFramePrompt).toBe('')
    // 旧字段一个都不动（既有消费方零改动）
    expect(shot.prompt).toBe('EXT. CITY STREET - NIGHT\n[CHARACTER: ROKO] runs toward camera.\nGEO SPATIAL LAYOUT: ...')
  })

  it('显式给了三分就不被归一化覆盖', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit([{
      shotId: '22222222-2222-4222-8222-222222222222',
      sceneId: 'scene-25',
      prompt: '旧提示词',
      imagePrompt: '首帧图提示词',
      videoPrompt: '视频运动提示词',
      endFramePrompt: '尾帧约束',
      model: 'seedance_2_0',
    }]))
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(true)
    expect(r.kit.shots[0].imagePrompt).toBe('首帧图提示词')
    expect(r.kit.shots[0].videoPrompt).toBe('视频运动提示词')
    expect(r.kit.shots[0].endFramePrompt).toBe('尾帧约束')
  })

  it('三分合计超上限 → fail-closed（不静默截断），错误文案含实测长度与上限', () => {
    const dir = tmpDir()
    const half = 'x'.repeat(Math.floor(FILM_PROMPT_BUNDLE_MAX_LEN / 2) + 10)
    writeKit(dir, makeKit([{
      shotId: '33333333-3333-4333-8333-333333333333',
      sceneId: 'scene-25',
      prompt: '旧提示词',
      imagePrompt: half,
      videoPrompt: half,
      endFramePrompt: half,
      model: 'seedance_2_0',
    }]))
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('三分提示词合计')
    expect(r.error).toContain(String(FILM_PROMPT_BUNDLE_MAX_LEN))
  })

  it('三分字段类型非法（非字符串）→ fail-closed', () => {
    const dir = tmpDir()
    writeKit(dir, makeKit([{
      shotId: '44444444-4444-4444-8444-444444444444',
      sceneId: 'scene-25',
      prompt: '旧提示词',
      imagePrompt: 123,
      model: 'seedance_2_0',
    }]))
    const r = loadFilmKit({ kitDir: dir })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('imagePrompt 必须为字符串')
  })

  it('三分字段名只有三份（与合计口径同一份真源）', () => {
    expect(SHOT_PROMPT_FIELDS).toEqual(['imagePrompt', 'videoPrompt', 'endFramePrompt'])
  })
})

describe('F-A · 拼装：首帧图提示词逐字不变 + 运动子集', () => {
  const template = {
    prompt: [
      'EXT. CITY STREET - NIGHT',
      '[CHARACTER: ROKO] stands still.',
      '',
      'GEO SPATIAL LAYOUT:',
      '- STREET: wet asphalt, left.',
      '',
      'ACTION TIMING:',
      '[0-3s] He raises his fist.',
    ].join('\n'),
  }

  it('buildTemplatePrompt 的输出是**期望字面量**（零回归锁：不靠抄第二份实现来对比）', () => {
    const out = buildTemplatePrompt({ template, beatText: '小强握紧拳头。', characterMap: { ROKO: '小强' } })
    expect(out).toBe([
      'EXT. CITY STREET - NIGHT',
      '小强握紧拳头。',
      '[CHARACTER: ROKO] stands still.（小强）',
      'GEO SPATIAL LAYOUT:\n- STREET: wet asphalt, left.',
      'ACTION TIMING:\n[0-3s] He raises his fist.',
    ].join('\n\n'))
  })

  it('运动子集 = 场景头 + 剧情 + 角色行 + 运动块，去掉空间/音频/约束等静态块', () => {
    const motion = buildMotionPrompt({ template, beatText: '小强握紧拳头。', characterMap: { ROKO: '小强' } })
    expect(motion).toContain('ACTION TIMING')
    expect(motion).toContain('小强握紧拳头。')
    expect(motion).not.toContain('GEO SPATIAL LAYOUT')
    expect(motion.length).toBeLessThan(buildTemplatePrompt({ template, beatText: '小强握紧拳头。', characterMap: { ROKO: '小强' } }).length)
  })

  it('零件分类：静态块进 staticParts、运动块进 motionParts', () => {
    const parts = buildTemplatePromptParts({ template, beatText: '小强握紧拳头。', characterMap: {} })
    expect(parts.staticParts.join('\n')).toContain('GEO SPATIAL LAYOUT')
    expect(parts.motionParts.join('\n')).toContain('ACTION TIMING')
  })
})

describe('F-A · 自动模式派生三分', () => {
  const TEMPLATES = [{
    shotId: '11111111-1111-4111-8111-111111111111',
    sceneId: 'scene-25',
    prompt: [
      'EXT. CITY STREET - NIGHT',
      '[CHARACTER: ROKO] stands still.',
      '',
      'GEO SPATIAL LAYOUT:',
      '- STREET: wet asphalt, left, long.',
      '',
      'ACTION TIMING:',
      '[0-3s] He raises his fist.',
    ].join('\n'),
    model: 'seedance_2_0',
  }]
  const baseArgs = {
    script: '小强握紧拳头。\n\n他猛地转身。',
    characterMap: { ROKO: '小强' },
    aspect: '16x9',
    seconds: 5,
    targetDurationSec: 10,
    templateShots: TEMPLATES,
    providerId: 'minimax',
  }

  it('imagePrompt 与 prompt **逐字相同**（图片生成零回归）', () => {
    const r = planAutoShots(baseArgs)
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect(s.imagePrompt).toBe(s.prompt)
      expect(s.imagePrompt.length).toBeGreaterThan(0)
    }
  })

  it('videoPrompt 非空且剔除了静态块', () => {
    const r = planAutoShots(baseArgs)
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect(typeof s.videoPrompt).toBe('string')
      expect(s.videoPrompt.length).toBeGreaterThan(0)
      expect(s.videoPrompt).not.toContain('GEO SPATIAL LAYOUT')
    }
  })

  it('endFramePrompt 本批次留空（派生随 F-I 落地，消费侧不发送）', () => {
    const r = planAutoShots(baseArgs)
    expect(r.ok).toBe(true)
    for (const s of r.shots) expect(s.endFramePrompt).toBe('')
  })
})

describe('F-A · 真实 kit 的派生比例（实测口径，不是拍脑袋的阈值）', () => {
  const KIT = path.resolve(__dirname, '../../film-kit/shot-library.json')

  it('全部真实模板的派生视频提示词总量 ≤ 首帧图提示词总量的 0.6 倍', () => {
    if (!fs.existsSync(KIT)) return
    const shots = JSON.parse(fs.readFileSync(KIT, 'utf8'))
    const beat = '小强握紧拳头。'
    let sumFull = 0
    let sumMotion = 0
    for (const tpl of shots) {
      const full = buildTemplatePrompt({ template: tpl, beatText: beat, characterMap: {} })
      const motion = buildMotionPrompt({ template: tpl, beatText: beat, characterMap: {} })
      sumFull += full.length
      sumMotion += motion.length
    }
    // 实测 0.177（2026-10-21，153 个真实模板）⇒ 0.6 留足余量，
    // 同时不是「严格小于」这种能被差 1 字符满足的判据。
    expect(sumFull).toBeGreaterThan(0)
    expect(sumMotion / sumFull).toBeLessThanOrEqual(0.6)
  })
})

describe('F-A · 消费侧：视频走 videoPrompt，图片走 imagePrompt', () => {
  it('视频提交优先用 videoPrompt', () => {
    const payload = buildShotSubmitPayload({
      shot: { shotId: 's1', prompt: '旧提示词', imagePrompt: '首帧图提示词', videoPrompt: '视频运动提示词' },
      aspect: '16x9', seconds: 5, model: 'mv-1',
    })
    expect(payload.prompt).toBe('视频运动提示词')
  })

  it('videoPrompt 为空时回落 imagePrompt（存量分镜路径）', () => {
    const payload = buildShotSubmitPayload({
      shot: { shotId: 's1', prompt: '旧提示词', imagePrompt: '首帧图提示词', videoPrompt: '' },
      aspect: '16x9', seconds: 5, model: 'mv-1',
    })
    expect(payload.prompt).toBe('首帧图提示词')
  })

  it('三分都空时回落旧 prompt（老项目文件仍能跑）', () => {
    const payload = buildShotSubmitPayload({
      shot: { shotId: 's1', prompt: '旧提示词' },
      aspect: '16x9', seconds: 5, model: 'mv-1',
    })
    expect(payload.prompt).toBe('旧提示词')
  })
})

describe('F-A · 项目文件落盘：派生结果不能丢', () => {
  it('createProject 把三分写进项目文件（否则续跑时派生结果消失）', () => {
    const home = tmpDir()
    const project = createProject({
      home,
      taskId: 'task-triple',
      now: '2026-10-21T00:00:00.000Z',
      plan: {
        planId: 'plan-1',
        aspect: '16x9',
        seconds: 5,
        targetDurationSec: 10,
        providerId: 'minimax',
        characterMap: {},
        shots: [{
          index: 0,
          shotId: 'auto-000',
          title: '镜 1',
          prompt: '旧提示词',
          imagePrompt: '首帧图提示词',
          videoPrompt: '视频运动提示词',
          endFramePrompt: '尾帧约束',
          characterNames: [],
          refPaths: [],
          seconds: 5,
        }],
      },
    })
    // createProject 直接返回项目文件（不是 {ok, project} 包装）
    expect(project.ok).toBeUndefined()
    expect(project.taskId).toBe('task-triple')
    const shot = project.shots[0]
    expect(shot.imagePrompt).toBe('首帧图提示词')
    expect(shot.videoPrompt).toBe('视频运动提示词')
    expect(shot.endFramePrompt).toBe('尾帧约束')
  })
})
