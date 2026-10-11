# PRD：视觉判定域对账（visual-baseline-domain）

日期：2026-10-11 · 分支：`visual-baseline-domain` · 基线 SHA：`b96276b1f`（origin/main tip，实测）
change slug：`visual-baseline-domain`

## 1. 问题（一句话）

**注册表说要有 50 个视图、两档主题 = 100 张基线；实际只有 40 张存在，另外 60 张既没人比对、也没有任何门禁能看见"它们不存在"。**

这不是"测试写得少"，而是**判定域与声明域脱钩**：一个视图被登记进注册表，
在 CI 上得到的待遇和它根本不存在于注册表里**完全一样**——都是零红。

## 2. 实测（全部数字当场采集，采集脚本见 §7）

| 项 | 实测值 | 采集方式 |
| --- | --- | --- |
| `viewTests`（all-views）注册视图 | **37** | `scripts/check-visual-coverage.js` 解析 |
| `supplementaryViewTests` 注册视图 | **19** | 同上 |
| `pixelTests`（run-pixel-tests）注册视图 | **20** | 同上 |
| 三表并集视图 | **50** | `buildDomain` |
| 判定域（并集 × 浅/暗两档） | **100** | `THEMES.length = 2` |
| `base-screenshots/` 里实际 PNG | **43** | `readdirSync` 计数 |
| 判定域内**有**基线的条目 | **40** | `evaluate` |
| 缺基线条目 | **60** | 同上 |
| 有基线的那 20 个视图 | **恰等于 `pixelTests` 集合**（两个方向差集都为空数组，实测） | `proof.cjs` |
| **一档基线都没有**的注册视图 | **30** | 50 − 20 |
| 无主基线（注册表里查不到的 PNG） | **3**：`analytics-overview` / `login-form` / `settings-general` | `evaluate.orphans` |

关键的一条是第 9 行：**"被比对的视图集合"和"有基线的视图集合"逐字相等**。
这不是巧合——`ERR_VISUAL_BASELINE_MISSING` 只在 `test-runner.js:563` 的
`pixelRegressionTest` 里抛，而另两套走的是 `aiVisionTest`。

## 3. 为什么四层门禁全都是绿的（逃逸链）

| 层 | 为什么没拦住 |
| --- | --- |
| 像素比对（`QG Visual` Gate 7 / `run-pixel-tests.js`） | 它的迭代域**就是** `pixelTests`。域外的 30 个视图不在它的定义里，不是"漏跑"。 |
| 基线新鲜度（`scripts/check-baseline-freshness.js`） | 迭代域是 `readdirSync(基线目录)` —— **只看存在的基线**，逐张问"你还等于本次 CI 渲染吗"。一张不存在的 PNG 不会被 `readdirSync` 返回，于是"该有却没有"在这道门禁里是**结构性不可见**的。 |
| 全量视觉（`run-all-visual.js` 四套） | 四套各跑各的、各出各的 `[VISUAL-SUMMARY]`，但没有一件事在做"声明的视图"和"实际被守的视图"的对账。采集套件的产物只是 artifact 里的 PNG。 |
| 用例注册表锁（`visual-ci.test.js` / `pixelTests` 断言） | 它锁的是"这套清单别被人偷偷改小"，比的是**清单自己**，不是清单与基线目录的交集。 |

外加两处**主动误导**（同文件、已在本 PR 纠正为实测事实）：
`views/all-views.visual.test.js:49` 与 `:92` 原写着
"首次运行必然报 `ERR_VISUAL_BASELINE_MISSING`，由那次 run 的产物回填"——
而该错误码在这个套件里**永远不会被抛**（它只存在于 `pixelRegressionTest`）。
按这条注释办事的人会等一个不会来的红。

## 4. 系统性漏洞定性

**测试场景缺失** + **流程缺失**的复合：
框架里有"注册视图"这个动作，却没有"注册 ⇒ 必须被守"这个不变量。
任何一次 `routeView('x', …)` 都在免费扩大声明域而不触碰判定域，
且**没有任何东西在看这两个域的差**。

这与本仓已登记的「装饰性门禁」家族同族，但比它更隐蔽：
装饰性门禁是"跑了但恒真"，这里是**根本没有那一步**。

## 5. 修法（本 PR = PR A）

新增单文件门禁 `scripts/check-visual-coverage.js`（+ 同名 `.test.js`），
接在 `quality-gate.yml` 的 **Gate 2c**（`shell: bash`，天然 fail-fast）：

