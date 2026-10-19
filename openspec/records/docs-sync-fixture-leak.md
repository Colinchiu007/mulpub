---
record: docs-sync-fixture-leak
task: check-docs-sync.test.sh 的夹具会落到仓库工作树里，而用例照报 PASS —— 给「夹具只准落在 $TMP 内」装上执行体
date: 2026-10-18
---

## 本次执行记录：docs-sync 夹具泄漏修复（docs-sync-fixture-leak，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 改的是 `scripts/` 测试脚本本体 ⇒ 按 AGENTS 属**混合 PR**（不得走 docs-only 快速通道），已在隔离 worktree：`bash scripts/session-init.sh docs-sync-fixture-leak` → `<仓库父目录>/mp-worktrees/mp-docs-sync-fixture-leak`，裸分支 `docs-sync-fixture-leak`，`verify-worktree-deps OK`（11 项 `@multi-publish/*` 全部指向本 worktree）。判定 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=false`**（见「判定与实跑读数」） |
| 第一性原因（QM-5 ①） | PASS | **夹具路径来自被污染的命令替换**。`make_repo`（`scripts/check-docs-sync.test.sh:55-70`，行号当场 grep 过）里每条 `tgit` 调用都没关 stdout，而调用方写的是 `repo="$(make_repo "case-$CASE")"`（`:78`，当场 grep 核过）——命令替换会把函数写进 stdout 的一切拼成一个字符串。触发条件是**继承 MSYS 的路径转换开关**：`/tmp/tmp.XXXX` 这时被 bash（MSYS 根）与原生 `git.exe`（当成盘内路径）解析成**两个不同位置**，于是 `echo seed > "$dir/README.md"` 与 `git -C "$dir" add -A` 量的不是同一个目录，seed 提交变空，git 就把 `On branch main / Initial commit / nothing to commit …` 这段 status 原文打到 stdout ⇒ 整段进了 `$repo` ⇒ 后面的 `mkdir -p "$repo/$(dirname "$f")"`（`:89`）**相对 cwd** 建目录写文件，也就是往真实工作树里落垃圾 |
| 逃逸分析（QM-5 ②） | PASS | ① **用例的 rc 不是"夹具是否正常"的判据**：事发那次（`/d/tmp/p124-docsync-selftest.log`，7149 字节）日志第 1 行就是 `line 39: /tmp/tmp.e4ivNEFFhs/case-1/README.md: No such file or directory`，而第 20 行照样打印 `PASS: 纯 scripts/ 工具变更属流程层，无需同步文档` —— 归类 测试质量不足（断言只覆盖"被检方的 rc"，不覆盖"夹具自己是否成形"）；② 垃圾是**未跟踪**文件，CI 的检出态里没有它 ⇒ 任何远程门禁结构性看不见，归类 环境差异；③ AGENTS 有「文件系统测试隔离：测试不得把可写状态固定到仓库内共享文件」这条纪律，但**没有任何机械判据**在测它，归类 流程缺失；④ 唯一"顺带撞上"它的判据是 `check-unwired-tests.js` 的嵌套 workflow 检查，而它按**磁盘**扫 ⇒ 报出来的是本机假红（点名一个不存在的仓库缺陷），既没定位到根因又制造了噪音，归类 测试质量不足 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复分四层，全部落在同一个自测文件里（无新增测试文件 ⇒ 不触碰 `check-unwired-tests.js` 的接线棘轮）：① **环境免疫**——入口 `unset MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL`，把夹具绑定的路径语义由夹具自己定（同族先例：AGENTS「断言 git status 干净度的测试夹具，必须自己声明 EOL 档并把索引交给 checkout」）；② **stdout 隔离**——`make_repo` 内每条 git 调用一律 `> /dev/null`，函数唯一的 stdout 出口是 `printf '%s' "$dir"`；③ **fail-closed 前置闸**——`repo` 必须逐字等于 `$TMP/case-<n>`，且这条判断排在**任何写入之前**（顺序即判据的一半：放在 mkdir 之后就等于先落盘再报错）；④ **夹具完整性自检**——`rev-parse HEAD` 必须存在且 `ls-files` 必须含 `README.md`，缺任一即 FATAL，使"PASS 测的是一个从没成形过的仓库"这一形态不可表示；另加⑤ **隔离对账**——进入时快照 cwd 条目、收尾与快照 `comm` 求差，出现任何新增条目即 FATAL 且**点名泄漏**（排在成败汇总之前，否则"用例全绿但漏了垃圾"这条路被让出去）。RED→GREEN 实测：改前 A 臂（`MSYS_NO_PATHCONV=1`，沙箱 cwd）`rc=1` + `FAILED: 8/8` + 沙箱残留 **5**；改后 A/B 两臂均 `rc=0` `PASS: 8` 且残留 **0** |
| 防止再次发生（QM-5 ⑤） | PASS | ① 五道锁全部是**机械判据**而非注释/自觉（AGENTS 里那条纪律第一次有了执行体）；② 每条锁都做了变异反证，见下表——特别地 `L5b` 证明「摘掉 README 闸 ⇒ 空 seed 夹具照样报 PASS: 8」，即这条闸不是装饰；③ 同类面已**清点**而不是推测：在 `scripts/` 与 `.github/scripts/` 下按 `$(mktemp -d)` 扫，命中文件 **1 个**（就是本文件），按 `repo="$(…repo…)"` 的捕获形态扫同样只命中它 ⇒ 本片的修法范围=该类的全集；④ `01-docs/learnings.md` 追加一条（含 A/B 读数与"rc=0 但判据没跑"这条同族陷阱）；⑤ 连带缺陷另立任务，不在本片混入：`check-unwired-tests.js` 的判定域是磁盘而非 `git ls-files`（与 #3876 同族的「磁盘域 vs git 检出域」分叉） |
| 行尾与 diff 对账 | PASS | 本文件 LF；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐字相等 = `+61 -6`（见「判定与实跑读数」）；`bash -n` 语法检查通过 |
| 接线棘轮 | N/A | 未新增测试文件；`node scripts/check-unwired-tests.js` rc=0 作控制（自测本体已由 `doc-gate.yml` 与 `quality-gate.yml` 点名，改的是它内部） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动全在 `scripts/` 自测脚本，与打包/像素判定域无交集 |
| QM-6 CCG 双模型外部评审 | 见说明 | 按用户指令由本会话自演两轴（后端=逻辑/边界/安全，前端=命名/模式/集成风险），发现与处置见「QM-6 自演评审处置」；不冒充外部模型评审 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导；合并前写 `PASS` 会被判「预写不存在的证据」而红 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### A/B 与变异反证（每条都在沙箱 cwd 里跑，垃圾只落沙箱、绝不落工作树）

