# Tasks：逐平台同账号发布间隔（v5）

判据口径：`[x]` 只在**已实测**后勾，且后面跟着现场证据；未跑的一律 `[ ]`。

## 1. 取证与设计

- [x] 1.1 检索各平台公开量化间隔口径 → 结论：**没有任何平台公布过间隔阈值**；
  视频号有"日发上限按粉丝分级（千粉 1／万粉 2／万粉以上 ≤5）、超限直接限流"的运营口径，
  抖音运营口径原文明确"官方没有『发 3 条就限流』的硬规定"，百家号来源已失效（302 到错误页）。
- [x] 1.2 决策记录：逐平台表 vs 新档位 vs if 分支（选逐平台表，理由见 design.md 决策 1）
- [x] 1.3 优先级链定为 5 级并写死"细粒度赢粗粒度"（design.md 决策 2）
- [x] 1.4 env 形态定为**一条 JSON**并定义两档严格度（design.md 决策 3）

## 2. TDD 红

- [x] 2.1 新增 `packages/shared-utils/tests/publish-frequency-account-interval.test.js` 7 条锁
  （表覆盖与偏离集合 / 五级链 / resolveIntervals 真走解析器 / env 两档严格度 / 设置页校验 /
  兜底不绕过覆盖链 / 两函数不得互调）
- [x] 2.2 改写既有「全域账号档 ≤ 5 分钟」锁为「偏离显式枚举」（`publish-frequency-policy.test.js`），
  并把"逐平台值 == 档位值"的对比收窄到 `platformMinMs` 与 `accountDailyMax` 两维
- [x] 2.3 实测红：`Failed Tests 9`（7 新 + 2 改写），逐条为"实现未做"而非夹具自身故障
- [x] 2.4 设置页 6 条新锁先写先红（`Failed Tests 6`），夹具 `accountMinDefaults` 与生产同形

## 3. 实现

- [x] 3.1 `PLATFORM_ACCOUNT_MIN_INTERVAL_MS` 逐平台表（15 平台，视频号 60′，其余沿用档位值；
  注释如实标注"暂定/产品决策/未取证"）
- [x] 3.2 `PLATFORM_FREQUENCY_POLICY` 的账号档替换为逐平台值（其余两维仍按档）
- [x] 3.3 `BASELINE_INTERVALS.accountMinMs` 改为**引用表**，不另写数字
- [x] 3.4 `resolveAccountMinIntervalMs` + `parseAccountMinIntervalEnv`（env JSON 校验，
  值非法整条作废 / 未知键忽略 / 超界钳位 / 不抛错）
- [x] 3.5 `resolveIntervals` 的账号档改走该解析器（守卫侧零改动）
- [x] 3.6 `resolvePolicyOverrides` 新增 `accountMinMsByPlatform` 校验分支
- [x] 3.7 模块头 v5 变更段 + `module.exports` 三个新名字
- [x] 3.8 `index.d.ts` 补三个声明（由**既有**双向声明锁当场抓到，非自觉）
- [x] 3.9 `publishFreq:getPolicy` 下发 `accountMinDefaults`
- [x] 3.10 设置页逐平台区块（15 行「默认／生效／已覆盖／输入框」）+ `buildPolicy`/回填 + locales zh/en 5 键成对

## 4. 回归验证

- [x] 4.1 `packages/shared-utils` 全量：`52 passed / 1063 passed | 10 skipped`（0 失败）
- [x] 4.2 消费者并集全跑（AGENTS「验证范围取消费者并集」）：桌面侧 10 个测试文件
  `329 passed`（bootstrap / container.setup / ipc-handlers.publish / publish-emergency-release /
  publish-progress-events / publisher-router / store-owner-isolation / PublishFrequencySettings /
  PublishProgressPanel / SettingsDialog）
- [x] 4.3 locale 成对：`check-locale-sync.js --pair-base` PASS、`--cjk` PASS；
  另以键集比对确认 `publishFrequency` 段 zh/en 各 43 键、差集为空
