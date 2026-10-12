# PRD / 缺陷规格：账号标签首屏登录态（xhs-tab-first-paint-login，2026-10-11）

- 缺陷编号：`xhs-tab-first-paint-login`
- 提出方式：用户真机报告（应用运行中，账号管理页）
- 日期：2026-10-11（根因取证 + 修复 + 回归）
- 分支：`xhs-tab-first-paint-login`（隔离 worktree `<worktree-root>/mp-xhs-tab-first-paint-login`，非 C 盘）
- 变更类型：**运行时代码变更**（Electron 主进程）→ 必须经 PR 落地
- 涉及文件：
  - `apps/desktop/electron/services/webview-manager/utils.js`（修复本体：CDP document-start 注入的两个前置动作 + 引导历史项摘除 + 引导文档判定）
  - `apps/desktop/electron/services/webview-manager/tab-lifecycle.js`（标签状态机接线：引导期屏蔽、历史项摘除、返回值形状）
  - `apps/desktop/electron/services/webview-manager/constants.js`（`PAGE_TARGET_BOOTSTRAP_URL` 单一真源）
  - 回归：`apps/desktop/electron/services/webview-manager-ls-document-start.test.js`（LS/CDP 注入契约，含 5 条新契约）、`apps/desktop/electron/services/webview-manager.test.js`（2 条既有契约按新时序改写 + 时序/状态其余用例）、`apps/desktop/electron/services/webview-manager-test-harness.js`（两者共用夹具）、`apps/desktop/electron/services/webview-manager/home-shell-title.test.js`（夹具形状对齐）

---

## 1. 一句话结论

账号标签打开时，**凭证 localStorage 的「document-start 早期注入」从来没有真正成功过**：
旧实现既不建立 CDP 的 Page 目标、也不 `Page.enable`，于是 `Page.addScriptToEvaluateOnNewDocument`
要么永久挂起、要么返回 identifier 却静默不执行。首屏因此拿不到凭证 → 平台 SPA 自判未登录弹登录页 →
旧代码的降级路径（`did-finish-load` 之后再注入并**整页重载**）把页面刷成已登录：

> 用户看到的「先登录页 → 刷新了一次 → 过了几秒又进创作者中心」，就是**这条降级路径**，不是登录态过期。

修复后的语义：**先给 CDP 建立一个真实文档（about:blank）作为 Page 目标，再 `Page.enable`，
才注册 document-start 脚本**；引导文档既不改写标签 URL/状态、也不参与凭证采集，其历史项在首个
真实导航提交后立即摘除（返回键不多一格空白页）。首个真实导航到达时凭证已在位 → **首屏即已登录**，
无登录页、无二次导航、无 2.5s 空标签等待。

### 1.1 用户可见行为（Before / After）

| 维度 | 修复前（main） | 修复后（本分支） |
| --- | --- | --- |
| 首屏内容 | 平台**登录页**（标题/二维码/登录框） | 创作者中心（已登录） |
| 导航次数 | **2 次真实导航**（第二次是整页重载） | **1 次** |
| 首屏前的空白等待 | 最长 2.5s（CDP 命令超时窗口，导航被门控） | 无（about:blank 引导 150–300ms，用户不可见） |
| 地址栏/历史 | 出现 `/login`，`canGoBack=true`（返回键可退到登录页） | 只有创作者中心一条，`canGoBack=false` |
| 用户心智 | 「登录态过期了，要重新登录」（**误判**） | 无歧义 |
| 侧效应 | 用户在登录页可能**真的去重新登录**，凭证被覆盖重写 | 无 |

### 1.2 一句话复现（真实 Electron 端到端 A/B 实测）

同一套「平台 SPA 自判登录态」夹具（document-start 读 localStorage，缺失则渲染登录页并 `location.replace('/login')`）：

| 指标 | 旧代码 | 新代码 |
| --- | --- | --- |
| `loadURL` 调用序列 | `[目标URL, 目标URL]` | `[about:blank, 目标URL]` |
| 服务端收到的页面请求 | `['/', '/login', '/']` | `['/']` |
| 帧内取证（document-start 是否已有凭证） | `hasToken=0` → `hasToken=0&login=1` → `hasToken=1` | `hasToken=1`（唯一一帧） |
| **渲染过登录页的帧数** | **2** | **0** |
| 最终标题 | 创作者中心 | 创作者中心 |
| `canGoBack` | `true`（历史里躺着 `/login`） | `false` |
| 导航广播次数 | 3 | 1 |

---

## 2. 用户报告与复现

### 2.1 用户原话（真机）

> 在启动的应用中，在账号管理页，点击小红书，打开的页面中，现在打开登录页，然后又刷新了一次，
> 我以为是登录态过期了，需要登录了。但过了几秒，页面又进入了创作者中心，还是登录后的状态。

三个关键事实与我们取证到的机制**逐条对应**：

1. 「打开登录页」= 首个真实文档没有凭证 → 平台 SPA 自判未登录（`hasToken=0` 帧）；
2. 「然后又刷新了一次」= 降级路径的**整页重载**（`loadURL(initialUrl)` 第二次）；
3. 「过了几秒，又进入创作者中心」= 2.5s CDP 超时窗口 + 重载后凭证到位。

