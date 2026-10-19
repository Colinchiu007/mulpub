# 会员中心（MemberCenter）模块深度审查与优化方案

> 审查日期：2026-10-19
> 范围：`apps/desktop/src/views/MemberCenter.vue`、`apps/desktop/src/views/member-center/*`（7 个子视图 + labels + entitlement-gate）、`apps/desktop/src/stores/member.js`、`apps/desktop/src/stores/identity.js`、`apps/desktop/src/components/UpgradeModal.vue`、入口组件（MpSidebar / ProfileMenu / Dashboard）、`apps/desktop/src/styles/member-center.css`、`apps/desktop/src/locales/member-center/*`
> 性质：只读审查，无代码变更。结论均已逐文件核实到行号。

---

## 1. 模块现状全景

### 1.1 数据流（现状中健康、应保留的部分）

```
主进程 identity 服务
  ├─ identityGetState / state-changed 推送
  │     └─ stores/identity.js 归一化（白名单字段，绝不透传任意对象）
  │           ├─ entitlement: { plan, features[], source?, expiresAt?, quota? }
  │           └─ plans: 服务端 GET /api/v1/plans 下发的三档价目
  │                 三态：null=取价失败/未取到；[] =服务端无套餐；有数据=真实价
  │                 （设计约定：不提供硬编码金额兜底）
  └─ 商务接口（经 ipc-handlers/identity.js 的 memberApiHandler）
        ├─ identityNotifications / identityNotificationsMarkRead
        ├─ identitySessions / identitySessionsRevokeOthers
        └─ identityRedeemCode → 服务端 POST /api/v1/redeem（subscription-service.js，
              行锁 + 条件更新双保险幂等；错误码 REDEEM_CODE_FORMAT/NOT_FOUND/USED/
              DISABLED/EXPIRED）
```

### 1.2 组件结构

- **壳层** `views/MemberCenter.vue`：登录门控（disabled / 未登录 / 已登录三态）+ 左侧 7 栏导航 + 右侧 `<component :is>` 动态子视图。
- **子视图注册表** `views/member-center/views.js`：Overview / AccountSecurity / Subscription / OrdersBilling / UsageQuota / Messages / HelpSupport。
- **数据 store** `stores/member.js`：通知、设备会话、激活码核销；electron-bridge 单轨桥接，浏览器直开时安全降级。
- **入口**（全部路由跳 `/member-center`）：
  - 侧边栏 `MpSidebar.vue:81`（banner @upgrade）
  - 头像菜单 `ProfileMenu.vue:266-269`（goMemberCenter）
  - 仪表盘 4 处锁定面板 `Dashboard.vue:96/122/126/168`（goToMemberCenter）

---

## 2. 问题清单（按严重度，全部经行号核实）

### P0 — 功能性错乱（用户直接看到坏的东西）

#### P0-1 价目区 + 兑换区挂在壳层，七个 tab 全部重复渲染

`MemberCenter.vue:83-154`：`<section class="member-center-plans">` 与 `<section class="member-center-redeem">` 位于 `<component :is="activeView" />` **上方**，属于壳层而非任何子视图。

**后果**：价目与兑换区块被错误地挂在壳层，**7 个 tab 全部恒定显示**；「订阅与方案」tab 下与权益卡同屏构成三块相邻的方案相关内容，视觉重复感最强。这是用户感知「混乱、错乱」的主源。（2026-10-19 对抗评审 MISS-8 修正措辞：是跨 tab 恒定显示，非每 tab 重复渲染。）

#### P0-2 价目/兑换区块完全没有 CSS

`styles/member-center.css`（全文 363 行）只定义了 nav/card/list/quota/about 等；**没有任何一条** `.member-center-plans*`、`.member-center-redeem*`、`.member-center-single` 规则（全仓 grep 证实：模板引用 15 处，样式定义 0 处）。

**后果**：价目是裸 `<h3>+<ul>`，兑换是浏览器默认样式的 `<input>+<button>`，结果提示（is-success / is-info / is-error 三种 tone）无配色——视觉上是「没写完就上线」的半成品。

#### P0-3 `standard` 档不认识，标准版用户看到「自定义方案」

`member-center/labels.js:36-42` 的 `planLabelOf()` 只映射 pro/trial/free，`standard` 落入 `planCustom`（"自定义方案"）。而服务端定价唯一真源 `packages/api-publish-engine/src/auth/plan-matrix.js:23` 明确是 **free / standard / pro 三档**（standard=标准版 ¥59/月）。

**后果**：standard 用户同屏自相矛盾——价目区显示「标准版（当前）」（服务端 label），权益卡却写「自定义方案」（前端映射缺失）。

