# 首页数据概览真实性合同（2026-09-23）

> **状态**: ✅ 已实施
> **关联 PR**: home-real-data-fix
> **根因**: Home.vue 读取了已脱钩的 SQLite publish_history 表和 accounts 表，导致首页统计永远显示空值或迁移快照残留

---

## 一、问题描述

启动应用后，首页（Home.vue）的「发布」统计区域（总发布/成功/失败）和「账号数据」区域（已绑定账号数）显示的数据均非真实数据：

| 区域 | 预期行为 | 实际 Bug 表现 | 根因 |
|------|---------|-------------|------|
| 发布统计（总发布/成功/失败） | 显示 JSONL 发布历史的真实聚合 | 始终显示 0/0/0 | 读了 SQLite `publish_history` 表（已无生产写入方，`store:add-publish-record` 全仓零调用） |
| 已绑定账号数 | 与「账号管理」页同源，显示 AccountManager 凭证数 | 始终显示 0 | 读了 SQLite `accounts` 表（只镜像 OAuth 账号，与 AccountManager 双库分裂） |
| 近期动态 | 显示最近 5 条发布记录 | 永远为空列表 | `historyList` 返回 `{ total, records }` 对象，旧代码判定 `Array.isArray(res.data)` 恒 false |

---

## 二、数据源架构（修复后）

### 2.1 正确数据流

```
┌────────────────────────────────────────────────────────────────┐
│                        首页 Home.vue                             │
├──────────────────┬─────────────────────┬───────────────────────┤
│ 发布统计卡片     │ 已绑定账号数         │ 近期动态              │
└────────┬─────────┘──────────┬──────────┘───────────┬───────────┘
         │                    │                      │
         ▼                    ▼                      ▼
   dashboardStats        accountStore           historyList
   (IPC)                 (Vuex/Pinia)           (IPC)
         │                    │                      │
         ▼                    ▼                      ▼
   dashboard:stats       accounts:list          history:list
   (ipcMain)             (ipcMain)              (ipcMain)
         │                    │                      │
         ▼                    ▼                      ▼
   publish-history      AccountManager          publish-history
   .getStats()          .listAccounts()         .listRecords()
         │                    │                      │
         ▼                    ▼                      ▼
   publish-history       凭证目录                publish-history
   .jsonl (JSONL)       (AES-256-GCM)          .jsonl (JSONL)
```

### 2.2 关键 IPC 通道

| IPC 通道名 | preload 方法 | 数据源 | 响应格式 |
|-----------|-------------|--------|----------|
| `dashboard:stats` | `api.dashboardStats()` | `publish-history.js` → JSONL 聚合 | `{ code: 0, data: { total, success, failed, successRate, perPlatform, daily } }` |
| `accounts:list` | `api.listAccounts()` | `account-manager.js` → 凭证目录 | `{ code: 0, data: [...] }` |
| `history:list` | `api.historyList(params)` | `publish-history.js` → JSONL | `{ code: 0, data: { total, records: [...] } }` |

### 2.3 已废弃的 IPC 通道（首页不再使用）

| IPC 通道名 | 问题 | 废弃原因 |
|-----------|------|----------|
| `store:get-publish-stats` | 读 SQLite `publish_history` 表 | 该表已无生产写入方（`store:add-publish-record` 全仓零调用），只含历史迁移快照 |
| `store:list-accounts` | 读 SQLite `accounts` 表 | 该表只镜像 OAuth 账号，与 AccountManager 凭证体系双库分裂 |

---

## 三、数据校验合同

### 3.1 发布统计

| 校验项 | 规则 | 失败处理 |
|--------|------|----------|
| IPC 响应非 null | `res && res.code === 0` | 保持默认值 `{ total: 0, success: 0, failed: 0 }` |
| data 字段存在 | `res.data` 非 null/undefined | 同上 |
| 数值字段安全提取 | `res.data.total \|\| 0` | null/undefined → 0 |
| 加载状态标记 | 完成后设置 `statsLoaded = true` | UI 据此决定显示骨架屏还是数据 |

