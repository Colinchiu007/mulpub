---
title: "ui-visual-premium：桌面端视觉系统升级（高级感与统一性）"
change: ui-visual-premium
branch: ui-visual-premium
date: 2026-10-20
status: executed
---

# 执行记录：桌面端视觉系统升级

## 任务目标

用户诉求：「整个应用前端界面需要视觉优化……从视觉上不太统一，而且很混乱、很粗糙、不精致。
目标是提高档次，实现高级感和精致感」，参考风格为过渡色 / 毛玻璃 / 半透明 / 柔和。

## 变更类型与隔离声明

- **变更类型**：混合 PR（运行时样式代码 + 文档 + 视觉基线 + 测试脚本 + 巡检证据资产）。
- **隔离方式**：独立 worktree `<仓库父目录>/mp-worktrees/mp-ui-visual-premium`（非 C 盘），
  分支 `ui-visual-premium`（非 C 盘），由 `scripts/start-mp-task.ps1 -TaskName ui-visual-premium` 创建。
  共享主目录保持 `main` clean，未直接改动。
- **不改**：业务逻辑、数据结构、IPC 契约、信息架构、导航层级。

### 文件范围声明（供 CCG 决策层做范围漂移核对）

| 类别 | 路径 | 说明 |
|---|---|---|
| 令牌层 | `apps/desktop/src/styles/tokens.css` | 表面/描边/高度/渐变/玻璃/动效/字体栈令牌 + 暗色同构 |
| 设计系 | `apps/desktop/src/styles/cohere-design-system.css` | 共享类观感口径（标题/按钮/输入/徽章/统计卡/模态/卡片/图标） |
| 设计系（新增） | `apps/desktop/src/styles/premium-design-system.css` | 高级感视觉层：画布/玻璃带/标题体系/分段胶囊/滚动条/焦点环/空态 |
| 外壳 | `apps/desktop/src/styles/sidebar.css`、`apps/desktop/src/App.vue` | 侧栏毛玻璃 + 壳层透明化 |
| 展示页 | `apps/desktop/src/views/Home.vue`、`Dashboard.vue`、`features/dashboard/DashboardLockedPanel.vue` | 首页/看板/锁定面板 |
| 入口 | `apps/desktop/src/main.js` | 引入高级感视觉层（1 行 import） |
| 测试 | `apps/desktop/src/views/Dashboard.style-guard.test.js` | hero 卡断言改为「已定义渐变 token」+ 暗色同构断言 |
| 测试（新增） | `apps/desktop/tests/visual-testing/ui-audit-scripts.test.js` | 巡检脚本冒烟 + 路由覆盖守卫 + 变异反证 |
| 巡检脚本（新增） | `apps/desktop/tests/visual-testing/scripts/ui-audit-{recon,capture,preview,scenes,probes}.js`、`ui-audit-scripts.lib.js`、`accept-baselines.js`、`curate-ui-audit-evidence.js` | 界面面枚举 / 全量截图 / 单页预览 / 场景数据 / 浏览器探针 / 纯函数库 / 基线接受 / 证据挑选 |
| 视觉基线 | `apps/desktop/tests/visual-testing/base-screenshots/*.png` | 40 张（20 视图 × 亮/暗）随本次**有意视觉变更**更新；**来源是 CI artifact 的渲染**，不是本机产物（见「基线来源」小节） |
| 文档 | `01-docs/UI-VISUAL-AUDIT-2026-10-20.md`、`01-docs/PRD-UI-VISUAL-SYSTEM-2026-10-20.md`、`01-docs/design-system-usage.md` | 巡检报告（含改造后复测 §2.6）/ PRD / 令牌口径 |
| 证据资产（新增） | `01-docs/assets/ui-visual-audit-2026-10-20/*.png` | 10 组 before/after（约 3.5MB） |
| 配置 | `.gitignore` | 为证据资产加 `!` 例外（根规则有全局 `*.png`） |
| 审计轨迹 | `.ccg/reviews/*.json`（按内容寻址的若干条 + 1 条按提交 sha 命名）、`.adversarial/ccg-deep-3667f7b6/*`（第二轮）、`.adversarial/ccg-deep-20000c7d/*`（第三轮） | CCG 判定记录 + 双家族评审与裁决 |

## 执行内容

