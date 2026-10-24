#!/usr/bin/env node
// @ts-check
/**
 * compare-scheduler-models.js — 运营后台 Python 模拟器 vs 桌面端真实 governor 对拍（P2）
 *
 * 固定输入分别跑：python scheduler_simulator.simulate 与桌面端 rate-limit-self-check.runSelfCheck，
 * 比较 max_concurrent_observed / rate_limited_count / quota_exceeded_count / total_duration_ms（容差）。
 * 防止两套调度模型契约漂移（spec: desktop/model-call-observability「模拟器与真实 governor 对拍」）。
 *
 * 用法：node scripts/compare-scheduler-models.js
 * 退出码：0 = 核心用例全部一致；1 = 存在不一致。
 * 已知差异（KNOWN_DIFF_CASES）只记录输出，不影响退出码；详见 runKnownDiffs。
 */
'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const { runSelfCheck, clampConcurrency } = require('../apps/desktop/electron/services/rate-limit-self-check')

// 模拟器子进程的单次预算。30000 是**旧值**（本轮一字未动），本轮补的是"超时/缺 python/真崩
// 三种成因必须报得不一样"，不是把它调宽——调宽要先有分布，见 .quality-gates.md:10021 那次
// 「该 runner 本次作业耗时 1236s（负载型）」的现场。
const DEFAULT_PYTHON_TIMEOUT_MS = 30000
const PYTHON_SIMULATE_TIMEOUT_MS = resolveSpawnTimeout(process.env.MP_PARITY_PYTHON_TIMEOUT_MS)

// 主干红 run 40108163214 那一档 `signal=SIGTERM timeout=30000ms` 当时既无时长样本、也分不开
// 「解释器被饿死（该重跑）」与「模拟器跑不完（该修代码）」。本切片补可归因，不调宽预算。
const DEFAULT_PYTHON_ATTEMPTS = 2
const PYTHON_MAX_ATTEMPTS = resolveMaxAttempts(process.env.MP_PARITY_PYTHON_ATTEMPTS)
const PYTHON_PROBE_TIMEOUT_MS = 8000
/** 探针只回答一件事：这台机器现在能不能把 python 拉起来。它必须是**零依赖**的一行。 */
const PYTHON_PROBE_SCRIPT = 'import sys;print(1)'
/**
 * 预算的出处必须连预算一起写在这里。域要说清：max=400ms 是**本机**一次真实 runParity 的 6 个样本；
 * runner 侧分布不自称已有——那 6 行 `[parity-timing]` 正是本切片开始采的。它只锁一件事：
 * 工作量是 0.1s 量级 ⇒ 30s 不是在保护算法，主干那次超时只可能是环境被饿死，故只对环境档重试一次。
 * 改预算必须先重跑下面的 recheckCmd，并把新的 max/样本数一起改这里。
 */
const PARITY_PYTHON_TIMEOUT_PROVENANCE = {
  localMaxMs: 400, localSamples: 6, localRuns: 1, collectedAt: '2026-10-25', marginMultiplier: 20,
  recheckCmd: "node -e \"require('./scripts/compare-scheduler-models').runParity(1500)\"",
}
const pythonTimingLedger = []

/** 重试上限同口径：`0` 等于关掉重试判据、非整数会让比较恒假而无限重试，两者都回落默认并出声。 */
function resolveMaxAttempts (raw, warns) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PYTHON_ATTEMPTS
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    const msg = '[parity] MP_PARITY_PYTHON_ATTEMPTS=' + raw + ' 非法 ⇒ 回落 ' + DEFAULT_PYTHON_ATTEMPTS
      + '（0 等于关掉重试判据，非整数会让 attempts 比较恒假而无限重试）'
    if (Array.isArray(warns)) warns.push(msg)
    else console.warn(msg)
    return DEFAULT_PYTHON_ATTEMPTS
  }
  return n
}

/** 时长样本只由**真实** spawn 记；注入的 spawnImpl 一律不进台账（假样本会让"预算是否贴脸"的活体检查退化成恒真）。 */
const recordPythonTiming = (entry) => { pythonTimingLedger.push(entry) }
const pythonTimingSnapshot = () => pythonTimingLedger.slice()
const resetPythonTimingLedger = () => { pythonTimingLedger.length = 0 }

/** 只有「被 timeout 杀掉」这一档长成这样：status 为 null 且有 signal。ENOENT（signal 为 null）与真崩（status 非 null）天然落不进来。 */
const isEnvTimeout = (res) => !!(res && res.status === null && res.signal)

