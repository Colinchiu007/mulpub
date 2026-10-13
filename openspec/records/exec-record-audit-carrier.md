---
task: exec-record-audit-carrier
title: 出路④允许自动入库的判定记录，解开与 #3396 的冲突
status: completed
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

# 出路④允许自动入库的判定记录（exec-record-audit-carrier）

## 1. 冲突的两条已上线规则

| 规则 | 内容 | 落点 |
| --- | --- | --- |
| #3396（已合并） | pre-commit 在 CCG 门禁跑完后，把仓库内**所有**未跟踪的 `.ccg/reviews/*.json` 自动 `git add` 进同一个提交 | `scripts/hooks/pre-commit` |
| `check-pr-exec-record.js` 出路④ | 「纯回填」= 变更集**全部**是既有载体的 M，「夹带任何新增/删除/非载体文件 ⇒ 不符合此定义」 | `scripts/check-pr-exec-record.js` `isPureBackfillChangeSet` |

⇒ 只要 worktree 里存在遗留判定记录，**任何**回填 PR 都会被前者塞进新增文件、被后者判红。实测 PR #3432：`--mode=enforce` 本地红，而 CI `Gate Result` 在 docs-only 通道照过——这条红**只有本地 enforce 看得见**。

试过且无效的绕法：`git rm --cached` 两个夹带文件 + `--amend` ⇒ 钩子再触发，不仅收回原两条，还为本提交新生成第三条（新增数 2→3）。**这不是可以靠操作顺序解决的问题，是规则互斥。**

## 2. 改法（只开一格，其余全部保持最窄）

```
AUDIT_ARTIFACT_RE = /^\.ccg\/reviews\/[0-9a-f]{40}\.json$/
every: (M && CARRIER_RE) || (A && AUDIT_ARTIFACT_RE)
some:  M && RECORDS_RE            // C2 收紧原样保留
```

明确**不**放宽的方向：`M`/`D` 既有审计产物（删他人审计产物一律不许借道）、大写或短 sha、多一段路径或后缀、`.ccg/reviews` 之外的同形态文件、任何功能代码新增、借 `openspec/records/*.md` 之名伪装的新增。同步改写 enforce 失败时打印的④句文本——判据说明与实现不一致就是把 Bug 钉成文档。

## 3. 证据（TDD 顺序留痕）

- 实现前：`# tests 39 / pass 37 / fail 2`，红的两条恰是"允许类"用例；严格形态类与 C2 类当时已绿 ⇒ 用例不是写松了才让新实现通过的。
- 实现后：`node --test scripts/check-pr-exec-record.test.js` ⇒ **39 tests / 39 pass / 0 fail**。
- 变异反证（每条先断言变异真的落盘，还原后复跑）：
  - N1 白名单放宽成「`.ccg/reviews/` 下任意 json」⇒ 红在「形态邻近写法不得穿过」；
  - N2 去掉状态限定（A/M/D 都算）⇒ 红在同一条；
  - N3 去掉 sha 长度/大小写约束 ⇒ 红 3 条；
  - N4 拆掉 C2 收紧 ⇒ 红 3 条（含既有的那条 C2 锁，说明它仍在生效）。
  还原后复跑 39/0，`scripts/check-pr-exec-record.js` 与备份逐字节一致。
- **真实验收 A/B**：同一份 #3432 变更集，新判据 `OK: 本 PR 携带执行记录或带原因的豁免` 且报出「回填型 PR（载体修订 3 篇）」；主干旧判据 `不通过：1 条理由`。同输入两侧相反结论，才是"解开冲突"而非"绕过检查"。

## 4. 门禁

| 门禁 | 状态 | 依据 |
| --- | --- | --- |
| QM-1 打包 | N/A | 不改 `apps/desktop/electron/`、`packages/rpa-engine/`，交付物字节不变 |
| QM-2 代码必检 | 见下 | `node --check` 通过；39/39 测试；无新增用户可见文案（不动 locales，故 Gate 7 无关） |
| QM-4 视觉 | N/A | 无 UI 文件改动 |
| TDD | PASS | 实现前先红 2 条、实现后 39/0，四条变异反证各自指名变红 |
| QM-6 双模型外部评审 | **未跑成（不写 PASS）** | 本轮改动属门禁判据，按 AGENTS.md 应走双模型；实测此前三轮评审中 claude 后端多次 `exited with status 4294967295`、opencode 零 findings 载荷。不自扮演豁免 ⇒ **本 PR 不自动合并**，交使用者裁决 |

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后就地改写为 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |
