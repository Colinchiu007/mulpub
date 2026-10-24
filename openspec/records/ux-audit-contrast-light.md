---
record: ux-audit-contrast-light
task: UX 审计阶段 4.1（audit-51）—— 语义色可读性判据从「只遍历暗色块」扩到两档主题，并把浅色档现状钉成只能缩小的台账；含 9 条变异反证
date: 2026-10-19
sync_pr: pending
sync_status: PENDING
sync_reason: 测试面变更（apps/desktop/src/styles）+ 文档，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：语义色对比度判据扩到两档主题（ux-audit-contrast-light，2026-10-19）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码面（`apps/desktop/src/styles/**`）⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-contrast-light`（非 C 盘），分支 `ux-audit-contrast-light`，由 `scripts/start-mp-task.ps1` 创建；依赖就绪三步实跑（`pnpm install --frozen-lockfile` → `ensure-electron` v43.7.7 → `verify-worktree-deps` 消费方解析通过 11 个）|
| 覆盖面测量先于判据 | ✅ | 当场逐格读数：8 个文字/语义色槽 × 两档主题 = **domain=16**，最差底取四档背景槽（canvas/card/inset/page）中的最小值；结果**暗色 8/8 全部 ≥5.13 通过**，**浅色 4 档不及格**（muted 2.65 / danger 3.18 / success 1.79 / warning 1.56）|
| 判据是不是"该量文字色"的前置核实 | ✅ | 先 `git grep` 确认这四个 token 在渲染端**是当文字色用的**（`color: var(--color-warning)` 等：warning 13 处、success 17 处、danger 28 处、text-muted 21 个消费文件），不是只当填充/边框 ⇒ WCAG 4.5:1 这条线适用。**这一步不能省**：若某色只当 badge 底，判据就该问"底上的字够不够"而不是"这个色对白底够不够"，写错方向会把设计空间焊死 |
| 自测 | ✅ | `vitest run src/styles/tokens.slots.test.js` → **20 passed / 0 failed**（本批新增 5 条）|
| 反证（9 条） | ✅ | CL-1…CL-9 全部 CAUGHT 且红在指名用例；控制跑 rc=0 / passed=20 / failed=0；`RESTORED_OK=true`（两份被测文件均逐字节还原）。其中 CL-6 首跑报 `ANCHOR_MISS(命中 0 次)` —— 因为我把台账值从 3.20 改成 3.18 后驱动锚点过期；**驱动把"锚点没命中"与"锁没牙"分成两档**，所以这一次没有演成"这条判据无效"的错误结论（复跑修正锚点后 CAUGHT）|
| 静态门禁 | ✅ | `check-locale-sync --cjk` PASS（本批无新增用户可见字符串，只有测试文件的中文用例名）；`check-debt-budget` PASS（域 10719，五项指标全在基线内）；`check-doc-abs-paths` / `check-no-brand-residue` / `check-record-qm5-rows` / `check-unwired-tests` 见下（提交后复跑）|
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/**` 与 `packages/rpa-engine/**` |
| QM-4 视觉回归 | **本批刻意零像素改动** | 只改测试文件与文档 ⇒ 渲染结果逐字节不变，基线新鲜度判据（`check-baseline-freshness.js` 要求每张受跟踪基线等于同一次 CI 渲染）不会被触发。**这正是本批不动颜色的理由**，见「三、为什么把判据和颜色拆成两批」|
| QM-6 双模型 | 未跑 | 本机无 CCG（pre-commit 实测打印「未找到 CCG，已跳过」），如实登记未执行 |
| 第一性原因（QM-5 ①） | ✅ | 不是"颜色选错了"这么简单：`tokens.slots.test.js:116-121` 那条 `≥4.5` 断言**只在暗色块上取数**（`dark[name]` vs `dark['--color-bg-card']`），浅色块从来没有被同一把尺量过 ⇒ 「浅色档不可读」在测试面上**不可表示**，所以它一直没人发现（审计原话即"回归锁只测暗色"）|
| 逃逸分析（QM-5 ②） | ✅ | ① 单元层：既有断言的域就是暗色块，浅色块零覆盖；② 像素层：像素门禁比的是"与基线是否相同"，对"这个配色本来就可读吗"完全失明 —— 一个恒不可读但恒一致的配色在像素门禁下永远是绿的；③ 现场审计层：`contrast-audit.js` 只在**强制 dark** 下遍历 computed style（脚本第 110 行 `setAttribute('data-theme','dark')`），浅色态不在它的域里；④ 人工审查：audit-51 是靠逐条读模板发现的。四类机制同时放过 ⇒ 单加一条测试不够，必须把**判据域**本身扩到两档 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 判据落在 `tokens.slots.test.js` 新增 describe：域由 tokens.css 实际取值派生（8 槽 × 2 档），底由 4 个背景槽取最差；四条断言分别守 域不塌方 / 台账键不漂移 / 实测与台账三方向对账 / 暗色档整体达标 |
| 防止再次发生（QM-5 ⑤） | ✅ | 台账设计成**三方向都有牙**：变差 → `CONTRAST_DEBTENED`；变好但不改台账 → `LEDGER_STALE_VALUE`（登记必须等于实测，防止"已修好却被当成还坏着"，与本仓 `check-debt-baseline-change` 的 R4 同一口径）；达标不销账 → `LEDGER_CLOSED_BUT_REGISTERED`。另加两条反失明断言：域长度必须 `== 槽数 × 2` 且每个取值必须是 6 位 hex（改名/换成 `color-mix()`/只在单档定义 都会当场红而不是静默少测一项），以及背景槽本身也逐个校验形态 |

