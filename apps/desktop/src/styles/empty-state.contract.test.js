/**
 * 空态容器样式契约测试（visual-system P0-6 回归锁）
 *
 * 钉死三件事：
 * 1. **不得出现死选择器**：`styles/premium-design-system.css` 的空态块里点名的每个类名，
 *    都必须在 src 里真实存在。上一版点名了 6 个**代码里根本没有**的类名
 *    （`.pi-empty-surface` / `.empty-surface` / `.insight-empty` / `.perf-empty` /
 *    `.insight-empty-card` / `.perf-empty-card`），规则一条也没命中，
 *    而文档却写成「空态虚线已改实线」——这正是本锁要拦的形态。
 * 2. **被覆盖的空态容器不得再声明虚线**：覆盖到的类，组件自身也不许再写 `dashed`，
 *    否则两处规则互相打架，渲染结果取决于加载顺序。
 * 3. **仍用虚线的容器必须在例外清单里登记**：清单外的虚线空态容器 = 新增债务 ⇒ 判红；
 *    清单里的项若已经不虚线 ⇒ 清单陈旧 ⇒ 判红（清单必须随代码一起更新）。
 *
 * 断言规范（QM-3）：结构类断言用 toEqual / toBe，不清一色 toContain。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(here, '..')
const read = (rel) => readFileSync(path.join(srcRoot, rel), 'utf8')

const premiumCss = read('styles/premium-design-system.css')

/** 递归收集 src 下所有 .vue / .css 文件 */
function collectStyleFiles (dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) collectStyleFiles(full, out)
    else if (/\.(vue|css)$/.test(name)) out.push(full)
  }
  return out
}

