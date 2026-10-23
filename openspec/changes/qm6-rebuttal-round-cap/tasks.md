# 任务：已否证清单 + 轮次上限

> **状态（2026-10-23 更新）：§0 与 §1 已落，§2 卡在 vendor 授权。**
> §1（轮次上限）不依赖 vendor，已按合同实现并接线；§2 的前读取数 §0.2 实测结论是
> **「必须改仓外引擎」**，因此 §2 一条未动，等人工授权（另见 PR #4304 那份规格）。
> 顺序纪律：先测后码；每条判据各配一条变异反证；上限与清单**都不得有静默档**。

## 0. 前置读数（不做这步，后面的设计都是猜）

- [x] 0.1 现取一次"记录名会随重投改变"的证据链（本 change 的核心前提，不能只引 proposal 的八轮表）：
  在同一 worktree 里改一行注释 → 重提交 → 比对 `git diff HEAD^ HEAD -- . ':(exclude).ccg' | sha256sum` 与新旧记录名。
  **实测不等**：`90dce309…` → `720882d6…`（同文件加一行注释即换名）⇒ 计数挂记录名必然每次归零。
- [x] 0.2 实测仓外引擎能否接受外部注入：结论 **不能**。`ccg-deep-review.js` 拼 critic 任务文本的调用是
  `mc.callCritic({ proposalText })`，`model-call.js` 里 `proposalText` 由引擎自己渲染，
  仓内没有任何参数化入口（无 `--rebuttal-file`、无 env 钩子、无 payload 包装点）
  ⇒ **§2 的清单注入必须改仓外引擎**，属"改谁来守门"，需人工授权（先例：`verificationSeverityVerdict` 那一刀）。
  这一格如实记为"读出来了，但读出的结论是必须动 vendor"，不得当成"暂时没找到入口"。
- [x] 0.3 量一次现状基线：`.ccg/reviews/*.json` 里 `"verdict": "dismissed"` 命中 **68** 个文件，
  `.adversarial/*/adjudication.json` 命中 **121** 个文件 ⇒ 历史上确有大量否证，
  且**绝大多数没有**本 change 要求的 `evidence` 字段（那时还没这个形状）⇒ §2 必须兼容"无证据的存量否证"
  （只能"不追溯采纳"，不得回填成合规条目）。
- [x] 0.4 确认钩子的记录暂存 glob 确实不跨 `/`（真实 worktree 实测，不照抄注释）：
  在 `.ccg/reviews/probe/` 放 `.json` ⇒ `:(glob).ccg/reviews/*.json` **不收**（`GLOBAL_CROSSES_SLASH=no`）
  ⇒ 账本必须落 `openspec/changes/<change>/`（受管、可 diff），这条是**判据前提**不是风格偏好。

## 1. 轮次上限（先做这把，它不依赖 vendor）

**落点**：`scripts/lib/ccg-review-rounds.js`（唯一实现）+ `scripts/ccg-review-rounds.test.js`（7 条库侧锁）
+ `scripts/deep-review.sh` 的 `run_driver_with_writeback` 前置块 + `scripts/deep-review-entry-rc.test.js` 的 ⓬⓭⓮。

- [x] 1.1 入口按 **(分支, HEAD sha)** 记账：首跑打印 `外部评审轮次 第 1/3 轮（本轮真调用外部评审…）`
  并在驱动返回后落一条；`⓬` 实测 `counted=1 round=1`、账本落在 `openspec/changes/<分支>/external-rounds.json`、
  条目里的 `headSha` 逐字等于 HEAD。
  ⚠ **与本条原写法的偏差（必须写明，不是顺手统一）**：原文要求"连跑两次第二次 MUST 是 `round=2`、
  重投提交后 MUST 是 `3`"。实现按 spec 与 §4.1 的现选口径改成 **同一 sha 重跑不计数**（`round` 仍是 1，
  且不发起记账调用），换了 sha（重投提交）才 +1。理由：短路重跑零模型调用、且"填完裁决再覆盖一轮"是必须动作，
  计入等于白烧配额。**该口径随后被第二轮评审 i4 收窄成"按交付身份计"**（见 §1.10、§6）：
  零模型的复用重跑仍不计数，但同一 sha 上真跑出新交付就要再计一轮。
  原期望留在这一条的偏差说明里，不删。
- [x] 1.2 上限默认 3；`MP_QM6_MAX_ROUNDS` 可覆盖；非法值（`abc`/`0`/`-2`/`3.5`/空串）回落 3 **且每次都出声**——
  `R1` 断言 `warns.length === 5` 且文案含"非法/不可用"（静默回落是本仓定性的失败）。