**对抗评审补充（MISS-6，升级为可观察症状）**：standard 用户还面临**跨模块口径矛盾**——Dashboard 经 `hasFeatureOf(entitlement, 'dashboard_full')` 对 standard 放行全部看板面板（Dashboard.vue:96/122/126），会员中心壳层却对其显示「升级 Pro」CTA（MemberCenter.vue:296 `plan !== 'pro'`）。同一用户在两处得到「特权已满」与「需要升级」两种说法。

**对抗评审补充（MISS-4，三重 free 兜底叠加）**：`identity.js:52`（plan 缺失默认 'free'）→ `MemberCenter.vue:202` currentPlanId 兜底 'free' → `labels.js:37` planLabelOf `value || 'free'`——三层任何一层被触发，用户都会被错误标注「免费版（当前）」；服务端快照 plan 字段异常或未来新增档位时，与 planCustom「自定义方案」同屏矛盾。

#### P0-4 权益/配额直接渲染服务端原始代码

- `Subscription.vue:17-21`：`entitlement.features` 原样 `<li v-for>`，中文界面出现 `✓ cloud_publish`、`✓ ai_write`、`✓ schedule_batch` 等英文 feature 码。
- `UsageQuota.vue:26-35`：quota 的原始 key 直接当标签；对象值直接 `JSON.stringify` 渲染。**注意（评审 C1-09 更正）：quota 真实键形是 plan-matrix.js:160-165 派生的 `${feature}_monthly`（cloud_publish_monthly / ai_write_monthly / video_create_monthly / official_credit_monthly），本地化映射必须按此真实键形设计并与派生段对齐核对——MemberCenter.test.js:69 mock 里的 credits/used 是测试自造形状，不得作为映射依据**。

内容层面最刺眼的「不完善」。

#### P0-5 错误反馈断链（三处，两种形态）

| 位置 | 形态 |
|------|------|
| `Messages.vue:22` | `memberStore.error` **原样渲染**——用户看到裸错误码 `MEMBER_REQUEST_FAILED`；且 error 是 store 级共享字段，兑换失败后切到消息 tab 会串显 |
| `AccountSecurity.vue` 模板 | 「退出其他设备」失败时（`revokeOtherSessions` 返回 false，error 已写入 store）**模板根本不渲染 error**，点击后静默无反馈 |
| 兑换（对照组） | `MemberCenter.vue:226-234` 已做服务端错误码→i18n key 映射——正确做法已有先例，另两处没跟上 |

#### P0-6 两套互相冲突的定价 UI

壳层升级 CTA 打开 `UpgradeModal.vue`，其中是**硬编码**的「免费版 ¥0 / Pro 版」两张卡 + 硬编码 feature 清单 + 「付费通道筹备中」；而壳层自己又渲染服务端三档价目。同一「升级」动作两处口径（2 档 vs 3 档、写死 vs 服务端）。组件内注释（`UpgradeModal.vue:26-29`）自认「权威源是服务端 plan-matrix 的三档订阅，经 GET /api/v1/plans 下发、会员中心展示」，但组件本体没照做。且 modal 内无兑换码入口，用户得关掉 modal 再去壳层找。

> 背景（已核实，非本审查新发现）：本地激活已整体不可用——`license:activate` 通道随 2026-10-17 remove-buyout-license **整体删除**（license-access-control.js:13；buyout-removal.contract.test.js:107-108 机械断言白名单不得残留），`license:activate-trial` 在 `ipc-handlers/license.js:45` 对打包环境拒收。激活已迁移服务端核销；UpgradeModal 里的「激活码已迁移」文案与试用入口关闭（`trialAvailable = import.meta.env.DEV`）均为已知正确决策。（2026-10-19 评审 C1-07 更正「拒收」表述：activate 是删除，非拒收。）

### P1 — 信息架构与交互混乱

