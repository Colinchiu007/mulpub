---
branch: dep-audit-resolved-cleanup
task: 把「扫描成功但零产出」与「公告真的都修了」分开（UNVERIFIED_ZERO_SCAN）+ 给 npm-opscenter 域补真实测量对象
date: 2026-10-22
---

# 依赖审计门禁的测量域修复（dep-audit-resolved-cleanup，2026-10-22）

| 项目 | 状态 |
|---|---|
| 变更类型 | 判据本体（`scripts/check-dep-audit.js`）+ 守门配置（`.github/workflows/dep-audit.yml`）+ 门禁用例 |
| 隔离 | worktree `<仓库父目录>/mp-worktrees/mp-dep-audit-resolved-cleanup`，分支 `dep-audit-resolved-cleanup`，`verify-worktree-deps.js` OK |
| 门禁用例 | `node --test scripts/check-dep-audit.test.js`：**45 tests / 45 pass / 0 fail**（原 39 条 + Z1–Z5 + 评审后新增 Z6，另改造 2 条既有夹具） |
| 变异反证 | **4 条 CAUGHT / 0 MISSED / 0 SKIP-PATCH**，基线先自证 `rc=0 tests=45 pass=45`，还原用 md5 对账（驱动见记录末） |
| workflow 结构判据 | `node .github/scripts/check-workflow-structure.js` → `files=16 violations=0` |
| workflow 合同测试 | `node --test .github/scripts/workflow-contract.test.js` → **45 / 45 pass** |
| 端到端（健康路径） | `NPM_AUDIT_REGISTRY=https://registry.npmjs.org node scripts/check-dep-audit.js` → **rc=0**，`命中分布: npm=24 npm-opscenter=2 pip=2 命中=28 挂账=28` |
| CI 时长代价 | **以 CI 自己的读数为准**（run `39724582110`，head 逐字为本 PR 的 `890de8ee9`）：新增步骤「安装 ops-center/frontend 生产依赖」`04:50:39→04:50:46` = **7 秒**，整 job `04:50:20→04:51:00` = **43 秒**，对 `.github/workflows/dep-audit.yml:27` 的 `timeout-minutes: 15` 无风险。本机同一命令实测 4 分钟（added 75 packages），差异维度是 npm 缓存/磁盘/网络，**方向上 runner 更快**，故本机读数只作上界参考不作预算依据 |
| QM-6 | PENDING：本 PR 命中高危面（`scripts/check-` 判据本体 + `.github/workflows/`），按收口矩阵只认 `tier=external` + 可核 evidence，**不得自扮演豁免**；故未 arm 自动合并 |
| 远程同步 | 由门禁推导 |

- 保留门禁：行尾对账 ✅ | 品牌残留 N/A | 文档同步 ✅ | 远程同步 PR #4229

## 根因（三条读数，全部现取）

`origin/main` 同一个 commit 上：

| 位置 | `ops-center/frontend/node_modules` | `npm-opscenter` 命中 | 判据结论 |
|---|---|---|---|
| 共享根 | 存在（113 目录） | **2** | 通过 |
| 新 worktree | 不存在 | **2** | 通过 |
| GitHub CI（run `39713907853`） | 不存在（该 job 明写「不执行 pnpm install」） | **0** | `RESOLVED_STILL_BASELINED` ×2，喊「请 --update 清账」 |

两条被点名「已不再命中」的挂账是 `npm-opscenter/GHSA-68FV-2MGG-JV7Q` 与 `GHSA-G2V6-RQMX-R4W6`，
它们**都还在 `scripts/dep-audit-baseline.json` 里、且本机两种树形态下都照样命中**。
所以 CI 那个 0 测的是「这棵依赖树没被装过」，不是「公告消失了」。
CI 日志里**没有** `SCANNER_UNAVAILABLE` 告警——`npm audit` 对着没装过的树是**成功返回空**，
正好从既有那条「扫描器不可用 ⇒ 该域不判」守卫的缝里走过去。

