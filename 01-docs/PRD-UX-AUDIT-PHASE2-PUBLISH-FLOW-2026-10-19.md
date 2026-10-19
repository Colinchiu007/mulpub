# PRD — UX 审计落地·阶段 2「发布主流程确定性」批次 E–G（2026-10-19）

- 上游审计：`01-docs/UX-AUDIT-2026-10-17.md`（finding 编号 `audit-*` 与 §5 排期表均指向该文）
- 排期出处：同文 §5「阶段 2：发布主流程确定性（1.5–2 周）」的 2.1 / 2.2 / 2.3 / 2.4 / 2.5 五行
- 本文状态：**2.1 的 ①③ 已实现、2.2 / 2.3 / 2.4 / 2.5 / 2.6 已实现**；2.1 的 ②（小图生成与缓存）与 2.7 / 2.8 待办，其契约在 §7 先行写明（避免下一个会话重新设计）
- 姊妹文档：阶段 0/1 的落地契约见 `01-docs/PRD-UX-AUDIT-IMPLEMENT-2026-10-18.md`（该 PR 与本 PR 相互独立，均以 `UX-AUDIT-2026-10-17.md` 为唯一上游）

## 1. 本批要解决的问题（一句话版）

发布主链路上的「确定性」缺失：用户看不出任务在跑还是卡了、看不完的列表被当成"记录丢了"、
首屏把互不依赖的接口排成一队、后台通知在加载期间整条丢失、封面取数把主进程事件循环冻结。

## 2. 显示项清单（逐条写明"显示什么 / 什么时候不显示"）

### 2.1 发布历史页（`PublishHistory.vue`）

| 显示项 | 判据 | 缺席时 |
|---|---|---|
| 记录卡片 | `filteredRecords` 的前 `RENDER_LIMIT = 200` 条 | 一条都没有时走既有空态（区分「无记录」与「筛选无结果」，后者给「清空筛选」动作） |
| **渲染上限提示行** | 仅当 `hiddenRecordCount = filteredRecords.length − 200 > 0` 时出现；`role="status"`、`data-testid="history-render-limit-hint"` | 不出现（≤200 条时不该有这句话） |
| 封面缩略图 | 该卡片**进入视口 ±240px** 后才向主进程取数；取到前预览位显示平台图标，取到后替换 | 未进视口 ⇒ 不发请求（这正是消除的浪费） |
| 行内派生值 | 标题 / 类型 / 发布人 / 时间 / 状态 / 审核 / 送达 / 失败原因 / 指标 / 可点性，一律从 `rowMeta` 查表 | 查不到 ⇒ 该行未被渲染（超出上限） |

提示文案（zh）`historyPage.renderLimitHint`：
「为保证滚动流畅，本次只渲染前 {shown} 条；还有 {hidden} 条符合条件但未显示，请缩小筛选范围或用上方分页继续加载。」
（en）：「Showing the first {shown} of them to keep scrolling smooth; {hidden} more match your filters but are not rendered. Narrow the filters or use pagination above to load more.」
两条必须成对（CI Gate 7 `check-locale-sync.js`）。
为什么这句话不可省：计数行说的是「筛选命中多少条」（真话），而列表只画 200 条；
没有这行，用户会把「列表到此为止」读成「我的记录只有这些」。

### 2.2 发布进度面板（`PublishProgressPanel.vue`）

| 显示项 | 数据源 | 规则 |
|---|---|---|
| 「成功 {succeeded}/{total}」 | `aggregate.succeeded / total` | **终态口径**，与旧版一致 |
| 「· N 个失败」/「· N 个已取消」 | `aggregate.failed / cancelled` | >0 才出现 |
| **「第 {current} / 共 {total} 项」** | `aggregate.step / total` | 仅当 `aggregate.running > 0`；全部落终态后整行消失 |
| 进度条宽 + `aria-valuenow` | `aggregate.progressPercent` | 软权重口径（见 §3.3），范围 0–100 |
| 顶部药丸「发布中 d/t」 | `aggregate.done / total` | **保持终态口径**，不随进度条改 |

zh 文案 `publishPage.publishProgressPanel.summaryStep` = 「第 {current} / 共 {total} 项」；
en = 「Item {current} of {total}」。

