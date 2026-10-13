#!/usr/bin/env node
// 执行记录存在性判据（change: enforce-gate-record-presence）
//
// 它拦的是哪一种形态：一个 PR 合并进了 main，却在 `.quality-gates.md`、`openspec/records/`、
// PR 正文、PR 评论里**任何一处**都没留下执行记录。既有门禁 `check-gate-record-debt.js` 的两条
// 强制判据都以"记录存在"为前提（一条看已存在的行是否收口，一条看最顶部那篇是否带行），
// 所以对"整篇缺席"完全免疫 —— 这不是它写得不好，是它的定义域就到这儿（#2570 自己在
// 「遗留与已知漏洞」里写明了这点）。
//
// 实测依据（窗口 2026-09-26 起，origin/main first-parent 132 个提交；本仓 squash 落地是**单亲**
// 提交，用 --merges 几乎查不到）：未碰 .quality-gates.md 70 个；按 classify-docs-only 同一份
// 白名单判出非 docs-only 47 个；再查 PR 正文与评论，32 个确有门禁内容、但只有 2 个提到
// 「远程同步」——也就是缺的恰好是唯一可机器检的那一行。
//
// 三条被实测钉住的设计前提：
//   1) 变更集只有一份取源：复用 classify-docs-only.js 的 changedFileStatuses（它内部 merge-base
//      + `diff --name-status -z`）。本脚本自己**不得**再拼 git diff —— 否则两份口径漂移时，
//      同一个 PR 会出现"一处判纯文档、另一处判缺记录"这种不可归因的红。
//   2) 必须区分 A/M/D：只看文件路径会把"改了别人的记录"当成"自己写了记录"而放行。
//      实测 `-z` 形态是「状态 NUL 路径」交替、重命名带相似度数字（R100），两者都踩过。
//   3) forward-only：历史欠账只可见不拦截，否则一上线就红几十条而不可用。
//
// 模式（D8）：默认 enforce。第一步落地时 CI 显式传 `--mode=advisory`，此时判据打印
// `MODE=advisory` 并恒退出 0；该标记行本身被 check-pr-exec-record.test.js 钉住，
// 转阻断那一步就是删掉这个显式参数 —— 于是"还没接进判定"这件事有东西在检测，
// 不会像 release-gate 的视觉项那样永远停在"人工核查"。
//
// 用法：node scripts/check-pr-exec-record.js --base=<ref> [--head=HEAD] [--repo=<dir>]
//        [--mode=enforce|advisory] [--threshold=3] [--statuses=<json>] [--no-remote]
// 回归：node --test scripts/check-pr-exec-record.test.js

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { changedFileStatuses } = require('./classify-docs-only.js')

const RECORDS_RE = /^openspec\/records\/[^_][^/]*\.md$/
const EXEMPT_RE = /^openspec\/records\/_exempt\/[^_][^/]*\.md$/
// 记录/台账载体：回填型 PR（出路④）的变更集**全部**落在这些文件上才算纯回填。
// 与 .quality-gates.md 的「远程同步」行、scripts/gate-record-debt-ledger.json 的账本
// 是同一组实体。注意：载体文件**可以**承载行为变更（翻门槛/收缩账本），所以出路④
// 额外要求至少一篇记录文件的 M —— 见 isPureBackfillChangeSet（QM-6 前端 C2 收紧）。
const CARRIER_RE = /^(?:openspec\/records\/[^_][^/]*\.md|\.quality-gates\.md|scripts\/gate-record-debt-ledger\.json)$/
const DEFAULT_THRESHOLD = 3

