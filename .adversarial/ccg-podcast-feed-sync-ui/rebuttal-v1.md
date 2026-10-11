[
  {
    "id": "F1",
    "from": "frontend",
    "severity": "Critical",
    "claim": "切频道后 feedSync 未随页面态清空，A 的 failed 挂到 B 名下而重试按钮按 B 出站",
    "verdict": "接受并扩大",
    "evidence": "追这条时发现更重的事实：switchChannel 自刀 1（5fdb97b8b）起必抛 ReferenceError（引用本模块不存在的页面域标识符，onChannelActivated 从未被调用）。修复=picker 改调 onChannelActivated + 页面域清理清单补 feedSync。回归锁 5 条，M1/M2 变异各让 5/3 条变红。",
    "files": [
      "apps/desktop/src/composables/usePodcastChannelPicker.js:80",
      "apps/desktop/src/composables/usePodcastChannel.js:421",
      "apps/desktop/src/composables/usePodcastChannel-switch.test.js"
    ]
  },
  {
    "id": "F2",
    "from": "frontend",
    "severity": "Warning",
    "claim": "一次失败同时出现 toast / 卡片内联 / durable 横幅三面",
    "verdict": "部分接受",
    "evidence": "横幅与内联是两级事实（durable vs action），不合并；toast 与内联的逐字重复是本片之前的既有行为，判据写入 PRD §8、收敛动作归刀 3 的发布状态机（它要同时改 toast 语义与相位文案）。不在一次 docs 增量里同时改两条已评审链路。",
    "files": [
      "01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md §8"
    ]
  },
  {
    "id": "F3",
    "from": "frontend",
    "severity": "Warning",
    "claim": "「只重试上传 feed」暗示重放，实际按当前单集重建并覆盖公网主键",
    "verdict": "接受",
    "evidence": "改文案不改实现（spec 强制复用同一条 podcast:feed:publish，重放陈旧字节会造成公网/本地长期不一致）。zh/en 同 PR 改掉、PRD §8.1 逐字表同步、PRD §8 加「语义是重建不是重放」契约条。",
    "files": [
      "apps/desktop/src/locales/podcast/zh.js:154",
      "apps/desktop/src/locales/podcast/en.js:154"
    ]
  },
  {
    "id": "F4",
    "from": "frontend",
    "severity": "Warning",
    "claim": "读侧接线主要靠源码字符串断言，缺行为锁",
    "verdict": "接受",
    "evidence": "新增 usePodcastChannel-switch.test.js（真实 composable + 真实 picker，只 mock api 函数引用）4 条行为用例，其中「往返窗口内为 null」用 deferred gate 精确制造在飞状态；源码字符串断言降为补充并改成按花括号取函数体 + 剥注释。",
    "files": [
      "apps/desktop/src/composables/usePodcastChannel-switch.test.js"
    ]
  },
  {
    "id": "F5",
    "from": "frontend+backend",
    "severity": "Info/Warning",
    "claim": "partial 无生产写入者＝隐形死分支；spec 同时用 result 与 status 指同一份数据",
    "verdict": "接受",
    "evidence": "FEED_SYNC_STATUSES 闭集 + podcast-feed-sync-status.test.js 三向对账（写侧字面量⊆闭集、写侧非成功态必须被读侧显示、无写入者集合必须逐字等于 spec 的 reserved 标记且双向、闭集里不得有无人认领的死值、spec 不得出现 result）。partial 从「隐形」变为「被声明、被断言的预留」，刀 3 加写入者时该标记必须同 PR 删除否则变红。",
    "files": [
      "apps/desktop/electron/services/podcast-channel-service.js:492",
      "apps/desktop/electron/services/podcast-feed-sync-status.test.js",
      "openspec/.../spec.md"
    ]
  },
  {
    "id": "B4",
    "from": "backend",
    "severity": "Info",
    "claim": "发布完成后重读取「完成时刻的活动频道」而非被发布频道",
    "verdict": "记录为刀 3 边界，不在本片改",
    "evidence": "定向重读要跟着刀 3 的发布状态机（publish 返回里带 channelId 并由状态机消费）一起做；本片已先把「跨频道错挂」这条最危险的形态用同进同退消掉，剩余症状是同频道内的重复读，不产生错误外发。已写入 openspec/records/podcast-feed-sync-ui.md 的刀 3 边界。",
    "files": [
      "apps/desktop/src/views/PodcastChannelView.vue"
    ]
  }
]