// @ts-check
/**
 * SidebarUpdateButton.test.js — 侧边栏「新版本」入口测试
 *
 * 覆盖：显隐、四态文案（新版本 / 下载中 / 重启安装 / 重试安装）、点击退出安装、
 * 下载中禁用重复点击、样式契约（设计标准色 + 窄屏仅图标 + 无新增动画）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import fs from 'node:fs'
import i18n from '@/i18n'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('@/api/publisher', () => ({
  onUpdateStatus: vi.fn(() => function cancel() { /* noop */ }),
  updateCheck: vi.fn(() => Promise.resolve()),
  updateInstallNow: vi.fn(() => Promise.resolve({ code: 0, data: true })),
}))

import { ElMessage } from 'element-plus'
import { updateInstallNow } from '@/api/publisher'
import { resetAutoUpdateState, useAutoUpdate } from '@/composables/useAutoUpdate'
import SidebarUpdateButton from './SidebarUpdateButton.vue'

const SOURCE = fs.readFileSync('./src/components/SidebarUpdateButton.vue', 'utf8')

let wrapper

function mountButton () {
  i18n.global.locale.value = 'zh'
  wrapper = mount(SidebarUpdateButton, { global: { plugins: [i18n] } })
  return wrapper
}

function setStatus (payload) {
  useAutoUpdate().handleUpdateStatus(payload)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAutoUpdateState()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  resetAutoUpdateState()
})

describe('SidebarUpdateButton — 显隐', () => {
  it('无可用更新时不渲染', () => {
    const button = mountButton()
    expect(button.find('[data-testid="mp-update"]').exists()).toBe(false)
  })

  it('检测到新版本时渲染「新版本」入口', () => {
    setStatus({ type: 'available', data: { version: '2.4.0' } })
    const button = mountButton()

    const el = button.get('[data-testid="mp-update"]')
    expect(el.text()).toContain('新版本')
    expect(el.attributes('title')).toContain('2.4.0')
    expect(el.attributes('aria-label')).toContain('新版本')
    expect(el.attributes('aria-busy')).toBe('false')
  })

  it('当前已是最新版本时不渲染', () => {
    setStatus({ type: 'available', data: { version: '2.4.0' } })
    setStatus({ type: 'not-available' })
    const button = mountButton()
    expect(button.find('[data-testid="mp-update"]').exists()).toBe(false)
  })

  it('图标为「圆形底 + 向上箭头」', () => {
    setStatus({ type: 'available', data: { version: '2.4.0' } })
    const button = mountButton()

    const svg = button.get('[data-testid="mp-update"] svg')
    expect(svg.find('circle').exists()).toBe(true)
    const path = svg.get('path').attributes('d')
    // 向上箭头：起点在下、终点在上（y 递减）
    expect(path).toContain('M12 17.2V8.2')
  })
})

describe('SidebarUpdateButton — 点击退出并安装', () => {
  it('点击调用 updateInstallNow 并提示将自动退出', async () => {
    setStatus({ type: 'available', data: { version: '2.4.0' } })
    const button = mountButton()

    await button.get('[data-testid="mp-update"]').trigger('click')

    expect(updateInstallNow).toHaveBeenCalledTimes(1)
    expect(ElMessage.info).toHaveBeenCalledTimes(1)
    expect(ElMessage.info.mock.calls[0][0]).toContain('自动退出')
  })

  it('已下载（ready）时标签为「重启安装」，点击直接安装', async () => {
    setStatus({ type: 'available', data: { version: '2.4.0' } })
    setStatus({ type: 'downloaded', data: {} })
    const button = mountButton()

    const el = button.get('[data-testid="mp-update"]')
    expect(el.text()).toContain('重启安装')

    await el.trigger('click')
    expect(updateInstallNow).toHaveBeenCalledTimes(1)
  })
})

describe('SidebarUpdateButton — 下载与失败态', () => {
  it('下载中显示百分比并禁用重复点击', async () => {
    setStatus({ type: 'available', data: { version: '2.4.0' } })
    setStatus({ type: 'downloading', data: { percent: 50, bytesPerSecond: 2048 } })
    const button = mountButton()

    const el = button.get('[data-testid="mp-update"]')
    expect(el.text()).toContain('下载中 50%')
    expect(el.attributes('disabled')).toBeDefined()
    expect(el.attributes('aria-busy')).toBe('true')

    await el.trigger('click')
    expect(updateInstallNow).not.toHaveBeenCalled()
  })

  it('点击安装失败后显示「重试安装」并可重新点击', async () => {
    updateInstallNow.mockResolvedValueOnce({ code: -1, message: '' })
    setStatus({ type: 'available', data: { version: '2.4.0' } })
    const button = mountButton()

    await button.get('[data-testid="mp-update"]').trigger('click')
    await vi.waitFor(() => {
      expect(button.get('[data-testid="mp-update"]').text()).toContain('重试安装')
    })

    await button.get('[data-testid="mp-update"]').trigger('click')
    expect(updateInstallNow).toHaveBeenCalledTimes(2)
  })
})

describe('SidebarUpdateButton — 样式契约', () => {
  it('图标底色与文字使用设计标准主色（非截图绿色）', () => {
    expect(SOURCE).toMatch(/\.mp-update-icon circle\s*\{[^}]*fill:\s*var\(--primary\)/)
    expect(SOURCE).toMatch(/\.mp-update\s*\{[\s\S]*?color:\s*var\(--primary\)/)
    expect(SOURCE).not.toMatch(/#22c55e|#16a34a|#4ade80|green/i)
  })

  it('窄屏（≤900px）隐藏文字标签，仅保留图标', () => {
    expect(SOURCE).toMatch(/@media \(max-width: 900px\)\s*\{[\s\S]*?\.mp-update-label\s*\{\s*display:\s*none/)
  })

  it('不引入额外关键帧动画（避免与骨架屏契约冲突）', () => {
    expect(SOURCE).not.toContain('@keyframes')
    expect(SOURCE).not.toContain('var(--skeleton-')
  })
})