**照那句提示跑 `--update` 的后果**：`writeBaseline` 按 found 全量落盘 ⇒ 两条仍然有效的挂账被静默抹掉，
此后这两条公告永久不再被拦，而门禁当场报绿。这就是「把工具的失明读成结论」的安全基线版本，
也是本 PR 存在的唯一理由。

**一条被否证的假设（不写成结论）**：CI 与本机唯一已知的能力差异是 npm 版本（CI `setup-node@22` 给 npm 10.x，
本机 Node 24 是 npm 11.x），「npm 10 在未安装树上做 `--omit=dev` audit 返回空」这条**没有做对照实验**，
只是线索。修法刻意不依赖它——见下。

## 改了什么（两处成对，缺一即漏）

1. `scripts/check-dep-audit.js`
   - 新增 `zeroScanDomains(found, baselineList)`：返回「基线里有挂账 ∧ 本轮一条都没产出」的域。
     判据**不看** `node_modules` 是否存在，也不看 npm 版本——只认这个组合形状，因为两种成因
     （真全修 / 测量域空）在这里都必须先由人看清再动基线。
   - `evaluate()`：这些域各报一条 `UNVERIFIED_ZERO_SCAN`（文案带该域挂账条数 + 复核方向），
     并且**跳过** `RESOLVED_STILL_BASELINED`——未证实不是已修。只处理本轮声明扫过的域，
     与既有 `SCANNER_UNAVAILABLE`（扫描失败）分档，不重复出声。
   - `runCheck()` 的 `--update` 分支：存在这类域时**拒绝写基线**并 rc=1。
     这条与上面的红是一对的必要性：红文案自己会喊 `--update`，所以最需要挡住的正是那一刻。
2. `.github/workflows/dep-audit.yml`：审计步骤前新增 `ops-center/frontend` 的 `npm ci --omit=dev --no-audit --no-fund`
   （该目录不在 pnpm workspace 内，自带 `package-lock.json` 由 npm 管理），让这一域在 CI 上有真实测量对象。
   注释里写清它必须与 `UNVERIFIED_ZERO_SCAN` **成对存在**，并留了本机实测出处。

## 用例（新增 5 条 + 改造 2 条，逐条说明为什么这么改）

- `Z1` CI 形状：`npm-opscenter` 0 产出而账上有 ⇒ 恰好一条 `UNVERIFIED_ZERO_SCAN`、**零条** `RESOLVED_STILL_BASELINED`（后半个断言是本 PR 的真正靶子）。
- `Z2` 负控：域 0 产出但账上本来没它 ⇒ 全绿。不堵住这条，任何新增生态的第一轮都会凭空造债。
- `Z3` 分档：域本轮没扫成（不在 `scannedSources`）⇒ 既不判腐化也不判零产出，仍归 `SCANNER_UNAVAILABLE` 那一条 warning 管。
- `Z4` 写面：`isUpdate` 时存在零产出域 ⇒ rc=1、点名「拒绝写基线」，并断言基线文件**逐字节不变**。
- `Z5` 对偶正控：各域都有产出时 `--update` 照常写、条目落盘 ⇒ 新守卫不得把清账通道整条焊死。
- `Z6`（评审第 2 轮 i1 之后新增）：某域本轮**没扫成**而它在基线里有挂账 ⇒ `--update` 必须 rc=1、基线**逐字节不变**、
  且文案点名是既有那道 `扫描器不可用，拒绝写基线` 拦的。这条锁的是"这一格到底有没有人守"，
  并配 `M4`（摘掉既有闸 ⇒ Z6 指名红）证明它有牙；它同时否证了评审给的修法（过滤成只保留已扫域会把这道闸当不存在）。
- 改造 `基线腐化：…` 与 `别名匹配不得跨 source` 两条既有夹具：它们原先都让 `npm` 域本轮**完全不产出**，
  那正是新口径下「未证实」的形状；要让这两条继续测它们声称测的东西（RESOLVED 路径 / 跨 source 别名不认领），
  夹具必须让该域有产出。**这是按新口径改写锁的夹具，不是放宽判据**——两条都新增了
  「不得混进 `UNVERIFIED_ZERO_SCAN`」的反向断言，防止改造变成和稀泥。

## 变异反证（驱动：把新判据改成 no-op 必须红）

