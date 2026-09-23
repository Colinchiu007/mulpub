# Critique v1 — PR-2 / P0-8 发布失败被动附带诊断（方案 proposal-v1.md 对抗评审）

- 评审方：独立 critic（不共享出方案方上下文）
- 评审对象：`.agent_context/adv/proposal-v1.md`
- 验证基准 worktree：`D:\Data\projects\mp-worktrees\mp-pubfail-diag`
- 方法：逐条以真实代码 file:line 核验方案声称的事实；凡"方案声称 vs 代码不符"列为最高优先级攻击点。

## 评分总览（0-10）

| 维度 | 分 | 一句话理由 |
|---|---|---|
| 完整性 | 6 | 覆盖面广（分类/防抖/缓存/降级/locale/测试），但结论 level 判定、事件推送路径覆盖、app quit 生命周期、缓存码复用一致性等关键点缺失。 |
| 一致性 | 5 | 多处内部矛盾：时长 "<1s" vs "3-4s"；§3.1 每次"生成码" vs §3.2 缓存复用同一码；核心挂载点叙述 vs §7 R-E 自认可能不覆盖。 |
| 清晰度 | 6 | 架构图/表格/编号清晰易读；但"结论如何得出""diagnoseTag 如何跨进程序列化到 renderer 抛出的 error"描述含糊。 |
| 可行性 | 4 | 最关键前提——"IPC 统一序列化包装层一次性挂载、发布 RPA 结果走同一挂载点"被代码证伪；发布主链路失败走 webContents.send 事件推送，根本不经 handle 包装层，需重做触发架构。 |
| 安全性 | 7 | 零新增 IPC、探针参数硬编码、复用 deny-list/文案白名单、不外泄原始 message，安全意识良好；主要残留是统一层误挂载与对每个 IPC 返回跑正则的性能/正确性面。 |

**结论：不可直接进入实施（Conditional Fail）。核心触发挂载架构（§2 末行 + §3.1 + 架构图）建立在对 IPC 机制的错误认知上，须重写触发点选型后再评审。**

---

## 问题清单

### C-1 · Critical · 可行性 / 完整性
**问题**：方案的核心挂载点"在 IPC 统一序列化包装层对 handler 结果一次性挂 diagnoseTag，发布 RPA 结果走同一挂载点"（§3.1 L41、架构图 L41-42、§2 L25）被代码证伪。发布/批量/RPA 的逐条失败结果通过 `webContents.send` 事件推送回渲染层，不经过 `ipcMain.handle` 的返回值，因此永不会被挂在 handle 包装层的 `attachDiagnoseTag` 看到。
**证据**：
- 包装层只代理 `handle` 且**不后处理返回值**：`createAccessControlledIpcMain` 的 Proxy `get` 仅拦截 `property === 'handle'`，注册函数最终 `return handler.apply(this, args)`，无 `await`、无结果改写 —— `apps/desktop/electron/ipc-handlers/license-access-control.js:256-296`。
- 发布逐条结果走事件推送：`_emitProgress` 用 `win.webContents.send('batch:progress', {...})` —— `apps/desktop/electron/services/batch-manager.js:411-423`；`publish:progress` —— `apps/desktop/electron/bootstrap.js:80`、`bootstrap/phase4-events.js:29,87,97,107`；`rpa:progress` —— `apps/desktop/electron/services/rpa-view-manager.js:44`。
- 项目自身的守卫说明文档确认：`createAccessControlledIpcMain 的 Proxy 只拦截 handle，ipcMain.on 不经咽喉点` —— `apps/desktop/electron/ipc-guard-exemptions.json:12`。
**期望修复**：承认"单点挂载不可覆盖发布主链路"。要么在**事件推送前**（`_emitProgress`/`publish:progress` send 之前）显式调用挂载函数，要么改在错误**产生点**（batch/rpa 执行器 catch 处）触发诊断。§8 请求评审点 #1 的答案是：**统一 handle 包装层挂载不可行**。

