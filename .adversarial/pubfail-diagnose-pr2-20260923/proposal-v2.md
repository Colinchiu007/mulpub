# Proposal v2 — PR-2 / P0-8：发布失败被动附带诊断（限流自检结论码）

> 回应 critique-v1 全部 15 条（C-1~C-15 全部接受，详见 rebuttal-v1.md）。核心重构：放弃「IPC 统一 handle 包装层挂载」，改为**已知限流抛出点显式挂钩 + 复用既有分类器 + 分通道能力承诺**。

## 0. 承诺分级合同（本次修订的总纲）

| 面 | 承诺级别 | 条件 |
|---|---|---|
| 结构化日志 `publish.diagnose_result` | **保证**（所有触发点全覆盖） | 每次真实自检恰好一行结论；码↔结论 1:1 |
| 报错弹窗附带码/结论 | **best-effort**（仅 IPC invoke-result 路径 + 缓存命中时） | preload 统一包装可 ≤10 行透传才做，否则首期降级为仅日志（PRD R5 明文允许） |
| RPA 批量失败事件 payload | 搭车挂 `diagnoseCode` 字段，渲染层本期不消费 | 为二期 UI 展示预留数据 |

## 1. 目标与非目标

**目标**（与 v1 同，范围承诺修订）：
1. 命中限流类错误（`classifyProviderFailure ∈ {'rate','quota'}`，含 governor RATE_LIMITED/QUOTA_EXCEEDED/排队超时、RPA 平台 429 文本）时自动触发轻量真机自检。
2. 结论码进日志（保证）；缓存结论尽力进弹窗（不阻断、不掩盖主报错）。
3. 不新增独立入口/IPC 通道；主链路语义零改动（挂钩点仅追加 fire-and-forget 调用，错误对象字段与控制流不变）。

**非目标 + 已知缺口登记**（回应 C-7）：story2video 通知面本期不接入 → 写入 PRD §10 开放问题（主要"调用"面之一缺结论码，二期接 `errorCategory` 通道）；运营中心远程触发、P0-6 卡片改动、首错弹窗延迟回填均二期。

## 2. 触发架构（回应 C-1/C-2/C-3）

新文件 `electron/services/pubfail-diagnose.js`（预算 ≤220 行），唯一导出：

```js
maybeDiagnose(errLike, ctx) // ctx: { source:'governor'|'batch', providerId?, type? }
```

- **输入归一化**：接受 Error 实例 / `{message}` / `{code,errorCode,message}` 三种形状；分类**只调用** `classifyProviderFailure`（`adapters/_base/provider-error.js`，唯一事实源，不自写正则）。非 `'rate'/'quota'` → 立即 return false，零副作用。
- **挂钩点（全部为显式单行调用，fire-and-forget）**：
  1. `api-usage-governor.js` 两个最终抛错出口：retry429 耗尽 `throw error` 处、排队超时 reject 处。调用形如 `pubfail.maybeDiagnose(err, {source:'governor', providerId, type})`。
  2. `batch-manager.js` item 转失败（`ok:false` 组装、`webContents.send('batch:progress')` 之前）：`maybeDiagnose({message: item.message}, {source:'batch'})`，命中则在 item payload 上挂 `diagnoseCode`（新增字段，不改既有字段）。
  - **循环依赖处理**：governor ← self-check ← diagnose 形成环；diagnose 在 governor 内经 `lazyRequire`（函数体内 require + try/catch 吞异常）打破；diagnose 自身不 require governor 实例，读限额配置经参数注入（ctx 带 limits 快照，由调用点传入 `g.limitsOf?` 或读 `_limits`——以实际字段为准，实施时核实，不可得则用回退探针）。
  - 挂钩点总数固定 ≤3，逐点用契约测试锁定「不改 code/message/控制流」。
- **不做**：不代理/包装任何 IPC 返回值；不全局扫描 IPC 结果；不在渲染层触发。

## 3. 自检执行（回应 C-5/C-6/C-8/C-9/C-10/C-11）

