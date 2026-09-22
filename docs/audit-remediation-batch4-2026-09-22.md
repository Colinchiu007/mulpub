# 全仓代码体检整改 · 第 4 批（P2 技术债）详细规格

- 批次标识：`audit-batch-4`
- 日期：2026-09-22
- 来源：`.adversarial/codebase-audit-20260922/proposal-v7.md` 第 4 批（P2 技术债余项）
- 分支 / PR：`codex/audit-p2-debt`（worktree `D:\Data\projects\mp-worktrees\mp-audit-p2-debt`）
- 读者：桌面端/后端开发、运维中心值班、发布前审查人

本批性质是「还技术债」，不改产品需求，但**改变了多处运行时行为与用户可见文案**，因此按质量节拍要求，把数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字逐条写清。

---

## 0. 本批清单与结论

| # | 体检项 | 结论 | 落地位置 |
|---|--------|------|----------|
| 1 | 固定 `sleep` 充当就绪判定 | 4 处全部条件化，超时原因可见 | §1 |
| 2 | 配置侧 N+1 查询 + 批量写非事务 | 改批量预取 + 单事务 | §2 |
| 3 | 受限 API 每次调用打同步 IPC | 推送失效 + TTL 兜底缓存 | §3 |
| 4 | async 路由内做同步 DNS 解析 | `asyncio.to_thread` | §4 |
| 5 | 有意降级被 `catch {}` 吞掉 | 补留痕并流入用户可见 warnings | §5 |
| 6 | 同一枚举两处手抄 | 引擎元数据派生单一来源 | §6 |
| 7 | 同一任务文件重复上传两遍 | 按任务指纹共享 in-flight | §7 |
| 8 | 超大文件无逐门禁 | `check-max-lines` + 100 条挂账 | §8 |
| 9 | 依赖无上限、CVE 无人复核 | requirements 补上限 + `check-dep-audit` 29 条挂账 | §9 |
| 10 | `flutter-skill-bridge` 归属不明 | 判据成立，git 侧无可删项 | §10 |

---

## 1. 脆弱等待条件化（固定 sleep → 条件轮询）

### 1.1 通用改造原则

1. **上限必须具名**：`XXX_TIMEOUT` 常量而非字面量，便于运维按站点/模型抖动调整时定位。
2. **超时必须给出原因**：原来「超时或失败」这种合并文案在排查时无法区分「轮询窗口用尽」与「对端明确返回 failed」，一律拆开。
3. **不得新增失败路径**：这些 sleep 原本超时后是继续往下走的。条件等待超时**只记日志并继续**，因为「等不到」在 RPA 场景里只代表「页面结构与选择器不匹配」，不代表「采不到 / 发不出」。把等不到判成失败会把可用路径改坏。

### 1.2 `apps/desktop/electron/services/url-collector.js`（链接采集）

| 参数 | 值 | 说明 |
|------|----|------|
| `CONTENT_READY_TIMEOUT_MS` | 10000 | 正文就绪等待上限 |
| `CONTENT_READY_POLL_MS` | 250 | 轮询间隔 |
| `CONTENT_MIN_TEXT_LEN` | 200 | 命中判据的最小正文长度 |
| `CONTENT_READY_SELECTORS` | `article`, `main`, `[class*="article"]`, `[class*="content"]`, `[id*="content"]`, `[class*="post"]`, `[class*="detail"]` | 通用启发式容器 |

- **判定逻辑**：`document.readyState === 'complete'` **且**（候选容器内最大 `innerText.trim().length >= 200` **或** 无匹配容器时 `body.innerText.trim().length >= 200 * 20`）。
  退化到 body 阈值 ×20 的原因：没有语义容器的站点，整页正文通常几十 KB，用 200 会被导航栏/cookie 横幅假命中。
- **原缺陷**：`page.goto(..., waitUntil:'load', timeout:30000)` 之后是 `page.waitForTimeout(2000)`，注释却写「等待内容容器出现（最多 10s）」——慢站点 2s 内未渲染就取 HTML（解析成空正文），快站点白等 2s。
- **超时提示文字**（`log.warn`，category `UrlCollector`）：
  `content-ready 条件等待超时 10000ms（判据：正文容器 innerText>=200），按当前 DOM 继续采集`
- **用户可见影响**：采集耗时上限不变（仍 ≤10s），成功采集的正文更完整；无新增失败提示。

### 1.3 `apps/desktop/electron/services/videogen-stages.js`（文生视频轮询）

| 参数 | 值 |
|------|----|
| `VIDEO_POLL_TIMEOUT_MS` | `10 * 60 * 1000`（600s） |
| `VIDEO_POLL_INTERVAL_MS` | `10 * 1000` |
| `TERMINAL_STATES` | `failed`, `error`, `cancelled`（小写比较） |

