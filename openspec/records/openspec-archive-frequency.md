---
record: openspec-archive-frequency
task: 归档 v5（publish-frequency-per-platform-intervals）并纠正 v1 PRD 的现在时错话与两处"常量在哪份文件"的错指
date: 2026-10-18
---

## 本次执行记录：openspec 频率规格归档第一批（openspec-archive-frequency，2026-10-18）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯规格/文档变更（`openspec/`、`01-docs/`、CHANGELOG），按 AGENTS 分层可在共享根就地编辑；但共享根当前被多个并发会话占用，本会话仍在隔离 worktree（`mp-worktrees/mp-openspec-archive-frequency`，分支 `openspec-archive-frequency`，由 `scripts/start-mp-task.ps1` 创建并回读 `git worktree list`=1、`rev-parse --abbrev-ref HEAD` 确认，rc=0 未作判据）内经 PR 落地。判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见下方「判定」行 |
| 第一性原因（QM-5 ①） | PASS | 两个独立根因：① **归档从来不在收尾链里** —— AGENTS「合并后收尾清单」6 步不含 `openspec archive`，所以每个 change 合并后目录就永久留在 `openspec/changes/`，其 delta 也从未并入主规格（实测 `openspec/specs/` 只有 `publish-frequency-control`，而 v2/v3/v4 的 delta 目录各自叫 `publish-frequency-policy-v2` / `-v3` / `publish-frequency-v4`，三个名字三套孤岛）；② **文档里的符号/路径未经 grep 就落笔** —— v1 PRD 两处把 `DEFAULT_MIN_ACCOUNT_INTERVAL_MS` 写成"`publish-contract.js` 的"，而 `export const DEFAULT_MIN_ACCOUNT_INTERVAL_MS` 全仓唯一落点是 `apps/desktop/src/features/publish/publish-schedule-contract.js:21`，`publish-contract.js` 确实存在但**不含**该常量（`grep -na MIN_ACCOUNT_INTERVAL` 在那份文件里 0 命中） |
| 逃逸分析（QM-5 ②） | PASS | ① 没有任何门禁检测「实现已合并但 change 未归档」，也没有检测「delta 从未并入主规格」——归类 流程缺失；② `check-docs-sync` 量的是 PRD↔代码的同步，不看规格归档态，所以归档积压对它完全隐形；③ "文档里的符号名是否存在"这一维只有learnings里那条纪律、无机械判据 ⇒ v1 PRD 的错指从 2026-10-02 躺到今天；④ 行 84/110 两处同错互相"印证"，读起来像有出处，属 [[feedback-inferred-causation-mutual-citation]] 的同型 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：① `openspec archive publish-frequency-per-platform-intervals -y` → CLI 打印 `Applying changes to openspec/specs/publish-frequency-control/spec.md: + 4 added`、`Totals: + 4`，主规格 Requirement 由 **6 条增至 10 条**（当场 `grep -c "^### Requirement:"` = 10），目录移入 `archive/2026-10-18-publish-frequency-per-platform-intervals/`；② `openspec validate publish-frequency-control --strict` → `is valid`；③ 归档前先把 v5 tasks 的 6.2/6.3/6.4 三格**按当场取证补勾**（merge SHA `29e5a60cdcedec8eadeccb3ad1f14061b6010e73` 由 `git log origin/main --grep='(#3753)$'` 取得、远端分支 `git ls-remote --heads` 返回 0 行、worktree 列表已无该任务目录），并把 6.3 注明"该回填通道已于 2026-10-17 被 #3879 取消"；④ v1 PRD 加「现行口径锚点」（逐平台表 `publish-frequency-account-interval.js:30-46`、档位表 `publish-frequency-policy.js:104-111`、基线 `:150-157`、`MAX_DAILY_QUOTA=5000` `:77`，全部当场回读），并纠 3 处现在时错话（状态行 / 归档后失效的关联路径 / 两处常量归属），历史数值**不改写**、只加限定语与出处。**回归保护本批未新增测试文件**（纯文档；这一类"归档积压"目前没有机械判据，见遗留） |
| 防止再次发生（QM-5 ⑤） | PASS | ① 本记录把「归档不在收尾链里」写成显式缺口，并把判据方向写明（可检测项：`openspec/changes/<x>` 的实现 PR 已 merge 但目录仍在 changes/ —— 需要一个"change→PR→merge"的归属推导，与 `scripts/lib/merge-ledger.js` 同族）；② 归档顺序已定：v5 先行（唯一把条款落到正确 capability 的一个），v2/v3/v4 必须先做 capability 改名 + 按现状重写再归档，否则 CLI 在 `specs-apply.js:219-221` 处 fail-closed（`target spec does not exist; only ADDED requirements are allowed for new specs`）——**这条拦截是好事**，正是"取不到读数不得当成通过"的形态，不得用 `--skip-specs` 绕过去把条款永远丢在主干外；③ 文档里的符号/路径落笔前先 grep 这条纪律，本次以两处实测错指再次坐实，已写入 [[project-mulpub-verification-seams]] 族；④ 不改任何判据与阈值（那属"谁来守门"，须人工过目） |
| 行尾与 diff 对账 | PASS | 被改的两个既有文件 `git ls-files --eol` 均为 `i/lf w/crlf attr=text=auto`（`01-docs/PRD-PUBLISH-FREQUENCY-CONTROL-2026-10-02.md`、`CHANGELOG.md`），驱动按文件探测 `nl` 后写回，实测 `lone_lf=0` 且改前后逐文件相等；`openspec/specs/publish-frequency-control/spec.md` 由 CLI 写（LF，未手工碰）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径提交前必须相等（见「判定」行下方实跑读数） |
| 接线棘轮 | N/A | 未新增任何测试文件 ⇒ `check-unwired-tests.js` 无新增命中；实跑 rc=0 作控制 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何渲染面或基线 PNG；改动全在 `openspec/` 与 `01-docs/` |
| QM-6 CCG 双模型外部评审 | 未执行 | docs-only 通道按 AGENTS 不强制 QM-6，且本会话**不以自审冒充双模型外部评审**。替代取证：派一只**严格只读**子代理做归档前提审计（A tasks 勾选实况 / B delta 是否已并入主规格 / C 目录内过期陈述 / D 归档风险与 validate 读数），其结论我逐条独立复核后才动手——本次复核坐实的有 `git ls-tree` 的 capability 孤岛名单、主规格 6 条 Requirement 的行号、v5 merge SHA、以及 `publish-contract.js` 不含该常量；被我发现需修正的是它把 PRD 的 10/30/60 说成"仅数字过期"，实际还错在**常量归属文件** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### 判定（docs-only 快速通道的取证）

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 提交后实跑读数记在这里（必须 commit 之后跑，未提交时 `HEAD==base` 会得空 diff 而假判 `docs-only=false files=0`）。

