# PRD — 侧边栏「新版本」入口（运行时更新提示 + 点击退出安装）

> **立项日期**: 2026-09-14 | **状态**: 已交付（分支 `codex/update-available-badge`）
> **关联**: [PRD.md](./PRD.md) §7.4.6 版本发布策略 / F8 系统功能 · [PRD-SIDEBAR-BOTTOM-USER-MENU-2026-09-14.md](./PRD-SIDEBAR-BOTTOM-USER-MENU-2026-09-14.md) §4.3 footer 顺序契约
> **影响模块**: `apps/desktop/electron/services/auto-updater.js`、`apps/desktop/electron/ipc-handlers/update.js`、`apps/desktop/src/composables/useAutoUpdate.js`、`apps/desktop/src/components/SidebarUpdateButton.vue`、`apps/desktop/src/components/UpdateNotification.vue`、`apps/desktop/src/layouts/MpSidebar.vue`

---

## 一、背景与问题

用户已安装的桌面应用在运行期间，如果官方发布了新版本，当前实现只能通过**应用启动 3 秒后弹出的模态对话框**（`UpdateNotification` 的 UiModal）告知用户：

| 现状 | 问题 |
|------|------|
| 启动即弹模态框 | 打扰：用户当前正在操作（发布/创作）时被强制打断，必须先处理弹窗 |
| 弹窗只有启动瞬间出现 | 错过：用户关掉弹窗后，运行期间不再有任何更新提醒；长时间不重启就永远看不到新版本 |
| 弹窗在 App 全局层，不在导航壳内 | 入口不可预期：用户不知道「哪里能看有没有新版本」 |
| 两步操作（下载更新 → 立即重启安装） | 步骤多：需要先下载、再点第二次才安装 |

用户诉求（原话）：

> 需求调整，用户已安装的应用，在运行时，如果应用有新版本发布，左下角的菜单按钮的上方，显示出一个有新版本的提示按钮，图标和文字做成和截图一样或类似（但颜色按目前的设计标准）。点击后退出应用，安装新版本。

### 参考视觉

截图元素：**圆形底 + 向上箭头图标**，下方文字「**新版本**」，整体为紧凑的方形小条目（深色底、绿色前景）。
本项目落地要求：**图标形态与文案沿用截图，配色改用项目设计标准**（主色 `var(--primary)` = `--color-primary` #5048E5），不使用截图中的绿色。

---

## 二、目标与范围

### 2.1 目标

1. **常驻可达**：运行期间只要检测到新版本，侧边栏底部登录菜单按钮**正上方**常驻显示「新版本」入口，直到用户完成安装或版本变为最新。
2. **一键完成**：点击入口即完成「下载 → 退出应用 → 安装」，无需二次确认弹窗。
3. **不打扰**：不再自动弹出更新模态框打断用户操作；必要时仅用非阻塞提示条告知结果。

### 2.2 范围内（In Scope）

- 侧边栏底部「新版本」入口的显隐、四态文案、点击行为与无障碍属性。
- 主进程「点击即安装」链路：已下载直接安装；未下载则先下载、下载完成自动退出安装。
- 新增 IPC 通道 `update:install-now` 与 preload 方法 `updateInstallNow`。
- 移除「检测到新版本自动弹模态框」，保留全局结果提示（已是最新 / 更新失败）。
- 详细规格、交互、文案、验收标准与回归测试。

### 2.3 范围外（Out of Scope，明确不做）

- 不改动运营后台版本发布策略（`force_version` / `gray_ratio` / `min_version`）的判定逻辑，见 PRD §7.4.6。
- 不新增「稍后提醒 / 忽略此版本」能力（入口仅在无更新时消失，不做用户可关闭）。
- 不做增量（差量）更新、不做下载限速/断点续传参数调整。
- 不在入口内展示完整发布说明（releaseNotes）；版本号通过悬浮提示暴露。
- 不删除既有 `update:check` / `update:download` / `update:install` 通道（对外 IPC 合同保持兼容）。

---

## 三、用户故事