### C-2 · Critical · 完整性 / 一致性
**问题**：即使到达挂载点，batch item 错误的对象形状与分类器/挂载器的期望契约完全不兼容。`attachDiagnoseTag` 判 `result.code !== 0`，`classifyRateLimit` 读 `result.code/message/errorCode/statusCode`（§3.1 L48、§4 L77）；但发布逐条结果根本没有 `code`/`errorCode`，错误是裸字符串塞进 `message`。
**证据**：`win.webContents.send('batch:progress', { kind:'task-complete', ok: !result?.error, message: result?.error || '发布成功', timestamp })` —— `batch-manager.js:415-421`。字段为 `{ok:boolean, message:string}`，无 `code`。
**期望修复**：定义"发布/RPA 失败结果"的真实形状并给出归一化适配层；说明渲染层是否对该 message 走 `formatUserError`（当前 `message` 为裸错误串直出，很可能绕过弹窗文案漏斗）。

### C-3 · Critical · 可行性 / 安全性
**问题**：在统一层对"所有 handle 返回值"执行 `result.code !== 0` 判定不安全也不成立。IPC 返回值形状不统一：不少 handler 直接返回 data/数组/`{ok}`，无数字 `code`，则 `undefined !== 0 === true` → **成功结果被误判为失败**，触发挂载与正则分类。且"所有 handler 已经统一包装层注册"（§2 L25）不实：存在直挂 raw `ipcMain.handle` + 自带 `withSenderCheck` 的并行注册（含 `ai:generate` 这类模型调用），以及多处 `createAccessControlledIpcMain` 实例。
**证据**：
- 并行注册（raw ipcMain.handle + withSenderCheck）：`ipc-handlers/ai.js:29`（`ai:generate`）、`ipc-handlers/aggregation.js:80-148`、`ipc-handlers/account.js:321-710`。
- 多包装实例：`electron/window.js:45`、`electron/bootstrap/phase5-ipc.js:237` 各自 `createAccessControlledIpcMain(...)`。
- 成功返回形状示例：`notify.js:106` 返回 `{code:0,data:true}`，但大量 handler 无统一 code（如直接返回数组/对象）。
**期望修复**：不得对异构返回盲判 `code!==0`。应：①显式定义"仅当对象含 `code` 且 `code!==0`"才处理；②盘点并覆盖所有注册路径（handle-proxy 与 raw handle 与 withSenderCheck），或放弃"单点"改在汇聚点触发；③统一层每次 IPC 返回跑正则的性能预算需量化（方案"微秒级"仅指 Map 查找，未含 classifyRateLimit 的正则）。

### C-4 · Major · 一致性 / 完整性
**问题**：方案自造 `classifyRateLimit` 文本模式，弱于且重复既有实现，且漏判。§3.1 L47 的模式集合为「429·限流·rate limit·too many requests·排队等待超时·冷却超时」，缺"请求频率/已达上限"，会漏判 governor 的实际限流文案。
**证据**：
- governor 抛出的限流文案 L323 为 `'当前请求频率已达上限，请稍后再试。'`（`api-usage-governor.js:320-325`），不含方案任一关键词。
- 既有单一事实源已覆盖该情形：`RATE_LIMIT_MESSAGE_PATTERN` 含"请求频率"，`classifyProviderFailure(error)` 归一为 `'rate'|'quota'|...` —— `adapters/_base/provider-error.js:229,274-299`。
**期望修复**：直接复用 `classifyProviderFailure(err) ∈ {'rate','quota'}` 作判定，删除新写的正则，避免"两处语义"漂移（§3.1 已自认要"两处对齐"）。

### C-5 · Major · 一致性
**问题**：缓存复用与"每次生成新码"自相矛盾，导致客服按码查不到日志。§3.1 L48 说 `attachDiagnoseTag` 每次"生成码并挂载"；§3.2 L55 说 TTL 内新失败"直接复用结论 → 弹窗可同步显示 码 D-xxxx"；而 `publish.diagnose_result` 日志仅在**真跑自检完成**时写一次（§3.3 L60）。若复用旧结论却挂新码，新码无对应日志行；若挂旧码，则 §3.1"每次生成码"错。
**证据**：方案内部 §3.1/§3.2/§3.3 三处（proposal-v1.md L48、L55、L60）。
**期望修复**：明确"复用 = 复用同一 (level+code)"，缓存条目须含 code 且挂载时复用；新码必须伴随新日志行（或明确"仅复用不新出码"）。

