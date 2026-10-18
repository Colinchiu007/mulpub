---
record: hot-topics-item-model
task: 热门选题条目模型落地 tasks 2.2——kind 判别位由产出层写、不合格条目在采集出口丢弃、三道投影白名单接同一实现并配接线锁
date: 2026-10-18
---

## 本次执行记录：热门选题条目模型（kind 判别位 + 采集出口资格判据 + 投影接线锁）（hot-topics-item-model，2026-10-18）【混合 PR · 运行时代码】

## 0. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | 运行时代码（主进程服务 + IPC handler）+ 测试 + 文档 + OpenSpec 任务勾账 |
| 隔离方式 | `scripts/start-mp-task.ps1 -TaskName hot-topics-item-model` 创建：worktree `D:\Data\projects\mp-worktrees\mp-hot-topics-item-model`（**非 C 盘**），裸分支 `hot-topics-item-model`；依赖 `pnpm install --frozen-lockfile` + `ensure-electron`（v43.7.7）+ `verify-worktree-deps`（11 个消费方解析通过）全部通过 |
| 共享根 | 保持 `main` clean，本片未在共享根落任何运行时文件 |
| 决策来源 | 用户 2026-10-18 明确：先做 `tasks.md` 2.2（不依赖开放平台资质），要求独立分支/worktree 且在非 C 盘、TDD、QM-1、应用质量节拍、推 GitHub 开 PR、CI 通过后自动合并 |
| 规格真源 | `openspec/changes/hot-topics-viral-items/specs/hot-topics-viral-items/spec.md`（Requirement 1/2/3/5）；已落地口径写回 `01-docs/PRD-HOT-TOPICS-SHORTVID-VIRAL-ITEMS-2026-10-17.md` §11 |

## 1. 门禁结果

| 门禁项 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 见 §0；分支名 == `.agent_context/expected-branch`（钩子校验） |
| TDD（RED→GREEN） | PASS | **先写用例并见证 RED**：`hot-topics-item-model.test.js` 因 `item-model.js` 不存在而整文件 LOADFAIL（`Tests no tests`，非"0 失败"）。实现后：**21 passed (21)**；消费者并集 8 个测试文件 **170 passed / 0 failed**（`hot-topics-item-model` / `hot-topics-service` / `hot-topics-new-sources` / `hot-topics-boost-classify` / `hot-topics-quota` / `classifier` / `scorer` / `ipc-handlers/hot-topics.assembly`），另 `src/href-scheme-contract.test.js` **16/16** |
| 变异反证（四条，全部指名红） | PASS | M1 把 `validateEntry` 调用改成恒通过 ⇒ 红 **3/21**；M2 摘掉服务层第一个采集出口的 `filterViableEntries` 调用 ⇒ 红 **1/21**；M3 `pickContentFields` 把空对象当有效互动 ⇒ 红 **2/21**；M4 `withLegacyKind` 连非法 kind 也修成 `topic` ⇒ 红 **1/21**。四条均 `restored=true`（还原后 md5 与改前逐字节相同）。驱动前两版分别因 `spawnSync('pnpm')` ENOENT 与"ANSI 未剥净导致汇总行解析不到"而把"没跑"读成结论——已改为 `process.execPath` 直跑 vitest 入口 + ASCII 构造正则剥 ANSI，并把 `total` 从 `N passed (K)` 取而不是先命中的 `(1)` |
| QM-1 打包 + 启动三层判据 | PASS | `pnpm run build:dir` rc=0；asar 归属自证：`\electron\services\hot-topics\item-model.js`、`\electron\services\hot-topics-service.js`、`\electron\ipc-handlers\hot-topics.js` 三项均在包内；隔离 userData 启动 `win-unpacked/Multi-Publish.exe`：**alive=true（8s 后仍存活，提前退出即 FAIL）**、**stderr 0 字节**、红线命中 `[]` ⇒ `VERDICT=PASS`；子进程 env 经 `scripts/lib/qm1-child-env.js` 的 `buildChildEnv()` 构造（本次父环境未带 `ELECTRON_RUN_AS_NODE`，故未触发告警分支，剔除逻辑仍在链上）；终止只按 `child.pid` 精确 `taskkill /T /F`，前后 `Multi-Publish.exe` 计数 **0 → 0 相等**（未按镜像名批量杀） |
| QM-2 代码必检项 | PASS | 无新增同步 CPU 原语；无新增高频 IPC（改动全在既有 `hot-topics:fetch` / `get-cache` 的数据形状上，调用次数不变）；无新增全局组件注册或顶层 CSS import；`require` 路径新增一条 `require('./hot-topics/item-model.js')` 与两条 `../services/hot-topics/item-model.js`，均已由 asar 清单证实存在；未新增硬编码等待；解析器与判据是纯函数，无 I/O |
| QM-4 视觉回归 | N/A（**判定域内无用例**） | 本片**不改任何 `.vue`/CSS**，且按 §11.4 用户可见行为逐字不变（无条目会以 `kind=item` 出现）；CI 像素门禁的 `pixelTests` 判定域不含 `hot-topics`，故不把「QG Visual 绿」当本片证据，也不登记为盲区——因为本片无视觉面 |
| i18n 成对与使用性 | N/A（**有意，非遗漏**） | 本片无新增用户可见文案：判别位与新字段都只是数据形状，作者段/互动段/缺席态文案属于**接入第一个内容源那一片**（PRD §11.4 已写明）。因此不动 `locales/**`，Gate 7 与 `--cjk` 无新增输入。触发时机被显式记在 PRD §11.4，避免下一个会话误以为"文案忘了加" |
| 行数 / 债务门禁 | PASS | `check-debt-budget`：`filesOver1000 28（基线 32）`、`filesOver500 95（基线 101）`、`modelProviderRequireFanOut 65（基线 65）`、`circularDeps 0` 全在基线内；新模块 `item-model.js` 远低于 500 行；`hot-topics-service.js` 净增 7 行未跨新档 |
| eslint（CI Gate 11） | PASS | 对本片 5 个 js 文件按 `apps/desktop/eslint.config.mjs` 实跑 rc=0（本机 pre-commit 不覆盖 Gate 11，故点名跑） |
| 文档同步 | PASS | PRD 新增 **§11 已实现切片**（11.1 单一实现五函数职责表、11.2 四个流程落点、11.3 数据校验拒绝码表、11.4 交互与显示项、11.5 回归锁与变异读数）+ §6.1 加状态更新注 + 变更记录 v1.1 行；`openspec/changes/hot-topics-viral-items/tasks.md` 勾 2.2 并同条补 PR 号位与证据；`CHANGELOG.md` 新增一个标题块（一条变更一个块，不用双换行插 bullet） |
| 行尾（CRLF）保持 | PASS | 六处被改文件工作树均为 `i/lf w/crlf`；所有插入行由补丁脚本沿用**锚点行自己的行尾**，并断言「CR 增量 == 插入行数」与「裸 LF 行数不变」——实测 CHANGELOG 那次正是这条断言拦下了我前插的 10 行裸 LF（未落盘）。提交后以 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径对账 |
| 落点归属（不改他人文件） | PASS | 改动集恰 9 个文件（6 改 2 新 + 本记录），逐条来自 `git diff --name-only`；未卷入他人并发在制品；一次性脚手架脚本 7 份经 `node scripts/safe-delete.js` 可恢复删除，不进仓 |
| QM-6 双模型外部评审 | PENDING | `ccg-review-decider` 判定 **DUAL**（384 行 > 200 行阈值、6 个源文件、无敏感命中，要求 claude + opencode）。深审与处置结论见 §4，回填后本行改写 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导；本篇按新形态写，不带 `sync_*` 字段 |

