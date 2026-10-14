/**
 * 渲染层 ↔ preload 暴露面契约（fix-ipc-namespace-contract / QM-5 逃逸链第 2 层）
 *
 * 守的是什么：electron-bridge 的 invoke(method, …) 在 `typeof api[method] !== "function"`
 * 时**直接 return undefined**，invokeWithFallback 随后返回调用方的 fallback。
 * 渲染层拿到 `{ code: -1 }`，无异常、无 console 错误、界面零提示 ⇒ 功能表现为"点了没反应"。
 *
 * 为什么两侧测试都拦不住：
 *   - preload 侧：preload.test.js 把转发矩阵与暴露面测得很全
 *   - 渲染层侧：useFilmVideoGen.test.js / useFilmProduction.test.js 用 vi.mock('@/api/publisher')
 *     整体 mock 掉本模块，只断言"调用了 filmEngineeringRetryShot"，**从不断言 preload 是否真有该方法**
 *   ⇒ 缺的是**跨两侧的对账**。本文件就是那道接缝。
 *
 * 已知边界（勿当"不可能再发生"信任，见 docs/ipc-exposure-contract.md §七）：
 *   1) 拆句等价绕得过：`const m = "foo"; invokeWithFallback(m, …)` —— 首参非字面量
 *   2) 别名/动态取名绕得过：`const g = api.invoke; g("foo")`
 *   3) 字面量里带右括号会让配对扫描提前收口（如 invoke("a)b")）
 *   4) 扫描域是写死清单 —— 由「扫描域棘轮」用例兜底
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import Module from 'node:module'
import zh from '../../src/locales/zh.js'
import en from '../../src/locales/en.js'
import { formatUserError } from '../../src/utils/user-facing-error.js'

const FILM_CANVAS_VIEW = path.resolve(__dirname, '../../src/views/FilmCanvasView.vue')

const ELECTRON_DIR = path.resolve(__dirname, '..')
const API_DIR = path.resolve(__dirname, '../../src/api')
const PRELOAD_INDEX = path.join(ELECTRON_DIR, 'preload', 'index.js')
const ACCESS_CONTROL = path.join(ELECTRON_DIR, 'preload', 'access-control.js')

// ---------------------------------------------------------------------------
// 扫描域：显式清单。新增含调用的文件必须同时登记到此，并由「扫描域棘轮」用例强制。
// 两个排除项各有实测理由：
//   electron-bridge.js —— 它内部 invokeWithFallback → invoke(method,…) 是 wrapper 转发，
//                         首参是变量；不排除会被算成「动态取名」并阻塞棘轮
//   *.test.js          —— electron-bridge.test.js 里有 missing / missingMethod / testMethod /
//                         submit / importMedia 五个**假名**（专测 undefined 回落与 fallback 分支）
// ---------------------------------------------------------------------------
const SCAN_DOMAIN = [
  'automation.js',
  'cards.js',
  'cloud-publisher.js',
  'hot-topics.js',
  'identity.js',
  'knowledge-library.js',
  'model-providers.js',
  'ops-center-sync.js',
  'podcast-channel.js',
  'providers.js',
  'publisher.js',
  'quick-collect.js',
  'rate-limit.js',
  'services.js',
  'tts-voice-catalog.js',
  'tts-voice-clone.js',
]
const SCAN_EXCLUDED = ['electron-bridge.js', '*.test.js']

/**
 * 已知缺口白名单：**必须保持为空**。
 *
 * 历史（fix-ipc-namespace-contract 的 D7）曾登记三个死 wrapper
 * （pipelinePauseWithCheckpoint / pipelineRegisterPipeline / pipelineResumeFromCheckpoint）
 * ——它们在 preload 侧从未兑现同名方法、全仓零调用方，接上就会静默失效。
 * 当时选择「登记而非删除」，理由是删除会牵动 publisher.js 导出面与他人分支；
 * 该分支已合并，5937 文件全域扫描确认零功能调用点，故
 * `fix-dead-pipeline-wrappers` 把它们**删除**，并把本白名单收空。
 *
 * ⚠️ 为什么「只能缩小」在这里必须升级为「不得复加」：
 * 白名单清空后，若只保留原「只能缩小」断言，它会对空数组**空转通过**——
 * 与「负例不得误伤，否则下个会话把锁删掉」是同形陷阱。所以：
 *   - 本常量被下方用例断言**必须为空**；
 *   - 「只能缩小」用例在空表时**显式说明**而不是空转；
 *   - 真正承重的是对账用例本身：任何人新写一个指向不存在方法的 wrapper，
 *     「除已登记的已知缺口外…」会直接判红并点名，无需白名单。
 *
 * 若将来确有「暂时不能删」的真实约束（如他人在途分支），必须显式新增条目
 * 并写明原因与到期条件——那是显式决策，不该是默认路径。
 */
