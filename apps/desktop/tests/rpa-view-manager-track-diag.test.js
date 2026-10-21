/**
 * RpaViewManager 分轨诊断字段（2026-10-21，track-diag-full）
 *
 * 背景：PR #4150 已落地 `apiTrackFailed`（API 轨失败诊断），
 * PRD §16.19.4 埋点清单还差 ①「分轨切换原因」：
 * 历史记录无法回答「这次实际用了哪条轨、是否走过 API 轨」。
 *
 * ── 判据域说明（重要）─────────────────────────────────────
 * 被测性质是「**rpa-view-manager.js 的 DOM 轨返回真的带上这些字段**」——
 * 那不是"某个样本对象有这些键"能证明的（那测的是字面逻辑，不是实现）。
 * 故采用**静态结构锁**：读真实源码，断言两个返回点（成功/异常）都写入了
 * `track` 与条件 `apiTrackAttempted`。这与 `failed-record-keeps-result.test.js`
 * 同模式（该文件锁的是 phase4-events 的落库字段）。
 *
 * 锁四条：
 *  ① 成功返回点带 `track`
 *  ② 异常返回点也带 `track`
 *  ③ 两点都有条件 `apiTrackAttempted`（只有走过 API 轨才 true）
 *  ④ 仍保留 apiTrackFailed 合并（#4150 的成果不被本轮冲掉）
 */
const fs = require('node:fs')
const path = require('node:path')

function loadSrc () {
  const P = path.resolve(__dirname, '../electron/services/rpa-view-manager.js')
  return fs.readFileSync(P, 'utf8')
}

describe('rpa-view-manager DOM 轨返回带分轨诊断字段', () => {
  const src = loadSrc()

  test('① 成功返回点带 track 与条件 apiTrackAttempted', () => {
    // 成功点：const out = (result && typeof result === 'object') ? { ...result } : ...
    expect(/const out = \(result && typeof result === 'object'\)[\s\S]{0,320}?out\.track = apiEnabled \? 'api-then-dom' : 'dom'/.test(src)).toBe(true)
    expect(/if \(apiEnabled\) out\.apiTrackAttempted = true/.test(src)).toBe(true)
  })

  test('② 异常返回点也带 track', () => {
    // 异常点：const out = { success:false, error:e.message, platform:platform }
    expect(/const out = \{ success:false, error:e\.message, platform:platform \}[\s\S]{0,320}?out\.track = apiEnabled \? 'api-then-dom' : 'dom'/.test(src)).toBe(true)
  })

  test('③ apiTrackAttempted 是**条件**写入（未走 API 轨不得带）', () => {
    // 必须包在 if (apiEnabled) 里；无条件写会让 dom-only 轨也声称走过 API
    const matches = src.match(/if \(apiEnabled\) out\.apiTrackAttempted = true/g) || []
    expect(matches.length).toBe(2) // 成功点 + 异常点各一次
  })

  test('④ apiTrackFailed 合并在位（#4150 成果不被冲掉）', () => {
    const matches = src.match(/out\.apiTrackFailed = this\._lastApiFailure/g) || []
    expect(matches.length).toBe(2)
  })
})
