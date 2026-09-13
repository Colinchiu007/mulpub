# Bug 反思报告 — 热门选题列表被抓取失败清空且不可自愈（2026-09-14）

- 文档编号：BUGFIX-HOT-TOPICS-CACHE-CLEARED-ON-FETCH-FAILURE-2026-09-14
- 严重程度：P1（用户可见数据被清空 + 掉进空态后**不会自愈**，需人工干预）
- 影响范围：`apps/desktop/electron/services/hot-topics-service.js`（热门选题聚合服务）
- 关联 PRD：`01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md` §3.11 / §4.2 / §5.7 / §6.8 / §7.4 / §8（14-17）/ §9.1 / §9.5 / §10.8
- 修复分支：`mp-hottopics-video-e2e`

---

## 1. 现象与复现

**现象**：热门选题页在**网络抖动 / 渠道抓取超时**后，原本已经展示的选题列表被清空，页面掉进「暂无热门选题」空态；**即使网络随后恢复**，用户不手动点【刷新】列表也不会回来。

**实测复现（2026-09-14，本机 CDP 驱动真实实例）**：

1. 应用启动后进入 `/hot-topics`，缓存中已有 **138 条**选题（`hot-topics:get-cache` 返回 `data.topics.length === 138`）；
2. 由于宿主环境（机器高负载 + Chromium 网络栈每个请求固定 ~5s 开销）导致 8 个渠道全部在 10 秒 `AbortController` 超时窗口内失败；
3. 触发一次刷新后再读缓存 → `data.topics.length === 0`，`channelStats` 8 个渠道全为 `{ ok: false, error: "This operation was aborted", count: 0 }`；
4. UI 渲染为「暂无热门选题 / 点击刷新按钮获取最新选题，或等待自动刷新 / 立即刷新」。

**修复后（同环境同操作）**：`data.topics.length === 138`、`data.preservedStaleCache === true`、`data.fetchedAt` 保持为上一次成功抓取的时间；列表内容与「上次刷新」时间不变，仅在顶部出现「部分渠道获取失败：…」告警条。

---

## 2. ① 第一性原因溯源

**缺陷代码（修复前）**：

```js
const topics = allTopics.slice(0, MAX_TOPICS)
const newCache = { topics, fetchedAt, channelStats }
this._writeCache(newCache)      // ← topics 为空数组时，把用户已有选题覆盖成空
return newCache
```

**为什么会写成这样（第一性原因）**：

1. **把"本轮抓取结果"等同于"应当持有的最新状态"**：`fetchTopics` 的语义被默认成"刷新 = 用最新结果替换旧结果"。这对**增量型数据源**成立，但对**聚合型榜单**不成立——抓取失败时"最新结果"根本不存在，此时的空集是**缺失信息**，不是**真实状态**。
2. **缺少"失败态"这一维**：返回结构只有 `{ topics, fetchedAt, channelStats }`，`channelStats` 记录的是**渠道级**成败，没有任何字段表达**整体结果的可用性**；调用方（渲染层 `refresh()`）因此只能看到 `topics: []` 并按"真的没有选题"渲染。
3. **`fetchedAt` 被无条件推进**：即使本轮零结果，`fetchedAt` 也写成 `Date.now()`。这让 10 分钟 TTL 认为缓存"新鲜"，`fetchTopics({ force: false })` 在 TTL 窗口内**直接命中这份空缓存返回**（`fromCache: true`）——不但清空了数据，还顺手关闭了唯一的自动恢复通道（30 分钟定时刷新走的是非 force 调用）。**"清空 + 假新鲜"叠加，才使空态真正不可自愈。**
4. **写缓存是单向覆盖，没有"降级保留"概念**：`_writeCache` 只有"覆盖"一种语义，没有"仅在拿到有效结果时覆盖"的约束。

---

## 3. ② 测试逃逸分析（逃逸链）

