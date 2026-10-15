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
| 防止再次发生（QM-5 ⑤） | PASS | ①AGENTS.md 新增「旧载体冻结」小节（**追加**而非改写：该文件多会话共改，改写即造整文件冲突）；②本 change 的 spec delta 把"新 PR 不再写旧载体"与"关闭历史欠账仍走旧载体"两条同时钉进 requirement；③按已合入规格自己的退场条件，把 `hot-carrier-atomic-landing` 的 (2) 一条命令收口 /(3) pre-commit 拦截标为不实现，只留 (1) 事后测量 |
| 反证（变异） | PASS | 对判据本体做 3 条变异，**各让不同指名字用例变红**、还原后 md5 与改前一致、`escaped=0`：M1 从 `hasBlocking` 摘掉 `carrierDrift` ⇒「加块判红」红；M2 `carrierSignature` 哈希改成常量 ⇒「真仓冻结自检」红；M3 缺基线时静默 `return null` ⇒「必须抛错」红。M2 特意证明规模下界那条不是装饰（识别退化会造出"零漂移"假绿） |
| 行尾与 diff 对账 | PASS | 两口径 `numstat` 逐文件相同。**本轮另抓到并修掉自己两处行尾 bug**（同一族）：① 插入脚本按 `\n` 切 CRLF 文件后未剥行尾 `\r`，再用 `\r\n` join ⇒ 变 `\r\r\n` 双 CR，断言在 write 之前拦下（CR 2250 vs LF 1131）；② 早先给 ledger 手工拼 CRLF 留下不接 LF 的孤立 CR ⇒ git `text=auto` 对整份跳过归一化，1 行改动膨胀成 60/60 幽灵 diff，且**两口径一起爆**（所以那条对账只证膨胀、不证成因，必须另量 `git show :0:<path>` 的 CR/LF/CRLF 三者相等）。AGENTS.md 插入实测改前改后 CR==LF==1131/1119 |
| 接线棘轮 | PASS | 本 PR 不新增测试文件（改的是既有 `check-gate-record-debt.test.js`，该文件已由 `quality-gate.yml` Gate 2c 点名），故 `check-unwired-tests.js` 无新增欠账；生成器 `scripts/freeze-gate-carrier.js` 非测试文件。**但它是 `.js` 且落在 `.gitignore:106` 的 `scripts/*.js` 忽略域内**，不显式反选则 `git status` 里根本不存在、本地在盘跑得通而 CI 看不见（同 #3011 家族，本仓已第四次踩同一处）⇒ 已在 `.gitignore:382` 加 `!scripts/freeze-gate-carrier.js`，产物证据：`git add scripts/freeze-gate-carrier.js` rc=0 且 `git check-ignore -v` 回显命中的是这条 negation 本身；基线 JSON `scripts/gate-carrier-freeze.json` 不在该 glob 内，无需放行 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面 |
| QM-6 双模型外部评审 | PENDING | 本机 `codeagent-wrapper` 在 PATH；混合 PR 属强制面，合并前跑 claude（backend）+ opencode（frontend）双路，findings 逐条先取证再处置并回填本行 |
| 远程同步 | PENDING | 待本 PR 合并后由后续 docs PR 取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间、`git ls-remote --heads origin freeze-legacy-gate-carrier` 返回 0 行证远端分支已删，并删除上方三个 `sync_*` 字段。**按本 PR 自己定的规矩：不再回写 `.quality-gates.md`、不再往 ledger 加/删键** |

- 保留门禁：变更类型与隔离 PASS（混合 PR 走 worktree）| 行尾对账 PASS（两口径逐文件相同）| 品牌残留 PASS（`check-no-brand-residue.js` rc=0，扫描 9214 个 tracked 文件）| 文档同步 PASS（被 CI 收编的 `node --test scripts/openspec-sync-check.test.js` 见下条；`openspec-sync-check.js` 本身的 14 条与干净 main 控制对照逐条同集 ⇒ 本 PR 净增 0）| 变异反证 PASS（3 条指名红、escaped=0、还原 md5 一致）| 载体自证 PASS（变更集不含 `.quality-gates.md` 与 ledger，见下节命令）| 远程同步 PENDING
- 两个 change 的 validate 均 rc=0（`hot-carrier-atomic-landing` 勾账后复跑 + `freeze-legacy-gate-carrier` 新建）

### 示范自证（本 PR 必须自己守自己提的规矩）

判据 `carrierDrift` 生效前，`.quality-gates.md` 有 603 个记录块。本 PR **刻意不碰它**：若本 PR 按旧惯例往顶部插一块，就会立刻被自己刚加的判据判红。合并前用一条命令自证：

```
git diff --name-only origin/main..HEAD | grep -E '^(\.quality-gates\.md|scripts/gate-record-debt-ledger\.json)$'
```

期望输出为空。这条同时是 tasks 2.4 的证据。

### 遗留（不假装已闭合）

- 主规格尚未同步：`openspec/specs/openspec-integration/spec.md:123/:131` 仍写着"可就地编辑 …… `.quality-gates.md`"，要等本 change 归档时才落基线（tasks 2.2/2.3 未勾）。在归档前，判据比规范严——这是安全方向（判据拦住、规范滞后），但必须留痕，否则下一个会话会拿规范当豁免理由。
- 归档顺序与 `hot-carrier-atomic-landing` 冲突：两条 delta 都 MODIFY 同一个 requirement，本 change 应先归档，另一条再按新基线重述（已在 delta 里写明）。
- (1) 事后测量（守卫侧开窗/收窗读数）未实现 ⇒ 当前只有"拦住"，没有"是否还有人试图改"的读数（tasks 3.2）。
- 25 条历史欠账仍需各自会话关闭，本 PR 不代改他人记录。
