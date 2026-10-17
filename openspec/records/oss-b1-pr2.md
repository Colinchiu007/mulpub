---
record: oss-b1-pr2
task: B1 PR-2 第一批——sidecar-host 基建（§6 全部）+ F3 camofox 四项（§7.2/7.3/7.4/7.5）
date: 2026-10-16
---

## 本次执行记录：B1 PR-2 第一批 sidecar-host + camofox 驱动 + 通道路由 + 构建期断言（oss-b1-pr2，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `<repo-parent>/mp-worktrees/mp-oss-b1-pr2`（`$MP_WORKTREES` 默认根，非共享根）+ 裸分支 `oss-b1-pr2`，由 `scripts/start-mp-task.ps1 -TaskName oss-b1-pr2` 创建（依赖/electron/verify-worktree-deps 全 OK）；共享根保持 main 干净，未在共享根落盘 |
| 第一性原因（QM-5 ①） | N/A | 新功能（PR-2 基建），非 bug 修复 |
| 逃逸分析（QM-5 ②） | N/A | 新功能，无逃逸链 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 5 个测试文件 **56 用例全绿**（本轮再增 `fetch-camofox.test.js` 11 例，合计 **67**）；变异反证 **29 条全 CAUGHT**（本轮新增 4 条 allowBuilds 变异 ⇒ **33**），每条按「字节快照备份 → 变异 → 跑测 → 整文件写回 → md5 校验还原」执行 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 契约锁固化在脚手架上（sidecar-host 五态、lock 校验三判据、camofox 监听回环、路由禁静默回落、构建期非回环断言）；② 三条方法论教训写入代码注释与 commit message；③ AGENTS.md 三条既有规则（QM-1 env/存活、TaskQueue、发布内容保真）已逐条自查与本批无关 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（本批 13 文件纯新增为主，`publish-capabilities.js` 为既有文件追加） |
| 接线棘轮 | ✅（已订正） | 4 个 vitest 测试文件落在 `vitest.config.js` 既有 include 域内（`electron/services/**`、`electron/services/stealth/**`、`packages/shared-utils/src/__tests__/**`）；`apps/desktop/scripts/` 下两个 `node:test` 文件**原先对棘轮结构性隐形**（`vitest.config.js` 的 include 白名单不含 `scripts/**`，而 `check-unwired-tests.js` 的 `WORKSPACE_COVERED` 又跳过整棵 `apps/` 子树）⇒ 本行早先写的「由 CI 点名链执行」**是假结论**，本轮已显式点名进 Gate 2b，详见下方「接线补课」节 |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未触 `apps/desktop/electron/` 打包面（本批新增 `electron/services/` 与 `scripts/`、`packages/shared-utils/`，未改主进程入口/preload），无 UI 可见变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机 `codeagent-wrapper` 不可用（前端轴历史三次失败、后端轴在 PR-1 已跑过；本批为 PR-1 同 change 的延续，未重新发起双模型评审）。如实登记为**未执行**，不以自审冒充通过 |
| 远程同步 | PASS | PR #3677 已 squash 合并：merge SHA `f818c214e0df595e354f75bf39e1137862316b03`，提交时间 `2026-10-17T14:44:08+08:00`（= `2026-10-17T06:44:09Z`）；取证用 AGENTS.md 原式 `git log origin/main --grep='(#3677)$' --format=%H\|%cI`（恰命中 1 行，不带反斜杠）；`git ls-remote --heads origin oss-b1-pr2` 返回 0 行证远端分支已删；本 PR 属「旧载体冻结」之后的新 PR ⇒ 未向 `.quality-gates.md` 插块、未向 `scripts/gate-record-debt-ledger.json` 加键，回填只发生在本文档内；表行 / bullet / frontmatter 三个 `sync_*` 字段这三处改写与新增「CI 终态」节在**同一次提交**内完成 |

- 保留门禁：不适用（本 PR 为混合变更，非 docs-only）| merge `f818c214e0df595e354f75bf39e1137862316b03`（2026-10-17T06:44:09Z）| 远端分支已删（`git ls-remote --heads origin oss-b1-pr2` 0 行）| 远程同步 PASS

