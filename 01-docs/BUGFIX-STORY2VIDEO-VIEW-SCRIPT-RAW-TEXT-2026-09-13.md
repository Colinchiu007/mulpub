# BUGFIX — 视频创作·历史记录「查看文案」弹窗：丢失原始文案 + 文本不换行

- **状态**：已修复（待 CI 合并）
- **分支**：`codex/fix-view-script-raw-text`
- **worktree**：`D:\Data\projects\mp-worktrees\mp-fix-view-script-raw-text`
- **发现日期**：2026-09-13
- **关联 PRD**：`01-docs/PRD-STORY2VIDEO-HISTORY-VIEW-SCRIPT-2026-09-13.md`（迭代 2）
- **严重级别**：P2（功能可用但内容错误 + 可读性受损）

---

## 0. 现象（用户原话）

> 视频创作-历史记录-任务详情页，点击【查看文案】，打开的弹窗中，文字没有自动换行。而且内容里还包含着每行的序号。这里的文案内容，应该显示成最原始的文案内容，就是进行启动视频流水线时的原始文案，是进行分句之前的文字内容。

三个可观测缺陷：

| # | 现象 | 用户影响 |
|---|------|----------|
| D1 | 弹窗与复制内容含 `【1】【2】…` 分段序号 | 复制到第三方编辑器需手工清理；序号不是用户原文 |
| D2 | 展示的是分句/分段后的文本，原稿段落与换行丢失 | 看到的不是自己交上去的文案 |
| D3 | 长行不折行，内容横向溢出弹窗被裁切 | 只能读到每行开头一小段，实际不可读 |

---

## 1. ① 根因溯源（不修表面，追到第一性引入点）

**引入提交**：`02d23fcf8` — `feat(ResultView): 新增查看文案按钮，弹窗展示全部文案并支持复制`（2026-09-13，迭代 1）

`git blame` 结果（`apps/desktop/src/views/ResultView.vue`）：

```
02d23fcf8 667)     scriptText() {
02d23fcf8 668)       if (!Array.isArray(this.segments) || !this.segments.length) return ''
02d23fcf8 669)       return this.segments.map((segment, index) => {
02d23fcf8 670)         const text = (segment && typeof segment.text === 'string') ? segment.text.trim() : ''
02d23fcf8 671)         return text ? '【' + (index + 1) + '】' + text : '【' + (index + 1) + '】（无文案）'
02d23fcf8 672)       }).join('\n\n')
02d23fcf8 434)   <UiModal :visible="scriptModalVisible" ... size="lg" @close="closeScriptModal">
02d23fcf8 436)       <pre class="script-text">{{ scriptText }}</pre>
```

**第一性原因（两个独立缺陷叠加，不是同一个根因）**：

1. **取数口径选错（D1 + D2）**：实现直接复用了任务详情页「分段编辑」区已有的 `this.segments`（分句/分段**之后**的结构）作为文案来源。而全链路里真正保存「用户原文」的字段是项目级 `project.sourceText`——它在流水线启动时由主进程 `saveRun()/saveEditableRun()` 以 `run.params?.text` 落盘（`apps/desktop/electron/services/story2video-project-service.js`），**从未被分句改写**。`segments[].text` 是 split 阶段把原文按 `。！？` 切句、按字数合并为 scene 后的产物（`stage-executor.js` split 阶段 → `story2video-segmentation-engine.js` / `packages/story2video-engine/src/text-segmentation.ts`），天然丢失原稿段落结构。当时为「看起来像分段列表」还额外拼了 `【N】` 编号——纯展示装饰被写进了**复制内容**。
2. **CSS 缺位（D3）**：`<pre>` 默认 `white-space: pre`，不折行。模板引入了 `class="script-text"` 与 `class="script-modal-body"`，但 `<style scoped>` 里**一个规则都没写**（全仓 grep `.script-text` 仅命中模板行）——class 名是"占位"，从未落地样式。

**为什么会写成这样**（动机推测，非借口）：迭代 1 的目标是"快速查看全部文案"，最小实现就是复用页面上现成的 `segments`（零新增取数），并加编号让用户能对上编辑区；编码时未追问"用户要的是原文还是分段"。

## 2. ② 测试逃逸分析（按测试层级列出逃逸链）

