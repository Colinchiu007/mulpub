---
record: model-provider-status-tristate
task: 模型服务商卡片状态标签三态化（未配置 / 已启用 / 已停用）并让整张卡片可点、直接打开配置界面填写
date: 2026-10-24
delivered_by_pr: 4345
---

## 本次执行记录：模型服务商状态三态 + 卡片可点（model-provider-status-tristate，2026-10-24）【纯功能 PR · 零依赖改动】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/views/ModelProviders.vue`、`apps/desktop/src/utils/provider-status.js`、`apps/desktop/src/locales/model-providers/*`）⇒ 隔离 worktree `mp-worktrees/mp-model-provider-status-tristate`、裸分支 `model-provider-status-tristate`（`git worktree list` / `git branch --show-current` 实证）；共享主目录留在 `main` 且不承载本次改动 |
| 第一性原因（QM-5 ①） | ✅ | 状态标签**直译数据库 `enabled` 布尔位**（`p.enabled ? 已启用 : 已禁用`），而 `enabled` 在本仓不是「用户禁用开关」，是「有没有可用 API Key」的派生位：预设种子行写死 0（`electron/services/model-provider-manager.js:573-575`）、运营目录同步插入的预设行同样 0（同文件 `:971-972`）、存了新 Key 才置 1 / 清空 Key 置 0（同文件 `:900-906`）。UI 上**根本没有**启用/禁用的开关（`toggleEnabled` 已实现但未接线到任何元素，模板里除 import 外零引用）⇒ 「从没配过」的卡片被贴上「已禁用」，把内部派生位当成了用户意图 |
| 逃逸分析（QM-5 ②） | ✅ | ①**视图层零覆盖**：`apps/desktop/src/views/ModelProviders.test.js` 此前**不存在**，该视图的任何渲染行为都没有测试可断言；②**判据无单一真源**：`enabled` 的语义散在后端写入点、DB 默认值、词表、视图四处，视图是唯一把它翻译成人话的地方，却没有任何一处说明它不是用户开关；③**词表自证不了**：zh/en 词表里 `disabled: '已禁用'` 与 `notConfiguredKey: '未配置'` 并存，同一张卡片上「未配置」的 Key 字段与「已禁用」的状态标签说同一件事的两种话，没有任何门禁比对这两句话 ⇒ 没人发现它们矛盾 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①新增单一真源 `apps/desktop/src/utils/provider-status.js`（三态判定 + 「有可用 Key」判据，8 个单测）；②新增视图用例 `apps/desktop/src/views/ModelProviders.test.js`（**9 例**：三态文案 / 点未配置卡片名称开配置界面 / 点已配置卡片名称开配置界面 / **覆盖层形状静态契约** / 删除按钮不被覆盖层吞掉 / 测试连接按钮不被覆盖层吞掉 / 多模态能力 chip 不被覆盖层吞掉 / 「已配置」页签状态标签 / 「已配置」页签卡片可点）；③词表三态成对维护（zh/en key 集合 135 = 135，无单边键）；③'顺带补齐 #4041 漏补的第二处能力 chip 键盘可达（见下）；④旧的 `enabled`/`disabled` 两个徽标键**删除**（全仓引用已查证为 0，留着就是同义第二套词汇）；⑤`disabledMsg` 的「已禁用」一并统一为「已停用」 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①判据改落在**本质属性**上（`is_configured` 与「掩码串非空」），不再落在内部布尔位上 —— 这条判据对「Key 还在但停用」与「从没有 Key」给出不同结论，旧的布尔直译给不出；②`provider-status.js` 是**唯一**一份状态判定，视图只做「状态 → 文案/类名」的映射，不再自己判；③视图层首次有测试文件，**卡片可点/不误触**从此有回归锁；④`utils/provider-status.js` 顶部写明两处已知边界（「本地免 Key」服务商、解密失败），不给后来者留「补一份漂移判据」的空间 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 实测相等（`git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 逐行 diff 为空）：6/2、10/3、65/0、66/0、297/0、86/10、416/0（en.js、zh.js、provider-status.js、provider-status.test.js、ModelProviders.test.js、ModelProviders.vue、本记录）；7 个文件全 LF |
| 接线棘轮 | ✅ | 新增 2 个 `*.test.js` 均在 `apps/desktop/src/**` 下，落在 `apps/desktop/vitest.config.js` 的 `include` 通配 `src/**/*.test.{js,ts}` 内；`node scripts/check-unwired-tests.js` → 「检查域内测试文件 128 个 / OK: 全部测试均已接线或按欠账登记」；两个文件实跑均被执行（`vitest run src/views/ModelProviders.test.js` → 8 passed；`src/utils/provider-status.test.js` → 8 passed） |
| QM-1 打包 / QM-4 视觉 | N/A / 待办 | QM-1：改动只在渲染进程 `src/`，未触碰 `electron/` 打包面 ⇒ 本片不跑打包。QM-4：**有视觉面变更**（卡片可点、名称改为按钮、状态色新增「未配置」琥珀色、卡片视觉态重分、名称行盒高因 line-height 重置而回到 1.5×）⇒ 已登记为待办项，见下「未闭合」第 1 条 —— 本机无可用 Electron 显示环境，视觉回归截图未能产出 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道（`codeagent-wrapper` 类工具未探测到）；**如实记为未执行，不以自审冒充通过**。另：本片**另行跑了独立对抗性审查**（非 CCG 通道，结论见下「外部审查」一节） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

### 变更内容

