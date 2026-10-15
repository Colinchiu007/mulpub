// @ts-check
/**
 * settings-roundtrip-contract.test.js — 「应用设置」真源的读写往返契约
 *
 * 被测的是**类型语义**：`setSetting` 写进去的语义值，换一个全新 Store 实例（关闭并重新
 * 打开同一份库文件，即真实重启）后必须等价读回。
 *
 * 接缝只有两个，且都不是被测逻辑：
 *   1) `app.getPath('userData')` → 指向 `os.tmpdir()` 下带 pid+随机后缀的独立目录
 *      （禁止仓库内共享路径：并发会话会同时执行本文件）；
 *   2) `./crypto` → safeStorage 在测试环境不可用，用保类型的假实现替代（ encrypt/decrypt
 *      往返仍成立），被测的存储往返一律走真实 `Store` + 真实 `sqlite-wrapper`(sql.js)。
 *
 * 背景：见 openspec change fix-settings-roundtrip-contract。此前该缺陷由
 * `ops-center-sync.test.js` 的 `makeStore`（存的类型原样回吐）结构性免疫掉，
 * 本文件以真实存储为绝对下界。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

__enableElectronMock()
__registerMock('./crypto', {
  isAvailable: () => true,
  encrypt: (key) => (key ? Buffer.from('enc_' + key) : null),
  // 必须与真实 `crypto.decrypt` 同形：真实实现经 `_toBuffer` 对字符串按 **base64** 解码，
  // 再交给 safeStorage。少了 base64 这个 fake 就只在自己身上往返，测不到落盘形态。
  decrypt: (value) => (value ? Buffer.from(String(value), 'base64').toString('utf8').replace(/^enc_/, '') : ''),
  mask: (key) => (key ? key.slice(0, 4) + '****' + key.slice(-4) : '****'),
  setSafeStorage: () => {},
})

const Store = require('./store')
const SqliteDatabase = require('./sqlite-wrapper')
const { OpsCenterSync } = require('./ops-center-sync')
const { DiagnosticsReporter } = require('./diagnostics-reporter')
const { PublishReporter } = require('./publish-reporter')
const { UsageReporter } = require('./usage-reporter')

const RUNTIME_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAr6a4g942N23o31XNIcwFGX9VhSu2jlGA9dT1bfJIDpg=',
  '-----END PUBLIC KEY-----',
].join('\n')

/** @type {string} */
let userDataDir
/** @type {any} */
let store

/** 打开一份真实库文件；失败必须响亮报错，不允许静默降级成"什么都没测" */
function openStore () {
  const s = new Store()
  const ok = s.init()
  if (!ok || s._ready !== true) {
    throw new Error('真实 Store 未能就绪（init 返回 ' + ok + '，_ready=' + s._ready + '）——探针自身失效，本文件不得产出任何结论')
  }
  return s
}

/** 模拟应用重启：关闭当前句柄（内部会 persist），再以同一路径重开 */
function restartStore () {
  if (store) { try { store.close() } catch { /* 已关闭 */ } }
  store = openStore()
  return store
}

beforeAll(async () => {
  await SqliteDatabase.ready
})

beforeEach(() => {
  userDataDir = path.join(os.tmpdir(), 'mp-settings-roundtrip-' + process.pid + '-' + Math.random().toString(36).slice(2, 10))
  fs.mkdirSync(userDataDir, { recursive: true })
  __electronMock.app.getPath = () => userDataDir
  store = openStore()
})

