'use strict'
/**
 * pubfail-diagnose.js — P0-8 发布失败被动附带诊断（PR-2）
 *
 * 设计合同（.adversarial/pubfail-diagnose-pr2-20260923/proposal-v3.md，两轮 CCG 评审收敛）：
 *  - 命中限流/额度类错误（classifyProviderFailure ∈ {'rate','quota'}，唯一分类事实源）时，
 *    异步触发一次轻量真机限流自检（复用 rate-limit-self-check 执行端，零网络零额度），
 *    结论恰好一行写 publish.diagnose_result 结构化日志；返回「诊断码」供调用方挂到既有面。
 *  - R5 硬约束：maybeDiagnose 同步返回、内部永不抛、绝不阻断或掩盖主报错；
 *    bootstrap 未装配（setDiagnoseDeps/setEnabled）时整体禁用，零副作用。
 *  - 弹窗面二期（评审 N-1：IPC 包装层不覆盖事件推送、renderer throw 点字段丢失），
 *    本期交付 = 日志面（保证）+ batch 事件 payload diagnoseCode（数据预留）。
 *  - 结论日志走主进程 logger.notify 直写（不经 notify:log IPC，避开其每 key 限速——评审 C-12）。
 */
const { classifyProviderFailure } = require('./adapters/_base/provider-error')

const CACHE_TTL_MS = 10 * 60 * 1000
const THROTTLE_MS = 60 * 1000
const DEFAULT_PROBE_PARAMS = Object.freeze({ rpm: 60, requestCount: 4, requestDurationMs: 20 })
const ASSERTIONS_SUMMARY_MAX = 500

let deps = null // { log, app, runSelfCheck } 由 bootstrap 装配；未装配 = 禁用
let enabled = false
let shutdown = false
let seq = 0
const cache = new Map() // key -> { code, level, ts }（仅 ok/warn 入缓存）
const inflight = new Map() // key -> { code }
const lastRun = new Map() // key -> ts（真实自检触发节流）

/** 诊断码：D- + 6 位 base36（时间低位×素数混合 + 单调序号），仅可读引用不承载语义 */
function newCode () {
  seq += 1
  const mix = (Date.now() % 2176675042) * 31 + seq * 7919
  const s = mix.toString(36)
  return 'D-' + (s.length >= 6 ? s.slice(-6) : s.padStart(6, '0')).toLowerCase()
}

/**
 * 探针选择（评审 N-4）：effectiveRpm ≥ 20 用真实配置（含 rateFactor），
 * 否则降级默认探针——低 rpm（如 video rpm4 理论 45s）跑自检必然突破超时预算，
 * 结论解释为「调度机制本身健康度」而非当前预算，避免恒超时假 fail 的主动误导。
 */
function pickProbe (ctx) {
  let l
  try { l = typeof ctx.getLimits === 'function' ? ctx.getLimits() : null } catch (_) { l = null }
  const eff = l && Number(l.effRpm)
  if (!l || !Number.isFinite(eff) || eff < 20) {
    const theoreticalMs = (DEFAULT_PROBE_PARAMS.requestCount - 1) * (60000 / 60) + DEFAULT_PROBE_PARAMS.requestDurationMs
    return { mode: 'default', params: { ...DEFAULT_PROBE_PARAMS }, theoreticalMs, timeoutMs: 10000 }
  }
  const requestCount = eff >= 30 ? 4 : 3
  const params = {
    rpm: Math.round(eff),
    requestCount,
    requestDurationMs: 20,
    maxConcurrent: l.maxConcurrent, // 不钳制：越界由执行端 _validate TypeError → 上层捕获回退默认探针（评审 N-6）
    cooldownMs: l.cooldownMs,
  }
  const theoreticalMs = (requestCount - 1) * (60000 / eff) + params.requestDurationMs
  return { mode: 'actual', params, theoreticalMs, timeoutMs: Math.max(10000, Math.round(1.5 * theoreticalMs + 2000)) }
}

/** level 确定性映射（评审 C-8/N-7：删除不可达的 rate_limited_count 条件） */
function levelOf (result, theoreticalMs) {
  const assertions = (result && Array.isArray(result.assertions)) ? result.assertions : []
  const failed = assertions.filter((a) => !a || !a.pass)
  if (assertions.length === 0 || failed.length > 0) {
    const names = failed.map((f) => f && f.name).filter(Boolean).join(',') || 'no-assertions'
    return { level: 'fail', summary: 'failed:' + names.slice(0, ASSERTIONS_SUMMARY_MAX) }
  }
  const dur = Number(result.metrics && result.metrics.total_duration_ms) || 0
  if (dur > 1.5 * theoreticalMs) {
    return { level: 'warn', summary: `all-pass but slow: ${dur}ms > ${Math.round(1.5 * theoreticalMs)}ms` }
  }
  return { level: 'ok', summary: 'all-pass' }
}

function writeConclusion (code, cls, ctx, probeMode, level, summary) {
  if (shutdown || !deps || typeof deps.log.notify !== 'function') return
  deps.log.notify('publishDiagnose', 'publish.diagnose_result', {
    errorCategory: cls === 'quota' ? 'quota_exceeded' : 'rate_limited',
    level,
    code,
    source: String(ctx.source || 'unknown'),
    probeMode,
    assertionsSummary: String(summary || '').slice(0, ASSERTIONS_SUMMARY_MAX),
  })
}

