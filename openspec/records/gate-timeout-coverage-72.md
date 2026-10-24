---
record: gate-timeout-coverage-72
task: QG Coverage 作业超时预算按实测分布重定数（65→72）+ 修掉 12 处指向不存在脚本的坏指针
date: 2026-10-24
branch: gate-timeout-coverage-72
---

| 远程同步 | 由门禁推导 |

## 变更类型与隔离

CI 变更（改了 `.github/workflows/quality-gate.yml`）⇒ **不走 docs-only 通道**。
隔离分支 `gate-timeout-coverage-72`（裸 task 名，无斜杠），基线 `origin/main@2812034199`。

## 改了什么

| 文件 | 改动 | 依据 |
|---|---|---|
| `.github/workflows/quality-gate.yml` | `QG Coverage` 作业级 `timeout-minutes: 65` → **72** | 120 趟窗口（与采集器同口径）实测 `max=47.37` ⇒ `ceil(47.37 × 1.5) = 72 > 65` ⇒ 旧档已低于本仓自己的 ×1.5 规则。72 **恰好等于 required，不多给**（与 2026-10-19 那次 `40→60→65` 同一口径） |
| `scripts/gate-timeout-registry.json` | coverage 条目 `timeoutMinutes` 65→72；`provenance` 换真实重采样值（`samples=51 / max=47.37 / p90=45.27 / ceilingMinutesSampled=72 / runsListed=120 / collectedAt=2026-10-24`） | 同上；`ceilingMinutesSampled` 必须随新天花板从 60 改到 72（原来绑的是旧档） |
| `scripts/lib/gate-timeout-registry.js` | `remeasureCommand` 指向的采样脚本名修正 | 指向 `scripts/gate-timeout-sample.js`（**该文件不存在**）⇒ 改为实际存在的 `scripts/coverage-budget-sample.js` |
| `scripts/coverage-budget-sample.js` | 采样器输出的 `remeasureCommand` + 3 处注释里的脚本名修正 | 同上；采样器是「谁去重采」的执行体，它输出的命令指向不存在的脚本 ⇒ **下一个人照着跑会失败** |
| `scripts/check-coverage-budget.js` | 2 处提示文案里的脚本名修正 | 同上；这是判据给操作者的指引，指向不存在的脚本等于把人引到死路 |
| `scripts/check-coverage-budget.test.js` | 1 处注释里的脚本名修正 | 同上 |
| `01-docs/PRD-GATE-TIMEOUT-GOVERNANCE-2026-10-20.md` | 逐格数值表里 `QG Coverage` 那行同步为 65→72 / 53→51 / 43.3→47.37 / 41.4→45.27 / 65→72 / 0→0 | 避免 PRD 与现场脱节（该表是"来路与设计取舍"的载体） |
| `openspec/changes/gate-timeout-coverage-72/`（新增四件套） | proposal / design / tasks / specs | CI 变更按仓内先例建 openspec change（先例：`gate-timeout-all-cells`） |

**坏指针共 12 处在代码路径上全改净**（全仓 `gate-timeout-sample` / `check-gate-timeouts` 两个不存在的路径）：
注册表顶层 note 1 处、注册表 schedule-heartbeat 条目 note 1 处、加载器 `remeasureCommand` 1 处、
采样器注释 3 处 + **采样器实际输出** 1 处、判据提示文案 2 处、锁注释 1 处
（以上 10 处见首个提交 `e77ffd668`），
**外加主干 `f10847fae` 新引入的 2 处**（见「合并主干」一节）。
改动后在 `.github/` 与 `scripts/` 全量复查两个路径 ⇒ **0 命中**。

**残留 3 处不在代码路径上，本次不改**：`openspec/records/schedule-heartbeat-lock.md:61`、
`openspec/records/schedule-heartbeat-lock.md:70`、`openspec/changes/schedule-heartbeat-lock/tasks.md:100`
—— 那是**在途 change 的任务清单与历史执行记录**，改它等于替别人的 change 改口径；且其中
「必须用 `scripts/gate-timeout-sample.js` 重采」这条指引会误导执行者 ⇒ **已登记**，等该 change 自己收口时一并订正。

