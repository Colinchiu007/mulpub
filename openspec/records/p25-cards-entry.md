---
record: p25-cards-entry
task: P2-1 × P2-3 缝合点 —— measureTextWithDom（正文高度真实测量）
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：P2-1 × P2-3 缝合（p25-cards-entry，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见 CI
  —— 含 `apps/desktop/electron/` ⇒ **混合 PR**，走完整质量节拍（含 QM-1）。

## 变更内容

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `apps/desktop/electron/services/card-capture.js` | 改 | 新增 `measureTextWithDom` + `buildMeasureFragment` + `assertMeasuredHeight` + `closeMeasurementWindow` |
| `apps/desktop/electron/services/card-capture-measure.test.js` | 新增 | 10 条合同测试（纯函数层）|

## 为什么需要这个缝合点

P2-1 分页器的契约是 `measure: (text, item) => Promise<number>`
（见 `card-paginator-core.js` 的 JSDoc，逐字读过），而 P2-3 的
`buildMeasurementScript()` 已经建好了「参与布局的离屏容器」——
但两者**没有任何调用方**（第 103 轮侦察：渲染端 import 分页器 **零命中**）。

`measureTextWithDom` 就是那个 `measure`。

## ★ 为什么不能用估算公式代替

分页要按**换行后**的高度切，而换行位置取决于：
字宽（中英日混排、全角/半角、标点悬挂）、段前/段后距、行高、模板 CSS。

任何「字符数 × 每字像素」的公式都会在这几项上漂移，后果是
**一页放不下**（用户看到内容被截断）或**一页只放半页**（排版难看）。

## 三条不可破的实现约束（各有反例）

| # | 约束 | 反例后果 |
| --- | --- | --- |
| ① | 容器用 `position:absolute; left:-10000px`，**不是** `display:none` | `display:none` 不参与布局 ⇒ 高度**恒为 0** ⇒ 分页把全文塞进一页 |
| ② | 拿不到高度**必须抛错**，绝不返回 0 | 返回 0 等于告诉分页器「这段不占高度」⇒ 无数段塞进一页 |
| ③ | 正文里的 `<` `>` `&` **必须转义** | 未转义会被当标签：既改变量到的高度，也可能注入样式（`#include <stdio.h>` 是真实技术正文）|

## ★ 一次分层决策（可测性驱动）

首版把「转义 + margin-top 语义 + 高度校验」全部内联在 `measureTextWithDom` 里，
于是测试必须 mock `BrowserWindow` —— 试了 4 轮都因
`BrowserWindow is not a constructor` 失败（`card-capture.js` 顶层解构 + 本仓
`test-setup.js` 的全局 electron mock 互相干扰）。

**改为把不依赖 Electron 的决策抽成纯函数**（`buildMeasureFragment` /
`assertMeasuredHeight`），一次全绿；真实窗口交互留给 QM-1 集成测试。

**⇒ 与同目录 `card-capture.test.js` 的分层纪律一致**：
> 本文件只测纯函数（判据①②③）。判据④⑤（渲染不溢出 / 性能）需要真实 offscreen 窗口，
> 本套件在无 GUI 的 runner 里跑，故不在本文件里写假绿。

**★ 一般化**：当一个函数难以测试时，先问「能不能把其中的**决策**抽出来」，
而不是硬 mock 宿主环境。

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| vitest（两个 card-capture 套件）| PASS | **20 passed / 2 skipped**（2 skipped = P2-3 判据④⑤真机项，不写假绿）|
| Gate 11 ESLint | PASS | exit=0 |
| 未接线测试 | PASS | `check-unwired-tests.js` exit=0（85 个域内测试文件）|
| QM-1 打包 | PASS | `electron-builder --win --dir --publish never` exit=0，5.78 分钟，asar **139.9 MB**；`measureTextWithDom` / `buildMeasureFragment` / `assertMeasuredHeight` / `closeMeasurementWindow` **四个新函数均在 asar 内**（按字节检索取证）|
| 行尾对账 | PASS | 两口径一致 |
| 远程同步 | PENDING | 本 PR 未合并 |

- 保留门禁：vitest ✅ | Gate 11 ✅ | 未接线测试 ✅ | QM-1 ✅ | 行尾对账 ✅ | 远程同步 PENDING

## 未含（下一步）

- 把 `measureTextWithDom` 接进 `useCardsPipeline`（渲染端拿不到 Electron 主进程对象，
  需经 IPC 暴露一个 `render:measure` 通道）
- QM-1 判据④⑤真机验证
