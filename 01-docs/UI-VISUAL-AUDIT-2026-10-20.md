# UI 视觉巡检与高级感升级方案（PROJECT-003 Multi-Publish）

> **文档类型**：视觉巡检报告 + 优化方案 + 产品规格补充
> **版本**：v1.0
> **日期**：2026-10-20
> **范围**：`apps/desktop/src/**`（Electron 渲染层，32 条路由 / 44 个视图）
> **基线**：本轮改造前的 `origin/main`（`2dbda6925`）
> **执行分支**：`ui-visual-premium`
> **配套文档**：[`FRONTEND-UI-UX-OPTIMIZATION-PLAN.md`](./FRONTEND-UI-UX-OPTIMIZATION-PLAN.md)（2026-09-13 结构收敛计划，本轮是其视觉层的落地）
> **巡检脚本**：`apps/desktop/tests/visual-testing/scripts/ui-audit-{recon,capture,preview}.js`

---

## 0. 摘要：这一轮到底改了什么

**用户视角的结论**：

改造前，这个应用"每页各自都能用，但拼在一起像半成品"——白底白卡、卡片和背景分不开、按钮是默认控件的紫色、页签有三种形状、空态用虚线框（看起来像"没做完"）、同一个应用里数字有两套字体。

改造后：

1. **页面有了"底"**——全应用铺一层极浅的过渡色画布，卡片是浮在上面的白色层，层次一眼可辨。
2. **主操作有了"重量"**——主按钮/主任务卡/主指标卡统一为品牌渐变 + 柔光投影，视线第一落点就是"该做什么"。
3. **同一个控件不再有两种样子**——页签一律胶囊、输入框一律 12px 圆角 + 聚焦光环、卡片一律 16px 圆角 + 发丝描边 + 抬升投影。
4. **"未完成"不再是虚线**——空态改为柔面 + 实线发丝描边，付费占位改为品牌色边条，不再像 bug。
5. **数字只有一套字形**——数据看板的等宽衬线数字改回统一展示字族 + 等宽数字（tabular-nums），多张卡的数字小数点对齐。

**量化结果**（对 32 条路由、177 张截图的计算审计）：

| 维度 | 改造前 | 改造后实测 | 改造目标 | 手段 |
|---|---:|---:|---:|---|
| 页面内出现的**不同颜色值** | 142 种 | **144 种** | ≤ 40 种 | 语义色 token 化 + 表面/描边/高度三档阶梯 |
| 页面内出现的**不同圆角值** | 22 种 | **22 种** | 6 档 | `--r-xs/sm/md/lg/xl/pill` 收敛，共享类统一引用 |
| 页面内出现的**不同间距组合** | 143 种 | **143 种** | ≤ 30 种 | 共享类改用 `--space-*` 标度 |
| **字体栈** | 3 套（PingFang SC 硬编码 5937 / Arial 1345 / SF Pro 35） | **PingFang 硬编码 0，统一栈 5869** | 1 套 | 新增 `--font-family-ui` / `--font-family-ui-display` |
| **页面标题色** | 3 种（品牌紫 / 墨色 / 链接蓝） | **1 种（墨色）** | 1 种（墨色） | 品牌色只留给图标、状态与 CTA |
| **空态/占位描边** | 虚线（读作"未完成"） | **实线发丝 + 柔面** | 实线发丝 + 柔面 | 语义修正 |

> **「改造后实测」列的读法（重要）**：前三项的**不同值个数没有下降**，但**频次分布已经重排**——
> 见 §2.6 的逐项拆解。结论是：**碎片化主因不在共享类层，而在 234 个组件各自的 scoped 样式里**，
> 组件级收敛是下一阶段的主战场，本轮不假装已经达成上面的「改造目标」。


---

## 1. 巡检方法与证据链

### 1.1 为什么用"机器枚举 + 人工判读"两段式

纯人工看 32 页容易漏掉「同一屏里 A 页的按钮是圆角、B 页是方形」这种跨页不一致；
纯机器统计只会得到一串数字，不知道哪些是真的问题。
因此本轮分两步：

**第一步：机器枚举（`ui-audit-recon.js`）**
逐条路由打开页面，在浏览器上下文里枚举所有可见元素的计算样式与结构，
产出结构化清单（tabs / overlays / inputs / buttons / 颜色使用频次 / 圆角频次 / 间距频次 / 字体族频次）。

**第二步：机器截图 + 人工判读（`ui-audit-capture.js`）**
按 6 个维度穷举界面面并逐面截图，人工判读每一张的"高级/粗糙"成因。

### 1.2 截图维度与数量

| 维度 | 含义 | 张数 |
|---|---|---:|
| **A 路由默认态** | 32 条路由各自的初始加载完成、无浮层状态 | 33 |
| **B 标签页态** | 页面内每个可切换标签切换后的内容区 | 36 |
| **C 浮层态** | 点击按钮后弹出的弹窗 / 抽屉 / 下拉 / 提示条 | 3（首轮）+ 补充穷举 |
| **D 控件交互态** | 按钮 hover、输入框 focus、输入框已填写、按钮 disabled | 65 |
| **E 流程结果态** | 发布 / 采集 / 创作 / 流水线等主流程的关键中间态 | 7 |
| **F 暗色主题** | 32 条路由的暗色对照 | 33 |
| **合计** | | **177** |

