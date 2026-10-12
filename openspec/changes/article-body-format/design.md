# Design — article-body-format

## 1. 根因链（逐条取证）

### 1.1 平台产物：正文是「一个裸文本节点」

抓取用户账号已发布图文公开页（`https://baijiahao.baidu.com/s?id=<postId>`），容器锚点 `data-testid="article"`：

```
<div class="_18p7x" data-testid="article">
  <div class="dpu8C   "><!--s-frag-->凌晨两点的烘焙坊，…（855 字符，无任何标签）…<!--/s-frag--></div>
```

| postId | `<p>` | `<br>` | 原始 `\n` | 正文字节 |
|--------|-------|--------|-----------|---------|
| 1878588576245723518 | 0 | 0 | 0 | 855 |
| 1878584801331183679 | 0 | 0 | 0 | 1235 |
| 同账号另 9 篇 | 0 | 0 | 0 | — |

### 1.2 源内容：含空行分段

`shared-user-data/multi-publish.db` → `rewrite_history.rewritten_content`：

| 标题 | created_at | 字符 | `\n` | 自然段 |
|------|-----------|------|------|--------|
| 超长蛋挞陆续下架 | 2026-10-09T15:50:16Z | 863 | 8 | 5 |
| 十五五开局六张网齐铺开 | 2026-10-09T14:54:51Z | 1263 | 28 | 15 |

### 1.3 逐字节对账（决定性判据）

```
源文.replace(/\n/g, "")  ===  平台正文字符串     → True（855==855、1235==1235）
```

⇒ 传输过程中**只有换行/段落**消失，字数与字符逐一对应；平台没有截断、没有改写、没有插入分隔符。

### 1.4 为什么「纯文本 + HTML 字段」必然塌成一段

- `buildArticleFormData` 走 `URLSearchParams`，`\n` 编码为 `%0A` **原样发出**（服务端确实收到）。
- 但 `content` 是**富文本编辑器的 HTML 字段**：平台把它当 HTML 解析，`\n` 在 HTML 里属于**可忽略空白**，段落边界只能由 `<p>`/`<br>` 表达 ⇒ 全部正文落在同一个文本节点。
- 交叉证据：参考产品逆向切片用 `HtmlDocument`/`RichTextParser` 解析正文的 `//p` 节点（`01-docs/rpa-api-publish/evidence/yx-slices-v2.txt`）；`01-docs/rpa-api-publish/多账号API发布技术方案.md` 明确「body 为表单编码的文章数据（HtmlDocument/RichTextParser 生成）」。
- 同族先例：本仓 `packages/rpa-engine/src/toutiao-direct-bridge.js:33` 对头条同样的 HTML 字段**已经**做了纯文本→`<p>` 包装；`apps/desktop/electron/services/wechat-mp-article.js` 2026-10-12 也补了同款 `toParagraphHtml`。**百家号是唯一漏掉的那条链**。

## 2. 方案选择

### 决策 1：适配层放在发布链（引擎侧），不放在渲染层

- **选它**：离平台字段最近，能覆盖所有入口（富文本 / Markdown / AI 创作 / 采集改写 / 爆款库），且只做一次、可零外发单测（假 HTTP 服务器）。
- **不选渲染层**：需要每个页面重复调用，且渲染端拿不到「平台字段承载形态」这一知识（注册表里也没有），必然出现第二份口径。
- **不选各链自抄**：本仓已有三份同族实现（desktop `stripHtmlToPlainText`、`wechat-mp-article.toParagraphHtml`、rpa-engine 头条兜底内联拼接），正是自抄导致「修了一处漏三处」。本期新增链一律调 `formatArticleBody`。

### 决策 2：形态判据用**标签名白名单**，不用「`<` 后跟字母」

- 宽判据会把技术类正文的 `#include <stdio.h>`、`vector<int>` 当标签：HTML 平台会把它转义成 `&lt;`（用户可见变化），纯文本平台会**整段剥掉**（用户可见丢失）。实测：既有 `stripHtmlToPlainText` 在 `代码 #include <stdio.h> 结尾` 上会把 `<stdio.h>` 剥掉。
- 白名单覆盖 Quill 富文本产物与常见块级/行内标签；未命名的尖括号内容一律按文本对待。
- 反证：`topic-inline-contract.test.js` B-13 就是这条判据的守门用例（本次实现前它先红）。

### 决策 3：话题转换必须**先于** HTML 包装

`convertInlineTopics('baijiahao', …)` 的正则是 `(^|\s)#话题#?`。若先包 `<p>`，井号前的字符变成 `>`（不是空白），内联话题不会被转成双井号形态。顺序因此是硬不变量，并由精确断言锁定。

### 决策 4：未知平台保守按纯文本

形态清单是**显式登记表**（`HTML_BODY_PLATFORMS`）。新增平台默认走纯文本（原样透传纯文本、剥 HTML 标签），不会因为「没登记」而把内容包成 HTML 送进一个未知字段。

### 决策 5：反向缺陷一并修，但不碰 desktop / rpa-engine

- 反向缺陷同样会让用户可见内容出错（描述里出现字面量 `<p>`），且修复是**纯函数一行接线**，因此本期一并修 6 条纯文本链。
- 但**收敛既有三份同族实现**要改 `apps/desktop/electron/**`（触发 QM-1 本地打包验证）与 `packages/rpa-engine/**`，与「最小爆炸半径」冲突 ⇒ 拆后续 PR，登记在 PRD §14 遗留清单。

## 3. 契约

| 函数 | 输入 | 输出 | 关键不变量 |
|------|------|------|-----------|
| `hasHtmlTags` | 任意值 | boolean | 白名单标签；`<stdio.h>` / `<100 元` / 实体 ⇒ false |
| `textToParagraphHtml` | 任意值 | `<p>…</p>` 串 | 转义先行；无空段；CRLF 归一 |
| `htmlToPlainText` | 任意值 | 纯文本 | `<br>`⇒`\n`；块级⇒`\n`；`\n{3,}`⇒`\n\n` |
| `getArticleBodyKind` | platform | `'html'｜'plain'` | 未知 ⇒ `'plain'` |
| `formatArticleBody` | platform, content | string | 幂等；空输入⇒`""`；不改写未知平台 |

## 4. 测试策略（反证口径）

| 反证（变异） | 期望变红 |
|-------------|---------|
| `formatArticleBody` 摘除，百家号回到裸 `content` | `baijiahao-article-chain.test.js` 4 例 + B-5 + `content-formatter` 12 例 |
| 把话题转换移到包装之后 | 「话题转换先于 HTML 包装」例（`content` 变回单井号） |
| 宽判据（`<` 后跟字母）替换白名单 | `hasHtmlTags` 代码片段例 + B-13 |
| 纯文本平台接线摘除 | `douyin-image-chain` / `xiaohongshu-draft-chain` 各 1 例 |
| 空输入不清空 | 「空/空白输入不产出空 `<p>`」例 |

## 5. 已知边界与遗留

1. DOM 轨 contenteditable 注入（`_fillInput` 的 `execCommand('insertText')`）是否在平台编辑器模型里成段，**离屏不可判定** ⇒ 复核 runbook 见 PRD §12.3。
2. Markdown 语法（`# 标题` / `**粗体**`）进 HTML 承载平台仍是字面量，与改造前一致（非本次回归）。
3. 平台侧是否对超长/特殊正文二次规范化未知；真机复核以 `<p>` 计数为准。
