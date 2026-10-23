---
record: user-manual-avatar-heygen-flow
task: 用户手册补写数字人管线里 HeyGen 的角色与数据流
date: 2026-10-22
delivered_by_pr: 4224
---

## 本次执行记录：用户手册补 HeyGen 角色与数据流（user-manual-avatar-heygen-flow，2026-10-22）【docs-only】

- 判定：node scripts/classify-docs-only.js --base=origin/main --head=HEAD → docs-only=true（files=2：`01-docs/user-manual.md`、`.ccg/reviews/0dae20fd….json`）
- 保留门禁：行尾对账 ✅（`31/0` 两口径一致）| 品牌残留 ✅（PASS，11605 tracked）| 文档同步 ✅（`check-docs-sync.sh --base=main --head=HEAD` → 仅文档变更）| 远程同步 PR #4224
- 跳过：QM-1 打包、QM-2 代码必检项、QM-4 视觉、TDD（无代码）、QM-6 双模型评审（CCG 判定 SKIP）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档变更：共享主工作区就地编辑 + 经 PR #4224 落地（不进 worktree） |
| docs-only 判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true files=2` |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致：`31/0` |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS（11605 tracked） |
| 文档同步 | ✅ | `sh scripts/check-docs-sync.sh --base=main --head=HEAD` → 仅文档/流程变更 |
| 执行记录取证 | ✅ | `node scripts/check-pr-exec-record.js --base=origin/main --head=user-manual-avatar-heygen-flow --mode=enforce` → OK |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导（squash 尾注 `(#NNNN)`）；本行不手写状态词。来源 PR：#4224 |

### 变更内容

`01-docs/user-manual.md` §9.3.1 末尾新增两个小节，补上此前只有操作步骤、缺「谁在干什么」和「数据怎么走」的两块：

1. **HeyGen 在这条管线里承担什么**：四阶段角色表（`avatar_select`/`script` 走 LLM、`generate` 走 HeyGen、`render` 走本地 FFmpeg），并明确它与通用文生视频不是同一条链路（收三要素而非画面提示词，不受通用视频模型默认供应商影响）。
2. **数据怎么流到 HeyGen**：从拉列表（`/v2/avatars`、`/v2/voices`）→ 启动前四层校验 → `POST /v2/video/generate` → `GET /v1/video_status.get?video_id=` 轮询（10s/次，10 分钟上限）→ 下载 → render 的完整链路图。

内容与已合入 main 的 `8da929484`（PR #4194）行为逐条对齐，未新增任何承诺。

### 遗留（不假装已闭合）

- 手册仍标 `experimental`：真实 Key 首跑未做，四步验收 checklist 在 `openspec/changes/heygen-adapter-contract/tasks.md` T4，未执行。

## CHANGELOG 条目

# docs(video): 用户手册数字人章节补 HeyGen 角色表与数据流（user-manual-avatar-heygen-flow）

- 视频创作手册「数字人口播」新增两节：HeyGen 在四阶段管线里的职责边界（只负责 generate，且是唯一数字人供应商），以及从拉形象/音色列表到提交、轮询、下载的完整数据流。
- 明确数字人分支与通用文生视频不是同一条链路，避免用户误以为切换默认视频模型会影响数字人。
