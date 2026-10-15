# Design — fix-article-paragraph-zhihu-publish

本 change 一次承载两条**独立缺陷**的修复。两条的取证方式、修复层级、回归形态都不同，故本文分 A / B 两线各自成章，最后给出共用契约、测试策略与已知边界。

---

## 0. 一句话结论

| 线 | 一句话根因 | 修复层级 |
|----|-----------|---------|
| A | 富文本编辑器把**纯文本**当 **HTML** 装载，换行在 HTML 语义里是**可忽略空白** ⇒ 段落**在装载那一刻**就塌成一整段并回写进 `article.content` | 渲染层（编辑器装载），**早于**发布链 |
| B | 成功判据用 `/\/p\/\d+/`，而**草稿编辑页** `/p/<id>/edit` 同样命中 ⇒ 只落草稿也报成功；且知乎发布是**两段式**，旧实现只点一次 | RPA 平台脚本的成功判据 + 补点流程 |

---

## 1. Bug A 根因链（逐条取证）

### 1.1 先证明「修复在跑」，把「没生效」与「不在代码里」切开

| 判据 | 证据 |
|------|------|
| 修复提交在运行构建里 | 运行中的 Electron 来自 worktree `mp-app-live2`（tip `fe9f41879`）；`git merge-base --is-ancestor 2bb7c2b9a fe9f41879` ⇒ rc=0（是祖先） |
| 模块解析到该构建的源码 | `require.resolve('@multi-publish/api-publish-engine/src/publish/platforms/baijiahao-article.js', {paths:[…/mp-app-live2/apps/desktop]})` 解析到该 worktree 的 `packages/api-publish-engine/src/publish/platforms/baijiahao-article.js`，其 `:152` 即 `params.set('content', formatArticleBody('baijiahao', withTopics))` |
| 真走 API 轨 | 日志 `PublisherRouter route-selected {platform: baijiahao, mode: api}`；整段仅 3.1 秒、无任何 RpaView 窗口日志 |
| 链路能产出多段 | 用**同一份**引擎源码 + 同一篇源文调 `BaijiahaoArticleChain.buildArticleFormData` ⇒ **6 个 `<p>`** / 1097 字符 |

⇒ 代码路径正确、修复在生效的构建里，**矛盾点只可能在「送进这条链路的正文已经不是多段」**。

### 1.2 平台产物 vs 源文（决定性对账）

| 取样 | 字符 | `\n` | 自然段 | 公开页 `<p>` | 公开页 `<br>` | 平台正文字符 | 逐字节对账 |
|------|------|------|--------|--------------|---------------|--------------|-----------|
| 本次（2026-10-15 20:40，postId `1879119523718680476`） | 1075 | 10 | 6 | **1** | 0 | 1055 | `源文去掉全部 \n == 平台正文` ⇒ **True（1055 == 1055）** |
| 前作（2026-10-09，postId `1878588576245723518`） | 863 | 8 | 5 | **0**（裸文本节点） | 0 | 855 | 同上为 True |

源文取自 `shared-user-data/multi-publish.db` → `rewrite_history.rewritten_content`（本次 `id=mv9izcxt37xlxqcq`，`created_at=2026-10-15T12:39:00.929Z`，6 段：106 / 214 / 263 / 220 / 135 / 122 字符）。

两条推论：① 平台**确实**消费了我们 `content` 字段里的标签（否则不会从「裸文本」变成「`<p>` 包裹」）；② 我们送去的 HTML 里**只有一个 `<p>`** —— 段落结构在我们这一侧就已经不存在了。

### 1.3 装载那一刻发生了什么（逐行实证依赖版本）

`apps/desktop/src/components/ArticleEditor.vue`：

```vue
<QuillEditor v-if="editorMode === 'rich'" v-model:content="richContent" content-type="html" … />

const richContent = computed({
  get: () => props.modelValue,      // ← 纯文本原样喂给 content-type="html" 的富文本组件
  set: (val) => emit('update:modelValue', val),
})
```

`@vueup/vue-quill@1.5.3` 的 `dist/vue-quill.esm-bundler.js`：

