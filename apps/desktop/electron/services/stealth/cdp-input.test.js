// @ts-check
/**
 * cdp-input.test.js — Electron CDP 输入驱动契约（PRD §3.2）
 *
 * 契约：
 * 1. **映射正确**：move→Input.dispatchMouseEvent(mouseMoved)、down→mousePressed、
 *    up→mouseReleased（CDP Input 域语义）
 * 2. **getBounds 链**：DOM.enable→getDocument→querySelector→getBoxModel → 返回中心点
 * 3. **合成事件走页面侧**：9 字段 pointer/mouse 全套必须经 executeJavaScript 在页面
 *    派发（CDP Input 域没有合成事件能力——social-auto-upload 同款路线）
 * 4. **attach/detach 生命周期**：per-op attach('1.3') + **owned-detach**（仅 attach 成功/
 *    会话归我们时才 detach；他方已附着时复用会话、不拆别人的 CDP 通道——对齐 isolated-world
 *    owned 模式，QM-6 Warning-3）
 * 5. **失败不抛**：CDP 命令失败 → 返回 false/null + owned detach 照走（调用方降级）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeWin ({ sendImpl } = {}) {
  const sent = []
  const executed = []
  const win = {
    webContents: {
      debugger: {
        attach: vi.fn(async () => {}),
        detach: vi.fn(async () => {}),
        sendCommand: vi.fn(async (method, params) => {
          sent.push({ method, params })
          if (sendImpl) return sendImpl(method, params)
          // 默认假响应链
          if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
          if (method === 'DOM.querySelector') return { nodeId: 2 }
          if (method === 'DOM.getBoxModel') return { model: { width: 100, height: 40, content: [10, 20, 110, 20, 110, 60, 10, 60] } }
          return {}
        }),
      },
      executeJavaScript: vi.fn(async (code) => { executed.push(code); return true }),
    },
  }
  return { win, sent, executed }
}

describe('cdp-input 驱动契约', () => {
  let createCdpInput
  beforeEach(async () => {
    vi.resetModules()
    ;({ createCdpInput } = await import('./cdp-input.js'))
  })

  it('dispatch(move/down/up) → CDP Input 域正确事件类型', async () => {
    const { win, sent } = makeWin()
    const driver = createCdpInput(win)
    await driver.dispatch('move', 100, 200)
    await driver.dispatch('down', 100, 200)
    await driver.dispatch('up', 100, 200)
    const types = sent.filter((s) => s.method === 'Input.dispatchMouseEvent').map((s) => s.params.type)
    expect(types).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased'])
    const move = sent.find((s) => s.params.type === 'mouseMoved')
    expect(move.params.x).toBe(100)
    expect(move.params.y).toBe(200)
    expect(move.params.button).toBe('left')
  })

  it('getBounds → DOM 链 + 返回元素中心点', async () => {
    const { win, sent } = makeWin()
    const driver = createCdpInput(win)
    const b = await driver.getBounds('#target')
    expect(sent.map((s) => s.method)).toEqual(['DOM.enable', 'DOM.getDocument', 'DOM.querySelector', 'DOM.getBoxModel'])
    expect(b).toMatchObject({ x: 60, y: 40 }) // content quad 中心
    expect(b.width).toBe(100)
    expect(b.height).toBe(40)
  })

  it('合成事件经 executeJavaScript 页面侧派发（9 字段原样传递、保序）', async () => {
    const { win, executed } = makeWin()
    const driver = createCdpInput(win)
    const events = [
      { kind: 'pointerover', bubbles: true, clientX: 1, clientY: 2, pointerType: 'mouse' },
      { kind: 'pointerdown', bubbles: true, clientX: 3, clientY: 4, pointerType: 'mouse' },
    ]
    await driver.dispatchSynthetic(events)
    expect(executed.length).toBe(1)
    // 事件对象必须完整进入页面脚本（保序 + 字段不丢）
    expect(executed[0]).toContain('pointerover')
    expect(executed[0]).toContain('pointerdown')
    expect(executed[0].indexOf('pointerover')).toBeLessThan(executed[0].indexOf('pointerdown'))
  })

  it('attach/detach 生命周期：每次操作 attach(1.3) 且 finally detach', async () => {
    const { win } = makeWin()
    const driver = createCdpInput(win)
    await driver.dispatch('move', 0, 0)
    await driver.dispatch('up', 0, 0)
    expect(win.webContents.debugger.attach).toHaveBeenCalledTimes(2)
    expect(win.webContents.debugger.attach).toHaveBeenCalledWith('1.3')
    expect(win.webContents.debugger.detach).toHaveBeenCalledTimes(2)
  })

  it('CDP 命令失败 → 返回 false 不抛，detach 仍执行', async () => {
    const { win } = makeWin({
      sendImpl: (method) => { if (method === 'DOM.getBoxModel') throw new Error('cdp down'); return {} },
    })
    const driver = createCdpInput(win)
    const r = await driver.getBounds('#x')
    expect(r).toBeNull()
    expect(win.webContents.debugger.detach).toHaveBeenCalled()
  })

  it('他方已附着（attach 被拒）→ 操作照常执行，不 detach 他人会话（QM-6 Warning-3 回归锁）', async () => {
    const { win, sent } = makeWin()
    const dbg = win.webContents.debugger
    dbg.attach.mockRejectedValueOnce(new Error('MaybeAttach: already attached'))
    const driver = createCdpInput(win)
    const ok = await driver.dispatch('move', 5, 6)
    expect(ok).toBe(true)
    expect(sent.some((s) => s.method === 'Input.dispatchMouseEvent')).toBe(true)
    // owned=false：无条件 detach 会拆掉上传路径/网络取证持有的 CDP 通道
    expect(dbg.detach).not.toHaveBeenCalled()
  })

  it('他方已附着 + CDP 命令失败 → getBounds 返回 null 且不 detach 他人（catch 冗余 detach 已删）', async () => {
    const { win } = makeWin({
      sendImpl: () => { throw new Error('target closed') },
    })
    const dbg = win.webContents.debugger
    dbg.attach.mockRejectedValueOnce(new Error('MaybeAttach: already attached'))
    const driver = createCdpInput(win)
    const r = await driver.getBounds('#x')
    expect(r).toBeNull()
    expect(dbg.detach).not.toHaveBeenCalled()
  })

  it('typeText 逐字符插入（Input.insertText 按字符）', async () => {
    const { win, sent } = makeWin()
    const driver = createCdpInput(win)
    await driver.typeText('ab')
    const inserts = sent.filter((s) => s.method === 'Input.insertText')
    expect(inserts.length).toBe(2)
    expect(inserts[0].params.text).toBe('a')
    expect(inserts[1].params.text).toBe('b')
  })
})
