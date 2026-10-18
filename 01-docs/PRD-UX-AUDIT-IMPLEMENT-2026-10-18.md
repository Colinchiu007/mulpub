# PRD：前端 UI/UE 审计落地（UX-AUDIT 实施）

- **文档编号**：PRD-UX-AUDIT-IMPLEMENT-2026-10-18
- **上游依据**：`01-docs/UX-AUDIT-2026-10-17.md`（71 条 finding、7 个机会点、6 个阶段，含 §7/§8/§9 三轮外部评审收敛记录，主干 `c57616b61`）
- **实施分支 / worktree**：分支 `ux-audit-impl`，worktree 位于仓库父目录同级的 `mp-worktrees/mp-ux-audit-impl`（非系统盘）
- **本文档状态**：阶段 0 全部 + 阶段 1 批次 A 已实现并附回归锁；阶段 1 批次 B（1.1/1.2/1.3/1.4/1.10）、阶段 2–5 在 §9 排期里逐项待办
- **规格真源**：`openspec/changes/ux-audit-implement/specs/desktop-ui-experience/spec.md`（本文档回答"长什么样、怎么交互、怎么校验"，spec 回答"必须成立什么"）

---

## 1. 目标与非目标

### 1.1 目标

给这个桌面应用的前端补上三层缺失：**安全网**（不可逆操作要先确认）、**接线**（已实现但没人渲染的能力真正到达用户）、**观测**（用户能从界面判断系统到底在不在动）。

### 1.2 非目标（明确不做，防无边界大活）

| 不做 | 原因 |
|---|---|
| 重构 `CreateView.vue`（5034 行） | 属 `check-max-lines` 的 95 项挂账，只能在其自身任务里逐块外拆 |
| 品牌名统一（阶段 3.3） | 产品决策，**不可由 agent 自行改**；见 §10 待人工裁决项 |
| IA 页面归并（audit-18） | 依赖阶段 5.6 的行为埋点数据；"数据就绪"判据未定义前不启动 |
| 快捷键自定义 | 主进程不提供写路径；设置页只做只读展示，不假装可改 |
| 给 Publish 页挂"未保存离开"拦截 | 该页被 `<keep-alive :include="['Publish']">` 保活，路由切换不丢数据；拦截一个不会发生的丢失只会制造打扰（审计 §7 已据此把 audit-3 降级并收敛范围） |

---

## 2. 角色与影响面

单用户桌面应用，无协作角色。本 PRD 影响的是**所有会改用户数据或改变用户可见状态的界面路径**：发布页草稿箱、账号页、设置页（通用/快捷键）、会员中心（账号安全）、侧边栏与全局快捷键、离线提示、发布进度面板、路由兜底。

---

## 3. 功能逻辑与流程（已实现部分）

### 3.1 破坏性操作确认链

**唯一实现**：`apps/desktop/src/utils/confirm-danger.js` 的 `confirmDanger({ title, message })` → `ElMessageBox.confirm`，返回 `Promise<boolean>`。

统一口径：

1. `message` **必填**且必须说明后果（影响对象 + 是否可恢复）。缺席或类型错误直接 `throw`，不降级为无文案弹窗。
2. 返回值语义：`true` = 用户明确确认；`false` = 取消 / ESC / 点遮罩 / 关闭。**"没确认"一律不执行**（fail-closed）。
3. 文案一律来自 locales（zh/en 成对），禁止在视图里拼中文字面量。

已接入的入口（本批）：

| 入口 | 位置 | 触发后果（文案必须说清的事） |
|---|---|---|
| 删除发布草稿 | `composables/usePublishDrafts.js` `removeDraft` | 点名被删草稿标题；不入回收站、不可恢复 |
| 清理缓存 | `components/CacheCleanupSection.vue` `clearCache` | 文件数 + 释放体积；中间产物需重新生成 |
| 清理日志 | `components/LogsSettings.vue` `clearLogs` | 清空本机全部应用日志；不影响账号/草稿/发布记录 |
| 退出登录（头像菜单） | `components/ProfileMenu.vue` `handleSignOut` | 会员权益、配额、云端同步中断，需重新输凭据 |
| 退出登录（会员中心） | `views/member-center/AccountSecurity.vue` `handleSignOut` | 同上 |
| 撤销其他设备会话 | `views/member-center/AccountSecurity.vue` `handleRevoke` | 其他设备需重新登录；不可撤销、无法远程找回 |
| 删除自动化任务 | `views/AutomationView.vue` `remove` | 点名任务名；任务配置与触发条件一并移除 |

