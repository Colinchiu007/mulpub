# Proposal v1 — 故事讲述流水线详情页视觉与交互精致化

- 出方案方：anthropic-claude（主代理）
- 输入计划：`故事讲述流水线页精致化_task-8f8.md`
- 工作区：`D:/Data/projects/mp-worktrees/mp-ui-story2video-detail-polish` @ `codex/ui-story2video-detail-polish`（HEAD 4150374b0，基于 main）
- 依赖就绪证据：`pnpm install --frozen-lockfile` rc=0（38.1s，reused 1316）；`node scripts/ensure-electron.js` → v43.1.1；`node scripts/verify-worktree-deps.js` → OK，消费方解析通过 11 项

## 1. 问题与根因（全部带文件行号证据）

| # | 根因 | 证据 | 等级 |
|---|------|------|------|
| R1 | `.create-page` 缺 `width: 100%`。父 `.cohere-main` 为 flex column（`App.vue#L52`），交叉轴上的 `margin: 0 auto` 抑制 `align-self: stretch`，宽度退化为 `fit-content(max-content)` → 设计列宽 1080px 实际约 500px | `create-view.css#L7`；同类缺陷已由项目定性为 Bug 并给出修复范式：`cohere-design-system.css#L512-L525`（BUGFIX-REWRITE-PAGE-WIDTH，2026-09-16） | P0 |
| R2 | `.back-btn` 位于 `flex-direction: column` 的 `.pipeline-detail` 中被 `align-items: stretch` 拉成通栏灰条 | `create-view.css#L92-L99` | P0 |
| R3 | 详情页 6 个原生 `<input type="range">` 与全部裸 `<select class="form-select">` 零定制，滑条呈 Chrome 默认亮蓝，与品牌紫 `--color-primary: #5048E5` 冲突 | `create-view.css#L243-L245`（`.form-range { width: 100%; }` 仅此一行）；`CreateView.vue#L216,L220,L340,L485,L492,L494` | P0 |
| R4 | 令牌/组件双轨：`UiButton/UiSelect/UiInput` 消费 `@deprecated` 的 `--apple-*`（`--apple-accent → --color-apple-accent = #007aff`），与 `--color-primary` 不同源；详情页混用 `UiButton + .btn-start + .btn-secondary + .reset-options-link + 原生 button`，未复用既有 `.s2v-btn-*` | `UiButton.vue#L87-L97`、`apple-design-tokens.css#L7,L22`、`CreateView.vue#L840-L902`、`video-creation-buttons.css` | P1 |

次级粗糙源：`.view-tabs` 无宽度约束致尾部空灰；`.input-tab.active` 实心主色胶囊重量压过主 CTA；`.reset-options-link` 把 3 个真实操作降级为下划线灰文字；字符计数游离灰药丸；`detail-header` 卡片化而「输入内容」为裸 `<h3>`；`CreateView.vue#L231` 硬编码文案语句不通顺。

## 2. 两项定案决策

**D1 —— `S2vConfigPanels.vue` 绑定机制：provide/inject 受控访问器**

代码事实：`s2vConfig`（`CreateView.vue#L1650`）与 `s2vOutputConfig`（`#L1638`）各有 `deep: true` watcher（`#L2328`、`#L2329`），驱动 `s2vActiveConfigProfile = ''` + `scheduleS2VLastOptionsSave()`；`src/stores/` 下 11 个 store 无一涉及 s2v 配置。

否决项：逐字段 `update:modelValue`（38 个 optionKey → prop/emit 声明量超过被搬走的模板，违反「净降行数」）；整体 `v-model` + 新建对象（破坏引用稳定性，波及 `cloneForIpc#L2795-2796`、`applyS2VPipelineDefaults#L2843-2844`、profile 采集 `#L2863-2864`、快照回填 `#L3132`）；新建 pinia store（架构级变更，超出已确认范围）。

采纳：父 provide 一个闭包捕获 `this` 的访问器集合（`getPanelField(target, field)` / `setPanelField(target, field, value)` / `visible(key)` / `isOpen(group)` / `setGroupOpen(group, event)`），写操作最终落到 `this.s2vConfig[field] = value`，**既有 deep watcher 与保存节流行为逐字节不变**；子组件不 mutate prop，因此不触发 Vue 单向数据流告警。

**D2 —— 令牌双轨：详情页收敛到 `.s2v-btn-*` 品牌紫体系，不改 `--color-apple-accent` 取值**

`apple-design-tokens.css#L5-L6` 明确契约「T1-1 结构收敛：值冻结零视觉回归；是否与全局语义色合并由后续批次拍板」。改值会一次性改变全站所有 `UiButton` primary 颜色，属越范围的全站视觉基线变更。本次：详情页操作统一 `.s2v-btn-*`（已含暗色覆盖与 `:focus-visible`）；新组件 `UiSlider/UiField` 只消费 `tokens.css` 的 `--color-*`；顺带修 `.s2v-btn-primary` 的 fallback `#409eff`（Element 蓝）→ `var(--color-primary, #5048E5)`；全站 `--apple-*` 退役登记为独立 openspec backlog change。

