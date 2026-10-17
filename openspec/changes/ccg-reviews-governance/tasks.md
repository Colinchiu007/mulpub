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

- [ ] 7.1 `ccg-record-ledger.js` 的 `pickRecord`（HEAD / HEAD^ / merge-base 三候选按 **sha 文件名** 找）
  对新提交**永远找不到记录** —— 名字已经不是 sha 了。必须改成先算本次变更集的内容键、再按键取文件，
  且哈希配方 MUST 与 decider **逐字同源**（`git diff … --no-textconv --no-ext-diff --no-renames -- . ':(exclude).ccg'`）；
  直接 require `ccg-review-decider.js` 导出的 `recordFileName`，不要在写入侧再抄一份判据。
  sha 命名那三条候选只作为**存量记录的回落档**保留（与判据的双读同一逻辑）。
- [ ] 7.2 D13「借用他人裁决」这格**大部分被上游天然消解**：内容键由本次 diff 决定，
  重提交/amend 收敛到同一个名字 ⇒ 不再是"跨会话撞名"。`stagedDiffHash` 同源校验降级为
  「键算不出来时不得猜」的兜底，而不是主判据。设计文档 D13 与失败模式表要按这个口径改，
  不得留着"我发明了这道校验"的叙述。
- [ ] 7.3 我在 `deep-review.sh` 里加的 `--locate` 早退接管段与上游的 fail-closed 段**语义重叠**：
  解冲突时必须保留上游那一档（含 `_DIFFLINES > 0 ⇒ exit 1`）并把 `--locate` 接在它之前，
  两者并存；**不得**用我这版整块替换掉上游的 exit 1 逻辑 —— 那会把一个已修掉的 fail-open
  重新放回生产路径（上游注释里写明了它是怎么被发现和修掉的）。

- [ ] 7.4 待复算的数：origin/main 上 `.ccg/reviews` 现在同时存在 `<64hex>.json` 与 `<sha>.json` 两种命名，
  刀 2 的"一次性 `git rm --cached` + 引用面解析门禁"必须两种都覆盖（`AUDIT_ARTIFACT_RE` 是否已放宽到 64hex 要先量）。
