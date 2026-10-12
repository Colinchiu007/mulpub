# PRD — 图文正文承载形态适配（publish-article-body-format）

| 项目 | 内容 |
|------|------|
| 版本 | v1.0（2026-10-12） |
| 分支 | `fix-article-body-format`（隔离 worktree `D:/Data/projects/mp-worktrees/mp-fix-article-body-format`，基线 `origin/main` = `c5a355f7d`） |
| change | `openspec/changes/article-body-format` |
| 执行记录 | `openspec/records/fix-article-body-format.md`、`.quality-gates.md` 同名条目 |
| 变更类型 | 🐛 Bug 修复（用户报障：百家号图文正文「一整段文字」） |
| 状态 | 代码 + 单测已落地；**真机复核待执行**（判据见 §12.3，未复核前不得声称端到端已通） |

---

## 1. 背景与用户报障

用户报障原文：

> 成功发布到百家号的图文内容，在百家号的平台查看时，发现文章正文的文字都没有分段，是一整段文字，用户体验很不好。
> 查一下是发布时的正文格式的自身问题，还是在发布时传参不对的问题。另外，查一下所有其他的自媒体平台，是否发布图文内容也有同样的问题。

拆成三个必须回答的问题：

| # | 问题 | 本文档结论 |
|---|------|-----------|
| Q1 | 是「正文内容本身就没有分段」吗？ | **否**。落库源文含 `\n\n` 空行分段（例：863 字符 / 8 个换行 / 5 个自然段） |
| Q2 | 是「发布时传参不对」吗？ | **是**。百家号 `content` 是富文本编辑器的 **HTML** 字段，链路把纯文本原样塞进去；HTML 把换行当**可忽略空白**，整篇正文被平台存成单个文本节点 |
| Q3 | 其他自媒体平台有没有同样的问题？ | 分三类：**同类已确认**（百家号）、**同类先例已被修**（公众号 2026-10-12、头条直连兜底）、**反向同类缺陷**（HTML 进纯文本字段：抖音/小红书/快手/B站/视频号描述，本次一并修）、**待真机复核**（DOM 轨 contenteditable 注入路径）。逐平台判定见 §4 |

---

## 2. 结论先行

**根因是发布期的「正文承载形态」不匹配，而不是正文内容质量问题。**

每个平台的正文字段都有固定承载形态：

- **HTML 承载**（富文本编辑器语义）：`<p>` 是段落唯一表达方式，裸换行不产生段落；
  - 百家号 `/pcui/article/save|publish` 的 `content`
  - 头条 `mp/agw/article/publish` 的 `content`（参考产品字段表内部名 `htmlContent`）
  - 公众号编辑器（ProseMirror，HTML 语义）
- **纯文本承载**（描述语义，字数按可见字符算）：
  - 抖音 `content_desc`、小红书 `desc`、快手 `caption`、B 站 `desc`、视频号 `description`、微博 `content` 等

把纯文本发进 HTML 字段 ⇒ 段落全部塌掉（本次事故）；把 HTML 发进纯文本字段 ⇒ `<p>` 以**字面量**出现在作品描述里（反向同族缺陷，本次一并修）。

---

## 3. 取证（可复现）

> 所有取证都在本机真实运行态完成，未依赖任何猜测或截图描述。

### 3.1 平台产物取证（公开页）

对用户账号已发布的 **11 篇**百家号图文逐篇抓取公开页（`https://baijiahao.baidu.com/s?id=<postId>`），解析 `data-testid="article"` 容器内的正文 HTML：

| postId | 标题 | 正文 `<p>` 数 | `<br>` 数 | 原始换行数 | 正文字节 |
|--------|------|--------------|-----------|-----------|---------|
| 1878588576245723518 | 超长蛋挞陆续下架 | **0** | 0 | 0 | 855 |
| 1878584801331183679 | 十五五开局六张网齐铺开 | **0** | 0 | 0 | 1235 |
| 1878588576245723518 同批另 9 篇 | … | **0** | 0 | 0 | — |

