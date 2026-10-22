# tasks — 让「主干红就别合」这条判据在主干高频变动下仍可用

> 状态：**0.1/0.2 已获用户批准（2026-10-22）；但实施被 0.5 的前置任务阻塞。**
> ⚠️ 实施前必读 `proposal.md` §零「并行任务比对」：同一问题上已有 **PR #4221** 在飞，
> 它改的是**同样两个文件**，且它是本任务阶段 1 的前置。

## 0. 前置裁决与依赖（人工 + 并发预检）

- [x] 0.1 裁决阶段 1（主干基线化）：**用户已批准**（2026-10-22「按你的建议来推进」）
- [x] 0.2 裁决阶段 2（基础设施类红登记表）：**用户已批准**（同上）
- [x] 0.3 裁决阶段 3（Merge Queue）：**暂缓**（用户采纳建议：等 1+2 落地观察两周再议）
- [ ] 0.4 实施者与时间窗：由本会话执行
- [ ] **0.5 ⛔ 前置依赖：PR #4221（`main-red-run-baseline`）必须先合入**
  - 理由见 `proposal.md` §零：它改 `scripts/check-main-red.js` 与 `scripts/lib/main-red.js` 同两个文件；未合入前动手必然冲突
  - 且它先把「读数可信」这一层做完（去 `workflow_run` 噪声 + 稳定窗重试），阶段 1 才有意义
  - 完成判据：`gh pr view 4221 --json state --jq .state` → `MERGED`，且 `git log origin/main --grep='(#4221)$' --oneline` 恰好 1 行
- [ ] **0.6 ⛔ 前置更正：阶段 4 取消**
  - `electron-tests` 根因已由 **PR #4192** 修复（`1dc7417ed`），其后连续 3 次 push 全绿
  - `proposal.md` §1.2 / §2.3 的相关归因已就地降级为「历史现场」，不作为当前证据

## 1. 阶段 1：主干基线化（约 0.5 天）

### 1.1 TDD：先写失败测试
- [ ] 1.1.1 `scripts/lib/main-red.test.js`：tip 全绿 → `OK/rc=0`，`staleness=0`
- [ ] 1.1.2 同文件：**tip pending + 上一提交全绿 → `OK/rc=0`，`staleness=1`**（本阶段的目标行为）
- [ ] 1.1.3 同文件：tip pending + 回溯链中间某提交 `fail` → **`STOP_MAIN_RED/rc=2`**（不得放过）
- [ ] 1.1.4 同文件：全程 pending → `INCOMPLETE/rc=3`（不得读成绿）
- [ ] 1.1.5 同文件：绿基线落后 > `maxStale` → `INCOMPLETE/rc=3`
- [ ] 1.1.6 同文件：`checksAt` 抛错 → `SELF_FAULT/rc=4`
- [ ] 1.1.7 **变异反证**：把 `mainBaseline()` 的「先判 fail」改序成「先判 pending」，1.1.3 必须当场红并留证

### 1.2 实现
- [ ] 1.2.1 `scripts/check-main-red.js`：新增 `mainBaseline({maxBack, maxStale})`（替换 `mainSha()` 的直接消费点，`mainSha()` 保留给读数）
- [ ] 1.2.2 `scripts/lib/main-red.js`：`judge()` 接收 `mainBaseline.staleness` 并渲染进读数行；**verdict 计算逻辑不动**
- [ ] 1.2.3 读数行新增 `baseline=<sha> staleness=<n>`（不得只打印 tip）
- [ ] 1.2.4 `scripts/merge-when-green.{sh,ps1}`：**不改**（保持单一真源，二者已调用 `check-main-red`）

### 1.3 验证
- [ ] 1.3.1 单测全绿 + 变异反证留证
- [ ] 1.3.2 **真机对照**：用本次现场 sha 复现 —— `8da92948`⇒rc=2、`ab806ce0`⇒rc=0、`72f371925`⇒判到绿基线
- [ ] 1.3.3 退出码语义回归：确认 rc=0/1/2/3/4 五档无一变更语义（只允许 rc=3→rc=0 的升级）
- [ ] 1.3.4 CCG 双模型评审（本项改门禁判据，**必须**外部评审）

