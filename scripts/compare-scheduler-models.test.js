// @ts-check
/**
 * scripts/compare-scheduler-models.test.js — 对拍容差口径的回归保护
 *
 * 背景（2026-09-26 main 红）：runParity 对 6 组用例共用一个 1500ms **绝对**容差，
 * 但各组期望耗时跨度约 14 倍（~1.5s → 21s）。对 21s 的 quota-5h-real，1500ms 只有
 * 7.1%，CI 满载下挂钟抖动 1653ms 即翻车（python=21000 / real=22653）；而对 1.5s 的
 * 用例，同样 1500ms 等于 100% —— 绝对容差在不同量级的用例上本就不等价。
 *
 * 第二次超差（同一天的后续红，PR #2414 的 QG Desktop Shards (1/2)，基线已含上一轮修复）：
 * concurrency-real python=11000 / real=12640 → diff **1640**，而 max(1500, 10%) 在该量级
 * 只给 1500（比例项 1100 < 下限）→ 仍然误判失败。两个数据点合起来说明 CI 挂钟漂移是
 * 「**固定项 + 比例项**」：11000 上 14.9%、21000 上 7.9%，纯 max() 在中间量级会退化回固定项。
 * 故口径改为 floor + ratio × 期望（向上取整为整毫秒），且**只在原口径之上加宽**。
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  durationTolerance, concurrencyCheck, deferralEvidence, completionOrder, completionSetMatches, completionOrderSequenceMatches,
  effectiveMaxConcurrent, PARITY_TOLERANCE_FLOOR_MS, PARITY_TOLERANCE_RATIO,
} = require('./compare-scheduler-models')
// 上限解析必须与被测侧同源：本文件断言"对拍侧不抄第二份 clamp 公式"，
// 所以要拿真实现来比，而不是在这里重写一遍 Math.max/min。
const { clampConcurrency } = require('../apps/desktop/electron/services/rate-limit-self-check')

// 因果证据夹具：**与真实形状同形**（span 被拉长到 ≥2× 配置时长且窗口重叠），
// 不是为通过而构造的干净样例 —— 缺证据不许豁免正是本轮评审提的 Critical。
const deferred = {
  observed: true, maxSpanMs: 600, requestDurationMs: 20,
  detail: 'req 1[0→600,span=600] 与 req 2[500→520] 重叠且跨度 ≥ 2×20ms',
}

describe('durationTolerance — 容差 = 绝对下限 + 比例 × 期望耗时（向上取整）', () => {
  it('短用例由下限主导，只额外获得自身量级的比例余量', () => {
    assert.equal(durationTolerance(1500), 1650)
    assert.equal(durationTolerance(1000), 1600)
    assert.equal(durationTolerance(0), 1500)
  })

  it('长用例获得下限加与量级成比例的余量', () => {
    assert.equal(durationTolerance(21000), 3600)
    assert.equal(durationTolerance(11000), 2600)
    assert.equal(durationTolerance(30000), 4500)
  })

  it('容差必须是整毫秒（比例项会产生小数，向上取整只会更宽）', () => {
    const t = durationTolerance(14999)
    assert.equal(t, 3000) // 1500 + 1499.9 → ceil 3000
    assert.equal(Number.isInteger(t), true, '容差不得是小数')
    for (const e of [1, 7, 333, 12345, 99999]) {
      assert.equal(Number.isInteger(durationTolerance(e)), true, '非整毫秒: ' + e)
    }
  })

  it('复现第二次真实超差：concurrency-real 期望 11000、差值 1640 必须通过', () => {
    // CI 实跑（run 36222207527 / job 108349933889）：python=11000, real=12640 → diff 1640
    const expected = 11000
    const diff = 1640
    const previousModel = Math.max(PARITY_TOLERANCE_FLOOR_MS, expected * PARITY_TOLERANCE_RATIO)
    assert.ok(diff > previousModel, '前提：上一轮 max() 口径确实抓不住这个抖动（否则本用例不成立）')
    assert.ok(diff <= durationTolerance(expected), '新口径必须吸收这次抖动')
  })

  it('新口径在任意期望耗时上都不得比旧口径更紧（只放宽，不引入新假红）', () => {
    for (const e of [0, 500, 1000, 1500, 3000, 9000, 11000, 14999, 15000, 21000, 30000, 60000, 120000]) {
      const previous = Math.max(PARITY_TOLERANCE_FLOOR_MS, e * PARITY_TOLERANCE_RATIO)
      assert.ok(durationTolerance(e) >= previous, '收紧了: expected=' + e + ' new=' + durationTolerance(e) + ' old=' + previous)
    }
  })

  it('复现 main 上的真实超差：1653ms 抖动必须被判通过', () => {
    // python=21000, real=22653 → diff 1653，旧口径 1653>1500 判失败
    const expected = 21000
    const diff = Math.abs(22653 - expected)
    assert.ok(diff > PARITY_TOLERANCE_FLOOR_MS, '前提：该抖动确实超出旧的绝对下限')
    assert.ok(diff <= durationTolerance(expected), '新口径应吸收这次抖动')
  })

  it('真实回归仍要能抓住：长用例大幅超时不得被比例项放过', () => {
    const expected = 21000
    assert.ok(5000 > durationTolerance(expected), '+5s（约 24%）应超容差')
    assert.ok(1000 < durationTolerance(expected), '1s 抖动应被吸收')
  })

  it('容差必须由「期望值」而非「实测值」驱动，否则回归会撑大自己的容差', () => {
    // 若实现误用 real 作分母：real=31000 → 容差 4600，+10s 回归反而通过（自证式绿灯）
    const expected = 21000
    const tolerance = durationTolerance(expected)
    assert.equal(tolerance, PARITY_TOLERANCE_FLOOR_MS + expected * PARITY_TOLERANCE_RATIO)
    assert.ok(
      durationTolerance(expected) === durationTolerance(expected),
      '同一期望值必须得到确定结果（不依赖实测）',
    )
    // 关键断言：把实测值当期望值传入会得到更大容差 —— 证明调用方必须传 python 侧
    assert.ok(durationTolerance(31000) > tolerance)
  })

  it('退化输入不产生 NaN / 负容差', () => {
    for (const v of [0, -1, NaN, undefined, null]) {
      const t = durationTolerance(v)
      assert.ok(Number.isFinite(t), '非有限值: ' + String(v))
      assert.ok(t >= PARITY_TOLERANCE_FLOOR_MS, '容差不得小于下限: ' + String(v))
    }
  })

  it('比例与下限常量取值合理且被导出（供测试与排障引用）', () => {
    assert.equal(PARITY_TOLERANCE_FLOOR_MS, 1500)
    assert.ok(PARITY_TOLERANCE_RATIO >= 0.05 && PARITY_TOLERANCE_RATIO <= 0.2,
      '比例应在 5%~20% 区间：实测抖动 7.9%，留适度余量但不放过真回归')
  })
})

/**
 * concurrencyCheck — 并发观测判据的真值表（#2606）。
 *
 * 为什么放这个文件而不是 vitest 那个：本文件测的是**判定函数本身**（纯数据、零依赖、秒级），
 * 已在 `quality-gate.yml` Gate 2b 的 `node --test` 里、每次 PR 都跑；而
 * `test_scheduler_parity.test.js` 所在的 `electron-tests` 串行单测步骤带
 * `if: github.event_name != 'pull_request'` —— **PR 上整步被跳过**。判据合同若只写在那边，
 * 等于"回归只能在合进 main 之后才发现"。与上面 durationTolerance 口径同处一室也是既有先例。
 *
 * 判据来历（不是"抖动就放宽"）：`max_concurrent_observed` 在真实侧由「任务开始 → 其完成回调
 * 真正执行」的窗口计出，故事件帧被饿到接近相邻请求起始间隔时必然多报 1。同进程饥饿阈值实验
 * （40ms 不翻 / 600ms 必翻，间隔 500ms）与完整取证见 docs/parity-concurrency-measurement-noise.md。
 * 关键：**多出来的 1 从未越过配置上限**，而产品侧自检本来就按 `≤ maxConcurrent` 断言。
 */
