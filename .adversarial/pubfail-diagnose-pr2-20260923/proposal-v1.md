# Proposal v1 — PR-2 / P0-8：发布失败被动附带诊断（限流自检结论码）

- 任务：Multi-Publish `pubfail-diag-ops`（worktree 隔离，基于 origin/main 14f71f4cc4，含 PR-1）
- 约束来源：PRD `01-docs/PRD-RATE-LIMIT-SELFCHECK-MIGRATE-OPS-CENTER-2026-09-23.md` §5 P0-8 + 风险 R5（最高风险：侵入发布/调用错误链路）
- 硬约束（R5）：(a) 自检不得拖慢报错弹窗——异步/限时，默认失败静默降级，绝不阻断或掩盖主报错；(b) 限流类错误码判定须准确；(c) 可选降级为「仅写日志不改弹窗」。

## 1. 目标与非目标

**目标**
1. 发布/模型调用命中限流类错误（`RATE_LIMITED` / `QUOTA_EXCEEDED` / 429 冷却超时 / 平台限流）时，**自动**触发一次轻量真机自检（复用 PR-1 保留的执行端 `electron/services/rate-limit-self-check.js`，真实 governor + 假 adapter，零网络零额度）。
2. 把「结论码」附加到**既有**报错弹窗文案尾部（如「…请稍后再试。 · 本地调度诊断：正常 · 码 D-8F3K」）与结构化日志（`log.notify`），供用户转述/客服定位。
3. 不新增任何独立入口/按钮/弹窗；主链路语义零改动（错误对象的 code/message/控制流不变）。

**非目标**
- 不做运营中心远程触发（P2 另议）；不改 P0-6 黑盒诊断卡；不引入新 IPC 通道供 UI 轮询结论；不改 story2video 通知链路（本期只接「弹窗报错」与「主进程日志」两个面）。

## 2. 现状链路（侦查锚点）

| 环节 | 位置 | 事实 |
|---|---|---|
| 限流错误中央汇聚 | `electron/services/api-usage-governor.js` | 所有 LLM/TTS/IMAGE/VIDEO 调用经 `g.run()`；429→`ProviderError(RATE_LIMITED)`、额度→`QUOTA_EXCEEDED`、排队超时→`RATE_LIMITED`（L278）；`retry429` 有界重试后才最终抛出 |
| 弹窗文案单一漏斗 | `src/utils/user-facing-error.js` `formatUserError(err, {fallback})` | 429→`USER_ERROR_CODES.RATE_LIMITED`，文案 `userErrors.RATE_LIMITED`；各页面 `ElMessage.error(formatUserError(...).message)` |
| 通知日志通道 | `electron/ipc-handlers/notify.js` `notify:log` | messageKey 白名单前缀含 `publish.`；params 值级 deny-list；已支持 `errorCategory`（story2video 侧已有 `quota_exceeded`/`rate_limited`） |
| 自检执行端 | `electron/services/rate-limit-self-check.js` `runSelfCheck(params)` | 独立 governor 实例（不污染生产单例）、假 adapter、`_validate` 边界齐全；产出 `metrics/assertions/timeline` |
| IPC 受控包装 | `electron/core/ipc-security` `createAccessControlledIpcMain` + `isTrustedSender` | 所有 handler 已经统一包装层注册（audit-batch-3 后注入契约 fail-closed） |

## 3. 方案总览

```
主进程（新增，唯一触发点）                     渲染层（最小改动）
┌────────────────────────────────┐          ┌──────────────────────────┐
│ pubfail-diagnose.js（新 service）│          │ user-facing-error.js      │
│  · classifyRateLimit(errLike)   │          │  formatUserError 返回值新增 │
│  · requestDiagnose(ctx)         │          │   diagnoseTag?: string     │
│  · 同步: 生成码 D-xxxx + 挂到结果 │          │  · 仅当 err.diagnoseTag 存在│
│  · 异步: 跑 runSelfCheck(轻量)   │          │    才在 message 尾部拼接    │
│  · 防抖/复用窗口/超时/静默降级     │          │    t('diagnose.attached')  │
│  · 结论写 log.notify('publish..')│          └──────────────────────────┘
└───────────▲────────────────────┘            ▲
            │                                 │
   IPC handler 返回前包装：errResult 命中限流类 → result.diagnoseTag = 码/结论
   （在统一序列化层做，不逐个改 handler；发布 RPA 结果走同一挂载点）
```

