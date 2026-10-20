/**
 * PublishDestinationModal.test.js — 「已存草稿」披露与流水线显式选择契约
 *
 * 背景（PRD-UI-FLOW-CLARITY §9 验收 #8 / §1.2 混淆点）：
 * 1. 该弹窗的 subtitle 是**全流程唯一**告诉用户"刚才那步已静默存了一份草稿"的地方。
 *    此前既无 role 也无 data-testid，任何回归都锁不住它 —— 一旦文案被删，
 *    草稿箱里出现"用户没存过的草稿"就再也没人告知。
 * 2. 「流水线选择」的空选项原本可选中，随后 `chooseVideo` 用
 *    `selectedPipeline || 'story2video-compose'` 静默回落到默认流水线：
 *    用户以为没选，实际发了另一条流水线的创作请求。
 *
 * ⚠️ 组件用 `<teleport to="body">` 渲染，`wrapper.find/get` 找不到节点，
 *    必须查 `document.body`（与 HotTopics.test.js 的 `publish-dest-article` 同模式）。
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import PublishDestinationModal from './PublishDestinationModal.vue'

// 配置档案列表走 IPC（story2video:config-profile-list），组件测试里换成可控桩。
const { configProfileListMock } = vi.hoisted(() => ({ configProfileListMock: vi.fn() }))
vi.mock('@/api/publisher', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, story2videoConfigProfileList: configProfileListMock }
})

let wrapper

const profile = (overrides = {}) => ({
  id: 'profile-000000000001',
  name: '口播竖屏',
  pipelineId: 'story2video-compose',
  snapshot: { schemaVersion: 1 },
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  ...overrides,
})

async function mountModal (props = {}) {
  wrapper = mount(PublishDestinationModal, {
    props: { visible: true, ...props },
    global: { plugins: [i18n] },
  })
  await nextTick()
  return wrapper
}

const q = (sel) => document.body.querySelector(sel)

// ⚠️ 有界面的测试会临时切全局 locale（验证 locale 生效）。`i18n` 是**模块级单例**，
// 同一 worker 内的后续测试文件共享它 —— 若本文件把 locale 留在 'en'，会污染
// 依赖默认中文的既有测试（实测同分片内 S2vConfigPanels 因此偶发拿到未解析的
// `create.story2video.*` key 而判红）。故快照原值并在 afterEach 原样恢复。
let localeSnapshot = null
beforeEach(() => {
  localeSnapshot = i18n.global.locale.value
  configProfileListMock.mockReset()
  configProfileListMock.mockResolvedValue({ code: 0, data: [] })
})

afterEach(() => {
  if (localeSnapshot !== null) i18n.global.locale.value = localeSnapshot
  wrapper?.unmount()
  wrapper = null
  // teleport 到 body 的节点由组件卸载时移除；这里只兜底清掉残留的 overlay。
  // 不用 innerHTML = '' —— 那会被安全扫描判成 XSS 写入点（本项目 verify-security 会红）。
  for (const node of document.body.querySelectorAll('.publish-dest-overlay')) {
    node.remove()
  }
})

describe('PublishDestinationModal 披露与选择契约', () => {
  it('「已存草稿」披露节点存在且可被屏幕阅读器播报', async () => {
    await mountModal()
    const notice = q('[data-testid="publish-dest-draft-saved"]')
    expect(notice, '披露节点缺失，用户不会知道草稿已被保存').toBeTruthy()
    expect(notice.getAttribute('role')).toBe('status')
    // 默认走 locale（不得再是硬编码中文常量）
    expect(notice.textContent).toContain('草稿')
  })

  it('披露文案可取用时区域设置（英文界面显示英文，而不是中文硬编码）', async () => {
    await mountModal()
    i18n.global.locale.value = 'en'
    await nextTick()
    const text = q('[data-testid="publish-dest-draft-saved"]').textContent
    expect(text.toLowerCase()).toContain('draft')
    i18n.global.locale.value = 'zh'
    await nextTick()
  })

  it('显式传入 subtitle 时覆盖 locale（调用方可定制）', async () => {
    await mountModal({ subtitle: '自定义披露文案' })
    expect(q('[data-testid="publish-dest-draft-saved"]').textContent.trim()).toBe('自定义披露文案')
  })

  it('流水线空选项不可选中（禁止静默回落默认流水线）', async () => {
    await mountModal()
    const select = q('[data-testid="publish-dest-pipeline-select"]')
    expect(select).toBeTruthy()
    const emptyOption = Array.from(select.querySelectorAll('option')).find(o => o.value === '')
    expect(emptyOption, '未找到空占位选项').toBeTruthy()
    expect(emptyOption.hasAttribute('disabled')).toBe(true)
  })

  it('未改选流水线时提交的是显式默认值，不是空串', async () => {
    await mountModal()
    q('[data-testid="publish-dest-video"]').click()
    await nextTick()
    const emitted = wrapper.emitted('publish-video')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toBe('story2video-compose')
  })

  it('两个去向按钮都可达（图文 / 视频）', async () => {
    await mountModal()
    expect(q('[data-testid="publish-dest-article"]')).toBeTruthy()
    expect(q('[data-testid="publish-dest-video"]')).toBeTruthy()
  })

  it('关闭按钮有可用 aria-label（不再是硬编码 title="关闭"）', async () => {
    await mountModal()
    const closeBtn = q('[data-testid="publish-dest-close"]')
    expect(closeBtn.getAttribute('aria-label')).toBeTruthy()
    expect(closeBtn.getAttribute('title')).toBeTruthy()
  })

  // ── 配置选择（publish-config-picker，2026-10-21）─────────────────────
  it('流水线默认列出全部文案型流水线（不再只有故事讲述）', async () => {
    await mountModal()
    const select = q('[data-testid="publish-dest-pipeline-select"]')
    const values = Array.from(select.querySelectorAll('option')).map(o => o.value).filter(Boolean)
    expect(values).toContain('story2video-compose')
    expect(values).toContain('talking-head')
    expect(values).toContain('animated-explainer')
    expect(values).toContain('avatar-spokesperson')
    // 素材型/录屏型/内部冒烟流水线接不了改写文案，不该出现在下拉里
    expect(values).not.toContain('clip-factory')
    expect(values).not.toContain('framework-smoke')
    expect(values).not.toContain('video-clone')
  })

  it('该流水线没有配置时：显示「默认」、下拉内容为空、并说明原因', async () => {
    configProfileListMock.mockResolvedValue({ code: 0, data: [] })
    await mountModal()
    await vi.waitFor(() => expect(configProfileListMock).toHaveBeenCalled())
    const trigger = q('[data-testid="publish-dest-config-trigger"]')
    expect(trigger, '配置选择器缺失').toBeTruthy()
    expect(q('[data-testid="publish-dest-config-value"]').textContent.trim()).toBe('默认')
    expect(trigger.hasAttribute('disabled'), '无配置时不应可展开').toBe(true)
    expect(q('[data-testid="publish-dest-config-menu"]'), '无配置时不应有下拉内容').toBeNull()
    expect(q('[data-testid="publish-dest-config-hint"]').textContent).toContain('还没有保存过配置')
  })

  it('配置列表只含本流水线的档案，展开后可逐条选择', async () => {
    configProfileListMock.mockResolvedValue({
      code: 0,
      data: [
        profile({ id: 'profile-000000000001', name: '口播竖屏' }),
        profile({ id: 'profile-000000000002', name: '横屏 1080p', updatedAt: 1700000001000 }),
        profile({ id: 'profile-000000000003', name: '别的流水线的配置', pipelineId: 'video-clone' }),
      ],
    })
    await mountModal()
    await vi.waitFor(() => expect(configProfileListMock).toHaveBeenCalled())
    const trigger = q('[data-testid="publish-dest-config-trigger"]')
    expect(trigger.hasAttribute('disabled')).toBe(false)
    trigger.click()
    await nextTick()
    const menu = q('[data-testid="publish-dest-config-menu"]')
    expect(menu).toBeTruthy()
    expect(menu.textContent).toContain('口播竖屏')
    expect(menu.textContent).toContain('横屏 1080p')
    expect(menu.textContent, '别的流水线的配置不得混进来').not.toContain('别的流水线的配置')
    // 菜单首项恒为「默认」：选完还能退回「不套用配置」
    expect(q('[data-testid="publish-dest-config-option-default"]').textContent.trim()).toBe('默认')
  })

  it('切换流水线后配置列表联动，且原先选中的配置作废', async () => {
    configProfileListMock.mockResolvedValue({
      code: 0,
      data: [
        profile({ id: 'profile-000000000001', name: '口播竖屏' }),
        profile({ id: 'profile-000000000002', name: '讲解视频配置', pipelineId: 'animated-explainer' }),
      ],
    })
    await mountModal()
    await vi.waitFor(() => expect(configProfileListMock).toHaveBeenCalled())
    q('[data-testid="publish-dest-config-trigger"]').click()
    await nextTick()
    q('[data-testid="publish-dest-config-option-profile-000000000001"]').click()
    await nextTick()
    expect(q('[data-testid="publish-dest-config-value"]').textContent.trim()).toBe('口播竖屏')

    const select = q('[data-testid="publish-dest-pipeline-select"]')
    select.value = 'animated-explainer'
    select.dispatchEvent(new Event('change'))
    await nextTick()
    expect(q('[data-testid="publish-dest-config-value"]').textContent.trim(), '切流水线后旧配置必须作废').toBe('默认')
  })

  it('选了配置后，提交时把配置档案一起带出去', async () => {
    configProfileListMock.mockResolvedValue({
      code: 0,
      data: [profile({ id: 'profile-000000000001', name: '口播竖屏' })],
    })
    await mountModal()
    await vi.waitFor(() => expect(configProfileListMock).toHaveBeenCalled())
    q('[data-testid="publish-dest-config-trigger"]').click()
    await nextTick()
    q('[data-testid="publish-dest-config-option-profile-000000000001"]').click()
    await nextTick()
    q('[data-testid="publish-dest-video"]').click()
    await nextTick()
    const emitted = wrapper.emitted('publish-video')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toBe('story2video-compose')
    expect(emitted[0][1]).toEqual({
      configProfileId: 'profile-000000000001',
      configProfileName: '口播竖屏',
    })
  })

  it('没选配置时提交不带配置档案（调用方据此不传 configProfile 参数）', async () => {
    configProfileListMock.mockResolvedValue({ code: 0, data: [] })
    await mountModal()
    await vi.waitFor(() => expect(configProfileListMock).toHaveBeenCalled())
    q('[data-testid="publish-dest-video"]').click()
    await nextTick()
    const emitted = wrapper.emitted('publish-video')
    expect(emitted[0][1]).toEqual({ configProfileId: '', configProfileName: '' })
  })

  it('配置列表加载失败时如实提示，不静默装作「没有配置」', async () => {
    configProfileListMock.mockResolvedValue({ code: -1, message: 'boom' })
    await mountModal()
    await vi.waitFor(() => expect(configProfileListMock).toHaveBeenCalled())
    await nextTick()
    expect(q('[data-testid="publish-dest-config-hint"]').textContent).toContain('加载失败')
    expect(q('[data-testid="publish-dest-config-value"]').textContent.trim()).toBe('默认')
  })

  // ── 键盘可达（QM-6 评审 i2 采纳：role=combobox/listbox 必须配得上键盘操作）──
  it('触发器上按 ↓ 展开下拉并把焦点落到「默认」项', async () => {
    configProfileListMock.mockResolvedValue({
      code: 0,
      data: [profile({ id: 'profile-000000000001', name: '口播竖屏' })],
    })
    await mountModal()
    await vi.waitFor(() => expect(configProfileListMock).toHaveBeenCalled())
    const trigger = q('[data-testid="publish-dest-config-trigger"]')
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    expect(q('[data-testid="publish-dest-config-menu"]')).toBeTruthy()
    expect(document.activeElement).toBe(q('[data-testid="publish-dest-config-option-default"]'))
  })

  it('菜单内 ↑/↓ 移动焦点、End 跳末项、Esc 关闭并把焦点还给触发器', async () => {
    configProfileListMock.mockResolvedValue({
      code: 0,
      data: [
        profile({ id: 'profile-000000000001', name: '口播竖屏' }),
        profile({ id: 'profile-000000000002', name: '横屏 1080p' }),
      ],
    })
    await mountModal()
    await vi.waitFor(() => expect(configProfileListMock).toHaveBeenCalled())
    const trigger = q('[data-testid="publish-dest-config-trigger"]')
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    const menu = q('[data-testid="publish-dest-config-menu"]')
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    expect(document.activeElement).toBe(q('[data-testid="publish-dest-config-option-profile-000000000001"]'))
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await nextTick()
    expect(document.activeElement).toBe(q('[data-testid="publish-dest-config-option-profile-000000000002"]'))
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(q('[data-testid="publish-dest-config-menu"]'), 'Esc 应关闭下拉').toBeNull()
    expect(document.activeElement, 'Esc 后焦点应回到触发器').toBe(trigger)
  })
})
