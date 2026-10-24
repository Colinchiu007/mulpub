// @ts-check
'use strict'
/**
 * kit-import-swap — 第二遍拷贝（哈希对账）、目录级换入、回滚与**精确清单清理**
 *
 * 归属：PR-3b（F-J 资产导入写路径）· 方案 `pr3b-import-design.md` §二 / §三 S3/S4/S6/S19
 *
 * 关键不变量（逐条来自方案）：
 *   - **两条对账**（S6）：① 副本 SHA-256 == 第一遍记录的源 SHA-256；
 *                         ② 拷贝完成后**再次 `stat` 源文件**，`(dev,ino,size,mtime)` 与第一遍记录一致
 *                         ⇒ 挡住「原地改内容（同尺寸）」与「拷贝过程中被改」两类 TOCTOU；
 *     ⚠ **不比副本的 inode**（副本 inode 必然不同于源，比了会恒假、把所有导入全拒）。
 *   - **目录级换入**（同卷 rename 原子）：旧 kit → `film-kit.bak-<ts>` → staging → `film-kit` → 删 `.bak`；
 *     `<ts>` = **毫秒精度 ISO 时间戳 + 4 位随机后缀** ⇒ 每次尝试的名字唯一 ⇒ 绝不撞名、无 `EEXIST`。
 *   - **回滚**（S4）：④ 失败 ⇒ `.bak` 改回 `film-kit`；**回滚也失败 ⇒ `.bak` 保留不删** + 报错带恢复路径。
 *   - ⛔ **禁止递归删除目录**（本仓 **R0 铁律**：目录删除一律拒绝、`safe-delete.js` 不接目录）：
 *     清理 = **按精确清单逐个 `unlink`**（清单 = 第一遍枚举结果，不动态重扫）⇒ 再**按深度从深到浅
 *     逐个 `rmdir` 空目录**（含 `prompts/tasks/<task>/<lang>` 这类嵌套空目录）⇒ 根目录最后删。
 *   - `ERROR_ACCESS_DENIED` 分级重试（S19）：A 类（文件 copyFile）套指数退避；
 *     B 类（目录 rename）只做**一次立即重试**（NTFS 占用常不可重试）；审计追加不重试。
 */

const nodeFs = require('fs')
const nodePath = require('path')
const nodeCrypto = require('crypto')

const { manifestFromFileList, collectTreeManifest, removeTreeByManifest } = require('./kit-tree-clean')

/** 重试常量（§三 S19；数值只在代码里存在一次） */
const RETRY_MAX = 3
const RETRY_MS = 500

/** 失败原因（闭集见方案 §五） */
const REASON = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SWAP_FAILED: 'SWAP_FAILED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  PARENT_NOT_WRITABLE: 'PARENT_NOT_WRITABLE',
})

/** 目标 kit 目录名 */
const KIT_DIR_NAME = 'film-kit'
/** staging 前缀 */
const STAGING_PREFIX = 'film-kit.staging-'
/** 备份前缀 */
const BAK_PREFIX = 'film-kit.bak-'

/** 毫秒精度 ISO 时间戳 + 4 位随机后缀（保证每次尝试唯一） */
function makeStamp (now, rand) {
  const iso = new Date(now == null ? Date.now() : now).toISOString().replace(/[:.]/g, '-')
  const suffix = rand || Math.random().toString(36).slice(2, 6)
  return iso + '-' + suffix
}

/** staging 目录名 */
function stagingName (stamp) {
  return STAGING_PREFIX + stamp
}

/** 备份目录名 */
function bakName (stamp) {
  return BAK_PREFIX + stamp
}

/** 让出事件循环（心跳不得被拷贝饿死 —— S18） */
function yieldToLoop () {
  return new Promise((resolve) => setImmediate(resolve))
}

/** 是否是「访问被占用」类错误（可重试） */
function isAccessDenied (e) {
  const code = e && e.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

/**
 * A 类重试（文件拷贝）：指数退避 `RETRY_MS * 2^(n-1)`。
 * @param {() => Promise<any>} fn
 */
async function retryCopy (fn) {
  let lastErr = null
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isAccessDenied(e)) break
      if (attempt < RETRY_MAX - 1) {
        await new Promise((r) => setTimeout(r, RETRY_MS * Math.pow(2, attempt)))
      }
    }
  }
  throw lastErr
}

