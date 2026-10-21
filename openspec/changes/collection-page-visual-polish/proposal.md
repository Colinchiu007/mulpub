# Proposal：采集页视觉精致化（collection-page-visual-polish）

## Why

PR #3864（collection-page-ui-ue-refine）解决的是**机制性缺陷**：消费了不存在的类、
主次分级在视觉上不成立、六套按钮方言、35 处硬编码 hex、死文件。那些修复是对的，
但用户复看后反馈「视觉上还是不够精致」——说明机制修复没有触及**视觉骨架与节奏**。

本轮只做这件事：让采集页从"能用"变成"安静、齐整、有主次"。

## What Changes

按 PRD（`01-docs/PRD-COLLECTION-PAGE-VISUAL-POLISH-2026-10-20.md`）§2 的 8 条取证根因：

| 项 | 改动 | 判据 |
|---|---|---|
| D1 | 删除面板顶部 4px 橙红渐变 + `3s infinite` 扫光饰带与 `@keyframes col-panel-ribbon` | A1 |
| D2 | 采集域间距统一到 4px 刻度（`--col-card-gap: var(--spacing-3)`），不再混用 `--space-*` | A4 |
| D3 | 卡片标题 `-webkit-line-clamp: 2` + 显式 `line-height: 1.45` + `word-break` | A3 |
| D4 | 卡片内间距走 `--col-card-gap`，消除 `gap:14px` / `margin-top:2px` | A4 |
| D5 | 卡片内按钮 28px/12px → 32px/13px（`--col-btn-h` / `--font-size-sm`） | A2 |
| D6 | 保留 4 操作但尺寸与填充分级（详见 PRD §4 决策记录：为何不用「收进更多菜单」） | — |
| D7 | `.cohere-card` 的 `cursor:pointer` 在采集域还原为 `default`（卡片本体不可点） | A7 |
| D8 | 无效结果（无标题且/或 0 字）加 `col-result-card--invalid` 视觉态 + 提示行 | A5/A5b |

## Impact

- **Affected code**：`apps/desktop/src/features/collection/{collection-page.css,CollectedResultsList.vue,collected-result-validity.js}`、`apps/desktop/src/locales/collection/{zh,en}.js`（新增 1 个 key，成对）
- **新增**：`collection-page-visual-polish.test.js`（27 例契约 + 9 例行为）
- **不改**：数据模型、IPC 契约、5 页签集合、默认页签、`zhihu-fav-*` testid、`cohere-design-system.css` 全局规则、`tokens.css` 既有槽
- **Spec**：`openspec/specs/collection-ui/spec.md` 追加「采集页视觉精致化」Requirement 组
- **风险**：视觉基线大面积变化（预期内，按 QM-4 用 CI 同源渲染回填）
