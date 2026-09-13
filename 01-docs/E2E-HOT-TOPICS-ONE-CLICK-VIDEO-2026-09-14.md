# E2E 运行手册 — 热门选题「一键生成视频」全链路（CDP 驱动真实实例）

- 文档编号：E2E-HOT-TOPICS-ONE-CLICK-VIDEO-2026-09-14
- 目标：以 CDP 驱动**已运行的 Electron 实例**，在真实 UI 上跑通
  `热门选题 → 【生成视频】→ 改写引擎 → 故事讲述流水线（用户已保存默认选项）→ 真实成片 → 发布` 全链路
- 关联 PRD：`01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md` §3.10 / §3.11 / §6.6 / §6.7 / §9.5
- 关联 Bug 反思：`BUGFIX-HOT-TOPICS-GEN-VIDEO-PARALLEL-2026-09-13.md`、`BUGFIX-HOT-TOPICS-CACHE-CLEARED-ON-FETCH-FAILURE-2026-09-14.md`、`BUGFIX-DESKTOP-DEV-ELECTRON-RUN-AS-NODE-2026-09-14.md`

---

## 1. 测试资产

| 文件 | 职责 |
|------|------|
| `apps/desktop/tests/e2e/lib/cdp-client.js` | 极简 CDP-over-WebSocket 传输层：`CdpClient.attach(port, origin)` 找 renderer target 并建连；`evaluate(expr)`（`Runtime.evaluate` + `awaitPromise` + `returnByValue`）；`waitFor(expr, {timeout, interval, label})` 轮询 |
| `apps/desktop/tests/e2e/hot-topics-one-click-video-driver.js` | 主驱动：进入热门选题页 → 读取前 N 条 → 逐条点【生成视频】→ 等流水线 running → 点【后台运行】脱离 → 轮询终态 → 提取成片 → ffprobe → 写报告 |
| `apps/desktop/tests/e2e/story2video-saved-options-driver.js` | 既有的对照驱动：从「视频创作」页手动填文案启动单条（本驱动的一键入口回归基准） |

---

## 2. 前置条件

| 项 | 要求 |
|----|------|
| 运行实例 | 一个**已启动**的 Electron 实例（dev 模式，Vite dev server + CDP 端口均监听） |
| 身份态 | `window.electronAPI.identityGetState().data.status === 'authenticated'`（否则 `ai:rewrite` / `pipeline:startOrchestrated` / `store:get-setting` 会被许可证门禁以 `AUTH_REQUIRED (-3)` 拒绝） |
| 模型配置 | 该 profile 的 `multi-publish.db` 中已配置图像/语音 provider（本机实测：`minimax-multimodal` 图像 + `minimax-multimodal` 语音） |
| 已保存选项 | `store:get-setting('story2video.lastOptions.v1')` 可读（缺失时流水线回退内置默认值） |
| Python 服务 | Splitter（默认 8002）与 Prompt Engine（默认 8013）在监听 |
| 选题缓存 | 热门选题列表非空（若外部渠道不可达，依赖 §5「缓存保留」保证上一批选题仍可读） |

### 2.1 端口

dev 模式下端口按 worktree 路径稳定派生（`apps/desktop/scripts/dev-ports.js`），同一 worktree 可复现：

```bash
node -e "console.log(require('./apps/desktop/scripts/dev-ports.js').resolveDevPorts('D:/Data/projects/mp-worktrees/<task>'))"
# 例：{ vite: 6919, cdp: 10967, derived: true }
```

---

## 3. 运行方式

```bash
cd apps/desktop

E2E_CDP_URL=http://127.0.0.1:10967 \
E2E_VITE_ORIGIN=http://127.0.0.1:6919 \
E2E_TOPIC_COUNT=20 \
E2E_MAX_ACTIVE=2 \
E2E_LABEL=hv \
E2E_OUT_DIR=C:/tmp/hot-topics-video-e2e/hv \
E2E_RUN_TIMEOUT_MS=3600000 \
node tests/e2e/hot-topics-one-click-video-driver.js
```

