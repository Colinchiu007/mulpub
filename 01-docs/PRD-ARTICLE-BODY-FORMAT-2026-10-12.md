# PRD — 图文正文承载形态适配（publish-article-body-format）

| 项目 | 内容 |
|------|------|
| 版本 | v2.0（2026-10-15 根因修正；v1.0 = 2026-10-12） |
| 分支 | v1.0：`fix-article-body-format`（worktree `mp-fix-article-body-format`，基线 `c5a355f7d`）；**v2.0：`fix-article-paragraph-zhihu-publish`（worktree `mp-fix-article-paragraph-zhihu-publish`，基线 `58256ffc8`）** |
| change | v1.0：`openspec/changes/article-body-format`；**v2.0：`openspec/changes/fix-article-paragraph-zhihu-publish`** |
| 执行记录 | v1.0：`openspec/records/fix-article-body-format.md`；**v2.0：`openspec/records/fix-article-paragraph-zhihu-publish.md`** |
| 变更类型 | 🐛 Bug 修复（v1.0：用户报障「百家号图文正文一整段」；v2.0：同一症状**二次报障**，定位到真正的第一性原因并修正结论） |
| 状态 | 代码 + 单测已落地（三层）；**真机复核待执行**（v2.0 判据见 §15.6，未复核前不得声称端到端已通） |

---

## 1. 背景与用户报障

用户报障原文：

> 成功发布到百家号的图文内容，在百家号的平台查看时，发现文章正文的文字都没有分段，是一整段文字，用户体验很不好。
> 查一下是发布时的正文格式的自身问题，还是在发布时传参不对的问题。另外，查一下所有其他的自媒体平台，是否发布图文内容也有同样的问题。

拆成三个必须回答的问题：

| # | 问题 | 本文档结论 |
|---|------|-----------|
| Q1 | 是「正文内容本身就没有分段」吗？ | **否**。落库源文含 `\n\n` 空行分段（例：863 字符 / 8 个换行 / 5 个自然段） |
| Q2 | 是「发布时传参不对」吗？ | **是**。百家号 `content` 是富文本编辑器的 **HTML** 字段，链路把纯文本原样塞进去；HTML 把换行当**可忽略空白**，整篇正文被平台存成单个文本节点。**⚠️ v2.0 修正（2026-10-15）**：本条只描述了「发布链」这一段；用户二次报障后取证发现**真正的第一性原因是内容在更上游的编辑器装载阶段就已塌成一段**，发布链侧只是把单段 HTML 幂等透传。详见 §15 |
| Q3 | 其他自媒体平台有没有同样的问题？ | 分三类：**同类已确认**（百家号）、**同类先例已被修**（公众号 2026-10-12、头条直连兜底）、**反向同类缺陷**（HTML 进纯文本字段：抖音/小红书/快手/B站/视频号描述，本次一并修）、**待真机复核**（DOM 轨 contenteditable 注入路径）。逐平台判定见 §4 |

---

## 2. 结论先行

**根因是发布期的「正文承载形态」不匹配，而不是正文内容质量问题。**

> **⚠️ v2.0 修正（2026-10-15，二次报障后）**：本节与 §5 建立的是**必要但非充分**的一层 —— 它解决「**已经是多段**的内容如何写进 HTML 承载字段」。二次报障取证证明：本次事故的正文在**进入发布链之前**（桌面端富文本编辑器装载那一刻）就已经塌成一段，因此这一层再正确也无法恢复段落。**完整的层级链**是：① 编辑器装载保真（`toHtmlBody`，新增，见 §15）→ ② 发布链写入保形（`formatArticleBody`，本节）→ ③ 平台渲染保段（真机复核判据，见 §12.3 与 §15.6）。三层缺一不可，任何一层缺失都会退化成「一整段」。

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

### 5.4 接线覆盖边界（QM-6 评审 W1/W3 后写明）

「平台属性表」（`HTML_BODY_PLATFORMS` / `PLAIN_BODY_PLATFORMS`）与「已接线清单」是两个概念：前者描述**平台字段的承载形态**，后者只覆盖**在运行路由上的链路**。

