# BUGFIX：采集页「知乎收藏文章」的「采集」「改写」按钮点击无反应（zhihu-fav-buttons-dead）

- 报障时间：2026-10-16
- 分支 / worktree：`zhihu-fav-buttons-dead` / `<仓库父目录>\mp-worktrees\mp-zhihu-fav-buttons-dead`（临时隔离 worktree，任务收尾后按 R1-R5 清理）
- 影响范围：采集页 → 「知乎收藏文章」分组 → 底部「旧整夹直采」行的 **「采集」「改写」两个按钮**
- 严重度：**高**（功能完全不可用，且无任何反馈；用户无法自行判断是「没配好」还是「坏了」）
- 关联 PRD：`PRD-ZHIHU-FAV-BATCH-2026-10-03.md`（本次订正其 §4 交互逻辑）

---

## 1. 现象与用户表述

> 「在应用的采集-知乎收藏文章-点击"采集"和"改写"按钮，都没有任何反应。」

关键点：**不是报错、不是转圈、也不是提示失败，而是"零反应"** —— 按钮点下去没有任何视觉或文案变化。
这个措辞本身就是判据：它排除了「请求发出后失败」，直指「点击事件根本没有派发」。

---

## 2. 复现与取证

### 2.1 代码路径定位

用户引用的两个文案与 locale 逐字一致，因此定位无歧义：

| 按钮 | 位置 | 文案 key | 文案（zh） |
|---|---|---|---|
| 采集 | `BatchCollectPanel.vue` 「旧整夹直采（保留兼容）」行 | `collection.zhihuFavlist.collectBtn` | 采集 |
| 改写 | 同上 | `collection.zhihuFavlist.rewriteBtn` | 改写 |

修复前的模板：

```html
<div class="zb-row zb-mt8">
  <button @click="zhihuFavlistBatchCollect" :disabled="zhihuFavlistBatching || !zhihuSelectedFavlist">采集</button>
  <button @click="zhihuFavlistBatchRewrite" :disabled="zhihuFavlistBatching || !zhihuSelectedFavlist">改写</button>
</div>
```

### 2.2 用户实际数据状态（只读取证，排除"没配置"这一支）

读 `shared-user-data/multi-publish.db` 的 `settings` 表（28 行）：

```
key:   user:6c90f6c6…c37630:zhihu_api_config
value: {"accessSecret":"<密文 96 字符>","enabled":true,
        "updatedAt":"2026-10-16T12:55:11.204Z",   ← 北京 20:55 保存
        "verifiedAt":"2026-10-16T12:58:05.852Z",  ← 北京 20:58 测试连接成功
        "favlistCount":3}
```

**结论：凭据已配置、已加密落库、测试连接已通过（拿到 3 个收藏夹）。**
⇒ 采集链的 IPC / 权限门 / safeStorage 解密**全部正常**，问题不在凭据侧。
这一条很重要：它把「没配置所以按钮灰」这个看似合理的解释**证伪**了。

### 2.3 第一性原因（四个事实叠加）

1. `zhihuSelectedFavlist` 是 `ref('')`，**全仓没有任何代码给它赋初值**（唯一赋值点是用户手动操作下拉框 `v-model`）。
2. 那个下拉框渲染在 `v-if="zhihuFavlists.length"` 内 ⇒ **未点过「获取收藏夹」时，用户根本看不到下拉框，也就无从"选择"**。
3. 但两个按钮**不在**该 `v-if` 内（它们在无条件的 `zb-row` 里）⇒ **按钮一直可见、永远不可点**。
4. `HTMLButtonElement` 处于 `disabled` 时**不派发 click 事件** ⇒ 点了就是"零反应"，连一次请求都不会发出，自然也没有任何错误提示。

⇒ **「看起来随时能点的按钮」+「代码永不建立的选中态」= 恒灰死键。**

### 2.4 引入点取证（`git log -S`）

```
git log -S "!zhihuSelectedFavlist" -- apps/desktop/src/features/collection/BatchCollectPanel.vue
→ b6052e5c9 feat(collection): 采集页 UI/UE 精致化（collection-ui-refinement） (#3409)
```

**引入提交是 `b6052e5c9`（PR #3409「采集页 UI/UE 精致化」）**，即上一次采集页 UI 改造引入。
**不是** `abec241c2`（PR #3656 知乎 Access Secret 设置化）—— 该 PR 虽同改此文件，但未触碰这两个判据。
如实登记这一点：报障时间紧邻 #3656 合并，容易被误判成那次改造的回归，取证结论是**更早的 UI 精致化遗留**。