| 面 | 改前 | 改后 |
|----|------|------|
| 状态标签 | `p.enabled ? 已启用 : 已禁用`（两处） | 三态：未配置 / 已启用 / 已停用 |
| 状态判据 | 直接读 `p.enabled` | `utils/provider-status.js`：`is_configured===true` ⇒ 已启用；否则「掩码串非空」⇒ 已停用；否则未配置 |
| 卡片视觉态 | `!p.enabled` ⇒ 灰度 + 60% 不透明（**未配置的卡片长得像被禁用的**） | 只有「已停用」灰度降级；「未配置」保持正常色（待办色 88% 不透明） |
| 卡片交互 | 只能点 4 个图标按钮 | 整卡可点 ⇒ 直接打开配置界面填写（由**名称按钮的 `::after` 覆盖层**把命中区扩到整卡）；卡片内可交互元素被抬到覆盖层之上，不被吞掉 |
| 键盘可达 | 名称是纯文本 | 名称本身是真正的 `<button>`（可 Tab 到达、有 focus-visible 描边） |

### 门禁实测读数（本片现场跑出来的）

| 命令 | 读数 |
|------|------|
| `node .github/scripts/check-max-lines.js` | `[max-lines] domain=12303 … ✅ 无新增超大文件，挂账清单与现实一致。`（`ModelProviders.vue` 门禁口径 **1484** 行（`split('\n').length`），零容差 target **1496**，未撞线 ⇒ **无需按棘轮上调 targets**） |
| `node scripts/check-debt-budget.js` | ✅ 所有债务指标在基线内 |
| `node scripts/check-unwired-tests.js` | 检查域内测试文件 128 个 → OK 全部已接线 |
| `node scripts/check-no-hot-carrier-edit.js` | `MODE=advisory … 命中热写面=0 … 判定=PASS`（**未直接改 `CHANGELOG.md` / `01-docs/learnings.md`**） |
| `node scripts/check-gate-record-debt.js` | OK：两源未收口的「远程同步」行均已登记，跨源比对违例 0 |
| `node scripts/check-doc-abs-paths.js` | PASS（全量审计 5675 个受管文件，无新增本机绝对路径） |
| `node scripts/aggregate-changelog.js`（**只 dry-run**） | `AGGREGATE records=743 … landed=33 … mode=dry`，其中 `LAND model-provider-status-tristate` ⇒ 本记录**能被聚合器识别**；按 Gate 2b8 的规定 PR 门禁**只跑 dry-run**，真写入属发版动作（`release-gate` 片4），故本片**不动** `CHANGELOG.md` |
| zh/en 词表键集合 | 135 = 135，`zh-only: []`、`en-only: []` |
| 行尾两口径 numstat | 逐行 diff 为空 |

> ⚠️ `aggregate-changelog.js --write` 会把**别人的**待搬条目一起写进本 PR 差量 ——
> CI Gate 2b8 明写「在 PR 门禁里写文件会把别人刚并入 main 的条目算进我的差量，那既是假红也是把聚合器变成第二个写者」。
> 故本片只交付记录载体，台账由发版流程搬运。

> ⚠️ **行数口径**：门禁脚本读的是 `split('\n').length`（`check-max-lines.js:128`），
> 比 `wc -l` **多 1**。若将来要把 target 锚到本片的结果，必须用 **1467** 而不是 `wc -l` 的 1466 ——
> 差这一行就是 `TARGET_GREW` 直接红。本片**不动** target：现有 target 1496 比实际高 29 行，
> 属主干上的既有额度（不是本片制造的），且并发中的 PR #4337 正在改这条机制
> （「只降不升」的锚定规则），两边同时改会撞。

### 外部审查（独立对抗性审查，非 CCG 通道）

**审查结论：FAIL**（产品代码与门禁逐条核过没有错，但**回归保护没兑现到位**）——
3 条 MAJOR 全部是「改动本身的回归保护缺口」，不是风格问题。逐条处置：

| # | 缺口 | 处置 |
|---|------|------|
| M-1 | 「测试连接按钮不冒泡」那条**恒真**：它点的是**未配置**卡片的测试按钮，而该按钮 `disabled`（`:disabled="!(isProviderConfigured(p))"`）⇒ **disabled 按钮根本不派发 click 事件** ⇒ 断言「没开弹窗」恒成立，删掉 `@click.stop` 也照样绿 | 改用**已配置**的 openai 卡片（其测试按钮 enabled），并在用例里**显式断言按钮确实 enabled**，把「非恒真」写进用例本身 |
| M-2 | 多模态「能力默认」chip 的 `@click.stop` **零覆盖**：它是卡片内**唯一不靠父级 `.card-actions` 保护**的可交互元素（它在 `card-body` 里） | 新增用例：点 chip ⇒ 能力默认**确实被切换**（反向断言 API 被调用）**且**配置弹窗**未**打开 |
| M-3 | 三态判定在模板里有**两个**调用点，只锁了「全部」页签那一个；把「已配置」页签那个改回旧直译，13 条用例照绿 | 新增用例：「已配置」页签下状态标签全为「已启用」 |
| N-3 | `.provider-name-btn` **漏重置 `line-height`**：Chromium 给 button 的 UA `line-height: normal`，而 body 是 1.5 ⇒ 名称行盒从 1.5× 缩到约 1.2×，标题在卡片里明显变矮 | 补 `line-height: inherit; margin: 0 0 4px;` |
| N-1 | 徽标说「已停用」而 toast 说「已禁用」——两套词汇已经漂了 | `disabledMsg` 统一为「已停用」；徽标/字段/toast 三者的归属边界登记在下面「词汇归属边界」 |
| N-4 | 记录里「视图用例 5 例」与实际条数不符；「`global.stubs` 是跨测试文件共享的进程级状态」这一因果**在本仓 vitest 配置下不成立**（默认 `isolate: true`，逐文件独立注册表，实测不泄漏） | 条数更正为 8；该因果陈述改为「本仓 vitest 默认 isolate，逐文件独立注册表；此处还原属防御性习惯」 |
| N-5 | 「本地免 Key + enabled=0」这条边界只写在注释里、没有用例锁 | 补单测锁住该判据（本地免 Key 且未启用 ⇒ 未配置） |

