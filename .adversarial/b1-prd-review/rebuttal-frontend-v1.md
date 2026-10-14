# Rebuttal — B1 PRD 前端轴评审回应（2026-10-14）

> 出方案方：opencode-hosted（step-5-preview）｜评审方：opencode（session ses_ec6a40cd5，stdin 单行 prompt 重试成功——首次长中文 argv/多行 stdin 均被 opencode CLI 截断，单行 prompt 修复）
> 说明：后端轴 8 条见 rebuttal-backend-v1.md（同目录），本文件只回应前端轴 8 条。全部接受。

## 逐条回应（8 条，全部接受）

### F-FE1（高）captcha 人工兜底交互闭环未定

**回应：接受（L1）。** 我原 PRD 只有两条文案，确实没有状态机。

**落修订（PRD v1.1 §3.5 新增状态机小节）**：
```
detecting → auto_ocr(超时 T1=15s) → manual(超时 T2=120s + 面板动作) → fail
```
- `detecting`：检测到验证码要素（模板/尺寸特征），进度面板 captcha 相位「检测中」
- `auto_ocr`：识别+派发中；T1 超时 → manual
- `manual`：面板出现三个动作——「重试自动识别」/「我已完成」/「放弃本通道」；用户操作发布窗口完成验证后点「我已完成」；T2 超时 → fail（不无限挂起）
- 阻塞语义：manual 期间该发布任务阻塞（TaskQueue 同通道天然串行，不阻塞其他平台）；T1/T2 走 env 覆盖（`MP_CAPTCHA_T1_MS`/`T2_MS`，非法值回落默认+出声告警——对齐项目 env 纪律）

### F-FE2（高）PR-1 引入 captcha 相位但渲染层无对应 UI 契约

**回应：接受（L1）。** 三处手工同步无机制保障+未知相位降级行为未定义。

**落修订**：①PR-1 必须含**未知相位 fallback 渲染**（面板遇未登记相位显示通用相位文案，**禁透传 code 原值**——项目 E2E 夹具纪律同源）；②新增单测断言 `PHASE_ENUM ⊆ emitter 分支` 且 `TERMINAL_PHASES` 由 `PHASE_ENUM` **派生**（改并列维护即红）；③captcha 相位的完整 UI 放 PR-2（与 F4 sidecar 同 PR），PR-1 只入枚举+fallback+单测——** finding 2 是 PR-1 的前置补丁，接受并前移**。

### F-FE3（中）通道降级提示时机与残留

**回应：接受。** 落修订：**一次性事件语义**——按 `(channel + runId)` 去重，同一次发布内重复降级只提示一次；**双承载**：toast（即时告知）+ 进度面板常驻行（发布中可见）；**结果留痕**：发布结果记录带 `stealthChannelFallback` reason；不可回切（本 run 内不自动切回）。

### F-FE4（中）风控设置表单细节

**回应：接受。** 落修订：**开启理由必填**（预设枚举下拉 + 备注 ≤50 字）；**即时保存语义**（本地乐观更新 → 失败整体回滚到上一快照 + 禁用重复点击 + 错误 toast）；**级联规则**：关闭总开关时白名单/理由不清空（保数据），UI 置灰；**三态文案**（空态/错误/加载）进 i18n 键树。

### F-FE5（高）失败原因结构化未落枚举表

**回应：接受（L1）。** 落修订（PRD v1.1 新增附录 A：reason code × i18n 键映射表）：

| reason code | 场景 | i18n 键 |
|---|---|---|
| `captcha_detected` | 检测到验证码 | publishProgress.captchaDetected |
| `captcha_manual_fallback` | 自动识别失败转人工 | publishProgress.captchaManualFallback |
| `captcha_timeout` | manual 超时失败 | publishProgress.captchaTimeout |
| `ocr_sidecar_unavailable` | ddddocr sidecar 不可达 | publishProgress.ocrSidecarUnavailable |
| `stealth_channel_fallback` | 隐身通道降级 | publishProgress.stealthChannelFallback |
| `stealth_injection_degraded` | evasions 注入三态异常 | publishProgress.stealthInjectionDegraded |

渲染纪律：`translate(reason, params)` **未命中 → 通用降级文案 + 上报**（禁透传原始英文 code、禁显示死键）；params 走插值禁拼接。该表作为 PR-2 验收项。

### F-FE6（中）i18n 键树与死键防护

**回应：接受。** 落修订：PRD 附录 B 完整键树（`publishProgress.*` 6 键 + `settings.riskControl.*` 12 键：开关/白名单表格/理由/空态/错误/加载/说明行）；CI **键存在性 lint**（zh/en 成对 + 引用扫描 + 孤儿键）设为 PR-2 门禁项。

### F-FE7（低）体积用户感知

**回应：接受。** 落修订：设置-发布-风控页说明行「本地识别组件占用约 XXX MB，随应用安装」（数值取打包实测）+ 更新公告条目；不做可选组件（会增加打包矩阵，评审结论一致）。

### F-FE8（中）视觉回归基线清单

**响应：接受。** 落修订（PRD §5 测试计划补）：PR-2 新增像素基线至少——captcha 三态（检测中/自动识别中/人工兜底）× zh/en、通道降级提示出现态、风控表单四态（默认/空白名单/校验失败/保存回滚）；全部纳入 CI 像素门禁（`test:visual:pixel`）后才可合入。

## 收敛状态

- 前端轴 8 条全部接受；与后端轴 8 条合并后共 16 条，修订点全部落到 PRD v1.1 章节级
- PRD v1.1 = 本回应 + 后端回应（rebuttal-backend-v1.md）的合并落地态
- 无拒绝项；收敛判据 = v1.1 无未修 Critical/Warning → 推送