| 编号 | 角色 | 故事 | 验收 |
|------|------|------|------|
| US-1 | 内容运营者 | 我一边在跑发布任务，一边希望知道有没有新版本，但不希望被弹窗打断 | 运行期间侧边栏底部出现「新版本」入口，页面不出现模态框 |
| US-2 | 内容运营者 | 我看到「新版本」后点击它，希望它自己下载完就装上，不用我去点第二次 | 点击后入口显示下载进度；下载完成应用自动退出并安装 |
| US-3 | 内容运营者 | 我不确定这个入口点了会发生什么，希望有明确说明 | 悬浮提示与点击后提示均说明「点击后退出应用并安装」「完成后将自动退出应用并安装」 |
| US-4 | 内容运营者 | 网络不好时点击失败，我希望可以重试，而不是入口消失 | 失败后入口保持显示并变为「重试安装」，再次点击可重试 |
| US-5 | 内容运营者 | 我已经有最新版本时，不希望总看到一个无意义的入口 | 无可用更新时入口不渲染（DOM 中不存在） |

---

## 四、功能逻辑

### 4.1 状态机（唯一真相源）

主进程 `auto-updater.js` 维护：

| 变量 | 含义 | 写入时机 |
|------|------|---------|
| `_availableUpdate` | 最近一次检测到的新版本信息 `{version, releaseDate, releaseNotes}` | `update-available` 置值；`update-not-available`（且无待安装请求）清空 |
| `_updateDownloaded` | 该版本安装包是否已下载完成 | `update-available` 置 `false`；`update-downloaded` 置 `true` |
| `_installRequested` | 用户已点击「新版本」，下载完成后自动退出安装 | `installNow()` 受理时置 `true`；`update-downloaded` 触发安装后、`error` 事件后复位 |

渲染层 `useAutoUpdate` 的状态（模块级共享单例，应用壳内全局唯一）：

| `badgeMode` | 触发事件 | 入口表现 |
|-------------|---------|---------|
| `hidden` | 初始 / `not-available` / `skipped-by-policy` | 不渲染 |
| `available` | `available` | 图标 + 「新版本」，可点击 |
| `downloading` | `installing` / `downloading` | 图标 + 「下载中 N%」，禁用 |
| `ready` | `downloaded` | 图标 + 「重启安装」，可点击 |
| `error` | 用户点击后收到 `error` | 图标 + 「重试安装」，可点击 |

> 关键区分：**后台静默检查失败**（用户没点过）不切换为 `error`，入口保持原样（通常是 `hidden`），避免用网络噪声打扰用户；**用户主动点击后的失败**才进入 `error` 并提供重试。

### 4.2 主进程 `installNow()` 决策表

| 前置状态 | 行为 | 返回 |
|---------|------|------|
| `_updateDownloaded = true` | 直接 `quitAndInstall()` | `true` |
| 检测到新版本、未下载、未请求 | `_installRequested = true`，推送 `installing`，调用 `download()`（`autoDownload=false` 时）；置 `true` 后重复点击直接返回 | `true` |
| 检测到新版本、`autoDownload = true`（`force_version` 策略已自动下载中） | 只置 `_installRequested`，**不重复触发下载**（避免二次下载） | `true` |
| 未检测到新版本 | 推送 `not-available`（入口自动隐藏） | `false` |

`update-downloaded` 事件中：若 `_installRequested` 为真 → 推送 `installing` 并立即 `quitAndInstall()`（用户点击即视为同意退出）。

`error` 事件中：若本次错误来自用户点击的安装流程 → **原样回传 `error`**（供入口重试）；否则保持既有降级语义（网络/GFW/清单缺失 → 静默 `not-available`）。

### 4.3 流程时序

```
应用启动
  └─ UpdateNotification(挂载) → useAutoUpdate.start()（幂等）
        └─ 3s 后 updateCheck() → update:check → autoUpdater.check()
              ├─ 有更新 → update-available ──► badgeMode=available ──► 侧边栏出现「新版本」
              ├─ 无更新 → update-not-available ► badgeMode=hidden + 右下角提示条「当前已是最新版本」(4s)
              └─ 策略跳过 → skipped-by-policy ► badgeMode=hidden（静默）

用户点击「新版本」
  └─ handleInstallNow()
        ├─ 前置：ElMessage.info「正在下载新版本，完成后将自动退出应用并安装」
        ├─ badgeMode=downloading（本地即时反馈）
        └─ update:install-now → autoUpdater.installNow()
              ├─ 已下载 → quitAndInstall()（应用退出并安装）
              └─ 未下载 → download() ──► downloading(N%) ──► downloaded
                                            └─ _installRequested → quitAndInstall()（自动退出安装）
```

