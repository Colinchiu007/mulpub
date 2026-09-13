## ADDED Requirements

### Requirement: 独立流水线编排
`video-clone-pipeline` SHALL 提供独立于 Story2Video 的六阶段编排（ingest → analyze → plan → generate → compose → publish），阶段实现以 adapter 注入方式提供；未接线的阶段 SHALL fail-closed（返回 `VIDEOCLONE_STAGE_NOT_IMPLEMENTED`），不得静默跳过。

#### Scenario: 全链路注入运行
- **WHEN** 注入全部六阶段 adapter 且各阶段成功
- **THEN** `run(request)` 返回 `{ ok: true, runId, report, similarity, publishResult }`，阶段按 ingest→…→publish 顺序执行一次

#### Scenario: 未接线阶段
- **WHEN** 某阶段未注入实现（默认 adapter）
- **THEN** 流水线停止于该阶段，返回 `{ ok:false, error:{ code:'VIDEOCLONE_STAGE_NOT_IMPLEMENTED', phase:'<stage>' } }`，且不执行后续阶段

#### Scenario: 请求校验前置
- **WHEN** request 的 source 类型非法、replicationLevel 不在 L0/L1/L2、mode 非法或 source.path/url 缺失
- **THEN** 在任何阶段执行前返回 `{ ok:false, error:{ code:'VIDEOCLONE_INVALID_REQUEST' } }`

### Requirement: CloneReport 契约与校验
`clone-report` SHALL 提供 7 层报告结构（meta/narrative/script/scriptStyle/visual/audio/elements/platformParams/replication）的校验、归一化、编辑往返与 IPC 脱壳：校验 SHALL 拒绝非法枚举、负时长、时间轴重叠/倒置、缺失必填字段；编辑 SHALL 返回新对象并重新校验（失败抛错）；`sanitizeReportForIpc` SHALL 深拷贝（不含共享引用）。

#### Scenario: 合法报告通过
- **WHEN** 报告满足 schema（枚举/数值/必填全部合法）
- **THEN** `validateCloneReport` 返回 `{ ok:true, errors:[] }`

#### Scenario: 时间轴约束
- **WHEN** timeline 存在倒置（t1<=t0）、负值或跨段重叠
- **THEN** 返回错误并拒绝

#### Scenario: 非法报告拒绝
- **WHEN** 报告含非法 platform/aspect/level/mode、durationSec<0、timeline t1<=t0、缺 script.fullText
- **THEN** 返回 `{ ok:false, errors:[...] }`，每条含字段路径与原因

#### Scenario: 编辑往返
- **WHEN** 对合法报告执行 `editReport(report, { path, value })`
- **THEN** 返回新对象（原对象不变），且新对象通过校验；非法 patch 抛 `VideoCloneError`（`VIDEOCLONE_REPORT_EDIT_INVALID`）；禁止 `__proto__/prototype/constructor` 路径段（防原型污染）

#### Scenario: IPC 脱壳
- **WHEN** 对报告执行 `sanitizeReportForIpc`
- **THEN** 返回独立深拷贝，修改结果不影响原对象（无共享引用）

### Requirement: 相似度自检（F4）
`similarity` SHALL 提供四项指标（时长偏差、结构相似度、文案相似度、风格重叠）与综合报告 `computeSimilarityReport`：综合分由四项加权（结构 0.35 / 文案 0.25 / 风格 0.25 / 时长 0.15），并输出各指标明细与达标判定（P1/P2 阈值取自 PRD §3）。

#### Scenario: 完全一致
- **WHEN** 成片与原片时长一致、结构/文案/风格完全相同
- **THEN** 综合分 ≈ 1.0，全部指标 PASS；若文案相似度 >0.9 同时输出 verbatimScript 照抄警告（合规提示，不影响判定）

#### Scenario: 明显偏离
- **WHEN** 时长偏差 > 20% 或结构无重叠或文案完全不同
- **THEN** 对应指标 FAIL，综合分显著 < 1.0，报告给出未达标项

#### Scenario: 阈值可判定
- **WHEN** 时长偏差 ≤10%（P1）/≤5%（P2）、结构相似度 ≥0.8/0.85
- **THEN** 对应指标按 P1/P2 目标分别判定 PASS

### Requirement: 阶段执行器
`stage-executor` SHALL 顺序执行阶段并支持：checkpoint 断点续跑（已完成阶段跳过）、retryable 错误有界重试（可注入时钟与退避）、非 retryable 错误立即 fail-closed、进度记录（阶段/状态/耗时/错误）。

#### Scenario: 重试后成功
- **WHEN** 阶段首次抛 retryable 错误，重试后成功
- **THEN** 记录重试次数与最终成功，流水线继续

#### Scenario: 重试耗尽
- **WHEN** retryable 错误超过 `maxRetries`
- **THEN** 返回 `{ ok:false, error, retries }`，失败阶段为当前阶段

#### Scenario: 断点续跑
- **WHEN** context.progress 已标记某阶段 complete
- **THEN** 重跑时跳过该阶段，仅执行未完成阶段

#### Scenario: 非重试错误
- **WHEN** 阶段抛非 retryable 错误
- **THEN** 不重试，立即停止并返回该错误

### Requirement: 场景-测试映射
以上场景 SHALL 由 `packages/video-clone-engine/test/` 下 `node --test` 用例覆盖：clone-report.test.js、similarity.test.js、stage-executor.test.js、pipeline.test.js。

#### Scenario: 回归断言
- **WHEN** 运行 `node --test packages/video-clone-engine/test/`
- **THEN** 全部用例通过且 exit code 0
