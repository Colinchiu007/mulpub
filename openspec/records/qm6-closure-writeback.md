---
record: qm6-closure-writeback
task: 8.1b 第三刀——把"补跑真评审"这条出口从装饰性变成可达（vendor 严重度终态 + 仓侧探针⑤ + 第 3 轮深审逐条处置）
date: 2026-10-22
---

## 本次执行记录：8.1b 第三刀（qm6-closure-writeback，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（`scripts/ccg-review-writeback.js`、`scripts/deep-review.sh`、`scripts/ccg-convergence-probe*.js`、`scripts/deep-review-entry-rc.test.js`）⇒ 在隔离 worktree `<仓库父目录>/mp-worktrees/mp-qm6-closure-writeback`（AGENTS Gate 12c：写现场一律用占位符，取证力靠分支名与 PR 号，不靠本机绝对路径）、裸分支 `qm6-closure-writeback`，起点 `85dc44ddc`；`git worktree list` 命中 + `rev-parse --abbrev-ref HEAD` 回读同名 |
| 与主干并行世代的关系 | ✅ | 主干 #4151 已落本片的**另一代实现**（`run_driver_with_writeback`、`{wrote,reason,spoke}` 形状、CI 态夹具自带 wrapper/后端桩）。整取本分支原样会静默删掉主干 1767 行（实测 `git diff --numstat` added=2469 / deleted=1767）⇒ 指针移回主干那代，只重放主干确实没有的格；被取代的那代留在标签 `retire/qm6-closure-writeback-20261022b` |
| 为什么"补跑真评审"原来是装饰性出口 | ✅ | 真跑一轮（critic=claude 交付 8 条、最低维度分 4）暴露：验证层单轮跑完把结论交 `convergenceDecision`，那函数只认 `minScore >= scoreThreshold` ⇒ 出 `converged`，而本仓闭集 `{cleared, needs_revision, self_play_resolved}` 不含它。当场重测（`origin/main@96ef1b2e2`，`.ccg/reviews` 下 json 共 1836 份）：`"status": "converged"` = **0**、`"stoppedBy": "converged"` = **3**（那 3 份 status 已是 cleared，出自决策层）；取证命令逐字写在 design §12.2 |
| vendor 侧改动（用户授权） | ✅ | 仓外 `ccg-deep-review.js` 验证层按严重度出终态；备份 `ccg-deep-review.js.bak-severity`；`node --check` 通过。**第 3 轮 i3 后又摘掉了 High 那一格**：vendor `model-call.js:191` 的 `SEVERITY_WHITELIST = ['Critical','Warning','Info']`，白名单外的 severity 让那次评审当场失败 ⇒ `High` 出现 0 次，给不可达状态编放行规则就是把"不可达"写成"可达" |
| 仓侧可达性探针 | ✅ | `scripts/ccg-convergence-probe.js` 第 ⑤ 格：真 `require` 驱动、真调用那个函数（三形状），三档退出码不混（在位=0 / 不在位=1 点名「严重度」/ require 不动=2 点名「探针失明」）；白名单内容由 `ccg-convergence-probe.test.js` P9 钉死，读不到 `model-call.js` 一律红、不得 skip |
| 写回器补齐（本片本体） | ✅ | `assertRecordPathScope`（`..` 段与非 `.json` 在任何 IO 之前抛错）、`DECLINE_REASONS` 常量表 + 与规格那张表逐名对账、`--dry` 档打印将写的 `delivery@` 后按动手前快照还原 |
| i5（第 3 轮）：dry 还原自证 | ✅ | `deep-review.sh` 还原后**再算一次哈希**与动手前逐字比对，打印 `dry-restore=verified sha256=<12>`；不等时 `dry-restore=mismatch` 并把两侧哈希都打出来、**保留快照不删**。入口级行为锁 ⑫ 真跑 `sh scripts/deep-review.sh --writeback-dry`（含"不带旗标同一场景必须真的落盘"的反向对照）。⚠ 未锁的那一格如实记：mismatch 支路只在并发写者介入时到达，本机没有并发夹具 ⇒ 该支路无执行体，只有正控被 ⑫ 守住 |
| TDD / 变异反证 | ✅ | 本机套件：writeback + probe `# tests 35 / pass 35 / fail 0`；entry-rc 见下表（⑫ 为本片新增）；第二代变异驱动 N1–N12 见 tasks §13（第一代 M1–M8 的锚点在本代树上逐条实测 0 命中，故不复用其数） |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/`、`packages/rpa-engine/`，无产物变化 |
| QM-4 视觉 | N/A | 零 UI 文件 |
| QM-6 CCG 双模型外部评审 | 见下两行 | 判定器对本片差量判 `DUAL`（`变更 327 行 > 200 行阈值`）；本片命中的高危面前缀：`scripts/ccg-review-`、`scripts/deep-review`、`scripts/check-`（判据本体未改，但入口/写回器本体改了） |
| QM-6 第 3 轮实跑读数 | ✅ 拒绝路径已被生产入口点亮 | `sh scripts/deep-review.sh`（HEAD=`083599b94`，判定记录按内容寻址命中 `550a0208…`）：critic=claude 8 条（Critical 2 / Warning 3 / Info 3）、最低分 4 ⇒ `status=self_play` ⇒ 裁决模板 5 条待填、其中 1 条高危域（crypto）必须外部复核 ⇒ 未填时入口打印 `裁决未填写 … 状态记为 self_play_pending`，写回器打印 `未写回 reason=not-closed spoke=- detail=status="self_play_pending"`，`DR_RC=0`（旁路语义：写回没成不改评审 rc）。**这正是"五条件不齐一个字都不写"的现场证据** |
| QM-6 收口（本片自身） | PENDING-DRIVER | 收口值 MUST 由本片落地的写回器产出，不得手写（tasks 7.2 的自反检验）。处置完 Critical 后的重跑读数与 `tier=external` / `evidence=delivery@…` 写在本篇末尾「收口读数」小节；拿不到就如实记拿不到与原因，不借道手写 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相等（openspec 与 scripts 均核对过）；`deep-review.sh` 是 `attr:text eol=lf`，其余为 `i/lf w/crlf`；插入行按该文件自己的行尾写回，插后校验 CR/LF 计数守恒 |
| 旧载体冻结 | ✅ | 未向 `.quality-gates.md` 插块、未向 `scripts/gate-record-debt-ledger.json` 加键 |
| 品牌残留 / 文档同步 / 绝对路径 | ✅ | `check-no-brand-residue.js` PASS（扫描 11628 个 tracked 文件）；`check-doc-abs-paths.js` PASS（全量审计 5170 个受管文件、现场存量 1161 处按文件对齐）；引擎路径一律写 `~/.claude/...` 占位形态 |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导 |
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false files=9`（混合 PR，走完整质量节拍）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #4148

