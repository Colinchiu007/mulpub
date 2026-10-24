#!/usr/bin/env node
'use strict'
/**
 * 假想 enforce 扫描（change: qm6-tier-watermark 半片 2）。
 *
 * 回答一个问题：**今天把 CI 里那一步从 --mode=advisory 翻成 enforce，会红哪几条在飞 PR。**
 * 用户裁决「暂不翻，等水位」，但翻之前这个名单必须拿得出来，否则"等水位"只是拖延的另一个说法。
 *
 * 三条承重（改动前先读 design.md 对应节）：
 *  - D6 合成合并（merge-tree → commit-tree → worktree add → 跑判据 → remove）**只允许有一份实现**，
 *    就是 debt-recheck-live.js 的 mergedTreeEvidence。本文件因此不出现这三个词的字面量，
 *    由一条结构锁 + 一条身份锁（materialize === mergedTreeEvidence）双向钉住。
 *  - D8 免责标注必须早于任何 pr= 行：这个工具不是门禁，真实拦截只发生在 CI 的 QG Changes。
 *    把"没跑出来红"读成"会绿"是本仓「装饰性门禁」的同型。
 *  - D9 三档退出码：0 全判完 / 1 至少一条会红（那是产出）/ 2 工具自身故障。
 *    "零条在飞"打 prs=0 (none-open) 退 0，与"列不出来"的 2 必须不同形。
 *
 * 只读：不写仓库、不改任何 PR、不合并任何东西。网络只经 gh 取 PR 列表与 git fetch 取 PR 头。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { gitRunner, gitSafeEnv } = require('./lib/debt-recheck-live.js')
const { isOid, excerptOf } = require('./lib/debt-recheck-core.js')

const DISCLAIMER = 'PREVIEW-NOT-GATE：本读数不替代 CI 的 QG Changes；enforce 的真判决只发生在 CI（本工具在合成合并态里预估，仅供裁决用）'
const DEFAULT_MAX = 40
const LOCK_NAME = 'qm6-enforce-preview.lock.json'
// 锁的年龄上限：一轮 30 条按实测 74.7 秒/条要 37 分钟，留 2 倍余量。
// 没有这一格时，PID 被别的进程复用会把后来者永久拒在门外（评审 i5）。
const DEFAULT_LOCK_AGE_MS = 45 * 60 * 1000

function parseArgs (argv) {
  const out = { repo: process.cwd(), ref: 'origin/main', max: DEFAULT_MAX, defectMax: null, keep: false, only: null }
  for (const a of argv) {
    if (a.startsWith('--repo=')) out.repo = a.slice(7) || process.cwd()
    else if (a.startsWith('--ref=')) out.ref = a.slice(6)
    else if (a.startsWith('--only=')) {
      // 复跑少数几条取归因用：全量一轮要几十分钟，而红因只在"会红"那几条上才需要看。
      // 非法项必须出声而不是静默丢掉（丢一条就等于那一条永远不进名单）。
      const raw = a.slice(7)
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
      const nums = parts.filter((s) => /^\d+$/.test(s)).map(Number)
      out.only = nums
      if (nums.length !== parts.length) out.defectOnly = parts.filter((s) => !/^\d+$/.test(s)).join(',')
    } else if (a.startsWith('--max=')) {
      const raw = a.slice(6)
      if (/^-?\d+$/.test(raw.trim()) && Number(raw.trim()) >= 0) out.max = Number(raw.trim())
      else { out.max = DEFAULT_MAX; out.defectMax = raw }
    } else if (a === '--keep-refs') out.keep = true
    else throw new Error('未知旗标 ' + a + '（本工具只认 --repo= / --ref= / --max= / --only= / --keep-refs）')
  }
  return out
}

/** 被测判据的命令行。--no-remote 是合同的一部分：预览必须能在无 gh 凭据的机器上跑完。 */
function buildCheckerCommand ({ dir, baseSha, checker }) {
  return [process.execPath, checker, '--base=' + baseSha, '--head=HEAD', '--mode=enforce', '--no-remote']
}

function defaultGh (args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { rc: r.status === null ? 127 : r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }
}

function lockFile () { return path.join(os.tmpdir(), LOCK_NAME) }