- [x] 1.3 超限 ⇒ `ESCALATED：外部评审已达轮次上限（3/3），本轮**不再调用模型**`、`exit 1`，
  且**判定记录一个字节都不动**、账本不增长（`⓭` 双断言）。"记录不动"这一半比"判据仍判未闭合"更可测：
  本 change 既没写 tier/status，也没改判据本体——现场读数（2026-10-23，可重跑）：
  `git diff origin/main -- scripts/check-pr-exec-record.js` **空**，且该 diff 里
  `CLOSED_DEEP_REVIEW_STATUSES` / `HIGH_RISK_SURFACES` / `classifyEvidenceTier` 命中 **0** 次
  ⇒ "什么算闭合"没被本 change 动过（§2.7 要求的结构锁仍未落成测试，留在 §2）。
  另一条：超限那一档的读数**不得**再说"本轮真调用外部评审"——`⓭` 有 `!/本轮真调用外部评审/` 的负断言，
  三档读数各有自己的话术（已达上限 / 同一载荷重跑 / 本轮真调用）。
- [x] 1.4 账本落点与原子替换：`writeJsonAtomic`（tmp + rename，只对 `EPERM/EACCES/EBUSY` 有界退避、
  失败时删 tmp 并原样抛错）。**未复用 `ccg-review-writeback.js` 那份同名实现**，原因是它为了取
  `CLOSED_DEEP_REVIEW_STATUSES` 而 require 整份判据本体，会把账本库拖成"必须先加载全部门禁"；
  该取舍写在库文件注释里，要收敛成一份得下沉到 `scripts/lib` 并同改两侧（另开一刀，别顺手）。
  `R5` 锁原子性（无 `.tmp` 残件）与幂等。
- [x] 1.5 变异反证 **6 条全部 CAUGHT**（驱动：本轮临时脚本，逐条先验 pristine md5、还原后回验）：
  | 变异 | 改的是 | 指名变红 |
  | --- | --- | --- |
  | M-a | 计数键 `headSha` → `recordName` | R3 |
  | M-b | 超限分支删 `exit 1`（只打印不拦） | ⓭ |
  | M-c | 非法值回落改成静默（`if (false && …)`） | R1 |
  | M-d | CLI 未知子命令 `return 2` → `return 0` | R7 |
  | M-e | 摘掉同 sha 幂等（`hit = undefined`） | R5 |
  | M-f | 入口侧删 `_QM6_SEEN` 跳过 | ⓬（**收紧后才 CAUGHT**，见下） |
  ⚠ M-f 第一次跑是 **MISSED**：幂等已在库里兜着，摘掉入口那格只多出一行 `counted=0`，
  而 ⓬ 原断言只查"不出现 `counted=1`"⇒ 锁与守的不是同一件事。正解不是"反正库里幂等就算了"，
  而是把 ⓬ 收紧为「重跑根本不发起记账调用」（`!/\[rounds\] /`），随后先复跑 baseline（绿，181s）
  再重跑变异 ⇒ CAUGHT。这一格记进 §1 的教训：**防御重叠会让变异不可分辨，不可分辨时先怀疑断言的观测面**。
  变异前必须跑 baseline 档（`--baseline=1`）证明 `--test-name-pattern` 真的选中了那条用例——
  "pattern 没选中"与"变异没牙"在产物上完全同形。
- [x] 1.6 接线：不新开 Gate 号（在飞期间号会被主干抢，见既有教训），把 `scripts/ccg-review-rounds.test.js`
  登记进**已有的** `quality-gate.yml` Gate 2b11（`changes` 作业，与非门控面同步骤）。
  读数：`node scripts/check-unwired-tests.js` → `检查域内测试文件 128 个 / OK`；
  `.gitignore` 无需新增 negation（`git check-ignore --no-index -v` 回显：lib 文件**无规则命中**、
  测试文件命中 `!scripts/*.test.js` 反选 ⇒ 均不受管排除；注意 rc 对反选也返回 0，判据取回显模式）。
  同 PR 顺带纠正一处**注释里的过期耗时**：原文写"本机实测 ~60s"，而 2026-10-23 现场取证是
  「runner 侧该步骤 3–4s（job 120219562032 等四个 job 的 step 时间戳）」与
  「本机一条入口用例 88–181s（CLR/AMSI/Defender 冷启动 × 每次 node/bash）」两个数量级——
  两者都必须分开写，否则下一个会话会拿本机数去估 CI 预算（或反过来把本机慢跑当成 CI 超时风险）。
  结构自检：`node .github/scripts/check-workflow-structure.js` → `files=16 violations=0`（本机 `node_modules`
  未装，经 `NODE_PATH` 指到共享根才取得 js-yaml；这条要如实记，不得写成"本 worktree 跑通"）；
  `.github/scripts/workflow-contract.test.js` 46/46；Gate 12c `check-doc-abs-paths.js` PASS（counts=1161 未增）。