/**
 * total_duration_ms 的容差口径。
 *
 * 六组用例的期望耗时跨度约 14 倍（~1.5s → 21s），只用一个绝对容差在量级上不等价：
 * 对 21s 的 quota-5h-real，1500ms 仅 7.1%，CI 满载下挂钟抖动 1653ms 即误判失败；
 * 对 1.5s 的用例，同样 1500ms 却是 100%，形同不设防。
 *
 * 但取 max(下限, 比例) 也还不够：concurrency-real 期望 11000ms 时比例项只有 1100ms，
 * 于是退化回 1500 的固定下限，而 CI 上该用例的实测抖动是 1640ms —— 又一次误判失败。
 * 两个数据点合起来说明真实 governor 的挂钟漂移是「固定项 + 与时长成正比的累积项」
 * （11000 上 14.9%、21000 上 7.9%），既不是纯常量也不是纯比例。
 * 故取 **绝对下限 + 比例 × 期望耗时**，并向上取整为整毫秒：短用例仍由下限保护，
 * 长用例在固定项之上再获得比例余量；该口径在原口径之上单调加宽，不会在任何用例上
 * 收紧出新的假红，而真回归（如 +100% 量级）仍远超容差、照样抓得住。
 *
 * 必须传「模拟器预测值」而非「真实测量值」：用实测值做分母会让一次变慢
 * 自己撑大自己的容差，回归将永远抓不住。
 */
const PARITY_TOLERANCE_FLOOR_MS = 1500
const PARITY_TOLERANCE_RATIO = 0.1

function durationTolerance (expectedMs) {
  const base = Number.isFinite(expectedMs) && expectedMs > 0 ? expectedMs : 0
  return Math.ceil(PARITY_TOLERANCE_FLOOR_MS + base * PARITY_TOLERANCE_RATIO)
}

/**
 * 完成顺序：两侧 timeline 里 `state === 'completed'` 的请求序号序列。
 * 规格把"完成顺序"列为必须一致的指标，那它就必须真的被比较 —— 一条从不执行的 SHALL
 * 比没有这条 SHALL 更危险（读者会以为它有守卫）。
 */
function completionOrder (timeline) {
  return (Array.isArray(timeline) ? timeline : [])
    .filter((e) => e && e.state === 'completed')
    .map((e) => e.req)
}

/**
 * 完成**集合**是否一致（承重判据）。
 *
 * 为什么按集合而不是按序列：#2626 的实际缺陷是"被 429 拒掉的请求被算成完成"——那是**成员**问题，
 * 按集合比较就能抓到，而且它对事件帧饥饿免疫。
 *
 * 为什么序列**不能**当硬判定（别再改回去，这是测出来的）：真实侧的完成次序在饥饿下会翻转。
 * 用 `runSelfCheck` 返回的**未排序** `completion_order` 实测四档饥饿：帧延迟 301/426ms 时
 * 得到 `[1,2,4,3,…]`，1904–1908ms 与 3914–3931ms 时得到 `[1,2,3,4,6,5,…]`，
 * 12 个饥饿样本里 **9 个非升序**（机理：前一条调用的回调被推迟到后一条放行之后才执行，
 * 与 #2606 让并发观测虚高 1 是同一个成因）。按序列做相等判定就是把 #2606 的假红重新引进来。
 * 数据单一副本见 docs/parity-concurrency-measurement-noise.md。
 *
 * @param {number[]} simulated 模拟器完成序
 * @param {number[]} real      真实侧完成序（**必须**是实际次序那份，不能是排序后的投影）
 * @returns {boolean} 成员集合相等为 true；任一入参非数组 ⇒ false（fail closed）
 */
function completionSetMatches (simulated, real) {
  if (!Array.isArray(simulated) || !Array.isArray(real)) return false
  const key = (a) => [...a].sort((x, y) => x - y).join(',')
  return key(simulated) === key(real)
}

/**
 * 完成**序列**是否一致（只留痕，不计入 pass）。
 *
 * 保留理由：翻转本身是有信息量的观测（它同时是 +1 并发噪声的成因）。
 * 但它**不得**升级为硬判定 —— 判据依据与实测见 `completionSetMatches` 的注释与 docs。
 */
function completionOrderSequenceMatches (simulated, real) {
  if (!Array.isArray(simulated) || !Array.isArray(real)) return false
  if (simulated.length !== real.length) return false
  return simulated.every((v, i) => v === real[i])
}

