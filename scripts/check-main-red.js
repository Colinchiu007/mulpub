'use strict'
/**
 * check-main-red.js — 「主干红着就别往里合」的**执行体**（AGENTS「PR 自动合并」判据第 2 条的机械面）
 *
 * 为什么要有这个文件：AGENTS 判据第 2 条写的是「`gh pr checks` 零 pending、零 fail」，
 * 这条比 GitHub 的 required 清单严；但它过去只以散文存在，每轮由会话临场判断。实测代价（2026-10-19）：
 * 一条**非 required** 的分片红先随窗口合进 main，main 转红后反过来把之后每一个 PR 的 required
 * `Gate Result` 判红 —— 两个 PR 被冻了约 40 分钟，冻住它们的不是自己的改动，是主干上别人的红。
 * `merge-when-green.{sh,ps1}` 当时会「等到天荒地老也不说为什么等不到」，因为它的失败信息只有一句
 * 「CI 检查未通过」，而真正的问题是**主干**没绿。
 *
 * 三个入口一份实现：本文件 + `scripts/lib/main-red.js`（纯判据）；`merge-when-green.sh` 与
 * `merge-when-green.ps1` 都调用本文件，**不许各抄一份判定**。
 *
 * 退出码（含义不得混档：把工具的失明读成结论是本仓「装饰性门禁」的同型）：
 *   0 = 可以合（主干绿，或主干红但已显式归因且本 PR 无新增红）
 *   1 = 本 PR 自己引入的红（差集非空）—— 必须修
 *   2 = 主干是红的 —— 停手，先有人去修 main；本 PR 是那一刀的修复时显式加 --allow-main-red
 *   3 = 未证实（pending / 零检查）
 *   4 = 判据自身故障（gh 取不到数）—— 按未证实处理，不得当成"没有红"
 *
 * ⛔ 刻意**不**把 `QG Desktop Shards` / `QG Coverage` 加进 required 清单：那是改「谁来守门」，
 *    属 AGENTS 明写必须人工过目的动作。本文件的作用是把"main 红"这件事**变得可见且可归因**，
 *    而不是替人改分支保护。
 *
 * 已知局限（必须写在现场读数旁边，否则会被读成比实际更强的判据）：
 *   差集按**检查名**对齐。同名红只证明「这条检查在主干上也红过」，不证明「红的是同一条用例」。
 *   所以 STOP_MAIN_RED 的唯一出口是有人去修 main —— 不能因为"我这也是同名红"就把它读成已解释。
 *
 * 2026-10-22 起的两处口径变更（change: main-red-run-baseline，提案见
 * `openspec/changes/main-red-run-baseline/proposal.md`）：
 *   ① **主干基准改读「该 tip 的非 workflow_run run 集合」**（`mainRowsAt`），不再读该 commit
 *      上的全部 check-runs。理由：GitHub 把 `workflow_run` 触发的工作流的 check run 一律挂在
 *      **默认分支当前 tip** 上，实测主干 tip 上 102 条检查行里 **81 条**是同一个
 *      `handle-ci-failure`（来自 30 个 handler run）——噪声规模随 tip 存续时间增长，
 *      「主干全绿」这个读数在并发合并时几乎拿不到。PR 侧仍读 check-runs。
 *   ② **稳定窗**：读数前后各取一次 tip，不一致即作废本次读数并有界重试
 *      （`--attempts` 默认 3、`--retry-seconds` 默认 90）。「tip 移动」归入既有的
 *      「未证实」档（3），**不新增退出码**，也**不得**把 tip 钉死在旧 sha 上继续判绿。
 */
const path = require('node:path')
const cp = require('node:child_process')
const { judge, pickBaseline, readout, resolveRepoSlug } = require('./lib/main-red')

const REPO_DEFAULT = 'Colinchiu007/mulpub'

