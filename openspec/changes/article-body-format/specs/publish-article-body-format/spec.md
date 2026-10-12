## ADDED Requirements

### Requirement: 图文正文承载形态适配

任何把正文或描述写入平台字段的发布链 SHALL 在写字段之前调用 `content-formatter.formatArticleBody(platform, content)`（单一实现，禁止各链自抄转换）。承载形态 SHALL 由显式登记表决定：**HTML 承载平台**（`baijiahao` / `toutiao` / `wechat_mp`）的正文 SHALL 以 `<p>` 表达段落；**纯文本承载平台**的描述 SHALL 不含标签字面量。未登记的未知平台 SHALL 按纯文本处理并原样透传纯文本内容（SHALL NOT 改写）。

#### Scenario: 纯文本多段正文发往 HTML 承载平台

- **WHEN** 任务正文为纯文本且含空行分段（如 `"第一段\n\n第二段"`），平台为 `baijiahao`
- **THEN** 提交到平台的 `content` 字段 SHALL 为 `"<p>第一段</p><p>第二段</p>"`，SHALL NOT 出现裸换行

#### Scenario: 已是 HTML 的正文

- **WHEN** 任务正文已是富文本 HTML（如 `"<p>甲</p><p>乙</p>"`），平台为 HTML 承载平台
- **THEN** 输出 SHALL 与输入逐字节相同（幂等，SHALL NOT 二次包装）

#### Scenario: HTML 正文发往纯文本承载平台

- **WHEN** 任务正文为 `"<p>第一段</p><p>第二段</p>"`，平台为 `douyin` / `xiaohongshu`
- **THEN** 写入的描述 SHALL 为 `"第一段\n第二段"`，SHALL NOT 含字面量 `<p>`

#### Scenario: 代码片段中的尖括号

- **WHEN** 正文为 `"代码 #include <stdio.h> 结尾"`
- **THEN** 该尖括号 SHALL NOT 被判定为 HTML 标签；HTML 承载平台 SHALL 输出 `"<p>代码 #include &lt;stdio.h&gt; 结尾</p>"`，纯文本承载平台 SHALL 原样输出该串

#### Scenario: 空正文

- **WHEN** 正文为空串、仅空白或 `null`
- **THEN** 输出 SHALL 为空串，SHALL NOT 产出空 `<p></p>`

### Requirement: 百家号正文的形态与话题转换顺序

`BaijiahaoArticleChain.buildArticleFormData` SHALL 先把正文中的已知内联话题转换为双井号形态（`#话题#`），再把整段包装为 `<p>` 段落；顺序 SHALL NOT 颠倒。标题 SHALL 继续按 UTF-8 字节安全截断到 149 字节，AI 生成内容声明字段 SHALL 继续默认勾选。

#### Scenario: 正文含内联话题

- **WHEN** 正文为 `"今天探店 #美食探店 太好吃了"` 且已知话题含「美食探店」
- **THEN** 表单 `content` SHALL 为 `"<p>今天探店 #美食探店# 太好吃了</p>"`
- **AND** 若先包装再转换（反序），井号前的 `>` 不是空白 ⇒ 话题将停留单井号形态，属违反本 Requirement

### Requirement: 正文结构断言的可观测性

针对正文/描述结构（段落、换行、标签）的回归测试 SHALL 至少包含一条精确断言（`toBe` / `deepStrictEqual` / 结构断言），SHALL NOT 只用子串断言（`toContain`）。理由：整篇被压成一行时，任何子串断言依然命中（本仓 2026-09-16 采集页与本次发布链两次同型事故）。

#### Scenario: 段落被压平的回归

- **WHEN** 实现被改回「透传纯文本」或「剥掉全部换行」
- **THEN** `content-formatter.test.js` 与 `baijiahao-article-chain.test.js` 的精确串断言 SHALL 变红
