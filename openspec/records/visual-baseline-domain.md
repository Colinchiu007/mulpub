---
record: visual-baseline-domain
task: 视觉判定域对账——把"注册表声明的视图 × 浅暗两档"钉成判定域，60 条缺基线 + 3 条无主基线带理由登记，清单只能缩小
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

# 视觉判定域对账（visual-baseline-domain，2026-10-11）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR | `classify-docs-only --base=origin/main --head=HEAD` → `docs-only=false`：变更集含 `.github/workflows/quality-gate.yml` 与 `apps/desktop/tests/visual-testing/views/all-views.visual.test.js`。隔离 worktree `D:/Data/projects/mp-worktrees/mp-visual-baseline-domain`／裸分支 `visual-baseline-domain`，base `b96276b1f`（= 当时 origin/main tip，`git rev-parse HEAD` 与 `git log origin/main -1` 同 sha，非滞后基线）；依赖三连 `pnpm install --frozen-lockfile` + `ensure-electron.js` + `verify-worktree-deps.js` |
| 规格与方案 | ✅ | `01-docs/PRD-VISUAL-BASELINE-DOMAIN-2026-10-11.md`（§2 十二行实测表、§3 四层逃逸链 + 两处不实注释、§5.1 四条防自坏判据、§5.2 六条变异、§6 PR B 范围切割与理由） |
| 第一性原因 | ✅ 实测 | 框架里有"注册视图"动作，没有"注册 ⇒ 必须被守"的不变量。`ERR_VISUAL_BASELINE_MISSING` 只在 `test-runner.js:563` 的 `pixelRegressionTest` 内抛，另两套走 `aiVisionTest` ⇒ 缺基线在采集套件里结构性不可见；`check-baseline-freshness.js` 迭代域是 `readdirSync(基线目录)`，只看**存在**的基线 |
| 回归保护 | ✅ | `scripts/check-visual-coverage.js`（判定域 = 三表并集 × `THEMES`）+ `scripts/check-visual-coverage.test.js` 12 例：C1 内联 `]`／嵌套数组不截断、C1b 混用写法必须出声、C2 规模逐字对上、C3 三种解析失败形态各自抛错、C4 跨套件去重、C5 未登记缺口点名视图+主题+所在套件、C6 登记齐备判绿且补图后陈旧判红、C7 无主基线登记与只能缩小、C8 空域不得判绿、C9 主题闭合两档、C10 缺 reason 判红、C11 真实仓臂 + 三条规模下界 |
| 存量对齐 | ✅ | `scripts/visual-coverage-debt.json` 由 `gen_debt.cjs` **从实测产物生成**（非手写）：gaps=60、orphans=3，每项带 reason 与出处；生成脚本要求"清单只能缩小" |
| 注释纠偏 | ✅ | `all-views.visual.test.js:49`（`accounts-list-flag-on`）与 `:92`（`podcast-channel`）原文承诺"首次运行必然报 `ERR_VISUAL_BASELINE_MISSING`"——该码在本套件永不抛。两处改为实测事实：本套件只采集不比对，缺基线由 `check-visual-coverage.js` 挡住；grep 复扫全仓该措辞现只剩 `test-runner.js` 的实现与 `test-runner.test.js` 的行为锁 |
| CI 接线资格 | ✅ 判据写明 | 接进 `quality-gate.yml` Gate 2c（`shell: bash`，天然 fail-fast）。资格论证（AGENTS.md「接进的 job 会不会被 docs-only 整片跳过」四问）：本锁的**输入**只有 `apps/**`、`scripts/run-pixel-tests.js`、`scripts/visual-coverage-debt.json`，三者均不在 `CI_IGNORED_PATHS`（该名单里 `scripts/` 只有一条 `gate-record-debt-ledger.json` 字面量）⇒ 改到任何输入都不可能走 docs-only 短路绕过。与 gate-record-debt-ledger 必须搬去 changes job 是同一条判据的反向应用 |
| 接线 / fail-fast | ✅ | `node scripts/check-unwired-tests.js` → `检查域内测试文件 73 个 / OK`；`node scripts/check-step-failfast.js` → `含 ≥2 条测试命令的 run 步骤：6 个 / OK` |
| `.gitignore` 反选 | ✅ | 三条 negation（`.js` 本体 / `.test.js` / `.json` 账本）。判据不是"status 看得见"而是 `git check-ignore --no-index -v`：改前 `scripts/check-visual-coverage.js` 被第 106 行 `scripts/*.js` 静默吞掉、CI 侧会 `Cannot find module` |
| 消费者并集 | ✅ | `grep -rln "all-views.visual.test"` 取到 8 个消费者；除本锁外跑 `node --test scripts/check-baseline-freshness.test.js`（36 pass）、`node --test .github/scripts/workflow-contract.test.js`（35 pass）、`pnpm exec vitest run tests/visual-ci.test.js electron/tests/visual-view-runner.test.js tests/visual-testing/visual-readiness-classification.test.js`（3 files / 49 tests passed） |
| 变异反证 | ✅ 6/6 | `node D:/Data/projects/.tools/tmp/vb66/mutate.cjs` → `MUTATION_ALL_CAUGHT (6)` + `RESTORE_BYTE_IDENTICAL=yes`。一次返工：M6 首跑 `rc=undefined / caught=NO` **不是锁没逮住**，是我的锚点在源码里不存在（变异从未发生）⇒ 驱动改为把 `SKIPPED_ANCHOR_hits=0` 与 `caught=NO` 分开印 |
| 行尾两口径对账 | ✅ | 见下方「收尾」行的 numstat 对照 |
| 品牌残留 / 文档同步 | PENDING（CI 侧） | 本轮未新增任何竞品品牌字样（入库文本一律「参考产品」口径不适用，本 PR 无相关表述）；`文档同步检查` 以 CI 为准 |
| 远程同步 | PENDING | PR 尚未开出 |

