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

/** 目标侧的**精确**路径（文件或目录） */
function targetPathsOf (userDataDir) {
  return [
    nodePath.join(userDataDir, KIT_DIR_NAME),
    nodePath.join(userDataDir, LOCK_FILE),
    auditFilePathOf(userDataDir),
  ]
}

/** 目标侧的**前缀**目录名（staging / `.bak` 的名字带时间戳 ⇒ 只能按前缀比） */
const TARGET_DIR_PREFIXES = Object.freeze([STAGING_PREFIX, BAK_PREFIX])

/**
 * 路径比较用的**大小写口径**：Windows 上文件系统大小写不敏感 ⇒ 比较也必须不敏感，
 * 否则 `D:/Data` 与 `d:/data` 会被判成两个目录 ⇒ 重叠判据直接失效。
 * （2026-10-23 验证层外部评审 codex i5 命中）
 */
function pathKey (p) {
  const s = nodePath.resolve(String(p))
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/** `child` 是否在 `parent` 之内（严格子孙，不含相等） */
function isUnder (child, parent) {
  const c = pathKey(child)
  const p = pathKey(parent)
  if (c === p) return false
  return c.startsWith(p.endsWith(nodePath.sep) ? p : p + nodePath.sep)
}

/**
 * 源/目标重叠判定：**互为前缀关系即拒**（否则用户选中 `userData/film-kit` 自身或其父级时，
 * 会把目标拷进自己、或把目标 rename 走）。
 *
 * ⚠ 目标集分两类（2026-10-23 验证层外部评审 codex i5 修）：
 *   ① **精确路径**：`film-kit` / `.import-lock` / 审计日志文件；
 *   ② **前缀目录名**：`film-kit.staging-*` / `film-kit.bak-*`（名字带时间戳 ⇒
 *      拼成字面路径再比前缀**永远不匹配** ⇒ 初版这两条判据是死的）。
 * ⚠ 目标侧（`userDataDir`）也要 **realpath**：AppData 路径里可能有 junction / 8.3 短名
 *   ⇒ 同一个目录会被判成两个 ⇒ 重叠判据直接失效（用户可以把目标目录自身当源目录导入）。
 * @returns {{ok:boolean, message?:string}}
 */
function checkNoOverlap (sourceReal, userDataDir, fsImpl) {
  const fsx = fsImpl || nodeFs
  let realUserData = userDataDir
  try {
    realUserData = fsx.realpathSync(userDataDir)
  } catch (_e) { /* 读不到 ⇒ 用原值（后续比较仍成立，只是少了 junction 归一） */ }
  const s = nodePath.resolve(sourceReal)
  for (const t of targetPathsOf(realUserData)) {
    const p = nodePath.resolve(t)
    if (pathKey(s) === pathKey(p)) return { ok: false, message: '源目录与目标路径相同: ' + p }
    if (isUnder(p, s)) return { ok: false, message: '目标路径包含源目录: ' + p }
    if (isUnder(s, p)) return { ok: false, message: '源目录包含目标路径: ' + p }
  }
  // 前缀目录：源目录**本身**是 staging/.bak（或其子目录）⇒ 拒
  const parent = nodePath.dirname(s)
  const base = nodePath.basename(s)
  if (pathKey(parent) === pathKey(realUserData)) {
    for (const pre of TARGET_DIR_PREFIXES) {
      if (base.startsWith(pre)) {
        return { ok: false, message: '源目录是导入残留目录: ' + s }
      }
    }
  }
  for (const pre of TARGET_DIR_PREFIXES) {
    const p = nodePath.resolve(nodePath.join(realUserData, pre))
    if (isUnder(s, p)) return { ok: false, message: '源目录位于导入残留目录内: ' + p }
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
    const row = audit.append({
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
    // ⚠ **失败路径**的审计行写失败同样必须显式上报
    //   （2026-10-23 验证层外部评审 claude i1 / codex i6：初版只查了成功路径的返回值，
    //    失败路径的 `audit.append()` 返回值被**丢弃** ⇒ 「这次失败连审计都没留下」被静默）。
    if (!row.ok) {
      res.auditWritten = false
      res.auditMessage = row.message || '审计写入失败'
    }
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
  const overlap = checkNoOverlap(sourceReal, userDataDir, fsImpl)
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
  /** 心跳失败 ⇒ 锁已不属于自己（被清或被接管）⇒ 换入前必须中止 */
  let lockLost = false
  const timer = setInterval(() => {
    const ok = heartbeat({ fs: fsImpl, userDataDir, nonce: lock.nonce, now: now() })
    if (!ok) lockLost = true
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
    // ⚠ **换入前复核锁**（2026-10-23 验证层外部评审 codex i2）：
    //   ② 阶段可能跑很久（几百 MB 拷贝 + 逐文件哈希）⇒ 期间租约若过期，
    //   另一个进程会按「租约已过期 ⇒ owner 已死」清锁并开始自己的导入
    //   ⇒ **两个进程同时对 `film-kit` 做破坏性 rename**。
    //   ⇒ 换入前必须确认「锁还在、且 nonce 还是我这份」，否则**中止**（旧 kit 未动）。
    if (lockLost) {
      return fail(REASON.LOCK_HELD, '导入锁心跳已失败（锁被他人接管），为避免并发换入已中止')
    }
    const lockNow = readLockState({ fs: fsImpl, userDataDir, now: now() })
    if (!lockNow.exists || lockNow.nonce !== lock.nonce) {
      return fail(REASON.LOCK_HELD, '导入锁已不存在或已被他人接管，为避免并发换入已中止')
    }
    const swap = await swapIn({ fs: fsImpl, userDataDir, stagingDir, stamp })
    if (!swap.ok) {
      const extra = {}
      if (swap.reason === SWAP_REASON.ROLLBACK_FAILED && swap.bakPath) {
        extra.recoveryPath = swap.bakPath
        // ⚠ 档位更正（2026-10-23 验证层外部评审 codex i6 + 自查交叉核对）：
        //   回滚失败 ⇒ **film-kit 缺失、`.bak` = 旧 kit** ⇒ 恢复动作是
        //   「把 `.bak` 改名回 film-kit」⇒ 档位是 `MISSING_KIT`，**不是** `BAK_LEFT`。
        //   初版标成 `BAK_LEFT` ⇒ 渲染端会显示「可安全删除 .bak」——
        //   那会让用户**删掉旧资产仅存的一份**（数据丢失级误导）。
        extra.recoveryState = 'MISSING_KIT'
      }
      return fail(swap.reason || REASON.SWAP_FAILED, swap.message, extra)
    }
    swapped = true

    // ── ⑦：删标记（内存 + 锁）──────────────────────────────────
    if (service && typeof service.setImportInProgress === 'function') {
      service.setImportInProgress(false)
    }
    // 删锁失败 ⇒ 留 `LOCK_LEFT` 残留档位（资产已就位，只剩锁）
    const lockCleared = clearLock({ fs: fsImpl, userDataDir, expectNonce: lock.nonce, now: now() })
    const residue = {}
    if (!lockCleared.ok) {
      residue.recoveryState = 'LOCK_LEFT'
      residue.recoveryPath = nodePath.join(userDataDir, LOCK_FILE)
    }
    // 删 `.bak` 失败 ⇒ 留 `BAK_LEFT` 残留档位（film-kit = 新的、.bak = 旧 kit）
    if (swap.recoveryState === 'BAK_LEFT' && swap.bakPath) {
      if (!residue.recoveryState) residue.recoveryState = 'BAK_LEFT'
      residue.recoveryPath = swap.bakPath
    }

    // 审计成功行（**结果行写失败必须显式上报**，不能静默丢）
    const okRow = audit.append({
      time: new Date(now()).toISOString(),
      senderUrl: o.senderUrl,
      senderRoute: o.senderRoute,
      triggerComponent: o.triggerComponent,
      sourceDir,
      result: 'ok',
      reason: null,
      postCheck: residue.recoveryState ? 'FAIL_WITH_RECOVERY' : 'PASS',
      recoveryState: residue.recoveryState || null,
      recoveryPath: residue.recoveryPath || null,
    })
    const res = {
      ok: true,
      stats: { fileCount: firstPassFiles.length, totalBytes: scan.totalBytes },
    }
    if (residue.recoveryState) {
      res.recoveryState = residue.recoveryState
      res.recoveryPath = residue.recoveryPath || null
    }
    if (!okRow.ok) {
      // 导入**已生效**，但结果行没落盘 ⇒ 必须让用户知道「审计不完整」（不静默）
      res.auditWritten = false
      res.auditMessage = okRow.message || '审计结果行写入失败'
    }
    return res
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
