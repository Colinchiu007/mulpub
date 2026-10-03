# 视觉用例的两条截图路径与「确定性渲染收口」

> 适用范围：`apps/desktop/tests/visual-testing/`。本文记录一次真实归因纠正：
> 同一个「视觉差异超过阈值」的报错文案下，藏着两类完全不同的成因。

## 1. 两条截图路径，只有一条做了收口

| 路径 | 入口 | 是否经过 `settleForCapture()` |
| --- | --- | --- |
| 视图快照 | `test-runner.js` → `_navigateToRoute()` → 截图 | ✅（收口原先就写在这个方法体内） |
| 工作流末态 | `workflows/all-workflows.visual.test.js` → `captureWorkflowScreenshot()` → `runner.page.screenshot({ fullPage: true })` | ❌ 本 PR 之前完全绕过 |

`settleForCapture()` 做五件事，缺一件就会拍到中间态：

1. `document.fonts.ready` + 双 `requestAnimationFrame` —— 等字体与稳定帧；
2. 注入 `*,*::before,*::after{transition:0s!important;animation:0s!important;…}` ——
   `reducedMotion` 只是媒体偏好，业务 CSS 不响应它时动画照旧在截图窗口内跑；
3. `window.scrollTo(0, 0)`；
4. `VISUAL_CAPTURE_SETTLE_MS`（默认 300ms）；
5. `waitForLoadState('networkidle')`（5s 上限，持续轮询的视图永不 idle，超时忽略）。

第 2 步的历史事故写在 `test-runner.js` 的注释里：`/create` 在两次运行间
`misMatch` 从 0.026% 摆到 9%。工作流侧因为绕过它，症状变成「末态整页半透明、
下半屏区块尚未出现」。

## 2. 归因方法：把总百分比拆成可加和的两两差链

CI 一次报 10 条工作流红，阈值 1%。**不要**按报错文案归类，要测三个数：

| 记号 | 含义 | 工具 |
| --- | --- | --- |
| `X` | 仓库基线 vs CI 渲染的默认视图 | `pixelmatch(base-screenshots/<b>.png, artifact/screenshots/<v>.png)` |
| `Y` | CI 渲染的默认视图 vs CI 渲染的工作流末态 | `pixelmatch(artifact/screenshots/<v>.png, artifact/screenshots/workflows/<w>--step-1-current.png)` |
| `Z` | 仓库基线 vs CI 渲染的工作流末态（= CI 报的那个数） | 同前 |

`X + Y ≈ Z` 时链条自洽，然后按形状分类：

- **`X` 占满全部差额、`Y ≈ 0`** ⇒ 基线不是 CI 渲染的（QM-4 第 7 条），末态本身是对的。
  处理：重建同源基线，**不要**动阈值。
- **`X ≈ 0`、`Y` 占满差额** ⇒ 基线已同源，末态本身不对。
  处理：查截图路径的收口/等待，**不要**改基线——那会把错误状态钉成契约。

本次实测（run `36490844190`，main `633ee1c2`）：

| 用例 | X | Y | Z | 判定 |
| --- | --- | --- | --- | --- |
| publish-* ×6 | 1.119% | 0 – 0.157% | 1.073 – 1.120% | 基线非同源 |
| cloud-publish-* ×3 | 2.160% | 0.105 – 0.157% | 2.162 – 2.240% | 基线非同源 |
| dashboard-benchmark-title-reset | **0.034%** | **10.842%** | 10.876% | **收口缺失** |

## 3. 一条被推翻的结论：所谓「709 px 噪声地板」

本文档 #2623 那一版写过：`dashboard` / `collection` / `create-pipeline` / `create-history`
四条已同源基线仍稳定差 **709 px / 0.034%**，包围盒固定在顶部标签栏 + 面包屑，因此推断
「该区域有动态元素，正解是给 `pixel-diff` provider 加 mask」。**这个推断是错的，且错得有代表性。**

反证只需一次跨 run 对照（同一页面、三次不同时间的 CI 渲染，`pixelmatch threshold 0.1`）：