| # | 问题 | 证据 |
|---|------|------|
| P1-1 | 卡片三重复制：Overview 与 AccountSecurity 是**同一张账号卡**（头像+姓名+状态徽章逐字段相同）；Overview「版本与许可证」卡与 Subscription 权益卡内容同源重复 | Overview.vue:3-41 / AccountSecurity.vue:3-21 / Subscription.vue:3-26 |
| P1-2 | 空洞 tab：订单 tab 纯占位「敬请期待」；帮助 tab 有 `checkUpdates` 文案却未接线任何更新检查 | OrdersBilling.vue:3-6；HelpSupport.vue:11-14；locales zh/en:97 死键 |
| P1-3 | 登录状态文案三套实现且互相矛盾：**触发条件为 `status==='error'` 且 `user.sub` 存在（hasSessionIdentity 为真）的窗口态**——此刻 ProfileMenu 显示「已连接」（ProfileMenu.vue:201），labels.js `statusLabelOf` 显示「需要重试」（labels.js:51，zh.js:103）；纯 error 态（无 user）两者一致 | ProfileMenu.vue:195-205 vs labels.js:44-54 |
| P1-4 | 会话列表用 `index === 0` 判「当前设备」，完全依赖服务端返回顺序，契约脆弱；服务端返回结构中亦无 is_current 字段（主进程仅透传 `/api/v1/me/sessions`） | AccountSecurity.vue:31-37；ipc-handlers/identity.js:60 |
| P1-5 | member store 无生命周期复位：`$reset()` 定义了但全仓无人调用（grep 证实仅 1 处定义）。登出/切换账号后通知、会话、error 全部残留 | member.js:105-111 |
| P1-6 | 未读角标只在点进消息 tab 后刷新（`activate('messages')` 才 loadNotifications）；进入会员中心不预取，侧栏角标恒 0 | MemberCenter.vue:311-315 |
| P1-7 | tab 状态不进 URL：从 Dashboard 锁定面板跳来只能落 overview，无法深链「订阅与方案」 | router/index.js:38 |
| P1-8 | 兑换输入无本地格式校验/maxlength：`canSubmitRedeem` 只查非空，文案说「16 位激活码」（ABCD-EFGH-JKMN）却允许任意串到服务端被打回。服务端校验正则真实存在（subscription-service.js:202-204），本地完全可前置同型校验省一次往返 | MemberCenter.vue:221-223 |
| P1-9 | `currentPlanId` 兜底 `'free'`：entitlement 尚未加载时价目区会把 pro 用户标成「免费版（当前）」 | MemberCenter.vue:202 |
| P1-10 | 升级 CTA 用 `entitlement.plan !== 'pro'` 硬判档位——`entitlement-gate.js:7-8` 的注释**点名批评**了这种写法，模块自己没执行自己定的规矩。注：standard≠pro 时显示升级 CTA 恰好当前是"歪打正着"（standard 确实可升级），但它是**按错误理由工作**，pro 判断换成任何新档位（如 pro_max）立即失效。**⚠️ 对抗评审 MISS-1 实证：不能简单改用 feature 判定**——standard 与 pro 的 features 数组**逐字节相同**（plan-matrix.js:150-153 派生只含布尔条件，两档全命中），`hasFeatureOf` 无法区分；`/api/v1/plans` catalog 亦无 rank 字段（plan-matrix.js:175-187），「plan 序比较」同样缺数据源 | MemberCenter.vue:294-298；plan-matrix.js:150-153,175-187 |

### P2 — 细节打磨

- 疑似死键（以 grep 产物为准生成，生成命令：`grep -rn "memberCenter\.\(viewMemberCenter\|featureCount\|statusUnknown\|checkUpdates\|accountCardEmpty\|accountCardEmptyHint\|entitlementEmpty\|licenseProExpired\)" apps/desktop/src --include="*.vue" --include="*.js" | grep -v locales`——应零命中）：`viewMemberCenter`、`featureCount`、`statusUnknown`、`checkUpdates`、`accountCardEmpty`、`accountCardEmptyHint`、`entitlementEmpty`、`licenseProExpired`（zh/en.js:71，2026-10-19 评审 C1-05 补）。清理需 zh/en 成对删（CI Gate 7）。
- 价目区 `plansLoading` 只用于 `aria-busy`，无骨架屏；**`memberStore.loading` 已被 AccountSecurity.vue:26 用于撤销按钮禁用，但消息列表侧无任何加载态消费**（2026-10-19 评审 C1-02 更正：原表述「无消费方」不成立）。
- `.member-center-single`（MemberCenter.vue:31/39 引用）是无定义死类。
- `defineExpose` 泄漏三个 store 实例与多个方法（仅为测试便利；子视图实际不消费）。identityStore 引用靠 `void identityStore` 保活（MemberCenter.vue:324），属可收敛项。
- 兑换成功后 `identityStore.load()` 在 identity 侧 `runExclusive` 被占用时静默返回 false（identity.js:112-123），权益刷新可能被吞，UI 不感知。
- 概览「升级提示」固定显示 upgradeHint，未按档位/权益收敛。
- **测试盲区（逃逸链）**：现有 MemberCenter.test.js 锁了登录门控/CTA/导航切换，但**没有任何**用例覆盖：价目三态渲染、兑换结果四分支、standard 标签、feature/quota 本地化、Messages/AccountSecurity 错误展示。P0-1~P0-5 全部从这条链漏掉——无单元断言 → 无视觉回归 → 无 E2E 覆盖该页。views/member-center 下测试文件共 3 个：Overview.test.js、entitlement-gate.test.js、entitlement-gate.feature-key.test.js；AccountSecurity/Subscription/Messages/UsageQuota/OrdersBilling/HelpSupport 六个子视图零测试（2026-10-19 评审 C1-06 更正计数）。