describe('concurrencyCheck — 上限不变量 + 单侧有界噪声', () => {
  it('相等时通过，且不算命中噪声豁免', () => {
    const r = concurrencyCheck({ simulated: 2, real: 2, maxConcurrent: 2 })
    assert.equal(r.pass, true)
    assert.equal(r.noiseBypass, false)
  })

  it('真实侧比模型多 1 且有推迟证据 ⇒ 通过，但必须如实标出命中豁免', () => {
    const r = concurrencyCheck({ simulated: 1, real: 2, maxConcurrent: 2, evidence: deferred })
    assert.equal(r.pass, true, JSON.stringify(r))
    assert.equal(r.noiseBypass, true, '豁免不得静默生效，否则没人知道这次是靠噪声口径过的')
  })

  // QM-6 后端评审的 Critical：无条件的 +1 豁免会把"governor 提前放行"这类节奏回归
  // 钉成契约 —— 它同样给出 real = sim + 1 且 ≤ 上限，但没有任何调用被拖长。
  it('+1 但没有回调推迟证据 ⇒ 判红（豁免必须有因果证据）', () => {
    const noEvidence = { observed: false, maxSpanMs: 22, requestDurationMs: 20, detail: '' }
    const r = concurrencyCheck({ simulated: 1, real: 2, maxConcurrent: 2, evidence: noEvidence })
    assert.equal(r.pass, false, '节奏型回归也会给 +1，缺证据不得放过：' + JSON.stringify(r))
    assert.equal(r.noiseBypass, false)
  })

  it('完全不传 evidence ⇒ 与"证据为否"同判（缺信息不得当成有证据）', () => {
    assert.equal(concurrencyCheck({ simulated: 1, real: 2, maxConcurrent: 2 }).pass, false)
    assert.equal(concurrencyCheck({ simulated: 1, real: 2, maxConcurrent: 2, evidence: undefined }).pass, false)
  })

  it('多 1 但同时越过配置上限 ⇒ 判红（上限不变量任何情况不放宽）', () => {
    const r = concurrencyCheck({ simulated: 2, real: 3, maxConcurrent: 2, evidence: deferred })
    assert.equal(r.pass, false, '2+1=3 已超上限 2，必须红：' + JSON.stringify(r))
  })

  it('真实侧低于模型 ⇒ 判红（该方向的偏差只能来自调度行为差异）', () => {
    const r = concurrencyCheck({ simulated: 2, real: 1, maxConcurrent: 2, evidence: deferred })
    assert.equal(r.pass, false, JSON.stringify(r))
  })

  it('多 2 及以上 ⇒ 判红（豁免只到 +1，不是万能容差）', () => {
    assert.equal(concurrencyCheck({ simulated: 1, real: 3, maxConcurrent: 4, evidence: deferred }).pass, false)
  })

  // 这条是判据设计的关键后果，不能只靠推导：cap=1 的用例（rpm30-concurrency1）里
  // 豁免被上限夹住后**等价于仍要求相等**，否则"+1"就把真实的单并发违约吃掉了。
  // 也因此「先夹上限、再谈豁免」的顺序不可调换 —— 由变异 M6 证明这条断言不是空的。
  it('配置上限为 1 时 +1 豁免必须失效（被上限夹住 ⇒ 等价严格相等）', () => {
    const r = concurrencyCheck({ simulated: 1, real: 2, maxConcurrent: 1, evidence: deferred })
    assert.equal(r.pass, false, 'maxConcurrent=1 时观测到 2 就是违约，必须红：' + JSON.stringify(r))
    assert.equal(concurrencyCheck({ simulated: 1, real: 1, maxConcurrent: 1 }).pass, true)
  })

  it('复现 #2606 的真实形状：sim=1 / real=2 / 上限=2 / 有推迟证据 ⇒ 判通过', () => {
    // main 4770b0b5 / run 36483489315：inject-429 组 python=1、real=2、该组配置上限=2；
    // 本机用 600ms 同进程阻塞可稳定复现同一形状（20ms 调用被记成 600ms）。
    const r = concurrencyCheck({
      simulated: 1, real: 2,
      maxConcurrent: effectiveMaxConcurrent({ rpm: 120, maxConcurrent: 2 }),
      evidence: deferred,
    })
    assert.equal(r.pass, true, JSON.stringify(r))
    assert.equal(r.noiseBypass, true)
  })

  it('上限缺省时由被测侧 clampConcurrency 解析，不在对拍侧抄第二份公式', () => {
    for (const rpm of [6, 20, 60, 120]) {
      assert.equal(effectiveMaxConcurrent({ rpm }), clampConcurrency(rpm), 'rpm=' + rpm)
    }
    assert.equal(effectiveMaxConcurrent({ rpm: 120, maxConcurrent: 2 }), 2, '显式配置必须优先于 clamp')
  })

  // 无效域一律 fail closed。一个导出的真值表函数若接受 simulated=-1 还"通过"，
  // 下一个调用方就会以为那个绿灯有意义。
  it('入参非「非负整数 / 上限≥1」⇒ 判红（无效域 fail closed）', () => {
    for (const bad of [undefined, null, NaN, -1, 1.5, '2']) {
      assert.equal(concurrencyCheck({ simulated: 1, real: bad, maxConcurrent: 2 }).pass, false,
        'real=' + String(bad))
      assert.equal(concurrencyCheck({ simulated: bad, real: 1, maxConcurrent: 2 }).pass, false,
        'simulated=' + String(bad))
      assert.equal(concurrencyCheck({ simulated: 1, real: 1, maxConcurrent: bad }).pass, false,
        'maxConcurrent=' + String(bad))
    }
    assert.equal(concurrencyCheck({ simulated: 1, real: 1, maxConcurrent: 0 }).pass, false, '上限 0 不合法')
    assert.equal(concurrencyCheck().pass, false, '整个入参缺失也必须红，不得抛异常')
  })
})

