# BUGFIX · 头条图文标题被追加时间戳后 4 位（「DeepSeek崩了」→「DeepSeek崩了 1935」）

日期：2026-10-15　分支：`fix-toutiao-title-suffix`　发现方式：用户真机发布后在头条号后台肉眼发现

---

## 1. 现象与取证边界

用户经本应用向**头条号**发布一条图文，原标题「DeepSeek崩了」；在头条号后台看到的标题是
**「DeepSeek崩了 1935」**。多出的 4 位十进制数字在**标题末尾、前面带一个空格**。

取证边界（如实声明，不假装已闭合）：

- 已确认：本机代码里**唯一**会在标题尾部追加「空格 + 4 位数字」的写入点只有一处，
  且该 4 位数字来自 `Date.now().toString().slice(-4)`（epoch 毫秒后 4 位）——
  以发布时段 epoch 毫秒反推，`1935` 与「当时时刻」同量级吻合（epoch ms 1792001935000
  对应 2026-10-15 02:18:55 +08:00，与本次发布同日）。
- 未做真机复验：本次修复**没有**在真机头条号上重新发布一次以观察标题回显
  （需要用户侧账号与真实发布动作）。修复的判据落在**单元级/集成级回归锁**上
  （见 §4），真机复验列为待办（§8）。

## 2. 第一性原因（根因溯源）

`packages/rpa-engine/src/toutiao-direct-bridge.js` 的 `publishViaPageXhr()`（页面 XHR
重放兜底路径）里，有一段「触发页面自动保存」的脚本：

```js
// 旧实现（事故代码）
const rettle = `(function(){
  var ta=[...document.querySelectorAll('textarea,input')].find(function(e){return /标题/.test(e.placeholder||'')})
  if(!ta) return 'NO_TITLE'
  var s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set
  s.call(ta, (ta.value||'').slice(0,26)+' '+Date.now().toString().slice(-4))   // ← 病灶
  ta.dispatchEvent(new Event('input',{bubbles:true}))
  return 'TITLE_BUMPED'
})()`
```

它存在的**唯一目的**是「给标题一个新值，让页面 React 感知到变化，从而触发自动保存」
（应用 RPA 填充后 React state 可能未感知变化，从不出保存请求；诊断脚本实证「填新标题值」
2-8s 内必触发自动保存）。这是 2026-10-03 为解决「保存请求不来」而引入的**手段**。

病灶在于：这个「手段值」被**直接写进用户要发布的标题框，且从不还原**。于是：

1. 标题框值变成 `原标题.slice(0,26) + ' ' + 时间戳后4位`；
2. 页面 React 据此发出自动保存请求，本仓的 XHR hook 捕获其 body 到 `window.__lastSaveBody`；
3. 重放脚本「原样重放」该 body（只改 `save=0 → save=1`），**标题字段一并带出**；
4. 头条号收到的 `title=` 就是污染值 ⇒ 后台显示「DeepSeek崩了 1935」。

**一句话根因**：把「触发保存的手段」当成了「发布的内容」——手段值没有与内容值隔离，
也没有在使用后还原。附带第二个隐患：`slice(0,26)` 会把 26 字以上的长标题**静默截短**。

`git blame` 语义：该写法随 2026-10-03 的「页面 XHR 重放兜底」一起落地
（注释自述「复刻诊断脚本成功路径」），本意是复刻一个**诊断脚本**的触发技巧，
但诊断脚本不发布内容，产品链路会——同一段代码在两个语境下的安全边界完全不同。

## 3. 全平台审计结论（用户要求「检查其他平台的图文和视频」）

审计方法：全仓检索「往标题/描述框写入的值里拼接 `Date.now` / 时间戳 / 随机串」的形态，
逐一核对每条发布链的标题写入路径。

