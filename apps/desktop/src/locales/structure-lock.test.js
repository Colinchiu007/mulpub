/**
 * locales 结构锁测试（前端拆分方案 v3 §3.2-2 / §3.3）
 *
 * 分批迁移期的三层断言：
 * ① 已迁移域：域子模块键集合 == 装配后 zh.js 中该命名空间键集合（子集精确相等，防搬运丢键/改键）；
 * ② 未迁移域：仍完整留在装配文件原文中（直接断言装配文件含该命名空间定义）；
 * ③ 全局：装配文件不得出现同名顶层命名空间重复展开（后展开覆盖先展开即红）。
 *
 * 全量迁完后（_rest.js 清空）本测试仍有效：① 变为全量逐域核对。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const localeDir = dirname(fileURLToPath(import.meta.url))

/** 收集已迁移域目录：含 zh.js + en.js 的子目录（排除既有先例目录，它们有自己的 copy 测试） */
const PRECEDENT_DIRS = new Set(['accounts-cloud-sync', 'identity-diagnostics'])

/**
 * **已知的 zh/en 子模块键不对称**（显式欠账，不是静默排除）。
 *
 * 2026-10-14：修好本文件的两处解析缺陷后（此前判据空转、恒绿），本判据第一次真正跑起来，
 * 立刻抓到 `story2video` 的既有漂移 —— `composeSegments` 只存在于 zh、
 * `composeProgress` 只存在于 en（**main 上同样存在**，非本 PR 引入）。
 *
 * 为什么不在这里顺手修：两侧各缺一个键，补哪一侧都需要**为该功能写原文案**，
 * 而那两个键的文案归属不属于本 PR 的范围；臆造翻译比留一条可见欠账更糟。
 * 故登记在此，让欠账**可见**（原状态是判据空转 ⇒ 没人知道）。
 *
 * 处置：由 story2video 域的 owner 确认两个键各自是否仍被使用，
 * 删除废弃键或补齐另一侧文案后，从这里移除本条目。
 */
const KNOWN_KEY_ASYMMETRY = new Map([
  ['story2video', {
    onlyZh: ['composeSegments'],
    onlyEn: ['composeProgress'],
    since: '2026-10-14',
    owner: 'story2video 域 owner（见 01-docs/PRD 对应章节）',
  }],
])

function migratedDomains() {
  return readdirSync(localeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !PRECEDENT_DIRS.has(d.name))
    .map((d) => d.name)
    .filter((name) => existsSync(join(localeDir, name, 'zh.js')) || existsSync(join(localeDir, name, 'en.js')))
}

/** 顶层命名空间名 ↔ 目录名（kebab-case）映射：publishPage → publish-page */
function nsOfDir(dir) {
  return dir.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

/**
 * 从模块源码提取指定对象文本的顶层键。
 *
 * 返回两种形态（**必须区分**，见下）：
 *   · `{ kind: 'missing' }`  —— 装配文件里找不到该命名空间
 *   · `{ kind: 'spread', target }` —— 单行展开 `ns: { ...someZh },`
 *   · `{ kind: 'literal', keys }`  —— 多行字面量，逐键列出
 *
 * ★ 为什么要区分（2026-10-14 修，假绿事故）：
 *   原实现对**单行**展开 `cards: { ...cardsZh },` 会这样跑：同一行里 `{` 让 depth 变 1、
 *   `}` 立刻让它回 0 ⇒ 循环在**第一行**就 break ⇒ 返回 `[]`。
 *   而断言写的是 `for (const k of zhDomain) expect(zhAsmKeys).toContain(k)` ——
 *   只要 `zhDomain` 也是空，断言就**空转**（恒绿），判据从未真正生效。
 *   「单行 spread」形态下装配文件的键**按构造**就等于子模块的键（无搬运丢键的可能），
 *   所以正确的判据不是比对键集合，而是**核对展开的是不是本域的子模块**。
 */
function topKeysOfObject (src, objName) {
  const start = src.indexOf(`  ${objName}: {`)
  if (start < 0) return { kind: 'missing' }
  const firstLine = src.slice(start).split('\n')[0]
  // 单行展开形态：`  ns: { ...xxxZh },`
  const spread = firstLine.match(/^\s*\w+:\s*\{\s*\.\.\.(\w+)\s*\}/)
  if (spread) return { kind: 'spread', target: spread[1] }

  const keys = []
  const lines = src.slice(start).split('\n')
  let depth = 0
  let begun = false
  for (const line of lines) {
    const trimmed = line.replace(/\/\/.*$/, '')
    for (const ch of trimmed) {
      if (ch === '{') { depth++; begun = true }
      if (ch === '}') depth--
    }
    if (begun && depth === 1) {
      const m = line.match(/^ {4}(\w+):/)
      if (m) keys.push(m[1])
    }
    if (begun && depth === 0) break
  }
  return { kind: 'literal', keys }
}

/**
 * 域子模块的全部顶层键。
 *
 * ★ 取「`export default {` 内**最小缩进那一层**的键」，而不是写死 `^ {2}(\w+):`。
 *   既有域的缩进是 **4 空格**（`    menuLabel: ...`），写死两空格会让本函数恒返回 `[]`，
 *   与 `topKeysOfObject` 的 `[]` 一起把断言 ① 变成空转 —— 判据形同不存在
 *   （2026-10-14 实测：既有 5 个域全部 `[]`，只有新加的 2 空格域才把断言激活）。
 *   按「最小缩进」判定对 2 空格与 4 空格两种既有风格都成立，且不会把嵌套对象的键算进来。
 */
function domainModuleKeys (file) {
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf('export default {')
  if (start < 0) return []
  const lines = src.slice(start).split('\n').slice(1)
  const cands = []
  let minIndent = Infinity
  for (const line of lines) {
    if (/^\}/.test(line)) break // 对象结束
    const m = line.match(/^( +)"?(\w+)"?:/)
    if (m) {
      cands.push([m[1].length, m[2]])
      if (m[1].length < minIndent) minIndent = m[1].length
    }
  }
  return cands.filter(([ind]) => ind === minIndent).map(([, k]) => k)
}