### 3.2 账号数

| 校验项 | 规则 | 失败处理 |
|--------|------|----------|
| 数据源 | 使用 `computed(() => accountStore.accounts.length)` | 自动响应式更新 |
| 加载时机 | `onMounted` 中 `await accountStore.ensureLoaded()` | 加载完成后 computed 自动重算 |
| 与账号页一致性 | 首页显示数 == 账号管理页列表长度（同一 AccountManager 源） | — |

### 3.3 近期动态

| 校验项 | 规则 | 失败处理 |
|--------|------|----------|
| IPC 响应结构 | `Array.isArray(res.data && res.data.records)` | 不更新 `recentItems`（保持空数组） |
| 数组截取 | `res.data.records.slice(0, 5)` | 最多显示 5 条 |
| 时间字段回退链 | `item.created_at \|\| item.createdAt \|\| item.timestamp` | 兼容 JSONL 三种时间戳字段名 |
| 格式化 | `formatDateTime(value, { style: 'numeric-short' })` | 无效值显示 `--` |

---

## 四、显示项规格

### 4.1 统计卡片区（四张）

| 卡片 | 标签文字 | 绑定字段 | 空值显示 | 图标 |
|------|---------|---------|---------|------|
| 总发布 | `home.stats.total` → "总发布" | `stats.total` | `0` | 📊 |
| 成功 | `home.stats.success` → "成功" | `stats.success` | `0` | ✅ |
| 失败 | `home.stats.failed` → "失败" | `stats.failed` | `0` | ❌ |
| 已绑定账号 | `home.stats.accounts` → "已绑定账号" | `accountCount` (computed) | `0` | 👤 |

### 4.2 近期动态列表

| 列 | 字段 | 说明 |
|----|------|------|
| 平台标签 | `item.platform` | 经 `getPlatformLabel()` 转中文名 |
| 标题 | `item.title` | 截断至 40 字符，CSS `text-overflow: ellipsis` |
| 状态 | `item.status` | 经 `statusLabel()` → i18n（success/failed/pending/publishing/error） |
| 时间 | `item.created_at \|\| item.createdAt \|\| item.timestamp` | 短格式日期时间 |

### 4.3 待办摘要区

规则（`todoItems` computed）：
- 仅展示有真实数据的项（`expiredAccountCount > 0` 或 `stats.failed > 0`）
- 全为 0 时显示鼓励语（`isAllZero` computed，文案 `home.empty.encouraging`）
- **禁止显示假数据/占位数据**

---

## 五、交互逻辑

### 5.1 页面加载时序

```
onMounted
  │
  ├─ subscribeAutoRefresh()          // 订阅账号状态变更事件
  ├─ platformStore.load()            // 加载平台配置
  ├─ await accountStore.ensureLoaded()  // 加载真实账号列表（AccountManager）
  ├─ await refreshExpiredAccounts()  // 检测过期账号
  ├─ await api.dashboardStats()      // 获取发布统计（JSONL 聚合）
  ├─ statsLoaded = true              // 标记加载完成，隐藏骨架屏
  └─ await api.historyList()         // 获取近期动态（JSONL 最新 5 条）
```

### 5.2 错误处理

| 阶段 | 错误 | 处理 |
|------|------|------|
| IPC 不可用 | `getApi()` 返回 null | 跳过数据加载，保持默认 0 值 |
| IPC 超时/异常 | `catch (e)` | `reportError('加载首页数据失败', e)` → 控制台 + 日志文件，UI 保持最后有效值 |
| 账号 store 加载失败 | 内部 Promise rejection | `ensureLoaded()` 内部静默处理，accountCount 保持 0 |

### 5.3 响应式更新触发

