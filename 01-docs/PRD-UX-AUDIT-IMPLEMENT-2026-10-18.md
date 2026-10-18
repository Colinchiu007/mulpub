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
| 2 | `appearance` | 外观 / Appearance | **1.1 新增，可用**（`Brush` 图标） | `AppearanceSettings` |
| 3 | `feishu` | 飞书 API | 可用 | `FeishuSettingsTab` |
| 4 | `zhihu` | 知乎 API | 可用 | `ZhihuSettingsTab` |
| 5 | `publish` | 发布设置 / Publish Settings | 可用 | `PublishFrequencySettings` |
| 6 | `hotkeys` | 快捷键 / Keyboard shortcuts | **1.6 新增，可用** | `HotkeysSettings` |
| 7 | `account` | 账号设置 / Account Settings | 禁用（敬请期待） | placeholder |

（§12 落地后的 8 行清单；`appearance` 插在 `general` 之后，把 `feishu/zhihu/publish/hotkeys/account`
整体后移一位。`SettingsDialog.test.js` 的 Tab 顺序锁与图标位计数（8）已同步。）

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
| 1B | 1.1 暗色入口 | ✅ **已落地**（§12）：设置页「外观」分组 + `useTheme` 改模块级单例 + `App.vue` 启动引导。合并后暗档像素门禁起算；**暗色基线重建仍须人工审核**（本 PR 不伪造基线） |
| 1B | 1.3 TrialBanner / LoadingState | ✅ 已落地（§11.1.1 / §11.1.2）：横幅挂进 MemberCenter，`LoadingState` 连同测试与两处注册删除 |
| 1B | 1.4 `/first-run` | ✅ 已落地（§11.1.3）：完成标记只由退出动作写；判定走拉取；第二套引导真源 `services/onboarding.js` 已删 |
| 1B | 1.10 帮助与支持 | ✅ 已落地（§11.1.4）：全部指向应用内落点，未新增外链与第二份协议判据 |
| 1B | 1.2 公告横幅挂载 | ✅ **已落地**（§13）：top-inset 通道四处同步 + 横幅上报高度 + 卸载回 0。**实测修正**：`WebContentsView` 的原生图层不按 CSS 定位，而内嵌视图位置由主进程 `computeEmbeddedViewBounds(win, sidebarWidth)` 算出（`BROWSER_CHROME_TOP=76` 就是"渲染层固定头高"的镜像常量）。因此挂根级横幅**不能只登记 owner**，必须先加一条 **top-inset 通道**：仿 `setSidebarWidth` 的四处同步 —— `electron/services/view-bounds.js`、`webview-manager/layout.js`（`_topInset` + 变更后 `_repositionAll()`）、`webview-manager/ipc-handlers.js:246` 同族的 IPC 注册、`electron/preload/page-manager.js:40` + 渲染层 `invokePageManager('setTopInset', h)`（横幅高度用 `ResizeObserver` 上报，卸载/关闭时回 0）。改这条链路必须同跑 `overlay-view-suspension.test.js` + `shell-mode-6b.test.js` 全量 |
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

---

## 11. 阶段 1 批次 B（1.3 / 1.4 / 1.10）

### 11.1 功能逻辑与流程

**11.1.1 试用/免费版横幅（1.3，`TrialBanner` → `MemberCenter`）**

```
进入「会员中心」
  ├ status=disabled（身份服务未启用）    → 不渲染横幅
  ├ 未登录（无 user.sub）               → 不渲染横幅
  └ 已登录
      ├ showUpgradeCta === false        → 不渲染横幅   ← 判据取服务端 entitlement.plan
      └ showUpgradeCta === true
          └ TrialBanner 自身 showBanner = (isTrial || isFree) && !dismissed
              ├ 点「立即购买 / 升级 Pro」→ emit upgrade → 打开 UpgradeModal
              └ 点「✕」               → emit dismiss  → 本次会话内不再显示
```

两条判据分居两层，各有理由，不得合并：

- **可见资格**取 `showUpgradeCta`（`MemberCenter.vue:294` 的 A2 单一真源：登录且有服务端权益时以 `entitlement.plan` 为准）。
  若只信组件内部的本地 `licenseStore`，专业版用户在 `identityStore` 尚未就位时会因
  `isFree = !isPro` 的默认值被闪一次「当前为免费版」——把付费用户当成免费用户是可见的尊严损失。
- **倒计时正文**取本地 `licenseStore.daysRemaining`，因为 `expiresAt → 剩余天数` 的换算只有
  `license-manager._daysRemaining()` 一份实现（`electron/services/license-manager.js:275`），
  服务端权益只带 `expiresAt` 裸时间戳。

**关闭只在会话内生效，不持久化**：正文是「还剩 N 天」这类随时间自证过期的事实，
持久化压制会让倒计时在下次进入时永久消失。这与 `AnnouncementBanner` 的一次性运营公告
（不随时间自证、故可持久化 dismiss）是两类语义，不得共用一个存储键。

**11.1.2 死全局注册清理（1.3，`LoadingState`）**

`LoadingState.vue` 在 `main.js` 全局注册，但**全仓 `.vue` 模板零消费**（各页用的是裸
`<div class="loading-state">`），而它自带 7 条用例——即 AGENTS.md 说的「注册 ≠ 使用」与
「测试数为 0 ≠ 没接线，反之全绿也可能是死码」。处置：删除组件 + 其测试 + `main.js`
注册 + `test-setup.js` 镜像注册。同批保留的 `EmptyState` / `UiSkeleton` 经实测各有真实消费点
（`HotTopicsFavorites.vue` 等 / `ApprovalGateModal.vue` 等），故只删零消费的那一个。

并新增机械锁 `src/global-components-contract.test.js`（详见 §11.5），把这条纪律从"人记得问"
变成"CI 会问"。

**11.1.3 首运向导接回启动判定（1.4）**

修复前的真实链路是断的，且断在**写侧**：

```
window.js:211 firstRun.runSetup(mainWindow)
   └ first-run.js  isSetupDone()?  否 → writeFileSync('first-run-done')  ← 每次启动无条件写
                        └ 渲染进程之后问 first-run:check 永远得到 true
                             └ /first-run 无来源 ⇒ 向导永不可达（audit-4「建好但未接线」）
```

修复后：

