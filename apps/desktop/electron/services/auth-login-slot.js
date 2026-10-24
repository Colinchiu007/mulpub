// @ts-check
/**
 * auth-login-slot — 登录槽位（login slot）：按平台复用的稳定登录分区
 *
 * ⚠️ **依赖方向（2026-10-21 CCG 外部评审 i4）**：本模块是**叶子模块** ——
 * 只依赖 node 内置与自己的常量，**绝不** require `auth-partition-reclaim`（那会成环）。
 * 方向是单向的：`auth-partition-reclaim` →（require）→ 本模块；本模块不反向依赖任何仓内模块。
 * 代价：槽位目录名的通用规则（`auth-<accountId>`）在 `auth-partition-reclaim.partitionNameOf`，
 * 本模块自己实现了同一份 ⇒ 两份实现由**回环契约锁**钉在一起
 * （见 `auth-partition-reclaim.test.js`「槽位目录名必须与通用命名规则一致」——
 * 未来谁改了其中一份，那条用例会当场变红）。
 *
 * 为什么要它独立成模块（2026-10-21，QM-6 外部评审 i4 两次提出 + 仓内行数门禁硬要求）：
 * ① 槽位规则是**跨文件**的（命名 / 豁免 / 清理 / 导航前清理），散在回收模块与两个登录承载里
 *    会让「命名改了、豁免没改」这类漂移无人发现；独立模块后只此一处定义；
 * ② `auth-partition-reclaim.js` 与 `login-network-diagnostics.js` 本刀之后都超过 500 行上限
 *    （`.github/scripts/check-max-lines.js` 的 NEW_OVER_LIMIT：新代码不得引入超大文件），
 *    槽位规则外移是还债也是拆分。
 *
 * 缺陷背景：登录视图此前每次用 `Date.now()` 新建一个**空分区** ⇒ 第三方登录页的 HTTP 缓存
 * 每次从零开始（头条号登录页实测带 43MB 背景视频 + ~1.8MB 页面 bundle + 1.3MB 风控 SDK
 * `webmssdk.js` 520KB + `secsdk-captcha/captcha.js` 784KB），用户点「获取验证码」后
 * 平台自己的灰色遮罩先出现、图形验证码几秒后才画出来。普通 Chrome 里这些资源早缓存了，
 * 所以用户看到的是「浏览器正常、app 慢」—— 这个差异是本仓造成的。
 *
 * 修法：**同一平台复用同一分区目录**，只清凭证、不清 HTTP 缓存。
 *
 * 四条不变量（改这块必须一起改）：
 * ① 目录名**不带时间戳** ⇒ 它不满足「一次性分区」形态 ⇒ 回收端永不把它当 victim
 *    （回收端的显式豁免见 `auth-partition-reclaim.isThrowawayPartitionName`）；
 * ② 目录名落在发布链兜底读取端的既有前缀 `auth-auth-<platform>-` 之下 ⇒ 读取端**零改动**
 *    即可读到它；且按字典序排在时间戳目录**之后**（数字 < 字母）⇒「从新到旧逐份探」
 *    会先探槽位、槽位空时自然落到旧目录 ⇒ 回退链完整保留；
 * ③ **凭证隔离靠「开局清」而不是「每次新建」**：开局清掉槽位里的旧凭证/存储，
 *    否则复用槽位会让第二次登录直接命中上一个账号的登录态（平台自动登录 ⇒ 重复账号）；
 * ④ 读取端仍能读到最后一次成功登录的会话（槽位不清 ⇒ 兜底源在）。
 */

// 槽位 accountId 的后缀。目录名 = 'auth-' + accountId（与 `auth-partition-reclaim.partitionNameOf`
// 同一规则；两处各写一份必然漂移，故有回环契约锁钉住，见 auth-partition-reclaim.test.js）。
const LOGIN_SLOT_SUFFIX = '-slot'

/** 槽位目录名前缀（用于识别一个目录名是不是槽位）。 */
const LOGIN_SLOT_PREFIX = 'auth-auth-'

/**
 * 登录槽位的 accountId（`auth-<platform>-slot`）。
 * @param {string|null|undefined} platform
 * @returns {string|null}
 */
function loginSlotAccountIdOf (platform) {
  if (typeof platform !== 'string' || !platform) return null
  return `auth-${platform}${LOGIN_SLOT_SUFFIX}`
}

/**
 * 登录槽位的分区目录名（不含 `persist:`）。
 * @param {string|null|undefined} platform
 * @returns {string|null}
 */
function loginSlotPartitionNameOf (platform) {
  const accountId = loginSlotAccountIdOf(platform)
  return accountId ? `auth-${accountId}` : null
}

