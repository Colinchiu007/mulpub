# Plan：CCG 审查修复

1. 修复 `account.js`：W1 脱敏正则、W4 复数别名 + 数组归一化、I2 判空、I3 端口归一化。
2. 补充测试：W1 脱敏反例、W3 双路径契约、W4 publishers、I3 字符串端口；W2 在 `useAccountEvents.test.js` 补 reopen/closed 清空。
3. 运行定向测试（account.test.js、useAccountEvents.test.js、Accounts.test.js、AccountProxyDialog.test.js）。
4. 运行全量桌面 Vitest、ESLint、Vue 构建；必要时视觉像素回归。
5. 更新 PRD/parity 分析/开发报告；CCG 双模型复审（Claude + 主代理）。
6. 提交、推送、PR、等待 checks、合并 main、更新记忆。