### 2.2 稳定复现步骤（不依赖特定账号）

1. 任选一个**带 localStorage 会话凭证**的已登录账号（小红书 12 个 LS key、视频号亦有；本机实测账号 `xiaohongshu:a1eac276`）。
2. 账号管理页点击该账号卡片的「打开创作者中心」（路由 `openCreatorCenter` → `tabStore.createTab` → IPC `page-manager:create-new-tab-page`）。
3. 观察标签：先出现平台登录页 → 约 1–3 秒后整页刷新 → 进入创作者中心（已登录）。

### 2.3 真机日志（应用 `logs/app-2026-10-11.log`，本机实跑）

```
[2026-10-11T15:07:41.146Z] [INFO] WebviewManager Created new tab: btab-3
[2026-10-11T15:07:41.149Z] [NOTIFY] LoginNetDiag proxy-resolved {"tag":"[xiaohongshu/a1eac276] ","proxy":"DIRECT"}
[2026-10-11T15:07:41.153Z] [INFO] WebviewManager [xiaohongshu:a1eac276] credential restore (partition-first): injected=7 skipped-existing=13
[2026-10-11T15:07:43.653Z] [WARN] WebviewManager addScriptToEvaluateOnNewDocument timed out after 2500ms (hung CDP command), LS early injection fallback
```

读法：
- **Cookie 侧是好的**：分区已有 13 条、补注入 7 条，导航被门控在恢复之后 → 登录页不是 Cookie 造成的；
- **凭证 localStorage 侧是坏的**：`addScriptToEvaluateOnNewDocument` 在 2.5s 超时 → 早期注入失败 → 走降级路径。
- 同一会话内 **3/3 次**建标签（btab-1 15:05:51.647 / btab-2 15:06:25.856 / btab-3 15:07:43.653）都打出同一条超时日志
  ⇒ 不是偶发抖动，而是**必然路径**。

---

## 3. 影响面

| 维度 | 范围 |
| --- | --- |
| 入口 | 账号管理页「打开创作者中心」、账号页任何带 `accountId` + `url` 的 `createNewTabPage` 调用 |
| 平台 | **所有**「SPA 前端自判登录态 + 有 localStorage 凭证」的平台；小红书是本例，视频号/头条/快手/知乎等**有 LS 凭证的平台同样命中**（是否表现为登录页取决于该平台是否在首屏判 LS） |
| 用户可感症状 | ①误判「登录态过期」；②在登录页**真的去重新登录**，触发凭证覆盖重写（二次伤害）；③每次开卡多等 1–3 秒；④返回键多一格登录页 |
| 触发条件 | 账号快照含 `localStorage` 且非 `cleanSession`（普通账号标签）→ 命中即复现 |
| 不受影响 | 浏览标签（`persist:browse-*`，无凭证恢复）、`cleanSession:true` 的登录窗口（不注入 LS）、home-shell 标签、显式传 `opts.cookies` 的调用 |
| 数据面 | 不损坏分区 Cookie、不损坏加密凭证库；不写任何脏数据 ⇒ **无需数据迁移** |
| 持续性 | 早期注入路径最早可追到 `2026-09-24` 的「document-start 注入」引入（视频号修复），此后**从未真正生效过**（旧实现从不 `Page.enable`）；2026-10-09 PR #3239 修的是 Cookie 方向错误（快照盖回分区），与本缺陷正交，因此没有覆盖到它 |

---

## 4. 根因取证（真实 Electron 43.7.7 探针，非推理）

探针脚本落在仓库外的一次性目录（`<temp>/electron-cdp-probe/`），每个结论都可重跑（命令见 §15）。

### 4.1 探针一：全新 `WebContentsView` 上 Page 域命令永久挂起

| 场景 | `Page.enable` | `addScriptToEvaluateOnNewDocument` | 后续真实导航的 document-start 状态 |
| --- | --- | --- | --- |
| A：全新 view（从未导航）先 attach | **timeout 6003ms** | **timeout 6006ms** | `{win:false, ls:null}` → 无凭证 |
| B：先落地 `about:blank` 再 attach | ok **1ms** | ok **5ms** | `{win:true, ls:"yes"}` → 有凭证 |

**A 就是线上路径**：`tab-lifecycle` 建 view 后直接 attach + 发命令，中间没有任何文档 ⇒ 命令必定挂起 ⇒ 2.5s 超时 ⇒ 降级。

### 4.2 探针二：`Page.enable` 是「脚本真正执行」的必要条件（**第二个独立缺陷**）

| 场景 | `Page.enable` | addScript 返回值 | 下一帧 document-start 状态 |
| --- | --- | --- | --- |
| B2：about:blank 引导，不 enable | 未调用 | `{identifier:"1"}`（**ok 1ms**） | `{win:false, ls:null}` ← **静默 no-op** |
| B3：about:blank 引导，先 enable | ok | `{identifier:"1"}` | `{win:true, ls:"yes"}` |
| C2：真页面在前，先 enable | ok | ok | `{win:true, ls:"yes"}` |
| C3：真页面在前，不 enable | 未调用 | ok（1ms） | `{win:false, ls:null}` ← **静默 no-op** |

