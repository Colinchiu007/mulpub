---
branch: podcast-episode-voice-consume
task: tasks 4.5b④ 出期主路径消费音色解析链（PRD §7.4.1.2）
date: 2026-10-21
---

# 出期主路径接上音色解析链（podcast-episode-voice-consume，2026-10-21）

| 项目 | 状态 |
|---|---|
| 变更类型 | 运行时代码（主进程服务 + IPC 接线）+ 验收锁 |
| 隔离 | worktree `<仓库父目录>/mp-worktrees/mp-podcast-episode-voice-consume`（本机落点由 `git worktree list` 现取），分支 `podcast-episode-voice-consume`，`verify-worktree-deps.js` OK |
| 单测 | 4 个文件（host / episode-ipc / script-ipc / plan-preview-ipc）：**89 passed / 0 failed**。首跑曾报 87/2，那 2 条见下方「归因更正」——属跑法顺序，非仓库缺陷 |
| QM-1 打包 | **PASS（第③层）**：`pnpm run build:dir` rc=0 → 以隔离 userData（`%TEMP%\mp-qm1-4200`）启动 `dist-electron/win-unpacked/Multi-Publish.exe`，子 env 经 `scripts/lib/qm1-child-env.js` 的 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE`；12 秒 `alive=true`、**stderr 0 字节**、红线命中 0、配置/插件路径指向 asar=no、**DEP0180 命中 0**、stdout 22,696 字节（业务日志走 stdout，与 stderr 分道）；收尾按 PID 收口 `CLEANED pid=3604`，未按名字批量 kill |
| QM-6 双模型 | 见下方「逐条处置」：8 条已裁决（3 upheld / 3 dismissed），i3 的记忆化已落、i2/i6 拆成 `tasks 4.5b⑤`；**但 `24792dc6` 那份 DUAL 产物的 status 仍是 `self_play_pending`，未收口** |
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

## 归因更正（同一次 PR 内的自我纠错，不得留给下一个会话重查）

上表「既有红」一节最初写的是「tracked bundle 未重生的既有欠账」——**这句归因不准**。当场重查的事实是：
`apps/desktop/electron/preload/*.bundle.js` 已在 `826fa7e13`（PR #3782，chore(build): 把 5 个受管构建产物移出版本控制）
**移出版本控制**，`git diff --numstat -- apps/desktop/electron/preload/` 为空。那两条
「两个 tracked bundle 必须含这条通道名」读的是**本机 build 产物**，所以真实成因是
「先跑测试、后跑 build」的顺序问题：跑过 `pnpm run build:dir` 之后同一批用例 **89 passed / 0 failed**。
因此本 PR 的最终单测读数以 **89/89 全绿**为准；先前那句「在 pristine main 同样红」仍然为真
（共享根同样没有 build 残留），但它证明的是跑法依赖，不是仓库里的沉默缺陷。
教训：判「某条红是不是既有欠账」之前，先问「这条锁读的是受管文件还是本机产物」——
`git log -1 -- <产物路径>` 一句话就能分辨，我这次是先写了结论、后被 build 推翻。

## QM-6 双模型深审（critic=claude，8 条）逐条处置

判定 `DUAL`（261 行 > 200 阈值），跨家族 proposer=opencode / critic=claude，最低维度分 3 ⇒ 引擎进自扮演裁决档
（置信权重 0.6，本面不在 `HIGH_RISK_SURFACES` 高危清单内，故自扮演在机械上可用；`tier=external` 目前仍无生产写入方，
这一层如实记为「手写代用」）。8 条进裁决的 6 条逐条结论：

- **i2（成立，upheld）**：评审独立命中了我自己查出的那条——合成三实现生产零消费 ⇒ 文本出期线上整链不可用。处置：`tasks 4.5b⑤` 新开未勾子项，含三条验收判据（不注入 `podcastEpisodeHost` 的真实构造点行为锁 / 复用既有工具路径与 assetGenerator 单一实例 / 独立 QM-1 + 真机出期试听）。
- **i3（成立，upheld）**：工厂两处调用产生两份实例，「同一份接线」当时只是「同一段代码」。已当场改为记忆化单实例（`voiceDepsInstance`）。评审建议里「在测试中断言两边共享同一引用」那一半**未做**，随 4.5b⑤ 一起做——现在这条不变量由源码形状维持，尚无载体。
- **i6（成立，upheld）**：本 PR 的验收证据只覆盖到注入面，没有覆盖「不注入替身的真实构造点」。与 i2 合并处置，措辞按此收紧，不谎报覆盖。
- **i1（不成立，dismissed）**：指控前提是「合约不可见」。实际 `podcast-tts-voice.js:48-51` 的 JSDoc 明写 `defaultProvider` 传值、两个读取器传函数，且主干预览层 `podcast-episode-plan-preview.js:92-97` 一直是同一传法；本刀判据②把两端用同一份接线真跑，形状错会当场红。
- **i4（不成立，dismissed）**：判定产物写在父 sha 上是本仓 pre-commit 的既有机制（deep-review 自己打印这句）；`tier` 整段缺席是全仓现状（主干 142 篇已闭环产物里 139 篇无该字段），CI 侧该判据仍以 advisory 运行。
- **i5（不成立，dismissed）**：被 require 的是仓内既有模块，本刀未改它一行；「按 diff 审」不等于「依赖不在仓里」。

裁决落盘：`.adversarial/ccg-deep-e0bce5d9/adjudication.json`（6/6 条已填 prosecution / defense / verdict / rationale）。
**状态如实记录**：先前那笔 DUAL 产物 `24792dc6…json` 的 `deepReview.status` 仍是 `self_play_pending`——
新提交（`59c800a55` 与其后）判定降为 `SKIP`，deep-review 按当前 staged diff 内容寻址命中的是 SKIP 那份，
它不会替 `24792dc6` 收口。⇒ 本 PR 在 `--mode=enforce` 下仍会被 `evaluateDeepReviewDebt` 判「CCG 深度审查欠账」，
CI 侧（advisory）不拦。**「QG Changes 绿」不等于「QM-6 已闭合」**，收口需按 `24792dc6` 那份 diff 重放一次深审。
