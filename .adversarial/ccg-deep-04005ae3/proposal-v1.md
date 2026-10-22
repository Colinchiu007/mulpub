# 变更提案（自动生成，待对抗评审）

- base: `origin/main`
- head: `04005ae3586ec326f5f970a417b6269050f23ad7`
- 采集模式: `diff`
- 变更规模: 703 行

## 变更内容

```diff
diff --git a/.ccg/reviews/dd8ec1462ba7da9af0f13dcd626f09860dd816cc014314c73b9c5585123f4d29.json b/.ccg/reviews/dd8ec1462ba7da9af0f13dcd626f09860dd816cc014314c73b9c5585123f4d29.json
new file mode 100644
index 000000000..ddda3f018
--- /dev/null
+++ b/.ccg/reviews/dd8ec1462ba7da9af0f13dcd626f09860dd816cc014314c73b9c5585123f4d29.json
@@ -0,0 +1,57 @@
+{
+  "sha": "71a61e540ea5acd66b6dfdeec631ead9e90f9ee3",
+  "layer": "diff",
+  "mode": "single",
+  "reason": "变更 197 行（≤ 200）且无敏感命中 → 走 §12.6 常规专家分派",
+  "stats": {
+    "changedLines": 197,
+    "fileCount": 13,
+    "codeFileCount": 5,
+    "sensitivePathHits": [],
+    "plannedPathHits": [],
+    "sensitiveContentHits": 0,
+    "docSensitiveContentHits": 0,
+    "docSensitiveContentSample": [],
+    "ccgSensitiveContentHits": 0,
+    "ccgSensitiveContentSample": [],
+    "lineReadGaps": []
+  },
+  "stagedDiffHash": "dd8ec1462ba7da9af0f13dcd626f09860dd816cc014314c73b9c5585123f4d29",
+  "decidedAt": "2026-10-22T10:55:49.466Z",
+  "decidedBy": "ccg-review-decider",
+  "reviewBackends": {
+    "proposer": "opencode",
+    "critic": "claude",
+    "from": {
+      "proposer": "list",
+      "critic": "list"
+    },
+    "notes": [],
+    "overridden": false
+  },
+  "backendAvailability": {
+    "count": 2,
+    "total": 2,
+    "partial": false,
+    "wrapperReady": true,
+    "backends": {
+      "wrapperExists": true,
+      "names": [
+        "claude",
+        "opencode"
+      ],
+      "onPath": [
+        "claude",
+        "opencode"
+      ]
+    }
+  },
+  "deepReview": {
+    "required": true,
+    "status": "pending",
+    "tier": "unknown",
+    "performedBy": null,
+    "evidence": null,
+    "findings": null
+  }
+}
\ No newline at end of file
diff --git a/01-docs/UI-VISUAL-AUDIT-2026-10-20.md b/01-docs/UI-VISUAL-AUDIT-2026-10-20.md
index 6a1d0cd0a..370e4bc74 100644
--- a/01-docs/UI-VISUAL-AUDIT-2026-10-20.md
+++ b/01-docs/UI-VISUAL-AUDIT-2026-10-20.md
@@ -22,10 +22,10 @@
 1. **页面有了"底"**——全应用铺一层极浅的过渡色画布，卡片是浮在上面的白色层，层次一眼可辨。
 2. **主操作有了"重量"**——主按钮/主任务卡/主指标卡统一为品牌渐变 + 柔光投影，视线第一落点就是"该做什么"。
 3. **同一个控件不再有两种样子**——页签一律胶囊、输入框一律 12px 圆角 + 聚焦光环、卡片一律 16px 圆角 + 发丝描边 + 抬升投影。
-4. **"未完成"不再是虚线**——空态改为柔面 + 实线发丝描边，付费占位改为品牌色边条，不再像 bug。
+4. **关键空态不再用虚线**——P0-6 点名的四类（首页两处空态、效能洞察两处空态）改为实线发丝描边，付费占位改为品牌色边条，不再像 bug；其余语义空态与像素基线视图耦合，改动会动基线，已连同选择器清单登记为下一阶段（见 §3 P0-6「落地状态」）。
 5. **数字只有一套字形**——数据看板的等宽衬线数字改回统一展示字族 + 等宽数字（tabular-nums），多张卡的数字小数点对齐。
 
-**量化结果**（对 32 条路由、177 张截图的计算审计）：
+**量化结果**（对 33 条路由、210 张截图——亮色 177 + 暗色 33，覆盖 34 条路由——的计算审计）：
 
 | 维度 | 改造前 | 改造后实测 | 改造目标 | 手段 |
 |---|---:|---:|---:|---|
@@ -34,7 +34,7 @@
 | 页面内出现的**不同间距组合** | 143 种 | **143 种** | ≤ 30 种 | 共享类改用 `--space-*` 标度 |
 | **字体栈** | 3 套（PingFang SC 硬编码 5937 / Arial 1345 / SF Pro 35） | **PingFang 硬编码 0，统一栈 5869** | 1 套 | 新增 `--font-family-ui` / `--font-family-ui-display` |
 | **页面标题色** | 3 种（品牌紫 / 墨色 / 链接蓝） | **1 种（墨色）** | 1 种（墨色） | 品牌色只留给图标、状态与 CTA |
-| **空态/占位描边** | 虚线（读作"未完成"） | **实线发丝 + 柔面** | 实线发丝 + 柔面 | 语义修正 |
+| **空态/占位描边** | 虚线（读作"未完成"） | **P0-6 四类已改实线发丝**（首页两处 + 效能洞察两处）；付费占位已改品牌色边条 | 其余 4 类语义空态仍是虚线（与像素基线耦合，见 §3 P0-6） | 语义修正 |
 
 > **「改造后实测」列的读法（重要）**：前三项的**不同值个数没有下降**，但**频次分布已经重排**——
 > 见 §2.6 的逐项拆解。结论是：**碎片化主因不在共享类层，而在 234 个组件各自的 scoped 样式里**，
@@ -62,13 +62,16 @@
 
 | 维度 | 含义 | 张数 |
 |---|---|---:|
-| **A 路由默认态** | 32 条路由各自的初始加载完成、无浮层状态 | 33 |
+| **A 路由默认态** | 每条路由各自的初始加载完成、无浮层状态 | 33 |
 | **B 标签页态** | 页面内每个可切换标签切换后的内容区 | 36 |
-| **C 浮层态** | 点击按钮后弹出的弹窗 / 抽屉 / 下拉 / 提示条 | 3（首轮）+ 补充穷举 |
-| **D 控件交互态** | 按钮 hover、输入框 focus、输入框已填写、按钮 disabled | 65 |
+| **C 浮层态** | 点击按钮后弹出的弹窗 / 抽屉 / 下拉 / 提示条 | 4 |
+| **D 控件交互态** | 按钮 hover、输入框 focus、输入框已填写、按钮 disabled | 97 |
 | **E 流程结果态** | 发布 / 采集 / 创作 / 流水线等主流程的关键中间态 | 7 |
-| **F 暗色主题** | 32 条路由的暗色对照 | 33 |
-| **合计** | | **177** |
+| **F 暗色主题** | 与 A 维度一一对应的暗色对照 | 33 |
+| **合计** | 亮色 177 + 暗色 33，覆盖 **34** 条路由 | **210** |
+
+> 张数与仓内清单 `apps/desktop/tests/visual-testing/reports/ui-audit-manifest.md`（210 行）**同源**；
+> 该清单同时标注了每张图的**页面 / 位置 / 操作状态**。
 
 每张截图在 `tests/visual-testing/reports/ui-audit-manifest.json` 里带四元标注：
 
@@ -113,7 +116,7 @@ node tests/visual-testing/scripts/ui-audit-preview.js / /dashboard
 
 ### 2.1 颜色：142 种，其中 10 种是几乎一样的灰
 
-出现频次最高的颜色（32 条路由合计）：
+出现频次最高的颜色（33 条路由合计）：
 
 | 频次 | 色值 | 说明 |
 |---:|---|---|
@@ -227,7 +230,7 @@ SVG 声明了 `font-family` 但**不渲染文字**，因此对观感零影响；
 |---|---|
 | 字体栈统一（PingFang 硬编码 5937 → 0） | 不同色值 144（目标 ≤ 40） |
 | 页面标题色 3 → 1 | 不同圆角 22（目标 6 档） |
-| 空态虚线 → 实线发丝 + 柔面 | 不同间距 143（目标 ≤ 30） |
+| P0-6 点名的 4 类空态容器虚线 → 实线发丝（首页两处 + 效能洞察两处；付费占位另走品牌色边条） | 其余 4 类语义空态仍是虚线（见 §3 P0-6 的剩余清单）；不同间距 143（目标 ≤ 30） |
 
 **为什么本轮不继续往下压**：剩下的碎片集中在 **234 个 `.vue` 的 scoped 样式**里
 （`3px` 输入框、`10px` 小徽章、`15px` 小标签各自为政），
@@ -299,6 +302,27 @@ SVG 声明了 `font-family` 但**不渲染文字**，因此对观感零影响；
 - **方案**：虚线 → 实线发丝描边 + `--surface-sunken` 柔面底；
   付费占位额外加 3px 品牌色左边条，表达"未解锁但完整"。
 
+**落地状态（2026-10-22 复盘，逐条核对代码）**：
+
+| 对象 | 选择器 | 状态 |
+|---|---|---|
+| 看板付费占位 | `DashboardLockedPanel.vue` 组件内 | ✅ 已改：柔面 + 3px 品牌色左边条 |
+| 首页零数据 / 最近为空 | `.mp-home-zero-cta` / `.mp-home-recent-empty` | ✅ 已改：实线发丝 + 柔面 |
+| 效能洞察全空态 / 维度空态 | `.pi-empty-state` / `.pi-dim-empty` | ✅ 已改：实线发丝（圆角与底色沿用组件自身口径） |
+| 播客频道空态 | `.podcast-empty` | ⏳ 仍是虚线：podcast-channel 是**像素基线视图**，改样式会让基线漂移，须先按 CI artifact 流程重建基线 |
+| 结果段筛选空态 | `.segment-empty-filter` | ⏳ 同上 |
+| 流水线空态 | `.pipeline-progress-empty` | ⏳ 同上 |
+| 历史缩略图空位 | `.history-thumbnail.is-empty` | ⏳ 同上 |
+
+**保留虚线的三处（语义正确，不改）**：`.upload-zone`（拖放区，虚线是"可拖入"的业界惯例）、
+`.stage-time-guidance`（提示块，虚线是提示语气）、`.s2v-subgroup-title`（分组标题分隔线）。
+
+> **回归锁**：`apps/desktop/src/styles/empty-state.contract.test.js` 三条断言
+> ——① 空态块点名的类名必须在 src 里**真实存在**（上一版点名了 6 个不存在的类名，规则全部空转，
+> 而文档却写成"已改"）；② 被覆盖的类必须真有 `border-style: solid` 覆盖；
+> ③ 仍用虚线的容器必须在例外清单里登记，清单外的虚线空态 ⇒ 判红。
+> 锁的有效性用**变异反证**验过：注入一个不存在的类名，当场判红并点名。
+
 ---
 
 ### P1 — 明显影响"精致感"
@@ -444,7 +468,7 @@ SVG 声明了 `font-family` 但**不渲染文字**，因此对观感零影响；
 | loading | 异步进行中 | 保留原宽度，按钮内联 spinner，文案改为进行时态 | 如「正在发布…」「正在采集…」 |
 | error | 操作失败 | 危险色描边 + 就近错误说明 | 面向用户的错误文案，不得直接抛原始异常（走 `formatUserError`） |
 | success | 操作完成 | 成功色徽章 + 可撤销提示 | 如「发布成功」「草稿已保存」 |
-| empty | 无数据 | `--surface-sunken` 柔面 + 发丝描边（**不是虚线**） | 说明「为什么空」+「下一步做什么」 |
+| empty | 无数据 | 发丝**实线**描边（**不是虚线**）；落在画布上的空态另加 `--surface-sunken` 柔面底（卡片网格内的空态沿用卡片底色） | 说明「为什么空」+「下一步做什么」 |
 | locked | 权益未解锁 | 柔面 + 3px 品牌色左边条 + 锁图标 | 说明「解锁后能看到什么」+ 升级入口 |
 | offline | 断网 | 顶部 `OfflineIndicator` 条 | 「当前处于离线状态，已排队的任务将在恢复网络后继续」 |
 
@@ -539,7 +563,7 @@ SVG 声明了 `font-family` 但**不渲染文字**，因此对观感零影响；
 
 ## 9. 附录：截图索引
 
-完整清单（177 条，含页面 / 位置 / 操作状态标注）见：
+完整清单（210 条，含页面 / 位置 / 操作状态标注）见：
 
 - `apps/desktop/tests/visual-testing/reports/ui-audit-manifest.md`（人读）
 - `apps/desktop/tests/visual-testing/reports/ui-audit-manifest.json`（机读）
@@ -560,7 +584,7 @@ SVG 声明了 `font-family` 但**不渲染文字**，因此对观感零影响；
 
 | 日期 | 版本 | 变更 |
 |---|---|---|
-| 2026-10-20 | v1.0 | 首版：32 路由 / 177 界面面巡检 + 量化诊断 + 6 批次改造方案 + 交互状态与提示文字规格 |
+| 2026-10-20 | v1.0 | 首版：34 路由 / 210 界面面巡检 + 量化诊断 + 6 批次改造方案 + 交互状态与提示文字规格 |
 | 2026-10-20 | v1.1 | CCG 外部双家族评审的逐条处置移入执行记录（`openspec/records/ui-visual-premium.md` §四）——评审轨迹属于执行记录，不属于分析报告 |
 
 ---
diff --git a/01-docs/assets/ui-visual-audit-2026-10-20/06-performance-insights-after.png b/01-docs/assets/ui-visual-audit-2026-10-20/06-performance-insights-after.png
index 6e72530f7..c843fa0c7 100644
Binary files a/01-docs/assets/ui-visual-audit-2026-10-20/06-performance-insights-after.png and b/01-docs/assets/ui-visual-audit-2026-10-20/06-performance-insights-after.png differ
diff --git a/01-docs/assets/ui-visual-audit-2026-10-20/README.md b/01-docs/assets/ui-visual-audit-2026-10-20/README.md
index ea9cd6ac7..3556f1e5e 100644
--- a/01-docs/assets/ui-visual-audit-2026-10-20/README.md
+++ b/01-docs/assets/ui-visual-audit-2026-10-20/README.md
@@ -18,9 +18,12 @@
 | 09 | podcast-channel | `-before.png` | `-after.png` |
 | 10 | video-create | `-before.png` | `-after.png` |
 
-> 全量 177 张界面面截图（含标签页 / 交互态 / 浮层 / 暗色对照）不在库内，
+> 巡检清单收录的 **210 张**界面面截图（亮色 177 + 暗色 33，覆盖 34 条路由；
+> 含标签页 / 交互态 / 浮层 / 流程结果态 / 暗色对照）**不在库内**，
 > 按仓库约定留在 `apps/desktop/tests/visual-testing/screenshots/ui-audit/`（gitignored），
-> 其清单见 `apps/desktop/tests/visual-testing/reports/ui-audit-manifest.md`。
+> 其**人读清单**（每张带页面 / 位置 / 操作状态标注）入库于
+> `apps/desktop/tests/visual-testing/reports/ui-audit-manifest.md`（210 行）。
+> 本目录只挑上表 10 组关键页面的 before/after 入库（**20 张 PNG**）。
 
 ## 证据清单
 
@@ -35,7 +38,7 @@
 - `01-docs/assets/ui-visual-audit-2026-10-20/05-collection-before.png`（81 KB）
 - `01-docs/assets/ui-visual-audit-2026-10-20/05-collection-after.png`（99 KB）
 - `01-docs/assets/ui-visual-audit-2026-10-20/06-performance-insights-before.png`（89 KB）
-- `01-docs/assets/ui-visual-audit-2026-10-20/06-performance-insights-after.png`（154 KB）
+- `01-docs/assets/ui-visual-audit-2026-10-20/06-performance-insights-after.png`（150 KB）
 - `01-docs/assets/ui-visual-audit-2026-10-20/07-hot-topics-before.png`（78 KB）
 - `01-docs/assets/ui-visual-audit-2026-10-20/07-hot-topics-after.png`（152 KB）
 - `01-docs/assets/ui-visual-audit-2026-10-20/08-knowledge-base-before.png`（74 KB）
diff --git a/01-docs/learnings.md b/01-docs/learnings.md
index 6e912da9d..e68c55324 100644
--- a/01-docs/learnings.md
+++ b/01-docs/learnings.md
@@ -1,3 +1,29 @@
+## 拆分文件时，跨文件的常量引用要一起搬——漏一个常量，整条工具链就静默死掉（ui-visual-empty-state，2026-10-22）
+
+### lesson: split-must-carry-cross-file-constants
+
+**现场**：上一轮把 797 行的巡检采集脚本拆成「场景数据 / 浏览器探针 / 编排」三份（为过行数门禁）。
+拆分后 `ui-audit-probes.js` 用了 `READY_TIMEOUT`，而这个常量**定义在被拆走的编排文件里**。
+于是采集脚本对**每一条路由**都抛 `READY_TIMEOUT is not defined`，**一张图都采不出来**（实测 0 张）。
+
+**为什么一直没被发现**：
+1. 仓内那份 210 行的截图清单是拆分**之前**那次运行留下的 ⇒ 表面上看「清单在、图也在」；
+2. 冒烟测试只断言「模块能被 require、导出函数存在」⇒ 恒绿；
+3. **巡检脚本目录完全不在 lint 范围**（lint 脚本只扫 `electron/ src/`）⇒ `no-undef` 从未生效。
+
+**修法（三处一起，缺一不可）**：
+① 补回常量；② 把它纳入 lint 范围并**只开 `no-undef`**（不整包启用 recommended，
+否则会把该目录既有的 `no-useless-assignment` 等无关告警一并变成错，属于借修缺陷扩大改动面）；
+③ 加一条**真的执行一次**的断言（采 1 条路由，断言产出 PNG），而不是只测模块能加载。
+
+**判据**：
+- **拆分不是移动**：跨文件引用的**常量 / 辅助函数 / 配置**要跟着搬运，
+  拆完立刻 `rg` 一遍被拆文件里的标识符，确认每个在新文件里有定义。
+- **「测试能加载模块」≠「工具能干活」**：工具型脚本（采集器 / 生成器 / 迁移脚本）的断言必须是
+  **跑一次真实路径**，否则它的失败模式恰好是「静默产出空结果」。
+- **没被 lint 覆盖的目录 = 没有护栏**：新增工具目录时，第一件事是把它挂进 lint，
+  哪怕只挂一条 `no-undef`——它能抓住「引用了不存在的东西」这一整类缺陷。
+
 ## 视觉基线必须由 CI artifact 的渲染重建——本机重生成会在 CI 侧逐张判「过期」（ui-visual-premium，2026-10-21）
 
 ### lesson: visual-baselines-must-come-from-ci-artifact
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 80a42e366..f65753f4f 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -74,13 +74,13 @@
 
 # [未发布] feat(ui): 桌面端视觉系统升级 —— 统一表面层级、品牌渐变与高级感细节（ui-visual-premium）
 
-- **一句话**：把「视觉」从**每页各写各的**收敛成**一套分层令牌 + 一套观感口径** —— 表面五层、圆角六档、品牌渐变统一、标题与数字排版归一、空态不再用虚线；并落一套**机器可复跑的界面面巡检**（32 路由 / 177 界面面 / 每张标注页面·位置·操作状态）。
+- **一句话**：把「视觉」从**每页各写各的**收敛成**一套分层令牌 + 一套观感口径** —— 表面五层、圆角六档、品牌渐变统一、标题与数字排版归一、P0-6 点名的四类空态不再用虚线；并落一套**机器可复跑的界面面巡检**（34 路由 / 210 界面面：亮 177 + 暗 33 / 每张标注页面·位置·操作状态）。
 - **动因是当场量的，不是推测**：用户反馈「视觉不统一、混乱、粗糙、不精致」。用 `ui-audit-recon.js` 逐路由枚举可见元素的计算样式，得到 **142 种颜色值**（其中 10 种是肉眼难辨的灰）、**22 种圆角**（设计系统只定义了 6 档）、**143 种间距组合**、**3 套字体栈**、**3 种页面标题色**（品牌紫 / 墨色 / 链接蓝）、以及 `19.5px` / `13.3333px` 一类小数像素字号。数字把"感觉不统一"变成了可指认的失败面。
 - **改法（分层，不是换色）**：① **令牌层** `tokens.css` 新增表面/描边/高度/渐变/玻璃/动效/统一字体栈，亮暗两套**同构**（暗底上描边变成"发光的边"而不是"更深的边"）；② **契约层** `cohere-design-system.css` 保持只管「有哪些类、语义是什么」；③ **观感层** `premium-components.css` + `premium-design-system.css` 管「这些类看起来应该怎样」。**观感与契约混在一份文件里，改一次观感就会顶破逐文件行数门禁的登记目标**（实测 TARGET_GROW 1794 > 1698）——分层后契约文件回到 1696 行。
-- **几个具体决定与它们的理由**：卡片与页面底**同色**（都是 `#fff`，只靠 1px `#efefef` 分隔）→ 引入表面阶梯，卡片改白色浮层 + 发丝描边 + 投影；卡片 hover **整块泛粉**（`--soft-stone` #faf6f8）→ 改「升起 + 影加深 + 描边加强」；主按钮是**纯平** `#5048E5` → 改品牌渐变 + 柔光（白字压渐变两端 ≥ 4.5:1，实测 4.91:1 / 5.51:1，亮端锁死在 `#8B3FD9`——再提亮会跌到 3.96:1 不合格）；标题三色并存 → 统一墨色（品牌色只留给图标/状态/CTA）；数据看板数字用 `JetBrains Mono`（本机未装，回退系统等宽体）与首页数字**不同字形** → 统一展示字族 + `tabular-nums`（多卡小数点对齐）；空态与付费占位用**虚线**（产品语义 = "没做完/出错了"）→ 改柔面 + 实线发丝 + 品牌色边条。
+- **几个具体决定与它们的理由**：卡片与页面底**同色**（都是 `#fff`，只靠 1px `#efefef` 分隔）→ 引入表面阶梯，卡片改白色浮层 + 发丝描边 + 投影；卡片 hover **整块泛粉**（`--soft-stone` #faf6f8）→ 改「升起 + 影加深 + 描边加强」；主按钮是**纯平** `#5048E5` → 改品牌渐变 + 柔光（白字压渐变两端 ≥ 4.5:1，实测 4.91:1 / 5.51:1，亮端锁死在 `#8B3FD9`——再提亮会跌到 3.96:1 不合格）；标题三色并存 → 统一墨色（品牌色只留给图标/状态/CTA）；数据看板数字用 `JetBrains Mono`（本机未装，回退系统等宽体）与首页数字**不同字形** → 统一展示字族 + `tabular-nums`（多卡小数点对齐）；空态与付费占位用**虚线**（产品语义 = "没做完/出错了"）→ 付费占位改柔面 + 品牌色边条；空态改实线发丝——**本轮落地的是 P0-6 点名的四类**（首页两处 + 效能洞察两处），其余 4 类语义空态与像素基线视图耦合、改样式会动基线，已连同选择器清单登记为下一阶段（报告 §3 P0-6「落地状态」）。
 - **配套的机器守卫**：① `ui-audit-recon.js` 逐路由统计色/圆角/间距/字体的碎片度；② `ui-audit-capture.js` 按 6 个维度穷举界面面并逐面截图，标注「页面 / 位置 / 操作状态」；③ `ui-audit-scripts.test.js` 的**路由覆盖守卫**——解析 router 全路径与巡检清单求差集，**新增路由漏登记即红**（巡检的价值全在覆盖完整，漏页若无守卫会安静地让报告看着仍然完整）。
 - **守门与代价**：视觉基线属**有意变更**，由 **CI artifact 的渲染重建**后提交（仓库规矩：基线不得用本机 `test:visual:update-baseline` 的产物——本机与 CI runner 字体/渲染环境不同，同一份代码两边实测差 12~20384 px，在 CI 侧会逐张判 `BASELINE_STALE`；重建后判据本体复跑 **40/40 逐像素相等、违规 0**，本机像素回归亮/暗各 20/20 通过）；CCG 外部双家族评审（critic=claude / proposer=opencode）三轮 8 条意见**逐条裁决并全部处置**（毛玻璃 GPU 成本→半径 20px 降到 14px + `prefers-reduced-transparency` 守卫；暗色同构漏检→补断言；正则注入→补 `escapeRegExp`；零单测→补 6 例含路由覆盖守卫与变异反证；外部证据可核→补可 API 复核的公开评论）；`debt-budget` / `max-lines` 两套行数门禁**全程靠拆分与单键清账消化，一处基线都没抬**（`tokens.css` 压到 499 行、巡检脚本拆成四份、Home 样式搬到域级 CSS 后 `--prune` 单键清账）。