- [x] 1.7 本地已实跑的入口用例：`①`、`②③`（rc 逐字传递）、`⓬`（收紧后复跑）、`⓭`、`⓮`；
  库侧 `R1–R10` 全绿（10 条，评审后补的 R8–R10 也在内）。
  **未在本轮本地跑**：`④⑤⑥⑦⑧⑨⑩⑪⑫`（每条要真跑一遍 bash，本机 90–180s/条）
  ⇒ 全量入口回归以 CI 为准（该步骤在 runner 上 3–4s 跑完四个文件，含本文件全部 13 条）。
  另记一条取证卫生：本轮 `scripts/deep-review-deps.test.js` 全量批跑报 `46/47`，红的那条是
  `候选目录已在 PATH 中时也必须被 prepend 到最前并报 ABS`；**单跑两档均绿**（HEAD 原文件 与 含本次改动）
  ⇒ 归因为既有间歇红（该文件已知两条），不得认领为本 PR 引入，也不得据此判"我的改动没事"——
  以 CI 同名步骤为准。
- [x] 1.8 **残留（评审 i2 之后新增，别把它读成"并发已解决"）**：账本写入没有跨进程互斥。
  2026-10-23 现场 A/B 探针（A 档取 `git show HEAD:scripts/lib/ccg-review-rounds.js` 落盘后再跑；
  ⚠ 复跑时 lib 已含修复，"修复前"那一列是**当时那档**的读数，不是现在还能复现的事实）：
  | 场景 | 修复前 | 修复后 |
  | --- | --- | --- |
  | 账本 2 轮 → 写成坏 JSON → `record` | **写成功，终态只剩 1 轮，旧两条消失** | 抛错拒写，坏文件逐字节保留 |
  | 顺序两记（不同 sha） | 1 → 2，终态 2 条 | 同 |
  | 同时起 4 个 `record` 进程 | 终态 **4 条齐全**（rc 全 0） | 同 |
  ⇒ 结论必须按实测写：**可复现的是"在坏文件上覆盖历史"那一半，已修并有 R9 锁**；
  "并发丢更新"那一半结构上有窗口（read-modify-write 无锁），但本机 4 进程探针**没抓到**，
  所以本刀不写断言、不加一把没验证过的锁，只把残留登记在此。
  彻底闭合需要跨进程 writer lock（先例：`PublishApiServer` 对 `API_KEYS_PATH` 那把 fail-closed 锁），
  且必须与"第二个实例必须 fail closed"的行为锁同一次发生。
  ⚠ 这条也不是纯理论：同一分支并发跑两个深审入口会**先**在同一个 `.ccg` 产物上撞车（共享根那份 git 状态本来就互相竞争），
  所以真要上锁，正确的位置可能是整条评审链的入口，而不是账本这一格。
- [ ] 1.9 i1 的另一半（`record` 里也调 `assertChangeName`）已落，但 **`inspect`/`exceedsCap` 没有校验**：
  它们只读，怪键最多读到一个不存在的桶（读成 0 轮）。这条现在不构成绕行，因为**写侧**已被 CLI 的
  无条件校验挡住；若哪天出现第二个调用方绕过 `mainCli` 直接 `inspect()`，就得在这里补上同一判据。
  留这一格是为了让下一个会话知道"为什么只有两处校验"，而不是以为漏了。
- [x] 1.10 **去重键是 (sha, 交付指纹)，不是单独 sha**（QM-6 第二轮 i4 把它从"待决岔口"变成必改项）。
  交付指纹就是写回器判 `no-new-delivery` 用的那份语义指纹（`ccg-delivery-digest.js --print-fingerprint`），
  入口在驱动前后各取一次：前后相同 ⇒ 这次是复用存档的零模型重跑 ⇒ `counted=0`；不同 ⇒ 真花了额度 ⇒ 计新的一轮。
  三条不能写错的口径：① 指纹**取不到时按新轮计**（"看不见"不得读成"没花钱"）；
  ② check 侧**没带** `--delivery` 时必须读成"无复用证据"（不得与账本里的 unmeasured 哨兵同键而放行，
  否则 digest 一坏上限就永不触发——这一格由变异 M-o 专门打）；③ 跑满之后连免费重跑也一并拦，
  这是**刻意的不便利**，出口是人工清一条记录或直接人工收口，不是把闸改宽。
  锁：库侧 R12、入口级 ⓰（sha 不变、只换交付 ⇒ 必须 counted=1 round=2，且两条 delivery 不同、headSha 相同）。
  变异：M-n（键退回 sha-only）、M-o（check 无指纹当 unmeasured）各自指名变红。

