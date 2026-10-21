# 变更：把运营公告横幅接回应用外壳（UX 审计阶段 1 · 单元 1.2）

## Why

`src/components/AnnouncementBanner.vue` 已完整实现（severity 分档、可关闭、localStorage 记忆已关闭项、
浅暗两档样式），但**全仓没有任何引用方**——实测（在本 worktree 的 `apps/desktop` 下，含测试目录）：

```
$ grep -rna "AnnouncementBanner" src electron
（零命中）
$ grep -rna "useOpsCenterRuntime" src | grep -v "\.test\.js\|composables/useOpsCenterRuntime.js"
src/components/AnnouncementBanner.vue:27: import { useOpsCenterRuntime } ...
src/components/AnnouncementBanner.vue:29: const { announcements, SEVERITY_LABELS, loadRuntime } = ...
```

即：组件被**唯一**引用它那个 composable 的人引用，而它自己不被任何人引用——连一条测试都没有。
它的下游 `useOpsCenterRuntime().announcements` 由运营中心下发。于是当前状态是：
运营同学在后台发了公告、接口返回 200、`announcements` 有数据，**用户在界面上永远看不到**——
「系统维护」「重要提醒」这类通知形同虚设。这与单元 1.1（`useTheme` 已实现零消费方）是同一形状：
已完成的能力在用户侧不可达。

## What Changes

- 在应用外壳（`App.vue` 的非全屏、非壳态分支）挂载 `AnnouncementBanner`，位置在 `NavBar` 之后、
  工作区 `main` 之前，**不改动任何内嵌视图几何常量**（`TOP=76` 契约保持）。
- 组件内所有硬编码中文迁入 locales 并与 en 成对：`role="region"` 的 `aria-label`、关闭按钮 `aria-label`、
  severity 兜底文案，以及 `useOpsCenterRuntime.js` 里的 `SEVERITY_LABELS`。
- 新增「公告可见性合同」的行为锁：有公告才渲染、无公告不占位、关闭后按 id 记忆、旧数据无 id 时按内容摘要降级、
  维护档不提供关闭按钮（不可关）。
- 新增一条**注册≠渲染**的接线锁：`App.vue` 必须真的渲染该组件（防止下一轮改动又把它摘掉而测试仍全绿）。
- 同步更正审计文档单元 1.2 行的落地状态，并补 PRD。

## Impact

- Affected specs: `desktop-ui-consistency`（新增「下发型 UI 必须有生产渲染方」要求）
- Affected code: `apps/desktop/src/App.vue`、`src/components/AnnouncementBanner.vue`、
  `src/composables/useOpsCenterRuntime.js`、`src/locales/**`（zh/en 成对）、新增 `src/components/AnnouncementBanner.mount.test.js`
- 视觉判定域：横幅进入外壳后，`home-*` / `settings-general` 等基线截图的内容区顶部会变化——
  **但组件在 `announcements.length === 0` 时不渲染任何东西**（`v-if`），CI 基线环境不会收到运营中心数据，
  因此预期零像素回归。若 CI 实测出现回归，按「基线只能取自同一次 CI 渲染」的既有口径刷新，禁止用本机截图或 `--update-baseline` 消化。
- 残留限制（如实写明，不在本批解决）：浏览器/登录标签前台时，内嵌 `WebContentsView` 覆盖内容矩形，
  公告会被一起遮住。彻底解决要么登记 `useEmbeddedViewSuspension` owner（每次来公告就隐藏用户正在看的平台页，
  UX 代价明显），要么改 `TOP=76` 几何契约（属主进程+渲染端双向合同变更）。本批取「不破坏几何」这一档，
  并把该限制写进 PRD 与记录。
