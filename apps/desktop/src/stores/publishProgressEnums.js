/**
 * publishProgressEnums.js — 发布进度 store 的枚举与纯工具（从 stores/publishProgress.js 拆出）
 *
 * 为什么拆：store 主体要留在 500 行门禁以内（check-max-lines 的正规解法是按既有 composable 范式拆分，
 * 不是抬阈值）。这三样东西与 Pinia 状态无耦合，且**相位枚举必须保持单一真源**：
 * TERMINAL_PHASES 由 PHASE_ENUM 派生（并列维护两份是评审 FE2 点名的形态），所以连注释一起搬，不留在原地抄一份。
 *
 * 行为合同不变：`store PHASE_ENUM ⊇ emitter PHASE_ENUM` 由 publishProgress.test.js 从**行为**反推
 * （captcha 事件不得被归一成 progress），它不读源文件形状，故搬家不需要改测试。
 */

/** cancelled（publish-progress-panel-refine）：取消终态——主进程 phase4-events
 * 转发 TaskQueue 的 task:cancelled；中性态（非失败红态），计入终态与 aggregate。 */
// PRD-OSS-RPA-HARDENING（2026-10-14）：新增 captcha 相位（验证码旁路，F4）。
// 枚举是唯一真源：TERMINAL_PHASES 从本集合派生（评审 FE2：禁并列维护两份）。
const PHASE_ENUM = new Set(['start', 'progress', 'success', 'failed', 'retry', 'blocked', 'released', 'cancelled', 'captcha'])
// 派生而非并列：新增相位只需改 PHASE_ENUM 一处（测试锁 emitter/store 双侧一致）
const TERMINAL_PHASES = new Set(Array.from(PHASE_ENUM).filter((p) => ['success', 'failed', 'cancelled'].includes(p)))
const STAGE_KEY_ENUM = new Set([
  'prepare', 'upload', 'fill', 'submit', 'verify', 'waiting', 'released', 'done', 'failed', 'detail',
])

let _sessionCounter = 0

function newSessionId() {
  _sessionCounter += 1
  return 's_' + _sessionCounter + '_' + Date.now()
}

function normalizePercent(value) {
  if (value === null || value === undefined) return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0 || num > 100) return null
  return num
}

function nowTimeString() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export { PHASE_ENUM, TERMINAL_PHASES, STAGE_KEY_ENUM, newSessionId, normalizePercent, nowTimeString }
