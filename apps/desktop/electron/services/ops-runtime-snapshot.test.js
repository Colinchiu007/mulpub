// @ts-check
/**
 * ops-runtime-snapshot.test.js — 运行时策略 L2/L3 降级数据源与 config_hash 真源
 *
 * 覆盖：config_hash 计算范围（design §1.2 三条约束）、L2 完整原始 payload 往返、
 * 连接失败语义所需的「不写 L2」、L3 种子读取与词库剔除、种子 7 项 CI 校验判据。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const {
  OpsRuntimeSnapshot,
  RUNTIME_BLOCKS,
  SNAPSHOT_SETTING_KEY,
  canonicalJson,
  computeConfigHash,
  stripContentWordList,
  validateSeedPayload,
  resolveSeedPaths,
  SEED_BLOCK_TYPES,
  MAX_SNAPSHOT_BYTES,
  SEED_MAX_AGE_DAYS,
} = require('./ops-runtime-snapshot')

/** 与真实 settings-store 同形：写入文本、读回解析后的值（ops-center-sync.test.js 同一夹具形态） */
function makeStore (initial) {
  const rows = initial ? { [SNAPSHOT_SETTING_KEY]: JSON.stringify(initial) } : {}
  return {
    getSetting: (k) => (k in rows ? JSON.parse(rows[k]) : ''),
    getSettingObject: (k, d = {}) => {
      const v = k in rows ? JSON.parse(rows[k]) : null
      return v && typeof v === 'object' && !Array.isArray(v) ? v : d
    },
    setSetting: (k, v) => { rows[k] = JSON.stringify(v) },
    _rows: rows,
  }
}

const LOG = { info () {}, warn () {}, error () {}, notify () {} }

/** 13 个数据块齐全的最小合法 payload（结构对齐 ops-center 的 bootstrap 形态） */
function fullPayload (overrides = {}) {
  const base = {
    announcements: [],
    update_policy: { auto_check: true },
    content_policy: { name: '默认', enabled: true, word_list: ['封禁词'], replacement: '***' },
    feature_flags: { cloud_publish: true },
    platform_defs: [],
    content_templates: [],
    keyword_watchlist: [],
    rewrite_strategies: [],
    rewrite_hard_constraints: { items: [] },
    rewrite_ai_taste_map: [],
    pipelineOptions: { publish: { visible: true } },
    appMenu: { items: [{ key: 'home', sort_order: 1 }] },
    contentCategories: [],
    synced_at: '2026-10-07T10:00:00Z',
    config_version: 42,
    config_hash: computeConfigHash({}),
    signature: 'sig',
  }
  return { ...base, ...overrides }
}

describe('computeConfigHash（design §1.2）', () => {
  it('只由 13 个数据块计算，synced_at/config_version/config_hash/signature 全部不参与', () => {
    const a = fullPayload()
    const b = fullPayload({
      synced_at: '2026-10-08T10:00:00Z',
      config_version: 43,
      config_hash: 'ffffffffffffffff',
      signature: 'other',
    })
    expect(computeConfigHash(a)).toBe(computeConfigHash(b))
  })

  it('内容真变时 hash 变化，且是 16 位小写十六进制', () => {
    const a = computeConfigHash(fullPayload({ announcements: [] }))
    const b = computeConfigHash(fullPayload({ announcements: [{ id: 1 }] }))
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(b).toMatch(/^[0-9a-f]{16}$/)
  })

  it('缺失键以 null 参与计算，与「键存在但值为 null」同 hash', () => {
    const missing = fullPayload()
    delete missing.platform_defs
    expect(computeConfigHash(missing)).toBe(computeConfigHash(fullPayload({ platform_defs: null })))
    // 但与「键存在且有内容」不同（否则删掉一个数据块无法被 hash 察觉）
    expect(computeConfigHash(missing)).not.toBe(computeConfigHash(fullPayload()))
  })

  it('缺失键与显式 null 完全同 hash（design §1.2 约束 3 的最小形态）', () => {
    expect(computeConfigHash({})).toBe(computeConfigHash({ announcements: null }))
  })

  it('synced_at / config_version / config_hash / signature 任一变化都不改变 hash（design §1.2 约束 1、2）', () => {
    const base = { announcements: [{ title: '公告' }], platform_defs: [] }
    const plain = computeConfigHash(base)
    for (const volatile of [
      { synced_at: '2026-10-07T10:00:00Z' },
      { synced_at: '2026-10-08T23:59:59Z' },
      { config_version: 1 },
      { config_version: 999 },
      { config_hash: 'aaaaaaaaaaaaaaaa' },
      { signature: 'ZmFrZQ==' },
      { config_version: 42, config_hash: 'ffffffffffffffff', signature: 'c2ln', synced_at: '2026-10-09T00:00:00Z' },
    ]) {
      expect(computeConfigHash({ ...base, ...volatile })).toBe(plain)
    }
  })

  it('13 个数据块与契约逐字一致', () => {
    expect(RUNTIME_BLOCKS).toEqual([
      'announcements', 'update_policy', 'content_policy', 'feature_flags',
      'platform_defs', 'content_templates', 'keyword_watchlist',
      'rewrite_strategies', 'rewrite_hard_constraints', 'rewrite_ai_taste_map',
      'pipelineOptions', 'appMenu', 'contentCategories',
    ])
  })
})

