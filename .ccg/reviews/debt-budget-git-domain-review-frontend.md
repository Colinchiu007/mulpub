# QM-6 评审（前端/可维护性轴）— debt-budget-git-domain

**被审提交**：`a8c0e29f9` ｜ 只读复核，未改任何被审文件。

## 复核跑过的命令与读数

- `node scripts/check-debt-budget.js` ⇒ **rc=0**，`[debt-budget] domain=10050`，`filesOver500: 95 (baseline: 101)`，`circularDeps: 0`。与宣称一致（domain 10050 vs 宣称 10048，差 2 = 本树当前两个未跟踪评审文件，正是 git-status 语义在起作用）。
- `node --test scripts/lib/git-domain.test.js` ⇒ 10 条全 ✔，内含 `[git-domain-suite-count] rc=0 tests=11 pass=11 fail=0 declared=11`。
- `node --test scripts/check-debt-budget.test.js` ⇒ **11/11** 通过。
- `node --test .github/scripts/check-max-lines.test.js` ⇒ **36/36** 通过。
- `node scripts/check-unwired-tests.js` ⇒ rc=0，`检查域内测试文件 102 个 / OK`（两条新测试已接线，与接线锁自洽）。
- `git status` 复核：我只动过评审文件，`scripts/debt-baseline.json` 与两个门禁源码均未被运行本改（读基线存在 → 检查档不落盘）。

## 结论

**VERDICT: PASS**（可合入）。无 Critical。以下 1 条 Warning + 4 条 Info，不影响合入，其中 Warning 属可维护性风险（不构成新回归，但与被审对象新增的 `--root` 面直接相关），建议顺手补一格的锁。

## Warning

### W1 | `scripts/lib/git-domain.js:40` + `scripts/check-debt-budget.js:245` — `--root` 指向仓库子目录时得到**静默假绿**，docblock 只警告不设防

**主张**：`gitDomain(rootDir)` 只校验 root 非空，不校验其是否为「一个仓库根」。当调用方把 root 指向仓库内某子目录时，`git ls-files` 按 cwd 输出，返回的集合**相对该子目录**——函数不抛错，而是静默给出一套错位坐标。docblock 语义 ⑤ 明确警告「root 只能指向一个仓库根，指到仓库子目录会让坐标系整体错位」，但代码无法强制，且没有任何测试锁这一格。

**实测**：临时 git 仓（`apps/desktop/electron/big.js` 600 行受管）：
- repo 根调用：`collectMetrics(root)` ⇒ `domainSize=1 maxFileLines=601 filesOver500=1`；
- 子目录 `--root apps/desktop`：`collectMetrics(sub)` ⇒ `domainSize=1 maxFileLines=0 filesOver500=0` —— **不抛错、全指标为 0**。
- 直接探针 `gitDomain(subdir)` ⇒ `size=2，paths=['a.js','sub/b.js']`，正常返回。

**影响**：此次把单一实现收敛成共享，并给 `check-debt-budget` 新开了 `--root` 通口（原文件名从不接收 root 注入）。若操作员想「换棵树跑 A/B」却误把 `--root` 指向了仓库子目录，整个门禁会在**全指标健康**的假绿下通过，而假绿是门禁最危险的失效方向。

**建议**：二选一——(a) 在 `gitDomain` 里加一道「root 自身是 git 工作树根」的防护（`git rev-parse --show-toplevel` 与原 root 一致才放行，否则抛错，复用现有「取不到读数→退出码 2」链路），语义 ⑤ 从「文档级警告」升成「代码级强制」；(b) 至少在 `scripts/check-debt-budget.test.js` 补一条「`--root <repo子目录>` 必须 fail-closed（rc=2 / 或明确报坐标错位）」，把这一格从「没人测」变成「有锁」。

## Info

### I1 | `scripts/check-debt-budget.js:171` — 注释说「5 个数值口径」，实际数组有 7 项且含非数值键

**主张**：`const PERSISTED_KEYS = [...]` 上方注释写「基线文件只持久化这 5 个数值口径」，但数组实为 **7 项**，且其中 `maxFilePath` 是路径字符串非数值。

**实测**：`node -e` 打印 `PERSISTED_KEYS len=7`；并核对 `PERSISTED_KEYS` 全部 7 键都在 `collectMetrics` 返回值中、`filesOver500Paths`/`domainSize` 等「现场证据」均不在持久化集内（写路径正确，纯注释数错）。

