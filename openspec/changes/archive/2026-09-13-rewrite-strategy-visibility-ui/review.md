# 双模型审查记录 — rewrite-strategy-visibility-ui

日期：2026-09-11 | 分支：codex/rewrite-strategy-ui | PR：#1717

## 审查执行情况

| 模型 | 首轮 | 修复后复审 |
|---|---|---|
| Claude（claude backend） | 完成，1 必修 + 4 应修 | 待 CI 后抽查 |
| opencode | 首次调用未收到任务体（只返回打招呼），已用最终 diff 重试 | 进行中 |

## Claude 审查结论与处置

| 级别 | 问题 | 位置 | 处置 |
|---|---|---|---|
| 🔴 必修 | 全角冒号硬编码在模板，英文界面显示中文冒号 | RewriteStrategyPicker.vue 模板 | 已修：抽为 i18n key strategyPreviewColon（zh 全角/en 半角+空格） |
| 🟡 应修 | 改写结束后预览不刷新（改写期间平台可能变化；引擎 userHistory 更新影响推荐） | RewriteView.vue startRewrite finally | 已修：finally 中调 refreshStrategyPreview()，附注释说明两个原因 |
| 🟡 应修 | 平台快速切换竞态：慢的旧请求返回会覆盖新结果 | refreshStrategyPreview | 已修：previewSeq 序列号守卫，过期响应直接丢弃 |
| 🟡 应修 | 测试缺 3 处覆盖（改写后刷新/竞态/边界） | RewriteView.test.js | 已补 2 个用例：改写后预览刷新（第 2 次调用断言）、竞态丢弃过期结果（慢快双请求） |
| 🟡 应修 | mock 条件 strategy-douyin 与实际策略 id strategy-douyin-viral 不匹配 | RewriteView.test.js | 已修：对齐为 strategy-douyin-viral |
| 🟢 可选 | 其余 4 项低优先级建议 | — | 记录备查，不阻塞 |

## Claude 正面确认

- AiWriterPanel 策略传参契约完全对齐（strategyId 语义一致）
- IPC 安全态势（withSenderCheck 仅在变更端点）是预存设计，本分支未引入新攻击面

## 债务门禁事故与修复（CI 首轮失败）

首轮 CI「债务熔断门禁」失败：FILES_OVER_500 85 > 基线 84。根因：RewriteView.vue 从 491 行涨到 589 行，新过 500 行债务线。修复：

1. 策略区块抽为展示层组件 RewriteStrategyPicker.vue（104 行，v-model 透传，无 IPC 耦合）
2. RewriteView 独占样式（结果区/配置区/textarea）上移 cohere-design-system.css
3. RewriteView 最终 458 行，债务指标回到基线内（84=84）

教训：改既有页面前列检查该文件行数与 500 行债务线的距离，预留抽组件的空间。

## opencode 复审结论（最终 diff）

opencode 独立核对了 API 三层链路（publisher.js → preload → ipc-handlers → rewrite-engine-core）、AiWriterPanel 行为对齐、全局样式存在性与类名冲突，并实际运行了测试与 lint。结论：

**确认项**：传参契约（strategyId=null 走 StrategyMatcher）链路正确；previewSeq 竞态守卫 + rewriting 守卫 + finally 刷新逻辑合理；降级路径完整；i18n 成对；全局类名无冲突；测试 26 passed、lint clean。

**发现的问题与处置**：

| 级别 | 问题 | 处置 |
|---|---|---|
| Info | `--danger` CSS 变量全库未定义，`.content-error` 颜色不生效（旧 scoped 遗留，本次迁入全局） | 已修：改为硬编码 #d32f2f（与 .rewrite-error 一致） |
| Info | RewriteStrategyPicker 声明了 refresh-preview emit 但从未触发，父组件死绑定 | 已修：删除死 emit 与死绑定 |
| Info | 按钮 coral→var(--primary) 视觉变化（scoped 删除后落到设计系统全局样式） | 接受：与设计系统对齐是预期方向 |

## 最终验证

- RewriteView.test.js：26 passed（含 10 个策略用例）
- AiWriterPanel.test.js 回归：19 passed
- eslint clean；locale pair check PASS；债务门禁全指标基线内
- CI：PR #1717 全量重跑中（结果见 PR 页）