### 3.1 触发与分类（主进程）
- 新文件 `electron/services/pubfail-diagnose.js`，导出：
  - `classifyRateLimit(errLike) -> boolean`：判定 `RATE_LIMITED` / `QUOTA_EXCEEDED` / 消息含 429·限流·rate limit·too many requests·排队等待超时·冷却超时。判定逻辑单一事实源放主进程（渲染层 user-facing-error 已有映射，不动它；两处语义对齐由契约测试锁定）。
  - `attachDiagnoseTag(result)`：若 `result.code !== 0`（失败）且 `classifyRateLimit(result)` → 生成码并挂载 `result.diagnoseTag`（不触碰 code/message/data 字段），同时 fire-and-forget `requestDiagnose()`。**同步部分只有：字符串生成 + Map 查找，微秒级，不 await 自检。**
- 挂载点：IPC 统一序列化包装层（`controlledIpcMain` 注册时对 handler 结果做一次性 `attachDiagnoseTag`），发布批量结果（`batch-manager` 逐条 item 级错误）同样经该函数。渲染层 `formatUserError` 只透传 `diagnoseTag` 字段并拼接文案。

### 3.2 自检执行（异步、限时、防抖）
- 固定轻量探针参数（不可被外部输入影响）：`{ rpm: 60, requestCount: 4, requestDurationMs: 20 }`，理论总时长 <1s（60rpm→1s 间隔，4 请求并发 4→约 3-4s）。**硬超时 10s**（`Promise.race`），超时/异常 → 结论 `fail`，均静默降级。
- **防抖与复用**：
  - 并发去重：同一时刻至多 1 个诊断在跑（后续请求直接等待同一 promise 或复用缓存）。
  - 结论缓存：最近一次结论（level + code + ts）缓存 TTL=10 分钟。TTL 内的新失败**不触发新自检**，直接复用结论 → 弹窗可同步显示「本地调度诊断：正常 · 码 D-xxxx」。
  - 触发节流：≥60s 内最多触发一次真实自检（用户快速重试多次不会打爆 governor 之外资源；自检本身零网络，风险仅是 CPU/定时器）。
- 码格式：`D-` + 6 位 base36（时间低位+序号混合），仅可读引用，不承载语义。

### 3.3 结论回写（日志面，保证不丢）
- 自检完成 → `log.notify('publishDiagnose', 'publish.diagnose_result', { errorCategory: 'rate_limited', level, code, assertionsSummary })`（level ∈ ok/warn/fail；assertionsSummary ≤2000 字符经既有 sanitizeParams 截断）。
- 弹窗面：同步可得（缓存命中）→ 结论+码；仅触发未得（首错）→ 仅码 +「结论已写入诊断日志」。二期再做结论回填已开弹窗（webContents.send），本期不做，降复杂度。

### 3.4 渲染层与 locale
- `user-facing-error.js`：`formatUserError` 返回 `{ message, errorCode, diagnoseTag? }`；message 拼接条件 = 输入 errLike 携带 `diagnoseTag`（主进程序列化带上）。无 tag 时行为与现在**逐字节一致**。
- locale zh/en 成对新增（Gate 7）：`diagnose.attached.ok/warn/fail/pending` 四条（「 · 本地调度诊断：正常 · 码 {code}」/「…偏紧…」/「…异常…」/「 · 本地调度诊断：码 {code}，结论已写入诊断日志」）。复用 PR-1 已建的 `settings.diagnose.*` 命名域，新增 `attached` 子键。

