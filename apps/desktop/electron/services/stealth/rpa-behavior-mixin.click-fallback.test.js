// @ts-check
/**
 * rpa-behavior-mixin.click-fallback.test.js — 点击回退链契约（wxmp-save-untrusted-click）
 *
 * 现场（2026-10-21 14:29，微信「保存为草稿」）：
 *   `[click] 行为层失败，回落原生合成 click`
 *   `[click] ... -> BUTTON||保存为草稿 probe={"ocLog":[],"appReq":[],"appReqN":0}`
 *   → 按钮找到了，但点击后页面 **一条请求都没发**（xhr=none），30 秒后判「保存未被平台确认」。
 *
 * 结论：微信后台忽略不可信的合成 click。回退链必须补一档「CDP 可信点击」，
 * 且**不能**在可信点击成功后再执行一次合成 click（会重复提交）。
 */
import { describe, it, expect, vi } from 'vitest'

const { behaviorMixin } = require('./rpa-behavior-mixin')

function makeHost (overrides = {}) {
  const host = Object.create(behaviorMixin)
  host._behaviorClick = vi.fn(async () => null)
  host._clickViaCdp = vi.fn(async () => 'TRUSTED_CLICK')
  host._isoEval = vi.fn(async () => 'BUTTON||保存为草稿')
  return Object.assign(host, overrides)
}

const SEL = 'a#js_sync_save'

describe('_clickViaDriver 回退链', () => {
  it('行为层失败 → 走 CDP 可信点击，且不再执行合成 click', async () => {
    const host = makeHost()

    const d = await host._clickViaDriver({}, SEL)

    expect(host._behaviorClick).toHaveBeenCalledWith({}, SEL)
    expect(host._clickViaCdp).toHaveBeenCalledWith({}, SEL)
    expect(d).toBe('BUTTON||保存为草稿')
    // 关键：唯一一次 _isoEval 只能是「读描述串」，不得含 el.click()
    expect(host._isoEval).toHaveBeenCalledTimes(1)
    const code = String(host._isoEval.mock.calls[0][1])
    expect(code).not.toContain('el.click()')
  })

  it('CDP 找不到元素（NOT_FOUND）→ 才回落合成 click', async () => {
    const host = makeHost({ _clickViaCdp: vi.fn(async () => 'NOT_FOUND') })

    const d = await host._clickViaDriver({}, SEL)

    expect(d).toBe('BUTTON||保存为草稿')
    const codes = host._isoEval.mock.calls.map(c => String(c[1]))
    expect(codes.some(c => c.includes('el.click()'))).toBe(true)
  })

  it('CDP 抛错 → 回落合成 click（不因兜底故障中断发布）', async () => {
    const host = makeHost({
      _clickViaCdp: vi.fn(async () => { throw new Error('debugger detached') }),
    })

    const d = await host._clickViaDriver({}, SEL)

    expect(d).toBe('BUTTON||保存为草稿')
    const codes = host._isoEval.mock.calls.map(c => String(c[1]))
    expect(codes.some(c => c.includes('el.click()'))).toBe(true)
  })

  it('行为层成功 ⇒ 不进任何兜底（防重复点击）', async () => {
    const host = makeHost({ _behaviorClick: vi.fn(async () => 'BEHAVIOR@10,20') })

    const d = await host._clickViaDriver({}, SEL)

    expect(d).toBe('BEHAVIOR@10,20')
    expect(host._clickViaCdp).not.toHaveBeenCalled()
    expect(host._isoEval).not.toHaveBeenCalled()
  })

  it('可信点击后读描述串失败 ⇒ 仍返回成功标记（点击已生效，不得因此再点一次）', async () => {
    const host = makeHost({ _isoEval: vi.fn(async () => { throw new Error('context gone') }) })

    const d = await host._clickViaDriver({}, SEL)

    expect(d).toBe('TRUSTED_CLICK')
    expect(host._isoEval).toHaveBeenCalledTimes(1)
  })
})

describe('_clickViaCdp 的 debugger 归属与遮挡层还原', () => {
  function makeWin ({ attached = false } = {}) {
    const sent = []
    return {
      sent,
      webContents: {
        debugger: {
          isAttached: () => attached,
          attach: vi.fn(async () => {}),
          detach: vi.fn(async () => {}),
          sendCommand: vi.fn(async (method, params) => {
            sent.push({ method, params })
            if (method === 'Runtime.evaluate') return { result: { value: '100,200' } }
            return {}
          }),
        },
      },
    }
  }

  it('自己 attach 的会话才 detach（他方持有时不拆别人的通道）', async () => {
    const own = makeWin({ attached: false })
    await behaviorMixin._clickViaCdp(own, SEL)
    expect(own.webContents.debugger.attach).toHaveBeenCalled()
    expect(own.webContents.debugger.detach).toHaveBeenCalledTimes(1)

    const shared = makeWin({ attached: true })
    await behaviorMixin._clickViaCdp(shared, SEL)
    expect(shared.webContents.debugger.attach).not.toHaveBeenCalled()
    expect(shared.webContents.debugger.detach).not.toHaveBeenCalled()
  })

  it('点击完成后必须还原被临时关闭的 pointer-events（__mpPe 不能只写不读）', async () => {
    const win = makeWin()
    await behaviorMixin._clickViaCdp(win, SEL)

    const mouseReleasedAt = win.sent.findIndex(s => s.method === 'Input.dispatchMouseEvent' && s.params.type === 'mouseReleased')
    expect(mouseReleasedAt).toBeGreaterThanOrEqual(0)
    // 取坐标那一发 Runtime.evaluate 也含 __mpPe（写入），所以只在 mouseReleased 之后找还原语句
    const restoreAt = win.sent
      .slice(mouseReleasedAt + 1)
      .findIndex(s => s.method === 'Runtime.evaluate' && String(s.params.expression).includes('__mpPe'))
    expect(restoreAt).toBeGreaterThanOrEqual(0)
  })
})
