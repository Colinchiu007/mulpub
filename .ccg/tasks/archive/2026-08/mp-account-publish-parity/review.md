# 本地代码审查：账号管理与内容发布参考产品对齐

审查日期：2026-08-04
工作树：`C:/tmp/Multi-Publish-mp-account-publish-parity`
分支：`codex/mp-account-publish-parity-20260803`

## 审查范围

- `App.vue` 与 `MpModuleNav` 工作区壳层。
- 账号 Store、账号卡片、分组管理、批量状态/删除和登录状态展示。
- 发布目标、媒体/封面/标签/话题/@元数据、单篇/批量流程、草稿和发布历史。
- 视觉选择器、像素基线、功能性视觉回归和 Electron 视觉合同测试。
- PRD、测试矩阵、逆向证据和任务上下文。

## 外部审查状态

- Antigravity：未运行，wrapper 报 `agy command not found`。
- Claude：未运行，wrapper 以退出码 1 结束。
- 因此没有声称“双模型审查通过”；以下结论仅来自本地静态审查、测试和构建证据。

## 结论分级

### Critical

- 无。未发现本轮新增的硬编码密钥、`v-html`/动态 `eval`、未脱壳的 reactive IPC 参数、跨租户数据写入或发布目标绕过。

### Warning

1. **设计/代码分离仍未完成**：账号、发布、历史仍同时使用 scoped CSS、inline style 和全局 token；草稿列表与平台元数据也存在重复来源。已在 PRD 和逆向分析中登记为后续债务。
2. **团队能力保持诚实边界**：`/accounts?tab=share` 只显示未接入提示；负责人/发布人筛选为 disabled 占位。没有用前端假数据冒充团队分享、权限或跨设备同步。
3. **真实第三方流程未覆盖**：手机号/密码/验证码、二维码过期、平台 Cookie、签名上传、审核和线上失败重试需要真实账号、网络和平台环境，不能由本地 mock 证明。
4. **打包环境提示**：Windows builder 成功，但配置引用的 `.playwright-browsers` 目录在当前工作树不存在；8 秒启动形成真实顶层窗口，stderr 只有既有 Logto `oidc.invalid_grant` 外部认证错误。该证据不能等价于线上登录通过。
5. **全局 lint 基线问题**：全量 lint 报告 15 个既有错误、84 个警告，集中在未由本轮修改的 Electron/生成 bundle/其他页面；本轮变更文件定向 lint 为 0 错误、2 个既有警告。

### Info

- 批量启用/禁用现在只提交当前可见且已选中的账号 ID；隐藏筛选项不会被误更新。
- 非法标签、话题、@好友和文件描述在发布合同层拒绝，不再静默丢弃。
- 账号/发布/发布记录像素基线已人工审阅后刷新；`model-providers` 基线也因同轮已有 1% 以上稳定漂移一并刷新，未改变该页面业务逻辑。
- 运行时截图和功能报告位于被忽略的测试目录，不进入提交；没有提交 Cookie、二维码、账号凭据或解包产物。

## 验证证据

| 检查 | 结果 |
|---|---|
| 定向 Vitest（账号/发布等） | 通过；最终全量覆盖见下项 |
| 桌面全量 Vitest | 341 个文件、5934 个用例通过 |
| Vue/Preload 构建 | `npm run build:vue --workspace @multi-publish/desktop` 通过；Windows 打包前再次通过 |
| 变更文件定向 lint | 0 errors，1 warning（`Accounts.vue:509` 未使用的既有辅助函数） |
| 像素视觉门禁 | 17/17 通过 |
| 单视图视觉断言 | 全部通过 |
| 功能性视觉回归 | 25/25 通过 |
| Windows x64 Electron Builder | 退出码 0 |
| asar 清单 | 包含 main/preload、配置和 workspace runtime |
| 隔离 asar require | `@multi-publish/rpa-engine` 加载通过 |
| 打包启动 | 真实窗口 `MAIN_WINDOW_HANDLE=1640054`、标题“社媒管家”、stderr 为空 |

## 交付建议

合并前保留本报告和 PRD 边界声明；若要宣称更高 parity，应先补真实登录/团队服务/平台发布 E2E，再继续抽取共享 draft view-model、平台 adapter 和语义 CSS token。不得把本地视觉基线通过率解释为参考产品线上功能 100% 等价。