const KNOWN_GAP = []

// ---------------------------------------------------------------------------
// 暴露面真源（D4）
// 拦截 contextBridge.exposeInMainWorld 取 preload/index.js 的最终产物。
// 不手抄键名、不复刻 createDynamicAccessApi 的过滤逻辑、不组合部分工厂
// ——preload.test.js 只组合 7 个工厂（断言 334）就是"第二真源漂移"的活样本。
//
// 为什么用 Module._load 而不是 vi.mock('electron')：preload/index.js 是 CJS 源文件，
// vitest 注入的 require 走**真实 Node loader**，绕过 vi.mock 的 ESM 注册表
// ⇒ vi.mock 不生效，require('electron') 拿到的是 electron npm 包导出的
// **可执行文件路径字符串**，解构出 contextBridge/ipcRenderer 全为 undefined。
// 实测症状：TypeError: Cannot read properties of undefined (reading 'on')。
// 改用 Module._load 拦截同一个入口，本文件与纯 Node 探针脚本行为一致。
// ---------------------------------------------------------------------------
function loadSurfaceAt (level) {
  let captured = null
  let exposedKey = null
  const stub = {
    contextBridge: {
      exposeInMainWorld: (key, api) => {
        exposedKey = key
        captured = api
      },
    },
    ipcRenderer: {
      invoke: () => Promise.resolve(),
      send: () => {},
      on: () => {},
      once: () => {},
      removeListener: () => {},
      removeAllListeners: () => {},
      postMessage: () => {},
      // index.js 在 sendSync 缺失或返回非法值时回落 'public'（fail-closed），这里显式给值
      sendSync: () => level,
    },
    webUtils: { getPathForFile: () => '' },
  }

  const origLoad = Module._load
  Module._load = function (request, ...rest) {
    if (request === 'electron') return stub
    return origLoad.call(this, request, ...rest)
  }
  try {
    // 清掉 preload 目录的模块缓存，保证 index.js 按当前 level 重新执行
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}preload${path.sep}`)) delete require.cache[k]
    }
    require(PRELOAD_INDEX)
  } finally {
    Module._load = origLoad
  }

  if (!captured) throw new Error('未捕获 exposeInMainWorld —— preload/index.js 结构已变')
  const shaped = shapeOf(captured)
  shaped.exposedKey = exposedKey
  return shaped
}

function shapeOf (api) {
  const flat = []
  const namespaces = {}
  for (const [k, v] of Object.entries(api)) {
    if (typeof v === 'function') flat.push(k)
    else if (v && typeof v === 'object') {
      const members = Object.entries(v).filter(([, m]) => typeof m === 'function').map(([mk]) => mk)
      if (members.length) namespaces[k] = members.sort()
    } else flat.push(k) // 非函数常量也算暴露项
  }
  flat.sort()
  const nsNames = Object.keys(namespaces).sort()
  const set = new Set(flat)
  for (const n of nsNames) for (const m of namespaces[n]) set.add(m)
  return {
    exposedKey: null,
    topLevel: Object.keys(api).length,
    flat,
    namespaces,
    nsNames,
    resolvable: [...set].sort(), // 数组语义：测试里要 includes/filter
  }
}

function readList (src, name) {
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`))
  if (!m) throw new Error(`未在 access-control.js 里找到 ${name}`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

// ---------------------------------------------------------------------------
// 判据：从源码文本抽 invoke/invokeWithFallback 的首参字面量
// ---------------------------------------------------------------------------

/** 去掉行注释与块注释 —— 否则「把坏调用注释掉」就成了一条绕过路径 */
function stripComments (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)))
}

