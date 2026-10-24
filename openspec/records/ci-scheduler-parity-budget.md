# 执行记录：parity python 子进程的可归因预算档（ci-scheduler-parity-budget）

- 分支：`ci-scheduler-parity-budget`
- 日期：2026-10-25
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（commit 后跑）→ **docs-only=false**
  （改 `scripts/compare-scheduler-models.js` 本体），走完整质量节拍 + 独立分支 + PR。
- **隔离口径的显式偏离（必须写清，不许悄悄破例）**：本片**没有**用 `scripts/start-mp-task.ps1` 新建 worktree。
  原因是 D 盘剩 76 MB，而建一个 worktree 实测吃约 720 MB（今天量过：806 MB → 84 MB）。
  本片改在**已合并 PR #4210 的空闲 worktree 目录**（`<mp-worktrees 根>/mp-ux-audit-locale-pair-gate`，
  进入前 `git --no-optional-locks status --porcelain` 读数 0）里 `git checkout -b ci-scheduler-parity-budget origin/main`，
  起点就是 origin/main tip `f10847fae`，与主干零差异。
  为什么这仍满足该规则的**目的**（并发会话互不踩）：独占目录 + 独占分支 + 该目录不属于任何在飞 PR；
  代价是目录名与分支名不对齐，读 `git worktree list` 的人会多看一眼——这一条就是留给他的说明。
  ⛔ 未做的两件事：没删任何东西、没在共享仓库根落盘。

