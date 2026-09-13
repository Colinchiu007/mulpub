# Tasks — prompt-engine-evolution-p1b-memory

> 进度单一来源：以本文件 checkbox 为准。实现前先写/改测试（TDD）。
> 双模型审查（Codex + 主代理复核，2026-08-13）：C1/C2/M1-M6/m1-m9 已全部纳入本清单。

## 审计与前置

- [x] 基线差异审计：fingerprint.js（PR #752）+ P0 采集器已合入 main；本 change 只承载记忆库/治理/IPC 真实待办
- [x] OpenSpec change 创建：proposal → design → specs → tasks 并 validate 通过

## 实现（codex/prompt-engine-evolution-p1b-memory 分支）

### 任务 1：prompt-memory.js 记忆库 V0（TDD）
- [x] `prompt-memory.js`：library.json 索引 + templates/<id>@<version>.json；load/list/listActive/get/saveLearnt/activate/deprecate/disable/refreshFingerprints
- [x] 数据模型：模板含 mode、sourceText（concept ≤2000 截断）、fingerprint（由 concept 计算落盘）；learnt fragment 四类参数白名单；dictVersion stale → sourceText 重算 / 无 sourceText 标 stale；fingerprint 缺失 fail-close 不参与检索
- [x] 版本化优先级（m9）：checksum 完全碰撞 → 拒绝；同 learnedFrom + 指纹相似 → 升版；否则新 id
- [x] 写盘原子性（临时文件+rename）、损坏库 fail-close 重建
- [x] 测试目标：`prompt-memory.test.js` —— 四类参数拒绝 / mode 枚举 / stale 重算与标 stale / fingerprint 缺失 fail-close / 版本优先级 / 原子写 / 损坏重建 / listActive 仅 active（23 通过）

### 任务 2：governance.js 治理层（TDD）
- [x] `governance.js`：门禁 6 规则——structure（engine/mode 分档 + compositionType 值域校验，action/object 与 customAction/customObject 映射表，parity 测试）、compliance、length、noSecrets（预编译 token 表，不拼用户输入进正则）、dedup（checksum 精确去重，近重复聚类 P2）、evaluatorVersion
- [x] 状态机合法/非法边；V0 仅人工确认激活（数据确认阈值 P2，不实现）
- [x] 滑窗回滚（N 期阈值 + 峰值下滑 + 冷却防抖 + 可注入时钟 + statsProvider 可注入）；配额（视频零、图片 dailyBudget 超限降级）
- [x] 测试目标：`governance.test.js` —— 6 规则逐条 / 状态机边表 / 回滚+冷却幂等（注入数据）/ 配额降级不阻断（17 通过）

### 任务 3：IPC + preload + 接线
- [x] `ipc-handlers/generation-feedback.js`：`prompt-library:list` 升级为真实列表且**保持 P0 envelope `data:{templates, evolution}`**；新增 `get/save/activate`；save 入参 `{engine, mode, type, content, concept, eventId}`（mode 枚举校验、eventId evt_ 前缀校验）
- [x] `core/error-codes.js`：`EC.TEMPLATE_INVALID:-20 / TEMPLATE_GATE_FAILED:-21 / TEMPLATE_NOT_FOUND:-22 / TEMPLATE_BAD_STATE:-23`
- [x] `preload/system.js`：promptLibraryGet/Save/Activate + `npm run build:preload` 同步 bundle（键数断言同步更新）
- [x] 接线：`bootstrap/phase1-context.js` env `MP_EVOLUTION_ENABLED === '1'`（默认关）构造 promptMemory/governance 单例 + 注入 statsProvider
- [x] 测试目标：generation-feedback.test.js 新增 list envelope 兼容 / save 缺或非法 eventId / 非法 mode / activate 不存在 / EC 数值断言；preload bundle 键数（20 通过）

### 任务 4：集成 + 兼容 + 文档门禁
- [x] 集成测试：memory.listActive → fingerprint.findSimilarTemplates 全链路（active 命中 / deprecated 不命中 / fingerprint 缺失不参与）
- [x] 兼容测试：空库 `prompt-library:list` 返回 `{code:0, data:{templates:[], evolution:...}}`；fingerprint.js 零改动
- [x] CHANGELOG、`.quality-gates.md` 自检记录、tasks.md 全部勾选

## 收尾

- [ ] 双模型审查（Codex + Claude；Antigravity 地区不可用按降级路径）实现 diff，CRITICAL 修复后重审
- [ ] 提交/推送/PR/合并（codex/ 分支 → main）；OpenSpec archive + CCG task 归档三同步