### C-6 · Major · 完整性（诊断有效性）
**问题**：固定轻量探针 `{rpm:60, requestCount:4, requestDurationMs:20}`（§3.2 L52）跑在**全新独立 governor 实例**上，无 `inject429At`、无用户/运营实际配置、无真实额度窗口。这样的自检几乎恒过（并发=4、间隔 1s、零注入），结论"正常"对"调度器问题 vs 上游真实限流"的区分**几乎无信息量**。PRD P0-6/P0-8 要求"内部按运营下发的当前配置跑默认自检"。
**证据**：`runSelfCheck` 用 `new ApiUsageGovernor({})` 独立实例（`rate-limit-self-check.js:55`），断言项仅 `max_concurrent/no_rate_limited/no_network`（`_buildAssertions` L124-157），对合法配置恒真；PRD §5 P0-6「内部按运营下发的当前配置跑默认自检」、P0-8（PRD L87-88）。
**期望修复**：探针应注入触发失败的 provider 实际 rpm/limitPer5h/cooldownMs（或运营下发配置），否则放弃"弹窗显示结论"，降级为纯日志引用码。

### C-7 · Major · 完整性（PRD 范围）
**问题**：本期不接入 story2video 通知面（§1 非目标 L15），但 story2video 的 TTS/IMAGE/VIDEO 生成本就是"调用命中限流类错误"的主要面，且已具备 errorCategory 通道。PRD P0-8 承诺范围是"发布/调用命中限流类错误"。排除之构成范围缺口（§8 请求评审点 #4）。
**证据**：notify 白名单已含 `story2video.` 前缀且 story2video 侧已有 `quota_exceeded/rate_limited` errorCategory（`notify.js:21,27`、proposal §2 L23）；PRD §5 P0-8 L88「发布/调用命中限流类错误」。
**期望修复**：至少在 PRD 层面记录"story2video 通知面延后"为已知缺口并给出二期计划，或在方案中说明为何不算违背 P0-8。

### C-8 · Major · 完整性
**问题**：结论 level（ok/warn/fail → 弹窗"正常/偏紧/异常"）如何从 `metrics/assertions/timeline` 映射得出，方案完全未定义（§3.3 L60、§3.4 L65）。
**证据**：`runSelfCheck` 产出 assertions 为 pass/fail 布尔数组（`rate-limit-self-check.js:115`），无 level 概念；proposal 未给出聚合规则。
**期望修复**：给出确定性映射（如"全部 pass→ok / 某断言失败→warn / 超时或异常→fail"），并锁定单测。

### C-9 · Major · 可行性
**问题**：`Promise.race` 硬超时 10s（§3.2 L52）不会取消底层自检。超时返回 `fail` 后，孤儿 self-check 完成时会再写一条真实 `diagnose_result`（§3.3 L60），同一码出现"fail + 实际结论"两行矛盾日志。
**证据**：self-check 用 `Promise.all + setTimeout`（`rate-limit-self-check.js:81,91-100`），race 无法中断；写日志在 self-check 完成回调里。
**期望修复**：为诊断任务分配 `abortSignal`/完成标志，超时后抑制迟到的写日志；或"码-结论"一次性绑定。

### C-10 · Major · 安全性 / 完整性
**问题**：fire-and-forget 异步自检未处理 app quit（§8 请求评审点 #6）。self-check 内 `setTimeout` 与 governor `sleep` 均未 `unref()`，进程退出阶段定时器会保持引用，可能延迟退出或在窗口销毁后调用 `log.notify`。项目对同类 timer 已显式 unref。
**证据**：`rate-limit-self-check.js:81` 与 `api-usage-governor.js:46` 的 sleep/setTimeout 无 unref；对照 `batch-manager.js:401-402`「R28 修复：unref 让定时器不阻止进程退出」。
**期望修复**：注册 `before-quit`/`will-quit` 时置位 shutdown 抑制新诊断与迟到写日志；timer unref；或在 quit 前 flush/丢弃。