/**
 * B 类重试（目录 rename）：**只做一次立即重试**（NTFS 占用常不可重试 ⇒ 不套退避循环）。
 * @param {() => Promise<any>} fn
 */
async function retryRenameOnce (fn) {
  try {
    return await fn()
  } catch (e) {
    if (!isAccessDenied(e)) throw e
    return fn()
  }
}

/** 默认哈希实现（SHA-256） */
function defaultHashFile (fsImpl, absPath) {
  return new Promise((resolve, reject) => {
    const h = nodeCrypto.createHash('sha256')
    const stream = fsImpl.createReadStream(absPath)
    stream.on('error', reject)
    stream.on('data', (chunk) => h.update(chunk))
    stream.on('end', () => resolve(h.digest('hex')))
  })
}

/**
 * 第二遍：拷到 staging + 两条对账。
 * @param {object} opts
 * @param {Array} opts.files - 第一遍产出的候选（relPath/absPath）
 * @param {object} opts.firstPassStats - 第一遍记录
 * @param {string} opts.stagingDir
 * @returns {Promise<{ok:boolean, reason?:string, message?:string, copied?:string[]}>}
 */
async function copyToStaging (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const hashFile = o.hashFile || defaultHashFile
  const firstPassStats = o.firstPassStats || {}
  const copied = []

  try {
    await fsImpl.promises.mkdir(o.stagingDir, { recursive: true })
  } catch (e) {
    return { ok: false, reason: REASON.PARENT_NOT_WRITABLE, message: '建 staging 失败: ' + String(e && e.message) }
  }

  for (const f of o.files || []) {
    await yieldToLoop()
    const rel = f.relPath
    const dst = nodePath.join(o.stagingDir, rel)
    try {
      await fsImpl.promises.mkdir(nodePath.dirname(dst), { recursive: true })
    } catch (_e) {
      return { ok: false, reason: REASON.PARENT_NOT_WRITABLE, message: '建目录失败: ' + rel }
    }
    try {
      await retryCopy(() => fsImpl.promises.copyFile(f.absPath, dst))
    } catch (e) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '拷贝失败: ' + rel + ' · ' + String(e && e.message) }
    }
    // ① 副本哈希 == 源哈希
    let copyHash
    try {
      copyHash = await hashFile(fsImpl, dst)
    } catch (_e) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '副本哈希失败: ' + rel }
    }
    const src = firstPassStats[rel]
    if (!src) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '缺少第一遍记录: ' + rel }
    }
    if (copyHash !== src.sha256) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '副本哈希与源不一致: ' + rel }
    }
    // ② 拷贝完成后再次 stat 源文件：(dev,ino,size,mtime) 与第一遍一致
    let st
    try {
      st = await fsImpl.promises.stat(f.absPath)
    } catch (_e) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '源文件 stat 失败: ' + rel }
    }
    if (st.dev !== src.dev || st.ino !== src.ino || st.size !== src.size || st.mtimeMs !== src.mtimeMs) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '源文件在拷贝期间被改动: ' + rel }
    }
    copied.push(rel)
  }
  return { ok: true, copied }
}

/**
 * 精确清单清理（⛔ **不递归删除目录** —— 本仓 R0 铁律）。
 * @param {object} opts
 * @param {string} opts.stagingDir
 * @param {string[]} opts.fileList - 第一遍枚举结果（相对路径清单；不动态重扫）
 * @returns {{ok:boolean, removedFiles:number, removedDirs:number}}
 */
async function cleanupStaging (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const manifest = manifestFromFileList(o.fileList || [])
  const res = await removeTreeByManifest({ rootDir: o.stagingDir, manifest, fs: fsImpl })
  return { ok: res.ok, removedFiles: res.removedFiles, removedDirs: res.removedDirs, message: res.message }
}

