# 执行记录 — 视频任务编辑页 UX 补齐（`s2v-result-ux-polish`）

| 项 | 值 |
| --- | --- |
| 分支 | `s2v-result-ux-polish` |
| worktree | `<worktree>/mp-s2v-result-ux-polish`（`scripts/start-mp-task.ps1 -TaskName s2v-result-ux-polish`，`verify-worktree-deps.js` OK：11 个 `@multi-publish/*` 全部解析到本 worktree） |
| 日期 | 2026-10-20 |
| PRD | `01-docs/PRD-S2V-RESULT-UX-POLISH-2026-10-20.md` |
| 上游 | PR #4064（merge `f6a61d24c`，PRD `01-docs/PRD-S2V-RESULT-VIEW-PERF-2026-10-20.md`） |

## 1. 变更类型与隔离声明

**运行时变更**（`apps/desktop`：主进程媒体服务 + 渲染端 7 处交互 + locale + 测试 + 文档）。
已在独立 worktree（D 盘）完成，共享根保持 `main` clean。经 PR + CI 后合并。

## 2. 为什么开这一轮

上游 PR #4064 修的是用户**直接看到**的四个现象。合并后复查代码（而非界面），发现两类遗留：

- **D1 令牌容量 128 + FIFO 淘汰**：169 段 × 最多 5 个媒体位 = 最多 845 个 URL ⇒ 展开到约 26 段就开始淘汰 ⇒ 被淘汰的段图 404 ⇒ 渲染端 `@error` 兜底显示「未生成」。**用户最初抱怨的破图会回归**。
- **D2 令牌 TTL 固定 15 分钟**：在编辑页停留 >15 分钟 ⇒ 全部令牌清空 ⇒ 图片整片变「未生成」。
- **D3 滚动高亮无节流**：169 段全展开时每个 scroll 事件 169 次 `getBoundingClientRect`（强制重排）。
- **U1–U7 七处 UX 缺口**：不显示失败原因、进度摘要被关在 `v-if="videoPath"` 里、大跳无反馈、169 段点 8 次「显示更多」、无回顶、无搜索筛选、键盘 Tab 要按 169 次。

## 3. TDD 证据（先红后绿）

| 阶段 | 命令 | 读数 |
| --- | --- | --- |
| 主进程 RED | `vitest run electron/services/story2video-media-server.test.js` | `2 failed / 8 passed`：`expected 128 to be 845`、`expected 404 to be 200` |
| 主进程 GREEN | 同上 | `10 passed` |
| composable RED | `vitest run src/views/video-creation/composables/useResultPreviewMedia.test.js` | `53 tests \| 20 failed`（新函数未定义） |
| composable GREEN | 同上 | `53 passed` |
| 渲染端 RED（拆分前） | `vitest run src/views/ResultView.test.js` | 4 条滚动高亮失败：`expected -1 to be 60` / `expected 0 to be 1` |
| 渲染端 GREEN | 同上 | `123 passed`（回到拆分前基线） |
| 新守护 | `vitest run src/views/ResultView.ux-polish.test.js` | `16 passed` |
| 消费方并集 | 12 个文件 | `317 passed / 0 failed` |

## 4. QM-1 打包验证（改 `apps/desktop/electron/`）

| 步骤 | 读数 |
| --- | --- |
| `pnpm run build:vue` | rc=0，产出 `dist/index.html` + `dist/assets` + `dist/fonts` |
| `electron-builder --win --x64 --publish never` | **rc=0**，产出 `dist-electron/win-unpacked/Multi-Publish.exe` + `Multi-Publish.Setup.0.2.0.exe` |
| asar 清单 | `\electron\services\story2video-media-server.js` 在包内 |
| require 链（从 asar 解出后 require） | `exports=…,DEFAULT_MAX_ENTRIES,MAX_REGISTRY_ENTRIES,…`；`defaultMaxEntries=1024`、`maxRegistry=2048`（容量修复确实进了产物） |
| 启动窗口期存活 | `aliveAt8s=true`、`exit=null` |
| stderr | **0 字节** |
| 判定 | **QM1=PASS**（存活 8s + stderr 为空 + asar require 链通过） |

> 取证方式：一次性验证脚本（提取 asar → require 改动模块并打印容量常量 → 以显式 env 启动产物并观察 8s 窗口期 + stderr 三层判据），用后按仓库惯例删除，不留在工作区。父环境带 `ELECTRON_RUN_AS_NODE` 时脚本会为被测进程剔除并出声告警（该变量会让 Electron 以纯 Node 模式静默退出，与「启动干净」完全同形）。

### ⚠️ 第一次打包判 `NEEDS_REVIEW`（真实流程缺陷，已修）

