## Why

task-051 的上一阶段已经提交视频发布模式、封面提取、发布进度和快手入口修复，但交接只保留了静态代码证据，缺少快手真实登录/发布结果、当前分支测试收口、PR 和 UX 交付闭环。继续扩大“蚁小二对齐”范围会把真实平台依赖和纯 renderer UX 混在一起，导致验收不可追踪。

## What Changes

- 以独立 Electron debug profile 验证快手扫码登录、登录态重启恢复和视频发布；验证过程只使用测试账号和人工确认的最终发布动作。
- 为快手二维码按钮、视频模式、发布进度和封面提取补齐可执行回归证据。
- 修复已确认的测试/契约问题：发布标题校验断言与当前用户文案合同一致；平台 cookie domain 只能匹配明确的注册域边界，不能把整个 baidu.com 作为百家号 cookie 域。
- 落地第一批可独立验收的 UE 改进：发布页 sticky 主操作区、账号页连接状态不再固定宣称成功、移动宽度布局检查。
- 同步 PRD、CHANGELOG、OpenSpec/CCG 进度，并在 PR 中记录真实验证边界。

## Capabilities

### New Capabilities

- desktop/yixiaoer-ue-closure：task-051 的真实发布验收证据、发布页/账号页 UX 状态契约和回归测试。

### Modified Capabilities

- desktop/account-login-capture：快手作为二维码登录平台时按钮状态、登录地址和恢复态必须可验证。
- desktop/publish-flow：视频模式、封面和阶段进度必须有 renderer/主进程回归保护。

## Impact

- 运行时代码：apps/desktop/src/views/Publish.vue、Accounts.vue、布局/状态组件；平台定义与测试。
- 主进程/共享代码：仅在测试暴露真实缺陷时修改；不得通过放宽平台域名边界绕过登录问题。
- 文档：01-docs/PRD.md、CHANGELOG.md、本 change 和 CCG task。
- 外部依赖：快手账号、手机扫码、第三方页面结构和网络；这些结果必须标注为现场证据，而不是单测结果。