/**
 * 「+1 是不是回调推迟造成的」的因果证据。
 *
 * 为什么必须有它：只凭 `real = sim + 1 且 ≤ 上限` 就豁免，等于把**两种成因相反**的形状
 * 合并放过 —— governor 节奏回归（该等 500ms 却提前放行）同样会得到 +1，而那是真回归。
 *
 * 判据由机制推导，不是调出来的魔数：某个已占用槽位的**挂钟跨度**超过相邻起始间隔
 * `interStartMs` 时，前一个调用的释放必然还没发生、后一个就已经放行了 —— 这正是那多出来的 1。
 * 反过来，提前放行型回归里每个跨度都 ≈ 配置时长，探不到这种超长占用。
 * 再叠一条 `≥ 2 × requestDurationMs` 的下界，避免 rpm 很大（间隔很短）时把普通定时器抖动当成推迟。
 *
 * ⚠️ 不要改用「两个已完成窗口是否重叠」当判据 —— 第一版就是这么写的，然后被自己的机制锁
 *    当场否证：与后一个调用重叠的往往是那条**被 429 拒掉、永远不会 completed** 的请求，
 *    按 completed 过滤就等于看不见真正的重叠（高档 maxSpan=600 却报"无证据"）。
 *
 * @param {Array} timeline 真实侧 timeline（`started_at` / `finished_at` / `state`）
 * @param {object} o
 * @param {number} o.requestDurationMs 单次调用的配置时长
 * @param {number} o.interStartMs      相邻起始间隔（= 60000 / rpm）
 */
const DEFERRAL_MIN_FACTOR = 2

function deferralEvidence (timeline, { requestDurationMs, interStartMs } = {}) {
  const dur = Number.isFinite(requestDurationMs) && requestDurationMs > 0 ? requestDurationMs : 0
  const gap = Number.isFinite(interStartMs) && interStartMs > 0 ? interStartMs : 0
  const bound = Math.max(gap, DEFERRAL_MIN_FACTOR * dur)
  let worst = null
  for (const e of (Array.isArray(timeline) ? timeline : [])) {
    if (!e || !Number.isFinite(e.started_at) || !Number.isFinite(e.finished_at)) continue
    const span = e.finished_at - e.started_at
    if (!worst || span > worst.span) worst = { req: e.req, state: e.state, span }
  }
  const maxSpan = worst ? worst.span : 0
  const observed = bound > 0 && maxSpan >= bound
  return {
    observed,
    maxSpanMs: maxSpan,
    boundMs: bound,
    requestDurationMs: dur,
    interStartMs: gap,
    detail: observed && worst
      ? `req ${worst.req}(${worst.state}) 占用槽位 ${worst.span}ms ≥ 阈值 ${bound}ms（间隔 ${gap}ms / 配置 ${dur}ms×${DEFERRAL_MIN_FACTOR}）`
      : '',
  }
}

/**
 * 并发观测的判据：上限不变量 + **带因果证据的单侧**有界测量噪声。
 *
 * 为什么不写成相等（#2606 的根因，别再改回去）：该值在真实侧由「任务开始 → 其完成回调真正
 * 执行」的窗口计出，所以它的上界由**事件帧**决定而不由调度决定 —— 帧被饿到接近相邻请求
 * 起始间隔时，前一个调用的递减被推迟，就会比确定性模拟器多报 1。**多出来的 1 从不越过
 * 配置上限**，而产品侧自检第 133 行本来就按 `≤ maxConcurrent` 断言。
 * 阈值实验数据只维护一份，见 docs/parity-concurrency-measurement-noise.md；其可执行版本是
 * `test_scheduler_parity.test.js` 的「并发观测的饥饿阈值」，真值表在
 * `scripts/compare-scheduler-models.test.js`。
 *
 * 三条不可让步的次序：
 *   ① 先夹上限、再谈豁免 —— 反了则 cap=1 的用例（rpm30-concurrency1）会把"观测到 2"当噪声放过；
 *   ② 豁免必须有 `deferralEvidence.observed` —— 没有因果证据的 +1 一律判红，否则节奏回归
 *      （提前放行）会被这条判据钉成契约；
 *   ③ 真实侧低于模型一律判红 —— 回调推迟只会让真实侧偏高，反方向只能是调度行为差异。
 *
 * @param {object}  p
 * @param {number}  p.simulated       模拟器观测并发（非负整数）
 * @param {number}  p.real            真实自检观测并发（非负整数）
 * @param {number}  p.maxConcurrent   该组配置上限（≥1 整数）
 * @param {object}  [p.evidence]      deferralEvidence() 的返回值；缺省视为"无证据" ⇒ 不许豁免
 * @returns {{pass:boolean, noiseBypass:boolean, reason:string}}
 */