**建议**：把「5 个」改成「这组」，或改成准确计数；顺带把「数值口径」改成「口径键」。

### I2 | `scripts/check-debt-budget.js:19` 与 `scripts/check-debt-budget.test.js:7` — 「实测」的本机超限数相互矛盾（97 vs 96）

**主张**：两处 docblock/文件头都写「实测 97 vs 95」，但提交信息与任务书写「本机 96 / 修复后 95 / CI 95」——同一事件的两个「实测」数字不一致，且当前树实测是 95（本树是干净检出、无 build 产物，无法复现 96/97 任一）。

**建议**：统一成一个可溯源数字，或注明「含 build 产物时上升」的口径而非当做一个固定的「实测」。

### I3 | `.github/scripts/check-max-lines.test.js:539` — 测试名仍是旧的 `gitDomain()`（无参）写法，函数体已传 root

**主张**：改完后测试名写着「与 `gitDomain().size` 一致」，但函数体已是 `G.gitDomain(path.resolve(...))`。同一 diff 里函数体改了、名字没跟。

**建议**：顺带把名字里的 `gitDomain()` 改成 `gitDomain(root)`，避免「root 必传」口径下留一个暗示「可不传」的残留。

### I4 | 术语漂移：`受管` / `被跟踪` / `在索引里` / `索引内` 四处称同一概念

**主张**：`git-domain.test.js` 语义 ① 称「受管文件在域内」、语义 ④ 称「被跟踪…仍在域内」，`check-debt-budget.js` PERSISTED 注释称「受管账本」，`check-max-lines.js` 用「受管文件/受管范围」，`git-domain.js` docblock 用「索引内文件」。同一概念四个叫法。

**建议**：在共享 6 条语义里统一成一个主称谓（建议「**被跟踪**」，与 git 术语同源），其余处引用它。属打磨项，不阻断。

## 复核确认（正项）

- 域语义 ①–⑥ 与 #3876 一致：`ls-files -z` ∪ `ls-files -z --others --exclude-standard` = `git status` 口径，并集非 check-ignore，空域/非工作树抛错；`check-max-lines.test.js` 的独立 `git status` 探针交叉量（deepEqual）确认口径。
- 「root 必传」改造已**全员补齐**：grep 全仓 17 个 `gitDomain(` 调用点，消费方 main 路径均传 `rootDir || ROOT`，两套件的每个探针均传显式 root；`check-debt-budget.test.js` 有 2 条 CLI 分档锁（取不到读数→rc=2；--root 缺值→rc=2）。
- 新字段 `filesOver500Paths`/`filesOver1000Paths`/`domainSize` 经 `PERSISTED_KEYS` 过滤，**不会**进 `--update` 写出的基线文件（实测 `persisted-but-not-in-current: []` 且路径类键全被排除）——不污染账本。
- CI 接线位置恰当：两条新测试在 `quality-gate.yml` `changes` job 的 classify step 内（第 102–103 行），该 job 无 job 级 `if`（不被 docs-only 短路）、且在非 PR 早退（第 104 行 `exit 0`）之前 —— 与既有 `merge-ledger.test.js` 同格式。`check-unwired-tests` 通过，证明接线自身与「一切测试必须被点名」的棘轮自洽。
- 计数锁 ⑩（消费者套件整份真跑）可靠性：子 spawn 已剥 `NODE_TEST_*`，用 `^test\(` 统计声明数、`tests/pass/fail` 汇总行比对（已处理 CRLF `$` 失配和对 `.test` 间接 0 报告的两种情况），实测 declare=11/run=11/pass=11 严格相等，具备防「文件级假绿」的真实能力；无嵌套递归风险（子套件不含二级 runner）。
- `if (require.main === module) main()` 改造：`check-debt-budget.js` 与 `check-max-lines.js` 均已加，`module.exports` 完整导出判据函数与常量——修复了「测试在 import 期被杀、0 条执行却报 pass 1」的真实缺陷。

## 复核保留说明

- 「12 道变异反证（M1…M12）全部 CAUGHT」未逐条重放（只读约束 + 需改被审实现才能注入变异）；我独立验证的是被审实现本身的行为与给到的实测路径（同树 A/B 由后端轴覆盖），变异覆盖范围以作者宣告为准。