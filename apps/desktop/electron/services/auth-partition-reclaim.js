// @ts-check
/**
 * auth-partition-reclaim — 回收「每次打开登录页新建、永不删除」的临时分区
 *
 * 缺陷（#2701）：`openLogin` / `openSavedAccount` / `loginSilent` 每次调用都用
 * `Date.now()` 新建一个 persist 分区（磁盘目录名 `auth-auth-<platform>-<ts>`、
 * `silent-auth-<platform>-<ts>`），而全仓没有任何删除逻辑。本机 debug profile 实测
 * 21 个 `auth-auth-*` 目录共 **436MB**，占整个 `session/Partitions`（476MB）的 92%。
 *
 * 为什么可以删「非最新」那一个（本模块全部判据的地基）：
 * （#2701 立项时）`auth-partition.findAuthPartitionDir` 对每组前缀做 `names.filter(prefix).sort()` 后
 * 只取最后一个。该口径已被 #2734 改为「同组从新到旧按内容探」，因此本模块的每组保留数
 * 必须等于那边的探测窗口 `PROBE_LIMIT`（见 planReclaim）——旧注释保留在这里是为了说明
 * 「为什么当年只留末位是安全的」，今天它**不再**是安全前提。
 * **只取最后一个**，发布链的两处兜底（`rpa-view-manager` 的 API 轨、`rpa-view-session.
 * _restoreAuthPartitionCookies` 的 RPA 轨）都经它定位。也就是说「较旧的 auth 分区」
 * 从来没有读者 —— 删除它们对读取行为可证明为零影响。因此这里的新旧判定必须与
 * 定位端**同一口径**（字典序 `sort()` 取末位），不得改用 mtime，否则两边规则一漂移，
 * 就会删掉兜底真正在读的那一份。
 *
 * 不能做的事（都是踩过的坑）：
 * - 不删「每组最新」那一份：登录成功的凭证可能只落在这里（kuaishou-w3-live-fix 根因）。
 * - 不碰 `account-*` / `logto-identity` / `rpa-*`：前者是账号标签的长期分区（含真实凭证）。
 * - 不对 `Partitions/` 父目录整体递归删除，且删除前必须确认目标就在该 root 下（R2）。
 * - 不删本进程正持有 Session 对象的分区：目录被 Chromium 打开时删除会写坏。
 * - Windows 上只对 `EPERM`/`EACCES`/`EBUSY` 做短而有界的重试，其余错误原样进日志。
 * - 回收属旁路：任何失败只 warn，不得影响登录与发布。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { isPlatformCookieDomain } = require('@multi-publish/shared-utils/src/platform-definitions')


/**
 * 只回收「每次调用新建、名字里带时间戳」的分区前缀形态。
 * `auth-auth-` 同时覆盖 openLogin（auth-auth-<platform>-<ts>）与 openSavedAccount
 * （auth-auth-saved-<platform>-<ts>）；legacy 单前缀 `auth-<platform>-<ts>` 与
 * `auth-<真实 accountId>` 不在此列——后者可能是在用的账号分区，误删即抹凭证。
 */
const THROWAWAY_PREFIXES = ['auth-auth-', 'silent-auth-']

// 登录槽位（按平台复用的稳定分区）规则独立成模块（2026-10-21）：
// 命名、豁免、清理、导航前清理都在 `auth-login-slot` 一处定义，
// 本模块只负责「槽位不得进回收面」这一条豁免（见 isThrowawayPartitionName）。
//
// ⚠️ 依赖方向（2026-10-21 CCG 外部评审 i5）：
//   auth-login-slot.js 是**叶子模块**（只依赖 node 内置 + 自己的常量），
//   本模块 require 它、它**绝不** require 本模块 —— 双向依赖会成环。
//   槽位目录名的通用规则（`auth-<accountId>`）在**本模块**的 `partitionNameOf`，
//   槽位模块自己实现了同一规则，两份实现由**回环契约锁**钉在一起
//   （见 auth-partition-reclaim.test.js「槽位目录名必须与通用命名规则一致」）。
const authLoginSlot = require('./auth-login-slot')
/**
 * 兜底选址的探测窗口 = 回收端的每组保留数（#2734 的耦合点，单一真源在本模块，
 * 由 auth-partition 再导出，避免两处数字各写一遍而互相吃掉候选）。
 * @type {number}
 */
const PROBE_LIMIT = 5

