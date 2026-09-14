# PRD：侧边栏左上角品牌区（Logo + 版本号，2026-09-14）

> 状态：已实现（分支 `codex/sidebar-logo-version`）
> 类型：🎨 UI/UX 品牌区改造（应用壳导航层）
> 关联文档：[桌面端 UI 布局规格](../docs/desktop-ui-layout-spec.md)、[桌面端前端交互规范](../docs/frontend-interaction-spec.md)、[PRD：侧边栏底部用户菜单](./PRD-SIDEBAR-BOTTOM-USER-MENU-2026-09-14.md)、[i18n 词条表](./i18n-glossary.md)
> 上游：`PRD-SIDEBAR-BOTTOM-USER-MENU-2026-09-14`（#1824）把登录区移出顶部后，顶部由 `MP` 文字徽标 + `Multi-Publish` 文本占位，本次把该占位替换为正式品牌 Logo 与版本号。

---

## 1. 背景与目标

`PRD-SIDEBAR-BOTTOM-USER-MENU`（#1824）把登录区迁到侧边栏底部后，侧边栏**左上角**暂时使用「`MP` 圆角徽标 + `Multi-Publish` 文本」这一**临时文字占位**作为品牌标识。该占位存在三个问题：

1. **不是正式品牌资产**：`MP` 是纯 CSS 渐变色块 + 两字母，与产品对外视觉（汤姆鱼 Logo）不一致；
2. **不显示版本号**：用户与支持人员无法在界面上确认当前运行的是哪个版本，报障时只能靠关于页跳转（会员中心 → 关于）间接查看；
3. **占用宽度不经济**：`MP` + `Multi-Publish` 文本合计约 110px，在 200px 侧边栏中挤压了「+ 新建发布」按钮与版本信息的可用空间。

**本次目标**：把左上角改为「**品牌 Logo 图片 + 应用版本号**」的正式品牌区（对齐参考客户端左上角 *Logo + vX.Y.Z* 的形态），并沉淀可复用的版本号读取能力。

**用户原始诉求（逐条对应实现）**：

| # | 诉求 | 实现位置 |
|---|------|---------|
| 1 | 参考截图左上角效果，把应用左上角改成同样形态 | `YixiaoerSidebar.vue` header |
| 2 | 左上角区域 = Logo + 版本号 | `header` 内 `logo` (`<img>`) + `version` (`<span>`) |
| 3 | 原图 3042×1910 尺寸太大，计算左上角合理显示宽度 | 见 §8.1 尺寸推导 → 显示高 36px / 宽 ≈59px（3× 资源 176×108） |
| 4 | 把透明 PNG 按比例缩小并保存为新资源 | `apps/desktop/src/assets/brand/tom-fish-logo.png`（176×108，13.9KB） |

---

## 2. 变更范围

### 2.1 In Scope

- 侧边栏 header 结构：文字品牌占位 → 品牌 Logo 图片 + 应用版本号
- 新增品牌图片资源（等比缩小、保留透明通道、裁剪透明边距）
- 新增 `useAppVersion` 组合式函数（唯一的版本号取数入口）
- 新增 2 个 i18n 词条（zh/en 成对）：Logo 无障碍替代文本、版本号悬停提示
- 响应式（≤900px 折叠轨）下品牌区的降级规则
- 上述变更的单测、PRD/布局规格/交互规范/CHANGELOG 同步

### 2.2 Out of Scope（明确不做）

- 不改动侧边栏宽度（仍为 `--yixiaoer-sidebar-width: 200px`）、不做可折叠侧边栏
- 不改动主导航 / 更多菜单 / footer（服务连接信息 + 用户 banner）结构与路由
- 不改动版本号数据源：仍为 `apps/desktop/package.json` 的 `version`（经主进程 `app:get-version`），**不新增 IPC / 不新增持久化**
- 不改动自动更新链路（`useAutoUpdate`）、不改动会员中心「关于」卡片
- 不新增第三方依赖（图片处理为一次性离线操作，处理脚本不进入仓库）
- 不引入运行时 SVG 内联/主题化 Logo（本次交付单张 PNG）

