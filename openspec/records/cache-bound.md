---
record: cache-bound
task: R11 审计面「真实无淘汰缓存」的收口 —— 2 条有界化 + 2 条确认有界
date: 2026-10-18
branch: cache-bound
---

## 本次执行记录：LLM 改写缓存有界化（cache-bound，2026-10-18）【混合 PR】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`（含 `apps/desktop/electron/` 运行时代码）
- 保留门禁：行数门禁 ✅ ｜ 品牌残留 ✅ ｜ 远程同步 由门禁推导

### 任务来源

上轮（`risk-closeout`）把 R11 审计面从 2 条修正到 13 条后，其中 4 条被判为
「真实无淘汰缓存、登记待评估」。本轮按质量节拍推进该未闭合项。

### 逐条取证（不靠名字猜）

| # | 声明 | key 空间 | 结论 |
| --- | --- | --- | --- |
| 1 | `story2video-image-retry.js` `llmRewriteCache` | **原始 prompt 的 SHA-256** ⇒ 用户每写一个新 prompt 就是新 key | ⚠️ 无界 |
| 2 | `story2video-image-retry.js` `llmRewriteCallCount` | 同 #1（同一个 cacheKey）| ⚠️ 同源 |
| 3 | `story2video-paths.js` `_lastImportedMediaGcByBaseDir` | baseDir，注释明说「生产仅单 baseDir 场景」| ✅ 有界 |
| 4 | `tag-suggest/compliance-filter.js` `_blocklistCache` | `dataDir \|\| __dirname/../tag-suggest-data` 单一默认值 | ✅ 有界 |

关键证据（#1/#2）：声明上方注释**自承**「模块级，仅单次运行内有效」—— 作者明知不跨进程，
但没定上限；而 Electron 主进程**常驻**（不随单次生成任务结束重启）⇒ 单调增长。

### 修法：插入序上限（不是 LRU）

`Map` 天然按插入序迭代 ⇒ 超出上限删 `map.keys().next().value`（最早那条）。
**刻意不用 LRU**：缓存价值与"最近是否用过"无关（同一 prompt 短期内集中触发，
要么早已命中、要么已无意义），LRU 的 `get` 时重排反而会让"偶尔复用的老 prompt"被误删。

```js
const LLM_REWRITE_CACHE_MAX_ENTRIES = 500
function setWithInsertionBound (map, key, value, maxEntries) {
  if (!map.has(key) && map.size >= maxEntries) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}
```

三处刻意的设计：
1. **`!map.has(key)` 守卫** —— 已存在的 key 不得触发淘汰，否则同 key 复用会断；
2. **两个 Map 共用同一常量** —— 漏一个等于没锁（回归锁第 2 例专测）；
3. **上限 500** —— 一次生成任务的 prompt 数远小于 500，正常使用永不触发淘汰；
   只有"同一进程内长期生成大量不同 prompt"才淘汰最早那批，而那批复用价值早已趋零。

### 语义不变性取证

- **读路径一行未动**：`has` → `get` 命中直接返回、`if (result)` 才写入，全部保留
- 只有两个 `set` 调用点换成 `setWithInsertionBound(...)`
- 既有 vitest `story2video-image-retry.test.js` **49/49 全绿**（真实跑过，不是推断）

### 回归锁（新增 4 例，先红后绿）

`apps/desktop/tests/story2video-llm-cache-bound.test.js`：

| # | 夹具 | RED | 作用 |
| --- | --- | --- | --- |
| 1 | 上限常量存在且被引用 ≥3 次（定义 + 两 Map）| ✅ 红 | 两处不同步即红 |
| 2 | 两个 Map 的写入路径都引用该常量 | ✅ 红 | 漏一个即红 |
| 3 | 缓存收益三片段仍在（`has` / `get` / 成功仍写入）| 绿 | 「不得破坏」型 |
| 4 | 淘汰用插入序 + `!map.has(key)` 守卫 | ✅ 红 | 防止误删正在复用的 key |

第 2 轮修正过两个夹具缺陷（都是夹具自身的错，不是实现的错）：
- `SRC` 路径多写了一层 `apps` ⇒ ENOENT（4 例全红但原因不对）
- 例 3/4 锚定旧写法 `llmRewriteCache.set(...)` ⇒ 改为锚定 `setWithInsertionBound` 的实现语义

### 验证

| 项 | 读数 |
| --- | --- |
| 新回归锁 | **4/4 全绿** |
| 既有 vitest | `story2video-image-retry.test.js` **49/49** |
| r3 真实仓下界 | `17/17`，读数 `R11 34 / 11` |
| CLI 八锁 | `PASS` rc=0，`R11 34 / 11`、`R7 独立映射=0` |
| `check-unwired-tests` | rc=0（新测试在 `apps/` 域由 vitest 自动收集）|

**R11 审计面 13 → 11**：这两条不再报"有写无清"（因为它们**现在**有 delete 了）。

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 未改 `apps/desktop/electron/` 之外；且改动是纯 JS 内存逻辑，不触碰打包面（`electron/` 主入口、`rpa-engine`）均未改。**已核**：`node --check` rc=0 |
| QM-2 代码必检项 | ✅ | 无新增 IO/网络/同步密集原语；`setWithInsertionBound` 是 O(1) |
| QM-4 视觉 | **N/A** | 无 UI |
| QM-6 双模型评审 | 见 PR | 按 CCG 判定器结果 |
| 远程同步 | 由门禁推导 | change `gate-record-sync-derived-status` |

### 未闭合（本轮后）

| # | 项 |
| --- | --- |
| 1 | R11 剩余 11 条已逐条分类登记（derived §4.2），其中 9 条可接受、2 条本轮处置 |
| 2 | 审计面是否该有"人工登记豁免表"（像 `loading-machine-exemptions.js`）—— 上轮选"不改判据、改文案"，维持 |
| 3 | 正则/除号判定仍是启发式（JS 词法固有歧义，不可消除）|
