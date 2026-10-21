'use strict'

/**
 * 失败记录必须保留 result 里的结构化诊断（2026-10-21，douyin-e2e-timeout-debug）
 *
 * ── 动因（真机实证）─────────────────────────────────────────
 * 2026-10-21 抖音视频发布 E2E 失败，任务历史只记：
 *   { status:'failed', result:null, error:'publish timeout' }
 * 而真实失败路径是 **API 轨抛错 → 降级 DOM 轨 → DOM 超时**：
 *   rpa-view-manager.js:186 log.error('API publish ...')  ← 有日志
 *   rpa-view-manager.js:195 log.warn('API failed, falling back to RPA') ← 有日志
 * 但**历史记录里查不到**「是否走过 API 轨、其失败原因是什么」，
 * 导致只能靠终态 error 反推（PRD §16.19.2 已如实标注这是推断）。
 *
 * ── 修法 ────────────────────────────────────────────────────
 * 失败分支不再硬编码 `result: null`，改为保留 `task.result`（若有）。
 * 这样 rpa-view-manager 降级时写入 result 的 `stoppedBy` 等字段即可进历史。
 *
 * 边界：result 可能含大对象/循环引用，落库前用安全 JSON 化；化不掉就退回 null（不阻断主流程）。
 */

const path = require('node:path')
const Module = require('node:module')

function loadPhase4 () {
  const P = path.resolve(__dirname, '../electron/bootstrap/phase4-events.js')
  const fs = require('node:fs')
  // 静态读取源码 + 断言结构（phase4-events 依赖 electron，不宜在单测里直接 require）
  return fs.readFileSync(P, 'utf8')
}

describe('phase4-events 失败记录保留结构化 result', () => {
  const src = loadPhase4()

  test('失败分支不得硬编码 result: null（否则丢 API 轨诊断）', () => {
    const bad = /status:\s*'failed',\s*result:\s*null/.test(src)
    expect(bad).toBe(false)
  })

  test('失败分支保留 task.result（安全序列化）', () => {
    // 允许 result: task.result 或等价的安全包装
    expect(/result:\s*safeResult|result:\s*task\.result/.test(src)).toBe(true)
  })

  test('提供安全序列化兜底（化不掉不阻断主流程）', () => {
    expect(/function safeResult|const safeResult/.test(src)).toBe(true)
  })
})