- **流程变更**：原实现进循环先 `sleep(10s)` 再查状态，**秒回的任务也要白等 10s**；现改为「立即查 → 判终态 → 判剩余窗口 → sleep」，且当 `Date.now() + INTERVAL > deadline` 时提前退出（不做注定被截断的最后一轮）。
- **失败文案（任务卡片 / 阶段错误列显示，逐字）**：
  - 终态：`视频生成失败：任务状态为 failed（provider: <providerId>）`
  - 窗口耗尽：`视频生成失败：轮询超时（上限 600s，末次状态=<state 或 unknown>）（provider: <providerId>）`
  - `lastState` 取 `status.status || status.data.status`，统一 `String(...).toLowerCase()`。
- **数据校验**：URL 兼容三种回包位置 `videoUrl | url | data.videoUrl | data.url`，取到即成功，不再依赖状态字段。

### 1.4 `apps/desktop/electron/services/rpa-view-helpers.js`（响应等待串行化）

- **缺陷机理**：`session.webRequest.onCompleted` 是**会话级单例**拦截器——同一 `session` 后一次注册直接覆盖前一次，且前一次的 `cleanup()` 会把它置 `null`。并发调用 `_waitForResponse` 时，先发起的那次永远收不到回调，只能等 `timeout`（默认 60000ms）兜底，表现为「同一浏览器窗口里多个采集步骤互相拖慢」。
- **修复**：新增模块级 `WeakMap _responseWaitChains`，**按 session 串行化**——后来者挂在前一次的尾巴上；链上只存「永不 reject」的尾巴（`run.catch(() => {})`），避免一次失败毒化后续所有等待者。真实超时行为与默认值不变。
- **不留死变量**：链尾本身即「本次已结束」信号，不需要额外 deferred（首版曾写了无人 `await` 的 `settledSignal`，rebase 前已清除）。

### 1.5 `packages/python-backend/src/multi_publish/publishers/xiaohongshu.py` + `base.wait_until`

新增公共原语 `multi_publish.publishers.base.wait_until(predicate, timeout_s, interval_s=0.5) -> bool`：

- `predicate` 同步/异步均可；**抛异常按「本轮条件不成立」处理**（页面导航中等瞬时错误不该终止等待）——这条语义是 QM-5 红验证点之一（把异常改成上抛，用例立刻红）。
- `interval_s` 下限 `0.05`；最后一次 sleep 被裁剪到 deadline，不越过上限。
- 返回 `False` 表示超时，**调用方必须显式处理并记录超时原因**。

小红书发布器两处：

| 常量 | 值 | 替代的原始代码 | 判据 |
|------|----|----------------|------|
| `NAVIGATE_READY_TIMEOUT_S` | 10.0 | `await asyncio.sleep(3)` | `selectors["upload_input"]` 首个元素可见 |
| `NAVIGATE_READY_POLL_INTERVAL_S` | 0.5 | — | — |
| `UPLOAD_FALLBACK_WAIT_TIMEOUT_S` | 30.0 | 上传标志未命中时 `await asyncio.sleep(30)` | `selectors["title_input"]` 首个元素可见（= 已进入可填写状态） |
| `UPLOAD_FALLBACK_POLL_INTERVAL_S` | 0.5 | — | — |

**提示文字（logger.warning，逐字）**：

- `上传控件 %s 在 %ss 内不可见（原因：页面未完成首屏渲染或站点结构变化），继续按当前页面状态执行`
- `未检测到上传完成标志 %s，改为轮询编辑器就绪（上限 %ss，间隔 %ss）`
- `编辑器在 %ss 内未就绪（原因：媒体上传未完成或站点结构变化），继续尝试填写标题`

> 说明：上限沿用原 30s，不放宽容忍度；改造收益是**快路径提前返回**（原实现无论上传是否完成都硬等半分钟）。

---

## 2. 运营中心后端：N+1 消除 + 批量更新单事务

### 2.1 `GET /config/audit-log`（掩码不再逐行回查）

- 旧实现：对每条日志的 `old_value` / `new_value` 各回查一次配置项，`limit=500` 时最多 **1000 次 SELECT**。
- 现实现：`config_service.get_secret_flags(db, ids)` 一次 `WHERE id IN (...)` 批量预取 + 纯函数 `routers/config.py:_mask_value(value, is_secret)`。
- **掩码数据校验**（与第 2 批 P1-5 对齐）：
  - 仅 `is_secret` 为真且值非空时掩码；
  - `len(value) > 8` → `value[:4] + "***" + value[-4:]`（例：`sk-longsecret-value` → `sk-l***alue`）；
  - 否则整体 `***`；
  - **幂等**：值中已含 `***` 时原样返回。P1-5 起审计值在写库时已掩码，本函数只兜底存量明文行，二次掩码会把掩码本身伪装成另一个值。

