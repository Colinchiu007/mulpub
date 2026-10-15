# BUGFIX — 百家号图文正文「整篇一整段」二次报障 + 知乎「显示发布成功但未真实发布」（2026-10-15）

| 项目 | 内容 |
|------|------|
| 分支 | `fix-article-paragraph-zhihu-publish`（隔离 worktree `D:/Data/projects/mp-worktrees/mp-fix-article-paragraph-zhihu-publish`，基线 `origin/main` = `58256ffc8`） |
| change | `openspec/changes/fix-article-paragraph-zhihu-publish` |
| 执行记录 | `openspec/records/fix-article-paragraph-zhihu-publish.md` |
| 变更类型 | 🐛 Bug 修复（两条独立缺陷，同批修复） |
| 关联前作 | `#3389`（`2bb7c2b9a`，2026-10-12，change `article-body-format`）、`#2647`（`d424c245c`，2026-09-29，知乎图文发布修复） |
| 状态 | 代码 + 测试已落地；**百家号端到端真机复核待执行**（判据见 §2.12），知乎修复的真机复核同样待执行（判据见 §3.11） |

---

## 1. 用户报障原文与拆解

> ① 发布到百家号上的图文内容，在百家号上显示是一整段，没有分段和分行。查一下原因。我记得这个问题，之前已经修复过啊，怎么没有生效。确认一下。
> ② 发布图文，知乎显示发布成功。但并没有真实发布。查一下原因并修复。

| # | 问题 | 本文档结论 |
|---|------|-----------|
| ①-a | 2026-10-12 的修复在代码里吗？ | **在**。且**正在运行的应用就是含修复的构建**（实证见 §2.2） |
| ①-b | 那为什么仍是一整段？ | **因为修复作用的环节在事故之后**：段落结构在**编辑器装载那一刻**（内容进入发布链之前）就被 Quill 的 HTML 语义吞掉了。发布链侧再正确也只能照抄单段 |
| ②-a | 知乎为什么报成功？ | 成功判据 `/\/p\/\d+/` 把**草稿编辑页** `/p/<id>/edit` 判成了文章页 |
| ②-b | 为什么没真发布？ | 知乎发布是**两段式**：首次点「发布」只落草稿并跳到该编辑页，需在该页再点一次才真发布；旧实现点一次就收工 |

---

## 2. Bug A：百家号图文正文「整篇一整段」（二次报障）

### 2.1 事故现象（真机，2026-10-15 20:40 发布）

- 运行日志：`shared-user-data/logs/app-2026-10-15.log`
  - `12:40:00.483Z` `PublishIPC publish:batch enter`：平台 `[wechat_mp, zhihu, xiaohongshu, toutiao, baijiahao]`，标题「阿布扎比王妃吸毒昏倒街头忽视幼童」
  - `12:40:18.971Z` `PublishProgress phase-start {platform: baijiahao}` → `12:40:22.059Z` `phase-success {stageKey: done, hasResult: true}`
  - `12:40:18.973Z` `PublisherRouter route-selected {platform: baijiahao, mode: api}`
- 平台产物：`https://baijiahao.baidu.com/s?id=1879119523718680476`（发布时间 2026-10-15 20:40）
  - 正文容器 `div[data-testid="article"] > div.dpu8C > <!--s-frag-->…<!--/s-frag-->`
  - 正文 `<p>` 数 = **1**（`<p>…全篇…</p>`），`<br>` = 0，容器内原始换行 = 0
  - 正文可见文本 **1055** 字符；6 段之间**没有任何空白**（`…浑身冰凉。没有人尖叫…`）

### 2.2 确认：修复在跑，不是「没生效」

| 判据 | 证据 |
|------|------|
| 修复提交在运行构建里 | 正在运行的 Electron 来自 `D:\Data\projects\mp-worktrees\mp-app-live2`（tip `fe9f41879`，2026-10-15）；`git merge-base --is-ancestor 2bb7c2b9a fe9f41879` → **rc=0（是祖先）** |
| 模块解析到该构建的源码 | `require.resolve('@multi-publish/api-publish-engine/src/publish/platforms/baijiahao-article.js', {paths:['…/mp-app-live2/apps/desktop']})` → `D:\Data\projects\mp-worktrees\mp-app-live2\packages\api-publish-engine\src\publish\platforms\baijiahao-article.js`，该文件 `:152` 即 `params.set('content', formatArticleBody('baijiahao', withTopics))` |
| 走的是 API 轨（该轨才有 `formatArticleBody`） | 日志 `PublisherRouter route-selected … mode=api`；且只有 3.1 秒、无任何 RpaView 浏览器窗口日志 |
| 本地按同源复现表单 | 用**同一份**引擎源码 + 同源正文调 `buildArticleFormData` → 产出 **6 个 `<p>`**、1097 字符 |