const MAX_CONCURRENCY_NOISE = 1

function concurrencyCheck ({ simulated, real, maxConcurrent, evidence } = {}) {
  if (!Number.isInteger(simulated) || simulated < 0
    || !Number.isInteger(real) || real < 0
    || !Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    return { pass: false, noiseBypass: false, reason: `判据入参必须是「非负整数 + 上限≥1」：simulated=${simulated} real=${real} maxConcurrent=${maxConcurrent}` }
  }
  if (real > maxConcurrent) {
    return { pass: false, noiseBypass: false, reason: `真实侧观测并发 ${real} 越过配置上限 ${maxConcurrent}（不变量，任何情况不放宽）` }
  }
  if (real < simulated) {
    return { pass: false, noiseBypass: false, reason: `真实侧 ${real} 低于模拟器 ${simulated}：该方向的偏差不可能来自回调推迟，按调度行为回归处理` }
  }
  if (real === simulated) return { pass: true, noiseBypass: false, reason: '' }
  if (real - simulated > MAX_CONCURRENCY_NOISE) {
    return { pass: false, noiseBypass: false, reason: `偏差 ${real - simulated} 超过允许的单侧噪声 ${MAX_CONCURRENCY_NOISE}` }
  }
  // 到这里差值恰为 +1：只有拿得到"回调被推迟"的因果证据才允许豁免。
  if (!evidence || evidence.observed !== true) {
    return {
      pass: false, noiseBypass: false,
      reason: `+1 但无回调推迟证据（maxSpan=${evidence ? evidence.maxSpanMs : 'n/a'}ms / 配置时长=${evidence ? evidence.requestDurationMs : 'n/a'}ms）：`
        + '节奏型回归（提前放行）也会给出 +1，缺证据不得豁免',
    }
  }
  return { pass: true, noiseBypass: true, reason: `命中单侧有界噪声（有因果证据）：simulated=${simulated} real=${real} ≤ 上限 ${maxConcurrent}；${evidence.detail || ''}` }
}

// 上限一律由被测侧自己解析，禁止在此抄第二份 clamp 公式（两份必然漂移）。
function effectiveMaxConcurrent (params) {
  return params.maxConcurrent ?? clampConcurrency(params.rpm)
}

const CASES = [
  { name: 'rpm120-concurrency2', params: { rpm: 120, maxConcurrent: 2, requestCount: 8, requestDurationMs: 20 } },
  { name: 'rpm30-concurrency1', params: { rpm: 30, maxConcurrent: 1, requestCount: 4, requestDurationMs: 20 } },
  { name: 'inject-429', params: { rpm: 120, maxConcurrent: 2, requestCount: 6, requestDurationMs: 20, inject429At: 3, cooldownMs: 300 } },
  { name: 'quota-5h', params: { rpm: 120, maxConcurrent: 2, limitPer5h: 2, requestCount: 4, requestDurationMs: 20 } },
  // 2026-08-13 模拟器并发推进升级后纳入（此前为 KNOWN_DIFF）
  { name: 'quota-5h-real', preset: 'doubao-tts', params: { rpm: 20, maxConcurrent: 2, limitPer5h: 5, requestCount: 8, requestDurationMs: 100 } },
  { name: 'concurrency-real', preset: 'custom(interval<duration)', params: { rpm: 60, maxConcurrent: 2, requestCount: 8, requestDurationMs: 2500 } },
]

/**
 * 已知差异用例（2026-08-13 模拟器并发推进升级后仅剩测量噪声）：
 * - slow-call-concurrency：elevenlabs 慢调用（3s×8，rpm=20，interval==duration 临界）——
 *   模拟器确定性 maxc=1；真实 governor 因定时器时钟误差产生 1ms 级短暂重叠 → maxc=2（测量噪声，非并发能力）。
 *   退出码不因这些差异变为非零；parity 测试断言差异值存在（防漂移）。
 *
 * 为什么 `concurrencyCheck` 已经允许 +1，这条**仍然**留在 KNOWN_DIFF 而不并进 CASES：
 * 它的 +1 是 `interval == duration` 的**结构性常态**（每次都重叠），不是偶发饥饿。
 * 留在这里的断言是「差值恰好等于 1」，比 CASES 侧「0 ≤ 差 ≤ 1 且 ≤ 上限」的豁免**更严**；
 * 移过去等于把一条精确断言换成一条宽松判据 —— 降灵敏度，不是收口径。
 */