第一次跑 `electron-builder` **没有先 `pnpm run build:vue`**，`apps/desktop/dist` 不存在 ⇒ 产物里没有渲染端 bundle ⇒ 启动 stderr 报：

```
electron: Failed to load URL: … resources/app.asar/dist/index.html with error: ERR_FILE_NOT_FOUND
```

进程**存活**、rc=0，若只看「打包成功」或只看「进程还在」就会**假绿**。这正是 AGENTS.md 三层判据里第 ② 层存在的理由（stderr 非空但未命中黑名单 ⇒ 不得判通过）。
修法：先 `pnpm run build:vue`（产出 `dist/index.html` + `dist/assets` + `dist/fonts`）再打包，然后复验。

> 记入踩坑：**QM-1 的入口不是 `electron-builder`，而是 `pnpm run build:win`（= `build:vue` + `electron-builder`）**。单独跑 electron-builder 会打包一个没有前端的壳。

## 5. 门禁读数（逐条）

| 门禁 | 读数 |
| --- | --- |
| `check-max-lines.js` | PASS（`ResultView.vue` 1886 行 ≤ 1890 点名目标；测试账本未超容差） |
| `check-unwired-tests.js` | OK |
| `check-locale-sync.js --cjk` | PASS（基线 1330，当前 1125，无新增硬编码） |
| `check-locale-sync.js --pair-base origin/main` | PASS |
| `check-no-brand-residue.js` | PASS（11025 个 tracked 文件） |
| `check-debt-budget.js` | PASS |
| `check-doc-abs-paths.js --base=origin/main` | PASS |
| eslint（13 个改动文件） | **0 error**；1 条基线已有 warning（`IMAGE_MIME_TO_EXT` 未用，非本轮引入） |
| QM-4 视觉回归 | **未跑**（本机基线仓库级失效，同 `result-view-back-btn-style` 结论） |
| QM-6 双模型评审 | 见 §7 |

## 6. 结构性处理（为什么拆文件）

`ResultView.vue` 是 `.github/scripts/max-lines-baseline.json` 的 **targets 点名还账对象**（零增长容差）。
第一版把失败摘要卡直接写进宿主 ⇒ 门禁当场红：

```
❌ TARGET_GREW: apps/desktop/src/views/ResultView.vue 现 2060 行已超过点名目标 1890 行（超 170）
❌ TEST_LEDGER_GREW: apps/desktop/src/views/ResultView.test.js 较登记值 2175 膨胀 453 行（容差 200）
```

按仓库既有做法拆（而不是上调 targets 消红）：

| 新文件 | 承载 |
| --- | --- |
| `video-creation/ResultPreviewPlaceholder.vue` | 占位区块 + 失败摘要卡的模板与文案拼装 |
| `video-creation/ResultSegmentJumpBar.vue` | 右侧定位条 + roving tabindex + 跳转中态 |
| `video-creation/composables/useSegmentNavigation.js` | `resolveJumpFocusTarget` / `jumpToSegmentIndex` / `expandAllSegments` / `backToTop` |
| `views/ResultView.ux-polish.test.js` | 16 条新守护（按关注点分文件，不继续堆大文件） |

结果：宿主 **2060 → 1886 行**（净降 174），测试账本回到容差内。

## 7. QM-6 评审（三轮，全部逐条裁决）

`deep-review.sh` 在本机因把 POSIX 路径传给 Windows `node` 而失败（`MODULE_NOT_FOUND（POSIX 路径被 Windows node 解析成盘符前缀路径）`），
改用 Git Bash 直接调用底层 `ccg-deep-review.js` 跑通 **opencode（提案）/ claude（评审）** 双后端。

| 轮次 | 覆盖 | 产出 | 裁决 |
| --- | --- | --- | --- |
| 1 | 主提交（1566 行，DUAL / Red Team） | 6 条 / 4 维度 / 最低 6 分 | i1(Critical)、i5 成立→**已修**；i2、i3 经核实**不成立**（附行号反证）；i4 部分成立；i6 已知取舍 |
| 2 | i1/i5 修复提交（82 行，SINGLE） | 8 条 / 4 维度 / 最低 6 分 | i1 成立→本轮关闭；i5 **部分**成立（「并发 rAF」不成立，但查出 `recalc` 只清标记会让旧回调清掉新标记）→ 补 `cancelScrollFrame`；i2、i3、i6 **不成立**；i7、i8 记入 learnings |
| 3 | 滚动高亮下沉 composable（148 行，SINGLE） | 7 条 / 4 维度 / 最低 4 分 | i4 成立（性能数字未实测）→**补 500 段实测**；i5 有意取舍→写进 PRD §7.3；i1、i2、i3 经核实**不成立**；i6、i7 已修/已记录 |