describe('computeConfigHash 跨端固定向量（与 ops-center test_runtime_resilience_api.py::test_config_hash_pinned_vectors 同源）', () => {
  // 契约锁：两端任一改算法（canonical JSON 细节 / 键集合 / 截断位数）或改块名，本块立即红。
  // 服务端固定向量（Python 侧同一组常量）：
  //   compute_config_hash({})                            == "29f1096e3e93eaaf"
  //   compute_config_hash({"announcements": []})          == "f30e01b53ec6b839"
  //   compute_config_hash({"announcements":[{"title":"公告"}]}) == "fdbebf95ae223dfe"
  it('三个固定向量逐字一致', () => {
    expect(computeConfigHash({})).toBe('29f1096e3e93eaaf')
    expect(computeConfigHash({ announcements: [] })).toBe('f30e01b53ec6b839')
    expect(computeConfigHash({ announcements: [{ title: '公告' }] })).toBe('fdbebf95ae223dfe')
  })

  it('固定向量不受键序影响（canonical JSON 键字典序）', () => {
    expect(computeConfigHash({ announcements: [{ title: '公告' }] }))
      .toBe(computeConfigHash({ announcements: [{ title: '公告' }] }))
    expect(computeConfigHash({ announcements: [], platform_defs: [] }))
      .toBe(computeConfigHash({ platform_defs: [], announcements: [] }))
  })
})

describe('canonicalJson（从 ops-center-sync 迁入，行为必须逐字节不变）', () => {
  it('键字典序、无多余空白、非 ASCII 原样输出', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: '中' }] })).toBe('{"a":[1,{"c":"中","d":2}],"b":1}')
    expect(canonicalJson({})).toBe('{}')
    expect(canonicalJson([])).toBe('[]')
    expect(canonicalJson(null)).toBe('null')
  })

  it('无法序列化的类型直接抛错（函数/未定义值）', () => {
    expect(() => canonicalJson(() => {})).toThrow()
    expect(() => canonicalJson(undefined)).toThrow()
  })

  it('数字沿用 JSON.stringify 序列化；NaN 落到 null 与 Python allow_nan=False 不对称但不可达', () => {
    // 契约说明：bootstrap payload 一定来自 JSON.parse，JSON 语法本身无法承载 NaN/Infinity，
    // 因此该不对称在运行时不可达；此处按既有实现（纯迁移，行为不变）固定，不在此处改签名路径语义。
    expect(canonicalJson([1, 2.5, -3])).toBe('[1,2.5,-3]')
    expect(canonicalJson(Number.NaN)).toBe('null')
  })
})

describe('stripContentWordList（design §4.4 第 6 条）', () => {
  it('只剔除 word_list，保留 enabled 等开关与替换串，且不改动入参', () => {
    const input = fullPayload()
    const out = stripContentWordList(input)
    expect(out.content_policy).toEqual({ name: '默认', enabled: true, replacement: '***' })
    expect('word_list' in out.content_policy).toBe(false)
    expect(input.content_policy.word_list).toEqual(['封禁词'])
    expect(out.platform_defs).toBe(input.platform_defs)
  })

  it('无 content_policy 或非对象时原样返回', () => {
    expect(stripContentWordList({ content_policy: null }).content_policy).toBeNull()
    expect(stripContentWordList({ announcements: [] }).content_policy).toBeUndefined()
  })
})