const KNOWN_DIFF_CASES = [
  { name: 'slow-call-concurrency', preset: 'elevenlabs', params: { rpm: 20, maxConcurrent: 2, requestCount: 8, requestDurationMs: 3000 } },
]

/**
 * 子进程失败的**唯一**上报口径（三档分开，绝不合成一句话）。
 *
 * 动因：同一句 `Error: python simulator failed: `（**空消息**）在旧载体里已记录两次
 * （`.quality-gates.md:3261`、`:10018-10026`，第二次那条已经写出根因却"避免扩大战线"没做），
 * 2026-10-20 第三次复发。根因是旧代码只判 `res.status`、不读 `res.error`/`res.signal` ⇒
 * ① python 不在 PATH（ENOENT，stderr 空）② 超时被 SIGTERM 杀（status=null、stderr 空）
 * ③ python 真崩（status>0，stderr 有内容）**全部塌成同一句空消息**，
 * 于是每次都要靠 rerun + 跨会话考古定责。这里让红保持红，但红得可归因。
 * ⛔ 刻意不引入 skip：对拍只在 main push 跑（`if: event != pull_request`），
 *    静默 skip 等于把守门关掉还报通过——那是本仓记过的「装饰性门禁」同型。
 * @param {object} res spawnSync 的结果对象
 * @param {{timeoutMs?: number, attempts?: number, probe?: {ok: boolean, ms: number, code: string}|null}} [ctx]
 * @returns {string} 永不为空
 */
function formatSpawnFailure (res, ctx) {
  const timeoutMs = (ctx && ctx.timeoutMs) || PYTHON_SIMULATE_TIMEOUT_MS
  const attempts = (ctx && ctx.attempts) || 1
  const probe = ctx && ctx.probe
  const tail = (s) => String(s || '').trim().split(/\r?\n/).slice(-6).join(' | ').slice(0, 400)
  const status = res.status === null || res.status === undefined ? 'null' : String(res.status)
  const code = (res.error && res.error.code)
    || (/ETIMEDOUT/.test(String((res.error && res.error.message) || '')) ? 'ETIMEDOUT' : '')
  const base = 'cmd=python status=' + status + ' signal=' + (res.signal || '-') + ' timeout=' + timeoutMs + 'ms'
  if (code === 'ENOENT') {
    return base + ' cause=ENOENT ⇒ python 不可用（不在 PATH）。这是**环境不具备**，不是对拍判据不成立；'
      + '核验命令：python --version（Windows runner 上由 setup-python 提供，缺失时先查该步是否被改动）'
  }
  if (code === 'ETIMEDOUT' || (res.error && res.status === null && res.signal)) {
    const retryNote = ' attempts=' + attempts + '/' + PYTHON_MAX_ATTEMPTS
    if (probe && probe.ok) {
      return base + retryNote + ' cause=ETIMEDOUT ⇒ 探针 PROBE_OK（解释器 ' + probe.ms + 'ms 就能拉起）'
        + '而模拟器在预算内跑不完 ⇒ 这不是负载，是真缺陷：查 simulate() 的耗时或这组参数'
    }
    return base + retryNote + ' cause=ETIMEDOUT ⇒ 连探针（python 只打印一个字面量）都没能在预算内返回'
      + '（探针用时=' + (probe ? probe.ms + 'ms' : '未执行') + '）'
      + ' ⇒ 解释器启动本身被饿死，属 runner 负载/抖动，同作业重跑即可归因，不是模拟器算错。'
      + 'stderr=' + (tail(res.stderr) || '(空)')
  }
  return base + ' ⇒ python 侧真实报错（非零退出）：' + (tail(res.stderr) || tail(res.stdout) || '(stderr/stdout 均空，只有 status 可看)')
}

/**
 * 预算可被 env 覆盖以便排障，但**非法值必须回落默认并出声**（与 publish-frequency / task-queue 同口径）。
 * ⛔ 必须挡 `0` 与 `NaN`：`spawnSync({timeout: 0})` 在 Node 里是"永不超时"，
 * 而 `Number('abc') → NaN` 会让超时判据整体失效，两者都比 30s 更坏。
 * @param {string|number|undefined|null} raw
 * @param {string[]} [warns] 传入则把告警收进数组（供测试），否则直接 console.warn
 */