-- **文档**：巡检报告与优化方案 `01-docs/UI-VISUAL-AUDIT-2026-10-20.md` · 产品规格 `01-docs/PRD-UI-VISUAL-SYSTEM-2026-10-20.md` · 令牌口径 `01-docs/design-system-usage.md` §四之二 · 执行记录 `openspec/records/ui-visual-premium.md` · 前后对照证据 `01-docs/assets/ui-visual-audit-2026-10-20/`（10 组关键页面，约 3.5MB；全量 387 张按仓库约定留在 gitignored 目录不入库）。
+- **文档**：巡检报告与优化方案 `01-docs/UI-VISUAL-AUDIT-2026-10-20.md` · 产品规格 `01-docs/PRD-UI-VISUAL-SYSTEM-2026-10-20.md` · 令牌口径 `01-docs/design-system-usage.md` §四之二 · 执行记录 `openspec/records/ui-visual-premium.md` · 前后对照证据 `01-docs/assets/ui-visual-audit-2026-10-20/`（10 组关键页面 = **20 张 PNG**，约 3.5MB；巡检清单收录的 **210 张**按仓库约定留在 gitignored 目录不入库，清单本身入库）。
 # [未发布] feat(门禁): 给「主干红着就别往里合」装执行体，并在自己的 PR 上把它跑红过四次（podcast-ci-new-red-gate）
 
 - feat(门禁): 给「主干红着就别往里合」装上执行体——新增 `scripts/check-main-red.js` + 判据本体 `scripts/lib/main-red.js`，`merge-when-green.sh` 与 `merge-when-green.ps1` 两个合并入口都强制在 REST 合并动作之前调用它（AGENTS「PR 自动合并」判据第 2 条从此不再靠会话临场判断）。动因是实测：该判据比 GitHub 的 required 清单更严却只以散文存在，一条**非 required** 的分片红先随窗口合进 main，main 转红后反过来把之后每个 PR 的 required `Gate Result` 判红，两个 PR 被冻约 40 分钟，而冻住它们的不是自己的改动。
