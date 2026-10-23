# PRD：发布队列频控与发布判据（2026-10-23）

> 本文沉淀 2026-10-22~23 真机排查结论，补齐「发布频率控制」「发布成功判据」「用户可见反馈」三块的规格。

## 1. 背景与要解决的问题

真机出现「`publish:batch ok` 有 taskId，但任务从不执行、无报错、无日志」的现象，累计误导排查 20+ 轮。
最终定位：**任务在 `TaskQueue._executeTask` 内被发布频率守卫拦截，进入 `_delayed` 长等待**，而该分支原本**不写任何日志**。

## 2. 频控机制（数据校验与流程）

### 2.1 两档校验

| 档位 | 键 | 含义 | 判定字段 |
|---|---|---|---|
| `platform` | `platform` | 同一平台全局最小间隔 | `platformMinMs` |
| `account` | `platform:accountId` | 同一账号最小间隔（优先） | `accountMinMs` |

### 2.2 日配额

| 字段 | 说明 |
|---|---|
| 表 | `publish_daily_count(owner_subject, key, day_key, count, rollback_count, updated_at)` |
| `count` | 已**实际提交到平台**的次数；未提交失败会幂等回补（下限 0） |
| `rollback_count` | 回滚尝试次数，只增不减（防风上限） |
| `day_key` | 本机运营日 `YYYY-MM-DD` |
| 保留 | 最近 7 天 |

### 2.3 拦截时的判定对象

```js
const verdict = guard.check(platform, accountId)
// => { allowed:false, bucket:'account'|'platform'|'daily', reason:'interval'|'daily_quota',
//      remainingMs:number, daily:{used,max,dayKey} }
```

**数据校验要求**：`remainingMs` 必须为正整数；异常（负值/非有限数/超过 24h）一律按 0 处理并记 warn，避免任务无限等待。

## 3. 流程（一次发布的完整链路）

```
publish:batch
  → taskQueue.add(task)                 // 入队
  → _processNext()                      // 驱动
      → _executeTask(task)
          → 占槽 _running.set / _runningByChannel++
          → guard.check(...)            // 同步判定
              ├─ allowed=false ⇒ 写 _delayed + setTimeout(remainingMs) ⇒ return（不调 executor）
              └─ allowed=true  ⇒ 调用 executor
                  → [exec] enter → register → emit → createPublisher
                  → RPA 填表 → 点击发布 → 判据核验
```

## 4. 可观测性（强制）

每条关键分支**必须**输出结构化日志，字段名固定：

| 场景 | 日志 |
|---|---|
| 驱动入口 | `[queue] enter paused=<bool> queue=<n> running=<n> delayed=<n>` |
| 开始执行 | `[queue] exec task=<id> platform=<p>` |
| 被频控拦截 | `[queue] blocked bucket=<b> reason=<r> remainingMs=<n> daily={"used":n,"max":n,"dayKey":"..."}` |
| 进入延迟队列 | `[queue] delayed task=<id> waitMs=<n>` |
| 执行器分步 | `[exec] enter / register / emit / publisher task=<id>` |

> 只允许用项目 logger（`require('./services/logger').info/warn/error`）。**`console.*` 不会写入 `app-YYYY-MM-DD.log`**，用它打点等于没有打点。

## 5. 交互逻辑与提示文字

### 5.1 入队前预检（新增要求）

`publish:batch` 在返回 taskIds 之前必须检查守卫：

| 情况 | 返回 | 提示文字 |
|---|---|---|
| 可用 | `code:0` | — |
| 账号间隔未到 | `code:2001` | 「该账号距上次发布不足 N 分钟，预计 HH:mm 后可再次发布」 |
| 日配额用尽 | `code:2002` | 「该账号今日发布次数已达上限（N/N），将于次日 00:00 恢复」 |

**禁止**接受任务后再静默等待——用户会以为已发布。

### 5.2 等待中状态显示

任务列表行需显示：`等待频控 · 剩余 MM:SS · 原因：账号间隔`

### 5.3 失败提示

`publish verification timeout` 必须区分两种：
- 判据不命中（页面已重置但列表未见作品）⇒ 「发布结果待确认，请到平台作品列表核对」
- 平台明确拒绝 ⇒ 展示平台原文

## 6. 发布成功判据（按平台）

| 平台 | 判据 | 证据字段 |
|---|---|---|
| 抖音 | DOM 成功态 | `mode:'dom'` |
| 小红书 | 草稿箱出现该标题（IndexedDB `draft-database-v1`） | `evidence:'idb-title-match'` |
| 视频号 | **作品列表出现该标题**（`channels.weixin.qq.com/platform/post/list`） | `evidence:'post-list-dom'` |
| 今日头条 | 作品列表接口命中 | `mode:'artifact'` |

**原则**：判据必须是「用户可见结果」，不是「页面发生了什么变化」。视频号发布后页面会重置为壳页，任何基于 URL/文案变化的判据都必然超时。

## 7. 验收标准