---

## 3. 目标信息架构（重组方案）

```
壳层 MemberCenter.vue（瘦身）
├─ header：标题 + 登录按钮（未登录态）
├─ 全局错误条（identity error + IdentityDiagnostics，置顶一次，不插在内容中间）
├─ 左导航 7 栏 + 未读角标（进入页面即预取 unreadCount）
└─ 右侧 <component :is>（唯一内容区；activeKey 写入 ?section= 查询参数）

子视图职责重划：
├─ Overview 概览      = 账号摘要行 + 权益摘要行 + 快捷入口卡（跳订阅/消息/帮助），
│                        不再整卡复制（消除 P1-1）
├─ AccountSecurity    = 账号卡（唯一所在）+ 设备会话（服务端 is_current 标记当前设备
│                        + error 展示修复）
├─ Subscription 订阅  = 权益卡 + ★套餐对比（服务端 plans 迁入）+ ★兑换码入口（迁入）
│                        + 升级说明（消除 P0-1）
├─ OrdersBilling      = 保留占位但明确空态设计（图标+一句解释），或暂时从导航隐藏
├─ UsageQuota         = quota key→i18n 映射 + 数值格式化，未知 key 原样回退
├─ Messages           = 列表 + i18n 化错误（复用兑换的 code→key 映射模式）
└─ HelpSupport        = 版本 + 帮助入口；checkUpdates 要么接线要么删键

UpgradeModal：退役
  侧边栏/头像/仪表盘升级入口统一 → /member-center?section=subscription
  （若需保留弹窗形态，改为渲染服务端 plans 三档 + 直达兑换码，不再硬编码 2 张卡）
```

### 3.1 配套改造点

1. **feature/quota 本地化**：新增 `memberCenter.feature.cloud_publish`、`memberCenter.quota.credits` 等映射（zh/en 成对），子视图经 `t()` 渲染；未知 key 回退原始串（服务端未来加新 feature 不至于开天窗）。
2. **状态文案单一真源**：labels.js `statusLabelOf` 提为 `useIdentityLabels()` composable；ProfileMenu 弃用自己的那份映射（消除 P1-3 两套矛盾实现）。**统一方向裁决（评审 C1-08）**：取 ProfileMenu 语义——composable 的 `statusLabelOf` 增加可选 `hasSessionIdentity` 参数，error 态按「有会话身份→已连接（操作可重试）/ 无身份→需要重试」二分；**禁止**统一成 labels.js 的无条件「需要重试」（那会把网络抖动但会话有效的用户状态从「已连接」退化，引入新误导）。**升级 CTA 的档位判定（对抗评审 MISS-1 修订后的两步走）**：① Phase 1 短期把 `plan !== 'pro'` 改为**正向名单** `['free','standard'].includes(entitlement?.plan)`（显式过渡写法，含 entitlement 缺失中性处理）；② **契约前置任务**：服务端 plan-matrix 增加 rank 字段（或 pro 专属 feature）→ identity 归一化白名单同步透传 → 渲染层 CTA 改用 `hasFeatureOf(rank)` 替换 ①。当前 features 契约下 standard/pro 不可区分（plan-matrix.js:150-153），**禁止在无契约改动时直接改 feature 判定**；「plan 序比较」备选已删除（评审 C1-04：渲染层无 PLAN_IDS 顺序契约，硬编码序会造出第二套判定）。
3. **member store 生命周期**：壳层 watch identity 登录态，`signed_out / disabled` 或切换账号（user.sub 变化）时调用 `memberStore.$reset()`。
4. **planLabelOf 补 standard**（P0-3 直修）。
5. **兑换体验**：`maxlength` + 宽松格式前置校验，本地校验失败立即提示不浪费请求；成功后自动切到 subscription 并高亮权益卡。**⚠️ 对抗评审 MISS-9 修正（推翻本条原正则）**：服务端真实校验是**排除易混淆字符**的字母表 `'ABCDEFGHJKMNPQRSTUVWXYZ23456789'`（subscription-service.js:12-14），先前给出的 `[A-Z0-9]` 宽松版**并非同型**——会放过服务端必拒的含 O/I/0/1 的码，前置校验形同虚设。前端必须采用与服务端**逐字符相同**的字符类；正则本体应由 `packages/api-publish-engine` 导出共享常量（或经契约镜像锁引用），**禁止两端各自手写字面量**。
6. **会话契约**：短期方案——主进程 `identitySessions` 归一化时按请求附带的 X-Device-Id（member-api-service.js:61）比对 device_id 标记 `is_current`；前端弃用 `index === 0`。**边界（评审 C1-13）**：`is_current` 全 false 是合法态（当前设备行未 upsert 或不在返回列表），前端此时显示「未识别当前设备」中性态，**禁止回退顺序猜测**；主进程侧新增一条 IPC 测试覆盖该分支。主进程归一化改动需同步 IPC 测试。

