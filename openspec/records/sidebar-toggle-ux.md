---
record: sidebar-toggle-ux
task: 提升左侧菜单折叠按钮的可发现性：语义化图标（面板+箭头）、常态描边/底色、图标对比度达 WCAG AA、收起态品牌色恢复锚点
date: 2026-10-19
---

## 本次执行记录：折叠按钮可发现性优化（sidebar-toggle-ux，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（运行时代码 `apps/desktop/src/**`）⇒ 隔离 worktree `mp-worktrees/mp-sidebar-toggle-ux`、裸分支 `sidebar-toggle-ux`（`git rev-parse --abbrev-ref HEAD` 实证）；由 `scripts/session-init.sh sidebar-toggle-ux` 创建，`verify-worktree-deps.js` 11 项解析通过 |
| 第一性原因（QM-5 ①） | ✅ | 用户反馈「按钮样式太不明显，根本让人注意不到」。三个独立成因：**①图形不表意** —— 双向 chevron（「<>」）在通行图标语义里是「代码/展开更多」，与「收起侧栏」无关；**②两态共用同一图形** —— 收起/展开只靠颜色区分（primary vs secondary），是单通道编码，对色觉障碍用户失效，普通用户也无法从图标判断当前状态；**③常态几乎不可见** —— 实测图标色对 TabBar 背景亮色 **4.40:1**（差 0.1 不达 AA 4.5:1）、边框 `transparent`、底色 `transparent`，视觉上与纯背景同形 |
| 逃逸分析（QM-5 ②） | ✅ | **单测层**：原用例只断言「svg 有 2 条 path」（`SidebarToggleButton.test.js:59`），**把具体实现（双 chevron）写成了契约**，因此样式层怎么改都不会红 —— 测试锚在实现细节而非可发现性；**视觉门禁层**：CI `PIXEL_THRESHOLD=0.06`（整图 6%），而按钮 32×28 仅占 1280×720 的 **0.1%**，即使整块变色整图差分也远低于阈值 ⇒ **视觉门禁结构上抓不到单个小控件的样式退化**；**评审层**：PR #3916 的评审关注了行为正确性（折叠/跨进程同步/宽度守卫），呈现层「能不能被注意到」不是代码正确性问题，无人从「用户会不会发现这个按钮」的角度审过 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 先红后绿。**测试**：新增 `SidebarToggleIcon.test.js`（6 例：两态图形签名不等 / 默认展开态 / 含 rect+path 两类图元 / 面板实心vs虚线 / aria-hidden / 无硬编码色值）；`SidebarToggleButton.test.js` 从 5 例扩到 13 例（原 4 例契约全保留 + 新增 collapsed 透传、常态图标色、非透明边框且**不得用 `--color-border`**、非透明底色、32×28 与 18px、收起态 2px 竖条含 absolute/width/primary 三要素、hover/focus/reduced-motion 不回退、is-collapsed 类）。**先红实证**：`10 failed / 9 passed`，失败原因均为断言不满足（非文件缺失）。**转绿**：`23 passed`（含 TabBar 4 例、App 7 例既有用例） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 原「图标必须是双向 chevron」这条规格由本 change 的 `MODIFIED Requirement` **显式改写**（不再是隐含契约），并新增 2 条 ADDED Requirement（常态可发现性三层判据 / 收起态恢复锚点），共 7 个 Scenario；② 测试从「断言 path 条数」改为「两态图形**签名**不相等」—— 签名法对几何调整不敏感、对「退化成同图形换色」敏感，正是要防的那个退化；③ 视觉层新增**局部截图 + 计算样式**双层证据（整图基线抓不到小控件，此点已写入 design.md 的测试策略）；④ `proposal.md` 记录了三处被实测推翻的初始假设，防止下一轮重新提议「用 `--color-border` 做边框」
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 实测 IDENTICAL；新增文件写 LF 后由 git 按 `core.autocrlf` 落为 CRLF，无混行 |
| 接线棘轮 | ✅ | 新增 `SidebarToggleIcon.test.js` 属**新测试文件** ⇒ 已确认被 `vitest run` 的全量 glob 覆盖（`src/**/*.test.js`），且 CI 的 QG Unit Tests / QG Desktop Shards 全量跑，无需在 workflow 单独点名 |
| QM-1 打包 | ✅ N/A（附依据） | 本 PR **未修改 `apps/desktop/electron/` 下任何文件**（`git diff --name-only origin/main...HEAD -- apps/desktop/electron/` 为空），按 QM-1 的口径（「每次修改 apps/desktop/electron/ 下的代码后」）不适用。渲染层构建正确性另由 `build:vue` 与 CI 的 Build & Release 全量构建覆盖 |
| QM-4 视觉 | ✅ **本 PR 的核心门禁**（含一次**纠正**：初判"基线无需重建"是错的，已按 Gate 7b 的 0 px 判据重建 36 张） | **① 我先犯的错**：像素门禁（`PIXEL_THRESHOLD=0.06`）本地实测亮 20/20 + 暗 20/20 全通过，我据此写下「40 张基线零变化 ⇒ 基线无需重建」。CI 第 4 轮推翻了这个结论 —— 失败的不是视觉回归，是 **`Gate 7b - Baseline freshness`**，它判「基线 == 同一次 CI 渲染，**0 px**」，报 `检查 43 张 / 违规 38 张`、`违规 36 张`。**两个判据度量的是不同命题**：像素套 6% 管"有没有大面积变化"（我的改动 < 6%，确实通过）；Gate 7b 的 0 px 管"基线是否与当前渲染对得上"（我的改动让按钮区域变了，必然不过）。把前者读成后者是**混淆了两个判据的语义**。**② 也不能用 `update-baseline` 修**：`test:visual:update-baseline` 走**像素套**渲染，而 Gate 7b 的 `findRender` 优先取**views 套件**的 `<name>.png`，两套渲染在同一 run 内实测差几百像素（dashboard 350 px、collection 67870 px，确定性非噪声）⇒ 用它更新会让基线**立刻再次脱离** CI 渲染（这正是 `check-baseline-freshness.js` 文件头记的 #2623 历史）；`test-runner.js:561` 的 `UPDATE_BASELINE` 又只在基线**缺失**时创建、不更新已有基线。**③ 实际做法**：下载**同一次 CI run 的渲染产物**（artifact `quality-gate-visual-reports`，来自含本改动的 commit）覆盖基线 —— 基线 == CI 渲染，0 px 成立。结果：**36 张更新 / 2 张未变 / 5 张无渲染**（其中 3 张是 `KNOWN_UNCOVERED` 的 autonomous-loop 专属图，另 2 张 `home-baseline`/`create-story2video-detail` 本次未产图 ⇒ Gate 7b 在 partial 下记 skipped 放行）。**④ 同时保留的独立证据**：像素套绿灯**不构成「改动可见」的证据**（按钮占整图 0.1% ≪ 6% 阈值，结构上抓不到小控件样式退化），故可见性证据另用真实浏览器 `getComputedStyle` 逐项前后对比 + 明暗双主题局部放大截图，见下方「视觉证据」段 |
| QM-6 CCG 双模型外部评审 | ✅ self_play_resolved（**外部 critic 后端 502 不可用，按 AGENTS.md 降级为主代理自扮演；自扮演产出 2 条真实缺陷并已修复**） | **判定**：`ccg-review-decider` 判 `mode=dual`（变更 316 行 > 200 阈值），`deepReview.required=true`。**引擎两次均失败**：`spawnSync .../codeagent-wrapper.exe ETIMEDOUT`（第 1 次 07:47→07:56，第 2 次 07:56→08:06）。**根因定位到环境层而非判定逻辑**：`deep-review.sh --check-deps` 体检通过（wrapper/claude/opencode 三者都可解析），但直接调 `claude -p` 返回 `API Error: 502 请求转发失败: 上游请求失败: client error (Connect). ... check your inference gateway (127.0.0.1:15721)`；网关端口 15721 由 `cc-switch` PID 20436 监听（进程活着、根路径 404 属正常），说明**上游转发失败**。故 wrapper 的 10 分钟超时不是慢，是底层 API 连不上。**处置**：按 AGENTS.md「子代理降级 —— 出现 403/超时等后端不可用错误时立即降级为主代理直接执行，不盲等」，降级为主代理自扮演对抗评审（status 记 `self_play_resolved`，**不谎称 `cleared`**）。**自扮演产出 6 条，逐条裁决**：**F1 upheld 已修**（HIGH）—— 图形签名把 `fill`/`stroke-dasharray` 等**样式**属性也算进"图形"，导致「几何完全一致、只换 fill」这种典型退化签名仍不等 ⇒ 断言假绿，而那正是本条用例要防的退化；已用反证实验证实（构造退化图标：含样式属性的签名判"不同⇒测试通过"，仅几何的签名判"相同⇒测试红"），修法是把签名键收敛到 `d/x/y/w/h/rx` 六个几何属性，样式差异交独立用例覆盖；**F3 upheld 已修**（MEDIUM）—— `border: 1px solid` 断言在全文取第一个匹配，未来若在 `:hover` 等更靠前的规则里也写该声明会误判到那条上（仍"非 transparent"⇒假绿），修法是先锚定 `.sidebar-toggle {…}` 基础块再在块内匹配；**F2 dismissed by 实测**——原怀疑收起态 `stroke-dasharray: 2.2 1.6` 在 18px 图标里 1x 缩放下会糊成实线，实际截 `deviceScaleFactor=1` 真图（32×28 物理像素）确认虚线断点可辨、2px 品牌色锚点醒目，**1x 可辨**；**F4 dismissed by 实测**——原怀疑 focus outline（2px + offset 1px）会被 `overflow` 裁掉，实测按钮 margin-top=4px、高 28px，outline 上下各余 1px 完整落在 36px TabBar 内（`.tab-bar` 是 `overflow-x:auto`，`.mp-shell` 是 `overflow:hidden`，但都不切 outline）；**F5/F6 记录为已知取舍**——`position: relative` 是新引入的层级变化（当前 TabBar 无绝对定位兄弟，无实际影响）、`color-mix` 的 22%/45% 两个百分比是魔数（未抽 token，因为只在按钮一处使用）。裁决全文与反证读数落 `.adversarial/ccg-deep-3adcec35/` 与本记录 |
| 远程同步 | 由门禁推导 | 本行不手写状态词：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导（`MERGE-LEDGER prs=<n>`） |