⇒ 结论：**代码路径正确、修复确实在生效的构建里，但真机产物仍是单段**。矛盾点只可能在「送进这条链路的正文已经不是多段」。

### 2.3 取证：源文有分段，平台产物没分段

| 取样 | 字符数 | 换行数 | 自然段数 | 平台正文 `<p>` | 平台正文字符数 | 逐字节对账 |
|------|-------|--------|---------|---------------|---------------|-----------|
| 本次（2026-10-15 20:40 发布，postId `1879119523718680476`） | 1075 | 10 | 6 | **1** | 1055 | `源文去掉全部 \n == 平台正文` → **True（1055 == 1055）** |
| 前作取证（2026-10-09 发布，postId `1878588576245723518`） | 863 | 8 | 5 | **0**（裸文本节点） | 855 | 同上为 True |

源文取自 `shared-user-data/multi-publish.db` 的 `rewrite_history.rewritten_content`（本次记录 `id=mv9izcxt37xlxqcq`，`created_at=2026-10-15T12:39:00.929Z`，6 段：106/214/263/220/135/122 字符）。

**对账结论**：平台正文字节与源文完全相同、唯一差异是「换行全部消失」；再叠加「修复后正文被包进 1 个 `<p>`」（修复前是裸文本节点），可判定：

1. 平台**确实**消费了我们 `content` 字段里的 HTML 标签（否则不会从「裸文本」变成「`<p>` 包裹」）；
2. 但我们送去的 HTML 里**只有一个 `<p>`** —— 因为 6 个段落之间的结构在我们这一侧就已经不存在了。

### 2.4 第一性根因：编辑器装载把段落吞了（渲染层，2026-09-04 引入）

**根因位置**：`apps/desktop/src/components/ArticleEditor.vue`

```vue
<QuillEditor v-if="editorMode === 'rich'" v-model:content="richContent" content-type="html" … />

const richContent = computed({
  get: () => props.modelValue,      // ← 纯文本原样喂给 content-type="html" 的富文本组件
  set: (val) => emit('update:modelValue', val),
})
```

**机理（逐行实证 `@vueup/vue-quill@1.5.3` 的 `dist/vue-quill.esm-bundler.js`）**：

| 步 | 源码位置 | 行为 |
|----|---------|------|
| 1 | `:255` `setContents(props.content)` | 组件就绪后把 `modelValue` 灌入编辑器 |
| 2 | `:405-406`、`:427-429` | `contentType === 'html'` ⇒ `setHTML()` ⇒ **`quill.root.innerHTML = 值`**（按 HTML 解析） |
| 3 | HTML 语义 | `第一段\n\n第二段` 里的换行是**可忽略空白** ⇒ 整篇塌成一个文本节点，视觉上就是「一整段」 |
| 4 | `:257` `quill.on('text-change', handleTextChange)` + DOM MutationObserver | Quill 把 root DOM 解析回自己的模型并触发 `text-change`（**无需用户输入**也会触发） |
| 5 | `:336-341` `handleTextChange` | `ctx.emit('update:content', getHTML())` |
| 6 | `:423-425` `getHTML()` | 回写的是 `quill.root.innerHTML` —— 此时已是**单段 HTML** |
| 7 | `ArticleEditor.richContent.set` | `emit('update:modelValue', 单段 HTML)` ⇒ `article.content` 变成单段 |
| 8 | 发布链 | `formatArticleBody('baijiahao', '<p>全篇</p>')` 命中「已是 HTML」⇒ **幂等透传**（这一步本身没错） |
| 9 | 平台 | 收到 1 个 `<p>` ⇒ 公开页 1 个 `<p>` |

**引入点（`git blame` 取证）**：`get: () => props.modelValue` 来自 `08e7d95a66`（2026-09-04，`P1-M7 Markdown input + per-platform format adaptation` 那一轮把富文本模式接到 Quill 的 `content-type="html"`）。⇒ 该缺陷自 2026-09-04 起一直存在，2026-10-09 / 10-12 的 11 篇百家号文章全部命中。

**为什么 2026-10-12 的修复不可能生效**：那次修复（`#3389`）改的是「**已经多段**的内容在 HTML 承载平台上如何表达」（纯文本 → `<p>` 包装）。而本次取证的链路里，正文在**进入链路之前**就已经是一段 —— 修复作用的环节在事故之后。这也正是前作 PRD 在 §14.5 亲手写下的那条遗留：「若真机复核发现段落仍被合并，需按产物 HTML 反推平台期望形态」——本次把「反推平台形态」换成了更靠前的答案：**平台形态没问题，是我们自己的编辑器先把段落吃掉了**。

### 2.5 修复方案（含方案对比）

