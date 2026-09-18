# PRD — CreateView.vue 技术债拆分（分批重构专项）

> 版本：v1.0 ｜ 日期：2026-09-18 ｜ 状态：第一批已交付（#1953），后续批次规划内
> 关联：`scripts/debt-baseline.json`（债务基线）、`AGENTS.md` QM 债务熔断门禁

---

## 1. 背景与问题

`apps/desktop/src/views/CreateView.vue` 是创作页（视频创作全流程入口），长期堆积至 **6510 行**（template 1472 + script 5037），触发债务熔断门禁 `MAX_FILE_LINES 6510 > 6497（基线）`，迫使基线被放行至 6511（2026-09-18 CI 治理），技术债持续累积。

**诊断结论**（2026-09-18 全量结构扫描）：

| 区域 | 行数 | 特征 |
|---|---|---|
| template | 1472 | 视频创作全流程 UI |
| script 模块级区 | ~495 | 40 个纯函数/冻结常量（pipeline 归一化、S2V 快照挑选、超时竞速、枚举） |
| script data() | ~170 | 大块初始 state |
| script computed | ~520 | 6 个 30 行级计算属性 |
| script watch | ~26 | |
| script methods | **~3770** | **242 个方法**，最大单方法仅 114 行——「广而散」，无巨型方法 |

功能域识别（methods 内聚簇）：S2V 配置/声音克隆/提供商管理（s2v* 约 30+ 方法）、pipeline 编排状态机（pipeline*/orchestration* 约 40+ 方法）、模板管理、历史记录、批量删除、发布配置等。

## 2. 目标与非目标

**目标**：
- G1：`MAX_FILE_LINES` 回到历史基线水位（≤6497）且后续批次持续下降；
- G2：拆分物可独立单测（纯函数/utils 化）；
- G3：零行为变更（搬运不重写，测试回归锁定）。

**非目标**：
- 不做 Options API → setup 的整体范式改造（242 方法全动风险不可控，除非后续专项）；
- 不改任何业务逻辑/UI 呈现。

## 3. 方案对比与选择

| 方案 | 说明 | 风险 | 收益 | 结论 |
|---|---|---|---|---|
| A. 整体 setup + composables 改造 | 全量重写 script | 高（242 方法全动） | 最大 | ❌ 拒绝（超出单 PR 边界） |
| B. 功能域方法群抽 mixin | Options API 原生支持，this 语义不变 | 低-中 | 每批 -400~600 行 | ✅ 后续批次采用 |
| C. 模块级纯函数抽 utils | 纯搬运零风险，可独立单测 | 极低 | -361 行（首批实际） | ✅ **第一批采用** |

**分批计划**：
- 第一批（✅ #1953 已交付）：模块级纯函数/常量 → `video-creation/create-view-module-utils.js`；
- 第二批（规划）：S2V 声音克隆/提供商管理方法群 → mixin；
- 第三批（规划）：pipeline 编排状态机方法群 → mixin；
- 第四批（规划）：模板管理 + 历史记录方法群 → mixin。

## 4. 第一批交付（#1953，已合并）

- `CreateView.vue` **6510 → 6149 行**（-361）；
- 新文件 `apps/desktop/src/views/video-creation/create-view-module-utils.js`（445 行，40 个具名导出）：`normalizePipelineStage/normalizePipelineStages/mergePipelineStages/normalizePipelineRunMeta/createPipelineRunMeta*`、`pickS2VConfigProfileFields/pickS2VOutputProfileFields`、`settleHistoryRequest`、`cloneJsonValue` 及全部冻结枚举（PIPELINE_*_STATUSES、S2V_CONFIG_PROFILE_FIELDS、AUTO_PIPELINE_STAGES 等）；
- 顺带清理 10 个组件未引用的死导入。

### 验收标准与验证

| 验收项 | 结果 |
|---|---|
| 纯函数单测（新增 `create-view-module-utils.test.js`） | 11/11 绿（3 处断言按实现真实语义校准，零行为变更原则） |
| CreateView.test.js（既有 282 例） | CI 完整环境全绿 |
| eslint | 0 problems |
| 债务熔断 | `maxFileLines 6150`（< 6511 放行值，回到改善通道） |
| CJK 门禁 | 基线随纯搬运路径迁移更新（1644→1562，净减 82 条陈旧+迁移条目），`--cjk` PASS |

### 过程教训（沉淀）

1. 模块级区域的中文常量（STYLES/COST_LABELS/平台标签等 24 处）随文件搬运会触发 CJK 基线路径失配——**纯搬运场景 `--update-baseline` 合规**（需验证 diff 仅含路径迁移）；
2. 大文件拆分必须走「机械搬运 + import 完整性由 eslint no-undef/no-unused-vars 双向保障」，禁止顺手重写。

## 5. 后续批次验收标准（规划）

- 每批减量 ≥300 行且 `check-debt-budget` 全绿；
- mixin 抽取后 CreateView.test.js 全量回归绿 + 该功能域新增针对性单测；
- 全部批次完成后 CreateView.vue 目标 ≤3000 行（template 保留 + 组装层）。
