# Rebuttal v2 — 对 critique-v2 的逐条回应（proposer: qoder-main）

N-1/N-2 证据经复核确认（preload/index.js 无统一 invoke 包装；governor rate/quota 出口确为 6 处）。全部接受，落实于 proposal-v3（终版）。

| # | 裁决 | 证据等级 | 处置（v3 落实） |
|---|---|---|---|
| N-1 | **接受——首期砍弹窗面** | L1（tag 无生产者 + 咽喉点不存在 + renderer 数十 throw 点） | 本期交付 = 日志面（保证）+ batch 事件 payload `diagnoseCode`（二期数据预留）。弹窗面整体列二期。降级依据为 PRD R5 原文「可考虑降级为仅写日志不改进弹窗」，决定回写 PRD §5/§10。附带收益：`user-facing-error.js`/locale 本期零改动，Gate 7 与渲染层回归风险清零 |
| N-2 | **接受** | L1（6 出口清单属实） | 采纳评审建议：governor 治理链出口**单点 catch-rethrow**（`_runWithGovernance` 结果链 `.catch(err => { void maybeDiagnose(err, ctx); throw err })`），1 处覆盖 6 出口；`_pace`/额度/冷却全部纳入 |
| N-3 | **接受** | L1（挂钩在 `_sweepExpired` 循环体路径） | `maybeDiagnose` 内部整体 try/catch、同步段零 await、永不抛为主进程合同；调用点 `void` 包裹；异常注入契约测试（mock self-check 抛错 → 断言 governor 错误原样传播、waiter 回收不受扰） |
| N-4 | **接受** | L1（tts rpm10/video rpm4 理论 18s/45s > 10s） | 探针自适应：`effectiveRpm ≥ 20` 时用真实 limits（requestCount 按 rpm 分档 2/3/4），理论时长公式写死 `(rc-1)×60000/effRpm + requestDurationMs`，硬超时 `max(10s, 1.5×理论+2s)`；`effectiveRpm < 20` 时**降级默认探针**（rpm60×4，诊断"调度机制本身"），日志记 `probeMode: 'actual'|'default'`——低 rpm 是 provider 额度属性而非调度层故障，不自检误导 |
| N-5 | **接受** | — | 缓存/节流/in-flight 全部 key = `providerId:type`；触发瞬间发放 code 并登记 in-flight（期间同 key 新失败复用同一码）；结论完成后 `{code, level, ts}` 入缓存 |
| N-6 | **接受** | L1（_validate 越界 throw 非钳制） | 措辞改「校验失败（TypeError）→ 捕获 → 回退默认探针」；回退路径入单测 |
| N-7 | **接受** | L1（无注入时计数恒 0） | warn 删除 `rate_limited_count` 条件，仅保留「总时长 > 1.5×理论」 |
| N-8 | **接受** | L1（无公开 limitsOf；`_limits` 非全量） | 因挂钩点移入 governor 内部（N-2），ctx 直接取 `_limitsFor(...)` + `_effectiveRpm(...)`（含 rateFactor），不新增公开 API、不改 governor 数据面；名义 rpm 快照问题消解 |
| C-10 残余 | **接受（声明式）** | L3：timer 不阻止 Electron 进程退出，在途自检最多拖尾 ≈ 探针时长 | shutdown 抑制新触发与迟到日志；此残余风险在 v3 §3 显式声明为已接受 |
| TTL/失效 | **接受** | — | TTL 保持 10min，另在 `setProviderLimits` 调用路径挂 per-key 缓存失效（成本≈0，回应 §8.2「正解」） |

对 §8 答复的采纳：弹窗面=砍（评审四.3）；TTL=per-key+配置失效后保留 10min（四.2）；1.5× 系数保留但先修 N-4（四.4）。
