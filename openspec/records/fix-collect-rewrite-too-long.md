---
record: fix-collect-rewrite-too-long
task: 采集页「一键改写」对超长正文（知乎回答 6766 字 > 引擎 6000 码点上限）只弹兜底「AI 改写失败」；修复为漏斗处按码点截取前 6000 字并明确提示，同时把引擎业务错误归一化到顶层、映射稳定文案码
date: 2026-10-19
---

## 本次执行记录：长文改写截断 + 引擎业务错误可诊断（fix-collect-rewrite-too-long，2026-10-19）

> 本文件为执行记录（唯一强制载体，见 `openspec/records/` 新形态）。
> 状态列不手写远程同步状态词：合并一旦发生，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 隔离 worktree `mp-worktrees/mp-fix-collect-rewrite-too-long` + 裸分支 `fix-collect-rewrite-too-long`（基于 `origin/main` `131c0fff6`）；共享根未做任何代码写入。入口说明：`start-mp-task.ps1` 在 `git fetch origin` 处因网络重置失败（rc=128），按同一隔离机制改用 PowerShell 原生 `git worktree add -b … origin/main` 建 worktree（未在共享根落盘），依赖 `pnpm install --frozen-lockfile` + `ensure-electron` + `verify-worktree-deps` 全绿 |
| 第一性原因（QM-5 ①） | ✅ | 采集正文 6766 码点 > 引擎 `_validate` 上限 6000 ⇒ `TOO_LONG`；失败时段 `model_provider_logs` 无记录（LLM 未被调用）。第一性引入点 #3915：采集页 stealth 分支从 Python 聚合层切桌面引擎，错误字段由平铺 `{code,message}` 变为嵌套 `{code:0,data:{success:false,error,errorCode}}`，消费点未同步归一化 |
| 逃逸分析（QM-5 ②） | ✅ | 单元：`Collection.test.js` 的 aiRewrite mock 只有成功信封与顶层 `{code:-99,message}`，无「`code:0` + `data.success:false` + `errorCode`」形状，也无 >6000 输入；集成：无「IPC 信封 → 用户文案」契约测试；审查：#3915 注释写「透传原始 res（含 errorCode/message）」，字段实际在 `data` 内，注释描述的是旧契约 |
| 系统性漏洞（QM-5 ③） | ✅ | ① 四个改写调用点共用的漏斗无输入长度守卫（确定性拒绝留给引擎）；② 引擎业务错误没有单一归一化出口，各消费方自行猜测字段位置；③ 长文无补救路径（结果区原文 readonly），用户即使知道超限也无法精简 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 见「§修复」与「§自测块」；变异反证：禁用截断 ⇒ 1 例红；回退「原样透传信封」⇒ 2 例红 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① `01-docs/learnings.md` 顶部 3 条教训（兜底文案先逆查格式化链 / 换链路必须重测错误字段位置 / 双消费者常量结构锁）；② `01-docs/BUGFIX-COLLECT-REWRITE-TOO-LONG-2026-10-19.md`；③ CHANGELOG 顶部条目；④ 本执行记录 |
| 行尾与 diff 对账 | ✅ | 提交后取证：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐档相等（见自测块） |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → `OK: 全部测试均已接线或按欠账登记`（域内 108 个测试文件） |
| QM-1 打包 | ✅ | 改动含渲染层 + `packages/rewrite-engine`（主进程消费包）；`pnpm run build:vue` rc=0；`pnpm exec electron-builder --win --dir --publish never` rc=0（产物 `apps/desktop/dist-electron/win-unpacked`）；未改 `apps/desktop/electron/**` |
| QM-2 代码必检项 | ✅ | 无同步阻塞原语、无新增 IPC、无 `v-html`、无硬编码等待；错误信封形状与既有 `__error` 消费方（`formatUserError`）一致；长度上限保留在引擎（单一真源），渲染层只做同值结构锁；截断按 Unicode 码点、不劈开代理对 |
| QM-4 视觉回归 | N/A（有据） | 未改模板/样式/DOM；新增提示走既有 toast 通道（`collection.rewriteTruncated`），默认视图不渲染新元素；`build:vue` 产物正常 |
| QM-6 CCG 双模型外部评审 | QM6_PLACEHOLDER | QM6_EVIDENCE_PLACEHOLDER |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词、不为收口另开 PR |

## QM-5 五步（详细）

### ① 根因溯源