| # | 内容 | 落地 |
|---|---|---|
| 1 | 全量界面面侦察（机器枚举） | `tests/visual-testing/scripts/ui-audit-recon.js` |
| 2 | 全量界面面截图巡检（6 维度 177 张） | `tests/visual-testing/scripts/ui-audit-capture.js` |
| 3 | 令牌层：表面/描边/高度/渐变/玻璃/动效/字体栈 + 暗色同构 | `src/styles/tokens.css` |
| 4 | 共享类观感升级 | `src/styles/cohere-design-system.css` |
| 5 | 高级感视觉层（新增） | `src/styles/premium-design-system.css` + `src/main.js` |
| 6 | 应用外壳（侧栏玻璃带 + 壳层透明化） | `src/styles/sidebar.css`、`src/App.vue` |
| 7 | 展示页升级（首页 / 数据看板 / 锁定面板） | `src/views/Home.vue`、`src/views/Dashboard.vue`、`features/dashboard/DashboardLockedPanel.vue` |
| 8 | 文档 | `01-docs/UI-VISUAL-AUDIT-2026-10-20.md`、`01-docs/PRD-UI-VISUAL-SYSTEM-2026-10-20.md`、`01-docs/design-system-usage.md` |

## 量化结果（32/33 条路由计算样式审计，同脚本同口径复测）

| 维度 | 改造前 | 改造后实测 | 说明 |
|---|---:|---:|---|
| 不同颜色值 | 142 | **144** | 令牌化色（渐变端点、玻璃面）换掉了旧色，长尾仍在组件 scoped 样式里 |
| 不同圆角值 | 22 | **22** | 值数持平但**分布重排**：`8px`(587→224) 让位 `12px`(57→385)、`16px`(14→60) |
| 不同间距组合 | 143 | **143** | 共享类改用 `--space-*`，组件级硬编码长尾未动 |
| 字体栈 | 3 套（PingFang 硬编码 5937 / Arial 1345 / SF Pro 35） | **PingFang 硬编码 0**；统一栈 5869 + 展示栈 79 | 残留 Arial 1338 中绝大多数是 SVG（不渲染文字），文字元素实测 5/78 |
| 页面标题色 | 3 | **1**（`--color-text-strong`） | 品牌色只留给图标、状态与 CTA |

**结论（写进报告 §2.6，不粉饰）**：本轮把**令牌层 / 契约层 / 观感层**的骨架立起来，
共享类层确实接管了元素（圆角频次迁移、字体栈归一）；但**碎片化主因在 234 个组件的 scoped 样式里**，
「不同值个数」三项持平。组件级收敛列为下一阶段，验收口径已写进报告 §2.6.4。

## 关键判据

- 品牌渐变两端白字对比度 ≥ 4.5:1（实测 `#5B5EE8` 4.91:1、`#8B3FD9` 5.51:1）。
- 侧栏文字档亮/暗两套对比度 ≥ 4.5:1（亮色档因侧栏改玻璃底而加深到 `#5f6280`）。
- 焦点环不得移除（WCAG 2.4.7），`focus-ring.test.js` 保持通过。
- 视觉基线属**有意变更**，随本次提交更新；CI 按「同一次 CI 渲染」口径核对漂移。
- 对比度审计（CI Gate 7c）：18 视图 **0 处**低对比度。

### 基线来源：必须由 CI artifact 的渲染重建（本轮踩过的坑）

**现象**：第一版基线是**本机**跑 `run-pixel-tests.js` 重新生成的产物，本机自测 20/20 零漂移，
但 CI 的 **QG Visual** 一直红。判据原文写着「基线必须由 CI artifact 的渲染重建
（QM-4 第 7 条），本机 `test:visual:update-baseline` 的产物不得提交」。

**根因**：`scripts/check-baseline-freshness.js` 的漂移阈值是 **0 px**（不是像素套件的 6%），
本机与 CI runner 的字体/渲染环境不同 ⇒ 同一份代码两边渲染不一致（实测 12 ~ 20384 px 不等），
本机产物在 CI 侧逐张判「BASELINE_STALE」。