| 步 | 源码位置 | 行为 |
|----|---------|------|
| 1 | `:255` `setContents(props.content)` | 组件就绪后把 `modelValue` 灌入编辑器 |
| 2 | `:405-406`、`:427-429` | `contentType === 'html'` ⇒ `setHTML()` ⇒ **`quill.root.innerHTML = 值`**（按 HTML 解析） |
| 3 | HTML 语义 | `第一段\n\n第二段` 里的换行是**可忽略空白** ⇒ 整篇塌成一个文本节点 |
| 4 | `:257` `quill.on('text-change', handleTextChange)` + DOM MutationObserver | Quill 把 root DOM 解析回自己的模型并触发 `text-change`（**无需用户输入**也会触发） |
| 5 | `:336-341` `handleTextChange` | `ctx.emit('update:content', getHTML())` |
| 6 | `:423-425` `getHTML()` | 回写的是 `quill.root.innerHTML` —— 此时已是**单段 HTML** |
| 7 | `richContent.set` | `emit('update:modelValue', 单段 HTML)` ⇒ `article.content` 变成单段 |
| 8 | 发布链 | `formatArticleBody('baijiahao', '<p>全篇</p>')` 命中「已是 HTML」⇒ **幂等透传**（这一步本身没错） |
| 9 | 平台 | 收到 1 个 `<p>` ⇒ 公开页 1 个 `<p>` |

**引入点**：`get: () => props.modelValue` 来自 `08e7d95a66`（2026-09-04，`P1-M7 Markdown input + per-platform format adaptation` 把富文本模式接到 Quill 的 `content-type="html"`）。⇒ 该缺陷自 2026-09-04 起一直存在。

### 1.4 为什么 2026-10-12 的修复不可能生效

那次（`#3389` / `2bb7c2b9a`）改的是「**已经多段**的内容在 HTML 承载平台上如何表达」（纯文本 → `<p>` 包装）。本次取证的链路里，正文**在进入链路之前**就已经是一段。**修复层级在事故之后** —— 这是本 change 最重要的一条认知，也是前作 PRD §14 亲手写下的遗留（「若真机复核发现段落仍被合并，需按产物 HTML 反推平台期望形态」）的答案：**平台形态没问题，是我们自己的编辑器先把段落吃掉了**。

---

## 2. Bug B 根因链（逐条取证）

### 2.1 真机日志与记录字段（同批发布）

```
12:40:19.645Z RpaView [click] button:has-text('发布'), .PublishPanel-publish → BUTTON|Button … 发布
12:40:22.662Z RpaView [zhihu] published!
12:40:22.664Z RpaView publish done platform=zhihu url=https://zhuanlan.zhihu.com/p/2094165753981309631/edit
12:40:22.744Z PublisherRouter rpa-publish-ok {platform: zhihu, mode: dom, url: …/p/2094165753981309631/edit}
12:40:22.746Z PublishProgress phase-success {platform: zhihu, stageKey: done, hasResult: true}
```

- 应用内：**显示发布成功**（进度 `done`、发布记录写入）
- 发布记录：`tracked_content` 的知乎那条 `post_id = ''`（**空**）、`url = https://zhuanlan.zhihu.com/p/2094165753981309631/edit`
- 平台实际状态：稿子只是**草稿**（停在 `/edit` 页）

### 2.2 两个缺陷叠加

```js
await this._click(win, pubBtn)          // 只点一次
await this._sleep(3000)
const curUrl = win.webContents.getURL()
if (curUrl.includes('success') || curUrl.includes('publish') || curUrl.includes('article')
    || /\/p\/\d+/.test(curUrl)) { … return { success: true, url: curUrl } }   // ← 假成功入口
```

1. **判据过宽**：`/\/p\/\d+/` 与 `https://zhuanlan.zhihu.com/p/<id>/edit`（**草稿编辑页**）匹配 ⇒ 只落草稿也判成功；另有 `curUrl.includes('publish')` / `includes('success')` / `includes('article')` 三个更宽的子串判据。
2. **只点一次**：知乎发布是**两段式** —— 首次点「发布」只是「把稿子落成草稿并跳到该编辑页」，需在**该编辑页再点一次「发布」**才会真正发布并跳公开文章页 `/p/<id>`。
3. **第二个假成功出口**：`panelGone` 兜底（发布按钮消失/隐藏即判成功）——它同样可因「发布设置面板弹出把原按钮遮住」而误判，本次一并删除。

### 2.3 逃逸链（本次逃逸的核心）

2026-09-29 的同族修复（`d424c245c`，PR `#2647`）自己写了一条**把缺陷锁成契约**的测试：

