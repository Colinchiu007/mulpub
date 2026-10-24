---
record: dep-audit-baseline2
task: 修复依赖审计基线腐化（4 条目标版本低于公告修复下界）
date: 2026-10-23
---

## 本次执行记录：依赖审计基线修复（dep-audit-baseline2，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 数据文件（审计基线），隔离 worktree + 裸分支 `dep-audit-baseline2` |
| 第一性原因（QM-5 ①） | ✅ | 门禁报 `RESOLVED_STILL_BASELINED: npm/GHSA-hp3w-g68c-fv3c 已不再命中，请 --update 清账` 与 4 条 `DECISION_CONTRADICTS_PATCHED`（目标版本 1.1.x 低于当前 patched 下界 5.0.x）⇒ 上游公告 `patched` 区间被改写，旧结论永远闭不了账 |
| 逃逸分析（QM-5 ②） | ✅ | 基线更新只由人工执行；`--update` 会原样写入矛盾条目（实测产物自身不通过），说明缺少「与在线公告比对」的校验 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 4 条按当前 patched 下界更新 `patched`/`targetVersion`（`>=5.0.10 / >=5.0.8 / >=5.0.12 / >=5.0.11`）并在 note 记录来由；`node scripts/check-dep-audit.js` → **✅ 通过**，挂账 28→27（失效那条已清） |
| 防止再次发生（QM-5 ⑤） | ✅ | 每条 note 明确写出「上游区间改写」这一成因，便于下次识别同类腐化 |
| 行尾与 diff 对账 | ✅ | 仅 JSON 数据变更 |
| 接线棘轮 | N/A | 数据文件 |
| QM-1 打包 / QM-4 视觉 | N/A | 无运行时代码 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