## 2. 阶段 2：基础设施类红分类与登记（约 1 天）

### 2.1 TDD：先写失败测试
- [ ] 2.1.1 探针单测：`timeout` / `runner-lost` / `oom` / `unknown` 四种 `kind` 各一例
- [ ] 2.1.2 放行矩阵：三条锁（`kind≠unknown`、未过期、证据 run 对得上）各自缺一 ⇒ 阻断
- [ ] 2.1.3 TTL 用例：`expiresAt` 过期 ⇒ 恢复阻断
- [ ] 2.1.4 **变异反证**：去掉「证据 run 对得上」这条锁，用旧 run 号的用例必须当场红
- [ ] 2.1.5 结构锁：登记表条数**不得增加**（只能缩小）

### 2.2 实现
- [ ] 2.2.1 新增 `scripts/lib/main-red-infra.js`：`infraKindOf(sha, checkName)`（只对主干失败集调用，取 job 详情 + 日志末尾匹配）
- [ ] 2.2.2 新增 `scripts/main-red-infra-exemptions.json`（含 `$comment` 与首个条目 `electron-tests/timeout`）
- [ ] 2.2.3 `scripts/lib/main-red.js`：`judge()` 增加「已登记基础设施红」分支；放行时读数行点名 + 打印到期日
- [ ] 2.2.4 未登记的基础设施红**仍然阻断**（默认按可修处理）

### 2.3 验证
- [ ] 2.3.1 单测全绿 + 变异反证留证
- [ ] 2.3.2 真机：用 `8da92948` 的 `electron-tests` 实跑探针，`kind` 应为 `timeout` 且证据串逐字吻合
- [ ] 2.3.3 CCG 双模型评审（**新增放行通道 = 全仓风险面最大的一处，必须外部评审**）

## 3. 阶段 3：Merge Queue（约 3–5 天，须先立项）

- [ ] 3.1 立项评估：CI 成本 ×2 是否可接受
- [ ] 3.2 给承载 10 条 required checks 的 workflow 加 `merge_group:` 触发器（`quality-gate` / `electron-ci` / `gui-test` / `build` / `doc-gate` / `debt-guard` / `dep-audit` / `visual-test`）
- [ ] 3.3 逐个验证 `merge_group` 事件下 checks 名字与 required 清单**逐字对齐**（本仓已有 matrix 与 required context 冲突的先例，见 AGENTS「取证口径」）
- [ ] 3.4 启用 ruleset `main-ci-gate` 的 merge queue（**人工操作**）
- [ ] 3.5 定义 `check-main-red` 的新定位：差集归因保留为「合并前自查」，不再是阻塞闸门
- [ ] 3.6 观察 2 周：合并平均耗时、CI 成本、误阻断次数

## 4. 文档与记录

- [ ] 4.1 `AGENTS.md`「PR 自动合并」判据第 2 条改写：说明「主干绿」的口径是**最后一次完整结论**（阶段 1）与**基础设施类登记**（阶段 2）
- [ ] 4.2 `01-docs/PRD-MAIN-RED-LIVENESS-2026-10-22.md`：详细 PRD（本 proposal 展开）
- [ ] 4.3 `openspec/records/main-red-liveness.md`：执行记录（唯一强制载体）
- [ ] 4.4 把本次 8 小时现场（时间线 + rc 抖动表 + 2101s/2100s）作为「为什么改」的固定证据链写进记录

## 5. 验收（对应 proposal 第六节）

- [ ] 5.1 八条验收标准逐条取证
- [ ] 5.2 用一份真实 PR 做端到端演练：主干有 pending 时能否正常合并（阶段 1 的核心价值）
- [ ] 5.3 演练「主干真红」时仍被拦住（不得因阶段 1 而漏判）