| 视图 | run 22:11 ↔ run 00:44 | run 00:44 ↔ run 20:47 | 仓库基线 ↔ 最新 CI 渲染 |
| --- | --- | --- | --- |
| collection | 0 px | 0 px | 32614 px（1.573%） |
| create-pipeline | 0 px | 0 px | 4013 px（0.194%） |
| intelligence | 0 px | 0 px | 4013 px（0.194%） |
| dashboard | 0 px | 0 px | 175 px（0.008%） |

CI 渲染**两两 0 px** ⇒ 该区域根本没有动态元素；漂移全部来自**基线侧被换过**。
具体是 #2685 用本机 `test:visual:update-baseline` 重捕了 17 张基线（提交信息写的是「同源刷新」），
而本机渲染 ≠ CI 渲染。至于当初的 709 px：那只是**当时那张陈旧基线**的漂移量，换图后同一处变成 175 px——
它从来不是"地板"，只是漂移的瞬时值。

**方法论教训**：把一组非零差值解释成「不可消除的噪声」之前，必须先做一次
「同一输入重复两次是否相同」的**可重复性**测量。只测「基线 vs 一次渲染」就断言噪声地板，
等于用单个样本的残差给噪声定性质。

**正解不是 mask，而是让漂移即红**：`scripts/check-baseline-freshness.js` 断言每张被跟踪基线
逐像素等于**同一次 run** 的 CI 渲染，接在 Visual Tests 采集步骤之后以阻断形态运行。
（`pixel-diff` provider 至今不支持 mask。）

**但别把这条否证过度推广成"本仓没有动态元素"。** 本门禁上线后的第一次运行就抓到 `keyword-monitor`
相对**本次 run** 的渲染差 140 px，包围盒固定在 (463,411)→(520,418)，内容是一行
「最后检查: 2026-09-29T21:28:06.674Z  采样: 12 条」——精确到毫秒的实时时间戳，其基线在数学上不可复现。
跨 run 对照（46 个视图 × 两次 CI run）确认**只有这一张**不稳定，其余 45 张逐字节相同。

> **更正（2026-09-30，同一 PR 内第二次自我推翻）**：上面那句「只有这一张不稳定」的**测量域只有浅色**。
> #2709 把暗色套接入像素门禁后，同一视图的 `keyword-monitor-dark.png` 相对 main tip 的 CI 渲染
> 差 **127 px**，包围盒 (463,410)→(528,418)，就是同一行时间戳的暗色反色版本。
> 教训不是"漏了一张图"，而是**结论的适用范围必须和测量域一起写出来**：
> 只测浅色就写"本仓只有这一处动态"，等于把"我没测"写成了"不存在"。

两类问题的处置必须分开：陈旧基线 → 按同一次 run 的 CI 渲染重建；实时值 → **在采集层把时钟钉住**（正解，见 §3.2）。
`KNOWN_DYNAMIC` 的带预算例外只作为"确实钉不住时"的过渡机制保留，现由用例断言清单为空。
提阈值与"无预算的忽略区"都不接受：前者关掉判据，后者把"会变"偷偷变成"变多少都行"。

### 3.1 门禁第一次套到 origin/main 的实测（为什么需要它）

把本 PR 的脚本指向 **origin/main 的基线** × **main tip 自己那次 CI 渲染**（run 36646007705），
当场报出 **8 张违规**，而同一次 run 的 `Full visual suites (blocking gate)` 是 success：

| 基线 | 漂移 | 为什么阈值门禁看不见 |
| --- | --- | --- |
| collection.png | 32614 px / 1.573% | 阻断门禁阈值 6%，新鲜度要求 0 px |
| create-editor / create-history / create-pipeline / intelligence | 各 **4013 px / 0.194%**（同一个数） | 同一条带 y422–878 左侧列：一个共享元素变了 |
| create-result.png | 6175 px / 0.298% | 同上，另加两处小区块 |
| dashboard.png | 175 px / 0.008% | (432,614)→(476,635) 一块 45×22 文本 |
| keyword-monitor-dark.png | 127 px / 0.006% | 真时钟驱动，最终在采集层钉住（见 §3.2），不靠预算 |

「四张不同视图的漂移量**精确相等**」本身就是证据：那不是噪声的形状，是同一个共享 UI 元素
（新平台项进入列表）在四页各渲染一次的结果。6% 阈值对 0.194% 完全失明，
而"必须逐像素等于本次渲染"当场把它抓住——这就是本门禁存在的理由。

