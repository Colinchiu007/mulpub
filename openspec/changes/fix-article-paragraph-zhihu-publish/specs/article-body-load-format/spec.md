## ADDED Requirements

### Requirement: 富文本编辑器装载即归一

任何把正文灌进**富文本编辑器**（`content-type="html"` / Quill / contenteditable / ProseMirror）的路径，装载前 SHALL 把纯文本按行归一为段落 HTML（`@multi-publish/shared-utils/src/article-body-format` 的 `toHtmlBody`；渲染端经 `apps/desktop/vite.config.js` 登记的 alias 走 `.browser.js` 孪生）。SHALL NOT 把纯文本原样交给 HTML 语义的编辑器 —— 换行在 HTML 语义里属**可忽略空白**，编辑器会在装载时（**无需用户输入**）经 `text-change` 回写单段 HTML，使正文在进入发布链之前就塌成一整段。

#### Scenario: 纯文本多段装载富文本编辑器

- **WHEN** 编辑器收到的值为纯文本 `"第一段\n\n第二段"`，模式为富文本（`content-type="html"`）
- **THEN** 装载值 SHALL 为 `"<p>第一段</p><p>第二段</p>"`，SHALL NOT 出现裸换行
- **AND** 组件回写后 `article.content` SHALL 保持多段（段落数 SHALL 等于源文自然段数）

#### Scenario: 已是 HTML 的值

- **WHEN** 编辑器收到的值已是 HTML（如 `"<p>甲</p><p>乙</p>"`）
- **THEN** 装载值 SHALL 与输入逐字节相同（幂等，SHALL NOT 二次包装）

#### Scenario: 代码片段中的尖括号

- **WHEN** 编辑器收到的值为 `"代码 #include <stdio.h> 结尾"`
- **THEN** 该尖括号 SHALL NOT 被判定为 HTML 标签，编辑器 SHALL 以文本形态显示该串

#### Scenario: 空内容

- **WHEN** 编辑器收到的值为空串、仅空白或 `null`
- **THEN** 装载值 SHALL 为空串，SHALL NOT 产出空 `<p></p>`

#### Scenario: Markdown 模式不受影响

- **WHEN** 编辑器模式为 Markdown（textarea）
- **THEN** 内容 SHALL 按原文进出，`\n` SHALL 原样保留

### Requirement: 装载判据与发布链逐字节等价

装载侧原语（`toHtmlBody`）与发布链 `packages/api-publish-engine/src/content-formatter.js` 的 `formatArticleBody(<HTML 承载平台>, x)` SHALL 对同一输入产出**逐字节相同**的结果。两个包 SHALL NOT 互相 require（引擎包为零 workspace 依赖的独立运行时）⇒ 实现形态为「各存一份 + parity 锁」，SHALL 至少包含一条逐行同源断言与一组行为向量锁，改任一处口径即变红。

#### Scenario: 判据分叉

- **WHEN** 有人只改 `toHtmlBody` 或只改 `formatArticleBody` 的 HTML 分支（例如把白名单换成「`<` 后跟字母」）
- **THEN** `packages/shared-utils/src/__tests__/article-body-format-parity.test.js` SHALL 变红

#### Scenario: 回归保护不得是 no-op

- **WHEN** 把装载改回直传 `props.modelValue`
- **THEN** `apps/desktop/src/components/ArticleEditor.test.js` 与 `ArticleEditor.quill-load.test.js` SHALL 各有多条用例指名变红
- **AND** `ArticleEditor.quill-load.test.js` SHALL 使用**真实 Quill**（不 mock 编辑器），并在编辑器 DOM 内直接数 `<p>`（两段源文 ⇒ 恰好 2 个；六段 ⇒ 恰好 6 个）

### Requirement: 正文段落数不变式

系统 SHALL 维持不变式：**编辑器里看到的段落数 == HTML 承载平台拿到的 `<p>` 数**。任何新增的「内容 → 编辑器」入口（含批量发布、Markdown 模式、AI 创作、采集改写）SHALL 满足该不变式；不满足者 SHALL 补齐装载归一，SHALL NOT 依赖发布链事后补救（发布链在 `formatArticleBody` 层看到的「已是 HTML」输入已无法区分「原本就是一段」与「段落被吞」）。

#### Scenario: 发布链不能事后补救

- **WHEN** 输入到发布链的正文已经是单段 HTML（如 `"<p>全篇</p>"`）
- **THEN** `formatArticleBody` SHALL 幂等透传（这是**正确**行为），因此该层 SHALL NOT 被视为段落丢失的修复点