| 事件 | 响应 |
|------|------|
| 账号保存/删除 | `accountStore.accounts` 变化 → `accountCount` computed 自动重算 |
| 发布完成 | `publish-success` 事件 → Dashboard 刷新（首页需重新进入才刷新统计） |
| 登录状态变更 | `subscribeAutoRefresh` → `refreshExpiredAccounts()` 重新检测 |

---

## 六、回归保护

### 6.1 单元测试

| 文件 | 用例数 | 保护点 |
|------|--------|--------|
| `Home.test.js` | 19 | IPC mock 使用正确通道（dashboardStats 非 storeGetPublishStats）；accountCount 从 store 取；historyList 解析 records |
| `views-deep.test.js` | 12 | HomeView mock 使用 dashboardStats |
| `Home.todo-guard.test.js` | 5 | 待办区无假数据 |
| `route-functional-suite.js` | — | E2E 断言 IPC 调用为 dashboardStats/listAccounts |

### 6.2 关键断言

```js
// Home.test.js 回归保护
it('should call dashboardStats not storeGetPublishStats', async () => {
  // mock 提供 dashboardStats，不提供 storeGetPublishStats
  // 验证 stats 被正确填充
  expect(wrapper.vm.stats.total).toBe(10) // 真实数据
})

it('accountCount should reflect accountStore length', async () => {
  // accountStore.accounts = [{...}, {...}]
  expect(wrapper.vm.accountCount).toBe(2)
})

it('historyList records array is correctly parsed', async () => {
  // mock historyList returns { code: 0, data: { total: 100, records: [...] } }
  expect(wrapper.vm.recentItems.length).toBe(5)
})
```

---

## 七、提示文字（i18n locale keys）

| 场景 | key | 中文 | 英文 |
|------|-----|------|------|
| 统计加载中 | `home.stats.loading` | 加载中... | Loading... |
| 全 0 鼓励 | `home.empty.encouraging` | 开始你的第一次发布吧！ | Start your first publish! |
| 近期动态为空 | `home.recent.empty` | 暂无发布记录 | No publish records yet |
| 加载失败 | `home.loadError` | 加载首页数据失败 | Failed to load homepage data |

---

## 八、设计决策记录

| 决策 | 理由 | 被拒方案 |
|------|------|----------|
| 发布统计使用 `dashboard:stats` IPC | 与 Dashboard/Calendar 同源，数据均来自 JSONL 聚合；SQLite publish_history 已无写入方 | 保留 store:get-publish-stats + 补写入方（增加维护成本，两套存储长期冲突） |
| 账号数用 computed 绑定 store | 响应式自动同步；与账号管理页共享同一 store 实例，保证一致性 | 每次 onMounted 单独调 storeListAccounts IPC（数据源仍错） |
| historyList 解析 `res.data.records` | 与 IPC handler 合同一致（`{ total, records }`），Dashboard 同用此合同 | 改为 Array.isArray(res.data)（需改后端合同，影响面大） |

---

## 九、变更范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `apps/desktop/src/views/Home.vue` | 修复 | 三处数据来源纠正 + timestamp 字段回退 |
| `apps/desktop/src/views/Home.test.js` | 测试重写 | 真实 IPC 合同 mock + 回归断言 |
| `apps/desktop/src/views/views-deep.test.js` | 测试更新 | mock 对齐新 IPC 通道 |
| `apps/desktop/tests/e2e/helpers/route-functional-suite.js` | 测试更新 | E2E IPC 断言 |
| `apps/desktop/tests/e2e/verify.js` | 测试更新 | 诊断脚本对齐 |

---

## 十、验收标准

- [x] 首页「总发布/成功/失败」卡片数值 = Dashboard 页同名字段数值
- [x] 首页「已绑定账号」卡片数值 = 账号管理页账号列表长度
- [x] 近期动态列表显示实际已发布内容（非空）
- [x] 无任何 mock/fake/placeholder 数据出现在 UI 上
- [x] Home.test.js 全量通过
- [x] views-deep.test.js 全量通过
- [x] 待办区无假数据
- [x] 非法/缺失 IPC 响应不崩溃，保持默认值
