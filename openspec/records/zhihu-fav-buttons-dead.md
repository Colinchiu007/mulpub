---
record: zhihu-fav-buttons-dead
task: 修复采集页「知乎收藏文章」的「采集」「改写」按钮点击无反应（恒灰死键：判据依赖一个永不初始化的选中态 + 改写误共用采集判据 + 全部收藏模式死锁 + handler 静默返回）
date: 2026-10-16
branch: zhihu-fav-buttons-dead
sync_status: PENDING
sync_reason: PR 尚未合并（记录随代码 PR 落地，合并后回填 merge SHA）
sync_backfill_owner: zhihu-fav-buttons-dead 会话（回填 PR）
---

## 本次执行记录：知乎收藏「采集/改写」按钮点击无反应（zhihu-fav-buttons-dead，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（`apps/desktop/src/**`）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-zhihu-fav-buttons-dead`，裸分支 `zhihu-fav-buttons-dead`，基线 `origin/main`=`670c2e7f1`。入口：PowerShell 原生 `git worktree add -b zhihu-fav-buttons-dead <绝对路径> origin/main`（不触碰共享根 index/工作树）；`pre-code-edit-guard.ps1` rc=0 放行；`git worktree list` + `rev-parse --abbrev-ref HEAD` 实证落盘 |
| 行尾对账 | PASS | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐文件一致（5 个改动文件：PRD 76/1、组件 64/10、测试 127/0、locales en 5/0、zh 5/0） |
| 依赖就绪 | PASS | `pnpm install --frozen-lockfile` rc=0（1407 包）→ `ensure-electron.js` v43.7.7 就绪 → `verify-worktree-deps.js` OK（11 项解析、9 个 workspace 全指向本 worktree） |
| TDD（RED→GREEN） | PASS | 先写 7 条回归锁 ⇒ **RED 7 failed / 24**（`data-testid` 与 computed 均不存在）；实现后 **GREEN 24/24**。用例见 `batch-collect-panel-behavior.test.js` 新增 describe「知乎整夹直采按钮可点性」 |
| 变异反证 | PASS | 5/5 CAUGHT（基线绿 + 每个变异被指名用例擒获）：M1 采集判据退回、M2 改写判据退回、M3 去掉自动选中、M4 handler 退回静默 return、M5 all 模式退回走 contents |
| 门禁（CCG） | PASS | pre-commit `ccg-gate.js` verify-change/security/quality 三项通过；`eslint src/ electron/ --quiet` rc=0 |
| QM-1 打包与启动 | PASS | `pnpm run build:dir` rc=0（vite built in 42.18s + electron-builder 25.1.8）；启动三层判据**第③层通过**（8s 窗口内仍存活 pid=12528、**stderr 长度 0**、stdout 21733 字节）；`ELECTRON_RUN_AS_NODE` 显式剔除并出声告警 |
| QM-1 产物内容 | PASS | asar 内 `\dist\index.html` 在场；解包产物命中本次新增标识 4/5（`pickFavlistFirst` 2、`rewriteNeedsSource` 2、`zhihu-favlist-target-hint` 1、`zhihu-favlist-collect` 1；`zhihuFavTargetReady` 0 处属 Vite minify 改名，预期） |
| QM-2 代码必检项 | PASS | ① 无新增同步阻塞原语（改动全在渲染端 computed/模板，无 KDF/大 hash）；② 无新增全局 component/顶层 CSS import；③ 无新增 `require` 路径；④ 未改 preload；⑤ 无 `v-html` 新增；⑥ 渲染端无新增中文字面量（`locale-sync --cjk` PASS：基线 1374、当前 1223、无新增） |
| locale 成对 | PASS | `check-locale-sync.js --keys` PASS（2067 个使用中 key 均存在于 zh/en）；新增 2 个 key 在 `locales/collection/{zh,en}.js` 成对落盘 |
| QM-4 视觉回归 | PASS | `TEST_URL=http://127.0.0.1:5199 PIXEL_ONLY=collection pnpm run test:visual:pixel` ⇒ **1/1 通过、0 失败、100%**（报告 `tests/visual-testing/reports/report-1792158014160.json`）。使用本 worktree 自起的独立 Vite（5199，`--strictPort`，HTTP 200 实证），不借用他人端口。**未刷新基线**（新增提示行是条件渲染，采集页默认态不渲染 ⇒ 像素不变，0.000% 差异本身即为证据） |
| QM-6 双模型评审 | PASS | 211 行 > 200 阈值 ⇒ 按 §12.6 走跨家族双模型（proposer=opencode 1.18.34 / critic=claude 2.1.296；跨家族校验「通过」）。轮 1 出 **8 条**（Critical 2 / Warning 3 / Info 3），维度分 correctness 6 / security 4 / performance 8 / maintainability 4 ⇒ 引擎进自扮演裁决。我逐条填最强指控 / 最强辩护 / 可验证理由，**5/5 dismissed、0 upheld**，无高危域需外部复核 ⇒ `deepReview.status=self_play_resolved`。**采纳其中 2 条合理内核**：新增 `zhihuFavScope` 默认值结构锁（25/25 通过）、在组件注释里声明 `data-testid` 为测试契约。裁决全文 `.adversarial/ccg-deep-2908d422/adjudication.json`（该目录由 `.gitignore:387` 忽略，不进版本库） |
| 相关测试全集 | PASS | `vitest run src/features/collection/ src/views/Collection` ⇒ **15 文件 / 283 用例全绿**（含父级 `Collection.vue` 契约测试） |
| 文档同步 | PASS | 新增 `01-docs/BUGFIX-ZHIHU-FAV-BUTTONS-DEAD-2026-10-16.md`（报障/复现/根因/逃逸分析/修复/验收/变异/预防/未闭合）；订正 `PRD-ZHIHU-FAV-BATCH-2026-10-03.md` 补 §4.1 可用性契约（原版只写「按钮保留」） |
| 远程同步 | PENDING | PR 未开。合并后**同一次提交**改写为 `PASS` + merge SHA 并删除 frontmatter `sync_*` 三字段 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅（两口径一致，5 文件）| 品牌残留 随 CI | 文档同步 ✅ | 执行记录 ✅ | 远程同步 PENDING

