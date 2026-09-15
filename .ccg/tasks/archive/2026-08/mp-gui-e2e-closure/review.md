# Review

## 根因

PR #355 的 shell 重构移除了参考产品工作区主 `<main>` 的 `cohere-main` 类。现有功能 E2E 的发布、账号和离线/错误路径选择器均以 `.cohere-main` 为稳定作用域，因此路由扫描仍可通过，但集成流无法找到表单、按钮和弹窗。

## 修复

恢复 `class="mp-workspace cohere-main"`。该改动只恢复兼容语义，不改变布局或业务状态。

## 验证

- `npm run build:vue`：通过。
- `npm run test:e2e:flows`：Flow 1-6 全部通过（6/6，0 console errors，0 page errors）。
- 失败回归的远程 GUI 日志已确认缺失 `.cohere-main` 是共同原因；修复后等待 PR 门禁重跑。

## 风险

低风险，单一模板 class 兼容修复；若后续移除旧选择器，应先提供新的稳定 `data-testid` 合同并同步迁移 E2E。