const CALL_RE = {
  // 两个入口都要排除「方法调用」形态：api.invoke( / this.invokeWithFallback( /
  // bridge.invoke( —— 那些是普通方法调用，不是桥接层入口。
  // 漏掉这一条的后果：`this.invokeWithFallback("x", null)` 会被算成真实调用点
  // （由本文件 2.2 判据矩阵实测抓出，不是推断）。
  invokeWithFallback: /(?<![A-Za-z0-9_$.])invokeWithFallback\s*\(/g,
  invoke: /(?<![A-Za-z0-9_$.])invoke\s*\(/g,
}

// 命名空间形态的桥接层入口：值为「实参个数」，命名空间固定写死的不在这里（invokePageManager 除外）
const NS_CALL_RE = {
  invokeNamespace: { source: '(?<![A-Za-z0-9_$.])invokeNamespace\\s*\\(', flags: 'g', arity: 2 },
  invokePageManager: { source: '(?<![A-Za-z0-9_$.])invokePageManager\\s*\\(', flags: 'g', arity: 1 },
}

function extractCalls (src) {
  const text = stripComments(src)
  const literal = []
  const dynamic = []
  // M-9 新增：`const NS = 'ttsVoice'` 这类模块级常量作首参是合理形态
  // （命名空间名在一个文件里只定义一次，比每处重复字面量更不易漂移）。
  // 这里先收集模块级字符串常量，遇常量名首参时替换成其值再判定；
  // 常量指向非字面量（表达式/动态拼接）的仍按 dynamic 处理。
  const constMap = {}
  for (const m of text.matchAll(/(?:^|\n)\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)'/g)) {
    constMap[m[1]] = m[2]
  }
  const resolveArg = (raw) => (Object.prototype.hasOwnProperty.call(constMap, raw) ? constMap[raw] : null)
  for (const [fn, re] of Object.entries(CALL_RE)) {
    const r = new RegExp(re.source, re.flags)
    let m
    while ((m = r.exec(text))) {
      let i = m.index + m[0].length
      while (i < text.length && /\s/.test(text[i])) i++
      if (text[i] === ')') continue // 无参
      const q = text[i]
      if (q === '"' || q === "'" || q === '`') {
        let j = i + 1
        let interpolated = false
        while (j < text.length && text[j] !== q) {
          if (q === '`' && text[j] === '$' && text[j + 1] === '{') interpolated = true
          if (text[j] === '\n') break
          j++
        }
        if (!interpolated && text[j] === q) {
          literal.push(text.slice(i + 1, j))
          continue
        }
      }
      let j = i
      let depth = 0
      while (j < Math.min(text.length, i + 120)) {
        const c = text[j]
        if (c === '(' || c === '[' || c === '{') depth++
        else if (c === ')' || c === ']' || c === '}') {
          if (depth === 0) break
          depth--
        } else if (c === ',' && depth === 0) break
        j++
      }
      dynamic.push({ fn, snippet: text.slice(i, j).replace(/\s+/g, ' ').trim().slice(0, 60) })
    }
  }

  // 命名空间形态：invokeNamespace('<ns>', '<method>', …) / invokePageManager('<method>', …)
  // 不做这一层的话，命名空间调用对判据完全隐形——把 filmEngineeringRetryShot 改成
  // invokeNamespace('filmEngineering', 'retryShot') 之后，扁平对账就再也看不见这条路径，
  // 下一个把 ns 名或 method 名写错的缺陷会一路进主干。
  const nsCalls = []
  for (const [fn, spec] of Object.entries(NS_CALL_RE)) {
    const r = new RegExp(spec.source, spec.flags)
    const arity = spec.arity
    let m
    while ((m = r.exec(text))) {
      const args = readCallArgs(text, m.index + m[0].length, arity)
      if (!args) continue
      // 首参（ns）/method 若是模块级常量名，先解析成字面量再判定
      const resolved = args.map((a) => {
        if (a.literal !== null) return a
        const v = resolveArg(a.snippet)
        return v !== null ? { literal: v } : a
      })
      if (resolved.every((a) => a.literal !== null)) {
        nsCalls.push({ fn, ns: arity === 2 ? resolved[0].literal : 'pageManager', method: resolved[arity - 1].literal })
      } else {
        dynamic.push({ fn, snippet: resolved.map((a) => (a.literal === null ? a.snippet : a.literal)).join(', ').slice(0, 60) })
      }
    }
  }
  return { literal, dynamic, nsCalls }
}

/** 从 '(' 之后读 arity 个实参，逐个判定「字符串字面量 or 非字面量」 */
function readCallArgs (text, from, arity) {
  const out = []
  let i = from
  for (let k = 0; k < arity; k++) {
    while (i < text.length && /[\s,]/.test(text[i])) i++
    if (i >= text.length) return null
    const q = text[i]
    if (q === '"' || q === "'" || q === '`') {
      let j = i + 1
      let interpolated = false
      while (j < text.length && text[j] !== q) {
        if (q === '`' && text[j] === '$' && text[j + 1] === '{') interpolated = true
        if (text[j] === '\n') break
        j++
      }
      if (interpolated || text[j] !== q) return null // 非简单字面量 → 交由调用方记为 dynamic
      out.push({ literal: text.slice(i + 1, j) })
      i = j + 1
    } else {
      let j = i
      let depth = 0
      while (j < Math.min(text.length, i + 80)) {
        const c = text[j]
        if (c === '(' || c === '[' || c === '{') depth++
        else if (c === ')' || c === ']' || c === '}') {
          if (depth === 0) break
          depth--
        } else if (c === ',' && depth === 0) break
        j++
      }
      out.push({ literal: null, snippet: text.slice(i, j).replace(/\s+/g, ' ').trim().slice(0, 40) })
      i = j
    }
  }
  return out
}

function collectProductionCalls () {
  const names = new Set()
  const dynamic = []
  const nsCalls = []
  for (const file of SCAN_DOMAIN) {
    const src = fs.readFileSync(path.join(API_DIR, file), 'utf8')
    const r = extractCalls(src)
    r.literal.forEach((n) => names.add(n))
    r.nsCalls.forEach((c) => nsCalls.push({ file, ...c }))
    dynamic.push(...r.dynamic.map((d) => ({ file, ...d })))
  }
  return { names: [...names].sort(), dynamic, nsCalls }
}

/**
 * 在整个 src/ 下数某个方法名的外部引用，排除 wrapper 自身定义所在的文件。
 * 用来把「死代码」这个判断做成可执行的——docs/ipc-exposure-contract.md 里
 * pipelinePauseWithCheckpoint 等三条登记的依据就是「除定义处外 0 引用」，
 * 这里把该依据固化成断言，防止白名单变成永久豁免。
 */
function countCallersOutside (name, definitionFile) {
  const hits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(js|vue|ts)$/.test(e.name)) {
        const rel = path.relative(API_DIR, full)
        if (rel === definitionFile) continue // wrapper 自身定义处不算调用方
        const src = fs.readFileSync(full, 'utf8')
        if (new RegExp(`\\b${name}\\b`).test(stripComments(src))) hits.push(rel)
      }
    }
  }
  walk(path.resolve(__dirname, '../../src'))
  return hits
}