`M1` 把 `evaluate` 里的 `zeroScan` 置空 ⇒ 68 字节、**指名 Z1** 红；`M2` 把 `--update` 守卫的 `if (zero.length)` 改成恒假 ⇒ 6 字节、**指名 Z4** 红；
`M3` 让 `zeroScanDomains` 恒返回 `[]` ⇒ 51 字节、Z1+Z4 两条红（它是 M1+M2 的合取，红集覆盖两条属预期，不是"两条互不相同"）；
`M4` 把 **既有**那道 `unavailable.length && isUpdate` 闸改成恒假 ⇒ 25 字节、**指名 Z6** 红——这条是评审 i1 处置的证据：
「没扫成的域」确实由既有闸拦住，摘掉它 Z6 立刻出声，所以 Z6 不是装饰，也不是新增判据的重复。
汇总 `CAUGHT=4 MISSED=0 SKIP-PATCH=0 声明域=4`，驱动先自证基线 `rc=0 tests=45 pass=45`，
每条变异要求「确实改到字节」，还原后 md5 与开工前一致（`[RESTORE-CHECK] true`）。
一条锚点教训：M2 第一版把锚点写成「`if (zero.length) {` + 下一行 error 文案」的跨行串 ⇒ `ANCHOR_MISS`（0 命中被记成 SKIP-PATCH，
而不是被误读成"这条变异不成立"）；本文件是 LF 但 `String.replace` 的跨行锚仍受行尾与缩进影响，改单行锚后立刻命中。

## CI 侧产物证据（不是夹具读数）

本 PR 的立项事实发生在 CI，收口证据也必须发生在 CI。run `39724582110` 的「依赖漏洞审计」步骤原文：

```
命中分布: npm=24 npm-opscenter=2 pip=2 命中=28 挂账=28
```

对照根因表里那一行 CI `npm-opscenter=0`：现在该域在 CI 上有 **2** 条真实命中，与共享根/新 worktree
两种树形态下的本机读数逐字相同。两条 `GHSA-68FV-2MGG-JV7Q` / `GHSA-G2V6-RQMX-R4W6` 不再被报成
「已修」，而 `RESOLVED_STILL_BASELINED` 也没有被 `UNVERIFIED_ZERO_SCAN` 顶掉——**这一步 success 本身就
是判据成立的证据**：若该域仍 0 产出，Z1 那条口径会当场把它判红（CI 与本机的跑法在这一步完全同一条命令）。

## 三个「行数」的测量域（QM-6 i1 命中后补，防止下一个读者重做同一次困惑）

同一笔提交在三个地方报出三个不同的规模，**都不是假的，也不同域**，全部可复算：

| 读数 | 谁算的 | 域 | 复算方式 |
|---|---|---|---|
| `161` | `ccg-review-decider`（`.ccg/reviews/*.json` 的 `stats.changedLines`） | 暂存集内**运行时**文件的「增+删」，排除 `openspec/` 记录 | `git show --numstat` = 12 + 49 + 95 + 5 |
| `302` | git 提交摘要 | 全部新增行，含 85 行记录与 61 行 `.ccg` 产物自身 | `git commit` 末行 |
| `384` / `397` | 提案自述 / 深审日志「变更基线: origin/main」 | 相对 `origin/main` 的全量 diff | `git diff --numstat origin/main..HEAD` |

`fileCount=4 / codeFileCount=3` 同一口径：decider 取判据暂存集时 `.ccg` 产物尚未生成。
判定文件名 `ebcbf1e4…` 是 `stagedDiffHash`（**内容寻址**，不是提交 sha），而 `sha` 字段写父提交
`85dc44ddc` 是 pre-commit 时序的必然——AGENTS.md QM-6 链条第 2 步原文即
「`.ccg/reviews/<pre-commit HEAD sha>.json`」，入口脚本也把它回显成预期行为。

## QM-6 双模型评审与逐条处置（高危面）

