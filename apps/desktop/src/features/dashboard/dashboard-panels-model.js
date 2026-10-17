/**
 * 看板新增区块的「IPC 信封 → 视图模型」转换（dash-full-entitlement）。
 *
 * 核心纪律：**三态必须分开** —— empty（合法无数据）/ error（取数失败）/
 * auth（不认识我）。前两种在界面上都表现为"空"，但含义相反：
 * 渲染成同一个空态，用户会把「功能坏了」读成「我还没发过东西」
 * （本项目既有教训：performance-loop.js 注释明写「把查询失败渲染成
 * 从未发布，用户不会报障」）。
 *
 * 这里全部是纯函数：不 import 任何 API，不做 IPC 调用，
 * 便于单测且不依赖 Electron 环境。
 */

/** 未登录门禁态。与 empty/error 并列，绝不退化成 0。 */
export const AUTH_GATE = 'auth'

const READY = 'ready'
const EMPTY = 'empty'
const ERROR = 'error'

/** 三态判定的唯一出口：门禁 > 错误 > 数据。顺序不可调换。 */
function gateOf(res) {
  if (!res) return ERROR
  if (res.code === -3 || res.errorCode === 'AUTH_REQUIRED') return AUTH_GATE
  if (res.code !== 0) return ERROR
  return null
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// ─── 账号健康度 ───────────────────────────────────────────────
const ACCOUNT_BAD_DISPLAY_LIMIT = 5

/**
 * @param {object} res accountBatchCheckLogin 的信封
 * @returns {{state:string, ok:number, bad:number, unknown:number, badAccounts:string[], badOverflow:number}}
 */
export function toAccountHealthModel(res) {
  // res 为 null/undefined 按「无数据」处理而非错误：IPC 不可用（浏览器环境、
  // preload 未就绪）是合法降级路径，不是取数失败。把它判成 error 会让
  // 用户在纯降级场景下看到"账号状态暂时无法获取"——那是谎。
  if (!res) return { state: EMPTY, ok: 0, bad: 0, unknown: 0, badAccounts: [], badOverflow: 0 }
  const gate = gateOf(res)
  if (gate) return { state: gate, ok: 0, bad: 0, unknown: 0, badAccounts: [], badOverflow: 0 }

  const rows = Array.isArray(res.data) ? res.data : []
  if (rows.length === 0) {
    return { state: EMPTY, ok: 0, bad: 0, unknown: 0, badAccounts: [], badOverflow: 0 }
  }

  let ok = 0
  let bad = 0
  let unknown = 0
  const badAccounts = []
  for (const row of rows) {
    const status = String((row && row.status) || '').toLowerCase()
    if (status === 'ok' || status === 'online' || status === 'logged_in') {
      ok += 1
      continue
    }
    if (status === 'failed' || status === 'offline' || status === 'expired' || status === 'error') {
      bad += 1
      badAccounts.push(String((row && row.accountId) || ''))
      continue
    }
    // 除明确正常/异常外一律计 unknown：未知状态不得默认成"正常"
    // （把"没检测"渲染成"都正常"与把"失败"渲染成"没数据"是同一类谎）
    unknown += 1
  }

  return {
    state: READY,
    ok,
    bad,
    unknown,
    badAccounts: badAccounts.slice(0, ACCOUNT_BAD_DISPLAY_LIMIT),
    badOverflow: Math.max(0, badAccounts.length - ACCOUNT_BAD_DISPLAY_LIMIT),
  }
}

// ─── 发布队列 ─────────────────────────────────────────────────
/**
 * @param {object} statusRes getQueueStatus 信封
 * @param {object} historyRes getQueueHistory 信封
 * @returns {{state:string, running:number, pending:number, failed:number, failedTitles:string[]}}
 */
export function toQueueStatusModel(statusRes, historyRes) {
  // 任意一个被门禁挡住即 auth：半套数据比没有数据更难解释
  const gate = gateOf(statusRes) || gateOf(historyRes)
  if (gate) return { state: gate, running: 0, pending: 0, failed: 0, failedTitles: [] }

  // 两路都必须成功：不允许"状态有了、历史没有"当成功渲染
  if (gateOf(statusRes) === ERROR || gateOf(historyRes) === ERROR) {
    return { state: ERROR, running: 0, pending: 0, failed: 0, failedTitles: [] }
  }

  const s = (statusRes && statusRes.data) || {}
  const running = num(s.running)
  const pending = num(s.pending)

  const history = Array.isArray(historyRes && historyRes.data) ? historyRes.data : []
  const failedRows = history.filter((r) => String((r && r.status) || '').toLowerCase() === 'failed')
  const failedTitles = failedRows
    .map((r) => String((r && (r.title || r.articleTitle)) || ''))
    .filter(Boolean)
    .slice(0, 3)

  // 「没有进行中的任务」是合法空态，但仍要显示最近失败——
  // 失败数是历史信息，不因当前队列为空而消失
  const state = running === 0 && pending === 0 ? EMPTY : READY
  return { state, running, pending, failed: failedRows.length, failedTitles }
}

// ─── 题材表现榜（full 专属） ────────────────────────────────────
const UNKNOWN_LABEL = '—'

/**
 * @param {object} res listPatternPerformance 信封
 * @param {number} [limit] Top N
 * @returns {{state:string, rows:Array<{value:string, score:number}>}}
 */
export function toPatternBoardModel(res, limit = 5) {
  const gate = gateOf(res)
  if (gate) return { state: gate, rows: [] }

  const items = (res.data && Array.isArray(res.data.items)) ? res.data.items : []
  if (items.length === 0) return { state: EMPTY, rows: [] }

  const rows = items
    .map((it) => ({
      value: String((it && it.value) || '').trim() || UNKNOWN_LABEL,
      score: num(it && it.engagement_score),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))

  return { state: READY, rows }
}