| 方案 | 做法 | 取舍 |
|------|------|------|
| A（采纳） | 富文本装载前归一：`richContent.get()` 改为 `toHtmlBody(props.modelValue)` —— 纯文本按行成段、**已是 HTML 幂等透传** | 保留富文本格式（加粗/列表在 HTML 承载平台仍随 HTML 下发）；不动发布链、不动数据模型；与发布链**同判据**（同一份原语） |
| B | 富文本模式改 `content-type="text"`（`setText`/`getText`） | 段落能留住，但**静默丢弃用户富文本格式**（HTML 承载平台能力退化），且 Quill 无空行概念 ⇒ 段间空行丢失。否决 |
| C | 编辑器回写时把 Quill HTML 反向转纯文本（`\n\n`）再存 model | 数据模型统一，但同样丢格式；且纯文本承载平台本就由发布链转，属于重复转换（违「单一实现」纪律）。否决 |

**采纳方案的三条不可破**：

1. **装载必须归一**：`richContent.get()` 必须返回 `toHtmlBody(modelValue)`；不得回退直传 `props.modelValue`（结构锁 + 真实 Quill 用例双向锁定）。
2. **单一判据**：装载用的原语与发布链 `formatArticleBody()` 的 HTML 分支必须**逐字节等价**（`article-body-format-parity.test.js` 的行为向量锁）。
3. **判据不得放宽**：标签判据是**标签名白名单**；禁止「`<` 后跟字母」宽判据（会把 `#include <stdio.h>`、`vector<int>` 当标签，纯文本平台整段吃掉用户代码示例）。

**新增单一实现**：`packages/shared-utils/src/article-body-format.js`（CJS）+ `article-body-format.browser.js`（ESM 孪生，逐行同源），渲染端经 `apps/desktop/vite.config.js` 的 alias 消费（未登记 alias 会被 `scripts/check-renderer-cjs-boundary.js` 拦红）。引擎侧**不 require** 它（`packages/api-publish-engine` 是零 workspace 依赖的独立运行时，见其 `src/publish/category-resolver.js` 头注释），两处按本仓既有形态「各存一份 + parity 锁」。

### 2.6 数据校验（Bug A）

| 校验点 | 规则 | 失败形态 |
|--------|------|---------|
| 输入类型 | `null` / `undefined` / 非字符串 → 按空串处理（`String(value == null ? '' : value)`） | 返回 `''`，不抛 |
| 空/空白输入 | `!raw.trim()` → 返回 `''` | **不产出 `<p></p>`**（空段不占位） |
| CRLF | `split(/\r?\n/)` 归一 | `\r` 不残留在段落文本里 |
| 行首尾空白 | 每行 `.trim()` 后判空 | 空行/纯空白行不产出元素 |
| 转义顺序 | **先转义后拼标签**：`&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;` | 正文里的裸尖括号不会制造标签注入面 |
| 幂等 | 已是 HTML（白名单命中）⇒ 原样返回 | 不二次包装成 `<p><p>…</p></p>` |
| 段界口径 | **单换行与空行都算段界**（与发布链一致） | `a\nb` 与 `a\n\nb` 都成两段 |

### 2.7 流程与功能逻辑（Bug A，端到端）

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

**不变式（本次修复要建立并守住的那条）**：**编辑器里看到的段落数 == HTML 承载平台拿到的 `<p>` 数**（Markdown 模式与批量发布路径同样成立：前者原文带 `\n`，后者在链路里成段）。

### 2.8 交互逻辑与显示项（Bug A）

| 场景 | 交互/显示 | 本次是否有变化 |
|------|----------|---------------|
| 富文本模式装载多段内容 | 编辑器内**显示为多个自然段**（修复前：挤成一整段 —— 这也是用户最早能在应用内看出来的症状） | **有变化（本次修复的直接可见收益）** |
| 富文本模式装载已含 HTML 的内容 | 原样渲染，不叠加包装 | 无变化（幂等） |
| 富文本模式装载代码片段 | `<stdio.h>` 等以文本形态显示，不被当标签吞掉 | 无变化（白名单判据） |
| Markdown 模式 | 文本域按原文编辑（`\n` 保留） | 无变化 |
| 字数计数 | 仍按 `modelValue` 的 Unicode 码点计数（富文本模式下计的是 HTML 串长度，与修复前同口径） | 无变化 |
| 提示文字 | 本 Bug **不新增/不修改任何用户可见文案**（无 toast / 无对话框变化） | 无变化 |
| 发布进度与结果 | 阶段文案、成功/失败提示、发布记录字段均不变 | 无变化 |
| 平台侧显示 | 百家号/头条/公众号的正文段落恢复（**待真机复核**） | 预期变化，见 §2.12 |

### 2.9 测试与反证（Bug A）