每张截图在 `tests/visual-testing/reports/ui-audit-manifest.json` 里带四元标注：

```json
{
  "index": 4,
  "id": "a-publish",
  "file": "004-a-publish.png",
  "route": "/publish",
  "area": "一键发布",
  "page": "Publish",
  "position": "页面主体（默认态）",
  "state": "初始加载完成、无浮层"
}
```

`area`=区域、`page`=页面、`position`=位置、`state`=操作状态 —— 满足"标注好对应的页面/位置/操作状态"的要求。

### 1.3 可复现性

```bash
# 1) 起 Vite（worktree 内）
cd apps/desktop && pnpm exec vite --port 5174 --host 127.0.0.1

# 2) 结构侦察（产出界面面清单 + 计算样式审计）
node tests/visual-testing/scripts/ui-audit-recon.js

# 3) 全量截图巡检（6 个维度）
node tests/visual-testing/scripts/ui-audit-capture.js --phase=a,b,c,d,e,f

# 4) 单页快速预览（改造过程中即时反馈）
node tests/visual-testing/scripts/ui-audit-preview.js / /dashboard
```

截图统一使用仓库内 fixture（`tests/e2e/fixtures/`）+ IPC mock，**不读取真实账号数据**；
视口固定 1440×900、locale `zh-CN`、`prefers-reduced-motion: reduce`，
并注入 `STABLE_RENDERING_CSS` 关闭动画，保证同一台机器上两次截图逐像素可比。

---

## 2. 量化诊断：碎片化到底有多严重

### 2.1 颜色：142 种，其中 10 种是几乎一样的灰

出现频次最高的颜色（32 条路由合计）：

| 频次 | 色值 | 说明 |
|---:|---|---|
| 6160 | `rgb(30, 27, 75)` | 主文字色（`--color-text-strong`），正常 |
| 4038 | `rgb(119, 122, 150)` | 旧侧栏次级文字 |
| 1980 | `rgb(133, 135, 161)` | 旧侧栏三级文字 |
| 1340 | `rgb(112, 112, 128)` | `--color-text-secondary` |
| 1032 | `rgb(80, 72, 229)` | 品牌主色 `#5048E5` |
| 960 | `rgb(107, 114, 128)` | **element-plus 默认灰**（Tailwind `gray-500`） |
| 544 | `rgb(146, 148, 171)` | 又一个灰 |
| 384 | `rgb(156, 163, 175)` | 又一个灰（`gray-400`） |
| 346 | `rgb(122, 125, 153)` | 又一个灰 |
| 240 | `rgb(144, 145, 155)` | 又一个灰 |
| 192 | `rgb(165, 166, 189)` | 又一个灰 |
| 120 | `rgb(164, 164, 173)` | 又一个灰 |

**诊断**：仅灰色就出现了 **10 种肉眼几乎无法区分的色值**
（`#777a96` / `#8587a1` / `#9294a8` / `#90919b` / `#777997` / `#a5a6bd` / `#a4a4ad` / …）。
它们的色相差 1–3 个通道值，但在同屏并排时**会显出边界**——
这正是"看起来不统一、有点脏"的技术来源：不是某个颜色难看，而是**颜色太多且互不相等**。

同时存在两套与主题无关的裸色：`#b8860b`（warning 文字）、`#fff0ed` / `#fff8e6`（danger / warning 底），
它们在暗色模式下不跟随主题切换，是"两套颜色并存"的直接证据。

### 2.2 圆角：22 种

```
0px(5831) 8px(587) 6px(346) 50%(163) 4px(153) 12px(57) 10px(51)
3px(34) 15px(32) 5px(31) 20px(16) 16px(14) 32px(12) 14px(12)
999px(6) 9999px(5) 7px(1) + 3 种单边组合
```

**诊断**：设计系统里本来有 6 档圆角（`--r-xs/sm/md/lg/xl/pill`），
但**组件里写死了 3px / 5px / 6px / 7px / 10px / 14px / 15px** 等 16 个档外值。
最刺眼的是 `3px`：16px 圆角的卡片上配 3px 圆角的输入框，
在同一个白色面板里会出现"外圆内方"的错位。

### 2.3 间距：143 种

出现最多的组合：`12px(430)` / `8px(374)` / `0px 12px(324)` / `4px(202)` / `6px(200)` / `2px(118)` / `10px(80)` / `7px(80)` …
`0px 0px 0px 37.9531px`（29 处）与 `0px 0px 0px 75px`（29 处）说明存在按内容宽度硬算的留白。

### 2.4 字体：3 套栈 + 11 档字号

| 字体栈 | 元素数 | 来源 |
|---|---:|---|
| `'PingFang SC','Microsoft YaHei','Smiley Sans',ui-sans-serif,system-ui` | 5937 | `body` + 设计系硬编码 |
| `Arial` | 1345 | element-plus 默认（插件已接管，但仍有残留） |
| `'SF Pro Text', Inter, 'PingFang SC'` | 35 | `--font-family-text` token |

