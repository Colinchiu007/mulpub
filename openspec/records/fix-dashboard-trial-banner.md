---

sync_reason: PR 刚开、尚未合并，远程同步状态待回填
sync_backfill_owner: Colinchiu007（本分支作者，合并后同一次提交内删除本两字段）

record: fix-dashboard-trial-banner
task: 数据看板免费版横幅——宽度与左边缘对齐修正 + 位置回归锁
date: 2026-10-16
---

# 数据看板免费版横幅视觉修正（fix-dashboard-trial-banner，2026-10-16）

> 分支 `fix-dashboard-trial-banner`（隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-trial-banner`）；基线 `origin/main` @ `193ee0406`。

## 用户报的两个问题，与代码里的真因

| 用户观感 | 代码真因 |
| --- | --- |
| 「太宽了」 | `.banner-text { flex: 1 }` 把横幅拉满**整页**宽度，而下方内容区受 `.cohere-content` 的 `--space-xxl` 左右 padding 约束更窄 ⇒ 两者宽度不一致 |
| 「背景色左侧顶到边」 | `TrialBanner` 挂在 `.cohere-content` **外面**（`Dashboard.vue:16`），是全页唯一没有水平 padding 的元素 ⇒ 背景块左边缘直接贴容器边，与下方统计卡片不对齐 |

修法不是给横幅补一个 padding（那等于在组件里抄第二份内容区间距，`.cohere-content` 的 padding 一改就会漂移），而是**把它移进 `.cohere-content` 内部**继承同一份 padding。这是结构修正，不是数值补偿。

## 顺带的视觉精致化（对齐同项目既有范式）

与 `LoginExpiredBanner.vue` 的成熟写法对齐：emoji 装进 32×32 圆角色块（此前裸 emoji 与文字基线错位）、文字加 `min-width: 0`（flex 子项缺它时长文案不收缩而是撑破容器）、按钮改描边式（hover 实底化，取代实心小红按钮）、关闭键加 hover 反馈、窄屏 640px 兜底换行。

类名一个未改——`.trial-banner` / `.banner-btn` / `.banner-close` 被 `TrialBanner.test.js`、`more-tests.test.js` 依赖，`.banner-text` 是 `tests/visual-testing/scripts/contrast-probe.js` 的探针选择器，`tokens.css:365` 另有 `html[data-theme='dark'] .banner-btn` 暗色底覆盖。

`free` 档底色**保持原硬编码** `#f3f0ff` / `#c4b5fd`：tokens 无对应紫槽，而 `--color-primary-light` 亮色值是 `#eff6fb`（浅蓝），换过去是与本需求无关的色相回归。`trial` 档改用 `--color-warning-soft` / `--color-warning`（与原 `#fef3c7` / `#fbbf24` **同值**，零视觉回归）。

## 一条必须说清的口径：横幅文案是误导的（未擅自改）

用户追问「部分功能受限」指本页什么受限。查证结论：**本页没有任何一项功能/内容因免费版受限**，该文案是全局账号状态提示被当成本页提示用了。三条证据：

1. 本页数据源 `dashboard:stats` 映射 feature `publish_history`，属 `LOGIN_ONLY_FEATURE_MAP`——源码注释明写「当前**不强制**服务端下发 feature」，门禁是**登录**而非**套餐**；未登录走的是另一条独立的 `.dashboard-login-gate` 引导条。
2. 唯一与看板沾边的套餐字段 `dashboard: 'basic'|'full'` → 派生 feature `dashboard_full`，全仓 grep 仅存在于 `plan-matrix.js` 定义与 `plan-matrix.test.js` 断言，**无任何消费方** ⇒ 免费版与标准版在本页所见完全一致。
3. 免费版真实约束（5 平台 / 每日 5 条 / AI 写作 200 次月 / 视频 0 / 无定时批量 / 并发 1）全部发生在发布页、AI 写作、视频创作，不在本页。

**本次未改该文案**——把它改成指向具体受限项属产品文案决策，需用户拍板。已作为待决事项回给用户。

## 证据

| 项 | 值 |
| --- | --- |
| 受影响测试 | TrialBanner 6 + more-tests 30 + Dashboard.style-guard 10 + Dashboard 18 + Home 28 = **92 passed / 0 failed** |
| 新增回归锁 | `Dashboard.style-guard.test.js`「TrialBanner 必须位于 .cohere-content 内部」 |
| 变异反证 | **已做**：把横幅移回 `.cohere-content` 外 ⇒ 该锁精确变红 `expected 450 to be greater than 572`；还原后 10 passed。未做变异的守卫等于没守卫 |
| 依赖解析门禁 | `verify-worktree-deps.js` OK（11 项消费方解析通过） |
| 构建 | `pnpm run build` exit 0（vite 59.05s + electron-builder nsis 打包成功） |
| 一致性 | `check-frontend-consistency.js` PASS（windowConfirm 0 / rendererIpcDirect 0 / appleAlias 0） |
| QM-1 打包 | 本次改动不触 `apps/desktop/electron/**`，QM-1「改 electron 主进程必打包」不适用；但已跑完整 `pnpm run build`（含 electron-builder），不以此为 QM-1 证据 |

## 为什么锁写在模板层而不是挂载层

本缺陷**无法**被挂载断言发现：vitest 不注入 CSS，`getComputedStyle` 拿不到 `.cohere-content` 的 padding，横幅在 DOM 里存在且可查——`Dashboard.test.js` 的 "shows TrialBanner component" 在缺陷态下照样通过（已实测）。唯一可机械判定的面是模板结构，故用 `@vue/compiler-sfc` 解析后按 div 深度计数定位 `.cohere-content` 的闭合位置，断言 `<TrialBanner>` 落在其区间内（同时防「同层后置」这一更隐蔽的形态）。

## 远程同步

| 远程同步 | PENDING |
