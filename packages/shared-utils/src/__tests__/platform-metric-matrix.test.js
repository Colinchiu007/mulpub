/**
 * platform-metric-matrix 的测试。
 *
 * 被测：packages/shared-utils/src/platform-metric-matrix.js
 * 数据：config/platform-metric-matrix.json（由 scripts/import-platform-metric-matrix.js 产出）
 *
 * 设计要点（每条都对应一个已知失败模式）：
 *  ① **二维结构**：段 [1] 与段 [2] 同名不同义（段1 的 id=1 是「总收益」，段2 的 id=1 是「收益」）。
 *     压成一维会让两者互相覆盖 —— 断言必须按 group 分别查。
 *  ② **三态查询**：必须区分「平台没这指标」与「我们不知道这个平台」。
 *     压成 boolean 会让二者在 UI 上都显示成「无」。**变体反证见文末。**
 *  ③ **未收录平台返回 `[]` 而非 `null`** —— 调用方可以直接 for。
 *  ④ **fail-loud**：文件缺失 / JSON 非法 / schemaVersion 不认识一律抛，不返回空表
 *     （静默退化会让 UI 显示「所有平台都没有指标」）。
 *  ⑤ `undeclared-but-present` **不是错误**：厂商矩阵是他们的能力边界，本仓实测优先。
 *
 * 用法: npx vitest run packages/shared-utils/src/__tests__/platform-metric-matrix.test.js
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
// 读取层是 CJS：用 createRequire 拿真实的 module.exports，避免 ESM/CJS 命名导出探测的差异
const M = require('../platform-metric-matrix.js')

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..')
const REAL_PATH = path.join(REPO_ROOT, 'config', 'platform-metric-matrix.json')

beforeEach(() => {
  M.__clearMatrixOverrideForTest()
})
afterEach(() => {
  M.__clearMatrixOverrideForTest()
})

describe('platform-metric-matrix — 产物与结构', () => {
  it('产物存在且 validateMatrix() 通过', () => {
    expect(fs.existsSync(REAL_PATH)).toBe(true)
    expect(M.validateMatrix()).toEqual([])
  })

  it('★ 段 [1] 与段 [2] 同名不同义 —— 必须是二维结构', () => {
    const m = M.loadMatrix()
    expect(m.groups['1'].key).toBe('content')
    expect(m.groups['2'].key).toBe('trend')
    // 同一个 raw id=1，在两段里是不同指标
    expect(m.groups['1'].metrics['1']).toBe('总收益')
    expect(m.groups['2'].metrics['1']).toBe('收益')
    expect(m.groups['1'].metrics['1']).not.toBe(m.groups['2'].metrics['1'])
    // 段 [1] 有 11 项、段 [2] 有 7 项，数量都不同 ⇒ 一维必错
    expect(Object.keys(m.groups['1'].metrics)).toHaveLength(11)
    expect(Object.keys(m.groups['2'].metrics)).toHaveLength(7)
  })

  it('两段的本仓平台覆盖一致，但**指标映射不同** —— 这才是二维的第二重理由', () => {
    const m = M.loadMatrix()
    const ids1 = Object.keys(m.groups['1'].platforms).sort()
    const ids2 = Object.keys(m.groups['2'].platforms).sort()
    // 实测：源文件段[1]有 31 个厂商平台、段[2]只有 27 个（覆盖**整体**不同），
    // 但**本仓支持的这 10 个在两段都出现**。所以「覆盖不同」不能作为本子集的理由 ——
    // 二维的第二重理由是 metricKeyMap 按段不同（同一个 raw id 映射到不同 metric key）。
    expect(ids1).toEqual(ids2)
    expect(m.groups['1'].platforms.baijiahao).not.toEqual(m.groups['2'].platforms.baijiahao)
    // 断言源侧的整体覆盖差异如实记录在 source 里（不静默丢弃）
    expect(m.source.unmappedCount).toBeGreaterThan(0)
  })

  it('metricKeyMap 按段分开，同一个 raw id 在两段映射到不同 key', () => {
    const m = M.loadMatrix()
    // 段[1] id=1 是「总收益」→ income；段[2] id=1 是「收益」→ income（名字相同但语义同源）
    // 关键反例：段[1] id=3 是「图文总阅读数」→ readTotal；段[2] id=3 是「播放」→ play
    expect(m.metricKeyMap['1']['3']).toBe('readTotal')
    expect(m.metricKeyMap['2']['3']).toBe('play')
    expect(m.metricKeyMap['1']['3']).not.toBe(m.metricKeyMap['2']['3'])
  })

  it('tencent_video 取厂商 53（视频号）而非 21（腾讯视频）', () => {
    const m = M.loadMatrix()
    // 视频号 [1] = 6,7,8,9,10,11；腾讯视频 [1] = 1,6,7 —— 用厂商 id 反查断言
    expect(m.groups['1'].platforms.tencent_video).toEqual(['6', '7', '8', '9', '10', '11'])
    expect(m.groups['2'].platforms.tencent_video).toEqual(['3', '4', '5', '6', '7'])
  })

  it('源为冻结快照：如实标注未映射的厂商平台，不静默丢弃', () => {
    const m = M.loadMatrix()
    expect(m.source.kind).toBe('vendor-ini')
    expect(m.source.unmappedCount).toBeGreaterThan(0)
    expect(m.source.unmappedVendorPlatforms.length).toBe(m.source.unmappedCount)
    // 21（腾讯视频）应出现在未映射清单里 —— 我们是视频号，不是腾讯视频
    expect(m.source.unmappedVendorPlatforms.map((x) => x.vendorPlatformId)).toContain(21)
  })
})

describe('platform-metric-matrix — getPlatformMetricCapabilities', () => {
  it('已收录平台返回带 group 的条目', () => {
    const caps = M.getPlatformMetricCapabilities('baijiahao')
    expect(caps.length).toBeGreaterThan(0)
    expect(caps[0]).toHaveProperty('metricKey')
    expect(caps[0]).toHaveProperty('label')
    expect(['content', 'trend']).toContain(caps[0].group)
  })

  it('★ 未收录平台返回 [] 而不是 null', () => {
    const caps = M.getPlatformMetricCapabilities('not-a-platform')
    expect(caps).toEqual([])
    expect(caps).not.toBeNull()
    expect(Array.isArray(caps)).toBe(true)
  })

  it('每一维都带 group 区分（二维没有被压平）', () => {
    const caps = M.getPlatformMetricCapabilities('baijiahao')
    const groups = new Set(caps.map((c) => c.group))
    expect(groups.has('content')).toBe(true)
    expect(groups.has('trend')).toBe(true)
  })
})

describe('platform-metric-matrix — getMetricSupport 三态', () => {
  it('① 快手未声明 income ⇒ declared-unavailable', () => {
    // 源：快手 [1] = 6,7,8,9,10,11 —— 不含 1（总收益），而 baijiahao 含全 11 项。
    // 这一条与下一条正好构成「声明有 / 声明无」的两侧对照。
    expect(M.getMetricSupport('kuaishou', 'income')).toBe('declared-unavailable')
  })

  it('② 百家号声明的 income ⇒ declared-available', () => {
    expect(M.getMetricSupport('baijiahao', 'income')).toBe('declared-available')
  })

  it('③ 未知平台 ⇒ unknown-platform（不是 declared-unavailable）', () => {
    expect(M.getMetricSupport('not-a-platform', 'income')).toBe('unknown-platform')
  })

  it('④ 已知平台的未知指标 ⇒ unknown-metric', () => {
    expect(M.getMetricSupport('baijiahao', 'not-a-metric')).toBe('unknown-metric')
  })

  it('三态彼此互斥，四种取值都在白名单内', () => {
    const seen = new Set([
      M.getMetricSupport('baijiahao', 'income'),
      M.getMetricSupport('kuaishou', 'income'),
      M.getMetricSupport('not-a-platform', 'income'),
      M.getMetricSupport('baijiahao', 'not-a-metric'),
    ])
    expect(seen.size).toBe(4)
    for (const s of seen) expect(M.SUPPORT_STATES).toContain(s)
  })
})

describe('platform-metric-matrix — reconcileObservation 四种 verdict', () => {
  it('声明有且实测有值 ⇒ consistent', () => {
    expect(M.reconcileObservation({ platformId: 'baijiahao', metricKey: 'income', value: 12 }).verdict).toBe('consistent')
  })

  it('声明有但实测 null ⇒ declared-but-null（值得告警）', () => {
    const r = M.reconcileObservation({ platformId: 'baijiahao', metricKey: 'income', value: null })
    expect(r.verdict).toBe('declared-but-null')
    expect(r.note).toBeTruthy()
  })

  it('★ 未声明但实测有值 ⇒ undeclared-but-present，且 note 明说这不是错误', () => {
    const r = M.reconcileObservation({ platformId: 'kuaishou', metricKey: 'income', value: 5 })
    expect(r.verdict).toBe('undeclared-but-present')
    expect(r.note).toContain('不是错误')
  })

  it('未声明且实测无值 ⇒ consistent（不算异常）', () => {
    expect(M.reconcileObservation({ platformId: 'kuaishou', metricKey: 'income', value: null }).verdict).toBe('consistent')
  })

  it('未知平台/指标 ⇒ unknown', () => {
    expect(M.reconcileObservation({ platformId: 'nope', metricKey: 'income', value: 1 }).verdict).toBe('unknown')
    expect(M.reconcileObservation({ platformId: 'baijiahao', metricKey: 'nope', value: 1 }).verdict).toBe('unknown')
  })
})

describe('platform-metric-matrix — fail-loud', () => {
  it('文件缺失 ⇒ 抛，不返回空表', () => {
    M.setMatrixPathForTest(path.join(os.tmpdir(), 'definitely-missing-' + Date.now() + '.json'))
    expect(() => M.loadMatrix()).toThrow(/不存在/)
  })

  it('JSON 非法 ⇒ 抛', () => {
    const p = path.join(os.tmpdir(), 'bad-' + Date.now() + '.json')
    fs.writeFileSync(p, '{ not json', 'utf8')
    M.setMatrixPathForTest(p)
    expect(() => M.loadMatrix()).toThrow(/JSON 非法/)
    fs.unlinkSync(p)
  })

  it('schemaVersion 不认识 ⇒ 抛，不按旧结构解释新数据', () => {
    const p = path.join(os.tmpdir(), 'ver-' + Date.now() + '.json')
    fs.writeFileSync(p, JSON.stringify({ schemaVersion: 999, groups: {}, metricKeyMap: {} }), 'utf8')
    M.setMatrixPathForTest(p)
    expect(() => M.loadMatrix()).toThrow(/schemaVersion=999/)
    fs.unlinkSync(p)
  })

  it('validateMatrix 对坏结构给出问题清单而不是抛', () => {
    const p = path.join(os.tmpdir(), 'badshape-' + Date.now() + '.json')
    fs.writeFileSync(p, JSON.stringify({
      schemaVersion: 1,
      groups: { 1: { key: 'content', metrics: { 1: 'x' }, platforms: { p: ['1', '9'] } } },
      metricKeyMap: { 1: { 1: 'income' } },
    }), 'utf8')
    M.setMatrixPathForTest(p)
    const problems = M.validateMatrix()
    expect(problems.length).toBeGreaterThan(0)
    // 引用了未声明的指标 9
    expect(problems.some((s) => s.includes('未声明的指标 9'))).toBe(true)
    fs.unlinkSync(p)
  })
})

/**
 * ★★ 变体反证（P1-1 验收判据 ⑥）
 *
 * 把 `unknown-platform` 分支改成返回 `'declared-unavailable'` ⇒ 本文件**必须变红**。
 *
 * 做法：复制读取层源码 → 字符串替换制造变异 → 复制本测试（**但剔除变体那一节**）指向变异文件 →
 * 子进程跑。之所以不 monkey-patch：`getMetricSupport` 是模块内闭包调用，
 * 从外部替换 `M.getMetricSupport` 不影响内部调用点，等于零覆盖。
 *
 * ⚠️ 两个已踩过的坑（都由断言兜住，别再犯）：
 *   ① 探针必须落在 vitest 的 include 范围内，否则跑出「No test files found」这种**环境红**，
 *      反证等于没做（第一版写在 os.tmpdir()，踩了）；
 *   ② 探针**必须剔除本节自身**，否则它会在子进程里再 spawn 一层、无限递归
 *      （第二版踩了：单次耗时 163s、留下 8 个残留文件）。剔除方式是按 describe 标题切分。
 */
