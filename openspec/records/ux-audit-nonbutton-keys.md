---
record: ux-audit-nonbutton-keys
task: 采集页快捷卡片键盘可达（UX 审计 4.4 第二批）+ 存量「leaf 角色吃掉子树」清点
date: 2026-10-20
branch: ux-audit-nonbutton-keys
---

# 执行记录：Collection.vue 快捷卡片四件套与无障碍存量清点

## 0. 变更类型与隔离

运行时代码变更（渲染层 `.vue` + 测试），独立 worktree `mp-ux-audit-nonbutton-keys` / 分支 `ux-audit-nonbutton-keys`，起点 = 当时 `origin/main`，经 PR 落地。未触 `apps/desktop/electron/` 与 `packages/rpa-engine/` ⇒ QM-1 打包 N/A。**QM-4 口径（评审 i1 后已变，不是"零视觉影响"）**：本批在 `collection-page-legacy.css` 加了一条 `.col-stat-card-click:focus-visible` 焦点环 ⇒ **有视觉变化，但只在键盘焦点态**；全页像素回归对焦点态结构性失明（基线截图不含焦点态、徽标占页面积 < 0.1%），所以既不能说"无视觉影响"，也不能靠像素门禁当证据 —— 环的存在性由 `src/focusable-ring-contract.test.js` 锁，环色由 `tokens.css` 的 `--color-focus-ring` 单一真源持有（浅/暗两档各有映射，故本批不写暗色覆盖）。

## 1. 做了什么

`Collection.vue` 的 6 张 `.col-stat-card-click`（快捷采集组：`createDraft`、`importFromClipboard`；草稿箱组：`switchTab('drafts')`；来源入口组：`openCollection('weibo'|'baidu'|'toutiao')`）此前**只有 `@click`** —— 键盘用户完全无法触达，而视觉、鼠标、单测、构建都不报错。按 PRD §三 补四件套，两个 keydown 表达式与 `@click` 逐字一致。

## 2. 测试（TDD 顺序与反证）

- 新文件 `apps/desktop/src/views/Collection.keyboard-cards.test.js`（**QM-6 评审后整体重写，现 6 条**；下列 1/2 条的第一版读数留在括号里，因为它们是"探针错会被读成产品缺陷"的现场，不该被后一版覆盖）：
  1. 结构锁（i4/i8 后改判据层）：断言读 **`@vue/compiler-sfc` 模板 AST**，不再用「按行 split + 整行正则」（第一版如此）；判定域是**逐张点名的六元组清单**（`data-testid ↔ @click ↔ 出口`）与 AST 结果**双向**对账，不再用 `tags.length >= 6` 这种数量保底（对"第 7 张换了 class 写法"结构性失明）。同时反向禁一条**没有 `.prevent`** 的 `@keydown.enter`/`@keydown.space`。
  2. 后代禁令锁：**读 `c.element.innerHTML`**，断言子树无 `<button|a|input|select|textarea>` 且无 `tabindex`（排除 `-1`）。
  3. 行为锁（i2/i3/i6 后扩面）：**六张卡片**各按 `click`/`keydown.enter`/`keydown.space` 触发一次，断「该卡自己的下游**恰被调用一次**」（`toHaveBeenCalledTimes(1)`，不再是 `toHaveBeenLastCalledWith`）；目的地先**归一化**再比（字符串与 `{path,query}` 两种 `push` 形态必须同串）。三张来源卡的下游是 `pageManager.createNewTabPage` 且断 **url 逐平台不同**。
  3b. 新增第二把锁 `src/focusable-ring-contract.test.js`（评审 i1）：判定域 = 全仓模板里 `tabindex="0"` 的元素，实测 `.vue=186 站点=17 缺环=1 环色违规=10`；缺环按文件登记（1 条，只能缩小、修好不删即报陈旧），环色欠账按**计数基线** 10 并每次打印现值。
  4. 负控锁：一个只有 `@click` 的 div，`trigger('keydown.enter')` / `keydown.space` **必须不产生调用**，`click` 必须产生 —— 没有这条，第 3 条会退化成"测 mount 副作用"。