（本段写于 2026-09-30 上午，当时把 `keyword-monitor-dark` 登记进了 `KNOWN_DYNAMIC`；
同日下午该例外被整体删除，根因修复见 §3.2 —— 保留这段是为了留下"用预算掩盖根因"这条弯路本身。）

## 3.2 真正的根因：五张视图把墙上时钟画进了像素

门禁在自家 PR 的 run 上判红 5 张，而不是我登记的那 1～2 张。做一次**同 UI 跨 run** 的两两对照（两次 run 只差一个自然日：23:35 与次日 16:13）：

| 视图 | 跨 run | 现场 |
| --- | --- | --- |
| `keyword-monitor` / `-dark` | 漂移 | 一行 `最后检查: <ISO 毫秒戳>`，值随拍摄时刻 |
| `calendar` / `-dark` | 漂移 714 px / 24578 px | 「今天」高亮随日期移动，暗色整片月历反色 |
| `home-baseline` | 漂移 573 px | 按时段切换的问候语：23:35 拍是「晚上好」，16:13 拍是「下午好」 |
| 其余（`collection` / `dashboard` / `intelligence` / `accounts-list` …） | **0 px** | 渲染本身是确定性的 |

结论：**漂移完全来自时钟，不存在"不可消除的噪声"**。也因此，任何"漂移预算"都不可能有正确上界——它取决于两次 run 隔多久；跨日时 `calendar-dark` 一次就要 1.167%，把预算抬到覆盖最坏情形等于对该视图关掉检查。

**正解落在采集层**：`test-runner.js` 的 `_installCaptureClock()` 在**建页之后、任何导航之前**调用 Playwright 的 `page.clock.setFixedTime()`。选它而不是 `clock.install()` 的理由写在宿主 d.ts 原文里：`setFixedTime` "Makes `Date.now` and `new Date()` return fixed fake time at all times, **keeps all the timers running**" —— 只钉日期、计时器照常跑，因此 `settleForCapture()` 的双 rAF 与 `waitForTimeout` 不受影响；`install()` 会连 `setTimeout`/`requestAnimationFrame` 一起接管，不主动推进就永不触发，等于把就绪逻辑整条掐断。

本机 A/B 实测（两次拍摄间隔 2.5 s，跨秒）：

```
keyword-monitor [off] 两次拍摄不同 ❌   页面 Date: …16:41:27.570Z / …16:41:52.876Z
keyword-monitor [on] 两次拍摄逐字节相同 ✅   页面 Date: 2026-01-01T00:00:00.000Z（两次）
home-baseline  / calendar 同：off 必不同、on 逐字节相同
```

三条配套约束：
① `VISUAL_CAPTURE_FIXED_TIME_ISO=off` 可显式关闭（用于复现"未钉住"这一侧），**写了非法值一律抛错**——静默退回未固定会把基线重新变成跨日必漂，而没人会去查门禁为什么红。
② 宿主不提供 `page.clock` 时不抛错但必须 `console.warn` 出声（观察者要报告自己的失明）。
③ `KNOWN_DYNAMIC` 清空后由 `check-baseline-freshness.test.js` 断言「必须为空」；预算机制的用例改用**合成条目**驱动，不再借生产清单取键——否则清单为空时那条测试会静默变成空跑。

反证三条均已实跑：摘掉 `launch()` 里的装时钟调用 → 只红「接线锁」1 条；把 `_installCaptureClock` 改成恒 `null` 的 no-op → 红 3 条（默认钉住 / 非法值抛错 / 宿主失明）；摘掉非法值的 `throw` → 红 1 条。

另记一条探针教训：第一次定位包围盒时我读的是 `pixelmatch` 的 diff 图，得到"每张都差整页"——
因为 pixelmatch 会把**匹配**的像素也暗化写进 diff 图，`>0` 判据恒真。改成直接逐像素比较两张原图
才拿到上表那些有意义的包围盒。**探针测错变量时报错方式是"什么都不奇怪"，而不是"明显不对"。**

## 4. 相关门禁现状

- `test:all:visual` 已聚合四套共 **103** 例（views 35 + supplementary-views 19 +
  workflows 31 + supplementary-workflows 18），逐套输出
  `[VISUAL-SUMMARY] suite=… total=… passed=… failed=…`。