```js
it('发布成功判定包含知乎 /p/<id> 文章 URL 模式（实测发布后跳转 zhuanlan.zhihu.com/p/xxx）', async () => {
  const { win } = createZhihuWindow('https://zhuanlan.zhihu.com/p/2088256436652589762/edit')  // ← 夹具就是 /edit
  …
  expect(result.success).toBe(true)   // ← 把「草稿页 = 成功」写成了期望
})
```

| 层 | 为什么没拦住 |
|----|-------------|
| 单元测试 | **写反了**：夹具用草稿编辑页 URL，断言却要求 `success === true` ⇒ 缺陷被固化成契约，后续任何改动都不会让它变红 |
| 集成测试 | 无「真机 URL 序列（`/write` → `/p/<id>/edit` → `/p/<id>`）」的驱动用例；mock 的 `getURL` 是固定值 |
| 端到端 | 无「发布后回查公开页 HTTP 200 / 标题可读」的判据 |
| 发布记录 | `post_id=''` 是**可观测的异常信号**，但没有任何判据消费它（记录层只存不判） |
| 代码审查 | 「`/p/<id>` 是文章页」这一命名看起来天经地义，审查者不会去质疑 URL 语义 |
| 真机复核 | 2026-09-29 的记录写「实测发布后跳转 `zhuanlan.zhihu.com/p/xxx`」，但**没有区分 `/p/<id>` 与 `/p/<id>/edit`** ⇒ 观测本身不精确 |

---

## 3. 决策记录

### 决策 1：Bug A 修在**装载侧**，不回退去改发布链

- **选它**：事故点是「内容进入链路之前」，修装载侧才能让 `article.content` 本身正确，所有下游（发布链、发布记录、复制/导出）一起受益；且**与发布链同判据**（同一份原语）把「渲染端」与「引擎侧」绑成一个契约。
- **不选方案 B（富文本模式改 `content-type="text"`）**：段落能留住，但**静默丢弃用户富文本格式**，HTML 承载平台能力退化；且 Quill 无空行概念 ⇒ 段间空行丢失。
- **不选方案 C（编辑器回写时把 Quill HTML 反转为纯文本 `\n\n`）**：同样丢格式，且纯文本承载平台本就由发布链转换 ⇒ 两处转换，违「单一实现」纪律。

### 决策 2：「各存一份 + parity 锁」，不让两个包互相 require

`packages/api-publish-engine` 是**零 workspace 依赖**的独立运行时（见其 `src/publish/category-resolver.js` 头注释），不能 require `shared-utils`；而渲染端不能 require 引擎侧 CJS。⇒ 沿用本仓既有形态：`shared-utils` 存 CJS 原语 + ESM 孪生，**用 parity 测试把两者与引擎的 `formatArticleBody` 三向钉死**（逐行同源 + 导出面相等 + 行为向量逐字节相同）。改任一处口径即红。

### 决策 3：判据仍是**标签名白名单**，不放宽

沿用前作（`article-body-format`）已确立的判据：`HTML_TAG_PATTERN` 只认具名标签；禁止「`<` 后跟字母」的宽判据 —— 后者会把技术正文的 `#include <stdio.h>`、`vector<int>` 当标签（HTML 承载平台会转义成用户可见变化，纯文本平台会**整段剥掉**）。

### 决策 4：知乎成功判据收敛为**严格终态**，两个判据互斥

`isZhihuPublishedUrl` 只认 `^/p/(\d+)/?$`（可带查询串/锚点）；`isZhihuDraftEditorUrl` 只认 `^/p/(\d+)/edit/?$`；两者**互斥**并有单测断言。⇒ 「草稿编辑页」与「公开文章页」在判据层面不再可能混同 —— 这正是 2026-09-29 那条契约锁写反后失去的东西。

### 决策 5：补点必须**先确证在草稿编辑页**，且至多 1 次

首次点「发布」后可能出现三种落点：公开文章页（成功，不补点）、草稿编辑页（补点一次）、其它页（`unexpected-page`，**绝不补点**）。补点资格判定是**防重复造草稿**的唯一闸门；宁可真失败，也不要多造一份草稿。按钮未就绪时记录 `draft-editor-publish-button-missing` 且**不点击**。

### 决策 6：删掉 `panelGone` 兜底，不留第二个成功出口

「按钮消失即成功」是恒真型判据的近亲（页面布局/面板遮挡都能让它成立）。一个动作有两条成功出口时，判据的宽度等于两者之并 ⇒ 删除，只留严格终态。