**11/11 篇正文 `<p>` 数为 0**，正文是 `<div class="dpu8C">` 里的**一个裸文本节点**。

### 3.2 源内容取证（本机落库）

同一条内容的「发布前真源」在 `shared-user-data/multi-publish.db` 的 `rewrite_history.rewritten_content`：

| 内容 | 落库时间 | 字符数 | 换行数 | 自然段数 | 发布时刻 |
|------|---------|-------|--------|---------|---------|
| 超长蛋挞陆续下架 | 2026-10-09T15:50:16Z | 863 | 8 | 5 | 2026-10-09T16:01:14Z |
| 十五五开局六张网齐铺开 | 2026-10-09T14:54:51Z | 1263 | 28 | 15 | 2026-10-09T15:01:14Z |

发布记录（`shared-user-data/publish-history.jsonl`）给出 `postId`，把两边对起来。

### 3.3 逐字节对账（判据取产物，不取推测）

| 对账项 | 结果 |
|--------|------|
| 源文去掉全部 `\n` 后 == 平台正文字符串 | **True**（超长蛋挞：855 == 855） |
| 源文去掉全部 `\n` 后 == 平台正文字符串 | **True**（十五五：1235 == 1235） |
| 平台正文 `<p>` / `<br>` 数 | 0 / 0 |

**即：平台正文字节与源文完全相同，唯一差异就是「换行全部消失」。** 这排除「内容被截断/被改写/被平台改写」等可能，定位到换行/段落在传输形态上被吞。

### 3.4 复现脚本（只读，零外发副作用）

```bash
# 1) 取已发布文章的 postId
python - <<'PY'
import json, io
for l in io.open(r"D:/Data/projects/mulpub/shared-user-data/publish-history.jsonl", encoding="utf-8"):
    r = json.loads(l)
    if r.get("platform") == "baijiahao" and (r.get("result") or {}).get("postId"):
        print(r["timestamp"], r["title"], r["result"]["postId"])
PY

# 2) 抓公开页正文并数 <p>（判据：p=0 即复现）
#    容器锚点 data-testid="article" 内 <!--s-frag-->…<!--/s-frag-->
```

### 3.5 反证：为什么不是「正文本身没分段」

- `rewrite-engine` 早在 2026-10-03（`fix-rewrite-paragraph-preserve`）就把「结构不变量（不得改变输入换行/分段结构）」写成硬约束，并在引擎内置硬约束与运营中心种子里都写明「按空行分段、禁止整篇压成一段」；本次取证的 `rewrite_history` 数据确实含 `\n\n`。⇒ 上游合规。
- 同一份内容发到快手（纯文本承载）时正文分段正常（用户报障仅提百家号；快手链路 `caption` 保留 `\n`）。⇒ 不是内容问题。

---

## 4. 全平台审计矩阵（Q3 的答案）

判定口径：**内容字段的承载形态** × **该字段是否收到形态匹配的字符串**。

