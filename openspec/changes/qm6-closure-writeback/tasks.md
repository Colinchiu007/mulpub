# tasks: qm6-closure-writeback

> 本片改 `scripts/deep-review.sh`（高危面前缀 `scripts/deep-review`）与 `scripts/check-pr-exec-record.js`
> （前缀 `scripts/check-`）⇒ **两条高危面同时命中**。自反条款沿用 #3987：不得以 `self-play` 收口 QM-6，
> 且**不自动合并**（改"谁来守门"），一律人工过目。

## 0. 先把前提钉成可重取的读数（不做这步后面的设计都是猜）

- [ ] 0.1 当场重取并把读数写进 `design.md`：① `deep-review.sh` 里 `exec node "$DRIVER"` 的**条数与行号**（现读 4 条：`:850 :852 :859 :861`）；② 引擎 `writeBack()` 是否仍是 `rec.deepReview = deepReview` 整体替换（现读：全文件对 `deepReview` 的赋值只有 `:520` 一处，且 `grep -c 'rec.deepReview = {\|{...rec.deepReview\|Object.assign(rec.deepReview'` = **0** ⇒ 无合并式写回，确实是整体替换）；③ 成功收口对象里的键集合（现读 `:1252-1256`，无 `tier`/`evidence`）；④ 引擎全文 `tier` / `sessionId` / `ses_` / `durationMs` / `exitCode` 命中数（现读全 0）。**每条都要给命令**，不得写成"据前述"
- [ ] 0.1b **把 ①-④ 之外的「闭环 × tier」交叉读数收进仓内工具**：`scripts/ccg-artifact-shape-survey.js` 已经在 `:35` 记 `tier`（缺席记 `absent`）、在 `:66` 打总缺席数，但**没有交叉表** ⇒ 现在 design §2 引的「已闭环 208 条里 157 条整段无 `tier`、非 `unknown` 的自造值 22 条」是一次性手工探针的读数，属本仓明令禁止留下的孤立数。正解：给该普查加一行交叉表（`status ∈ 闭环` × `tier` 取值），本切片实现片**必须先落这把工具、再用它重跑并把 design §2 的数改写**；工具改 `scripts/` 自身 ⇒ 那片按混合 PR 走完整质量节拍，不能借 docs-only 通道
- [ ] 0.2 实测一次「跑完真评审后记录的 `tier` 键到底在不在」：不是从代码推，是跑一次 `sh scripts/deep-review.sh --dry-run` 与一次真审查（或注入假驱动），再 `git show`/读文件回结构。**若实测发现 `tier` 其实在某条路径上被保留**，本片的 D6 当场作废并在 design 记否证（不得留着一条已死的"修复"）
- [ ] 0.3 量一次本片改动的**增量成本**（不是总成本）：主干最近 40 笔第一父提交里，有多少条 dual 产物会因新增 `delivery` 档而改变读数。预期是 0（历史产物不含该形态），若不为 0 必须逐条解释

## 1. 示踪弹：先让"没有生产方写 tier"这件事变红

- [ ] 1.1 在 `scripts/check-pr-exec-record.test.js` 加一条**契约锁**：从 `buildDeepReviewInit()` 出发，经"驱动写回"到 `closureCorroboration()` 真跑一遍，断言一条刚交付的记录能读成 `external` **且不靠测试自己手写 `tier`**。当前它必然红（没有任何生产方写 `tier`）——这条红就是本片的立项证据
- [ ] 1.2 加一条反向负控：把写回器改成恒不写（no-op）时，1.1 MUST 变红；若 1.1 在 no-op 下仍绿，说明夹具替对方把结论算好了（本仓反复踩的形态），先修夹具
- [ ] 1.3 变异反证：本切片每条 MUST 各自指名红，驱动按当场 eol 档锚定，并断言"跑了多少条"而非只看有无红

## 2. D1 驱动侧写回点（先保 rc，再加动作）

- [ ] 2.1 `deep-review.sh` 4 条 `exec` 改为 `node …; _rc=$?` + 调写回器 + `exit $_rc`；`--dry-run` 分支与 `DRY_NO_DRIVER` 分支**保持不引入写回**（dry-run 不该产生产物）
- [ ] 2.2 行为锁（不是结构锁）：注入一个假驱动（写在 `os.tmpdir()` 下、按 `MP_*` 变量指路），三种 rc（0 / 1 / 2）各跑一次入口，断言入口 rc 逐字相等。**只断言"源码里出现了 `exit $_rc`"不构成证据**。落点文件 **`scripts/deep-review-entry-rc.test.js`**（评审 i7：原任务没指定文件，无法定位就无法接线），同时承载 2.3 的顺序断言
- [ ] 2.3 接线锁：写回步骤 MUST 排在"引擎已返回"之后、`exit` 之前；把写回调用挪到 `exit` 之后必须当场红（本仓「释放必须发生在控制流正确位置」的同型）
- [ ] 2.4 回归：`scripts/deep-review-deps.test.js` 与既有 `--check-deps` 相关用例全量（本片动了同一个文件的出口段）

