# PRD：同平台多账号去重契约修正（fix-multi-account-same-platform）

- 日期：2026-10-21
- 变更类型：Bug 修复（逻辑错误）
- 优先级：P1（阻断既有能力：同平台多账号在部分平台完全不可用）
- 影响面：`packages/python-backend/src/server.py`（去重 + 启动清理）、账号管理全链路提示

---

## 一、问题陈述

### 1.1 用户实测场景

1. 用户已在本应用保存过**一个头条号**（账号页可见该卡片）。
2. 用户持有 **3 个头条号**，想添加第 2 个。
3. 用户新建标签页 → 打开头条登录页 → 完成登录 → 点 NavBar「保存账号」。
4. 应用提示：**「此账号已添加过」**。第 2 个账号无法入库。

用户判断：「我添加的是同一个平台的不同账号，不应该被判定为同一账号。」

### 1.2 定性

这是逻辑错误，不是偶发故障。受影响的是所有「平台不提供可采集用户 ID」的平台，
不限于头条号。同平台多账号本身是产品既有能力（账号页按平台分组展示多张卡片、
发布目标可多选同平台多个账号），该错误使这条能力在这些平台上完全不可用。

---

## 二、根因分析（第一性原因）

### 2.1 一级引入点

commit `c84325baa`（2026-09-06），PRD §「账号管理页核心修复 v5：重复检测补漏」。

该次改动的**意图**是补一类漏检：一方有 `platform_account_id`、另一方没有、且名称相同时
不判重。为实现它新增了第三条判据：

```python
# v5 引入，2026-10-21 已删除
if existing_name and existing_name == normalized_name and normalized_name:
    raise HTTPException(status_code=409, detail="此账号已添加过")
```

配套的注释写明了当时的假设：「同一账号重复添加时 ID 提取可能不一致，名称是稳定的兜底标识」。
**这个假设是错的**——`name` 不是稳定标识，见下。

### 2.2 name 字段的真实语义

`name` 不是账号身份，它是 `document.title` 的落盘位。项目内已有明确契约
（`apps/desktop/src/utils/account-display-name.js:14`）：

```
`name` 是 `document.title` 的落盘位（平台显示名/历史兼容位），**永不作为显示名来源**
```

完整取值链：

```
captureCookies(platform)
  ├─ platformName = getPlatformName(platform)          # 例："今日头条"
  └─ accountName = platformName                        # 初始即平台名
       （仅 wechat_mp 会尝试从 .weui-desktop-account__name 覆盖）
  → addAccount(platform)
  → resolveCapturedDisplayName(source.name, platform)
       ├─ source.name 非空且不是噪声 → 用它
       └─ 否则（含空串）→ getPlatformName(platform)     # 回落平台显示名
  → POST /api/accounts { name: <结果>, platform_account_id: <可能为空> }
```

`isNoiseAccountName`（`packages/shared-utils/src/account-name-guard.js`）会把
「头条号」「创作者中心」「服务平台」等**平台页面名**判为噪声，回落平台名——
所以即便页面标题里出现平台名，最终落盘的 `name` 仍是平台显示名。

**结论**：同一平台的 N 个账号，`name` 全部相同。

### 2.3 platform_account_id 为什么采不到

采集器的平台用户 ID 只认三个属性
（`packages/shared-utils/src/account-profile.js:97-102`）：

```javascript
const idSelectors = withFallback(platformSelectors && platformSelectors.platformAccountId,
  ['[data-user-id]', '[data-account-id]', '[data-user]'])
```

而 `platformSelectors.platformAccountId` 对所有平台都配的是 `['[data-account-id]']`
（`packages/shared-utils/src/platform-definitions.js:386-400`）。
头条号、百家号等创作者后台的 DOM 并不带这些属性 ⇒ `info.platformAccountId` 不产出
⇒ `profileForCreate` 的 `platform_account_id` 为空串。

**这不是边缘情况，而是这些平台的常态。**

### 2.4 触发链