| 平台 | 内容形态 | 发布通道 | 正文字段 | 承载形态 | 判定 | 证据 |
|------|---------|---------|---------|---------|------|------|
| 百家号 | 图文 | api | `content`（`buildArticleFormData`） | HTML | 🔴 **已确认缺陷（本次修）** | 公开页 11/11 篇 0 个 `<p>`；源文 vs 产物逐字节对账 |
| 公众号 | 图文 | dom（专用 `wechat-mp-article.js`）+ **api 草稿轨（`wechat-mp/*`，2026-10-12 #3375 新落地）** | ProseMirror 编辑器 / `content0` | HTML | 🟢 已修复（DOM 轨同日 PR；**API 轨本次接入 `formatArticleBody`**） | DOM：`hasHtmlTags ? raw : toParagraphHtml(plain)` + paste/JSAPI；API：`wechat-mp/draft.js` 的 `content0` 经本层（HTML 幂等、纯文本成段） |
| 头条 | 图文 | dom 优先 + Node 直连兜底 | `content`（内部名 `htmlContent`） | HTML | 🟠 同类先例已修（直连轨）；DOM 轨待复核 | `packages/rpa-engine/src/toutiao-direct-bridge.js:33` 已 `<p>` 包装（**第二份实现**，待收敛） |
| 头条/百家号/公众号 | 图文 | — | 「正文进编辑器」 | HTML | 🟡 DOM 轨待复核 | `_fillInput` 的 contenteditable 分支走 `execCommand('insertText')`；离屏无法判定编辑器模型是否成段 |
| 知乎 | 图文 | dom（专用分支） | Draft.js（纯文本模型） | 纯文本 | 🟢 按平台语义处理 | `rpa-view-platforms.js` 先把 HTML 转 `\n\n` 纯文本，再走 CDP `Input.insertText` |
| 微博 | 图文 | dom（generic） | `content_textarea` 原生 textarea | 纯文本 | 🟢 不受影响 | textarea 的 `value` 原样保留 `\n` |
| 小红书 | 图文 | dom（仅草稿）；api 草稿链保留 | 编辑器 / `desc` | 纯文本 | 🟢 反向缺陷已修 | `xiaohongshu-draft.js` 的 `desc`，本次接入 `formatArticleBody` |
| 快手 | 图文 | dom（generic） | `caption`（contenteditable） | 纯文本 | 🟢 反向缺陷已修（caption 语义）；编辑器换行待复核 | `_composeEditorCaption` 已 HTML→纯文本；`kuaishou-video.js` 的 `caption` 本次接入 |
| 抖音 | 图文 | api | `content_desc` | 纯文本 | 🟢 反向缺陷已修 | `douyin-image.js` / `douyin-video.js` 本次接入 `formatArticleBody` |
| B 站 | 视频（无图文 API 轨） | api | `desc` | 纯文本 | 🟢 反向缺陷已修 | `bilibili-video.js` 本次接入 |
| 视频号 | 视频/音乐 | api | `description` | 纯文本 | 🟢 反向缺陷已修 | `shipinhao-video.js` 本次接入 |
| YouTube / TikTok / Twitter / Instagram / Facebook | 视频/图文 | dom（generic） | `caption` / 描述 | 纯文本 | 🟡 待复核（无本机成功发布样本） | 走 `_fillInput`；textarea 分支无风险，contenteditable 分支同上 |

**判据分类**：🔴 已确认缺陷（有平台产物证据）｜🟠 同类先例（同族修法已存在但未收敛）｜🟡 待真机复核（离屏不可判定，须按 §12.3 复核）｜🟢 不受影响或已修。

> 诚实边界：🟡 项**不是**「已通过」，而是「本机无公开产物/无可用账号，未取得证据」。复核 runbook 见 §12.3。

---

## 5. 方案

### 5.1 单一实现（新增于 `packages/api-publish-engine/src/content-formatter.js`）

内容格式化的既有单一真源（话题三态、标题/正文截断）扩展一层**正文承载形态适配**：

| 函数 | 职责 |
|------|------|
| `hasHtmlTags(value)` | 真标签判据：`<` 后必须是**白名单标签名**（`p/div/br/a/img/h1-h6/ul/ol/li/blockquote/pre/code/strong/em/hr/table/…`，允许属性与自闭合） |
| `textToParagraphHtml(text)` | 纯文本 → 段落 HTML：每个非空行一个 `<p>…</p>`，转义先行，CRLF 归一，空行不产出空 `<p>` |
| `htmlToPlainText(html)` | HTML → 纯文本：`<br>` → `\n`，块级闭合 → `\n`，实体解码，3+ 连续换行压成 2 |
| `getArticleBodyKind(platform)` | `'html'`（百家号/头条/公众号）或 `'plain'`（其余 + 未知平台保守按 plain） |
| `formatArticleBody(platform, content)` | 按形态适配：HTML 平台「纯文本→`<p>`／已是 HTML 幂等透传」；纯文本平台「HTML→纯文本／纯文本原样」 |

**为什么判据用白名单而不是「`<` 后跟字母」**：技术类正文里的代码片段（`#include <stdio.h>`、`vector<int>`）在宽判据下会被当成标签并**整段吃掉**（本仓既有 `stripHtmlToPlainText` 即有此边界，实测用例锁在 `content-formatter.test.js`）。

