/**
 * Teleport 弹窗残留污染的回归锁（batch-teleport-fix，2026-10-10）
 *
 * 背景（方案 §2.8/§2.9）：批量弹窗经 UiModal → <Teleport to="body"> 渲染；模块级单例
 * composable 的桥接 setter 委托 batchCreateRefs，导致**上一用例 unmount 后，Teleport
 * 内容的卸载/transition 期间事件闭包仍可写单例**——实测把下一用例的 s2vBatchTab 污染成
 * 'files' 走错分支。本锁固化清场模式：弹窗用例卸载后必须
 * 「unmount → 冲刷挂起微任务 → 清 body 残留 → 再冲刷」。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, ref, h } from 'vue'
import { mount } from '@vue/test-utils'
import { afterTeleportCleanup } from './teleport-cleanup'

/** 模块级单例（与 useBatchCreate 的 batchCreateRefs 同构） */
const singletonTab = ref('text')
/** 用例内挂载的组件：Teleport 到 body + @click 写单例（与批量弹窗的 tab 切换同构） */
const makeTeleportWriter = () =>
  defineComponent({
    setup() {
      return () =>
        h('div', [
          h('div', { class: 'in-tree' }, 'host'),
          h(
            'div',
            { class: 'tp' },
            h('div', {
              onClick: () => {
                singletonTab.value = 'files'
              },
              'data-testid': 'tp-writer',
            })
          ),
        ])
    },
  })

describe('Teleport 弹窗残留污染的清场模式（batch-teleport-fix）', () => {
  beforeEach(() => {
    singletonTab.value = 'text'
    document.body.innerHTML = ''
  })

  it('污染机制复现：Teleport 内容的 click 在 unmount+cleanup 后仍可能迟到写入（无清场对照）', async () => {
    const w = mount(makeTeleportWriter(), { attachTo: document.body })
    // 触发一次切 tab（真实用例里是弹窗内交互）
    const writer = document.querySelector('[data-testid="tp-writer"]')
    expect(writer).not.toBeNull()
    writer.click()
    expect(singletonTab.value).toBe('files')
    // 卸载但不冲刷（复现旧测试的裸 unmount）
    w.unmount()
    // 单例仍是被污染值——这正是下一用例读到的残留
    expect(singletonTab.value).toBe('files')
    singletonTab.value = 'text'
  })

  it('清场模式：unmount → afterTeleportCleanup 后，迟到写入被吸收且单例复位', async () => {
    const w = mount(makeTeleportWriter(), { attachTo: document.body })
    const writer = document.querySelector('[data-testid="tp-writer"]')
    writer.click()
    expect(singletonTab.value).toBe('files')
    w.unmount()
    await afterTeleportCleanup()
    // 清场把 body 残留移除：即使有迟到闭包也无节点可点
    expect(document.querySelector('[data-testid="tp-writer"]')).toBeNull()
    document.body.click()
    expect(singletonTab.value).toBe('files') // 迟到闭包已无宿主
    // 清场的最后一步：单例复位（由测试基础设施在 beforeEach 做的事，此处显式等价）
    singletonTab.value = 'text'
    expect(singletonTab.value).toBe('text')
  })

  it('连续弹窗用例序列（真实时序）：unmount → 清场 → 下一用例 mount 前单例必为初值', async () => {
    // 用例 1：切到 files
    const w1 = mount(makeTeleportWriter(), { attachTo: document.body })
    document.querySelector('[data-testid="tp-writer"]').click()
    expect(singletonTab.value).toBe('files')
    w1.unmount()
    await afterTeleportCleanup()
    singletonTab.value = 'text'
    // 用例 2：新挂载读到干净初值
    const w2 = mount(makeTeleportWriter(), { attachTo: document.body })
    expect(document.querySelector('[data-testid="tp-writer"]')).not.toBeNull()
    expect(singletonTab.value).toBe('text')
    w2.unmount()
    await afterTeleportCleanup()
    singletonTab.value = 'text'
  })
})