```
主窗口创建
  └ （不再有任何启动期写盘动作；runSetup 与 first-run:status 推送一并删除）
App.vue 挂载（仅主窗口实例；home-shell 实例跳过）
  └ useFirstRunGate → api.firstRunCheck()
        成功信封 && setupDone === false  → router.replace('/first-run')
        其余一切（无桥接 / 抛错 / code≠0 / data 缺失 / 字段不是 false / 已在向导）→ 不动
用户退出向导（两个终按钮或「跳过引导」）
  └ firstRunComplete() → IPC first-run:complete → firstRun.markDone() 写标记
        写失败 → 仍放行导航 + 出声 toast（不得静默；也不得把用户关在没有导航栏的全屏路由里）
```

**向导本体同步改判**：旧第 1 步「环境检测 / 自动安装 Python 依赖和 Playwright」在 P2-E
之后主进程已不做任何安装（`runSetup` 里那段检查被移除），它既不会成功也不会失败——
属于「界面声称会做、代码里没有人做」的假承诺。引导收敛为三步：欢迎 → 添加账号 → 发布教学，
`fr-dots` 由 4 点改 3 点，欢迎页清单由 3 项改 2 项。

**第 1 步必须有出口**：`/first-run` 是全屏路由（`App.vue:265 isFullScreenRoute`，无侧栏无导航），
若账号添加失败又无「跳过引导」，用户被物理关在里面。故新增 `data-testid="fr-skip"` 的
`onboarding.skip` 按钮，行为与终按钮一致（都记录完成状态）。

**真源收敛（顺带）**：仓内曾有**第二套**引导真源 `electron/services/onboarding.js`
（标记文件 `onboarding-done` + `onboarding:complete/get-steps/status` 三条 IPC + preload 三个方法），
其 `completeOnboarding()` 全仓零写点、三条通道零消费方。已整体删除（服务 / handler /
ipc-handlers/index 注册 / preload / 两处白名单 / 其测试）。保留 `first-run` 的理由是**兼容性事实**：
`first-run-done` 每次启动都在写，所有存量安装都已有它；若把真源换成 `onboarding-done`，
每个老用户下次启动都会被推进向导。

同时删除 `first-run:status` 推送通道：它在窗口创建瞬间发出，而 SPA 尚未挂载、无人监听，
状态本身又可由 `first-run:check` 随时读取——属于「写了没人读的第二套真相」。判定统一走拉取。

**11.1.4 帮助与支持改可用（1.10）**

原状态：`HelpSupport.vue:12-13` 只有一张卡 + 一句「如需帮助，请联系支持团队或查阅使用文档」，
而本仓**不存在任何文档站地址**（`package.json` 无 `homepage`、config 无 docs URL），
这句话没有任何可落点 ⇒ 死胡同文案。

改造后每条指引都指向应用内真实存在的落点，**不引入任何编造的外链**：

| 条目 | 落点机制 | 为什么不是别的选择 |
|---|---|---|
| 提交问题反馈 | `requestSettingsDialog('general')` | 反馈表单已在「设置 - 通用」（`LogsSettings.vue` + `feedback:submit` IPC）；重复实现第二份表单 = 第二真源 |
| 配置 AI 服务 | `requestSettingsDialog('model')` | 与采集页知乎区块同一条既有「就地打开设置」通道（`stores/settings-dialog.js:37`，带 seq 以便同一 Tab 连续请求也能触发 watch） |
| 管理社媒账号 | `router.push('/accounts')` | 登录态/代理/分组都在账号页 |
| 应用日志 | `logsGetInfo()` 展示规模 + 目录路径 + `writeClipboard(dir)` | **没有**新增 `logs:export` IPC：日志的取用路径已经由反馈表单的「同时上传应用日志」覆盖，再加一条导出通道是第二条出口；这里只补「让用户知道日志在哪」 |

外链规则沿用既有受控通道（`window.open → setWindowOpenHandler → isAllowedExternalUrl`，
`electron/window.js:92-114,266`），**本文件目前不需要外链**，也禁止新写第二份协议判据。

`locales/user-errors/zh.js` 的 `LLM_KEY_MISSING` 结尾原为「请参考使用说明或联系支持获取帮助」
——「使用说明」无处可点；改为具名落点「打开『会员中心 - 帮助与支持』，点『配置 AI 服务』可直接
跳到该设置页」。错误文案不做富文本可点击（渲染通道是纯文本），改为**指得出确切路径**。

### 11.2 显示项

**会员中心（已登录态）**，页头之下、内容区之上，从左到右：

| 元素 | 条件 | 内容 |
|---|---|---|
| 试用横幅（`.trial-banner`） | `hasSessionIdentity && showUpgradeCta` | 试用档：图标 🎁 + 「试用期还剩 **N** 天，**N** 天后恢复免费版功能」+ 按钮「立即购买」；免费档：🔒 + 「当前为免费版，部分功能受限」+「升级 Pro」；尾部「✕」 |
| 横幅关闭后 | 本次会话内 | 整条不再渲染；页头「升级 Pro」入口不受影响 |

**会员中心 - 帮助与支持**，三张卡顺序固定：

1. 关于：`版本` + 取到的版本号，取不到显示 `—`（不显示空白、不显示 0.0.0）
2. 帮助与支持：一句说明 + 三个入口按钮，每个按钮右侧一行灰字说明它会把用户送到哪
3. 应用日志：三态互斥
   - 读取中：`role="status"` 的「正在读取日志信息…」
   - 成功：「{files} 个日志文件 · 共 {size}」+「日志目录」+ 路径 `code` 块 +「复制日志目录路径」
   - 失败：`role="alert"` 的「未能读取日志信息。」+「重试」按钮 —— **失败态绝不渲染规模行**

**首运向导**：三步进度点 3 个；欢迎页 2 项清单（① 添加账号 ② 发布内容）；第 1 步双按钮
（主按钮「已添加账号，下一步 →」+ 次按钮「跳过引导」）；终页双按钮（「管理账号」/「开始发布 →」）。

### 11.3 提示文字全清单（本批新增/改写，zh/en 成对）

