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
  return error.code === 'ERR_VISUAL_NOT_READY'
  // **不得**再加 `error.name === 'TimeoutError'` 这类按名字兜底：
  // `_waitForApplicationReady` 已经把它那两个阶段的所有超时（含自己造的 exhaustedBudgetError）
  // 统一改写成上面两个码（test-runner.js:231-250），所以"就绪"永远带码，兜底捞不到新东西；
  // 它真正捞到的是**别处**的超时 —— 补充套件的 4 个视图有 `trigger`/`afterTrigger`，
  // 走的是 `page.click(..., {timeout:5000})` 与 `page.waitForSelector(..., {timeout:10000})`
  // （supplementary-views.visual.test.js:231-234），其中 `button:has-text("添加服务商")`
  // 这类文案锚点本就可能在校验层失败；`page.goto` 的 15s 超时同样是裸 TimeoutError
  // （test-runner.js:292-295，冷 Vite 首次依赖优化就能超）。把它们升成 exit 3
  // 等于绕过 Gate 7b 的两轮甄别 —— 正是本分档要防止的「把抖动变成常量红」。
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
//
// 函数名带 Visual：同目录 `autonomous-enforce-loop.js:197` 已有 `classifyFailures(
// pixelResults, functionalResults)`，语义完全不同 —— 两个同名不同义放在一处会被读错。
function classifyVisualFailures(failures) {
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

// 套件失败对象的**唯一合成处**：消息模板、`code` 赋值、`failures`/`neverReady`/
// `otherFailures` 三个属性挂载。
//
// 存在的理由：views 两套各有自己的 `runViewSuite` 聚合循环（两份实现是既有事实），
// 但如果"失败对象怎么长出来"也抄两份，那两份会在下一次改消息时静默漂移 ——
// 而 `code` 一漂移，Gate 7 的 `= 3` 判定就点不到火。收敛的边界因此不是"循环只留一份"
// （那要重构两套真实差异），而是**判据与合成只留一份**。
//
// `prefix` 是两套各自的历史措辞（`单视图视觉门禁失败` / `补充视图失败`），
// 保留它是为了不让本 PR 顺带改掉日志文案。
function buildSuiteError(prefix, failures) {
  const { neverReady, otherFailures, line } = classifyVisualFailures(failures)
  const names = items => items.map(item => item.test).join(', ')
  let error
  if (neverReady.length > 0) {
    console.error(line)
    error = new Error(`${prefix}: ${neverReady.length} 个视图从未渲染出来`
      + '（就绪超时 ⇒ 路由/选择器故障，不是像素抖动）: ' + names(neverReady)
      + (otherFailures.length
        ? `；另有 ${otherFailures.length} 个视图失败（像素/校验类，交 Gate 7b 判定）: `
          + names(otherFailures)
        : ''))
    error.code = 'ERR_VISUAL_NOT_READY'
  } else {
    error = new Error(`${prefix}: `
      + failures.map(item => `${item.test}: ${item.error.message}`).join(' | '))
    error.code = 'ERR_VISUAL_SUITE_FAILED'
  }
  error.failures = failures
  error.neverReady = neverReady
  error.otherFailures = otherFailures
  return error
}

module.exports = {
  READY_TIMEOUT_CODES,
  isReadyFailure,
  exitCodeForError,
  classifyVisualFailures,
  buildSuiteError,
}