## 2. 已否证清单（依赖 §0.2 的结论，可能要多一次 vendor 授权）

> **§0.2 实测结论已定：注入点不存在，必须改仓外引擎。** 因此本节一条未动，等人工授权后才能开工
> （另见 PR #4304 那份"零人工收口"规格——它已把"false-positive 复用 `rebuttals[]`、不另建登记"写进合同，
> 本节 2.1 的形状定义要与它对齐，不得各造一份清单）。

> **设计留稿（这一整块 2026-10-23 从 `specs/qm6-rebuttal-round-cap/spec.md` 搬进来，文本未删）**
> 搬的原因不是文字坏了，是位置错了：QM-6 第二轮 i2（Critical，且被引擎打上 `auth` 高危域标签）
> 判"未开工即立约"。第一轮我先试过在该 Requirement 顶部加一句"本条未实现"的交付状态，
> 第二轮**照样被判** ⇒ 加标记不解决"delta 里躺着一条无人实现、也无门禁在问的 Requirement"。
> 合同形状因此改成：spec delta 只描述本 change 真正交付的行为；未授权的设计留在这里等授权。
> 动手时以 PR #4304（`qm6-zero-human-closure`）那份合同为准 —— 它把"处置凭证"写成同一份
> `rebuttals[]` 的消费者，**两处不得各建一份否证登记**；开工前提仍是 §0.2 那一次仓外授权。

#### 留稿原文：Requirement「已否证争议必须带可核证据并随下一轮送审注入」

#### Requirement: 已否证争议必须带可核证据并随下一轮送审注入

> **交付状态（2026-10-23，QM-6 第一轮 i6 采纳后补）**：本 Requirement **未实现**，且不是"忘了写"——
> 它的前提是往 critic 的送审载荷里注入一段文本，而实测（tasks §0.2）仓外引擎 `ccg-deep-review.js`
> 自己拼 `mc.callCritic({ proposalText })`，仓内没有任何注入点 ⇒ 开工需要一次**仓外引擎改动的人工授权**。
> 引用这一条时先问"授权拿到了吗"，不要把它当成可直接实现的合同。
> 另一处必须同看：PR #4304（`qm6-zero-human-closure`）把"处置凭证"写成同一份 `rebuttals[]` 的消费者，
> **两处不得各建一份否证登记**。

一条被判 `dismissed`（指控不成立）的争议，MUST 携带**可核证据**才能进入 `rebuttals[]` 清单：
形态只认两类——`文件:行号`（该行确实承载被指控的那件事），或 `命令 + 输出摘要`（命令可重跑且摘要与输出对得上）。
"我判断它不是问题"MUST NOT 算否证。下一轮外部评审的送审载荷 MUST 注入这份清单，
并要求评审方对已否证的同一 `finding` 指纹**重复提出时必须携带新证据**。

注入失败（引擎不支持、清单读不到、指纹算不出）MUST 出声成**独立一档**
（`rebuttal-injection=absent`），MUST NOT 把"没有注入"读成"已注入且无重复"——
后者会让整条机制在静默中退化成装饰，与本仓「降级产物不得冒充成功产物」同型。

##### Scenario: 无证据的否证不进清单

- **WHEN** 一条争议被填成 `verdict=dismissed` 而 `rationale` 里没有 `文件:行号` 也没有可重跑命令
- **THEN** 该条 MUST NOT 进 `rebuttals[]`，且 MUST 点名"否证缺可核证据"

##### Scenario: 重复指控被标出但不隐藏

- **WHEN** 评审方再次提出一条与 `rebuttals[]` 中某指纹相同、且未携带新证据的 Critical
- **THEN** 该条 MUST 被标 `duplicate_rebutted` 且 MUST NOT 计入阻断项
- **AND** 它 MUST 原样出现在判定记录里（人工回看时看得见"模型又提了这条"），MUST NOT 被删除或改写成 Info

##### Scenario: 引擎不配合注入时必须出声

- **WHEN** 送审载荷里没有已否证清单（引擎版本不支持或注入路径失败）
- **THEN** 入口 MUST 打印 `rebuttal-injection=absent` 一档，MUST NOT 打印"本轮无重复指控"

- [ ] 2.1 定义 `rebuttals[]` 条目形状：`{fingerprint, finding, severity, verdict, evidence{kind, value}, dismissedAt}`。
  `evidence.kind` 闭集只收 `file-line` 与 `command`，其它一律拒进清单（MUST NOT "顺手放宽成字符串"）。