### 收口读数（合并前只填机械读数，不填状态词）

- 判定记录：`.ccg/reviews/<stagedDiffHash>.json`（内容寻址，非 commit sha）
- `deepReview.tier` / `evidence`：由 `scripts/ccg-review-writeback.js` 在驱动返回后写入；本轮最终读数见 PR 评论

### 遗留（不假装已闭合）

1. **tasks 7.2 的自反检验还没走完**：第 3 轮把两条 Critical 处置干净并重新提交后，需要**再跑一次真评审**，看驱动能否把 `tier=external` + `delivery@` 写进本片自己的判定记录。写不进去就是本片没跑通，正确反应是修代码，不是手写那两个字段。
2. **`normalize-only` 已裁决：MUST NOT 落盘**（第 4 轮 i2 把这格从"待裁决"改判成"措辞问题"；理由是落盘与三条在 CI 上的"逐字节不变"用例直接矛盾）。裁决写在 spec 与 design §14，历史那节（§12.3）不改写。
3. **更强的作用域判据仍没做**（tasks 8.8）：前提是先迁约 30 处主干夹具到生产同形目录。
4. **跨仓 parity 锁（tasks 5.1–5.3）不在本片**：`scripts/ccg-review-parity.test.js` 至今没有实现，规格 §5 三条仍未勾。本片不声称它存在。
5. **变异反证不进 CI**：驱动是一次性本机工具（未入库），所以 QG Changes 那 5 分钟作业预算与它无关；代价是这条反证只能靠人/会话重跑——本片的 i2 正是被这个代价打中的（引用了上一代的 12 条数）。
6. **`--allow-different-landing` / 自动合并**：本片命中三条高危面前缀，属"改谁来守门"，一律人工过目，不自动合并。
7. **第 4 轮深审（`ebe10ff8e`）又含 3 条 Critical**：i1（探针 require 无路径限制，已补 realpath 许可根判定）、i2（normalize-only 契约矛盾，改判为措辞问题并已裁决）、i3（作用域判据偏弱，登记在 tasks 8.8 不当场采纳）。逐条归因见 design §14。
   ⇒ 本片的 QM-6 机械出口只有一条：**一轮零 Critical 的评审**。连跑两轮都不为零，所以收口仍未闭合（tasks 14.5），不手写 `tier`/`evidence`。
7b. **第 5 轮（`95d13f431`）又含 3 条 Critical，其中 2 条确实是我的**：i2（`DECLINE_REASONS` 只导出不用，实现侧仍散在 11 个 return ⇒ 已改成 `decline()` 唯一出口）、i6（探针复核 driver 却不复核 engine ⇒ 已补）；另含 i7 一条恒不作用的冗余判据（已删）。逐条归因见 design §15。三轮累计：Critical 2 / 3 / 3，最低分 4 → 4 → 3。