// ===========================================================================

describe('暴露面真源（D4：拦截 exposeInMainWorld 的最终产物）', () => {
  it('public 与 admin 两面都必须取到，且 admin 面严格更大', async () => {
    const pub = await loadSurfaceAt('public')
    const adm = await loadSurfaceAt('admin')
    expect(pub.exposedKey).toBe('electronAPI')
    expect(adm.exposedKey).toBe('electronAPI')
    // admin 面只多出 ADMIN_ONLY_METHODS（design D5）
    expect(adm.topLevel).toBeGreaterThan(pub.topLevel)
  })

  it('admin 面减 public 面恰为 ADMIN_ONLY_METHODS 全集（D5 的核心不变量）', () => {
    const pub = loadSurfaceAt('public')
    const adm = loadSurfaceAt('admin')
    const adminOnly = readList(fs.readFileSync(ACCESS_CONTROL, 'utf8'), 'ADMIN_ONLY_METHODS')
    expect(adminOnly.length).toBeGreaterThan(0)

    // admin 面比 public 面多出来的可解析名，必须**恰好**是 ADMIN_ONLY_METHODS
    const extra = adm.resolvable.filter((k) => !pub.resolvable.includes(k)).sort()
    const expected = [...adminOnly].filter((k) => adm.resolvable.includes(k)).sort()
    expect(`admin 面比 public 面多出：${extra.join(', ')}；ADMIN_ONLY_METHODS 可解析者：${expected.join(', ')}`)
      .toBe(`admin 面比 public 面多出：${expected.join(', ')}；ADMIN_ONLY_METHODS 可解析者：${expected.join(', ')}`)

    // 反向：ADMIN_ONLY_METHODS 每个成员都必须在 admin 面存在
    for (const m of adminOnly) expect(adm.resolvable).toContain(m)
  })

  it('暴露面必须是完整组合而非部分工厂子集（D4 要防的漂移形态）', () => {
    const adm = loadSurfaceAt('admin')
    // 只组合 7 个工厂的 preload.test.js 得到 334 键；完整组合显著更大。
    // 用下界而非等值：加能力不该让这条红，**减能力必须红**。
    expect(adm.topLevel).toBeGreaterThanOrEqual(400)
    // 跨模块哨兵：证明确实覆盖 publish / system / services / knowledgeLibrary 多个工厂
    for (const sentinel of ['publishWechat', 'storeGetSetting', 'servicesRestart', 'addPersonalToLibrary']) {
      expect(adm.resolvable).toContain(sentinel)
    }
    // filmEngineering 命名空间与其成员必须在场（C-1 的正确名就在里面）
    expect(adm.nsNames).toContain('filmEngineering')
    expect(adm.namespaces.filmEngineering).toContain('retryShot')
  })
})

