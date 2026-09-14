# 需求

- 保持参考产品工作区的新布局，同时保留现有发布、账号和设置变更 GUI E2E 依赖的 `.cohere-main` 稳定容器合同。
- 不改变页面业务交互，仅恢复容器语义，确保旧选择器和新版工作区同时可用。

## 验收标准

- `apps/desktop/src/App.vue` 的参考产品工作区主内容同时包含 `mp-workspace` 与 `cohere-main`。
- Vue 生产构建通过。
- 六条集成流全部通过，且无 console/page error。
- 不修改无关的 preload 生成文件或其他工作树。