- [ ] 2.2 证据可核性判据（本仓有先例，复用不重抄）：`file-line` 形态 MUST 现场读那一行、
  行内容 MUST 与被指控对象的语义位置对得上（`grep` 到文件名不算）；`command` 形态 MUST 至少一条用例
  证明"命令跑出的摘要与登记的摘要不等时，该否证被拒"。
- [ ] 2.3 指纹算法 MUST 复用 `scripts/lib/ccg-delivery-digest.js` 的规范化实现（唯一一份），
  MUST NOT 在清单侧另写一份规范化——两份必然漂移，而漂移的表现是"重复指控永远判不出来"。
- [ ] 2.4 注入：把清单渲染成送审载荷的一段。失败/不支持 ⇒ `rebuttal-injection=absent` 一档出声，
  且 MUST NOT 同时打印"本轮无重复指控"（两条同现即假绿，各配一条用例）。
- [ ] 2.5 去重判定：同指纹 + 无新证据 ⇒ `duplicate_rebutted`，不计阻断但**留在记录里**；
  同指纹 + 有新证据 ⇒ 正常计阻断（MUST NOT 变成"否证过就永久免疫"，那会把闸拆掉）。
  "新证据"的判据形态与 2.2 同源，MUST NOT 自造第二套。
- [ ] 2.6 变异反证至少四条：① 指纹算法退回"取前 40 字符" ⇒ 2.5 红；② 注入档与"无重复"合并成一句 ⇒ 2.4 红；
  ③ 允许 `evidence` 为空串进清单 ⇒ 2.1/2.2 红；④ "否证过即永久跳过"（不看有没有新证据） ⇒ 2.5 红。
- [ ] 2.7 与 `qm6-closure-writeback` 的对账：本 change MUST NOT 触碰
  `CLOSED_DEEP_REVIEW_STATUSES` / `HIGH_RISK_SURFACES` / 收口矩阵；加一条结构锁钉住"这三个符号未被本 change 修改"，
  并在实现 PR 里回读该锁的读数（防"顺手统一"）。

## 3. 落账与交人工

- [ ] 3.1 执行记录 `openspec/records/<分支名>.md`（唯一强制载体）：八轮读数以**演进链**写，
  引用前现跑；未跑的范围点名交给 CI。
- [ ] 3.2 本 change 属"改谁来守门" ⇒ **不自动合并**，交人工；PR 正文须写明它**没有**改变"什么算闭合"。
- [ ] 3.3 与 #4148 的关系写清：#4148 的收口仍以"一轮零 Critical"为唯一机械出口，
  本 change 不为其提供新出口；若第 1 条（处置型收口）另行采纳，需与本 change 分别裁决、分别接线。

## 4. 已知的两个待决设计岔口（要人拍板，agent 不擅决）

- [x] 4.1 **轮次怎么算"一轮"**（第二轮评审 i4 已选定，**不再待决**）：只计真外部调用，还是含"复用存档 critique"的短路重跑？
  当时按前者（短路重跑零模型调用，不该消耗预算），但那是**价值判断**，不是事实——需确认。
  第二轮评审 i4 之后改判成"按交付身份计"：零模型复跑仍免费，而同一 sha 上真烧出去的第二次
  不再免费（§1.10）。于是这句"需确认"有了答案，不用再等人。
  注意选错的后果很具体：若计入短路重跑，"填完裁决再跑一次"这种**必须的**动作会白烧配额。
  选定的一档：**按交付身份计**（见 §1.10）。下面这段是当时的原文，留着是为了让后来人知道
  这条不是"一开始就这么设计"，而是被外部评审追问出来的：
  原本按 **sha 去重**，所以"同一个 sha 上反复真调模型"（不复用存档）也只算一轮。
  更严的口径是可用的：入口在动手前已经取了 `_wb_before` / `_wb_before_fp`（字节哈希 + 语义指纹），
  写回器正是靠它判 `no-new-delivery`——**把它借给轮次账**，就能区分"短路重跑（无新交付）"与
  "同 sha 又烧了一次额度（有新交付）"。这条后来被采纳了：见 §1.10 与 §6 的 i4。
  代价（现在已不是"待定"而是"已付"）：轮次账依赖交付读数，且**取不到指纹时按新轮计**、
  跑满之后连免费重跑也一并拦。要退回更松的口径只需改 exceedsCap 一行，
  但必须连 M-n / M-o 两条变异反证一起推翻，不能只改判据。
- [ ] 4.2 **清单跟着走还是留在原地**：`external-rounds.json` 放在 change 目录里 ⇒ 随 PR diff 可见、可审，
  但每次重跑都产生一次真实提交（本仓热点写面之一）。替代是放 `.ccg/` 下不受管——
  那等于把"上限有没有被绕过"变成只有本机知道的事，本 change 明确选**受管**。
  若你更在意提交噪声，正解是加"同一 PR 内多次重跑合并为一次记录更新"的写策略，而不是搬到不受管区。

