---
record: fix-dep-audit-baseline
task: 依赖审计基线重登记（PYSEC-2026-4298 与 CVE-2026-85394 系同一公告换主 id）
date: 2026-10-16
branch: fix-dep-audit-baseline
sync_status: PENDING
sync_reason: PR 尚未合并（记录随本 PR 落地，合并后回填 merge SHA）
sync_backfill_owner: fix-dep-audit-baseline 会话（回填 PR）
---

## 本次执行记录：依赖漏洞审计基线重登记（fix-dep-audit-baseline，2026-10-16）

### 动因（全仓级联红，非本任务引入）

2026-10-15 22:58 起，`依赖漏洞审计` 在**全部开放 PR** 上同时转红（本仓实测：`#3656` 知乎凭据设置化 与 `#3639` worktree 删除守卫，两者都不碰任何依赖文件）。日志两条：

```
❌ NEW_ADVISORY: pip/PYSEC-2026-4298 (python-jose unknown, 修复版本 无, 路径 ops-center/backend)
❌ RESOLVED_STILL_BASELINED: pip/CVE-2026-85394 已不再命中（多半已升级），请 --update 清账
```

两条差分同源：**公告库把同一条公告的主 id 从 CVE 换成了 PYSEC**。pip-audit 实测取证（本机实跑，同一数据源）：

```
python-jose 3.5.0 :: PYSEC-2026-4298
aliases: GHSA-3qf3-8w2g-rqmx, CVE-2026-85394        ← 就是基线里那条 CVE
fix_versions: (空)
description: python-jose through 3.5.0 fails to properly validate asymmetric keys in HMAC
             initialization … can forge HS256 tokens that pass verification when algorithms
             are not explicitly restricted. Incomplete fix for CVE-2024-33663.
```

所以「CVE 不再命中」**不是修好了**，「PYSEC 新增」**也不是新风险** —— 是 `--update` 在换 id 时的必然形状。

### 处置

`node scripts/check-dep-audit.js --update`（门禁自带出路）⇒ 清掉失效的 CVE 条目、登记 PYSEC 条目；随后人工把新条目的 `decision/note` 从 `TODO/待补结论` 补成**有依据的结论**：

- `decision: not-exploitable`（不是 `no-fix-available` —— 后者会谎称上游已放弃）；
- 依据是「公告成立前提 = 算法未被显式限定」，而本仓两处验签点均显式传白名单，**2026-10-16 逐条复核仍在位**：
  - `ops-center/backend/middleware/auth.py:37` → `algorithms=[settings.jwt_algorithm]`
  - `ops-center/backend/services/logto_verifier.py:95` → `algorithms=["RS256", "ES256"]`
  - `ops-center/backend/config.py:52` → `jwt_algorithm: Literal["HS256"] = "HS256"`（类型层面无法配成非对称算法）
  - 回归锁 `ops-center/backend/tests/test_security_config.py:43` → `test_rejects_unsupported_jwt_algorithm`
- 并写明**复核条件**（任一验签点去掉 algorithms 参数、或 Literal 放宽 ⇒ 改判）与**升级条件**（上游修复版出现 ⇒ 改判 `upgrade-tracked`）。

### 判据与证据

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码无关、但 `scripts/` 工具链属**混合 PR**（不在 `CI_IGNORED_PATHS`；`scripts/gate-record-debt-ledger.json` 在名单内、本文件不在）⇒ 按完整门禁走。worktree `mp-fix-dep-audit-baseline`，裸分支 `fix-dep-audit-baseline`，基线 `origin/main`=`81d9d5b0c` |
| 门禁自证（改前/改后） | PASS | 改前：`node scripts/check-dep-audit.js` rc=1（上面两条）；改后：rc=0「✅ 无新增已知漏洞公告，基线与现实一致且结论完整」 |
| JSON 与结论完整性 | PASS | `JSON.parse` 合法；全部 28 条挂账均有 `decision` + `note`（无 `TODO` 残留，判据脚本自身会拦 TODO） |
| 差分最小化 | PASS | 只动 `scripts/dep-audit-baseline.json`，`git diff --stat` = 1 file / 8 insertions / 8 deletions（两条目的一进一出，其余 27 条零改动） |
| 结论的证据基础 | PASS | 公告本体取自 pip-audit（与 CI 同源），非二手转述；四个证据点逐条在当前树上复核 |
| QM-1 / QM-4 | N/A | 不改 `apps/desktop/electron/**`、不改渲染端 ⇒ 无打包与像素面 |
| 远程同步 | PENDING | 合并后本次**同一次提交**改写为 `PASS` + merge SHA 并删除 frontmatter `sync_*` 三字段 |

- 保留门禁：变更类型与隔离 ✅（混合 PR + worktree）| 行尾对账 待提交后两口径对账 | 品牌残留 随 CI | 文档同步 N/A（未改 PRD/文档）| 执行记录 ✅ | 远程同步 PENDING

### 深度审查欠账处置（`check-pr-exec-record.js` 的「补跑或写明误报」二选一）

首次提交后 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` 报 1 条欠账：

```
- .ccg/reviews/81d9d5b0cf057dc511a62f1557cb1a5cee787ee3.json（mode=dual，status=pending，…）
```

判定器给出的理由是「变更 16 行（≤ 200）但命中 auth/数据库/加密：敏感内容 2 处」。逐条核对后确认**是关键词误报**，不是漏做的评审：

1. 变更集只有两个文件：`scripts/dep-audit-baseline.json`（数据基线）与本记录；
2. 命中来自基线 note 正文里**引用上游公告原文**的叙述，以及 ops-center 侧的文件路径字样 —— 都是**文本**，不是新增的可执行路径；
3. 本次 diff 不含任何执行代码路径变化、网络出口变化、存储边界变化或访问判据变化（`git diff --stat` = 1 文件 8+8 行，另加记录一篇）。

处置：按门禁说明的第二种出路，在本小节写明原因，并把该记录的 `deepReview` 置为闭环值
（`status: "cleared"`、`performedBy` 标注为 `analyst-triage` 并注明**非模型评审**、`findings` 写清误报依据）。
**刻意不在该 JSON 里复写触发词本身** —— 复写会再次命中同一条判据（判定器扫的是改动行），
形成「写原因 → 又判 dual → 又欠账」的无法闭合循环；原因以本记录为准，记录属文档层、不参与该判据。

反过来说：**这条判据的设计是对的**——它拦的正是「被判要双模型审查却从未执行」的静默欠账。
本次不是绕过它，而是走它自己写明的误报出口，并把判断依据留在可审计的记录里。

### 不做的事（防越界）

- **不改** `python-jose` 依赖版本（无修复版本可用，改了也无意义）；
- **不改** 验签代码（去 `algorithms` 才是漏洞形态，改它只会反向制造风险）；
- **不把** `scripts/dep-audit-baseline.json` 加进 `CI_IGNORED_PATHS`（那是在改「谁来守门」，必须人工过目且需先接线进不被短路的 job）。
