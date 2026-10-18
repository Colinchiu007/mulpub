---
record: story-text-limit-control
task: 故事讲述文案上限 6000→10000；运营中心新增「字数控制」页 + 跨端签名下发块 storyTextLimit（含顺手修掉的 Vue 模板渲染存量缺陷）
date: 2026-10-18
# 远程同步不需要事后回填：收口由门禁按主干历史推导（change: gate-record-sync-derived-status）。
---

## 本次执行记录：故事讲述文案上限 6000→10000 + 运营中心「字数控制」+ 签名下发块 storyTextLimit（story-text-limit-control，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR（运行时代码 + 文档） | 运行时代码：隔离 worktree `D:\Data\projects\mp-worktrees\mp-story-text-limit-control`（**D 盘，非 C 盘**）+ 裸分支 `story-text-limit-control`；共享根全程停留在 `main` 且未落任何改动。改动集 32 文件（21 桌面端 / 9 运营端后端 / 10 运营端前端 / 4 文档与门禁数据）。隔离入口用 `scripts/start-mp-task.ps1 -TaskName story-text-limit-control`，该入口要求共享根 tracked-clean —— 实测唯一"脏"项是 `.ccg/reviews/c081…json` 的 CRLF/stat 缓存（三个 blob 哈希全等、`git diff` 为空），`git add` 那个文件以等同 blob 清标志后才通过，**未 stash、未 reset、未覆盖他人改动** |
| 第一性原因（QM-5 ①） | ✅ | 两层：① **产品层**——「6000」是故事讲述页首次落地时按当时参考产品取的经验值，从来没有产品依据，也**没有任何运营可调通道**，于是每次调值都要发版；② **缺陷层（本轮意外挖出）**——`CreateView.vue` 模板 `{{ story2videoTextCharacterCount }}/{{ MAX_STORY2VIDEO_TEXT_CHARACTERS }} 字符` 里的常量只是模块级 `import`，不在 Vue 实例的 render proxy 上（Vue 3 只解析 `data`/`computed`/`methods`/`props`/`$setup` + `allowedGlobals`）⇒ **用户长期看到的计数行是 `1234/ 字符`、批量占位符是 `每条最多 undefined 字`**。`git show HEAD:apps/desktop/src/views/CreateView.vue` 实测该文件 `data`/`computed`/`methods` 里**不存在**同名项，故渲染为 `undefined` 可判定 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：`notifications.test.js` 只断言常量的值（`toBe(6000)`）与计数函数，**从没断言过模板渲染出来的那行文本**；组件层：`CreateView.test.js` 断言的是 `story2videoTextCountLevel` 等 JS 侧状态，不是 DOM 文本；审查层：`{{ CONSTANT }}` 与 `{{ computed }}` 在模板里同形，肉眼不可分；工具层：ESLint 无 `vue/no-undef-properties` 类规则，`tsc` 不检查模板表达式。四层全漏 ⇒ 这条缺陷可以活任意久 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `apps/desktop/src/story2video/story-text-limit.js`（解析单一真源，**14 例**锁 null/缺键/字符串数字/浮点/负数/越界/闭区间端点/两形态入参）；`CreateView.vue` 模板改 `{{ story2videoTextMaxChars }}` 并**删除同名 computed 别名**（同名会误导读者以为它是常量）；`CreateView.test.js` 新增 describe「文案字数上限（运营中心运行时下发）」**5 条**（默认 10000 / 下发 12000 全链路 / 非法回落 / 预警档位 / 读取失败静默）；`notification-error-patterns.test.js` **5 例**锁 `TEXT_TOO_LONG_PATTERN` 6000 与 10000 两档同时命中（原正则把上限写死，改值后会**静默失配**） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 默认值不再是裸字面量：`MAX_STORY2VIDEO_TEXT_CHARACTERS` 由 `DEFAULT_STORY2VIDEO_TEXT_LIMIT.maxChars` 派生，改值只有一处；② 主进程同名字面量被 grep 出并接线（见下"系统性收获"）；③ 两端 `RUNTIME_BLOCKS` 数量断言（服务端 pytest 14 / 客户端 vitest 14）互为锁，注释写明「必须成对改」；④ `PRD-S2V-PIPELINE-PAGE-UX.md` §11.5 第 4 条原文写着「`textarea` 设 `maxlength`」「计数为实时 `length`」——**两处都与代码不符**（实际无 `maxlength`，且计数是 Unicode 码点），本轮一并纠正并写清为什么不能改；⑤ 写入 `01-docs/learnings.md` 9 条 + 外部记忆 9 条 + EverOS 2 篇知识 |
| 系统性收获（本轮 grep 出来的第二处硬上限） | ✅ | 渲染端之外，主进程 `story2video-text-config.js` 还有 `MAX_STORY2VIDEO_TEXT_UNICODE_CHARS = 6000`，被 `story2video-batch-queue.js` 批量校验消费；只改渲染端会「前端放行 10000、主进程批量队列仍按 6000 拒绝」，**且两侧单测都绿**。已接线为 provider（`setStoryTextLimitProvider` ← `phase1-context.js` ← `opsCenterSync.getRuntimeState().storyTextLimit`），未接线/抛错/非法一律回落 10000（3 条单测） |
| 跨端签名契约一致性 | ✅ | 新块 `storyTextLimit`（`object-or-null`），形状 `{story2video:{maxChars,warnPercent}}`，**只允许整数**。两端白名单同步 13→14：服务端 `config_fingerprint.py`、客户端 `ops-runtime-snapshot.js`。`config_hash` 固定向量**用 Python 与 Node 各独立算一遍并逐字对齐**：`{}`=f559cffbd7fc2bcf、`{announcements:[]}`=301dd86b76646d9f、`{announcements:[{title:"公告"}]}`=b0d4bb463f2b9776。随包种子 `runtime-bootstrap.json` 补 `storyTextLimit:null` 并重算 `_meta.config_hash`=**57bb9a2bbaf30a87**（`computeConfigHash` 实算 + `validateSeedPayload` 零 errors/warnings ✅） |
| `publish.content` 耦合陷阱 | ✅ 已修 | `publish.content` 默认 fallback 就是脚本正文，字段级 `textValue()` 上限 20000 且**超限即 throw**。运营把 `maxChars` 配到 >20000 时，脚本先过字数闸再被 `publish.content 超过 20000` 拦 ⇒「配置合法、启动失败」。处置：该字段闸取 `Math.max(20000, textLimit)`——默认 10000 时仍是 20000（**与改动前逐字节一致，不松绑发布描述**），仅当运营显式调过 20000 才跟随。2 条测试锁定两个方向 |
| TDD / 测试实测 | ✅ | 桌面端：受影响面 **340 passed / 10 files**（story2video 全目录 + ops-runtime-snapshot 48 + ops-center-sync + story2video-text-config 85 + batch-queue）；`CreateView.test.js` 全量 **305 passed**（99s）；扩展主进程面 **178 passed / 5 files**；`node --test .github/scripts/check-ops-seed.test.js` **17/17**。运营端后端：`python -m pytest -q` **672 passed / 0 failed**（6:16，全量，无既有失败）。运营端前端：`npm test` **161 passed / 16 files**；`npm run build` rc=0（`StoryTextLimit` chunk 10.69 kB 独立分离）。ESLint 改动文件 0 error；CI 用 `tsc --noEmit` 0 输出（`check:ts` 存量基线 1887 条，本次新增行命中 **0**） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **两口径逐行相同**（全部 LF、无裸 CR）；无删除文件（D=0，故无需删除数归因） |
| 接线棘轮 | ✅ | 新增 3 个 `*.test.js`（`story-text-limit.test.js` / `notification-error-patterns.test.js` / 运营端 `storyTextLimitWiring.test.js`）均已被既有 vitest 目录扫描覆盖；`node scripts/check-unwired-tests.js` → `OK: 全部测试均已接线或按欠账登记`（检查域 100 个） |
| QM-1 打包 | ✅ | `pnpm run build:dir`（= `build:vue` + `electron-builder --dir`）**rc=0**；asar 产物 **153,614,986 B**，清单含 `electron/services/story2video-text-config.js`、`ops-runtime-snapshot.js`、`ops-center-sync.js`、`resources/ops-seed/runtime-bootstrap.json`；渲染端 bundle `dist/assets/CreateView-Dw4mRgL4.js` 命中 `story2videoTextMaxChars`/`storyTextLimit` 共 12 处。**启动验证（三层判据 + 存活断言）**：`alive after 9000ms = true`、`stderr 0 字节`、`stdout 8077 字节`、红线命中 `[]` ⇒ **PASS**；父环境带 `ELECTRON_RUN_AS_NODE=1`，已用 `scripts/lib/qm1-child-env.js::buildChildEnv()` 显式剔除并由 `envDefectNotice()` **出声告警**（未静默） |
| QM-4 视觉 | ✅ 已重捕 2 张基线 | 桌面端未新增视觉组件，但**确实改变了可见渲染**：计数行由 `1234/ 字符`（旧代码渲染成 `undefined`）变为 `1234/10000 字符`。CI `QG Visual` 的 **Gate 7b 基线新鲜度**（0 px 不变量）判红 2 张：`create-story2video-detail.png` 差 **121 px / 0.006%**、`create-story2video-detail-dark.png` 差 **136 px / 0.007%**（round-1 报告实测；round-2 复采后仅暗色仍存在，属确定性差异而非 flake）。**未用本机 `--update-baseline`**（QM-4 第 7 条禁止：本机渲染与 CI 渲染不是同一张图）——改为从该 run 的 `quality-gate-visual-reports` 工件取**同 run CI 渲染**（`tests/visual-testing/screenshots-round1/create-story2video-detail-current.png` 92875 B / `…-dark-current.png` 97827 B）直接提升为基线；本机复跑 `check-baseline-freshness.js --renders=<工件目录> --partial` ⇒ **违规 0 / 检查 43**。运营端新增页面沿用既有 `el-card`/`el-table` 版式，无新主题色/新字号 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记为未执行，**不以自审冒充通过**。已用可机械复核的替代证据：两端 `config_hash` 独立双实现交叉核对、跨语言契约干跑（前端 `toSavePayload` 产物直接喂后端 `_validate_*`）、变异式反证（`camelCase` 必 400、`超过 6000` 正则失配） |
| locale 成对 | ✅ | 本轮**未新增 locale 键**（只把既有键里的数字换成生效值）；`check-locale-sync --keys` PASS（2107 key 齐备）；`--cjk` 唯一变化是计数行表达式改名（内容级替换，非行号漂移），`--update-baseline` 后基线 1331 条、`diff` 仅 `CreateView.vue` 一条 `+/-`，复跑 **PASS** |
| 文档门禁 | ✅ | `check-no-brand-residue.js` PASS（10071 tracked）；`check-doc-abs-paths.js` PASS（3947 受管文件，无新增本机绝对路径）；`check-max-lines.js` ✅ 无新增超大文件、挂账一致（95 超限全在挂账、墓碑 5、点名还账 20） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史（squash 尾注 `(#NNNN)`）推导归属；合并前本文件不在基线上，判 byDesign 不红。状态列**不得**预写成 `PASS`（会判「预写不存在的证据」） |