function parseArgs (argv) {
  const out = { pr: null, allowMainRed: null, json: false, repo: null, attempts: 3, retrySeconds: 90, maxWaitSeconds: 180 }
  const unclaimed = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pr') { out.pr = argv[++i]; continue }
    if (a.startsWith('--pr=')) { out.pr = a.slice(5); continue }
    if (a === '--allow-main-red') { out.allowMainRed = String(argv[++i] || '').trim(); continue }
    if (a.startsWith('--allow-main-red=')) { out.allowMainRed = a.slice(17).trim(); continue }
    if (a === '--json') { out.json = true; continue }
    if (a === '--repo') { out.repo = argv[++i]; continue }
    if (a.startsWith('--repo=')) { out.repo = a.slice(7); continue }
    // 稳定窗参数：读数期间主干 tip 移动 ⇒ 读数作废 ⇒ 有界重试（2026-10-22）
    if (a === '--attempts') { out.attempts = argv[++i]; continue }
    if (a.startsWith('--attempts=')) { out.attempts = a.slice(11); continue }
    if (a === '--retry-seconds') { out.retrySeconds = argv[++i]; continue }
    if (a.startsWith('--retry-seconds=')) { out.retrySeconds = a.slice(16); continue }
    // 稳定窗的总等待上限（评审 i4）：attempts × retry-seconds 是可传的，
    // 没有上限就等于把「重试」变成「可以无限睡」（--attempts 100 --retry-seconds 3600 = 100 小时）。
    if (a === '--max-wait-seconds') { out.maxWaitSeconds = argv[++i]; continue }
    if (a.startsWith('--max-wait-seconds=')) { out.maxWaitSeconds = a.slice(18); continue }
    unclaimed.push(a)
  }
  // 未知旗标与非法取值一律出声并走"自身故障"档（AGENTS：参数不得静默忽略——一次 --limit 4 被丢弃
  // 就把 smoke 放大成整域，同一个错法在这里会让"我以为我豁免了"变成"其实没豁免"）
  if (unclaimed.length) throw new Error('未知参数：' + unclaimed.join(' ') + '（本判据只接 --pr/--allow-main-red/--json/--repo/--attempts/--retry-seconds/--max-wait-seconds）')
  if (!out.pr) throw new Error('缺 --pr <编号>')
  if (!/^\d+$/.test(String(out.pr))) throw new Error('--pr 必须是数字 PR 编号，实到 ' + out.pr)
  if (out.allowMainRed !== null && out.allowMainRed === '') throw new Error('--allow-main-red 必须带归因文本（空串等于没豁免，别用它静默放行）')
  // 数值旗标同样不得静默：attempts=0 会让稳定窗一次都不试（等于把「读数作废」读成「读数有效」），
  // retrySeconds 传 NaN 会让重试间隔变成 0 或 Infinity，两种都不是人想要的那一格。
  const attempts = Number(out.attempts)
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('--attempts 必须是 ≥1 的整数，实到 ' + out.attempts)
  const retrySeconds = Number(out.retrySeconds)
  if (!Number.isInteger(retrySeconds) || retrySeconds < 0) throw new Error('--retry-seconds 必须是 ≥0 的整数，实到 ' + out.retrySeconds)
  const maxWaitSeconds = Number(out.maxWaitSeconds)
  if (!Number.isInteger(maxWaitSeconds) || maxWaitSeconds < 0) throw new Error('--max-wait-seconds 必须是 ≥0 的整数，实到 ' + out.maxWaitSeconds)
  out.attempts = attempts
  out.retrySeconds = retrySeconds
  out.maxWaitSeconds = maxWaitSeconds
  return out
}

/**
 * 逐行 JSON 解析（2026-10-22 抽出共用形态）。
 * `gh api --paginate … --jq '<投影>'` 的真实输出是**每行一个 JSON 对象**，单页与多页同形：
 * 多页时 gh 逐页各打一批再首尾相接，**不**会有外层方括号（原先用数组形 jq 才会出现
 * `[…][…]` 那种非法 JSON）。空文本是**合法终态**（rc=0 而零行 = 该端点这次没有数据）。
 * @param {string} raw @param {string} what 出错时点名用的来源名
 * @returns {object[]}
 */
function parseJsonLines (raw, what) {
  const text = String(raw == null ? '' : raw)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return []
  const rows = []
  for (const [i, line] of lines.entries()) {
    let item
    try { item = JSON.parse(line) } catch (e) {
      throw new Error(what + ' 第 ' + (i + 1) + ' 行不是 JSON 对象（形状变了，不得按「无红」处理）：' + line.slice(0, 80))
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(what + ' 第 ' + (i + 1) + ' 行不是对象（数组与标量都不接受）')
    }
    rows.push(item)
  }
  return rows
}

/**
 * 解析 `gh api --paginate ... --jq '.check_runs[]? | {…}''` 的输出（第三轮 i2 抽成独立函数）：
 * 每行一个独立 JSON 对象，**单页与多页同形**。原先用数组形 jq（把投影整个包在方括号里），多页时 gh
 * 逐页各打一个 `[...]` 再首尾相接，得到 `[…][…]` 这种非法 JSON ⇒ JSON.parse 抛 ⇒ 闸门恒 SELF_FAULT。
 * 本仓每次约 25 条检查、一页装得下，所以那是「将来会咬人」的潜伏缺陷而不是当前故障——但翻页时它
 * 只表现为「闸门永远自称故障」，比漏判更快暴露也更难归因，所以现在就把解析口径改成可逐行归因。
 * 空文本是**合法终态**（第四轮 i3 纠正）：gh rc=0 而一行都没有，含义就是「这个 commit 上还没有
 * 检查」——检查刚排队还没生成时真会发生，#4024 自己就被这个形状挡过一次。
 * @param {string} raw
 * @returns {{name:string,status?:string,conclusion?:string|null}[]}
 */