describe('判据矩阵（2.2：先证明判据本身正确，再谈用它守别人）', () => {
  // 正例：修复前真实原形 + 各类可达绕行写法。断言必须用 length/toBe(1)，
  // 不能用 toBeTruthy —— 空数组同样 truthy，会让判据对"恒返回空数组"的 no-op 完全免疫。
  const mustExtract = [
    'invokeWithFallback("filmEngineeringRetryShot", { code: -1 }, payload)',
    "invokeWithFallback('paymentSimulate', { code: -1 }, orderId)",
    'invoke(`accountList`)',
    'invoke(\n  "accountDelete",\n  id\n)',
    'invokeWithFallback("batchExecute", { code: -1 }, { a: "b,c", d: [1, 2] })',
    'invokeWithFallback("storeSetSetting", { code: -1 }, "k", { n: 1 })',
  ]

  it('正例：字符串字面量首参必须被抽出，且每条恰好 1 个', () => {
    for (const s of mustExtract) {
      const r = extractCalls(s)
      expect(r.literal.length).toBe(1) // 长度精确，见上方注释
      expect(r.dynamic.length).toBe(0)
    }
  })

  const mustNotExtract = [
    ['方法调用不是桥接层入口', 'api.invoke("accountList")'],
    ['方法调用不是桥接层入口', 'this.invokeWithFallback("accountList", null)'],
    ['方法调用不是桥接层入口', 'bridge.invoke("x")'],
    ['首参是变量（动态取名，设计已登记的固有边界）', 'invokeWithFallback(method, null)'],
    ['首参是变量', 'invoke(name)'],
    ['首参是模板串含插值', 'invoke(`${prefix}List`)'],
    ['被注释掉的调用不算调用点', '// invokeWithFallback("accountDelete", null, id)'],
    ['块注释里的调用不算', '/* invokeWithFallback("accountDelete", null, id) */'],
    ['字符串字面量里提到 invoke 不算调用', 'const msg = "please invoke(accountList) later"'],
    ['无参调用', 'invoke()'],
  ]

  it('负例：上述形态一个都不得被抽出', () => {
    for (const [why, s] of mustNotExtract) {
      const r = extractCalls(s)
      expect(`${why}: ${s} => ${JSON.stringify(r.literal)}`).toBe(
        `${why}: ${s} => []`,
      )
    }
  })

  // 命名空间形态的判据矩阵：ns 与 method 两个实参都必须被识别
  const mustExtractNs = [
    ['invokeNamespace("filmEngineering", "retryShot", payload)', 'filmEngineering', 'retryShot'],
    ["invokeNamespace('board', 'get')", 'board', 'get'],
    ['invokeNamespace(\n  "ttsVoice",\n  "list"\n)', 'ttsVoice', 'list'],
    ['invokePageManager("setSidebarWidth", 320)', 'pageManager', 'setSidebarWidth'],
  ]

  it('正例（命名空间）：ns 与 method 都要被抽到', () => {
    for (const [src, ns, method] of mustExtractNs) {
      const r = extractCalls(src)
      expect(`${src} => ${JSON.stringify(r.nsCalls)}`).toBe(`${src} => [{"fn":"${r.nsCalls[0] && r.nsCalls[0].fn}","ns":"${ns}","method":"${method}"}]`)
      expect(r.nsCalls.length).toBe(1)
    }
  })

  const mustNotExtractNs = [
    ['方法调用形态', 'api.invokeNamespace("board", "get")'],
    ['方法调用形态', 'this.invokePageManager("setSidebarWidth", 1)'],
    ['ns 是变量 → 记为 dynamic 而非 nsCalls', 'invokeNamespace(ns, "retryShot")'],
    ['method 是变量 → 记为 dynamic', 'invokeNamespace("board", m)'],
    ['被注释掉的命名空间调用', '// invokeNamespace("board", "get")'],
  ]

  it('负例（命名空间）：上述形态一个都不得进 nsCalls', () => {
    for (const [why, s] of mustNotExtractNs) {
      const r = extractCalls(s)
      expect(`${why}: ${s} => ${JSON.stringify(r.nsCalls)}`).toBe(`${why}: ${s} => []`)
    }
  })
})

