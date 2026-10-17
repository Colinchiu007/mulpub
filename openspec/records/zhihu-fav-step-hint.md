---
record: zhihu-fav-step-hint
task: 补「阶段引导」——在「加载收藏内容」之前告诉用户下一步点哪个按钮，修复删旧入口时把路标一起拆掉造成的可用性回归
date: 2026-10-17
branch: zhihu-fav-step-hint
---

# 执行记录：知乎收藏批量「阶段引导」（zhihu-fav-step-hint，2026-10-17）

## 0. 动因（用户实测反馈）

上一轮 `zhihu-fav-entries-consolidate` 删掉旧整夹直采两个**常驻**按钮后，用户问：

> 「在知乎收藏文章区域，没有「采集并改写」按钮啊，怎么操作？」

**核因（代码位置实测，非猜测）**：「采集并改写」按钮在 `v-if="zhihuFavItems.length"` 容器内，而 `zhihuFavItems = ref([])` 只在 `loadZhihuFavItems()` 成功后填充（`BatchCollectPanel.vue`）⇒ **「加载收藏内容」之前该按钮在 DOM 里根本不存在**（不是禁用、不是灰色，是没渲染），且此时界面上**没有任何文字**告诉用户下一步该点「加载收藏内容」。

旧入口之所以没这个问题：它的两个按钮**常驻**（虽不可点），旁边配着「请先获取收藏夹并选择要采集的收藏夹」——**路标是常驻的**。删按钮对（双真源必须消除），**把提示一起删是过头**。

## 1. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | 运行时代码（renderer 层）+ i18n + 文档 |
| 隔离方式 | 独立 worktree `<仓库父目录>\mp-worktrees\<任务名>`，裸分支 `zhihu-fav-step-hint`，基线 `origin/main` = `c120b5a06` |

## 2. 实现

- 新增 computed `zhihuFavStepHint`（三阶段 + 凭据未配置时静默）
- 模板块加 `<div v-if="zhihuFavStepHint" class="col-hint zb-mt6" data-testid="zhihu-fav-step-hint">`（纯文案，不含任何可点控件）
- locale 新增 2 个 key（`collection.zhihuFav.stepHintNoFavlists` / `stepHintNeedContents`），**zh/en 成对**
- **明确不做**：不恢复旧按钮、不改新入口逻辑、不动后端通道

**locale 插入的坑（第二次踩，已用内容特征锚定）**：`zhihuFavlist` 与 `zhihuFav` 是两个**同级**区块、内层 key 同为 6 空格缩进，同名 key 两处各有一份。本次用 `^\s+zhihuFav:\s*\{\s*$` 精确锚定区块起点后插入，脚本复核「两 key 各出现 1 次」通过。

## 3. TDD

| 阶段 | 结果 |
|---|---|
| 先加 5 条锁 | **RED**：26 tests / **4 failed**（阶段 A、阶段 B、未配置、不复活旧入口） |
| 实现后首次 | 1 failed —— **用例间污染**：单跑通过、全量顺序失败 |
| 修正测试 | **GREEN：26 passed** |
| collection 全集 | **16 文件 / 288 用例全绿** |

**污染根因（值得记）**：`onMounted` 会异步 `loadZhihuConfig()`，它返回后**覆盖**组件里的 `zhihuConfig`。我最初用 `state(w,'zhihuConfig',…)` **事后**改状态，会被这次异步写回冲掉 ⇒ 单跑形态与全量顺序形态结果不同。**正解：在 `mountPanel()` 之前**就把 `window.electronAPI.zhihuGetConfig` 桩好（`mountWithSecret()`），不靠事后改状态。

## 4. 门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 独立 worktree，基线 `c120b5a06` |
| TDD | PASS | RED(4 failed) → GREEN(26 passed)；collection 全集 16 文件 / 288 用例 |
| eslint（`apps/desktop` 内） | PASS | rc=0（注意：根级跑会用不带 Vue parser 的配置，必须进目录） |
| i18n 成对与使用性 | PASS | `--keys` PASS（**2078** 个使用中 key 均存在）；`--pair-base origin/main` PASS；`--cjk` PASS（基线 1374 / 当前 1221） |
| QM-4 视觉回归 | PASS（**并登记为盲区**） | `collection` 像素 PASSED、未刷新基线。路标同样在**折叠组内**，默认态截图看不到 ⇒ 像素 PASS **不能**证明路标位置合理 |
| QM-1 打包 | N/A | 只改 renderer + locale，未触 `apps/desktop/electron/` |
| QM-2 代码必检项 | PASS | 无新增同步 CPU 原语、无新全局注册、无新 IPC 参数；新增计算属性只读既有 ref |
| QM-6 双模型评审 | 见第 6 节 | 变更规模判定 |
| 文档同步 | PASS | PRD §4.3（5 小节：问题/方案/显示项/验收/遗留）+ BUGFIX §9 第 6 条 + 本记录 |
| 行尾两口径对账 | PASS | 见提交前读数 |
| 远程同步 | PASS | PR **#3802** 已 squash 合并，merge SHA `ea257dd991b13320f4f376a5effc2dad10acb9d4`（`gh pr list --state merged --search 3802` 取到，mergedAt `2026-10-17T07:18:01Z`）；远端分支 `git ls-remote --heads origin zhihu-fav-step-hint` ⇒ 0 行（已删）。main push run `39013118257` 回读 **completed / success**（按「(merge SHA, workflow)」这一格判）。回填与销账同一次提交（本行 + bullet + 删 `sync_*` 三字段） |

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | eslint ✅ | i18n ✅ | QM-4 ✅ | QM-2 ✅ | 文档同步 ✅ | 行尾对账 ✅ | 远程同步 PASS

