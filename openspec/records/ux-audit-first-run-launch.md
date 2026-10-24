---
change: ux-audit-first-run-launch
branch: ux-audit-first-run-launch
date: 2026-10-21
task: UX 审计阶段 1.4 —— 首启向导接回启动判定（主进程不再替用户写"已完成"；判定走拉取；向导不再显示从未跑过的检测结论）
sync_status: PENDING
---

# 执行记录：首启向导接回启动判定（ux-audit-first-run-launch，2026-10-21）

## 门禁表

| 项 | 状态 | 读数与判据 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | 运行时代码变更（`electron/` + `src/`）⇒ 隔离 worktree `mp-ux-audit-first-run-launch`，裸分支 `ux-audit-first-run-launch`，非 C 盘 |
| TDD | ✅ | 先写 `electron/services/first-run.test.js`（10 条）+ `src/composables/useFirstRunGate.test.js`（9 条）→ 首跑 **7 条红 + 结构锁 3 条红**；实现后定向四文件 **280 passed / 0 failed** |
| 自测（全域） | ✅ 两跑，且第一跑的读数**不干净** | 第一跑 `vitest run src electron`：`Test Files 1 failed / 1036 passed / 1 skipped`，`Tests 1 failed / 18440 passed / 5 skipped`，**外加 `Errors 4 errors`**。两条各自归因：① 那条红是 `electron/services/feedback.test.js` 的 `fs.symlinkSync` 报 `EPERM`——在**未改动的共享主工作区（main）**上单跑同一文件复现同样错误，属本机既有环境项（无符号链接权限），不认领、也不顺手改；② `Errors 4` 是**我自己引入的**：`FirstRun.vue` 出口 `router.push(path)` 在测试里 `useRouter()` 返回 undefined（该文件的 mount 只装了 pinia + i18n，没 stub vue-router），async 事件处理器抛错逃逸成 Unhandled Rejection。⛔ 而我前一天报「定向四文件 280 passed / 0 failed」时**没有看 `Errors` 行也没有核 rc** —— 同一个教训隔天在自己新代码上重犯。修法：测试里 stub `vue-router`（`vi.hoisted` 出一个 `navOrder`，push 记 `push:<path>`、firstRunComplete 记 `complete`），并把「先落标记后导航」的顺序契约真断出来（原来四条出口用例一条都没断言导航，其中一条名字却写着「不得变成未处理 rejection」）。第二跑同一命令：`18440 passed`、**无 `Errors` 行**。另记一条范围口径：`vitest.config.js` 的 include 白名单含 `tests/**.test.js`，而 `vitest run src electron` 按参数只跑 src+electron ⇒ 本批"全域"读数**不含 `tests/**`**，回填时不得把它写成全域全量。 |
| 反证（9 道 → **15 道**） | ✅ 两轮均实测 | 首轮 `node scripts/first-run-launch-contract-mutate.js --keep-going` ⇒ `[BASELINE] rc=0 failed=0 passed=42 collected=42 errors=0 blind=false`，`[SUMMARY] 共 9 条：CAUGHT=9 其余=0`，驱动 rc=0，九条各打 `RESTORE_OK`（还原后独立 md5 回读）。F1 出口不调 firstRunComplete / F2 退回「启动即替用户写已完成」/ F3 授权白名单漏登记 / F4 preload 未导出 / F5 把「没读到」当成「还没做过」/ F6 步骤①的下一步重新被假门槛锁死 / F7 App.vue 不再调用判定 / F8 两道闸一起摘 / F9 只摘按钮 `:disabled`。<br>**F8 首跑是 MISSED**：只摘 `finishAndGo` 里的闩时「重复点击只落一次标记」照绿——真正被那条用例测到的闸是按钮上的 `:disabled="finishing"`。结论不是"闩没用"，而是**闩自己没有任何锁守着**，于是同批补一条按源码形状验 `:disabled` 的锁，并把变异拆成 F8（两道一起摘 ⇒ 行为红）与 F9（只摘 disabled ⇒ 新形状锁红），两条各打各的格子。<br>**QM-6 首轮处置后扩到 15 道**（F10 push 失败不放开闩 / F11 gate 默认 warn 退回 noop / F12 出口 push 退回 try 之外 / F13 `firstRunCheck` 兜底退回 `code:0 + setupDone:false` / F14 `firstRunComplete` 无桥谎报成功 / F15 `markDone` 退回直接写最终名），末跑 `[BASELINE] rc=0 passed=290 collected=290` + `[SUMMARY] 共 15 条：CAUGHT=15 其余=0`、15/15 `RESTORE_OK`、驱动 rc=0。<br>两处必须留下的口径纠正：① **F10 首跑是 `ANCHOR_NOT_FOUND`** —— 我的 `from` 把第二行写成 6 空格缩因而锚不到（真实现是 4 空格），锚点必须照抄现场而非记忆；② **F13/F14 的锁定用例原本不在反证域内** —— `src/api/publisher.test.js` 没进 `TEST_FILES` 时，注入后域内零红会被读成"锁抓不到东西"，所以域随 i5 从 3 文件扩到 4 文件、`collected` 42→45→290 |
| QM-1 打包 | ✅ | 第一次 `pnpm run build:dir` **失败**（后台通知却报 exit code 0）：`error during build: FirstRun.vue?vue&type=style&index=0` —— 我在 `<style>` 块里写了 JS 风格的双斜线行注释，postcss `Parser.combinator` 拒收。**这条缺陷对全部测试隐形**：定向 280 passed、全域 18440 passed、变异 9/9 CAUGHT 都没碰 style 块，只有打包会。修成 CSS 块注释后重跑 `pnpm run build:dir` 产出 `dist-electron/win-unpacked/Multi-Publish.exe`（239,075,328 B）+ `resources/app.asar`（156,088,807 B）。asar 内容核对：`\electron\services\first-run.js` 在包内且 `markDone` 命中 3 次。真机三段（打包产物 + 隔离 profile + CDP，冷启动 A / 落标记 B / 同 profile 重启 C）与 9 秒存活 stderr 判据见 §八 |
| 静态门禁 | ✅ 部分 | `check-locale-sync --cjk`：接线时新增 10 处硬编码中文 ⇒ FAIL，把 5 处用户可见文案迁入 `onboarding` 域（zh/en 成对 4 键）、3 处日志串改英文后 → **PASS（基线 1330 → 当前 1112）**；`check-unwired-tests` / `check-no-brand-residue` / `check-doc-abs-paths` 读数待回填；聚合 eslint 改动文件 rc=0 |
| 行尾对账 | ✅ | 暂存后 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径**逐字一致：add 1324 / del 156**（不一致即说明行尾被改写）。新建文件一律 LF；改既有 CRLF 文档（CHANGELOG / 审计文档）由补丁脚本逐行保留原行尾 |
| QM-4 视觉 | N/A | `/first-run` 不在像素注册表内；外壳 `App.vue` 的改动只加判定调用，未加可见节点。若 CI 出现基线回归，按"同一次 CI 渲染"刷新 |
| QM-6 双模型 | ⚠️ 首轮完成并逐条处置，**闭环未取得（机制缺口）** | 判定 DUAL（962 行 > 200）；`proposer=opencode / critic=claude`，`backendAvailability 2/2`。10 条（6 Warning + 4 Info）逐条裁决见 §四。填完真实裁决后驱动落 `self_play_blocked`（5 条 upheld，退出码 1）⇒ `check-pr-exec-record --mode=enforce` 报欠账、本 PR 不自动合并。既有词表把「成立」与「成立且已在本 PR 修好」合并成同一档，而合规出口 `closureNote` 只覆盖假阳性 ⇒ 已修的事实没有合法记录方式。不伪造状态、不删产物、不手写 status；缺口登记任务 #19 |
| 远程同步 | 由门禁推导 | PR #pending —— 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词 |