/**
 * 该分区名是不是登录槽位（按平台复用的稳定分区）。
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
function isLoginSlotPartitionName (name) {
  return typeof name === 'string' &&
    name.startsWith(LOGIN_SLOT_PREFIX) &&
    name.endsWith(LOGIN_SLOT_SUFFIX)
}

/**
 * 槽位清理的默认超时上限（毫秒）。
 *
 * 取 1200 而非更长的理由（2026-10-21 CCG 外部评审 i3）：这个上限是**安全网**，不是常态延迟
 * —— 正常路径上 `clearStorageData()` 是毫秒级的本机磁盘操作。上限只兜「宿主卡死」这一种情况；
 * 兜得越久，用户为一次注定失败的清理多等越久（评审实测口径：3000ms 上限 ⇒ 最坏 3 秒可感知卡顿）。
 * 1200ms 兼顾「隔离最多等 1.2s」与「不让用户干等 3s」；超时后仍然放行导航（清理是旁路），
 * 并留一条 WARN 供事后归因。
 */
const DEFAULT_SLOT_WIPE_TIMEOUT_MS = 1200

/**
 * 槽位清理超时预算：可经 MP_LOGIN_SLOT_WIPE_TIMEOUT_MS 覆盖（排障用）；非法值回落默认。
 * @param {object} env
 * @param {number} [override]
 * @returns {number}
 */
function resolveSlotWipeTimeoutMs (env, override) {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.min(override, 60000)
  }
  const src = env || {}
  const raw = src.MP_LOGIN_SLOT_WIPE_TIMEOUT_MS
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SLOT_WIPE_TIMEOUT_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SLOT_WIPE_TIMEOUT_MS
  return Math.min(n, 60000)
}

/**
 * 给槽位清理加硬上限：清理卡死不得连带把登录导航卡死。
 * 迟到 resolve 不算失败（清理其实完成了），只是超时时我们不再等它。
 *
 * ⚠️ **返回契约（CCG 外部评审 i1 的落点）**：`pending` MUST resolve 成**布尔值**
 * （true=清成功 / false=清失败）。
 * `clearStorageData()` 自己 resolve 的是 `undefined` —— 直接把它交给本函数，
 * `undefined` 会被 `=== true` 判成 false ⇒ **明明清成功了却记成失败**。
 * 故：① 调用方必须先折成布尔（见 `wipeLoginSlotCredentials`）；② 本函数再加一道防御：
 * 拿到非布尔值即按「契约被破坏」处理（记 failed + 返回 `contract-violation` 原因），
 * 让这类改动**当场可见**而不是静默把成功读成失败。
 * @param {Promise<boolean>} pending
 * @param {number} ms
 * @returns {Promise<{wiped: boolean, reason: 'wiped'|'failed'|'timeout'}>}
 */
function withSlotWipeTimeout (pending, ms) {
  const task = Promise.resolve(pending)
  let timer = null
  const budget = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve({ wiped: false, reason: 'timeout' }) }, ms)
    if (timer && timer.unref) timer.unref()
  })
  return Promise.race([
    task.then(function (ok) {
      if (ok === true) return { wiped: true, reason: 'wiped' }
      if (ok === false) return { wiped: false, reason: 'failed' }
      // 非布尔 ⇒ 契约被破坏（典型：有人把 `.then(() => true)` 那层去掉）。
      // MUST 抛而不是静默当失败：静默会把「清成功」读成「清失败」，而失败又被
      // 上层当「不阻断」吞掉 ⇒ 隔离悄悄失效且无痕（2026-10-21 CCG 外部评审 i4）。
      // 抛出来由上层 catch 成一条 WARN：生产不崩、测试当场红。
      throw new TypeError('withSlotWipeTimeout 的 pending 必须 resolve 成布尔值（收到: ' + typeof ok + '）')
    }, function (e) {
      return { wiped: false, reason: 'failed', error: String((e && e.message) || 'unknown') }
    }),
    budget
  ]).finally(function () { if (timer) clearTimeout(timer) })
}

/**
 * 登录槽位开局清理：把槽位里**上一轮遗留的凭证**清掉，但**保留 HTTP 缓存**。
 *
 * 为什么必须有（复用槽位的前提）：不复用时每次都是空分区，凭证天然隔离；
 * 复用后若不清，上一轮登录成功的凭证还在 ⇒ 平台判定「已登录」直接跳过登录表单，
 * 用户想加第二个同平台账号时会静默存成同一个账号。
 *
 * **一律清理，不做「空槽位就跳过」的优化**（2026-10-21 CCG 外部评审 i1/i2 两条 Critical 后的定稿）：
 * ① 「有没有 Cookie」判据漏掉**用 localStorage/sessionStorage 存登录态**的平台
 *    （知乎 `z_c0` 就在 localStorage）—— 那类平台第二次登录同样会命中上一个账号的会话；
 * ② 「先探 Cookie、探失败就当空」的分支在宿主异常时会把**隔离**直接跳过，
 *    与「隔离优先于省一次 IO」的初衷正好相反。
 * 代价是每次登录开局多一次 `clearStorageData()`（本机磁盘操作，量级 ms 级），
 * 而它**不动 HTTP 缓存** —— 本刀要的缓存收益不受影响。
 *
 * 失败与超时都是**旁路**：清理失败不阻断登录导航（阻断 = 用户根本加不了账号），
 * 只留日志；此时残留凭证最多让平台走成「已登录」分支，用户看得见。
 *
 * @param {any} partitionSession Electron Session
 * @param {any} log
 * @param {{timeoutMs?: number, env?: object}} [opts]
 * @returns {Promise<{wiped: boolean, reason: 'wiped'|'failed'|'timeout'|'unsupported'}>}
 */
