---
record: consolidate-redeem-codes
task: 兑换码签发收敛到 api-publish-engine，废弃 ops-center 本地 HMAC 签发与桌面端孤儿模块
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 不存在；合并后由回填 PR 收口
sync_backfill_owner: 下一会话的回填 PR
---

## 本次执行记录：兑换码签发收敛（consolidate-redeem-codes，2026-10-13）

> 分支：`consolidate-redeem-codes`；规模：10 文件 ⇒ 🌳 大型（跨模块）⇒ CCG 判定 L+
> CCG 双模型后端在沙箱不可用 ⇒ **降级 SELF-REVIEW**（如实记录，不冒充外部评审）

### 为什么必须做（背景不是推测，是查出来的）

仓库里**并存两套互不兼容的兑换码系统**，且桌面端只认其中一套：

| 维度 | 系统 A（真源，本次保留） | 系统 B（本次废弃） |
|---|---|---|
| 服务端 | `api-publish-engine` | `ops-center/backend` |
| 码格式 | `XXXX-XXXX-XXXX`（3 段无签名） | `MP-RAND-RAND-SIG`（4 段带 HMAC） |
| 字母表 | 31 字符（无 L） | 32 字符（含 L） |
| 数据表 | `identity_redeem_codes` | `redemption_codes` |
| 端点 | `/api/v1/admin/member/redeem-codes` | `/api/v1/redemption-codes/batch` |
| 桌面端 | #3293 刚接通 | `redemption-codes.js` **零生产调用方** |

**系统 B 的码兑不了**：它依赖桌面端 `license:activate`，而该 IPC 在正式构建已被
#3085 拒收。B 签发得出来、兑不了，等于**第二套权威**——这是必须收敛的理由，
不是"顺手清理"。

### 本次（A1）的改动

1. **新增** `services/redeem_batch_service.py`：ops 后端改为纯转发 engine。
   照抄既有 `member_grant_service.py` 模式（engine admin 端点只认带
   `admin:users` 的 logto JWT，静态主密钥被显式拒绝，故必须经 M2M token 转发）。
   **未新增任何配置项**——`engine_admin_base_url` / `engine_admin_token` 已在 config 里。
2. **改造** `routers/redemption_codes.py`：只保留 `/batch`，**路径不变**，
   前端与任何已对接脚本无需改 URL。列表/吊销/删除端点下线。
3. **删除** `redemption_code_service.py`（134 行自建 HMAC 签发）、`models.py::RedemptionCode`。
4. **删除** 桌面端孤儿模块 `redemption-codes.js`（141 行）+ 其测试。
5. **前端**契约同步（破坏性变更，已在页面顶部显式告知运营）。

### 三个破坏性契约变更（必须让运营知道）

| 项 | 旧 | 新 | 原因 |
|---|---|---|---|
| `plan` | `free`/`trial`/`pro` | **`standard`/`pro`** | engine 拒 `free`，且**不存在 `trial` 档** |
| `durationDays` | **无此字段** | **新增必填正整数** | engine 按固定天数授权；旧语义是"到 expires_at 为止" |
| `note` | 有 | 移除 | engine 无对应概念，显式丢弃而非整包透传 |

`count` 仍为 1–200（engine 上限是 500，此处保守收窄：见下方遗留）。

### 安全要点

- **engine token 不进响应体**（有专门测试锁住）
- **本地前置校验不替代 engine 校验**，只是避免无谓往返
- **`note` 显式丢弃**：透传会让 engine 收到未声明字段，违反「不整包透传」白名单原则
- **bool 是 int 子类**：`durationDays: true` 必须显式排除，否则 `True` 会被当 1 天放行
- 删除孤儿模块 `redemption-codes.js` 消除了「本地生成 Pro 码 + 环境变量 secret」
  这条长期风险路径（#3085 已堵住提权，但留着能力本身是负债）

### 测试与变异验证

新增 15 个用例，本地全绿（装了 pytest/httpx/pydantic-settings，PyPI 直连不通，
换 aliyun 镜像）。

| 变异 | 结果 |
|---|---|
| `note` 不再丢弃（整包透传） | ❌ 红 2 例 |
| `durationDays` 的 bool 守卫去掉 | ❌ 红 |
| plan 校验放宽（放行 free/trial） | ❌ 红 |
| `expires_at` 旧字段名不再兼容 | ❌ 红 |
| 上游错误码被压成通用码 | ❌ 红 |

覆盖：正常转发 / Bearer 头 / 旧字段名兼容 / 空串 expiresAt 丢弃 / note 丢弃 /
count 上下界 / plan 非法（含 free+trial+大小写）/ durationDays 非法（缺失/0/负/bool/浮点/字符串）/
未配置 503 fail-closed / 不可达 502 / 上游 4xx 码透传 / 非 JSON 兜底 /
token 不泄漏 / `generated < requested` 差额可见。

### 遗留（不假装已闭合）

- **兑换码无法作废**：`identity_redeem_codes.status` 已有 `disabled` 值，
  但 engine 侧无查询/吊销 API。**签发出去的码泄漏后目前无法作废**。
  这是本次刻意留下的缺口，已在 ops 前端用告警条明示。
- **`generated < requested` 静默少发**：engine `createRedeemBatch` 在 DB
  `ON CONFLICT DO NOTHING` 碰撞时 `generated < requested` 且不补生成。
  ops 侧只保证差额**透出可见**，未改 engine 行为。
- **补齐计划（A2，本 PR 之后）**：engine 补 `GET` 列表 + 吊销端点
  （store 加 UPDATE / service 加方法 / router 加端点 + 测试），
  随后恢复 ops 的列表与吊销 UI。
- **`count` 上限保守收窄到 200**（engine 上限 500），待碰撞补足后放宽。

### 门禁

`check-debt-budget` / `check-gate-record-debt` / `check-text-encoding-integrity` /
`check-no-brand-residue` / `check-max-lines` / `check-dep-audit` 全绿；
改动文件 U+FFFD 计数全为 0。

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| QM-2 代码必检 | PASS | 15/15 用例绿 + 5 变异全红 + 全部门禁脚本 OK |
| QM-4 视觉 | N/A | 仅改 ops 内部运营台文案与表单，无对外视觉面 |
| QM-6 CCG 双模型 | **未执行（降级 SELF-REVIEW）** | 沙箱双模型后端不可用 |

| 远程同步 | PENDING —— 本 PR 尚未合并，merge SHA 不存在；合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 |
|---|
