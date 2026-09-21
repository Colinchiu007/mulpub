// @ts-check
/**
 * sync-platform-config.test.js — 平台配置预同步脚本纯逻辑回归（node --test）
 *
 * 回归保护范围（2026-09-21 轻量版预同步）：
 * - mergePlatforms：共享字段更新 / 人工字段保留 / 新增占位段 / 仅本地平台保留 / bool 归一 / 幂等
 * - extractHeader：文件头注释提取
 * - dump+头拼接：字节级幂等（二次运行产物与一次产物完全一致，防 2026-09-21 粘连事故复辟）
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const yaml = require('js-yaml')

const { mergePlatforms, extractHeader } = require(path.join(__dirname, 'sync-platform-config.js'))

const LOCAL_DOC = {
  platforms: {
    wechat_mp: { id: 1, name: '微信公众号', type: 'article', icon: '💬', category: '中文', content_category: 'IMAGE_TEXT', publish_url: 'https://mp.weixin.qq.com', data_url: '', comment_url: '', cover_size: '900:500', max_title: 64, max_content: 20000, has_api: false },
    legacy_only: { id: 99, name: '仅本地平台', icon: 'X' },
  },
}
const DEFS = [
  { id: 'wechat_mp', name: '微信公众号', category: '中文', content_category: 'IMAGE_TEXT', type: 'article', max_title: 64, max_content: 20000, has_api: 0, enabled: 1 },
  { id: 'douyin', name: '抖音', category: '中文', content_category: 'VIDEO', type: 'mixed', max_title: 55, max_content: 1000, has_api: 0, enabled: 1 },
  { id: 'tiktok', name: 'TikTok', category: '海外', content_category: 'VIDEO', type: 'video', max_title: 150, max_content: 2200, has_api: 1, enabled: 0 },
]

test('mergePlatforms：已有平台更新共享字段且保留人工字段', () => {
  const local = structuredClone(LOCAL_DOC)
  const r = mergePlatforms(local, DEFS)
  const p = r.doc.platforms.wechat_mp
  assert.strictEqual(p.icon, '💬', 'icon 属人工字段不得动')
  assert.strictEqual(p.publish_url, 'https://mp.weixin.qq.com', 'publish_url 属人工字段不得动')
  assert.strictEqual(p.cover_size, '900:500', 'cover_size 属人工字段不得动')
  assert.strictEqual(p.max_content, 20000)
  assert.ok(Object.keys(r.doc.platforms).includes('wechat_mp'))
})

test('mergePlatforms：has_api/enabled 归一为布尔', () => {
  const r = mergePlatforms(structuredClone(LOCAL_DOC), DEFS)
  assert.strictEqual(r.doc.platforms.wechat_mp.has_api, false)
  assert.strictEqual(r.doc.platforms.wechat_mp.enabled, true)
  assert.strictEqual(r.doc.platforms.tiktok.enabled, false, '禁用平台仍写入但为 false')
})

test('mergePlatforms：新增平台写入占位段并上报 added/disabled', () => {
  const r = mergePlatforms(structuredClone(LOCAL_DOC), DEFS)
  assert.strictEqual(r.doc.platforms.douyin.icon, '', '新增平台占位 icon 为空')
  assert.strictEqual(r.doc.platforms.douyin.max_title, 55)
  assert.deepStrictEqual(r.added.sort(), ['douyin', 'tiktok'])
  assert.deepStrictEqual(r.disabled, ['tiktok'])
})

test('mergePlatforms：仅本地存在的平台保留不动并上报 localOnly', () => {
  const r = mergePlatforms(structuredClone(LOCAL_DOC), DEFS)
  assert.deepStrictEqual(r.doc.platforms.legacy_only, { id: 99, name: '仅本地平台', icon: 'X' })
  assert.deepStrictEqual(r.localOnly, ['legacy_only'])
})

test('mergePlatforms：对已合并结果再合并无二次变更（函数级幂等）', () => {
  const r1 = mergePlatforms(structuredClone(LOCAL_DOC), DEFS)
  const r2 = mergePlatforms(structuredClone(r1.doc), DEFS)
  assert.deepStrictEqual(r2.updated, [], '幂等：无二次变更')
  assert.deepStrictEqual(r2.added, [])
})

test('extractHeader：提取 platforms: 顶层键之前的注释块', () => {
  assert.strictEqual(extractHeader('# 注释A\n# 注释B\nplatforms:\n  x:\n    id: 1\n'), '# 注释A\n# 注释B')
  assert.strictEqual(extractHeader('platforms:\n  x: {}\n'), '', '无头注释返回空串')
  assert.strictEqual(extractHeader(''), '')
})

test('dump+头拼接：字节级幂等（二次运行产物一致，防注释粘连复辟）', () => {
  const src = '# 平台配置\n# 人工维护字段：icon/publish_url 等\n\nplatforms:\n  wechat_mp:\n    id: 1\n    name: 微信公众号\n    icon: 💬\n'
  const render = (text) => {
    const header = extractHeader(text)
    const doc = yaml.load(text)
    let out = yaml.dump(mergePlatforms(doc, DEFS).doc, { sortKeys: false, lineWidth: 120, noRefs: true })
    if (header) out = header.replace(/\s+$/, '') + '\n\n' + out
    return out
  }
  const first = render(src)
  const second = render(first)
  assert.strictEqual(second, first, '二次渲染必须字节级一致')
  assert.ok(first.startsWith('# 平台配置\n'), '头注释保留在文件头')
  assert.ok(first.includes('\n\nplatforms:\n'), '头注释与正文之间恰好一个空行，不得粘连')
})
