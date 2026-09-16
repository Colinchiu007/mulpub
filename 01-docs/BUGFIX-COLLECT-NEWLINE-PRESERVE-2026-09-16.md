# BUGFIX: 采集页正文丢失原文换行与分段（正文提取把换行一起压缩掉了）

> 日期: 2026-09-16 | 分支: `fix-collect-newline` | 基点: main `4f2cf3cf`
> 相关文档: `01-docs/PRD.md`（§正文文本格式契约） | `01-docs/learnings.md`（pitfall 记录）

---

## 1. 问题现象

采集页采集到的文字**不包含原文的换行**：一整篇文章的正文被压成**一整行**，既没有分行、也没有分段，长文「看着非常乱」，难以快速浏览与二次编辑。

触发的典型场景：采集**知乎专栏/回答**、**百家号**文章，或普通站点走降级通道采集时。

## 2. 影响范围（两条采集通道，只坏其中一条）

采集页的正文有**两条独立通道**，分别由不同语言栈实现，换行行为完全不同：

| 通道 | 触发条件 | 正文提取实现 | 换行 | 分段（空行） |
|---|---|---|---|---|
| **Python 聚合通道** | 默认路径（普通站点）<br>`aggregationCollect` → `/aggregation/collect` | `content-aggregator v1` + **trafilatura 2.1.0** | ✅ 保留（块之间单个 `\n`） | ⚠️ 无空行（段落仅分行） |
| **Node 采集通道** | ① 反爬站点（知乎/百家号）走 `urlCollectFetch`<br>② Python 通道失败或命中安全验证页时的降级路径 | `url-collector.js` → `_parseHtml()` | ❌ **全部丢失** | ❌ **全部丢失** |

**结论：本 Bug 定位在 Node 采集通道**，其输出连一个换行都不剩，是用户所见「一整篇看着非常乱」的直接原因。

### 2.1 证据：Python 通道实测（trafilatura 2.1.0，本机复现）

输入同一份多段 HTML（含 `<h1>` / 两个 `<p>` / `<br>` / `<ul>`），`trafilatura.extract(...)` 输出：

```
'文章大标题\n第一段正文，这里有一些 多余空格。\n第二段正文第一行\n第二段正文第二行\n要点一\n要点二'
```

→ **换行保留**（含 `<br>` 转换行），仅无空行分隔。故 Python 通道不属于本 Bug 的坏点，本次**不改动**（见 §10 已知边界）。

### 2.2 证据：Node 通道修复前后对比（官方回归用例实测）

| 输入 HTML | 修复前（旧实现） | 修复后 |
|---|---|---|
| `<h2>小标题</h2><p>第一段。</p><p>第二段。</p><ul><li>要点一</li><li>要点二</li></ul>` | `小标题 第一段。 第二段。 要点一要点二` | `小标题\n\n第一段。\n\n第二段。\n\n要点一\n要点二` |
| `<p>第一行<br>第二行<br>第三行</p>` | `第一行第二行第三行` | `第一行\n第二行\n第三行` |
| 知乎 `.Post-RichTextContainer` 两段 | `知乎第一段。知乎第二段。` | `知乎第一段。\n\n知乎第二段。` |
| 百家号两段 | `百家号第一段。\n百家号第二段。` | `百家号第一段。\n\n百家号第二段。` |

> 注意修复前的第 1 行：相邻 `<li>` 之间**连空格都没有**，直接粘成 `要点一要点二`。这说明 `.text()` 对相邻行内块是「零分隔」拼接，破坏程度比单纯「换成空格」更严重。

## 3. 根因

`apps/desktop/electron/services/url-collector.js` 通用回退分支（原第 312 行）：

```js
textContent = contentEl.text().trim().replace(/\s+/g, ' ').slice(0, 50000)
```

