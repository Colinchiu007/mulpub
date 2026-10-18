---
record: debt-budget-git-domain
task: 把债务熔断门禁 check-debt-budget 的扫描域从磁盘改成 git 的域，并把取域收敛成 scripts/lib/git-domain.js 单一实现
date: 2026-10-18
---

## 本次执行记录：债务熔断门禁的扫描域改成 git 的域（debt-budget-git-domain，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行面（CI 门禁本体 + 新增测试文件）⇒ 隔离 worktree（仓库父目录下 `mp-worktrees/mp-debt-budget-git-domain`，由 session-init.sh 按默认根创建）+ 裸分支 `debt-budget-git-domain`（入口 `bash scripts/session-init.sh debt-budget-git-domain`，收尾打印 `verify-worktree-deps OK`，11 项 `@multi-publish/*` 全部指向本 worktree）。复杂度：`ccg-review-decider` 判 DUAL（判定时的实现提交 7 文件 / +573 −59，跨 `.github` 与 `scripts`；采纳两轴意见后的最终 diff 更大，见「QM-6 发现处置」），故走 QM-6 双轴 |
| 第一性原因（QM-5 ①） | PASS | 同一根因的第二处：`826fa7e13`（PR #3782，change `bundle-untrack`）把 5 个构建产物移出版本控制时，只给消费它们的 CI 作业补了重建步，**没问任何"自己扫磁盘"的门禁的域**。#3876 修了 `check-max-lines`，而 `scripts/check-debt-budget.js` 的两处 `fs.readdirSync`（计数 `countFilesByMinLines` + 循环依赖图 `checkCircularDeps`）从未改过 ⇒ `apps/desktop/electron/**.bundle.js` 落在 `SCAN_DIRS` 内且扩展名 `.js`，本机跑过 `build:preload` 就多出一个 ≥500 行的"债" |
| 逃逸分析（QM-5 ②） | PASS | ① **该门禁此前没有任何测试文件**（`ls scripts/check-debt-budget*.test.js` = 无），所以既没有夹具也没有断言能表达"域"这件事 —— 归类 测试场景缺失；② CI 侧 `debt-guard.yml` 的检出里没有 gitignored 产物 ⇒ 偏差在 CI 上结构性不可见，归类 环境差异；③ 聚合指标形态掩盖：它输出的是 `filesOver500: N` 一个数，不是逐文件清单，所以 96 与 95 的差在日志里**不可归因**（本片顺手补了 `filesOver500Paths`/`--json`，这是"为什么这类假红能活下来"的一部分答案）；④ 基线余量吸收：`debt-baseline.json` 的 101 vs 现场 95/96，4 格余量让它一直不红 —— 归类 阈值当缓冲 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：新增 `scripts/lib/git-domain.js` 作为唯一实现（`git ls-files -z` ∪ `--others --exclude-standard`；`root` 与 `env` 都是显式入参；非工作树 / git 不可执行 / 空集合 ⇒ 抛错）。两个消费者都改成引用它并用**函数身份**互相钉死（`check-debt-budget.gitDomain === check-max-lines.gitDomain === lib 的那一个`）。`check-debt-budget` 两处 walk 在读文件之前按域过滤；取不到读数由 `main()` 转**退出码 2**（1 留给"确实超基线"）；新增 `--root`；`main()` 改为 `if (require.main === module)` 才跑。回归锁 26 条：`scripts/lib/git-domain.test.js` 11 条（六条语义 + root 必传 + env 两档 A/B + 真仓 status 交叉 + 消费者套件计数）与 `scripts/check-debt-budget.test.js` 15 条（计数侧域、循环依赖侧域、第三处取数域门、夹具"有牙"自证、未跟踪可见、非工作树抛错、防漂移函数身份、CLI 分档、判定层 `check()`、基线形状 `toPersisted`）。实跑：`node --test scripts/lib/git-domain.test.js` = 11/11、`node --test scripts/check-debt-budget.test.js` = 15/15、`node --test .github/scripts/check-max-lines.test.js` = 36/36（改域后未退化） |
| 防止再次发生（QM-5 ⑤） | PASS | ① **单一实现 + 身份锁**：把"两处各写一份 ls-files"变成结构上不可能（M4 实测：换成行为等价的本地包装 ⇒ 唯一红的是防漂移那条，行为用例全绿，说明这条锁测的是"共享"而不是"能跑"）；② 两条新锁接进 `quality-gate.yml` 的 `changes` job（不被 docs-only 短路、在非 PR 早退之前），`node scripts/check-unwired-tests.js` 实跑 rc=0（检查域 102 个测试文件）；③ 消费者套件计数锁：`⑩` 用嵌套 `node --test` 要求 `tests === 文件里声明的 test( 数`，并清掉继承的 `NODE_TEST_*`（否则嵌套 runner 打印「skipping running files」且 rc=0）；④ 本条与 [[project-mulpub-local-vs-ci-gate-divergence]] 的第三种分叉维度同型，已同步内置记忆 / EverOS |
| 行尾与 diff 对账 | PASS | 被改的两个受管文件 `git ls-files --eol` = `i/lf w/crlf attr=text=auto`，工作副本实测 `lone_lf=0`（`check-debt-budget.js` 306→? 逐处替换后仍 0、`check-max-lines.js` 598→565、`quality-gate.yml` 2197→2204）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐字相等，删除行全部归因到被替换的函数签名/本地实现/docblock。⛔ 本轮一次**自己写的驱动把 CRLF 文件按 latin1 写出**（`Buffer.from(s,'binary')`）⇒ 整份 `check-max-lines.js` 变乱码，是收尾那条 `lone_lf !== 0` 断言把它抓出来的（latin1 往返会改动字节布局），当场 `git checkout HEAD -- <精确单文件>` 还原并回读 `blob_equals_head=true` 后才重做 |
| 接线棘轮 | PASS | 新增两个测试文件 `scripts/lib/git-domain.test.js`、`scripts/check-debt-budget.test.js`，同 PR 点名进 `.github/workflows/quality-gate.yml` 的 `changes` job；`check-unwired-tests.js` rc=0、`check-step-failfast.js` rc=0（38 步）、`check-workflow-structure.js` files=14 violations=0。新文件未被 `.gitignore` 吞：`git check-ignore --no-index -v` 实测 `scripts/lib/*` 不命中任何规则、`scripts/check-debt-budget.test.js` 命中通用反选 `!scripts/*.test.js`（line 232）⇒ 无需新增 negation |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动全部是 CI 门禁脚本与 workflow 接线，产物与像素判定域无交集 |
| QM-6 CCG 双模型外部评审 | 见下节 | 本机 `codeagent-wrapper` 在位（PATH 上那个，装在用户目录的 `.claude/bin` 下），`~/.claude/.ccg/config.toml` 实测 `routing.backend.primary=codex` / `routing.frontend.primary=claude`，CC Switch `:15721` 探测 **open** ⇒ 按 AGENTS 原文走规定通道，两轴并行派发（严格只读 + 结论落 `.ccg/reviews/debt-budget-git-domain-review-<axis>.md`）。逐条处置见「QM-6 发现处置」 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### 验收：同树 A/B（本片真正的判据）与 CI 的边界