这一条比第一条更隐蔽：**命令返回成功、函数返回 true、调用方不再走补注入**，但脚本从未执行。
只要「Page 目标恰好已就绪」，旧实现就会把自己的失败**上报成成功**（假成功），
凭证在首个文档上永久缺失——比超时那条路径更难察觉。

### 4.3 探针三：最小可靠动作 = 「先发 about:blank，再 attach/enable」（不必等事件）

| 场景 | 结果 |
| --- | --- |
| D2：`loadURL('about:blank')`（不等待）→ attach → `Page.enable` | 3/3 成功，enable 耗时 **307 / 150 / 169 ms**，注入生效 |
| D1：先试一次 enable（挂起）→ 发 about:blank → 再试一次 | 2/2 成功，第二次 **156 / 149 ms**，注入生效 |
| G：attach → 发 about:blank → enable | 3/3 成功，注入生效 |
| E3：用 `executeJavaScript('1+1')` 代替导航来「预热」渲染进程 | **timeout 3006ms**，`getURL()` 仍为空，注入依旧失败 ⇒ 该替代方案不成立 |

⇒ 就绪信号刻意选「CDP 命令自己能返回」，而不是「等某个文档事件」：少一个可挂起的等待点。

### 4.4 探针四：引导文档的历史项必须显式摘除

| 场景 | 结果 |
| --- | --- |
| E1：引导 about:blank → 真实导航 | `canGoBack=true`，`histLen=2`，`urls=[about:blank, 目标URL]` |
| E2：真实导航发出后立刻 `navigationHistory.clear()` | **无效**：`canGoBack=true`、`histLen=2`（提交前清理不生效） |
| F：在真实导航 `did-navigate`（提交）时 `removeEntryAtIndex(0)` | **true** → `canGoBack=false`、`histLen=1`、只剩目标 URL |
| F：同样时机 `clear()` | 同样收敛为 1 条 |

⇒ 清理时机必须是**首个真实导航提交后**（`did-navigate`），不能在导航前。

### 4.5 端到端 A/B（模块级真机复现，判据见 §1.2）

- 夹具直接 `require` 两边的 `tab-lifecycle.js`：旧侧取共享根 `apps/desktop/electron/services/webview-manager/`（main，与 `origin/main` 该文件**逐字节相同**，已用 `git diff --quiet` 取证），新侧取本 worktree 同名文件 ⇒ 差异**只来自本 PR**。
- 旧侧 3 帧服务端取证 = 登录页渲染 2 帧、`/login` 被真实请求、最终靠重载恢复；新侧 1 帧 = 首屏即已登录。
- 该 A/B 是本缺陷的**验收判据**（§11 AC-1/AC-2），可重复执行。

### 4.6 单元层变异反证（每条锁改成 no-op 必须变红）

| 变异 | 内容 | 期望 | 实测 |
| --- | --- | --- | --- |
| M1 | 去掉 `Page.enable`（退回旧形态） | 时序契约红 | ✅ 1 failed |
| M2 | 不引导 `about:blank` | `about:blank` 时序契约红 | ✅ 1 failed |
| M3 | 引导文档照常改写标签 URL/广播 | 状态屏蔽契约红 | ✅ 1 failed |
| M4 | 不摘除引导历史项 | 历史项契约红 | ✅ 1 failed |
| M5 | 去掉「引导期标记」外层护栏（每次 did-navigate 都试摘） | 带跳契约红 | ⚪ 仍绿 —— `_removeBootstrapBlankHistoryEntry` 内部的 url 守卫已覆盖，M5 属**防御性冗余**（如实记录，不冒充独立锁） |
| M6 | 去掉注入脚本的逐 key `try/catch` | 注入守卫契约红（QM-6 i2） | ✅ 1 failed |
| M7 | 去掉历史项摘除的 `url === about:blank` 守卫 | 摘除守卫契约红（QM-6 i1） | ✅ 1 failed |

M1–M4、M6、M7 各自只让**对应用例**变红，其余用例保持绿（夹具未被"顺手放宽"）；M5 的行为等价性正是「两层护栏」的设计意图。

---

## 5. 修复设计

### 5.1 修复本体（`utils.js`）

```
_injectLocalStorageAtDocumentStart(view, script)
  1) dbg.attach()                      ← 失败即返回 { injected:false, blankBootstrapped:false }（fail-open，调用方走补注入）
  2) 若 webContents.getURL() 为空：
        _primePageTargetWithBlankDocument(view)   ← 发 about:blank，不等待事件，返回是否发出
  3) Page.enable                                ← 必须先行（探针二）
  4) Page.addScriptToEvaluateOnNewDocument      ← 注册到「下一个新建文档」
  5) 整条链套 LS_INJECTION_TIMEOUT_MS(2500ms) 硬超时，永不 reject
  6) 成功：登记 once('did-navigate') → detach（注入须存活到首个真实导航提交）
     返回 { injected:true, blankBootstrapped }
```

