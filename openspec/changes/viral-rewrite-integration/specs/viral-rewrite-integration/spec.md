# viral-rewrite-integration Capability Spec

## ADDED Requirements

### Requirement: 爆款分析结果落库

爆款分析页 SHALL 在分析成功后提供「存入爆款库」操作，把分析结果写入 viral_library，使其可被改写引擎「结合爆款库」检索。

#### Scenario: 成功落库

- **WHEN** 用户点击存入按钮且 `analyzedTopic` 快照非空、`result` 有效（无 error、未保存过、非 saving 中）
- **THEN** 经 `knowledge-library:add-viral` 写入条目 `{title: analyzedTopic≤500, content: 分析报告(非空), tags: [平台,...角度,...关键词]≤50, platform≤50, source:'manual', likes:0, comments:0}`，按钮进入终态「已存入爆款库」

#### Scenario: 守卫与失败

- **WHEN** result 为空/含 error/已保存/保存中，或 analyzedTopic 为空（分析后编辑主题）
- **THEN** 不发起 IPC 调用
- **WHEN** 服务端返回非 0 或抛异常
- **THEN** 按钮恢复可点，消息容器（aria-live="polite"）显示 `res.message` 或 i18n `viralAnalysis.saveFailed` 兜底

#### Scenario: 状态重置

- **WHEN** 用户再次执行「爆款分析」
- **THEN** `savedToLibrary/libraryMessage/analyzedTopic` 全部重置（`doGenerate` 不重置）

### Requirement: 标题参考软约束（titleHint）

系统 SHALL 支持把爆款文案生成的标题经 `/rewrite?titleHint=` 带入改写页并注入改写 Prompt。

#### Scenario: chip 预填与移除

- **WHEN** RewriteView 挂载且 `route.query.titleHint` 为非空字符串
- **THEN** 显示 chip「标题参考：<trim+200 截断的 hint>」与「移除」按钮（rewriting 期间 disabled）；点击移除后 chip 消失且后续改写不携带 titleHint

#### Scenario: 引擎注入

- **WHEN** `aiRewrite` params 携带 titleHint
- **THEN** 引擎 `_sanitizeTitleHint`（非字符串/空白 → null；`\s+` 折叠；>200 截断）通过后在 userPrompt **模板替换之后**追加「## 标题参考（软约束）」块，块内含「「<hint>」」定界引用；无效时 Prompt 与既有行为逐字节一致

### Requirement: 改写质量评估第 4 维（爆款潜力）

改写引擎 SHALL 在注入 viralScorer 时对原文与改写文并行评分，产出爆款潜力对比；未注入或失败时行为与既有版本一致。

#### Scenario: 正常产出

- **WHEN** viralScorer 对两侧返回 `{score: 有限数字, mode: 'X'}` 且两侧 mode 相同
- **THEN** `result.viral = { original, rewritten, delta, mode }`，分数四舍五入到 1 位小数，delta = rewritten − original

#### Scenario: fail-open 与量纲防护

- **WHEN** scorer 抛错 / score 非有限数（NaN/Infinity）/ 两侧 mode 不一致 / scorer 未注入
- **THEN** 不产出 `result.viral`，改写主流程 success 不受影响（mode 不一致记 warn 日志）

#### Scenario: 主进程评分器

- **WHEN** `ViralEngine.scoreText(text)` 被调用
- **THEN** 空/非字符串输入返回 null；orchestrator 路径使用**独立 8s 超时**，返回值经 `Number.isFinite` + `clamp[0,100]`；orchestrator 不可用/非法时回退本地启发式并标记 `mode:'local-fallback'`，降级原因写入日志

#### Scenario: 渲染端展示

- **WHEN** 改写响应含合法 `viral`（original/rewritten 均为有限数字）
- **THEN** 质量报告显示「爆款潜力：改写前 X → 改写后 Y（变化 Z）」（delta null 显示 `-`）；无 viral 字段时该行不渲染，原三维报告不受影响