### 5.2 接线点（全部为「发布前最后一跳」）

| 文件 | 字段 | 形态 |
|------|------|------|
| `publish/platforms/baijiahao-article.js` | `content` | html |
| `adapters/wechat-mp/draft.js` | `content0`（公众号草稿 API 轨） | html |
| `publish/platforms/douyin-image.js` | `content_desc` | plain |
| `publish/platforms/douyin-video.js` | `content_desc` | plain |
| `publish/platforms/kuaishou-video.js` | `caption` | plain |
| `publish/platforms/bilibili-video.js` | `desc` | plain |
| `publish/platforms/shipinhao-video.js` | `description` | plain |
| `publish/platforms/xiaohongshu-draft.js` | `desc` | plain |

### 5.3 顺序不变量（不可颠倒）

百家号话题转换必须**先在纯文本上完成**，再整体包 `<p>`：

```
原始 content（纯文本，含 `#话题`）
  → convertInlineTopics('baijiahao', …)   // `(^|\s)#话题` 前置边界成立
  → formatArticleBody('baijiahao', …)     // 整体包 <p>
```

反序会因 `<p>` 紧邻 `#`（`>` 不是空白）使内联话题**停在内联形态不被转换**（`#话题` 而非 `#话题#`）。该顺序由 `baijiahao-article-chain.test.js` 的精确断言锁定。

---

## 6. 数据校验

### 6.1 输入 → 输出矩阵（逐条有测试）

| 输入 | 平台形态 | 期望输出 | 边界理由 |
|------|---------|---------|---------|
| `"第一段\n\n第二段"` | html | `"<p>第一段</p><p>第二段</p>"` | 空行分段 |
| `"行一\n行二"` | html | `"<p>行一</p><p>行二</p>"` | 与头条/公众号既有实现同口径（单换行亦段界） |
| `"a\r\nb"` | html | `"<p>a</p><p>b</p>"` | CRLF 归一，不留 `\r` |
| `"a & b <c>"` | html | `"<p>a &amp; b &lt;c&gt;</p>"` | 转义先行，不制造标签注入面 |
| `""` / `"   \n  "` / `null` | html | `""` | 不产出空 `<p>` |
| `"<p>甲</p><p>乙</p>"` | html | 原样（幂等） | 富文本编辑器产物不得二次包装 |
| `"<p>a</p><p>b</p>"` | plain | `"a\nb"` | 块级标签收口为换行 |
| `"<div>a<br>b</div>"` | plain | `"a\nb"` | `<br>` 为单换行 |
| `"<p>a &amp; b</p>"` | plain | `"a & b"` | 实体解码 |
| `"第一段\n\n第二段"` | plain | 原样 | 纯文本平台零契约变更 |
| `"代码 #include <stdio.h> 结尾"` | plain | 原样 | 白名单判据不误伤代码尖括号 |
| `"价格 <100 元"` | 任意 | 不是 HTML | 数学比较不是标签 |
| 未知平台 | — | 按 `plain` | 保守：不改写未知平台内容 |

### 6.2 输出契约（不变量）

1. **幂等**：`formatArticleBody(p, formatArticleBody(p, x)) === formatArticleBody(p, x)`（HTML 已成形不再包装）。
2. **无空段**：输出不含 `<p></p>`；空/空白输入返回 `""`。
3. **无标签注入面**：纯文本转 HTML 前必须转义 `& < >`，不得让用户文本产生真实标签。
4. **不改写未知平台**：`getArticleBodyKind` 未知 ⇒ `plain`，原样透传纯文本。
5. **文本结构断言**：本层测试一律 **`toBe` 精确串断言**（禁止只用 `toContain`）——
   见 AGENTS.md「文本结构断言（MUST）」：纯子串断言对「正文被压成一整行」完全免疫。

### 6.3 fail 语义