## QM-5 五步

1. **第一性原因**：视觉框架从建立起就把"注册"与"被守"写成两件事——`run-pixel-tests.js` 的 `pixelTests` 是**比对域**，`all-views`/`supplementary-views` 是**采集域**（喂 Gate 7b 的新鲜度对照），两者没有任何交集判据。缺陷不是某次提交引入的，而是**从来没有那条判据**（所以 `git blame` 在这里给不出"引入点"，能给的是"两处承诺了不存在的行为的注释"，其文字随 `accounts-list-flag-on` 与 `podcast-channel` 两个视图各自加入时写入）。
2. **逃逸分析**：逐层见 PRD §3 表。最尖的一条是新鲜度门禁——它的迭代域是"目录里有什么"，所以它对"该有却没有"这一整类**结构性免疫**；而 `all-views` 里两处注释承诺了一个永远不会抛的错误码，把"等红"变成了合法的心理预期。
3. **系统性漏洞**：测试场景缺失（没有"声明域 ⊆ 判定域"这条不变量）+ 文档误导（注释描述的错误码不在该代码路径上）。
4. **修复 + 回归保护**：新增 `scripts/check-visual-coverage.js` 把判定域钉成三表并集 × 两档主题；实测 60 条缺口与 3 条无主基线全部带 reason 登记进 `scripts/visual-coverage-debt.json`（清单只能缩小）；纠正两处注释；接进 Gate 2c。
5. **防止再次发生**：AGENTS.md QM-4 下新增 MUST「注册即判定域」；learnings 记录「迭代 `readdirSync` 的门禁对『该有却没有』结构性免疫」与「锚点没命中 ≠ 变异没逮住」两条。

## 不在范围（登记，不静默修）

- **PR B**：把 CI artifact 同源渲染提升为仓库基线，逐批把 60 项登记清零。理由见 PRD §6。
- **3 张无主基线的去留**：`analytics-overview` / `login-form` / `settings-general`。删除他人文件属破坏性动作，本轮只登记不裁决。
- **采集套件是否应升级为比对套件**：把 `aiVisionTest` 换成 `pixelRegressionTest` 会一次性引入 30 个视图 × 2 档的判定，等于在没有对账器兜底的那一轮同时制造 60 个潜在漂移源；正解是先做 PR B。

## 收尾（合并后回填用）

- 待回填：本文件与 `.quality-gates.md` 的远程同步行、删除 frontmatter 三个 `sync_` 字段、删除 `scripts/gate-record-debt-ledger.json` 登记项（必须同一次提交）。