## 3. D2/D6 写回器 `scripts/ccg-review-writeback.js`

- [ ] 3.1 四条件合取判据逐条实现，每条一个**独立**出声名（`not-closed` / `empty-findings` / `backend-mismatch` / `stale-record`）；缺哪条写哪条，禁止塌成一个布尔
- [ ] 3.2 「期望后端由驱动写、不由填写方自选」：`expectedCritic` MUST 由调用方（`deep-review.sh` 侧，取自 `scripts/ccg-review-backends.list` 真源）显式透传。**多层回退链的定位键必须由上层显式透传**——漏传不报错、中间两级成死代码那条教训直接适用这里
- [ ] 3.3 原子写：临时文件 + rename，Windows 下只对 `EPERM/EACCES/EBUSY` 有界退避重试；超过预算原样抛（沿用 AGENTS「Windows 原子文件替换重试」口径）。失败 MUST 留日志，禁止静默（既有产物在失败时必须逐字不变）
- [ ] 3.4 缺 `tier` 键时按 `buildDeepReviewInit()` 同一口径补初值再判定；`buildDeepReviewInit` MUST 被 require 而不是重抄字段表（重抄就是第二份事实）
- [ ] 3.5 夹具纪律：写回器的测试夹具 MUST 让不同输入返回不同记录内容（"恢复/选址类夹具若对所有输入返回同一份数据，按输入区分类缺陷对它结构性免疫"）；并至少一条"引擎写的是**别的** sha 的记录"负控

## 4. D3 `delivery@` 档与就地重算

- [ ] 4.1 摘要规范化实现**只放一处**（建议 `scripts/lib/ccg-delivery-digest.js`），写回器与判据都 require 它；加接线锁禁止第二份
- [ ] 4.1b **规范化规则本身要有一条固定行为向量**（评审 i2：只写"只有一份实现"防得住分叉、防不住腐蚀）：输入写死的 findings 样本，断言摘要逐字符等于写死的期望值。规则定义见 design §3-D3（对象递归按键名码点升序、数组保序、`JSON.stringify(v, null, 0)`、sha256 小写 64 hex）。反证两条各测各的：① 改成按键序不排序 ⇒ 向量红；② 改成 `JSON.stringify(v, null, 2)` ⇒ 向量红。只测"业务改动变红"不证明向量在跑
- [ ] 4.1c 降档文案措辞锁（评审 i4）：`external-unverified` 的红文案 MUST 说「摘要与本记录 findings 重算值不符」，MUST NOT 说「证据无效/伪证」；模块文件头 MUST 有「本地一致性校验，不提供身份绑定」注释。两把都是禁词/正词锁，注释里的字样 MUST 被剥掉后再判（本仓已三次被自己的禁词锁打到）
- [ ] 4.2 `evidenceForm()` 增 `delivery` 档；`classifyEvidenceTier`/`closureCorroboration` 对它走**内容验证**（重算比对），与 `path` 档并列成"两档可就地验证"
- [ ] 4.3 负控三条：抄来的合法十六进制串 / 从别的记录整段复制 / `findings` 被截断后摘要对不上 ⇒ 三条都必须降 `external-unverified`，且在高危面判欠账
- [ ] 4.4 如实标注其余四档（`pr`/`session`/`uuid`/`oid`）仍只判形状，**不得**在文案或注释里把五档统一说成"已验证"
- [ ] 4.5 红文案更新：`unrecognized`/高危面那两条出口文案里，把"跑真评审"出口从「会话手写 `tier`」改述为「跑 `sh scripts/deep-review.sh` 由驱动写回」——**文案不是写入方**，但文案是指路牌，留旧措辞就是在教人手写

## 5. D5 跨仓 parity 锁（两份形状判据互认）