### 视觉证据（QM-4 主体）

**为什么必须做局部截图，不能只跑整图基线**：CI `PIXEL_THRESHOLD=0.06`（整图 6%），
按钮 32×28 占 1280×720 的 **0.1%**，整块变色后的整图差分仍远低于阈值 ⇒
**整图基线绿灯在这里不构成「改动可见」的证据**，只能证明「没造成大面积布局破坏」。
两者是不同的命题，不能互相冒充。

**① 计算样式逐项对比（真实浏览器 `getComputedStyle`，非估算）**

| 属性 | 改前 | 改后 | 规格要求 |
|------|------|------|---------|
| 宽 × 高 | 30 × 28 | **32 × 28** | 32×28 |
| 图标色（亮） | `rgb(112,112,128)` = `#707080`（secondary，实测 4.40:1） | **`rgb(30,27,75)` = `#1e1b4b`（primary，实测 15.99:1）** | ≥4.5:1 |
| 图标色（暗） | `rgb(180,178,198)` = `#b4b2c6`（实测 7.79:1） | **`rgb(232,232,237)` = `#e8e8ed`（实测 12.80:1）** | ≥4.5:1 |
| 底色（亮） | `rgba(0,0,0,0)` **全透明** | **`rgb(255,255,255)`** | 非 transparent |
| 底色（暗） | 同上 | **`rgb(35,35,41)` = `#232329`** | 非 transparent |
| 边框（亮） | `rgba(0,0,0,0)` **全透明** | **`color(srgb .314 .282 .898 / .22)`** = 品牌紫 22% | 非 transparent 且非 `--color-border` |
| 边框（暗） | 同上 | **`color(srgb .545 .522 1 / .22)`** = 品牌紫 22% | 同上 |
| 图标尺寸 | 16px / viewBox 16 | **18px / viewBox 18** | 18px |
| `position` | `static` | **`relative`** | relative（`::before` 定位基准） |
| 收起态 `::before` | 无 | **`width: 2px`、`background: rgb(80,72,229)`（亮）/ `rgb(139,133,255)`（暗）、`position: absolute`、`left:0 top:4 bottom:4`** | 2px 品牌色锚点、absolute 不占布局 |