| 变量 | 默认 | 说明 |
|------|------|------|
| `E2E_CDP_URL` | `http://127.0.0.1:10967` | CDP 端点 |
| `E2E_VITE_ORIGIN` | `http://127.0.0.1:6919` | renderer 源（用于定位 page target） |
| `E2E_TOPIC_COUNT` | `20` | 本次驱动的选题条数（按 UI 展示顺序取前 N 条 = 「最新 N 条热门选题」） |
| `E2E_MAX_ACTIVE` | `2` | 同时进行中的流水线上限；驱动在发起下一条前读 `pipelineHistory`，达到上限则等待 |
| `E2E_LABEL` | `hv` | 输出文件名前缀 |
| `E2E_OUT_DIR` | `C:/tmp/hot-topics-video-e2e/<label>` | 成片与报告输出目录 |
| `E2E_RUN_TIMEOUT_MS` | `3600000` | 全程上限（含等待全部 run 终态） |
| `E2E_SKIP_REFRESH` | 未设 | 设为 `1` 则跳过「点刷新按钮」，直接复用当前列表 |

**退出码**：`0` = 至少产出一条通过 ffprobe 的真实成片；`1` = 失败（错误栈写入报告 `errors[]`）。

**产物**：

```text
<E2E_OUT_DIR>/
  hv-generate-report.json      # 完整报告：identity / savedOptions / topics / runs / videos / errors
  hv-topic01.mp4 ... hv-topicNN.mp4   # 每条成功选题的成片
```

报告关键字段：

| 字段 | 含义 |
|------|------|
| `topics[]` | `{ index, id, topic, disabled }`，`id` 形如 `zhihu:1`（用于定位 `data-testid="hot-topic-generate-video-zhihu:1"`） |
| `runs[]` | 每条选题的 `runId`、`rewriteChars`（改写产文字数）、`detachedToBackground`（是否成功脱离）、`finalStatus`、`stages`（`name:status` 串）、`videoPath` |
| `videos[]` | `{ topicIndex, topicId, title, runId, sourcePath, outputPath, bytes, probe }`，`probe` 为 ffprobe JSON（编码/分辨率/帧率/时长/码率） |
| `errors[]` | 失败原因栈 |

---

## 4. 驱动执行步骤（含断言点）

| 步 | 动作 | 断言点 |
|----|------|--------|
| 1 | `CdpClient.attach(cdpPort, viteOrigin)` | 找到 `type=page` 且 `url` 以 origin 开头的 target；重试 10 次 × 3s |
| 2 | 读身份/账号/已保存选项快照 | `identity.status === 'authenticated'`，否则**立即失败并给出明确原因**（不浪费一次 20 条的编排） |
| 3 | 点页头刷新按钮（可跳过） | 等 `[data-testid="hot-topics-central-loading"]` 消失，再等 3s 让 SWR 收敛 |
| 4 | 读取前 N 条选题 | `[data-testid="hot-topic-item"]` 数量 > 0，否则报「列表为空」 |
| 5 | 逐条循环 | 见下 |
| 6 | 等待全部 run 终态 | 每 10s 轮询 `pipelineGetRunContext(runId)`，直到 `status ∈ {completed, failed, cancelled}` |
| 7 | 成片落盘 + ffprobe | 深度搜索 run context 中 `videoPath`/`outputPath` 且文件真实存在（`fs.existsSync`）；`fs.copyFileSync` 到 `E2E_OUT_DIR`；`ffprobe` 取 `codec_name/width/height/avg_frame_rate/duration/bit_rate` |

**单条选题（步骤 5）的精确时序**：

```text
读 pipelineHistory → 活跃 story2video-compose run 数 ≥ E2E_MAX_ACTIVE ? 等 15s 重试
  ↓
DOM click [data-testid="hot-topic-generate-video-<id>"]        （前置记录 startsBefore = pipelineHistory 快照）
  ↓ waitFor 弹窗出现      [data-testid="hot-topics-gen-video-modal"]            (≤60s)
  ↓ waitFor 流水线运行中  [data-testid="hot-topics-gen-video-background"] 出现  (≤12min)
      （该按钮仅在 phase==='running' 且持有 runId 时渲染 ⇒ 它的出现即「已启动」的权威信号）
      （若等到 [data-testid="hot-topics-gen-video-retry"] ⇒ 判为失败）
  ↓ 捕获 runId：点击前后 pipelineHistory 的新增 story2video-compose 记录（见 §6 约束 1）
  ↓ DOM click [data-testid="hot-topics-gen-video-background"]   ← 脱离，验证并行发起能力
  ↓ waitFor 弹窗消失                                                            (≤60s)
  ↓ 记录 entry（runId / rewriteChars / detachedToBackground / status）
```

**为什么每条都要点【后台运行】**：这正是 2026-09-13 修复的缺陷点——脱离后前端必须完全复位（busy 释放、`runId`/`stages` 清空、phase 回 `idle`）才能立即发起下一条。连续 20 条都能发起 = 该修复的端到端回归证据。