```
第 1 个头条号：name="今日头条", platform_account_id=""  → 入库（无既有账号可比）
第 2 个头条号：name="今日头条", platform_account_id=""
  → v5 判据：existing_name == normalized_name → 409「此账号已添加过」  ← Bug
```

### 2.5 启动侧同源错误

`_dedup_accounts_on_startup` 按 `(platform, owner_subject, name_lower)` 去重，
同平台同名的账号只保留 `created_at` 最晚的一条。
这意味着即使绕过创建路径（例如从云端恢复、或历史版本入库），
**每次后端启动都会把同平台多账号清得只剩一条**。这是同一错误判据的第二个落点。

---

## 三、逃逸分析（为什么没被测试拦住）

| 层级 | 应有覆盖 | 实际情况 | 逃逸原因 |
|---|---|---|---|
| 单元测试 | 同平台多账号 | `test_create_account_duplicate_when_one_side_has_id_same_name` 断言 409 | **测试把错误契约固化了**——它验的正是 Bug 本身 |
| 单元测试 | 双方无 ID + 同名 | `test_create_account_duplicate_by_name_when_both_ids_empty_returns_409` 断言 409 | 同上 |
| 单元测试 | 启动去重 | 只测「同名 → 保留最新一条」 | 测试数据就是 3 个同名账号，天然验证了错误行为 |
| 集成测试 | 跨进程 409 透传 | 有（IPC mock 层） | mock 不依赖后端判据，测不到判据对错 |
| E2E | 真实登录保存 | 有 `account-management-full.js` | 同样 mock 409，不触达真实判据 |
| 代码审查 | 判据合理性 | 通过 | 注释里给了个看似合理的理由（「ID 提取可能不一致」），审查被说服 |

**系统性漏洞**：`test_server_account_lifecycle.py` 的去重用例**全部以 `name` 为判据编写**，
没有任何一条用例问过「`name` 能不能当身份标识」。当实现把错误前提写进注释时，
测试只是把这个前提复述了一遍——这是**测试与实现共享同一错误假设**的典型形态：
测试没有独立验证前提，只是验证了实现的自洽性。

次要漏洞：这些用例的账号数据从不构造 `platform_account_id` 与 `name` 的**组合差异**
（如「两个号都无 ID」），因为用例作者和实现作者是同一次改动中的同一个视角。

---

## 四、修复方案

### 4.1 核心：身份标识收敛为单一强标识

新增 `_account_identity_key(platform_account_id)`：

```python
def _account_identity_key(platform_account_id: Any) -> str | None:
    return platform_account_id.strip() if isinstance(platform_account_id, str) and platform_account_id.strip() else None
```

返回 `None` = 无强标识。**无强标识 ≠ 无身份**，只是此时无从判断是否与别人重复，
因此调用方必须允许它入库。

### 4.2 create_account 去重

```python
new_identity = _account_identity_key(req.platform_account_id)
if new_identity:
    for existing in accounts.values():
        if (
            existing.get("platform") == pt.value
            and _is_owned_by(existing, owner_subject)
            and _account_identity_key(existing.get("platform_account_id")) == new_identity
        ):
            raise HTTPException(status_code=409, detail="此账号已添加过")
```

删掉全部 `normalized_name` / `existing_name` 参与判据的分支。

### 4.3 _dedup_accounts_on_startup 去重（同源）

```python
identity = _account_identity_key(acc.get("platform_account_id"))
if not platform or not identity:
    continue        # 无强标识 → 无去重依据 → 保留
key = (platform, owner, identity)
```

判据从 `(platform, owner, name_lower)` 改为 `(platform, owner, platform_account_id)`。
**必须与 create_account 共用 `_account_identity_key`**，否则会出现
「创建时允许同平台多账号、重启后又把它们清成一条」的自相矛盾。

---

## 五、数据校验规则（最终契约）

### 5.1 判定矩阵

