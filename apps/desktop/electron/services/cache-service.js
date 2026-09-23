// @ts-check
'use strict'

/**
 * 缓存清理服务（设置-通用设置）
 *
 * 职责：
 *   - getCacheStats(): 统计各缓存目录占用（字节/文件数），供设置页展示。
 *   - clearCache():    清空各缓存目录内容（保留根目录本身），返回释放字节与删除计数。
 *
 * 缓存范围（均为系统临时目录 os.tmpdir() 下的临时/缓存产物，随清理可安全删除）：
 *   - story2video      → os.tmpdir()/story2video
 *       视频合成引擎的会话目录、持久化成片副本（sessionId_output.mp4 等）、
 *       selected-media 导入媒体、inputs 运行输入。删除历史记录（userData 项目目录）
 *       不会清理这里，故提供手动回收入口。
 *   - filmEngineering  → os.tmpdir()/film-engineering
 *       影视工程 run 产物（shot_NNN.mp4 / final.mp4）。
 *
 * ⛔ 边界：绝不触碰 userData 下的持久项目（story2video-projects / story2video-bgm），
 *    那是用户的成品与素材库，只能由删除历史记录操作管理。
 *
 * 安全：所有遍历/删除均用 isPathWithin 做 canonical 边界校验并跳过符号链接，
 *    防止越界删除；单个条目失败（被占用/权限）静默跳过（best-effort），不阻塞其余。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { STORY2VIDEO_TEMP_DIR, isPathWithin } = require('./story2video-paths')

const FILM_ENGINEERING_RUNS_DIR = path.join(os.tmpdir(), 'film-engineering')

/**
 * 缓存根列表。允许注入覆盖（纯 Node 测试用真实临时目录，避开对 os.tmpdir() 的依赖）。
 * @param {{ story2video?: string, filmEngineering?: string }} [overrides]
 */
function getCacheRoots (overrides = {}) {
  return [
    { key: 'story2video', label: '视频合成缓存', dir: path.resolve(overrides.story2video || STORY2VIDEO_TEMP_DIR) },
    { key: 'filmEngineering', label: '影视工程缓存', dir: path.resolve(overrides.filmEngineering || FILM_ENGINEERING_RUNS_DIR) },
  ]
}

/**
 * 递归统计目录内普通文件的总字节数与文件数。
 * 跳过符号链接（防越界/防环），逐条以 isPathWithin 校验仍在 root 内。
 * @param {string} dir
 * @returns {{ totalBytes: number, fileCount: number }}
 */
function computeDirSize (dir) {
  let totalBytes = 0
  let fileCount = 0
  let rootStat
  try { rootStat = fs.lstatSync(dir) } catch { return { totalBytes, fileCount } }
  if (!rootStat.isDirectory()) return { totalBytes, fileCount }
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (!isPathWithin(full, [dir])) continue
      let linkStat
      try { linkStat = fs.lstatSync(full) } catch { continue }
      if (linkStat.isSymbolicLink()) continue
      if (linkStat.isDirectory()) { stack.push(full); continue }
      if (linkStat.isFile()) {
        totalBytes += linkStat.size
        fileCount += 1
      }
    }
  }
  return { totalBytes, fileCount }
}

/** 单个顶层条目的占用字节：目录递归统计，文件取自身大小，其余（符号链接等）计 0。 */
function entrySize (full, stat) {
  if (stat.isDirectory()) return computeDirSize(full).totalBytes
  if (stat.isFile()) return stat.size
  return 0
}

/**
 * 缓存统计（供设置页展示）。
 * @param {{ roots?: { story2video?: string, filmEngineering?: string } }} [options]
 */
function getCacheStats (options = {}) {
  const roots = getCacheRoots(options.roots)
  let totalBytes = 0
  let fileCount = 0
  const items = roots.map((root) => {
    const size = computeDirSize(root.dir)
    totalBytes += size.totalBytes
    fileCount += size.fileCount
    return { key: root.key, label: root.label, dir: root.dir, totalBytes: size.totalBytes, fileCount: size.fileCount }
  })
  return { totalBytes, fileCount, items }
}

/**
 * 清空各缓存目录内容（保留根目录本身），best-effort：被占用/无权限的条目跳过。
 * @param {{ roots?: { story2video?: string, filmEngineering?: string } }} [options]
 */
function clearCache (options = {}) {
  const roots = getCacheRoots(options.roots)
  let freedBytes = 0
  let removedFiles = 0
  let removedDirs = 0
  const items = roots.map((root) => {
    let rBytes = 0
    let rFiles = 0
    let rDirs = 0
    const dir = root.dir
    let entries = []
    try {
      if (fs.existsSync(dir) && fs.lstatSync(dir).isDirectory()) entries = fs.readdirSync(dir)
    } catch { entries = [] }
    for (const name of entries) {
      const full = path.join(dir, name)
      if (!isPathWithin(full, [dir])) continue
      let stat
      try { stat = fs.lstatSync(full) } catch { continue }
      const bytes = entrySize(full, stat)
      try {
        fs.rmSync(full, { recursive: true, force: true })
      } catch {
        // 文件被占用（Windows EBUSY/EPERM/EACCES）等：跳过，不计入释放量，不阻塞其余条目。
        continue
      }
      rBytes += bytes
      if (stat.isDirectory()) rDirs += 1
      else rFiles += 1
    }
    freedBytes += rBytes
    removedFiles += rFiles
    removedDirs += rDirs
    return { key: root.key, freedBytes: rBytes, removedFiles: rFiles, removedDirs: rDirs }
  })
  return { freedBytes, removedFiles, removedDirs, items }
}

module.exports = {
  FILM_ENGINEERING_RUNS_DIR,
  getCacheRoots,
  computeDirSize,
  getCacheStats,
  clearCache,
}