---

## 5. 与「缓存保留」的配合

若宿主网络导致热门选题渠道抓取失败（参见 `BUGFIX-HOT-TOPICS-CACHE-CLEARED-ON-FETCH-FAILURE-2026-09-14.md`）：

- 列表仍展示上一批选题（`preservedStaleCache: true`），驱动可正常取到选题并继续；
- 顶部出现「部分渠道获取失败：…」告警条，驱动**不需要**处理它（不阻塞点击）；
- 若想跑「真正最新」的选题，需先确保渠道可达后再执行驱动（并去掉 `E2E_SKIP_REFRESH=1`）。

---

## 6. 驱动必须遵守的硬约束（实测得出，踩过坑）

### 约束 1：`window.electronAPI` 是 contextBridge 冻结对象，**不能**在页面侧挂钩子

实测：`Object.isFrozen(window.electronAPI) === true`、`Object.isExtensible(window.electronAPI) === false`。
因此形如 `window.electronAPI.pipelineStartOrchestrated = wrapper` 的补丁会**静默失效**（非严格模式下赋值不生效，`typeof` 仍是原函数），既拿不到 `runId`，也拿不到参数快照。

**正确做法**：用 IPC 结果的**状态差分**识别新增 run：

```js
const before = await cdp.evaluate(`window.electronAPI.pipelineHistory().then(h => (h.data||[]).map(r => r.id))`)
// ... 点击【生成视频】并等流水线 running ...
const after  = await cdp.evaluate(`window.electronAPI.pipelineHistory()
  .then(h => (h.data||[]).filter(r => r.pipeline === 'story2video-compose')
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null)` )
// after.id 且不在 before 中 ⇒ 本次新增 runId
```

> 既有 `story2video-saved-options-driver.js` 中的同款补丁同样无效，属历史遗留问题；该驱动靠「`pipelineHistory` 兜底」仍能跑通，但 `window.__s2vCaptured` 分支是死代码。**新增驱动请不要再依赖页面侧补丁。**

### 约束 2：路由用客户端 hash 切换，并**以 DOM 出现为准**判断到达

- 用 `location.hash = '#/hot-topics'`（SPA 客户端路由），**不要**用 `page.goto('.../#/hot-topics')`——纯 hash 跳转会让 `domcontentloaded` 等待超时；
- **不要**把 `location.hash === '#/hot-topics'` 当作到达判据：主进程触发 renderer 重载时 hash 会被重置为 `#/`，导致驱动卡在路由等待直到超时；
- 权威判据是 DOM：`document.querySelectorAll('[data-testid="hot-topic-item"]').length > 0`（或空态出现）。

### 约束 3：不要用 Playwright 的 `connectOverCDP`

本机（Electron 43 / Chrome 150）实测 `chromium.connectOverCDP()` 侧握手**稳定超时**（15s × 6 次全部 `connectOverCDP 超时`），而直接对 `http://127.0.0.1:<cdp>/json/list` 取 `webSocketDebuggerUrl` 发 `Runtime.evaluate` 完全正常。因此驱动收敛到 `lib/cdp-client.js`（零依赖，仅 `ws`）。

### 约束 4：点击一律走 DOM `.click()`

用 `Runtime.evaluate` 里的 `element.click()`，避开 UI 覆盖层/动画导致的「元素可见但不可点」命中测试问题（与既有 driver 的处置一致）。

---

## 7. 宿主环境陷阱（排查手册）

