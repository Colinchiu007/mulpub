---
record: loading-progress-locks
task: 第二批同型风险锁：R5（loading 置 true 后函数内无复位 ⇒ 红；finally 外复位与跨方法状态机出声）+ R9a（定时器窗口内对进度赋字面量）
date: 2026-10-17
branch: loading-progress-locks
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（三形态同改：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：同型风险第二批 R5/R9a（loading-progress-locks，2026-10-17）

- 保留门禁：QM-1 打包 **N/A**（未改 `apps/desktop/electron/` 与 `packages/rpa-engine/`）｜ 行数门禁 ✅ ｜ 品牌残留 ✅ ｜ 远程同步 PENDING

### 做了什么

延续 PR #3812（L1-L4），把清单 §2 里另外两类可机械判定的风险落成锁：

| 锁 | 判据 | 竞品原型 |
| --- | --- | --- |
| **R5** loading 复位 | 函数内置 `=true` 且**体内无任何复位** ⇒ 红；有复位但不在 finally ⇒ 出声不拦截 | C3：失败分支不复位 ⇒ 按钮永久置灰 |
| **R9a** 假进度心跳 | 定时器（setTimeout/setInterval）±2000 字符窗口内对 progress/percent 型状态赋**字面量** ⇒ 红 | X-15：固定 350ms 递增到 90 的假进度条 |

落点：`scripts/lib/same-type-risk-locks-r2.js`（纯函数）+ `scripts/lib/loading-machine-exemptions.js`（豁免登记表）
+ `scripts/same-type-risk-locks-r2.test.js`（**11 例**）+ CLI 扩展（六锁汇总）+ Gate 2c6 的 run 块改为多行跑两个测试文件。

### 先侦察后立判据（27 处赋值点的实测分布）

```
finally 复位=16 ｜ finally 外手动复位=4 ｜ 函数体外（组合式/测试）=4 ｜ 跨方法状态机=1 ｜ 初始无复位=1→已补 finally
```

**R9a 的侦察结论是否证性的**：全仓现有 `progress: 0/100` 都是「阶段开始/完成」语义（CreateView.vue:3320/:3768），
`HotTopics.vue`/`PromptEvalView.vue` 的进度文案都是真实完成度计算 —— **我们没有假进度条**。
R9a 当前 0 命中是预期，锁的价值是防回归（谁写假进度条谁红）。

### 锁抓到 1 处真形状但非缺陷 ⇒ 走豁免登记表

R5 首轮真实仓扫描命中 `identity-auth-window.js` 的 `_pendingLoading`：置位在 `openLoading()`（L202/206）、
复位在 `open()`（L222-229，覆盖复用与销毁两分支）—— **跨方法状态机**，函数级判据语义覆盖不了。
处置不是改宽判据（那等于没有锁），而是新增**人工确认的豁免登记表**（`loading-machine-exemptions.js`）：
登记项带「谁置位/谁复位/分支覆盖」的机理解释；判据核对「登记的文件+状态名真实存在」（防登记陈旧），
存在 ⇒ 出声不拦截，失配 ⇒ 照红。首轮审计仅此 1 条，已人工核对其复位路径。

### 开发期被自己抓住的 4 处

1. **裸名漏配（同族错误犯两次）**：`LOADING_SET_RE` 第二分支要求 loading 后至少 1 字符 ⇒ 裸 `loading` 永不命中；
   修完这个，litRe 又犯同族错（要求 progress 前必须有前缀）—— 红夹具两次当场抓出。
2. **真实仓命中暴露判据边界**（即上面的跨方法状态机）⇒ 豁免登记表。
3. **CLI 接线补丁锚点未全匹配** ⇒ `allOk` 被引用未定义（ReferenceError）⇒ 直接读文件手工修三处。
4. **workflow 多行 run 缩进**（第一次把别人的 run 块内容覆盖了 —— `findIndex` 找到的是另一处 `run: |`）：
   从 origin/main 还原整个文件后**精确按「Gate 2c6 name 行之后」定位**重放，diff 收敛为单一 hunk。
   上轮的教训（缩进 ⇒ YAML 坏 ⇒ check-unwired-tests 假阳）在修的过程中又被自己踩了一次不同的变体。

### 真实仓终态

```
扫描 2877 文件
R5 loading置true=30 finally复位=24 finally外复位=4 无复位=0（豁免后） ｜ R9a 定时器语句=814 字面量进度赋值=0
PASS（六条锁全部通过：L1-L4 + R5 + R9a）
R5 可见面 8 条（跨方法状态机 ×2、finally 外复位 ×4、函数体外 ×2 —— 全部出声交人工，不拦截）
```

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 未改 `apps/desktop/electron/` 与 `packages/rpa-engine/` |
| QM-2 代码必检项 | ✅ | 纯函数 + 只读 CLI；豁免表是数据文件（require 即用，无副作用）|
| QM-4 视觉 | **N/A** | 无 UI 变更 |
| QM-6 双模型评审 | 见下 | diff > 200 行 ⇒ CCG 判 dual，走引擎 |
| 远程同步 | PENDING | 待合并后回填 |

### 未闭合（不假装已闭合）

| # | 项 |
| --- | --- |
| 1 | R5 是函数级判据：跨方法状态机靠**人工豁免登记**，新写法（如状态提升到 store）会红 ⇒ 需人工确认后登记 |
| 2 | R9a 只锁「定时器 + 字面量」形状；`requestAnimationFrame` 驱动、递增变量到固定上限、CSS 动画假进度均未覆盖 |
| 3 | R5 的 `visible` 面（finally 外复位 4 条）本轮未逐条人工复核其正确性 |
| 4 | 清单剩余风险类（R7 后缀↔mime、R8 await 无兜底、R11 模块级状态累积）仍未加锁 |
