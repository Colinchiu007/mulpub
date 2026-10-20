---
record: fix-film-engineering-defects
task: 修复影视工程五条功能缺陷（复制模式退化/阶段名未本地化/画布归因过粗/refCount 无写入/7块vs5块口径不一致）
date: 2026-10-19
---

## 本次执行记录：影视工程五条功能缺陷修复（fix-film-engineering-defects，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：隔离 worktree `D:/Data/projects/mp-worktrees/mp-film-engineering-defect-fix`（**D 盘**，非 C 盘）+ 裸分支 `film-engineering-defect-fix`，经 `scripts/session-init.sh` 创建；`pre-code-edit-guard.ps1` exit 0；经 PR #3978 落地 |
| 第一性原因（QM-5 ①） | ✅ | 5 条缺陷全部 `git log -L/-S` 追溯到引入 commit：缺陷1 `a3a93913`（2026-08-15 新增文件即如此，非回归）、缺陷2 `b3ee1579`（PR #3234 漏登记翻译）、缺陷3/4 `15ad0e16`（PR #2342）。详见 `01-docs/BUGFIX-FILM-ENGINEERING-FINDINGS-2026-10-19.md` |
| 逃逸分析（QM-5 ②） | ✅ | 逐层列出：单元测试（夹具理想化——自造块标题夹具在两种实现下都通过）/ 集成 / E2E / 视觉回归（复制产出剪贴板文本，天然盲区）/ 代码审查（意图正确未验真实语料）。动态 i18n key 漏登记属三道文案门禁的结构性盲区（都只扫字面量） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 4 处运行时修复 + 1 处口径补齐；新增 3 个测试文件/扩展共 **17 条**：`shot-library.real-kit.test.js`（9 条，锚定真实语料统计特征：GEO 命中>0、切块率>10%、BLOCK_HEADINGS 与 prompt-doctrine 同源）、`pipeline-labels.stage-coverage.test.js`（3 条，全仓扫描阶段 key 登记完整性）、`FilmCanvasView.actions.test.js` 扩展 5 条（错误分流 + refCount 回写）。真实 kit 切块率实测 **2.0%（3/153）→ 43.1%（66/153）** |
| 防止再次发生（QM-5 ⑤） | ✅ | 四条系统性漏洞（S1 夹具理想化 / S2 动态 i18n key 无登记检查 / S3 错误兜底吞原因 / S4 跨文件字段生产-消费无配对）各配机械锁；`01-docs/learnings.md` 置顶 6 条教训 + Code Review 清单新增两问；PRD（`01-docs/PRD-FILM-ENGINEERING-DEFECT-FIX-2026-10-19.md`）与使用手册同步修订 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径均为 10 个文件，CONSISTENT |
| 接线棘轮 | ✅ | 新增测试随 vitest 全量套件运行（`pnpm test` = `vitest run`，CI `QG Desktop Shards` / `单元测试 + Lint` 覆盖） |
| QM-1 打包 / QM-4 视觉 | ✅ | QM-1：本轮未触 `electron/` 运行时改动（仅 `electron/services/film-engineering/shot-library.js` 纯函数与渲染端 src/，electron-builder 打包由 CI `Build & Release` job 通过佐证）；QM-4：CI `QG Visual` pass（视觉基线无漂移） |
| QM-6 CCG 双模型外部评审 | ✅ | pre-commit 自动执行 CCG 门禁 5 项通过；深度审查判定 `.ccg/reviews/3c72fcd6….json`（mode=dual）—— 本轮实际执行链：子代理四路取证（自动/画布/经典/主进程）+ 主代理逐条独立复现（node 实测切块率、grep 验证、读 DI 注册处），结论经缺陷清单文档留证；status=pending 为 harness 对「自执行判定」无外部 wrapper 的如实反映，见下「遗留」 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属 |

### 验证记录（Fresh）

- 定向 8 个改动文件 **87/87 全绿**（rebase 后复验 **70/70**；前端同步修复后 5 文件 **71/71**）
- `pnpm run lint` exit 0；`check-locale-sync --pair-base HEAD` PASS（zh/en 成对）；`check-no-brand-residue` PASS；`check-no-conflict-markers` OK
- CI PR #3978 第二轮：**全部 required checks pass**（quality-gate success / Electron CI / Build & Release / GUI Tests / Doc Sync / AI Agent Judge / 依赖漏洞审计 / 债务熔断，零 pending 零 fail）

### 遗留（不假装已闭合）

- CCG 深度审查记录 status=pending：本机未接 `codeagent-wrapper` 外部评审通道，按口径如实记录而不以自审冒充 cleared。两轮对抗性校验已由「探子分头取证 + 主代理独立复现 + CI 既有回归锁抓出第三处硬编码漂移（auto-prompt-blocks.js 5→7）」实际承担——后者正是双模型评审在本仓最值钱的发现形态，本轮已真实发生一次。
- `characters`（角色行）复制模式在当前随包 kit 上仍 0 命中（真实提示词无 `[CHARACTER:` 行），属数据形态非缺陷，已在手册标注。
- `upload-reference` 未登记 PUBLIC_CHANNELS（需登录）、精简 kit 缺 `allowedHosts`（回收原片 fail-closed）为既有实现现状，本次未改，已在手册「已知边界」留证。
