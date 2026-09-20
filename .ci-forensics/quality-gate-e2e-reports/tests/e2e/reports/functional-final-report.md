# Multi-Publish 前端功能 E2E 测试报告

## 总览

- 路由覆盖: 17/17 (100%)
- 路由检查: 261/261 通过 (0 失败)
- 路由 console errors: 0
- 路由 page errors: 0
- 集成流: 6/6 通过
- 集成检查: 43/43 通过
- 集成流 console errors: 0
- 集成流 page errors: 0
- **总计: 304/304 checks 通过, 0 errors**

## 路由覆盖矩阵

| 路由 | 路径 | 检查 | 通过 | 失败 | Console | 状态 |
|------|------|------|------|------|---------|------|
| 首页 / 仪表盘入口 | `/` | 12 | 12 | 0 | 0 | ✅ PASS |
| 评论管理 | `/comments` | 11 | 11 | 0 | 0 | ✅ PASS |
| 首次运行 / 配置向导 | `/first-run` | 11 | 11 | 0 | 0 | ✅ PASS |
| 一键发布 | `/publish` | 12 | 12 | 0 | 0 | ✅ PASS |
| 账号管理 | `/accounts` | 14 | 14 | 0 | 0 | ✅ PASS |
| 数据看板 | `/dashboard` | 14 | 14 | 0 | 0 | ✅ PASS |
| 内容采集 | `/collection` | 13 | 13 | 0 | 0 | ✅ PASS |
| 关键词监控 | `/keywords` | 13 | 13 | 0 | 0 | ✅ PASS |
| 爆款分析 | `/viral-analysis` | 14 | 14 | 0 | 0 | ✅ PASS |
| 模型服务商 | `/model-providers` | 14 | 14 | 0 | 0 | ✅ PASS |
| AI 创作 | `/create` | 58 | 58 | 0 | 0 | ✅ PASS |
| 创作结果 | `/create/result` | 10 | 10 | 0 | 0 | ✅ PASS |
| 创作流水线 | `/create/pipeline` | 11 | 11 | 0 | 0 | ✅ PASS |
| 创作历史 | `/create/history` | 14 | 14 | 0 | 0 | ✅ PASS |
| 云端发布 | `/cloud-publish` | 12 | 12 | 0 | 0 | ✅ PASS |
| 智能助手 | `/intelligence` | 15 | 15 | 0 | 0 | ✅ PASS |
| 排期日历 | `/calendar` | 13 | 13 | 0 | 0 | ✅ PASS |

## 集成流

| Flow | 名称 | 检查 | 通过 | 失败 | 状态 |
|------|------|------|------|------|------|
| flow-1 | 创建 → 发布 → 看板 | 12 | 12 | 0 | ✅ PASS |
| flow-2 | 账号管理 → 侧栏 → 发布 | 8 | 8 | 0 | ✅ PASS |
| flow-3 | 模型服务商 → AI 写作 | 7 | 7 | 0 | ✅ PASS |
| flow-4 | 监控 → 评论回复 | 5 | 5 | 0 | ✅ PASS |
| flow-5 | 设置变更级联 | 6 | 6 | 0 | ✅ PASS |
| flow-6 | 错误路径 | 5 | 5 | 0 | ✅ PASS |