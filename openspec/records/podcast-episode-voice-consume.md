---
branch: podcast-episode-voice-consume
task: tasks 4.5b④ 出期主路径消费音色解析链（PRD §7.4.1.2）
date: 2026-10-21
---

# 出期主路径接上音色解析链（podcast-episode-voice-consume，2026-10-21）

| 项目 | 状态 |
|---|---|
| 变更类型 | 运行时代码（主进程服务 + IPC 接线）+ 验收锁 |
| 隔离 | worktree `D:\Data\projects\mp-worktrees\mp-podcast-episode-voice-consume`，分支 `podcast-episode-voice-consume`，`verify-worktree-deps.js` OK |
| 单测 | 4 个文件 89 条：**87 passed / 2 failed**（那 2 条是 tracked bundle 锁，在 pristine main 同样红，非本 PR 引入，见「既有红」） |
| QM-1 打包 | PENDING（本 PR 改 `apps/desktop/electron/`，须本地打包 + 启动 8s 三层 stderr 判定） |
| QM-6 双模型 | PENDING |
| 远程同步 | 由门禁推导 |

- 保留门禁：行尾对账 PENDING | 品牌残留 N/A（无新增文档文案） | 文档同步 PENDING | 远程同步 PR #NNNN

## 改了什么

1. `apps/desktop/electron/services/podcast-episode-host.js`
   `publishFromScript` 不再采纳渲染层传来的 `p.voiceRef`（渲染层从不发送 ⇒ 三段恒 null ⇒
   `getConfiguredProvider` 拿不到 `voice_provider` ⇒ `_tryProviderTTS` 返回 null ⇒ 落 edge-tts ⇒
   落 `anullsrc` 静音；全程返回成功码，只有听感能发现）。改为在宿主内调用
   `resolveEpisodeVoice`（唯一实现，回退顺序不重写）得到 `{providerId, model, voiceId}` 交给合成层；
   解析失败即 `PODCAST_TTS_VOICE_UNRESOLVED` 拒发，且发生在取锁与任何磁盘写之前。
   三个读取实现缺任一 ⇒ `PODCAST_EPISODE_INVALID` 当场拒，不得退回「没有 voiceRef」这条静音老路。
2. `apps/desktop/electron/ipc-handlers/podcast.js`
   把音色接线收敛为唯一工厂 `voiceResolveDeps()`，预览（`getPlanPreview`）与出期宿主
   （`getEpisodeHost`）共用同一份 `defaultProviderOf / readPreference / getCapability`。
   此前只有预览拿到过它们，宿主一条都没接——这就是「浮层承诺的音色」与「实际发声者」分叉的落点。
3. `apps/desktop/electron/services/podcast-episode-host.test.js`
   新增 `§4.5b④` 六条锁（先红后绿：实现前实测 6 failed，实现后 0 failed）：
   解析命中偏好 ⇒ 下发三段逐字段相等；渲染层 voiceRef 一律不采纳；两层全空 ⇒ 拒发且零 TTS/零 mkdir/零 PUT；
   计费闸门排在解析之前（解析要读两次存储）；三个读取实现缺一即拒；
   **判据②**——同一份读取实现同时喂预览与宿主，预览 `voice` 与出期下发给 `generateTTS` 的键逐字段相等，
   并验证清空偏好后两边**同时**改口到 capability 档。

## 本刀现场抓到的另一条断链（不在本 PR 修，已登记）

`podcast-episode-tts-adapters.js` 的 `createGenerateTTS` / `createConcatBlocks` / `createProbeImpl`
在生产代码里**零消费点**（`createEpisodeHost` 的全部构造点只有 `ipc-handlers/podcast.js:367` 一处，
它没注入合成三实现）。后果：三枚文本入口在线上会先撞
`PODCAST_EPISODE_INVALID：文本出期必须注入 generateTTS / concatBlocks / probeImpl`，
即文本出期整链在打包产物里根本走不通。测试全绿是因为夹具直接注入替身——
「替身注入宿主会掩盖生产接线缺口」的又一例。下一片必须补生产接线并配一条
「不注入替身的真实构造点」行为锁；本 PR 不并入，因为那需要独立的 QM-1 与真机验证。

## 既有红（不归因本 PR）

`podcast-plan-preview-ipc.test.js` 与 `podcast-script-ipc.test.js` 各有一条
「两个 tracked bundle 必须含这条通道名」在 pristine main 上同样失败（对照组已在共享根实跑：
1 failed / 16 skipped）。属 preload bundle 未重生的既有欠账，本 PR 未触碰 preload。
