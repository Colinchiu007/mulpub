/**
 * evasions.test.js — 主世界反检测源码的行为与结构锁
 *
 * 本文件的两条纪律（都来自本仓真实事故）：
 *   ① **必须执行真实源码本体，不能只断言字符串**。旧 `stealth-preload.js` 的教训是
 *      "代码在、注释在、测试在、单测全绿"而功能从未生效；只断言"源码里出现了 defineProperty"
 *      对"逻辑写错但字符串形状对"完全免疫。故这里直接调用 `buildMainWorldFn`，
 *      在受控假 window 上跑真逻辑。
 *   ② **必须锁住"不许碰的项"**。实测已证 `webdriver` / `plugins` / `mimeTypes` / `vendor` /
 *      `chrome.runtime` 在 Electron 与真实 Chrome 上**本就一致**；旧文件对前三项动手，
 *      反而制造了 `Native Client` 这类现代 Chrome 不存在的假插件。所以"不修改"本身要有锁。
 */
// 本仓 vitest 配置为 globals:true（describe/it/expect/vi 均为全局），CJS 测试文件
// 不得 `require('vitest')`——vitest 会拒绝（"cannot be imported in a CommonJS module"）。

const {
  MARKER_KEY,
  SOURCE_VERSION,
  PROVENANCE,
  EVASION_IDS,
  CONTRACT,
  buildEvasionSource,
  buildMainWorldFn,
} = require('./evasions')

/** 在受控全局上执行真实源码本体；返回标记对象 */
function runEvasions () {
  buildMainWorldFn(MARKER_KEY, EVASION_IDS, SOURCE_VERSION)
  return globalThis.window[MARKER_KEY]
}

/**
 * 夹具：模拟 Electron 的**实测**状态——chrome 为空对象、无 userAgentData 的 Google Chrome 品牌、
 * 权限一律 granted。取值为 2026-10-15 真机实测值（见 evasions.js 对照表）。
 */
const ORIGINAL = {}

/** 真实 Electron 43 的 UA 形态（含 `Chrome/150.…` token；evasion 依此推导品牌版本） */
const ELECTRON_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.250 Electron/43.7.7 Safari/537.36'

function installElectronFixture ({ withHostObjects = true, notificationPermission = 'granted', userAgent = ELECTRON_UA } = {}) {
  ORIGINAL.chrome = Object.getOwnPropertyDescriptor(globalThis.window, 'chrome')
  ORIGINAL.notification = Object.getOwnPropertyDescriptor(globalThis.window, 'Notification')
  ORIGINAL.userAgent = Object.getOwnPropertyDescriptor(globalThis.window.navigator, 'userAgent')

  // jsdom 自带 UA 里**没有** `Chrome/<major>` token，而 evasion 靠它推导品牌版本；
  // 不设真实 UA 会让此项静默跳过、断言却仍在跑（首版夹具即如此，红了）。
  Object.defineProperty(globalThis.window.navigator, 'userAgent', {
    configurable: true,
    writable: true,
    value: userAgent,
  })

  globalThis.window.chrome = {}
  // ⚠️ 必须建成**访问器**而不是数据属性：真实 Chrome/Electron 的 `Notification.permission`
  // 是 static getter，源码据此判定"该不该接管"；夹具若用数据属性，判定条件恒不成立，
  // 于是被测逻辑被静默跳过而断言仍然跑——典型的"夹具替实现撒谎"（首版夹具即如此，红了）。
  let currentPermission = notificationPermission
  const notificationCtor = function Notification () {}
  Object.defineProperty(notificationCtor, 'permission', {
    configurable: true,
    get: () => currentPermission,
  })
  notificationCtor.requestPermission = () => Promise.resolve(currentPermission)
  // 供用例直接改"内核真实返回值"（模拟真实 Electron 的 granted）
  notificationCtor.__setNativePermission = (value) => { currentPermission = value }
  globalThis.window.Notification = notificationCtor

  if (withHostObjects) {
    Object.defineProperty(globalThis.navigator, 'userAgentData', {
      configurable: true,
      value: {
        brands: [{ brand: 'Not;A=Brand', version: '8' }, { brand: 'Chromium', version: '150' }],
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: () => Promise.resolve({
          brands: [{ brand: 'Not;A=Brand', version: '8' }, { brand: 'Chromium', version: '150' }],
          platform: 'Windows',
        }),
      },
    })
    // jsdom 未实现 Permissions API，且**没有** `navigator.permissions` 实例——
    // 源码按真实宿主 `window.Permissions.prototype` 打补丁，故断言必须经原型构造出的实例
    // 调用（不能走 jsdom 的 navigator.permissions，它不存在）。
    globalThis.window.Permissions = function Permissions () {}
    globalThis.window.Permissions.prototype.query = function (descriptor) {
      return Promise.resolve({ state: 'granted', onchange: null, __name: descriptor && descriptor.name })
    }
    globalThis.window.PermissionStatus = function PermissionStatus () {}
  }
}

