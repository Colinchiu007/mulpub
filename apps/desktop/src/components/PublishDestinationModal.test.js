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
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import PublishDestinationModal from './PublishDestinationModal.vue'

let wrapper

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
})