| 路由态（`config/platforms.yaml` 的 `publishMode`） | 平台 | 是否已接线 |
|---|---|---|
| `api-then-dom` | `tencent_video` / `bilibili` / `baijiahao` / `douyin` / `kuaishou` | **全部已接线**（`baijiahao-article`、`shipinhao-video`、`bilibili-video`、`douyin-image`、`douyin-video`、`kuaishou-video`） |
| 公众号 API 草稿轨（2026-10-12 #3375 新落地） | `wechat_mp` | 已接线（`adapters/wechat-mp/draft.js` 的 `content0`，字段边界单点） |
| `dom-only` | `toutiao` / `weibo` / `zhihu` / `youtube` / `tiktok` / `twitter` / `instagram` / `facebook` / `xiaohongshu` | **不接线**（其 `src/adapters/*.js` 为 legacy 轨，不在运行路由上；运行时分别走 DOM 轨与 `xiaohongshu-draft` 草稿链） |

证据：`packages/api-publish-engine/test/publish-mode-config.test.js`（W1 五平台 = `api-then-dom`，其余 `dom-only`）与 `apps/desktop/electron/services/rpa-view-manager-publish-mode-gate.test.js`（API-first 闸门以 `publishMode` 为唯一权威）。**判断"要不要接线"的第一性问题是「这条链在不在运行路由上」，不是「文件里有没有这个字段」**；改死代码只会扩大 QM-1/回归面而没有用户可见收益。

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
2. **desktop 两份同族实现已收敛**（converge-article-body-helpers，2026-10-12）：`stripHtmlToPlainText` → 引擎 `htmlToPlainText`、`wechat-mp-article` 的 `hasHtmlTags`/`toParagraphHtml` → 引擎 `hasHtmlTags`/`textToParagraphHtml`（导出名不变，调用点零改动）；顺带修复宽判据吃掉代码片段 `#include <stdio.h>` 的真实缺陷（正/反双向用例 + 打包产物级 require 验证）。**仍余一份**：`packages/rpa-engine/src/toutiao-direct-bridge.js:33` 的内联 `<p>` 拼接（rpa-engine 零依赖约束，不能 require api-publish-engine），语义一致但缺 CRLF 归一与代码尖括号保护 —— 收敛需契约镜像测试或把判据下沉 shared-utils，另立 PR。
3. **Markdown → HTML 未做**：`# 标题` / `**粗体**` 等 Markdown 语法进 HTML 承载平台仍是字面量（与改造前一致，非本次回归）。若要支持，应新增显式 md→html 步骤并同步各平台白名单。
4. **正文内联图片**：百家号 `content` 的内联图片（`<img>`）与 `project_cover` 的关系未在本次改动；图片链沿用既有 `uploadproxy` 语义。
5. **平台侧再规范化**：无法排除平台对超长/特殊字符正文的二次处理；若真机复核发现段落仍被合并，需按产物 HTML 反推平台期望形态（可能需 `<p style=…>` 或编辑器专用字段）。
6. **代码里的字面量标签无法与真标签区分**（QM-6 评审 W4，接受权衡）：`hasHtmlTags` 用标签名白名单，因此 `print("<p>x</p>")` 这类**代码字符串中的字面 `<p>`** 仍会被判成 HTML，在纯文本承载平台会被剥掉。要做对需要真正的 HTML 解析 + 上下文语义判定，代价与收益不成比例：HTML 进纯文本字段的真实来源是富文本编辑器产物（真标签），而宽判据（`<` 后跟字母）会吃掉 `#include <stdio.h>` 这类**真实高发**场景。边界已写在 `content-formatter.js` 的注释里（不新增「锁定该缺陷」的测试）。
7. **`dom-only` 平台的 legacy 适配器未接线**（QM-6 评审 W1/W3）：见 §5.4；属**有意边界**而非遗漏，`PLAIN_BODY_PLATFORMS` 表保留为「新链必须按表接线」的登记依据（AGENTS.md QM-2）。
8. **全量套件存在一次性 flake**：`packages/api-publish-engine/test/backup-restore.test.js` 在本轮首跑失败、单跑 rc=0、复跑全量 rc=0（该文件不 import 任何被改模块）；如实记录，不做「已修复」宣称，若 CI 复现再单独排查。

---

## 15. v2.0 根因修正与第三层合同（2026-10-15，用户二次报障后）

> 本节是 v1.0 的**修正**，不是补充说明。v1.0 的结论（§1 Q2 / §2）在「发布链」这一层是正确且已被真机产物证实有效的，但它**把根因定位错了层级**：真正的第一性原因在更上游。用户报障原文：「发布到百家号上的图文内容，在百家号上显示是一整段，没有分段和分行。查一下原因。我记得这个问题，之前已经修复过啊，怎么没有生效。确认一下。」

