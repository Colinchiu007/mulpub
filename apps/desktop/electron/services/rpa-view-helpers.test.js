// @ts-check
const fs = require('fs')
const path = require('path')
const helpersMixin = require('./rpa-view-helpers')
const log = require('./logger')

describe('rpa-view-helpers — 发布网络证据采集', () => {
  it('仅保留脱敏响应摘要和解析后的证据，不保留原始响应体或 query', async () => {
    let messageHandler
    const debuggerApi = {
      attach: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event, handler) => { messageHandler = handler }),
      removeListener: vi.fn(),
      sendCommand: vi.fn(async (method) => {
        if (method === 'Network.getResponseBody') {
          return { body: JSON.stringify({ data: { mediaId: 'media-1234', token: 'secret-token', content: '用户发布正文' } }) }
        }
        return {}
      }),
    }
    const win = { webContents: { debugger: debuggerApi } }
    const capture = await helpersMixin._startPublishNetworkCapture.call({}, win, {
      parseResponseBody: (body) => {
        const parsed = JSON.parse(body)
        return { publishIds: [parsed.data.mediaId] }
      },
    })

    await messageHandler({}, 'Network.responseReceived', {
      requestId: 'request-1',
      response: {
        url: 'https://publish.example.test/api/publish?access_token=secret-token',
        status: 200,
        mimeType: 'application/json',
      },
    })
    await messageHandler({}, 'Network.loadingFinished', { requestId: 'request-1' })
    const records = await capture.stop()
    const serialized = JSON.stringify({ records, evidence: capture.evidence })

    expect(records).toEqual([{
      endpoint: 'https://publish.example.test/api/publish',
      status: 200,
      mimeType: 'application/json',
    }])
    expect(capture.evidence).toEqual([{ publishIds: ['media-1234'] }])
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('用户发布正文')
    expect(serialized).not.toContain('access_token')
  })
})

// ========== B1（oss-b1-rpa-hardening）行为层接线与 isolated 通道 ==========
// 任务 3.4（_click/_fillInput 改调行为层 + 失败回落原生并 warn）
// 任务 4.3（结构锁：迁移清单内路径无裸 executeJavaScript 主世界调用）
// 任务 11.4（helpers 层：isolated 失败 warn 点名 iframe + 回落；probe 留主世界）