// ─────────────────────────────────────────────────────────────────────────────
// 钩子自动产物（2026-10-13 事故修复）
//
// pre-commit 自 #3396（aee1ebc9b, 2026-10-12）起自动 `git add` 判定记录
// `.ccg/reviews/<sha>.json`（状态 **A**），作为「防 .ccg/reviews 未跟踪堆积的根治」。
// 而本文件的出路④「纯回填」判据（#2928, e77977892, 2026-10-05）要求
// **变更集全部是载体的 M** —— 两特性独立落地且互相矛盾：
//
//   ⇒ 自 2026-10-12 起，任何走 pre-commit 的 PR 都必然带一个 A 文件，
//     出路④ **再也无法成立**（实测 #3465 / #3466 / #3470 三笔回填 PR 在
//     `--mode=enforce` 下全部不通过；7 天无人发现，只因 CI 以 `--mode=advisory`
//     调用，恒 exit 0 —— 判据死了但没人看得见）。
//
// 处置：判形态前**先剔除钩子自动产物**。这与 classify-docs-only.js 的
// CI_IGNORED_PATHS 已把 `.ccg/**` 视为非代码是同一口径 —— 两套判据对
// 「什么算代码」必须一致，各持一说正是本仓反复记录的失败模式。
//
// 豁免面刻意**只开给** `.ccg/reviews/*.json`（不放 `.ccg/**`）：范围越小，
// 被真代码蹭到的机会越小；且该目录由 ccg-review-decider.js 独占写入。
// 剔除后若变更集为空 ⇒ 下方 `length > 0` 兜底 fail-closed，不会让"只跑钩子"的空 PR 过关。
// ─────────────────────────────────────────────────────────────────────────────
const AUTO_STAGED_RE = /^\.ccg\/reviews\/[^/]+\.json$/

/** 剔除钩子自动产物后的变更集（形态判据一律基于它，计数展示仍用原始集）。*/
function excludingAutoStaged (statuses) {
  return Array.isArray(statuses) ? statuses.filter((e) => !AUTO_STAGED_RE.test(String(e.file))) : statuses
}

// 出路④的判据核心（独立成纯函数以便直接单测，QM-6 前端 I1）：变更集非空、每条都是载体的 M、
// 且至少一篇是记录文件（C2 收紧，理由见 evaluate 内注释）。
// 2026-10-13：先剔除钩子自动产物再判（见 AUTO_STAGED_RE 注释），否则出路④恒不可达。
function isPureBackfillChangeSet (statuses) {
  const relevant = excludingAutoStaged(statuses)
  return Array.isArray(relevant) && relevant.length > 0
    && relevant.every((e) => e.status === 'M' && CARRIER_RE.test(e.file))
    && relevant.some((e) => RECORDS_RE.test(e.file))
}

