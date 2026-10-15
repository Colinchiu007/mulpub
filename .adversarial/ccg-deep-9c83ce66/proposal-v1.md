# 变更提案（自动生成，待对抗评审）

- base: `65b5afb86cbb46ef26ae9ae5af2a06ee18661232`
- head: `9c83ce66c8f5afdcb309cb4bdf9f31e6b1eb2ac7`
- 采集模式: `diff`
- 变更规模: 547 行

## 变更内容

```diff
diff --git a/.ccg/reviews/65b5afb86cbb46ef26ae9ae5af2a06ee18661232.json b/.ccg/reviews/65b5afb86cbb46ef26ae9ae5af2a06ee18661232.json
new file mode 100644
index 000000000..d6c323e59
--- /dev/null
+++ b/.ccg/reviews/65b5afb86cbb46ef26ae9ae5af2a06ee18661232.json
@@ -0,0 +1,23 @@
+{
+  "sha": "65b5afb86cbb46ef26ae9ae5af2a06ee18661232",
+  "layer": "diff",
+  "mode": "dual",
+  "reason": "变更 91 行（≤ 200）但命中 auth/数据库/加密：敏感内容 7 处",
+  "stats": {
+    "changedLines": 91,
+    "fileCount": 7,
+    "codeFileCount": 2,
+    "sensitivePathHits": [],
+    "plannedPathHits": [],
+    "sensitiveContentHits": 7
+  },
+  "stagedDiffHash": "136f54da4d6ebc750b2e7ca21f6b5a104b7702c85ec49c276da1c8eed48d7970",
+  "decidedAt": "2026-10-15T10:26:43.028Z",
+  "decidedBy": "ccg-review-decider",
+  "deepReview": {
+    "required": true,
+    "status": "pending",
+    "performedBy": null,
+    "findings": null
+  }
+}
\ No newline at end of file
diff --git a/.ccg/reviews/84b6123eb1f1410017208955f93ecf6098516b62.json b/.ccg/reviews/84b6123eb1f1410017208955f93ecf6098516b62.json
new file mode 100644
index 000000000..6616f0f88
--- /dev/null
+++ b/.ccg/reviews/84b6123eb1f1410017208955f93ecf6098516b62.json
@@ -0,0 +1,23 @@
+{
+  "sha": "84b6123eb1f1410017208955f93ecf6098516b62",
+  "layer": "diff",
+  "mode": "single",
+  "reason": "变更 74 行（≤ 200）且无敏感命中 → 走 §12.6 常规专家分派",
+  "stats": {
+    "changedLines": 74,
+    "fileCount": 2,
+    "codeFileCount": 2,
+    "sensitivePathHits": [],
+    "plannedPathHits": [],
+    "sensitiveContentHits": 0
+  },
+  "stagedDiffHash": "8bb8bd4f20649cc6d50d030a1abf6692aac7211495e06dddca2adc5172e97928",
+  "decidedAt": "2026-10-15T10:39:36.467Z",
+  "decidedBy": "ccg-review-decider",
+  "deepReview": {
+    "required": true,
+    "status": "pending",
+    "performedBy": null,
+    "findings": null
+  }
+}
\ No newline at end of file
diff --git a/01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md b/01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md
index fb28842d8..ede31857b 100644
--- a/01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md
+++ b/01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md
@@ -273,18 +273,65 @@ radio-group → base, radio      ← 漏 `el-radio` 本体的来源
 | **P4 样式闭包锁** | 按 `style/index.mjs` 重算闭包，断言插件 import 的 CSS **不缺**（且 theme-chalk 里文件真实存在） |
 | **P5 重复 import 锁** | 样式清单不得有重复行（本轮真出过重复：批量替换把 `el-radio-button`/`el-radio-group` 各写了两遍） |
 
-**两处存量的判定（对照实验，不背锅也不甩锅）**：`create-editor` / `create-pipeline`
-本地复跑 9.48% / 9.26%。做**对照实验**——临时在插件里加回
-`import 'element-plus/dist/index.css'`（= 修复前 CSS 超集）后复跑，两者仍是
-**9.48% / 9.26%**，与按需态**逐位相同** ⇒ 与本次样式改造**无关**。
-另有抖动证据：CI 同一 job 两轮数字不同（9.48% → 7.66%），且第一轮
-`podcast-channel` 未失败、第二轮才失败。
-故本 PR 只对「因闭包缺失而变差的 `podcast-channel`」负责并已修复；
-这两条的存量漂移**不在本 PR 范围**，且**刻意不用 `--update-baseline` 掩盖**
-（AGENTS.md 明令禁止）。
-
 **口径提醒**：本地像素默认阈值 **1%**，CI 用 **6%**（`PIXEL_THRESHOLD`）。
-故 `podcast-channel` 本地 2.05% 会判红、CI 6% 阈值下应通过——对照时必须注意口径差异。
+同一张图在两边结论可能相反——对照时必须先对齐口径。
+
+### 4.6 真根因（第二步）：多导了 `el-reset.css` —— 一次 9.48% 的像素回归
+
+补完样式闭包后 `podcast-channel` 由 21.63% 降到 2.05%，但 `create-editor`/`create-pipeline`
+**仍停在 9.48% / 9.26%**。定位过程（可复用）：
+
+1. **先排除三类常见解释**，每类都用判据而不是感觉：
+   - *缺选择器？* 解析全量 `index.css` 与按需集合的全部选择器求差集（1355 个），
+     再在真实页面上对每个差集选择器 `querySelectorAll` ⇒ **命中数 0**，样式规则集完整。
+   - *缺组件/指令注册？* 带 e2e 夹具逐路由采集控制台警告 ⇒ **无任何
+     "Failed to resolve component/directive"**。
+   - *抖动？* 同一状态连拍 3 次两两比对 ⇒ **0.00%（0 px / 14 px）**，渲染完全确定。
+2. **决定性一步：逐元素计算样式签名对比**。遍历全 DOM，为 348 个元素各打一份计算样式
+   签名（含 `font-family`/`color`/`background-image`/`::before`/`::after` 等 28 项），
+   两态逐项 diff ⇒ **唯一差异是 `font-family`**，命中 **32 个元素，全部是 BUTTON 及其子节点**：
+   - 我的分支：`"Noto Sans CJK SC", "PingFang SC", …`（继承应用字体栈）
+   - main：**`Arial`**（Chrome 对表单控件的 UA 默认值）
+
+**根因**：`element-plus/theme-chalk/el-reset.css` 里有
+`input,textarea,button{font-family:inherit}`，此外还改了
+`a`（链接颜色）、`h1~h6`（颜色/字号）、`p`（`line-height:1.8`）、`hr`、`sup,sub,small`
+等**全部原生元素**；而 **EP 自己的全量产物 `theme-chalk/index.css` 里根本没有这个文件**
+（实测在其内搜不到该规则）。因此单独导入它 = **悄悄改变应用自身的元素默认样式**，
+而这些在全量引入下**从未被改变过**。
+
+**修法**：从插件移除 `el-reset.css`（保留 `base.css` + `el-var.css`）。
+结果：三处全部归零 —— **create-editor 0.21% / create-pipeline 0% / podcast-channel 0%**，
+与 `origin/main` 逐位一致；本地完整像素套件 **19/20 通过**（唯一失败的 `collection` 1.44%
+经两态单跑均为 0% ⇒ 抖动，且低于 CI 阈值 6%）。
+
+**新增 P6 全量产物包含性锁**（只断言「不含 el-reset」是弱锁，换个文件又会重犯）：
+断言插件导入的**每个**非空主题文件的首个选择器都能在 `index.css` 里定位到，并显式禁止 `el-reset`。
+
+**可复用判据**：把「按需子集」与「全量」对齐时，不能只算**组件样式闭包**，
+还要核对**每个被导入的文件是否真的存在于全量产物中** ——
+「全量有、子集没有」是真缺失；**「子集有、全量没有」则是凭空多出的全局副作用**。
+
+### 4.7 我给出的两个错误结论（留证，不删）
+
+本任务中我曾把这两处红判成「与本 PR 无关」并写进了文档，**后来被自己推翻**：
+
+| 错误结论 | 当时的依据 | 为什么错 |
+|---|---|---|
+| `create-editor`/`create-pipeline` 是存量漂移/抖动 | 「临时加回 `element-plus/dist/index.css` 后数字逐位不变」的 A/B | 那次 A/B **只还原了 CSS，没还原 JS 装配**；真根因（`el-reset.css`）虽在 CSS 侧，却必须在「**完整变更集** vs main」的对照下才暴露 |
+| `podcast-channel` 21.63% 属环境差异 | CI 与本地数字不一致 | 把整套改动还原成 `origin/main` 后它是 **0%**；且同态连拍 0.00%，与抖动无关 |
+
+**更正后的决定性取证**：整套改动还原成 `origin/main` ⇒ **0.21% / 0% / 0%**；
+我的分支 ⇒ **9.48% / 9.26% / 2.05%**；同态重复 ⇒ **0.00%**。
+**教训**：A/B 必须还原**完整变更集**；只还原其中一层，会把另一层的因果误判成「无关」。
+
+### 4.8 排查手法本身也有坑（记录）
+
+- **`git checkout HEAD -- apps/desktop/src`（宽目录恢复）会连带丢掉该目录下所有未提交改动。**
+  我在做 A/B 时用它还原，结果把当时**尚未提交**的 `el-reset.css` 修复与 P6 锁一起抹掉，
+  随后一次像素复跑「又红回 9.48%」才发现。AGENTS.md 铁律 R2 明确禁止宽目录恢复
+  （「恢复只针对 `git status` 精确列出的文件」）——**这条不是纸面纪律，是这次真踩的**。
+  正解：A/B 前先把未提交文件备份/提交；恢复时逐个文件 `git checkout HEAD -- <file>`。
 
 ---
 
@@ -295,12 +342,13 @@ radio-group → base, radio      ← 漏 `el-radio` 本体的来源
 | 1 | **Bug 反思文档**（本文件） | `01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md` |
 | 2 | **bundle 契约进测试**：`main.js` 引入方式 + 按需清单 + Quill 注册位置三条机械锁 | `src/main.bundle-contract.test.js` |
 | 3 | **漏登记机械锁**：扫 src 全部 `<el-xxx>` 核对注册表 | `src/plugins/element-plus.test.js` P3 |
-| 4 | **样式闭包锁**：按 `style/index.mjs` 重算闭包断言不缺（QG Visual 那次红的直接教训） | `src/plugins/element-plus.test.js` P4 |
+| 4 | **样式闭包锁**：按 `style/index.mjs` 重算闭包断言不缺（QG Visual 第一处红的教训） | `src/plugins/element-plus.test.js` P4 |
 | 5 | **重复 import 锁**：样式清单不得有重复行 | `src/plugins/element-plus.test.js` P5 |
-| 6 | **首屏时序契约**：并行取数 + 懒触发 + 单点失败不扩散 | `src/views/Home.first-paint.test.js` |
-| 7 | **QM-2 新增检查项**：「新增全局 `app.component` / 顶层 CSS import 前必须问『它在几条路由上被用』；UI 框架默认全量引入是高频路径的性能地雷；**UI 框架按需样式必须导闭包而不是模板用到的组件**」 | `AGENTS.md` QM-2 |
-| 8 | **learnings 沉淀**：`全量引入在源码层测试里与按需完全等价` + `慢而不错对视觉回归结构性免疫`（与 10-14 同型第二次出现）+ `按需样式必须导闭包` + `判据写成 /from/ 会匹配 0 条算出假结论` | `01-docs/learnings.md` |
-| 9 | **CHANGELOG** 条目 | `CHANGELOG.md` |
+| 6 | **全量产物包含性锁**：导入的每个主题文件必须存在于 `index.css` 中（防「多导带来全局副作用」，`el-reset` 那条 9.48% 的教训） | `src/plugins/element-plus.test.js` P6 |
+| 7 | **首屏时序契约**：并行取数 + 懒触发 + 单点失败不扩散 | `src/views/Home.first-paint.test.js` |
+| 8 | **QM-2 新增检查项**：「新增全局 `app.component` / 顶层 CSS import 前必须问『它在几条路由上被用』；UI 框架默认全量引入是高频路径的性能地雷；**UI 框架按需样式必须导闭包、且不得多导全量产物里没有的文件**」 | `AGENTS.md` QM-2 |
+| 9 | **learnings 沉淀**：`全量引入在源码层测试里与按需完全等价` + `慢而不错对视觉回归结构性免疫`（与 10-14 同型第二次出现）+ `按需样式必须导闭包` + `判据写成 /from/ 会匹配 0 条算出假结论` + `多导全量产物里没有的 CSS 会带来全局副作用` + `A/B 必须还原完整变更集` + `宽目录恢复会吞掉未提交改动` | `01-docs/learnings.md` |
+| 10 | **CHANGELOG** 条目 | `CHANGELOG.md` |
 
 ### 5.1 仍未闭合的（登记，不假装已解决）
 
@@ -313,8 +361,8 @@ radio-group → base, radio      ← 漏 `el-radio` 本体的来源
   只有真进发布页才需要。但若将来发布页也要秒开，可考虑 toolbar 精简。
 - **Home.vue 的失效账号横幅在账号多时仍可能慢**：懒触发只保证它不阻塞首屏，
   不保证它自己快。它的性能属 `accounts:batch-check-login` 的既有议题（并发 3 / 单账号 60 s 超时）。
-- **`create-editor` / `create-pipeline` 存量像素漂移**：对照实验证明与本 PR 无关
-  （见 §4.5），登记为存量待办，不擅自更新基线。
+- **`create-editor` / `create-pipeline` 存量像素漂移**：已在本 PR 内定位并修复
+  （真根因见 §4.6：多导 `el-reset.css`），不再作为存量待办。
 - **QM-6 深度双模型评审未完成**：判定 `deepReview.required=true`（变更 593 行 > 200 行
   阈值），但本仓 `ccg-review-decider` 把记录**以提交前的 HEAD sha 命名**
   （`.git/hooks/pre-commit` 第 148-155 行注释明说这是刻意设计），导致 commit 之后
diff --git a/01-docs/learnings.md b/01-docs/learnings.md
index d0d3c51c8..68ffdf4ef 100644
--- a/01-docs/learnings.md
+++ b/01-docs/learnings.md
@@ -85,16 +85,61 @@
    EP 的 `style/index.mjs` 用的是**裸 import**（`import "../../x/style/index.mjs"`），没有 `from` 关键字。我第一版闭包探针用 `/from\s+['"]\.\.\/\.\.\/([a-z0-9-]+)\/style\/index\.mjs['"]/`，匹配数为 **0**，于是算出「闭包 = USED（无额外依赖）」这个**假结论**——差点据此把 QG Visual 的红归因为「与本次改造无关」。
    **可复用判据**：结构解析类判据跑完必须**打印命中条数**并对命中数做下界断言（如「闭包大小 ≥ 输入集合大小」）。「匹配 0 条」与「真的没有」在输出上一模一样——这是「夹具比生产更顺」同族坑搬到了正则上。
 
-8. **像素门禁的「红」必须先做对照实验再认领，阈值口径也要先对齐。**
-   本轮 CI 红 3 处，我没有整批认领：
-   - **对照实验**：临时加回 `import 'element-plus/dist/index.css'`（= 修复前 CSS 超集）后复跑，`create-editor` 仍是 **9.48%**、`create-pipeline` **9.26%**，与按需态**逐位相同** ⇒ 这两处与本 PR 无关（存量漂移/抖动）。
-   - **抖动证据**：CI 同一 job 两轮数字不同（9.48% → 7.66%），且第一轮 `podcast-channel` 未失败、第二轮才失败。
-   - **阈值口径差异**：本地像素默认 **1%**，CI 用 **6%**（`PIXEL_THRESHOLD`）。同一张图两边结论可能相反（`podcast-channel` 本地 2.05% 判红、CI 6% 下应通过）。
-   **纪律**：只对「能证明是本 PR 引入」的部分负责并修；存量漂移登记为待办，**禁止用 `--update-baseline` 掩盖**——那会把别人的问题一起洗白。
-
-9. **`ccg-review-decider` 的判定记录以「提交前的 HEAD sha」命名，导致 `deep-review.sh` 在 commit 之后永远查不到自己的记录。**
-   `.git/hooks/pre-commit` 第 148-155 行的注释明说这是刻意设计（防 `.ccg/reviews` 未跟踪堆积），但它与 `deep-review.sh` 的读法（`git rev-parse HEAD` → `.ccg/reviews/$SHA.json`）**错位一格**。实测四条路都走不通：① `sh scripts/deep-review.sh` → 「判定记录: 无」；② `ccg-deep-review.js --sha <记录名>` → `base..head` 恒空（该 sha 已是 main 祖先）⇒ 报「取不到 diff」退出 0；③ 改传真正承载改动的 sha → 被同名旧记录（那份是 docs 提交的 `mode=skip`）短路；④ 删掉旧记录 → 驱动直接「未找到…跳过深度审查」。
-   **后果**：`deepReview.required=true` 的变更**无法完成 QM-6 深度评审**。已如实登记为 pending 并写明修正建议（记录命名改用提交后 sha，或父/子同写两份）。**工具链自身挡住了必做门禁时，正解是如实登记 + 提出修正建议，不是编造 findings 让记录看起来走过了。**
+8. **「按需子集」对齐「全量」时，多导一个全量产物里没有的文件 = 凭空多出全局副作用。**
+   `element-plus/theme-chalk/el-reset.css` 含 `input,textarea,button{font-family:inherit}`，
+   还改了 `a`（链接颜色）、`h1~h6`（颜色/字号）、`p`（`line-height:1.8`）、`hr`、
+   `sup,sub,small` 等**原生元素**规则；而 EP 自己的全量产物 `theme-chalk/index.css`
+   （=`dist/index.css`）**根本不含这个文件**（实测在其内搜不到该规则）。
+   于是按需装配里多导它 = 悄悄改掉应用自身的元素默认样式，而这些在全量引入下从未被改过 ——
+   后果是按钮字体从 UA 默认 `Arial` 变成继承字体栈，像素门禁红
+   （create-editor 9.48% / create-pipeline 9.26% / podcast-channel 2.05%）。
+   **判据（双向）**：「全量有、子集没有」= 真缺失；**「子集有、全量没有」= 凭空多出的全局副作用**。
+   只算「组件 → 样式」闭包不够，必须**逐文件核对它是否真的存在于全量产物中**。
+   回归锁见 `element-plus.test.js` P6。
+   （同批还修了闭包缺失：漏 `el-scrollbar`/`el-popper`/`el-overlay`/`el-option-group`/`el-text`/
+   `el-radio` 本体/`el-config-provider` 共 7 个，补齐后 podcast-channel 21.63% → 2.05%；
+   判据来源是 `es/components/<name>/style/index.mjs`，注意它是**裸 import**，
+   写成 `/from\s+…/` 会匹配 0 条并算出「闭包 = 已导入」的假结论。）
+
+9. **像素回归的三步排除 + 一步定位（本轮实测顺序，可作模板）。**
+   ① **排除缺规则**：解析全量 CSS 与子集的**选择器集合**求差（本轮 1355 个），
+   再在真实页面上对每个差集选择器 `querySelectorAll` —— 命中 0 ⇒ 规则集完整。
+   ② **排除缺注册**：带 e2e 夹具逐路由采集控制台，看有无
+   `Failed to resolve component/directive`。
+   ③ **排除抖动**：同一状态连拍 2–3 次两两比对（本轮 **0.00%**，最大 14 px 属抗锯齿级）。
+   三条都排除后，**决定性一步是「逐元素计算样式签名对比」**：遍历全 DOM（本轮 348 个元素），
+   为每个元素打一份计算样式签名（`font-family`/`color`/`background-image`/`::before`/`::after` 等），
+   两态逐项 diff —— 它会直接给出**唯一差异属性**与**命中的元素集合**
+   （本轮：`font-family` 命中 32 个，全是 BUTTON 及其子节点，一眼指向表单控件重置）。
+   **别用「肉眼看截图」代替这一步**：本轮两张截图肉眼几乎一致（PNG 仅差 127 字节），
+   像素差异却是 9.41%。另注意**阈值口径**：本地像素默认 **1%**，CI 用 **6%**
+   （`PIXEL_THRESHOLD`）—— 同一张图两边结论可能相反，对照前先对齐。
+
+10. **A/B 对照必须还原「完整变更集」；只还原其中一层，会把另一层的因果误判成「无关」。**
+    我做过一次 A/B：「临时加回 `element-plus/dist/index.css`」——只还原了 **CSS**，没还原 **JS 装配**，
+    于是得出「这两处与本 PR 无关」的**错误结论**并写进了文档。真根因 `el-reset.css` 虽在 CSS 侧，
+    却只有在「**整套改动** vs `origin/main`」的对照下才暴露：完整还原后三处是
+    **0.21% / 0% / 0%**，而我的分支是 **9.48% / 9.26% / 2.05%**。
+    **纪律**：下「与我无关」的结论前，先做**整套还原**的对照；只差一层就下结论，
+    等于把「我没测到」当成「不存在」。
+
+11. **`git checkout HEAD -- <目录>`（宽目录恢复）会连带丢掉该目录下所有未提交改动。**
+    做 A/B 时我用它还原 `src`，把**尚未提交**的 `el-reset.css` 修复与 P6 锁一起抹掉，
+    之后一次复跑「红回 9.48%」才发现。AGENTS.md 铁律 R2 明确禁止宽目录恢复
+    （「恢复只针对 `git status` 精确列出的文件」）——**这不是纸面纪律，是这次真踩的**。
+    **正解**：A/B 前先提交，或把未提交文件复制到 `%TEMP%` 备份；
+    恢复时逐个文件 `git checkout HEAD -- <精确路径>`。
+
+12. **工具链自身挡住必做门禁时，正解是如实登记 + 提修正建议，不是编造 findings 让它看起来走过了。**
+    `ccg-review-decider` 把判定记录**以提交前的 HEAD sha 命名**（`.git/hooks/pre-commit`
+    第 148-155 行注释明说这是刻意设计：防 `.ccg/reviews` 未跟踪堆积），而 `deep-review.sh`
+    读的是**当前 HEAD** 的记录 ⇒ **错位一格**，commit 之后永远查不到自己的记录。
+    实测四条调用路径全部走不通：① `sh scripts/deep-review.sh` → 「判定记录: 无」；
+    ② 驱动 `ccg-deep-review.js --sha <记录名>` → `base..head` 恒空（该 sha 已是 main 祖先）
+    ⇒ 报「取不到 diff」退出 0；③ 改传真正承载改动的 sha → 被同名旧记录（`mode=skip`）短路；
+    ④ 删掉旧记录 → 驱动直接「未找到…跳过深度审查」。
+    **后果**：`deepReview.required=true` 的变更**无法完成 QM-6 深度评审**。已在执行记录里如实记
+    `pending` 并写明根因与修正建议（记录命名改用提交后 sha，或父/子同写两份）。
 
 ## 逐文件行数门禁的真实上限、rebase 冲突标记自检，与「不带热点载体」的二次验证（ops-url-split，2026-10-15）
 
diff --git a/AGENTS.md b/AGENTS.md
index 11cd5a286..29063f769 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -496,7 +496,7 @@ Code review 时除逻辑正确性外，必须逐项检查：
 
 - **首屏渲染不得阻塞在 IPC 返回之后；慢而非必需的校验必须懒触发**：任何「每次进页面都会走」的首屏 `onMounted`，判据：① 静态区块（骨架/标题/入口）是否在 `nextTick` 就渲染，不等任何 IPC？② 相互独立的数据源是否并行（`Promise.allSettled`）而非串行 `await`？③ 单源失败是否只停对应区块、不扩散成整页报错？④ 「有问题才可见」的校验（如逐账号登录态批量检测，单账号最坏 60s 超时）是否被 `setTimeout(0)` 推到首帧之后，且组件卸载时 `clearTimeout`？实例（2026-10-15）：`Home.vue` 原为 `platformStore.load() → ensureLoaded() → refreshExpiredAccounts() → dashboardStats() → historyList()` 全串行，最坏耗时是各项之和。回归锁见 `src/views/Home.first-paint.test.js`（4 条）。
 
-- **UI 框架按需引入时，样式必须导「闭包」而不是「模板里用到的组件」**：这是「登记机械锁」锁不到的维度（那种锁只看组件注册表，看不出样式缺失）。任何组件库的组件之间都可能存在**纯样式依赖** —— 内部组件（EP 的 `scrollbar`/`popper`/`overlay`/`option-group`/`text`）从不出现在模板里，但缺了它们的 CSS 就视觉回归。判据：① 以库自己声明的样式依赖图为权威（EP 是 `element-plus/es/components/<name>/style/index.mjs`，注意它是**裸 import 形态**——写成 `/from\s+…/` 会匹配 0 条并算出「闭包 = 已导入」的假结论，故结构解析类判据必须打印命中条数并对命中数做下界断言）；② 补齐闭包后用**产物级**断言核对关键选择器存在（构建成功不够——Vite 对不存在的 CSS 路径会报错，但对「少了某个组件样式」完全沉默）；③ 反向注意**0 字节占位文件**：`el-config-provider.css` 无任何选择器（renderless 组件），「无选择器」≠「漏了」，不能拿选择器存在性倒推完整性。实例（2026-10-15）：EP 按需改造第一版只导模板用到的 36 个组件样式，CI 的 `QG Visual` 当场红 3 处（`podcast-channel` 21.63%），沿 style 图重算发现漏 7 个；补齐后降到 2.05%。回归锁见 `src/plugins/element-plus.test.js` 的 P4（重算闭包断言不缺）与 P5（重复 import 锁）。**像素门禁报红时先做对照实验再认领**：把「修复前状态」临时还原后复跑，若数字逐位不变 ⇒ 该红与本 PR 无关（存量漂移/抖动），登记为待办而**不得用 `--update-baseline` 掩盖**；同时先对齐阈值口径（本地默认 1%，CI 用 `PIXEL_THRESHOLD=6%`）。
+- **UI 框架按需引入时，样式必须导「闭包」，且不得多导「全量产物里没有的文件」**：这是「登记机械锁」锁不到的维度（那种锁只看组件注册表，看不出样式）。**双向判据：「全量有、子集没有」= 真缺失；「子集有、全量没有」= 凭空多出的全局副作用。** ① 以库自己声明的样式依赖图为权威（EP 是 `element-plus/es/components/<name>/style/index.mjs`；内部组件 `scrollbar`/`popper`/`overlay`/`option-group`/`text` 从不出现在模板里，缺 CSS 就视觉回归）。注意它是**裸 import 形态**——写成 `/from\s+…/` 会匹配 0 条并算出「闭包 = 已导入」的假结论，故结构解析类判据必须打印命中条数并对命中数做下界断言。② **逐个核对被导入文件是否存在于全量产物中**：EP 的 `el-reset.css`（含 `input,textarea,button{font-family:inherit}` 及 `a`/`h1~h6`/`p`/`hr` 等原生元素规则）**不在** `theme-chalk/index.css` 里，多导它会把按钮字体从 UA 默认 `Arial` 改成继承字体栈 ⇒ 2026-10-15 实测像素回归 create-editor 9.48% / create-pipeline 9.26% / podcast-channel 2.05%（移除后三处归零至 0.21%/0%/0%）。③ 补齐后用**产物级**断言核对关键选择器存在（构建成功不够——Vite 对不存在的 CSS 路径会报错，但对「多了/少了某组样式」完全沉默）。④ 反向注意 **0 字节占位文件**：`el-config-provider.css` 无任何选择器（renderless），「无选择器」≠「漏了」。回归锁见 `src/plugins/element-plus.test.js` P4（闭包不缺）/ P5（重复 import）/ P6（全量包含性）。**像素门禁排红模板（本轮实测顺序）**：① 选择器差集在真实页面上的命中数（排除「缺规则」）→ ② 带 e2e 夹具采控制台看 `Failed to resolve component/directive`（排除「缺注册」）→ ③ 同态连拍 2–3 次互比（排除抖动，本轮 0.00%）→ ④ **逐元素计算样式签名对比**（决定性一步：遍历全 DOM 为每个元素打一份计算样式签名，两态逐项 diff，直接给出**唯一差异属性**与**命中元素集合**；本轮 `font-family` 命中 32 个全是 BUTTON 及其子节点，一眼指向表单控件重置）。**别用肉眼看截图代替第④步**——本轮两张截图 PNG 仅差 127 字节，像素差异却有 9.41%。**对照实验必须还原「完整变更集」**：只还原其中一层会把另一层的因果误判成「无关」（本轮真踩过：只还原 CSS 就写下「与我无关」的错误结论，后被推翻）。阈值口径先对齐（本地默认 1%，CI 用 `PIXEL_THRESHOLD=6%`），**禁止用 `--update-baseline` 掩盖**。
 
 - **require 路径**：每个 `require('../x')` / `require('./y')` 的解析目标文件是否真实存在
 
diff --git a/CHANGELOG.md b/CHANGELOG.md
index ce298b3c6..091dfb1f1 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -24,12 +24,17 @@
 - **修复二 QuillEditor 全局注册 → 本地注册**：改在 `ArticleEditor.vue` 内 `const components = { QuillEditor }`，Quill 只随 `/publish` 路由的懒加载 chunk 下载（实测 `quill-*.js` 148 KB 独立 chunk，**不进 `index.js`**）。
 - **修复三 首页数据并行化 + 懒触发**：按「用户何时真正需要它」分档 —— 统计/近期动态/账号数/平台元数据走 `Promise.allSettled` **并行**、各自独立 try/catch；失效账号横幅 `setTimeout(0)` 推到首帧之后，`onUnmounted` 清定时器。`statsLoaded` 语义不变：无 `electronAPI` 时**不**置位（「没拿到数据」≠「确认是 0」，不进全 0 引导态）。
 - **实测效果**：`index.js` 1 841 → **1 334 KB**（−27%）、`index.css` 503 → **300 KB**（−40%）；主页挂载冷 **1 960 → 743 ms（−62%）**、热 **803 → 283 ms（−65%）**；FCP 1 172 → 544 ms。视觉零回归（按需样式就是全量 index.css 中对应组件规则的同一份文件，只是少了 88 个不用的组件）。
-- **回归锁 17 条**：`main.bundle-contract.test.js` 7 条（禁全量 JS/CSS、必须接按需、Quill 不得全局注册）+ `element-plus.test.js` 5 条（含**漏登记机械锁** P3：扫 `src` 全部 `<el-xxx>` 核对注册表；**样式闭包锁** P4；**重复 import 锁** P5）+ `Home.first-paint.test.js` 4 条（首帧不等 IPC、统计/历史并行、单点失败不扩散、批量校验懒触发）。四条核心锁均做过变异反证（改回全量 / 删组件 / 改回串行 / 改回同步 await 都当场指名红）。
-- **首轮 CI 的 `QG Visual` 抓到一个真实新缺陷并已修**：按需 CSS 只导了「模板用到的组件」，漏掉 EP 的**纯样式依赖内部组件**。权威判据是 `element-plus/es/components/<name>/style/index.mjs`（**裸 import 形态**——判据若写成 `/from\s+…/` 会匹配 0 条、算出「闭包 = 已导入」的假结论）。重算闭包后实测漏 7 个：`el-scrollbar`/`el-popper`/`el-overlay`/`el-option-group`/`el-text`/`el-radio`（本体，`radio-group` 的 style 依赖里就有它）/`el-config-provider`（0 字节占位）。补齐后 `index.css` 300.4 → **309.5 KB**（仍远低于基线 503 KB），产物内 12 项关键选择器全部命中，本地复跑 `podcast-channel` **21.63% → 2.05%**；并留下 P4/P5 两道机械锁。
-- **两处存量像素判定（附对照实验，不背锅也不甩锅）**：`create-editor` 9.48% / `create-pipeline` 9.26% 经**对照实验**（临时加回 `element-plus/dist/index.css` 全量 CSS 后数字逐位不变）证明**与本 PR 无关**；另有抖动证据（CI 同 job 两轮 9.48% → 7.66%，首轮 `podcast-channel` 未失败）。**刻意不用 `--update-baseline` 掩盖**，登记为存量待办。
-- **QM-6 深度评审如实登记为未完成**：判定 `deepReview.required=true`（593 行 > 200 行阈值），但 `ccg-review-decider` 把记录**以提交前的 HEAD sha 命名**，导致 commit 后 `HEAD` 查不到自己的记录，四条调用路径均无法完成评审。**不编造 findings**，已写明根因与修正建议（记录命名改为提交后 sha，或父/子同写）。
+- **回归锁 19 条**：`main.bundle-contract.test.js` 7 条（禁全量 JS/CSS、必须接按需、Quill 不得全局注册）+ `element-plus.test.js` 6 条（含**漏登记机械锁** P3：扫 `src` 全部 `<el-xxx>` 核对注册表；**样式闭包锁** P4；**重复 import 锁** P5；**全量产物包含性锁** P6）+ `Home.first-paint.test.js` 4 条（首帧不等 IPC、统计/历史并行、单点失败不扩散、批量校验懒触发）。四条核心锁均做过变异反证（改回全量 / 删组件 / 改回串行 / 改回同步 await 都当场指名红）。
+- **首轮 CI 的 `QG Visual` 抓到两个真实新缺陷，均已修复**（这是本 PR 最硬的一段取证）：
+  - **缺陷一：样式漏了「纯样式依赖」的内部组件。** 按需 CSS 只导了「模板用到的组件」，漏掉 EP 的内部组件（`scrollbar`/`popper`/`overlay`/`option-group`/`text`——它们从不出现在模板里，缺 CSS 就视觉回归）。权威判据是 `element-plus/es/components/<name>/style/index.mjs`（**裸 import 形态**——判据若写成 `/from\s+…/` 会匹配 0 条、算出「闭包 = 已导入」的假结论）。重算闭包后实测漏 7 个：`el-scrollbar`/`el-popper`/`el-overlay`/`el-option-group`/`el-text`/`el-radio`（本体，`radio-group` 的 style 依赖里就有它）/`el-config-provider`（0 字节占位）。产物内 12 项关键选择器全部命中，`podcast-channel` **21.63% → 2.05%**。
+  - **缺陷二（真根因）：多导了 `el-reset.css`。** 它是**全局元素重置**（含 `input,textarea,button{font-family:inherit}`，还改了 `a`/`h1~h6`/`p`/`hr`/`sup,sub,small`），而 **EP 自己的全量产物 `theme-chalk/index.css` 里根本没有这个文件**（实测搜不到该规则）⇒ 多导它 = 悄悄改掉应用自身的元素默认样式，而这些在全量引入下从未被改过。后果是按钮字体从 UA 默认 `Arial` 变成继承字体栈，`create-editor` 9.48% / `create-pipeline` 9.26% / `podcast-channel` 2.05% 全红。移除后三处归零至 **0.21% / 0% / 0%**（与 `origin/main` 逐位一致），本地完整像素套件 **19/20 通过**（阈值 1%；CI 用 6%）。
+  - **定位手法（可复用）**：① 全量/子集**选择器差集**在真实页面上的命中数（排除缺规则）→ ② 带 e2e 夹具采控制台看 `Failed to resolve component/directive`（排除缺注册）→ ③ 同态连拍 3 次互比 **0.00%**（排除抖动）→ ④ **逐元素计算样式签名对比**（遍历全 DOM 348 个元素，逐项 diff，直接指出唯一差异属性 `font-family` 与命中集合「32 个全是 BUTTON 及其子节点」）。**肉眼看截图无效**：两张截图 PNG 仅差 127 字节，像素差异却有 9.41%。
+  - **新增 P6 全量产物包含性锁**：断言导入的每个主题文件都存在于 `index.css` 中，并显式禁止 `el-reset`（只断言「不含 el-reset」是弱锁，换个文件又会重犯）。
+  - **我给出的两个错误结论已推翻并留证**：中途我曾判「这两处与本 PR 无关，是存量漂移/抖动」并写进文档，依据是「临时加回全量 CSS 后数字不变」的 A/B；但那次 A/B **只还原了 CSS、没还原 JS 装配**，而真根因必须在「完整变更集 vs main」的对照下才暴露（完整还原 ⇒ 0.21%/0%/0%）⇒ **A/B 必须还原完整变更集**。另一条「`podcast-channel` 属环境差异」同样被推翻。错误结论已在 BUGFIX / learnings / 执行记录同批更正，不留在库里误导后来者。
+- **QM-6 深度评审如实登记为未完成**：判定 `deepReview.required=true`（593 行 > 200 行阈值），但 `ccg-review-decider` 把记录**以提交前的 HEAD sha 命名**（`.git/hooks/pre-commit` 第 148-155 行注释明说这是刻意设计），导致 commit 后 `HEAD` 查不到自己的记录，四条调用路径均无法完成评审。**不编造 findings**，已写明根因与修正建议（记录命名改为提交后 sha，或父/子同写）。
 - 机械锁在开发中**当场抓到一次真实漏项**：`el-radio-button`/`el-radio-group`（`VideoCloneView.vue` 在用）——EP 把它们实现放在 `radio/` 目录、以 `withNoopInstall` 挂在 `ElRadio` 上当子组件，**不占全局注册表**；正解是只注册 `ElRadio` + 补样式文件，而不是把它们加进 `app.use`（无效劳动）。样式闭包修复时又发现**漏了 `el-radio` 本体**——`radio-group` 的 style 依赖里就有它。
-- 修复全程与 Bug 反思 5 步产出见 `01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md`；QM-2 新增「新增全局 `app.component`/顶层 CSS import 前必须问它在几条路由上被用」「UI 框架按需样式必须导**闭包**而不是模板用到的组件」「首屏渲染不得阻塞在 IPC 之后」等检查项；PRD-TAB-INDEPENDENT-HOME 新增 F7 首屏性能需求。
+- **排查过程本身也踩了一个纪律坑（记录）**：做 A/B 时我用 `git checkout HEAD -- apps/desktop/src`（**宽目录恢复**）还原状态，把当时**尚未提交**的 `el-reset.css` 修复与 P6 锁一起抹掉，随后一次复跑「红回 9.48%」才发现。AGENTS.md 铁律 R2 明确禁止宽目录恢复（「恢复只针对 `git status` 精确列出的文件」）——正解是 A/B 前先提交或备份到 `%TEMP%`，恢复时逐个文件精确 checkout。
+- 修复全程与 Bug 反思 5 步产出见 `01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md`（§4.5 闭包缺失 / §4.6 `el-reset` 真根因 / §4.7 错误结论留证 / §4.8 排查纪律坑）；QM-2 新增「新增全局 `app.component`/顶层 CSS import 前必须问它在几条路由上被用」「UI 框架按需样式必须导**闭包**、且不得多导全量产物里没有的文件」「像素门禁排红四步模板」「A/B 必须还原完整变更集」「首屏渲染不得阻塞在 IPC 之后」等检查项；PRD-TAB-INDEPENDENT-HOME 新增 F7 首屏性能需求。
 
 # [未发布] test(podcast): 存量 mime 固化「不猜」的变异反证落进文件，并补上它暴露的按值快照（stock-default-write-proof）
 
diff --git a/apps/desktop/src/plugins/element-plus.js b/apps/desktop/src/plugins/element-plus.js
index 8bb279dfd..7345ecfdf 100644
--- a/apps/desktop/src/plugins/element-plus.js
+++ b/apps/desktop/src/plugins/element-plus.js
@@ -66,6 +66,8 @@ import {
   ElInput,
   ElInputNumber,
   ElLink,
+  // 指令插件（见文件头约束②）：不过 app.component，走 app.use 的 install。
+  ElLoading,
   ElMessage,
   ElMessageBox,
   ElOption,
@@ -91,10 +93,26 @@ import {
 } from 'element-plus/es'
 
 // ── 共享样式底座 ──
-// 变量（el-var）+ reset（el-reset）+ 过渡/动画基类（base）。
-// 这三个不是组件样式，是 EP 全部组件的地基，最先导入。
+// 变量（el-var + base 的 :root 块）+ 过渡/动画基类（base.css 的 .el-fade-in 等）。
+//
+// ⛔ **不要导入 `el-reset.css`**。它是一个**全局元素重置**，而且 EP 自己的
+// `theme-chalk/index.css`（= `dist/index.css`）**并不包含它** —— 实测在
+// `index.css` 里搜不到 `input,textarea,button{font-family:inherit}` 这条规则。
+// 但 `el-reset.css` 里除了这条，还改了 `a`（链接颜色）、`h1~h6`（颜色/字号）、
+// `p`（line-height:1.8）、`hr`、`sup/sub/small` 等**全部原生元素**。
+// 因此单独导入它 = 悄悄改变应用自身的元素默认样式，而这些在全量引入下
+// **从未被改变过**。
+//
+// **2026-10-15 实测代价**：多导这一个文件后，`input/textarea/button` 从浏览器
+// 默认的 `Arial` 变为「继承应用字体栈」。逐元素计算样式对比显示：348 个元素里
+// 有 32 个（全部是 BUTTON 及其子节点）字体不同 ⇒ 像素门禁红
+// （create-editor 9.48% / create-pipeline 9.26% / podcast-channel 2.05%；
+// 同态重复渲染实测 0.00%，已排除抖动）。移除后即与全量引入逐像素对齐。
+//
+// 可复用判据：把「按需子集」与「全量」对齐时，不能只算组件样式闭包，
+// 还要核对**每个被导入的文件是否真的存在于全量产物中** —— 多导的文件会带来
+// 全量里没有的全局副作用；反向（全量有、子集没有）才是真缺失。
 import 'element-plus/theme-chalk/el-var.css'
-import 'element-plus/theme-chalk/el-reset.css'
 import 'element-plus/theme-chalk/base.css'
 
 // ── 组件样式（= 权威闭包，含 7 个纯样式依赖内部组件）──
@@ -115,6 +133,8 @@ import 'element-plus/theme-chalk/el-icon.css'
 import 'element-plus/theme-chalk/el-input.css'
 import 'element-plus/theme-chalk/el-input-number.css'
 import 'element-plus/theme-chalk/el-link.css'
+// 指令样式：v-loading 的遮罩（走指令不经组件，组件闭包里没有它）。
+import 'element-plus/theme-chalk/el-loading.css'
 // message / message-box 是命令式 API，不在组件闭包里，但运行时确实要渲染 → 必须导。
 import 'element-plus/theme-chalk/el-message.css'
 import 'element-plus/theme-chalk/el-message-box.css'
@@ -183,6 +203,17 @@ const COMPONENTS = [
   ElUpload,
 ]
 
+/**
+ * 指令插件清单（走 app.use 的 install，不占 app.component 注册表）。
+ *
+ * 见文件头约束②：它们是**必装项**，漏装不会报错、只会静默少渲染。
+ * 本项目实际用到：`v-loading`（4 个文件：PatternAnalysisPanel / FilmEngineeringView ×2 /
+ * PerformanceInsights）。`app.use(ElementPlus)` 会一并装上它，显式清单必须补回。
+ */
+const DIRECTIVES = [
+  ElLoading,
+]
+
 /**
  * Vue 插件：装配按需 EP。
  *
@@ -196,6 +227,9 @@ export default {
     for (const component of COMPONENTS) {
       app.use(component)
     }
+    for (const directive of DIRECTIVES) {
+      app.use(directive)
+    }
   },
 }
 
diff --git a/apps/desktop/src/plugins/element-plus.test.js b/apps/desktop/src/plugins/element-plus.test.js
index 92133c070..0049d171f 100644
--- a/apps/desktop/src/plugins/element-plus.test.js
+++ b/apps/desktop/src/plugins/element-plus.test.js
@@ -141,11 +141,9 @@ describe('element-plus 按需装配（行为验证）', () => {
       '以下 EP 样式在闭包里但未 import（视觉回归风险，QG Visual 会红）: ' + missing.join(', '),
     ).toEqual([])
 
-    // 4) 共享底座三件套（base.css 不带 el- 前缀，不在上面的 imported 集合里，单独断言）
+    // 4) 共享底座（base.css 不带 el- 前缀，不在上面的 imported 集合里，单独断言）
     expect(pluginSrc, '缺少共享底座 base.css').toMatch(/theme-chalk\/base\.css/)
-    for (const f of ['el-var', 'el-reset']) {
-      expect(imported.has(f), '缺少共享底座 ' + f + '.css').toBe(true)
-    }
+    expect(imported.has('el-var'), '缺少共享底座 el-var.css').toBe(true)
     // 组件样式目录必须真实存在（防路径写错但恰好被 tree-shake 掩盖）
     const chalkDir = path.join(
       process.cwd(), '..', '..', 'node_modules', 'element-plus', 'theme-chalk',
@@ -154,6 +152,69 @@ describe('element-plus 按需装配（行为验证）', () => {
     expect(missingFile, 'theme-chalk 里不存在的样式文件: ' + missingFile.join(', ')).toEqual([])
   })
 
+  /**
+   * P6 全量产物包含性锁（2026-10-15 加入，由一次 9.48% 的真实像素回归换来）
+   *
+   * 判据：**插件导入的每个 theme-chalk 文件都必须真的存在于 EP 的全量产物
+   * `theme-chalk/index.css` 中**。反向（全量有、子集没有）才是缺失；
+   * 而「子集有、全量没有」的文件会带来**全量引入下根本不存在的全局副作用**。
+   *
+   * 这次踩的是 `el-reset.css`：它含 `input,textarea,button{font-family:inherit}`
+   * 以及 `a` / `h1~h6` / `p` / `hr` 等原生元素规则，而 `index.css` 里一条都没有。
+   * 多导它的后果：按钮字体从浏览器默认 `Arial` 变成继承应用字体栈，
+   * 逐元素计算样式对比 348 个元素里 32 个（全是 BUTTON 及其子节点）字体不同
+   * ⇒ create-editor 9.48% / create-pipeline 9.26% / podcast-channel 2.05%
+   * 像素回归（同态重复渲染实测 0.00%，已排除抖动）。
+   *
+   * 只断言「不含 el-reset」是弱锁（换个文件又会重犯），故这里断言**集合关系**：
+   * 插件导入的每个非空 el-*.css 的首个选择器都必须能在 `index.css` 里定位到。
+   */
+  it('P6：导入的每个主题文件都必须存在于 EP 全量产物 index.css 中（防「多导带来全局副作用」）', async () => {
+    const fs = await import('node:fs')
+    const path = await import('node:path')
+
+    const pluginSrc = fs.readFileSync(
+      path.join(process.cwd(), 'src/plugins/element-plus.js'), 'utf8',
+    )
+    const imported = [...new Set(
+      [...pluginSrc.matchAll(/theme-chalk\/(el-[a-z0-9-]+)\.css/g)].map(m => m[1]),
+    )]
+
+    // 明确禁止：全局元素重置不在全量产物里
+    expect(
+      imported.includes('el-reset'),
+      'el-reset.css 不在 EP 全量产物 index.css 中，导入它会改变原生元素默认样式'
+        + '（2026-10-15 实测造成 9.48% 像素回归）',
+    ).toBe(false)
+
+    const chalkDir = path.join(
+      process.cwd(), '..', '..', 'node_modules', 'element-plus', 'theme-chalk',
+    )
+    const indexCss = fs.readFileSync(path.join(chalkDir, 'index.css'), 'utf8')
+
+    const firstSelector = (css) => {
+      const m = css.match(/\.el-[a-z0-9-]+(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?/)
+      return m ? m[0] : null
+    }
+    const placeholders = []
+    const notInFull = []
+    for (const name of imported) {
+      const p = path.join(chalkDir, name + '.css')
+      if (!fs.existsSync(p)) continue
+      const css = fs.readFileSync(p, 'utf8')
+      if (!css.trim()) { placeholders.push(name); continue } // renderless，0 字节
+      const sel = firstSelector(css)
+      if (!sel) { placeholders.push(name); continue }
+      if (!indexCss.includes(sel)) notInFull.push(name + '（首个选择器 ' + sel + '）')
+    }
+    expect(
+      notInFull,
+      '以下主题文件的首个选择器在全量 index.css 里找不到 —— 它们带来的是全量引入下不存在的样式: '
+        + notInFull.join(', '),
+    ).toEqual([])
+    expect(placeholders.length, '占位/无选择器文件数异常: ' + placeholders.join(', ')).toBeLessThan(5)
+  })
+
   it('P5：样式 import 不得重复（重复行说明批量替换改坏了清单）', async () => {
     const fs = await import('node:fs')
     const path = await import('node:path')
@@ -167,4 +228,60 @@ describe('element-plus 按需装配（行为验证）', () => {
     const dupes = lines.filter((v, i) => lines.indexOf(v) !== i)
     expect([...new Set(dupes)], '重复的样式 import: ' + [...new Set(dupes)].join(', ')).toEqual([])
   })
+
+  /**
+   * P7 指令覆盖锁（2026-10-15 加入）
+   *
+   * P3 扫的是模板里的 `<el-xxx>` **标签**，而 EP 还有一类装配项是**指令**：
+   * `v-loading`（`ElLoading`）/ `v-infinite-scroll`（`ElInfiniteScroll`）。
+   * `app.use(ElementPlus)` 会一并装上它们，显式按需清单则**必须手动登记**，
+   * 而且漏装**不会报错、只会静默少渲染**（加载遮罩整块不出现）。
+   *
+   * 本项目实测用到 `v-loading` 的 4 个文件：PatternAnalysisPanel /
+   * FilmEngineeringView ×2 / PerformanceInsights。本锁把它们变成机械判据：
+   * 模板里出现 `v-loading` ⇒ 插件必须 import `ElLoading` 且 `app.use` 它，
+   * 并导入 `el-loading.css`（指令样式不在任何组件的样式闭包里）。
+   */
+  it('P7：模板用到的 EP 指令必须被装配（v-loading ⇒ ElLoading + el-loading.css）', async () => {
+    const fs = await import('node:fs')
+    const path = await import('node:path')
+    const src = path.join(process.cwd(), 'src')
+
+    const usedDirectives = new Map() // 指令名 -> 首个使用文件
+    const scan = (dir) => {
+      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
+        const p = path.join(dir, e.name)
+        if (e.isDirectory()) { if (e.name !== 'node_modules') scan(p); continue }
+        if (!/\.vue$/.test(e.name)) continue
+        const text = fs.readFileSync(p, 'utf8')
+        for (const m of text.matchAll(/\sv-(loading|infinite-scroll)\b/g)) {
+          if (!usedDirectives.has(m[1])) usedDirectives.set(m[1], p.replace(src, 'src'))
+        }
+      }
+    }
+    scan(src)
+
+    const pluginSrc = fs.readFileSync(
+      path.join(process.cwd(), 'src/plugins/element-plus.js'), 'utf8',
+    )
+    const missing = []
+    for (const [dir, file] of usedDirectives) {
+      if (dir === 'loading') {
+        if (!/\bElLoading\b/.test(pluginSrc)) missing.push('v-loading ⇒ 需 import 并 app.use ElLoading（用于 ' + file + '）')
+        if (!/theme-chalk\/el-loading\.css/.test(pluginSrc)) missing.push('v-loading ⇒ 需 import el-loading.css（用于 ' + file + '）')
+      }
+      if (dir === 'infinite-scroll') {
+        if (!/\bElInfiniteScroll\b/.test(pluginSrc)) missing.push('v-infinite-scroll ⇒ 需 import 并 app.use ElInfiniteScroll（用于 ' + file + '）')
+      }
+    }
+    expect(missing, missing.join('; ')).toEqual([])
+    // 指令必须真的挂进注册表（不是只 import 了名字）
+    const { createApp, h } = await import('vue')
+    const app = createApp({ render: () => h('div') })
+    app.use(elementPlusOnDemand)
+    expect(
+      app._context.directives.loading,
+      'ElLoading 未挂进 app._context.directives —— v-loading 会静默失效',
+    ).toBeTruthy()
+  })
 })
diff --git a/openspec/records/fix-newtab-home-slow.md b/openspec/records/fix-newtab-home-slow.md
index 68fc40d33..7ff2f8a6a 100644
--- a/openspec/records/fix-newtab-home-slow.md
+++ b/openspec/records/fix-newtab-home-slow.md
@@ -20,13 +20,14 @@ sync_backfill_owner: agent
 | TDD 与相关域全量 | ✅ | 先写测试后写实现：`main.bundle-contract.test.js`（7 红）→ `Home.first-paint.test.js`（4 红，含 pinia/router 装配修正）→ 实现 → **全绿**。本 PR 新增 14 条 + 改 1 处既有测试（`Home.test.js` 的 `flushMounted` 多等两轮 `setTimeout(0)` 适配懒触发）。相关域：`src/plugins/` + `src/views/Home*` + `src/main*` + `src/components/ArticleEditor*` 全绿；`src/**` 全量见下「相关域全量」行 |
 | 变异反证（4/4 指名红） | ✅ | M1 把 `main.js` 改回 `import ElementPlus from 'element-plus'` ⇒ B1/B2/B5/B6 同时判红；M2 从 `COMPONENTS` 删 `ElTable` ⇒ P3 报 `以下 EP 组件在 src 中被使用但未在按需清单注册: table`；M3 `Promise.allSettled([...])` 改回串行 `await` ⇒ H2 报 `expected -1 to be less than -1`（history 被 dashboard 挡死）；M4 `setTimeout(...,0)` 改成直接 `await refreshExpiredAccounts()` ⇒ H4 报 nextTick 时已发起批量校验。四条均「把锁/业务改坏必须立刻变红」，不是只证业务改动变红的假绿 |
 | **QG Visual 真实红 → 样式闭包修复** | ✅ 已修并留下机械锁 | 首轮 CI 的 `QG Visual` 红 3 处：`podcast-channel` 21.63% / `create-editor` 9.48% / `create-pipeline` 9.47%（阈值 6%）。**这是 P3 锁不到的维度**：P3 只锁「组件注册」，第一版按需 CSS 只导了「模板用到的组件」，漏掉 EP 的**纯样式依赖内部组件**。取证到权威判据 = `element-plus/es/components/<name>/style/index.mjs`（**裸 import 形态**，写成 `/from\s+…/` 会匹配 0 条并算出「闭包 = 已导入」的假结论）。重算闭包后发现漏 7 个：`el-scrollbar` / `el-popper` / `el-overlay` / `el-option-group` / `el-text` / `el-radio`（本体——我上一轮只补了 radio-button/radio-group，而 `radio-group` 的 style 依赖里就有 `radio`）/ `el-config-provider`（0 字节占位，renderless）。补齐后：`index.css` 300.4 → **309.5 KB**（仍远低于基线 503 KB），产物内 12 项关键选择器实测全部命中，本地复跑 `podcast-channel` **21.63% → 2.05%**。新增 **P4 样式闭包锁**（按 style/index.mjs 重算闭包，断言不缺）与 **P5 重复 import 锁**（本轮真出过重复行） |
-| **`create-editor`/`create-pipeline` 两处红 → 判定为抖动，非本 PR 引入（附对照实验）** | ✅ 有对照证据 | 本地复跑：`create-editor` 9.48%、`create-pipeline` 9.26%。**对照实验**：临时在插件里加回 `import 'element-plus/dist/index.css'`（= 修复前 CSS 超集）后复跑，两者仍是 **9.48% / 9.26%**，与按需态**逐位相同** ⇒ 与本次样式改造无关。另证抖动：CI 同一 job 两轮数字不同（`create-editor` 9.48% → 7.66%），且第一轮 `podcast-channel` 未失败而第二轮才失败。故本 PR 只对「因闭包缺失而变差的 `podcast-channel`」负责并已修复；这两条的存量漂移不在本 PR 范围内（不擅自更新基线掩盖） |
+| **三处红的真根因（第二步）：多导了 `el-reset.css`** | ✅ 已修 + 留 P6 锁 | 补完样式闭包后 `podcast-channel` 由 21.63% 降到 2.05%，但 `create-editor`/`create-pipeline` 仍 9.48%/9.26%。用**逐元素计算样式对比**（遍历全 DOM，为 348 个元素各打一份计算样式签名，两态逐项 diff）定位到**唯一差异**：`input,textarea,button` 的 `font-family` 在我的分支是「继承应用字体栈」、在 main 是浏览器默认 **`Arial`** —— 命中 32 个元素（**全部是 BUTTON 及其子节点**）。根因：`element-plus/theme-chalk/el-reset.css` 含 `input,textarea,button{font-family:inherit}`（还改了 `a`/`h1~h6`/`p`/`hr`/`sup,sub,small`），而 **EP 自己的全量产物 `theme-chalk/index.css` 里根本没有这个文件**（实测在其内搜不到该规则）⇒ 我多导它 = 悄悄改变原生元素默认样式，而这些在全量引入下**从未被改变过**。移除后三处全部归零：**create-editor 0.21% / create-pipeline 0% / podcast-channel 0%**，与 `origin/main` 逐位一致（同态重复渲染实测 0.00%，排除抖动）。新增 **P6 全量产物包含性锁**：断言插件导入的每个主题文件都存在于 `index.css` 中，并显式禁止 `el-reset` |
+| **两次错误结论的更正（留证，不删）** | ⚠️ 已推翻 | 我先后给过两个**错误**判断并写进了已提交的文档：① 「`create-editor`/`create-pipeline` 与本次改造无关，是存量漂移/抖动」——当时的依据是「临时加回 `element-plus/dist/index.css` 后数字逐位不变」；② 「`podcast-channel` 21.63% 属环境差异」。**两者均被后续对照推翻**：把**整套改动**还原成 `origin/main` 后三者是 0.21% / 0% / 0%，而我的分支是 9.48% / 9.26% / 2.05%；同一状态连拍 3 次，两两差异 **0.00%**（0 px / 14 px），彻底排除抖动。①的实验设计有缺陷：它**只还原了 CSS**、没还原 JS 装配，而真根因虽在 CSS 侧，却必须在「完整变更集 vs main」的对照下才暴露 ⇒ 得出「无关」的假结论。**教训**：A/B 必须还原**完整变更集**；只还原其中一层，会把另一层的因果误判成「无关」。两条错误结论已在 BUGFIX / learnings / CHANGELOG 同批更正 |
 | 机械锁当场抓到的真实漏项 | ✅ | P3 首次运行即报 `radio-button, radio-group` missing。取证：`element-plus/es/components/{radio-button,radio-group}/` **只有 `style/`，无 `index.mjs`** —— 实现放在 `radio/` 目录，由 `ElRadio` 以 `withNoopInstall` 挂成子组件，**不占全局注册表**。修法：只注册 `ElRadio`（把它们写进 `app.use` 是无效劳动，其 install 是 no-op）+ 单独 import `el-radio-button.css` / `el-radio-group.css`（**样式不走 install，必须单独导**）。这正是该锁存在的理由 |
 | 六路由真实产物冒烟 | ✅ | 本地 HTTP 托管 `dist/` + 注入最小 `electronAPI` 桩，逐路由加载并统计 `[class*="el-"]` 元素：`/` `/publish` `/accounts` `/dashboard` `/publish/history` `/collection` 全部 `bodyLen > 2000`、无 "Failed to resolve component"；实测 EP 类名 `el-upload`/`el-icon`/`el-overlay`/`el-modal-dialog` 与 Quill `ql-editor` 均在 DOM 中出现 ⇒ 按需注册真的生效。（`accounts`/`member-center` 两页 `el-类=0` 经 `git grep` 取证为**页面本就只用自定义 `.mp-*` 组件**，非注册失败） |
 | 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐值相等（无幽灵行） |
 | 静态门禁（本地已跑） | ✅ | `eslint` 对 8 个改动/新增文件 `--quiet` **exit 0**；`check-no-brand-residue.js` 未跑（无竞品名新增，文案全部复用既有 locale key）；locale **未改**（无新增用户可见文案，CI Gate 7 无成对校验需求） |
 | QM-1 打包 | **N/A（未触及触发路径）** | AGENTS.md QM-1 的触发条件是「修改 `apps/desktop/electron/` 或 `packages/rpa-engine/` 下代码」。本 PR 的代码改动**全部在 `apps/desktop/src/**`（渲染层）**，`git show --stat HEAD` 可核：无任何 `electron/` 文件 ⇒ QM-1 不适用。渲染层对应的构建验证是 `vite build`（见下），非 electron-builder。**不为凑证据跑无关打包**。 |
-| QM-4 视觉 | ✅（含一次真实红与对照实验） | 有渲染端样式变更 ⇒ 跑了视觉判据。首轮 CI 的 `QG Visual` **红 3 处**（见上面「QG Visual 真实红」行），其中 `podcast-channel` 21.63% 确为本 PR 的样式闭包缺失所致，**已修复并本地复跑验证 21.63% → 2.05%**；`create-editor`/`create-pipeline` 经**对照实验**（加回全量 CSS 后数字逐位不变）判定为存量抖动，非本 PR 引入。六路由冒烟亦实测无组件解析失败 |
+| QM-4 视觉 | ✅ | 有渲染端样式变更 ⇒ 跑了视觉判据。首轮 CI 的 `QG Visual` **红 3 处**，经**两步**定位并全部修复（① 样式闭包漏 7 个纯样式依赖内部组件；② 多导 `el-reset.css` 改变了原生元素默认字体）。**本地完整像素套件 19/20 通过**（阈值 1%；CI 用 6%），三处从 9.48%/9.26%/21.63% 全部归零，与 `origin/main` 逐位一致；唯一失败的 `collection` 1.44% 经两态单跑均为 **0%** ⇒ 抖动（且 1.44% < CI 阈值 6%）。六路由冒烟亦实测无组件解析失败 |
 | QM-6 CCG 双模型深度审查 | ⚠️ **判定 DUAL / required=true，但未完成——如实登记不假装通过** | `pre-commit` 的 `ccg-review-decider` 判定：`mode=dual`、`reason=变更 593 行 > 200 行阈值`、`deepReview.required=true`、`status=pending`、`performedBy=null`、`findings=null`（取证：`.ccg/reviews/8e9109a556630fb4d0ad0cb714f737191a4914cd.json`）。**尝试补跑失败**：`scripts/deep-review.sh` 读 `HEAD` 的判定记录，而记录**以提交前的 HEAD sha 命名**（`.git/hooks/pre-commit` 第 148-155 行注释明说这是刻意设计），因此 commit 之后 `HEAD` 永远查不到自己的记录；改用驱动 `ccg-deep-review.js --sha <记录名>` 则 `base..head` 恒为空（该 sha 已是 main 的祖先），驱动报「取不到 diff」退出 0。改传真正的改动 sha `d3959096a` 又会被同名记录（那份是 docs 提交的 `mode=skip`）短路。**四路都试过，均无法在「记录名 = 父 sha」的设计下完成评审** ⇒ 本行如实记 `pending`，不编造 findings。这是**流程性问题**（评审记录命名与提交 sha 错位），值得独立切片修正，不属于本 PR 的代码范围 |
 | OpenSpec change | 判定不建（如实记录） | 单点根因修复、无方案级取舍、无新增 IPC 通道/存储/接口/依赖；同域先例（2026-10-11 账号标签首屏登录态）同样只产出 PRD + 执行记录 |
 | 远程同步 | PENDING | 开 PR 时登记；合并后就地改写为 PASS + merge SHA，并同一次提交删除 frontmatter `sync_*` 三字段与 `scripts/gate-record-debt-ledger.json` 登记项 |
@@ -47,7 +48,7 @@ sync_backfill_owner: agent
 ### 遗留（不假装已闭合）
 
 1. **QM-6 深度评审未完成（流程性阻塞，非本 PR 代码问题）**：判定 `deepReview.required=true`，但「记录以父 sha 命名」的设计使 commit 后无法定位自己的记录（详见上表 QM-6 行的四路尝试）。建议独立切片修正 `ccg-review-decider` 的记录命名（改用提交后 sha 或同时写两份），使 `deep-review.sh` 可用。
-2. **`create-editor` / `create-pipeline` 存量像素漂移**：本地 `9.48%` / `9.26%`，**在全量 CSS 对照下数字逐位不变** ⇒ 与本 PR 无关的存量问题（基线相对当前 main 已漂移，或本地/CI 渲染环境差异）。**刻意不更新基线掩盖**（AGENTS.md：禁止用 `--update-baseline` 掩盖问题），登记为存量待办。
+2. **本地像素套件里的 `collection` 1.44%**：两态**单跑均为 0%**，判为套件内的抖动（同批运行时 dev server 冷/热差异）；且 1.44% 低于 CI 阈值 6%。**刻意不更新基线掩盖**（AGENTS.md 明令禁止用 `--update-baseline` 掩盖问题）。
 3. **本地像素阈值与 CI 不同**：本地默认 1%，CI 用 6%（`PIXEL_THRESHOLD`）。故 `podcast-channel` 本地 2.05% 会判红、CI 6% 阈值下应通过。对照时须注意口径差异。
 4. **`index.js` 仍有 1.33 MB**：本次只砍了 element-plus。剩余业务代码（`@element-plus/icons-vue`、各 view 共享依赖）未拆。进一步方向是 `build.rollupOptions.output.manualChunks` 做 vendor 分包，属独立切片。
 5. **vite 的 500 kB chunk 警告仍未进 CI 失败条件**：改 `.github/workflows/` 属「改谁来守门」，按 AGENTS.md 必须人工过目，不在本 PR 范围。

```

> 这是机械生成的变更提案，不代表任何设计意图。评审方请只针对上述内容挑刺。