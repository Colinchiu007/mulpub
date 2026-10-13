---
task: hook-installer-test
title: 钩子安装器回归锁并接进 Gate 2d
status: completed
date: 2026-10-12
---

# 钩子安装器回归锁（hook-installer-test）

## 1. 做了什么

新增 `scripts/install-git-hooks.test.ps1`（16 条断言）并把该文件接进 `.github/workflows/quality-gate.yml` 的 **Gate 2d**（`shell: bash`，一个 run 块多条命令时的 fail-fast 前提成立）。

不改 `scripts/install-git-hooks.ps1` 本体——实测它工作正常，本 PR 补的是**它自己没有人看着**这件事。

## 2. 为什么是它（缺口的现场证据）

| 事实 | 取证 |
| --- | --- |
| 安装器是钩子真源进入生效位置的唯一环节 | `scripts/install-git-hooks.ps1:30-39`（`scripts/hooks/*` → `$GIT_COMMON_DIR/hooks`，跳过 `*.test.*`） |
| 它由会话入口自动调用，不是靠人记得 | `scripts/start-mp-task.ps1:69-71`（健康检查 → 装 → 带 `-RequireHooks` 再检查） |
| 它自己没有任何测试 | `git ls-files \| grep install-git-hooks` 仅命中脚本本身 |
| CI 从不运行它 | 接线前 `.github/workflows/` 内 0 命中；CI 的 checkout 不需要钩子，这本身合理 |
| 失效后果是静默的 | 分支守卫（`expected-branch` 断言）与 `.ccg/reviews` 判定记录自动入库（#3396）都在这个钩子里；它一旦被装坏，没有任何 required check 会红 |

同日排查到的现场：22 小时内 10+ 个任务在共享根与 36 个 worktree 堆积 300+ 未跟踪判定记录，按文件名反查「已在 origin/main = 0」，因为钩子产物以**提交前 HEAD** 命名而 squash 会换 SHA —— 自动入库那一条正是靠本 PR 锁住的安装器装出来的。

## 3. 六条判据（各测一件事）

1. 逐名安装到**绝对**公共目录，且已装字节逐字节等于真源（先删目标，杜绝"本来就在"的假绿）。
2. `*.test.*` 必须跳过 —— 否则测试夹具本身会被当成活钩子装进 `.git/hooks`。
3. 目标为**只读**陈旧钩子时必须被真源覆盖（`-Force` 是承重的）。
4. `scripts/hooks` 缺失必须非零退出，且一个文件都不装（不得把"没找到源"报成成功）。
5. 第三方尾部追加块经重装必须消失 —— `mp-worktree-health.ps1` 刻意容忍追加，重装是唯一收口。
6. 从仓库子目录运行仍装到绝对公共目录，且不得在 cwd 下造 `.git/hooks`。

## 4. 证据

- 两档 shell 全绿：`pwsh 7` 16/16，`Windows PowerShell 5.1` 16/16。
- 变异反证三条，各自**指名**变红：
  - M1 循环体 no-op（过滤器永不命中）⇒ case1/2/3/5 红；
  - M2 去掉 `-Force` ⇒ **只有 case3 红**（证明它单独守这一件事）；
  - M3 `$dst` 改成相对当前目录 ⇒ case1/2/3/5 红。
  每条变异都先断言"变异真的落进了文件"，还原后复跑 16/16，且 `scripts/install-git-hooks.ps1` 与 HEAD 逐字节一致。
- `node scripts/check-unwired-tests.js`：检查域 75 个测试文件，OK（全部已接线或按欠账登记）。
- `node --test .github/scripts/workflow-contract.test.js`：35 passed / 0 failed。
- 红先查跑法：首次跑 `workflow-contract.test.js` 报 `pass 0 / fail 1`，根因是 `-NoDeps` 建的工作区没有 `node_modules`（`Cannot find module 'js-yaml'`）⇒ **LOADFAIL，不是改动引入的回归**；装依赖后 35/0。

## 5. 自造判据缺陷两条（比锁本身更值得留）

| 编号 | 现象 | 根因 | 处置 |
| --- | --- | --- | --- |
| 假阳 | case6 断言 `<sub>/hooks/pre-commit` 不存在 | `<repo>/scripts/hooks` 就是源目录，该路径**必然存在** ⇒ 断言恒假、锁不覆盖任何东西 | 改断言 `<sub>/.git/hooks/pre-commit`（相对解析的真实落点） |
| 假绿 | case3 用普通可写陈旧钩子，M2（去掉 `-Force`）照旧全绿 | `Copy-Item` 对普通已存在文件本就会覆盖，`-Force` 只在只读/隐藏目标上承重 ⇒ 夹具形态与被测语义不同形 | 夹具改为**只读**并加一条"变异前必须确实只读"的自证断言 |

共同教训：**夹具若对所有输入表现相同，那一类缺陷对它结构性免疫**；判"锁是否有效"只能靠变异，不能靠阅读。

## 6. 故意不做

- **不设 `core.hooksPath`**。相对 hooksPath 按各 worktree 顶层解析 ⇒ 39 个 worktree 各自执行"它检出分支里的那份钩子"（守门版本随分支漂移）；且 `scripts/mp-worktree-health.ps1:63-64` 比对的是 `<common>/hooks`，一改就让它比的不再是实际生效那份 —— 把承重判据改成装饰性。
- 不改安装器本体、不改钩子内容（无缺陷可修），不扩到 CI 装钩子（CI 不需要）。

## 远程同步

| 远程同步 | PASS | 已合并：PR #3426，merge cf6a8f76d867f1f49c6945d2b63009ebf12e0c34（2026-10-12，squash）。取证：`git log origin/main --grep "(#3426)$" --format=%H|%cI`；本次回填同一次提交删除 ledger 登记项，并在带 frontmatter 的记录文件里删 sync_ 字段 |
