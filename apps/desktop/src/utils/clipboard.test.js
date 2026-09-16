import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeClipboard } from '@/utils/clipboard'

/**
 * 剪贴板工具测试（BUGFIX-REWRITE-QUALITY-UX）
 *
 * 覆盖两条写入路径与全部失败分支：
 * - 异步 Clipboard API 优先
 * - execCommand 回退（旧内核 / 非安全上下文）
 * - 两者都失败时返回 false 且**不抛异常**（调用方据返回值决定提示文案）
 */
describe('utils/clipboard writeClipboard', () => {
  let originalClipboard
  let originalExecCommand

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    originalExecCommand = document.execCommand
  })

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    } else {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, writable: true, configurable: true })
    }
    if (originalExecCommand) {
      document.execCommand = originalExecCommand
    } else {
      delete document.execCommand
    }
  })

  function setClipboard(value) {
    Object.defineProperty(navigator, 'clipboard', { value, writable: true, configurable: true })
  }

  it('空文本直接返回 false，且不触碰剪贴板', async () => {
    const writeText = vi.fn(async () => undefined)
    setClipboard({ writeText })
    expect(await writeClipboard('')).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('非字符串入参按字符串处理（数字 0 视为有效内容）', async () => {
    const writeText = vi.fn(async () => undefined)
    setClipboard({ writeText })
    expect(await writeClipboard(0)).toBe(true)
    expect(writeText).toHaveBeenCalledWith('0')
  })

  it('Clipboard API 可用时走 API 并返回 true', async () => {
    const writeText = vi.fn(async () => undefined)
    setClipboard({ writeText })
    expect(await writeClipboard('改写结果全文')).toBe(true)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('改写结果全文')
  })

  it('Clipboard API 不存在时回退 execCommand', async () => {
    setClipboard(undefined)
    const execCommand = vi.fn(() => true)
    document.execCommand = execCommand
    expect(await writeClipboard('回退内容')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('Clipboard API 抛异常时回退 execCommand 成功', async () => {
    const writeText = vi.fn(async () => { throw new Error('NotAllowedError') })
    setClipboard({ writeText })
    const execCommand = vi.fn(() => true)
    document.execCommand = execCommand
    expect(await writeClipboard('回退内容')).toBe(true)
    expect(writeText).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('两条路径都失败时返回 false 且不抛异常', async () => {
    const writeText = vi.fn(async () => { throw new Error('NotAllowedError') })
    setClipboard({ writeText })
    document.execCommand = vi.fn(() => false)
    await expect(writeClipboard('内容')).resolves.toBe(false)
  })

  it('execCommand 抛异常时返回 false（不冒泡到调用方）', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn(() => { throw new Error('not supported') })
    await expect(writeClipboard('内容')).resolves.toBe(false)
  })

  it('回退路径的临时 textarea 会被清理，不残留 DOM 节点', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn(() => true)
    const before = document.body.children.length
    await writeClipboard('内容')
    expect(document.body.children.length).toBe(before)
  })

  it('回退失败时临时 textarea 同样被清理', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn(() => false)
    const before = document.body.children.length
    await writeClipboard('内容')
    expect(document.body.children.length).toBe(before)
  })
})