| 层级 | 是否有覆盖 | 为什么没拦住 |
|------|-----------|-------------|
| 单元测试 | ⚠️ 有覆盖，但**没覆盖这个组合** | `hot-topics-service.test.js` 覆盖了：单渠道失败不阻塞其它渠道（`channel failure does not block other channels`）、缓存读写 fail-closed、去重、限流/熔断。但**没有一条用例让"全部渠道同时失败"且"上一份缓存非空"**——即"零结果 × 非空缓存"这个组合从未被构造过 |
| 集成测试 | ❌ 无 | 无"抓取失败后渲染层应展示什么"的整合断言 |
| E2E | ❌ 无 | `tests/e2e/**` 无热门选题抓取失败场景 |
| 视觉回归 | ❌ 无 | 视觉测试只断言"空态能画出来"，不断言"该不该是空态" |
| 人工验证 | ❌ 漏过 | 开发环境网络通常良好，且失败往往只影响部分渠道（有告警条但列表仍在），**全渠道同时失败**才触发，属低频路径 |

**逃逸原因分类**：`测试组合缺口`（关键的是"全失败 × 有旧缓存"这个笛卡尔积，而不是单渠道失败）+ `需求缺口`（PRD §3.7 只规定了"失败不自动重试"，未规定"失败是否可以销毁已有数据"）+ `显示层缺口`（无字段区分"真没有"与"没抓到"）。

---

## 4. ③ 系统性漏洞定位

| 缺陷类型 | 具体文件 | 系统性缺陷 |
|----------|---------|-----------|
| 需求缺口 | `PRD-HOT-TOPICS-MODULE-2026-09-11.md` §3.7（修复前） | 只写了"超时 10 秒、失败不自动重试（熔断器计数）"，**没有一条数据生命周期规则**说明"抓取失败时既有缓存如何处置"——文档留白 → 实现自由发挥 |
| 契约缺口 | `hot-topics-service.js` 返回结构 | 无"结果可用性"字段（`fromCache` 只表达"来自缓存"，不表达"缓存是陈旧的且本次抓取失败"） |
| 测试缺口 | `hot-topics-service.test.js` | 缺少"零结果 × 非空缓存"的组合用例（同类组合缺口还有：零结果 × 渠道全 skipped） |
| 复用缺口 | 其它聚合型数据源 | 本项目多个模块都做"抓取→缓存"（热门选题、采集、视频克隆历史等），**没有统一的"抓取失败时缓存降级"约定**，同类缺陷可能散落多处 |
| 门禁缺口 | CI | 无"缓存写入必须显式声明降级策略"一类的静态检查 |

---

## 5. ④ 修复 + 回归保护测试

### 5.1 修复方案（最小改动，单一判定点）

在 `fetchTopics()` 的汇总段、写缓存之前插入**保留判定**：

```js
const topics = allTopics.slice(0, MAX_TOPICS)
const previous = Array.isArray(cache.topics) ? cache.topics : []
if (topics.length === 0 && previous.length > 0) {
  const preserved = {
    topics: previous,
    fetchedAt: cache.fetchedAt,     // 保留旧时间 → 下次非 force 调用仍会重试网络
    channelStats,                   // 本轮真实结果，供 UI 展示失败渠道
    preservedStaleCache: true,
  }
  this._writeCache(preserved)
  this.log.warn && this.log.warn('[hot-topics] all channels failed; preserved ' +
    previous.length + ' cached topics (stale) instead of overwriting with an empty list')
  return preserved
}
```

语义变化（详见 PRD §3.11 / §5.7 / §6.8）：

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 全渠道失败 + 旧缓存非空 | 缓存被清空、`fetchedAt` 推进为当前时间、UI 空态、TTL 内不再重试 | 缓存保留旧 `topics` 与旧 `fetchedAt`、打 `preservedStaleCache` 标记、UI 内容不变 + 告警条、下次调用继续重试 |
| 全渠道失败 + 旧缓存为空 | 写空结果 | **行为不变**（写空结果，无保留标记） |
| 部分渠道成功 | 正常覆盖 | **行为不变**（正常覆盖，无保留标记） |
| 全渠道被限流/熔断跳过 | 缓存被清空 | 与"全渠道失败"同等处理（`skipped` 不产生选题，同样保留） |
| 渲染层 | — | **零改动**（`refresh()` 已按 `res.data.topics` 渲染；告警条按 `channelStats` 计算） |
| i18n | — | **零新增 key** |
| IPC 契约 | — | 仅新增**可选**字段 `preservedStaleCache`（仅在保留分支出现） |

