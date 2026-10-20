---
record: ux-audit-history-list-perf
task: 历史列表行内函数缓存（UX 审计 2.2②），并否证同批两条建议
date: 2026-10-20
branch: ux-audit-history-list-perf
---

# 执行记录：PublishHistory 行视图缓存

## 0. 变更类型与隔离

渲染层 `apps/desktop/src/views/PublishHistory.vue` + 新测试 + 文档。独立 worktree `mp-ux-audit-history-list-perf`（起点 = 当时 `origin/main`），经 PR 落地。未触 electron ⇒ QM-1 N/A；未触颜色/尺寸/文案 ⇒ 渲染像素与文案不变（像素判据仍以 CI `QG Visual` 现场为准）。

## 1. 做了什么

按审计 2.2② 把模板内逐行昂贵调用收敛为「一次渲染一份」的行视图缓存：`buildRowView` 单一实现 → `rowViews` computed（遍历 `filteredRecords`）→ `rowView(record)` 访问器（未命中即现算，绝不返回空对象）。转换由一次性脚本完成，替换前先打印每个模式的命中数（1/2/2/2/1/1/1/1），替换后再扫一遍确认模板区内 record 作用域的裸调用归零。

## 2. 三条刻意的设计决定（都可核对）

1. **缓存作用域 = 一次渲染**：`platformName` / `platformIcon` 依赖异步加载的 platform store；跨渲染常驻 Map 会把默认标签永久钉住。⇒ 锁 ① 直接禁止旁边出现 `...Cache = new Map()`。
2. **`metricValue` 不入缓存**：入参是任意数字 ⇒ 键域无上界，长会话无界增长（与 toast 去重集合同型）。⇒ 锁 ④。
3. **键用记录对象不用 `record.id`**：id 缺失/重复时按 id 建 Map 会让两行互相覆盖，症状是"某行凭空变空"且零报错（AGENTS「外部键与身份键必须有一条两实体两键的锁」的同型风险，这里直接绕开）。

## 3. 与审计原文的两处分歧（上报，不照抄）

- **2.2①「`filteredRecords` 改读防抖值」被否证为契约冲突**：照做后 `PublishHistory.test.js` 当场 84 条变红；那 84 条编码的是"筛选结果与输入即时一致"这一既有产品契约，组件内同族注释也写明"输入框绑原始值，只有昂贵的**加载**动作走防抖"。⇒ 已 `git checkout HEAD -- <精确单文件>` 还原（还原后同一条命令 1 passed），把"是否接受筛选滞后一个防抖窗口"退回人工裁决。
- **2.2③「加 renderLimit」实测已完成**：该视图走服务端分页（`historyList({limit, offset})`）并有 `data-testid="load-more-history"` 的「加载更多」；再补一层 slice 只会让用户少看到行。

## 4. 门禁读数

| 门禁 | 状态 | 证据 |
|---|---|---|
| 行为等价 | PASS | 既有 `PublishHistory.test.js` 一字未改全绿（该视图全量渲染用例） |
| 新增锁 | PASS | `PublishHistory.row-view.test.js` 4 passed；两文件同跑 `Test Files 2 passed` |
| 反证 | PASS | ① 模板回退裸调用 ⇒ 红在「模板内不得再出现裸昂贵调用」；② 缓存旁加常驻 Map ⇒ 红在「缓存必须是 computed」；`RESTORE byteEqual=true` |
| 探针自纠 | 已记 | `metricValue` 那条锁第一版用 `function buildRowView[\s\S]*?metricValue` 判"函数体内没有"，实际会一路吞到文件后面任意一处 `metricValue` ⇒ 首跑就假红。改为**先取函数体**再判，并补一条"它确实还在模板里被调用"的正向对偶 |
| TDD 顺序 | 说明 | 本次为**纯内部重构**，红-绿证据取"被禁形态重造必须红"（上一条），而非"新锁先红后绿" |
| CJK / 品牌 / 绝对路径 / max-lines | PASS | 见 PR 当场读数 |
| 行尾两口径对账 | PASS | `--numstat` 与 `--ignore-cr-at-eol --numstat` 一致 |
| 旧载体冻结 | PASS | 只写本篇 |
| 远程同步 | 由门禁推导 | 不写状态词、不做回填提交 |
| QM-6 | 见 PR | 判级由 `ccg-review-decider.js` 自己落；非 `dual` 无欠账，若 `dual` 未闭合则合并交回人工 |