/**
 * deferralEvidence — 「+1 是不是回调推迟」的因果探测器。
 *
 * 它是 Critical 修复的另一半：判据要求证据，那**证据本身必须有真值表**，
 * 否则"有没有证据"就退化成第二个可以随手糊过去的布尔值。
 */
describe('deferralEvidence — 区分"回调被推迟"与"提前放行"', () => {
  const t = (req, start, end, state = 'completed') => ({ req, started_at: start, finished_at: end, state })
  // inject-429 那组的真实形状：单次 20ms、rpm=120 ⇒ 相邻起始间隔 500ms
  const OPT = { requestDurationMs: 20, interStartMs: 500 }

  it('本机高档饥饿的真实形状（20ms 调用占用槽位 600ms > 间隔 500ms）⇒ 有证据', () => {
    const ev = deferralEvidence([t(1, 0, 600), t(2, 1200, 1220)], OPT)
    assert.equal(ev.observed, true, JSON.stringify(ev))
    assert.ok(ev.maxSpanMs >= 600)
    assert.ok(ev.detail.includes('600'), 'detail 要带上实测跨度，否则事后无法判读：' + ev.detail)
  })

  it('提前放行型回归（各跨度仍 ≈ 配置时长）⇒ 无证据，不得豁免', () => {
    const ev = deferralEvidence([t(1, 0, 21), t(2, 5, 26)], OPT)
    assert.equal(ev.observed, false, '没有超长占用就不是回调推迟：' + JSON.stringify(ev))
  })

  // 这条专门锁住"第一版探测器的错法"：与后一个调用重叠的往往是**被 429 拒掉、
  // 永远不会 completed** 的那条，按 completed 过滤就等于看不见真正原因。
  it('被推迟的是 rate_limited 条目时也必须探到证据（不得只扫 completed）', () => {
    const ev = deferralEvidence([t(1, 0, 30), t(3, 1000, 1620, 'rate_limited'), t(4, 1650, 1670)], OPT)
    assert.equal(ev.observed, true, JSON.stringify(ev))
    assert.ok(ev.detail.includes('rate_limited'), 'detail 应指明被推迟条目的状态：' + ev.detail)
  })

  it('阈值由参数推导：间隔很短时靠 2× 配置时长兜下界', () => {
    // rpm=1200 ⇒ 间隔 50ms；2×100ms 配置时长 = 200ms ⇒ bound = 200
    const ev = deferralEvidence([t(1, 0, 150)], { requestDurationMs: 100, interStartMs: 50 })
    assert.equal(ev.boundMs, 200, JSON.stringify(ev))
    assert.equal(ev.observed, false)
    assert.equal(deferralEvidence([t(1, 0, 201)], { requestDurationMs: 100, interStartMs: 50 }).observed, true)
  })

  it('空 timeline / 非数组 / 缺字段 ⇒ 判"无证据"而不是抛异常', () => {
    for (const tl of [undefined, null, [], [{}], [{ req: 1, state: 'rate_limited' }]]) {
      assert.equal(deferralEvidence(tl, OPT).observed, false, JSON.stringify(tl))
    }
  })

  it('配置时长与间隔都缺失 ⇒ bound 为 0 ⇒ 一律无证据（不得凭空造出豁免依据）', () => {
    assert.equal(deferralEvidence([t(1, 0, 99999)], {}).observed, false)
    assert.equal(deferralEvidence([t(1, 0, 99999)], undefined).observed, false)
    assert.equal(deferralEvidence([t(1, 0, 99999)], { requestDurationMs: 0, interStartMs: 0 }).observed, false)
  })
})

