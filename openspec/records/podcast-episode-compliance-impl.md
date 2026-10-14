---
record: podcast-episode-compliance-impl
task: 播客单集 compliance 三态标记主进程层（PRD §8.2 实现片，tasks 4.4b②）
date: 2026-10-14
---

## 本次执行记录：单集 compliance 三态标记主进程层（podcast-episode-compliance-impl，2026-10-14）

- 变更类型与隔离：**运行时代码变更**（`apps/desktop/electron/services/` 新模块 + `ipc-handlers/podcast.js` 接线 + `src/locales/` 清点式门禁扩域）⇒ 隔离 worktree `D:/Data/projects/mp-worktrees/mp-podcast-episode-compliance`，分支裸名 `podcast-episode-compliance-impl`。
- **分支名为什么改**：原用 `podcast-episode-compliance`，但那个名字已被 §8.2 合同片 squash 合并过 —— 复用被 squash 的分支名必致 `CONFLICTING` 且 CI 不调度 checks，故 `git branch -m` 到 `-impl`，旧提交打 tag `hold/pre-replay-59aa93e07` 保命（不删任何东西）。
- 合同依据：`PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md` §8.2（含 §8.2.8 取值面，由 #3562 合并 `c63933ebe` 写回实测）。

### 落地内容

| 落点 | 内容 |
| --- | --- |
| `services/podcast-episode-compliance.js`（新） | 闭集 `ok/invalid/stock`（第四态在出口抛）、只读重跑 `validateEpisode`、`stock` 需 `mimeSource==='stock'` **且** `index.stockStamp.at` 双凭据、非对象元素**原样透传**、`readStockStamp` 与固化宿主同用 `registry.resolveRoot()` |
| `ipc-handlers/podcast.js` | `episode:list` 追加式挂 `compliance`；旁路降级为「没有这个键」，不丢期、不让列表报错；只取**已解析**的 registry（旁路不得成为首次触碰 userData 的原因）；`deps.podcastEpisodeCompliance` / `deps.podcastFs` 注入 seam 沿用本文件既有 deps 风格 |
| `src/locales/podcast-error-codes.test.js` | §8.2.6 锁7 预告的扩域：`PRODUCERS` 纳入 `packages/shared-utils/src/podcast-rss.js`，harvest 前缀从只认 `PODCAST_` 放宽到引擎那族（实测新增 53 条命中、**缺文案 0**） |
| **刻意不做** | 四个 `podcast.compliance.*` UI 键 —— 渲染层还没有消费者，先加就是 AGENTS.md 禁的死键，随 4.5 UI 片同 PR 落；§8.2.7 的批量重校验/持久化/`stockStamp` 摘要 UI 也不在本片 |

### 证据

