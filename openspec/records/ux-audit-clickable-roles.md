---
record: ux-audit-clickable-roles
task: 阶段 4.4 首批——非按钮可点元素的键盘可达性（含"leaf 角色会压掉子树"的反向判据）
date: 2026-10-19
---

## 本次执行记录：非按钮可点元素键盘可达性（ux-audit-clickable-roles，2026-10-19）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/**`）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-clickable-roles`、裸分支 `ux-audit-clickable-roles`；`rev-parse --abbrev-ref HEAD` 实证分支名，基线取当场 `origin/main`（`git fetch` 后）。取证按分支名与本 PR 号，不写本机绝对路径 |
| 第一性原因（QM-5 ①） | ✅ | 阶段 4.4 的域此前从未被清点过：审计稿写的是"49 处非 button 点击"，但**没有口径**。本批先建口径再动手，结果发现任何"看起来对"的口径都会把域搞错 3 倍（见 §二） |
| 逃逸分析（QM-5 ②） | ✅ | ①**审查层**：审计里这条只是一行任务描述，没有"域如何计算"的定义，所以没人能判断"改完了没有"；②**单测层**：全仓对这些元素的断言只有 `trigger('click')`（实测 `TagSuggester.test.js:156/172/194` 全是 click），即"键盘路径有没有通"在测试里**根本不可表示**；③**像素层**：role/tabindex 不产生视觉差异，像素门禁对此结构性失明 |
| 系统性漏洞（QM-5 ③） | ✅ | 测试场景缺失（无键盘激活用例）+ 判据缺失（无"leaf 角色不得吞掉可见可聚焦后代"的守卫） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 18 处补 `role="button" tabindex="0" @keydown.enter.prevent/@keydown.space.prevent`（表达式逐字镜像 `@click`）；新增 `src/clickable-roles.contract.test.js`（7 例：域清点 / leaf-role 反噬 / 逐字镜像 / tabindex / 台账双向 / 规模上界 / 原因非空）与 `src/clickable-roles.behavior.test.js`（3 例：Enter+Space 真触发同一 emit，含"只有 @click 时 Enter 必须不出事件"的负控）。现场：`src/views|components|features` = **3529 passed / 2 skipped（218 files）**；`build:vue` rc=0 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①台账**只能缩小**、未登记即红、键漂移即红；②反向判据"已补 role 的元素不得有可见可聚焦后代"入锁，并用**变异 K3 把我撤销掉的错误形态重新造出来**验证它会红；③learnings 沉淀"leaf 角色压子树"与"按名字猜分类必出假阳性"两条 |
| 行尾与 diff 对账 | ✅ | 三个共享写面与全部源文件改前改后各测一次 `crlf/bareLF`：改后 `bareLF=0` 且 `git diff --numstat` 与 `-w --numstat` 逐字一致；追加/置顶均从**上文首行**取行尾并跳过末尾空元素（该写法事故链见 `ux-audit-focus-ring` 记录 §六） |
| QM-1 打包 / QM-4 视觉 | N/A / 已如实说明 | QM-1：未触碰 `apps/desktop/electron/`、`packages/rpa-engine/`。QM-4：`role`/`tabindex`/`@keydown` 不进入计算样式，像素基线不受影响；真正覆盖本批的是行为用例（键盘激活触发同一 emit），**不是**像素门禁 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未探测到可用 `codeagent-wrapper` 通道（`~/.claude/.ccg/config.toml` 的 `[routing]` 本会话未验证）；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 不回填：合并即由 `scripts/lib/merge-ledger.js` 按主干历史推导收口 |

- 保留门禁：判定 docs-only=false（含运行时代码）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体按 2026-10-15「旧载体冻结」政策零改写）| 远程同步 由门禁推导，不回填

## 一、本批做了什么

对"带 `@click` 但不是 `button`/`a`"的裸元素补键盘可达性：`role="button"` + `tabindex="0"` + `@keydown.enter.prevent` / `@keydown.space.prevent`（处理器表达式与 `@click` **逐字相同**）。改动 18 处，分布在 15 个文件；其余 13 处**带原因登记为欠账**（不擅动）。

## 二、域是被"自我否证"清出来的（三次口径）

