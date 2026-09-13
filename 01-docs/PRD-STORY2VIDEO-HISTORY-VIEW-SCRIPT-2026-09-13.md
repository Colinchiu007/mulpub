# PRD — 视频创作·历史记录·任务详情页「查看文案」

- **状态**：已交付 · 迭代 2（2026-09-13 修复：改为展示流水线**原始文案** + 弹窗文本**自动换行**）
- **分支**：`codex/fix-view-script-raw-text`（迭代 2）；迭代 1 为 `codex/view-copy-text`（已合并）
- **关联页面**：视频创作 → 历史记录 → 任务详情页（编辑页），路由 `/create/result`
- **关联组件**：`apps/desktop/src/views/ResultView.vue`
- **创建日期**：2026-09-13 ｜ **最近更新**：2026-09-13（迭代 2）
- **关联缺陷单**：`01-docs/BUGFIX-STORY2VIDEO-VIEW-SCRIPT-RAW-TEXT-2026-09-13.md`

---

## 1. 背景

视频创作·历史记录的任务详情页（编辑页）在成品视频下方提供按钮操作区，已有【下载视频】等能力。用户希望在不离开编辑页的前提下，快速查看该任务对应的**全部文案**，并一键复制到剪贴板，便于二次编辑、复用或归档。

**迭代 1**（PR 已合并）新增了【查看文案】按钮 + 模态弹窗 + 复制能力，但取数口径选错了：弹窗读取的是流水线**分句/分段之后**的 `segments[].text`，并按 `【N】` 编号拼接。这带来两个用户可见问题：

1. **序号污染**：弹窗与复制内容里带上了分段序号 `【1】【2】…`。序号是内部编辑视图的组织方式，不是用户原文的一部分，复制到第三方编辑器后需要手工清理。
2. **丢失原文结构**：分句会重新切分句子、按字数合并为「场景（scene）」，因此原稿的段落划分与换行全部丢失，展示出来的不再是用户提交的那份文案。
3. **不换行（视觉缺陷）**：弹窗文本容器是 `<pre>` 且未定义任何换行相关 CSS。`<pre>` 默认 `white-space: pre`，长行不折行，内容横向溢出弹窗被裁切，用户只能读到每行开头的一小段。

**迭代 2** 把取数口径改为**流水线启动时的原始文案**（`project.sourceText`，即用户提交的 `params.text`），并补齐换行/折行样式。

## 2. 目标

- 【查看文案】弹窗展示**启动视频流水线时提交的原始文案**（分句、分段之前的完整文本），保留用户原文的段落与换行。
- 弹窗内容与复制内容中**不出现分段序号**等内部编辑标记。
- 长文本在弹窗内**自动折行**，不出现横向溢出/裁切；超长内容由弹窗内容区纵向滚动承载。
- 老数据（缺失原始文案字段的历史项目）不出现空窗或报错，按文档化的降级规则回退展示。

## 3. 用户需求

| 编号 | 需求 | 优先级 | 迭代 |
|------|------|--------|------|
| U1 | 任务详情页成品视频下方按钮区，【下载视频】右侧显示【查看文案】按钮 | P0 | 1 |
| U2 | 点击【查看文案】打开模态弹窗，展示全部文案文字 | P0 | 1 |
| U3 | 文案内容为**启动流水线时的原始文案**（分句前全文），保留原文段落与换行 | P0 | **2（修订）** |
| U4 | 弹窗与复制内容**不得包含分段序号**（`【N】`）等内部编辑标记 | P0 | **2（修订）** |
| U5 | 文案超出弹窗宽度时**自动折行**；超长内容纵向滚动 | P0 | **2（新增）** |
| U6 | 原始文案缺失的历史项目按降级规则回退展示，且不报错 | P0 | **2（新增）** |
| U7 | 弹窗底部【复制】按钮将弹窗所示**同一份文本**复制到剪贴板 | P0 | 1/2 |
| U8 | 复制成功后按钮文案变为「已复制」，1.5 秒后恢复「复制」 | P0 | 1 |
| U9 | 关闭弹窗重置复制状态 | P0 | 1 |
| U10 | 无任何可展示文案时，【复制】按钮禁用，不复制空串 | P1 | 2（明确） |

> 迭代 1 的原始需求「按分段编号【N】+文案内容组织，段间双换行分隔，空段显示【N】（无文案）」**已作废**，被 U3/U4 取代。

