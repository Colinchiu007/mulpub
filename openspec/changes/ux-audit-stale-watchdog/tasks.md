# 任务：发布进度「无更新」可见化（ux-audit-stale-watchdog）

## 1. 测试先行（红）

- [x] 1.1 `src/stores/publishProgress.stale.test.js`：running 任务 `lastEventAt` 距今 ≥ 阈值
      ⇒ `stalledTaskIds` 含它、`hasStalledRunning === true`、`taskStallMinutes()` 给出分钟数
- [x] 1.2 阈值未到（2 分 59 秒）⇒ 不判陈旧（把边界钉住，防止把阈值写成 `>=` 一侧的另一头）
- [x] 1.3 迟到任意进度事件 ⇒ `lastEventAt` 刷新 ⇒ 陈旧态消失且分钟数归零
- [x] 1.4 **phase 不被改写**：陈旧后 `task.phase` 仍是原非终态值，`aggregate.failed` 不增长
      （这条是「只读派生」的正面契约；摘掉它等于允许把无更新当失败）
- [x] 1.5 终态任务不参与：`success/failed/cancelled` 且 `lastEventAt` 超阈值 ⇒ 不陈旧、
      不计入 `hasStalledRunning`
- [x] 1.6 混合态：1 陈旧 + 1 新鲜 ⇒ `hasStalledRunning === false`（还有在动的就不许关）
- [x] 1.7 定时器生命周期：全终态/清空会话 ⇒ 活跃 tick 为 0；有 running ⇒ 恰好 1；
      `init()` 调两次 ⇒ 仍恰好 1（模块级单实例）
- [x] 1.8 `PublishProgressPanel.test.js`：关闭按钮 `:disabled` 从 `hasRunning`
      改为 `hasRunning && !hasStalledRunning` 的两半各一条（部分陈旧仍禁 / 全陈旧解禁）
- [x] 1.9 解禁后**真能关掉**：点关闭 ⇒ `panelVisible === false`，且 `sessions` 未被丢弃
      （现场 `handleClose` 只 `clearFinished()`，running 会话清不掉 ⇒ 不解禁这一半就是装饰）
- [x] 1.10 陈旧文案出现在任务行与头部徽标（按 `t()` 键断言，不断言中文字面量）
- [x] 1.11 locales 成对：新增 3 键 zh/en 同时存在；`src/` 非 locales 文件零新增中文字面量

## 2. 实现（绿）

- [x] 2.1 store 增陈旧派生层：`STALL_AFTER_MS` / `STALL_TICK_MS` 常量 +
      `stalledTaskIds` / `hasStalledRunning` / `taskStallMinutes(taskId)` 导出
- [x] 2.2 惰性单实例 tick：`ensureStallTicker()` / `stopStallTicker()` 模块级句柄，
      在 `handleProgressEvent` / `handleBatchEvent` / `dismissSession` / `clearFinished` 之后统一调
      「按当前有无 running 决定启停」（不在每个出口各写一份判据）
- [x] 2.3 `PublishProgressTaskRow.vue`：非终态且陈旧 ⇒ 状态文案后追加 `stallSuffix`，
      颜色走中性档（不改 `'ppp__task--' + task.phase` 的类名口径）
- [x] 2.4 `PublishProgressPanel.vue`：头部徽标增陈旧态分支；关闭按钮 `:disabled` 与 `:title` 改口径；
      `handleClose` 在全陈旧时显式 `panelVisible = false`（隐藏不丢状态）
- [x] 2.5 `src/locales/publishPage/{zh,en}.js`：3 键成对新增，不改既有键语义

## 3. 反证

- [x] 3.1 `scripts/stale-watchdog-contract-mutate.js`（沿用 1.2/1.3/1.4 驱动骨架：
      可执行形态、不攻击断言本身、解析前剥 ANSI、`collected>0` 下界、`RUN_UNCLEAN` 档、
      还原后 md5 回读 + 信号兜底、平台感知 runner）
- [x] 3.2 至少六道，各打各的格子：
      S1 阈值改成 `Infinity`（永不陈旧）/ S2 把陈旧同时写进 `phase = 'failed'`
      （验证 §1.4 那条正面锁真有牙）/ S3 摘掉 `clearInterval`（常驻 tick）/
      S4 `ensureStallTicker` 去掉 `if (stallTimer) return`（重复注册）/
      S5 关闭按钮退回 `:disabled="store.hasRunning"` /
      S6 `handleClose` 退回只 `clearFinished()`（解禁但点了没反应）
- [x] 3.3 末跑全 CAUGHT 且逐条 `RESTORE_OK`

## 4. 文档与验证

- [x] 4.1 `01-docs/PRD-STALE-WATCHDOG-2026-10-22.md`（显示项/交互逻辑/数据校验/提示文字逐项）
- [x] 4.2 审计文档 1.8 行状态 + 文末落地记录；CHANGELOG 条目 —— 审计文档行已标 ✅ 并加 §11（现状取证 / 三条口径 / 反证读数 / 两处自错 / 刻意不做），CHANGELOG 顶部新条目按现场 CRLF 档插入
- [ ] 4.3 `openspec/records/ux-audit-stale-watchdog.md`（门禁表 + 现场读数）
- [x] 4.4 全域读数：`vitest run src` ⇒ `405 files: 2 failed / 403 passed`、`6413 tests: 2 failed / 6409 passed / 2 skipped`。两条红同一根因是**构建产物前置缺失**（`electron/preload/index.bundle.js` ENOENT，属 overlay-view-suspension 与 shell-mode-6b 两条既有静态链路锁），`pnpm run build:preload` 后同两条 **29 passed**；本批未动 preload ⇒ 不认领也不改测试。消费者并集 12 文件 **298 passed / 0 failed、无 Errors 段**
- [x] 4.5 静态门禁：`check-locale-sync --pair-base origin/main` PASS、`--cjk` PASS（基线 1330 → 1124，无新增硬编码）；新增 3 键 zh/en `grep -c` 各为 1；聚合 eslint 8 个改动文件 rc=0；行尾两口径逐字一致（add 1357 / del 17）；新脚本按 `git check-ignore --no-index` 实测命中 `scripts/*.js` ⇒ 同 PR 补 negation
- [ ] 4.6 QM-6 双模型评审与逐条处置（改 store + 三组件 ⇒ 预计 DUAL）
- [ ] 4.7 PR + CI；自动合并仅在全部判据合法通过时执行

## 5. 遗留（写明，不静默吞掉）

- [ ] 5.1 陈旧 ⇒ 自动取消/判失败 不在本批（需主进程任务存活判据）
- [ ] 5.2 audit-14「进度恒定 0%」的 `aggregate` 软权重口径未动，属另一条 M 成本
- [ ] 5.3 阶段 5.4 死观测字段门禁本批后才具备上线条件（`lastEventAt` 现在有读者）