## 3. 功能逻辑与数据校验
### 3.1 筛选防抖（audit-61 a）
- 七个筛选源按**固定顺序**登记为单一数组 `FILTER_SOURCE_ORDER`：关键词、发布人、内容类型、状态、发布模式、平台、日期。
  顺序即契约：各命名访问器（`debouncedQuery` … `debouncedDate`）按下标取值，**增删筛选必须同时改这张表和访问器**，
  否则静默错位（下标读错不会报错，只会把"平台"当"日期"筛）。
- `filteredRecords` 只读防抖快照，不再读原始 ref；输入框本身仍即时回显（防抖只作用于列表收敛）。
- 防抖窗口由既有 `useDebouncedWatchSources` 持有（300ms），本批不新造第二份防抖实现。

### 3.2 行内派生值查表（audit-61 b）
- 每行渲染原先要对同一记录调用约 20 次格式化函数（部分函数内部还跑正则与多次协议判据）。
- 现按 `record.id` 预计算一张 `rowMeta`（Map），模板只做 O(1) 查表；
  `metaFor(record)` 在查不到时返回空对象（唯一成因是该行未被渲染）。
- **刻意不进表的例外**：`metricValue(record.views)` 这类只对单个已存在字段做数字/占位格式化的调用，
  成本与一次属性读取同量级；把它们塞进表会造出"第二份真相源"（字段变了表就陈旧）。
- 展示值纯映射本身另抽为 `composables/usePublishHistoryRowFormat.js`，状态判据抽为
  `utils/publish-record-status.js`（两份消费者共用，避免视图内出现隐形顺序耦合）。

### 3.3 聚合进度软权重（audit-14）
单一实现 `stores/publish-progress-aggregate.js`：

```
权重(任务) = 1                    若 phase ∈ terminalPhases（success/failed/cancelled）
           = 0                    若 phase = queued
           = min(0.95, percent/100) 若 percent 是 >0 的有限数
           = 0.05                 其余（percent 缺失 / null / 负数 / 非数字串）
progressPercent = round(Σ权重 / total × 100)，total=0 时为 0，且恒 ≤ 100
step = min(total, done + (running > 0 ? 1 : 0))
```

三条不可破：
① `done` 只数终态（"已完成"必须是真完成数）；
② 软权重上限 0.95 —— 跑到 100% 但未落终态时条子**不得贴满**，否则"卡在 100%"看起来像完成；
③ percent 非法不抛、不 NaN，只给"确实开始了"的最小可见量，也不反推成 100。
`terminalPhases` 由调用方（store）传入，本模块不自立第二份相位真源
（相位枚举的「三处同步」判据见 AGENTS.md / `publish-stage-map.test.js`）。

### 3.4 首屏并行化（audit-63）
- 三个视图的 `onMounted` 内，互不依赖的数据源改由**同一个 `Promise.allSettled` 批**发起：
  - `Publish.vue`：账号目录 / 预检偏好（草稿页签时含草稿列表）
  - `Collection.vue`：采集列表 / 改写结果 / 改写策略 / 内容类别 / 平台目录 / 账号
  - `PodcastChannelView.vue`：频道元信息 / 单集列表 / RSS 端点
- 判据：**就绪时间是最大值而不是之和**。任一源失败只让对应区块停在默认值，不整页报错；
  `Publish.vue` 对每个被拒的源 `console.warn` 一条（allSettled 自身不抛 ⇒ 不逐条出声就是把失败读成"没有数据"）。
- `Collection.vue` 的**策略预览**改到批次之后触发（原先它与 fire-and-forget 的策略加载抢跑）。

### 3.5 后台通知不丢（audit-64）
`AutomationView.vue`：`onAutomationNotification(...)` 的注册必须在 `await load()` **之前**。
否则首屏加载期间到达的失败/恢复通知因监听器尚未挂上而整条丢失（用户侧表现为"失败了但没提示"）。

### 3.6 封面取数不再冻结主进程（audit-34）
- `electron/services/cover-cropper.js` 的 `readImageAsDataUrl` 改为 `await fs.promises.readFile`，
  并**去掉 `fs.existsSync`**（既是又一次同步 stat，又挡不住 TOCTOU；读失败就是"文件不存在"的现场）。
