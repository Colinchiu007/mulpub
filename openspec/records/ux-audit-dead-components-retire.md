---
record: ux-audit-dead-components-retire
task: UX 审计阶段 1.3（不允许"存在但无人渲染"）—— 删除 TrialBanner 与 LoadingState 两个零渲染组件及其注册点，并配 11 条防复活锁与 8 道变异反证
date: 2026-10-21
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src + test-setup.js）+ 文档，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：撤下两个"存在但无人渲染"的组件（ux-audit-dead-components-retire，2026-10-21）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree `mp-worktrees/mp-ux-audit-dead-banners`（D 盘），分支 `ux-audit-dead-components-retire`；依赖就绪三连（`pnpm install --frozen-lockfile` + `ensure-electron.js` + `verify-worktree-deps.js` OK，11 项解析到当前 worktree） |
| 质量节拍 pre-flight | ✅ | 编辑前确认非共享根 `main`；共享根未写入 |
| 决策依据（二选一怎么选的） | ✅ | 判据不是"哪个设计更好"而是**会不会与已编码的 UX 契约冲突**：`Dashboard.style-guard.test.js` 记录着 2026-10-17 的用户决策"方案 C：撤下"，理由是横幅文案在本页误导（该页门禁都是登录而非套餐），且套餐差异已改由区块锁占位承载（PRD §3.2）。接到会员中心等于绕过那次决策并新增第二份真源 ⇒ 选删除 |
| 删除面完整性 | ✅ | `TrialBanner.vue` / `TrialBanner.test.js` / `LoadingState.vue` / `LoadingState.test.js` / `more-tests.test.js` 共 5 文件 `git rm`；注册点两处：`src/main.js` 与 **`apps/desktop/test-setup.js`**（见「二、验证域踩坑」） |
| 自测（新增面） | ✅ | `vitest run src/components/dead-components.test.js src/components/UpgradeModal.test.js src/views/Dashboard.style-guard.test.js src/views/Dashboard.test.js` → **4 files passed / Tests 56 passed**，rc=0 |
| 自测（全域） | ✅ | `vitest run src`（402 个测试文件）首跑读数 **2 failed / 6386 passed / 2 skipped (6390)**，rc=1。两条红都来自 `src/overlay-view-suspension.test.js` 的「preload index.bundle.js 已重打包」，真因是 `ENoENT`——被读的 `apps/desktop/electron/preload/index.bundle.js` 由 `.gitignore:474` 忽略且不在 git 里，全新 worktree 必然没有它。**不是回归**：跑一次 `pnpm run build:preload` 后同一文件 **22 passed / 0 failed** ⇒ 换算后全域读数 **0 failed / 6388 passed / 2 skipped (6390)**。聚合 `eslint` rc=0。对照基线：同一条命令在共享主工作区（main tip）跑同一文件报 **4 failed**，本 worktree 反而更少 ⇒ 既非本批引入也非本批加重。 |
| 反证（8 道） | ✅ | `node scripts/dead-components-contract-mutate.js`，末行读数 `[BASELINE] rc=0 failed=0 passed=11 collected=11 errors=0 blind=false` ⇒ `[SUMMARY] 共 8 条：CAUGHT=8 其余=0`，驱动 rc=0。注入形态：C1 测试宿主把 `LoadingState: EmptyState` 加回全局注册表 / C2 `main.js` 重新注册 / C3 反向守卫的探针换名字 / C4 扫描根退化成不存在的目录 / C5 重建组件空壳文件；C1–C5 之后的 C6/C7/C8 是 QM-6 第一轮命中后补的（见 §四）：C6 接线藏进「行首块注释 + 同行代码」/ C7 缺席断言翻成正面断言 / C8 探针仍按已撤组件类名取元素 |
| 静态门禁 | ✅ | `check-unwired-tests.js` → `检查域内测试文件 119 个 / OK: 全部测试均已接线或按欠账登记`（新增的 `dead-components.test.js` 由 vitest workspace 收集，不需另接）；`check-no-brand-residue.js` → `PASS（扫描 11559 个 tracked 文件，无品牌残留）`；`check-doc-abs-paths.js` → `PASS … counts=1161 domain=5130 files=561 canJudge=true`（新 PRD 只用相对路径）；聚合 `eslint` rc=0。本批只删不增文案 ⇒ 无 locale 成对面 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐字一致（不一致即说明行尾被改）。做法：新脚本一律 LF，改既有 CRLF 文档由补丁脚本按行保留各自行尾（`split('\n')` 后不碰行内容），写完后当场对账 |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/**` 与 `packages/rpa-engine/**`；`test-setup.js` 与 `src/main.js` 属渲染端测试宿主/入口 |
| QM-4 视觉回归 | N/A（如实登记） | 两个组件本就零渲染 ⇒ 不在任何像素视图的渲染树里；删除不改变任何基线像素。像素门禁由 `QG Visual` 在 CI 以 CI 渲染为准执行 |
| QM-5 第一性原因（①） | ✅ | 不是"忘了接"：`TrialBanner` 是**被产品决策主动撤下后没删文件**（守卫反转于 2026-10-17，组件留在树里），`LoadingState` 是"注册即接线"的误解（全局注册 ≠ 有使用方）。两类都属 AGENTS 的"装饰性链路" |
| QM-5 逃逸分析（②） | ✅ | 单元层：两个组件的测试**自己 mount 自己**，把"有测试"当成"已接线"（正是 AGENTS「注册≠注入≠生效」的同型）；集成/视觉层：结构上失明（不渲染就没有可回归的像素）；审查层：由 UX 审计人工模板发现（audit-6） |
| QM-5 修复 + 回归保护（④） | ✅ | 删除 + 一把按"代码行 + 语义"切的防复活锁（11 条，含扫描域规模下界与"反向守卫本身仍在"对偶） |
| QM-5 防止再发生（⑤） | ✅ | ① 锁的红文案直接给出恢复前置（必须同时恢复看板页位置守卫并另开 change）；② 验证域纪律写进 PRD §1 与 spec 的第三条 Requirement：**全局组件表有两个写者**，判"是否还有人用"必须同时查 `main.js` 与 `test-setup.js`；③ 阶段 5.3 的通用未接线门禁已登记承接点 |
| QM-6 双模型 | ⏳ 见「四、QM-6」 | 判定为 `single`/`dual` 由 decider 现场给；不伪造闭环状态 |
| 远程同步 | 由门禁推导 | PR #pending —— 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词、不另开回填 PR |

## 一、用户可见变化

| 面 | 变化 |
|---|---|
| 看板页 | **无**（横幅早已不渲染） |
| 会员中心 | **无**（本批不新增显示面） |
| 加载/骨架态 | **无**：实际渲染的仍是 `EmptyState` / `UiSkeleton` |
| 全局组件表 | 少一项 `LoadingState`（`main.js` 与 `test-setup.js` 同步） |
| 用户可见文案 | 只减不增（删掉组件内硬编码中文串），locales 无新增键 |

## 二、验证域踩坑（本批唯一的意外，也是最有价值的一条）

判"零引用"时我只 `grep` 了 `apps/desktop/src`，据此删掉 `LoadingState.vue`，
结果 **4 个与删除无关的测试文件整片加载失败**：

```
Error: Failed to resolve import "./src/components/LoadingState.vue" from "test-setup.js". Does the file exist?
```

根因：`apps/desktop/test-setup.js`（**在 `src/` 之外**）把 `LoadingState` 注册进测试全局组件表，
注释写着"镜像 main.js 的全局注册"。所以"有没有人用它"的**全域**至少包含两个注册面 + 模板用法，
把扫描域钉在 `src/` 里就会得出"零引用"的错误结论。

处置不只是补删注册点：spec 里新增一条 Requirement（注册表验证域必须覆盖 src 之外的镜像注册点），
锁里加一条直接断言 `test-setup.js` 不再提到该组件 —— 让下一个会话不再靠"我记得踩过"。

## 三、判据自身的两个坑（写下来防重抄）

1. **反向守卫不能被判成违规**：`Dashboard.style-guard.test.js` 与 `Dashboard.test.js` 的**代码行**里
   必然含 `<TrialBanner` / `TrialBanner`（它们就是在断言"它不存在"）。按"代码行出现即违规"的粗判据，
   防回潮的锁会把防回潮的守卫判红。处置：剥行注释 + 显式豁免这两个文件，
   **并加一条对偶锁验证它们仍在做缺席断言** —— 否则豁免就成了可复用的洞。
2. **空壳测试文件是红不是跳过**：删掉 `more-tests.test.js` 的 4 条 TrialBanner 用例后，该文件
   只剩 import 与 mock、零用例，vitest 直接报 `No test suite found in file ...` 并计入失败。
   顺手核实其中 `UpgradeModal` 的 import 在该文件里本就未被使用 ⇒ 整文件删除，
   `UpgradeModal` 的真实测试在同名 `.test.js`（已跑）。

### 3.3 本批反证驱动自己先错了两次（第一次跑 5 条全 MISSED）

第一跑读数：`[BASELINE] rc=0 failed=0 errors=0 blind=false` + `C1..C5 全 MISSED`。
看起来是"五道锁全部没牙"，实际两条都是**驱动失明**，与被测判据无关：

1. **汇总行没剥 ANSI**。vitest 把数字包成 `\x1b[1m\x1b[31m1 failed\x1b[39m\x1b[22m`，
   于是 `/Tests\s+(\d+) failed/` **永不命中** ⇒ `failedCount` 恒 0；而 `blind` 判据只问
   `"Test Files" 在不在输出里`，它在 ⇒ 不报盲。**后果是"基线干净"与"变异没红"共用同一个 0**，
   整个电池变成一台只会打印 MISSED 的机器。修法：`out` 在进入任何解析前统一
   `.replace(/\x1b\[[0-9;]*m/g, '')`。
2. **收集期死亡被读成 MISSED**。C1 的注入写成裸 `LoadingState,`（对象简写属性），
   那是一个**未定义标识符** ⇒ `test-setup.js` 求值期抛 ReferenceError ⇒ 该测试文件整份没跑，
   输出里只有 `FAIL <file>` 而没有 `FAIL <file> > 叶子标题`，既没有 `Tests N failed` 也没有 `Errors N`。
   三条判据全部取不到读数，于是落到 `MISSED`（"锁没牙"）。真相是**本条不可归因**。
   修法两条一起：驱动侧新增 `RUN_UNCLEAN` 档（`rc≠0 且具名红=0`，或存在文件级 FAIL 而无叶子标题）；
   变异侧改成**可执行**形态 `LoadingState: EmptyState,`——它确实把退役组件加回了注册表
   （名字是真的注册名，值指向别的组件），而不会让模块求值失败。

另两条同期纠正：

- **C3 原来攻击的是"把断言本身删掉"**。删断言不可能被同一条断言抓到——那条变异证的不是
  "锁有没有牙"，而是"锁会不会发现自己被删"，属取错变量。现在改成攻击被豁免方**真正做的探测**
  （`tpl.indexOf("<TrialBanner")` → `indexOf("<GhostBanner")`），并把 `反向守卫本身必须还在`
  这条锁从"文件里提到那个名字"收紧成**形状判据**（探针在 + `.toBe(-1)` 期望在）。
  注意顺序：是**补强锁**再改变异，不是为了让变异红而放宽锁。
- **基线新增 `collected` 下界**。`TEST_FILES` 路径写错时 vitest 会打印 `No test files found`
  而 rc 可能仍为 0 ⇒ "基线干净"与"一条都没跑"同形。现在基线必须 `passed+failed > 0`，
  并把 `passed=/collected=` 一起打印出来。

修完后的现场读数：`[BASELINE] rc=0 failed=0 passed=11 collected=11 errors=0 blind=false`，
`C1..C8 = CAUGHT ×8`，驱动 rc=0。

## 四、QM-6
判定读数：`node scripts/ccg-review-decider.js --base origin/main --head HEAD` → **DUAL**
（变更 754 行 / 12 个源文件 > 200 行阈值；敏感命中 0 路径 + 2 内容）。

critic=claude 出 10 条、引擎收敛到 4 条待裁决（跨家族证据见 `dead-components-r1-family-snapshot.json`：
proposer=opencode/deepseek、critic=claude/anthropic）。**四条全部 upheld**，且每条都先对着当前 HEAD 复现过，
不是照抄评审措辞：

| # | 指控要点 | 复现读数 | 处置 |
| --- | --- | --- | --- |
| i1 | 第 5 条对 `Dashboard.test.js` 只 `toContain("TrialBanner")`，名字在场即通过 ⇒ 把缺席断言翻成正面断言时锁照绿 | 成立：对偶锁只做了一半，与文件头宣称的「验证豁免文件确实还在做缺席断言」不符 | 改成按**形状**判：先按行取到 `findComponent({name:"TrialBanner"})` 那一行（取不到即红），再要求同一行含 `.toBe(false)`；新增变异 **C7** 实测 CAUGHT |
| i2 | `code()` 按行首注释符过滤 ⇒ 漏报（`/* x */ app.component(...)` 整行被丢）+ 误报（跨行块注释正文行被当代码） | 两条都当场复现 | 改成注释优先：整块剥 `<!-- -->` 与 `/* */`（含跨行）→ 剥行首 `//` → 剥行尾 ` //…`（要求 `//` 前是空白，避免误伤 `https://`）；新增 4 条直测 `code()` 的用例 + 变异 **C6** 实测 CAUGHT |
| i3 | `contrast-probe.js` 仍以已撤组件的 `.banner-text` 为探针 ⇒ 看板那档空集 | **依赖真实、机制描述过严**：探针 `:63` 是 `if (!res.found) { console.log("  未找到该选择器"); continue }` —— 它出声且跳过，既不报错也不出假绿；但那一档从删除起等于从未被测 | 探针改指 `.stat-label`（同族「深色底上的小号文字」，对比度量纲一致）并留历史注释；新增第 11 条锁（CASES 不得再有 `.banner-text`，且 `.stat-label` 必须仍在 —— 删掉比留错更隐蔽）+ 变异 **C8** 实测 CAUGHT |
| i4 | 驱动头注释承诺「还原后独立 md5 回读（rc=4）」，实现里没有；且 SIGINT/SIGTERM 默认不执行 finally ⇒ 中途打断会把工作树留在变异态 | 成立：抄了 1.5/1.6 的契约没抄实现，`main()` 只返回 0/1/2 | finally 还原后独立读回并比对 md5，不一致置 `restoreFailed` 并在末尾以 **rc=4** 出声；注册 SIGINT/SIGTERM/SIGHUP 先还原再退出，还原失败时点名文件路径供手工核对。本轮 8 条各打 `RESTORE_OK` |