| key | zh | en |
|---|---|---|
| `memberCenter.helpHint` | 以下入口都在应用内，点了就能到。 | Every entry below lands somewhere inside the app. |
| `memberCenter.helpFeedback` | 提交问题反馈 | Send problem feedback |
| `memberCenter.helpFeedbackHint` | 在「设置 - 通用」填写问题描述，可勾选同时上传应用日志。 | Describe the issue under Settings - General; app logs can be attached. |
| `memberCenter.helpModelConfig` | 配置 AI 服务 | Configure AI services |
| `memberCenter.helpModelConfigHint` | AI 改写与生图需要先填服务商 API Key。 | AI rewrite and image generation need a provider API key first. |
| `memberCenter.helpAccounts` | 管理社媒账号 | Manage social accounts |
| `memberCenter.helpAccountsHint` | 登录态、代理与分组在此维护。 | Login state, proxy and groups live here. |
| `memberCenter.helpLogsTitle` | 应用日志 | App logs |
| `memberCenter.helpLogsLoading` | 正在读取日志信息… | Reading log information… |
| `memberCenter.helpLogsUnavailable` | 未能读取日志信息。 | Could not read log information. |
| `memberCenter.helpLogsRetry` | 重试 | Retry |
| `memberCenter.helpLogsSummary` | `{files}` 个日志文件 · 共 `{size}` | `{files}` log files · `{size}` total |
| `memberCenter.helpLogsDirLabel` | 日志目录 | Log folder |
| `memberCenter.helpCopyDir` | 复制日志目录路径 | Copy log folder path |
| `memberCenter.helpCopied` | 日志目录路径已复制 | Log folder path copied |
| `memberCenter.helpCopyFailed` | 复制失败，请手动打开日志目录 | Copy failed; open the log folder manually |
| `onboarding.stepsIntro` | 两步完成配置，即可开始多平台一键发布 | Two steps to set up, then publish to every platform at once |
| `onboarding.step1Desc` | 登录你的社交媒体平台账号 | Sign in to your social media accounts |
| `onboarding.step2Desc` | 写一篇文章发布到各平台 | Write one post and send it to all platforms |
| `onboarding.markDoneFailed` | 未能记录引导状态，下次启动可能再次进入向导 | Could not save the guide status; the wizard may appear again next launch |
| `onboarding.skip`（既有键，本批首次被消费） | 跳过引导 | Skip Tour |
| `userErrors.llmErrors.LLM_KEY_MISSING` | 结尾改为具名落点（见 §11.1.4） | …click "Configure AI services" to jump straight to that page. |

`memberCenter.helpHint` 旧值「如需帮助，请联系支持团队或查阅使用文档。」/「Need help? Contact
support or browse the docs.」被替换——它承诺了一个不存在的文档站。

### 11.4 数据校验与边界

| 输入/来源 | 判据 | 不合格时的行为 |
|---|---|---|
| `first-run:check` 响应 | 必须 `code===0` 且 `data` 为对象且 `setupDone` **严格** `=== false` 才导航 | 其余一律不动；`undefined` 不等于 `false`（「没拿到证据」不是反证，不得据此把用户推进向导） |
| `logs:info` 响应 | `code!==0` / `data` 缺失 / 抛错 ⇒ 进入失败态 | 不渲染规模行；不显示「0 个日志文件」（那会把"读不到"冒充成"没有日志"） |
| `totalBytes` / `fileCount` | `Number.isFinite` 才采纳，否则记 0 但**照常渲染成功态** | 字段缺席 ≠ 读不到，两者语义不同，不得混为一态 |
| `dir` | 空字符串 ⇒ 复制按钮 `disabled` | 不得复制空串并回报成功 |
| `writeClipboard` 返回值 | 只有 `true` 才报成功 | `false`/抛错 → `notifyError(helpCopyFailed)`，不谎称已复制 |
| `first-run:complete` 回执 | 只有 `code===0 && data.setupDone===true` 视为已记录 | 仍放行导航，但必须 toast 出声（静默失败 = 下次又被推进向导且无从解释） |
| `firstRunComplete()` 桥接缺席 | 显式返回 `{code:-1,message:'BRIDGE_UNAVAILABLE'}` | **不走** `invokeWithFallback` 的 `{code:0}` 假成功——那是把「写不了」伪装成「已写」 |
| `markDone()` 写盘 | `fs.writeFileSync` 抛错即返回 `{done:false,error}` | 不抛给 IPC 层；错误码原样回传 |
| 试用横幅可见资格 | 取服务端 `entitlement.plan`，`entitlement` 为 null 时才回落 `!licenseStore.isPro` | 不得让本地默认值（`isPro:false`）在权益未就位时判出「免费版」横幅 |
| `isDirty`（0.5 守卫，沿用） | 非函数即抛 | 装配错误必须在开发期炸，不在运行期静默 |

### 11.5 交互与不变量（含锁的位置）

| 不变量 | 锁 |
|---|---|
| 全局注册的组件必须有 `.vue` 模板消费者；`main.js` 与 `test-setup.js` 两份清单逐字相同 | `src/global-components-contract.test.js`（5 条，含「解析器确实取到注册项」与「扫描域非空」两条反失明 + `LoadingState` 墓碑） |
| App 真的调用首运判定，且四条「不该跳」分支都不跳 | `src/App.first-run-gate.test.js`（4 条装配锁） |
| 判据本身的 6 条分支（含 `undefined ≠ false`） | `src/composables/useFirstRunGate.test.js` |
| `first-run.js` 不再有 `runSetup`；导出面恰好是 `{checkDeps,isSetupDone,markDone,reset}`；写失败不抛 | `electron/services/first-run.test.js`（6 条，含导出清单 `toEqual` 与幂等刷新） |
| 向导三步、第 1 步有出口、退出必写标记、写失败必出声 | `src/views/FirstRun.test.js`（17 条） |
| 每个入口按钮都真的带动作（R92 同族：按钮在、方法在、绑定缺 = 点了没反应） | `HelpSupport.test.js` 第 1 条 + `MemberCenter.test.js` 的 upgrade/dismiss 三条 |
| 失败态不得渲染成功态的任一区块 | `HelpSupport.test.js`「IPC 非成功码必须落到"取不到"分支」 |
| 引导状态只有一个真源（`first-run-done`） | 删除 `services/onboarding.js` 及其 3 条通道；`preload.test.js` 的三条计数棘轮随之如实改数（140 → 137 等，见 §11.6 的既有假红记录） |

### 11.6 本批证据与如实记录

