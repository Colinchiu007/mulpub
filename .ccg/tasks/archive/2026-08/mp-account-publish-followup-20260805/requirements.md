# 续作需求：参考产品账号与发布 parity

## 本轮范围
- 不新建分支，继续 `codex/mp-parity-followup-20260804`。
- 保留三个既有未提交文件，不暂存、不恢复、不提交：
  - `apps/desktop/electron/preload/index.bundle.js`
  - `packages/ai-writer/src/cli.js`
  - `packages/api-publish-engine/bin/publish-api`
- 先修可由本地代码和回归测试证明的账号数据契约、代理设置契约及相关 UI 流程。
- 对真实第三方登录、团队分享、跨设备同步等未有证据的能力保持外部边界标记，不伪造完成。

## 验收
- `accounts:list` 返回的公开账号字段能够支撑卡片展示粉丝、负责人、发布人、检查时间和检查原因，同时继续剥离 cookie/token 等敏感字段。
- `account:set-proxy` 明确等待持久化结果，失败时 IPC 返回可断言的错误，不遗留未处理 Promise。
- 已配置代理重新打开对话框时保留非敏感 endpoint/type，凭据仍保持掩码或明确替换语义；保存/清除可回归。
- 相关单元/组件测试、Vue 构建、视觉回归和适用打包门禁通过；未把本地环境阻断误报为通过。