### 遗留（不假装已闭合）

1. **归档积压没有判据**：本批只清了 v5；`publish-frequency-policy-v2/v3/v4`、`publish-frequency-unwired-surfaces` 仍留在 `openspec/changes/`，
   而"实现已合并但没归档"这件事没有任何东西在看（v2/v3/v4 的归档另 PR 处理，见任务说明）。
2. **v2/v3/v4 的 capability 名各自为政**：并入主干需要先把目录改名到 `publish-frequency-control` 并把 MODIFIED 的目标标题对齐真实存在的 Requirement
   （v2 的两条 `间隔策略数值与档位`、`阻塞与失败的用户反馈文案` 在全部 137 份主规格里 NOT FOUND），且**必须按现状重写**——把 20/10/3 落进主干就是让规格说谎。
3. **v2 的 44 项勾选账未在本批处理**（审计给出 18/44，其中绝大多数是"做了未勾"，真残留 3 项：4.2 校准脚本无自测、5.2 PRD 失效标记（本批已顺带修掉）、0.5 跨家族复核未取得）——与归档同一次改，避免归档后 tasks 冻结。
4. **`scripts/calibrate-publish-frequency.js` 至今无测试、无 CI 接线**：AGENTS 明文「引用一个从不执行的判据等于没有判据」，这一格属真实缺口，不在本批顺手修。