---

## 3. 术语与改动前后现状

| 术语 | 说明 |
|------|------|
| 品牌区 | 侧边栏 header（`.yixiaoer-sidebar-header`）：左上角 Logo + 版本号 + 「+ 新建发布」 |
| 品牌 Logo | 汤姆鱼矢量图的透明 PNG 位图，落盘于 `src/assets/brand/tom-fish-logo.png` |
| 应用版本号 | 主进程 `app:get-version` 返回的 semver 字符串（当前 `0.1.0`），渲染为 `v0.1.0` |
| 版本单一真相源 | 根 `package.json` 的 `version`（见 [版本管理规范](../docs/version-management.md)）；`apps/desktop/package.json` 由 `scripts/sync-version.mjs` 自动派生，pre-commit 钩子保证二者永不漂移 |
| 折叠轨 | 视口 ≤900px 时侧边栏收窄为 68px 的形态 |

**改动前的侧边栏 header**：

```
Header : [MP]  Multi-Publish .................... [+ 新建发布]
          ↑ 24×24 渐变方块 + 两字母（非正式品牌资产）
```

**改动后**：

```
Header : [🐟 汤姆鱼 Logo]  v0.1.0  ............. [+ 新建发布]
          高 36px / 宽 ≈59px  11px 灰字
          （版本号取不到时整段隐藏，仅保留 Logo）
```

---

## 4. 需求明细

### 4.1 左上角改为「Logo + 版本号」（诉求 1、2）

| 项 | 要求 |
|----|------|
| 移除 | `.yixiaoer-sidebar-brand`（`MP` 渐变徽标）与 `.yixiaoer-sidebar-title`（`Multi-Publish` 文本）的 DOM 与样式 |
| 新增 | `<img class="yixiaoer-sidebar-logo" :src="brandLogoUrl" :alt="t('sidebar.brandLogoAlt')" data-testid="yixiaoer-sidebar-logo" />` |
| 新增 | `<span class="yixiaoer-sidebar-version" :title="t('sidebar.appVersionTitle')" data-testid="yixiaoer-sidebar-version">v{{ version }}</span>` |
| 保留 | 「+ 新建发布」圆形按钮（`aria-label/title=新建发布`，点击 `router.push('/publish')`），仍由 `margin-left: auto` 贴右 |
| 排列 | header 保持 `display:flex; align-items:center; gap:8px; padding:16px 14px 14px`（沿用原内边距，减少无关视觉位移） |

### 4.2 版本号读取与降级

| 项 | 要求 |
|----|------|
| 数据源（唯一） | 主进程 IPC `app:get-version`（`electron/ipc-handlers/misc.js`），读 `apps/desktop/package.json` 的 `version`，返回 `{ code: 0, data: '<semver>' }`；该字段由 [版本管理规范](../docs/version-management.md) 的单一真相源（根 `package.json`）经 `scripts/sync-version.mjs` 自动派生，故界面展示的版本号始终等于产品唯一版本号 |
| 调用方式（唯一） | 渲染层经 `@/api/electron-bridge` 的 `invoke('getVersion')`，**禁止**直接访问 `window.electronAPI`（CI Gate 10 约束） |
| 封装 | 新增 `src/composables/useAppVersion.js`，导出纯函数 `extractAppVersion(response)` 与组合式函数 `useAppVersion()` |
| 时机 | 侧边栏 `onMounted` 调用一次 `loadVersion()`；不做轮询、不监听更新事件 |
| 渲染 | `version` 非空才渲染版本号节点（`v-if`），前缀固定小写 `v` |
| 降级 | 见 §6 数据校验与边界：任一失败路径均静默留空、**不渲染**版本节点，且不抛错、不阻塞侧边栏渲染 |

