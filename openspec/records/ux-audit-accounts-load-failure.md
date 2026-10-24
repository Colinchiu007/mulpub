# 执行记录：账号页首屏启动链的失败可见性（ux-audit-accounts-load-failure）

- 分支：`ux-audit-accounts-load-failure`
- 日期：2026-10-24
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=false**（含运行时代码），
  走完整质量节拍 + 独立 worktree（`<mp-worktrees 根>/mp-ux-audit-accounts-load-failure`，分支名与 PR 号才是取证锚点，
  不落本机绝对路径；`verify-worktree-deps.js` OK）+ PR。
- 归属：UX 审计 1.2 家族（Unhandled Rejection）第二片，任务 #7 的「外壳/视图级 onMounted 浮空 promise」半边。
- 规格与验收正文见 `01-docs/PRD-ACCOUNTS-STARTUP-PROMISE-2026-10-24.md`（本文件只记执行与读数）。

## 1. 门禁表

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | `scripts/start-mp-task.ps1` 建 worktree；基线 = `origin/main deac58977`（`git rev-list --count HEAD..origin/main` = 0） |
| TDD 红证 | ✅ | 实现前 `Accounts.test.js` 新加三条 = **3 failed**，其中一条是缺陷本体：`逃逸到进程级的 rejection: Error: accounts list exploded: expected ['Error: accounts list exploded'] to deeply equal []` |
| TDD 绿证 | ✅ | 实现后 `Accounts.test.js` + `startup-promise.test.js` **128 passed / 0 failed**（`it(` 计数：helper 6 + 本文件新增 3） |
| 反证电池 | ✅ | `node scripts/accounts-startup-chain-contract-mutate.js` → **CAUGHT=7 / MISSED=0**，逐条 `RESTORE_OK`，基线 `rc=0 passed=128 blind=false`（读数见 §3） |
| QM-2 首屏口径 | ✅ | 未新增 `await`；原语是旁路，`onMounted` 仍然不等任何 IPC |
| QM-4 视觉 | ⏳ 交 CI 判 | 无样式/模板改动（只改 `<script>` 内 onMounted 与新增 util），未新增像素用例 |
| eslint | ✅ | rc=0（读数见 §4） |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（见 §4） |
| CJK / locale | ✅ 按口径 | 无新增用户可见文案 ⇒ **不新增 locale 键**（AGENTS 禁死键）；新 util 的字符串字面量全 ASCII |
| 台账（CHANGELOG） | ✅ 按新规 | 条目写在本文件 §6，由 `scripts/aggregate-changelog.js` 在发版时搬运；本 PR 不编辑 `CHANGELOG.md` |
| QM-6 | 见 §5 | `sh scripts/deep-review.sh` 实跑读数据实回填 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（见 §7），不手写状态词 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅（本 PR 未提及任何参考产品名）| 文档同步 ✅（新增 PRD + 本记录同 PR）| 远程同步 PR #（创建后回填编号）
- **文档同步的如实口径**：审计文档 `01-docs/UX-AUDIT-2026-10-17.md` 里**没有**这一族的行
  （`grep -na "Unhandled\|浮空" 01-docs/UX-AUDIT-2026-10-17.md` 当场 0 命中）—— 该缺陷家族由任务 #7 承载，
  本记录与 PRD 是它当前的唯一书面来源。不去审计文档里补一条"当初就写过"的行，那是造历史。

## 2. 缺陷本体（为什么这不是"顺手加个 catch"）

`Accounts.vue` 的 `onMounted` 在同一条启动链上并存三种形态，坏法各不相同：

| 调用点 | 形态 | 后果 | 证据 |
| --- | --- | --- | --- |
| `accountStore.loadGroups()` | 返回值直接丢弃 | store 侧 `loadGroups` 无 try/catch ⇒ 任何 reject 浮到进程级 | 读码 + 结构锁 |
| `refresh()` | 返回值丢弃，且 `refresh` 内是 **try/finally 无 catch** | 同上 | **实测抓到**：`Error: accounts list exploded` 真到达 `process.on('unhandledRejection')` |
| `loadContentCategories().catch(() => {})` | 接住了，但处理器是空的 | 不炸了，也**零痕迹** —— 违反 AGENTS「静默配置失败必须留日志」 | 读码 + 结构锁（A2 变异） |
| `startAccountEvents()` | 同步函数 | 当场无害 | 读码：`function start ()` 非 async |
| `refreshCloudSyncFlag()` | 内部有 catch | 当场无害 | 读码：`useFeatureFlag.refresh` 的 `try/catch/finally` |

