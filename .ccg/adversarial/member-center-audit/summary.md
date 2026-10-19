# Summary — 会员中心审查方案对抗性评审循环（2026-10-19）

## 任务

- objectType: plan | maxRounds: 3 | scoreThreshold: 8.0
- 实体：`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md`
- 任务目录：`.ccg/adversarial/member-center-audit/`

## 家族快照

- proposer: GLM（glm-5.3-flash，agent lead，直接执行方）
- critic v1/v2: Anthropic（claude CLI `-p`，独立读取仓库源码抽查证据）
- 家族交集：∅（符合硬要求）
- 备注：DWS 子代理（同家族 GLM）先派发后因循环等待超时被 claude CLI 通道替代，其部分产出（MISS-9 正则同型性）被并入证据链；task.json 已如实记录双通道。

## 轮次与分数曲线

| 轮次 | 通道 | 完整性 | 一致性 | 清晰度 | 可行性 | 安全性 | 最低分 | 收敛 |
|------|------|--------|--------|--------|--------|--------|--------|------|
| v1 | claude CLI（跨家族） | 8 | 6 | 8 | **5** | 8 | 5 | ✗ |
| v1b | DWS 子代理（同家族，归入第 2 轮） | 7 | 6 | 7 | 7 | 9 | 6 | ✗ |
| v2 | claude CLI 复核 | 9 | 9 | 9 | 8.5 | 9 | **8.5** | ✓ |

**收敛原因**：最低维 8.5 ≥ 8.0（第 2 轮，未触及 maxRounds=3，无 stall）。v1b 的 13 条（含 3 条文档事实错误硬伤）与 v1 的 9 条独立发现交叉证实后全部并入 proposal-v3 实体文档（§7b 记录修订轨迹）。

## 问题统计

- critique-v1（跨家族）：9 条（high×3 / medium×4 / low×2），含 **2 条 L1 反例**（均成立）
- critique-v1b（同家族子代理）：13 条（major×5 / minor×8），含 3 条文档事实错误（loading 消费、死键漏项、删除vs拒收），全部核实成立
- rebuttal-v1：7 接受 / 1 部分接受 / 0 全拒；rebuttal-v1b：**13 接受 / 0 拒绝**
- 修订全部落回实体文档 §2/§3.1/§4/§5/§6/§7/§7b

## 关键裁决（对最终方案影响最大）

1. **升级 CTA 出口**（MISS-1，L1）：feature 判定不可行（standard/pro features 逐字节相同）→ 两步走：正向名单过渡 + rank 契约前置任务。
2. **兑换正则同型性**（MISS-9，L1）：服务端排除 I/O/0/1 字母表 → 共享常量方案，禁止两端手写。
3. **Phase1/DoD 对齐**（MISS-2/3）：深链降为 Phase2 增强项；现有 modal 测试改写为负向断言 + 结构锁。
4. **三重 free 兜底**（MISS-4）：中性态处理取代 'free' 兜底链。

## 双方共同遗漏的主动补录

§8 CTO 扫描发现 **member.js 全异步路径零 catch**（9 async/0 catch + 五个成员 IPC 方法不在 PUBLIC_METHODS + 权限错误同步 throw 变 rejected promise），MAJOR-1 定级，修复并入 Phase1 动作 4——critique-v2 复核确认证据链完整。

## 产物清单（严格配对）

```
.ccg/adversarial/member-center-audit/
├── task.json          # 元数据（converged, round=2）
├── proposal-v1.md     # 方案声明（指向实体文档）
├── critique-v1.md     # claude CLI 9 条 issue + 五维评分（converge=false）
├── rebuttal-v1.md     # 9 条逐条回应（证据分级 L1/L2/L3）
├── critique-v1b.md    # DWS 子代理 13 条独立发现（同家族，降级为第二通道）
├── rebuttal-v1b.md    # 13 条逐条回应（13 接受 / 0 拒绝）
├── critique-v2.md     # claude CLI 复核 + 收敛裁定（8.5 ≥ 8.0）
└── summary.md         # 本文件
```

## 遗留（非阻塞）

1. rank 契约前置任务需在 Phase 1 执行时与服务端协调排期；
2. 深链 `?section=` 为 Phase 2 增强项（改 goToMemberCenter 函数体，不动 style-guard 锁——C1-10）；
3. MINOR-1/2（doDeactivate 吞错、HelpSupport 静默 catch）归 Phase 3，前者随 modal 退役自然消解；
4. 本目录与实体文档建议随 docs-only PR 一并入库（.ccg/ 在 docs 白名单内）。
