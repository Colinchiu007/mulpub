# Tasks: publish-frequency-policy-v2

> 顺序 A → B → C → D，每阶段先在**测试**里红、再实现到绿，然后才进入下一阶段。
> 详细规格（校验表 / 文案表 / 变异清单）见 `01-docs/PRD-PUBLISH-FREQUENCY-POLICY-V2-2026-10-10.md`。

## 0. 前置（已完成）

- [x] 0.1 上游调查报告落盘并合并（PR #3253 / `5e280da6`）
- [x] 0.2 隔离 worktree（`D:\Data\projects\mp-worktrees\mp-publish-frequency-policy-v2`，非 C 盘）+ 裸分支 `publish-frequency-policy-v2`
- [x] 0.3 跨家族对抗评审两轮 + 逐条回应（`rebuttal-v1.md` / `rebuttal-v2.md`，含 L1/L2/L3 证据分级）
- [x] 0.4 方案 v3 修订（并入全部采纳项，删除 proposer 擅自扩项）
- [x] 0.5 复盘评审复跑至收敛（无 Critical / 无 High）  ⇒ 补勾 2026-10-18：.adversarial/ccg-plan-plan-publish-frequency-policy-v2-2026-10-10/summary.md:52 记 run B/C cleared（无 Critical、无未解决 High）；属一次性叙述，无驱动可复跑
- [x] 0.6 上报机制缺陷：`.adversarial` 不在共享根写保护放行名单 ⇒ 评审产物被隔离  ⇒ 补勾 2026-10-18：scripts/guard-shared-root-writes.ps1:68 已把 .adversarial 放进 $allowedTop（缺陷上报后已修，不只是上报）

## 1. 阶段 A — shared-utils（策略 / 守卫 / 队列）

