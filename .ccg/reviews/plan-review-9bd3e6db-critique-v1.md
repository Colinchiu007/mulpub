{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "本变更的招牌能力——env 覆盖上限 + 「按调用时读取」（变异 N6 专打这一格）——只在 vitest 的 node 环境里被证明存在。`useNotify.js` 位于 `apps/desktop/src/composables`（渲染进程），Electron 默认 contextIsolation 下渲染进程通常没有 `process` 全局，Vite 也不会在浏览器构建里自动定义 `process.env`。若运行时读 `process.env.MP_NOTIFY_MAX_DURATION_MS` 抛 ReferenceError 或恒为 undefined，那么生产上「覆盖上限」就是假的——这正是本变更要消灭的「可覆盖是假的」同族失败，而变异电池 N6 结构性抓不到它：测试环境里 process.env 永远存在且可变。PRD 引用的「仓内频控/队列 env 纪律」若落在主进程侧，也不构成渲染进程的先例。",
      "suggestion": "在真实渲染进程（Electron 运行时而非 vitest）验证 `process.env` 可用，或改用 `import.meta.env`/构建期 define/显式注入；在 PRD 里写明该 env 读取的运行环境与生效边界，并补一条模拟「渲染环境无 process」的用例证明覆盖特性不会静默失效。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "`notify()` 里 `text` 为空有两种来源，但都无差别走 `warnMissingKey(messageKey, level)`：① messageKey 真未命中；② `options.message` 传了但被 `looksLikeI18nKey` 防泄漏守卫拦截（rawText 是 i18n key 形态）或 message 为空。后两种不是「key 未命中」，告警文案「messageKey 未命中」归因错误；且模块级去重 Set 会因这次误报把该 key 记住，之后同一 key 的真实未命中被永久静默——一个诊断错误放大成另一个。",
      "suggestion": "把三条分支分开：守卫拦截/空 message 单独出声（文案点名「options.message 被防泄漏守卫拦截」或「为空」），只有真实 key 未命中才进 `warnMissingKey`；或让 `warnMissingKey` 接收实际原因一并写入告警。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "performance",
      "finding": "`warnedMissingKeys` 模块级「只增不清」，其「规模上界 = 仓内 messageKey 条数」的论证只对静态 key 词汇成立。useNotify 明面支持动态 key（`options.message` 动态拼接；miss 路径对任何未登记 key 开放），调用点若生成动态 key（如 `task-${id}` 未登记或拼错），每次新值都会向 Set 永久加一条，应用生命周期内无界增长——刷屏场景恰恰是本变更要防的，但去重集合在「刷屏用动态 key」时反而无界。",
      "suggestion": "给留痕集合加上界：按「每个 key 每 N 秒/每 N 次最多出声一次」做限频（滑动窗口），或做 LRU 淘汰；并在 PRD 中把「规模上界」的论证前提（静态 key 词汇）写实。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "本 diff 提交的 `.ccg/reviews/9e2085….json` 记录的是 sha `f6a61d24c`（本分支的前一个提交）、`changedLines: 260`、`fileCount: 9`，而本提案实际是 642 行 / 10 个文件、head 为 9bd3e6db。decider 的 mode=DUAL 判定与敏感扫描是基于一份更早/更小的 diff 做出的，提交进分支后这份证据与最终变更不一致（且 head 自身 9bd3e6db 的 review json 反而是未跟踪状态）。",
      "suggestion": "合并前对最终 diff 重跑 `scripts/ccg-review-decider.js`，提交与 head sha 一致的记录；若 review 产物本应走暂存区/忽略，则把该 json 移出提交，避免分支固化过期证据。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "JSDoc 仍声明 `@param {'success'|'info'|'warning'|'warn'|'error'|'confirm'} [options.level]`，但 `LEVEL_BY_ALIAS` 不含 `confirm`，新代码把 `level:'confirm'` 当未知值处理：console.warn + 按 info 展示。老代码对 confirm 是静默 no-op，所以若有调用方真的传 `level:'confirm'`，行为会从「无提示」变为「可见 info toast + 告警」，与文档宣称的合法值相悖；即便没有调用方，文档与实现也已脱节。",
      "suggestion": "全仓 grep `level: 'confirm'`/`notifyConfirm` 确认有无真实调用方：有则要么把 confirm 显式纳入映射（若 ElMessage 支持）要么改走 ElMessageBox 分支；无论哪种，同步修正 JSDoc 的 level 枚举使其与实现一致。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "多处「当场实测」读数对不上：openspec 记录写「消费者并集 21 个测试文件 550 passed」，但括号内「10 文件 236 + 12 文件 314」是 22 个文件次；PRD/CHANGELOG 反复称 usePublishFlow.test.js「13 处断言锁旧形态」，而本 diff 中该文件实际改写的是 12 处断言（hunk 177/186/211/265/290/445/607/676/768/781/795/1029）。",
      "suggestion": "统一口径：说明两次运行存在文件重叠（去重后 21 个），并把断言数改成与真实计数一致，避免审查证据被一个 off-by-one 消耗可信度。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "环境覆盖用例直接改 `process.env.MP_NOTIFY_MAX_DURATION_MS`，恢复逻辑排在断言之后、无 try/finally：若中间断言失败（如 duration 未按预期夹到 12000），恢复代码不执行，`abc` 会残留污染同文件后续用例——当前它恰好是文件最后一个用例才没暴露，一旦重排序或在它后面插入用例就会踩雷。",
      "suggestion": "把恢复逻辑放进 `finally` 或用 `afterEach`/`vi.stubEnv`+`vi.unstubAllEnvs` 统一回收。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "去重 Set「只增不清」意味着一次未命中后，同一 key 的后续未命中（包括 i18n 语言包晚加载、key 暂时解析失败的瞬时情况）永远不再出声，诊断对「曾经出过一次事」的 key 之后彻底失明，与「未命中要留痕」的目标部分冲突。",
      "suggestion": "让告警带时间戳并按周期重报（如每个 key 首次 + 此后每 10 分钟一次），或把「留痕」做成有界滑动窗口而非永久去重。"
    },
    {
      "id": "i9",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "PRD §二 用「`'8000'` 这类字符串在 IPC/运营中心下发里真实存在」作为选择 `Number()` 而非 `typeof === 'number'` 的动机，但 toast-spec 里没有一条正向用例验证字符串数字被接受并作为 number 到达 ElMessage——只有 `'fast'` 一个负向字符串。若未来有人把 `Number()` 改回 `typeof` 检查，没有任何用例变红来保护这一设计动机。",
      "suggestion": "补一条正向用例：`duration: '1500'`（或 '8000'）⇒ `call.duration === 1500`（严格 number 断言），锁住 PRD 声明的 IPC 字符串场景。"
    }
  ],
  "dimensionScores": {
    "correctness": 7,
    "security": 9,
    "performance": 8,
    "maintainability": 7
  }
}