| 场景 | 行为 |
|------|------|
| 正文为空 | 返回 `""`；链路按各自既有语义处理（百家号仍以 `title` 校验 fail-closed） |
| 内容同时含真标签与代码尖括号 | 只剥/包白名单标签，代码尖括号原样保留 |
| 链接读取不到编辑器 | 与本层无关（DOM 轨的失败语义不变） |

---

## 7. 流程

### 7.1 百家号图文链（改造后）

```
ApiPublisher / 任务队列
  └─ BaijiahaoArticleChain.run(taskData, {draft})
       ├─ 1) 前置校验（缺 cookie / userAgent → fail-closed 零请求）
       ├─ 2) GET /?source=inner            → baseToken
       ├─ 3) GET /pcui/article/edit        → publishToken（响应头 token）
       ├─ 4) uploadproxy（有图时）
       ├─ 5) buildArticleFormData(taskData)          ★ 本次改造点
       │     ├─ title：UTF-8 字节安全截断 149
       │     ├─ content：convertInlineTopics → formatArticleBody('baijiahao', …) ⇒ `<p>` HTML
       │     ├─ category / reward_money / is_pay_column / type=news
       │     ├─ project_cover（有封面时）/ original=1（原创时）
       │     └─ activity_list[0][id]=aigc_bjh_status + is_checked
       └─ 6) POST /pcui/article/save?callback=bjhdraft（私密优先）
             或 POST /pcui/article/publish?type=news&callback=bjhpublish
```

### 7.2 客户端到发布的形态链（用户视角）

```
富文本编辑器（Quill, content-type=html） ─┐
Markdown / 纯文本输入                    ─┼─→ article.content（字符串）
AI 创作 / 采集改写 / 爆款库改写（纯文本 + \n\n）─┘
        │
        ├─ 渲染层：原样提交（不做平台形态改写）
        └─ 发布层：各链在**写字段前最后一跳**调用 formatArticleBody(platform, content)
```

**原则**：形态适配放在**发布链**（离平台字段最近、单一实现、可单测）；渲染层不重复实现（避免两份口径漂移）。

---

## 8. 功能逻辑（明细）

### 8.1 `hasHtmlTags`

- 输入：任意值（`null` ⇒ `""`）。
- 输出：布尔。命中白名单标签（开标签/闭标签/自闭合/带属性）⇒ `true`。
- 反例（必须为 `false`）：`价格 <100 元`、`&lt;p&gt;`、`#include <stdio.h>`、`vector<int>`。
- 理由：形态判定错一次，用户可见损失是「代码示例被吃掉」或「整篇段落塌掉」。

### 8.2 `textToParagraphHtml`

- 切分：`split(/\r?\n/)` → 逐行 `trim()` → 非空行成段。
- 转义：`&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`（顺序：先 `&`）。
- 输出：`<p>…</p>` 直接拼接（无分隔符、无空段）。
- 空输入：`""`。

### 8.3 `htmlToPlainText`

- `<br>`/`<br/>` → `\n`；块级闭合（`</p></div></li></h1-6></blockquote></section></article></tr>`）→ `\n`。
- 白名单标签整体剥离；实体解码（`&nbsp; &lt; &gt; &quot; &#39; &amp;`）。
- 收口：`[ \t]+\n` → `\n`；`\n{3,}` → `\n\n`；首尾 `trim()`。

### 8.4 `getArticleBodyKind` / `formatArticleBody`

- `HTML_BODY_PLATFORMS = { baijiahao, toutiao, wechat_mp }`；`PLAIN_BODY_PLATFORMS` 列出 12 个纯文本平台（清单即文档，新增平台须显式登记）。
- 未知平台：`plain`（保守不变换）。

---

## 9. 交互逻辑（用户视角）