describe('validateSeedPayload（design §4.4 CI 校验 7 条）', () => {
  /** 种子的 content_policy 必然已剔除词库（导出脚本的职责），因此这里用剔除后的形态 */
  const seedOf = (extra = {}) => {
    const seed = {
      _meta: { config_version: 42, config_hash: '', exported_at: new Date().toISOString(), source: 'x' },
      ...stripContentWordList(fullPayload(extra)),
    }
    seed._meta.config_hash = computeConfigHash(seed)
    return seed
  }

  it('合法种子零错误零警告', () => {
    const seed = seedOf()
    seed._meta.config_hash = computeConfigHash(seed)
    expect(validateSeedPayload(seed, { bytes: Buffer.byteLength(JSON.stringify(seed), 'utf8') })).toEqual({ errors: [], warnings: [] })
  })

  it('第 1 条：13 个数据块缺任一即失败', () => {
    const seed = seedOf()
    delete seed.keyword_watchlist
    seed._meta.config_hash = computeConfigHash(seed)
    expect(validateSeedPayload(seed).errors.join()).toMatch(/keyword_watchlist/)
  })

  it('第 2 条：块类型与运行时不一致即失败', () => {
    const seed = seedOf({ platform_defs: { items: [] } })
    seed._meta.config_hash = computeConfigHash(seed)
    expect(validateSeedPayload(seed).errors.join()).toMatch(/platform_defs/)
  })

  // 三种形态各一例（2026-10-08 修正：首版把 contentCategories/appMenu/rewrite_hard_constraints
  // 的形态写错，会把合法种子误拦 —— 判据必须逐块对着 applyRuntime 的真实接受口径）
  it('第 2 条 · array 形态：只接受数组，对象/标量一律失败', () => {
    const ok = seedOf({ keyword_watchlist: [] })
    ok._meta.config_hash = computeConfigHash(ok)
    expect(validateSeedPayload(ok).errors).toEqual([])
    const bad = seedOf({ keyword_watchlist: { items: [] } })
    bad._meta.config_hash = computeConfigHash(bad)
    expect(validateSeedPayload(bad).errors.join()).toMatch(/keyword_watchlist.*期望 array/)
  })

  it('第 2 条 · object-or-null 形态：null 与对象都合法，数组失败', () => {
    for (const value of [null, { items: [{ id: 'h1' }] }]) {
      const seed = seedOf({ rewrite_hard_constraints: value })
      seed._meta.config_hash = computeConfigHash(seed)
      expect(validateSeedPayload(seed).errors).toEqual([])
    }
    const bad = seedOf({ update_policy: [] })
    bad._meta.config_hash = computeConfigHash(bad)
    expect(validateSeedPayload(bad).errors.join()).toMatch(/update_policy.*期望 object-or-null/)
  })

  it('第 2 条 · array-or-object 形态：contentCategories 裸数组与 {items} 都合法，null/标量失败', () => {
    const asArray = seedOf({ contentCategories: [] })
    asArray._meta.config_hash = computeConfigHash(asArray)
    expect(validateSeedPayload(asArray).errors).toEqual([])
    const asObject = seedOf({ contentCategories: { items: [], count: 0, synced_at: '2026-10-08T00:00:00Z' } })
    asObject._meta.config_hash = computeConfigHash(asObject)
    expect(validateSeedPayload(asObject).errors).toEqual([])
    for (const bad of [null, 'film', 3]) {
      const seed = seedOf({ contentCategories: bad })
      seed._meta.config_hash = computeConfigHash(seed)
      expect(validateSeedPayload(seed).errors.join()).toMatch(/contentCategories.*期望 array-or-object/)
    }
  })

  it('第 2 条 · appMenu 为 null 时合法（客户端按 fail-open 回退本地默认菜单）', () => {
    const seed = seedOf({ appMenu: null })
    seed._meta.config_hash = computeConfigHash(seed)
    expect(validateSeedPayload(seed).errors).toEqual([])
  })

  it('第 3 条：超过 1MB 上限失败', () => {
    const seed = seedOf()
    seed._meta.config_hash = computeConfigHash(seed)
    expect(validateSeedPayload(seed, { bytes: 1024 * 1024 + 1 }).errors.join()).toMatch(/1MB/)
  })

  it('第 4 条：BOM 与 U+FFFD 替换字符失败', () => {
    const seed = seedOf()
    seed._meta.config_hash = computeConfigHash(seed)
    expect(validateSeedPayload(seed, { hasBom: true }).errors.join()).toMatch(/BOM/)
    expect(validateSeedPayload(seed, { hasReplacementChar: true }).errors.join()).toMatch(/U\+FFFD/)
  })

  it('第 5 条：_meta.config_hash 与实算不一致失败', () => {
    const seed = seedOf()
    seed._meta.config_hash = 'deadbeefdeadbeef'
    expect(validateSeedPayload(seed).errors.join()).toMatch(/config_hash/)
  })

  it('第 6 条：word_list 残留是安全硬约束，必须报出文件名与字段名', () => {
    const seed = seedOf()
    seed.content_policy.word_list = ['封禁词']
    seed._meta.config_hash = computeConfigHash(seed)
    const r = validateSeedPayload(seed, { file: 'runtime-bootstrap.json' })
    expect(r.errors.join()).toMatch(/runtime-bootstrap\.json.*content_policy\.word_list/)
  })

  it('第 7 条：超过 90 天只警告不阻塞', () => {
    const seed = seedOf()
    seed._meta.config_hash = computeConfigHash(seed)
    seed._meta.exported_at = new Date(Date.now() - (SEED_MAX_AGE_DAYS + 1) * 86400000).toISOString()
    const r = validateSeedPayload(seed)
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).toMatch(/90/)
  })
})