### 4.3 品牌图片资源（诉求 3、4）

| 项 | 要求 |
|----|------|
| 源文件 | `Logo矢量图-透明.png`（3042×1910，RGBA，1.06MB，透明背景） |
| 处理 | ① 探测非透明像素包围盒 → ② 裁剪透明边距 → ③ 等比缩小（alpha 预乘加权，避免透明边缘发黑）→ ④ 生成 PNG |
| 产物 | `apps/desktop/src/assets/brand/tom-fish-logo.png`，**176×108**，约 13.9KB |
| 引用 | `import brandLogoUrl from '@/assets/brand/tom-fish-logo.png'`（Vite 静态导入，与 `usePlatformIconUrl` 同范式） |
| 不进入仓库 | 一次性图片处理脚本（放在仓库外临时目录），避免引入 `sharp` 等构建依赖 |

---

## 5. 组件与接口契约

### 5.1 `src/composables/useAppVersion.js`（新增）

| 导出 | 签名 | 语义 |
|------|------|------|
| `extractAppVersion` | `(response: any) => string` | 仅当 `response` 为对象且 `code === 0` 且 `data` 非 `null/undefined` 时返回 `String(data).trim()`；其余一律 `''` |
| `useAppVersion` | `() => { version: Ref<string>, loading: Ref<boolean>, loadVersion: () => Promise<string> }` | `loadVersion()` 拉取版本；内部 `try/catch/finally`，异常不外抛，返回最终版本字符串 |

**契约要点**：

- `invoke()` 在非 Electron 环境返回 `undefined` → `extractAppVersion(undefined) === ''`；
- 失败码（如 `-3 未授权的调用来源`）**不得**把 `message` 当作版本号（曾是对应测试的负向断言）；
- `loading` 复位在 `finally` 中，保证任何路径都复位。

### 5.2 `src/layouts/YixiaoerSidebar.vue`（改动）

| 项 | 说明 |
|----|------|
| 新增 import | `useAppVersion`、`brandLogoUrl`（PNG 静态导入） |
| 新增状态 | `const { version, loadVersion } = useAppVersion()` |
| `onMounted` | 首行调用 `loadVersion()`（与既有 `ResizeObserver` 宽度同步共存，互不影响） |
| 对外契约 | **不变**：仍只 emit `open-settings`；props 无新增（避免顶穿债务熔断 `filesOver500`） |
| 稳定选择器 | 新增 `data-testid="yixiaoer-sidebar-logo"` / `data-testid="yixiaoer-sidebar-version"`；移除的 `.yixiaoer-sidebar-brand` / `.yixiaoer-sidebar-title` 不再被引用（全仓已核验） |

---

## 6. 数据校验与边界

| 校验项 | 规则 | 位置 | 失败处理 |
|--------|------|------|---------|
| IPC 不可用 | `window.electronAPI` 缺失 → `invoke()` 返回 `undefined` | `electron-bridge.invoke` → `extractAppVersion` | 版本号留空，**不渲染**版本节点；Logo 正常显示（纯浏览器/视觉回归环境即此路径） |
| 失败返回码 | `code !== 0` | `extractAppVersion` | 返回 `''`，不把 `message` 误当版本号 |
| `data` 为空 | `null` / `undefined` / `''` / 纯空白 | `extractAppVersion` | 返回 `''` |
| 响应类型异常 | 非对象（字符串 / 数组 / `null`） | `extractAppVersion` | 返回 `''` |
| IPC 抛异常 | `invoke` reject | `useAppVersion.loadVersion` 的 `catch` | 吞掉异常并留空（版本号是装饰性信息，不允许打断应用壳渲染） |
| 版本号长度 | 无显式截断，由 CSS `text-overflow: ellipsis` 兜底 | `.yixiaoer-sidebar-version` | 超长省略，不撑破 header |
| 资源缺失 | 图片 404（打包漏带） | 浏览器原生行为 | `<img>` 空占位；**不影响**版本号与「+ 新建发布」可用性 |
| 重复加载 | `loadVersion()` 可重入 | `useAppVersion` | 每次覆盖 `version`，无累加副作用（当前仅在 `onMounted` 调用一次） |

