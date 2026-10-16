---
record: dep-audit-baseline
task: 依赖审计基线续判 python-jose 新公告 ID（PYSEC-2026-4298 ≡ CVE-2026-85394）并清账已解决公告，解除全仓阻塞
date: 2026-10-15
---

## 本次执行记录：依赖审计基线续判 python-jose 新公告 ID 并清账（dep-audit-baseline，2026-10-15）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 流程类数据文件（`scripts/dep-audit-baseline.json`，AGENTS.md 分层规则把 `scripts/` 归「流程/规格」，允许共享根就地编辑）⇒ 就地编辑 + 经 PR #3668 落地；补写本记录时改用 worktree `D:/Data/projects/mp-worktrees/mp-dep-audit-baseline`（共享根有 `[shared-root-guard]` 强制留在 main，禁止 checkout 分支） |
| 第一性原因（QM-5 ①） | ✅ | **外部事实驱动**：门禁把「公告库现值」与「人工挂账快照」逐条对 ID，而上游同时发生了两件事——① 新增 `pip/PYSEC-2026-4298`；② 上一轮挂账的 `pip/CVE-2026-85394` 不再以该 ID 命中。两者叠加触发 `NEW_ADVISORY` + `RESOLVED_STILL_BASELINED` 双红。现场：`node scripts/check-dep-audit.js` 命中 28 / 挂账 28，两条 ❌ |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸的不是代码缺陷，而是**判据的盲区**：基线按 advisory id 挂账，而 PySEC 与 CVE 是同一公告的两套编号（PySEC 记录自带 id 并把 CVE 收进 `aliases`）。改名发生时，门禁只能看到「旧的没了、新的来了」，**没有任何机制提示二者是同一条** ⇒ 直觉处置会「重开一条结论」，把已验证过的分析丢掉重做（且很可能写成更差的结论）。本轮用 `pip-audit` 的 aliases 取证把它识别为同一公告，续用原证据。层级上这条只在 CI 门禁层可见，单测层无法覆盖（单测注入假扫描器，看不到真实公告库改名） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`--update` 并入新 ID 并清账已解决项；②把新条目的 `decision` 从 `TODO` 补为 `not-exploitable`，并在 `note` 里写入 **ID 等同取证**（`aliases=GHSA-3qf3-8w2g-rqmx,CVE-2026-85394`）、四条仓内复核证据、**复核条件**与**改判条件**。验证：`node scripts/check-dep-audit.js` → rc=0（`✅ 无新增已知漏洞公告，基线与现实一致且结论完整`）；`node --test scripts/check-dep-audit.test.js` → **26/26 通过** |
| 防止再次发生（QM-5 ⑤） | 部分 | 已落地：识别方法写进基线 `note`（后人再遇改名有据可循）；PR 正文把 aliases 取证列为「关键取证」。**未落地**：给门禁加一条「同 module + 同 root 且 `patched` 为空的新 ID 疑似既有条目改名」的提示——属判据增强，需单独评审（见「遗留」），不假装已闭合 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 相等（仅 1 文件 M，无删除）。`git diff --stat 6bd0140da^ 6bd0140da` = `scripts/dep-audit-baseline.json \| 16 ++++++++--------`，1 file changed，+8/−8 |
| 接线棘轮 | N/A | 未新增 `*.test.js`；改动是门禁读取的数据文件，判据本身由既有 `scripts/check-dep-audit.test.js`（26 例）与 CI job 覆盖 |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未触碰 `apps/desktop/electron/**` 或 `packages/**`，无运行面与视觉面变更 ⇒ 不触发打包与视觉门禁 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用外部评审通道；**如实记为未执行，不以自审冒充通过**。pre-commit 的 CCG 判定层已执行（3 项通过），但那不等于双模型外部评审 |
| 远程同步 | PASS | PR #3668 已 squash 合并：merge SHA `ce88f1b45979bbf95bf5ae323c45c310234eec9a`（2026-10-16T02:24:44+08:00，`git log origin/main --grep='(#3668)$' --format=%H|%cI` 取证）；`git ls-remote --heads origin dep-audit-baseline` 返回 0 行证远端分支已删。回填与本次状态改写同一次提交完成 |

- 保留门禁：判定 docs-only=false（`scripts/` 不在 CI_IGNORED_PATHS，走完整门禁）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按 2026-10-15「旧载体冻结」政策**零改写**）| 远程同步 PASS

### 上游事实（本片结论的全部依据）

```
$ pip-audit -r ops-center/backend/requirements.txt --format json
python-jose 3.5.0  PYSEC-2026-4298  aliases=GHSA-3qf3-8w2g-rqmx,CVE-2026-85394  fix_versions=(空)
ecdsa       0.19.2 PYSEC-2026-1325  aliases=CVE-2024-23342,GHSA-wj6h-64fc-37mp
```

⇒ **PYSEC-2026-4298 与上一轮挂账的 CVE-2026-85394 是同一条公告**（PySEC 改用自己的 id 并别名 CVE），故按原证据续判 `not-exploitable`，不重开结论、不改判级。

### 仓内复核证据（四条，本轮逐条实测）

| # | 位置 | 内容 |
|---|------|------|
| ① | `ops-center/backend/middleware/auth.py:37` | `algorithms=[settings.jwt_algorithm]` |
| ② | `ops-center/backend/services/logto_verifier.py:95` | `algorithms=["RS256", "ES256"]` |
| ③ | `ops-center/backend/config.py:52` | `jwt_algorithm: Literal["HS256"] = "HS256"`（类型锁死，无法配成非对称算法） |
| ④ | `ops-center/backend/tests/test_security_config.py:43` | `test_rejects_unsupported_jwt_algorithm` 回归拦截 |

公告成立前提是「算法未被显式限定」；上表四条同时成立 ⇒ 在本仓当前调用形态下不可利用。**不写 `no-fix-available`**：那等于谎称上游已放弃。

### 遗留（不假装已闭合）

1. **门禁缺「改名识别」提示**（本片暴露的判据盲区）：建议在 `scripts/check-dep-audit.js` 增一条软提示——新 ID 若与既有条目的 `module` + `roots` 相同且 `patched` 均为空，则打印「疑似同一公告改名，请用 `pip-audit` 的 `aliases` 取证后再判」。属**判据增强**（改的是「谁在守门」的宽度），需人工评审后单独落地，不在本 PR 夹带。
2. **全仓阻塞的时间窗未量化**：本轮只取证到「自 2026-10-15 14:45Z 起所有分支同红」，未统计受影响 PR 数与该窗口内的合并停滞时长；如需复盘可另起。
3. **QM-6 双模型外部评审未执行**（见上表），本片结论目前只经单侧证据链 + 门禁 + 26 例单测。