### 交付物与判据

| 文件 | 用例 | 变异 |
|------|------|------|
| `apps/desktop/electron/services/sidecar-host.js` + `.test.js` | 8 | 5/5 CAUGHT |
| `apps/desktop/sidecar-lock.json` + `sidecar-lock.{js,test.js}` | 13 | 6/6 CAUGHT |
| `apps/desktop/electron/services/stealth/stealth-channel-camofox.js` + `.test.js` | 17 | 8/8 CAUGHT |
| `packages/shared-utils/src/publish-capabilities.{js,browser.js}` + `__tests__/publish-channel-routing.test.js` | 8 | 5/5 CAUGHT |
| `apps/desktop/scripts/check-camofox-listen.js` + `.test.js` | 10 | 5/5 CAUGHT |
| `apps/desktop/scripts/fetch-camofox.js` + `.test.js`（本轮增补 #3/#4） | 11 | 4/4 CAUGHT |
| **合计** | **67** | **33/33** |

本地门禁全 rc=0：`eslint` / `check-max-lines` / `check-unwired-tests` / `check-no-brand-residue` / `check-workflow-structure`；`packages/shared-utils` 全量 **51 files / 1042 passed / 10 skipped** 无回归。CI **第一轮**：**20 pass / 0 fail / 0 pending**（含此前 B1 踩过的 `债务熔断门禁`，本次直接 success）。第二轮 13 连红及其根因、修法见下节。

### CI 第二轮 13 连红：根因、A/B 证据与修法（2026-10-16）

第一轮读数（上一节末）之后 PR-2 推到第 14 个提交 `a641e0417`，第二轮变成 **13 fail / 1 pass（`QG Changes`）**：`GUI Gate Result` / `Gate Result` / `QG Static` / `QG Unit Tests` / `QG Coverage` / `QG Visual` / `QG Desktop Shards (1/2)(2/2)` / `QG Browser E2E` / `QG Autonomous` / `QG Business API Postgres` / `build` / `gui-test`。归因先做对照：同期 main 的 quality-gate 红在 `Detect docs-only changes`（另一因）、另一分支 quality-gate 绿 ⇒ **确为本 PR 分支特异**，不是上游红。

**第一性原因**：`pnpm-workspace.yaml` 的 `allowBuilds` 里 `better-sqlite3: true`。它是 §7.1 引入的 `@askjo/camofox-browser@1.18.1` 的传递依赖（无 `install`/`postinstall`，deps 仅 `node-addon-api@^8`），而 pnpm 对「有 `binding.gyp` 且无 install 脚本」的包**自动注入 `node-gyp rebuild`**；放行后每次 install 都要本机 VS C++ 工具链，runner 的 `node-gyp@9.4.1` 认不出 VS 18（`unknown version "undefined" found at "<VS 安装根>\Microsoft Visual Studio\18\Enterprise"`）⇒ install rc=1 ⇒ 13 个下游作业连红。

**隔离 A/B 探针**（`<scratch>/camofox-gate-probe\{probe-true,probe-false}`，同 lock、同 pnpm，只翻 allowBuilds 一格）：

| 档 | install | 执行 node-gyp | `require('better-sqlite3')` |
|----|---------|---------------|-------------------------------|
| `better-sqlite3: true` | **rc=1** | 是（`Could not find any Visual Studio installation`） | — |
| `better-sqlite3: false` | **rc=0** | 否（无构建步骤） | **成功**（走包内 `prebuilds/`） |