**i3 的"机制说重了"没有被用来否决整条** —— 判据是「依赖是否真实」，后果描述不准只影响修法的力度。
这是本批想留的一条处置口径：**「评审给的失效机制不成立」和「这条指控可以不改」是两件事**。

产物（`.adversarial/` 被 gitignore，不构成可复核证据，故评审原文已入库）：
`.ccg/reviews/dead-components-r1-critique.md`、`.ccg/reviews/dead-components-r1-family-snapshot.json`、
判定记录 `.ccg/reviews/6fa05fa3….json`（`mode=dual`，`deepReview.status=self_play_blocked`，`findings` 4 条带完整裁决）。

结算读数（零模型调用短路）：`♻ 复用存档 critique（10 条）+ 已填完的裁决 —— 跳过模型调用` →
`🔴 自扮演裁决判定存在阻断项 4 条`（i1/i2/i3 `self_play_upheld`，i4 `high_risk_requires_external`）⇒ 状态
**`self_play_blocked`，不在闭环集合 `{cleared, needs_revision, self_play_resolved}` 内** ⇒
**本条 PR 不能自动合并**，`check-pr-exec-record --mode=enforce` 会点名这笔欠账。

如实提交产物，不删不换绿灯。出口只有两个：跑一次真跨家族外部复核，或人工判 `needs_revision` / `cleared`。
i4 上的 `highRiskDomains: ["crypto"]` 经核对是分类器误报（本批零鉴权/加密代码，命中的是文档散文里的字样），
但**不据此绕门禁** —— 收紧分类器同样属"改谁来守门"，须人工过目。

## 五、遗留

1. 阶段 5.3 的通用"未接线组件"门禁上线后，这两例应收敛进它的棘轮；本批刻意不把全域打开。
2. 若产品确要恢复试用提示：MUST 同时恢复看板页"必须在 `.cohere-content` 内"的位置守卫并另开 change
   （锁的红文案已写明这条前置）。
3. `useLicenseStore` 的 `isTrial` / `isFree` / `daysRemaining` 仍有其它消费方，本批不动 store。
4. 反证驱动尚未接进 CI（任务 #23 同批欠账）。