| 新账号 ID | 已有账号 ID | 平台 | owner | 判定 | HTTP |
|---|---|---|---|---|---|
| 有值 | 相同 | 相同 | 相同 | 重复 | **409** `此账号已添加过` |
| 有值 | 不同 | 相同 | 相同 | 不重复 | 200 |
| 有值 | 无（空串/缺键/非字符串） | 相同 | 相同 | 不重复 | 200 |
| 无 | 无 | 相同 | 相同 | 不重复 | 200 |
| 无 | 有值 | 相同 | 相同 | 不重复 | 200 |
| 任意 | 任意 | **不同** | 相同 | 不重复 | 200 |
| 相同 | 相同 | 相同 | **不同** | 不重复 | 200 |

ID 比较前 `strip()`；大小写不处理（平台 ID 区分大小写，不做归一化）。

### 5.2 字段规则

| 字段 | 来源 | 是身份标识？ | 判重用途 | 展示用途 |
|---|---|---|---|---|
| `platform_account_id` | `[data-account-id]` 等属性 | **是（唯一）** | 唯一判据 | 不直接展示 |
| `name` | `document.title`，回落平台显示名 | 否 | **不使用** | 历史兼容位，不作显示名 |
| `account_name` | DOM 昵称选择器，回落 name | 否 | 不使用 | **显示名首选位** |
| `name_source` | auto / manual | 否 | 不使用 | manual 时不过噪声守卫 |

### 5.3 不变量

- 判据唯一实现是 `_account_identity_key`；`create_account` 与 `_dedup_accounts_on_startup` 共用。
- 平台内唯一：`(platform, owner_subject, platform_account_id)`。
- 跨平台同一 ID 不冲突（不同平台的用户 ID 空间独立）。
- 跨 owner 同一 ID 不冲突（多租户隔离）。

---

## 六、功能逻辑

### 六-1、账号保存流程（修复后）

```
用户在新标签页完成平台登录
  │
  ▼
NavBar「保存账号」(App.vue onSaveAccount)
  ├─ isLogin 标签 → accountActions.completeLogin('browser')
  └─ accountId 标签 → pageManager.saveAccountTabCredentials(tabId)
  │
  ▼
主进程 captureCookies(platform)
  ├─ 会话证据校验（hasPlatformSessionCookie）失败 → 抛错，不入库
  ├─ accountName = getPlatformName(platform)         # 初始即平台名
  └─ extractAccountInfo(page, platform)              # 昵称/头像/ID/粉丝，失败降级 {}
  │
  ▼
saveCapturedAccount(platform, captured)
  ├─ name = resolveCapturedDisplayName(source.name, platform)
  ├─ profile = profileForCreate(accountInfo, name)
  │    ├─ account_name: 昵称 or name
  │    ├─ platform_account_id: 采到则有值，否则 ""
  │    └─ followers / avatar
  └─ POST /api/accounts
       ├─ platform_account_id 非空 且 (platform, owner, id) 已存在
       │     → 409 "此账号已添加过"
       └─ 其余全部
             → 200 入库（status=unverified）
  │
  ▼
credentialStore.saveCredential(...)   # 凭证只进主进程加密库，不进 accounts.json
  → 账号列表刷新，按平台分组新增一张卡片
```

### 六-2、启动去重流程（修复后）

```
后端 main() → _dedup_accounts_on_startup()
  for each account:
    identity = _account_identity_key(platform_account_id)
    if not platform or not identity: continue      # 无 ID → 保留
    key = (platform, owner, identity)
    同 key 保留 created_at 最晚的一条，其余删除
  记录日志，不阻塞启动
```

---

## 七、交互逻辑与显示项

### 7.1 提示文字（全部沿用既有 i18n 键，无新增）

| 场景 | 通道 | 文案（zh） | 键 |
|---|---|---|---|
| 保存成功 | `ElMessage.success` | 已保存 | `accounts.saved` |
| 保存失败（未检测到凭证） | `ElMessage.error` | 未检测到登录凭证，请先完成登录 | `accountsPage.saveAccountTabNoCredential` |
| 保存失败（其他） | `ElMessage.error` | 保存账号凭证失败，请重试 | `accountsPage.saveAccountTabFailed` |
| **同一账号重复添加** | `ElMessage.error` | **此账号已添加过** | `accountsPage.duplicateAccount` |
| 保存账号失败（兜底） | `ElMessage.error` | 未能保存账号 | `accounts.saveFailed` |

