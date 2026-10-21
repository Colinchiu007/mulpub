'use strict'

/**
 * RpaVmPublisher 必须透传分轨诊断字段（router-diag-passthrough，2026-10-21）
 *
 * ── 动因（真机实证）─────────────────────────────────────────
 * 2026-10-21 头条视频发布（已认证账号 45261bb5，新二进制）失败，任务历史：
 *   { status:'failed', result:null, error:'今日头条 视频上传未完成…' }
 * 分轨诊断 track / apiTrackAttempted / apiTrackFailed **全部缺失**。
 *
 * 代码层埋点确实存在（rpa-view-manager.js L249-255 会往返回对象写这三个字段），
 * 但 `RpaVmPublisher.publish` 在**成功与失败两个分支都重新构造返回对象**，
 * 只挑 success/url/postId/platform/mode/draft/diagnostics ⇒ 诊断字段被丢在半路。
 * 失败分支更严重：直接 `throw new Error(result.error)`，诊断只被
 * `markNotSentByResult` / `attachRiskSignals` 摘走 notSent/code 两个字段。
 *
 * ⇒ 后果：PRD §16.19.4 的埋点白做了（产生了但没进历史）。
 *
 * ── 实现位置 ────────────────────────────────────────────────
 * 摘取/挂载函数在 `electron/services/publish-diag-fields.js`（独立模块，
 * 因 publisher-router.js 在 check-max-lines 点名还账清单内、零增长容差）；
 * router 内只留两处**内联 require 调用**（0 额外行）。
 *
 * ── 锁四条 ──────────────────────────────────────────────────
 * ① 成功分支透传诊断字段；
 * ② 失败分支把诊断挂到 error 上；
 * ③ 摘取函数字段族覆盖四项（新模块）；
 * ④ 不破坏既有行为（postId 缺失抛错、notSent/code 摘取、draft 透传）。
 */

const fs = require('node:fs')
const path = require('node:path')

function loadRouter () {
  return fs.readFileSync(path.resolve(__dirname, '../electron/services/publisher-router.js'), 'utf8')
}
function loadDiagModule () {
  return fs.readFileSync(path.resolve(__dirname, '../electron/services/publish-diag-fields.js'), 'utf8')
}

describe('RpaVmPublisher 透传分轨诊断字段', () => {
  const router = loadRouter()

  test('① 成功分支透传诊断字段（不再只挑 6 个字段）', () => {
    expect(/\.\.\.require\('\.\/publish-diag-fields'\)\.pickDiagFields\(result\)/.test(router)).toBe(true)
  })

  test('② 失败分支把诊断挂到 error 上（不改变 throw 语义）', () => {
    expect(/require\('\.\/publish-diag-fields'\)\.attachDiagToError\(rpaErr, result\)/.test(router)).toBe(true)
  })

  test('③ 摘取函数字段族覆盖四项（新模块）', () => {
    const m = loadDiagModule().match(/function pickDiagFields[\s\S]{0,500}/)
    expect(m).toBeTruthy()
    for (const k of ['track', 'apiTrackAttempted', 'apiTrackFailed', 'publishId']) {
      expect(m[0].includes(k)).toBe(true)
    }
  })

  test('④ 不破坏既有行为：postId 缺失抛错 / notSent / code 摘取仍在', () => {
    expect(/markNotSentByResult\(rpaErr, result\)/.test(router)).toBe(true)
    expect(/attachRiskSignals\(rpaErr, result\)/.test(router)).toBe(true)
    expect(/throw new Error\(result\.error \|\| '发布结果缺少平台作品 ID'\)/.test(router)).toBe(true)
  })
})
