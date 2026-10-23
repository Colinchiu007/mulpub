'use strict'

/**
 * R5 结构锁（2026-10-23）：RPA 弹窗在失败返回前必须关闭
 *
 * 背景：逆向风险清单 R5「失败分支不复位 UI 状态」原本只锁 Vue 组件；
 * 真机事故（2026-10-23 头条）证明同型缺陷存在于 RPA DOM 层——
 * 封面弹窗「下一步」失败后直接 return，弹窗留在页面上，后续发布点击全部打在遮罩上。
 *
 * 本锁先覆盖已修复的 `no-next` 分支；同文件另有 8 处失败返回尚未补齐，
 * 已在 PR 记录中登记为债务，后续逐个补锁（扩到全部 return 即可）。
 */
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'electron', 'services', 'toutiao-cover.js')

describe('R5 锁：封面 no-next 失败路径必须关闭弹窗', () => {
  it('no-next 分支返回前有取消/关闭动作', () => {
    const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/)
    const idx = lines.findIndex((l) => l.includes("step: 'no-next'"))
    expect(idx).toBeGreaterThan(-1)
    const window = lines.slice(idx - 12, idx).join('\n')
    expect(/(取消|关闭|×)/.test(window)).toBe(true)
  })

  it('文件含封面失败日志（防止改名后真空通过）', () => {
    const src = fs.readFileSync(SRC, 'utf8')
    expect(src).toContain('cover dialog closed after failure')
  })
})
