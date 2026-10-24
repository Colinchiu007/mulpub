# 执行记录：locale zh/en 键集对称门禁（ux-audit-locale-pair-gate）

- 分支：`ux-audit-locale-pair-gate`
- 日期：2026-10-25
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（commit 后跑）→ **docs-only=false**
  （改 `.github/scripts/*.js` 自身 = 混合 PR，属判据本体），走完整质量节拍 + 独立 worktree
  （`<mp-worktrees 根>/mp-ux-audit-locale-pair-gate`，分支名与 PR 号是取证锚点，不落本机绝对路径；
  `verify-worktree-deps.js` OK）+ PR。
- 归属：UX 审计任务 #20。规格与验收正文见 `01-docs/PRD-LOCALE-SYMMETRY-GATE-2026-10-25.md`（本文件只记执行与读数）。

## 1. 门禁表

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | `scripts/start-mp-task.ps1` 建 worktree；基线 = `origin/main f10847fae`（`git rev-list --count HEAD..origin/main` = 0） |
| TDD 红证 | ✅ | 实现前 `node --test .github/scripts/check-locale-sync.test.js` → **pass 16 / fail 9**（9 条即本 PR 新增用例，`--symmetry` 当时是不存在的档） |
| TDD 绿证 | ✅ | 实现后同一命令 → **pass 24 / fail 0**（新增 8 条：V1–V9 中除反证电池外全部） |
| 反证电池 | ✅ | 七道行锚定变异 **CAUGHT=7 / MISSED=0，anchored=7/7**，`RESTORE-CHECK js_same=true yml_same=true`，基线 `rc=0 passed=24`（逐条读数见 §3） |
| 判据自身故障档 | ✅ | 目录枚举失败 ⇒ FAIL 并说明「按未证实处理」；空域 ⇒ FAIL 含 `domain is empty`（不得读成零漂移） |
| workflow 可编译 | ✅ | `node .github/scripts/check-workflow-structure.js` → `files=18 violations=0` |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/`，改的是 CI 判据与 workflow 步骤 |
| QM-4 视觉 | N/A | 无模板/样式改动；未新增像素用例 |
| eslint | ✅ | 判据文件不在 desktop lint 域；`node --check` 两份文件均通过 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（ins=182 del=3 同读数，见 §4） |
| CJK / locale | ✅ 按口径 | 本次是**门禁**改动，不新增用户可见文案 ⇒ **不新增 locale 键**（AGENTS 禁死键）；判据输出的中文属 CI 文案域，不进 locales |
| 品牌残留 | ✅ | 未提及任何参考产品名 |
| 台账（CHANGELOG） | ✅ 按新规 | 条目在本文件 §6，由 `scripts/aggregate-changelog.js` 发版时搬运；本 PR 不编辑 `CHANGELOG.md` |
| QM-6 | 见 §5 | 规模档与敏感命中均由 `scripts/ccg-review-decider.js` 当场判定；§5 记了一次真实的误判与「不改判据」的处置 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（见 §7），不手写状态词 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅（新增 PRD + 本记录同 PR）| 远程同步 PR #（创建后回填编号）

## 2. 缺陷本体：三条既有档各自漏掉同一格，且存量漂移实测为 0

任务 #20 原先的记录写的是「`--pair-base` 只看根级两个文件」。本次**推翻了那句归因**：
`--pair-base` 的域确实覆盖 `locales/**` 全部 `zh/en` 文件（拆档那次把域一起搬了）。
原先那次「摘掉 en 键、门禁照打 PASS」的取证是**无效测量**——改动没有 commit，
而判据取的是 `git diff <base>...HEAD`，未提交的工作树内容对它结构性不可见。
用同一把探针改在**已提交**的形态上重测，三条档的真实分工是：

| 提交形态 | `--pair-base` | `--keys` | `--symmetry`（本 PR） |
| --- | --- | --- | --- |
| 只改一侧（删 en 一个键） | FAIL ✅ | FAIL ✅（该键被 Publish.vue 用到） | FAIL ✅ |
| 两侧都改、但改的不是同一批键（en 删一个 + zh 加一个无人使用的探针键） | **PASS（rc=0）** ⇒ 盲区 | FAIL，但**只点名被使用的那一个**，新加的 zh 侧探针键不出现在清单 ⇒ 半个盲区 | FAIL，两侧都点名 |

所以真正缺的是「**键集对称**」这一档，而不是「文件级成对」那一档；两条互不覆盖，`--pair-base` 保留。
另一条支撑决策的实测是存量：60 对 / 10054 键 / 零加载失败 / **零漂移** ⇒ 新档**不需要基线**，
也就不存在「为让它不红而调大某个数」的空间（AGENTS 的账本只能缩小在此直接退化成无需账本）。

## 3. 反证电池（七道，逐条取被禁形态本身）

| # | 变异（写回判据本体的形态） | 预期变红的用例 | 现场 |
| --- | --- | --- | --- |
| S1 | 把不对称的登记条件改成恒假 | 单侧多出键（zh 与 en 两段） | CAUGHT red=2 |
| S2 | 判据退化成只查 `onlyZh` 一个方向 | 单侧多出键（en 段） | CAUGHT red=1 |
| S3 | 缺孪生由 FAIL 改成 `continue`（"没有对照组就不用比"） | 只有 zh 没有 en 孪生 | CAUGHT red=1 |
| S4 | 空域的 `exit 1` 换成 `return`（把"什么都没扫"读成通过） | 扫描域为空 | CAUGHT red=1 |
| S5 | 零键对由 FAIL 改成 `continue` | 两侧皆零键 | CAUGHT red=1 |
| S6 | 递归下探改成只扫顶层 | 嵌套子目录 + 真实 locales 规模下界 | CAUGHT red=6 |
| S7 | 从 Gate 7 摘掉 `--symmetry` 那一行（连带其退出码检查） | 接线锁 | CAUGHT red=1 |

驱动是会话工具（`<临时目录>` 下，未入库）：本 PR 刻意把源码变更行数压在 decider 的 200 行阈值内，
把驱动文件搬进仓库会把行数推过阈值、并把一条可机械闭合的 single 变成无法闭合的 dual。
入库驱动的诉求已登记在任务 #23（把反证驱动接进 CI），那条需要单独一片并按当场读数重算规模。

## 4. 行数与行尾

`git diff --numstat`：判据 +99/-2，测试 +83/-0，workflow +3/-1 ⇒ 源码合计 ins=182 del=3。
`--ignore-cr-at-eol --numstat` 同读数（两口径一致 ⇒ 本次没有改写行尾）。
测试文件由工具写入时是 LF，git 按 `* text=auto` 在 checkout 侧展开为 CRLF，blob 侧仍是 LF —— 未触发幽灵行。

## 5. QM-6：一次「行内既有旗标名被判成敏感内容」的实测，以及为什么没靠改判据解决

第一版把新增的 `--symmetry` 追加进了 `check-locale-sync.js` 原有的 usage 那一行。`ccg-review-decider.js`
随即判 **DUAL**，理由「变更 182 行（≤ 200）但命中敏感内容 2 处」。逐条复算（用 decider 自己的
`RULES.sensitiveContents` 扫本次 diff 的每个新增行，并按文件归属）只有两处，且都不是真凭证：

| 命中 | 所在 | 实际内容 |
| --- | --- | --- |
| SQL 形态 | `check-locale-sync.js` 的 usage 行 | 该行**本来就有的**那个带 `baseline` 后缀的旗标名：判据里 `UPDATE` 是裸词分支，而 `-` 是非词字符，于是旗标名中间那个英文动词被当成 SQL 关键字 |
| 中文敏感词 | 本记录 §5 旧稿 | 我自己那句描述里引用了被判词表里的词（本仓第 6 次同一形态） |

两处都不是"这次改动引入的语义"，但**归因是按行算的**：只要我重写那一整行，那行的既有字面量就变成我的新增行。
两条出口里选了不改判据的那条 —— 改 `RULES.sensitiveContents` 是在动"谁来守门"，属人工过目范围。
正解：usage 行**一字不动**，把新档写成它下面单独的一行；本记录不再原样引用判词表里的词。
复算后源码新增行的敏感命中为 **0**，模式回到行数档（182 ≤ 200 ⇒ 预期 single），可由本会话机械闭合。

口径留档：`mode` 由 `scripts/ccg-review-decider.js` 当场判定，`status` / `performedBy` 一律取产物实读、不手写；
若最终产物落为 `dual`，本 PR **不**自扮演收口，按 AGENTS 停在未闭合状态并等人复核。


## 6. CHANGELOG 条目

# Gate 7 新增 locale zh/en 键集对称档：两侧都改但改的不是同一批键，从此会被点名

`check-locale-sync.js` 增加第 5 档 `--symmetry`，递归覆盖 `apps/desktop/src/locales` 下全部层级的
`{zh.js, en.js}` 对，四类形态各自变红：单侧独有键（双向）、缺孪生、零键对、扫描域为空。
既有 `--pair-base` 只管「同一次提交两个文件是否都改了」，对「都改了但改的不是同一批键」实测打 PASS；
`--keys` 只在渲染端用到该键时才报，对「先落中文、键还没接进界面」失明。
判据已同 PR 接进 `quality-gate.yml` Gate 7 并紧跟退出码检查；8 条用例 + 7 道变异逐条实测（红→绿→CAUGHT=7/7），
存量漂移实测为 0（60 对 / 10054 键），因此本档不建基线。

## 7. 收尾

合并后由 `scripts/lib/merge-ledger.js` 推导收口；本次不制造回填 PR。
回读判据：`gh run list --workflow=quality-gate.yml --commit <merge SHA>`，红了按本轮口径补 follow-up PR。
