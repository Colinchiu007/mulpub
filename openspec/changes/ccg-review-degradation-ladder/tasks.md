# Tasks: ccg-review-degradation-ladder

> 垂直切片，每片可独立验收；勾选项必须同条附证据（PR 号 + 文件名/命令读数），未开始的一律留空。

## 1. 证据分级判据（示踪弹，先让它红）
- [x] 1.0 普查主干 827 份产物形态（performedBy 34 种散文取值 / status×mode 交叉 / findings 形状），结论写进 design §9 与 §9.1。普查脚本**已入库**：`node scripts/ccg-artifact-shape-survey.js [--ref=origin/main]`（覆盖面数字必须能在仓库里一句话重取，不得留成孤立读数；数字随主干增长漂移，引用时现跑）

- [x] 1.1 分级读结构化 `deepReview.tier`（闭集 `external|self-play|none`，其余一律 `unknown`），MUST NOT 读 `performedBy` 散文。外部档成立 = `tier===external` **合取** `evidence` 非空串；`findings` 为空不影响成立。**已落码**：`check-pr-exec-record.js` 的 `classifyEvidenceTier` + `ccg-review-decider.js` 的 `buildDeepReviewInit`（新记录初始化 `tier:"unknown"` / `evidence:null`）。反证 M-T1/M-T2/M-T3 各自指名红
- [x] 1.2 覆盖率只可见不拦：`summarizeTierCoverage()` 出 `TIER-COVERAGE dual-closed total=…` 行，空集也打印；`main()` 经 `dualClosedDeepReviews()` 接线。反证 M-T4（空集不打印）与 M-T5（接入拦截）各自指名红
- [x] 1.3 变异反证：本片新增 5 条（M-T1…M-T5），与切片A 的 7 条合计 **12/12 CAUGHT、escaped=0、anchorfail=0**，基线 108 passed / 0 failed。M-T5 首版探针扎错位置（`ok=false` 塞在 `if(!tierLinePrinted)` 内，而 `--no-remote` 路径返回的是 `r2`）⇒ 实测红=0；改探针到"每次调用都置 ok"后才指名红 —— 记这条是因为**"NOT CAUGHT"有两种含义**：锁无牙，或探针没扎到判据生效的那一支
- [ ] 1.4 判据本体改为 `(status, tier)` 二元组：`external` 走现状、`self-play`/`unknown` 走新前提

## 1bis. 扫描域完整性（评审命中后追加，已落码 = PR #3777）

- [x] 1.5 `evaluateDeepReviewDebt` 纳入 D 方向：读 base blob 判被删记录当时是否已闭环；未闭环 dual ⇒ 欠账；取不到 base ⇒ 按「未证实」出声（不得读成通过）
- [x] 1.6 目录级判据 `REVIEWS_DIR_RE` + 内容谓词 `isReviewRecord()`：形态不认识但确是评审记录 ⇒ 点名出声（防下一次改名时扫描域静默缩到 0）
- [x] 1.7 接线锁：`main()` 必须三参数调用（M-G 反证）；`single`/已闭环/非记录三档不得误喊（M-C/M-F 反证）

## 2. 高危面清单与收口矩阵

- [x] 2.1 `HIGH_RISK_SURFACES` 路径前缀清单（design §3 六类），每项**带实测出处**，清单只能缩小
     - **已落码（分支 `qm6-highrisk-matrix`，`scripts/check-pr-exec-record.js`）**：清单 **9 条**而非六类 —— design §3 那六类是当时的分类，落到路径后「凭证 / 登录态 / 判据本体 / 判定写入方 / 评审驱动 / workflows / 指纹」各成一格，逐条带 `git ls-files` 实测命中数（3/1/18/1/9→7/15/100/3/2；`fingerprint` 那条在第 2 轮加了 `exts` 限定，raw 9 里 2 份是取证 txt，归因后 7）。**归因一律走判据自己的 `highRiskPrefixOf`**，。匹配实现只有一份 `highRiskPrefixOf`（`isHighRiskSurface` 与 `highRiskHits` 都走它，由用例 `2.1 单一匹配实现` 锁住；成因见本篇 §二变异层）。反装饰：用例逐条断言前缀在主干命中 ≥1 个受管文件，命中 0 即红（变异 P5 实测指名红）。
     - **前置取证已完成（design §9.2）**：清单**不得**实现成回读产物的 `stats.sensitivePathHits`（主干实测非空仅 2/877 ⇒ 构造性零），必须对 `changedFileStatuses` 现算；内容命中轴（217/877）只作旁证出声、不作闭环资格。
