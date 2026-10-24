{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "diff 最后一 hunk 显示 `+if (require.main === module) { process.exitCode = main(); }` 后紧跟 `\\ No newline at end of file`，而删除行是带结尾换行的 —— 新文件丢失了末行终止符。这与提案自身的行尾声明（「统一 \\r\\n」「落盘前当场断言裸 LF=0 且 loneCR=0」）直接矛盾，属于可验证的实物证据级别的出入。",
      "suggestion": "重跑 `git ls-files --eol` 与 `git diff --ignore-cr-at-eol --numstat` 对账，恢复末行 CRLF 终止符，确认 diff 中不再出现 `\\ No newline at end of file` 标记后再提交。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "新测试「样本量不够的新读数不得被悄悄扶正」断言 `newer.every(r => r.shards < p.shards)`（newer = collectedAt 晚于顶部档的读数），叠加「顶部的 max/shards/runs 必须能在册子里对号」那条，唯一被允许的不变式是：扶正档必须严格更旧且严格更多片。于是「样本量够了就显式换顶部值」这个声明的动作在测试里结构上不可达：新读数片数等于顶部片数 → `8 < 8` 红；删除该读数 → `newer.length >= 1` 红。声明的工作流与锁矛盾。",
      "suggestion": "把不变式从「片数小于顶部档」改为显式扶正标记（如 readings 条目带 `promoted: true` 或顶部持 `topReadingId` 指针），并补一条「新增足够样本读数 → 显式扶正 → 全绿」的正向测试；当前写法让未来唯一合法的演进路径是伪造更大的片数。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "提案自证现场是「连吃 4 次 SELF_FAULT、第 5 次成功」（单次成功率约 1/5）。按此读数，`attempts=3` 时 P(三次全失败) = (4/5)³ ≈ 51% —— 同一失效形态下重测入口仍有约一半概率最终 SELF_FAULT，且退避窗（1.5s+3s）远短于分钟级 TLS 中断的典型时长。结论「让取数更耐用」的达成度与证据不符；§4 虽承认「非分布支撑」，但正文仍把 3 描述为该现场的足够下界。",
      "suggestion": "要么按观测成功率反推最少尝试数（p=0.2 时目标成功率≥90% 需 attempts≥11），要么把结论降格为「降低而非消除 SELF_FAULT」并写明预期的残余失败率，留待按 *_PROVENANCE 口径攒分布后再调。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "`TRANSIENT_PATTERNS` 中的 `/HTTP 5\\d\\d/` 只匹配字面「HTTP 5NN」单空格形态。gh/代理的真实报错常见 `HTTP/2 503`、`HTTP/1.1 500`、`HTTP/1.1 502 Bad Gateway` 等，均不命中（仅 `\\bServer Error\\b` 兜住部分）；被归为非瞬时的 503/502 将一次就抛 —— 恰好是本改动要治的那类故障。测试也未覆盖 HTTP/2 形态。",
      "suggestion": "改用 `/(?:HTTP\\/[\\d.]+|HTTP)\\s+5\\d\\d/` 并给 `/\\b5\\d\\d\\b/` 加护栏（避免命中 404 之类的号码段），同时补 `HTTP/2 503` 与 `HTTP/1.1 500` 两条测试用例。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "§3 写着「2700 ≥ 24.5×60×1.5 = 2209」，但 24.5×60×1.5 = 2205；§1 第 5 行 `floor=2122` 而 23.6×60×1.5 = 2124。两个 floor 值都只能由未舍入的 max（≈24.544、≈23.578）解释，结论成立，但记录里呈现的等式是错的，后续照式子复算会复核失败。",
      "suggestion": "把等式改为「floor = ceil(max_precise×60×1.5) = 2209 / 2122」，并显式注明 max 显示值（24.5/23.6）是舍入后读数，避免读者用显示值复算对不上。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "security",
      "finding": "`MP_AUDIT_GH_ATTEMPTS` / `MP_AUDIT_GH_BACKOFF_MS` 只要求正整数，退避总时长随 attempts 按 k 求和呈 O(n²) 增长：attempts=100 时 ≈ 2.1 小时，attempts=1000 时 ≈ 12 天。CI 配置一处手滑（如 `MP_AUDIT_GH_ATTEMPTS=999`）就能把「有界重试」变成数小时到数天的挂起，且无总量上限。",
      "suggestion": "在 `resolvePositiveInt` 里对 attempts/baseMs 加显式上限（如 attempts ≤ 10、baseMs ≤ 30000），越界时出声并钳制，或对退避总和设硬上限。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "`runGhOnce` 把 stderr 截到 200 字符后才放进抛出的 message，`isTransientGhFailure` 只对这个截断文本做分类。若瞬时签名（`forcibly closed` / `unexpected EOF` / `HTTP 5xx`）出现在 stderr 第 200 字节之后（长输出、堆栈），分类结果为非瞬时 → 不再重试，与设计意图相反。",
      "suggestion": "分类路径用未截断的完整 stderr（`r.stderr` 全量传入 `isTransientGhFailure`），仅展示层做 `.slice(0,200)`；并加一条「签名在 stderr 后段」的测试防回归。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "readings 条目标了 runs/shards/p50/max 却漏了 `minShardMin`（审计输出里有 `minShardMin=19.4`），schema KEYS 测试只强约束所选子集。册子现在是唯一保留下来的历史读数载体，丢掉 min 就意味着丢了分布下界信息，未来调预算无法判断争用离散度。",
      "suggestion": "把 `minShardMin` 纳入 KEYS 与两条既有条目（新形状档为 19.4，旧档从其源 run 补），并加 `min ≤ p50 ≤ max` 的序关系断言。"
    },
    {
      "id": "i9",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "`makeGhApi` 已导出，但只有 `collect` 路径经 `resolvePositiveInt` 保证 attempts ≥ 1；直接调 `makeGhApi({ attempts: 0, ... })` 时 `withTransientRetry` 的空循环返回 undefined，`ghJson(...).stdout` 在远离根因处抛 TypeError，且 `collect` 里 `opts.api` 传参路径会整条绕过重试与非法值回落而无声。",
      "suggestion": "在 `withTransientRetry` 入口加 `if (ctx.attempts < 1) throw`（或让 `makeGhApi` 自行 normalize），并在 `collect` 中给「传入 opts.api 时重试被绕过」加一条显式注释或日志。"
    },
    {
      "id": "i10",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "§2 声称 M1–M9 九条红集两两不同、逐字节还原，但 diff 中不含任何变异执行器/产物/日志，这些是整份提案的核心证据，无法从交付物复现验证；同样 §1 的「grep attempt|retries|backoff 0 命中」「17/15 pass」等断言也不带可复现命令。",
      "suggestion": "把变异反证的最小复现脚本与输出（或记录命令+日期+产物哈希）随记录提交，至少给出可重跑的单条命令与预期输出，否则证据停留在自报层面。"
    },
    {
      "id": "i11",
      "severity": "Info",
      "dimension": "performance",
      "finding": "`sleepSync` 每次重试都 `new SharedArrayBuffer(4)` + 新 Int32Array，退避发生在低频失败路径，实际开销可忽略；但 `Atomics.wait` 在 Node 主线程整进程阻塞，且忙等兜底路径同样阻塞 —— 一旦 `collect` 将来被任何异步调用方复用，整条事件循环被卡死，约束只在注释里。",
      "suggestion": "把 4 字节 SharedArrayBuffer 提升为模块级单例缓存，并在 `collect` 调用点用显式注释（或 fail-fast 检查）声明「本函数同步阻塞事件循环，勿在异步上下文复用」。"
    }
  ],
  "dimensionScores": {
    "correctness": 7,
    "security": 9,
    "performance": 8,
    "maintainability": 6
  }
}
