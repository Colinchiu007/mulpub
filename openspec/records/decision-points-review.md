---
record: decision-points-review
task: 决策点专项对抗评审——5 个决策点补审（S1/S2 裁决 + 14 条 findings），决策 2 重构、决策 4 三态化、Kokoro 质量门槛、许可证据升格，文档升 v3.2
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 待 squash 合并，merge SHA 与时间尚未可取；合并后由后续 docs PR 在同一次提交回填 PASS 并删除 sync_* 三字段
sync_backfill_owner: 本会话（与 oss-reinforcement 研究同源维护）
---

## 任务执行记录：决策点专项对抗评审（decision-points-review，2026-10-13，docs-only PR）

- **任务性质**：对已合入的 5 个决策点（PR #3472）做专项补审。动因：整体评审（CCG 双轴 + 3 轮循环）受审不均衡——决策 2 零 findings 命中、决策 4 仅间接波及，出方案方自查发现决策 2 核心论据被项目架构否证（python-backend 随应用分发 vs 「桌面产品不背 Python 依赖」）。
- **会话隔离**：共享主工作区就地编辑（01-docs/ 与 .adversarial/ 均在 Write Guard 放行清单），提交前 `scripts/session-guard.ps1 -Branch main` 声明；分支 `docs/decision-points-review` 保住提交后 main 复位。
- **判定记录**：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（11 文件：2 份修订文档 + 6 评审轨迹 + openspec 记录 + 门禁记录 + 账本）。

| 门槛 | 状态 | Fresh 证据 |
|------|------|-----------|
| 会话隔离与工作区卫生 | PASS | 共享根仅他会话 WIP 未触碰；分支隔离保留提交；EOL 两口径 numstat 对账一致（研究源文件纯 LF） |
| 第一性原因 QM-5 步骤 | N/A | 无 Bug 修复对象 |
| 数据流转 QM-5 步骤 | N/A | 无数据流转变更 |
| 修复 + 回归测试 QM-5 步骤 | N/A | 无代码修复 |
| 防止再犯 QM-5 步骤 | N/A | 无代码修复 |
| 文件尾 diff 审查 | PASS | 全文件 UTF-8 无 BOM、纯 LF；本目录全部产物 U+FFFD=0（两轮评审输出经 GBK 管道损伤的 115 个 U+FFFD 已修复/规避：Round 2 起改用内联禁读文件式 prompt，从根因消除管道双重编码） |
| 文件行数门槛 | N/A | 无受管代码文件 |
| ESLint / 测试 / 变异反证 | N/A | 无代码变更 |
| QM-1 打包 / QM-4 视觉 | N/A | 不触及 electron/ 与 UI |
| **QM-6 CCG 双模型外部评审** | **PASS** | 专项对抗循环 2 轮收敛（claude 独立家族）：Round 1（session dfbf38ac）S1 部分成立/S2 成立 + 7 findings，最低维 7.0 未收敛 → rebuttal 全处置 → Round 2（session 46204d21）**已收敛**：7/7 闭环，四维 8/9/8/8，2 条低severity 跟踪项已并入文档。前半段曾因文件读取式运行 25 分钟未收敛被超时杀死，改用内联式后成功——方法论：长文档评审用内联 prompt 禁读文件，从根因消除漫游与管道编码损伤 |
| 远程同步 | PENDING | 合并后取 merge SHA；`git ls-remote` 0 行证分支已删；回填与销账同一次提交 |

### 关键裁决留痕

1. **决策 2 重构**：「faster-whisper 不做」废止——原论据「桌面产品不背 Python 依赖」被 python-backend 随应用分发否证；否决理由改为 GPU 闭包成本（CTranslate2+cuBLAS/cuDNN）单独记账；结论=whisper.cpp CPU 默认 + faster-whisper 仅 GPU 档显式启用；本条标低置信/侧重审
2. **决策 4 三态化**：补「探针无定论→监控项+基线存档」第三态；三态③绑定 F11 探针清单三项判据
3. **Kokoro 质量门槛**：中文盲评/CPU 延迟/音色数三项量化验收——「许可只解决能不能，需另立好不好」
4. **camofox 许可证据升格**：MIT+MPL+MPL 三件套从断言升格已核验（2026-10-13 取证）；MPL 未自分发边界成文

### 遗留项（如实记录）

- 评审提出的「n≥15 样本量统计依据」（F6 扣分点）为跟踪项：B1 PRD 阶段需补方差/功效说明或按平台历史数据校准
- 实施计划 13 个 Findings 仍未进入开发（等用户对 5 个 v3.2 决策点最终确认）