**变异验证（改坏实现 ⇒ 必须变红）**

| 变异 | 读数 |
|------|------|
| 删掉 `.card-actions` 的 `@click.stop` | **2 failed** / 6 passed（M-1 那条不再恒真） |
| 删掉多模态 chip 的 `@click.stop` | **1 failed** / 7 passed |
| 「已配置」页签的状态标签改回旧直译 | **1 failed** / 7 passed |
| 还原 | 8 passed / 0 failed |

### 整卡可点的实现形态：为什么不是给卡片根挂 `@click`

**首版就是给卡片根挂 `@click="openEdit(p)"`**（直觉做法）。落地时撞上主干刚合的
**键盘可达性合同**（`apps/desktop/src/clickable-roles.contract.test.js`，PR #4041），
才知道那条路走不通 —— 三条独立原因：

1. **合同会把卡片根算成「域」**：`@click` 挂在非原生元素上 = 需要 `role="button"` + `tabindex` + `@keydown`。
2. **补了 role 反而更糟**：button 是 leaf 角色，给**含真按钮的容器**加 `role="button"`
   会把卡片内的操作按钮从 a11y 树上抹掉。#4041 的作者在同一处踩过并撤销过
   （CreateView 上传区、CreatorMonitor 条目都因「内部有可见真按钮」而撤销 role）。
3. **台账已满**：合同的未补全站点台账硬上限 13 条、当前恰好 13 条
   （`expect(LEDGER.length).toBeLessThanOrEqual(13)`）⇒ **新站点登记不进去**。

⇒ 改成**合规构造**（而不是靠门禁的盲区过绿）：

- 卡片根**不挂 `@click`、不挂 `role`**（保持非控件）
- 动作由**真 `<button>`（服务商的名称）**承载 ⇒ 键盘可达、AT 可见、无 leaf 角色问题
- 该按钮的 `::after` 做成 `position:absolute; inset:0` 的**覆盖层**，把命中区扩到整张卡片
  （stretched button / stretched link 模式）⇒ 「点卡片任意处」成立
- 卡片内的可交互元素（`.card-actions`、多模态能力 chip）用 `z-index` 抬到覆盖层之上，
  否则它们的点击会被覆盖层吃掉

**代价（如实登记）**：命中区是 **CSS**（jsdom 无命中测试）⇒「点卡片任意处」由**静态契约**锁形状
（`.provider-card` 定位基准 / `::after` 的 absolute+inset:0 / 可交互元素的 z-index 高于覆盖层 /
卡片根不含 `@click` 与 `role`），动作本身由「点名称按钮」的用例锁；**真机命中区仍需 QM-4 走查确认**。

**变异验证**（改坏实现 ⇒ 必须变红）：

| 变异 | 读数 |
|------|------|
| 删掉 `::after` 覆盖层规则 | **1 failed** |
| 可交互元素不再高于覆盖层（去掉 z-index:2） | **1 failed** |
| 把 `@click` 挂回卡片根（写成扫描器可见的形态） | **1 failed**（**被 a11y 合同锁直接抓住**） |
| 名称改回纯 `<div>`（失去真实点击目标） | **3 failed** |
| 还原 | 16 passed / 0 failed |

> 第三条最关键：它证明这套设计**被门禁护住**，而不是靠扫描器的盲区侥幸通过。

### ⚠️ 附带发现：键盘可达性合同的扫描器有**两处**盲区（**不在本片范围内修**）

上面第 3 条里我一度以为「卡片根挂 `@click` 也能过」—— 实测发现该合同的扫描器**看不见一部分真实元素**。
两处盲区，都出在扫描器的「域清点」实现上：

**盲区一：标签名之后必须同行有字符**

```js
const tagRe = /<([A-Za-z][\w.-]*)(?=[\s/>])/g   // 标签名之后必须**同行**有 [\s/>]
```

`<div` 后面直接换行 ⇒ 前瞻失败 ⇒ 该元素**整个不进入扫描域**。

**盲区二（更严重）：模板边界用「第一个含 `</template>` 的行」判定**

```js
const tplEnd = lines.findIndex((l) => l.includes('</template>'))
```

但 Vue 模板里有**嵌套的 `<template>`**（`#footer` 具名槽、`v-if` 分支），
每个都有自己的闭合 `</template>` ⇒ `findIndex` 命中的是**第一个嵌套块的闭合标签**，
不是组件模板的结尾 ⇒ **该文件此后的全部内容不进扫描域**。
实测 `apps/desktop/src` 下 **192 个 .vue 里有 52 个被截断**，最严重的：
`CreateView.vue` 扫描止于 262 行（真实结尾 993，**漏 731 行**）、
`Publish.vue` 止于 47（漏 651）、`Collection.vue` 止于 107（漏 454）、
`FilmEngineeringView.vue` 止于 25（漏 444）、`ModelProviders.vue` 止于 217（漏 297）。

**量化（把两处盲区都修掉后重扫）**：