> 上表 `::before` 一行是**单测无法覆盖**的部分：jsdom 不支持伪元素计算值，
> 只能在真实浏览器里取。这也是 design.md 里「样式判据分两层」的落地原因。

**② 对比度精算（脚本按 WCAG 相对亮度公式计算，非目测）**

亮色主题（TabBar 背景 `#f4f2ff`）：
- 现状 `#707080`：**4.40:1** ⇒ 不达 AA 4.5:1
- 改后 `#1e1b4b` on `#ffffff`：**15.99:1**
- 收起态锚点 `#5048E5` on `#ffffff`：**6.18:1**（非文本 UI 需 ≥3:1）

暗色主题（TabBar 背景 `#211f2e`）：
- 现状 `#b4b2c6`：**7.79:1** ⇒ 本就达标（**初始诊断说「约 3:1」是估算过高，已修正**）
- 改后 `#e8e8ed` on `#232329`：**12.80:1**
- 收起态锚点 `#8b85ff` on `#232329`：**5.13:1**

**③ 被实测否决的方案（记录理由，防止下轮重提）**
- 用 `--color-border`（`#efefef`）做常态边框：对 TabBar 背景实测 **1.04:1** —— **等于不存在**，这正是现状「看不见」的技术原因，不得采用
- 用 `--color-bg-card` 做底色：实测 **1.11:1**，无区分度，只能作辅助
- 把边框做到 3:1（约 `#8a8a99`）：视觉过重，28px 按钮在 36px TabBar 里会变成一块补丁，破坏既有轻盈语言

