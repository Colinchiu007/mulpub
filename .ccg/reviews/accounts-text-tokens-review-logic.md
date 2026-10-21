# 逻辑/正确性评审

> ⛔ 路径已做占位符替换（Gate 12c：受管文档不得出现本机绝对路径）：原文件里的「盘符 + 仓库父目录 + mp-worktrees/<工作区名>」前缀统一写成 <工作区根>，指向共享主工作区那一份的前缀写成 <共享主工作区>。**评审结论、严重度、行号与措辞一律未改**；替换只发生在路径前缀，可逐字对照驱动日志。

已读到 effectiveBg（color-token-reader.js:172）、scanStyleRules（color-token-reader.js:111）、compliant-bare/needs-design（Accounts.text-contrast.test.js:102/127）。不写 NO_READ。

## Findings

- Critical - <工作区根>/apps/desktop/src/views/Accounts.vue:1355（配合 color-token-reader.js:172）- `.batch-status` 换成 `var(--color-primary)` 后暗色白底上的主操作文字从 6.18:1 跌到 3.04:1，判据却按 5.45:1 放行。证据：tokens.css:338 把暗色 primary 提亮成 `#8b85ff`，而该行背景仍是 `#fff !important`；effectiveBg 对带 `!important` 的 background 解析出 null 后回落暗色 inset `#1e1e23`，test.js:49-56 据此算出 5.45。
- Warning - <工作区根>/apps/desktop/src/views/Accounts.vue:1363（配合 :1359）- `.login-state span` 换成 `--color-text-secondary` 后，在父容器真实底色 `#f3f2ff` 上只有 4.39:1，判据因 span 自身无 background 而回落页面 inset `#faf6f8`，算出 4.54:1 静默通过。证据：`.login-state` 在 1359 行声明 `background: #f3f2ff`，span 继承它；基线没有登记这一条。
- Warning - <工作区根>/apps/desktop/src/styles/color-token-reader.js:160 - 大文本分档把任意 ≥18.66px 的普通字重都当 3:1，比 WCAG 的「24px 常规或 18.66px 加粗」更松。证据：当前 worktree 里唯一 20px 的是 `.accounts-header .page-title`（Accounts.vue:1289，700 加粗，走另一分支），所以还没有现缺陷，但未来 20px 常规正文会被误判成可豁免。
- Warning - <工作区根>/apps/desktop/src/views/Accounts.text-contrast.test.js:60（配合 color-token-reader.js:114）- 整体读空会红（style 块数断言在 :65、token 字面值断言在 :71-74），但部分漏读仍可静默：`textSites` 下界 30 低于当前 41，扁平 `[^{}]*` 扫描不建模嵌套 at-rule，当前 @media 里没有 color 所以尚未触发。
- Info - <工作区根>/apps/desktop/src/styles/color-token-reader.js:157 - font-size 经 var() 解析不出时 `needFor` 落到 4.5:1，方向是偏严，不构成把真缺陷读成合规的口子；真正松口是上一条的阈值本身。
- Info - <工作区根>/apps/desktop/src/views/Accounts.text-contrast-baseline.json:56（配合 tokens.css:396）- 基线把 `.account-toolbar-selects select` 记成暗色 needs-design（2.48:1），但 tokens.css 的 `html[data-theme='dark']` 覆盖已把它的暗色底色/文字换成 token；判据只读根块、不读这些覆盖，会保留一笔实际已不存在的欠账。

## 四问结论

Q1：不会因文件读空/空集合而恒绿，这些路径有红锁；但存在「漏掉一两条规则仍高于下界」的静默窗口，见第 4 条。

Q2：解析失败落在 4.5 档（严格方向）；真正的松口在 18.66px 普通字重被当大文本，见第 3 条。

Q3：会算错的两类真实形状都在本 worktree：自带 `background` 带 `!important`（`.batch-status`，1355 行）和嵌套在硬编码底色容器里且自身无 background（`.login-state span`，1359/1363 行）；前者松、后者松。

Q4：浅色档计算值变化的点主要是 `#92939c/#85858f/#9697a0/#999ba6/#8e91a5/#9b9ca6/#8b92a7` 收成 `#707080`、`#1f2340/#28282f/#2b2b35` 收成 `#1e1b4b`、主操作紫收成 `var(--color-primary)`；语义会变的是 `.batch-status`（暗色主操作紫在固定白底上跌破 AA）和 `.login-state span`（紫灰变中性灰且在 `#f3f2ff` 上跌破 AA）。删除/警示色未被改：`.batch-delete`（1357）、`.page-button.danger`（1310）、`.floating-close-button`（1435）仍是裸 hex。