| 层 | 文件 | 用例 | 结果 |
|----|------|------|------|
| 原语 parity | `packages/shared-utils/src/__tests__/article-body-format-parity.test.js` | 9 例：CJS↔ESM 逐行同源 + 导出面相等 + 与 `formatArticleBody(baijiahao/toutiao/wechat_mp, x)` **逐字节相同** + 6 段源文不得产出单个 `<p>` + 幂等 | ✅ 9/9 |
| 组件边界 | `apps/desktop/src/components/ArticleEditor.test.js` | 17 例（新增 7 例）：纯文本多段→逐段 `<p>`、HTML 幂等、空内容不留空 `<p>`、`<stdio.h>` 不被当标签、Quill 回写透传、Markdown 模式不变、**结构锁** | ✅ 17/17 |
| 真实 Quill（不 mock） | `apps/desktop/src/components/ArticleEditor.quill-load.test.js` | 4 例：编辑器 DOM 里 2 段/6 段各成 `<p>`、HTML 原样、代码片段保留 | ✅ 4/4 |
| 边界门禁 | `scripts/check-renderer-cjs-boundary.js` | 渲染层 shared-utils 导入必须登记 alias | ✅ PASS（扫 365 文件 / alias 11 项） |
| 行数门禁 | `.github/scripts/check-max-lines.js` | 逐文件上限 + 点名还账文件零增长 | ✅ PASS |
| 引擎契约回归 | `packages/api-publish-engine` `node scripts/run-tests.js` | 全量 | ✅ rc=0（41 文件 / 425 用例） |

**变异反证（必须做，且已做）**：把 `ArticleEditor.vue` 的 `get: () => toHtmlBody(props.modelValue)` 改回 `get: () => props.modelValue`：
- `ArticleEditor.test.js` → **4 例红**（多段、空内容、代码片段、结构锁）
- `ArticleEditor.quill-load.test.js` → **3 例红**（2 段、6 段、代码片段）
- 恢复后全绿 ⇒ 证明回归锁**在跑**（不是 no-op 锁）。

### 2.10 逃逸链（为什么这么久没被拦住）

| 层 | 为什么没拦住 |
|----|-------------|
| 单元测试 | 修复前**没有任何**「编辑器装载后段落数」的用例；`ArticleEditor.test.js` 全程 mock 掉 `QuillEditor`，只断言模式切换/计数/`maxlength` —— 真实 Quill 是「装载即改内容」的黑盒，mock 完全看不见 |
| 集成测试 | 无「纯文本 → 编辑器 → payload.content」的贯通用例；`usePublishFlow.test.js` 只校验 payload 字段存在与校验分支，不校验正文结构 |
| 端到端 | 无「发布 → 抓公开页 → 数 `<p>`」的自动判据；真机发布依赖人工 |
| 视觉回归 | 编辑器是页面局部，且基线只覆盖静态渲染，没有「长文多段装载」场景 |
| 代码审查 | 2026-10-12 的审查（含 CCG 双模型）盯的是**发布链**（`formatArticleBody` 本身写得很严谨），没有回溯到「内容从哪来」；`QuillEditor content-type="html"` + 纯文本 model 这一组合在 Vue 模板里看起来完全无害 |
| 事故复盘 | 2026-10-12 的根因结论写成「发布时传参不对」，**没有真机复核**（前作 PRD §10 与执行记录都标注「真机复核待执行」）⇒ 假设未验证就沉淀成了 QM-2 合同 |

### 2.11 系统性漏洞与预防

**系统性漏洞分类**：① 测试场景缺失（无“编辑器装载保真”场景）；② 测试质量不足（mock 掉真实编辑器，把最危险的一跳换成假的）；③ 流程缺失（修复结论文档化但**真机复核未执行**即视为完成）。

**落地预防措施**：
1. 新增回归锁两层：组件边界（mock，快）+ 真实 Quill（慢，直读 DOM）；两者都已在变异下实测变红。
2. 原语 parity 锁把「渲染端装载」与「发布链字段写入」绑成同一判据：改任一处口径即红。
3. AGENTS.md QM-2 新增「富文本编辑器装载合同」条目（见 §5 文档清单）。
4. PRD-ARTICLE-BODY-FORMAT 补「第一性根因修正」与真机复核判据（把上次未执行的复核写成必须项）。

### 2.12 遗留（不假装已闭合）