describe('对账：渲染层调用的每个方法名都必须真实存在于暴露面（D5：public ∪ admin）', () => {
  it('除已登记的已知缺口外，不得有任何一个调用名落在暴露面之外', () => {
    const pub = loadSurfaceAt('public')
    const adm = loadSurfaceAt('admin')
    const union = new Set([...adm.resolvable, ...pub.resolvable])
    const { names } = collectProductionCalls()

    const gaps = names.filter((n) => !union.has(n))
    // 减去已登记白名单后必须为空；白名单之外多出来的就是新缺陷。
    // KNOWN_GAP 已按 fix-dead-pipeline-wrappers 收空 ⇒ 本用例就是主锁：
    // 任何新写的、指向不存在 preload 方法的 wrapper 都会在这里被判红并点名。
    const unexpected = gaps.filter((n) => !KNOWN_GAP.includes(n)).sort()
    expect(
      `未登记的暴露面缺口（${unexpected.length}）：${unexpected.join(', ')}\n` +
      `若确认是「故意只给管理员」请查 ADMIN_ONLY_METHODS；若确认是死代码请**删掉它**` +
      `（KNOWN_GAP 已按 fix-dead-pipeline-wrappers 收空，登记不再是出路）；若确为缺陷请修调用侧。`,
    ).toBe('未登记的暴露面缺口（0）：\n若确认是「故意只给管理员」请查 ADMIN_ONLY_METHODS；若确认是死代码请**删掉它**（KNOWN_GAP 已按 fix-dead-pipeline-wrappers 收空，登记不再是出路）；若确为缺陷请修调用侧。')
  })

  it('KNOWN_GAP 必须保持为空：登记不再是处理死代码的出路（fix-dead-pipeline-wrappers D2）', () => {
    // 原来这里是「只能缩小」的棘轮。白名单清空后它会对空数组空转通过——
    // 与「负例不得误伤，否则下个会话把锁删掉」是同形陷阱，故升级为零容忍。
    expect(`KNOWN_GAP 现有 ${KNOWN_GAP.length} 项：${KNOWN_GAP.join(', ')}`).toBe('KNOWN_GAP 现有 0 项：')
  })

  it('「只能缩小」的历史棘轮：仅在白名单非空时才生效，空表时显式说明而非空转', () => {
    if (KNOWN_GAP.length === 0) {
      // 空表不是「通过」，而是「已无登记项」——把这件事说出来，
      // 避免读者以为这条断言还在承重（它对空数组会空转）。
      expect('KNOWN_GAP 为空：本棘轮无对象可校验，承重由「必须保持为空」与对账用例承担')
        .toBe('KNOWN_GAP 为空：本棘轮无对象可校验，承重由「必须保持为空」与对账用例承担')
      return
    }
    const pub = loadSurfaceAt('public')
    const adm = loadSurfaceAt('admin')
    const union = new Set([...adm.resolvable, ...pub.resolvable])

    for (const g of KNOWN_GAP) {
      // 一旦 preload 补上同名方法，这条就该要求把它移出白名单
      expect(`暴露面已存在 ${g}（应从 KNOWN_GAP 移除）：${union.has(g)}`).toBe(`暴露面已存在 ${g}（应从 KNOWN_GAP 移除）：false`)

      // 一旦有人给它接上调用方，也该要求移出白名单并把调用名改对。
      // 注意：wrapper 自己在 publisher.js 里的那一次调用就是它的定义处，
      // 「0 调用方」指的是**除该定义处以外**没有别的文件引用它。
      const callers = countCallersOutside(g, 'publisher.js')
      expect(`${g} 的外部调用方 ${callers.length} 处（${callers.join(', ')}）——有调用方就必须移出白名单并改对调用名`)
        .toBe(`${g} 的外部调用方 0 处（）——有调用方就必须移出白名单并改对调用名`)
    }
  })

  it('生产侧不应存在动态取名调用点（有的话说明判据覆盖不到）', () => {
    const { dynamic } = collectProductionCalls()
    const desc = dynamic.map((d) => `${d.file}: ${d.fn}(${d.snippet})`).join('; ')
    expect(`生产侧动态取名（${dynamic.length}）：${desc}`).toBe('生产侧动态取名（0）：')
  })
})