## 一、用户可见变化

1. **全新安装首次启动会进入首启向导**（此前永远不会）。走完出口（管理账号 / 开始发布）后才不再出现。
2. 向导第一步不再显示「Python 依赖 ⬜ / Playwright 浏览器 ⬜」这种**从未跑过的检测状态**；
   改成如实说明「应用自带运行环境，首启不做安装，也不显示检测结论」，且「下一步」**恒可点**。
3. 欢迎页第①条从「环境检测 / 自动安装 Python 依赖和 Playwright」改为「运行环境 / 应用自带运行时，无需安装依赖」。
4. 「重试」按钮随其假承诺一起撤下（它只调只读检查，从未重跑任何东西）。
5. 标记写失败时仍放用户离开，但会提示「首启状态未能保存，下次启动可能仍会进入向导」。
6. 老用户（已有 `first-run-done`）行为不变：不进向导、标记不被重写。

## 二、本批最有价值的两条

1. **改完主进程会把新用户锁死在步骤①**。旧「下一步」由 `allDepsDone` 门控，而它唯一的点亮来源是
   主进程推送 `type:done`；把"启动即自动落标记"改成"等用户完成"之后，这条推送在首启时**永远不会来** ⇒
   步骤①没有出口。这是"移除一个错误行为"顺手制造的第二颗雷，只有把门道讲清并写一条
   「步骤①恒可前进」的用例才拦得住（已写）。