## 3. 改动分组（A-L）

- **A 骨架修复（P0）**：`.create-page` 补 `width: 100%`；`.create-page--pipeline-detail` 补 `min-width: 0`；`.view-tabs` 改 4 等分栅格并移除 active 的 `transform: scale(1.02)`；`.back-btn` 补 `align-self: flex-start` 且详情页隐藏顶部 nav-arrow 去重；输入区提升为与 `detail-header` 同规格卡片；`.action-bar` 主 CTA 与辅助操作分左右组，保持 PRD §2.1.6「内层独立滚动 + 操作条正常流底部」合同不回退。
- **B 表单控件统一**：新增 `components/UiSlider.vue`（品牌色填充段 + thumb + 双击复位 + 键盘步长 + focus-visible + reduced-motion）与 `components/UiField.vue`（label/控件/hint/错误位/运营显隐）；新增 `styles/video-creation-forms.css`；详情页裸 `<select>` → `UiSelect`（新增 `optionKey/hint/error` 透传，本组件内 `--apple-*` → `--color-*`）。
- **C 信息架构与层级**：`.input-tab.active` 降级为浅底描边；`role="tablist"/"tab"/aria-selected`；三个 `.reset-options-link` → `.s2v-btn-ghost`（`data-testid` 全部保留）；字符计数入 textarea 内嵌槽并加 `<90%/≥90%/达上限` 三档色阶；折叠组 summary 摘要补「（默认）」后缀。
- **D 微交互**：配置组入场 stagger、卡片 hover 抬升、主 CTA shimmer、统一 `:focus-visible`。
- **E UE 加固**：启动禁用原因可见化（title + 常驻提示）；预估摘要无文案时显示占位防跳变；折叠展开态跨会话持久（并入既有 `scheduleS2VLastOptionsSave` payload，读取向后兼容）；不通顺文案修词并迁 locale。
- **F 面板抽取**：新建 `views/video-creation/S2vConfigPanels.vue`，迁入 `CreateView.vue` 的 `.s2v-config-sections` 子树；CreateView 净减 ≥500 行；`debt-baseline.json` 的 `MAX_FILE_LINES` 只允许下调。
- **G i18n**：`create.story2video.ui.*` 新键 zh/en 成对，同 commit 提交（CI Gate 7 拦截）。
- **H 测试**：`UiSlider.test.js`、`UiField.test.js`、`S2vConfigPanels.test.js` + CreateView 定向全量；视觉基线新增 `create-story2video-detail`，重生成受 R1 影响的 4 张。
- **I 文档**：PRD §11 字段级契约、CHANGELOG、`desktop-ui-layout-spec.md`、`frontend-interaction-spec.md`、`.quality-gates.md`、openspec change。
- **J CCG**：本评审。
- **K 记忆**：内置 + `learnings.jsonl` + EverOS 三处。
- **L 交付**：D 盘 worktree → 分阶段 commit → PR → CI 绿后 squash 自动合并 → `safe-worktree-remove.ps1` 收尾。

## 4. 已完成的代码事实核查（v1 附带）

| 断言 | 核查方式 | 结论 |
|------|---------|------|
| 全局 `box-sizing: border-box` 已存在，A 组无需重复声明 | `cohere-design-system.css#L100-L102` | 成立 |
| `s2vOptionVisible(...)` 在 CreateView 中的调用点数量 | `git grep -c` → 38 | 成立（抽取后须 38→38 守恒） |
| 详情页滑条数量 | `Grep form-range` → `CreateView.vue` 7 处，其中 `#L156` 属 AI 写作视图 | 6 处待迁移 |
| 像素基线是否在 PR CI 门禁路径 | `git grep -rn "test:visual:pixel" .github/workflows/` → 0 命中；仅 agent-judge/autonomous-loop 引用该目录 | 成立（本地重生成不会造成 PR CI 假失败，但需同步 agent-judge 可读性） |
| 计划引用的「既有 Staggered Reveal 动效系统」在 main 上存在 | `Grep stagger` 于 `apps/desktop/src` → **0 命中**（该实现仍在 `mp-staggered-reveal-animations` worktree，未合并） | **不成立** |
| 令牌 `--color-shadow-md` 存在 | `git grep shadow -- tokens.css` → 仅 `--shadow-sidebar-active`、`--shadow-float` | **不成立**，应使用 `--shadow-float` |
| `s2vConfig` 是否已有集中 optionKey→字段映射 | `CreateView.vue#L3268` `keyMap` 为 `applyS2VPipelineDefaults()` 内**局部常量** | 成立（不可直接复用，D1 需显式 target/field 以免形成第二份映射） |

## 5. 预期收益

设计列宽从约 500px 恢复至 1080px（消灭右侧死白）、6 个控件与品牌色一致、操作可点击性恢复、CreateView 行数下降 ≥500 行、详情页配置态首次纳入像素基线覆盖。