describe('rpa-view-helpers — 行为层接线（任务 3.4）', () => {
  let warnSpy
  let savedDriver

  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    savedDriver = process.env.MP_RPA_DRIVER
    delete process.env.MP_RPA_DRIVER
  })

  afterEach(() => {
    warnSpy.mockRestore()
    if (savedDriver === undefined) delete process.env.MP_RPA_DRIVER
    else process.env.MP_RPA_DRIVER = savedDriver
  })

  function makeCtx () {
    const ctx = { ...helpersMixin }
    ctx._sleep = vi.fn().mockResolvedValue(undefined)
    ctx._isoEval = vi.fn().mockResolvedValue('DIV|btn|ok')
    ctx._behaviorClick = vi.fn().mockResolvedValue('BEHAVIOR@10,20')
    ctx._probeClickState = vi.fn().mockResolvedValue('{"ocLog":[]}')
    ctx._behaviorFill = vi.fn().mockResolvedValue({ ok: true, readBack: 5, ce: false })
    return ctx
  }

  it('默认 driver 下点击先走行为层；行为层成功不回落原生合成 click', async () => {
    const ctx = makeCtx()
    const win = { webContents: { executeJavaScript: vi.fn() } }
    const r = await helpersMixin._click.call(ctx, win, '#pub')
    expect(ctx._behaviorClick).toHaveBeenCalledWith(win, '#pub')
    expect(ctx._isoEval).not.toHaveBeenCalled()
    expect(ctx._sleep).toHaveBeenCalledWith(2500)
    expect(ctx._probeClickState).toHaveBeenCalledWith(win)
    expect(r).toBe(true)
  })

  it('行为层点击失败时 warn 并经 isolated 通道回落原生合成 click', async () => {
    const ctx = makeCtx()
    ctx._behaviorClick.mockResolvedValue(null)
    const win = { webContents: { executeJavaScript: vi.fn() } }
    const r = await helpersMixin._click.call(ctx, win, '#pub')
    expect(ctx._behaviorClick).toHaveBeenCalled()
    expect(ctx._isoEval).toHaveBeenCalledTimes(1)
    expect(String(ctx._isoEval.mock.calls[0][1])).toContain('el.click()')
    expect(r).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith('RpaView', expect.stringContaining('回落可信点击'))
  })

  // 2026-10-20（wechat-save-click）：公众号「保存为草稿」真机表现是按钮命中但
  // 页面零请求（probe appReqN=0）。根因是合成 click 无 isTrusted，React 版后台不响应；
  // 而行为层的 getBounds 走 CDP DOM.querySelector（只认标准 CSS），对 :has-text
  // 必然抛错 ⇒ 它压根到不了可信通道。以下三条锁住新的分流与返回值语义。
  it('含 :has-text 的选择器跳过行为层，直走 CDP 可信点击', async () => {
    const ctx = makeCtx()
    ctx._clickViaCdp = vi.fn().mockResolvedValue('TRUSTED_CLICK')
    const win = { webContents: { executeJavaScript: vi.fn() } }
    const r = await helpersMixin._click.call(ctx, win, 'button:has-text("保存")')
    expect(ctx._behaviorClick).not.toHaveBeenCalled()
    expect(ctx._clickViaCdp).toHaveBeenCalledWith(win, 'button:has-text("保存")')
    expect(ctx._isoEval).not.toHaveBeenCalled()
    expect(r).toBe(true)
  })

  it('可信点击通道不可用时仍回落合成 click（不丢兜底）', async () => {
    const ctx = makeCtx()
    ctx._clickViaCdp = vi.fn().mockResolvedValue(null)
    const win = { webContents: { executeJavaScript: vi.fn() } }
    const r = await helpersMixin._click.call(ctx, win, 'a:has-text("保存")')
    expect(ctx._clickViaCdp).toHaveBeenCalled()
    expect(ctx._isoEval).toHaveBeenCalledTimes(1)
    expect(r).toBe(true)
  })

  it('元素未命中时 _click 返回 false（此前恒为 true，失败分支是死代码）', async () => {
    const ctx = makeCtx()
    ctx._clickViaCdp = vi.fn().mockResolvedValue('NOT_FOUND')
    const win = { webContents: { executeJavaScript: vi.fn() } }
    const r = await helpersMixin._click.call(ctx, win, 'a:has-text("不存在")')
    expect(ctx._isoEval).not.toHaveBeenCalled()
    expect(r).toBe(false)
  })

  it('MP_RPA_DRIVER=native 时跳过行为层直接原生合成 click', async () => {
    process.env.MP_RPA_DRIVER = 'native'
    const ctx = makeCtx()
    const win = { webContents: { executeJavaScript: vi.fn() } }
    await helpersMixin._click.call(ctx, win, '#pub')
    expect(ctx._behaviorClick).not.toHaveBeenCalled()
    expect(ctx._isoEval).toHaveBeenCalledTimes(1)
  })

  it('MP_RPA_DRIVER 非法值时 warn 并回落默认行为层', async () => {
    process.env.MP_RPA_DRIVER = 'autopilot'
    const ctx = makeCtx()
    const win = { webContents: { executeJavaScript: vi.fn() } }
    await helpersMixin._click.call(ctx, win, '#pub')
    expect(warnSpy).toHaveBeenCalledWith('RpaView', expect.stringContaining('MP_RPA_DRIVER'))
    expect(ctx._behaviorClick).toHaveBeenCalled()
  })

  it('点击探针留主世界读 window.__ocLog（spike：隔离世界 window 属性隔离）', async () => {
    let captured = ''
    const win = {
      webContents: {
        executeJavaScript: vi.fn(async (code) => { captured = code; return '{}' }),
      },
    }
    const r = await helpersMixin._probeClickState.call({}, win)
    expect(captured).toContain('window.__ocLog')
    expect(captured).toContain('window.__dpLog')
    expect(r).toBe('{}')
  })

  it('短文本填值走行为层；行为层成功不调原生 value-set', async () => {
    const ctx = makeCtx()
    const win = { webContents: { executeJavaScript: vi.fn() } }
    const r = await helpersMixin._fillInput.call(ctx, win, '#t', 'abcde')
    expect(ctx._behaviorFill).toHaveBeenCalledWith(win, '#t', 'abcde')
    expect(ctx._isoEval).not.toHaveBeenCalled()
    expect(r).toBe(5)
  })

  it('超行为层阈值的长文本跳过行为层走原生并 warn', async () => {
    const ctx = makeCtx()
    const longText = 'x'.repeat(helpersMixin.BEHAVIOR_TYPE_MAX_CHARS + 1)
    ctx._isoEval.mockResolvedValue({ ok: true, readBack: longText.length, ce: false })
    const win = { webContents: { executeJavaScript: vi.fn() } }
    const r = await helpersMixin._fillInput.call(ctx, win, '#c', longText)
    expect(ctx._behaviorFill).not.toHaveBeenCalled()
    expect(ctx._isoEval).toHaveBeenCalledTimes(1)
    expect(r).toBe(longText.length)
    expect(warnSpy).toHaveBeenCalledWith('RpaView', expect.stringContaining('阈值'))
  })

  it('行为层填值失败时 warn 并回落原生 value-set', async () => {
    const ctx = makeCtx()
    ctx._behaviorFill.mockResolvedValue(null)
    ctx._isoEval.mockResolvedValue({ ok: true, readBack: 5, ce: false })
    const win = { webContents: { executeJavaScript: vi.fn() } }
    const r = await helpersMixin._fillInput.call(ctx, win, '#t', 'abcde')
    expect(ctx._behaviorFill).toHaveBeenCalled()
    expect(ctx._isoEval).toHaveBeenCalledTimes(1)
    expect(String(ctx._isoEval.mock.calls[0][1])).toContain('execCommand')
    expect(r).toBe(5)
    expect(warnSpy).toHaveBeenCalledWith('RpaView', expect.stringContaining('回落原生'))
  })

  it('行为层路径读回为 0 时抛错（原契约保留于行为路径）', async () => {
    const ctx = makeCtx()
    ctx._behaviorFill.mockResolvedValue({ ok: true, readBack: 0, ce: false })
    const win = { webContents: { executeJavaScript: vi.fn() } }
    await expect(helpersMixin._fillInput.call(ctx, win, '#t', 'abc'))
      .rejects.toThrow('fill not applied')
  })

  it('MP_RPA_DRIVER=native 时填值不走行为层', async () => {
    process.env.MP_RPA_DRIVER = 'native'
    const ctx = makeCtx()
    ctx._isoEval.mockResolvedValue({ ok: true, readBack: 5, ce: false })
    const win = { webContents: { executeJavaScript: vi.fn() } }
    const r = await helpersMixin._fillInput.call(ctx, win, '#t', 'abcde')
    expect(ctx._behaviorFill).not.toHaveBeenCalled()
    expect(ctx._isoEval).toHaveBeenCalledTimes(1)
    expect(r).toBe(5)
  })
})