- [x] 1.1 `publish-frequency-policy.test.js` 先红：新数值表（20/10/3、平台档 2）、`tier` 字段、`accountDailyMax` 三档、未登记回落出声**恰好一次**  ⇒ 补勾 2026-10-18：publish-frequency-policy.test.js:71,143,153 + publish-interval-guard.test.js:669（出声恰好一次）。注：测试现钉 v5 值，本项字面的 20/10/3 与平台档 2′ 已被 v4/v5 推翻
- [x] 1.2 env 校验用例：`MP_PUBLISH_DAILY_MAX_{LONG,CLIP,SHORT}`、`MP_PUBLISH_ACCOUNT_DAILY_MAX`（全局覆盖）、`MP_PUBLISH_JITTER_RATIO`（`[0,1)`）、`MP_PUBLISH_RELEASE_GRACE_MS`；合法 / `0` / 非法 / 空白 四态各断言「值 + 是否出声」  ⇒ 补勾 2026-10-18：policy.test.js:280,288,297,317,326,337,346,353,370,375,381,392,401 四态各断言"值 + 是否出声"；env 名见 policy.js:159-168
- [x] 1.3 `publish-frequency-policy.js` 实现至绿（含 `tier`、三档日配额、`jitterRatio` 默认值）  ⇒ 补勾 2026-10-18：publish-frequency-policy.js:104-111 TIER_PRESETS、:78 DEFAULT_JITTER_RATIO
- [x] 1.4 `publish-interval-guard.test.js` 先红：抖动区间 `[base, base×1.4)`、`ratio=0` 严格退化为旧值、`bucket='daily'`、`reason` 精确值  ⇒ 补勾 2026-10-18：publish-interval-guard.test.js:349,385,248,136
- [x] 1.5 守卫用例：`release` 幂等 / **prev 缺失或错配 ⇒ no-op** / **窗口已被覆盖 ⇒ 不回滚** / 配额回补幂等且下限 0 / `rollback_count` 只增  ⇒ 补勾 2026-10-18：同文件 :446,459,470,482,492（幂等 / prev 错配 / 已覆盖不回滚 / 下限 0 / 只增）
- [ ] 1.6 守卫用例：跨日边界（`23:59:59 → 00:00:01` 两个 `day_key` 独立）；`dailyStore` 读回 `'3'` / `'3.0'` / `'abc'` 三态  ⇒ 部分（留空）：跨日用注入 today() 切日（guard.test.js:275），**无真实 23:59:59→00:00:01 边界**（全 tests grep 23:59 = 0）；读回三态测的是 '3.0'/'0.0'/'abc'，**裸 '3' 无锁**
- [x] 1.7 `publish-interval-guard.js` 实现至绿  ⇒ 补勾 2026-10-18：publish-interval-guard.js:27,29,242-246,394
- [x] 1.8 `task-queue-guard-integration.test.js` 先红：**提交前失败 ⇒ 窗口回滚 ⇒ 立即重发成功**；**已提交失败 ⇒ 窗口保留**（既有用例不放宽）  ⇒ 补勾 2026-10-18：task-queue-guard-integration.test.js:166,133
- [x] 1.9 队列用例：同一错误类型在 `submittedAt` 为空/已置位两态下得到**相反**结果；`submittedAt` 为 null 但 `notSubmitted=true` 的**不一致** ⇒ 占窗口 + error  ⇒ 补勾 2026-10-18：同文件 :203（与 :133/:166 成对，两态相反结果）
- [x] 1.10 队列用例：**成功发布而 `submittedAt === null`** ⇒ `log.error` + 计数（不变量 I4 的探针）  ⇒ 补勾 2026-10-18：同文件 :308；实现 task-queue.js:635-641
- [ ] 1.11 队列用例：配额被拒 ⇒ `_quotaBlocked` 命中 ⇒ **连续 `_processNext()` 不产生紧循环**（断言重复判定次数上限）；定时器到次日 00:00:05 且已 `unref()`  ⇒ 部分（留空）：紧循环 :352,390 与 msUntilNextDay 精确锁 guard.test.js:705 在；但队列层**无「waitMs=次日」断言、unref 无任何测试锁**（实现在 task-queue.js:566-570,580）
- [x] 1.12 队列用例：`publish:released` 事件字段精确；回滚后最小退避生效；每账号每日回滚上限生效  ⇒ 补勾 2026-10-18：guard.test.js:192-194 逐字段断言（非整对象 toEqual）+ :492,508,535 每日上限
- [x] 1.13 `task-queue.js` 实现至绿（`_quotaBlocked`、阶段判据、release 接线、放行路径）  ⇒ 补勾 2026-10-18：task-queue.js:58,497,571,588 + task-queue-frequency.js:24,35,94
- [ ] 1.14 结构锁：`task-queue.js` 必须消费 `recordPublish` 的返回值（防「回传 prev」被重构掉而静默退化）  ⇒ 部分（留空）：**无源码扫描式结构锁**；代偿是行为锁 task-queue-timeout-keeps-window.test.js:184（更强，但字面要求的锁不存在）。task-queue.js:587 的注释自称「结构锁」名实不符，待改

## 2. 阶段 B — 日配额存储与装配

