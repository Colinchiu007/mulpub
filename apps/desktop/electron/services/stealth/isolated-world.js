// @ts-check
/**
 * isolated-world.js — F2 隔离世界执行通道（PRD §3.3 / tasks 4.1-4.4 + 11.3 + 11.4）
 *
 * 把页面求值从主世界迁到**隔离世界**（`Page.createIsolatedWorld`），使 RPA 侧的
 * 合成点击/填值脚本与页面自身的反自动化探针在 JS 可见性层面互相隔离。
 *
 * ## spike 实测偏差（2026-10-14，f2-spike.js / f2-spike2.js，产物归档 D:/Temp/opencode）
 * PRD §3.3 原计划步骤与实测的三处出入，以实测为准：
 * 1. **不调 `Page.enable`**：`Page.getFrameTree` / `Page.createIsolatedWorld` /
 *    `Runtime.evaluate` 在未 enable 时全部可用 → 实现省略该步。
 * 2. **`Page.Frame` 无 `documentId` 字段**：双键缓存第二键改用 **`loaderId`**
 *    （跨导航必更替；同文档 hash 跳转保持 —— 与 did-navigate-in-page 不触发
 *    重建的语义恰好一致）。
 * 3. **失败形态有两种，必须分别处理**：
 *    - 导航后旧 contextId：`Runtime.evaluate` **命令级 reject**
 *      （`Cannot find context with specified id`）→ 清缓存重建重试一次；
 *    - 页面代码抛错：`Runtime.evaluate` **resolve 且带 `exceptionDetails`**
 *      （**不 reject**）→ 必须显式检查，否则异常被吞成 undefined。
 *
 * ## 执行链（每 op）
 * attach('1.3') → Page.getFrameTree 取 top frame (frameId, loaderId) 双键 →
 * 与缓存比对（+ stale 标志）→ 不符则 Page.createIsolatedWorld + 写 nonce →
 * execute 前 nonce probe 探活（失配重建一次）→ Runtime.evaluate(expression,
 * returnByValue, awaitPromise) → exceptionDetails 检查 → finally detach。
 *
 * **任何一步失败/超时 → `logger.warn` + 主世界 `executeJavaScript` 回落**
 * （warn 禁静默：静默回落会让「隔离通道从未生效」不可观测）。
 *
 * ## 范围声明（tasks 11.4 / 4.2）
 * - **top-frame only**：只用 `frameTree.frame`，childFrames 忽略。iframe 内部
 *   元素 v1 不覆盖 —— 调用方 resolve 不到元素时由 helpers 层 warn 并回落主世界
 *   （主世界本就是迁移前的行为，无功能损失）。
 * - **通信 binding 不动**：`contextBridge.exposeInMainWorld` 类通信入口一律留
 *   主世界（v1 范围声明，理由入 PRD 决策节）。`BINDING_ISOLATED_ALLOWLIST`
 *   初始为空表；任何 binding 名试图走隔离通道必须抛
 *   `ISOLATED_BINDING_NOT_ALLOWED:<name>`（tasks 11.3 白名单守卫）。
 */
'use strict'

/** 隔离世界 worldName（同名二次 createIsolatedWorld 幂等返回同 contextId —— spike 实证）。 */
const ISOLATED_WORLD_NAME = 'mp-rpa-iso'

/** CDP 命令链总超时（attach / getFrameTree / create / probe / expression 共享预算）。 */
const DEFAULT_TIMEOUT_MS = 3000

/**
 * 允许走隔离世界的通信 binding 白名单（tasks 11.3）。
 * v1 为**空表**：通信类 binding（exposeBinding/exposeInMainWorld/ipcRenderer 等）
 * 全部留主世界（tasks 4.2/4.4 范围声明）。扩表必须伴随 PRD 决策节更新。
 * @type {string[]}
 */
const BINDING_ISOLATED_ALLOWLIST = []

/**
 * 守卫：binding 名不在白名单内一律抛错（fail-closed，禁静默放行）。
 * @param {string} name
 */
function assertIsolatedBindingAllowed (name) {
  if (!BINDING_ISOLATED_ALLOWLIST.includes(name)) {
    throw new Error('ISOLATED_BINDING_NOT_ALLOWED:' + name)
  }
}

/** webContents → { frameId, documentId, contextId, nonce, stale }（per-webContents 隔离态）。 */
const CACHE = new WeakMap()
/** 已挂失效事件（did-navigate / did-navigate-in-page）的 webContents，防重复注册。 */
const LISTENED = new WeakSet()