| 项 | 值 |
| --- | --- |
| 行为锁 | §8.2.6 七条**逐条有对应用例**：L1 闭集（输入矩阵 + 值域）、L1b 闭集出口可反证、L1b2 非对象原样透传、L2 三态形状、L2c reason 取自 locale 真源并与引擎逐字对账、L2d 校验器抛错兜底、L4 不猜存量、L5 判据同源结构锁、L6 追加式契约、L7 扩域自证 |
| 测试 | `podcast-episode-compliance.test.js` + `ipc-handlers/podcast.test.js` + `podcast-error-codes.test.js` = **40 passed / 0 failed**；消费者并集另含 `podcast-channel-service` / `podcast-stock-freeze-host` / `podcast-episode-stock-mime`（见下方回归行） |
| 变异反证 | **10 条全部指名红**，还原后 0 红、实现文件 md5 一致：M1 不看 stockStamp / M2 ok 透出 reason / M3 stock 填时刻 / M4 校验器外冒 / M5 丢期 / M6 本层自写判据 / M7 日志记标题 / M8 摘闭集出口 / M9 伪造非对象元素 / M10 由 reasons 反推合格 |
| QM-1 打包 | `pnpm run build` + `pnpm exec electron-builder --win --dir --publish never` rc=0；打包前 `verify-worktree-deps.js` OK（11 项消费方解析到本 worktree）；asar 151,594,421 字节内 `podcast-episode-compliance.js` 命中 **1**（该文件只在本片存在 ⇒ 产物归属自证）、其 `.test.js` 命中 0（测试不入产物）；`Multi-Publish.exe` 启动 9 秒存活、`Get-Process Multi-Publish` 计数 0→存活→0；**stderr 为空 ⇒ 按新三层判据判 PASS（第③层）**，不再用「未命中红线」当通过 |
| QM-6 前端（opencode） | **两条命中均已按证据处置**：① `null` 被 `map` 成 `{compliance}` 对象——是在列表里凭空造一行，正是「不丢期」的反面 ⇒ 改成非对象原样透传 + 日志计数，并补 L1b2 与变异 M9；② `ok` 由「有没有编码原因」反推而非信 `res.ok` ⇒ 改成只由 `res.ok===true` 得出，缺码时落兜底码，并补变异 M10。评审点名的 `STOCK_SOURCE` 同源性核实为**字面同值不同源**，已在本层注释显式声明「`'stock'` 只允许出现在这一处定义」。评审还点名一条**名不副实**的用例（我那条「不得建真 registry」其实测的是「缺 registry 不报错」）⇒ 已按它真正断言的东西改名，不保留夸大标题 |
| QM-6 后端（claude，42 分钟实跑） | **无 Critical，两条 Warning 逐条处置**：**W1 当场修**——我在注释里写「与固化层同源、不另写一份」，下一行却硬编码 `const STOCK_SOURCE = 'stock'`（固化层 `podcast-episode-stock-mime.js:23` 才是真源）。已改为 `require('./podcast-episode-stock-mime').STOCK_SOURCE`，并给 L5 结构锁补两条断言（必须 require 该模块 + 不得再出现 `const STOCK_SOURCE =`）；漂移症状是静默的：固化层改取值 ⇒ 本层永不判 stock ⇒ 存量整批翻 invalid。**W2 不改实现、写进合同**——冷启动首读早于异步固化落 `stockStamp`，那一轮存量期会显示 invalid；不修的三条理由已落 PRD §8.2.3（只读标记不阻断任何动作 / 消解它要么 await 违反 §7.9.7③要么改成形态猜凭据 / 另写分支即第二套 stock 判据），正解（固化宿主导出 in-flight、该轮省略 `compliance` 键）标明属独立一片。另两条 Info（`ok` 由 reasons 反推、`null` 被伪造成对象）与前端评审独立命中同一处，已在前一轮修掉。评审还点出我一条**名不副实**的用例（标题写「不得建真 registry」、实际只证「缺 registry 不报错」）⇒ 按它真正断言的东西改名 |
| 变异反证（W1 改后重算锚点重跑） | **10 条全部指名红**，还原后 0 红、实现文件 md5 一致：M1 不看 stockStamp / M2 ok 透出 reason / M3 stock 谎填时刻 / M4 校验器外冒 / M5 丢期 / M6 本层自写判据 / M7 日志记标题 / M8 摘闭集出口 / M9 伪造非对象元素 / M10 由 reasons 反推合格 |
| 真实进程 / 网络 | 除 QM-1 的一次打包产物启动外零真实出站；测试全部注入实现，`readStockStamp` 用假 `fsImpl`，且路径键由 `path.join` 现算（硬写 `/podcast/index.json` 在 Windows 下会让 `existsSync` 恒 false，把「读不到」测成「读到 null」） |

### 与合同的差集（不虚报）

- `tasks.md` 4.4b 只推进 **②**（`compliance` 增设 `stock` 档）；③「频道页摘要 + `podcast.stock.*` 三对键」、④「真的落进文件的变异反证」不在本片。
- §8.2.4 的徽标/浮层显示项属渲染层（4.5），本片只保证数据面到位；`state !== 'ok'` 的二次提示与 `stock` 不阻断出期由那片实现。
- §8.2.5 四对 locale 键本片**不写**（无消费者即死键）。

## 远程同步

| 远程同步 | PASS | merge SHA 95b18160a · 2026-10-14T12:52:45Z · 远端分支已删（ls-remote 0 行）· 同次提交删除 ledger 登记项 |