describe('SEED_BLOCK_TYPES', () => {
  it('13 个块的类型与运行时消费口径一一对应（逐条对着 applyRuntime 推导，判错会误拦合法种子）', () => {
    expect(SEED_BLOCK_TYPES).toEqual({
      announcements: 'array',
      update_policy: 'object-or-null',
      content_policy: 'object-or-null',
      feature_flags: 'object-or-null',
      platform_defs: 'array',
      content_templates: 'array',
      keyword_watchlist: 'array',
      rewrite_strategies: 'array',
      rewrite_hard_constraints: 'object-or-null',
      rewrite_ai_taste_map: 'array',
      pipelineOptions: 'object-or-null',
      appMenu: 'object-or-null',
      contentCategories: 'array-or-object',
    })
    expect(Object.keys(SEED_BLOCK_TYPES).sort()).toEqual([...RUNTIME_BLOCKS].sort())
  })
})

describe('resolveSeedPaths', () => {
  it('只有一个候选：随 asar 发布的那份（第二候选已因从未登记 extraResources 而删除）', () => {
    const paths = resolveSeedPaths({ appDir: 'D:/app/apps/desktop/electron/services' })
    expect(paths).toHaveLength(1)
    expect(paths[0]).toBe(path.join('D:/app/apps/desktop/electron/services', '..', '..', 'resources', 'ops-seed', 'runtime-bootstrap.json'))
  })

  it('再传入 resourcesPath 也不得生出第二候选（防「顺手加回来」复活一条永远命中不了的探测）', () => {
    expect(resolveSeedPaths({ appDir: 'D:/app/apps/desktop/electron/services', resourcesPath: 'D:/app/resources' })).toHaveLength(1)
  })
})

