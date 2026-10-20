---
record: prd-a11y-contract
task: 把键盘可达与可访问名四组行为写成 PRD 合同（显示项/交互逻辑/数据校验/提示文字），并补 CHANGELOG
date: 2026-10-19
---

## 本次执行记录：PRD 新增「键盘可达与可访问名合同」（prd-a11y-contract，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 就地编辑 + 经 PR 落地 | 纯文档变更（`01-docs/PRD.md` 追加一节 + `CHANGELOG.md` 置顶 + 本记录），不触运行时路径、不动 `.github/workflows/` 与 `CI_IGNORED_PATHS`。做法：共享根 main 上 commit → `git branch prd-a11y-contract` → `git reset --keep origin/main` → 推分支开 PR。判定证据：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（提交后取证）读数写入 PR 正文 |
| 内容与实现对齐 | PASS | 本节写的每条判据都有对应落点：焦点环双档对比度 6.05/4.78/4.30 与"134 处 class 只带变体类、基类零覆盖"来自 `src/styles/focus-ring.test.js`（12 条）与真 Chromium 计算样式取证；「CLI」标签与分组划归产品决策同该 PR 记录；可点元素 18/13/域=31 与"leaf 角色 3 处撤销"来自 `clickable-roles.contract.test.js`（7 条）+ `clickable-roles.behavior.test.js`（3 条）；菜单键盘 13 条来自 `MpSidebar.more-keyboard.test.js`；标签关联六条数据校验来自 `label-association.contract.test.js`（19 条）+ `element-plus-attr-forwarding.test.js`（3 条），EP 丢 `id`/转发 `aria-labelledby` 为 mount 实测；孤岛 139→127、23 个文件与 `UiField` 26 处为当场扫描读数；令牌 6 条来自 `token-scales.test.js`。**记录里的数字一律取实跑输出，不引用记忆** |
| 本次追加（外部评审 C1 之后改写本节） | PASS | 评审把本单元初版的 `UiField` 设计（容器自造 id 经 slot 下发）判为错：slot 里的控件是另一个实例、另一个 `useId()` 值 ⇒ 发射出来的是一条指向不存在元素的**死 `for`**。故本节 ① 把规则 4 拆成规则 4+5，新增「容器不得代调用方造 id 当标签目标」并给出两种合规形态（控件反向 `Symbol` 登记认领 / 调用方显式给值才发射），同判据写成「宁可没有 `for`，也不能有一个指向不存在元素的 `for`」；② 规则条数从五条改为六条；③「存量与节奏」补上「缺失」与「指空」必须分两态，并如实登记该形态**不在**静态孤岛计数域内（那 26 处是 `<UiField label>` 的 prop、不是字面 `<label>` 标签），动态 `:for` 的指空目前只有运行时 DOM 行为锁覆盖；④ 验收锚点里 `label-association.contract.test.js` 的条数 20→19，并加一句"条数是当日读数、判定以门禁当场通过数为准"，防止文档数字被当成验收证据。代码侧修复与本节改写在**不同 PR**：本 PR 只动文档，实现批在 `ux-audit-label-for` |
| 行尾与 diff 对账 | PASS | `01-docs/PRD.md` 工作副本纯 CRLF（改前实测 `crlf=20335 bareLF=0`，且文件以换行结尾），逐行保留原行尾；`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐文件相等；收尾对 `PRD.md` / `CHANGELOG.md` 做旧行多重集对账（旧行零丢失，无点名删除） |
| 品牌残留 / 绝对路径 | PASS | `node scripts/check-no-brand-residue.js` 与 `node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD`（差量模式，磁盘域 `--all` 会因他会话未跟踪文件判红，属判定域分叉，见同日 `agents-a11y-gate-rules` 记录） |
| 文档同步（doc-gate） | 见 PR | 新增章节属"实现已存在、文档补口径"方向，不引入新的规格↔代码缺口；`openspec-sync-check` 读数在 PR 侧 checks 里 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由主干历史（squash 尾注 `(#NNNN)`）推导归属 |

### 这一节解决的是什么（为什么不是"再写一遍审计报告"）

审计稿（`01-docs/UX-AUDIT-2026-10-17.md`）记的是**发现了什么**；PRD 要记的是**产品承诺是什么**。四组行为此前只有代码与测试，没有口径，于是出现三类反复：① 实现者把焦点环写在基类上（覆盖为零而不自知）；② 有人为了键盘可达给容器补 `role="button"`，反而把容器里的真按钮从无障碍树上抹掉；③ 有人写了 `for`+`id` 却因组件不透传属性而长期无效。这三类的共同点是**"做了"与"用户拿到"之间缺一条可核对的合同**，本节就是那条合同：显示项给数值、交互逻辑给时序、数据校验给判据、提示文字明确"本批不新增文案"。

### 遗留（不假装已闭合）

- 本节引用的实现分三类状态：**已合并**（菜单键盘 13 条）、**在途 PR**（焦点环、可点元素、标签关联机制层）、**本地未推**（令牌双轨、标签关联棘轮与 EP 契约，因 QM-6 dual 通道本机交付不了 + 与并发 PR 重叠待 reconcile）。PRD 写的是目标口径，不等于每条都已在 main 上生效；门禁代码到位前，判据由本节文字与对应分支的锁共同持有。
- 「焦点点击不显示焦点环、键盘才显示」是浏览器 `:focus-visible` 语义，产品侧接受为现状（非缺陷），但读屏用户拿不到名称是真缺陷，已在第四节列为必须项。
- 存量清理节奏（127 处孤岛 label、26 处 `UiField`、571 处原生 `<button>` 收敛）仍按批次推进，本节不设时限承诺。