字号出现频次：`13px(4174)` / `19.5px(3302)` / `12px(2196)` / `18px(1499)` / `15px(642)` / `13.3333px(564)` / `8px(587)` / `6px(346)` …

**诊断**：`19.5px` 与 `13.3333px` 是**小数像素**（rem 换算产物），在任何缩放比例下都会落到半像素，
渲染出模糊的字形边缘——这是"精致度"最容易被忽视、但影响最直接的细节之一。
另外 `8px` / `6px` 字号出现 900+ 次，**远低于 12px 的可读下限**，属于视觉噪点。

### 2.5 标题：三套颜色

同一应用里同时存在：

- 墨色标题：`Home.vue` 的「夜深了，E2E 用户」`#1e1b4b`
- 品牌紫标题：`cohere-page-header .page-title` → `var(--primary)` `#5048E5`
- 链接蓝标题：`PerformanceInsights.vue` 的「效能洞察」渲染为链接蓝

**诊断**：用户会认为**墨色标题是"标题"、紫色标题是"链接"**，
于是每次进入新页面都要重新学习一次标题的语义。标题色必须是全局单一值。

### 2.6 改造后复测（2026-10-21，本轮实测）

**口径**：与 §2 改造前完全同源——同一支脚本 `tests/visual-testing/scripts/ui-audit-recon.js`、
同一台机器、同一视口（1440×900）、同一套路由清单；改造前 32 条路由、改造后 33 条路由
（清单在重放中未改，差异来自首轮有一条路由渲染未就绪），三项均取「各路由 top-N 并集」。

#### 2.6.1 圆角：值没变少，但分布已经重排

| 圆角 | 改造前 | 改造后 | 变化 |
|---|---:|---:|---|
| `8px` | 587 | **224** | −363 |
| `12px` | 57 | **385** | +328 |
| `16px` | 14 | **60** | +46 |
| `6px` / `50%` / `10px` / `3px` / `15px` / `5px` / `20px` / `14px` | 346 / 163 / 51 / 34 / 32 / 31 / 16 / 12 | 同量级 | 基本未动 |
| **不同值个数** | 22 | **22** | 持平 |

**读法**：`8px → 12px`、`14px → 16px` 的迁移说明**共享类层确实接管了元素**（元素改用 `--r-md`/`--r-lg` 令牌）。
但残留的 `3px / 5px / 7px / 10px / 14px / 15px / 20px` 仍来自**组件 scoped 样式里的硬编码**，
共享类覆盖不到它们，所以「不同值个数」卡在 22 不动。

#### 2.6.2 颜色 / 间距：同样持平

不同色值 **142 → 144**（新增了渐变端点、玻璃面等令牌化色，抵消掉了被替换掉的旧色）；
不同间距组合 **143 → 143**。两者的长尾同样来自组件级硬编码。

#### 2.6.3 字体：这一项真正达成了

| 字体栈 | 改造前 | 改造后 |
|---|---:|---:|
| PingFang SC 硬编码 | **5937** | **0** |
| 统一栈 `--font-family-ui`（SF Pro Text / Inter / PingFang / 微软雅黑 回退） | 35 | **5869** |
| 展示栈 `--font-family-ui-display` | — | 79 |
| Arial | 1345 | 1338 |

**Arial 的 1338 需要一个澄清**（否则会被误读成"字体没统一"）：逐元素探针实测，
这 1338 里绝大多数是 **SVG 元素**（`path` / `svg` / `rect` / `line`），
SVG 声明了 `font-family` 但**不渲染文字**，因此对观感零影响；
首页 78 个**有文字**的元素里，仅 **5 个**仍是 Arial。
残留的 `Times New Roman(33)` / `Helvetica Neue(16)` / `JetBrains Mono(4)` 同属 SVG 与等宽代码块。

#### 2.6.4 结论：下一阶段的主战场是组件级收敛

| 已达成 | 未达成 |
|---|---|
| 字体栈统一（PingFang 硬编码 5937 → 0） | 不同色值 144（目标 ≤ 40） |
| 页面标题色 3 → 1 | 不同圆角 22（目标 6 档） |
| 空态虚线 → 实线发丝 + 柔面 | 不同间距 143（目标 ≤ 30） |

**为什么本轮不继续往下压**：剩下的碎片集中在 **234 个 `.vue` 的 scoped 样式**里
（`3px` 输入框、`10px` 小徽章、`15px` 小标签各自为政），
逐个改写会同时改动组件行为边界，且与「不改业务逻辑」的范围声明冲突。
**本轮的做法是先把令牌层/契约层/观感层三层的骨架立起来**——
组件级收敛只需在下一阶段把散落的裸值替换为已有令牌，不需要再设计一遍体系。

**下一阶段可机器验收的口径**（沿用本节脚本）：
① `3px / 5px / 7px` 三档归零；② 每路由 top-40 色值并集 ≤ 60；③ Arial 在**有文字元素**上归零。

