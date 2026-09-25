# Summary — RenderEngineAdapter 开发计划（Phase 1.3）CCG 对抗评审

## 轮次与分数曲线

| 轮 | 完整性 | 一致性 | 清晰度 | 可行性 | 安全性 | 加权 | 判据 |
|----|------|------|------|------|------|------|------|
| v0.1（评审前） | 7.0 | 7.0 | 8.0 | 6.5 | 7.0 | **7.03** | 未收敛（<8.0） |
| v0.2（1 轮修订后复评） | 8.5 | 8.7 | 8.7 | 8.3 | 8.5 | **8.52** | ✅ 收敛（≥8.0） |

家族校验降级为单主机双角色（无跨家族 runner），已如实标注。1 轮完整循环收敛。

## 问题闭环（8 条，全接受，L3 拒绝 0/3）
- **决策完备性**：P1（REM-2 降级 = registry 工厂组合注入 FFmpegAdapter，调 `compose()` 内核，final_review 位置不变）、P2（接缝 = VideoCompose 私有覆写，base_tool 零改动）——v0.1 把该两个决策挂在"开放问题"里，违背 Phase 1.3 产物"决策完备"标准，v0.2 全部拍板并回写架构 §11（A8/A9）。
- **补基线洞**：P3 = 新增 COMP-1 场景（`operation=compose` 与 `_render` ffmpeg 共享内核，compose 入口此前无任何结构等价保护）。
- **纠正 L1 矛盾**：P5 = T5 验收引用 get_info 逐字段等价但无对应工作项，且架构 §5.4 的 preflight_all 组装承诺在计划中无落点——取方案 (a)，T5 增 get_info 数据源切换（架构 A10）。
- **估时诚实化**：P4 = T0 拆 T0a(2h)/T0b(4h)，P0 总量 25h→28h 如实上调，不复犯前两轮点名的"低估"。
- **收人工裁量口**：P6 = 字符串分派清零从"grep + 除外子句"改为 ast 白名单门禁用例；P8 = 单 PR + 片级 commit 语义写死。
- **堵审计空壳**：P7 = npx 供应链安全用例必须穿透 facade 转调的 `hyperframes_compose.py` 真实子进程链。

## 最重要收获
1. **P5（L1）**：出方案方自己写出的验收条款与自己的改动清单互相矛盾，是"卡片看着齐、字段对不上"的典型——评审按"验收项必须有工作项支撑"逐卡核对才暴露。
2. **P1/P2**：v0.1 的"开放问题"里有三个是评审可直接给出唯一合理答案的（现状代码证据充分：渲染路径全经 `self.run_command`；remotion-else 走 `_compose` 且经 ⑦）——把可拍板的问题挂账给实现者 = 把决策成本偷渡到 Phase 2。
3. **P7**：薄 facade 的安全审计若止步于 adapter 边界就是自欺；审计范围必须跟着真实子进程走。

## 评审同时认账的优点
T0"基线 commit 早于实现 commit"的可查证判据、§3.3"mock 进程执行 ≠ mock 决策逻辑"的划界、§3.4 每片可独立 revert + T5 可退回过渡态的止损设计、GOV-3 显式断言 runtime_swap 覆盖边界防"顺手扩大"——均直接承接前两轮 CCG 的教训。

## 结论
开发计划 v0.2 达进 **Phase 2（编码实现）** 门槛：T0a 起步，worktree 隔离（`scripts/start-mp-task.ps1 -TaskName render-engine-adapter`）+ TDD + 片级 commit + `cd packages/python-backend && pytest` 门禁。

> 任何运行时代码动笔前须经用户确认，并过 `scripts/pre-code-edit-guard.ps1`。
