[codeagent-wrapper]
  Backend: claude
  Command: claude -p --dangerously-skip-permissions --setting-sources  --output-format stream-json --verbose -
  PID: 42880
  Log: D:\Temp\codeagent-wrapper-42880.log
  Session-ID: 0e293bb9-3fc0-4e2f-9492-295d98043f30
I've reviewed the full diff (6 new files, no other changes on the branch) against both slice commits, traced the call chain against the real hosting layer (`podcast-hosting-upload.js`, `podcast-hosting-service.js`, `media-tool-paths.js`), and verified the branch has zero callers outside the modules themselves and their tests (`grep` across the repo: `createEpisodePublisher`/`extractEpisodeAudio` appear only in the two files + tests). Findings below, then a short per-focus readout.

```json
[
  {
    "severity": "Warning",
    "file": "apps/desktop/electron/services/podcast-episode-publish.js",
    "line": "116-127",
    "title": "episodeSink / feedSink / buildFeed 抛错时无人收尾：临时文件与远端对象都留下，且错误不带 publishPhases",
    "scenario": "audio 已 PUT 成功后 episodes.json 写盘失败（磁盘满 / 并发写排除失败）→ episodeSink 抛错，既无 cleanup()（清理只挂在 upload 失败与 size/https 校验失败上）也没有 publishPhases；结果：OSS 上留一份未被任何 feed/episodes.json 引用的对象、outBase+ext 临时音频永远留在磁盘、上游收到无领域码的裸错误。feedSink 在 attach 之后抛错同理。这直接违背模块头『中间态由主进程负责收尾』的自述，且是 focus-3 的『feed 上传失败时临时文件与 episodes.json 状态是否自洽』在另一失败面上的答案：不自洽。"
  },
  {
    "severity": "Warning",
    "file": "apps/desktop/electron/services/podcast-episode-extract.js",
    "line": "108-113",
    "title": "编码器探测丢弃 exit code 与 stderr：打包 ffmpeg 崩坏会被错报成 ENCODER_UNAVAILABLE",
    "scenario": "打包的 ffmpeg 二进制损坏（Windows 常见：缺 DLL / 架构不符）启动即退出 → spawnImpl 返回 {code:非0, stdout:''} → planAudioCodec('') 得 null → 报『没有 mp3/aac 编码器』。用户按『缺编码器』方向重装编解码器，真实原因是打包产物崩坏。模块自己写的是『五类各自独立拒绝…不会把排查方向错开』，此处恰好压错。ffprobe 同理从不看 probe.code：非 0 退出但 stdout 里有 duration/size 时照样当成功（数据驱动可接受，但 exit code 完全被丢弃不与『实测失败』挂钩）。"
  },
  {
    "severity": "Warning",
    "file": "apps/desktop/electron/services/podcast-episode-publish.js",
    "line": "77-81",
    "title": "取消不会打断在途抽取：cancelToken 直到 extractMix resolve 后才被采样，ffmpeg 白跑满、白写一整份文件",
    "scenario": "用户在 extraction 进行中点取消（可长达 EXTRACT_TIMEOUT_MS=180s）→ token 置位但 ffmpeg 继续跑完并写出完整音频 → 抽取 resolve 后才在 line 77 看到 cancelled() 再 cleanup。没有 AbortController / kill 信号贯穿到 extractEpisodeAudio（killImpl 只喂给超时路径）。头注释承诺『上传前取消为零出站零计费、回滚只是删临时文件』，但 in-flight 取消实际让进程跑满并浪费一次全量写盘峰值，界面表现为点了取消后最多再等 3 分钟。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-episode-publish.js",
    "line": "122-139",
    "title": "partial 的底层失败原因从结果契约里被丢掉了",
    "scenario": "feed 上传 403 / 网络超时 / 限流只进 log.warn，返回对象只有 { state:'partial', feedUrl:'', message } 没有 error/code 字段 → 上层无法区分『被拒绝』与『暂时失败』，也就无法决定重试还是引导用户删期。若 feedSink 返回 undefined（built 为 undefined），line 122 的 `built.path` 在 .catch 之前同步抛 TypeError，直接裸崩而不是 partial——注入依赖的返回契约没有任何校验面。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-episode-publish.js",
    "line": "44-53",
    "title": "assertUploadSizeMatches 未参与构造期四项校验：漏注入得到裸 TypeError，注入恒真 stub 则三处校验可被静默绕过",
    "scenario": "调用方漏注入 assertUploadSizeMatches → line 94 抛 `TypeError: assertUploadSizeMatches is not a function`，虽被 try 捕获会 cleanup，但 e.code 为 undefined，上游拿到的是无领域码的裸错而非 SIZE_MISMATCH。反之若注入 `() => true`，putObject 返回字节与本地不符也被当成功放行——『收口』完全依赖被注入实现的诚实，而这是唯一一处没有强制校验的三处一致环节。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-episode-extract.js",
    "line": "123-148",
    "title": "mix 失败 / SIZE_MISMATCH 路径不清理由 outPath 的半成品文件",
    "scenario": "ffmpeg 非 0 退出但已写出一部分 outBase+ext → EXTRACT_FAILED 抛出时文件留在磁盘；退出码 0 但『报成功没文件』或 stat≠ffprobe 的 SIZE_MISMATCH 同理。重试依赖 `-y` 覆写，反复失败会在 outBase 处累积陈旧半成品（line 128 只报『输出文件不存在』，不删任何东西）。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-episode-publish.js",
    "line": "86 / 103-105 / 122",
    "title": "音频上传不标 kind:'audio'，feed URL 不做 https 校验——接口不对称",
    "scenario": "partial 测试恰靠 `a.kind === 'feed'` 分支两条上传路径，但音频调用只传 { channelId, filePath, mime }，没有 kind:'audio' → 真实 adapter 只能把『没有 kind』当成音频；这是隐性契约，diff 里没有固化。同时 audio 强制 https（line 103），feed 返回的 url 不经校验——若 adapter 回 `http://...` 的 feed 地址，state 直接是 'success' 且 feedUrl 为明文 http，聚合端订阅该 feed 时才会暴露。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-episode-publish.js",
    "line": "133-137",
    "title": "成功态假设 feedRes.url 一定存在；真实 putObject 只返回 {status,size}",
    "scenario": "podcast-hosting-upload.js:255 的 putObject 返回 { status, size } 不带 url，音频 size 校验依赖的 `uploaded.size` 有真实来源，但 feedUrl 得靠 Future adapter 补包。本分支全仓无任何生产调用方（grep 只有模块自身与测试），4 个被注入实现的返回契约没有一处类型/校验面，切片之间的接口尚未有实现钉死——集成期最容易漂移的地方。"
  },
  {
    "severity": "Info",
    "file": "apps/desktop/electron/services/podcast-episode-publish.test.js",
    "line": "33-52",
    "title": "publish 测试的 fixture 三方耦合：mixed() 的 sizeBytes、临时文件字节、默认 uploadImpl size 必须永远同步 #{1000}",
    "scenario": "mk() 里三个 1000 是手写常量：tmplAudio 写 1000 字节、mixed() 报 sizeBytes:1000、默认 uploadImpl 回 size:1000。若有人把 mixed() 改成别的 size 而不同步其他两处，成功路径的三处一致会因『自洽地错』而照样绿，SIZE_MISMATCH 那条测试则靠默认真实 assertUploadSizeMatches 兜底——现有断言都能被撞偏但都有真实行为兜着，属可接受的一般性 fixture 漂移风险，非剥壳恒真。"
  }
]
```

对六个重点的直接结论：

1. **相位闭集与取消**：相位枚举是 `Object.freeze` 的闭合集，测试用 `toEqual` 锁它与逐格结果态（成功/拒绝/partial/取消）同 PR——这条纪律成立。取消只有一个采样点（publish.js:77，uploadAudio 之前）；其后**没有任何路径**会在 token 已置位后再说「已取消」或回滚，`cancellableAt('uploadAudio')` 起全为 false。不存在「出站后被取消」的路径。真正的缺口是：取消不打断在途抽取（F3），以及 TOCTOU（token 在采样与 `uploadImpl` 之间置位不会阻止出站）被文档化地忽略——这属于已声明的窗口语义。
2. **三处一致校验**：确在挂期前收口——`assertUploadSizeMatches`（line 93）与 https 校验（line 103）都在 `mark('attach')`（line 108）之前，测试断言 `calls.episode` 为空。size 缺失 → `Number(undefined)=NaN` 抛错；为 0 → 与实测（恒 >0）不等抛错；数字字符串 `'1000'` 会按数值通过（有意的宽松），`''`/`null` → `Number` 为 0 → 抛。`undefined` 与 `'NaN'` 有测试用例。真正的收口有一个监听窗口：extract 内 stat 与 putObject 内 stat 是两个时刻，若两个时刻之间文件被改，putObject 返回的是**新** stat（line 220），与旧实测不符会被拒——这正是设计要抓的形态。
3. **partial/failed 分层**：状态机自己不会被压平——feed 失败以 **resolved** `{state:'partial'}` 返回，与 rejected 失败天然可分；episodes.json 已写入新期、本地 feed 已重建、公网 feed 未更新、临时文件保留——自洽且可经既有的 `podcast:feed:publish`（刀 2）补传恢复。压平风险不在本模块而在两个方向：结果契约丢弃底层 error/code（F4），以及 episodeSink/buildFeed 本身抛错时无清理无相位（F1）。
4. **降级拒绝先于任何宿主访问与写盘**：`readDegradedFlags` 在 `require('fs')`、stat、spawn 全部之前（extract.js:94），测试用不存在的 videoPath 证明其优先级。ffprobe 实测失败 → `MEASURE_FAILED`，编码器缺失 → `ENCODER_UNAVAILABLE`，确实可区分；但编码器探测不看 exit code/stderr，崩溃的 ffmpeg 会被误报成编码器缺失（F2）。
5. **零真实出站**：三个新模块无顶层 `require('axios')`/http（`putObject` 的 axios 是懒加载，属于刀 2 既有层）；`createEpisodePublisher` 缺四实现即拒构造；`extractEpisodeAudio` 缺 spawnImpl/ffmpegPath/ffprobePath 即拒跑。本分支全仓没有任何生产调用点——「零出站」目前是结构上的（依赖强制注入），也是偶然的（没有接线）。第一个生产调用方出现时，spawnImpl/uploadImpl 的真实 adapter 必须新写并钉死 F8 那些接口契约。
6. **测试质量**：无 `vi.mock` 剥壳、无恒真断言；runWithTimeout 用真定时器真测 kill/迟到 resolve/unhandledRejection；extract 测试的假 spawn 是注入缝本身（非剥壳），且 stat 比较作用于真实写出的文件、PROBE_OK 通过**真实** parseProbeOutput 取数，不是自证自。唯一注意点是 F9 的常量耦合，以及 publish 测试用真实 `assertUploadSizeMatches`（import 自 extract）这点是可验证真行为的关键选择。

---
SESSION_ID: 0e293bb9-3fc0-4e2f-9492-295d98043f30