## ★ 合并主干：主干在修复前又新增了 2 处同类坏指针

- **base 前进**：推之前 `git fetch` 发现 `origin/main` 已从 `281203419` 前进到 `f10847fae`（20 个提交）。
- **合并无冲突**：`git merge origin/main` **未产生冲突** —— 注册表是「每个 job 压成一行」的紧凑格式，
  本 PR 改的是 `coverage` 那一行、主干加的是 `dep-audit-refresh` 那一行 ⇒ Git 按行自动合并。
  合并后复查：coverage 行是新值（`timeoutMinutes: 72` + 新 provenance），主干的 `dep-audit-refresh` 行也在。
- ⚠️ **主干在修复前又引入了 2 处同样的坏指针**（本 PR 的存在意义正是治这个病，故一并修掉）：
  ① `.github/workflows/dep-audit-refresh.yml:53` 的注释「30 天宽限期内必须用 `scripts/gate-timeout-sample.js` 重采」；
  ② `scripts/gate-timeout-registry.json` 里 `dep-audit-refresh` 那条登记的 `provenance.note` 文本中的同一句。
- ⚠️ **第 ② 处的修法受 parity 锁约束**：那行本来就在 `provenance` 里带 `note` 字段
  ⇒ 只能**改 note 的文本内容**（脚本名）⇒ **既不能删 `note`、也不能新增字段** ⇒ 字段集不变 ⇒ 不撞 parity 锁。
- ⇒ 坏指针代码路径总数：**10 → 12 处**。

## ★ 本次踩到的三个坑（自己引入、自己抓出）

**坑一：第一版在 coverage 条目的 `provenance` 里加了 `note` 字段记录依据 ⇒ `check-coverage-budget.test.js` 第 7 条锁当场红。**

- 根因：该锁比对「**采集器产出的字段集**」与「**判据常量的 PROVENANCE 字段集**」是否逐字相等。
  `note` 是注册表条目可以带的**说明字段**，但**采集器 `buildProvenance` 不产它** ⇒ 字段集多出 `note` ⇒ parity 锁红。
  `scripts/lib/gate-timeout-registry.js` 的 `coverageProvenance()` 会把条目 provenance 原样透传 ⇒ 多一个键就直通。
- 判据：**改注册表条目的字段集之前，先看采集器产什么、锁比什么** —— 不是「注册表允许什么」的问题。
- 修法：`note` 从 provenance 移除，依据改放 **workflow 注释**（已在该处）+ 本执行记录 + change 的 design。
- 验证：对照实验 —— `origin/main` 上同一条测试 **26/26 全绿**，加上本次改动后 **25/26（1 红）**；
  移除 `note` 后回到 **26/26**。⇒ 因果确凿，不是主干存量红。
- ⚠️ 仓里有个**误导性先例**：`schedule-heartbeat` 那一格的 provenance 里就带 `note`，
  但那一格**永远不会被 `coverageProvenance()` 取到** ⇒ 不构成「可以往 provenance 塞 note」的依据。
  （主干新加的 `dep-audit-refresh` 那格同理。）

**坑二：`git add -A` 会把门禁自己的变异探针扫进提交 ⇒ PR 必红。**

- `scripts/check-text-encoding-integrity.test.js`（第 73-89 行）会**故意写一个含 U+FFFD 的文件**
  `01-docs/__encoding-gate-mutation-probe.md` 并 `git add -N` ⇒ **跑完残留在工作区与暂存区**。
- 被 `git add -A` 扫进提交后：`node scripts/check-text-encoding-integrity.js` 当场 `EXIT=1`「新增 1 处编码损坏」
  ⇒ changes job 红 ⇒ 8 个重型作业被 needs 跳过 ⇒ gate-result exit 1 ⇒ **PR 必红**。
- 修法：**提交前用明确文件清单 `git add`，不用 `-A`**；跑完该门禁后 `git status` 复查，
  并用 `git rm --cached` + `rm` 清掉被 `git add -N` 标记的残渣。