### 关键实现取舍（供复核）

1. **状态差异进形状，不只进颜色**：面板「实心 vs 虚线」+ 箭头「左 vs 右」，与颜色构成冗余编码。
   两个状态的**外轮廓完全一致**，用户感知到的是「同一按钮换了内部状态」，不是「换了个东西」。
2. **面板从 5×12 加宽到 6.5×11、圆角 1→1.8**：这是**看截图后**的修正 —— 初版 5×12 配左箭头视觉上像
   媒体播放器的 `|◀`（「跳到开头」），加宽加圆角后才读作「面板」。**数据全绿不等于观感正确**，
   这一步只能靠人眼看图发现。
3. **`color-mix()` 用于描边**：Electron 43 = Chromium 130+，支持；实测 `getComputedStyle` 返回
   `color(srgb ...)` 形式已生效。若未来降级，测试只断言「非 transparent 且非 `--color-border`」，
   不绑死颜色字面量。
4. **不引入收起/展开动画**：`sidebar-collapse-toggle` 规格要求 MUST NOT 有过渡，本变更未改该契约；
   仅保留按钮自身的 hover/focus 过渡（原实现即有）。
5. **36px 行高契约未动**：`margin: 4px 2px 0 var(--spacing-2)` 逐字保留，宽度 +2px 由 `.tab-bar-tabs`
   横向滚动吸收，无固定宽度契约。