驱动：改前 A/B 是**内联 bash** 跑的（现场留在临时目录的 `p169-a.log` / `p169-b.log`，没有对应脚本文件——我原本在这里写成 `p169.js`，被 Gate 12c 当场抓到「磁盘上不存在」，那正是本仓「不得按印象补全产物名」的同型错误）；分层变异驱动 `p174.js`、隔离锁专属驱动 `p175.js` 两个文件当场 `ls` 过。
每条变异跑完**逐字节还原**并校验（`RESTORED byte_equal=true`）。读数里的 `stray` = 沙箱 cwd 的残留条目数。

| 用例 / 变异 | 摘掉的东西 | 环境 | rc | stray | 点名信号 |
|---|---|---|---|---|---|
| 基线 plain | 无 | — | 0 | 0 | `PASS: 8` |
| 基线 msys | 无 | `MSYS_NO_PATHCONV=1` | 0 | 0 | `PASS: 8`（环境免疫成立） |
| 改前 A（缺陷现场复现） | — | `MSYS_NO_PATHCONV=1` | 1 | **5** | `FAILED: 8 / 8` |
| M1 摘 `unset` | 第①层 | msys | 1 | 0 | `没有任何提交`（第④层接住） |
| L2 摘 `unset` + 摘 commit 那行的 `> /dev/null` | ①+② | msys | 1 | 0 | `stdout 被污染`（第③层接住，且**未落盘**） |
| L3 再摘等值闸 | ①+②+③ | msys | 1 | 1 | `没有任何提交`；stray=1 ⇒ 泄漏已开始，被第④层当场截断 |
| L4 再摘隔离对账 | ①+②+③+⑤ | msys | 1 | 1 | 无「夹具泄漏」点名 ⇒ 只剩第④层兜，泄漏不再被**命名** |
| L5 把 seed 文件名改掉（`README.md`→`READMEX`） | 造"有提交但 seed 不在索引" | plain | 1 | 0 | `没进索引`（第④层 README 闸独占命中，`没有任何提交`=false ⇒ 两条闸各测各的） |
| **L5b L5 + 摘 README 闸** | ④的 README 半区 | plain | **0** | 0 | **`PASS: 8`** ⇒ 摘掉闸后空 seed 夹具照报全绿，证明这条闸非装饰 |
| L6 把夹具目录改成**相对 cwd** + 摘等值闸（夹具本身完全合法） | ③ | plain | 1 | **16** | `夹具泄漏到 cwd`（**只有**隔离对账会红） |
| L6b L6 + 摘隔离对账 | ③+⑤ | plain | 1 | 16 | 无任何点名 ⇒ 泄漏存在而判据说不出为什么红 |