---

## 3. 缺陷清单（一处报障，五个独立缺陷）

| # | 缺陷 | 位置 | 用户可见后果 |
|---|---|---|---|
| **D1** | 「采集」按钮判据 `!zhihuSelectedFavlist`，而该 ref 从不自动初始化 | 模板 + `loadZhihuFavlists` | 按钮恒灰、点击零反应 |
| **D2** | 「改写」按钮**根本不需要**收藏夹选择（它改写「本次采集结果 / 父级传入的有正文条目」），却共用同一判据 | 模板 + `zhihuFavlistBatchRewrite` | 没选夹时改写也恒灰 |
| **D3** | `scope='all'`（全部收藏）时下拉框被 `:disabled`，用户永远无法满足「必须选中一个夹」 | 模板 | 「全部收藏」模式下两个按钮**永久**不可用 |
| **D4** | handler 内 `if (!zhihuSelectedFavlist.value) return` —— **静默返回**，连提示都没有 | `zhihuFavlistBatchCollect` | 即使被调用也毫无反馈（第二道静默） |
| **D5** | 老「整夹直采」只走 `zhihuFavlistContents({urlToken})`，不支持 `scope='all'`；而同文件 `loadZhihuFavItems` **已正确**分流到 `zhihuFavlistUnifiedContents` | `zhihuFavlistBatchCollect` | 新旧两条入口对「全部收藏」的语义漂移 |

**D2 与 D3 是本次报障的"隐藏放大器"**：即使给 D1 打了补丁（比如强行自动选中），D2/D3 仍会让改写与 all 模式保持不可用。

---

## 4. 逃逸分析（为什么测试没拦住）

按「单元 → 集成 → E2E → 视觉 → 评审」五层逐层说明：

| 层 | 当时状态 | 为什么没拦住 |
|---|---|---|
| 单元（组件行为锁） | **有** `zhihuFavlistBatchCollect` / `zhihuFavlistBatchRewrite` 的用例，全绿 | 用例写法是 `w.vm.zhihuSelectedFavlist = '111'` **手动塞值**后 `await w.vm.zhihuFavlistBatchCollect()` **直接调方法** —— 既跳过了「这个值在真实使用中从何而来」，也跳过了「按钮到底能不能点」 |
| 集成（IPC 层） | 有 handler 测试，全绿 | handler 测试传入的是**已解析好的参数**，不经过 UI 可用性判定 |
| E2E | 采集页 E2E 未覆盖该分组 | 知乎收藏依赖真实平台接口，E2E 未做该分支 |
| 视觉回归 | 无 | 像素门禁只看「渲染是否一致」，**看不到「disabled 是否合理」** —— 按钮灰着与设计稿一致，像素全绿 |
| 代码评审 | 两轮（含 QM-6 双模型） | 评审看的是「逻辑是否正确」，而这里是**「契约是否完备」**：每行代码单独看都对，缺的是「谁负责建立那个选中态」 |

**系统性漏洞定位**：属于 **测试场景缺失 + 测试层级错位**，且根因在**文档层**：
`PRD-ZHIHU-FAV-BATCH-2026-10-03.md` §4 只写了一行「旧入口兼容：现有按钮保留，与新流程并存」，
**没有定义可用性判据（何时可点）与不可用时的可见原因（为什么不可点）**。
实现者于是只能自己猜，猜出了 `!zhihuSelectedFavlist`；测试作者也只能照着实现的形状写用例（塞值 + 调方法）。

> 一句话：**PRD 缺契约 ⇒ 实现自由发挥 ⇒ 测试照抄实现 ⇒ 死键逃逸全程无人拦。**

---

## 5. 修复

### 5.1 数据校验

本次不新增用户输入，但**收紧了「目标就绪」的判据**：

| 校验项 | 规则 |
|---|---|
| 采集目标 | `scope === 'all'`（全部收藏）**或** 已选中一个具体收藏夹（`urlToken` 非空） |
| 改写来源 | 「本次采集结果非空」**或**「父级传入条目中至少 1 条 `content.trim().length >= 20`」 |
| 收藏夹清单 | 加载成功后，若当前选中值**不在新清单中**（含空串）⇒ 自动选中第一项 |
| 无目标调用 | 一律**出声**（设置错误提示），禁止静默 `return` |

