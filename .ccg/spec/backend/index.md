# Backend Spec — 后端编码规范

> 本文件定义后端代码的编码规范。子 Agent 在写代码前会自动读取此文件。
> 按项目实际情况修改内容。

## API 规范

- 路由命名: RESTful, kebab-case
- 请求/响应格式: JSON, camelCase fields
- 错误格式: `{ "error": { "code": "...", "message": "..." } }`
- 认证: Bearer token in Authorization header

## 错误处理

- 所有 API 端点必须返回结构化错误
- 4xx: 客户端错误（验证失败、未授权等）
- 5xx: 服务端错误（包装内部异常，不暴露堆栈）
- 超时: 设置合理超时，超时后返回 504

## 测试要求

- 核心逻辑覆盖率 > 80%
- API 端点必须有集成测试
- 测试命名: `describe('模块') → it('should 行为')`

## 安全清单

- [ ] 输入验证（不信任任何用户输入）
- [ ] SQL 参数化（禁止字符串拼接）
- [ ] 密钥不硬编码（使用环境变量）
- [ ] 敏感数据日志脱敏

## 采集引擎（url-collector）导航竞态（2026-09-13，fix-zhihu-stealth-navigation）

- stealth 浏览器采集 page.content() 在页面导航中会抛 Unable to retrieve content because the page is navigating。该错误消息不含已知分类关键词，会被 classifyCollectError 判为 unknown（UI 显示「原因未识别」误导用户）。
- 强制点：page.content() 必须经 _readPageContentWithRetry（导航竞态等待后重试，最多 3 次）；page.goto 用 waitUntil: 'load' 而非 networkidle（知乎等 SPA 持续轮询下 networkidle 可能永不满足）。
- 强制点：collect() catch 必须把导航竞态错误（消息含 navigating/navigation）归类为 content_unextractable（可重试），不得让 unknown 泄漏到 UI。
- 回归保护：新增导航竞态重试成功/非导航不重试/导航错误分类/非导航不附加 reason 四类测试。
