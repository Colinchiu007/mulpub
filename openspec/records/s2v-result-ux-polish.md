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

## 7. QM-6 评审

见 PR 说明与 `.ccg/reviews/*.json`（以实际评审结论为准）。

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
