# Critique v1b — 第二评审通道（同家族子代理，全新上下文，迟到归入第 2 轮）

> critic: DWS subagent 8248db19（GLM 家族，与 proposer 同家族——**不满足跨家族硬要求**，降级为「第二通道」，跨家族结论以 claude CLI critique-v1/v2 为准；其证据贡献独立核实后采信）
> 13 条 issue（major×5 / minor×8），五维：完整性 7 / 一致性 6 / 清晰度 7 / 可行性 7 / 安全性 9，converge=false

## Issue 摘录（全文见任务记录）

- **C1-01（major，一致性）**：§3.1-5 正则与服务端 subscription-service.js:14 不同型（排除 I/L/O/0/1），且 §5-3 行号错引（:202-204 是 apply 点，定义在 :14），与「与服务端同型」自相矛盾。
- **C1-02（major，清晰度）**：P2「memberStore.loading 无消费方」为事实错误——AccountSecurity.vue:26 撤销按钮 :disabled 在消费。
- **C1-03（major，可行性）**：modal 退役未盘点 4 处机械拦截面（icon-usage.test.js:30 FILES 登记、UpgradeModal.test.js:18、more-tests.test.js:23 的 import、MemberCenter.test.js:134-145 用例）。
- **C1-04（major，一致性）**：§3.1-2 两案互斥未裁决（plan 序比较违反 entitlement-gate 单一真源）。
- **C1-05（major，完整性）**：死键清单漏 `licenseProExpired`（zh/en.js:71，grep 无消费方）。
- C1-06（minor）：测试文件计数 2≠3（实为 Overview / entitlement-gate / entitlement-gate.feature-key）。
- C1-07（minor）：license:activate 是「已整体删除」（license-access-control.js:13；buyout-removal.contract.test.js:107-108 断言不得残留），非「拒收」；:45 拒收只属 activate-trial。
- C1-08（major，完整性）：P1-3 统一方向会抹平 ProfileMenu 的刻意分支（error+会话有效→「已连接」），须明确裁决。
- C1-09（minor）：P0-4 quota 示例取自测试 mock（credits/used），真实键形为 `${feature}_monthly`（plan-matrix.js:160-165）。
- C1-10（minor）：Dashboard 深链改造撞 style-guard 正向锁（:286-290 恰好 4 处 @upgrade），应改函数体不动模板。
- C1-11（minor）：P1-9 修复未覆盖 labels.js null 回退路径。
- C1-12（minor）：modal 退役后 doTrial/doDeactivate 功能去向未写明。
- C1-13（minor）：is_current 全 false 是合法态（当前设备行可能不在返回列表），前端须中性态禁止顺序猜测。