### 5.2 标签状态机接线（`tab-lifecycle.js`）

| 时机 | 行为 | 理由 |
| --- | --- | --- |
| 建 view 后、建 state 前 | 计算 `credLocalStorage` / `lsRestoreNeeded` / `lsCdpUsable`，写入 `state.blankBootstrapPending`（上界估计） | 引导文档的 `did-navigate` 可能在 CDP 结果回来之前到达，记号必须**先于任何导航事件**就位 |
| `did-navigate` 且 `url === 'about:blank'` 且处于引导期 | **直接 return**：不改 `state.url`、不广播 `navigation-changed` | 引导文档不是用户可见导航，不得污染标签 URL/历史态（M3 锁） |
| `did-navigate` 且首个真实 URL | 清 `blankBootstrapPending` → `_removeBootstrapBlankHistoryEntry(view)` → 再读 `canGoBack/canGoForward` → 广播 | 保证广播出去的 `canGoBack` 已是修正值（次数从 3 降到 1） |
| `did-finish-load` 且仍是引导文档 | **直接 return**：不结束 `initialRedirectPhase`、不触发自动保存 | 引导文档不是「首个真实文档已就绪」 |
| CDP 结果 `blankBootstrapped !== true` | 收敛估计：清 `blankBootstrapPending` | 复用已有文档时不产生引导项 |
| CDP 结果 `injected !== true` | `registerLsFallback()`（既有降级路径，行为不变） | fail-open：绝不能因为 CDP 失败导致页面无凭证 |

### 5.3 备选方案与取舍（为什么选它）

| 方案 | 结论 | 理由 |
| --- | --- | --- |
| ① 用 preload（隔离世界）写 localStorage | 弃 | `preload` 会在子框架执行，跨域 iframe 会写到**别人的 origin**；且需要新 IPC 通道把凭证送进 preload，面更大 |
| ② `executeJavaScript` 预热渲染进程 | 弃（已实测） | 探针 E3：全新 view 上 `executeJavaScript` 自身就超时，`getURL()` 仍为空，注入依旧失败 |
| ③ 只加 `Page.enable`、不做引导 | 弃 | 探针一 A：没有文档时 enable 同样挂起 → 仍然必然超时 |
| ④ 只做引导、不加 `Page.enable` | 弃 | 探针二 B2：`{identifier}` 假成功、脚本永不执行 → 比超时更隐蔽 |
| ⑤ 提高 2.5s 超时上限 | 弃 | 挂起是**无界**的（2026-09-24 头条事故：命令在标签整个存活期从未返回），加长时间只是让空标签更久；且该上限是「导航不得被 CDP 无限期阻塞」的护栏 |
| ⑥ 引导 + enable + 历史摘除（**本方案**） | ✅ 采用 | 真机 3/3 复现的两个失败条件同时消除；副作用（历史项）显式闭合；失败仍走既有 fail-open 路径 |
| ⑦ 降级时把视图隐藏到重载完成 | 弃 | 需与标签可见性模型（挂起/切换/多标签）交叉，风险大于收益；降级路径现在是罕见路径，见 §13 |

### 5.4 不变量（改动不得破坏）

1. 首个**真实**导航必须排在 document-start 注入注册**之后**；
2. 首个真实导航不得因为 CDP 挂起而永不发生（超时后 fail-open 放行）；
3. 标签销毁后的迟到回调不得抛未处理拒绝（既有回归对，保持通过）；
4. 注入成功时**不得**再走补注入/二次真实导航（否则登录页闪烁回归）；
5. 引导文档不得出现在标签 URL、导航广播、历史项、凭证采集里。

---

## 6. 功能逻辑（分支与状态）

### 6.1 打开账号标签的时序（修复后）

```
用户点击开卡
  └─ openCreatorCenter → tabStore.createTab({url, platform, accountId, cleanSession})
       └─ IPC page-manager:create-new-tab-page → createNewTabPage(opts)
            ├─ 分区选择：persist:account-<id>（SAFE_IDENTIFIER 校验通过时）
            ├─ 挂 LoginNetDiag（loadURL 之前，含 platform/accountId）
            ├─ 读加密凭证快照（accountManager.loadSavedCredentials）
            ├─ 建 WebContentsView（sandbox:true, contextIsolation:true, backgroundThrottling:false）
            ├─ 建 state（含 blankBootstrapPending 上界估计）+ 挂导航监听
            ├─ Cookie 恢复链（分区优先、快照仅补缺）──┐
            ├─ LS 早期注入链：                      ├─→ Promise.all 门控首个真实导航
            │     attach → about:blank → Page.enable → addScript
            └─ 门控解除 → loadURL(真实 URL)
                 ├─ 真实文档 document-start：凭证 localStorage 已在位 → 首屏即登录态
                 ├─ did-navigate(真实 URL)：摘除 about:blank 历史项 → 广播 URL/canGoBack
                 └─ did-finish-load：结束 initialRedirectPhase（cleanSession 标签才有意义）
```