- [ ] 2.1 `store-schema.test.js` 先红：`publish_daily_count` 进入 `TABLE_NAMES` 等七处注册表  ⇒ 部分（留空）：七处实登记，但 store-schema.test.js 全文 14 条用例**一次都没提 publish_daily_count**（当场 grep 计数 = 0），仅 :110 的 TABLE_NAMES↔SCHEMA_SQL 循环间接覆盖 ⇒ 「先红」这条锁不存在
- [x] 2.2 `store-schema.js` 七处同步登记（`TABLE_NAMES` / `OWNER_TABLE_SCHEMA_SQL` / `OWNER_INDEX_SQL` / `SCHEMA_SQL` / `OWNER_TABLE_COLUMNS` / `OWNER_TABLE_KEY_COLUMNS` / `OWNER_COLUMN_DEFAULTS`）  ⇒ 补勾 2026-10-18：apps/desktop/electron/services/store-schema.js:3 引入片段 store-schema-publish-frequency.js，七处登记全在片段内（当场核片段存在 + 七展开点）
- [x] 2.3 `store/publish-daily-store.js` 新 mixin：`getPublishDailyCount` / `incrPublishDailyCount` / `decrPublishDailyCount`（owner 解析复用 `_resolveOwnerSubject`；无 owner no-op）  ⇒ 补勾 2026-10-18：apps/desktop/electron/services/store/publish-daily-store.js:42,67,101（另有 prune :112,137）
- [x] 2.4 store 用例：CRUD、owner 隔离（A 的计数不影响 B）、并发 upsert 累加、`decrDay` 下限 0、TEXT 亲和读回 `'3.0'` 归一  ⇒ 补勾 2026-10-18：store-owner-isolation.test.js:390-470 共 9 条；"并发"是顺序累加非 Promise.all，TEXT 漂移另有 guard-release-store-type.test.js
- [x] 2.5 `container.setup.test.js` 装配锁 3 条（含「摘掉 `dailyStore` 注入即红」与 `bucket='daily'` 行为锁）  ⇒ 补勾 2026-10-18：container.setup.test.js:176,185,192（含 bucket=daily 行为锁）
- [x] 2.6 `container.setup.js` 注入 `dailyStore` + 设置页覆盖解析（任一字段非法 ⇒ 整体丢弃）  ⇒ 补勾 2026-10-18：container.setup.js:374,387-392；policy.test.js:455（全有全无）

## 3. 阶段 C — 渲染层与 IPC

- [ ] 3.1 locale zh/en 成对新增/修改（文案表见 PRD §7）：日配额等待、未提交/已提交失败提示、`scheduleHintWithLimits` 去承诺化、设置页策略区块、紧急放行确认/上限/无窗口三态  ⇒ 部分（留空）：三档归因文案在（locales/publish-page/zh.js:191-198、settings/zh.js:55-68）。**缺**：PRD:311-312 的 failedNotSubmittedHint / failedSubmittedHint 从未进 locales（全仓只存在于 PRD/PLAN/.adversarial）；scheduleHintWithLimits 未去承诺化（zh.js:282 仍写「至少间隔 N 分钟」）
- [ ] 3.2 `publish-progress-events` 投影白名单扩展（`reason` / `daily`）；**穷尽性审计**：新增字段必须同时改所有投影面（既有 4 处 + `emitPhaseNotify`）  ⇒ 部分（留空）：字段三站都在（publish-progress-events.js:163-168、phase4-events.js:351-353、publishProgress.js:96-98,176-179）。**缺**：「穷尽性审计」无机械锁（不像 account-name-source 那种读源码接线守卫），emitPhaseNotify:179 无独立锁
- [x] 3.3 `PublishProgressTaskRow` 用例：日配额文案、`released` 文案、归因标签**三态**（account / platform / daily）、字段缺席**不渲染**标签  ⇒ 补勾 2026-10-18：PublishProgressPanel.test.js:227,250,278,302（TaskRow 经面板渲染，无独立用例文件）
- [ ] 3.4 设置页「发布频率策略」区块：当前档位、实际间隔区间 `[base, base×1.4)`、日配额、回滚失效计数、覆盖保存与失败回滚  ⇒ 部分（留空）：档位/区间/日配额/覆盖保存在（PublishFrequencySettings 测试 :105,162,184,218,255）。**缺**：「回滚失效计数」无 UI 落点，且 getProbeCounts() **零生产消费者**（git grep 只命中评审文档）
- [x] 3.5 紧急放行：二次确认 + 三种结果文案 + 每日上限 + ≥10 分钟冷却 + 追加式 JSONL 审计  ⇒ 补勾 2026-10-18：publish-emergency-release.js:24,26（10′ 冷却）,110,165,169 + PublishFrequencySettings.vue:417 二次确认；审计文件名 publish-emergency-audit.jsonl
- [x] 3.6 `ipc-handlers/publish.test.js`：`publish:emergencyRelease` 三态 + 审计落盘 + 上限  ⇒ 补勾 2026-10-18：ipc-handlers/publish.test.js:692,710,721,732（另 :665,672,685）
- [ ] 3.7 `phase4-events.test.js`：新事件透传与投影白名单（含 `reason` / `daily`）  ⇒ 部分（留空）：phase4-events.test.js:265 只锁 bucket，全文 grep daily|reason|released = 0 命中 ⇒ 新字段透传无锁

