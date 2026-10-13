# Summary — 对抗评审循环汇总（oss-reinforcement-plan）

> 任务：Multi-Publish 开源强化研究方案（4 份文档）的外部评审收敛
> 出方案方：opencode-hosted（step-5-preview）｜评审方兄弟家族：claude（CCG backend primary，家族校验通过）
> 双轴来源：QM-6 CCG 双模型外部评审（前端轴 opencode + 后端轴 claude 并行）

## 轮次与产物

| 轮次 | 评审方 | 产物 | 结果 |
|------|--------|------|------|
| Round 1a | 前端轴 opencode | `critique-v1-frontend.md` | 15 findings（4 HIGH/7 MEDIUM/4 LOW） |
| Round 1b | 后端轴 claude | `critique-v1-backend.md` | 10 findings（1 Critical/4 Warning/5 Info）+ 7 条许可证复核 |
| Rebuttal 1 | 出方案方 | `rebuttal-v1.md` | 前端轴 15 条全部接受（附本仓代码级证据） |
| Rebuttal 2 | 出方案方 | `rebuttal-v2.md` | 后端轴 10 条全部接受（RSSHub 已完成 LICENSE 原文复核） |
| Round 2 | claude | `critique-v2-round2.md` | 17/20 已落实，**未收敛**（最低维 7.5，6 项跨文档同步遗漏） |
| Round 3 | claude | `critique-v3-convergence.md` | 7 项必改全部「已修」，**已收敛** |

## 分数曲线

| 维度 | Round 2 | Round 3 |
|------|---------|---------|
| 完整性 | 7.5 | **9.0** |
| 一致性 | 7.5 | **9.0** |
| 清晰度 | 8.5 | **9.0** |
| 可行性 | 8.5 | **9.0** |
| 安全性 | 9.0 | **9.0** |
| **最低维** | **7.5（未收敛）** | **9.0（收敛，阈值 8.0）** |

## 实质性修订（评审改变方案的关键点）

1. **H1/F1-c 注入通道证伪**：原「preload 注入 stealth evasions」方案经 Electron `contextIsolation:true+sandbox:true` 语义实证不成立（隔离世界 patch 碰不到主世界，且现有 stealth-preload.js 头注是错误声明）→ 改为 `webContents.debugger`+`Page.addScriptToEvaluateOnNewDocument`（本仓 webview-manager/utils.js:143 已有同款基建与回归锁）
2. **FIND-1 法务门禁（Critical）**：反检测+验证码作为商业产品能力的法务放大面 → B1 启动前置门禁（逐平台 ToS 边界/破解默认关/销售条款/官方 API 优先登记），无结论不进 QM-6
3. **FIND-6**：删除不存在的主进程 isolated world API 组合，spike 改验两条实证路径（`Page.createIsolatedWorld`+`Runtime.evaluateInWorld` / preload webFrame 中继）
4. **H3**：行为层先定义传输无关接口（dispatch/getBounds/typeText），杜绝在错误抽象上锁测试
5. **H4**：B1 数据口径契约（风控拦截率定义/分层/对照/样本量 n≥15/数据源自产）
6. **许可证 3 件套纪律**：API spdx_id 不可信（biliup/DrissionPage/XTTS 三连命中），RSSHub 复核确认 AGPL-3.0

## 结论

25 条 findings 全部采纳并落实到正确层；跨文档同步遗漏 6 处在 Round 3 全部清除。方案以 v3.1 完结态进入实施规划冻结，等用户启动开发。
