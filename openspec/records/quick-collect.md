---
record: quick-collect
task: 采集页「快捷采集」——内置 6 条官方指令 + 自定义指令增删改 + 检索/汇总执行链
date: 2026-10-11
---

## 本次执行记录：采集页「快捷采集」（quick-collect，2026-10-11）

> 分支：`quick-collect`（隔离 worktree `D:\Data\projects\mp-worktrees\mp-quick-collect`，**非 C 盘**）；共享根 `D:\Data\projects\mulpub` 保持 `main`。
> 范围：🛠 运行时代码变更（主进程 5 个新模块 + IPC/preload + 渲染端 6 个新文件 + Collection.vue 接线）+ 📝 文档
> ⇒ 完整质量节拍；`classify-docs-only.js` 判 `false`（混合 PR，重型 job 不短路）。
> 上游依据：`01-docs/PRD-QUICK-COLLECT-2026-10-11.md` → `openspec/changes/quick-collect/{proposal,design,specs,tasks}.md`。

| 门禁 | 状态 | Fresh 证据 |
| ---- | ---- | ---------- |
| 变更类型与隔离 | PASS | `git rev-parse --abbrev-ref HEAD` = `quick-collect`；worktree 非 C 盘；`node scripts/verify-worktree-deps.js` OK（11 项消费方解析到当前 worktree） |
| 方案与规格先行 | PASS | 先落 PRD（含数据校验三层、流程、交互、显示项、提示文字、验收标准 12 条）再落代码；change 的 proposal/design/specs（6 个 Requirement）/tasks 与本实现逐条对账 |
| TDD | PASS | 本增量 11 个测试文件 **234 passed / 0 failed**：引擎 18、指令校验 15、素材 9、提示词 7、内置目录 5、IPC handler 9、前端纯逻辑 25、composable 7、面板 10、弹窗 9、Collection 集成 3。先写测试后补实现（首轮 9 红 → 逐条修到 0 红） |
| 跨平面防漂移锁 | PASS | `quick-collect-commands.test.js` 直接 import 主进程 CJS 模块，逐项比对 `WINDOW_HOURS`/`ALLOWED_SOURCES`/`LIMITS`/关键词拆分/窗口解析/查重/关键词去重 —— 任一侧改边界即红（首轮就抓到 `LIMITS.QUERY_KEYWORDS_MAX` 漏声明） |
| 变异反证（6 条，取失败用例全名） | PASS（已实测变红） | M1a 缺时间戳守卫 no-op ⇒ 仅「窗口开启时：窗口内通过、窗口外丢弃、缺时间戳丢弃、未来时间戳丢弃」红；M1b 窗口外丢弃 no-op ⇒ 3 红（素材 2 + 引擎 AC-9）；M2 `safeHttpUrl` 判据换成直通 ⇒ 4 红（含引擎 AC-8「非法 url 素材被丢弃」）；M3a skipped 声明行 no-op ⇒ 2 红；M3b empty 声明行 no-op ⇒ 2 红；M4 内置指令只读守卫 no-op ⇒ 仅「内置指令不可编辑/删除」红。每条红后**已回滚并复跑绿**（234 passed 复验） |
| 不编造约束 | PASS | 提示词 system 三条硬约束 + 引擎在 `retrieval=empty/skipped` 时插入声明行（模型已自述则不重复）；单测逐条断言（`quick-collect-prompt.test.js` + 引擎两条） |
| 静态门禁 | PASS | `check-ipc-bridge` 453 handlers / 471 preload / 0 已知缺口；`check-ipc-sender-guard` 487 注册点、显式守卫占比 65.7%（≥65%）、0 绕过；`check-locale-sync --pair-base` PASS / `--cjk` PASS（基线 1489、当前 1270、无新增硬编码）/ `--keys` PASS（1805 key 均存在）；`check-max-lines` PASS（`Collection.vue` 2909 ≤ targets 2920 **零容差**）；`check-frontend-consistency` PASS（rendererIpcDirect 0 / windowConfirm 0）；`check-no-brand-residue` PASS（7912 tracked 文件）；ESLint error 级：新增/触碰文件全部 0 error |
| i18n 成对 | PASS | `locales/collection/{zh,en}.js` 各 +74 键；脚本实测两文件 366/366 键、`quickCollect` 子命名空间 73/73 键、diff 为空 |
| QM-1 打包 | PASS | `node scripts/verify-worktree-deps.js`（OK）→ `pnpm run build:dir` rc=0；asar 核对见下方「QM-1 明细」 |
| QM-4 视觉 | PASS | run `38113324932` 的 Gate 7b 两轮判定**只有本 PR 的两张**违规：`collection.png` 761 px（0.037%，来源 views）、`collection-dark.png` 772 px（0.037%，来源 pixel-gate），其余 41/43 张 **0 px**（两轮 drift 逐字相同 ⇒ 确定性而非噪声）。按 QM-4 第 7 条只能取**同一次 run** 的 `quality-gate-visual-reports` artifact 重取：`screenshots/collection.png` → `base-screenshots/collection.png`、`screenshots/collection-dark-current.png` → `base-screenshots/collection-dark.png`，逐字节自证 sha256 `11ff314c…` / `a90239f5…`（与 artifact 源逐字节相等）。阈值、mask、`KNOWN_DYNAMIC` 三者一律未动；本机复跑 freshness 时另见 `create-story2video-detail-dark.png` 140 px 提示，但**同一次 run 的 CI 判定里没有它**（该文件归 Gate 7c 暗档套件在 gate7b 之后覆写，本地复现用的是 artifact 终态目录，与 gate7b 当时的判定域不同）⇒ 不以其改基线，也不把它记成本 PR 的漂移 |
| 静态门禁（含一次被门禁抓住的返工） | PASS | 首轮 CI `QG Static` 红在 **Gate 16 字号七档**：`QuickCollectPanel.vue` 的 `.qc-icon { font-size: 16px }` 是裸字面量（本机未跑此门禁 ⇒ 漏检）。改为 `var(--font-size-lg)` 后本机 `check-font-size-scale.js` PASS（当前 34 / 基线 790） |
| QM-2 代码审查必检项 | PASS | require 路径逐个可解析（`ipc-contract.test.js` 的第二条用例强制入口文件的本地 require 全部 `require.resolve` 通过）；preload 改了源 ⇒ `pnpm run build:preload` 已重生成两 bundle，且 `ipc-contract.test.js` 的 bundle 通道断言通过；IPC 参数在渲染端 `JSON.parse(JSON.stringify(command))` 脱壳后才发（Vue reactive proxy 直传会报 "An object could not be cloned"）；素材 URL 走共享 `safeHttpUrl`；日志**不记**指令原文（只记 `sources`/`count`/`stage`），因为指令可能含私密业务方向 |
| 未闭合（诚实记录） | — | ① 执行不可取消（P1）；② 素材源仅英文三源，中文平台覆盖有限（PRD §13 第 2 条）；③ 真机点击端到端未在本机实测（依赖用户已配置默认大模型 + 三源可达），引擎层以注入式假源覆盖，网络路径不假装已验证（PRD §13 第 3 条）；④ 本机全量套件（`vitest run` 全量）本轮跑到约 40 分钟时陷在低 CPU 空转并被我中止，**未取得全量结论** ⇒ 全量证据改由 CI 的 `QG Desktop Shards (1/2)(2/2)` / `QG Unit Tests` / `QG Coverage` 承担，本机只留下 70 文件 / 1069 例的受影响域子集与 234 例特性域 |
| 记忆沉淀 | PASS | ① **外部记忆（仓库文档）**：本 PRD + 本 change 五件套 + 本记录 + `CHANGELOG.md`；并追加 `01-docs/learnings.md` 新章节「快捷采集交付中的三条可复用教训」（append-only，`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 = 29/0，无行尾改写）。② **外部记忆（本机 gstack learnings.jsonl）**：3 条（置顶型台账插入吞掉标题、跨平面常量对账锁、mock 身份必须稳定），JSONL 逐行 `JSON.parse` 校验通过（143 行 / 0 坏行）。③ **EverOS**：两个主题各一个 session（`mp-quick-collect-20261011-a/b`）走 `POST /api/v1/memory/add`（`messages[{sender_id,role,content,timestamp(整数毫秒)}]`）→ `flush` 两次均回 `status=extracted`，并在 `~/.everos/default_app/default_project/users/agent/{episodes,atomic_facts}/*.md` 用哨兵短语「快捷采集」「changelog-growth」grep 到产物。④ **内置记忆**：本会话的 DSH 会话档本身（`~/.dsh/sessions` 由 harness 自动落盘，无对外写 API）—— 未手工伪造文件 |
| 远程同步 | PASS | PR #3303 已 squash 合并为 `73892e06ec6b7307088be1690ab92d2badccd00c`（2026-10-11T14:15:10+08:00）；取证：`git log origin/main --grep="(#3303)$" --format=%H|%cI` 恰好 1 行且 SHA 相同、`git ls-remote --heads origin quick-collect` = 0 行。本行、`.quality-gates.md` 同名记录的两处、frontmatter 的 `sync_*` 三字段与 `scripts/gate-record-debt-ledger.json` 的登记项在**同一次提交**收口 |

### QM-1 明细（asar 核对）

- 产物：`apps/desktop/dist-electron/win-unpacked/resources/app.asar`。
- 核对项（逐条实跑，不取 rc 当判据）：① asar 清单含 5 个新主进程模块（`quick-collect-command/-materials/-prompt/-presets/-engine.js`）与 `ipc-handlers/quick-collect.js`；② asar 明文含通道字面量 `quick-collect:run` / `quick-collect:list-presets`（证明 preload bundle 已随源码重生成，不是旧产物）；③ `asar extract` 后 `require` 引擎模块并调用 `createQuickCollectEngine` 成功，`ENGINE_ERRORS` 四码齐全；④ 预置目录条数为 6；⑤ `Collection.vue` 编译产物（dist）中页签文案键 `collection.quickCollectTab` 存在。

### 本增量在做什么（一句话）

把「我关心的方向」沉淀成一条可复用的采集指令：内置 6 条 + 用户自定义（增删改），点一下按固定提示词
**先检索最近的真实素材再交给大模型汇总**，结果与手动采集同形同链路（可改写 / 草稿 / 爆款库 / 发布）。

### 不做的事（边界）

- 不加新平台、不动发布链路、不动 `content-intelligence` 的既有语义（复用其 `search()`，只加 `noCache: true`）。
- 不新增 npm 依赖、不新增配置项、不新增网络源。