### 遗留（不假装已闭合）

1. **`appMenu` / `contentCategories` 块自带 `synced_at`，等于每请求都把 `config_hash` 变一次（既有缺陷，未修）**：
   `app_menu_service.py:306` 返回 `{"items": [...], "synced_at": _now()}`、`content_category_service.py:343` 返回
   `{"items": [...], "count": n, "synced_at": _now()}`，两块**都在** `RUNTIME_BLOCKS` 里。实测同库连跑两次
   bootstrap：`f8a5b99df879ac71/ver1` → `dd3dfca7ccd2e587/ver2`，`RuntimeConfigVersion` 落两行
   ⇒ 「生效看板」永远确认不了、版本表无限增长。这与 `config_fingerprint.py` 注释第 1 条
   「`synced_at` 每次请求都变，纳入则 hash 永远变、变推送地狱」**直接自相矛盾**（注释写对了、实现对不上）。
   **修它要改这两个块对桌面端的消费形状（跨端破坏性变更），超出本任务契约，只登记不修。**
   本轮新增的 `storyTextLimit` 块只含整数，不加剧该问题。
2. **`ops-center-sync.js` 行数已顶格**：770 行 = 挂账 570 + 容差 200 用满；本次靠「新增字段合并进既有行」
   保持**零行增长**，但下一处任何 +1 行都会 `LEDGER_GREW`，需先拆分文件。