## 2. 本片交付什么（一句话 + 三条判据）

把「热门选题」的条目盒子改对：判别位由产出层写、坏条目在采集出口就丢、三道手工白名单接同一实现并有一把数着字段的接线锁。**用户可见行为逐字不变**——这是本片的设计约束，不是没做完。

1. 判别位**必填**且非法值不修：`normalizeKind` 只认两值，其余返回 `null`；`withLegacyKind` 只补"从没写过"的旧数据，不修非法值。
2. `kind='item'` 三字段全空 ⇒ 采集出口丢弃（拒绝码 `ITEM_NO_CONTENT`），warn 只记渠道与计数原因、不记条目文本。
3. 字段缺席 ≠ 空值 ≠ 兜底值：`author` 不截断（超长视为畸形）、`publishTime` 只认 ISO 形态（毫秒时间戳不是发布时间）、`interaction` 只认四键非负整数且 **0 保留**、空对象视为缺席、未登记键不采纳。

## 3. 已知边界与偏差登记（不是遗漏）

| 项 | 事实 |
|---|---|
| 本片不接任何内容源 | §6.2（抖音官方热门视频榜）阻塞在取证清单 `01-docs/research/hot-topics-douyin-hot-video-openapi.md` 的 P-1…P-6/E-1…E-6（用户 2026-10-18 明确"开放平台我还没申请"）；§6.3 小红书条目自采未开工；§6.4 视频号开源侧未命中源 |
| `play` 键已留白名单位但未启用 | `INTERACTION_KEYS` 含 `play`，而**没有任何源会产出它**——它不是空壳字段（值缺席即键不存在），但 O-3 取证前不得有实现依赖它 |
| 判别位对渲染层的影响 | 渲染层 `HotTopics.vue` 本片不改；新字段是加宽而非改形，旧渲染路径不看 `kind` 也照常工作 |
| 归档标签那片（PRD §5） | 按用户指示**接在后面**，不在本片范围；本片已完成它的前置（名次派生量必须与 `hotValue` 分字段，Requirement 4 已落进实现与用例） |