- **既有假红（非本批引入，已用控制对照定位）**：`electron/preload.test.js` 的 system 模块计数在
  我把 `system.js` 精确还原到 HEAD 后**实测 140**，而该断言写的是 139 ⇒ 这条棘轮在我动手前
  就差 1。处置：按当场测得值改为 137（本批净 −4 +1），并在注释里留下这次对照的读数与结论。
- **同批修正的口径错误**：初次改数时我按「−4 +1 = −3」推断合并 api 总键数应为 334，实测 335。
  差 1 的解释我没有取证，因此注释只写测得值与增减名称，不写未经取证的推导。
- `check-max-lines`：`FirstRun.vue` 与 `HelpSupport.vue` 均在阈值内；新增文件
  `useFirstRunGate.js` / `publish-progress-stall.js` / 三个测试文件均 < 200 行。
- `check-locale-sync --cjk`：基线 1331 → 当前读数下降（删除向导死文案与 `LoadingState`），
  无新增硬编码；`--keys` 2156 个使用中的 key 全部存在于 zh/en。

### 11.7 本批最重的一条：阶段 0 的确认守卫测试从未被执行过（含两个被它掩盖的真实缺陷）

`src/views/member-center/AccountSecurity.test.js` 写成 `vi.hoisted(() => ({ status: ref('authenticated'), … }))`，
而 `vi.hoisted` 的工厂会被提升到本文件所有 `import` **之前**执行 ⇒ `ref` 命中 TDZ
（`ReferenceError: Cannot access '__vi_import_1__' before initialization`）⇒ **整个文件 0 条用例被执行**。

四层证据全部对它隐身：

1. 集合失败**不贡献任何测试数**，`Tests 5677 passed` 读起来完全像通过；
2. 我当时只读了 `Tests` 行，没读 `Test Files` 行；
3. `scripts/check-unwired-tests.js` 的域只覆盖 `scripts/` 与 `.github/scripts/`，
   `src/**` 由 vitest workspace 收集，所以"文件在收集期死亡"没有任何东西在看；
4. CI 侧 `QG Desktop Shards` 在我盯的那轮仍 pending，`QG Static` 不含该用例。

**口径更正（本批起生效）**：任何"全量绿"的结论必须以 **`Test Files` 与 `Tests` 两行同时零失败**为准。

修好夹具后跑出 6 条用例，其中 3 条真红，牵出两个真实缺陷：

- **缺陷 A（用户可见，先于本批存在）**：`AccountSecurity.vue:14,17` 判据方向写反
  —— `pending` 初值是 `null`，而按钮写 `:disabled="loading || pending !== 'switch'"`，
  于是**空闲态恒禁用**：用户从会员中心根本点不动「切换账号 / 退出登录」。
  改为与同文件 `revoking` 同向（只在自己那次请求进行中禁用），并补一条
  「空闲必须可点 + `loading` 时必须禁用」的行为锁 —— 此前正是这条锁缺席让反向判据活了下来。
- **缺陷 B（夹具同形性）**：`useMemberStore` 的 mock 给裸 `ref`，而组件按 Pinia 的解包语义读
  `memberStore.sessions.length` ⇒ 取到 `undefined` ⇒ 按钮再次禁用，
  `confirmDanger`"没被调用"看起来像守卫没生效。改为 `reactive({…})` 后与真源同形。
  这是 AGENTS.md「契约夹具不得替对方剥壳」的第三种落点：**替对方解包**。

**同形探针已验证但未接成门禁（不冒充已做）**：一条 perl 判据可扫"同步 `vi.hoisted` 工厂内出现
`ref/reactive/computed/shallowRef`"，做过正控（还原坏形态必 HIT）与负控（异步 hoisted 形态不 HIT），
全仓实测命中 **0**（即本文件是唯一的）。把它接进 CI 属新增"谁来守门"，留到阶段 5 与
`check-ui-wired.js` 同批处理。

### 11.8 随本批一起改的三条锁（属"实现变了、锁跟着改"，不是放宽）

| 锁 | 旧断言 | 新断言 | 为什么方向不变 |
|---|---|---|---|
| `electron/window.test.js` | 调用 `firstRun.runSetup` | 启动**不得**写首运完成标记（夹具补 `markDone` spy 并断言未被调用） | 被测行为就是"启动不写盘"，断言强度不降 |
| `ipc-exposure-contract.test.js`（M-9） | 直访 `getApi` 的文件数必须为 0 | 该锁当场抓到我在 `publisher.js` 直访 `getApi` ⇒ 实现改用桥接原语 `invokeWithFallback('firstRunComplete', null)` | 锁是对的，实现错了；桥接缺席仍回非 0 码，不返回假成功 |
| `electron/tests/visual-view-runner.test.js` | 每条路由都必须有单视图像素门禁 | 新增「非可渲染路由豁免清单」（只含 catch-all）+ 一条"僵尸豁免即红"的反向锁 | 通配兜底不是一条可跳转入口，其可见行为由 `NotFound.test.js` 4 条覆盖；像素基线必须来自 CI 同一次渲染，故不为其造本机基线。清单只能缩小 |

**本机环境红（与代码无关，不掩盖也不认领）**：`electron/services/feedback.test.js` 的
`fs.symlinkSync` 在本机报 `EPERM: operation not permitted, symlink …`
（Windows 非特权进程不能建符号链接）。feedback 服务本批未被触碰；CI 的 windows runner 可建链接，
判据以 CI 现场为准，此处如实登记本机读数。

---

## 12. 阶段 1.1（audit-9）暗色主题入口 —— 单独成包

> 这一条是整个审计里**成本被最低估**的一条：第一轮把它列进"接线批次"并宣称"几乎不产生新的
> 视觉回归面"，第二轮评审否证后撤回——接线暗色主题会让 `src/styles/*.css` 里实测 **72 处**
> `[data-theme=…]` 选择器（2026-10-18 当场重取：`grep -rn data-theme *.css | wc -l` = 72，
> 全部为 `dark` 变体；旧值 77 已撤回）与 **20 张** `*-dark` 基线**首次变成真实用户可达态**，
> 成本因此从 S 上修为 M，并独立成包。

### 12.1 缺陷本体与修法选择