### 5.2 功能逻辑

新增两个**单一真源** computed（避免「按钮判据」与「handler 判据」各写一份而漂移）：

```js
/** 采集目标是否就绪：全部收藏模式不需要选具体夹；指定夹模式必须有选中项 */
const zhihuFavTargetReady = computed(() => zhihuFavScope.value === 'all' || !!zhihuSelectedFavlist.value)

/** 改写来源（与 zhihuFavlistBatchRewrite 共用同一判据） */
const zhihuFavRewriteSource = computed(() => (
  zhihuFavlistResults.value.length
    ? zhihuFavlistResults.value
    : (props.rewriteFallbackItems || []).filter((x) => (x.content || '').trim().length >= 20)
))

/** 改写是否可发起：只看有无可改写来源，与是否选收藏夹无关 */
const zhihuFavRewriteReady = computed(() => zhihuFavRewriteSource.value.length > 0)
```

- `zhihuFavlistBatchCollect`：判据换成 `zhihuFavTargetReady`；无目标时**写错误提示**而非静默返回；
  并按 `scope` 分流（`all` → `zhihuFavlistUnifiedContents`，`favlist` → `zhihuFavlistContents`），
  与 `loadZhihuFavItems` **同语义**（D5 消除）。
- `zhihuFavlistBatchRewrite`：来源改用 `zhihuFavRewriteSource.value`（D2 消除双真源）。
- `loadZhihuFavlists`：成功后**自动选中第一项**（D1 消除，把"选择态"从浏览器默认渲染里拿回代码）。

### 5.3 交互逻辑

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 刚进入面板、未加载清单 | 两个按钮**可见但恒灰**，无任何解释 | 采集：灰 + 「请先点『获取收藏夹』，或在范围里选『全部收藏』」；改写：灰 + 「还没有可改写的内容，请先用『采集并改写』采集一批」 |
| 点了「获取收藏夹」且有数据 | 下拉框视觉上显示第一项，但内部值仍为 `''` ⇒ 按钮仍灰 | **自动选中第一项** ⇒ 采集按钮立即可点（无需用户额外点一次下拉框） |
| 范围选「全部收藏」 | 下拉框禁用 ⇒ 采集按钮永久灰（死锁） | 采集按钮**可点**（该模式本就不需要选具体夹） |
| 已采集过一批、想只改写 | 因未选夹而灰 | 可点（改写只看有无来源） |
| 无目标时被程序调用 | 静默返回，零反馈 | 出声提示 |

### 5.4 显示项

| 位置 | 显示项 | 条件 |
|---|---|---|
| 「旧整夹直采」行 | 「采集」按钮 | 恒显示；`zhihuFavlistBatching || !zhihuFavTargetReady` 时 disabled |
| 同上 | 「改写」按钮 | 恒显示；`zhihuFavlistBatching || !zhihuFavRewriteReady` 时 disabled |
| 按钮行下方 | **采集不可点原因**（`.col-hint`，`data-testid="zhihu-favlist-target-hint"`） | `!zhihuFavTargetReady` |
| 按钮行下方 | **改写不可点原因**（`.col-hint`，`data-testid="zhihu-favlist-rewrite-hint"`） | `!zhihuFavRewriteReady` |

> 两条提示**各自独立渲染**（不用 `v-else`）：两个按钮的不可用原因不同，合并显示会让用户以为只有一个问题。

### 5.5 提示文字（locale zh/en 成对，禁止渲染端硬编码）

| key | zh | en |
|---|---|---|
| `collection.zhihuFavlist.pickFavlistFirst` | 请先点「获取收藏夹」，或在范围里选「全部收藏」 | Load your favorites first, or choose "All favorites" as the scope |
| `collection.zhihuFavlist.rewriteNeedsSource` | 还没有可改写的内容，请先用「采集并改写」采集一批 | Nothing to rewrite yet — collect a batch with "Collect & rewrite" first |

### 5.6 顺带修复的既有契约缺失（同族，如实登记）

`BatchCollectPanel.vue` 的 `defineEmits` 原先只有 `['collected','error']`，而父级
`Collection.vue:144` **一直在监听** `@collected-rewrites`。当前靠 Vue 的 fallthrough 侥幸可用，
一旦根节点变为多节点（fragment）监听器会**静默失效**（组件照常 emit、父级收不到）。