- `electron/ipc-handlers/publish.js` 的 `cover:read-data` handler 必须 `await` 该函数。
- 错误文案语义保持：ENOENT ⇒ `'图片文件不存在'`；**不得**把 `ENOENT: no such file or directory, open 'D:\...'`
  原样透出（AGENTS 维 13：内部路径/原始 message 不得直出）。
- 渲染侧 `useHistoryCoverThumbnails` 改可见区驱动：`observeCover(el, record)` 绑在卡片预览元素上，
  IntersectionObserver 报告进入视口（`rootMargin: '240px'` 预取）才发请求；
  已取过/在途 ⇒ 不再发；元素卸载即 `unobserve`。
  **无 IntersectionObserver 的环境（jsdom/老宿主）退回立即加载** —— 这条退路是产品取向
  （看不见判据时宁可全量也不能不出图），也因此既有视图用例行为不变。

## 4. 实测基线（audit-34 要求的前置测量门槛，本机 Windows / Node v24.19.0）

单张读取耗时 p50（页缓存预热，12 样本）：3MB≈2ms、8MB≈5ms、32MB≈19ms。
扇出时**主进程最长冻结**（`perf_hooks.monitorEventLoopDelay`，resolution=1ms）：

| 档 | 同步实现 wall / 最大冻结 | 异步实现 wall / 最大冻结 |
|---|---|---|
| 200 × 3MB | 396ms / **397ms** | 268ms / 168ms |
| 1000 × 3MB | 1946ms / **1947ms** | 1856ms / 1373ms |
| 200 × 8MB | 1416ms / **1417ms** | 914ms / 752ms |
| 50 × 32MB | 1451ms / **1452ms** | 933ms / 750ms |

结论（三条，不外推）：
1. audit-34 的机制**成立且实测可见**：同步形态下整批读盘 + base64 是一段不可中断的冻结，
   200 张 3MB 就是 0.4 秒、1000 张接近 2 秒 —— 期间其他标签与正在进行的发布任务的 IPC 全部排队。
2. 异步化在**现实扇出**（≤200，即本批加的渲染上限）下把冻结压到约 1/2.4，但在 1000 并发下仍有 1.37s
   —— ⇒ **「别为看不见的行取数」（③）才是承重的那一步**，异步化（①）是必要但不充分。
3. 定级保持 **major**：既不上升为 blocker（单张读只有几 ms，"1000 次"在开了渲染上限与可见区驱动后
   不再可达），也不下降。小图缓存（②）仍未做，预期收益是把每档再降一个数量级（3MB → 约 20KB）。

⚠️ 方法论留痕（这是本批最重要的一条测试侧教训）：第一版探针用 `setInterval(5ms)` 自计相邻 tick 间隔，
同步档报出 **maxTickGap = 0.0ms** —— 那不是"没冻结"，是**探针根本没被执行**：
N 个已 resolve 的 promise 让 `await` 只在微任务里续体，定时器相位从未轮到，`clearInterval` 前那次大间隔没人记录。
换成 `monitorEventLoopDelay` 才有上表。凡"读到一个漂亮的 0"，先问探针能不能区分两种状态。

## 5. 验收标准（每条都有可执行锁，见 §6）

1. 输入筛选关键词时输入框立即回显，列表在防抖窗口后才收敛；≤200 条时不出现上限提示行。
2. 筛选命中 >200 条时，列表只画 200 条并显示"另有 M 条未显示"。
3. 首屏加载期间的后台失败通知不丢（监听注册先于任何 await）。
4. 三个视图的独立数据源并行发起：快源的开始落在慢源的结束之前。
5. 单任务发布期间进度条随阶段推进，不再全程 0%；未落终态时最高 95%；「第 N / 共 M 项」只在有在跑项时出现。
6. `cover:read-data` 不再包含同步读原语；封面只对进入视口的卡片取数。

## 6. 回归锁与反证（逐条实跑，还原后 md5 与基线一致）

