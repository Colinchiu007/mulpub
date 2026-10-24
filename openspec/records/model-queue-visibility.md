---
record: model-queue-visibility
task: 模型调用排队可见性——本地限流器排队时向用户显示「排队中，约 X 秒后开始」
date: 2026-10-24
branch: model-queue-visibility
---

## 本次执行记录：模型调用排队可见性（model-queue-visibility，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码变更**（主进程 + 渲染层 + locale + 文档）。隔离方式：沙箱内**独立 clone**（`/workspace/mulpub-git`，与用户主工作区物理分离）+ 独立分支 `model-queue-visibility`（裸 task 名，无斜杠）。⚠️ 本环境无 `scripts/start-mp-task.ps1`（PowerShell 脚本，Linux 不可执行）⇒ 等价手工隔离；`git worktree` 在 NFS 上需二次全量 checkout（实测 >10 分钟未完成）⇒ 改用「独立 clone + 独立分支」，同样满足"不碰共享主工作区" |
| 第一性原因（QM-5 ①） | ✅ | **不是 bug，是缺失**：本地限流器在排队期间**不产生任何对外事件**（`_pace` / `_acquireSlot` 只 `sleep`），界面无反馈 ⇒ 用户只看到"卡住了"，30~45s 后突然失败。根因在"限流器状态没有出口"，不在文案、不在渲染层 |
| 逃逸分析（QM-5 ②） | ✅ | 既有测试**结构上无法**抓到：这是**缺失型**缺陷——要断言的是"不存在的事件"，而测试只能断言已存在的行为。仓内 `api-usage-governor.test.js` 覆盖了调度语义（信号量/时间槽/冷却），但**没有任何一处断言"排队期间应通知外部"** ⇒ 缺口在**契约层**（限流器没有对外队列事件这一约定） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增两个模块 + 两份单测：<br>① `apps/desktop/electron/services/governor-queue-snapshot.js`（主进程侧队列快照聚合，纯函数）→ `governor-queue-snapshot.test.js`（11 例）<br>② `apps/desktop/src/domain/queue-hint.js`（渲染侧提示判定，纯函数、不绑 i18n）→ `queue-hint.test.js`（7 例）<br>③ 接线：`api-usage-governor.js`(+3 行) → `ipc-handlers/pipeline.js`(+12 行) → `CreateView.vue`(+8 行) → `StageProgress.vue`(+18 行) + `locales/stage-progress/{zh,en}.js`(+4 行各) |
| 防止再次发生（QM-5 ⑤） | ✅ | 把三个**会静默吞掉提示**的隐藏契约写进新模块的注释（后人改这些地方时会看到）：<br>① `stage-executor.js` 的 `normalizeStageProgress` 是 fail-closed：非 `stageProgress.` 前缀的 `messageKey` ⇒ **整条更新被丢**<br>② `pipeline-engine.js` 的 `percent` **单调不降守卫** ⇒ 阶段中段发 `percent:0` ⇒ **静默丢弃**（本方案因此完全不走阶段进度通道）<br>③ `apps/desktop/vitest.config.js` 的 `include` 是**白名单** ⇒ 未登记的测试文件**一个都不会跑**（故两处新测试的路径必须落在 `electron/services/**` 与 `src/**`）|
| 行尾与 diff 对账 | ⏳ | 提交后以 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径核对（本次全部为新增/局部改动，无整文件重写）|
| 接线棘轮 | ✅ | 两份新测试**都在 vitest include 白名单内**：`electron/services/**/*.test.{js,ts}` 覆盖 `governor-queue-snapshot.test.js`；`src/**/*.test.{js,ts}` 覆盖 `queue-hint.test.js` ⇒ 会被真实执行（不是"写了没人跑"）<br>⚠️ 风格必须是 **vitest**（`node:test` 风格在 vitest 下收集不到用例 = 假绿）；已按 `api-usage-governor-logging.test.js` 的既有形态对齐 |
| QM-1 打包 / QM-4 视觉 | QM-4 N/A / QM-1 未执行 | **QM-4 视觉**：N/A（未改布局/样式/主题，仅在既有粘性头部内加一行提示条，且复用 `.progress-summary` 既有样式类）<br>**QM-1 打包**：⛔ **本环境未执行**（沙箱无 `pnpm` 依赖、无 Electron 二进制；`pnpm install` 在 NFS 上会卡在 store 的 SQLite 锁）⇒ 由 CI 的 `electron-tests` / `QG Desktop Shards` 覆盖 |
| QM-6 CCG 双模型外部评审 | ⛔ 未执行 | 本机无 `codeagent-wrapper`（仓外验证层引擎）⇒ **如实记「未执行」，不以自审冒充通过**。替代：① 本次改动经**独立两路审查**（落地可行性 / 产品体验，见 `01-docs/PRD-MODEL-QUEUE-VISIBILITY-2026-10-24.md` 与审查报告）；② 两份新模块均做了**变异验证**（注入缺陷 ⇒ 对应用例变红）|
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。合并后 main push 的回读证据写在 **PR 评论**里，不写回本文件 |