### 未完成项（如实记录，不伪造）

三轮里各有一条被判为「高危域」需**外部复核**（`performedBy` 逐字 `claude` + 公开 PR 评论 URL）：
第 1 轮 i3（`crypto`，内容实为文本清洗与字符串匹配，疑似误分类）、
第 3 轮 i2（`auth`，内容实为回环能力令牌服务的容量，威胁模型未变）。
实际调用 `claude` CLI 返回 **HTTP 402 Insufficient credits**（OpenRouter 无额度），外部复核**未能取得**。

因此 `adjudication.json` 的 `externalReview` 三格保持 `null`，**未填任何假 URL**；
两条记录的 `deepReview.status` 都取 `needs_revision`——不是「已全部收口」，
而是「有 1 项机制要求的外部复核因后端不可用仍未完成」。
这两条争议本身已由行号级反证 + 绿测反驳，不因外部复核缺失而改判。

## 8. 踩坑（本轮真实发生）

1. **前沿 vs 延迟节流**：第一版把 `computeActiveSegmentIndex` 推迟到 rAF 里算（trailing），导致 4 条既有滚动高亮用例失败，更重要的是**程序化重算被同帧吞掉** ⇒ 删除分段后高亮滞留在被删掉的那一段。改为前沿节流（首帧立即算）+ 程序化走 `recalcSegmentHighlight()`（清帧标记后立即算）。
2. **`window.confirm` 在 jsdom 里存在但返回 falsy**：`expandAllSegments` 的确认逻辑因此一直走「取消」分支，用例显示 `expected 20 to be 60`。正解是在用例里 stub `confirm`，而不是把生产的确认逻辑删掉。
3. **测试文件切分切偏一行**：`ReadAllLines` + 区间拼接时把「内层 describe 的收尾」也带走了，一度让两个文件都语法错误（`Expected '}', got '<eof>'`）。判据要从「括号配平脚本」换成「直接跑 vitest」——前者对含模板字符串（`${}`）的文件会算错。
4. **`__dirname` 重复拼接**：QM-1 验证脚本放在 `apps/desktop` 下却又拼上 `apps/desktop`，报 `ENOENT …\apps\desktop\apps\desktop\…`。与 `scripts/lib/qm1-paths.js` 记录的同类。
5. **清理语句吃掉结论**：QM-1 脚本在打印判据**之前**删临时 userData，进程刚被 kill 时 `lockfile` 仍被占用 ⇒ `EBUSY` 抛异常，把「存活 + NEEDS_REVIEW」的结论一起吞了。改为先出结论再宽容清理。
6. **只跑 `electron-builder` 会打出没有前端的壳**（见 §4）。

## 9. 遗留（不假装闭合）

- **未做虚拟滚动**：169 段展开后仍是 169 个 DOM 卡；1000 段级需变高虚拟滚动（含锚点补偿），会同时影响成功任务滚动体验，独立排期。
- **未做渲染端 `revoke`**：容量提到 1024 后 169/200 段都在容量内；>200 段仍会 FIFO 淘汰。彻底修法要新增 revoke IPC（改 preload 契约）。
- **IPC 次数本身未降**：仍每段最多 5 次 `create-share-url`；服务端批量签 URL 独立议题。
- **原因码语义有限**：只聚合后端已给的 `failureCode`，不猜未给的成因。
- **`expandAllSegments` 用原生 `window.confirm`**：与应用内弹窗视觉不一致，后续换 `UiModal`。
- **搜索无防抖**：本地全量过滤 <1ms，加防抖反而引入输入延迟。
- **QM-4 视觉回归未跑**：本机基线失效，建议基线修复后统一重建。
- **未做实机 wall-time 复测**：滚动收益来自静态推算 + 单测。

- **导航状态与 `vm` 耦合（第 3 轮 i5，有意取舍）**：`jumpFocusIndex` / `jumpPendingIndex` 留在宿主，composable 收 `vm` 而非拆原始参数。理由：宿主是跳转的唯一状态源（上一轮 A12「两份计数漂移」的正解），且 `vm` 形状换来 Options API 下的可桩单测。若要真解耦，代价是把 `refs`/`segments`/`renderWindow`/`refresh` 全当参数（6+ 个）。见 PRD §7.3。
- **未做虚拟滚动**：169 段展开后仍是 169 个 DOM 卡；1000 段级需变高 windowing（含锚点补偿），会同时影响成功任务的滚动体验，独立排期。
- **未获得高危域外部复核**：见 §7「未完成项」。机制要求 `claude` + 公开 PR 评论 URL，`claude` CLI 当前 402（无额度）；两条记录如实标 `needs_revision`，未伪造证据。

