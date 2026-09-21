/**
 * PerformanceInsights（效果洞察）页 UI/UE 精致化测试（2026-09-21）
 *
 * 覆盖契约：
 * - 四个维度以独立卡片呈现（头部：维度名 + 样本量 + 最优模式 + 更新时间）
 * - 空数据：维度卡片内呈现引导性空态（非 el-table 默认 "No Data"）
 * - 有数据：最优模式取该维度互动得分最高项的模式标签；低样本呈现警告徽标
 * - 平台筛选：change 后以 { platform } 参数重新拉取
 * - 重算归因：进行中禁用按钮防重复触发，成功后自动刷新列表
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const listMock = vi.hoisted(() => vi.fn())
const recomputeMock = vi.hoisted(() => vi.fn())
const messageMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/knowledge-library', () => ({
  listPatternPerformance: (...args) => listMock(...args),
  recomputeAttribution: (...args) => recomputeMock(...args),
}))

vi.mock('element-plus', () => ({
  ElMessage: Object.assign(messageMock, { success: messageMock, error: messageMock }),
}))

import PerformanceInsights from './PerformanceInsights.vue'

const DIM_KEYS = ['hook_type', 'emotion_curve', 'narrative_structure', 'cta_style']

function row(overrides = {}) {
  return {
    dimension: 'hook_type',
    value: 'suspense',
    platform: '',
    sample_count: 5,
    avg_views: 1200,
    avg_likes: 80,
    avg_comments: 12,
    avg_favorites: 20,
    engagement_score: 152,
    computed_at: '2026-09-20T10:00:00.000Z',
    ...overrides,
  }
}

function mountView() {
  i18n.global.locale.value = 'zh'
  return mount(PerformanceInsights, {
    global: {
      plugins: [i18n],
      stubs: {
        ElButton: {
          props: ['disabled', 'loading', 'type', 'size'],
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        ElSelect: {
          props: ['modelValue'],
          emits: ['update:modelValue', 'change'],
          template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>',
        },
        ElOption: {
          props: ['label', 'value'],
          template: '<option :value="value">{{ label }}</option>',
        },
        ElTooltip: { template: '<span><slot /><slot name="content" /></span>' },
        ElProgress: { props: ['percentage'], template: '<div class="progress-stub" :data-p="percentage" />' },
        ElTable: { template: '<div class="el-table-stub"><slot /></div>' },
        ElTableColumn: { template: '<div class="el-table-column-stub" />' },
      },
      config: {
        directives: {
          loading: { mounted () {}, updated () {}, unmounted () {} },
        },
      },
    },
  })
}

beforeEach(() => {
  listMock.mockReset()
  recomputeMock.mockReset()
  messageMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PerformanceInsights 效果洞察页', () => {
  it('挂载后以空参数拉取数据，渲染四张维度卡片', async () => {
    listMock.mockResolvedValue({ code: 0, data: { items: [] } })
    const w = mountView()
    await flushPromises()

    expect(listMock).toHaveBeenCalledTimes(1)
    const cards = DIM_KEYS.map((k) => w.get(`[data-testid="pi-dim-${k}"]`))
    expect(cards).toHaveLength(4)
    expect(w.text()).toContain('开头钩子')
    expect(w.text()).toContain('情绪曲线')
    expect(w.text()).toContain('叙事结构')
    expect(w.text()).toContain('CTA 方式')
  })

  it('全部无数据：页面级空态提示 + 各维度卡片内空态（不出现 No Data 表格）', async () => {
    listMock.mockResolvedValue({ code: 0, data: { items: [] } })
    const w = mountView()
    await flushPromises()

    expect(w.find('[data-testid="pi-empty-state"]').exists()).toBe(true)
    expect(w.text()).toContain('暂无归因数据')
    expect(w.findAll('[data-testid="pi-dim-empty"]')).toHaveLength(4)
    expect(w.text()).not.toContain('No Data')
  })

  it('有数据：维度头部呈现样本量、最优模式（得分最高项）与更新时间', async () => {
    listMock.mockResolvedValue({
      code: 0,
      data: {
        items: [
          row({ value: 'suspense', engagement_score: 152 }),
          row({ value: 'question', engagement_score: 260, sample_count: 2 }),
        ],
      },
    })
    const w = mountView()
    await flushPromises()

    const hookCard = w.get('[data-testid="pi-dim-hook_type"]')
    expect(hookCard.get('[data-testid="pi-best-pattern"]').text()).toContain('提问式')
    expect(hookCard.get('[data-testid="pi-dim-samples"]').text()).toContain('7')
    expect(hookCard.get('[data-testid="pi-dim-updated"]').text()).toBeTruthy()
    // 低样本徽标（question 样本 2 < 3）
    expect(hookCard.findAll('[data-testid="pi-low-sample-badge"]').length).toBe(1)
  })

  it('平台筛选：切换后以 platform 参数重新拉取', async () => {
    listMock.mockResolvedValue({
      code: 0,
      data: { items: [row({ platform: 'xiaohongshu' })] },
    })
    const w = mountView()
    await flushPromises()
    expect(listMock).toHaveBeenLastCalledWith({})

    const select = w.findComponent('[data-testid="pi-platform-filter"]')
    select.vm.$emit('update:modelValue', 'xiaohongshu')
    await flushPromises()

    expect(listMock).toHaveBeenLastCalledWith({ platform: 'xiaohongshu' })
  })

  it('重算归因：成功提示 + 自动刷新；进行中按钮禁用防重复触发', async () => {
    listMock.mockResolvedValue({ code: 0, data: { items: [] } })
    let resolveRecompute
    recomputeMock.mockReturnValue(new Promise((r) => { resolveRecompute = r }))

    const w = mountView()
    await flushPromises()
    listMock.mockClear()

    const button = w.get('[data-testid="pi-recompute-btn"]')
    await button.trigger('click')
    // 进行中：禁用 + 再次点击不重复触发
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')
    expect(recomputeMock).toHaveBeenCalledTimes(1)

    resolveRecompute({ code: 0, data: {} })
    await flushPromises()
    await nextTick()

    expect(messageMock).toHaveBeenCalled()
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(w.get('[data-testid="pi-recompute-btn"]').attributes('disabled')).toBeUndefined()
  })

  it('重算归因失败：错误提示且按钮恢复可用', async () => {
    listMock.mockResolvedValue({ code: 0, data: { items: [] } })
    recomputeMock.mockResolvedValue({ code: -1, message: 'busy' })

    const w = mountView()
    await flushPromises()

    await w.get('[data-testid="pi-recompute-btn"]').trigger('click')
    await flushPromises()

    expect(messageMock).toHaveBeenCalled()
    expect(w.get('[data-testid="pi-recompute-btn"]').attributes('disabled')).toBeUndefined()
  })

  it('接口异常：降级为空数据不崩溃', async () => {
    listMock.mockRejectedValue(new Error('ipc down'))
    const w = mountView()
    await flushPromises()

    expect(w.find('[data-testid="pi-empty-state"]').exists()).toBe(true)
    expect(w.get('[data-testid="performance-insights"]').exists()).toBe(true)
  })
})
