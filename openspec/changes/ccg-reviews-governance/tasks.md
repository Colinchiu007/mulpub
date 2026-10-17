# Tasks — ccg-reviews-governance（刀 1：判据换源 + 双读兼容 + 防伪锚）

## 1. 判据（scripts/check-pr-exec-record.js）

- [x] 1.1 台账字段解析（复用既有 frontmatter 解析器，不写第二份）
  证据：`parseFrontmatterFields` / `findCcgLedger` / `CCG_LEDGER_KEYS`，`scripts/check-pr-exec-record.test.js` 用例「刀1：记录文件带闭环状态与合法证据锚…」
- [x] 1.2 新源优先：台账存在即接管，json 不得反过来掩盖
  证据：用例「刀1：新源优先 —— json 已 cleared 但记录文件未闭环 ⇒ 必须红」；变异 M11（json 闭环即跳过台账）实测 CAUGHT
- [x] 1.3 双读一周期：无 `ccg_*` 字段时旧 json 语义逐字不变
  证据：用例「刀1 兼容：无记录文件的存量 PR 仍按旧 json 判」「存量 PR 的 json 已闭环 ⇒ 0 欠账」；变异 M9 实测 CAUGHT（红 7 条）
- [x] 1.4 防伪锚三格：闭环白名单 / 证据 URL / 载荷哈希重算
  证据：用例「缺外部证据锚」「fail-closed —— 未知状态词与非法证据 URL」「载荷不符」；变异 M1 实测 CAUGHT（红 7 条）
- [x] 1.5 base 口径纠正（本 PR 自引入缺陷）：判据一律用**锚里记录的 sha** 重算，`makePayloadSha` 不再接收调用方 base
  证据：用例「重算载荷必须用锚里记录的 base」「台账缺 ccg_payload_base」「写成 ref 名 ⇒ 红」；变异 M2/M3 各实测指名红 1 条

## 2. 单一实现（scripts/lib/ccg-evidence-hash.js）

- [x] 2.1 载荷 = `git diff <base> <head> -- . :(exclude)openspec/records :(exclude).ccg/reviews`
  证据：`scripts/lib/ccg-evidence-hash.test.js`「载荷必须排除…」（负控 + 正控）；变异 M7（摘掉 excludes）实测 CAUGHT
- [x] 2.2 `resolveBaseSha` / `assertPayloadNonEmpty` / `EVIDENCE_URL_RE` / `LEDGER_FIELDS` 收在一处
  证据：用例「resolveBaseSha…不得返回空串」「assertPayloadNonEmpty：0 字节必须抛」「EVIDENCE_URL_RE 必须认 gh pr comment 的真实产出」；变异 M4（URL 允许无片段）实测 CAUGHT（红 3 条，跨判据与写入侧两个文件）
- [x] 2.3 `upsertFrontmatterFields` 按行 splice、逐行保留自身行尾、幂等
  证据：用例「只动目标键…幂等」「CRLF 夹具必须保持 CRLF」「没有 frontmatter/未闭合 ⇒ 拒绝写入」

## 3. 写入侧（scripts/ccg-record-ledger.js + scripts/deep-review.sh）

- [x] 3.1 收口顺序锁：贴评论（并读回）成功 ⇒ 才写台账字段
  证据：`scripts/ccg-record-ledger.test.js` W4（两种失败形态分开测，含「stdout 带合法 URL 但 ok=false」）、W7（calls 顺序必须 `post` 先于 `write`）；变异 M5（`if (!posted.ok)` 改恒假）实测指名红
- [x] 3.2 资格门禁：非 dual / 未闭环 / `required!==true` / 空载荷 ⇒ 不落
  证据：W1/W2/W3/W11；变异 M10 实测 CAUGHT
- [x] 3.3 禁止伪造 URL：读回不成立即放弃写入（W5 三格）
- [x] 3.4 `deep-review.sh` 保留引擎裁决码为退出码，收口失败只出声
  证据：`sh -n` 通过；`scripts/deep-review-deps.test.js` 13 例全绿（改动尾段后必须跑）
- [x] 3.5 字段清单双向对账
  证据：W10（正向键集相等 + 临时给 lib 清单加一项必须抛）
- [x] 3.6 寻址补第三候选 `merge-base`（多提交分支的真实形态，同一 PR 内跟进修复）
  证据：W12 分格测 `HEAD > HEAD^ > 分支起点` 三候选 + ref 名不当候选 + 全落空时如实列 `tried`；变异 M12（摘 baseSha 候选）与 M13（摘 `HEAD^` 候选）**各自**让 W12 的不同断言变红 —— 只测 baseSha 那一格时 M13 首跑没抓到，据此补 ② 而不是当成"已覆盖"