describe('locales 结构锁（拆分方案 v3）', () => {
  const domains = migratedDomains()

  it('已迁移域目录 zh/en 成对存在', () => {
    for (const d of domains) {
      expect(existsSync(join(localeDir, d, 'zh.js')), `${d}/zh.js 缺失`).toBe(true)
      expect(existsSync(join(localeDir, d, 'en.js')), `${d}/en.js 缺失`).toBe(true)
    }
  })

  it('① 已迁移域：子模块键集合 == 装配文件中该命名空间键集合（zh/en 双侧）', () => {
    const zhAsm = readFileSync(join(localeDir, 'zh.js'), 'utf8')
    const enAsm = readFileSync(join(localeDir, 'en.js'), 'utf8')
    for (const d of domains) {
      const ns = nsOfDir(d)
      const zhDomain = domainModuleKeys(join(localeDir, d, 'zh.js'))
      const enDomain = domainModuleKeys(join(localeDir, d, 'en.js'))
      // zh/en 子模块键必须互相对称（已知欠账见 KNOWN_KEY_ASYMMETRY，**不是**静默排除：
      // 登记项要求写明 onlyZh/onlyEn 具体键名 —— 形状不对仍然红）
      const known = KNOWN_KEY_ASYMMETRY.get(d)
      if (known) {
        const zs = new Set(zhDomain); const es = new Set(enDomain)
        const onlyZh = zhDomain.filter((k) => !es.has(k))
        const onlyEn = enDomain.filter((k) => !zs.has(k))
        expect(onlyZh, `${d} 的 zh 独有键变了（欠账登记需同步更新）`).toEqual(known.onlyZh)
        expect(onlyEn, `${d} 的 en 独有键变了（欠账登记需同步更新）`).toEqual(known.onlyEn)
      } else {
        expect(zhDomain.sort(), `${d} zh/en 子模块键不对称`).toEqual(enDomain.sort())
      }
      // ★ 子模块必须真的解析出键 —— 否则下面的断言会**空转**（历史假绿：既有域曾恒返回 []）
      expect(zhDomain.length, `${d} 子模块未解析出任何顶层键（判据会空转）`).toBeGreaterThan(0)

      const zhAsmNs = topKeysOfObject(zhAsm, ns)
      const enAsmNs = topKeysOfObject(enAsm, ns)
      if (zhAsmNs.kind === 'spread') {
        // 单行展开：装配文件的键**按构造**等于子模块的键 ⇒ 判据改为核对展开的是本域子模块
        expect(zhAsmNs.target, `zh.js ${ns} 展开的不是本域子模块`).toBe(`${ns}Zh`)
        expect(enAsmNs.target, `en.js ${ns} 展开的不是本域子模块`).toBe(`${ns}En`)
      } else {
        expect(zhAsmNs.kind, `zh.js 未找到命名空间 ${ns}`).not.toBe('missing')
        expect(enAsmNs.kind, `en.js 未找到命名空间 ${ns}`).not.toBe('missing')
        for (const k of zhDomain) {
          expect(zhAsmNs.keys, `zh.js ${ns} 缺键 ${k}`).toContain(k)
          expect(enAsmNs.keys, `en.js ${ns} 缺键 ${k}`).toContain(k)
        }
      }
    }
  })

  it('③ 装配文件不得重复展开同一命名空间（防后展开覆盖先展开）', () => {
    for (const lang of ['zh', 'en']) {
      const src = readFileSync(join(localeDir, `${lang}.js`), 'utf8')
      const seen = new Set()
      for (const line of src.split('\n')) {
        const m = line.match(/^ {2}(\w+):\s*\{/)
        if (m) {
          expect(seen.has(m[1]), `${lang}.js 顶层命名空间重复: ${m[1]}`).toBe(false)
          seen.add(m[1])
        }
      }
    }
  })

  it('装配文件对空 _rest.js 容错：_rest 存在时必须导出对象', () => {
    const restZh = join(localeDir, '_rest', 'zh.js')
    if (existsSync(restZh)) {
      expect(readFileSync(restZh, 'utf8')).toMatch(/export default\s*\{/)
    }
  })
})
