# Summary — RenderEngineAdapter 架构（Phase 1.1）CCG 对抗评审

## 轮次与分数曲线

| 轮 | 完整性 | 一致性 | 清晰度 | 可行性 | 安全性 | 加权 | 判据 |
|----|------|------|------|------|------|------|------|
| v0.1（评审前） | 7.5 | 7.5 | 8.0 | **6.5** | 7.5 | **7.33** | 未收敛（<8.0） |
| v0.2（1 轮修订后复评） | 8.5 | 8.7 | 8.7 | 8.5 | 8.5 | **8.58** | ✅ 收敛（≥8.0） |

家族校验降级为单主机双角色（无跨家族 runner），已如实标注。1 轮完整循环收敛。

## 问题闭环（7 条，全接受）
- **收缩范围**：A3 atelier 从"抽第 4 adapter"回退为"原样留 orchestrator 短路"——删 T4b、总估时回到 ~25h。**本轮修订方向是"删东西"降风险，非加东西**。
- **消歧义**：A1 resolve 只按字符串路由、preflight/validate 不参与选引擎；A2 resolved_cuts 为权威。
- **补边界**：A4 raw_inputs 过渡期只读 + T5 命中=0 验收；A7 T0 含子进程捕获接缝；A6 npx 供应链锁版本。
- **文档一致**：A5 capabilities 类属性为唯一冻结源，PRD §4 加勘误链接。

## 最重要收获
1. **A3**：阻止了一次"架构整洁"名义下超出已签字 PRD 边界、把重逻辑低覆盖的 atelier 路径卷入重构的爆炸半径扩张。行为保持优先于优雅。
2. **A1**：点破"preflight 不可用是否影响路由"的二义，若实现者误判会把 locked-remotion-不可用-静默降 ffmpeg 的现状改掉。
3. **A7**：结构等价基线（PRD C1 的落地）需要可观测接缝，否则 T0 无法执行——把隐含前置显式化。

## 评审同时认账的优点
RF-1/RF-2/RF-3 三条行为事实识别（尤其 RF-3 final_review 跨引擎覆盖不一致原样保留）质量高；D5（adapter 不产 ToolResult）守住对外 schema 零变化；C10 用 pytest 门禁而非污染 JS gate 判断到位。

## 结论
架构 v0.2 达进 **Phase 1.3（开发计划/任务拆分）** 门槛。剩余 Q1（_needs_remotion 完整实现回读校准）、Q2（raw_inputs 已用 A4 约束但退出纪律要在 T5 落实）为低风险跟进项，不阻断。

> 下一步须经用户确认是否进 Phase 1.3；任何运行时代码实现须从 `scripts/start-mp-task.ps1 -TaskName render-engine-adapter` 开隔离 worktree + TDD + QM 门禁。