- CI 的采集步骤**自 2026-09-29 起是阻断门禁**（`Full visual suites (blocking gate)`）。此前它刻意 `continue-on-error: true`，因为基线尚未全部同源；现在 13 条非同源基线已换成同一次 CI 渲染并自证 0 px，于是摘掉该标志，并与 `.github/scripts/workflow-contract.test.js` 的反向断言**同 PR** 变更（加回 `continue-on-error` 会让那条合同测试变红——已实跑反证）。
  摘掉它必须与同源基线**同 PR**（否则会把「基线还没换」变成阻断红）。
  该约束由 `.github/scripts/workflow-contract.test.js` 断言锁住。
- 基线只能取自 CI artifact `visual-test-reports`（QM-4 第 7 条），禁止提交本地图。
## 5. 门禁的第一次实战：它抓到 main 连红 11 次，但**拦不住**制造漂移的那次合并

#2714 落 main 后，这道门禁第一次抓到别人就是 #2761（图文发布字数上限体系）。
按 run 时间轴取证，归因是锁死的而不是推断的：

| 时间 (UTC) | run | head | 结论 |
| --- | --- | --- | --- |
| 2026-10-01T19:05 | 36911663440 | `994be586` | success（最后一次绿） |
| 2026-10-01T21:46 | 36930829645 | **`269352b8` = #2761 合并提交** | **failure（首次红）** |
| 之后每次 main push | 36997221674 … 37082871517 | `69c65bf6` … `4647f21b` | **连续 failure ≥11 次** |

首次红那次的数字与后来每次完全一致，且**同一次 run 的 `Full visual suites (blocking gate)` 是 success**：

```
Full visual suites (blocking gate)      => success      ← 6% 全页阈值对 0.057% 天生失明
Baseline freshness gate                 => failure
  ❌ publish-form-dark.png 1238 px (0.06%)   来源=pixel-gate
  ❌ publish-form.png      1183 px (0.057%)  来源=views
```

漂移内容经肉眼审核：`ArticleEditor.vue` 新增的「`0/10000 字`」计数器把发布表单底部整体下移一行，
包围盒 `y1000–1079`。它是**有意的、已合并的特性**（注释点名 `PRD-PLATFORM-CHAR-LIMITS-2026-10-02 §F1`），
所以正解是重建基线；若它是意外回归，正解就是回退 #2761 —— **这一步判断不能省**，
否则"刷新基线"会变成"把回归钉成新标准"（QM-4 第 4 条要人工审核 diff 图就是这个意思）。

### 5.1 真正值得记的是那条结构性缺口：这是**探测器，不是防线**

#2761 能全绿合并、main 之后连红 11 次，机制原因写在 `visual-test.yml` 的头部注释里：
**2026-09-17 为省 CI 移除了 `pull_request` 触发**（它与 `quality-gate.yml` 的 `QG Visual` 逐行同构，
每次改 `apps/desktop/**` 要占两台 runner），而新鲜度检查器**只接在 `visual-test.yml` 里**，
`QG Visual` 不跑它。⇒ 漂移只能在落到 main 之后被发现，制造漂移的那个 PR 从来不会被拦。

搬到 PR 侧的可行性按渲染来源量化（41 张被跟踪基线）：

- **21 张**由像素门禁产出（`<view>[-dark]-current.png`）⇒ `QG Visual` 在 PR 上就会跑，可直接判；
- **17 张**只由 views 套件产出（`<name>.png`）⇒ PR 上没有同源渲染，需要"只判本次有渲染的那些"的 partial 模式；
- **3 张**无渲染（autonomous-loop 专属，已带理由登记）。

注意 #2761 这次恰好是**一深一浅**：`publish-form-dark.png` 属那 21 张（PR 上就能拦住），
`publish-form.png` 属那 17 张（仍会漏到 main）。所以"接到 QG Visual"只能把漏网面从 41 缩到 17，
不是清零；要清零得让 PR 侧也跑 views 套件，那正是 2026-09-17 移除 PR 触发想省掉的那台 runner。

