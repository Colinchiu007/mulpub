# 参考产品账号/发布对标 Round 2 分析报告

> **日期**：2026-08-10
> **分支**：`feature/mp-account-publish-parity-r2`
> **范围**：布局系统统一、首页重写、导航动态化、代码多源收敛

---

## 1. 本轮目标

在 Round 1（2026-08-07~08，账号/发布主路径收敛到 `/accounts`、`/publish`、`/publish/history`）基础上，解决以下关键缺口：

1. `MpSidebar` 已创建但未挂载 — mp 工作区缺少左侧主导航
2. 首页 `/` 仍使用旧版 `AppNavbar` + `AppSidebar` 布局
3. `isMpWorkspace` 仅覆盖 3 条路由，首页不在内
4. 平台名称/图标有 3 个来源（store、shared-utils、publish-contract）
5. 草稿列表在 Publish.vue 和 PublishHistory.vue 各有一套
6. 账号加载 3 处重复 `onMounted → accountStore.load()`

---

## 2. 变更清单

### 2.1 布局层（App.vue + MpSidebar + MpModuleNav）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `App.vue` | 修改 | 导入 MpSidebar、挂载到 shell、isMpWorkspace 改为排除模式 |
| `MpSidebar.vue` | 修改 | 导入 identity/license stores、computed 动态用户名/头像/许可证标签 |
| `MpModuleNav.vue` | 修改 | 新增 homeTabs、publishTabs 加入"新建发布"、module/tabs/isTabActive 逻辑重构 |

**isMpWorkspace 策略变更**：

- **旧**：白名单 3 条路由（`/accounts`、`/publish`、`/publish/history`）
- **新**：黑名单排除（`/first-run`、`/model-providers`、`/keywords`、`/viral-analysis`），其余默认使用 mp 布局

### 2.2 首页（Home.vue）

完全重写（125 行 → 423 行），结构：

- 欢迎区：基于时间段的问候语 + 用户姓名（identityStore）+ 快捷操作按钮
- 数据概览：4 列统计卡片（总发布数、总账号数、本周发布、成功率），从 IPC `storeGetPublishStats` 读取
- 快捷入口：6 宫格（新建发布、发布记录、账号管理、草稿箱、数据看板、素材库）
- 支持平台：从 platformStore 读取平台列表展示
- 近期动态：从 IPC `publishHistoryList` 读取最近 5 条发布记录

### 2.3 代码收敛

| 模块 | 旧状态 | 新状态 |
|------|--------|--------|
| 平台名称 | 3 源（store + PLATFORM_NAMES + PLATFORM_LABELS） | 优先 platformStore.getLabel()，fallback 到 PLATFORM_NAMES |
| 平台图标 | 2 源（store + PLATFORM_ICONS） | 优先 platformStore.getIcon()，fallback 到 PLATFORM_ICONS |
| 视频平台判断 | 2 源（usePlatformSelection/VIDEO_PLATFORMS + contentTypeValue()） | 统一到 platformStore.getContentCategory() |
| 草稿列表 | 2 套（Publish.vue 内嵌 + PublishHistory.vue 直接列表） | 新建 PublishDraftList.vue 共享组件 |
| 账号加载 | 3 处 onMounted 调用 load() | ensureLoaded() 幂等方法，loaded ref 防重复 |

### 2.4 测试更新

| 文件 | 变更 |
|------|------|
| `MpSidebar.test.js` | 添加 identity/license store mock、断言从硬编码"邱里奥谈认知"改为"测试用户"+"免费版" |
| `MpModuleNav.test.js` | publish tabs 测试更新为 3 个 tab（含新建发布）、新增 home 路由测试 |

---

## 3. 验证状态

| 验证项 | 状态 | 说明 |
|--------|------|------|
| Vue SFC 编译 | ✅ 通过 | 7 个变更 Vue 文件全部通过 @vue/compiler-sfc 解析 |
| ESLint | ⏳ 未执行 | 需 node_modules 完整 |
| Vite 完整构建 | ⚠️ 预存在问题 | `@ctrl/tinycolor` 解析失败（node_modules 损坏，非本次变更引入） |
| 单元测试 | ⏳ 未执行 | jsdom 依赖缺失（预存在环境问题） |
| 视觉对比 | ⏳ 未执行 | 需参考产品截图基线 |

---

## 4. 遗留项

### 4.1 视觉样式（低优先级）

- `Publish.vue` 中仍有大量 inline style（约 20+ 处 `style="display:flex;..."` 模式），待后续迁移到 scoped CSS + design token
- 弹窗组件（`AccountLoginDialog`、`AccountProxyDialog`、`AccountGroupManager`）样式微调
- `publish-contract.js` 中 `PLATFORM_LABELS` 待全量迁移后删除

### 4.2 外部依赖

- 真实第三方平台登录和发布验证
- 参考产品截图基线获取和像素对比测试
- 团队分享/跨设备同步功能

---

## 5. 决策记录

### 5.1 isMpWorkspace 策略变更

**决策**：从白名单改为黑名单模式。

**理由**：白名单方式每新增路由都需手动维护；黑名单只需排除少数特殊页面（FirstRun、Settings 类），减少维护成本。

**风险**：未来新增的独立工具页（如 `/diagnostics`）如果不加入黑名单，会意外获得 mp 壳层。缓解：代码注释明确说明黑名单策略。

### 5.2 共享草稿组件

**决策**：新建 `PublishDraftList.vue` 而非在 Publish.vue 和 PublishHistory.vue 之间共享逻辑。

**理由**：两处草稿展示的 UI 差异较大（一个嵌在发布编辑器侧栏，一个在发布记录的 Tab 中），共享组件通过 props 控制行为更灵活。
