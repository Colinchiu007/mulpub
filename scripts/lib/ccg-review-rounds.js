'use strict'
/**
 * ccg-review-rounds.js —— 外部深审的**跨调用**轮次账本（openspec change: qm6-rebuttal-round-cap）
 *
 * 为什么需要它：引擎内部的 `[轮 1/3]` 只管**单次调用内**的收敛；而"改完重投提交、再跑一遍入口"
 * 每次都是全新调用，没有任何东西记着"这个 change 已经真跑过几轮外部评审"。
 * 实测代价：PR #4148 在同一切片上跑了八轮才靠人喊停。
 *
 * 两条不能写错的口径（都带现场锁，见 scripts/ccg-review-rounds.test.js）：
 *  ① 计数键是 **(change, headSha)**。判定记录名是**内容寻址**（stagedDiffHash），重投一次提交就换一个名
 *     （tasks §0.1 实测：同一文件加一行，哈希 90dce309… → 720882d6…）——挂在记录名上的计数器每次归零，
 *     而且**全程看起来完全正常**，这是本仓定性的"装饰性门禁"形状。
 *  ② 同一 sha 的重跑**不计数**（"填完裁决再覆盖一轮"是必须动作，不该消耗配额）；
 *     sha 只在驱动**真被调用之后**由调用方 record —— 没跑完就记一轮，等于把失败烧进预算。
 *
 * 上限来自 env，默认 3；非法值回落 3 且**必须出声**（静默回落会让"上限被人改小/改坏"永不可见）。
 *
 * 读文件与写文件同用一份规范化：账本读不出（JSON 坏、权限）一律标 `unreadable` 并**按未证实处理**，
 * 不得把"工具的失明"读成"从没跑过 ⇒ 可以继续跑"，也不得反过来读成"已跑满 ⇒ 拒绝调用"。
 */
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_MAX_ROUNDS = 3
const LEDGER_VERSION = 1

function readLedger (ledgerPath) {
  let raw
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return { data: { version: LEDGER_VERSION, changes: {} }, unreadable: false }
    return { data: { version: LEDGER_VERSION, changes: {} }, unreadable: true, reason: `读取失败：${e.code || e.message}` }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.changes || typeof parsed.changes !== 'object') {
      return { data: { version: LEDGER_VERSION, changes: {} }, unreadable: true, reason: '结构不符（缺 changes 段）' }
    }
    return { data: parsed, unreadable: false }
  } catch (e) {
    return { data: { version: LEDGER_VERSION, changes: {} }, unreadable: true, reason: `JSON 解析失败：${e.message}` }
  }
}

/**
 * 原子替换：临时文件 + rename。只重试 Windows 上的短暂占用（EPERM/EACCES/EBUSY），
 * 超预算或其他错误原样抛出 —— 无限重试 / 直接覆盖都是本仓禁止的退化形态。
 *
 * ⚠ 为什么不在这里 require('../ccg-review-writeback.js') 复用同名实现：那个模块为了取
 * CLOSED_DEEP_REVIEW_STATUSES 而 require 了整份判据本体（check-pr-exec-record.js），
 * 把账本库拖成"必须先加载全部门禁"。两处形状由本文件与它的测试各自守住；
 * 若要收敛成一份，正解是下沉到 scripts/lib 并同时改两侧（另开一刀，别顺手）。
 */
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const ATTEMPTS = 5

function writeJsonAtomic (file, obj) {
  const tmp = `${file}.${process.pid}.tmp`
  const data = JSON.stringify(obj, null, 2) + '\n'
  fs.writeFileSync(tmp, data)
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      const retryable = e && RETRY_CODES.has(e.code)
      if (!retryable || attempt === ATTEMPTS) {
        try { fs.unlinkSync(tmp) } catch { /* 清不掉就把原样保留的既有账本交给上层出声 */ }
        throw e
      }
      const wait = 40 * attempt
      const end = Date.now() + wait
      while (Date.now() < end) { /* 有界退避：短自旋，不引入定时器也不无限等 */ }
    }
  }
}

/**
 * 上限：只认正整数。其它一律回落默认并出声。
 * 空串也要算非法 —— `MP_QM6_MAX_ROUNDS=` 这种"设了但没值"如果静默用默认，
 * 与"没设"在产物上完全同形，没人知道有人试图改过它。
 * @param {Record<string,string|undefined>} env
 * @param {(msg: string) => void} [warn]
 */