- [x] 2.2 判据本体自指：`scripts/check-*.js` + `.github/workflows/*` 命中即禁 `self-play` 收口
     - **已落码**：矩阵分支 —— 变更集命中任一高危面前缀 ⇒ `closureCorroboration` 只认 `external`，`self-play` / `external-unverified` 判不成立并在文案里点名是哪条前缀。自指由用例 `2.2 自指` 钉住四个方向（判据本体 / 判定写入方 / workflows / credential 必须判高危；未登记前缀必须判**不**高危，防止靠加词放宽）。
- [x] 2.3 行为锁：非高危面 self-play+双前提 ⇒ 闭环；高危面 ⇒ 欠账；`unknown` ⇒ 一律欠账
     - **已落码（含一处对合同的有意偏差，必须写明）**：`2.3 矩阵①②③` 三条用例分别钉「高危面 + self-play ⇒ 红并点名」「高危面 + 真外部出处 ⇒ 放行（矩阵不得把外部评审一起拦掉）」「`tier=none` 却写闭环值 ⇒ 任意面都红」。
     - **偏差**：原合同第三句 `unknown ⇒ 一律欠账` **按字段形态拆成两档**，没有整句照抄。理由与实测都在下面：① **字段缺席**（没写 `tier`，或生产方给新产物写的初始值 `unknown`）⇒ **不拦**。按字面实现会当场造出**无法闭合的循环**（与缺陷G「对 single 也要求闭环」同型）：判定器对新产物初始化 `tier:"unknown"`，而它只有跑过真外部评审才翻成 `external` —— 于是「改判据 ⇒ 必须先跑完外部评审才能提交 ⇒ 提交又生成一条新的 unknown 产物」。当场量得主干 142 篇已闭环产物里 **139 篇整字段缺席**，一刀收紧就是 139 篇的形状（测量见记录 §七）。② **字段在而值不认识**（拼错的 `External`/`extrenal`、数字、对象）⇒ 新增 `unrecognized` 档，**不分面一律拦**。后端轴 Critical#2 指出的绕行路径正是把这两档合成一档：删掉 `tier` 或写成 `external `（尾随空格）就掉进 unknown 被放过。现在空白先归一（`external ` 按 external 走 evidence 校验），野值单独成档必红；而存量里这一档实测是 **0 篇**（`{external:1, unknown:28}`，无野值）⇒ 拦得住伪造又不误伤历史。三条锁分别钉这三格：`2.3 边界（不可闭合循环负控）`（非高危面缺席不拦 —— 第 2 轮 R2-2 指出「高危面 + A 新增即闭环 + 无 tier」是零成本后门，那一档现在**拦**，由 `第2轮R2-2` 钉）、`2.3 边界（不过拦负控）`（非高危面 self-play 不拦，欠账交给 4.x 的货币判据）、`评审C2` + 变异 P9/P15（野值必须红、空白必须归一）。转拦前提仍是 unknown 占比降下来 —— 而占比要降先得有写入方（8.1b）。代价登记在记录 `openspec/records/qm6-highrisk-matrix.md` §六 第 9 条与 §七。
