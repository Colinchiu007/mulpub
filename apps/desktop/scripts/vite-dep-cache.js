// @ts-check
/**
 * vite-dep-cache.js — Vite optimizeDeps 预构建缓存过期预检（dev.js 唯一收口）
 *
 * 背景（2026-10-13 事故复盘）：`PLATFORM_CREATOR_HOME_URLS` 新增进
 * `packages/shared-utils/src/platform-definitions`（dbe8e0fa2）后，worktree 的
 * `apps/desktop/node_modules/.vite/deps` 缓存仍是旧代码构建的，渲染层
 * `Accounts.vue` import 新名字即报 “does not provide an export named 'X'”。
 * 三个事实叠加导致该故障必然复发：
 *   ① Vite 的 optimizeDeps 缓存指纹只含 lockfile + config，**不含 workspace 源码内容**；
 *   ② dev server 在源码**之后**重启也不会重建（该条目已在 optimized 列表里，无新发现）；
 *   ③ 本工作流的日常动作（sync-app 的 `checkout -f origin/main`、每日 04:00 自动化、
 *      分支跳转）会持续刷新 `packages/` 下文件 mtime。
 *
 * 所以修法不是「记得去删缓存」，而是把判据做成 spawn vite 前的机械预检：
 *   cache 新于所有 workspace source   → fresh，放行；
 *   workspace source 新于 cache        → stale，删 `<desktop>/node_modules/.vite` 后放行
 *                                          （Vite 启动时自动重新 optimize，一次性成本 ~10s）。
 *
 * 为什么用 mtime 而不是 HEAD commit 时间：commit 时间对「切到更旧提交」（回滚 /
 * 分支跳转 / bisect）会漏判——commit B 比 cache 的 commit A 旧时，B 的时间戳更早。
 * mtime 两个方向都抓得到（checkout 必刷新文件 mtime）。已知盲区：时间戳保留型
 * 拷贝（某些同步盘 / robocopy /mIR 会保留旧 mtime）——概率极低，如实记账。
 *
 * 成本：日常（无变化）为一次「packages 下各包的 src/dist」目录树的 mtime 扫描，毫秒级；
 * 误报（编辑后还原）最坏多一次冷优化，无害。已知边界与替代方案评价见 tests 头部注释。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** 相对 apps/desktop 的 Vite 缓存目录（删整个 .vite：deps + _metadata.json，防指纹残留） */
const VITE_CACHE_DIR_REL = ['node_modules', '.vite']

/** 参与判据的 workspace 源码根（相对 packages/<pkg>）。src 是 alias 目标；dist 兜底 main 指向 dist 的包 */
const WORKSPACE_SOURCE_SUBDIRS = ['src', 'dist']

/**
 * 收集 workspace 源码根：<repo>/packages/<pkg>/{src,dist}（排序保证确定性）。
 * 刻意**不含** apps/desktop/src：渲染层源码走 HMR，不是预构建产物，卷进来只会
 * 让每次 UI 编辑都触发一次无意义的冷优化。
 * @param {string} repoRoot
 * @param {typeof fs} [fsImpl]
 * @returns {string[]}
 */
function collectWorkspaceSourceRoots(repoRoot, fsImpl = fs) {
  const packagesDir = path.join(repoRoot, 'packages')
  const roots = []
  let pkgEntries = []
  try {
    pkgEntries = fsImpl.readdirSync(packagesDir, { withFileTypes: true })
  } catch {
    return roots // packages 目录不存在（异常布局）：返回空表，判据按 fresh 放行
  }
  for (const entry of pkgEntries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    for (const sub of WORKSPACE_SOURCE_SUBDIRS) {
      const p = path.join(packagesDir, entry.name, sub)
      try {
        if (fsImpl.statSync(p).isDirectory()) roots.push(p)
      } catch {
        // 该子目录不存在：正常（多数包没有 dist）
      }
    }
  }
  return roots.sort()
}

/**
 * 递归取目录树中最新文件 mtime（毫秒）。目录不存在/不可读 → 0（无证据不出判据）。
 * 单文件 stat 失败按「错过该文件」跳过——竞态删除时不该让整棵树判定失败。
 * @param {string} dir
 * @param {typeof fs} [fsImpl]
 * @param {number} [depth]
 * @returns {number}
 */
