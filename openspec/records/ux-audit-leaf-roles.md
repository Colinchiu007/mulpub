---
record: ux-audit-leaf-roles
task: UX 审计 4.4 第二批（叶子角色容器吞掉卡内真实控件）—— 采集库/创作历史两处降级容器 role + 新建叶子角色结构锁与可缩小的例外清单
date: 2026-10-21
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src）+ 设计文档/CHANGELOG，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：叶子角色容器与卡内真实控件（ux-audit-leaf-roles，2026-10-21）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-leaf-roles`（非 C 盘），分支同名裸名；`scripts/start-mp-task.ps1 -TaskName ux-audit-leaf-roles` 创建，判据取产物：`rev-parse --abbrev-ref HEAD` = `ux-audit-leaf-roles`（本次实跑打印）。依赖就绪 `pnpm install --frozen-lockfile` + `node scripts/verify-worktree-deps.js` RC=0 |
| 质量节拍 pre-flight | ✅ | 编辑前确认非共享根 `main`；共享根全程未写入（收尾 `git status --porcelain` 只有本 5 个文件） |
| 自测（新增锁） | ✅ | `apps/desktop/src/leaf-role-contract.test.js` 8 条（QM-6 评审后从 4 条扩到 8 条：新增 i1/i2/i3/i7 四组 fixture），控制跑 `[BASE] rc=0 collected=8 red=0` |
| 自测（消费者并集） | ✅ | 判据取「消费者并集」不是「我改过的文件」：对两个被改视图按 basename 反查测试消费者（`git grep -l -E "(views/\|/)(Collection\|CreateHistory)\.vue" -- 'apps/desktop/**/*.test.js'`）得 **16** 个文件，并上本锁共 **17** 个测试文件全跑 = **324 passed / 0 failed / 0 pending**（`--reporter=json --outputFile` 读数，`testResults` 数组长度 17 且含 `leaf-role-contract`，两条都当场打印） |
| 反证（9 道） | ✅ | 九道变异逐条见 §5.4（每道都写成**可直接照抄到源文件的改法**，验收不依赖临时脚本）：`COUNTERPROOF=ALL_CAUGHT`，控制跑 8 条全绿，红集互不相同（M1=2、M4=4、其余各 1 且各指名不同用例），九条均 `还原字节一致=OK`，跑完 `git status` 只剩本批文件 |
| 静态门禁 | ✅ | `node scripts/check-doc-abs-paths.js` → PASS（`counts=1161 domain=5051 files=561 canJudge=true`；本记录一律 `<仓库父目录>` / `<临时脚本目录>` 占位）；`node .github/scripts/check-locale-sync.js --cjk` → PASS（基线 1330 / 现场 1124，无新增硬编码）；`node .github/scripts/check-max-lines.js` → PASS（`domain=11465`，超限文件 95 / 挂账 95、测试超限 13 / 挂账 12，「无新增超大文件，挂账清单与现实一致」——新锁 188 行，远低于 testLimit 1500）；`node scripts/check-debt-budget.js` → 五项指标全在基线内（`maxFileLines 5356 ≤ 5359` 因既有文件自然回落，其余四项持平）；`node scripts/check-no-brand-residue.js` → PASS（11464 tracked 文件）；`git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` **两口径逐字相等**（35/0、9/0、188/0、3/1、2/1、73/0 ⇒ 行尾未被改写；PRD/CHANGELOG 工作副本 crlf 计数只增加本次新增行数、lone_cr 与 nul 均 0） |
| QM-1 打包 | N/A | 只改 `apps/desktop/src/**`（渲染端），未触碰 `electron/**`、`packages/rpa-engine/**` ⇒ 打包判据不触发 |
| QM-4 视觉回归 | 未跑（如实登记） | 本批改动是**属性移除**（`role` / `tabindex`）与键盘处理器移除，不含任何视觉属性变化；像素门禁对 ARIA 属性结构性失明（它在的是"看起来一样"这一层）。真实风险面是 Tab 顺序变化，属键盘导航判据、由本锁与 4.4 首批的焦点环契约覆盖；判定交由 `QG Visual` 在 CI 执行 |
| QM-6 双模型 | 见第五节（不伪造） | `scripts/ccg-review-decider.js` 的实际 `mode` 读数写在第五节；未把任何 `self_play_resolved` 写进产物 |
| 第一性原因（QM-5 ①） | ✅ | 不是「某个卡缺 tabindex」，而是**上一批的修法在这一类容器上方向相反**：4.4 首批给「非按钮可点元素」补 `role="button" tabindex="0"`，而本批这 5 处容器**内部已经有真实控件**。ARIA 规范里叶子角色（button/link/tab/menuitem/checkbox/radio/img）的子树是 presentational —— 补了 role 就把卡内【编辑】【预览】【关闭】从无障碍树上**主动删掉**。`TabBar.vue` 那处还叠了第二个错：`<button role="tab">` 里套关闭按钮，button 套 button 本身是非法 HTML |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：全仓**没有任何一条测试**在看「容器角色 vs 后代可交互」这件事（本锁是第一条）⇒ 该缺陷类对测试结构性不可见。集成层：视图测试只断言点击行为（鼠标路径），而鼠标路径恰恰是**唯一不受损**的路径。视觉层：像素门禁看不见 ARIA 树。审查层：靠审计 4.4 人工读码。**四类逃逸原因：无测试 / 断言只覆盖未受损路径 / 视觉层失明 / 审查盲区** |
| 系统性漏洞（QM-5 ③） | ✅ | 测试场景缺失 + 审查盲区，具体到：`apps/desktop/src/**` 下无障碍判据只有「键盘可达」（首批补的 `role+tabindex`）这一把，缺一把方向相反的「角色不得吞掉后代」；且首批的修法本身没有配「先问卡内有没有等价真控件」的判据，属于**流程缺失**（同类修复缺一条前置问题清单） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 两处容器降级（`Collection.vue` 采集记录卡、`CreateHistory.vue` 渲染结果卡）：移除 `role` / `tabindex` / 容器级 `@keydown`，保留整卡 `@click` 作鼠标便利；② 降级前**逐字核对等价真实控件的动作与参数**（【编辑】调同一个 `openRecordForEdit(entry.item)`；【预览】push 的是同一串 `encodeURIComponent(r.outputPath \|\| '')`）；③ 回归保护 = `leaf-role-contract.test.js`（4 条：反失明 / 违规必须命中例外清单且不得虚挂 / 每条例外必须带「正解 + 为何不在本批」/ 两个被修站点容器形状与卡内控件同时在位）；④ 引号感知的开标签解析 + 同名闭合标签配对（跳过嵌套），防「属性值里带 `>` 把站点静默漏扫」 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 例外清单 `KNOWN_LEAF_ROLE_CONFLICTS` 只能缩小，且**对应违规消失即报陈旧**（这是防「例外变成永久豁免」的唯一机械手段，M3 实测红在它上面）；② 每条例外必须有非空 reason 且禁止「以后再说」类空话（M2 红）；③ 反失明两条：扫描域 `.vue` 数 > 100、且全仓确实扫到过叶子角色元素（M4 把 `button` 从角色表摘掉 ⇒ 违规归零 ⇒ 被「例外条目虚挂」当场抓到，而不是被读成"干净"）；④ PRD 新增《叶子角色容器与卡内真实控件的同源合同》，把「先问卡内有没有等价真控件，有则降级容器、无则先补内层控件」写成两批共同的判据句 |

## 一、缺陷形状（显示项 / 交互逻辑）

| 项 | 口径 |
|---|---|
| 触发条件 | 容器声明叶子角色，其内部含真实可交互控件（`<button>` / `<a>` / `<input>` / `<select>` / `<textarea>` / `<summary>`，或任意元素带 `@click` / `@keydown` / `tabindex` / `href`） |
| 用户可见症状 | **鼠标侧完全正常**，读屏与无障碍浏览树里卡内按钮彻底消失；键盘侧焦点落在容器上、Enter 触发整卡动作，永远走不到卡内那枚按钮 |
| 为什么不是"少个 aria-label" | 叶子角色使子树 presentational 是规范行为，不是实现缺陷 ⇒ 无法靠"给内层补 label"救，只能改容器角色 |
| 与首批的方向差别 | 首批「缺键盘可达」⇒ 补 role；本批「已有真控件」⇒ 再补 role 反而藏掉控件。同一句判据：**有等价真控件则降级容器，无则先补内层控件** |

## 二、本批站点处置（5 处违规，2 改 3 例外）

| 站点 | 处置 | 依据 |
|---|---|---|
| `views/Collection.vue` 采集记录卡 | 已修（降级容器） | 卡内【编辑】= 同一函数同一参数 |
| `views/CreateHistory.vue` 渲染结果卡 | 已修（降级容器） | 卡内【预览】push 的同一串路由参数 |
| `components/TabBar.vue`（`role="tab"` 内嵌关闭按钮） | 例外 | 正解 = 把关闭按钮移出 tab 元素并重排宽度/hover 命中区，属有像素风险的结构性改动，须单独一批并跑视觉门禁；且此处同时是 button 套 button 的非法 HTML，不能顺手改 |
| `features/accounts/components/AccountManagementCard.vue` | 例外 | 容器点击是"展开/选中"，与卡内 checkbox **不是同一动作** ⇒ 降级前需产品口径定「整卡是否保留点击」，牵动勾选态样式，与 4.1 第二批同批 |
| `views/CopyLibraryView.vue` 文案库卡 | 例外 | 容器是"查看详情"的**唯一**入口 ⇒ 必须先把标题做成真按钮（或 stretched-link）再降级，涉及焦点环归属与样式 |

## 三、四道变异（初版；QM-6 评审后扩为九道，完整表见 §5.4，本表只留 M1-M4 当时的现场读数）

| 变异 | 改法 | 期望红在 | 实测 |
|---|---|---|---|
| M1 | 把 `role="button"` + `tabindex="0"` 加回采集卡容器（被禁形态原样重造） | 「被修站点形状」+「例外清单」两条 | rc=1 红数=2 指名命中=2/2 CAUGHT，还原字节一致 |
| M2 | 把某条例外的 reason 改成空串 | 「每个例外条目必须带非空 reason」 | rc=1 红数=1 指名命中=1/1 CAUGHT |
| M3 | 塞一条对应违规并不存在的例外 | 「清单条目不得虚挂」 | rc=1 红数=1 指名命中=1/1 CAUGHT |
| M4 | 把 `button` 从解析器 `LEAF_ROLES` 摘掉（⇒ 违规归零） | 「清单条目不得虚挂」（虚挂的 3 条当场暴露） | rc=1 红数=1 指名命中=1/1 CAUGHT |

M2 的一条实现注意：变异必须**替换**原条目而不是在同名键后再写一条 —— JS 对象字面量后写覆盖先写，重复键变异会静默失效，表现为 MISSED 但实际是变异本身没生效。

## 四、附带发现（写给下一批，不在本批动）

`src/styles/focus-ring.test.js` 的变体域是按「`tag === 'button' || 'a' || role="button"`」从模板里清点的。因此把 `role="button"` 从容器**搬到**某个 span 上，会同时改变那把锁的判定域 —— 本批刻意选「降级容器、不把 role 搬到别的元素」，避免同一次改动里动两套契约。后续处理 TabBar / CopyLibraryView 时必须同时改这两把锁，并在同一 PR 内跑焦点环测试全量。

## 五、QM-6：本次真跑了外部双模型评审，九条发现逐条处置

### 5.1 判定与通道实况

`node scripts/ccg-review-decider.js --staged` 判 **DUAL**：

```
变更 195 行（≤ 200）但命中 auth/数据库/加密：敏感内容 1 处
变更 195 行 / 3 个源文件 / 敏感命中 0 路径 + 1 内容
```

规模本身够不上 dual，是那 1 处「敏感内容」把它抬上去的，而它是判据**假阳性**：规则 4
`/\b(SELECT|INSERT INTO|UPDATE|…)\b/i` 命中了本锁里的 HTML 标签名字面量 `'select'`。
取证方式：把 `RULES.sensitiveContents` 五条正则原样抄出来，对本次暂存差量逐行跑一遍，
非文档侧只有这一条命中（文档侧的命中按判据不计入模式判定，与入口打印一致）。

两条**刻意没做**：不为了过门去收窄 `sensitiveContents`（那是改「谁来守门」，须人工过目）；
不把 `'select'` 拆成 `'sel' + 'ect'` 之类的绕过写法（那是把缺陷藏进混淆）。

评审通道这次**是通的**（此前两篇记录写的「不可用」在本批已不适用，原因见 5.3）：

```
提交判定: DUAL   跨家族校验: proposer=opencode critic=claude 通过
[轮 1/3] 调用 critic=claude 评审...  评审完成：9 条问题，维度分 4 个，最低分 5
收敛判定: status=self_play reason=selfPlay minScore=5
```

### 5.2 九条发现的处置（采纳并修 6 / 否证 2 / 上报 1）

| # | 严重度 | 处置 | 依据 |
|---|---|---|---|
| i1 | **Critical** | 采纳并修 | 判据成立且可当场复现：不涂白注释时，容器 inner 里只要有一句写着 `</div>` 的 HTML 注释，配对深度就在那里提前归零，其后的真 `<button>` **永久不被看到 —— 锁变绿而缺陷仍在**，正是本锁声称要防的那种静默漏扫。修法：`blankOutNonTemplate()` 把注释与 `<script>`/`<style>` 区块**等长涂白**（非换行字符换成空格，行号与偏移继续对得上原文），扫描一律跑在涂白后的文本上。新增三组 fixture：注释含 `</div>` 且其后有真按钮 ⇒ 必须报红；注释里的示例 `<button>` ⇒ 不得制造命中；`<script>` 里的 `</div>` ⇒ 不得截断。变异 M5 指名红 |
| i2 | Warning | 采纳并修 | 只认原生标签时 `<el-button>` / `<UiButton>` 里的真按钮对锁完全隐形，同一缺陷换一种写法就整条绕过这把锁。修法：`INTERACTIVE_TAGS` 纳入本仓实际在用的交互组件名（`el-button` / `el-checkbox` / `el-radio(-group)` / `el-switch` / `el-input(-number)` / `el-select` / `el-date-picker` / `el-upload` / `el-link` / `el-tabs` / `ui-button` / `router-link`），标签名再按**大小写不敏感**比一次（模板里 Pascal 与 kebab 混用）。边界如实写进注释：**模板级扫描看不到渲染后的 DOM**，容器内放"既不在此清单、模板层也不带交互属性"的第三方组件，本锁结构上判不出来。变异 M9 指名红。**扩域后仓库内违规站点仍是 3 处**（没有新增例外），这条是当场跑出来的读数而不是推断 |
| i3 | Warning | 采纳并修 | 原断言是**文件级** grep，证明不了「降级没丢功能」——等价按钮若属于另一张卡或另一分支，移除容器键盘路径后锁照样全绿，而 PRD 的核心前提恰恰得不到机械保证。修法：新增 `containerOf(src, anchor)`，断言三件事：① inner 非空（锚点或配对失效**不得**被读成「没内容所以没问题」）；② 容器开标签不再带 `role` / `tabindex`；③ 等价控件表达式出现在**该容器区间之内**。变异 M6 指名红 |
| i4 | Warning | 前半否证，后半采纳 | 前半「判定产物不该入库」与本仓既有裁决相反：AGENTS.md「QM-6 与既有门禁的关系」第 3 条写明 `check-pr-exec-record.js` 要读**本次变更集内**的 `mode=dual` 产物；origin/main 的 CHANGELOG（第六/七轮那条）已把「`.ccg/reviews/*.json` 是 QM-6 机械闭环链的载体，gitignore 等于拆掉守门」记为结论；`.gitignore` 只排除 `.ccg/tasks/*` 与工作产物，注释原文即「判定记录 `.ccg/reviews/*.json` 才是留痕」。**后半成立并已修**：本记录原文写「两条外部通道在本机仍不可用」，而产物的 `backendAvailability` 早就显示两个后端 onPath，真正的 blocker 是引擎里写死的他人机器路径 —— 那句叙述与产物并读自相矛盾，现按实况改写（见 5.3） |
| i5 | Info | 采纳并修 | 每份文件被读两遍（收集违规一遍、反失明过滤一遍）。修法：`contents = new Map(...)` 单趟读，两个判据共用同一份。没有顺手把 `matchingCloseStart` 的正则配对缩进「容器所在片段」——186 个文件的规模下它不构成问题，**写清楚边界比"顺手优化"更诚实** |
| i6 | Info | 否证 | 建议把例外键改成 `file:role:行号`。本仓对「账本里存行号」有明确判据与反例：AGENTS.md 写「登记项的值只写原因字符串，MUST NOT 写 `line`（行号）或 `status`」，理由是追加型载体里行号指针**结构上必然过期**（实测 9 条 `line` 中 0 条仍指向自己的行）。行号确实能让「同文件同角色的两个容器」分家，但正解是**锚点片段**而不是行号；本批三条例外各自文件内只有一个该角色容器，没有这种重合，所以不预先建无人消费的键形 |
| i7 | Info | 采纳并修 | 两半都修：`tabindex="-1"`（程序性焦点目标，不是用户可操作控件）不再计成交互，非 -1 仍计；`roleIn` 认 `role="…"` / `role='…'` / `:role="'button'"` 三形 —— **必须先取整个属性值再剥内层引号**，把内层引号直接写进字符类会整条不匹配（第一版就是这么错的，所以配了 fixture）。边界如实声明：`:role="某变量"` 这种运行时才知道的角色判不出来。变异 M7 / M8 各指名红 |
| i8 | Info | 上报，不在本批做 | 「规则 4 把 HTML 标签名当 SQL」的收窄属改「谁来守门」，须人工过目。另补一条**本批现场新发现的机制事实**进上报清单：CI 侧 `QG Changes` 跑的是 `check-pr-exec-record.js --mode=advisory` —— **打印欠账但不阻断**（同一个 PR 本地 `--mode=enforce` 判红、CI 判绿），所以「CI 绿」不等于「QM-6 闭环」，AGENTS.md 自动合并判据第 4 条必须由本地那次 enforce 跑出来，不能拿 CI 的绿代替 |
| i9 | Info | 采纳（部分） | 反证与验收的**判据本体**（扫描器、例外清单、fixture）全在锁文件里、随本提交入库，任何人 `vitest run src/leaf-role-contract.test.js` 即可复跑；`<临时脚本目录>` 里剩下的只是「驱动变异的那层壳」。处置：§5.4 把每道变异改写成**可直接照抄到源文件的改法**，使验收不依赖临时脚本 |

### 5.3 通道能跑起来的两个真实前提（写给下一个会话）

1. **引擎根**：`deep-review.sh` 的三个候选里 `$HOME/.claude/skills/…` 在本机是错根（Qoder 的真实技能根是 `~/.qoder-cn/skills`），`CCG_ARL_DIR` 又默认没人设 ⇒ 报「找不到 ccg-deep-review.js」。可跑的最小动作是显式指根：`CCG_ARL_DIR="<用户目录>/.qoder-cn/skills/adversarial-review-loop/scripts" sh scripts/deep-review.sh --force`。
2. **两份命名键**：判定记录按内容寻址取名 —— 索引脏时键是 `stagedDiffHash`，而 `deep-review.sh` 读的是 **HEAD sha 命名**那份。提交后须用**干净索引**再跑一次 `node scripts/ccg-review-decider.js --base origin/main`（它会打印「暂存 diff（排除 .ccg）为空 ⇒ 回落父 sha 命名」）才落出评审链要读的那份；否则评审 fail-closed 报「本提交有 N 行非 .ccg 改动却没有判定记录」。
3. 引擎内 `model-call.js` 原先把**别人机器上的** `codeagent-wrapper.exe` 绝对路径写死（本机表现为 `spawnSync ENOENT`，且报错只说「评审失败」），已按 `os.homedir()` 解析并把原字面量降为兜底候选之一；这条改动在用户级技能目录里、不在本仓，回滚只需把那一行改回原值。

### 5.4 变异反证（九道，各自指名红；改法可直接照抄复现）

| 变异 | 改法 | 期望红在 | 实测 |
|---|---|---|---|
| M1 | `Collection.vue` 卡片容器加回 `role="button" tabindex="0"` | 被修站点形状 + 例外清单 | rc=1 红数=2 命中 2/2 CAUGHT |
| M2 | 例外 `'components/TabBar.vue:tab'` 的 reason 改成空串 | 例外必须带理由 | 1/1 CAUGHT |
| M3 | 往例外清单塞一条对应违规并不存在的条目 | 条目不得虚挂 | 1/1 CAUGHT |
| M4 | 从 `LEAF_ROLES` 摘掉 `'button'` | 虚挂检测（违规归零被抓） | rc=1 红数=4 命中 1/1 CAUGHT |
| M5 | `const hide = new Uint8Array(n)` 改成 `new Uint8Array(0)`（摘掉涂白） | i1 fixture 那条 | 1/1 CAUGHT |
| M6 | `containerOf` 的 `inner` 返回 `''` | 被修站点（inner 非空前提） | 1/1 CAUGHT |
| M7 | `const focusable = ti !== null && ti[1] !== '-1'` 去掉后半 | tabindex fixture | 1/1 CAUGHT |
| M8 | `roleIn` 退回 `/\brole\s*=\s*["']([^"']+)["']/` | `:role` fixture | 1/1 CAUGHT |
| M9 | 从 `INTERACTIVE_TAGS` 删掉交互组件名那三行 | 组件名 fixture | 1/1 CAUGHT |

控制跑 `[BASE] rc=0 collected=8 red=0`；九条 `还原字节一致=OK`；末行 `COUNTERPROOF=ALL_CAUGHT`。
M4 的红数是 4 而不是 1：摘掉 `button` 角色后，除了「例外条目虚挂」，四组 fixture 里所有以 `role="button"`
为前置的断言一起塌 —— 红集重合是**变异面比锁面宽**的正常表现，不据此判"锁没牙"（每条变异仍指名命中了自己那条）。

## 六、验收锚点

- `pnpm exec vitest run src/leaf-role-contract.test.js`（cwd = `apps/desktop`）→ **8 passed / 0 failed**；
- 消费者并集 17 个测试文件 → 324 passed / 0 failed；
- `node <临时脚本目录>/mw-leaf-role-probe.cjs <仓库>/apps/desktop/src` → `扫描 .vue 文件数=186 违规站点数=3`，且这 3 条与例外清单逐条对应（锁里同款断言）；
- 九道变异 `COUNTERPROOF=ALL_CAUGHT` + 每条 `还原字节一致=OK`（改法清单见 §5.4）。

## 远程同步

| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#NNNN)`，PR 号见本 PR 页面）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；把状态列预写成 `PASS` 会被 `prematureClaims` 判红。**本行的存在本身就是判据**：`check-gate-record-debt.js` 对「整块缺 远程同步 行」的新记录当场判红 —— 本批第一次推 CI 就是被 `QG Changes` 拦下（现场读数 `❌ 记录文件整块缺 远程同步 行 1 篇：ux-audit-leaf-roles.md`），frontmatter 里的 `sync_pr/sync_status` 只是意图声明，替代不了这一行。main push 回读证据写在 PR 评论里，不写回本文件。 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #4184（收口由门禁推导）