| 维度 | 接线前（实测） | 接线后 |
|---|---|---|
| `useTheme()` 生产调用点 | **0**（`grep -rn "useTheme" apps/desktop/src` 只命中自身与其测试） | `App.vue` 引导 1 处 + `AppearanceSettings.vue` 1 处 |
| 状态承载 | 每次 `useTheme()` **新建一份** `theme` ref ⇒ 两个消费者状态互不同步 | 模块级单例：`mode/theme/loaded` 住在模块作用域，全应用一份 |
| 可表达的用户意图 | 只有 `light ⇄ dark` 二态开关 | 三态 `system \| light \| dark` |
| 持久化真源 | 存的若是**解析后的主题**，则"跟随系统"无法被记住 | 存**模式**（`ui:theme` = `system\|light\|dark`），解析结果不落盘 |

为什么必须是三态而不是开关：若只存解析结果，用户每改一次系统深色偏好，都会被上一次的手工
切换"钉死"成 light/dark，而系统偏好反过来又覆盖用户选择——两个方向的覆盖都表现为"设置没保存"。
所以**模式是真相，主题是派生值**。

### 12.2 功能逻辑与流程

```
App.vue setup
  └─ useTheme() → boot()（幂等：bootPromise 只建一次）
        └─ init():
             1) api.storeGetSetting('ui:theme')  ← 读持久化「模式」
             2) normalizeStoredMode(stored)      ← 非法值 → null（不回落成脏值）
             3) mode = stored ?? 'system'
             4) applyTheme(resolveTheme(mode))   ← resolveTheme: light/dark 原样；system 走系统偏好
             5) loaded = true
             6) subscribeSystemTheme()           ← 只注册一次（模块生命周期 == 应用生命周期）

用户在设置页「外观」点 radio
  └─ choose(value) → setMode(value)
        ├─ THEME_MODES 不含 value ⇒ return false 且不写存储（非法值不得进偏好）
        ├─ mode = value
        ├─ applyTheme(resolveTheme(value))        ← 立即生效，不等 IPC 回执
        ├─ boot()                                 ← 保证 bootPromise 已建立（首帧前被点不丢状态）
        └─ persist(value)                         ← storeSetSetting('ui:theme', value)

系统偏好变化（matchMedia change）
  └─ onSystemThemeChange：仅当 mode === 'system' 才 applyTheme
        （用户显式选过 light/dark 后，系统偏好不得覆盖用户意图）
```

**顺序不可破的两条**：① `applyTheme` 在 `persist` **之前**——持久化不可用（未登录 / 桥接缺席）
时用户看到的切换照样生效，回滚本地视觉态是把可用变不可用；② `loaded` 在 `applyTheme` **之后**
置真——否则面板先解禁、radio 先渲染成未定值，用户点下去会覆盖掉刚读到的偏好。

### 12.3 显示项

| 位置 | 显示内容 | 出现条件 |
|---|---|---|
| 设置页左侧 Tab | 「外观」，图标 `Brush`，位于「通用设置」之后、「飞书 API」之前 | 常驻，`disabled: false` |
| Tab 总数 | 8（账号设置仍为 `disabled` + 「敬请期待」） | 常驻 |
| 面板标题 | 「主题」 | 常驻 |
| 面板说明 | 「选择浅色、深色，或跟随系统偏好。」 | 常驻 |
| 加载态 | 「正在读取主题偏好…」，带 `role="status"` | 仅 `loaded === false` |
| 三档单选项 | 跟随系统 / 浅色 / 深色，各带一行说明 | 常驻 |
| 生效主题行 | 「当前生效：浅色 \| 深色」 | 常驻（`system` 模式下这是唯一能自证"设置生效了"的信息） |
| `data-theme` | `<html>` 上的 `light`/`dark` | 由 `applyTheme` 写，全仓 72 处样式的唯一开关 |

`<fieldset :disabled="!loaded">` 是**原生**禁用传播：偏好未读到时三档一并禁用，
不必给每个 `<input>` 单独写 `:disabled`，也不会出现"能点但点了覆盖掉偏好"的窗口。
用 `fieldset/legend` 而不是 `div + 标题文本`，是为了让三个 radio 天然属于同一
`name="appearance-mode"` 分组、屏幕阅读器读到分组名。

### 12.4 提示文字全清单（13 键，zh/en 成对，Gate 7 逐键校验）

| key | zh | en |
|---|---|---|
| `settings.tabAppearance` | 外观 | Appearance |
| `settings.appearanceTitle` | 主题 | Theme |
| `settings.appearanceHint` | 选择浅色、深色，或跟随系统偏好。 | Pick light, dark, or follow the system preference. |
| `settings.appearanceLoading` | 正在读取主题偏好… | Loading theme preference… |
| `settings.appearanceSystem` | 跟随系统 | Follow system |
| `settings.appearanceSystemDesc` | 随系统的深色/浅色设置自动切换 | Switches with the system dark/light setting |
| `settings.appearanceLight` | 浅色 | Light |
| `settings.appearanceLightDesc` | 始终使用浅色主题 | Always use the light theme |
| `settings.appearanceDark` | 深色 | Dark |
| `settings.appearanceDarkDesc` | 始终使用深色主题 | Always use the dark theme |
| `settings.appearanceCurrent` | 当前生效：{theme} | Currently active: {theme} |
| `settings.appearanceLightValue` | 浅色 | light |
| `settings.appearanceDarkValue` | 深色 | dark |

`appearance*Value` 单独成键而不是复用 `appearanceLight/appearanceDark`：选项标签是
"我要选哪个"（名词短语、句首大写），生效行是"现在是哪个"（嵌在句子里，英文要小写）。
合并成一份必然在某一侧读起来别扭，属可预见的翻译错误。

### 12.5 数据校验与边界

| 输入 | 判据 | 结果 |
|---|---|---|
| 存储里的模式 | `normalizeStoredMode`：非字符串 / 去空白后不在 `THEME_MODES` ⇒ `null` | 回落 `system`；**不回写**（不把自己的默认值伪装成用户意图） |
| `storeGetSetting` 信封 | 必须 `code === 0` 且 `data` 有值 | 否则按"无偏好"处理 |
| `storeGetSetting` 抛错（含 `LicensePermissionError`） | `try/catch` | 按"无偏好"处理，`loaded` 照样置真——面板可用是硬要求 |
| `storeSetSetting` 失败 | `try/catch`，静默 | 本地主题不回滚；日志由主进程侧承担 |
| `setMode('neon')` | `THEME_MODES.includes` 为假 | `return false`，DOM 与存储都不动 |
| `window.matchMedia` 不存在（非浏览器/老宿主） | typeof 守卫 | 按 `light` 处理，不注册监听、不抛错 |
| 重复 `useTheme()` | `bootPromise` 已存在 | 不再发第二次 IPC；系统监听 `systemListenerRegistered` 只挂一次 |
| `getApi()` 返回 null（纯 Vite 开发态） | 守卫 | 读视为无偏好、写静默跳过 |