describe('OpsRuntimeSnapshot — L2 快照（design §4.2/§4.3）', () => {
  let store
  let svc
  beforeEach(() => {
    store = makeStore()
    svc = new OpsRuntimeSnapshot({ store, log: LOG, seedPath: path.join(os.tmpdir(), 'no-such-seed.json') })
  })

  it('成功后落盘的是完整原始 payload（6 个注入管理器的入参可原样重放）', () => {
    const payload = fullPayload({ platform_defs: [{ key: 'douyin' }], content_templates: [{ id: 't1' }] })
    const r = svc.saveRawSnapshot(payload)
    expect(r.ok).toBe(true)
    expect(r.configHash).toBe(computeConfigHash(payload))
    const stored = store._rows[SNAPSHOT_SETTING_KEY]
    expect(Object.keys(JSON.parse(stored).payload).sort()).toEqual(Object.keys(payload).sort())
    expect(svc.readSnapshotPayload().platform_defs).toEqual([{ key: 'douyin' }])
    expect(svc.readSnapshotMeta().configVersion).toBe(42)
  })

  it('非对象/超限 payload 拒绝落盘且不留半截状态（对齐 MAX_CATALOG_BYTES）', () => {
    expect(svc.saveRawSnapshot(null).ok).toBe(false)
    const huge = fullPayload({ announcements: new Array(1).fill({ title: 'x'.repeat(MAX_SNAPSHOT_BYTES) }) })
    const r = svc.saveRawSnapshot(huge)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/1MB/)
    expect(store._rows[SNAPSHOT_SETTING_KEY]).toBeUndefined()
  })

  it('存储损坏或缺失一律按无快照处理，不抛错', () => {
    store._rows[SNAPSHOT_SETTING_KEY] = '{ 不是 json'
    expect(svc.readSnapshotPayload()).toBeNull()
    // 元信息是「日志用读数」，损坏时给安全默认值（空串/0）而不是 null，调用方无需判空两次
    expect(svc.readSnapshotMeta()).toEqual({ savedAt: '', configHash: '', configVersion: 0 })
    store._rows[SNAPSHOT_SETTING_KEY] = JSON.stringify({ payload: { announcements: [] } })
    expect(svc.readSnapshotMeta().configHash).toBe('')
  })

  it('无 store / 无 getSettingObject 时安全降级为空快照', () => {
    const bare = new OpsRuntimeSnapshot({ store: null, log: LOG })
    expect(bare.readSnapshotPayload()).toBeNull()
    expect(bare.saveRawSnapshot(fullPayload()).ok).toBe(false)
  })
})