- [x] 4.4 ESLint（CI Gate 11 同口径 `--quiet`）对改动文件 0 error
- [x] 4.5 QM-1 打包 + asar 产物判据 + 启动三层 stderr 判据（`build:dir` rc=0；`entries=15019`、`dist/` 125 条含 `index.html`；产物内策略四项命中 + IPC 含 `accountMinDefaults` + 渲染端新 testid/locale 命中且以既有 testid 作正控；启动 12s 存活、stderr 0 字节、本 worktree 进程 0→0）
- [x] 4.6 变异反证 **9 道（M1–M9）：8 道 CAUGHT 且各自指名；M2 报 `ANCHOR_NOT_FOUND`（拆文件后文案与锚点漂移，如实留痕不掩成 CAUGHT；其判据由行为锁 L4 覆盖）**（驱动入库 `.ccg/reviews/freq-v5-mutate.driver.js`，仓库根由 `__dirname` 推导、不写盘符；还原逐字节相同。第一版把测试路径写成仓库相对路径 ⇒ 8 道全判 `PROBE_BLIND`，已改为盲窗出声 + 打印原始输出）

## 5. 文档

- [x] 5.1 `01-docs/PRD-PUBLISH-FREQUENCY-V5-2026-10-16.md`（取证与暂定分列、五级链、三入口校验表、
  显示项与提示文字、11 条锁清单、4 条未闭合）
- [x] 5.2 `01-docs/ARCH-PUBLISH-FREQUENCY-AND-QUEUE-2026-10-16.md` 同步：§2 数值改 v5 并给逐平台表、
  §3 env 表与 §3.1/§3.2 校验与优先级、§7 用户可见面（含"分组键必须是 tier"）、
  §9 活例外（定时表单 / 配额不对称）、§10 锁清单、§11 排障新增一行、§12 沿革新增 v5 行
- [x] 5.3 `CHANGELOG.md` 置顶一条（两口径 numstat 相同 `10/0`，CR 21597→21607 == 新增行数）
- [x] 5.4 `01-docs/learnings.md` 置顶一节（五条：量被当界用 / 参照物即被改结构的锁 / 分组标签语义≠数据真源 / 新解析器的兜底递归 / 写→当场验→才报）
- [x] 5.5 `openspec/records/publish-frequency-per-platform-intervals.md`（表格行 + 声明式 bullet 两形态同写；`check-gate-record-debt` 实测 rc=0 OK）

## 6. 交付

- [x] 6.1 QM-6：三通道外部评审不可用 ⇒ 记录里登记「未跑成」，另按用户口径做双轴自审（S-1/S-2/S-5 已修，S-3 拒绝附不可达判据，S-4 撤回附复核证据）
- [x] 6.2 push + PR + CI（sha-pin 看守）+ 判据齐备后 squash 合并并删远端分支      （归档前补勾，2026-10-18 取证：PR #3753 squash merge SHA `29e5a60cdcedec8eadeccb3ad1f14061b6010e73`，`git log origin/main --grep='(#3753)$'` 恰好 1 行；`git ls-remote --heads origin publish-frequency-per-platform-intervals` 返回 0 行）
- [x] 6.3 合并后回填远程同步 PASS + merge SHA，同次提交内完成销账      （归档前补勾，证据 `openspec/records/publish-frequency-per-platform-intervals.md:20` 状态列 PASS 且带 merge SHA；注：这条通道已于 2026-10-17 被 #3879 取消，此后新记录改由 `scripts/lib/merge-ledger.js` 推导收口，不再回填）
- [x] 6.4 worktree 按 R1–R7 退役（先 tag 再动手，`safe-worktree-remove.ps1 -WhatIf` 先干跑）      （归档前补勾，取证 `git worktree list` 已无该任务 worktree，仅剩 `mp-openspec-archive-frequency`）