一条如实的边界：**L6b 仍退出 1，只是不点名**。所以「摘掉隔离锁就变成静默 PASS」这句话不成立；成立的是
**事发当时的 p124 形态确实报了 PASS**（现场日志为证），而隔离锁的价值在于把"泄漏"从"某个用例恰好变红"
升级成"点名 + 列出新增条目"。这两种说法差别很大，按实测写。

### QM-6 自演评审处置

| 轴 | 编号 | 主张 | 可达性/成立性判定 | 处置 |
|---|---|---|---|---|
| 后端 | W1 | `tgit push -q origin main 2> /dev/null` 原本把 stderr 丢掉而 stdout 保留，方向恰好相反：会污染 `$repo` 的正是 stdout | **成立**（实测 stderr 不含 status 文本）；已改为 `> /dev/null 2>&1` | 已修 |
| 后端 | W2 | 等值闸用字符串相等，若 `mktemp` 返回带 symlink 的路径（macOS `/var → /private/var`），`$repo` 与 `$TMP/case-1` 可能不同形而误红 | **本机不成立**：Windows Git Bash 的 `mktemp -d` 返回 `/tmp/tmp.XXXX` 原样拼接，`make_repo` 内部只做 `"$TMP/$1"` 拼接，不经过任何 realpath；且 Linux runner 上 `/tmp` 不是 symlink | 不改判据，但把"为什么可以只用相等比较"写进注释，避免下一个会话当"漏了 realpath"去"修好"它 |
| 后端 | W3 | 隔离对账用 `comm`，要求两边都按同一 locale 排序；`ls -1A \| sort` 与快照同法，成立；但若被测脚本在 cwd 里留下**含换行的目录名**（正是本次的事发形态！），`ls -1A` 会把它拆成多行 | **成立且是真实形态**：事发的垃圾名内嵌 U+2012 分隔符而非换行，实测 `ls -1A` 输出 5 行、对账照样命中并判红；但为防"名字真含换行"的变体，FATAL 文案不依赖条目数而是**原样打印差集前 20 条** | 已按此实现（`head -n 20` + 逐行前缀打印） |
| 前端 | I1 | 五道锁都写在一个文件里，注释密度高，可读性下降 | 部分成立；但每条锁都带"为什么在这一层"的动因，删任一条都会让另一条变成唯一防线 | 保留；把层级编号（①–⑤）写进注释与表格，使下一个会话知道哪条对应哪个变异 |
| 前端 | I2 | 建议把"隔离对账"抽成公共 bash helper 供其它 `.test.sh` 复用 | **暂不采纳**：实测同类面只有 1 个文件（见 QM-5 ⑤ ③），现在抽公共层是给 1 个消费者建 2 个文件，且 `check-unwired-tests.js` 的扫描域会把它当新测试文件要求接线 | 记为待第二例出现时再收敛 |

### 遗留（不假装已闭合）

1. **`check-unwired-tests.js` 的判定域仍是磁盘**（`NESTED_WORKFLOW_NOT_EXECUTED` 用目录遍历而非 `git ls-files`），
   于是本机未跟踪垃圾会冒充"仓库里有嵌套 workflow"把公共仓 required 门禁判红一次。属与 #3876 同族的
   「磁盘域 vs git 检出域」分叉，另立任务处理（本片不混入，因为动它=动谁来守门）。
2. **`make_repo` 的 stdout 隔离是"逐条 `> /dev/null`"而不是"结构上不可能"**：新增一条 git 调用而忘记关
   stdout 时，仍会污染 `$repo` —— 此时兜住它的是第③层等值闸（会红、不会落盘），不是第②层。
   更彻底的做法是把 `make_repo` 改成"写文件传路径"而不是"回显路径"，属扩面，未做。
3. **AGENTS 那条「文件系统测试隔离」目前只有这一个文件有执行体**。其它语言（vitest / pytest / ps1）的夹具
   落到仓库内的风险没有统一判据；要收敛得先做一次全仓清点（本次只清了 `*.sh` 这一族）。

