/**
 * settings-dialog 信号回归锁
 *
 * 两个信号各锁一条**容易写错且后果具体**的性质：
 *  ① 关闭版本号：只增不减（消费方靠它判断「弹窗关了，该刷新了」）；
 *  ② 打开请求：**同一个 Tab 连点两次也必须能再次触发**。裸字符串赋同值不会触发
 *     watch——用户第二次点「前往设置」就会没反应，这是本条最真实的失败形态。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  settingsDialogRevision,
  notifySettingsDialogClosed,
  settingsDialogRequest,
  requestSettingsDialog,
} from './settings-dialog'

beforeEach(() => {
  settingsDialogRevision.value = 0
  settingsDialogRequest.value = null
})

describe('settingsDialogRevision', () => {
  it('每次通知关闭 +1', () => {
    expect(settingsDialogRevision.value).toBe(0)
    notifySettingsDialogClosed()
    notifySettingsDialogClosed()
    expect(settingsDialogRevision.value).toBe(2)
  })
})

describe('settingsDialogRequest', () => {
  it('默认请求 model 且 seq 从 1 开始', () => {
    requestSettingsDialog()
    expect(settingsDialogRequest.value).toEqual({ tab: 'model', seq: 1 })
  })

  it('携带目标 Tab', () => {
    requestSettingsDialog('zhihu')
    expect(settingsDialogRequest.value.tab).toBe('zhihu')
  })

  it('同一 Tab 连续请求两次 → 对象身份与 seq 都变化（否则 watch 不触发）', () => {
    requestSettingsDialog('zhihu')
    const first = settingsDialogRequest.value
    requestSettingsDialog('zhihu')
    const second = settingsDialogRequest.value
    expect(second).not.toBe(first)
    expect(second.seq).toBe(first.seq + 1)
    expect(second.tab).toBe('zhihu')
  })
})
