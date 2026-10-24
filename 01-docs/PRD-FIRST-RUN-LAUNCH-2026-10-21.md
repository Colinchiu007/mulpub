# PRD：首启向导接回启动判定（UX 审计阶段 1 · 单元 1.4）

- 日期：2026-10-21
- 分支：`ux-audit-first-run-launch` ｜ 关联规格：`openspec/changes/ux-audit-first-run-launch/`
- 关联审计条目：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1 表 1.4 行
- 性质：中大型（渲染端 + 主进程 + preload + IPC），触发 QM-1 打包验证

## 1. 问题

向导页面、路由、IPC 通道、preload 方法**全都在**，但用户永远看不到它：

```
electron/window.js:228            firstRun.runSetup(mainWindow)      // 窗口一创建就调用
electron/services/first-run.js    runSetup(): 若无标记 → 立即 writeFileSync('first-run-done') 并广播 done
```

`first-run.js` 里那行注释是历史的原话：「P2-E: 无需检查浏览器资源，直接标记首次运行完成」。
它当时是为了移除 Playwright 检查，结果把"引导"整条链短路成**应用替每个新用户写下已完成**。
于是：全新 userData 首启也不会进向导；`FirstRun.vue` 的 19 条测试测的是一个用户到不了的地方。

## 2. 目标 / 非目标

**目标**：全新 `userData` 首启即进向导；完成标记只能由用户的显式出口写入；向导不再显示从未跑过的检测结论。
**非目标**：新增任何"环境检测"能力（本仓现在确实不检测）；退役 `onboarding:*` 死通道（§7.1）。

## 3. 判定链（为什么走"拉"不走"推"）

`runSetup` 的推送发生在窗口创建时，**早于任何渲染端订阅**，事件必然丢失且无重试。
所以"进不进向导"由渲染端主动问一次决定：

```
App.vue onMounted → maybeEnterFirstRun({ router })
  └─ firstRunCheck()  →  IPC first-run:check  →  checkDeps() → { setupDone }
```

三档语义（缺一不可，`useFirstRunGate.test.js` 逐个钉）：

| 读到的值 | 判定 | 理由 |
| --- | --- | --- |
| `code === 0` 且 `data.setupDone === false` | 导航 `/first-run` | 唯一该导航的情况 |
| `code === 0` 且 `setupDone === true` | 不动 | 老用户不得被拦 |
| 其它（`code !== 0`、`data` 缺失、`setupDone` 非布尔、抛错） | **不动，且不置闩** | 「没读到」不是「还没做过」。兜底值若伪装成成功，浏览器 dev server 里每次访问都会跳向导 |

另两条：判定一次会话只决定一次（模块级闩，App 重挂载不重复 push）；已在 `/first-run` 不重复 push
（vue-router 同路由 push 会抛 `NavigationDuplicated`）。

**这条链跑在 `onMounted` 里、没人 await ⇒ 调用点自己收口**（单元 1.2 刚因同一格踩过 5 条
Unhandled Rejection，测试还全绿）。

## 4. 标记的写者（数据校验与不变量）

```
唯一写者：electron/services/first-run.js 的 markDone()
唯一触发：IPC first-run:complete  ← FirstRun.vue 的两个出口按钮（管理账号 / 开始发布）
```

- `markDone()` **幂等**：已有标记时原样返回 `{ ok: true, reused: true }`，不重写时间戳
  （重写会让"完成时间"变成"最后一次点按钮的时间"，而它是排障时唯一的时间锚）。
- 写盘失败返回 `{ ok: false, message }` 并 `log.error`；IPC 层映射成非零 `code`。
- `runSetup()` 不再写盘，只广播 `needed` / `done`。`reset()` 保留（排障出口）。
- 不变量：**用户没点出口 ⇒ 标记不存在 ⇒ 下次仍进向导**。中途关窗不算完成。

### 4.1 出口失败不挡人（交互口径）

标记写失败（或桥不可用）时**仍然导航离开**，同时：
1. toast 提示「首启状态未能保存，下次启动可能仍会进入向导」；
2. `console.warn` 带原因。

把人困在向导里比"下次还要再走一遍"更糟；但静默失败会让人反复重启排障，所以必须出声。
按钮在 `finishing` 期间置 `disabled`（重复点击只落一次标记）。

### 4.2 标记落盘必须是原子替换（QM-6 i10，2026-10-22 补）

`markDone()` 原形态是 `fs.writeFileSync(最终名, …)`。**为什么这是缺陷而不是风格问题**：
判定侧 `isSetupDone()` 只看 `fs.existsSync`，所以一份因进程被杀/断电/杀软占用而**半写或 0 字节**的
最终名文件，会被读成"已完成" ⇒ 向导对该用户**永久消失**，且日志里零痕迹。
这与本批要修的第一颗雷（主进程替用户写"已完成"）**症状完全同形**，只是成因不同 ——
只修自动落标记而不修落盘方式，等于留了第二条制造同一症状的路。