### 2.2 `GET /sync/status`（一次 GROUP BY）

- 旧实现：逐项目 `get_configs_by_project()` 把整表配置读进内存只为 `len()`。
- 现实现：`get_config_counts_by_project()` 一次 `SELECT project_code, COUNT(id) ... GROUP BY project_code`；缺失键按 `0`。
- 响应字段与语义完全不变：`projects[] = {project, config_file, file_exists, items_in_db}`。

### 2.3 `PUT /config/batch`（整批单事务 + 与 P1-5 加密语义共用）

- 新增 `config_service.batch_upsert_configs(session, payloads, updated_by)`：
  1. 按主键一次 `IN` 批量预取（`get_configs_by_ids`）；
  2. 逐条 `_apply_upsert(...)`（**只写不提交**）；
  3. 全部成功 → 单次 `commit()`；
  4. 任一异常 → `rollback()` + `logger.exception("batch_upsert_configs 失败，已整批回滚（%d 条）")` + 原样上抛。
- 旧实现逐条 `upsert_config` + 逐条 COMMIT，中途失败会留下「前半已生效、后半未写入」的半更新状态，且配置写库与审计日志不成套。
- `upsert_config` 新增 `commit: bool = True` 参数（单条接口行为不变）。

#### ⚠ 与第 2 批 P1-5 的融合（本批最重要的正确性判定点）

本批开工时的 worktree 基线**早于** PR #2226，因此 `batch` 改造初版直接在 `_apply_upsert` 里写了 `existing.value = value`（明文入库）。rebase 到 `origin/main` 时与 P1-5「敏感配置写库前加密」冲突，若按常规「取我方版本」解冲突，就会在 `PUT /config/batch` 这个入口**静默回退一条已修的凭据明文入库漏洞**。

融合后的契约（写在 `config_service._apply_upsert` 单点，两条入口共用）：

1. 敏感判定 `secret_flag = int(existing.is_secret) or int(is_secret)` —— **以库中既有标记为准**（批量表单不传 `is_secret`，以入参为准会把敏感项降级成明文）。
2. 值以 `enc:v1:` 自描述密文入库（`encrypt_secret_value`）。
3. 客户端回填掩码回显值（含 `***` 且与旧明文不同）→ 视为未变更，保留原凭据，日志：`[P1-5] {config_id}: 提交了掩码回显值，保留原凭据不覆盖`。
4. 审计表只存掩码（`audit_display_value`）；`_apply_upsert` 返回 `(item, audit_old, audit_new, change_type)` 四元组，因此**批量路径自己构造 `ConfigAuditLog` 时不可能拿到明文**。
5. 存量密文不可解时 `plaintext_value()` 抛错 → 整批回滚（fail-closed：审计掩码必须读旧明文，读不出来就不能写）。

**回归保护**：`ops-center/backend/tests/test_p4_txn_and_queries.py::test_batch_upsert_keeps_p1_5_secret_semantics`（断言 `is_secret` 保持、`enc:v1:` 前缀、明文可解回、审计两行均不含明文且含 `***`）与 `::test_batch_upsert_masked_echo_preserves_credential`（掩码回显不覆盖真实凭据）。

---

## 3. 桌面端访问级别：同步 IPC 改「推送失效 + TTL 兜底」

### 3.1 问题与收益

`preload/access-control.js` 的 `createDynamicAccessApi` 在**每个受限 API 调用前**都要判权限，而原 `getAccessLevel` 每次打一个 `ipcRenderer.sendSync('auth:get-access-level')`。同步 IPC 会**阻塞渲染进程**直到主进程事件循环排空该请求；列表轮询、进度回调这类高频调用等于每次多交一份性能税。

### 3.2 协议常量（新增单一来源 `electron/core/access-level.js`）

| 常量 | 值 | 用途 |
|------|----|------|
| `ACCESS_LEVELS` | `['public','authenticated','admin']`（冻结） | 主进程与 preload 两侧共用，杜绝字面量各写一份 |
| `ACCESS_LEVEL_CHANNEL` | `auth:get-access-level` | preload → 主进程同步查询 |
| `ACCESS_LEVEL_INVALIDATE_EVENT` | `auth:access-level-invalidated` | 主进程 → preload 失效推送 |
| `ACCESS_LEVEL_TTL_MS` | `2000` | 漏收推送时的兜底回源周期 |