describe('OpsRuntimeSnapshot — L3 种子（design §4.4/§4.5）', () => {
  let dir
  let seedPath
  const seedOf = (extra = {}) => {
    const seed = { _meta: { config_version: 1, config_hash: '', exported_at: new Date().toISOString(), source: 'baseline://local' }, ...fullPayload(extra) }
    seed._meta.config_hash = computeConfigHash(seed)
    return seed
  }
  const write = (obj) => { fs.writeFileSync(seedPath, JSON.stringify(obj, null, 2), 'utf8') }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-seed-'))
    seedPath = path.join(dir, 'runtime-bootstrap.json')
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('读得到时返回 payload 与 _meta，并标注种子年龄', () => {
    write(seedOf({ announcements: [{ id: 'a1' }] }))
    const svc = new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, seedPath })
    const seed = svc.readSeed()
    expect(seed.payload.announcements).toEqual([{ id: 'a1' }])
    expect(seed.meta.configVersion).toBe(1)
    expect(seed.staleDays).toBe(0)
  })

  it('读取时再次剔除 word_list（CI 之外的第二道防线，词库绝不进运行时）', () => {
    write(seedOf())
    const svc = new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, seedPath })
    expect(svc.readSeed().payload.content_policy.word_list).toBeUndefined()
    expect(svc.readSeed().payload.content_policy.enabled).toBe(true)
  })

  it('缺失/非法 JSON/非对象种子返回 null，不阻断启动', () => {
    const svc = new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, seedPath })
    expect(svc.readSeed()).toBeNull()
    fs.writeFileSync(seedPath, 'not json', 'utf8')
    expect(svc.readSeed()).toBeNull()
    fs.writeFileSync(seedPath, '[]', 'utf8')
    expect(svc.readSeed()).toBeNull()
  })

  it('超过 1MB 的种子拒绝读取，但状态里仍要报「存在且不可用」（排查不能被误报成没打包）', () => {
    const big = seedOf({ announcements: [{ title: 'x'.repeat(MAX_SNAPSHOT_BYTES) }] })
    fs.writeFileSync(seedPath, JSON.stringify(big), 'utf8')
    const svc = new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, seedPath })
    expect(svc.readSeed()).toBeNull()
    expect(svc.getSeedStatus()).toMatchObject({ exists: true, usable: false })
  })

  it('种子过期只体现在 staleDays 上（是否告警由 CI 决定，运行时不阻断）', () => {
    const seed = seedOf()
    seed._meta.exported_at = new Date(Date.now() - (SEED_MAX_AGE_DAYS + 5) * 86400000).toISOString()
    write(seed)
    const svc = new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, seedPath })
    expect(svc.readSeed().staleDays).toBeGreaterThan(SEED_MAX_AGE_DAYS)
    expect(svc.getSeedStatus().stale).toBe(true)
  })

  it('构造器只认 asar 内候选：往包外数据区写种子读不到，往候选那一位写才读到', () => {
    // 显式给 appDir 指向临时目录：本用例不依赖仓库里有没有真实种子文件（种子是 CI/发布产物）
    const appDir = path.join(dir, 'fake-app', 'electron', 'services')
    const inAsar = path.join(appDir, '..', '..', 'resources', 'ops-seed')
    const resourcesPath = path.join(dir, 'resources-root')
    fs.mkdirSync(path.join(resourcesPath, 'ops-seed'), { recursive: true })
    // 只往包外写 ⇒ 仍判「没有种子」且不抛错（过去这条候选是靠第二项命中的，现已删除）
    fs.writeFileSync(path.join(resourcesPath, 'ops-seed', 'runtime-bootstrap.json'), JSON.stringify(seedOf()), 'utf8')
    const svc = new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, appDir, resourcesPath })
    expect(svc.getSeedStatus().exists).toBe(false)
    expect(svc.readSeed()).toBeNull()
    // 往唯一候选那一位写 ⇒ 读到
    fs.mkdirSync(inAsar, { recursive: true })
    fs.writeFileSync(path.join(inAsar, 'runtime-bootstrap.json'), JSON.stringify(seedOf()), 'utf8')
    expect(new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, appDir }).readSeed().meta.configVersion).toBe(1)
  })
})
// ─── 非整数 / 非有限数 / 超精度整数：两端必须一致地拒绝（QM-6 外部评审触发）────────
// 实测两端序列化文本全不同：1.0→"1.0"|"1"、1e16→"1e+16"|"10000000000000000"、
// 1.5e-7→"1.5e-07"|"1.5e-7"、-0.0→"-0.0"|"0"、>2^53 时 JS 还丢精度。
// 不拦住 ⇒ ACK 反复判「hash 变了」⇒ 每 24h 全量客户端空烧流量，且看板 hash 对不上任何客户端。
describe('computeConfigHash 对跨端不一致数值的 fail-closed（与 Python 端同判据）', () => {
  it('非整数一律拒绝', () => {
    for (const v of [1.5, 0.1, 1.5e-7, -2.25]) {
      expect(() => computeConfigHash({ feature_flags: { limit: v } })).toThrow(/非整数/)
    }
  })

  it('非有限数一律拒绝（NaN / Infinity）', () => {
    expect(() => computeConfigHash({ feature_flags: { limit: NaN } })).toThrow(/非有限数/)
    expect(() => computeConfigHash({ feature_flags: { limit: Infinity } })).toThrow(/非有限数/)
    expect(() => computeConfigHash({ feature_flags: { limit: -Infinity } })).toThrow(/非有限数/)
  })

  it('超出双精度安全范围的整数拒绝（JS Number 已丢精度）', () => {
    // 用 Number(bigint) 而不是直接写字面量：9007199254740993 作为 JS 字面量在**解析期**就被
    // 舍入成 9007199254740992，等于测不到「超出安全范围」这件事；ESLint 的 no-loss-of-precision
    // 也会拦。写成 BigInt 再转，能如实表达「这个值超出安全范围」而不丢精度。
    const beyondSafe = Number(BigInt('9007199254740993'))
    expect(beyondSafe).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    expect(() => computeConfigHash({ feature_flags: { limit: beyondSafe } }))
      .toThrow(/双精度安全整数范围/)
  })

  it('bool 与普通整数必须放行（判据不得误伤 feature flag）', () => {
    expect(computeConfigHash({ feature_flags: { on: true, off: false, max: 100, min: 0 } })).toMatch(/^[0-9a-f]{16}$/)
  })

  it('错误信息必须带路径：39 个运营页面，只说「含非整数」等于让人自己猜', () => {
    expect(() => computeConfigHash({ platform_defs: [{ key: 'douyin', maxCoverSize: 1.5 }] }))
      .toThrow(/platform_defs\[0\]\.maxCoverSize/)
  })

  it('嵌套数组/对象里的非整数同样被拦', () => {
    expect(() => computeConfigHash({ rewrite_strategies: [{ items: [{ weight: 0.3 }] }] }))
      .toThrow(/rewrite_strategies\[0\]\.items\[0\]\.weight/)
  })
})