### 决策 7：把状态机写成**注入式纯逻辑**，而不是塞进 `_publish_zhihu`

`confirmZhihuPublished` 的 `readUrl` / `waitForElement` / `click` / `sleep` / `publishButton` / 时限全部由调用方注入 ⇒ 39 例穷举单测无需真实浏览器、无需 mock Electron；`_publish_zhihu` 只剩接线。这也是本仓「判据本体可单测、接线在宿主」的既有范式。

---

## 4. 契约

### 4.1 正文装载原语（Bug A）

| 函数 | 输入 | 输出 | 关键不变量 |
|------|------|------|-----------|
| `hasHtmlTags` | 任意值 | boolean | 白名单标签；`#include <stdio.h>` / `a < b` / 实体 ⇒ `false` |
| `escapeHtml` | 任意值 | string | `&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`；**先转义后拼标签** |
| `textToParagraphHtml` | 任意值 | `<p>…</p>` 串 | 每个非空行一段；空行不产出空 `<p>`；CRLF 归一；单换行与空行**都**算段界 |
| `toHtmlBody` | 任意值 | string | 已是 HTML ⇒ 原样返回（幂等）；空/纯空白 ⇒ `''`；非字符串/null ⇒ `''` |

### 4.2 知乎终态判据与状态机（Bug B）

| 符号 | 输入 | 输出 | 关键不变量 |
|------|------|------|-----------|
| `parseZhihuUrl` | 任意值 | `{postId, kind}` 或 `null` | 非法输入返回 `null`，**绝不抛** |
| `isZhihuPublishedUrl` | 任意值 | boolean | 严格 `^/p/(\d+)/?$`；`/edit`、`/draft`、`/manage`、尾段伪装、域名伪装、非 http(s) 一律 `false` |
| `isZhihuDraftEditorUrl` | 任意值 | boolean | 严格 `^/p/(\d+)/edit/?$`；与上一个**互斥** |
| `extractZhihuPostId` | 任意值 | string 或 `''` | 两种页面都能取 ID（记录 / 回查用） |
| `confirmZhihuPublished` | `{readUrl, waitForElement, click, sleep, publishButton, log, timings}` | `{published, reason, url, postId}` | 轮询公开页 → 仅草稿页才补点（至多 1 次）→ 未确认返回 `published:false` |

**成功返回**：`{success: true, url, platform: 'zhihu', postId}`。
**失败返回**：`{success: false, error, platform: 'zhihu', url}`，其中 `error = 'zhihu: publish not confirmed (<reason>) url=<url>'`，`reason ∈ {unexpected-page, draft-editor-publish-button-missing, draft-editor-still-not-published}`。

---

## 5. 数据校验（逐条）

### 5.1 Bug A（`toHtmlBody` / `textToParagraphHtml`）

| 校验点 | 规则 | 失败形态 |
|--------|------|---------|
| 输入类型 | `null` / `undefined` / 非字符串 ⇒ 按空串处理 | 返回 `''`，不抛 |
| 空 / 纯空白 | `!raw.trim()` ⇒ `''` | **不产出 `<p></p>`**（空段不占位） |
| CRLF | `split(/\r?\n/)` 归一 | `\r` 不残留在段落文本里 |
| 行首尾空白 | 每行 `.trim()` 后判空 | 空行 / 纯空白行不产出元素 |
| 转义顺序 | **先转义后拼标签** | 正文里的裸尖括号不制造标签注入面 |
| 幂等 | 已是 HTML（白名单命中）⇒ 原样返回 | 不二次包装成 `<p><p>…</p></p>` |
| 段界口径 | 单换行与空行**都**算段界（与发布链一致） | `a\nb` 与 `a\n\nb` 都成两段 |
| 标签判据 | 标签名白名单 | `#include <stdio.h>` / `vector<int>` 不被当标签 |

### 5.2 Bug B（`parseZhihuUrl` / 状态机）