function resolveSpawnTimeout (raw, warns) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PYTHON_TIMEOUT_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    const msg = '[parity] MP_PARITY_PYTHON_TIMEOUT_MS=' + raw + ' 非法 ⇒ 回落 ' + DEFAULT_PYTHON_TIMEOUT_MS
      + 'ms（0 等于关掉超时，NaN 让子进程永不被杀）'
    if (Array.isArray(warns)) warns.push(msg)
    else console.warn(msg)
    return DEFAULT_PYTHON_TIMEOUT_MS
  }
  return Math.trunc(n)
}

/**
 * 跑运营后台的 Python 模拟器，取一组参数的完整结果 `{ metrics, timeline }`。
 *
 * 外部依赖（导出给测试用，但请看清代价）：`python` 必须在 PATH 上，且
 * `ops-center/backend/services/scheduler_simulator.py` 必须可达 —— 它是子进程，不是纯函数。
 * @throws {Error} Python 缺失、30s 超时、或模拟器自身校验失败（参数越界等）
 */
function pythonSimulate (params, opts) {
  const spawn = (opts && opts.spawnImpl) || spawnSync
  const script = [
    "import json, sys",
    "sys.path.insert(0, 'ops-center/backend')",
    "from services.scheduler_simulator import simulate",
    "p = json.loads(sys.argv[1])",
    "r = simulate(p)",
    "print(json.dumps({'metrics': r['metrics'], 'timeline': r['timeline']}))",
  ].join('\n')
  const pyParams = {
    rpm: params.rpm,
    max_concurrent: params.maxConcurrent,
    limit_per_5h: params.limitPer5h != null ? params.limitPer5h : null,
    request_count: params.requestCount,
    request_duration_ms: params.requestDurationMs,
    arrival_interval_ms: 0,
    inject_429_at: params.inject429At != null ? params.inject429At : null,
    exceed_5h: params.limitPer5h != null,
    cooldown_ms: params.cooldownMs != null ? params.cooldownMs : 30000,
  }
  const attemptsCap = (opts && opts.maxAttempts) || PYTHON_MAX_ATTEMPTS
  const log = (opts && opts.logImpl) || ((s) => console.log(s))
  const caseName = (opts && opts.caseName) || '-'
  const isRealSpawn = !opts || !opts.spawnImpl
  const startedAt = {}
  let res = null
  let attempts = 0
  let envTimeout = false
  while (attempts < attemptsCap) {
    attempts++
    const t0 = process.hrtime.bigint()
    res = spawn('python', ['-c', script, JSON.stringify(pyParams)], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: PYTHON_SIMULATE_TIMEOUT_MS,
    })
    const ms = Number((process.hrtime.bigint() - t0) / 1000000n)
    const ok = !!(res && res.status === 0)
    envTimeout = isEnvTimeout(res)
    // 这一行是"预算是否贴脸"的唯一现场证据：没有它，下一次红还是同一句无法归因的话。
    log('[parity-timing] case=' + caseName + ' python_ms=' + ms + ' budget_ms=' + PYTHON_SIMULATE_TIMEOUT_MS
      + ' attempts=' + attempts + ' status=' + (ok ? 'ok' : envTimeout ? 'timeout' : 'fail'))
    if (isRealSpawn) recordPythonTiming({ case: caseName, ms, attempts, ok, envTimeout, budgetMs: PYTHON_SIMULATE_TIMEOUT_MS })
    if (ok) break
    // 只有环境档值得重来：ENOENT（signal 为 null）与真崩（status 非 null）都落不进 isEnvTimeout，
    // 给它们重试等于把"python 没装"读成"再试一次也许就好了"。
    if (envTimeout && attempts < attemptsCap) {
      log('[parity] python 第 ' + attempts + ' 次在 ' + PYTHON_SIMULATE_TIMEOUT_MS + 'ms 预算内未返回 ⇒ 同预算重试（上限 ' + attemptsCap + '）')
      continue
    }
    break
  }
  if (!res || res.status !== 0) {
    // 最终仍失败且属超时档时补一次探针：它把"该重跑"与"该修代码"分开，而这两种处置完全相反。
    // 探针只在这条失败路径上执行，happy path 一个多余子进程都不起。
    let probe = null
    if (envTimeout) {
      const p0 = process.hrtime.bigint()
      let pr = null
      try { pr = spawn('python', ['-c', PYTHON_PROBE_SCRIPT], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: PYTHON_PROBE_TIMEOUT_MS }) } catch (e) { pr = null }
      probe = { ok: !!(pr && pr.status === 0), ms: Number((process.hrtime.bigint() - p0) / 1000000n) }
    }
    throw new Error('python simulator failed: ' + formatSpawnFailure(res || {}, { timeoutMs: PYTHON_SIMULATE_TIMEOUT_MS, attempts, probe }))
  }
  const lines = String(res.stdout || '').trim().split('\n')
  let parsed
  try {
    parsed = JSON.parse(lines[lines.length - 1])
  } catch (e) {
    // status=0 却拿不到 JSON ⇒ 是"输出被污染/被截断"这一档，不能把裸 JSON.parse 栈当结论抛出去
    throw new Error('PYTHON_OUTPUT_UNPARSEABLE: python 退出码为 0 但末行不是 JSON（'
      + String(e && e.message).slice(0, 80) + '）末行=' + JSON.stringify(String(lines[lines.length - 1] || '').slice(0, 160))
      + ' 行数=' + lines.length)
  }
  return parsed
}

