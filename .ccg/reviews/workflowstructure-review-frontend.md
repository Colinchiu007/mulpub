# QM-6 前端轴评审原文（模式/可维护性/集成）

- 通道：`opencode run --model opencode/ling-3.1-flash-free`（同上降级理由）
- 日期：2026-10-13；评审输入 = 本 worktree 源码（含 .ccg/reviews/ 里的变异驱动）
- 与后端轴**独立收敛**：CRITICAL-1（缺 runs-on 判据）与 MAJOR-1（steps/uses 不互斥）两轴各自命中并各自构造夹具实测返回空数组；INFO-5 与后端第 3 条同指 isAllowedEmpty 注释把实测现状写成了判据边界

---

**CRITICAL-1 — `runs-on` 缺失不报（门禁章程内的漏网形态）**
`.github/scripts/check-workflow-structure.js:83-115`（`checkJob` 全程）。含 `steps` 的 job 缺 `runs-on` 会被 GitHub 在排队前拒绝——正是本门禁开篇宣称要抓的「必需节点缺席」类别，实测 `checkWorkflowText('on: push\njobs:\n  a:\n    steps:\n      - run: echo hi\n')` 返回 `[]`。修法 3 行：在 `steps` 分支补 `hasOwnProperty(job,'runs-on')` 检查。这是本 PR 唯一称得上「门禁形同虚设」的缺口，优先级最高。

**MAJOR-1 — job 同时含 `steps` 与 `uses` 不报**
`.github/scripts/check-workflow-structure.js:102-109`。`checkJob` 在 `steps` 分支末尾 `return`，跳过 `:112-114` 的 `uses` 互斥检查；GitHub 拒绝二者并存，实测同样返回 `[]`。与 CRITICAL-1 同源（都在 `checkJob`），建议同批修。

**与 check-step-failfast.js：无重叠，边界清晰。** 判据正交：failfast 管「run 块内 ≥2 条测试命令的退出码语义」（`scripts/check-step-failfast.js:17` TEST_INVOCATION、`:68-69` 少于 2 条直接跳过），新门禁管「GitHub 排队前拒绝的文件形态」。关键事实：**Gate 3 本就不在 Gate 2d 棘轮管辖内**——其 run 块只有 1 行匹配 TEST_INVOCATION（`node --test` 那行；其余 `node *.js` 路径不含 `.test.`），`tests.length < 2` 被跳过。所以本 PR 把 Gate 3 改 `shell: bash` 填的正是 failfast 的空洞，不是重复造锁。

**与 workflow-contract.test.js：无重叠。** 该文件 794 行全是逐 gate 语义契约（步骤存在/顺序/旗标/并发组），没有任何「workflow 能否通过 GitHub 编译器」的通用结构校验；新门禁补的是空白。新测试的接线锁（`check-workflow-structure.test.js:159-180`）与 contract 测试对 `nx-affected-probe.test.js` 的 wiring 锁（`workflow-contract.test.js:286-293`）同构，风格一致。

**INFO-1（文档化的刻意分裂）**：新测试断言 `gate3.shell === 'bash'`（`check-workflow-structure.test.js:167`）比 failfast 口径更严——后者允许 `pwsh + $LASTEXITCODE`（`check-step-failfast.js:73`）。未来把 Gate 3 改回 pwsh+$LASTEXITCODE 会出现 failfast 绿、新测试红的一红一绿；注释已说明理由（pwsh 下第一条 `node --test` 红掉步骤仍绿，`quality-gate.yml:490-493`），属有意为之，不是缺陷。

## 2) 命名、导出形态、CLI 参数、输出格式

- 命名 `check-<topic>.js` + 同名 `.test.js` ✅；`--root=` ✅ 与 `check-step-failfast.js:100`、`check-unwired-tests.js:393` 一致；输出 `[workflow-structure] root=… files=… violations=…` ✅ 与 `[locale-sync]`/`[frontend-consistency]` 的 `[topic]` 前缀惯例一致。
- **MINOR-1**：缺 `--json`。本仓多数扫描型门禁都提供（`check-scoped-root.js:44`、`check-frontend-consistency.js:56`、`check-step-failfast.js:88`、`check-unwired-tests.js:353`，用途是供审查代理消费）。`check-workflow-structure.js:177-188`。
- **MINOR-2**：`main()` 未包 try/catch——workflows 目录不可读时抛原始堆栈且 exit 1，而 `check-step-failfast.js:98-105` 与 `check-unwired-tests.js:390-399` 的惯例是 `ERROR: <msg>` + exit 2。
- **MINOR-3**：CLI 默认 root 分歧——新门禁默认 `REPO_ROOT`（`__dirname` 推导，`:23`/`:179`），check-step-failfast/check-unwired 默认 `process.cwd()`。新做法更稳，但与同类脚本口径不统一。
- **INFO-2**：`module.exports` 导出 `main`（`:192`）在本仓无先例（同类导出判据函数与 `run`）；`isAllowedEmpty` 与 `main` 均无消费者（测试只 import `checkWorkflowText/collect/REPO_ROOT`，`test.js:8`）。
- **INFO-3**：`::error file=` 注解（`:183`）是本仓门禁首例（`check-hardcoded-secrets.js:67` 用纯 stderr `path:line`），是改进而非违规；若后续推广建议统一。

