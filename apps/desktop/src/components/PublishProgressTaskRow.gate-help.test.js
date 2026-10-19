/**
 * PublishProgressTaskRow.gate-help.test.js — 失败行的「解法入口」链接（2026-10-19）
 *
 * ## 这条测的是什么
 *
 * 有些发布失败是**账号状态**问题、技术上绕不过去（真机取证：头条「账号信息未完善」，
 * 点「发布」即被平台模态框拦住）。这时对用户唯一有用的是「去哪里改」，不是错误码。
 *
 * 所以失败行在**有对应解法入口时**必须渲染一个可点击链接：
 *   - 链接地址来自 `packages/shared-utils/src/publish-gate-help(.browser).js` 单一真源
 *   - href 必须过 `safeHttpUrl`（渲染层不信任任何 URL 字符串）
 *   - **没有对应入口时绝不渲染**（不给点不动的链接）
 *
 * ## 为什么单独测 TaskRow 而不只测面板
 *
 * 面板测试看的是文本包含关系，看不出「有没有生成一个真链接」。这条要断言的正是
 * 「`<a>` 存在 + href 精确等于官方入口 + 有安全属性」，只有直接 mount 行组件才测得到。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import PublishProgressTaskRow from './PublishProgressTaskRow.vue'

const FIX_URL = 'https://mp.toutiao.com/profile_v4/personal/landing-type'

function makeTask (overrides = {}) {
  return {
    taskId: 't1',
    platform: 'toutiao',
    phase: 'failed',
    stageKey: 'detail',
    stage: '',
    percent: null,
    result: null,
    error: '该头条号账号信息未完善，暂时无法发布视频',
    code: null,
    remainingWait: null,
    daily: null,
    retriesLeft: null,
    clockAnomaly: false,
    startedAt: Date.now() - 1000,
    endedAt: Date.now(),
    ...overrides,
  }
}

function mountRow (task) {
  return mount(PublishProgressTaskRow, {
    props: { task },
    global: { plugins: [i18n] },
  })
}

describe('PublishProgressTaskRow：失败行的解法入口链接', () => {
  it('ACCOUNT_NOT_VERIFIED 时渲染可点链接，href 是平台官方入口', () => {
    const w = mountRow(makeTask({ code: 'ACCOUNT_NOT_VERIFIED' }))
    const a = w.find('[data-testid="publish-progress-task-gate-help"]')
    expect(a.exists()).toBe(true)
    expect(a.attributes('href')).toBe(FIX_URL)
    // 外链必须带安全属性（反引荐来源 + 断开 opener）
    expect(a.attributes('target')).toBe('_blank')
    expect(a.attributes('rel')).toContain('noopener')
    expect(a.attributes('rel')).toContain('noreferrer')
  })

  it('NO_PUBLISH_PERMISSION 同样给出入口（同一问题的另一条触发路径）', () => {
    const w = mountRow(makeTask({ code: 'NO_PUBLISH_PERMISSION' }))
    const a = w.find('[data-testid="publish-progress-task-gate-help"]')
    expect(a.exists()).toBe(true)
    expect(a.attributes('href')).toBe(FIX_URL)
  })

  it('没有对应入口的失败码**不得**渲染链接（不给点不动的链接）', () => {
    for (const code of [null, undefined, '', 'TRANSIENT_ERROR', 'SOME_OTHER_CODE']) {
      const w = mountRow(makeTask({ code }))
      expect(w.find('[data-testid="publish-progress-task-gate-help"]').exists(), 'code=' + String(code)).toBe(false)
    }
  })

  it('非 failed 相位不渲染链接（成功/进行中行不该出现解法入口）', () => {
    for (const phase of ['success', 'start', 'progress', 'queued']) {
      const w = mountRow(makeTask({ phase, code: 'ACCOUNT_NOT_VERIFIED' }))
      expect(w.find('[data-testid="publish-progress-task-gate-help"]').exists(), 'phase=' + phase).toBe(false)
    }
  })

  it('链接文案走 i18n（不是把 key 直接显示给用户）', () => {
    const w = mountRow(makeTask({ code: 'ACCOUNT_NOT_VERIFIED' }))
    const a = w.find('[data-testid="publish-progress-task-gate-help"]')
    const text = a.text()
    expect(text.length).toBeGreaterThan(0)
    // 关键：不得把 i18n key 原样渲染出来（本仓明令禁止的泄漏形态）
    expect(text).not.toContain('publishPage.')
    expect(text).not.toContain('gateHelp')
  })
})
