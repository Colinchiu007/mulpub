---
record: multi-account-same-platform
task: 修复同平台多账号被误判为「此账号已添加过」（去重判据误用 name 字段）
date: 2026-10-21
---

## 本次执行记录：同平台多账号去重契约修正（multi-account-same-platform，2026-10-21）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`packages/python-backend/src/server.py`、同目录 tests）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-multi-account-same-platform`、裸分支 `multi-account-same-platform`（`git rev-parse --abbrev-ref HEAD` 实证）。共享根 `pre-code-edit-guard.ps1` 先返回 BLOCKED/exit 1，确认未在 main 上直接改码 |
| 第一性原因（QM-5 ①） | ✅ | 一级引入 commit `c84325baa`（2026-09-06，PRD §「账号管理页核心修复 v5」），`git log -L 528,548:packages/python-backend/src/server.py` 取证。意图是补「一方有 ID 一方没有 + 同名」的漏检，但把 `name` 当成账号身份标识。而 `name` 是 `document.title` 落盘位（`apps/desktop/src/utils/account-display-name.js:14` 明写「永不作为显示名来源」），采不到平台用户 ID 时由 `resolveCapturedDisplayName` 回落成平台显示名 ⇒ 同平台 N 个账号 name 全同。`platform_account_id` 采不到是常态（选择器只认 `[data-account-id]` 等 3 个属性，见 `account-profile.js:97-102`，头条号/百家号后台不带这些属性） |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：`test_create_account_duplicate_when_one_side_has_id_same_name` 与 `test_create_account_duplicate_by_name_when_both_ids_empty_returns_409` **断言的就是 Bug 本身**（409），把错误契约固化了；②启动去重用例数据是 3 个同名账号，天然验证了错误行为；③E2E/集成层的 409 都是 IPC mock，不触达真实判据；④审查层：v5 注释给了看似合理的理由（「ID 提取可能不一致，名称是稳定的兜底标识」），审查被说服 |
| 系统性漏洞（QM-5 ③） | ✅ | **测试与实现共享同一错误假设**：去重用例集全部以 `name` 为判据编写，没有一条问过「`name` 能不能当身份标识」；且用例从不构造 `platform_account_id` 与 `name` 的**组合差异**（如「两个号都无 ID」）。测试只验证了实现的自洽性，未独立验证前提 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `_account_identity_key()` 作为判据唯一实现，`create_account` 与 `_dedup_accounts_on_startup` **共用**（防「创建允许多账号、重启又清成一条」）。新增 10 例（创建 7 + 启动 3），改写 4 例旧契约断言，更新 2 例启动去重测试数据 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①`_account_identity_key` docstring 用 ⛔ 段写明「不得改用 `name` 作为身份标识」及原因，并指向 `account-display-name.js:14`；②两个调用点共用同一实现，不可能再漂移；③新增用例刻意构造「两个号都无 ID」「三个都回落平台名」这类字段缺失组合（原用例集盲区）；④PRD 新增专章 + v5 章节加 ⚠️ 废止说明 |
| 变异反证 | ✅ | 把 `create_account` 判据换回 v5 的 name 匹配：5 个创建路径用例当场变红（`5 failed, 4 passed, 25 deselected`），红文案指回根因（name 判据）。修复已还原并复跑 `39 passed` |
| CCG 双模型深度审查 | ✅ | `scripts/deep-review.sh` 实跑（proposer=opencode 出方案 / critic=claude 评审，跨家族校验通过）。第 1 轮给出 6 条问题、维度分 4 个、最低分 5，收敛判定 self_play 后进入自扮演裁决，5 条逐条填 verdict 与 rationale。处置：**i3 采纳并加固**（`_account_identity_key` 改显式类型分支 + 4 例新测试）、**i4 采纳**（`create_account` 源码注释补威胁模型论证 + 跨 owner 测试实证）、**i5 采纳**（PRD 章节压缩为契约摘要、声明单一真源）、**i1/i2 否证**（审查工件写父 sha 与 stats 只算暂存 diff 均为既有设计，见 `deep-review.sh:633-652`）。裁决产物 `.adversarial/ccg-deep-*/adjudication.json`，处置记录见独立 PRD §8.2 |
| 基线对照（存量失败） | ✅ | 全量 `pytest` 有 4 个失败；`git stash` 摘掉本次改动后**同样这 4 个失败**（`4 failed, 2865 passed` vs 带改动 `4 failed, 2874 passed`）⇒ 与本次无关，且本次净增 9 个通过。其中 2 个（frame_html / llm_service）单跑通过，属全量并行测试间干扰 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 逐字一致。首轮 `.ccg/reviews/*.json` 出现 `19/6` vs `18/5` 差一行，定位为**HEAD 版本末尾无换行符**而我补了尾换行；去掉尾换行后两口径一致（本仓 `check-pr-exec-record` 与 AGENTS.md 都要求这个对账） |
| 前端回归 | ✅ | `vitest run src/views/Accounts.test.js src/utils/user-facing-error.test.js` → **158/158**（Accounts 126 + user-facing-error 32） |
| 后端导入（CI 同款） | ✅ | `cd packages/python-backend/src && python -c "import server, uvicorn, yaml"` → `Python backend entrypoint imports ready` |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：改动在 `packages/python-backend/`（asar 随整包打包）⇒ 已跑 `pnpm run build:dir`（含 `build:vue`）+ 三层启动判据：层①存活 8000ms ✅ / 层②无已知红线 ✅ / 层③ stderr 空 ✅（rc=0）。首轮我误跑裸 `electron-builder --dir` 跳过 `build:vue`，asar 内无 `dist/` ⇒ `ERR_FILE_NOT_FOUND`，判 `NEEDS_REVIEW` 而非通过，按 `build:dir` 重跑后干净。QM-4：未触碰任何 `.vue` / 样式 / locale，无视觉面变更 |
| QM-6 CCG 双模型外部评审 | ✅ | 见上「CCG 双模型深度审查」行。非高危面（变更集未命中 `HIGH_RISK_SURFACES` 任一前缀），按 `closureNote` 出口收口 |
| 远程同步 | 由门禁推导 | 不手写状态词（`gate-record-sync-derived-status`）；收口由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