### 判定与实跑读数

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=false` / files=4**
  （`scripts/check-docs-sync.test.sh`、`CHANGELOG.md`、`01-docs/learnings.md`、`openspec/records/docs-sync-fixture-leak.md`；
  根级 `*.md` 命中白名单而 `scripts/**` 不命中 ⇒ 走完整门禁）
- 改动的自测本体：`bash scripts/check-docs-sync.test.sh` → `PASS: 8 docs-sync gate checks`（rc=0，工作树零新增）
- `bash -n scripts/check-docs-sync.test.sh` → 语法 OK
- `node scripts/check-unwired-tests.js` rc=0 ｜ `node scripts/check-debt-budget.js` rc=0 ｜ `.github/scripts/check-max-lines.js` rc=0
  ｜ `node scripts/check-no-conflict-markers.js` rc=0 ｜ `node scripts/check-gate-record-debt.js` rc=0 ｜ `node scripts/check-record-qm5-rows.js` rc=0（必需步骤 ① ② ④ ⑤ 齐）
- `node scripts/check-doc-abs-paths.js`（Gate 12c）rc=0 ｜ `node scripts/check-no-brand-residue.js` rc=0
- 两口径 numstat 逐字相等 = `+180 -6`（re-sync 后在 `5cd5a4198` 上重取，两口径逐字相同 ⇒ 无行尾改写）

### 追加：两个版本在**同一个触发条件**下的对照（2026-10-18，一次误操作送来的免费 A/B）

我随后一批门禁命令因为 `cd` 被 `&` 一起放进了后台，实际跑在了**共享根**（未修版）上，而那个 shell 已经
导出了 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`。于是拿到一组比我原计划更强的对照——**同一环境、两个版本**：

| 版本 | 环境 | 用例结果 | 现场 |
|---|---|---|---|
| 未修版（共享根 `f0c5d1faf`） | caller 导出 MSYS 开关 | `FAILED: 2 / 8`，rc=1，日志 46761 字节 | 第 1 行即 `line 39: /tmp/tmp.HtufpEby3I/case-1/README.md: No such file or directory`；第 20 行却打 `PASS: 纯 scripts/ 工具变更属流程层…`；**负向那条**（`运行时代码缺文档仍被拦红`，期望 rc=1）报成 `实际 rc=0`；根级留下一个空目录，名字就是那段 status 原文 |
| 已修版（本片 `5cd5a4198`） | 同一条命令、同一个 shell 导出 | `PASS: 8 docs-sync gate checks`，rc=0，日志 513 字节 | `git status --porcelain -uall` = 0 行，工作树零残留 |

三条由此确立、且原先只停在推理层面的事实：

1. **触发条件确证**是继承的 MSYS 路径转换开关，与仓库内容无关：同一开关下旧版红、新版绿。
2. 夹具坏时的失效方向是**双向**的 —— 正向用例可能 vacuously PASS，而**负向用例会把"该拦的没拦住"读成通过**。
   本案红掉的那条恰好是"豁免不得外溢到 `apps/`"这条负向锁：它失效意味着门禁回归的探测器本身失灵，
   比漏报一个用例严重得多。
3. 泄漏产物可能是 **git 不可见的空目录**（空目录不入 git，`git status` 永不报它）⇒
   「`git status` 干净」**不构成**"没泄漏"的证据。所以本片第⑤道锁的对账用 `ls -1A`（能看到空目录）
   而不是 `git status`。共享根那个空目录我**没有**手工删：`safe-delete.js` 按闸 1（目标必须是文件）
   与闸 3（必须出现在 `??` 里）双重拒绝，而 AGENTS 的 R0 不给目录出口，留给人工 `rmdir`。

### 我自己在本片过程中犯的两次工具性错误（如实记）

1. 把 `&` 放在 `cd ... && 后台任务 &` 之后，导致后续前台命令跑在**上一个 cwd**（共享根）而不是本片
   worktree —— 读数因此一度是"共享根的读数"。发现后逐条在正确 worktree 重跑，未沿用任何一次错读。
2. 第三次在同一会话里用 `node -e "…含反引号的 markdown…"`：bash 抢在 node 之前把正文当命令执行
   （现场打出来的片段是 `f0c5d1faf: command not found`、`FAILED:: command not found`、
   `line: command not found`、`??: command not found`、`safe-delete.js: command not found`、`rmdir: missing operand`）。
   事后逐个核对损害：`rmdir` 因缺参数未执行、
   两个 worktree 与共享根均 clean、记录文件未被写入 ⇒ 无损害。正解是这类内容一律走 Edit/Write 工具，
   本条记录就是用 Edit 落的。