afterEach(() => {
  if (store) { try { store.close() } catch { /* ignore */ } }
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

describe('Settings 真源：存储侧读回归一化（真实 Store）', () => {
  it('写入对象后，重开库的实例按 getSettingObject 等价读回', () => {
    const payload = { url: 'http://127.0.0.1:8010', nested: { a: 1 }, list: ['x', 'y'] }
    store.setSetting('roundtripStoreProbe', payload)

    const reopened = restartStore()
    expect(typeof reopened.getSettingObject).toBe('function')
    expect(reopened.getSettingObject('roundtripStoreProbe', {})).toEqual(payload)
  })

  it('存量行（修复前 JSON.stringify 写法）无需迁移即可读回', () => {
    store.setSetting('roundtripLegacyRow', JSON.stringify({ lastId: 42 }))
    const reopened = restartStore()
    expect(reopened.getSettingObject('roundtripLegacyRow', {})).toEqual({ lastId: 42 })
  })

  it('损坏行返回调用方声明的默认值，不抛且不把垃圾当配置', () => {
    store.setSetting('roundtripCorrupt', 'not-json{')
    const reopened = restartStore()
    expect(reopened.getSettingObject('roundtripCorrupt', { fallback: true })).toEqual({ fallback: true })
  })

  it('键不存在时返回默认值（缺席不等于错误）', () => {
    const reopened = restartStore()
    expect(reopened.getSettingObject('roundtripAbsent', { d: 1 })).toEqual({ d: 1 })
  })
})

describe('Settings 真源：OpsCenterSync 配置与运营菜单重启后必须恢复（Bug 探针）', () => {
  it('saveConfig 写入的手动地址与 Key，重启后仍读得到', () => {
    const svc = new OpsCenterSync({ store, log: { info () {}, warn () {}, error() {}, notify() {} } })
    const saved = svc.saveConfig({ url: 'http://127.0.0.1:8010', apiKey: 'catalog-key-abc', autoSync: true, runtimePublicKey: RUNTIME_PUBLIC_KEY })
    expect(saved.code).toBe(0)

    // 落盘侧必须先自证写进去了，否则"读不到"可能只是没写
    const rawRow = store.db.prepare('SELECT value FROM settings WHERE key = ?').get('opsCenterSync')
    expect(rawRow).toBeTruthy()
    expect(JSON.parse(rawRow.value).url).toBe('http://127.0.0.1:8010')

    const reopened = restartStore()
    const afterRestart = new OpsCenterSync({ store: reopened, log: { info () {}, warn () {}, error() {}, notify() {} } })
    const cfg = afterRestart.getConfig()
    // 2026-10-15：url 混装别名已移除，改断 manualUrl（落盘形状 url 见上一行，仍保持不变）
    expect(cfg.manualUrl).toBe('http://127.0.0.1:8010')
    expect(cfg.effectiveUrl).toBe('http://127.0.0.1:8010')
    expect(cfg.apiKeyConfigured).toBe(true)
    expect(cfg.runtimePublicKey).toBe(RUNTIME_PUBLIC_KEY)
    expect(afterRestart.getCatalogApiKey()).toBe('catalog-key-abc')
  })

  it('applyRuntime 落盘的应用菜单，重启后无需再同步即可恢复', () => {
    const svc = new OpsCenterSync({ store, log: { info () {}, warn () {}, error() {}, notify() {} } })
    const menu = { items: [{ key: 'copy-library', visible: true, sort_order: 1, group: 'more' }] }
    svc.applyRuntime({ announcements: [], appMenu: menu, synced_at: '2026-10-01T00:00:00Z' })
    expect(svc.getAppMenu()).toBeTruthy()

    const reopened = restartStore()
    const afterRestart = new OpsCenterSync({ store: reopened, log: { info () {}, warn () {}, error() {}, notify() {} } })
    const restored = afterRestart.getAppMenu()
    expect(restored).toBeTruthy()
    expect(restored.items.map((i) => i.key)).toEqual(['copy-library'])
  })

  it('从未成功同步过时空库读取不抛，且如实呈现"无配置"（fail-open 语义）', () => {
    const reopened = restartStore()
    const svc = new OpsCenterSync({ store: reopened, log: { info () {}, warn () {}, error() {}, notify() {} } })
    expect(() => svc.getConfig()).not.toThrow()
    expect(svc.getConfig().apiKeyConfigured).toBe(false)
    expect(svc.getAppMenu()).toBeNull()
  })
})

describe('Settings 真源：三个上报水位线重启后不得归零（Bug 探针）', () => {
  const cases = [
    { name: 'DiagnosticsReporter', make: (s) => new DiagnosticsReporter({ store: s }), write: (r) => r._saveWatermark(7), read: (r) => r._getWatermark(), expectValue: 7 },
    { name: 'UsageReporter', make: (s) => new UsageReporter({ store: s }), write: (r) => r._saveWatermark(9), read: (r) => r._getWatermark(), expectValue: 9 },
    { name: 'PublishReporter', make: (s) => new PublishReporter({ store: s }), write: (r) => r._saveWatermark('2026-10-01T00:00:00Z'), read: (r) => r._getWatermark(), expectTs: '2026-10-01T00:00:00Z' },
  ]

  for (const c of cases) {
    it(c.name + ' 的水位线在重启后读回上一份值', () => {
      const writer = c.make(store)
      c.write(writer)

      const reopened = restartStore()
      const afterRestart = c.make(reopened)
      const value = c.read(afterRestart)
      if (c.expectTs) expect(value.lastTs).toBe(c.expectTs)
      else expect(value).toBe(c.expectValue)
    })
  }
})

describe('Settings 真源：禁止第二份归一化实现重新长出来', () => {
  const files = [
    'ops-center-sync.js',
    'diagnostics-reporter.js',
    'publish-reporter.js',
    'usage-reporter.js',
  ]

  // 单一判据：本锁测的是「把 getSetting/getUserSetting 的返回值当字符串再处理」这一形状，不是禁止 String() 本身。
  //
  // 为什么不是字符邻接正则：两位评审各自指出旧写法过宽（String(getSettingObject(K,{}).url) 被误判），
  // 而后端评审实测出更关键的一半——收窄成 getSetting\s*\( 之后**漏掉了修复前的真实原形**：
  //   String(this._store?.getSetting ? this._store.getSetting(SETTING_KEY) || '' : '')
  // （`String(` 后面先遇到 ` ? ` 里的空格，字符类就断了）。即"消误报"顺手把锁改弱了。
  // 正解是按语义取实参：找到 String( 的配对右括号，再看实参文本里是否引用了读取方法——
  // 成员空格、方括号访问、可选链、三元守卫、跨行都天然覆盖；getSettingObject 是另一个词，不会命中。
  // 下方判据矩阵的正例逐条取自 origin/main 的修复前原文（不是转述），把本函数改成恒返回空数组必须立刻变红。
  //
  // 本锁的**边界**（后端复核实测，勿当"不可能再长出来"来信任它）：
  //   1) 拆句等价绕得过 —— `const raw = getSetting(K)` 另起一行再 `String(raw)`／`JSON.parse(raw)`，语义同一个错，本锁看不见；
  //   2) 别名与方法名动态取 —— `const g = store.getSetting` 后再 String(g(K))，或 `store[key](K)`；
  //   3) 实参里带字面量右括号会把配对扫描提前收口（如 String(f("a)b"))），属已知欠精确，不是漏判形状；
  //   4) 扫描域是下面 files 里写死的 4 个文件，新增同用途文件不会自动被守。
  // 也就是说它守的是"这四个文件里别再出现这种写法"，不是"全仓不可能有第二份归一化"。真要跨面收口得走 AST 判据 + 全仓棘轮清单
  // （见 docs/settings-persistence-contract.md §6 的 13 处待收敛登记）。
  function findStringReadsOfSettings (src) {
    const hits = []
    const re = /\bString\s*\(/g
    let m
    while ((m = re.exec(src))) {
      const start = m.index + m[0].length
      let depth = 1
      let i = start
      while (i < src.length && depth > 0) {
        const c = src[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        i++
      }
      if (depth !== 0) continue
      const arg = src.slice(start, i - 1)
      if (/\bget(?:User)?Setting\b/.test(arg)) hits.push(arg.replace(/\s+/g, ' ').slice(0, 90))
    }
    return hits
  }

  for (const f of files) {
    it(f + ' 不得再用 String(getSetting(...)) 的误判口径读配置', () => {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
      expect(findStringReadsOfSettings(src)).toEqual([])
    })
  }

  it('结构锁判据矩阵：历史原形与各类绕行写法必须全被抓到，新入口不得被误伤', () => {
    // 正例逐条对齐 origin/main 修复前原文与可达绕行写法
    const mustFlag = [
      "raw = String(this._store?.getSetting ? this._store.getSetting(SETTING_KEY) || '' : '')",
      'String(store.getSetting(K))',
      'String(store . getSetting(K))',
      "String(store['getSetting'](K))",
      'String(this._store?.getSetting(K))',
      'String(getSetting(\n  K\n))',
      'String(store.getUserSetting(K, null, owner))',
    ]
    for (const s of mustFlag) {
      // 必须长度精确：toBeTruthy() 对空数组同样成立，会让本锁对『恒返回空数组』这种 no-op 完全免疫
      // （M4' 变异实测抓到并报绿，即上一版本矩阵是装饰性断言）
      expect(findStringReadsOfSettings(s).length).toBe(1)
    }
    // 负例：合法演进不得判红，否则下一个会话会直接把锁删掉
    const mustNotFlag = [
      'String(store.getSettingObject(KEY, {}).url)',
      'String(this._store.getSettingObject(SETTING_KEY, {}).lastSyncedAt)',
      'String(getSettings())',
      'String(value)',
      'String(myObj.settings)',
    ]
    for (const s of mustNotFlag) {
      expect(findStringReadsOfSettings(s)).toEqual([])
    }
  })})

// ---------------------------------------------------------------------------
// 装配面锁（QM6-W6）：窄包装与存储契约的版本差必须有人看守。
// hot-topics-service 经 container.setup.js 拿到的是只转发部分方法的窄包装；OpsCenterSync 与三个 reporter
// 经 phase1-context.js 拿到的是完整 Store 实例——同一真源因此存在两种形状。本锁不要求窄包装转发全部方法
// （那会凭空登记三条无关欠账），只管一件事：存储契约新增「对象语义读取入口」时，窄包装要么转发、要么在此显式认欠。
// ---------------------------------------------------------------------------
describe('Settings 真源：窄包装装配面不得静默落后于存储契约', () => {
  function forwardedMethods () {
    const src = fs.readFileSync(path.join(__dirname, '../core/container.setup.js'), 'utf8')
    const literal = src.match(/settingsStore:\s*\{([^}]*)\}/)
    expect(literal).toBeTruthy()
    return [...literal[1].matchAll(/([A-Za-z_]\w*)\s*:/g)].map((m) => m[1])
  }

  it('窄包装转发的每个方法都必须真实存在于 settings-store 契约', () => {
    const contract = Object.keys(require('./store/settings-store'))
    expect(forwardedMethods().length).toBeGreaterThan(0)
    expect(forwardedMethods().filter((k) => !contract.includes(k))).toEqual([])
  })

  it('对象语义读取入口的未转发清单只能缩小，扩了转发就必须当场销账', () => {
    const contract = Object.keys(require('./store/settings-store'))
    // 判据按形态取，不按方法名枚举，避免把无关方法也算成欠账
    const objectEntries = contract.filter((k) => /^get.*Object$/.test(k))
    expect(objectEntries.length).toBeGreaterThan(0)
    const lagging = objectEntries.filter((k) => !forwardedMethods().includes(k)).sort()
    // 已认欠：hot-topics 仍用自身三处手抄归一化，扩转发属独立切片（docs/settings-persistence-contract.md §6）
    const KNOWN_LAGGING = ['getSettingObject']
    expect(lagging).toEqual(KNOWN_LAGGING.slice().sort())
  })
})