| 现象 | 根因 | 处置 |
|------|------|------|
| 启动后 **Vite 正常 + bridge health 全绿 + 窗口永不出现**；stderr 里是 `electron.exe: bad option: --user-data-dir=...`；`electron.exe --version` 打印 Node 版本 | 宿主设置了 `ELECTRON_RUN_AS_NODE=1`，Electron 退化为纯 Node | 已修复（`buildElectronEnv`）。若在使用含该修复的版本仍出现，检查是否有脚本自己显式传了该变量 |
| 启动脚本报「150s 内未出现可见主窗口」，但 `%TEMP%\mp-start-dev.err.log` 没有关键信息 | electron 的 stderr 走 `stdio:'inherit'` 落到 `%TEMP%\mp-start-dev.{out,err}.log`；启动脚本只输出自己的摘要 | 排查时先看 `%TEMP%\mp-start-dev.err.log`，再看 `%TEMP%\mp-start-dev.exit.log`（`dev.js` 的退出留痕） |
| profile 里的 `identity-session.json` 反复出现 `*.tmp` 残留；`identityGetState()` 返回 `status:'error'` + `IDENTITY_SESSION_CLEAR_FAILED` | 该目录下文件被本机安全软件持锁：`_writeAtomic` 的 `rename` 与 `clear()` 的 `unlink` 都被拒绝（写 tmp 成功、落位失败）⇒ 会话无法持久化/清理，身份态卡 `error` | 把 profile 目录**换到无锁位置**（如 `C:\tmp\<profile>`）并复制登录态（`identity-session.json` + `identity-entitlement.json` + `credentials/` + `multi-publish.db` + `backend-data/` + `session/` + `Local State`），或把 `D:\tmp` 加入安全软件白名单 |
| 点【生成视频】后列表变空、缓存被清零 | 抓取失败清空缓存（已修复） | 见 §5 与对应 Bug 反思文档 |
| CDP 每个请求（含同源 localhost）固定 +5s | 宿主 Chromium 网络栈开销（高负载/代理解析）叠加 | `--no-proxy-server` 实测无效；排查时用 `performance.now()` 在校准 `setTimeout(0)` 后测 `fetch`，确认是网络栈而非 JS 调度 |
| 后台任务里拉起的 Electron 几十秒后消失、端口不再监听 | 父会话进程组回收 | 用**常驻监督进程**（`npm-style` supervisor：spawn `dev.js`，exit 即重启）承载 dev 栈，并把日志写到**按 PID 唯一**的路径（否则上一进程持有的 log 句柄会让新进程 `EPERM: open`） |
| 含 `/` 的分支名（`codex/xxx`）创建后 `git worktree list` 显示 `00000000` | 本环境 ref 写盘异常 | 用 `git worktree add --detach <dir> HEAD` + `git checkout -b <无斜杠名>`，并 `git reset` 清掉被污染的 index |
| `git status` 报 `fatal: not a git repository: (NULL)` | 并发会话的 `git worktree prune`/清理脚本把 `.git/worktrees/<name>` 注册删了 | 手工重建注册（`gitdir` / `HEAD` / `commondir` 三个文件），再 `git reset` 重建索引；物理目录与改动不会丢 |

---

## 8. 发布（Publish）步骤设计

一键生成视频完成后，成片发布到多个自媒体平台。**推荐路径（真实 UI）**：

```text
读取成片路径 + 选题标题
  ↓ 客户端路由到 /publish?type=video&video_path=<encodeURIComponent(path)>&title=...&content=...
     （与 ResultView.goPublish 的 push 形态一致）
  ↓ waitFor [data-testid="publish-target-selector"]
  ↓ 勾选全部可用平台：[data-testid="platform-<platformId>"]（跳过 disabled）；展开后确保账号已选
     [data-testid="account-<platformId>-<accountId>"]
  ↓ 标题：[data-testid="publish-title"]（为空时填选题标题）
     AI 生成声明：[data-testid="ai-declaration-checkbox"] 勾选
  ↓ 点击 [data-testid="publish-submit"]
  ↓ 观察 [data-testid="publish-progress"] 时间线（或轮询 getQueueStatus / getQueueHistory）
     至所有 taskId 到达终态（stage 以 ✓ / ✗ 开头）
```

**注意约束**：`window.electronAPI.publishBatch` 同样**不能**在页面侧挂钩子（约束 1），因此 taskId 只能通过 `getQueueStatus()` / `getQueueHistory()` 或 DOM 时间线观察。

**"只要能发的都发"的落地口径**：勾选全部 `platform-*` 复选框中 `disabled === false` 的项；账号维度优先用平台默认账号（`is_default` 标记），没有默认则取该平台第一个账号。

---

## 9. 已知限制

1. **驱动不负责拉起应用**：必须由外部保证实例在跑（本仓库 `scripts/start-desktop.ps1` 或等价监督进程）。这样驱动可复用同一个已登录 profile，也不与单实例锁打架。
2. **真实模型成本**：流水线会真实调用图像/语音/合成，20 条选题 = 20 次真实生成，注意额度与耗时。
3. **并发上限**：主进程 `maxConcurrentRuns` 自适应 1-4（`STORY2VIDEO_MAX_CONCURRENT_RUNS` 或机器资源）。驱动侧 `E2E_MAX_ACTIVE` 应 ≤ 该值，否则会拿到 `PIPELINE_CONCURRENCY_LIMIT` 启动失败并走重试分支。
4. **不做像素级断言**：驱动只断言「阶段推进 + 出现真实可 ffprobe 的 mp4」，不比对画面内容。
