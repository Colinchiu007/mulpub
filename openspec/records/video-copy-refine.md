# 执行记录：视频创作 UI 文案精修（video-copy-refine）

| 远程同步 | 由门禁推导 | 本行不手写状态词：合并后由 `scripts/lib/merge-ledger.js` 按主干历史（squash 尾注 `(#NNNN)`）推导归属。合并前写 `PASS` 会被判 `prematureClaim` 红 |

## 需求（用户原话）

1. **视频创作首页**：影视工程卡片文案
   - 旧：`影视工程：复刻《Hell Grind》——真实分镜提示词库、素材索引与剧本套用（一键复制）`
   - 新：`影视工程：——行业专业分镜提示词库、素材索引与剧本套用`
2. **视频创作-故事讲述流水线页**：顶部副标题
   - 旧：`基于 OpenMontage 流水线引擎，AI 驱动从脚本到成片的全流程`
   - 新：`全能性流水线引擎，AI 驱动从脚本到成片的全流程`
3. **视频创作-影视工程流水线页**：
   - 标签「工程案例」中的顶部标题 `Hell Grind` → `影响项目案例`（**需支持多语言**）
   - 左侧分镜库总标题 `Hell Grind` → `影响项目案例`（**需支持多语言**）
   - 标签「工程案例」文字 → 「项目案例」

## 事实定位（改前取证）

| # | 文案 | 位置 | 现状 |
|---|---|---|---|
| 1 | 影视工程卡片 | `src/locales/pipelines/{zh,en}.js:40` | locale 值（`descriptions['film-engineering']`），zh/en 成对 |
| 2 | 故事讲述页副标题 | `src/views/CreateView.vue:9` | **硬编码中文**（`--cjk` 基线第 867 行 `apps/desktop/src/views/CreateView.vue\|\|基于 OpenMontage 流水线引擎，AI 驱动从脚本到成片的全流程`） |
| 3a | 工程案例页 h1 | `src/views/FilmEngineeringView.vue:3` + `locales/film-engineering/{zh,en}.js:112` | `filmEngineering.title`（embedded 时隐藏；`/film-engineering/classic` 直达页与 embedded=false 时可见） |
| 3b | 左侧分镜库总标题 | `src/views/FilmEngineeringView.vue:34` | **数据驱动**：`status.filmMeta.title` ← `electron/film-kit/film-manifest.json:4` 的 `filmMeta.title = "Hell Grind"`；同时 `manifest.scenes[0].name = "Hell Grind"`（场景树根节点） |
| 4 | Hub 第 3 标签 | `src/views/FilmEngineeringHubView.vue:37` → `locales/film-engineering/{zh,en}.js:10` | locale 值 `hub.tabs.classic` |

## 改动方案

### A. `locales/pipelines/{zh,en}.js` — 卡片文案（成对）
- zh: `影视工程：——行业专业分镜提示词库、素材索引与剧本套用`
- en: `Film Engineering: — industry-grade shot prompt library, asset index & script adaptation`

### B. 故事讲述页副标题 — 从硬编码迁到 locale（成对 + 删除 CJK 基线条目）
新增 `create.story2video.engineSubtitle`（zh/en 成对），`CreateView.vue:9` 改为 `{{ t('create.story2video.engineSubtitle') }}`；同步删除 `locale-cjk-baseline.json` 中该条存量债务（同一 PR 内做，不另开回填 PR）。

### C. `locales/film-engineering/{zh,en}.js` — 标题与标签（成对）
- `title`：`影视工程 · 影响项目案例制作流水线` / `Film Engineering · Impact Project Case Production Pipeline`
- `hub.tabs.classic`：`项目案例` / `Project Cases`
- 同步 `hub.subtitle` 里的「工程案例」字样 → 「项目案例」（同一处语义，漏改即不一致）