**已知边界（如实记录，不掩盖）**：`storeGetSetting` / `storeSetSetting` 不在 preload
`PUBLIC_METHODS` 名单内 ⇒ 权限级别为 `authenticated`。未激活/未登录态下这两条调用会被
`access-control` 拒绝，此时**本次会话的切换仍然生效但不跨启动持久化**。这与 `drafts`、
`story2video.lastOptions` 等既有本地设置的边界完全同源（同一对通道，本批未改权限模型），
把它单独为暗色主题开一条 public 通道属于改"谁来守门"，不在本批范围。

### 12.6 交互与不变量（含锁的位置）

| # | 不变量 | 锁 |
|---|---|---|
| I-1 | 打开过设置并选过深色后，**下次启动不打开设置也应落深色** | `App.theme-boot.test.js` 第 1 条（真挂 App.vue，断言 `storeGetSetting('ui:theme')` 被调 + `data-theme === 'dark'`） |
| I-2 | 没有用户意图时不得写盘 | `App.theme-boot.test.js` 第 2 条（无偏好 ⇒ `storeSetSetting` 未被调用） |
| I-3 | 「跟随系统」必须能被持久化 | `AppearanceSettings.test.js`：切 dark 再切 system ⇒ `toHaveBeenLastCalledWith('ui:theme','system')` |
| I-4 | 脏值不得当作用户偏好应用，也不得回写 | `AppearanceSettings.test.js`：`data:'neon'` ⇒ 选中 system、`data-theme=light`、无写盘 |
| I-5 | 偏好未读到时面板禁用且有 status 加载态，读到后解禁且撤掉提示 | `AppearanceSettings.test.js`（用不 resolve 的 promise 卡住读，再手动 release） |
| I-6 | 存储不可用不得让面板变砖 | `AppearanceSettings.test.js` 末条（`storeGetSetting` reject ⇒ 仍可切 light 并落 DOM） |
| I-7 | 模块级单例：两个消费者共享同一份状态；`boot` 幂等 | `useTheme.test.js` 25 条（含"两个消费者共享同一份状态""多次 useTheme 只读一次偏好、只注册一次系统监听"） |
| I-8 | 外观 Tab 真能切出面板（Tab 在而面板缺席 = 死入口） | `SettingsDialog.test.js`「点击外观切换到外观面板」，断 3 个 `data-testid` |
| I-9 | Tab 顺序与可用性 | `SettingsDialog.test.js` 首条（8 个 Tab、逐个 label/disabled）|
| I-10 | `Icon 名必须真实存在` | `src/icon-imports-exist.test.js`（扫真实具名导入 vs 真实模块，`Brush` 已核：`'Brush' in icons === true`）|

`SettingsDialog.test.js` 里原有的**硬编码下标点击**（`findAll('.settings-tab')[4]` 等 4 处）
在本批一并改为按用户可见文案定位（`clickTab` / `tabByLabel`）。理由是这 4 处在插入第 3 个 Tab
后会整体位移，而断言仍然"通过"——只是悄悄改测了别的 Tab。该教训本文件早已写过一次
（「点击禁用 Tab」那条的注释），这次是它的第二次兑现。

### 12.7 变异反证（本批实跑）

| 变异 | 预期 | 实测 |
|---|---|---|
| M1 注释掉 `App.vue` 的 `useTheme()` 调用 | `App.theme-boot.test.js` 变红 | **CAUGHT**：2 条全红（`Tests 2 failed (2)`），其余文件不受影响 |
| M2 删除 `<AppearanceSettings v-else-if="activeTab === 'appearance'">` 一行（Tab 保留） | 只有"点击外观"那条红 | **CAUGHT**：`Tests 1 failed \| 10 passed (11)`，红的正是指名那条 |
| M3 把 `setThemeMode` 的非法值拒绝摘掉（整条 `if` 注释掉） | `useTheme.test.js` 变红 | **CAUGHT**：`Tests 3 failed \| 30 passed (33)`，红的恰是 `it.each` 的「非法模式 / 空值 / 非字符串 一律拒绝：不改主题、不写存储、返回 false」三条；`AppearanceSettings.test.js` 8 条不受影响（它走的是 `normalizeStoredMode` 那条独立判据） |

三处变异还原后均经 `md5sum` 与被变异前的备份逐字节比对确认一致（`App.vue` = `6c11fd67…`、
`useTheme.js` = `84d083f1…`），并 `grep -c "MUT-"` = 0 证无残留标记。

### 12.8 暗档像素门禁的起算点与人工审核前置

1.1 合并**之前**暗色不是用户可达态，跑暗档门禁无意义；审计 §5 已据此把阶段 0/1 限定为只跑浅档。
1.1 落地后，20 张 `*-dark` 基线成为真实回归面。**基线重建必须由人工审核 diff 图后批准，
禁止用 `--update-baseline` 自动收编**（AGENTS.md QM-4 第 4、7 条：基线必须与比对环境同源，
只能取自 CI 同一次渲染）。因此本批的验收项「切深色后 20 张 dark 基线成为真实态」在代码侧完成，
**基线侧留给下一次 CI 现场 + 人工批准**，不在本 PR 里伪造。

`tests/visual-testing/test-runner.js` 的 `_applyTheme` 注释同时被更正：原文写
"`data-theme` 是应用唯一的主题开关（`useTheme.js` 的 `applyTheme` 写的就是它）"，
在接线前那是**描述一条不存在的接线**；现改为如实写明写者在哪（App 引导 + 外观面板），
并把 77 处的旧读数换成本批当场重取的 72 处。

### 12.9 本批 QM-1 现场副产的两条既有缺陷（不在本批修，登记于此）