// 记录/豁免的判据核心：输入全是数据，不碰 git、不碰网络 —— 这样每条规则都能单测，
// 而"从真实 git 取到 statuses"这一环由一条独立接缝测试守（夹具不得替实现剥壳）。
function evaluate({
  statuses = [],
  headBranch = '',
  branchSource = 'unknown',
  exemptOnDisk = [],
  remoteBranches = new Set(),
  threshold = DEFAULT_THRESHOLD,
} = {}) {
  const reasons = []
  const addedRecords = statuses
    .filter((e) => e.status === 'A' && RECORDS_RE.test(e.file))
    .map((e) => e.file)
  const addedExempts = statuses
    .filter((e) => e.status === 'A' && EXEMPT_RE.test(e.file))
    .map((e) => e.file)

  // 记录按分支名一一对应，所以"M 自己那篇"仍可作为本 PR 携带记录（回填/修订是同一条记录的
  // 正常演进）；M 别人的记录仍不算 —— 放宽只按文件名 == <分支名>.md 这一维发生，不是按状态放宽。
  // 两条收紧都是外部评审实测逼出来的：
  // ① 必须同时满足 RECORDS_RE —— 否则分支名撞上 _TEMPLATE 这类保留名时"改模板"就满足判据
  //    （实测 headBranch='_TEMPLATE' + M openspec/records/_TEMPLATE.md 曾判 ok=true）；
  // ② headBranch 必须是**真分支名**：detached HEAD 解析出的字面量 "HEAD" 由 resolveHeadBranch 置空，
  //    否则 ownRecordPath 退化成 openspec/records/HEAD.md，放宽在 CI 上永不触发（CI 恰是唯一生效处）。
  const candidateOwnPath = headBranch ? `openspec/records/${headBranch}.md` : ''
  const ownRecordPath = candidateOwnPath && RECORDS_RE.test(candidateOwnPath) ? candidateOwnPath : null
  const revisedRecords = statuses
    .filter((e) => e.status === 'M' && ownRecordPath && e.file === ownRecordPath)
    .map((e) => e.file)

  // 出路④（#2920 实测动因）：回填型 PR 的定义恰恰是 M **别的分支**那篇记录 —— 出路①②③对它
  // 全部不可用。判据取最窄形态：变更集**每一条**都是载体文件的 M（夹带任何 A/D/非载体文件即不算），
  // 且**至少含一篇记录文件的 M**（QM-6 前端 C2 收紧：载体文件自身可承载行为变更——
  // .quality-gates.md 可翻门槛、账本可收缩欠账；改动前「只 M 载体不带记录」是红的，
  // 放行若无此条件就把那扇门重新打开。回填的本质是修订记录，SOP 里销账与记录更新同次发生，
  // 因此无记录文件的载体集不构成回填）。M+D 混合（删记录）仍必须另交记录。
  //
  // 两条计数是**包含关系而非互斥**（QM-6 后端 W1 修正注释）：isPureBackfill 时
  // revisedRecords ⊆ backfillRevised（本分支那篇同时出现在两边，归属维度不同）；
  // 真正互斥的是出路④与豁免出路（掺进 A 豁免即不再纯回填）。
  //
  // 分支名必须可解析（QM-6 后端 W1）：出路④若不依赖 headBranch，CI 上 --head-branch 注入
  // 失效（detached 且无 GITHUB_HEAD_REF）会让纯 M 记录 PR 以 head分支=(空) 判绿 ——
  // resolveHeadBranch「宁可判没带记录，也不猜分支」的 fail-closed 设计被静默吞掉。
  // 因此分支名不可解析时出路④不适用，并出专用理由（区别于泛泛的"未携带记录"）。
  //
  // 信任边界（QM-6 后端 I4-info，文档化不改码）：出路④只校验文件/状态形态，不校验 M 内容
  // 是否真是回填凭据 —— PENDING→PASS 的真实性依赖人工 review 与 check-gate-record-debt.js
  // 的结构检查，这是文档门禁的固有信任边界。
  const backfillShaped = isPureBackfillChangeSet(statuses)
  const isPureBackfill = backfillShaped && headBranch !== ''
  const backfillRevised = isPureBackfill
    ? statuses.filter((e) => e.status === 'M').map((e) => e.file)
    : []
  if (backfillShaped && !isPureBackfill) {
    reasons.push('变更集形似纯回填，但分支名不可解析（detached 且无 CI 注入）⇒ 判据 fail-closed：'
      + '出路④需要可解析的分支名来区分「修订本分支记录」与「回填别人的记录」。'
      + '请由 CI 注入 PR head 分支名（GitHub Actions: GITHUB_HEAD_REF，本地传 --head-branch）。')
  }

  // 变更集为空 = 取不到证据，不等于"这个 PR 没改文件"。判红，不接受空清单当通过。
  if (!Array.isArray(statuses) || statuses.length === 0) {
    reasons.push('变更集为空或取证失败：无法判定本 PR 是否携带执行记录。判据按 fail-closed 处理，'
      + '请确认 --base/--head 可解析（merge-base 与 diff 由 classify-docs-only.changedFileStatuses 统一提供）')
  }

  const badExempts = exemptOnDisk.filter((e) => !String(e.reason || '').trim())
  for (const e of badExempts) {
    reasons.push(`豁免缺少非空原因：${e.branch || '(无名)'} —— 豁免必须是显式承认，不是静默绕过`)
  }

  // 同一分支既交记录又交豁免是矛盾：豁免的语义是"这次没有可记录的行为变更"。
  const hasRecord = addedRecords.length > 0 || revisedRecords.length > 0
  const bothForBranch = addedExempts.length > 0 && hasRecord
  if (bothForBranch) {
    reasons.push(`矛盾：本 PR 同时新增了记录文件与豁免文件（${addedRecords[0] || revisedRecords[0]} 与 ${addedExempts[0]}）。`
      + '二者语义互斥，请删除豁免那一侧')
  }

  // 提交性判定与结论判定必须分开：先算"有没有交东西"，把全部违规理由收集完，
  // 最后 ok = 无理由。先前写成 ok = 交了记录就算通过，于是"同时交记录与豁免"和
  // "待清理豁免超阈值"两条都出了理由却仍判通过 —— 那是装饰性门禁。
  const submitted = hasRecord || addedExempts.length > 0 || isPureBackfill
  if (!submitted && statuses.length > 0) {
    reasons.push('本 PR 未携带执行记录。四条合法出路任选其一：'
      + `①新增 openspec/records/<分支名>.md（按 _TEMPLATE.md，含门禁表与「远程同步」行；`
      + '尚无法收口时在该文件 frontmatter 里写 sync_reason 与 sync_backfill_owner）；'
      + '②修订本分支自己那篇 openspec/records/<分支名>.md（回填证据走这条）；'
      + '③确属无需记录 ⇒ 新增 openspec/records/_exempt/<分支名>.md 并写明非空原因；'
      + '④纯回填（定义）：变更集全部是既有记录/台账载体（openspec/records/*.md、.quality-gates.md、'
      + 'scripts/gate-record-debt-ledger.json）的 M，且至少含一篇 openspec/records/*.md 的 M ⇒ '
      + '满足此定义者直接放行（夹带任何新增/删除/非载体文件、或只改门禁清单/账本而无记录文件，'
      + '即不符合此定义）。**判形态前先剔除 pre-commit 自动 stage 的 .ccg/reviews/*.json**'
      + '（钩子产物不算夹带；该豁免只开给这一目录，剔除后为空即 fail-closed）。')
  }

  // 已消费的豁免：分支已不在远端（合并即删分支）。要求"同 PR 内自删"在 squash 流程下不可实现，
  // 所以走可见计数 + 阈值。远端清单取不到时 consumedKnown=false，必须出声，不得静默当 0。
  const consumedKnown = remoteBranches instanceof Set
  const consumedExempts = !consumedKnown ? [] : exemptOnDisk
    .filter((e) => e.branch && e.branch !== headBranch && !remoteBranches.has(e.branch))
    .map((e) => `openspec/records/_exempt/${e.branch}.md`)
  if (consumedExempts.length >= threshold) {
    reasons.push(`待清理豁免已堆积 ${consumedExempts.length} 条（阈值 ${threshold}）：其分支已不在远端，`
      + '说明已被消费或废弃，请删除对应文件后放行：\n  ' + consumedExempts.join('\n  '))
  }

  const ok = reasons.length === 0

  function summary() {
    const bits = [
      `本 PR 变更文件 ${statuses.length} 个（A=${statuses.filter((e) => e.status === 'A').length} `
      + `M=${statuses.filter((e) => e.status === 'M').length} `
      + `D=${statuses.filter((e) => e.status === 'D').length}）`,
      `新增记录 ${addedRecords.length} 篇 / 修订本分支记录 ${revisedRecords.length} 篇 / 新增豁免 ${addedExempts.length} 篇`
        + (isPureBackfill ? ` / 回填型 PR（载体修订 ${backfillRevised.length} 篇）` : ''),
      // 载体 M 计数必须无条件打印（QM-6 前端 W9）：回填未成立时（载体 M 夹了代码），
      // 作者只看 "M=3" 无从判断差在哪，这一项让"差一个非载体文件"可见。
      `载体M=${statuses.filter((e) => e.status === 'M' && CARRIER_RE.test(e.file)).length}`,
      // 分支名与它的来源必须每次打印：detached 与注入的差异不在这里出声，就又会变成
      // "CI 上恒判没带记录、本机永远复现不了"的那类静默失效。
      `head分支=${headBranch || '(空)'} 来源=${ownRecordPath ? branchSource : branchSource + '(未启用修订判据)'}`,
      consumedKnown ? `待清理豁免 ${consumedExempts.length} 条` : '待清理豁免 consumed=unknown（远端分支清单取不到）',
    ]
    return bits.join(' ｜ ')
  }

  return { ok, reasons, addedRecords, addedExempts, revisedRecords, backfillRevised, isPureBackfill, ownRecordPath, consumedExempts, consumedKnown, summary }
}

