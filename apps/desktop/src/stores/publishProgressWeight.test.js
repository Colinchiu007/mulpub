/**
 * publishProgressWeight.test.js — 聚合进度软权重的行为锁 + 接线锁（UX 审计 2.5 / audit-14）
 *
 * audit-14 的现场形态：`aggregate.done` 只在终态累加 ⇒ 发 1 篇 3 分钟期间进度条**恒定 0%**。
 * 本文件测两件事：① 纯逻辑本身（权重、封顶、序号、口径不污染）；
 * ② **接线** —— store 真的把摊平后的任务交给了 summarize，而不是自己另算一份
 *   （「注册≠注入≠生效」是本仓反复出现的形状，所以这里既读源码也跑真实 store）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  summarize,
  taskWeight,
  STAGE_WEIGHTS,
  UNKNOWN_STAGE_WEIGHT,
  RUNNING_CEILING,
  RUNNING_PERCENT_CEILING,
} from './publishProgressWeight'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('taskWeight · 单个任务贡献多少权重', () => {
  it('终态一律满权重（与汇总行的「成功 N」同口径）', () => {
    expect(taskWeight({ phase: 'success' })).toBe(1)
    expect(taskWeight({ phase: 'failed' })).toBe(1)
    expect(taskWeight({ phase: 'cancelled' })).toBe(1)
  })

  it('queued 是 0：排队中的任务没开始，不能替它编进度', () => {
    expect(taskWeight({ phase: 'queued', stageKey: 'detail' })).toBe(0)
  })

  it('percent 优先于 stageKey，且被封顶到 RUNNING_CEILING —— 条子满了但还没成功，比条子不动更糟', () => {
    expect(taskWeight({ phase: 'progress', percent: 40, stageKey: 'upload' })).toBe(0.4)
    expect(taskWeight({ phase: 'progress', percent: 100, stageKey: 'upload' })).toBe(RUNNING_CEILING)
  })

  it('percent 缺席时退回阶段软权重；未知阶段给中位值而不是 0（否则新阶段又变成"条不动"）', () => {
    expect(taskWeight({ phase: 'progress', stageKey: 'upload' })).toBe(STAGE_WEIGHTS.upload)
    expect(taskWeight({ phase: 'progress', stageKey: 'brand_new_stage' })).toBe(UNKNOWN_STAGE_WEIGHT)
  })

  it('percent 非法值（NaN / 负数 / 超 100）不得把权重算成 NaN 或 >1', () => {
    expect(taskWeight({ phase: 'progress', percent: NaN, stageKey: 'upload' })).toBe(STAGE_WEIGHTS.upload)
    expect(taskWeight({ phase: 'progress', percent: -5 })).toBe(0)
    expect(taskWeight({ phase: 'progress', percent: 500 })).toBe(RUNNING_CEILING)
  })

  it('输入退化（null / undefined / 非对象）返回 0 且不抛错', () => {
    expect(taskWeight(null)).toBe(0)
    expect(taskWeight(undefined)).toBe(0)
    expect(taskWeight('x')).toBe(0)
  })

  it('阶段权重表必须单调不减且落在 (0,1] —— 倒挂会让进度条倒退', () => {
    const order = ['prepare', 'detail', 'upload', 'fill', 'submit', 'verify', 'waiting', 'released']
    let prev = 0
    for (const key of order) {
      expect(STAGE_WEIGHTS[key], '缺少阶段 ' + key).toBeTypeOf('number')
      expect(STAGE_WEIGHTS[key] >= prev, '阶段 ' + key + ' 权重比前一小').toBe(true)
      prev = STAGE_WEIGHTS[key]
    }
    expect(prev).toBeLessThan(1)
  })
})

describe('summarize · 摊平后的任务数组汇总成一条进度', () => {
  it('audit-14 的直接反证：单任务在跑（percent 30）时百分比必须是 30，不再是 0', () => {
    const r = summarize([{ phase: 'progress', percent: 30, stageKey: 'upload' }])
    expect(r.total).toBe(1)
    expect(r.done).toBe(0)
    expect(r.percent, '旧口径在这里返回 0 —— 那正是用户判断不了"在跑还是卡了"的原因').toBe(30)
  })

  it('全部终态 ⇒ 100%；还有任何非终态 ⇒ 严格小于 100%，且封顶 99%', () => {
    expect(summarize([{ phase: 'success', percent: 100 }]).percent).toBe(100)
    // 唯一在跑的任务即使报 percent=100，整体也显示不到 100（1 + 0.95 摊到 2 个 ⇒ 98%）
    const near = summarize([
      { phase: 'success', percent: 100 },
      { phase: 'progress', percent: 100 },
    ])
    expect(near.weighted).toBe(1.95)
    expect(near.percent, '还有非终态任务却显示 100% ⇒ 用户会以为已经发完了').toBeLessThan(100)
    expect(near.percent).toBe(98)
    // 让四舍五入自己够到 100 的那一档：99 个终态 + 1 个 0.95 ⇒ 99.95 → round 100 → 必须被夹回 99
    const many = summarize([
      ...Array.from({ length: 99 }, () => ({ phase: 'success', percent: 100 })),
      { phase: 'progress', percent: 100 },
    ])
    expect(many.percent, '夹取失效 ⇒ 运行中却报"全部完成"').toBe(RUNNING_PERCENT_CEILING)
  })

  it('终态计数口径不得被软权重污染（汇总行的「成功 N」是用户核对结果的依据）', () => {
    const r = summarize([
      { phase: 'success', percent: 100 },
      { phase: 'failed', percent: 100 },
      { phase: 'cancelled', percent: 100 },
      { phase: 'progress', percent: 50 },
      { phase: 'queued' },
    ])
    expect(r).toMatchObject({ total: 5, done: 3, succeeded: 1, failed: 1, cancelled: 1, running: 2 })
    // 3×1 + 0.5 + 0 = 3.5 ⇒ 70%
    expect(r.weighted).toBe(3.5)
    expect(r.percent).toBe(70)
  })

  it('currentIndex 是 1-based 的「第一个非终态」序号，queued 也算在内；全终态时为 0', () => {
    expect(summarize([
      { phase: 'success', percent: 100 },
      { phase: 'queued' },
      { phase: 'progress', percent: 20 },
    ]).currentIndex).toBe(2)
    expect(summarize([{ phase: 'success', percent: 100 }]).currentIndex).toBe(0)
    expect(summarize([]).currentIndex).toBe(0)
  })

  it('输入退化（非数组 / 空数组）返回全零形状而不是抛错', () => {
    for (const bad of [null, undefined, {}, 'x']) {
      const r = summarize(bad)
      expect(r).toMatchObject({ total: 0, done: 0, weighted: 0, percent: 0, currentIndex: 0 })
    }
  })

  it('percent 随权重单调：同一批任务，在跑的那个越往后，整体百分比不得变小', () => {
    const at = (p) => summarize([{ phase: 'success', percent: 100 }, { phase: 'progress', percent: p }]).percent
    expect(at(10)).toBeLessThanOrEqual(at(40))
    expect(at(40)).toBeLessThanOrEqual(at(90))
  })
})

describe('接线：store 与面板必须消费这份实现', () => {
  const storeSrc = readFileSync(join(HERE, 'publishProgress.js'), 'utf8').replace(/\r\n/g, '\n')
  const panelSrc = readFileSync(join(HERE, '..', 'components', 'PublishProgressPanel.vue'), 'utf8').replace(/\r\n/g, '\n')

  it('store 的 aggregate 走 summarize，且不再自带第二份 done/total 累加', () => {
    expect(storeSrc).toMatch(/import \{ summarize \} from '\.\/publishProgressWeight'/)
    expect(storeSrc).toMatch(/const aggregate = computed\(\(\) =>\s*\n?\s*summarize\(/)
    // 反向：旧的逐个累加写法不得复活（两处都算就会漂移）
    expect(storeSrc, 'aggregate 里又出现手工累加 ⇒ 与纯逻辑两份口径').not.toMatch(/let succeeded = 0/)
  })

  it('面板不得再自己 `done / total` 算百分比（那正是 audit-14 的形态）', () => {
    expect(panelSrc).toMatch(/store\.aggregate\.percent/)
    expect(panelSrc, '模板里仍在除 done/total ⇒ 与 aggregate.percent 口径分裂').not.toMatch(/done \/ .*total/)
  })

  it('aria-valuenow 与进度条宽度必须取同一个数（读屏播报与视觉不得各算一份）', () => {
    expect(panelSrc).toMatch(/:aria-valuenow="progressPercent"/)
    expect(panelSrc).toMatch(/const progressWidth = computed\(\(\) => progressPercent\.value \+ '%'\)/)
  })

  it('「第 N / 共 M」文案键必须 zh/en 成对存在（Gate 7 对拆分 locale 文件失明，只能自己钉）', () => {
    const zh = readFileSync(join(HERE, '..', 'locales', 'publish-page', 'zh.js'), 'utf8')
    const en = readFileSync(join(HERE, '..', 'locales', 'publish-page', 'en.js'), 'utf8')
    expect(zh).toMatch(/summaryPosition: \(ctx\) =>/)
    expect(en).toMatch(/summaryPosition: \(ctx\) =>/)
    // 两份都必须是插值形态，不得把序号写死进文案
    expect(zh).toMatch(/summaryPosition[\s\S]{0,120}?index[\s\S]{0,80}?total/)
    expect(en).toMatch(/summaryPosition[\s\S]{0,120}?index[\s\S]{0,80}?total/)
  })
})
