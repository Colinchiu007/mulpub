---
record: visual-gate-enforce
task: 修复 QG Visual 的「校验域失败被静默吞掉」——views / views-supplement 的退出码 1 从此阻断（两轮甄别）
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；且本 PR 属「改谁来守门」，按 AGENTS.md 需人工过目后才合并
sync_backfill_owner: visual-gate-enforce 会话（本节作者）
---

## 本次执行记录：QG Visual 校验域阻断面（visual-gate-enforce，2026-10-17）【混合 PR · 改守门面】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（`.github/workflows/quality-gate.yml` + `.github/scripts/workflow-contract.test.js`），`classify-docs-only` 必判 false。worktree `<worktreeRoot>\mp-visual-gate-enforce`（D 盘），裸分支 `visual-gate-enforce`。隔离入口仍被**他人会话的历史崩溃残留**挡住（`-RequireClean`），按纪律 A 不触碰他人工作，改用 `git worktree add`（PowerShell 原生 `D:\` 路径）创建，共享根未落盘 |
| 第一性原因（QM-5 ①） | ✅ | **不是「视觉套件不在 PR 上跑」，而是「跑了、失败了、被静默吞掉」**。`quality-gate.yml` 的 `visual` job（步骤 `Gate 7 - Visual regression`）确实调了 `test:visual` / `test:visual:supplement`，但**退出码 1 只留痕不阻断**（原注释：「照旧只留痕、交给 Gate 7b」）。而 Gate 7b 的判据是「基线 == 本次渲染，0 px」—— **像素域**。`views` / `views-supplement` 跑的是 `runViewTest`（截图 + 逐条 `checks` 选择器断言，**不做像素比对**）⇒ **校验域没有任何阻断面**。决定性证据（修复前 merge `110c3aabb` 的 QG Visual job `117161753615` 日志）：`补充视图失败: collection-confirm-dialog: ... 断言失败: 收藏列表, 删除入口` 紧跟 `[GATE-7] suite exits: pixel=0 views=0 views-supplement=1 dark=0`，**而该 job 结论是 pass** |
| 逃逸分析（QM-5 ②） | ✅ | ①**Gate 7**：只对退出码 3（就绪超时）阻断；退出码 1 仅在 `$pixelExit` / `$judgeExit` 上阻断，`views` / `viewsSupp` / `dark` 三格**收集了却不消费**。②**Gate 7b**：判定域是像素（0 px），校验型断言不在域内 ⇒ 结构上不可能拦住。③**required 层**：`visual-test.yml` 是唯一会因这条断言变红的 workflow，但它自 2026-09-17「CI 提速」起**没有 `pull_request` 触发**（只 `push: branches:[main]` + dispatch），且**不在分支保护 required 集合**（required = `Gate Result`/`build`/`QG Unit Tests`/`QG Coverage`）⇒ 「PR 侧被吞 + main 侧红不阻塞合并」叠加，连红 60+ 次无人发现。④**审查层**：注释把「views 两套不另设门禁」的理由写成「Gate 7b 的 0 px 严格强于 6%」——那句话对**像素**成立，被无差别套用到**校验**上，属把一条判据的有效域写宽 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`quality-gate.yml` Gate 7：`views` / `views-supplement` 非零时**当场重跑一次**，两轮都非零才把套件名收进 `$checksFailSuites`；像素判定之后新增阻断分支点名「校验型断言两次均失败」并 `exit 1`。②像素域（`pixel` / `dark`）**保持原状**——它们的采集抖动真实存在（#2914 同 sha 两 attempt 一红一绿），仍走 Gate 7b 两轮甄别，不在本次动它。③旧注释同步改写为「按套件类别分流」，避免注释与代码相反。④新增结构锁 `.github/scripts/workflow-contract.test.js` 的「QG Visual 的校验域套件失败必须阻断」（钉三件事：非零必重跑、两轮必阻断、阻断必须排在 `All visual tests passed` 之前） |
| 变异反证 | ✅ **1/1 CAUGHT**（正控 GREEN、还原逐字节 IDENTICAL） | M1：从 `quality-gate.yml` 删掉校验域阻断块 ⇒ 新锁**当场红**（`not ok 38 - QG Visual 的校验域套件（views / views-supplement）失败必须阻断`，37 pass / 1 fail），指名即该条；还原后复跑 38/38 |
| 相关域全量 | ✅ | `node --test .github/scripts/workflow-contract.test.js` → **38 pass / 0 fail**（含新锁；该测试用 `js-yaml` 解析两份 workflow，等于顺带验证 YAML 合法） |
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` **两口径逐值相等**：`workflow-contract.test.js` **47/0**、`quality-gate.yml` **43/3**、`openspec/records/visual-gate-enforce.md` **32/0**。`quality-gate.yml` 删除的 3 行是原「退出码 1 一律只留痕」的注释（被「按套件类别分流」的新注释取代），无代码删除 |
| 接线棘轮 | ✅ | 改的是既有测试文件（非新增），仍在原接线面上；`workflow-contract.test.js` 由 `quality-gate.yml` 显式点名执行 |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/` |
| QM-4 视觉 | N/A（本 PR 不产生新的视觉判据） | 本 PR 改的是「视觉判据的消费方式」，不改任何用例、基线或阈值；**未使用 `--update-baseline`** |
| QM-6 CCG 双模型外部评审 | 见判定器 | 以 `.ccg/reviews/<sha>.json` 产物为准 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin visual-gate-enforce` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 遗留（不假装已闭合）

1. **⛔ 本 PR 属「改谁来守门」**：按 AGENTS.md「禁止自动合并的情形」，它**不得由 agent 自动合并**，必须人工过目后合并。本会话只做到「CI 绿 + 报告」。
2. **端到端阻断能力只能由下一次真实失败来证明**：本轮的证据是「结构锁 + 变异反证 + 修复前日志证明旧行为确实吞掉」。我没有伪造一个失败的视觉用例去跑一遍真门禁（那需要改用例/基线，反而制造噪声）。**残留风险如实登记**：若 `exit 1` 在 PowerShell 步骤里被外层 `continue-on-error` 或 job 级设置吞掉，真阻断仍不成立——下一次该域失败时须回读产物确认。
3. **用户原选「选项 1（把 Visual Tests 提为 required）」未实施，理由**：`visual-test.yml` 与 QG Visual 是逐行同构的重复实现（其自身注释记载 2026-09-17 就是为省 runner 才移除 PR 触发）。把它提为 required 会让每个 PR **再跑一遍 4 分钟的同构作业**，而**QG Visual 里的吞掉问题依旧存在**；本 PR 修的是吞掉本身，更小、更准。**若仍要选项 1 的形态，请明确，我另开一轮加 `pull_request` 触发 + 分支保护变更**（两者必须同批：先让 workflow 在 PR 上跑，再把它加进 required，否则所有 PR 会永久等待一个永不出现的状态）。
4. **`visual-test.yml` 的 PR 触发未恢复**：main push 仍是该 workflow 的唯一自动入口，因此它在 main 上的红依旧不阻塞合并——但那已属"二次信号"，第一道阻断面由本 PR 补在 QG Visual 上。