- **同树对照**：在同一个 worktree 造一个被 `.gitignore` 命中的 600 行产物
  （`apps/desktop/electron/preload/index.bundle.js`，先证 `git check-ignore` rc=0 且 `git status` 不列它），
  再用 `git show HEAD:scripts/check-debt-budget.js` 逐字节取出修复前实现跑 A/B：
  **A 修复前（磁盘域）`filesOver500=96`**、**B 修复后（git 域）`filesOver500=95`**、`DELTA=1`
  ⇒ 多出来的那一个正是被忽略的产物，与 #3876 的形状同型。
- **三个「实测」数按树归因（QM-6 前端轴 I2）**——绝对值随仓库增长浮动，一律按当场读数引用，不得当常数：
  | 读数 | 口径 | 取自哪棵树/什么条件 | 现在能否复现 |
  |---|---|---|---|
  | 95 | git 域 = CI 侧 | 本片 worktree 与 CI 检出同一口径 | 能：`node scripts/check-debt-budget.js` 当场打印 |
  | 96 | 磁盘域 | 同树 A/B 的 A 档：当场造出**一个**被忽略的 601 行产物（95+1） | 能：夹具随本 worktree 在场 |
  | 97 | 磁盘域 | #80 记录里「本机带产物时」那次读数，当时磁盘上有**两个** ≥500 行的被忽略 bundle（95+2；出处 `openspec/records/max-lines-git-domain.md:28`，现场点名 `home-shell-preload.bundle.js 1803 行` 与 `preload/index.bundle.js 1752 行`） | **不能**：该树态已不存在；当场实测两棵树各只有 1 个 ≥500 产物 |
  ⇒ 97 只能作为"曾经发生过的形态"引用，**不得再写成"实测"**；本轮为归因它专门复刻了修复前的磁盘 walk
  并对两棵树各量一次（磁盘 95/96 vs git 域 95，差集逐个点名），不是靠推测把两个数解释成"产物数量不同"。