## 4. 功能规格

### 4.1 入口按钮

- **位置**：任务详情页（编辑页）成品视频下方按钮区，【下载视频】**右侧**。
- **显示条件**：与【下载视频】同区渲染，不额外增加显隐条件。
- **按钮文案**：i18n `story2video.view_script`（zh「查看文案」/ en「View Script」）。
- **点击行为**：置 `scriptModalVisible = true`，打开文案模态弹窗。

### 4.2 文案来源（取数口径，迭代 2 核心变更）

**唯一数据源**：任务详情页既有项目对象 `project.sourceText`（不新增 IPC / 不新增数据源）。

`sourceText` 是流水线启动时由主进程落盘的**原始文案**，写入链如下（`apps/desktop/electron/services/story2video-project-service.js`）：

| 环节 | 位置 | 说明 |
|------|------|------|
| 用户提交 | `apps/desktop/src/views/CreateView.vue`（启动编排 `params.text = this.pipelineText.trim()`） | 用户在创作页输入的整篇文案 |
| 成片回写 | `story2video-project-service.js` → `saveRun()`（`sourceText = safeText(run.params?.text \|\| story2videoTextConfig?.config?.prompt, 100000)`） | 成片合成完成后写项目 |
| 草稿建立 | `story2video-project-service.js` → `saveEditableRun()`（同口径） | 成片前建立可编辑草稿 |
| 项目重建 | `story2video-project-service.js` → `ensureProjectFromRun()`（`sourceText: payload.sourceText \|\| ''`） | historical run 重建丢失项目 |
| 读取 | IPC `story2video:get-project` → `story2video-project-service.getProject(projectId)` 返回**完整项目对象（含 `sourceText`）** | 前端 API `story2videoGetProject`（`apps/desktop/src/api/publisher.js`） |

**展示取值优先级**（`ResultView.vue` computed `scriptText`）：

1. `project.sourceText`（`trim()` 后非空）→ **原样展示**（仅做首尾空白裁剪，不改动内部换行与标点）。
2. 否则（`sourceText` 为空/缺失，老版本落盘的历史项目）→ **降级**：取 `segments[].text` 逐个 `trim()`、**过滤空段**、以双换行 `\n\n` 连接。降级路径同样**不加序号**。
3. 两者都为空 → 空字符串（弹窗空内容 + 复制按钮禁用）。

**不做的事**：不做分句/分段、不重排句子、不合并段落、不做字数截断、不做 Markdown 渲染。

### 4.3 展示格式

- 弹窗标题：i18n `story2video.script_modal_title`（zh「全部文案」/ en「Full Script」）。
- 正文容器：`<pre class="script-text" data-testid="script-text">`，内容与 `scriptText` 完全一致。
- 保留原文换行：`white-space: pre-wrap`（连续空格与换行原样保留，同时允许自动折行）。
- 不展示分段序号、不展示「（无文案）」占位、不展示任何分段/场景边界标记。
- 展示范围：**全部**文字，不截断。

### 4.4 换行与滚动（迭代 2 新增）

`.script-text` 样式契约（`ResultView.vue` `<style scoped>`）：

```css
.script-modal-body { min-width: 0; }
.script-text {
  margin: 0;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;     /* 保留原文换行 + 自动折行 */
  overflow-wrap: anywhere;   /* URL / 无空格长串兜底断行 */
  word-break: break-word;
}
```

- **折行**：任何超宽行（长句、长 URL、无空格长串）必须在弹窗宽度内折行，**不得出现横向滚动条或内容裁切**。
- **滚动**：纵向滚动由弹窗自身内容区 `.ui-modal-body`（`overflow-y: auto`，`min-height: 0`）承担；`.script-modal-body` **不再设置 `max-height`**，避免出现双层嵌套滚动条。
- **字体**：继承弹窗字体（`font-family: inherit`），不使用等宽字体，避免中文排版异常。

### 4.5 复制功能

- **复制内容**：与弹窗展示**完全一致**的同一份文本（即 computed `scriptText`），保证「所见即所复制」。
- **实现**：优先 `navigator.clipboard.writeText(text)`；剪贴板 API 不可用（非安全上下文等）时回退：创建临时 `<textarea>` → `select()` → `document.execCommand('copy')` → 移除节点。
- **成功反馈**：复制成功后按钮文案由「复制」变为「已复制」（`script_copied_button`），1.5 秒后自动恢复「复制」。
- **空文本**：`scriptText` 为空时按钮 `disabled`，点击不产生任何副作用。
- **失败处理**：`catch` 分支不置成功态，保证不误报「已复制」。