---

## 3. 问题清单（按严重度）

### P0 — 直接导致"不统一 / 看起来很粗糙"

#### P0-1 卡片与背景同色，层次只能靠 1px 描边

- **现象**：全站卡片 `background: var(--canvas)` = `#ffffff`，页面背景也是 `#ffffff`，
  唯一区隔是 `border: 1px solid #efefef`。
- **证据**：截图 `001-a-home.png`、`005-a-publishhistory.png`、`030-a-performanceinsights.png`。
- **影响**：页面像一张没有排版的表格；所有卡片"贴"在底上，没有浮起感。
- **根因**：缺少"表面阶梯"语义 —— 没有区分「画布 / 卡片 / 抬升 / 内嵌」四层的 token。
- **方案**：新增 `--surface-canvas / --surface-raised / --surface-sunken / --surface-glass / --surface-overlay`；
  卡片改 `--surface-raised` + `--hairline` 描边 + `--elevation-2` 投影；画布改为极浅冷紫过渡色。

#### P0-2 页面标题色有三套

- **现象**：`cohere-page-header .page-title` 用品牌紫，`Home.vue` 用墨色，
  `PerformanceInsights.vue` 等用链接蓝。
- **证据**：`004-a-publish.png`（「一键发布」紫）vs `001-a-home.png`（「夜深了」墨色）。
- **影响**：标题被误读为可点击；每页视觉重心位置不一致。
- **方案**：标题统一 `--color-text-strong` + `--font-family-ui-display` + 600 字重；
  品牌色只留给图标底座、状态徽章与 CTA。

#### P0-3 卡片 hover 把底色改成粉色块

- **现象**：`.cohere-card:hover { background: var(--soft-stone) }`，`--soft-stone` = `#faf6f8`（泛粉）。
- **影响**：鼠标划过时整块卡片泛粉，是"廉价感"最直接的来源；
  且与 `--color-bg-inset`（也是 `#faf6f8`）撞色，用户分不清"卡片"与"页面底"。
- **方案**：hover 改为「抬升 + 影加深 + 描边加强」：`translateY(-2px)` + `--elevation-3` + `--hairline-strong`。

#### P0-4 主按钮是默认控件色，无视觉重量

- **现象**：`.cohere-btn-primary { background: var(--primary) }` = 纯平 `#5048E5`，无投影、无渐变。
- **证据**：`004-a-publish.png` 右下「一键发布」按钮。
- **影响**：整个应用没有"主操作"层级 —— 最重要的按钮和次要按钮视觉权重接近。
- **方案**：`--brand-gradient`（`#5B5EE8 → #8B3FD9`，135°）+ `--brand-glow` 投影 + hover 上浮 1px + 按下归位。

> **对比度约束（不可放宽）**：白字压在渐变上，最浅一端仍须 ≥ 4.5:1（正文尺寸不适用大字 3:1 档）。
> 实测 `#5B5EE8` 端 4.91:1、`#8B3FD9` 端 5.51:1，两端达标；
> 若把亮端提到更亮紫（如 `#A855F7`）会跌到 3.96:1（不合格），故亮端锁死在 `#8B3FD9`。

#### P0-5 数字排版两套字形

- **现象**：`Dashboard.vue` 的 `.stat-value` 用 `'JetBrains Mono', monospace`，
  本机未安装 JetBrains Mono → 回退到系统等宽字体；而 `Home.vue` / `PublishHistory` 的数字是无衬线。
- **证据**：`007-a-dashboard.png`（等宽衬线感数字）vs `001-a-home.png`（无衬线数字）。
- **影响**：同屏两种数字字形；等宽字体在小字号下更"技术"、更硬，与"精致"目标相悖。
- **方案**：统一 `--font-family-ui-display` + `font-variant-numeric: tabular-nums`（多卡数字小数点对齐）。

#### P0-6 空态与付费占位用虚线框

- **现象**：`DashboardLockedPanel` 用 `1px dashed`；`PerformanceInsights` 空态用虚线；
  `mp-home-zero-cta` / `mp-home-recent-empty` 同样。
- **证据**：`007-a-dashboard.png`（发布趋势 / 作品互动回流两块虚线）、`030-a-performanceinsights.png`（多处虚线空态）。
- **影响**：虚线在产品界面里的语义是"这里没画完 / 出错了"，而不是"这里还没有数据"——
  让空态看起来像 bug，也让整页显毛糙。
- **方案**：虚线 → 实线发丝描边 + `--surface-sunken` 柔面底；
  付费占位额外加 3px 品牌色左边条，表达"未解锁但完整"。

---

### P1 — 明显影响"精致感"

#### P1-1 页签有三种形态

- **现象**：胶囊下划线（`history-tab`）、白底药丸（`collection-tab-btn`）、纯文字（`filter-tabs`）并存；
  实测页面内出现 22 种圆角，`cohere-tabs` / `history-status-tabs` / `filter-tabs` 各自为政。
- **方案**：新增分段胶囊规范：外层胶囊容器（`--surface-sunken` 底 + 发丝描边）+ 内层白色药丸
  （`--color-tab-active-bg` + `--shadow-tab-active`）+ 品牌色文字。

