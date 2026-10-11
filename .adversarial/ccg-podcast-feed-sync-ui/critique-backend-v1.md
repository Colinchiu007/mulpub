[codeagent-wrapper]
  Backend: claude
  Command: claude -p --dangerously-skip-permissions --setting-sources  --output-format stream-json --verbose -
  PID: 29468
  Log: D:\Temp\codeagent-wrapper-29468.log
  Session-ID: 154c9028-7030-45e0-aecc-68371f61b11c
Reviewed the feedSync read-side wiring against `origin/main...HEAD` (single commit `259c97146`, branch `podcast-feed-sync-ui`). I traced the full chain: handler → preload unwrap → `src/api/podcast-channel.js` envelope → `normalizeIpcEnvelope` → `usePodcastChannel.loadChannel` → `feedSync` ref → `PodcastHostingCard` prop → banner/retry → `publishFeed`, plus the writer side (`writeFeedSync` successes/failures) and the locks module. All findings are read-only; nothing modified.

```json
[
  {
    "severity": "Warning",
    "file": "apps/desktop/src/composables/usePodcastChannel.js",
    "line": 421,
    "summary": "频道切换清理不覆盖 feedSync，读失败时旧频道横幅泄漏到新频道",
    "failure_scenario": "onChannelActivated(421-428) 与 usePodcastChannelPicker.js switchChannel(80-96) 在切换时只清 channel/episodes/feedResult/verifyResult，未清 feedSync；而 loadChannel(251-255) 只在 res.ok 时才写 feedSync.value，失败分支保留上一频道值。场景：查看频道 A（feedSync.status='failed'，横幅亮），切到频道 B，B 的 channel:get 读失败（IPC_UNAVAILABLE / STORE_CORRUPT / 瞬时错）→ feedSync 仍持 A 的 failed，PodcastHostingCard(45) 在 channelId=B 名下继续渲染 A 的「公网 feed 未同步」横幅，且横幅可见性本身不按 channelId 门控。"
  },
  {
    "severity": "Warning",
    "file": "openspec/changes/podcast-oneclick-publish/specs/podcast-oneclick-publish/spec.md",
    "line": 44,
    "summary": "spec/PRD 写 feedSync.result/errorCodes/hostingSnapshot，代码与横幅用 status/error.status,字段名不一致",
    "failure_scenario": "spec Scenario「WHEN feed 上传失败使 feedSync.result = 'partial'」与 Requirement「result/attemptedAt/errorCodes/hostingSnapshot」用 `result` 字段；实际写者 podcast-hosting-service.js:333,347 与读侧横幅 PodcastHostingCard.vue:98-99 都用 `status`（且失败态只落 error.code/status/itemCount，成功态落 url/bytes/itemCount/backupCreated，均无 errorCodes/hostingSnapshot）。若刀 3 状态机或崩溃对账按 spec 的 `result` 字段写 partial，这块读侧横幅 `String(s.status)` 永不命中、横幅永不显示——正是本片要消灭的「读侧又断了」的复现路径。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/src/components/PodcastHostingCard.vue",
    "line": 104,
    "summary": "partial 分支当前不可达，feedPartial locale 键只有死路消费",
    "failure_scenario": "staleFeedSync 认 status ∈ {failed,partial}，staleStatusText(104) 为 partial 渲染「部分同步」。但 writeFeedSync 仅有的两个写点（podcast-hosting-service.js:333/347）只写 status:'failed' 或 'success'，全仓无任何路径写出 status:'partial'（grep 证实）。因此「部分同步/partially synced」分档与 feedPartial 键在现实现下永不触发；不误导用户（不会假亮），但属前瞻性死代码；若刀 3 不落 partial，该键与分支长期冗余。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/src/views/PodcastChannelView.vue",
    "line": 406,
    "summary": "onFeedPublished 重读用「完成时刻的活动频道」而非「被发布的频道」",
    "failure_scenario": "发布成功/失败两出口都调父级 loadChannel()（406/410），其内部经 call→ensureChannel 取当前 activeChannelId。若用户在发布进行中切换频道（select 只被 switchingChannel 禁用，不被 publishing 禁用，卡片 publishing 只禁用本卡两个发布按钮），publish(A) 完成时 activeChannelId=B，重读的是 B 的 feedSync 而非 A——A 的写入结果不被刷新。另失败出口用 loadChannel().catch(()=>{})（410）静默吞读错，重读失败时横幅停在旧状态且无提示。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/preload/podcast.test.js",
    "line": 66,
    "summary": "channelGet 信封既有用例 mock 不含 feedSync，键扩展未被该用例校验（非破坏）",
    "failure_scenario": "既有断言 `{ ok:true, channel:{title:'T'} }` 的 mock data 只有 channel、无 feedSync；unwrap 的 `--data` 平铺使断言仍是真值（子集匹配），故新增键不破坏它。但该用例并不能为「channel:get 带 feedSync」这一新合同提供防线——如果将来 preload unwrap 被改成显式校验键或把 feedSync 当必填，此用例不会变红。真正守门的是 ipc-handlers/podcast.test.js:364 的 `Object.keys(res.data).sort()` 逐字对账，前置已覆盖。"
  }
]
```

### 结论要点

- **无 Critical**。`channel:get` 新增 `feedSync` 键未破坏既有消费者：`unwrap` 的 `{ok:true,...data}` 平铺对老消费者透明，`unwrapObject` 只用于 save 通道、与 `channel:get` 无关，ipc-contract/ipc-exposure 是静态通道名对账、逐字对账由 handler 测试守住，preload 老用例靠子集匹配不红。形状防御（非对象/字符串/未知 status 一律不显示）实现与用例都扎实。
- **横幅判据可信**：唯一写者只产 `success`/`failed`，read 侧 `String(s.status)` + `typeof s==='object'` 防御完整，`error.status` 无码时兜 `checkNoStatus`。但 **`partial` 分支现实现下不可达**（无写者产 partial），且 **spec/PRD 的 `feedSync.result` 字段名与代码/横幅的 `status` 不一致**，刀 3 若照文档写会再断一次——这是最值得先修的一处文档-代码缺口。
- **重试唯一路径 + 并发兜底**：横幅与主发布按钮共用 `onPublish→publishFeed→podcast:feed:publish`，无第二条发布路径；`publishing` 同步置真使双按钮在首击后即禁用；且主进程 `tryBeginPublish`(channelBusyGate) 持有 `try-acquire`，即使 UI 双击也会被 `PODCAST_CHANNEL_BUSY` 拒绝，prev 快照在 `tryBeginPublish` 保护区内先行建立，互斥与快照语义未被绕开。
- **忙态无互相打断**：`loadChannel`/`ensureChannel`/`refreshQuota`/`loadEpisodes` 全是读（channel:list/channel:get/episode:list），不碰 `channelBusyGate`（busy 只拦写），发布完成后重读无锁冲突；重复请求仅 `loadEpisodes`+`refreshQuota` 并发两次 `episode:list`（既有行为，非本片引入）。真正的缺口是「频道切换不清 feedSync → 新频道读失败时旧横幅泄漏」（Warning #1）与「重读目标频道取完成时刻活动频道」（Info #4）。
- **locale 键全被消费**（`feedNotSynced`/`retryFeed` 模板直用，`feedPartial` 在 partial 分支用），无字面死键；仅 `feedPartial` 的消费分支当前不可达（Info #3）。

最需要跟进的两条：Warning #2 的 `result`/`status` 字段名对账（避免刀 3 再断读侧）和 Warning #1 的切换清理补 `feedSync`。

---
SESSION_ID: 154c9028-7030-45e0-aecc-68371f61b11c
rc=0