> 最后两条（清理日志、删除自动化任务）是**门禁首遍实测新增**的 finding，不在审计稿的"6 类"清单里。

### 3.2 确认接线门禁（`scripts/check-danger-confirm.js`）

把"原语自称契约而实测只有 4 个消费点"变成机械可检：

- **名单来源**：破坏性 API 名由 `apps/desktop/src/api/**` 的导出**动态派生**（动词后缀 `Delete|Clear|Remove|Revoke|Erase|Destroy|Purge`）。不维护手抄第二份——手抄名单会让"新增一个 `deleteXxx`"落进盲区。
- **判定单位 = 函数作用域**，不是文件。字符级掩码（字符串/模板串/注释/**正则字面量**）+ 括号配对切出每个函数体；确认动作必须出现在调用点所在的最内层函数里。确认写在别的函数 ⇒ 仍判红。
- **同名定义点不算调用点**：`stores/accounts.js` 里有个局部函数就叫 `batchDelete`，与 API 同名。
- **两档**：A = 该文件看不到任何确认动作；B = 有确认但不是统一原语（`notifyConfirm` / 应用内 `ConfirmDialog` / `UiModal` 删除对话框）。
- **豁免** = `scripts/danger-confirm-debt.json`，键 `文件#函数`，必须带 `reason`；A 档还必须带 `confirmed_by`（确认发生在哪个文件哪一行，或"该操作可重做、按评审 w14 不锁"）。清单只能缩小；调用点消失而登记项还在 ⇒ 陈旧红。
- **取证入口** = `scripts/danger-confirm-evidence.js`：逐点打印函数体与该文件确认痕迹，让下一会话写 `confirmed_by` 时有现场而不是凭函数名猜。
- 退出码三档：`0` 合规 / `1` 未登记或陈旧 / `2` 判据自身故障（扫描根缺失、JSON 不合法、括号不闭合、未知旗标）。

**当前读数（2026-10-18 本机）**：files=366、apis=17、call_sites=21、A=12、B=2、未登记=0、陈旧=0。

### 3.3 未保存离开守卫（`composables/useUnsavedLeaveGuard.js`）

两条出口都要守，因为丢数据有两条路：

1. **路由切换** → `onBeforeRouteLeave`：`isDirty()` 为真时弹 `confirmDanger`；用户拒绝 = 留在原页（返回 `false`）。
2. **关闭/刷新应用** → `window` 的 `beforeunload`：为真时 `preventDefault()` 并置 `returnValue`。Chromium 在这一层不允自定义文案，只能给"有未保存内容"的粗粒度原生信号——**这是宿主限制，不是实现偷懒**。

调用方契约：

- `isDirty` **必须是函数**且给出内容级判据；传恒真会把每次导航变成打扰，传恒假等于没挂。非函数直接 `throw`。
- `subject()` 可选，用于把"未保存的是什么"写进文案（截断到 24 字，只取用户自己的文本，不取 query）。
- 覆盖面由 `src/unsaved-leave-contract.test.js` 逐视图枚举并锁定（见 §7.4），不靠人记。

**本批接入**：`RewriteView`（脏判据 = 原文或改写结果非空 **且** `savedDraftId` 仍为空；保存草稿后视为已落真源，内容再次变化时既有 `invalidateSavedDraft` 会把守卫恢复）。

### 3.4 导航的单一实现（`composables/useHomeShellNavigation.js`）

鼠标点侧边栏与键盘按全局快捷键必须是同一段逻辑，否则会出现"点会跳、按没反应"。三段式顺序不可换：

1. 当前聚焦**内嵌主页实例**（home-shell）→ 经 IPC `pageManager.navigateActiveHomeShell` 定向让该实例自己 `router.push`，主窗口隐藏路由不动；返回 `data.handled === true` 即结束。
2. 当前聚焦**普通网页标签** → 先 `switchToTab(首页标签)`，否则路由变化发生在看不见的地方。
3. 主窗口 `router.push`。

①②任一失败只 `console.warn` 留痕并继续，不升级成整次导航失败（"点侧边栏彻底没反应"比"少了定向"更糟）。目标非字符串/空串 ⇒ 直接 `return false`，不碰任何依赖。

### 3.5 离线状态（三通道并存）

`composables/useOfflineStatus.js` 的通道不是冗余，是三种宿主：

| 通道 | 来源 | 作用 |
|---|---|---|
| ① 主进程推送 | `offline:lost`（本批新增）/ `offline:restored` | Chromium 网络栈的真实观测 |
| ② 渲染层 `window` 事件 | `online` / `offline` | 主窗口隐藏或主进程推送未达时的兜底 |
| ③ 挂载首帧拉取 | `offline:status` | 首帧正确性 |

关键取向：`online` 侧**不猜计数**——浏览器只知道"连上了"，不知道队列剩多少，因此恢复后必须回主进程 `offline:status()` 取真值；凭猜测清零会让「N 个待发布」在恢复瞬间消失。任一通道失败只停那一通道（旁路观测，不得影响主流程）。`dispose()` 成对释放全部监听。

主进程侧（`electron/services/offline-manager.js`）：`net.on("offline")` 早已注册，缺的只是方向——现在 `在线→离线` 发 `offline:lost`，`离线→在线` 仍发 `offline:restored`，重复的同向事件不重复通知，没有可用窗口时静默旁路。

### 3.6 发布进度陈旧看门狗

`stores/publishProgress.js` 新增：

- `lastEventAt` 从"写 4 次读 0 次"变成判据输入。阈值 `STALE_AFTER_MS = 180000`（3 分钟），采样 `STALE_TICK_MS = 15000`。
- 判据取**所有 running 任务里最近一次事件时刻**（`lastEventAt`，缺席退回 `startedAt`）：只要有任何任务刚动过就不算整体停滞。
- 三个"不谎报"边界：两个锚点都缺 ⇒ 沉默（无从判断）；任务全部终态 ⇒ 不算停滞（那是完成）；`runningTasks === 0` ⇒ 不判。
- 看门狗 interval 与订阅同生命周期（App 级常驻，`init()` 幂等由 `listenersBound` 守），并提供 `stopStaleWatch()`；`unref()` 在可得时调用。

### 3.7 路由兜底

`router/index.js` 末尾新增 catch-all `/:pathMatch(.*)*` → `views/NotFound.vue`。已登记路径不得被抢（`/accounts`、`/` 由 N1 用例守着）；catch-all 的位置只影响可读性，vue-router 4 按段长打分。

---

## 4. 显示项（界面必须出现什么）

### 4.1 设置页 Tab 清单（本批后）

| 顺序 | key | 标签（zh / en） | 状态 | 面板 |
|---|---|---|---|---|
| 0 | `model` | 模型设置 / Model Settings | 可用 | `ModelProviders` |
| 1 | `general` | 通用设置 / General Settings | 可用 | `LogsSettings` |
| 2 | `feishu` | 飞书 API | 可用 | `FeishuSettingsTab` |
| 3 | `zhihu` | 知乎 API | 可用 | `ZhihuSettingsTab` |
| 4 | `publish` | 发布设置 / Publish Settings | 可用 | `PublishFrequencySettings` |
| 5 | `hotkeys` | 快捷键 / Keyboard shortcuts | **本批新增，可用** | `HotkeysSettings` |
| 6 | `account` | 账号设置 / Account Settings | 禁用（敬请期待） | placeholder |

### 4.2 快捷键面板

- 容器：`role="region"`，`aria-label = t('hotkeys.title')`。
- 加载态：`<p role="status">正在读取快捷键…</p>`，**加载期不得渲染表格**（防假空态）。
- 不可用态：`role="alert"` + 「重新读取」按钮。触发条件：`electronAPI` 缺席 / 无 `hotkeysList` 方法 / `code !== 0` / `data` 非数组 / 空数组 / 调用抛错。
- 表格：语义 `<table>` + `<caption>`（视觉隐藏）+ `<thead>` 两列「按键」「作用」；每行 `<th scope="row"><kbd>…</kbd></th><td>…</td>`。
- 按键显示：`CmdOrCtrl+Alt+P` → Windows `Ctrl+Alt+P`，macOS `⌘⌥P`；`CmdOrCtrl+Comma` → `Ctrl+,` / `⌘,`；单字符键统一大写；**未识别的长令牌原样透出**（宁可露出也不假装翻译过）。
- 用途文案：`hotkeys.label.*`（zh/en 成对）；`labelKey` 缺失时退回主进程中文 `label` 并 `console.warn` 出声。
- 底部说明：键位由内置定义、暂不支持自定义，指引走「设置 → 用户反馈」。

### 4.3 离线横幅

`role="alert"` + `data-testid="offline-banner"`；文案 `common.offlineBanner`；有缓存任务时追加 `common.offlineCachedCount`（`{count}`）。暗色档底色 `#3a2a08` / 文字 `#f5d98b`（原实现只有浅色档）。保留入场 `slideDown` 动画。

### 4.4 发布进度面板

- 停滞徽标：`role="status"`、`data-testid="publish-progress-stalled"`、文案「已 {minutes} 分钟无更新」、`title` 给出解释（可能仍在平台侧排队/上传，可关闭面板，发布不会中断，回来能看到结果）。
- 关闭按钮解禁条件：`store.hasRunning && !store.hasStalledTasks`。停滞时的 `title` 换成 `closeStalledHint`，正常时保持 `closeDisabledHint` / `close` 三态。

### 4.5 404 页

`role="alert"`，显示 `404` 数字标记、标题、说明、**用户尝试访问的 path**（只回显 `route.path`，不回显 query——query 可能含尚未发布的草稿标题），两个出口：回到首页（`router.replace('/')`）、返回上一页（`history.length > 1` 才 `back()`，否则退回首页）。

---

## 5. 提示文字全清单（zh / en 成对，CI Gate 7 逐键校验）

| 键 | zh | en |
|---|---|---|
| `publishDrafts.deleteConfirmTitle` | 删除草稿 | Delete draft |
| `publishDrafts.deleteConfirmMessage` | 将永久删除草稿「{title}」。草稿不入回收站，删除后不可恢复。确认删除？ | This will permanently delete the draft "{title}". Drafts are not moved to a trash and cannot be recovered. Delete it? |
| `publishDrafts.untitledDraft` | （无标题） | (untitled) |
| `settings.cache.clearConfirmTitle` | 清理缓存 | Clear cache |
| `settings.cache.clearConfirmMessage` | 将删除 {count} 个临时缓存文件，释放约 {size}。中间产物删除后需重新生成，不可恢复。确认清理？ | This deletes {count} temporary cache files and frees about {size}. … Cannot be recovered. Clear them? |
| `settings.logs.clearConfirmTitle` | 清理日志 | Clear logs |
| `settings.logs.clearConfirmMessage` | 将清空本机全部应用日志文件，历史日志不可恢复（不影响账号、草稿与发布记录）。确认清理？ | This wipes every application log file on this device; past logs cannot be recovered (accounts, drafts and publish history are untouched). Clear them? |
| `memberCenter.signOutConfirmTitle` | 退出登录 | Sign out |
| `memberCenter.signOutConfirmMessage` | 退出后本机不再保持登录，会员权益、配额与云端账号同步会暂停，需重新输入凭据才能恢复。确认退出？ | After signing out this device keeps no session: membership benefits, quotas and cloud account sync pause until you sign in again with your credentials. Sign out? |
| `memberCenter.revokeOthersConfirmTitle` | 退出其他设备 | Sign out other devices |
| `memberCenter.revokeOthersConfirmMessage` | 将撤销除当前设备外的全部登录会话，其他设备需重新登录。此操作不可撤销，也无法远程找回那些会话。确认退出其他设备？ | This revokes every session except the current device… It cannot be undone, and those sessions cannot be recovered remotely. Continue? |
| `automation.removeConfirmTitle` | 删除自动化任务 | Delete automation task |
| `automation.removeConfirmMessage` | 将删除自动化任务「{name}」。任务配置与其中保存的触发条件、失败处理策略一并移除且不可恢复。确认删除？ | This deletes automation task "{name}" together with its trigger and failure-handling configuration. It cannot be recovered. Delete it? |
| `accountsPage.confirmDeleteAccount` | 确定删除「{platform}」账号「{name}」吗？登录凭证会一并删除且不可恢复，需重新登录才能恢复。 | Delete the {platform} account "{name}"? Its login credentials are removed too and cannot be recovered — you will have to sign in again. |
| `common.unsavedLeaveTitle` | 离开当前页面 | Leave this page |
| `common.unsavedLeaveMessage` | 当前页面还有未保存的内容，离开后会丢失（本页不在保活范围内）。确认离开？ | This page still has unsaved content, and it is not kept alive across navigation — leaving will discard it. Leave anyway? |
| `common.unsavedLeaveMessageWithSubject` | 当前页面还有未保存的内容「{subject}」，离开后会丢失（本页不在保活范围内）。确认离开？ | This page still has unsaved content "{subject}"… Leave anyway? |
| `common.offlineBanner` | 网络已断开 — 发布任务将被缓存，网络恢复后自动重试 | Network disconnected — publish tasks will be cached and retried once you are back online |
| `common.offlineCachedCount` | （{count} 个待发布） | ({count} pending) |
| `common.notFoundTitle` | 这里没有可显示的页面 | There is nothing to show here |
| `common.notFoundHint` | 你访问的地址在本应用里不存在，可能是地址输错或入口已调整。 | This address does not exist in the app — it may be mistyped, or the entry has moved. |
| `common.notFoundHome` | 回到首页 | Back to home |
| `common.notFoundBack` | 返回上一页 | Go back |
| `common.notFoundFootnote` | 如果从菜单或帮助链接点进来，请把上方地址一并发给我们，便于定位是哪条入口失效。 | If you reached this page from a menu or a help link, send us the address above so we can find the broken entry. |
| `settings.tabHotkeys` | 快捷键 | Keyboard shortcuts |
| `hotkeys.title/subtitle/colKeys/colAction/loading/unavailable/retry/customizeHint` | 见 `src/locales/hotkeys/zh.js` | 见 `src/locales/hotkeys/en.js` |
| `hotkeys.label.publish/newPublish/dashboard/collection/home/accounts/keywords/viral/quit` | 打开发布页 / 新建发布 / 打开数据看板 / 打开内容采集 / 返回首页 / 打开账号管理 / 打开关键词监测 / 打开爆款分析 / 退出应用 | Open Publish / New publish / Open Dashboard / Open Collection / Back to Home / Open Accounts / Open Keyword Monitor / Open Viral Analysis / Quit the app |
| `publishPage.publishProgressPanel.stalledBadge` | 已 {minutes} 分钟无更新 | No update for {minutes} min |
| `publishPage.publishProgressPanel.stalledExplanation` | 这段时间没有收到新的进度事件。任务可能仍在平台侧排队或上传；你可以关闭本面板，发布不会因此中断，回到本页会重新看到结果。 | No progress events arrived during that window. The task may still be queued or uploading on the platform… |
| `publishPage.publishProgressPanel.closeStalledHint` | 长时间无更新，可关闭面板（后台仍在继续） | Stalled for a while — you may close this panel (still running in background) |

---

## 6. 数据校验与边界

| 对象 | 校验 | 失败语义 |
|---|---|---|
| `confirmDanger.message` | 必须是非空字符串 | `throw`（不弹无文案窗） |
| `useUnsavedLeaveGuard.isDirty` | 必须是函数 | `throw`（不静默"不拦"） |
| `formatAccelerator(input)` | 非字符串 / 空串 / 全空白 | 返回 `''`，不抛 |
| `hotkeys:list` 载荷 | `code===0` 且 `data` 为非空数组 | 判不可用（`role="alert"`），不渲染空表 |
| `offline:status` 载荷 | `code===0 && data` 才采纳 | 保持现状（不把 IPC 故障读成"在线"） |
| `navigateToHomeShellRoute(to)` | `typeof to === 'string' && to` | `return false`，不碰依赖 |
| 任务停滞锚点 | `lastEventAt > 0`，否则 `startedAt > 0` | 都缺 ⇒ 不判停滞 |
| 破坏性 API 名单派生 | 解析出空集即抛错 | 门禁 `rc=2`（把工具失明读成结论是本仓同型错误） |
| 404 回显 | 只 `route.path` | 不回显 query（可能含未发布正文） |

---

## 7. 交互与不变量（含锁的位置）

1. **取消 = 不执行**，且对底层 API 的调用次数必须为 0（不是"调了但回滚"）。
2. **确认文案必须点名对象 + 说清不可恢复**；只写"确定吗"不合格。
3. **同一动作只允许一次确认**（`CreateView.vue#deleteHistory` 的注释"唯一确认，勿叠加"是既有契约，不得再加一层）。
4. `UiModal` 默认值：`trapFocus=true`、`closeOnEsc=true`、`closeOnOverlay=true`。`progress` 变体两处都豁免（modeless 观察窗不抢焦点、不注册全局键盘监听）。不变量：**破坏性动作不得绑在关闭路径上**（`UiModal.destructive.test.js` 逐点扫描承载点清单只能缩小）。
5. **加载期不得渲染空态/零值**（离线横幅、快捷键面板、后续所有三态改造都守这条）。
6. **观测面不得反噬主流程**：离线通道、看门狗、外链失败上报一律旁路，异常只 `warn`。
7. 导航实现只有一份：`MpSidebar` 与 `App.vue` 的快捷键落点必须 import `useHomeShellNavigation`；结构锁双向（既查"都 import"，也查"MpSidebar 不再自带三段式、App 不再裸 `router.push(route)`"）。
8. 未保存守卫的覆盖面是**扫出来的**，不是记下来的：`src/unsaved-leave-contract.test.js` 扫 `src/views` 的 `<textarea v-model>`，三选一（保活 / 已挂守卫 / 欠账带实测理由）。当前实测 8 个编辑视图：`Publish` 保活、`RewriteView` 已挂、其余 6 个（CreateView / ResultView / HotTopics / AutoPipelineView / ContactSheetView / PodcastChannelView / Collection / PromptEvalView 中实际命中者）带逐条实测理由登记，清单只能缩小。

---

## 8. 验收标准

| # | 验收 | 取证方式 |
|---|---|---|
| A1 | 7 个破坏性入口未确认时底层 API 调用次数为 0 | 行为锁（各视图/composable 测试，含"取消"分支） |
| A2 | 门禁首遍报出的 A 档里，除登记项外无未登记项 | `node scripts/check-danger-confirm.js` rc=0 |
| A3 | 摘掉任一确认守卫，对应测试必红 | 变异反证（见 §8.1） |
| A4 | `UiModal` 不传参时 Esc 关闭、Tab 不出窗 | `UiModal.destructive.test.js` 行为锁 |
| A5 | 主干无 `var(--token)hex` 死声明，扫描域有规模下界 | `scripts/check-css-var-concat.test.js` E 档 |
| A6 | `#/typo` 渲染 404 视图而非空白；已登记路由不被抢 | `NotFound.test.js` N1（真路由表 `router.resolve`） |
| A7 | 快捷键面板显示主进程真表，三态齐挂 | `HotkeysSettings.test.js` 7 例 |
| A8 | 断网即时出横幅（不等重启） | `offline-manager.test.js`（主进程方向性）+ `useOfflineStatus.test.js`（三通道/dispose） |
| A9 | 停滞 3 分钟后面板说明并解禁关闭；新事件立即复位 | `publishProgress.stale.test.js` 6 例 |
| A10 | 全量桌面单测 + 6 个前端门禁 + locale 双向 + QM-1 打包 | 见 `openspec/records/ux-audit-impl.md` |

### 8.1 变异反证（已实跑 / 待实跑）

| 变异 | 期望 |
|---|---|
| 摘掉 `removeDraft` 的确认 | `usePublishDrafts.test.js` 「未确认时 draftDelete 调用为 0」变红 |
| 摘掉 `clearCache` 的确认 | `CacheCleanupSection.test.js` 新增例变红 |
| 把 `var(--surface)3e0` 改回去 | `check-css-var-concat` 现场 rc=1 且测试 E 档变红 |
| 把 `closeOnEsc` 默认改回 false | `UiModal.destructive.test.js` 默认值锁 + 行为锁各红 |
| 把 `check-danger-confirm` 的作用域判据改成"同文件出现过确认" | P3 变红（该例正是"确认写在别的函数里"） |
| 摘掉 `offline:lost` 发送 | `offline-manager.test.js` 第 1/2/3 例变红 |
| 把 `hasStalledTasks` 恒置 false | stale 测试第 1/2/3 例变红 |

---

## 9. 剩余排期（阶段 1 批次 B 起）

| 批次 | 项 | 关键判据（不得只按本 PRD 的字面执行，须先复核实况） |
|---|---|---|
| 1B | 1.1 暗色入口 | **单独成包**（评审 c2）；设置页「外观」分组 + `useTheme` 改模块级单例；合并后暗档像素门禁起算；暗色基线重建须人工审核 |
| 1B | 1.2 公告横幅挂载 | `AnnouncementBanner` 零引用；若与内嵌视图重叠必须走 `useEmbeddedViewSuspension` 登记 owner（CSS z-index 对原生 `WebContentsView` 无效） |
| 1B | 1.3 TrialBanner / LoadingState | 二选一：接进 MemberCenter 或删除；不允许"存在但无人渲染"。`LoadingState` 已全局注册但模板零使用 |
| 1B | 1.4 `/first-run` | 完成标记是 `userData/first-run-done` 磁盘文件（非 store 键）；未落即导航 |
| 1B | 1.10 帮助与支持 | 外链复用既有受控通道 `window.open → setWindowOpenHandler → isAllowedExternalUrl`，**禁止新写第二份协议判据** |
| 2 | 2.1–2.8 | 封面缩略图三步、历史列表三项、`allSettled` 首屏、监听前移、聚合进度软权重、发布前摘要确认、toast 单点化、首屏体量 |
| 3 | 3.1–3.9（3.3 除外） | 术语/导航真源、数据口径、令牌双轨、控件体系、三态统一、最差文案、账号页重排 |
| 4 | 4.1–4.8 | 浅色对比度重取、裸 hex 收编、label for、键盘可达、roving tabindex、aria-live、长度限制口径、稳定 `:key` |
| 5 | 5.1–5.6 | ops-center 纳入门禁、`check-ui-wired.js`、`check-field-consumed.js`（**不得早于 1.8**，已满足）、`contrast-audit` 接 CI、导航行为埋点（隐私边界先定义） |

**新门禁上线三步序**（审计 §5）：生成基线快照 → 人工批准 → 与接线同批落地。

---

## 10. 待人工裁决 / 上报事项

1. **品牌名**（阶段 3.3）：`productName` 与 5 处「汤姆鱼」需一个产品决策，agent 不自行改。
2. **审计稿两处更正需回灌**：`audit-29` 的「遮罩即默认同意」被实测否证（三处承载点关闭路径均为 cancel）；`0.5` 的 Publish 项与 `audit-3` 自身的收敛结论矛盾（不应并列）。本 PRD 按 finding 级结论执行，差异记录在 `openspec/records/ux-audit-impl.md`。
3. **畸形 CSS 实测是 4 处不是 3 处**（`OptimalTimeTip.vue:42` 为漏计的一条）。
4. **暗档像素门禁**：1.1 合并后 20 张 `*-dark` 基线成为真实回归面，基线重建需人工审核。
