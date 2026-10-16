---
pr: PENDING
branch: fix-account-interval-ghost-wait
date: 2026-10-16
---

# 本次执行记录：发布频率「本账号间隔」幽灵等待修复（fix-account-interval-ghost-wait，2026-10-16）【混合 PR】

> task: 账号 10+ 小时未发布仍被「（本账号间隔）」阻塞——时钟倒挂守卫（未来时间戳钳位 + 写入闸 + UI 归因）

| 项 | 内容 |
| --- | --- |
| 变更类型 | 🐛 Bug 修复（发布频率控制 / 时钟与数据校验）→ 完整质量节拍 + 隔离 worktree |
| 计划文档 | `01-docs/PLAN-FIX-ACCOUNT-INTERVAL-GHOST-WAIT-2026-10-16.md` |
| 远程同步 | PENDING |

## 根因（QM-5 ①）

`publish-interval-guard.js` 的 `_remaining()` 无条件信任 `publish_timeline` 里的时间戳：
`remaining = accountMinMs − (now − lastTime)` 只防「已过期」侧，**未防时间戳落在未来**。
本机时钟快进（本仓实测先例：`INVESTIGATE-LOGIN-QR-SLOW-2026-09-25.md` 记录过共享时钟被快进约 7 小时）期间
`recordPublish()` 把「快进时钟下的提交时刻」落盘；时钟恢复后 `now − lastTime < 0` ⇒
`remaining = minInterval + |倒挂差|`，表现为**远超 5 分钟、随倒挂时长线性放大的幽灵等待**。

**第一性引入 commit（git log -L 取证）**：`_remaining` 随 PublishIntervalGuard v1 引入
（`git log -L '/_remaining (key, minInterval, now) {/,/^  }/:packages/shared-utils/src/publish-interval-guard.js'` 显示该函数自初始提交 `publish-frequency-control`（#2773 家族，v1 间隔闸）起即为「无条件信任时间戳」形态，后续 v2/v3/v4 只改数值与抖动、未改信任假设）。补证命令输出见提交内记录。

## 逃逸分析（QM-5 ②）

| 层 | 为什么没拦住 |
| --- | --- |
| 单元测试 | `publish-interval-guard.test.js` 的时间类用例全部用**过去时间戳**单侧样本，未来侧零覆盖（测试场景缺失） |
| 集成测试 | guard 集成夹具的 `now`/store 同源，无法暴露「写入时刻与判定时刻跨时钟域」 |
| E2E/视觉 | 不覆盖时长量级与时钟场景 |
| 代码审查 | `Math.max(0, …)` 被误读为已防御负数（实防「已过期」，未防「未到期」的未来时间戳） |

## 系统性漏洞（QM-5 ③）

「时间差判定」类测试缺少 **elapsed<0 反向样本**的机械规则——已落为 learnings 判据
（`pitfall:future-timestamp-in-interval-store-becomes-ghost-wait`）。

## 修复 + 回归保护（QM-5 ④）

| 层 | 文件 | 修法 |
| --- | --- | --- |
| 守卫读侧 | `packages/shared-utils/src/publish-interval-guard.js` | `_remaining()` 对 `elapsed < 0` 判时钟域损坏：等待**钳位到最多一个完整 accountMinMs**（与 I2「请求已发生就占窗口」对齐，消除无限阻塞）、出声告警（同键去重）、记入 `_futureTimestampKeys`；时钟恢复后自愈清除（非粘滞）；`check()` 返回值附加 `clockAnomaly` |
| store 写侧 | `apps/desktop/electron/services/store/rate-limit-store.js` | `setPublishTimeline` 拒绝 `timestamp > Date.now()+60s` 落盘并出声（60s 容差防临界竞态误伤） |
| 进度 store | `apps/desktop/src/stores/publishProgress.js` | 透传 `clockAnomaly`（默认 false，缺席不猜） |
| UI | `PublishProgressTaskRow.vue` + locales zh/en | `clockAnomaly===true` 时追加「（时钟异常，等待已钳位）」归因标签；缺席/为假不渲染 |