2. **测试曾经把假证据钉成契约**。被删的 5 条用例断言的是「收到 done 推送 ⇒ 两行依赖都 ✅」——
   那正是"用户看到的是从未跑过的检测结论"。按 AGENTS「测试断言不得反向固化错误行为」，
   处置是**改写成新契约的 10 条断言**（不显示未跑过的结论 / 不订阅推送 / 出口必须落标记 /
   失败仍放行且出声 / 抛错不成未处理 rejection / 导航被守卫拒绝不成未处理 rejection /
   落标记期间出口禁用 / 重复点击只落一次 等），而不是删掉换绿灯。

## 三、归属与判定链

- 判定走**拉取**（`App.vue onMounted → maybeEnterFirstRun → firstRunCheck`），因为主进程推送发生在
  窗口创建时、早于任何渲染端订阅，事件必然丢失。
- `firstRunCheck()` 的 `invokeWithFallback` 兜底原为 `code:0 + setupDone:false`，把"桥不可用"伪装成
  一次成功的"还没做过"；改成与同文件其余通道一致的 `code:-1`。判定据此**只在 code===0 且 setupDone 是布尔时生效**。
- 调用点自带 `.catch`：单元 1.2 刚因 `onMounted` 里的浮空 promise 引入 5 条 Unhandled Rejection（测试全绿，
  只有 `Errors` 行看得见），同一格不在这里重犯。

## 四、QM-6（首轮外部评审与逐条处置）

后端：`reviewBackends = { proposer: opencode, critic: claude }`（真源 `scripts/ccg-review-backends.list`），
跨家族校验通过、`backendAvailability 2/2`。产物 `.adversarial/ccg-deep-477408dc/`（critique 10 条 =
6 Warning + 4 Info；维度分 `correctness 6 / security 8 / performance 9 / maintainability 6`）。
引擎轮次耗尽后走第三档自扮演出口，逐条按**当前工作树实况**复核，不照抄指控。

