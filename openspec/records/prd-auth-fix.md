---
record: prd-auth-fix
task: 更正 PRD 运营端点鉴权描述 + 补 catalog-synced origin 接线锁
date: 2026-10-14
---

## 本次执行记录：更正 PRD 中运营端点鉴权描述（只认 X-Catalog-Key → Bearer 优先）+ 补 origin 接线锁（prd-auth-fix，2026-10-14）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 混合 PR（`01-docs/PRD.md` 文档 + `apps/desktop/electron/services/ops-center-sync.test.js` 测试代码）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-prd-auth-fix`（分支 `prd-auth-fix`，基线 `208afcb64`） |
| 第一性原因（QM-5 ①） | PASS | **文档与实现不符，且是我上一轮亲手写错的**：我在 #3513 正文、`ops-menu-diag` 记录与 `learnings` 里断言「`/api/v1/runtime/bootstrap` 只认 `X-Catalog-Key`，Bearer 不适用」。实测读实现（`ops-center/backend/services/logto_verifier.py::verify_bearer_or_catalog_key`）：**Bearer(Logto JWT) 优先**，需 scope `publish:read`；`X-Catalog-Key` 只是 static fallback；两者皆缺 → 401。PRD 里同一句错误描述自 2026-08-10 起就存在（非我所写），但**我上轮的错误结论正是照它写的**——上轮已更正 PR/记录/learnings，本笔把最后的落点 PRD 一并更正 |
| 逃逸分析（QM-5 ②） | PASS | ①**文档层无判据**：PRD 的鉴权描述是纯文本，没有任何脚本把它与后端依赖（`verify_bearer_or_catalog_key`）对账，写错了没人发现；②**排查层靠 docstring 推断**：我上轮据 `routers/runtime.py` 模块 docstring「走 X-Catalog-Key」下结论，没读 `_require_catalog_key` 的实现；③**测试层只有纯函数锁**：`safeOrigin` 有单元锁，但没有任何断言保证 `catalog-synced` 事件真的带上 `origin` —— 纯函数锁 ≠ 接线锁 |
| 修复 + 回归保护（QM-5 ④） | PASS | **文档侧**：`01-docs/PRD.md` 共更正 **9 处**鉴权描述（`runtime/bootstrap` 端点 2 处 + `platform_defs`/`feature_flags` 附带 4 处 + `model-presets/catalog` 端点与鉴权 2 处 + 拉取契约 1 处 + `usage/ingest` 端点 1 处 + `publish/ingest` 1 处 + 上报/调度凭据描述 2 处），统一为「Bearer(Logto) 优先，需 scope `publish:read`；或 `X-Catalog-Key` 兜底；皆缺 → 401；两种凭据都未配置 → 404」。**代码侧**：新增接线锁 1 条 —— 断言 `catalog-synced` 成功日志的 `params.origin` 等于运营中心 origin，并用反向断言禁止把 URL 原文（可能带 userinfo/查询串令牌）入日志 |
| 防止再次发生（QM-5 ⑤） | PASS | ①接线锁已落地（`ops-center-sync.test.js`，87/87 通过），堵住「纯函数锁 ≠ 接线锁」这一具体缺口；②本笔教训进三处记忆（内置 `01-docs/learnings.md` / 外部 `learnings.jsonl` / EverOS）；③**遗留机制缺口（不假装已闭合）**：PRD 鉴权描述仍无机械判据与后端依赖对账，建议后续把「端点 → 鉴权依赖」做成 spec 镜像锁（本机无 `codeagent-wrapper`，QM-6 未执行，故未自行设计） |
| 反证（变异） | PASS | **M1**：把 `origin: safeOrigin(effectiveUrl)` 改为 `origin: ''` ⇒ 接线锁变红（rc=1）；还原 ⇒ **87 passed**。脚本以字节级回写自证还原完整 |
| 编码与行尾 | PASS | 两口径 `numstat` 一致（raw=2 / ignore-cr=2）；`PRD.md` 与测试文件均无行尾噪音 |
| QM-1 本地打包 | N/A | 本笔只改**测试文件**（`electron/services/*.test.js`），未改 `electron/` 下生产代码 ⇒ 产物不受影响，如实登记为 N/A 而非虚构打包证据 |
| QM-4 视觉回归 | N/A | 无 UI 文件变更 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PASS | merge `8e81b4766aa6cdb3e65c947dd3abcce0ce759282`（2026-10-14 15:53:31 +08:00）；PR 已 MERGED，远端分支 `ls-remote` 0 行 |
- 保留门禁：行尾对账 ✅ | 品牌残留 PASS（8986 文件）| locale 成对 PASS | CJK 基线 PASS（1374→1224）| 键存在性 PASS（2004）| 测试接线 PASS | 债务熔断 PASS | 远程同步 PASS（merge 8e81b4766，远端分支 0 行）

### 备注：为什么把 usage / publish / catalog 也一并改

排查时用 `git grep verify_bearer_or_catalog_key -- ops-center/backend` 核实，发现**不止 bootstrap**：
`model_presets.py`、`telemetry.py`、`runtime.py`、`usage.py`、`publish_metrics.py`、`diagnostics.py`、`feedback.py`
**都已走双通道**。所以 PRD 里这些端点的「只认 X-Catalog-Key」同样是错的，只改 bootstrap 会留下一半陷阱。
