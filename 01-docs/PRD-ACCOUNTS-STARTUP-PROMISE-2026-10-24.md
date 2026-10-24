# PRD：账号页首屏启动链的失败可见性（ux-audit-accounts-load-failure，UX 审计 1.2 家族 / 任务 #7 第二片）

日期：2026-10-24
分支：`ux-audit-accounts-load-failure` ｜ 判定：`docs-only=false`（含运行时代码），独立 worktree + PR

## 1. 问题：同一条启动链上的三种形态并存

`apps/desktop/src/views/Accounts.vue` 的 `onMounted` 是账号页所有数据的唯一启动入口。
改动前它长这样（逐行取自 `origin/main`）：

```js
onMounted(() => {
  accountStore.loadGroups()                       // ① 返回值直接丢弃
  startAccountEvents()                            // ② 同步函数，无风险
  refresh()                                       // ③ 返回值直接丢弃，而 refresh 内部是 try/finally 不是 try/catch
  // 运营开关只影响入口显隐，读不到即关闭（ADR-0006），因此不阻塞首帧、失败也不提示
  refreshCloudSyncFlag()                          // ④ 内部有 catch ⇒ 不逃逸
  // 统一类别：全应用单例，这里只需触发一次加载 + 订阅运营变更
  loadContentCategories().catch(() => {})         // ⑤ 接住了，但处理器是空的
  categoriesUnsubscribe = watchContentCategories()
})
```

三种形态并存，每一种的坏法不同：

| 形态 | 位置 | 坏法 | 是否已实测 |
| --- | --- | --- | --- |
| **浮空 promise** | ①③ | 被调函数 reject 且无人接 ⇒ 进程级 `unhandledRejection` | ✅ **实测抓到**：夹具里让 `accountStore.load()` 拒绝，`Error: accounts list exploded` 直接浮到进程级（`Accounts.test.js` 的逃逸断言 `actual: ['Error: accounts list exploded']`） |
| **空处理器** | ⑤ | 不炸了，但**零痕迹**：既没有日志也没有界面提示，故障在运行日志里不存在 | 按 AGENTS「静默配置失败必须留日志」判为缺陷（该条的动因正是"回归在日志里零痕迹"） |
| **有 catch 无 finally / 反之** | ③ | `refresh()` 只有 `try/finally`，`finally` 复位 loading 但**不接错误** ⇒ 错误继续向外成为拒绝 | ✅ 读码 + 上一条实测双向确认 |

`②④` 两个入口当场无害（`startAccountEvents` 是同步函数；`refreshCloudSyncFlag` 内部有 catch），
但"无害"是对**当下实现**的判断，不是结构保证 —— 同一条链上两种口径并存本身就是下一次事故的入口
（本仓把它记作「口径分裂」）。

## 2. 修法：一个原语，一次挡住两个方向

新增 `apps/desktop/src/utils/startup-promise.js`，导出 `terminateStartupPromise(label, task, warn?)`：

- **就地接住**：`Promise.resolve(maybe).then(undefined, report)` ⇒ 绝不把 rejection 留给进程；
- **必须出声**：`report` 打出 `[startup] <label> failed: <原因>`，原因按 `Error.message` /
  字符串 / `undefined` / `null` / 不可字符串化 五档归一，**任何一档都留痕**；
- **默认 `warn` 必须是真 `console.warn`**，不得是 noop：
  生产接线（`Accounts.vue`）不传 `warn`，默认值是 noop 就等于"出声"这条契约在生产里是空的
  （与 `useFirstRunGate` 的 QM-6 i6 同一格，那里已实测红过一次）；
- **入参接受 thunk**（`() => foo()`）：`foo()` 的**同步抛错**发生在实参求值阶段，
  原语看不到；写成 thunk 才能把这一路也纳入收口，且 `onMounted` 里一个入口抛错不再带走整条链。

调用点改写后：

```js
terminateStartupPromise('account-groups', () => accountStore.loadGroups())
terminateStartupPromise('account-events', () => startAccountEvents())
terminateStartupPromise('accounts-list', () => refresh())
terminateStartupPromise('cloud-sync-flag', () => refreshCloudSyncFlag())
terminateStartupPromise('content-categories', () => loadContentCategories())
```

三条不可破的口径：
1. **旁路，不 await**：收口不得把首屏重新阻塞在 IPC 之后（QM-2「首屏渲染不得阻塞在 IPC 返回之后」）；
2. **不改变业务结果**：原语只负责"接住 + 出声"，不重试、不改状态、不弹提示 ——
   界面错误态仍由各自的真源（`store.error` / `groupsStatus`）决定，不在这里造第二份事实；
3. **标签必须可归因**：每个入口一个稳定标签，日志要能指认是哪一步（`account-groups` ≠ `accounts-list`）。

## 3. 显示项与提示文字（用户可见面）

| 面 | 改动前 | 改动后 |
| --- | --- | --- |
| 界面文案 | 无新增/无变化 | **无变化**：本批不引入新的用户可见文案，因此**不新增 locale 键**（AGENTS 禁止死键） |
| 运行日志 | ①③ 无痕迹；⑤ 无痕迹 | `[startup] <label> failed: <原因>`，label 闭合为上面 5 个 |
| 账号列表 | `load()` 拒绝时界面按 store 的瞬时判定保留上一次列表 | 同上（未改 store 侧判定），差别只在日志里现在看得见 |
| 分组区 | `groupsStatus` 已有 `unreadable` 态，但拒绝路径走不到它 | 同上；拒绝不再静默消失 |