## 5. 第一轮外部评审逐条处置（round 1，载荷 `980f3ca33`，critic 交付 7 条 / 最低分 4）

| # | 严重度 | 指控（原文摘要） | 处置 | 证据 |
| --- | --- | --- | --- | --- |
| i1 | Critical | `defaultLedger` 未消毒拼 `change`，恶意名可写到工作区外 | **采纳机制、否证可达性** | 实测三档：① git 拒绝含 `..` 的分支名（`../../etc/evil`、`a/../../b`、`..\..\etc\evil` 三种写法 rc=128），而入口唯一的 change 来源就是分支名；② 固定前缀 `openspec/changes/` 吸收两级 `..`（`../../etc` 解析回 `<cwd>/openspec/etc`）；③ `record`/`check` 在目标目录不存在时**不创建**（探针 `文件真被创建? false`）。三条都不在本模块的合同里 ⇒ 已补 `assertChangeName`（只拒 `..` 段与绝对路径，**不**收紧成 kebab-only，`team/feature` 必须放行）+ CLI 无条件校验 + rc=2 出声；锁 R8/R10，变异 M-g/M-i/M-j 指名红 |
| i2 | Critical | 无跨进程锁，并发跑会 corrupt 账本 | **一半采纳（且修的是它没提到的那一半），一半登记残留** | 可复现的那半是"账本读不出时照样追加"：A 档实测 2 轮 → 坏 JSON → 一次 `record` ⇒ 终态 1 轮、旧两条消失（**销毁证据**，比丢一轮更坏）。已改为拒写且逐字节保留（R9，M-h 指名红）。它主张的那半（并发丢更新）本机 **4 进程并发探针没复现**（终态 4 条齐全）⇒ 不写断言、不加没验证过的锁，残留记 §1.8 |
| i3 | Critical | proposal 仍写"没有实现"，而差量落了代码；决策层点名 7 文件范围漂移 | **采纳** | 这是"文档与差量不同源"，钩子不是误报。已把 proposal 首行改成状态句并列出 §1 落点清单（含账本本体那个新文件）；spec 里未实现的那条 Requirement 加了交付状态标记（见 i6） |
| i4 | Critical | `_QM6_KV` 按空格切 `key=value`，路径含空格会把 `max`/`exceeded` 读错 ⇒ 上限判歪 | **否证（数值键），附带记下真形状** | 造含空格路径（`…/a b/external-rounds.json`）实测 CLI 读数 `round=1 max=3 exceeded=0 unreadable=0 seen=1` 全部正确；被截断的只有末位 `ledger`（值里带空格），而**入口从不消费 `ledger` 做判定**（只读 round/max/exceeded/unreadable/nochange/seen 六个键）。所以"corrupt cap decisions"不成立。记下的真形状是：这套 `key=value` 约定要求"参与判定的键必须是纯 token"，新增值时必须守住这条 |
| i5 | Warning | 删掉 `openspec/changes/<分支>` 就静默重置上限 | **否证 "silently"，接受其前提已选** | 该分支入口打印 `⚠ 该分支没有 openspec/changes/<分支>/ 目录 ⇒ 无账本可记，本轮不计数（也不代为创建）`，CLI 侧同时打 `nochange=1`（R7 锁住"不得创建目录"）。且账本按 §4.2 选了**受管**：删掉它是 PR diff 里可见的一次删除，不是本机静默事 |
| i6 | Warning | `rebuttals[]` / `duplicate_rebutted` 在 spec 里有、代码里没有 | **采纳，但修法不是"补实现"** | §2 的前提是 tasks §0.2 实测：critic 任务文本由仓外引擎 `mc.callCritic({ proposalText })` 自拼，仓内零注入点 ⇒ 补实现需要一次 vendor 授权（未拿到）。正解因此是**把交付状态写进 spec**（已加"本 Requirement 未实现 + 前提 + 与 #4304 同用一份 `rebuttals[]`"），而不是假装能落地 |

本轮净结果：`status=self_play_pending`、写回器 `reason=not-closed` ⇒ **没有**冒充外部收口；
上面 4 条 Critical 里 3 条按证据修/改文档、1 条按实测否证。
计数侧现场：`第 1/3 轮（本轮真调用外部评审）`、`[rounds] counted=1 round=1`、账本落在
`openspec/changes/qm6-rebuttal-round-cap/external-rounds.json`——这是本刀自己第一次被自己用上。