function capOf (env, warn) {
  const e = env || {}
  const raw = e.MP_QM6_MAX_ROUNDS
  if (raw === undefined || raw === null) return { max: DEFAULT_MAX_ROUNDS, fellBack: false }
  const s = String(raw).trim()
  const n = Number(s)
  const ok = /^\d+$/.test(s) && Number.isInteger(n) && n > 0
  if (!ok) {
    if (typeof warn === 'function') {
      warn(`[ccg-review-rounds] MP_QM6_MAX_ROUNDS=${JSON.stringify(String(raw))} 非法（须为正整数），回落默认 ${DEFAULT_MAX_ROUNDS}`)
    }
    return { max: DEFAULT_MAX_ROUNDS, fellBack: true }
  }
  return { max: n, fellBack: false }
}

function roundsOf (data, change) {
  const entry = data.changes && data.changes[change]
  return entry && Array.isArray(entry.rounds) ? entry.rounds : []
}

/**
 * 这个 headSha 之前真跑过吗？round = 该 change 已记录的轮次数。
 * `recordName` 只作为**附加信息**存进去，MUST NOT 参与键计算（R3 就是钉这一格）。
 */
function inspect (opts) {
  const o = opts || {}
  const { data, unreadable, reason } = readLedger(o.ledgerPath)
  const rounds = roundsOf(data, o.change)
  const seen = rounds.some((r) => r && r.headSha === o.headSha)
  const out = { seen, round: rounds.length }
  if (unreadable) { out.unreadable = true; out.reason = reason }
  return out
}

/**
 * 登记一次"真调用过外部评审"。同 sha 幂等（只留一条，不膨胀）。
 *
 * ⚠ 两条并发/一致性口径，一条修了、一条**刻意没修**（QM-6 i2，2026-10-23 现场探针）：
 *  ① 已修：**账本读不出时拒绝追加**。readLedger 对坏 JSON 返回的是"空账本 + unreadable"，
 *     照原样 push 再 rename，等于把一份"只是暂时读不动的历史"覆盖成只剩这一条 ——
 *     那不是降级，是销毁证据。探针实测：账本里原有 2 轮 → 写成坏 JSON → 一次 record ⇒ 终态只剩 1 轮。
 *     现在一律抛错，由调用方按未证实处理（与 exceedsCap 同一档取向：工具的失明不得读成结论）。
 *  ② **没修，也未能复现**：read-modify-write 的结构窗口不为零（A 读到旧文档、B 后写会把 A 那轮吃掉），
 *     但 2026-10-23 的并发探针**没抓到**：同时起 4 个 `record` 进程写同一份账本，终态 4 条齐全
 *     （rc 全 0）；顺序两记也是 1→2 正常。所以这条只能写成"结构上有窗口、现场未复现"，
 *     不得写成"实测会丢更新"（我起初就这么写，被自己的探针否证）。
 *     彻底闭合需要跨进程 writer lock（先例：`PublishApiServer` 对 API_KEYS_PATH 那把），
 *     那是另一刀、要单独接线与反证 ⇒ 登记在 tasks §1.8。
 *     现实敞口也一并如实说：同一分支并发跑两个深审入口，会先在同一个 `.ccg` 产物上撞车，
 *     轮次账只是这条链上较不坏的一环。
 */
function record (opts) {
  const o = opts || {}
  if (!o.ledgerPath || !o.change || !o.headSha) {
    throw new Error('record 需要 ledgerPath / change / headSha —— 缺任一个都会让轮次静默不落账')
  }
  const cur = readLedger(o.ledgerPath)
  if (cur.unreadable) {
    throw new Error('账本读不出（' + cur.reason + '），拒绝在其上追加轮次 —— 那会把读不动的历史覆盖成只剩这一条')
  }
  assertChangeName(o.change)
  const changes = cur.data.changes || (cur.data.changes = {})
  const entry = changes[o.change] || (changes[o.change] = { rounds: [] })
  if (!Array.isArray(entry.rounds)) entry.rounds = []
  const hit = entry.rounds.find((r) => r && r.headSha === o.headSha)
  if (hit) {
    if (o.recordName && !hit.recordName) {
      hit.recordName = o.recordName
      writeJsonAtomic(o.ledgerPath, cur.data)
    }
    return { counted: false, round: entry.rounds.length }
  }
  entry.rounds.push({
    headSha: o.headSha,
    recordName: o.recordName || null,
    at: o.at || new Date().toISOString(),
  })
  writeJsonAtomic(o.ledgerPath, cur.data)
  return { counted: true, round: entry.rounds.length }
}

