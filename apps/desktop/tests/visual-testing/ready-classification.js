// 视觉套件「就绪故障」分类的唯一实现。
//
// 存在的理由：views 两套（all-views / supplementary-views）各有自己的 runViewSuite，
// 而它们过去把「页面根本没渲染出来」和「像素有差异」混成同一种失败（前者是确定性的
// 路由/选择器故障，后者才需要 Gate 7b 的两轮采集甄别）。混在一起的后果不是报错难读，
// 是**门禁选不出该拦哪一个**，于是 CI 只能两种都不拦（quality-gate.yml Gate 7 历史上
// 只按 pixel 套件的退出码阻断）。
//
// 判据按 **error.code**，不按消息文本 —— test-runner 里这两个码是合同，消息随时可重写。
//   - ERR_VISUAL_APP_READY_TIMEOUT     ：Vue 应用从未挂载（_waitForApplicationReady 第一阶段）
//   - ERR_VISUAL_READY_SELECTOR_TIMEOUT：应用挂载了，但业务就绪选择器始终没出现（第二阶段）
// 两者语义相同：这一页根本没渲染出来。

const READY_TIMEOUT_CODES = new Set([
  'ERR_VISUAL_APP_READY_TIMEOUT',
  'ERR_VISUAL_READY_SELECTOR_TIMEOUT',
])

function isReadyFailure(error) {
  if (!error) return false
  if (READY_TIMEOUT_CODES.has(error.code)) return true
  // ERR_VISUAL_NOT_READY：套件自己归类后置上的码，用于「已分类过」的二次进入（--single 复用）
  if (error.code === 'ERR_VISUAL_NOT_READY') return true
  // Playwright locator.waitFor 超时的原生码：兜住未走 runner 就绪阶段的旧调用点
  return error.name === 'TimeoutError'
}

// 退出码口径：3 = 有视图从未渲染出来（阻断信号）；1 = 像素/校验类失败，
// 交由 Gate 7b 的两轮甄别与基线新鲜度判定。**禁止**把「非 0」一律编成 3：
// 那等于把历史上确实存在的采集抖动（#2914 同 sha 两次 attempt 一档红一档绿）
// 变成所有 PR 的常量红。
function exitCodeForError(error) {
  return error && error.code === 'ERR_VISUAL_NOT_READY' ? 3 : 1
}

// 把 failures 分成「从未渲染出来」与「其它」，并产出统一的出声行。
// 返回 { neverReady, otherFailures, line }；neverReady 为空时 line 为 null。
function classifyFailures(failures) {
  const neverReady = failures.filter(item => isReadyFailure(item.error))
  const otherFailures = failures.filter(item => !isReadyFailure(item.error))
  if (neverReady.length === 0) return { neverReady, otherFailures, line: null }
  return {
    neverReady,
    otherFailures,
    line: `[VISUAL-READY] ${neverReady.length} 个视图从未渲染出来: `
      + neverReady.map(item => item.test).join(', '),
  }
}

module.exports = {
  READY_TIMEOUT_CODES,
  isReadyFailure,
  exitCodeForError,
  classifyFailures,
}
