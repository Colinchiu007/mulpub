---
record: freeze-legacy-gate-carrier
task: 把 .quality-gates.md 冻结为只读存档（哈希+计数基线、加块/删块判红、顶部棘轮退役），新 PR 记录载体统一为 openspec/records/
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（合并后按本仓回填口径取 merge SHA，并删本三字段；按新规矩**不再**回写旧载体与 ledger）
---

## 本次执行记录：冻结旧载体为只读存档（freeze-legacy-gate-carrier，2026-10-15）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 动了 `scripts/` 判据本体 ⇒ 混合 PR ⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-freeze-legacy-gate-carrier`、裸分支 `freeze-legacy-gate-carrier`（`git rev-parse --abbrev-ref HEAD` 实证），起点 `5952d38c2`；依赖经 `-NoDeps` 跳过（本轮判据只 require node 内置 `fs/path/crypto`，`node --test` 实跑不依赖 node_modules） |
| 第一性原因（QM-5 ①） | PASS | 不是"某处写错"，而是**载体设计**：每个 PR 都被要求往两个全仓共用的追加型文件写一笔，而共享主工作区只有一份工作树/index/HEAD。判据源码实测（`check-gate-record-debt.js`）表明这一步对机器判定是冗余的：记录文件源的登记读**自身 frontmatter**（`source:'records'`，`:285` 一带），ledger 只服务旧载体（`source:'legacy'`，`:205`）；`check-pr-exec-record.js:43` 的 `CARRIER_RE` 三种载体任一即可且注释写明"只 M 载体不带记录是红的" |
| 逃逸分析（QM-5 ②） | PASS | ①**判据层**：既有门禁只审"已存在的行是否收口"，对"这些行根本不必存在"完全失明——它 measure 的是说谎，不是冗余；②**规范层**：AGENTS.md 把插旧载体写成硬要求（docs-only 精简模板 + 「⛔ 两种形态必须同写」），于是没有任何会话质疑其必要性；③**审查层**：本日先合入的 `hot-carrier-atomic-landing` 也接受该前提去做"加测量/加拦截"，直到 QM-6 CONFIRMED 暴露"pre-commit 抓不到目标形态"，才回过去问"这个写面为什么必须存在" |
| 修复 + 回归保护（QM-5 ④） | PASS | 判据：`carrierDrift`（sha256 + 条数，注入式基线，CLI 才读生产文件）；测试 55 条（新增 6 条：一致不报漂移 / 加块判红点名 / 删块判红 / **只改状态行不得判红** / 缺基线与零基线必须抛错 / 未注入不得静默读生产），`node --test scripts/check-gate-record-debt.test.js` → 55 passed / 0 failed；真仓 CLI `node scripts/check-gate-record-debt.js` rc=0 |
| 防止再次发生（QM-5 ⑤） | PASS | ①AGENTS.md 新增「旧载体冻结」小节（**新增段落用追加**：该文件多会话共改，新写段落整段改写会造整文件冲突；④那四处属同一条规矩的另一端，只能就地限定，与"追加"不矛盾）；②本 change 的 spec delta 把"新 PR 不再写旧载体"与"关闭历史欠账仍走旧载体"两条同时钉进 requirement；③按已合入规格自己的退场条件，把 `hot-carrier-atomic-landing` 的 (2) 一条命令收口 /(3) pre-commit 拦截标为不实现，只留 (1) 事后测量；④**自查补出四处「规范原文仍在命令会话去写旧载体」并就地限定**（docs-only 精简模板 / 「回填与销账必须同一次提交」/ 合并后收尾清单第 3 步 / QM-6 评审记录落点）——只追加新小节而不改这四处，等于留下"AGENTS.md 叫你去写、判据拦你别写"的矛盾指令，下一个照规范做的会话必然被本判据判红 |
| 反证（变异） | PASS | 对判据本体做 3 条变异，**各让不同指名字用例变红**、还原后 md5 与改前一致、`escaped=0`：M1 从 `hasBlocking` 摘掉 `carrierDrift` ⇒「加块判红」红；M2 `carrierSignature` 哈希改成常量 ⇒「真仓冻结自检」红；M3 缺基线时静默 `return null` ⇒「必须抛错」红。M2 特意证明规模下界那条不是装饰（识别退化会造出"零漂移"假绿）。**第二批 3 条针对新加的接线锁**，先跑控制对照（未变异 56 passed / 0 failed）证明探针不恒红，再逐条：N1 摘掉 `.gitignore` 那条反选 ⇒「必须在库、不得被忽略」红；N2 把生成器**退回它真实出错过的写法**（自带 `/^## /`）⇒ 同一条红；N3 把生成器改名（不存在）⇒ 同一条红。三条各 `fails=1`、红集只含该用例、还原后 md5 一致、`escaped=0` |
| 行尾与 diff 对账 | PASS | 两口径 `numstat` 逐文件相同。**本轮另抓到并修掉自己两处行尾 bug**（同一族）：① 插入脚本按 `\n` 切 CRLF 文件后未剥行尾 `\r`，再用 `\r\n` join ⇒ 变 `\r\r\n` 双 CR，断言在 write 之前拦下（CR 2250 vs LF 1131）；② 早先给 ledger 手工拼 CRLF 留下不接 LF 的孤立 CR ⇒ git `text=auto` 对整份跳过归一化，1 行改动膨胀成 60/60 幽灵 diff，且**两口径一起爆**（所以那条对账只证膨胀、不证成因，必须另量 `git show :0:<path>` 的 CR/LF/CRLF 三者相等）。AGENTS.md 本轮全程纯行尾：工作副本 1150 行且 CR==LF==CRLF 三者相等，主干 blob 为 LF 1138 ⇒ 1138+12=1150 与"新增小节 12 行、就地限定 4 行不改行数"逐项对得上（净 diff 16 加 / 4 删，删除的 4 行逐条核对就是那四处被改写的原文） |
| 基线落地重取 | PASS | rebase 到 `origin/main` 后 `node scripts/check-gate-record-debt.js` 首次 rc=1 并点名新增两块（`fix-qm1-electron-run-as-node` / `publish-frequency-policy-v3`，均为**已合并的上游记录**、非违规）⇒ 按本 change 规格出路 ② 人工跑 `node scripts/freeze-gate-carrier.js` 重取：603/`5fed93f022ff…` → 605/`e47048f748ec…`；重取后 rc=0、测试 55/55。**这条红是判据第一次真实命中** |
| 接线棘轮 | PASS | 本 PR 不新增测试文件（改的是既有 `check-gate-record-debt.test.js`，该文件已由 `quality-gate.yml` Gate 2c 点名），故 `check-unwired-tests.js` 无新增欠账；生成器 `scripts/freeze-gate-carrier.js` 非测试文件。**但它是 `.js` 且落在 `.gitignore:106` 的 `scripts/*.js` 忽略域内**，不显式反选则 `git status` 里根本不存在、本地在盘跑得通而 CI 看不见（同 #3011 家族，本仓已第四次踩同一处）⇒ 已在 `.gitignore:382` 加 `!scripts/freeze-gate-carrier.js`，产物证据：`git add scripts/freeze-gate-carrier.js` rc=0；忽略面判据一律用 `git check-ignore --no-index -v`（第一版这里写成裸 `git check-ignore -v`，会把复跑的人带坑里：文件一旦 tracked，裸命令返回 rc=1 且**无输出**，看着像"探针没工作"；只有 `--no-index` 才回显那条反选）；基线 JSON `scripts/gate-carrier-freeze.json` 不在该 glob 内，且**刻意不放进 `CI_IGNORED_PATHS`**——进白名单就得按「前提锁」另登记它的校验落点，而它已在不被 docs-only 短路的 `changes` job 里被校验，加进去只会多一道维护并把"重取基线的 PR"误判成纯文档 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面 |
| QM-6 双模型外部评审 | PARTIAL（不假装 PASS） | **后端 claude**：首跑 rc=0 但交付物是一行 `API Error: 503 system cpu overloaded`（本机 CPU 92% 超网关阈值）⇒ 属"跑完但零交付"，已重跑，结论以重跑产物为准。**前端 opencode**：三次真跑 rc 全为 0，三次都只回 Objective/Work State 过程快照、没有 findings 载荷（第 3 次是我自己犯的引号嵌套把提示词打碎，不计入真跑）——按规格「3 次全败才跳过」计入跳过，**不得据此声称双模型已评审**。已从两份快照里取出它**自己验证过的事实**并逐条核对：①基线 JSON 不在 `CI_IGNORED_PATHS`（与自测一致）；②校验接在 `quality-gate.yml:65-66` 的 `changes` job、不被 docs-only 短路（与自测一致）；③**没有任何测试或门禁引用 `scripts/freeze-gate-carrier.js`** —— 这条是 Critical 级真命中，已在本 PR 内补接线锁 + 三条变异反证。四问的 ②③④由自查给证据（见「防止再次发生」④ 与「示范自证」下的顶部棘轮落点）。 |
| 远程同步 | PENDING | 待本 PR 合并后由后续 docs PR 取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间、`git ls-remote --heads origin freeze-legacy-gate-carrier` 返回 0 行证远端分支已删，并删除上方三个 `sync_*` 字段。**按本 PR 自己定的规矩：不再回写 `.quality-gates.md`、不再往 ledger 加/删键** |

