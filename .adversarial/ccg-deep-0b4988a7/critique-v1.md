{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "wiring 测试对两处点位共用断言 `:href=\"safeHttpUrl\\(`，但 PublishHistory 的 detail-link 锚点 href 是 `publicLinkHref(selectedRecord)`（与 @click 传参同源），正则不匹配该锚点，与记录的 8/8 绿矛盾；若模板实为双重 sanitize 亦需说明。",
      "suggestion": "按文件拆分断言：Publish.vue 锁 safeHttpUrl(，PublishHistory.vue 锁 publicLinkHref(；或仅锁 :href 存在与 target/rel。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "handleLinkClick 在 preventDefault 后 `await openInAppTab(safe)` 无 try/catch，且 openInAppTab 入口的 safeHttpUrl 也在 try 外；任一意外抛错 ⇒ promise 拒绝，无默认、无应用内、无降级，静默死点击，违背自身口径 4。",
      "suggestion": "将 openInAppTab 整体包 try/catch，失败一律 openExternal(safe)；或在 handleLinkClick 捕获拒绝统一降级。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": ".ccg/reviews/8e9109a55…json 的 sha 是基线提交而非 head 0b4988a70；changedLines 383 与提案头 648 行对不上；deepReview.status=pending 而 openspec 各门禁已标 ✅，审计链自相矛盾。",
      "suggestion": "按 head sha 重生成记录并统一行数口径；deep review 未完成时 QM-6 明确标 PENDING，勿混标已完成。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "openInAppTab 公开导出但契约是失败返回 false 且无降级，只有 handleLinkClick 接 window.open 兜底；将来直接调用 openInAppTab 的代码会静默失败（点开无反应）。",
      "suggestion": "openInAppTab 改私有；或将降级逻辑收敛进 openInAppTab，对外只暴露 handleLinkClick 一个入口。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "PublishHistory 卡片已有 usePublishHistoryContentLink 点击开标签逻辑（CARD_INTERACTIVE_SELECTOR）；需验证 detail-link 锚点在该排除选择器内，否则普通左键同时触发锚点 @click 与卡片处理器，会建两个应用内标签。",
      "suggestion": "补测试断言点击 detail-link 不触发卡片处理器，并确认 CARD_INTERACTIVE_SELECTOR 覆盖该锚点。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "switchToTab 失败返回 true：标签已建但未聚焦且无反馈，标签栏折叠时用户视为点了没反应；PRD 已明示取舍，但该路径无日志埋点，难以事后诊断。",
      "suggestion": "失败路径输出 console/telemetry 标记；或尝试唤起标签栏再返回成功。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "safeHttpUrl 每渲染调 2 次（v-if 与 :href），点击再调 1 次；@click 传原始 result.url 而 href 用清洗值，一旦 safeHttpUrl 未来做归一化，应用内 URL 与 href 会分叉。",
      "suggestion": "用 computed 存清洗结果，v-if/:href/@click 同源引用，handler 直接传 computed 值。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "security",
      "finding": "一次性分区标签加载平台返回的任意 http/https URL，第三方内容进入应用窗口 chrome；虽不注入凭据，但无浏览器边界标识，http 明文亦可被中间人篡改。",
      "suggestion": "PRD 明确标签 UI 展示地址/安全标识；对 http:// 应用内打开给出可见提示。"
    }
  ],
  "dimensionScores": {
    "correctness": 7,
    "security": 8,
    "performance": 9,
    "maintainability": 6
  }
}