| 口径 | 站点 | 已补全 | 仍缺 |
|---|---|---|---|
| 现状扫描器（两处盲区都在） | **31** | 18 | 13 |
| 两处盲区都修后 | **72** | 30 | **42** |

⇒ 盲区里漏掉 **38 个去重站点**，含
`AccountManagementCard.vue` 的 `<article @click>`、`CreatorMonitor.vue` 的 `<li @click>`、
`Collection.vue` 的 9 处、`Home.vue` 的 5 处、`CreateView.vue` 的上传区、
`UiModal.vue` / `PublishTypeDialog.vue` 等遮罩…

- 影响：该门禁自称「域由模板扫描得出」（不按类名猜），但实际域**只有真实域的 43%**；
  它自己的下界断言（`sites.length >= 30`）**抓不到**这类盲区（漏的是站点、不是整体退化）。
- 修它的代价：修正后未补全站点从 13 涨到 **42**，而**台账硬上限是 13** ⇒
  这是一件**独立的、需要先定政策的工程**（是逐个补 `role+tabindex+keydown`，
  还是重设台账上限、还是接受分批还债），不是本片（文案 + 卡片交互）能顺手带上的。
- 本片的处置：**不依赖盲区**（改成合规构造），并把这条发现如实登记在此处供后续立项。

### ⛔ 顺带修掉的一处：#4041 的修法只补了一半

上面盲区二直接导致一个**真实缺陷**被漏掉：#4041 给 `ModelProviders.vue` 的多模态
「能力默认」chip 补了 `role/tabindex/@keydown`，但**同一个文件里有两处同款 chip**
（已配置视图一处、全部视图一处），它**只补了已配置视图那一处** ——
因为全部视图那处落在扫描域被截断的区间里，门禁看不见。
⇒ 全部视图那处 chip 至今**只有 `@click`、没有键盘入口**。
本片在同一文件里顺手补齐（属性与已配置视图那处逐字一致），
并在 `apps/desktop/src/clickable-roles.contract.test.js` 的既有判据下复跑通过（7/7）。

### 词汇归属边界（登记，避免后来者当成「三套重复词汇」去合并）

| 词 | 归属 | 为什么不合并 |
|---|---|---|
| `statusEnabled` / `statusDisabled` / `statusNotConfigured` | **状态徽标**（卡片右上角那个小标签） | 本片新增，唯一消费方是 `statusText(p)` |
| `notConfiguredKey` / `configuredKey` | **API Key 字段的值**（卡片表单区那行） | 值与徽标逐字相同（都是「未配置」），但描述的是**另一个对象**（Key 本身 vs 服务商状态）；合并会让「改一处动两处」 |
| `configuredBadge` | **「✓ 已配置」徽章** | 与 `statusEnabled` 不同义：一个说「配了没」，一个说「现在能不能用」 |
| `enabledMsg` / `disabledMsg` | **操作 toast**（属尚未接线的开关路径） | 已把 `disabledMsg` 统一成「已停用」；`enabledMsg` 与 `statusEnabled` 同词但不同角色（一次性提示 vs 持续状态） |

### ⚠️ 顺带处理的一条：新发布的依赖公告（**与本 PR 零关系，但会挡所有 PR**）

CI 有一条 `依赖漏洞审计门禁` 红了，判定是：

```
❌ NEW_ADVISORY: npm/GHSA-mrhx-c7xc-m3w5 (zod high, 修复版本 >=4.6.6, 路径 .|packages__remotion-composer)
```

⇒ **GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404**（2026-10-01 发布）：
「Zod can exhaust memory while validating oversized constrained collections」，影响 `zod < 4.6.6`，本仓解析到 4.3.6。

**归属判定（对照实验）**：本 PR 的 diff 里**零依赖变更**（`package.json` / `pnpm-lock.yaml` 均未触及）
⇒ 审计的输入与 main 逐字相同 ⇒ **这条红是 main 级的**，与本 PR 无关。
实测**当前 12 个 open PR 里 4 个同因变红**（#4351 / #4345 / #4341 / #4328），
另几个绿是因为它们的检查在公告发布**之前**就跑完了 —— 该门禁每次都重新联网扫，
所以「PR 创建得早」不等于「PR 是绿的」。

**为什么必须在本 PR 里修**（同 QM-6 夹具那次的结构）：该门禁在 PR 侧跑的是**本 PR 的树**，
主干不跑（`dep-audit.yml` 只在 `pull_request` / 每周定时 / 手动触发）⇒
另开一个 PR 修基线**解不开**本 PR 的红（主干上那份基线不会被带进本 PR 的树）。

**处置（一度登记，最终移交）**：按仓里既有的挂账形态，本片**一度**在 `scripts/dep-audit-baseline.json`
登记这一条（`decision: upgrade-tracked` + `targetVersion: 4.6.6` + note 写明来源链、触达面核查与动作），
当时**只增这一条、其余 27 条一字未动**（`git diff` = +14 行、零删除）。
**最终这条登记没有留在本 PR**：主干已由 #4354 / #4356 用**自己的措辞**登记了同一条（措辞不同 ⇒ 内容不同），
本 PR 若再带一份 ⇒ 合并时 git 的**行级**三路合并判不出「两边新增了同一段登记」⇒ **同一 id 会留下两份**。
⇒ 本 PR 最终**不携带任何基线改动**，直接沿用主干当前基线（理由与移交去向见下「依赖部分的移交」一节）。