---

## 五、数据与校验

| 项 | 来源 | 校验/约束 | 失败处理 |
|----|------|----------|---------|
| 新版本号 `version` | electron-updater `update-available` 的 `info.version` | 仅用于展示；不参与比较（是否「更新」由 electron-updater 判定） | 缺失时提示文案里版本显示为空，不阻断 |
| 当前版本 | `app.getVersion()` | 仅在版本策略（`min_version`/`force_version`）比较时使用 | 缺失按空字符串处理 |
| 安装包完整性 | electron-updater 自带签名/校验 | 校验失败会走 `error` 事件 | 校验类错误**不**静默降级（`isSignatureFailure` 分支），直接上报 |
| IPC 调用来源 | `withSenderCheck` | 只接受应用内可信来源（打包态为 `file://` dist 内页面；开发态 localhost:5174） | 返回 `{code:-3, message:'未授权的调用来源'}` |
| IPC 返回形态 | `{code, data, message}` | `data` 为布尔受理结果 | `code !== 0` → 渲染层进入 `error`（可重试） |
| 重复点击 | 渲染层 `installRequested && badgeMode==='downloading'` 忽略 + 主进程 `_installRequested` 幂等 | 双重防抖，保证只下载一次 | 第二次调用直接返回，不产生副作用 |

---

## 六、交互逻辑

### 6.1 入口位置与 DOM 顺序

侧边栏底部 `footer` 子元素顺序（新增条件渲染项）：

```
[0] 服务连接信息（SidebarServiceStatus）
[1] 「新版本」入口（SidebarUpdateButton，仅 badgeMode !== 'hidden' 时渲染）
[2] 登录菜单按钮（ProfileMenu banner）
[3] 升级弹窗（UpgradeModal，仅打开时存在）
```

- 无可用更新时 `[1]` 不渲染，原顺序契约（`[0] 服务信息 → [1] 登录 banner`）不变。
- 入口位于**登录菜单按钮正上方**（满足需求原话），不遮挡菜单展开面板（面板在入口之下、向上展开）。

### 6.2 交互行为

| 动作 | 结果 |
|------|------|
| 悬浮入口 | 显示原生 `title` 提示（含版本号与「点击后退出应用并安装」说明） |
| 键盘 Tab 聚焦 | 显示主色描边（`:focus-visible`，鼠标点击不出现描边） |
| Enter / Space | 等同点击 |
| 点击（`available` / `ready` / `error`） | 弹出非阻塞提示「正在下载新版本，完成后将自动退出应用并安装」→ 调用 `update:install-now` |
| 点击（`downloading`） | 无反应（按钮 `disabled`、`cursor: progress`、`aria-busy=true`） |
| 下载完成 | 应用自动退出并安装（无二次确认） |
| 点击失败 | 入口文案切「重试安装」，右下角出现告警条「更新失败：<原因>」；再次点击重试 |
| 版本变为最新 | 入口消失 |

### 6.3 响应式

| 视口 | 表现 |
|------|------|
| > 900px（常规侧边栏 200px） | 图标在上、文字在下，整宽条目 |
| ≤ 900px（图标栏 68px） | 隐藏文字标签，只保留图标（`aria-label` 仍完整）；避免文字挤压导航 |

---

## 七、显示项与提示文字

### 7.1 入口显示项

| 显示项 | 内容 | 说明 |
|--------|------|------|
| 图标 | 实心圆（`fill: var(--primary)`）+ 白色向上箭头（stroke 2，圆头圆角） | 形态对齐参考截图 |
| 主文案 | 新版本 / 下载中 N% / 重启安装 / 重试安装 | 见 7.2 |
| 悬浮提示 | 见 7.2 `title` 列 | 含版本号 |
| 可访问名 | 「应用有新版本，点击后退出应用并安装新版本」 | `aria-label`，缺 key 时回退英文 `New version available` |
| 尺寸 | 整宽、纵向排列，图标 24×24，文字 11px/600 | 与侧边栏条目风格一致 |
| 配色 | 文字与图标底 `var(--primary)`；底色 `rgba(80,72,229,.08)`，悬浮 `.16` | **不使用截图绿色** |

### 7.2 i18n 文案（zh / en 成对，`update.*`）