function parseCheckRunLines (raw) {
  // 上一版在这里抛错，于是 judge() 的「零检查 ⇒ INCOMPLETE(3)」档在生产里**永不可达**：写了档位
  // 却永远不会走到，那是一条装饰性分支。宿主真失败另有去路——gh 非零 rc 由 execSync 抛出 ⇒ 4 档。
  return parseJsonLines(raw, 'check-runs')
}

/**
 * 同一个 workflow 的两次 run，哪一次更新？判定序：
 * ① `run_number`（第几次推送触发）—— 两边都有限且不等时，大的胜；
 * ② `run_attempt`（第几次重跑）—— **缺失时按 1 计**（GitHub 的默认 attempt 号）；
 *    缺这一层兜底的话，选中的 run 可能不是最新那次 ⇒ 基准被污染（深度评审 i1）；
 * ③ 时间戳兜底（`updated_at` 优先，其次 `created_at`；ISO 8601 字符串按字典序即时间序）——
 *    前两维都不可用时用它定序，不靠 API 返回顺序的隐含假设。
 *
 * **必须两维都比**：重跑不增加 `run_number`，只加 `run_attempt`；
 * 只比一维会把「重跑已修复」的那次读成旧的失败（= 主干假红），或把旧的一次读成最新（= 漏红）。
 */
function isLaterRun (a, b) {
  const an = Number(a && a.run_number)
  const bn = Number(b && b.run_number)
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an > bn
  const attemptOf = (r) => {
    if (!r || r.run_attempt == null) return 1 // 缺失 ⇒ 视为第 1 次（GitHub 默认值）
    const n = Number(r.run_attempt)
    return Number.isFinite(n) ? n : 1
  }
  const aa = attemptOf(a)
  const ba = attemptOf(b)
  if (aa !== ba) return aa > ba
  const at = String((a && (a.updated_at || a.created_at)) || '')
  const bt = String((b && (b.updated_at || b.created_at)) || '')
  if (at && bt && at !== bt) return at > bt
  return false
}

/**
 * 从「该 tip 的全部 run」里挑出**参与主干基准**的那些：**排除 `workflow_run` 触发**，
 * 同一 workflow 只留**最新**一次（`run_number` 与 `run_attempt` 同时最大）。
 *
 * 纯函数（不碰网络、不碰 git），可单测——排除 `workflow_run` 这一步是本片的核心，
 * 它的判据必须能被测到，而不能只活在一次真实 API 调用里。
 *
 * ⚠️ 分组键是 **(workflow 名, event, run_number)**，不是 workflow 名（深度评审 i2，Critical）：
 *    按 workflow 名分组会把**不同触发实例**（push 的红 vs 之后 schedule 的绿）混成一组，
 *    取「最新」就会让**后到的绿覆盖先前的红** ⇒ 主干误判绿。
 *    同一 (workflow, event, run_number) 才是「同一次触发的重跑」——那里面取最新 attempt
 *    才是对的（重跑已修复 ⇒ 该次触发以重跑结果为准）。
 * @param {object[]} runs 该 tip 上的全部 run（每条至少含 event/name/run_number/run_attempt）
 * @returns {object[]} 参与基准的 run（每个触发实例一条）
 */
function selectMainRuns (runs) {
  const latest = new Map()
  for (const r of runs || []) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue
    const event = String(r.event == null ? '' : r.event)
    // ⛔ 形状不认识 = 探针失明，不得静默通过（AGENTS 同型）：event 字段缺失时**抛错**，
    //    而不是「当作不是 workflow_run 放行」——那等于把"没读到事件类型"读成"它是主干自己的验证"。
    //    （深度评审 i5 建议「默认跳过未知形状以免恒定 SELF_FAULT」——**驳回**：那正是把失明读成安全。）
    //    另一类情形**不同**：「新事件类型」（非 workflow_run 的未知 event，如 GitHub 将来新增
    //    merge_group）不在排除名单里 ⇒ **自动进基准**，是安全侧，不会被丢弃。
    if (!event) throw new Error('actions/runs 的行缺 event 字段（形状变了，不得按「无检查」处理）：' + JSON.stringify(r).slice(0, 120))
    if (event === 'workflow_run') continue
    const name = String(r.name == null ? '' : r.name).trim()
    if (!name) continue
    // 分组键带 workflow 名：run_number 是**每个 workflow 各自**的计数器，跨 workflow 会撞号。
    const key = name + '|' + event + '|' + String(r.run_number)
    const prev = latest.get(key)
    if (!prev || isLaterRun(r, prev)) latest.set(key, r)
  }
  return [...latest.values()]
}