**更隐蔽的一格**：判据在亮色像素套件产出的基线上会「**单轮红 + 另一轮没采到**」。
CI 的两轮甄别里第二轮只重跑「views 两套 + 暗档」，**不重跑亮色像素套件**，
于是只由亮色像素套件产出的 `home-baseline.png` 在第二轮没有渲染 ⇒
「只有单轮红证据且另一轮没采到（无证据，不得当 flake 放行）」⇒ 判红。
**只有当第一轮零违规时，判据才会在第一轮直接放行**（工作流 `if` 短路），根本不会进第二轮。

**修法**：从该次 CI 的 artifact `quality-gate-visual-reports` 里取
`tests/visual-testing/screenshots-round1/`（= Gate 7 那轮的渲染），按 `findRender` 的同源规则
（先 `<name>.png`，后 `<name>-current.png`）把 40 张基线重建；3 张 autonomous-loop 专属基线
（`settings-general` / `login-form` / `analytics-overview`）在 CI 里本就无渲染，保持原样。

**修完的读数**（用判据本体复跑，renders 指向同一份 CI artifact）：

```
基线新鲜度[partial]：检查 43 张 / 违规 0 张 / 登记内动态漂移 0 张 / CI 无渲染 3 张 / 本次跳过 3 张
✅ 全部 40 张有渲染的基线逐像素等于本次 CI 渲染
```

**可复核命令**：

```bash
gh run download <run-id> -n quality-gate-visual-reports -D <dir>
node scripts/check-baseline-freshness.js \
  --renders=<dir>/tests/visual-testing/screenshots-round1 \
  --baselines=apps/desktop/tests/visual-testing/base-screenshots --partial
```


## 遗留

见 `01-docs/UI-VISUAL-AUDIT-2026-10-20.md` §8（R1–R6）与本记录 R6/R7。

### R6（CCG 第三轮评审追加）：两项「未实测」的诚实登记

CCG 第三轮评审（critic=claude / proposer=opencode）指出两处
「结论对但取证不足」的地方，登记在此，**在拿到实测数据前不得宣称已解决**：

| 项 | 现状 | 待办 |
|---|---|---|
| **毛玻璃的 GPU 开销** | 模糊半径已从 20px 降到 14px，并加了 `prefers-reduced-transparency: reduce` 守卫 | 降半径是**静态推理**（采样成本与半径正相关）下的风险降低，**不是**实测帧率结论。需在真实 Electron 窗口测滚动/加载下的帧时间 |
| **暗色主题的像素回归** | 亮/暗双主题各 20/20 零漂移（headless Chromium） | 真实 Electron 窗口的合成器行为可能不同（毛玻璃尤其如此），需真实窗口复核 |

performance 维度分**维持评审原值不上调**（correctness 3 / security 3 / performance 4 /
maintainability 2），correctness 亦不上调。

### R7（CCG 第三轮评审追加）：「新增 .adversarial SHA 对齐门禁」列为独立后续项

评审建议新增一条 CI 门禁，校验 `.adversarial/` 里的 SHA 引用与 `git rev-parse HEAD` 一致。
**本轮不实现** —— 按 AGENTS.md「改谁来守门必须人工过目」，新增门禁并接进 changes job
属于改守门结构，不应由 agent 在功能 PR 里顺手做掉。

本 PR 的处置是**把能对齐的部分对齐、把不能对齐的部分写清楚**（见 §四.4），
而不是声称这一格已经闭合。

---

## 四、CCG 外部双家族评审与处置

### 4.1 评审执行

| 轮次 | 评审 head | 判定 | 结论 |
|---|---|---|---|
| 第一轮 | 重放前的提交 | DUAL | 8 条意见（i1–i8）→ 修 7 条（i7 以取证方式判定为已消解） |
| 第二轮 | 重放后的提交 | DUAL | 8 条意见（i1-adj–i8-score）→ 全部处置；其中 i2/i3 指出审计轨迹与 head 脱节 ⇒ 删除重放残留目录、判定记录按内容寻址重建 |
| 第三轮 | 本分支的 feat 提交 | DUAL | 8 条意见（i1–i8）→ 全部处置；i1 质疑外部复核证据的真实性 ⇒ 补可 API 复核的公开评论 + 高危面零命中取证；i5 要求变异反证 ⇒ 已补 |

**后端**：critic=`claude` 2.1.303 · proposer=`opencode` 1.18.34 · 跨家族校验三轮均通过。

### 4.2 第一轮 8 条意见的逐条处置

