---
record: main-red-run-baseline
task: 主干红闸门改读「该 tip 的非 workflow_run run 集合」+ 读数稳定窗重试 + CI Failure Handler 让出 Windows 并发额度
date: 2026-10-22
---

## 本次执行记录：主干红闸门换源 + 稳定窗（main-red-run-baseline，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（`scripts/` 判据本体 + `.github/workflows/` CI 配置）⇒ 走隔离 worktree：worktree `<仓库父目录>/mp-worktrees/mp-main-red-run-baseline` + **裸分支** `main-red-run-baseline`（`scripts/start-mp-task.ps1 -TaskName main-red-run-baseline -NoDeps` 建的），`git rev-parse --abbrev-ref HEAD` 实证。依赖就绪：`pnpm install --frozen-lockfile`（1m27s）→ `node scripts/ensure-electron.js`（electron dist v43.7.7 就绪）→ `node scripts/verify-worktree-deps.js`（**消费方解析通过 11 个 / OK**）。共享根全程停在 `main` 且未落盘任何运行时路径 |
| 第一性原因（QM-5 ①） | PASS | **两层失真，机制不同**。① **读数被噪声淹没**：GitHub 把 `workflow_run` 触发的工作流的 check run 一律挂在**默认分支当前 tip** 上（不管触发它的是哪个 PR 的 CI）⇒ 实测主干 tip `8da92948` 的 check-run **102 行里 81 行**是同一个 `handle-ci-failure`（来自 30 个 handler run，25 分钟内新增 29 个），真实信号只剩 21 行；闸门实测 `mainPending=4` 而**真实未完成只有 2 条**（`QG Coverage`/`electron-tests`）——另一半是噪声。② **移动目标**：闸门读「此刻的 tip」，而 tip 每 15–30 分钟前进一次；实测一次读数期间 tip 从 `2f5c0a32f` 移到 `8da92948`，那次读数整个作废 |
| 逃逸分析（QM-5 ②） | PASS | 既有闸门为什么抓不到：① **同名折叠掩盖噪声**——`namesBy` 用 Set 把 81 行折成 1 个名字，但只要其中**任意一条在飞**（全是 windows-latest 作业，在挤爆的托管池里排队），主干侧就多出一个 pending ⇒ 真实检查全绿也判「未证实」；② **只读一次判一次**——tip 移动既不作废读数也不重试，合并入口 `scripts/merge-when-green.ps1:81` 拿不到读数就 `FAIL(7)`，让人从头重跑脚本；③ **Windows 额度被挤爆**——`electron-tests` 作业实测排队 **46.6 分 / 51.5 分**才起跑（`run_created 16:20:26 → job started 17:07:04`），而同批次的纯 ubuntu 作业（quality-gate）**零排队**（`run_started_at == created_at`）⇒ 读数墙钟 = 45 分钟执行 + 47 分钟排队，而 tip 每 25 分钟跳一次 |
| 修复 + 回归保护（QM-5 ④） | PASS | ① 采集层新增 `mainRowsAt(sha)`：读 `actions/runs?head_sha=`（`--paginate` + `per_page=100`），**只取 `event != 'workflow_run'` 的 run**，同一 workflow 取**最新**一次（`run_number` + `run_attempt` 双重最大），再取其**作业级**终态；PR 侧仍读 check-runs（两侧行粒度都是作业名，差集口径不变）。② **稳定窗**：每次尝试都重新取当前 tip，取数前后各取一次，不一致即作废本次读数并有界重试（`--attempts` 默认 3、`--retry-seconds` 默认 90）。③ `lib/main-red.js` 新增 `mainMoved` 档（基准作废 ⇒ 未证实(3)，且**不报新增红**）。④ CI Failure Handler 改 `ubuntu-latest`（只依赖 gh CLI + node）。**回归**：`node --test scripts/check-main-red.test.js` → **44 例全绿**（新增 7 组：run 集合筛选 / 重跑取最新 / event 缺失抛错 / 结构锁 / 稳定窗重试 / 重试耗尽 / 参数校验 + judge 的 `mainMoved` 档）；`node --test .github/scripts/workflow-contract.test.js` → **46 例全绿**（新增 1 条契约锁） |
| 防止再次发生（QM-5 ⑤） | PASS | ① **结构锁**：`scripts/check-main-red.test.js` 钉住「入口必须调 `c.mainRowsAt(`，`c.checksAt(` 只能出现一次（PR 侧）」——主干侧回落到 check-runs 就把 81/102 的噪声放回来；② **反失明**：`event` 字段缺失一律抛错（形状不认识不得静默放行），`selectMainRuns` 纯函数可单测；③ **契约锁**：`.github/scripts/workflow-contract.test.js` 钉住 handler 必须 `runs-on: ubuntu-latest`（该文件由 `quality-gate.yml` 的 **Gate 2b** 接入 CI，PR 与 main push 都跑，不是只在本地跑）；④ 文档侧：`specs/ci-main-red-gate/spec.md` 三条 Requirement 把「来源 / 稳定窗 / 档位契约」写成可核对条款 |
| 行尾与 diff 对账 | PASS | `git diff --numstat origin/main...HEAD` 与 `git diff --ignore-cr-at-eol --numstat origin/main...HEAD` **两口径各 14 行且逐行完全相同** ⇒ 无 CRLF/LF 造成的虚假增删；删除 43 行归因：`scripts/check-main-red.js` 的旧采集层（`checksAt` 兼作主干侧）+ 旧 `parseCheckRunLines` 实现 + 旧 `main()` 单次读数块，**无整文件删除** |
| 接线棘轮 | PASS | **未新增** `*.test.js` 文件（新增用例落在**已接线**的 `scripts/check-main-red.test.js` 与 `.github/scripts/workflow-contract.test.js` 内，两者分别由 quality-gate 的 Gate 2b 系列作业执行）⇒ 棘轮无需新增接线 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/`、`packages/`、`apps/desktop/electron/**`、locale、视觉基线 ⇒ 打包与像素基线不适用（判定依据已写进 `openspec/changes/main-red-run-baseline/proposal.md` 的「影响面」） |
| QM-6 CCG 双模型外部评审 | PASS | **验证层**（`sh scripts/deep-review.sh`，mode=dual / 变更 449 行）**已执行**：critic=claude 产出 **7 条**意见（correctness 5 / security 6 / performance 4 / maintainability 5），逐条裁决留档 `openspec/changes/main-red-run-baseline/ccg-review-record.md`。**3 条 upheld 已修并带回归锁**：i1（`mainMoved` 档新增 `prFailNames` + `newRedComputed=false`）、i3（裁决收口本身）、i4（新增 `--max-wait-seconds` 总等待上限）；**3 条 dismissed** 给出可验证理由与登记去向：i2（opencode 输入上限的静默拒绝属工具链遗留）、i5（「字段缺失抛错」符合失明纪律）、i6（`openspec validate --strict` + Gate 2b2 + Scenario↔行为锁逐条对应）。**决策层共六轮**（逐条处置见 `ccg-review-record.md` 六节）：① 7 条 / Critical 2（档位表述、两端口径自相矛盾）→ 已改；② 压缩后重跑 8 条 / **Critical 0** / 最低分 6 → 收敛（cleared）；③ 补完澄清后 6 条 / **Critical 2**（新补文字引入的「名字对齐过度声称」与「C4 因果未证实」）→ 已改 + 补同名聚合与空 event 回归锁；④ 7 条 / **Critical 2**（选最新 run 缺兜底、影响面混了确定与推测）→ 已改 + 补时间预算自洽；⑤ 改用 **codex/claude**（无长度上限）跑通**真跨家族回路**：critic 8 条 / Critical 2（两侧命名空间、零 run 的假绿）→ 已改 + 补 fetch 前置、两阶段顺序、请求预算。proposer 侧前四轮被 opencode 的 7800 字节上限挡掉，第五、六轮按本仓既有先例换成 codex/claude 后**逐条决策正常产出**；⑥ 轮 critic=codex 8 条 / Critical 3（绿 schedule run 覆盖红 push run、终态映射未定义、「永不可绿」的诚实说明）→ 已修代码 + 补映射表 + 如实登记 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并后 main push 的回读证据写在 PR 评论里，不写回本文件 |

### 遗留（不假装已闭合）

- **CCG 引擎的输入长度协议**（评审 i2）：opencode 后端单次输入上限 7800 字节，超限时
  **同步拒绝**（~120ms、exit 1、无任何错误信息）⇒ 决策层的「逐条回应」环节停在"挑完刺但没人回应"。
  本片用「拆 `evidence.md` + 压缩正文」绕开（方案正文 7470 字节 < 7800），
  但引擎侧仍缺显式长度校验与分段重试协议。改它属「改谁来守门」的邻域，本片不动。
- **「永不可绿」的诚实说明**（决策层 i1）：主干 tip 每 15–30 分钟前进，而 quality-gate 整条要 44 分钟，
  所以新 tip 的检查常常还没跑完 ⇒ 闸门常态落在 rc=3（未证实）。本片**不**引入「钉住旧 tip 当已验证」
  （那要改守门者的权限，须人工过目）；本片只让「未证实」这个答案**诚实且可归因**。
  真正的解法（合并批量化 / main push CI 分层 / QG Coverage 分片）不在本片范围。
- **C4 的迁移效果缺一次真实运行证明**（决策层 i6）：契约锁只能证明配置形态对，
  「handler 在 ubuntu 上真能跑」要等合并后主干上出现一次成功的 handler run 才算证实 ⇒ 已登记为观测点。
- **required check 名单未纳入主干基准**（决策层 i3/i7）：本片只保证「主干侧缺格时 PR 同名红仍判新增红」（保守方向），
  但「required check 在该 tip 上没跑 ⇒ 主干绿」这一面没有收紧——那需要引入一份 required 名单
  （属「改谁来守门」，须人工过目）。
- **spec ↔ 实现的逐条自动同步**（评审 i6）：本片靠 `openspec validate --strict`（实测 valid）
  + quality-gate Gate 2b2（spec 镜像契约）+ 「Scenario ↔ 行为锁用例逐条对应」这三样，
  缺一条通用的「spec 与实现逐条比对」自动门禁。本片**不加**新的 CI 门禁（属「改谁来守门」，
  按 AGENTS 须人工过目）。
- **本轮 proposer 侧未产出**：争议项由 critic=claude 产出，proposer=opencode 因上述长度上限
  未参与逐条回应；裁决由会话按引擎模板逐条填写（`confidenceWeight=0.6`，低于真跨家族 1）。
  这是**自扮演**的诚实标注，不是「跨家族已收敛」。
- **主干读数的执行墙钟没被本片解决**：`quality-gate` 在 main push 上整条真实执行 **44 分 28 秒**
  （`QG Coverage` 单步 41 分 51 秒），本片只解决「排队」与「读数不准」，
  **没有**动 `quality-gate.yml` 的作业结构（那是另一件事，见提案「不做什么」）。
  ⇒ 稳定窗能拿到的最长读数窗口仍受这条执行时长约束。
- **Windows 托管额度只是缓解**：`electron-tests` / `GUI Tests` 仍共用 `windows-latest` 池；
  把 handler 挪走腾出的并发，会被这两个作业吃掉一部分。彻底解法（main push 只跑冒烟层 /
  QG Coverage 分片）不在本片范围。
- **`workflow_run` 的挂载语义未改**：handler 仍会挂在主干 tip 上（那是 C1 在**读数侧**隔离的）。
- **差集仍按检查名对齐**：同名红只证明「主干上也红过」，不证明是同一条用例——
  本片没有动这条已知局限（换源不改变对齐粒度）。新增的**同名多行取最严格的一格**只保证差集**确定**，
  不保证跨 workflow 同名作业（如 `Changes` 三处各一份）能消歧；
  消歧到 workflow 级需两侧都改取数方式（PR 侧要从 check-run 反查所属 workflow），本片不做。
- **C4 的收益只到「预期」为止**（决策层 i2）：观测事实是「Windows 作业排队 46.6/51.5 分、
  同批次 ubuntu 作业零排队」；**「handler 占了 `electron-tests` 的位置」这一因果未被证实**
  （托管池的实时占用不可观测）。故执行记录与规格一律写成**预期释放**，并留一个观测点：
  迁移后复跑 `electron-tests` 的排队时长读数（与 evidence E3 同口径）。

## CHANGELOG 条目

# fix(gates): 主干红闸门改读该 tip 的 run 集合 + 读数稳定窗重试（main-red-run-baseline）

- 并发合并时主干读数不再被同名噪声淹没：闸门原先读该 commit 上的全部检查，
  而 CI 失败处理器这类「由别的 CI 触发」的工作流会被 GitHub 挂到主干 tip 上，
  实测 102 行里 81 行是同一个名字的噪声——现在主干基准只认主干自己跑的作业。
- 读数期间主干被推进时，这次读数自动作废并重试（默认 3 次 × 90 秒），
  不再把「读的是旧主干」的结果当成当前主干的状态。
- 拿不到读数时会说清是「未证实」而不是含糊地说主干红；PR 自己的红仍会被点名。

## learnings

### lesson: git-hub-check-run-noise-from-workflow-run-trigger

**现场**：主干 tip `8da92948` 上挂着 102 条 check-run，其中 81 条是同名
`handle-ci-failure`（来自 30 个 `event=workflow_run` 触发的 run，25 分钟内新增 29 个）。
闸门实测 `mainPending=4`，而同一刻真实未完成的只有 2 条。

**根因**：`workflow_run` 触发的工作流，其 check run 挂到**默认分支当前 tip**，
不管触发它的是哪个 PR 的 CI。所以「主干 tip 上有什么检查」与「主干自己验过什么」是两件事；
按 commit 读 check-runs 会把前者混进后者。

**可复用的 2 条**：

1. 想知道「这个 commit 自己验过什么」，读 **run 集合并按 `event` 过滤**，
   不要读该 commit 上的全部 check-run。
2. 判据里凡是「按名字对齐做差集」的，噪声行会**放大**误判：
   81 行同名折叠成 1 个名字，但只要有一条在飞就多一个 pending ⇒ 真实信号全绿也判未证实。
   换源时先问「这个来源里有没有别的事件类型的东西被挂上来」。

### lesson: moving-target-needs-retry-not-pinning

**现场**：一次闸门读数期间主干 tip 从 `2f5c0a32f` 移到 `8da92948`，那次读数整个作废；
旧实现只读一次判一次，合并入口拿不到读数就 `FAIL(7)`，让人从头重跑脚本。

**根因**：闸门读的是「此刻的 tip」，而主干在多会话并发下每 15–30 分钟前进一次。
**一次读数是两条独立时间线上的两个快照**（主干侧与 PR 侧），它们必须落在同一棵树上。

**可复用的 2 条**：

1. 读数前后各取一次 tip；不一致就**作废这次读数并重试**，而不是接受它、也不是把 tip 钉死在旧 sha 上。
2. 重试要**追新 tip**（每次尝试重新取当前 tip）——钉在旧 sha 上继续判绿是把「旧主干是绿的」
   读成「现在的主干是绿的」。