- 修复：`defineEmits(['collected','error','collected-rewrites'])`
- 实测佐证：跑组件测试时**每次 emit 都刷一条** `[Vue warn]: Component emitted event "collected-rewrites" but it is neither declared in the emits option…`；声明后该 warning **消失**。
- 回归锁：断言 `w.emitted('collected-rewrites')` 可观察且载荷为「有改写稿 + 有来源」的条目。

---

## 6. 验收标准

| 编号 | 验收标准 | 判据 |
|---|---|---|
| A1 | 未加载清单时，采集按钮不可点且**给出可见原因** | 组件锁：`attributes('disabled')` 存在 + hint 文案含「获取收藏夹」 |
| A2 | 拉取清单成功后，**无需用户额外操作**采集按钮即可点 | 组件锁：`zhihuSelectedFavlist === '111'`（第一项的 token） |
| A3 | 范围选「全部收藏」时，采集按钮可点 | 组件锁：`scope='all'` + 未选任何夹 ⇒ 非 disabled |
| A4 | 「全部收藏」模式采集走 `zhihuFavlistUnifiedContents` | 组件锁：断言该通道被调用且结果 emit 出 `sourceUrl` |
| A5 | 无目标时调用采集**出声**而非静默 | 组件锁：`zhihuFavlistError` 非空且含「获取收藏夹」 |
| A6 | 改写按钮可点性**与是否选收藏夹无关** | 组件锁：未选夹 + 有可改写来源 ⇒ 非 disabled |
| A7 | 无可改写来源时改写按钮不可点且有原因 | 组件锁：disabled + hint 文案含「可改写」 |
| A8 | `collected-rewrites` 事件已声明且可被父级观察到 | 组件锁：`w.emitted('collected-rewrites')` 有载荷 |

---

## 7. 回归保护与变异反证

- 新增 7 条组件行为锁（`batch-collect-panel-behavior.test.js`，累计 24 条）
- **变异反证 5/5 CAUGHT**（基线绿；每个变异都被指名用例擒获）：

| 变异 | 内容 | 结果 |
|---|---|---|
| M1 | 「采集」判据退回 `!zhihuSelectedFavlist` | CAUGHT（由 A3 用例擒获） |
| M2 | 「改写」判据退回 `!zhihuSelectedFavlist` | CAUGHT（A6） |
| M3 | 去掉自动选中第一项 | CAUGHT（A2） |
| M4 | handler 退回静默 return | CAUGHT（A5） |
| M5 | all 模式退回走 contents | CAUGHT（A4） |

> 变异驱动自身也踩了三个判据坑，一并记录：① 工作区是 **CRLF**，LF 锚点静默 `ANCHOR_MISS`；
> ② `execFileSync(..., {shell:true})` 会把**含空格的用例名**拆成多个参数，导致该用例"没跑"（伪 `NOT_RUN`）；
> ③ **A1 用例对 M1 无判别力**——「未加载清单」状态下两个判据取值等价（都 disabled），这是数学事实，
> 故 M1 的判别用例必须选 A3（`scope='all'`，该状态下两判据取值相反）。把 A1 当 M1 的证据会写出假结论。

---

## 8. 预防措施（落地为文件变更）

| 措施 | 落地 |
|---|---|
| PRD 必须写「按钮可用性判据 + 不可用时的可见原因」，不能只写「按钮保留」 | 订正 `PRD-ZHIHU-FAV-BATCH-2026-10-03.md` §4 交互逻辑表 |
| 「可见控件」的可用性判据必须有单一真源 computed，禁止模板与 handler 各写一份 | 本文件 §5.2；模板与 handler 共用 `zhihuFavTargetReady` / `zhihuFavRewriteReady` |
| 禁用状态**必须**配可见原因（禁用即静默 = 用户无法区分"坏了"与"没配好"） | 本文件 §5.4 + 两条 locale 文案 + A1/A7 锁 |
| 组件行为锁**禁止**用「手动塞内部状态 + 直接调方法」覆盖带 disabled 的按钮 | 新增用例一律断言 `data-testid` 的 `disabled` 属性与提示文案；本次 7 条全部照此写 |
| 事件契约必须显式声明 | `defineEmits` 补齐 + A8 锁 |
| 变异反证要指名用例，且**先验证该用例对该变异真的有判别力** | 本文件 §7 的坑②③ |

---

## 9. 未闭合（不假装已闭合）