### 15.1 为什么 v1.0 的修复没生效（结论先行）

**因为 v1.0 修复的环节在事故之后**：正文在**桌面端富文本编辑器装载那一刻**就已经塌成一段，发布链看到的是「已是 HTML」，按 §8.4 的设计**幂等透传** —— 这一步本身没错，它只是把上游造成的单段原样送到平台。

| 判据 | v1.0 的说法 | v2.0 的取证结论 |
|------|------------|----------------|
| 修复代码是否在运行构建里 | （未验证） | **在**。运行中的构建 `mp-app-live2@fe9f41879` 含 `#3389`（`2bb7c2b9a` 为其祖先），且 `require.resolve` 实证引擎解析到该 worktree 的 `baijiahao-article.js:152`（即 `formatArticleBody` 调用点） |
| 链路是否会把多段转成 `<p>` | 会（单测） | **会**。用同一份引擎源码对同源正文跑 `buildArticleFormData` → **6 个 `<p>`**、1097 字符 |
| 平台是否收到多个 `<p>` | 预期会 | **只收到 1 个**。公开页 `id=1879119523718680476`：`<p>`=1、正文 1055 字符、`源文去掉全部 \n == 平台正文` 为 True（1075 字符 / 10 个换行 / 6 段） |
| ⇒ 结论 | 「发布时传参不对」 | **「送进链路时就已经是一段」** |

### 15.2 第一性根因（渲染层，2026-09-04 引入）

`apps/desktop/src/components/ArticleEditor.vue` 的富文本模式是 `@vueup/vue-quill` 的 `<QuillEditor content-type="html" v-model:content="richContent">`，而 `richContent.get()` 原先直接返回 `props.modelValue`（纯文本）。`vue-quill@1.5.3` 对 `contentType==='html'` 走 `setHTML()`（`quill.root.innerHTML = 值`）⇒ 换行按 HTML 可忽略空白处理 ⇒ 一整段；随后 Quill 经 `text-change` 回写 `getHTML()`（**无需用户输入**即触发）⇒ `article.content` 变成单段 HTML。

- **引入点**：`git blame` 指向 `08e7d95a66`（2026-09-04，富文本模式接到 Quill HTML 承载那一轮）。
- **触发范围**：凡走发布页富文本模式的图文（百家号/头条/公众号等 HTML 承载平台受影响；纯文本承载平台因发布链会转纯文本而表现不同）。

### 15.3 第三层合同（新增，不可破）

**不变式**：**编辑器里看到的段落数 == HTML 承载平台拿到的 `<p>` 数**（Markdown 模式与批量发布路径同样成立）。

三条不可破：

1. **装载必须归一**：`ArticleEditor.vue` 的 `richContent.get()` 必须返回 `toHtmlBody(props.modelValue)`（纯文本按行成段、已是 HTML 幂等透传）；**禁止**回退直传 `props.modelValue`。
2. **单一判据**：装载原语 `toHtmlBody` 与发布链 `formatArticleBody(platform, content)` 的 HTML 分支必须**逐字节等价**（`packages/shared-utils/src/__tests__/article-body-format-parity.test.js` 的行为向量锁死；两包不能互相 require，属本仓「各存一份 + parity 锁」的既有形态）。
3. **判据不得放宽**：标签判据仍是**标签名白名单**（见 §8.1、§14.6），装载层同样适用（`#include <stdio.h>` 必须原样保留为文本）。

**新增单一实现**：`packages/shared-utils/src/article-body-format.js`（CJS）+ `article-body-format.browser.js`（ESM 孪生，逐行同源），渲染端经 `apps/desktop/vite.config.js` 的 alias 消费（未登记 alias 由 `scripts/check-renderer-cjs-boundary.js` 拦红）。

### 15.4 数据校验（装载层）

