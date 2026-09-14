[codeagent-wrapper]
  Backend: claude
  Command: claude -p --dangerously-skip-permissions --setting-sources  --output-format stream-json --verbose -
  PID: 34152
  Log: D:\Temp\codeagent-wrapper-34152.log
  Web UI: http://localhost:49586
  Session-ID: a321fc03-2ae5-4d35-95ca-5f5fe7f9f370
分析报告已完成，并写入 `.ccg/tasks/member-center-avatar-entry/analysis-claude.md`。以下是结构化报告全文。

---

# 会员中心 + 左上角头像入口 — 设计方案

> 前置：代码现状已按你给的清单核实（读了 sidebar/router/identity store/useIdentity/IdentityMenu/App.vue/UpgradeModal/identity API/electron identity 服务），未重复探索历史。

## 0 · 结论速览

- **独立路由页 `/member-center`**：认同，不弹窗。内容量大、要复用 UpgradeModal / 本地许可证，页面形态最合适。
- **左上头像 ProfileMenu**：认同"未登录直接登录弹窗"，但**收敛为按状态分派**——只在 `signed_out/expired` 直登；`disabled/error` 弹菜单展示原因，避免"点了一下没反馈/登录窗弹不起来"的二次困惑。
- **「更多」加会员中心**：认同，页面不加登录守卫（`ACCESS-CONTROL-MATRIX` 只管写操作）。
- **设备标识卡 → 砍掉**。`deviceId` 是主进程内部概念（`identity-service-factory.js:54`、`entitlement-service.js`），renderer 的 identity state 不暴露；展示它必须新增 IPC → 改 electron main + preload → 触发 QM-1 整包门禁，性价比为负。
- 上传头像/改名、绑手机/邮箱、设备管理、消费记录 → **全砍**（均需后端写接口，明确不新增后端）。

## 1 · 功能清单评审（P0/P1/P2）

| 级别 | 功能 | 数据来源（已核实） | 价值/成本 | 要点 |
|---|---|---|---|---|
| **P0** | `/member-center` 路由页 + 未登录空态/登录按钮 | — | 高/低 | 读操作，不加守卫 |
| **P0** | 账号信息卡（首字母头像/昵称/用户名/状态/切换/退出） | `identity.user` + `status` | 高/低 | 全本地，已就绪 |
| **P0** | 版本会员卡（免费/试用/Pro、daysRemaining、升级） | `license.info` + `UpgradeModal.vue` | 高/低 | 原样复用 UpgradeModal |
| **P0** | 左上头像 `ProfileMenu`（未登录直登/已登录弹菜单） | identity store | 高/中 | 根因修复 = 绑定点击 + 必有反馈 |
| **P0** | 「更多」菜单加「会员中心」 | — | 中/低 | router-link，未登录可进 |
| **P1** | 登录权益卡（plan/features/source/expiresAt） | `identity.entitlement` | 中/低 | 离线 `source=offline` badge 有价值 |
| **P1** | 配额卡（有则显，无则隐） | `entitlement.quota` | 中/低 | ⚠️ `normalizeState` 现在**剥离 quota**，需透传（1 处小改） |
| **P1** | 关于卡（版本号） | package.json | 中/极低 | 客服排障刚需 |
| **P1** | `IdentityMenu` 补「会员中心」菜单项 | 同 | 中/低 | 首页右上与左上入口行为对齐 |
| **P2** | 头像图片（`user.picture` + onerror 回退首字母） | `user.picture` | 低/中 | 外链有 CSP 风险，v1 先用首字母 |
| **砍** | 设备标识（脱敏） | 需新 IPC | 低/高 | renderer 拿不到 deviceId；做=动主进程=整包门禁 |
| **砍** | 上传头像/改名、绑手机/邮箱、安全设置、设备管理 | 需后端 | — | 违反"不新增后端接口" |
| **砍** | 消费记录/订单/发票 | 需后端+本地无订单数据 | 低/高 | UpgradeModal 是模拟支付，无沉淀 |
| **砍** | 站内通知中心、数据导出 | 独立功能块 | — | 超出会员中心职责，另立任务 |

## 2 · 交互方案评审

**结论：采用"按状态分派"混合方案。** 认同"未登录点头像直开登录弹窗"，但加状态边界：