实现口径（`electron/services/first-run.js`）：

1. 先写临时名 `first-run-done.tmp-<pid>`，再 `fs.renameSync(tmp, 最终名)`；
   最终名要么不存在，要么是全量内容（POSIX 原子；Windows 在目标不存在时同样原子）。
2. 写或 rename 失败时**先清临时名**，再看最终名：
   - 最终名在场 ⇒ 并发写者已落成 ⇒ 如实返回 `{ ok: true, reused: true }`（不冒报本次写入）；
   - 最终名不在场 ⇒ 原样进既有失败处理（`{ ok: false, message }` + `log.error`）。
3. **不做退避重试**。AGENTS 的"Windows 原子文件替换重试"授权的是*覆盖型*替换遇
   `EPERM/EACCES/EBUSY` 的有界退避；本路径是 write-once（入口已 `existsSync` 短路），
   没有覆盖语义，重试不改变结果，只会把主进程 IPC 钉住更久。

数据校验与不变量（三条，均有行为锁）：
- 写入落点**不得**是最终名（判别式断言：记录 `writeFileSync` 的首个实参，命中 `/first-run-done$/` 即红）；
- 调用结束后目录内**不得**残留 `first-run-done.tmp-*`；
- 最终名内容必须匹配 `^done:<ISO>`（不是空串、不是半截）。

判别式为何不能只是"内容完整"：直接写最终名的旧实现**同样**产出完整内容，
只有"落点是临时名"与"rename 失败分支"这两条能把旧形态判红 —— 反证 F15 实测正是这两条变红。

### 4.3 导航失败的两种后果必须分开（QM-6 i2 / i3，2026-10-22 补）

| 场景 | 修复前 | 修复后 | 用户侧 |
| --- | --- | --- | --- |
| 启动判定里 `router.push('/first-run')` 被守卫拒绝 | 一次性闩已在 push **之前**置位 ⇒ 本会话不再判第二次，只留一条日志 | catch 内 `decided = false` + `warn(...latch released...)` + 返回 `{ action:'skipped', reason:'push-failed' }` | 下次挂载仍会重试；全新用户不会因为一次抖动永久看不到向导 |
| 向导出口点「完成/跳过」后 `router.push(主界面)` 被拒 | 该语句在 try/finally **之外**，与本函数注释第 3 条自相矛盾 ⇒ 逃逸成 Unhandled Rejection | 收口进 try/catch，`console.warn('[first-run] navigation after wizard exit failed: ...')` | 标记已落、用户停在原地但至少有一条可归因日志，控制台不再出现未处理 rejection |
| `firstRunCheck()` 抛错且调用方未传 `warn` | gate 默认 `warn = () => {}`（noop）⇒ 生产零输出 | 默认改 `warn = (msg) => console.warn(msg)` | 读标记失败在现场日志里可见，不是"看起来像没做过" |

`warn` 的默认值属**生产接线取值**（`App.vue` 恰好不传），所以修默认值而不是补一处传参 ——
后者会把同一个洞留给下一个调用点。

## 5. 显示项（逐项，含撤掉的东西）

| 位置 | 改动 | 原因 |
| --- | --- | --- |
| 欢迎页第①行 | 「环境检测 / 自动安装 Python 依赖和 Playwright」→「运行环境 / 应用自带运行时，无需安装依赖」（locale） | 主进程已不做任何安装或检测，这行是在承诺一个不存在的能力 |
| 步骤① 标题与说明 | 「环境检测 / 自动安装依赖，可能需要几分钟」→「运行环境 + 如实说明」（locale） | 同上 |
| 步骤① 的两行依赖状态（⬜/⏳/✅/❌） | **整块撤下**，连同 `.fr-dep-*` 十条 CSS 规则 | 状态唯一来源是"收到主进程推送 done 就把两行都点亮 ✅"，那是假证据 |
| 步骤① 「下一步」按钮 | **无条件可见** | 旧版下一步被 `allDepsDone` 门控——而 `allDepsDone` 只能由推送点亮。改完主进程后若不撤这道门，新用户会**卡在步骤①**（本批实测发现并修掉的死锁） |
| 错误分支的「重试」按钮（`retryDeps`） | **撤下**（含注释「Re-trigger setup」） | 它只调只读的 `firstRunCheck()`，从未重跑任何东西；注释承诺与实现不符 |
| 步骤③两个出口 | 加 `data-testid`、`:disabled="finishing"`，改调 `finishAndGo(path)` | 出口是标记的唯一触发点 |