| 条目 | 级别 | 裁决 | 现场依据与处置 |
| --- | --- | --- | --- |
| i1 脚本作用域 `$t` 未定义 ⇒ 失败分支抛 ReferenceError | Warning | **不成立** | `FirstRun.vue:116` import useI18n、`:121 const { t: $t } = useI18n()` 是局部绑定，:190/:194 解析到它；若真是未定义标识符，失败路径两条用例必红，而基线 `collected=287 / passed=287` 全绿。评审的前提「diff 中未见局部绑定」是漏读 121 行 |
| i2 push 前置闩 ⇒ 一次性导航失败永久跳过向导 | Warning | **成立，已修** | gate 的 catch 现置 `decided = false` 并返回 `reason: 'push-failed'`；反证 **F10** CAUGHT（红 1 / 探针 1/1 / RESTORE_OK） |
| i3 `router.push` 在 try/finally 之外，与自家注释第 3 条矛盾 | Warning | **成立，已修** | 收口进 try/catch 并 `console.warn('[first-run] navigation after wizard exit failed: …')`；反证 **F12**（把整段退回裸 `await router.push(path)`，即修复前的被禁形态）CAUGHT |
| i4 撤下订阅后文档仍写「保留 first-run:status 通道」，且制造新的零消费者通道 | Warning | **成立，已改文档 + 登记遗留** | design.md D1 / proposal.md 撤下假话；tasks.md 新增 6.4 与 6.1 的 onboarding:* 同批退役口径 |
| i5 API 面兜底改动无测试守护（断言被换成注释） | Warning | **成立，已补锁** | `publisher.test.js` 新增 3 条行为用例（无桥 `code:-1`、`firstRunComplete` 无桥不得谎报、有桥原样透传含 `reused`）；并把该文件纳入反证域（否则 F13/F14 注入后域内零红会被读成「锁抓不到东西」）；反证 **F13 / F14** 各 CAUGHT |
| i6 gate 默认 `warn` 是 noop，而 App.vue 恰好不传 ⇒ 读失败零输出 | Warning | **成立，已修** | 默认改 `warn = (msg) => console.warn(msg)`；反证 **F11** CAUGHT |
| i7 接线锁只 `toContain('maybeEnterFirstRun')`；`:disabled` 形状锁要求同行 | Info | **①已修，②留痕** | 接线锁改为「import 行以外出现 `maybeEnterFirstRun({ router })` 调用形态」+ 断言 `onMounted` 在场（原写法「保留 import、删掉调用」也照样绿，正是本批的失效形态）。形状锁保留，脆弱性已在用例注释点名，改 AST 解析属另批 |
| i8 被删用例数量在文档间不一致 | Info | **成立，已统一** | 现场取证：`git diff origin/main HEAD -- FirstRun.test.js` 的 `-  it(` = 7 条，其中 5 条是假检测契约（retryDeps / onFirstRunStatus step·done·error / firstRunCheck skips），2 条同名改写；现文件 19 → 24 条、新契约 10 条。CHANGELOG、执行记录与测试注释三处口径同步 |
| i9 `first-run:complete` 走 PUBLIC 档位 | Info | **已显式声明理由** | spec 增补：与 `first-run:check` 同档，写入口只影响引导可见性、不提升数据权限；限 `isTrustedSender` 属 API 面统一话题，登记不改 |
| i10 `markDone` 同步 `writeFileSync` 直写最终名 | Info | **成立，已修** | 改为临时名 + rename 的原子替换。判据不是"少一次阻塞"而是**损坏标记的读法**：`isSetupDone()` 只看 `existsSync`，半写/0 字节的最终名文件会被读成「已完成」⇒ 向导永久消失且日志零痕迹。并发写者让 rename 失败时如实报 `reused: true` 并清临时名；**不做退避重试**（AGENTS 的有界退避只授权覆盖型替换的 EPERM/EACCES/EBUSY，本路径无覆盖语义，重试不改变结果）。新增 3 条用例：内容完整 + 无 tmp 残留（含"写入落点必须是临时名"的判别式）/ 真实文件系统竞态下仍收敛到同一条不变式（跨平台两形态各自成立）/ rename 抛错且最终名不在场 ⇒ 原样进失败处理并清 tmp。反证 **F15**（退回直接 `writeFileSync(最终名)`）CAUGHT，红 2 条 / 探针 2/2 |

### 4.1 首轮反证读数（15 道，扩自 11 道）

