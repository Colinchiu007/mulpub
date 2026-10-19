# Multi-Publish 前端功能 E2E 测试报告

## 总览

- 路由覆盖: 17/17 (100%)
- 路由检查: 135/142 通过 (7 失败)
- 路由 console errors: 4
- 路由 page errors: 0
- 集成流: 0/6 通过
- 集成检查: 0/6 通过
- 集成流 console errors: 0
- 集成流 page errors: 0
- **总计: 135/148 checks 通过, 4 errors**

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
| AI 创作 | `/create` | 8 | 7 | 1 | 4 | ❌ FAIL |
| 创作结果 | `/create/result` | 1 | 0 | 1 | 0 | ❌ FAIL |
| 创作流水线 | `/create/pipeline` | 1 | 0 | 1 | 0 | ❌ FAIL |
| 创作历史 | `/create/history` | 1 | 0 | 1 | 0 | ❌ FAIL |
| 云端发布 | `/cloud-publish` | 1 | 0 | 1 | 0 | ❌ FAIL |
| 智能助手 | `/intelligence` | 1 | 0 | 1 | 0 | ❌ FAIL |
| 排期日历 | `/calendar` | 1 | 0 | 1 | 0 | ❌ FAIL |

## 集成流

| Flow | 名称 | 检查 | 通过 | 失败 | 状态 |
|------|------|------|------|------|------|
| flow-1 | 创建 → 发布 → 看板 | 1 | 0 | 1 | ❌ FAIL |
| flow-2 | 账号管理 → 侧栏 → 发布 | 1 | 0 | 1 | ❌ FAIL |
| flow-3 | 模型服务商 → AI 写作 | 1 | 0 | 1 | ❌ FAIL |
| flow-4 | 监控 → 评论回复 | 1 | 0 | 1 | ❌ FAIL |
| flow-5 | 设置变更级联 | 1 | 0 | 1 | ❌ FAIL |
| flow-6 | 错误路径 | 1 | 0 | 1 | ❌ FAIL |

## Issue 列表

- **CRITICAL** [路由检查失败] create: AI 创作 (/create) failed=1 consoleErrors=4
  - 修复建议: 查看 reports/create.functional.json 并修复
- **CRITICAL** [路由检查失败] result: 创作结果 (/create/result) failed=1 consoleErrors=0
  - 修复建议: 查看 reports/result.functional.json 并修复
- **CRITICAL** [路由检查失败] pipeline: 创作流水线 (/create/pipeline) failed=1 consoleErrors=0
  - 修复建议: 查看 reports/pipeline.functional.json 并修复
- **CRITICAL** [路由检查失败] create-history: 创作历史 (/create/history) failed=1 consoleErrors=0
  - 修复建议: 查看 reports/create-history.functional.json 并修复
- **CRITICAL** [路由检查失败] cloud-publish: 云端发布 (/cloud-publish) failed=1 consoleErrors=0
  - 修复建议: 查看 reports/cloud-publish.functional.json 并修复
- **CRITICAL** [路由检查失败] intelligence: 智能助手 (/intelligence) failed=1 consoleErrors=0
  - 修复建议: 查看 reports/intelligence.functional.json 并修复
- **CRITICAL** [路由检查失败] calendar: 排期日历 (/calendar) failed=1 consoleErrors=0
  - 修复建议: 查看 reports/calendar.functional.json 并修复
- **MAJOR** [集成流失败] flow-1: 创建 → 发布 → 看板 failed=1 consoleErrors=0 pageErrors=0
  - 修复建议: 查看 reports/integration.flow-1.json
- **MAJOR** [集成流失败] flow-2: 账号管理 → 侧栏 → 发布 failed=1 consoleErrors=0 pageErrors=0
  - 修复建议: 查看 reports/integration.flow-2.json
- **MAJOR** [集成流失败] flow-3: 模型服务商 → AI 写作 failed=1 consoleErrors=0 pageErrors=0
  - 修复建议: 查看 reports/integration.flow-3.json
- **MAJOR** [集成流失败] flow-4: 监控 → 评论回复 failed=1 consoleErrors=0 pageErrors=0
  - 修复建议: 查看 reports/integration.flow-4.json
- **MAJOR** [集成流失败] flow-5: 设置变更级联 failed=1 consoleErrors=0 pageErrors=0
  - 修复建议: 查看 reports/integration.flow-5.json
- **MAJOR** [集成流失败] flow-6: 错误路径 failed=1 consoleErrors=0 pageErrors=0
  - 修复建议: 查看 reports/integration.flow-6.json