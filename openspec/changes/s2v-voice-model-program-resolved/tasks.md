# s2v-voice-model-program-resolved 变更任务

> 隔离说明：本变更为**运行时代码变更**（apps/ + ops-center/），按 AGENTS.md 分层分支策略在独立 worktree `<repo parent>/mp-worktrees/mp-voice-model-program-resolved`（分支 `voice-model-program-resolved`，D 盘非 C 盘）完成，经 PR + CI 后 squash 合并回 main。

## 0. 阶段 1：契约与规格（openspec 五件套）

- [x] 0.1 `proposal.md`（Why / What Changes / Capabilities / Impact）
- [x] 0.2 `design.md`（决策 D1-D4 / 风险表 / 迁移计划）
- [x] 0.3 `specs/s2v-voice-model/spec.md`（ADDED 3 Requirement + MODIFIED 2 Requirement）
- [x] 0.4 `tasks.md`（本文件）
- [ ] 0.5 PRD：`01-docs/PRD-S2V-VOICE-MODEL-PROGRAM-RESOLVED-2026-10-18.md`（新建，含数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字/验收标准）
- [ ] 0.6 PRD 索引更新：`01-docs/PRD-video-creation.md` + `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` + `01-docs/PRD.md` 索引表

## 1. TDD：先写测试（红）

- [ ] 1.1 跨层一致性测试 `apps/desktop/electron/services/voice-model-resolution-parity.test.js`（前端 composable 口径 vs 主进程 `resolveProviderDefaultModel(provider,'tts')`，同夹具逐项相等）
- [ ] 1.2 `useTtsVoices.test.js`：新增 `resolveVoiceModelForProvider` 四级优先级用例（用户默认 / 运营默许 / provider 级默认 / 多模态 fail-closed / 单能力 `models[0]` 兜底）；既有 MiMo 用例断言下拉隐藏语义不变
- [ ] 1.3 `S2vConfigPanels.test.js`：新增「语音模型」配置项不存在（全 provider）用例；既有白名单桩自动覆盖删除后的契约
- [ ] 1.4 `CreateView.test.js`：改写 2026-09-18 MiMo 两条用例（`voiceModelItems` 长度 0 → 保持 0，但去掉 mimo 专属描述）；改写 2026-08-09 多模态用例（不再断言 `s2vVoiceModelOptions` 可见性，改为断言 `voiceModel` 被静默解析）
- [ ] 1.5 ops-center `test_model_presets_api.py`：`capability_models` 全类别校验用例（单能力 provider 缺类别默认模型可保存；填的值 ∉ models → 400；多模态缺能力默认模型仍 400）
- [ ] 1.6 ops-center `test_model_presets_api.py`：`GET /capability-overview` 端点用例（含隐藏项不计入、按类别分组、缺省项 `is_configured=false`）
- [ ] 1.7 ops-center `test_model_catalog_api.py`：目录同步项含 `capability_models`（单能力 provider 也带类别键）

## 2. 阶段 2：运营中心后端（先于桌面端上线，保证配置先到位）

- [ ] 2.1 `models.py`：`ModelPreset` docstring 更新（`capability_models` 语义扩为"按 provider 类别/能力给出默许模型"）
- [ ] 2.2 `model_preset_service.py`：`upsert_model_preset` 增加 `capability_models` 全类别自洽校验（非空值必须 ∈ models；键必须是该 provider 的类别或其 capabilities 之一）
- [ ] 2.3 `model_preset_service.py`：`ensure_catalog_seeded` 增加幂等回填（单能力 provider：`capability_models[category] = default_model`，仅该键缺失时）
- [ ] 2.4 `model_preset_service.py`：新增 `capability_overview(db)` 聚合查询
- [ ] 2.5 `routers/model_presets.py`：新增 `GET /api/v1/model-presets/capability-overview`（admin）
- [ ] 2.6 `_to_catalog_item` / `_to_dict` 输出 `capability_models`（既有，确认单能力 provider 也返回非空对象）

## 3. 阶段 3：运营中心前端

- [ ] 3.1 `ModelPresets.vue`：能力默认模型输入区改为按 `category`/`capabilities` 动态生成；单能力 provider 显示单项；`el-select` 限定候选 + allow-create
- [ ] 3.2 `ModelPresets.vue`：新增「能力默认模型总览」卡片（矩阵表 + 缺省高亮 + 跳转编辑）
- [ ] 3.3 `ModelPresets.vue`：保存时若类别默认模型有值则同步 `default_model`（D3 兼容）
- [ ] 3.4 `frontend/src/api/modelPresets.js`：新增 `fetchCapabilityOverview`
- [ ] 3.5 `cd ops-center/frontend && npm test && npm run build`

## 4. 阶段 4：桌面端渲染层（移除下拉 + 解析口径统一）

