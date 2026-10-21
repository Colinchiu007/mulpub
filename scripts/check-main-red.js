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
 */
const path = require('node:path')
const cp = require('node:child_process')
const { judge, readout, resolveRepoSlug } = require('./lib/main-red')

const REPO_DEFAULT = 'Colinchiu007/mulpub'

function parseArgs (argv) {
  const out = { pr: null, allowMainRed: null, json: false, repo: null }
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
    unclaimed.push(a)
  }
  // 未知旗标与非法取值一律出声并走"自身故障"档（AGENTS：参数不得静默忽略——一次 --limit 4 被丢弃
  // 就把 smoke 放大成整域，同一个错法在这里会让"我以为我豁免了"变成"其实没豁免"）
  if (unclaimed.length) throw new Error('未知参数：' + unclaimed.join(' ') + '（本判据只接 --pr/--allow-main-red/--json/--repo）')
  if (!out.pr) throw new Error('缺 --pr <编号>')
  if (!/^\d+$/.test(String(out.pr))) throw new Error('--pr 必须是数字 PR 编号，实到 ' + out.pr)
  if (out.allowMainRed !== null && out.allowMainRed === '') throw new Error('--allow-main-red 必须带归因文本（空串等于没豁免，别用它静默放行）')
  return out
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
  const text = String(raw == null ? '' : raw)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  // 上一版在这里抛错，于是 judge() 的「零检查 ⇒ INCOMPLETE(3)」档在生产里**永不可达**：写了档位
  // 却永远不会走到，那是一条装饰性分支。宿主真失败另有去路——gh 非零 rc 由 execSync 抛出 ⇒ 4 档。
  if (lines.length === 0) return []
  const rows = []
  for (const [i, line] of lines.entries()) {
    let item
    try { item = JSON.parse(line) } catch (e) {
      throw new Error('check-runs 第 ' + (i + 1) + ' 行不是 JSON 对象（形状变了，不得按「无红」处理）：' + line.slice(0, 80))
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('check-runs 第 ' + (i + 1) + ' 行不是对象（数组与标量都不接受）')
    }
    rows.push(item)
  }
  return rows
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
    /** 取某个 commit 上的全部检查（PR 侧与 main 侧**同一个 API、同一种形状**，避免两侧口径天然不等） */
    checksAt: (sha) => {
      const raw = run(['api', '--paginate', `repos/${slug}/commits/${sha}/check-runs`, '--jq',
        '.check_runs[]? | {name, status, conclusion}'])
      // PR 侧与主干侧走同一个解析函数，两侧口径不可能天然不等。
      return parseCheckRunLines(raw)
    },
  }
}

async function main (argv, collector) {
  const opts = parseArgs(argv)
  const c = collector || createGhCollector(opts.repo)
  let gathered
  try {
    const mainSha = c.mainSha()
    const prSha = c.prHeadSha(opts.pr)
    gathered = {
      mainSha,
      prSha,
      mainRows: c.checksAt(mainSha),
      prRows: c.checksAt(prSha),
      allowMainRed: opts.allowMainRed,
    }
  } catch (e) {
    console.log('MAIN-RED verdict=SELF_FAULT exit=4 reason=' + ((e && e.message) || String(e)))
    return 4
  }
  const v = judge({ prRows: gathered.prRows, mainRows: gathered.mainRows, allowMainRed: gathered.allowMainRed })
  console.log(readout(v, { mainSha: gathered.mainSha, prSha: gathered.prSha, allowMainRed: gathered.allowMainRed }))
  if (v.reason) console.log('  理由：' + v.reason)
  if (v.verdict === 'NEW_RED') console.log('  新增红（差集）：' + v.newRed.join(', '))
  // 只要主干有红就把名单念出来（第五轮 C3 的可见面）：原先只在 STOP_MAIN_RED 那档打印，
  // 于是「按归因放行」那条路径上，其余没人点名的红连名字都不出现在 stdout 里——豁免现场仍然缺失。
  if (v.mainFail && v.mainFail.length > 0) console.log('  主干失败格子：' + v.mainFail.join(', ') + ' ｜ 本次点名豁免 ' + ((v.allowed || []).length) + ' 条 ｜ 主干 sha ' + gathered.mainSha)
  console.log('  局限：差集按检查名对齐，同名红只证明"主干上也红过"，不证明是同一条用例；STOP_MAIN_RED 的出口只能是有人修 main。')
  if (opts.json) console.log(JSON.stringify({ verdict: v.verdict, exit: v.code, newRed: v.newRed || [], inherited: v.inherited || [], mainFail: v.mainFail || [], counts: v.counts, mainSha: gathered.mainSha, prSha: gathered.prSha }))
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
module.exports = { main, run, parseArgs, createGhCollector, parseCheckRunLines }