- **百家号端到端真机复核待执行**：需要一次真实发布（用户侧发一篇），判据：`https://baijiahao.baidu.com/s?id=<postId>` 的 `div[data-testid="article"] > div.dpu8C > <!--s-frag-->…` 容器内 **`<p>` 数 == 源文自然段数**，且段间文本不再黏连。**未复核前不得声称「百家号已修复」。**
- **头条 / 公众号（HTML 承载，同一 `formatArticleBody` 契约）**：本次只改了装载层，这两个平台的正文来自 DOM 轨/API 草稿轨，是否也存在同类「装载吞段落」路径需各自复核（头条走 `toutiao-direct-bridge` 页面重放、公众号走 ProseMirror DOM 注入 —— 都是**另一段注入代码**，本次未取证）。登记为下一轮取证项。
- **平台侧二次规范化**：本次已证明「1 个 `<p>` → 公开页 1 个 `<p>`」；但「6 个 `<p>` → 公开页 6 个 `<p>`」仍**未经真机证实**（这正是 §2.12 第一条要复核的原因）。
- **`contentFormat` 语义**：`usePublishFlow` 把「非 Markdown」一律记作 `'html'`，而 Markdown 模式下的内容是纯文本 —— 名实不符（不影响本次修复，登记为遗留）。
- **字数计数口径**：富文本模式下 `charCount` 计的是 HTML 串长度（含标签），与平台「正文字数」口径不同 —— 属既有行为，未在本次改动。

---

## 3. Bug B：知乎「显示发布成功但未真实发布」

### 3.1 事故现象（真机，2026-10-15 20:40 同批发布）

```
12:40:00.652Z PublishProgress phase-start {platform: zhihu, taskId: task_2_1792068000649}
12:40:00.653Z PublisherRouter route-selected {platform: zhihu, mode: rpa_vm}
12:40:01.500Z RpaView [zhihu] cookies restored（+ supplemented 30/30 cookies from auth partition account-e10a1715）
12:40:19.6xxZ RpaView [click] button:has-text('发布'), .PublishPanel-publish → BUTTON|Button css-d0uhtl FEfUrdfM|发布
12:40:22.662Z RpaView [zhihu] published!
12:40:22.664Z RpaView publish done platform=zhihu url=https://zhuanlan.zhihu.com/p/2094165753981309631/edit   ← 草稿编辑页
12:40:22.744Z PublisherRouter rpa-publish-ok {platform: zhihu, mode: dom, url: …/p/2094165753981309631/edit}
12:40:22.746Z PublishProgress phase-success {platform: zhihu, stageKey: done, hasResult: true}
```

- 应用内：**显示发布成功**（进度面板 `done`、发布记录写入）
- 发布记录：`tracked_content` 的知乎那条 `post_id = ''`（**空**）、`url = https://zhuanlan.zhihu.com/p/2094165753981309631/edit`
- 平台实际状态：稿子只是**草稿**（`/edit` 页），公开文章页 `https://zhuanlan.zhihu.com/p/2094165753981309631` 不存在内容

### 3.2 第一性根因

**位置**：`apps/desktop/electron/services/rpa-view-platforms.js` 的 `_publish_zhihu`

```js
await this._click(win, pubBtn)          // 只点一次
await this._sleep(3000)
const curUrl = win.webContents.getURL()
if (curUrl.includes('success') || curUrl.includes('publish') || curUrl.includes('article')
    || /\/p\/\d+/.test(curUrl)) { … return { success: true, url: curUrl } }   // ← 假成功入口
```

两个缺陷叠加：

1. **判据过宽**：`/\/p\/\d+/` 与 `https://zhuanlan.zhihu.com/p/<id>/edit`（**草稿编辑页**）匹配 ⇒ 只落草稿也判成功。
2. **只点一次**：知乎发布是**两段式** —— 首次点「发布」只是「把稿子落成草稿并跳到该编辑页」，需要**在该编辑页再点一次「发布」**才会真正发布并跳公开文章页 `/p/<id>`。

还有个「第二个假成功出口」：`panelGone` 兜底（发布按钮消失/隐藏即判成功）——它同样可以因「发布设置面板弹出把原按钮遮住」而误判，本次一并删除。

### 3.3 逃逸链（这次逃逸的核心）

**2026-09-29 的修复自己写了一条把缺陷锁成契约的测试**（`d424c245c`，PR #2647）：

```js
it('发布成功判定包含知乎 /p/<id> 文章 URL 模式（实测发布后跳转 zhuanlan.zhihu.com/p/xxx）', async () => {
  const { win } = createZhihuWindow('https://zhuanlan.zhihu.com/p/2088256436652589762/edit')  // ← 夹具就是 /edit
  …
  expect(result.success).toBe(true)   // ← 把「草稿页 = 成功」写成了期望
})
```