function pythonMetrics (params) {
  return pythonSimulate(params).metrics
}

async function runParity (toleranceMs = PARITY_TOLERANCE_FLOOR_MS) {
  const results = []
  for (const c of CASES) {
    const sim = pythonSimulate(c.params, { caseName: c.name })
    const py = sim.metrics
    const real = await runSelfCheck(c.params)
    // 下限取调用方传入值（默认 1500ms），并按期望耗时放大比例余量；
    // 分母必须是 py.total_duration_ms（预测值），不得用 real，见 durationTolerance 注释。
    const allowed = Math.max(toleranceMs, durationTolerance(py.total_duration_ms))
    const cap = effectiveMaxConcurrent(c.params)
    // +1 的因果证据取**真实侧** timeline：要判的是"真实侧的回调是否被推迟"。
    // 阈值两项都取自该组参数本身（间隔 = 60000/rpm），不是调出来的魔数。
    const evidence = deferralEvidence(real.timeline, {
      requestDurationMs: c.params.requestDurationMs ?? 20,
      interStartMs: 60000 / (c.params.rpm || 60),
    })
    const conc = concurrencyCheck({
      simulated: py.max_concurrent_observed,
      real: real.metrics.max_concurrent_observed,
      maxConcurrent: cap,
      evidence,
    })
    const simOrder = completionOrder(sim.timeline)
    // 真实侧**只能**取 runSelfCheck 单独返回的实际完成次序：它返回的 timeline 排过 req 序，
    // 从那份投影里"重新算完成顺序"会得到恒为升序的假数据 —— 拿它比较等于比较一个常量。
    // 这里刻意不做兜底：字段缺席就让集合判据 fail closed，而不是退回那个恒真投影。
    const realOrder = real.completion_order
    const checks = {
      max_concurrent_observed: conc.pass,
      rate_limited_count: real.metrics.rate_limited_count === py.rate_limited_count,
      quota_exceeded_count: real.metrics.quota_exceeded_count === py.quota_exceeded_count,
      total_duration_ms: Math.abs(real.metrics.total_duration_ms - py.total_duration_ms) <= allowed,
      // 完成**集合**计入 pass（#2626 的形状就是成员错判：被 429 拒掉的请求被算成完成）。
      // 完成**序列**不计入 —— 它在饥饿下会真实翻转（实测 9/12），按序列判等就是重造 #2606 的假红。
      completion_set: completionSetMatches(simOrder, realOrder),
    }
    results.push({
      name: c.name,
      python: py,
      real: real.metrics,
      checks,
      allowedTotalDurationMs: allowed,
      // 上限随结果一起带出：打印时若回头按 name 去 CASES 里 find，改名就是空指针。
      maxConcurrent: cap,
      diffTotalDurationMs: real.metrics.total_duration_ms - py.total_duration_ms,
      // 命中豁免必须留痕：静默通过的容差是下一轮"为什么这条不红"的起点。
      concurrency: conc,
      deferralEvidence: evidence,
      completionOrder: { simulated: simOrder, real: Array.isArray(realOrder) ? realOrder : null },
      // 承重的那条：集合是否一致（与 checks 共用同一实现，避免两份判据口径漂移）
      completionSetDiverges: !completionSetMatches(simOrder, realOrder),
      // 只留痕：序列翻转在饥饿下是真实且正常的观测，不构成判定
      completionSequenceDiverges: !completionOrderSequenceMatches(simOrder, realOrder),
      noiseBypass: conc.noiseBypass,
      pass: Object.values(checks).every(Boolean),
    })
  }
  return results
}

