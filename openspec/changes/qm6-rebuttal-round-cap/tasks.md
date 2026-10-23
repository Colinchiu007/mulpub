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
  计入等于白烧配额。**这是价值判断，§4.1 仍等人拍板**；原期望留在这一条的偏差说明里，不删。
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

## 2. 已否证清单（依赖 §0.2 的结论，可能要多一次 vendor 授权）

> **§0.2 实测结论已定：注入点不存在，必须改仓外引擎。** 因此本节一条未动，等人工授权后才能开工
> （另见 PR #4304 那份"零人工收口"规格——它已把"false-positive 复用 `rebuttals[]`、不另建登记"写进合同，
> 本节 2.1 的形状定义要与它对齐，不得各造一份清单）。

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

- [ ] 4.1 **轮次怎么算"一轮"**：只计"真外部调用"（含模型调用）？还是含"复用存档 critique"的短路重跑？
  本 change 现按前者（短路重跑零模型调用，不该消耗预算），但这是**价值判断**，不是事实——需确认。
  注意选错的后果很具体：若计入短路重跑，"填完裁决再跑一次"这种**必须的**动作会白烧配额。
  ⚠ 实现落完后暴露出当前口径的一处**已知松口**，请一并裁决（不要等下一次事故）：
  现在按 **sha 去重**，所以"同一个 sha 上反复真调模型"（不复用存档）也只算一轮。
  更严的口径是可用的：入口在动手前已经取了 `_wb_before` / `_wb_before_fp`（字节哈希 + 语义指纹），
  写回器正是靠它判 `no-new-delivery`——**把它借给轮次账**，就能区分"短路重跑（无新交付）"与
  "同 sha 又烧了一次额度（有新交付）"。代价是轮次账从"纯本地计数"变成依赖交付读数，
  且交付判定失败那一档要定"计还是不计"。选哪个由人定；两条都比"挂记录名"强。
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
