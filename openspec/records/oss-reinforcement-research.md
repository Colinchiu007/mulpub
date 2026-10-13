---
record: oss-reinforcement-research
task: 开源强化研究——6 赛道 46 候选扫描、25 个源码级深度分析、13 Findings 实施计划、5 决策点分析，全部经 CCG 双模型外部评审 + 对抗评审循环 3 轮收敛
date: 2026-10-13
---

## 任务执行记录：开源强化研究方案（oss-reinforcement，2026-10-13，docs-only PR）

- **任务性质**：纯研究/文档任务，无代码变更。产出 4 份研究文档 + 评审轨迹（.adversarial/）。按 docs-only 快速通道执行，但 QM-6 主动执行（见下表）。
- **会话隔离**：共享主工作区就地编辑（01-docs/ 与 .adversarial/ 均在 Write Guard 放行清单），提交前运行 `scripts/session-guard.ps1 -Branch main` 声明会话分支；分支 `docs/oss-reinforcement-research` 保住提交后 main 复位 `origin/main`。过程中发现另一会话（xhs-draft-box-restore）在共享根的未提交 WIP，已停止一切宽目录写操作并未触碰其文件。
- **判定记录**：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=true（31 文件）**；保留门禁行尾对账/品牌残留/文档同步执行；重型 job 按 CI changes 短路（QG Unit Tests/Coverage/Static/Visual 等 skipping 属预期）。

| 门槛 | 状态 | Fresh 证据 |
|------|------|-----------|
| 会话隔离与工作区卫生 | PASS | 共享根 main 干净（仅他会话 WIP 未动）；分支隔离保留提交；`git ls-files --eol` 两口径 numstat 对账一致 |
| 第一性原因 QM-5 步骤 | N/A | 研究任务无 Bug 修复对象 |
| 数据流转 QM-5 步骤 | N/A | 无数据流转变更 |
| 修复 + 回归测试 QM-5 步骤 | N/A | 无代码修复 |
| 防止再犯 QM-5 步骤 | N/A | 无代码修复 |
| 文件尾 diff 审查 | PASS | 全文件 UTF-8 无 BOM；`node --test scripts/check-text-encoding-integrity.test.js` 5/5 PASS（曾因 CCG 输出管道双重编码致 4 文件 586 个 U+FFFD 被 CI 抓红，已从上下文忠实重写并本地复跑门禁通过） |
| 文件行数门槛 | N/A | 无受管代码文件 |
| ESLint | N/A | 无 JS/TS 变更 |
| 测试 | N/A | 无测试变更（研究文档） |
| 变异反证 | N/A | 无代码变更 |
| QM-1 打包 / QM-4 视觉 | N/A | 不触及 electron/ 与 UI |
| **QM-6 CCG 双模型外部评审** | **PASS（主动执行）** | 前端轴 opencode 15 条 + 后端轴 claude 10 条 findings 全部采纳；对抗评审循环 3 轮：Round 2 未收敛（最低维 7.5）→ 6 项必改 + 2 项部分落实 → **Round 3 收敛（五维均 9.0 ≥ 8.0）**。全程产物 `.adversarial/oss-reinforcement-plan/`（proposal-v1/v2/v4-final、critique×4、rebuttal×2、summary）。核心修订：F1-c 注入通道经 Electron contextIsolation 语义实证证伪原 preload 方案（改 debugger+Page.addScriptToEvaluateOnNewDocument，复用本仓 utils.js:143 已验基建）；FIND-1（Critical）法务门禁入 B1 前置；RSSHub 许可复核确认 AGPL-3.0 |
| 二进制供应链 | N/A | 无二进制捆绑（camofox/whisper.cpp 的 hash 锁定纪律已写入实施计划 F3/F5，属未来开发约束） |
| 远程同步 | PASS（PR #3472 squash 合并 ⇒ 6021edb1c，2026-10-13T18:55:06+08:00；远端分支 docs/oss-reinforcement-research 已删（ls-remote 0 行）） | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 取证 merge SHA 与时间；`git ls-remote --heads origin docs/oss-reinforcement-research` 返回 0 行证远端分支已删；回填与销账同一次提交 |

### 关键决策留痕

1. **F3 选型 camofox-browser**：CloakBrowser 二进制专有许可（BINARY-LICENSE v1.3：订阅 + 禁再分发 + OEM/SaaS 条款——产品向终端客户提供浏览器能力命中 OEM）→ 主选 MIT+MPL 链的 camofox；CloakBrowser 降备选并建议并行 OEM 咨询。
2. **F1-c 注入通道证伪与重建**：原方案「preload 注入 stealth evasions」被 `rpa-view-session.js:169` 的 contextIsolation+sandbox 实证否证（隔离世界 patch 无效，且现有 stealth-preload.js 头注为错误声明）→ 改用 `webContents.debugger` + `Page.addScriptToEvaluateOnNewDocument`（webview-manager/utils.js:143 同款基建+回归锁）。
3. **反检测法务红线（评审 Critical）**：「仅本人账号」为用户侧约束、无法传递给终端客户 → B1 启动前置法务门禁（逐平台 ToS 边界/验证码破解默认关/销售条款/官方 API 优先登记）。
4. **许可证三件套纪律**：API spdx_id 连续三次不可信（biliup MIT 文件+禁商用声明、DrissionPage NOASSERTION+自定义禁商用、XTTS MPL 代码+CPML 权重禁商用）→ 实施方案前必须 LICENSE + NOTICE/README 声明 + 模型权重许可三查。

### 遗留项（如实记录）

- CloakBrowser OEM 咨询邮件未发出（建议与法务线一并启动）
- 实施计划 13 个 Findings 未进入开发（等用户确认决策点后排期）
- 研究过程产物保留于 `01-docs/research/oss-reinforcement-2026-10-13/`，与实施计划互为引用