**测试（TDD，先红后绿）**：
- `packages/shared-utils/tests/publish-interval-guard-clock-anomaly.test.js`（新文件 8 例 C1–C8）：未来时间戳钳位精确值 / 告警去重 / 无粘滞自愈 / `clockAnomaly` 形状 / jitter 上界 / 正常路径不误伤 / 诊断 getter / 注入时钟落盘。
- `store-owner-isolation.test.js` 追加 3 例（S1 拒未来 / S2 容差内放行 / S3 正常不回归），真实 SQLite 夹具。
- `PublishProgressPanel.test.js` 追加 2 例（U1 标签渲染与缺席不渲染 / U2 zh·en 成对键）。
- `publish-interval-guard.test.js` 4 处 `toEqual` 形状断言同步 `clockAnomaly: false`（契约变更）。
- `index.d.ts`：`PublishIntervalVerdict.clockAnomaly` + `futureTimestampKeys`（d.ts 契约锁触发后补齐）。

**测试读数**：shared-utils 全量 1055 passed / 10 skipped；桌面受影响面（PublishProgressPanel + publishProgress + store-owner-isolation + publish IPC）144 passed。

**变异反证（逐条实跑，判定取输出 `Tests N failed`，非探针空读）**：
- M1 摘掉钳位分支 ⇒ C1 `Tests 1 failed` ✅；还原后 C1 passed。
- M3 摘掉 store 未来值拦截 ⇒ S1 `Tests 1 failed` ✅。
- M4 摘掉 UI 标签条件 ⇒ U1 `Tests 1 failed` ✅；还原后 `clockAnomalyLabel` 出现 3 处（computed + 模板 v-if + 插值）。
- M2（告警去重）由 C2 断言「只告警一次」直接承载，未单列变异（C2 在 M1/M3 之外的实现细节上已可红——如实记录）。

## 预防措施（QM-5 ⑤）

1. `01-docs/learnings.md` 已沉淀 `pitfall:future-timestamp-in-interval-store-becomes-ghost-wait`（判据：时间差判定测试必须含 elapsed<0 反向样本）。
2. 新测试文件常驻 CI（shared-utils workspace 收集域），未来侧样本不再缺位。
3. d.ts 契约锁随新公开面扩展（`clockAnomaly` / `futureTimestampKeys`）。

## 数据校验与流程补充（PRD 同步要点）

- **校验**：`elapsed < 0` ⇒ 异常；`timestamp − Date.now() > 60_000` ⇒ 写入拒绝。
- **流程**：check → 钳位等待（≤1 间隔 ×(1+jitter)）→ 任务按原频控路径重排；无粘滞——时钟恢复后下一次 check 即按真实 elapsed 判定。
- **显示**：blocked 行 = `等待 N 分钟后重试` + 原归因标签 + （命中时）`（时钟异常，等待已钳位）`；日配额文案优先级不变。
- **提示文字**：主进程 warn `[PublishFrequency] 间隔键 <key> 的时间戳 <ts> 落在未来（当前 <now>），本机时钟疑似快进/回拨；等待钳位到单个间隔，请校准系统时间或使用紧急放行`；store 侧 `拒绝写入未来时间戳 publish_timeline[<key>]=<ts>（时钟疑似异常，容差 60000ms）`。
- **用户处置**：①校准系统时间；②设置页紧急放行（既有入口，每账号每日 1 次）；③等待 ≤1 个间隔自然过期。
- **登记债务（本 PR 不做）**：`publish_timeline` 中已存在的未来时间戳历史行不自愈回写——自动改写时间戳属第二写入口且错误方向是「少等」，需独立评审。

## 门禁读数

| 门禁 | 读数 |
| --- | --- |
| TDD（先红后绿） | C1–C8 首跑 6 红 / S1 红 / U 组先实现后绿（实现与测试同批，UI 部分无独立 RED 现场——如实登记） |
| shared-utils 全量 | 1055 passed / 10 skipped |
| 桌面受影响面 | 144 passed |
| QM-1 打包 | `build:dir` rc=0；启动验证 `spawnSync + buildChildEnv`（剔除 ELECTRON_RUN_AS_NODE，本机父环境实测带该变量）：SIGTERM@8s、**stderr 0 字节**、stdout 20616 字节 ⇒ 判通过（三层判据） |
| 变异反证 | M1/M3/M4 各 1 红，均逐字节还原 |

## 保留门禁

- 行尾对账：见提交时 `git diff --numstat` 两口径核对（执行时补记）
- 品牌残留：无竞品名（本文「参考产品」口径不涉及）
- 文档同步：PRD V4 补「时钟倒挂守卫」节、PRD 2026-10-02 A12 第三态、CHANGELOG（见 PR diff）
- 远程同步 PENDING
