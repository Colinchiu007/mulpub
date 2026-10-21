# Tasks — debt-recheck-zero-measurement-fail

> 判据一律取产物，不取 rc；每条"已实测"后面必须跟当场读数，活数不许写成常数。

## 1. QM-5 第 1 步：第一性原因取证

- [x] 1.1 取 run `39563222046` / job `119099176198` 的步骤结论与 `[recheck]` 原文 **→ 落点**。读数：step `重算 open PR 并点名陈旧结论` conclusion=**success**；`rows=30 IN_BASELINE=0 VIOLATES=0 UNJUDGEABLE=30 CHECKER_FAILED=0 base=c074b91b62`；逐条 **15 × `verdict=UNJUDGEABLE/worktree-setup` + 15 × `verdict=UNJUDGEABLE/conflict`**（按 PR 去重计数，两条各 15）；作业本体 07:39:40.2→07:39:53.4 ⇒ **13.3 秒**，单条 242–296 ms；全日志 grep 不到任何 git stderr 原文
- [x] 1.2 逃逸分析：**切片 C 的 25 条锁当时全绿**。逐档答"为什么抓不到"——① 退出码只看 `TOOL_FAULT_REASONS`，而 `worktree-setup` 在词表里、不在名单里（名单两抄漏一档，且没有任何东西对账这两份）；② 25 条把 `classify/commitTree/worktreeAdd/runChecker` **全部注入替身**，默认闭包（真 git 那条路）一次都没被跑到 ⇒ CI 上的失败形态对测试面结构性不可见；③ 断言里出现的 `MEASURED` 语义不存在，"一条都没量"与"量了且都合规"在输出上同形
- [x] 1.3 系统性漏洞定位（两类，都指名到行为）：**「第二份真源」**——`UNJUDGEABLE_REASONS`(5) 与 `TOOL_FAULT_REASONS`(3) 各写一遍，无对账判据；**「零覆盖的生产装配面」**——`live()` 的默认 seam 在 CI 是唯一被执行过的那条路，而测试面 0 条用例经过它（本轮加 §27/§29 各一条）
- [x] 1.4 根因状态如实记为**未证实**，候选与排除依据写进 design「残余」+ D9：① runner 缺 committer 身份（现有夹具显式 `git config` ⇒ 测试证不了这一格）；② `worktree add` 在 CI 检出形态被拒；③ 其它。本机实测**默认链能跑通**（单笔含建临时仓 11.5 秒 ⇒ `IN_BASELINE`），因此"CI 上坏了"不能靠本机否证
- [x] 1.5 预防措施三件都有执行体：派生归类表 + 加载时 `assertReasonClass`（非法值即抛）；不依赖名单的计数不变式；生产默认装配锁。落点见 §3/§4/§5

## 2. 规格与评审

- [x] 2.1 proposal / design / specs / tasks 四件套 + i1/i3/i6 采纳后的 D1 映射表、D3 术语定义、D6 拆分、D7 环境卫生、D8 处置表、D9 跟进 **→ 落点**（design 九节 + spec 三条 Requirement / 十个 Scenario）
- [ ] 2.2 **设计阶段外部评审：单轴交付，缺轴已登记为欠账（不写成"双模型已覆盖"）**。critic=claude 经 `plan-review.sh --force` 真跑并交付 7 条（3 Critical/2 Warning/2 Info），逐条处置见 D8；proposer=opencode 那一轴被后端输入上限拒（方案 7871 字符 > 7800，exit 1、零错误信息）⇒ 未交付。两条工具缺陷（`deep-review.sh --force` 在验证层不生效且 rc=0；plan-review 的 slug 与 OpenSpec 固定文件名撞车）见 design「残余」，另起一刀
- [x] 2.3 设计评审 i5 **采纳并落码**：五格探针实测 `git -C` 挡不住 `GIT_DIR`（G1/G2/G3 读到 B，G4/G5 对照读到 A）⇒ `gitSafeEnv` 剔三键 + 每次调用取 env + 出声一次，行为锁含对照格（测试 §28）
- [x] 2.4 **实现层评审第 1 轮（判定 DUAL，critic=claude 真跑）交付 8 条**（2 Critical / 3 Warning / 3 Info），进入裁决的 5 条逐条给指控/辩护/裁决/可验证理由（产物 `.adversarial/ccg-deep-070cae15/adjudication.json`）：i1 **dismissed**（它要求把旗标袋 `deps.env` 当子进程 env，与 §28 的"其余 env 原样带着"正面冲突；它指的另一半——默认闭包丢 stderr——是真，落点在 `commitTree`/`worktreeAdd`，已修 + §29 + M-D9）；i2 **upheld 但不在本刀修**（评审链工具，登记为独立一刀）；i3 **dismissed、文档半采纳**（未归类默认算故障是刻意的不对称：只会更响不会更静）；i4 **upheld 并已改判据形态**（字节/行数下界 → 顶层声明集合，配 M-D14 反证）；i5 **upheld 且落码**（`-c` 自带身份 + 默认装配锁跑在"摘光身份"的现场 + 对照探针，见 design D9/D10）
- [x] 2.5 **第 2 轮盖章已在最终树上跑**（原文与读数见 design D10b 与 PR #4204 第二条评论）：第 1 轮的载荷是提交 `070cae15` 的差量，而 i4/i5 的改动在那之后落码 ⇒ 那一条复核**不能**给当前的树盖章。落码后重跑 `sh scripts/deep-review.sh`，把新一轮的交付与处置一并写进 PR 评论与本行；在那之前 `.ccg/reviews/<sha>.json` 的 `status` 只能停在非闭环值，**不得**靠改判据、写 `closureNote` 或删 `reviewBackends` 让它不红

