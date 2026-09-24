// P1-15 回归：opsDevCspMeta 的 transformIndexHtml 必须遵守 Vite 契约。
//
// 历史缺陷：返回对象写成了 { html, headTags }，而 Vite 遍历的是 result.tags，
// dev 启动访问首页即抛 "tags is not iterable"（500）。该插件 apply:'serve' 只在
// dev 跑，CI 只做 vite build 拦不住，故用单测锁死字段名与注入语义。
import { describe, it, expect } from 'vitest'
import { opsDevCspMeta } from '../vite.config.js'

describe('opsDevCspMeta.transformIndexHtml（Vite 契约回归）', () => {
  const plugin = opsDevCspMeta()

  it('仅 dev serve 阶段生效', () => {
    expect(plugin.name).toBe('ops-dev-csp-meta')
    expect(plugin.apply).toBe('serve')
  })

  it('返回带可迭代 tags 数组的对象（曾误写成 headTags 导致 "tags is not iterable"）', () => {
    const result = plugin.transformIndexHtml('<html><head></head><body></body></html>')
    expect(typeof result.html).toBe('string')
    expect(Array.isArray(result.tags)).toBe(true)
    expect(result).not.toHaveProperty('headTags')
  })

  it('注入 CSP meta 且置于 head 顶部（先于其它资源生效）', () => {
    const { tags } = plugin.transformIndexHtml('<html><head></head><body></body></html>')
    expect(tags).toHaveLength(1)
    const [meta] = tags
    expect(meta.tag).toBe('meta')
    expect(meta.injectTo).toBe('head-prepend')
    expect(meta.attrs['http-equiv']).toBe('Content-Security-Policy')
    expect(meta.attrs.content).toContain("default-src 'self'")
  })
})
