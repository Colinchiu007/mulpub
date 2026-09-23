# Critique v2 — PR-2 / P0-8 发布失败被动附带诊断（proposal-v2.md 第二轮对抗评审）

- 评审方：独立 critic（第 2 轮实例）
- 评审对象：`.agent_context/adv/proposal-v2.md`；对照 `.agent_context/adv/critique-v1.md`、`.agent_context/adv/rebuttal-v1.md`
- 验证基准 worktree：`D:\Data\projects\mp-worktrees\mp-pubfail-diag`（方案路径相对 `apps\desktop\`）
- 方法：①逐条核对 C-1~C-15 是否在 v2 真实闭环；②对 v2 新声称（governor 两出口、preload 咽喉点、logger 签名、_validate 钳制、总时长指标）以 file:line 逐一验真。

## 结论（先行）

**Conditional Pass：架构方向正确（v1 的 IPC 单点挂载谬误已被真实代码驱动的显式挂钩取代），但存在 2 条 Critical 必须在实施前修复——N-1 弹窗面 tag 无生产者（与 §1"错误对象字段不变"自相矛盾，直接回答其 §8.3：应砍）、N-2 governor 挂钩点宣称"两个最终抛错出口"被代码证伪（实际 rate/quota 出口 ≥6 处，漏掉的 `_pace` 恰是最需要自检诊断的出口）。其余 5 Major/Minor 见清单。**

---

## 一、C-1~C-15 闭环核对表

| # | 裁决 | 证据与说明 |
|---|---|---|
| C-1 | **闭环（架构选择正确）** | v2 §2 放弃 handle 包装层，改错误产生点显式挂钩。经核：`_executeWithRetry` 的 `if (attempt >= limits.retry429) throw error`（api-usage-governor.js:419）与 `_sweepExpired` 的 `waiter.reject(new ProviderError(RATE_LIMITED,'排队等待超时...'))`（:278）两处确实存在，在 throw/reject 前插入不抛异常的同步调用确实不改控制流。但"仅这两个出口"不成立 → 新问题 N-2。 |
| C-2 | **闭环** | v2 定义 `maybeDiagnose` 三形状归一化；batch 挂点选在 `_emitProgress` 的 `webContents.send('batch:progress', {kind:'task-complete', ok:!result?.error, message: result?.error...})` 之前（batch-manager.js:411-423），message 可拿到（`result?.error` 字符串），新增 `diagnoseCode` 字段可行。注意实际代码中该处变量是 `result?.error` 而非 `item.message`，v2 表述为示意形状，实施时以真实形状为准（不构成缺陷）。 |
| C-3 | **闭环** | v2 §2 明确"不代理/包装任何 IPC 返回值；不全局扫描"。全局盲判 `code!==0` 与每 IPC 跑正则的质疑随之消解。 |
| C-4 | **闭环** | 复用 `classifyProviderFailure`（provider-error.js:274-299）为唯一事实源，删除自写正则。经核关键疑点：排队超时文案「排队等待超时，请稍后重试。」确实**不含** `RATE_LIMITED_MESSAGE_PATTERN` 任何关键词（:229 无"排队"），**但** governor 抛出的是 `ProviderError`，`.code==='RATE_LIMITED'` 命中 L280 的 code 分支 → 归 'rate'，governor 挂钩点传完整 Error 实例时**不失效**。残余风险仅在"降级为 {message} 形状传参"时该文案会落入 `TRANSIENT_MESSAGE_PATTERN`（含"超时"，:239）被判 'transient' → 静默不诊断（N-3 附注，不构成 C-4 重开）。 |
| C-5 | **闭环** | §3 缓存条目 `{code, level, ts}` 整体复用 + §5"新码↔新日志行 1:1 单测断言"。逻辑自洽。残余：缓存 key 维度未定义（N-5）。 |
| C-6 | **部分闭环** | 改进真实：§3 探针优先取触发 provider 实际 rpm/maxConcurrent/cooldownMs，经核 `runSelfCheck` 的 `_validate` 确实接受 `maxConcurrent`（:34）与 `cooldownMs`（:40-41）入参。但引入新矛盾：真实低 rpm 配置与 10s 硬超时不兼容（N-4），且"钳制"不实（N-6），limits 快照来源含糊（N-8）。 |
| C-7 | **闭环** | §1 将 story2video 通知面登记为 PRD §10 已知缺口 + 二期 `errorCategory` 通道计划，不再伪装零代价"非目标"。 |
| C-8 | **闭环（带小缺陷）** | §3 给出确定性三档映射且声明单测锁。`total_duration_ms` 确在 metrics 中（rate-limit-self-check.js:105）✓。缺陷：理论时长公式未定义（N-4）、warn 的 `rate_limited_count>注入数` 条件不可达（N-7）。 |
| C-9 | **闭环** | §3 硬超时 + `settled` 标志，迟到回调一律丢弃，"一个码至多一行结论"。对 race 不可中断的正确处置。 |
| C-10 | **部分闭环** | `before-quit` 置 shutdown、抑制新触发与迟到日志，方向正确。残余：在途 self-check 的 `setTimeout`（rate-limit-self-check.js:81）与 governor `sleep`（api-usage-governor.js:46）仍无 unref（执行端零改动的决定使然），退出时最多被拖住≈自检实际时长（默认探针场景 ~3s）；v2 未声明这是可接受还是有 flush/discard 策略。可接受但应显式写出。 |
| C-11 | **闭环** | 「理论 ≈3s（60rpm×4 请求），硬超时 10s」与 `_pace` 每请求推进 `60000/rpm`（:315-318）的数学一致（4 请求 3 间隔 ≈3s）。仅对**默认回退探针**成立，真实配置探针时长未定义 → N-4。 |
| C-12 | **闭环** | §4 明确主进程 `logger.notify(module, messageKey, meta)` 直写。经核签名匹配（logger.js:197-207，meta.errorCategory 有专门白名单透传），且该路径确实不经 `notify:log` IPC，不受 notify.js:37-38 的每 key 10s/20 条限速。`publish.diagnose_result` 即便走 IPC 也在 `publish.` 白名单前缀内（notify.js:28），双保险。 |
| C-13 | **闭环** | pending 文案改「正在诊断，结论稍后写入日志 · 码 {code}」；延迟回填列二期体验缺口。 |
| C-14 | **闭环** | §4 明确保留 `matched`，§6.2 测试契约含 matched 断言 + 无 tag 逐字节不变。 |
| C-15 | **未闭环** | v2 把合同收窄到"invoke-result 路径 + 缓存命中"，但收窄后的路径仍然**不成立**：弹窗 tag 在 v2 架构内没有任何生产者（详见 N-1）。preload 咽喉点声称经核为**证伪**——`preload/access-control.js` 是权限网关，其包装函数 `return value.apply(this, args)` 原样透传 Promise，不做任何 result 处理；各桥接方法（publish.js/aggregation.js 等）各自直调 `ipcRenderer.invoke`，**不存在统一 invoke 包装层**。 |

**小结：12 条闭环、2 条部分闭环、1 条未闭环（C-15）。v1 的三大 Critical（C-1/C-2/C-3）核心叙事均已真实修正；回应的诚实度高，但弹窗面与挂钩覆盖面两处出新问题。**

---

## 二、v2 新问题清单

### N-1 · Critical · 一致性 / 可行性：弹窗面 diagnoseTag 无生产者，且 preload 咽喉点声称被代码证伪

**问题**：v2 §0/§4 承诺"缓存结论尽力进弹窗"，机制为"preload 统一 `ipcRenderer.invoke` 包装（候选 access-control.js）≤10 行透传 `result.diagnoseTag → thrown Error.diagnoseTag`"。三处与代码不符/逻辑断裂：
1. **无统一 invoke 包装**：`preload/index.js:85-113` 中每个 API 方法（publish.js、aggregation.js、auto-pipeline.js 等全部工厂函数）直接 `ipcRenderer.invoke(channel,...)`；`createDynamicAccessApi` 的包装（access-control.js:133-138）只做权限检查后原样返回 Promise，不触碰 result。不存在 §4 设想的挂载点。
2. **透传是伪需求**：IPC 结构化克隆本身就保留 result 对象的自定义字段——若主进程 handler 把 `diagnoseTag` 写进 result，renderer 直接可见，无需 preload 改一行；反过来，真正丢字段的环节是 renderer 视图层**散落**的 `if (result?.code !== 0) throw new Error(result?.message)`（实测 CreateView.vue:5047、ResultView.vue:1084 等数十处、PublishHistory.vue:628），把 tag 挂到 thrown Error 上需要动每个 throw 点——远超"≤10 行"。
3. **tag 根本没有写入方**：谁把 `diagnoseTag` 放进 IPC result？必须是主进程 handler 的 catch 把 `err.diagnoseTag` 复制进返回值——但 v2 §1 目标 3 白纸黑字承诺"错误对象字段不变"，§2 "不做"清单又排除"代理/包装任何 IPC 返回值"，挂钩点也仅限 governor/batch。**闭环缺失：弹窗面在 v2 自身架构内不可达**。
**修复要求**：接受 §8.3 的自问并砍掉弹窗面首期交付——合同改为"日志面（保证）+ batch payload `diagnoseCode`（数据预留）"两行；若坚持弹窗面，唯一自洽路径是二期"延迟回填 `webContents.send`"（v2 已声明不做）。§0 承诺表、§4 弹窗段、§6.2 测试项随之删除或降级为二期。

### N-2 · Critical · 完整性 / 一致性：governor"两个最终抛错出口"不实——rate/quota 出口实为 6 处，漏掉的 `_pace` 恰是最该自检的出口

**问题**：v2 §1.1 承诺触发"含 governor RATE_LIMITED/QUOTA_EXCEEDED/排队超时"，§2.2 却只挂 2 处。以 api-usage-governor.js 全文核对，产出 rate/quota 分类结果的抛出/拒绝出口共 6 处：
| 出口 | 位置 | 错误 | v2 是否挂钩 |
|---|---|---|---|
| retry429 耗尽重抛 | L419 `_executeWithRetry` | 上游原始 429（rate） | ✅ |
| 排队超时 reject | L278 `_sweepExpired` | RATE_LIMITED | ✅ |
| **RPM 预算耗尽** | L320-326 `_pace` | RATE_LIMITED「当前请求频率已达上限」 | ❌ |
| **冷却期过长** | L333-339 `_waitCooldown` | RATE_LIMITED 冷却文案 | ❌ |
| **额度预检拒绝** | L368-375 `_preflightTokenBudget` | QUOTA_EXCEEDED | ❌ |
| **额度后置断言** | L392-399 `_assertTokenBudget` | QUOTA_EXCEEDED | ❌ |
**讽刺点**：§6.1 测试契约把「当前请求频率已达上限」列为分类正例——该文案正是 `_pace` L323 抛的，而此出口无挂钩，正例文案在生产中永远不触发诊断，测试给出虚假安全感。且 `_pace` 是**本地调度预算耗尽**（governor 自身限住自己），恰是"内部调度 vs 上游限流"二分法中最需要自检结论的场景；QUOTA_EXCEEDED 两个出口整体漏掉，与 §1.1 的"QUOTA_EXCEEDED"承诺直接矛盾。
**修复要求**：不必加到 6 个挂点（违背"≤3"预算）。改在 `_runWithGovernance` 返回链上单点汇聚：`run()` 处 `return this._runWithGovernance(...).catch(err => { try { maybeDiagnose(err, {source:'governor', providerId, type}) } catch {} ; throw err })`——1 处覆盖全部 6 出口（含重入透传路径外的所有调度错误），fire-and-forget 语义与"控制流不变"仍成立（catch-rethrow 不改错误对象）。§2 挂钩点计数与 §6.3 契约测试同步改写。

### N-3 · Major · 可行性（鲁棒性）：挂钩行未强制"永不抛同步异常"契约，`_sweepExpired` 内异常将改变排队回收控制流

**问题**：§2 承诺"仅追加 fire-and-forget 调用……控制流不变"，但全文没有规定 `maybeDiagnose` 的**同步不抛**契约。`_sweepExpired` 的挂钩点在 while 循环体内（L276-282），若 maybeDiagnose 同步抛（如 lazyRequire 之外的分类器异常、ctx 组装 bug），异常会从 `_sweepExpired` 逃逸 → 打断后续过期 waiter 回收 → 原本应被 reject 为排队超时的 waiter 改由 `_acquireSlot` 的 await 处抛，且 `_pump`（L253 调用方）路径也会炸——**诊断模块故障升级为调度器故障**。`_executeWithRetry` L419 前插入同理（异常吞掉原 error 的 throw 语义）。
**修复要求**：v2 写入硬性契约：① `maybeDiagnose` 同步路径零抛出（内部全 try/catch）；② 调用点统一 `void Promise.resolve(...).catch(noop)` 包裹形态；③ §6.3 契约测试增加"maybeDiagnose 内部抛异常时挂钩点行为不变"用例。另：若按 N-2 修复采用 catch-rethrow 汇聚点，异常包裹更须强制。

### N-4 · Major · 正确性（诊断有效性）：真实配置探针与 10s 硬超时系统性冲突，低 rpm provider 将恒判假 'fail'

**问题**：§3 探针优先取 provider 实际限额，但 DEFAULT_LIMITS（api-usage-governor.js:29-38）：tts/image/audio **rpm 10** → `_pace` 间隔 6s；video **rpm 4** → 间隔 15s；llm rpm 30 → 间隔 2s。真实配置探针若沿用默认 requestCount=4：tts 理论时长 ≈3×6s=**18s**、video ≈45s，全部突破 10s 硬超时 → level 恒为 'fail'（§3"超时判 fail"）。**结论码大面积假异常，比 C-6 的"恒过无信息量"更糟**——它会主动误导日志消费者。且 v2 对真实配置探针的 requestCount 未定义、"理论时长"公式全文未给（1.5× 无锚点，回应 §8.4：问题不在 1.5× 系数，在理论时长本身没定义）。
**修复要求**（三选一写死进 v3）：① 探针固定 `requestCount:2` + 实际 rpm（理论=60000/rpm+duration，tts≈6s、video≈15s——video 仍超，需配②）；② 超时自适应：`timeoutMs = max(10s, 1.5×理论时长 + 2s)`；③ 对 rpm 设下限钳制（如 rpm≥20 跑形状不变性检查），并声明"探针验证的是 governor 调度正确性，不是复现用户速率"——此时回到 C-6 质疑需再论证。推荐 ②+理论公式：`(requestCount-1)×60000/effectiveRpm + requestDurationMs`。

### N-5 · Major · 一致性 / 完整性：缓存与节流的 key 维度未定义 + code 发放时机未定义

**问题**：① §3"触发节流 ≥60s 一次真实自检"与"结论缓存 TTL"均未说 key。若全局单槽：openai llm 的自检结论会在 TTL 内挂到 minimax-tts 的失败上——跨 provider 张冠李戴，诊断结论错误且日志面（v2 唯一"保证"级承诺）无法追溯纠正。② code 何时发放？pending 弹窗文案（§4，若 N-1 后仍保留 batch/日志面的 pending 概念）与"首错给码"要求 code 在自检**完成前**存在，而缓存 `{code,level,ts}` 在完成后才写入——在途新失败的归属（挂 pending 码？等新码？）未定义，与 §6.1"缓存 {code,level} 绑定复用"测试间有真空。
**修复要求**：写死 cache key = `providerId + ':' + type`（batch 面 key='batch:publish' 单独一档或全局一档，需明示）；节流窗口 per-key；定义"在途失败复用同一 in-flight promise 的最终 code"（§3 并发去重已有此机制雏形，扩展到节流窗口内：新失败直接挂 in-flight code 为 pending，完成后同一码写结论行——维持"码↔结论行 1:1"）。

### N-6 · Minor · 清晰度（不实措辞）："`runSelfCheck` 的 `_validate` 边界钳制"——`_validate` 实际越界**抛 TypeError**，不钳制

**证据**：rate-limit-self-check.js:27-43，全部越界路径为 `throw new TypeError(...)`；唯一的"默认换算"是 `maxConcurrent` 留空时 `clampConcurrency(rpm)`（:34,:23-25）。§5"越界回退默认探针"暗示了 catch 兜底，方向对，但 §3"经 _validate 边界钳制"的表述会诱导实现者直接透传用户配置然后被 TypeError 炸掉回退路径。另注意真实边界会触发抛错：运营配置 cooldownMs>60000（video 生产默认 60000 已贴边，>60000 即抛）、maxConcurrent>8。
**修复要求**：措辞改"调用前自行钳制 + 包 try/catch，_validate 抛错则回退默认探针"。

### N-7 · Minor · 正确性：warn 映射条件「rate_limited_count 异常（>注入数）」不可达（死条件）

**证据**：自检内 `rate_limited` 计数**只在 inject429At 命中时**累加（rate-limit-self-check.js:75-79）；被动自检无注入 → 恒 0；governor 内部 `_pace` 若真抛 RATE_LIMITED，其错误被 L96-99 的 catch 吞掉且**不**计入 `rate_limited`。`no_rate_limited` 断言（:132）同样恒真。该 warn 分支永远走不到，徒增映射表复杂度与测试假覆盖。
**修复要求**：删除该条件（warn 仅保留"总时长>1.5×理论"），或改为可观测信号（如 timeline 中 `state==='rate_limited'` 计数）。

### N-8 · Minor · 清晰度 / 可行性：`limitsOf?`/"读 `_limits`" 是猜测性表述；且 limits 快照漏掉自适应因子

**证据**：api-usage-governor.js 无 `limitsOf` 公开接口；`this._limits`（:63）仅是精确 key 覆盖表，不含解析链。实际唯一事实源是私有方法 `_limitsFor(key, type, providerId)`（:140-144，精确 key > providerLimits > 类别默认）——JS 下可调，但 v2 写"以实际字段为准，实施时核实"违背了 C-1 的教训（先核代码再写合同）。另：有效预算是 `_effectiveRpm = limits.rpm × st.rateFactor`（:303-305），429 自适应后 rateFactor 最低 0.2——只取名义 rpm 的"limits 快照"会让探针跑在用户**当前并不会遇到**的预算上。§2.2 排队超时出口的 ctx 组装也有同类问题：`_sweepExpired` 作用域内只有 key 字符串（`providerId:type:model`），type 需从 key 反解。
**修复要求**：写死"经 `_limitsFor(key,type,providerId)` 取基线 + `st.rateFactor` 折算 effective rpm（或明示不折算的理由）"；二选一即可，但必须选定。

---

## 三、五维度重新打分（对比 v1：6/5/6/4/7）

| 维度 | v1 | v2 | 一句话理由 | 升降说明 |
|---|---|---|---|---|
| 完整性 | 6 | **7** | 生命周期/防抖/缓存绑定/已知缺口登记/level 映射全部补齐，但挂钩覆盖漏 4/6 出口（N-2）、缓存 key 维度缺失（N-5）构成新的完整性洞。 | ↑1：C-7/C-8/C-10 类缺口消除，N-2/N-5 新洞未能满 8。 |
| 一致性 | 5 | **6** | v1 三处内部矛盾全修（时长、码-日志 1:1、挂载叙事），但新增两处自相矛盾：弹窗 tag 无生产者 vs "错误对象字段不变"（N-1）、承诺覆盖 QUOTA_EXCEEDED vs 只挂 rate 出口（N-2）。 | ↑1：旧矛盾清零值得肯定，新矛盾数量与严重度均低于 v1。 |
| 清晰度 | 6 | **7** | 承诺分级合同表、挂钩点枚举、数据校验表显著提升可操作性；扣分在"实施时核实"式留白（N-8）、理论时长公式缺失（N-4）、code 发放时机含糊（N-5）。 | ↑1。 |
| 可行性 | 4 | **6** | 核心架构已落在真实代码上：两挂钩点位置属实、控制流可保、logger.notify 签名匹配、runSelfCheck 接受 maxConcurrent/cooldownMs、分类器对 ProviderError 走 code 分支正确——均可实施；但弹窗面整段不可达（N-1）、低 rpm 探针恒超时（N-4）是实施即翻车点。 | ↑2：从"架构性证伪"降到"局部可修"，修复 N-1/N-4 后可到 8。 |
| 安全性 | 7 | **8** | 零新增 IPC 通道、主进程 logger 直写（meta 走 logger.js:205-207 脱敏与 stringify，不外泄原始 message）、假 adapter 零网络零额度、fire-and-forget 不触碰用户数据路径；扣分：N-3 调度器异常传染风险未设防。 | ↑1。 |

**与 v1 对比总评**：28/50 → 34/50。v2 是实质进步而非文字游戏——rebuttal 的 15 条"接受"有 13 条在文本中兑现为可验证的具体机制。剩余问题集中在两处"新写的事实声称"未像旧声称那样经代码核验（preload 咽喉点、两出口穷尽性），恰是其 §8 主动请求攻击的方向。

---

## 四、对 v2 §8 主动请求评审的四点答复

1. **挂钩点是否遗漏主路径/侵入性？** 遗漏严重（N-2）：漏 `_pace`/`_waitCooldown`/额度×2，其中 `_pace` 是"调度器自身限住用户"的最核心诊断对象；建议改 `_runWithGovernance` 调用链单点 catch-rethrow（1 处覆盖 6 出口，侵入性反而低于 2 处散挂）。侵入性本身可接受，但必须加 N-3 的永不抛契约。
2. **TTL 10min 是否过长？** 在 key 维度未定义（N-5）前讨论 TTL 无意义。定义 key=`providerId:type` 后，10min 偏长但不致命——真正该做的是**配置变更失效钩子**：governor 的限额唯一变更入口是 `setLimits/setProviderLimits/removeProviderLimits`（L86-120），单点挂"清空对应 key 缓存"成本≈0，做完之后 TTL 10min 可保留。另：探针取 limits 快照（名义+rateFactor 折实），"用户改配置后结论过期"的担忧大半消解。
3. **弹窗面是否该砍？** **该砍（首期）**。理由见 N-1：非"≤10 行条件不满足"这么简单，而是 tag 在 v2 架构内无生产者、preload 咽喉点不存在、真正透传点在 renderer 数十个 throw 处。保留即合同违约风险。§0 承诺表删弹窗行，batch payload `diagnoseCode` 作为二期 UI 的数据预留保留。
4. **1.5× 阈值是否有依据？** 系数本身无害（事件循环抖动/OS timer 粒度下 1.5 不算松），真正的问题（N-4）：真实配置探针下"理论时长"全文没有公式、且默认 10s 超时使低 rpm provider 的理论值不可达。给出公式 `(requestCount-1)×60000/effectiveRpm + requestDurationMs` 并将超时改为 `max(10s, 1.5×理论+2s)` 后，1.5× 才有意义。

---

## 五、修复优先级与放行条件

| 序 | 项 | 动作 | 工作量 |
|---|---|---|---|
| P0 | N-2 | 挂钩点改 `_runWithGovernance` 链单点 catch-rethrow，§1/§2/§6 同步 | ≤0.5d |
| P0 | N-1 | §0/§4 删除弹窗面首期承诺（降级为二期延迟回填），§6.2 保留"无 tag 逐字节不变"回归即可 | 纯文档 |
| P1 | N-4 | 理论时长公式 + 自适应超时 + 真实配置探针 requestCount 写死 | 设计段落 |
| P1 | N-3 | maybeDiagnose 永不抛契约 + 调用点包裹形态 + 异常注入契约测试 | ≤0.5h |
| P1 | N-5 | 缓存/节流 key 维度 + code 发放时机（in-flight 复用）写死；可选：limits 变更失效钩子 | 设计段落 |
| P2 | N-6/N-7/N-8 | 措辞修正与死条件删除 | 30min |

**放行判定：完成 P0 两项 + P1 三项的文本落定后可直接进入实施，无需第 3 轮全量评审（可 delta 复核）。**