## 5. 事故：停止 dev server 时误杀了其他会话的进程（必须留痕）

**发生了什么**：跑完 QM-4 像素后要停掉自己起的 dev server（端口 5213）。我用

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match "5213|dev:vue|vite" }
```

把匹配到的 **7 个 PID 全部** `Stop-Process`。后果：

- `Get-Process electron` 计数 **8 → 0**（SOP 要求前后必须相等 ⇒ **现场判据已报红**）
- 同时带走了 `mp-hot-topics-pipeline-picker` 与 `mp-podcast-episode-rewrite-entry` 两个会话的 vite dev server

**根因**：匹配条件用了**宽关键词**（`vite` 会命中**所有** worktree 的 vite）。SOP 要求的是「按 PID 逐个终止」，而**选择 PID 的匹配条件同样是判据的一部分** —— 前面几轮我都用 `mp-<task>` **绝对路径**匹配，这次图快改了关键词。

**正确写法**（下次照此）：

```powershell
$wt = '<仓库父目录>\mp-worktrees\<任务名>'   # 只认本 worktree 绝对路径（用占位符表示，见下）
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*$wt*" }   # 只认本 worktree 绝对路径
```

> 文档里不写本机绝对路径：`check-doc-abs-paths.js` 的计数**不看存在性**，只按「本次改动集里新增的绝对路径」判红（**不得**用 `--write-baseline` 把新增记进去消红）。这条坑当场踩了一次，见第 5.1 节。

并在 `Stop-Process` **之前**逐个打印 `CommandLine` 人工过目、**只允许 1 个目标**。

**没有做补救性重启**：那是别的会话的运行状态，重启会掩盖问题且可能与它们自己的启动流程冲突。已在会话内如实报告，由用户/其他会话自行恢复。

### 5.1 顺带踩到的第二条：`--head=HEAD` 的判据**必须在 commit 之后跑**

改完代码做预跑时，`check-doc-abs-paths.js --base=origin/main --head=HEAD` 打印 **PASS**。提交之后再跑同一条命令，变成 **FAIL（超出存量基线 1 个文件）** —— 就是本记录第 5 节那段示例里我写的本机绝对路径。

**为什么**：commit 之前 `HEAD == base` ⇒ 改动集为空 ⇒ 判据扫了个寂寞，返回 PASS。这是**取证顺序问题，不是判据失灵**——把未提交时的那次 PASS 当成结论，就会在 CI 上吃红（CI 拿的是已提交的树）。

**同类已知形态**（本仓 SOP 已记）：`classify-docs-only.js --head=HEAD` 也必须在 commit 之后取证，未提交时恒返回 `docs-only=false files=0`。

**修法**：把示例里的绝对路径改成占位符 `<仓库父目录>\mp-worktrees\<任务名>`；判据随后 PASS。

**规则**：凡 `--head=HEAD` 取证的判据，**先 commit 再跑**；预跑阶段要跑就用 `--head=$(git rev-parse HEAD)` 之外的方式（例如 `staged` 模式）或干脆等提交后补跑。

## 6. QM-6 判定

变更规模：新增 computed + 1 个模板块 + 2 个 locale key + 5 条测试锁 + 文档 ⇒ 代码行数低于 200 行阈值，按 `ccg-review-decider` 判 **SINGLE**（不需要跨家族双模型）。实际读数见 `.ccg/reviews/` 下本次生成的判定记录。

## 7. 未闭合（不假装闭合）

1. **无真机验证**：路标出现/消失由 5 条组件锁覆盖，但真实窗口里的**视觉位置**（是否紧跟在对应按钮下方）未截图确认。
2. **像素门禁仍不覆盖**：路标在折叠组内，`collection` 默认态截图看不到 ⇒ 像素 PASS 不能证明位置合理。
3. **文案里的按钮名与 locale 无机械校验**：S1/S2 只断言「包含关键词」；若将来改 `loadContents` 文案而忘了改路标，锁不会红。补跨 key 引用校验的代价大于收益，暂列 §9 范围外。
4. **可用性引导本身仍不在任何机械判据覆盖面上**：这次是靠用户真机走查发现的。要机械化，需要「无可见主操作按钮时必须存在指路文案」这类结构判据，属新一轮设计工作。