- 保留门禁：判定 docs-only=false（混合 PR，`classify-docs-only.js` 取证失败于 head 未提交，按 fail-closed 走完整节拍）| 行尾对账 ✅ | 品牌残留 ✅（`check-no-brand-residue.js` 扫描 11357 文件 PASS）| 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按「旧载体冻结」政策**零改写**）| 远程同步 由门禁推导

### 提交前两口径 numstat 实测

```
git diff --numstat                     → 2 files, +255/-46
git diff --ignore-cr-at-eol --numstat  → 2 files, +255/-46
```
（文档文件后补，提交时同口径复测）

### 变更清单

| 文件 | 变更 |
|---|---|
| `packages/python-backend/src/server.py` | 新增 `_account_identity_key()`；`create_account` 去重改为单一强标识判据（删除全部 `normalized_name` / `existing_name` 分支）；`_dedup_accounts_on_startup` 判据由 `(platform, owner, name_lower)` 改为 `(platform, owner, platform_account_id)` 并共用同一函数 |
| `packages/python-backend/tests/test_server_account_lifecycle.py` | 新增 10 例；改写 4 例旧契约断言；更新 2 例启动去重测试数据补 `platform_account_id` |
| `01-docs/PRD.md` | 新增 §「账号同平台多账号去重契约（2026-10-21）」；修正 2 处「重复账号」数据校验行；v5 章节加 ⚠️ 废止说明（2 处重复段同改） |
| `01-docs/PRD-MULTI-ACCOUNT-SAME-PLATFORM-2026-10-21.md` | 新增详细 PRD（根因、逃逸链、数据校验矩阵、功能/交互逻辑、显示项、提示文字、回归保护、风险取舍、验收标准） |

未改动：前端任何文件、i18n locales、IPC 通道、`accounts.json` schema、CHANGELOG.md（聚合器专属写面，按 `changelog-record-carrier` 合同零改动）。

### 遗留与后续建议（不阻塞本次合并）

1. **采集器可扩展**：给更多平台补真实的用户 ID 选择器（如今日头条的创作者后台 DOM 属性），
   命中率越高、强标识去重越有效。本次刻意不做——那会扩大爆炸半径，且不影响本 Bug 的修复正确性。
2. **前端可增强**：同平台多张卡片同名（都回落平台名）时，卡片上可加「第 N 个头条号」之类的
   区分位。本次不做，用户可用改名功能自行区分。
