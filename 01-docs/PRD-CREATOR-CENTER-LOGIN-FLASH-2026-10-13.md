# PRD：创作者中心开卡首屏闪登录页（小红书）修复

- 日期：2026-10-13
- 分支：`xhs-creator-home-url`
- 关联：前置修复 PR #3362（`a22e424a7`，账号标签 localStorage document-start 注入）、issue #3363
- 状态：已定位根因（真机取证），待实施

---

## 1. 现象与复现

**用户原话**：「启动的应用，点击小红书账号，还是会先跳转登录页闪动，然后才打开创作者中心。」

**复现路径**：账号管理页 → 小红书账号卡片 → 「创作者中心」按钮（`Accounts.vue` 的 `@open-creator`）。

**真机观测（2026-10-13，运行中的真实应用 + CDP 逐帧取证）**：

| 时刻 | URL | 说明 |
| --- | --- | --- |
| t+0 | `https://creator.xiaohongshu.com/` | 开卡目标 URL |
| t+1.2s | `/` | 首屏渲染 |
| t+2.4s | `/` | |
| **t+3.6s** | **`/login`** | **用户看到的「闪动」** |
| **t+4.8s** | **`/new/home`** | 创作者中心（最终态正确） |

全程该账号分区 Cookie 恒为 19 个、登录态 Cookie 恒为 **6/7**（缺主站 `web_session`），未发生变化；localStorage 用户态 key 在 document-start 即已就位（3 个）。

---

## 2. 根因（第一性）

> **结论：不是凭证缺失，也不是注入失效；是「已登录账号用登录 URL 开卡」。**

`Accounts.vue::openCreatorCenter` 用 `PLATFORM_DASHBOARD_URLS[platform]` 作为开卡目标：

```js
const url = PLATFORM_DASHBOARD_URLS[account.platform]   // xiaohongshu → 'https://creator.xiaohongshu.com/'
```

而 `creator.xiaohongshu.com/` 是小红书创作服务的**路由入口**，不是**已登录首页**。该 SPA 从 `/` 启动时先渲染登录路由，待其内部鉴权请求返回后（无主站 `web_session` 时该请求为 401）才跳 `/new/home`——这段 1.2 秒的登录路由就是用户看到的闪动。

### 2.1 决定性 A/B（同一分区、同一 Cookie 集）

| 开卡 URL | URL 时间线 | 是否闪登录页 |
| --- | --- | --- |
| `/`（现状） | `/` → **`/login`** → `/new/home` | **是** ❌ |
| `/new/home` | `/new/home` | **否** ✅ |

两次实验的登录态 Cookie 均为 6/7、localStorage 均为 3 个用户态 key——**唯一变量是入口 URL**。

### 2.2 未登录回归边界（干净分区，无任何 Cookie）

| 开卡 URL | 最终落点 | 判定 |
| --- | --- | --- |
| `/new/home` | `/login?source=&redirectReason=401&lastUrl=%2Fnew%2Fhome` | ✅ 正常落到登录页，无死路 |
| `/` | 登录页 | ✅ |

即：把已登录入口 URL 配成 `/new/home`，**未登录账号同样会落到登录页**，不产生「打不开」的死路。

### 2.3 逃逸分析（为什么此前三层测试都没拦住）

| 层级 | 为什么没拦住 |
| --- | --- |
| 单元测试 | `PLATFORM_DASHBOARD_URLS` 的取值从未被断言「等于平台的已登录首页」；测试只断言键存在 |
| 集成/E2E | 既有 E2E 断言「开卡后最终 URL 正确」，而本 Bug 的**最终态是对的**（`/new/home`），只错在中间态 |
| 视觉/人工 | 此前 PR #3362 修的是「整页重载 + 二段导航」，把现象从「登录页→刷新→创作者中心」减弱为「登录页闪 1.2s→创作者中心」，人工验收易被判定为「已好」 |
| 代码审查 | 「dashboard URL」这个命名暗示了「已登录首页」语义，掩盖了小红书 `=` 登录 URL 的事实（`PLATFORM_DASHBOARD_URLS.wechat_mp === PLATFORM_LOGIN_URLS.wechat_mp` 已有注释承认同类问题） |

**系统性漏洞分类**：测试场景缺失 + 审查盲区——缺少「URL 语义 = 已登录首页」的契约锁，以及「首屏中间态不得出现路由级登录页」的行为锁。

---

## 3. 修复方案

### 3.1 设计取舍

| 方案 | 评价 |
| --- | --- |
| A. 直接改 `PLATFORM_DASHBOARD_URLS.xiaohongshu` 为 `/new/home` | ❌ 否决：该常量另被 `http-login-checker.js` 用于抓 HTML 提取 uid（`data-account-id`），改动会影响登录检测形态；且它同时承担「域名」语义（`checkLoginStatus` 用其 hostname 兜底判定） |
| **B. 新增独立单一真源 `PLATFORM_CREATOR_HOME_URLS`（本方案）** | ✅ 采纳：语义精确（「已登录创作者首页」）、影响面最小（只被开卡动作消费）、不影响登录检测链路 |
| C. 前端硬编码 `/new/home` | ❌ 否决：平台 URL 收敛在 `shared-utils` 单一真源，禁止第二份 |

### 3.2 变更点

1. `packages/shared-utils/src/platform-definitions.js`
   - 新增 `PLATFORM_CREATOR_HOME_URLS`：**只登记「已登录创作者首页 ≠ dashboard URL」的平台**。未登记平台不出现该键，由调用方回退 `PLATFORM_DASHBOARD_URLS`。
   - 小红书：`https://creator.xiaohongshu.com/new/home`
   - 显式注释「与 `PLATFORM_DASHBOARD_URLS` 的关系与禁用合并」。