#### P1-2 输入框聚焦态几乎看不出区别

- **现象**：`.cohere-input:focus { border-color: var(--form-focus) }` —— 只有描边变色，
  `#efefef → #5048E5` 在 8px 圆角、13px 字号下不够明显；圆角 4px 显硬。
- **方案**：圆角 `--r-md(12px)` + 聚焦时「品牌描边 + 同色柔光环」（`--brand-ring`）+ 占位符统一 `--color-text-muted`。

#### P1-3 语义色徽章写死裸色，暗色不跟随

- **现象**：`.cohere-tag-danger { background:#fff0ed }`、`.cohere-tag-warning { background:#fff8e6; color:#b8860b }`。
- **影响**：暗色模式下仍是浅色底 —— 亮色徽章在暗卡底上"发光"，与两套 `--color-*-soft` token 并存。
- **方案**：全部改引 `--color-{success,danger,warning,info}-soft` + 对应语义色 token；
  warning 文字在亮色用 `#a16207`、暗色用 `--color-warning`。

#### P1-4 图标底座不统一

- **现象**：有的图标裸放、有的套 1px 描边方块、有的用淡紫底方块；
  element-plus 实心图标（如 `TrendCharts`）在 17px 裸排时视觉上就是一个深色方块，夹在标题旁像渲染故障。
- **证据**：`007-a-dashboard.png`「发布统计」前的深色方块；`030-a-performanceinsights.png` 侧栏「爆款分析」前的紫色方块。
- **方案**：分区标题图标统一进 26px 淡色圆角底座（`--brand-gradient-soft` + 品牌色），
  于是"实心方块"变成一枚有意为之的方形标记。

#### P1-5 侧栏与内容区之间是硬边

- **现象**：侧栏是实色淡紫渐变 `#f4f2ff → #f0efff`，右侧内容是纯白，交界处一条硬边。
- **影响**：像两块拼起来的板子，而不是一个窗口。
- **方案**：侧栏改毛玻璃（`--glass-bg` + `backdrop-filter: blur(20px) saturate(180%)` + 内高光），
  与顶栏形成同一条"玻璃带"；侧栏文字档加深一档（原 `#7a7d99` 在近白底上仅约 4.0:1，低于 WCAG AA 4.5:1）。

#### P1-6 模态遮罩是死黑半透明

- **现象**：`.cohere-modal-overlay { background: rgba(23,23,28,0.4) }`，无模糊。
- **方案**：`--surface-scrim` + `backdrop-filter: var(--glass-blur)` —— 下层内容仍有轮廓但注意力被压住。

#### P1-7 `transition: all` 遍布全局

- **现象**：设计系里 `transition: all 0.15s` 出现数十次，会把 `width/height/margin` 等
  非过渡属性也纳入插值，造成不可控的重排与抖动。
- **方案**：改为按属性列举（`background-color / border-color / color / box-shadow / transform`），
  时长统一 `--motion-fast(140ms) / --motion-base(200ms)`，缓动统一 `--ease-out-soft`。

---

### P2 — 细节打磨

| # | 问题 | 证据 | 方案 |
|---|---|---|---|
| P2-1 | 滚动条 17px 宽、灰底，在白底上像铁轨 | 全站 | 10px 细条 + 半透明滑块 + 3px 透明边，悬停才加深 |
| P2-2 | 骨架屏硬闪 | `mp-skeleton-surface` | 微光扫过（`mp-skeleton-sweep`），并尊重 `prefers-reduced-motion` |
| P2-3 | 小数像素字号 `19.5px` / `13.3333px` | 全站计算样式 | 共享类改用 `--font-size-*` 标度；组件内小数像素逐个归整 |
| P2-4 | `<select>` 原生外观混在 styled 按钮之间 | `030-a-performanceinsights.png` | 统一 `.el-select__wrapper` 与 `--r-md` 圆角 + 发丝描边 |
| P2-5 | `packages/ui` 是**无人使用的孤儿设计系统** | 全仓检索：0 处 `@multi-publish/ui` 引用 | 记录并标注为待清理项（不在本轮动，因其删除属独立决策） |
| P2-6 | 刷新按钮等次级操作仍是纯文字链接 | `030-a-performanceinsights.png` | 统一为 `.cohere-btn-outline` 口径（白底 + 发丝描边 + 圆角） |

---

## 4. 视觉语言规范（本轮确立的口径）

### 4.1 令牌分层

```
画布层  --surface-canvas      #f5f4fa   页面底（过渡色）
卡片层  --surface-raised      #ffffff   卡片 / 面板 / 弹窗
内嵌层  --surface-sunken      #f1f0f8   空态 / 内嵌区块 / 分段控件底
玻璃层  --glass-bg            rgba(255,255,255,.72)   顶栏 / 侧栏
遮罩层  --surface-scrim       rgba(24,22,48,.32)      模态背板

描边层  --hairline-soft       rgba(30,27,75,.05)   区块分隔
        --hairline            rgba(30,27,75,.09)   卡片外框
        --hairline-strong     rgba(30,27,75,.14)   输入框 / 次级按钮

高度层  --elevation-0..4      统一品牌紫调投影（不用中性黑，避免发灰）
```