### 根因（第一性原因，`git log -S` 溯源）

引入提交 **`b6052e5c9`**（PR #3409「采集页 UI/UE 精致化」）—— **不是** `abec241c2`（#3656 知乎凭据设置化）。如实登记：报障时间紧邻 #3656 合并，易被误判成那次改造的回归。

四个事实叠加：

1. `zhihuSelectedFavlist` 是 `ref('')`，**全仓没有任何代码给它赋初值**；
2. 下拉框渲染在 `v-if="zhihuFavlists.length"` 内 ⇒ 未拉清单时用户看不到下拉框、无从选择；
3. 两个按钮**不在**该 `v-if` 内（无条件的 `zb-row`）⇒ 一直可见；
4. `disabled` 的 `<button>` **不派发 click** ⇒ 点击零事件、零提示。

⇒ 「看起来随时能点的按钮」× 「代码永不建立的选中态」= **恒灰死键**。

### 缺陷清单（一处报障，五个独立缺陷）

| # | 缺陷 | 用户可见后果 |
|---|---|---|
| D1 | 「采集」判据 `!zhihuSelectedFavlist`，该 ref 从不自动初始化 | 恒灰、零反应 |
| D2 | 「改写」**根本不需要**收藏夹选择，却共用同一判据 | 恒灰、零反应 |
| D3 | `scope='all'` 时下拉框被禁用 ⇒ 永远无法满足判据 | 「全部收藏」模式死锁 |
| D4 | handler `if (!zhihuSelectedFavlist.value) return` **静默** | 即使被调用也无反馈 |
| D5 | 老「整夹直采」只走 `contents`，「全部收藏」未走 `unified-contents`（`loadZhihuFavItems` 已走） | 两入口语义漂移 |

### 逃逸分析（逐层）

| 层 | 为什么没拦住 |
|---|---|
| 组件行为锁 | 旧用例 `w.vm.zhihuSelectedFavlist = '111'` **手动塞值后直接调方法** —— 既跳过「该值从何而来」，也跳过「按钮能不能点」 |
| 集成（IPC） | handler 测试传的是已解析参数，不经过 UI 可用性判定 |
| E2E | 知乎收藏依赖真实平台接口，未覆盖该分支 |
| 视觉回归 | 像素门禁只看「渲染是否一致」，**看不到「disabled 是否合理」**（灰按钮与设计稿一致，像素全绿） |
| 代码评审 | 每行单独看都对，缺的是**契约完备性**：「谁负责建立那个选中态」 |