### D. 分镜库总标题 — 渲染层按 i18n 显示，数据层保留事实
`FilmEngineeringView.vue:34` 的 `status.filmMeta.title` 改为 `t('filmEngineering.libraryTitle')`（新增 locale 键，zh/en 成对）。
数据层（`film-manifest.json`）**不改**：它是随包资产的客观描述（原始项目名/来源链接/角色名都来自该文件），且被 `kit-loader.js:47` 校验为非空字符串、被 `film-engineering-service.test.js:55` 与 `kit-loader.test.js:78` 断言为 `'Hell Grind'`；改数据会破坏「真实分镜库」的产品事实（`source.projectUrl` 仍指向原项目）。

### E. 场景树根节点 `manifest.scenes[0].name = "Hell Grind"`
该值随 kit 数据渲染（`shot-library.js:129` 原样透传），**不在本次改动范围**——用户只说「左侧分镜库中的总标题」，即 `fe-meta-title`。根节点名属于语料自身分类，与「总标题」不是同一处。

## 不做的事（明确排除）

- 不改 `film-manifest.json`（随包数据资产，客观事实 + 有测试断言）
- 不改 `backlot.js` 的 `OpenMontage` 注释（代码注释非用户可见文案，且该 store 名属工程标识）
- 不改 `useFilmEngineering.js` / `FilmEngineeringView.vue:462` 等**注释**里的「工程案例」字样（注释非用户可见；`route-registry.js:311/320` 同）——但测试文件名/describe 文案同步更新以保持可读性

## 测试（TDD：先红后绿）

新增 `src/views/video-copy-refine.test.js`（11 例）：
- ① `pipelines.descriptions['film-engineering']` zh/en 成对且等于目标文案，且**不含** `Hell Grind`
- ② `create.story2video.engineSubtitle` zh/en 成对，`CreateView.vue` 模板引用该 key（源码断言，防回退硬编码）
- ③ `filmEngineering.title` / `libraryTitle` zh/en 成对且等于目标文案
- ④ `locale-cjk-baseline.json` 不含已迁走的硬编码条目（防基线把已治理债务又记回来）
- ⑤ `FilmEngineeringView.vue` 渲染 `libraryTitle`（源码断言）
- ⑥ Hub 第 3 标签 DOM 级渲染「项目案例」且页面无旧片名/旧标签名
- ⑦ `hub.subtitle` zh/en 同步改写

补充 `src/views/FilmEngineeringView.test.js`（1 例）：kit 可用（`filmMeta.title='Hell Grind'`）时 `.fe-meta-title` 渲染「影响项目案例」。

## 验证证据（2026-10-19）

| 项 | 命令 | 结果 |
|---|---|---|
| 新测试 | `vitest run src/views/video-copy-refine.test.js` | 11/11 ✅ |
| 回归（30 个文件） | `vitest run src/views/FilmEngineering* src/views/FilmCanvas* src/views/CreateView.test.js src/views/video-creation src/components/PipelineBrowser.test.js src/composables/useFilm* src/locales src/i18n` | 576/576 ✅ |
| CJK 门禁 | `node .github/scripts/check-locale-sync.js --cjk` | PASS（基线 1330 → 1330，本次-1，当前 1147 命中） |
| key 门禁 | `--keys` | PASS（2153 key 均存在于 zh/en） |
| 成对门禁 | `--pair-base 470bf8b05` | PASS |
| eslint | 改动 10 个文件 | exit 0 |
| 视觉（像素，CI 口径 6%） | `PIXEL_THRESHOLD=0.06 run-pixel-tests.js` | 20/20 ✅ |
| 视觉（目视） | `film-engineering-classic.png` 截图 | 标题/副标题均为新文案 ✅ |

## 视觉基线：两轮 CI 红的处置与最终收敛

### 第一轮：`QG Changes` 红（非视觉）

`Detect docs-only changes` 步内的 `check-gate-record-debt.js` 判红：本记录整块缺 `远程同步` 行。
按 change `gate-record-sync-derived-status` 的新形态补「由门禁推导」行（不手写状态词，写 `PASS`
反而会被判 `prematureClaim`）后转绿。

### 第二轮：`QG Visual` 红在 `Gate 7b - Baseline freshness`