### 本地验证的 Fresh 证据（沙箱内实跑）

| 验证 | 命令 | 结果 |
|---|---|---|
| 主进程侧单测（11 例）| `node --test`（CJS 镜像，断言体与入库文件**逐字相同**，被测模块为**真实文件**）| 11/11 绿 |
| 渲染侧单测（7 例）| `node --import` + ESM loader（把 `vitest` 映射到最小兼容层，跑**入库的真实测试文件**）| 7/7 绿 |
| 变异验证（主进程侧 4 个）| ETA 恒为 null / 去掉并发优先排序 / RPM 分支 `queued` 改 0 / 过期判断反向 | 分别红 2 / 1 / 3 / 5 例 ⇒ **断言有牙齿**<br>⚠️ 第 4 个变异**未红**：被另一道冗余守卫（`entry` 非对象即返回 null）覆盖 ⇒ **变异打偏**（不是锁没牙齿），行为仍正确、测试仍有效 |
| 变异验证（渲染侧 4 个）| ETA 阈值 1000→0 / 去掉 `count<=0` 守卫 / kind 判定反转 / entries 空数组判空改写 | 分别红 1 / 1 / 4 / **0** 例 ⇒ 第 4 个同样**变异打偏**（被 `entry` 守卫覆盖）|
| 行数门禁自检 | 逐文件读 `max-lines-baseline.json` 的 `files`/`targets` 与当前读数 | `api-usage-governor.js` 读数 494（未挂账、上限 499，**余 5**）；`ipc-handlers/pipeline.js` 410（未挂账）；`CreateView.vue` 5563（`targets` 5656，**余 93**）；`StageProgress.vue` 326；locale 各 164；4 个新文件均 < 500 ⇒ **不触发 `TARGET_GREW`** |
| 语法 | ESM 文件用 `vm.SourceTextModule` 真解析器；CJS 模块用真 `require` | 3 个 ESM 文件 + 1 个 CJS 文件全过 |
| 品牌残留 | 读 `scripts/check-no-brand-residue.js` 的词表（按码点构造，不含字面量）| 本次新增/改动文件不含该词表的任何变体 ⇒ 预期 rc=0（脚本本身需 git 仓 ⇒ 实际执行由 CI 复核）|

### 遗留（不假装已闭合）

- **⛔ QM-1 打包验证与 QM-6 外部双模型评审均未在本地执行**（环境不具备），依赖 CI 兜底。
- **⛔ 「排在第几位（全局）」本期做不到**（限流器是单机进程内的）⇒ 文案与 PRD 明确不承诺，避免用假位次糊弄用户。
- **⛔ 阶段执行器（story2video 等）的直调路径未接入**：`story2video-stages.js` 在「点名还账、零容差」名单内（`targets` 4081），改动需先抽模块 ⇒ 单独排期。
- **⛔ 厂商 `Retry-After` 仍未透传**（46 个 adapter 调用点全部丢弃响应头）⇒ 与本 PR 无耦合，独立小 PR。
- **⛔ catalog 下发的 `rate_per_minute` 仍是乐观默认值** ⇒ 独立小 PR。
- ⚠️ 本地 **vitest 未安装**，两处渲染层相关断言用「ESM loader + 最小兼容层」在真实入库文件上实跑；CI 的 vitest 版本仍需复核一次（断言写法与仓内既有测试一致，风险低）。

## CHANGELOG 条目

# feat(desktop): 模型调用排队时显示「排队中，约 X 秒后开始」，不再静默卡住

- 模型服务商调用被本地限流器排队时（并发槽已满 / RPM 时间槽未到），阶段进度区会实时显示排队提示：能算出精确时间时给 ETA，算不出时只报"当前有 N 个请求在等待"，**不编造时间**。
- 排队结束提示自动消失；排队上限、服务商 429 的重试与失败语义**完全不变**，本次只增加可见性。

## learnings

### lesson: 缺失型缺陷测试断言不出来——要断言"契约存在"，不是断言"行为"

- **现场**：模型调用排队期间界面毫无反馈。既有测试覆盖了限流器的全部调度语义（信号量 / 时间槽 / 冷却 / 退避），**全绿**，但没有任何一处能抓到"用户看不到排队"。
- **根因**：这是**缺失型**缺陷——要断言的对象是"不存在的事件"。测试只能断言已存在的行为，于是**结构上无法**覆盖。
- **正解**：把缺失的东西**显式契约化**（本仓的既有形态就是"契约镜像 + 机械锁"）：先写一个纯函数模块承载新语义 + 对应单测，再让接线走它。
- **配套**：新增测试文件必须落在 `apps/desktop/vitest.config.js` 的 `include` **白名单**内（未登记 = 一个都不会跑 = 假绿），且风格必须与该目录既有测试一致（`electron/services/**` 是 vitest 风格，写成 `node:test` 会收集不到用例）。
