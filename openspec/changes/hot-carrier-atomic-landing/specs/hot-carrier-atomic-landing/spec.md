# hot-carrier-atomic-landing

## Purpose

规定「全仓会话共用的追加型写面」（热点载体）在共享主工作区里的写入窗口应当被谁、在哪一层、以什么证据收掉。目标是让「回填链在别人的 HEAD 底下攒未提交的热点改动」这一形态从**声明性禁止**变为**可判定且默认变红**，同时不把每次回填的成本推高到让人攒着不做。命名约束：本能力一律称「一条命令收口」，不得使用「原子落盘」——该词在本仓已被 tmp+rename 语义占用（实测 `openspec/changes/ai-taste-ops-center/design.md:62`、`film-auto-mode/specs/film-engineering/spec.md:188`、`podcast-rss-channel/design.md:21`、`podcast-rss-channel/tasks.md:22` 四处）。

## ADDED Requirements

### Requirement: 热点载体清单必须有单一来源，且必须是 docs-only 白名单的子集

系统 SHALL 以 `scripts/hot-carrier-paths.json` 作为热点载体的唯一清单（一行一路径，入库），任何脚本、钩子或文档 SHALL NOT 另行维护第二份清单。对清单的每一项，测试 MUST 用 `scripts/classify-docs-only.js` **导出的** `matchesPattern` 断言其命中 `CI_IGNORED_PATHS`；MUST NOT 用字符串相等或自行实现的 glob 匹配。

#### Scenario: 出现第二份清单

- **WHEN** 仓内出现消费热点载体路径但不引用 `scripts/hot-carrier-paths.json` 的实现（按语义特征判定，不按是否读过该 JSON 文件名判定）
- **THEN** 静态门禁必须变红并点名该实现；本仓把「同一个判据被抄成三份」记为反复复发的缺陷族，禁止以「暂时先这样」放行

#### Scenario: 清单项不在 docs-only 白名单内

- **WHEN** 某项热点载体经 `matchesPattern` 判定不落在 `CI_IGNORED_PATHS` 内
- **THEN** 测试必须变红，理由是该项承载运行面、应按「文档夹带代码」走 worktree 与完整门禁，而不是由本机制兜底

#### Scenario: 按 PR 独立成文件的记录不参与

- **WHEN** 评估 `openspec/records/*.md` 或 `.ccg/reviews/*.json` 是否应进清单
- **THEN** 一律不进：它们按 PR / 按 SHA 独立成文件，没有并发写面；把它们列进热点反而会把会话推回巨型单文件，与本仓「记录按 PR 一篇」的既有方向相反

### Requirement: 未提交窗口的行为判据只能落在本地层（守卫 / 工具 / 钩子三档），CI 只许锁「判据源在位」

共享主工作区是否存在跨会话脏改动属机器态，CI runner 上不存在该状态。因此行为判据 SHALL 全部落在**本地层**，且按「谁守得住哪种形态」分三档：常驻守卫 `scripts/guard-shared-root-writes.ps1` 量窗口（见下一条 Requirement）、`scripts/docs-land.ps1` 在真正会丢工的那一步（`reset --keep`）之前拦、`scripts/hooks/pre-commit`（权威源入库、由 `scripts/install-git-hooks.ps1` 同步到共享 `.git/hooks/`）只拦「把他人脏混进本次提交」。CI 侧 SHALL NOT 出现「假装检测了机器态」的判据，只允许校验判据源文件仍在位。

#### Scenario: 提交命中热点且工作树有别人的改动

- **WHEN** 提交内容命中热点载体清单、当前工作区是共享主工作区（`git rev-parse --git-dir` 等于 `--git-common-dir`）、且 `git status --porcelain=v1 --untracked-files=no` 存在既不在本次提交内、也不在本会话声明的待落路径清单（`.agent_context/pending-landings`）里的路径
- **THEN** 钩子必须拒绝，点名那些路径，并给出两条出路（改用 `scripts/docs-land.ps1` 一条命令收口，或改在独立 worktree 准备）；未跟踪文件 MUST NOT 参与判定（它们是被 Write Guard 放行直接落盘的设计内常态，一并拒绝会让判据天天误红直至被人绕过）

#### Scenario: 同一会话的第二刀不得被误拒

