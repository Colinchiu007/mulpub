// @ts-check
'use strict'
/**
 * auto-plan 的单镜时长契约测试（从 auto-plan.test.js 拆出，见债务预算 FILES_OVER_500）
 * 覆盖：F2/F34 增量字段 / W9 聚合可见性 / 无引号动作文案退档位 / 缺省档位与能力同源
 */
const { planAutoShots } = require('./auto-plan')

// ===== v7 批次一 F2 + F34：单镜时长与来源优先级（纯增量，不动既有 seconds 语义）=====

describe('planAutoShots: durationMs 增量字段（F2 + F34）', () => {
  const withScript = (script, extra = {}) => planAutoShots({
    script,
    characterRefs: [],
    sceneRefs: [],
    aspect: '16x9',
    seconds: 5,
    targetDurationSec: 20,
    templateShots: [{ prompt: 'T1' }],
    ...extra,
  })

  it('每镜都带 durationMs / durationSec / durationSource', () => {
    const r = withScript('第一场\n他推开门走了进来。')
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect(Number.isFinite(s.durationMs)).toBe(true)
      expect(s.durationMs).toBeGreaterThan(0)
      expect(s.durationSec).toBe(s.durationMs / 1000)
      expect(['formula', 'tier', 'tts', 'user']).toContain(s.durationSource)
    }
  })

  it('既有 seconds 语义不变（下游消费方不受影响）', () => {
    const r = withScript('第一场\n他推开门走了进来。')
    expect(r.ok).toBe(true)
    for (const s of r.shots) expect(s.seconds).toBe(5)
  })

  it('plannedDurationSec 仍是档位基线（不因增量字段而改变）', () => {
    const r = withScript('第一场\n他推开门走了进来。')
    expect(r.ok).toBe(true)
    expect(r.plannedDurationSec).toBe(r.shots.length * 5)
  })

  it('estimatedDurationSec 是逐镜 durationMs 之和（允许 0.1s 取整）', () => {
    const r = withScript('第一场\n短句。\n\n第二场\n这是一句明显更长的台词，字数多了不少。')
    expect(r.ok).toBe(true)
    const sum = r.shots.reduce((a, s) => a + s.durationMs, 0) / 1000
    expect(Math.abs(r.estimatedDurationSec - sum)).toBeLessThan(0.15)
  })

  it('长文案镜与短文案镜的推算时长不同（说明时长真的按台词算了）', () => {
    // N=2（10s / 5s）才能保证两个 beat 各占一镜、不被均分稀释
    const r = planAutoShots({
      script: '第一场\n他说：「' + '这是一句特别长的台词'.repeat(8) + '」\n\n第二场\n她说：「短。」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.shots.length).toBe(2)
    const durations = new Set(r.shots.map((s) => s.durationMs))
    expect(durations.size).toBeGreaterThan(1)
    // 长台词那镜必须比短句那镜长
    expect(Math.max(...r.shots.map((s) => s.durationMs))).toBeGreaterThan(Math.min(...r.shots.map((s) => s.durationMs)))
  })

  it('durationSourceCount 汇总与逐镜来源一致', () => {
    const r = withScript('第一场\n他推开门。\n\n第二场\n她抬起头。')
    expect(r.ok).toBe(true)
    const counted = r.shots.filter((s) => s.durationSource === 'formula').length
    expect(r.durationSourceCount.formula).toBe(counted)
  })

  it('estimates.estimatedDurationSec 与顶层字段一致', () => {
    const r = withScript('第一场\n他推开门。')
    expect(r.ok).toBe(true)
    expect(r.estimates.estimatedDurationSec).toBe(r.estimatedDurationSec)
  })
})

// ===== v7 对抗评审 i1：逐镜时长警告必须聚合进 plan.warnings =====

describe('planAutoShots: 时长警告可见（i1）', () => {
  it('逐镜时长警告聚合为 W9，不再只藏在 shots[].durationWarnings', () => {
    // 单镜塞进远超 10s 档位的台词量
    const r = planAutoShots({
      script: '第一场\n他说：「' + '这是一句特别长的台词'.repeat(10) + '。」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    const w9 = r.warnings.find((w) => w.code === 'W9')
    expect(w9).toBeTruthy()
    expect(w9.message).toContain('#')
  })

  it('无时长警告时不产生 W9（防恒真告警）', () => {
    const r = planAutoShots({
      script: '第一场\n他说：「好。」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.code)).not.toContain('W9')
  })

  it('逐镜带 durationRawSec，便于调用方展示吸附落差', () => {
    const r = planAutoShots({
      script: '第一场\n他说：「一二三四五六七八九十。」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect(s.durationRawSec === null || Number.isFinite(s.durationRawSec)).toBe(true)
    }
  })

  it('durationTiers 可注入（i3：kit 可成为运行时事实源）', () => {
    const r = planAutoShots({
      script: '第一场\n他推开门。',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 20,
      durationTiers: [5, 8, 10, 12],
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect([5, 8, 10, 12]).toContain(s.durationSec)
    }
  })
})

// ===== v7 对抗评审第二轮 =====

describe('planAutoShots: 无引号动作文案走档位兜底（i4）', () => {
  const run = (script) => planAutoShots({
    script,
    characterRefs: [],
    sceneRefs: [],
    aspect: '16x9',
    seconds: 5,
    targetDurationSec: 10,
    templateShots: [{ prompt: 'T1' }],
  })

  it('纯动作描述（无引号）不按字/秒折算，走 tier', () => {
    const r = run('第一场\n他缓慢地推开门走进屋子环顾四周然后停在窗前凝视着外面连绵不断的雨夜和远处的灯火')
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect(s.durationSource).toBe('tier')
      expect(s.durationSec).toBe(5)
    }
  })

  it('带引号才走 formula', () => {
    const r = run('第一场\n他缓慢地推开门走进屋子，低声说：「你终于来了。」')
    expect(r.ok).toBe(true)
    expect(r.shots[0].durationSource).toBe('formula')
  })

  it('无引号时给出可操作提示（告知如何标注台词）', () => {
    const r = run('第一场\n他推开门走进屋子环顾四周')
    expect(r.ok).toBe(true)
    const w = (r.shots[0].durationWarnings || []).join()
    expect(w).toContain('未检出引号台词')
    expect(w).toContain('「」')
  })

  it('无引号的长动作镜不再触发「必须拆解台词」（i4 的核心）', () => {
    const r = run('第一场\n' + '他缓慢地推开门走进屋子环顾四周然后停在窗前凝视'.repeat(6))
    expect(r.ok).toBe(true)
    const w9 = r.warnings.find((w) => w.code === 'W9')
    expect(w9).toBeUndefined()
  })
})

describe('planAutoShots: 默认档位与模型能力同源（i3 第二轮）', () => {
  it('缺省档位来自 shot-duration DEFAULT_TIERS（含 12s），而不是输入白名单', () => {
    const r = planAutoShots({
      script: '第一场\n他说：「' + '一二三四五六七八九十'.repeat(9) + '」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.shots[0].durationSec).toBe(12)
  })

  it('注入档位仍优先', () => {
    const r = planAutoShots({
      script: '第一场\n他说：「' + '一二三四五六七八九十'.repeat(9) + '」',
      characterRefs: [], sceneRefs: [], aspect: '16x9', seconds: 5, targetDurationSec: 10,
      durationTiers: [5, 10],
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.shots[0].durationSec).toBe(10)
  })
})