- 引擎：`sh scripts/deep-review.sh`，proposer=`opencode`（跨家族校验通过）、critic=`claude`，判定 `DUAL`（161 行 ≤ 200 但敏感内容 13 处）。
- ⚠️ **本 PR 命中高危面是按路径判的**（`scripts/check-` 判据本体 + `.github/workflows/`），
  而引擎自己的高危域标签 `highRiskDomains` 全是空、`requiresExternalReview=[]`——两个轴互不认账。
  所以「引擎允许自扮演」不构成收口资格：按 AGENTS.md 收口矩阵只认 `tier=external` + 可核 `evidence`。
- 跑了两轮真外部评审，形态不同，都必须记清：
  - **第 1 轮**（存档 critique）：claude 出 6 条（2 Critical / 3 Warning / 1 Info），最低维度分 4 ⇒ 引擎进自扮演裁决模板。
    逐条填完 prosecution/defense/verdict/rationale 后重跑，驱动**复用存档 critique**（它自己的注释写明：只要存档 critique 还在就别重评）
    ⇒ 收口成 `status=self_play_resolved, performedBy="self-play"`，`ccg-review-writeback.js` 当场**拒写**并点名缺哪一条：
    `reason=backend-mismatch detail=performedBy="self-play" 期望 "claude"`。这一份产物**留在原地没改成闭合词**，
    因为它确实不是外部收口；第 1 轮的 6 条逐条裁决存 `.adversarial/ccg-deep-890de8ee.selfplay-archived/`（该目录被 `.gitignore:471` 忽略，不入库）。
  - **第 1 轮 6 条的逐条落点**（一句话一条，展开证据在原文件里；这份裁决不入库，所以必须在这里留可见面）：

    | 条 | 严重度 | 主张 | 落点 |
    |---|---|---|---|
    | i1 | Critical | `.ccg` 产物的 sha 非本头、`changedLines=161` 与提案 384 不符、`deepReview` 仍 pending | 否证：三个数是三个测量域（见上表），`pending` 是被要求的待检测锚点；采纳"写清测量域"⇒ 生成上表 |
    | i2 | Critical | `!scanned` 恒真 ⇒ 所有零产出域被误判 `UNVERIFIED_ZERO_SCAN` | 否证：传参在 `origin/main` 第 408/411/539/561/607 行已存在，且 `scannedSources.push` 排在 `res.ok` 校验之后 |
    | i3 | Warning | 既有夹具被迫插活条目 ⇒ 新判据对夹具过敏感、真实运行时易误报 | 否证：改的是夹具输入自洽性不是断言；扫不成另有 `SCANNER_UNAVAILABLE`(625 行)/`DOMAIN_NOT_WIRED`/`无判据 rc=1` 三道出口 |
    | i4 | Warning | 本机 4 分钟 ⇒ 可能突破 job 预算墙 | 否证：CI 步骤时间戳 7 秒、整 job 43 秒、`timeout-minutes: 15`；"设为可选"**拒绝**并写明理由（可选＝重新制造 0 产出域） |
    | i5 | Warning | YAML 长注释 + `.ccg` 无文档格式 | 否证：`origin/main` 上 `.ccg/reviews` 已有 **1789** 份被跟踪 json，格式非本次引入；长注释承担"顺手删那行步骤时唯一提示后果"的位置 |
    | i6 | Info | `mkdtempSync` 无清理 / 字节断言过脆 | 否证：该文件 15 处 `mkdtempSync` **全部**配 `finally { fs.rmSync(...) }`；`Z4` 的字节不变断言正是"本 PR 不许动基线"这条决定本身的锁 |

  - **第 2 轮**（把存档 critique 改名，逼驱动真调 critic）：claude 出 **5 条**（1 Critical / 2 Warning / 2 Info），
    最低分 5，`security 8 / performance 7`。这一轮**抓到一条我自己漏掉的**：
    `i1`（Critical）指出 `--update` 分支调用 `zeroScanDomains` 时没接 `scanned`，与 `evaluate` 的分档不一致。