- **WHEN** 脏路径已被本会话写进 `.agent_context/pending-landings`（该文件 gitignored 且按 worktree 独立）
- **THEN** 钩子必须放行，并打印放行依据（形如 `allowed-by-pending-landings: <路径>`）——只放行不留痕，下一个读日志的人分不清「判据没跑」与「判据跑了但被豁免」

#### Scenario: 声明过期后不再构成旁路

- **WHEN** `.agent_context/pending-landings` 的条目写入时间超过上限（`MP_PENDING_LANDINGS_MAX_AGE_MINUTES`，非法值 MUST 回落默认并出声告警）
- **THEN** 该条目 MUST NOT 再豁免任何路径；判据不得存在「永久旁路」形态

#### Scenario: 结构锁不得冒充行为锁

- **WHEN** 实现 PR 只加了一条「钩子源码里出现了这段判据」的结构断言
- **THEN** 审查必须打回：该断言在判据被改成 no-op 时照样绿。MUST 另有一条在**本机临时仓库**里造出两个会话脏状态、见证真实拒绝的行为用例，且该用例 MUST 由 `git clone` 建立工作树（不得 `git init`+`git add` 现场造仓库——既有实测表明那种夹具量的是 git 的换行启发式而非守卫本身）

#### Scenario: 判据源文件被摘掉

- **WHEN** `scripts/hot-carrier-paths.json` 缺失、为空，或钩子里那段判据的语义特征消失
- **THEN** CI 必须变红；「清单为空」与「什么都没扫」两种状态必须可区分，不得都读起来像通过

### Requirement: 窗口的测量必须落在常驻守卫，pre-commit 只许守形状 B 并如实声明

「未提交窗口」是**一段时间内工作树的状态**，而 `pre-commit` 只在某一次提交的瞬间被调用。因此行为判据的主 SHALL 是常驻装置：`scripts/guard-shared-root-writes.ps1` MUST 记录热点载体的**开窗 / 收窗**事件并写出时长，超过上限（`MP_HOT_CARRIER_WINDOW_MAX_MINUTES`，非法值回落默认并出声告警）MUST 出声并写入既有 `violations.jsonl`；该判据 SHALL NOT 拦截（拦截等于惩罚无辜方，把别人的窗口变成我的提交失败）。钩子那道判据 MUST 在规范与输出里**同时写明它只覆盖形状 B**（把他人脏混进本次提交），不覆盖形状 A（攒着不提交）。

#### Scenario: 窗口开着而没有任何提交发生

- **WHEN** 共享根工作树存在热点载体的未提交已跟踪改动且持续超过上限，期间无人提交
- **THEN** 常驻守卫必须留下一条带时间戳与时长的记录；不得因为「pre-commit 没被调用」就得出「没有窗口」——这类把「探针没响」读成「事没发生」的判据是本仓反复复发的缺陷形状

#### Scenario: 漏事件必须被回看

- **WHEN** `FileSystemWatcher` 因缓冲区溢出丢弃了事件（该守卫已有处理此情形的启动对账路径）
- **THEN** 开窗/收窗状态 MUST 经同一条对账路径校正；MUST NOT 出现「窗口一直开着但记录说它已收」的读数

#### Scenario: 钩子判据被表述成已覆盖窗口

- **WHEN** 文档或钩子输出把 pre-commit 那条窄判据描述成「已能检测跨会话脏窗口」
- **THEN** 审查必须打回：形状 A 不在其调用链上，表述必须带这条边界

### Requirement: 一条命令收口必须以产物取证，且产物断言不得可被陈旧 ref 满足

`scripts/docs-land.ps1` SHALL 覆盖「`git fetch origin main` → stage 命名路径 → commit → 建分支保住提交 → `git reset --keep origin/main` → push → 开 PR」这条今天全靠手工的动线，SHALL NOT 接受 `-A` 或 `-u` 之类的批量 stage（会收走他人留下的改动，本仓实测发生过）。其成败判定 SHALL 一律取产物，SHALL NOT 取退出码或管道末段输出。

#### Scenario: push 被远端拒绝

- **WHEN** `git push` 失败但命令的退出码被管道吃掉
- **THEN** 工具必须以「本地分支 SHA 是否等于 `git ls-remote --heads origin <branch>` 返回的 SHA」判定，不得报成成功；随后 `reset --keep` 与开 PR 一律不得执行

