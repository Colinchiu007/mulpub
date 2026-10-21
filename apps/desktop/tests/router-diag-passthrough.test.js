'use strict'

/**
 * RpaVmPublisher 必须透传分轨诊断字段（router-diag-passthrough，2026-10-21）
 *
 * ── 动因（真机实证）─────────────────────────────────────────
 * 2026-10-21 头条视频发布（已认证账号 45261bb5，新二进制）失败，任务历史 result=null，
 * 分轨诊断 track / apiTrackAttempted / apiTrackFailed 全缺失。
 *
 * 根因：rpa-view-manager.js L249-255 确实写了诊断字段，但 publisher-router.js 的
 * RpaVmPublisher.publish 成功/失败分支都重新构造返回对象，把诊断丢在半路。
 *
 * ── 实现位置 ────────────────────────────────────────────────
 * 摘取/挂载在 `electron/services/publish-diag-fields.js`（独立模块，因
 * publisher-router.js 在 check-max-lines 点名还账清单内、零增长容差）；
 * router 内只留两处内联 require 调用（0 额外行）。
 *
 * 失败分支进一步收敛：原「markNotSentByResult + attachRiskSignals + attachDiagToError」
 * 三个调用合并为新模块的 `decorateRpaError(err, result, deps)` 一次调用
 * （这样反而比原来少 2 行，把 max-lines 从红转绿）。
 *
 * ── 锁四条 ──────────────────────────────────────────────────
 * ① 成功分支透传诊断字段；
 * ② 失败分支经 decorateRpaError 一次调用完成三个装饰；
 * ③ 摘取函数字段族覆盖四项（新模块）；
 * ④ 不破坏既有行为（postId 缺失抛错、draft 透传仍在）。
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

  test('② 失败分支经 decorateRpaError 一次调用（三个装饰合并）', () => {
    expect(/require\('\.\/publish-diag-fields'\)\.decorateRpaError\(rpaErr, result, \{ markNotSentByResult, attachRiskSignals \}\)/.test(router)).toBe(true)
    // 旧的三个分散调用不应再出现在失败分支
    expect(/markNotSentByResult\(rpaErr, result\)/.test(router)).toBe(false)
    expect(/attachRiskSignals\(rpaErr, result\)/.test(router)).toBe(false)
  })

  test('③ 摘取函数字段族覆盖四项（新模块）', () => {
    const m = loadDiagModule().match(/function pickDiagFields[\s\S]{0,500}/)
    expect(m).toBeTruthy()
    for (const k of ['track', 'apiTrackAttempted', 'apiTrackFailed', 'publishId']) {
      expect(m[0].includes(k)).toBe(true)
    }
  })

  test('④ decorateRpaError 依次调用三个装饰且不吞错（新模块）', () => {
    const m = loadDiagModule().match(/function decorateRpaError[\s\S]{0,600}/)
    expect(m).toBeTruthy()
    expect(/deps\.markNotSentByResult\(err, result\)/.test(m[0])).toBe(true)
    expect(/deps\.attachRiskSignals\(err, result\)/.test(m[0])).toBe(true)
    expect(/attachDiagToError\(err, result\)/.test(m[0])).toBe(true)
    expect(/try \{/.test(m[0])).toBe(true)
  })

  test('⑤ 不破坏既有行为：postId 缺失抛错 / draft 透传仍在', () => {
    expect(/throw new Error\(result\.error \|\| '发布结果缺少平台作品 ID'\)/.test(router)).toBe(true)
    expect(/\.\.\.\(result\.draft === true \? \{ draft: true \} : \{\}\)/.test(router)).toBe(true)
  })
})