**系统性漏洞定位**：测试场景缺失 + 测试层级错位，根因在**文档层** —— PRD 原版 §4 只写「旧入口兼容：按钮保留」，**未定义可用性判据与不可用时的可见原因**。契约缺失 ⇒ 实现自由发挥 ⇒ 测试照抄实现 ⇒ 死键全程逃逸。

### 修复要点

- 新增单一真源 computed：`zhihuFavTargetReady`（`scope==='all' || 已选夹`）、`zhihuFavRewriteSource`、`zhihuFavRewriteReady`（只看来源）
- `loadZhihuFavlists` 成功后**自动选中第一项**（真实选择态由代码建立，不靠 `<select>` 默认渲染暗示）
- `zhihuFavlistBatchCollect`：判据换 `zhihuFavTargetReady`；无目标**出声**；按 `scope` 分流 `unified-contents`/`contents`（与 `loadZhihuFavItems` 同语义）
- `zhihuFavlistBatchRewrite`：来源改用 `zhihuFavRewriteSource`（消除双真源）
- 两条**独立的**不可点原因提示（`data-testid="zhihu-favlist-target-hint"` / `zhihu-favlist-rewrite-hint`）+ 2 个 locale key（zh/en 成对）
- **顺带修复既有契约缺失**：`defineEmits` 补 `'collected-rewrites'`（父级 `Collection.vue:144` 一直在监听，原先靠 fallthrough 侥幸可用；声明后组件测试的 `[Vue warn]` 消失），并加锁断言 `w.emitted('collected-rewrites')` 可观察

### 变异反证（5/5 CAUGHT）

| 变异 | 内容 | 结果 |
|---|---|---|
| M1 | 「采集」判据退回 `!zhihuSelectedFavlist` | CAUGHT（由 A3「scope=全部收藏」用例擒获） |
| M2 | 「改写」判据退回 `!zhihuSelectedFavlist` | CAUGHT（A6） |
| M3 | 去掉自动选中第一项 | CAUGHT（A2） |
| M4 | handler 退回静默 return | CAUGHT（A5） |
| M5 | all 模式退回走 contents | CAUGHT（A4） |

**变异驱动自身踩的三个判据坑（一并记录）**：① 工作区是 **CRLF**，LF 锚点静默 `ANCHOR_MISS`；② `execFileSync(..., {shell:true})` 会把**含空格的用例名**拆成多个参数 ⇒ 该用例"没跑"（伪 `NOT_RUN`）；③ **A1 用例对 M1 无判别力**——「未加载清单」状态下两个判据取值等价（都 disabled），故 M1 的判别用例必须选 A3。把 A1 当 M1 的证据会写出假结论。

### QM-1 取证过程中的一次假绿拦截（如实登记）

首轮只跑 `pnpm exec electron-builder --win --dir`（**漏了 `build:vue`**）⇒ asar 内没有 `dist/index.html` ⇒ 启动时 stderr 报 `ERR_FILE_NOT_FOUND`。**进程是存活的**：若判据只看「存活 + 黑名单」，这次会被误判为通过。三层判据的**层②（stderr 非空即 NEEDS_REVIEW）**把它拦下。重跑 `pnpm run build:dir`（= `build:vue` + electron-builder）后层③通过。

### 遗留（不假装闭合）

1. **未做真机点击验证**：需要你在真实应用里点一次「获取收藏夹 → 采集 → 改写」确认端到端可用。
2. **两条入口仍并存**（「旧整夹直采」与「采集并改写」）：本次只修好前者，未做入口收敛（涉用户习惯与任务互斥码，需单独评审）。
3. **`scope='all'` 下「采集」会先拉全量清单再采**，比「采集并改写」多一次清单请求（功能正确，登记为可选优化）。
4. **构建产物 stat-dirty 现象**（仓库既有，非本次引入）：`build:vue` 会重写 5 个受管 bundle（`preload/index.bundle.js`、`home-shell-preload.bundle.js`、`monitor-preload.bundle.js`、`card-paginator.iife.js`、`stealth-preload-enhanced.bundle.js`），使 `git status` 变脏而 `git diff` 内容为空（`core.autocrlf` 归一后无差异）。本次按 R2 精确还原这 5 个文件，保持 PR 只含真实改动。