| 校验点 | 规则 |
|--------|------|
| URL 主机 | 仅 `zhuanlan.zhihu.com` / `www.zhihu.com`（大小写不敏感）；`zhuanlan.zhihu.com.evil.example.com` 之类后缀伪装判假 |
| URL 协议 | 仅 `http:` / `https:`（`javascript:` / `file:` / 相对串判假，`parseZhihuUrl` 返回 `null`） |
| 文章路径 | 严格 `^/p/(\d+)/?$`（**无 `/edit`、无其它尾段**）；查询串 / 锚点允许 |
| 草稿编辑页 | 严格 `^/p/(\d+)/edit/?$`；与文章页判据**互斥**（有单测断言不会同时为真） |
| 空 / 非法输入 | `null` / `undefined` / 非字符串 / 空串 ⇒ 全部 `false`（不抛） |
| 读 URL 抛错 | 状态机内 `try/catch` 收敛为空串，**不**把异常冒泡成「发布失败」（fail-closed：判据不成立即失败） |
| 补点资格 | **必须先确证停在草稿编辑页**；按钮未就绪则记录 `draft-editor-publish-button-missing` 且**不点击** |
| 补点次数 | 至多 1 次（总计 2 次「发布」点击），有单测断言 |

---

## 6. 流程与功能逻辑（端到端）

### 6.1 Bug A

```
[改写/采集产出]  纯文本，含 \n\n 分段
      ↓
[发布页编辑器]  ArticleEditor.vue（富文本 or Markdown）
      ├─ Markdown 模式：textarea，原文进出（\n 保留）          ← 一直是对的
      └─ 富文本模式：★ 本次修复点
            装载：toHtmlBody(纯文本) → <p>段1</p><p>段2</p>…   （修复前：直接塞纯文本 ⇒ 塌成一段）
            Quill 渲染多段；用户增删改
            回写：quill.root.innerHTML（每段一个真 <p>）→ article.content
      ↓
[发布 payload]  usePublishFlow.buildArticleData()：content / contentFormat('html'|'markdown')
      ↓
[主进程路由]    PublisherRouter：baijiahao → mode=api → ApiPublisher
      ↓
[发布链]        BaijiahaoArticleChain.buildArticleFormData()
                convertInlineTopics('baijiahao', …)   ← 顺序不变量：话题转换先于包装
                formatArticleBody('baijiahao', …)      ← HTML 幂等 / 纯文本成段
      ↓
[平台]          POST /pcui/article/publish?type=news&callback=bjhpublish（content 字段为 HTML）
      ↓
[公开页]        data-testid="article" 容器内 <p> 数 == 源文段数（真机复核判据）
```

**不变式**：**编辑器里看到的段落数 == HTML 承载平台拿到的 `<p>` 数**（Markdown 模式与批量发布路径同样成立：前者原文带 `\n`，后者在链路里成段）。

### 6.2 Bug B

```
[发布页] 知乎图文 → 目标账号 → 「一键发布」
   ↓ PublisherRouter：zhihu → mode=rpa_vm（必走浏览器，无 API 轨）
[RpaViewSession] 登录态恢复（cookie 分区 account-e10a1715）→ 打开 https://zhuanlan.zhihu.com/write
   ↓ 标题写入 wrapper 内 textarea（原生 value setter + input/change）
   ↓ 正文可信注入（CDP insertText；失败回退 innerHTML）
   ↓ 点「发布」（写作页）
   ↓ ★ 本次修复点：confirmZhihuPublished()
        ├─ 已跳公开文章页 /p/<id>          → published:true（reason=published）
        ├─ 停在草稿编辑页 /p/<id>/edit     → 等该页「发布」按钮 → 补点一次 → 再等公开页
        │      ├─ 跳出到 /p/<id>            → published:true（reason=published-after-second-click）
        │      └─ 仍在 /edit                → published:false（draft-editor-still-not-published）
        └─ 其它页面（仍 /write 等）         → published:false（unexpected-page，且**不补点**）
   ↓
[成功] 进度 100%「published!」→ 发布记录 postId=<id>、url=/p/<id>（可回查公开页）
[失败] success:false（上层按失败处理，绝不写「已发布」记录）
```

---

## 7. 交互逻辑与显示项

### 7.1 Bug A

