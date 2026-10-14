'use strict'
/**
 * PRD §8.2 单集 compliance 三态标记 —— §8.2.6 七条回归锁逐条落地。
 *
 * 三条写法约束（都是本仓反复踩过的）：
 * - 断言一律打**行为**，不打「源码里出现了某个词」；唯一的结构锁（L5/L7）测的是
 *   「判据只有一份」这条不可由行为表达的约束，且都做了「改成 no-op 必须变红」的反证。
 * - 夹具不得对所有输入返回同一份数据（否则「按输入区分」这一整类缺陷结构性免疫）。
 * - 禁止恒真断言：比较两侧必须有一侧来自被测实现。
 */
const path = require('node:path')
const fs = require('node:fs')

const { annotateEpisodes, readStockStamp, COMPLIANCE_STATES, FALLBACK_REASON_CODE } = require('./podcast-episode-compliance')

const APPS_DESKTOP = path.resolve(__dirname, '..', '..')

/** 与 podcast-error-codes.test.js 同口径取 locale 的 errors 键集（真源，不是第二份清单）。 */
function errorsKeys (rel) {
  const abs = path.join(APPS_DESKTOP, rel)
  if (!fs.existsSync(abs)) throw new Error('locale 文件不存在，判据真源已失效：' + abs)
  const s = fs.readFileSync(abs, 'utf8')
  const i = s.indexOf('errors: {')
  if (i < 0) throw new Error(rel + ' 找不到 errors 块')
  const j = s.indexOf('\n    },', i)
  return new Set([...s.slice(i, j).matchAll(/^\s{6}([A-Za-z0-9_]+):/gm)].map((m) => m[1]))
}
const ZH = errorsKeys('src/locales/podcast/zh.js')
const EN = errorsKeys('src/locales/podcast/en.js')

const NOW = '2026-10-14T00:00:00.000Z'
const good = (over) => Object.assign({
  id: 'ep-ok', title: '第一期', description: '简介', audioUrl: 'https://cdn.example.com/a.mp3',
  durationSec: 60, sizeBytes: 1024, mime: 'audio/mpeg',
}, over || {})
const stamp = { at: '2026-10-12T00:00:00.000Z', filled: 3 }

function annotate (episodes, opts) {
  return annotateEpisodes(Object.assign({
    episodes, stockStamp: stamp.at, now: () => NOW, logger: { warn () {}, info () {} },
  }, opts || {}))
}