**为什么只做日志不做 toast**：这三处失败都是「这一帧取不到」，界面已有各自的降级态
（保留旧列表 / `groupsStatus=unreadable` / 开关按关闭）。凭空加一条 toast 会把"降级已生效"
说成"用户需要行动"，而用户没有任何可点的重试入口 —— 属于制造噪声，不是修复。
需要用户行动的错误应由各自的判据层提出，不经这条旁路。

## 4. 验收标准（判据与载体）

| # | 判据 | 载体 |
| --- | --- | --- |
| V1 | thunk 与 promise 两形态、拒绝原因五档，逐档必须出声且只出声一次 | `src/utils/startup-promise.test.js` |
| V2 | 成功路径**不得**打日志（不许为了"看起来有日志"恒打一行） | 同上 |
| V3 | 不传 `warn` 时默认必须是真 `console.warn` | 同上（反证 B1） |
| V4 | 六种入参形态一律不得把 rejection 留给进程（用 `process.on('unhandledRejection')` 作现场证人） | 同上（反证 B3） |
| V5 | 账号页：分组/列表两条入口拒绝 ⇒ 零逃逸 **且** 日志带原因 | `Accounts.test.js` 新增 describe（红证见 §5） |
| V6 | 启动块结构：不得再出现空处理器，且 5 个入口逐个经原语、标签齐全 | 同上的结构锁（反证 A2/A3） |
| V7 | 既有 119 条账号页用例零回归 | 同一文件全量跑 |
| V8 | CJK / locale 成对：本批 `src/` 非 locales 无新增中文字面量、无新增 locale 键 | Gate 7 / CJK 基线扫描（交 CI） |

## 5. 红证（先测试后实现，逐条现场读数）

实现前跑新加的三条用例：

```
FAIL 分组真源拒绝 ⇒ …    AssertionError: 失败必须留下带标签的日志: expected '[electron-bridge] IPC fallback: opsCe…' to contain 'groups bridge exploded'
FAIL 列表刷新拒绝 …      AssertionError: 逃逸到进程级的 rejection: Error: accounts list exploded: expected [ 'Error: accounts list exploded' ] to deeply equal []
FAIL 结构锁 …            AssertionError: 启动块里不得再有空 catch: expected '…' not to match /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/
Tests 3 failed | 119 skipped (122)
```

第二条的 `actual: ['Error: accounts list exploded']` 就是**缺陷本体被现场抓到**：
不是推理，是进程级真的收到了一条未处理拒绝。

实现后：`Accounts.test.js` + `startup-promise.test.js` **128 passed / 0 failed**。

## 6. 反证（七道，取被禁形态本身）

驱动 `scripts/accounts-startup-chain-contract-mutate.js`（已入 `.gitignore` 的 negation 名单，可复跑）：

| 变异 | 形态 | 期望红 |
| --- | --- | --- |
| A1 | `accounts-list` 退回裸 `refresh()`（本批要消灭的原形态） | V5 第二条 |
| A2 | `content-categories` 退回 `.catch(() => {})` 空处理器 | V6 结构锁 |
| A3 | `account-groups` 退回裸调用 | V6 结构锁 |
| B1 | 原语默认 `warn` 退回 noop | V3 |
| B2 | thunk 不再被调用（`const maybe = task`） | V1 的 thunk 那一格 |
| B3 | 摘掉 handler（只求值不接住） | V4 |
| B4 | 日志丢掉原因（只剩标签） | V1/V5/V3 一起红 |

每道都跑同一套测试文件，跑完按 md5 逐文件还原并回读；`ANCHOR_0/ANCHOR_DUP`
（锚点没命中 ⇒ 那条变异一次都没生效）与 `RESTORE_FAIL` 各自单列，
不得与 `MISSED` 混读。读数见本 PR 的执行记录。

## 7. 明确不做 / 遗留

1. **不把同一原语铺到其余 140 个 `.vue`**：本次扫描（146 个视图/布局/组件 + App.vue，读取失败 0）
   得到 15 个候选调用点，其中 `MpSidebar.loadAppMenu`（自带 try/catch）、
   `useFeatureFlag.refresh`（自带 catch）、`startAccountEvents`（同步）等经逐个读码判为
   **当前不可达**。全仓铺开属阶段 5 的门禁活（未接线/死观测那一类），
   不在本批顺手改 —— 顺手改会让"哪些是真的"再次不可归因。
2. **不改成 `await` 或加超时**：收口只处理"失败要看得见"，不处理"失败要多久"。
   首屏阻塞预算属 QM-2 的另一条判据。
3. **`App.vue` 的同类入口留作下一片**：它现在只有一条链（首启判定）且已自带 catch；
   `App.vue` 距 500 行熔断只剩 4 行（任务 #29），必须先抽再改，不能往一个贴着上限的文件里加行。
4. **登记一条扫描口径**：候选清单由 `onMounted` 正则粗筛得出，**粗筛不是判据**，
   每一条都必须读码确认拒绝路径可达后才能算缺陷（本批 15 条里 3 条被读码否证）。
