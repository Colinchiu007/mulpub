---
record: docs-learnings-20261018c
task: 沉淀收尾链三个取数坑（gh run list --commit 漏报 / 先 ff 再动手 / core.quotepath 按用途取值）
date: 2026-10-18
branch: docs-learnings-20261018c
---

## 本次执行记录：收尾链三个取数坑（docs-learnings-20261018c，2026-10-18）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（files=2：`01-docs/learnings.md`、`openspec/records/docs-learnings-20261018c.md`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅（扫描 10081 tracked 文件 PASS）| 文档同步 ✅ | 远程同步 由门禁推导

### 三条（均来自 risk-batch4 收尾的实测，不是推演）

**① `gh run list --commit <sha>` 会漏报已存在的 run**
PR #3896 合并后（merge `077e790cd`），该命令只返回 `CI Failure Handler`，据此差点写下「quality-gate `NO_RUN`」并触发一轮不必要的 follow-up PR。
改用 `gh api "repos/:owner/:repo/actions/runs?head_sha=<sha>"` → `total_count=67`，其中 **quality-gate `count=1 event=push`、`conclusion=success`**；再用 `?event=push&branch=main` 交叉确认。
**判据**：「某 SHA 上有没有 run」必须走 `head_sha` 明文查询或 `--event push --branch main` 列表；`--commit` 的静默少报与「真的没跑」在输出上完全同形。

**② 改判据/工具前先 `git merge --ff-only origin/main`**
收尾时判据在**已完整合并**的分支上报 `lost=1` rc=1。我定位两条根因（quotepath 未关 + latin1 解码串回传 git 被按 UTF-8 重编码），修完并加中文路径夹具 24/24 绿。
ff 后发现并发会话 PR **#3875「落地判据 v3」**已改这两个文件 471+353 行、且已覆盖该假 LOST（v3 在同一分支上 `identical=6 drift=0 lost=0` rc=0）⇒ 我的补丁整体作废、工作区复位。
代价：约 40 分钟 + 一次 `reset --hard`（工作区仅自己的 2 个 staged 文件，已先备份 7015 字节补丁）。
**纪律**：动 `scripts/` 判据或 `apps/` 前先 `git log HEAD..origin/main -- <目标文件>`；「同一个坑两个会话同时修」在本仓是高频形态，判据类文件尤其热。

**③ `core.quotepath` 的正确取值取决于用途，两个方向都对（补充 L1112）**
L1112 记的是「PowerShell 对 git 输出数行」——那里转义形态（全 ASCII）反而安全，`-c core.quotepath=false` 是把坑打开。
但在**程序化判据**里（路径当键、再回传 `git ls-tree`/`git diff --` 做 blob 比对）恰恰相反：必须 `-c core.quotepath=off` **并且**参数侧用 `Buffer.from(a, 'latin1')` 还原原始字节 —— 只做前者时读数不变（本轮实测「修①后 lost 仍为 1」）。
另有展示层坑：latin1 串直接打印成文件名是 `ç«…` 乱码，须在输出边界转回 UTF-8（判据要说得清是哪个文件才可能被信任）。
**口径**：数行/人读 ⇒ ASCII 转义；当键回传 ⇒ 原始字节 + 展示边界还原；两者不可混用。

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 纯文档（docs-only=true） |
| QM-2 代码必检项 | **N/A** | 同上 |
| QM-4 视觉 | **N/A** | 无 UI |
| QM-6 双模型评审 | **N/A** | docs-only 通道跳过 |
| 远程同步 | 由门禁推导 | 按 change `gate-record-sync-derived-status`：不手写状态词、不开回填 PR |

### 关联（同日，均已合并）

- `#3896`（merge `077e790cd`）：第四批 R5 visible 面 8/8 复核 + 单行 finally 判据修复 + `aiLoading` 加固 + R8 定论（不可机械化）。main push quality-gate = **success**（raw API 取证）。
- `#3875`（并发会话）：落地判据 v3，覆盖了本轮遇到的 CJK 假 LOST —— 本条 ② 的动因。