- 保留门禁：变更类型与隔离 PASS（混合 PR 走 worktree）| 行尾对账 PASS（两口径逐文件相同）| 品牌残留 PASS（`check-no-brand-residue.js` rc=0，扫描 9214 个 tracked 文件）| 文档同步 PASS（被 CI 收编的 `node --test scripts/openspec-sync-check.test.js` 见下条；`openspec-sync-check.js` 本身的 14 条与干净 main 控制对照逐条同集 ⇒ 本 PR 净增 0）| 变异反证 PASS（3 条指名红、escaped=0、还原 md5 一致）| 载体自证 PASS（变更集不含 `.quality-gates.md` 与 ledger，见下节命令）| 远程同步 PENDING
- 两个 change 的 validate 均 rc=0（`hot-carrier-atomic-landing` 勾账后复跑 + `freeze-legacy-gate-carrier` 新建）
- 顶部棘轮退役后「最新一篇必须有收口」由谁承担（不是散文，是两条仍在拦截面上的判据）：`check-pr-exec-record.js` 要求每个 PR **携带新增执行记录 ≥1 篇**（本 PR 现场打印 `新增记录 1 篇 / 载体M=0`），键就是 `openspec/records/<分支名>.md` 的文件名；旧载体不再增长 ⇒ "顶部"这个概念测量对象消失，而非把判据降级成约定。缺行/矛盾另有 `missingRecordRows`、`statusContradictions` 两条在拦截面上兜记录文件源
- 静态门禁按 **CI 点名的原样路径**逐个跑过（不是按目录猜）：`check-unwired-tests`(88 个测试文件) / `check-no-brand-residue`(9254 个受管文件) / `check-no-conflict-markers` / `check-record-qm5-rows` / `check-spec-purpose`(153 份主规格) / `check-step-failfast`(35 个多命令步骤) / `check-changelog-growth` / `check-changelog-duplicate-entries` / `check-text-encoding-integrity` / `check-renderer-cjs-boundary` / `check-visual-coverage` / `check-gate4-selection` / `.github/scripts/check-workflow-structure` / `.github/scripts/check-ps1-bom` 均 rc=0；`check-baseline-freshness` / `check-clock-shift-oracle` / `check-desktop-shard-forwarding` 本机不可复现，点名交给 CI（不得当成通过）
- **`check-doc-abs-paths` 本机 rc=1，不认领，附对照证据**：它报「超出存量基线 15 个文件」，15 个全是他人文件（`01-docs/DEEP-ANALYSIS-KNOWLEDGE-BASE.md`、`openspec/records/blanket-fs-mock-ratchet.md` 等），我的 13 个改动文件 0 命中。对照：把 diff 取成空（`--base=origin/main --head=origin/main`，扫 435 个文件）报的是**同样那 15 个**、同样是 103 个待收紧 ⇒ 与本 PR 无关。维度在该判据把「绝对路径在磁盘上是否存在」算进计数，本机 worktree 清单位与 runner 不同（如 `D:\Data\projects\mp-worktrees\mp-fix-newtab-home-slow` 在我机器上不存在）——属本机不可复现那一档：不代他人收口，也**不得**为让它变绿去动它的基线

### 示范自证（本 PR 必须自己守自己提的规矩）

判据 `carrierDrift` 生效前，`.quality-gates.md` 有 605 个记录块（初取 603，rebase 后按判据自己报的红重取，见 tasks 1.1）。本 PR **刻意不碰它**：若本 PR 按旧惯例往顶部插一块，就会立刻被自己刚加的判据判红。合并前用一条命令自证：

```
git diff --name-only origin/main..HEAD | grep -E '^(\.quality-gates\.md|scripts/gate-record-debt-ledger\.json)$'
```

期望输出为空。这条同时是 tasks 2.4 的证据。

### 遗留（不假装已闭合）

- 主规格尚未同步：`openspec/specs/openspec-integration/spec.md:123/:131` 仍写着"可就地编辑 …… `.quality-gates.md`"，要等本 change 归档时才落基线（tasks 2.2/2.3 未勾）。在归档前，判据比规范严——这是安全方向（判据拦住、规范滞后），但必须留痕，否则下一个会话会拿规范当豁免理由。
- 归档顺序与 `hot-carrier-atomic-landing` 冲突：两条 delta 都 MODIFY 同一个 requirement，本 change 应先归档，另一条再按新基线重述（已在 delta 里写明）。
- (1) 事后测量（守卫侧开窗/收窗读数）未实现 ⇒ 当前只有"拦住"，没有"是否还有人试图改"的读数（tasks 3.2）。
- **本机钩子会改写主干上已存在的同名判定产物**（2026-10-15 rebase 时实测）：pre-commit 的 `ccg-gate.js` 把这次 DUAL 判定写进 `.ccg/reviews/<提交前 HEAD 的父 SHA>.json`，而该路径在 origin/main 上已由 #3649 落过一份（记的是别人的 `mode: skip`）。rebase 表现为 **add/add 冲突**（不是静默改写——因为我的基线早于那份提交），正解取主干那份（`git checkout --ours`），md5 与主干逐字节相同、PR 净 diff 不含该路径。**不得**用自己这次的判定覆盖他人历史判定。
- **一处潜在的写面复活源（本 PR 未拦、也未修）**：`.quality-rhythm/installer/husky/pre-commit.js:56` 带 `gatesFile: ".quality-gates.md"` + `recordMarker: "## 本次执行记录"`，即那份 vendored 安装器一旦在别处被真的装进钩子，就会自动往旧载体插块 ⇒ 立刻被本判据判红。当前**不在活动路径**：已安装的 `.git/hooks/pre-commit` 是 `scripts/hooks/pre-commit`（bash 版，不写旧载体），全仓对那份 JS 的引用只有 `scripts/ccg-gate.js:9` 的一句注释（"门禁力度与之保持一致"），不执行它。留待有人真要去装 husky 钩子时再收口——届时正确动作是改那份 installer 的落点，不是放宽冻结判据。
- 25 条历史欠账仍需各自会话关闭，本 PR 不代改他人记录。
