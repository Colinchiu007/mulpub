---
record: anchor-backup-latest
task: 修 mp-anchor-health.ps1 的热备份新鲜度判定——把「按目录名字符串降序 + LastWriteTime 计龄」改成「解析 yyyyMMdd-HHmmss 后取最大 + 名字计龄」，并补 5 条行为级回归锁接进 CI
date: 2026-10-18
---

## 本次执行记录：修掉锚点热备份「每次都报 25.9 天前」的恒假告警（anchor-backup-latest，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 改动集 3 个文件：`scripts/mp-anchor-health.ps1`（M）、`scripts/mp-anchor-health.test.js`（A）、`.github/workflows/quality-gate.yml`（M）。含 CI 变更 ⇒ **不走 docs-only 通道**（`classify-docs-only` 判 false）。在隔离 worktree `mp-worktrees/mp-anchor-backup-latest` 的裸分支 `anchor-backup-latest` 内完成，基线 `origin/main@c4f140419`；共享根改前改后均为 `main` + `dirty=0`，全程未在其上切分支、未动他人的 stash |
| 第一性原因（QM-5 ①） | ✅ | `mp-anchor-health.ps1` 用 `Sort-Object Name -Descending` 取「最新备份」，隐含假设「备份目录里只有时间戳一族名字」；而锚点里同时住着一次性基线 `seed-20260923-001516`，ASCII 下 `s`(0x73) > `2`(0x32) ⇒ 基线恒胜。第二处独立缺陷：年龄取 `LastWriteTime`，而复制/还原快照会改写 mtime，它根本不是备份时刻。两处必须同时存在才会出现「刚备份完也报 25.9 天」 |
| 逃逸分析（QM-5 ②） | ✅ | 逐层：①**单元/集成**——该脚本此前**零测试**（`scripts/*.test.js` 里没有它），无锁可逃；②**端到端**——`sync-app.ps1` 只把 `[WARN]` 行转发进日志，不判读内容，故启动链与 CI 都不消费这条读数；③**视觉/审查**——`WARN` 档按设计 `exit 0`，于是「每次黄」在自动化里与「环境事实」同形。真实逃逸证据：本人 2026-10-18 第一次见到该 WARN 时按环境问题放过，**第二次才去查**——恒黄告警的边际信息量为 0，这正是它同时逃过人眼与 CI 的机制 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修法：`[datetime]::TryParseExact($_.Name,'yyyyMMdd-HHmmss', InvariantCulture, None, [ref]$t)` 解析出真实时刻，按 `TakenAt` 取最大，年龄由名字推导；只剩非时间戳目录时**如实 WARN**（给基线目录猜年龄等于撒谎）。回归保护：`scripts/mp-anchor-health.test.js` 5 条**行为级**锁（真起 `powershell` + `os.tmpdir()` 临时夹具），见下方「变异反证」 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①测试接进 `quality-gate.yml` Gate 2c 的 `run:`（`node --test scripts/mp-anchor-health.test.js`），该 job 不自动收集 `scripts/` 下的测试，不点名等于没写；`node scripts/check-unwired-tests.js` → `检查域内测试文件 107 个 / OK: 全部测试均已接线或按欠账登记` rc=0。②夹具固定包含「`seed-*` 基线与时间戳快照共存」这一真实形态，将来新增别的目录族会先在这里红。③脚本内注释写明两处禁手（不得按名字排序选最新、不得用 mtime 计龄），并写明当时的现场读数 |
| 行尾与 diff 对账 | ✅ | `scripts/mp-anchor-health.ps1` 两口径 `28 5` == `28 5`；`.github/workflows/quality-gate.yml` `6 0` == `6 0`；`CHANGELOG.md` `18 0` == `18 0`。删除数归因：ps1 的 5 行删除全部是旧 freshness 分支被替换（无他人内容）；gitattributes 为 `* text=auto`，工作副本 CRLF / blob LF 由 git 归一，两口径相等 |
| 接线棘轮 | ✅ | 新 `*.test.js` 已在 `quality-gate.yml` Gate 2c 内显式点名；`check-unwired-tests.js` rc=0（见上行读数） |
| QM-1 打包 / QM-4 视觉 | N/A | 改动集零 `apps/desktop/electron/**`、零 `packages/rpa-engine/**`、零 UI/样式 ⇒ 打包与像素门禁**不适用**（不是「跑了通过」）。记录此格是为了不与「已验证」混淆 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机 `Get-Command codeagent-wrapper` 不存在，如实记未执行；不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红（change: `ban-record-closure-backfill-pr`）。main push 回读证据写在 PR 评论里，不写回本文件 |

### 真实锚点 A/B（不是只在新夹具上绿）

同一份 `shared-user-data`（锚点本体，未复制）：

| | 读数 |
|---|---|
| 修复前（`HEAD` 版脚本） | `[WARN] newest backup is 25.9 days old (limit 7)` → `ANCHOR_WARN` |
| 修复后（本 PR 版脚本） | `[OK] backups fresh (latest: 20261018-222345)` → `ANCHOR_OK` |

即：这次修的是用户实际看到的那一行，不是"夹具里的同类问题"。

### 变异反证（4 道，全部指名红）

驱动方式：把变异写进真文件 → 先断言「锚点命中 + 变异已落盘」→ 跑测试 → 按字节还原并核 sha256 与基线相等（`E4FD7455…` 前后一致）。

| 变异 | 内容 | 变红 | 指名用例 |
|---|---|---|---|
| M1 | 复原原始 bug：seed 也入候选 + 按目录名降序 | ✅ | 锁 1 |
| M2 | 年龄改回 `LastWriteTime`（mtime 可被复制/还原改写） | ✅ | 锁 2 / 3 / 5 |
| M3 | 强制 `$ageDays = 0`（陈旧判据失效 = 恒新鲜） | ✅ | 锁 2 / 3 |
| M4 | 无时间戳快照时谎报 `backups fresh` | ✅ | 锁 4 |

**M1 第一轮是假探针，如实留痕**：多行 here-string 锚点与文件行尾不匹配，`Replace` 未命中（脚本打印「锚点未命中 —— 假探针，作废」）。当场改成两个**单行片段**锚点重做才得到上表结果；没有把「锚点没命中」读成「这条反证不适用」。这类"假绿探针"与判据本身恒真是同型风险，故驱动里对每条变异都强制断言落盘。

### 遗留（不假装已闭合）

- **`WARN` 档仍 `exit 0`**（设计如此：WARN 不该阻塞自动化）。本片只把读数修正，**未**把 stale 升级成 FAIL——那会让每日 `sync-app.ps1 -Safe` 在无人备份的日子里变红，属行为变更，应另行决定而不是夹带。
- **备份保留策略**（保留 7 套）在 `sync-app.ps1` 内，本片未动。
- **第三种目录族未提示**：若将来出现 `manual-*` 之类新命名，当前修法会正确地**忽略**它（不参与新鲜度判定），但**不会**提示"存在未识别的备份目录"。本轮刻意不加，避免 WARN 噪音回归——代价是：真的出现新族时，只有夹具那条锁会提醒作者。
- **环境事实（不在本片改）**：新 worktree 未装依赖时 `check-workflow-structure.js` 会以 `Cannot find module 'js-yaml'` red。那是依赖未就绪、不是判据失灵；`pnpm install --frozen-lockfile`（本机 91 秒）后 test+run 双 rc=0。本地跑该门禁前必须依赖就绪。
