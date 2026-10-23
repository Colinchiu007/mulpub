// @ts-check
'use strict'
/**
 * kit-import — 影视工程资产导入的**编排层**（⓪–⑦ 换入顺序）
 *
 * 归属：PR-3b（F-J 资产导入写路径）· 方案 `pr3b-import-design.md` §二（换入顺序）
 *
 * 换入顺序（写死，逐段断言）：
 *   ⓪a 读锁判租约/判档 + 查上次残留（`.bak-*`）+ 查源/目标是否重叠
 *   ⓪b 严格校验源目录（`loadFilmKit({kitDir, requireAssets:true})`）
 *   ⓪c 审计文件可创建/可写    ⓪d 审计落「开始」行    ⓪e 预创建 `.import-lock`
 *   ① 置「导入中」标记（内存态；落盘态已在 ⓪e 建好）
 *   ② 两遍扫描 + 拷到 staging（**同步算副本哈希**并两条对账）→ staging 上**再跑一次**严格校验
 *   ③ 清 service 缓存（_kit/_loadError/_shotLibrary/_scriptAdapter）
 *   ④ rename 旧 film-kit → film-kit.bak-<ts>
 *   ⑤ rename staging → film-kit   ← 原子（同卷）
 *   ⑥ 删 film-kit.bak-<ts>
 *   ⑦ 删「导入中」标记（内存 + .import-lock）
 *
 * 失败语义（逐条来自方案）：
 *   - 任何一步失败 ⇒ **不碰旧 kit**（③④ 未执行时旧 kit 仍在原处）；
 *   - 回滚也失败 ⇒ `.bak` **保留不删** + 报错带恢复路径（i18n `filmKitImportRecover`）；
 *   - 换入前失败（② 阶段）⇒ 审计 `post_check=FAIL_WITH_RECOVERY` + `recovery_state=PRE_SWAP`；
 *   - staging **任何**情况下都按**精确清单**清（⛔ 不递归删目录 —— 本仓 R0 铁律）。
 */

const nodeFs = require('fs')
const nodePath = require('path')

const { scanKit } = require('./kit-import-scan')
const { createLock, readLockState, clearLock, heartbeat, HEARTBEAT_MS, LOCK_FILE } = require('./kit-import-lock')
const { AuditWriter, auditFilePathOf } = require('./kit-import-audit')
const {
  copyToStaging,
  cleanupStaging,
  swapIn,
  makeStamp,
  stagingName,
  KIT_DIR_NAME,
  STAGING_PREFIX,
  BAK_PREFIX,
  REASON: SWAP_REASON,
} = require('./kit-import-swap')

/** 失败原因（闭集见方案 §五；**唯一真源** —— IPC 层也引用这里，不另写字面量） */
const REASON = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_A_DIRECTORY: 'NOT_A_DIRECTORY',
  SOURCE_OVERLAPS_TARGET: 'SOURCE_OVERLAPS_TARGET',
  LOCK_CREATE_FAILED: 'LOCK_CREATE_FAILED',
  LOCK_HELD: 'LOCK_HELD',
  AUDIT_UNAVAILABLE: 'AUDIT_UNAVAILABLE',
  SWAP_FAILED: 'SWAP_FAILED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  PARENT_NOT_WRITABLE: 'PARENT_NOT_WRITABLE',
  CANCELLED: 'CANCELLED',
  /** sender 未通过授权硬断言（主框架 / 路由前缀 / 协议） */
  UNAUTHORIZED_SENDER: 'UNAUTHORIZED_SENDER',
})

/** 目标侧路径集合（用于「源/目标重叠」判定） */
function targetPathsOf (userDataDir) {
  return [
    nodePath.join(userDataDir, KIT_DIR_NAME),
    nodePath.join(userDataDir, STAGING_PREFIX),
    nodePath.join(userDataDir, BAK_PREFIX),
    nodePath.join(userDataDir, LOCK_FILE),
    auditFilePathOf(userDataDir),
  ]
}

/**
 * 源/目标重叠判定：**互为前缀关系即拒**（否则用户选中 `userData/film-kit` 自身或其父级时，
 * 会把目标拷进自己、或把目标 rename 走）。
 * @returns {{ok:boolean, message?:string}}
 */
function checkNoOverlap (sourceReal, userDataDir) {
  for (const t of targetPathsOf(userDataDir)) {
    const s = nodePath.resolve(sourceReal)
    const p = nodePath.resolve(t)
    if (s === p) return { ok: false, message: '源目录与目标路径相同: ' + p }
    if (s.startsWith(p + nodePath.sep)) return { ok: false, message: '源目录包含目标路径: ' + p }
    if (p.startsWith(s + nodePath.sep)) return { ok: false, message: '目标路径包含源目录: ' + p }
  }
  return { ok: true }
}