```
[BASELINE] rc=0 failed=0 passed=290 collected=290 errors=0 blind=false
F1–F15 全 CAUGHT，逐条探针命中 ≥1/1；15/15 RESTORE_OK
[SUMMARY] 共 15 条：CAUGHT=15 其余=0        rc=0
```

作用域变化必须如实记录：F13/F14 的锁定用例在 `src/api/publisher.test.js`，该文件此前**不在**反证域内，
所以 11 道那轮读数（`collected=45`）对 i5 不构成证据；本轮把域扩为 4 个文件、`collected` 45 → 290。
F15 是 i10 的判别式反证（把 `markDone` 退回直接 `writeFileSync(最终名)`），实测红 2 条 / 探针 2/2 ——
**注意**：只断言"最终名内容完整"对这条变异**完全免疫**（旧写法产出的内容同样完整），
所以 i10 的锁里必须有一条看"写入落点是临时名"，否则反证会 MISSED。

### 4.2 闭合状态：本轮**未**取得合法闭环，且这不是 diligence 问题

`ccg-deep-review.js` 的自扮演出口把 `verdict === 'upheld'` 一律计入 blocking，因此填完真实裁决后
落的是 `self_play_blocked`（5 条），退出码 1：

```
♻ 复用存档 critique（10 条）+ 已填完的裁决 —— 跳过模型调用
🔴 自扮演裁决判定存在阻断项 5 条  i2 i3 i4 i5 i6（全 Warning）
```

**机制缺口（登记，不绕行）**：现有词表把「指控成立」与「指控成立且已在本 PR 修好」合并为同一个
`self_play_blocked`，而 `CLOSED_DEEP_REVIEW_STATUSES` 的合规出口 `closureNote` 语义是**假阳性**。
于是本批这种「评审有价值 ⇒ 5 条成立 ⇒ 已全部整改 + 反证」的形态**没有合法出口**：
既不伪造 `self_play_resolved`（那是谎报），也不删产物、不把手写 status 塞进产物。
后果按 AGENTS 判据第 1 条与第 4 条执行：`check-pr-exec-record.js --mode=enforce` 报 QM-6 欠账 ⇒
**本 PR 不自动合并**，等人工或机制裁决（任务 #19）。上一轮已实测 `sh scripts/deep-review.sh`
重跑仍落自扮演，所以"再跑一次"不构成出路。


## 五、遗留

1. `services/onboarding.js` 三条 IPC 通道全仓零调用方（实测），本批未顺手退役。
2. 向导不做真实环境准备；若将来恢复检测，必须同时恢复状态机与失败可重试路径。
3. 反证驱动接进 CI（任务 #23）。

## 八、QM-1 现场读数（打包产物三段验证，不是"能启动就算过"）

### 8.1 为什么第一版没通过

`<style>` 块里写行注释 ⇒ vite/postcss 直接 fail。全量单测与变异驱动**都不编译 style 块**，
所以"本地全绿"在这类缺陷上完全没有信息量。这是 AGENTS.md 里「单元测试不能替代完整打包验证」
又一种具体形态，也是 QM-1 不能被"我测过了"顶掉的实证。修法用 CSS 块注释；
顺带一条同族坑：块注释体内出现字面 `*/` 会提前终止注释（我第一版修法就踩了，等于换了个姿势再炸一次）。

### 8.2 打包与产物

- `pnpm run build:vue && electron-builder --dir` → 成功；
  `Multi-Publish.exe` 239,075,328 B；`resources/app.asar` 156,088,807 B。
- `asar list` 用**反斜杠路径**匹配（第一遍我用正斜杠 grep ⇒ 0 命中，那是坐标错不是内容缺）。
  `\electron\services\first-run.js` 在包内，`markDone` 在其中出现 3 次。
- 依赖解析先行：`node scripts/verify-worktree-deps.js` OK（11 项消费解析全部指向本 worktree）。

### 8.3 8 秒存活与 stderr 三层判据（不带调试端口）