打包链本身全绿（`build:vue` rc=0、`electron-builder --dir` rc=0、asar 产物判据 13 条 PASS、
隔离 userData 启动 10 秒存活且 **stderr 0 字节**）。但把**子进程 stdout** 落盘回读（22490 字节）时
抓到两条与本批无关的既有问题；二者都不在 stderr，因此三层判据不会因它们变红 ——
这是 AGENTS.md 那条"黑名单宽度 = 已知故障的枚举"的另一面：**判据只看 stderr 时，
被 logger 打到 stdout 的真实故障会整体隐身**。

| # | 现场 | 判读 | 处置 |
|---|---|---|---|
| 1 | `[ERROR] Renderer [Unhandled Rejection]: 许可证权限不足，无法调用 onProgress` / `onTabEvent`（未激活许可证 + 全新 userData 首启） | preload 的 `createPermissionError` 对 `authenticated` 级方法是**同步 throw**，订阅类调用点不 catch ⇒ 未登录/未激活态下标签系统订阅静默失败，且错误演成 unhandled rejection。与 AGENTS.md「electron-bridge 权限错误同步 throw 变 rejected promise、fallback 分支永不执行」同族 | 后续任务：订阅类 API 在未激活态应**不注册且不抛**（而非抛出去无人接）。先取证"未激活态是否真需要标签系统"，再决定降级提示还是静默；不得以"日志难看"为由直接吞掉 |
| 2 | `[ERROR] sqlite-wrapper all() error: no such column: external_id \| SQL: SELECT platform, external_id, COUNT(*) AS n FROM viral_library` | 查询列与建表列不同源（缺迁移或缺列） | 后续任务：按 QM-5 五步处理（根因 → 逃逸 → 系统性漏洞 → 回归锁 → 预防），不在本批顺手改 |

**方法论落点两条**：① QM-1 的启动验证在本仓**必须同时回读子进程 stdout**（不只是 stderr），
理由不是"stderr 判据写错了"，而是它对该形态结构性失明；已写进执行记录的取证清单。
② 产物级判据的第一条必须是**通路自证** —— 本批前两轮共 9 个 FAIL 全部来自 asar 键形用错
（`listPackage` 返回 `\dist\assets\x.js`，`extractFile` 只认去前导分隔符、内部保留反斜杠的
`dist\assets\x.js`；而单级路径 `dist/index.html` 用正斜杠恰好能读，于是错形被一次巧合坐实），
**0 个来自产物本身**。把探针失明读成"功能没进包"，就是把工具的故障上报成同事的缺陷。



---

## 13. 阶段 1.2（audit-6）运营公告横幅挂载 + top-inset 通道

### 13.1 缺陷本体

`AnnouncementBanner.vue` 已写好，数据链也齐备（ops-center 后台 → 主进程 `OpsCenterSync`
运行时状态 → `opsCenterSyncRuntime` IPC → `useOpsCenterRuntime`），
但**全仓零引用**（唯一命中是 `MemberCenter.vue:210` 的一句注释）。
于是"运营公告"这一产品能力在桌面上不存在：后台发了，客户端什么都不显示。

### 13.2 为什么不能"挂一行"（本批的真实成本）

`WebContentsView`（浏览器标签 / 登录标签里加载的外部网页）是**原生图层**，
压在渲染进程 DOM 之上，CSS `z-index` 对它无效；它的纵向位置由主进程侧的镜像常量
`BROWSER_CHROME_TOP = 76`（TabBar 36 + NavBar 40）算出。横幅插在 DOM 流里之后：

- 不处理 ⇒ 浏览器标签激活时横幅被外部网页**整块盖住**（2026-09-23「设置弹窗被盖住」同形）；
- 用浮层互斥（`suspendEmbeddedViews`）处理 ⇒ 错用机制：那是**模态**浮层的办法，
  常驻横幅若挂起内嵌视图，等于"为了显示一条公告而永久隐藏网页内容"。

正解是第三条：**给内嵌视图加一个 top-inset 通道**，让主进程按横幅实际高度把网页区域整体下移。

### 13.3 通道四处同步（与 `setSidebarWidth` 同构，一处不缺）

| 落点 | 改动 |
|---|---|
| `electron/services/view-bounds.js` | 新增 `TOP_INSET_DEFAULT=0` / `MAX_TOP_INSET=200` / `normalizeTopInset(px)` / `contentTopWithInset(inset)`（`BROWSER_CHROME_TOP + 下移`，单一实现） |
| `electron/services/webview-manager/layout.js` | `setTopInset(px)`（非法值回落 0 + `log.warn` 出声）→ 同步 `AuthViewManager` → `_repositionAll()`；`_repositionAll` 取 `computeEmbeddedViewBounds(win, sidebarWidth, contentTopWithInset(this._topInset))` |
| `electron/services/webview-manager/ipc-handlers.js` | 注册 `page-manager:set-top-inset`（带既有 `withSenderCheck`） |
| `electron/preload/page-manager.js` | 暴露 `pageManager.setTopInset(px)`（bundle 由 `pnpm run build:preload` 重打，产物 gitignore） |
| `electron/services/webview-manager/index.js` | 构造期 `this._topInset = TOP_INSET_DEFAULT`（默认值只 import view-bounds 一份） |
| `electron/services/auth-view-manager.js` | `_topInset` + `setTopInset` + `_positionView` 喂 `contentTopWithInset(this._topInset)` |

**刻意不做的一条**：不给 `qrcode-login.js` 加 `setTopInset`。它自「独立窗口承载」迁移后
`_sidebarWidth` / `setSidebarWidth()` 只是签名兼容（该文件 48-51 行自己写着），
再加一个没人读的 setter 就是本仓最忌的"死接线"。这条反向选择由
`webview-manager-top-inset.test.js` 的一条**反向锁**钉住（断 `_qrCodeLogin` 上没有 `setTopInset`）。

### 13.4 交互与数据校验