## 3. 实现

- [x] 3.1 `REASON_CLASS` 一处真源，词表与故障档由它派生；`assertReasonClass` 在模块加载处校验（非法值当场抛，不进 CI 也就进不了主干）
- [x] 3.2 三个失败单位三个档名：`worktree-setup`(seam) / `merge-commit-failed`(commit-tree) / `merge-worktree-failed`(worktree-add)；`mergedTreeEvidence` 同步，两路档位同源由断言钉
- [x] 3.3 条目带 `stage` + `detail`（stderr 优先、stdout 兜底、截 200），逐条日志与评论表格都打出来；**默认闭包的 stderr 透传**一并补上（原先 `{rc, commitOid}` 丢掉 stderr ⇒ "可归因"只在注入面成立）
- [x] 3.4 `summarize()` 两条子句（故障行 ⇒ 非零；`rows>0 ∧ measured=0 ∧ ¬allConflict` ⇒ 非零）+ `measurementLine` 三形态留痕；`shouldComment` 同判据（半份结论不写评论）
- [x] 3.5 门闩/预算/状态复查/端点形状等切片 C 已交付的面**不回退**（34 条旧锁在全程每一步都跑过，拆文件后又跑一次）
- [x] 3.6 **拆分落地（本刀计划外、由 max-lines 逼出）**：本体 503 行撞 `limit=500`（该判据按 git 索引取域，`git add` 后才显形）⇒ 按依赖形态切 `lib/debt-recheck-core.js` / `lib/debt-recheck-live.js` / 入口门面，方向 core←live←cli 无循环；零行为改动两条证据：拆前拆后同一条命令全绿 + 四个抽取区间逐字节出现在新文件里（探针 `verbatim=true`）
- [x] 3.7 **连带修正**：读源码的结构锁扫描域 1→3 份。拆完第一跑「不得出现指标名」那条绿得毫无道理（入口只剩 41 行）⇒ 新增 `toolSources()` 并集扫 + 逐份字节下界 + 总行数下界

## 4. 回归锁（本轮新增 12 条：25 → 37）

- [x] 4.1 锁 A §21「零测量轮不得报成功」；4.2 锁 B §22「全 conflict 退 0 + `MEASURED=0(all-conflict)`，另含 rows=0 / MEASURED=1 两形态」；4.3 锁 A′ §23「计数不变式接住全 CHECKER_FAILED 与词表外新档」；4.4 锁 C §24「三档名互不相同且都属故障档」；4.5 锁 E §25「派生 + 非法值点名 + 加载处真调用」；4.6 锁 D+F §26「现场进日志与评论 + 两路档位同源」；4.7 锁 G §27 两条「不注入任何 seam 真跑到 IN_BASELINE / 判据桩 exit 1 ⇒ VIOLATES」；4.8 锁 I §28 两条「行为侧含对照格 / 告警侧含不虚报」；4.9 锁 H §29「默认 commitTree 透传 stderr」；4.10 §23b「混合轮：量到一笔 + 一笔失明 ⇒ 非零且不写评论」
- [x] 4.11 全量 `node --test scripts/check-debt-recheck.test.js`：**tests=37 pass=37 fail=0**（控制跑，驱动当场打印 `# tests/# pass/# fail` 三行）
- [ ] 4.12 如实记一条 TDD 偏差：§23b、§28、§29 三条是**判据先落、锁后补**（分别由 M-D3 第一轮 MISSED、评审 i5、实现时看见的默认闭包丢 stderr 逼出来）。可证性由对应变异提供（M-D3/M-D9/M-D11/M-D12 指名红），不写成"先见证红"

## 5. 变异反证