- **零回归控制**：真仓 CLI `node scripts/check-debt-budget.js` ⇒ rc=0、`[debt-budget] domain=10052`（当场读数），
  五项指标读数与修复前逐项相等（`maxFileLines=5098 / filesOver1000=28 / filesOver500=95 / fanOut=65 / circularDeps=0`）
  ⇒ 在干净检出（CI 那一档）上收窄域**不改变任何结论**，只消除本机维度的虚高。
  采纳后端轴 I3 后 `fanOut` 仍为 65（该文件受管 ⇒ 域门不改读数），这条是"第三处取数吃域"不构成行为回归的现场证据。
- **必须如实说的边界**：CI 的检出里从来没有这些产物，所以"CI 全绿"不是本片的验收证据；
  它只证明没把别的搞坏。真实验收 = 上面那组同树 A/B + 26 条锁 + 16 道变异。
- **夹具留在工作树里的两条**（不假装已闭合）：A/B 用的两个临时文件
  （`apps/desktop/electron/preload/index.bundle.js`、`scripts/tmp-debt-budget-prefix.js`）被
  `scripts/safe-delete.js` 按设计拒绝（闸 3：目标必须出现在 `git status` 的 `??` 里，被 `.gitignore` 吞掉的一律拒绝），
  而 AGENTS 禁 `rm -rf`/`git clean` 绕行 ⇒ **本片刻意不绕守卫**；两者都是本会话自己造的、位于本任务 worktree 内的文件，
  将随本片收尾的 `scripts/safe-worktree-remove.ps1`（R3 链接审计 + R7 基线对账）一并销毁，
  该路径是本仓唯一受审计的删除出口。中间窗口内不跑打包/启动验证，避免把假 bundle 带进产物。

### QM-6 发现处置（两轴各一份原件，逐条可达性分诊后处置）

被审对象钉在实现提交 `a8c0e29f9`；两轴并行、严格只读，原件入库
`.ccg/reviews/debt-budget-git-domain-review-{backend,frontend}.md`。两轴 VERDICT 均为 **PASS**（无 Critical），
采纳项**全部在合并前落地**，每条采纳的锁各配一道变异（M13–M16）。**归属口径**：下表主张一律摘自该模型自己
落盘的正文段落，未把两份的相同意见合并成一条（前端 W1 与后端 W1 是同一条修复，已如实标"同一处"）。

