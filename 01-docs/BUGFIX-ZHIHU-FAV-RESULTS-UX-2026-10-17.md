# BUGFIX：知乎收藏「改写失败用原文」不可诊断 + 结果区点击无反应（2026-10-17）

> 分支 `collected-results-fix`；关联 PRD：`PRD-ZHIHU-FAV-BATCH-2026-10-03.md` §4.3.6（按钮名同步锁）。

## 1. 现象（用户实测，同一轮操作里三个反馈）

1. 点「采集并改写」后出现采集结果，但进度行最后一行是「**改写失败用原文**」——**这是失败吗？为什么失败？**
2. 采集结果内容区域，**点击结果文字**（鼠标移上有链接点击状态）**没有反应**。
3. 结果条目上的 **【编辑】按钮**点了**没有反应**。

## 2. 根因溯源（逐条到第一性原因）

### 2.1 「改写失败用原文」—— 是「采集成功、改写失败」的降级，不是采集失败

**链路**（`apps/desktop/electron/ipc-handlers/zhihu-favlist.js`）：

```
zhihu-fav-batch:run
  → 逐条采集（成功）
  → rewriteOne()：POST python-backend /aggregation/rewrite
  → 失败（异常 / 空结果）⇒ rewritten=null ⇒ rewriteFailed=true ⇒ 保原文入库
  → done 进度事件 { rewriteFailed: true }
  → 渲染层进度行：collectOkRewriteFailNote（「改写失败用原文」）
```

**判读**：出现这条说明**该条采集本身成功了**（条目已在采集结果里），只是**自动改写那一步**失败、按设计回退原文（D2 合同）。不是白跑。

**为什么看不到原因**：`rewriteOne` 的调用方是 `catch {}` **空捕获**——真实异常（Python 后端没起的 `ECONNREFUSED` / 接口 500 / 返回空 `result_content`）被全部吞掉。三种原因对应三种用户该做的事（起后端 / 看后端日志 / 换风格重试），但界面上一律显示同一句话。

**第一性原因**：该 catch 是 D2 合同（失败回退原文）落地时顺手写的，当时把「回退」和「可诊断」当成了同一件事——**回退保住了功能，吞错埋掉了可诊断性**。

### 2.2 【编辑】点了没反应 —— 状态变了，视口没动

「编辑」按钮（`data-testid="result-view-*"`，文案 key `recordsEdit`，中文显示为「编辑」）emit `select` → 父级 `@select="collectedResult = $event"` → 页面上方的 **结果详情框**（`col-result-box`）出现/更新。

**功能其实是好的**——但详情框在页面**上方**，结果列表在**下方**；用户点列表里的按钮时，视口停在列表区，状态变化发生在视口外 ⇒ **感知为「没反应」**。

### 2.3 点结果文字像链接但没反应 —— 「假可点」

`card-info`（标题/元信息/徽标区）**没有绑定任何点击事件**，但继承了链接形态的光标样式 ⇒ 「看着能点」与「真能点」脱节。这是同一次修「编辑无反应」时应一并消除的假可供性（affordance）。

## 3. 逃逸分析（为什么没被拦住）

| 层 | 为什么没拦住 |
|---|---|
| 后端单测 | 只断言「失败 ⇒ rewriteFailed 计数 + 保原文」（Q26C/D2），**没有断言失败原因可带出**——吞错行为与断言兼容 |
| 组件锁 | 只断言「旧 testid 不出现」「入口逻辑不变」；**没有任何一条验证「点了之后用户的视口里发生什么」** |
| 像素门禁 | 详情框在初始态不渲染；点「编辑」后的形态不在基线截图序列里 |
| 可用性 | 「假可点光标」「点了视口不动」属于**可供性**维度——本仓机械判据全部围绕数据与结构，可供性目前无判据（与 zhihu-fav-step-hint 的教训同型） |

