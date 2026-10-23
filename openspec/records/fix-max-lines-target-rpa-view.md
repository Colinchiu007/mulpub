---
record: fix-max-lines-target-rpa-view
task: 修主干「逐文件行数门禁」红：上调 rpa-view-platforms.js 的名点目标并写明理由
date: 2026-10-23
---

## 本次执行记录：上调 rpa-view-platforms.js 名点目标以修主干红（fix-max-lines-target-rpa-view，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码（CI 门禁数据） | 隔离 worktree `mp-fix-max-lines-target-rpa-view` + 裸分支 `fix-max-lines-target-rpa-view`（D 盘）；共享根保持 main + 原有改动不动（另有会话正在改 `01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md`，规范入口因此拒绝建 worktree，本 PR 改用底层 `git worktree add -b <branch> origin/main`，显式以 origin/main 为基点，不触碰共享根的 index 与工作区） |
| 第一性原因（QM-5 ①） | 1 条 | PR #4276「fix(toutiao): click add-video before upload」给 `apps/desktop/electron/services/rpa-view-platforms.js` 新增头条「添加视频」按钮的轮询点击逻辑（14 行，含注释），文件由 1483 行涨到 **1497** 行，越过该文件在「点名还账」清单里的**零容差**目标 1484 ⇒ 主干 push 的「逐文件行数门禁」判 `TARGET_GREW`，主干自此红着（`run 39926645517` 失败格：`债务熔断检查`） |
| 逃逸分析（QM-5 ②） | 2 环 | ① **两侧口径不一致这件事要到门禁真判红才看得见**：同一文件的「登记侧」（`files` 1422 + 200 行容差 = 1622）**根本没被违反**，只有「点名侧」（`targets` 1484，零容差）被违反 ⇒ 合并前看任何一侧都看不出问题；② 合并 #4276 的那趟 PR 侧 CI 跑的是 **PR 差量**的门禁（文件在 PR 差量里是未改动的），`TARGET_GREW` 只在**合并后的主干 push**上才出现 ⇒ 「PR 全绿」不等于「主干不红」，红是合并之后才诞生的 |
| 修复 + 回归保护（QM-5 ④） | `targets` 1484→1497 | 门禁提示里写明的出口：「在 review 中说明理由后一并上调 targets」；**上调量 = 实际增量 +13，不给余量**；理由写进台账 `//` 注释（与 2026-10-20、2026-10-23 两条先例同格式，且**两侧口径分别列明、不混用起点与 delta**） |
| 防止再次发生（QM-5 ⑤） | 2 道 | ① 台账 `//` 注释逐条记录上调理由、两侧口径与后续正确做法（拆分而非回退功能）；② **0 容差保持不变** —— 本次上调只解决「PR #4276 的功能必需增量」，该文件再涨 1 行仍会被当场拦下（不靠这次上调掩盖后续漂移） |
| 行尾与 diff 对账 | PASS | 两口径 numstat 逐文件一致（提交前现测） |
| 接线棘轮 | N/A | 未新增 `*.test.js`；门禁脚本本体未改，只改台账数据（`.github/scripts/max-lines-baseline.json`） |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 只改门禁台账数据，未触运行面（无打包、无样式/路由变更） |
| QM-6 CCG 双模型外部评审 | 已跑（第 4 轮），逐条处置见「## 评审」 | 后端实测可跑：critic=**claude**（anthropic 家族）、proposer=**opencode**（deepseek/hy3 家族），**跨家族校验通过**。本 PR 被判定器判为 **DUAL**（4 行改动但命中 2 处敏感内容 ⇒ 强制双模型深度审查），已按要求跑完：critic 给出 **4 条**（correctness 4 / security 5 / performance 8 / maintainability 5，最低分 4），其中 **1 条高危域（`auth`）**。高危域**不接受自扮演豁免** ⇒ 外部复核由 critic=claude 完成，第 4 轮原始输出**逐字公开**于 PR 评论（`externalReview.evidenceRef` 指向该评论 URL） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；合并后 main push 的回读证据写在 PR 评论里，不写回本文件 |

