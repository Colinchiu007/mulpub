/**
 * AppearanceSettings.test.js — 设置页「外观」面板合同（UX 审计 阶段 1.1）
 *
 * 三格缺一不可：
 *  1) 结构：radiogroup 语义（组名、`role=radio`、`aria-checked` 恰一项为真、roving tabindex）；
 *  2) 行为：选暗色**真的**改了根元素 `data-theme` 并把偏好写进真源 —— 组件里写了 `@click` 不等于
 *     界面变色，本仓「装饰性链路」的同型是"接线了但没人读"；
 *  3) 焦点：沿用既有 `cohere-btn` 类，**不得**新造一个可聚焦变体类 ——
 *     新增变体就必须同步登记进焦点环契约（阶段 3.6 的判定域按类名派生），否则它落在两把锁之间，
 *     成为"看着有焦点环、实际没有任何东西在守"的那一格。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppearanceSettings from './AppearanceSettings.vue'
import { THEME_KEY, MIRROR_KEY } from '@/composables/useTheme'

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
}))

import i18n from '@/i18n'

function mountPanel (storeGetSetting) {
  const storeSetSetting = vi.fn().mockResolvedValue(undefined)
  window.electronAPI = { storeGetSetting, storeSetSetting }
  const w = mount(AppearanceSettings, { global: { plugins: [i18n] }, attachTo: document.body })
  return { w, storeSetSetting }
}

const radios = (w) => w.findAll('[role="radio"]')

describe('AppearanceSettings · 结构（radiogroup 语义）', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    window.localStorage.removeItem(MIRROR_KEY)
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('三态各一个 radio，组名来自 aria-label，且每项都有可访问名', async () => {
    const { w } = mountPanel(vi.fn().mockResolvedValue({ code: 0, data: 'system' }))
    await flushPromises()

    const group = w.find('[role="radiogroup"]')
    expect(group.exists(), '没有 radiogroup ⇒ 三态互斥语义缺失，读屏只会念出三个孤立按钮').toBe(true)
    expect(group.attributes('aria-label'), '组必须有可访问名').toBeTruthy()

    const rs = radios(w)
    expect(rs).toHaveLength(3)
    for (const r of rs) {
      expect(r.text().trim(), 'radio 必须有可见文本作为可访问名').not.toBe('')
      // 三态的取值必须与持久化词表逐字一致（词表漂移 = 界面写着"跟随系统"而存进去的是别的串）
      expect(['appearance-theme-system', 'appearance-theme-light', 'appearance-theme-dark'])
        .toContain(r.attributes('id'))
    }
  })

  it('aria-checked 恰一项为 true；其余为 false（不是 undefined / 不是缺属性）', async () => {
    const { w } = mountPanel(vi.fn().mockResolvedValue({ code: 0, data: 'dark' }))
    await flushPromises()

    const checked = radios(w).filter((r) => r.attributes('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0].attributes('id')).toBe('appearance-theme-dark')
    for (const r of radios(w)) expect(['true', 'false']).toContain(r.attributes('aria-checked'))
  })

  it('roving tabindex：组内只有一个 Tab 停靠点（当前选中项）', async () => {
    const { w } = mountPanel(vi.fn().mockResolvedValue({ code: 0, data: 'light' }))
    await flushPromises()

    const stops = radios(w).filter((r) => r.attributes('tabindex') === '0')
    expect(stops, 'Tab 逐个停在三个选项上 = 键盘用户每切换一次都要走三站').toHaveLength(1)
    expect(stops[0].attributes('id')).toBe('appearance-theme-light')
    expect(radios(w).filter((r) => r.attributes('tabindex') === '-1')).toHaveLength(2)
  })

  it('焦点环沿用既有 cohere-btn 变体，不新造未登记的可聚焦类', async () => {
    const { w } = mountPanel(vi.fn().mockResolvedValue({ code: 0, data: 'system' }))
    await flushPromises()
    for (const r of radios(w)) {
      expect(r.classes(), '新变体类会落在焦点环契约的判定域之外').toContain('cohere-btn')
    }
  })
})

describe('AppearanceSettings · 行为与键盘', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    window.localStorage.removeItem(MIRROR_KEY)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('点「暗色」⇒ 根元素 data-theme 立即为 dark，且真源被写入恰一次', async () => {
    const { w, storeSetSetting } = mountPanel(vi.fn().mockResolvedValue({ code: 0, data: 'system' }))
    await flushPromises()

    await w.find('#appearance-theme-dark').trigger('click')
    await flushPromises()

    expect(document.documentElement.getAttribute('data-theme'), '界面没变色 = 这个入口只是装饰').toBe('dark')
    const darkWrites = storeSetSetting.mock.calls.filter((a) => a[0] === THEME_KEY && a[1] === 'dark')
    expect(darkWrites, '偏好必须进真源，否则重进应用就丢了').toHaveLength(1)
  })

  it('点「跟随系统」存的是可写的 system，而不是删除键', async () => {
    const { w, storeSetSetting } = mountPanel(vi.fn().mockResolvedValue({ code: 0, data: 'dark' }))
    await flushPromises()

    await w.find('#appearance-theme-system').trigger('click')
    await flushPromises()

    expect(storeSetSetting, '退回跟随系统必须是显式值').toHaveBeenCalledWith(THEME_KEY, 'system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light') // 夹具 matchMedia 默认非暗
  })

  it('方向键在组内移动并选中（radiogroup 惯例），边界回绕不越界', async () => {
    const { w } = mountPanel(vi.fn().mockResolvedValue({ code: 0, data: 'system' }))
    await flushPromises()
    const selected = () => radios(w).find((r) => r.attributes('aria-checked') === 'true').attributes('id')
    const group = () => w.find('[role="radiogroup"]')

    expect(selected()).toBe('appearance-theme-system')

    await group().trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(selected(), '右移应到浅色').toBe('appearance-theme-light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    await group().trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(selected(), '左移回浅色的前一项').toBe('appearance-theme-system')

    // 真正的越界检查：从第一项往左必须绕到最后一项，而不是停在原地或指向不存在的项
    await group().trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(selected(), 'system 往左越界应绕到 dark').toBe('appearance-theme-dark')
  })

  it('无关按键不吞事件（不阻塞浏览器默认行为）', async () => {
    const { w } = mountPanel(vi.fn().mockResolvedValue({ code: 0, data: 'system' }))
    await flushPromises()
    const before = document.documentElement.getAttribute('data-theme')
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'Tab' })
    await flushPromises()
    expect(document.documentElement.getAttribute('data-theme')).toBe(before)
  })

  it('如实告知暗色适配仍在核对，不宣称完美', async () => {
    const { w } = mountPanel(vi.fn().mockResolvedValue({ code: 0, data: 'dark' }))
    await flushPromises()
    const notice = w.find('[data-testid="appearance-dark-notice"]')
    expect(notice.exists(), '缺少适配现状说明 ⇒ 用户会把个别未适配区域当成故障').toBe(true)
    expect(notice.text()).toContain('暗色')
  })
})

/**
 * 启动层的两格合同。它们不属于组件，但属于"暗色真的可用"这件事：
 * 组件写得再对，第一帧是白的，用户看到的就是闪烁。
 */
describe('主题启动层合同（index.html / CSP）', () => {
  const readHtml = async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    return readFileSync(join(process.cwd(), 'src/index.html'), 'utf8')
  }

  it('画布底色走 UA 原生 color-scheme（JS 之前就要对）', async () => {
    const html = await readHtml()
    expect(html, '缺 meta[name=color-scheme] ⇒ JS 执行前的那帧仍是默认白底').toMatch(
      /<meta\s+name=["']color-scheme["']\s+content=["']light dark["']/)
  })

  it('CSP 的 script-src 不得为"消一帧底色"而放开内联脚本', async () => {
    const html = await readHtml()
    const m = /script-src\s+([^;"]+)/.exec(html)
    expect(m, '取不到 script-src ⇒ 判据无从核对').toBeTruthy()
    expect(m[1], '内联脚本被放进 CSP = 用安全边界换观感；本仓这条是选择不做，不是没做').not.toMatch(/unsafe-(inline|eval)/)
  })
})