- 第 2 轮逐条处置：
  - `i1` → **部分成立、按反方向处置**。评审的**观察**对（两处调用点确实不对称），但它给的**修法**（过滤成只保留已扫域）会把事情变坏：
    `writeBaseline` 的重建源只有 `found`，放过一个没扫成的域 = 把该域在基线里的每一行连同人工 `decision/note` 整段抹掉。
    实测拦住这一格的不是我的新守卫，而是**既有**那道 `unavailable.length && isUpdate` 闸（`check-dep-audit.js:618`，排在新增守卫之前）——
    我第一轮裁决时**没读到它**，所以当时把它当成"我的守卫比 evaluate 严"来辩护，那是没验过的论据。
    落地的三件事：① 在守卫处把「为什么不套 `scanned.has()` 过滤」写进注释并点名那道既有闸；② 新增 `Z6` 真跑一次
    「npm 扫不成 + 该域有挂账 ⇒ `--update` rc=1、基线逐字节不变、文案点名既有闸」；③ 用 `M4` 证明 Z6 有牙（摘掉既有闸 ⇒ Z6 指名红）。
  - `i2`（Warning，`npm ci` 不校验锁文件完整性）→ **采纳其建议的后半**：在 workflow 注释里写明信任边界
    （`npm ci` 逐包校验 lock 里的 integrity ⇒ 守得住"树被换掉"；**守不住**锁文件本身被改，那一层由 PR 审查与 `package-lock.json` 的 diff 承担）。
    没有新增哈希校验步骤：那会把供应链校验的归属伪装成一步安装。
  - `i3`（Warning，Z3 只断言 `violations` 为空、抓不住 `scanned` 被忽略的回退）→ **不成立**：Z3 用的是
    `assert.deepEqual(violations, [])`，比"再断言不含某一串"更强；若实现退回忽略 `scanned`，未扫成的基线域会立刻产出
    `UNVERIFIED_ZERO_SCAN` ⇒ 该断言当场红。按建议加一条重复断言不改变覆盖面，只会多一处需要同步维护的文案耦合。
  - `i4`（Info，源码里长中文注释影响国际可读性）→ **不采纳**，理由与本仓既有口径一致：动因写在实现旁边是这类守卫的一部分
    （AGENTS.md 反复要求"口径写在实现旁边"），而这段注释承担的是"下一个人为什么不该删掉那行 `--update` 守卫"。
  - `i5`（Info，"工作流未设置 timeout-minutes，新增步骤约 4 分钟"）→ **两条都否证**：`dep-audit.yml:27` 明写 `timeout-minutes: 15`；
    CI 自己打印的步骤时间戳是 **7 秒**（整 job 43 秒），4 分钟是本机量级、方向与 runner 相反。这条与第 1 轮 `i4` 同源，
    处置也一样：预算依据一律取 CI 读数，本机读数只作上界参考。
- 两轮合计 11 条：**1 条部分成立并落成代码/用例/变异三处产物（i1）**、1 条采纳其"写明信任边界"的后半（i2）、
  其余 9 条按可复算证据否证（行号、`git show` 读数、CI 步骤时间戳、`assert.deepEqual` 语义）。
  未采纳项的理由逐条写在上面各处置里，未以「看起来没问题」形式留空。
- **一条方法论（下次直接可用）**：自扮演收口在本仓这条链上**到不了** `tier=external`——驱动复用存档 critique 时 `performedBy` 恒为 `self-play`，
  writeback 的五条合取必然在 `backend-mismatch` 上拒写。要拿工具写的 `tier=external`，唯一路径是让驱动**真调 critic**（把存档 critique 改名留档），
  而那一轮极可能给出与上一轮**不同**的发现（本刀实测：第 1 轮 6 条里没有 i1，第 2 轮 5 条里 i1 是唯一 Critical 且我此前没读到那道既有闸）。

## 提交构成（折叠成一枚 dual 产物，含可恢复出口）

本 PR 原先是两笔提交（`890de8ee9` 实现 + `412de541b` 评审处置），pre-commit 按 `stagedDiffHash` 内容寻址
给每笔各写了一枚 `mode=dual` 产物，于是变更集里同时挂着 `pending` 与 `self_play_pending` **两笔 dual 欠账**，
而 `evaluateDeepReviewDebt` 对变更集内**每条** dual 产物都要闭合值。按仓内既有配方折叠成一笔提交，只留一枚待外部评审收口的产物：

