## Why

小红书走 DOM/RPA 轨发布（`publishMode: dom-only`；API 直发链因签名外包 + 传输层墙已判 not-go，见 api-publish-engine-w3 §6.3）。当前 `packages/python-backend/src/multi_publish/publishers/xiaohongshu.py` 的 RPA 发布流程存在多处稳定性与正确性硬伤，最严重的是：**草稿模式找不到"草稿"按钮时 fallthrough 直接点"发布"（草稿误公开发布，违反"私密/草稿优先"红线）**，以及**盲 `sleep(5)` 后无条件 `success=True` + 硬编码假 URL（发布假阳性）**。基类 `base.py` 已提供 `ResponseMonitor`（监听平台自身 XHR 响应判定结果，抗 UI 改版），但小红书发布器完全未使用。

## What Changes

- **验收目标**：小红书发布器稳定地**存入创作者中心真实草稿箱**（不真实公开发布）；发布成功判定来自"草稿保存响应 / 草稿箱回查"，而非盲等。
- **草稿安全修复**：draft 意图下 MUST NOT fallthrough 到公开发布；fail-closed 的锚点是"没有任何正面确认"，不是"找不到某个按钮"（活体取证 2026-10-08：图文编辑器没有存草稿按钮，草稿由平台自动保存，见 tasks 2.14）。
- **成功判定改造**：用 `ResponseMonitor` 监听小红书草稿保存端点响应 + 草稿箱 URL 回查，确认才报成功；无正面确认绝不报成功，`url` 不伪造。
- **选择器鲁棒性**：宽泛选择器（`:has-text("发布")` 等）改多候选回退链；标题/正文 contenteditable 用 dispatch 事件填写；标签逐个 type+选下拉（修只留最后一个）。
- **错误归一**：登录过期 / 风控弹层 / 上传失败映射到 outcomeOfResult 对应类别（risk / login 绝不降级、绝不换号）。
- **可测试性 seam**：发布步骤逻辑抽出可注入 `page` / `ResponseMonitor` 的方法，配假 playwright 骨架做 TDD。
- **活体取证**：登录态就绪后，用 CDP/Playwright 驱动已登录浏览器抓真实草稿保存流的端点模式、确认弹层、成功信号，回填 Tier-2 具体选择器 / 信号（镜像 kuaishou selector-forensics 方法）。

## Impact

- Affected specs: `rpa-publish-xiaohongshu`（新能力）
- Affected code: `packages/python-backend/src/multi_publish/publishers/xiaohongshu.py`、
  `packages/python-backend/src/multi_publish/publishers/xiaohongshu_dom.py`（为满足单文件行数
  门禁从发布器拆出的纯函数轨）、`packages/python-backend/src/multi_publish/publishers/xiaohongshu_selectors.py`
  （候选链 + 端点/风控常量回填）、`tests/test_new_publishers.py`（或新增 `tests/test_xiaohongshu_dom_hardening.py`）、
  `packages/python-backend/tests/test_p4_wait_until.py`（轮询拓扑静态守卫）
- Affected docs: `01-docs/PRD-XHS-DOM-RPA-HARDENING-2026-10-09.md`（取证结论与验收口径逐轮回写）、
  本 change 的 `tasks.md` / `design.md`
- 评审工件：`.adversarial/**`（CCG 深评的 proposal/critique/adjudication，逐条
  prosecution/defense/verdict/rationale 留痕，随批入库以便复核；不含活体取证产物）
- 本地运行面（**不入库**）：`.agent_context/**` 的取证驱动与 live 证据（含账号信息，只留本地）
- 不涉及运行时代码新增任何外部签名 / 求签端点；不触碰 api-publish-engine-w3 的 API 链收口（由 mp-w3-closure 会话负责）。