| 层级 | 是否存在该场景测试 | 为什么没拦住 |
|------|-------------------|--------------|
| 单元测试 | ❌ **完全无覆盖** | `ResultView.test.js` 对 `scriptText` / `scriptModalVisible` / 弹窗按钮**零断言**（grep `script`、`【`、`view_script` 均 0 命中）；迭代 1 的 PR 未为新功能补任何前端用例 |
| 源码级契约测试 | ❌ 未覆盖该组件 | 仓库已有 `fs.readFileSync` 源码契约先例（`UiModal.test.js` 的 sticky padding 契约、`UiSkeleton.contract.test.js` 的 8 条样式契约），但**没有**"被展示的长文本容器必须声明换行"这类通用契约，因此 D3 无门禁 |
| 集成测试 | ❌ 无 | 无「启动流水线 → 打开历史详情 → 查看文案」的链路测试；且 `project.sourceText` 与 `segments` 的语义差异没有任何断言 |
| E2E / 视觉回归 | ❌ 未执行 | 纯视觉问题（不折行/溢出）只能靠截图对比发现；本次改动未见视觉验收记录 |
| 代码审查 | ❌ 被文档误导 | PRD（迭代 1）把「文案按分段编号【N】+ 文案内容组织」直接写成了需求 → 形成 **文档—代码—测试自洽的错误闭环**，审查者按 PRD 核对只会确认"实现符合需求" |

**逃逸链一句话**：`PRD 写错口径 → 实现复用 segments → 零单测 → jsdom 无法验证 CSS → 无视觉回归 → 审查照 PRD 核对`，六道关口全部失效。

## 3. ③ 系统性漏洞定位

| 分类 | 具体漏洞（文件即证据） | 说明 |
|------|----------------------|------|
| **需求表述漏洞** | `01-docs/PRD-STORY2VIDEO-HISTORY-VIEW-SCRIPT-2026-09-13.md` §3 U3（迭代 1 原文） | 把**实现细节**（`【N】` 编号、分段结构）当成需求写进 PRD，未区分「用户可见的原始输入」与「内部编辑结构」。需求文档一旦写实现细节，就会反向固化错误设计 |
| **测试覆盖漏洞** | `apps/desktop/src/views/ResultView.test.js` | 迭代 1 为 `ResultView.vue` 新增了弹窗 + 复制逻辑（含 1.5s 定时器状态机），却 0 用例覆盖；该文件既有 104 例全都不涉及 |
| **门禁缺失漏洞** | 无「展示容器换行」契约测试 | jsdom 不应用 `@media`/scoped CSS，纯样式缺陷对单测天生不可见；只有源码级正则契约能补位，但没有为"长文本展示容器"建契约 |
| **取数口径漏洞** | 全仓无「展示原文必须来自最初落盘字段」的约定 | 同一份内容在项目里存在三种形态（`sourceText` 原文 / `segments[].text` 分段 / `story2videoTextConfig.config.prompt` 配置副本），缺少选型约定，任一处随手取用即出错 |

## 4. ④ 修复 + 回归保护测试

### 4.1 修复（`apps/desktop/src/views/ResultView.vue`）

```js
// 弹窗与复制共用同一份文本：优先原始文案（分句/分段之前的完整输入）。
// sourceText 由流水线启动时 params.text 落盘（story2video-project-service.js），
// 是用户在创作页提交的原文；segments[].text 是分句后的分段，带编号会污染复制内容。
scriptText() {
  const sourceText = (this.project && typeof this.project.sourceText === 'string')
    ? this.project.sourceText.trim()
    : ''
  if (sourceText) return sourceText
  // 兼容缺失 sourceText 的历史项目（老版本落盘）：回退为分段文字拼接，且不带分段编号。
  if (!Array.isArray(this.segments) || !this.segments.length) return ''
  return this.segments
    .map(segment => (segment && typeof segment.text === 'string') ? segment.text.trim() : '')
    .filter(Boolean)
    .join('\n\n')
},
```

```css
/* 查看文案弹窗：原文案含原始换行与超长行。pre 默认 white-space: pre 不折行，
   长行会横向溢出弹窗（内容被裁切）。pre-wrap 保留原始换行并自动折行；
   overflow-wrap/word-break 兜底 URL 等无空格长串。滚动交给 .ui-modal-body，不叠第二层滚动条。 */
.script-modal-body { min-width: 0; }
.script-text { margin: 0; color: var(--text); font-family: inherit; font-size: 13px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
```

其他小改：弹窗 `test-id="script-modal"`、正文 `data-testid="script-text"`、复制按钮 `data-testid="script-copy-button"`（便于稳定定位与回归）。

### 4.2 回归保护测试（`apps/desktop/src/views/ResultView.test.js`，新增 `describe("查看文案弹窗（展示流水线原始文案 + 自动换行）")`）