| 链路 | 标题/描述写入方式 | 是否同源问题 | 判据 |
|---|---|---|---|
| **头条图文（文章编辑器）** | `_fillInput` 填用户原标题；`publishViaPageXhr` 的 bump 脚本**改写标题框** | **是（本 Bug）** | bump 值写进标题框且不还原 |
| 头条视频（xigua/upload-video） | `_publish_generic` → `_fillInput` 填原标题，**无任何 bump 改写** | 否 | `_publish_toutiao` 是 `_publish_generic` 的唯一入口；视频入口不经 `publishViaPageXhr` |
| 头条 API 直连（api-publish-engine） | `buildPostData` 用 `article.title`，无改写 | 否 | 全文无 `Date.now` 参与标题构造 |
| 百家号 / 快手 / 小红书 / B站 / 知乎 / 公众号 / YouTube 等 RPA 链 | 统一走 `_publish_generic` → `_fillInput`，无 bump | 否 | `_fillInput` 只写调用方给的值（含读回校验），不自造值 |
| 各 API 链（douyin/weibo/xiaohongshu/kuaishou/twitter/tiktok…） | 适配器 `buildPostData` 用 `taskData.title` | 否 | 无标题拼接时间戳的代码路径 |

**结论：该问题是头条图文 XHR 重放兜底这条链独有的，其他平台的图文与视频链均不同源。**
根本原因也解释了为什么它独此一家：只有头条这条链需要「制造一个假变化去骗页面自动保存」，
其他平台靠 `_fillInput` 的原生 input 事件就能触发保存。

另需说明的**相邻风险**（已核查、结论为不受影响，但值得记录）：
`_fillInput` 的读回校验是「读回长度 0 且待填值非空即抛错」，
它防的是「没填进去」，防不了「填进去了但值被改写」——本案正是后者，
所以这道已有校验对此类污染是结构性失明的（见 §5 系统性漏洞第 3 条）。

## 4. 修复 + 回归保护

### 4.1 修复（`packages/rpa-engine/src/toutiao-direct-bridge.js`）

**改动一：扰动脚本改为「可还原 + 不可见」**（`buildTitleBumpScript()`，新增导出）

```js
var orig=String(ta.value||'')        // ① 先记下原值
s.call(ta, orig+'\u200b')            // ② 扰动：追加零宽空格（不可见、与原值不同）
ta.dispatchEvent(new Event('input',{bubbles:true}))
s.call(ta, orig)                     // ③ 还原：写回原值
ta.dispatchEvent(new Event('input',{bubbles:true}))
```

三条设计约束：

1. **零宽空格（U+200B）作为扰动值**：React 的 `inputValueTracking` 判据是「本次值 !=
   上次 React 见过的值」，零宽空格足以制造差异 ⇒ 触发能力完整保留；
   同时它**不可见**，即便自动保存请求在还原前抢跑发出，标题里也不会出现可见字符。
   （旧写法的「空格 + 4 位数字」既可见又会变。）
2. **同一次脚本内还原，并再派发一次 input**：React 的**最后一次 onChange** 携带的是
   还原后的正确标题 ⇒ 自动保存请求发出的是正确内容。
3. **不对原标题做任何截断**：旧 `slice(0,26)` 会让 26 字以上标题静默砍短，
   新实现零截断（长标题、含尖括号/表情/HTML 片段都原样还原）。

**改动二：重放前兜底覆盖 `title=` 字段**（`overrideBodyTitle()` + 页面内同逻辑）

扰动还原是同步的，但页面自动保存是**异步**的——理论上存在「保存请求在还原前已发出」
的竞态。因此第二道闸在重放前强制覆盖 body 的 `title=`：

- 判据 `(^|&)title=` 要求 **title 后紧跟等号**，故不会误伤 `title_id=` 邻键
  （事故 body 里两个字段同时存在，这是必须精确的地方）；
- body 无 `title=` 字段时**追加**（不丢原有字段）；
- **空标题不覆盖**（fail-safe：宁可保留页面已生成的标题，也不拿空值覆盖成空标题）；
- 幂等：对已正确内容再次调用不变。