| 口径 | 站点数 | 为什么不对 |
|------|--------|-----------|
| v1 按类名前缀（含 `btn` 就算按钮） | 150 | ⛔ 109 个假阳性：`UiButton`（165 处用法）、`el-button`、`router-link` 内部渲染原生 `button`/`a`，键盘本来就能用 |
| v2 按**挂载元素**分类 + 组件按其根节点渲染什么排除 | 41 | 仍偏：混进了 `@click.self` 遮罩、`<th>` 这类"不该拿到 role"的语义 |
| v3 v2 + 统一去重键 + 引号感知的开始标签聚合 | **31** | 采用。其中 18 本批改、13 登记 |

关键取证：`UiButton` 的 `tag` prop 默认值实测为 `button`（不是猜的），故它是原生控件；`<span class="ui-btn-spinner" aria-hidden>` 是装饰节点，按类名口径会被误算成"应有焦点环"的缺口。

## 三、最贵的一条：`role="button"` 会把子树压成 presentational

我第一版给 21 处加了 role，其中 3 处元素**内部有可见真按钮**：

| 位置 | 内部可见控件 | 若加 role 的后果 |
|------|-------------|----------------|
| `CreateView.vue:85` 上传区 | `<button class="remove-btn">`（移除图片） | 该按钮从 a11y 树消失，视觉上仍在 |
| `CreateView.vue:98` 音频上传区 | `<button class="remove-btn">`（移除音频） | 同上 |
| `CreatorMonitor.vue:353` 创作者条目 | 3 个按钮（立即检测 / 暂停 / 取关） | 三个动作对读屏用户整体消失 |

已全部撤销（撤销后逐行核对：`CreatorMonitor.vue` 回到零改动，`CreateView.vue` 只剩 128 行那一处），并登记为欠账。**这是"修无障碍"里最容易顺手犯的错**：`button` 是 leaf 角色，加语义的动作同时是抹掉子树语义的动作。

## 四、13 处欠账的分组原因

- `<th>` 排序表头 ×4（`ViralLibraryTable.vue`）：`role="button"` 剥夺单元格语义与 `aria-sort` 承载；正解是 th 内放真 `<button>`（结构改造）。
- `<h3>` 折叠头 ×1（`ReplayTimeline.vue`）：失去 heading 跳读；正解是标题内放 button。
- 遮罩 `@click.self` 关闭 ×6：键盘等价物是 Esc + 焦点陷阱；给遮罩加 role 会**把整个对话框子树**压掉。
- 上传区 ×2：见 §三。

## 五、反证（5 道，全部指名变红）

控制趟 `Tests 7 passed`，`RESTORED_OK=true`（三文件逐字节回读等于备份）。

| 变异 | 变红的用例 |
|------|-----------|
| K1 删掉某站点镜像的 `@keydown.space` | 键盘处理必须逐字镜像鼠标处理 |
| K2 摘掉一个已补站点的整组属性（变成未登记缺口） | 每一处未补全的站点都必须登记，且台账不得陈旧 |
| K3 **重造 §三 那个被撤销的错误形态** | 已补 role 的元素不得含可见可聚焦后代 |
| K4 清空台账（伪造"没有欠账"） | 同 K2 那条（未登记侧） |
| K5 台账里伪造一条不存在的键 | 同 K2 那条（陈旧侧） |

驱动自身修过两处（记录以免下一个会话重踩）：变异 K4 第一版注入的是"再声明一个同名录音"式假常量 ⇒ 测试文件变成语法错、`×` 名单为空，那不是反证而是**探针自毁**，故驱动单列 `INVALID(未被收集)` 一档；行为用例第一版拿 `mocks.$t` 顶 `useI18n()` 直接抛 `Need to install with app.use`，再补 pinia 又拖进 `platformStore.load()` ⇒ 改判据对象为无 store 依赖的 `SceneCard`，判据不变。

## 六、顺带发现的真实缺陷（本批不修，已登记）

`PodcastScriptEntry.vue` 的遮罩写的是 `@click="onCancel"` 而非 `@click.self`（同族其余四例均为 `.self`）。裸 `@click` 挂在铺满的遮罩上 ⇒ **对话框内部的点击会冒泡触发取消**，属数据丢失级交互缺陷。不在本批动，因它归浮层交互合同（需与 Esc、焦点陷阱一并改并补行为锁）。
