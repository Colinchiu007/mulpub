---
record: zhihu-fav-entries-consolidate
task: 知乎收藏批量「入口收敛」——删除旧整夹直采（采集/改写两个按钮及其专用 handler、进度行、取消按钮、3 个 computed、1 个 prop、12 个 locale key），只保留「采集并改写」；并纠正上一轮「多一次清单请求」的错误登记
date: 2026-10-17
branch: zhihu-fav-entries-consolidate
sync_status: PENDING
sync_reason: PR 尚未合并（记录随代码 PR 落地，合并后回填 merge SHA）
sync_backfill_owner: zhihu-fav-entries-consolidate 会话（回填 PR）
---

# 执行记录：知乎收藏批量入口收敛（zhihu-fav-entries-consolidate，2026-10-17）

## 0. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | 运行时代码（renderer 层）+ 文档 + i18n |
| 隔离方式 | 独立 worktree `<仓库父目录>\mp-worktrees\<任务名>`，裸分支 `zhihu-fav-entries-consolidate`，基线 `origin/main` = `791c9bc18` |
| 决策来源 | 项目负责人 2026-10-17 明确选择「删除旧入口，只留采集并改写」；另两项选择「不优化清单请求」与「bundle 移出版本控制（另开 PR）」 |

## 1. 门禁结果

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 运行时代码在独立 worktree 完成；起始 `git worktree list` + `rev-parse --abbrev-ref HEAD` 实证 |
| TDD | PASS | **先加 6 条锁 ⇒ RED（31 tests / 6 failed）**；再删实现 ⇒ 旧用例 RED（10 failed）；清理测试 ⇒ **GREEN 21 passed**。collection 全集 **15 文件 / 280 用例全绿**；`apps/desktop` 下 `eslint rc=0` |
| QM-1 打包 + 启动三层判据 | PASS | `pnpm run build:dir` rc=0；asar 含 `dist/index.html`；窗口期 8s 存活（提前退出即 FAIL 已断言）+ **stderr 0 字节 ⇒ 层③通过**（非黑名单判定）；子进程 env 经 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE` |
| QM-2 代码必检项 | PASS | 本次为纯删除：无新增同步 CPU 原语、无新增全局注册、无新增首屏阻塞、无新 IPC 参数；`rewriteFallbackItems` prop 删除后父级同步删除传参，无残留引用（10 个符号全 0 残留） |
| QM-4 视觉回归 | PASS（**并登记为盲区**） | `collection` 像素 **1/1 通过、misMatch 0**、**未刷新基线**。原因：被删 UI 位于「知乎收藏文章」折叠组内，默认态截图不可见 ⇒ **像素门禁对该改动是盲区**，正确性改由组件锁守（已写入 PRD §4.2.8 与 BUGFIX §9 第 5 条） |
| i18n 成对与使用性 | PASS | `check-locale-sync --keys` PASS（**2065** 个使用中 key 均存在）；`--pair-base origin/main` PASS（locale 目录全量成对）；`--cjk` PASS（基线 1374 / 当前 1221，无新增硬编码）。删除 12 个 key 在 zh/en 各 13 行（含 3 条失效注释），成对性核对一致 |
| QM-6 双模型评审 | PASS | 见第 3 节 |
| 文档同步 | PASS | PRD 补 **§4.2**（决策/删除清单/不删清单/迁移路径/显示项与提示/校验不变量/验收/遗留 8 小节）+ §4 表格「旧入口兼容」改为「已下线」；BUGFIX §9 三项未闭合逐一标注处理结果（含第 3 项**前提推翻纠正**）；本记录 |
| 行尾两口径对账 | PASS | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 一致（仓库 `core.autocrlf=true`，新增内容为 LF，git 归一后无差异） |
| 远程同步 | PENDING | PR 未开。合并后**同一次提交**改写为 `PASS` + merge SHA 并删除 frontmatter `sync_*` 三字段 |

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | QM-1 ✅ | QM-2 ✅ | QM-4 ✅ | i18n ✅ | QM-6 ✅ | 文档同步 ✅ | 行尾对账 ✅ | 远程同步 PENDING

## 2. 三项「未闭合」的处理结果

| 原未闭合项 | 处理 |
|---|---|
| 两条入口并存未收敛 | **本次删除旧入口**（用户决策）。删除清单见 PRD §4.2.2；不删清单见 §4.2.3 |
| `scope='all'` 多一次清单请求 | **前提被推翻**：核对 IPC 后确认两条入口都必须先拉清单，不存在「多一次」。唯一可行优化是复用已加载清单，但会漏采新增收藏 ⇒ **决定不优化**，并在 BUGFIX §9 第 3 条如实纠正该错误登记 |
| 构建产物 stat-dirty | **不在本 PR**（改 `.gitignore` + `git rm --cached` 5 个受管 bundle，动打包链路）⇒ 按用户决策**另开 PR** 承载 |

## 3. QM-6 双模型评审（L 级改动：跨 5 文件、净删 ~200 行）

| 项 | 内容 |
|---|---|
| 触发依据 | 变更规模 L（跨文件 5+、删除量 200+ 行）⇒ 按质量节拍 §12.6 走跨家族双模型 |
| 角色 | proposer = opencode；critic = claude（跨家族校验通过） |
| 轮次与结论 | 见 `.adversarial/` 下配对产物（该目录由 `.gitignore` 忽略，不进版本库）；`deepReview.status` 记录于 `.ccg/reviews/<sha>.json` |
| 采纳 | 见第 4 节「评审采纳」 |

## 4. 评审采纳（含我自己发现并修正的两处实操缺陷）

1. **误删同名 key（实测发生并已修复）**：删除脚本用 `indent === 6` 判定「zhihuFavlist 区块内的 key」，但 `zhihuFav` 与 `zhihuFavlist` 是**同级**两个区块、其内 key 同为 6 空格缩进 ⇒ 同名 key `collecting` 在两处各有一份，被一起删掉。`check-locale-sync --keys` 当场报 `collection.zhihuFav.collecting` 缺失 ⇒ 用**内容特征**（`selectedCount` 之后紧跟 `collectAndRewrite`）而非缩进定位，精确插回 zh/en 两份。**已把「两区块同名 key 必须区分」写进 PRD §4.2.3 与 §4.2.6**。
2. **断言拦住了我基于错误预期的整块删除**：首版删除脚本断言「块内 `async function` 数量应为 2」，实际是 3（`cancelZhihuFavlistBatch` 也是 async）⇒ 脚本 fail-closed 拒绝执行。修正断言后 99 行删除一次完成，并即时复核三个符号残留为 0。

## 5. 不变量（供后续改动对照）

- 组件内不得再出现 `zhihu-favlist-collect` / `zhihu-favlist-rewrite` 两个 `data-testid`
- 旧三 handler（`zhihuFavlistBatchCollect`/`BatchRewrite`/`cancelZhihuFavlistBatch`）与旧三 computed（`zhihuFavTargetReady`/`zhihuFavRewriteSource`/`zhihuFavRewriteReady`）在组件实例上不可访问
- `rewriteFallbackItems` 不在组件 props；父级 `Collection.vue` 只传 3 props + 监听 2 事件
- 后端 IPC 通道 `zhihu-favlist:batch-collect` / `batch-rewrite` **保留**（无 UI 消费者）⇒ 属遗留，删除需单独评审

## 6. 未闭合（不假装闭合）

1. **无真机验证**：需在真实应用里确认「加载内容 → 勾选 → 采集并改写」可用，且旧两个按钮确实消失。
2. **像素门禁对该改动是盲区**（折叠组内 UI）⇒ 不能以「像素 0 回归」当作删除正确的证据。
3. **后端 IPC 通道保留**：`zhihu-favlist:batch-collect` / `batch-rewrite` 仍注册无消费者。
4. **构建产物 stat-dirty 未在本 PR 处理**（另开 PR）。