`\s` 在 JavaScript 正则中包含换行符（`\n`/`\r`/`\u2028`/`\u2029`）以及全角空格 `\u3000`、NBSP `\u00a0`、BOM `\ufeff`。因此 `replace(/\s+/g, ' ')` 把**包括换行在内的所有连续空白**一律压成单个半角空格 —— 正文被压成一整行。

该行同时是**知乎分支**的归宿：zhihu 分支只负责设置 `contentEl`，随后仍落入同一段通用回退，因此知乎与普通站点一起中招。

**平台间格式不一致**：同文件百家号分支当时用 `paragraphs.join('\n')` 保留了换行（每条段落之间 1 个 `\n`、无空行）。于是「同一篇内容，站点不同、格式不同」，且三个分支没有一份共同的格式契约。

### 3.1 为什么当初会写成 `.replace(/\s+/g, ' ')`

原始意图是**清理 HTML 源码缩进噪声**：真实页面源码里 `<div>`/`<p>` 之间通常有大量缩进与换行，`.text()` 取出的文本会带一大堆首尾空白与空行。用 `\s+ → ' '` 是最省事的「一把梭」写法，能解决缩进噪声，但**连语义换行一起杀掉了**。正确做法是把「排版噪声」与「语义换行」分开处理（见 §4）。

## 4. 修复方案

### 4.1 设计：把「排版噪声」与「语义换行」分离

新增独立模块 **`apps/desktop/electron/services/readable-text.js`**，把「HTML 块级结构 → 纯文本换行」的映射规则集中一处（原实现散落在 `_parseHtml` 内，且 ur l-collector.js 已触达 500 行技术债阈值）：

| 导出 | 职责 |
|---|---|
| `extractReadableText(contentEl)` | cheerio 选择结果 → 保留块级结构的可读纯文本 |
| `normalizeExtractedText(text)` | 纯函数空白归一化（与 cheerio 解耦，可独立单测） |

### 4.2 块级结构 → 换行映射规则（核心契约）

遍历 DOM 时**在元素之前**补分隔符（而非闭合后补）：相邻两个同级块级元素之间恰好得到 **1 组**分隔符，不会因「前补 + 后补」叠成双份。

| HTML 结构 | 产出 | 理由 |
|---|---|---|
| `<br>` | 单个换行 `\n` | 强制换行是原文语义 |
| 段落级：`p` `h1`–`h6` `blockquote` `figcaption` | 前置空行 `\n\n` | 段落之间空一行，视觉上体现**分段** |
| 行级：`div` `section` `article` `li` `tr` `ul` `ol` `table` `main` … | 前置单换行 `\n` | 列表项/表格行「**分行但不空行**」，不把列表项撑成段落 |
| 单元格：`td` `th` | 前置制表符 `\t` | 相邻单元格不粘连，同一行内呈现 |
| `<pre>` | 前置空行；**内部换行与缩进原样保留** | 代码块缩进是语义，不能被行内空白压缩抹平 |
| 行内标签：`span` `a` `strong` … | 原样透传 | 源码无空白即无间距，与浏览器渲染一致 |
| 噪声节点：`script` `style` `noscript` `template` `iframe` `svg` `canvas` `form` `button` `nav` `footer` `header` `aside` | 整体跳过 | 导航/页脚/侧栏文字不是正文，混入会在段落间制造大量伪换行 |

**`<pre>` 保护机制**：代码块先登记原文、正文里只留占位符（`U+0000PRE<n>U+0000`），待空白归一化完成后再原样还原。选 U+0000 的原因：HTML 解析阶段即剔除 NUL，因此它**不会出现在 cheerio 产出的文本节点里**，与真实正文零碰撞；且非空白字符，可安全穿过归一化。

### 4.3 空白归一化规则（`normalizeExtractedText`，6 步）