3. **`story2video-notifications.js` 494/500 行**，余量 6 行。
4. **「字数控制」目前只有一个 scope（`story2video`）**：表结构与下发块都按 scope 字典设计（可扩展），
   但尚未有第二个消费者；`enabled=false` 时整键不下发、桌面端回落内置默认。
5. **`reset` 不清空 `note`**：视为运营备注而非配置值；若产品认为「恢复默认」应连备注一起清，改一行即可。
6. **生效时机受既有同步模型限制**：桌面端只在启动时同步一次（`setTimeout 3000`，无 `setInterval`、
   渲染端无手动同步入口），因此运营改完必须重启客户端才生效；页面文案已如实说明，未改动同步机制。

## 关联

- 需求文档：`01-docs/PRD-STORY-TEXT-LIMIT-CONTROL-2026-10-18.md`（现状核查表 / 契约三不可破 / 字段校验表 /
  三段流程 / 逐条功能逻辑 / 交互 / 显示项 / 提示文字 / 13 条边界 / 迁移 / 非功能 / 10 条验收 / 测试矩阵 / 风险）
- 同步修订：`01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §11.5 第 4 条（6000→10000、可配、纠正 `maxlength` 与 `length` 两处不实描述）
- 经验沉淀：`01-docs/learnings.md`（9 条）、`~/.gstack/projects/multi-publish/learnings.jsonl`（9 条）、
  EverOS（`everos/data/knowledge/make-product-param-ops-configurable-cost-is-contract/`、
  `everos/data/knowledge/silent-correction-and-phantom-manual-sync/`，并经 `/api/v1/memory/add` + `/flush` 抽取为 episode）
- 相邻机制参考：`ops-center/backend/services/app_menu_service.py`（目录供给 + 写严读宽）、
  `apps/desktop/electron/services/ops-runtime-snapshot.js`（`config_hash` 与三层降级）、
  `ops-center/frontend/src/constants/runtime-delivery.js`（重启生效提示单一真源）