| 层 | 为什么没拦住 |
|----|-------------|
| 单元测试 | **写反了**：夹具用草稿编辑页 URL，断言却要求 `success === true` ⇒ 缺陷被固化成契约，后续任何改动都不会变红 |
| 集成测试 | 无「真相机 URL 序列（write → /edit → /p/id）」的驱动用例；mock 的 `getURL` 是固定值 |
| 端到端 | 无「发布后回查公开页 HTTP 200 / 标题可读」的判据；`tracked_content.post_id` 为空也没有任何门禁报警 |
| 发布记录 | `post_id=''` 是**可观测的异常信号**，但没有任何判据消费它（记录层只存不判） |
| 代码审查 | 「/p/<id> 是文章页」这一命名看起来天经地义，审查者不会去质疑 URL 语义 |
| 真机复核 | 2026-09-29 的修复记录写「实测发布后跳转 zhuanlan.zhihu.com/p/xxx」，但**没有区分 `/p/<id>` 与 `/p/<id>/edit`** ⇒ 观测本身不精确 |

### 3.4 修复方案

**新增** `apps/desktop/electron/services/zhihu-publish-state.js`：

- 纯函数判据（零依赖、可穷举单测）
  - `isZhihuPublishedUrl(url)`：**只有** `https://<zhuanlan|www>.zhihu.com/p/<数字>`（可带查询串/锚点）为真；`/p/<id>/edit`、`/p/<id>/draft`、`/p/<id>/manage`、`/write`、非知乎域名、`javascript:`、`file:` 一律为假
  - `isZhihuDraftEditorUrl(url)`：`/p/<id>/edit` —— 命中即「只落了草稿」
  - `extractZhihuPostId(url)`：两种页面都能取 ID（记录/回查用）
  - `parseZhihuUrl(url)`：非法输入返回 `null`，绝不抛
- 注入式状态机 `confirmZhihuPublished({readUrl, waitForElement, click, sleep, publishButton, log, …timings})`：
  1. 轮询读 URL 直到「已是公开文章页」或首段时限（默认 6000ms / 500ms 一探）用尽；
  2. 若停在**草稿编辑页** ⇒ 等该页「发布」按钮就绪（默认 8000ms）→ **补点一次** → 再轮询（默认 12000ms）；
  3. 只有 `isZhihuPublishedUrl` 为真才 `published: true`；否则返回 `published: false` + 机器可读 `reason`；
  4. **仅在确证停在草稿编辑页时才补点** —— 若停在写作页/未知页，绝不补点（避免重复点击造出两份草稿）。

**改** `rpa-view-platforms.js` 的 `_publish_zhihu`：发布点击后调用该状态机；成功返回 `{success:true, url, platform:'zhihu', postId}`；未确认返回 `{success:false, error, platform:'zhihu', url}`；删除 `panelGone` 兜底。

### 3.5 数据校验（Bug B）

| 校验点 | 规则 |
|--------|------|
| URL 主机 | 仅 `zhuanlan.zhihu.com` / `www.zhihu.com`（大小写不敏感）；`zhuanlan.zhihu.com.evil.example.com` 之类的后缀伪装判假 |
| URL 协议 | 仅 `http:` / `https:`（`javascript:`/`file:`/相对串判假，`parseZhihuUrl` 返回 `null`） |
| 文章路径 | 严格 `^/p/(\d+)/?$`（**无 `/edit`、无其它尾段**）；查询串/锚点允许 |
| 草稿编辑页 | 严格 `^/p/(\d+)/edit/?$`；两个判据**互斥**（有单测断言不会同时为真） |
| 空/非法输入 | `null` / `undefined` / 非字符串 / 空串 → 全部 `false`（不抛） |
| 读 URL 抛错 | 状态机内 `try/catch` 收敛为空串，不把异常冒泡成「发布失败」（fail-closed，判据不成立即失败） |
| 补点资格 | **必须先确证停在草稿编辑页**；按钮未就绪则记录 `draft-editor-publish-button-missing` 且**不点击** |
| 补点次数 | 至多 1 次（总计 2 次「发布」点击），有单测断言 |

### 3.6 流程与功能逻辑（Bug B）

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

### 3.7 交互逻辑与显示项（Bug B）

| 场景 | 应用内表现 | 平台侧 | 备注 |
|------|-----------|--------|------|
| 真发布成功 | 进度面板 `zhihu / published! 100%`；发布记录 URL 形如 `https://zhuanlan.zhihu.com/p/<id>`，`post_id` 有值 | 文章公开可见 | 修复后新增 `postId` 回填 |
| 只落草稿（本次事故形态） | **不再显示成功**；进度面板按失败处理并给出原因文案 | 平台只有草稿 | 修复前：显示成功但平台只有草稿 |
| 停在写作页（风控/校验拦住） | 失败，原因 `unexpected-page` | 未发布 | 不补点，避免双草稿 |
| 草稿页按钮找不到 | 失败，原因 `draft-editor-publish-button-missing` | 草稿已建 | 如实告知 |
| 补点后仍在草稿页 | 失败，原因 `draft-editor-still-not-published` | 草稿已建 | 如实告知（这是本次报障的最坏子情形） |
| 用户选「存草稿」 | 与修复前一致：`draft: true` 分支返回成功（草稿语义） | 平台草稿 | 见 §3.10 遗留 |

