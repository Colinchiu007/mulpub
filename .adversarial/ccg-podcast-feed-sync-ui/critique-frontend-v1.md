[codeagent-wrapper]
  Backend: opencode
  Command: opencode run -s ses_ed7c407adffeEzmyBmY7yVs3KY --format json 不必再读更多文件，直接给最终 JSON。我已核实你的关键发现并采纳：全仓确无生产写入 feedSync.status='partial'（本分支只有 failed/success；partial 是刀 3 出期链的 action result，尚不是 durable 状态），且 spec L41/L44 用 result 键而 L139 用 status 键属同一份数据两个名字。处置：spec 统一为 status 并声明闭集 {success, failed, partial}，明写 partial 当前无写入者、预留给刀 3；PRD §11 把 action result 与 durable status 分列；并加一条结构锁断言「写侧 status 字面量集合 ⊆ spec 声明的闭集」，让未来的死分支不再是隐形的。请就这五点给 severity + 文件行号 + 失败场景 + 你认可或反对的修法，尤其回答：读侧提前支持 partial（而不是等刀 3 再加）是可接受的预留，还是应当现在就删掉 partial 分支与 feedPartial 键以免成为死代码？只输出 JSON，不要再展开工作记录。
  PID: 23756
  Log: D:\Temp\codeagent-wrapper-23756.log
  Web UI: http://localhost:61030
  Session-ID: ses_ed7c407adffeEzmyBmY7yVs3KY