**修法**：`true → false` + 11 行中文注释（`false` 是 pnpm 语义里的显式拒绝；**删掉该行反而更糟**——退回缺省即允许）。不回退依赖声明：该包自带 `prebuilds/`（含 `win32-x64.node` = 1,988,096 字节），`lib/binding.js` 回落 `prebuilds/${target}.node`，且全仓 `require('better-sqlite3')` 命中 0。**回归锁**（`apps/desktop/scripts/fetch-camofox.test.js` 新增 #3/#4）：#3 断言 `@askjo/camofox-browser` **不在** `allowBuilds` 条目里（其 postinstall 会拉 ~500MB 且零 sha256 校验）；#4 断言 `better-sqlite3` 条目存在且为 `false`。判据按**行**解析 `allowBuilds`（跳过注释/空行、遇 0 缩进 break）+ 条目数下界，避免把新增注释纳入段内使既有 `!/camofox/` 断言误红。 ⚠️ **该行与上句的解析器随后被下一轮 CI 打穿**：camofox 必须**在 `allowBuilds` 里显式写 `false`**（三档语义：键**缺席** = *ignored build* ⇒ `ERR_PNPM_IGNORED_BUILDS` + install rc=1；`true` = 真跑 postinstall 拉 ~500MB；`false` = 不构建且 rc=0），且「遇 0 缩进 break」会让条目上方 0 缩进的注释提前终止解析 ⇒ 旧锁「该键不存在」**恒真**。详见下方「CI 第四轮」节。

### 接线补课：两个测试文件此前根本没在 CI 跑过

`check-unwired-tests.js` 曾对 `fetch-camofox.test.js` / `check-camofox-listen.test.js` 报 OK，**但那是假结论**：

- `apps/desktop/vitest.config.js:23-46` 的 `include` 是白名单，**不含 `scripts/**`** ⇒ 两个 `node:test` 文件不被 vitest 收集；
- `scripts/check-unwired-tests.js:24` 的 `WORKSPACE_COVERED = ["apps/","packages/","ops-center/"]` 使 `:117` 的遍历**整棵 `apps/` 子树跳过** ⇒ 它们对「接线棘轮」结构性隐形。

即「棘轮说 OK」在这里等于「棘轮没看见」。修法：在 `.github/workflows/quality-gate.yml` 的 Gate 2b（`shell: bash`）**显式点名**两文件（与同目录 7 个兄弟文件一致，不做通配）。

**残留风险（不修，如实登记）**：`WORKSPACE_COVERED` 豁免整个 `apps/` 子树的洞口仍开着 —— 任何落在 `apps/*/scripts/**` 的 `node:test` 文件都对棘轮隐形，只能靠人记得手写接线。修它属改「谁来守门」，另开 PR。

### CI 第四轮：`ERR_PNPM_IGNORED_BUILDS` 单一根因连红 12 个作业（2026-10-16，head `c90a72a1d`）

> **序号口径**：本节按 **PR 正文**的轮次称呼（其已有节为「追加：CI 5 个 workflow 红的归因与修复」（ip-address 轮）与「第三轮：`better-sqlite3` 构建脚本硬阻塞 + 接线补课 + 吸收 main」）⇒ 本节 = **第四轮**。本记录把 better-sqlite3 那轮写作「CI 第二轮 13 连红」（记录侧未给 ip-address 轮编号）⇒ 两处序号**一一对应**：**PR「第三轮」= 记录「CI 第二轮」**，不是两件事。

`c90a72a1d`（吸收 main 后的第 3 次推送）三处 workflow 同因失败，**不是逐个修**：

| workflow | run / 失败作业 | 失败步骤 |
|---|---|---|
| quality-gate | `38855726731`：`QG Static`(116826795077) / `QG Unit Tests`(116826795027) / `QG Coverage`(116826795014) / `QG Visual`(116826795107) / `QG Browser E2E`(116826795132) / `QG Autonomous`(116826795019) / `QG Desktop Shards (1/2)`(116826795131) / `(2/2)`(116826795025) / `QG Business API Postgres`(116826795031) 共 9 个作业 + `Gate Result`(116827217144) 连坐 | `Install deps` |
| Build & Release | `38855726713`：`build`(116826733253)（`release` skipped） | `Install dependencies` |
| GUI Tests | `38855726681`：`gui-test`(116826722411) + `GUI Gate Result`(116827008342) 连坐 | `Install dependencies` / `Verdict` |

同 run 的 `QG Changes`(116826631704) = **success**（未连坐，因它在 `Install deps` 之前就结束了）。

