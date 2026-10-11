---
record: handoff-q1-investigation
task: 官方 Key 池 Q1 定案（那批 official_keys 实际被谁消费）+ 回填交接文档 §6.1
date: 2026-10-11
---

## 本次执行记录：官方 Key 池 Q1 定案与交接文档回填（handoff-q1-investigation，2026-10-11）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（files=4：`01-docs/HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md`、`openspec/records/handoff-q1-investigation.md`、`.quality-gates.md`、`scripts/gate-record-debt-ledger.json`，均命中文档白名单）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/规格变更（`01-docs/` + `openspec/records/` + 流程载体）⇒ 就地编辑共享主工作区（**未进 worktree**），开头先 `git merge --ff-only origin/main` 同步到 `68838e9ab`，并确认目标文件无未吸收的上游改动（`git log HEAD..origin/main -- <目标文件>` 空）；经 PR 落地，不直推 main |
| 调查取证（核心产出） | ✅ | 四步法数消费方（全部行号取证基线 `origin/main@68838e9ab`）：① 生产读取点枚举——`official_keys` 仅 2 处，`routers/secrets.py`（CRUD/池概览，管理面）与 `services/model_preset_service.py:1112-1127`（连通性测试回退取键，经 `routers/model_presets.py:156` 暴露）；② 供给语义函数单查——`services/key_service.py:360-373` `get_active_keys_for_tier()` **生产零调用**（仅 `tests/test_key_service.py:150-171`）；③ 客户端引用——`apps/desktop/electron/` 对 `officialKey` **0 命中**；④ 规划勾选框——`ops-center/docs/PRD.md:245-265` 「Key → Tier 访问映射」未勾选 |
| 结论 | ✅ | 那批 Key **不是**为「平台用户使用内置模型消耗积分」录入（录入时积分引擎尚不存在）；实际定位＝运营后台供应商凭据登记 + 模型预设连通性验证，且「按档位回退给用户」的路径规划存在但**从未接线**。同时排除误判：运营中心的 LLM 功能（提示词评估生成/评估/翻译/视频评估、引擎连通性探测）用的是**另一张独立表** `prompt_eval_provider_keys`（`models.py:562-565`；取键路径 `routers/prompt_eval.py:33-66`），与 `official_keys` 无关 |
| 入口可达性 | ✅ | 唯一读取端点当前无活跃入口：ops-center 前端 `api/modelPresets.js` 无 test 接口、`views/ModelPresets.vue` 无按钮；桌面端唯一调用者 `services/provider-manager.js:25,80` 属旧 platform-orchestrator 桥接（`ORCHESTRATOR_BASE` 依赖 `ORCHESTRATOR_URL` env，未配置即整体降级），桌面真正的「测试连接」走本地 BYOK（`ipc-handlers/model-provider.js:104`） |
| 历史动机 | ✅ | 表随 ops-center 集成 monorepo 的 `f6086ada4` 带入；2026-08-10 批次只增强管理面字段并**书面声明**「桌面端消费（官方 Key 回退路由、许可证服务端验签）需商业模式确认后另行接入」（`ops-center/docs/PRD.md:897-906`、`openspec/specs/ops-center/keypool-license/spec.md:7`）；最可能录入动机见 `01-docs/PRD-MODEL-PROVIDER-TEST-REAL-CALL.md:59`（把读 `official_keys` 做真实连通测试写成数据来源优先级第 3 项） |
| 行尾与编码对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；改动文件字节扫描无 U+FFFD |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` PASS |
| 文档同步（doc-gate） | ✅ | 本次为既有文档的事实性增补（交接文档新增 §6.1），不新建 PRD 索引项；`Doc Sync Gate` 在 CI 复核 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（无代码/样式变更） |
| QM-6 CCG 双模型外部评审 | N/A（docs-only 通道豁免） | 结论为可复核的取证陈述（每条带 file:line），非设计裁决；残留不确定已在 §6.1 G 段如实记录 |
| 远程同步 | PASS | 已合并 #3339 = `41ea7ca8ed7eaae88ddd34fde86972a5796a2443`，committer 2026-10-11T19:57:15+08:00。取证：`git log origin/main --grep="(#3339)" --format="%H %cI"` 唯一命中，`git ls-remote --heads origin handoff-q1-investigation` 返回 **0 行**（远端分支已删）；本行与记录文件远程同步行、frontmatter 三 `sync_*` 字段删除、`scripts/gate-record-debt-ledger.json` 登记项删除已在**同一次提交**完成 |

### 遗留（不假装已闭合）

- **主观意图无法由代码证明**：代码只能回答「这批 Key **能被**什么消费」，回答不了「录入时为什么」。最可能是「验证某供应商 Key 能否连通 / 集中登记凭据」；运营侧记忆能对上该场景，Q1 才算彻底闭合。
- **该结论会随代码演进而失效**：一旦第二阶段按 PRD §4 建供给池并接线 `get_active_keys_for_tier()`，本文「零生产调用」的判断即作废——届时以新取证为准。
- **`official_keys` 与 PRD §4 表结构不对齐**（缺套餐总额度/已用量/有效期/采购折扣系数）的收敛方式（扩表 vs 新建 `provider_plans`）未在本文定案，留待第二阶段 `/opsx:propose` 决策。
