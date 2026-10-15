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

const { annotateEpisodes, readStockStamp, readStockStampRecord, toFreezeSummary, COMPLIANCE_STATES, FALLBACK_REASON_CODE } = require('./podcast-episode-compliance')

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

/**
 * PRD §7.9.4「频道页固化摘要」。与上面 §8.2.6 那七条分开写，因为它量的是**另一件事**：
 * 摘要不参与合格与否，它只是把固化层当时实测的三个计数原样投影给界面。
 * 一条判据贯穿全部：缺席一律 null（不显示），**绝不回落成 0**。
 */
describe('§7.9.4 固化摘要：一次读、按计数投影、缺席不猜 0', () => {
  const indexFile = path.join('/podcast', 'index.json')
  const reg = { resolveRoot: () => '/podcast' }
  const fsOf = (indexObj) => {
    const files = {}
    files[indexFile] = JSON.stringify(indexObj)
    return { existsSync: (f) => f in files, readFileSync: (f) => files[f] }
  }
  const NOLOG = { warn () {} }

  it('readStockStampRecord 给出整份凭据；readStockStamp 是它的 .at 投影（同一次读，只有一份路径判据）', () => {
    const full = { at: '2026-10-14T00:00:00.000Z', channels: 2, scanned: 11, filled: 4, unresolved: 1 }
    const rec = readStockStampRecord({ registry: reg, fsImpl: fsOf({ stockStamp: full }), logger: NOLOG })
    expect(rec).toEqual(full)
    expect(rec).not.toBe(full)
    expect(readStockStamp({ registry: reg, fsImpl: fsOf({ stockStamp: full }), logger: NOLOG })).toBe(full.at)
  })

  it('stockStamp 在位但 at 缺席 ⇒ 两份投影都是 null（没有 at 就没有来源凭据）', () => {
    expect(readStockStampRecord({ registry: reg, fsImpl: fsOf({ stockStamp: { scanned: 3, filled: 0, unresolved: 0 } }), logger: NOLOG })).toBeNull()
    expect(readStockStamp({ registry: reg, fsImpl: fsOf({ stockStamp: { scanned: 3 } }), logger: NOLOG })).toBeNull()
  })

  it('toFreezeSummary 只投影三个计数，at/channels/source/unresolvedChannels 都不外泄', () => {
    const s = toFreezeSummary({ at: 'x', channels: 2, scanned: 11, filled: 4, unresolved: 1, unresolvedChannels: ['a', 'b'], source: 'libmp3lame/aac' })
    expect(Object.keys(s)).toEqual(['scanned', 'filled', 'unresolved', 'skippedChannels'])
    expect(s).toEqual({ scanned: 11, filled: 4, unresolved: 1, skippedChannels: 2 })
  })

  it('计数 0 是真实结论，必须原样保留（不得被「缺席判据」吃掉）', () => {
    expect(toFreezeSummary({ at: 'x', scanned: 0, filled: 0, unresolved: 0, unresolvedChannels: [] })).toEqual({ scanned: 0, filled: 0, unresolved: 0, skippedChannels: 0 })
  })

  it('计数缺席或形态不对 ⇒ null，绝不回落成 0（「不知道」不等于「没有待办」）', () => {
    const bad = [
      null, undefined, 'x', 0, [], {},
      { at: 'x', scanned: 3, filled: 1 },
      // unresolvedChannels 缺席/形态不对同样判 null：不给"不知道有几个频道被跳过"补 0
      { at: 'x', scanned: 3, filled: 1, unresolved: 0 },
      { at: 'x', scanned: 3, filled: 1, unresolved: 0, unresolvedChannels: 'ch-1' },
      { at: 'x', scanned: 3, unresolved: 1 },
      { at: 'x', filled: 3, unresolved: 1 },

      { at: 'x', scanned: 3, filled: 1.5, unresolved: 0 },
      { at: 'x', scanned: '3', filled: 1, unresolved: 0 },
      { at: 'x', scanned: NaN, filled: 1, unresolved: 0 },
      { at: 'x', scanned: Infinity, filled: 1, unresolved: 0 },
    ]
    for (const c of bad) expect(toFreezeSummary(c)).toBeNull()
  })

  it('负数计数不是实测值 ⇒ null（与「缺席」分格：放宽符号判据必须被这一条指名抓到）', () => {

    // `unresolvedChannels: []` 是**必要**的：投影对"跳过频道数组缺席"也判 null，
    // 少了这个字段，本用例会在"符号放宽"的变异下仍然通过（null 来自另一个原因），
    // 变异因此逃掉——加一条判据后，所有"只测一件事"的夹具都要回头核一遍。
    expect(toFreezeSummary({ at: 'x', scanned: 3, filled: -1, unresolved: 0, unresolvedChannels: [] })).toBeNull()
  })

  it('JSON 里带 __proto__ 键的凭据不得污染返回对象的原型', () => {
    // 来源是本机自己写的 index.json，风险等级低；但免疫只要一行（展开语法用
    // CreateDataProperty，而 Object.assign 用 [[Set]] 会触发 Object.prototype 的 __proto__ setter）。
    const raw = '{"stockStamp":{"at":"2026-10-15T00:00:00.000Z","__proto__":{"polluted":1}}}'
    const files = {}
    files[indexFile] = raw
    const rec = readStockStampRecord({ registry: reg, fsImpl: { existsSync: () => true, readFileSync: () => raw }, logger: NOLOG })
    expect(Object.getPrototypeOf(rec)).toBe(Object.prototype)
    expect(rec.polluted).toBeUndefined()
    expect(rec.at).toBe('2026-10-15T00:00:00.000Z')
  })

  it('只读：投影不得改写凭据', () => {
    const stamp = { at: 'x', scanned: 2, filled: 1, unresolved: 1 }
    const before = JSON.stringify(stamp)
    toFreezeSummary(stamp)
    expect(JSON.stringify(stamp)).toBe(before)
  })

  it('跨层同结论：真固化层写出的 stockStamp 必须被摘要层读出（哪天改计数名，本条当场红）', async () => {
    const { freezeStockMime } = require('./podcast-episode-stock-mime')
    let index = {}
    const store = {
      episodes: [
        { id: 'a', mime: 'audio/mpeg', url: 'https://x/a.mp3' },
        { id: 'b', mime: 'application/octet-stream', url: 'https://x/b.m4a' },
        { id: 'c', url: 'https://x/c.bin' },
      ],
    }
    await freezeStockMime({
      logger: { info () {}, warn () {}, error () {} },
      listChannels: () => [{ channelId: 'ch-1', episodesFile: 'episodes.json' }],
      readEpisodes: () => store,
      writeEpisodes: (f, next) => { store.episodes = next.episodes },
      readIndex: () => index,
      writeIndex: (next) => { index = next },
      withChannelLock: (id, tag, fn) => fn(),
    })
    expect(index.stockStamp).toBeTruthy()
    expect(toFreezeSummary(index.stockStamp)).toEqual({ scanned: 3, filled: 1, unresolved: 1, skippedChannels: 0 })
    // 同一份凭据也必须让 compliance 判得出 stock 档（两处共用一次读，不许一处认一处不认）
    expect(readStockStamp({ registry: reg, fsImpl: fsOf(index), logger: NOLOG })).toBe(index.stockStamp.at)
  })

  it('结构锁：readStockStamp 必须是 readStockStampRecord 的投影，不得自己再解析一遍 index', () => {
    // 「同一次读」这句话在行为层测不到（两条投影各自返回值相同），只能锁实现形态。
    // 判据必须先剥注释再匹配：本文件的注释里就写着 readFileSync/existsSync 的名字，
    // 不剥注释会把"注释提到读盘"判成"实现在读盘"——同仓「结构锁不剥注释 = 幽灵通道」的反向落点。
    const src = fs.readFileSync(path.join(__dirname, 'podcast-episode-compliance.js'), 'utf8')
    const code = src.split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n')
    const i = code.indexOf('function readStockStamp (p) {')
    expect(i).toBeGreaterThan(-1)
    // 范围按**语义块**取（起点之后第一条顶列 `}`），不用固定字符窗口：
    // 窗口写死 240 时，函数体一旦变长就提前截断，"不得出现 readFileSync" 会在还没走到那行时
    // 就成立 —— 那是一条会因为实现变长而**静默失效**的锁（QM-6 前端轴线索 L1）。
    const close = code.slice(i).match(/\r?\n}/)
    expect(close).not.toBeNull()
    const seg = code.slice(i, i + close.index + close[0].length)
    // 完整性断言：截出来的必须就是这个函数的全部体（含它的 return），否则下面的负断言无意义
    expect(seg).toContain('return rec ? rec.at : null')
    expect(seg).toContain('readStockStampRecord(p)')
    expect(seg).not.toContain('readFileSync')
    expect(seg).not.toContain('existsSync')
  })
})
