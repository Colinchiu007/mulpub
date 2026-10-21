---
record: qm6-design-crossfamily-r2
task: 跨家族那一轮（critic=codex，8 条 / Critical 3）的处置落进 qm6-closure-writeback 的 design / proposal / spec / tasks
date: 2026-10-21
---

## 本次执行记录：跨家族设计评审处置（qm6-design-crossfamily-r2，2026-10-21）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯规格：`openspec/changes/qm6-closure-writeback/{design,proposal,tasks,specs/**}.md` 四份修订，零代码。worktree 由正规入口 `start-mp-task.ps1 -TaskName qm6-design-crossfamily-r2 -NoDeps` 建成，起点 `ca3825584`（`origin/main` 同值），工作树 0 脏项；判据取产物不取 rc |
| 为什么换了后端 | ✅ | 副本 A/B 两次都被同一格挡住：`taskPrompt = 祈使头 + <plan> + 方案 + </plan> + critiqueJSON + 作业/schemaHint`，`total = plan + critiqueJSON + 固定段`。**固定段两轮都是 1887**（可复现：`8082 − 3282 − 2913`；`9330 − 5556 − 1887`），**critique 体积不可事前预测**（8 条意见在两轮里分别是 1887 与 2913）。⇒ 继续压 payload 是赌。读码找到不赌的出口：`backendInputLimit` 只对 `BACKEND_INPUT_LIMIT` 表内后端生效，**表里只有 `opencode: 7800`**，`claude`/`codex` 无护栏 ⇒ 把第二家族放到 **critic** 位（`--critic codex --proposer claude`），跨家族成立且与长度护栏无关 |
| codex 那轮的交付判定 | ✅ | **按产物判，不按 rc 判**：回路 `rc=2`，但 `.adversarial/ccg-plan-qm6-cw-design-reviewcopy-b-codex/critique-v1.md` 存在、**8 条 / Critical 3 / 最低维度分 4** ⇒ **评审发生了**。rc=2 的真实原因在引擎自动改文的校验（proposer 的 `before` 未逐字命中副本原文，含 markdown 粗体与转义；另有多条 `accepted` 未附 edit）——**是自动应用失败，不是对抗评审失败**。处置照第 1 轮同一规矩：我改文档，不靠引擎改 |
| 8 条逐条处置 | ✅ | 接受 6：**i1**（Critical，打的是我上一轮刚补的东西）字节比对被时间戳单独满足——引擎每个 `writeBack` 站点都写 `at`（`:1255`），"字节变了"只证明"写过一次"；改为**两条并立各自出声**（`no-write` / `no-new-delivery`），且指纹取"整个 `deepReview` 去 `at`"而非只取 findings（否则漏掉"`status` 变而 `findings` 未变"这一格）；**i2**（Critical）`exec` 改调用后信号终止未定义 ⇒ 补 `code`/`128+signo`/两者皆 null 取 1 的映射表 + 写回器 try/catch 不得改 rc；**i5** 复用判据闭集而无锁 = "改消费者即改生产者"，补冻结快照；**i6** 我只对 critic 名立了"必须上层透传"，**路径自己漏了**（同一条规矩的反向适用），补 `missing-record-path` 且禁止两种猜法回退；**i7** `findings` 与 `deepReview.findings` 混用 + 未定义失配处置，统一并规定"失配判 `external-unverified` 给指引，MUST NOT 说成伪造"；**i4** 删掉我那句撑不住的成本论断（见下一行）。**部分接受 1**：i3 的原子写/有界重试**本已写在 tasks 3.3**，副本没带 tasks 才被当缺口——采纳其新增的那半（写前比对、相同则跳过），并把方法论记进 tasks 9.8。**拒绝原方案 1**：i8 要 env 开关，我改成显式旗标 `--writeback-dry`——env 关闭不留痕，下个读到 `tier` 缺席的人分不清"没交付"与"被关了"（本仓对 pre-commit 做过同一否决） |
| 自我否证一条 | ✅ | codex i4 打掉的正是**我自己写的话**："把造假成本从写一个词抬到伪造一份自洽正文"。摘要只哈希本记录自己的 `findings`、**任何填写方一条命令可自算** ⇒ 成本论断无支撑。design §3-D3 与 tasks 8.5 已删；`proposal.md:55` 那句同源的**当时漏删**，被本次一致性自检（`grep` 三个同族措辞）抓到并一并改掉——三份文件口径不一致比原错误更糟 |
| 三份文件的口径一致性自检 | ✅ | 命令：`grep -rna "抬到「伪造一份\|造假成本从\|抬到\"一份自洽" openspec/changes/qm6-closure-writeback/`。修完后剩余命中**只允许出现在"引用被删原话"的两处**（design §3-D3 与 §7 表 i4 行），断言性的句子（proposal、tasks 8.5）命中数 0。这条自检本身就是本仓那条纪律的又一次现场：**禁令与断言按语义位置切，引用被禁字面量时要标明它是引用** |
| 计数一致性 | ✅ | D2 条件由四条改五条 ⇒ `spec.md` 内"四条件"两处一并改为"五条件"（`grep -n "四条件"` 修后 0 命中）。`openspec validate qm6-closure-writeback --strict` → `Change 'qm6-closure-writeback' is valid` |
| 行尾与 diff 对账 | ✅ | 四份文件均为 `i/lf w/crlf`（工作副本全 CRLF、无 lone CR），只用短锚点 Edit、不整文件重写；两口径 numstat 逐文件相等（design 49/6、spec 39/4、tasks 16/1，修 proposal 后重取） |
| 旧载体冻结 | ✅ | 未向 `.quality-gates.md` 插块、未向 ledger 加键；也未改写 `#4106`/`#4139` 两篇记录里的任何状态行 |
| 品牌残留 / 文档同步 / 绝对路径 | ✅ | 三条判据本地实跑，读数见 PR 正文 |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 零代码零 UI，无可测行为变更 |
| QM-6 CCG 双模型外部评审 | 两家族均交付 | **方案层面本轮补齐了第二双眼睛**：轮 1 critic=claude（7 条，处置见 design §6）、轮 2 critic=codex（8 条，处置见 §7）。**但未达收敛线**（引擎判据要"无 Critical 且无未解决 High"，本轮最低维度分 4）⇒ **本方案仍未盖章**；差别是"缺第二家族"这条已不成立，剩下的都是实现期货。proposer 自动改文那一格（opencode 受 7800 护栏、且 `before` 逐字校验脆）不追，改为人工处置 |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `merge-ledger` 按 squash 尾注推导 |
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 的读数在 commit 之后取，写进 PR 正文
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### 遗留（不假装已闭合）

1. **回路没收敛，方案没盖章**（最低分 4 / Critical 3）。已请两个家族各看过一轮，但"未收敛"不等于"没问题了"——9.1–9.8 是实现片必须落的工项，其中 i1/i2/i6 三条都是 Critical 且**改的是我上一版刚补的地方**。
2. **引擎的自动改文路径实质不可用**：`before` 要求逐字命中，而方案里有 markdown 粗体、转义引号与中文标点，proposer 复现不出来；`accepted 但没给 edit` 又会整轮作废。这不是本片的修法（改引擎=跨仓无锚点），本片的做法是"评审照拿、文档我改"。**登记不修**。
3. **送审副本必须自证"哪些约束在别处"**（tasks 9.8）：本轮 i3 之所以半假，是因为我把 §2/§4 裁掉时没同时告诉 reviewer 原子写口径在 tasks 3.3。裁剪是必要的，**不给地图的裁剪是制造假缺陷**。
4. `deep-review.sh` 与 `check-pr-exec-record.js` 两行判据残余（`single` 直接 `continue`、CI 仍 `advisory`）一条未动；`unknown` 占比、提交级归因、联网核验、vendoring 四条仍在片外。