/**
 * 本进程**已打开过** Session 的分区名登记表。
 *
 * 为什么必须有：Electron 的 persist Session 由 browser process 缓存，`fromPartition` 之后
 * 直到进程退出都不会销毁（webContents 关闭也不销毁）。回收若删掉这类分区的目录，
 * 就是在对 Chromium 仍持有的存储目录做 unlink —— 表现为写回失败或状态损坏。
 * 三个开 Session 的入口必须全部登记，漏一个就是沉默缺陷：
 *   ① `auth-view-session.createSession`（openLogin + openSavedAccount）
 *   ② `loginSilent` 的 `silent-auth-*`（不经 createSession）
 *   ③ `auth-partition.collectAuthPartitionCookies` 的**只读** fromPartition
 *      ——「我只是读一下」同样会实例化 Session。
 * 所以回收的实际语义是「跨进程回收」：本轮新建的分区留给下一次启动/登录时删，
 * 当场只清存储（wipeSessionStorage），不删目录。
 * @type {Set<string>}
 */
const livePartitions = new Set()

/**
 * 登记「本进程已持有 Session」。必须在 fromPartition 之后立即调用。
 * @param {string|null|undefined} partitionDirName 分区目录名（不含 persist:）
 */
function noteLivePartition (partitionDirName) {
  if (typeof partitionDirName === 'string' && partitionDirName) livePartitions.add(partitionDirName)
  return partitionDirName
}

function livePartitionNames () {
  return Array.from(livePartitions)
}

/** 目录名尾部的 `-<数字时间戳>` 段；去掉它得到「同一组」。 */
const TRAILING_TS_RE = /-\d+$/

/** 与 check-max-lines / Windows 重试口径一致的有界重试。 */
const RM_MAX_RETRIES = 3
const RM_RETRY_DELAY_MS = 100

function isThrowawayPartitionName (name) {
  // 登录槽位（按平台复用的稳定分区）落在同一个前缀下，但**不是**一次性分区：
  // 它不带时间戳、要跨多次登录存活（缓存就在里面），绝不能进回收面。
  if (authLoginSlot.isLoginSlotPartitionName(name)) return false
  return THROWAWAY_PREFIXES.some(function (prefix) { return name.startsWith(prefix) })
}

/**
 * 同组键：反复剥掉尾部的 `-<数字>` 段。
 *
 * 为什么必须反复剥而不是一次：`openLogin` 的目录名是 `auth-auth-<platform>-<ts>`，
 * 而 `qrcode-login` 的是 `auth-auth-<platform>-<ts>-<seq>`。只剥一段会让**每次扫码各自成一组**，
 * 于是同平台扫三次得到三个"最新"，一个都删不掉 —— 与定位端 `listAuthPartitionCandidates` 用的前缀
 * （`auth-auth-<platform>-`，平台级粒度）不一致，回收面就永远收不拢。分组粒度必须等于前缀粒度。
 * 名字不以 `-<数字>` 结尾时自成一组（绝不与人合批）。
 */
function groupKeyOf (name) {
  let key = name
  let prev
  do {
    prev = key
    key = key.replace(TRAILING_TS_RE, '')
  } while (key !== prev && key.length > 0)
  return key
}

/**
 * 分区根目录清单，与 `auth-partition.listAuthPartitionCandidates` 的 `roots` 同序同源。
 * @param {string} userDataPath
 * @returns {string[]}
 */
function partitionRoots (userDataPath) {
  return [path.join(userDataPath, 'session', 'Partitions'), path.join(userDataPath, 'Partitions')]
}

/**
 * 每组**保留最近 PROBE_LIMIT 份**，超出窗口的旧目录才进 victims。
 *
 * 为什么不是「只留字典序末位」（#2734，2026-10-01）：定位端原来是「只读末位」，所以非末位
 * 永不被读、删掉不影响任何行为；但 #2734 把定位改成「同组从新到旧按内容探」，因为一次失败/取消
 * 的登录会留下**字典序最新却空壳**的那一份，只留末位就等于把唯一含凭证的较旧目录删掉 ——
 * 回收端会把兜底候选自己吃掉。**回收保留数必须等于定位探测窗口**，两者共用导出的同一个
 * PROBE_LIMIT（锁见 auth-partition-reclaim.test.js 的「窗口=candidates」用例），禁止两处各写数字。
 *
 * 上限是**有条件**的（外部评审 A2/W2 指出原表述过强）：每组留最近 K 份，**外加** `livePartitions` 豁免
 * ——本进程正持有 Session 的目录即使滑出窗口也不能删（Chromium 仍持有其存储，删即写坏状态，#2701 铁律），
 * 所以长驻进程里单组 `kept` 可以 > K；进程重启后回到 K。磁盘因此不会退回 #2701 立项时的无界增长，
 * 但增长的上界是「K + 本进程开过的 Session 数」而不是「K」，写注释与改日志时都得按这个口径说。
 * 纯函数、不碰文件系统写操作，便于逐条加锁。
 * @param {string[]} names root 下的目录名（调用方须已过滤为目录）
 * @param {string[]} [activePartitionNames] 本进程正持有 Session 的分区名，一律跳过
 * @returns {{victims: string[], kept: string[], skippedActive: string[]}}
 */