describe('命名空间形态对账：ns 与 method 都必须真实存在', () => {
  it('invokeNamespace / invokePageManager 的 ns 与 method 必须在暴露面里', () => {
    const adm = loadSurfaceAt('admin')
    const { nsCalls } = collectProductionCalls()
    const bad = nsCalls.filter((c) => {
      const members = adm.namespaces[c.ns]
      return !Array.isArray(members) || !members.includes(c.method)
    })
    expect(
      `命名空间调用越界（${bad.length}）：${bad.map((c) => `${c.file} ${c.ns}.${c.method}`).join('; ')}\n` +
      `invokeNamespace 的 ns 或 method 写错，桥接层会静默返回 undefined ⇒ 功能失效且界面零提示。`,
    ).toBe('命名空间调用越界（0）：\ninvokeNamespace 的 ns 或 method 写错，桥接层会静默返回 undefined ⇒ 功能失效且界面零提示。')
  })

  it('C-1 的修复形态必须在场：filmEngineering.retryShot 走命名空间且不再是扁平名', () => {
    const { nsCalls } = collectProductionCalls()
    const fixed = nsCalls.filter((c) => c.ns === 'filmEngineering' && c.method === 'retryShot')
    expect(`filmEngineering.retryShot 的命名空间调用 ${fixed.length} 处`).toBe('filmEngineering.retryShot 的命名空间调用 1 处')
  })

  it('扁平名 filmEngineeringRetryShot 必须已从调用侧消失（否则又走回 undefined 路径）', () => {
    const { names } = collectProductionCalls()
    expect(`扁平名仍被调用：${names.filter((n) => n === 'filmEngineeringRetryShot').join(',')}`)
      .toBe('扁平名仍被调用：')
  })
})

