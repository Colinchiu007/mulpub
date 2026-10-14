---
record: preset-readonly-guard
task: 预设服务商模型列表只读保护（数据驱动判据）
date: 2026-10-14
---

## 本次执行记录：预设服务商模型列表只读保护（改数据驱动判据，修一处从未生效的保护）（preset-readonly-guard，2026-10-14）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 混合 PR（渲染端 SFC + locale + 新增 util/测试）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-preset-readonly-guard`（分支 `preset-readonly-guard`，基线 `7807d9b32`）；依赖 `pnpm install --frozen-lockfile` 完成 |
| 第一性原因（QM-5 ①） | PASS | **保护曾经存在过，但一次都没生效**。原判据是「是否连上运营中心」，而那个判断在所部署版本里**恒为假** ⇒ 预设服务商的模型输入框始终可编辑。后果：用户改了，下次 `ModelProviderManager.applyCatalog()` 在目录项带完整 `models` 数组时**整表覆盖**（`UPDATE model_providers SET models = ?`，见 `model-provider-manager.js:1017-1019`）⇒ 用户改动被**静默冲掉**，且无任何提示。**它得以长期静默失效的直接原因：判据是内联 computed，不可单测** |
| 逃逸分析（QM-5 ②） | PASS | ①**测试层**：原判据内联在 `ModelProviders.vue` 的 `computed` 里，依赖 `providers`/`form` 两个 ref，**无法在不挂载组件的情况下单测** ⇒ 恒假也无从发现；②**审查层**：`:disabled` 绑定看着合理（"连上才锁"），形状上不像 bug；③**验收层**：没有端到端判据回答"我改的预设模型保存后会不会被冲掉"；④**观测层**：覆盖发生在同步成功之后，日志只有 `applyCatalog: updated=N`，不与用户编辑行为关联 |
| 修复 + 回归保护（QM-5 ④） | PASS | ①判据改为**数据事实** `is_preset === true`（该字段由 `model-provider-manager.js:1241` 持久化并暴露给前端，语义=此行由运营目录下发），与"此刻连没连上"无关；②抽成独立纯函数 `src/utils/preset-managed-fields.js`（`presetManagedFields(providers, editingId)`）—— 可单测是这次修复的**核心**，不只是重构；③`ModelProviders.vue` 的 `modelsText` 输入框加 `:disabled="isPresetEditing"` + 只读提示；④locale zh/en **成对**新增 `modelsReadonlyHint`；⑤回归锁 **8 条**：编辑预设→只读、编辑自定义→可编辑、老行缺 `is_preset`→按非预设、新增→可编辑、列表缺失→fail-open、非数组→fail-open、**判据与连接状态无关**、`is_preset` 必须严格 `true`（拒字符串 `"false"` 与数字 `1`） |
| 防止再次发生（QM-5 ⑤） | PASS | ①纯函数模块的文件头注释写清"为什么抽出来"（内联不可测是它长期失效的直接原因）与"为什么用数据事实而非连接状态"（后者易变、无法用固定夹具覆盖）；②本笔教训进三处记忆；③**遗留（不假装已闭合）**：只锁了模型列表，未锁限流字段（`rate_per_minute`/`limit_per_5h` 也会被目录覆盖）—— 那两个字段在当前 UI 里本就是只读展示（`form-hint`），故本次不扩范围 |
| 反证（变异） | PASS | 把 `presetManagedFields` 退回历史 bug 形状（`return false`）⇒ **3 条失败**（`编辑预设服务商 → 只读`、`判据与「是否连上运营中心」无关`、`is_preset 必须是严格 true`），`AssertionError: expected false to be true`；还原 ⇒ **8 passed**。脚本以字节级回写自证还原完整 |
| 编码与行尾 | PASS | 两口径 `numstat` 一致；locale zh/en 成对（`check-locale-sync --pair-base` PASS） |
| QM-1 本地打包 | PASS | `pnpm run build:dir`（= `build:vue` + `electron-builder --dir`）**rc=0**；`Multi-Publish.exe` 与 `app.asar` 均存在；**产物级证据**：`presetManagedFields` 与 `modelsReadonlyHint` 均进入 `dist/assets/index-*.js`，且该 bundle 在 **asar 内**（asar 提取后命中 1 文件）。构建曾重写 3 个生成文件（`home-shell-preload.bundle.js`/`preload/index.bundle.js`/`card-paginator.iife.js`），两口径 `numstat` 均为空（纯行尾）⇒ 按 R2 **精确恢复**，未混入本 PR |
| QM-4 视觉回归 | N/A | 只给既有输入框加 `:disabled` 与一行提示，未新增界面元素/样式 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PASS | merge `8f8a40cfe0c86ae65325a272d64ff58d6b7da8fa`（2026-10-14 23:18:11 +08:00）；PR 已 MERGED，远端分支 `ls-remote` 0 行 |
- 保留门禁：行尾对账 ✅ | 品牌残留 PASS（9031 文件）| locale 成对 PASS | CJK 基线 PASS（1374→1224）| 键存在性 PASS（2004）| 测试接线 PASS | 债务熔断 PASS | 远程同步 PASS（merge 8f8a40cfe，远端分支 0 行）

### 备注

**为什么不锁限流字段**：`rate_per_minute`/`limit_per_5h` 同样会被目录覆盖，但它们在当前 UI 里已是**只读展示**（`form-hint` 文本，非输入框），没有可编辑入口，故本笔不扩范围。若日后把它们改成可编辑，须同步加锁。