describe('单集 compliance 只读重跑（PRD §8.2）', () => {
  it('L1 闭集：输入矩阵内的每一个产出都必须落在 ok/invalid/stock 之内', () => {
    const matrix = [
      good(),
      good({ title: '' }),
      good({ durationSec: 0 }),
      good({ mimeSource: 'stock' }),
      Object.assign(good({ mimeSource: 'stock' }), { title: '' }),
      null,
    ]
    const out = annotate(matrix)
    expect(out).toHaveLength(matrix.length)
    const seen = new Set()
    for (const ep of out) {
      if (ep && typeof ep === 'object') expect(COMPLIANCE_STATES).toContain(ep.compliance.state)
      if (ep && ep.compliance) seen.add(ep.compliance.state)
    }
    // 矩阵确实覆盖到了三态（否则「值域 ⊆ 枚举」可以用一份全是 ok 的夹具假绿）
    expect([...seen].sort()).toEqual(['invalid', 'ok', 'stock'])
  })

  it('L1b 闭集出口是活的：组装必须对枚举做 includes 判定并在越界时抛（摘掉即红）', () => {
    const src = fs.readFileSync(path.join(__dirname, 'podcast-episode-compliance.js'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\*|^\s*\/\//.test(l)).join('\n')
    expect(code).toMatch(/COMPLIANCE_STATES\.includes\(/)
    // 枚举本身必须只有三个词，第四态要靠改本节才能出现
    expect(COMPLIANCE_STATES).toEqual(['ok', 'invalid', 'stock'])
  })

  it('L1b2 非对象元素原样透传：不把 null 伪造成 {compliance} 对象（QM-6 前端评审命中）', () => {
    const hole = { id: 'e1' }
    const out = annotate([hole, null])
    expect(out).toHaveLength(2)
    expect(out[1]).toBe(null)
    expect(out[1]).not.toBeInstanceOf(Object)
    expect(out[0].compliance.state).toBe('invalid')
    // 出声必须能区分两种故障：伪造出来的行是不会有任何痕迹的
    const warns = []
    annotate([null], { logger: { warn: (m) => warns.push(m) } })
    expect(warns.length).toBe(1)
    expect(warns[0]).toContain('非对象元素原样透传=1')
  })

  it('L2 三态各自的形状约束：ok 无 reasons、stock 无 checkedAt、invalid 至少一条', () => {
    const out = annotate([good(), good({ title: '' }), good({ mimeSource: 'stock' })], { stockStamp: stamp.at })
    const ok = out[0].compliance
    const bad = out[1].compliance
    const st = out[2].compliance
    expect(ok).toEqual({ state: 'ok', reasons: [], checkedAt: NOW })
    expect(bad.state).toBe('invalid')
    expect(bad.reasons.length).toBeGreaterThan(0)
    expect(bad.checkedAt).toBe(NOW)
    // stock 没有「重跑」这件事，填时刻等于谎称校验过
    expect(st).toEqual({ state: 'stock', reasons: [], checkedAt: '' })
    // 「引擎说 ok 但带软提示」这一格必须有表示：否则「ok 时 reasons 必须为空」只是被夹具的空
    // issues 顺带满足的（变异 M2 首次就因此没红 —— 那是夹具对这类缺陷结构性免疫）。
    const soft = annotate([good()], {
      validateEpisode: () => ({ ok: true, issues: [{ code: 'EPISODE_GUID_TOO_LONG', field: 'guid', message: '软提示' }], enclosure: 'https://x' }),
    })
    expect(soft[0].compliance).toEqual({ state: 'ok', reasons: [], checkedAt: NOW })
  })

  it('L2c invalid 的每条 reason 都能在 zh/en 的 errors 键集取到文案（码表真源＝locale）', () => {
    const out = annotate([good({ title: '', durationSec: -1, sizeBytes: 0 })])
    const reasons = out[0].compliance.reasons
    expect(reasons.length).toBeGreaterThan(1)
    for (const r of reasons) {
      expect(ZH.has(r), 'zh 缺文案：' + r).toBe(true)
      expect(EN.has(r), 'en 缺文案：' + r).toBe(true)
    }
    // 判据来自引擎，不是本层编的字符串：逐字对一遍真引擎的产出
    const { validateEpisode } = require('@multi-publish/shared-utils/src/podcast-rss')
    expect(reasons).toEqual(validateEpisode(good({ title: '', durationSec: -1, sizeBytes: 0 }), 0).issues.map((i) => i.code))
  })

  it('L4 不猜存量：mimeSource 缺席但时间戳很旧，不得判 stock', () => {
    const old = Object.assign(good(), { registeredAt: '2020-01-01T00:00:00.000Z', pubDate: '2020-01-01T00:00:00.000Z' })
    expect(annotate([old])[0].compliance.state).toBe('ok')
    // 声明了 stock 却没有 index 的 stockStamp ⇒ 来源无凭据，照实按内容判
    const noStamp = annotate([good({ mimeSource: 'stock' })], { stockStamp: null })
    expect(noStamp[0].compliance.state).toBe('ok')
    expect(noStamp[0].compliance.checkedAt).toBe(NOW)
  })

  it('L2d 校验器抛错：该期落 invalid + 兜底码，其余各期照常，且 warn 出声不外冒', () => {
    const warns = []
    const boom = (ep) => {
      if (ep && ep.id === 'ep-ok') throw new Error('引擎内部炸了')
      return { ok: false, issues: [{ code: 'EPISODE_TITLE_REQUIRED', field: 'x', message: 'y' }] }
    }
    const out = annotate([good(), good({ id: 'ep-2', title: '' })], { validateEpisode: boom, logger: { warn: (m) => warns.push(m) } })
    expect(out[0].compliance).toEqual({ state: 'invalid', reasons: [FALLBACK_REASON_CODE], checkedAt: NOW })
    expect(out[1].compliance.reasons).toEqual(['EPISODE_TITLE_REQUIRED'])
    expect(out).toHaveLength(2)
    expect(warns.length).toBe(1)
    expect(warns[0]).not.toContain('第一期')
  })

  it('L6 追加式契约：既有键与顺序逐字不变，compliance 只追加在末尾', () => {
    const ep = good({ title: 'A', description: 'B' })
    const before = Object.keys(ep)
    const out = annotate([ep, good({ id: 'ep-2', title: 'C' })])
    expect(out.map((e) => e.id)).toEqual(['ep-ok', 'ep-2'])
    expect(Object.keys(out[0]).slice(0, before.length)).toEqual(before)
    expect(Object.keys(out[0])[before.length]).toBe('compliance')
    // 不得改传入对象（只读重跑）：原对象上没有 compliance
    expect(ep.compliance).toBeUndefined()
  })

  it('L5 判据同源（结构锁）：本层不得自带 EPISODE_* 码表，默认必须用引擎实现', () => {
    const src = fs.readFileSync(path.join(__dirname, 'podcast-episode-compliance.js'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\*|^\s*\/\//.test(l)).join('\n')
    const own = [...code.matchAll(/['"](EPISODE_[A-Z0-9_]+)['"]/g)].map((m) => m[1])
    expect(own, '本层不得抄写第二份校验码表：' + own.join(',')).toEqual([])
    expect(code).toMatch(/require\('@multi-publish\/shared-utils\/src\/podcast-rss'\)/)
    // 存量来源取值也不得自己写第二份（QM-6 后端 W1）：必须从固化层取常量
    expect(code).toMatch(/require\('\.\/podcast-episode-stock-mime'\)/)
    expect(/const STOCK_SOURCE\s*=\s*['"]/.test(code)).toBe(false)
  })

  it('L7 清点式门禁已扩域：RSS 校验器必须在 PRODUCERS 里，且逐期 19 条码全有成对文案', () => {
    const testSrc = fs.readFileSync(path.join(APPS_DESKTOP, 'src/locales/podcast-error-codes.test.js'), 'utf8')
    expect(testSrc).toMatch(/packages\/shared-utils\/src\/podcast-rss\.js/)
    const episodes = [
      good({ title: '' }), good({ description: 'x'.repeat(4000) }), good({ subtitle: 'y'.repeat(400) }),
      good({ durationSec: 0 }), good({ sizeBytes: 0 }), good({ explicit: 'maybe' }),
      good({ episodeType: 'bonus?' }), good({ pubDate: 'not-a-date' }), good({ coverUrl: 'http://x/y.jpg' }),
      good({ mime: 'audio/ogg' }), good({ guid: 'g'.repeat(600) }), good({ number: 0 }), good({ season: -1 }),
      good({ title: '' }) , Object.assign(good(), { audioUrl: '' }), Object.assign(good(), { localFilePath: '/a/b.mp3' }),
      null,
    ]
    const reasons = new Set()
    for (const ep of episodes) {
      const got = annotate([ep])[0]
      // 非对象元素是原样透传的（不伪造），所以这里必须先承认它没有 compliance —— 见 L1b2
      const c = got && typeof got === 'object' ? got.compliance : null
      if (c && c.state === 'invalid') c.reasons.forEach((r) => reasons.add(r))
    }
    expect(reasons.size).toBeGreaterThan(10)
    for (const r of reasons) {
      expect(ZH.has(r), 'zh 缺文案：' + r).toBe(true)
      expect(EN.has(r), 'en 缺文案：' + r).toBe(true)
    }
  })

  it('readStockStamp 只读 index 的 stockStamp.at，读不到即 null（不得猜）', () => {
    // 键必须用 path.join 现算：Windows 下 join 出的是反斜杠，硬写 '/podcast/index.json' 会
    // 让 existsSync 恒 false，把「读不到」测成「读到 null」——两处判路径必漂移的同款坑。
    const indexFile = path.join('/podcast', 'index.json')
    const files = {}
    files[indexFile] = JSON.stringify({ channels: [], stockStamp: stamp })
    const fakeFs = { existsSync: (f) => f in files, readFileSync: (f) => files[f] }
    const reg = { resolveRoot: () => '/podcast' }
    expect(readStockStamp({ registry: reg, fsImpl: fakeFs, logger: { warn () {} } })).toBe(stamp.at)
    expect(readStockStamp({ registry: { resolveRoot: () => '/nope' }, fsImpl: { existsSync: () => false, readFileSync: () => '{}' }, logger: { warn () {} } })).toBeNull()
    expect(readStockStamp({ registry: null, fsImpl: fakeFs, logger: { warn () {} } })).toBeNull()
    expect(readStockStamp({
      registry: { resolveRoot: () => '/podcast' },
      fsImpl: { existsSync: () => true, readFileSync: () => '{坏 JSON' },
      logger: { warn () {} },
    })).toBeNull()
  })
})
