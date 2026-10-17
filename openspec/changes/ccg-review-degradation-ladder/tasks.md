# Tasks: ccg-review-degradation-ladder

> 垂直切片，每片可独立验收；勾选项必须同条附证据（PR 号 + 文件名/命令读数），未开始的一律留空。

## 1. 证据分级判据（示踪弹，先让它红）

- [ ] 1.1 `check-pr-exec-record.js` 新增 `classifyEvidenceTier(deepReview)`：命名后端 ⇒ `external`；`self-play` 前缀 ⇒ `self-play`；`null`/缺失/未知形态 ⇒ `unknown`
- [ ] 1.2 单测：三档各正反例（含 `performedBy: null` 不得被读成 external 的负控）
- [ ] 1.3 变异 M1（`null` 读成 `external` 必须指名红）
- [ ] 1.4 判据本体改为 `(status, tier)` 二元组：`external` 走现状、`self-play`/`unknown` 走新前提

## 1bis. 扫描域完整性（评审命中后追加，已落码 = PR #3777）

- [x] 1.5 `evaluateDeepReviewDebt` 纳入 D 方向：读 base blob 判被删记录当时是否已闭环；未闭环 dual ⇒ 欠账；取不到 base ⇒ 按「未证实」出声（不得读成通过）
- [x] 1.6 目录级判据 `REVIEWS_DIR_RE` + 内容谓词 `isReviewRecord()`：形态不认识但确是评审记录 ⇒ 点名出声（防下一次改名时扫描域静默缩到 0）
- [x] 1.7 接线锁：`main()` 必须三参数调用（M-G 反证）；`single`/已闭环/非记录三档不得误喊（M-C/M-F 反证）

## 2. 高危面清单与收口矩阵

- [ ] 2.1 `HIGH_RISK_SURFACES` 路径前缀清单（design §3 六类），每项**带实测出处**，清单只能缩小
- [ ] 2.2 判据本体自指：`scripts/check-*.js` + `.github/workflows/*` 命中即禁 `self-play` 收口
- [ ] 2.3 行为锁：非高危面 self-play+双前提 ⇒ 闭环；高危面 ⇒ 欠账；`unknown` ⇒ 一律欠账
- [ ] 2.4 变异 M2（摘掉自指前缀必须红）
- [ ] 2.5 `design §3` 的残余（跨面行为变更）写进记录遗留，不假装闭合

## 3. 降级资格以物证为准（接线已经在算的东西）

- [ ] 3.1 `ccg-review-decider.js` 把 `detectBackends()` 结果写入记录新字段 `backendAvailability`（现于 `:459-470` 已算出但未落盘）
- [ ] 3.2 判据只读 `backendAvailability` 判"不可用"，**不读 rc**、不读自述
- [ ] 3.3 接线锁：改回不落盘必须红（变异 M6）
- [ ] 3.4 计数分档：`0/1/2` 三档语义分离（1/2 与 2/2 不得长成一个样，沿用 `deep-review.sh:373-375` 的既有口径）

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