### 3.8 提示文字（Bug B，逐字）

- **失败**（`RpaVmPublisher` 透传 `result.error`）：
  - `zhihu: publish not confirmed (unexpected-page) url=https://zhuanlan.zhihu.com/write`
  - `zhihu: publish not confirmed (draft-editor-publish-button-missing) url=https://zhuanlan.zhihu.com/p/<id>/edit`
  - `zhihu: publish not confirmed (draft-editor-still-not-published) url=https://zhuanlan.zhihu.com/p/<id>/edit`
- **日志**：`[WARN] RpaView [zhihu] publish not confirmed reason=<reason> url=<url>`（状态机内一次 + 调用点一次）
- **成功**：进度文案不变（`publishing...` 80% → `verifying...` 95% → `published!` 100%），但**判定依据**从「URL 含 `/p/`」换成「URL 严格等于公开文章页」
- **未确认的旧文案 `zhihu: publish verification failed`**：随 `panelGone` 兜底一并移除（不再存在第二个成功出口）

### 3.9 测试与反证（Bug B）

| 文件 | 用例数 | 覆盖 |
|------|-------|------|
| `apps/desktop/electron/services/zhihu-publish-state.test.js` | 39 | 公开页/草稿页/写作页/尾段伪装/域名伪装/协议白名单/空值；两段式状态机 7 例（含「补点后仍未离开草稿页 ⇒ published:false」「写作页不补点」「按钮缺失不点空」「读 URL 抛错不冒泡」「时限可注入」） |
| `apps/desktop/electron/services/rpa-view-platforms-zhihu-publish.test.js` | 5 | 公开页判成功带 `postId`；两段式补点（点击 2 次、等元素 2 次）；补点后仍在草稿页 ⇒ 失败；写作页 ⇒ 失败且只点 1 次；**结构锁**（源码必须经 `confirmZhihuPublished`，不得再出现 `curUrl.includes('publish'|'success'|'article')` 与 `panelGone`） |
| `apps/desktop/electron/services/rpa-view-platforms.test.js` | 既有 + 替换 1 例 | 原「草稿编辑页 ⇒ success」用例已**改写为反例**（`expect(success).toBe(false)` + error 含 `not confirmed`），并把新增用例拆到上一个文件以避免测试文件 1500 行门禁 |

合计 126 例（三个文件）✅ 全绿。**变异反证**：把 `isZhihuPublishedUrl` 放宽为「路径包含 `/p/`」→ `zhihu-publish-state.test.js` 的 `/edit` 反例、（若放宽到 URL 子串）结构锁与组件级用例当场红。

### 3.10 遗留（不假装已闭合）

- **知乎真机复核待执行**：需要一次真实发布验证「两段式补点」在真机上确实能把稿子发出去（判据：发布记录 `url` 无 `/edit`、`post_id` 非空、公开页可访问）。**未复核前不得声称「知乎发布已修复」**——本次修复已确保「不再谎报成功」，但「补点后一定成功」仍需真机证实。
- **`draft: true`（用户选存草稿）仍返回成功**：语义上是「草稿已存」而非「已发布」，但上层 `RpaVmPublisher` 不区分 `draft`，UI 仍显示发布成功。这与本次报障不是同一件事（本次是**未选草稿**却只落了草稿），登记为遗留。
- **失败重试的重复发帖风险**：新判据把「未确认」判为失败，若队列自动重试，理论上存在「其实已发布 + 重试再发一篇」的风险。本次未改重试策略；缓解点是 `unexpected-page` 一类失败发生在「未补点」情形（大概率确实未发布），而 `draft-editor-still-not-published` 属「补点后仍未跳转」，需人工确认后再重试。
- **其它 RPA 平台的同族假成功判据未审计**：本文件 (`rpa-view-platforms.js`) 其它平台的成功判据形态各异，是否存在「子串命中即成功」的同族缺陷**本次未逐个取证**（头条已有作品列表 API 判据、公众号有专用判定测试），登记为下一轮审计项。

### 3.11 真机复核 runbook（两条 bug 共用）

