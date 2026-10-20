---
record: ux-audit-nonbutton-keys
task: 采集页快捷卡片键盘可达（UX 审计 4.4 第二批）+ 存量「leaf 角色吃掉子树」清点
date: 2026-10-20
branch: ux-audit-nonbutton-keys
---

# 执行记录：Collection.vue 快捷卡片四件套与无障碍存量清点

## 0. 变更类型与隔离

运行时代码变更（渲染层 `.vue` + 测试），独立 worktree `mp-ux-audit-nonbutton-keys` / 分支 `ux-audit-nonbutton-keys`，起点 = 当时 `origin/main`，经 PR 落地。未触 `apps/desktop/electron/` 与 `packages/rpa-engine/` ⇒ QM-1 打包 N/A；未触任何颜色/尺寸令牌 ⇒ 渲染像素不变。

## 1. 做了什么

`Collection.vue` 的 6 张 `.col-stat-card-click`（快捷采集组：`createDraft`、`importFromClipboard`；草稿箱组：`switchTab('drafts')`；来源入口组：`openCollection('weibo'|'baidu'|'toutiao')`）此前**只有 `@click`** —— 键盘用户完全无法触达，而视觉、鼠标、单测、构建都不报错。按 PRD §三 补四件套，两个 keydown 表达式与 `@click` 逐字一致。

## 2. 测试（TDD 顺序与反证）

- 新文件 `apps/desktop/src/views/Collection.keyboard-cards.test.js` 4 条：
  1. 结构锁：逐标签断言 `role="button"` / `tabindex="0"` / `@keydown.enter.prevent` 与 `@keydown.space.prevent` 的表达式 **等于** `@click` 表达式；并断言扫描域非空（`tags.length >= 6`）—— 取不到标签时判据必须红，不得"零个卡片 ⇒ 零个违规"。
  2. 后代禁令锁：**读 `c.element.innerHTML`**，断言子树无 `<button|a|input|select|textarea>` 且无 `tabindex`（排除 `-1`）。
  3. 行为锁：`data-testid="quick-drafts-box"` 卡片，Enter 与 Space **各自**断 `router.push('/publish?tab=drafts')`。
  4. 负控锁：一个只有 `@click` 的 div，`trigger('keydown.enter')` / `keydown.space` **必须不产生调用**，`click` 必须产生 —— 没有这条，第 3 条会退化成"测 mount 副作用"。
- **首跑即暴露探针自身错误**：第 2 条第一版用 `wrapper.html()`，它含卡片**自己**的 `tabindex="0"` ⇒ 把本次要求的正确修法判成缺陷（`Test Files 1 failed`，红在 `expect(inner).not.toMatch(/tabindex="(?!-1)/)` 那一行）。改成 `innerHTML` 后 4 passed。**这是"锚点/探针错会被读成产品缺陷"的一次现场**，不是实现问题。
- 反证（按 §三 要求"把被撤销的错误形态原样重造一遍"，不是摘判据）：把 `quick-drafts-box` 那张卡片退回**未补全形态**再跑 ⇒ `RED_COUNT=2`，指名「每个可点卡片都是四件套…」与「Enter 与 Space 各自都触发…」，`SUMMARY=2 failed | 2 passed (4)`；还原后 `byteEqual=true`。
- 消费者并集：`Collection.test.js` / `Collection.viral-contract.test.js` / `Collection.rewrite-input-limit.test.js` + 新文件 ⇒ `Test Files 4 passed`。

## 3. 顺带清点出的存量违规（不在本批修，属交互设计裁决）

一次性静态清点（`role="button"` 开标签 → 同名标签深度计数 → 子树查可聚焦标签）：

| 读数 | 值 |
|---|---|
| 扫描域 | `apps/desktop/src` 下 `.vue` **182** 个 |
| `role="button"` 出现处 | **17** 处 |
| 子树含可聚焦后代 | **3** 处 |

三处逐个读到源码确认为真（不是深度计数假阳）：

1. `features/accounts/components/AccountManagementCard.vue` —— 批量模式 `<input type="checkbox">`（带 `@change="$emit('toggle-select')"` 与外层 `@click.stop`）。取 `role=button` 后该复选框在无障碍树上不可见 ⇒ 「批量选择」对键盘/读屏用户等于不存在。
2. `views/CopyLibraryView.vue` —— 卡片内播客单集入口 `<button data-testid="podcast-script-entry-*">`（`v-if=canShowEpisodeEntry(entry)`，video 档且有频道时出现）。
3. `views/Collection.vue:313` 记录卡片 —— 标签编辑区内的 `<button>`。

**为什么不顺手改**：两条正解都有代价 —— ① 撤销 `role`/`tabindex` 会把卡片重新变成键盘不可达（与本批方向相反）；② 把主行动改成卡内真按钮（标题即按钮）会改信息层级与点击热区。这属产品/设计裁决，按本仓口径**上报不代拍**。清点脚本是一次性取证（未接 CI），要把「leaf 角色不得有可聚焦后代」做成常驻门禁亦属新增门禁，需人工批准。

## 4. 门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| TDD 红→绿 | PASS | 探针自身错误先红一次（`wrapper.html()` vs `innerHTML`），修正后 4 passed |
| 反证 | PASS | 重造未补全形态 ⇒ 指名红 2 条；`RESTORE byteEqual=true` |
| 负控 | PASS | 只有 `@click` 的 div：Enter/Space 零调用、click 一次调用 |
| 消费者并集 | PASS | 同目录 Collection 族 4 文件 4 passed |
| QM-4 视觉 | 由 CI 代跑 | 未改任何颜色/尺寸/字号；`role`/`tabindex` 不入绘制流。像素判据以 `QG Visual` 现场为准，本机未据此自称通过 |
| QM-1 | N/A | 未触 electron 主进程 / rpa-engine |
| CJK / 品牌 / 绝对路径 / 行尾 | 见 PR 当场读数 | 新增诊断与文案不入生产源码（测试文件不受 CJK 门禁统计） |
| 旧载体冻结 | PASS | 只写本篇 `openspec/records/` |
| 远程同步 | 由门禁推导 | 不写状态词、不做回填提交 |

## 5. QM-6

本批变更 6 行模板 + 1 个测试文件 + 文档，判级由 `ccg-review-decider.js` 落产物；若判 `dual` 而落到非闭环态，按本仓既有口径转人工、不手写 status。