### 4.6 弹窗交互

- **打开**：点击【查看文案】。
- **关闭**：关闭按钮（×）/ 点击遮罩 / 关闭按钮 Esc 走 `closeScriptModal()`。
- **状态重置**：关闭时同时复位 `copyingScript = false`，保证下次打开按钮为「复制」初始态。
- **模态属性**：`size="lg"`、`test-id="script-modal"`（便于测试与自动化定位）。

## 5. 数据校验

| 场景 | 输入 | 期望行为 |
|------|------|----------|
| 正常原文 | `sourceText` 为多段中长文 | 原样展示，段落与换行不变 |
| 首尾空白 | `sourceText` 带首尾空格/换行 | `trim()` 后展示（仅裁首尾，内部不动） |
| 空白原文 | `sourceText` 为 `"   "` / `"\n\n"` | 视为空 → 走降级；降级也为空 → 空内容 + 复制禁用 |
| 原文缺失 | `sourceText` 为 `null` / `undefined` / 非字符串 | 走降级（不抛错、不渲染 `null`/`undefined` 字面量） |
| 无分段 | `segments` 为空数组或非数组 | 降级结果为空串 |
| 空段 | `segments[i].text` 为空白 | 降级时该段被**过滤**，不产生空行堆积 |
| 超长单行 | 单行数千字符（含长 URL） | `pre-wrap` + `overflow-wrap: anywhere` 折行，无横向溢出 |
| 超长全文 | 数万字 | 弹窗内容区纵向滚动 |
| 特殊字符 | 换行、制表符、引号、Emoji、`<script>` 等 | 走 Vue 文本插值（`{{ }}`）转义，**无 XSS 风险**，不解析为 HTML |
| 超大体积 | `sourceText` 落盘上限 100000 字符（主进程 `safeText` 截断） | 前端无需二次截断 |

## 6. 显示项清单

| 元素 | 内容 | 来源 | 显隐条件 |
|------|------|------|----------|
| 按钮 | 查看文案 / View Script | `story2video.view_script` | 与【下载视频】同区，常态化显示 |
| 弹窗标题 | 全部文案 / Full Script | `story2video.script_modal_title` | 弹窗打开时 |
| 弹窗正文 | 原始文案全文 | `scriptText` computed | 弹窗打开时 |
| 复制按钮 | 复制 / Copy | `story2video.script_copy_button` | 弹窗打开时；`scriptText` 为空 → 禁用 |
| 复制按钮（成功后 1.5s） | 已复制 / Copied | `story2video.script_copied_button` | `copyingScript === true` |
| 关闭按钮 | 关闭 / Close | `common.close` | 弹窗打开时 |

## 7. 提示文字（i18n 契约）

| 场景 | 中文 | 英文 | key |
|------|------|------|-----|
| 查看文案按钮 | 查看文案 | View Script | `story2video.view_script` |
| 弹窗标题 | 全部文案 | Full Script | `story2video.script_modal_title` |
| 复制成功（保留 key，弹窗内以按钮态呈现） | 文案已复制到剪贴板 | Script copied to clipboard | `story2video.script_copied` |
| 复制按钮 | 复制 | Copy | `story2video.script_copy_button` |
| 复制后按钮 | 已复制 | Copied | `story2video.script_copied_button` |
| 关闭按钮 | 关闭 | Close | `common.close` |

> 迭代 2 **未新增任何 i18n key**，`zh.js` / `en.js` 无需成对改动（无硬编码中文新增）。

## 8. 交互逻辑与状态机

```
点击【查看文案】
   └─ scriptModalVisible = true
        └─ 渲染弹窗：标题 + <pre>{{ scriptText }}</pre> + 复制/关闭
             ├─ 点击【复制】(scriptText 非空)
             │     ├─ clipboard.writeText(scriptText) 成功 → copyingScript = true → 1.5s 后 false
             │     └─ 失败/不可用 → 回退 textarea + execCommand → 仍失败则保持「复制」
             └─ 关闭（× / 遮罩 / Esc）
                   └─ scriptModalVisible = false；copyingScript = false
```