#### Scenario: 复位目标必须是刚取到的 origin/main

- **WHEN** 工具即将执行 `git reset --keep origin/main`
- **THEN** `git fetch origin main` MUST 已在其之前成功完成；fetch 失败即中止，不得用陈旧 ref 复位——那会把主干已合并的回填重新摊成一份待推的本地脏，正是本能力要消灭的形态

#### Scenario: 收口完成后共享根必须回到基线

- **WHEN** 工具跑完
- **THEN** MUST 断言三件产物：共享根 `git status --porcelain=v1 --untracked-files=no` 为空、`HEAD` 等于**本次 fetch 后**从 `git ls-remote origin main` 取到的 SHA、`gh pr view --json number` 可查到号；缺一即判失败。MUST NOT 写成「`HEAD` 等于本地 `origin/main`」——`reset --keep origin/main` 之后那条断言在陈旧 ref 上必然成立，是一句空转断言

#### Scenario: 窗口时长必须可观察

- **WHEN** 工具执行
- **THEN** MUST 打印从进入 stage 到 PR 号到手实测的毫秒数与本次声明的路径清单。缺这条留痕，「窗口被压进一条命令内」就是不可复现的宣称，与「量过一次之后没人再量」同型

### Requirement: 误拒只能靠核对清单收窄来消化，不得放宽判据

若判据上线后出现高频误拒，处置顺序 SHALL 为：先确认被拒的那条路径是否真属「全仓共用的追加写面」，再决定清单是否收得过宽。SHALL NOT 以放宽判据、加 `skip`/早退、把文件摘出清单而不给理由、或登记成欠账的方式让它不红——那等于拆掉锁还留一盏绿灯。

#### Scenario: 每次跑必须说明走了哪条支路

- **WHEN** 钩子或工具执行判定
- **THEN** MUST 打印本次实测到的关键值（当前是否共享主工作区、命中清单的项、清单外的脏路径数），否则下一个会话无法知道它到底测了什么

### Requirement: 「干净」这把尺子全仓只能有一串字面量，且由 parity 锁守住

钩子（bash）与 `scripts/mp-worktree-health.ps1`（PowerShell）跨语言，无法共享函数实现——本仓对 CJS/ESM 孪生实现的处理方式是「不合并实现，但用 parity 断言钉住判定面」，本处沿用同一口径：两侧出现的 `git status` 命令串 SHALL 逐字相同（含 `--untracked-files=no`）。SHALL NOT 以注释声明「与某某同口径」代替锁——注释不会变红。

#### Scenario: 只改一侧

- **WHEN** 任一侧把该命令串改掉（例如摘掉 `--untracked-files=no` 或降级为 `--porcelain`）
- **THEN** parity 锁必须变红并点名两侧文件

### Requirement: 热点写面消失时，本机制必须一并退场

本能力是 `openspec/changes/enforce-gate-record-presence` 落地前的**过渡机制**。当 `scripts/hot-carrier-paths.json` 的清单为空（即聚合热点文件不再是写入面）时，系统 SHALL 在同一次归档中删除 `scripts/docs-land.ps1`、`scripts/hooks/pre-commit` 内的那段判据与清单文件本身。SHALL NOT 保留一条恒不命中的死判据——本仓已有同型禁令（不得为不存在的反馈路径保留死键）。

#### Scenario: 判据本体在当前真实仓就红得起来

- **WHEN** 清单**非空**而 `scripts/docs-land.ps1` 或钩子那段判据缺失
- **THEN** 同一条测试必须变红。退场判据 MUST 写成「非空 ⇒ 实现存在」与「为空 ⇒ 实现不存在」两半，且两半各自可被求值——只写后一半的断言在整个存续期内不会被求值到，读起来有牙实际恒绿

#### Scenario: 清空清单必须让退场判据指名变红

- **WHEN** 在临时 clone 里把 `scripts/hot-carrier-paths.json` 改成空数组（作为对判据本体的变异，不改判据源码）
- **THEN** 退场那条用例必须**指名**变红；还原后按字节核对与改前一致。未做过这次变异的退场断言 MUST NOT 被登记为「已建立回归保护」

#### Scenario: 保留恒不命中的死判据

- **WHEN** 清单为空但 `docs-land.ps1` 与钩子判据仍在
- **THEN** 测试必须变红，并指出退场动作未完成