```
[plain] pid=20412 procs_before=0
[plain] 窗口期存活=true procs_during=4 exitCode=null
[plain] procs_after=0（只杀自己那个 PID，不按进程名批量 kill）
[plain] stderr_chars=0 红线命中=0
[plain] VERDICT PASS
```

存活单独断言（只看 stderr 会把"根本没起来"读成"启动干净"）；
子进程 env 显式剔除 `ELECTRON_RUN_AS_NODE`；进程数 before/after 都为 0 —— 本机没有别的实例被我误杀。

### 8.4 三段真机（打包产物 + 冷 profile + CDP）

```
[QM1] A 冷启动 hash="#/first-run"  firstRunCheck={"code":0,"data":{"setupDone":false}}
[QM1] B firstRunComplete 返回={"code":0,"data":{"setupDone":true,"reused":false}}
[QM1] C 同 profile 二次启动 hash="#/" firstRunCheck={"code":0,"data":{"setupDone":true}}
```

这三行是本批**唯一的用户侧证据**：冷 profile 真的进向导、出口真的把标记落进真源、
标记之后真的不再进向导。A/C 两条合起来才否证「判定永远不收敛」与「标记落不了地」两种相反缺陷。

两条取证注意：

1. CDP WebSocket **不能带 Origin 头**（显式传空串仍被 DevTools 以 403 拒绝），
   并需 `--remote-allow-origins=*`；`Runtime.evaluate` 走 async IIFE + `awaitPromise`。
2. 带 `--remote-debugging-port` 跑的那两趟 stderr 都是 95 字符 —— 内容就是
   `DevTools listening on ws://…`，**是我的验证参数造出来的，不是应用的问题**。
   所以三层判据的 PASS 读数必须来自不带调试端口的那趟（8.3）。把验证工具的噪声判成被测对象的缺陷，
   和把它静默豁免掉，是同一种错。

脚本：`<本机临时目录>/mw-14-qm1-onsite.js`、`<本机临时目录>/mw-14-qm1-plain.js`（一次性验证脚本，不入库；
入库版属任务 #28 那道 style 编译门禁的讨论范围）。

## CHANGELOG 条目

# [未发布] fix(首启): 首启向导接回启动判定 —— 主进程不再替用户写"已完成"，判定走拉取，假检测行撤下（ux-audit-first-run-launch）