/**
 * 单实例锁。四条不对称，每条都对应一种"看起来安全其实不安全"：
 *  - 活锁必须**点名持有者 PID 与命令行**（否则运维只能靠猜）；
 *  - 陈旧锁必须被接管（否则一次异常退出把自己永久焊死）；
 *  - **只看 PID 存活不够**：PID 会被复用，一个毫不相干的进程顶住锁会永远拒跑 ⇒ 还要核命令行里是不是本工具；
 *  - 但也不能"命令行不像就抢"：本机跑着的别的 node 进程可能恰好同名片段 ⇒ 必须同时看锁的**年龄**，
 *    超过 ageLimitMs（一轮 30 条实测可达 70 分钟，故默认 4 小时）才允许接管，且把年龄打出来。
 */
function acquireLock (opts) {
  const o = opts || {}
  const file = o.file || lockFile()
  const now = typeof o.now === 'function' ? o.now : (() => Date.now())
  const ageLimitMs = typeof o.ageLimitMs === 'number' ? o.ageLimitMs : DEFAULT_LOCK_AGE_MS
  const scriptHint = o.scriptHint || 'qm6-enforce-preview'
  const readHolder = o.readHolder || (() => { try { return fs.readFileSync(file, 'utf8') } catch { return '' } })
  const pidAlive = o.pidAlive || ((p) => { try { process.kill(p, 0); return true } catch { return false } })
  const selfPid = o.selfPid || process.pid
  const write = o.write || ((text) => { try { fs.writeFileSync(file, text); return true } catch { return false } })
  const existing = readHolder()
  let takenOver = ''
  if (existing) {
    const m = existing.match(/PID=(\d+)/)
    const holderPid = m ? Number(m[1]) : null
    const mine = existing.includes(scriptHint)
    let ageMs = Number.NaN
    const ts = existing.match(/START=(\d+)/)
    if (ts) ageMs = now() - Number(ts[1])
    const alive = holderPid !== null && holderPid !== selfPid && pidAlive(holderPid)
    if (alive && mine && Number.isFinite(ageMs) && ageMs <= ageLimitMs) {
      return {
        ok: false,
        takenOver: '',
        message: '已有实例在跑（PID=' + holderPid + ' 年龄=' + Math.round(ageMs / 1000) + 's，上限='
          + Math.round(ageLimitMs / 1000) + 's），本工具会在 tmp 下建检出目录，两个实例并存会互相清理对方的。'
          + '持有者命令行=' + existing.split('\n')[0].slice(0, 160),
      }
    }
    // 接管原因必须进返回值（不只是 console）：否则"它为什么放开了这把看着还活的锁"
    // 在测试与调用方两侧都不可断言，而这正是 i5 要防的那一格。
    takenOver = !mine ? 'not-mine'
      : (!Number.isFinite(ageMs) ? 'no-start' : 'age=' + Math.round(ageMs / 1000) + 's')
    if (alive) {
      console.log('[qm6-enforce-preview] 接管一把看起来仍活着的锁：' + takenOver
        + '（PID=' + holderPid + '；上限=' + Math.round(ageLimitMs / 1000) + 's）')
    }
  }
  const wrote = write('PID=' + selfPid + ' START=' + now() + ' ' + process.argv.join(' ') + '\n')
  if (!wrote) {
    return { ok: false, takenOver, message: '锁文件写不下去（' + file + '）⇒ 无法保证单实例，拒绝运行而不是并发跑' }
  }
  return { ok: true, file, takenOver, message: '' }
}

function releaseLock (file) { try { fs.unlinkSync(file) } catch { /* 已被接管或本就不可写：不冒泡 */ } }

/** 默认闭包：不注入替身时走的那条路。身份锁（测试 §H）核对的就是这一份。 */
function defaultsFor (repo) {
  const git = gitRunner(repo)
  return {
    repo,
    gh: defaultGh,
    git,
    fetchHead: ({ number }) => {
      const refspec = '+refs/pull/' + number + '/head:refs/preview/pr-' + number
      const f = git(['fetch', '-q', 'origin', refspec])
      if (f.rc !== 0) return { rc: f.rc, sha: '', stderr: f.stderr }
      const h = git(['rev-parse', 'refs/preview/pr-' + number])
      return { rc: h.rc, sha: String(h.stdout || '').trim(), stderr: h.stderr }
    },
    materialize: require('./lib/debt-recheck-live.js').mergedTreeEvidence,
    runChecker: ({ dir, baseSha, headSha }) => {
      const checker = path.join(dir, 'scripts', 'check-pr-exec-record.js')
      const cmd = buildCheckerCommand({ dir, baseSha, checker })
      // 判据本体不在盘上（改名/搬家）时，`node <不存在的路径>` 退的是 **1** —— 而 1 在本工具里是"这条会红"。
      // 那会把"工具读不到判据"记成一条谁也修不动的债（评审 i6 的采纳半截：它担心"无法运行"，
      // 真后果更糟，是"能运行并报假红"）。所以先认存在性，缺席一律走"判不了"这一档并点名。
      // cmd 照原样带回：归因现场必须写清"它本来想跑的是哪条命令"，只给两个词的 cmd 会让人以为是命令拼错。
      if (!fs.existsSync(checker)) {
        return { cmd, rc: 2, stdout: '', stderr: 'checker-missing: ' + checker }
      }
      const r = spawnSync(cmd[0], cmd.slice(1), {
        cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: subjectEnv().env,
      })
      return { cmd, rc: r.status === null ? 2 : r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }
    },
    cleanup: ({ number }) => { git(['update-ref', '-d', 'refs/preview/pr-' + number]) },
  }
}