| 场景 | 交互 / 显示 | 本次是否有变化 |
|------|-----------|---------------|
| 富文本模式装载多段内容 | 编辑器内**显示为多个自然段**（修复前：挤成一整段 —— 用户最早能在应用内看出来的症状） | **有变化（本次修复的直接可见收益）** |
| 富文本模式装载已含 HTML 的内容 | 原样渲染，不叠加包装 | 无变化（幂等） |
| 富文本模式装载代码片段 | `<stdio.h>` 等以文本形态显示，不被当标签吞掉 | 无变化（白名单判据） |
| Markdown 模式 | 文本域按原文编辑（`\n` 保留） | 无变化 |
| 字数计数 | 仍按 `modelValue` 的 Unicode 码点计数（富文本模式下计的是 HTML 串长度，与修复前同口径） | 无变化 |
| 发布进度与结果 | 阶段文案、成功/失败提示、发布记录字段均不变 | 无变化 |
| 平台侧显示 | 百家号 / 头条 / 公众号的正文段落恢复（**待真机复核**） | 预期变化，见 §9 |

### 7.2 Bug B

| 场景 | 应用内表现 | 平台侧 | 备注 |
|------|-----------|--------|------|
| 真发布成功 | 进度面板 `zhihu / published! 100%`；发布记录 `url` 形如 `https://zhuanlan.zhihu.com/p/<id>`、`post_id` 有值 | 文章公开可见 | 修复后新增 `postId` 回填 |
| 只落草稿（本次事故形态） | **不再显示成功**；按失败处理并给出原因 | 平台只有草稿 | 修复前：显示成功但平台只有草稿 |
| 停在写作页（风控 / 校验拦住） | 失败，原因 `unexpected-page` | 未发布 | 不补点，避免双草稿 |
| 草稿页按钮找不到 | 失败，原因 `draft-editor-publish-button-missing` | 草稿已建 | 如实告知 |
| 补点后仍在草稿页 | 失败，原因 `draft-editor-still-not-published` | 草稿已建 | 如实告知（本次报障的最坏子情形） |
| 用户选「存草稿」 | 与修复前一致：`draft: true` 分支返回成功（草稿语义） | 平台草稿 | 见 §9 遗留 |

### 7.3 提示文字（逐字）

**Bug A：无新增 / 无修改任何用户可见文案**（无 toast、无对话框变化）。唯一可感知的变化是**编辑器里的段落渲染**本身。

**Bug B（失败，经 `RpaVmPublisher` 透传 `result.error`）**：

```
zhihu: publish not confirmed (unexpected-page) url=https://zhuanlan.zhihu.com/write
zhihu: publish not confirmed (draft-editor-publish-button-missing) url=https://zhuanlan.zhihu.com/p/<id>/edit
zhihu: publish not confirmed (draft-editor-still-not-published) url=https://zhuanlan.zhihu.com/p/<id>/edit
```

**Bug B（日志）**：`[WARN] RpaView [zhihu] publish not confirmed reason=<reason> url=<url>`（状态机内一次 + 调用点一次）。

**Bug B（成功）**：进度文案不变（`publishing...` 80% → `verifying...` 95% → `published!` 100%），但**判定依据**从「URL 含 `/p/`」换成「URL 严格等于公开文章页」；返回体为 `{success:true, url, platform:'zhihu', postId}`，发布记录字段随之有值。

**已移除的旧文案**：`zhihu: publish verification failed`（随 `panelGone` 兜底一并删除，不再存在第二个成功出口）。

---

## 8. 测试策略（反证口径）

| 反证（变异） | 期望变红 |
|-------------|---------|
| `ArticleEditor.vue` 的 getter 改回 `props.modelValue` | `ArticleEditor.test.js` **4 例** + `ArticleEditor.quill-load.test.js` **3 例**（恢复即绿） |
| `toHtmlBody` 与 `formatArticleBody` 的 HTML 分支判据分叉 | `article-body-format-parity.test.js` 的行为向量锁 |
| 标签判据放宽为「`<` 后跟字母」 | `article-body-format-parity.test.js` 的代码片段向量 + 组件级 `<stdio.h>` 用例 |
| `isZhihuPublishedUrl` 放宽为「路径包含 `/p/`」 | `zhihu-publish-state.test.js` 的 `/edit` 反例 + `rpa-view-platforms-zhihu-publish.test.js` 结构锁 |
| `_publish_zhihu` 绕过 `confirmZhihuPublished` 自造 URL 子串判据 | `rpa-view-platforms-zhihu-publish.test.js` 结构锁 |
| 在非草稿页也补点 | 状态机「写作页 ⇒ 只点 1 次」用例 |
| 补点超过 1 次 | 状态机点击数断言用例 |

**测试分层与用例数（Lead 已实跑）**

