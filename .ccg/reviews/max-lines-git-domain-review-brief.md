# QM-6 外部评审任务书（change: max-lines-git-domain）

**你的工作目录就是仓库根。** 本文所有路径一律相对仓库根写（不存在也不该有本机绝对路径 —— 受管文档不得新增机器绝对路径，本仓 Gate 12c 会拦）。

## 被审对象（必须自己取证，不得凭本任务书转述）

- 被审提交：`1aecfedeb`（父提交 = `d643efce3` = 本次的 `origin/main`）
- 取 diff 的唯一正确姿势：`git show 1aecfedeb`（**不要**用 `git diff HEAD`，也不要读未跟踪文件当被审内容）
- 改动面：`.github/scripts/check-max-lines.js`（判据本体）+ `.github/scripts/check-max-lines.test.js`（回归锁与夹具）
- 该门禁的消费者：`.github/workflows/debt-guard.yml`（步骤「逐文件行数门禁」，`shell: bash`，同一个 `run:` 块里先跑门禁再跑它的 `node --test`）、`.github/workflows/quality-gate.yml`（提及处）

## 这次改动在修什么（一句话）

`#3782`（change `bundle-untrack`）把 5 个构建产物移出版本控制（`.gitignore` 点名 `apps/desktop/electron/preload/index.bundle.js` 与 `apps/desktop/electron/home-shell-preload.bundle.js` 等），但这条门禁的扫描域是「磁盘全量」(`fs.readdirSync`)，于是本机构建过一次就报 `NEW_OVER_LIMIT` 假红，而 CI 的检出里没有这些文件 ⇒ 本机与 CI 量的不是同一棵树。改法是把「该不该被量」交给 git：**域 = git 索引内文件 ∪ 未被 .gitignore 排除的未跟踪文件**；取不到 git 读数一律退出码 2 出声。

## 两条轴的分工（各审各的，不要互相复述）

**后端/逻辑轴**只回答这四问：
1. `gitDomain` 的集合定义在哪些真实情形下会给出**错**的答案？逐个给「可达性」判断（这个输入在本仓 / CI / 本机真的会出现吗），特别核三格：被跟踪但同时命中 .gitignore 的文件（历史上 `git add -f` 过的产物）、索引里有但磁盘已删的文件、`--root` 指到仓库子目录时 `git ls-files` 的输出坐标系（相对 cwd 还是相对仓库根？判据要的是**相对扫描根**）。
2. 退出码档位：1=发现违规、2=判据自身故障。`debt-guard.yml` 那一步在 `shell: bash`（默认 `-e -o pipefail`）下 rc=2 会让步骤红。请判断「git 不可用 ⇒ 所有人都合不了 PR」这个失效面是否可接受、有无更好的分档；以及 `set.size === 0` 抛错会不会误伤合法的极端仓库（空仓库、浅克隆、只读检出、CI 的 detached HEAD）。
3. 规模与预算：`maxBuffer: 64 * 1024 * 1024` 对 `ls-files -z --others --exclude-standard` 在本仓够不够？域现在覆盖全仓约 1 万条而扫描只用得上 `SCAN_DIRS` 那部分 —— 有没有「把取域限定到 SCAN_DIRS 而**不改变判定结果**」的做法，这么做会不会重新把忽略项放回来（注意 `--exclude-standard` 这一旗标已被实测为承重）。
4. 七条新锁里有没有**恒真**或**测不到它声称变量**的（尤其「域必须等于 git status 口径」那条：探针与实现是否真独立、比较的是否同一坐标系、`-z` 解析会不会把 `R ` / `A ` 之类记录误吞）；六道变异（M1 摘域过滤 / M2 丢 others / M3 静默空域 / M4 摘空集合守卫 / M5 丢 `--exclude-standard` / M6 留痕不分 `--json`）有没有哪一道其实证不出它声称守的那一格。

**前端/可维护性轴**只回答这三问：
1. 同一条「域」的判据现在有几份实现？`scripts/check-debt-budget.js` 也在用 `readdirSync` 走磁盘（实测本机带产物时它报 `filesOver500: 97`，而 CI 侧是 95、基线 101 —— 只是靠 4 格余量没红）。请判断「本片只修一个、另一个登记遗留」是否可接受，还是必须现在就收敛成单一实现；若必须收敛，给出**不扩大本片风险**的做法。
2. 三条既有夹具改成真实 git 工作树（`gitify`）这件事，有没有把「测试跑得绿」变成依赖机器态（全局 git 配置、`git init` 模板、符号链接/junction、Windows 长路径）的风险？夹具里那份空 gitconfig 落在被测目录**之外**是否必要且充分（为什么必须在外，实测理由在测试文件的注释里）。
3. 命名与措辞：`gitDomain` / `domain` / 「受管」「域」「口径」混用会不会让下一个读这段判据的人误解它守的是什么？给出具体改名或注释建议（行号必须来自 `git show 1aecfedeb` 的产物，不要引你猜的位置）。

## 硬约束（违反即结论无效）

- **只读**：禁止任何写型验证（不改文件、不跑变异、不执行 `git add` / `commit` / `checkout` / `stash`）。
- **唯一可写文件**：`.ccg/reviews/max-lines-git-domain-review-<axis>.md`，`<axis>` 用你在任务里被指定的那一轴名（`backend` 或 `frontend`）。除此之外不得创建/修改任何文件。
- 每条发现必须给 `文件:行号` + 一句「为什么这个输入可达」；不成立或拿不准的写「不确定 + 缺什么证据」，**不要**编造仓库现状。
- 结论必须**同时**写进上面那个文件**并**完整打印到 stdout（回收判据 = 「文件落盘 或 stdout 有完整正文」二者取一）。
- 输出上限：每条 ≤4 行，总长 ≤80 行；先给 `VERDICT: PASS|NEEDS_REVISION`，再按 Critical / Warning / Info 分组。
- 不要复述代码，不要总结「这个 PR 做了什么」—— 只报**问题**与**你核过的证据位置**。