1. **本次为静态 + 组件级证据，未做真机点击验证**：需要你在真实应用里点一次「获取收藏夹 → 采集 → 改写」确认端到端可用（尤其知乎平台的真实返回）。
2. **✅ 已处理（2026-10-17）**：原文为「「旧整夹直采」与「采集并改写」两条入口仍并存」。项目负责人当日决策**删除旧入口**，只保留「采集并改写」——删除范围、迁移路径、验收与遗留见 `PRD-ZHIHU-FAV-BATCH-2026-10-03.md` **§4.2**，执行记录见 `openspec/records/zhihu-fav-entries-consolidate.md`。本节保留原文以便追溯当时的判断边界（当时把收敛留给「单独评审」，事后确实走了单独评审）。
3. **⚠️ 该登记的前提已被实测推翻（2026-10-17 纠正）**：原文写「`scope='all'` 下采集会拉全量清单再采，与「采集并改写」相比多一次清单请求」。核对 IPC 后确认**不成立**——后端没有「按收藏夹直接采集」的单一通道，只有 `zhihu-favlist:contents`/`unified-contents`（拉清单）+ `batch-collect`（按 url 采内容）+ `zhihu-fav-batch:run`（采集+改写编排）。**两条入口都必须先拉清单**，因此不存在「旧入口多一次」。唯一可做的是「复用已加载清单」，但那会让用户刚在知乎上新收藏的条目不进入本批（可感知为「为什么少了几篇」），故**决定不优化**、按现状保留每次取最新清单。**教训**：登记「性能优化项」时必须先核对该路径的调用链是否真的存在冗余请求，否则登记本身就是一条假信息。
4. 未加像素/视觉回归锁：本次改动新增了两条提示行，理论上会改变布局；但该行文案是**条件渲染**（仅在按钮不可点时出现），默认态像素不变，故未刷新视觉基线。若后续 CI 像素门禁在采集页报红，应按「判定差异是否由本次新增提示行导致」逐项核对，而不是直接刷新基线。
5. **补记（2026-10-17）**：第 2 项落地为删除旧入口后，`collection` 像素门禁实测仍为 **1/1 PASS（misMatch 0）**——因为被删的整块 UI 位于「知乎收藏文章」**折叠组内**，采集页默认态截图看不到它。**这意味着像素门禁对该改动是盲区**，删除正确性由 21 条组件锁守（详见 §4.2.8 遗留第 2 条）。

6. **新发现的可用性回归（2026-10-17，用户实测反馈，已修）**：删旧入口时把**路标**一起拆了。用户反馈原话：「在知乎收藏文章区域，没有「采集并改写」按钮啊，怎么操作？」

   **核因**：「采集并改写」按钮在 `v-if="zhihuFavItems.length"` 内，而 `zhihuFavItems` 初始为空、只在 `loadZhihuFavItems()` 成功后填充 ⇒ **「加载收藏内容」之前该按钮在 DOM 里不存在**（不是禁用，是没渲染），且此时界面**没有任何文字**告诉用户下一步该点「加载收藏内容」。

   **旧入口为什么没这个问题**：它的两个按钮是**常驻**的（虽然一直不可点），旁边配着「请先获取收藏夹并选择要采集的收藏夹」这类提示 —— 用户**永远知道下一步做什么**。删按钮是对的（双真源必须消除），但**把提示一起删是过头**。

   **与本 Bug 的同型性**：本 Bug 的判据是「按钮可见/可点/点了有效」；这条回归是它的镜像 ——「按钮该出现时没出现、且不解释」。两次都栽在**同一类盲区：只验证控件本身，不验证"用户怎么知道该点哪个"**。

   **修法**：只补**纯文案路标**（`data-testid="zhihu-fav-step-hint"`），按「无收藏夹 → 有收藏夹无条目 → 有条目」三阶段显示/消失，**不恢复旧按钮**。设计、显示项、验收标准与遗留见 `PRD-ZHIHU-FAV-BATCH-2026-10-03.md` §4.3。

   **为什么没被任何门禁拦住**：组件锁只断言「旧 testid 不出现」「新入口逻辑不变」，没有任何一条断言「用户在没有可见按钮时能否得到指路」；像素门禁因折叠组不可见而完全失明。⇒ **「可用性引导」目前不在任何机械判据的覆盖面上**，只能靠真机走查发现。这一条已列入 PRD §4.3.5 遗留第 3 条。