| # | 规则 | 目的 |
|---|---|---|
| 1 | CRLF / CR / U+2028 / U+2029 → LF | 统一行尾 |
| 2 | 去 BOM（`\ufeff`） | 零宽字符会污染首行首字符 |
| 3 | 行内连续空白（缩进/制表符/全角空格/NBSP）→ 单个半角空格 | 清排版噪声；**换行不受影响** |
| 4 | 逐行去首尾空白（含全角空格） | 清行尾残留 |
| 5 | 连续 3 个以上换行 → 压成 1 个空行 | 保留段落间隔，去掉源码缩进产生的多余空行 |
| 6 | 去首尾换行 | 收口 |

### 4.4 改动明细

| 文件 | 改动 |
|---|---|
| `apps/desktop/electron/services/readable-text.js` | **新增**（173 行）：块级映射规则 + `<pre>` 保护 + 空白归一化 |
| `apps/desktop/electron/services/readable-text.test.js` | **新增**（18 例）：模块级回归保护 |
| `apps/desktop/electron/services/url-collector.js` | 通用回退分支改调 `extractReadableText(contentEl)`；百家号分支由「只 join `<p>`」改调同一提取器（**格式统一**，并额外纳入标题）；移除迁出的规则代码（623 → 463 行） |
| `apps/desktop/electron/services/url-collector.test.js` | 新增 11 例精确断言（`toBe`）；纯函数用例迁往 `readable-text.test.js` |

### 4.5 零契约变更声明

- **零新增 IPC 通道**、零 preload 改动、零 `access-control.js` / `license-access-control.js` 改动
- **零 UI 改动、零新增文案**：展示层 `<textarea class="compare-textarea">` 原生保留 `\n`，且 CSS 未覆盖 `white-space` → 正文一旦带上换行，渲染端**立即正确显示**，无需改渲染代码
- **零 locale 改动**：无新增用户可见字符串（zh/en 无需成对修改）

## 5. 数据校验

| 项 | 规则 |
|---|---|
| 截断上限 | 归一化后 `slice(0, 50000)`，与修复前一致；截断后仍保留段落结构（新增用例覆盖 3000 段超长正文） |
| 空容器 | `extractReadableText` 对 `null` / 空选择结果 / 全部为噪声节点 均返回 `''`，**不抛错** |
| 非字符串输入 | `normalizeExtractedText(null/undefined/'')` 安全返回 `''` |
| 占位符还原 | 按 `preformatted` 序号逐个 `split/join` 还原；序号越界时替换为空串，不会残留 NUL 占位符 |
| 首尾空白 | 归一化第 6 步保证输出无首尾换行；行内多余空格不影响段落结构 |
| 上游保护 | `_parseHtml` 本身处于 `collect()` 的 `try/catch` 内，提取异常会走既有失败链路（记 error 日志 + 熔断计数），不会静默产出脏数据 |

## 6. 流程（修复后）

```
采集页输入 URL
   │
   ├─ needsStealthRoute(url) = true（知乎 / 百家号等反爬站点）
   │     └─ urlCollectFetch → Node 通道（HTTP 或 stealth 浏览器）
   │           └─ _parseHtml()
   │                 ├─ 平台分支选定正文容器（知乎 / 百家号 / 通用 article→main→body）
   │                 └─ extractReadableText(container)      ← 本次修复点
   │                       ├─ walkReadableText：块级结构 → 换行/空行/制表符；<pre> 占位
   │                       ├─ normalizeExtractedText：清排版噪声、保留语义换行
   │                       └─ 还原 <pre> 原文
   │
   └─ 否则 → Python 聚合通道（trafilatura，本就不丢换行）
         └─ 失败或命中安全验证页 → 降级回 Node 通道 urlCollectFetch（同上）
```

## 7. 交互逻辑 / 显示项 / 提示文字