## 10. 门禁结果总表

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| TDD（先红后绿） | PASS | RED：`expected 128 to be 845` / `expected 404 to be 200` / 20 条新函数未定义 / `expected -1 to be 60`；GREEN：消费方并集 12 文件 **319 passed**（含 500 段实测 2 条） |
| QM-1 打包验证（改 `electron/` 必做） | PASS | `build:vue` + `electron-builder --win --x64` rc=0；asar 内含改动模块；产物内 `defaultMaxEntries=1024`/`maxRegistry=2048`；启动 8s 存活、stderr **0 字节**。首次因未先 `build:vue` 判 NEEDS_REVIEW（`ERR_FILE_NOT_FOUND`），补构建后复验 PASS |
| `check-max-lines.js` | PASS | 宿主 1847 ≤ 1890（点名还账零增长）；测试账本回容差内（新守护独立成 `ResultView.ux-polish.test.js`） |
| `check-unwired-tests.js` | PASS | 全部测试已接线或按欠账登记 |
| Gate 7 locale 成对 | PASS | `--cjk` 基线 1330 / 当前 1125，无新增硬编码；`--pair-base origin/main` PASS；26 个新键 zh/en 成对 |
| `check-no-brand-residue.js` | PASS | 11034 个 tracked 文件无品牌残留 |
| `check-debt-budget.js` | PASS | 所有债务指标在基线内 |
| `check-doc-abs-paths.js` | PASS | 无新增本机绝对路径（曾因记录里写 POSIX→Windows 路径例子超基线，改成文字描述后通过） |
| `check-pr-exec-record.js` | PASS | OK：本 PR 携带执行记录 |
| `check-gate-record-debt.js` | PASS | 记录含 `远程同步` 行（状态列写「由门禁推导」，不手写状态词） |
| eslint（13 个改动文件） | PASS | 0 error；唯一 warning 是基线已有的 `IMAGE_MIME_TO_EXT` 未用 |
| QM-6 双模型评审 | 完成，1 项外部复核未能取得 | 三轮共 21 条问题全部逐条裁决（详见 §7）；两条记录 `deepReview.status` 取 `needs_revision`，未伪造外部证据 |
| QM-4 视觉回归 | N/A（未跑） | 本机基线仓库级失效（同 `result-view-back-btn-style` 结论），不重建基线；新增组件建议基线修复后统一重建 |
| 记忆三路沉淀 | PASS | ① **外部记忆（仓库文档）**：`01-docs/learnings.md` 置顶 7 条教训（append-only，CRLF 保真）；② **EverOS**（`127.0.0.1:8000`，health 200）：`POST /api/v1/memory/add` 回 `{"message_count":1,"status":"accumulated"}` → `POST /api/v1/memory/flush` 回 `{"status":"extracted"}` → **读回取落盘产物**：`~/.everos/default_app/default_project/users/lead/episodes/episode-2026-10-20.md` 的 L16 grep 到哨兵词 `s2v-result-ux-polish`。契约踩坑：`messages[]` 必填 `role`/`sender_id`/`timestamp`（epoch 毫秒整数），且 **`session_id` 是必填字段**（缺它回 422 `Field required: session_id`）；③ **内置记忆**：本会话 DSH 会话档由 harness 自动落盘，无对外写 API，未手工伪造 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导 |


7. **rebase 时按语义重打对方的方法体，把哨兵值 `''` 改成了 `null`**（CI 抓出，本轮真实回归）：
   rebase 到最新 `origin/main` 时 `ResultSegmentEditor.vue` 有冲突——main 带进了「分段编辑主体默认收起 + 展开互斥」
   三个方法，我方在同一位置新增了 `clearFilters`。我手工拼接时**按语义重打**了 main 的方法体，把收起态写成 `null`，
   而 main 的 `data()` 默认值与两处赋值用的都是空字符串。`Boolean(segmentId) && ...` 让两者运行时都能工作，
   但既有测试 `expect(w.vm.expandedSegmentId).toBe('')` 正是**状态哨兵值的契约锁**，CI `QG Desktop Shards (1/2)`
   当场判 `expected null to be ''`。
   **口径**：解决冲突必须**逐字复制**对方的方法体，不要按语义重打——重打会静默改掉「默认值 / 哨兵值 / 边界字面量」
   这类"跑得动但契约变了"的东西；且 rebase 后的本地快检必须包含**所有被改文件的既有测试**
   （本轮只跑了 ResultView 相关，漏了同目录的 `ResultSegmentEditor.test.js`）。