| 层 | 文件 | 用例 | 结果 |
|----|------|------|------|
| 原语 parity | `packages/shared-utils/src/__tests__/article-body-format-parity.test.js` | 9（逐行同源 + 导出面 + 与 `formatArticleBody(baijiahao\|toutiao\|wechat_mp, x)` 逐字节相同 + 事故形态反证） | ✅ 9/9 |
| 组件边界 | `apps/desktop/src/components/ArticleEditor.test.js` | 17（含新增 7：多段成段、HTML 幂等、空内容不留空 `<p>`、`<stdio.h>` 不被当标签、回写 URL、Markdown 模式不变、**结构锁**） | ✅ 17/17 |
| 真实 Quill（不 mock） | `apps/desktop/src/components/ArticleEditor.quill-load.test.js` | 4（两段源文 ⇒ 编辑器 DOM 2 个 `<p>`；六段 ⇒ 6 个 `<p>`；HTML 原样；代码片段保留） | ✅ 4/4 |
| 知乎判据 + 状态机 | `apps/desktop/electron/services/zhihu-publish-state.test.js` | 39（`/edit`、`/write`、`/p/<id>/draft`、`evil.example.com`、`javascript:` 等反例；状态机 7 例含「补点后仍未离开草稿页 ⇒ `published:false`」） | ✅ 39/39 |
| 知乎发布行为级 + 结构锁 | `apps/desktop/electron/services/rpa-view-platforms-zhihu-publish.test.js` | 5（公开页判成功带 `postId`；两段式补点成功；写作页不补点如实失败；**结构锁：成功只能经 `confirmZhihuPublished`、不得再自造 URL 子串判据**） | ✅ 5/5 |
| 既有回归 | `apps/desktop/electron/services/rpa-view-platforms.test.js` | 全量（含把原「草稿编辑页 ⇒ 成功」用例**改写为反例**） | ✅ 全绿（三文件合计 126 例） |
| 边界 / 行数门禁 | `scripts/check-renderer-cjs-boundary.js` / `.github/scripts/check-max-lines.js` | — | ✅ PASS |
| 引擎契约回归 | `packages/api-publish-engine` `node scripts/run-tests.js` | 全量 | ✅ rc=0（41 文件 / 425 用例） |

---

## 9. 已知边界与遗留（不假装已闭合）

1. **百家号端到端真机复核待执行**：需要一次真实发布（用户侧发一篇）。判据：`https://baijiahao.baidu.com/s?id=<postId>` 的 `data-testid="article"` 容器内 **`<p>` 数 == 源文自然段数**，且段间文本不再黏连。**未复核前不得声称「百家号已修复」。**
2. **知乎真机复核待执行**：判据：发布记录 `url` **无 `/edit`**、`post_id` 非空、公开页可访问。本次修复已确保「不再谎报成功」，但「补点后一定成功」仍需真机证实。
3. **平台侧二次规范化未知**：已证明「1 个 `<p>` → 公开页 1 个 `<p>`」；但「6 个 `<p>` → 公开页 6 个 `<p>`」**未经真机证实**（正是遗留 1 要复核的原因）。
4. **头条 / 公众号（同为 HTML 承载）未取证**：本次只改装载层，这两个平台的正文分别来自 `toutiao-direct-bridge` 页面重放与公众号 ProseMirror DOM 注入 —— **另一段注入代码**，是否存在同类「装载吞段落」路径需各自复核，登记为下一轮取证项。
5. **`draft: true`（用户主动选存草稿）仍返回成功**：语义上是「草稿已存」而非「已发布」，上层 `RpaVmPublisher` 不区分 `draft`。与本次报障不是同一件事（本次是**未选草稿**却只落了草稿），登记为遗留。
6. **失败重试的重复发帖风险**：新判据把「未确认」判为失败，若队列自动重试，理论上存在「其实已发布 + 重试再发一篇」的风险。本次未改重试策略。
7. **其它 RPA 平台的同族假成功判据未审计**：`rpa-view-platforms.js` 内其它平台的成功判据形态各异，本次**未逐个取证**，登记为下一轮审计项。
8. **`contentFormat` 语义名实不符**：`usePublishFlow` 把「非 Markdown」一律记作 `'html'`，而 Markdown 模式下的内容是纯文本；不影响本次修复，登记为遗留。
9. **字数计数口径**：富文本模式下 `charCount` 计的是 HTML 串长度（含标签），与平台「正文字数」口径不同 —— 属既有行为，未在本次改动。
