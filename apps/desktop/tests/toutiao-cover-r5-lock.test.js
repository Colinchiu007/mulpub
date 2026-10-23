'use strict'

/**
 * R5 结构锁（2026-10-23）：RPA 弹窗在失败返回前必须关闭
 *
 * 逆向风险清单 R5「失败分支不复位 UI 状态」原本只锁 Vue 组件；
 * 真机事故（2026-10-23 头条）证明同型缺陷存在于 RPA DOM 层——
 * 封面弹窗失败后直接 return，弹窗留在页面上，后续发布点击全部打在遮罩上。
 *
 * 判据：以下三类失败发生时弹窗**必然已打开**，返回前必须有关闭动作：
 *   no-next（下一步不可点）/ no-local-tab（本地上传页签不可点）/ set-file-failed（设文件失败）
 * 其余（clicked-trigger / no-dialog / no-cover-path）发生时弹窗尚未打开，不要求关闭。
 */
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'electron', 'services', 'toutiao-cover.js')
const MUST_CLOSE = ['no-next', 'no-local-tab', 'set-file-failed']

describe('R5 锁：会留下弹窗的失败路径必须先关闭', () => {
  it('三类失败返回前都有 closeCoverDialog', () => {
    const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/)
    const missing = []
    lines.forEach((line, i) => {
      const m = line.match(/step:\s*'([a-z-]+)'/)
      if (!m || !MUST_CLOSE.includes(m[1])) return
      if (!line.includes('closeCoverDialog') && !line.includes('cover dialog closed')) {
        const window = lines.slice(Math.max(0, i - 10), i).join('\n')
        if (!window.includes('closeCoverDialog') && !window.includes('cover dialog closed')) missing.push(i + 1)
      }
    })
    expect(missing).toEqual([])
  })

  it('辅助函数存在（防止改名后真空通过）', () => {
    expect(fs.readFileSync(SRC, 'utf8')).toContain('async function closeCoverDialog')
  })
})
