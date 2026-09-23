# Proposal v3（终版）— PR-2 / P0-8：发布失败被动附带诊断

> 经两轮对抗评审收敛（critique-v1 15 条 + critique-v2 8 条全接受）。相对 v2 的变更：①首期砍弹窗面（日志面保证 + batch payload 预留）；②governor 挂钩改治理链出口单点 catch-rethrow（覆盖全部 6 个 rate/quota 出口）；③永不抛合同；④探针自适应 + 低 rpm 降级默认探针；⑤缓存/节流/in-flight 全部 per-key；⑥配置变更失效钩子。

## 0. 交付合同（本期范围，PRD R5 降级路径明文允许）

| 面 | 级别 | 本期交付 |
|---|---|---|
| 结构化日志 `publish.diagnose_result` | **保证** | 每个诊断码恰好一行结论；全触发点覆盖 |
| batch 事件 payload `diagnoseCode` | 数据预留 | 新增可选字段，渲染层本期不消费 |
| 报错弹窗附码 | **二期** | 本期零改动 `user-facing-error.js` / locale / preload（评审 N-1：tag 无生产者、咽喉点不存在、丢失点在 renderer 数十 throw 处）；决定回写 PRD §5/§10 |

## 1. 新文件 `electron/services/pubfail-diagnose.js`（≤220 行）

```js
maybeDiagnose(errLike, ctx)
// ctx: { source:'governor'|'batch', key:'<providerId>:<type>', getLimits?:()=>({rpm,maxConcurrent,cooldownMs,effRpm}) }
// 合同：同步返回 boolean（是否触发）；内部整体 try/catch，永不抛、同步段零 await。
```

- 分类：仅 `classifyProviderFailure(errLike) ∈ {'rate','quota'}`（唯一事实源）；batch 形状 `{message}` 走文本模式，governor 形状 ProviderError 走 code 优先分支（评审已验证不失效）。
- 状态（全部 Map，key=`providerId:type`，batch 用 `source` 作 key）：
  - `inflight`：触发瞬间发放码 `D-`+6 位 base36，同 key 在途新失败复用同一码；
  - `cache`：完成后存 `{code, level, ts}`，TTL 10min；TTL 内同 key 新失败直接挂既有码不重跑；
  - `lastRun`：per-key 节流 ≥60s 一次真实自检；
  - 缓存失效：governor `setProviderLimits` 路径调用 `invalidateDiagnoseCache(key)`（配置变更即过期）。
- shutdown：`app.on('before-quit')`（懒注册）置位后不再触发、迟到结论丢弃。已接受残余：在途 timer 最多拖尾 ≈ 探针时长（不阻止 Electron 进程退出）。

## 2. 挂钩点（共 2 处，均 fire-and-forget）

1. **governor 治理链出口单点**（覆盖 `_pace`、`_waitCooldown`、排队超时、retry429 耗尽、额度预检/后置共 6 出口）：`run()` 的结果链包装 `.catch(err => { void require('./pubfail-diagnose').maybeDiagnose(err, ctx); throw err })`；ctx.getLimits 由 governor 内部取 `_limitsFor` + `_effectiveRpm`（含 rateFactor，不新增公开 API）；lazy require 破环 + try/catch；**错误对象字段与控制流零改动**（契约测试锁：原错误 rethrow、identity 相等、maybeDiagnose 抛异常注入不影响传播）。
2. **batch-manager item 转失败处**（`webContents.send('batch:progress')` 前）：`maybeDiagnose({message}, {source:'batch'})` 命中时 item payload 挂 `diagnoseCode`（仅新增字段）。

## 3. 自检执行与 level 映射

- 探针选择：`eff = ctx.getLimits()`；
  - `eff.rpm ≥ 20` → 真实配置探针：`requestCount = eff.rpm ≥ 30 ? 4 : 3`，`requestDurationMs: 20`，`maxConcurrent/cooldownMs` 取实际；理论时长 `(rc-1)×60000/effRpm + requestDurationMs`；硬超时 `max(10s, 1.5×理论+2s)`；`probeMode:'actual'`。
  - `eff.rpm < 20` 或 getLimits 缺失/校验抛错（TypeError 捕获）→ 默认探针 `{rpm:60, requestCount:4, requestDurationMs:20}`（≈3s，超时 10s），`probeMode:'default'`（结论解释为"调度机制本身健康度"，低 rpm 属 provider 额度属性不自检误导）。
- 执行：`runSelfCheck(params)`（执行端零改动）+ `Promise.race` 超时 + `settled` 标志（迟到回调丢弃，一码至多一行日志）。
- level：`ok`＝全 assertions pass 且总时长 ≤1.5×理论；`warn`＝全 pass 但总时长 >1.5×理论；`fail`＝断言失败/超时/异常。（v2 不可达的 rate_limited_count 条件已删）

## 4. 结论日志（唯一对外表面）

`logger.notify('publishDiagnose', 'publish.diagnose_result', { errorCategory, level, code, source, probeMode, assertionsSummary })` —— 主进程 logger 直写（签名已核：`notify(module, messageKey, meta)`），不经 `notify:log` IPC、不受其限速。assertionsSummary ≤500 字符截断。

## 5. 测试契约（TDD 红先行）

`pubfail-diagnose.test.js`：
1. 分类正反例：6 类 governor 错误 + batch `{message:'…429 Too Many Requests…'}` 命中；普通错误/null/非对象不触发；
2. 永不抛：mock runSelfCheck 同步/异步抛错 → maybeDiagnose 不外抛、返回合同稳定；
3. 状态机：per-key 缓存绑定复用（同 key TTL 内同码，异 key 不串）；60s 节流；in-flight 复用码；`setProviderLimits` 失效；shutdown 抑制；
4. 超时 settled：fake timers 下迟到结论不写第二行；
5. 探针自适应：rpm 10→default 模式；rpm 30→actual、requestCount=4、超时=max(10s,…)；公式断言；
6. level 三档映射（构造 metrics）。

`api-usage-governor.test.js` 扩展（契约）：rate/quota 抛出经 `run()` 出口原样 rethrow（identity 不变、message/code 不变）；诊断异常注入不影响 6 出口错误传播与 `_sweepExpired` waiter 回收。
`batch-manager` 相关测试：item 失败 payload 含/不含 `diagnoseCode` 两型；既有字段不变。
静态合同：`src/**` 不出现 self-check/pubfail 直调；`user-facing-error.js`、locales 本期 diff 为零。

## 6. 门禁与预算

pubfail-diagnose.js ≤220 行；governor 增量 ≤10 行；batch-manager 增量 ≤5 行；无新 IPC 通道（Gate 10 零影响）、无 locale 改动（Gate 7 零影响）；debt 行数自查。

## 7. PRD/文档回写要点（p2-doc）

§5 P0-8 补：交付合同三级表、触发点与 6 出口清单、探针自适应规则与公式、level 映射、缓存/节流/失效参数、zh 结论日志字段表、弹窗面二期决定（引 R5 降级原文）；§10 开放问题：story2video 通知面缺口、弹窗面二期、首错延迟回填二期。CHANGELOG 新条目；learnings 记录「IPC 包装层覆盖 handle 不覆盖事件推送」这条系统性事实。