function newestFileMtimeMs(dir, fsImpl = fs, depth = 0) {
  if (depth > 32) return 0
  let newest = 0
  let entries = []
  try {
    entries = fsImpl.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    try {
      if (entry.isFile()) {
        const m = fsImpl.statSync(full).mtimeMs
        if (m > newest) newest = m
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const m = newestFileMtimeMs(full, fsImpl, depth + 1)
        if (m > newest) newest = m
      }
    } catch {
      // stat 竞态失败：跳过该文件
    }
  }
  return newest
}

/**
 * 判定缓存状态。纯函数：只读，不删任何东西（删除在 ensureFreshViteDepCache）。
 * @param {string} repoRoot
 * @param {typeof fs} [fsImpl]
 * @returns {{ state: 'absent'|'fresh'|'stale', viteDir: string, depsDir: string,
 *   cacheMs: number, sourceMs: number, newestSourceRoot: string|null }}
 */
function checkViteDepCacheStaleness(repoRoot, fsImpl = fs) {
  const desktopDir = path.join(repoRoot, 'apps', 'desktop')
  const viteDir = path.join(desktopDir, ...VITE_CACHE_DIR_REL)
  const depsDir = path.join(viteDir, 'deps')

  if (!fsImpl.existsSync(depsDir)) {
    return { state: 'absent', viteDir, depsDir, cacheMs: 0, sourceMs: 0, newestSourceRoot: null }
  }

  const cacheMs = newestFileMtimeMs(depsDir, fsImpl)
  let sourceMs = 0
  let newestSourceRoot = null
  for (const root of collectWorkspaceSourceRoots(repoRoot, fsImpl)) {
    const m = newestFileMtimeMs(root, fsImpl)
    if (m > sourceMs) {
      sourceMs = m
      newestSourceRoot = root
    }
  }

  // 无 source 证据（解析退化/异常布局）时按 fresh 放行：保守方向是不删用户缓存。
  // 反向风险（恒 fresh）由 vite-dep-cache.test.js 的「真实仓库 source 根数 ≥ 10」下界兜住。
  const state = sourceMs > cacheMs ? 'stale' : 'fresh'
  return { state, viteDir, depsDir, cacheMs, sourceMs, newestSourceRoot }
}

/**
 * dev.js spawn vite 前的预检入口：stale 则清缓存。任何一步失败都不让启动崩掉——
 * 但必须留痕（fail-loud），且清除失败时如实回报（不得静默报成功）。
 * @param {string} repoRoot
 * @param {{ fsImpl?: typeof fs, log?: (msg: string) => void }} [opts]
 * @returns {{ state: string, cleared: boolean, clearError?: string, viteDir: string, cacheMs: number, sourceMs: number }}
 */
function ensureFreshViteDepCache(repoRoot, opts = {}) {
  const fsImpl = opts.fsImpl || fs
  const log = opts.log || ((m) => console.log(m))
  let result
  try {
    result = checkViteDepCacheStaleness(repoRoot, fsImpl)
  } catch (err) {
    log('[vite-deps] check failed: ' + (err && err.message) + ' — 继续启动（未做缓存判定，若页面报 does-not-provide-an-export 请手动删除 node_modules/.vite）')
    return { state: 'error', cleared: false, clearError: String(err && err.message), viteDir: '', cacheMs: 0, sourceMs: 0 }
  }

  if (result.state !== 'stale') {
    log(`[vite-deps] state=${result.state} cacheMs=${result.cacheMs} sourceMs=${result.sourceMs} action=none`)
    return { ...result, cleared: false }
  }

  try {
    fsImpl.rmSync(result.viteDir, { recursive: true, force: true })
  } catch (err) {
    log(`[vite-deps] state=stale cacheMs=${result.cacheMs} sourceMs=${result.sourceMs} action=clear-FAILED error=${err && err.message} — 请手动删除 ${result.viteDir} 后重启`)
    return { ...result, cleared: false, clearError: String(err && err.message) }
  }
  log(`[vite-deps] state=stale cacheMs=${result.cacheMs} sourceMs=${result.sourceMs} source=${result.newestSourceRoot} action=cleared viteDir=${result.viteDir}`)
  return { ...result, cleared: true }
}

module.exports = {
  ensureFreshViteDepCache,
  checkViteDepCacheStaleness,
  collectWorkspaceSourceRoots,
  newestFileMtimeMs,
  VITE_CACHE_DIR_REL,
  WORKSPACE_SOURCE_SUBDIRS,
}
