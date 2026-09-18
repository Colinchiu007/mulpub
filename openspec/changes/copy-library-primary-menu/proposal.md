# 一级菜单新增「文案库」：聚合全应用文案来源

## Why

用户反馈：文案库目前藏在采集页的「文案库」标签里，且数据源不全面——只聚合了采集正文（collected_items）和改写文案（copy_library_rewrites）两个来源。应用中主要产生的文案（采集的、改写的、热门选题页文案创作的、视频生成过程中的文案）都应该在文案库里，且应作为一级菜单入口直达。

## What Changes

- 一级菜单新增「文案库」（key=copy-library，位置：采集之后、文案改写之前），路由 /copy-library，新建 CopyLibraryView.vue 页面
- 新建 useCopyLibrarySources.js 聚合 composable，统一聚合 4 个文案来源：
  1. 采集正文（collected_items settings key，实时合成不复制）
  2. 改写文案（copy_library_rewrites settings key，上限 200）
  3. 草稿（drafts settings key，含热门选题页文案创作产物）
  4. 视频创作文案（story2video 项目 sourceText，经 story2videoListProjects IPC，预览截断）
- 来源筛选（全部/采集/改写/草稿/视频创作）、关键词搜索、统一卡片列表（来源徽标 + 标题 + 字数 + 时间）
- 采集页现有文案库 tab 保持不变（双入口共享同一数据层 composable，不复制数据）
- 运营中心 app_menu_service.py CATALOG 同步新增 copy-library 种子项

## 差异审计（基线 vs 现状）

| 来源 | 现状 | 结论 |
|------|------|------|
| collected_items | 采集页文案库 tab 已聚合 | 复用，无需新做 |
| copy_library_rewrites | 采集页文案库 tab 已聚合 | 复用，无需新做 |
| drafts（含热门选题创作产物） | 未入文案库 | **本次新增** |
| story2video sourceText（视频创作文案） | 未入文案库 | **本次新增** |
| rewrite_history 表 | SQLite 改写历史，与 copy_library_rewrites 内容高度重复，且 listRewriteHistory 无 owner 过滤（需先修 owner 泄露风险） | 暂缓（v2） |
| publish_history | 写入端只写 platform/title/taskId/status/result，无正文（record.description 仅读取兜底） | 暂缓（v2） |
| AiWriter 标题/摘要 | 纯内存瞬态，不落盘 | 不接入 |

## Impact

- apps/desktop/src/config/route-registry.js（ROUTE_REGISTRY + SIDEBAR_MENU_KEY_ORDER）
- apps/desktop/src/router/index.js（新路由）
- apps/desktop/src/views/CopyLibraryView.vue（新增）
- apps/desktop/src/composables/useCopyLibrarySources.js（新增）
- apps/desktop/src/locales/zh.js / en.js（成对新增 i18n）
- apps/desktop/src/config/sidebar-menu.test.js（EXPECTED_DERIVED_MENU 冻结基线）
- ops-center/backend/services/app_menu_service.py（CATALOG 种子）
- 01-docs/PRD.md + 专项 PRD + CHANGELOG.md

## 风险

- 一级菜单从 7 项变 8 项，侧边栏纵向空间需验证（MpSidebar 小图标+文字模式，8 项可承受）
- sourceText 单条可达 100KB，聚合列表必须截断预览（500 字）避免内存/渲染压力
- drafts 与 collected_items 可能有同内容条目（采集→草稿流转），v1 不做内容去重，按来源独立展示（业务语义不同阶段）