- 复制按钮的 1.5 秒复位使用定时器；连续多次点击复制会重新写入并重新计时。
- 弹窗关闭后组件仍存活，`scriptText` 为 computed 派生，**无额外缓存**，编辑分段后再打开会重新计算（注意：`sourceText` 不变，因此原文案口径下编辑分段**不影响**弹窗内容——这是预期行为，见 §10）。

## 9. 边界情况

- 任务只有成片、无分段（`segments = []`）但 `sourceText` 存在 → 正常展示原文案（迭代 1 在此场景会展示空白）。
- 仅文件路径打开结果页（无 `project`，无分段）→ 空内容 + 复制禁用，不报错。
- 文案含 `\r\n`（Windows 换行）→ `pre-wrap` 原样渲染为换行。
- 弹窗尺寸随视口变化（`size="lg"` → 最大宽度 640px；小屏 `@media (max-width: 768px)` 由 `UiModal` 收敛内边距）→ 折行随容器宽度自适应。
- 深色主题：文本色使用 `var(--text)`，随主题切换，不写死颜色。
- 复制过程中关闭弹窗 → 不抛错（`copyingScript` 一并复位）。
- 粘贴校验：复制内容不含 `【`，可直接用于第三方编辑器/ASR 脚本。

## 10. 验收标准

1. 任务详情页存在【查看文案】按钮，位于【下载视频】右侧。
2. 点击后弹窗标题为「全部文案」，正文为**启动流水线时提交的原始文案**（与创作页输入一致，含原有段落与换行）。
3. 弹窗正文与复制结果**均不含** `【N】` 序号或「（无文案）」占位。
4. 长行/长 URL 在弹窗内**自动折行**，无横向溢出、无内容裁切；超长正文纵向可滚动，且只有一层滚动条。
5. 复制按钮复制的内容与弹窗展示逐字符一致；成功后显示「已复制」，1.5 秒后恢复「复制」。
6. 关闭再打开弹窗，复制按钮回到「复制」初始态。
7. `sourceText` 缺失的历史项目回退展示分段文字（不带编号），无空窗、无报错。
8. 无任何文案时弹窗为空且复制按钮禁用。
9. 涉及本次改动的前端用例全绿（`ResultView.test.js` 109 例），无既有用例回归。

## 11. 文件变更

| 文件 | 变更 |
|------|------|
| `apps/desktop/src/views/ResultView.vue` | computed `scriptText` 改为「`project.sourceText` 优先 + 分段降级（无编号）」；弹窗 DOM 增加 `data-testid`；新增 `.script-text` / `.script-modal-body` 换行样式 |
| `apps/desktop/src/views/ResultView.test.js` | 新增 5 条回归用例（原文案优先/无编号、老项目降级、空态与按钮禁用、复制内容为原文案、CSS 换行契约） |
| `01-docs/PRD-STORY2VIDEO-HISTORY-VIEW-SCRIPT-2026-09-13.md` | 本文件，迭代 2 修订 |
| `01-docs/BUGFIX-STORY2VIDEO-VIEW-SCRIPT-RAW-TEXT-2026-09-13.md` | 新增：Bug 反思 5 步 |
| `01-docs/CHANGELOG.md` | 追加迭代 2 条目 |
| `01-docs/learnings.md` | 追加 pitfall（展示态取数口径 + `<pre>` 默认不折行） |

## 12. 非目标（Out of Scope）

- 不新增 IPC 通道（文案复用 `project.sourceText`，`story2video:get-project` 已返回）。
- 不修改文案的持久化结构（`sourceText` 字段早已存在并落盘）。
- 不提供文案编辑能力（仅查看与复制）。
- 不在弹窗内做分段/场景对应关系展示（那是编辑区「分段编辑」的职责）。
- 不改动【下载视频】等既有按钮行为。
- 不新增 i18n key。

## 13. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-09-13 | 迭代 1 | 新增【查看文案】按钮 + 弹窗 + 复制；文案取 `segments[].text` 并加 `【N】` 编号（**已作废**） |
| 2026-09-13 | 迭代 2 | 取数口径改为 `project.sourceText`（分句前原文案）；移除序号；补齐折行/滚动样式；明确降级与空态规则；补回归测试与 Bug 反思文档 |