该模块必须是**纯常量**（不得 require electron 之外的主进程依赖）：preload 侧经 esbuild 打进 `index.bundle.js`，在 sandbox renderer 加载。

### 3.3 缓存语义（`preload/access-level-cache.js`）

- 两级失效：① 收到推送立即失效；② TTL 到期后回源一次。**不重载窗口也能立即生效**这一既有契约保持不变。
- 失败关闭：回源抛异常 / 返回非法值（不在 `ACCESS_LEVELS` 内）→ 一律按 `'public'`。
- **只推「失效」不推「级别」**：级别判定含 sender 可信度，服务端（`controlledIpcMain` 每个 handler 再校验一次）才是权威；推信号既避免两侧各算一份级别，也不扩大敏感信息暴露面 → **缓存不可能提权**。

### 3.4 失效广播点（业务侧必须显式广播，否则最长等一个 TTL）

| 触发点 | reason 字符串 |
|--------|---------------|
| `license:activate` 成功 | `license-activate` |
| `license:deactivate` | `license-deactivate` |
| `license:activate-trial` 成功 | `license-activate-trial` |
| identity `onStateChanged` | `identity-state-changed` |

- 广播能力在 `bootstrap/phase5-ipc.js` 里 `bindAccessLevelInvalidator(createAccessLevelInvalidator(BrowserWindow, log))` 绑定一次（只有 bootstrap 持有 `BrowserWindow`）；**绑定失败不得静默**，否则缓存退化为纯 TTL。
- identity 侧顺序要求：先 `emitAccessLevelInvalidated` 再投递业务事件——主窗口不可用也不能跳过广播（否则其他窗口要等一个 TTL 才收敛）。
- 顺带收口：identity 状态投递的 `catch {}` 改为 `log.warn('[identity] 状态变更投递失败: ' + msg)`（有意降级但必须留痕，且不中断状态机）。

### 3.5 交互与显示影响

免费版用户点击受限功能仍立即弹「许可证权限不足」；**激活成功后第一次调用即放行**（不依赖窗口刷新）。级别变化到 UI 生效的延迟上界由「每次调用一次同步 IPC 往返」变为「一次推送（通常即时）或 2s TTL」。

---

## 4. async 路由内的阻塞式 DNS 解析

`ops-center/backend/services/model_preset_service.py:fetch_models_from_url` 的 SSRF 校验里，`socket.getaddrinfo` 直接跑在事件循环线程内：公网 DNS 抖动或 IPv6 重试会**卡死整个服务**，连带无关请求排队。

- 修复：抽出 `_validate_target_url_async`，解析走 `await asyncio.to_thread(socket.getaddrinfo, host, port, proto=socket.IPPROTO_TCP)`，**判定逻辑与错误文案零变化**。
- 保留的已知边界（写进 docstring，不夸大能力）：校验解析与 httpx 实际连接是两次独立 DNS 解析，存在 DNS 重绑定 TOCTOU 窗口；`follow_redirects=False` 已防 3xx 跳转。
- 校验规则不变：非环回主机必须 `https`；解析结果命中私网/保留地址 → `ValueError`；解析失败 → `无法解析获取模型ID URL 的主机名`。
- 回归：`test_ssrf_dns_resolution_runs_off_event_loop`（断言解析发生在非主线程）+ `test_fetch_models_source_has_no_blocking_getaddrinfo`（源码级禁止 `resolved = socket.getaddrinfo` 出现在该 async 块内）。

---

## 5. 静默 catch 补降级留痕（用户可感知，必须可排查）

### 5.1 `packages/video-clone-engine/src/adapters/compose-ffmpeg.js`

- 新增注入项 `logger = null` 与内部 `noteFailure(stage, err)`（stage ∈ `probe` / `scene-detect`）；返回原因字符串。
- `ctx.artifacts.output` 新增两字段：`probeError` / `sceneError`（成功时为 `null`）。
- 语义不变：`ffprobe` 输出校验失败仍返回（时长走 `plan-fallback`）、场景检测失败不阻断（`shots=null`）。

### 5.2 `packages/video-clone-engine/src/pipeline.js`（原因流向用户可见 warnings）

`buildMeasuredCloneReport` 现在把原因写进 `similarity.warnings`：

| warnings 键 | 出现条件 | 取值 |
|-------------|----------|------|
| `probeFailed` | `probeOk === false` | `out.probeError`，无原因时 `'unknown'` |
| `sceneDetectFailed` | `shots` 非数组 | `true`（既有布尔） |
| `sceneDetectReason` | 同上 | `out.sceneError`，无原因时 `'unknown'` |

`buildMeasuredCloneReport` 导出仅为回归用例服务，**不对外承诺 API 稳定性**（已在 `module.exports` 处注明）。

