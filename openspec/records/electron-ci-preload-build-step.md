---
record: electron-ci-preload-build-step
task: 给 Electron CI 的 push-only 桌面全量测试补「先重建构建产物」步骤，并把这条配对关系做成跨 workflow 的锁
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（按 AGENTS「PR 自动合并」收尾链回填并删除本三字段）
---

## 本次执行记录：Electron CI push 连红的根因修复与配对锁（electron-ci-preload-build-step，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（CI 属运行面）：worktree `mp-electron-ci-preload-build-step` + 裸分支 `electron-ci-preload-build-step`；`node scripts/verify-worktree-deps.js` OK（11 项解析全部指向本 worktree） |
| 第一性原因（QM-5 ①） | PASS | 引入点 = `826fa7e13`（PR #3782，change `bundle-untrack`）：把 5 个受管构建产物移出版本控制（`.gitignore` +11 行并删文件），并给 `quality-gate.yml` 的三个消费 job 各补了「先重建再测」，**漏了 `electron-ci.yml`**。这条漏能长期存在，是因为同仓那条同族配对锁（`workflow-contract.test.js` 的「跑桌面测试的作业必须先备好 Electron 二进制」）**把判定域写死成 `quality-gate.yml` 一个文件** |
| 逃逸分析（QM-5 ②） | PASS | 断言层没逃——那 9 个测试文件在 CI 上确实红了。逃的是**归因**：`electron-tests` 的那一步带 `if: github.event_name != 'pull_request'`（2026-09-17 为省 PR 时间把桌面全量收敛到 main push），required check 永远看不到它 ⇒ PR 全绿、main push 连红 15 次。审查层：#3782 当时只看「PR 侧 CI 绿」，而 PR 侧根本不跑那一步 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：测试步之前插入 `Build preload bundles`（两条命令 + 与测试步逐字相同的 `if`）。回归保护三条锁（扫描锁 / 顺序行为锁 / 门槛字面量锁），现场：`node --test .github/scripts/workflow-contract.test.js` = **42 tests / 42 pass / 0 fail**；CI 的 Gate 3 那条命令（8 个契约测试）本机原样跑 = **142 / 142 / 0** |
| 防止再次发生（QM-5 ⑤） | PASS | 新增判据即上一条三把锁，落 `.github/scripts/workflow-contract.test.js`（该文件被 `quality-gate.yml:708` 的 `node --test` 显式点名，跑在 `QG Static`，`if: needs.changes.outputs.docs-only != 'true'` ⇒ 本 PR 必跑）；`scripts/check-unwired-tests.js` rc=0（检查域 94 个测试文件）。变异反证六道 + 未变异正控一道全部 CAUGHT 且红集互不相同（A1 摘整步 / A2 只让重建步 `if` 漂移 / A3 漏一条脚本 / A4 消费者谓词永不命中 / A5 顺序那一支永不成立 / A6 两处 `if` 一起删），每道按 md5 逐字节还原 |
| 行尾与 diff 对账 | PASS | 两口径 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 相等，删除数为 0；工作副本 EOL 实测：`workflow-contract.test.js` 1320 CRLF / 0 loneCR / 0 bareLF（追加后仍是纯 CRLF），`electron-ci.yml` 同域 |
| 接线棘轮 | PASS | 未新增测试**文件**（三条测试追加在已接线的 `workflow-contract.test.js` 内）；`check-unwired-tests.js` OK |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/**` 运行时代码与任何 UI 文件；改动面 = `.github/workflows/electron-ci.yml` + `.github/scripts/workflow-contract.test.js` + 两份 `.ccg/reviews` 原件 + 本记录 + CHANGELOG |
| QM-6 CCG 外部评审 | PASS（单模型，替代通道） | `scripts/ccg-review-decider.js` 判 `mode=SINGLE`（98 行 / 2 个源文件 / 无敏感命中）⇒ 不属双模型强制范围。实跑一路外部模型：`opencode-cli run --agent general --model opencode/big-pickle`，驱动 rc=0、结论进 stdout（判定口径 =「产物落盘 **或** stdout 有结论」）。原件与任务书均入库：`.ccg/reviews/electron-ci-preload-build-step-review-single.md`、`…-review-brief.md`。claude 通道同日三次 `status 1` + wrapper 自删日志 + 零产物，而同通道短探针 rc=0 ⇒ 登记为「该通道本次不可用于长任务」，不以自审冒充。**逐条处置**：C1 成立（同意根因与修法）；C3(b) 成立并已采纳（关系型 `if` 相等判据挡不住"两处一起漏写" ⇒ 补绝对值门槛锁）；C2 不采纳其修法、接受为已登记遗留（详见下方遗留第 1 条，含当场做掉的"按产物反查读取方"10 文件清单）；C3(a)、C4 否证（C4 前提"存在先构建后跑 check-max-lines 的 job"实测不成立：该检查只在 `debt-guard.yml` 被调用且该 workflow 无构建步骤，`electron-ci.yml` 内出现 0 次） |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin electron-ci-preload-build-step` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 PASS（本 worktree `node scripts/check-no-brand-residue.js` rc=0，扫描 9832 个 tracked 文件） | 文档同步 PASS（`node scripts/openspec-sync-check.js` rc=0：387 tasks / 57 active changes / 231 archives） | 远程同步 PENDING

### 本机 A/B 与验收边界（不假装已闭合）

- **A/B 是当场做的，不是推演**：产物缺席时抽测 3 个文件 = `3 failed files / 4 failed tests`；
  按 YAML 里那一步的**原文命令**逐条执行（做法：用 js-yaml 解析 `electron-tests` 的 steps，取出重建步 `run`
  的每一行逐条 spawn，而不是另敲一遍"看起来等价"的命令）→ rc=0、5 个产物 5/5 在场；再跑齐那 9 个文件
  = **9 passed / 72 tests**。顺序与门槛也在同一处断言：`buildIdx=7 < testIdx=8`、两步 `if` 逐字相同。
- **本 PR 不能自证 push 侧转绿**：被判修的那一步在 PR 事件上不跑，PR 绿只证明"没把别的搞坏"。
  真实验收 = 合并后 main push 上 `Electron CI` 那一次运行，已按 AGENTS 第 7 条写成本片收尾必查项；红了就在同一轮补一片，
  不得以"我的 PR 绿了"把 main 的红留给下一个会话。
- **锁与缺陷写在同一个提交里 ⇒ 不构成独立证据**：CI 只会看到"改动 + 锁"同时存在。独立性的唯一来源是那六道变异，
  它们是在本机工作树上注入被禁形态后实跑的（还原按 md5 校验）。

### 遗留（不假装已闭合）

- **消费者谓词只认两种命令行形态**（单行 `--filter @multi-publish/desktop test…` 与 PowerShell 参数数组形态）。
  外部评审 C2 建议"扩形状"，实测当前全域**没有**任何 job 用 `working-directory: apps/desktop` 或直接 `vitest run`
  （两条 grep 均 0 命中），为一个不存在的形态加分支只会得到一条无现场覆盖的死判据 ⇒ 不加。
  真正的收敛方向是反过来做：从"哪些测试文件真读这 5 个产物"映射到 job（当场已跑出清单：提到名字的有 10 个，
  真读盘的是那 9 个；另 2 处 `webview-manager.test.js` 的 `toMatch(/monitor-preload(\.bundle)?\.js$/)` 与
  `home-shell-title.test.js` 的 `/fake/…` mock 不碰文件系统），留作下一次把判据从"命令行形态"换成"读盘行为"。
- **`test:startup` 被排除的依据是一条历史观察**（`build.yml` 的 build job 无重建步骤而 push 实测 success），
  不是依赖分析。它由行为锁的 `NOT_A_CONSUMER` 断言钉住当前口径；若哪天有用例让 startup 去读这 5 个产物，本锁不会立刻红。
- **`check-max-lines.js` 的扫描域含 gitignored 构建产物**：`readdirSync` 不 consult `.gitignore`，任何本地跑过
  `build:preload` 的人都会因 `home-shell-preload.bundle.js`(1795 行) 与 `preload/index.bundle.js`(1744 行) 得到
  一条与自己改动无关的 `NEW_OVER_LIMIT`（把产物挪开后 rc=0）。CI 侧无"先构建后检查"的 job ⇒ 本 PR 不引入新红。
  收窄判据域属"改谁来守门"，另片处理（任务已登记）。
- **同 job 内 `Electron smoke test` 的历史状态未知**：该步排在测试步之后，而测试步自 05:36Z 起每次都先断掉 ⇒
  smoke 在这 15 次里从未真正跑过。本 PR 让它在 push 上恢复可运行，但它自己会不会露出新问题，只能等合并后那次 push 的读数。
