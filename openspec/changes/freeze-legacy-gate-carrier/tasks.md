## 1. 冻结判据（TDD）

- [x] 1.1 生成基线并入库：`scripts/freeze-gate-carrier.js` + `scripts/gate-carrier-freeze.json`。实测 `条数=603 sha=5fed93f022ff…`（标题按 `check-gate-record-debt.js` 同一 `normalize` 口径取，避免生成器与判据两套切法）
- [x] 1.2 先写测试再实现（本仓要求两段驱动、先见证红）：`check-gate-record-debt.test.js` 新增 6 条 —— 一致不报漂移 / 加块判红并点名 / 删块判红 / **只改状态行不得判红** / 缺基线与零基线必须抛错 / 未注入不得静默读生产基线。实现后 `node --test` 全绿
- [x] 1.3 实现 `carrierDrift`（`collect({carrierFreeze})` 注入式，CLI 才读生产文件）并接入 `hasBlocking`；`node scripts/check-gate-record-debt.js` 真仓 rc=0
- [x] 1.4 变异反证 3 条，逐条还原并核 md5 与改前一致：M1 从拦截面摘掉 `carrierDrift` ⇒ 仅「加块判红」那条红；M2 哈希改常量 ⇒ 仅「真仓冻结自检」那条红；M3 缺基线改成静默 `return null` ⇒ 仅「必须抛错」那条红。`escaped=0`，还原后 md5 一致
- [x] 1.5 顶部棘轮退役要同 PR 迁断言，不许留旧语义测试冒充覆盖：把「最顶部缺行 ⇒ 判红」改写为「不再判红 + 可见项 + 不得再打 `❌ 最顶部…`」；真仓自检从"顶部带行"换成"等于冻结基线 + 规模下界 500"（防识别退化让"零漂移"变假绿）；删除旧的 `❌ 最顶部的执行记录缺…` 打印

## 2. 载体约定与文档同步

- [x] 2.1 `AGENTS.md` 追加「旧载体冻结」小节（**不改写既有段落**：该文件是多会话共改热点，改写会制造整文件冲突）。新 PR 只写 `openspec/records/`；旧载体只许就地关闭已有行；基线重算属人工动作、不走自动合并
- [ ] 2.2 `openspec/specs/openspec-integration/spec.md` 的「分层分支策略」同步：由本 change 归档时由 `openspec archive` 落基线（delta 已写在 `specs/openspec-integration/spec.md`，含完整 requirement 正文），**故此处留未勾 —— 基线规格现在还没改**
- [ ] 2.3 docs-only 模板与「⛔ 两种形态必须同写」两处口径复核：AGENTS.md 已用"自本节起只适用于关闭已有旧行"限定，但 `openspec/specs/openspec-integration/spec.md:123/:131` 的"可就地编辑 …… `.quality-gates.md`"字面仍在新基线里 —— 归档时一并核，避免规范与判据两套口径
- [x] 2.4 本 PR 自我示范新规矩：变更集**不含** `.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json`（`git diff --name-only origin/main..HEAD` 自证，见执行记录）

## 3. 与 `hot-carrier-atomic-landing` 的衔接

- [x] 3.1 在该 change 的 `tasks.md` 顶部写明：本 change 成立后，其 (2) 一条命令收口 与 (3) pre-commit 归属拦截 **标为不实现**（对象不再出现于新 PR，实现它只会新增对无辜方的误伤），仅保留 (1) 事后测量一档
- [ ] 3.2 实现 (1) 守卫侧窗口测量（`scripts/guard-shared-root-writes.ps1` 的开窗/收窗事件 + 时长读数 + 漏事件对账）—— 独立后续刀，未开工

## 4. 收尾

- [x] 4.1 保留关旧账通道的正向锁（1.2 第三条）；25 条历史欠账仍可就地关闭
- [ ] 4.2 人工过目后合并（判据本体变更，不适用自动合并）；合并后按新规矩回填 `openspec/records/freeze-legacy-gate-carrier.md`（不再回写旧载体与 ledger）
- [ ] 4.3 worktree 按 R1–R5 以 `scripts/safe-worktree-remove.ps1 -WhatIf` 干跑通过后清理

## 已知漏洞（不假装已闭合）

- 净零漂移（一加一删）只被哈希抓到、计数不变，added/removed 会同时非空需人读（design D2）。
- 计时器未落地 ⇒ 当前只有"拦住"没有"事后读数"（tasks 3.2）。
- 基线含 603 条标题 ≈ 71 KB，是本仓较大的数据文件；换来的是不依赖 git 历史可达性（design D1）。