| 项 | 说明 |
|---|---|
| 交互逻辑 | **无变化**。采集动作、按钮、加载态、成功/失败提示全部保持原样；本次只改「正文文本内容」 |
| 显示项 | 采集结果面板的**正文 textarea**（`.compare-textarea`，`readonly`）现在按原文分段显示；`description`（正文前 120 字摘要）与 `wordCount` 逻辑不变 |
| 字数统计 | `wordCount` 取内容长度；段落空行会带来极少数字符增量（每段约 +1），量级可忽略，且更贴近真实正文长度 |
| 提示文字 | **零新增/零修改**（zh/en 无变化） |
| 下游收益 | 送进 AI 改写的正文恢复段落结构 → 改写结果的分段与逻辑层次更贴近原文（此前一整行输入会诱导模型输出平铺文本） |
| 文案库 | `recordRewriteToLibrary` 落库的 `content` 同样带段落结构，文案库回看不再是一整行 |

## 8. 测试

### 8.1 单元测试（75 例全绿）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `readable-text.test.js`（新增） | 18 | 块级结构 → 换行；`<br>`；3 连换行收口；行内空白压缩；表格单元格；行内标签透传；噪声剔除；`<pre>` 缩进保留 / 首尾不残留空行 / 多个 `<pre>` 不串位；空容器与纯噪声容器；归一化 6 条规则 |
| `url-collector.test.js` | 57（+11 新增） | `_parseHtml` 端到端：通用站点精确分段、`<br>`、行内空白、3 连换行、`<pre>`、表格、噪声、知乎分支、百家号分段统一、空容器、超长截断 |

### 8.2 回归保护有效性验证（关键）

新增用例刻意使用 **`toBe` 精确断言**（而非 `toContain` 子串匹配），并用「修复前的实现副本」实测确认能被抓住：

```
[通用站点段落/列表]  旧实现是否被新断言抓住: YES ✅   旧输出 "小标题 第一段。 第二段。 要点一要点二"
[br 强制换行]        旧实现是否被新断言抓住: YES ✅   旧输出 "第一行第二行第三行"
[知乎分支]           旧实现是否被新断言抓住: YES ✅   旧输出 "知乎第一段。知乎第二段。"
[百家号段落]         旧实现是否被新断言抓住: YES ✅   旧输出 "百家号第一段。\n百家号第二段。"
```

### 8.3 静态门禁

- `eslint electron/services/*.js`（4 个改动文件）：**0 error / 0 warning**
- `node scripts/check-debt-budget.js`：`filesOver500 = 87`，与纯净 `origin/main` **完全一致（零新增债务）**；`url-collector.js` 623 → 463 行，回到 500 行阈值内
- 无 IPC / locale / IPC 契约测试影响（零契约变更）

## 9. 手动验证（用户侧）

1. 采集一篇**知乎专栏**（如 `zhuanlan.zhihu.com/p/...`），确认正文按段落分段显示、无整篇一行
2. 采集一篇**百家号**文章，确认段落之间有空行、列表项各自一行
3. 采集一个**普通站点**文章，确认同样分段（Python 通道原本即分行）
4. 触发一次**降级**场景（如 Python 通道失败），确认降级后正文仍分段
5. 点【改写】，确认改写输入/输出均保持分段

## 10. 已知边界

1. **两条通道的「分段粒度」尚未统一**：Node 通道段落之间为**空行**（`\n\n`），Python/trafilatura 通道为**单换行**（`\n`）。两者都保证「分行」，Node 通道额外提供「分段」视觉间隔。trafilatura 的 plain text 输出无法区分「块间分隔」与「段内 `<br>`」，强行统一会误判 `<br>`，故本次**不改动 Python 通道**；后续若需统一，建议改走 `output_format="markdown"` 并评估对改写 prompt 的影响。**已登记为待办**。
2. **`packages/collection-engine/src/platform-adapters/*.js` 存在同类潜在缺陷**：`body.replace(/<[^>]+>/g, '')` 直接剥标签，相邻块级元素文字会**直接粘连**（无换行、无空格）。经核查该组 adapter 目前**未接入采集页链路**（仅被 `collection-engine/src/index.js` 导出），故不在本次范围；`readable-text.js` 已可作为其后续修复的复用实现。**已登记为待办**。
3. **`<pre>` 内的行尾空白会被保留**（不做逐行 trim）——这是刻意的：代码块缩进是语义。
4. **截断发生在归一化之后**：超长正文按最终文本切 50000 字符，可能切在某段中间；与修复前行为一致。