---

## 4. 分阶段落地计划

### Phase 1（止血：收口全部 P0）

| # | 动作 | 对应问题 |
|---|------|----------|
| 1 | plans/redeem 区块迁入 Subscription 子视图；补齐全部缺失 CSS（或复用 `member-center-card` 包裹） | P0-1, P0-2 |
| 2 | `planLabelOf` 补 standard；去掉 `value \|\| 'free'` 兜底（plan 缺失/未知返回中性文案）；currentPlanId 无 entitlement 或 plan 未知时**不渲染「（当前）」标记** | P0-3, MISS-4 |
| 3 | feature/quota i18n 映射 | P0-4 |
| 4 | Messages / AccountSecurity 错误展示修复（error 码走 i18n 映射，不再跨 tab 串显）；revoke 失败的 revoked=0 语义反馈；**member.js 异步路径统一 try/catch 包装（LicensePermissionError → MEMBER_PERMISSION_REQUIRED 专属码 + i18n）** | P0-5, §8 MAJOR-1 |
| 5 | UpgradeModal 冲突消解：壳层不再渲染 modal（升级 CTA 行为见 §3.1 第 2 条两步走）；**modal 退役后 DEV trial 通路维持休眠**（不删 `licenseManager.activateTrial()`——license.js:37-44 注释已声明保留依据，不复活入口，处置写入 openspec/records）；doDeactivate 注销许可证入口随 modal 消失（DEV-only 能力，退役决策记录写明去向，暂不迁移）。**退役同步动作清单（评审 C1-03）**：① 删 `components/UpgradeModal.vue` 与 `UpgradeModal.test.js`；② `more-tests.test.js:23` 移除 import；③ `icon-usage.test.js:30` FILES 收敛清单移除登记行（否则 readFileSync ENOENT 整套件红）；④ MemberCenter.test.js:134-145 改写（见回归测试要求） | P0-6, MISS-5, C1-03, C1-12 |
| 6 | 升级 CTA 短期改正向名单 `['free','standard'].includes(entitlement?.plan)`；契约前置任务（rank 字段）单列 | P1-10, MISS-1 |

**回归测试要求**（补逃逸链）：壳层结构锁（plans 区块不得渲染于 shell 层）、planLabelOf('standard') 用例、planLabelOf(undefined) 中性态用例、feature 映射用例、Messages/AccountSecurity 错误展示用例、**MemberCenter.test.js:134 现有「CTA 打开 UpgradeModal」用例必须同步改写为「CTA 存在且不渲染 UpgradeModal」负向断言**（MISS-3）、DoD 增补壳层模板不得渲染 `<UpgradeModal>` 的结构锁（对称于 Dashboard.style-guard.test.js:278-283）。

### Phase 2（信息架构重排）

- Overview 改真概览 + 快捷入口；消除账号卡三重复制。
- `?section=` 深链同步；Dashboard 锁定面板 CTA 顺势改为 `section=subscription`。**安全改法（评审 C1-10）**：只改 `goToMemberCenter` 函数体为 `router.push('/member-center?section=subscription')`——模板 4 处 `@upgrade="goToMemberCenter"` 与 Dashboard.style-guard.test.js:278-290 的正向锁（恰好 4 处断言）**一律不动**，改模板即撞锁（改锁属「改谁来守门」，须人工过目）。
- member store 生命周期复位；未读角标进入页面预取。
- **未加载态中性化（评审 C1-11 扩面）**：`currentPlanId` 去掉盲目 `'free'` 兜底，且 `planLabelOf` 的 null 语义一并处理（null→中性占位而非 'free'），核对 labels.js 全部 null 回退路径（含 isProActiveOf:32 的 licenseStore 二值回退）——否则 entitlement 未加载瞬间价目区中性了、权益卡仍写「免费版」，矛盾换位置存在。
- 状态文案单一真源（composable 化，方向见 §3.1 第 2 条 C1-08 裁决）。