- [ ] 5.1 本仓自持一份「外部复核成立」判据；与引擎的 `EXTERNAL_EVIDENCE_RE`/`externalReviewSatisfied` 做**逐字对账**行为锁（同一批样本两侧布尔数组 `toEqual`）
- [ ] 5.2 引擎不可读时 MUST 出声 `parity=skipped(engine-absent)` 并让读数可被后续判据区分；**禁止** `if (!engine) return`（那把"没比对"读成"比对通过"，本仓实测的第三种装饰性落点）
- [ ] 5.3 样本条数下界断言（命中 0 条即探针失明），且样本 MUST NOT 只取自引擎自己的正则字面量（用黑名单测黑名单是恒真）

## 6. 接线与文档同步

- [ ] 6.1 新增 `*.test.js`（写回器 / 摘要 / parity）逐个显式点名进 `quality-gate.yml` Gate 2b/2c，由 `check-unwired-tests.js` 兜；`.gitignore` 第 106 行 `scripts/*.js` 会吞新脚本，按既有惯例补 `!scripts/<name>.js` negation，并 `git check-ignore --no-index` 当场证明没被吞
- [ ] 6.2 `openspec validate qm6-closure-writeback --strict` 通过；与在飞的 `ccg-review-degradation-ladder` 不产生 Requirement 重名
- [ ] 6.3 AGENTS.md：把「`tier=external` 此刻仍由会话手写进产物」那段改为指向驱动写回；顺带把 #4087 里那句「在飞的候选 `scripts/lib/ccg-review-`」收成现状（该前缀已随 #4071 进常量）。**不为此单开回填 PR**
- [ ] 6.4 执行记录 `openspec/records/qm6-closure-writeback.md`：表行状态列写「由门禁推导」，不写状态词

## 7. QM-6（本片自身）

- [ ] 7.1 两轴外部评审：后端真源读 `scripts/ccg-review-backends.list`（改 `config.toml` 对评审链无效）。跨家族轴不可得时**按四档归因**（启动形态错 / 额度重置 / IP 级拒绝 / 403 额度不足），并如实写"只经过单轴复审"，不得写成双模型完成
- [ ] 7.1b **设计层第 1 轮是单轴**（2026-10-21 实跑 `plan-review.sh --force` rc=2：critic=claude 交付 7 条 / Critical 3，proposer=opencode **未跑成**——任务提示 9790 + 角色提示 147 = 9944 字符，超该后端实测上限 7800，边界 `(8125, 8145]`）。7 条处置已进 design §6，但**跨家族那一半欠着**。补法不是换后端凑数，是按引擎自己的对策把**送审副本**压到上限内（剥掉 §2 读数表与 §4 被否证表——那两张是给人核对出处的，不是评审对象），仓内 design.md 一字不动。压完重跑一轮，仍未收敛就升级报告，不盖章
- [ ] 7.2 本片收口 MUST 由**本片自己落地的驱动写回**产出 `tier=external` + `delivery@` 摘要，而不是手写 —— 这是 1.1 那条契约锁的现场检验：**如果本片最后还要手写，说明写回器没真跑通**
- [ ] 7.3 逐条处置评审意见：采纳前量"这个修法会不会把刚建的门禁整条关掉 / 能不能触发"；否证要带证据；只接受真的那一半
- [ ] 7.4 不自动合并，交人工过目（判据本体 + 评审驱动本体两条高危面）

## 8. 遗留（本片刻意不做，写清楚免得被读成已闭合）

- [ ] 8.1 **联网核验** `pr`/`session`/`uuid`/`oid` 四档指向的仓库外对象是否真实存在 —— 单独立片，代价是判据要网络与凭据、且必须可离线降级
- [ ] 8.2 **引擎归属 / vendoring 决策**：要把引擎按字节锚点搬进本仓（先例：Logto webhook 补丁要求运行时文件 SHA-256 绑定 + 漂移即 fail closed），属"谁来守门"，人工过目，本片不做
- [ ] 8.3 **提交级归因**（产物写"本次改动文件清单"）仍在 8.1b 范围① 挂着：本片写回器只补 `tier`/`evidence`，不产文件清单 ⇒ 矩阵仍按 PR 差量判，提交级归因做不了
- [ ] 8.4 **`unknown` 占比不降**：本片给了合规路径，但历史 139/142 条无 `tier` 的产物不会被改写；转拦仍取决于新增产物是否走驱动，不取决于本片
- [ ] 8.5 **写回器仍可被绕过**：任何人手工写一个与 findings 自洽的 `delivery@` 摘要在技术上成立（成本从"一个词"抬到"一份自洽正文"，但没归零）。真正的密码学绑定不在本仓能力范围内，措辞上 MUST NOT 称其为"防伪造"