## 11. QM-5 五步（Bug 反思循环）

| 步骤 | 内容 |
|---|---|
| ① 根因溯源 | 定位到 `url-collector.js` 通用回退分支 `.text().trim().replace(/\s+/g, ' ')`。**溯源结论：该行不是回归，而是「URL 内容采集」功能出生即带的缺陷** —— 经 GitHub API 逐路径回溯（`/commits?path=...` 分页取最旧一页）确认，该行最早出现于 **`46d4f88d`（2026-06-12，`feat: URL内容采集 — 粘贴链接自动提取文章`，即该功能的首次提交）** 第 156 行；同一提交的浏览器分支用的是 `content.innerText.trim()`（`innerText` **保留**渲染换行），只有 Cheerio（HTTP）分支写成压空格，说明是写 HTTP 分支时未意识到 `\s` 含换行。后续 `847cdf30`（2026-07-04，服务迁移）原样带到 `services/` 路径。当时意图为「清理 HTML 源码缩进噪声」，误伤语义换行。<br>**方法论备注**：本仓库为 shallow clone（`{git}/shallow` 存在，`git rev-list --count` 仅 4），本地 `git log -S` / `git blame` 只能触到下界提交 `f629765e`（2026-08-04，`rev-list --parents` 无父提交即边界）；`git fetch --deepen=2500` 实测被代理截断（`early EOF` / `invalid index-pack output`）后仍不可达，故改用 **GitHub API 按路径分页回溯**定位真实引入提交。 |
| ② 逃逸分析 | **逃逸链**：单元测试层——`url-collector.test.js` 已有 `_parseHtml` 断言，但**全部为 `toContain` 子串匹配**（`grep` 确认该文件对 `content` 无任何 `toBe`/`toEqual`/`toMatch`），整篇压成一行时每个子串依然命中 → 断言不精确；集成/E2E 层——无任何用例校验正文段落结构；代码审查层——「正文提取格式」从未被列为审查项。**逃逸分类：断言不精确 + 无测试（段落结构维度）**。 |
| ③ 系统性漏洞 | 具体缺陷位于 `apps/desktop/electron/services/url-collector.test.js`：**正文类断言 100% 使用子串匹配，零例锁定文本结构**。这是「结构性 Bug 一律免疫」的系统性盲区——任何只改变分隔符/空白/换行的回归都无法被现有断言发现。次生漏洞：正文提取规则**散落在 `_parseHtml` 内联**，三个平台分支各写各的（百家号 `join('\n')` vs 通用回退压空格），没有单一格式契约可被测试锚定。 |
| ④ 回归保护测试 | 见 §8.1/§8.2。**写在** `readable-text.test.js`（模块级 18 例）+ `url-collector.test.js`（端到端 11 例）；**怎么测**：对紧凑 HTML fixture 用 `toBe` 精确断言完整输出字符串，覆盖段落空行/列表项单换行/`<br>`/3 连换行/行内空格/表格/噪声/`<pre>`/空容器/超长截断；**模式**：单元 + 模块级集成（真实 cheerio，非 Mock）。已实测「修复前实现必然失败」。 |
| ⑤ 预防措施 | ① **格式契约集中化**：新增 `readable-text.js` 作为唯一实现，后续所有正文提取复用，规则以表驱动常量（`PARAGRAPH_TAGS`/`LINE_TAGS`/`CELL_TAGS`/`PREFORMATTED_TAGS`）表达，可直接被测试锚定；② **审查项补强**：正文/文本类断言**必须至少一条 `toBe` 精确断言或结构断言**，禁止只用 `toContain`；③ 本文档 + `01-docs/learnings.md` 记录该 pitfall；④ 两条通道的分段粒度统一、collection-engine adapters 同类缺陷修复登记为待办（见 §10）。 |

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
