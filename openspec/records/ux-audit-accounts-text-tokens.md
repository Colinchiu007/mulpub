---
record: ux-audit-accounts-text-tokens
task: UX 审计 4.2 首批 —— Accounts.vue 裸 hex 文字色收编进主题令牌，并建立一份可复算的两档对比度判据
date: 2026-10-20
---

## 本次执行记录：账号页文字色令牌收编（ux-audit-accounts-text-tokens，2026-10-20）【混合 PR】

| 门禁 | 状态 | Fresh 证据（当场读数，非估算） |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/**`）⇒ 在隔离 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-accounts-text-tokens` 的裸分支 `ux-audit-accounts-text-tokens` 上完成；共享根保持 main clean |
| 判定 docs-only | false | 改动含 `apps/desktop/src/views/Accounts.vue` 与三份新增 `.js` ⇒ 走完整节拍，不借 docs-only 通道 |
| TDD / 判据先行 | ✅ | 判据与机制先落地再收编颜色；`Accounts.text-contrast.test.js` 11 条 + `color-token-reader.test.js` 17 条 + `text-contrast-sites.test.js` 8 条 ⇒ 一条命令跑出 **36 passed**（逐文件计数取自 `--reporter=json` 的 `assertionResults`，非数源码里的 `it(`） |
| 消费者并集（AGENTS「改被多文件消费的模块，验证范围取消费者并集」） | ✅ | `git grep -l` 反查读 `Accounts.vue` / `tokens.css` / 新模块的测试文件后并集跑：**43 文件 685 passed / 2 skipped**（含 `accounts-compile` / `accounts-grid.source` / `accounts-truncation` / `Accounts.test.js` / `src/styles/*` / `src/features/accounts` / `icon-usage` / `href-scheme-contract` / `Dashboard.style-guard` / `features/collection`） |
| 变异反证（写回被禁形态本身，不是"摘掉判据"） | ✅ 14/14 CAUGHT | 驱动 `.agent_context/stage/at-mutate.mjs`，控制趟 `kind=GREEN 用例=36`，`RESTORED_ok=true`（逐字节 `Buffer.compare`）。逐条指名：M1 不剥注释 / M2 暗色根块写死 `html[data-theme=dark]` / M3 page-title 退回裸 hex / M4 阈值恒 1 / M5 只扫第一个 style 块 / M6 `resolveLength` 恒 null / M7 `contrast` 排序写反 / M8 槽位读退回行首锚定 / M9 不剥 `!important` / M10 把 `transparent` 当"读不出" / M11 祖先底色不看主题覆盖层 / M12 大文本档位读宽 / M13 把删除红换成能过 AA 的主色 / M14 基线与现场脱钩 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **逐文件相等**（PRD 49/0、UX-AUDIT 2/0、learnings 13/0、CHANGELOG 12/0、reader 132/11、reader 测试 92/2、基线 209/37、判据 84/80、Accounts.vue 25/25）⇒ 本次没有改写任何人的行尾 |
| QM-1 打包 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`；纯渲染层样式 + 测试 |
| QM-4 视觉 | ⚠ 待办（同 PR 内必须收口，见「遗留」第 1 条） | 本批**改变浅色档像素 22 处**（浅色不变 3 处），而 `/accounts` 有 4 张被跟踪基线（`accounts-list` / `-dark` / `-flag-on` / `-flag-on-dark`）。Gate 7b 的判据是"基线逐像素等于同一次 run 的 CI 渲染"⇒ 预期红；正解只有一条：**从 CI 产物取渲染**（`quality-gate-visual-reports` / `visual-test-reports` 的 `screenshots/<view>.png`）后同 PR 换基线并自证 0 px。**禁止** `--update-baseline` 用本机渲染消化（AGENTS 规则 7：本机与 CI 字体渲染不同源，实测差过 3.659%） |
| QM-5（本批属"缺陷修复"，五步产出物） | ✅ | ①第一性原因：`Accounts.vue` 的文字色写成裸 hex，主题覆盖只作用于 `--color-text-*` ⇒ 暗色档一条都不生效（引入点非单次提交，属该文件历史写法）；②逃逸分析：单测层无对比度判据（本批新增）；像素层对 <0.1% 的局部色变失明；审查层曾把"源码里出现 var()"当达标证据；③系统性漏洞：颜色真源分散（判据四处内联 + `src` 内 68 个文件仍有 417 处裸 hex `color:`）；④修复+回归保护：本文件即回归锁（判据按真实计算值，不用字符串形状）；⑤防再发：PRD 新增《文字色必须来自主题令牌》合同 + learnings 9 条 + 欠账基线只能缩小 |
| QM-6 CCG 双模型外部评审 | ✅ **两轴均获得结论**（通道与次数如实记录在下） | 判定 `node scripts/ccg-review-decider.js`（判暂存区）⇒ **mode=dual**，原文理由：`变更 879 行 > 200 行阈值`、`敏感命中 0 路径 + 7 内容`（那 7 处是 `--color-text-*` 变量名撞凭证正则的假阳性，**未据此改宽判据**）。通道：`~/.claude/.ccg/config.toml` 读回 `[routing.backend].primary=codex` / `[routing.frontend].primary=claude`，CC Switch `:15721` 当场 `net.connect` 实测 **open** ⇒ 按 AGENTS 原文走 `codeagent-wrapper`，未降级到替代通道。原件：`.ccg/reviews/accounts-text-tokens-review-logic.md`（codex，自己写的文件）与 `.ccg/reviews/accounts-text-tokens-review-maint.md`（claude，**未写文件**，正文由 `.agent_context/stage/at-copy-review.mjs` 从驱动 stdout 逐字复制） |
| 评审逐条处置 | ✅ 见下表 | 逻辑轴 Critical 1 / Warning 4 / Info 2；可维护性轴 IMPORTANT 2 / 中低 3。**每条都先做可达性核实再动代码**，处置与证据在下 |

### 关键实测数字

- `Accounts.vue` 的 `color` 声明 = **41** 处；其中裸 hex 25 处（本批前为 40 处，含祖先/覆盖后重算）。
- 裸 hex `color:` 由 **40 处 → 15 处**（收编 25 处）；登记 **15** 条（`needs-design` 3 + `compliant-bare` 12）。
- `surfaces`（本批未修的底色/边框/描边裸 hex）= **31** 处：background 16 / border 10 / border-color 4 / outline 3（含 `var(--x, #hex)` 回退被排除后的读数）。
- 浅色档像素：变化 **22** 处、不变 **3** 处（`at-lightdelta.mjs` 逐条比 HEAD 现值与令牌浅色解析值）。
- 全仓存量重测：`apps/desktop/src` 203 个 `.vue/.css` 文件里 **68** 个含裸 hex `color:`，共 **417** 处。审计原表的 579 是**另一个域**（含非 `color` 属性），两个数不得混用。
- `src/styles/` 内自带第二份对比度公式的测试 = **4** 份（`tokens.slots` / `tokens.aliases` / `sidebar.tokens` / `ep-theme.tokens`），加本批共 5 套并存 ⇒ 已钉成只能缩小的清单。

### QM-6 逐条处置（先核实可达性，再决定采纳/否证）

| 评审条目 | 核实动作与读数 | 处置 |
|---|---|---|
| 逻辑轴 **Critical**：`.batch-status` 的 `background: #fff !important` 被 `^#hex$` 判成"读不出"⇒ 判据回落页面底色算 5.45:1，真值 3.04:1 | 当场算 `contrast('#8b85ff','#ffffff')=3.04`、`('#5048e5','#ffffff')=6.18`；且现场该行确有 `!important` | **成立 ⇒ 已修**。机制加 `plainValue()` 先剥 `!important`；修完后该点浅色档本已过 AA ⇒ 按"只动确实坏掉的"规则**不再收编**，改记 `compliant-bare`（现场回到 `#5048e5` 原值）。反证 M9 |
| 逻辑轴 **Warning**：`.login-state span` 自身无底色，父 `.login-state` 写 `#f3f2ff` ⇒ 判据按页面 inset 算 4.54 放行，真值 4.39 | 算 `#707080 on #f3f2ff = 4.39`、`#6e69a0 on #f3f2ff = 4.52` | **成立 ⇒ 已修**。底色改为「自身 → 祖先前缀 → 页面」**候选集取最差**；修完后该点原值本就过 ⇒ 不收编、记 `compliant-bare`。反证 M10（另含 `transparent` 那一格） |
| 逻辑轴 **Warning**：大文本档位写成"任意 ≥18.66px"，比 WCAG（24px 常规 / 18.66px 加粗）松 | 核 WCAG 1.4.3 定义；现场唯一 20px 是 `.page-title`（700 字重）⇒ 本批尚无现缺陷 | **成立（档位读宽，判据侧缺陷）⇒ 已修**。`needFor` 改为 `size≥24 ∥ (size≥18.66 ∧ bold)`，并加一条"20px 常规必须按 4.5"的正控。反证 M12 |
| 逻辑轴 **Warning**：`textSites` 下界 30 低于现场 41；扁平扫描不建模嵌套 at-rule | 当场数 `@media` 块 = 3，其中带 `color` 的 = 0 ⇒ 今天不漏报；但结构上是洞（把已登记规则挪进 @media 会让它消失） | **部分成立 ⇒ 已修**。`parseRules` 改递归下降，嵌套规则的选择器带上祖先串；下界抬到 35 并另钉 style 块数=2。反证 M5 |
| 逻辑轴 **Info**：只读根块、不读 `html[data-theme='dark'] .sel {}` 具类覆盖 ⇒ 会**虚构欠账** | 现场 grep 到 `tokens.css` 确有 `html[data-theme='dark'] .account-toolbar-selects select { background: var(--color-bg-inset) … }`；`grep -c data-theme Accounts.vue = 0` | **成立 ⇒ 已修**。新增 `loadThemeOverrides` + 每主题祖先声明索引；修后 needs-design 从 8 降到 **3**（`.account-view-toggle button` 等从虚构欠账变回可收编）。反证 M11 |
| 逻辑轴 **Info#1**（原报 Critical 的"浅色档 pixel 不变性"论断）：说 ta-engine 式的双档探测对 spacing/radius 冗余 | 本批不适用（无该探测） | **不采纳为事实**：仅借其"措辞不得高于探测实际能力"的纪律，写进 CHANGELOG 的 22/3 读数声明 |
| 可维护性轴 **Q1/Q2**：新判据是"第五套对比度公式"的消费方，四份旧副本绝缘 | 逐文件 grep `function contrast\|0.2126`：`tokens.slots` 3、`tokens.aliases` 3、`sidebar.tokens` 3、`ep-theme.tokens` 4 命中；`git grep color-token-reader` 只有 reader 自测 + Accounts 判据 + 采集模块 | **成立但不收敛**（那属"改谁来守门"，须人工过目）⇒ 改为**只能缩小的清单棘轮**（3 条用例：清单每项必须仍自带公式、命中数 >0、既 import 共享实现又自带公式者红） |
| 可维护性轴 **Q2b（最高危单点）**：生成器与测试各写一遍判据，status 词汇会漂（`no-token-candidate` vs `compliant-bare`），重跑生成器会把基线覆盖成另一种形状 | 核实为真：作废前的 `at-check.mjs` 确实写旧词汇且不写 `surfaces` | **成立 ⇒ 已修**。生成/校验统一消费 `text-contrast-sites.js`；测试逐字段重算基线的 `need/ratio/surface`；旧脚本 `at-sweep.mjs`/`at-sweep2.mjs`/`at-check.mjs`/`at-analyze.mjs`/`at-patch.mjs` 全部改成**立即抛错的桩**（`.agent_context` 被 gitignore，R0 无合法删除路径 ⇒ 用响亮失败代替删除）。反证 M14 |
| 可维护性轴 **Q3**：把已登记规则挪进 `@media` 会静默消失 | 同逻辑轴 Warning#4 | **成立 ⇒ 已修**（递归下降 + 祖先串），M5 实测变红 |
| 可维护性轴 **Q4**：改名 `needs-design` 的 selector 会红还是放过 | 读判据两条：`fixed`（登记项现场必须仍不过）与 `stale`（现场已不在裸 hex 集合 ⇒ 红） | **它答"会红"，我方复核一致** ⇒ 无需改动；已在反证 M3/M13 里以"改现场值"的形态实测变红 |

### 一次我自己的错误（如实登记）

生成器前两版的"第 nth 处替换 / 倒序只改最后一处"都因 **src 边判边改** 而坐标漂移，后果不是崩溃而是**把能收编的点静默记成 needs-design**（现场读数曾虚高到 8 条）。正解是按身份（选择器 + 现值）定位，并在试跑后断言"改的确实是这一条"（`s2.selector === site.selector && s2.value === 'var(slot)'`）。这条已写进 `01-docs/learnings.md`。

### 遗留（不假装已闭合）

1. **视觉基线须在同 PR 内换成 CI 渲染**：本批改浅色档 22 处像素。若 PR 侧 Gate 7b 红，取该 run 的 `quality-gate-visual-reports/screenshots/accounts-list*.png` 换基线并自证 0 px；不得 `--update-baseline`。
2. **判据不覆盖 `rgb()/rgba()/hsl()` 与 CSS 变量色管理**：这类槽（如暗色档的 `--color-primary-light`）只登记不判定，需人工看。
3. **祖先底色按选择器前缀猜，不解析真实 DOM**：`.a .b` 认 `.a`，但嵌套在别的带色容器里仍会漏；`surfaces` 清单是这一类的现场账。
4. **其余 67 个文件的 417 处裸 hex `color:`** 未收编（审计 4.2 的后续批次）。
5. **对比度公式仍 5 套并存**（本批只钉棘轮，未收敛）。
6. 4 处「白字坐在不过 AA 的彩色面上」（`.page-button.danger` 3.76、`.floating-close-button` 4.21、`.batch-delete` 暗色 3.26、`.selected-count`/`.login-state-actions button` 族内无解）与「底色未随主题走」的 31 处 ⇒ **属设计裁决，已上报不代拍**（PRD《交互逻辑（批量收编时的禁止项）》）。
| 远程同步 | PENDING | 本 PR 尚未创建；合并后就地改写成 `PASS` + merge SHA（`git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 取证），并按 AGENTS「收口由 `scripts/lib/merge-ledger.js` 推导」——**不另开回填 PR** |

- 保留门禁：行尾对账 ✅ | 品牌残留 随 CI（本批未写竞品名）| 文档同步 随 CI doc-gate | 受管文档绝对路径 随 CI Gate 12c（本记录一律用 `<仓库父目录>` 占位）| 执行记录载体 ✅（`openspec/records/ux-audit-accounts-text-tokens.md`）| 远程同步 PENDING