/**
 * 超限判定：**只读**。判超限这一步顺手写账本，会变成"入口拒绝调用、配额却已经扣掉一轮"
 * —— 那正好把要保护的预算花在没发生的事上。
 * 账本不可读时不判超限（不据此拒绝调用），但把 unreadable 一并报出去。
 */
function exceedsCap (opts) {
  const o = opts || {}
  const st = inspect(o)
  const max = Number.isInteger(o.max) && o.max > 0 ? o.max : DEFAULT_MAX_ROUNDS
  const r = { exceeded: !st.unreadable && !st.seen && st.round >= max, round: st.round, max }
  if (st.unreadable) { r.unreadable = true; r.reason = st.reason }
  return r
}

/**
 * 账本默认路径：`openspec/changes/<change>/external-rounds.json`。
 * 刻意**不**放 `.ccg/reviews/` 下：pre-commit 暂存记录用的 glob 是
 * `:glob.ccg/reviews/*.json`（去掉前面的冒号写法以免被当字面量），其中 `*` 不跨 `/`
 * （tasks §0.4 实测）—— 放子目录里那份账永远不会随 PR 入库，变成"只有本机知道上限有没有被绕"。
 * 该目录不存在时**不创建**、只报 nochange=1：为一个计数器凭空造一个 change 目录，
 * 会把"这个分支没有规格"伪装成"有"。
 *
 * `change` 的形态在这里显式校验（QM-6 i1）。两条独立事实共同决定了不校验时也不会写错地方：
 * ① git 自己拒绝含 `..` 的分支名（实测 `git branch -f '../../etc/evil'` → rc=128 not a valid
 *    branch name，三种写法 `../x`、`a/../../b`、`..\..\x` 全被拒），而入口唯一的 change 来源就是
 *    `git rev-parse --abbrev-ref HEAD`；② 固定前缀 `openspec/changes/` 会吸收两级 `..`
 *    （`../../etc` 解析回 `<cwd>/openspec/etc`，仍在仓内）。
 * 但这两条都不在本模块自己的合同里——它们分别是 git 的行为和调用方的来源，任一条被人改掉
 * （比如入口改用参数传 change）就静默失效。所以按"边界处校验"补这一格，且**只拒 `..` 段与绝对路径**：
 * 分支名合法地可以含 `/`（`team/feature`），不得顺手把字符集收紧成 kebab-only 而拒掉合法分支。
 */
/**
 * 绝对路径判据：**不能只看 path.isAbsolute** —— 它是**平台相关**的。
 *
 * POSIX 的 `path.isAbsolute('C:\\Windows')` 恒为 false（只认前导 `/`），
 * 而同一份输入在 Windows 上为 true ⇒ 同一份 change 名在两个平台给出两个相反结论。
 * 本函数的入参是**分支名**（可能来自任何平台的工作区），账本路径又是拿它拼出来的，
 * 所以判据必须**平台无关**：同时拒 POSIX 绝对、盘符绝对、UNC。
 *
 * 现场（2026-10-23）：本仓的 R8 用例在 Ubuntu runner 上红，报
 * `Missing expected exception: 应拒："C:\\Windows"` —— 判据实现用的是 `path.isAbsolute`，
 * 在 Linux 上对盘符路径不判绝对 ⇒ 用例的期待（平台无关）与实现的判据（平台相关）相反。
 * 修实现而不是改用例：用例的期待是对的（分支名可能带 `C:\`），
 * 改成"Linux 上不拒盘符"才是把跨平台不一致固化下来。
 */
const WINDOWS_DRIVE_ABS_RE = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC_ABS_RE = /^\\\\/
function isAbsoluteAnyPlatform (s) {
  return path.isAbsolute(s) || WINDOWS_DRIVE_ABS_RE.test(s) || WINDOWS_UNC_ABS_RE.test(s)
}

function assertChangeName (change) {
  const s = String(change === undefined || change === null ? '' : change)
  if (s === '') throw new Error('change 不得为空 —— 空值会让账本落到 openspec/changes//，两个不同分支共用同一份计数')
  if (isAbsoluteAnyPlatform(s)) throw new Error('change 必须是相对名，收到绝对路径：' + JSON.stringify(s))
  const segs = s.replace(/\\/g, '/').split('/').filter(Boolean)
  if (segs.includes('..')) throw new Error('change 含 `..` 段，拒绝拼出仓库外/跨目录的账本路径：' + JSON.stringify(s))
  return s
}