function planReclaim (names, activePartitionNames) {
  const active = new Set(activePartitionNames || [])
  const groups = new Map()
  for (const name of names) {
    if (!isThrowawayPartitionName(name)) continue
    const key = groupKeyOf(name)
    const bucket = groups.get(key) || []
    bucket.push(name)
    groups.set(key, bucket)
  }
  const victims = []
  const kept = []
  const skippedActive = []
  for (const bucket of groups.values()) {
    bucket.sort()
    const window = new Set(bucket.slice(-PROBE_LIMIT))
    for (const name of bucket) {
      if (active.has(name)) {
        skippedActive.push(name)
        if (!window.has(name)) kept.push(name)
        continue
      }
      if (window.has(name)) { kept.push(name); continue }
      victims.push(name)
    }
  }
  return { victims: victims.sort(), kept: kept.sort(), skippedActive: skippedActive.sort() }
}

/**
 * 执行回收。任何单点失败只落日志，函数不抛。
 * @param {{userDataPath?: string, activePartitionNames?: string[], log?: any, app?: any, fsImpl?: typeof fs}} opts
 * @returns {{scanned:number, removed:string[], kept:string[], errors:number}}
 */
function reclaimStaleAuthPartitions (opts) {
  const o = opts || {}
  const fsx = o.fsImpl || fs
  const log = o.log
  const summary = { scanned: 0, removed: /** @type {string[]} */ ([]), kept: /** @type {string[]} */ ([]), errors: 0 }
  let userDataPath = o.userDataPath
  if (!userDataPath) {
    try {
      const electronApp = o.app || require('electron').app
      userDataPath = electronApp && electronApp.getPath ? electronApp.getPath('userData') : ''
    } catch (_e) { userDataPath = '' }
  }
  if (!userDataPath) return summary

  for (const root of partitionRoots(userDataPath)) {
    let names
    try {
      if (!fsx.existsSync(root)) continue
      names = fsx.readdirSync(root)
    } catch (e) {
      summary.errors += 1
      if (log) log.notify('AuthReclaim', 'partition-readdir-failed', { level: 'WARN', error: String((e && e.message) || 'unknown') })
      continue
    }
    /** @type {string[]} */
    let dirs = []
    for (const name of names) {
      try { if (fsx.statSync(path.join(root, name)).isDirectory()) dirs.push(name) } catch (_e) { /* 读不动就跳过该条目 */ }
    }
    summary.scanned += dirs.length
    // 本进程已持有 Session 的名字并入跳过集：调用方只知道自己那一个，读侧/并发侧的
    // 实例化只有登记表知道（漏了就会 unlink Chromium 仍持有的目录）。
    const activeNames = (o.activePartitionNames || []).concat(Array.from(livePartitions))
    const plan = planReclaim(dirs, activeNames)
    summary.kept = summary.kept.concat(plan.kept)
    // 只删 root 的直接子项：realpath 收口，拒绝任何经 symlink/`..` 逃出 root 的目标。
    let realRoot = root
    try { realRoot = fsx.realpathSync(root) } catch (_e) { /* 无 realpath 时沿用原根 */ }
    for (const name of plan.victims) {
      const target = path.join(root, name)
      let realTarget
      try { realTarget = fsx.realpathSync(target) } catch (_e) { realTarget = target }
      if (path.dirname(realTarget) !== realRoot || path.basename(realTarget) !== name) {
        summary.errors += 1
        if (log) log.notify('AuthReclaim', 'delete-outside-root-refused', { level: 'WARN', params: { name } })
        continue
      }
      try {
        fsx.rmSync(realTarget, { recursive: true, force: true, maxRetries: RM_MAX_RETRIES, retryDelay: RM_RETRY_DELAY_MS })
        summary.removed.push(name)
      } catch (e) {
        summary.errors += 1
        if (log) log.notify('AuthReclaim', 'partition-remove-failed', { level: 'WARN', params: { name }, error: String((e && e.message) || 'unknown') })
      }
    }
  }
  if (summary.removed.length > 0 || summary.errors > 0) {
    if (log) log.notify('AuthReclaim', 'reclaim-scanned', { params: { scanned: summary.scanned, removed: summary.removed.length, kept: summary.kept.length, pinned: (summary.skippedActive || []).length, errors: summary.errors } })
  }
  return summary
}