- [x] 3.7 文档口径：执行记录里不得写本机绝对路径（CI Gate 12c 实测判红后改相对形态）
  证据：`node scripts/check-doc-abs-paths.js --base=<merge-base> --head=HEAD` → `PASS…无新增本机绝对路径`；修法取「改文档」而非「调大账本」（该判据**不问存在性**，存在也计入新增）

## 4. 接线与自证

- [x] 4.1 Gate 2b4（`changes` 作业，`shell: bash`）点名两份新测试
  证据：`node .github/scripts/check-workflow-structure.js` → files=14 violations=0；`node scripts/check-step-failfast.js` → 38 个多命令步骤全 fail-fast；`node scripts/check-unwired-tests.js` → 域内 92 个测试文件全接线
- [x] 4.2 `.gitignore` negation（第 106 行 `scripts/*.js` 会静默忽略新建脚本本体）
  证据：`git check-ignore --no-index -v scripts/ccg-record-ledger.js` → 改前命中 106、改后 rc=1
- [x] 4.3 全量回归：判据 61 / lib 11 / 写入侧 12 / decider 19 / spawn 预算 14 / deep-review-deps 13 全绿
- [x] 4.4 变异反证 24 条（第一轮 13 + 第二轮 11，逐条见执行记录）
- [x] 4.5 QM-6 内部模拟评审两轴处置（见 §6），全部 CAUGHT 且各自指名（表见执行记录）

## 5. 刀 2 / 刀 3 —— 本 PR **故意不做**（欠账，须人工过目）

- [ ] 5.1 `.gitignore` 加 `.ccg/reviews/**` + 一次性 `git rm -r --cached .ccg/reviews`
  为什么不在本 PR：这一刀改的是「谁来守门」——它把判定记录从受管审计面移出，且必须与「引用面解析门禁」同时落地，否则钩子里按 blob 读主干那份判据的逻辑会失去读者。按 AGENTS.md「推进需要改动守门面的 PR 一律人工过目、不 agent 自动合并」。
- [ ] 5.2 常驻清理节拍与保留窗口（保留多少天 / 按什么判据淘汰 / 淘汰前留证到哪）
  未决点：保留窗口取「主干 tip 的祖先链上仍被引用」还是「固定 N 天」尚未取证；先用 `git log --all -S` 量一次「历史上被引用过的记录占比」再定，不得拍脑袋。
- [ ] 5.3 跨会话撞名防护（同名 `<parent-sha>.json` 静默覆盖）
  正解候选：文件名加入写入方标识，或写入前做 blob 比对并在覆盖时出声。**必须先证明判据不依赖文件名字面量**（`resolveRecord` 按 HEAD/HEAD^ 寻址，改命名会同时打断判据与收口两处）。

## 6. QM-6 内部模拟评审（外部后端未登录期间）——逐条处置

两轴独立评审（后端轴 / 集成轴，均为无会话历史的新上下文），判词都是**不可合并**。下表是「接受 / 否证回去 / 如实标注」三档，全部带复现命令。

- [x] 6.1 C1 手造闭环（接受）：台账四值可离线导出 → 加「两源一致 + provenance 否决」；反转被我钉成预期行为的那条用例，并补两源一致正控（防新判据恒红）。
- [x] 6.2 C2 diff 配置漂移（接受）：`-c` 钉参 + 注入式回归锁；两条我自己放错的坑（`--no-ext-diff` 位置、`os.devNull` 在 MSYS 下失效）单独否证并写回设计。
- [x] 6.3 R2-C1 shell→node argv 边界（接受）：`--base <值>` 被读成 true ⇒ 写入侧生产路径从未跑通。修 + W16 真进程锁 + W17 结构锁。
- [x] 6.4 I6 head 未钉（接受）：新增 `ccg_payload_head` 并由判据核对。
- [x] 6.5 I2/I3 借用他人裁决（接受）：起点候选必须过 decider 同口径 `stagedDiffHash`；`--locate` 把寻址收敛成单一实现，shell 只消费结论。
- [x] 6.6 I4/I5 行尾统一回写（接受）：逐行 splice + 混合行尾夹具（旧夹具把 `cr===lf` 当期望，反而保护了错误行为）。
- [x] 6.7 I1/I7 文档失真（接受）：advisory 档如实标注为「本地 enforce + CI 可见」；「重跑不重做模型审查」被代码否证后撤回。
- [x] 6.8 台账只认本分支（接受）：三层独立守卫；**如实标注**单退一行的变异 NOT-CAUGHT（防御重叠不可分辨），三行同退才由 M18c 指名变红。
- [ ] 6.9 **仍未闭合**：跨家族外部双模型评审（`claude` 未登录）。内部模拟替代的是第二双眼睛，不是跨家族独立性 —— 待 `/login` 后补跑，逐条处置回填 QM-6 格。
- [ ] 6.10 集成轴列为 Minor 但未做的三项：评论正文与台账 sha 的 GH 侧存在性核验（判据不联网，属刀 2 之后的增强）、`--no-verify` 之外对 hook 失败路径的可视化、`CCG_LEDGER_KEYS` 与 `LEDGER_FIELDS` 的显式 parity 用例（现由派生实现保证，行为面缺一条独立断言）。