function defaultLedger (change) {
  return path.join(process.cwd(), 'openspec', 'changes', assertChangeName(change), 'external-rounds.json')
}

function cliFlag (argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}

/**
 * CLI 存在的唯一理由：让入口不必在 shell 里内联 node 代码（本仓硬规则：
 * 含引号嵌套的内联一律禁止，后果不是报错而是静默执行错的东西）。
 * 输出一律 key=value 单行，shell 用 tr/sed 取值；未知子命令返回 2 ——
 * 静默返回 0 会让"CLI 用坏了"读成"零轮"，那正好把上限变成不触发的装饰。
 */
function mainCli (argv) {
  const args = argv || []
  const mode = args[0]
  const change = args[1]
  const headSha = args[2]
  if (!change || !headSha) {
    process.stdout.write('usage: ccg-review-rounds.js <check|record> <change> <headSha> [recordName] [--ledger <path>]' + '\n')
    return 2
  }
  // change 形态校验**与 --ledger 是否显式给出无关**，一律先过（QM-6 i1 + R10 现场补）：
  // 只在默认路径上校验是不够的 —— 显式 --ledger 时 change 退化成文档里的一个键，
  // 一个怪键会静默读到一个不存在的桶 ⇒ "0 轮"，上限就成了永不触发的装饰。
  // 退出码取 2（判据自身故障档），不得让异常栈直接冒出去：
  // 入口那侧的 `|| echo '…unreadable=1…'` 只认"读不出"，把"参数被拒"也归到那一档才对——
  // 关键是**不许静默**，也不许退化成"当成零轮继续跑"。
  let ledger
  try {
    assertChangeName(change)
    ledger = cliFlag(args, '--ledger') || defaultLedger(change)
  } catch (e) {
    process.stdout.write('badchange=1 max=0 round=0 exceeded=0 unreadable=1 msg=' + JSON.stringify(e.message) + '\n')
    return 2
  }
  const cap = capOf(process.env, (m) => process.stdout.write('warn=' + JSON.stringify(m) + '\n'))
  if (mode === 'check') {
    if (!fs.existsSync(path.dirname(ledger))) {
      process.stdout.write('round=0 max=' + cap.max + ' exceeded=0 unreadable=0 seen=0 nochange=1 ledger=' + ledger + '\n')
      return 0
    }
    const r = exceedsCap({ ledgerPath: ledger, change, headSha, max: cap.max })
    const seen = inspect({ ledgerPath: ledger, change, headSha })
    process.stdout.write('round=' + r.round + ' max=' + r.max
      + ' exceeded=' + (r.exceeded ? 1 : 0)
      + ' unreadable=' + (r.unreadable ? 1 : 0)
      + ' seen=' + (seen.seen ? 1 : 0)
      + ' ledger=' + ledger + '\n')
    return 0
  }
  if (mode === 'record') {
    if (!fs.existsSync(path.dirname(ledger))) {
      process.stdout.write('counted=0 round=0 nochange=1 ledger=' + ledger + '\n')
      return 0
    }
    let r
    try {
      r = record({ ledgerPath: ledger, change, headSha, recordName: args[3] || null })
    } catch (e) {
      // 拒绝落账必须自己成档（rc=2 + key=value），不得让异常栈冒出去：
      // 入口那侧读的是 `counted=`，栈只会被 `|| echo 'counted=0 error=1'` 摊成一句通用兜底，
      // 于是"账本坏了拒写"与"CLI 被人用坏了"在日志里完全同形（本仓反复要分开的两档）。
      process.stdout.write('counted=0 error=1 msg=' + JSON.stringify(String(e && e.message)) + '\n')
      return 2
    }
    process.stdout.write('counted=' + (r.counted ? 1 : 0) + ' round=' + r.round + ' ledger=' + ledger + '\n')
    return 0
  }
  process.stdout.write('unknown mode: ' + String(mode) + '\n')
  return 2
}

module.exports = { DEFAULT_MAX_ROUNDS, capOf, inspect, record, exceedsCap, readLedger, writeJsonAtomic, defaultLedger, assertChangeName, mainCli }

if (require.main === module) process.exitCode = mainCli(process.argv.slice(2))