describe('失败分支的用户可见文案（3.2）', () => {
  // 取证结论（与 tasks 3.2 原文的预设不同，故此处按事实断言）：
  // 视图层 FilmCanvasView.onRetryShot 已有失败处理 `ElMessage.error(t('filmEngineering.canvas.retry.failed'))`，
  // 且该键在 zh/en **成对存在**。审查报告「界面零文案」的说法对这条路径不成立。
  // 因此本块不新增 locale 键（新增即重复），而是把「文案存在且成对」与
  // 「桥接哨兵绝不可直出」两条性质锁成断言。

  it('重试失败的文案在 zh 与 en 都存在、非空、且不是同一串复制', () => {
    const z = zh.filmEngineering?.canvas?.retry?.failed
    const e = en.filmEngineering?.canvas?.retry?.failed
    expect(typeof z).toBe('string')
    expect(typeof e).toBe('string')
    expect(z.trim().length).toBeGreaterThan(0)
    expect(e.trim().length).toBeGreaterThan(0)
    expect(z).not.toBe(e) // 复制粘贴的英文占位是本仓 i18n 的老问题
  })

  it('视图层重试失败分支必须真的用这个键（结构锁：删掉即红）', () => {
    const src = stripComments(fs.readFileSync(FILM_CANVAS_VIEW, 'utf8'))
    const uses = /ElMessage\.error\(\s*t\(\s*['"]filmEngineering\.canvas\.retry\.failed['"]\s*\)\s*\)/.test(src)
    expect(`FilmCanvasView 是否在重试失败时弹出 filmEngineering.canvas.retry.failed：${uses}`).toBe('FilmCanvasView 是否在重试失败时弹出 filmEngineering.canvas.retry.failed：true')
  })

  it('桥接层哨兵文案必须被判为技术文本、禁止直出（反 C-1 的既有护栏）', () => {
    // publisher.js 在方法不存在时返回的正是这句；user-facing-error 的
    // TECHNICAL_TEXT_PATTERNS 含 /\belectronAPI\b/i，必须把它换成 fallback。
    const r = formatUserError({ code: -1, message: 'electronAPI not available' }, { fallback: 'FB' })
    expect(`matched=${r.matched} message=${JSON.stringify(r.message)}`).toBe('matched=fallback message="FB"')
    expect(r.matched).not.toBe('passthrough')
  })

  it('真实业务消息仍应原样透传（别把护栏做成把所有文案都吃掉）', () => {
    const r = formatUserError({ code: -1, message: '订单不可用或已完成' }, { fallback: 'FB' })
    expect(`matched=${r.matched} message=${JSON.stringify(r.message)}`).toBe('matched=passthrough message="订单不可用或已完成"')
  })
})

describe('扫描域棘轮（D6：新增含调用的文件必须显式登记）', () => {
  // M-9 扩展：判据从「含 invoke( 调用」扩展为「含任何 IPC 访问形态」。
  // 原来 8 个文件（identity/model-providers/providers/...）自己写 getApi() 拿
  // window.electronAPI 再 api.X(...) 直调 —— 不含 invoke( 这四个字面，
  // 恰好从旧判据的缝里漏出去（这正是 M-9 的根因形态：绕过桥接层零感知）。
  const TOUCHES_IPC = [
    /(?<![A-Za-z0-9_$.])invoke\s*\(/,
    /(?<![A-Za-z0-9_$.])invokeWithFallback\s*\(/,
    /(?<![A-Za-z0-9_$.])invokeWithTimeout\s*\(/,
    /(?<![A-Za-z0-9_$.])invokeNamespace\s*\(/,
    // CCG 评审 i2：事件订阅（bridge.on）也是 IPC 触点，漏了它，
    // 只做事件订阅的文件就能游离在 SCAN_DOMAIN 之外
    /(?<![A-Za-z0-9_$.])on\s*\(\s*['"`]/,
    /window\.electronAPI/,
  ]

  it('src/api 下每个触碰 IPC 的非测试、非显式排除文件都在 SCAN_DOMAIN 内', () => {
    const excluded = new Set(SCAN_EXCLUDED.filter((x) => !x.includes('*')))
    const onDisk = fs
      .readdirSync(API_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js') && !e.name.endsWith('.test.js'))
      .map((e) => e.name)
      .filter((name) => !excluded.has(name)) // 显式排除项（electron-bridge.js）不参与棘轮
      .filter((name) => {
        const src = fs.readFileSync(path.join(API_DIR, name), 'utf8')
        return TOUCHES_IPC.some((re) => re.test(src))
      })
      .sort()

    const listed = [...SCAN_DOMAIN].sort()
    const missing = onDisk.filter((f) => !listed.includes(f))
    const stale = listed.filter((f) => !onDisk.includes(f))
    expect(
      `未登记却含调用的文件（${missing.length}）：${missing.join(', ')}；` +
      `已登记但磁盘上无调用（${stale.length}）：${stale.join(', ')}；` +
      `显式排除：${SCAN_EXCLUDED.join(', ')}`,
    ).toBe('未登记却含调用的文件（0）：；已登记但磁盘上无调用（0）：；显式排除：electron-bridge.js, *.test.js')
  })

  it('getApi / window.electronAPI 直访必须收敛到 electron-bridge 单一定义（M-9）', () => {
    // M-9：9 份独立 getApi() 防御强度不一（有的有 typeof window 守卫、有的没有），
    // 且绕过 toPlainIpcValue 脱壳。收敛后 electron-bridge 是唯一定义处；
    // 任何人再在别的 api 文件里写 `function getApi` 或直接摸
    // `window.electronAPI`，这条会点名（文件级，不数次数——文件里有就是绕过）。
    const offenders = fs
      .readdirSync(API_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js') && !e.name.endsWith('.test.js'))
      .filter((e) => e.name !== 'electron-bridge.js')
      .map((e) => e.name)
      .filter((name) => {
        const src = stripComments(fs.readFileSync(path.join(API_DIR, name), 'utf8'))
        return /(?<![A-Za-z0-9_$.])getApi\s*[=(]/.test(src) || /window\.electronAPI/.test(src)
      })
      .sort()
    expect(
      `绕过 electron-bridge 直访 IPC 的文件（${offenders.length}）：${offenders.join(', ')}\n` +
      'getApi 的唯一定义在 electron-bridge.js；数据必须经 invokeWithFallback/invoke ' +
      '获得脱壳（toPlainIpcValue）与统一 fallback 语义。直访 = 绕过两者。',
    ).toBe('绕过 electron-bridge 直访 IPC 的文件（0）：\n' +
      'getApi 的唯一定义在 electron-bridge.js；数据必须经 invokeWithFallback/invoke ' +
      '获得脱壳（toPlainIpcValue）与统一 fallback 语义。直访 = 绕过两者。')
  })
})