/** 列出残留的 `.bak-*` 目录名 */
function listBakDirs (fsImpl, userDataDir) {
  try {
    return fsImpl
      .readdirSync(userDataDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(BAK_PREFIX))
      .map((e) => e.name)
  } catch (_e) {
    return []
  }
}

/**
 * 导入主流程。
 * @param {object} opts
 * @param {string} opts.kitDir - **用户选定的源目录**
 * @param {string} opts.userDataDir - 目标 kit 的**父目录**（userData）
 * @param {object} [opts.service] - FilmEngineeringService（缓存失效 + 导入标记）
 * @param {(o:object)=>{ok:boolean, error?:string}} [opts.loadFilmKit] - 严格校验（注入便于测试）
 * @param {string} [opts.senderUrl] - 调用方 URL（审计）
 * @param {string} [opts.senderRoute] - 调用方 hash 路由（审计）
 * @param {string} [opts.triggerComponent] - 触发组件（审计；可空 ⇒ `-`）
 * @param {object} [opts.fs]
 * @returns {Promise<{ok:boolean, reason?:string, message?:string, recoveryPath?:string, stats?:object}>}
 */
async function importKit (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const userDataDir = o.userDataDir
  const sourceDir = o.kitDir
  const now = o.now || (() => Date.now())
  const audit = new AuditWriter({ userDataDir, fs: fsImpl, now })
  const service = o.service || null

  const fail = (reason, message, extra) => {
    const res = Object.assign({ ok: false, reason, message }, extra || {})
    audit.append({
      time: new Date(now()).toISOString(),
      senderUrl: o.senderUrl,
      senderRoute: o.senderRoute,
      triggerComponent: o.triggerComponent,
      sourceDir,
      result: 'failed',
      reason,
      postCheck: null,
      recoveryState: (extra && extra.recoveryState) || null,
      recoveryPath: (extra && extra.recoveryPath) || null,
    })
    return res
  }

  // ── ⓪a：残留 + 重叠 ─────────────────────────────────────────────
  const lockState = readLockState({ fs: fsImpl, userDataDir, now: now() })
  if (lockState.exists) {
    if (lockState.leaseValid) {
      return fail(REASON.LOCK_HELD, '有导入正在进行（租约有效）')
    }
    if (lockState.parseError) {
      return fail(REASON.LOCK_HELD, '锁内容不可解析，不清锁')
    }
    // 租约已过期 ⇒ 可清锁（owner 已死 ⇒ 不会永久卡死）
    const cleared = clearLock({ fs: fsImpl, userDataDir, now: now() })
    if (!cleared.ok) {
      return fail(REASON.LOCK_HELD, '清理过期锁失败: ' + String(cleared.message))
    }
  }
  const bakDirs = listBakDirs(fsImpl, userDataDir)
  if (bakDirs.length > 0) {
    const kitDir = nodePath.join(userDataDir, KIT_DIR_NAME)
    const kitExists = fsImpl.existsSync(kitDir)
    if (!kitExists) {
      // 档位①：旧资产还在 limbo ⇒ 拒绝导入（否则用户会误以为旧资产没了）
      return fail(REASON.VALIDATION_ERROR, '上次导入残留未恢复（film-kit 缺失、.bak 仍在），请先手动恢复', {
        recoveryPath: nodePath.join(userDataDir, bakDirs[0]),
        recoveryState: 'MISSING_KIT',
      })
    }
  }
  let sourceReal
  try {
    sourceReal = fsImpl.realpathSync(sourceDir)
  } catch (e) {
    return fail(REASON.NOT_A_DIRECTORY, '源目录不可读: ' + String(e && e.message))
  }
  const overlap = checkNoOverlap(sourceReal, userDataDir)
  if (!overlap.ok) {
    return fail(REASON.SOURCE_OVERLAPS_TARGET, overlap.message)
  }

  // ── ⓪b：严格校验源目录 ─────────────────────────────────────────
  const loadFilmKit = o.loadFilmKit
  if (typeof loadFilmKit !== 'function') {
    return fail(REASON.VALIDATION_ERROR, '缺少严格校验实现')
  }
  const strict = loadFilmKit({ kitDir: sourceDir, requireAssets: true })
  if (!strict || !strict.ok) {
    return fail(REASON.VALIDATION_ERROR, '源目录严格校验失败: ' + String(strict && strict.error))
  }

  // ── ⓪c/⓪d：审计可写 + 落「开始」行 ───────────────────────────
  const pre = audit.precheck()
  if (!pre.ok) {
    return { ok: false, reason: REASON.AUDIT_UNAVAILABLE, message: pre.message }
  }
  audit.countLines()
  const startRow = audit.append({
    time: new Date(now()).toISOString(),
    senderUrl: o.senderUrl,
    senderRoute: o.senderRoute,
    triggerComponent: o.triggerComponent,
    sourceDir,
    result: 'start',
    reason: null,
    postCheck: null,
    recoveryState: null,
    recoveryPath: null,
  })
  if (!startRow.ok) {
    return { ok: false, reason: REASON.AUDIT_UNAVAILABLE, message: startRow.message }
  }

  // ── ⓪e：预创建锁 ─────────────────────────────────────────────
  const lock = createLock({ fs: fsImpl, userDataDir, senderUrl: o.senderUrl, now: now() })
  if (!lock.ok) {
    return fail(REASON.LOCK_CREATE_FAILED, lock.message)
  }

  // ── ①：置「导入中」标记（内存态）──────────────────────────────
  if (service && typeof service.setImportInProgress === 'function') {
    service.setImportInProgress(true)
  }
  const timer = setInterval(() => {
    heartbeat({ fs: fsImpl, userDataDir, nonce: lock.nonce, now: now() })
  }, HEARTBEAT_MS)
  if (timer && typeof timer.unref === 'function') timer.unref()

  const stamp = makeStamp(now())
  const stagingDir = nodePath.join(userDataDir, stagingName(stamp))
  let firstPassFiles = []
  let swapped = false

  try {
    // ── ②：第一遍扫描（一个字节都不写）──────────────────────────
    const scan = await scanKit({ kitDir: sourceDir, fs: fsImpl })
    if (!scan.ok) {
      return fail(scan.reason || REASON.VALIDATION_ERROR, scan.message, { recoveryState: 'PRE_SWAP' })
    }
    firstPassFiles = scan.files.map((f) => f.relPath)

    // ── ②：第二遍拷贝 + 两条对账 ────────────────────────────────
    const copy = await copyToStaging({
      files: scan.files,
      firstPassStats: scan.firstPassStats,
      stagingDir,
      fs: fsImpl,
    })
    if (!copy.ok) {
      return fail(copy.reason || REASON.VALIDATION_ERROR, copy.message, { recoveryState: 'PRE_SWAP' })
    }

    // ── ②：staging 上再跑一次严格校验 ───────────────────────────
    const strict2 = loadFilmKit({ kitDir: stagingDir, requireAssets: true })
    if (!strict2 || !strict2.ok) {
      return fail(REASON.VALIDATION_ERROR, 'staging 严格校验失败: ' + String(strict2 && strict2.error), {
        recoveryState: 'PRE_SWAP',
      })
    }

    // ── ③：清 service 缓存 ──────────────────────────────────────
    if (service && typeof service.invalidateKitCache === 'function') {
      service.invalidateKitCache()
    }

    // ── ④⑤⑥：目录级换入 ────────────────────────────────────────
    const swap = await swapIn({ fs: fsImpl, userDataDir, stagingDir, stamp })
    if (!swap.ok) {
      const extra = {}
      if (swap.reason === SWAP_REASON.ROLLBACK_FAILED && swap.bakPath) {
        extra.recoveryPath = swap.bakPath
        extra.recoveryState = 'BAK_LEFT'
      }
      return fail(swap.reason || REASON.SWAP_FAILED, swap.message, extra)
    }
    swapped = true

    // ── ⑦：删标记（内存 + 锁）──────────────────────────────────
    if (service && typeof service.setImportInProgress === 'function') {
      service.setImportInProgress(false)
    }
    clearLock({ fs: fsImpl, userDataDir, expectNonce: lock.nonce, now: now() })

    // 审计成功行
    audit.append({
      time: new Date(now()).toISOString(),
      senderUrl: o.senderUrl,
      senderRoute: o.senderRoute,
      triggerComponent: o.triggerComponent,
      sourceDir,
      result: 'ok',
      reason: null,
      postCheck: 'PASS',
      recoveryState: null,
      recoveryPath: null,
    })
    return { ok: true, stats: { fileCount: firstPassFiles.length, totalBytes: scan.totalBytes } }
  } finally {
    clearInterval(timer)
    if (!swapped && fsImpl.existsSync(stagingDir)) {
      // ⛔ 精确清单清理（不递归删目录 —— 本仓 R0 铁律）
      await cleanupStaging({ stagingDir, fileList: firstPassFiles, fs: fsImpl })
    }
    if (service && typeof service.setImportInProgress === 'function' && !swapped) {
      service.setImportInProgress(false)
    }
    if (!swapped) {
      clearLock({ fs: fsImpl, userDataDir, expectNonce: lock.nonce, now: now() })
    }
  }
}

module.exports = {
  REASON,
  importKit,
  checkNoOverlap,
  targetPathsOf,
  listBakDirs,
}