### 3.5 安全与门禁对齐
- 渲染层零直调 `window.electronAPI`（diagnoseTag 搭既有返回值便车，**无新 IPC 通道**）→ Gate 10 无影响。
- 自检参数硬编码 + `_validate` 兜底；错误消息进入弹窗前经既有 `userErrors` 文案白名单（不外泄原始 message）。
- 新文件行数预算：`pubfail-diagnose.js` ≤200 行；`user-facing-error.js` 增量 ≤15 行（当前 <500，不触债务熔断）；不动 `ModelProviders.vue`。
- 主进程内部 require 直用 service，不经过 renderer 桥接。

## 4. 数据校验与边界

| 项 | 规则 |
|---|---|
| 分类输入 | 仅读 `result.code/message/errorCode/statusCode`，非对象/空→false |
| 探针参数 | 常量冻结，不走任何用户输入；与 `_validate` 区间一致 |
| 缓存失效 | TTL 10min 或 governor 配置被运营更新（收到 `rate-limit:config` 类更新事件即清空缓存，保守起见可二期）|
| 码唯一性 | 进程内单调序号+时间混合，碰撞可忽略（展示用途） |
| 打包态 | 生产可见（P0-8 本身即生产被动路径，无 flag；与 P0-6 一致） |

## 5. 交互逻辑与显示项（用户视角）
1. 用户发布/生成 → 命中平台或服务商限流 → 报错弹窗（现有文案不变）尾部多一行小字：` · 本地调度诊断：正常 · 码 D-8f3k2q`（有缓存结论时）或 ` · 本地调度诊断：码 D-8f3k2q，结论已写入诊断日志`（首次触发时）。
2. 诊断异常/超时 → 尾部文案仍是「码 + 结论已写入日志」（fail 结论仅在日志中，**不**在弹窗渲染「异常」以免恐慌与掩盖主报错的注意焦点）。弹窗主文案、按钮、时长全部不变。
3. 客服流程：用户报码 → 客服 grep 日志 `publish.diagnose_result` → 看 assertions 定位「调度器问题 vs 上游真实限流」。

## 6. 测试契约（TDD 先行）
- 新增 `electron/services/pubfail-diagnose.test.js`：分类正反例（RATE_LIMITED/QUOTA_EXCEEDED/排队超时/普通错误不误判）；同步挂载不改 code/message；防抖（10min 缓存复用不重跑）；并发去重；超时静默降级（fake timers）；探针参数硬编码断言。
- 扩展 `src/utils/user-facing-error.test.js`：有 tag → 拼接；无 tag → 逐字节不变（防回归）。
- 扩展 `src/views/selfcheck-migrate.test.js` 或新增契约：主链路文件（publish/batch/rpa 执行器）不出现对 self-check 的 await 调用（防「阻断主报错」的反模式回归）。
- locale 成对：Gate 7 + `check-locale-sync.js --keys`。

## 7. 风险与对策
- R-A 误分类（把非限流错误附带诊断码）→ 判定收紧为 errorCode∈{RATE_LIMITED,QUOTA_EXCEEDED} 优先，文本模式仅兜底；单测锁正反例。
- R-B 首错拿不到同步结论 → 明示「结论已写入诊断日志」，不假装实时；缓存命中场景（重复失败，恰是最常见场景）有完整结论。
- R-C formatUserError 变成有副作用 → 禁止：它只读 diagnoseTag 拼接，触发全在主进程。
- R-D 新文件/改动越阈值 → 行数预算与 debt 门禁前置自查。
- R-E 发布 RPA 错误不经过 IPC 返回值（走事件推送）→ 实施时核实批量结果事件 payload 同样过 `attachDiagnoseTag`；若个别通道未覆盖，日志面兜底记录，弹窗面不承诺 100% 覆盖（PRD 允许仅日志降级）。

## 8. 评审请求（希望被攻击的点）
1. 挂载点选在 IPC 统一包装层是否可行（有无既有结果形状冲突/性能）？
2. 弹窗默认展示「结论缓存」而首错仅给码：接受度如何，是否应默认仅日志？
3. 触发节流/TTL 数值是否合理？
4. story2video 通知面本期不接入是否构成 PRD 缺口？