/**
 * 延迟执行，不阻塞登录首屏与调用方；失败只 warn。
 * @param {any} opts
 */
function scheduleReclaim (opts) {
  setImmediate(function () {
    try { reclaimStaleAuthPartitions(opts) } catch (e) {
      const log = (opts && opts.log) || null
      if (log) log.notify('AuthReclaim', 'reclaim-threw', { level: 'WARN', error: String((e && e.message) || 'unknown') })
    }
  })
}

/**
 * 未取到凭证的会话就地清空分区（Cookie/localStorage/IndexedDB/缓存）。
 * 进程内安全动作，替代「直接删目录」——后者在 Session 对象仍存活时会写坏磁盘状态。
 *
 * `opts.keepHttpCache=true` 时**只清存储、不清 HTTP 缓存**：登录槽位靠这个保住
 * 第三方登录页的静态资源缓存（见文件头「登录槽位」一节）。注意 `clearStorageData()`
 * 清的是 Cookie/localStorage/IndexedDB 等**存储**，HTTP 磁盘缓存由 `clearCache()` 单独负责，
 * 两者是不同机制 —— 保留缓存的收益正来自这里。
 * @param {any} partitionSession Electron Session（须有 clearStorageData/clearCache）
 * @param {any} log
 * @param {{keepHttpCache?: boolean}} [opts]
 * @returns {Promise<boolean>} true = 已清空
 */
function wipeSessionStorage (partitionSession, log, opts) {
  const o = opts || {}
  const keepHttpCache = o.keepHttpCache === true
  if (!partitionSession || typeof partitionSession.clearStorageData !== 'function') {
    if (log) log.notify('AuthReclaim', 'session-wipe-skipped', { level: 'WARN' })
    return Promise.resolve(false)
  }
  const tasks = [partitionSession.clearStorageData()]
  if (!keepHttpCache && typeof partitionSession.clearCache === 'function') tasks.push(partitionSession.clearCache())
  return Promise.all(tasks).then(function () { return true }).catch(function (e) {
    if (log) log.notify('AuthReclaim', 'session-wipe-failed', { level: 'WARN', error: String((e && e.message) || 'unknown') })
    return false
  })
}

/**
 * 登录会话分区目录名（不含 `persist:`）的唯一实现。`auth-view-session.createSession` 与本模块
 * 的回收判据都走这里——两处各写一份必然漂移，回收端认错名字就等于永不回收。
 * @param {string|null|undefined} accountId
 * @returns {string|null}
 */
function partitionNameOf (accountId) {
  if (typeof accountId !== 'string' || !accountId) return null
  return `auth-${accountId}`
}

/**
 * 「本轮已取到凭证并入库」的会话分区名单。发布链的磁盘兜底（`collectAuthPartitionCookies`
 * → `auth-partition.listAuthPartitionCandidates`，按内容在探测窗口内择新）可能正依赖成功登录那一份，
 * 所以只有**未取证**的会话才允许就地清存储。进程级集合，随会话名增长，量级可忽略。
 * @type {Set<string>}
 */
const capturedPartitions = new Set()

function markCaptured (accountId) {
  const name = partitionNameOf(accountId)
  if (name) capturedPartitions.add(name)
  return name
}

function hasCapturedPartition (accountId) {
  const name = partitionNameOf(accountId)
  return Boolean(name && capturedPartitions.has(name))
}

/**
 * 「未取证」不等于「没有可用登录态」——清空前必须先看内容。
 *
 * 为什么不能无条件清：`close()` 会在用户按 Escape / 手动关闭登录标签时被调用，而这条路径上
 * 页面**可能已经拿到了真实会话 Cookie**（用户其实登录成功，只是没走自动完成或没点保存）。
 * 对快手这类「登录态只落分区、未同步进凭证库」的平台（kuaishou-w3-live-fix 根因），
 * 无条件清就等于亲手抹掉发布兜底唯一可读的那一份 —— 那正是 #2701 要保护的东西。
 * 口径：读到任何属于该平台的 Cookie 就不清；**探测失败同样不清**（不确定时保守留数据，
 * 留着的残留可以下次再清，抹掉的凭证找不回来）。
 * @param {any} partitionSession
 * @param {string|null|undefined} platform
 * @param {any} log
 * @param {{keepHttpCache?: boolean}} [opts] keepHttpCache=true 时只清存储、保留 HTTP 缓存
 * @returns {Promise<boolean>} true = 已清空
 */