| 轴 | 编号 | 主张（摘其原文语义） | 可达性分诊 | 处置 |
|---|---|---|---|---|
| 后端 | W1 | `--root` 允许指向任意子目录并"全零通过"；`BASELINE_PATH` 固定在 `scripts/`，换树时基线坐标系不跟着换 | 成立：`--root scripts` 实测 rc=0、`domain=217`、`filesOver500: 0` | **已采纳**：`gitDomain` 先取 `git rev-parse --show-toplevel` 与 root 对账，不等即抛错 ⇒ CLI rc=2；锁 ⑪ + 消费者 CLI 分档锁 + 变异 M13 |
| 后端 | W2 | 声称锁住"CLI 三档 rc"，实际只覆盖 rc=0/rc=2；`process.exit(1)` 那条路径与 `check()` 都没有用例 | 成立：对 `rc, 1` 的扫描零命中，`check(` 在测试里零命中 | **已采纳**：新增判定层锁（现场>基线 ⇒ 五项违规逐一产出且 `pass=false`，并配"现场==基线必须全绿"的正控，防"恒红"实现通过）+ 变异 M14 |
| 后端 | I1 | `git-domain.test.js` 里 `!d.has(…) || d.has(…)` 是恒真式，属装饰性断言（与本片要消灭的 M11 同型） | 成立：读该行确认任何输入都真 | **已采纳**：删除该恒真式，改为断言"被跟踪且命中忽略的产物仍在域内" |
| 后端 | I2 | 注释写"只持久化这 5 个数值口径"，`PERSISTED_KEYS` 实际是更多键且含非数值键；且没有针对落盘形状的测试 | 成立：实测 9 个键，含 `maxFilePath`/`circularDepDetails` | **已采纳**：注释按实测改 9 键 + 新增基线形状锁（`toPersisted` 键集与受管 `debt-baseline.json` `deepStrictEqual`）+ 变异 M15 |
| 后端 | I3 | `measureModelProviderFanOut` 不经域过滤（直接 `existsSync`/`readFileSync`），与"域 = 该不该被量"不一致 | 成立：真仓该文件受管 ⇒ 无行为变化，但换树/该路径为产物形态时会虚计 | **已采纳**：加 `domain.has(MODEL_PROVIDER_PATH)` 门 + 双档锁（忽略态 ⇒ 0；`git add -f` 成"被跟踪且命中忽略" ⇒ 2，正控防"那个 0 是探针失明"）+ 变异 M16 |
| 后端 | I4 | 夹具构造了隔离 env，但 `collectMetrics`/`gitDomain` 调用都不传 `{env}`，实际走测试进程的 `process.env` | 成立：夹具调用点确实未带 opts | **已采纳**：`collectMetrics(root, opts)` 透传 env，夹具调用点全部带 `{ env: f.env }`（这也是语义 ⑥ 能做两档 A/B 的前提） |
| 后端 | I5 | 声称"11 条"而实测只有 10 条；模块里"六条语义 ①–⑥"的编号与用例 ①–⑩ 不对应 | 成立（评审时确为 10 条；⑪ 是采纳 W1 时新增，现当场实测 11 条） | **已采纳**：docblock 改为如实写映射（①→②/⑧、②→③、③→⑤/⑥、④→④、⑤→①/⑨/⑪、⑥→⑦；用例 ⑩ 不属六条语义，是夹具完整性锁），计数一律按当场实测写 |
| 前端 | W1 | 同后端 W1（`--root` 子目录 ⇒ 静默假绿，docblock 只警告不设防） | 同上 | **同一处修复覆盖**，不重复计一次 |
| 前端 | I1 | `check-debt-budget.js` 注释说"5 个数值口径"，数组实际更多且含非数值键 | 同后端 I2 | 同上 |
| 前端 | I2 | 两处文件头的"实测"本机超限数互相矛盾（97 vs 96），且当前树实测是 95 | 成立：三个数取自不同树/不同产物数量，当前干净树无产物 | **已采纳**：按上表逐数归因，并写明"绝对值随仓库增长浮动、97 不得再称实测" |
| 前端 | I3 | `check-max-lines.test.js` 的测试名仍写 `gitDomain()`（无参），函数体已传 root——同一 diff 里改了体没改名 | 成立 | **已采纳**：测试名改 `gitDomain(root)`，与"root 必传"口径一致 |
| 前端 | I4 | 术语漂移：`受管` / `被跟踪` / `在索引里` / `索引内` 四处称同一概念 | 成立（四处均实测命中） | **部分采纳（收敛不扩散）**：共享实现 docblock 定「被跟踪」为主称谓并显式承认同义写法；全仓把"受管"改名会同时动两个既有门禁的文案与其结构锁，属另片扩面 |

### 变异反证（16 道，逐条实跑、红集互不相同）