「此账号已添加过」的语义在修复后变准确：它只在**真的同一账号**（同平台同 ID）时出现。

### 7.2 账号列表显示

- 按平台分组；同平台多张卡片独立渲染。
- 卡片主标题 = `resolveAccountDisplayName(account)`：
  - `account_name` 非空且 `name_source=manual` → 原样显示
  - `account_name` 非空且非噪声 → 显示
  - 否则回落平台名（如「今日头条」）
- **同平台两张卡片可能显示同名**（都回落平台名）。这是可接受的：它们是两条独立记录，
  可分别启用/停用/检测/删除/改名。用户可用改名功能区分（改名后 `name_source=manual`，
  采集结果不再覆盖）。
- 徽章：`status` 三态（active/expired/unverified）+ `is_active` 启用态，两者正交。

### 7.3 用户操作路径

```
添加第 2 个同平台账号（修复后）：
  新标签页 → 平台登录页 → 登录 → 「保存账号」→ 成功 → 账号页多一张卡片 → （可选）改名区分
```

修复前该路径在第 4 步被 409 阻断。

---

## 八、回归保护测试

文件：`packages/python-backend/tests/test_server_account_lifecycle.py`

| 用例 | 锁定性质 |
|---|---|
| `test_create_account_same_platform_different_account_no_id_not_duplicate` | **用户实测场景**：同平台第 2 个账号、双方无 ID、同名 → 200 |
| `test_create_account_same_platform_different_id_not_duplicate` | 同平台不同 ID → 200 |
| `test_create_account_same_platform_same_account_id_is_duplicate` | 同一 ID → 409（去重能力不退化） |
| `test_create_account_asymmetric_id_same_name_not_duplicate` | v5 错误判据的反向锁：一方有 ID + 同名 → 200 |
| `test_create_account_both_ids_empty_same_name_allows_multi_account` | 双方无 ID + 同名 → 200 |
| `test_create_account_duplicate_id_is_scoped_to_platform` | ID 是平台内标识，跨平台不冲突 |
| `test_create_account_duplicate_is_scoped_to_owner` | 多租户隔离 |
| `test_startup_dedup_keeps_same_platform_accounts_without_ids` | 启动去重不清无 ID 多账号 |
| `test_startup_dedup_ignores_platform_fallback_names` | 三个都回落平台名的账号全部保留 |
| `test_startup_dedup_still_removes_same_id_duplicates` | 启动去重仍清同 ID 存量重复 |

### 8.1 变异反证（2026-10-21 实跑）

把 `create_account` 的判据换回 v5 的 name 匹配：

```
FAILED test_create_account_both_ids_empty_same_name_allows_multi_account
FAILED test_create_account_one_side_has_id_same_name_allows_multi_account
FAILED test_create_account_same_platform_different_account_no_id_not_duplicate
FAILED test_create_account_same_platform_different_id_not_duplicate
FAILED test_create_account_asymmetric_id_same_name_not_duplicate
5 failed, 4 passed, 25 deselected
```

修复摘掉即红，红文案指回根因（name 判据），不是「测试恰好也变了」。

### 8.2 CCG 深度审查采纳记录（2026-10-21，双模型 DUAL）

跨家族评审（proposer=opencode / critic=claude，`scripts/deep-review.sh`）提出 5 条，
逐条处置如下。裁决产物：`.adversarial/ccg-deep-8e315f3b/adjudication.json`。

#### i3（Warning，已采纳并加固）：非字符串 platform_account_id

指控：`_account_identity_key` 对 int/float 返回 None，导致非字符串 ID 永远无法去重。

处置：**部分采纳**。
- 写入侧本就不可达：`AccountCreateRequest.platform_account_id: str | None`，非字符串在 HTTP 层
  即被 Pydantic 422 拒掉。新增 `test_create_account_rejects_non_string_platform_account_id` 锁住这一点。
