{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "执行记录（本 diff 内含）§3 仍写「2700 ≥ 24.5×60×1.5 = 2209」，但 24.5×60×1.5 = 2205；§1 第 5 行 max=23.6、floor=2122，而 23.6×60×1.5 = 2124。两个等式都只能由未舍入的 max（≈24.544、≈23.578）解释——这正是上一轮外部评审 i5 指出的「把显示值当精确值复算对不上」问题，而 e7b39a894 的提交信息声称已「回填活路径实测读数」，等式却原样保留在最终交付文件里。后续任何人照式子复算都会复核失败，与记录自封的「可验证」标准直接冲突。",
      "suggestion": "把两处等式改为「floor = ceil(max_precise×60×1.5) = 2209 / 2122」，并显式注明 max 显示值（24.5/23.6）是 toFixed(1) 舍入后的读数、精确值按 provenance 里的未舍入样本算，避免读者用显示值复算对不上。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "`runGhOnce` 把 stderr 截到 200 字符后才构造 Error message，而 `withTransientRetry` 和 `isTransientGhFailure` 只能看到这个截断文本（`String(r && r.stderr).slice(0, 200)`）。真实 gh/Go 报错若在 stderr 第 200 字节之后才出现瞬时签名（长堆栈、多行输出，本仓实测的 `read tcp ...: wsarecv` 现场签名长度已接近该窗口），该类故障会被判成「非瞬时、一次就抛」——恰与本改动要治的抖动相反。上一轮评审 i7 已指出此事，本轮 diff 未做任何修改：分类路径仍然只消费截断文本。",
      "suggestion": "分类路径改用未截断的完整 stderr（把 `isTransientGhFailure(r.stderr)` 的结果在抛错前就定下来，或把完整 stderr 挂在 Error 的附加属性上），仅展示层做 `.slice(0,200)`；并补一条「瞬时签名位于 stderr 201+ 字节」的测试防回归。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "「册子里更新的一档要么已被扶正、要么样本量确实更小」这条锁的扶正分支只要求 `newest.collectedAt === prov.collectedAt`，完全不校验样本量下限。记录和测试注释反复声称「8 片 < 样本量下限 10，把它扶正当场就该红」，但锁本身允许任何片数的读数被扶正（把顶部 collectedAt/值改成新条目即可）：shards=2 的新读数照样能全绿。且扶正靠的仍是改写 `prov.collectedAt` 这一普通字段，没有任何显式 `promoted` 标记——「样本量够才算扶正合法」这一核心声明仍无门禁可读。",
      "suggestion": "给读数条目加显式扶正标记（如 `promoted: true`，且只有 `shards >= 样本量下限` 的条目允许带该标记），锁改为「最新一档：要么带 promoted 标记，要么 shards 确实小于扶正档」；正控/反控中把「shards 未达下限却被扶正」也判红（M 变异补一条）。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "`resolvePositiveInt` 只要求正整数，无上限；退避总时长随 attempts 按 Σk 呈 O(n²) 增长。`MP_AUDIT_GH_ATTEMPTS=100`/`MP_AUDIT_GH_BACKOFF_MS=30000` 的一次 CI 配置手滑 = 30000×5050 ≈ 42 小时挂起；更大的值可达数天到数月。代码与文案反复宣称「有界重试」，但界只存在于对人类输入合法值的善意假设里，跟上一轮评审 i6 指出的问题完全一致，本轮未加任何钳制。",
      "suggestion": "在 `resolvePositiveInt` 或 `withTransientRetry` 入口对 attempts（如 ≤ 10）与 baseMs（如 ≤ 30000）加显式硬上限，越界时出声并钳制；或设定「退避总时长 ≤ T」的总量上限，超限直接抛。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "记录内部数字自相矛盾，可在 diff 内逐条验证：§3 称审计侧「17 pass / 0 fail（起点 9）」、§2 与 CHANGELOG 称「审计侧 8 条锁（17 总）」，但本 diff 对 `electron-ci-shard-audit.test.js` 新增了 10 个 test 块（起点 9 ⇒ 应为 19）；步骤侧 9+3=12 都对得上，唯独审计侧 8/17 与实际 10/19 不符。要么起点不是 9，要么「17」没随新增测试更新——无论哪种，记录的验证读数无法由提交物复现。",
      "suggestion": "按提交物实际跑一遍 `node --test scripts/electron-ci-shard-audit.test.js`，把「起点/新增/总数」三处数字改成与文件一一对应（并在标准化计数里注明哪些 test 属于回归锁、哪些属于分类锁）。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "本 diff 里两个随记录一起提交的评审产物 `.ccg/reviews/parity-none-qm6-e7b39a89-adjudication.json` 与 `parity-none-qm6-e7b39a89-critique-v1.md` 都以 `\\ No newline at end of file` 结尾——正是上一轮 i1 用「实物证据」打红过的缺陷形态（补丁脚本 lines()/join 吃尾换行）。记录声称「三个被改文件工作副本实测 i/lf w/crlf」只覆盖脚本文件，而作为证据的评审产物自己就是在行尾判据上漏检的例子。",
      "suggestion": "给评审/记录类新产物也补上尾换行（或把 i1 的「必须以换行收尾」回归锁从单文件扩展为对本次提交所有新增文本文件的检查），确保证据文件本身不违反自己声明的行尾标准。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "`collect` 里 `opts.api` 仍是最高优先级：一旦调用方传入自定义 api，`makeGhApi`（含 attempts/baseMs 的 `resolvePositiveInt` 校验、非法值出声、重试与退避）被整体静默绕过，连 notice 也不走。代码注释宣称 `makeGhApi` 是「默认取数面、重试落在 collect 真走的路上」，但取数面共有两条路，其中一条完全游离于重试与校验之外——上一轮 i9 指出后本轮未改。",
      "suggestion": "要么删除 `opts.api` 旁路（统一走 makeGhApi + spawnImpl 注入，测试已有此能力），要么在走 `opts.api` 的分支显式打日志「重试被绕过」并在注释中声明原因；同时给「传入 opts.api 时重试不生效」加一条测试锁死语义。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "`resolvePositiveInt` 把 `''`（空字符串，`MP_AUDIT_GH_ATTEMPTS=`）与 undefined/null 一同静默回落默认且不调用 notice，而 `' '`（Number 得 0）却会走「非法 ⇒ 回落并出声」分支。自己注释写的政策是「非法值必须回落默认并出声——0 等于关掉重试还谎称按配置走」，空串正是最容易手滑打出来的「关掉重试」，却被无声吞掉，与断言的「三档非法各要一条告警」行为不一致。",
      "suggestion": "把空串也并入出声分支：`raw === ''` 时报「空值回落默认」；或统一先 `Number(raw)` 后按非法性分支，让空串与 0/负/NaN 走同一条出声路径，并补一条空串用例。"
    },
    {
      "id": "i9",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "§5 处置表引用了变异 M10（i4 锁）、M11（i1 锁）、M12（i2 谓词恒真）并称「实测红在反控/（M12 证明两条都有牙）」，但 §2 变异表只登记 M1–M9，diff 中也没有这三条变异的任何执行器、产物或红集记录——上一轮评审 i10「变异证据无法从交付物复现」的结论依旧成立，且本轮新增的三条引用进一步扩大了不可复现证据面。",
      "suggestion": "把 M1–M12 全部收进同一张变异表（编号/刀法/红在哪条/还原方式），并随记录提交可重跑的变异执行脚本与输出哈希；至少补 M10–M12 到与 M1–M9 同等粒度的登记。"
    },
    {
      "id": "i10",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "readings 条目含 collectedAt/runnerShape/runs/shards/p50ShardMin/maxShardMin/source，却丢掉了审计输出明晃晃打出的 `minShardMin=19.4`——册子现在是唯一的历史读数载体，丢 min 等于丢分布下界，未来调预算无法判断争用离散度（仅靠 max×倍数会被极端尾部牵着走）。上一轮 i8 指出后本轮未补。",
      "suggestion": "把 `minShardMin` 纳入 KEYS 与两条既有条目（新形状档为 19.4，旧档从其 source run 补），并加 `min ≤ p50 ≤ max` 的序关系断言，顺带让 KEYS 子集不再无提示地放宽。"
    },
    {
      "id": "i11",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "`withTransientRetry` 没有任何 `attempts >= 1` 的前置校验，`makeGhApi` 是导出 API 且不 normalize：直接 `makeGhApi({ attempts: 0, ... })` 时 `for` 循环体不执行、`last` 为 undefined，末尾 `throw new Error(last.message + ...)` 抛的是读 undefined 属性的 TypeError，报错点远离「attempts=0」真因。`collect` 路径靠 `resolvePositiveInt` 兜住了，但导出的默认取数面本身回头就咬人。",
      "suggestion": "`withTransientRetry` 入口加 `if (!(ctx.attempts >= 1)) throw new Error('attempts 必须 >= 1，实际=' + ctx.attempts)`（或让 `makeGhApi` 自行归一化并报「attempts=0 非法」），让越界在根因处爆出而非变成无关的 TypeError。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 8,
    "performance": 7,
    "maintainability": 5
  }
}