## 6. 第二轮外部评审逐条处置（round 2，载荷 `6ddfbfb4e`，critic 交付 8 条 / 最低分 4）

第二轮**用上了本刀自己装的闸**：读数 `第 2/3 轮（本轮真调用外部评审）`、`[rounds] counted=1 round=2`、
写回器 `reason=not-closed`（状态 `self_play_pending`）⇒ 没有冒充外部收口。
4 条 Critical + 3 条 Warning 逐条如下，每条都给"能重跑"的证据，不按措辞判：

| # | 严重度 | 指控 | 处置 | 现场证据与落点 |
| --- | --- | --- | --- | --- |
| i1 | Critical | 两份 `.ccg/reviews/*.json` 都是 `required:true`、`status:pending` ⇒ 要求深审却未执行 | **否证（它读错了产物）** | 逐份读回：`ce447d98…` 是 `mode=dual / required=true / status=self_play_pending`；另一份 `e14cb13f…` 是 **`mode=skip / required=false`**（来自纯文档那笔提交，判定器走 docs-only 快通道）。权威读数是 `check-pr-exec-record.js --mode=enforce` 打印的 **`CCG 深度审查欠账 1 条`**，不是两条。它真正指的那件事（本 PR 自己没闭合）在 §7 里已写明是交人工项，不是新发现的缺陷 |
| i2 | Critical（引擎另外给它打了 `auth` 高危域标签） | §2 的 `rebuttals[]` 在 spec delta 里有 Requirement、代码零实现 ⇒ 未开工即立约 | **采纳，并承认第一轮的修法不够** | 第一轮试过"在该 Requirement 顶部写交付状态"，第二轮**照样被判** ⇒ 加标记不解决"delta 里躺着一条无人实现、也无门禁在问的 Requirement"。正解是把它**整块搬出 delta**：进 tasks §2「设计留稿」，文本一条未删、Scenario 逐条回验（3 条），第三条 Requirement 里那句会指向空处的话同步改写。搬运脚本自带判据：Requirement 数必须 3→2、delta 内 `rebuttals[` 残留必须为 0，否则一行都不写 |
| i3 | Critical | 账本读不出时 `exceedsCap` 强制 `exceeded:false` ⇒ 上限完全失效、可无限绕 | **采纳（取向反转）** | 旧取向"别让工具失明挡住干活"给了零成本绕行：`echo garbage > external-rounds.json` 就让闸永久点不着火。现在 **无证据 = 按超限处理**，入口 `exit 1`，且文案与"跑满了"分档（一个是配额用尽、一个是判据失明，处置动作完全不同）。锁：R6 改写 + 新增入口级 ⓯（其中"判定记录一字节不动"就是"确实没调模型"的证据；另断言不得顺手改写坏账本）。变异 M-k 指名红 |
| i4 | Critical | §4.1 自认计数口径是"价值判断、等人拍板"，且留着"同一 sha 反复真调只算一轮"的松口 ⇒ 分歧未决即落地 | **采纳，且这次不等人——落到更严的一档** | 放行判据从"这个 sha 记过没记过"换成 **(sha, 交付指纹)**，用的就是写回器判 `no-new-delivery` 的那份语义指纹（入口本来已在算）。⇒ 复用存档的零模型重跑仍免费（`counted=0`），同一 sha 真跑出**新交付**就计新的一轮。锁：库侧 R12 + 入口级 ⓰（两次真跑、sha 不变、只换交付 ⇒ 必须 `counted=1 round=2`，且两条记录的 delivery 必须不同、headSha 必须相同）。变异 M-n（键退回 sha-only）与 M-o（check 不带指纹也当 unmeasured ⇒ 与账本同键而放行）各自指名红。**代价写在明面**：digest 取不到指纹时按"新一轮"计（宁可多计不可漏计），跑满后连免费重跑也拦。要退回更松口径只需改 `exceedsCap` 那一行，但必须连 M-n/M-o 两条反证一起推翻。**§4.1 因此不再是待决岔口** |
| i5 | Warning | 入口用 `tr`/`sed` 解析 CLI stdout，输出形状一变就静默读空 | **采纳** | 加 parse 判据：`round/max/exceeded/unreadable/seen` 五个键必须都在且都是纯数字，缺一即 `exit 1` 并打印 CLI 原文；这一档与"跑满了"分开（"没有读数"与"没预算"是两件事）。再把形状本身钉成合同：R11 要求三条出口（无目录 / 账本不存在 / 账本坏）都给全五个键、键序不入合同（第一版把顺序焊进断言，自己先红过一次，已拆成逐键断言）。CLI 的 `badchange` 行原先少打 `seen=`，正是被这条 parse 判据逼出来的。变异 M-l / M-m 指名红 |
| i6 | Warning | `record` 是 read-modify-write，无跨进程锁 | **维持第一轮结论：残留登记 §1.8** | 本机 4 进程并发探针这轮**仍没复现**丢更新；可复现的"在坏账本上覆盖历史"第一轮已修（R9）。本轮不新增改动——"加一把没验证过的锁"正是本仓禁止的顺手 |
| i7 | Warning | `defaultLedger` 用 `process.cwd()`，换目录调用会落错地方 | **否证（前提不成立）** | 入口自己把工作目录钉死了：`scripts/deep-review.sh:50` 取 `ROOT="$(cd "$_self_dir/.." && pwd)"`、`:55` `cd "$ROOT" || exit 2` ⇒ 经入口进来的调用永远落在仓库根。即便有人绕过入口直接敲 CLI，目录不存在时走的是 `nochange=1` 出声档，不是静默落错地方；库注释同时写明"不得为计数器凭空造目录"（R7 锁着） |