| 输入 | 输出 | 说明 |
|------|------|------|
| `null` / `undefined` / 非字符串 | `''` | 不抛异常 |
| 空串 / 纯空白 | `''` | 不产出空 `<p>` |
| `第一段\n\n第二段` | `<p>第一段</p><p>第二段</p>` | 空行分段 |
| `a\nb` | `<p>a</p><p>b</p>` | **单换行也算段界**（与发布链同口径） |
| `a\r\n\r\nb` | `<p>a</p><p>b</p>` | CRLF 归一 |
| `  文本  \n\n\n` | `<p>文本</p>` | 行首尾空白剔除；空行不入段 |
| `<p>x</p>` | `<p>x</p>` | 已是 HTML ⇒ 幂等透传（不二次包装） |
| `a < b && c > d` | `<p>a &lt; b &amp;&amp; c &gt; d</p>` | 转义先行（`&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`） |
| `#include <stdio.h>` | `<p>#include &lt;stdio.h&gt;</p>` | 代码片段不被当标签 |

### 15.5 测试映射（v2.0 新增）

| 文件 | 用例 | 锁什么 |
|------|------|--------|
| `packages/shared-utils/src/__tests__/article-body-format-parity.test.js` | 9 | CJS↔ESM 逐行同源 + 导出面相等 + 与 `formatArticleBody(baijiahao/toutiao/wechat_mp, x)` 逐字节相同 + 6 段源文不得产出单 `<p>` + 幂等 |
| `apps/desktop/src/components/ArticleEditor.test.js` | +7 | 装载保真（多段/HTML/空/代码片段/回写/Markdown 模式）+ 结构锁（`toHtmlBody` 不得被绕过） |
| `apps/desktop/src/components/ArticleEditor.quill-load.test.js` | 4 | **真实 Quill**（不 mock）DOM 级：2 段 ⇒ 2 个 `<p>`、6 段 ⇒ 6 个 `<p>` |

**变异反证（已实测）**：把 getter 改回 `props.modelValue` ⇒ 组件级 4 例红 + 真实 Quill 3 例红；恢复即绿。

### 15.6 真机复核判据（升级版，仍未执行）

在 v1.0 §12.3 的 runbook 基础上，判据收紧为**两个产物同时成立**：

1. 发布后公开页 `https://baijiahao.baidu.com/s?id=<postId>` 的 `div[data-testid="article"]` 容器内 **`<p>` 数 == 源文自然段数**（源文段数按 `rewrite_history.rewritten_content` 的 `\n\n` 计数）；
2. 应用内编辑器装载该源文时**显示为多个自然段**（这是最早可观测的一层，也是本次故障的第一现场）。

未同时满足前，不得声称「百家号图文分段已修复」。同批取证的完整记录见 `01-docs/BUGFIX-ARTICLE-PARAGRAPH-AND-ZHIHU-PUBLISH-2026-10-15.md` 与 `openspec/records/fix-article-paragraph-zhihu-publish.md`。

### 15.7 本层新增遗留

1. **头条 / 公众号注入路径未取证**：这两家同为 HTML 承载（同一 `formatArticleBody` 契约），但其正文来自各自的 DOM 注入/草稿链（头条 `toutiao-direct-bridge` 页内重放、公众号 ProseMirror DOM 注入），是否存在同类「装载吞段落」路径需分别取证（v1.0 §14.1 的延伸）。
2. **§14.5 的推论已被本次取证改写**：段落合并的原因**不是**平台期望特殊形态（如 `<p style=…>`），而是我们自己的编辑器装载丢结构 —— 平台对 1 个 `<p>` 的渲染是忠实的（公开页 `<p>`=1）。该遗留项保留但结论更正。
3. **`contentFormat` 名实不符**（`usePublishFlow` 把非 Markdown 一律记作 `'html'`）与**富文本模式字数口径**（计 HTML 串长度）维持既有行为，未在本次改动，登记待办。

---

## 16. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-10-12 | 首版：现象/取证（11/11 篇 `<p>`=0、逐字节对账）/全平台审计矩阵/形态合同与单一实现/数据校验/流程/交互/显示项/测试映射/真机 runbook/遗留 |
| v2.0 | 2026-10-15 | **根因修正**：第一性原因在渲染层「富文本编辑器装载」而非发布链；新增第三层合同（装载保真）+ 装载层数据校验与测试映射（含真实 Quill 用例与变异反证）；改写 §14.5 推论；真机复核判据收紧为「编辑器段落数 == 平台 `<p>` 数」。代码见 `ArticleEditor.vue` + `packages/shared-utils/src/article-body-format*.js`；完整证据见 `01-docs/BUGFIX-ARTICLE-PARAGRAPH-AND-ZHIHU-PUBLISH-2026-10-15.md` |
