---
record: worktree-health-registry
task: 登记表生命周期管理（staleAllowedEntries + STRICT 开关）与受监管登记入口（register-allowed-worktree.ps1）
date: 2026-10-14
---

## 本次执行记录：登记表生命周期管理 + 受监管登记入口（worktree-health-registry，2026-10-14）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`，含 `scripts/` 工具脚本）⇒ 走完整质量节拍；隔离 worktree `D:/Data/projects/mp-worktrees/mp-worktree-health-registry`，裸分支 `worktree-health-registry`；改动 4 个文件（`mp-worktree-health.ps1`、`mp-worktree-health.test.ps1`、新增 `register-allowed-worktree.ps1`、`docs/session-isolation-automation.md`）|
| 第一性原因（QM-5 ①） | ✅ | 排查「`mp-worktree-health.ps1` 报 `ok=false` 导致 `start-mp-task.ps1` 跑不完」时定位到两个机制缺口：①登记表（`allowed-worktrees.json`）无生命周期管理——`wt-mp-ccgrecord` 于 2026-10-07 前后消失（既不在 `git worktree list`、路径也不存在），条目直到 2026-10-14 才被发现；②登记只能手改 JSON，而 harness 级 agent 工具（auto-exec 类，实测 `D:/Temp/egress-base`）建外来 worktree 时不登记 ⇒ `outside` 判据必然判红。②是**机制性必然**，不是偶发 |
| 逃逸分析（QM-5 ②） | ✅ | ①单元测试：原有 case 6-10 只锁「登记放行 / 损坏 fail-closed / 精确匹配」，**没有任何一条锁「登记项失效」**——因为功能本身不存在；②运行期：`ok=false` 只在有人跑隔离入口时才暴露，而 quarantine 340 条 / worktree 43 个的告警阈值噪声把真实信号淹掉；③代码审查：登记制 2026-10-01 落地时只写了「未登记的红」，没写「登记后怎么销账」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复：健康检查新增 `staleAllowedEntries` 报告字段 + 非 Quiet WARN（判据：条目既不是本仓库已注册 linked worktree、路径也不存在）；默认**仅出声不拦**（别的会话可能正在登记「即将建好」的 worktree，此刻判红会造成无谓阻塞），`MP_ALLOWED_WORKTREES_STRICT=1` 转硬闸。新增 `scripts/register-allowed-worktree.ps1` 唯一入口（`-Register`/`-Remove`/`-Clean`/`-Verify`/`-List`），登记/清理时顺手剔死项并写审计日志。回归锁：`mp-worktree-health.test.ps1` case 11-17 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① case 11/12 锁「默认出声 + STRICT 判红」两档；case 13 锁「活项不得算 stale」；case 14-16 锁入口四动作（含幂等）；case 17 锁 `-Verify` 只读（mtime 前后相等）；② `docs/session-isolation-automation.md` 新增一节写清判据、用法、STRICT 语义与 ASCII-only 约束；③ 该文档同时记录「5.1 读无 BOM .ps1 按 ANSI 码页解码，一个非 ASCII 字节就能让解析器报 ParserError」这一踩坑，并明确 ASCII-only 不能替代 BOM（本次两个 .ps1 因整文件重写丢 BOM 被 check-ps1-bom.js 当场拦下） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；删除数 0（纯新增 + 修改）|
| 接线棘轮 | ✅ | 未新增 `*.test.js`；改造的 `scripts/mp-worktree-health.test.ps1` 已被 `quality-gate.yml` 的 Gate 2d（`pwsh -File scripts/mp-worktree-health.test.ps1`）显式点名，`check-unwired-tests.js` OK |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/`；纯 scripts + docs 变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`；以 CI 的 `QG Autonomous` + `agent-judge` 替代（如实记录）|
| 远程同步 | PASS | 已合并：PR #3566 → merge SHA `01f07a3970d0ec2e7e50003e214d0c1afd5cc584`（2026-10-14T17:15:07+08:00，`git log origin/main --grep='(#3566)$' --format=%H\|%cI` 恰好 1 行）；`git ls-remote --heads origin worktree-health-registry` 返回 0 行证远端分支已删 |

### 遗留（不假装已闭合）

- **默认档「仅出声」是我做的取舍，未获机械验证**：选它的理由是「别的会话可能正在登记一个尚未建好的 worktree，此刻判红会造成无谓阻塞」。这个理由没有做过对照实验，只是推理。若后续发现静默失效条目同样有害，应把 STRICT 转默认并保留一个显式逃生开关。
- **登记动作本身仍靠人/工具自觉调用入口脚本**：本次只做到「有入口 + 有审计日志」，没有让 agent 工具建 worktree 时自动登记。要真正消除「机制性必然判红」，需要 harness 侧在建 worktree 后调用本脚本——那超出本仓范围。
- **同批次处置的 `D:/Temp/egress-base` 删除已先行完成**（R1-R5 全流程 + R7 校验主工作区与基线一致），不在本 PR 内；本 PR 只交付机制。
- **CI 实战追加取证（`QG Static` Gate 2b 首跑红）**：`check-ps1-bom.js` 报 `mp-worktree-health.ps1` / `mp-worktree-health.test.ps1` 两个 `missing-bom`（nonASCII=2247/1935）。根因是我用 `[IO.File]::ReadAllText` + `WriteAllText` 做整文件重写——读入时 BOM 已被剥离，写回即丢。这同时**修正了本记录初版的一处错误论断**：初版写「所以脚本要 ASCII-only」，而正解是**补 BOM**（该门禁就是为这个存在的，且它已记录过一次真实事故：`start-mp-task.ps1` 因一行中文 throw 而 ParserError，导致所有新隔离 worktree 开不出来）。ASCII-only 只是双保险，替代不了 BOM。修正已落在文档与代码注释。
- **PR 事件未自动触发 CI 的现象再次出现**（`gh pr checks` 报 no checks），本次与上次同样靠 `workflow_dispatch` 手动触发各 workflow。这不是本 PR 引入的问题，但它会让「零 pending/fail」这条合并判据只能靠手动触发来满足——根因未查，建议单独排查（疑与仓库的 GitHub App / 事件投递有关）。