- 探针参数：优先取**触发失败的 provider 实际限额**（rpm/maxConcurrent/cooldownMs），经 `runSelfCheck` 的 `_validate` 边界钳制；不可得时回退 `{rpm:60, requestCount:4, requestDurationMs:20}`（理论 ≈3s）。假 adapter 零网络零额度不变。
- 硬超时 10s：`Promise.race` + `settled` 标志——超时判 `fail` 写日志后，迟到的自检完成回调**一律丢弃**（一个码至多一行结论）。
- 防抖三件套：并发去重（至多 1 个在跑，后续复用同一 promise）；结论缓存 `{code, level, ts}` **整体复用**（TTL 内新失败挂同一码同一结论，不产生新码）；触发节流 ≥60s 一次真实自检（governor 默认 llm rpm 30 下，60s 窗口最多几十次失败，节流后自检频率远低于弹窗噪音阈值）。
- **level 确定性映射**（单测锁）：
  - `ok`：全部 assertions pass 且 `total_duration_ms ≤ 1.5×理论时长`
  - `warn`：assertions 全 pass 但总时长超 1.5×，或 `rate_limited_count` 异常（>注入数）
  - `fail`：任一 assertion 失败 / 超时 / 执行异常
- 生命周期：`app.on('before-quit')` 置 `shutdown`——`maybeDiagnose` 直接 return、迟到结论不写日志；执行端 `rate-limit-self-check.js` 零改动。

## 4. 结论落地（回应 C-12/C-15）

- **日志面（保证）**：主进程 `logger.notify('publishDiagnose','publish.diagnose_result',{errorCategory, level, code, assertionsSummary, source})` —— 直接走 logger，不经 `notify:log` IPC（避开每 key 10s/20 条聚合限速；此路径选择写入代码注释）。
- **弹窗面（best-effort）**：实施第一tick核实 preload 是否存在统一 `ipcRenderer.invoke` 包装（`electron/preload/access-control.js` 候选）：
  - 存在且 ≤10 行可透传 `result.diagnoseTag → thrown Error.diagnoseTag` → 接通：`formatUserError` 返回 `{errorCode, message, matched, diagnoseTag?}`（**保留 matched**，C-14），仅当入参携带 tag 才在 message 尾部拼 locale 文案；无 tag 输出与现状**逐字节一致**。
  - 不存在 → 首期仅日志面，PRD 记录降级决定。
- locale zh/en 成对（Gate 7）：`diagnose.attached.ok/warn/pending`（「 · 本地调度诊断：正常 · 码 {code}」/「…偏紧… 码 {code}」/「 · 正在诊断，结论稍后写入日志 · 码 {code}」；fail 不渲染弹窗免恐慌/掩盖主报错，仅日志）。

## 5. 数据校验与边界

| 项 | 规则 |
|---|---|
| 分类 | 仅 `classifyProviderFailure` ∈ {'rate','quota'}；null/非对象→false |
| 探针参数 | provider 实际配置经 `_validate` 钳制；越界回退默认探针 |
| 码 | `D-`+6 位 base36（时间低位+单调序号）；缓存期复用同一码；新码↔新日志行 1:1（单测断言） |
| 打包态 | 生产路径，无 flag；与 P0-6 一致 |

## 6. 测试契约（TDD 先行，红→绿）

1. `pubfail-diagnose.test.js`：分类正反例（含"当前请求频率已达上限"文案命中、普通错误不误判）；三形状归一化；挂钩点外无副作用（mock self-check 断言调用次数）；缓存 {code,level} 绑定复用；60s 节流；并发去重；超时 settled 抑制迟到双写；shutdown 抑制；level 三档映射；探针参数取实际配置+钳制。
2. `user-facing-error.test.js` 扩展：有 tag 拼接 / 无 tag 逐字节不变（含 matched 断言）。
3. 契约测试：`api-usage-governor`/`batch-manager` 挂钩点仅新增 `maybeDiagnose` 调用行，错误对象字段快照不变；渲染层不出现 self-check 直调。
4. Gate 7 locale 成对 + 债务行数自查。

## 7. 风险与对策（更新）

- R-A 误分类 → 复用生产已验证分类器，风险收敛到分类器自身（已被 story2video 面使用）。
- R-B governor 挂钩点也在后台任务触发 → 仅日志面增长（可接受，正是诊断价值），弹窗面不受影响（弹窗只消费缓存）。
- R-C lazyRequire 环 → 单测覆盖 governor require diagnose 失败场景（异常吞掉不影响抛错）。
- R-D 承诺分级被误解 → §0 合同写进 PRD 回写与 CHANGELOG。

## 8. 请求二轮评审的攻击点

1. 挂钩点选择（governor 2 出口 + batch 1 处）是否遗漏主路径？是否引入不可接受的主链路侵入？
2. 缓存 {code,level} 整体复用（TTL 内同码）与「用户快速改配置后结论过期」的权衡（10min 是否过长）。
3. preload 透传条件化（≤10 行才做）是否会造成「弹窗面不可预测」——是否应直接首期砍掉弹窗面只做日志？
4. level=warn 阈值 1.5× 理论时长是否有依据。