async function runKnownDiffs () {
  const results = []
  for (const c of KNOWN_DIFF_CASES) {
    const py = pythonMetrics(c.params)
    const real = await runSelfCheck(c.params)
    results.push({
      name: c.name,
      preset: c.preset,
      python: py,
      real: real.metrics,
      diff: {
        max_concurrent_observed: real.metrics.max_concurrent_observed - py.max_concurrent_observed,
        total_duration_ms: real.metrics.total_duration_ms - py.total_duration_ms,
      },
      note: '已知（测量噪声）：interval==duration 临界下真实 governor 定时器误差导致 1ms 级重叠，maxc 比确定性模拟器高 1',
    })
  }
  return results
}

async function main () {
  const results = await runParity()
  let ok = true
  for (const r of results) {
    console.log('[' + (r.pass ? 'PASS' : 'FAIL') + '] ' + r.name)
    console.log('  python :', JSON.stringify(r.python))
    console.log('  real   :', JSON.stringify(r.real))
    console.log('  checks :', JSON.stringify(r.checks))
    // 每次都打印并发三元值（而不只在失败时）：判据是否被频繁命中，需要的是一段时间的分布，
    // 不是某一个红样本 —— 与 durationTolerance 注释里那条教训同源。
    console.log('  maxc   : sim=' + r.python.max_concurrent_observed
      + ' real=' + r.real.max_concurrent_observed
      + ' cap=' + r.maxConcurrent
      + ' 推迟证据=' + (r.deferralEvidence.observed ? '有' : '无')
      + ' 最大跨度=' + r.deferralEvidence.maxSpanMs + 'ms'
      + (r.noiseBypass ? '  [噪声豁免命中] ' + r.concurrency.reason : ''))
    // 每次都打印两侧序列本身：红了要能一眼看出是谁多/少哪一项，只报布尔值等于把归因推给复跑。
    // 序列不一致但集合一致时明确标"仅次序（饥饿下属正常）"，免得下一个人把留痕当判据去收紧。
    console.log('  完成   : sim=' + JSON.stringify(r.completionOrder.simulated)
      + ' real=' + JSON.stringify(r.completionOrder.real)
      + (r.completionSetDiverges ? '  [集合不一致 ⇒ 已计入判据]'
        : (r.completionSequenceDiverges ? '  [仅次序不同（饥饿下属正常，不计入判据）]' : '')))
    if (!r.pass && r.concurrency && !r.concurrency.pass) console.log('  maxc 判红原因 :', r.concurrency.reason)
    if (!r.pass) ok = false
  }
  const known = await runKnownDiffs()
  for (const r of known) {
    console.log('[KNOWN DIFF] ' + r.name + ' (' + r.preset + ')')
    console.log('  python :', JSON.stringify({ maxc: r.python.max_concurrent_observed, total: r.python.total_duration_ms }))
    console.log('  real   :', JSON.stringify({ maxc: r.real.max_concurrent_observed, total: r.real.total_duration_ms, no_network: r.real.network_calls === 0 }))
    console.log('  diff   :', JSON.stringify(r.diff))
    console.log('  note   :', r.note)
  }
  console.log(known.length ? 'KNOWN_DIFFS: ' + known.length + ' cases recorded (documented limitation, not parity failure)' : 'KNOWN_DIFFS: none')
  console.log(ok ? 'PARITY OK' : 'PARITY MISMATCH')
  process.exit(ok ? 0 : 1)
}

module.exports = { runParity, CASES, runKnownDiffs, KNOWN_DIFF_CASES, durationTolerance, concurrencyCheck, deferralEvidence, completionOrder, completionSetMatches, completionOrderSequenceMatches, effectiveMaxConcurrent, pythonMetrics, pythonSimulate, formatSpawnFailure, resolveSpawnTimeout, resolveMaxAttempts, isEnvTimeout, recordPythonTiming, PARITY_PYTHON_TIMEOUT_PROVENANCE, pythonTimingSnapshot, resetPythonTimingLedger, PYTHON_SIMULATE_TIMEOUT_MS, DEFAULT_PYTHON_TIMEOUT_MS, PYTHON_MAX_ATTEMPTS, DEFAULT_PYTHON_ATTEMPTS, PYTHON_PROBE_SCRIPT, PYTHON_PROBE_TIMEOUT_MS, PARITY_TOLERANCE_FLOOR_MS, PARITY_TOLERANCE_RATIO }

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1) })
}