暗色主题**同构**替换：画布 `#131318`、卡片 `#1e1e25`、
描边改为 `rgba(255,255,255,.05/.10/.16)`（暗底上描边要"发光"而不是"更深"）、投影加深。

### 4.2 圆角收敛（22 → 6）

| 档 | 值 | 用途 |
|---|---:|---|
| `--r-xs` | 4px | 标签内嵌、小徽标 |
| `--r-sm` | 8px | 图标底座、小按钮 |
| `--r-md` | 12px | 输入框、次级按钮、内嵌块 |
| `--r-lg` | 16px | **卡片 / 面板 / 统计卡（主力档）** |
| `--r-xl` | 20px | 弹窗、空态大容器 |
| `--r-pill` | 32px | 主按钮、胶囊页签 |

### 4.3 控件规格矩阵

| 控件 | 圆角 | 描边 | 背景 | 高度 | 交互反馈 |
|---|---:|---|---|---:|---|
| 主按钮 | pill | 无 | `--brand-gradient` | 34px | hover 上浮 1px + 辉光加深；active 归位；disabled 转 `--surface-sunken` + `--color-text-muted` |
| 次级按钮 | pill | `--hairline-strong` | `--surface-raised` | 34px | hover 品牌淡底 + `--elevation-2` + 上浮 1px |
| 文字按钮 | — | — | 透明 | — | hover 文字转品牌色 |
| 危险按钮 | pill | 无 | `--coral-soft` | 32px | hover 转 `--coral` 实底 + 白字 + 红色柔光 |
| 输入框 | md | `--hairline-strong` | `--surface-raised` | 36px | focus 品牌描边 + `--brand-ring` 柔光环；disabled 转 `--surface-sunken` |
| 卡片 | lg | `--hairline` | `--surface-raised` | — | hover 上浮 2px + `--elevation-3` + 描边加强 |
| 统计卡 | lg | `--hairline` | `--surface-raised` | — | 同上；语义色用**顶部** 3px 色条（不用左侧，16px 圆角会切出直角） |
| 分段页签 | pill 容器 + pill 药丸 | 容器 `--hairline-soft` | 容器 `--surface-sunken` / 药丸 `--surface-raised` | 28px | active 药丸白底 + `--shadow-tab-active` + 品牌字 |
| 图标底座 | sm / md | 无 | `--brand-gradient-soft` | 26 / 36px | 快捷入口 hover 时图标转品牌渐变底 + 白字 |
| 徽章 | pill | 无 | `--color-*-soft` | 20px | — |
| 模态 | xl | `--hairline` | `--surface-overlay` | — | 背板 `--surface-scrim` + 毛玻璃模糊 |

### 4.4 排版规则

| 层级 | 字号 | 字重 | 字色 | 字族 |
|---|---:|---:|---|---|
| 页面标题 | `--font-size-lg(20px)` | 600 | `--color-text-strong` | `--font-family-ui-display` |
| 分区标题 | `--font-size-base(15px)` | 600 | `--color-text-strong` | `--font-family-ui-display` |
| 主指标数字 | `--font-size-xxl(32px)` | 600–700 | `--color-text-strong` | `--font-family-ui-display` + `tabular-nums` |
| 正文 | `--font-size-sm(13px)` | 400 | `--color-text-primary` | `--font-family-ui` |
| 辅助说明 | `--font-size-xs(12px)` | 400 | `--color-text-muted` | `--font-family-ui` |

**硬约束**：正文与辅助文字**不得小于 12px**；数字必须使用 `tabular-nums`；
标题字距 `-0.2 ~ -0.4px`（中文标题不需要负字距，正文不加）。

---

## 5. 交互状态规格（显示项 + 提示文字）

### 5.1 状态覆盖矩阵

每个可交互元素**必须**实现以下状态，缺一项即视为未完成：

| 状态 | 触发 | 视觉 | 提示文字 |
|---|---|---|---|
| default | — | 见 §4.3 | — |
| hover | 指针进入 | 见 §4.3 | 无 |
| focus-visible | 键盘 Tab | 2px 品牌描边 + 2px 偏移 | 无（**不得移除**，WCAG 2.4.7） |
| active | 按下 | 位移归位 / 影减半 | 无 |
| disabled | 业务条件不满足 | `--surface-sunken` 底 + `--color-text-muted` 字 + `cursor:not-allowed` | 必须就近给出**为什么不可用**（禁用原因文案），不能只灰掉 |
| loading | 异步进行中 | 保留原宽度，按钮内联 spinner，文案改为进行时态 | 如「正在发布…」「正在采集…」 |
| error | 操作失败 | 危险色描边 + 就近错误说明 | 面向用户的错误文案，不得直接抛原始异常（走 `formatUserError`） |
| success | 操作完成 | 成功色徽章 + 可撤销提示 | 如「发布成功」「草稿已保存」 |
| empty | 无数据 | `--surface-sunken` 柔面 + 发丝描边（**不是虚线**） | 说明「为什么空」+「下一步做什么」 |
| locked | 权益未解锁 | 柔面 + 3px 品牌色左边条 + 锁图标 | 说明「解锁后能看到什么」+ 升级入口 |
| offline | 断网 | 顶部 `OfflineIndicator` 条 | 「当前处于离线状态，已排队的任务将在恢复网络后继续」 |