/**
 * 从合成合并的返回值里取判据读数。
 * ⚠ 形状不是"inspect 的返回值摊平在顶层"——真实实现 `mergedTreeEvidence` 把它挂在
 * **`baseline` 键**下（同它自己的 `aTxt` 并列）。本机首跑就是被这一格打回原形：
 * 替身把返回值摊平了，于是 13 条锁全绿、真跑时每条 PR 都归成 `unexpected-exit-undefined`。
 * 这是本仓「契约夹具不得替对方剥壳」的第 4 种落点，测试 §N/§O 用**真 mergedTreeEvidence**
 * 配假 git 钉住这个形状，不再靠假夹具自证。
 */
function readVerdict (merged) {
  const inside = merged && merged.baseline
  if (!inside || typeof inside !== 'object') return { rc: undefined, stdout: '', stderr: '' }
  return inside
}

/**
 * 会红的那条必须**说出为什么**。只贴判据的 TIER-COVERAGE 行是不够的：
 * 本机首跑就出现 `dual-closed total=0` 却判红的条目 —— 那条红来自别的欠账，
 * 而读数里看不见它，拿这份名单去拍"能不能翻 enforce"就会拍错方向。
 * 判据退 1 但输出里没有点名行时，必须显式说"未点名"，不得留空让人自己猜。
 */
const RED_POINTING_RE = /(BLOCKED|欠账|未闭合|缺记录|不得合并|未带出处|TIER-MATRIX|^[-\u2022]\s)/

function blockingReasons (text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const hits = lines.filter((l) => RED_POINTING_RE.test(l))
  if (hits.length) return hits.join(' ⏎ ').slice(0, 300)
  const tail = lines.length ? lines[lines.length - 1].replace(/\r$/, '').slice(0, 160) : '<空输出>'
  return '<未点名：判据退 1 但输出里没有判决行（TRANSITION-CHECK 是测量行，不算判决行）⇒ 末行=' + tail + '；去 CI 看原文，不得据此条推定红因>'
}

/** 判据的退出码 → 本工具的归因。判据退 2 是"它自己没取证成功"，不得读成"这条会红"。 */
const EMPTY_CHANGESET_RE = /变更集为空或取证失败|无法判定本 PR 是否携带执行记录/
function attribute (rc, stdoutText) {
  if (rc === 0) return { verdict: 'WOULD-BE-OK' }
  if (rc === 1) {
    // 判据自己报「变更集为空或取证失败」= 它没取到 diff，不是这条 PR 缺东西。
    // 把工具的失明记成会红，名单就会多出一条谁也修不动的红（本机实测 pr=4285）。
    if (EMPTY_CHANGESET_RE.test(String(stdoutText || ''))) return { verdict: 'UNJUDGEABLE', reason: 'empty-changeset' }
    return { verdict: 'WOULD-BE-RED' }
  }
  if (rc === 2) return { verdict: 'UNJUDGEABLE', reason: 'self-check-fault' }
  return { verdict: 'UNJUDGEABLE', reason: 'unexpected-exit-' + String(rc) }
}

/** PR 号必须是纯数字：它会进 refspec 与命令行，形态先收口（评审 i5 的采纳半截）。 */
function validPrNumber (n) { return Number.isInteger(n) && n > 0 }

/**
 * 被测代码的环境白名单裁剪（评审轮 5 i2 的采纳）。
 * 这条链跑的是**被评估那个 PR 自己树上的** `scripts/check-pr-exec-record.js`，
 * 而 spawn 默认继承父环境 ⇒ 操作者 shell 里的令牌会原样交进一段尚未评审的代码。
 * `gitSafeEnv()` 只剥 GIT_* 那一族（它防的是测量对象被污染，不是防凭证外泄），
 * 所以这里在它之上再按**键名形态**剥一轮。判据本体不需要任何凭证（`--no-remote` 是合同的一部分），
 * 因此"少给"不会改变判决，只会改变爆炸半径。
 */