> ⚠️ **踩到并避开的坑**：先跑 `node scripts/check-dep-audit.js --update` 想让脚本自己写，
> 结果它**重写了 10 条既有条目的 `roots`**（多出 `"."`）、把 `GHSA-3jxr-9vmj-r5cp` 的
> `patched` 从 `>=1.1.16` 改成 `>=5.0.7`（**注册表侧元数据已更新**），连带触发
> `DECISION_CONTRADICTS_PATCHED`（旧 `targetVersion: 1.1.16` 逃不出新的下界 `>=5.0.7`）。
> ⇒ `--update` 落的是「按今天的注册表重算的整份基线」，不是「加一条」；
> 本 PR 只要新公告那一条 ⇒ 改为**手工插入**并用 `git diff` 逐字验证其余条目未动。
> 复跑结果：`✅ 无新增已知漏洞公告，基线与现实一致且结论完整`（命中 28 / 挂账 28），
> `node --test scripts/check-dep-audit.test.js` 58/58 绿。

**为什么不顺手把 zod 升了**（取舍，已写进 note）：升级 zod 需要 pnpm override 或升它的精确 pin 方 ⇒ 属独立的依赖变更片，
不该夹带进一个「文案 + 卡片交互」的 PR。

> ⚠️ **本片修正了自己的一处结论（原先写错了）**：当时的 note 写的是
> 「`@modelcontextprotocol/sdk@1.32.1` 把 `zod: 4.3.6` **精确钉死**（不是版本范围）」——
> **这句是错的**。实测注册表：`@modelcontextprotocol/sdk@1.32.1` 的 zod 是 **peerDependency `^3.25 || ^4.0`**，
> 4.6.7 本来就满足；真正把 zod 钉成精确版本的是 **`@remotion/media` / `@remotion/studio`**
> （latest 声明 `zod: 4.5.4` 精确版本）。
> ⇒ **结论不变**（仍不夹带升级），**理由要改** ⇒ 修正后的分析（含实测证据）落在依赖升级片里，
> 本片只留这条纠错记录，不把错误结论继续传下去。

### ⛔ 我自己写的一条用例**只在 Linux 成立**（CI 在 Windows 上打红，本地却绿）

CI 的 `QG Coverage` 因**我自己新增的一条用例**失败（`19872 passed | 1 failed`，唯一失败那条是
「覆盖层形状」静态契约）：

```
Error: ENOENT: no such file or directory, open '<被拼坏的绝对路径>'
```

（原文是 CI runner 上的**双盘符**绝对路径 —— 盘符前缀重复了一次。**不复制字面量**：
执行记录里一旦照抄本机绝对路径，本记录自己就会撞上「文档不得含本机绝对路径」那条门禁。）

**根因**：那条用例用 `new URL(import.meta.url).pathname` 取自身路径。
Windows 上 `import.meta.url` 的 pathname 形态是「**斜杠 + 盘符 + 冒号 + 斜杠 + 路径**」
（比真正的盘符路径多一个前导斜杠）⇒ 再被 `path.join` 拼一次 ⇒ 变成**双盘符**（盘符前缀重复）⇒ ENOENT。
仓库里 3 个同类源码 grep 型测试（`NavBar.test.js` / `PodcastHostingCard.test.js` /
`PodcastPublishAction.test.js`）用的都是 **`fileURLToPath(import.meta.url)`** —— 仓规本已是这个写法，
是我自己没照抄。

**同一条用例里还埋了第二个雷**：正则里的 `\n` 假设文件是 LF。
仓内 Windows checkout 的 `.vue` 是 **CRLF** ⇒ 前瞻不匹配 ⇒ 同样**只在 Linux 成立**。
修法：读出来先 `.replace(/\r\n/g, '\n')` 归一（与 `clickable-roles.contract.test.js` 同款）。

**修完后的两条实测**（可复现）：
① 把 `.vue` 转成 CRLF 再跑 ⇒ 9/9 仍绿（第二个雷已排）；
② 第一个雷**本机无法执行证明**（`fileURLToPath` 在 Linux 上也是 POSIX 语义）⇒
据实说明依据：CI 报错里的双盘符症状 + 仓内 3 处既有测试都用 `fileURLToPath`。
⇒ **这一条是我自己踩的「跨环境只在本机成立的断言」**：它绿了整整两轮本地验证
（`vitest run` 9/9、相关回归 107/107），只在 Windows CI 上才现形。

### ⚠️ 第二轮：同一门禁又冒出**两条新公告**（发布于 2 小时前）⇒ 门禁是移动靶

推了新提交后 CI 重跑，`依赖漏洞审计门禁` 又红，这次是**两条**：

```
命中分布: npm=26 npm-opscenter=2 pip=2 命中=30 挂账=28
❌ NEW_ADVISORY: npm/GHSA-27r3-jxmh-p828 (body-parser high, 修复版本 >=2.4.0, 路径 .|packages__ai-writer-api)
❌ NEW_ADVISORY: npm/GHSA-jr5w-w6x2-84p9 (electron high, 修复版本 >=43.8.1, 路径 .|packages__rpa-engine|packages__shared-utils)
```

查发布时间是 **2026-10-23 20:53 UTC**（比第一轮的 zod 公告 2026-10-01 晚了三周）⇒
**公告是被批量发布的**。两条都**真·中招**（不是误报）：
- `body-parser`（CVE-2026-111181，压缩请求体尾部字节 DoS）：本仓**同时存在两条线**
  `1.20.5` 与 `2.3.0`，**两条都在漏洞区间内**（1.20.5 < 1.20.9；2.3.0 < 2.4.0）
  ⇒ 公告给的两个修复下界**都要满足**，不是只升一条线。
