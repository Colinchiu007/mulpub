import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import i18n from '@/i18n'

const storeGetSetting = vi.fn()
const storeSetSetting = vi.fn()
const notifySuccess = vi.fn()
const notifyError = vi.fn()

vi.mock('@/api/publisher', () => ({
  storeGetSetting: (...args) => storeGetSetting(...args),
  storeSetSetting: (...args) => storeSetSetting(...args),
  aiRewrite: vi.fn(),
  aiListRewriteStrategies: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  aiGetRecommendedStrategies: vi.fn().mockResolvedValue({ code: 0, data: [] }),
}))

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({ notifySuccess, notifyError, notifyWarning: vi.fn(), notifyInfo: vi.fn() }),
}))

vi.mock('@/utils/user-facing-error', () => ({ formatUserError: () => ({ message: 'error' }) }))
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), error: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }))

import CopyLibraryPanel from './CopyLibraryPanel.vue'

const COLLECTED = [
  { id: 'c1', title: '采集文章甲', content: '采集正文甲', wordCount: 8, source: 'url', sourceUrl: 'https://a.com/1', createdAt: '2026-09-14T01:00:00.000Z' },
]
const REWRITES = [
  { id: 'r1', fromKey: 'collect:c1', fromTitle: '采集文章甲', title: '采集文章甲', content: '改写正文甲', createdAt: '2026-09-14T09:00:00.000Z' },
]

function factory (settings = {}) {
  storeGetSetting.mockImplementation(async (key) => {
    if (key in settings) return settings[key]
    if (key === 'collected_items') return JSON.stringify(COLLECTED)
    if (key === 'copy_library_rewrites') return JSON.stringify(REWRITES)
    return null
  })
  i18n.global.locale.value = 'zh'
  return mount(CopyLibraryPanel, { global: { plugins: [i18n] } })
}

async function flush () {
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

describe('CopyLibraryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeSetSetting.mockResolvedValue(undefined)
  })

  it('合并渲染采集正文与改写文案，并显示性质标识', async () => {
    const w = factory()
    await flush()
    const items = w.vm.items
    expect(items).toHaveLength(2)
    expect(w.find('[data-testid="copy-library-badge-rewrite:r1"]').text()).toBe('改写')
    expect(w.find('[data-testid="copy-library-badge-collect:c1"]').text()).toBe('采集')
    expect(w.find('[data-testid="copy-library-count"]').text()).toContain('2')
    expect(w.find('[data-testid="copy-library-list"]').exists()).toBe(true)
    // 每行右侧都有改写按钮
    expect(w.find('[data-testid="copy-library-rewrite-collect:c1"]').exists()).toBe(true)
    expect(w.find('[data-testid="copy-library-rewrite-rewrite:r1"]').exists()).toBe(true)
  })

  it('无数据时显示空状态', async () => {
    const w = factory({ collected_items: '[]', copy_library_rewrites: '[]' })
    await flush()
    expect(w.vm.items).toHaveLength(0)
    expect(w.text()).toContain('暂无文案')
    expect(w.find('[data-testid="copy-library-list"]').exists()).toBe(false)
  })

  it('筛选：仅采集 / 仅改写', async () => {
    const w = factory()
    await flush()
    w.vm.filter = 'collect'
    await nextTick()
    expect(w.vm.filteredItems.map((i) => i.origin)).toEqual(['collect'])
    w.vm.filter = 'rewrite'
    await nextTick()
    expect(w.vm.filteredItems.map((i) => i.origin)).toEqual(['rewrite'])
    // 点击筛选按钮同样生效
    await w.find('[data-testid="copy-library-filter-all"]').trigger('click')
    expect(w.vm.filter).toBe('all')
    expect(w.vm.filteredItems).toHaveLength(2)
  })

  it('筛选无结果时显示筛选空态', async () => {
    const w = factory({ collected_items: '[]' })
    await flush()
    w.vm.filter = 'collect'
    await nextTick()
    expect(w.vm.filteredItems).toHaveLength(0)
    expect(w.text()).toContain('当前筛选下暂无文案')
  })

  it('点击行内「改写」打开弹窗并携带来源键', async () => {
    const w = factory()
    await flush()
    await w.find('[data-testid="copy-library-rewrite-collect:c1"]').trigger('click')
    await nextTick()
    expect(w.vm.rewriteSource).toMatchObject({
      fromKey: 'collect:c1',
      title: '采集文章甲',
      content: '采集正文甲',
      sourceUrl: 'https://a.com/1',
    })
    expect(w.find('[data-testid="copy-rewrite-modal"]').exists()).toBe(true)
  })

  it('改写回调持久化到 copy_library_rewrites 并提示成功', async () => {
    const w = factory()
    await flush()
    await w.vm.onRewritten({ fromKey: 'collect:c1', fromTitle: '采集文章甲', content: '新的改写结果' })
    const [key, payload] = storeSetSetting.mock.calls.find((c) => c[0] === 'copy_library_rewrites')
    expect(key).toBe('copy_library_rewrites')
    expect(JSON.parse(payload)[0]).toMatchObject({ fromKey: 'collect:c1', content: '新的改写结果' })
    expect(notifySuccess).toHaveBeenCalledWith('collection.rewriteSuccess')
  })

  it('空内容的改写回调不落库', async () => {
    const w = factory()
    await flush()
    await w.vm.onRewritten({ fromKey: 'collect:c1', content: '   ' })
    expect(storeSetSetting).not.toHaveBeenCalled()
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  it('查看打开只读预览并展示全文', async () => {
    const w = factory()
    await flush()
    await w.find('[data-testid="copy-library-rewrite-collect:c1"]').exists()
    w.vm.openPreview(w.vm.items.find((i) => i.origin === 'collect'))
    await nextTick()
    expect(w.find('[data-testid="copy-preview-overlay"]').exists()).toBe(true)
    expect(w.find('[data-testid="copy-preview-content"]').text()).toBe('采集正文甲')
    await w.find('[data-testid="copy-preview-close"]').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="copy-preview-overlay"]').exists()).toBe(false)
  })

  it('读取设置异常时不崩溃（解析失败回落空列表）', async () => {
    const w = factory({ collected_items: 'not-json{{{', copy_library_rewrites: 'not-json{{{' })
    await flush()
    expect(w.vm.items).toEqual([])
  })

  // 源码级 CSS 契约：jsdom 不应用 scoped 样式，长文本换行只能靠源码断言守住
  it('预览容器声明 pre-wrap + anywhere + break-word（长文本换行契约）', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'CopyLibraryPanel.vue')
    const source = readFileSync(file, 'utf8')
    const block = source.match(/\.copy-preview-content\s*\{([\s\S]*?)\}/)
    expect(block).toBeTruthy()
    expect(block[1]).toMatch(/white-space:\s*pre-wrap/)
    expect(block[1]).toMatch(/overflow-wrap:\s*anywhere/)
    expect(block[1]).toMatch(/word-break:\s*break-word/)
  })
})