| 序 | 事实 | 证据 |
|---|---|---|
| 1 | 用户操作：采集页输入知乎回答链接点「一键改写」，采集成功后弹「AI 改写失败」 | 用户报障（2026-10-19 07:37）+ 应用日志 `shared-user-data/logs/app-2026-10-19.log:8135-8152` |
| 2 | 日志链：`collect-start-browser`（23:33:23）→ `collect-ok` `contentLen: 6766`（23:33:54）→ `collection.collectSuccess`（23:34:05/12）→ `collection.rewriteFailed {"error":"AI 改写失败"}`（23:34:32） | 同上 |
| 3 | 该 URL 采集条目正文 6766 码点（UTF-16 同值），与日志 `contentLen` 一致 | 应用 SQLite `settings` 表 `collected_items`（键含当前用户哈希） |
| 4 | 对照样本：同链路 5899 字智源文章 23:26:32 改写成功（`model_provider_logs` id 9953，LLM latency 8010ms） | 模型与鉴权正常，差异只在输入长度 |
| 5 | 失败时段 `model_provider_logs` 无任何记录 ⇒ LLM 未被调用 | 失败发生在引擎入口校验，而非模型调用 |
| 6 | 引擎 `_validate`：`[...content].length > MAX_INPUT_CHARS(6000)` ⇒ `{success:false, errorCode:'TOO_LONG', error:'内容过长，最多 6000 字'}` | `packages/rewrite-engine/src/rewrite-engine-core.js:316-317` |
| 7 | 采集页漏斗把整个 IPC 信封透传：`return { __error: res }`；`formatUserError` 只读顶层 `input.errorCode/message` ⇒ 回落到 `collection.rewriteFailed`「AI 改写失败」 | 修复前 `Collection.vue` 失败分支 + `apps/desktop/src/utils/user-facing-error.js` |
| 8 | 本地实跑（真实引擎源码）：6766 字 → `TOO_LONG`；5899 字 → `success:true` | 定向探针 |

第一性原因一句话：**采集正文超过引擎硬上限被拒（数据层），而采集页把「嵌在 data 里的业务错误」当顶层错误透传（表达层），两层叠加后用户只看到兜底文案。**

### ② 逃逸链（按测试层级）

| 层级 | 为什么没拦住 | 证据 |
|---|---|---|
| 单元（渲染层） | `Collection.test.js` 的 aiRewrite mock 只有 `data.success:true` 与顶层 `{code:-99,message}`；「`code:0` + `data.success:false` + `errorCode`」这一形状从未被建模，>6000 输入也没有用例 | 修复前测试文件通览 |
| 单元（引擎） | `TOO_LONG` 自身有测试（PRD-REWRITE-WORD-COUNT-CONTROL），但没有任何测试把「引擎错误如何变成用户文案」串起来 | `packages/rewrite-engine` 测试通览 |
| 集成 | 无「IPC 信封字段位置 → formatUserError 文案」契约测试；两个契约在接缝处裸奔 | 无对应用例 |
| 代码审查 | #3915 的注释写「失败时透传原始 res（含 errorCode/message）」——作者以为字段在顶层；#3823「改写失败可诊断」是 Python 聚合层平铺错误时代的口径，未随链路切换更新 | #3915 / #3823 记录与源码注释 |

### ③ 系统性漏洞定位

| 分类 | 具体漏洞 |
|---|---|
| 输入守卫缺失 | 四个改写调用点共用的 `rewriteViaEngine` 只在空内容时拦截；长度上限只存在于引擎侧，确定性拒绝一路走到用户面 |
| 错误契约未归一化 | `ai:rewrite` 业务错误嵌在 `data` 里，消费方各写一套（`RewriteView` 读 `data.error`、`HotTopics` 读顶层 `message`、采集页整体透传）；没有单一归一化出口，也没有契约测试 |
| 长文无补救路径 | 结果区原文 textarea 为 `readonly`，一键改写是「采集 + 改写」一步完成，用户没有「先精简再重试」的交互位 |

### ④ 修复 + 回归保护

