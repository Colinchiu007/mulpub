/**
 * collection-css-cascade-order.test.js — 采集页的模块图不得把「视频创作页的样式」提前拖进来
 * （fix-collection-rewrite-publish-flow，2026-10-24）。
 *
 * 事故（CI QG Visual 判红，create-editor.png 漂移 590903 px / 28.496%）：
 *   本刀新增的 `CollectionVideoProgressModal.vue` 从**桶文件** `@/views/video-creation`
 *   取 `StageProgress`。桶文件同时 re-export `PipelineSelector`，而 PipelineSelector.vue
 *   顶部 `import '@/styles/pipeline-selector.css'` —— 于是 `pipeline-selector.css` 被注入到
 *   **采集页**的模块图里，位置比创作页的 `create-view.css` 更靠前。
 *
 * 为什么这会改像素（不是玄学）：
 *   两份全局样式表对**卡片边框**给出同特异性（0,2,0）的声明，靠**加载顺序**决胜：
 *     · `create-view.css`      `.pipeline-card.<category> { border-left: 3px solid var(--pipe-*) }`
 *     · `pipeline-selector.css` `.pipeline-card.has-bg       { border-color: rgba(255,255,255,0.16) }`
 *   正常顺序（create-view.css 先、pipeline-selector.css 后）⇒ `.has-bg` 的白边胜出，
 *   卡片边框是半透明白 —— 这就是基线。顺序一翻转 ⇒ 分类色边框胜出 ⇒ 每张卡片边框变色 ⇒
 *   视频创作页整片卡片区域像素漂移 ⇒ GATE-7B（0 px 容差）判红。
 *
 * 本锁的判据：**采集页的模块图不得触及 `pipeline-selector.css`**。
 *   采集页根本没有流水线卡片，这条样式对它是纯负担；而它一旦提前注入，
 *   就会去改**别的页面**的层叠结果 —— 这类「A 页面的代码改 B 页面的像素」的事故，
 *   靠人读 diff 极难发现，只能机械锁死。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '..', '..') // apps/desktop/src
const MAIN = join(SRC, 'main.js')
const COLLECTION_VIEW = join(SRC, 'views', 'Collection.vue')

/** 桶文件（barrel）：它 re-export 了 PipelineSelector ⇒ 连带 pipeline-selector.css。 */
const VIDEO_CREATION_BARREL = '@/views/video-creation'

/** 解析 import/export 的模块说明符（含动态 import 与 export ... from）。 */
function collectSpecs (source) {
  const specs = []
  const re = /(?:import|export)\s*(?:\(\s*)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(source)) !== null) specs.push({ spec: m[1], idx: m.index })
  const styleRe = /<style[^>]*src=['"]([^'"]+)['"]/g
  while ((m = styleRe.exec(source)) !== null) specs.push({ spec: m[1], idx: m.index })
  const impRe = /@import\s+(?:url\()?['"]([^'"]+)['"]/g
  while ((m = impRe.exec(source)) !== null) specs.push({ spec: m[1], idx: m.index })
  return specs.sort((a, b) => a.idx - b.idx)
}

/** 把说明符解析成仓库里的真实文件（只认本地模块；npm 包与别名外路径直接放弃）。 */
function resolveSpec (fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  const candidates = [
    base, `${base}.js`, `${base}.vue`, `${base}.ts`, `${base}.css`,
    join(base, 'index.js'), join(base, 'index.ts')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/**
 * 深度优先按源码顺序走模块图（近似 Vite dev 的模块求值顺序）。
 * @param {string} entry 入口文件
 * @param {(file: string) => void} visitCss 命中样式表时回调
 * @returns {{ css: string[], files: string[] }}
 */
function walkModuleGraph (entry, visitCss) {
  const seen = new Set()
  const css = []
  const files = []
  const visit = (file, depth) => {
    if (!file || seen.has(file) || depth > 60) return
    seen.add(file)
    files.push(file)
    let source
    try { source = readFileSync(file, 'utf8') } catch (_) { return }
    for (const { spec } of collectSpecs(source)) {
      const target = resolveSpec(file, spec)
      if (!target) continue
      if (target.endsWith('.css')) {
        css.push(target)
        visitCss?.(target)
        visit(target, depth + 1)
        continue
      }
      visit(target, depth + 1)
    }
  }
  visit(entry, 0)
  return { css, files }
}

/** features/collection 下的非测试源文件。 */
function collectionFeatureSources () {
  const dir = join(SRC, 'features', 'collection')
  const out = []
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    if (!statSync(file).isFile()) continue
    if (!/\.(js|vue)$/.test(name)) continue
    if (/\.test\.js$/.test(name)) continue
    out.push(file)
  }
  return out
}

describe('采集页模块图不得改变全局层叠顺序（视频创作页卡片边框）', () => {
  it('采集页的模块图触及不到 pipeline-selector.css（桶文件泄漏的探针）', () => {
    const { css } = walkModuleGraph(COLLECTION_VIEW)
    const leaked = css.filter(file => file.endsWith('pipeline-selector.css'))
    expect(
      leaked.map(file => relative(SRC, file)),
      '采集页把 pipeline-selector.css 拖进了自己的模块图：它会抢在 create-view.css 之前注入，' +
      '把视频创作页卡片边框从「半透明白」翻成「分类色」⇒ 视觉基线 GATE-7B 判红。' +
      '取组件请直连具体模块（如 @/views/video-creation/StageProgress.vue），不要走桶文件。'
    ).toEqual([])
  })

  it('features/collection 下没有任何源文件从桶文件 @/views/video-creation 取组件', () => {
    const offenders = []
    for (const file of collectionFeatureSources()) {
      const source = readFileSync(file, 'utf8')
      for (const { spec } of collectSpecs(source)) {
        if (spec === VIDEO_CREATION_BARREL) {
          offenders.push(`${relative(SRC, file)} → ${spec}`)
        }
      }
    }
    expect(
      offenders,
      `桶文件 ${VIDEO_CREATION_BARREL} 会连带 PipelineSelector 的样式；` +
      '请直连具体组件文件（如 @/views/video-creation/StageProgress.vue）。'
    ).toEqual([])
  })

  it('全局注入顺序：create-view.css 必须早于 pipeline-selector.css（白边胜出＝基线）', () => {
    const { css } = walkModuleGraph(MAIN)
    const createView = css.findIndex(file => file.endsWith('create-view.css'))
    const selector = css.findIndex(file => file.endsWith('pipeline-selector.css'))
    expect(createView, '全局样式表里没有 create-view.css（判据失效）').toBeGreaterThanOrEqual(0)
    expect(selector, '全局样式表里没有 pipeline-selector.css（判据失效）').toBeGreaterThanOrEqual(0)
    expect(
      createView,
      'pipeline-selector.css 抢在 create-view.css 之前注入 ⇒ 同特异性的分类色边框压过 ' +
      '.has-bg 白边 ⇒ 视频创作页卡片边框变色 ⇒ 视觉基线判红。'
    ).toBeLessThan(selector)
  })
})