describe('rpa-view-helpers — 迁移清单结构锁（任务 4.3）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'rpa-view-helpers.js'), 'utf8')
  // B1 拆分（debt-guard 新代码阻断门禁）：行为层 + CDP 传输 + isolated 通道整层
  // 下沉至 stealth/rpa-behavior-mixin.js，由 helpers 侧 ...behaviorMixin 合入。
  // 迁移后 helpers 只保留「委托入口 + 读回判据」，故下方结构锁分两侧断言：
  // helpers 侧锁「已委托」，mixin 侧锁「实现仍在」。
  const mixinSrc = fs.readFileSync(path.join(__dirname, 'stealth', 'rpa-behavior-mixin.js'), 'utf8')

  /** 括号配对提取函数体（跳过字符串字面量与注释——AGENTS.md 注册表提取纪律同款） */
  function extractFnBody (source, marker) {
    const idx = source.indexOf(marker)
    expect(idx, '标记必须存在: ' + marker).toBeGreaterThanOrEqual(0)
    const openIdx = source.indexOf('{', idx)
    expect(openIdx).toBeGreaterThanOrEqual(0)
    let depth = 0
    for (let i = openIdx; i < source.length; i++) {
      const c = source[i]
      if (c === '/' && source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') i++
        continue
      }
      if (c === '/' && source[i + 1] === '*') {
        i = source.indexOf('*/', i + 2)
        if (i < 0) return ''
        i += 1
        continue
      }
      if (c === "'" || c === '"' || c === '`') {
        const quote = c
        i++
        while (i < source.length) {
          if (source[i] === '\\') { i += 2; continue }
          if (source[i] === quote) break
          i++
        }
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return source.slice(openIdx, i + 1)
      }
    }
    return ''
  }

  it('_click 主体经 isolated 通道与行为层，无裸 executeJavaScript 主世界调用', () => {
    const body = extractFnBody(src, 'async _click(win, sel) {')
    expect(body).not.toBe('')
    // helpers 侧只留委托入口（B1 拆分后行为层在 mixin 内）
    expect(body).toContain('_clickViaDriver')
    expect(body).toContain('_probeClickState')
    expect(body).not.toContain('executeJavaScript')
    // 委托目标在 mixin 内仍具备行为层 + isolated 通道
    const drvBody = extractFnBody(mixinSrc, 'async _clickViaDriver(win, sel) {')
    expect(drvBody).not.toBe('')
    expect(drvBody).toContain('_behaviorClick')
    expect(drvBody).toContain('_isoEval')
    expect(drvBody).not.toContain('executeJavaScript')
  })

  it('_fillInput 主体经 isolated 通道与行为层，无裸 executeJavaScript 主世界调用', () => {
    const body = extractFnBody(src, 'async _fillInput(win, sel, val) {')
    expect(body).not.toBe('')
    expect(body).toContain('_fillViaDriver')
    expect(body).not.toContain('executeJavaScript')
    // 委托目标在 mixin 内仍具备行为层 + isolated 通道
    const fillBody = extractFnBody(mixinSrc, 'async _fillViaDriver(win, sel, val) {')
    expect(fillBody).not.toBe('')
    expect(fillBody).toContain('_behaviorFill')
    expect(fillBody).toContain('_isoEval')
    expect(fillBody).not.toContain('executeJavaScript')
  })

  it('点击探针显式豁免于主世界（window.__ocLog 状态只在主世界——spike 实证）', () => {
    const probeBody = extractFnBody(mixinSrc, 'async _probeClickState(win) {')
    expect(probeBody).not.toBe('')
    expect(probeBody).toContain('window.__ocLog')
    expect(probeBody).toContain('executeJavaScript')
  })
})