1. 用含本次修复的构建（隔离 worktree 内 `pnpm dev` 或打包产物）启动应用，确认账号登录态有效。
2. 发一条**已知分段结构**的图文到 百家号 + 知乎（各一篇，标题可标注测试用途）。
3. 百家号：抓 `https://baijiahao.baidu.com/s?id=<postId>`，在 `div[data-testid="article"]` 内数 `<p>` ⇒ **应等于源文自然段数**（源文段数从 `rewrite_history.rewritten_content` 的 `\n\n` 计数得出）。
4. 知乎：读发布记录（`tracked_content`）⇒ `url` 必须是 `https://zhuanlan.zhihu.com/p/<id>`（**无 `/edit`**）且 `post_id` 非空；打开该 URL 应能看到已发布文章。
5. 把两次取证的原始数字写回 `openspec/records/fix-article-paragraph-zhihu-publish.md` 的「真机复核」行，并把 `.quality-gates.md` 对应条目的远程同步/真机状态收口。

---

## 4. 变更清单（文件级）

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/shared-utils/src/article-body-format.js` | 新增 | 正文承载形态原语（CJS）：`HTML_TAG_PATTERN` / `hasHtmlTags` / `escapeHtml` / `textToParagraphHtml` / `toHtmlBody` |
| `packages/shared-utils/src/article-body-format.browser.js` | 新增 | 渲染端 ESM 孪生（逐行同源） |
| `packages/shared-utils/src/__tests__/article-body-format-parity.test.js` | 新增 | 逐行同源 + 导出面 + 与发布链逐字节同判据 + 事故形态反证（9 例） |
| `apps/desktop/vite.config.js` | 修改 | 登记 `@multi-publish/shared-utils/src/article-body-format` → `.browser.js` alias |
| `apps/desktop/src/components/ArticleEditor.vue` | 修改 | `richContent.get()` 由直传 `modelValue` 改为 `toHtmlBody(modelValue)` |
| `apps/desktop/src/components/ArticleEditor.test.js` | 修改 | 新增 7 例（装载保真 + 结构锁） |
| `apps/desktop/src/components/ArticleEditor.quill-load.test.js` | 新增 | 真实 Quill（不 mock）DOM 级 4 例 |
| `apps/desktop/electron/services/zhihu-publish-state.js` | 新增 | 知乎终态判据 + 两段式确认状态机 |
| `apps/desktop/electron/services/zhihu-publish-state.test.js` | 新增 | 判据穷举 + 状态机（39 例） |
| `apps/desktop/electron/services/rpa-view-platforms.js` | 修改 | `_publish_zhihu` 接入状态机、删除 `panelGone` 兜底、成功带 `postId`（净 +2 行，满足行数门禁点名还账零增长） |
| `apps/desktop/electron/services/rpa-view-platforms.test.js` | 修改 | 原「草稿页判成功」用例改写为反例 |
| `apps/desktop/electron/services/rpa-view-platforms-zhihu-publish.test.js` | 新增 | 知乎发布终态行为级 + 结构锁（5 例） |

文档：`01-docs/BUGFIX-ARTICLE-PARAGRAPH-AND-ZHIHU-PUBLISH-2026-10-15.md`（本文件）、`01-docs/PRD-ARTICLE-BODY-FORMAT-2026-10-12.md`（根因修正 + 真机判据）、`01-docs/PRD-API-PUBLISH-ENGINE.md`（§12.1 指针）、`01-docs/PRD.md`（知乎发布流程与记录字段）、`AGENTS.md`（QM-2 新增「富文本编辑器装载合同」）、`CHANGELOG.md`、`01-docs/learnings.md`、`openspec/changes/fix-article-paragraph-zhihu-publish/**`、`openspec/records/fix-article-paragraph-zhihu-publish.md`、`.quality-gates.md`。

---

## 5. 验收标准

| # | 标准 | 判据 |
|---|------|------|
| 1 | 编辑器装载保真 | 纯文本 `N` 段装载后，真实 Quill DOM 里恰好 `N` 个 `<p>`（已自动断言） |
| 2 | 装载与发布同判据 | `toHtmlBody(x) === formatArticleBody(<html 平台>, x)` 对全部向量逐字节相等（已自动断言） |
| 3 | 幂等 | 二次归一不产生二次包装（已自动断言） |
| 4 | 知乎不谎报 | 任何非公开文章页 URL 一律 `success:false`（已自动断言，含 `/edit` 反例） |
| 5 | 知乎真发布 | 真机发布后 `url` 无 `/edit`、`post_id` 非空、公开页可访问（**待真机**） |
| 6 | 百家号真发布 | 公开页 `div[data-testid="article"]` 内 `<p>` 数 == 源文段数（**待真机**） |
| 7 | 门禁 | `check-renderer-cjs-boundary` / `check-max-lines` / 引擎全量 / 桌面相关测试全绿（已跑） |

---

## 6. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-10-15 | 首版：两条报障的第一性根因（编辑器装载吞段落 / 知乎草稿页假成功）、真机取证数字、方案对比与三条不可破、数据校验、流程、交互与显示项、逐字提示文字、逃逸链、系统性漏洞与预防、真机复核 runbook、遗留清单 |
