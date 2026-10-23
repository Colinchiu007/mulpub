// 2026-10-23 回归锁：CDP 参数名写错会报 Invalid parameters，且错误指向下游命令，极易误判。
// 只锁结构，防止再次把 selector 简写成 useSel。
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, 'upload-waiter.js')

describe('upload-waiter CDP drop regression', () => {
  const src = fs.readFileSync(SRC, 'utf8')

  it('DOM.querySelector 必须使用 selector 键名', () => {
    expect(src).toContain("DOM.querySelector', { nodeId: doc.root.nodeId, selector: useSel }")
    expect(src).not.toContain('nodeId: doc.root.nodeId, useSel }')
  })

  it('拖放必须使用 Input.dispatchDragEvent 且 dragData 含 files', () => {
    expect(src).toContain('Input.dispatchDragEvent')
    expect(src).toContain('files: [_abs]')
  })

  it('坐标必须有 isFinite 兜底，避免 NaN 触发 Invalid parameters', () => {
    expect(src).toContain('isFinite(rect.x)')
    expect(src).toContain('isFinite(rect.y)')
  })
})