### 4.2 回归保护（`packages/rpa-engine/tests/toutiao-title-no-pollution.test.js`，19 条）

| 组 | 锁什么 | 关键用例 |
|---|---|---|
| A) 净效果 | 扰动后标题框最终值 === 原标题，**一个字符都不多** | 普通中文标题 / 空标题 / 超 26 字长标题（防 `slice(0,26)` 复活）/ 含 `<stdio.h>` `😀` 的标题 |
| B) 触发能力保留 | 扰动**确实发生过**（不得用「不触发」换「不污染」） | React 第一次 onChange 是扰动值且含原标题；扰动标记不可见、非数字 |
| C) body 覆盖 | `title=` 兜底覆盖的精确口径 | 不误伤 `title_id` / `^` 首位形态 / 无字段时追加 / 幂等 / 空标题 fail-safe |
| D) 结构锁 | 脚本内不得出现时钟与截断 | 无 `Date.now`、无 `slice(-N)`、无对标题值的 `slice(0,` |
| E) 端到端集成 | 走完整 `publishViaPageXhr`，**真正 POST 出去的 body** 标题正确 | 假页面复刻「扰动值已被 hook 捕获」的最坏形态；断言发出请求里每一次 `title=` 都是原标题 |

测试沙箱复刻了两个关键真机语义，否则锁会假绿：
① 标题框的 `value` 访问器定义在 **prototype** 上（脚本经
`Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')` 取 setter）；
② React 的 `inputValueTracking` 判据（只有「本次值 != 上次 React 见过的值」才派发 onChange），
以及「React 收到 input 后**异步**发出自动保存 XHR」的竞态。

### 4.3 变异反证（证明锁真的在跑）

把扰动值改回事故写法（`orig.slice(0,26)+' '+Date.now().toString().slice(-4)`）后跑回归锁：
**4 条立刻变红**（B 组「扰动值不可见且非数字」+ D 组三条结构锁）。
即「业务改动变红」与「锁本身被改成 no-op 会红」两点都实测过。
（变异脚本为一次性临时文件，未入库；本机 `mavis-trash` 缺失导致 `safe-delete.js`
的可恢复删除后端不可用，该文件以未跟踪状态留在工作区，**不在本次提交范围内**，见 §8。）

## 5. 系统性漏洞（逃逸分析）

| 层 | 结论 | 为什么漏 |
|---|---|---|
| 单元 / 集成测试 | 未拦 | `toutiao-schedule-intent.test.js` 7 条全在锁「定时意图不被丢弃」，**没有一条断言过发布出去的标题等于原标题**。扰动脚本是页面内字符串，测试若只 mock 掉 `executeJavaScript` 就完全看不到它。 |
| 契约锁（content-formatter / topic-inline） | 未拦 | 这些锁管的是「引擎侧格式化」（标签风格、正文承载形态、话题内联），管辖范围是 **Node 侧发出的字段值**；而本案污染发生在**页面上下文**（RPA 往浏览器标题框写值），两层之间没有桥。 |
| 代码审查 | 未拦 | 该代码的注释写的是「复刻诊断脚本成功路径」——读起来是在复刻一个**已知有效**的技巧，且被 `// ⭐` 标记为成功经验。评审看到的是「有注释、有真机依据」，不会去问「这个值最终会不会发给平台」。 |
| 真机验收 | 部分拦 | 2026-10-03 真机验证过「save=1 → code=0 提交成功」，验证的是**提交是否成功**，没有回查**平台后台的标题文本**是否与原文一致。 |

**系统性漏洞归纳**（三条，均可迁移到其他链路）：

1. **「触发型假值」没有与「内容真值」隔离的机制约定**：凡是为了让第三方页面/接口动起来
   而临时造的值（假标题、假备注、扰动标记），都没有「用完必须还原」的强制约定，
   也没有「不得使用可见字符」的约束。同类风险：任何 `dispatchEvent` 前改值、
   之后不还原的 RPA 代码。
