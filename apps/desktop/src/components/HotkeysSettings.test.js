// @ts-check
/**
 * HotkeysSettings —— 设置页「快捷键」面板（UX 审计 1.6）
 *
 * 现场：主进程 `hotkeys:list` 与 preload `hotkeysList` 早已存在，渲染端**零消费方**
 * （死 API ⇒ 用户完全看不到自己有哪些全局快捷键）。本面板把它接出来，并锁住四件事：
 *   1. 三种"看不到列表"的原因必须可区分：没有快捷键 / 主进程没响应 / 当前宿主没这个能力；
 *   2. 展示名走 locales，主进程那份中文 `label` 一律不进展示面（en 语言会漏未翻译文本）；
 *   3. 未登记的 accelerator 回显**原始 route**，不得编一个看着像真名的词；
 *   4. 面板不得新增可聚焦元素（设置弹窗的键盘走位基线是既成合同）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import i18n from '@/i18n'
import Panel from './HotkeysSettings.vue'
import { HOTKEY_ACTION_KEYS } from '../utils/hotkey-labels.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = path.resolve(HERE, '..', '..')

/** 与主进程 SHORTCUTS 同形的报文（含一条**未登记**的，用来验回显口径） */
function mainShapePayload () {
  return [
    { accelerator: 'CmdOrCtrl+Alt+P', route: '/publish', label: '发布' },
    { accelerator: 'CmdOrCtrl+Alt+H', route: '/', label: '首页' },
    { accelerator: 'CmdOrCtrl+Comma', route: '/accounts', label: '设置' },
    { accelerator: 'CmdOrCtrl+Alt+Q', route: '__quit__', label: '退出' },
    { accelerator: 'CmdOrCtrl+Alt+Z', route: '/brand-new', label: '未来的东西' },
  ]
}

async function flushMicrotasks (times = 6) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

/**
 * 面板按设置弹窗的既成合同渲染：el-alert 在测试里打桩（与本仓其它设置面板一致），
 * 语言由用例显式切换 —— 断言「en 下不漏中文」时必须是真的 en 实例，
 * 否则这条锁只是在看默认语言的输出（同「夹具前提必须自己断言」）。
 */
function mountPanel (locale = 'zh') {
  i18n.global.locale.value = locale
  return mount(Panel, { global: { plugins: [i18n], stubs: { ElAlert: false } } })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  delete window.electronAPI
})

describe('列表渲染', () => {
  it('挂载即拉取，并按主进程顺序渲染每一行（组合键平台化 + 动作走 locales）', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: mainShapePayload() })) }
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(window.electronAPI.hotkeysList).toHaveBeenCalledTimes(1)
    const rows = w.findAll('[data-testid="hotkeys-row"]')
    expect(rows.length).toBe(5)
    expect(rows[0].get('[data-testid="hotkeys-combo"]').text()).toBe('Ctrl + Alt + P')
    expect(rows[0].get('[data-testid="hotkeys-action"]').text()).toBe('打开发布页')
    w.unmount()
  })

  it('主进程的中文 label 绝不进展示面（en 语言下面板不得含任何中文字符）', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: mainShapePayload() })) }
    const w = mountPanel('en')
    await flushMicrotasks()
    const text = w.text()
    expect(text).toMatch(/Open publish page|Keyboard shortcuts/)
    expect(text.replace(/[^\u4e00-\u9fff]/g, ''), 'en 下漏出未翻译文本：' + text).toBe('')
    w.unmount()
  })

  // 回显原始 route 而不是编名字（同「来源标签禁止兜底品牌名」那条纪律）。
  it('未登记的 accelerator 回显原始 route，且不显示主进程的中文 label', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: mainShapePayload() })) }
    const w = mountPanel('zh')
    await flushMicrotasks()
    const last = w.findAll('[data-testid="hotkeys-row"]')[4]
    expect(last.get('[data-testid="hotkeys-action"]').text()).toBe('/brand-new')
    expect(last.attributes('data-mapped')).toBe('false')
    expect(w.text()).not.toContain('未来的东西')
    w.unmount()
  })

  it('哨兵值 __quit__ 不得被当路径渲染（它有专属展示名）', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: mainShapePayload() })) }
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(w.text()).toContain('退出应用')
    expect(w.text()).not.toContain('__quit__')
    w.unmount()
  })

  it('报文里混进的半截条目不产出空行', async () => {
    window.electronAPI = {
      hotkeysList: vi.fn(async () => ({ code: 0, data: [null, {}, { accelerator: '', route: '/x' }, { accelerator: 'CmdOrCtrl+Alt+K', route: '/keywords' }] })),
    }
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(w.findAll('[data-testid="hotkeys-row"]')).toHaveLength(1)
    w.unmount()
  })
})