### C-11 · Minor · 一致性 / 清晰度
**问题**：§3.2 L52 时长自相矛盾："理论总时长 <1s"紧接着又写"约 3-4s"。实为 60rpm→1s 间隔、4 请求按时间槽错峰 ≈3s。
**证据**：`_pace` 每请求推进 `nextSlotAt += 60000/rpm`（`api-usage-governor.js:315-318`），4 请求≈3s。
**期望修复**：改为"≈3s（<10s 硬超时）"，删除"<1s"。

### C-12 · Minor · 安全性
**问题**：`log.notify` 语义歧义 + 与 notify:log IPC 限速的交互（§8 请求评审点 #7）。§3.3 L60 写 `log.notify('publishDiagnose', 'publish.diagnose_result', ...)`：`log.notify` 是主进程 logger 方法（`notify.js:100`），**不经** `notify:log` IPC，因此 notify.js 的"每 key 每 10s 20 条"限速（`notify.js:37-38,58-70`）对它不生效——诊断结论不会因该限速丢。但若实现改走 renderer→notify:log，密集失败会命中限速被聚合丢弃。
**证据**：`notify.js:36-38,93-97`（超限降级聚合计数、`RATE_MAX_PER_KEY=20`、`RATE_WINDOW_MS=10000`）。
**期望修复**：明确结论日志由主进程 `log.notify` 直写（不受 renderer IPC 限速），并在测试中锁定路径。

### C-13 · Minor · 完整性（体验权衡）
**问题**：首错只给码不给结论（§3.3 L61、§5 L84）。PRD 允许"仅日志降级"，且最常见重复失败有缓存结论，权衡可接受；但 pending 文案"结论已写入诊断日志"可能被用户误读为"系统在后台跑"。§8 请求评审点 #2。
**期望修复**：文案明示"正在诊断，稍后写入日志"；或首错走"延迟回填"（二期 webContents.send，方案已声明本期不做，需在 PRD 记为体验缺口）。

### C-14 · Minor · 一致性
**问题**：`formatUserError` 现返回 `{ errorCode, message, matched }`；方案 §3.4 L64 改述为返回 `{ message, errorCode, diagnoseTag? }`，未说明 `matched` 是否保留。
**证据**：`src/utils/user-facing-error.js:194,203,211,226` 均 return 含 `matched`。
**期望修复**：保留 `matched` 并追加 `diagnoseTag`，测试契约锁定"无 tag 时逐字节不变"（§6 L90 已提，需含 matched 断言）。

### C-15 · Minor · 完整性
**问题**：渲染层消费现状描述不准。方案 §2 L22「各页面 ElMessage.error(formatUserError(...).message)」与调用点部分相符，但存在大量 `formatUserError(e, ...)` 传入**渲染层抛出的 Error** 而非 IPC result；该 `e` 不含 `diagnoseTag`（跨进程序列化只发生在 result 对象上，抛出的新 Error 丢失自定义字段）。故"仅当 err.diagnoseTag 存在才拼接"（§3.4 L63）对 catch 分支路径失效。
**证据**：`AiWriterPanel.vue:368,431,456,480`、`App.vue:193`、`KeywordMonitorPanel.vue:130,161` 等以 `e/err`（throw 出来的）调用；以 `result`（IPC 返回）调用的仅 `App.vue:188`、`BenchmarkChart.vue:155`、`KeywordMonitorPanel.vue:158`、`ApprovalGateModal.vue:181,206,235`。
**期望修复**：明确"仅 invoke-result 路径可携带 diagnoseTag"，并说明 throw-based 调用点如何拿到 tag（bridge 需把 result.diagnoseTag 透传到抛出的 error，或统一改判 result）。