2. **发布链缺少「平台回显 == 用户输入」的对账断言**：现有断言全是「我们发出了什么」，
   没有「平台收到后应回显什么」。本案若有后者，一条 `decodeURIComponent(title=) === article.title`
   就够了（现已在 4.2 的第二道闸 + E 组集成测试补上）。
3. **页面上下文（RPA）与 Node 上下文（引擎）是两个断层的质量域**：引擎侧有
   content-formatter / registry-sync 等一批契约锁，RPA 侧的页面脚本是裸字符串，
   没有任何结构级检查（本项目 QM-2 的 require 路径、注释语法等必检项对
   `executeJavaScript` 内的字符串一律无效）。

## 6. 数据校验与流程（补充进 PRD 的契约，详见 `01-docs/PRD.md` 对应章节）

1. **发布前**：标题按平台注册表校验（`publish-capabilities`：头条 `titleMax=30` 字符）；
   超限由渲染层/引擎层截断并**出声提示**，禁止静默。
2. **填充时**：RPA 只把「用户标题」写进标题框（`_fillInput`，含读回校验）；
   **任何**为触发页面行为而造的临时值必须满足：不可见 + 同帧内还原 + 结构锁禁时钟。
3. **提交时**：重放/直连的 body `title=` 必须与 `article.title` 逐字符相等
   （`overrideBodyTitle` 兜底 + 集成测试断言）。
4. **发布后**：严格平台（baijiahao/kuaishou/toutiao）以作品查询判定成功时，
   回查的 `ArticleAttr.Title` 应与本地标题一致——**此项为新增待办，见 §8**。

## 7. 影响范围与兼容性

- **改动文件**：`packages/rpa-engine/src/toutiao-direct-bridge.js`（1 个文件，
  新增 2 个导出 + 替换 1 段页面脚本 + 重放前加 1 道覆盖）；
  新增 `packages/rpa-engine/tests/toutiao-title-no-pollution.test.js`。
- **不影响**：头条的定时意图契约（`toutiao-schedule-intent.test.js` 7 条全绿，
  同批实跑 274/274 通过）、Node 直连兜底路径（`publishDirect` 未改）、
  其他平台链路（§3 审计结论：不同源，且无代码改动）。
- **用户可见变化**：发布到头条号（图文）的标题与原文一致；不再出现尾部 4 位数字，
  26 字以上长标题也不再被截短。

## 8. 待办（不假装已闭合）

1. **真机复验**：用真实账号向头条号发一条标题 >26 字、一条 <26 字的图文，
   回后台核对标题回显（本次只做到单元/集成级证据）。
2. **删除变异临时文件** `packages/rpa-engine/mutate-check.js`（未跟踪、未提交）：
   本机 `mavis-trash` 不可用导致 `safe-delete.js` 走不到删除那步，
   待该后端可用或改用 `--allow-outside` 之外的人工确认路径后按 R0 删除。
3. **发布后回显对账**：把 §6 第 4 条落成代码（严格平台的作品查询里比对标题），
   使「平台收到什么」从此有机械判据，不再依赖用户肉眼发现。

## 9. 预防措施落地清单

| 措施 | 落点 | 状态 |
|---|---|---|
| 回归锁（19 条，含结构锁 + 变异反证） | `packages/rpa-engine/tests/toutiao-title-no-pollution.test.js` | ✅ 本次 |
| 「触发型假值」契约写进 AGENTS.md QM-2 | `AGENTS.md` 代码审查必检项 | ✅ 本次 |
| PRD 补「标题保真」章节（数据校验/流程/显示项/提示文字） | `01-docs/PRD.md` | ✅ 本次 |
| learnings 记录（pitfall：把触发手段当发布内容） | `01-docs/learnings.md` | ✅ 本次 |
| 发布后平台回显对账 | 严格平台作品查询链 | ⬜ 待办（§8-3） |
| 真机复验 | 用户侧账号 | ⬜ 待办（§8-1） |