## 7. 合并前必须先吸收的上游变更（2026-10-17 rebase 实测，**不得按文本冲突挑一边解**）

上游 `ccg-record-content-addressing` 已落地：判定记录文件名从 `<父sha>.json` 改成
**`<stagedDiffHash 64hex>.json`**（暂存 diff 排除 `.ccg` 的 sha256；为空时才回落 `<sha>.json`），
且 `deep-review.sh` 在「按内容寻址没命中」时改为 **fail-closed exit 1**（旧版是无条件 exit 0）。

对本篇的三处直接影响（逐条都是前提级，不是行级）：

- [x] 7.1 `ccg-record-ledger.js` 的 `pickRecord`（HEAD / HEAD^ / merge-base 三候选按 **sha 文件名** 找）
  对新提交**永远找不到记录** —— 名字已经不是 sha 了。必须改成先算本次变更集的内容键、再按键取文件，
  且哈希配方 MUST 与 decider **逐字同源**（`git diff … --no-textconv --no-ext-diff --no-renames -- . ':(exclude).ccg'`）；
  直接 require `ccg-review-decider.js` 导出的 `recordFileName`，不要在写入侧再抄一份判据。
  sha 命名那三条候选只作为**存量记录的回落档**保留（与判据的双读同一逻辑）。
  **已落（2026-10-17）**：`pickRecord({repo, commits})` 按 `base..HEAD` 自有提交展开，每个提交探三种名
  （内容键名 / `<c>.json` / `<parent>.json`），取名直接 require `ccg-review-decider.js` 的 `recordFileName`；
  键配方 = `git diff --no-textconv --no-ext-diff --no-renames <parent> <c> -- . ':(exclude).ccg'`（**父在前**），
  无父提交时改 `git show --format=`。证据：`scripts/ccg-record-ledger.test.js` 的 §7-T1…T5；
  先见证红实录 —— T1/T3/T5 三条在旧实现上红（T1 现场输出 `LOCATE none missing`），改完 180 passed / 0 failed。
- [x] 7.2 D13「借用他人裁决」这格**大部分被上游天然消解**：内容键由本次 diff 决定，
  重提交/amend 收敛到同一个名字 ⇒ 不再是"跨会话撞名"。`stagedDiffHash` 同源校验降级为
  「键算不出来时不得猜」的兜底，而不是主判据。设计文档 D13 与失败模式表要按这个口径改，
  不得留着"我发明了这道校验"的叙述。
  **已落**：design.md 的 D13 改为「候选只走自有提交 + 记录自报 sha 核对 + 算不出键就不猜」，原口径连同
  那版实现的**两处错误**（rev 写成反序、缺三个 diff 行为旗标 ⇒ 校验恒判不同源，而 175 条用例全绿因为
  夹具把 claimed 哈希喂成实现自己算出的值）一起写进「曾被否证」第 6 条；新增 D14（形态定义权在生产方）；
  失败模式表改 1 行、加 2 行；spec.md 那条 Scenario 换成两条（自有提交集合 + 生产方文件名双侧共认）。
- [x] 7.3 我在 `deep-review.sh` 里加的 `--locate` 早退接管段与上游的 fail-closed 段**语义重叠**：
  解冲突时必须保留上游那一档（含 `_DIFFLINES > 0 ⇒ exit 1`）并把 `--locate` 接在它之前，
  两者并存；**不得**用我这版整块替换掉上游的 exit 1 逻辑 —— 那会把一个已修掉的 fail-open
  重新放回生产路径（上游注释里写明了它是怎么被发现和修掉的）。
  **已落**：上游的 A/B 自检文案、三条查找路径与 `_DIFFLINES > 0 ⇒ exit 1` 全部保留；`--locate` 接在它们之前，
  命中即设 MODE、拒绝借用则置 `_LOC_REJECTED` 并在诊断块里分流文案 —— 不让「有一份记录但核不上」与
  「从没跑过判定器」共用一句话（与上游 `_READ_FAILED` 跳过诊断块是同一条纪律）。dry-run 分支同时保留上游
  新增的 `DRY_NO_DRIVER` 早退。`bash -n scripts/deep-review.sh` 通过，行尾仍纯 LF（cr=0）。