### 做了什么（用户视角）

- 主干重新变绿：合并后主干 push 上的「债务熔断检查」不再因 `rpa-view-platforms.js` 越界而判红，
  后续 PR 不再被这条既有红挡住。
- 头条「添加视频」按钮的修复**保留**（本 PR 不回退任何功能代码，只把该文件的名点目标抬到它当前的实际行数）。
- 这次上调**不是永久额度**：该文件仍挂账待还、仍是 0 容差；想真正降回目标值，正确做法是把
  toutiao 专有的「添加视频」轮询点击块拆到独立模块，而不是回退功能。

### 证据链

| 事实 | 取证坐标 |
|---|---|
| 主干红着 | `run 39926645517`（债务熔断门禁，main@`c83be3c33`）失败格：`TARGET_GREW: apps/desktop/electron/services/rpa-view-platforms.js 现 1497 行已超过点名目标 1484 行（超 13）` |
| 增量来源 | `git show f84e1f79f -- apps/desktop/electron/services/rpa-view-platforms.js` = PR #4276，14 行新增（头条「添加视频」按钮轮询 + 注释），文件 1483 → 1497 |
| 两侧口径 | `files`（登记侧）= 1422 → 1422 + 200 容差 = 1622 ≥ 1497，**未被违反**；`targets`（点名侧）= 1484 → 1497，0 容差，**被违反** ⇒ 只动 targets 侧 |
| 修复后读数 | `node .github/scripts/check-max-lines.js` → `✅ 无新增超大文件，挂账清单与现实一致` |

### 遗留（不假装已闭合）

- **该文件仍未还债**：1497 行 > 500 行上限，且在点名清单里（0 容差）。降回目标值的正确做法是把
  toutiao 专有的「添加视频」轮询点击块拆到独立模块（与 `story2video-compose-engine.js` 的拆分同型）——
  那是另一个 PR 的事，本 PR 不做（也不应在此回退刚上线的功能）。
- **PR 侧全绿 ≠ 主干不红**：这次的红是「合并后才在主干 push 上诞生」的。若后续再有类似情况，
  判据仍是「有人修 main」——不是把这条差集当已解释。
- **两侧一致性的自动化校验**（外部评审 i4，Info）：台账里 `files` 与 `targets` 两侧的口径一致性
  目前只靠注释人工保证。补一条 CI 校验（如「对每个被点名的文件验证 `files + 200 ≥ targets`」）
  要改门禁脚本本体（判据自指面），属跨仓工程决策 ⇒ 登记为遗留，不在本 PR 做。

## 评审

第 4 轮外部双家族深度评审（critic=claude / proposer=opencode，评审对象 = 本 PR 完整差量
`origin/main..0012e7da`）：critic 给出 **4 条**（correctness 4 / security 5 / performance 8 /
maintainability 5，最低分 4），其中 **1 条高危域（`auth`）**。逐条处置：