### Phase 3（打磨）

- 加载骨架：**补消息列表加载态（当前零消费）；会话侧已有 AccountSecurity.vue:26 的按钮禁用可复用**（评审 C1-02 修订后口径）。
- 死键清理（zh/en 成对；清单见 §2 P2，含 licenseProExpired）。
- 会话 `is_current` 契约（含主进程侧与 C1-13 全 false 边界）。
- 兑换成功高亮流转；`defineExpose` 收敛；`.member-center-single` 死类清理。
- 按 AGENTS.md 像素门禁做一轮视觉回归（member-center.css 变更属触碰计算样式类型：选择器差集命中数 → 带夹具采控制台 → 连拍互比 → 逐元素计算样式签名对比）。

### 流程提醒（执行时）

- 运行时代码改动：从 `scripts/start-mp-task.ps1 -TaskName member-center-revamp` 建 worktree，TDD 先行。
- locales 改动 zh/en 必须成对（CI Gate 7）。
- 新增 element-plus 组件需登记进 `src/plugins/element-plus.js` 按需清单（+测试机械锁）。
- 主进程归一化改动（is_current）同步 identity IPC 测试。
- 收口前 QM-1 打包验证 + 本地启动三层判据。

---

## 5. 审查自查记录（本文档成稿过程中的修正）

以下为审查过程中发现并当场修正的初稿结论，留档以免误导后续执行者：

1. **修正**：初稿将「本地激活码漏洞（任意串换永久 Pro）」列为风险项——经核实该漏洞已于 2026-10-07 修复（`license:activate` 通道随 2026-10-17 remove-buyout-license 整体删除，license-access-control.js:13；`license:activate-trial` 在 ipc-handlers/license.js:45 对打包环境拒收），激活已迁移服务端核销。本方案不需要任何安全修复动作。（评审 C1-07 更正「拒收」表述。）
2. **修正**：初稿建议 UpgradeModal「降级为订阅对比弹窗保留」——考虑到侧边栏/头像/仪表盘三个入口已全部改为路由跳会员中心、Dashboard.style-guard.test.js 已有「模板不得渲染 UpgradeModal」的结构锁，且 modal 内容与会员中心 Subscription 页完全重叠，**退役是更低复杂度方案**（少维护一套 UI）。保留弹窗仅作为备选。
3. **修正**：P1-8 兑换码格式校验——初稿仅凭文案「16 位激活码」推断，已核实服务端真实校验正则位于 subscription-service.js:202-204（`REDEEM_CODE_PATTERN`，形如 ABCD-EFGH-JKMN），本地前置校验应与服务端同型而非自造规则。**评审 C1-01 二次更正**：:202-204 是 apply 点，正则**定义在 :14**（字母表 `'ABCDEFGHJKMNPQRSTUVWXYZ23456789'` 显式排除 I/L/O/0/1）；本文初版给出的 `[A-Z0-9]` 宽松版恰是「自造」反例，已按共享常量方案重写（见 §3.1 第 5 条）。
4. **确认**：P0-5 中「AccountSecurity 不渲染 error」与 P1-4「index===0 判当前设备」经读模板核实成立；服务端 sessions 返回结构确无 is_current 字段（主进程 memberApiHandler 直接透传 API 响应）。
5. **补充**：审查中发现 `entitlement-gate.js`（2026-10-17 落地）已明确声明渲染层 feature 判定唯一出口，并在注释中点名批评 `plan !== 'pro'` 硬判——本方案 Phase 1 的 CTA 改造应直接复用该模块，不新造第二套判定。

## 7. 对抗性评审循环记录（2026-10-19，第 1 轮）

按 adversarial-review-loop 技能执行：proposal-v1 → 跨家族独立评审（claude CLI，与 GLM 家族交集为空）→ 逐条回应（rebuttal-v1，7 接受 / 1 部分接受含 1 处 L3 拒绝 / 0 全拒）→ 修订落回本文。产物配对落盘：`.ccg/adversarial/member-center-audit/`（task.json / proposal-v1.md / critique-v1.md / rebuttal-v1.md）。

**评审评分（v1）**：完整性 8 / 一致性 6 / 清晰度 8 / **可行性 5** / 安全性 8，最低分 5 < 8.0，converge=false → 产出本节修订。

**已并入正文的修订（7 项）**：