**数据依赖声明**：本次改动**不新增任何持久化读写**（无 SQLite / localStorage / 文件 IPC），仅**只读**消费一个既有 IPC（`app:get-version`）。版本号刷新时机 = 组件挂载一次；应用内热升级（auto-update 安装新包）需重启应用才会刷新，属可接受限制（与会员中心「关于」卡片一致）。

---

## 7. 流程与交互逻辑

### 7.1 版本号加载流程

```
侧边栏 onMounted
  → useAppVersion.loadVersion()
    → loading = true
    → invoke('getVersion')
        ├─ Electron 环境：preload → IPC 'app:get-version' → 主进程读 package.json.version → { code:0, data:'0.1.0' }
        └─ 浏览器环境：electron-bridge 检测无 API → 返回 undefined
    → extractAppVersion(response)
        ├─ 合法成功响应 → '0.1.0'
        └─ 其他 → ''
    → version = 结果
    → loading = false（finally）
  → 模板 v-if="version" → 渲染 'v0.1.0'
```

### 7.2 交互逻辑

| 元素 | 交互 | 行为 |
|------|------|------|
| Logo | 悬停 / 点击 | **无交互**（纯展示；不跳首页，避免与「主页」导航项语义重复） |
| Logo | 拖拽 | 禁止默认拖拽（`-webkit-user-drag: none`）、禁止文本选中（`user-select: none`） |
| 版本号 | 悬停 | 原生 `title` 提示「当前版本」（`sidebar.appVersionTitle`） |
| 版本号 | 点击 | 无交互（不打开关于页 / 不触发检查更新，保持本次范围收敛） |
| 「+ 新建发布」 | 点击 | 沿用 `router.push('/publish')`（未改动） |

---

## 8. 视觉规范

### 8.1 Logo 显示尺寸推导（诉求 3 的计算过程）

| 步骤 | 计算 | 结果 |
|------|------|------|
| ① 可用宽度 | 侧边栏 200px − header 左右内边距 14px×2 | **172px** |
| ② 让位「+ 新建发布」 | 按钮 24px + flex gap 8px | 剩 **140px** 给 Logo + 版本号 |
| ③ 让位版本号 | `v0.1.0`（11px 字重常规）≈ 38px + gap 8px | 剩 **≈94px** 给 Logo |
| ④ 垂直约束 | 主导航项行高 40px；header 需保持轻量 → Logo 高 **36px** | header 总高 = 16 + 36 + 14 = **66px** |
| ⑤ 由宽高比反推宽度 | 内容宽高比 2930 / 1798 = **1.6296** → 36 × 1.6296 | **≈ 58.7px ≈ 59px** |
| ⑥ 校验 | 59 + 8 + 38 = 105px ≤ 140px ✅ | 不挤压「+ 新建发布」 |

**结论**：CSS 用 `height: 36px; width: auto`（由固有宽高比自动得 ≈59px），资源按 **3×** 导出 = **176×108**（176/59 ≈ 2.98、108/36 = 3.0），即使用户在 200% 缩放或 HiDPI 屏上也不会模糊。

### 8.2 品牌区样式

| 元素 | 属性 | 值 |
|------|------|----|
| `.yixiaoer-sidebar-header` | 布局 | `display:flex; align-items:center; gap:8px; padding:16px 14px 14px` |
| `.yixiaoer-sidebar-logo` | 尺寸 | `height:36px; width:auto; flex:0 0 auto` |
| `.yixiaoer-sidebar-logo` | 其它 | `object-fit:contain; user-select:none; -webkit-user-drag:none` |
| `.yixiaoer-sidebar-version` | 字体 | `font-size:11px; line-height:1; letter-spacing:.2px; color:#9a9cb3` |
| `.yixiaoer-sidebar-version` | 溢出 | `min-width:0; flex:0 1 auto; overflow:hidden; white-space:nowrap; text-overflow:ellipsis` |
| 图片格式 | 透明 PNG（RGBA） | 允许透出侧边栏紫色渐变背景 `linear-gradient(180deg,#f4f2ff,#f0efff)` |

