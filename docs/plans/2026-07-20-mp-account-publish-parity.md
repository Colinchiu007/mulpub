# 参考产品账号管理与内容发布对齐实施计划

> **For Codex:** 使用 `Executing Plans` 工作流逐项实施，并在每个行为切片中遵循 TDD 红-绿-重构。

**目标：** 在保持顶部导航和最左侧平台账号列表不变的前提下，将账号管理与内容发布模块补齐到可验证的参考产品功能对齐状态，并建立可独立替换的设计层、用例层和 Electron 适配层。

**架构：** Vue 页面只负责渲染和用户事件，`features/*` 与 composables 负责业务状态及用例，`api/*` 统一访问 preload/IPC，Electron handler 只做参数校验和用例调用。参考产品 React 构建产物仅作为字段、状态、交互和视觉证据，不直接加载其 bundle。

**技术栈：** Vue 3、Pinia、Vitest、Electron IPC、SQLite、Playwright/本地视觉回归。

---

## 测试场景脑暴

1. 同一平台选择多个账号后，应为每个账号生成独立发布目标；默认账号仅用于首次预选。
2. 定时发布时间合法时创建持久化计划；过去时间、超过 30 天、同平台间隔不足 5 分钟时阻止提交。
3. 发布中的任务可取消，失败任务可带原始内容重试，重复点击不会重复入队。
4. 草稿保存并恢复标题、正文、作者、封面、视频、平台账号、发布时间和差异化内容。
5. 账号状态变化事件能刷新列表；分组和收藏能持久化、筛选并参与账号选择。
6. Electron bridge 不存在时页面显示明确的不可用状态，不抛出未捕获异常。
7. UI 在桌面、平板和移动宽度下不覆盖顶部导航或左侧账号栏，核心控件不溢出。

## Task 1：统一账号与发布前端契约

**Implementation：**
- 修改 `apps/desktop/src/api/publisher.js`、`apps/desktop/src/api/accounts.js`。
- 新增/调整 composables，使页面不直接访问 `window.electronAPI`。
- 发布目标统一为 `{ platform, accountId }[]`，同平台允许多个账号。

**Testing：**
- [ ] 正常路径：多平台、多账号目标展开。
- [ ] 异常路径：无 bridge、无账号、重复账号。
- [ ] 集成：preload 暴露的方法与 API 封装一致。

**Documentation：**
- [ ] 更新 PRD 状态与接口说明。

**Review：**
- [ ] 自审直接 Electron 调用。
- [ ] 跨代理审查接口兼容性。

## Task 2：账号分组、收藏与实时状态

**Implementation：**
- 为账号元数据补充分组、收藏和认证方式字段，提供迁移兼容。
- 账号页支持分组成员、收藏切换、状态事件和重新登录入口。

**Testing：**
- [ ] CRUD、默认账号、收藏、分组、状态刷新。
- [ ] 删除账号后的级联清理和无效分组引用。
- [ ] IPC sender 校验。

**Documentation：**
- [ ] 更新账号管理验收标准和数据模型。

**Review：**
- [ ] 数据迁移和事务审查。
- [ ] Electron 安全审查。

## Task 3：多账号发布、定时、取消与重试

**Implementation：**
- 扩展 `usePlatformSelection` 与 `usePublishFlow`。
- 接入 scheduler、cancel 和 retry API。
- 批量模式支持每篇文章的平台账号映射。

**Testing：**
- [ ] 多账号展开、定时校验、取消、重试、幂等。
- [ ] 单平台失败不影响其他目标。
- [ ] IPC 参数 JSON 脱壳。

**Documentation：**
- [ ] 更新发布流程和错误状态机。

**Review：**
- [ ] 任务状态机与并发审查。
- [ ] 真实依赖回归测试。

## Task 4：草稿与平台差异化内容

**Implementation：**
- 合并重复草稿存储路径，保存完整文章模型。
- 增加可达的差异化编辑面板及平台限制校验。

**Testing：**
- [ ] 完整草稿往返、旧草稿迁移。
- [ ] 标题/正文/标签边界与危险 HTML。

**Documentation：**
- [ ] 更新内容字段规范。

**Review：**
- [ ] XSS 与平台约束审查。

## Task 5：参考产品视觉对齐和页面拆分

**Implementation：**
- 保留 AppNavbar 与最左侧账号栏结构。
- 将账号与发布主区拆成纯展示组件，统一 token、基础控件、空态、状态颜色和响应式规则。

**Testing：**
- [ ] 组件渲染、props、emits。
- [ ] 账号/发布核心视图像素、OCR 和工作流回归。

**Documentation：**
- [ ] 更新设计 token 和组件使用指南。

**Review：**
- [ ] 可访问性、响应式和视觉一致性审查。

## Task 6：完整门禁与交付

**Implementation：**
- 更新 CHANGELOG、开发报告、learnings 和质量门禁记录。

**Testing：**
- [ ] 单元、覆盖率、故障注入、E2E、视觉回归。
- [ ] Electron preload sandbox 两种模式。
- [ ] Windows 打包、asar 清单、require 链和启动 8 秒。

**Review：**
- [ ] Review Army：测试、可维护性、安全、性能、数据迁移、API、设计、红队。
- [ ] 修复全部 CRITICAL/MAJOR 后再提交、推送和合并。