## 本次执行记录：openspec 频率规格归档第二批（openspec-archive-frequency-v2v3v4，2026-10-18）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯规格/文档（`openspec/` + CHANGELOG），同一隔离 worktree `mp-worktrees/mp-openspec-archive-frequency` / 裸分支 `openspec-archive-frequency`，经 PR 落地。判定 `classify-docs-only.js --base=<merge-base> --head=HEAD` 实跑读数见「判定」节 |
| 第一性原因（QM-5 ①） | PASS | 与第一批同一条：**归档不在 AGENTS 的合并后收尾清单里**。实测三条后果：① v2/v3/v4 的 delta 目录分别叫 `publish-frequency-policy-v2` / `publish-frequency-policy-v3` / `publish-frequency-v4`，与主干真名 `publish-frequency-control` 无一对齐 ⇒ 归档必然 fail-closed（`specs-apply.js`：目标规格不存在时只允许 ADDED）；② 这些条款从未进主干，主干只有 v1 的 6 条；③ change 的 `tasks.md` 里"做了未勾"没人回头核，勾选表与事实漂移（v2 实测 18/44） |
| 逃逸分析（QM-5 ②） | PASS | ① 没有任何判据看「change 已实现但 delta capability 名与主干不一致」——这类命名漂移在 CLI 之前完全静默；② 没有任何判据看「tasks 勾了但没证据 / 做了但没勾」，本批用**只读代理逐项核 44 格**才暴露出 28 格未勾而实际已做、16 格确有缺项；③ 前置审计（同代理上一轮）给的"真残留只有 3 项"经我复核被**低估**：实为 14 PARTIAL + 2 NOT_DONE，且它个别行号坐标错（`definitelyNotSent` 实在 `publish-not-submitted.js` 不在 `task-queue-frequency.js`）⇒ 我只采信当场可复现的**符号名**证据，不采信行号 |
| 修复 + 回归保护（QM-5 ④） | PASS | ① **v2**：capability 目录改名 + delta 按现状重写（5 条 ADDED：提交阶段判定补 `definitelyNotSent`/`submitUncertain`/`_disableRollbackForPlatform` 三条 v3 起事实；日配额写 200/350/500 + `MAX_DAILY_QUOTA` 严格大于最大默认 + `MAX_ROLLBACK_PER_DAY`；抖动补 `DEFAULT_JITTER_RATIO` 与 setTimeout 钳位；未登记平台补 `checkBaselineStrength()` 自检；紧急放行补 10′ 冷却、每日 1/上界 10、四态含 `disabled`、真实 IPC 通道名 `publishFreq:emergencyRelease`），**删掉两条被 v3/v4/v5 推翻的 MODIFIED**（v2 的 20/10/3、平台档 2′ 落进主干就是让规格说谎；其语义由主干既有 `间隔维度与策略单一真源`/`间隔阻塞必须对用户可见` 与 v5 带入的 4 条承载）；tasks 28 格补勾 + 16 格留空但逐格写明缺什么。② **v3**：4 条里只重写「频率数值按档单一落点并可派生」→「单一落点与『档位 + 逐平台偏离』派生」（账号档归逐平台表、`long > clip > short` 单调只对未偏离平台成立、偏离集合必须被锁钉住），删掉 `{5′,3′,30}` 与「日配额恰为 v2 的 10 倍」两个过期 Scenario；其余 3 条机制条款原样保留；tasks 两格交付项按 merge SHA `469cf7b52…` 与三处 grep 命中补勾。③ **v4**：capability 改名，2 条 ADDED 保留，把原先无法应用的 MODIFIED **转写为 ADDED**「回落基线的两维不弱于判据（间隔取上界、配额取下界）」并删去 v4 数字（改指 `BASELINE_INTERVALS` 符号）。④ 结果：主干 `publish-frequency-control` 的 Requirement **6 → 10 → 15 → 19 → 22**，`openspec validate --strict` 每步都过，三个 change 目录进 `archive/2026-10-18-*` |
| 防止再次发生（QM-5 ⑤） | PASS | ① 本记录把「capability 名必须等于主干真名」写成显式规矩：delta 目录名与主干不一致 ⇒ CLI fail-closed 是**特性**，不得用 `--skip-specs` 绕（绕过去＝条款永远进不了主干）；② 归档前必须先做 tasks 的逐格取证补勾（归档后 tasks 冻结在存档里）；③ 本批的逐项判定表（28 DONE / 14 PARTIAL / 2 NOT_DONE）连同证据坐标一起落在 `tasks.md` 行内，下一个会话不必重跑审计；④ 不改任何判据/阈值（"给归档积压加一条门禁"属改谁来守门，见遗留，需人工过目） |
| 行尾与 diff 对账 | PASS | `openspec/changes/.../tasks.md` 与两个 spec.md 由驱动按文件探测行尾写回；提交前跑 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径必须逐字相等（实跑读数见「判定」节），删除行全部归因到被重写的数值段 |
| 接线棘轮 | N/A | 未新增测试文件；`check-unwired-tests.js` rc=0 作控制 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（改动全在 `openspec/` 与 CHANGELOG） |
| QM-6 CCG 双模型外部评审 | 未执行 | docs-only 通道按 AGENTS 不强制，且不以自审冒充外部双模型评审。替代取证：派**严格只读**子代理逐格核 44 项（要求凡"测试/门禁"类必须给 CI 点名证据；`packages/shared-utils` 与 `apps/desktop` 的测试经 `test:all:no-desktop` 由 nx 收集算被 CI 执行，`scripts/` 下必须逐个文件名点名 ⇒ 4.2 正是死在这条上），其结论我抽样复核 4 处后采用，并**修正了它两处行号/文件归属** |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导（只认 squash 尾注）；合并前写 `PASS` 会被判「预写不存在的证据」而红 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### 判定与实跑读数（docs-only 通道取证）