- `electron`（CVE-2026-115570，eMudhra 中间证书）：本仓 43.7.7 落在 43.x 区间（<43.8.1）。

**处置同上一轮**：按仓里既有的挂账形态手工登记这两条（`upgrade-tracked` + `targetVersion` + note），
当时**只增这两条、其余 27 条一字未动**（`git diff` = +29 行、零删除）；
复跑 `check-dep-audit.js` → ✅ 命中 30 / 挂账 30；`node --test scripts/check-dep-audit.test.js` → 58/58。
**最终这两条登记同样没有留在本 PR**（主干已用自己措辞登记了同 3 条）⇒ 见下「依赖部分的移交」。

**⇒ 由此看出的系统性问题（不在本片修，但请知悉）**：

1. **这条门禁是移动靶**：公告批量发布 ⇒ **每个重跑该 check 的 PR 都会被新公告挡**，
   与 PR 改了什么无关。仓里「每周一 03:00 UTC 的定时跑」是权威来源，但那个跑**只出结论、不写基线**
   ⇒ 结论是「基线过期了」，而修基线的动作落在每个 PR 头上。
2. **基线的元数据相对注册表已陈旧**：`--update` 会把 11 条既有条目的 `roots` 改写（多出 `"."`），
   并把 `GHSA-3jxr-9vmj-r5cp`（brace-expansion）的 `patched` 从 `>=1.1.16` 改成 `>=5.0.7` ——
   因为**同一条 GHSA 现在覆盖三个版本段**（`<1.1.16` / `>=2.0.0,<2.1.2` / `>=3.0.0,<5.0.7`），
   而脚本保守地要求 `targetVersion` **逐段都逃过** ⇒ 旧的 `targetVersion: 1.1.16` 逃不出新下界。
   本片**没有**动那条（它跟本 PR 无关，且改它等于替别人重做一次风险决策），
   只如实登记：走 `--update` 全量刷新会**连带要求重决这一条**。

### ⛔ 又一次：把 CI 的绝对路径**照抄进执行记录** ⇒ 记录自己撞上「文档不得含本机绝对路径」

`QG Changes` 的 **Gate 12c（Doc abs-path validity）** 红了。门禁点名：

门禁在**三行**上点了名（行号即上文那三行：错误消息原文、pathname 形态、双盘符形态）
⇒ **正是我上一节为了说明「Windows 上 pathname 带前导斜杠、拼出双盘符」而原样抄进去的那三行**。

> ⚠️ **本节自己又踩了一次**：写下这段说明时，我把门禁的**输出**与**源码**又抄了进来
> （前者形如「行号: 盘符前缀重复」、后者形如「逐个试盘符 + 冒号 + 分隔符」）⇒ 记录再次成为违例。
> ⇒ 这条纪律的**唯一可靠落实方式是机械检查**，不是「记得别抄」：本地造假盘符跑一遍门禁（见下）。

**这是本片第二次踩同一条纪律**：执行记录里**描述缺陷时复制了字面量**，而记录本身就在
`openspec/` 下（该门禁的受管域内）⇒ 记录成了违例。
**修法 = 描述形态，不复制字面量**：改成「被拼坏的绝对路径」「斜杠 + 盘符 + 冒号 + 斜杠 + 路径」
「盘符前缀重复了一次」，并把这条纪律本身写进记录。

**本机复现的办法（可复用）**：该门禁只判**本机真实存在的盘符**（`existingDriveRoots()` 逐个试
「盘符 + 冒号 + 分隔符」的两种写法是否在磁盘上存在）⇒ Linux 上没有盘符 ⇒ **本地跑永远绿**，
只有 Windows CI（runner 有 `D:`）才现形。
**造一个假盘符就能在 Linux 上复现**：

```bash
mkdir -p /tmp/driveprobe/'D:' && cd /tmp/driveprobe
node <repo>/scripts/check-doc-abs-paths.js --root=<repo>   # ⇒ canJudge=true
```

**正向对照**（同一命令、同一工作区）：
- 修复前的记录版本 → `FAIL：超出存量基线 1 个文件`，且点名的行号与 CI 日志**逐字一致**（L228/L232/L233）
- 修复后的记录版本 → `PASS（全量审计 5725 个受管文件）`

⇒ 判据在本机也能复现了（此前只能靠 CI 抓），这比「再靠一次 CI」划算得多。

### ⚠️ 第四轮：又一批 6 条新公告（**发布于今天最后两小时**）⇒ 这次**没有**挂账，而是直接升级解掉

CI 重跑，`依赖漏洞审计门禁` 又红，这次是 **6 条**（npm 命中 26 → 32）：

| 公告 | 模块 | 严重度 | 修复下界 | 路径 |
|---|---|---|---|---|
| GHSA-333x-w4r6-6crp / -w74x-v6f9-j3xg / -wjr9-j795-jxcr / -xhq7-xmqj-769h | fast-uri | low / moderate ×3 | >=3.1.9 | . \| packages__remotion-composer |
| GHSA-4qv8-2p9j-2685 / -f72v-6w45-q472 | undici | moderate ×2 | >=7.30.1 | . \| apps__desktop \| packages__rpa-engine \| packages__shared-utils |

**发布时间全部在 2026-10-23 21:36–22:13 UTC（最后两小时）** ⇒ 公告流是**持续发布**的，
不是偶发一批。

**这次没有再往基线挂 6 笔账，而是直接升级解掉**（依据：门禁自己给的第一个选项就是「升级依赖」，
且这两条恰好都是**补丁级**）：

- `fast-uri` 3.1.8 → **3.1.9**（ajv 系传递依赖）
- `undici` 7.30.0 → **7.30.1**（MCP 客户端等传递依赖）

