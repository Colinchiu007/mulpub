# tasks：changelog-record-carrier

> 顺序不是排班好看，是被两条硬约束逼出来的：
> ① **聚合器必须先存在**，禁改门禁才能落地——否则窗口内新条目无处可去；
> ② **禁改门禁必须先 advisory**，因为此刻在飞 35 个 PR 里绝大多数已经按旧写法改了 CHANGELOG，直接转 blocking 会把它们全部判红，而那不是它们的错。
> 引用本文件任何"在飞 PR 数 / 重复键数 / 提交占比"前一律现跑重取。

## 0. 前置取证（已在提案会话完成，结论落 proposal.md）

- [x] 0.1 冲突面归因：`git merge-tree --write-tree origin/main <pr-head>` 逐 PR 取冲突文件清单（实测 4/4 只撞 `CHANGELOG.md`，其中 1 个另撞 `learnings.md`，无第三类文件）
- [x] 0.2 确认无任何门禁要求「PR 必须改 CHANGELOG」（`Gate 2c3` 只判只可增长；`ci-pr-changeset.test.js` 只把该文件名当夹具用）⇒ 禁改门禁不与既有判据自相矛盾
- [x] 0.3 确认 `scripts/release-gate.mjs` 已要求 `## [v<版本>]` 小节存在 ⇒ 聚合器的天然接入点
- [x] 0.4 隔离 worktree 产物核对：`git worktree list` 命中 + `rev-parse --abbrev-ref HEAD` == `changelog-carrier-aggregate`，共享根 `main` 且 `status --porcelain` 0 行；起点已 `merge --ff-only` 到 `origin/main`（期间 main 前进了两次，未按 rc 决断）

## 1. records 携带两个可聚合小节（合同层，先写不改判据）

- [ ] 1.1 在 `openspec/records/` 的模板/说明里定义两个小节：`## CHANGELOG 条目`（必填）、`## learnings`（选填，存在即要求 `### lesson: <slug>` 形状）
- [ ] 1.2 定义**幂等键合同**：聚合产出条目标题 MUST 以 `（<record-slug>）` 结尾，`<record-slug>` 取 `openspec/records/<文件名>`，MUST NOT 取 `frontmatter.task`（那是一句中文长描述，会随改写漂移）
- [ ] 1.3 验收判据：拿 `origin/main` 现成的记录文件各跑一次解析，输出「识别到的小节名 + 取出块数 + 逐字节回写等于原文」自证；**必须包含一条负面**：正文里出现同名串（如引用规范原文提到 `## CHANGELOG 条目`）时不得被当成小节边界（禁令与存在性判据必须按语义位置切）

## 2. 聚合器 `scripts/aggregate-changelog.js`

- [ ] 2.1 实现：扫 `origin/main` 上已合并且带 `(#NNNN)` 尾注的提交所引入的 records（复用 `scripts/lib/merge-ledger.js`，MUST NOT 另写一份"哪些记录算已合并"的判断——那是第二份事实）
- [ ] 2.2 追加形态：新块插到文件顶部（沿用人类习惯），但写入者只有这一处；逐行保留各自行尾，禁止"探测多数派后统一回写"（本仓实测会造 26 行幽灵改动）
- [ ] 2.3 幂等：按 record 名判是否已落；同一 record 被搬运第二次 MUST 跳过且**出声**（`skip=…`），MUST NOT 静默
- [ ] 2.4 行为锁（`aggregate-changelog.test.js`，只 require node 内置模块）：
  - 真实 records 夹具走端到端（写→聚合→再聚合），断言第二趟产物字节等于第一趟
  - 反例：同一标题的两份不同 record MUST 各落一次（文本判据在此必错）
  - 反例：record 缺 `## CHANGELOG 条目` MUST 出声点名并跳过该条，MUST NOT 把整轮当成失败静默退出
  - 变异反证：把幂等键从 record 名退回标题文本 ⇒ 指名用例必须红（这条锁测的是"键的选型"，不是"函数存在"）
- [ ] 2.5 `--dry-run` 打印 `records=N 待搬=M 已落跳过=K 缺小节=X`，四个数全部可在一句话命令里重取

## 3. 禁改门禁 `scripts/check-no-hot-carrier-edit.js`（advisory 档）

- [ ] 3.1 判据按 **PR 差量** `merge-base..head` 取文件集，MUST NOT 按工作树/文件现状（否则 rebase 带进来的他人改动会被算到本 PR 头上）
- [ ] 3.2 命中 `CHANGELOG.md` / `01-docs/learnings.md` ⇒ 点名 + 给出正解（写进 records 的小节，不动这两个文件）
- [ ] 3.3 授权出口：本次差量**新增**的 `scripts/hot-carrier-write-authorization.json`，核对 `applies_to_base` 与实际 merge-base；base 已存在该文件 MUST NOT 生效（沿用 dedup 授权那条已验证形态，避免常驻通行证）
- [ ] 3.4 落点：`quality-gate.yml` 的 `changes` job，与 Gate 2c3 同步；首行 MUST 打印 `MODE=advisory|enforce`
- [ ] 3.5 接线锁 + 反向锁双向钉住：判据文件必须在 workflow 可执行正文里被点名（不是注释）；同 PR 更新 `.github/scripts/workflow-contract.test.js` 里 Gate 2c3 那条结构锁，否则它会把新形态判成违规
- [ ] 3.6 本机实跑：`node scripts/check-no-hot-carrier-edit.js --base=origin/main --head=HEAD` 对**当前这个 PR 自己**跑一次——本刀改了 CHANGELOG 吗？没有 ⇒ 应 PASS；若有 ⇒ 走授权出口并如实写理由

## 4. 发版接入 + 规范改写 + 转 blocking（独立一片，需人工过目）

- [ ] 4.1 `scripts/release-gate.mjs` 在版本小节校验之前调用聚合器；把"聚合器报错"与"版本小节缺失"分成两个退出码文案（合并成一句会让人去改 CHANGELOG 而不是修聚合器）
- [ ] 4.2 `AGENTS.md` 改写：删除「PR 里往 CHANGELOG/learnings 顶部插块」的既有口径，新增 records 小节模板；更新「多会话共用写面」清单，把这两个文件标注为"仅聚合器可写"
- [ ] 4.3 转 blocking：**前置条件 = 当场重取的在飞 CONFLICTING/UNKNOWN PR 数为 0**，或已逐个确认其差量不含热写面；不满足则本片不开
- [ ] 4.4 QM-6：本片命中高危面（`scripts/check-`、`.github/workflows/`），MUST 取 `tier=external` + 可核 `evidence`；后端不可得时按四档归因（ENOENT / 额度重置 / IP 封禁 / 403 额度不足）如实登记欠账，MUST NOT 用 `closureNote` 或自扮演冒充高危面闭合
- [ ] 4.5 收尾链：`gh pr view --json mergeable` + `gh pr checks` 双绿后自动合并；合并后按 AGENTS 第 6 条回读该 merge SHA 的 main push run，读数写 PR 评论（不回写仓库文件）

## 不在范围（写明以免被"顺手"扩进来）

- 存量 1061 条 / 6.4 MB 历史与那批重复标题键的清理（需另立一片，且必须在本刀之后）
- `changelog.d/` 分片化历史
- 提前摘除 `check-branch-merged.js` 的共用写面登记（顺序错误 ⇒ 收尾判据退回整文件比较，是已实测的假阳性来源）
