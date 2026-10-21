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

/** 去掉行注释后的源码：解释"为什么删掉"的注释里必然会写被禁名字（同仓多次实测的自指坑） */
function code (src) {
  return src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l))
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
    expect(dash, 'Dashboard.test.js 里的 findComponent 缺席断言必须仍在').toContain('TrialBanner')
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
})
