---
record: oss-b1-rpa-hardening-prd
task: 开源强化 B1 开发入口——spike 实测、PRD v1.1（CCG 双轴 16 findings 收敛）、openspec change 三件套、评审轨迹入库
date: 2026-10-14
---

## 任务执行记录：开源强化 B1 PRD 与 openspec change（2026-10-14，docs-only PR）

- **任务性质**：开发前置文档交付。spike 实测（F1-c/F2 通道 7 组实验）+ B1 PRD v1.1 + openspec change（proposal/design/tasks）+ spike 证据归档。**无运行时代码变更**（开发未启动，本 PR 只落文档）。
- **会话隔离**：共享主工作区就地编辑（01-docs/ 与 openspec/ 均 Write Guard 放行清单），提交前 `scripts/session-guard.ps1 -Branch main` 声明；分支保住提交后 main 复位。
- **判定记录**：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（13 文件：PRD+spike 证据+change 三件套+评审轨迹 5+记录+门禁记录+账本）。

| 门槛 | 状态 | Fresh 证据 |
|------|------|-----------|
| 会话隔离与工作区卫生 | PASS | 分支隔离保留提交；EOL 两口径对账一致 |
| 第一性原因/数据流转/修复回归/防止再犯 QM-5 | N/A | 无 Bug 修复对象 |
| 文件尾 diff 审查 | PASS | UTF-8 无 BOM 纯 LF；U+FFFD=0（两份评审原件经 GBK 管道损伤 135 个 U+FFFD，已从上下文重写为干净版；编码门禁同源纪律） |
| 文件行数/ESLint/测试/变异反证 | N/A | 无代码变更 |
| QM-1 打包 / QM-4 视觉 | N/A | 不触及 electron/ 与 UI（视觉基线清单已列 PR-2 任务） |
| **QM-6 CCG 双模型外部评审** | **PASS（收敛）** | PRD v1.0 双轴 16 findings（后端 claude 8：3 严重 4 警告 1 信息；前端 opencode 8：3 高 4 中 1 低）全部采纳落 v1.1，无拒绝项；评审轨迹 `.adversarial/b1-prd-review/` |
| 技术预研取证（spike） | PASS | 7 组运行实验（Electron 43 实机）：H1 隔离间隙确证/双通道 document_start 时序/isolated world 隔离语义/createIsolatedWorld 参数/fresh window HUNG；命令名纠正（`Runtime.evaluateInWorld` 不存在→`Runtime.evaluate+contextId`）；证据 `spike-evidence.md` |
| 远程同步 | PASS（PR #3574 squash 合并 ⇒ 5f51de9f，2026-10-14T16:17:41+08:00；远端分支 docs/oss-b1-prd 已删（ls-remote 0 行）） | 合并后取 merge SHA；`git ls-remote` 0 行；回填销账同一次提交 |

### 关键决策留痕

1. **F1-c 选 preload 通道**（非 debugger）：spike 双通道对比——isolated world 注入零 attach 生命周期 vs debugger 四类失败模式（含与上传 per-op attach 单例冲突）
2. **存量缺陷确证**：现有 `stealth-preload.js` 的 patch 对页面主世界无效（contextIsolation 语义，运行时证据 E4b），随 B1 PR-1 修正
3. **数据驱动机制修复**：F3 A/B「错峰」勘误为同账号 TaskQueue 通道串行天然纵向交替
4. **合规基线**：法务线经产品负责人决策豁免（2026-10-14）；captcha 破解默认关保留

### 遗留项

- 开发未启动：本 change 的 tasks.md 11 组任务待 worktree（`mp-oss-rpa-hardening`）启动后执行，PR-1/PR-2 各自 QM-6 diff 级评审
- 跟踪项 5 条（n≥15 校验证/F3 去留/hash 取证/命令名文档同步/B2 注记）随批次推进