const SUBJECT_ENV_DENY_RE = /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|APIKEY|API_KEY|KEY|AUTH|COOKIE|SESSION)(_|$)/i
function subjectEnv (env) {
  const base = gitSafeEnv(env).env
  const out = {}
  let stripped = 0
  for (const k of Object.keys(base)) {
    if (SUBJECT_ENV_DENY_RE.test(k)) { stripped++; continue }
    out[k] = base[k]
  }
  return { env: out, stripped }
}

function preview (opts) {
  const o = opts || {}
  const d = Object.assign({}, defaultsFor(o.repo || process.cwd()), o)
  const out = []
  const err = []
  // 逐行交付：跑 30 条时要十几分钟，全攒到最后一次性打印就等于"卡住了也没人知道"。
  // 返回值里仍然带完整 stdout（测试与"重定向到文件"的用法都靠它），两条通道必须同序同源。
  const emit = (s) => {
    out.push(s)
    if (typeof o.onLine === 'function') o.onLine(s)
  }
  emit(DISCLAIMER)
  if (o.defectMax) emit('  --max 取值非法（' + o.defectMax + '）⇒ 回落默认 ' + DEFAULT_MAX + '（设错了要被知道，不是没设）')
  // --only 的非法项**不回落**，直接拒跑（与 --max 刻意不对称）：
  // --max 回落 = 多判（判得更宽，不会让人误以为"我已经判过那条了"）；
  // --only 丢掉一项 = 少判一条，而汇总行读起来完全像"圈定的都判完了"。
  // 中文逗号那类手误会让 only 退化成空集 ⇒ 整轮只报 prs=0，正是本仓"不得把工具的失明读成结论"那一格。
  if (o.defectOnly) {
    emit('PREVIEW-SELF-FAULT --only 含非数字项（' + o.defectOnly + '）⇒ 拒绝运行（不是丢掉它继续判）')
    emit('  丢掉一项等于少判一条，而汇总行看着像判完；正解：把非法项改成 PR 号原样重跑（分隔符只认 ASCII 逗号）。')
    emit(DISCLAIMER)
    return { exitCode: 2, stdout: out.join('\n') + '\n', stderr: err.join('\n') }
  }

  const base = d.git(['rev-parse', o.ref || 'origin/main'])
  const baseSha = String(base.stdout || '').trim()
  if (base.rc !== 0 || !isOid(baseSha)) {
    emit('PREVIEW-SELF-FAULT ref=' + (o.ref || 'origin/main') + ' 解析失败 ⇒ 没有 base 就没有"翻上去"的参照')
    emit(DISCLAIMER)
    return { exitCode: 2, stdout: out.join('\n') + '\n', stderr: err.join('\n') }
  }

  const listed = d.gh(['pr', 'list', '--state', 'open', '--json', 'number,headRefName'])
  let prs = null
  if (listed.rc === 0) { try { prs = JSON.parse(listed.stdout || '[]') } catch { prs = null } }
  if (!Array.isArray(prs)) {
    emit('PREVIEW-SELF-FAULT gh pr list 取不到（rc=' + listed.rc + '）：' + String(listed.stderr || listed.stdout).split('\n')[0])
    emit('  ⇒ 这**不是**"没有在飞 PR"。缺席不得读成通过（design D9）。')
    emit(DISCLAIMER)
    return { exitCode: 2, stdout: out.join('\n') + '\n', stderr: err.join('\n') }
  }
  if (prs.length === 0) {
    emit('PREVIEW-SUMMARY prs=0 (none-open) base=' + baseSha.slice(0, 10) + ' WOULD-BE-RED=0 WOULD-BE-OK=0 UNJUDGEABLE=0')
    emit(DISCLAIMER)
    return { exitCode: 0, stdout: out.join('\n') + '\n', stderr: err.join('\n') }
  }
  let list = prs
  if (Array.isArray(o.only) && o.only.length) {
    const have = new Set(prs.map((p) => (p && p.number)))
    const missing = o.only.filter((n) => !have.has(n))
    list = prs.filter((p) => o.only.includes(p && p.number))
    emit('  --only 圈定 ' + list.length + '/' + o.only.length + ' 条'
      + (missing.length ? '；这些号不在当前 open 列表（已合并/已关/取不到）：' + missing.join(',') : '')
      + '（点名缺失，不得静默少判一条）')
    if (list.length === 0) {
      emit('PREVIEW-SUMMARY prs=0 (only-none-open) base=' + baseSha.slice(0, 10) + ' WOULD-BE-RED=0 WOULD-BE-OK=0 UNJUDGEABLE=0')
      emit(DISCLAIMER)
      return { exitCode: 0, stdout: out.join('\n') + '\n', stderr: err.join('\n') }
    }
  }
  const max = typeof o.max === 'number' ? o.max : DEFAULT_MAX
  const considered = list.slice(0, max)
  if (list.length > considered.length) emit('  --max=' + max + ' 截断：还有 ' + (list.length - considered.length) + ' 条未判，**不得**把本轮读成全量')

  const tally = { 'WOULD-BE-RED': 0, 'WOULD-BE-OK': 0, 'UNJUDGEABLE': 0 }
  for (const pr of considered) {
    const t0 = Date.now()
    const number = pr && pr.number
    if (!validPrNumber(number)) {
      tally.UNJUDGEABLE += 1
      emit('pr=<unreadable> 归因=UNJUDGEABLE reason=pr-number 摘入=' + excerptOf({ stdout: JSON.stringify(pr) }) + ' ms=' + (Date.now() - t0))
      continue
    }
    const head = d.fetchHead({ number })
    if (!head || head.rc !== 0 || !head.sha) {
      tally.UNJUDGEABLE += 1
      emit('pr=' + number + ' 归因=UNJUDGEABLE reason=ref-missing 摘录=' + excerptOf({ stderr: head && head.stderr }) + ' ms=' + (Date.now() - t0))
      continue
    }
    if (!isOid(head.sha)) {
      tally.UNJUDGEABLE += 1
      emit('pr=' + number + ' 归因=UNJUDGEABLE reason=head-shape 摘录=' + excerptOf({ stdout: head.sha }) + ' ms=' + (Date.now() - t0))
      continue
    }
    const merged = d.materialize({
      repo: d.repo, baseSha, headSha: head.sha, number, git: d.git,
      inspect: (dir) => d.runChecker({ dir, baseSha, headSha: head.sha, number }),
    })
    if (!merged || merged.built !== true) {
      tally.UNJUDGEABLE += 1
      emit('pr=' + number + ' 归因=UNJUDGEABLE reason=' + ((merged && merged.reason) || 'unknown-shape')
        + (merged && merged.stage ? ' stage=' + merged.stage : '') + ' ms=' + (Date.now() - t0))
      if (!o.keep && d.cleanup) d.cleanup({ number })
      continue
    }
    const v = readVerdict(merged)
    const a = attribute(v.rc, v.stdout)
    tally[a.verdict] += 1
    const line = 'pr=' + number + ' 归因=' + a.verdict + (a.reason ? ' reason=' + a.reason : '') + ' ms=' + (Date.now() - t0)
    const why = a.verdict === 'WOULD-BE-RED' ? blockingReasons(v.stdout) : ''
    emit(line + (why ? ' 红因=' + why : ''))
    if (!o.keep && d.cleanup) d.cleanup({ number })
  }
  emit('PREVIEW-SUMMARY prs=' + considered.length + ' base=' + baseSha.slice(0, 10) +
    ' WOULD-BE-RED=' + tally['WOULD-BE-RED'] + ' WOULD-BE-OK=' + tally['WOULD-BE-OK'] + ' UNJUDGEABLE=' + tally.UNJUDGEABLE)
  emit(DISCLAIMER)
  const red = tally['WOULD-BE-RED'] > 0
  return { exitCode: red ? 1 : 0, stdout: out.join('\n') + '\n', stderr: err.join('\n') + '\n' }
}

function main (argv) {
  const args = parseArgs(argv)
  const lock = acquireLock({})
  if (!lock.ok) {
    process.stdout.write('PREVIEW-SELF-FAULT 单实例锁：' + lock.message + '\n')
    return 2
  }
  try {
    const r = preview(Object.assign({}, args, {
      onLine: (l) => process.stdout.write(l + '\n'),
    }))
    if (r.stderr.trim()) process.stderr.write(r.stderr)
    return r.exitCode
  } finally {
    releaseLock(lock.file)
  }
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (e) {
    process.stdout.write('PREVIEW-SELF-FAULT 工具自身故障：' + String((e && e.message) || e).split('\n')[0] + '\n')
    process.exitCode = 2
  }
}

module.exports = { preview, parseArgs, buildCheckerCommand, acquireLock, releaseLock, defaultsFor, attribute, readVerdict, blockingReasons, validPrNumber, subjectEnv, SUBJECT_ENV_DENY_RE, DISCLAIMER, DEFAULT_MAX, DEFAULT_LOCK_AGE_MS, LOCK_NAME, lockFile }