| `status` | 点击行为 |
|---|---|
| `signed_out` / `expired` | **直接 `signIn()`**（打开既有 OIDC 登录窗）；失败 → 展开菜单展示 store error |
| `signing_in` / `loading` | 忽略（防连点；store `runExclusive` 已串行，UI 层不再发） |
| `authenticated` / `offline_authenticated` / `refreshing` | 弹菜单：会员中心 / 切换账号 / 退出登录 |
| `disabled` | 弹菜单 +「身份服务未启用」，**不**直登 |
| `error` | 弹菜单（错误文本 + 登录/重试），不直弹系统窗 |

**理由**：
- **可用性**：未登录用户最高频诉求就是登录，直达少一步；且 IdentityMenu 未登录态本来就把「登录」做成高亮主按钮，"点身份区=登录"的隐喻已存在。
- **可发现/防"没生效"**：登录窗是主进程 modal `IdentityAuthWindow`（520×720），感知明确。原 bug 根因就是静态 `div` 无任何点击反馈——修复的最低标准即"点击必有明确反馈"。
- **误触**：直登的代价是误触会弹系统窗；缓解 = 头像在角落 + loading 护栏 + disabled/error 分流。**统一弹菜单**误触代价更低，但让 90% 用户的常规路径多一步，不值。
- **一致性**：右上 IdentityMenu 弹菜单、左上直登——两处入口各自局部自洽（左上是"头像"意象动作性强，右上带显性「登录⌄」下拉 affordance），可接受。v1 不重构 IdentityMenu 行为（已有完整单测），P1 只补菜单项。
- **根因确认**：`mp-profile` 是 `div`，不可聚焦、无 handler；修复 = 换为 `<button>` 语义的 ProfileMenu（aria-haspopup/menu/expanded）。

## 3 · 技术方案

### 文件划分

**新建**
```
apps/desktop/src/views/MemberCenter.vue          # 页面
apps/desktop/src/views/MemberCenter.test.js
apps/desktop/src/components/ProfileMenu.vue      # 左上头像触发器+下拉（按状态分派）
apps/desktop/src/components/ProfileMenu.test.js
apps/desktop/src/composables/useDropdownBehavior.js  # 下拉通用交互
```

**修改**
```
apps/desktop/src/layouts/MpSidebar.vue     # 静态 .mp-profile → <ProfileMenu />；moreItems 加会员中心
apps/desktop/src/router/index.js                 # 注册 /member-center
apps/desktop/src/stores/identity.js              # normalizeState 透传 quota（P1）
apps/desktop/src/locales/zh.js + en.js           # memberCenter 命名空间（成对）
apps/desktop/src/components/IdentityMenu.vue     # (P1) 补会员中心项 + 测试
```

**本轮不动**：`electron/`（无 QM-1 门禁）、`UpgradeModal.vue`、`IdentityMenu` 行为。

### 关键点
- **路由**：`{ path: '/member-center', name: 'MemberCenter', component: () => import('@/views/MemberCenter.vue') }`，无守卫。进入后 `MpModuleNav` 因非首页消失 → 页面必须自带登录/切换/退出（账号卡正是此职责）。
- **useDropdownBehavior**：`{ open, toggle, close, openAndFocusFirst }`，内部处理外部点击/Esc/Tab/方向键环游（复用 IdentityMenu 语义）。ProfileMenu 消费它，**不复制逻辑**。
- **ProfileMenu 触发器**：未登录 `⚡ + 登录`，已登录 `首字母 + displayName + licenseLabel`；≤900px 折叠态沿用现有 media query 隐藏文字保头像，面板 `min-width:220px` 向左展开不越界。
- **i18n**：新增 `memberCenter` 命名空间，含 `{days}`/`{used}/{total}` 占位符，en 侧必须同 key 同占位符；**所有新文案必须走 locales**（`check-locale-sync --cjk` 会扫 renderer 硬编码中文，现有 IdentityMenu 中文属已基线化存量，新增不在基线内）。

### 测试清单
| 文件 | 用例 |
|---|---|
| `ProfileMenu.test.js` | signed_out 非 loading → 点击触发 signIn 恰一次、不开菜单；loading → 不再触发；authenticated → 菜单含三项+键盘导航+Esc 关闭；disabled → 弹菜单不 signIn；expired → 直登；signIn 失败 → 菜单展示 error |
| `MemberCenter.test.js` | signed_out 空态+登录；authenticated 渲染昵称/版本；disabled 显示说明但版本卡仍正常；offline 显示 badge；升级按钮开 UpgradeModal |
| `stores/identity.test.js` | normalizeState 透传 quota；缺 quota 时无该字段 |
| `IdentityMenu.test.js`（P1） | 补「会员中心」项与跳转断言 |
| `i18n.test.js` | 现有对称断言自动覆盖新 key |