**"当场无害"的两条也一并收口**：同一条链上两种口径并存就是下一次事故的入口，
而它们的"无害"只由**当下实现**担保（`startAccountEvents` 哪天变 async、
`refresh` 的 catch 被人摘掉，症状与上面三条一字不差）。

**扫描与逐个读码的口径**：候选由正则在 `apps/desktop/src/{views,layouts,components}` + `App.vue`
粗筛得出，**146 个文件 / 读取失败 0 / 候选 15**；其中 `MpSidebar.loadAppMenu`（自带 try/catch）、
`useFeatureFlag.refresh`（自带 catch）、`startAccountEvents`（同步）经读码判为当前不可达。
⇒ **粗筛不是判据**，"扫到 15 条"不得被读成"有 15 个缺陷"（也不得反过来把已确证的两条降格）。

## 3. 反证读数（七道，全部取被禁形态本身）

驱动：`scripts/accounts-startup-chain-contract-mutate.js`（已按仓内惯例加 `.gitignore` negation，可复跑）。
日志：`/d/tmp/mw-acct-battery2.log`。

```
[BASELINE] rc=0 failed=0 passed=128 reds=0 blind=false
[A1] CAUGHT 启动链退回裸调用（accounts-list 不再经原语）              — rc=1 红=2
[A2] CAUGHT 统一类别退回"接了但零痕迹"的空处理器                     — rc=1 红=1
[A3] CAUGHT 分组入口退回裸调用（结构锁的逐个经原语 + 标签齐全）        — rc=1 红=2
[B1] CAUGHT 原语默认 warn 退回 noop（生产接线不传 warn ⇒ 失败零痕迹）  — rc=1 红=3
[B2] CAUGHT thunk 形态不再被调用（同步抛错那一格失去读者）             — rc=1 红=16
[B3] CAUGHT 摘掉 handler（只求值不接住）⇒ rejection 重新逃逸          — rc=1 红=6  PROBLEM: 套件报错
[B4] CAUGHT 日志丢掉原因（只剩标签）⇒ "可归因"退化                    — rc=1 红=6
[SUMMARY] 共 7 条：CAUGHT=7 MISSED=0
```

三条要如实记的读数：

1. **B4 第一版是 MISSED，不是 CAUGHT**。原因不是"锁失效"，是我给它分配的期望清单里那条
   `原因不是 Error 时也要出声` **本身是条弱断言** —— 它只断"warn 被调用一次"，
   对"日志里丢掉原因"完全免疫（同族口径见记忆「反证没红『我分配给它的那条锁』⇒ 该锁保护面比说明窄」）。
   处置按同一条口径执行：**没有删锁、也没有改期望凑红**，而是把断言补成
   「原因必须进日志」（逐档给期望串：`plain string reason` / `undefined` / `null` / `[object Object]`），
   再重跑 ⇒ B4 CAUGHT（红 6 条）。第一轮读数（MISSED=1）保留在这里不删。
2. **B3 的 `PROBLEM: 套件报错` 是预期后果**：那一刀让 rejection 重新逃逸，vitest 会把它记成套件级错误。
   基线档里同样的读数会 fail-closed 拦住整轮（`blind=true` 不下场跑变异），
   变异档里它恰恰是"逃逸真的发生了"的旁证 —— 两处读数是同一判据的两个方向，不是矛盾。
3. 驱动自身第一版有个**读数缺陷**：`collected` 用了裸 `(\d+) passed`，先撞上
   `Test Files 2 passed`，于是基线打印成 `passed=2`（实际 128）。已改为按 `Tests … passed` 取，
   并在代码注释里写下为什么不能图省事。这是"探针报的数不是被测变量的数"的同型，
   与 [[feedback-mismeasured-falsification]] 一条族。

## 4. 其余现场读数