用 `pnpm update fast-uri undici --lockfile-only` 定向升级 ⇒ **整份 lockfile 只动 33 行**（20 增 / 13 删），
**未声明这两个包的任何 package.json 都不需要改**（父包的 caret 范围已覆盖）⇒ 零声明面改动。

**结果**：npm 命中从 32 回到 **26**，与基线登记数**恰好一致** ⇒
`check-dep-audit.js` → ✅「无新增已知漏洞公告，基线与现实一致且结论完整」，
**基线一条都不用加**（对比：挂 6 笔账约 +90 行，且债留到下一个人）。

**取舍（当时写进 PR 正文，现已改）**：本 PR 因此额外带了一个 33 行的 lockfile 补丁升级。
判据是：① 门禁给的第一选项就是升级依赖；② 两个包都是**补丁级**；③ 代价 33 行
远小于挂 6 笔账（~90 行）；④ 挂账是**推后**，升级是**解掉**。
本仓的通行形态是「挂账 + 动作项」，但当挂账对象恰好是补丁级、且一次能解掉一批时，
直接升级更省事也更诚实。

### 📦 依赖部分的**移交**（本 PR 最终形态：零依赖改动）

上述三轮依赖处理（zod / body-parser+electron 的**登记**，以及 fast-uri+undici 的**定向升级**）
在本 PR 里**一度**都发生过，但**最终全部移出**。理由三条，按重要性：

1. **留在本 PR 会让主干多出 3 份重复登记**：本分支切出时，主干基线是 27 条；
   本片登记的 zod / body-parser / electron 三条后来由**主干侧**（#4354 / #4356）用**自己的措辞**
   登记了同 3 条 ⇒ 合并时 git 做的是**行级**三路合并，判不出「两边新增了同一段登记」
   （两边插入位置不同 ⇒ 行区间不同）⇒ **同一个 id 在合并结果里留下两份**。
   实测（本地把本 PR 与 #4361 一起合进主干基线后复现）：body-parser / electron / zod **各 2 份**。
   ⇒ 本 PR 的基线文件**退回主干的逐字原文**（零 diff）⇒ 合并结果就是主干那份，无重复、无冲突。
2. **同题已有更完整的在飞 PR**：#4361 正在做 fast-uri / undici 这 7 条，而且**比本片多做了关键一步** ——
   它把 `pnpm-workspace.yaml` 的 override **地板**（`^7.29.1`/`^3.1.7`）一并抬到公告的修复下界
   （`^7.30.1`/`^3.1.9`）。本片只刷新了 lockfile，地板没抬 ⇒ 将来一次**非 frozen** 的 install
   就可能把它们解析回漏洞版本（棘轮判绿、审计判红，两条判据各说各话）。
   ⇒ 与其留两份半的活，不如让 #4361 独做，本片让路。
3. **「文案 + 卡片交互」PR 不该夹带依赖 churn**：夹带后，本 PR 的 diff 里同时出现 UI 改动与 lockfile 改动，
   评审与回滚都更难；而依赖这块本来就有独立的专门片在推进。

**移交去向**：
- fast-uri ×4 + undici ×3 ⇒ **#4361**（在飞，地板 + lockfile + 基线一次做全）；
- body-parser 两条线 / express / electron / zod ⇒ **新开的依赖升级片**（`fix-dep-advisories-upgrade`），
  该片顺带把 zod 的 override 做在 **pnpm 全局 override** 上（`@remotion/media` / `@remotion/studio`
  精确钉 zod，只能全局 override 才压得住），并把 override 地板抬到公告修复下界。

**顺带在依赖片里做完的核实**（本片只留结论，证据在依赖片的执行记录里）：
`@remotion/zod-types` 是 remotion 栈里真正消费 zod 的包 ⇒ 用 `npm install` + `overrides`
模拟 pnpm 全局 override，实测它在 **zod 4.3.6（remotion 的 pin）** 与 **4.6.7（override 后）**
下对同一组输入的解析结果**逐条一致（0 处差异）**；同一份 20 万元素无约束数组的解析，
堆占用从 **206.5 MB** 降到 **60.7 MB**（公告说的正是内存耗尽）⇒ override 既不改变 remotion 的语义，
又确实削掉了公告描述的放大面。

### 未闭合（不假装已闭合）

1. **视觉回归未产出**：卡片可点、名称改按钮、状态新增琥珀色、卡片视觉态重分、名称行盒高变化，
   都有可见变化，但本机无可用 Electron 显示环境，基线截图无法产出 ⇒ QM-4 未过，留作合并前人工确认项。
   走查时请**逐态截图**（未配置 / 已启用 / 已停用）三态对比，别只看默认页。
2. **「启用/停用」开关未接线**：`toggleEnabled` 仍是孤儿函数。接上去会让用户能主动停用某个服务商，
   而运行时是按 `enabled=1` 过滤选模型的（`model-provider-manager.js:1095/1179/1224`）⇒
   这是**行为面**变更，超出本片「文案与交互」的范围，需产品决定后再单独一片。
3. **「本地免 Key」服务商在「编辑」弹窗里是死路**（本片**新引入的入口**会走到它）：
   `piper` / `local-diffusion` / `comfyui` 没有 Key 可填；「添加服务商 → 预设目录」那条路能启用它们
   （新增态会显式上送 `enabled`），但**编辑态不会**（`useModelProviderCrud.js:393` 只在 `!isEditing` 时上送）
   ⇒ 本片新增的「整卡可点 → 编辑」入口对这类卡片无效：填完保存，状态仍停在「未配置」。
   判据本身是对的（没有 Key 可填 ⇒ 不是「已停用」），已用单测锁住；
   但这条**新入口对它们无效**这件事属未闭合项。