## 4 · 风险与边界

- **登录弹窗复用**：无需新建弹窗，`store.signIn() → identitySignIn()` IPC 即拉起既有 `IdentityAuthWindow`。因是系统级窗口而非页内 overlay，误触更重 → 支撑"仅 idle 未登录直登、disabled/error 走菜单"的边界。
- **并发/状态竞争**：store `runExclusive` 已串行化，`loading` 护栏防重；组件卸载不中断操作（store 全局持有），`useDropdownBehavior` 负责 `onBeforeUnmount` 清理全局监听。
- **降级矩阵**：`disabled` → 版本/关于卡正常、权益卡隐藏；`offline_authenticated` → 缓存昵称 + 离线 badge、数据来自本地签名快照；`expired` → 缓存名 + 重登按钮高亮；`/api/v1/me` 不可达 → 权益降级离线快照；**页面永不因身份异常白屏**（有数据才渲染）。
- **打包验证**：无主进程改动，不触发 QM-1；必须过 `build:vue` + vitest + `check-locale-sync --cjk` + `--pair-base`（zh/en 需同一提交成对改动）；`{placeholder}` 须 zh/en 一致。
- **其他**：`quota` 透传要形状校验；侧边栏折叠态面板 z-index 高于 workspace；「更多」新项建议 `t('memberCenter.title')` 而非内联中文。

## 5 · 最终推荐方案（与倾向的差异点）

**总体与你的倾向一致，三处修正：**
1. **砍设备标识卡**（你原方案含"安全与设备：设备标识脱敏"）——renderer 无 deviceId，做需新增 IPC + 主进程改动，违反成本原则。
2. **未登录直登加状态边界**——`disabled/error` 分流到菜单，避免直登失败无反馈。
3. **不动 IdentityMenu 行为**——抽 `useDropdownBehavior` 给新组件用；IdentityMenu 已有完整单测，不因其重构，P1 只补「会员中心」项。

**实施顺序**：M1（P0）路由+页面+更多入口+locales → M2（P0）useDropdownBehavior + ProfileMenu + sidebar 替换 → M3（P1）权益/配额/关于卡 + IdentityMenu 补项 → M4（P2）头像图片（CSP 安全回退），设备专项不做。

---

需要的话，我可以接着把 M1 的 `MemberCenter.vue` 骨架、`useDropdownBehavior` 实现或 i18n key 初稿直接写出来。

---
SESSION_ID: a321fc03-2ae5-4d35-95ca-5f5fe7f9f370
��一个 [role="menuitem"]
```
内部：监听 document click（外部关闭）+ keydown Esc/Tab + panel 内 ArrowUp/Down/Home/End 环游焦点（复用 IdentityMenu 现有实现语义）。`ProfileMenu` 用它；`IdentityMenu` 保持原样，不强制重构。

### 3.4 ProfileMenu 行为逻辑（核心）
```js
const { status, user, displayName, loading, signIn, switchAccount, signOut } = useIdentity()

const isDirectLoginStatus = computed(() =>
  !loading.value && ['signed_out', 'expired'].includes(status.value))