- **问题**：`electron/window.js:228` 在窗口创建路径上调 `firstRun.runSetup(mainWindow)`，而该函数「无标记 ⇒ 立刻 `writeFileSync(first-run-done)` 并广播 done」（注释原话是 P2-E 的「无需检查浏览器资源，直接标记首次运行完成」）。它移除检测能力的同时把整条引导短路 ⇒ **向导对所有人永久不可达**，`FirstRun.vue` 的 19 条测试测的是一个用户到不了的地方。
- **判定为什么不能挂在主进程推送上**：推送发生在窗口创建时，**早于任何渲染端订阅**，事件必丢且无重试。改为渲染端挂载时主动问一次（`useFirstRunGate`）：只在 `code===0 && typeof setupDone === "boolean"` 时决定，其余（桥不可用 / 结构不符 / 抛错）**一律不动导航也不置闩**——「没读到」不是「还没做过」。顺带纠出一个同源缺陷：`firstRunCheck()` 的 `invokeWithFallback` 兜底写的是 `code:0 + setupDone:false`，把"桥不可用"伪装成一次成功的"还没做过"，在浏览器 dev server 里会让每次访问都跳向导；改成与同文件其余通道一致的 `code:-1`。
- **标记的唯一写者换成用户动作**：新增 `markDone()`（幂等：已有标记不重写时间戳，那是排障时唯一的完成时间锚）+ IPC `first-run:complete` + preload 导出，三处配对由一把锁守住（漏登记的的症状是"点了完成没反应也没有错误"）。出口写失败**不挡用户离开**（把人困在向导里比"下次再走一遍"更糟），但必须出声（toast + `console.warn`）。
- **本批最有价值的一条：移除一个错误行为会造出第二颗雷。** 旧「下一步」被 `allDepsDone` 门控，而它唯一的点亮来源就是那条 done 推送——改成"等用户完成"后首启推送永不到来 ⇒ **新用户会卡在步骤①**。正解是让「下一步」恒可点，并加一条「步骤①始终可前进」的用例。这类"改 A 使 B 失效"只有把流程真跑一遍才看得见。
- **第二条：测试会把假证据钉成契约。** 被删的 5 条用例断言的是「收到 done ⇒ Python 依赖 / Playwright 浏览器都 ✅」（`retryDeps resets error state` / `onFirstRunStatus step|done|error` / `firstRunCheck setupDone skips deps step`），而主进程什么都不测。按 AGENTS「测试断言不得反向固化错误行为」，处置是改写成 10 条新契约断言（不显示未跑过的结论 / done 推送也不点亮状态 / 步骤①恒可前进 / 出口必须落标记 / 写失败仍放行且出声 / 抛不成未处理 rejection / 导航被守卫拒绝不成未处理 rejection / 落标记期间出口禁用 / 重复点击只落一次 / 视图不再订阅推送），而不是删掉换绿灯。另两条同名的「渲染步骤」用例是改写不是删除（文件 19 条 → 24 条）。两行假检测状态连同 `.fr-dep-*` 十条 CSS、以及 `retryDeps()` 那句「Re-trigger setup」假承诺（它只调只读检查）一并撤下。**数量口径**：5（被删）/ 2（改写）/ 10（新增）/ 24（现文件总数），此前 CHANGELOG 与执行记录写「4 条」、测试注释写「6 条」，由 QM-6 i8 现场取证统一（判据：`git diff origin/main HEAD -- FirstRun.test.js` 的 `-  it(` 计数为 7，其中 2 条是同名改写）。
- **QM-6 首轮外部评审的处置**（proposer=opencode / critic=claude，10 条：6 Warning + 4 Info）：i1（脚本作用域 `$t` 未定义）经 `FirstRun.vue:121 const { t: $t } = useI18n()` 行号取证**判不成立**；其余五条成立并已修 —— 导航被拒后放开闩并如实返回 `push-failed` 档（i2）、向导出口的 push 收口进 try/catch（i3）、文档撤下「保留 first-run:status 通道」的假话并把新死通道登记为遗留 6.4（i4）、`publisher.test.js` 补三条兜底形状行为锁且把该文件纳入反证域（i5）、gate 默认 `warn` 从 noop 改为真出声（i6）。四条 Info 同批处置：接线锁由「标识符出现」改为「import 行以外的调用形态」（i7）、文档数量口径统一（i8）、`first-run:complete` 的 PUBLIC 档位理由写进 spec（i9）、`markDone` 改临时名 + rename 的原子落盘——`isSetupDone()` 只看 `existsSync`，半写/0 字节标记会被读成「已完成」而向导永久消失（i10）。反证驱动 `scripts/first-run-launch-contract-mutate.js` 由 11 道扩到 **14 道**（新增 F12 push 收口 / F13 firstRunCheck 兜底退回旧形态 / F14 firstRunComplete 谎报成功），末跑 `CAUGHT=14/14`、14/14 `RESTORE_OK`、基线 `collected=287 passed=287`。
- **文案**：5 处新文案走 `onboarding` 命名空间（zh/en 成对新增 4 键），日志串一律英文——`check-locale-sync --cjk` 由 FAIL（新增 10 处硬编码中文）转 PASS（基线 1330 → 当前 1112）。
- **落地形态**：新增 2 个测试文件（10 + 9 条）+ 改写 `FirstRun.test.js`（19 → 22 条），定向四文件 280 passed / 0 failed；`electron/` 与 `preload/` 均有改动 ⇒ QM-1 打包验证与"全新 profile 进向导 / 已有标记不进"的现场判据按 AGENTS 三层 stderr 口径执行，读数记在执行记录。