- [x] 2.4 变异 M2（摘掉自指前缀必须红）
     - **已实跑，且比原计划严**：编号在本片改叫 P1/P6（同一驱动里逐条编号，见记录 §四 的七行表）。P1 = 唯一匹配实现恒返回 `null` ⇒ **三条**指名红（`2.2 自指` + `2.3 矩阵①` + `8.1 转变②`）；P6 = 把前缀匹配在 `highRiskHits` 里再抄一份（行为逐字不变）⇒ 只有 `2.1 单一匹配实现` 那条结构红。P1 首版只红 1/3（PARTIAL），暴露的就是"两处各抄一遍"，收敛成单一实现后才 3/3。全套 7 条 `escaped=0 anchorfail=0`、还原逐条 md5 一致。

- [x] 2.5 `design §3` 的残余（跨面行为变更）写进记录遗留，不假装闭合
     - **已登记**：记录 `openspec/records/qm6-highrisk-matrix.md` §六 第 1 条写明「行为变更发生在非高危路径却改变高危面语义 ⇒ 前缀匹配结构性看不见」，并给出可收窄方向（按被高危面文件 require 的模块反查一跳）与为什么本片不做（需要依赖图 + 会引入假阳，属改「谁来守门」）。

## 3. 降级资格以物证为准（接线已经在算的东西）

- [x] 3.1 `ccg-review-decider.js` 把 `detectBackends()` 结果写入记录新字段 `backendAvailability`（现于 `:641` 已算出但未落盘）⇒ 已落 `summarizeBackendAvailability()`，`saveRecord` 第 5 参数可注入（默认自探）
- [ ] 3.2 **未做，别当成已闭环**：判据侧还没消费 `backendAvailability` —— 现在它只是"被记录",不构成降级资格判据。落盘≠接线到判据，这一格留给「高危面矩阵」那片一起落（tasks 2.x）
- [x] 3.3 接线锁与反证：改回不落盘必须红 ⇒ 变异 M-B1（摘掉落盘字段）指名红；另有 M-B2 计数塌成布尔、M-B3 摘掉缺省探测、M-B4 调用点漏传 backends，四条各自指名红、escaped=0
- [x] 3.4 计数分档：`count` 为 0/1/2 且 `partial=(count===1)`，`notDeepStrictEqual(two, one)` 钉死「1/2 与 2/2 不得同形」（沿用 `deep-review.sh:373-375` 既有口径，不另造词汇）

- [ ] 3.5 失败形态分档：`不可达`（wrapper/后端解析失败）／`可达但交付无效`（rc=0 且 findings 数组解析不出或条数为 0）／`证据不足`（评审自述被截断）三档各给不同出口，**一律不得取 rc 判**（2026-10-17 实测：同一轴三次 rc 全 0、载荷全非 findings）

## 4. 机械对抗产物作为降级货币

- [ ] 4.1 校验变异驱动 json：`escaped === 0`（缺字段即不合格，变异 M4）
- [ ] 4.2 变异条数下界 `>= 2`
- [ ] 4.3 产物路径必须存在且在本 PR 变更集内可寻（变异 M3：只判字符串非空必须红）
- [ ] 4.4 失败用例名一律取 `assertionResults[].fullName`（既有教训：键名写错会恒 0）

## 5. 可重开欠账与棘轮

- [ ] 5.1 记录文件 frontmatter 三字段：`deep_review_status: fallback_closed` + `deep_review_backfill_owner` + `deep_review_backfill_reason`
- [ ] 5.2 判据：降级收口必须带这三字段；缺任一 ⇒ 欠账
- [ ] 5.3 outstanding 计数棘轮（只可缩小 + 每次 Gate 出声），**不碰** `gate-record-debt-ledger.json` / `.quality-gates.md`（旧载体冻结，加块即 `carrierDrift` 红）
- [ ] 5.4 销账与补跑外部评审**同一次提交**发生（沿用 sync_* 的口径）
- [ ] 5.5 变异 M5（棘轮改"只打印不判"必须红）

## 6. 接线与文档同步