| # | 严重度 | 评审意见 | 裁决 | 处置 |
|---|---|---|---|---|
| i1 | Critical | `.ccg/reviews/*.json` 的 sha 与 stagedDiffHash 指向不同对象；deepReview 字段为空 | **部分成立** | sha/hash 不同维度是既定设计（内容寻址 + pre-commit 写在父 sha 上）；但「提交了 amend/rebase 中间态记录」成立 → **已删**两条中间态记录 |
| i2 | Critical | 记录里的 changedLines/fileCount 与 sha 不同源，审计轨迹不可靠 | **成立** | 同 i1 的根因；**已修**——重放后改用全新 commit 重做（不 amend），保证 `git diff --cached` 与 `git diff HEAD^ HEAD` 同一口径，判定记录按内容寻址成功命中 |
| i3 | Warning | 全局 `backdrop-filter: blur(20px)` 在 Electron 里是 GPU 密集操作 | **成立** | 本仓玻璃区背后是静止内容（画布 `background-attachment: fixed`、工作区自带滚动），实际风险低于指控；仍**已修两道**——模糊半径 20px→14px；新增 `prefers-reduced-transparency: reduce` 守卫退回实心表面 |
| i4 | Warning | 新断言只查 token 存在，缺暗色档同构校验 | **成立** | 暗色缺定义时断言照样绿 ⇒ 暗色 hero 卡回退无背景（PR #2075 同型）。**已修**——新增「品牌渐变 token 亮/暗双档同构」断言，两处作用域都必须定义且都含渐变 |
| i5 | Warning | 20 张二进制 PNG 入库；.gitignore 例外冗余 | **部分成立** | 量化有误（实为 20 张 / 约 3.5MB，非 48MB——48MB 是留在 gitignored 目录的全量集）；「例外冗余」也不对（根 `.gitignore` 有全局 `*.png`，新文件必须靠 `!` 例外才能入库）。已按「最小证据满足评审需求」收敛为 10 组 before/after，例外补注理由与体积 |
| i6 | Info | `accept-baselines.js` 用文件名拼 RegExp 未转义 | **成立** | **已修**——新增 `escapeRegExp()`，文件名中的 `.`/`+`/`(` 等元字符不再被当模式 |
| i7 | Info | 新增的 transform/box-shadow 过渡可能与组件级动画冲突 | **不成立** | `transition` 与 `animation` 是两条独立通道；改动只涉及共享类的 transition 属性列举，组件级 `@keyframes fadeInUp` 不受影响 |
| i8 | Warning | 新巡检脚本共 1150 行，零单测 | **成立** | 核心风险是「覆盖完整性无人看守」，完全可测。**已修**——新增 `tests/visual-testing/ui-audit-scripts.test.js`，含**路由覆盖守卫**（router 全路径 vs 巡检清单求差集，漏登记即红，正确处理重定向源与 `:param` 动态路由两种豁免）。未采纳「把 playwright 钉成精确版本」——仓库统一 caret 范围，浏览器版本由 CI 的 `playwright install chromium` 决定 |

### 4.3 第三轮 8 条意见的逐条处置

| # | 评审意见 | 处置 |
|---|---|---|
| i1 | Self-play 裁决引用了无法验证的 PR 评论 URL，属伪造证据 | **已修**——补真评论（`gh api issues/4124/comments` 可复核，comment id / created_at / 正文逐条给出），并在记录里写明复核命令 |
| i2 | 维度分 4 低于可信合格线；adjudication 引用的 SHA 与当前 head 无关 | **已修**——审计轨迹按内容寻址重建（见 §四.4）；维度分**不上调**，维持评审原值 |
| i3 | auth 高危项同样引用同一不可验证 URL | **已修**——补可机器复核的高危面零命中取证：`git show --name-only HEAD \| grep -E 'credential-\|account-state-lock\|/auth/\|login-state\|fingerprint'` 零命中，3124 行新增行全扫鉴权/加密关键字零命中 |
| i4 | 毛玻璃缺真实 Electron 帧率数据 | **未实测**——**登记为 R6**，performance 分维持 4 不上调 |
| i5 | 巡检脚本行数多、单测少 | **已修**——脚本拆分为「场景数据 / 浏览器探针 / 编排 / 纯函数库」；抽出 `ui-audit-scripts.lib.js#computeUncoveredRoutes` 纯函数，用例往 router 注入假路由 `/__mutation-probe`，断言守卫**当场判红并点名它**（变异反证，不是只断言「当前是绿的」） |
| i6 | 二进制资产与全量集双轨、无单一来源清单 | **已修**——仓内保留 10 组 before/after（约 3.5MB）+ 177 条标注清单；全量 387 张按仓库约定留在 gitignored 目录 |
| i7 | 暗色像素回归只覆盖 headless | **部分成立**——**登记为 R6**，真实 Electron 窗口复核列入待办 |
| i8 | 审计轨迹靠人工对齐 SHA | **部分成立**——新增 CI 门禁属「改守门结构」→ **登记为 R7 交人工**；本 PR 先把能对齐的对齐（见 §四.4） |

