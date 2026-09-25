# Rebuttal v1 — 架构方逐条回应

| id | 决定 | 理由/证据 | 落点 |
|----|------|-----------|------|
| A1 | **接受** | 真二义。写死：`resolve()` 只按 composition_mode + render_runtime 字符串路由；preflight/validate 仅上报与 fail-fast，绝不参与选引擎；remotion 降级唯一入口是 RemotionAdapter.render。 | §4 新增硬规则、RF-2 |
| A2 | **接受** | 权威定为 `req.resolved_cuts`；`edit_decisions.cuts` 为原始仅元数据。 | §2 RenderRequest 注释 |
| A3 | **接受（并据此收缩范围）** | 评审正确：atelier 转 adapter 超已签字 PRD 的三引擎 P0 边界，且 `_render_via_atelier`/`_run_atelier_checks`（约 L739-1006）逻辑重、覆盖弱，行为保持下扩大爆炸半径。**P0 不抽 AtelierAdapter，atelier 原样留 orchestrator 短路**；转 adapter 降级为后续项。删 T4b、回退 D1。 | §1/§4/§7 D1/§9 |
| A4 | **接受** | raw_inputs 加硬约束：过渡期只读、禁承载已被 context 字段表达项；T5 退出标准=三 adapter render 路径 raw_inputs 命中为 0（或白名单）。 | §2/§8 验收 |
| A5 | **接受（文档一致性）** | PRD §4 为示意伪代码，以本架构冻结的类属性为准；在 PRD 加勘误链接。 | §3 + PRD 勘误 |
| A6 | **接受** | 补 chokepoint 供应链项：npx 调用须锁定版本/本地 node_modules 解析，禁调用方可控任意包名；入安全用例。承认为既有行为、非本次引入，但统一审计正当其时。 | §3/§6/§8 |
| A7 | **接受** | T0 显式含"子进程调用捕获接缝（复用 base_tool.run_command）"作为结构等价断言前置。 | §9 T0 |

## 净结果
- 全部接受并落入架构 v0.2；**A3 触发实质收缩**（去掉 atelier adapter 化，降风险、贴回 PRD 边界），本轮修订方向是"删东西"而非"加东西"，与评审判据一致。
- L3 拒绝数 0/3。
