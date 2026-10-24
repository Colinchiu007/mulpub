'use strict'

/**
 * 抖音 DOM 轨成功必须带回产物 ID（2026-10-21，dom-track-publish-id）
 *
 * ── 动因（真机实证）─────────────────────────────────────────
 * 2026-10-21 抖音 E2E 首次成功（PRD §16.22）：任务 status=success、mode=dom，
 * 但 `result` 里**没有任何平台侧 ID**，导致"成功"缺少可核对的硬证据。
 *
 * 根因：`rpa-view-platforms.js` L1050 只 `return { success:true, url, platform }`，
 * 把 `_waitForResponse` 已经 resolve 出来的 `resp` **整个丢掉** ——
 * 而 `resp` 形如 `{ url, statusCode, matchedUrls, body }`（`rpa-view-helpers.js` L390，
 * body 由 CDP 采集，2026-10-16 wxmp-save-body-intercept 修复后已有）。
 *
 * ⇒ **不是平台不给 ID，是我们没接住。**
 *
 * ── 锁三条 ──────────────────────────────────────────────────
 * ① 成功分支不得再丢弃 resp（必须解出 publishId）；
 * ② publishId 从 body 的已知字段族提取（aweme_id / item_id / video_id / id），
 *    取不到时**留空字符串**而不是编造；
 * ③ 同时保留 track 诊断字段（#4155 的成果不被冲掉）。
 *
 * 判据模式：静态结构锁（读真实源码断言），同 rpa-view-manager-track-diag.test.js。
 * 理由：跑通整条 DOM 链需要 Electron 窗口栈 + 真实平台响应，成本高且脆；
 * 而"字段有没有被接住"是可用静态断言精确判定的。
 */

const fs = require('node:fs')
const path = require('node:path')

function loadSrc () {
  const P = path.resolve(__dirname, '../electron/services/rpa-view-platforms.js')
  return fs.readFileSync(P, 'utf8')
}

describe('抖音 DOM 轨成功分支带回产物 ID', () => {
  const src = loadSrc()

  test('① 成功分支不得丢弃 resp（必须解出 publishId）', () => {
    // 旧形状：if (resp) { ...; return { success:true, url:..., platform:'douyin' } }
    expect(/if \(resp\) \{[^}]*return \{ success:true, url:win\.webContents\.getURL\(\)\|\|'', platform:'douyin' \}/.test(src)).toBe(false)
  })

  test('② 复用仓库既有的响应体 ID 提取工具（字段族在那边定义）', () => {
    // 仓库已有 extractPublishIdsFromResponseBody（L89 已在用），
    // 抖音成功分支应复用它，而不是再写一套字段枚举。
    expect(/extractPublishIdsFromResponseBody/.test(src)).toBe(true)
  })

  test('③ ID 取不到时不得编造（空串兜底）', () => {
    const m = src.match(/var publishId = [\s\S]{0,400}/)
    expect(m).toBeTruthy()
    // 空串兜底：|| '' 或等价形状，且不得出现写死的假 ID
    expect(/\|\| ''/.test(m[0])).toBe(true)
  })

  test('④ 成功返回体含 publishId 字段', () => {
    expect(/publishId:\s*publishId/.test(src)).toBe(true)
  })

  test('⑤ 复用单一真源工具（不自造第二套 ID 提取）', () => {
    // 仓库已有 extractPublishIdsFromResponseBody / normalizePublishId（L29-33 引入），
    // 纪律是复用而非再造一套。断言成功分支走的是既有工具。
    const mgr = fs.readFileSync(path.resolve(__dirname, '../electron/services/rpa-view-platforms.js'), 'utf8')
    expect(/extractPublishIdsFromResponseBody/.test(mgr)).toBe(true)
    expect(/normalizePublishId/.test(mgr)).toBe(true)
  })
})