const VARIANT_DESCRIBE_TITLE = 'platform-metric-matrix — 变体反证（防「三态被压成 boolean」）'

describe(VARIANT_DESCRIBE_TITLE, () => {
  it('把 unknown-platform 改成 declared-unavailable ⇒ 测试必红', () => {
    const src = path.join(__dirname, '..', 'platform-metric-matrix.js')
    const code = fs.readFileSync(src, 'utf8')
    const mutated = code.replace(
      /if \(!isKnownPlatform\(platformId, m\)\) return 'unknown-platform'/,
      "if (!isKnownPlatform(platformId, m)) return 'declared-unavailable'"
    )
    expect(mutated).not.toBe(code) // 替换必须真的发生，否则这条反证是空的

    // 剔除本节：从 `const VARIANT_DESCRIBE_TITLE` 到文件末尾整段不要
    const mySource = fs.readFileSync(__filename, 'utf8')
    const cutAt = mySource.indexOf('const VARIANT_DESCRIBE_TITLE =')
    expect(cutAt, '找不到本节起点，剔除逻辑失效').toBeGreaterThan(0)
    const withoutVariant = mySource.slice(0, cutAt)

    const stamp = `${process.pid}-${Date.now()}`
    const file = path.join(__dirname, '..', `__mutant-${stamp}.js`)
    const probe = path.join(__dirname, `__mutant-probe-${stamp}.test.js`)
    try {
      fs.writeFileSync(file, mutated, 'utf8')
      fs.writeFileSync(
        probe,
        withoutVariant
          .replace(/require\('\.\.\/platform-metric-matrix\.js'\)/g, `require(${JSON.stringify('../__mutant-' + stamp + '.js')})`)
          .replace(/^const REPO_ROOT = .*$/m, `const REPO_ROOT = ${JSON.stringify(REPO_ROOT)}`)
          .replace(/^const REAL_PATH = .*$/m, `const REAL_PATH = ${JSON.stringify(REAL_PATH)}`),
        'utf8'
      )

      const r = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', path.relative(REPO_ROOT, probe)],
        { encoding: 'utf8', cwd: REPO_ROOT, timeout: 120000 }
      )
      const out = (r.stdout || '') + (r.stderr || '')
      // ① 变异体必须失败
      expect(r.status, '变异体本应失败，实际通过 ⇒ 三态判据没有真正生效\n' + out.slice(-1500)).not.toBe(0)
      // ② 且必须是**断言**红，不是环境红 —— 否则这条反证又是空的
      expect(out, '变异体红了，但不是断言失败（可能是环境/加载错误）\n' + out.slice(-1500))
        .toMatch(/unknown-platform|AssertionError|toBe/)
      expect(out).not.toMatch(/No test files found|Failed to load|Startup Error/)
      // ③ 反证本身不得递归：探针里不应再出现变体那一节
      const probeText = fs.readFileSync(probe, 'utf8')
      expect(probeText).not.toContain(VARIANT_DESCRIBE_TITLE)
    } finally {
      for (const p of [probe, file]) { try { fs.unlinkSync(p) } catch { /* 已删 */ } }
    }
  }, 150000)
})