/**
 * 从「分支保护」与「rulesets」两份数据里取**必需检查**的名字并集（纯函数，可零网络单测）。
 *
 * 为什么必须两套都读（AGENTS「取证口径」）：GitHub 的 `branches/main/protection` 与 `rulesets`
 * **并存**，只查前者会得出「某检查不是 required」的假结论。本仓实测两份各自只列一部分：
 *   protection → `Gate Result, build, QG Unit Tests, QG Coverage`
 *   ruleset     → `QG Static, QG Unit Tests, electron-tests, 文档同步检查, 债务熔断检查, 单元测试 + Lint, GUI Gate Result`
 * 少读任何一份，都会把真正的必需检查当成可忽略的噪声 —— 那是**放松**判据，比噪声更危险。
 *
 * 为什么要按 required 收窄主干侧（2026-10-22 实测）：`mainRowsAt` 原先取该 tip 上**全部**非
 * `workflow_run` 作业的终态，于是 `Build & Release`、`Visual Tests`、`GUI Tests`、`QG Visual`、
 * `QG Desktop Shards`、`QG Browser E2E`、`QG Autonomous` 这些**非必需**的长跑项也参与"是否已完整跑完"
 * 的判定。实测后果：主干每 15–30 分钟前进一次、整条 quality-gate 要 44 分钟 ⇒ 一个"全部作业都已完成"
 * 的版本几乎不存在 ⇒ `mainBaseline` 沿链回溯 5 步也找不到绿基线 ⇒ 闸门常态 rc=3。
 * 两次真实卡点（同日）：PR #4219 在 3 小时内撞到 3 个不同 tip，每次都是"刚清零就被推走"。
 *
 * ⛔ 收窄的**只是主干侧**：PR 侧仍要求「全部检查零 pending、零 fail」，不放宽。
 * ⛔ 取不到 required 清单时返回 null（= 不过滤、维持原口径），**不得**返回空集——
 *    空集会把所有作业都滤掉，等于「主干没有检查」⇒ 恒绿。
 *
 * @param {any} protectionJson `GET branches/main/protection` 的响应（可为 null/失败）
 * @param {any[]} rulesetDetails 每个 ruleset 的详情响应数组（可为 null/失败）
 * @returns {Set<string>|null}
 */
function pickRequiredContexts (protectionJson, rulesetDetails) {
  const names = new Set()
  let sawAnySource = false
  const add = (v) => {
    const n = String(v == null ? '' : v).trim()
    if (n) names.add(n)
  }
  if (protectionJson && typeof protectionJson === 'object') {
    sawAnySource = true
    const rsc = protectionJson.required_status_checks
    if (rsc && Array.isArray(rsc.contexts)) rsc.contexts.forEach(add)
    // 新版 API 用 checks[]（含 context 字段），老版用 contexts[]；两者并存时都收。
    if (rsc && Array.isArray(rsc.checks)) rsc.checks.forEach((c) => add(c && c.context))
  }
  for (const d of Array.isArray(rulesetDetails) ? rulesetDetails : []) {
    if (!d || typeof d !== 'object') continue
    sawAnySource = true
    const rules = Array.isArray(d.rules) ? d.rules : []
    for (const rule of rules) {
      if (!rule || rule.type !== 'required_status_checks') continue
      const list = (rule.parameters && rule.parameters.required_status_checks) || []
      for (const item of Array.isArray(list) ? list : []) add(item && item.context)
    }
  }
  if (!sawAnySource) return null
  // 两份源都读到了、却一条 required 都没有 ⇒ 要么仓库真没设，要么形状变了。
  // 这时**不能**返回空集（会滤空一切而恒绿），按「取不到」处理，维持原口径。
  if (names.size === 0) return null
  return names
}