## 4. 阶段 D — 校准基础设施与小坑

- [ ] 4.1 `scripts/publish-frequency-calibrate.js`：口径定义（**以守卫的提交时间 `publish_timeline` 为准，不用 history 的终态时间**）+ 可复现取数 + 输出各平台 P10/中位/被拦比例  ⇒ 部分（留空）：实落点叫 scripts/calibrate-publish-frequency.js（本项写的 publish-frequency-calibrate.js 不存在）。其 :11-28 声明「优先读 publish_timeline」，但**代码从不读 DB**（只有 :102 读 jsonl）；输出只有最小/中位（:126,179,260）+ violations，**无 P10、无被拦比例**
- [ ] 4.2 脚本自测（fixture 驱动，不依赖真实 DB）  ⇒ 未做：搜过 git ls-tree origin/main -- scripts | grep -i calibrat（只有 calibrate-publish-frequency.js 一个 .js，无同名 test）、git grep -i calibrate origin/main -- .github（仅命中 locale-cjk-baseline.json 的无关中文串）⇒ 该脚本无自测、无 CI 接线，按 AGENTS 等于没写
- [x] 4.3 `config/platforms.yaml` 加注释澄清 `tencent_video` 实际指微信视频号  ⇒ 补勾 2026-10-18：config/platforms.yaml:93-97
- [ ] 4.4 `publish:wechat` 的 accountId 缺口：**本变更不做**，登记为另立变更项（附调用方审计证据）  ⇒ 部分（留空）：声明与证据齐（proposal.md:54、PRD:41,411、src/api/publisher.js:8 零生产调用方），但 openspec/changes/ 下 56 个活跃变更**无一为该"另立变更项"的实体** ⇒ 后继责任无载体

## 5. 文档

- [x] 5.1 `01-docs/PRD-PUBLISH-FREQUENCY-POLICY-V2-2026-10-10.md`：数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字 / 迁移 / 验收（尽量详细）  ⇒ 补勾 2026-10-18：01-docs/PRD-PUBLISH-FREQUENCY-POLICY-V2-2026-10-10.md §6.2/7/9/10/11/15
- [x] 5.2 更新 `01-docs/PRD-PUBLISH-FREQUENCY-CONTROL-2026-10-02.md` 的失效结论（数值与维度已被 v2 取代）  ⇒ 补勾 2026-10-18：PRD-PUBLISH-FREQUENCY-CONTROL-2026-10-02.md:4 状态行 + :122,124；本会话 PR #3908 又补了三处现在时纠偏（含两处常量归属文件写错）
- [x] 5.3 CHANGELOG 置顶  ⇒ 补勾 2026-10-18：CHANGELOG.md:3114 条目在（现非顶部，因后续会话再置顶——置顶型写面的常态）
- [x] 5.4 `.quality-gates.md` 记录 + `openspec/records/publish-frequency-policy-v2.md`  ⇒ 补勾 2026-10-18：.quality-gates.md:1369 + openspec/records/publish-frequency-policy-v2.md（两形态齐）

## 6. 变异反证（每条先跑基线证明绿，再变异证明**恰好那一条**红）