- eslint：`cd apps/desktop && pnpm exec eslint src/utils/startup-promise.js src/utils/startup-promise.test.js src/views/Accounts.vue src/views/Accounts.test.js` → **rc=0**（四个文件一起跑，无 error 无新增 warning）。
- 行尾：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐文件一致。
- 债务熔断：`node scripts/check-debt-budget.js` → `maxFileLines 5563 (基线 5638) ✅ / filesOver1000 ✅ / filesOver500 94 (基线 95) ✅ / circularDeps 0 ✅`，
  `node .github/scripts/check-max-lines.js` → `超限文件=94 挂账=94 ✅ 无新增超大文件`；
  `testLimit=1500 测试超限=13 测试挂账=12` 是**改动前后同数**（`Accounts.test.js` 早已在挂账档内，本 PR 只在其挂账增长额度内加行）。
- 品牌残留：`node scripts/check-no-brand-residue.js` → PASS（扫描 12644 个 tracked 文件）。

## 5. QM-6

- 判定：`node scripts/ccg-review-decider.js --base origin/main`（提交后据实回填 mode 与读数）。
- 外部评审：`sh scripts/deep-review.sh`（需 `CCG_ARL_DIR` 指向引擎目录，本仓实测口径见记忆
  「QM-6 deep-review 链路的真 blocker 是一行硬编码路径」）。**发现与逐条处置在本节回填**，
  不得把"跑了"写成"闭合了"；CI 侧 `QG Changes` 以 `--mode=advisory` 运行 ⇒ CI 绿 ≠ QM-6 闭合。

## 6. CHANGELOG 条目

# fix(采集/账号): 账号页首屏启动链的失败必须可见 —— 浮空 promise 与空处理器一并收口（ux-audit-accounts-load-failure）

- **问题**：`Accounts.vue` 的 `onMounted` 是同一条启动链，却并存三种形态：
  ① `accountStore.loadGroups()` 与 ② `refresh()` 的返回值被直接丢弃（后者的 `refresh` 内部是
  `try/finally` **没有 catch**），任何拒绝都浮到进程级成 `unhandledRejection`
  （实测抓到 `Error: accounts list exploded` 真的到达 `process.on('unhandledRejection')`）；
  ③ 紧邻的 `loadContentCategories().catch(() => {})` 接住了，但处理器是空的 ——
  不炸了，也**零痕迹**，违反 AGENTS「静默配置失败必须留日志」。同一条链上两种口径并存，
  就是"下一次改动把某一条改成 async 时没有任何东西会出声"。
- **修法**：新增单一实现 `src/utils/startup-promise.js` 的 `terminateStartupPromise(label, task, warn?)`，
  一次挡住两个方向：就地接住 rejection（绝不留给进程）**且**必须出声
  （`[startup] <label> failed: <原因>`，原因按 Error/字符串/undefined/null/不可字符串化五档归一）。
  三条不可破：旁路不 `await`（否则首屏重新阻塞在 IPC 之后，违反 QM-2）；
  不改变业务结果（界面错误态仍由各自真源 `store.error` / `groupsStatus` 决定，不造第二份事实）；
  **默认 `warn` 必须是真 `console.warn`** —— 生产接线不传 warn，默认 noop 会让"出声"这条契约
  在生产里恒空（与 `useFirstRunGate` 的 QM-6 i6 同一格）。入参同时接受 thunk，
  把 `foo()` 的**同步抛错**也纳入收口，并保证一个入口坏不带走整条链。
- **不做什么**：不加 toast。这三处失败都是「这一帧取不到」，界面已有各自的降级态
  （保留旧列表 / `groupsStatus=unreadable` / 开关按关闭），凭空加提示会把"降级已生效"
  说成"用户需要行动"，而没有任何可点的重试入口。因此**不新增 locale 键**。
- **测试**：新增 `src/utils/startup-promise.test.js`（6 条，含以 `process.on('unhandledRejection')`
  作现场证人的"六种入参一律不得逃逸"）；`Accounts.test.js` 增 3 条（分组拒绝 / 列表拒绝 /
  结构锁：启动块不得有空处理器且 5 个入口逐个经原语、标签齐全）。
  红证：实现前 3 failed，其中一条直接抓到逃逸本身。反证 7 道全 CAUGHT（第一轮 B4 MISSED，
  原因是那条断言弱，已按"补强断言而非改期望"处置），逐条 md5 还原核对。

## 7. 收尾清单（合并后回读，不凭记忆）

- PR：待创建后回填编号。
- `远程同步` 状态由门禁按主干历史推导（`MERGE-LEDGER`），本文件不手写状态词，也不需要回填 PR。
- main push 回读：`gh run list --workflow=quality-gate.yml --commit <merge SHA>` 必须有一条且 `conclusion=success`。