### 5.3 `packages/story2video-engine/src/slideshow.ts`

新增 `createDegradationSink(onWarn?)`：宿主注入则交宿主 logger，未注入落 `console.warn('[slideshow] ' + stage + ' 降级: ' + msg)`；**留痕本身绝不因回调异常再抛错**（宿主回调异常被吞是有意为之）。`createSlideshowVideo` 的 `options` 新增可选 `onWarn(stage, msg)`。

四处降级点与用户可见表现：

| stage | 触发场景 | 用户侧表现 |
|-------|----------|------------|
| `audio-duration` | 配音取不到 / 解码失败 | 成片时长回退默认 8s，与文案长度不匹配 |
| `bgm-load` | BGM fetch/解码失败 | 无配乐，音量滑块无效 |
| `audio-mix` | 音轨混流失败 | 退回纯画面轨 → **成片静音**（最需要被看见的降级） |
| `recorder-stop` | 安全超时兜底时录制器已停 | 预期竞态，留痕便于区分真异常 |

### 5.4 rewrite-engine

- `knowledge-base.js`：损坏 JSON 不再静默当作空库，记录解析失败原因（避免「记忆凭空清零」无痕）。
- `knowledge-evolution-scheduler.js`：定时器异常留痕，防止后台任务静默停摆。

### 5.5 通用判据

**「有意降级」与「错误吞掉」的区别只在于是否留下原因**。本批所有留痕用例都断言「原因字符串必须出现在 warnings / 日志调用参数里」，而不是只断言「不抛错」——旧用例只断言不抛错，恰好是吞异常行为的镜像，这就是它逃逸的原因。

---

## 6. 动效/转场枚举单一来源

- 问题：`create-view-module-utils.js` 的 `S2V_RESTORE_ENUM_OPTIONS.imageEffect / transition` 与 `story2video-engine/effects-library.ts` 的效果元数据是两份独立清单。引擎新增效果后，桌面端把用户已存的值判为「陈旧值」**静默丢弃**，用户表现为「动效设置莫名回默认」。
- 方案：`effects-library.ts` 导出派生常量
  `IMAGE_EFFECT_IDS` / `TRANSITION_EFFECT_IDS` = `Object.freeze(['none', ...元数据顺序中非 none 的 id])`；
  `'none'` 恒置顶、其余保持登记顺序，**与迁移前桌面端两处手抄列表逐项一致 → UI 下拉与快照恢复行为零变化**。
- 包导出新增子路径 `@multi-publish/story2video-engine/effects-library`。
- 删除 `apps/desktop/src/views/create-view-utils.js`（无消费方的重复副本）。
- 反向漂移防护：`apps/desktop/src/views/video-creation/effects-single-source.test.js` 断言「引擎新增 ID 未同步到 UI 选项」即失败（防止单一来源变成只有引擎知道）。

---

## 7. 通用平台适配器：同任务文件只上传一次

`packages/api-publish-engine/src/adapters/generic-adapter.js`

- 缺陷：orchestrator 的 `upload()` 一次就把「视频 + 封面」全传完，而基类发布流程先 `uploadVideo()` 再 `uploadCover()`，两个方法各跑一遍 `upload()` → 同一任务文件**重复上传两遍**：带宽/配额翻倍、平台侧产生冗余素材、大视频场景耗时直接翻倍。
- 方案：`this._uploads = new Map()`，`_uploadKey(td, cookie) = [name, filePath, coverPath, taskId||id, String(cookie).length].join('|')`；同指纹共享同一 in-flight Promise。
- 关键校验：**失败不缓存**（`.catch` 里 `delete` 后再抛）——缓存一个已 reject 的 Promise 会让上层重试永远失败。
- 容量保护：跨任务复用同一 adapter 实例时 `_uploads.size > 32` 即 `clear()`，防无界增长。
- 返回值语义不变：`uploadVideo` 取 `r.video`、`uploadCover` 取 `r.cover`，缺失时返回 `null`。

---

## 8. 逐文件行数门禁 `check-max-lines`