/** 启动一次自检调用（同步入口；异常归一为 rejected promise，永不外抛） */
function tryRunSelfCheck (probe) {
  try {
    const p = Promise.resolve(deps.runSelfCheck({ ...probe.params }))
    p.catch(() => {}) // 迟到 reject/resolve 一律自吞，防 unhandledRejection（settled 负责丢弃语义）
    return p
  } catch (e) {
    return Promise.reject(e)
  }
}

function timeoutPromise (ms, code) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error('diagnose-timeout ' + code), { __timeout: true })), ms)
  })
}

/** 在途自检 + 硬超时 + settled 丢弃迟到结论（评审 C-9）+ TypeError 回退默认探针（N-6） */
async function runDiagnose (code, cls, ctx, key) {
  let settled = false
  let probe = pickProbe(ctx)
  const start = Date.now()
  const finish = (level, summary, mode) => {
    if (shutdown || settled) return
    settled = true
    writeConclusion(code, cls, ctx, mode, level, summary)
    if (level !== 'fail') cache.set(key, { code, level, ts: Date.now() })
    inflight.delete(key)
  }
  try {
    const result = await Promise.race([tryRunSelfCheck(probe), timeoutPromise(probe.timeoutMs - (Date.now() - start), code)])
    const { level, summary } = levelOf(result, probe.theoreticalMs)
    finish(level, summary, probe.mode)
  } catch (e) {
    if (e && e.__timeout) {
      finish('fail', String(e.message), probe.mode)
      return
    }
    if (e instanceof TypeError && probe.mode === 'actual') {
      // 执行端 _validate 拒绝真实 limits（越界）→ 回退默认探针重跑（评审 N-6）
      probe = { ...pickProbe({}), mode: 'default-fallback' }
      try {
        const result2 = await Promise.race([tryRunSelfCheck(probe), timeoutPromise(probe.timeoutMs, code)])
        const { level, summary } = levelOf(result2, probe.theoreticalMs)
        finish(level, summary, probe.mode)
        return
      } catch (e2) {
        finish('fail', String((e2 && e2.message) || 'diagnose-error'), probe.mode)
        return
      }
    }
    finish('fail', String((e && e.message) || 'diagnose-error').slice(0, ASSERTIONS_SUMMARY_MAX), probe.mode)
  }
}

/**
 * 命中限流/额度类错误时触发被动诊断。永不抛（评审 N-3）。
 * @param {Error|{message?:string}|{code?:string,errorCode?:string,message?:string}} errLike
 * @param {{source:'governor'|'batch', key?:string, getLimits?:()=>object|null}} ctx
 * @returns {string|null} 应挂到既有面的诊断码；null = 未触发/无结论可挂
 */
function maybeDiagnose (errLike, ctx) {
  try {
    if (!enabled || !deps || typeof deps.runSelfCheck !== 'function' || shutdown) return null
    if (!errLike || typeof errLike !== 'object') return null
    const cls = classifyProviderFailure(errLike)
    if (cls !== 'rate' && cls !== 'quota') return null
    const key = String((ctx && (ctx.key || ctx.source)) || 'default')
    const now = Date.now()
    const cached = cache.get(key)
    if (cached && now - cached.ts < CACHE_TTL_MS) return cached.code // 缓存复用：同码同结论（评审 C-5）
    const fl = inflight.get(key)
    if (fl) return fl.code
    if (now - (lastRun.get(key) || 0) < THROTTLE_MS) return null
    const code = newCode()
    lastRun.set(key, now)
    inflight.set(key, { code })
    // 同步调用 async 主体：runSelfCheck 在首个 await 前同步发起（不拖延主链路微任务语义）
    runDiagnose(code, cls, ctx || {}, key).catch(() => { inflight.delete(key) })
    return code
  } catch (_) {
    return null
  }
}

/**
 * batch 事件 payload 适配（评审 C-2/N-1：本期仅挂数据字段，渲染层不消费）。
 * 命中限流失败 → 返回带 diagnoseCode 的浅拷贝；否则原对象返回（既有字段零改动）。
 */
function augmentBatchFailure (payload) {
  try {
    if (!payload || payload.ok !== false || typeof payload.message !== 'string') return payload
    const code = maybeDiagnose({ message: payload.message }, { source: 'batch', key: 'batch:publish' })
    return code ? { ...payload, diagnoseCode: code } : payload
  } catch (_) {
    return payload
  }
}

/** 配置变更失效钩子（governor.setProviderLimits 路径调用；评审 §8.2「正解」） */
function invalidateDiagnoseCache (key) {
  try {
    if (key === undefined) { cache.clear(); lastRun.clear() } else { cache.delete(String(key)) }
  } catch (_) { /* 永不抛 */ }
}

/** bootstrap 装配点：注入主进程 logger 与 app（注册 before-quit 抑制后续诊断） */
function setDiagnoseDeps (next) {
  try {
    deps = next && next.log && next.app && next.runSelfCheck ? { log: next.log, app: next.app, runSelfCheck: next.runSelfCheck } : null
    if (deps && typeof deps.app.on === 'function') {
      deps.app.on('before-quit', () => { shutdown = true })
    }
  } catch (_) { /* 永不抛 */ }
}

function setEnabled (v) {
  try { enabled = !!v } catch (_) { /* 永不抛 */ }
}

/** 测试专用：全量复位内部状态 */
function __resetDiagnoseState () {
  deps = null
  enabled = false
  shutdown = false
  seq = 0
  cache.clear()
  inflight.clear()
  lastRun.clear()
}

module.exports = {
  maybeDiagnose,
  augmentBatchFailure,
  invalidateDiagnoseCache,
  setDiagnoseDeps,
  setEnabled,
  __resetDiagnoseState,
  _internal: { levelOf, pickProbe, newCode },
}
