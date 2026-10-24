---
record: ux-audit-label-for-wiring
task: UX 审计阶段 4.3 机制层 —— UiInput 拿到 id prop + UiField/UiInput 之间建立「控件登记自己的 id」通道，标签只在真的有控件认领时才输出 for
date: 2026-10-19
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src/components）+ 文档，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：label ↔ 控件的 id 通道（ux-audit-label-for-wiring，2026-10-19）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | `scripts/start-mp-task.ps1 -TaskName ux-audit-label-for-wiring` 建独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-label-for-wiring`（非 C 盘）；依赖三步实跑（install → ensure-electron → `verify-worktree-deps OK`），分支回读 `rev-parse --abbrev-ref HEAD` = `ux-audit-label-for-wiring` |
| 前置事实核实（决定判据方向） | ✅ | 读源码确认缺陷形状而不是照审计字面改：`UiField.vue:8` 的 `:for="forId"` 里 `forId` 是**可选 prop**（默认 `''`）；`UiInput.vue` 的 `defineProps` 里**根本没有 `id`** ⇒ 调用方写的 `id="x"` 作为属性透传落在根 `div` 上，`<input>` 没有 id。**第二条比第一条更糟**：它让"我记得传 forId 了"这种自我安慰完全失效 |
| 自测 | ✅ | `vitest run src/components/UiField.label-association.test.js src/components/UiField.test.js src/components/UiInput.test.js` → **31 passed / 0 failed**；`vitest run src/components`（整目录 67 文件回归）→ **721 passed / 0 failed** |
| 反证（5 条） | ✅ | LA-1 `for` 不再 `|| undefined`（渲染 `for=""`）/ LA-2 控件不登记 / LA-3 id 写成常量 / LA-4 控件不输出 id / LA-5 控件回读父级标签目标 ⇒ 全部 CAUGHT 且各红在指名用例；控制跑 rc=0 passed=11；两份被测文件还原后逐字节相同 |
| 静态门禁 | ✅ | `check-locale-sync --cjk` PASS（新增中文只在注释与测试用例名里，无新增用户可见文案）；`check-debt-budget` 见下（提交后复跑）；`check-record-qm5-rows` / `check-pr-exec-record --mode=enforce` 提交后跑 |
| QM-1 打包 | N/A | 只改 `apps/desktop/src/**` 渲染端组件，未触碰 `electron/**` 与 `packages/rpa-engine/**` |
| QM-4 视觉 | **像素中性，且这是本批的设计前提** | 新增的只有 `id` 与 `for` 两个属性，不改盒模型/颜色/文案 ⇒ 不动基线、不触发基线新鲜度门禁。若把 label 换成"包一层 `<label>` 元素"就会改 DOM 结构 ⇒ 那一版不做 |
| QM-6 双模型 | 未跑 | 本机无 CCG（pre-commit 实测打印「未找到 CCG，已跳过」），如实登记未执行 |
| 第一性原因（QM-5 ①） | ✅ | 不是"调用点忘了写 forId"，而是**组件没有给调用点可用的正确写法**：`UiInput` 不接 `id`，所以"传 forId"这条路从控件侧就是断的；能写对的只有那些把 label 和控件都摊开手写的地方。缺的是**机制**，不是纪律 |
| 逃逸分析（QM-5 ②） | ✅ | ① 像素门禁看不见 `for`/`id`（非视觉属性）；② 既有 `UiField.test.js` / `UiInput.test.js` 断言的是 label 文本、错误位、透传行为，**没有任何一条读 `for` 与 `id` 是否配对**；③ 本次要接的 label 棘轮（`check-label-association.js`）住在**尚未合并的 PR #4011 分支上**，它量的是源码里"裸 `<label>` 没有 for"，对"有 `:for` 但指向空气"同样失明 —— 所以光靠那把棘构不够，必须另有运行时断言 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `uiFieldControlId.js`（单一 Symbol 通道，注释写明"宁可没有 for，也不能有指向不存在元素的 for"）；`UiField` 提供 `claim` 且 `resolvedForId = 登记值 || forId`；`UiInput` 新增 `id` prop + `useId()` 自动生成 + 把自己的 id 登记上去，`<input>`/`<textarea>` 都输出 id；11 条行为锁（含"首帧无 for、下一帧成立"与"多控件 id 互不相同"） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 关联的**唯一**实现在 `uiFieldControlId.js`，结构锁要求两个组件都 import 它、key 文件里只允许一个 `Symbol(`、且禁止 `provide(inject(` 内联 Symbol（两份通道定义 = 组件各自渲染但关联永不建立，那种失败是静默的）；② 结构锁额外禁止控件回读 `channel?.target` —— 这条不是理论：我第一版就是这么写的，症状是**同一 UiField 里第二个控件复用第一个的 id**（HTML 重复 id），是 LA-5 那条变异把它钉住的；③ 11 条锁 + 5 条变异全部实跑留痕 |

## 一、交互逻辑与显示项（用户/开发者各看到什么）

**用户侧**：点击表单标签现在会把焦点送进对应输入框（此前只有手写 `for`+`id` 的那部分字段可以）；
读屏软件在字段上会念出标签文本，而不是"编辑框 未标注"。视觉上**零变化**（这是刻意的，见 QM-4 行）。

**显示项**：DOM 上新增 `<input id="…">` 与 `<label for="…">`；`id` 取值有三种来源，优先级固定：
1. 调用方显式传的 `UiInput :id`；
2. 没有则用 Vue `useId()` 生成的实例稳定 id（同一实例内不变、跨实例不重复）；
3. `UiField` 的 `forId` **不参与控件 id 的生成**，它只在"槽里没有控件"时作为标签的目标生效。

**数据校验**：本批不新增校验逻辑；`maxlength` 等既有边界不变。

## 二、为什么 `forId` 不再覆盖槽内控件（一条容易写反的判断）

直觉写法是"`forId` 是权威，控件去用它"。我第一版就这样写，测试立刻给出两个红：

- 同一 `UiField` 里两个控件都读父级目标 ⇒ **两个 id 相同** ⇒ 浏览器只关联到第一个，第二个是坏关联；
- 而"标签指向 `kw-input`、控件却是 `v-3`"这种状态，本来就是我正在修的那个缺陷的镜像版本。

所以最终口径反过来：**登记优先于 `forId`**。`forId` 的正当用途是"标签描述的控件不在我的槽里、在别处渲染"，
那种情形没有登记发生，`forId` 原样生效（有一条用例专门锁这半边）。
一个 `UiField` 里放多个控件时只有第一个被标签指向 —— 这与 HTML 语义一致（一个 label 只能描述一个控件），
**不是遗漏**；第二个控件仍有自己的 id，可被 `aria-labelledby` 之类的显式关联使用。

## 三、时序：首帧没有 `for`，下一帧有 —— 为什么可以接受，以及怎么锁

父组件先渲染、子控件在挂载阶段才登记，所以严格存在一个"标签还没拿到 for"的帧。
可接受的理由：`for` 不是可视属性，中间态不会造成闪烁或布局跳动；**不接受**的是"以后有人把它改成一次性渲染"，
于是把两帧分别写成断言（`首帧 for 缺席、登记后下一帧成立`）：摘掉登记 ⇒ 两条都红（LA-2 实测红 5 条）。
另有一条 `mountFieldAwait` 的注释显式声明"这个 helper 不是用来掩盖时序的"，避免下一个会话把它当成"测试要 await 所以生产也要 await"。

## 四、本批刻意没做的事

1. **没有迁移任何调用点**（139 处孤岛 label 的收敛批次）。本批只交付机制：机制之前"想写对也写不出"，
   之后每处收敛是"删掉手写 label + 换成 `<UiField label=…>`"的一步活。
2. **没有去改 `check-label-association.js` 的基线** —— 那把棘轮住在 PR #4011 的分支上，本分支的 main 里还没有它；
   而且它量的是源码里裸 `<label>` 有无 `for`，对"有 for 但指向空气"结构性失明（见逃逸分析 ③），
   所以**不要**指望用它验收本批。两边合并后应由那个批次重取读数。
3. **没有把 `UiInput` 内部 label 改成包裹式**（`<label><input/></label>`）：那会改 DOM 结构 ⇒ 触发像素门禁，
   与"像素中性"的前提冲突。现在的 `for`/`id` 配对已经满足关联要求。
4. **没有加 `aria-describedby`（hint 关联）**：与本批的"标签关联"是不同一条契约，混做会把两件事的回归范围叠在一起。

| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注的 `(#[NNNN])` PR 号）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；把状态列预写成 `PASS` 会被 `prematureClaims` 判红。**这一行的存在本身是判据**：`check-gate-record-debt.js` 对「整块缺 远程同步 行」的新记录当场判红，frontmatter 的 `sync_*` 三字段只是意图声明、不能替代它。
