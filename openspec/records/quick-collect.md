---
record: quick-collect
task: 采集页「快捷采集」——内置 6 条官方指令 + 自定义指令增删改 + 检索/汇总执行链
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个动这些文档的会话（回填时必须**同一次**改三处：本文件表格行 + 正文「保留门禁」bullet + `.quality-gates.md` 同名记录的表格行与 bullet，并整段删除本 frontmatter 的三个 sync_* 字段，同时删 `scripts/gate-record-debt-ledger.json` 的本标题登记项 —— 缺任一处会被 Gate 2c / 欠账门禁当场判红）
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
| QM-2 代码审查必检项 | PASS | require 路径逐个可解析（`ipc-contract.test.js` 的第二条用例强制入口文件的本地 require 全部 `require.resolve` 通过）；preload 改了源 ⇒ `pnpm run build:preload` 已重生成两 bundle，且 `ipc-contract.test.js` 的 bundle 通道断言通过；IPC 参数在渲染端 `JSON.parse(JSON.stringify(command))` 脱壳后才发（Vue reactive proxy 直传会报 "An object could not be cloned"）；素材 URL 走共享 `safeHttpUrl`；日志**不记**指令原文（只记 `sources`/`count`/`stage`），因为指令可能含私密业务方向 |
| 未闭合（诚实记录） | — | ① 执行不可取消（P1）；② 素材源仅英文三源，中文平台覆盖有限（PRD §13 第 2 条）；③ 真机点击端到端未在本机实测（依赖用户已配置默认大模型 + 三源可达），引擎层以注入式假源覆盖，网络路径不假装已验证（PRD §13 第 3 条）；④ QM-4 视觉基线需按同一次 CI run 的 artifact 重取并归因（页签新增属可见像素变化） |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后同一次回填：本文件表格行 + 正文 bullet + `.quality-gates.md` 同名记录两处 + 删 frontmatter 三字段 + 删 ledger 登记项 |

### QM-1 明细（asar 核对）

- 产物：`apps/desktop/dist-electron/win-unpacked/resources/app.asar`。
- 核对项（逐条实跑，不取 rc 当判据）：① asar 清单含 5 个新主进程模块（`quick-collect-command/-materials/-prompt/-presets/-engine.js`）与 `ipc-handlers/quick-collect.js`；② asar 明文含通道字面量 `quick-collect:run` / `quick-collect:list-presets`（证明 preload bundle 已随源码重生成，不是旧产物）；③ `asar extract` 后 `require` 引擎模块并调用 `createQuickCollectEngine` 成功，`ENGINE_ERRORS` 四码齐全；④ 预置目录条数为 6；⑤ `Collection.vue` 编译产物（dist）中页签文案键 `collection.quickCollectTab` 存在。

### 本增量在做什么（一句话）

把「我关心的方向」沉淀成一条可复用的采集指令：内置 6 条 + 用户自定义（增删改），点一下按固定提示词
**先检索最近的真实素材再交给大模型汇总**，结果与手动采集同形同链路（可改写 / 草稿 / 爆款库 / 发布）。

### 不做的事（边界）

- 不加新平台、不动发布链路、不动 `content-intelligence` 的既有语义（复用其 `search()`，只加 `noCache: true`）。
- 不新增 npm 依赖、不新增配置项、不新增网络源。