/**
 * 目录级换入（④⑤⑥）：旧 kit → `.bak-<stamp>` → staging → `film-kit` → 删 `.bak`。
 * @returns {{ok:boolean, reason?:string, message?:string, bakPath?:string}}
 */
async function swapIn (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const userDataDir = o.userDataDir
  const stagingDir = o.stagingDir
  const kitDir = nodePath.join(userDataDir, KIT_DIR_NAME)
  const bakDir = nodePath.join(userDataDir, bakName(o.stamp))
  let bakCreated = false

  // ④ 旧 kit → .bak（存在才搬）
  let hasOld
  try {
    hasOld = fsImpl.existsSync(kitDir)
  } catch (_e) {
    hasOld = false
  }
  if (hasOld) {
    try {
      await retryRenameOnce(() => fsImpl.promises.rename(kitDir, bakDir))
      bakCreated = true
    } catch (e) {
      return { ok: false, reason: REASON.SWAP_FAILED, message: '旧 kit 改名失败: ' + String(e && e.message) }
    }
  }

  // ⑤ staging → film-kit
  try {
    await retryRenameOnce(() => fsImpl.promises.rename(stagingDir, kitDir))
  } catch (e) {
    // 回滚：.bak 改回 film-kit
    if (bakCreated) {
      try {
        await retryRenameOnce(() => fsImpl.promises.rename(bakDir, kitDir))
        return { ok: false, reason: REASON.SWAP_FAILED, message: '换入失败且已回滚: ' + String(e && e.message) }
      } catch (_e2) {
        return {
          ok: false,
          reason: REASON.ROLLBACK_FAILED,
          message: '换入失败且回滚失败，旧资产在: ' + bakDir,
          bakPath: bakDir,
        }
      }
    }
    return { ok: false, reason: REASON.SWAP_FAILED, message: '换入失败: ' + String(e && e.message) }
  }

  // ⑥ 删 .bak（成功路径：立即删；失败不阻塞生效 ⇒ 留 `BAK_LEFT` 残留档位）
  // ⚠ **不递归删目录**（本仓 R0 铁律）：初版这里写的是
  //   `fs.promises.rm(bakDir, {recursive:true, force:true})` ⇒ 一行就违反铁律
  //   （2026-10-23 验证层外部评审 codex i2 命中）⇒ 改为「自己走一遍树拿精确清单
  //   → 逐个 unlink → 自底向上 rmdir」。
  if (bakCreated) {
    const manifest = await collectTreeManifest(bakDir, fsImpl)
    if (!manifest.ok) {
      return {
        ok: true,
        bakPath: bakDir,
        recoveryState: 'BAK_LEFT',
        message: '旧备份未清（' + manifest.message + '），不影响生效',
      }
    }
    const rm = await removeTreeByManifest({ rootDir: bakDir, manifest, fs: fsImpl })
    if (!rm.ok) {
      return {
        ok: true,
        bakPath: bakDir,
        recoveryState: 'BAK_LEFT',
        message: '旧备份未删（' + rm.message + '），不影响生效',
      }
    }
  }
  return { ok: true }
}

/**
 * 回滚：把 `.bak` 改回 `film-kit`（仅在 `film-kit` 不存在时）。
 * @returns {{ok:boolean, reason?:string, message?:string}}
 */
async function rollbackToBak (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const kitDir = nodePath.join(o.userDataDir, KIT_DIR_NAME)
  const bakDir = o.bakPath
  try {
    if (fsImpl.existsSync(kitDir)) {
      return { ok: false, reason: REASON.ROLLBACK_FAILED, message: '目标已存在，不回滚' }
    }
    await retryRenameOnce(() => fsImpl.promises.rename(bakDir, kitDir))
    return { ok: true }
  } catch (_e) {
    return { ok: false, reason: REASON.ROLLBACK_FAILED, message: '回滚失败，旧资产在: ' + bakDir }
  }
}

module.exports = {
  RETRY_MAX,
  RETRY_MS,
  REASON,
  KIT_DIR_NAME,
  STAGING_PREFIX,
  BAK_PREFIX,
  makeStamp,
  stagingName,
  bakName,
  copyToStaging,
  cleanupStaging,
  swapIn,
  rollbackToBak,
}
