{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "performance",
      "finding": "批量入口仍为读一个 data.proxy 而整份解密每个账号的完整凭证(cookies/localStorage/indexedDB/accountInfo)，N 次 PBKDF2 的总 CPU 开销只被并行化而非消除。文档自认正解是『列表只返回 configured 布尔』却未实现，高频路径 CPU 欠账仍在，仅把阻塞移到线程池。",
      "suggestion": "列表场景只解密出 proxy 布尔/字段即止，或为 listAccounts 增加轻量 proxy 专用字段；详情页才整份解密，避免每次进账号页都付 N 次全量 KDF。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "degraded 路径把『全部』账号置 configured:false。一旦 safeStorage/主密钥临时失效或入参非法，所有真实已配置代理的账号都被误报为未配置——比旧版逐账号 try/catch(只降级失败账号)更宽地错误上报状态，账号页/代理入口显示错误配置信息。",
      "suggestion": "降级时保留明确 invalid/unknown 语义并区分『未配置』与『读取失败』，或降级分支为每个账号带 degraded 标记，让渲染层能识别查询失败而非真未配置。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "C5 阈值 batchMs/singleMs < N/2(3.0) 依赖本机线程池与机器负载：UV_THREADPOOL_SIZE 默认 4、单核/受限 CI 上并行版 ratio 仍会接近 N=6，导致真实并行实现被误判红；flaky 计时断言跨环境不可移植。",
      "suggestion": "把并行判据改为与线程池挂钩或对比『串行耗时上界』，或对 batchMs 用独立断言(如 < singleMs*1.5)并允许重试，降低机器依赖。"
    },
    {
      "id": "i4",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "L3/L6『批量入口漏掉某账号走单账号兜底』是死代码：loadProxyStatuses 对 ids 里每个 id 都写回结果 key，map 必覆盖全部安全账号，proxyById 恒有值→degraded 分支与 safeAccountProxyStatus 兜底实际不可达。测试在验证不可能发生的分支。",
      "suggestion": "删除 L3/L6 或改为构造真实漏覆盖(如让 loadProxyStatuses mock 返回不含某 id 的 map 且辨明 degraded=false)，并注明该兜底仅为防御性保留。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "loadProxyStatusMap docstring 明写『整体失败时降级为空表，由调用方回落单账号口径』，但 listAccounts 实际注释与行为相反——degraded 时绝不走单账号兜底、全部置 configured:false。两处文档互相矛盾，误导后续维护者。",
      "suggestion": "统一两处描述为『degraded→全部 configured:false，不回落单账号（避免退化为原 Bug 串行）』，删除错误的『回落单账号口径』措辞。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "security",
      "finding": "PBKDF2_ITERATIONS 刻意维持 100000，低于本项目 openspec 基线 ≥200000（本次未再降，非本次引入）。虽然加了⛔注释，但仍是存量安全欠账，且新常量把它固化为『正统值』，后续维护者易误当达标。",
      "suggestion": "在常量处或文档中明确标注 100000 为欠账值并登记独立安全切片，勿以⛔注释掩饰；补一个指向 openspec ≥200000 的显式 TODO。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 7,
    "performance": 5,
    "maintainability": 6
  }
}