- [ ] 4.1 `tts-voices-state.js`：新增 `resolveVoiceModelForProvider(provider)`（四级口径），`getS2VDefaultVoiceModel` 改为薄封装；**保留** `s2vVoiceModelHidden` / `s2vVoiceModelOptions` 作为内部契约（MiMo 分支与归一判定仍用）
- [ ] 4.2 `S2vConfigPanels.vue`：删除 `UiField label="语音模型"` 整块
- [ ] 4.3 `s2v-panel-contract.js`：`S2V_PANEL_STATE` / `S2V_PANEL_METHODS` 移除 `s2vVoiceModelOptions`、`s2vVoiceModelHidden`、`handleS2VVoiceModelChange`（若无其它消费者）
- [ ] 4.4 `CreateView.vue`：删除对应 computed 桥接与方法；`s2vSectionSummary` 的 `voiceSummary` 去掉模型片段；`S2V_SUMMARY_FIELDS.voice` 移除 `voiceModel`；`applyS2VPipelineDefaults` 的 `voice.voiceModel` 映射改为"解析后写入"（运营若通过 pipeline_options 下发该键，仍归一化）
- [ ] 4.5 `useTtsVoices.js`：`handleS2VVoiceModelChange` 删除或转为内部归一方法；导出面计数测试同步（20 状态 + 6 计算 + N 方法）
- [ ] 4.6 `create-view-module-utils.js`：`voice` 分组的默认字段集合确认（`voiceModel` 是否仍在"上次选项"保存集合内——保留，因快照需要）
- [ ] 4.7 `tts-voices-shared.js`：`getS2VVoiceContext` 改调 `resolveVoiceModelForProvider`，缺解析结果时 fail-closed 返回 null（不再读用户可能陈旧的 `s2vConfig.voiceModel`）

## 5. 阶段 5：桌面端主进程（确认零改动或最小改动）

- [ ] 5.1 确认 `resolveProviderDefaultModel` 无需改动（D2：口径不变）
- [ ] 5.2 `story2video-stages.js` / `project-service.js` 的 `voiceModel` 下发链路确认仍从运行快照取值（不读 UI 态）
- [ ] 5.3 `tts-voice-catalog.js` / `tts-voice-service.js` 确认能力表白名单已覆盖 minimax 多模态 + mimo 双模型（本期不改）

## 6. 阶段 6：质量节拍门禁

- [ ] 6.1 `cd apps/desktop && pnpm exec vitest run` 定向文件全绿 + 大范围回归
- [ ] 6.2 `pnpm run lint` exit 0
- [ ] 6.3 `node scripts/check-locale-sync.js`（若动 locales）— 本期预计不动
- [ ] 6.4 `cd ops-center/backend && pytest -v` 全绿
- [ ] 6.5 QM-1：`cd apps/desktop && pnpm exec electron-builder --win --dir --publish never` + asar 清单 + require 链 + 启动三层判据（stderr 空）
- [ ] 6.6 QM-4：`pnpm run test:visual:pixel`（`create-story2video-detail` 基线重取证；**从 CI 渲染产物取基线，禁止本机截图**）
- [ ] 6.7 `.quality-gates.md` 自检清单（新 PR 记录写 `openspec/records/<分支名>.md`，不回填旧载体）
- [ ] 6.8 CCG 门禁预检（`verify-quality` / `verify-change --mode staged`）

## 7. 阶段 7：文档回写

- [ ] 7.1 `CHANGELOG.md` 顶部条目
- [ ] 7.2 `01-docs/PRD-S2V-VOICE-MODEL-PROGRAM-RESOLVED-2026-10-18.md`（阶段 0.5 产物，落地时补验收实测）
- [ ] 7.3 `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md`：§4.3.1 升级为全 provider 规则；§9 目录移除 `voice.voiceModel`
- [ ] 7.4 `01-docs/PRD-video-creation.md`：§7.1.4 相关条目 + 变更记录表追加一行
- [ ] 7.5 `01-docs/PRD.md`：索引追加本 PRD
- [ ] 7.6 `ops-center/docs/PRD.md`：预设模型章节补能力默认模型总览
- [ ] 7.7 `01-docs/learnings.md` 置顶经验（跨层一致性测试模式 / 三套解析逻辑收敛教训）

## 8. 阶段 8：记忆三路沉淀 + 回读验证

- [ ] 8.1 内置记忆（DSH 会话档自动落盘 + 项目级 `~/.claude/CLAUDE.md` 相关铁律如需新增）
- [ ] 8.2 外部记忆：`01-docs/learnings.md` + gstack `~/.gstack/projects/multi-publish/learnings.jsonl`
- [ ] 8.3 EverOS：`POST /api/v1/memory/add` → `/flush`（`extracted`）→ **落盘 grep 哨兵词** `voice-model-program-resolved`
- [ ] 8.4 `.agent_context/voice-model-program-resolved.md` 现场记录

## 9. 阶段 9：PR 与自动合并

- [ ] 9.1 commit（分支守卫自动声明）+ push
- [ ] 9.2 `gh pr create`（正文含隔离声明 + 门禁证据 + QM-1/4 证据）
- [ ] 9.3 CI 全绿（`gh pr checks` 零 pending / 零 fail；`node scripts/classify-docs-only.js` 应判 `false`）
- [ ] 9.4 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` OK
- [ ] 9.5 `gh pr merge <n> --squash --delete-branch`（产物取证：state=MERGED + mergeCommit.oid + 远端分支 0 行）
- [ ] 9.6 收尾：`node scripts/check-branch-merged.js --ref <tip> --merge <SHA>` 退出码 0 → `git tag retire/<branch>-<date>` → worktree 按 R1-R5 清理
- [ ] 9.7 回读 main push 的 `quality-gate.yml` run（conclusion=success），读数写 PR 评论