| 编号 | 变异（把改动退回坏形态） | 实测 |
|---|---|---|
| M1 | 防抖旁路（读原始 `searchQuery`） | 只红「立即回显 / 防抖后收敛」1 条 |
| M2 | `RENDER_LIMIT` 改为极大 | 只红上限提示 1 条 |
| M3 | `hiddenRecordCount` 恒 0 | 只红上限提示 1 条 |
| M4 | `metaFor` 不查表而自带字段 | 6 条行为用例红（证明表真的被消费） |
| M5 | 模板一处绑定改回逐行函数调用（**渲染结果逐字相同**） | 只红接线锁 ⇒ 证明行为锁测不到这一格 |
| M6 | `rowMeta` 键改名 | 死键锁 + 2 条行为红 |
| M7 | 封面输入退回全量 `filteredRecords` | 「未渲染的行不去取封面」红 |
| M8 | Podcast 退回「channel 先 await」 | 恰好并行行为锁红（44 passed / 1 failed） |
| M9 | Publish 把 `allSettled` 换成 `for…await`（行为不变） | 只红源码契约锁 |
| M10 | Collection 把采集列表移出批改回独占 await | 两条 Collection 判据同时红 |
| M11 | 可见区守卫摘掉（整列表预取回来） | 2 条红（含"绑定时不取数"） |
| M12 | 视图删掉 `:ref="observeCover"` 绑定 | 2 条装配锁红 |
| M13 | `readImageAsDataUrl` 改回 `readFileSync` | 结构锁红 |
| M14 | `progressPercent` 退回终态计数 | 软权重 3 条红 |
| M15 | 面板条子宽度退回 `done/total` | 面板行为锁红 |
| M16 | 步数行 `v-if` 放宽到 `total > 0` | 「running 归零即消失」红 |

两条反证过程的自我纠错（写下来以免下一个会话重犯）：
- 死键锁第一版只认 `key:` 形态，把 ES6 简写 `icon,` 报成死键 ⇒ **修锁不改生产代码**。
- 否定式结构锁会被**注释里的散文**点红（"原先 `await loadCollectedItems()` 独占首屏"）⇒
  所有断言统一跑在剥掉整行注释后的同一份文本上，正例负例同一个域。

## 7. 阶段 2 剩余项的契约（先写明，避免重新设计）

- **2.1 ②（待办）**：`cover-cropper.js` 生成并缓存小缩略图。契约：落点 `userData/cover-thumbs/<sha1(原路径+mtime)>.jpg`，
  目标宽 ≤320px、体积上限（可 env 覆盖，非法值回落默认并出声告警）；命中缓存 ⇒ 不再读原图；
  缓存目录必须有保留窗口与回收（不得无限增长）；IPC 需新增"取小图"档位而**不得**改变现有 `cover:read-data` 的返回形状
  （`useCoverPreview` 等既有消费者依赖它）。
- **2.7（待办）**：toast 规范单点化（`useNotify.js` 的 `duration` 上限 + 分组；非 error 级 key 未命中出声告警；
  直接 `ElMessage` 的调用点按文件收编并加基线棘轮）。
- **2.8（待办）**：首屏体量。实测读数（本批 `vite build`）：`index.js` 1,402.17 kB（gzip 459.02 kB）。
  手段见 audit-62：CSS 按路由切分 / 只载当前语言包 / `SettingsDialog`+`PublishProgressPanel`+`BackToTop` 改异步组件。

## 8. 未覆盖与残留风险

1. **首屏并行的判据强度不对称**：`PodcastChannelView` 有真挂载的并行行为锁；
   `Publish.vue` / `Collection.vue` 只有源码契约锁（原因与代价写在 `src/views/firstPaintParallel.contract.test.js` 文件头）。
   这两个契约锁**看不见**"并行批里某个源内部又串行"。
2. **小图缓存未做** ⇒ 每张封面仍走全尺寸 base64，IPC 载荷与 CPU 未减（见 §7）。
3. `cover:crop` 有一条自 PR #1174 起就恒失败的真实缺陷（`readImageAsDataUrl` 从不返回 width/height，
   `normalizeRect` 因此恒判「图片尺寸无效」）。它不在审计清单里、也与本批不同变量，已单列任务跟踪；
   本批在 `cropImageFile` 里留了指向它的注释而**没有**顺手改——混在一个提交里会让 M13 的归因失效。

## 9. 批次 H：发布前摘要确认闸门（2.6 / audit-1）

