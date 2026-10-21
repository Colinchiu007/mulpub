---
record: changelog-rollout-release-gate
task: 落 tasks 1.1 / 4.1 / 4.2 —— 发版门禁消费聚合器读数 + records 台账小节模板 + AGENTS 规范改写（changelog-record-carrier 片4 前半）
date: 2026-10-21
---

## 本次执行记录：发版接入与台账合同改写（changelog-rollout-release-gate，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档（`scripts/release-gate.mjs` 判据本体 + 其测试 + `AGENTS.md` + `openspec/records/_TEMPLATE.md`）。入口 `scripts/start-mp-task.ps1 -TaskName changelog-rollout-release-gate -NoDeps`；判据取产物：`rev-parse --abbrev-ref HEAD` == 分支名、起点 `origin/main == e297ccc73`（当场 `git log HEAD..origin/main` 与 `origin/main..HEAD` 均为 0 行，即不落后不超前）、`pre-code-edit-guard.ps1` rc=0 |
| TDD 顺序 | ✅ | 先写 `scripts/release-gate.test.mjs` 的 R1–R13 并见证红。首次红形是 **LOADFAIL**（`SyntaxError: The requested module './release-gate.mjs' does not provide an export named 'parseAggregateReading'`）—— 新导出尚不存在时整份文件不可加载，这与"指名红"语义不同，分开记（同片3 的口径） |
| 行为锁 | ✅ | `node --test scripts/release-gate.test.mjs` → `# tests 22 / pass 22 / fail 0`，当场 4s（`# duration_ms 3330`）。九条既有用例现在**必须**带 `aggregate` 字段才能通过 —— 这是"缺席即硬失败"的刻意代价，改法见下条 |
| 既有断言随实现迁移同步 | ✅ | 原 9 条用例的 `runGate({...})` 调用全部补 `withClean()`（一份 `landed=0/learningsLanded=0/records=10` 的干净读数）。不做这一步就会把"新增消费点"变成 9 条既有红的悬案 —— 按 AGENTS「门禁断言随实现迁移同步」在同 PR 内改完 |
| 三条文案可分辨（tasks 4.1 的本体） | ✅ | `AGGREGATE_FAIL`（未取证 / rc≠0 / 无 `AGGREGATE` 首行 / `records=0` / 数值读不出）与 `AGGREGATE_PENDING`（确有 N 条待搬，逐字给出 `node scripts/aggregate-changelog.js --write`）和原有 `CHANGELOG 未收口` 三档互斥：R1/R2/R5 各自断言"不得同时出现未收口"。理由写在代码注释里 —— 合并成一句会让人去手改 CHANGELOG 而不是修聚合器 |
| 聚合器读数不可用时短路 | ✅ | `aggregateBlocked` 为真时**跳过**所有"读 CHANGELOG 内容"的判据（版本小节 + 破坏性软警告）。不短路就是拿未知状态做结论（变异 m3 指名让 R1/R2/R5/R10 四条一起红） |
| 真跑端到端（不是字符串判据） | ✅ | R10/R11/R12 把 `release-gate.mjs` 整份拷进 `os.tmpdir()` 夹具的 `scripts/`（ROOT 由自身位置上溯两级求得 ⇒ 夹具根就是它的仓根），用 `--tag v0.9.0` 真跑 CLI；桩聚合器把**实收 argv** 写进夹具内的 `called.txt`，断言恰为 `["--dry-run"]`。R12 证明"新增消费点不得拦住合法发版"（rc=0） |
| 变异反证 | ✅ | 驱动 `D:/Temp/mutate-r41.cjs`：**7/7 CAUGHT，红集互不相同** —— m1 缺席放行→R1；m2 `records=0` 当合法→R4；m3 不短路→R1+R2+R5+R10；m4 待搬不拦→R5+R6+R11；m5 把 `--write` 塞进校验→R10+R13；m6 摘掉真接线→R10+R11+R12；m7 读不出数值默认 0→R9。每条断言 `# tests >= 22`（防"没跑"读成"已反证"），还原 md5 一致（`d99b498de6`），跑完再重跑被测锁 22/22 |
| 驱动自己踩到的坑（差点造出一条假"已反证"） | ✅ | m7 第一次报 `PROBLEM 锚点命中 0 次`。根因不在被测代码，在**驱动**：它用 `encoding: 'latin1'` 读目标文件，而锚点字面量是驱动源码里的 UTF-8 中文 —— latin1 下"锚"的每个字节是一个字符，中文锚点永远匹配不上。m1–m6 的锚点恰好全是 ASCII 所以照跑，于是**唯一含中文的那条变异整条静默不执行**，而"没执行"在旧驱动里会被读成"这条不用证"。两条口径：① 驱动读被测源文件一律 `utf8`（写回也要同一编码，否则还原即损坏）；② 锚点命中数必须显式断言恰为 1（本条救的就是这个）|
| 接线（新测试必须被执行） | ✅ | 无新增测试文件（改的是既有 `scripts/release-gate.test.mjs`，已由 `quality-gate.yml` 的 `node --test scripts/release-gate.test.mjs` 点名）；`check-unwired-tests.js` 当场读数 `检查域内测试文件 116 个 → OK` |
| 静态门禁批跑 | ✅ | `check-step-failfast` OK；`check-no-brand-residue` PASS（11402 个 tracked 文件）；`check-doc-abs-paths` PASS（现场存量 1161 处按文件对齐、账本未放宽）；行尾两口径对账：`AGENTS.md` 3/3、`_TEMPLATE.md` 32/0 与 `--ignore-cr-at-eol` 读数逐字相同 |
| 真仓现场读数（本条改动的第一手效果） | ✅ | `node scripts/release-gate.mjs` 在 worktree 里实跑 → `❌ release-gate: AGGREGATE_PENDING：执行记录里还有 2 条没搬进台账（CHANGELOG 1 条 / learnings 1 条，records=619）…` rc=1。**这正是片1–片3 落地后一直没接的写出面**：新合同产生的条目停在 records 里，`CHANGELOG.md` 拿不到它们 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | PENDING | 本笔变更 302 行代码（`release-gate.mjs` +90、测试 +212）> 200 阈值 ⇒ 判定器判 DUAL。深审在本笔提交后跑（载荷是 committed diff，先提交才能被内容寻址命中），结果与逐条处置追加在本节下方 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`（含 `scripts/*.mjs` 代码），走完整质量节拍
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 CI 侧 | 绝对路径账本未放宽 ✅

### 为什么"校验"里只读取数、不写台账（一个刻意的设计选择）

`--write` 出现在 `release-gate` 的**文案**里（给人跑的那条命令），但**不出现在它的 argv 清单** `AGGREGATE_READ_ARGS = ['--dry-run']` 里。三条理由：

1. `build.yml` 在 tag push 上跑 `node scripts/release-gate.mjs --tag ...`，那是个**一次性检出**，写出的改动没有可提交的工作树 —— 校验里写文件等于制造"CI 报了成功但改了东西没人收"。
2. 校验的产物应当是**判断**，不是**副作用**。把写入塞进校验会让人以为"跑一下门禁就会自己好"，而台账写入是一次需要提交、需要 review 的变更。
3. 副作用可分离 ⇒ 锁也能分开：R13 钉「清单本身」，R10/R12 钉「实收 argv」，两条各测各的格子（m5 只改清单会让两条一起红，属预期而非重叠）。

### 遗留（不假装已闭合）

1. **QM-6 尚未跑**（见上表 PENDING 行）。跑完把裁决逐条追加在本文件，不在合并后再补第二篇记录。
2. **`Gate 2b9` 仍是 advisory**：`tasks.md` 4.3 的转档前置条件在 2026-10-21 实测是 **38 个 open PR 里 26 个 CONFLICTING、0 个 UNKNOWN**，远未清零；转档属改「谁来守门」，须人工过目。
3. **模板的形状仍未机器判定**：本片只把 `## CHANGELOG 条目` / `## learnings` 的**要求写进模板与 AGENTS**，聚合作业继续用 `malformed` / `missingSection` / `learningsShape` 三档**出声**而不阻断。把它转成阻断判据前必须先量存量（现读 `missing=613`，绝大多数是历史记录没有该小节 —— 直接阻断会让每次 PR 都红）。
4. **发版 SOP 的顺序依赖是新的**：本 PR 合并后，打 tag 前若没先跑 `--write` 并把它提交，`release-gate` 会以 `AGGREGATE_PENDING` 拦下（这正是要的行为，但对既有习惯是一次变更）；已写进 AGENTS 的「发版版本级别 ↔ 改动规模匹配」条目。

## CHANGELOG 条目

# feat(gates): 发版门禁改为先取证再判 —— 台账未由聚合器收口时直接拦下（changelog-rollout-release-gate）

- `scripts/release-gate.mjs` 现在在任何"读 CHANGELOG 内容"的判据**之前**取聚合器读数，并把三类失败拆成三条文案：`AGGREGATE_FAIL`（取不到数 / 聚合器 rc≠0 / `records=0` 采集面退化 / 数值读不出）、`AGGREGATE_PENDING`（确有 N 条待搬，逐字给出 `node scripts/aggregate-changelog.js --write`）、原有的 `CHANGELOG 未收口`。合并成一句会让人去手改 CHANGELOG 而不是修聚合器，这是本条的全部动机。
- 校验侧**只读取数不写台账**（旗标清单 `AGGREGATE_READ_ARGS = ['--dry-run']` 是唯一的、且由 R13 + R10/R12 的实收 argv 双向钉住）：CI 在 tag push 上是一次性检出，写出的改动没人能提交。
- `openspec/records/_TEMPLATE.md` 补上 `## CHANGELOG 条目` 与 `## learnings` 两个小节和形状说明，AGENTS.md 的 `CHANGELOG.md` 条目改写为"PR 不得直接编辑台账、只写自己的执行记录"，并写清发版顺序 `--write → 收口版本小节 → bump → tag`。
- 行为锁 22 条（既有 9 条同步改为必须带聚合器读数）+ 变异反证 7 条全指名；真仓现场：`release-gate` 实跑报 `AGGREGATE_PENDING … 2 条（CHANGELOG 1 / learnings 1, records=619）` rc=1。

## learnings

### lesson: 变异驱动的"锚点命中 0 次"是它最有价值的一次自证

**现场**：给 `release-gate` 的接线做 7 条变异反证，前 6 条 CAUGHT，第 7 条打印 `PROBLEM m7 锚点命中 0 次（必须恰为 1）`。第一反应是"被测代码被谁改过了"，实际根因在**驱动自己**：它用 `encoding: 'latin1'` 读被测源文件，而 m7 的锚点字面量是驱动源码里的**中文**串 —— latin1 下一个字节对应一个字符，UTF-8 中文锚点永远匹配不上。m1–m6 的锚点恰好全是 ASCII，所以它们照常执行。

**为什么这条值得单独记**：如果驱动只断言"有没有红"，m7 会被读成"这条不需要证 / 已经由别的变异覆盖了"，交付里就写进一条**从未执行过的反证**（本仓把这记作"装饰性门禁"的同型）。救回来的是那句显式的命中数断言，不是运气。

**可复用的三条**：

1. 驱动读写**被测源文件**一律用 `utf8`（读写同编码），并且在每条变异前断言 `split(anchor).length - 1 === 1`：0 次 = 锚点失效（编码/排版/被谁改过），2 次以上 = 锚点不唯一。两种都要出声，不许 `continue`。
2. 含中文（或任何非 ASCII）锚点的变异是这一族的**独有风险格**：全 ASCII 锚点的批次跑绿，不代表整份驱动没问题。判"驱动可信"要看的是**每条变异各自的锚点命中数**，不是汇总的 CAUGHT 数。
3. 同一套编码错位在还原步也会咬人：若 `orig` 按 latin1 读、按 latin1 写，md5 对账可以自洽；一旦读写编码不同源，还原会**静默改写文件字节**，而 md5 比较的是内存里的字符串 —— 还原"成功"但盘上是坏的。收尾必须再跑一次被测锁（本片跑完驱动后重跑 22/22 才继续）。