1. **MISS-1（L1，推翻原建议）**：升级 CTA「改用 feature 判定」在当前契约下**不可行**——standard/pro features 逐字节相同（plan-matrix.js:150-153）。改为两步走：短期正向名单 + rank 字段契约前置任务（§3.1 第 2 条、Phase1 动作 6、P1-10）。
2. **MISS-9（L1，推翻原正则）**：服务端兑换码字母表排除 I/O/0/1（subscription-service.js:12-14），原 `[A-Z0-9]` 宽松版非同型且与 §5 自查第 3 条自相矛盾。改为共享常量方案（§3.1 第 5 条）。
3. **MISS-2**：DoD 与 Phase1 深链断链 → DoD 措辞调整为「唯一目标 + 深链为 Phase2 增强项」。
4. **MISS-3**：MemberCenter.test.js:134 现有断言 modal 必红 → 列入 Phase1 回归测试改写项 + 壳层不渲染 UpgradeModal 结构锁。
5. **MISS-4**：三重 free 兜底叠加（identity.js:52 + MemberCenter.vue:202 + labels.js:37）→ Phase1 动作 2 扩展为中性态处理。
6. **MISS-6**：standard 用户 Dashboard 已解锁看板 vs 会员中心要升级的跨模块口径矛盾 → 并入 P0-3 后果段。
7. **MISS-5 / MISS-7 / MISS-8**：trial 休眠处置写入 Phase1 动作 5；P1-3 触发条件补清；P0-1 措辞精确化（恒定显示而非重复渲染）。

**评审员核实的正面结论（抽查 6 条 P0 全部为真）**：P0-1~P0-6 的行号证据全部经独立复核成立，模块「半成品感」的根因判断（壳层悬挂 + 零 CSS + 档位映射缺失 + 裸渲染）维持不变。

**收敛状态**：v1 可行性 5 分主要因「方案出口未闭环」（MISS-1/9），本轮已以 L1 证据闭环；待评审方对 proposal-v2 复核。若第 2 轮最低分 ≥ 8.0 或评审确认无新 critical，则收敛；否则继续至 maxRounds=3。CTO 扫描另发现的 **member.js 零 catch 缺陷**（见 §8）为评审双方首轮共同遗漏，已在 v2 补录。

## 7b. 第二评审通道记录（同家族子代理，2026-10-19，归入第 2 轮）

claude CLI 轮之外，另一名全新上下文的评审员（DWS subagent 8248db19）返回 **13 条独立发现**（critique-v1b / rebuttal-v1b 落盘于任务目录）。其中 3 条是指向本文**事实错误**的硬伤，全部经 proposer 亲自复核成立并已改正：

| # | 文档原表述 | 核证事实 |
|---|-----------|----------|
| C1-02 | 「memberStore.loading 无消费方」 | AccountSecurity.vue:26 撤销按钮 `:disabled` 在消费——已改写 |
| C1-05 | 死键清单 7 项 | 漏 `licenseProExpired`（zh/en.js:71，零消费）——已补入，并改为「以 grep 产物为准生成」 |
| C1-06 | 「两个测试文件」 | 实为 3 个（Overview / entitlement-gate / entitlement-gate.feature-key）——已更正 |
| C1-07 | 「activate 对打包环境拒收」 | activate 是**整体删除**（license-access-control.js:13 + contract 测试 ：107-108），:45 拒收只属 activate-trial——已改写 |
| C1-01 | §5-3 行号指向 :202-204 | 那是 apply 点，正则定义在 :14——已更正（与 claude 轮 MISS-9 同源，交叉证实） |

其余 8 条（C1-03 机械拦截面清单、C1-04 两案互斥〔与 MISS-1 交叉证实〕、C1-08 状态统一方向回退风险、C1-09 quota 键形取自 mock、C1-10 style-guard 正向锁避让、C1-11 labels.js null 回退扩面、C1-12 功能去向、C1-13 is_current 全 false 合法态）全部接受，修订分别并入 §3.1、Phase 1/2/3 与 §2。**13/13 接受、0 拒绝**。

> 方法论记录：两条独立通道（跨家族 claude CLI + 同家族子代理）在同一版文档上分别独立抓出同一处正则错误与同一处拦截面遗漏——独立复核交叉命中，显著提升了本文修订后的可信度。本目录 `.ccg/` 在共享根写保护放行清单内，产物随 docs-only PR 入库。

---

## 8. CTO 扫描补充发现（QM-2 维度，2026-10-19 第 2 轮自评新增）

> 按 AGENTS.md 阶段 6 CTO 扫描清单对模块取证：无 v-html/dangerouslySetInnerHTML、无生产 console.log、无 waitForTimeout 硬等待、无同步密码学原语（此四项干净）。以下为实测发现：