- 读取侧（`accounts.json` 是用户可手改的文件，历史脏值不可假设）改为**显式类型分支**：
  只接受字符串，其余一律 None，并在 docstring 写明「当作没有强标识」比「抛异常把创建/启动
  去重打死」更稳——与 `_normalize_account_status` / `_normalize_account_active` 的 fail-safe 同向。
  同时写明**不**把数字 ID `str()` 化后参与判重：那会让 `1` / `1.0` / `01` 看起来是不同账号，
  反而制造漏判。
- 新增 4 例：`test_account_identity_key_non_string_returns_none`（纯函数，7 个输入）、
  `test_create_account_non_string_stored_id_does_not_break_create`、
  `test_startup_dedup_ignores_non_string_stored_ids`。

#### i4（Warning，auth 域，裁决 upheld 并落代码闭环）：请求体 ID 无服务端复核

指控：`create_account` 直接信任请求体的 `req.platform_account_id` 作为强标识，无服务端从
session/page 重新提取验证；恶意客户端可构造已知 ID 阻止真实账号添加（DoS）。

论证：要走到这一路，调用方必须已持有合法 Bearer token 且带 `account:manage` scope
（`_require_account_manage` → Logto JWT 校验，见 `multi_publish/auth/logto.py:473` 的
`create_fastapi_dependency`）。而 `_is_owned_by` 保证它撞到的 ID 全部属于**它自己** 的 owner，
所以「构造已知 ID」最多挡住攻击者自己，挡不住其他 owner 的真实账号。同一 scope 下
`DELETE /api/accounts/{id}` 可直接删掉任何同 owner 账号，破坏力远大于「阻止添加」——
这是 `account:manage` 权限粒度的固有范围，不是本判据引入的新攻击面。

裁决：**upheld**，但因属 auth 高危域，**不以求 externalReview 免责**（本会话无公开 PR 评论
URL，不得伪造证据），改为落代码与测试闭环：
1. `create_account` 内新增注释段，把上述威胁模型论证写进源码，说明为何不再加服务端复核
   （后端本就没有 session/page 可采，凭据只存主进程，复核也无法提升安全性）；
2. 新增 `test_create_account_cross_owner_id_does_not_block_second_owner`，实证「构造已知 ID
   最多挡住调用方自己、不影响其他账号入库」；
3. 保留 `test_create_account_duplicate_is_scoped_to_owner`。

真正的加固方向（收窄 scope 粒度 / 加操作审计）属独立安全任务，不在本 Bug 爆炸半径内。

#### i1 / i2（Critical，均 dismissed）：审查工件未随变更重生成

指控：`.ccg/reviews` JSON 的 `sha=13dde3595` 与 head `8e315f3b` 不一致，`changedLines=301`
与实际 diff 不符；`deepReview.status=pending`。

裁决：**dismissed**，这是**审查机制的既有行为而非本次变更的缺陷**：判定器在 pre-commit
阶段运行，那时新 commit 尚未生成，故记录写在**父 sha** 上，且 stats 统计的是**暂存 diff**
（不含 pre-commit 期间生成的 `.ccg/reviews/*.json` 自身）。`deep-review.sh:633-652` 的注释
明确记录了这一设计（「记录恒写在【父提交 sha】名下，按 HEAD 找不到是常态」），运行时也确实
打印了「判定记录按父提交 sha 命中」。`status=pending` 则是深度审查**尚未开跑**时的初始态，
本次审查跑完后由引擎自行回填。这两条指向工件生成时机，不是被审查代码的正确性。

#### i5（Warning，已采纳）：文档双源

指控：`01-docs/PRD-MULTI-...md`（401 行）与 `PRD.md` 新增章节高度重复，形成双源维护。

处置：**采纳**。`PRD.md` 中的章节已压缩为**契约摘要**（契约表 + ⛔ name 非身份标识表 +
交互提示 + 回归保护概览 + 风险取舍），章首声明「单一真源在
`01-docs/PRD-MULTI-ACCOUNT-SAME-PLATFORM-2026-10-21.md`」。推导过程、逃逸分析、
测试坐标全表、CCG 处置只存在于独立文档，不再两处各写一份。

> `.ccg/reviews` 新增文件混入源码树：这是本仓审查工件的既定落点（`deep-review.sh:574`
> 按 `.ccg/reviews/$SHA.json` 读写），不是本次引入，不改。


