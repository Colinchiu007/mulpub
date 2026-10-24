// @ts-check
'use strict'
/**
 * kit-tree-clean — **按精确清单删除一棵目录树**（⛔ 本仓 **R0 铁律**）
 *
 * 归属：PR-3b（F-J 资产导入写路径）· 方案 `pr3b-import-design.md` §三 S19 / §十 附录
 *
 * 为什么单独成文件：删除原语是本仓**事故高发面**（2026-10-07 单日 5 次误删 `.ccg/`），
 *   它的正确性必须**只有一份实现**、且能被单独审。放在 `kit-import-swap.js` 里
 *   会被换入/回滚逻辑淹没。
 *
 * ⛔ **铁律**：**禁止递归删除目录**。
 *   `fs.rm(dir, {recursive:true})` / `fs.rmdir(dir, {recursive:true})` / `rm -rf` 一律不用 ——
 *   它们把「目录里的东西」放大成「整个目录」，一次误判就抹掉用户资产。
 *   本模块只用两支原语：
 *     ① **逐个 `unlink`**（文件；符号链接/联接点按叶子处理，`unlink` 失败则 `rmdir`）；
 *     ② **逐个 `rmdir`**（**空**目录，按深度**从深到浅**）。
 *   目录只有在**它自己确认已空**时才会被删（`rmdir` 对非空目录直接 ENOTEMPTY）。
 *
 * **清单从哪来**（两条来源，都不依赖“递归删除”）：
 *   - `manifestFromFileList(fileList)`：用**第一遍枚举**得到的相对路径清单（staging 用 ——
 *     清单与实际写入一一对应，删除时**不重扫**，避免「扫到别的东西」）；
 *   - `collectTreeManifest(rootDir)`：**自己走一遍**目录树（`.bak` 用 —— 旧 kit 里可能有
 *     白名单外的文件如 `images/`，必须先看清再删），**不跟随符号链接/联接点**。
 */

const nodeFs = require('fs')
const nodePath = require('path')

/** 相对路径统一用 posix 分隔（清单与断言的稳定形态） */
function toPosix (p) {
  return String(p).replace(/\\/g, '/')
}

/**
 * 由**文件相对路径清单**推出目录清单（自底向上的删除顺序由调用方排）。
 * @param {string[]} fileList - 相对路径清单（相对根）
 * @returns {{files:string[], dirs:string[]}}
 */
function manifestFromFileList (fileList) {
  const files = []
  const dirs = new Set()
  for (const rel of fileList || []) {
    const norm = toPosix(rel)
    files.push(norm)
    const parts = nodePath.posix.dirname(norm).split('/').filter(Boolean)
    let acc = []
    for (const p of parts) {
      acc = acc.concat([p])
      dirs.add(acc.join('/'))
    }
  }
  return { files, dirs: Array.from(dirs) }
}

/**
 * 走一遍目录树，收集**精确清单**（不跟随符号链接/联接点 ⇒ 它们按叶子处理）。
 * @param {string} rootDir
 * @param {object} [fsImpl]
 * @returns {Promise<{ok:boolean, files:string[], dirs:string[], message?:string}>}
 */
async function collectTreeManifest (rootDir, fsImpl) {
  const fsx = fsImpl || nodeFs
  const files = []
  const dirs = []

  async function walk (absDir, relDir) {
    let entries
    try {
      entries = await fsx.promises.readdir(absDir, { withFileTypes: true })
    } catch (e) {
      if (e && e.code === 'ENOENT') return
      return { error: '读目录失败: ' + absDir + ' · ' + String(e && e.message) }
    }
    for (const ent of entries) {
      const abs = nodePath.join(absDir, ent.name)
      const rel = relDir ? relDir + '/' + ent.name : ent.name
      // 符号链接 / 联接点：**按叶子处理**（绝不递归进去 ⇒ 绝不删到别处的内容）
      if (ent.isSymbolicLink()) {
        files.push(rel)
        continue
      }
      if (ent.isDirectory()) {
        dirs.push(rel)
        const r = await walk(abs, rel)
        if (r && r.error) return r
        continue
      }
      files.push(rel)
    }
    return null
  }

  const r = await walk(rootDir, '')
  if (r && r.error) return { ok: false, files, dirs, message: r.error }
  return { ok: true, files, dirs }
}

/**
 * 逐个删一个叶子（文件 / 符号链接 / 联接点）。
 * `unlink` 对 Windows 上的**联接点**可能报 EPERM/EISDIR ⇒ 退到 `rmdir`
 * （对联接点而言 `rmdir` 删的是**链接本身**，不是目标目录）。
 */
async function removeLeaf (fsx, abs) {
  try {
    await fsx.promises.unlink(abs)
    return { ok: true }
  } catch (e) {
    const code = e && e.code
    if (code === 'ENOENT') return { ok: true, skipped: true }
    if (code === 'EPERM' || code === 'EISDIR' || code === 'EACCES') {
      try {
        await fsx.promises.rmdir(abs)
        return { ok: true }
      } catch (e2) {
        if (e2 && e2.code === 'ENOENT') return { ok: true, skipped: true }
        return { ok: false, message: String(e2 && e2.message) }
      }
    }
    return { ok: false, message: String(e && e.message) }
  }
}

/**
 * 按精确清单删除一棵目录树（⛔ 不递归）。
 * @param {object} opts
 * @param {string} opts.rootDir - 要删的根目录
 * @param {{files:string[], dirs:string[]}} opts.manifest - 精确清单
 * @param {object} [opts.fs]
 * @returns {Promise<{ok:boolean, removedFiles:number, removedDirs:number, message?:string}>}
 */
async function removeTreeByManifest (opts) {
  const o = opts || {}
  const fsx = o.fs || nodeFs
  const rootDir = o.rootDir
  const manifest = o.manifest || { files: [], dirs: [] }
  let removedFiles = 0
  let removedDirs = 0

  // ① 文件（叶子）：逐个 unlink
  for (const rel of manifest.files || []) {
    const abs = nodePath.join(rootDir, rel)
    const r = await removeLeaf(fsx, abs)
    if (!r.ok) {
      return { ok: false, removedFiles, removedDirs, message: '删除文件失败: ' + rel + ' · ' + r.message }
    }
    if (!r.skipped) removedFiles += 1
  }

  // ② 目录：按深度**从深到浅**逐个 rmdir（只删自己确认已空的）
  const dirs = (manifest.dirs || []).slice().sort((a, b) => b.split('/').length - a.split('/').length)
  for (const rel of dirs) {
    const abs = nodePath.join(rootDir, rel)
    try {
      await fsx.promises.rmdir(abs)
      removedDirs += 1
    } catch (e) {
      const code = e && e.code
      if (code === 'ENOENT' || code === 'ENOTEMPTY') continue
      return { ok: false, removedFiles, removedDirs, message: '删除目录失败: ' + rel + ' · ' + String(e && e.message) }
    }
  }

  // ③ 根目录最后删
  try {
    await fsx.promises.rmdir(rootDir)
    removedDirs += 1
  } catch (e) {
    const code = e && e.code
    if (code === 'ENOENT') return { ok: true, removedFiles, removedDirs }
    if (code === 'ENOTEMPTY') return { ok: false, removedFiles, removedDirs, message: '根目录仍非空' }
    return { ok: false, removedFiles, removedDirs, message: '删除根目录失败: ' + String(e && e.message) }
  }
  return { ok: true, removedFiles, removedDirs }
}

module.exports = {
  manifestFromFileList,
  collectTreeManifest,
  removeTreeByManifest,
  toPosix,
}