```
判定域 = parse(viewTests) ∪ parse(supplementaryViewTests) ∪ parse(pixelTests)，× THEMES
红：  判定域内缺基线且未登记
红：  登记项已无对应缺口（清单只能缩小）
红：  登记项缺 reason
红：  无主基线未登记
红：  判定域为空 / 任一注册表解析为空 / 数组括号不配平
```

配套：
- `scripts/visual-coverage-debt.json` —— 本轮把**实测的 60 条缺口 + 3 条无主基线**逐条带 reason 登记。
  这是把"沉默"换成"有声的欠账"，不是把问题关掉：登记项必须能被 `check-visual-coverage.js`
  反向检测（补了图不删登记 ⇒ 红）。
- 纠正 §3 末尾那两处不实注释。
- `.gitignore` 显式反选三个新文件（`scripts/*.js` 会静默忽略门禁本体，CI 上 `Cannot find module`）。

### 5.1 三条防止本门禁自己变成装饰品的判据

1. **数组边界 = 跳过字符串字面量的括号配对**，不是 `indexOf(']')`、也不是"行首 `]`"。
   两种退化都在本会话**真实发生过**并被规模下界当场逮住：
   `waitFor: '[data-testid^="platform-"]'` 把 19 读成 3；
   `routeView('publish-history', …, [ {...} ])` 的内层 `],` 把 37 读成 6、19 读成 1。
   静默退化不抛错 ⇒ 缺口会被读成 0，于是"没有缺口"和"什么都没扫"必须可区分（第 4 条判据）。
2. **顶层元素数必须等于取到的 id 数**（`countTopLevelElements`）。
   取 id 的两种写法（`routeView('x', …)` / `{ name: 'x' }`）是**按表选一种**、不取并集——
   实测取并会把 `all` 表里 4 个中文断言标签（`name: '页面主标题'` 等）当成视图混进判定域，
   凭空造出 8 条假缺口。混用写法会让 id 静默少算，这条不变量把它变成出声的红。
3. **规模下界**（真实仓臂 C11：`all ≥ 30 / supp ≥ 15 / pixel ≥ 15`）。
   就是它逮住了我两次解析退化；下界按实测（37/19/20）留一档余量。
4. **空域不许下结论**：`domain.length === 0` 与任一注册表解析为空一律抛错/红。

### 5.2 变异反证（6 条，全部实测变红，驱动收尾断言文件逐字节还原）

| 变异 | 预期红 | 实测 |
| --- | --- | --- |
| M1 元素计数不变量改成恒等 | C1b | rc=1，C1b 红 |
| M2 数组边界退回 `indexOf(']')` | C1 | rc=1，C1 红（另带 8 条） |
| M3 空注册表不再出声 | C3 | rc=1，C3 红 |
| M4 陈旧登记不再报 | C6 | rc=1，C6 红 |
| M5 登记项不要求 reason | C10 | rc=1，C10 红 |
| M6 空判定域当成通过 | C8 | rc=1，C8 红 |

一次返工记录：M6 第一次跑出来是 `rc=undefined / caught=NO`，**不是锁没逮住**，
是我的锚点 `if (domain.length === 0) problems.push` 在源码里不存在（实际写作
`if (domain.length === 0) {`）⇒ 变异从未发生。驱动现在把这种情况印成
`SKIPPED_ANCHOR_hits=0`，与 `caught=NO` 分开——否则"我没改到"会被读成"改坏了也没红"。

## 6. PR B（本 PR 明确不做）

把 CI artifact 里的同源渲染提升为仓库基线，逐批把 `visual-coverage-debt.json` 的 60 项清零。
不在本轮做的理由：① 基线只能取自 CI 产物（AGENTS.md QM-4 第 7 条），一次做 60 张等于
在没有对账器兜底时同时引入 60 个不可归因的漂移源；② 3 张无主基线的去留涉及删除他人文件，
属破坏性动作，须逐个裁决。本轮先把"能看见"落地，清单只能缩小这条纪律才成立。

## 7. 复现

```bash
node scripts/check-visual-coverage.js            # rc=0 自洽 / 1 不自洽 / 2 判定域失联
node --test scripts/check-visual-coverage.test.js
node D:/Data/projects/.tools/tmp/vb66/proof.cjs  # §2 第 9、11 行的等集证明
node D:/Data/projects/.tools/tmp/vb66/mutate.cjs # §5.2 六条变异
```

## 8. QM-6 处置

（评审后回填：两轴通道、findings 路径、逐条成立/否证与采纳理由。）