三处日志剥 ANSI 后**逐字同一行**（取回：`gh api repos/Colinchiu007/mulpub/actions/jobs/<id>/logs --allow-escape-sequences` → Node 剥 ANSI；`gh run view --log-failed` 对大日志会静默返回空）：

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @askjo/camofox-browser@1.18.1
##[error]Process completed with exit code 1.
```

⇒ 单一根因，修一处即可全绿。

**第一性原因**：pnpm 11 对「带 build 脚本的依赖」要求**在 `allowBuilds` 里显式表态**。§7.1 写的「不加进 `allowBuilds`」在 pnpm 10 语义下等于「不构建」，在 pnpm 11 下是**第三种状态**：判 *ignored build* 并让 `pnpm install` **rc=1**。

**三档语义（本机同 lock / 同 pnpm 逐档探针实测）**：

| `allowBuilds` 内的键 | install | 行为 |
|---|---|---|
| 键**缺席** | **rc=1** | `Ignored build scripts: @askjo/camofox-browser@1.18.1` + `ERR_PNPM_IGNORED_BUILDS` |
| 显式 `false` | **rc=0** | 从 ignored 列表消失、不构建（**正解**） |
| 显式 `true` | rc=0 但**真跑 postinstall** | 拉 ~500MB 构件，且该 wrapper 的下载链路**不做任何 sha256 校验** |

**A/B（可复跑，`node <scratch>/p2-ab-driver.js`）**：BEFORE 腿取**补丁前 blob**（`git show HEAD:pnpm-workspace.yaml`，sha256 `fdd6b6a09992d878`，6183 B，`camofox=undefined`）⇒ **rc=1** + 命中 ignored-builds 行；AFTER 腿取工作副本（sha256 `e716b92993e0ed25`，7017 B，`camofox=false`）⇒ **rc=0** 且无错误行；两侧除 camofox 键外**键集与 overrides（5/5）逐条一致**。

**第二个真因：解析器陷阱让旧锁变成装饰性门禁。** `fetch-camofox.test.js` 的 `readAllowBuilds` 原实现「遇 0 缩进即 `break`」，而新条目的注释块**写在条目上方且为 0 缩进** ⇒ 解析在第一行注释处提前终止，`@askjo/camofox-browser` 永不可能进 `entries`；于是**旧锁「断言该键不在 `allowBuilds`」在此形态下恒真** —— 它的「绿」与「解析压根没走到那一行」完全同形（本仓「装饰性门禁」的又一落点，与 AGENTS.md 里点名的两种落点同族）。修法三处：① 注释/空行跳过**前置于**缩进判定；② 剥引号（YAML 里 `@` 不能起 plain scalar ⇒ 必须写 `'@askjo/camofox-browser': false`）；③ 取值白名单（只认 `true|false`）+ 条目数下界 6。锁 #3 由「不在 map 内」**翻转为**「在 map 内且 `=== false`」。

**变异反证 7 条**（`p2-mutations.js` 6/6 CAUGHT + 成对反证 `p2-mutation-m7.js`）：M1 `false→true`；M2 整行删除；M3 去 `**`；M4 解析器退回「先 break」；M5 退回不剥引号的旧正则；M6 下界抬到 99；**M7 成对腿** —— 同一触发输入下「有白名单」变红、「白名单 no-op」变绿（**无触发输入时 no-op 恒绿**，那是实验缺触发，不是锁坏）。每条均 `restored=true` 且整文件写回后 md5 校验通过。

**推前门禁同口径复跑全绿**（`node <scratch>/p2-gates.js`，逐条落盘 `gate-<id>.txt`）：carrier(PR 档 `visible`) / 记录 QM-5 行 19/19 / `pr-exec-record` 锁 48/48 + `--mode=enforce` OK / brand-residue 6/6 / text-encoding 5/5 / no-conflict-markers 20/20 / ci-pr-changeset 11/11 / classify-docs-only 锁 27/27 / workflow-structure 锁 6/6 + 脚本 violations=0 / unwired-tests 锁 30/30 / step-failfast OK / workflow-contract 无 `not ok` / **Gate 2b 同形两文件 21 tests / 21 pass** / `check:deps` No depcheck issue；**Gate 11**（`pnpm exec eslint electron/ src/ --quiet`，cwd `apps/desktop`）rc=0，stdout/stderr 均空。

**为什么第一轮没拦住这件事**：已装好依赖的 worktree 上 `pnpm install --frozen-lockfile` 会**跳过构建检查**（实测 rc=0）——只有**全新 node_modules**（runner 的常态）才复现 `ERR_PNPM_IGNORED_BUILDS`。⇒ 凡改 `allowBuilds` / 依赖声明，本机自检必须用一次性空 store 口径复现一次，不能只看「本机能装」。

### CI 终态：attempt 2 全绿 + attempt 1 的抖动定性（2026-10-17）

PR head `d322cd46c` 的 run `38932245217`：attempt 1 只有 1 个作业失败，**同 SHA 重跑（attempt 2）后 run 终态 `completed/success`**；PR head 23 条 check-runs **零 fail / 零 pending**（其中 `release` = skipped，按设计），required 并集 10/10。

| attempt | `QG Browser E2E` job | 作业起止（UTC） | step 7 `Gate 8 - Browser E2E` | 结果 |
|---|---|---|---|---|
| 1 | `117080401765` | 2026-10-16T16:44:13Z → 16:50:55Z | 298s | failure（路由检查 `251/252`、总计 `294/295`、0 console errors / 0 page errors） |
| 2 | `117278206231` | 2026-10-17T01:52:19Z → 01:57:56Z | 231s | **success**（路由检查 `261/261`、总计 `304/304`、0 errors） |

`Gate Result` 在 attempt 1 连坐失败（job `117096544330`，2026-10-16T17:23:01Z → 17:23:05Z），attempt 2 由 e2e 完成**自动补入**（job `117279346379`，2026-10-17T01:58:10Z → 01:58:13Z，success）—— `gh run rerun --failed` **只重跑失败作业本体、不连带重跑其依赖**，这是本轮实测到的重跑语义，不是推断。

**attempt 1 的失败点是一次 `locator.click` 超时，不是断言失败**：`apps/desktop/tests/e2e/helpers/route-functional-suite.js` 的 `clickText` 在 `:73` 的 `locator.click({ timeout: 3000 })` 抛 `Timeout 3000ms exceeded`（call log 停在 `performing click action`），而 `exerciseCollection`（`:240-249`）所点的 `[data-testid="collection-collect-btn"]` 当时已 `resolved / visible / enabled / stable`；同页 `consoleErrors=[]`、`pageErrors=[]`；**本 PR 渲染端改动 0 文件**（改动集不含 `apps/desktop/src/**`）。

**判为抖动、不判回归的三条证据**：① 同 SHA 重跑即全绿（上表两行同 head）；② **逐路由对照**（留档 `<scratch>/p2-e2e-attempt-compare.txt`）：23 行（17 路由 + 6 集成流）中 **22 行两轮检查数逐字相同**，唯一差异是 `/collection`（`3/4 → 13/13`），且「路由检查 `252 → 261`」与「总计 `295 → 304`」两处差额**都是 +9** ⇒ 差异全部落在 `/collection` 这一行，其余 22 行没有代码签名；③ **主干基线**：同窗口 main 上 `QG Browser E2E` / `Gate Result` / `QG Visual` 共 12 条 run 全 success（2026-10-16T14:42:15Z → 19:41:28Z）⇒ 不是主干既有红。step 时长 `298s → 231s`（+29%）只作**并行负载线索**，不作结论；`/collection` 那一行的检查数为何在两次 attempt 间不同，只有 1 次失败样本，**未继续深挖** —— 本条只主张上述事实，不主张机制。

**主干既有红：如实披露、本 PR 不代修** —— `visual-test.yml` 在 main 上连续 15 条 run **全 failure**（2026-10-16T08:18:47Z → 19:41:28Z，他人会话存量），而本 PR head 的 23 条 check-runs 里**没有该 workflow 的检查**（不在本 PR required 集内）⇒ 不构成阻塞，也不是本 PR 引入。

**回填取证的自我纠错（一次，勿复述成「中文标题不可锚定」）**：AGENTS.md 原式是 `git log origin/main --grep='(#NNNN)$'`（**不带反斜杠**）。本轮我先写成 `--grep='\(#3677\)$'` 读到 **0 行**，那是**我的转义错**：git `--grep` 默认 **BRE**，`\(…\)` 是**捕获组**，该式等价于「行尾前还有一个 `)`」，对 `…（依赖接入方案 A）(#3677)` 这种以 `)` 收尾的标题必然打不中；去掉反斜杠立即命中 `f818c214`。同一形态在英文收尾标题 `(#3805)` 上复验，同样是「转义式 0 行 / 不转义命中」⇒ **与语言无关，照原式执行即可**。

### 两条本机红：pristine 对照实测定性（一条 stale base、一条非本分支引入）

本轮推前本机复跑出现 2 条红，**用 pristine 对照定性，不是推测**（探针 worktree `<scratch>/mp-probe-main`，detached @ `origin/main` `af71907bf`，`git status` clean）：

| 用例 | 本分支 | pristine origin/main | 定性 |
|---|---|---|---|
| `scripts/check-gate-record-debt.test.js` test 17 | 57 pass / **1 fail** | **58 pass / 0 fail** | **stale base**：主干 `fe20b2c8a`（#3694「冻结基线第四次重取到 613」）已把 `scripts/gate-carrier-freeze.json` 更新为 main=`d206450fc67b`，本分支仍停在 `c80e6f527aed`/607 ⇒ 修法 = **吸收 origin/main**，不是改断言 |
| `scripts/check-doc-abs-paths.test.js` test 26 | 1 fail（超 **83** / 低于基线待收紧 97，3357 受管文件） | **同形红**（超 83 / 低于基线待收紧 97，3369 受管文件） | **非本分支引入**（pristine 同形），且 **CI 不阻塞** |

`doc-abs-paths` 为何在 CI 不红（**决定性证据，非推断**）：该自测在 `changes` job（跑在 **Linux**）当场打印 `DRIVE=null` ⇒ test 26 走 `# SKIP 本机无 Windows 盘符：基线是在 Windows 上生成的，跨平台无法逐文件对齐`；同 run 日志另有「本机无盘符 ⇒ 逐文件计数比较未执行（仅核对陈旧登记与账本放宽）；无从判定 1093 处 Windows 绝对路径」。且 `QG Changes` 在 `c90a72a1d` 与 main 侧均为 **success**。⇒ **修它 = 重取门禁账本**（属「改谁来守门」，须人工过目），本 PR 不修，作为残留风险移交。

**顺带纠正上一轮的不准确表述**：本记录与 PR 正文早前都写过「main 侧 `QG Changes` 恒红」—— 那是 `fe20b2c8a`（#3694 重取基线）**之前**的读数（`4997c24fc`/`e5e06a23f`/`2fd74f508` 三次 failure 的现场）。`fe20b2c8a`、`dfead4cc5` 的 main push 与本分支 `c90a72a1d` 的 `QG Changes` **均为 success**。

### 两源真实取证（§6.3，零编造）

- npm registry：`@askjo/camofox-browser@1.18.1`，tarball SRI `sha512-JLxRXts…`、shasum `8d3505035b0debcd5d306f630cf63f5208c0ef42`、unpackedSize 576493
- GitHub Releases API：`daijro/camoufox` tag `v152.0.4-beta.30`（2026-09-01 发布、非草稿非预发布），**六个平台 asset 的官方 sha256 + size** 全量落 lock
- `BUNDLED_CAMOUFOX_RELEASE=152.0.4-beta.30` 取自 wrapper `lib/camoufox-download.js` 导出常量

### 审包发现（PRD 臆测修正）

wrapper 的下载链路**不做任何 sha256 校验**：`checkAsset` 只匹配资源名前缀 `camoufox-<release>-`，且 postinstall 的 `fail()` 走 `process.exit(0)`（下载失败安装照样成功）。⇒ PRD §3.4 ③「spawn 前复检防磁盘篡改、**不防首次下载污染**」是**真实边界**而非文档臆测；`ddddocr` 因 onnx 权重 hash 未取证而显式记 `status=pending`，`resolveAsset` fail-closed 拒绝启动（留洞比留假 hash 安全）。

### 过程中被测试/变异当场抓住的 4 个真实缺陷

1. **IPv6 逃逸口**（§7.5）：方括号 `[2001:db8::1]` 含 `[ ]`，被「变量形态」判据 `/[${{}}()[\]]/` 当成表达式放行 ⇒ 非回环 IPv6 完全逃逸。修为 `isBracketV6` **前置于**变量判定（变异 M1 专锁）
2. **回环误报**（§7.5）：裸 `::1` 含多个冒号，按第一个冒号切得 `''`，不在白名单 ⇒ 回环反被判红
3. **冗余防御**（§7.2）：`close()` 的 `if(closed) return` 与 `ws=null` 冗余叠加，变异证明摘掉它**无可观测差异** ⇒ 按「不留无谓防御」删除
4. **路径层级**（§6.3）：`LOCK_PATH` 的 `'..'` 少一级 ⇒ ENOENT

### 三条方法论教训（已写入代码注释 / commit message）

1. **管道会吃 rc**：`node check.js \| Select-Object` 让 `$LASTEXITCODE` 反映管道末端 ⇒ checker rc=1 被读成「本地能过」
2. **别凭对正则的直觉下结论**：先判「字符类不含 `]`」并据此改了半天代码，诊断后发现它**包括** `]` 与 `:`
3. **CRLF 让多行变异锚点永远失配**：含 `\n` 的 `from` 串在 CRLF 文件上永不匹配 ⇒ `ANCHOR_MISSING`；锚点应尽量单行
4. **变异脚本改写被测文件时，不得与「读同一文件的命令」并行**：本轮把 `mutate-allowbuilds.js` 与 `pnpm install --frozen-lockfile` 放进同一批并行执行，pnpm 恰好读到 M3 变异中途的 `pnpm-workspace.yaml`（注入的 `@askjo/camofox-browser: true` **未加引号**，而 YAML 里 `@` 不能起 plain scalar）⇒ 报 `bad indentation of a mapping entry (25:3)`。**文件本身是干净的**（实测 72 CRLF / 0 裸 CR / 全仓无该行），属并行操作错误。凡「写入/变异」与「读该文件」的命令，一律串行。

### 遗留（不假装已闭合）

- **7.1 依赖接入已按方案 A 落地**（精确 pin `1.18.1` + **在 `allowBuilds` 里显式写 `false`** 阻断 postinstall（键**缺席**在 pnpm 11 下不是「不构建」而是 *ignored build* ⇒ `pnpm install` rc=1） + `pnpm run fetch:camofox` 手动拉构件 + 由 `sidecar-lock.json` 的官方 sha256 校验）：7.2/7.4/7.5 与本决策解耦（判定抽纯函数、监听断言独立成脚本）；7.3 的 `rpa-view-manager` 薄接线仍待补
- **该 pin 曾让 install 依赖本机 VS C++ 工具链**（`better-sqlite3` 被 pnpm 自动注入 `node-gyp rebuild`）：已用 `allowBuilds: better-sqlite3: false` 消除。若将来 sidecar 真要消费该 npm 包的 JS，须先复核其 `prebuilds/` 是否覆盖目标 ABI（否则要么补回构建、要么换包）
- **接线棘轮洞口未修**：`check-unwired-tests.js` 的 `WORKSPACE_COVERED` 豁免整个 `apps/` 子树（详见「接线补课」节），本 PR 只把两个文件显式点名，洞口本身另开 PR
- **ddddocr 未取证**：requirements 钉版本 + 4 个 onnx 权重 sha256 未取，`status=pending`；取到之前该 sidecar 不得启动
- **§8 整块未动**：captcha-solver / python-backend 托管 / 相位三处同步 / 夹具图取证等（建议另开 PR，动 `pnpm-lock.yaml`）
- **QM-6 双模型评审未执行**（本机 `codeagent-wrapper` 不可用）；PR-1 已有 backend 轴记录，本批未重新发起
- **`sidecar-lock.json` 命名偏差**：tasks 6.3 写的是 `speech-sidecar-lock.json`，本批按内容命名 `sidecar-lock.json`（承载 F3+F4+预留 B2，`speech-` 前缀会误导），理由已写入 lock 的 `_doc` 段