- **首跑即暴露探针自身错误**：第 2 条第一版用 `wrapper.html()`，它含卡片**自己**的 `tabindex="0"` ⇒ 把本次要求的正确修法判成缺陷（`Test Files 1 failed`，红在 `expect(inner).not.toMatch(/tabindex="(?!-1)/)` 那一行）。改成 `innerHTML` 后 4 passed。**这是"锚点/探针错会被读成产品缺陷"的一次现场**，不是实现问题。
- 反证：第一版是临时探针（把 `quick-drafts-box` 退回未补全形态 ⇒ `RED_COUNT=2`、还原后 `byteEqual=true`）；**评审后改成入库驱动** `scripts/keyboard-cards-contract-mutate.js`（14 道，见 §5-A，`COUNTERPROOF=ALL_CAUGHT`）。动因是同类教训 r2-i7：反证脚本躺在临时目录里，"锁的牙"就只存在于文字叙述中。
- 消费者并集（重写后重取）：`Collection` 族 8 个测试文件 + `focusable-ring-contract.test.js` ⇒ **9 files / 165 passed**；另跑 3.6 的环锁 `src/styles/focus-ring.test.js`（12 passed，证明新规则没破坏既有环判据）与两个 CSS 消费者 `collection-page-css-contract.test.js` / `collection-page-visual-polish.test.js`（**71 passed**）。
- CSS 文件 `collection-page-legacy.css` 的工作副本是 **CRLF**（实测 crlf=468 / 裸 lf=0）：反证驱动第一版按 LF 写锚点 ⇒ 命中 0 次、`MUTATE-FAIL`；驱动现在两种行尾各试一次并要求唯一。

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
| TDD 红→绿 | PASS | 首轮：探针自身错误先红一次（`wrapper.html()` vs `innerHTML`），修正后 4 passed。评审后重写：新环锁与 AST 结构锁都是**先有实测再落判据**（可行性由一次性探针打印 `cards found = 6` 与环锁现场读数确认） |
| 反证 | PASS | 首轮临时探针 ⇒ 指名红 2 条、还原 byteEqual=true；**评审后改为入库驱动 14 道**（`scripts/keyboard-cards-contract-mutate.js`）⇒ `[BASE] collected=11 red=0` → `COUNTERPROOF=ALL_CAUGHT`，含 M11 一条「合规形态必须绿」的正控。两道 MISSED 抓到的是**锁自身**的错（M10 类名子串误命中、M9 两格棘轮语义读反），处置见 §5-A |
| 负控 | PASS | 只有 `@click` 的 div：Enter/Space 零调用、click 一次调用 |
| 消费者并集 | PASS | 首轮 4 文件 4 passed；重写后按「消费者并集 = 谁断言被改模块的行为」重取：Collection 族 + 环锁 **9 files / 165 passed**，另 3.6 环锁 12 passed、两个 CSS 消费者 71 passed |
| QM-4 视觉 | 由 CI 代跑 | **本批第二轮起有视觉变化**（键盘焦点态的 2px 环），但只在 `:focus-visible` 下绘制 ⇒ 全页像素回归对焦点态结构性失明，**不得**据此自称「无回归」。环的存在性改由环锁守；`role`/`tabindex`/`data-testid` 不入绘制流 |
| QM-1 | N/A | 未触 electron 主进程 / rpa-engine |
| 焦点环（i1） | PASS | 新增 `src/focusable-ring-contract.test.js` 4 条：域非空并打印读数、缺环按文件登记且只能缩小、环色按计数基线、匹配器整词自锁；与 3.6 的 `styles/focus-ring.test.js`（12 passed）同跑互不破坏 |
| CJK / 品牌 / 绝对路径 / 行尾 | 见 PR 当场读数 | 新增诊断与文案不入生产源码（测试文件不受 CJK 门禁统计） |
| 旧载体冻结 | PASS | 只写本篇 `openspec/records/` |
| 远程同步 | 由门禁推导 | 不写状态词、不做回填提交 |

