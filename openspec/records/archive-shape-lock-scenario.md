---
record: archive-shape-lock-scenario
task: 归档 align-shape-lock-empty-ledger-scenario —— 把 MODIFIED delta 落进主规格，消除那条 Requirement 的正文与 Scenario 互斥
date: 2026-10-20
---

## 本次执行记录：归档 shape-lock 规格 delta（archive-shape-lock-scenario，2026-10-20）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯 docs 变更（`openspec/**` + CHANGELOG），走 docs-only 快速通道。**本次正规入口成功**：`scripts/start-mp-task.ps1 -TaskName archive-shape-lock-scenario` 建成 `<仓库父目录>/mp-worktrees/mp-archive-shape-lock-scenario`（占位符形态，受管文档不写本机绝对路径），裸分支同名、起点 `4d7c32535` == `origin/main`、工作树 0 脏项，`verify-worktree-deps.js` OK（11 项解析通过）。前几刀挡着这个入口的两个条件（标准根之外注册着 2 个 worktree、共享根有他人未跟踪文件）已由持有方清掉——**这不是我可以声称的成果，只是当场重测的结果**，所以那条「%TEMP% detached 工作树」的降级出口本刀没有用 |
| 归档动作 | ✅ | `git mv` 整个 change 目录 → `openspec/changes/archive/2026-10-20-align-shape-lock-empty-ledger-scenario/`，git 识别为 **4 个 `R100`**（零内容漂移，不是"删了再加"）；主规格 `openspec/specs/quality-gate-execution-record/spec.md` 的目标 Requirement 块整块替换为 delta 的版本 |
| 归档保真（逐行） | ✅ | 归档块与主规格落点块 **44 行 vs 44 行，`diffLines=0`**；块内 Scenario 数两侧都是 **6**；主规格 Requirement 计数 **4 → 4**；被改写掉的矛盾句 `规模下界` 在主规格里 **残留 0 处** |
| delta 的形状（三个度量分开报） | ✅ | ① 主干有而 delta 没有的行 = **2** ——正是被重写的那对 `WHEN/THEN`（不是丢内容，是改写）；② delta 净新增行 = **8**（2 条 `AND` 边界 + 新 Scenario 的 4 行 + 空行）；③ 位置比对不同行数 = **8**（含纯下移）。块内非空行数 **22 → 28**。5 条原 Scenario 标题**逐字保留**，`live_only_titles=0` ⇒ 没丢场景 |
| `openspec validate` 真 A/B | ✅ | 两棵树各跑一次 `--all --strict`，**按条目名比对而不是比计数**：共享根 `passed=200 failed=28` vs 本刀 `passed=199 failed=28`，`NEW_FAILURES=[]`、`NO_LONGER_FAILING=[]`；唯一的 passed 项差异恰为消失的 `change/align-shape-lock-empty-ledger-scenario`（归档后它不再作为活动 change 被计数）。`openspec validate quality-gate-execution-record --type spec --strict` → `is valid` |
| vendored 镜像是否联动 | ✅ | 判据读锁源码不读先例：`scripts/quality-rhythm-spec-mirror.test.js:13` 的 `LIVE_SPEC` 写死 `openspec/specs/openspec-integration/spec.md`，本刀 delta 落在 `quality-gate-execution-record` ⇒ **不联动**。仍按前后各跑一次留痕：`# pass 8 / # fail 0`（与改动无关的不变量，跑一次证明没被碰坏） |
| 行尾与 diff 对账 | ✅ | 主规格工作副本实测 **`cr=166 lf=166`，terminator tally 全 CRLF、无 bare CR、无缺尾**。因此**没有**用"探测多数派后统一回写"，而是把文件解析成 `(文本, 结束符)` 对，只给被替换块的新行取**该块自己的**结束符（块内 tally 也是 37/37 CRLF），块外逐元素比对：前缀 129 行与后缀逐行 `text`/`term` 双相等 ⇒ 除目标块外零位移。写前先做 **scanner roundtrip 自证**（重新序列化必须逐字节等于原文，否则后面所有断言都无意义）。CHANGELOG 以 `git show HEAD:` 的 blob（纯 LF，`cr=0`）为底置顶插入，自检标题块恰 +1 且主干全文原样落在尾部 |
| 旧载体冻结 | ✅ | 未向 `.quality-gates.md` 插块、未向 `scripts/gate-record-debt-ledger.json` 加键；`check-gate-record-debt.js` rc=0 且打印 `旧载体与冻结基线一致`，`HAND-CLOSURE 人工改写=0 新增重复行=0 记录被删=0 触碰记录=1`（那 1 篇就是本篇，合并后自动转派生收口） |
| 品牌残留 / 文档同步 | ✅ | `check-no-brand-residue.js` PASS；`check-docs-sync`（文档同步检查）本地跑绿；`check-doc-abs-paths.js` rc=0（本篇与 CHANGELOG 均用占位/相对路径，无本机绝对路径） |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件；本刀零代码改动（判据行为不变，改的是规格文本与目录位置） |
| QM-6 CCG 双模型外部评审 | N/A | 纯 docs 规格归档，按 AGENTS 不强制 QM-6；`ccg-review-decider` 对本次暂存差量判 `mode=skip`（S 复杂度低风险），判定产物随提交入库 |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导；现场读数以判据打印为准 |
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 的 `docs-only=` 读数写在 PR 正文（同一判据在 commit 之后取证，预提交取会得空差量假结论）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导（本行不写状态词、不写 PR 号占位）

### 遗留（不假装已闭合）
- 本刀只消「Requirement 正文与 Scenario 互斥」这**一条**。同族形状（正文与条目互斥、条目与条目互斥）**没有任何机器判据**在看：`openspec validate --type spec --strict` 实测对该矛盾判 `is valid`，它查结构必需段与场景覆盖，**不查条目内自洽**。要拦得住必须新增一条"同一条 Requirement 内互斥措辞"的判据，那是另一刀。
- 已登记待另起一刀的时间性缺口（出自 #4001，落在 `openspec/records/qm6-critic-dispositions.md`）：**收紧债务基线不会作废在飞 PR 的既有绿 run**。