| key | 中文 | 英文 |
|-----|------|------|
| `badge` | 新版本 | New version |
| `badgeReady` | 重启安装 | Restart to install |
| `badgeRetry` | 重试安装 | Retry install |
| `badgeDownloading` | 下载中 {percent}% | Downloading {percent}% |
| `badgeTitleAvailable` | 发现新版本 v{version}，点击后退出应用并安装 | Version v{version} is available. Click to quit the app and install it. |
| `badgeTitleReady` | 新版本 v{version} 已下载，点击后退出应用并安装 | Version v{version} has been downloaded. Click to quit the app and install it. |
| `badgeTitleDownloading` | 正在下载新版本 v{version}，完成后将自动退出应用并安装 | Downloading v{version}; the app will quit and install automatically when done. |
| `badgeTitleRetry` | 上次安装未完成，点击重试 | The previous install did not finish. Click to retry. |
| `badgeAriaLabel` | 应用有新版本，点击后退出应用并安装新版本 | A new version is available. Click to quit the app and install it. |
| `installingHint` | 正在下载新版本，完成后将自动退出应用并安装 | Downloading the new version; the app will quit and install automatically when done. |
| `latestVersion` | 当前已是最新版本 | You are on the latest version |
| `failedPrefix` | 更新失败： | Update failed: |

> **实现约束（必须遵守）**：`src/i18n/index.js` 把所有字符串消息转成 Message Function 以避免运行时编译（Electron CSP 禁 `new Function`），**普通字符串不会插值**。带参数的消息必须写成 `(ctx) => ... ctx.named('version')` 形式；写成 `'{version}'` 会把占位符原样显示在界面上。

---

## 八、错误与边界处理

| 场景 | 期望行为 |
|------|---------|
| 启动自动检查遇到网络不可用 / GFW / `latest.yml` 404 / 缺少 `app-update.yml` | 静默降级为「当前已是最新版本」提示条（保留既有语义，只提示一次），入口不出现 |
| 用户点击后下载失败（网络类） | 回传 `error` → 入口变「重试安装」+ 告警条；不显示「已是最新版本」误导文案 |
| 用户点击时主进程已无可用更新（如并发复查覆盖） | `installNow()` 返回 `false` 并推送 `not-available` → 入口消失 |
| 点击瞬间进程异常（`installNow` 抛错） | IPC 返回 `{code:-1, message}` → 渲染层进入 `error`（可重试） |
| 安装请求进行中，并发复查返回 `not-available` | **不清空**待安装状态（`_installRequested` 为真时跳过清空），安装流程不被打断 |
| 窗口重载（Ctrl+R）后 | 渲染层以「主进程 `installing` 事件」作为 `installRequested` 依据，仍能展示下载中而非误判为未点击 |
| 强制版本策略（`autoDownload=true`）已在后台下载 | 点击不重复触发下载，只登记安装意图；下载完成自动退出安装 |
| 全屏路由 `/first-run` | 该分支不渲染侧边栏，入口不出现（不阻塞首次运行引导） |
| 窄屏（≤900px） | 仅图标，功能不变 |

---

## 九、非功能要求

- **可访问性**：原生 `<button>`；`aria-label` 全态可用；`aria-busy` 标记下载中；`:focus-visible` 主色描边；窄屏隐藏文字仍保留可访问名。
- **无新增动画**：不引入 `@keyframes`，不引用 `--skeleton-*`（避免与骨架屏唯一来源契约冲突），尊重既有 reduced-motion 约定（无过渡依赖）。
- **样式隔离**：样式写在组件 `scoped` 内，不使用 `var(--skeleton-*)`，颜色只取设计令牌 `var(--primary)`。
- **i18n**：新增用户可见文案全部走 `t()`；渲染端非 locales 文件**零新增硬编码中文**（CI Gate 7 `--cjk` 基线增量式拦截）。
- **IPC 合同**：preload 暴露面 ↔ 主进程 handler 一一对应（CI Gate 6 `check-ipc-bridge.js`）；`update:install-now` 加入 `PUBLIC_CHANNELS` 与 `preload/access-control.js` 的 `PUBLIC_METHODS`（与既有 `update:*` 同级别：无需登录，但要求可信来源）。
- **不破坏像素门禁**：入口仅在检测到新版本时渲染，CI/基线环境无更新 → 不改变既有截图基线。

