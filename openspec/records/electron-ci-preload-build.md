---
record: electron-ci-preload-build
task: 给时钟位移引信巡检 workflow 补「先重建构建产物」步骤，并把「跑桌面测试的 job 必须先备好产物」做成跨 workflow 的静态装配锁
date: 2026-10-18
---

## 本次执行记录：桌面测试前置产物的第二落点（clock-shift-oracle）与跨 workflow 装配锁（electron-ci-preload-build，2026-10-18）

> （本记录按 `gate-record-sync-derived-status` 落地后的新形态写：不带 `sync_*` 三字段，状态列不手写状态词，收口由门禁按主干历史推导。）
> 与 #3837（`openspec/records/electron-ci-preload-build-step.md`）的关系：那一片修 `electron-ci.yml` 那半边，判据是追加在 `.github/scripts/workflow-contract.test.js` 里的三条锁；本片补 `clock-shift-oracle.yml` 那半边，并把判据升级成按 job 扫 workflow 正文的**跨 workflow 装配锁**。两条锁**有重叠但不等价**，也不互相替代，详见下方「与 #3837 的关系」一节——#3837 的任何一条锁都没有被删除或改写。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（CI 属运行面，见 AGENTS.md 分层策略）：worktree `<worktreeRoot>/mp-electron-ci-preload-build` + 裸分支 `electron-ci-preload-build`；rebase 到 origin/main 后 HEAD 与 merge-base 同为 `ad357a7d3`（已同步）；`node scripts/verify-worktree-deps.js` rc=0（消费方解析 11 项全部指向本 worktree） |
| 第一性原因（QM-5 ①） | PASS | 引入点 = `826fa7e13`（PR #3782，change `bundle-untrack`）：把 preload / paginator 产物移出版本控制（`git rm --cached`），并**只**给 `quality-gate.yml` 的三个消费 job 插了「Build preload bundles」⇒ 它的安全性论证**只对一个文件成立**。消费面实际是 3 个 workflow：第一次收口（#3837 / `1bed4ad2c`）补了 `electron-ci.yml`，`clock-shift-oracle.yml` 是**第二个落点**、由本 PR 补齐 |
| 逃逸分析（QM-5 ②） | PASS | 三条，逐条有现场。①**该 workflow 只有 `schedule` + `workflow_dispatch`**（`clock-shift-oracle.yml:15-25`）⇒ PR 事件上根本不排队，「PR 全绿」与它无关；它的上一次（也是唯一一次）运行 `38638645067` 是 2026-10-14 success、**早于** `826fa7e13`，因此从改动落地到下一次 schedule（每周三 18:00 UTC，首次 2026-10-21）之间**没有任何红灯面**。②**跑了也不一定红**：`scripts/check-clock-shift-oracle.js:354-357` 在基线段出现**任何**红时打印 `ORACLE_NOT_AUTHORITATIVE` 并 **`return 0`** ⇒ 呈现是绿灯，而「该域内无引信」这句结论已经失效（丢的是权威性，不是亮红灯）。③**同族那条既有配对锁看不见它**：`.github/scripts/workflow-contract.test.js:1256` 的关系型断言**扫描域**其实覆盖全部 workflow（`readdirSync(wfDir)`），漏的是**消费者谓词**（`desktopStepsRunSuite`，同文件 `:1233-1238`）——它只认 `--filter @multi-publish/desktop test\|test:all\|test:coverage` 的单行与参数数组两种命令行形态，而 oracle job 是经 **CLI**（`node scripts/check-clock-shift-oracle.js`）消费桌面用例的 ⇒ 该 job 对它结构性不可见（判据本身没有缺陷，是它的消费者定义域不含这条通道） |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：`clock-shift-oracle.yml` 在 `Ensure Electron binary` 与「接缝自检」之间插入 `Build preload bundles`（`pnpm --filter @multi-publish/desktop run build:preload` + `build:paginator`，与 quality-gate 侧逐字同命令），位置在完整两趟之前。回归保护三件：新锁 `.github/scripts/check-desktop-test-prereqs.js`（按 job 解析 workflow 正文 + 五形态识别 + 满足器闭包）、登记表 `.github/scripts/desktop-test-prereq-jobs.json`（4 条 required / `exempt: []`）、用例 `.github/scripts/check-desktop-test-prereqs.test.js`（9 用例）。现场：锁用例 **9/9 pass**（`node --test` 实测），锁 CLI **rc=0**（`fatal=0 debt=0`） |
| 防止再次发生（QM-5 ⑤） | PASS | 判据**接进 CI** 而不是只留在本地：`quality-gate.yml` 的 **Gate 2b**（`shell: bash` ⇒ 任一非零即中止；该 job 的 `if:` 只在 docs-only 时短路）新增两行 —— `node --test .github/scripts/check-desktop-test-prereqs.test.js` 与 `node .github/scripts/check-desktop-test-prereqs.js`。接线棘轮 `node scripts/check-unwired-tests.js` **rc=0**（新测试文件被 workflow 显式点名，不在 `KNOWN_UNWIRED` 欠账里）。变异反证 V1–V7 **全部 CAUGHT** 且红集互不相同（见下节）。另：同处登记表是「谁在域内」的唯一真源，域内集合变化会当场报红（含陈旧登记与未登记两条方向） |
| 行尾与 diff 对账 | PASS | 两口径逐行相等：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 均为 `clock-shift-oracle.yml 11/0`、`quality-gate.yml 11/0`（插入 22 行、删除 0 行）；`git diff --check` rc=0（无尾随空格、无冲突标记）。两份 YAML 在 CRLF 域，追加行随文件既有行尾（用 Node 行锚点脚本改写，未做整文件回写） |
| 接线棘轮 | PASS | 新增测试文件 `.github/scripts/check-desktop-test-prereqs.test.js` 已被 `quality-gate.yml` Gate 2b 显式点名（`node --test …`），且承载它的 run 块是 `shell: bash`。同批必跑项读数：`node .github/scripts/check-workflow-structure.js` rc=0、`.github/scripts/check-workflow-structure.test.js` 6/6、`node scripts/check-step-failfast.js` rc=0（38 个 run 块全部 fail-fast）、`.github/scripts/workflow-contract.test.js` 43/43（上游 +1 后重测） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/**`、`packages/rpa-engine/**` 与任何 UI 文件 ⇒ QM-1 打包验证与 QM-4 视觉回归均不适用。改动面 = 两份 `.github/workflows/*.yml` + 三个 `.github/scripts/*` 新文件 + 本记录 + `CHANGELOG.md` |
| QM-6 CCG 双模型外部评审 | PASS | 判定记录 `.ccg/reviews/44db76dd….json`：`mode=dual` / `required=true` / `status=self_play_resolved` / `performedBy=self-play` / `confidenceWeight=0.6` / `requiresExternalReview=[]` / `blocking=[]`（`reviewBackends` 缺省）。 审查产物按 `.gitignore` 的既有策略（工作产物不进主干、判定记录 JSON 才是留痕）留在本地归档目录 `.adversarial/ccg-deep-6844dff6/`（**不随本 PR 入库**；裁决全文的可复核面是判定记录的 `deepReview.findings[]`，逐条处置见下节）：`proposal-v1.md`（出方案后端）+ `critique-v1.md`（批判后端：5 条指控 + 四维打分）+ `family-snapshot.json`（跨家族校验，两个后端的家族名在此文件）+ `adjudication.json`（逐条裁决：本地归档 9689 字节 / 59 行 / 有末尾换行）。实跑 `sh scripts/deep-review.sh`（Git for Windows bash 登录壳）`EXIT=0`： `判定: DUAL`（变更 1790 行 > 200 行阈值；该读数取自 A 提交当时的判定，其后追加的判定记录与执行记录只会更大，档位不变）、`跨家族校验 … 通过`、 `复用存档 critique（ 5 条）+ 已填完的裁决 —— 跳过模型调用`、末行 `自扮演裁决未发现阻断项`。裁决与批判以**内容指纹**绑定 （`14157441e4626079`：引擎重跑时现算与骨架 `一致 = true` ⇒ 改写 `critique-v1.md` 任一字节即失效）。 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` rc=0：本状态在闭环白名单内；无 `reviewBackends` 只触发「历史产物」这条豁免（不追溯变红）； `performedBy` 非空 ⇒ 不触发「无署名执行者」。**如实声明**：外部模型（两个家族）只承担出方案与批判，逐条裁决由引擎**自扮演**完成； 四条指控的高危域均为空（不触及密钥 / 解密 / 鉴权）⇒ 按 QM-6 口径允许自扮演豁免。逐条处置见下节 |
| 远程同步 | 由门禁推导 | 本行**不需要事后回写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。合并前这篇文件还不在基线上，分类机判 `NOT_IN_BASE` ⇒ byDesign（不红，也不需要登记字段）；反过来把状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

## 本机读数（全绿，逐条可复跑）

命令均在 worktree `<worktreeRoot>/mp-electron-ci-preload-build` 下执行：

| 命令 | 读数 |
|------|------|
| `node --check .github/scripts/check-desktop-test-prereqs.js` | rc=0（语法） |
| `node -e "JSON.parse(require('fs').readFileSync('.github/scripts/desktop-test-prereq-jobs.json','utf8'))"` | rc=0（登记表可解析） |
| `node --test .github/scripts/check-desktop-test-prereqs.test.js` | rc=0，`# pass 9 / # fail 0` |
| `node .github/scripts/check-desktop-test-prereqs.js` | rc=0，`workflows=14 jobs=29 entries=47 in-domain=4`；`problems: fatal=0 debt=0` |
| `node scripts/check-unwired-tests.js` | rc=0，检查域内 101 个测试文件全部已接线 |
| `node .github/scripts/check-workflow-structure.js` | rc=0 |
| `node --test .github/scripts/check-workflow-structure.test.js` | 6/6 |
| `node scripts/check-step-failfast.js` | rc=0（38 个受管 run 块全部 fail-fast） |
| `node --test .github/scripts/workflow-contract.test.js` | 43/43 |
| `node scripts/check-clock-shift-oracle.js --dry-run` | rc=0，`domain=1001 candidates=183`（`iso_date_string=152 epoch_ms=19 epoch_s=23 date_utc=3 kernel_time=6`）、`setup=true control_test=true vitest=true` |
| `git diff --check` | rc=0（无尾随空格、无冲突标记） |
| `node scripts/verify-worktree-deps.js` | rc=0（消费方解析 11 项全部指向本 worktree） |
| `node scripts/check-no-brand-residue.js` | rc=0（扫 10087 个 tracked 文件） |
| `node scripts/openspec-sync-check.js` | rc=0（387 tasks / 61 active changes / 232 archives） |

判据自己在输出里点名四条域内条目（含消费者步号、形态与满足器步号），这是"域内集合"的现场读数而非人工清点：

| 域内 job | 消费者步（形态） | 满足器步 |
|------|------|------|
| `clock-shift-oracle.yml#clock-shift-oracle` | `step[7]` `oracle-cli`（`node scripts/check-clock-shift-oracle.js`） | `step[5]` |
| `electron-ci.yml#electron-tests` | `step[8]` `desktop-filter`（`ref=test`） | `step[7,11]` |
| `quality-gate.yml#desktop-shards` | `step[6]` `desktop-filter`（`ref=test`） | `step[5]` |
| `quality-gate.yml#coverage` | `step[6]` `desktop-filter`（`ref=test:coverage`） | `step[5]` |

另有两条 `[NOTE]`（`electron-ci.yml#electron-tests` 的 `step[7]`/`step[8]` 带 `if: … pull_request …`，PR 侧被跳过，故「PR 全绿不构成这条在 CI 上跑过」）：这是判据主动写进输出的定性，不是告警噪声。

## 变异反证 V1–V7

七条变异各改判据本体的**一个**判定面，逐条跑 `node --test` 并比对红集（原始输出存档于本次会话的临时目录：`<tempDir>/p7-mutation-out.txt`）：

| 变异 | 改的是哪一个判定面 | 期望 | 实测红集 | pass/fail |
|------|------|------|------|------|
| V1 | 摘掉 `desktop-filter` 的散文守卫（前瞻 80 字符内无需 `pnpm`） | T5 / T6 | T5, T6 | 7/2 |
| V2 | 满足器闭包传递失效（只认"直接就是 `build:preload`"，不认闭包里提及 `build-preload.js`） | T6 | T3, T6, T9 | 6/3 |
| V3 | 顺序判据反向（满足器在同一步或更晚即算已满足） | T3 / T6 | T1, T3, T4, T5, T6, T9 | 3/6 |
| V4 | `oracle-cli` 的 `--dry-run` 域外判定掐死（自检趟被当成完整趟） | T6 | T1, T2, T3, T4, T5, T6, T9 | 2/7 |
| V5 | 形态上界 `MAX_FORM_COUNTS` 不再生效 | T6 | T6 | 8/1 |
| V6 | 登记表条目级形状问题不再早退 | T7 | T7 | 8/1 |
| V7 | PR 侧被 `if` 跳过的步骤不再留 NOTE | T1 / T9 | T1, T9 | 7/2 |

`syntax_rc=0`（变异不带语法错误）、`ALL_MUTATIONS_CAUGHT=YES`、**七组红集互不相同**（不是同一条用例兜住全部面，也没有任何一次只红"别的用例"而漏掉期望的那条：逐条 `命中期望用例：YES`）；7 次还原后 md5 每次回到基线 `7c0c948957ed030c6da84f0c93bb5920`。

## 与 #3837 的关系（重叠但不等价，逐维度列清）

同族锁在 `.github/scripts/workflow-contract.test.js` 的 `:1256` / `:1285` / `:1308` 三条（change `electron-ci-preload-build-step`，PR #3837 / `1bed4ad2c`）。本片**一条未删、未改**，两条判据并存。差异按**维度**列，避免"谁包含谁"这种在方向上会骗人的说法：

| 维度 | #3837（`workflow-contract.test.js`） | 本片（`check-desktop-test-prereqs.js`） |
|------|------|------|
| 判定域（谁在被扫） | 全部 workflow（`fs.readdirSync(wfDir)`，非写死单文件） | 全部 workflow **＋ 登记表** `desktop-test-prereq-jobs.json`（域内集合变化双向报红：未登记 / 陈旧登记） |
| 消费者谓词（谁算在域内） | 2 种命令行形态：单行 `--filter @multi-publish/desktop test\|test:all\|test:coverage`、PowerShell 参数数组 `"@multi-publish/desktop",` + `"test",` | **5 种形态**（`desktop-filter` / `pnpm-verb` / `root-nx` / `nx-direct` / `oracle-cli`）**＋ 脚本闭包解析**（`pnpm run <script>` 追到 nx / 裸 vitest，含 `--config` 限定与 `--exclude` 判定） |
| 重建步形状 | 要求**同一步**同时含 `build:preload` 与 `build:paginator`（`hasBothBuilds`） | 满足器**闭包**：允许分处两步，也认 `build-preload.js` 引用；额外要求**排在消费者步之前**（`BUILD_NOT_BEFORE_TESTS`） |
| 反失明 | `rows.length >= 3` | 形态下界 + 上界（`MIN_FORM_COUNTS` / `MAX_FORM_COUNTS`）＋ `workflows>=12` / `jobs>=24` 规模下界 |
| 事件门槛 | `electron-ci.yml` 的 build/test 两步 `if` 必须**字面量相等**且等于 `github.event_name != 'pull_request'`（绝对值判据） | 对带 `if` 的消费者/满足器步输出 `[NOTE]`（明示"PR 全绿不构成这条在 CI 上跑过的证据"），**不判红** |
| 自故障与账户 | 无独立自故障档（扫描退化只靠 `rows>=3` 暴露） | CLI 三档退出码（0 合规 / 1 有问题 / 2 扫描器自身故障）、`workflows` JSON 载荷与 GitHub 注解输出 |

⇒ 本片在**消费者形态面**是前者的扩展（前者对经 CLI 消费桌面用例的 job 结构性不可见），在**重建步形状**上比前者**更宽松**（接受分处两步），在**事件门槛**上是提示而非判红、在**域管理与自故障**上是新增面。两个方向都如实写出：**不是"严格超集"**，各有比对方严的维度；两条判据的判定域也不相等（本片把 `clock-shift-oracle.yml#clock-shift-oracle` 纳入并登记）。删掉任一条都会留下另一条看不见的落点。

## 定性：预防性收口（不依赖「oracle 现在已红」）

本 PR 的正当性**不建立在**"oracle 当前已经报错"这个前提上——那一点已被实测否证：

- `826fa7e13`（PR #3782）之后 oracle 只有一次历史 run（`38638645067`，2026-10-14 schedule success），**早于**改动落地；
- 决定性实验（单文件 A/B：`apps/desktop/src/views/CreateView.test.js`，产物在场 / 缺席两档各 300 例；脚本与输出存档于本次会话的临时目录 `<tempDir>/p10b-cv-ab.js` 与 `<tempDir>/p10b-cv-ab.txt`）实测**两档都是 300/300 通过** ⇒ 该文件在产物缺席档下的红与产物无关（属负载 / 时序类），把它当"产物缺失的红"就是拿没验过的因果当论据。**该证据的作用域只有这一个文件**：它证明「这一个文件不需要 preload 产物」，不是「全部桌面用例都不需要」——第 5 条 Info 级指控正是这一点，见遗留 9。

因此正当性来自两条**结构性**理由：

① **接线一致性**：`826fa7e13` 的安全性论证是"跑桌面测试的 job 先重建那 5 个产物"。该论证在 `quality-gate.yml` 被逐 job 落实、在 `electron-ci.yml` 由 #3837 补上，而 `clock-shift-oracle.yml` 是同一论证覆盖不到的第三个消费面（它经 CLI 消费桌面用例，产物缺席时它的候选域里那部分文件会报 ENOENT / `Cannot find module`）。
② **权威性保全**：`scripts/check-clock-shift-oracle.js:307-314` 在基线趟有红时 `return 1`（即首趟失败就不进第二趟），而 `:354-357` 在基线段出现**任何**红时打印 `ORACLE_NOT_AUTHORITATIVE` 并 **`return 0`** ⇒ 缺产物导致基线红时，呈现是**绿灯**，而"该域内无引信"这句结论**已经失效**。准确的表述是「**绿得看不出问题**」（丢的是权威性），不是"红得看不见"。

## QM-6 逐条处置（存档 critique 5 条 → 裁决面 4 条，全部 dismissed）

口径：`critique-v1.md` 共 5 条指控；`adjudication.json` 的 `items[]` 只收 **Critical/Warning 四条**（第 5 条为 Info，不进裁决面；引擎的 `blocking` 也只由裁决面推出），故下文 4 条处置 + 1 条如实登记（见遗留 9）。表中「指控」是中文摘要，**逐字原文**与 prosecution / defense / rationale 全文在**入库面** `.ccg/reviews/44db76dd….json` 的 `deepReview.findings[]`（四条各带 `finding` / `prosecution` / `defense` / `verdict` / `rationale`，可直接复核）；引擎的四份工作产物（`proposal-v1.md` / `critique-v1.md` / `adjudication.json` / `family-snapshot.json`）按 `.gitignore` 的既有策略（「工作产物不进主干，判定记录 `.ccg/reviews/*.json` 才是留痕」）留在本地归档目录，故 `critiqueFingerprint`（`14157441e4626079`，绑定该份 `critique-v1.md` 的字节）只在本地可复核。四维打分（**本地归档** `critique-v1.md`）：correctness 5 / security 8 / performance 7 / maintainability 2 —— 最低的 maintainability 由 i2 的体量指控驱动；裁决驳回该指控作为阻断项，但**不**把 2 分改写成高分（分数是「维护面看起来多重」的主观刻度，理由见该行）。

| # | 级别 | 指控（摘要） | 裁决 | 处置依据（可复跑） |
|---|------|------|------|------|
| i1 | Critical | 判据靠正则解析「声明出来的调用形态」而非真实执行；未枚举的写法（引号 / 块标量 / 折叠标量 / `--exclude`）会让某个 job 从判定域消失，缺前置重建的 job 因此静默通过；夹具未覆盖全部变体 | dismissed | 真静默只剩「**从未入域的新 job** 被写成未枚举形态」这一格（下述残留）。三类补偿逐条实测：① `--exclude` / `--config` 不靠形态枚举，由 `EXCLUDE_DESKTOP_RE` / `CONFIG_FLAG_RE` 单独识别，探针矩阵实测 `DETECTED`；② 整类或整域消失由 `FORM_COUNT_BELOW_MIN`（下界实测 12）与 `EMPTY_DOMAIN` 直接 fatal（合成根实测 4 处 fatal、rc=2）；③ 已登记 required 的 job 掉出域由 `judgeRegistry` 判 `STALE_REQUIRED`。**真实根 A/B**：把 `quality-gate.yml#desktop-shards` 的 vitest 步改写成未枚举形态 ⇒ 读数由 `rc=0 / entries=47 / in-domain=4 / desktop-filter=21` 变为 `rc=1 / entries=46 / in-domain=3 / desktop-filter=20`，并点名 `[DEBT:STALE_REQUIRED] quality-gate.yml#desktop-shards`（`desktop-filter` 21→20 仍在下界之上 ⇒ **单靠下界拦不住，是登记对账把它拦住的**）；还原后逐字节相同（内存镜像 + 精确回写，md5 自证）。三类变体（引号 / 块标量 / 折叠标量，含叠加）在探针里全部 `DETECTED` |
| i2 | Critical | 「多真源」：workflow YAML + 手工登记表 + 995 行解析器 + 746 行用例四份需同步，长期必然漂移；`nx-direct` 形态无覆盖 | dismissed | 登记表不是第二份「命令形态」真源：字段只有 workflow / job / why（27 行 / 1418 字节、4 条 required、例外清单为空），回答的是「这个 job 为什么必须有前置重建」，与命令怎么写无关。漂移**双向**都有拦断面：登记了却掉出域 ⇒ `STALE_REQUIRED`（本 PR 真实根 A/B 实测点名）；在域却未登记 ⇒ `UNREGISTERED_IN_DOMAIN`。`nx-direct` 被两次证伪：判据层 `MAX_FORM_COUNTS` 把该形态钉在 0，合成根里以 nx 直调的 job 被采成 `debt:FORM_COUNT_EXCEEDED`；用例层有 `zz-j.yml` 夹具锁住该路径。被引用的体量是「判据 + 其用例」总量，**单次改动的维护面 = 27 行清单 + 一个 why 字段**；用例体量大是因为每个枚举形态都配夹具与变异反证（既定质量口径），不是结构缺陷 |
| i3 | Warning | `.ccg/reviews` 的判定记录 JSON 无末尾换行（diff 里出现以反斜杠开头的 `No newline at end of file` 标记） | dismissed | 事实成立且已量化：该目录 1109 个 JSON 里 969 个（87.4%）无末尾换行 ⇒ 是该目录**主流形态**，非本 PR 特有；写入侧对照 —— 判定器（`scripts/ccg-review-decider.js` 两处 `JSON.stringify(record, null, 2)`）不写换行，而深度审查引擎的 writeBack 写换行，但引擎自写的 `critique-v1.md`（本地归档，1932 字节）同样无末尾换行 ⇒ 是工具层普遍形态。全仓无任何门禁检查末尾换行，且该文件由机器生成、由 `JSON.parse` 往返消费，末尾换行对任何读取方无语义差别。**本 PR 涉及的那一份已就地规范化**：按该文件相对本 PR 基线的路径 diff（`git diff <基线> -- .ccg/reviews/44db76dd….json`）判定，以反斜杠开头的 git 标记行为 0 行 |
| i4 | Warning | `CHANGELOG.md` 顶部新增 47 行，远超「简短发行说明」，会稀释该文件作为发行索引的可用性（位置序邻居 9–22 行） | dismissed | 事实成立、量级属长尾而非异常：按 `^# ` 发布条目粒度实测 525 条，行数中位数 19 / 平均 42.5 / 最大 4398，**≥47 行的有 57 条 ⇒ 本条位于 89.5 百分位**，在该文件自身惯例内。内容必要性：描述的是一个长期连续失败的工作流的根因与修法（构建产物被移出版本控制后，跨 workflow 缺重建步骤）。备选方案「短条目 + 记录文件链接」被否：本仓 CHANGELOG 惯例不向 `openspec/records` 链接，拆开后读者无法从发行索引到达根因说明。仓库对条目长度无门禁，`release-gate` 只要求 CHANGELOG 收口（残留见遗留 8） |

两条 Critical 的共同残留是同一格（**从未入域的新 job** 写成未枚举形态：形态计数不归零、无 floor 跳动、也无登记项可对账），它**没有**被机械守住 ⇒ 见遗留 6。裁决另记下一处**处方文案**问题：`STALE_REQUIRED` 的建议文案是「请删掉这条登记」，照做会把已被拦住的用例转成上述那一格（属文案质量，不在本 PR 内改）。不为残留扩启发式：扩宽会把漏检换成误判，而误报的终局是清空登记表（本仓已多次否决同类扩宽）。

## 遗留（不假装已闭合）

1. **oracle 的退出码语义**（本 PR 不改）：基线不可信（`ORACLE_NOT_AUTHORITATIVE`）与"确实没有引信"共用同一个 `rc=0`，机器无法区分二者。改成非零**不在本 PR**——把"非 0 即拦"做成常量红本身就是反模式（缺产物档确有一份负载/时序类红会让它常态变红），需另开 change 定义"权威性不足"的独立出口（如专用退出码 + 上级步骤显式判定）。本片只把**缺产物这条通路**堵掉，权威性判据本身的语义问题留着。
2. **首次受影响的 schedule = 2026-10-21（周三 18:00 UTC）**：合并后该工作流的首个 run 才是第一次真实验证；合并后按「(merge SHA, workflow)」回读，若因 `paths-ignore` 按设计不跑则如实记 `NO_RUN(by design)` 并转核该判据最近一次在 main 上的读数——**不把"没有 run"读成"证据丢了"**。
3. **`electron-ci` 自 `77598c4ac` 起连续 failure**，且它的测试步带 `if: github.event_name != 'pull_request'` ⇒ 本片与 #3837 的修复都**不能**用"PR 全绿"证明生效，只能等下一次 main push 的 `electron-tests` 档；判据自己在输出里为此留了两条 `[NOTE]`。
4. **登记表只是"谁在域内"的账，不是"产物是否被真正生成"的证据**：本判据是**静态装配**锁（读 workflow 正文），不执行构建、也不校验产物字节。运行期的产物存在性由各 job 自己的构建步承担（本片与 #3837 都只保证"该重建的 job 有一步重建"）。
5. **`nx-direct` 形态当前命中数为 0**（`MAX_FORM_COUNTS['nx-direct']=0`）：这是"仓库当前没有这种写法"的如实记录，不是"这种写法不需要重建产物"。它一旦出现就会进域（`MIN_FORM_COUNTS` 只在**掉到下界以下**时判自故障，用于区分"扫描器失明"与"仓库真的没有"），但**首次出现的那个 PR 必须自己确认产物依赖**——本条留给下一个会话读，不假装已经覆盖。

6. **i1/i2 的共同残留：从未入域的新 job 写成未枚举形态**（本 PR 不闭合）：真静默只剩这一格 —— 该形态计数不归零、没有 floor 跳动、也没有登记项可对账。三层补偿都是「失明会被**别的**判据抓到」，不是「失明不可能发生」；同类残留还有 `STALE_REQUIRED` 的**处方文案**（建议「删掉这条登记」，照做会把已拦住的用例转成这一格）。两者都不在本 PR 内扩启发式：扩宽会把漏检换成误判，而误报的终局是清空登记表。
7. **i3 的生产者写入器未归一化**（本 PR 只规范化本 PR 涉及的那一份）：写入侧两个点 —— `scripts/ccg-review-decider.js` 的两处 `JSON.stringify(record, null, 2)`（本版本该文件 L618 / L622）与深度审查引擎自写的 `critique-v1.md`。改它们属「门禁链上的写入器」，需要配用例与单独评审，且会让**每个后续 PR** 都带上一次全仓格式变更；另开单元，不在本 PR 内顺手改，也不从记录中隐藏。
8. **i4 的披露面缺口：CHANGELOG 条目长度无门禁**（本 PR 不改）：`release-gate` 只核验「版本 bump + CHANGELOG 收口 + 破坏性变更级别」，不校验条目长度；本条的长度判断（89.5 百分位、邻居 9–22 行、最大 4398 行）是**人工裁量**，仓库体例允许长尾。要机器守它得先定义条目长度口径与豁免，属改「谁来守门」，须人工过目。
9. **存档 critique 的第 5 条（Info 级）不进裁决面**（如实登记，无新增动作）：它不进 `items[]` 裁决面（逐字原文在本地归档 `critique-v1.md`），也不参与 `blocking`；其关切是「单文件 A/B（`apps/desktop/src/views/CreateView.test.js`，300/300）被推广成『全部桌面用例都不需要 preload 产物』」——本记录与 PR 正文都按**单文件口径**写明，不作该推广。