**系统性漏洞**：两次可用性回归（step-hint 的「沉默界面」、这次的「点了没反应」）都指向同一缺口——**「用户的反馈闭环」不在任何机械判据覆盖面上**。本轮按单条修，判据化（如「可点样式必须绑定事件」「状态变化必须有视口内可见反馈」）留作后续设计。

## 4. 修复

### 4.1 改写失败可诊断（后端 + 渲染层）

| 层 | 改动 |
|---|---|
| `rewriteOne`（zhihu-favlist.js） | 失败不再返回裸 `null`：接口异常 → `{ error: <message 截断 200 字符> }`；空结果 → `{ error: '改写接口返回空结果…' }`；成功 → 改写稿字符串（不带 `error`） |
| 调用方 | `catch {}` 删除；拿 `{ error }` 落 `item.rewriteError` + `log.warn`（带 url）+ done 事件 `result.rewriteError` |
| 进度行（BatchCollectPanel） | `res.rewriteError` 存在时追加「：原因摘要」；无原因保持原文案（不产生 `undefined` 脏尾） |
| 结果徽标（CollectedResultsList） | 失败徽标内联原因摘要 + `:title` 悬停全量；成功条目不得渲染失败徽标 |

### 4.2 「编辑」与卡片点击有可见反馈

| 项 | 改动 |
|---|---|
| 详情框锚 | `id="collected-result-box"`（采集页单实例；jsdom 可桩） |
| `selectCollectedItem(item)` | 选中 + `scrollIntoView({behavior:'smooth'})` + `col-result-box--flash` 一次性高亮（keyframes `col-result-flash`） |
| `CollectedResultsList` | `card-info` / `card-icon` 绑定 `@select`（与「查看」按钮同语义）并显式 `cursor:pointer`——**看着能点就真能点**；hover 时标题变主色 |
| 父级绑定 | `@select="selectCollectedItem"`（原来是裸赋值），结构锁防止改回去 |

## 5. 回归锁（TDD：RED → GREEN）

| 文件 | 锁 |
|---|---|
| `electron/ipc-handlers/zhihu-fav-batch.test.js`（+3） | 异常 → `item.rewriteError` 含真实错误关键字且 ≤200 字符 + done 事件带 `rewriteError`；空结果 → `rewriteError` 说明「空结果」；成功 → **不得带** `rewriteError`（防旧数据误标） |
| `src/features/collection/batch-collect-panel-behavior.test.js`（+1） | done 事件带原因 → 进度行含「改写失败用原文」**且**含原因摘要；无原因时不得出现 `undefined：` 脏尾 |
| `src/features/collection/CollectedResultsList.test.js`（+2） | 点卡片内容/图标 emit `select`；失败徽标内联 + `title` 带原因，成功条目无失败徽标 |
| `src/views/Collection.test.js`（+2） | `selectCollectedItem`：选中 + `scrollIntoView` 被调 + flash 类；**结构锁**：`@select` 必须绑 `selectCollectedItem`（防改回裸赋值） |
| `scripts/check-locale-button-name-sync.test.js`（新，6 例） | 引导文案按钮名同步锁（登记表形态），见 PRD §4.3.6 |

**读数**：后端 24/24；collection 全集 **16 文件 / 293 用例**全绿；新判据自测 6/6；对真实仓库 PASS。

## 6. 未闭合（不假装闭合）

1. **改写失败的**真实**线上原因**（这次用户遇到的具体是哪种）需要看后端日志确认——本次修的是「看不到原因」，不是「某个具体故障」。修复后重跑一次「采集并改写」，进度行会直接给出原因；若是 `ECONNREFUSED`，起 python-backend 即可。
2. **无真机验证**：滚动与高亮由 jsdom 断言覆盖，真实窗口的平滑滚动观感未验证。
3. **可供性判据化**未做（见 §3 逃逸分析最后一行）。
4. **像素门禁**对详情框出现后的形态无基线。