**坑三：改「看起来是 JSON 的台账」不能整文件重写。**

- `scripts/gate-timeout-registry.json` 的排版是**每个 job 压成一行**的紧凑格式。
  用 `json.load` → 改 → `json.dumps(indent=2)` 写回 ⇒ **diff 变成 430 行变化（+409/−28）**，而实际只改了一个条目。
- 正解：**定位那一整行 → 文本级最小替换** ⇒ 同处改动 **430 行噪音 diff → 3 行**。
- 判据：`json.loads` 成功**不代表** `json.dumps` 能写回同一个形状 ⇒ 改前先看真实排版，写回后必须 `git diff --stat` 看形状。

## 质量节拍适用性

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ **`docs-only=false`（8 个文件）**
  ⇒ 改了 `.github/workflows/` 与 `scripts/` 工具脚本 ⇒ 按 `AGENTS.md` 属**混合 PR** ⇒ 跑**完整**质量节拍。
- **QM-1（electron 主进程打包验证）不适用**：触发条件是「修改 `apps/desktop/electron/` 或 `packages/rpa-engine/` 下代码」，
  本 PR 两个目录都不碰 ⇒ 不跑打包。作为佐证，`scripts/qm1-child-env.test.js` 7/7、`scripts/qm1-paths.test.js` 10/10 本地全绿。
- **QM-6（双模型外部评审）不强制但已执行**：本 PR 以 `openspec/` + `docs/` + `scripts/` 工具脚本为主，
  按 `AGENTS.md` 不强制；实际已用多轨独立审查执行（量化 / 门禁 / 契约安全 / 流程 CI / 对抗性红队），
  其结论**逐条回源码与实跑复验后**才落盘 —— 坑一、坑二正是被独立轨道复现后确认的。
- **QM-5 行题约定不适用于本篇执行记录**：`scripts/check-record-qm5-rows.js` 的进域判据是
  「记录里出现该步骤标记」⇒ 一条都没有 ⇒ 不进域、不要求补齐步骤。
  ⇒ 本篇记录**不得**写入该形态的标记，否则会立刻要求四步齐全而当场红。

## CCG 双审查（dual）的执行与边界声明

- **两个判据口径不同，不可混为一谈**：
  ① `scripts/ccg-review-decider.js` 的 `dualLineThreshold = 200` 是**变更行数**判据 ⇒ 本 PR 总 diff 超阈值 ⇒ 按此口径**应判 dual**；
  ② `scripts/check-pr-exec-record.js` 的 `TIER-COVERAGE` 统计的是**已闭合记录的 tier 分布**（本 PR 读数 `dual-closed total=0`）
  ⇒ 它**不判**「本 PR 是否需要双审查」。二者不矛盾。
- **本地实跑读数（如实记录）**：`node scripts/ccg-review-decider.js --base origin/main` ⇒
  该脚本判的是**暂存区** diff（`--base` 只用于命名回退）⇒ 暂存区空时它只看到 27 行 / 6 个源文件 ⇒ 判 **SINGLE**；
  同时它探测后端 CLI（claude / opencode）**均不可用** ⇒ 输出
  「降级为 SELF-REVIEW：必须由 agent 自行完成评审并记录结论」。
  ⚠️ 这个 SINGLE 读数**采的是空的暂存区，不是 PR 场景的判定** ⇒ **不据此声称「无需双审查」**。
  ⚠️ 该脚本会往 `.ccg/reviews/` 落一份判定存档 ⇒ 本次判定存档**不纳入提交**（它基于上述失真读数）。
- **CI 侧是否阻断**：**不阻断**。`quality-gate.yml` 的 Gate 2c4 只跑 `scripts/ccg-review-decider.test.js`
  （判据自身的回归锁），**不调用 decider 对本 PR 做模式判定** ⇒ 无论 SINGLE / DUAL 都不改变 PR 的红绿。