## 1. 门禁表

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| 变更类型与隔离 | ⚠ 见上 | 空闲 worktree 内开专用分支，起点 `f10847fae`；偏离已声明 |
| TDD 红证 | ✅ | 实现前 `node --test scripts/compare-scheduler-models.test.js` → **pass 44 / fail 6**（6 条即本片新增） |
| TDD 绿证 | ✅ | 实现后 → **pass 50 / fail 0**（含既有 44 条未被碰坏） |
| 真实接缝穿过 | ✅ | 本机真跑一次 `runParity(1500)`：**6 例全 ok**，打回 6 行 `[parity-timing]`，样本 `ms=400,85,82,84,80,91`（不是只用注入夹具） |
| 反证电池 | ✅ | 七道行锚定变异 **CAUGHT=7/7，anchored=7/7**，还原后 `md5` 与变异前一致（逐条见 §4） |
| 规模档（QM-6） | ✅ 可自闭合 | `ccg-review-decider.js` 暂存档读数 **SINGLE（199 行 ≤ 200，无敏感命中）**；过程中曾判 DUAL(230/214)，靠**压缩注释与合并用例**降下来，没有删断言、没有加 skip、没有改判据 |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/` |
| QM-4 视觉 | N/A | 无 UI 改动 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（ins=176 del=13 同读数） |
| CJK / locale | ✅ | 无新增用户可见文案 ⇒ 不新增 locale 键 |
| 品牌残留 | ✅ | 未提及任何参考产品名 |
| 台账 | ✅ 按新规 | 条目在本文件 §6，本 PR 不编辑 `CHANGELOG.md` |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 推导收口，不手写状态词 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅（本记录同 PR）| 远程同步 PR #（创建后回填编号）

## 2. 缺陷本体：一次主干红，说出的是一句无法归因的话

- 现场：main push run `40108163214`（tip `1a9271da`）job `120914784945` 的 `QG Desktop Shards (1/2)` 红，
  唯一失败项 `electron/tests/test_scheduler_parity.test.js > 六组固定输入关键指标一致`，原文
  `python simulator failed: cmd=python status=null signal=SIGTERM timeout=30000ms cause=ETIMEDOUT … stderr=(空)`。
- 为什么它挡住全部合并：`check-main-red.js` 在主干红时对所有 PR 判 rc=2（不得往红主干上合）。
- 抖动频率实测（今天 12 次 main push 逐 run 读 jobs）：`S1-2` 红 1/12、`S2-2` 红 1/12（后者是
  `title-card-renderer` 的 Fontconfig/短名路径，另案登记为任务 #31）⇒ **平均每 6 次 run 挡一次路**。
- 旧代码的真实缺口不是"预算太小"，而是**没有任何可归因证据**：
  ① 一次都没记过 python 的实际耗时（所以"30s 够不够"永远是嘴仗）；
  ② `ETIMEDOUT` 一档把"解释器启动被饿死"（该重跑）与"模拟器跑不完"（该修代码）合成同一句话，
     而这两种处置完全相反。
- 本机一次真跑给出的量级：6 例 python 实际 `80–400ms`，预算 30000ms ⇒ **裕度约 75 倍**。
  这既解释了为什么允许对环境档重试一次（真工作只要 0.1s 量级），也解释了为什么
  ⛔ 本片**没有**动 30000 这个数：调预算需要 runner 侧分布，而 runner 分布正是本片开始采的东西。

## 3. 修法（三件互相咬合的事，缺一件就还是原样）

1. **`[parity-timing]` 逐次打点 + 台账**：每次真实 spawn 记
   `{case, ms, attempts, ok, envTimeout, budgetMs}`，并打一行
   `[parity-timing] case=<名> python_ms=<n> budget_ms=<预算> attempts=<第几次> status=ok|timeout|fail`。
   注入的 `spawnImpl` **一律不进台账**——假样本会让"预算是否贴脸"的活体检查退化成恒真。
2. **只对环境档重试一次**：判据 `isEnvTimeout = status === null && signal`。
   `ENOENT`（signal 为 null）与真崩（status 非 null）天然落不进来，当场抛——
   给它们重试等于把"python 没装"读成"再试一次也许就好了"。上限可经
   `MP_PARITY_PYTHON_ATTEMPTS` 覆盖，非法值（`0`/非整数/NaN）回落默认并出声。
3. **失败时补一次解释器探针**（`python -c "import sys;print(1)"`，独立预算 8000ms，只在失败路径上跑）：
   - 探针也不回来 ⇒ 文案说"解释器启动被饿死，属 runner 负载/抖动，重跑即可归因"；
   - 探针 `PROBE_OK` ⇒ 文案说"解释器 Nms 就能拉起而模拟器跑不完 ⇒ 不是负载，是真缺陷"。
   两档文案必须互不相同（既有"三档文案互不相同"那条锁继续守这里）。
4. **预算旁边必须有可重跑的出处**：`PARITY_PYTHON_TIMEOUT_PROVENANCE`
   （`localMaxMs=400 / localSamples=6 / localRuns=1 / collectedAt / recheckCmd / marginMultiplier=20`），
   并被断言钉住「预算 ≥ 实测 max × 裕度倍数」。域的措辞如实：这是**本机**样本，runner 侧分布由
   上线后那 6 行自己采——不冒充"runner 已量过"。

### 顺带修掉的一处锁的脆性（不是为本片服务）

既有反向锁写的是 `function pythonSimulate[\s\S]{0,1400}throw … formatSpawnFailure(`——
那个 1400 是**无实测依据的手写窗口**，于是"在函数里加一段重试循环"这种与语义无关的成长会把锚点整条剪断
（本片第一次跑到它就红了，红的是锚不是缺陷）。改成语法边界取域：按 `/\r?\n\}\r?\n/` 切出
`pythonSimulate` 函数体（按工作区真实行尾匹配），再在体内断言，并加两条反失明正控
（函数体长度 > 400、体内必须真有那次 `spawn('python'`），否则"匹配不到"分不清是没接线还是切片坏。

## 4. 反证电池（七道，逐条取被禁形态本身）

| # | 变异 | 预期变红 | 现场 |
| --- | --- | --- | --- |
| B1 | 重试条件改成恒假（摘掉重试） | 只有环境档才重试 / 第一次超时第二次成功 | CAUGHT red=3 |
| B2 | 去掉 `envTimeout` 门（什么档都重试） | 只有环境档才重试（ENOENT/真崩段） | CAUGHT red=2 |
| B3 | 台账不再区分注入后端（假样本进账） | 第一次超时…不进台账 | CAUGHT red=2 |
| B4 | 摘掉探针（恒不执行） | 按探针结果分档说成因 | CAUGHT red=2 |
| B5 | 把出处改成 `max=1 × 倍数=1`（洗掉裕度证据） | python 预算必须带实测出处 | CAUGHT red=2 |
| B6 | 摘掉 `[parity-timing]` 打点行 | 每次真实调用都打一行 | CAUGHT red=2 |
| B7 | 去掉重试上限的合法性校验 | 重试上限可被 env 覆盖 | CAUGHT red=2 |

B4 第一版曾把"摘掉探针"写成整段替换，导致测试文件以语法错整体崩掉（红是文件级、不归属任何用例）——
那一次 MISSED 是**变异本身坏**，不是锁没牙；改成单行恒假后 B4 独立变红在用例名上。教训同前：
MISSED 先分"锁没测"与"探针没跑成"，别急着给锁加新用例。

## 5. 遗留与如实边界

- 本片**不保证**主干从此不红：如果 runner 上真实形态是"解释器两次都起不来"，重试一次仍会失败——
  但那时文案会明说"连探针都没回来"，处置从"考古定责"变成"重跑/查 runner"，这正是本片要买的东西。
- runner 侧 python 时长分布要等本片上线后的 `[parity-timing]` 行累积；够 20 例再谈调 30000 这个数。
- 另案未做：`title-card-renderer` 的 Fontconfig/短名失败（任务 #31）、`test_scheduler_parity`
  自身 46s 用例不受 `testTimeout` 约束的机制（任务 #32 内已记）。

## 6. CHANGELOG 条目

# 主干红可归因：parity 的 python 子进程现在自带时长打点、环境档重试与解释器探针

`scripts/compare-scheduler-models.js` 的 `pythonSimulate` 补三件事：
每次真实 spawn 打一行 `[parity-timing] python_ms=… budget_ms=… attempts=…` 并记入台账
（注入的测试后端不进台账，避免假样本把"预算贴脸"检查变成恒真）；只在"被 timeout 杀掉"这一档
（`status=null` 且有 `signal`）按同一预算重试一次，`ENOENT` 与 python 真崩一律当场抛；
最终仍失败时补一次零依赖探针，把文案分成「连解释器都起不来 ⇒ runner 负载，重跑归因」与
「PROBE_OK 而模拟器跑不完 ⇒ 不是负载，是真缺陷」两种相反处置。
预算 30000ms 本片一字未动，旁边新增强制出处 `PARITY_PYTHON_TIMEOUT_PROVENANCE`
（本机 6 例 max=400ms、复测命令、裕度倍数 20），改预算必须先重跑复测并同次改出处。
测试 50 passed（红证 44/6 → 绿），七道变异 CAUGHT=7/7。既有反向锁里那个无依据的 1400 字符窗口
一并改成按函数边界取域（"在函数里加一段代码"不该把锚点剪断）。

## 7. 收尾

合并后收口由 `merge-ledger` 推导；回读本次合并触发的 main push（`quality-gate.yml`）必须 success，
红了按本轮口径补 follow-up PR。本片完成后把该 worktree 切回 `ux-audit-locale-pair-gate` 分支。
