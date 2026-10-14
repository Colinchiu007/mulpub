import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  buildMeasurementScript,
  buildPageScript,
  renderCardsToPng,
  DEFAULT_WIDTH_PX,
  TimeoutError,
} = require('./card-capture.js')

/**
 * card-capture 的测试（P2-3 验收判据）。
 *
 * ★ 分层纪律：本文件**只测纯函数**（判据①②③）。
 *   判据④⑤（渲染不溢出 / 性能 < 1.6s）需要**真实 offscreen 窗口** ——
 *   本套件在无 GUI 的 runner 里跑，故 ④⑤ 在**本文件里不写假绿**，
 *   而是明确说明取证位置（QM-1 打包后的集成测试），见另一 describe。
 */

describe('P2-3 判据①②：纯 HTML 构造', () => {
  it('① buildMeasurementScript({widthPx:1006}) 含 left:-10000px 与 1006px，不含 display:none', () => {
    const html = buildMeasurementScript({ widthPx: 1006 })
    expect(html).toContain('left:-10000px')
    expect(html).toContain('1006px')
    // ★ 反例判据：display:none 的元素**不参与布局**，高度恒为 0 ⇒ 测量全部返回 0
    expect(html).not.toContain('display:none')
  })

  it('①b 默认宽度为 1006（设计文 §7.7）', () => {
    expect(DEFAULT_WIDTH_PX).toBe(1006)
    expect(buildMeasurementScript()).toContain('1006px')
  })

  it('② buildPageScript(1,{noMarginTop:true}) 含 margin-top:0', () => {
    expect(buildPageScript(1, { noMarginTop: true })).toContain('margin-top:0')
  })

  it('②b noMarginTop 只作用于**本页第一个块**，不是整页统一清零', () => {
    const on = buildPageScript(0, { noMarginTop: true })
    // ★ 必须限定 :first-child —— 整页统一清零会把页内其余段落间距也吃掉
    expect(on).toContain('first-child')
    const off = buildPageScript(0, { noMarginTop: false })
    expect(off).not.toContain('margin-top:0')
  })

  it('②c 页序号写进 DOM（供注入侧核对渲染的是哪一页）', () => {
    for (const i of [0, 1, 7]) {
      expect(buildPageScript(i)).toContain(`data-page-index="${i}"`)
    }
  })

  it('buildPageScript 的 index 校验 fail-closed', () => {
    for (const bad of [-1, 1.5, NaN, '1', null, undefined]) {
      expect(() => buildPageScript(bad)).toThrow(TypeError)
    }
  })
})

describe('P2-3 判据③：分页集成（用真实分页器，不需 Electron）', () => {
  it('2000 字输入 ⇒ pageCount >= 2 且每页非空', async () => {
    const paginator = require(path.resolve(
      __dirname, '..', '..', '..', '..', 'packages', 'shared-utils', 'src', 'card-paginator-core.js'
    ))
    // 20 段 × 100 字 = 2000 字
    const items = Array.from({ length: 20 }, (_, i) => ({ id: 'p' + i, value: '字'.repeat(100) }))
    // ★ 契约：measure(text, item) => **数字**（高度 px），不是 {heightPx}
    //   （见 card-paginator-core.js 的 measureText：`const h = await measure(text, it)`）
    //   确定性：每字 20px ⇒ 每段 2000px > 页高 1440 ⇒ 逼出切分与多页
    const measure = async (text) => String(text == null ? '' : text).length * 20
    const r = await paginator.paginate(items, { availableHeightPx: 1440, measure, maxPages: 10 })

    expect(r.pageCount).toBeGreaterThanOrEqual(2)
    expect(r.pages.every((b) => b.length > 0)).toBe(true)
    expect(r.pages).toHaveLength(r.pageCount)
  })
})

describe('P2-3 失败纪律：入参与可辨识错误', () => {
  it('renderCardsToPng：空 pages ⇒ 返回空数组，不建窗口', async () => {
    await expect(renderCardsToPng({ pages: [] })).resolves.toEqual([])
  })

  it('renderCardsToPng：pages 非数组 ⇒ 抛 TypeError（fail-closed）', async () => {
    await expect(renderCardsToPng({ pages: 'not-an-array' })).rejects.toThrow(TypeError)
  })

  it('TimeoutError 可辨识（调用方据此区分超时与其他失败）', () => {
    const e = new TimeoutError('x')
    expect(e.name).toBe('TimeoutError')
    expect(e).toBeInstanceOf(Error)
  })
})

/**
 * ⚠️ 判据④⑤ **不在本文件里制造假绿**。
 *
 * 它们需要真实 offscreen BrowserWindow（`capturePage()` 依赖真实渲染管线），
 * 而无 GUI runner 里跑不出可信结果。取证位置：**QM-1 打包后的集成测试**。
 *
 * 真机步骤（已写死在下面，供集成测试照抄）：
 *   ④ 载入 buildPageScript(...) 后执行
 *        document.querySelector('#page').scrollHeight <= document.querySelector('#page').clientHeight
 *      断言 true —— 溢出说明分页高度算错，用户会看到内容被截断
 *   ⑤ 2000 字 / 20 段整轮 renderCardsToPng 耗时 < 1.6 s（函数自带 8 s 超时上限）
 */
describe('P2-3 判据④⑤：需真实 Electron offscreen（取证在 QM-1 后）', () => {
  it.skip('④ 带 icon 模板 + 刚好填满的文本 ⇒ scrollHeight <= clientHeight', () => {})
  it.skip('⑤ 2000 字 / 20 段 < 1.6 s（超时上限 8 s）', () => {})
})