describe('三种「看不到列表」的原因必须可区分', () => {
  it('code≠0 ⇒ 报错态（不是空态）', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: -1, message: 'boom', data: [] })) }
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(w.find('[data-testid="hotkeys-error"]').exists()).toBe(true)
    expect(w.find('[data-testid="hotkeys-empty"]').exists()).toBe(false)
    w.unmount()
  })

  it('IPC 抛错 ⇒ 报错态，且不留半截列表', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => { throw new Error('ipc down') }) }
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(w.find('[data-testid="hotkeys-error"]').exists()).toBe(true)
    expect(w.findAll('[data-testid="hotkeys-row"]')).toHaveLength(0)
    w.unmount()
  })

  it('注册表为空 ⇒ 空态，而不是报错（两种情况的用户动作不同）', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: [] })) }
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(w.find('[data-testid="hotkeys-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="hotkeys-error"]').exists()).toBe(false)
    w.unmount()
  })

  it('data 不是数组 ⇒ 按「没响应」判，不静默当空列表', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: null })) }
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(w.find('[data-testid="hotkeys-error"]').exists()).toBe(true)
    w.unmount()
  })

  // 纯浏览器 dev / 旧 preload：没有 hotkeysList 能力。
  it('宿主没这个能力 ⇒ 独立提示态，不报错也不假装为空', async () => {
    window.electronAPI = {}
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(w.find('[data-testid="hotkeys-unavailable"]').exists()).toBe(true)
    expect(w.find('[data-testid="hotkeys-error"]').exists()).toBe(false)
    expect(w.find('[data-testid="hotkeys-empty"]').exists()).toBe(false)
    w.unmount()
  })

  it('完全没有 electronAPI（浏览器）时不抛错', async () => {
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(w.find('[data-testid="hotkeys-unavailable"]').exists()).toBe(true)
    w.unmount()
  })
})

describe('可访问性与键盘走位', () => {
  it('表格有列头且 scope=col（读屏能报出「组合键 / 动作」）', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: mainShapePayload() })) }
    const w = mountPanel('zh')
    await flushMicrotasks()
    const heads = w.findAll('thead th')
    expect(heads.map((h) => h.text())).toEqual(['组合键', '动作'])
    heads.forEach((h) => expect(h.attributes('scope')).toBe('col'))
    w.unmount()
  })

  it('面板不新增可聚焦元素（设置弹窗的 Tab 走位基线）', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: mainShapePayload() })) }
    const w = mountPanel('zh')
    await flushMicrotasks()
    expect(w.findAll('a, button, [tabindex], input, select, textarea')).toHaveLength(0)
    w.unmount()
  })
})

// 结构锁：面板不得把主进程的 label 当展示名，也不得自带一份组合键格式化逻辑（收敛在 utils）
describe('结构锁', () => {
  const src = fs.readFileSync(path.join(HERE, 'HotkeysSettings.vue'), 'utf8')
  const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))

  it('不读 IPC 的 label 字段', () => {
    expect(codeLines.join('\n')).not.toMatch(/\.label\b/)
  })

  it('组合键与展示名一律走共享实现，不在组件里再抄一份', () => {
    const joined = codeLines.join('\n')
    expect(joined).toContain('normalizeHotkeyList')
    expect(joined).not.toMatch(/split\(['"]\+['"]\)/)
    expect(joined).not.toMatch(/CmdOrCtrl/)
  })

  it('与主进程快捷键表逐项对齐（跨包锁：读对方源码，不复制常量）', () => {
    const mainSrc = fs.readFileSync(path.join(DESKTOP_ROOT, 'electron/services/hotkeys.js'), 'utf8')
    const start = mainSrc.indexOf('const SHORTCUTS')
    expect(start).toBeGreaterThanOrEqual(0)
    const block = mainSrc.slice(start, mainSrc.indexOf('\n}', start))
    const accelerators = [...block.matchAll(/^\s*'([^']+)':\s*\{\s*route:/gm)].map((m) => m[1])
    expect(accelerators.length, '规模下界：解析退化会让"全部有展示名"变成恒真').toBeGreaterThanOrEqual(8)
        const missing = accelerators.filter((a) => !Object.prototype.hasOwnProperty.call(HOTKEY_ACTION_KEYS, a))
    expect(missing, '新增快捷键必须同 PR 补展示名与 zh/en 文案').toEqual([])
  })
})