| id | 把实现改回的被禁形态 | 结果 |
|----|----------------------|------|
| M1 | 摘掉计数侧域过滤（退回磁盘域） | CAUGHT，红 1 条：`gitignored 的构建产物不得计入 filesOver500` |
| M2 | 摘掉循环依赖侧域过滤（第二处 walk） | CAUGHT，红 1 条：`第二处 walk 同一把域` |
| M3 | 判据自身故障的退出码 2 改回 0（把失明读成通过） | CAUGHT，红 1 条：`CLI 分档：取不到 git 读数 ⇒ 退出码 2` |
| M4 | 换成行为等价的本地包装（`r => __gd(r)`） | CAUGHT，红 1 条且**只有**防漂移那条红 ⇒ 证明它测的是"共享"不是"能跑" |
| M5 | 恢复无条件 `main()`（import 期杀测试进程） | CAUGHT，红在 `⑩ 消费者套件必须整份真的跑了`（tests 掉到 1 被计数锁抓住） |
| M6 | 丢未跟踪半边（收窄成只看索引） | CAUGHT，红 3 条（③ / ⑦ / 消费者 T4） |
| M7 | 丢索引半边（只看未跟踪） | CAUGHT，红 7 条 |
| M8 | 把并集退化成 check-ignore（剔掉"被跟踪但命中忽略"） | CAUGHT，红 8 条 |
| M9 | 去掉空域抛错 | CAUGHT，红 1 条：`⑥ 空仓库必须抛错` |
| M10 | 允许缺 root（静默按脚本所在目录降级） | CAUGHT，红 1 条：`⑨ root 必传` |
| M11 | 取域时忽略 `opts.env`、强制继承宿主 env | **首跑 MISSED ⇒ 见下条纠偏**；改 API + 改夹具后重跑 CAUGHT，红 1 条：`⑦ 机器态能改域` |
| M12 | 摘掉 CI 里那两行接线 | CAUGHT，`check-unwired-tests` rc=1 且**逐个点名**两个文件 |
| M13 | 摘掉「root 必须是 toplevel」守卫（采纳后端 W1 的锁） | CAUGHT，红 2 条：`⑪ toplevel 锁` + `⑩ 计数锁`（摘守卫同时少跑一条，被计数锁抓住） |
| M14 | `check()` 把 `violations` 清空（超基线也不报 ⇒ rc=1 那一档永不发生） | CAUGHT，红 1 条：判定层锁 |
| M15 | `toPersisted` 退回 `Object.assign({}, data)`（当场读数进账本） | CAUGHT，红 1 条：基线形状锁。**首跑 `ANCHOR hits=0` 不是锁没牙**，是我自己的驱动没把 needle 的换行换成该文件的 `CRLF`（`i/lf w/crlf`）—— 修驱动（按文件探测 `nl`）后重跑转 CAUGHT |
| M16 | 摘掉 `measureModelProviderFanOut` 的域门（第三处取数退回"磁盘存在就算"） | CAUGHT，红 1 条：第三处取数锁（后端轴 I3） |

**M11 是这片最有价值的一条**：它抓到我自己写的 `⑦` 是一条装饰性断言 —— 原夹具把 `ghost.js` 提交进了索引，
而 `core.excludesFile` 只作用于 `--others --exclude-standard` 半边，于是"两档 A/B"实际在读同一份输出，
`gitDomain` 里怎么改 env 都不会红。纠偏两步：① 把 `env` 提成显式入参（没有这个入口，"实现屏蔽机器态"这类断言
**根本无法验证**）；② 夹具改成"未跟踪且未被本地忽略"的文件，并要求两档给出**不同大小**的域。
同一轮里 `⑦` 的文案也从"不得能改域"改成"能改域，且必须如实反映"—— 判据本体按调用方 env 取域，
因为这条不变量是"域 == git status 口径"，而 `git status` 本身吃机器态。

### 遗留（不假装已闭合）

1. **基线仍是缓冲**：`scripts/debt-baseline.json` 的 `filesOver500: 101` 与现场 95 之间有 6 格余量，
   它吸收过一次偏差也就会吸收下一次。正解是"基线必须由 `--update` 从**域内**现状生成、且 growth 只降不升"，
   但那是改基线语义（动"谁来守门"），另片处理。
2. **`check-debt-budget` 的 `EXCLUDE` 仍是子串松匹配**（`relative.includes('tests')` 这类），
   域过滤在它之后生效 ⇒ 一个 `apps/desktop/src/tests/foo.js` 式的受管文件会同时被 EXCLUDE 剔出计数，
   而 `check-max-lines` 用的是同一份字面量。这是**存量口径**，本片没顺手改，避免把两个门禁的判定域一起动。
3. ~~`--root` 指向仓库子目录时坐标系错位~~ **已随采纳后端/前端两轴的 W1 收掉**：`gitDomain` 先取 `git rev-parse --show-toplevel` 与 root 对账，
   不等即抛错 ⇒ CLI 退出码 2（锁 ⑪ + 消费者 CLI 分档锁 + 变异 M13 实测 CAUGHT）。
4. **CI 的 main push 档不覆盖 `openspec/**`**：与本片无关，但记录归属靠 squash 尾注，若将来有人给 ruleset 加旁路主体，
   推导链会出现"记录进过 main 但那次 push 没跑门禁"的窗口（见 `changes` job 注释）。
