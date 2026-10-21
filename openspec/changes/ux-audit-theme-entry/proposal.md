## Why

暗色主题的实现与整改成果**在用户侧完全不可达**：`apps/desktop/src/composables/useTheme.js` 已完整实现（读写 electron store 的 `ui:theme`、无偏好时跟随 `prefers-color-scheme`、把结果写到 `document.documentElement` 的 `data-theme`），但全仓**零生产消费方**（`git grep useTheme -- apps/desktop/src` 现场只命中该文件自身与它自己的测试）。后果是全仓约 72–77 处 `[data-theme="dark"]` 样式分支、以及「深色低对比 61→0」那一整轮整改，只在该属性被写入时才生效——而运行期没有任何代码写它；此前唯一写它的是视觉测试 runner 自己注入（`test-runner.js:519 _applyTheme`），于是暗色呈现成为一种**只有 CI 看得到、用户看不到**的状态。UX 审计阶段 1 条目 1.1 记录的正是这一格。

## What Changes

- **新增用户可见入口**：设置弹窗 `SettingsDialog.vue` 增加「外观」Tab 与 `AppearanceSettings.vue` 面板，提供**三态**选择——跟随系统 / 浅色 / 暗色，选择即时生效且跨会话持久。
- **`useTheme` 从"每次调用各建一份状态"改为应用级单例**：现状每个调用方 `useTheme()` 都新建 `theme` ref、各自注册 `matchMedia` 监听、各自写 DOM 属性 ⇒ 两个消费方必然漂移（一方切色另一方读数不变，且两个监听互相覆盖写入）。改为模块级共享状态 + 单一写入者。
- **持久化取值收敛为闭合词表 `light | dark | system`**：`system` 表示"无用户偏好、跟随系统"。现状 `preferredTheme = null` 才能跟随系统，而界面无法把状态**显式表达为**"我要跟随系统"，也无法从"已存 light"退回跟随。
- **首帧不得闪**：挂载前用同步可读的镜像上一次色，挂载后以 electron store 异步读回校准。镜像**只是首帧缓存，不是第二份事实**；优先级与收敛口径显式规定并锁住。
- **控件必须满足本仓既有无障碍合同**：可访问名（label 而非 placeholder）、键盘可达、`:focus-visible` 焦点环；新增文案 zh/en **成对**写入 locales。
- **更正一句描述不存在的注释**：`tests/visual-testing/test-runner.js:511` 写着「`data-theme` 是应用唯一的主题开关（`useTheme.js` 的 `applyTheme` 写的就是它）」——接线不存在时该句为假；本批接线后按事实改写（谁写、何时写、runner 注入与用户偏好的关系）。
- **视觉基线同源刷新**：设置页在像素判定域内（`settings-general`，浅/暗两档），新增 Tab 必然改动基线 ⇒ 只能取同一次 CI 渲染产物重建，**禁止**本机 `test:visual:update-baseline` 或 `--update-baseline` 消化。

非破坏性变更：既有 `ui:theme` 取值 `light`/`dark` 继续有效；`null`/键缺失继续表示跟随系统（等价于新的 `system`）。

## Capabilities

### New Capabilities
- （无）

### Modified Capabilities
- `desktop-ui-consistency`: 新增一条 Requirement「暗色主题必须对用户可达且状态唯一」——规定运行期必须存在**一个**用户可达的开关写入 `data-theme`、主题状态必须应用级单例、持久化取值必须是闭合词表 `light|dark|system`、以及首帧不得依赖异步读回。既有「主题令牌必须自带暗色覆盖」Requirement **不改写**（那部分功能已交付，本批只补可达性那一格，不重复规格化）。

## Impact

- **代码**：`apps/desktop/src/composables/useTheme.js`（单例化 + 三态 + 镜像）、`apps/desktop/src/components/SettingsDialog.vue`（新 Tab）、新增 `apps/desktop/src/components/AppearanceSettings.vue`、`apps/desktop/src/locales/settings/{zh,en}.js`（成对新增文案）、`apps/desktop/tests/visual-testing/test-runner.js`（注释更正）。
- **测试**：新增 `AppearanceSettings.test.js` 与 `useTheme` 单例/三态/首帧行为锁；`SettingsDialog.test.js` 需登记新 Tab；受影响的 `settings-panel-layout` / `element-plus` 组件登记与焦点环合同锁需同跑。
- **视觉**：`settings-general` 浅暗两张基线须按同一次 CI 渲染重建（判定域与新鲜度门禁 `check-baseline-freshness.js` 会核对"基线 == 本次 CI 渲染"）。
- **无新增依赖**；不触碰 IPC 协议、不动 electron 主进程；`ui:theme` 键沿用 `storeGetSetting/storeSetSetting` 既有通道。
- **残余边界（不假装已覆盖）**：暗色呈现此前只在 CI 注入下被看过，首次由用户开关驱动的暗色可能暴露个别未适配视图——本批以判定域暗档为验收面，发现的具体缺项按文件登记欠账、不在本批顺手改。
