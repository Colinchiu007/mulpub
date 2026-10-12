/**
 * ColProgressBlock — 统一进度块契约
 *
 * 背景：采集页曾有两套进度展示（RSS/URL 批量的 batchTaskId 进度条 vs 知乎「采集并改写」
 * 进度卡），DOM 不同构、视觉不统一（Q10-a 定案收敛）。本组件是两者的唯一渲染体。
 * 三条不可省：① 结构同构（标题→轨道→文本→summary→明细→取消）；② 取消仅在 cancelable 时渲染
 * 且点击 emit('cancel')；③ 明细仅 detailLines 非空时渲染，展开态可切换。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ColProgressBlock from './ColProgressBlock.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      collection: {
        cancelBatch: '取消',
        zhihuFavlist: { expandDetail: '展开明细', collapseDetail: '收起明细' },
      },
    },
  },
})

function mountCpb (props) {
  return mount(ColProgressBlock, { global: { plugins: [i18n] }, props })
}

describe('ColProgressBlock 结构契约', () => {
  it('渲染标题/文本/summary，进度宽度跟随 percent', () => {
    const w = mountCpb({ title: '批量采集进度', percent: 42, text: '已完成 5 / 12', summary: '成功 4 · 失败 1', testid: 'batch-progress'  })
    expect(w.find('[data-testid="batch-progress"]').exists()).toBe(true)
    expect(w.text()).toContain('批量采集进度')
    expect(w.text()).toContain('已完成 5 / 12')
    expect(w.text()).toContain('成功 4 · 失败 1')
    expect(w.find('.col-progress-fill').attributes('style')).toContain('42%')
  })

  it('取消按钮仅在 cancelable 时渲染且 emit cancel', async () => {
    const off = mountCpb({ title: 't', percent: 0, text: '', cancelable: false  })
    expect(off.find('button').exists()).toBe(false)

    const on = mountCpb({ title: 't', percent: 10, text: 'x', cancelable: true, testid: 'p'  })
    const btn = on.find('button')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(on.emitted('cancel')).toHaveLength(1)
  })

  it('明细仅在有 detailLines 时渲染且可展开收起', async () => {
    const bare = mountCpb({ title: 't', percent: 0, text: ''  })
    expect(bare.text()).not.toContain('展开')

    const w = mountCpb({ title: 't', percent: 50, text: '', detailLines: ['第 1 条：成功', '第 2 条：失败'], testid: 'zhihu-fav-batch-progress'  })
    expect(w.text()).toContain('2')
    await w.find('button').trigger('click')
    expect(w.text()).toContain('第 1 条：成功')
    expect(w.text()).toContain('第 2 条：失败')
  })
})