describe('§L3 种子探测不得走 Electron 的 asar Stats 兼容层（Node DEP0180 源头）', () => {
  const MOD = path.join(__dirname, 'ops-runtime-snapshot.js')

  it('结构锁：_probeSeed 只能 open+fstat 探测，禁止 statSync/lstatSync/promises.stat，close 必须在 finally', () => {
    const src = fs.readFileSync(MOD, 'utf8')
    const start = src.indexOf('_probeSeed () {')
    expect(start).toBeGreaterThan(-1)
    const tail = src.slice(start)
    const closing = tail.match(/\r?\n  \}\r?\n/)
    expect(closing).toBeTruthy()
    // 判据必须先剥注释再匹配：本函数的注释里就写着被禁 API 的名字，用来解释"为什么不用它"。
    // 不剥注释 ⇒ 注释被当成代码命中（本仓已知的「结构锁不剥注释 = 幽灵通道」形态）。
    const body = tail.slice(0, closing.index).split(/\r?\n/).filter((l) => !l.trimStart().startsWith('//')).join('\n')
    expect(body).not.toMatch(/fs\.statSync/)
    expect(body).not.toMatch(/fs\.lstatSync/)
    expect(body).not.toMatch(/fs\.promises\.stat/)
    // 完整性断言：切片必须真的覆盖到函数末尾那条「所有候选都不命中」的返回。
    // 没有它，将来若重构让 body 提前截断，锁就只检查半截函数体而照样绿（装饰性门禁）。
    expect(body).toContain('this._seedPaths[0]')
    expect(body).toMatch(/fs\.openSync/)
    expect(body).toMatch(/fs\.fstatSync/)
    expect(body).toMatch(/finally\s*\{[\s\S]*?fs\.closeSync/)
  })

  it('行为锁：超限种子必须在读盘之前就被拒绝——readFileSync 一次都不能被调用', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-seed-noread-'))
    const seedPath = path.join(dir, 'runtime-bootstrap.json')
    fs.writeFileSync(seedPath, ' '.repeat(MAX_SNAPSHOT_BYTES + 16), 'utf8')
    const fsCjs = require('fs')
    const spy = vi.spyOn(fsCjs, 'readFileSync')
    try {
      const svc = new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, seedPath })
      expect(svc.readSeed()).toBeNull()
      expect(svc.getSeedStatus()).toMatchObject({ exists: true, usable: false })
      // 判据按「有没有读的是这一条候选」过滤，而不是「readFileSync 总调用数为 0」：
      // 后者会把运行器在同进程内的无关读取也算进来，变成偶发 flake（外部评审命中）。
      const hit = spy.mock.calls.filter((c) => String(c[0]) === seedPath)
      expect(hit.length).toBe(0)
    } finally {
      spy.mockRestore()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('行为锁：目录占位与文件缺失都只报「没有可用种子」，不得抛错', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-seed-dir-'))
    const dirAsSeed = path.join(dir, 'runtime-bootstrap.json')
    fs.mkdirSync(dirAsSeed)
    const svc = new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, seedPath: dirAsSeed })
    expect(() => svc.readSeed()).not.toThrow()
    expect(svc.readSeed()).toBeNull()
    expect(svc.getSeedStatus().exists).toBe(false)
    const svc2 = new OpsRuntimeSnapshot({ store: makeStore(), log: LOG, seedPath: path.join(dir, 'nope.json') })
    expect(svc2.readSeed()).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