/** nonce：随机串，写进隔离世界 window.__mpIsoNonce，execute 前读回比对（探活 + 防错世界）。 */
function genNonce () {
  return 'iso-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

/**
 * 给 promise 加总超时。race 内部会为原 promise 挂 settle handler，
 * 故超时后**迟到的 reject 不会产生 unhandledRejection**（Promise.race 语义）。
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout (p, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('ISOLATED_EVAL_TIMEOUT:' + label)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** 命令级 context 失效判定（导航后旧 contextId 的 reject 文案族）。 */
function isContextGone (err) {
  const msg = String((err && err.message) || '')
  return /Cannot find context|Execution context was destroyed|context.*not found/i.test(msg)
}

/**
 * 创建隔离世界求值器（per-webContents）。
 *
 * @param {{ debugger: any, executeJavaScript: Function, on: Function }} webContents
 * @param {{ logger?: { warn: Function }, timeoutMs?: number }} [opts]
 * @returns {(code: string) => Promise<any>} 求值函数；失败自动 warn + 主世界回落
 */
function createIsolatedEvaluator (webContents, opts = {}) {
  const logger = opts.logger || console
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
    ? opts.timeoutMs
    : DEFAULT_TIMEOUT_MS

  // 事件层失效（tasks 4.2：导航后即使双键相同也必须重建 —— stale 优先于双键比对）
  if (!LISTENED.has(webContents)) {
    LISTENED.add(webContents)
    const invalidate = () => {
      const c = CACHE.get(webContents)
      if (c) c.stale = true
    }
    webContents.on('did-navigate', invalidate)
    webContents.on('did-navigate-in-page', invalidate)
  }

  const dbg = webContents.debugger

  /** 单条 CDP 命令（超时预算由外层 executeChain 统一挂）。 */
  function send (method, params) {
    return dbg.sendCommand(method, params)
  }

  /**
   * 在指定 context 执行表达式。
   * returnByValue + awaitPromise 对齐 webContents.executeJavaScript 语义
   * （调用方从主世界迁来时对返回值/异步行为的预期不变）。
   */
  function evalIn (contextId, expression) {
    return send('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    })
  }

  /** 新建隔离世界上下文 + 写 nonce + 落缓存。 */
  async function createFreshContext (frameId, loaderId) {
    const created = await send('Page.createIsolatedWorld', {
      frameId,
      worldName: ISOLATED_WORLD_NAME,
      // CDP 历史拼写（grantUniveralAccess）—— spike 按此实测通过
      grantUniveralAccess: true,
    })
    const contextId = created.executionContextId
    const nonce = genNonce()
    await evalIn(contextId, 'try{window.__mpIsoNonce=' + JSON.stringify(nonce) + '}catch(e){}')
    const cache = { frameId, documentId: loaderId, contextId, nonce, stale: false }
    CACHE.set(webContents, cache)
    return cache
  }

  /**
   * 一次完整隔离执行（不含回落）。抛错 = 交给 evaluate 决定重试或回落。
   * @param {string} code
   */
  async function runIsolated (code) {
    // per-op attach：已附着时复用他方 attach（owned=false 才 detach，防误拆别人的会话）
    let owned = false
    try {
      if (typeof dbg.isAttached === 'function' && dbg.isAttached()) {
        owned = false
      } else {
        await dbg.attach('1.3')
        owned = true
      }
      return await executeChain(code)
    } finally {
      if (owned) {
        try { await dbg.detach() } catch (_e) { /* 已被他方拆掉，忽略 */ }
      }
    }
  }

  /**
   * 核心链：getFrameTree 双键 → 缓存/stale 判定 → create → probe → expression。
   * @param {string} code
   */
  async function executeChain (code) {
    // 1) top frame 双键（不调 Page.enable —— spike B 实证可用）
    const tree = await send('Page.getFrameTree', {})
    const top = tree.frameTree.frame
    const frameId = top.id
    const loaderId = top.loaderId

    // 2) 双键 + stale 判定（stale 优先：事件已宣告失效时即使双键相同也重建）
    let cache = CACHE.get(webContents)
    const needCreate = !cache || cache.stale || cache.frameId !== frameId || cache.documentId !== loaderId
    if (needCreate) {
      cache = await createFreshContext(frameId, loaderId)
    }

    // 3) execute 前探活（防 contextId 跨文档被回收复用给别的文档 —— spike 实证同名幂等/跨文档复用）
    const probe = await evalIn(cache.contextId, 'try{return window.__mpIsoNonce||null}catch(e){return null}')
    if (probe.exceptionDetails || !probe.result || probe.result.value !== cache.nonce) {
      cache = await createFreshContext(frameId, loaderId)
      const probe2 = await evalIn(cache.contextId, 'try{return window.__mpIsoNonce||null}catch(e){return null}')
      if (probe2.exceptionDetails || !probe2.result || probe2.result.value !== cache.nonce) {
        throw new Error('ISOLATED_PROBE_FAILED: nonce mismatch after rebuild')
      }
    }

    // 4) expression（exceptionDetails 显式检查 —— 页面抛错 resolve 不 reject）
    const res = await evalIn(cache.contextId, code)
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception && res.exceptionDetails.exception.description
      throw new Error('ISOLATED_EVAL_EXCEPTION: ' + (desc || 'unknown'))
    }
    return res.result ? res.result.value : undefined
  }

  /**
   * 求值入口：隔离优先；context-gone 重建重试一次；其余失败 warn + 主世界回落。
   * @param {string} code
   * @returns {Promise<any>}
   */
  async function evaluate (code) {
    let retried = false
    for (;;) {
      try {
        return await withTimeout(runIsolated(code), timeoutMs, 'cdp-chain')
      } catch (err) {
        const msg = String((err && err.message) || err)
        // context-gone（导航竞态）→ 清缓存全链重建，仅重试一次
        if (isContextGone(err) && !retried) {
          retried = true
          CACHE.delete(webContents)
          continue
        }
        // 任何失败（attach 失败 / 超时 / probe 失败 / exceptionDetails / 命令错）→ 回落
        logger.warn(
          'StealthIso',
          'isolated eval 回落主世界: ' + msg + ' | code=' + String(code).slice(0, 80)
        )
        return await webContents.executeJavaScript(code)
      }
    }
  }

  return evaluate
}

module.exports = {
  createIsolatedEvaluator,
  BINDING_ISOLATED_ALLOWLIST,
  assertIsolatedBindingAllowed,
  ISOLATED_WORLD_NAME,
  DEFAULT_TIMEOUT_MS,
}