### 8.3 图片处理规范（源图 → 产物）

| 项 | 处理前 | 处理后 |
|----|--------|--------|
| 画布 | 3042×1910（含 ~1.8%–3.1% 透明边距） | 裁剪到内容包围盒 2930×1798 |
| 输出尺寸 | — | 176×108（等比，3×） |
| 缩放算法 | — | 盒式降采样 + **alpha 预乘加权**（避免半透明边缘混入黑边/白边） |
| 通道 | RGBA（colorType 6） | RGBA 保留透明 |
| 体积 | 1.06MB | 13.9KB（约 −98.7%） |

### 8.4 响应式断点（`max-width: 900px`，侧边栏 68px）

| 元素 | 窄屏行为 |
|------|---------|
| Logo | **保留**，`height:28px; max-width:100%`（28 × 1.63 ≈ 46px ≤ 可用 56px） |
| 版本号 | **隐藏**（`display:none`，宽度不足以承载） |
| 「+ 新建发布」 | 隐藏（沿用原行为） |
| 主导航文字标签 | 隐藏（仅图标，沿用原行为） |
| 服务连接信息 | 隐藏（沿用原行为） |
| 用户 banner | 保留（仅头像 + 状态点，沿用原行为） |

---

## 9. 无障碍（a11y）

| 元素 | 属性 |
|------|------|
| Logo `<img>` | `:alt="t('sidebar.brandLogoAlt')"` → `Multi-Publish`（Logo 为产品标识，语义等同产品名） |
| 版本号 `<span>` | `:title="t('sidebar.appVersionTitle')"` → 「当前版本」/ `Current version` |
| 版本号可读性 | 文本形态（非图片），屏幕阅读器可直接朗读 `v0.1.0` |
| 对比度 | `#9a9cb3` on `#f4f2ff` 渐变 ≈ 3.3:1，属**装饰性辅助信息**（非导航、非操作），满足非正文文本要求 |
| 焦点 | Logo 与版本号均不可聚焦（无 `tabindex`），不进入键盘 Tab 序，避免打断「+ 新建发布」的键盘路径 |

---

## 10. 显示项与提示文字（i18n）

### 10.1 新增 i18n key（zh / en 成对，CI Gate 7 `--pair-base` / `--keys` 双重约束）

| 显示项 | Key | zh | en |
|--------|-----|----|----|
| Logo 替代文本 | `sidebar.brandLogoAlt` | `Multi-Publish` | `Multi-Publish` |
| 版本号悬停提示 | `sidebar.appVersionTitle` | 当前版本 | Current version |

### 10.2 界面文案清单

| 位置 | 文案 | 来源 |
|------|------|------|
| 品牌区版本号 | `v` + 版本号（如 `v0.1.0`） | `v` 为 ASCII 字面量前缀 + IPC 动态值（跟随后续版本 bump 自动变化） |
| 版本号悬停 | 当前版本 / Current version | `sidebar.appVersionTitle` |
| Logo 替代文本 | Multi-Publish | `sidebar.brandLogoAlt` |
| 「+ 新建发布」 | 新建发布（`aria-label` + `title`） | 既有字面量（未改动） |

> **i18n 约束**：本次**不新增硬编码中文**（`.vue` 仅新增中文**注释**，注释不被 `--cjk` 扫描）；版本号为动态数据，`v` 前缀为 ASCII，不触发 CJK 门禁。

### 10.3 移除的显示项

