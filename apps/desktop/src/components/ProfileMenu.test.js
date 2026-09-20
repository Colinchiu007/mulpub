import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import fs from 'node:fs'

const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }))

describe('ProfileMenu', () => {
  let store
  let licenseStore
  let wrapper

  async function mountMenu(props = {}) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useIdentityStore } = await import('@/stores/identity')
    store = useIdentityStore()
    store.status = 'authenticated'
    store.user = { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' }
    store.signIn = vi.fn(async () => true)
    store.signInOrSwitch = vi.fn(async () => true)
    store.switchAccount = vi.fn(async () => true)
    store.signOut = vi.fn(async () => true)
    const { useLicenseStore } = await import('@/stores/license')
    licenseStore = useLicenseStore()
    licenseStore.info = { type: 'free', isPro: false, isTrial: false, features: [], daysRemaining: 0 }
    const Component = (await import('./ProfileMenu.vue')).default
    wrapper = mount(Component, { attachTo: document.body, global: { plugins: [pinia] }, props })
    return wrapper
  }

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    push.mockReset()
  })

  it('未登录（signed_out）点击头像直接触发登录，不展开菜单', async () => {
    await mountMenu()
    store.status = 'signed_out'
    store.user = null
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')
    expect(store.signInOrSwitch).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="profile-menu-panel"]').exists()).toBe(false)
  })

  it('已登录点击头像展开菜单，含会员中心/切换账号/退出登录', async () => {
    await mountMenu()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')
    expect(wrapper.find('[data-testid="profile-menu-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('memberCenter.menuEntry')
    expect(wrapper.text()).toContain('memberCenter.switchAccount')
    expect(wrapper.text()).toContain('memberCenter.signOut')
  })

  it('菜单点击会员中心跳转路由并关闭菜单', async () => {
    await mountMenu()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')
    await wrapper.get('[data-testid="profile-menu-member"]').trigger('click')
    expect(push).toHaveBeenCalledWith('/member-center')
    expect(wrapper.find('[data-testid="profile-menu-panel"]').exists()).toBe(false)
  })

  it('菜单点击切换账号与退出登录调用对应操作', async () => {
    await mountMenu()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')
    await wrapper.get('[data-testid="profile-menu-switch"]').trigger('click')
    expect(store.switchAccount).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')
    await wrapper.get('[data-testid="profile-menu-signout"]').trigger('click')
    expect(store.signOut).toHaveBeenCalledTimes(1)
  })

  it('disabled 状态点击展开菜单并显示身份服务未启用说明，不触发登录', async () => {
    await mountMenu()
    store.status = 'disabled'
    store.user = null
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')
    expect(store.signInOrSwitch).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="profile-menu-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('memberCenter.identityDisabledHint')
  })

  it('未登录点击面板内重试登录按钮触发登录', async () => {
    await mountMenu()
    store.status = 'error'
    store.error = { code: 'IDENTITY_SIGN_OUT_FAILED', message: '' }
    store.user = null
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')
    expect(wrapper.find('[data-testid="profile-menu-panel"]').exists()).toBe(true)
    await wrapper.get('[data-testid="profile-menu-signin"]').trigger('click')
    expect(store.signInOrSwitch).toHaveBeenCalledTimes(1)
  })

  it('面板内登录走 signInOrSwitch 自愈（被拒时降级切换账号）', async () => {
    await mountMenu()
    store.status = 'error'
    store.error = { code: 'IDENTITY_SIGN_OUT_FAILED', message: '' }
    store.user = null
    // 模拟主进程残留旧会话：signInOrSwitch 内部完成 signIn 被拒 → switchAccount 成功
    // 注意：组件 setup 时已解构捕获 mountMenu 里的 mock 引用，覆写 store 属性无效，
    // 必须用 mockImplementation 在同一引用上配置行为
    store.signInOrSwitch.mockImplementation(async () => {
      store.status = 'authenticated'
      store.user = { sub: 'sub-2', name: '用户乙', username: 'user-b', picture: '' }
      return true
    })
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')
    await wrapper.get('[data-testid="profile-menu-signin"]').trigger('click')
    expect(store.signInOrSwitch).toHaveBeenCalledTimes(1)
    expect(store.status).toBe('authenticated')
  })

  // ── 侧边栏底部 banner 与菜单内「设置 / 升级 Pro」入口 ──

  it('banner 收起态仅显示一条且带身份状态点，点击后展开菜单', async () => {
    await mountMenu()

    expect(wrapper.get('[data-testid="mp-profile-status"]').classes()).toContain('is-online')
    expect(wrapper.find('[data-testid="profile-menu-panel"]').exists()).toBe(false)

    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    expect(wrapper.find('[data-testid="profile-menu-panel"]').exists()).toBe(true)
  })

  // jsdom 不应用 scoped CSS：用源码级契约断言钉住「面板向上展开且与 banner 等宽」这一布局契约
  // （readFileSync 相对路径写法沿用仓库既有先例：UiModal.test.js）
  it('面板样式契约：向上展开（bottom 定位 + 左右铺满），不回归 top 定位', () => {
    const source = fs.readFileSync('./src/components/ProfileMenu.vue', 'utf8')
    const panelBlock = source.match(/\.profile-menu-panel \{[\s\S]*?\n\}/)

    expect(panelBlock).toBeTruthy()
    expect(panelBlock[0]).toContain('bottom: calc(100% + 8px)')
    expect(panelBlock[0]).toContain('left: 0')
    expect(panelBlock[0]).toContain('right: 0')
    expect(/(^|\s)top:/.test(panelBlock[0])).toBe(false)
  })

  it('精致化契约：菜单项扁平无描边、主操作实心、含图标与状态胶囊、面板有展开动效', () => {
    const source = fs.readFileSync('./src/components/ProfileMenu.vue', 'utf8')
    // 去盒子感：菜单项为扁平行（无边框 + 透明底），仅 hover 显浅底
    const actionBlock = source.match(/\.profile-menu-action \{[\s\S]*?\n\}/)
    expect(actionBlock).toBeTruthy()
    expect(actionBlock[0]).toMatch(/border:\s*none/)
    expect(actionBlock[0]).toMatch(/background:\s*transparent/)
    // 主操作（重试登录）用实心品牌色填充
    const primaryBlock = source.match(/\.profile-menu-action-primary \{[\s\S]*?\n\}/)
    expect(primaryBlock).toBeTruthy()
    expect(primaryBlock[0]).toMatch(/background:\s*var\(--primary\)/)
    // 升级 Pro 去描边（不再用 border-color 强调）
    const upgradeBlock = source.match(/\.profile-menu-action-upgrade \{[\s\S]*?\n\}/)
    expect(upgradeBlock[0]).not.toMatch(/border-color/)
    // 账号操作项统一走 @element-plus/icons-vue 图标（取代裸文字/emoji）
    expect(source).toMatch(/profile-menu-action-icon/)
    expect(source).toMatch(/SwitchButton[\s\S]*?from '@element-plus\/icons-vue'|from '@element-plus\/icons-vue'[\s\S]*?SwitchButton/)
    expect(source).not.toMatch(/⭐/)
    // 状态改为带色点的胶囊
    expect(source).toMatch(/profile-menu-status/)
    expect(source).toMatch(/profile-menu-status-dot/)
    // 错误提示收进容器（左侧色条）
    const errBlock = source.match(/\.profile-menu-error \{[\s\S]*?\n\}/)
    expect(errBlock[0]).toMatch(/border-left:\s*3px solid/)
    // 面板展开动效 + 尊重 reduced-motion
    expect(source).toMatch(/animation:\s*profile-menu-pop/)
    expect(source).toMatch(/@keyframes profile-menu-pop/)
    expect(source).toMatch(/prefers-reduced-motion/)
  })

  it('展开菜单后设置项渲染出图标 svg', async () => {
    await mountMenu()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')
    const settings = wrapper.get('[data-testid="profile-menu-settings"]')
    expect(settings.find('svg').exists()).toBe(true)
    expect(settings.classes()).toContain('profile-menu-action')
  })

  it('展开菜单含设置入口，点击后向上抛出 open-settings 并关闭菜单', async () => {
    await mountMenu()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    const settings = wrapper.get('[data-testid="profile-menu-settings"]')
    expect(settings.text()).toContain('nav.settings')
    expect(settings.classes()).toContain('profile-menu-action')

    await settings.trigger('click')

    expect(wrapper.emitted('open-settings')).toBeTruthy()
    expect(wrapper.find('[data-testid="profile-menu-panel"]').exists()).toBe(false)
  })

  it('非 Pro 用户展开菜单含升级 Pro 入口（与菜单项同版式），点击抛出 upgrade 并关闭菜单', async () => {
    await mountMenu()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    const upgrade = wrapper.get('[data-testid="profile-menu-upgrade"]')
    expect(upgrade.text()).toContain('memberCenter.upgradePro')
    expect(upgrade.classes()).toContain('profile-menu-action')
    expect(upgrade.classes()).toContain('profile-menu-action-upgrade')

    await upgrade.trigger('click')

    expect(wrapper.emitted('upgrade')).toBeTruthy()
    expect(wrapper.find('[data-testid="profile-menu-panel"]').exists()).toBe(false)
  })

  it('Pro 用户展开菜单不显示升级入口，但仍保留设置入口', async () => {
    await mountMenu()
    licenseStore.info = { type: 'pro', isPro: true, isTrial: false, features: [], daysRemaining: 0 }
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    expect(wrapper.find('[data-testid="profile-menu-upgrade"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="profile-menu-settings"]').exists()).toBe(true)
  })

  it('未登录（disabled 身份服务）展开菜单仍提供设置入口', async () => {
    await mountMenu()
    store.status = 'disabled'
    store.user = null
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    expect(wrapper.find('[data-testid="profile-menu-settings"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="profile-menu-upgrade"]').exists()).toBe(true)
  })

  // —— 2026-09-14 缺陷回归：登录失败不再显示「退出失败」 ——

  it('登录失败（未登录态）显示登录类文案，不显示退出失败文案', async () => {
    await mountMenu()
    store.status = 'error'
    store.user = null
    store.error = { code: 'IDENTITY_SIGN_IN_FAILED', message: '' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    const text = wrapper.text()
    expect(text).toContain('memberCenter.loginFailed')
    expect(text).toContain('memberCenter.retryHint')
    expect(text).not.toContain('memberCenter.signOutFailed')
  })

  it('本地会话清理失败时追加可操作提示（主错误 + 清理提示）', async () => {
    await mountMenu()
    store.status = 'error'
    store.user = null
    store.error = {
      code: 'IDENTITY_SIGN_IN_FAILED',
      message: '',
      cleanup: { code: 'IDENTITY_SESSION_CLEAR_FAILED' },
    }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    const text = wrapper.text()
    expect(text).toContain('memberCenter.loginFailed')
    expect(text).toContain('memberCenter.sessionStoreBlocked')
  })

  it('会话清理失败单独出现时也显示可操作提示而不是退出失败', async () => {
    await mountMenu()
    store.status = 'error'
    store.user = null
    store.error = { code: 'IDENTITY_SESSION_CLEAR_FAILED', message: '' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    const text = wrapper.text()
    expect(text).toContain('memberCenter.sessionStoreBlocked')
    expect(text).not.toContain('memberCenter.signOutFailed')
  })

  it('已登录态退出失败仍显示退出失败文案', async () => {
    await mountMenu()
    store.status = 'error'
    store.error = { code: 'IDENTITY_SIGN_OUT_FAILED', message: '' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    expect(wrapper.text()).toContain('memberCenter.signOutFailed')
  })

  it('未知错误码回落到中性文案', async () => {
    await mountMenu()
    store.status = 'error'
    store.user = null
    store.error = { code: 'SOMETHING_UNMAPPED', message: '' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="mp-profile"]').trigger('click')

    const text = wrapper.text()
    expect(text).toContain('memberCenter.operationFailed')
    expect(text).not.toContain('memberCenter.signOutFailed')
  })
})