审计的 w1 复核已确认「批量发布其实有确认闸门」并把 audit-1 从 blocker 降为 major；
本项补的是**单篇通用路径**：点「发布」时看不到"发到哪几台、每台几个账号、内容会不会被截断"，
只能发完再回头看。原语复用统一通知通道 `useNotify().notifyConfirm`（与敏感词确认同一通道），
不是再造一套弹窗。

### 9.1 位置（不可挪）
全部校验（标题/正文/平台/账号/元数据/平台级内容转换）与截断计算都完成之后、
`progress` 重置与任何写操作（敏感词预检、自动封面、`publishBatch`）之前。
理由：摘要里说的截断必须就是待发出的那一份；放在派发之后等于"通知"而不是"闸门"（用户没有否决时机），
放在截断之前则说的是一件还没发生的事。顺序由回归锁用 `invocationCallOrder` 钉住。

### 9.2 显示项与文案（zh 原文，en 见 locale 文件）
| 行 | 何时出现 | 文案 |
|---|---|---|
| 摘要行 | 恒有（解析失败时整道闸门跳过） | 将把 {articles} 篇内容发布到 {platforms} 个平台、共 {targets} 个「平台 × 账号」目标。 |
| 明细行 | 至少有一个平台时 | 明细：{detail}（形如 今日头条 × 2 · 知乎 × 1，用平台显示名，不得直出内部 id） |
| 截断行 | 仅当**真的发生过截断**（应用级或平台级） | 其中 {count} 项内容会被截断后发出（各平台上限不同）。 |
| 标题 / 按钮 | 恒有 | 确认发布 ／ 确认发布 ／ 再看看（en：Confirm publishing / Publish / Not now） |

弹窗类型 `warning`。取消（点「再看看」/ ESC / 遮罩）⇒ 不派发、`publishing` 由 finally 复位（按钮不会永久禁用），
页面状态保持原样（不清进度）。

### 9.3 计数口径（`utils/publish-confirm-summary.js`，纯函数）
- `platformCount`：去重后的平台数。
- `targetCount`：去重后的 (平台, 账号) 目标数 —— 同一账号发到两个平台算两个目标，同平台两个账号也算两个；
  缺 `accountId` 归入默认目标而非丢弃；脏输入（非数组、空 platform、null 项）一律不抛。
- 明细顺序 = 首次出现顺序（渲染稳定，不随 Set 迭代序漂移）。
- **只数不说**：本模块不持有任何中文文案；连接符用中点而非顿号，
  因为渲染端 src 非 locales 文件新增中文字面量会被 `check-locale-sync --cjk` 点名
  （本批实测就是被自己新加的 `console.warn` 撞红的，见 §10）。

### 9.4 失败取向：放行不堵死
摘要行解析不出来（locale 键缺失）时：**跳过闸门继续发布**并 `console.warn` 一条 ASCII 日志。
理由：一个文案键的缺失不该让用户点不动「发布」；与之相对，`notifyConfirm` 自身在文案为空时返回 false，
若照它默认语义会变成"永远取消发布" —— 所以判断必须走在它前面，而不是把空串递给它。

### 9.5 反证（批次 H，四条，逐条实测红、还原 md5 一致）
| 编号 | 变异 | 实测 |
|---|---|---|
| M17 | 整道闸门删除 | 4 条红（含两条本批新锁） |
| M18 | 取消后仍继续派发（`if (!confirmed) return` 变成空操作） | 取消锁 + 既有「敏感词取消不发布」红 |
| M19 | 解析失败改为 fail-closed（直接 return） | 接线锁红 |
| M20 | 截断行无条件输出 | 纯函数拼接锁 + 零目标明细锁红 |

### 9.6 一条被本批撞红的既有锁（不是它坏了，是它太宽）
`usePublishFlow.test.js` 的「敏感词接口缺少 data 时按无敏感词处理」原写作
`expect(ElMessageBox.confirm).not.toHaveBeenCalled()`。闸门上线后它必然红——
但它要证的从来只是"没有**敏感词**弹窗"。已改为按弹窗文案指名过滤，
而不是放宽成"允许一次 confirm"（后者会把敏感词回归整个吃掉）。