- **实际执行（按 SELF-REVIEW 路径）**：以**多轨独立审查**替代单一后端 —— producer / verifier 分离、
  每轨关注轴不同、结论**逐条回源码与实跑复验后**才落盘。
  五轨：① 量化（CI 预算重采样与判据复算）② 门禁（各门禁判据与接线）③ 契约与安全（字段集 parity / 注入面）
  ④ 流程与 CI 治理（required checks / 合并取数）⑤ 对抗性红队（寻找「我以为修好了」的那一格）。
  本轮三条**独立复现并确认**了我自己引入的缺陷：provenance `note` 撞 parity 锁、`git add -A` 带入编码变异探针、
  坏指针计数与明细不一致（汇总写 8、明细列 10）⇒ 三个坑都是「独立审查 + 实跑复验」抓出来的，不是自审发现的。
- **未闭合项**：原生 CCG 双后端评审**在本沙箱未执行**（无 Windows + PowerShell + 已配置后端 CLI），
  本条**不声称已闭合**，需在具备该环境处补跑。

## 验证

| 项 | 命令 | 结果 |
|---|---|---|
| 预算判据的锁 | `node --test scripts/check-coverage-budget.test.js` | **26/26 pass** |
| 预算门禁本体 | `node scripts/check-coverage-budget.js` | **OK 全部 25 格**；coverage 读数 `timeout=72 需≥72 余量=0 floor=47.37 samples=51 max=47.37 p90=45.27` |
| 逐文件行数门禁 | `node .github/scripts/check-max-lines.js` | ✅ 无新增超大文件 |
| 编码完整性 | `node --test scripts/check-text-encoding-integrity.test.js` | **5/5 pass** |
| 文档绝对路径 | `node --test scripts/check-doc-abs-paths.test.js` | **52/52 pass** |
| 未接线测试 | `node --test scripts/check-unwired-tests.test.js` | **39/39 pass** |
| 定时心跳 | `node --test scripts/check-schedule-heartbeat.test.js` | **16/16 pass** |
| 执行记录欠账 | `node --test scripts/check-gate-record-debt.test.js` | **122/122 pass** |
| 债务预算 | `node scripts/check-debt-budget.js` | ✅ 绿 |
| openspec 变更完整性 | `node scripts/openspec-sync-check.js` | ✅ `OK: 387 tasks, 102 active changes, 243 archives` |
| QM-5 行集棘轮 | `node scripts/check-record-qm5-rows.js` | ✅ 绿 |
| PR 执行记录门禁 | `node scripts/check-pr-exec-record.js --base=origin/main --head=HEAD` | ✅ `OK: 本 PR 携带执行记录或带原因的豁免`（13 文件 A=5 M=8） |
| CCG 判据回归锁 | `node --test scripts/ccg-review-decider.test.js` | **71/71 pass** |
| QM-1 佐证 | `node --test scripts/qm1-child-env.test.js` / `qm1-paths.test.js` | **7/7**、**10/10** |
| 文档-only 判定 | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` | `docs-only=false`（混合 PR） |
| 坏指针复查 | `grep -rn "gate-timeout-sample\|check-gate-timeouts" .github scripts` | **0 命中** |
| 行尾与编码 | `git ls-files --eol` / U+FFFD 扫描 | 全 `w/lf`、U+FFFD **0** |
| 改动面（单提交） | `git diff --stat origin/main..HEAD` | 13 文件 **+369 / −16** |

## 待办 / 未纳入

- **本 PR 尚未开**，等确认后再推远端与开 PR。
- openspec change **已建**（`openspec/changes/gate-timeout-coverage-72/`，四件套齐备），
  合并后归档至 `openspec/changes/archive/2026-10-24-gate-timeout-coverage-72/`。
- `openspec/` 内 3 处残留坏指针**未改**（理由见上），等 `schedule-heartbeat-lock` 那个 change 收口时订正。
- 未做：把 `check-coverage-budget.js` 错误提示里「跑采集器重采」的命令**按当前窗口**写死（采集器自己会带 `--limit`，不需手改）。