- 为什么已有 `scripts/check-debt-budget.js` 还要加：debt-budget 是**全仓聚合**棘轮（最大行数 / ≥1000 行数 / ≥500 行数），「拆掉一个大文件 + 新写一个大文件」互相抵消而无人报警；eslint `max-lines` 只覆盖 `apps/desktop`，Python 侧 1000+ 行文件完全不在门禁内。
- 扫描口径与 debt-budget 一致（用例做字面量比对防漂移）：`SCAN_DIRS = apps/desktop/src, apps/desktop/electron, packages, ops-center/backend`；`SOURCE_EXTS = .js .ts .vue .py .tsx .jsx .css .scss`；`EXCLUDE = node_modules, dist, .git, tests, test, __tests__, dist-electron`。
- 阈值：`limit = 500`，`growthAllowance = 200`。
- 三条硬规则：
  1. `NEW_OVER_LIMIT` —— 超限且未挂账 → 阻断（新代码必须拆分）；
  2. `STALE_LEDGER_ENTRY` —— 挂账文件已不存在或已拆到 limit 以下 → 阻断（清单必须反映现实：不留僵尸条目、已还的债必须清账）；
  3. `LEDGER_GREW` —— 存量条目较登记值增长超过 `growthAllowance` → 阻断（允许小幅维护改动，不允许继续膨胀成新债）。
- 首次挂账 **100 个** 存量超限文件（`apps/desktop` 61、`packages/python-backend` 22、`rewrite-engine` 5、`remotion-composer` 4、`ops-center/backend` 3、其余 5），最大者 `apps/desktop/src/views/CreateView.vue` 5657 行。
- CI：挂在 `debt-guard.yml`（`node .github/scripts/check-max-lines.js` + `node --test .github/scripts/check-max-lines.test.js`）。
- 运维：`node .github/scripts/check-max-lines.js --update` 重新生成挂账；`--json` 供脚本消费。

---

## 9. 依赖锁定与 CVE 审计门禁

### 9.1 `ops-center/backend/requirements.txt`

12 行依赖全部由「只有 `>=` 下限」补成「下限 + 上限」，并在文件头写清政策：

- 下限 = 已验证可用的版本；上限 = 阻止未验证的大版本自动进入生产/CI；
- 只写 `>=` 等于把「上游发布破坏性版本」交给运气；任何上限放宽都必须显式改本文件并跑 `python -m pytest ops-center/backend/tests`；
- **实测教训**（已写进文件注释）：上限收得比已公告漏洞的修复版本还低，等于把解析结果钉在漏洞版本上——`cryptography` 一度写 `<46.0.0`，`pip-audit` 当场报出 7 条公告；查得最新为 50.0.1 后改 `<51.0.0`。结论：**改上限必须重跑门禁**。
- 可解析性验证：`pip install --dry-run -r requirements.txt` → 退出码 0。

### 9.2 `scripts/check-dep-audit.js` + `scripts/dep-audit-baseline.json`

- 实跑两套扫描器：`pnpm audit --json --registry=https://registry.npmjs.org`（**必须显式官方源**，npmmirror 无 audit 端点）与 `pip-audit -r requirements.txt --format json`；可用 `NPM_AUDIT_REGISTRY` 覆盖。
- 首次基线 **29 条**（npm 28 + pip 1），decision 分布：`upgrade-tracked` 28、`no-fix-available` 1；全部 `reviewBy = 2026-12-31`。
- 挂账条目强制三字段：`decision` ∈ `upgrade-tracked | accepted-risk | not-exploitable | no-fix-available`、`note`、`reviewBy`；缺任一或到期 → 阻断。
- 四类输出：`NEW_ADVISORY`（新公告未挂账）、`RESOLVED_STILL_BASELINED`（已修复却还挂着）、`BASELINE_META_INVALID`（结论不完整）、`REVIEW_DEADLINE_PASSED`（到期未复核）。
- `--update` 生成新条目时 decision 一律写 `TODO`，逼人工补结论。
- 扫描器不可用（离线 / 工具缺失）时**只打 `::warning::SCANNER_UNAVAILABLE` 不判红**，每周计划任务为权威。
- pip 解析细节：同一公告在不同包里的 `fix_versions` 必须合并展示，否则「无修复」会盖掉「可升级到 x.y」。
- **note 必须经事实核验**（本批三处因此改写）：
  - `js-yaml` **是**直接依赖（root `^4.3.0` / api-publish-engine `^4.2.0` / shared-utils `^4.2.0`，11 处引用）；
  - `sharp` 也是直接生产依赖（`^0.35.1`，5 处引用）→ 二者结论为「刷新 lockfile 即可」；
  - `ecdsa`（PYSEC-2026-1325）由 `python-jose` 传递引入且**确在验签路径上被调用**（`auth.py` / `auth_service.py` / `logto_verifier.py`），但该公告是 Minerva 计时侧信道、影响面限定私钥运算，本仓不持私钥不签名，上游无修复计划 → `no-fix-available`，收敛动作是替换 `python-jose`（另行立项）。

### 9.3 `.github/workflows/dep-audit.yml`

