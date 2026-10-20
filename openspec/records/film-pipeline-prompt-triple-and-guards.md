# 执行记录 · film-pipeline-prompt-triple-and-guards

> 分支：`film-pipeline-prompt-triple-and-guards`
> OpenSpec：`openspec/changes/film-pipeline-prompt-triple-and-guards/`
> PRD：`01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md`
> 依据调研：`01-docs/RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md`（19 个 AI 影视开源项目）

## 本次交付

| 阶段 | 内容 | 状态 |
|------|------|------|
| 决策层 | 产出完整改造方案：现状缺口（8 项，实测取证）、选定项与**许可证结论**、落点与规模、9 个 PR 的排期与依赖、13+1 项明确不做、34 条可执行验收 | ✅ 完成 |
| 决策层 · 对抗评审 | CCG `plan-review.sh` **4 轮**跨家族评审（claude × codex，共 32 条意见，逐条处置），记录见 `ccg-plan-review-record.md` | ✅ 完成 |
| 决策层 · 详细规格 | PRD：数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字 全维度 | ✅ 完成 |
| 实施层 | PR-1 ~ PR-9 按序实施（**本次仅提交方案，代码在后续 PR 落地**） | ⏳ 未开始 |

## 关键决策（摘要）

1. **改动边界**：只动「影视工程 → 自动」标签 + 「视频创作 → 提示词优化」阶段；画布 / 快速渲染 / 历史记录 零改动。
2. **批次一已落地**（PR #4052），本批次从批次二起：F-A 三分 / F-B 就绪度 / F-C 出站安全 / F-D 工具体检 / F-E 锁镜 / F-F 身份锚点 / F-G 乐观锁 / F-H·F-I·F-J 批次一遗留接线。
3. **实测推翻调研报告两处判断**：F11b 落点（报告说本仓无防护，实为 `shot-downloader.js` 已实现完整合同）、F11d 落点（影视工程走 Electron 主进程 ffmpeg，不经 python-backend）。
4. **不做**：F12 VLM 质检（无视觉适配器 + 会绕过被锁死的成本闸）、F7 视角变体（无消费方 = 死代码）、F10 剪映草稿（需 spike）、F8c·F8d（打包滤镜白名单仅 11 个）、F13·F14·F16·F17·F18·F19、python-backend 全域。
5. **存量边界不假装已解决**：`videoPrompt` 归一化为空串（而非回落 prompt），让"存量未被重算"在数据上可见；存量长 prompt 治理列为后续项。

## 门禁与验证

| 项 | 结果 |
|----|------|
| `openspec validate film-pipeline-prompt-triple-and-guards --strict` | ✅ `Change 'film-pipeline-prompt-triple-and-guards' is valid` |
| `node scripts/ccg-review-decider.js --input <proposal.md>` | ✅ **DUAL**（>200 行阈值），要求双模型深度审查 |
| `sh scripts/plan-review.sh <proposal.md>` | ✅ 4 轮跨家族（critic=claude/codex，proposer=opencode/claude），32 条意见全部逐条处置 |
| `node scripts/check-no-brand-residue.js` | ⏳ 待 PR 阶段跑（方案阶段无新增竞品名） |
| `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` | ⏳ 待 commit 后跑（本次含 `01-docs/` 新文件，预期 `docs-only=false`） |

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #NNNN
