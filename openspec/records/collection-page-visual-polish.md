---
branch: collection-page-visual-polish
title: 采集页视觉精致化（视觉骨架与节奏，承接 #3864）
date: 2026-10-20
prd: 01-docs/PRD-COLLECTION-PAGE-VISUAL-POLISH-2026-10-20.md
change: openspec/changes/collection-page-visual-polish/
---

# 执行记录：采集页视觉精致化（collection-page-visual-polish）

| 远程同步 | 由门禁推导 |

## 0. 这轮与上一轮的边界

PR #3864（collection-page-ui-ue-refine）修的是**机制**：`is-primary` 等死类全仓零定义、
主次分级在视觉上不成立、六套按钮方言、35 处 hex、`CollectionDraftsPanel.vue` 被上游删除后
又复活。那些修复经变异反证有效，但用户复看截图后仍反馈"不够精致"——机制对，观感没动到。

本轮定位：**只动视觉骨架与节奏**，不重做机制。8 条根因全部以代码坐标取证（见 PRD §2）。

## 1. 根因与修法（对应 PRD §2 D1–D8）

| 项 | 根因（坐标） | 修法 |
|---|---|---|
| D1 | `.col-panel::before` 4px 橙红渐变 + `3s infinite` 扫光（`collection-page.css` 原 146-161；`--color-ribbon` = `#ea580c→#fb923c→#fdba74`，`tokens.css:186`） | 整块删除（含 `@keyframes col-panel-ribbon`），层次交给既有 `shadow-sm` |
| D2 | 两套间距体系并存：`--space-*`（2/6/8/12/16/24/32，非 4 倍数）vs `--spacing-*`（4 基数） | 采集域只走 `--spacing-*`，新增 `--col-card-gap: var(--spacing-3)` 单点 |
| D3 | `.cohere-card .card-platform` 有 size/weight/color，**无 line-height、无 clamp**（`cohere-design-system.css:723`） | 采集域覆盖：clamp 2 行 + `line-height:1.45` + `word-break` |
| D4 | `gap:14px` / `margin-top:2px`（`cohere-design-system.css:698/728`） | 采集域不引用非刻度值；A4 锁住 |
| D5 | `.col-card-actions .col-btn` = `min-height:28px` + 12px 字 | 提到 `--col-btn-h`(32px) + `--font-size-sm`(13px) |
| D7 | `.cohere-card` 全局 `cursor:pointer` 但卡片本体不绑定点击 | 采集域还原 `default`（子区域仍 pointer） |
| D8 | 「百度安全验证」「无标题·0字」与正常卡外观完全一致 | 抽 `collected-result-validity.js` + `col-result-card--invalid` + 提示行 |

D6（操作分级）经 PRD §4 决策记录评估后**不在本轮改结构**：备选 A（hover 显示）可发现性差、
备选 B（收进 `...` 菜单）增加高频操作成本。本轮只做尺寸与填充分级（D5），结构留给后续。

## 2. 为什么把判定抽成独立模块（本轮最重要的一处修正）

最初把 `isInvalidResult` 内联在 `CollectedResultsList.vue`，测试断言「函数名存在」。
变异反证 M8 当场证伪：把判定改成 `if (item) return false`（恒 false）后，**测试毫无反应**。

这是 #3864 已记录过的同型失守（dead-class 正则 `^` 陷阱 + 前缀表多余连字符）——
**判据断言的不是被测性质**。所以抽成 `collected-result-validity.js` 纯函数，
测试直接 import，用 9 个真实样本断言行为（含 `'0'` 字符串、`NaN`、`null` 边界）。

## 3. 变异反证（本轮唯一硬证据）

`mutate.cjs` 8 条变异，**8/8 被捕获**（RC=0）：

| 变异 | 结果 |
|---|---|
| M1 恢复饰带 + infinite 扫光 | ✅ 3 failed |
| M2 按钮高度退回 28px（限位到按钮块） | ✅ |
| M3 摘掉标题 clamp | ✅ |
| M4 摘掉标题 line-height | ✅ |
| M5 无效卡 class 改名 | ✅ |
| M6 摘掉 `:title` 全文绑定 | ✅ |
| M7 光标还原摘掉 | ✅ |
| M8 无效判定恒 false | ✅ |

脚本自身踩过四个坑（v1 stdout 正则误判、v2 想象匹配串、路径基准不一致、`replace` 只换第一处），
均已修正并写入 tasks.md「已知坑」。

## 4. 一个必须记录的假绿事件

改 `:title` 绑定时，`edit` 工具返回**成功**但文件里没有该绑定（历史 CRLF 类陷阱的又一形态）。
随后我看到的「371 passed」读数里混着这次未落地的失败——**读数不可信**。
对策：改完必须 `Select-String` 回读；重跑后落盘（`Tee-Object`）再统计。
修正后真实读数：**18 文件 / 380 例全绿**。

## 5. 验证清单

| 项 | 结果 |
|---|---|
| 测试 | 采集域 + 视觉契约 + 页面测试 18 文件 380 例全绿（含新增 27 例） |
| eslint | 0 error |
| max-lines | PASS（zh 496 / en 495，未越 500） |
| debt-budget | PASS（maxFileLines 5329≤5359、filesOver1000 29≤29、filesOver500 96... 修正后 ≤95） |
| brand-residue | PASS |
| doc-abs-paths | PASS |
| locale 三项 | keys / cjk / pair-base 全 PASS（1 个新增 key 成对） |
| 变异反证 | 8/8 捕获 |
| QM-4 视觉 | 待 CI 同源回填（本轮改观感，基线必变） |

## 6. 未闭合（不假装已闭合）

1. **QM-4 基线**：本轮必然改变渲染（删饰带 + clamp + 按钮尺寸），须按既有流程从 CI 产物回填。
2. **D6 操作分级结构**：评估后判定本轮不做，需单独 PRD。
3. **`.cohere-card` 的 `cursor:pointer` 是全局规则**，本轮只在采集域覆盖；其它视图（账号/发布等）
   是否同样存在「假可点」未审计——属独立任务。
4. **`--space-*` 旧刻度仍未退场**：本轮只保证采集域不引用；全局两套体系并存本身未消除。