### 4.4 审计轨迹与 SHA 对齐现状（本轮如实交代）

**产物与轮次的对应关系**（目录名 = 评审发生时的 head）：

| 产物 | 对应轮次 | 状态 |
|---|---|---|
| `.adversarial/ccg-deep-3667f7b6/` | 第二轮 | 在仓 |
| `.adversarial/ccg-deep-20000c7d/` | 第三轮 | 在仓 |
| 第一轮的 `.adversarial/ccg-deep-780717af/` | 第一轮 | **按第二轮 i2/i3 的处置整份删除**（重放残留） |
| `.ccg/reviews/<64hex>.json` × N | 各轮判定记录 | 内容寻址（文件名 = stagedDiffHash）；**每笔提交会自动追加一条**，故此处不写死条数 |
| `.ccg/reviews/<40hex>.json` × 1 | 按提交 sha 命名的那条 | **已改名对齐到本分支实际提交** |

**本轮做的对齐动作**：分支在评审后经历多次重放（rebase 到主干），
提交 SHA 随之变化，导致按提交 sha 命名的那条判定记录指向了已不存在的提交。
主干实测口径是「`.ccg/reviews` 里 813 条按 sha 命名的记录 **全部**指向真实存在的提交（0 悬空）」，
本分支那条是唯一的例外 ⇒ **已改名对齐**，不变式恢复。

**仍然存在的缺口（不宣称闭合）**：`.adversarial/ccg-deep-<sha>/` 的目录名是**评审发生时的 head**，
与分支最终 tip 不相等。这正是第三轮 i8 要求用 CI 门禁机械化的那一格，
按仓库铁律「改谁来守门必须人工过目」**登记为 R7，不在本 PR 内实现**。

**可复核命令**（第三方可自行执行）：

```bash
# ① 本分支的判定记录是否都指向真实存在的提交
git ls-tree -r --name-only HEAD -- .ccg/reviews | grep -E '[0-9a-f]{40}\.json$' | while read -r f; do
  sha=$(basename "$f" .json); git cat-file -e "$sha^{commit}" && echo "OK  $sha" || echo "DANGLING $sha"
done
# ② 产物目录名对应的 head 是否还能在历史里找到
git log --all --oneline | grep -E '^(3667f7b6|20000c7d|780717af)'
```

### 4.5 处置后的验证

- 巡检脚本冒烟 + 路由覆盖守卫 + 变异反证：**6/6**
- 样式契约 / 骨架契约 / 令牌 / 看板守卫：**81/81**
- 视觉基线新鲜度（判据本体复跑，renders 指向同一份 CI artifact）：**40/40 逐像素相等，违规 0 张**
- 视觉基线像素回归（阈值 0.06）：**亮/暗双主题各 20/20 通过**
- 对比度审计：18 视图 **0 处**低对比度
- 改造后量化复测：报告 §2.6（同脚本同口径）

---

## 五、远程同步

- 保留门禁：变更类型与隔离声明 ✅ | 视觉基线零漂移 ✅ | CCG 双家族评审 ✅ | 远程同步 PR #4124

| 远程同步 | 由门禁推导 |
| --- | --- |

> 状态列写「由门禁推导」而非手写 `PASS`：收口由 `scripts/lib/merge-ledger.js` 按主干历史
> 推导（合并后自动闭合），手写闭合词会被 `check-gate-record-debt.js` 判 `prematureClaim` 红。
> 依据：`openspec/specs/openspec-integration/spec.md`「分层分支策略」Requirement
> + `change: gate-record-sync-derived-status` / `change: ban-record-closure-backfill-pr`。