| 移除项 | 原位置 | 原因 |
|--------|--------|------|
| `MP` 渐变徽标 | 侧边栏 header | 临时文字占位，被正式品牌 Logo 取代 |
| `Multi-Publish` 文本 | 侧边栏 header | 同上；产品名语义改由 Logo 替代文本承载 |

---

## 11. 异常与降级

| 场景 | 表现 | 处理 |
|------|------|------|
| 纯浏览器 / 视觉回归环境（无 `electronAPI`） | 仅显示 Logo，无版本号 | `invoke` 返回 `undefined` → 版本留空（**确定性行为**，保证像素门禁稳定） |
| 主进程 IPC 注册缺失 / 调用被拒（`code:-3`） | 仅显示 Logo | 失败码不落值 |
| IPC 抛异常 | 仅显示 Logo | `catch` 吞掉，不冒泡、不打断渲染 |
| 版本号为超长字符串 | 版本号省略号截断 | CSS `text-overflow: ellipsis` |
| 图片资源缺失 | 图片空白占位 | 不影响版本号与「+ 新建发布」 |
| 身份服务 / 许可服务异常 | — | **不受影响**：品牌区不依赖 `identity` / `license` store |

---

## 12. 测试设计

### 12.1 单元测试映射（TDD 回归保护）

| 测试文件 | 用例 | 覆盖契约 |
|----------|------|---------|
| `src/composables/useAppVersion.test.js`（**新增，16 例**） | `extractAppVersion` 成功取值 / 去空白 / 非字符串转串 / 9 类无效输入（失败码、空串、空白串、`data:null`、`data` 缺失、`undefined`、`null`、非对象、数组）；`useAppVersion` 成功、IPC 不可用、IPC 抛错、失败码不落脏值 + `loading` 复位 | §5.1 接口契约 + §6 数据校验全表 |
| `src/layouts/YixiaoerSidebar.test.js`（**13 例，本次 +4**） | ①品牌 Logo 为 `<img>` 且 `src` 非空、`alt=Multi-Publish`、版本号文本 `v2.3.53`（单测 mock 固定值，与真实版本号解耦）且 `title=当前版本`、旧 `.yixiaoer-sidebar-brand`/`.yixiaoer-sidebar-title` 不存在；②IPC 不可用（`undefined`）→ 只有 Logo 无版本号；③失败码（`code:-1`）→ 不渲染版本号；④IPC reject → 不渲染版本号且侧边栏整体仍在渲染 | §4.1 结构契约 + §11 异常降级 |

> 既有 9 例（footer 顺序 / 登录区不在 header / 设置移出主导航 / `open-settings` 透传 / `upgrade` 开弹窗 / 服务明细与降级 / 新建发布路由）全部保留并通过，确认本次改动无结构回归。

### 12.2 视觉回归

- CI Gate 7 像素门禁（阈值 6%，`apps/desktop/tests/visual-testing/base-screenshots/`，视口 **1920×1080**）。
- 影响区域 = 侧边栏 header 约 `200×66px` ≈ **13,200px**，占全视口 **0.64%**，远低于 6% 阈值；且 `pixelmatch` 使用 `includeAA:false`，抗锯齿噪声不计入。
- 视觉环境无 `electronAPI` → 版本号不渲染，仅替换 Logo，进一步缩小差异面。

### 12.3 手工验收清单

1. 启动应用，侧边栏左上角显示汤姆鱼 Logo（紫/蓝配色、透明底、与背景融合无白边）+ 右侧灰色 `vX.Y.Z`；
2. 鼠标悬停版本号出现「当前版本」提示；Logo 不可点击、不可拖拽、不可选中；
3. 「+ 新建发布」仍在 header 右端，点击进入发布编辑器；
4. 版本号与应用 `package.json` / 会员中心「关于」卡片一致；
5. 窗口拖窄到 900px 以下：版本号消失、Logo 缩小且仍在栏宽内、导航仅剩图标；
6. 用浏览器直开 Vite（`http://localhost:5174`）无 `electronAPI`：只显示 Logo，无版本号，无控制台报错。