## 一、实测矩阵（本批判据的现场读数，每次跑都会打印）

`[tokens-contrast] domain=16 booked=4`（下面这张表就是断言里 `console.log` 出来的同一份数）

| 槽 | 浅色值 | 浅色最低 | 暗色值 | 暗色最低 |
|---|---|---|---|---|
| `--color-text-strong` | `#1e1b4b` | 14.92 ✅ | `#f5f5f7` | 14.35 ✅ |
| `--color-text-primary` | `#1e1b4b` | 14.92 ✅ | `#e8e8ed` | 12.80 ✅ |
| `--color-text-secondary` | `#707080` | **4.54** ✅（只高出下限 0.04） | `#b4b2c6` | 7.53 ✅ |
| `--color-text-muted` | `#9898a8` | **2.65 ❌** | `#a9a7bd` | 6.66 ✅ |
| `--color-primary` | `#5048E5` | 5.77 ✅ | `#8b85ff` | 5.13 ✅ |
| `--color-danger` | `#ef5757` | **3.18 ❌** | `#f87171` | 5.65 ✅ |
| `--color-success` | `#34d399` | **1.79 ❌** | `#4ade80` | 8.97 ✅ |
| `--color-warning` | `#fbbf24` | **1.56 ❌** | `#fbbf24` | 9.36 ✅ |

最差底全部落在 `--color-bg-inset #faf6f8`（比卡片底 `#ffffff` 更差，也比页面底 `#f7f8fa` 略差）。
**这条读数与审计条目 audit-51 引用的 `2.65:1` 逐字对上** —— 判据与审计对齐才算对得上账；
如果本批按"只量卡片底"来写，读到的会是 2.84，与审计不同源，下一个人就无法判断谁对。

**一条必须留给下一个会话的贴脸读数**：`light:--color-text-secondary = 4.54`，只高出下限 **0.04**。
它现在是"通过"，但它是整个域里离地板最近的一格 —— **不得**把这 0.04 当余量去动 `#707080`
（想把它改浅一点点就会翻成新的欠账项，而翻成欠账需要重新登记台账，代价远高于收益）。
反过来说，这一格正是"判据扩到四档最差底"这条口径的价值所在：只量卡片底时它读起来是 4.86，看着很安全。

## 二、为什么判据取"四档背景里的最差值"

文字实际落在哪一种底上，是由消费组件的层级决定的，token 层看不出来。只量卡片底会漏掉
inset / page 上的文字（muted 在卡片底 2.84、在 inset 底 2.65）。取最差是**保守判据**：
过线就一定真的能读。变异 CL-8 专门把实现退化成"只量卡片底"，实测红在
`LEDGER_STALE_VALUE`（四档登记值全部低于只量卡片底的结果）⇒ 这条口径是有牙的，不是修辞。

## 三、为什么把判据和颜色拆成两批（本批不动颜色的真实代价与理由）

改 `--color-warning` 等四个 token 的取值**必然改变渲染像素**。本仓的视觉基线只能取自 CI 渲染
（AGENTS QM-4「基线必须与比对环境同源」），并由 `scripts/check-baseline-freshness.js` 断言每张受跟踪基线
**逐像素等于同一次 run 的 CI 渲染**。所以在同一个 PR 里既改颜色又留在 PR 侧全绿，是做不到的：
基线只能在改动落地、CI 渲染出来之后刷新。硬把它们塞进一个 PR，就是把「禁止用 `--update-baseline` 掩盖」
那条纪律拿去赌一次。

拆批的次序因此固定为：
1. **本批**：判据 + 台账（零像素风险，当场可合，从此"改差一点"和"改好了不登记"都会红）。
2. **下一批**：颜色修正 + 基线刷新同 PR，并把台账四条清空（销账即由 `≥4.5` 兜住）。

下一批的目标值已经算好（同色相、压到 ≥4.6 留余量，用 `#f7f8fa` 与 `#faf6f8` 两底取最差）：