describe('completionOrder — 完成顺序的取数口径', () => {
  it('只取 completed 的请求序号，保持时间序', () => {
    assert.deepEqual(completionOrder([
      { req: 1, state: 'completed' }, { req: 3, state: 'rate_limited' }, { req: 2, state: 'completed' },
    ]), [1, 2])
  })

describe('completionSetMatches — 完成集合（#2626 真正承重的判据）', () => {
  it('成员相同 ⇒ true（顺序不同也算一致 —— 这是刻意的，不是放宽）', () => {
    assert.equal(completionSetMatches([1, 2, 4, 5, 6], [1, 2, 4, 5, 6]), true)
    // 真实侧次序在事件帧饥饿下会翻转（用未排序的 completion_order 实测：12 个饥饿样本里 9 个非升序），
    // 成员没变就不该判红 —— 否则就是把 #2606 的假红重新引进来。
    assert.equal(completionSetMatches([1, 2, 3, 4], [1, 2, 4, 3]), true)
    assert.equal(completionSetMatches([], []), true)
  })

  it('成员不同 ⇒ false（一侧把被拒请求算成完成，正是 #2626 的形状）', () => {
    assert.equal(completionSetMatches([1, 2, 3, 4, 5, 6], [1, 2, 4, 5, 6]), false)
    assert.equal(completionSetMatches([1, 2], [1, 3]), false)
  })

  it('任一入参非数组 ⇒ false（fail closed，缺信息不得当成一致）', () => {
    assert.equal(completionSetMatches(undefined, [1]), false)
    assert.equal(completionSetMatches([1], null), false)
    assert.equal(completionSetMatches('12', [1]), false)
  })

  it('取数口径串起来：state 被误标成 completed 时集合判据必须抓到', () => {
    const sim = completionOrder([{ req: 1, state: 'completed' }, { req: 3, state: 'completed' }])
    const real = completionOrder([{ req: 1, state: 'completed' }, { req: 3, state: 'rate_limited' }])
    assert.equal(completionSetMatches(sim, real), false)
  })
})

describe('completionOrderSequenceMatches — 完成序列只留痕、不得升为硬判定', () => {
  it('逐元素相等 ⇒ true', () => {
    assert.equal(completionOrderSequenceMatches([1, 2, 4, 5, 6], [1, 2, 4, 5, 6]), true)
  })

  it('成员相同但顺序不同 ⇒ false —— 正因为它会为饥饿下的正常翻转发红，才不能计入 pass', () => {
    assert.equal(completionOrderSequenceMatches([1, 2, 3, 4], [1, 2, 4, 3]), false)
    assert.equal(completionSetMatches([1, 2, 3, 4], [1, 2, 4, 3]), true)
  })

  it('任一入参非数组 ⇒ false', () => {
    assert.equal(completionOrderSequenceMatches(undefined, [1]), false)
  })
})
  it('非数组入参返回空数组而不是抛错', () => {
    assert.deepEqual(completionOrder(undefined), [])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-20（任务 #88）：同一签名 `Error: python simulator failed: `（**空消息**）第三次复发。
// 旧载体里已有两条记录（`.quality-gates.md:3261` 与 `:10018-10026`），第二次那条**已经写出根因与
// 改进建议**却"避免扩大战线"没做 ⇒ 今天又花掉一轮定责 + 一次 main 红 + 一次失败作业重跑。
// 根因是 `spawnSync` 只判 `res.status`：超时被 SIGTERM 杀（status=null、stderr 空）与
// python 不在 PATH（ENOENT、stderr 空）都落到同一句空消息上。
// ⛔ 刻意**不引入 skip**：对拍只在 main push 跑（`if: event != pull_request`），
//    静默 skip 等于把守门关掉还报通过——那是本仓记过的「装饰性门禁」同型；这里让红保持红，但必须**红得可归因**。
describe('pythonSimulate 失败必须可归因（三档分开，不再抛空消息）', () => {
  const mod = require('./compare-scheduler-models')
  const { formatSpawnFailure, pythonSimulate, PYTHON_SIMULATE_TIMEOUT_MS } = mod

  /** 造一个与真实 spawnSync 同形的结果对象（缺字段就按真实缺失处理，不给测试方便） */
  const res = (o) => Object.assign({ status: null, signal: null, error: undefined, stderr: '', stdout: '' }, o)

  it('档1 · python 不在 PATH（ENOENT）：点名解释器缺失并给核验命令', () => {
    const err = Object.assign(new Error('spawnSync python ENOENT'), { code: 'ENOENT' })
    const msg = formatSpawnFailure(res({ error: err }), { timeoutMs: 30000 })
    assert.match(msg, /ENOENT/)
    assert.match(msg, /python 不可用|不在 PATH/, '必须直说"解释器拿不到"，不能只报 exit code')
    assert.match(msg, /python --version/, '要给一条当场可核验的命令，否则下一个人只能猜')
  })

  it('档2 · 被超时杀掉：报 signal + 本档预算，并指向"负载型"而非"判据坏了"', () => {
    const err = Object.assign(new Error('spawnSync python ETIMEDOUT'), { code: 'ETIMEDOUT' })
    const msg = formatSpawnFailure(res({ error: err, signal: 'SIGTERM' }), { timeoutMs: 30000 })
    assert.match(msg, /ETIMEDOUT/)
    assert.match(msg, /SIGTERM/)
    assert.match(msg, /30000ms/, '不打印本次预算值，就无法判断是"慢"还是"崩"')
    assert.match(msg, /负载|抖动/, '要给方向：这一档是 runner 负载，不是对拍判据不成立')
  })

  it('档3 · python 真崩：带 status 与 stderr 尾条（可截断但不得为空）', () => {
    const msg = formatSpawnFailure(
      res({ status: 1, stderr: 'Traceback (most recent call last):\n  File "<string>", line 3\nModuleNotFoundError: services.scheduler_simulator' }),
      { timeoutMs: 30000 },
    )
    assert.match(msg, /status=1/)
    assert.match(msg, /ModuleNotFoundError/, 'python 侧的真实报错必须出现在文案里')
  })

  it('三档文案必须互不相同（合成一句话就是把三种成因读成同一种）', () => {
    // ⚠ 本条的覆盖面要说清：它只挡「文案塌缩」（两档输出同一句话），**不挡「判据塌缩」**——
    //    把 ETIMEDOUT 那一档的 if 条件摘掉时，超时落进真崩档，三句话仍然两两不同，本条照绿。
    //    挡住那个形态的是上面"档2"那条（它断言 signal/timeout/负载方向都在文案里）。
    //    （变异 P3 实测：判据摘掉后只红在档2，本条不红 —— 记录在案，别让下一个人以为本条兜得住。）
    const a = formatSpawnFailure(res({ error: Object.assign(new Error('e'), { code: 'ENOENT' }) }), { timeoutMs: 30000 })
    const b = formatSpawnFailure(res({ error: Object.assign(new Error('e'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM' }), { timeoutMs: 30000 })
    const c = formatSpawnFailure(res({ status: 2, stderr: 'boom' }), { timeoutMs: 30000 })
    assert.notEqual(a, b)
    assert.notEqual(b, c)
    assert.notEqual(a, c)
    for (const m of [a, b, c]) assert.ok(m.trim().length > 0, '空消息就是本次要修的缺陷本身')
  })

  it('pythonSimulate 必须真的走这条上报（注入假 spawn 后端逐档验，不靠读源码字符串）', () => {
    const cases = [
      { fake: res({ error: Object.assign(new Error('e'), { code: 'ENOENT' }) }), want: /ENOENT/ },
      { fake: res({ error: Object.assign(new Error('e'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM' }), want: /SIGTERM/ },
      { fake: res({ status: 1, stderr: 'Traceback: bad' }), want: /status=1[\s\S]*Traceback/ },
    ]
    for (const c of cases) {
      assert.throws(
        () => pythonSimulate({ rpm: 6, maxConcurrent: 1, requestCount: 2, requestDurationMs: 20 }, { spawnImpl: () => c.fake }),
        (e) => e.message.startsWith('python simulator failed: ') && c.want.test(e.message),
        `假 spawn 后端返回 ${JSON.stringify(c.fake.error ? c.fake.error.code : c.fake.status)} 时仍抛空消息 ⇒ 上报没接上`,
      )
    }
  })

  it('status=0 但 stdout 不是 JSON ⇒ 也必须是可归因的错误，不能让 JSON.parse 抛裸栈', () => {
    assert.throws(
      () => pythonSimulate({ rpm: 6, maxConcurrent: 1, requestCount: 2, requestDurationMs: 20 },
        { spawnImpl: () => res({ status: 0, stdout: 'WARN something\nnot-json' }) }),
      /PYTHON_OUTPUT_UNPARSEABLE[\s\S]*not-json/,
    )
  })

  it('预算可被 env 覆盖，非法值必须回落默认并出声（与频控/队列同口径）', () => {
    assert.equal(PYTHON_SIMULATE_TIMEOUT_MS, 30000, '默认值动了要同步本条与文档')
    const { resolveSpawnTimeout } = mod
    const warns = []
    assert.equal(resolveSpawnTimeout(undefined, warns), 30000)
    assert.equal(resolveSpawnTimeout('45000', warns), 45000)
    assert.equal(resolveSpawnTimeout('abc', warns), 30000, '非法值不得变 NaN —— `timeout: NaN` 会让子进程永不被杀')
    assert.equal(resolveSpawnTimeout('0', warns), 30000, '0 等于关掉超时，不许静默生效')
    assert.ok(warns.length >= 2, '回落必须出声，否则"我设了没生效"永远查不出来')
  })

  it('反向锁：旧的"空消息"拼接不得回来（把 throw 改回 stderr||stdout 即红）', () => {
    const fs = require('node:fs')
    const src = fs.readFileSync(require.resolve('./compare-scheduler-models'), 'utf8')
    assert.ok(!/python simulator failed: '? \+ \(res\.stderr \|\| res\.stdout\)/.test(src),
      '又回到 `+ (res.stderr || res.stdout)` ⇒ 三档重新塌成一句空消息')
    // 正向锚：抛错处必须真的调用格式化器（"文件里出现过这个函数名"不构成接线）。
    // ⚠ 判据取数域改过：旧写法是 `function pythonSimulate[\s\S]{0,1400}throw …`，
    //    那个 1400 是当时手写的窗口，**没有任何实测依据**，于是"在函数里加一段重试循环"这种
    //    与语义无关的成长会把锚点整条剪断（本仓记过的「锚点指向的窗口过期」同型）。
    //    正解是按语法边界取域：取 pythonSimulate 函数体本身，再在里面找那次调用。
    const bodyStart = src.indexOf('function pythonSimulate')
    assert.ok(bodyStart >= 0, 'pythonSimulate 不在了')
    // 闭合括号按**工作区真实行尾**匹配（本仓 checkout 侧是 CRLF，写 '\n}\n' 会恒不命中）
    const closeMatch = /\r?\n\}\r?\n/.exec(src.slice(bodyStart))
    assert.ok(closeMatch, '取不到 pythonSimulate 的函数闭合，本条不得继续判')
    const body = src.slice(bodyStart, bodyStart + closeMatch.index)
    // 反失明正控：取到的函数体必须真的包含这段工作要做的事，否则"匹配不到"是探针坏而不是没接线
    assert.ok(body.length > 400, '函数体长度异常（' + body.length + '），切片口径已失效')
    assert.match(body, /spawn\('python'/, '函数体里必须真的有那次子进程调用')
    assert.match(body, /throw new Error\('python simulator failed: ' \+ formatSpawnFailure\(/,
      'pythonSimulate 没有走 formatSpawnFailure ⇒ 上报只是存在，没在跑')
  })
})


// ── python 子进程的「预算 / 重试 / 时长样本」三件套（主干红 40108163214 的归因缺口）──
// 旧实现只说"属负载/抖动"，既没记一次真实时长、也分不开「解释器被饿死」与「模拟器真跑不完」。
// 本切片补的是**可归因**，不是把断言调宽。
describe('python 子进程预算与重试（parity 主干红归因）', () => {
  const { pythonSimulate, pythonTimingSnapshot, resetPythonTimingLedger, PYTHON_MAX_ATTEMPTS, PYTHON_PROBE_SCRIPT, resolveMaxAttempts } = require('./compare-scheduler-models')
  const params = { rpm: 6, maxConcurrent: 1, requestCount: 2, requestDurationMs: 20 }
  const timeouts = () => ({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }), stdout: '', stderr: '' })
  const enoent = () => ({ status: null, signal: null, error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), stdout: '', stderr: '' })
  const crashed = () => ({ status: 1, signal: null, stdout: '', stderr: 'Traceback: bad' })
  const okRun = () => ({ status: 0, stdout: JSON.stringify({ metrics: {}, timeline: [] }), stderr: '' })
  // 探针调用是 spawn('python', ['-c', PROBE])，真跑是 ['-c', script, json] ⇒ 第 2 个参数才是分界
  const isProbe = (args) => args[1] === PYTHON_PROBE_SCRIPT

  it('只有环境档（超时）才重试，ENOENT 与真崩一律当场抛（重试会把"python 没装"读成"再试一次"）', () => {
    let calls = 0
    // 探针也走同一个注入后端 ⇒ 计数必须只数真跑那一次，否则"重试 1 次 + 探针 1 次"会被读成"跑了 3 次"
    assert.throws(() => pythonSimulate(params, { spawnImpl: (cmd, args) => { if (!isProbe(args)) calls++; return timeouts() } }), /ETIMEDOUT|SIGTERM/)
    assert.equal(calls, PYTHON_MAX_ATTEMPTS, '超时档必须用满重试上限')
    calls = 0
    assert.throws(() => pythonSimulate(params, { spawnImpl: () => { calls++; return enoent() } }), /ENOENT/)
    assert.equal(calls, 1, '解释器不存在是永久成因，不得重试')
    calls = 0
    assert.throws(() => pythonSimulate(params, { spawnImpl: () => { calls++; return crashed() } }), /status=1/)
    assert.equal(calls, 1, '真崩不是抖动，不得重试')
  })

  it('第一次超时、第二次成功 ⇒ 不抛且真跑两次；注入的 spawnImpl 一律不进台账（假样本会让贴脸检查恒真）', () => {
    resetPythonTimingLedger()
    let n = 0
    const out = pythonSimulate(params, { spawnImpl: (cmd, args) => { if (isProbe(args)) return okRun(); n++; return n === 1 ? timeouts() : okRun() } })
    assert.ok(out && out.metrics, '恢复后必须照常返回结果')
    assert.equal(n, 2)
    assert.equal(pythonTimingSnapshot().length, 0, '假后端不得进台账')
  })
  it('两次超时后必须做解释器探针，并按探针结果分档说成因：探针也超时=环境饿死；探针可启动=模拟器真跑不完', () => {
    const env = timeouts()
    let msgEnv = ''
    try { pythonSimulate(params, { spawnImpl: () => env }) } catch (e) { msgEnv = e.message }
    assert.match(msgEnv, /探针/)
    assert.match(msgEnv, /饿死|负载/)
    let msgReal = ''
    try { pythonSimulate(params, { spawnImpl: (cmd, args) => isProbe(args) ? okRun() : env }) } catch (e) { msgReal = e.message }
    assert.match(msgReal, /PROBE_OK/)
    assert.match(msgReal, /真缺陷|不是负载/)
    assert.notEqual(msgEnv, msgReal, '两种成因塌成一句话就是把"该重跑"读成"该修代码"')
  })
  it('每次真实调用都打一行 [parity-timing]，带 python_ms / budget_ms / attempts（没这行就没有分布可采）', () => {
    const lines = []
    pythonSimulate(params, { spawnImpl: () => okRun(), logImpl: (s) => lines.push(s) })
    const joined = lines.join('\n')
    assert.match(joined, /\[parity-timing\][\s\S]*python_ms=\d+/)
    assert.match(joined, /budget_ms=30000/)
    assert.match(joined, /attempts=1/)
  })
  it('重试上限可被 env 覆盖，非法值必须回落默认并出声（与预算档同口径）', () => {
    const warns = []
    assert.equal(resolveMaxAttempts('', warns), 2)
    assert.equal(resolveMaxAttempts('0', warns), 2, '0 会让"永不重试"伪装成可配置')
    assert.equal(resolveMaxAttempts('abc', warns), 2)
    assert.equal(resolveMaxAttempts('3', warns), 3)
    assert.ok(warns.length >= 2, '回落必须出声，否则本机一直带着一个非法值也不会有人知道')
  })
  // 出处必须可重跑：写下「30s 够用」不是证据，样本才是。域要如实——这 6 例是**本机**样本，
  // runner 侧分布由上线后的 [parity-timing] 行自采；本条只锁「工作量是 0.1s 量级 ⇒ 预算不是在保护算法」。
  it('python 预算必须带实测出处与裕度倍数（改预算先重跑复测命令）', () => {
    const { PARITY_PYTHON_TIMEOUT_PROVENANCE: p, PYTHON_SIMULATE_TIMEOUT_MS } = require('./compare-scheduler-models')
    assert.ok(p.localMaxMs > 0, '零样本的"分布"不是分布')
    assert.ok(p.localSamples >= 6, '样本数下限 6（每组一条）')
    assert.ok(PYTHON_SIMULATE_TIMEOUT_MS >= p.localMaxMs * p.marginMultiplier, '预算必须 ≥ 实测 max × 裕度倍数')
    assert.match(p.recheckCmd, /runParity/, '复测入口必须是一句能在仓库里重跑的命令')
    assert.ok(p.collectedAt, '出处必须带采集日期')
  })
})
