# Summary — B1 PRD 评审汇总（b1-prd-review）

> 任务：PRD-OSS-RPA-HARDENING v1.0（开源强化 B1 开发入口文档）的 CCG 双轴评审
> 出方案方：opencode-hosted（step-5-preview）｜评审方：后端轴 claude + 前端轴 opencode（家族校验通过）
> 方式：内联禁读文件式 prompt（决策点专项教训）；前端轴经两次 prompt 传递失败后以单行 stdin 修复

## 轮次与产物

| 轮次 | 评审方 | 产物 | 结果 |
|------|--------|------|------|
| Round 1a | 后端轴 claude | `critique-backend-claude.md` | 8 findings（3 严重/4 警告/1 信息），结论**需修改后开发** |
| Round 1b | 前端轴 opencode | `critique-frontend-opencode.md` | 8 findings（3 高/4 中/1 低），结论**需修改后开发** |
| Rebuttal | 出方案方 | `rebuttal-backend-v1.md` + `rebuttal-frontend-v1.md` | 16 条全部接受，无拒绝 |

## 修订落入 PRD v1.1 的关键点

| # | 修订 | 来源 |
|---|------|------|
| 1 | evasions 注入顺序重构（首行最小 navigator patch + inj-start marker 三态）+ 延迟注入变异反证 | 后端 F1 |
| 2 | contextId 双键缓存 + top-frame 范围声明 + 探活重建 | 后端 F2 |
| 3 | exposeBinding 白名单机械守卫（文字声明→代码锁） | 后端 F3 |
| 4 | sha256 信任链三层（签名优先 + 两路交叉 + 防磁盘篡改声明） | 后端 F4 |
| 5 | ddddocr sidecar 127.0.0.1+token 鉴权 + 截图仅内存 + onnx 权重许可逐件核验 | 后端 F5 |
| 6 | 风控分层归类判定器 + A/B 表述勘误（同账号通道串行天然纵向交替） | 后端 F6 |
| 7 | 体积阈值 CI 断言 + sidecar 进程级生命周期单测 + i18n 键 CI lint | 后端 F7 |
| 8 | QM 映射节 + evasions 单一真源（npm 版本）明确 | 后端 F8 |
| 9 | captcha 人工兜底状态机（detecting→auto_ocr(T1)→manual(T2+三动作)→fail）+ 阻塞语义 | 前端 1 |
| 10 | 未知相位 fallback 渲染 + PHASE_ENUM⊆emitter/TERMINAL_PHASES 派生单测（PR-1 范围前移） | 前端 2 |
| 11 | 通道降级提示一次性事件+双承载+reason 留痕+run 内不回切 | 前端 3 |
| 12 | 风控表单细节（理由必填/即时保存整体回滚/级联规则/三态） | 前端 4 |
| 13 | reason code×i18n 键映射表（附录 A 六键）+ translate 未命中降级+上报 | 前端 5 |
| 14 | i18n 完整键树（附录 B 18 键）+ CI 键 lint | 前端 6 |
| 15 | 体积用户感知说明行（不做可选组件） | 前端 7 |
| 16 | PR-2 像素基线清单（captcha 三态×zh/en+降级态+表单四态）纳入 CI 像素门禁 | 前端 8 |

## 结论

PRD v1.1 = 16 条修订全部落地态，作为开发入口文档随 `openspec/changes/oss-b1-rpa-hardening/`（proposal/design/tasks+spike 证据）推送合入。**无未收口 finding**；PRD 评审到此收敛，后续 diff 级 QM-6 随 PR-1/PR-2 各自执行。