---

## 十、验收标准

| 编号 | 验收项 | 判定方式 |
|------|--------|---------|
| AC-1 | 无可用更新时侧边栏不渲染「新版本」入口，footer 顺序为 [服务信息, 登录 banner] | `MpSidebar.test.js` 断言 |
| AC-2 | 检测到新版本时入口渲染在服务信息与登录 banner 之间（登录菜单按钮上方），文案「新版本」 | `MpSidebar.test.js` / `SidebarUpdateButton.test.js` |
| AC-3 | 点击入口调用 `update:install-now` 并提示将自动退出安装 | `SidebarUpdateButton.test.js` |
| AC-4 | 未下载时点击 → 先下载（`downloadUpdate` 调用一次）→ 下载完成自动 `quitAndInstall()` | `auto-updater.test.js` |
| AC-5 | 已下载时点击 → 直接 `quitAndInstall()`，不再下载 | `auto-updater.test.js` |
| AC-6 | 下载中重复点击只触发一次下载（渲染层 + 主进程双幂等） | `auto-updater.test.js` / `useAutoUpdate.test.js` |
| AC-7 | 点击后失败 → 入口变「重试安装」可重试；后台静默失败不影响入口 | `useAutoUpdate.test.js` / `SidebarUpdateButton.test.js` |
| AC-8 | 下载中入口显示百分比且不可点击 | `SidebarUpdateButton.test.js` |
| AC-9 | 入口样式使用设计主色（`var(--primary)`），不含绿色硬编码；窄屏隐藏文字；无新增 keyframes | `SidebarUpdateButton.test.js` 源码契约 |
| AC-10 | IPC 通道 `update:install-now` 拒绝不可信来源、可信来源正常调用、异常返回统一 envelope | `ipc-handlers/update.test.js` |
| AC-11 | preload 暴露 `updateInstallNow` 且与 handler 对应 | `preload.test.js` / `ipc-contract.test.js` / Gate 6 |
| AC-12 | 检测到新版本不再自动弹模态框 | `UpdateNotification.vue` 已无 UiModal；模板仅保留结果提示 |

---

## 十一、测试映射（场景 → 测试）

| 场景 | 测试文件 | 用例 |
|------|---------|------|
| 入口显隐与四态文案 | `src/components/SidebarUpdateButton.test.js` | 无更新不渲染 / 出现「新版本」/ 已最新不渲染 / 圆形底+向上箭头 / 点击调用并提示 / 已下载「重启安装」/ 下载中「下载中 50%」且禁用 / 失败「重试安装」可重试 / 样式契约 ×3 |
| 状态机与点击流程 | `src/composables/useAutoUpdate.test.js` | 初始态 / available / installing / downloading / downloaded / 点击后失败可重试 / 后台失败不显示 / not-available / 4s 自动隐藏 / policy-min-version / skipped-by-policy / 点击即安装 / 重复点击 / 错误码 / 异常 / 重试成功 / start 幂等 / cleanup |
| footer 顺序契约 | `src/layouts/MpSidebar.test.js` | 无更新时顺序不变 + 有更新时插入位置 |
| 主进程安装链路 | `electron/services/auto-updater.test.js` | 无更新不受理 / 未下载先下载 / 重复点击幂等 / 下载完成自动退出安装 / 已下载直接安装 / 强制策略不重复下载 / 点击后网络错误回传 error / 并发 not-available 不中断 / 后台失败静默降级 |
| IPC 合同 | `electron/ipc-handlers/update.test.js`、`tests/ipc-handlers.test.js`、`electron/tests/ipc-contract.test.js` | 拒绝外部来源 / 可信来源受理 / data=false / 异常 envelope / 注册存在 / 通道与 handler 对应 |
| preload 暴露面 | `electron/preload.test.js` | `updateInstallNow` 存在（SYSTEM_METHODS / 合并 API 计数） |

---

## 十二、后续可选项（本次不做）

1. 入口内展示 `releaseNotes`（更新说明）或进入「关于/版本」页查看详情。
2. 「稍后提醒」：允许用户收起入口，下次启动再提示。
3. 下载完成前的「取消安装」入口（当前点击即视为同意，仅提示不可撤销）。
4. 运行中发布任务存在时，安装前二次确认（当前依赖用户主动点击表达同意）。