另记一条与 §3 同一族的教训：本篇最初把这条缺口说成"门禁没用"，这是过头的——
**它抓到了**（连红 11 次就是它在工作的证据），只是**抓得晚**。探测器与防线的差别是发现时机，不是有无价值；
把"没拦住"写成"没用"会诱导别人直接删掉它，而删掉之后 #2761 这类漂移将**永远无人发现**。

### 5.2 缺口已堵：Gate 7b 把新鲜度接进 PR 侧（partial 形态）

上面那条"探测器不是防线"的缺口已关闭：`quality-gate.yml` 的 `visual` job 新增
**`Gate 7b - Baseline freshness (PR-side, partial)`**，紧跟在 Gate 7 像素步骤之后、产物上传之前，
`shell: bash`（一个 run 块两条命令，pwsh 不会中途退出 ⇒ 必须 bash 才 fail-fast）。

**为什么是 partial 而不是全量**：本 job 只跑浅色像素套（暗色套与 views 套件仍只在
`visual-test.yml`），所以一次 PR 运行只产出一部分基线的同源渲染。partial 的语义被钉死为
**只缩小判定面，绝不弱化已判的那部分**：

- 本次无渲染 → 记 `skipped` 并**逐个点名打印**（不得只报数字），不判违规也不记欠账；
- 本次有渲染却过期 → 照常 `BASELINE_STALE` 判红；
- 不带 `--partial` 时行为与原来完全一致（main push 仍是全量判定）。

覆盖面**以该步骤自己的现场打印为准，不在此写死数字**——写死就会随像素套件增删而漂，
而"注释里的数字过期"正是本文档 §3 那条 709 px 误判的成因之一。

四道锁（`check-baseline-freshness.test.js` 4 条 + `workflow-contract.test.js` 1 条）与
七条变异全部实跑并做因果对账：

| 变异 | 变红的锁 |
| --- | --- |
| partial 顺手把过期也免检 | 「partial 不是免检」1 条 |
| 不打印被跳过了哪些 | 「观察者要报告自己的盲区」1 条 |
| `main()` 把 `--partial` 传丢 | 「观察者要报告自己的盲区」1 条 |
| 摘掉 Gate 7b 步骤名 | workflow-contract 1 条 |
| 真删 `--partial` 标志 | workflow-contract 1 条 |
| `shell: bash` 改回 pwsh | workflow-contract 1 条 |

其中一条反证**第一次是无效的**：我把 `--partial` 换成 `# --partial removed`，
注释里仍含 `--partial` 字样，正则照命中 ⇒ 变异后测试仍全绿，看起来像"锁没抓住"，
实际是**变异没改掉被测变量**。改成完全不含该 token 的写法才真红。
判据：做反证时先问「我的替换有没有把被测的那个 token 从字符串里消掉」，
而不是「我有没有改动那一行」。

## 6. 第二次重建：36/41 漂移的逐组归因，以及「禁止盲重建」的前置条件何时才算满足

2026-10-03 对 head `3fd9155e` 派发全量 Visual Tests（run `37096322902`，四套 104/104 通过），
新鲜度门禁汇总行：`检查 41 张 / 违规 36 张 / 登记内动态漂移 0 张 / CI 无渲染 3 张`。

上一轮记录过一条硬约束：**仓库级漂移未归因时禁止从 CI artifact 重建基线**——那等于把全局漂移烤成正确基线，
与 #2685 同型，只是污染源从本机换成了 CI。本轮按该约束**先归因、后重建**，判据是把 36 张按差异包围盒聚类
（`D:/tmp/group-drift.js`），再逐组目视裁剪图。36 张全部落入 4 个包围盒组，归因收敛为两个**已合并的有意改动**：

| 组 | 成员数 | 包围盒 | 现场 | 归因 |
| -- | ---- | ------ | ---- | ---- |
| 1 | 19 | y347–492，x17 w165 | 侧栏多出「自动化」一项 | `1dd05b12 feat(automation): 自动化模块`（PR #2792） |
| 2 | 15 | y347–922，x4 w191 | 「自动化」把展开的「更多」子菜单整体下移一行 | 同上（同一元素，展开态放大了像素量） |
| 3 | 1 | 同组 1 | `home-baseline-dark` 除侧栏外，问候语由「晚上好」变为「夜深了」 | 本轮采集层钉时钟（§3.2） |
| 4 | 1 | y347–1015 | `model-providers-dark` 展开子菜单 | 同组 2 |