1. 频控拦截时日志出现 `[queue] blocked …`，含 `bucket/reason/remainingMs/daily`
2. 频控等待上限 15 分钟，超时强制重新判定
3. `publish:batch` 对不可发状态返回明确错误码与提示文字
4. 四平台判据按上表实现，且失败时不误报成功

## 8.8 今日头条：发布按钮可能是「预览」而非「发布」（2026-10-23 待证）

### 线索

| # | 证据 | 出处 |
| --- | --- | --- |
| 1 | `publish_btn: ['button:has-text("预览并发布")', …]` —— `has-text` 是**子串匹配**，首选项即「预览并发布」 | `packages/rpa-engine/src/platform-selectors.js` L132 |
| 2 | 既有注释：「点『预览并发布』后**只存草稿**」 | `apps/desktop/electron/services/toutiao-cover.js` L114 |
| 3 | 15:49 运行：`publishing...` → `confirm dialog probe: NO_DIALOG` → **0 条发布请求** → 无作品 ID | 当日日志 |
| 4 | 14:27 运行：`CONFIRMED_IN_MODAL:确定`，但该「确定」来自**封面弹窗**（封面失败后 1 秒内） | 当日日志 |

### 推论

若点击落在「预览并发布」，则该按钮只触发草稿保存，**不产生发布请求、也不弹确认框**——与 15:49 的 `NO_DIALOG` + `no-endpoint-hit` 完全吻合。

### 为何未立即改选择器

- `DIAG[publish2] pubBtn=4` 与选择器数组 3 项**不一致**，实际匹配集与配置不同；
- 头条可能确实是两步流程（预览并发布 → 确认发布），盲改会让原本可用的路径失效；
- 已排程 17:05 运行打印 `publish button shape:`，列出每个候选按钮的**文本 / disabled / 宽高**。

### 判据（17:05）

| dump 显示 | 动作 |
| --- | --- |
| 存在可用（`dis=false`）的「发布」或「确认发布」 | 调整选择器顺序，优先精确文本的发布按钮 |
| 4 个候选全部 `dis=true` | 说明还有前置条件未满足（非按钮选择问题） |
| 只有「预览并发布」可用 | 需在其后补「确认发布」一步 |

### 数据校验口径

- 成功唯一判据：**作品列表出现新作品**（用户可见）；
- `publishing...`、`CONFIRMED_IN_MODAL`、HTTP 2xx **均不作为成功证据**。

## 8.9 今日头条：平台侧「账号信息未完善」拒绝发布（2026-10-23 实证）

### 证据

```
09:03:37  [toutiao] publishing...
09:03:37  [toutiao] exact 发布 click: clicked          ← 点击确实落到了「发布」
09:03:40  [toutiao] confirm dialog probe: MODAL_NO_MATCH:
          「账号信息未完善 - 账号信息未完善，暂时不能进行发布文章、视频等权益操作，请完善后重试」
          buttons = [取消] [去完善]
09:03:40  url 仍为 .../xigua/upload-video，发布请求 0 条
```

### 结论

| 环节 | 状态 |
| --- | --- |
| 视频上传 | ✅ |
| 标题写入 | ✅ `hasTitle=true` |
| 封面 | ✅ 已改为走 `cover_input`（弹窗不再出现） |
| 发布点击 | ✅ `clicked` |
| **平台受理** | ❌ **账号信息未完善** |

⇒ 这不是代码缺陷，而是**账号资质**问题。代码侧能做的已全部走通。

### 处置

1. 该账号需在头条创作后台补齐资料/资质后重试；
2. 或改用已有发布权益的账号（本仓已用 `45261bb5` 做对照）；
3. 提示文字建议（产品侧）：当检测到页面出现「账号信息未完善」时，向用户显式提示
   「请先到该平台后台完善账号信息后重试」，而不是笼统报「缺少作品 ID」。

## 8.10 视频号：账号选择与「切换视频号」弹窗（2026-10-23 实证）

### 账号

| 账号 | 判定 | 说明 |
| --- | --- | --- |
| `0891817b` | ❌ 失效 | 分区仅 4 条 cookie、cookie 库为空；`errCode 300334/300342` 全部来自它 |
| `ccfe6492` | ✅ 有效 | `CHECK_LOGIN_SUCCESS_HTTP_API`、`valid=true`、`status=active` |

### 换对账号后的进展

```
API 轨：Step1 helper_upload_params → errCode:0 + authKey ✅
        applyuploaddfs → 404（host=(baseURL)）
RPA 轨：进入 /platform/post/create ✅
        desc filled readback=189 ✅
        short title filled readback=16 ✅
        发布被「切换视频号」弹窗遮挡 ❌
```

### 修复

- 发布前检测含「切换视频号」的弹窗并点 `取消` / `我知道了`（`9ee055e77`），日志输出
  `[tencent_video] switch-account modal: dismissed:取消|none`。
- apply 的 404：Step1 响应体只含 `authKey/uin/appType/fileTypes`，**不含 `cdnHost`** ⇒
  真实上传主机需从页面 `envInfo` 读取，不能依赖固定常量。

### 数据校验

- 成功唯一判据：**平台作品列表出现该作品**；
- `publishing...`、`clicked`、HTTP 2xx 均不作为成功证据。