/** 默认取数：全部走 gh，失败即抛（由 main 转成退出码 4，不静默返回空数组） */
function createGhCollector (repo) {
  const run = (args) => {
    const r = cp.spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.error) throw new Error('gh 无法启动：' + r.error.message)
    if (r.status !== 0) throw new Error('gh ' + args.slice(0, 2).join(' ') + ' rc=' + r.status + ' err=' + String(r.stderr || '').slice(0, 300))
    return r.stdout
  }
  // git 与 gh 是两个程序，不能共用同一个 run()：第一版把 `rev-parse origin/main` 发给了 gh
  // ⇒ `unknown command "rev-parse" for "gh"` ⇒ 整道闸门恒 SELF_FAULT（同样是自己的 PR 上撞出来的）。
  const runGit = (args) => {
    const r = cp.spawnSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    if (r.error) throw new Error('git 无法启动：' + r.error.message)
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' rc=' + r.status + ' err=' + String(r.stderr || '').slice(0, 300))
    return r.stdout
  }
  // slug 解析必须能在「gh 的 host 键没配」时仍然成功：git remote 是本地可得的权威来源。
  const remoteUrl = (() => {
    const r = cp.spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })
    return r.status === 0 ? String(r.stdout || '').trim() : ''
  })()
  const resolved = resolveRepoSlug({
    explicit: repo,
    ghRepoEnv: process.env.GH_REPO,
    remoteUrl,
    fallback: REPO_DEFAULT,
  })
  if (!resolved.slug) throw new Error('无法确定 owner/repo（via=' + resolved.via + '）；可显式传 --repo <owner/repo>')
  if (resolved.via === 'fallback(必须是人显式认可的默认)') {
    console.log('MAIN-RED INFO 仓库 slug 取自代码内兜底常量 ' + resolved.slug + '（既无 --repo/GH_REPO 也解析不出 git remote）')
  }
  const slug = resolved.slug
  /** 按 sha 缓存 mainRowsAt 的结果（见 mainRowsAt 内的说明，CCG i2） */
  const rowsCache = new Map()
  /** required 清单只算一次（一次闸门运行内不变）；undefined=未取过，null=取不到 */
  let requiredCache
  return {
    repo: slug,
    slugVia: resolved.via,
    // ⛔ 读 origin/main 之前必须 fetch（第四轮 i1，Critical）：worktree 里的 remote-tracking ref 是
    //    **上一次 fetch 时的快照**。整段 diff 不 fetch，主干刚在远端变红时闸门就会把「远端已红」读成
    //    绿并 exit 0 放行——本片要防的那个失效被自己的前置条件重新打开。fetch 失败 ⇒ 抛错 ⇒ 4 档。
    mainSha: () => {
      runGit(['fetch', 'origin', 'main'])
      return String(runGit(['rev-parse', 'origin/main']).trim())
    },
    prHeadSha: (pr) => String(run(['pr', 'view', String(pr), '--json', 'headRefOid', '--jq', '.headRefOid']).trim()),
    /** 取某个 commit 上的全部检查（**仅用于 PR 侧**；主干侧改走 mainRowsAt，见下） */
    checksAt: (sha) => {
      const raw = run(['api', '--paginate', `repos/${slug}/commits/${sha}/check-runs`, '--jq',
        '.check_runs[]? | {name, status, conclusion}'])
      return parseCheckRunLines(raw)
    },
    /**
     * 必需检查清单（分支保护 + rulesets 并集）。取不到返回 null（= 不过滤）。
     *
     * 两套机制各自可能 403/404（免费仓不允许设 required checks、rulesets 需要更高权限），
     * 所以**逐源 try/catch**：任一成功就用它的结果，全失败才 null。
     * 这里刻意不抛错：主干侧读数的**其余**部分仍要能工作；抛错会让整个闸门退化成 rc=4，
     * 而"没有 required 清单"的正确降级是"回到原口径（全部作业）"，不是"闸门坏掉"。
     */
    requiredContexts: () => {
      if (requiredCache !== undefined) return requiredCache
      let protection = null
      let details = []
      try {
        protection = JSON.parse(run(['api', `repos/${slug}/branches/main/protection`]))
      } catch (_) { protection = null }
      try {
        const listRaw = run(['api', '--paginate', `repos/${slug}/rulesets?per_page=100`, '--jq',
          '.[]? | {id, target, enforcement}'])
        const list = parseJsonLines(listRaw, 'rulesets')
        for (const r of list) {
          // 只管分支规则且生效中的；tag 规则与 disabled/evaluate 不构成"必需"。
          if (!r || String(r.target) !== 'branch' || String(r.enforcement) !== 'active') continue
          const id = String(r.id == null ? '' : r.id).trim()
          if (!id) continue
          try {
            details.push(JSON.parse(run(['api', `repos/${slug}/rulesets/${id}`])))
          } catch (_) { /* 单个 ruleset 读不到就跳过，其它源仍可用 */ }
        }
      } catch (_) { details = [] }
      requiredCache = pickRequiredContexts(protection, details)
      return requiredCache
    },
    /**
     * 主干侧读数：**只取该 tip 的非 `workflow_run` run**，再取其**作业级**终态。
     *
     * 为什么不用 check-runs（2026-10-22 实测，这是本片的核心）：GitHub 把 `workflow_run`
     * 触发的工作流的 check run 一律挂在**默认分支当前 tip** 上，不管触发它的是哪个 PR 的 CI。
     * 实测主干 tip `8da92948` 上 102 条检查行里 **81 条**是同一个 `handle-ci-failure`
     * （来自 30 个 handler run），真实信号只有 21 行；闸门实测 `mainPending=4` 而真实未完成
     * 只有 2 条 —— 另外 2 条是噪声。噪声规模与 tip 存续时间成正比，于是「主干全绿」这个读数
     * 在多会话并发合并时**几乎拿不到**。
     *
     * 按 `event` 过滤是按语义过滤：今后任何新增的 `workflow_run` 触发的工作流都自动被排除，
     * 不需要人维护名字黑名单。行的形状仍是 `{name, status, conclusion}`，与 PR 侧同形，
     * 且都落在**作业名**这一层（check-run 名 == 作业名）⇒ 两侧的**行粒度**一致，差集按名字对齐。
     * ⛔ 但**不是「同一个 API」**（评审 i2 指出的自相矛盾处）：主干侧读 `actions/runs`，
     *    PR 侧读 `commits/<sha>/check-runs`。一致的是**粒度与名字集合**，不是取数端点。
     */
    mainRowsAt: (sha) => {
      // ⛔ 按 sha 缓存（CCG 深度评审 i2，Critical）：稳定窗最多尝试 3 轮，每轮都会重算
      //    mainBaseline（沿链最多 maxBack 条），而每条 mainRowsAt 是 1 次 actions/runs +
      //    N 次 actions/runs/{id}/jobs 的 N+1 请求。不缓存时 3 轮 × 5 条 × (1+N) 很容易
      //    把 gh 的速率配额打穿，而 429 会让闸门恒判 rc=4（自身故障）却无自愈路径。
      //    同一 sha 的 run/job 终态在同一分钟内不会变，缓存是安全的；跨进程不共享（无持久化）。
      if (rowsCache.has(sha)) return rowsCache.get(sha)
      const runsRaw = run(['api', '--paginate', `repos/${slug}/actions/runs?head_sha=${sha}&per_page=100`, '--jq',
        '.workflow_runs[]? | {id, name, event, run_number, run_attempt, updated_at, created_at}'])
      const runs = parseJsonLines(runsRaw, 'actions/runs')
      // 排除 workflow_run 触发 + 同一 workflow 取最新一次（纯函数，可单测）
      const chosen = selectMainRuns(runs)
      const rows = []
      for (const r of chosen) {
        const id = String((r && r.id) || '').trim()
        if (!id) throw new Error('actions/runs 的行缺 id（形状变了，不得按「无检查」处理）')
        const jobRaw = run(['api', `repos/${slug}/actions/runs/${id}/jobs?per_page=100`, '--jq',
          '.jobs[]? | {name, status, conclusion}'])
        for (const j of parseJsonLines(jobRaw, 'actions/runs/' + id + '/jobs')) rows.push(j)
      }
      // 只保留 required 检查参与「是否已完整跑完」的判定（见 pickRequiredContexts 的说明）。
      // required 为 null（取不到清单）时不过滤，维持原口径 —— 宁可慢，不可误判为绿。
      const required = this.requiredContexts()
      const scoped = required ? rows.filter((r) => required.has(String((r && r.name) || '').trim())) : rows
      rowsCache.set(sha, scoped)
      return scoped
    },
    /**
     * 主干基线（2026-10-22 阶段 1）：沿第一父链回溯 `maxBack` 个提交，取**最后一次完整跑完**的那一版。
     *
     * 为什么不能读 tip：tip 每 15–30 分钟前进一次、整条 quality-gate 要 44 分钟
     * ⇒「全部检查已完成」的窗口期望时长为负 ⇒ 闸门常态 rc=3。
     * 判据本体的顺序与 fail-closed 口径全在纯函数 `pickBaseline` 里（可零网络单测）。
     *
     * @param {{tip?:string, maxBack?:number, maxStale?:number}} [opts]
     * @returns {{kind:'green'|'red'|'too-stale'|'unknown', sha:(string|null), staleness:number, rows:object[]}}
     */
    mainBaseline (opts = {}) {
      // maxBack=5：真机实测只需往回 **1–2 步**即可命中绿基线（2026-10-22：
      // tip 3621894d4 pending ⇒ 跳过零 run 的 85dc44ddc ⇒ 5fe06ef1a 命中 green，staleness=2）。
      // 取 5 而不是 12 是请求预算考量（CCG i2）：最坏（全程 pending）时少查 7 条链，
      // 每条是 1 次 actions/runs + N 次 jobs 的 N+1 请求。窗口内无绿时行为不变（fail-closed rc=3）。
      const maxBack = opts.maxBack == null ? 5 : opts.maxBack
      const maxStale = opts.maxStale == null ? 3 : opts.maxStale
      // 第一父链：只看主干自己的提交序列，不跟进 merge 进来的旁支
      const raw = runGit(['rev-list', '--first-parent', 'origin/main', '-n', String(maxBack)])
      const chain = String(raw == null ? '' : raw).trim().split('\n').map((s) => s.trim()).filter(Boolean)
      // ⛔ 链为空不得当成「没有红」：正是 tip 取不到读数的形态 ⇒ 交给 pickBaseline 判 unknown
      // 注：这里必须用**方法简写**而非箭头函数——箭头函数没有自己的 this，
      //     `this.mainRowsAt` 会取到外层（模块级）的 this ⇒ undefined ⇒ 运行期 TypeError。
      return pickBaseline({ chain, rowsAt: (sha) => this.mainRowsAt(sha), maxStale })
    },
  }
}