### 🟠 MAJOR-1 | member.js 全部异步路径零错误捕获（9 async / 0 catch）

**证据链**（逐层核实）：

1. `stores/member.js` 9 个 async 函数 **0 个 catch**：`runExclusive`（:58-65）只有 try/finally，`loadNotifications`（:67-76）、`loadSessions`（:86-94）、`revokeOtherSessions`（:96-103）、`markNotificationsRead`（:78-84）、`redeemCode`（:120-133）内部都只做 `invoke(...)` + 响应码判断，**不含 try/catch**——`setError` 分支只覆盖「主进程正常返回非 0 码」这一种失败形态。
2. 桥接层失败语义：`api/electron-bridge.js:41-45` 的 `invoke` 无兜底（有意的，兜底在 `invokeWithFallback` :113-137）；:117-127 明确「其余错误照原样抛出——静默兜底会把真实故障藏起来」，且 ：48-61 注释确认 preload 权限错误的**同步 throw 在 async 函数里变成 rejected promise**，「未登录/许可证未激活」是生产最高频失败模式（M-14）。
3. 权限门控核实：`preload/access-control.js:65` 的 PUBLIC_METHODS 只放行 identityGetState/SignIn/SwitchAccount/SignOut/onIdentityStateChanged；**identitySessions / identitySessionsRevokeOthers / identityNotifications / identityNotificationsMarkRead / identityRedeemCode 五个方法全部走默认 'authenticated' 级**（:94-100），权限不足时 ：141-146 每次**同步 throw LicensePermissionError**。
4. 触发后果：登录用户但权限级不足时，切消息 tab（`activate('messages')` → `loadNotifications`）→ rejected promise 无人接 → **unhandled rejection、UI 空态无任何提示**；「退出其他设备」同理（AccountSecurity.vue:80-87 仅 finally）。与 P0-5 叠加成同一症状的两层根因：P0-5 是「错误写进 store 但不渲染」，MAJOR-1 是「错误根本到不了 store」。

**修复建议**：member.js 统一加一层 `safeInvoke` 包装（try/catch → `error.value = 'MEMBER_REQUEST_FAILED'` 或将 LicensePermissionError 映射为专属码 `MEMBER_PERMISSION_REQUIRED` 并补 i18n 文案，zh/en 成对）；Phase 1 动作 4 一并收口，回归测试用「preload 抛权限错误 → store 落错码」用例锁住。不建议改用 `invokeWithFallback`——数据获取的失败必须可见，静默兜底正是不该要的。

### 🟢 MINOR-1 | UpgradeModal `doDeactivate` 无异常处理

`UpgradeModal.vue:144-146`：`await store.deactivate()` 无 try/catch，license 侧失败时 unhandled rejection。随 P0-6 modal 退役自然消解，不单列修复任务。

### 🟢 MINOR-2 | `HelpSupport.vue` 版本获取吞错

`HelpSupport.vue:29-34`：catch 块静默置空，版本获取失败显示「—」可接受，但 DEV 环境无任何 warn 不利于排查（对照 electron-bridge.js:130-133 的开发期 warn 惯例）。Phase 3 打磨项。

---

## 6. 验收标准（DoD）

- [ ] 价目与兑换入口只出现在「订阅与方案」tab；切 tab 不再重复渲染。
- [ ] 价目/兑换区块在 light/dark 主题下样式完整（有 CSS 定义，非裸控件）。
- [ ] standard 档在权益卡/概览/价目三处显示「标准版」，与价目区 label 一致。
- [ ] feature/quota 列表全部本地化；未知 key 回退原文而非空白。
- [ ] 消息 tab / 退出其他设备 失败时用户可见本地化错误提示；错误码不跨 tab 串显。
- [ ] 升级 CTA 全局唯一目标：到达 Subscription 页；member-center 壳层与 Dashboard 一致地不渲染 UpgradeModal（`?section=` 深链为 Phase 2 增强项，Phase 1 三入口统一跳 `/member-center` 即满足本条——对抗评审 MISS-2 修订）。
- [ ] UpgradeModal 退役四件套同步：组件文件、UpgradeModal.test.js、more-tests import、icon-usage FILES 登记行全部清零（评审 C1-03）。
- [ ] 状态文案统一后，`error + 有会话身份` 态仍显示「已连接」（C1-08 裁决回归用例）。
- [ ] 登出/切换账号后 member store 数据清空（无残留通知/会话）。
- [ ] Phase 1 各项均有对应回归测试；member-center 子视图测试覆盖不再为零。
- [ ] zh/en locale 同步（CI Gate 7 绿）。
