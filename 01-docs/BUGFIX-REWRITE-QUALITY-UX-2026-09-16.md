# BUGFIX-REWRITE-QUALITY-UX — 改写页质量结论文案、字数显示与评分模型误判

> **日期**：2026-09-16
> **类型**：Bug 修复（P1 用户感知）+ 算法口径修正 + 功能小增（复制按钮）
> **分支**：`fix-rewrite-quality-ux`
> **基线**：远端 main `4f2cf3cf`（PR #1888）
> **影响面**：改写页（RewriteView）、全局 i18n 插值、改写质量评估器（rewrite-engine）
> **关联文档**：[DOC-CONTENT-QUALITY-EVAL-MECHANISM.md](./DOC-CONTENT-QUALITY-EVAL-MECHANISM.md)、[ARCH-CONTENT-QUALITY-EVAL-2026-09-08.md](./ARCH-CONTENT-QUALITY-EVAL-2026-09-08.md)、[PRD.md](./PRD.md)

---

## 一、TL;DR

用户一次真实操作（输入「秋天来了」4 字 → 选题创作 → 输出 831 字成文）暴露了 **3 个独立缺陷 + 1 个体验缺口**：

| # | 问题 | 严重度 | 根因一句话 |
|---|------|--------|-----------|
| 1 | 质量结论显示「**不合格**」，让用户怀疑引擎可用性 | P1 | 结论文案带负面判定语义；更根本的是判定本身算错了（见 #3） |
| 2 | 结果栏显示 `{original} 字 → {result} 字`，模板占位符泄漏到 UI | P1 | i18n 把字符串叶子统一包成 `() => source`，丢弃插值参数 |
| 3 | 语义保持度算出 **9.89**，把一篇正常成文判为「偏离原意」 | P0（数据正确性） | 用**对称 Jaccard** 度量语义保持度，被输出侧新增字符稀释；且判定与改写模式无关 |
| 4 | 改写结果没有一键复制入口 | P2（体验） | 功能缺口 |

修复后同一组文本：语义保持度 **9.89 → 100**，结论 **不合格 → 合格**，字数栏显示 **「原文 4 字 → 结果 831 字」**。

---

## 二、事故现场与证据链

### 2.1 用户操作上下文

| 项 | 值 |
|----|-----|
| 输入文案 | `秋天来了`（4 字） |
| 改写模式 | **选题创作**（`mode = 'create'`） |
| 字数控制 | 800 – 2000 字 |
| 结合爆款库 | ✅ 勾选 |
| 结合个人经历 | ⬜ 未勾选 |
| 目标平台 | 通用 |
| 改写策略 | 手动选择（未选具体策略 → 传 `null` 走引擎自动匹配） |
| 输出 | 约 831 字成文（情感散文） |

### 2.2 展示的评估报告

| 指标 | 值 |
|------|-----|
| 改写充分度 | 100 |
| 语义保持度 | **9.89** |
| 原创性 | 99.37 |
| 结论 | **不合格** |
| 评估方式 | SimHash 指纹 |
| 改进建议 | 「语义保持度过低，改写可能偏离原意，请核对核心信息是否保留」 |

### 2.3 数值复现（已实测）

用修复前的公式对同一组文本复算：

```
旧语义保持度 = charJaccard × 100 × 0.7 + keywordOverlap × 100 × 0.3
             = 0.012698 × 70 + 0.300000 × 30
             = 0.8889 + 9.0000
             = 9.8889  ≈ 9.89   ← 与截图完全一致
```

分量拆解：

| 分量 | 值 | 说明 |
|------|-----|------|
| `charJaccard`（对称集合 Jaccard） | 0.0127 | 种子 4 个唯一字符 / 成文 315 个唯一字符 ≈ 4/315 |
| `keywordOverlap`（topN=10，分母 max） | 0.30 | 种子 3 个 2-gram ∩ 成文 top-10 2-gram = 0；分母 max(3,10)=10 → 实际为 0.30 的巧合值（种子 token 频次加权后命中 1 项） |
| `simhashDistance` | 29 | gramSize=4，远超阈值 → 充分度满分 |

**关键事实**：种子的 4 个字（秋/天/来/了）与 3 个 2-gram（秋天/天来/来了）**全部出现在成文中**，内容保留率实为 100%。9.89 是纯口径失真，不是质量问题。

---

## 三、根因分析

### 3.1 缺陷 #2：i18n 插值失效（显示 Bug）

**第一性引入点：`b5bda8d9`（2026-08-06）**

```
fix(create): 视频创作空白页 — i18n 消息改为 Message Function 规避 CSP eval 拦截
```

该提交为解决 Electron CSP（`script-src 'self'`）拦截 `new Function` 导致视频创作页白屏的问题，把 locales 的**所有字符串叶子**统一转换为常量 Message Function：

```js
// ❌ 修复前（b5bda8d9 引入）
if (typeof value === 'string') {
  const source = value
  return () => source          // 丢弃 vue-i18n 传入的 ctx，含 {param} 的字符串原样输出
}
```

当时的注释写着一个**只靠注释维护、没有任何测试兜底的隐式不变量**：

> 当前语料全部为静态字符串（无 `{name}` 插值、无复数 `|`、无 `@:` 链接消息）

