// @vitest-environment jsdom
/**
 * ShotNode 单测：失败态就地重试按钮（5.2 画布入口的合同）——
 * 仅 status==='failed' 且有 shotId 时渲染重试按钮，点击 emit('retry', shotId)；
 * 其余状态（idle/generating/done）不渲染，不得出现第二个可点的重试入口。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k }) }))
vi.mock('@vue-flow/core', () => {
  const { h, defineComponent } = require('vue')
  return {
    Handle: defineComponent({ name: 'Handle', setup: () => () => h('span') }),
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  }
})

import ShotNode from './ShotNode.vue'

const nodeData = (status, shotId = 'adapt-001') => ({
  status,
  sceneId: 's1',
  shot: shotId ? { shotId, prompt: 'p' } : undefined,
})

const mountNode = (data) => mount(ShotNode, { props: { id: 'shot:' + (data.shot && data.shot.shotId), data } })

describe('ShotNode 失败重试入口', () => {
  it('failed 态渲染重试按钮，点击 emit retry + shotId', async () => {
    const w = mountNode(nodeData('failed'))
    const btn = w.find('[data-testid="shot-retry"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(w.emitted('retry')).toEqual([['adapt-001']])
  })

  it('非失败态（idle/generating/done）不渲染重试按钮', () => {
    for (const st of ['idle', 'generating', 'done']) {
      const w = mountNode(nodeData(st))
      expect(w.find('[data-testid="shot-retry"]').exists()).toBe(false)
    }
  })

  it('failed 但无 shotId（脏数据）：不渲染按钮，避免 emit undefined', () => {
    const w = mountNode(nodeData('failed', null))
    expect(w.find('[data-testid="shot-retry"]').exists()).toBe(false)
  })

  it('重试按钮不得连带触发 remove 事件（click.stop）', async () => {
    const w = mountNode(nodeData('failed'))
    await w.find('[data-testid="shot-retry"]').trigger('click')
    expect(w.emitted('remove')).toBeFalsy()
  })
})