/** 可等待的休眠（稳定窗重试用；测试里传 0 秒） */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 取一次**稳定**的主干读数，再交给判据。
 *
 * 为什么要「稳定窗」（2026-10-22 实测）：闸门读的是「此刻的 origin/main tip」，而主干 tip
 * 在多会话并发合并下每 15–30 分钟前进一次。实测一次读数期间 tip 从 `2f5c0a32f` 移到
 * `8da92948` —— 那次读数整个作废（主干基准与 PR 读数不在同一棵树上，差集不可归因）。
 * 旧实现只读一次判一次，合并入口拿不到读数就 FAIL，让人从头重跑脚本。
 *
 * 纪律：**不得**把 tip 钉死在旧 sha 上继续判绿——旧 tip 的绿不代表现在的主干绿。
 */
async function main (argv, collector) {
  const opts = parseArgs(argv)
  const c = collector || createGhCollector(opts.repo)
  // ⛔ 采集层必须提供 mainRowsAt：主干基准来自「该 tip 的非 workflow_run run 集合」。
  //    **不得**静默回落到 checksAt（那是噪声源：实测 102 条检查行里 81 条是 handle-ci-failure）。
  if (typeof c.mainRowsAt !== 'function') {
    console.log('MAIN-RED verdict=SELF_FAULT exit=4 reason=采集层没有 mainRowsAt 接口：主干基准必须读该 tip 的非 workflow_run run 集合，不得回落到 check-runs')
    return 4
  }
  // ⛔ 采集层必须提供 mainBaseline（2026-10-22 阶段 1）：主干侧读数不再取自 tip，
  //    而取自「最后一次完整跑完的那一版」。缺少它就 fail-closed，**不得**静默回落到
  //    「直接读 tip」——那会把本判据存在的理由（窗口常态为负）原样退回。
  if (typeof c.mainBaseline !== 'function') {
    console.log('MAIN-RED verdict=SELF_FAULT exit=4 reason=采集层没有 mainBaseline 接口：主干基准必须沿链回溯到「最后一次完整结论」，不得回落到当前 tip')
    return 4
  }
  let last = null
  let baseline = null
  let moved = null
  const moves = []
  let stable = false
  let waited = 0
  let lastError = null
  // 生效参数必须被打印（深度评审 i4）：环境变量透传过来的 attempts/retry-seconds 若被误设，
  // 现场必须能看出这一轮**实际**用了什么，否则「生效值」只有设值的人知道。
  console.log('MAIN-RED 稳定窗 attempts=' + opts.attempts + ' retry-seconds=' + opts.retrySeconds
    + ' max-wait-seconds=' + opts.maxWaitSeconds)
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    let shaBefore
    let mainRows
    let prSha
    let prRows
    let shaAfter
    try {
      shaBefore = c.mainSha()
      // 阶段 1：主干行取自「最后一次完整结论」，而不是 tip。
      // tip 上有检查在跑不再是否决条件——这正是本判据存在的理由（窗口常态为负）。
      baseline = c.mainBaseline({ tip: shaBefore })
      mainRows = baseline.rows
      prSha = c.prHeadSha(opts.pr)
      prRows = c.checksAt(prSha)
      shaAfter = c.mainSha()
    } catch (e) {
      // 取数失败（fetch 抖动 / 429 / token 失效…）**不立刻判 rc=4**：先在预算内重试
      // （深度评审 i5）——一次网络抖动不该把「普通故障」写成「闸门自身故障」。
      lastError = e
      console.log('MAIN-RED COLLECT-FAIL attempt=' + attempt + '/' + opts.attempts
        + ' reason=' + ((e && e.message) || String(e)))
      if (attempt < opts.attempts && waited + opts.retrySeconds <= opts.maxWaitSeconds) {
        await sleep(opts.retrySeconds * 1000)
        waited += opts.retrySeconds
        continue
      }
      break
    }
    last = { mainSha: shaBefore, prSha, mainRows, prRows }
    if (shaBefore === shaAfter) { stable = true; break }
    // 读数期间主干 tip 移动 ⇒ 本次读数作废
    moved = { from: shaBefore, to: shaAfter }
    moves.push(moved)
    console.log('MAIN-RED STALE attempt=' + attempt + '/' + opts.attempts
      + ' main=' + String(shaBefore).slice(0, 9) + '→' + String(shaAfter).slice(0, 9)
      + ' 读数作废：主干在读数期间移动')
    if (attempt >= opts.attempts) break
    // ⛔ 总等待上限（评审 i4）：`attempts × retry-seconds` 是可传的，没有上限就等于
    //    「重试」可以无限睡。超过上限就停手，把这一档按未证实交出去（不静默延长）。
    //    默认算术：3 次尝试 ⇒ **最多 2 次等待** ⇒ 2 × 90s = 180s，与 maxWaitSeconds 默认值相等
    //    （上限在默认档**刚好**咬住，不再是「配了一个永远咬不到的数字」）。
    if (waited + opts.retrySeconds > opts.maxWaitSeconds) {
      console.log('MAIN-RED STABLE-WAIT-CAP 累计等待 ' + waited + 's + 本次 ' + opts.retrySeconds
        + 's 超过上限 ' + opts.maxWaitSeconds + 's ⇒ 停止重试，本次读数按未证实处理')
      break
    }
    await sleep(opts.retrySeconds * 1000)
    waited += opts.retrySeconds
  }
  if (!last) {
    console.log('MAIN-RED verdict=SELF_FAULT exit=4 reason=' + ((lastError && lastError.message) || '取数失败'))
    return 4
  }
  const v = judge({
    prRows: last.prRows,
    mainRows: last.mainRows,
    allowMainRed: opts.allowMainRed,
    mainMoved: stable ? null : moved,
  })
  console.log(readout(v, { mainSha: last.mainSha, prSha: last.prSha, allowMainRed: opts.allowMainRed, baseline }))
  if (moves.length) {
    console.log('  稳定窗：读数期间主干移动 ' + moves.length + ' 次（'
      + moves.map((m) => String(m.from).slice(0, 9) + '→' + String(m.to).slice(0, 9)).join('，')
      + '）' + (stable ? '；最终取到稳定读数（本次判定基于最后一次读数）' : '；重试耗尽，本次读数按未证实处理'))
  }
  if (v.reason) console.log('  理由：' + v.reason)
  if (v.verdict === 'NEW_RED') console.log('  新增红（差集）：' + v.newRed.join(', '))
  // 只要主干有红就把名单念出来（第五轮 C3 的可见面）：原先只在 STOP_MAIN_RED 那档打印，
  // 于是「按归因放行」那条路径上，其余没人点名的红连名字都不出现在 stdout 里——豁免现场仍然缺失。
  if (v.mainFail && v.mainFail.length > 0) console.log('  主干失败格子：' + v.mainFail.join(', ') + ' ｜ 本次点名豁免 ' + ((v.allowed || []).length) + ' 条 ｜ 主干 sha ' + last.mainSha)
  console.log('  局限：差集按检查名对齐，同名红只证明"主干上也红过"，不证明是同一条用例；STOP_MAIN_RED 的出口只能是有人修 main。')
  if (opts.json) {
    console.log(JSON.stringify({
      verdict: v.verdict, exit: v.code, newRed: v.newRed || [], inherited: v.inherited || [],
      mainFail: v.mainFail || [], counts: v.counts, mainSha: last.mainSha, prSha: last.prSha,
      stable, moves: moves.map((m) => ({ from: m.from, to: m.to })),
    }))
  }
  return v.code
}

async function run (argv, collector) {
  try {
    return await main(argv, collector)
  } catch (e) {
    // 参数错误与取数失败共用「自身故障」档（rc=4）：把"我没跑成"读成"没有红"是本仓装饰性门禁的同型
    console.log('MAIN-RED verdict=SELF_FAULT exit=4 reason=' + ((e && e.message) || String(e)))
    return 4
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code })
}

// parseCheckRunLines 必须可单独被测：它是「宿主输出 → 判据输入」那一层的唯一入口，
// 藏在一个需要真 gh 的闭包里就只能靠集成跑，而那类跑一次要几十秒、还依赖模型额度。
module.exports = { main, run, parseArgs, createGhCollector, parseCheckRunLines, parseJsonLines, isLaterRun, pickRequiredContexts, selectMainRuns }