function readExemptsOnDisk(repo) {
  const dir = path.join(repo, 'openspec', 'records', '_exempt')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.md') && !n.startsWith('_'))
    .map((n) => {
      const text = fs.readFileSync(path.join(dir, n), 'utf8')
      const fm = {}
      const lines = text.split('\n')
      if ((lines[0] || '').trim() === '---') {
        for (let i = 1; i < lines.length; i++) {
          const raw = (lines[i] || '').replace(/\r$/, '')
          if (raw === '---') break
          if (/^\s*#/.test(raw)) continue
          const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw)
          if (m) fm[m[1]] = m[2].trim()
        }
      }
      return { branch: fm.exempt_for || n.replace(/\.md$/, ''), reason: fm.reason || '' }
    })
}

function remoteBranchSet(repo) {
  try {
    const out = execFileSync('git', ['-C', repo, 'ls-remote', '--heads', 'origin'],
      { encoding: 'utf8', timeout: 60000 })
    return new Set(out.split('\n').filter(Boolean).map((l) => (l.split('\t')[1] || '').replace(/^refs\/heads\//, '').trim()))
  } catch (e) {
    return null
  }
}

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a)
    if (m) out[m[1]] = m[2]
    else if (a.startsWith('--')) out[a.slice(2)] = true
  }
  return out
}