```json
{
  "findings": [
    {
      "id": 1,
      "severity": "Critical",
      "points": "切换频道后 feedSync 未随其余页面态清空",
      "files": [
        "apps/desktop/src/composables/usePodcastChannelPicker.js:80-96",
        "apps/desktop/src/composables/usePodcastChannel.js:421-428",
        "apps/desktop/src/composables/usePodcastChannel.js:194",
        "apps/desktop/src/composables/usePodcastChannel.js:247-261"
      ],
      "failure_scenario": "频道 A 的 feedSync 为 failed → 横幅显示 A 的失败态。用户切到频道 B：switchChannel 先置 activeChannelId=B 并清 channel/episodes/feedResult/verifyResult，但不清 feedSync；随后 await loadChannel()。窗口期内横幅仍显示 A 的状态，而重试按钮拿的是 props.channelId=B。更严重的是 loadChannel 的失败分支（L256-258）只写 channelError、不触碰 feedSync，所以一旦切频道时 IPC 出错，A 的 failed 记录会**永久**残留到 B 名下：用户点【只重试上传 feed】会按 B 的当前单集重建并覆盖 B 的公网主键——一次面向错误目标的不可逆外发写。同一份「切换要清什么」契约存在于两处（picker switchChannel 与 onChannelActivated），两处都漏了新增的 feedSync。",
      "fix": "approve",
      "fix_detail": "在 usePodcastChannelPicker.js L84-87 的重置清单与 usePodcastChannel.js L422-425 的重置清单各补一行 feedSync.value = null（与 channel.value = null 同位同因：横幅状态必须随频道归属一起失效）；并在 loadChannel 失败分支同样不清（保持 null 而不是留旧值）。补两条行为用例：① 切频道后、loadChannel 返回前 feedSync 为 null；② loadChannel 失败后 feedSync 仍为 null（不残留上一频道值）。"
    },
    {
      "id": 2,
      "severity": "Warning",
      "points": "一次失败同时出现 toast(publishFailed)、卡片内联 publishResult、durable 横幅三面",
      "files": [
        "apps/desktop/src/views/PodcastChannelView.vue:399-411",
        "apps/desktop/src/composables/usePodcastHosting.js:123-136",
        "apps/desktop/src/components/PodcastHostingCard.vue（publishResult 内联区 + podcast-hosting-feed-stale 横幅）",
        "apps/desktop/src/locales/podcast/zh.js:152-154"
      ],
      "failure_scenario": "feed 发布失败后：父级 onFeedPublished 走 notifyError(t('podcast.hosting.publishFailed',{status}))，usePodcastHosting 同时置 publishResult=failed 并在卡片内联渲染**同一个键、同一个 {status} 参数**的同一句话，loadChannel 后 durable 横幅再渲染第三句 feedNotSynced。用户在同一视野内看到两遍逐字相同的文案（toast + 内联），加上一条含义相近的横幅——三面噪声稀释了「公网没更新」这条真信号。",
      "fix": "approve_partial",
      "fix_detail": "判定为**刻意分层**（action result vs durable status 是 PRD §13 第 8 条记录的两级事实，横幅与内联不可合并），但 toast 与内联是**重复**：同一失败在两个承载面渲染同一句文案。可落地合并判据：同一失败不得在两个承载面渲染同一句逐字文案——feed 发布这条路径上父级 notifyError 与卡片内联二选一。建议保留内联（它携带 itemCount/backupCreated 等横幅没有的细节字段），父级 onFeedPublished 失败分支不再发 publishFailed 的 toast，或 toast 降为不含 status 的动作短句（『发布失败，详见卡片』）。注意：toast+内联的重复是**本 PR 之前已存在**的既有行为，本 diff 只新增了第三面（横幅），不属本片回归。"
    },
    {
      "id": 3,
      "severity": "Warning",
      "points": "按钮文案「只重试上传 feed」与实际行为名实不符",
      "files": [
        "apps/desktop/src/locales/podcast/zh.js:154",
        "apps/desktop/src/locales/podcast/en.js:154",
        "apps/desktop/src/components/PodcastHostingCard.vue（onFeedRetry → onPublish）",
        "01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md:168,237"
      ],
      "failure_scenario": "重试按钮与主发布按钮调用同一个 onPublish → podcast:feed:publish，实际执行是：按**当前**单集列表重建 feed XML → 校验 → PUT 覆盖公网主键（另写一份时间戳存档副本）→ writeFeedSync。文案的「只」读起来像『重放上次失败的那一次』。若用户在失败后又新增/删除了单集，点【只重试上传 feed】会把新单集一并推上公网——用户按「只重传那次的文件」预期操作，得到的是「按当前真源重新出期」的结果，且这是不可逆外发覆盖。",
      "fix": "approve",
      "fix_detail": "**改文案，不改实现**。实现侧：spec L41 强制复用同一条 podcast:feed:publish（不得为横幅另开第二份发布实现），且按当前真源重建是唯一正确语义（重放陈旧字节会让公网与本地真源不一致）。文案建议从「只重试上传 feed」改为「按当前单集重新生成并上传 Feed」或至少去掉「只」（en 同步改）。理由：名实不符的根因是把「与完整一键发布相比只做 feed 这一段（不重新合成/上传音频）」压缩成了「只重试上传」，两者的区别是**相对**管线的，不是相对重放的。"
    },
    {
      "id": 4,
      "severity": "Warning",
      "points": "读侧接线主要靠源码字符串断言，缺行为锁；切频道残留无覆盖",
      "files": [
        "apps/desktop/src/components/PodcastHostingCard.test.js（父级源码接线断言用例，含 viewSrc toContain(':feed-sync=\"feedSync\"') 与 loadChannel 出现次数 >=3）",
        "apps/desktop/src/composables/usePodcastChannel.js:247-261",
        "apps/desktop/src/views/PodcastChannelView.vue:35,399-411",
        "apps/desktop/electron/ipc-handlers/podcast.test.js:103-104,356-364"
      ],
      "failure_scenario": "整条『channel:get → usePodcastChannel.feedSync → 父级 :feed-sync → 卡片 prop → 横幅』链中，卡片用例直接把 feedSync 当 prop 喂进去（等于绕过了 composable 这一跳），IPC 用例只断言 handler 返回键，中间的『loadChannel 把 res.feedSync 写进 ref』没有任何行为覆盖——它只能靠那条 toContain 源码字符串与『loadChannel 出现次数 >=3』兜着。这类断言是记录性的：字符串可以出现在 v-if=false 的死分支里，次数 >=3 会被任何一处无关的 loadChannel 调用满足（删掉失败出口那次重读、别处加一次，断言仍绿）。同族的『切换频道必须清空』没有任何断言，正是 finding 1 漏网的原因。",
      "fix": "approve",
      "fix_detail": "补两条行为锁（真实 usePodcastChannel + mock 桥接层 envelope {available:true, result:{ok:true, channel, feedSync}}）：① loadChannel 后 composable 的 feedSync ref 逐字等于返回对象，且 handler 不带 feedSync 键时为 null（不得造 success）；② 切频道/loadChannel 失败后 feedSync 为 null。源码字符串断言与次数断言可保留为补充，但不得作为该链的唯一证据（AGENTS.md「记录性断言不得代替真跑一次流程」）。"
    },
    {
      "id": 5,
      "severity": "Info",
      "points": "写侧状态字面量只有 failed/success，partial 是不可达分支；spec 用 result 与 status 两个名字指同一份数据",
      "files": [
        "apps/desktop/electron/services/podcast-hosting-service.js:326-336,346",
        "openspec/changes/podcast-oneclick-publish/specs/podcast-oneclick-publish/spec.md:41,44,139",
        "01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md:385,386,392",
        "apps/desktop/src/components/PodcastHostingCard.vue（staleStatusText 的 partial 分支）",
        "apps/desktop/src/locales/podcast/zh.js:153 / en.js:153（feedPartial）"
      ],
      "failure_scenario": "两条独立风险：(a) spec 同一份数据在 L41/L44 叫 result、在 L139 叫 status，写侧实际只写 status（writeFeedSync 无 result 键）——按 spec 字面实现的下一个人会写出第二个键，让真源出现两份互不相识的状态；(b) UI 的 partial 分支与 feedPartial 键当前无生产写入者，是隐形死分支：没人知道它是『预留』还是『漏接』，重构时可能被当垃圾删掉，或反过来被误读成『partial 从未发生过』（PRD 失败矩阵 L385/386/392 写的是 partial，与实现的 failed 分叉且 §13 未记录）。",
      "fix": "approve",
      "fix_detail": "认可并采纳已定处置：spec 统一为 status、声明闭集 {success, failed, partial} 并明写 partial 当前无写入者、预留给刀 3；PRD §11 把 action result 与 durable status 分列；新增结构锁断言写侧 status 字面量集合 ⊆ spec 声明闭集（让未来的死分支与越界值都可见）。该锁按仓库既有惯例接入 CI 且只允许缩小。"
    }
  ],
  "answers": {
    "duplicate_prompt": "刻意分层，不是重复：action result（本次动作）与 durable status（重启后真源）是 PRD §13 第 8 条记录的两级事实，横幅与内联必须各自独立。真正的重复只有 toast 与内联 publishResult——同一键同一 {status} 二选一（判据：同一失败不得在两个承载面渲染同一句逐字文案；建议删父级 publishFailed toast 或降为不含 status 的短句）。横幅不与 toast 合并。注意该重复为本 PR 之前的既有行为，非本片引入。",
    "retry_label": "名实不符，改文案不改实现。行为（按当前单集重建 feed + PUT 覆盖主键 + 写 feedSync + 时间戳存档）是 spec L41 强制复用同一路径的正确语义，也是唯一不产生公网/本地不一致的语义；错在文案的「只」暗示重放上一次。改为「按当前单集重新生成并上传 Feed」（en 同步），并在 PRD §11 的行为锁⑦旁注明按钮预期是重建而非重放。",
    "partial_readside": "readside_partial_policy: keep（认可预留，反对现在删除）。理由三条：① 读侧判据是形状守卫（仅 failed/partial 出现，其余不喊），多一个闭集值的分支成本近乎为零，且已被三态穷尽用例锁住；② 现在删掉再在刀 3 补回要二次触碰同一组文件与 zh/en 成对键，是 locale 成对纪律的额外风险面，而 locale 键无死键门禁兜底时最容易单边漂移；③ 只要采纳第 5 点的结构锁（写侧字面量 ⊆ spec 闭集 + spec 明写 partial 无写入者），死分支就是**被声明、被断言**的预留，不再是隐形代码。删除的条件是：若刀 3 的 durable 状态机最终决定 partial 只作为 action result、永不落 feedSync，届时同 PR 一并删除分支与 feedPartial 键（连同三态穷尽用例的 partial 样本），不允许长期留一个被 spec 排除的值。"
  }
}
```

---
SESSION_ID: ses_ed7c407adffeEzmyBmY7yVs3KY
