import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import TabBar from './TabBar.vue'
import { useTabStore } from '@/stores/tab'
import i18n from '@/i18n'

const srcDir = dirname(fileURLToPath(import.meta.url))
const tabbarSrc = readFileSync(join(srcDir, 'TabBar.vue'), 'utf8')

function seedTabs() {
  const store = useTabStore()
  store.tabs = [
    { tabId: 'home', url: '', title: '首页', isHome: true, loading: false },
    { tabId: 't1', url: 'https://creator.douyin.com/', title: '抖音', isHome: false, loading: false },
  ]
  store.activeTabId = 'home'
  return store
}

function mountBar() {
  seedTabs()
  return mount(TabBar, { global: { plugins: [i18n] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  i18n.global.locale.value = 'zh'
})

describe('TabBar 功能契约', () => {
  it('活动标签带 .active 类', () => {
    const w = mountBar()
    expect(w.get('[data-testid="tab-home"]').classes()).toContain('active')
    expect(w.get('[data-testid="tab-t1"]').classes()).not.toContain('active')
  })

  it('首页标签无关闭按钮，浏览器标签有关闭按钮', () => {
    const w = mountBar()
    expect(w.find('[data-testid="tab-close-home"]').exists()).toBe(false)
    expect(w.find('[data-testid="tab-close-t1"]').exists()).toBe(true)
  })

  it('点击标签触发 switch-tab，点击 + 触发 create-tab，点击关闭触发 close-tab', async () => {
    const w = mountBar()
    await w.get('[data-testid="tab-t1"]').trigger('click')
    expect(w.emitted('switch-tab')).toEqual([['t1']])
    await w.get('[data-testid="tab-add"]').trigger('click')
    expect(w.emitted('create-tab')).toHaveLength(1)
    await w.get('[data-testid="tab-close-t1"]').trigger('click')
    expect(w.emitted('close-tab')).toEqual([['t1']])
  })
})

describe('TabBar 样式精致化契约（去硬编码灰、改用设计 token）', () => {
  it('保留 36px 高度不变量（WebContentsView TOP=76px 契约）', () => {
    expect(tabbarSrc).toMatch(/\.tab-bar\s*\{[^}]*height:\s*36px/s)
  })

  it('标签栏背景不再使用旧硬编码灰 #e8eaf2，改用设计 token', () => {
    const barBlock = tabbarSrc.slice(tabbarSrc.indexOf('.tab-bar {'), tabbarSrc.indexOf('.tab-bar-tabs'))
    expect(barBlock).not.toMatch(/background:\s*#e8eaf2/)
    expect(barBlock).toMatch(/var\(--color-/)
  })

  it('活动标签用卡片底 + 品牌主色点缀（token 化）', () => {
    const activeBlock = tabbarSrc.slice(tabbarSrc.indexOf('.tab-item.active'))
    expect(activeBlock).toMatch(/var\(--color-bg-card/)
    expect(activeBlock).toMatch(/var\(--color-primary/)
  })

  it('平台图标图片有尺寸约束（tab-icon-img）', () => {
    expect(tabbarSrc).toMatch(/\.tab-icon-img\s*\{/)
  })
})

describe('TabBar 加载态徽标（转圈只在真加载中出现）', () => {
  function mountWithLoading (flags) {
    const store = useTabStore()
    store.tabs = [
      { tabId: 'home', url: '', title: '首页', isHome: true, loading: false },
      { tabId: 't1', url: 'https://creator.douyin.com/', title: '抖音', isHome: false, loading: flags[0] },
      { tabId: 't2', url: 'https://cp.kuaishou.com/article/manage/video', title: '快手', isHome: false, loading: flags[1] },
    ]
    store.activeTabId = 'home'
    return mount(TabBar, { global: { plugins: [i18n] } })
  }

  it('仅 loading=true 的标签渲染 spinner，其余标签不渲染', () => {
    const w = mountWithLoading([true, false])
    expect(w.get('[data-testid="tab-t1"]').find('.tab-spinner').exists()).toBe(true)
    expect(w.get('[data-testid="tab-t2"]').find('.tab-spinner').exists()).toBe(false)
    expect(w.findAll('.tab-spinner')).toHaveLength(1)
  })

  it('全部标签加载完毕时不得残留任何 spinner', () => {
    const w = mountWithLoading([false, false])
    expect(w.findAll('.tab-spinner')).toHaveLength(0)
  })

  it('spinner 必须是 SVG 图标组件，不得是裸 Unicode 字形', () => {
    const w = mountWithLoading([true, false])
    const spinner = w.get('.tab-spinner')
    expect(spinner.find('svg').exists()).toBe(true)
    expect(spinner.text()).toBe('')
  })

  it('结构锁：TabBar.vue 源码不得再出现裸字形 ⟳，且 spinner 动画有 reduced-motion 降级', () => {
    expect(tabbarSrc).not.toMatch(/⟳/)
    expect(tabbarSrc).toMatch(/prefers-reduced-motion/)
  })
})

describe('TabBar 标签文字随语言切换（阶段 3.1：字面量收进 locales）', () => {
  // 为什么必须有这条：把 '首页' 换成 t('nav.home') 之后，zh 档下新旧实现**产出完全相同**，
  // 既有全部用例照绿 —— 也就是说"抽取是否真的接上了 i18n"这件事，只在非 zh 档才可观。
  // 所以判别性的那一条是 en 档；结构锁只是它的备份（防止有人把 t() 换回字面量、
  // 而那一轮恰好没跑 en 用例）。
  function mountWithLocale(locale) {
    i18n.global.locale.value = locale
    const store = useTabStore()
    store.tabs = [
      { tabId: 'home', url: '', title: '', isHome: true, loading: false },
      { tabId: 'blank', url: 'about:blank', title: '', isHome: false, loading: false },
    ]
    store.activeTabId = 'home'
    const w = mount(TabBar, { global: { plugins: [i18n] } })
    return { text: (id) => w.get('[data-testid="tab-' + id + '"]').text() }
  }

  it('zh 档：首页标签显示「首页」，空白标签显示「新标签页」', () => {
    const { text } = mountWithLocale('zh')
    expect(text('home')).toContain('首页')
    expect(text('blank')).toContain('新标签页')
  })

  it('en 档：同一份代码必须产出英文文案 —— 字面量写死时这条必红', () => {
    const { text } = mountWithLocale('en')
    expect(text('home')).toContain('Home')
    expect(text('blank')).toContain('New Tab')
    expect(text('home')).not.toContain('首页')
    expect(text('blank')).not.toContain('新标签页')
  })

  it('结构锁：getTabLabel 只能从 locales 取词，不得自带字面量', () => {
    const start = tabbarSrc.indexOf('function getTabLabel')
    expect(start).toBeGreaterThan(-1)
    const body = tabbarSrc.slice(start, start + 700)
    expect(body).toContain("t('nav.home')")
    expect(body).toContain("t('tabs.newTabTitle')")
    expect(body).not.toMatch(/return\s*'首页/)
    expect(body).not.toMatch(/return\s*'新标签页/)
  })
})

  it('层间关系（阶段 3.2 的入口证据）：title 非空时可见文案取 title，getTabLabel 只是 fallback', () => {
    i18n.global.locale.value = 'en'
    const store = useTabStore()
    store.tabs = [{ tabId: 'home', url: '', title: '首页', isHome: true, loading: false }]
    store.activeTabId = 'home'
    const w = mount(TabBar, { global: { plugins: [i18n] } })
    expect(w.get('[data-testid="tab-home"]').text()).toContain('首页')
    // 这不是「en 档应显示 Home」的缺陷断言。stores/tab.js 的 title 目前是写死的字面量，
    // 把语言决策放进 store 会牵动已持久化标签数据的语义，属阶段 3.2（首页/主页 四份真源收敛）。
    // 本批只把 fallback 接上 locales。这条用例的作用是：谁把 title 也改成随语言走，它会立刻变红，
    // 逼那次改动显式改判据并交代持久化数据的迁移，而不是让"标签已国际化"这句话悄悄变成假的。
  })
