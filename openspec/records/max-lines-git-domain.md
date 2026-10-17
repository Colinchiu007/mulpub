---
record: max-lines-git-domain
task: 把 check-max-lines 的扫描域从「磁盘全量」改成「git 的域」，修掉本机构建产物造成的 NEW_OVER_LIMIT 假红
date: 2026-10-18
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（按 AGENTS「PR 自动合并」收尾链回填并删除本三字段）
---

## 本次执行记录：行数门禁的扫描域改成 git 的域（max-lines-git-domain，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行面（CI 门禁本体）⇒ 隔离 worktree `mp-max-lines-git-domain` + 裸分支 `max-lines-git-domain`（基线 `d643efce3` = 当时 `origin/main`）；`node scripts/verify-worktree-deps.js` OK（11 项解析全部指向本 worktree）。复杂度定档 M-：`ccg-review-decider` 实测 `225 行 / 2 个源文件 / 无敏感命中` ⇒ 判 DUAL（审查面），但**不新增能力面、不改任何既有规格条款**，故未建 openspec change —— 与同形状先例 #3837（98 行 / 2 文件，同样只落 record）一致 |
| 第一性原因（QM-5 ①） | PASS | 引入点 = `826fa7e13`（PR #3782，change `bundle-untrack`）把 5 个构建产物移出版本控制（`.gitignore:415-419` 点名 `apps/desktop/electron/preload/index.bundle.js`、`home-shell-preload.bundle.js` 等）。该 PR 给消费这些产物的 CI 作业补了「先重建再测」，**却没问过行数门禁的扫描域**：`check-max-lines.js` 的 `walkDir` 一直是 `fs.readdirSync` 走磁盘、从不问 `.gitignore`。两个产物既落在 `SCAN_DIRS` 内、扩展名又是 `.js` ⇒ 本机跑过一次 `build:preload` 就被判成"新增超大源文件"。它们在账本里是 `pruned` 墓碑（1782 / 1833 行），所以症状是 `NEW_OVER_LIMIT` 并附「该路径曾还清债务…不得重新挂账」，而不是 `LEDGER_GREW` |
| 逃逸分析（QM-5 ②） | PASS | 单元/集成层：既有夹具全在**临时目录**里造树，与被实现的错误前提同形（磁盘域），所以「测了」但测不到这一格 —— 归类 **Mock/夹具不像真实形态**；CI 层：`debt-guard.yml` 的检出里没有 gitignored 产物，这条红在 CI 上**结构性不可见**，归类 **环境差异**；审查层：账本 `//` 注释还在讲这两个键的容差如何被上调，读的人会以为它们仍受管。⇒ 「本机红 / CI 绿」被当成开发机噪声，而不是判据缺陷，这是它活到今天的唯一原因 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：判据「该不该被量」交给 git —— `gitDomain(root)` = `git ls-files -z` ∪ `git ls-files -z --others --exclude-standard`（`git status` 与 CI 检出共同看的集合），`walkDir` / `scanTestFiles` 在**读文件之前**按域过滤。三条不可破：不退回磁盘全量；不收窄成只看索引；取不到读数（非工作树 / git 不可执行 / 空集合）一律抛错 ⇒ `main()` 转退出码 **2**（1=发现违规，2=判据自身故障，不混档）。现场留痕：plain 打印 `domain=<n>`、`--json` 不打印且 JSON 带 `domainSize`。回归锁 **10 条**（追加进已接线的 `check-max-lines.test.js`）：gitignored 产物不得入表 / 未跟踪未忽略仍可见 / 非工作树必须抛错且 CLI rc=2 / 空仓库必须抛错 / 真实仓域与 `git status` 口径 deepEqual（独立探针 + 规模下界 + 账本每键可量）/ 留痕两向锁 / 被跟踪但命中忽略仍在域内 / 索引有磁盘无必须报 STALE / system 档改域的两档 A/B。实测 `node --test .github/scripts/check-max-lines.test.js` = **36 tests / 36 pass / 0 fail** |
| 防止再次发生（QM-5 ⑤） | PASS | ① 自动化：10 条锁随 `debt-guard.yml`（required 检查「债务熔断检查」，实测 ruleset `main-ci-gate` 7 条之一）每次 PR + 每次 main push 跑；② 判据本体 docblock 写满六条语义（含「并集不是 check-ignore」「路径一律相对扫描根」「机器态会改域」），下一个会话不必重新推导；③ 变异反证 **10 道**：M1 摘域过滤 / M2 丢 `--others` / M3 静默空域 / M4 摘空集合守卫 / M5 丢 `--exclude-standard` / M6 留痕不分 `--json` / M7 丢索引半边 / M8 摘掉「读不到」出声 / M9 摘夹具 NOSYSTEM / M10 把隔离守卫改成恒过 —— 结果 **9 道 CAUGHT 且红集互不相同**，M8 实测 `MISSED_BY_DESIGN`（该分支本机无法确定性触发，见遗留 3，**不声称锁过**）；驱动异常路径强制还原，收尾两文件按 md5 与备份逐字节相同；④ CHANGELOG + 内置记忆 + EverOS 各一条「本机域 ≠ CI 域」同型登记 |
| 行尾与 diff 对账 | PASS | 两文件均 `git ls-files --eol` = `i/lf w/crlf attr=text=auto`，工作副本实测 `lone_lf=0`（598/598 与 617/617 量级，每次改动都断言 `crlf_delta == lines_delta`）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐字相等，删除数全部可归因到被替换的函数签名与 docblock 行 |
| 接线棘轮 | PASS | 未新增测试**文件**（10 条锁追加进已被 `debt-guard.yml` 显式点名的 `check-max-lines.test.js`）；`node scripts/check-unwired-tests.js` rc=0（检查域 97 个测试文件，「全部测试均已接线或按欠账登记」） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/**` 运行时代码与任何 UI 文件；改动面 = `.github/scripts/check-max-lines.js` + 其测试 + 两份评审原件 + 本记录 + CHANGELOG |
| QM-6 CCG 双模型外部评审 | PASS（双轴，规定通道） | `ccg-review-decider` 判 `mode=DUAL`。CC Switch `:15721` 实测 **open** ⇒ 按 AGENTS 原文走 `codeagent-wrapper`，两轴并行派发（未降级到替代通道）。**前端/可维护性轴**（`claude`）：`VERDICT: PASS`，Critical 0 / Warning 2 / Info 4。**后端/逻辑轴**（`codex`）：第一次 `AXIS_RC=0` 却**零结论**（stdout 只有进度行 + 它自己的 `image path ... is not a file`，无产物）⇒ 按「文件落盘或 stdout 有完整正文」判为未跑成，**不计入已审**；关掉 stdin（`</dev/null`）重投后交付，`VERDICT: NEEDS_REVISION`，Critical 1 / Warning 3 / Info 3。三份原件入库：`.ccg/reviews/max-lines-git-domain-review-{backend,frontend}.md` 与任务书 `…-review-brief.md`（路径全部相对仓库根，两轴各问各的、互不复述）。<br>**逐条处置**：后端 C1「被跟踪但命中 `.gitignore` 的产物缺回归锁」**成立**（它自己也写明"不是本提交引入的错误，是锁缺这一格"）⇒ 采纳，补锁 + docblock 语义 ④，变异 M7 证明其有牙；后端 W1「`readFileSync` 静默 skip 让幽灵路径无声放过」**机理部分不成立**——磁盘已删的文件根本进不了 `readdirSync`，不走那条 catch；真正静默的是读失败那一格 ⇒ 采纳为「读失败出声」+ 另补一条 STALE 锁钉住可达那一格，并如实登记"出声分支本机无锁"（M8 实测 MISSED）；后端 W2/W3（`--root` 子目录坐标系、嵌套仓、探针只覆盖默认 ROOT）**采纳为文档**（语义 ⑤），不改分档、不加断言，上限写进本记录遗留 4/5；后端 Info 四条全部接受为已登记（rc=2 属合理 fail-closed、64MB 够用、收窄到 `SCAN_DIRS` 是可做但须同步缩小账本断言、探针 tracked 半边与实现同命令）。前端 W2「`delete GIT_CONFIG_SYSTEM` 不关 system 档，唯一开关是 `GIT_CONFIG_NOSYSTEM`」**成立**⇒ 采纳，并**另做一次独立实验**（在仓库外的临时目录造一份 system 档，不碰被审工作树）实测：带该配置时产物被藏出域（`domainSize` 少 1），置 `NOSYSTEM=1` 后回到域内 ⇒ 新增两档 A/B 锁 + 夹具隔离自检。前端 W1（同根因第二处）**成立但登记已过时**——它看到的是**第一次 re-sync 之前的实现快照**（当时 sha `1aecfedeb`；该对象已随两次 rebase 在分支上不可达，此处只作历程记号，现势一律按 commit 主题 `fix(gate): check-max-lines 的扫描域改成 git 的域` 定位），本记录的遗留第 1 条在采纳提交里才存在；已另开任务 #82。前端 I1/I2/I3（临时 gitconfig 不清理、同一集合两个函数分别叫 `domain`/`set`、「受管/域」双术语且该注明相对扫描根）**全部采纳**。采纳后重跑：36/36 绿 + 上述 10 道反证 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin max-lines-git-domain` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 PASS | 文档同步 PASS | 远程同步 PENDING

### 本机 A/B（本片真正的验收）与 CI 的判据边界

- **同树对照，只换实现**：在含构建产物的工作树里，按 commit 主题定位被审的修复提交、取其父提交的 `.github/scripts/check-max-lines.js`（**不写死 sha** —— 每次 rebase 都会改写它，写死就是下一个过期引用），配 `--root`（同一棵树）+ 同一份账本跑：
  **修复前 rc=1**，两条 `NEW_OVER_LIMIT`（`home-shell-preload.bundle.js 1803 行`、`preload/index.bundle.js 1752 行`，均带墓碑文案）；
  **修复后 rc=0**，`[max-lines] domain=9996`（在 `a7bd8a496` 基线上重跑）。**这个数是当场读数、不是基线**：第一轮取证 9943、第一次 re-sync 后 9976、第二次 re-sync 后 9996 —— 每次 rebase 都要重取，引用者不得把它当常数。产物在场性另用 `git check-ignore -v` 逐个核（4 个 bundle 全部 PRESENT + ignored=YES）。
- **A/B 的 A 侧必须由内容特征自证，不能靠"数提交"定位**：第二次重跑时我把 BASE 数错一格（`HEAD~3` 是被审的修复提交本身而不是它的父），于是 A/B 两边跑的是同一份修复后实现、**两边都 rc=0**，读起来完全像"假红自己消失了"。现在的判据是硬断言：A 侧源码**必须不含** `gitDomain`、B 侧**必须含**，任一不成立立即抛错。这条与「mock 对所有输入返回同一份数据 ⇒ 该类缺陷结构性免疫」同型，只是这里被免疫的是"我"而不是测试。
- **零回归控制**：干净检出（无产物）下修复前后判定**逐字相同** —— `limit=500 growthAllowance=200 超限文件=95 挂账=95 墓碑=5 点名还账=20` 与 `testLimit=1500 测试超限=12 测试挂账=12`；账本 127 个键（`files` 95 + `testFiles` 12 + `targets` 20）逐个 `git ls-files --error-unmatch` 全部受管且全部在域内（第二次 re-sync 后重测：UNMANAGED=0、LEDGER_KEYS_NOT_IN_DOMAIN=0、DOMAIN=9996） ⇒ 收窄不会把任何存量键弹出判定域。
- **必须如实说的边界**：这条假红**只在开发机存在**，CI 的检出里从来没有这些产物，所以 CI 全绿**不是**本片的验收证据；CI 侧要证明的只是"没把别的搞坏"。真实验收 = 上面那组同树 A/B。
- **夹具的一条反直觉实测**（写下来省得下次重踩）：夹具那份空 gitconfig 若写进被测目录，会被 `git ls-files --others` 当成 1 个未跟踪文件 ⇒ "空仓库"夹具其实非空 ⇒ `set.size === 0` 那道守卫点不到火。T6 首跑失败的真实原因即此；修夹具，不改断言。

### 遗留（不假装已闭合）

1. **同根因第二处未修（任务 #82）**：`scripts/check-debt-budget.js` 的两处 `readdirSync` 仍是磁盘域。实测本机带产物时它报 `filesOver500: 97`，CI 侧是 95、基线 101 —— 现在不红只是因为还剩 4 格余量；再多一个产物过线、或基线经 `--update` 下调，本机就会复制本次假红形态。正解是把本片 `gitDomain` 收敛成单一实现（先例 `scripts/lib/code-mask.js`；`.gitignore` 的 `scripts/*.js` 只匹配直接子层，`scripts/lib/` 可入库）+ 一条"两处扫描域必须同源"的防漂移锁。**本片刻意没顺手做**：那会同时改动第二个门禁的判定域与它的基线语义，属"改谁来守门"的第二次扩面（两轴评审也都建议不要在本次顺手做）。
2. **取域没有按 `SCAN_DIRS` 收窄**：现在每次都取**全仓**（~1 万条）而判定只用得上 `SCAN_DIRS` 部分。实测无性能问题（多 2 次 git 调用，整轮 36 例约 7s）。后端 Info 给出的做法可执行（把 `SCAN_DIRS` 当 pathspec 传进两处 `ls-files`，判定结果不变），但**代价是"账本每个键可被量到"那条断言会失去对象**，需同步缩小 —— 因此不在本片做。
3. **「域内但读不到内容」这条出声无锁**：M8 把它的触发条件改成恒假，实测 `rc=0 / 0 红`。原因是本机造不出确定性读失败：实测 `chmod 000` 之后 `readFileSync` 仍读得到（READ_OK），而把路径做成目录会被 `walkDir` 的 `isDirectory()` 先递归掉——两种写法都不产生那条 catch。⇒ 这段代码是"比原来的静默 continue 更好"，但**没有回归保护**，不得声称锁过。
4. **"域 == git status 口径" 这条锁的独立性有上限**（后端 Info 命中）：探针的 tracked 半边与实现用的是同一条 `git ls-files`，只有 untracked 半边经 `git status -uall` 独立验。⇒ 同源同向的故障（比如 `ls-files` 参数整体写错）不会被它抓到，那一格目前由 M2/M7 两道变异的红集兜住一部分。
5. **`--root` 指到真实仓的子目录会让账本坐标系整体错位**（`ls-files` 按 cwd 输出，而挂账键是仓库根相对）。这是**存量行为**，本片只在 `gitDomain` docblock 写明"`--root` 只能指另一个仓库根"，未加断言、未改分档。
6. **账本注释与实际语义脱钩**：`pruned` 里那两个产物键现在描述的是"不受管的东西"，而 `//` 注释还在讲它们的容差被抬到 1538/1782/1833。墓碑对永久被忽略的路径不再可达（这是本片收窄语义的直接后果，也是后端 C1 关心的那一格）。清掉它们属独立判断，留给 #82 一起处理。