## 5. QM-6：真跑了一轮外部双模型评审（8 条发现），逐条处置与实况

判定与产物（不手写结论，全部来自当场命令）：

- `node scripts/ccg-review-decider.js --base origin/main`（索引干净 ⇒ 按既有口径回落 HEAD-sha 命名）⇒ `mode=dual`，产物 `.ccg/reviews/8c616578….json`；本轮 head 为 `dbfdb9e06`，其自身的判定产物另存 `.ccg/reviews/dbfdb9e0….json`。
- 评审链 `CCG_ARL_DIR=<技能目录下 adversarial-review-loop/scripts> sh scripts/deep-review.sh --force` ⇒ 产物 `.adversarial/ccg-deep-dbfdb9e0/critique-v1.md`（8 条 findings + 维度分 correctness 5 / security 9 / performance 9 / maintainability 6）。

| id | 级别 | 处置 | 现场证据 |
|---|---|---|---|
| i1 | **Critical** | **采纳并修**（本批最大一条） | 评审说「补了 `tabindex=0` 却没有焦点环，而本批的验收手段恰好检测不到」。当场可证：`grep` 到 `.col-stat-card-click` 只有 `cursor: pointer`，而 3.6 的环锁 `styles/focus-ring.test.js` 头注释**明文**把「非按钮可点 div」划出自己的判定域 ⇒ 两把锁之间确实留缝。修法：CSS 加 `:focus-visible` 环（环色 `--color-focus-ring`，浅/暗各有映射故不写暗色覆盖）+ 新锁 `src/focusable-ring-contract.test.js`（域 = 全仓 `tabindex="0"` 站点；实测 `.vue=186 站点=17 缺环=1 环色违规=10`）。该锁 12 passed 与 3.6 的环锁同跑互不破坏 |
| i2 | Warning | **一半采纳、一半否证** | 采纳：行为断言从 `toHaveBeenLastCalledWith` 改成**恰一次**计数（反证 M7 实测：让一次触发调用两次下游，只有计数断言会红）。否证：其前提「浏览器为 `role=button` 合成 click ⇒ 双重激活」经**真 Chromium 静态夹具实测**不成立 —— Enter/Space 两条读数都只有 keydown/keyup、**没有 click**（详见 PRD §三-B 逐字读数）。真浏览器整页端到端未做，作为残余如实写在 PRD §三-B |
| i3 | Warning | **采纳** | 行为锁从 1 张扩到 6 张：每张按 `click`/`keydown.enter`/`keydown.space` 各断「自己的下游恰一次」；三张来源卡断 `createNewTabPage` 的 **url 逐平台不同**（比"调用过 createTab"强，表达式抄错来源 id 时 url 就变）。消费者并集实测 9 文件 165 passed |
| i4 | Warning | **采纳** | 结构判据改读 `@vue/compiler-sfc` 模板 AST。两条真毛病都被证实：整行正则 ⇒ 折行即假红（判据绑排版）；`new RegExp('@keydown.enter.prevent')` 的 `.` 未转义 ⇒ `@keydown.xenter.prevent` 也算命中。解析可行性先实测（一次性探针打印 `cards found = 6` 与逐张属性）再改锁 |
| i5 | Warning | **不修判据，只登记** | 两条都是**链路形状**而非判据损坏：① 产物按 head sha 命名，pre-commit 只能拿到暂存前的 HEAD ⇒ 命名与本次 head 差一个提交（本仓既有记录已写明）；② `reason` 报「命中敏感内容 1 处」而实际命中的是无障碍散文里的词元（规则 4 的 `\b(SELECT|…)\b` 大小写不敏感）。改敏感分类属「改谁来守门」，按 AGENTS 须人工过目 ⇒ 上报不代拍 |
| i6 | Warning | **采纳（含一条正控）** | 目的地断言先**归一化**再比：`'/publish?tab=drafts'` 与 `{path,query}` 得到同一个串，取不到的形态一律抛错（静默返回空串会把「没比上任何东西」读成通过）。正控 M11 实测「改成对象形态时锁保持绿」。其「switchTab 可能有早退守卫 ⇒ 连续三次触发不稳」半句**源码否证**：`switchTab` 只有 `TAB_KEYS` 合法性检查，无去重早退 |
| i7 | Info | **采纳为文档取舍，不改实现** | 实测确认成立：原生 `<button>` 的 Space 在 **keyup** 才 click，本批是 keydown 即触发。不改的实现理由：`.prevent` 只能挂 keydown 才挡得住默认滚动，挪到 keyup 就要留一条空处理器，破掉「keydown 表达式与 `@click` 逐字一致」这条可机械核对的契约。取舍与代价（无「按住移焦取消」）写进 PRD §三-B |
| i8 | Info | **采纳** | 判定域从 `tags.length >= 6` 改为**逐张点名**（`data-testid ↔ @click ↔ 出口` 六元组，与 AST 结果双向对账）。6 张卡各补 testid。反证 M6 实测：新增第 7 张不登记 ⇒ 当场红 |

