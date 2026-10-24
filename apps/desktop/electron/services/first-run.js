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

function isSetupDone () {
  return fs.existsSync(path.join(app.getPath('userData'), 'first-run-done'))
}

function reset () {
  const p = path.join(app.getPath('userData'), 'first-run-done')
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

/** 首启完成标记的唯一写者；重复调用幂等（已有内容原样保留，不追加时间戳） */
function markDone () {
  const p = path.join(app.getPath('userData'), 'first-run-done')
  try {
    if (fs.existsSync(p)) return { ok: true, reused: true }
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
      if (fs.existsSync(p)) {
        log.info('firstRun', 'Setup complete (concurrent writer)')
        return { ok: true, reused: true }
      }
      throw writeError
    }
    log.info('firstRun', 'Setup complete')
    return { ok: true, reused: false }
  } catch (e) {
    log.error('firstRun', 'Setup error:', e.message)
    return { ok: false, message: e.message }
  }
}

function checkDeps () {
  return { setupDone: isSetupDone() }
}

module.exports = { isSetupDone, runSetup, markDone, reset, checkDeps }