function wipeUnlessUsableAsFallback (partitionSession, platform, log, opts) {
  if (!partitionSession || typeof partitionSession.clearStorageData !== 'function') {
    if (log) log.notify('AuthReclaim', 'session-wipe-skipped-fallback', { level: 'WARN' })
    return Promise.resolve(false)
  }
  const probe = partitionSession.cookies && typeof partitionSession.cookies.get === 'function'
    ? Promise.resolve(partitionSession.cookies.get({}))
    : Promise.reject(new Error('cookies.get 不可用'))
  return probe.then(function (cookies) {
    if (!Array.isArray(cookies)) throw new Error('cookies.get 返回非数组')
    const usable = platform
      ? cookies.filter(function (c) { return isPlatformCookieDomain(platform, c && c.domain) }).length
      : 0
    if (usable > 0) {
      if (log) log.notify('AuthReclaim', 'kept-as-publish-fallback', { params: { platform, cookies: usable } })
      return false
    }
    return wipeSessionStorage(partitionSession, log, opts)
  }).catch(function (e) {
    if (log) log.notify('AuthReclaim', 'cookie-probe-failed-kept', { level: 'WARN', error: String((e && e.message) || 'unknown') })
    return false
  })
}

/**
 * 登录会话终态的回收动作：未取证的会话按内容判定是否清空（进程内安全），
 * 目录本体交给 scheduleReclaim 按「非最新即删」回收。属旁路，任何失败只留日志。
 *
 * `opts.keepHttpCache=true` 时清存储但**保留 HTTP 缓存**（登录槽位专用：
 * 槽位目录要跨多次登录存活，缓存正是它存在的理由）。
 * @param {{accountId?: string|null, session?: any, platform?: string|null, captured?: boolean, log?: any, activePartitionNames?: string[], keepHttpCache?: boolean}} opts
 */
function reclaimLoginSession (opts) {
  const o = opts || {}
  const log = o.log
  const name = partitionNameOf(o.accountId)
  if (!name) {
    if (log) log.notify('AuthReclaim', 'no-partition-to-reclaim', { level: 'WARN' })
    scheduleReclaim({ activePartitionNames: o.activePartitionNames || [] })
    return null
  }
  // 「本轮是否取到凭证」必须按**轮次**判，不能按分区名判：登录视图现在按平台复用
  // 同一个分区（登录槽位），上一轮成功不代表这一轮成功 —— 用分区名判会把
  // 「本轮没登录成、槽位里还留着上一轮会话」误当成已取证 ⇒ 该清的没清。
  // 调用方显式给出 captured 时以它为准；没给才回落到登记表（保守：宁可留着数据）。
  // ⚠️ 槽位名 + 没给 captured ⇒ 登记表里那条是**上一轮**的证据，不能当本轮用 ⇒ 记一条 warn
  // （2026-10-21 CCG 外部评审 i8：静默回落会让调用方以为按轮次判了，其实没有）。
  if (o.captured === undefined && authLoginSlot.isLoginSlotPartitionName(name)) {
    if (log) log.notify('AuthReclaim', 'login-slot-captured-missing', { level: 'WARN', params: { platform: o.platform || '' } })
  }
  const captured = o.captured === true ||
    (o.captured === undefined && capturedPartitions.has(name))
  if (!captured) void wipeUnlessUsableAsFallback(o.session, o.platform, log, { keepHttpCache: o.keepHttpCache === true })
  scheduleReclaim({ activePartitionNames: [name] })
  return name
}

module.exports = {
  PROBE_LIMIT,
  THROWAWAY_PREFIXES,
  partitionNameOf,
  noteLivePartition,
  livePartitionNames,
  isThrowawayPartitionName,
  groupKeyOf,
  partitionRoots,
  planReclaim,
  markCaptured,
  hasCapturedPartition,
  reclaimStaleAuthPartitions,
  scheduleReclaim,
  wipeSessionStorage,
  wipeUnlessUsableAsFallback,
  reclaimLoginSession,
}
