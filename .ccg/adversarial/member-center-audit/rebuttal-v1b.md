# Rebuttal v1b — 对 critique-v1b 的逐条回应（第 2 轮）

> proposer 核证方式：每条指控先到源码亲自验证，再裁决。核证结果：13/13 事实基础全部成立（含 3 条直接推翻文档原表述的硬伤），无 L1 反例可出。

## 裁决汇总

**全部接受（13/13）**：0 部分接受、0 拒绝。其中 C1-01/C1-07 在 claude CLI 轮（MISS-9）已部分修正，本条把行号错引与「删除 vs 拒收」的表述错位补齐。

## 逐条修订落点

### C1-01（正则不同型 + §5-3 行号错引）— **接受**

MISS-9（claude 轮）已改 §3.1-5 为共享常量方案；本条补两处：① §5-3 行号修正（定义 subscription-service.js:14，:202-204 是 apply 点）；② §3.1-5 补「更稳妥：以服务端正则源码为准，不在此复写字面量」并注明服务端字母表显式排除 I/L/O/0/1。

### C1-02（loading 消费事实错误）— **接受**

proposer grep 复核：全 src 仅 AccountSecurity.vue:26 一处消费 `memberStore.loading`（revoke 按钮 :disabled）。P2 条目改写为「loading 已被 AccountSecurity.vue:26 用于撤销按钮禁用；**消息列表侧无任何加载态消费**」。Phase 3 骨架条目同步收窄为「补消息列表加载态」。

### C1-03（退役机械拦截面）— **接受**

**修订**：Phase 1 动作 5 增补「同步动作清单」：① 删 `components/UpgradeModal.vue` + `UpgradeModal.test.js`；② `more-tests.test.js:23` 移除 import；③ `icon-usage.test.js:30` FILES 收敛清单移除登记行（否则逐文件 readFileSync ENOENT 整套件红）；④ MemberCenter.test.js:134-145 改写（MISS-3 已列）。DoD 增补「icon-usage 收敛清单与组件删除同步」。

### C1-04（两案互斥未裁决）— **接受**

claude 轮 MISS-1 已裁决为两步走（正向名单过渡 + rank 契约前置）并删除了「plan 序比较」备选——本条与 MISS-1 是同一缺陷的两次独立发现，交叉证实。§3.1-2 现文已无互斥方案，确认闭环。

### C1-05（死键漏 licenseProExpired）— **接受**

proposer grep 复核：zh/en.js:71 定义、全 src 零消费。死键清单补入；并采纳「以 grep 产物为准生成」的方法论（文档附生成命令）。

### C1-06（测试文件计数 2≠3）— **接受**

更正为 3 个：Overview.test.js、entitlement-gate.test.js、entitlement-gate.feature-key.test.js。定性不变（6 个子视图零测试）。

### C1-07（license:activate 删除 vs 拒收）— **接受**

proposer 复核：license.js 全文无 activate 的 ipcMain.handle；license-access-control.js:13 注释「activate 随 2026-10-17 remove-buyout-license 移除」；buyout-removal.contract.test.js:107-108 机械断言白名单不得残留。§1 背景注与 §5-1 改写为「license:activate 通道已整体移除（license-access-control.js:13），activate-trial 在 license.js:45 对打包环境拒收」。

### C1-08（P1-3 统一方向回退风险）— **接受**

实质问题成立：统一若取 labels.js 语义，error+会话有效用户的状态从「已连接」退化为「需要重试」。**裁决**：统一方向取 ProfileMenu 语义——`statusLabelOf` composable 化时增加可选 `hasSessionIdentity` 参数，error 态按「有会话身份→已连接（可重试操作）/ 无身份→需要重试」二分；写入 §3.1-2，禁止默认二选一。

### C1-09（quota 键形取自 mock）— **接受**

**修订**：P0-4 示例改用 plan-matrix.js:160-165 真实键形（cloud_publish_monthly / ai_write_monthly / video_create_monthly / official_credit_monthly）；映射设计补「键清单与 plan-matrix 派生段对齐核对」，测试 mock 同步改真实键形。

### C1-10（Dashboard 深链撞正向锁）— **接受**

**修订**：Phase 2 深链条目补安全改法——只改 `goToMemberCenter` 函数体为 `router.push('/member-center?section=subscription')`，模板 4 处 `@upgrade="goToMemberCenter"` 与 style-guard 锁（:278-290）**一律不动**。

### C1-11（P1-9 修复不彻底）— **接受**

**修订**：Phase 2 条目扩为「未加载态中性化：currentPlanId 与 planLabelOf 的 null 语义一并处理（null→中性占位而非 'free'），核对 labels.js 全部 null 回退路径（含 isProActiveOf :32 的 licenseStore 二值回退）」。与 MISS-4 合并覆盖。

### C1-12（modal 功能去向）— **接受**

与 MISS-5/C1-05 类似的处置项：Phase 1 动作 5 已含 trial 休眠；本条补「doDeactivate 注销许可证入口随 modal 消失，DEV-only 能力，退役决策记录写明去向（暂不迁移、DEV 调试经造数据/设置页后续评估）」。

### C1-13（is_current 全 false 合法态）— **接受**

**修订**：§3.1-6 补边界——主进程经 X-Device-Id 比对 device_id 标记 is_current；`is_current 全 false` 是合法态（当前设备行未 upsert/缺失），前端显示「未识别当前设备」中性态，**禁止回退 index===0 顺序猜测**；主进程 IPC 测试补该分支用例。

## 汇总

| 维度 | critique-v1b | 修订后评估 |
|------|--------------|-----------|
| 完整性 7 | 3 处遗漏补齐（死键/label 回退/功能去向） |
| 一致性 6 | 正则矛盾闭环、两案裁决闭环、删除vs拒收改写 |
| 清晰度 7 | loading 事实错误更正、测试计数更正 |
| 可行性 7 | 机械拦截面清单化、style-guard 避让写法、is_current 边界 |
| 安全性 9 | 维持（评审确认无边界降低） |

13/13 接受、0 拒绝，全部修订并入实体文档。两条独立通道（跨家族 claude + 同家族子代理）在同一版文档上分别抓出 MISS-9 与 C1-01（同一正则错误）、MISS-3 与 C1-03（同一拦截面遗漏）——独立发现交叉证实，文档 v3 版本可信度显著提升。
