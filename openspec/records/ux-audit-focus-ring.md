---
record: ux-audit-focus-ring
task: 阶段 3.6 子集——为两族按钮建立即时、双档、可证的键盘焦点环（WCAG 2.4.7）
date: 2026-10-19
---

## 本次执行记录：按钮键盘焦点环（ux-audit-focus-ring，2026-10-19）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/**`）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-focus-ring`、裸分支 `ux-audit-focus-ring`；`rev-parse --abbrev-ref HEAD` 实测 `ux-audit-focus-ring`，`merge-base --is-ancestor origin/main HEAD` 通过（基线 `d6708b717`）。取证按分支名与本 PR 号，不写本机绝对路径（Gate 12c；本片第一版写了盘符路径被当场判红，已按门禁给出的正解改回占位符形态） |
| 第一性原因（QM-5 ①） | ✅ | 两族按钮基类**从未有过任何 `:focus-visible` 规则**（实测 `git grep` 于 `origin/main`：`.ui-btn:focus-visible` / `.cohere-btn*:focus-visible` 命中 0；只有 `s2v-btn-*` 一族在 `video-creation-buttons.css` 有 4 条）。设计系统里同时存在 `--focus-blue` 两档声明却**零消费者**（死槽），即"以为有焦点色"与"实际没有任何焦点指示"并存 |
| 逃逸分析（QM-5 ②） | ✅ | ①**像素门禁结构性失明**：基线截图采集时没有任何元素处于焦点态，焦点环不出现在判定域内（同族已知盲区：hover/disabled/active）；②**单测层**：`src/styles/` 下此前只有 token 槽位/别名锁，没有任何锁问过"这个 token 有没有人消费""按钮有没有焦点环"；③**审查层**：审计报告把这条记在 3.6「控件体系收敛」的子项里，而 3.6 的主体是 571 处 `<button>` 迁移，子项因此长期随主体一起被搁置 |
| 系统性漏洞（QM-5 ③） | ✅ | 测试场景缺失 + 装饰性真源：`--focus-blue` 是一个"声明了就被认为存在"的死槽；缺少"设计令牌必须有消费者"的机械判据（该条已登记为实施方案阶段 5.5 的候选，本批不擅自扩面） |
| 修复 + 回归保护（QM-5 ④） | ✅ | `tokens.css` 新增 `--color-focus-ring` 浅/暗两档各一份；`cohere-design-system.css` 删除两档死别名并新增 group selector（基类 + 全部 6 个变体 + `cohere-btn-text` / `cohere-btn-text--danger`）；`UiButton.vue` 新增 `.ui-btn:focus-visible`。回归锁 `apps/desktop/src/styles/focus-ring.test.js`（12 例，已随 vitest 既有 `src/**/*.test.js` 域被收集，`vitest run src/styles` 现场 7 files / 55 passed） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**域由模板清点得出**：判据不是硬编码变体清单，而是扫全部 `.vue` 的 `<template>` 段、按「类挂在 `button`/`a`/`role=button` 上」取证，逐个回查焦点环选择器——新增变体未登记当场红；②规模下界（`vue>100`、`classAttrs>=100`、`变体>=3`）防"解析器退化成空集合 ⇒ 零问题"；③反向锁禁止任何按钮规则出现 `outline: none`；④棘轮禁止 `--focus-blue` 复活；⑤learnings 沉淀"只写基类的零覆盖修复"与"transition:all 把 outline 纳入淡入"两条 |
| 行尾与 diff 对账 | ✅ | 三个目标文件均为纯 CRLF（当场实测 `crlf=387/1711/103`、`bareLF=0`），补丁走「`split('\n')` + 断言锚点命中恰 1 + `splice` + 逐行保留 `\r` + 可逆性断言」；提交前 `git diff --numstat` 与 `git diff -w --numstat` 逐字一致（`6/0`、`17/2`、`12/0` 口径），删除数只来自那两行死别名 |
| 真浏览器取证（样式类判据的现场） | ✅ | 本机 Chromium（`ms-playwright/chromium-1228`）加载**真实** `tokens.css` + `cohere-design-system.css` + `UiButton.vue` 的 `<style scoped>` 原文，用键盘 `Tab` 进入焦点态（确保 `:focus-visible` 真实成立），逐元素读 `getComputedStyle` 的 `outline-width/style/color/outline-offset`：**8 个类 × 浅暗两档 = 16 项在 t=0 与 t=450ms 两个时刻全部 OK**（浅档 `2px solid rgb(96,58,249) off=2px`，暗档 `rgb(123,116,255)`）；令牌解析值同时打印 |
| QM-1 打包 / QM-4 视觉 | N/A / 已如实说明 | QM-1：未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/`，无主进程/打包面变更。QM-4：焦点环**不落在像素基线的判定域内**（采集时无焦点态），因此像素门禁通过与否都不构成本片的视觉证据——真实视觉证据是上一行的 computedStyle；未新增 locale 键，无文案显示项变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未探测到 `codeagent-wrapper` 可用通道（`~/.claude/.ccg/config.toml` 的 `[routing]` 未在本会话验证）；**如实记为未执行，不以自审冒充通过**。本批变更集小（3 文件 + 1 测试），风险面集中在"判据域是否真的覆盖消费者"，已由模板清点 + 真浏览器双时刻取证覆盖 |
| 远程同步 | 由门禁推导 | 不回填：本 PR 合并即由 `scripts/lib/merge-ledger.js` 按主干历史推导收口 |

- 保留门禁：判定 docs-only=false（含 `apps/desktop/src/**` 运行时代码）| 行尾对账 ✅ | 品牌残留 随 CI（本批文案无竞品名）| 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按 2026-10-15「旧载体冻结」政策**零改写**）| 远程同步 由门禁推导，不回填

### 一、这条缺陷的用户可见形态

键盘用户（或只用键盘的辅助技术用户）在界面里 Tab 移动焦点时，**主操作按钮不显示任何焦点指示**：

- `.ui-btn` 族（`<UiButton>`，实测 src 内 165 处用法）：无任何 `:focus` / `:focus-visible` 声明；
- `.cohere-btn-*` 族（实测模板内 134 处 class 属性命中，分布在 5 个类名上）：同样无声明；
- 两族的基规则里 `.cohere-btn-primary/-outline/-coral`、`.ui-btn` 带 `transition: all` —— 即便补上 `outline`，`all` 会把 `outline-*` 一并纳入过渡，焦点环会**淡入 150–250ms**。第一次真浏览器读数正是这样暴露的：4 个带 `transition: all` 的变体在 Tab 后 0ms 读到的是过渡起点（`3px solid currentColor / offset 0`），而不带 `all` 的变体立刻正确。**"看起来加了规则"和"焦点那一刻看得见"是两件事。**

### 二、显示项与提示文字

本批**不新增任何用户可见文案**，无 locale 键变更（Gate 7 不适用；未渲染中文literal）。显示项的变化只有一处、且是即时可感的：

| 位置 | 变化前 | 变化后 |
|------|--------|--------|
| 任意 `<UiButton>` / `class="cohere-btn-*"` 按钮获得键盘焦点 | 无描边（焦点位置不可见） | 2px 实线描边 + 2px 外偏距；浅档 `#603af9`，暗档 `#7b74ff` |
| 鼠标点击同一按钮 | 无描边 | **仍然无描边**（`:focus-visible` 的语义就是只在键盘等"需要指示"的模态下绘制） |

### 三、数据校验与边界（判据取值口径）

| 判据 | 口径 | 实测读数 |
|------|------|----------|
| 焦点环颜色 | 只允许 `var(--color-focus-ring)`，禁止 hex 字面量 | 浅档解析 `#603af9`、暗档 `#7b74ff`（computedStyle 直接读出） |
| 描边宽度 | `outline-width >= 2px`（WCAG 2.4.11 非文本对比 + 可感知厚度） | 16/16 项 = 2px |
| 外偏距 | `outline-offset >= 2px`（避免与按钮自身 1px 边框糊在一起） | 16/16 项 = 2px |
| 非文本对比度 | 焦点环 vs 画布/卡片背景 `>= 3:1`（WCAG 1.4.11） | light/canvas 6.05、light/card 6.05、dark/canvas 4.78、dark/card 4.30 |
| 即时性 | t=0 与 t=450ms 读数必须**相同且都达标** | 16/16 两时刻一致 |
| 覆盖域 | 模板中挂在 `button`/`a`/`role=button` 上的 `(cohere\|ui)-btn*` 类逐个回查 | 5 个类名 / 134 处，缺项清单必须为 `[]` |
| 反噬检查 | 任何按钮规则不得出现 `outline: none`（非焦点态） | 违规清单必须为 `[]` |
| 死槽棘轮 | `--focus-blue` 的**声明**数必须为 0（注释里叙述收敛过程不算） | cohere=0、tokens=0 |

边界与踩过的两处判据自身错误（都是"探针坏"而不是"数据坏"）：

1. 按**类名前缀**判"是不是按钮"会把 `<span class="ui-btn-spinner" aria-hidden>` 算进来（它不可聚焦，要求它画焦点环是错的）；改为按**挂载元素**判，同时把 `<div class="cohere-btn-*" @click>` 明确排除——那属阶段 4.4（非 button 点击元素），不在本判据域内。
2. `死槽不得复活` 第一版写成 `expect(text).not.toContain('--focus-blue')`，于是**解释这次收敛的那段注释**自己被判红。改为只匹配 `^--focus-blue\s*:` 的声明行。同类形态在本仓已出现过（禁令文案里引用被禁写法）。

### 四、交互与不变量（锁的位置）

| 不变量 | 锁 |
|--------|----|
| 每个真实按钮类都有焦点环 | `focus-ring.test.js` > 「模板里实际使用的每一个按钮类都必须有 :focus-visible 规则」 |
| 焦点环颜色只有一个真源，两档都在 | 同上 > 「浅色与暗色两个块内各声明恰一次」「暗色档不得省略」 |
| 焦点环即时可见 | 同上 > 「焦点环不得被 outline 过渡淡入」+ 真浏览器 t=0 读数 |
| 焦点环真的画得出来（对比度） | 同上 > 「对两档画布的非文本对比度都 ≥3:1」 |
| `<UiButton>` 族不因"模板扫不到"而隐形 | 同上 > 「UiButton 族由组件基类规则承担覆盖」「classes 首位恒含 ui-btn」 |
| 新增按钮变体不得悄悄漏环 | 域由模板清点得出 + 规模下界（扫描退化即抛错，不放行） |

### 五、变异反证（全部实跑，红项指名）

控制趟：`Tests 12 passed (12)`、rc=0、`failed=0`（不健康时驱动拒绝出结论）。驱动 `RESTORED_OK=true`（三个文件逐字节回读等于备份）。

| 变异 | 结果 | 变红的具体用例 |
|------|------|----------------|
| M1 摘掉 `.cohere-btn-text:focus-visible`（AutomationView 真实按钮） | CAUGHT | 模板清点判据（1 failed） |
| M2 退回"只写基类"这一零覆盖形态 | CAUGHT (3) | 模板清点 + 口径唯一 + 过渡淡入（额外两项同源，符合预期） |
| M3 焦点色改回硬编码 `#603af9` | CAUGHT | 口径唯一（含无 hex 断言） |
| M4 删掉暗色档 `--color-focus-ring` | CAUGHT (2) | 两档恰一次 + 暗色档不得省略 |
| M5 给 `.cohere-btn-primary` 加 `outline: none` | CAUGHT | 反噬检查 |
| M6 `UiButton` 的 classes 首位改成 `mp-btn` | CAUGHT | classes 恒含基类 |
| M7 恢复 outline 被 `transition: all` 淡入 | CAUGHT | 过渡淡入判据 |

驱动自身被纠正的两处（否则上面 7 条会全是"红但不知红在哪"）：`(\d+) passed` 先命中 `Test Files 1 passed` 把 12 个测试读成 1；失败名匹配用 `✕`(U+2715) 而 vitest 打 `×`(U+00D7)，且摘要行的标签与数字之间夹 ANSI 码。

### 六、落盘过程中的两次自伤（都当场被抓，未留损）

1. **追加脚本用"最后一行"探测行尾，取到的是空串**：`split('\n')` 在一个以换行结尾的文件里，最后一个元素恒为 `''`，`''.endsWith('\r')` 为 `false` ⇒ 我追加的 51 行全部写成 LF，而 `01-docs/UX-AUDIT-2026-10-17.md` 是纯 CRLF。**git 侧完全看不出来**（`* text=auto` 在 add 时统一归一成 LF，`git diff --numstat` 与 `-w` 两口径当时都是 `52/1`），只有单独数一次 `bareLF` 才显形。修法：追加段一律**从被追加上文的首行**取 EOL（这里锚点必然带 `\r`），并把 `bareLF=0` 写进入库前断言。
2. **"统一修 EOL"的第二刀吃掉了文件尾换行**：定点补 `\r` 时把范围开到包含末尾那个代表"文件以换行结束"的空元素 ⇒ 文件以裸 `\r` 结尾、无尾换行，`git ls-files --eol` 随即报 `w/-text`，`git diff --numstat` 瞬间变成 **914/862（整文件）**。抓它的仍是本仓那条固定判据：**strict 与 `-w` 两口径必须相等**；补回尾 `\r\n` 后 `w/crlf` 与 `53/1` 同时回来。口径：**任何"补行尾"的循环都必须跳过 `lines.length-1` 那个空元素，并断言最后一个字节是 `\n`。**

### 七、未随本批做的事（如实划界）

- 3.6 的主体（571 处 `<button>` 迁 `UiButton`、`ui-btn`/`cohere-btn` 双轨合一）**不在本批**；本批只把"键盘焦点看不见"这条可访问性缺陷单独收口，因为它与迁移无关且现在就在伤用户。
- `<div @click>` 类非按钮可点击元素（4.4，49 处）本批**刻意不纳入判据域**，否则会把"该改语义"的问题悄悄读成"缺焦点环"。
- 裸 `<button>`（无设计系统类名，实测 src 内 560 处）仍由 UA 默认焦点环服务；本批未发现有全局 `outline: none` 复位把它们抹掉（`tokens.css` 无 `outline` 声明，`src/**/*.vue` 的 37 处 `outline: none` 全部落在输入框/文本域上，且这些控件带 `:focus` 边框色变化）。
- 实施方案 PRD（`01-docs/PRD-UX-AUDIT-IMPLEMENT-2026-10-18.md`）目前只在 `ux-audit-impl` 分支上（PR #3898 未合并），本批**不另建副本**；3.6 子集的这条口径先写在本记录与审计报告的新增小节里，待 #3898 合并后由后续会话把「焦点环判据 + 域口径」并入其阶段 3.6 段。
