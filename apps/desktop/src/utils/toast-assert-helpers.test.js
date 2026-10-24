// toast-assert-helpers 自身的锁：这个助手被 11 个测试文件消费，它错了会让**一片**断言假绿。
// 关键负控是"参数根本不是消息"这一档：匹配器若对 undefined/数字/空对象返回 true，
// 那"出口没弹提示"就会被读成"弹了但对文案"，那是比漏测更坏的形态。
import { describe, it, expect } from 'vitest'
import { messageIs, messageContains, messageOf } from './toast-assert-helpers'

describe('toast-assert-helpers：观察助手对两种调用形态同时成立', () => {
  it('字符串形态与选项形态都按 message 比对', () => {
    expect(messageIs('已保存').asymmetricMatch('已保存')).toBe(true)
    expect(messageIs('已保存').asymmetricMatch({ message: '已保存', duration: 2000 })).toBe(true)
    expect(messageContains('保存').asymmetricMatch('已保存')).toBe(true)
    expect(messageContains('保存').asymmetricMatch({ message: '已保存' })).toBe(true)
  })

  it('文案不对就是不匹配（不得把"有调用"当成"文案对"）', () => {
    expect(messageIs('已保存').asymmetricMatch('已删除')).toBe(false)
    expect(messageIs('已保存').asymmetricMatch({ message: '已删除' })).toBe(false)
    expect(messageContains('保存').asymmetricMatch({ message: '删除成功' })).toBe(false)
  })

  it('负控：参数根本不是消息时一律不匹配（undefined / 数字 / 空对象 / message 非字符串）', () => {
    for (const bad of [undefined, null, 0, 42, {}, { message: 42 }, { text: '已保存' }]) {
      expect(messageIs('已保存').asymmetricMatch(bad)).toBe(false)
      expect(messageContains('保存').asymmetricMatch(bad)).toBe(false)
    }
  })

  it('messageOf 把两种形态收敛成一个字符串，读不到就返回 undefined（不猜）', () => {
    expect(messageOf('纯字符串')).toBe('纯字符串')
    expect(messageOf({ message: '选项形态', duration: 3000 })).toBe('选项形态')
    expect(messageOf(undefined)).toBeUndefined()
    expect(messageOf({})).toBeUndefined()
    expect(messageOf({ message: 42 })).toBeUndefined()
  })

  it('toString 必须写出判据，否则失败信息读起来像"什么都没断言"', () => {
    expect(String(messageIs('已保存'))).toContain('已保存')
    expect(String(messageContains('保存'))).toContain('保存')
  })
})