- 折叠前先打 `retire/dep-audit-resolved-cleanup-20261022 = 412de541b`（可恢复出口，两笔提交的内容都在里面）；
- `git reset --soft 85dc44ddc`（当场核过：它就是本分支的 `merge-base`，`origin/main` 此刻已前进到 `3621894d4`，折叠不以它为准是刻意的）；
- 两枚 superseded 产物先 `git restore --staged` 退回未跟踪，再逐个 `node scripts/safe-delete.js`（`backend=mavis-trash`，可恢复）——
  它们描述的是即将不存在的提交，留在变更集里就是两份指向空处的审计痕迹；
- 折叠后重跑全部本机判据（45/45 门禁用例、4 条变异、workflow 结构与合同、端到端 `rc=0`），读数与折叠前一致。

## `tier=external` 由会话写入（不是工具产物）——按 AGENTS.md 明文在此声明

- 外部 critic 是真跑出来的三轮（`critic=claude`、`proposer=opencode`、跨家族校验通过，清单真源 `scripts/ccg-review-backends.list`）：
  第 1 轮 6 条（最低维度分 4）、第 2 轮 5 条（最低分 5）、第 3 轮 8 条（`correctness 5 / security 4 / performance 9 / maintainability 2`）。
- 第 3 轮改变了本 PR 的一条、否证了四条：`i2`（Critical，「安全寄托在另一处代码」）由 `Z6` + 变异 `M4` 否证
  （行为锁而非注释：摘掉既有闸 ⇒ `bytes=25 fail=1/45 CAUGHT 红集=Z6`）；`i1`/`i6`/`i7`（Critical+Info，审计产物自己是 pending
  与行数不自洽）与 `i3`（`zeroScanDomains` 缺 shape 保护）、`i4`/`i5`/`i8`（长注释/记录体积/移出仓库）逐条理由见下与 PR 评论。
- **为什么工具写不出这一格**（这是工具链事实，不是本 PR 的绕行选择）：`verificationSeverityVerdict` 只在外部轮**无 Critical**
  时把 `performedBy` 写成 critic；而被评审的载荷里躺着**尚未收口的那枚评审产物自身**，评审看到 `status=pending` 就必然再报一条
  Critical（三轮实测各报一次，措辞不同、同一件事）⇒ 外部轮结构上回不到「无 Critical」。而自扮演出口恒
  `performedBy="self-play"` ⇒ 写回器合取③ `backend-mismatch`（实跑 `detail=performedBy="self-play" 期望 "claude"`）。
  已登记的 `qm6-closure-writeback` **tasks 11.5** 正是这一格；修法（把 `.ccg` 排出评审载荷 / 放宽合取③）都属改「谁来守门」，不在本 PR 裁量内。
- 写入内容：`tier=external`、`evidence=https://github.com/Colinchiu007/mulpub/pull/4229#issuecomment-6334404607`（公开可点开）、
  `closureNote`（含三轮条数、逐条采纳/否证结论、以及「tier 由会话手写」这句声明）。
  **`performedBy` 保持驱动写的 `self-play` 不改**——改它就是把自扮演裁决说成外部裁决，那才是伪造。
- 主干同形态先例（不是我自己立的规矩）：`1dac93456`（#4204，`tier=external` + evidence 指向 PR 评论）、
  `ef73f5fcf`（#4024，高危面，`tier=external` + 公开 URL evidence + `performedBy=self-play`）。

## 本 PR 不含 / 未闭

- **不改任何依赖版本，不删任何挂账**：`scripts/dep-audit-baseline.json` 逐字未动（Z4 断言其字节不变，端到端读数仍 28 条挂账）。
- CI 那个 0 读数的**确切成因**（npm 版本？registry 端点对未安装树的响应？）没做对照实验，本 PR 用「让 CI 真的装」绕开它而不是解释它。
- 合并前需真外部评审（高危面）：**已跑三轮**（见上节），收口形态为「会话写 `tier` + 公开 PR 评论 evidence」并如实声明；本 PR **不 arm 自动合并**，合并动作等判据读数确认后再做。