| # | 用例 | 断言要点 | 模式 |
|---|------|---------|------|
| 1 | 展示流水线原始文案（分句前全文），不包含分段编号 | 设 `project.sourceText` = 含 `\n\n` 的三句原文，同时给 `segments` 两条分段；`document.body` 查 `[data-testid="script-text"]`，`textContent` **逐字符等于** `sourceText`，且 `not.toContain("【")` | 单元（真实组件挂载 + Teleport 到 body） |
| 2 | 历史项目缺失 `sourceText` 时回退分段文字（不带编号、跳过空段） | `project` 无 `sourceText`，`segments` = 有值/纯空白/有值 → 结果 `"甲段\n\n乙段"`，无空行堆积、无 `【` | 单元 |
| 3 | 既无原始文案也无分段时内容为空且复制按钮禁用 | `sourceText="   "` + `segments=[]` → `textContent === ""`，复制按钮 `hasAttribute("disabled")` | 单元 |
| 4 | 复制内容为原始文案全文（不含分段编号） | stub `navigator.clipboard.writeText`，`copyScript()` 后断言 `toHaveBeenCalledWith("原始文案全文")` | 单元 |
| 5 | 弹窗文本容器声明自动换行（源码契约） | `fs.readFileSync("./src/views/ResultView.vue")` 正则提取 `.script-text {...}`，断言含 `white-space: pre-wrap` / `overflow-wrap: anywhere` / `word-break: break-word` | 源码级契约（jsdom 不应用 scoped CSS） |

**RED → GREEN 证据**：

- RED（临时回退 `ResultView.vue` 到修复前）：`Tests 5 failed | 125 passed (130)` — 新增 5 条全部失败（含 CSS 契约）。命令输出：`src/views/ResultView.test.js (109 tests | 5 failed)`。
- GREEN（应用修复）：`Test Files 1 passed (1)`、`Tests 109 passed (109)`。

## 5. ⑤ 预防措施（已落地的具体文件变更）

1. **PRD 修订**（`01-docs/PRD-STORY2VIDEO-HISTORY-VIEW-SCRIPT-2026-09-13.md`）：
   - U3 由「按分段编号【N】组织」改为「展示启动流水线时的**原始文案**（分句前全文），保留原文段落与换行」；U4 明确「弹窗与复制内容**不得包含**分段序号」。
   - **新增 §4.2 文案来源（取数口径）**：完整列出 `sourceText` 写入链（`saveRun` / `saveEditableRun` / `ensureProjectFromRun` / `story2video:get-project`）与三级取值优先级 + 降级规则。
   - **新增 §4.4 换行与滚动**（含 CSS 契约代码块）、§5 数据校验 11 项、§6 显示项清单、§7 提示文字、§8 状态机、§9 边界情况、§10 验收标准、§13 变更记录（显式标注迭代 1 需求**作废**）。
2. **learnings 沉淀**（`01-docs/learnings.md`）：新增 pitfall「展示原始输入必须回溯到最初落盘的原文案字段」「`<pre>` 展示容器必须显式声明 `white-space` 并配源码级契约测试」「需求文档不得把实现细节当需求」。
3. **CHANGELOG**（`01-docs/CHANGELOG.md`）：追加迭代 2 条目（修复 / 测试 / 文档）。
4. **回归测试进 CI**：新增 5 条用例随 `apps/desktop` 前端测试集在 CI 全量执行；其中第 5 条为**源码级 CSS 契约**，能拦住"class 名写了但样式没落地"这类 jsdom 盲区。
5. **审查清单建议（后续可落地）**：审查「展示类」需求时强制追问三件事——① 数据来自哪个字段？是不是用户原始输入？② 展示容器是否声明了换行/溢出策略？③ 复制内容与展示内容是否同源（同一 computed）？

## 6. 交互时序（修复后）

```
创作页提交文案 text
  └─ pipelineStartOrchestrated(params.text = text)
       └─ 主进程 split 阶段：text → sentences → scenes → segments[].text（分句后）
       └─ 主进程 saveRun()：project.sourceText = params.text（原文案，不参与分句）
历史记录 → 任务详情页（/create/result?project=<id>）
  └─ story2videoGetProject(projectId) → project{ sourceText, segments, ... }
       └─ 点击【查看文案】→ 弹窗渲染 scriptText
            ├─ sourceText 非空 → 原文案（pre-wrap 折行，无序号）
            └─ sourceText 空   → segments[].text 双换行拼接（无序号）
```

## 7. 提示文字

本次修复**未新增/未修改**任何用户可见文案，`apps/desktop/src/locales/zh.js` 与 `en.js` 无变更（无 i18n 成对改动）。复用 key 见 PRD §7。

## 8. 边界情况

见 PRD §9。补充两条与本次修复直接相关：

- `sourceText` 存在但仅含空白 → 视为空，走降级；降级也为空则弹窗空内容 + 复制禁用（不渲染空白弹窗）。
- 编辑分段（旁白文字）后再打开弹窗：`sourceText` 不变 → 弹窗内容**不会**随分段编辑变化。这是**预期行为**——弹窗固定展示「最初提交的原文案」；分段编辑的实时结果在编辑区查看。