### 6.2 分支行为表

| 分支 | 触发条件 | 行为 | 用户可见 |
| --- | --- | --- | --- |
| 正常（CDP 可用 + 有文档引导） | 默认路径 | about:blank → enable → addScript → 单次真实导航 | 首屏已登录 |
| 已有文档的 view | `getURL()` 非空 | 不引导，直接 enable + addScript | 无额外导航 |
| debugger 不可用 | `webContents.debugger` 缺失/无 attach | 跳过 CDP，直接 `registerLsFallback` | 与旧行为一致（可能有一次重载） |
| attach 抛错 | debugger 被占用 | 跳过 CDP，直接补注入 | 同上（fail-open） |
| CDP 命令超时（2.5s） | 极端负载/未知挂起 | 放行真实导航 + 补注入路径 | 可能存在一次重载（残余降级，见 §13） |
| `cleanSession:true` | 失效账号重登 | **不**注入 LS、不引导；先清分区同域 Cookie | 登录页（语义正确，行为未改） |
| 浏览标签 / home-shell | 无 `accountId` | 完全不进 LS 链路 | 行为未改 |
| 快照无 LS 凭证 | `localStorage` 空 | 不引导、不注入 | 行为未改 |
| 标签在引导期被关闭 | 用户立刻关标签 | 迟到回调按 `webContents` 已销毁静默跳过 | 无未处理拒绝 |

### 6.3 状态字段语义（新增）

| 字段 | 类型 | 含义 | 清除时机 |
| --- | --- | --- | --- |
| `blankBootstrapPending` | boolean | 「可能已为 CDP 插入引导 about:blank」的上界估计；同时作为「引导期」屏蔽开关 | ① CDP 回报未引导时立即清；② 首个真实 `did-navigate` 提交时清（并摘历史项） |

---

## 7. 数据校验

### 7.1 localStorage 凭证（注入侧）

| 校验项 | 规则 | 失败行为 |
| --- | --- | --- |
| 来源形状 | `accountCredential.localStorage` 必须是对象且**至少 1 个 key**；`cleanSession` 时整体不注入 | 不进 LS 链路（无引导、无注入） |
| 值类型 | 每个值原样交给 `localStorage.setItem`；页面侧脚本对每个 key 单独 `try/catch` | 单个 key 失败不影响其它 key |
| 配额/隐私模式 | `setItem` 可能抛（QuotaExceeded/SecurityError） | 该 key 跳过，不阻断导航（脚本级 catch） |
| 注入时机 | 仅在 `Page.addScriptToEvaluateOnNewDocument` 注册**之后**新建的文档 | 引导文档自身不写 storage（不污染 origin） |
| 失败可观测 | 早期注入成功/失败都必须有日志（§10） | 失败进降级路径，绝不静默 |

### 7.2 引导文档（about:blank）的边界

| 校验项 | 结论 |
| --- | --- |
| origin 影响 | `about:blank` 是 opaque origin，**不写** localStorage/Cookie/IndexedDB。两层保证（QM-6 评审 i2 追问的「时序依赖」在此闭合）：①`addScriptToEvaluateOnNewDocument` 只对**调用之后新建**的文档生效，而引导导航在 `Page.enable` 之前就已发出（探针实测 blank 提交 ~10ms 级、`Page.enable` 150–300ms），因此正常情况下引导文档不会被注入；②即便时序反转、脚本仍对某个 opaque/未知 origin 的文档执行，注入体内的 `localStorage.setItem` 也**逐个 key 关在 `try/catch` 内**（`SecurityError`/`TypeError` 一律吞掉），脚本不可能外溢或阻断页面——该守卫有独立回归锁（`webview-manager.test.js`「注入脚本把每个 setItem 关在 try/catch 内」） |
| 网络副作用 | 零网络请求（本地内建文档），不影响 Cookie 分区与平台侧风控计数 |
| 历史副作用 | 会插入 1 条历史项 → 必须由 `_removeBootstrapBlankHistoryEntry` 摘除（§4.4） |
| 触发条件 | 仅当 `getURL()` 为空（全新 view）时才发；已有文档复用路径不发 |
| 超时 | 不等待其完成事件；命令超时护栏兜底（2500ms） |
| 开销（QM-6 评审 i3） | 每条「有 LS 凭证」的账号标签首开新增一次本地 `about:blank` 导航；新增等待量级 = `Page.enable` 的 150–300ms（探针 D2/G 实测），**小于修复前必然发生的 2500ms CDP 超时门控**，且换掉了「登录页 + 整页重载」，净效果是更快。不做「按分区缓存就绪状态/开关」：缓存会把一次瞬时窗口变成跨标签的共享状态，收益（省一次本地空白文档）小于风险（状态漂移导致凭证又缺席） |

### 7.3 历史项摘除的判据（防误删真实条目）

```
getEntryAtIndex(0).url === 'about:blank'  且  getActiveIndex() !== 0  才移除
```