| 槽 | 现值 | 单档压深的解 | 但**推荐解不是它** |
|---|---|---|---|
| `--color-text-muted` | `#9898a8` | `#6f6f7b` | 直接压深即可，muted 本来就只当文字用 |
| `--color-danger` | `#ef5757` | `#c24646` | 同色相压深会同时改掉 badge 底色和图标色 ⇒ 建议**拆文字档** |
| `--color-success` | `#34d399` | `#1f7f5c` | 同上 |
| `--color-warning` | `#fbbf24` | `#8d6b14`（琥珀→橄榄，观感明显变浑） | 同上 |

**推荐解**：为这三个状态色新增"文字档"孪生 token（如 `--color-danger-text`），
只把 `color: var(--color-danger)` 这一类**文字消费点**迁过去，badge/边框/图标的填充色保持不变。
理由是本仓已经量过同一族教训：`ep-theme.css` 把 EP 六档主色压成三个 token 后，
`--el-color-primary-light-5` 一档同时兼"底色 + 文字色 + 焦点环"，
任何"为了显淡"的调值都会把**文字**那半拖下水（实测 50% 淡化档作文字只有 2.39:1）。
**一档多职是压缩出来的固有产物**，所以修法是把职责拆开，不是把整档挪色。
这条设计取向需要确认（它会给 tokens 面加三个新键并牵动 13+17+28 处消费点的迁移范围），
因此本批只把它写成结论前的**待决项**，不代订。

## 四、9 条变异各证哪一格（全部实跑，红集互不相同）

| 变异 | 取的是哪个被禁形态 | 红在 |
|---|---|---|
| CL-1 | 浅色 warning 改得更浅 `#fbbf24`→`#fcd34d`（1.56→1.36） | 主矩阵 `CONTRAST_DEBTENED` |
| CL-2 | 浅色 muted 改好到 3.81 但不改台账 | 主矩阵 `LEDGER_STALE_VALUE` |
| CL-3 | 浅色 warning 直接达标（4.65）却不销账 | 主矩阵 `LEDGER_CLOSED_BUT_REGISTERED` |
| CL-4 | 新增一个未登记坏档（secondary → `#9ca3af`，2.39） | 主矩阵 `CONTRAST_UNREGISTERED` |
| CL-5 | 被量的槽改名成 `--color-success-renamed`（改名逃逸 / 域塌方） | `判据域不得塌方` + 键漂移 + 主矩阵 + 暗色达标（4 条，因为该键在两档都消失） |
| CL-6 | 台账键打错一个字母 `--color-dange` | `台账键必须仍在判据域内` + 主矩阵（该槽同时变未登记） |
| CL-7 | 暗色 muted 改深 `#4b5563`（2.07，把暗色拖下水） | `暗色档必须整体达标` + 主矩阵 + **既有的**暗色文字槽那条锁（三条独立出口） |
| CL-8 | 最低对比度退化成只量卡片底 | 主矩阵 `LEDGER_STALE_VALUE` ⇒ 证明"最差底"这条口径承重 |
| CL-9 | 把 `4.5` 下限调宽成 `1.0`（判据自身烂掉） | 主矩阵（四条登记项全部"已达标却挂着"） |

CL-7 有一条红落在**本批之前就存在**的锁上（`批次 2：暗色槽补齐与可读性`），这是好事：
说明两批判据在同一批取值上互相兜底，不是各守一片自留地。

## 五、刻意没做的事

1. **没有改任何颜色**（理由见第三节，代价是浅色四档此刻仍不可读 —— 台账把这件事变成"看得见、只能变小"的欠账，而不是一句散文）。
2. **没有新增 `--color-*-text` 孪生 token**：那是第三节那条待决项的实现，需要确认迁移范围后再做，不代订。
3. **没有动 `contrast-audit.js` 去覆盖浅色态**：那是真浏览器 computed-style 现场（要 dev server + CI 的 Chromium），
   属另一条链路；本批的判据是**源级**的（读 tokens.css 的声明值），两者互补而非替代。
   如实记下这个缺口：源级判据看不见"某组件其实用了硬编码色而非 token"，那由 `check-frontend-consistency.js` 的 colorLiterals 基线守。

## 远程同步

| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#NNNN)`，PR 号见本 PR 页面）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；把状态列预写成 `PASS` 会被 `prematureClaims` 判红（change: `ban-record-closure-backfill-pr` / `gate-record-sync-derived-status`）。main push 回读证据写在 PR 评论里，不写回本文件。 **本行的存在本身就是判据**：`check-gate-record-debt.js` 对「整块缺 远程同步 行」的新记录当场判红（本轮实测过：本仓两篇新记录因为只写了 frontmatter 的 `sync_pr/sync_status` 就被拦下，frontmatter 那几个键是**意图声明**，不能替代这一行）。 |
