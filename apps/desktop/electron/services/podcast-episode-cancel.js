'use strict'

/**
 * podcast-episode-cancel.js — 出期取消的主进程侧登记处（刀 3 第 3 片）
 *
 * ⛔ 这里存在的唯一理由，是 PRD §6.4 最初把取消写成「`cancelToken` 由渲染层持有引用」。
 * 那句话在 IPC 上不成立：`ipcRenderer.invoke` 走结构化克隆，`{ cancelled: false }` 到主进程
 * 就已经是一份**快照**，渲染层随后改的是自己手里那个对象，主进程读的是另一块内存。
 * 照原合同实现的后果是「取消」按钮点下去永远不起作用——不报错、不提示、界面上进度条照走，
 * 用户只能等它跑完。这与 AGENTS.md 记的「装饰性链路」同族（改名功能自引入起就是空操作那一类），
 * 差别只在于这次会在第一次真点就暴露，所以必须在接线时改掉合同而不是先落再修。
 *
 * 正确的形态是**两条通道 + 引用只在一侧**：
 *   发起 `podcast:episode:publishFromVideo`，载荷带 `runId`；主进程按 runId 登记 token 并把
 *   这个**真对象**交给编排层；
 *   取消 `podcast:episode:publish:cancel`，载荷带同一个 runId；主进程改的是同一个对象。
 * runId 由渲染层生成（它需要在发起前就知道能取消什么），主进程只判形态——不判形态等于
 * 让任意字符串成为 Map 的键，一条永不结束的发布就能把登记表越堆越大。
 *
 * `too_late` 不是拒绝，是**如实**：窗口关闭点（`uploadAudio`）之后取消会留下
 * 「对象存储有、feed 没有」的半态，比让它跑完更糟，所以界面必须拿到「为什么不能取消」。
 * 太晚时**不置位**：置了位就等于告诉编排层「用户不要这一期」，而它已经无法回滚，
 * 只会在下一个采样点读到一个既成事实。
 */

const CANCEL_ERRORS = {
  RUN_ID_INVALID: 'PODCAST_EPISODE_INVALID',
  TOO_LATE: 'PODCAST_CANCEL_TOO_LATE',
}

/** runId 形态：长度与字符集都收紧，避免把用户文本或路径片段当键（同一个键空间也用于临时目录名）。 */
const RUN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

const entries = new Map()

function cancelErr (code, message, extra) {
  const e = new Error(code + ': ' + message)
  e.code = code
  if (extra) Object.assign(e, extra)
  return e
}

/**
 * 登记一次发布，回一个**活的** token（编排层拿的就是这个对象本体）。
 * 初始相位取链的第一个相位而不是空串：空串会让 `cancellableAt('')` 判 false，
 * 于是「发起后、首个 mark 前」这一小段窗口在语义上变成「不能取消」，而那时其实零出站。
 * @param {string} runId
 * @param {{cancellableAt: (phase:string)=>boolean, initialPhase?: string}} options
 */
function begin (runId, options = {}) {
  const id = String(runId == null ? '' : runId).trim()
  if (!RUN_ID_RE.test(id)) throw cancelErr(CANCEL_ERRORS.RUN_ID_INVALID, 'runId 形态非法（长度 8–64，只允许字母数字与 _-）')
  if (entries.has(id)) throw cancelErr(CANCEL_ERRORS.RUN_ID_INVALID, '同一 runId 已有一次发布在飞，不得复用（复用会让取消打到别人的链上）')
  const cancellableAt = typeof options.cancellableAt === 'function' ? options.cancellableAt : () => false
  const token = { runId: id, cancelled: false, phase: String(options.initialPhase || ''), kill: null, cancellableAt }
  entries.set(id, token)
  return token
}

/** 编排层每推进一个相位就同步到这里——取消窗口与界面文案都由这一个值决定。 */
function setPhase (token, phase) {
  if (!token || !entries.has(token.runId)) return
  token.phase = String(phase || '')
}

/** 真实宿主接线后，在途子进程必须能被这个登记处杀掉（否则「取消」只是等它跑完）。 */
function setKill (token, kill) {
  if (!token || !entries.has(token.runId)) return
  token.kill = typeof kill === 'function' ? kill : null
}

function clearKill (token) {
  if (!token) return
  token.kill = null
}

/**
 * 只杀在途子进程，**不**置位 `cancelled`。
 * 这是给宿主超时用的：超时后链会以 EXTRACT_FAILED 收口，而如果顺手把 cancelled 也置了，
 * 同一个 token 上的下一次采样就会把「等太久」读成「用户不要了」，两件事在诊断里方向相反。
 */
function killRunning (token) {
  if (!token || !entries.has(token.runId)) return false
  try { if (typeof token.kill === 'function') { token.kill(); return true } } catch (_) { /* 杀不掉由超时自己报错 */ }
  return false
}

/**
 * @returns {{outcome:'accepted'|'too_late'|'unknown', phase:string}}
 * `unknown` 是「这次发布已经结束或从未登记」——不得把它读成「取消成功」，
 * 否则界面会说「已取消」而那一二期其实早已正常发布完成。
 */
function requestCancel (runId) {
  const id = String(runId == null ? '' : runId).trim()
  const token = entries.get(id)
  if (!token) return { outcome: 'unknown', phase: '' }
  if (!token.cancellableAt(token.phase)) return { outcome: 'too_late', phase: token.phase }
  token.cancelled = true
  try { if (typeof token.kill === 'function') token.kill() } catch (e) {
    // 杀不掉不改变「用户已取消」这一事实：链会在下一个采样点停下来
  }
  return { outcome: 'accepted', phase: token.phase }
}

/** 收尾必须成对：漏掉 end 就是内存里的一次永久泄漏，且第二次同 runId 发起会被「重复」拒掉。 */
function end (runId) {
  const id = String(runId == null ? '' : runId).trim()
  const token = entries.get(id)
  if (token) token.kill = null
  return entries.delete(id)
}

function size () { return entries.size }
function isRegistered (runId) { return entries.has(String(runId == null ? '' : runId).trim()) }

module.exports = {
  episodeCancelRegistry: { begin, setPhase, setKill, clearKill, killRunning, requestCancel, end, size, isRegistered },
  CANCEL_ERRORS,
  RUN_ID_RE,
}