## 5-A 反证（`node scripts/keyboard-cards-contract-mutate.js`，驱动本体入库）

14 道，`[BASE] rc=0 collected=11 red=0` 起步，末尾 `COUNTERPROOF=ALL_CAUGHT`、`DRIVER_RC=0`，每道都打印红集并要求源文件按字节还原。**其中两道抓到的是锁自身的错，不是产品的错**：

| 变异 | 让它指名的那一格红 | 备注 |
|---|---|---|
| M1 摘掉微博卡 Enter 绑定 | 结构锁 + 行为锁 | 少写一个 keydown = 半条通路 |
| M2 Space 表达式指向别的来源 | 结构锁 | 「近似逻辑就是两套行为」 |
| M3 去掉 `.prevent` | 结构锁 | Space 连带滚页 |
| M4 摘掉 `tabindex="0"` | 结构锁 | 期望集第一版多写了环锁 —— 该卡不再是可聚焦站点，环锁的域跟着少一个，**不会红**（域由 tabindex 决定），已改正期望 |
| M5 摘掉 `role="button"` | 结构锁 | |
| M6 新增第 7 张不登记 | 判定域逐张点名 | i8 的牙 |
| M7 一次触发调用两次下游 | 行为锁（恰一次） | i2 的牙 |
| M8 摘掉整条焦点环规则 | 环锁「缺环」 | 第一版锚点写 LF 而 CSS 工作副本是 CRLF ⇒ `命中 0 次` 直接 MUTATE-FAIL（那不是没牙，是**根本没造出变异**）；驱动改为行尾无关锚点 |
| M9 环色硬编码 | 环锁「计数上界」 | 期望集第一版多写了「基线不得变松」⇒ **MISSED**；两格棘轮语义相反（上涨 vs 调松），拆成 M9/M12 各测一格 |
| M10 环规则挂到前缀扩展的假类名 | **第一版 MISSED** | `selector.includes('.' + cls)` 把 `.col-stat-card-click-ghost` 算成命中 ⇒ 改成整词正则 + 匹配器自锁（M14 钉住不许退回）。这是本轮唯一一道**证伪了判据本身**的变异 |
| M11 push 改对象形态 | **合规形态必须绿** | 正控，不是红 |
| M12 环色基线 10 → 12 | 「基线不得变松」 | 与 M9 互为对偶 |
| M13 摘掉欠账登记 | 环锁「缺环」 | 清单只是豁免，不是判据的例外 |
| M14 匹配器退回子串 `includes` | 匹配器自锁 | M10 的成因不许复发 |
