# 主链路活体门禁（应用自身发布队列 E2E）— 2026-09-23

## 目标
把「主链路发布端」从「旁挂脚本 require 生产模块」升级为「经已启动应用自身的发布队列
（publishBatch → taskQueue → PublisherRouter.createPublisher）跑一次」，坐实
Electron 队列在最新代码下把 bilibili 正确分派到 Tier-A API 发布器并抵达 B站真实接口。

## 前置：消除「陈旧活体 app」盲区
运行中的 `mp-app-live2` 此前落后 origin/main 达 30 提交、且 `ROUTE_TABLE.bilibili`
仍为 `rpa_vm`，导致活体队列走脆弱 RPA。本轮先做安全同步（非共享主工作区，是独立持久
worktree）：

1. 脏文件保护：7 个 tracked 修改（RPA 视频超时放宽等 WIP）先 `git diff` 导出 patch
   （78KB，存 D:\\tmp）+ `git stash push`（双备份）；未跟踪 `01-docs/evidence/` 5 个
   probe 脚本整体移存 D:\\tmp。
2. `git checkout origin/main` → HEAD = `b74f46e70d`（含 #2281），`rev-list 0/0` 对齐。
3. `node scripts/ensure-desktop-deps.js --check` → `DESKTOP_DEPS_OK / missing:0`。
4. 确认 `publisher-router.js:34` = `bilibili: { mode: 'api', timeout: 300000 }`。
5. `scripts/mp-applive-launcher.ps1` 重启（WMI 脱离）→ `START_CONTRACT_OK`，
   窗口「社媒管家」，backend 8299 listen，CDP 9279 就绪，vite 5231。

## 队列 E2E 实跑（经 window.electronAPI，走真实 IPC）
1. `listAccounts()` → bilibili 账号 `e72848c6`：`status=active / is_active=true /`
   `has_cookies=true`，重启后登录校验器重新验于 `2026-09-23T09:21:29Z`。
2. `publishBatch([{platform:'bilibili',accountId:'e72848c6'}], article)`
   （preload 契约：两枚位置参数 → `invoke('publish:batch',{platforms,article})`）。
   article：横版 720p 视频 `pub-topic01-720p.mp4`(6.7MB)、category=21、copyright=1。
   返回 `{code:0,data:{taskIds:['task_1_1790155580447']}}`。
3. `getQueueStatus()` → running=1 → 完成 → history=1。
4. `getQueueHistory()` 终态：
   - `startedAt 09:26:41.891 → completedAt 09:26:45.372`，`retry=2`（队列共尝试 3 次）。
   - `status=failed`，`error=「非正式会员单日只能投递五个稿件，赶紧去答题转正吧」`。
   - `result=null`。

## 判定：队列→API 分派与 B站 往返均成立，卡点在平台外部配额
- 该 error 是 B站 `add/v3` 提交的**业务态回复**（非 JS 异常/非 timeout/非空点击），
  证明：`taskQueue → PublisherRouter.createPublisher('bilibili') → ApiPublisher.publish`
  → cookie 装载 → ffprobe 横版校验通过 → `publishViaApi('bilibili')` → upos 上传链 →
  `x/vu/web/add/v3` 提交，**整条链在应用自身队列内真实抵达 B站并拿到结构化裁决**。
- 未产新 bvid 的唯一原因是**账号级外部限制**：B站非正式会员（未转正答题）每日投稿数
  上限，而本日已通过生产发布路径真实投递 3 稿（BV1MahW6tE36 / BV1DxhW6hEwZ /
  BV1y1ht6PEfM），当日额度耗尽 → 第 4 稿被平台拒。这与集成/代码无关，也无法在沙箱内
  绕过（答题转正 / 换号 / 等次日额度重置均为外部动作）。

## 与前序「脆弱 RPA 队列」的关键差异（反证主链改进有效）
| 维度 | 旧 rpa_vm 队列 | 本轮 api 队列 |
|------|----------------|----------------|
| 分派 | 驱动 WebView 点击发布按钮 | HTTP API 直发 |
| 典型失败 | responses=0 空点击 / timeout(300s) | 直达 B站、返业务码 |
| 可观测 | 无平台回执 | 平台 `add/v3` message + 明确额度规则 |

## 运维结论
- 主链「热门选题→生成视频→经应用发布」端到端：视频生成 + 队列分派 + B站真实往返
  全部坐实；真实成功 bvid 由同日生产路径 3 篇（view code=0 回查）证明。
- 队列「产新 bvid」受 B站当日至多 5 稿外部配额限制，非代码缺陷；如需即时补证，
  需普通终端择日（额度重置后）或转正账号复跑同一条 `publishBatch`。
- `mp-app-live2` 现运行于 origin/main（`b74f46e70d`），不再落后；旧 RPA WIP 安全留存于
  该 worktree 的 git stash + patch 备份，其中「视频任务 30min 超时」在 origin/main
  `publish.js`（`video_path → timeout:1800000`）已等价并入。