`jobs.dep-audit` 8 步：checkout → pnpm 11.13.1 → node 22（cache pnpm）→ python 3.12 → `pip-audit` → `node --test scripts/check-dep-audit.test.js`（判定逻辑，不联网）→ `NPM_AUDIT_REGISTRY=... node scripts/check-dep-audit.js` → 结果说明。触发：`pull_request` + `schedule cron '0 3 * * 1'` + `workflow_dispatch`；`permissions: contents: read`。

> 契约提醒：`.github/scripts/workflow-contract.test.js` 全量禁止任何 workflow 给 `pull_request` 配 `paths-ignore`（required check 缺失会让纯文档 PR 卡在 BLOCKED），新 workflow 已遵守。

---

## 10. `flutter-skill-bridge` 处置判据（体检报告 §76）

判据原文：**「全仓 rg 零引用即删，否则补 README 说明用途」**，deadline = 下个发版周期末。

取证结果：

- `git ls-files | flutter` → 0 命中（git 侧无 tracked 文件）；
- 磁盘无 `flutter` 目录；
- `git grep -l flutter-skill-bridge` 仅命中 `.adversarial/codebase-audit-20260922/*` 评审产物本身。

结论：**判据成立，且 git 侧无可删项**——该名称只存在于评审文档中，不是仓库资产。处置动作为「在 CHANGELOG 记录判据与取证结论，避免下一轮体检重复提问」，不新增 README（为一个不存在的模块写说明属反向制造债务）。

---

## 11. 运维与复核手册

| 目的 | 命令 |
|------|------|
| 逐文件行数门禁 | `node .github/scripts/check-max-lines.js`（重新挂账加 `--update`） |
| 依赖漏洞门禁 | `node scripts/check-dep-audit.js`（重新挂账加 `--update`） |
| 后端测试 | `cd ops-center/backend; python -m pytest tests -q` |
| 桌面端测试 | `cd apps/desktop; npx vitest run` |
| 引擎测试 | `pnpm --filter @multi-publish/video-clone-engine test` 等 |
| 采集等待调优 | 改 `url-collector.js` 顶部常量（无环境变量） |
| 视频轮询调优 | 改 `videogen-stages.js` 的 `VIDEO_POLL_TIMEOUT_MS / INTERVAL` |
| 访问级别缓存 | `ACCESS_LEVEL_TTL_MS`（`electron/core/access-level.js`） |

新增/变更的环境变量：**本批无新增**。

---

## 12. QM-5 反哺汇总（缺陷 → 逃逸原因 → 保护 → 系统性措施）

| 缺陷 | 为什么没被拦住 | 新增回归保护 | 系统性措施 |
|------|----------------|--------------|------------|
| 批量更新可写明文凭据（rebase 时暴露） | 第 4 批基线早于第 2 批，改造在旧语义上写；P1-5 的批量用例只覆盖单条改语义 | `test_batch_upsert_keeps_p1_5_secret_semantics`、`test_batch_upsert_masked_echo_preserves_credential` | 加密/掩码语义收进 `_apply_upsert` 单点，两条入口共用；跨批并行时必须先 rebase 再改同一文件 |
| 受限 API 每次同步 IPC | 用例只断言鉴权结果，测不出「调用次数」 | `preload.test.js` 断言 `sendSync` 调用计数 + 推送后不重载即生效；`access-level-cache/bus` 单测 | 级别协议常量单一来源；变更级别必须显式广播 |
| 静默降级零痕迹 | 旧用例断言「不抛错」，恰是吞异常的镜像 | warnings 键与原因字符串必须出现；slideshow `onWarn` stage 必须被调用 | 「有意降级必须可见」写进留痕判据；注入式 logger，缺省 console.warn |
| 固定 sleep 当就绪判定 | 无人断言等待条件本身 | 假时钟 / `waitForFunction` 参数断言、`wait_until` 瞬时异常不上抛 | `wait_until` 沉淀为公共原语；超时必须带原因且不得新增失败路径 |
| 会话级单例拦截器被并发覆盖 | 只测单次等待，没测并发 | `rpa-view-helpers-wait-queue.test.js` | 单例资源按 owner 串行化（WeakMap） |
| N+1 与非事务批量写 | 没有 SQL 次数/事务边界断言 | `_counting_session` 计数 + 残留零断言 | 读多行必用批量预取；写多行必单事务 |
| 枚举双份手抄 | 引擎加效果不改桌面端不会失败 | `effects-single-source.test.js` 双向对齐 | 派生常量 + 包 exports 子路径 |
| 重复上传 | 无「上传调用次数」断言 | `generic-adapter-upload-once.test.js`（含失败不缓存） | 按指纹共享 in-flight |
| 超大文件无门禁 | 聚合棘轮可被抵消 | `check-max-lines.test.js` 三态 | 新代码阻断 + 存量挂账防腐 + 到期清账 |
| CVE 无人复核 | 没有跑扫描器 | `check-dep-audit.test.js`（解析与四类判定） | 挂账必须带 decision/note/reviewBy；周计划任务为权威 |
| 本批新代码自己越过 500 行阈值 | 门禁是本批新立的，改等待时没人预留行数预算 | 静态不变量扩到 4 条断言（两文件禁盲等 / 主文件必须 require 拆分模块 / 实现挂在 `contentReadyProbe`） | 新门禁必须先过自己的新代码：拆文件而非放宽基线；还债即清账，不借 `--update` 上移参考点（见 §12.5） |

