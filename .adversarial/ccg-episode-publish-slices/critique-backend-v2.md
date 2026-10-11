[codeagent-wrapper]
  Backend: claude
  Command: claude -p --dangerously-skip-permissions --setting-sources  --output-format stream-json --verbose -
  PID: 44972
  Log: D:\Temp\codeagent-wrapper-44972.log
  Session-ID: ca5e1f13-f98c-4715-b7e6-0c8722a41d18
Based on reading the actual merged commit (`git show 92fd9bd00`) and the full source files, plus the adapters / channel-locks / registry that wire these pieces, here's my review.

## Findings

### Warning

**1. `createEpisodePublisher.publish()` 全程不持频道忙标记 —— 与 publishAudio 注释的断言自相矛盾（真实竞态缺口）**
`podcast-episode-publish.js:66-176`（链上任何一处都没有 `tryBeginPublish`/`endPublish`），而 `podcast-hosting-service.js:363-365` 明确说「忙标记归出期编排在整条链上持有（音频 PUT → 挂期 → 重建 feed → feed PUT 中间要写 episodes.json，把锁下放到这里会把一次发布拆成两段互斥……）」。
失败场景：`publish()` 只调 `channelGate.assertWritable(channelId)`（`adapters.js:90` → `registry.assertChannelWritable` → 仅校验频道存在 + 迁移状态，**不获取**忙标记）。于是整条链上无人调用 `tryBegin`，`channelBusyGate` 恒空，`episodeSink`（`saveEpisode` strict）里的忙判定（`podcast-channel-write-guard.test.js:55` 那套）永远放行。两个并发的 `publish()` 会同时 `extract`（若 `outBase` 一致则争写同一临时文件）、同时 `PUT`、同时 `saveEpisode`（episodes.json 读-改-写后写覆盖先写，丢一期）、同时重建 feed；手工单集编辑也完全不被挡住——正是注释里警告的「段间插进手工写」，但注释声称的持有者（编排）实际没持有。
（注：若进入 IPC 的 `publishFromVideo` 处理器在后续 3.7 下半才 `tryBegin`，那本提交只是**延迟接入**而非遗漏——但注释与代码不一致是真实的，排查者会误以为锁已就位。）

**2. `publishAudio` 的 `id`（channelId）不做任何清洗 —— 可逃逸出 `audio/<channelId>/` 层，与精心清洗的 `stem` 形成反差**
`podcast-hosting-service.js:373-389`：`id` 只 `trim()`，直接拼进 `objectKey = prefix + '/audio/' + id + '/' + stem + ext`；而 `stem`（388 行）做了四重清洗（非法字符→`_`、`..`→`_`、去前点、截 120）。失败场景：`hostingService.publishAudio('../../x', {filePath, mime, stem})`（`publishAudio` 是对外公开方法，不依赖调用方先过 `registry` 的 `CHANNEL_ID_RE`）→ key 变成 `podcast/audio/../../x/<stem>.mp3`，对象写进 `prefix/audio/` 之外的任意层，或整层穿出。能守住它只靠**上层** `assertChannelExists` 的 `CHANNEL_ID_RE`（`registry.js:402`），且该校验在 `publish()` 里是可选的（`if (channelGate && …)`），`publishAudio` 自身无任何自守。既然 `stem` 都清了，`id` 漏清属于同一处该做没做。

**3. 抛出错误的相位字段名不一致：`publishPhases` 与 `phases` 混用**
`podcast-episode-publish.js:111`（音频 https 失败）和 `:86`（取消）用 `pubErr(..., { phases })` → 落在错误实体的 **`phases`**；而 `:105`（尺寸不符）、`:130/:138`（bail）、`:95`（上传抛错）直接赋 **`e.publishPhases`**。失败场景：渲染层/上层按 `e.publishPhases` 读「走到哪一格」（测试也是这么断的），它在「音频地址非 https」或「已取消」这两种失败上读到 `undefined`，只好退化为整段失败而无相位，或取错文案/禁用错按钮。两套字段名指向同一概念，必漂移。

### Info

**4. https 判据在三处重复实现，且音频侧那道在真实路径上实际不可达**
`podcast-episode-publish.js:158`（feed https）与 `:109`（音频 https）与 `podcast-hosting-service.js:395`（publishAudio https）同一正则 `/^https:\/\//i`。`objectPublicUrl`（`upload.js:126`）永远产出 `https://` 或 `null`；`publishAudio` 的 `_put`（`hosting-service.js:404-406`）在 `url` 为 null 时已先抛 `HOSTING_INVALID`，所以 `:395` 的判据只在 `_put` 被 mock 时（即 `podcast-hosting-audio.test.js` 的「拼不出 https」用例）才触发，真实宿主路径上不可达——音频侧是同判据的冗余拷贝，feed 侧却是对 adapter 合同的有效防御。建议收成一枚共享谓词。

