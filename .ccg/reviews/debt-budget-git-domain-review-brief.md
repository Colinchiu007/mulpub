# QM-6 评审任务书（change: debt-budget-git-domain）

**被审对象**：worktree = 仓库父目录下的 `mp-worktrees/mp-debt-budget-git-domain`（用 `git worktree list` 现取绝对路径），分支 `debt-budget-git-domain`，
被审提交 = 该分支唯一一笔实现提交（主题 `fix(gates): 债务熔断门禁的扫描域改成 git 的域…`，短 sha `a8c0e29f9`）。
**请用 `git show a8c0e29f9` 与 `git show a8c0e29f9 --stat` 读差量**，并直接读工作树里的现状文件。

## 这片要解决的问题（规格）

#3876 已把行数门禁 `check-max-lines` 的扫描域从磁盘改成 git 的域；同一根因的第二处是
`scripts/debt-budget` 门禁（required 检查「债务熔断检查」，由 `.github/workflows/debt-guard.yml` 每次 PR/main push 跑）：
它两处 `fs.readdirSync` 走磁盘，而 `apps/desktop/electron/**.bundle.js` 这类构建产物既落在 `SCAN_DIRS` 内、
又被 `.gitignore` 忽略 ⇒ 本机跑过 `build:preload` 就比 CI 多数个文件（现场：本机 96 / 修复后 95 / CI 95 / 基线 101，
只差 4 格余量没红）。它**此前没有任何测试文件**。

本片做的：
1. 新建单一实现 `scripts/lib/git-domain.js`：`域 = git ls-files -z ∪ git ls-files -z --others --exclude-standard`
   （= `git status` = CI 检出）。`root` 与 `env` 都是显式入参；取不到读数（非工作树 / git 不可执行 / 空集合）一律抛错。
2. `check-debt-budget.js`：两处 walk（计数 + 循环依赖图）在读文件之前按域过滤；取不到读数 ⇒ **退出码 2**
   （1 留给"确实超基线"）；新增 `--root`；`main()` 改成 `if (require.main === module)` 才跑。
3. `check-max-lines.js`：删掉本地 `gitDomain` 副本，改为引用共享实现（`module.exports` 仍导出 `gitDomain`）。
4. 新测试：`scripts/lib/git-domain.test.js`（11 条）、`scripts/check-debt-budget.test.js`（11 条），
   两行接线进 `quality-gate.yml` 的 `changes` job（不被 docs-only 短路、且在非 PR 早退之前）。

## 宣称的验收证据（请独立复核，不要照抄）

- 真仓 CLI：`node scripts/check-debt-budget.js` ⇒ rc=0、`[debt-budget] domain=10048`、`filesOver500: 95 (baseline: 101)`
- 同树 A/B：造一个被忽略的 600 行产物 ⇒ 修复前实现 `filesOver500=96`、修复后 `95`，DELTA=1
- 变异反证 12 道（M1…M12）自称全部 CAUGHT，红集互不相同；其中 M11 首跑 MISSED，
  暴露锁 ⑦ 当时是装饰性的（`ghost.js` 被提交了，excludesFile 只作用于未跟踪半边），已把 `env` 改成显式入参
  并把夹具改成"未跟踪未忽略"后重测转 CAUGHT
- 实跑命令：`node --test scripts/lib/git-domain.test.js`、`node --test scripts/check-debt-budget.test.js`、
  `node --test .github/scripts/check-max-lines.test.js`（自称 36/36）、`node scripts/check-unwired-tests.js`

## 请重点看（按你的轴各自独立判断，不要互相迁就）

**后端/逻辑轴**：域语义是否仍与 #3876 一致（并集不是 check-ignore；空域抛错；退出码分档）；
把同一份实现给两个消费者用，是否引入新的失效面（例如 `check-max-lines` 原来在本地默认 `ROOT`，现在 root 必传，
调用点是否都补了缺省；`--root` 指子目录时 `check-debt-budget` 的基线路径/`BASELINE_PATH` 是否也跟着错位）；
`circularDeps` 这侧的域过滤会不会让**既有基线**（0）在 CI 上改变结论；
"消费者套件整份真的跑了"这条计数锁的可靠性与自我遮蔽风险（嵌套 `node --test`、`NODE_TEST_*` 继承）。

**前端/可维护性轴**：命名与术语是否统一（`domain` / `set` / 受管 / 域）、`git-domain.js` 的 API 形状
（`(rootDir, opts)`）会不会让下一个调用者误用；`check-debt-budget.js` 里 `filesOver500Paths` 等新字段
是否会误导 `--update` 写出的基线文件；CI 接线位置（`changes` job）是否恰当、是否有更该放的位置；
两处 docblock 与留痕输出是否会让读者对"域""相对 root""机器态能改域"产生误解。

## 硬约束

- **严格只读**：不得修改、创建、删除被审工作树里的任何文件，不得跑任何写型命令（`git add`/`commit`/`checkout`/
  `stash`/`--update` 一律禁止；`node --test` 与只读的 `node scripts/...` 检查模式可以跑）。
- 结论必须**同时**写进 stdout **和**文件 `.ccg/reviews/debt-budget-git-domain-review-<axis>.md`（axis 由任务书末尾给出），
  每条形如：`severity | 文件:行 | 主张 | 你跑过什么命令得到什么读数 | 建议`。
- 没有跑过的命令不要写成"实测"；区分 Critical / Warning / Info，并给出 VERDICT: PASS 或 NEEDS_REVISION。