| 场景 | 判据 | 行为 |
|---|---|---|
| 无公告 | `visibleAnnouncements.length === 0` | 整块 `v-if` 不渲染，上报 0 |
| 有公告 | 每条 `role="alert"`，容器 `role="region"` + `aria-label` | 上报 `offsetHeight` |
| 用户关闭 | 写 `localStorage['announcement-banner-dismissed']`（键 `id:<id>`，无 id 的老数据退化为 `severity:title:content` 摘要） | 该条消失；全部关完 ⇒ 上报 0 |
| 维护类公告 | `severity === 'maintenance'` | **不给关闭按钮**（系统维护不是可忽略的打扰） |
| 未知 severity | 不在 `info/warning/maintenance` | 徽标如实回落「提示」档，配色 class 仍按原值保留（可归因） |
| 读压制记录抛错 | `localStorage.getItem` throw | 忽略并照常渲染（读不到历史记录 ≠ 没有公告） |
| 写压制记录抛错 | `setItem` throw | 关闭动作照常完成，只落盘失败 |
| 卸载 | `onBeforeUnmount` | 若残留非 0 上报 ⇒ 补发 0（释放穷尽，与浮层互斥合同同一条纪律） |
| 主进程收到非法值 | NaN / 负 / 字符串 / > 200 | 回落 0 + `log.warn` 出声；不得产生 NaN 坐标 |

`normalizeTopInset` 与 `normalizeSidebarWidth` 的**判据方向相反**是有意为之：
侧边栏宽度 0 会让内嵌视图 `x=0` 盖住侧边栏（2026-09-15 事故），故 0 非法；
而顶部下移的 0 正是"没有常驻 chrome"的收口态，把 0 判非法就是永久错位。
两条都在各自函数注释里写明理由，并有 `view-bounds-top-inset.test.js` 的第一条断言钉住。

### 13.5 显示项与提示文字（新增 5 键，zh/en 成对）

| key | zh | en |
|---|---|---|
| `announcement.regionLabel` | 运营公告 | Service announcements |
| `announcement.closeLabel` | 关闭公告 | Dismiss announcement |
| `announcement.severityInfo` | 提示 | Notice |
| `announcement.severityWarning` | 重要提醒 | Important |
| `announcement.severityMaintenance` | 系统维护 | Maintenance |

同批下线 `useOpsCenterRuntime.js` 里的 `SEVERITY_LABELS = { info: '提示', ... }`
（composable 持有中文字面量，Gate 7 的 zh/en 成对约束管不到它）。
`useOpsCenterRuntime.test.js` 的导出完整性锁随之改判，并加一条墓碑断言
（`not.toHaveProperty('SEVERITY_LABELS')`）防止原形态回来。
CJK 基线读数因此从 1175 降到 **1171**。

### 13.6 回归锁与变异反证

| 锁 | 条数 | 盯的是 |
|---|---|---|
| `electron/services/view-bounds-top-inset.test.js` | 18 | 数值口径：0 合法、非法回落、上限是真数、bounds 的 y/height 联动、极窄窗口高度取 0 不为负 |
| `electron/services/webview-manager-top-inset.test.js` | 17 | 接线：真触发重排、同值不重复重排、挂起态只隐藏不写 bounds、登录视图收到、**扫码视图不得收到**、通道三处同步的源锁（ipc / preload / layout 任一缺失即红） |
| `src/components/AnnouncementBanner.test.js` | 9 | 组件：region/alert 语义、徽标走 locales（切 en 跟着变）、未知档位回落、维护类无关闭按钮、关闭后报 0、无 id 老数据关得掉、卸载还 0、存储抛错不变砖 |
| `src/App.announcement-inset.test.js` | 2 | **装配锁**：以生产方式挂 App，公告存在 ⇒ 横幅渲染且 `pageManager.setTopInset(64)` 被调；无公告 ⇒ 报 0 |
| 既有回归（AGENTS 强制面） | 164 + 33 | `overlay-view-suspension` / `shell-mode-6a` / `shell-mode-6b` / `webview-manager` / `auth-view-manager` / `view-bounds` + `NotFound` / `SettingsDialog` / 两条 App 装配锁 |

变异 **M4**：删掉 `App.vue` 里的 `<AnnouncementBanner @inset="onChromeInset" />` 一行 ⇒
装配锁 **2 条全红**（`Tests 2 failed (2)`），其余文件不受影响；还原后 `md5sum` 与备份逐字节相同
（`da61287e…`），`grep -c "MUT-START"` = 0。

### 13.7 同批修掉的两条 CI 红（属"实现变了、锁/夹具跟着改"，不是放宽）

1. **`QG Browser E2E` 22 条路由 + 6 条集成流全红**：根因在 E2E 的 IPC 夹具
   `tests/e2e/helpers/ipc-mock.js:162` 写的是 `firstRunCheck ⇒ ok({ isFirstRun: true, setupDone: false })`。
   阶段 1.4 的引导判定按契约读到 `setupDone:false` 就把**每一条**路由重定向到 `/first-run`，
   于是 22 条路由用例集体在测向导页（现场证据：日志里反复 `navigated to …/#/first-run`）。
   夹具同时带着一个真实响应里从来不存在的字段 `isFirstRun`。
   改法：夹具与真桥逐字同形（`{ setupDone }`）并按场景语义取 `true`（E2E 测的是已引导的存量用户），
   补 `firstRunComplete`、删 `onFirstRunStatus`（该方法本批已随推送通道删除）。
   这是 AGENTS.md「契约夹具不得替对方剥壳」的第四种落点：**夹具凭空多带一个字段**。
2. **`QG Static` Gate 16 字体档位红**：`views/NotFound.vue:59` 用了 `font-size: 40px` 字面量
   （阶段 1.7 新建该文件时，这条门禁还没进 main；合并 origin/main 后才第一次被执行）。
   改为七档里最大的一档 `var(--font-size-xxl)`（32px），不为一个 404 大字开第八档。

### 13.8 QM-1 证据（本批重跑）

`verify-worktree-deps` OK → `build:vue` rc=0 → `electron-builder --win --dir` rc=0
（唯一非致命告警 `.playwright-browsers` 缺 ⇒ 产物不含捆绑 Chromium，如实记为"安装包证据不完整"）
→ asar 产物判据 **12 条全 PASS**（layout/`view-bounds`/ipc/preload/auth 五处改动逐个读产物内容，
外加 renderer chunk 含 `announcement-banners` 与 `ui:theme`，并各带一条通路自证）
→ 隔离 userData 启动 10 秒：**ALIVE=true、STDERR_BYTES=0、红线命中 0、进程计数 0→0、
PARENT_ENV_DEFECT=none**。子进程 stdout（22461 字节）按 §12.9 的新口径一并回读，
其中 `Unhandled Rejection: 许可证权限不足（onProgress/onTabEvent）` 与
`no such column: external_id` 两条既有缺陷仍在，登记状态未变（本批不顺手修）。