---

## 九、预防措施（防止再次发生）

### 9.1 已落地

1. **判据单一实现 + 注释声明禁项**：`_account_identity_key` 的 docstring 用 ⛔ 段写明
   「不得改用 `name` 作为身份标识」及原因，并在注释里指向 `account-display-name.js:14`。
   后续改动者读到函数即看到约束。
2. **两个调用点共用同一实现**：创建路径与启动路径不可能再漂移。
3. **回归测试覆盖两侧**：创建路径 7 例 + 启动路径 3 例。

### 9.2 测试机制改进（本次落地）

新增用例刻意构造「两个账号都无 ID」与「三个都回落平台名」这两种
**字段缺失/退化组合**——这是原用例集的盲区（原用例从不让 ID 与 name 出现组合差异）。
教训：当实现引入「用 X 当 Y」的假设时，测试必须独立验证「X 能当 Y 吗」，
而不是构造数据让 X 等于 Y 来验证自洽。

---

## 十、风险与取舍

### 10.1 接受的代价

同一平台同一账号在「两次都采不到 ID」时会被允许重复入库（v5 想防的正是这个）。
缓解：
- 采集器命中 ID 时判重照旧生效。
- 用户可在账号页删除多余卡片（删除会同时清理加密凭证）。
- 重复卡片不影响发布正确性（发布按 accountId 取凭证）。

### 10.2 明确不做

- **不给 name 加任何「更聪明」的判据**（模糊匹配、相似度、前缀匹配）。
  那只会把误判边界从「完全相等」挪到「足够相似」，同平台多账号仍然被拒。
- **不做存量数据迁移**。历史上被 v5/启动去重清掉的账号无法恢复；
  未受影响的存量账号（含无 ID 的多账号）在新判据下全部保留。
- **不改前端错误展示逻辑**。409 透传链路（python-bridge → formatUserError → ElMessage.error）
  本身正确，问题只在判据。

### 10.3 兼容性

- `POST /api/accounts` 请求/响应结构不变，无 API 破坏。
- `accounts.json` schema 不变，无迁移。
- 前端无需改动（无新增 i18n 键，无新增字段）。

---

## 十一、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 同平台第 2 个账号（无 ID）可成功保存 | pytest `test_create_account_same_platform_different_account_no_id_not_duplicate` |
| 2 | 同平台第 3 个账号同样可保存 | 同上（可叠加） |
| 3 | 同一平台同一 ID 仍返回 409「此账号已添加过」 | pytest `test_create_account_same_platform_same_account_id_is_duplicate` |
| 4 | 重启后同平台多账号不被清掉 | pytest `test_startup_dedup_keeps_same_platform_accounts_without_ids` |
| 5 | 全部后端测试通过（存量失败与本次无关） | `pytest` 全量 + 基线对照 |
| 6 | 前端账号页测试通过 | `vitest run src/views/Accounts.test.js`（126 例） |
| 7 | 应用可正常打包并干净启动 | QM-1：asar + 三层启动判据（存活/stderr 空/无红线） |
| 8 | 变异反证：摘掉修复测试变红 | 见 §8.1 |

---

## 十二、变更清单

| 文件 | 变更 |
|---|---|
| `packages/python-backend/src/server.py` | 新增 `_account_identity_key`；`create_account` 去重改为单一强标识判据；`_dedup_accounts_on_startup` 判据改为同源 |
| `packages/python-backend/tests/test_server_account_lifecycle.py` | 新增 10 例（创建 7 + 启动 3）；改写 4 例旧契约断言；更新 2 例启动去重测试数据 |
| `01-docs/PRD.md` | 新增 §「账号同平台多账号去重契约（2026-10-21）」；修正 2 处「重复账号」数据校验表述；v5 章节加 ⚠️ 废止说明 |
| `01-docs/PRD-MULTI-ACCOUNT-SAME-PLATFORM-2026-10-21.md` | 本文件 |

未改动：前端任何文件、i18n locales、IPC 通道、`accounts.json` schema。