- `node scripts/classify-docs-only.js` / `check-doc-abs-paths.js` / `check-no-brand-residue.js` / `check-gate-record-debt.js` /
  `check-pr-exec-record.js --mode=enforce` / `check-unwired-tests.js` / `bash scripts/check-docs-sync.sh --base=main --head=<分支名>`
  的 rc 全部记在 PR 正文（提交后当场跑，不凭记忆）。
- **本批留下的两个可复跑读数**：主干 `grep -c "^### Requirement:" openspec/specs/publish-frequency-control/spec.md` = 22；
  `ls openspec/changes | grep -i frequency` 只剩 `publish-frequency-unwired-surfaces`（属 #69 那条 change，本批不动）。

### 遗留（不假装已闭合）

1. **v2 的 4.2 是真欠账**：`scripts/calibrate-publish-frequency.js` 无同名测试、workflow 未点名 ⇒ 按 AGENTS「测试没接进 CI 等于没写」这条从未成立；
   本批只把它写明为未勾，**没有**顺手补一个测试（那属另一片的扩面）。
2. **v2 的 7.3 视觉一格三处 0 命中**：record / `.quality-gates.md` / PR #3260 正文都找不到 QM-4 的痕迹，连"无基线以 DOM 锁承担并如实记录"都没写。
3. **v2 的 1.14 / task-queue.js:587 注释名实不符**：注释自称"结构锁"，实际只有行为锁。改注释属代码改动，本批不动运行面，登记待改。
4. **`publish-frequency-unwired-surfaces` 仍未归档**：它的 delta MODIFIED 指向主干真实存在的 `间隔维度与策略单一真源`，
   理论上可直接归档，但它属 #69 那条 change 的收尾，与 v5 归档的 4 条同指一个 capability ⇒ 需要一次"谁覆盖谁"的排序判断，留作下一批。
5. **归档积压依然无判据**：本批清了 3 个 change，但"实现已合并而未归档"这件事仍然没有任何东西在看。