4. **「Key 解密失败」同样落到「未配置」**：后端 `_getApiKey` 解密异常时返回空串 ⇒ 掩码串为空
   ⇒ 判成「没配过」。该形态下卡片的「测试连接」按钮是禁用的（前置条件是 `is_configured`），
   用户无法从界面直接诊断 ⇒ 已知盲区，已在 `utils/provider-status.js` 顶部写明。
5. **键盘可达性合同的扫描器盲区未修**（两处：多行开始标签 + 模板边界按第一个
   `</template>` 截断 ⇒ **52/192 个 .vue 的扫描域被截断**；真实站点 72 而非 31，
   未补全的 42 而非 13，漏 38 个去重站点）：修它要先定政策（42 个新站点 vs
   台账硬上限 13），属独立工程 ⇒ 本片只登记，不擅动。
6. **`card-active` 是当前没有对应样式的类**，`card-disabled` 今天也**不可达**（「已停用」无入口）
   ⇒ 实际效果是全应用再无灰度卡片（未配置卡片从 60%+灰度变成 88% 全彩）。这是**有意的可见变化**，
   但它没有用例锁住 `cardStateClass` 的分支（CSS/视觉层零覆盖是本片的已知弱面），
   已在 QM-4 待办里登记为逐态走查项。
7. **依赖公告的收口已移交、本片不闭合**：本 PR 最终**不携带**任何基线 / 锁文件改动 ⇒
   fast-uri ×4 + undici ×3 由 **#4361** 收口，body-parser 两条线 / express / electron / zod 由
   新开的依赖升级片 `fix-dep-advisories-upgrade` 收口。
   在这两片落地前，主干基线里这批条目仍是 `decision: upgrade-tracked`（顶层 `reviewBy` 2026-12-31）
   ⇒ 属**已移交**，不是**已闭合**；本片不假装它闭合了。

## CHANGELOG 条目

# feat(模型设置): 模型服务商卡片状态改三态并可点开直接配置（model-provider-status-tristate）

- 模型服务商卡片的状态标签不再把「从没配过 API Key」说成「已禁用」—— 改为三态：**未配置 / 已启用 / 已停用**。
  此前它直译数据库的 `enabled` 布尔位，而该位在系统里是「有没有可用 API Key」的派生位、不是用户的禁用开关，
  界面上也根本没有启用/禁用的按钮 —— 于是一张从没碰过的卡片被贴上了「已禁用」。
- 状态判据抽成单一实现并单测：判据落在**配置事实**上（是否已配置、是否还留着可用 Key），
  不再落在内部布尔位上；因此「配过但被停用」与「从没有 Key」终于能被区分开。
- 卡片视觉态跟着一起改：**只有「已停用」才灰度降级**；「未配置」保持正常色 ——
  它是一个待去配置的入口，不该长成被禁用的样子。
- **整张卡片可点**，直接打开配置界面填写；卡片内的测试 / 编辑 / 设为默认 / 删除按钮、
  以及多模态「能力默认」chip 都不会误触。
  名称本身改成真正的按钮，键盘可 Tab 到达（卡片没有整体挂 `role="button"`，
  否则读屏软件会把卡片内的操作按钮一并当成装饰性内容吃掉）。
- 旧的「已启用 / 已禁用」两个徽标文案已删除，词表只留一套说法（中英成对维护）。

## learnings

### lesson: translated-status-label-must-mean-user-action

**现场**：模型服务商卡片对「从没配过 Key」的卡片显示「已禁用」。追下去发现 `enabled` 在后端是
「有没有可用 API Key」的派生位（预设种子行写死 0、存了 Key 才置 1），而 UI 上根本没有启用/禁用的开关。

**根因**：视图把一个**内部派生位**直接翻译成了用户语言。派生位表达的是「系统当前会拿它做什么」，
用户语言要表达的是「我该做什么」—— 两者在「配过但停用」时恰好同形，在「从没配过」时恰好不同形，
于是直译必然在其中一个方向上说错话。

**可复用的 N 条**：

1. 展示层翻译一个布尔字段前，先问一句：**这个字段是用户的意图，还是系统的派生状态？**
   派生状态要翻译成「用户该做什么」，而不是「系统算出了什么」。
2. 派生位与用户意图**不同形**时（这里是「没配过」vs「配过但停用」），直译一定会错；
   要么在字段旁补一个表达意图的字段，要么把判定收进一个能同时看见两者的模块。
3. 判定一旦散进视图模板，就没有第二处能发现它说错话 —— 把它收进**可单测的纯函数**，
   顺带让「视图只做状态→文案的映射」这条边界变得可读。
4. 同一张卡片上出现两套说同一件事的词（「未配置」的 Key 字段 + 「已禁用」的状态标签），
   就是判据与现实不同源的信号：**同义的两套词汇留着必然漂移**，该删的那套要删。
5. **「同一个判定、两个调用点」要分别锁**。只锁一个，另一个改回旧写法测试照样全绿 ——
   原始缺陷能原样复活，而且没有任何东西会响。
6. **断言「点了没反应」之前，先确认「点真的发生了」**：disabled 按钮不派发 click 事件，
   于是「没开弹窗」恒真；这条用例在删掉防护之后照样绿，是**假的安全感**。
   用例里要显式断言前置条件（按钮 enabled），并反向断言「这次点击确实做了事」。
