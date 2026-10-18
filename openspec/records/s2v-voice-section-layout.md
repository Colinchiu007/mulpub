---
record: s2v-voice-section-layout
task: 故事讲述流水线「声音」区拆三个子分区（旁白设置/背景音乐/音色克隆）并卡片化，除「基础」外折叠区默认收缩，其他选项区统一优化
date: 2026-10-18
---

## 本次执行记录：声音区子分区布局与默认收缩（s2v-voice-section-layout，2026-10-18）【混合 PR · 运行时代码】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（apps/desktop 运行时代码 + 文档 + openspec change + locale），`classify-docs-only` 必判 false。worktree 位于 `<仓库父目录>/mp-worktrees/mp-s2v-voice-section-layout`（D 盘非 C），裸分支 `s2v-voice-section-layout`，起点 origin/main `37cf701b5`；经 `scripts/start-mp-task.ps1 -TaskName s2v-voice-section-layout` 创建，`verify-worktree-deps` OK（消费方解析通过 11 项）；`pre-code-edit-guard` 先在共享根拦截（exit 1）后才建 worktree；共享根保持 main clean |
| 第一性原因（QM-5 ①） | ✅ | `.config-span-2` = `grid-column: span 2`，而 `.s2v-field-grid` = `repeat(auto-fit, minmax(min(280px,100%),1fr))` ⇒ 列数是容器宽度的函数：2 列时 span2=满宽（巧合）、3 列时 2/3、4 列时半行宽——用户看到的正是 4 列那一格。**用列数相关的量表达列数无关的意图**。次要根因：声音区四类控件平铺同一扁平栅格，无二级容器；栅格分列是纯几何行为，不反映语义，于是语义无关的「背景音乐音量」与「音色复制 / 克隆」被排到同一行 |
| 逃逸分析（QM-5 ②） | ✅ | 单元测试：`S2vConfigPanels.test.js` 只断言「控件在哪个折叠区」（BGM 归位，2026-10-17），零断言涉及栅格内排列或子分区结构；视觉回归：`create-story2video-detail` 走默认收缩路径，声音区控件根本不渲染 ⇒ 像素基线对展开态完全失明；审查：`.config-span-2` 自 2026-08-09 防撑宽修复引入，焦点在「长内容不溢出」，未追问「满宽语义是否依赖列数」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`S2vConfigPanels.vue`：声音区拆 `voiceNarration`/`voiceBgm`/`voiceClone` 三个子分区，各带独立 `.s2v-field-grid` + `data-testid`；`s2vVoiceCapability` 三分支全部归克隆子分区。②`video-creation-forms.css`：`.s2v-subgroup` 卡片化（背景+边框+圆角+padding）+ 标题间距 + 卡片内栅格去 padding + 窄屏收紧；「高级」区两个既有子分组共用同类名一并升级。③`CreateView.vue`：`s2vSubgroupLabel` 补三键；`s2vOpenSections` 默认态注释显式化；快照恢复改「先显式复位默认态再只打开 expandedGroups 列出的分组」。④locale zh/en 各 +3 键。⑤回归锁 7 例新 + 1 处既有断言范围收紧（跨文件影响）|
| 变异反证 | ✅ 1/1 CAUGHT | M1：把 `S2vConfigPanels.vue` 里 `voiceClone` 子分区的 `<div class="s2v-subgroup" data-testid="s2v-subgroup-voiceClone">` 改回扁平结构（去掉子分区包裹，克隆面板直接回到 `s2v-field-grid`）→ `vitest run -t "音色复制 / 克隆"独占满宽子分区` 当场红（找不到 `s2v-subgroup-voiceClone`）；还原后复绿，`git diff --numstat` 复核仅含本 PR 预期改动 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①机械锁：7 例面板结构断言锁死子分区顺序/testid/归属，其中「克隆分区内不得出现 `s2v-bgm-volume`」直接对应用户报告的原始症状；跨文件影响（全页面 `findAll('.s2v-subgroup-title')` 会算进声音区三个子分区）以既有 `CreateView.test.js` 用例范围收紧承接。②learnings 置顶四条：`span N` 不是满宽 / 扁平栅格无语义 / 恢复默认态必须显式 / 像素基线对折叠内容失明。③EverOS 独立知识条目。④PRD §13 写成实现合同（DOM 结构/视觉分隔/默认收缩/数据校验/测试合同/验收 8 条）|
| 行尾与 diff 对账 | ✅ | 提交后以 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐值相等复核；`S2vConfigPanels.vue` / `create-view.css` / `video-creation-forms.css` / `CreateView.vue` / `CreateView.test.js` / locale 均未出现全文件重写形态（CRLF 保留） |
| 行数门禁（本轮两次真红，均已修） | ✅ | ①`create-view.css` 在 origin/main 上 494 行，加 14 行样式 → `check-max-lines` 报 `NEW_OVER_LIMIT: 506 行 >= 500`。正解**不是抬基线**，而是把样式落到 `video-creation-forms.css`（该文件头注释声明的存在理由即「不把 create-view.css 推过 500 行预算线」），`create-view.css` 只留原两行 + 指路注释（净增 0 行样式）。②`CreateView.test.js` 在 origin/main 上已超挂账登记值 **199 行**（容差 200），本次新增 2 行断言刚好推到 201。按「存量膨胀应拆分，不应改基线」，正解是**减行数**：214 处逐处复制的 `mount(CreateView, {global:{...}})` 样板收敛为顶层 helper，净减约 290 行。终态 `check-max-lines` rc=0（`filesOver500` 96→95）、`check-debt-budget` rc=0 |
| 接线棘轮 | ✅ | 未新增独立测试文件，全部改动落在既有已接线测试文件（`S2vConfigPanels.test.js`、`CreateView.test.js`）；`check-unwired-tests` 域内无新增未接线测试 |
| QM-1 打包 | N/A（零 electron/**、零 packages/rpa-engine/**） | 本次改动全部在 `apps/desktop/src/**`（渲染层模板 + CSS + locale + 测试），不触碰主进程与 rpa-engine ⇒ 按 AGENTS.md QM-1 触发条件不适用。仍实跑 `build:vue` rc=0 证明模板可编译 |
| QM-4 视觉 | ✅ 20/20 + 两轮探针 | 像素门禁浅色 20/20 全通过（含 `create-story2video-detail`，**未更新任何基线文件**——默认收缩态下声音区不渲染，基线逐字节不变）。展开态用一次性 Playwright + e2e fixture 探针取证：三个子分区满宽 982/982/920px、卡片底 `rgb(255,255,255)`、1px solid 边框、12px 圆角、`padding:12px 14px 14px`、`voiceOverflow=false`；**CSS 迁到 forms 文件后复核过第二轮**，读数一致。探针走 `safe-delete.js` 删除。**残留**：展开态无像素回归覆盖（已登记 PRD §9.3）|
| QM-6 CCG 双模型外部评审 | 见判定器 | 以 `.ccg/reviews/<sha>.json` 产物为准（pre-commit 生成） |
| 测试全量（受影响面） | ✅ 134 例 + 307 例 | `video-creation/` 全目录 + `story2video-ue-contract.test.js` + `s2v-options-autosave.test.js` = **13 文件 134 例全绿**；`CreateView.test.js` **307/307**。首轮曾跑 `src/views/` 全目录 86 文件 1954 例全绿；此后本文件改动仅剩 mount 样板收敛 + helper 提升，二者均被 307/307 覆盖，故未重跑全目录 |
| 静态门禁 | ✅ | `check-locale-sync --cjk` rc=0（基线 1331 条 / 当前 1189 条，无新增硬编码中文）；`--keys` rc=0（2126 个使用中 key 均存在于 zh/en）；`eslint`（6 个 js/vue 文件）rc=0；`build:vue` rc=0；`check-max-lines` rc=0；`check-debt-budget` rc=0 |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导，不手写状态词 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅（零品牌名词） | 文档同步 ✅（PRD 详版 + §13 + openspec change 三件套 + spec delta） | 远程同步 由门禁推导

### 关键决策（design 摘要）

- **选「子分区容器 + 卡片样式」而非改 `.config-span-2`**：用户诉求是「三类各自一行 + 视觉分开 + 其他区统一优化」，只把 `span 2` 改成 `1 / -1` 只解决 1/3；方案对比表（A/B/C/D）写入 PRD §3。
- **子分区复用 `.s2v-subgroup` 而非新建类**：「高级」区已有同构结构，复用即统一（诉求 5）；新建 `.s2v-voice-subgroup` 会造成两套并行样式，正是本次要消除的问题。
- **「高级」区连带升级是预期结果**：用户明确要求「其他选项区域一起统一优化」；已作为残留风险登记（若用户不认可可拆分类名）。
- **快照恢复加显式复位步骤**：消除「默认值变化 ⇒ 恢复结果反转」的隐含依赖，尽管当前默认值下两种写法等价。
- **不新增展开态像素基线**：会引入新基线文件 + 需肉眼核对，属独立变更；本 PR 用一次性探针取证并登记残留风险。

- **行数门禁红了就拆，不抬基线**：两处超限（`create-view.css` 494→506、`CreateView.test.js` 欠账 199→201）都用「换落点 / 收敛重复样板」化解，没有改任何基线登记值。这是 AGENTS.md「存量膨胀应拆分，不应改基线」的正面执行样例。

### 本轮真实返工（留证，不掩饰）

214 处 mount 样板收敛后，helper 一度定义在 `describe("CreateView", ...)` **内部**，而该文件有 20+ 个
describe 块共用。单跑 `-t "renders page header"` 通过（那个用例恰好在同一 describe 内），
全文件跑则 **254 例报 `mountCreateView is not defined`**。修法：helper 提升到模块顶层，307/307 复绿。

**教训**：批量文本替换后，验证必须在「定义的作用域」之外做——单跑一个用例证明不了其他 describe
能不能看到这个符号。已写入 `.agent_context/memory-s2v-voice-section-layout.md` 与 PRD §9.5。

### 遗留（不假装已闭合）

1. **展开态无像素回归覆盖**：`create-story2video-detail` 走默认收缩路径。声音区展开态排版、「高级」区新卡片样式都没有像素基线守护；本次仅一次性探针取证。长期守住需新增「展开声音区」像素用例（引入新基线文件，属独立变更）。
2. **「高级」区外观变化未与用户逐屏确认**：两个子分组从「虚线标题」升级为卡片，是统一优化的预期结果，但属用户可回退项。
3. **子分区与外壳的底色接近**：子分区用 `--color-bg-card`、外壳用 `--surface`，浅色下两者接近；若将来外壳加深底需重新评估两级层次。
4. **探针文件残留在 `D:\Temp\`**：`D:\Temp\s2v-voice-probe.cjs` 在仓库工作区之外，`safe-delete.js` 按设计拒绝跨区删除，故保留（无害，非仓库产物）。
