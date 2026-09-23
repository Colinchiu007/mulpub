# Summary — CCG 对抗评审：PR-2 / P0-8 发布失败被动附带诊断

## 分数曲线（critic 五维度，满分 10）

| 轮次 | 完整性 | 一致性 | 清晰度 | 可行性 | 安全性 | 最低维 | 总评 |
|---|---|---|---|---|---|---|---|
| v1 | 6 | 5 | 6 | 4 | 7 | 4 | 28/50（Conditional Fail） |
| v2 | 7 | 6 | 7 | 6 | 8 | 6 | 34/50（Conditional Pass） |
| v3 | — 按 critic 放行条款免三轮全量评审：「完成 P0（N-1/N-2）+ P1（N-3/4/5）文本落定后可直接实施」；v3 已全部落实 | | | | | | **converged** |

## 逐轮统计

- Round 1：15 条（Critical 3 / Major 6 / Minor 6）→ 全部接受（13 条实质兑现进 v2，C-15 部分闭环被 v2 自身新声称破坏）
- Round 2：8 条新问题（Critical 2 / Major 3 / Minor 3）+ 1 条上轮残余（C-10）→ 全部接受，落实于 v3
- 拒绝数：0（两轮均按 L1 代码反例修证，无拉锯点）

## 关键争议与决策记录

1. **挂载架构（最大转折）**：v1「IPC 统一 handle 包装层单点挂载」被代码证伪——`createAccessControlledIpcMain` Proxy 仅拦 `handle`（license-access-control.js:256-294），发布/RPA 失败走 `webContents.send` 事件推送且形状 `{ok,message}`。终版：governor 治理链出口单点 catch-rethrow（1 处覆盖 6 个 rate/quota 出口）+ batch item 转失败处，共 2 挂钩点。
2. **弹窗面取舍**：v2 条件化透传仍被证伪（preload 无统一 invoke 包装、tag 无生产者、丢失点在 renderer 数十 throw 处）。终版按 PRD R5 明文降级路径：**首期仅日志面（保证）+ batch payload 预留字段**，弹窗面二期。
3. **探针有效性**：v1 固定探针恒过无信息量 → v3 自适应（eff.rpm≥20 用真实 effective limits 含 rateFactor；<20 降级默认探针并记 probeMode，避免低 rpm 场景恒超时假 fail）。
4. **鲁棒性合同**：永不抛（防诊断故障升级为调度器故障，挂钩点位于 `_sweepExpired` 路径）；per-`providerId:type` 缓存/节流/in-flight；setProviderLimits 失效钩子；settled 防超时后双写矛盾结论。
5. **分类器**：弃自写正则，复用生产已验证 `classifyProviderFailure`（ProviderError code 优先分支已验证覆盖排队超时文案场景）。

## 剩余问题（移交二期，已登记 PRD §10）

- story2video 通知面不接入（PRD「发布/调用」范围的已知缺口）
- 弹窗面附带结论（需先解决 renderer throw 点字段保真）
- 首错延迟回填已开弹窗（webContents.send）

## 产物配对

proposal-v1 ↔ critique-v1 ↔ rebuttal-v1 ↔ proposal-v2 ↔ critique-v2 ↔ rebuttal-v2 ↔ proposal-v3（终版，实施依据）