| # | 严重度 | 结论 | 处置 |
|---|---|---|---|
| i1 | Critical（**高危域 auth**） | **不成立** | 指控「本 PR 无敏感内容、产物是混入的孤立审阅产物、会污染审计链」。**指控的因果链在实测处断开**：① 「敏感内容 2 处」的来源查实为台账 `//` 注释里**原本就有**的英文单词 `update`（3 处）被判定器的 SQL 关键词模式 `/\b(SELECT\|INSERT INTO\|UPDATE\|DELETE FROM\|DROP TABLE\|ALTER TABLE)\b/i` 命中（大小写不敏感）⇒ 中文敏感词（密钥/加密/凭据/鉴权/授权）命中 **0**、敏感路径命中 **0**（一行 node 可复算，见 `scripts/ccg-review-decider.js:72-78`）—— 这是**关键词匹配假阳性**，本 PR 没有任何认证/数据库/加密面；② 记录里的 `sha` 指向 `7718f8987` 不是「引用了无关 sha」：pre-commit 跑判定器时新 commit 还不存在，`sha` 记的是**判定时的父提交**，差量的内容寻址键是 `stagedDiffHash`；③ 「删掉 `.ccg/reviews` 产物」是仓库明确禁止的动作（删产物 ≠ 完成评审）。**高危域按规则不接受自扮演豁免** ⇒ 外部复核由 critic=claude 完成，第 4 轮原始输出逐字公开于 PR 评论（`externalReview.evidenceRef` 指向该 URL）。 |
| i2 | Warning | **不成立** | `deepReview.required` / `status` 是**判定器的输出**（命中敏感内容 ⇒ dual ⇒ required=true），不是本 PR 能自选的字段；「配置型 PR 设 `required=false`」= 改门禁让自己过（违反 AGENTS.md 红线），「按文件类型分档」是跨仓工程决策。本 PR 接受 DUAL 判定并跑完了外部双家族评审，未绕过任何门禁。 |
| i3 | Warning | **不成立** | 审计绑定**已有三条机器可读通道**：① `.ccg/reviews/<hash>.json` 的**文件名就是内容寻址键**（`stagedDiffHash`），记录内另有 `stagedDiffHash` 与 `sha`（父提交）两个可机读字段；② 执行记录**文件名 = 分支名**，合并后由 `scripts/lib/merge-ledger.js` 按 `(#NNNN)` 尾注**推导**归属；③ 记录模板自带可选 `delivered_by_pr` 字段专供与主干事实交叉核对。⇒「仅依赖自由文本」前提不成立；新增 `headSha` 会与既有 `sha` 同名不同义，且要同时改判定器与门禁两处。 |
| i4 | Info | **登记为遗留** | 「两侧一致性只靠手动注释、缺自动化校验」方向成立，但补校验要改门禁脚本本体（判据自指面）⇒ 记入「遗留」，本 PR 不做。 |

**驳回的可核性**：每条驳回都给了**可复算**的理由 —— 关键词命中的实测来源（一行 node 可复算）、
产物字段的既定语义（可在 `scripts/ccg-review-decider.js` / `ccg-deep-review.js` 里逐字核对）、
审计绑定的三条既有通道（`merge-ledger` + 记录文件名约定 + 模板字段）。
外部复核证据：PR 评论（claude 原始输出逐字公开），
`externalReview` 三格 = `performedBy=claude` / `evidenceRef=<该评论 URL>` / `reviewedAt=2026-10-23T10:05:00Z`。

## CHANGELOG 条目

# fix(gates): 上调 rpa-view-platforms.js 名点目标，修主干「逐文件行数门禁」红（fix-max-lines-target-rpa-view）

- 主干重新变绿：头条「添加视频」修复带来的 13 行增量被如实登记，该文件再涨一行仍会被当场拦下。

## learnings

### lesson: 名点目标的两侧口径不一致，要到门禁真判红才看得见（two-ledger-sides-divide-silently）

**现场**：`rpa-view-platforms.js` 同时出现在台账的 `files`（登记侧，1422 + 200 行容差）与
`targets`（点名侧，1484，**零容差**）里。PR #4276 把它加长 14 行后，`files` 侧毫无反应
（1422 + 200 = 1622 仍覆盖 1497），只有 `targets` 侧判红；而这条红**只在合并后的主干 push 上出现**
（PR 差量里该文件没被改动）⇒ 合并前所有检查都绿，合并后主干转红。

**根因**：同一个「债务」在两套账里各记一个起点、各给一套容差，**差集靠人眼对账**。
「登记侧没反应」会让人以为「没超」，而真正生效的是点名侧。

**可复用的 2 条**：

1. 看到「某文件在挂账清单里」时，先分清它落在**哪一侧**（`files` 有容差、`targets` 零容差），
   再去判断「涨了几行会不会红」—— 两边的算式不一样。
2. 「PR 全绿」与「主干不红」是两件事：门禁对**主干 push**跑的那一遍，测的是合并后的状态。
   合并后必须回读主干 push 的运行结论（AGENTS.md 收尾清单第 3 条），不能拿 PR 侧的绿当收尾证据。