| 场景 | 改造前 | 改造后 |
|------|--------|--------|
| 富文本模式写正文 → 发百家号 | 已是 HTML，平台正常分段（但 `<stdio.h>` 类内容有被编辑器吞掉的隐患） | 幂等透传，行为不变 |
| Markdown / 纯文本写正文 → 发百家号 | **平台显示一整段** | 按行成段，平台显示多段 |
| AI 创作 / 采集改写（`\n\n` 纯文本）→ 发百家号 | **平台显示一整段**（本次报障场景） | 多段 |
| 富文本 HTML → 发抖音/小红书/快手/B站/视频号 | 描述里出现字面量 `<p>` | 自动剥标签，描述干净 |
| 纯文本 → 发抖音/小红书/快手 | 不变 | 不变（零契约变更） |
| 任意内容 → 发未知平台 | 不变 | 不变（保守） |

- **无新增交互**、无新增弹窗、无新增表单字段、无新增 IPC 通道。
- 不改变正文截断上限、不改变标题截断、不改变话题三态行为（仅顺序显式化）。

---

## 10. 显示项与提示文字

| 项 | 本次处理 |
|----|---------|
| UI 显示项 | **零新增**。正文仍按用户输入原样显示在编辑器（用户看到的是自己写的内容，不是平台产物） |
| 提示文字 | **零新增/零修改**。百家号风控/登录失效提示、发布失败详情展示、i18n key（`publish.api.baijiahao.*`）全部沿用 |
| 日志 | 不改日志格式；链路已有 `logger` 字段保持不提正文（隐私口径不变） |
| 真机复核产物 | 复核用具临时输出（§12.3），不进产品 UI、不进 locale |

> 若后续要在 UI 上提示「本次正文将按平台格式成段」，属 P2 体验增强，本期不做（避免为不可见差异增加文案与 locale 成对维护面）。

---

## 11. 测试映射

| 文件 | 用例 | 断言形态 |
|------|------|---------|
| `packages/api-publish-engine/test/content-formatter.test.js` | 新增 12 例（`hasHtmlTags` / `textToParagraphHtml` / `htmlToPlainText` / `getArticleBodyKind` / `formatArticleBody` / 代码尖括号不误伤） | **`assert.deepStrictEqual` 精确串** |
| `packages/api-publish-engine/test/baijiahao-article-chain.test.js` | 新增 4 例：多段→HTML 段落、单段也包 `<p>`、已是 HTML 幂等、话题转换先于包装 | `toBe` 精确串（表单 `content` 解码后） |
| `packages/api-publish-engine/test/topic-inline-contract.test.js` | B-5 契约更新：`content` = `<p>今天探店 #话题# 太好吃了</p>` | `toBe` 精确串 |
| `packages/api-publish-engine/test/douyin-image-chain.test.js` | 新增 1 例：HTML → `content_desc` 纯文本 | `toBe` 精确串 |
| `packages/api-publish-engine/tests/xiaohongshu-draft-chain.test.js` | 新增 1 例：HTML → `desc` 纯文本 | `toBe` 精确串 |

**TDD 记录**：先写测试并实跑 **红**（`content-formatter` 12 例 + vitest 6 例失败），再实现，后 **绿**（`content-formatter` 62/62、定向 vitest 94/94、引擎全量 39 文件 333 用例 rc=0）。

---

## 12. 验收标准

### 12.1 自动化（已达成）

- [x] `content-formatter.test.js` 62/62 全绿（含 12 例新用例）
- [x] `baijiahao-article-chain.test.js` 14 例全绿（含 4 例新契约）
- [x] `topic-inline-contract.test.js` 15 例全绿（B-5 契约已更新）
- [x] `douyin-image-chain` / `douyin-video-chain` / `kuaishou-video-chain` / `bilibili-video-chain` / `shipinhao-video-chain` / `xiaohongshu-draft-chain` 全绿
- [x] 引擎全量 `node scripts/run-tests.js` rc=0（39 vitest 文件 / 333 用例 + direct 组）

### 12.2 结构（已达成）

- [x] 话题转换顺序不变量有精确断言
- [x] 代码尖括号（`<stdio.h>`）不被吃（正/反两向用例）
- [x] 空输入不产出空 `<p>`
- [x] 幂等性（HTML 不再包装）

### 12.3 真机复核 runbook（**待执行**，判据取平台产物）

