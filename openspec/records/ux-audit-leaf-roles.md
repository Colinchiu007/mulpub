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
| 自测（新增锁） | ✅ | `apps/desktop/src/leaf-role-contract.test.js` 4 条，控制跑 `[BASE] rc=0 collected=4 red=0` |
| 自测（消费者并集） | ✅ | 判据取「消费者并集」不是「我改过的文件」：对两个被改视图按 basename 反查测试消费者（`git grep -l -E "(views/\|/)(Collection\|CreateHistory)\.vue" -- 'apps/desktop/**/*.test.js'`）得 **16** 个文件，并上本锁共 **17** 个测试文件全跑 = **320 passed / 0 failed / 0 pending**（`--reporter=json --outputFile` 读数，`testResults` 数组长度 17 且含 `leaf-role-contract`，两条都当场打印） |
| 反证（4 道） | ✅ | `node <临时脚本目录>/mw-44-mutate.cjs` → `COUNTERPROOF=ALL_CAUGHT`；红集互不相同（M1=2 条 / M2、M3、M4 各 1 条且各指名不同用例），四条均 `还原字节一致=OK`，跑完 `git status` 无残留（M 只有本批 5 个文件） |
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

## 三、四道变异（各自指名红，红集互不相同）

| 变异 | 改法 | 期望红在 | 实测 |
|---|---|---|---|
| M1 | 把 `role="button"` + `tabindex="0"` 加回采集卡容器（被禁形态原样重造） | 「被修站点形状」+「例外清单」两条 | rc=1 红数=2 指名命中=2/2 CAUGHT，还原字节一致 |
| M2 | 把某条例外的 reason 改成空串 | 「每个例外条目必须带非空 reason」 | rc=1 红数=1 指名命中=1/1 CAUGHT |
| M3 | 塞一条对应违规并不存在的例外 | 「清单条目不得虚挂」 | rc=1 红数=1 指名命中=1/1 CAUGHT |
| M4 | 把 `button` 从解析器 `LEAF_ROLES` 摘掉（⇒ 违规归零） | 「清单条目不得虚挂」（虚挂的 3 条当场暴露） | rc=1 红数=1 指名命中=1/1 CAUGHT |

M2 的一条实现注意：变异必须**替换**原条目而不是在同名键后再写一条 —— JS 对象字面量后写覆盖先写，重复键变异会静默失效，表现为 MISSED 但实际是变异本身没生效。

## 四、附带发现（写给下一批，不在本批动）

`src/styles/focus-ring.test.js` 的变体域是按「`tag === 'button' || 'a' || role="button"`」从模板里清点的。因此把 `role="button"` 从容器**搬到**某个 span 上，会同时改变那把锁的判定域 —— 本批刻意选「降级容器、不把 role 搬到别的元素」，避免同一次改动里动两套契约。后续处理 TabBar / CopyLibraryView 时必须同时改这两把锁，并在同一 PR 内跑焦点环测试全量。

## 五、QM-6（如实登记，不伪造）

`node scripts/ccg-review-decider.js --staged` 当场读数：

```
[CCG] 审查模式判定 [验证层(动手后·diff)]: DUAL
      变更 195 行（≤ 200）但命中 auth/数据库/加密：敏感内容 1 处
      变更 195 行 / 3 个源文件 / 敏感命中 0 路径 + 1 内容
      判定已落盘: .ccg\reviews\b49b45795d5c675bf085ea0531b2ca737a95eabb7bf4dd02f8657f5f503d4e65.json
```

- **规模本身够不上 dual（195 ≤ 200），是「敏感内容 1 处」把模式抬到 DUAL**，而那 1 处是**判据假阳性**：规则 4 `/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|…)\b/i` 命中了本锁里的 `const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])` —— 这里的 `select` 是 **HTML 标签名**，不是 SQL。取证方式：把 `RULES.sensitiveContents` 五条正则原样抄出来对本次暂存差量逐行跑（`<临时脚本目录>/mw-44-sens.cjs`），非文档侧只有这一条命中；文档侧 3 条命中（PRD 与本记录各含 `<select>` 字样 + 记录里引用了 `ccg-review-decider.js` 一行）按判据不计入模式判定，与入口打印的「文档行命中敏感词 3 处」一致。
- **没有为了让自己过门去改判据**：收窄 `sensitiveContents`、或把 `'select'` 拼成 `'sel' + 'ect'` 之类绕过写法，都是在改「谁来守门」，前者须人工过目、后者是把缺陷藏进混淆。本批选择照 DUAL 走真实双模型评审。
- 本仓 QM-6 的两条外部通道在本机仍不可用（根因链已在 `ux-audit-knowledge-error-classify` / `ux-audit-aggregate-progress` 两篇记录里逐层取证，最内层是评审引擎 `model-call.js` 里写死的他人机器路径）；评审若未能闭合，本 PR 停在欠账门禁上等人工，**不写任何 `deepReview.status` 来冒充闭合**（判定产物里的 `status` 一律保持引擎写下的原值，包括 `error`）。该风险面本身（移除属性 + 例外清单治理，不改数据、不改鉴权、不改持久化）留待人工过目。


## 六、验收锚点

- `pnpm --filter @multi-publish/desktop exec vitest run src/leaf-role-contract.test.js` → 4 passed；
- 消费者并集 17 个测试文件 → 320 passed / 0 failed；
- `node <临时脚本目录>/mw-leaf-role-probe.cjs <仓库>/apps/desktop/src` → `扫描 .vue 文件数=186 违规站点数=3`，且这 3 条与例外清单逐条对应（锁里同款断言）；
- 四道变异 `COUNTERPROOF=ALL_CAUGHT` + 每条 `还原字节一致=OK`。
