'use strict'

/**
 * toutiao-cover 的行为锁（2026-10-22）
 *
 * 真机证据：西瓜上传页**没有 image file input**（3 个 file input 的 accept 全是视频格式），
 * 封面是弹窗 `m-poster-upgrade`：「封面截取 | 本地上传」→ 解析中 → 「下一步」。
 * 所以正确路径是「点触发器 → 等弹窗 → 等下一步可用 → 点下一步 → 等弹窗关闭」。
 */

// describe/test/expect 由 runner 以 --globals 注入

describe('toutiao-cover', () => {
  function makeWin (opts) {
    let dialogChecks = 0
    return {
      webContents: {
        executeJavaScript: async (code) => {
          const c = String(code)
          if (c.indexOf('上传封面') >= 0) return !!opts.triggerOk
          if (c.indexOf('下一步') >= 0) return !!opts.nextOk
          if (c.indexOf('poster-upgrade') >= 0) {
            dialogChecks++
            // 第 1 次询问：是否出现（true）；最后阶段的"是否仍打开"：opts.stillOpen
            return dialogChecks <= 1 ? !!opts.dialogOk : !!opts.stillOpen
          }
          return false
        },
      },
    }
  }
  const ctx = { _sleep: async () => {} }

  test('正常路径：点开弹窗 → 下一步可用 → 弹窗关闭 ⇒ ok', async () => {
    const r = await expectFetch({ triggerOk: true, dialogOk: true, nextOk: true, stillOpen: false })
    expect(r.ok).toBe(true)
    expect(r.step).toBe('done')
  })

  test('找不到触发器 ⇒ clicked-trigger', async () => {
    const r = await expectFetch({ triggerOk: false })
    expect(r.ok).toBe(false)
    expect(r.step).toBe('clicked-trigger')
  })

  test('弹窗没出现 ⇒ no-dialog', async () => {
    const r = await expectFetch({ triggerOk: true, dialogOk: false })
    expect(r.ok).toBe(false)
    expect(r.step).toBe('no-dialog')
  })

  test('「下一步」一直不可用（解析超时）⇒ no-next', async () => {
    const r = await expectFetch({ triggerOk: true, dialogOk: true, nextOk: false })
    expect(r.ok).toBe(false)
    expect(r.step).toBe('no-next')
  })

  async function expectFetch (opts) {
    const { ensureCoverFromVideoFrame } = require('../electron/services/toutiao-cover.js')
    return ensureCoverFromVideoFrame(ctx, makeWin(opts), {})
  }
})