组 3 的第二个成因必须按代码核实，不能按「看起来像」写：`HomeGreeting.vue:35` 是
`const hour = new Date().getHours()`，而 `page.clock.setFixedTime()` 伪装的正是 `Date.now`/`new Date()`；
钉到 `2026-01-01T00:00:00Z` 且 runner 为 UTC ⇒ hour=0 ⇒ 命中 `hour < 6 → lateNight` = 「夜深了」。
旧基线里的「晚上好」是钉时钟之前那一次渲染留下的。**所以这一处漂移是本次改动的预期结果，不是回归。**

两条附带取证：

- **渲染源新鲜度**：#2804 的教训是「核对当时为真、落地时已废」。本轮先把分支合到 `origin/main`（`d2c2e02e`）
  再**重新派发**，只用新 head 自己的产物。顺带对照旧产物（`a0e98805`）与新产物（`3fd9155e`）的
  `publish-form.png` = **0 px**，原因是 `PublishGroupPicker.vue` 的 `v-if="items.length > 0"` 在 CI 空 profile
  下整块不渲染（该组件注释已自述这一设计动机）。即 #2817 对像素无影响——**这是一次「不重跑也恰好没事」的巧合，
  不构成下次可以拿旧 artifact 交差的理由。**
- **自证同源**：重建脚本复用门禁自己的 `findRender`（不另写第二份「基线↔渲染」映射），
  结果 41 = 重建 36 + 已相同 2（`first-run.png` / `first-run-dark.png`）+ 无渲染 3（`KNOWN_UNCOVERED` 那三张）；
  用同一份渲染再跑 `evaluateFreshness` ⇒ `violations=0`，且 `git status` 只出现 .png、无任何非基线文件被顺带改写。

口径沉淀：**「禁止盲重建」不是一条永久禁令，而是一条前置条件**——先定位共享元素、确认它是有意的，再统一重建。
把 36 张聚类到 4 个包围盒、4 个包围盒归因到 2 个已合并改动，就是满足该前置条件的最小证据形态。

### 6.1 第二轮：合并 main 后只剩 2 张，且当场定位到具体控件

把 `origin/main`（`a793bd8e`）并进分支后重新派发全量（run `37103860559`，四套仍 `104/104`），
新鲜度汇总行从 `违规 36 张` 变成 `违规 2 张`：
`create-result.png` 6434 px 与 `create-result-dark.png` 7241 px。⇒ 上一轮重建成立（其余 36 张对新渲染仍逐像素相同）。

两处改动可归因：main 这 7 个提交里动了 `ResultView.vue` 与 `PublishHistory.vue`。
但**只有 ResultView 进了违规清单**——`publish-history` 两张不在其中，说明那次改动没有改变被采集状态下的像素。
**这就是"CI 看不到运行库漂移"那一类判据的反面：能进违规清单的才是被证明的，没进的不能反过来推"它一定无关"，只能说"该视图的采集态无关"。**

定位过程有一条要记的探针教训：先用 pixelmatch 的输出图找包围盒，判据写成 `out.data[i+3] > 0` 与 `=== 255`，
两次都得到「bbox = 整页 / 命中 2073600 px」，而 pixelmatch 自己报的差异只有 6434。
原因与本文件 §3 那次同源：**diff 输出图对匹配像素也写了不透明值**，任何按 alpha 的筛选都恒真。
正解是绕开输出图、直接逐像素比两张源图（`|ΔR|+|ΔG|+|ΔB| > 30`），立刻收敛到 
`x968–1151, y100–341` 的窄列 + 六条 ~50 px 间距的横带（= 若干行文字整体下移）。裁剪目视确认：
「返回」由「与标题同行的行内链接」变成「标题上方独占一行的胶囊按钮」，标题随之下移——即另一会话已合并的返回按钮对齐修复。
**属有意改动，重建。**

口径：重建后必须**再派发一次全量**验证「违规数下降到几」，而不是把「本地对同一份渲染 `violations=0`」当成门禁会绿。
本轮两者都给：本地对 `37103860559` 的渲染 `violations=0 / uncovered=3`，且 41 = 重建 2 + 已相同 36 + 无渲染 3。