- [ ] 6.1 新增 `*.test.js` 逐个显式点名进 `quality-gate.yml`（Gate 2b/2c），由 `check-unwired-tests.js` 兜
- [ ] 6.2 `openspec validate --strict` 通过
- [ ] 6.3 AGENTS.md：把 #3747 那条 ⚠️ 改写为矩阵引用，删除"本门禁未镜像它"这句将过时的事实
- [ ] 6.4 执行记录 `openspec/records/ccg-review-degradation-ladder.md` 两形态同写

## 7. 自反条款验收（本片的特殊约束）

- [ ] 7.1 判据本体属高危面 ⇒ 本 PR **不得**以 `self-play` 收口 QM-6；记录里必须写真实证据档或"未执行"，**不得**出现"降级已建立且本 PR 用它收口"
- [ ] 7.2 本 PR **不自动合并**，一律人工过目（改"谁来守门"）

## 8. QM-6 命中登记（2026-10-17，两轴经直呼 CLI 交付；处置明细见 `openspec/records/ccg-deg-evidence-tier.md`）

- [ ] 8.1 **闭环值只能由工具写，不能由会话手写**（后端 B0/B1 + 前端 F1，实测：四种伪造 `cleared` 全部被接受，含 `evidence:"x"`）：`deep-review` 交付时才写 `tier:"external"` + 可核 `evidence` + `findings`；判据侧对「M 状态、base 非闭环 → head 闭环，而本次变更集没带任何外部评审产物」必须点名——`readAtBase` 已具备该能力，缺的只是把它用到转变检测上。**A 状态凭空伪造在判据层不可判**（除自述外无对象可核），只能由「写入方收敛到工具」+ 事后抽查承担，登记而不假装已闭合
     - **半片已落（判据侧）**：分支 `qm6-highrisk-matrix` 落的是 `readAtBase` 用到转变检测那一半 —— 用例 `8.1 转变①②③` 三条指名红（无出处收口点名 / `closureNote` 在非高危面放行而高危面仍拦 / base 取不到计入「未证实」读数），变异 P2、P4 各自指名红。
     - **另一半仍未做，本条因此不勾**：`tier:"external"` + 可核 `evidence` + `findings` 目前**仍由会话手写进产物**。当场核实（2026-10-19）：引擎在仓外用户技能目录 `~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js`（`deep-review.sh:531-533` 的三级候选路径里，仓内 `scripts/ccg-deep-review.js` 那份**不存在**），全文 `tier` 出现 **0 次**、只写 `status:` 与 `performedBy:`（`grep -na 'status:' ` 现场 12 处，含 `self_play_resolved`/`self_play_pending`/`skipped_by_mode`）；`scripts/deep-review.sh` 里 `tier`/`evidence` 同为 0。所以「A 状态凭空伪造」这条缺口原样存在，且本片自己就是它的现场 —— 本 PR 收口那条 `dual` 产物时写的 `tier`/`evidence` 也是手写的。
- [ ] 8.1b 闭环值写入方收敛到工具：交付时才写 `tier:"external"` + 可核 `evidence` + `findings`，判据侧对手工改成闭环值的 A 状态产物至少出声点名"由会话手写"。**落点在仓外**（`~/.claude/skills/.../ccg-deep-review.js`，或把引擎收进仓内再改），因此这一条不是本仓单 PR 能闭合的 —— 要么先解决引擎归属（vendoring 决策，属人工过目），要么在判据侧加「写入方指纹」的替代物证。
- [ ] 8.2 `summarizeTierCoverage` 增 `corrupt=N` 独立计数（后端 B3 的观察半边；归因已由「解析不动即点名」覆盖，此项只是趋势可见性）
- [ ] 8.3 `ccg-review-decider.js` 的 `main()` 处理 `saveRecord` 的 null 返回 ⇒ 退出码与副作用一致，不以裸栈收尾（前端 F4：错误文本已先打印，属 fail-loud 不是假绿，但 rc 层级被裸栈掩盖）
- [ ] 8.4 普查工具加 `require.main === module` 守卫；`parseFail` 拆成 `missing` 与 `unparsed` 两计数分别打印（前端 F5，与本会话自己踩的「json=0 是探针失明不是测量」同一条）