- [x] M1 摘掉 `notSubmitted` 回滚 → 「未提交失败窗口回滚」红
- [x] M2 把「已提交失败」也回滚 → 「已提交失败仍占窗口」红
- [x] M3 `release` 去掉 prev 一致性检查 → 「窗口已被覆盖不回滚」红
- [x] M4 抖动改双向 → 「抖动只增不减」红
- [x] M5 日配额判定移除 → 「日配额用尽被否决」红
- [x] M6 `decrDay` 去掉下限 0 → 「计数下限 0」红
- [x] M7 摘掉 `dailyStore` 注入 → 装配锁 2 红
- [x] M8 未登记平台 warn 改静默 → 「未登记出声一次」红
- [x] M9 平台档默认改回非 2 → 「平台档默认 2 分钟」红
- [x] M10 紧急放行去掉上限 → 「紧急放行上限」红
- [x] M11 `submittedAt` 判据恒真 → 阶段判据锁红
- [x] M12 摘掉成功路径自证（I4）→ 「成功而 submittedAt 为空报 error」红
- [x] M13 移除 `_quotaBlocked` 跳过 → 「不产生紧循环」红
- [x] M14 回滚后退避置 0 → 「最小退避」红

## 7. 门禁与交付

- [ ] 7.1 定向测试 + shared-utils 全量 + 桌面受影响面全量；eslint 0 error  ⇒ 部分（留空）：record 只有 shared-utils 全量 800 + 桌面 **7 文件定向**（非桌面全量）；eslint 现由 Gate 11 机械守（quality-gate.yml:798-801）且 PR 已合并，但 record 与 PR #3260 正文均无当场读数
- [x] 7.2 QM-1 打包（`verify-worktree-deps` → electron-builder --dir → asar 清单 → require 链 → 启动 8s 捕获 stderr）  ⇒ 补勾 2026-10-18：record「QM-1 打包」行（verify-worktree-deps OK、build:vue rc=0、builder rc=0、asar 14890 条目含 3 新文件与全部新文案键、启动 8s 经 origin/main 基线 A/B 改判）
- [ ] 7.3 QM-4 视觉（进度面板/设置页有基线则跑；无基线以 DOM 行为锁承担并如实记录）  ⇒ 未做：record、.quality-gates.md:1369-1390、PR #3260 正文三处 grep 视觉|pixel|QM-4 **全 0 命中**；连「无基线以 DOM 行为锁承担并如实记录」这半步也没做（base-screenshots/settings-general.png 确有基线、进度面板无基线）
- [ ] 7.4 行尾对账（两口径 numstat）、品牌残留、文档同步、接线棘轮、债务熔断  ⇒ 部分（留空）：行尾 / 品牌残留 / 接线棘轮有 PASS 行；**文档同步（openspec-sync-check）与债务熔断在 record、.quality-gates、PR 正文均 0 命中**
- [ ] 7.5 QM-6 验证层双模型评审（`sh scripts/deep-review.sh`）+ findings 回写  ⇒ 部分（留空）：record 自陈「本轮仅 critic=claude **单家族**运行」，i4 的 dismissed 未取得跨家族外部复核；1C+4W 已修（6e6bf7961），逐条裁决在 .adversarial/ccg-deep-e2417f8a/adjudication.json
- [x] 7.6 PR → CI 全绿 → squash 自动合并 → 远程同步回填销账  ⇒ 补勾 2026-10-18：record 远程同步行 PR #3260 MERGED、merge SHA c9d08ff45、四源取证、登记项同次删除。（该回填通道已于 2026-10-17 被 #3879 取消，此属历史事实）
- [ ] 7.7 记忆三路沉淀（内置 / `01-docs/learnings.md` / EverOS）+ 回读验证  ⇒ 部分（留空）：01-docs/learnings.md:1671,1677,1683,1689,1695,1701,1707 六条 + 内置记忆条目在；**EverOS 一路仓库内零可核验产物**