| 修复项 | 落点 | 回归锁 |
|---|---|---|
| 超长自动截取（按 Unicode 码点，不劈开代理对） | `apps/desktop/src/utils/rewrite-engine-limits.js`（41 行）；`Collection.vue:664-676` 漏斗入口截断 + `collection.rewriteTruncated` 提示 | `Collection.rewrite-input-limit.test.js` 5 例：6766 → 送引擎 6000 且提示 6766/6000/截取、原文不变；6000 不截断；引擎 TOO_LONG → 具体文案；归一化稳定码；IPC 层错误不误伤 |
| 引擎业务错误归一化 | `apps/desktop/src/utils/rewrite-engine-error.js`（40 行）；`Collection.vue:707-715` 失败分支 | `rewrite-engine-error.test.js` 8 例：TOO_LONG/SENSITIVE_CONTENT/EMPTY_RESULT/LLM_ERROR/NO_LLM_CLIENT/EMPTY_CONTENT 映射、未知码透传、data 缺失防御、formatUserError zh/en 端到端 |
| 上限单一真源 | 引擎 `MAX_INPUT_CHARS`（`rewrite-engine-core.js:20-23`）；渲染层同值常量 | `rewrite-engine-limits.test.js` 结构锁：读引擎源码比对常量值，并要求 `_validate` 引用常量、禁止写死 `len > 6000` |
| 文案 zh/en 成对 | `locales/user-errors/{zh,en}.js` 新增 `REWRITE_CONTENT_TOO_LONG` / `REWRITE_CONTENT_SENSITIVE`；`locales/collection/{zh,en}.js` 新增 `rewriteTruncated` | `user-facing-error.test.js` 新增 3 例（含两表键存在性）；locale pair/keys 门禁 PASS |

变异反证（防装饰性测试）：

- **变异 A**：`prepareRewriteInput` 的条件改为恒真（禁用截断）⇒ `Collection.rewrite-input-limit.test.js` **1 failed / 4 passed**（6766 字用例当场红）；恢复后 5/5 绿。
- **变异 B**：`rewriteViaEngine` 失败分支回退为「整信封透传」⇒ **2 failed / 3 passed**（TOO_LONG 文案与归一化两例红）；恢复后 5/5 绿。

### ⑤ 预防措施（全部落到文件）

1. `01-docs/learnings.md` 顶部 3 条教训：`兜底文案出现先逆查格式化链`、`换链路必须重测错误字段位置`、`双消费者常量必须结构锁`。
2. `01-docs/BUGFIX-COLLECT-REWRITE-TOO-LONG-2026-10-19.md`：症状/证据链/根因/修复/回归/遗留。
3. `CHANGELOG.md` 顶部条目（问题 / 改动 / 验证三段，验证为实跑数字）。
4. 本执行记录。
5. 机制层面：渲染层常量与引擎常量由测试结构锁对齐——以后改上限只改一处就会被测试拦住。

## 自测块（提交前当场跑，禁止预填结论）

```
cd apps/desktop && pnpm exec vitest run \
  src/utils/rewrite-engine-limits.test.js src/utils/rewrite-engine-error.test.js \
  src/utils/user-facing-error.test.js src/views/Collection.rewrite-input-limit.test.js
→ Test Files 4 passed (4) / Tests 54 passed (54)

cd apps/desktop && pnpm exec vitest run src/views/Collection.test.js src/utils/rewrite-lineage.test.js
→ Test Files 2 passed (2) / Tests 129 passed (129)

cd packages/rewrite-engine && pnpm exec vitest run
→ Test Files 14 passed (14) / Tests 194 passed (194)

变异 A（禁用截断）→ Collection.rewrite-input-limit：1 failed | 4 passed
变异 B（回退信封透传）→ Collection.rewrite-input-limit：2 failed | 3 passed
eslint（8 个改动文件）→ exit 0
node .github/scripts/check-locale-sync.js --pair-base origin/main → PASS
node .github/scripts/check-locale-sync.js --keys → PASS（2122 个 key）
node .github/scripts/check-max-lines.js → ✅ 无新增超大文件，挂账清单一致
node scripts/check-unwired-tests.js → OK（108 个域内测试文件）
cd apps/desktop && pnpm run build:vue → ✓ built in 45.49s
cd apps/desktop && pnpm exec electron-builder --win --dir --publish never → rc=0
```

## 遗留（不假装已闭合）

- 其它 `aiRewrite` 消费方（改写页 `RewriteView`、热门选题 `HotTopics`、`AiWriterPanel`）仍各自解释错误字段；本次只修采集页漏斗。`rewrite-engine-error.js` 可直接复用，收敛到单一出口属于后续独立改动。
- 截断是产品取舍：一键改写对超长正文恢复可用，但只覆盖前 6000 码点；全文改写需「分段改写后合并」方案（成本与前后文一致性风险需单独 PRD）。
- 用户当前运行的应用来自旧 worktree `mp-app-live2`（f7595a066）：本刀合并后仍需完全退出并重启应用才能生效。
- 失败通知比采集成功晚约 20s，该时段无 LLM 调用记录；时间差来自渲染/IPC/日志链路，未进一步归因（不影响根因判定）。