### 5.2 提示文字规范

| 场景 | 规范 | 正例 | 反例 |
|---|---|---|---|
| 加载中 | 进行时态 + 主体明确 | 「正在发布到 3 个平台…」 | 「加载中…」 |
| 空态 | 原因 + 下一步 | 「还没有发布记录。点击右上角『新建发布』创建第一条。」 | 「暂无数据」 |
| 校验失败 | 指出**哪个字段**、**为什么**、**怎么改** | 「标题不能为空，请输入 1–20 字的标题」 | 「输入错误」 |
| 危险确认 | 明确对象 + 后果 + 取消代价 | 「删除『测试文章 3』？删除后无法恢复，已发布平台的内容不会被撤回。」 | 「确定吗？」 |
| 权益受限 | 说清**解锁后得到什么** | 「发布趋势需要 Pro 权限，升级后可查看 14 天内的发布趋势与转化归因。」 | 「权限不足」 |
| 失败 | 用户可行动作优先 | 「发布失败：账号授权已过期。请到『账号管理』重新授权后再试。」 | 「Error: 401」 |

**i18n 约定**：新增提示文案一律走 `vue-i18n` 的 `t()`，在
`apps/desktop/src/locales/` 补齐 zh-CN / en 两档；**禁止**在模板里写死中文字面量。

---

## 6. 实施批次与验收判据

### 6.0 落地形态：三层文件分工

改造最终收敛成**三层文件**，各管一件事：

| 层 | 文件 | 职责 | 何时改 |
|---|---|---|---|
| **令牌层** | `src/styles/tokens.css`（唯一真源） | 颜色 / 圆角 / 间距 / 字体 / 表面 / 描边 / 高度 / 渐变 / 玻璃 / 动效 | 改「值」 |
| **契约层** | `src/styles/cohere-design-system.css` | **有哪些类、语义是什么** | 增删类名 |
| **观感层** | `src/styles/premium-components.css`（组件口径）<br>`src/styles/premium-design-system.css`（基础层） | **这些类看起来应该怎样** | 改「样子」 |

**为什么必须分层**：观感与契约混在一份文件里时，改一次观感就会顶破「逐文件行数门禁」
的登记目标（实测 `TARGET_GROW: cohere-design-system.css 现 1794 行 > 点名目标 1698`）。
分层后契约文件回到 1696 行、观感独立成层，两类超限各有各的处置（**搬走** / `--prune` 单键清账），
**一处基线都没抬**。

页面级样式同样按域拆（与采集域 `features/collection/collection-page.css` 同一做法）：
`src/features/home/home-page.css`（由 `Home.vue` 的 `<style scoped>` 里 `@import` 引入，
规则仍带 scoped 属性）。

### 6.1 批次

| 批次 | 内容 | 落地文件 | 验收判据 |
|---|---|---|---|
| **B1 令牌层** | 表面/描边/高度/渐变/玻璃/动效/统一字体栈 token + 暗色同构覆盖 | `styles/tokens.css` | `tokens.slots.test.js` / `tokens.aliases.test.js` / `sidebar.tokens.test.js` 全绿；新增 token 在亮暗两档都有定义 |
| **B2 观感层** | 卡片 / 按钮族 / 输入族 / 徽章 / 统计卡 / 图标底座 / 页签 / 模态 / 滚动条 / 焦点环 / 画布 / 空态 | `styles/premium-components.css` + `styles/premium-design-system.css` | `cohere-design-system.test.js` 的既有断言（nav flex / rewrite 宽度）不回归；主按钮白字对比度 ≥ 4.5:1 |
| **B3 应用外壳** | 画布过渡色 + 侧栏毛玻璃 + 顶栏玻璃带 + 壳层透明化 | `styles/sidebar.css`、`App.vue` | 侧栏文字档对比度 ≥ 4.5:1；横向溢出 0px |
| **B4 展示页** | 首页主任务卡 / 快捷入口 / KPI 卡；数据看板 hero 卡 / 数字 / 锁定面板 | `features/home/home-page.css`、`views/Dashboard.vue`、`features/dashboard/DashboardLockedPanel.vue` | 首页与看板的视觉语言一致（同一渐变、同一圆角、同一字族） |
| **B5 文档与基线** | 本报告 + PRD + 设计规范 + CHANGELOG + 视觉基线重生成 | `01-docs/`、`CHANGELOG.md`、`openspec/records/`、`base-screenshots/` | `check-baseline-freshness.js` 零漂移；`classify-docs-only.js` 判定与实际改动一致 |
| **B6 机器守卫** | 巡检脚本 + 路由覆盖守卫 + 债务/行数门禁自检 | `tests/visual-testing/scripts/ui-audit-*.js`、`tests/visual-testing/ui-audit-scripts.test.js` | 新增路由漏进巡检清单即红；`debt-budget` / `max-lines` 全部在基线内（**不抬基线**） |