文案全部走 `onboarding` 命名空间（zh/en 成对新增 4 个键），实测 `check-locale-sync --cjk`
由「新增 10 处硬编码」FAIL 转为 PASS（当前 1112 条 < 基线 1330）。日志串一律英文。

## 6. 验收标准

| # | 判据 | 载体 |
| --- | --- | --- |
| V1 | 无标记时 `runSetup` 不写文件，广播 `needed` | `electron/services/first-run.test.js` |
| V2 | `markDone` 唯一写者、幂等、失败返回 `{ok:false}` 且出声 | 同上 |
| V3 | `first-run:complete` 三处配对（handler / PUBLIC_CHANNELS / preload + access-control） | 同上（三条结构锁，任一缺失即红） |
| V4 | 判定四档语义 + 只决定一次 + 同路由不重复 push | `src/composables/useFirstRunGate.test.js` |
| V5 | 向导内不存在"从未跑过的检测结论"；步骤①恒可前进 | `src/views/FirstRun.test.js` |
| V6 | 出口先落标记再导航；失败仍导航且出声；抛错不产生未处理 rejection；重复点击只落一次 | 同上 |
| V7 | `App.vue` 真的调用判定（接线锁） | `useFirstRunGate.test.js`；**QM-6 i7 后判据收紧**：必须是 import 行以外的 `maybeEnterFirstRun({ router })` 调用形态 + `onMounted` 在场 |
| V8 | 打包态：`build:dir` 成功 + 8s 存活 + 三层 stderr 判据；全新 profile 进向导 / 已有标记不进 | QM-1 现场（记录 §门禁表） |
| V9 | 标记落盘只写临时名、rename 替换、失败清 tmp；并发落成如实 `reused` | `electron/services/first-run.test.js` 三条（i10） |
| V10 | push 被拒 ⇒ 放开闩 + `reason:'push-failed'`；出口导航被拒 ⇒ 收口出声不成未处理 rejection | `useFirstRunGate.test.js` / `src/views/FirstRun.test.js`（i2 / i3） |
| V11 | API 面三档兜底：无桥 `code:-1`、`firstRunComplete` 无桥不谎报、有桥原样透传 | `src/api/publisher.test.js` 三条（i5） |

## 7. 残留与后续

1. **`services/onboarding.js` 的三条 IPC 通道全仓零调用方**（实测：electron 侧除自身与测试外无命中，
   渲染端零调用），是"注册但无人用"的死通道。退役它要同时动 `PUBLIC_CHANNELS`、
   `preload/system.js`、`preload/access-control.js` 与 `preload.test.js` 的导出计数锁 ⇒ 另批。
   本批**没有**顺手删，也没有把它当"已解决"写进结论。
2. **`firstRunCheck()` 的 `invokeWithFallback` 兜底原为 `code:0 + setupDone:false`**，
   把"桥不可用"伪装成一次成功的"还没做过"。本批把它改成与同文件其余通道一致的 `code:-1`；
   凡是以前依赖这个假 `code:0` 的调用点都会受影响（`FirstRun.vue` 是唯一消费者，已随本批改掉）。
3. 向导仍是"看板式引导"，不做真实环境准备；若将来要恢复检测能力，必须同时恢复步骤状态机与
   失败可重试路径，而不是把 ✅ 加回去。
4. 反证驱动与 CI 接线（任务 #23 同批欠账）。
5. **`first-run:status` 在本批之后变成零消费者通道**（QM-6 i4）：`runSetup` 仍每次建窗广播
   `needed` / `done`，`preload` / `publisher` / `access-control` 仍导出 `onFirstRunStatus`，
   但唯一订阅方（`FirstRun.vue`）已随本批撤下 ⇒ 与残留 1 同形。design.md / proposal.md 原先写
   「该通道保留（它已经在做这件事）」已被改为如实描述；退役它属另批，登记见 tasks.md 6.4。
6. **QM-6 首轮未取得合法闭环，且缺口在机制不在执行**（详见记录 §4.2）：六条 Warning 里 1 条判不成立、
   5 条成立并已在本 PR 修好 + 配反证，但 `ccg-deep-review.js` 的自扮演出口把 `verdict=upheld` 一律计入
   blocking ⇒ 落 `self_play_blocked`；而 `check-pr-exec-record.js` 的合规出口 `closureNote` 语义是**假阳性**，
   `CLOSED_DEEP_REVIEW_STATUSES` 没有"成立且已整改"这一档。因此本 PR 按 AGENTS 判据第 1/4 条**不自动合并**，
   等人工或机制裁决（任务 #19）。既不伪造 `self_play_resolved`，也不删产物、不手写 status。