```bash
# 步骤 1：用运行中的应用发一条**多段**图文到百家号（草稿或正式）
# 步骤 2：取 postId（发布历史 JSONL / 后台地址栏）
# 步骤 3：抓公开页，数容器内 <p>
python - <<'PY'
import re, urllib.request, html as H
pid = "<postId>"
req = urllib.request.Request(f"https://baijiahao.baidu.com/s?id={pid}",
    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"})
page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
i = page.find('data-testid="article"'); seg = page[i:]
j = seg.find('<!--s-frag-->'); k = seg.find('<!--/s-frag-->', j + 1)
body = seg[j + len('<!--s-frag-->'):k]
print("p =", body.count("<p"), "| paragraphs expected =", "<源文自然段数>")
PY
```

| 判据 | 通过条件 |
|------|---------|
| `<p>` 数 | **等于源文自然段数**（≥2 即证明分段生效） |
| 段落文本 | 与源文逐段一致（除段落标签外无字符差异） |
| 反向复核 | 发一条富文本 HTML 内容到抖音/小红书，描述中**不含**字面量 `<p>` |

> 未执行原因如实登记：真机发布需要有效账号会话 + 消耗当日发布额度，且本 PR 的改动面在「写字段前最后一跳」，可先由公开页 `<p>` 计数验证；复核未完成前**不得**把本项写为已通过。

---

## 13. 影响面与兼容性

| 维度 | 结论 |
|------|------|
| 依赖 | 零新增依赖（纯字符串处理） |
| 导出 | `content-formatter` 仅**新增**导出，既有导出签名不变 |
| 下游 | `publisher-router.js` 已在用 `extractInlineTopicNames`（未变）；新增导出为附加，无破坏 |
| 数据 | 无 schema/迁移/存储变更 |
| locale | 无新增文案 ⇒ 无 locale 成对改动 |
| 打包 | 未改 `apps/desktop/electron/**`、未改 `packages/rpa-engine/**` ⇒ QM-1 打包触发条件不满足（如实记账，不伪造打包证据） |
| 回滚 | 单 commit 反向 revert 即可；无状态残留 |

---

## 14. 遗留与后续（不假装已闭合）

1. **DOM 轨 contenteditable 注入未取证**（🟡）：`_fillInput` 的 contenteditable 分支用 `document.execCommand('insertText')`，多段纯文本最终是否在平台编辑器模型里成段，**离屏不可判定**。复核判据同 §12.3（对抖音/小红书/头条/快手/YouTube 等公开页或草稿箱逐平台数段落）。
2. **同一族逻辑仍有两份实现**（收敛待办）：`apps/desktop/electron/services/rpa-view-navigation-helpers.js` 的 `stripHtmlToPlainText`、`wechat-mp-article.js` 的 `toParagraphHtml`/`hasHtmlTags`、`packages/rpa-engine/src/toutiao-direct-bridge.js:33` 的内联 `<p>` 拼接。三者语义与本次新增层一致但互不可见；**且前三者的宽判据（`<` 后跟字母）会误伤代码片段**（本次已在引擎侧用白名单收窄）。收敛它们需改 `apps/desktop/electron/**`（触发 QM-1 打包验证），故拆为后续 PR。
3. **Markdown → HTML 未做**：`# 标题` / `**粗体**` 等 Markdown 语法进 HTML 承载平台仍是字面量（与改造前一致，非本次回归）。若要支持，应新增显式 md→html 步骤并同步各平台白名单。
4. **正文内联图片**：百家号 `content` 的内联图片（`<img>`）与 `project_cover` 的关系未在本次改动；图片链沿用既有 `uploadproxy` 语义。
5. **平台侧再规范化**：无法排除平台对超长/特殊字符正文的二次处理；若真机复核发现段落仍被合并，需按产物 HTML 反推平台期望形态（可能需 `<p style=…>` 或编辑器专用字段）。

---

## 15. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-10-12 | 首版：现象/取证（11/11 篇 `<p>`=0、逐字节对账）/全平台审计矩阵/形态合同与单一实现/数据校验/流程/交互/显示项/测试映射/真机 runbook/遗留 |
