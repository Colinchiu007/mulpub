// @ts-check
/**
 * dead-components —— 「存在但无人渲染」不得复活（UX 审计 1.3，ux-audit-dead-components-retire）
 *
 * 本批删掉两个从未被渲染的组件：
 *   - `TrialBanner.vue`：文案「当前为免费版，部分功能受限」在看板页被产品决策判为误导
 *     （该页三个数据源的门禁都是**登录**而非套餐；见 `views/Dashboard.style-guard.test.js`
 *     的两版反转史）。全仓除测试自己 mount 它之外零引用。
 *   - `LoadingState.vue`：在 `main.js` 全局注册，但 `<LoadingState>` 模板用法为 0；
 *     骨架屏实际由 `EmptyState` / `UiSkeleton` 承担。
 *
 * 为什么留一把锁而不是删完就走：审计项要求的是「二选一，不允许存在但无人渲染」。
 * 只删不锁，下一个会话完全可能"看到这个组件挺好，接上吧"，或从别处 copy 回来 ——
 * 而恢复它需要**同时**恢复 `Dashboard.style-guard.test.js` 里那条
 * 「必须放在 .cohere-content 内部」的位置守卫（该文件注释已写明），不是加一行 import 就行。
 * 所以这把锁判的是「代码里出现引用」，不是「我记得它被撤了」。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = path.resolve(HERE, '..', '..')
const SRC = path.resolve(DESKTOP_ROOT, 'src')
/** 本守卫文件自己必然提到这两个名字 ⇒ 从扫描域排除，不做"自我引用即违规"的假红 */
const SELF = 'components/dead-components.test.js'

/**
 * 去掉注释后的源码：解释"为什么删掉"的注释里必然会写被禁名字（同仓多次实测的自指坑）。
 *
 * ⚠️ QM-6 i2 命中了本函数第一版的两个方向性错误，现按**注释优先**实现：
 *   (a) 旧版按"行首注释符"过滤 ⇒ 一行同时含注释与代码时**整行被丢弃**，
 *       `/* 恢复 *\/ app.component('LoadingState', EmptyState)` 这种真实重新接线会隐身；
 *   (b) 旧版不认多行块注释的正文行（正文不以 `*` 开头时）⇒ 那段注释被当成代码行命中 needle，
 *       违反 spec「注释不得被判红」。
 * 所以顺序是：先整块剥 `<!-- -->` 与 `/* *\/`（含跨行），再剥以 `//` 开头的整行注释，
 * 最后剥行尾 ` // ...`（要求 `//` 前是空白，避免误伤 `https://`）。
 * 已知不完美：注释定界符出现在**字符串字面量内部**时会被误剥。判据只需认"标识符在场"，
 * 而本仓 needle 是组件名，不会以该形态出现在字符串里；这条限制写出来而不是假装不存在。
 */
export function code (src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/\s+\/\/[^'"\n]*$/g, ''))
    .join('\n')
}

/**
 * 豁免清单：**只有"断言它不存在"的反向守卫**可以提到这个名字。
 * 这两处都是代码行（`findComponent({ name: "TrialBanner" })` / `tpl.indexOf("<TrialBanner")`），
 * 按"代码行出现即违规"的粗判据会把**防回潮的锁本身**判成重新接线（本仓同型坑：禁令按字符串出现切、
 * 不看语义）。豁免不是洞 —— 下面 `反向守卫本身必须还在` 那条会验证这两个文件仍在做缺席断言，
 * 把豁免文件改名或删掉守卫都会红。
 */
const ANTI_RESURRECTION_GUARDS = [
  'views/Dashboard.style-guard.test.js',
  'views/Dashboard.test.js',
]

function scanForWiring (needle) {
  const hits = []
  let scanned = 0
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) {
        if (name !== 'node_modules' && name !== 'dist' && name !== 'dist-electron') walk(full)
        continue
      }
      if (!/\.(vue|js)$/.test(name)) continue
      const rel = path.relative(SRC, full).split(path.sep).join('/')
      if (rel === SELF || ANTI_RESURRECTION_GUARDS.includes(rel)) continue
      scanned += 1
      if (code(fs.readFileSync(full, 'utf8')).includes(needle)) hits.push(rel)
    }
  }
  walk(SRC)
  return { hits, scanned }
}