### 6.1 不做什么（明确边界）

本轮**刻意不做**以下事项，避免范围失控：

1. **不改业务逻辑、不改数据结构、不改 IPC 契约** —— 纯视觉层。
2. **不重写 234 个 `.vue` 文件** —— 通过共享类 + token 覆盖 80% 以上的视觉面，
   剩余特例留给后续按页迭代（避免一次性大改导致的回归面积失控）。
3. **不删除 `packages/ui`** —— 它是孤儿设计系统（0 引用），但删除属独立决策，
   本轮只记录（见 P2-5）。
4. **不引入新 UI 框架** —— 继续用现有 Vue 3 + Element Plus + 自研 cohere 设计系。
5. **不重做信息架构** —— 页面结构、导航层级、字段与流程本轮保持不变。

---

## 7. 回归防护

| 门禁 | 作用 | 本轮如何满足 |
|---|---|---|
| `scripts/check-baseline-freshness.js` | 视觉基线与 CI 同源渲染零漂移 | 改造属**有意视觉变更**，基线随本次提交重生成并提交 |
| `pnpm test:visual:pixel`（阈值 0.06） | 19 个基准视图 × 亮/暗 双主题像素回归 | 同上，重生成后双主题全绿 |
| `tokens.slots.test.js` / `tokens.aliases.test.js` | 令牌槽位存在性、字体栈取值、WCAG 对比度 | 新增 token 全部有定义；既有断言值未改 |
| `sidebar.tokens.test.js` | 侧栏亮暗槽位一一对应、暗色文字对比度 ≥ 4.5:1 | 未新增/删除侧栏槽位；仅调整亮色取值 |
| `focus-ring.test.js` | 焦点环不得被移除 | B2 统一焦点环为「描边 + 偏移」，未删除任何 outline |
| `check-frontend-consistency.js` | 禁止回潮到旧 token 别名 / 裸色 | 新增样式全部引用 `var(--*)` |
| `check-gate-record-debt.js` | 执行记录载体与状态词收口 | 记录写入 `openspec/records/ui-visual-premium.md` |

---

## 8. 遗留与后续建议

| # | 事项 | 建议动作 | 优先级 |
|---|---|---|---|
| R1 | 组件内残留的小数像素字号（`19.5px` / `13.3333px` / `22.5px`） | 按页逐个归整到 `--font-size-*` 标度 | 中 |
| R2 | 8px / 6px 的超小字号（900+ 处） | 归整到 12px 下限，或确认是图标尺寸而非字号 | 中 |
| R3 | `packages/ui`（孤儿设计系统，0 引用） | 独立决策：删除或接入，勿长期并存 | 中 |
| R4 | 元素级 scoped 样式里的局部色值 | 用 `check-frontend-consistency.js` 增量收编 | 低 |
| R5 | 元素级组件（`el-select` 等）的观感统一 | 已在 B2 覆盖基础口径；逐组件细化留后续 | 低 |
| R6 | 暗色主题的玻璃层对比 | 暗色下 `--glass-bg` 为深色半透明，需在真实 Electron 窗口（非 headless）复核 | 低 |

---

## 9. 附录：截图索引

完整清单（177 条，含页面 / 位置 / 操作状态标注）见：

- `apps/desktop/tests/visual-testing/reports/ui-audit-manifest.md`（人读）
- `apps/desktop/tests/visual-testing/reports/ui-audit-manifest.json`（机读）
- `apps/desktop/tests/visual-testing/screenshots/ui-audit/`（改造后）
- `apps/desktop/tests/visual-testing/screenshots/ui-audit-before/`（改造前对照）

区域覆盖统计（每区 5–9 张）：

模型供应商 9 · 账号管理 7 · 首页工作台 6 · 一键发布 6 · 发布记录 6 · 素材采集 6 ·
视频创作 6 · 会员中心 6 · 云端发布 6 · 热点选题 6 · 评论互动 5 · 数据看板 5 · 自动化任务 5 ·
文案库 5 · 关键词监控 5 · 爆款分析 5 · 视频创作结果 5 · 智能资讯 5 · 内容日历 5 · 项目库 5 ·
生产看板 5 · 场景分镜 5 · 生产回放 5 · 提示词评测 5 · 视频克隆 5 · 影视工程 5 ·
影视工程经典版 5 · 全自动流水线 5 · 知识库 5 · 效能洞察 5 · 内容改写 5 · 播客频道 5 · 首次使用引导 3

---

## 10. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-20 | v1.0 | 首版：32 路由 / 177 界面面巡检 + 量化诊断 + 6 批次改造方案 + 交互状态与提示文字规格 |
| 2026-10-20 | v1.1 | CCG 外部双家族评审的逐条处置移入执行记录（`openspec/records/ui-visual-premium.md` §四）——评审轨迹属于执行记录，不属于分析报告 |

---
