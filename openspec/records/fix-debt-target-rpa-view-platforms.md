---
record: fix-debt-target-rpa-view-platforms
task: 修回主干上被 #4276 顶破的「点名还账」目标值，使 main 从红恢复为绿
date: 2026-10-23
---

## 本次执行记录：点名还账目标值上调（fix-debt-target-rpa-view-platforms，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 门禁数据文件（`.github/scripts/max-lines-baseline.json`）+ 执行记录；纯配置/文档，无运行时代码变更 |
| 第一性原因（QM-5 ①） | ✅ | PR #4276（`fix(toutiao): click add-video before upload`，merge SHA `f84e1f79f`）给 `apps/desktop/electron/services/rpa-view-platforms.js` 加 14 行真机取证下的必要逻辑（头条停在西瓜上传页且「添加视频」仍可点 ⇒ 文件从未附加），把该文件从 1483 行顶到 1497 行 |
| 逃逸分析（QM-5 ②） | ✅ | 该文件被 `targets` 点名还账，**容差为 0**（`register.files` 是登记值 + 200 容差，`targets` 是零容差）；而本 PR 之前该文件已是 1483 行、距目标 1484 只差 1 行 ⇒ **任何真实修复都会立刻越线**，不是本 PR 单独踩的雷 |
| 现场取证 | ✅ | merge SHA `f84e1f79f` 上 `债务熔断门禁` push run 结论 = `failure`，失败行原文：`TARGET_GREW: apps/desktop/electron/services/rpa-view-platforms.js 现 1497 行已超过点名目标 1484 行（超 13）`。在干净 checkout 的 `origin/main` 上本机复跑 `node .github/scripts/check-max-lines.js` → 同一句 ❌ ⇒ **是主干自身的红，不是某个 PR 的红** |
| 修复 | ✅ | `targets` 里该文件的目标值 1484 → **1497**（= 当场实测值，不额外给余量，与 2026-10-20 PR #4062 那次上调同一口径）；`register.files` 保持 1422 不动（LEDGER_GREW 的 200 容差那一侧不受影响、且不放松） |
| 判据复跑 | ✅ | 本机 `node .github/scripts/check-max-lines.js` → `✅ 无新增超大文件，挂账清单与现实一致。`（rc=0）；`node --test .github/scripts/check-max-lines.test.js` → **36 passed / 0 failed** |
| 口径依据 | ✅ | ① 门禁自述的出口原文：「降到目标以下，**或在 review 中说明理由后一并上调 targets**」；② 本仓 2026-10-20（PR #4062）对 `pipeline-engine.js` / `story2video-compose-engine.js` 的同类上调先例（同一份基线 JSON 注释里，两侧口径分别列明、增量分别计算）；③ 该文件 2026-09-23 登记（PR #2252，files=1215）→ 2026-10-08 建立点名还账（PR #3081，targets=1476）→ 此后随功能增长逐次上调 ⇒ **上调是本仓对该文件的既有做法** |
| 还债路径（不假装已还） | ⚠ | 本文件仍整体超 500 行上限、仍在 `register.files` 挂账待还；真正的还债动作是**把各平台发布实现拆到 rpa-engine 独立模块**（与已落地的 `toutiao-direct-bridge` 同型），而不是回退 #4276 的契约。本次只解决「真实修复必需的 13 行」 |
| 危险面 | ⚠ | 本 PR 改的是**门禁数据文件**（行数天花板），不改 `CI_IGNORED_PATHS`、不改分支保护 ruleset、不改 `scripts/check-*` 判据本体；但按「改谁来守门」的 spirit，**它应当被人工过目**——故本 PR 正文写明口径与依据，便于人工复核 |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致（只改 1 个数据文件 + 1 份执行记录） |
| QM-1 打包 / QM-4 视觉 | N/A | 纯门禁数据文件 + 文档，无运行时/视觉面 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper` / 后端 CLI 通道，如实记录为未执行；**不冒充已外部复核** |

| 远程同步 | 由门禁推导 |