- 只认**第 0 条且是 about:blank**：若引导导航被真实导航抢占而未落盘，第 0 条就是真实 URL ⇒ 不动；
- 不允许移除 active entry（Electron `NavigationHistory.removeEntryAtIndex` 的硬约束，探针 F 已验证提交后 activeIndex=1）；
- 任何异常（API 缺失/越界）都 `try/catch` 成 warn：**清理失败只影响返回键，绝不影响登录态与导航**。

---

## 8. 交互逻辑

| 交互点 | 修复前 | 修复后 |
| --- | --- | --- |
| 点击开卡到首屏 | 空标签最长 2.5s → 登录页 → 重载 → 创作者中心 | 引导文档不可见 → 直接创作者中心 |
| 标签标题 | 由 `titleLocked`（`accountsPage.creatorTabTitle`）锁定，全程不变 | 不变（引导文档的 `page-title-updated` 也被锁标题覆盖，用户无感） |
| 加载指示 | start/stop/start/stop（两次真实导航） | start/stop（一次真实导航；引导文档自身的一次极短闪烁，见 §13 残留项） |
| 地址栏/导航态 | 短暂显示 `/login`，`canGoBack=true` | 始终是创作者中心，`canGoBack=false` |
| 返回键 | 可退到登录页（用户困惑：「退回去还是登录页？」） | 无可退（历史只有一条） |
| 切换标签 | 无变化 | 无变化 |
| 标签在引导期关闭 | 无未处理拒绝（既有回归对） | 保持（§5.3 不变量 3） |
| 应用级浮层挂起 | 无变化 | 无变化（引导不改变可见性模型） |
| 多标签并发开卡 | 每个 view 各自 attach/注入（互不共享 debugger） | 同（引导仅在各自 webContents 内） |

---

## 9. 显示项与提示文字

本修复**不改任何用户可见文案**，也不新增显示面；下列显示项必须**逐项保持不变**（回归断言覆盖）：

| 显示项 | 文案/来源 | 契约 |
| --- | --- | --- |
| 标签标题 | `accountsPage.creatorTabTitle`（zh/en 成对，`{platform}` 插值）+ `titleLocked` | 开卡即锁定，不随引导文档/平台标题改写 |
| 加载态 | TabBar 转圈（`tab-loading` / `tab-finished-loading`） | 由 `did-start-loading`/`did-stop-loading` 配对收口，不得因引导文档长期转圈 |
| 导航态 | `navigation-changed`（url/title/canGoBack/canGoForward/loading/homeShell/spaRoute） | 引导文档不得产出该广播；真实导航广播恰好 1 次（URL 为真实 URL、canGoBack 已修正） |
| 账号卡片 | 状态徽标（已登录/失效）等 | 不受影响（不改账号状态机） |
| 失败提示 | 无新增 | 本期**不新增**任何 Toast/横幅/占位文案（无「正在恢复登录态…」占位，理由见 §5.3 方案⑦ 与 §13） |

> 说明：用户之所以误判「登录态过期」，根因是**页面内容**而非缺少提示文字；消除登录页帧后无需文案补偿。
> 若后续想加「正在恢复登录态…」占位，应作为独立需求评估（它会引入新的可见状态与 i18n 键）。

---

## 10. 可观测性（排障口径）

| 日志（模块 = `WebviewManager`） | 级别 | 含义 |
| --- | --- | --- |
| `blank bootstrap document requested for CDP Page target` | INFO | 已为 CDP 建 Page 目标发出 about:blank（正常路径会有 1 条） |
| `removed bootstrap about:blank history entry after first real navigation` | INFO | 引导历史项已摘除（正常路径 1 条） |
| `document-start LS injection timed out after 2500ms (hung CDP command), LS early injection fallback` | WARN | **走了降级路径**：首屏可能无凭证、之后重载（用户会看到登录页闪烁） |
| `document-start LS injection failed, LS early injection fallback: <err>` | WARN | 命令报错（同上降级） |
| `debugger attach failed, LS early injection fallback: <err>` | WARN | debugger 不可用（同上降级） |
| `blank bootstrap navigation failed/threw: <err>` | WARN | 引导导航本身失败（后续命令多半也会超时 → 降级） |
| `[<platform>:<accountId>] credential restore (partition-first): injected=N skipped-existing=M` | INFO | Cookie 侧恢复明细（与 LS 侧正交，用于排除 Cookie 归因） |

排障判据（一句话）：**只要没有 WARN 行、且有 `blank bootstrap` + `removed bootstrap ... history entry` 各一行，就说明首屏是已登录态且返回键干净。**

---

## 11. 验收标准

