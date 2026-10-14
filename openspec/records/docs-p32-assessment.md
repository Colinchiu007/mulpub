---
record: docs-p32-assessment
task: P3-2 单平台试点开工前评估
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 变更内容

`01-docs/PLAN-REUSE-ROLLOUT-2026-10-13.md` 的 P3-2 小节新增「开工前评估」子节（+43 行）：

1. **判据可达性逐条核对**（四条判据 × agent 能否取证）
2. **起点差距实测**（`dayu` 8 FAIL / `qie` 9 FAIL，缺口分类）
3. **开工前置条件**（三条，按优先级）
4. **为什么先记下来再走**（可接续性）

## 结论

**P3-2 尚未开工。** 不是遗漏，是判据②③无法由 agent 取证——需用户提供真实平台账号。

| # | 判据 | agent 能否取证 |
|---|---|---|
| ① | `verify-platform-onboarding.js <slug>` 全 PASS | ✅ 能（P3-1 脚本即为此而建）|
| ② | 真机发布一条内容（含分类 ID 被平台接受） | ❌ **不能**（需真实账号；规格自标【阻塞 U-1】「只能真机验证」）|
| ③ | `publishMode` 提到 `api-then-dom` 前 API 轨先跑通 | ❌ **不能**（需真机 API 凭证）|
| ④ | QM-1 打包 + 手动验证四问 | ⚠️ 部分（打包可做，手动验证是人的动作）|

⇒ 四条里两条完全不可取证、一条部分 ⇒ 强行开工只会产出「代码在、判据②③④未取证」的中间态。

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 行尾对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致 |
| 品牌残留 | PASS | `check-no-brand-residue.js` exit=0 |
| 文档同步 | PASS | `classify-docs-only.js` → `docs-only=true` |
| 执行记录 | PASS | 本文件即按出路①新增 |
| 远程同步 | PENDING | 本 PR 未合并，merge SHA 尚不存在 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

## 备注

- 判据①的四类缺口（`platform-definitions.js` 三个表 / `platforms.yaml` 配置段 / `publish-capabilities.json` / 三张上限表）**均可由 agent 完成**，不依赖账号，可与「用户提供账号」并行推进。
- 本 PR 为纯文档变更，不触碰运行时代码。