该判据是 **0 px 严格**（比 6% 像素阈值严格得多），点名 4 个视图各含深浅两档：
`create-editor` / `create-history` / `create-pipeline` / `create-story2video-detail`。
同 job 的 Gate 7（像素）与 Gate 7c（暗色对比度）均 success（20/20）。

**根因是本次文案改动的预期像素漂移**。三张 diff 图逐张人工审核：高亮区域**只命中顶部副标题行
与影视工程卡片描述两处**，页面其余部分零差异（`create-history` 是 `/create` 的 query 变体，
同一组件同一副标题）。漂移 0.103%–0.437%。

### 曾按 QM-4 第 7 条用 CI artifact 重建基线（后撤）

做法参照同型先例 `batch-teleport-fix`（亦用 CI artifact 重建基线并人工审核 diff 图）：
**不用本地渲染** —— 本地与 CI 渲染存在系统性差异（实测：本地另报 accounts-list / cloud-publish /
publish-form / publish-history / viral-analysis / create-result / accounts-list-flag-on / home-baseline
共 8 个视图 stale，而用同一 PR 的 CI artifact 渲染做同源判据时这些**全部干净**）。照本地渲染
更新基线等于把环境偏差写进仓库。故从 CI run 的 `quality-gate-visual-reports` artifact 取权威渲染
逐文件覆盖。验证：以该 artifact 为输入复跑 `check-baseline-freshness.js --partial` ⇒ 全等、exit 0。

一个坑记在这里：artifact 里浅色 pixel-gate 档只在 `screenshots-round1/` 下 —— Gate 7b round2 开头
会把 `screenshots` mv 成 `screenshots-round1` 再重建，round2 只跑深色套件。只扫 `screenshots/`
会漏判浅色档（第一轮就是这样漏了 `create-story2video-detail.png`）。

### 最终收敛：本 PR **不携带任何基线改动**

撤出基线改动的原因不是"做不动"，而是**改不出来**：PR 期间 main 连续三次改动同一批 `create*` 页面
（`74dd83ede` 移除详情页/结果页返回按钮、`03733b558` 移除页头 ←/→ 导航箭头整组），每次 rebase 都让
刚重建的基线再次过期 —— 判据的权威来源是 main 的 UI 事实，而 main 仍在快速变化。

最终 rebase 到 `origin/main` 后，`base-screenshots/` 目录与 main **逐字节一致**（`git diff` 为空）。
视觉基线由合并后的 main push CI 以最新 UI 事实裁决，不在本 PR 范围内伪造。

**如实登记而非伪装闭合**：若合并后 main push 的 Gate 7b 报这些视图 stale，那是预期的
（main 的 UI 已变 + 本次文案改动），需一次以 main push CI artifact 为源的基线重建 —— 单独一件事。
| 视觉（像素） | `run-pixel-tests.js`（TEST_URL 指向本 worktree dev server :5199） | 19/20；唯一失败 `collection` 1.44%，**A/B 证实为既有基线偏差**（stash 掉本次改动后同值复现） |
| 视觉（目视） | `film-engineering-classic.png` 截图 | 标题/副标题均为新文案 ✅ |

### 视觉 A/B 取证（防把既有偏差当本次回归）

```
# 含本次改动
collection FAILED misMatchPercentage=1.44% (threshold=1%)

# stash 掉本次改动后重跑（A/B）
collection FAILED misMatchPercentage=1.44% (threshold=1%)
```
两次同值 ⇒ 与本次改动无因果关系。`create-editor`（/create，本次副标题改动页）两次均 PASSED。

## 已知遗留（明确不夸大完成度）

- `adapt.roleMapHint` / `adapt.roleKeyPlaceholder` / `hub.hints.classic` 等**既有文案**仍提到原始项目名与角色名（ROKO/JAXX/LULU/REIN）。
  这些是 kit 数据的客观事实（角色名即该片角色），用户本次只要求改「标题/标签/总标题」，故未动；
  已在测试注释里写明不断言整页文本的原因，避免后人误加宽断言后误判「未改干净」。
- `film-manifest.json` 的 `filmMeta.title` 与 `scenes[0].name` 仍为 `Hell Grind`（数据层，见上「不做的事」）。