| 编号 | 判据（可验证） |
| --- | --- |
| AC-1 | 真实 Electron A/B：新侧 `渲染过登录页的帧数 = 0`、`真实导航次数 = 1`、服务端只收到 1 次页面请求；旧侧分别 ≥1 / 2 / ≥3（§1.2 实测表） |
| AC-2 | 新侧最终标题为「创作者中心」等价的已登录页，`canGoBack=false`，`historyEntries` 只含真实 URL。**适用范围**：平台首屏**单次**真实导航（若首屏自带一次跳转，`canGoBack=true` 为正确结果，见 §13 第 5 条） |
| AC-3 | `webview-manager-ls-document-start.test.js` 时序契约：`loadURL:about:blank` → `cdp:Page.enable` → `cdp:addScript` → `loadURL:真实URL` 严格递增，且真实 `loadURL` 调用序列恰为 `[about:blank, 真实URL]` |
| AC-4 | 引导文档的 `did-navigate(about:blank)` 不改写 `state.url`、不产出 `navigation-changed` 广播 |
| AC-5 | 首个真实导航提交后调用 `navigationHistory.removeEntryAtIndex(0)` **恰好一次**，且 `state.canGoBack === false`（单次真实导航前提下）；带跳场景下只摘引导项、真实返回历史如实保留（§13 第 5 条两条契约） |
| AC-6 | 已有文档的 view 不产生 about:blank 引导 |
| AC-7 | CDP 永久挂起时首个真实导航照常发生（既有 2026-09-24 回归对保持绿），且降级路径仍如实回报引导状态并摘历史项 |
| AC-8 | 变异反证逐条让对应用例变红：M1–M4（四条主锁）+ **M6**（去掉注入脚本 try/catch → i2 锁红）+ **M7**（去掉历史项 url 守卫 → i1 守卫锁红）；M5（去掉引导期标记的外层护栏）实测**行为等价**（url 守卫已覆盖），记录为防御性冗余而非独立锁（§4.6） |
| AC-9 | 相关域既有用例零改动全绿（`webview-manager.test.js` 80 + `webview-manager-ls-document-start.test.js` 11 + `home-shell-title.test.js` 12 = **103**；LS/CDP 契约已按债务熔断要求拆分为独立文件，夹具共用 `webview-manager-test-harness.js`） |
| AC-10 | 无新增用户可见文案、无 locale 变更；`check-no-brand-residue` / `check-debt-budget` / 行尾对账通过 |

---

## 12. 测试矩阵

| 层级 | 文件 | 覆盖 |
| --- | --- | --- |
| 单元（时序契约） | `webview-manager-ls-document-start.test.js`「先 about:blank 建立 Page 目标 → Page.enable → 注入 → 首个真实导航」 | AC-3、AC-9 |
| 单元（状态屏蔽） | 同文件「引导 about:blank 不污染标签状态」 | AC-4 |
| 单元（历史项） | 同文件「引导空白文档的历史项在首个真实导航提交后被移除」 | AC-5 |
| 单元（带跳场景，QM-6 i1） | 同文件「平台真实首屏自带跳转（两次真实 did-navigate）时：只摘引导项一次，真实返回历史如实保留」 | AC-5、§13 第 5 条 |
| 单元（守卫本体，QM-6 i1） | 同文件「引导项摘除只认 index0 的 about:blank；index0 是真实条目或本身是 active entry 时一律不动」 | AC-5 |
| 单元（注入守卫，QM-6 i2） | 同文件「注入脚本把每个 setItem 关在 try/catch 内」 | §7.2 第 ①/② 层 |
| 单元（复用路径） | 同文件「已有文档的 view 不做 about:blank 引导」 | AC-6 |
| 单元（fail-open） | 同文件「CDP 命令永久挂起时超时降级」+「标签关闭后 CDP 命令才失败」 | AC-7 |
| 变异反证 | 脚本化 no-op 变异 7 条：M1–M4 主锁、M5 行为等价对照、M6 注入守卫、M7 摘除守卫 | AC-8 |
| 真实 Electron A/B | 模块级夹具 + 本地 SPA 仿真（旧侧 main / 新侧本分支），新侧空闲机 5/5 收敛 | AC-1、AC-2 |
| 真机（人工） | 按 §2.2 步骤复跑一次，核对 §10 日志口径 | 端到端确认 |

---

## 13. 风险、残余项与不做的事（不假装已闭合）

1. **降级路径仍在**：CDP 超时（2500ms）时仍会走「补注入 + 整页重载」，用户仍可能看到一次登录页闪烁。
   实测：在一次**全量测试套件并发占满 CPU** 的 E2E 运行中观察到了该回退（`loadURLCalls=[about:blank, 真实URL, 真实URL]`、登录页帧 2）。
   常态化运行下（同夹具多次单独运行）为 0 次回退。**未**把超时上限上调（理由见 §5.3 方案⑤）；
   「降级期间隐藏视图到重载完成」已开**独立跟踪任务**（issue #3363，QM-6 评审 i5 要求把该项从"文案"落成可跟踪项），
   落地前该残余项保持可见，真机再次复现即按该任务评估。
