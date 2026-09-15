/**
 * 骨架屏一致性契约测试（frontend-skeleton-unification）
 *
 * 回归保护目标：历史上骨架屏的渐变、keyframes、圆角散落在 6 个文件里
 * （两套 shimmer keyframes 互相覆盖、4 种基色、3 种圆角），本次统一到
 * styles/skeleton.css + UiSkeleton.vue。本测试用源码扫描锁死"唯一来源"，
 * 防止后续再冒出第 7 份内联骨架。
 *
 * 说明：jsdom 不应用 scoped CSS，因此沿用仓库既有做法（UiModal.test.js）
 * 用 readFileSync + 正则做源码级 CSS 契约断言。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..')
const SKELETON_CSS = path.join(SRC, 'styles', 'skeleton.css')
const UI_SKELETON = path.join(SRC, 'components', 'UiSkeleton.vue')

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

// 只扫描随包发布的界面资产：测试文件自身会包含这些模式字符串，必须排除
const isTestFile = (f) => /\.(test|spec)\.(js|ts)$/.test(f) || f.includes('__tests__')
const sourceFiles = walk(SRC).filter((f) => /\.(vue|css|js)$/.test(f) && !isTestFile(f))
const relative = (f) => path.relative(SRC, f).replace(/\\/g, '/')

describe('skeleton design-token contract', () => {
  it('defines the skeleton tokens in exactly one place', () => {
    const owners = sourceFiles.filter((f) => /--skeleton-bg\s*:/.test(fs.readFileSync(f, 'utf8')))
    expect(owners.map(relative)).toEqual(['styles/skeleton.css'])
  })

  it('defines a dark-theme override for the skeleton tokens', () => {
    const css = fs.readFileSync(SKELETON_CSS, 'utf8')
    const dark = css.slice(css.indexOf('[data-theme="dark"]'))
    expect(dark).toContain('--skeleton-bg')
    expect(dark).toContain('--skeleton-shimmer')
  })

  it('defines the skeleton keyframes exactly once and bans the legacy names', () => {
    const defs = []
    for (const f of sourceFiles) {
      const text = fs.readFileSync(f, 'utf8')
      for (const m of text.match(/@keyframes\s+[\w-]+/g) || []) {
        const name = m.replace(/@keyframes\s+/, '')
        // 只关心 shimmer 系动画：styles/history-panel.css 的 seg-shimmer 是流水线进度条
        // 扫光（2s 无限），语义与骨架屏无关，属既定例外。
        if (/shimmer/i.test(name)) defs.push(`${relative(f)}:${name}`)
      }
    }
    expect(defs.filter((d) => d.endsWith(':mp-skeleton-shimmer'))).toEqual([
      'styles/skeleton.css:mp-skeleton-shimmer'
    ])
    // 历史两套 ad-hoc 命名（ProjectLibrary 的 shimmer、其余文件的 skeleton-shimmer）必须归零
    expect(defs.filter((d) => /:(shimmer|skeleton-shimmer)$/.test(d))).toEqual([])
  })

  it('honours prefers-reduced-motion', () => {
    expect(fs.readFileSync(SKELETON_CSS, 'utf8')).toContain('prefers-reduced-motion')
  })

  it('confines the skeleton tokens to skeleton.css + UiSkeleton.vue', () => {
    const allowed = ['styles/skeleton.css', 'components/UiSkeleton.vue']
    const offenders = sourceFiles.filter((f) => {
      if (allowed.includes(relative(f))) return false
      return /var\(--skeleton-/.test(fs.readFileSync(f, 'utf8'))
    })
    expect(offenders.map(relative)).toEqual([])
  })

  it('removes the legacy ad-hoc skeleton class names', () => {
    const legacy = ['skeleton-thumb', 'skeleton-line', 'skeleton-header', 'skeleton-title', 'skeleton-desc', 'skeleton-meta']
    const offenders = []
    for (const f of sourceFiles) {
      const text = fs.readFileSync(f, 'utf8')
      for (const cls of legacy) {
        if (text.includes(`.${cls}`)) offenders.push(`${relative(f)}:.${cls}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('only UiSkeleton.vue may own the .mp-skeleton-surface bone markup', () => {
    const offenders = sourceFiles.filter((f) => {
      if (relative(f) === 'components/UiSkeleton.vue') return false
      if (relative(f) === 'styles/skeleton.css') return false
      return /mp-skeleton-surface/.test(fs.readFileSync(f, 'utf8'))
    })
    expect(offenders.map(relative)).toEqual([])
  })

  it('ships a documented variant list on the component', () => {
    const text = fs.readFileSync(UI_SKELETON, 'utf8')
    for (const variant of ['text', 'paragraph', 'rect', 'circle', 'card', 'list', 'table', 'chart', 'custom']) {
      expect(text).toContain(`'${variant}'`)
    }
  })
})