2. `apps/desktop/src/views/Accounts.vue`
   - `openCreatorCenter`：`PLATFORM_CREATOR_HOME_URLS[platform] || PLATFORM_DASHBOARD_URLS[platform]`。

### 3.3 功能逻辑

```
openCreatorCenter(account):
  platform 缺失 → 报错提示（不变）
  url = PLATFORM_CREATOR_HOME_URLS[platform] || PLATFORM_DASHBOARD_URLS[platform]
  url 为空 → 警告「该平台不支持」（不变）
  createTab({ url, platform, accountId, cleanSession: needsCleanLoginSession(account, expiredIds), title })
```

- **`cleanSession` 语义不变**：失效账号仍以干净会话打开；此时 `/new/home` 会被平台重定向到登录页（§2.2 已实测），**不产生死路**。
- **`openLoginPage` 不改**：它走 `PLATFORM_LOGIN_URLS`，语义就是「打开登录页」。

### 3.4 交互逻辑

| 场景 | 入口 URL | 首屏 |
| --- | --- | --- |
| 已登录账号点「创作者中心」 | `/new/home` | 直接进创作者中心，**无登录页闪动** |
| 失效账号点「创作者中心」 | `/new/home` → 平台 302 | 直接进登录页（一次跳转，无闪动回跳） |
| 点「重新登录」/批量重登 | `PLATFORM_LOGIN_URLS`（不变） | 登录页（不变） |

### 3.5 显示项与提示文字

**本次不新增、不修改任何用户可见文案**，不涉及 `locales/zh.js` / `en.js`（因此无 i18n 成对修改）。既有两个提示保持不变：

- `accountsPage.accountIncomplete`（账号信息不完整）
- `accountsPage.creatorUnsupported`（该平台暂不支持打开创作者中心）

---

## 4. 数据校验

- `PLATFORM_CREATOR_HOME_URLS` 的每个值必须是 `https://` 绝对 URL，且 **host 必须与同平台 `PLATFORM_LOGIN_URLS` 的 host 相同**（防跨域误配导致开卡到错误站点）。测试对全部登记项断言。
- 未登记平台**不得**出现该键（值不得为 `undefined`/空串），由调用方 `||` 回退，避免出现「键存在但值为空」导致 `createTab` 收到空 URL。
- 调用点对 `url` 的既有「未配置即警告并 return」守卫保持不变。

---

## 5. 验收标准

| # | 验收项 | 判据 |
| --- | --- | --- |
| A1 | 已登录账号点「创作者中心」不出现登录页中间态 | 真机 CDP 时间线中 URL 从不匹配 `/login` |
| A2 | 最终落点正确 | 落点为 `/new/home` |
| A3 | 未登录/失效账号仍可用 | 干净会话开 `/new/home` 最终落点含 `/login` |
| A4 | 其他平台零回归 | 未登记平台的 `openCreatorCenter` 仍用 `PLATFORM_DASHBOARD_URLS` |
| A5 | 登录检测链路零影响 | `http-login-checker` / `checkLoginStatus` 引用的 `PLATFORM_DASHBOARD_URLS` 未被改动 |
| A6 | 契约锁防再犯 | 新增测试对全部登记项断言 host 同源 + 值为 https；删掉登记项即变红 |

---

## 6. 测试矩阵

| 层级 | 文件 | 覆盖 |
| --- | --- | --- |
| 单元（契约锁） | `packages/shared-utils/src/platform-definitions.test.js` | 登记项为 https 绝对 URL；host 与 `PLATFORM_LOGIN_URLS` 同源；小红书记录为 `/new/home`；未登记平台无该键；与 `PLATFORM_DASHBOARD_URLS` 是两份独立对象 |
| 单元（行为锁） | `apps/desktop/src/views/Accounts.test.js` | 已登录账号走 `PLATFORM_CREATOR_HOME_URLS`；未登记平台回退 `PLATFORM_DASHBOARD_URLS`；`cleanSession` 语义不变；URL 缺失时警告且不建标签 |

**变异反证（逐条，改坏必须变红）**：
- M1：删掉小红书登记项 → 契约锁 + 行为锁各 1 红
- M2：把小红书值改回 `/` → 行为锁红（回退到旧 URL）
- M3：调用点去掉 `PLATFORM_CREATOR_HOME_URLS` 优先分支 → 行为锁红
- M4：把登记值改成跨域 host → 契约锁红
- M5：把登记项写成空串 → 契约锁红

---

## 7. 风险与不做的事

- **不做**：不改 `PLATFORM_DASHBOARD_URLS`（登录检测链路依赖）；不改主进程 `createNewTabPage`（缺口在「调用方选了哪个 URL」，不在标签生命周期）；不顺手修 `web_session` 主站会话缺失（属独立问题，见 §8）。
- **残余风险**：小红书若调整路由（`/new/home` 变更），需同步更新登记表；契约锁只能保证 host 同源，不能保证路径长期有效——路径有效性依赖真机验收（A1/A2）。
- **回滚**：删除登记项即回到旧行为（调用方 `||` 自动回退），单点可逆。

## 8. 关联但不在本次范围

该账号登录态 Cookie 为 **6/7**，缺主站 `web_session`（`xhs-mainsite-login.test.js` 已记录该缺口，二段式补跳只在登录窗流程生效）。本 PRD 的修复让 `/new/home` 不经过需要主站会话的路由守卫，因此**当前现象消除**；但依赖主站会话的功能仍受该缺口影响，属独立任务。