- [x] 5.1 **15 个变异全部实跑、全 CAUGHT、红集互不相同（按用例名集合不相等判）、`drift=0`**。这一张表是在**落码 i4/i5/§27 清理断言之后**的最终基线上重跑的（不是第 1 轮那张 12 行的表）。控制跑 `tests=39 pass=39 fail=0`；驱动每轮断言 `# tests` 等于控制跑读数，不等即记 UNREADABLE（既不算 CAUGHT 也不算 MISSED）。
  | 变异 | 取的是什么形态 | 指名红（条数：用例名首段） |
  |---|---|---|
  | M-D1 | 复现事故：故障名单退回手抄第二份且 `reasonFault` 改读它 | 5：零测量轮 / 整轮零测量 / 混合轮 / 三档名 / 归类表派生 |
  | M-D2 | 摘掉计数不变式 | 1：整轮零测量且并非全 conflict |
  | M-D3 | 退出码只看计数、不看故障行 | 1：混合轮（**第一轮它 MISSED**，见 4.12） |
  | M-D4 | 两个 git 阶段折回同名 | 3：三档名 / 现场+档位同源 / commitTree 透传 |
  | M-D5 | 评论表格丢现场 | 1：现场+档位同源 |
  | M-D6 | 归类校验退化成 no-op | 1：归类表派生 |
  | M-D7 | 不写 `MEASURED=0(all-conflict)` 那一支 | 1：全 conflict 的一轮 |
  | M-D8 | 生产默认 `runChecker` 路径改错一个字母 | 2：默认装配 IN_BASELINE / 身份对照 |
  | M-D9 | 默认 `commitTree` 不透传 stderr | 1：commitTree 透传 |
  | M-D10 | 逐条日志丢 detail | 2：现场+档位同源 / commitTree 透传 |
  | M-D11 | 摘掉 `gitRunner` 的 env 剔除 | 1：GIT_DIR 行为侧 |
  | M-D12 | 剔除仍在但告警改 no-op | 1：GIT_DIR 告警侧 |
  | M-D13 | 两处 commit-tree 退回"靠宿主恰好配了身份" | 4：默认装配 IN_BASELINE / 默认装配 VIOLATES / 身份对照 / argv 结构侧 |
  | M-D14 | 把结构锁的扫描域缩回单文件（拆分后的退化形态） | 4：指标名结构锁 / 写入门闩 / 构造函数不自称判决 / 归类表派生 |
  | M-D15 | 把每笔 PR 用完的 worktree / 临时 ref 清理改成恒假（外部评审第 2 轮那半截真顾虑） | 1：默认装配 IN_BASELINE |
  汇总原文：`跑了几条=15 CAUGHT=15 非CAUGHT=[]`、`红集互不相同=yes`、`drift=0`
- [x] 5.2 **两处如实披露，不得读成"14 对 14 独占"**：
  ① M-D13 的第一版是**语法不合法的变异**（只替换 `X.concat(` 前缀、留下多余右括号）⇒ 文件解析失败 ⇒ 整片 LOADFAIL，驱动报 `UNREADABLE tests=1 rc=1`。那读不出任何红集；改法是把整段调用表达式换掉后**单条重跑**（`node d-mutate.cjs M-D13` 得 4 条指名红），不是把 UNREADABLE 记成"未被抓住"，更不是记成"已反证"。
  ② 三处子集关系必须写出来（驱动的"互不相同"是按集合**不相等**判的，不等于互不重叠）：`M-D15 {默认装配 IN_BASELINE} ⊂ M-D8 {默认装配 IN_BASELINE, 身份对照} ⊂ M-D13 {…另含默认装配 VIOLATES 侧与 argv 结构侧}`。可分辨处：只有 M-D13 打断身份链，只有 M-D15 不打断任何判决只打断卫生。
- [x] 5.3 覆盖要求逐条对上：M-D1 就是"折回同一档名 **且** 保留旧故障名单"的复现形态；M-D5/M-D9/M-D10 分别摘 detail 的三个落点（评论、透传、日志）；M-D8 是"把默认路径改错一个字母"；M-D11/M-D12 把环境卫生的两半（剔除与出声）分开拔——为此把 §28 拆成行为侧与告警侧两条用例（判据分辨率的单位是用例名）；M-D13/M-D14 分别拔身份参数与扫描域下界
- [x] 5.4 还原核对：三个文件按字节还原，驱动打印 md5（`core=d9e9458839` / `live=6b333ff974` / `test=8e6e31583f`，前 10 位）且 `drift=0`。md5 是**工作树字节**档（本轮为 LF），rebase 后若被检出成 CRLF 会整体换数 ⇒ 引用时必须连带"哪一份内容 + 哪一种行尾档"
- [x] 5.5 驱动自证：`only` 参数（单条重跑与全表跑同一套代码）、锚点命中数必须恰为 1（多处或零处即 DRIVER-ERROR，不产出 verdict）、还原放在 `finally`

## 6. 交付与收尾

- [ ] 6.1 执行记录 `openspec/records/debt-recheck-zero-measurement-fail.md`（含 `## CHANGELOG 条目` 小节；**不动 CHANGELOG.md**）
- [ ] 6.2 本机按 CI 清单点名跑相关判据（`check-unwired-tests`、`check-step-failfast`、`check-gate-record-debt`、`check-pr-exec-record --mode=enforce`、`check-changelog-growth`、`check-changelog-duplicate-entries`、`check-record-qm5-rows`）
- [ ] 6.3 PR + `mergeable`/checks 闸门 + squash 自动合并 + 三件产物取证
- [ ] 6.4 回读本次合并触发的 main push，读数写进 PR 评论（不写回仓库文件）
- [ ] 6.5 `check-branch-merged` → retire 标签 → `safe-worktree-remove.ps1 -WhatIf` 再实跑 → 删本地分支
- [ ] 6.6 记忆收敛：本轮可复用教训（不写代码模式，写判据与失效形态）
