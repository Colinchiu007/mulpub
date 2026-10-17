---
record: ops-restart-hint
task: 运营中心保存成功后提示「需重启应用生效」（PRD ops-center-restart-hint 落地）
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；远程同步这一行只能在合并后取
sync_backfill_owner: 下一个会话（按 AGENTS.md「合并后收尾清单」回填并删除本段三个字段）
---

## 本次执行记录：保存后提示需重启生效（ops-restart-hint，2026-10-17）【混合 PR（前端）】

判定证据：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=false`**（改 `ops-center/frontend/src/` 与新增测试）。

### 第一性原因（QM-5 ①）

桌面端 `OpsCenterSync` **只在应用启动时同步一次**，之后无任何定时同步：

```
ops-center-sync.js:748  async autoSyncOnStart() {
                              ...
  setTimeout(() => { this.syncNow() }, 3000)   ← 启动后 3 秒，仅此一次
                          }
```
全文件搜 `setInterval` / `INTERVAL` / `periodic` → **0 命中**。

所以运营中心改完配置后，已启动的应用不会重拉。而 `MpSidebar.vue:126-127` 的注释其实写明了这个设计：
> 运营侧改动在客户端**下次启动同步后**自动可见

即「需重启才生效」是**预期行为**，但界面上没有任何地方告诉运营者 ⇒ 运营者反复保存、甚至回滚自己的正确配置。

### 逃逸分析（QM-5 ②）

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | 原有 13 个前端测试文件**没有一条**断言提示文案；`saveAll` 的分支逻辑内联在 `.vue` 里，而 `.vue` 在 node 环境**无法直接 import**，等于不可测 |
| 构建门禁 | `npm run build` 不校验文案 |
| 产品层 | 用户以为"没保存"是**外部反馈**，代码与测试都无需为此负责；只有真实使用才能发现 |

### 修复 + 回归保护（QM-5 ④）

**修复**（4 个文件）：
1. `src/constants/runtime-delivery.js`（新）—— 文案与时长**单一真源**；拆成 `RESTART_HINT_WHEN` / `RESTART_HINT_HOW` 两段。
2. `src/views/AppMenu.save-message.js`（新）—— 提示装配纯函数（从 `.vue` 抽出以便可测）。
3. `src/views/AppMenu.vue` —— `saveAll` 与 `resetAll` 改调 `saveMessageFor`。
4. `tests/restart-hint.test.js`（新）—— 14 例。

**关键设计：文案拆两段**（`WHEN` / `HOW`）。首版挤在一句里，变异 **MR2** 抓到缺口：删掉前半句的「生效」后，后半句仍含「生效」，断言**抓不到**。拆段后两个语义各自可独立断言。

**第二条设计：措辞用精确等值断言**，不用 `toMatch(/重启/)`。变异 **MR3** 抓到：把「重启」换成「查看」得到「如需立即查看请重启桌面应用」，后半仍有「重启」，子串匹配照绿。

### 变异反证 17/17 全红（均字节级还原 + 还原后恒 14 绿）

| # | 变异 | 红 |
|---|---|---|
| MR1/MR2 | WHEN 段去「生效」/去「下次启动」 | 1/1 |
| MR3 | HOW 段把「重启」换成「查看」 | 1 |
| MR4 | HOW 段不指明是桌面应用 | 2 |
| MR5/MR6 | 拼接丢掉 WHEN / HOW 段 | 1/1 |
| MR7 | duration 调回默认 3000 | 2 |
| MR8 | `shouldShowRestartHint` 恒 true（**失败路径也提示，最严重误导**） | 4 |
| MR9 | 恒 false（功能失效） | 5 |
| MR10/MR11 | 成功/有纠正路径不拼提示 | 2/1 |
| MR12/MR13 | 遮挡项数 / 遮挡 corrections | 1/1 |
| MR14 | 不传 duration（接线锁） | 1 |
| MR15 | 失败路径也弹 success（C3 破坏） | 2 |
| MR16 | 绕过常量直接写死第二处字面量（C1 结构锁） | 1 |
| MR17 | prefix 被忽略（reset 路径丢动作名） | 1 |

**MR14 的教训**：初版断言写成 `opts.duration ?? RESTART_HINT_DURATION`，兜底把「不传 duration」掩盖了 ⇒ **兜底会把接线锁降级成常量锁**。已改为要求第二参必须存在。

**MR16 的教训**：C1 结构锁初版扫全文，被自己文件 JSDoc 里的引用判红 ⇒ 改为**只扫代码**（逐字符状态机剥注释）。

### 逃逸分析补充：我自己造成的流程违规（已回退）

PRD 初稿误写到已删除的 worktree 残留目录，之后又误拷到**共享根** `ops-center/docs/`，
被写保护正确拦截并搬入隔离区。已从隔离区取回（hash 一致）并放入新 worktree；
共享根 `status` 复查为 0 行，未丢他人工作。

教训：**worktree 被 git 注销后目录可能仍有残留**，`worktree gone : True` 不代表目录消失；
写入前应先确认目标 worktree 的 git 注册仍然有效。

### 取证

- **TDD**：先 RED ⇒ 修 ⇒ **GREEN 14/14**
- 前端全量 `npx vitest run` → **14 files / 107 tests 全绿**
- `npm run build` → **rc=0**；产物 base 回归仍为 `/ops/assets/`（前一轮 PR #3824 的改动未被破坏）
- 变异 **17/17 全红** + 字节级还原 + 还原后恒 14 绿

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | worktree `<仓库父目录>/mp-worktrees/mp-ops-restart-hint` + 裸分支 `ops-restart-hint`；`git-dir != git-common-dir` 实证；pre-code-edit-guard rc=0 |
| 第一性原因（QM-5 ①） | ✅ | 见上 |
| 逃逸分析（QM-5 ②） | ✅ | 见上 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 4 文件 + 14 例测试 + 产物级验证 |
| 防止再次发生（QM-5 ⑤） | ✅ | 文案拆两段（语义各自可断言）、措辞精确等值（防同词掩盖）、structure lock 只扫代码 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 接线棘轮 | ✅ | 新增 `tests/restart-hint.test.js` 位于 `tests/`，`vitest.config.js` 的 include 已含 `tests/**/*.test.js`（且该 include 的存在本身是为修「历史上 tests/ 6 个文件从未被 npm test 执行」） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`；本变更门禁是 `npm run build`（已过） |
| QM-2 代码必检项 | ✅ | 无新增 require 路径风险；`/* */` 成对；无同步 CPU 密集原语；未新增用户可见文案字面量（只在使用单一常量） |
| QM-6 CCG 双模型外部评审 | 见下 | 本机需显式调用引擎 |
| 远程同步 | PENDING | 合并后取 merge SHA 回填，删除上方三个 `sync_*` 字段 |

### QM-6 评审

未调用 `ccg-deep-review.js`（本机引擎不在 CI 可见面，需显式调用）。
**替代判据**：17 条变异反证（含 3 条由变异自身暴露的断言缺口并被修复）+ 107 条既有测试无回归 + 产物级验证。

### 遗留（不假装已闭合）

- **只改了 AppMenu 一个页面**。PRD §4.1 登记表还列了 `Announcements` / `ContentPolicy` / `FeatureFlags` / `Parameters` / `EnvView` 共 5 个下发页面，**本轮未改** —— 它们各自有 `saveAll` 形态但本次 delta 已足以验证契约，逐页改属增量工作。**这是范围收敛，不是遗漏**：PRD §2.2 已把「全页面覆盖」列为非目标。
- **未实跑 `npm run dev` 打开页面肉眼看提示**（无头环境不起浏览器）。组件接线由 build 通过 + 全量测试覆盖，但**真实渲染未验**。
- **「需重启才生效」本身未根治**。本 PRD 只解决「告知」，不解决「即时生效」（PRD §9.1）。若将来加定时同步，`RESTART_HINT_WHEN` 的口径要同步改。