2. **注入脚本的生效窗口边界（QM-6 评审 i6，已用探针取证）**：脚本注册随 `debugger` 会话存活，实现里在
   **首个真实 `did-navigate` 时 `detach()`**。探针 7 实测：detach 后再导航，新文档**不带注入**
   （`{win:false, ls:null}`）；保持 attach 时连续两次导航都带注入（`{win:true, ls:"yes"}`）。
   因此曝光窗口 = 从注册到首个真实文档提交；窗口内若平台发生**客户端跳转到另一 origin**（提交后脚本才开始跑，
   而 detach 已在提交时触发，故实际极难命中），该 origin 会被写入凭证——残余风险如实记录，
   不做 origin 白名单（跨子域补跳是既有正当路径，加白名单会把合法恢复挡掉，且判据会与 platform-definitions 分叉）。
   跟踪项见独立任务 issue #3363（与第 1 条同一任务清单）。
3. **引导文档会引起一次极短的 loading 闪烁**：about:blank 的 `did-start-loading`/`did-stop-loading` 仍会广播
   （约数毫秒，且在真实导航开始之前）。不屏蔽的原因：在真实导航 start 时 `getURL()` 仍可能是 about:blank，
   按 URL 判定会**误吞真实导航的加载事件**（宁可留一个无害的毫秒级闪烁）。
4. **同族风险（未在本 PR 修）**：`auth-view-cdp.js` 的 `attachCdpDetection` 在 `loadURL` 之后立即 `Fetch.enable`，
   同样存在「Page 目标未就绪 → 命令挂起且被 `.catch` 吞掉」的形态（该路径为 fire-and-forget，不阻断导航，症状是
   CDP 登录检测静默失效）。属独立的登录检测面，**另开任务**评估，不在本次修复范围内。
5. **带跳场景的验收口径**（QM-6 评审 i1，auth 域）：AC-2/AC-5 的 `canGoBack=false` **只对「单次真实导航」成立**。
   平台首屏若自带一次跳转（302 或客户端跳转），第二次真实提交会新增一条真实历史项 ⇒ `canGoBack=true` 是**正确**结果；
   引导逻辑的职责只是「每次开卡最多摘掉那一条 `about:blank`」，不得触碰真实条目——新增契约
   「引导项摘除只认 index0 的 about:blank；index0 是真实条目或本身是 active entry 时一律不动」+「两次真实 did-navigate
   时只摘一次、真实返回历史如实保留」，并各有一条变异反证（M7 去掉 url 守卫 → 对应用例变红）。
6. **不做的事**：不新增用户文案/占位态；不改 `LS_INJECTION_TIMEOUT_MS`；不改 Cookie 恢复语义（分区优先）；
   不重构 debugger 生命周期；不引入 preload 注入新通道；不为 i3 引入「分区级就绪缓存/开关」（理由见 §7.2 末行）。

---

## 14. 回滚方案

- 代码回滚：`git revert <squash-merge-sha>`（改动面仅 3 个文件 + 2 个测试文件，无数据迁移、无接口/存储变更）。
- 回滚后行为：回到「登录页 → 重载 → 已登录」（用户报告的原状），不影响账号可用性。
- 无需数据修复：不写任何持久化状态。

---

## 15. 复现与验收命令（可重跑）

```bash
# 单元 + 变异反证（worktree 内）
cd apps/desktop
pnpm exec vitest run electron/services/webview-manager.test.js electron/services/webview-manager-ls-document-start.test.js electron/services/webview-manager/home-shell-title.test.js

# 真实 Electron A/B（一次性夹具，仓库外）
#   夹具：本地 HTTP 服务模拟「SPA 在 document-start 判 localStorage」；旧侧 = main 的 webview-manager 目录，
#   新侧 = 本分支同名目录；判据见 §1.2。
#   <electron> = <worktree>/node_modules/electron/dist/electron.exe
#   <electron> --user-data-dir=<temp>/ud-new --no-sandbox --disable-gpu <temp>/e2e.js new
#   <electron> --user-data-dir=<temp>/ud-old --no-sandbox --disable-gpu <temp>/e2e.js old
```

---

## 附录 A：与既有文档的关系

- `01-docs/BUGFIX-ACCOUNT-TAB-COOKIE-RESTORE-2026-10-09.md`（PR #3239）：修的是 **Cookie 方向**——快照不得覆盖分区实时值。
  该文档 §10「已知边界与遗留」第 3 条把 `credLocalStorage` 的恢复记为「已有 `LS_INJECTION_TIMEOUT_MS` 护栏且症状未观察到，
  留作后续评估」；**本 PRD 正是这条遗留项的续报**：真机取证证明护栏**一直在生效**——即 document-start 注入
  **从未真正成功**（既不建立 CDP Page 目标、也不 `Page.enable`），每次开卡必然走「2.5s 超时 + 补注入整页重载」。
  ⇒ 同症不同因的正交链路，由 §5 修掉；**LS 侧「快照 vs 分区」的方向问题仍按原计划单独评估，本次未动**。
  （该历史文档刻意**不再被本次改动触碰**——它记录了当时的事实、含已清理的绝对路径；本续报只落在这里。）
  两者共同构成「开卡首屏即登录态」的完整闭合；§4.2 的两个前置动作即为该闭合的最后一环。
- `01-docs/PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE-2026-09-23.md`：登录态持久化总纲（分区/快照/采集时机），
  本修复不改其契约，只补齐「快照 LS 进首屏」的执行路径。