async function handleTriggerClick() {
  if (loading.value) return                     // 防并发/连点
  if (status.value === 'disabled') return dropdown.open()   // 展示"身份服务未启用"，不直登
  if (status.value === 'error') return dropdown.open()      // 展示错误 + 登录/重试项
  if (isDirectLoginStatus.value) {
    const ok = await signIn()                   // 打开已有 OIDC 登录窗
    if (!ok) dropdown.open()                    // 失败 → 展开菜单展示 store.error
    return
  }
  dropdown.toggle()                            // authenticated/offline/refreshing
}
```
- **不复制 IdentityMenu 逻辑**：身份操作全部走 store（signIn/switchAccount/signOut），下拉交互走 `useDropdownBehavior`。
- 触发器渲染：未登录显示 `⚡` + 「登录」；已登录显示 `首字母` + displayName + licenseLabel（保持 sidebar 视觉，替换为 `<button>`）。68px 折叠态保留头像点击（现有 media query 已隐藏 `.mp-profile-copy`，ProfileMenu 需同规则收缩，面板 `min-width: 220px` 向内伸展开不越界）。

### 3.5 i18n key 结构（zh/en 成对；`{placeholder}` 必须一致）
```js
memberCenter: {
  title: '会员中心',
  signIn: '登录',
  guest: '未登录',
  loginHint: '登录后可同步账号权益，会员中心将展示你的登录数据。',
  signInRequired: '登录后查看账号信息与权益',
  statusAuthed: '已登录',
  statusGuest: '未登录',
  statusOffline: '离线模式',
  statusExpired: '会话已过期',
  disabled: '身份服务未启用',
  logout: '退出登录',
  switchAccount: '切换账号',
  account:  { title: '账号信息', nickname: '昵称', username: '用户名' },
  license:  { title: '版本会员',
              free: '免费版', trial: '试用版', pro: '专业版',
              current: '当前方案', daysRemaining: '剩余 {days} 天',
              upgrade: '升级 Pro', upgradeHint: '升级解锁全平台发布、批量发布、定时发布、AI 辅助等能力' },
  entitlement: { title: '登录权益', plan: '方案', source: '来源', sourceOnline: '在线', sourceOffline: '离线',
                 expiresAt: '过期时间', features: '已解锁功能', empty: '暂无权益数据' },
  quota: { title: '配额', empty: '暂无配额信息', value: '{used} / {total}' },
  about: { title: '关于', version: '版本' },
}
```
> 注意：CI 的 `i18n.test.js` 断言 zh/en 叶子键完全对称 + `{param}` 一致性；`check-locale-sync.js --cjk` 扫描 renderer 硬编码中文——**所有新文案必须走 locales，不得硬编码中文**（现有 IdentityMenu 的中文属于已基线化存量，新增不在基线内）。

### 3.6 测试清单
| 文件 | 用例 |
|---|---|
| `ProfileMenu.test.js` | ① signed_out+非loading → 点击触发 `signIn` 恰好一次、**不开菜单**；② signed_out+loading → 点击**不再**触发；③ authenticated → 点开菜单含 会员中心/切换账号/退出登录，方向键→首个 menuitem 聚焦，Esc 关闭；④ disabled → 展开菜单、显示说明、不调 signIn；⑤ expired → 直接 signIn；⑥ signIn 失败 → 菜单展开展示 error |
| `MemberCenter.test.js` | ① signed_out → 空态 + 登录按钮，点登录调 `signIn`；② authenticated → 昵称/用户名/版本类型渲染；③ disabled → 显示"身份服务未启用"，版本卡仍正常；④ offline_authenticated → 显示离线 badge；⑤ 升级按钮打开 UpgradeModal（轻量断言） |
| `stores/identity.test.js` | 新增：`normalizeState` 透传 `entitlement.quota`；缺 quota 时不产生该字段 |
| `IdentityMenu.test.js`（P1） | 若补「会员中心」项，补断言该项存在且跳转 `/member-center` |
| `i18n.test.js` | 由现有对称断言自动覆盖新增 key（不改） |

---

## 4. 风险与边界

### 4.1 登录弹窗复用（关键）
- 登录弹窗 = 主进程 `IdentityAuthWindow`（modal BrowserWindow 520×720）。**无需新建弹窗**，`store.signIn()` → `identitySignIn()` IPC 即会拉起它，与 IdentityMenu 完全同一条路。
- 因为它是**系统级窗口**而非页内 overlay，误触体验比下拉重 → 支撑 §2 的"只在 idle 未登录态直登、`disabled/error` 走菜单"边界。
- 登录中若用户去点别处：`runExclusive` 已把并发操作串行化，第二次调用直接 return false，不会开两个窗口。

### 4.2 signIn 并发 / 状态竞争
- store 有 `activeOperation` 串行锁 + `loading`。ProfileMenu 点击先查 `loading`。
- 中途路由跳转导致 ProfileMenu 卸载：store 全局持有操作，闭包回调仍会正常 `applyState`；无泄漏风险（`onBeforeUnmount` 清全局 keydown/click 监听，由 `useDropdownBehavior` 负责）。
- 成功后需注意：直登场景菜单没开，无需关闭；菜单场景（如 switchAccount 成功）关闭菜单。

### 4.3 离线 / disabled / 后端不可用降级矩阵
| 场景 | 会员中心表现 | 头像点击 |
|---|---|---|
| `disabled`（身份服务未配置/API unavailable） | 版本卡+关于正常；账号卡显示"身份服务未启用"；权益卡隐藏 | 弹菜单 + 说明，不直登 |
| `offline_authenticated` | 账号卡显示缓存昵称 +「离线模式」；权益卡 `source=offline` badge，数据来自本机签名快照 | 弹菜单（可正常退出/切换） |
| `expired` | 显示缓存名 +「会话已过期」+ 高亮登录按钮 | 直接 signIn 重登 |
| `/api/v1/me` 暂时不可达 | 权益/配额降级为离线快照或隐藏，页面不崩 | 不阻断本地 license 升级 |
- 页面**永不因身份异常白屏**：所有卡片按"有数据才渲染"，无数据不渲染留占位。

### 4.4 打包 / CI 验证注意点
- **无主进程改动**：不触发 QM-1 整包门禁；只跑 renderer 侧验证。若 CI 对 locale/失败有 `--pair-base origin/main`，**zh.js 与 en.js 必须在同一提交内成对变更**。
- 必须通过：`pnpm run build:vue`、`vitest`、`node .github/scripts/check-locale-sync.js --cjk`、`--pair-base`。
- 新增 `{placeholder}` 占位符（`daysRemaining`/`quota.value`）须与 en 完全一致，否则 `i18n.test.js` 失败。
- 若 P2 做头像 `user.picture` 外链，先确认 renderer CSP；失败必须回退首字母。建议 v1 直接首字母，P2 再说。

### 4.5 其他边界
- `quota` 透传：`normalizeState` 目前只保留 plan/features/source/expiresAt；加 `...(isObject(state.entitlement.quota) || isFinite(...) ? { quota } : {})`，形状校验避免污染 store。
- 侧边栏折叠态（≤900px）：`ProfileMenu` 触发器需随现有 media query 隐藏文字保留头像，面板定位 `left:0` 向右展开，z-index 需高于 workspace。
- `moreItems` 现为内联中文（尚未 i18n）；新加「会员中心」建议直接 `t('memberCenter.title')`，避免新增硬编码中文触发器。

---

## 5. 最终推荐方案（与倾向的差异点）

**总体与用户倾向一致**，三处修正：

1. **设备标识卡 → 砍**（原方案含"安全与设备：设备标识脱敏展示"）。renderer 无 deviceId，做需新增 IPC+主进程改动，违反成本原则。（`identity.state` 不含 deviceId，已核实。）
2. **未登录直登 + 状态边界**（原方案"未登录直接 signIn"成立，但建议 `disabled/error` 分流到菜单，避免直登失败无反馈）。
3. **不动 IdentityMenu 行为**（原方案提"提取公共 composable 复用"）：抽 `useDropdownBehavior` 给新组件用；IdentityMenu 已有完整单测，本次不因其重构，仅 P1 补「会员中心」项。这样把变更面控制在新增组件 + 2 个布局/路由小改，风险最低。

**实施顺序**
- **M1（P0，核心）**：`/member-center` 路由 + `MemberCenter.vue`（空态/账号卡/版本卡/UpgradeModal）+ 侧边栏 `moreItems` 入口 + locales + 测试。
- **M2（P0，交互）**：`useDropdownBehavior` + `ProfileMenu.vue` + sidebar 头像替换 + `ProfileMenu.test.js`。
- **M3（P1，增强）**：权益卡 + 配额卡（store quota 透传）+ 关于卡 + `IdentityMenu` 补「会员中心」项。
- **M4（P2，可选）**：头像图片（CSP 安全回退）、离线 badge 细节。**设备专项明确不做**。

**变更文件汇总**
- 新增：`views/MemberCenter.vue`、`components/ProfileMenu.vue`、`composables/useDropdownBehavior.js`、两个 test。
- 修改：`layouts/MpSidebar.vue`、`router/index.js`、`stores/identity.js`（quota）、`locales/zh.js` + `en.js`、（P1）`components/IdentityMenu.vue`。
- 不动：`electron/`（无 QM-1）、`UpgradeModal.vue`、`IdentityMenu` 行为。