describe('已退役组件不得被重新接线', () => {
  it('扫描域必须非空（空集合会让"零引用"读起来完全像通过）', () => {
    const { scanned } = scanForWiring('TrialBanner')
    expect(scanned, 'src 下必须扫到源码文件，否则本文件的锁全部不可信').toBeGreaterThan(100)
  })

  it('组件文件本身不得复活', () => {
    for (const f of ['components/TrialBanner.vue', 'components/LoadingState.vue']) {
      expect(fs.existsSync(path.resolve(SRC, f)), `${f} 已因"存在但无人渲染"删除；恢复需连带恢复看板页的位置守卫并另开 change`).toBe(false)
    }
  })

  it('代码里不得再出现 TrialBanner 的 import 或模板用法', () => {
    const { hits } = scanForWiring('TrialBanner')
    expect(hits, 'TrialBanner 只允许出现在注释与反向守卫里，出现在别处的代码行即重新接线').toEqual([])
  })

  it('代码里不得再出现 LoadingState（含 main.js 的全局注册）', () => {
    const { hits } = scanForWiring('LoadingState')
    expect(hits, 'LoadingState 曾以 app.component 全局注册但零模板用法；不得再注册').toEqual([])
    const mainSrc = code(fs.readFileSync(path.resolve(SRC, 'main.js'), 'utf8'))
    expect(mainSrc).not.toContain("app.component('LoadingState'")
  })

  // 反向锁：豁免文件必须仍在做缺席断言，否则豁免就是可复用的洞。
  // 判据取**形状**而不是"名字还在"——只查名字的话，把守卫里的探针改成
  // `indexOf("<Nothing")` 照样绿（本驱动 C3 实测就是这个 MISSED 形态）。
  it('反向守卫本身必须还在（防止把豁免清单当成可复用的洞）', () => {
    const guard = fs.readFileSync(path.resolve(SRC, 'views/Dashboard.style-guard.test.js'), 'utf8')
    expect(guard, 'style-guard 必须仍在用 indexOf("<TrialBanner") 探测模板').toContain('indexOf("<TrialBanner")')
    expect(guard, 'style-guard 的缺席期望（.toBe(-1)）必须仍在').toMatch(/\.toBe\(\s*-1\s*\)/)
    const dash = fs.readFileSync(path.resolve(SRC, 'views/Dashboard.test.js'), 'utf8')
    // QM-6 i1：这一半此前只断言"名字在场"，那不构成对偶锁 ——
    // 有人把缺席断言改成正面断言（`expect(...exists()).toBe(true)`）时名字照样在场，锁全绿而洞开着。
    // 现在按**形状**验：同一行里必须同时有 findComponent(TrialBanner) 与 toBe(false)。
    const dashGuardLine = dash
      .split('\n')
      .find((l) => /findComponent\(\s*\{\s*name:\s*['"]TrialBanner['"]\s*\}\s*\)/.test(l))
    expect(dashGuardLine, 'Dashboard.test.js 里的 findComponent 缺席断言必须仍在').toBeDefined()
    expect(dashGuardLine, '该行必须仍在断言"不存在"，不得被改成正面断言').toMatch(/\.\s*toBe\(\s*false\s*\)/)
  })

  // 扫描域教训（本批实测踩到）：一开始只在 src/ 下 grep，判 LoadingState "零引用"，
  // 但 `apps/desktop/test-setup.js`（**在 src 之外**）把它注册进了全局组件表 ——
  // 于是删掉组件后整套测试直接 "Failed to resolve import" 挂死。
  // 所以这条把测试宿主也算进扫描域：注册点必须一起消失，而不是留一个指向已删文件的 import。
  it('测试宿主（test-setup.js）不得再注册已退役组件', () => {
    const setup = path.resolve(DESKTOP_ROOT, 'test-setup.js')
    const src = code(fs.readFileSync(setup, 'utf8'))
    expect(src, 'test-setup.js 仍 import/注册 LoadingState：它镜像的是 main.js 的全局注册表，删除必须同步').not.toContain('LoadingState')
    expect(src).not.toContain('TrialBanner')
  })

  // QM-6 i3：被删组件的**类名**也会成为别处的依赖 —— 对比度探针按选择器取元素，
  // 组件没了之后该档恒 0 命中（探针会打「未找到该选择器」并跳过，不是假绿，但等于这档从没被测）。
  // 本仓还有第三个写者面在这里：探针在 `apps/desktop/tests/` 下，既不在 src 也不是注册表。
  it('对比度探针不得再指向已撤组件的类名', () => {
    const probePath = path.resolve(DESKTOP_ROOT, 'tests', 'visual-testing', 'scripts', 'contrast-probe.js')
    const raw = fs.readFileSync(probePath, 'utf8')
    const src = code(raw)
    expect(src, "contrast-probe.js 的 CASES 仍按 .banner-text 取元素：该类名只存在于已撤下的横幅里").not.toContain("'.banner-text'")
    expect(raw, 'dashboard 这一档不得被整条删掉（删掉等于该页对比度再无人看）').toContain("'.stat-label'")
  })

  // QM-6 i2 的回归保护：注释剥离器两个方向的失效都曾被指出，这里逐个钉住。
  // 这四条是对 code() 本体的直接测试（不是对仓库现状的测试），所以它必须能独立证明
  // "注释隐身接线"与"注释被当成代码"两种形态都已封死。
  it('code() 不得把「注释 + 代码」同一行的代码丢掉（漏报方向）', () => {
    const hidden = "/* 恢复试用横幅 */ app.component('LoadingState', EmptyState)"
    expect(code(hidden), '行首块注释后的真实接线代码必须留在扫描域里').toContain("app.component('LoadingState', EmptyState)")
    const hiddenSlash = "// 说明\n  TrialBanner,"
    expect(code(hiddenSlash)).toContain('TrialBanner,')
  })

  it('code() 必须整块剥掉跨行块注释（误报方向：注释正文不得算代码行）', () => {
    const block = 'const a = 1\n/*\nTrialBanner 已随 1.3 撤下\nLoadingState 也是\n*/\nconst b = 2'
    const out = code(block)
    expect(out).not.toContain('TrialBanner')
    expect(out).not.toContain('LoadingState')
    expect(out).toContain('const a = 1')
    expect(out).toContain('const b = 2')
  })

  it('code() 必须剥掉 HTML 注释与行尾注释，但不得吃掉行首代码', () => {
    expect(code('  <!-- <TrialBanner /> 曾在这里 -->\n  const x = 1')).toBe('  \n  const x = 1')
    const trailing = "  app.component('EmptyState', EmptyState) // 曾经是 LoadingState"
    expect(code(trailing)).not.toContain('LoadingState')
    expect(code(trailing)).toContain("app.component('EmptyState', EmptyState)")
  })

  it('code() 剥注释不得误伤 URL 里的双斜杠（协议判据同族坑）', () => {
    const urlLine = '  const src = "https://example.com/a" // 注释 TrialBanner'
    expect(code(urlLine)).toContain('https://example.com/a')
    expect(code(urlLine)).not.toContain('TrialBanner')
  })
})
