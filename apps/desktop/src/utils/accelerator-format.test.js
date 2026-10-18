import { describe, it, expect } from 'vitest'
import { formatAccelerator } from './accelerator-format'

describe('formatAccelerator（阶段 1.6：把 Electron 令牌翻译成人话）', () => {
  it.each([
    ['CmdOrCtrl+Alt+P', 'win32', 'Ctrl+Alt+P'],
    ['CmdOrCtrl+Alt+P', 'darwin', '⌘⌥P'],
    ['CmdOrCtrl+Comma', 'win32', 'Ctrl+,'],
    ['CmdOrCtrl+Comma', 'darwin', '⌘,'],
    ['Shift+CmdOrCtrl+K', 'win32', 'Shift+Ctrl+K'],
  ])('%s 在 %s 上渲染成 %s', (accel, platform, expected) => {
    expect(formatAccelerator(accel, platform)).toBe(expected)
  })

  it('单字符键统一大写，未识别的长令牌原样透出（不假装翻译过）', () => {
    expect(formatAccelerator('CmdOrCtrl+Alt+p', 'win32')).toBe('Ctrl+Alt+P')
    // 判据是「原样透出」而不是「大小写不敏感地猜」：'alt' 不在令牌表里就必须看得见它没被翻译
    expect(formatAccelerator('CmdOrCtrl+alt+p', 'win32')).toBe('Ctrl+alt+P')
    expect(formatAccelerator('CmdOrCtrl+Hyper+C', 'win32')).toBe('Ctrl+Hyper+C')
  })

  it.each([
    ['空串', ''],
    ['空白串', '   '],
    ['非字符串', undefined],
    ['数字', 42],
  ])('%s 输入返回空串而不是抛错', (_label, input) => {
    expect(formatAccelerator(input, 'win32')).toBe('')
  })
})