diff --git a/apps/desktop/eslint.config.mjs b/apps/desktop/eslint.config.mjs
index 31045b0c9..afa8e2424 100644
--- a/apps/desktop/eslint.config.mjs
+++ b/apps/desktop/eslint.config.mjs
@@ -73,6 +73,30 @@ export default [
     },
   },
 
+  // 视觉巡检脚本（tests/visual-testing/scripts/ — CommonJS + Node）
+  //
+  // 为什么单列一段：这段目录**以前完全不在 lint 范围内**
+  // （lint 脚本只扫 `electron/ src/`），于是「探针文件引用了另一个文件里的常量」
+  // 这类错误没有任何门禁能看见 —— 拆分巡检脚本时漏带 READY_TIMEOUT，
+  // 采集脚本对每条路由都抛「READY_TIMEOUT is not defined」，一张图都采不出来，
+  // 而 CI 的冒烟测试只测「模块能不能被 require」，照样全绿。
+  // 这里把 no-undef（js.configs.recommended 自带）落到这一段：未定义的标识符 = 错。
+  {
+    files: ["tests/visual-testing/scripts/**/*.js"],
+    languageOptions: {
+      ecmaVersion: "latest",
+      sourceType: "commonjs",
+      globals: { ...globals.node, ...globals.commonjs },
+    },
+    rules: {
+      // 只开 no-undef（未定义的标识符 = 错）：这是能抓住上面那类缺陷的规则。
+      // 不整包启用 js.configs.recommended —— 那会把这一段目录里既有的
+      // no-useless-assignment / no-empty 等无关告警一并变成错，
+      // 属于借修缺陷之名扩大改动面。这里只补**缺的那一条**。
+      "no-undef": "error",
+    },
+  },
+
   // Test files
   {
     files: ["**/*.test.js", "**/*.spec.js", "**/__mocks__/**"],
diff --git a/apps/desktop/package.json b/apps/desktop/package.json
index 480f83e77..11d4ecd76 100755
--- a/apps/desktop/package.json
+++ b/apps/desktop/package.json
@@ -17,7 +17,7 @@
     "preview": "vite preview",
     "test": "vitest run",
     "build:ts": "tsc",
-    "lint": "eslint electron/ src/ --quiet",
+    "lint": "eslint electron/ src/ tests/visual-testing/scripts/ --quiet",
     "lint:warnings": "eslint electron/ src/",
     "lint:fix": "eslint electron/ src/ --fix",
     "format": "prettier --check \"electron/**/*.js\" \"src/**/*.{js,vue}\"",
diff --git a/apps/desktop/src/styles/empty-state.contract.test.js b/apps/desktop/src/styles/empty-state.contract.test.js
new file mode 100644
index 000000000..840ee1223
--- /dev/null
+++ b/apps/desktop/src/styles/empty-state.contract.test.js
@@ -0,0 +1,156 @@
+/**
+ * 空态容器样式契约测试（visual-system P0-6 回归锁）
+ *
+ * 钉死三件事：
+ * 1. **不得出现死选择器**：`styles/premium-design-system.css` 的空态块里点名的每个类名，
+ *    都必须在 src 里真实存在。上一版点名了 6 个**代码里根本没有**的类名
+ *    （`.pi-empty-surface` / `.empty-surface` / `.insight-empty` / `.perf-empty` /
+ *    `.insight-empty-card` / `.perf-empty-card`），规则一条也没命中，
+ *    而文档却写成「空态虚线已改实线」——这正是本锁要拦的形态。
+ * 2. **被覆盖的空态容器不得再声明虚线**：覆盖到的类，组件自身也不许再写 `dashed`，
+ *    否则两处规则互相打架，渲染结果取决于加载顺序。
+ * 3. **仍用虚线的容器必须在例外清单里登记**：清单外的虚线空态容器 = 新增债务 ⇒ 判红；
+ *    清单里的项若已经不虚线 ⇒ 清单陈旧 ⇒ 判红（清单必须随代码一起更新）。
+ *
+ * 断言规范（QM-3）：结构类断言用 toEqual / toBe，不清一色 toContain。
+ */
+import { describe, expect, it } from 'vitest'
+import { readFileSync, readdirSync, statSync } from 'node:fs'
+import { fileURLToPath } from 'node:url'
+import path from 'node:path'
+
+const here = path.dirname(fileURLToPath(import.meta.url))
+const srcRoot = path.resolve(here, '..')
+const read = (rel) => readFileSync(path.join(srcRoot, rel), 'utf8')
+
+const premiumCss = read('styles/premium-design-system.css')
+
+/** 递归收集 src 下所有 .vue / .css 文件 */
+function collectStyleFiles (dir, out = []) {
+  for (const name of readdirSync(dir)) {
+    if (name === 'node_modules' || name.startsWith('.')) continue
+    const full = path.join(dir, name)
+    const st = statSync(full)
+    if (st.isDirectory()) collectStyleFiles(full, out)
+    else if (/\.(vue|css)$/.test(name)) out.push(full)
+  }
+  return out
+}
+
+const styleFiles = collectStyleFiles(srcRoot)
+const styleTexts = styleFiles.map((f) => ({ file: path.relative(srcRoot, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }))
+/**
+ * 「类名真实存在」的检索域：**排除 premium-design-system.css 自身**。
+ * 否则空态块里点名的类名会在本文件里匹配到自己 —— 锁就成了恒绿的自证。
+ */
+const componentStyleText = styleTexts
+  .filter((s) => s.file !== 'styles/premium-design-system.css')
+  .map((s) => s.text).join('\n')
+
+/** 取 premium 里「12. 空态」那一节 */
+function emptyStateSection (css) {
+  const start = css.indexOf('12. 空态')
+  if (start < 0) return ''
+  const rest = css.slice(start)
+  const next = rest.indexOf('\n/* ---', 10)
+  return next < 0 ? rest : rest.slice(0, next)
+}
+
+/** 剥掉 CSS 注释：块注释 + 块注释续行（`*` 开头）+ 行注释 */
+function stripCssComments (text) {
+  return String(text)
+    .replace(/\/\*[\s\S]*?\*\//g, '')
+    .replace(/^\s*\*.*$/gm, '')
+    .replace(/^\s*\/\/.*$/gm, '')
+}
+
+/** 空态块里点名的类名（先剥掉注释：注释里出现的类名不是「点名」） */
+function namedClasses (section) {
+  const stripped = stripCssComments(section)
+  return [...new Set([...stripped.matchAll(/\.([a-z][a-z0-9-]+)/g)].map((m) => m[1]))]
+}
+
+/** 找出所有「选择器里带 empty/zero 且声明了 dashed」的规则，返回类名 */
+function dashedEmptyStateClasses () {
+  const hits = new Set()
+  for (const { text } of styleTexts) {
+    for (const m of text.matchAll(/\.[a-z][a-z0-9-]*(?:empty|zero)[a-z0-9-]*[^{}]*\{[^{}]*dashed[^{}]*\}/gi)) {
+      for (const c of m[0].matchAll(/\.([a-z][a-z0-9-]+)/g)) hits.add(c[1])
+    }
+  }
+  return [...hits].sort()
+}
+
+/**
+ * 仍用虚线的容器登记清单。
+ * kind='keep' —— 虚线在这里语义正确，**不打算改**（改动会伤到惯例或另有语义）。
+ * kind='defer' —— 语义空态、**应该**改，但它落在 20 张像素基线视图里，
+ *                 改样式会让基线漂移，必须按 CI artifact 流程重建基线后再改。
+ */
+const DASHED_REGISTRY = [
+  { cls: 'podcast-empty', kind: 'defer', why: '播客频道空态；podcast-channel 是像素基线视图，改样式须先重建基线' },
+  { cls: 'segment-empty-filter', kind: 'defer', why: '结果段筛选空态；落在发布/创作基线视图，须先重建基线' },
+  { cls: 'pipeline-progress-empty', kind: 'defer', why: '流水线空态；create-pipeline 是像素基线视图，须先重建基线' },
+  { cls: 'is-empty', kind: 'defer', why: '历史缩略图空位；create-history 是像素基线视图，须先重建基线' },
+  { cls: 'upload-zone', kind: 'keep', why: '拖放区：虚线是「可拖入」的业界惯例，不是「未完成」' },
+  { cls: 'stage-time-guidance', kind: 'keep', why: '时间说明提示块：虚线是提示语气，不是空态' },
+  { cls: 's2v-subgroup-title', kind: 'keep', why: '分组标题的分隔虚线：语义是分隔线，不是空态' },
+  { cls: 's2v-estimate-note', kind: 'keep', why: '估算占位的左侧虚线标记：语义是「这一行还没填」，不是空态' }
+]
+
+/** 本轮已覆盖的空态容器（P0-6 点名的四类） */
+const COVERED = ['mp-home-zero-cta', 'mp-home-recent-empty', 'pi-empty-state', 'pi-dim-empty']
+
+describe('空态容器样式契约（P0-6）', () => {
+  it('空态块存在，且点名了四类目标容器', () => {
+    const section = emptyStateSection(premiumCss)
+    expect(section.length).toBeGreaterThan(0)
+    const named = namedClasses(section)
+    for (const cls of COVERED) expect(named).toContain(cls)
+  })
+
+  it('不得出现死选择器：空态块点名的类名都必须在 src 里真实存在', () => {
+    const section = emptyStateSection(premiumCss)
+    const named = namedClasses(section)
+    const missing = named.filter((cls) => !new RegExp('\\.' + cls + '(?![a-z0-9-])').test(componentStyleText))
+    expect(missing).toEqual([])
+  })
+
+  it('被覆盖的空态容器：观感层对每个类都有 solid 覆盖（组件保留 dashed，由 !important 覆盖改实线）', () => {
+    const section = emptyStateSection(premiumCss)
+    const missing = COVERED.filter((cls) => {
+      // 该类必须出现在空态块里，且紧邻的规则体里有 border-style: solid
+      const re = new RegExp('\\.' + cls + '(?![a-z0-9-])[^\\{]*\\{([^\\}]*)\\}', 'i')
+      const m = section.match(re)
+      return !m || !/border-style\s*:\s*solid/.test(m[1])
+    })
+    expect(missing).toEqual([])
+  })
+
+  it('仍用虚线的空态容器：扣掉被观感层改实线的，其余必须全部在例外清单里登记，且清单不陈旧', () => {
+    const registered = DASHED_REGISTRY.map((r) => r.cls)
+    const section = emptyStateSection(premiumCss)
+    // 被观感层改实线的类：不算「仍用虚线」
+    const covered = COVERED.filter((cls) => new RegExp('\\.' + cls + '(?![a-z0-9-])', 'i').test(section))
+    // ① 清单外的虚线空态容器 = 新增债务
+    const found = dashedEmptyStateClasses()
+    const unregistered = found.filter((cls) => !registered.includes(cls) && !covered.includes(cls))
+    expect(unregistered).toEqual([])
+    // ② 清单里标 defer 的每一项，代码里确实还在用虚线（清单必须是活的）
+    const stale = DASHED_REGISTRY
+      .filter((r) => r.kind === 'defer')
+      .filter((r) => {
+        const re = new RegExp('\\.' + r.cls + '(?![a-z0-9-])[^\\{]*\\{[^\\}]*dashed', 'i')
+        return !styleTexts.some(({ file, text }) => file !== 'styles/premium-design-system.css' && re.test(text))
+      })
+      .map((r) => r.cls)
+    expect(stale).toEqual([])
+  })
+
+  it('例外清单每一项都写明了保留或延后的理由', () => {
+    const noWhy = DASHED_REGISTRY.filter((r) => !r.why || r.why.trim().length < 8).map((r) => r.cls)
+    expect(noWhy).toEqual([])
+    const badKind = DASHED_REGISTRY.filter((r) => r.kind !== 'keep' && r.kind !== 'defer').map((r) => r.cls)
+    expect(badKind).toEqual([])
+  })
+})
diff --git a/apps/desktop/src/styles/premium-design-system.css b/apps/desktop/src/styles/premium-design-system.css
index 2ff24c493..08cc6fed5 100644
--- a/apps/desktop/src/styles/premium-design-system.css
+++ b/apps/desktop/src/styles/premium-design-system.css
@@ -385,26 +385,37 @@ body {
 }
 
 /* ---------------------------------------------------------------------------
- * 12. 空态：虚线框 → 柔面 + 品牌淡边
+ * 12. 空态：虚线框 → 实线发丝描边
  * ---------------------------------------------------------------------------
- * 巡检实测：大量空态容器用 `1px dashed` 描边。虚线在产品界面里的语义是
+ * 巡检实测：空态容器用 `1px dashed` 描边。虚线在产品界面里的语义是
  * 「这里没画完 / 出错了」，而不是「这里还没有数据」——
  * 它让空态看起来像 bug，也让整页显得毛糙。
- * 统一改为：柔面底 + 发丝描边 + 品牌淡色描边，内容仍然是诚实的空态文案。
- */
-.pi-empty-surface,
-.empty-surface,
-.insight-empty,
-.perf-empty {
-  border: 1px solid var(--hairline) !important;
+ * 改为：发丝实线描边，内容仍然是诚实的空态文案。
+ *
+ * ⚠ 本块点名的每个类名都必须在 src 里**真实存在**——否则规则一条也命中不了，
+ *   而文档却会写成「已改」。上一版就因此留了 6 个**代码里根本没有**的类名
+ *   （`.pi-empty-surface` / `.empty-surface` / `.insight-empty` / `.perf-empty` /
+ *    `.insight-empty-card` / `.perf-empty-card`），规则全部空转，
+ *   效能洞察的空态因此仍是虚线。回归锁见 `styles/empty-state.contract.test.js`。
+ *
+ * 覆盖范围 = 报告 P0-6 点名的四类：
+ *   - `.mp-home-zero-cta` / `.mp-home-recent-empty` —— 首页零数据与「最近为空」
+ *   - `.pi-empty-state` / `.pi-dim-empty`             —— 效能洞察的全空态与维度空态
+ * 付费占位（DashboardLockedPanel）走组件内的品牌色左边条，不在本块。
+ * --------------------------------------------------------------------------- */
+
+/* 首页两处空态：底色用柔面（它们直接落在画布上）。 */
+:where(.mp-home-zero-cta, .mp-home-recent-empty) {
+  border-style: solid !important;
+  border-color: var(--hairline) !important;
   border-radius: var(--r-lg) !important;
   background: var(--surface-sunken) !important;
 }
 
-/* 兼容以 dashed 描边的空态容器：把虚线改实（不改结构、不改文案） */
-:where(.mp-home-zero-cta, .mp-home-recent-empty, .insight-empty-card, .perf-empty-card) {
+/* 效能洞察两处空态：它们是**卡片网格里的卡片**，底色与圆角沿用组件自身口径，
+   这里只把虚线改实线发丝（否则白卡套柔面会显脏）。 */
+.pi-empty-state,
+.pi-dim-empty {
   border-style: solid !important;
   border-color: var(--hairline) !important;
-  border-radius: var(--r-lg) !important;
-  background: var(--surface-sunken) !important;
 }
diff --git a/apps/desktop/tests/visual-testing/scripts/curate-ui-audit-evidence.js b/apps/desktop/tests/visual-testing/scripts/curate-ui-audit-evidence.js
index edb79192a..a29cb5ac4 100644
--- a/apps/desktop/tests/visual-testing/scripts/curate-ui-audit-evidence.js
+++ b/apps/desktop/tests/visual-testing/scripts/curate-ui-audit-evidence.js
@@ -2,7 +2,8 @@
  * 把视觉巡检的「改造前 / 改造后」对照截图挑出一组关键页，落到可入库的文档资产目录。
  *
  * 为什么只挑一组：
- *   全量 387 张截图共 48 MB，且 `tests/visual-testing/screenshots/` 按仓库约定是 gitignored
+ *   巡检清单收录 210 张（亮 177 + 暗 33，覆盖 34 条路由），且
+ *   `tests/visual-testing/screenshots/` 按仓库约定是 gitignored
  *   （原始渲染不入库，只留 base-screenshots 里的评审基线）。
  *   但报告需要「肉眼可证」的证据，所以按 `01-docs/assets/` 的既有惯例挑一组代表性页面入库。
  *
diff --git a/apps/desktop/tests/visual-testing/scripts/ui-audit-probes.js b/apps/desktop/tests/visual-testing/scripts/ui-audit-probes.js
index 583d8d05e..85a29cbe2 100644
--- a/apps/desktop/tests/visual-testing/scripts/ui-audit-probes.js
+++ b/apps/desktop/tests/visual-testing/scripts/ui-audit-probes.js
@@ -21,6 +21,18 @@ const STABLE_RENDERING_CSS = `
   }
 `
 
+/**
+ * 页面就绪等待上限（毫秒）。
+ *
+ * ⚠ 这个常量曾在拆分时漏带：探针文件引用了 READY_TIMEOUT，但定义留在了
+ *   ui-audit-capture.js 里 —— 于是拆分后的采集脚本对**每一条路由**都抛
+ *   「READY_TIMEOUT is not defined」，一张图都采不出来（巡检清单的 210 行
+ *   是拆分**之前**那次运行留下的，所以表面上看不出问题）。
+ *   教训见 `ui-audit-scripts.test.js` 的「采集脚本必须真能采出图」一条：
+ *   只测「函数能不能被 require」不够，必须真的跑一次。
+ */
+const READY_TIMEOUT = 20000
+
 /** 稳定化页面：禁用动画、等待字体与两帧 */
 async function stabilize (page) {
   await page.addStyleTag({ content: STABLE_RENDERING_CSS })
diff --git a/openspec/records/ui-visual-empty-state.md b/openspec/records/ui-visual-empty-state.md
new file mode 100644
index 000000000..c72cef793
--- /dev/null
+++ b/openspec/records/ui-visual-empty-state.md
@@ -0,0 +1,92 @@
+---
+title: "ui-visual-empty-state：补完 P0-6 空态收敛 + 修巡检采集脚本的真缺陷 + 把交付数字改准"
+change: ui-visual-empty-state
+branch: ui-visual-empty-state
+date: 2026-10-22
+status: executed
+---
+
+# 执行记录：补完 P0-6 + 修采集脚本缺陷 + 数字改准
+
+## 动因
+
+上一轮交付（PR #4124，已合入主干 `ebba9a055c5a9fffdc0ec5396cd0332be848e5ae`）在**交付后复核**中被查出三处
+「**文档说的比代码做到的多**」。这类偏差比功能缺失更坏：分析报告是本轮的交付物，
+它对「哪些已达成、哪些没达成」的说法必须与代码逐条对得上，否则读者会按不存在的结论做决策。
+
+复核结论（逐条对着代码与仓内清单核）：
+
+| # | 偏差 | 事实 |
+|---|---|---|
+| 1 | 报告把「空态虚线 → 实线发丝 + 柔面」列为**已达成** | 只落地了 3 处（首页两处空态 + 看板付费占位）；**效能洞察的两处空态仍是虚线**——观感层那条覆盖点名了 `.insight-empty-card` / `.perf-empty-card` 等 **6 个代码里根本不存在的类名**，规则一条也没命中 |
+| 2 | 报告 / CHANGELOG / 执行记录的头条数字与它自己指向的清单对不上 | 仓内 `ui-audit-manifest.md` 是 **210 行**（亮 177 + 暗 33，覆盖 34 条路由），报告与 CHANGELOG 写的是 **177**（那是**亮色那批**的张数，被当成了总数） |
+| 3 | 面向用户的完工声明把计数说大了 | 视觉基线目录内是 **43 个 PNG**（40 张像素基线 + 3 张 autonomous-loop 专属），证据资产是 **20 张 PNG = 10 组**（+1 份 README） |
+
+## 变更类型与隔离声明
+
+- **变更类型**：混合 PR（运行时样式 + lint 覆盖 + 回归测试 + 文档更正 + 证据图刷新）。
+- **隔离方式**：独立 worktree `<仓库父目录>/mp-worktrees/mp-ui-visual-empty-state`（非 C 盘），
+  分支 `ui-visual-empty-state`，由 `scripts/start-mp-task.ps1 -TaskName ui-visual-empty-state` 创建。
+  共享主目录保持 `main` clean，未直接改动。
+- **不改**：业务逻辑、数据结构、IPC 契约、信息架构、路由与信息层级。
+
+### 文件范围声明（供 CCG 决策层做范围漂移核对）
+
+| 类别 | 路径 | 说明 |
+|---|---|---|
+| 观感层 | `apps/desktop/src/styles/premium-design-system.css` | 空态块：删 6 个死选择器，补上真实类名 `.pi-empty-state` / `.pi-dim-empty` |
+| 测试（新增） | `apps/desktop/src/styles/empty-state.contract.test.js` | 空态容器契约锁（3 组断言 + 变异反证） |
+| 巡检脚本 | `apps/desktop/tests/visual-testing/scripts/ui-audit-probes.js` | 补回拆分时漏带的 `READY_TIMEOUT` |
+| 巡检脚本 | `apps/desktop/tests/visual-testing/scripts/curate-ui-audit-evidence.js` | 注释里的旧张数更正 |
+| lint 配置 | `apps/desktop/eslint.config.mjs` + `apps/desktop/package.json` | 把 `tests/visual-testing/scripts/` 纳入 lint（此前**完全不在** lint 范围），只开 `no-undef` |
+| 证据资产 | `01-docs/assets/ui-visual-audit-2026-10-20/06-performance-insights-after.png` | 刷新为「实线发丝」后的渲染 |
+| 文档 | `01-docs/UI-VISUAL-AUDIT-2026-10-20.md`、`01-docs/assets/ui-visual-audit-2026-10-20/README.md`、`CHANGELOG.md` | 数字与口径改准 |
+| 执行记录 | `openspec/records/ui-visual-premium.md`（更正）+ 本文件（新增） | 前者数字更正；本文件为本分支记录 |
+
+## 执行内容
+
+| # | 内容 | 落地 |
+|---|---|---|
+| 1 | 补完 P0-6：效能洞察两处空态改实线发丝 | `styles/premium-design-system.css` |
+| 2 | 删掉 6 个**代码里不存在**的死选择器（`.pi-empty-surface` / `.empty-surface` / `.insight-empty` / `.perf-empty` / `.insight-empty-card` / `.perf-empty-card`） | 同上 |
+| 3 | 新增空态容器契约锁：① 空态块点名的类名必须在 src 真实存在 ② 被覆盖的类必须有 `border-style: solid` ③ 仍用虚线的容器必须在例外清单里登记，清单外新增 ⇒ 判红 | `styles/empty-state.contract.test.js` |
+| 4 | **修巡检采集脚本的真缺陷**：拆分时 `READY_TIMEOUT` 漏带，采集脚本对每条路由都抛 `READY_TIMEOUT is not defined`，**一张图都采不出来**（实测 0 张；仓内 210 行清单是拆分**之前**那次运行留下的，所以表面看不出问题） | `scripts/ui-audit-probes.js` |
+| 5 | 补上「为什么没被门禁拦住」：巡检脚本目录**完全不在 lint 范围**（lint 只扫 `electron/ src/`）→ 纳入并只开 `no-undef` | `eslint.config.mjs` + `package.json` |
+| 6 | 数字改准：177→210 张、32→34 路由、40 张基线→43 个 PNG、387→210、证据资产 21→20 张 | 报告 / CHANGELOG / 执行记录 / 证据 README |
+| 7 | 刷新效能洞察的 after 证据图（实线发丝后的渲染） | `01-docs/assets/…/06-performance-insights-after.png` |
+
+## 关键判据
+
+- **空态契约锁**：5 例全绿；**变异反证**验过有效性 —— 注入一个不存在的类名 `.zz-dead-probe-selector`
+  ⇒ 当场判红并点名；把 `READY_TIMEOUT` 的定义整条删掉 ⇒ eslint `no-undef` 判红并点名
+  （此前这处缺陷能活下来，正是因为它既不在 lint 范围、也没有任何测试真的执行过采集路径）。
+- **采集脚本可跑**：修复后 `node ui-audit-capture.js --phase=a` 实测 **33 张**（修复前 0 张）。
+- **视觉结果**：效能洞察页「暂无归因数据」大面板与 4 张维度卡，实测均为**实线发丝**（见刷新的 after 证据图）。
+- **像素基线中性**：本次改的两个类只出现在 `PerformanceInsights.vue`，而效能洞察**不在** 20 张像素基线视图里
+  ⇒ 基线不受影响，无需重建。
+
+## 遗留（如实登记，未在本轮闭合）
+
+| 项 | 状态 | 原因 / 出口 |
+|---|---|---|
+| 其余 4 类语义空态仍是虚线：`.podcast-empty` / `.segment-empty-filter` / `.pipeline-progress-empty` / `.history-thumbnail.is-empty` | ⏳ 未改 | 它们落在 20 张**像素基线视图**里，改样式会让基线漂移 ⇒ 须先按「CI artifact 渲染重建基线」的流程重建基线，再改样式。选择器清单与理由见报告 §3 P0-6「落地状态」与契约锁的 `DASHED_REGISTRY`（`kind: 'defer'`） |
+| 保留虚线的 3 处：`.upload-zone`（拖放区惯例）/ `.stage-time-guidance`（提示语气）/ `.s2v-subgroup-title`（分隔线） | ✅ 有意保留 | 语义正确，不是「未完成」；登记在契约锁 `kind: 'keep'` |
+| R6 真实 Electron 窗口 GPU 帧率实测 + 暗色真机复核 | ⏳ 沿用上一轮 | 见 `openspec/records/ui-visual-premium.md` §R6 |
+| R7 新增 `.adversarial` SHA 对齐门禁 | ⏳ 沿用上一轮 | 属改守门结构，按铁律交人工 |
+
+## 四、CCG 外部双家族评审与处置
+
+（本轮评审与逐条处置见本文件 §四，由 `sh scripts/deep-review.sh` 真跑产出；
+产物落在 `.adversarial/ccg-deep-<sha>/`，可复核命令写在 PR 评论里。）
+
+## 五、远程同步
+
+- 保留门禁：变更类型与隔离声明 ✅ | 空态契约锁 5/5 ✅ | 采集脚本 33 张 ✅ | lint 覆盖 ✅ | 文档数字改准 ✅ | 远程同步 PR 待开
+
+| 远程同步 | 由门禁推导 |
+| --- | --- |
+
+> 状态列写「由门禁推导」而非手写 `PASS`：收口由 `scripts/lib/merge-ledger.js` 按主干历史
+> 推导（合并后自动闭合），手写闭合词会被 `check-gate-record-debt.js` 判 `prematureClaim` 红。
+> 依据：`openspec/specs/openspec-integration/spec.md`「分层分支策略」Requirement
+> + `change: gate-record-sync-derived-status` / `change: ban-record-closure-backfill-pr`。
diff --git a/openspec/records/ui-visual-premium.md b/openspec/records/ui-visual-premium.md
index b40379690..e9c9ad284 100644
--- a/openspec/records/ui-visual-premium.md
+++ b/openspec/records/ui-visual-premium.md
@@ -34,7 +34,7 @@ status: executed
 | 测试 | `apps/desktop/src/views/Dashboard.style-guard.test.js` | hero 卡断言改为「已定义渐变 token」+ 暗色同构断言 |
 | 测试（新增） | `apps/desktop/tests/visual-testing/ui-audit-scripts.test.js` | 巡检脚本冒烟 + 路由覆盖守卫 + 变异反证 |
 | 巡检脚本（新增） | `apps/desktop/tests/visual-testing/scripts/ui-audit-{recon,capture,preview,scenes,probes}.js`、`ui-audit-scripts.lib.js`、`accept-baselines.js`、`curate-ui-audit-evidence.js` | 界面面枚举 / 全量截图 / 单页预览 / 场景数据 / 浏览器探针 / 纯函数库 / 基线接受 / 证据挑选 |
-| 视觉基线 | `apps/desktop/tests/visual-testing/base-screenshots/*.png` | 40 张（20 视图 × 亮/暗）随本次**有意视觉变更**更新；**来源是 CI artifact 的渲染**，不是本机产物（见「基线来源」小节） |
+| 视觉基线 | `apps/desktop/tests/visual-testing/base-screenshots/*.png` | 目录内 **43 个 PNG** = 40 张像素基线（20 视图 × 亮/暗）+ 3 张 autonomous-loop 专属基线（CI 无渲染）；像素基线随本次**有意视觉变更**更新，**来源是 CI artifact 的渲染**，不是本机产物（见「基线来源」小节） |
 | 文档 | `01-docs/UI-VISUAL-AUDIT-2026-10-20.md`、`01-docs/PRD-UI-VISUAL-SYSTEM-2026-10-20.md`、`01-docs/design-system-usage.md` | 巡检报告（含改造后复测 §2.6）/ PRD / 令牌口径 |
 | 证据资产（新增） | `01-docs/assets/ui-visual-audit-2026-10-20/*.png` | 10 组 before/after（约 3.5MB） |
 | 配置 | `.gitignore` | 为证据资产加 `!` 例外（根规则有全局 `*.png`） |
@@ -45,7 +45,7 @@ status: executed
 | # | 内容 | 落地 |
 |---|---|---|
 | 1 | 全量界面面侦察（机器枚举） | `tests/visual-testing/scripts/ui-audit-recon.js` |
-| 2 | 全量界面面截图巡检（6 维度 177 张） | `tests/visual-testing/scripts/ui-audit-capture.js` |
+| 2 | 全量界面面截图巡检（6 维度 **210 张**：亮 177 + 暗 33，覆盖 34 条路由） | `tests/visual-testing/scripts/ui-audit-capture.js` |
 | 3 | 令牌层：表面/描边/高度/渐变/玻璃/动效/字体栈 + 暗色同构 | `src/styles/tokens.css` |
 | 4 | 共享类观感升级 | `src/styles/cohere-design-system.css` |
 | 5 | 高级感视觉层（新增） | `src/styles/premium-design-system.css` + `src/main.js` |
@@ -175,7 +175,7 @@ maintainability 2），correctness 亦不上调。
 | i3 | auth 高危项同样引用同一不可验证 URL | **已修**——补可机器复核的高危面零命中取证：`git show --name-only HEAD \| grep -E 'credential-\|account-state-lock\|/auth/\|login-state\|fingerprint'` 零命中，3124 行新增行全扫鉴权/加密关键字零命中 |
 | i4 | 毛玻璃缺真实 Electron 帧率数据 | **未实测**——**登记为 R6**，performance 分维持 4 不上调 |
 | i5 | 巡检脚本行数多、单测少 | **已修**——脚本拆分为「场景数据 / 浏览器探针 / 编排 / 纯函数库」；抽出 `ui-audit-scripts.lib.js#computeUncoveredRoutes` 纯函数，用例往 router 注入假路由 `/__mutation-probe`，断言守卫**当场判红并点名它**（变异反证，不是只断言「当前是绿的」） |
-| i6 | 二进制资产与全量集双轨、无单一来源清单 | **已修**——仓内保留 10 组 before/after（约 3.5MB）+ 177 条标注清单；全量 387 张按仓库约定留在 gitignored 目录 |
+| i6 | 二进制资产与全量集双轨、无单一来源清单 | **已修**——仓内保留 10 组 before/after（**20 张 PNG**，约 3.5MB）+ **210 条**标注清单（`ui-audit-manifest.md`，入库）；清单收录的 210 张渲染按仓库约定留在 gitignored 目录 |
 | i7 | 暗色像素回归只覆盖 headless | **部分成立**——**登记为 R6**，真实 Electron 窗口复核列入待办 |
 | i8 | 审计轨迹靠人工对齐 SHA | **部分成立**——新增 CI 门禁属「改守门结构」→ **登记为 R7 交人工**；本 PR 先把能对齐的对齐（见 §四.4） |
 

```

> 这是机械生成的变更提案，不代表任何设计意图。评审方请只针对上述内容挑刺。