---

## 12.5 逐文件行数棘轮的自反案例：拆 `url-collector-page-wait.js`

本批把固定盲等改成条件等待后，`apps/desktop/electron/services/url-collector.js` 由 488 行涨到
547 行，越过 `check-debt-budget.js` 的 `filesOver500` 棘轮（100 > 99）。这正是新门禁应当拦下的
情形——若此时把基线改成 100，等于刚立规则就给自己开后门。

处置三步，缺一不可：

1. 抽出 `electron/services/url-collector-page-wait.js`（133 行）：`CONTENT_READY_*` 常量、浏览器
   探针 `contentReadyProbe`、`waitForContentReady(page, {log, label})`、
   `readPageContentWithRetry(page, maxAttempts)`。选择这一刀的依据：这两个方法只依赖 Playwright
   Page 对象，与限流/熔断/缓存/审计等采集策略零耦合，拆出去不产生新的依赖方向。
2. `url-collector.js` 内保留 `_waitForContentReady` / `_readPageContentWithRetry` 两个薄委托（各
   1 行实现）：采集链路入口与既有 6 条用例契约（方法名、`{minLen, selectors}`、
   `{timeout: 10000, polling: 250}`、超时 warn 文案 `content-ready 条件等待超时 10000ms`、page 不
   支持时返回 false）全部不变，回归风险为零；文件回到 489 行。
3. 清账：`max-lines-baseline.json` 删除 `url-collector.js` 条目（保留会触发 `STALE_LEDGER_ENTRY`）。
   只删这一条，不用 `--update` 整体重写——`--update` 会把 grandfathered 文件的当前行数写回基线
   （如 `preload/index.bundle.js` 1334→1404、`ipc-handlers/account.js` 571→645），等于把棘轮参考
   点顺带上移、白送 200 行新增空间。

防复发：`url-collector-content-ready.test.js` 的静态不变量用例扩到 4 条断言——两个文件都不得出现
`waitForTimeout(`，`url-collector.js` 必须 `require('./url-collector-page-wait')`，实现必须挂在
`waitForFunction(contentReadyProbe` 上（防止将来又把实现塞回主文件）。

复核命令（期望依次 rc=0 / 99==99 / 全绿）：

- `node .github/scripts/check-max-lines.js` → `超限文件=99 挂账=99`
- `node scripts/check-debt-budget.js` → `filesOver500: 99 (baseline: 99)`
- `cd apps/desktop && npx vitest run electron/services/url-collector-content-ready.test.js electron/services/url-collector.test.js`

红验证共植入 11 个变异，逐个「基线绿 → 植入后红 → finally 还原」通过。三点值得记录的踩坑：

1. 变异必须成对跑基线：只验证「植入后红」不够——若用例本身没在门禁里跑起来，它对着正确代码
   也是红的，红就没有意义。判定式固定为 `base_rc==0 and mutated_rc!=0`。
2. 套件要按语义归属选，不是按「本批新增文件」选：`_apply_upsert` 新建路径退回明文入库这个变异，
   只跑本批的 `test_p4_txn_and_queries.py` 判为「未抓住」；并入第 2 批的 `test_p1_config_secret.py`
   后才转红。若按前者下结论，会把「已被别人保护」误判成「测试是假的」，进而重复补一份用例。
3. 变异脚本必须按字节还原文件：早期版本用文本模式读 + `newline=""` 写，把 CRLF 折成 LF 后写回，
   验证完 `git status` 出现假 modified（内容并未变）。现已改为全程二进制读写。

## 13. 遗留与后续

1. `CreateView.vue`（5657 行）等 100 个挂账文件的拆分需按模块排期，不在本批范围。
2. `python-jose` 替换（消除 edsa/ecdsa 类公告的结构性暴露）另行立项。
3. 采集与轮询的超时上限目前是代码常量，若线上需要按平台差异化，再抽配置项（避免为了「可能有用的灵活性」先加一层）。
4. DNS 重绑定 TOCTOU 仍属已知边界（校验与连接两次解析），彻底阻断需要在连接层固定 IP，另议。