第二轮净结果：i2 / i3 / i4 / i5 四条改变了代码或合同形状（i4 顺带关掉 §4.1 那个岔口），
i1 / i6 / i7 三条按实测否证或维持原残留登记。
锁的数量随之演进：库侧 **10 → 12 条**（R11 输出形状合同、R12 交付身份键），
入口级 **3 → 5 条**（⓯ 无证据档、⓰ 同 sha 新交付必须再计一轮）；
变异反证第一批 6 条 + 第二批 9 条（M-g…M-o），其中 M-m 第一版锚点写错命中 0 次 ⇒ 改锚后重跑才 CAUGHT，
"锚点命中 0 次"必须由驱动自己出声，否则它读起来就像"这条锁没牙"。

## 7. 第三轮 = 上限那一轮（round 3，载荷 `cee109520`，critic 交付 8 条 / 最低分 4）

读数 `外部评审轮次 第 3/3 轮` + `[rounds] counted=1 round=3` ⇒ **到顶，按合同交人工，不跑第 4 轮**。
逐条处置表在 `openspec/records/qm6-rebuttal-round-cap.md` 的「第三轮外部评审」一节（八条，每条带可复跑证据）。
这里只留三条对**后续片**有约束的结论：

- **产物名演进链**（不得回头引用旧名）：`8f1afa55…`（round 1 时）→ `ce447d98…`（round 2 时，已被软重置重投淘汰、
  不在本 PR 变更集内）→ **`e14cb13f…`（纯文档那笔，`mode=skip`）+ `842dc2554…`（实现那笔，`mode=dual`，
  `status=self_play_pending`）是当下唯一两枚在集内的产物**。第三轮 i1 又拿"另一枚 pending"说事，
  与第二轮 i1 同一形态、同一否证方式：权威读数 `--base=$(git merge-base origin/main HEAD) --mode=enforce`
  ⇒ rc=1 且 `CCG 深度审查欠账 1 条`。
- **三轮的边际收益实测**：交付 7 → 8 → 8 条，最低分 4 → 4 → 4，其中"无跨进程锁"第三次原样回来，
  第三轮新增的两条是形状（已在第二轮修掉）与风格。⇒ 上限默认 3 不是随手取的数，这三行就是它的出处。
- **本片自己被 CI 抓到的那一格与评审无关**：`QG Changes` 红在 `check-gate-record-debt.js` 的 `dupClosureRows`
  （一篇记录写了两个收口行）。判据 `addedRowLines > 0 && count > 1` 的意思想要防的正是"第二个块顺手补一行"，
  而我犯了它。已按红文案改成全篇一行，并在本篇第二个块留显式禁令。

### 7.1 第三轮留下、**刻意不在本片做**的两格（要人拍板）

- [ ] 7.1.1 **`MP_QM6_MAX_ROUNDS` 要不要设上限**：现在 `capOf` 只验"正整数"（`lib/ccg-review-rounds.js:93`），
  设 `99999` 即关闸。加不加 ceiling 属改"谁来守门"，且它防的是**操作者自己的额度**（每轮打印 `第 N/max`、
  账本受管 ⇒ 绕过在 PR diff 里可见），不是对外防御。默认动作：**不动**，交人工定。
- [ ] 7.1.2 **`assertChangeName` 要不要下沉进 `defaultLedger`**：目前只有 CLI 路径校验，
  库侧直接 import 的调用方会跳过（实测现无此类调用方：`grep -rn defaultLedger scripts/` 只有 CLI + 本测试 +
  入口注释三处）。下沉是零行为变更、零风险，但需要一条新锁；本片已到轮次上限，不为一条"当前不可达"的格子
  再开一轮改动。