/**
 * 分支名解析：显式参数 > GITHUB_HEAD_REF（PR 事件的 head 分支）> git rev-parse。
 * `actions/checkout` 在 pull_request 事件检出的是 detached merge ref，
 * `git rev-parse --abbrev-ref HEAD` 必返回字面量 "HEAD" —— 那不是分支名，拿它拼
 * `openspec/records/HEAD.md` 会让"修订自己那篇记录"这条出路在 CI 上恒不成立，
 * 而 CI 恰是这条判据唯一真正执行的地方（本机永远有真分支名）。
 * 所以 detached 且没有上游注入时返回空串：宁可判"没带记录"，也不猜一个不存在的分支。
 * @returns {{branch: string, source: 'arg'|'env'|'git'|'detached'}}
 */
function resolveHeadBranch({ argBranch = '', envHeadRef = '', gitBranch = '' } = {}) {
  const arg = String(argBranch || '').trim()
  if (arg) return { branch: arg, source: 'arg' }
  const env = String(envHeadRef || '').trim()
  if (env) return { branch: env, source: 'env' }
  const git = String(gitBranch || '').trim()
  if (!git || git === 'HEAD') return { branch: '', source: 'detached' }
  return { branch: git, source: 'git' }
}

function main(argv) {
  const args = parseArgs(argv)
  const repo = args.repo || process.cwd()
  // #2923 遗留：显式 `--head=`（空串）必须拒绝，不得经 `|| 'HEAD'` 回落 —— CI 检出下 HEAD 是
  // 合并提交，回落等于把「取证失败」伪装成「取到了」。（未传 --head 仍默认 HEAD，本机直跑不受影响。）
  if (typeof args.head === 'string' && args.head.trim() === '') {
    process.stderr.write('[check-pr-exec-record] --head= 显式为空：取证失败必须显式报错，'
      + '不得回落 HEAD（pull_request 检出下 HEAD 是合并提交）。请由 CI 注入 PR 的 head SHA'
      + '（GitHub Actions: pull_request.head.sha）。\n')
    process.exit(2)
  }
  const head = args.head || 'HEAD'
  const mode = args.mode === 'advisory' ? 'advisory' : 'enforce'
  const threshold = Number(args.threshold || DEFAULT_THRESHOLD)
  let statuses
  if (typeof args.statuses === 'string') {
    try { statuses = JSON.parse(args.statuses) } catch (e) {
      process.stderr.write(`[check-pr-exec-record] --statuses 不是合法 JSON：${e.message}\n`)
      process.exit(2)
    }
  } else {
    if (!args.base) {
      // push 到 main 的事件没有 PR base，而本判据只对 PR 有意义。这里不能无条件 exit(2)：
      // 那会让每个 push run 都红（enforce 阶段更严重）。交回 mode 决定，advisory 只留痕。
      process.stdout.write(`缺 --base：本判据只对 pull_request 事件有意义（需要 PR base 才能算变更集）。mode=${mode}\n`)
      if (mode === 'advisory') process.exit(0)
      process.stderr.write('用法: node scripts/check-pr-exec-record.js --base=<ref> [--head=HEAD] [--repo=<dir>] [--mode=advisory]\n')
      process.exit(2)
    }
    try {
      statuses = changedFileStatuses({ repo, base: args.base, head })
    } catch (e) {
      // 取不到变更集时也必须尊重 mode：checkout 若是浅克隆，merge-base 会失败，
      // 而"在 advisory 阶段就把 job 判红"正是本仓点名的 runner-only red 事故形状。
      process.stderr.write(`[check-pr-exec-record] ${e.message}\n`)
      if (mode === 'advisory') {
        process.stdout.write('MODE=advisory（取证失败，advisory 阶段不拦；转阻断前必须先确认 base/head 可解析）\n')
        process.exit(0)
      }
      process.exit(1)
    }
  }
  let gitBranch = ''
  try { gitBranch = execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim() } catch { /* 取不到就按空串走判据 */ }
  const resolved = resolveHeadBranch({
    argBranch: typeof args['head-branch'] === 'string' ? args['head-branch'] : '',
    envHeadRef: process.env.GITHUB_HEAD_REF || '',
    gitBranch,
  })
  const headBranch = resolved.branch
  const remoteBranches = args['no-remote'] || args.statuses !== undefined ? (args['no-remote'] ? null : new Set([headBranch])) : remoteBranchSet(repo)

  const r = evaluate({
    statuses,
    headBranch,
    branchSource: resolved.source,
    exemptOnDisk: readExemptsOnDisk(repo),
    remoteBranches: remoteBranches || new Set(),
    threshold,
  })
  // 取不到远端清单时不能悄悄按"0 条待清理"过 —— 显式传 null 让 evaluate 自己标 unknown
  if (!remoteBranches) {
    const r2 = evaluate({ statuses, headBranch, branchSource: resolved.source, exemptOnDisk: readExemptsOnDisk(repo), remoteBranches: null, threshold })
    return report(r2, mode)
  }
  return report(r, mode)
}

function report(r, mode) {
  const lines = [r.summary()]
  for (const x of r.reasons) lines.push(`- ${x}`)
  if (r.ok) lines.push('OK: 本 PR 携带执行记录或带原因的豁免')
  else lines.push(`不通过：${r.reasons.length} 条理由`)
  if (mode === 'advisory') {
    lines.push('MODE=advisory（尚未接进判定；转阻断 = 删掉 CI 里的 --mode=advisory，'
      + '该标记行由 check-pr-exec-record.test.js 钉住，不会悄悄停在观察态）')
    process.stdout.write(lines.join('\n') + '\n')
    process.exit(0)
  }
  process.stdout.write(lines.join('\n') + '\n')
  process.exit(r.ok ? 0 : 1)
}

module.exports = { evaluate, resolveHeadBranch, readExemptsOnDisk, remoteBranchSet, isPureBackfillChangeSet, excludingAutoStaged, AUTO_STAGED_RE, RECORDS_RE, EXEMPT_RE, CARRIER_RE, DEFAULT_THRESHOLD }

if (require.main === module) main(process.argv.slice(2))