**5. partial 的 `errorMessage` 会在 `message` 存在时丢弃 `status`**
`podcast-episode-publish.js:174`：`String(partialError.message || partialError.status || '')`。真实 adapter 的 feed 失败 throws `'公网 feed 未更新'`（`adapters.js:68`，message 恒非空）且 `{status:403}`，于是 `errorMessage` 永远得 `'公网 feed 未更新'`，`status` 永不出现在结果契约里；上层想显示「403 拒绝」只能从 `errorCode` 反猜。契约同时只暴露 message 或 status 二者之一。

**6. 测试恒真性检查：两个新文件都测在点上，但 `_put` 的真实 URL 守卫从未被真实路径覆盖**
`podcast-hosting-audio.test.js` 的 `makeService()` 把 `_put` 整体换成 `vi.fn`（`hosting-audio.test.js:31-38`），key 拼接 / mime 门禁 / https 门禁 / 缺字节拒绝全部走真实 `publishAudio` 实现——符合「只假宿主」纪律，无恒真。唯一盲区：#4 说明的「拼不出 https」用例因此测的是 `publishAudio` 自有判据，反而把真实 `_put` 的 URL 守卫漏在覆盖外。`podcast-episode-guards.test.js` 的 F2 用真实 `extractEpisodeAudio` + 假 `spawnImpl`，F1/F4/F5/F7 用真实 `createEpisodePublisher` + 假 sink，均非恒真。

## JSON 数组

```json
[
  {
    "severity": "Warning",
    "file": "apps/desktop/electron/services/podcast-episode-publish.js",
    "line": 66,
    "summary": "publish() 全程不调用 tryBeginPublish/endPublish，出期链不持频道忙标记，与 publishAudio 注释的断言矛盾",
    "failure_scenario": "两个并发 publish() 或一次并发手工 saveEpisode 时无人挡住：episodes.json 读-改-写后写覆盖先写丢一期；注释称'忙标记归出期编排持有'但编排只在 assertWritable(仅查存在+迁移状态) 上没有获取忙标记，channelBusyGate 恒空",
    "verdict": "CONFIRMED"
  },
  {
    "severity": "Warning",
    "file": "apps/desktop/electron/services/podcast-hosting-service.js",
    "line": 373,
    "summary": "publishAudio 的 channelId(id) 不做任何清洗，拼进 objectKey 可逃逸出 audio/<channelId>/ 层，与清洗完备的 stem 不一致",
    "failure_scenario": "hostingService.publishAudio('../../x', ...) 直接调用（绕开上层 registry 的 CHANNEL_ID_RE 校验）→ objectKey='podcast/audio/../../x/<stem>.mp3'，对象/整层穿出，覆盖其它频道或更上层对象",
    "verdict": "PLAUSIBLE"
  },
  {
    "severity": "Warning",
    "file": "apps/desktop/electron/services/podcast-episode-publish.js",
    "line": 111,
    "summary": "抛出错误的相位字段名不一致：音频https失败/取消用 .phases，其余用 .publishPhases",
    "failure_scenario": "上层按 e.publishPhases 读取相位（测试即如此），在'音频地址非 https 不挂期'(111行)与'已取消'(86行)两种失败上读到 undefined，无法定位或取错按钮/文案",
    "verdict": "CONFIRMED"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-hosting-service.js",
    "line": 395,
    "summary": "https 判据三处同正则重复实现（episode-publish.js:109/158 与 hosting-service.js:395），音频侧在真实宿主路径实际不可达",
    "failure_scenario": "objectPublicUrl 恒返 https 或 null，_put(404-406) 在 url==null 时已先抛 HOSTING_INVALID，故 publishAudio:395 的音频 https 判据仅在 _put 被 mock 的测试里触发，真实路径为死码；建议收成单一谓词",
    "verdict": "CONFIRMED"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-episode-publish.js",
    "line": 174,
    "summary": "partial.errorMessage 在有 message 时丢弃 status，真实 adapter 的 status 永不出现在结果契约",
    "failure_scenario": "adapter(feed) 失败 throws {message:'公网 feed 未更新', status:403}，errorMessage='公网 feed 未更新'，403 状态丢失，上层无法显示真实拒绝码",
    "verdict": "CONFIRMED"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-hosting-audio.test.js",
    "line": 31,
    "summary": "测试恒真性通过，但 _put 整体被 mock，真实 _put 的 URL 守卫(hosting-service.js:404)从未被真实路径覆盖",
    "failure_scenario": "缺一条走真实 _put 的用例；'拼不出 https'用例实际测的是 publishAudio 自有判据而非 _put 的 HOSTING_INVALID 守卫",
    "verdict": "PLAUSIBLE"
  }
]
```

---
SESSION_ID: ca5e1f13-f98c-4715-b7e6-0c8722a41d18