## 3) 测试可读性与抗误伤

总体好：`codes()`/`paths()` 投影只断言 code 与 path、不断言文案（`test.js:11-12`），改消息不会红；真实仓库用例用下界 `files.length >= 12` + gui-test.yml 成员点名（`:110-113`），符合「扫描域非空」惯例；动因形态逐字复刻 + 合法形态正控 + CLI 出口 + 接线锁四层齐全；作者另附 7 条变异反证（`mutate.cjs` M1–M7 全 CAUGHT，未随 PR 入库，属过程证据）。

- **MINOR-4**：`test.js:171` 的 `/node \.github\/scripts\/check-workflow-structure\.js/` 要求单空格精确形状，命令换行拆分或双空格即误红；用 `\s+` 可免除（同类文本锁在本仓普遍，属既有风格，但这条可放宽）。
- **MINOR-5**：`test.js:122` `execFileSync(…, { cwd: REPO_ROOT })` 传了 `cwd`，但脚本默认 root=REPO_ROOT 并不读 cwd——冗余且向读者暗示了错误前提（暗示脚本依赖 cwd）。
- 其余断言锚点（`static-gates` job 名、`Gate 3 - Hardcoded secrets scan` step 名）与 workflow-contract.test.js 的按名匹配惯例一致：重命名会 `assert.ok` 失败且消息明确，不会被无关重构误伤。

## 4) 该登记而没登记的重复实现

**NONE。** 逐项核过：
- `.github/workflows` 目录现为第 4 个扫描器（本门禁 `collect()`、`check-step-failfast.js:collectCheck()`、`check-unwired-tests.js:readWorkflowText()/listJobBlocks()`、contract 测试逐文件读），但本仓门禁既定模式就是「每门禁自包含」——check-step-failfast 与 check-unwired 早已各自扫描同一目录，不构成需登记的违规重复。
- `check-unwired-tests.js` 的 `MUST_LIVE_IN_UNGATED_JOB` **无需登记**：新测试的输入是 `.github/workflows/**`，实测不在 `CI_IGNORED_PATHS` 内（我跑了 `classify-docs-only.js` 确认），static-gates 对「改坏 workflow 的 PR」不会被 docs-only 短路；新测试自己的接线锁（`test.js:176-179`）已钉住这一点。
- js-yaml 无新增依赖风险：根 `package.json` devDependency `^4.3.0`，static-gates 在 Gate 3 前已 `pnpm install --frozen-lockfile`，且 Gate 3 本就经 `workflow-contract.test.js:5` require js-yaml。
- 附带核实：`gui-test.yml:31-33` 恢复 `defaults.run.shell: bash` 后，无显式 shell 的 6 个步骤（`pnpm install`、`python -m pip install`×3、`python -m pytest`、`python -c "…"`）均为 shell 无关命令，无行为回归；该值即 87e311c45 删除的原值，属恢复而非新语义。

**INFO-4（固有局限，非缺陷）**：若 `quality-gate.yml` 自身结构坏掉，Gate 3 随之消失，门禁无法自检——任何 workflow 都无法校验自身编译，动因场景（其他 workflow 坏、quality-gate 好）已被覆盖。

**INFO-5**：`isAllowedEmpty` 注释称「全部 null 值恰好就是 on/*/workflow_dispatch 这 8 处」（`:29-32`），代码实际放行任意 `on.<event>`（`:33-35`）——注释描述的是实测现状而非判据，易误导后来者以为白名单只含 workflow_dispatch，建议改述为「`on` 下任意事件名」。

---

**验证方法**：构造 fixture 直接喂 `checkWorkflowText` 证 CRITICAL-1/MAJOR-1；真实仓库跑 CLI（`files=13 violations=0`）、跑 6 条测试全绿、跑 `check-unwired-tests.js`（78 个测试文件全接线）与 `check-step-failfast.js`（6 个多测试步骤全 fail-fast）确认无回归；js-yaml 4.3.0 实测 `on:` 解析为字符串键（`workflow-contract.test.js:375` 的 `wf.true` 回退在本门禁无现实风险，`^4.3.0` 已钉）。