/** 经真实宿主形态（Permissions.prototype）发起查询，返回 PermissionStatus 形态对象 */
function queryPermission (name) {
  const instance = new globalThis.window.Permissions()
  return instance.query({ name })
}

function restoreFixture () {
  // 夹具是**新增**的全局属性时必须删掉，不能只"还原已有的"——否则会污染同进程后续用例
  // （vitest 同文件共享 jsdom 全局，且本仓 vitest 配置为 maxWorkers:1）
  if (ORIGINAL.chrome) Object.defineProperty(globalThis.window, 'chrome', ORIGINAL.chrome)
  else delete globalThis.window.chrome
  if (ORIGINAL.notification) Object.defineProperty(globalThis.window, 'Notification', ORIGINAL.notification)
  else delete globalThis.window.Notification
  if (ORIGINAL.userAgent) Object.defineProperty(globalThis.window.navigator, 'userAgent', ORIGINAL.userAgent)
  delete globalThis.window[MARKER_KEY]
  delete globalThis.navigator.userAgentData
  delete globalThis.window.Permissions
  delete globalThis.window.PermissionStatus
}

describe('stealth/evasions — 源码结构契约', () => {
  it('源码是可直接求值的表达式，且不含模块系统调用（主世界无 require）', () => {
    const source = buildEvasionSource()
    expect(typeof source).toBe('string')
    expect(source.length).toBeGreaterThan(500)
    // 主世界没有模块系统：出现 require/import 语句即为致命错误（vite/浏览器都会抛）
    expect(source).not.toMatch(/\brequire\s*\(/)
    expect(source).not.toMatch(/\bimport\s+[\w{*]/)
    // 语法必须可解析（不执行，仅编译）
    expect(() => new Function(source)).not.toThrow()
  })

  it('源码以带参立即调用形态包装，主世界不依赖任何闭包变量', () => {
    const source = buildEvasionSource()
    // 不锁字面空格：真源形如 `(function buildMainWorldFn (markerKey, …) {`，
    // 而不同转译/格式化会改变空格；锁"是带参 IIFE + 三个实参逐字在场"即可
    expect(source).toMatch(/^\(function\s+buildMainWorldFn\s*\(/)
    expect(source.trimEnd().endsWith(');')).toBe(true)
    // 三个实参逐字落在调用尾部（标记名 / evasion id 清单 / 版本）
    expect(source).toContain(JSON.stringify(MARKER_KEY))
    expect(source).toContain(JSON.stringify(SOURCE_VERSION))
    for (const id of EVASION_IDS) expect(source).toContain(JSON.stringify(id))
    // 闭包隔离的证据：函数体引用的三个标识符都由调用实参提供，源码内不得出现自由变量赋值
    expect(source).toContain('var MARKER_KEY = markerKey')
  })

  it('PROVENANCE 记录的参照实现版本与已安装版本一致（单一真源机械核对）', () => {
    // 版本漂移时这条会红：要么同步 PROVENANCE，要么确认技术路线未被上游改动后显式更新
    const installed = require('puppeteer-extra-plugin-stealth/package.json').version
    expect(PROVENANCE.package).toBe('puppeteer-extra-plugin-stealth')
    expect(PROVENANCE.license).toBe('MIT')
    expect(PROVENANCE.version).toBe(installed)
  })

  it('每项 evasion id 都恰好被源码引用一次（防漏接线/重复接线）', () => {
    const source = buildEvasionSource()
    for (const id of EVASION_IDS) {
      const hits = source.split("apply('" + id + "'").length - 1
      expect(hits, `${id} 在源码中的 apply 调用数`).toBe(1)
    }
  })
})

describe('stealth/evasions — 主世界行为（执行真实源码本体）', () => {
  beforeEach(() => installElectronFixture())
  afterEach(() => restoreFixture())

  it('标记三态：start 与 done 均写入，且 applied 覆盖全部 evasion', () => {
    const state = runEvasions()
    expect(state).toBeTruthy()
    expect(typeof state.start).toBe('number')
    expect(state.done).toBe(1)
    expect(state.version).toBe(SOURCE_VERSION)
    expect(state.failed).toEqual([])
    expect(state.applied.sort()).toEqual([...EVASION_IDS].sort())
  })

  it('补齐 window.chrome 的三个遗留属性（真实 Chrome 为 loadTimes/csi/app）', () => {
    runEvasions()
    const chrome = globalThis.window.chrome
    expect(Object.keys(chrome).sort()).toEqual([...CONTRACT.CHROME_LEGACY_KEYS].sort())
    expect(typeof chrome.app).toBe('object')
    expect(typeof chrome.csi).toBe('function')
    expect(typeof chrome.loadTimes).toBe('function')
    // 取值形态必须与真实 API 同形（数值为秒，源自 performance.timing）
    const csi = chrome.csi()
    expect(typeof csi.startE).toBe('number')
    expect(typeof csi.pageT).toBe('number')
    const loadTimes = chrome.loadTimes()
    expect(typeof loadTimes.requestTime).toBe('number')
    expect(typeof loadTimes.navigationType).toBe('string')
  })

  it('已存在 chrome 属性时不得覆盖（幂等，尊重宿主真实实现）', () => {
    const nativeCsi = () => ({ native: true })
    globalThis.window.chrome = { csi: nativeCsi, app: { native: true } }
    runEvasions()
    expect(globalThis.window.chrome.csi).toBe(nativeCsi)
    expect(globalThis.window.chrome.app).toEqual({ native: true })
    // loadTimes 缺失则补，已有则留
    expect(typeof globalThis.window.chrome.loadTimes).toBe('function')
  })

  it('userAgentData.brands 补上 Google Chrome 且保留内核自带 GREASE 品牌', () => {
    runEvasions()
    const brands = globalThis.navigator.userAgentData.brands
    expect(Array.isArray(brands)).toBe(true)
    expect(brands.map((b) => b.brand)).toEqual(['Google Chrome', 'Not;A=Brand', 'Chromium'])
    // 版本取自自身 UA 的 Chrome 主版本（自洽），不是硬编码字面量
    const major = /Chrome\/(\d+)/.exec(globalThis.navigator.userAgent)[1]
    expect(brands[0].version).toBe(major)
    // GREASE 品牌原样保留（内核按版本生成，改动会与内核其它信号矛盾）
    expect(brands[1]).toEqual({ brand: 'Not;A=Brand', version: '8' })
  })

  it('userAgentData 取值必须是数组而不是函数（曾因此整字段在序列化中消失）', () => {
    runEvasions()
    expect(typeof globalThis.navigator.userAgentData.brands).not.toBe('function')
    expect(typeof globalThis.navigator.userAgentData.mobile).not.toBe('function')
    // 该字段要能原样通过 JSON 往返（页面常用 JSON 序列化做指纹上报）
    expect(JSON.parse(JSON.stringify(globalThis.navigator.userAgentData.brands))).toHaveLength(3)
  })

  it('高熵值的 brands 与低熵一致（否则自相矛盾，可被两行代码识破）', async () => {
    runEvasions()
    const values = await globalThis.navigator.userAgentData.getHighEntropyValues(['brands'])
    expect(values.brands).toEqual(globalThis.navigator.userAgentData.brands)
    // 其余字段必须原样透传，不得被吃掉
    expect(values.platform).toBe('Windows')
  })

  it('already-has-Google-Chrome 时幂等：不重复插入', () => {
    // 用 defineProperty 而非赋值：夹具把 userAgentData 定义为不可写数据属性，
    // 直接赋值会抛 "Cannot assign to read only property"（首版即如此）
    Object.defineProperty(globalThis.window.navigator, 'userAgentData', {
      configurable: true,
      value: {
        brands: [{ brand: 'Google Chrome', version: '150' }, { brand: 'Chromium', version: '150' }],
        mobile: false,
        platform: 'Windows',
      },
    })
    runEvasions()
    expect(globalThis.navigator.userAgentData.brands.map((b) => b.brand)).toEqual(['Google Chrome', 'Chromium'])
  })

  it('UA 无 Chrome token 时安全跳过（不猜版本），且不抛错', () => {
    installElectronFixture({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 jsdom/24.0.0' })
    const state = runEvasions()
    expect(state.done).toBe(1)
    // 原样透传内核品牌列表，不插入版本未知的 Google Chrome
    expect(globalThis.navigator.userAgentData.brands.map((b) => b.brand)).toEqual(['Not;A=Brand', 'Chromium'])
  })

  it('Notification.permission 由内核默认的 granted 改为全新站点态 default', () => {
    runEvasions()
    expect(globalThis.window.Notification.permission).toBe(CONTRACT.FRESH_SITE_NOTIFICATION_PERMISSION)
  })

  it('Notification.permission 真实的 denied 保留（不把用户级拒绝伪装成未决定）', () => {
    installElectronFixture({ notificationPermission: 'denied' })
    runEvasions()
    expect(globalThis.window.Notification.permission).toBe('denied')
  })

  it('requestPermission 与 permission 读数一致（不得一个 granted 一个 default）', async () => {
    runEvasions()
    const result = await globalThis.window.Notification.requestPermission()
    expect(result).toBe(globalThis.window.Notification.permission)
  })

  it('permissions.query 对实测被误报的 5 项返回 prompt，且保 instanceof PermissionStatus', async () => {
    runEvasions()
    const covered = ['notifications', 'geolocation', 'camera', 'microphone', 'clipboard-read']
    for (const name of covered) {
      const status = await queryPermission(name)
      expect(status.state, name).toBe(CONTRACT.FRESH_SITE_PERMISSION_STATE)
      // 换普通对象而不保原型会被一行 instanceof 识破
      expect(status instanceof globalThis.window.PermissionStatus, name).toBe(true)
    }
  })

  it('未覆盖的权限原样透传（未知权限不猜，避免把真实状态改坏）', async () => {
    runEvasions()
    const status = await queryPermission('persistent-storage')
    expect(status.state).toBe('granted')
    expect(status.__name).toBe('persistent-storage')
  })
})

describe('stealth/evasions — 不许碰的项（防后人"顺手"改坏）', () => {
  beforeEach(() => installElectronFixture())
  afterEach(() => restoreFixture())

  it('源码不得出现 webdriver / plugins / mimeTypes / chrome.runtime 的改写', () => {
    // 实测：这四项在 Electron 43 与真实 Chrome 155 上取值一致（webdriver=false、
    // plugins 5 项同名、chrome.runtime 同为 undefined）。旧 stealth-preload.js 对前三项动手，
    // 制造了 Native Client 假插件等**比原状更明显**的特征。
    const source = buildEvasionSource()
    expect(source).not.toMatch(/webdriver/)
    expect(source).not.toMatch(/['"]plugins['"]/)
    expect(source).not.toMatch(/mimeTypes/)
    expect(source).not.toMatch(/runtime\s*=/)
    // languages 同样不碰：只改 JS 读数会与 Accept-Language 请求头不一致
    expect(source).not.toMatch(/['"]languages['"]/)
  })

  it('源码不得包含伪造的插件清单（Native Client 等）', () => {
    const source = buildEvasionSource()
    expect(source).not.toMatch(/Native Client/)
    expect(source).not.toMatch(/internal-pdf-viewer/)
    expect(source).not.toMatch(/PDF Viewer/)
  })
})

describe('stealth/evasions — 宿主对象缺失时必须安全降级', () => {
  beforeEach(() => installElectronFixture({ withHostObjects: false }))
  afterEach(() => restoreFixture())

  it('无 userAgentData / Permissions / Notification 时不抛错，且不把"宿主无此能力"记为失败', () => {
    const state = runEvasions()
    expect(state.done).toBe(1)
    // chrome.keys 仍应成功（chrome 由夹具提供）
    expect(state.applied).toContain('chrome.keys')
    // 宿主对象不存在时各 evasion 是**提前 return（跳过）**而不是抛错——缺能力属正常，
    // 不该被记成失败（否则真机上非 Chromium 环境会刷出一堆无意义告警）。
    // 契约只剩两条：不抛错、且每项都确实被求值过一次。
    expect(state.failed).toEqual([])
    expect(state.applied.length + state.failed.length).toBe(EVASION_IDS.length)
  })

  it('宿主对象存在但形状异常（getter 缺失）时同样安全跳过，不抛错', () => {
    // 真实场景：某些 Chromium 派生环境把 Notification.permission 实现为数据属性
    globalThis.window.Notification = { permission: 'granted' }
    expect(() => runEvasions()).not.toThrow()
    expect(globalThis.window[MARKER_KEY].done).toBe(1)
  })
})