async function wipeLoginSlotCredentials (partitionSession, log, opts) {
  const o = opts || {}
  const env = o.env || process.env
  const timeoutMs = resolveSlotWipeTimeoutMs(env, o.timeoutMs)
  if (!partitionSession || typeof partitionSession.clearStorageData !== 'function') {
    if (log) log.notify('AuthReclaim', 'login-slot-wipe-unsupported', { level: 'WARN' })
    return { wiped: false, reason: 'unsupported' }
  }
  /** @type {{wiped?: boolean, reason?: string, error?: string}} */
  let outcome
  try {
    outcome = await withSlotWipeTimeout(
      // 只清存储、**不清 HTTP 缓存**（`clearCache` 不在这里调）——
      // 缓存正是槽位存在的理由，清掉等于每次登录都从零下载第三方资源。
      // ⚠️ 必须先折成布尔：`clearStorageData()` resolve 的是 `undefined`，
      // 直接交给 `withSlotWipeTimeout` 会被判成失败（CCG 外部评审 i1）。
      Promise.resolve()
        .then(function () { return partitionSession.clearStorageData() })
        .then(function () { return true })
        .catch(function () { return false }),
      timeoutMs
    )
  } catch (e) {
    outcome = { wiped: false, reason: 'failed', error: String((e && e.message) || 'unknown') }
  }
  if (outcome && outcome.wiped === true) {
    if (log) log.notify('AuthReclaim', 'login-slot-wiped', { level: 'INFO', params: { reason: 'wiped', timeoutMs } })
    return { wiped: true, reason: 'wiped' }
  }
  if (log) {
    log.notify('AuthReclaim', 'login-slot-wipe-failed', {
      level: 'WARN',
      params: { reason: (outcome && outcome.reason) || 'unknown', error: (outcome && outcome.error) || null, timeoutMs }
    })
  }
  return { wiped: false, reason: (outcome && outcome.reason) || 'failed' }
}

/**
 * 导航前清掉登录槽位里的旧凭证，然后才发起首个导航。
 *
 * 为什么必须在导航前：平台判定「已登录」看的是 Cookie。登录视图现在按平台复用同一个分区目录
 * （缓存得以留存），槽位里若留着上一轮的会话 Cookie，登录页会直接跳到已登录态 ——
 * 用户想加第二个同平台账号时会静默存成同一个账号。
 *
 * 为什么「失败也继续」：清理是旁路，卡住或失败都不该让用户加不了账号；
 * 真清不掉时最坏是平台走成「已登录」分支，用户看得见，日志里也有据可查。
 *
 * @param {object} deps
 * @param {any} deps.view WebContentsView
 * @param {any} deps.session 分区 Session
 * @param {() => boolean} deps.isCurrent 会话是否仍是当前会话（被替换/关闭则不再导航）
 * @param {() => void} deps.navigate 真正的导航动作
 * @param {any} deps.log
 */
function navigateAfterSlotCleanup (deps) {
  const view = deps.view
  const done = function () {
    if (typeof deps.isCurrent === 'function' && !deps.isCurrent()) return
    if (!view || !view.webContents || view.webContents.isDestroyed()) return
    try { deps.navigate() } catch (e) {
      if (deps.log) deps.log.warn('AuthView: 登录页导航失败: ' + ((e && e.message) || 'unknown'))
    }
  }
  try {
    // 超时预算**显式**给出（CCG 外部评审 i4）：不让导航行为取决于「进程里恰好有没有
    // 那个环境变量」——一个被改大的全局值会让每次登录白等那么久。
    Promise.resolve(wipeLoginSlotCredentials(deps.session, deps.log, {
      timeoutMs: deps.timeoutMs || DEFAULT_SLOT_WIPE_TIMEOUT_MS
    }))
      .then(done, done)
  } catch (e) {
    if (deps.log) deps.log.warn('AuthView: 登录槽位清理抛错: ' + ((e && e.message) || 'unknown'))
    done()
  }
}

module.exports = {
  LOGIN_SLOT_PREFIX,
  LOGIN_SLOT_SUFFIX,
  DEFAULT_SLOT_WIPE_TIMEOUT_MS,
  loginSlotAccountIdOf,
  loginSlotPartitionNameOf,
  isLoginSlotPartitionName,
  resolveSlotWipeTimeoutMs,
  withSlotWipeTimeout,
  wipeLoginSlotCredentials,
  navigateAfterSlotCleanup,
}
