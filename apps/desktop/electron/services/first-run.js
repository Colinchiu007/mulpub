// @ts-check
/**
 * 首次运行引导
 *
 * P2-E: 移除了 Playwright 浏览器检查逻辑。RpaViewManager 无需额外浏览器资源。
 */
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const log = require('./logger')

 
let _mainWin = null

function markerPath () {
  return path.join(app.getPath('userData'), 'first-run-done')
}

const MARKER_BODY_PREFIX = 'done:'

/**
 * QM-6 第二轮 i2：读侧只看 `existsSync` 把「已损坏的地基」读成「已完成」。
 *
 * i10 的临时名 + rename 只保证**今后**产出的标记是全量的；对**已经存在**的坏文件
 * （旧实现直写 `writeFileSync(最终名)` 在产线机器上被杀软占用/进程被杀留下的
 * 0 字节或半写文件，或任何第三方写入）毫无办法 —— 那种文件照样 `existsSync` 为真，
 * 于是向导对那批老用户永久消失、日志零痕迹，与本 PR 要修的自动收口**症状同形**。
 * 开通自动落标记后新用户行为改变、老用户大量存量 profile 携带旧写法的标记，
 * 这个迁移面必须被读侧接住。
 *
 * 三档而非布尔：`absent` / `done` / `corrupt` 必须可区分，
 * 否则「repair」与「首次落标记」在写侧不可分辨（日志与返回值都要能点名）。
 *
 * @returns {{state: 'absent'|'done'|'corrupt', reason?: string}}
 */
function readMarker (p) {
  let text
  try {
    if (!fs.existsSync(p)) return { state: 'absent' }
    text = fs.readFileSync(p, 'utf8')
  } catch (e) {
    // 读不动（权限/IO）也归 corrupt：「读不出来」不是「已完成」，但同样不是反证 ——
    // 判为 pending 让用户重看一次向导，代价远小于把永久跳过写进既成事实。
    return { state: 'corrupt', reason: 'read failed: ' + (e && e.message ? e.message : String(e)) }
  }
  if (typeof text === 'string' && text.startsWith(MARKER_BODY_PREFIX)) return { state: 'done' }
  return { state: 'corrupt', reason: text && text.length ? 'unrecognized body' : 'empty file' }
}

function isSetupDone () {
  const p = markerPath()
  const m = readMarker(p)
  if (m.state === 'corrupt') {
    log.warn('firstRun', `Setup marker unreadable (${m.reason}) - treating setup as pending; the wizard will show again`)
    return false
  }
  return m.state === 'done'
}

function reset () {
  const p = markerPath()
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

async function runSetup (mainWin) {
  _mainWin = mainWin

  // 这里是窗口创建路径，不是"用户完成了引导"的路径。
  // P2-E 之后本函数除落标记外什么都不做（浏览器检查已移除），
  // 于是它等于"应用替每个新用户写下已完成" ⇒ /first-run 向导对所有人永久不可达。
  // 标记的唯一写者改为 markDone()，只由向导上的显式动作触发。
  if (isSetupDone()) {
    mainWin.webContents.send('first-run:status', { type: 'done' })
    return
  }

  mainWin.webContents.send('first-run:status', { type: 'needed' })
  log.info('firstRun', 'Setup required: awaiting user completion')
}

/** 首启完成标记的唯一写者；已有**有效**内容时幂等（不追加时间戳），坏文件则原子重写 */
function markDone () {
  const p = markerPath()
  try {
    const before = readMarker(p)
    if (before.state === 'done') return { ok: true, reused: true }
    if (before.state === 'corrupt') {
      // 这一支是 i2 的落点：坏标记**不得**被当成"已完成所以幂等"——
      // 那会让用户点「完成」也修不好自己的标记。判 corrupt 后照常原子重写。
      log.warn('firstRun', `Setup marker invalid (${before.reason}) - rewriting it atomically instead of reusing`)
    }
    // QM-6 i10：原实现直接 `writeFileSync(p, ...)` —— 进程在写中途被杀会留下半写或 0 字节的
    // 最终名文件，而 isSetupDone() 只看 existsSync ⇒ 损坏标记被读成「已完成」，向导从此永久
    // 消失且日志里零痕迹（与 1.4 要修的自动收口同形，只是换了成因）。改为临时名 + rename：
    // 最终名要么不存在，要么是全量内容（POSIX 原子；Windows 在目标不存在时同样原子）。
    // 并发的第二个写者让 rename 失败时，那正是「别人已经落成」——如实报 reused，不做退避重试：
    // 这里没有覆盖语义，重试不改变结果（AGENTS「Windows 原子文件替换重试」只授权对
    // EPERM/EACCES/EBUSY 的覆盖型替换做有界退避，本路径不属该形态）。
    const tmp = p + '.tmp-' + process.pid
    try {
      fs.writeFileSync(tmp, `done:${new Date().toISOString()}`)
      fs.renameSync(tmp, p)
    } catch (writeError) {
      try { fs.unlinkSync(tmp) } catch (_) { /* 残留 tmp 不影响判据：真源是最终名 */ }
      if (readMarker(p).state === 'done') {
        log.info('firstRun', 'Setup complete (concurrent writer)')
        return { ok: true, reused: true }
      }
      throw writeError
    }
    log.info('firstRun', 'Setup complete')
    return { ok: true, reused: false, repaired: before.state === 'corrupt' }
  } catch (e) {
    log.error('firstRun', 'Setup error:', e.message)
    return { ok: false, message: e.message }
  }
}

function checkDeps () {
  return { setupDone: isSetupDone() }
}

module.exports = { isSetupDone, runSetup, markDone, reset, checkDeps }