- [x] 7.4 待复算的数：origin/main 上 `.ccg/reviews` 现在同时存在 `<64hex>.json` 与 `<sha>.json` 两种命名，
  刀 2 的"一次性 `git rm --cached` + 引用面解析门禁"必须两种都覆盖（`AUDIT_ARTIFACT_RE` 是否已放宽到 64hex 要先量）。
  **已量（2026-10-17，origin/main）**：853 份 = 40hex 770 + 64hex 69 + alt（64hex 前缀）1 + 手工命名 13。
  `AUDIT_ARTIFACT_RE` 已放宽到 40|64 ✅，**但 alt 的时间戳段与生产方不同源** —— 上游按想象的
  `\d{8}T\d{6}(\.\d{1,3})?Z` 写，而 `saveRecord` 用的是 `toISOString().replace(/[:.]/g,"")`，真形态是
  `2026-10-17T025039620Z` ⇒ 现场那唯一 1 份 alt **不被接受**，钩子把它 stage 进纯回填提交就会判「夹带」假红；
  它的行为探测（`auditAcceptedAltForm`）与正则共用同一张想象候选表，所以探测自洽地报「已覆盖」。
  本 PR 一并修（放宽 + 候选表登记真形态），锁 §7.4-A（真调 saveRecord 取返回名）+ §7.4-B（六条逐位负控）。
  刀 2 的范围据此扩写：引用面必须覆盖**四种**形态（40hex / 64hex / 64 前缀 alt / 40 前缀 alt —— 后者由空 diff
  的回落名经同一分支产出，现场 0 份但生产方可达），且 13 份手工命名不属于钩子产物、不得收进白名单。
## 8. 外部双模型评审的处置（2026-10-17，凭据恢复后补跑，非内部模拟）

上游 #3755 之后重跑 `sh scripts/deep-review.sh`：`critic=claude` 真跑出 8 条问题、四维最低分 4；
引擎走 `self_play` 出口后要求逐条裁决，其中 **crypto 域 2 条不允许自扮演豁免**。

- [x] 8.1 i4（Warning，`--locate` 分支把 64hex 内容键当 `--sha` 交给引擎）—— **upheld，已修**。
  先写行为锁再修：§7-T6 首跑红在「实得 aa64f478…（64hex）」，修后绿；变异 N4 把那一行加回 ⇒ §7-T6 指名红。
  证据：`scripts/deep-review-deps.test.js` §7-T6（真跑 `deep-review.sh --dry-run` + 桩引擎打印 argv）。
- [x] 8.2 自己撞上的第二格（i 系列之外，评审后才发现）：`ccg_payload_head` 逐字相等是**不可满足判据** ⇒ 改「自身或祖先」。
  三把锁：§8 正控（真 git 仓库，落锚那笔只动排除面 ⇒ 必须判闭环）/ §8 负控（旁支提交 ⇒ 必须仍红）/
  §8 连坐禁止（`isAncestor` 恒真时载荷那一格必须独自挡住）。变异 N1/N2/N3 各自指名红。
- [x] 8.3 i1 / i2 / i5 逐条复核后 **dismissed（被夸大）**，理由可证伪：见 design D9/D12 与执行记录「§8 外部评审逐条处置」行。
  其中 i2 由**外部模型**给结论（claude 读码后判「不成立」，逐条点了行号：载荷实算比对在 check-pr-exec-record.js:672-677），
  不是我自己给自己背书；i5 的第一次外部探针 opencode **跑完零交付**（回了一句「请提供需要审查的主张内容」），
  这是本仓记过的"跑完但没交付"的又一种形态，处置是换后端重问而不是把沉默读成通过。
- [ ] 8.4 未做（留人工裁决）：把 `ccg_evidence` 从形状判据升级成真联网核验。判据跑在 CI 的 `changes` 作业
  （无 Install deps、无 gh 认证上下文），要做必须先决定"核验失败"算红还是算跳过 —— 后者就是把洞换个写法。
