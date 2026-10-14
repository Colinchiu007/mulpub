# 前端轴评审 — B1 PRD v1.0（opencode，session ses_ec6a40cd5，2026-10-14）

**对象**：PRD-OSS-RPA-HARDENING v1.0 的 UI 集成/一致性/可维护性
**总体结论：需修改后开发**——PR-1 补齐 finding 2（fallback 渲染+枚举同步单测）后可先行；PR-2 须先补 finding 1/4/5 三处定义与键树、reason 映射表、基线清单。

## Findings

1. **[高] captcha 人工兜底交互闭环未定**：仅两条文案，缺「谁触发人工、从哪接管」；超时阈值、人工阶段停留上限、释放/重试路径、阻塞语义均未写。修复：补状态机小节 `detecting → auto_ocr(超时 T1) → manual(超时 T2 + 面板「重试自动识别/我已完成/放弃本通道」动作) → fail`，明确阻塞语义与 T1/T2 取值及可配置性。
2. **[高] PR-1 引入 captcha 相位但渲染层无对应 UI 契约**：进度面板遇未知相位的降级行为未定义（白屏/显示原值？）；三处手工同步无机制保障。修复：未知相位 fallback 渲染（通用文案禁透传 code）+ 单测断言枚举⊆emitter 分支、TERMINAL_PHASES 派生自 PHASE_ENUM（单一源禁并列维护）。
3. **[中] 通道降级提示时机与残留未定义**：发布前预检失败即提示还是运行中回退才提示；重试重复弹频控；toast 消失后结果是否留痕；降级后可否回切。修复：一次性事件（channel+run 去重），toast+进度面板常驻行双承载，结果记录带 stealthChannelFallback reason，run 内不可回切明示。
4. **[中] 风控设置表单细节缺失**：开启理由必填？预设下拉还是自由文本？即时保存还是批量提交（失败回滚）？白名单空态、级联清空、防抖。修复：理由必填（预设枚举+备注≤N 字）；即时保存（本地乐观→失败整体回滚上一快照+禁重复点击）；空态/错误/加载三态文案。
5. **[高] 失败原因结构化与 i18n 映射未落枚举表**：reason+params+translate 只有原则，未列 B1 新增 reason code 清单与 i18n 键映射；未命中兜底渲染未规定。修复：PRD 附 reason 枚举×键映射表作验收项；translate 未命中走通用降级文案+上报；params 插值禁拼接。
6. **[中] i18n 键完备性与死键防护未定**：settings.riskControl.* 新命名空间无完整键清单；zh/en 成对靠人工。修复：PRD 附完整键树；CI 加键存在性 lint（成对+引用扫描+孤儿键），PR-2 门禁。
7. **[低] +150-250MB 体积用户感知未定义**：python 栈随安装包必装（与开关无关），无告知触点。修复：设置-发布-风控页说明行「本地识别组件占用约 XX MB，随应用安装」+ 更新公告；不做可选组件（增打包矩阵），仅告知。
8. **[中] 视觉回归基线需明确范围**：未列 PR 新增哪些像素基线。修复：PR-2 新增 captcha 三态×zh/en、降级提示出现态、风控表单四态；全部纳入 CI 像素门禁后合入。

## 处置

8 条全部接受并落入 PRD v1.1（§3.5 状态机/§5.2 基线清单/§7 UI/§9 reason 映射/§10 键树），见 `rebuttal-frontend-v1.md`。

---

**provenance**：CCG 前端轴 opencode，codeagent-wrapper --backend opencode --lite。**方法学备注**：首次以多行 argv/多行 stdin 传递长中文 prompt 均被 opencode CLI 截断（只收到角色约束、内容全丢，两次失败）；改为**单行 prompt 走 stdin**后成功。后续 opencode 轴评审统一用单行 prompt。