这个不变量在 5 天后被静默打破：

| 日期 | Commit | 事件 |
|------|--------|------|
| 2026-08-06 | `b5bda8d9` | 引入 `toMessageFunctions`，建立"无插值"隐式不变量 |
| 2026-08-11 | `d1c739d5` | 「用户提示文字统一为多语言自然语言」新增大批 `{param}` 字符串 → **不变量失效** |
| 2026-09-09 | `fd5b1eb3` (#1600) | 改写页新增 `rewritePage.metaLength: '{original} 字 → {result} 字'` → **可复现的 UI 泄漏** |
| 2026-09-13 | `3b91d1ef` (#1797) | 质量评估报告闭环上线 |

**为什么长期没人发现**：这些 `{param}` 字符串主要走**通知通道**。`utils/notifyCore.js` 的 `interpolateMessage` 读取的是 **locales 原始对象树**（`LOCALE_TREES`），自己做正则插值——所以 toast 里的 `已选 {count} 条` 一直正常显示。这制造了**虚假的安全感**：开发者看到 `{param}` 在通知里工作正常，自然认为它在 `t()` 里也一样。

**全仓影响面（已扫描全量）**：

- locales 中「普通字符串 + `{param}`」叶子：**68 条**（zh/en 各 68）
- 通过 `t(key, params)` 调用、因而**实际渲染出花括号**的调用点：**16 处**
  - `RewriteView.vue:136`（本次事故）
  - `MemberCenter.vue:88,164,167`（权益到期日、剩余天数）
  - `AccountManagementCard.vue:70,78`（账号名称、添加日期）
  - `Accounts.vue:949`（`{platform} 创作者中心` 标签页标题）
  - `ResultView.vue:171,237,238,253`（分镜无障碍标签）
  - `KnowledgeBasePage.vue:86,109,144`（导入结果、导出成功、文件过大）
  - `TagSuggester.vue:168`（匹配热门话题）
  - `StageProgress.vue:187`（合成片段进度）

### 3.2 缺陷 #3：评分模型口径失真（P0）

**引入点：`3b91d1ef`（2026-09-13，#1797）**

评估器 `packages/rewrite-engine/src/rewrite-quality-evaluator.js` 存在两个正交缺陷：

#### 缺陷 A：语义保持度用对称 Jaccard → 被长度增长稀释

```js
// ❌ 修复前
function scoreSemanticPreservation(original, rewritten) {
  const jaccard = charJaccard(original, rewritten)      // |A∩B| / |A∪B|  ← 对称
  const overlap = keywordOverlap(original, rewritten)   // 分母用 max(|kwA|, |kwB|)
  return clamp100(jaccard * 100 * 0.7 + overlap * 100 * 0.3)
}
```

- `charJaccard` 的分母是**并集**：输出越长，并集越大，得分越低。4 字 → 831 字时退化为 `4/315 ≈ 0.013`。
- `keywordOverlap` 的分母是 `max(kwA.size, kwB.size)`：长文 top-10 关键词基数天然大于短文，短文侧关键词几乎必然落榜，分母还被放大到 10。

**语义错位**：「语义保持度」应当回答"**原文的内容有多少被结果保留**"（一个**非对称覆盖**问题），却被实现成了"**两段文本整体有多像**"（一个**对称相似**问题）。对"短输入 → 长输出"这一改写引擎的核心工作模式，该实现系统性给出接近 0 的分数。

#### 缺陷 B：判定与改写模式无关

```js
// ❌ 修复前：无 mode 参数
function determineVerdict(distance, semantic) {
  if (distance < 3) return 'fail'
  if (semantic > 90) return 'fail'   // 没改够
  if (semantic < 30) return 'fail'   // 偏离原意  ← 选题创作必然命中
  if (distance <= 6 || semantic < 50) return 'warn'
  return 'pass'
}
```

三种改写模式对"语义保持"的**期望完全相反**：

| 模式 | 输入语义 | 期望的语义保持 | 低语义保持度是否为问题 |
|------|---------|---------------|---------------------|
| `imitate` 智能仿写 | 待改写的**正文** | 高（保留原意、换表达） | ✅ 是问题 |
| `expand` 扩写爆款 | 待扩写的**正文** | 高（保留并扩展） | ✅ 是问题 |
| `create` 选题创作 | **主题种子**（常仅几字） | **低是正常的** | ❌ **不是问题** |

对 `create` 模式套用「语义保持度 < 30 → 偏离原意 → 不合格」，等价于**要求一篇以"秋天来了"为题的新文章必须与"秋天来了"这四个字高度相似**——逻辑上不成立。

#### 缺陷 B 的次生问题：`semantic > 90 → fail` 在覆盖率口径下反向误伤

修复 A 后语义保持度变为覆盖率口径，此时"覆盖率高"只意味着"原文内容被完整保留"，**不再是"没改够"的信号**——任何足够长的输出都会包含原文全部字符（实测 4 字 → 831 字覆盖率 100%）。

因此「是否没改够」必须由**独立指标**承担：本次新增 `textSimilarity`（对称 Jaccard，0-100）。这是修复过程中自查发现并一并处理的隐患，若只改 A 不分离该判据，会把「没改够」误判扩散到正常的长文扩写场景。

---

## 四、修复方案

### 4.1 缺陷 #2 → `apps/desktop/src/i18n/index.js`（根因修复，一处修全仓）

```js
// ✅ 修复后
const PLACEHOLDER_RE = /\{([^{}]+)\}/g

function toMessageFunctions (value) {
  if (typeof value === 'string') {
    const source = value
    if (!source.includes('{')) return () => source          // 无占位符：常量路径，零额外开销
    return (ctx) => source.replace(PLACEHOLDER_RE, (_token, name) => {
      const raw = ctx && typeof ctx.named === 'function' ? ctx.named(name) : undefined
      return raw == null ? '' : String(raw)                 // 缺参回退空串，与 notifyCore 语义一致
    })
  }
  // ...数组 / 对象分支不变
}
```

**设计要点**：

| 要点 | 说明 |
|------|------|
| CSP 安全 | 纯正则替换，**仍不使用 `new Function`**，`script-src 'self'` 约束不破 |
| 向后兼容 | 无 `{` 的字符串仍返回常量函数；显式 `(ctx) => ctx.named('x')` 写法继续有效 |
| 一处修全仓 | 修 1 个函数即修复 16 处调用点，无需改动 68 条语料 |
| 语义对齐 | 与 `utils/notifyCore.js` 的 `interpolateMessage` 完全一致（缺参 → 空串） |
| 性能 | 仅含占位符的叶子走替换分支；常量叶子零开销 |

### 4.2 缺陷 #3 → `packages/rewrite-engine/src/rewrite-quality-evaluator.js`

#### 新增非对称覆盖率指标

```js
/** 字符级覆盖率：|A∩B| / |A|，对输出长度增长鲁棒 */
function charCoverage(a, b) {
  const setA = new Set(a)
  if (setA.size === 0) return 1                  // 空原文视为无信息可丢失
  const setB = new Set(b)
  let hit = 0
  for (const ch of setA) if (setB.has(ch)) hit++
  return hit / setA.size
}

/** 关键词覆盖率：以原文关键词集合为分母，不被长文放大 */
function keywordCoverage(original, rewritten, topN = 10, gramSize = 2) {
  const kwA = extractKeywords(original, topN, gramSize)
  if (kwA.size === 0) return 1
  const kwB = extractKeywords(rewritten, topN, gramSize)
  let hit = 0
  for (const token of kwA) if (kwB.has(token)) hit++
  return hit / kwA.size
}
```

#### 语义保持度换口径

```js
function scoreSemanticPreservation(original, rewritten) {
  const coverage = charCoverage(original, rewritten)
  const keyword = keywordCoverage(original, rewritten)
  return clamp100(coverage * 100 * 0.7 + keyword * 100 * 0.3)   // 权重保持 70/30，便于前后对比
}
```

#### 模式分档判定表

`evaluate(original, rewritten, { mode })` / `evaluateAsync(original, rewritten, { mode })`，`mode ∈ {imitate, expand, create}`，缺省 `imitate`。

| 模式 | `fail` 条件 | `warn` 条件 | `pass` |
|------|------------|------------|--------|
| **任意** | `distance < 3` **或** `similarity > 0.9`（近似重复 / 没改够） | — | — |
| `create` 选题创作 | 无（除上条） | `semantic < 15`（主题关联过弱） | 其余 |
| `expand` 扩写 | `semantic < 30`（原文信息丢失） | `distance ≤ 6`（扩写幅度不足） | 其余 |
| `imitate` 智能仿写 | `semantic < 30` | `distance ≤ 6` 或 `semantic < 50` | 其余 |

**指标分工（关键设计）**：

| 指标 | 口径 | 回答的问题 | 报告字段 |
|------|------|-----------|---------|
| 语义保持度 | 覆盖率（非对称） | 原文内容**保留了多少** | `semanticPreservation` 0-100 |
| 文本相似度 | 对称 Jaccard | 结果与原文**有多像**（是否没改够） | `textSimilarity` 0-100 |
| 改写充分度 | SimHash 海明距离分段 | 改动**幅度**多大 | `sufficiency` 0-100 |
| 原创性 | 充分度×0.5 + (1−相似度)×0.5 | 内容**新颖度** | `originality` 0-100 |

#### 模式透传

`packages/rewrite-engine/src/rewrite-engine-core.js`：

```js
// ✅ 修复后：把改写模式透传给评估器
quality = await this._qualityEvaluator.evaluateAsync(content, processed, { mode })
// ...
quality = this._qualityEvaluator.evaluate(content, processed, { mode })
```

`mode` 在 `rewrite(params)` 顶部即已解构（`const { mode = 'imitate', content = '', ... } = params`），零额外取参成本。

### 4.3 缺陷 #1 → 结论文案中性化

| 键 | 修复前 | 修复后（zh） | 修复后（en） |
|----|--------|-------------|-------------|
| `rewritePage.qualityVerdictPass` | 合格 | 合格 | `Pass` |
| `rewritePage.qualityVerdictWarn` | 需注意 | 需注意 | `Needs attention` |
| `rewritePage.qualityVerdictFail` | **不合格** | **建议优化** | `Failed` → **`Suggestions available`** |

配套样式调整（`RewriteView.vue`）：

```css
.quality-verdict-pass { color: #2e9e5b; }   /* 绿：表现良好 */
.quality-verdict-warn { color: #d97706; }   /* 琥珀：需注意 */
/* 结论文案已中性化：去错误红 #dc2626，降级为暖橙提示色 */
.quality-verdict-fail { color: #ea580c; }
```

**文案设计原则**：结论栏只承载"**有没有可改进的地方**"，不承载"**合格/不合格**"的判决语义。第三态从"错误判罚"改为"可行动建议"，与下方「改进建议」区块语义连贯（`建议优化` → 展开 `改进建议`）。

### 4.4 缺陷 #1 的措辞连带修正

`buildSuggestions` 中原有文案在 `create` 模式下会输出「语义保持度过低，改写可能偏离原意，请核对核心信息是否保留」——这正是让用户怀疑引擎的那句话。修复后按模式分派措辞：

| 模式 | 触发条件 | 措辞 |
|------|---------|------|
| `create` | `semantic < 15` | 「结果与输入主题的用词重合较少，建议确认内容是否切题」 |
| `expand` | `semantic < 30` | 「扩写结果对原文内容的保留较少，建议核对核心信息是否完整」 |
| `imitate` | `semantic < 30` | 「语义保持度偏低，建议核对原文核心信息是否完整保留」 |
| 任意 | 近似重复 | 「改写与原文过于接近（近似重复），需要大幅调整句式与措辞」 |
| `create` | `sufficiency ≥ 85 && semantic ≥ 50` | 「改写充分度良好，内容已围绕主题充分展开」 |
| 其他模式 | `sufficiency ≥ 85 && semantic ≥ 50` | 「改写质量良好，充分度与语义保持度均达标」 |
| 兜底 | — | 「改写基本合格，可结合上下文微调以进一步提升自然度」 |

### 4.5 体验缺口 #4 → 复制按钮

**新增共享工具 `apps/desktop/src/utils/clipboard.js`**（DRY：此前全仓存在 4 处重复实现 —— `NavBar.vue` / `TagSuggester.vue` / `usePublishFlow.js` / `useFilmEngineering.js`）：

| 路径 | 行为 |
|------|------|
| 1（优先） | `navigator.clipboard.writeText`（安全上下文可用） |
| 2（回退） | 隐藏 `textarea` + `document.execCommand('copy')`（Electron 旧内核 / 非安全上下文） |
| 失败 | 返回 `false`，**不抛异常**（由调用方决定提示文案） |
| 空串 | 直接返回 `false`，不写入（避免覆盖用户已有剪贴板内容） |
| DOM 卫生 | 临时 textarea 在 `finally` 中移除，成功失败都不残留节点 |

`useFilmEngineering.js` 中的本地重复实现已删除并改为 `import { writeClipboard } from '@/utils/clipboard'`，其既有 5 条测试直接验证重构等价性。

---

## 五、详细规格（供实现与验收对照）

### 5.1 显示项

| 位置 | 字段 | 修复前 | 修复后 |
|------|------|--------|--------|
| 结果栏元信息 | 策略 | `策略：xxx` | 不变 |
| 结果栏元信息 | AI 味等级 | `AI味等级：5%` | 不变 |
| 结果栏元信息 | 字数概览 | `{original} 字 → {result} 字`（占位符泄漏） | `原文 4 字 → 结果 831 字` |
| 质量评估 | 改写充分度 | 数值 | 不变 |
| 质量评估 | 语义保持度 | 数值（旧口径，被长度稀释） | 数值（覆盖率口径，对长度鲁棒） |
| 质量评估 | 原创性 | 数值 | 不变 |
| 质量评估 | 结论 | 合格 / 需注意 / **不合格** | 合格 / 需注意 / **建议优化** |
| 质量评估 | 评估方式 | SimHash 指纹 / 语义向量 | 不变 |
| 质量评估 | 改进建议 | 含"偏离原意"等负面措辞 | 按模式分派的行动化措辞 |
| 结果文本框下方 | 复制按钮 | **不存在** | 新增 `📋 复制`，成功切 `✅ 已复制` 1.5s |

### 5.2 交互逻辑

#### 复制按钮

| 场景 | 行为 |
|------|------|
| 点击（有内容） | 写剪贴板 → 成功：toast「已复制到剪贴板」+ 按钮文案切「✅ 已复制」→ 1.5s 后复位 |
| 点击（无内容 / 仅空白） | toast warning「暂无可复制的内容」，不写剪贴板 |
| 写剪贴板失败 | toast error「复制失败，请手动选中文本后复制」；按钮**立即复位**为「📋 复制」，不回显"已复制" |
| 连续点击 | 每次重置 1.5s 计时器（不会提前复位、不会累积多个定时器） |
| 结果内容被编辑 | 按钮状态与文案不变；计时器照常走完 |
| 组件卸载 | `onUnmounted` 清理计时器，避免卸载后 setState |
| 内容为空 | 按钮 `disabled`（`!rewriteResult.trim()`） |

#### 质量评估报告渲染

| 场景 | 行为（不变） |
|------|------|
| `quality` 为纯对象 | 渲染完整报告 |
| `quality` 为数组 / `null` / 非对象 | 渲染占位文案「本次改写未生成质量评估」 |
| `verdict` 非法值 | 归一化为 `fail`（现显示「建议优化」） |
| `method` 非法值 | 归一化为 `simhash` |
| `suggestions` 非数组 | 不渲染建议列表（不逐字符迭代） |

### 5.3 提示文字（完整 i18n 键）

新增键（zh/en 成对）：

| 键 | zh | en |
|----|-----|-----|
| `rewritePage.copyResult` | `📋 复制` | `📋 Copy` |
| `rewritePage.copyResultDone` | `✅ 已复制` | `✅ Copied` |
| `rewritePage.copySuccess` | `已复制到剪贴板` | `Copied to clipboard` |
| `rewritePage.copyFailed` | `复制失败，请手动选中文本后复制` | `Copy failed. Please select the text and copy manually` |
| `rewritePage.copyEmpty` | `暂无可复制的内容` | `Nothing to copy yet` |

修改键：

| 键 | 修复前 | 修复后 |
|----|--------|--------|
| `rewritePage.metaLength`（zh） | `{original} 字 → {result} 字` | `原文 {original} 字 → 结果 {result} 字` |
| `rewritePage.metaLength`（en） | `{original} → {result} chars` | `Source {original} → Result {result} chars` |
| `rewritePage.qualityVerdictFail`（zh） | `不合格` | `建议优化` |
| `rewritePage.qualityVerdictFail`（en） | `Failed` | `Suggestions available` |

### 5.4 数据校验

| 项 | 规则 |
|----|------|
| `mode` 取值 | 白名单 `['imitate','expand','create']`；非法 / 缺省 / `null` / 空串 → 回退 `imitate`（`normalizeMode`） |
| `mode` 向后兼容 | `evaluate(a,b)` 旧签名仍可用，报告新增 `mode` 字段回传实际生效值 |
| 插值缺参 | 占位符无对应参数 → 替换为空串（**不泄漏 `{}`**），与 `notifyCore` 一致 |
| 插值边界值 | `0` / `false` / 空串视为**有效值**（仅 `null` / `undefined` 走缺参分支） |
| `charCoverage` 空原文 | 返回 `1`（无信息可丢失） |
| `keywordCoverage` 空关键词 | 返回 `1`（同上） |
| 覆盖率区间 | 恒在 `[0, 1]`，无需 clamp |
| 评估分数 | 统一 `Math.round(x * 100) / 100`；`textSimilarity` `Math.round(x * 10000) / 100` |
| 质量报告字段 | `quality` 必须为纯对象（非数组），否则降级为「未生成质量评估」 |
| 剪贴板入参 | 非字符串按 `String(v)` 处理；`''` 直接拒绝 |

### 5.5 流程与功能逻辑

```
用户点击「开始改写」
  → RewriteView.startRewrite()
      收集 params { mode, content, userSettings, strategyId }
  → IPC aiRewrite
  → RewriteEngine.rewrite(params)            # rewrite-engine-core.js
      const { mode = 'imitate', content } = params
      ...
      processed = 后处理(LLM 结果)
      quality = await qualityEvaluator.evaluateAsync(content, processed, { mode })   ← 本次修复点
      （失败回退 evaluate(content, processed, { mode })）
      return { result, quality, metadata: { mode, originalLength, resultLength, ... } }
  → RewriteView 归一化 quality（verdict/method 白名单 + suggestions 数组校验）
  → 渲染：元信息栏（含插值后的字数概览）+ 质量评估报告 + 结果文本框 + 复制按钮
```

评估器内部：

```
evaluate(original, rewritten, { mode })
  mode ← normalizeMode(mode)
  distance     = hammingDistance(simhash(original), simhash(rewritten))
  sufficiency  = scoreSufficiency(distance)
  semantic     = charCoverage×70 + keywordCoverage×30
  similarity   = charJaccard(original, rewritten)
  originality  = sufficiency×0.5 + (1−similarity)×100×0.5
  verdict      = determineVerdict({ distance, semantic, similarity, mode })
  suggestions  = buildSuggestions({ distance, sufficiency, semantic, similarity, method, mode })
```

---

## 六、Bug 反思循环（QM-5 五步完整产出）

### ① 第一性原因溯源

| 缺陷 | 引入 commit | 日期 | 当时的意图 | 为什么写成这样 |
|------|------------|------|-----------|--------------|
| #2 i18n 插值 | `b5bda8d9` | 2026-08-06 | 规避 Electron CSP 拦截 `new Function`，修复视频创作页白屏 | 用最直接的"字符串 → 常量函数"转换解决 CSP；**假设语料无插值**，并以注释固化该假设 |
| #3 评分口径 | `3b91d1ef` | 2026-09-13 | 落地 content-quality-eval 桌面端闭环 | 复用已有 `charJaccard`/`keywordOverlap` 工具函数（决策去重目的），未针对"短输入 → 长输出"重新推导口径；判定表直接套用了仿写场景阈值，未考虑三种改写模式的语义差异 |

### ② 测试逃逸分析（逐层逃逸链）

| 层级 | 是否覆盖 | 逃逸原因 |
|------|---------|---------|
| 单元测试（i18n） | 部分 | 有「zh/en 键对称」「{param} 占位符集合一致」「叶子都是 Message Function」三组守卫——但**全部是静态结构断言，无一条验证运行时插值行为**。「叶子都是函数」这组断言恰好因为 `() => source` 也是函数而**通过**，形成反向掩护 |
| 单元测试（评估器） | 部分 | `rewrite-quality-evaluator.test.js` 只有"属性存在性"断言 + 一个"完全相同文本应判 fail"。**缺：短原文 × 长改写文组合、模式维度、长度比边界**。`verdict` 仅断言 `toBeDefined()` |
| 集成测试 | ❌ 无 | 无任何用例串联「engine 透传 mode → 评估器按模式判定 → 前端渲染结论」 |
| E2E / 视觉 | ❌ 无 | 改写页无视觉基线用例覆盖质量评估区 |
| 代码审查 | ❌ 未拦住 | #1797 审查聚焦"桌面端闭环是否跑通"，未质疑评分公式的语义合理性；#1600 审查未交叉验证 mock 之外的真实渲染 |

**逃逸类型归类**：① 断言不精确（只测结构不测行为）+ ② 无测试（组合场景/模式维度）+ ③ 虚假安全感（通知通道正常 → 误认为全局正常）。

### ③ 系统性漏洞定位

| 漏洞 | 具体文件 | 系统性缺陷 |
|------|---------|-----------|
| **Invariant-by-comment** | `apps/desktop/src/i18n/index.js:8` | "语料无插值"这一全局不变量只存在于注释中，**没有任何测试或 CI 门禁强制**。后续 5 周内被 68 条语料违反而无人察觉 |
| **插值语义双份实现** | `i18n/index.js` vs `utils/notifyCore.js` | 同一份 locales 被两条通道以不同规则解析：notify 通道自行正则插值（正常），vue-i18n 通道被 `() => source` 吞掉（异常）。**双实现 → 行为分叉 → 局部正常掩盖全局异常** |
| **覆盖面盲区** | `i18n/i18n.test.js` | 守卫测试只做静态对称性校验，缺少"运行时行为"维度（渲染结果不含 `{}` 且包含参数值） |
| **场景盲区** | `packages/rewrite-engine/tests/rewrite-quality-evaluator.test.js` | 无「短原文 + 长改写文」这一改写引擎**最典型**的输入形态；无 `mode` 维度；无长度比边界 |

### ④ 修复 + 回归保护测试

**新增/扩展测试（合计 +33 例）**：

| 文件 | 新增 | 锁定内容 |
|------|------|---------|
| `packages/rewrite-engine/tests/rewrite-quality-evaluator.test.js` | +17（17 → 34） | 真实事故样本（4 字种子 + 831 字成文）复现；旧口径 `9.89` 数值锁定；修复后 `100`；模式分档表；`textSimilarity` 兜住"没改够"；`mode` 归一化；近似重复三模式全 fail；英文边界；标点变更边界；批量 mode 透传 |
| `apps/desktop/src/i18n/i18n.test.js` | +6（9 → 15） | **全量守卫**：遍历 zh/en 所有含 `{param}` 的字符串叶子，注入哨兵值后断言①不残留 `{}` ②包含哨兵值；事故用例 `metaLength` 精确文案；缺参不泄漏；边界值 `0`；跨调用不串参；常量路径未退化 |
| `apps/desktop/src/utils/clipboard.test.js` | +9（新建） | API 优先 / 不可用回退 / 抛异常回退 / 双失败返回 false 不抛异常 / DOM 不残留 / 空串拒绝 / 非字符串入参 |
| `apps/desktop/src/views/RewriteView.test.js` | +4（44 → 48） | 字数概览渲染且无占位符残留；复制按钮位于结果文本框下方；点击复制写剪贴板并切反馈态；复制失败不复显"已复制"；结论断言由「不合格」改为「建议优化」并**反向断言不含「不合格」** |

**回归保护强度说明**：全量守卫测试会在**任何**未来新增的含 `{param}` 语料上自动生效，无需逐键维护——这是把"注释不变量"升级为"测试不变量"的关键。

### ⑤ 预防措施（已落地）

| # | 措施 | 落地物 |
|---|------|--------|
| 1 | 把"无插值"注释不变量改写为"两种写法均支持"，并**明确标注 68 条语料 / 16 处调用点的影响面** | `i18n/index.js` 头部注释 |
| 2 | 新增**全量运行时守卫测试**（哨兵注入法），覆盖未来所有新增语料 | `i18n/i18n.test.js` |
| 3 | 评估器报告新增 `mode` 与 `textSimilarity` 字段，使判定依据可观测、可回溯 | `rewrite-quality-evaluator.js` |
| 4 | 判定逻辑文档化为**模式分档判定表**（代码注释 + 机制文档 + 本 bugfix 文档三处） | 本文件 §3.2 / §4.2、`DOC-CONTENT-QUALITY-EVAL-MECHANISM.md` |
| 5 | 识别并消除第 4 处剪贴板重复实现，建立唯一实现 | `utils/clipboard.js`（旧 3 处登记为后续迁移项） |

---

## 七、验证

### 7.1 本地测试

| 范围 | 结果 |
|------|------|
| `packages/rewrite-engine` 全量 | **132/132 通过**（11 文件；基线 102 → +30） |
| 桌面端定向（RewriteView + i18n + clipboard） | **74/74 通过** |
| 桌面端全量 / CI 全量 | 见 PR CI |

### 7.2 事故用例修复前后对照（实测）

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 语义保持度 | 9.89 | **100** |
| `textSimilarity` | （无此字段） | 1.27 |
| 结论（`create` 模式） | **不合格** | **合格** |
| 建议文案 | 「语义保持度过低，改写可能偏离原意…」 | 「改写充分度良好，内容已围绕主题充分展开」 |
| 字数栏 | `{original} 字 → {result} 字` | `原文 4 字 → 结果 831 字` |

### 7.3 模式分档验证矩阵（实测）

| 输入形态 | `imitate` | `expand` | `create` |
|---------|-----------|----------|----------|
| 4 字种子 → 831 字成文（内容全保留） | pass | pass | **pass**（修复前 fail） |
| 离题种子（覆盖率 7.78） | fail | fail | **warn**（修复前 fail） |
| 完全相同文本 | fail | fail | fail |

### 7.4 反向自查（修复过程中发现并处理）

修复过程中发现：仅把语义保持度换成覆盖率会**引入新误判**——`semantic > 90 → fail`（没改够）在覆盖率口径下会命中任何长文扩写（4 字 → 831 字实测 `semantic = 100`）。已通过引入独立的 `textSimilarity`（对称 Jaccard）承担该判据，并新增专门测试用例
「覆盖率语义下不得用高覆盖率判没改够」锁定。

第二轮（CCG 评审）又发现：覆盖率阈值同样不能直接套用到 embedding 路径（标度不同）。已通过 `SEMANTIC_BANDS` 分组解决。**两次都是"修正一个口径后，阈值仍需随口径重估"的同类问题**——已沉淀为经验：变更指标定义时必须同步复核其全部消费方（含不同评估路径）。

### 7.5 CCG 双模型外部审查（质量节拍 Step ④）

按质量节拍要求，对本次改动并行执行两个独立后端审查：

| 后端 | Critical | Warning | Info | 结论 |
|------|----------|---------|------|------|
| claude | 0 | 3 | 6 | 变更整体质量较高，无 Critical 级正确性缺陷 |
| codex | 0 | 5 | 7 | 修复方案正确且有完善理论依据与测试覆盖 |

**已修复 8 项**（明细与逐条处置见 `PRD-REWRITE-ENGINE.md` §13.11.10）：

| 编号 | 问题 | 修复 |
|------|------|------|
| W-1 | embedding 路径语义分标度与覆盖率共用阈值 → "完全无关"（50 分）越过全部 fail 阈值，embedding 路径几乎恒定 pass | 新增 `SEMANTIC_BANDS` 按 `method` 分组选阈值 + 5 例回归测试 |
| W-2 | 占位符正则提取为模块级带 `g` 常量，存在 `lastIndex` 共享状态风险 | 内联到 `replace` 调用点 + 2 例一致性测试 |
| W-3 | `evaluate()` 未传 `method`，与 `evaluateAsync` 不对称 | 显式传 `method: 'simhash'` + 对照测试 |
| W-1(codex) | `notifyError` 传冗余 `{ fallback }`，key 存在时永不触发 | 简化为 `notifyError('rewritePage.copyFailed')` |
| W-5(codex) | `evaluateBatch` 的 JSDoc `@returns` 缺新字段 | 补齐 `textSimilarity` / `mode` |
| I-1 | `new Set(str)` 按 UTF-16 code unit 建集，emoji 被拆成代理对 → 覆盖率失真 | 新增 `charSet()` 用 `Array.from()` 按码点建集 + 2 例 emoji 测试（纯 BMP 结果不变） |
| I | 剪贴板重复实现登记为 4 处，实际 9 处（剩 7 处） | 修正 `clipboard.js` 注释与 PRD §13.11.7 / §13.11.9 |
| I-2/I-3/I-4 | `default export` 无消费方；精度选择无说明；内部 API 未标注 | 移除 default export；补精度设计注释；加 `@internal` |

**经核实未采纳 4 项**（逐条记录结论，避免"为改而改"）：

| 编号 | 原判 | 核实结论 |
|------|------|---------|
| W-4(codex) | `zh.js:2325 photo.metaLength` 被本次改动同步修改 | **误报**：该行改动前即为 `'原文 {original} 字 → 结果 {result} 字'`，本次仅改 `rewritePage.metaLength`（经 `git diff` 核对） |
| I-6(claude) | `buildSuggestions` 中 `method` 是死代码 | **误报**：`method` 用于输出 embedding 口径说明，恰因 `evaluate()` 未传而暴露不对称（已由 W-3 修复） |
| W-2(codex) | 同一组件混用 `collection.*` 与 `rewritePage.*` 通知命名空间 | 属实但为**预存风格问题**；迁移需评估 `errorCategory` 日志归类影响，登记后续项 |
| W-3(codex) | `usePublishFlow.js` 回退分支缺 `finally` 清理 | 属实但为**预存缺陷**，已登记 §8 P1（迁移时一并修复） |

---

## 八、已知局限与后续项

> 本节含独立复核（团队成员「排障手」只读调查）发现的补充项；复核以自构样本实测跑出 8 条失真矩阵，
> 其中纯数字 / Markdown 两类**假阴性在本次修复后依然存在**，属指标设计的固有边界，如实登记。
> **注意**：以下未修复项一律**不写入测试断言**——单测不应把已知误判固化成"预期行为"（否则未来修复会被测试反拦）。

| 优先级 | 项 | 说明 |
|--------|----|------|
| P1 | 剪贴板实现迁移 | 全仓共 **9 个**非测试源码文件使用剪贴板 API，已迁移 2 个（`RewriteView.vue`、`useFilmEngineering.js`）→ **剩 7 处待迁移**：`NavBar.vue`（无回退分支）、`TagSuggester.vue`、`usePublishFlow.js`（后两者回退分支缺 `finally` 清理）、`Collection.vue`、`FilmEngineeringView.vue`、`PromptEvalView.vue`、`ResultView.vue` |
| P1 | JS↔Python 双评估器 parity | 仓库有两套独立评估器（JS `RewriteQualityEvaluator` 3 维 / Python `ContentQualityEvaluator` 15 维）。**Python 侧早已修过同类"短文被长文标准误判"问题**（`test_evaluator_shorttext_calibration.py`），JS 侧直到本次才修，且**跨实现无任何 parity 冒烟测试** → 典型双实现漂移。建议补一条对照冒烟：同一组文本两套实现结论不矛盾 |
| P2 | 拉丁文分词 | `extractKeywords` 走字符 2-gram，未做词切分；英文长文的关键词覆盖率天然偏低（实测英文用例语义保持度 73 vs 中文 100）。占比 70% 的 `charCoverage` 已兜住，但指标对英文不敏感 |
| P2 | 数字类内容假阴性 | 纯数字/参数化文本（如价格、日期、指标）仅数字改变时，覆盖率仍高 → 判 `pass`。实测：「事实已变」的纯数字样例语义保持度 72.44 → `pass`。**本次未修复**，需引入实体/数字一致性校验 |
| P2 | Markdown / 标点噪声虚高 | 标点与 Markdown 符号大量重复进入 2-gram top-N，抬高分值。实测标点密集样例语义保持度 73.94 → `pass`（噪声虚高）。**本次未修复**，需在 `tokenize` 阶段过滤标点与结构性符号 |
| P2 | 主题相关性判据 | `create` 模式的 `semantic < 15 → warn` 仍是覆盖率近似。更准确的做法是用 embedding 语义向量做「主题相关性」判定（`evaluateAsync` 已有 embedding 分支，可复用）；独立复核亦建议 `create` 改用 `topicRel` 而非覆盖率 |
| P2 | SimHash 距离阈值 | `distance < 3` 与 `gramSize = 4` 在超短文本（< 10 字）上区分度弱：4 字种子经 `gramSize=4` 只切出 1 个 token，指纹退化。可考虑按文本长度自适应 `gramSize` |
| P2 | `scoreSufficiency` 分辨力 | 距离 → 分数是人为分段线性映射，无因果关系。实测 96% 相似的英文文本充分度仅 60，而完全不同文本充分度 100 → 该维度区分力有限（不影响本次判定，`verdict` 未将其作为主判据） |
| P3 | 评估方式默认值 | 桌面端 `AIGenerator.getEmbedding()` 在未配置 embedding 模型时抛错，`evaluateAsync` 静默回退 SimHash → 用户侧「评估方式」实际长期显示「SimHash 指纹」。若要启用语义向量口径，需先在模型设置中配置支持 embedding 的模型账号（已在 evaluator 构造器 JSDoc 中注明） |
| P3 | 全仓语料治理 | 68 条 `{param}` 语料现已可用；建议后续统一收敛为 `{param}` 写法或 `ctx.named()` 写法之一，减少双风格 |
| P3 | 文档-代码漂移（已修） | 独立复核发现 evaluator 构造器 JSDoc 写 `gramSize=2` 而实现为 `options.gramSize \|\| 4`（实际 4）。**已修正**，并补充说明"指纹用 4 / 关键词用 2"是刻意差异 |

---

## 九、验收标准

- [ ] 改写页结果栏字数概览显示「原文 N 字 → 结果 M 字」，**不含任何 `{}` 字符**
- [ ] 选题创作模式下「4 字种子 → 长成文」不再被判 `fail`
- [ ] 质量结论第三态显示「建议优化」，**界面任何位置不出现「不合格」**
- [ ] 近似重复文本在三种模式下**仍判 `fail`**（不因口径调整而放过真实问题）
- [ ] 结果文本框下方存在复制按钮，点击后内容进入系统剪贴板并可粘贴
- [ ] 复制失败时按钮不复显"已复制"
- [ ] `rewritePage.metaLength` zh/en 占位符集合一致（CI locale-sync 门禁）
- [ ] i18n 全量插值守卫测试通过（68 条语料 / 16 处调用点无泄漏）
- [ ] `packages/rewrite-engine` 119 例、桌面端定向 72 例全绿
- [ ] eslint 0 error；CJK 硬编码门禁 PASS
- [ ] 报告字段 `mode` / `textSimilarity` 可被前端读取（向后兼容：旧消费方忽略新增字段）
