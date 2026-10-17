# BUGFIX：勾「包含已采集（强制重采）」仍无结果（2026-10-18）

> 分支 `fav-force-recollect`；关联 PRD：`PRD-ZHIHU-FAV-BATCH-2026-10-03.md` §4.3.8。

## 1. 现象（用户实测，本轮第二次报同一处）

上一轮修完「去重跳过显示成完成」后，用户按提示勾选 **「包含已采集（强制重采）」** 再点「采集&改写」：

- 进度明细**仍然全部显示「完成」**
- 采集结果区**仍然 0 新增**
- 用户疑问：「怎么没生效」

## 2. 根因（三个独立缺陷叠加，缺一都表现为同一个现象）

### 2.1 「强制重采」只绕过了去重名单，没绕过内容缓存

`zhihu-fav-batch:run` 的 forceRecollect 只被用于两处：跳过 duplicate 判断（`!forceRecollect && (knownEntryMeta.has(url) || knownCollected.has(url))`）与覆盖时保留原 id。

但采集器 `UrlCollector.collect()` 有一道 **L6 内容缓存**（`ContentCache`，内存 LRU）：

```js
if (this._contentCache.hasUrl(url)) {
  return { success: true, reason: 'cache_hit', title: '', content: '' }  // 空壳
}
```

缓存命中返回**空壳**，`zhihu-favlist.js` 随即判 `unsubstantive` 失败（防空壳合同）。于是「强制重采」名义上生效、实际拿不到内容 ⇒ 用户勾了也没用。

**第一性原因**：`forceRecollect` 的语义是「别拿旧结果糊弄我」，但实现只覆盖了「去重名单」这一层，漏了「内容缓存」这一层。**凡是「强制刷新」类开关，必须核对每一层可能的复用点**（名单 / 缓存 / 进程记忆 / 磁盘快照），只堵一层就会出现「勾了没反应」。

### 2.2 采集失败的 done 事件只有 code，没有可读原因

失败时 sendProgress 是：

```js
{ ok: false, error: 'unsubstantive' }   // 或 'collect-throw' / 'missing-url'
```

既没有说明「是缓存命中还是真采不到」，渲染层也就无从解释。

### 2.3 渲染层完全没有 `ok: false` 分支 —— 失败被画成「完成」

done 分支当时只处理 `registerOnly` / `duplicate` / `rewriteFailed` 三种，其余一律落到默认 `doneNote`（「完成」）。**采集失败与采集成功在进度明细里完全同形。**

### 2.4（同场发现）收尾通知无条件报成功

`runZhihuFavCollectRewrite` 收尾是：

```js
notifySuccess('collection.collectSuccess')   // 无条件
```

即使 2 条全部失败，也弹「内容采集成功」。这是用户「显示完成但没结果」感知的第二个来源，且比进度明细更醒目。

## 3. 修复

| 层 | 改动 |
|---|---|
| `url-collector.js` | `collect(url, opts)` 支持 `opts.forceRefresh`：跳过 `ContentCache` 检查（`!opts.forceRefresh && hasUrl(url)`），其余限流/熔断策略不变 |
| `zhihu-favlist.js` | ① `collect(url, { manual: false, forceRefresh: forceRecollect })`；② 失败 done 事件带 `reason`：缓存命中说明 > 采集器自带 `error` > 兜底「内容不可提取」；③ 返回值同时带 `reason`（results 可追溯） |
| `BatchCollectPanel.vue` | ① done 分支新增**最高优先级** `res.ok === false` → `failedNote`（带 reason）/ `failedNoReason`；② 收尾通知分级：取消 → `cancelledNote`；有成功 → `collectSuccess`；全失败 → `allFailedNote`（warning）；全跳过 → `allSkippedNote`（info） |

### 新增 locale 文案（zh/en 成对）

| key（`collection.zhihuFav.*`） | zh | en |
|---|---|---|
| `failedNote` | 采集失败：{reason} | Collection failed: {reason} |
| `failedNoReason` | 采集失败（无详情，请查看日志） | Collection failed (no details; check the logs) |
| `allFailedNote` | 全部采集失败（{failed} 条），详情见进度明细与日志 | All {failed} item(s) failed to collect — see the progress details and logs |
| `allSkippedNote` | 这 {skipped} 条都已采集过，本次全部跳过（勾选「包含已采集」可强制重采） | All {skipped} item(s) were already collected — skipped this run (tick "Include collected" to force re-collection) |
| `cancelledNote` | 已取消采集 | Collection cancelled |

## 4. 逃逸分析（连续两轮同处失守）

| 层 | 为什么没拦住 |
|---|---|
| 后端单测 | 只锁「duplicate 默认跳过 + forceRecollect 重采」的结果计数，**没有断言 collect 收到的 opts**，所以「forceRecollect 是否穿透到缓存层」从未被验证 |
| 组件锁 | 只覆盖 `registerOnly`/`duplicate`/`rewriteFailed` 三条分支，**没有任何一条喂 `ok: false`**，默认分支的错误语义无人守 |
| 通知 | 收尾 notifySuccess 从未被断言过级别 |
| 可用性 | 「勾了开关没反应」属**开关语义穿透**维度——本仓机械判据目前只覆盖「文案/结构/数据」，不覆盖「开关是否真的穿透到每一层」 |

**系统性教训**：用户报「某开关没生效」时，不要只看开关那一行代码，要枚举该开关**语义上应该影响的所有层**，逐层核对是否真的读到了它。

## 5. 回归锁（TDD：RED → GREEN）

| 文件 | 锁 |
|---|---|
| `zhihu-fav-batch.test.js`（+4） | `forceRecollect` → collect 收到 `{manual:false, forceRefresh:true}`；未勾时不得带 forceRefresh；采集失败 done 事件带可读 reason（含采集器 error 原文）；cache_hit 空壳的 reason 说明「缓存」 |
| `url-collector.test.js`（+2） | `forceRefresh:true` 时即使 `hasUrl` 为 true 也走真实采集（不返回 cache_hit）；forceRefresh 缺省/false 时缓存照旧 |
| `batch-collect-panel-behavior.test.js`（+4） | done `ok:false` → 进度行含「采集失败」+ 原因且**不得以「完成」结尾**；无 reason → 兜底话术且不出现 undefined；整批全失败 → **不得调 notifySuccess**、必须给警告/错误；整批全跳过 → 不得报成功且提示 allSkippedNote |

**读数**：三个改动面 132/132；collection 全集 **16 文件 / 300 用例**全绿；locale 四项（`--keys` **2105**、成对、CJK、按钮名同步）PASS；eslint rc=0。

## 6. 未闭合（不假装闭合）

1. **用户这次的具体失败原因仍需真机复核**：修复后进度行会明确写出（缓存命中 / 采集器 error / 内容不可提取）。若为后两者，说明是知乎侧反爬或页面结构变化，需要单独定位采集器。
2. **无真机验证**：全部结论来自代码链路 + 组件级断言，真实窗口观感未截图。
3. **ContentCache 是内存 LRU**（非持久化）：跨会话重启后自然失效，所以「重启后仍失败」⇒ 不是缓存问题，务必以新进度行的 reason 为准。
4. **开关语义穿透**尚无机械判据。