---

## 13. 验收标准

| # | 验收标准（可验证） |
|---|-------------------|
| 1 | 侧边栏 header 中不存在 `.yixiaoer-sidebar-brand` / `.yixiaoer-sidebar-title`，存在 `[data-testid="yixiaoer-sidebar-logo"]`（`<img>`）与 `[data-testid="yixiaoer-sidebar-version"]` |
| 2 | `apps/desktop/src/assets/brand/tom-fish-logo.png` 存在，尺寸 176×108、RGBA、体积 < 50KB |
| 3 | 版本号取自 `app:get-version`（`package.json.version`），渲染为 `v{version}`；`code!==0` / `data` 为空 / 无 `electronAPI` / IPC 抛错四种情形**均不渲染**版本节点 |
| 4 | 版本号加载失败**不产生**控制台报错、不阻塞侧边栏与主导航渲染 |
| 5 | 新增 i18n key `sidebar.brandLogoAlt` / `sidebar.appVersionTitle` 在 zh/en **成对存在**；`--cjk` 无新增硬编码 |
| 6 | 测试全绿：`useAppVersion.test.js`(16) + `YixiaoerSidebar.test.js`(13) |
| 7 | ESLint error 级 0 问题；`tsc --noEmit` 通过；债务熔断指标不越基线 |
| 8 | CI 全绿（QG Static/Unit/Coverage/Shards/Visual/E2E、electron-tests、build、doc-sync 等） |

---

## 14. 影响面与回滚

| 项 | 说明 |
|----|------|
| 改动文件 | `apps/desktop/src/layouts/YixiaoerSidebar.vue`、`apps/desktop/src/composables/useAppVersion.js`（新增）、`apps/desktop/src/composables/useAppVersion.test.js`（新增）、`apps/desktop/src/layouts/YixiaoerSidebar.test.js`、`apps/desktop/src/locales/zh.js`、`apps/desktop/src/locales/en.js`、新增 PNG 资源 |
| 对外契约 | **零变更**：无新增 props / emit / IPC / store 字段；`YixiaoerSidebar` 仍只 emit `open-settings` |
| 数据/接口 | 仅**只读**消费既有 `app:get-version`；无新增 IPC、无持久化、无 DB |
| 回滚方式 | 单 PR 纯前端改动，按提交回滚即可；无数据迁移、无状态残留 |
| 风险等级 | 低（应用壳装饰区；由 2 个测试文件 + 像素门禁保护） |

---

## 15. 相关文件

| 文件 | 职责 |
|------|------|
| `apps/desktop/src/layouts/YixiaoerSidebar.vue` | 侧边栏容器：header 品牌区（Logo + 版本号）、主导航、footer |
| `apps/desktop/src/composables/useAppVersion.js` | 版本号取数：`extractAppVersion` 纯函数 + `useAppVersion` 组合式函数 |
| `apps/desktop/src/assets/brand/tom-fish-logo.png` | 品牌 Logo 位图（176×108，RGBA） |
| `apps/desktop/electron/ipc-handlers/misc.js` | `app:get-version` handler（读 `apps/desktop/package.json.version`） |
| `apps/desktop/electron/preload/system.js` | preload `getVersion` 桥接 |
| `apps/desktop/src/api/electron-bridge.js` | 渲染层唯一 IPC 通道（`invoke('getVersion')`） |
| `docs/version-management.md` | 版本管理规范：版本号单一真相源 = 根 `package.json`，`apps/desktop/package.json` 由 `scripts/sync-version.mjs` 自动派生 |
| `docs/desktop-ui-layout-spec.md` | 布局规格（本次同步 §2.3 / §2.6 / §8.1） |
| `docs/frontend-interaction-spec.md` | 交互规范（本次同步应用壳品牌区条款） |
| `01-docs/i18n-glossary.md` | 产品名词与词条表 |