### 5.2 回归保护测试（已落地）

**文件**：`apps/desktop/electron/services/hot-topics-service.test.js`（Vitest，与实现同仓）

| # | 用例名 | 断言要点 |
|---|--------|---------|
| 1 | `全渠道失败时保留上一次的非空缓存，不用空列表覆盖` | 返回 `topics.length === 2` 且内容为旧的 `['A','B']`；`fetchedAt === 1700000000000`（旧值不变）；`preservedStaleCache === true`；**落盘的** `setSetting(CACHE_KEY, ...)` 内容 `topics.length === 2` 且标记为 true；`channelStats.zhihu.ok === false` 且 `error` 如实为 `This operation was aborted` |
| 2 | `缓存本就为空时，全渠道失败仍写入空结果（不产生伪标记）` | `topics === []`；`preservedStaleCache` 为 `undefined`；`fetchedAt > 0` |
| 3 | `部分渠道成功时正常覆盖缓存（保留新结果，不加保留标记）` | 结果为新的 1 条 `新选题`；旧缓存 `旧选题` 被替换；无 `preservedStaleCache` |
| 4 | `全渠道被限流/熔断跳过时同样保留旧缓存（skipped 不等于成功抓取）` | 全渠道 `skipped: true` → 保留旧缓存且 `preservedStaleCache === true` |

**运行**：`cd apps/desktop && pnpm exec vitest run electron/services/hot-topics-service.test.js` → **32 passed**（含上述 4 例）。

---

## 6. ⑤ 预防措施（已落地）

1. **PRD 补全数据生命周期（需求层闭环）**：新增 §3.11「抓取失败时的缓存韧性」（R1-R8 规则表 + 非目标）、§4.2 追加 3 条校验（保留判定/字段完整性/不得伪造新鲜）、§5.7 完整流程与 4 条时序不变式、§6.8 保留态交互与显示项 + 6 条边界情况、§7.4 提示文字（明确"不新增 key"）、§8 追加验收标准 14-17、§9.1 追加用例清单、§10.8 实现要点与三条"为什么这样做"的反面论证。
2. **测试固化（代码层闭环）**：上述 4 条用例进 CI（随 desktop shards 跑），覆盖"零结果 × 非空缓存"与"零结果 × 全跳过"两个组合。
3. **失败必须可见（可观测性闭环）**：保留分支输出 `warn` 日志 `all channels failed; preserved N cached topics (stale)`；`preservedStaleCache` 字段供诊断与测试断言使用。
4. **经验沉淀**：本条与"聚合型数据源抓取失败时，空结果是缺失信息而非真实状态；`fetchedAt` 不得在零结果时推进"一同进入项目长期记忆与 `01-docs/learnings.md`。

---

## 7. 验证记录

| 项 | 命令 | 结果 |
|----|------|------|
| 目标用例（RED→GREEN） | `cd apps/desktop && pnpm exec vitest run electron/services/hot-topics-service.test.js` | 修复前 28 passed（新 4 例未写）→ 修复后 **32 passed** |
| 真实实例验证（CDP） | `hotTopicsFetch({ force: false })` 在 8 渠道全失败时 | `topics.length === 138`、`preservedStaleCache === true`、`fetchedAt` 保持旧值 |
| 渲染层验证 | `window.location.hash='#/hot-topics'` 后读 DOM | 列表非空（138 条），未出现 `[data-testid="hot-topics-empty"]` |
| CI | GitHub Actions `quality-gate.yml` | 见 PR |