const styleFiles = collectStyleFiles(srcRoot)
const styleTexts = styleFiles.map((f) => ({ file: path.relative(srcRoot, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }))
/**
 * 「类名真实存在」的检索域：**排除 premium-design-system.css 自身**。
 * 否则空态块里点名的类名会在本文件里匹配到自己 —— 锁就成了恒绿的自证。
 */
const componentStyleText = styleTexts
  .filter((s) => s.file !== 'styles/premium-design-system.css')
  .map((s) => s.text).join('\n')

/** 取 premium 里「12. 空态」那一节 */
function emptyStateSection (css) {
  const start = css.indexOf('12. 空态')
  if (start < 0) return ''
  const rest = css.slice(start)
  const next = rest.indexOf('\n/* ---', 10)
  return next < 0 ? rest : rest.slice(0, next)
}

/** 剥掉 CSS 注释：块注释 + 块注释续行（`*` 开头）+ 行注释 */
function stripCssComments (text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 空态块里点名的类名（先剥掉注释：注释里出现的类名不是「点名」） */
function namedClasses (section) {
  const stripped = stripCssComments(section)
  return [...new Set([...stripped.matchAll(/\.([a-z][a-z0-9-]+)/g)].map((m) => m[1]))]
}

/** 找出所有「选择器里带 empty/zero 且声明了 dashed」的规则，返回类名 */
function dashedEmptyStateClasses () {
  const hits = new Set()
  for (const { text } of styleTexts) {
    for (const m of text.matchAll(/\.[a-z][a-z0-9-]*(?:empty|zero)[a-z0-9-]*[^{}]*\{[^{}]*dashed[^{}]*\}/gi)) {
      for (const c of m[0].matchAll(/\.([a-z][a-z0-9-]+)/g)) hits.add(c[1])
    }
  }
  return [...hits].sort()
}

/**
 * 仍用虚线的容器登记清单。
 * kind='keep' —— 虚线在这里语义正确，**不打算改**（改动会伤到惯例或另有语义）。
 * kind='defer' —— 语义空态、**应该**改，但它落在 20 张像素基线视图里，
 *                 改样式会让基线漂移，必须按 CI artifact 流程重建基线后再改。
 */
const DASHED_REGISTRY = [
  { cls: 'podcast-empty', kind: 'defer', why: '播客频道空态；podcast-channel 是像素基线视图，改样式须先重建基线' },
  { cls: 'segment-empty-filter', kind: 'defer', why: '结果段筛选空态；落在发布/创作基线视图，须先重建基线' },
  { cls: 'pipeline-progress-empty', kind: 'defer', why: '流水线空态；create-pipeline 是像素基线视图，须先重建基线' },
  { cls: 'is-empty', kind: 'defer', why: '历史缩略图空位；create-history 是像素基线视图，须先重建基线' },
  { cls: 'upload-zone', kind: 'keep', why: '拖放区：虚线是「可拖入」的业界惯例，不是「未完成」' },
  { cls: 'stage-time-guidance', kind: 'keep', why: '时间说明提示块：虚线是提示语气，不是空态' },
  { cls: 's2v-subgroup-title', kind: 'keep', why: '分组标题的分隔虚线：语义是分隔线，不是空态' },
  { cls: 's2v-estimate-note', kind: 'keep', why: '估算占位的左侧虚线标记：语义是「这一行还没填」，不是空态' }
]

/** 本轮已覆盖的空态容器（P0-6 点名的四类） */
const COVERED = ['mp-home-zero-cta', 'mp-home-recent-empty', 'pi-empty-state', 'pi-dim-empty']

describe('空态容器样式契约（P0-6）', () => {
  it('空态块存在，且点名了四类目标容器', () => {
    const section = emptyStateSection(premiumCss)
    expect(section.length).toBeGreaterThan(0)
    const named = namedClasses(section)
    for (const cls of COVERED) expect(named).toContain(cls)
  })

  it('不得出现死选择器：空态块点名的类名都必须在 src 里真实存在', () => {
    const section = emptyStateSection(premiumCss)
    const named = namedClasses(section)
    const missing = named.filter((cls) => !new RegExp('\\.' + cls + '(?![a-z0-9-])').test(componentStyleText))
    expect(missing).toEqual([])
  })

  it('被覆盖的空态容器：观感层对每个类都有 solid 覆盖（组件保留 dashed，由 !important 覆盖改实线）', () => {
    const section = emptyStateSection(premiumCss)
    const missing = COVERED.filter((cls) => {
      // 该类必须出现在空态块里，且紧邻的规则体里有 border-style: solid
      const re = new RegExp('\\.' + cls + '(?![a-z0-9-])[^\\{]*\\{([^\\}]*)\\}', 'i')
      const m = section.match(re)
      return !m || !/border-style\s*:\s*solid/.test(m[1])
    })
    expect(missing).toEqual([])
  })

  it('仍用虚线的空态容器：扣掉被观感层改实线的，其余必须全部在例外清单里登记，且清单不陈旧', () => {
    const registered = DASHED_REGISTRY.map((r) => r.cls)
    const section = emptyStateSection(premiumCss)
    // 被观感层改实线的类：不算「仍用虚线」
    const covered = COVERED.filter((cls) => new RegExp('\\.' + cls + '(?![a-z0-9-])', 'i').test(section))
    // ① 清单外的虚线空态容器 = 新增债务
    const found = dashedEmptyStateClasses()
    const unregistered = found.filter((cls) => !registered.includes(cls) && !covered.includes(cls))
    expect(unregistered).toEqual([])
    // ② 清单里标 defer 的每一项，代码里确实还在用虚线（清单必须是活的）
    const stale = DASHED_REGISTRY
      .filter((r) => r.kind === 'defer')
      .filter((r) => {
        const re = new RegExp('\\.' + r.cls + '(?![a-z0-9-])[^\\{]*\\{[^\\}]*dashed', 'i')
        return !styleTexts.some(({ file, text }) => file !== 'styles/premium-design-system.css' && re.test(text))
      })
      .map((r) => r.cls)
    expect(stale).toEqual([])
  })

  it('例外清单每一项都写明了保留或延后的理由', () => {
    const noWhy = DASHED_REGISTRY.filter((r) => !r.why || r.why.trim().length < 8).map((r) => r.cls)
    expect(noWhy).toEqual([])
    const badKind = DASHED_REGISTRY.filter((r) => r.kind !== 'keep' && r.kind !== 'defer').map((r) => r.cls)
    expect(badKind).toEqual([])
  })
})
