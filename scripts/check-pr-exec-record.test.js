// Regression tests for scripts/check-pr-exec-record.js
//
// Why (change enforce-gate-record-presence): on origin/main, 47 of 132 non-docs-only PRs in a
// 3-day window never touched `.quality-gates.md`, and 32 of those DID record gate reasoning in the
// PR body — but only 2 ever mentioned the `远程同步` row, i.e. the single thing the existing gate
// can actually check. The old checker presupposes a record exists, so "no record at all" is
// invisible to it by design (recorded as an unclosed hole in #2570's own 遗留).
//
// Facts locked here, each measured before being relied on:
//   * this repo lands PRs as SQUASH commits => the landing commit is SINGLE-PARENT. An earlier
//     probe used `git rev-list --merges` and found almost nothing; the window is walked with
//     `--first-parent` instead.
//   * `docs-only` classification must come from the SAME whitelist object as the CI changes job
//     (exported by classify-docs-only.js) — a second whitelist is the documented failure mode.
//   * the change-set is acquired once (changedFileStatuses) and this script MUST NOT shell out to
//     `git diff` itself; otherwise two predicates can disagree about "which files did this PR touch"
//     and produce an unattributable red.
//
//   node --test scripts/check-pr-exec-record.test.js

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const mod = require('./check-pr-exec-record.js')

const st = (list) => list.map(([status, file]) => ({ status, file }))

test('新增一篇记录文件即通过（判据只看本 PR 的变更集）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/my-task.md'], ['M', 'apps/desktop/src/a.js']]),
    headBranch: 'my-task',
    exemptOnDisk: [],
    remoteBranches: new Set(['main', 'my-task']),
  })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.deepStrictEqual(r.addedRecords, ['openspec/records/my-task.md'])
})

test('既无记录也无豁免必须变红，且输出两条可执行出路（不能只说"不合规"）', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'apps/desktop/electron/main.js']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(r.ok, false)
  const msg = r.reasons.join('\n')
  assert.match(msg, /openspec\/records\//, '必须给出"新增一篇记录文件"这条出路')
  assert.match(msg, /_exempt/, '必须给出"新增一篇带原因的豁免文件"这条出路')
})

test('豁免文件是合法出路，但原因必须非空（空原因等于静默绕过）', () => {
  const dir = mod.writeFixtureRepo ? null : null
  const good = mod.evaluate({
    statuses: st([['A', 'openspec/records/_exempt/bot-maint.md']]),
    headBranch: 'bot-maint',
    exemptOnDisk: [{ branch: 'bot-maint', reason: '纯依赖版本 bump，无可验证行为变化' }],
    remoteBranches: new Set(['main', 'bot-maint']),
  })
  assert.strictEqual(good.ok, true, JSON.stringify(good.reasons))
  const empty = mod.evaluate({
    statuses: st([['A', 'openspec/records/_exempt/lazy.md']]),
    headBranch: 'lazy',
    exemptOnDisk: [{ branch: 'lazy', reason: '   ' }],
    remoteBranches: new Set(['main', 'lazy']),
  })
  assert.strictEqual(empty.ok, false, '空白原因必须拒')
  assert.match(empty.reasons.join('\n'), /原因/)
})

test('变更集为空 ⇒ fail-closed 判红（"没取到文件"不等于"没改文件"）', () => {
  const r = mod.evaluate({ statuses: [], headBranch: 'x', exemptOnDisk: [], remoteBranches: new Set(['main']) })
  assert.strictEqual(r.ok, false)
  assert.match(r.reasons.join('\n'), /变更集为空|取证失败/)
})

test('只有 M/D 没有 A 不算新增记录（改别人的记录不等于自己写了记录；含 D 即不是纯回填）', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/other.md'], ['D', 'openspec/records/stale.md']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(r.ok, false, JSON.stringify(r))
  assert.deepStrictEqual(r.addedRecords, [])
})

// ── 出路④：回填型 PR（本 PR 只修订既有记录/台账载体，不新增任何东西）────────────────
// 动因（#2920 实测，2026-10-05）：出路②要求 M 的文件 == `openspec/records/<headBranch>.md`，
// 而"回填"的定义恰恰是 M **别的分支**那篇记录 —— 于是三类合法出路对回填 PR 全部不可用：
// ①新增自己那篇 ⇒ 给一条 meta 变更再造一笔 PENDING 欠账（三阶递归）；
// ③新增豁免 ⇒ 豁免堆积阈值 3，盘上已 1 条，逼近即红。
// 实测：`--mode=enforce` 对 #2920 报「本 PR 未携带执行记录」rc=1，CI 传 advisory 才没拦。
// 判据取"变更集全部是载体文件的 M"这个最窄形态：夹带任何非载体文件（代码/新文档）即不算回填，
// 因此它不可能是将行为变更藏进回填的通道。
test('出路④：变更集全是既有记录的 M ⇒ 判为回填型 PR 并放行，且必须点名', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/legacy-record-a.md']]),
    headBranch: 'sync-backfill-2914',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.deepStrictEqual(r.addedRecords, [], '回填不算新增记录，计数不得混同')
  assert.deepStrictEqual(r.backfillRevised, ['openspec/records/legacy-record-a.md'])
  assert.match(r.summary(), /回填/, '放行理由必须每次打印，否则这条出路会变成无人知晓的暗道')
})

test('出路④不得夹带非载体文件：M 代码 / A 新文件 / D 删除任一形态都不得白坐', () => {
  for (const extra of [
    ['M', 'apps/desktop/electron/main.js'],
    ['A', 'apps/desktop/src/brand-new.js'],
    ['D', 'apps/desktop/old.js'],
  ]) {
    const r = mod.evaluate({
      statuses: st([['M', 'openspec/records/other.md'], extra]),
      headBranch: 'x',
      exemptOnDisk: [],
      remoteBranches: new Set(['main']),
    })
    assert.strictEqual(r.ok, false, `夹带 ${extra[0]} ${extra[1]} 必须仍然要求执行记录`)
    assert.strictEqual(r.backfillRevised.length, 0, `夹带形态下 backfillRevised 必须为空（${extra[0]})`)
    assert.match(r.reasons.join('\n'), /未携带执行记录/)
    // 定义式措辞（QM-6 前端 C1）：出路④是"长什么样"，不是"你现在的 PR 可以这么做"
    assert.match(r.reasons.join('\n'), /定义/, '出路④文案必须是定义式，不得读成对当前 PR 的放行指令')
  }
})

test('出路④必须伴随至少一篇记录文件的 M：只翻 .quality-gates.md/账本不得白坐（QM-6 前端 C2）', () => {
  // C2 滥用面向量：改动前「只 M .quality-gates.md 不带记录」是红的；若纯载体 M 一律放行，
  // 门槛调整/账本收缩就能伪装成回填。收紧判据 = 回填的本质是修订记录，
  // SOP 里销账与记录更新同次发生，因此无记录文件的载体集一律不构成出路④。
  const gatesOnly = mod.evaluate({
    statuses: st([['M', '.quality-gates.md'], ['M', 'scripts/gate-record-debt-ledger.json']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(gatesOnly.ok, false, JSON.stringify(gatesOnly.reasons))
  assert.match(gatesOnly.reasons.join('\n'), /未携带执行记录/)

  const gatesAlone = mod.evaluate({
    statuses: st([['M', '.quality-gates.md']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(gatesAlone.ok, false, '单 M 门禁清单同样不得白坐')

  const legacy = mod.evaluate({
    statuses: st([
      ['M', 'openspec/records/legacy-record-a.md'],
      ['M', '.quality-gates.md'],
      ['M', 'scripts/gate-record-debt-ledger.json'],
    ]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(legacy.ok, true, JSON.stringify(legacy.reasons))
  assert.deepStrictEqual([...legacy.backfillRevised].sort(),
    ['.quality-gates.md', 'openspec/records/legacy-record-a.md', 'scripts/gate-record-debt-ledger.json'],
    '三条载体都必须进 backfillRevised 清单（QM-6 前端 I3）')
})

test('isPureBackfillChangeSet 判据可直接单测（QM-6 前端 I1）', () => {
  assert.strictEqual(typeof mod.isPureBackfillChangeSet, 'function', '必须导出判据函数')
  assert.strictEqual(mod.isPureBackfillChangeSet(st([['M', 'openspec/records/a.md']])), true)
  assert.strictEqual(mod.isPureBackfillChangeSet(
    st([['M', '.quality-gates.md'], ['M', 'scripts/gate-record-debt-ledger.json']])), false,
    '无记录文件的载体集不构成回填（C2 收紧）')
  assert.strictEqual(mod.isPureBackfillChangeSet(st([['M', 'openspec/records/a.md'], ['M', 'x.js']])), false)
  assert.strictEqual(mod.isPureBackfillChangeSet(st([['A', 'openspec/records/a.md']])), false)
  assert.strictEqual(mod.isPureBackfillChangeSet([]), false)
  // _exempt 边界（QM-6 后端 I3）：载体正则的首字符 [^_] 守卫必须把豁免文件的 M 挡在外面
  assert.strictEqual(mod.isPureBackfillChangeSet(
    st([['M', 'openspec/records/_exempt/x.md'], ['M', 'openspec/records/a.md']])), false,
    'M 豁免文件不是载体 —— 放宽正则时这里必须红')
  // 重命名形态（QM-6 后端 I2）：changedFileStatuses 对 rename 返回 R100（非 M），
  // "代码文件改名成记录文件"不得被纯回填吸收
  const r100Statuses = [{ status: 'R100', file: 'openspec/records/new.md', from: 'apps/desktop/old.js' }]
  assert.strictEqual(mod.isPureBackfillChangeSet(r100Statuses), false,
    'R100 复制/重命名形态不算 M，出路④必须拒绝')
  const r100 = mod.evaluate({
    statuses: r100Statuses,
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(r100.ok, false, JSON.stringify(r100.reasons))
  assert.deepStrictEqual(r100.backfillRevised, [])
})

// ── QM-6 后端 W1：出路④不得吞掉「分支名注入失效」——detached 且无 env 时必须 fail-closed ──
// resolveHeadBranch 的设计是"宁可判没带记录，也不猜一个不存在的分支"；若出路④不要求分支名，
// CI 上 --head-branch 注入失效会让纯 M 记录 PR 以 head分支=(空) 判绿，接线失效被静默吞掉。
test('出路④要求分支名可解析：detached 且无 CI 注入时纯 M 记录必须红并出声', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/other.md']]),
    headBranch: '',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(r.ok, false, JSON.stringify(r.reasons))
  assert.match(r.reasons.join('\n'), /分支名/, '必须点名"分支名不可解析"这一成因，而非泛泛的"未携带记录"')
  assert.deepStrictEqual(r.backfillRevised, [], '分支名不可解析时回填清单必须为空')
})

test('summary 必须始终打印载体 M 计数，回填未成立时作者能看出差在哪（QM-6 前端 W9）', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/other.md'], ['M', 'apps/desktop/electron/main.js']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.match(r.summary(), /载体M=1/, 'summary 须含载体 M 计数：' + r.summary())
})

test('M 自己那篇 + M 别人的记录：两条修订判据并存且互不混同（QM-6 前端 I4）', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/my-branch.md'], ['M', 'openspec/records/other.md']]),
    headBranch: 'my-branch',
    exemptOnDisk: [],
    remoteBranches: new Set(['main', 'my-branch']),
  })
  assert.strictEqual(r.ok, true, JSON.stringify(r.reasons))
  assert.deepStrictEqual(r.revisedRecords, ['openspec/records/my-branch.md'])
  assert.deepStrictEqual([...r.backfillRevised].sort(),
    ['openspec/records/my-branch.md', 'openspec/records/other.md'])
})

test('出路④与既有判据互不干扰：既交豁免又 M 别人的记录走豁免出路；M+D 混合仍不算回填', () => {
  const exempt = mod.evaluate({
    statuses: st([['M', 'openspec/records/other.md'], ['A', 'openspec/records/_exempt/x.md']]),
    headBranch: 'x',
    exemptOnDisk: [{ branch: 'x', reason: '只是修订别人的记录，本 PR 无行为变更' }],
    remoteBranches: new Set(['main', 'x']),
  })
  assert.strictEqual(exempt.ok, true, JSON.stringify(exempt.reasons))
  assert.strictEqual(exempt.backfillRevised.length, 0,
    '掺进一个 A 就不再是纯回填，此时靠豁免那条出路成立，判据不得重叠')
  const mixed = mod.evaluate({
    statuses: st([['M', 'openspec/records/other.md'], ['D', 'openspec/records/stale.md']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.strictEqual(mixed.ok, false, '删除记录（D）必须另交记录，不得被回填判据吸收')
})

test('CLI 端到端（enforce）：纯回填的 statuses 必须 rc=0，夹带代码必须 rc=1', () => {
  const cli = (statuses, expectZero) => {
    const r = (() => {
      try {
        const stdout = execFileSync('node', [
          path.join(__dirname, 'check-pr-exec-record.js'),
          `--statuses=${JSON.stringify(statuses)}`,
          '--head-branch=sync-backfill-2914',
          `--repo=${path.join(__dirname, '..')}`,
          // 豁免堆积阈值取决于盘上 _exempt/ 与远端分支的实际状态，与本条要测的回填判据无关；
          // 不隔离它，将来任何人新增一篇豁免都会让这条 CLI 测试莫名变红。
          '--no-remote',
          '--mode=enforce',
        ], { encoding: 'utf8' })
        return { code: 0, stdout }
      } catch (e) {
        return { code: e.status ?? 1, stdout: String(e.stdout ?? '') }
      }
    })()
    if (expectZero) assert.strictEqual(r.code, 0, r.stdout)
    else assert.strictEqual(r.code, 1, r.stdout)
    return r
  }
  // 文件名一律合成（QM-6 前端 I2）：不得与真实记录同名，避免读者误当夹具真源
  const okRun = cli([{ status: 'M', file: 'openspec/records/some-legacy-record.md' }], true)
  assert.match(okRun.stdout, /回填/)
  cli([
    { status: 'M', file: 'openspec/records/some-legacy-record.md' },
    { status: 'M', file: 'packages/shared-utils/src/login-state.js' },
  ], false)
})

// #2923 遗留：`args.head || 'HEAD'` 会把显式传来的空串读成默认 HEAD —— 而 HEAD 在 CI 的
// pull_request 检出下是合并提交，等于把「取证失败」伪装成「取到了」。
test('显式 --head= 空 ⇒ rc=2 拒绝，不回落 HEAD（运行方守卫不是唯一防线）', () => {
  let ran = false
  try {
    execFileSync('node', [
      path.join(__dirname, 'check-pr-exec-record.js'),
      '--base=origin/main',
      '--head=',
      `--repo=${path.join(__dirname, '..')}`,
      '--mode=enforce',
    ], { encoding: 'utf8' })
    ran = true
  } catch (e) {
    assert.strictEqual(e.status, 2, `期望用法错误 rc=2，实得 ${e.status}\n${String(e.stderr ?? '')}`)
    assert.match(String(e.stderr ?? ''), /--head/, '拒绝理由必须点名 --head')
  }
  assert.strictEqual(ran, false, '显式空 head 必须被拒绝，走到正常路径即失败')
})

test('模板与豁免模板自身不得算作记录（它们带 PENDING 行，算进去就是恒红/恒绿）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/_TEMPLATE.md'], ['A', 'openspec/records/_exempt/_TEMPLATE.md']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  assert.deepStrictEqual(r.addedRecords, [], '模板不得计入记录')
  assert.strictEqual(r.ok, false, '只交模板等于什么都没交')
})

test('同一分支同时交记录与豁免是矛盾，必须红（豁免只能在没有记录时用）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/twin.md'], ['A', 'openspec/records/_exempt/twin.md']]),
    headBranch: 'twin',
    exemptOnDisk: [{ branch: 'twin', reason: '两个都交了' }],
    remoteBranches: new Set(['main', 'twin']),
  })
  assert.strictEqual(r.ok, false)
  assert.match(r.reasons.join('\n'), /矛盾|同时/)
})

test('已消费的豁免（分支已不在远端）先计入可见待清理数，未达阈值不拦', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/ok.md']]),
    headBranch: 'ok',
    exemptOnDisk: [
      { branch: 'gone-a', reason: '已合并的历史豁免' },
      { branch: 'gone-b', reason: '已关闭的历史豁免' },
    ],
    remoteBranches: new Set(['main', 'ok']),
    threshold: 3,
  })
  assert.strictEqual(r.consumedExempts.length, 2, JSON.stringify(r.consumedExempts))
  assert.strictEqual(r.ok, true, '2 < 3 不该拦：' + r.reasons.join('\n'))
  assert.match(r.summary(), /待清理豁免 2 条/)
})

test('待清理豁免达到阈值必须拦，且点名文件（删除是删自己那个文件，零同行竞争）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/ok.md']]),
    headBranch: 'ok',
    exemptOnDisk: [
      { branch: 'g1', reason: 'a' }, { branch: 'g2', reason: 'b' }, { branch: 'g3', reason: 'c' },
    ],
    remoteBranches: new Set(['main', 'ok']),
    threshold: 3,
  })
  assert.strictEqual(r.ok, false)
  assert.match(r.reasons.join('\n'), /g1|g2|g3/, '必须点名待清理项')
})

test('远端分支清单取不到时，消费判定降级为 unknown 且必须出声（不得静默当 0）', () => {
  const r = mod.evaluate({
    statuses: st([['A', 'openspec/records/ok.md']]),
    headBranch: 'ok',
    exemptOnDisk: [{ branch: 'maybe-gone', reason: 'x' }],
    remoteBranches: null, // 模拟 ls-remote 失败
    threshold: 3,
  })
  assert.strictEqual(r.consumedKnown, false, '必须标明"这一维没测到"')
  assert.match(r.summary(), /consumed=unknown/)
  assert.strictEqual(r.ok, true, '取不到远端不该判红，但必须留痕')
})

// ── 与真实 git 的接缝：证明"取变更集"这条链在真仓库里真的通 ──
test('真接缝：从真实 git 夹具取到的 statuses 能被判据正确处理（夹具不得替实现剥壳）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-record-'))
  const run = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  run(['init', '--quiet', '-b', 'main'])
  run(['config', 'user.email', 't@e.com']); run(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'openspec/records'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.js'), '1')
  run(['add', '.']); run(['commit', '--quiet', '-m', 'base'])
  run(['checkout', '--quiet', '-b', 'feat'])
  fs.writeFileSync(path.join(dir, 'a.js'), '2')
  fs.writeFileSync(path.join(dir, 'openspec/records', 'feat.md'), 'x')
  run(['add', '-A']); run(['commit', '--quiet', '-m', 'c'])

  const statuses = require('./classify-docs-only.js').changedFileStatuses({ repo: dir, base: 'main', head: 'feat' })
  const r = mod.evaluate({ statuses, headBranch: 'feat', exemptOnDisk: [], remoteBranches: new Set(['main', 'feat']) })
  assert.deepStrictEqual(r.addedRecords, ['openspec/records/feat.md'], JSON.stringify(statuses))
  assert.strictEqual(r.ok, true)
})

// ── 3.7 结构锁：不得出现第二份"本 PR 改了哪些文件"的口径 ──
test('本脚本必须复用 classify-docs-only 的取源，自己不得拼 git diff', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  const body = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  assert.match(body, /require\(['"]\.\/classify-docs-only\.js['"]\)/, '必须引用共享取源模块')
  assert.match(body, /changedFileStatuses/, '必须调用 changedFileStatuses 而不是自取 diff')
  assert.doesNotMatch(body, /\[\s*['"]diff['"]/, '本脚本内不得出现自己的 git diff 调用')
  assert.doesNotMatch(body, /--name-only|--name-status/, '不得自带 diff flag（那是第二份口径）')
})

// ── D8：非阻断状态自身必须可被检测 ──
test('advisory 模式必须打印 MODE=advisory 且退出码为 0；enforce 模式下同一场景必须红', () => {
  const cli = (args) => {
    try {
      return { code: 0, out: execFileSync('node', [path.join(__dirname, 'check-pr-exec-record.js'), ...args], { encoding: 'utf8' }) }
    } catch (e) {
      return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') }
    }
  }
  const root = path.resolve(__dirname, '..')
  // 用 --statuses 注入一个"无记录"的变更集，避免依赖真实分支状态
  const adv = cli([`--repo=${root}`, '--base=HEAD', '--head=HEAD', '--statuses=[]', '--mode=advisory'])
  assert.strictEqual(adv.code, 0, adv.out)
  assert.match(adv.out, /MODE=advisory/, 'advisory 模式必须自报身份，否则没人知道它没在拦')
  const enf = cli([`--repo=${root}`, '--base=HEAD', '--head=HEAD', '--statuses=[]', '--mode=enforce'])
  assert.notStrictEqual(enf.code, 0, 'enforce 模式下同一输入必须红')
  assert.doesNotMatch(enf.out, /MODE=advisory/)
})

test('取证失败（base 不可解析）在 advisory 阶段不得判红，在 enforce 阶段必须判红', () => {
  const cli = (args) => {
    try {
      return { code: 0, out: execFileSync('node', [path.join(__dirname, 'check-pr-exec-record.js'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    } catch (e) { return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') } }
  }
  const root = path.resolve(__dirname, '..')
  const bad = `--base=no-such-ref-xyz-${process.pid}`
  const adv = cli([`--repo=${root}`, bad, '--head=HEAD', '--mode=advisory'])
  assert.strictEqual(adv.code, 0, '浅克隆/坏 base 不该在 advisory 阶段红：\n' + adv.out)
  assert.match(adv.out, /MODE=advisory/)
  const enf = cli([`--repo=${root}`, bad, '--head=HEAD', '--mode=enforce'])
  assert.notStrictEqual(enf.code, 0, 'enforce 阶段取不到证据必须红（fail-closed）')
})

// ── #2745 结构锁：本判据的输入在 docs-only 白名单里，它自己却住在被 docs-only 短路的 job ──
// 为什么必须锁 workflow 正文而不是脚本行为：`openspec/records/**` 命中 CI_IGNORED_PATHS 的
// `openspec/**`，而 `static-gates` 整个 job 被 `if: needs.changes.outputs.docs-only != 'true'` 门控。
// 于是「整篇没写执行记录」最高发的纯文档 PR，恰好是这条判据一次都不会执行的那一类。
// 短路真实发生过（不是理论）：PR #2732 判 docs-only=true，rollup 里 QG Static = SKIPPED 且照样合并。
// 同族先例与修法：`scripts/gate-record-debt-ledger.json` 同坑，PR #2718 把它自己的门禁搬进
// changes job 并留下位置判据 —— 本锁按同一形状写。
const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml')
const GATE_TEST_CMD = 'node --test scripts/check-pr-exec-record.test.js'
const GATE_CLI_CMD = 'node scripts/check-pr-exec-record.js'

// 工作区里的 .yml/.js 在本机是 CRLF（blob 才是 LF，且 core.autocrlf=false ⇒ 两者可以不一致）。
// 结构解析一律先归一到 LF 域，否则 '\njobs:\n' 这类锚点会被 '\r\n' 整条打穿 —— 表现是
// "锚点找不到"而不是"判据不成立"，读起来像 workflow 坏了。归一只用于解析，不回写文件。
//
// 同时剥离 YAML 注释行（QM-6 降级通道第一路命中 W2）：这些锁按**子串**匹配命令串，
// 若匹配域含注释，把真实步骤注释掉、只留一条含同字符串的注释，`at >= 0` 照样通过 ——
// 那是本仓点名的"装饰性门禁"。注释里提前出现字面 `exit 0` 也会污染"早于早退"的位置比较。
function stripYamlComments (text) {
  return text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
}

function readWorkflowForParse () {
  const rawBytes = fs.readFileSync(WORKFLOW_PATH, 'utf8')
  const crlf = (rawBytes.match(/\r\n/g) || []).length
  const raw = rawBytes.replace(/\r\n/g, '\n')
  assert.ok(raw.includes('\njobs:\n'), 'quality-gate.yml 里找不到 jobs: 段 —— 结构锁的锚点失效，须改锁不得改判据')
  const wf = stripYamlComments(raw)
  assert.ok(wf.length < raw.length, '剥离注释没有产生差异 —— 夹具里没有注释，这条域判据测不到东西')
  return { raw, wf, crlf }
}

function jobsOf (wf) {
  const blocks = {}
  let cur = null
  for (const line of wf.slice(wf.indexOf('\njobs:\n') + '\njobs:\n'.length).split('\n')) {
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (job) { cur = job[1]; blocks[cur] = ''; continue }
    if (/^[A-Za-z0-9_-]+:\s*$/.test(line)) { cur = null; continue }
    if (cur !== null) blocks[cur] += line + '\n'
  }
  assert.ok(Object.keys(blocks).length > 5,
    `解析出的 job 数只有 ${Object.keys(blocks).length} —— 解析退化，空/半空集合不得当作"没接线"的证据`)
  return blocks
}

test('#2745 前提：openspec/records 仍被同一份白名单判为 docs-only（前提变了须连同本锁重评）', () => {
  const classifier = require('./classify-docs-only.js')
  assert.ok(
    classifier.isDocsOnly(['openspec/records/some-branch.md']),
    'openspec/records 不再判为 docs-only ⇒ 短路前提消失，接线位置判据应连同白名单一起重新评估',
  )
})

test('#2745：门禁必须住在 changes job、住在 classify 步骤之后，且不得再留在 static-gates', () => {
  const { wf, crlf } = readWorkflowForParse()
  const jobs = jobsOf(wf)
  process.stdout.write(`[gate-2c2-wiring] worktree_crlf=${crlf} jobs=${Object.keys(jobs).length}\n`)
  assert.ok(jobs.changes && jobs.changes.length > 0, '未取到 changes job 正文')
  assert.ok(jobs['static-gates'] && jobs['static-gates'].length > 0, '未取到 static-gates job 正文')
  const classifyAt = jobs.changes.indexOf('- name: Detect docs-only changes')
  assert.ok(classifyAt >= 0, '未定位到 classify 步骤 —— 顺序判据失去锚点（改锁不得改判据）')
  for (const cmd of [GATE_TEST_CMD, GATE_CLI_CMD]) {
    const hits = wf.split(cmd).length - 1
    assert.strictEqual(hits, 1, `${cmd} 在 workflow 正文里出现 ${hits} 次：接线位置必须只有一处真源`)
    const at = jobs.changes.indexOf(cmd)
    assert.ok(at >= 0, `${cmd} 不在 changes job 里 ⇒ 纯文档 PR 短路 static-gates 后无人校验执行记录存在性`)
    // 后置于 classify 的理由（外部评审实测，纠正我原先"早于早退才覆盖 push"的判断）：
    // step 内的 `exit 0` 只结束该 step 的 shell，后续 step 照跑 ⇒ "早于早退"不换来任何覆盖差异；
    // 反过来，把这一步摆在 classify 之前，它一红（shell: bash 的 fail-fast）就让 changes job
    // 在写出 steps.classify.outputs.docs-only 之前中止，docs-only 判定整条消失、下游重型 job 全部跑满。
    assert.ok(at > classifyAt, `${cmd} 必须在 classify 步骤之后：本步不得先于 docs-only 输出，否则它一红就摧毁判定`)
    assert.ok(!jobs['static-gates'].includes(cmd), `${cmd} 仍留在被 docs-only 门控的 static-gates（接线未搬走）`)
  }
})

test('#2745：changes job 自身必须无条件执行（否则"搬到 changes 就覆盖纯文档 PR"这句承诺是空的）', () => {
  const { wf } = readWorkflowForParse()
  const changes = jobsOf(wf).changes
  assert.ok(!/^ {4}if:/m.test(changes),
    'changes job 出现了 job 级 if —— 一旦它按事件门控，搬到这里的门禁就不再覆盖纯文档 PR，而其余锁照绿')
  assert.ok(!/needs\.[a-z0-9-]+\.outputs\.docs-only/i.test(changes),
    'changes job 用别处产出的 docs-only 作门控 —— 它就是产出方，引用即自指')
})

test('#2745：static-gates 仍由 docs-only 门控（本锁的机制前提，被人摘掉门控时须连同本锁重评）', () => {
  const { wf } = readWorkflowForParse()
  const jobs = jobsOf(wf)
  assert.match(
    jobs['static-gates'],
    /if:\s*needs\.changes\.outputs\.docs-only\s*!=\s*'true'/,
    'static-gates 不再被 docs-only 门控 ⇒ 本锁的前提消失，须重新评估而不是把锁改成恒真',
  )
})

test('#2745：搬过去那一步必须用 step 级 env 声明 PR base，并保持 advisory（转阻断是单独一次有意动作）', () => {
  const { wf } = readWorkflowForParse()
  const changes = jobsOf(wf).changes
  const from = changes.indexOf(GATE_TEST_CMD)
  assert.ok(from >= 0, '门禁未接线进 changes job')
  const stepStart = changes.lastIndexOf('\n      - ', from)
  assert.ok(stepStart >= 0, '取不到承载门禁的那个 step 的起点 —— 结构解析退化')
  const nextStep = changes.indexOf('\n      - ', from)
  const step = changes.slice(stepStart, nextStep > 0 ? nextStep : undefined)
  assert.match(step, /EXEC_BASE:\s*\$\{\{\s*steps\.classify\.outputs\.pr-base\s*\}\}/,
    'PR base 必须由 step 级 env 声明（run 正文里禁止内联 ${{ }}，字面替换先于 bash 解析）；'
    + '且真源是 classify step 的产出 —— 同一份取源不得在两个 step 各算一遍，两份 merge-base 口径一旦漂移，'
    + '就会出现"同一 PR 在 classify 判 docs-only、在本判据判缺记录"这种不可归因的红')
  assert.match(step, /--base="\$\{EXEC_BASE:-\}"/,
    'base 必须可空：push 事件下脚本自己走「非 PR 不适用」分支，不得让每个 push run 被不适用自己的判据判红')
  // 分支名同样必须由 CI 侧注入：runner 上是 detached HEAD，`git rev-parse --abbrev-ref HEAD` 得到字面量
  // "HEAD"，只靠脚本自读会让"修订自己那篇记录"这条出路在 CI 上静默作废，而本机永远复现不了。
  assert.match(step, /EXEC_HEAD_REF:\s*\$\{\{\s*github\.event\.pull_request\.head\.ref\s*\}\}/,
    '必须由 step 级 env 注入 PR head 分支名（与 EXEC_BASE 同一模式）')
  assert.match(step, /--head-branch="\$\{EXEC_HEAD_REF:-\}"/,
    'CLI 必须收到 --head-branch，否则判据回落到 detached 的字面量 HEAD')
  assert.match(step, /--mode=advisory/,
    '本步必须仍是 advisory。转阻断 = 删掉这个参数，必须另 PR 并带实测影响面（本窗口 14/59 个纯文档 PR 在任何记录源里都没有记录）')
})

// ── #2745 顺带那条口径漂移：回填/修订型文档 PR 改的是自己那篇记录，却因没有 A 而判"没写记录" ──
test('M 自己分支那篇记录算「本 PR 携带了记录」；M 别人的记录仍不算', () => {
  const mine = mod.evaluate({
    statuses: st([['M', 'openspec/records/backfill-x.md']]),
    headBranch: 'backfill-x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main', 'backfill-x']),
  })
  assert.strictEqual(mine.ok, true, JSON.stringify(mine))
  assert.deepStrictEqual(mine.revisedRecords, ['openspec/records/backfill-x.md'])

  const theirs = mod.evaluate({
    statuses: st([['M', 'openspec/records/other.md']]),
    headBranch: 'x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main']),
  })
  // 出路④后语义更正：M 别人的记录恰好是纯回填形态，走出路④放行（不再是"没带记录"）；
  // 但它**不算**修订本分支记录（revisedRecords 保持空），两条判据的计数不得混同。
  assert.strictEqual(theirs.ok, true, JSON.stringify(theirs.reasons))
  assert.deepStrictEqual(theirs.revisedRecords, [])
  assert.deepStrictEqual(theirs.backfillRevised, ['openspec/records/other.md'])
})

test('同分支记录被 M 时仍不得与新增豁免并存（矛盾判定不因此放宽）', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/twin.md'], ['A', 'openspec/records/_exempt/twin.md']]),
    headBranch: 'twin',
    exemptOnDisk: [{ branch: 'twin', reason: '两个都交了' }],
    remoteBranches: new Set(['main', 'twin']),
  })
  assert.strictEqual(r.ok, false)
  assert.match(r.reasons.join('\n'), /矛盾|同时/)
})

// ── QM-6 降级通道第一路命中（W1）：CI 上 rev-parse 得到 detached HEAD ⇒ 放宽判据永不触发 ──
// actions/checkout 在 PR 上是 detached HEAD，`git rev-parse --abbrev-ref HEAD` 必返回字面量 "HEAD"，
// 于是 ownRecordPath 退化成 openspec/records/HEAD.md，"M 自己那篇"永远匹配不上 ——
// 而 CI 恰是这条判据唯一真正生效的地方（本机永远有真分支名）。
test('分支名解析优先级：显式参数 > GITHUB_HEAD_REF > git rev-parse；detached 且无 env 时不得猜', () => {
  const r = mod.resolveHeadBranch
  assert.strictEqual(typeof r, 'function', '必须导出 resolveHeadBranch（判据可单测，不留给宿主猜）')
  assert.deepStrictEqual(r({ argBranch: 'from-arg', envHeadRef: 'from-env', gitBranch: 'feat' }),
    { branch: 'from-arg', source: 'arg' })
  assert.deepStrictEqual(r({ argBranch: '', envHeadRef: 'from-env', gitBranch: 'feat' }),
    { branch: 'from-env', source: 'env' })
  assert.deepStrictEqual(r({ argBranch: '', envHeadRef: '', gitBranch: 'feat' }),
    { branch: 'feat', source: 'git' })
  // detached：rev-parse 的字面量 HEAD 不是分支名，无 env 时必须落成空串（偏严，绝不猜成 "HEAD"）
  assert.deepStrictEqual(r({ argBranch: '', envHeadRef: '', gitBranch: 'HEAD' }),
    { branch: '', source: 'detached' })
  assert.deepStrictEqual(r({ argBranch: '', envHeadRef: 'x', gitBranch: 'HEAD' }),
    { branch: 'x', source: 'env' })
})

test('真接缝：真 detached HEAD 的 git 夹具 + GITHUB_HEAD_REF ⇒ 修订自己那篇记录判为已携带', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-record-detached-'))
  const run = (args, opts = {}) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', ...opts })
  run(['init', '--quiet', '-b', 'main'])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'test'])
  fs.mkdirSync(path.join(dir, 'openspec', 'records'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'openspec', 'records', 'feat.md'), '初稿\n', 'utf8')
  run(['add', '.']); run(['commit', '--quiet', '-m', 'base'])
  run(['checkout', '--quiet', '-b', 'feat'])
  fs.writeFileSync(path.join(dir, 'openspec', 'records', 'feat.md'), '回填远程同步行\n', 'utf8')
  run(['add', '-A']); run(['commit', '--quiet', '-m', 'backfill'])
  // 关键一步：与 PR runner 一致地摘掉分支，使 rev-parse --abbrev-ref HEAD 返回字面量 HEAD
  run(['checkout', '--quiet', '--detach'])
  assert.strictEqual(run(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'HEAD',
    '夹具没有真的进入 detached 状态 —— 本用例的前提消失')

  const cli = (env) => {
    try {
      return execFileSync(process.execPath, [
        path.join(__dirname, 'check-pr-exec-record.js'),
        `--repo=${dir}`, '--base=main', '--head=HEAD', '--mode=advisory', '--no-remote',
      ], { encoding: 'utf8', env: { ...process.env, ...env } })
    } catch (e) { return String(e.stdout || '') + String(e.stderr || '') }
  }
  const withEnv = cli({ GITHUB_HEAD_REF: 'feat' })
  assert.match(withEnv, /修订本分支记录 1 篇/, 'CI 侧（有 GITHUB_HEAD_REF）必须认得"修订自己那篇"')
  assert.match(withEnv, /OK: 本 PR 携带执行记录/)
  // 没有 env 时必须如实落到 detached，不得把字面量 HEAD 当分支名去匹配 openspec/records/HEAD.md
  const withoutEnv = cli({ GITHUB_HEAD_REF: '' })
  assert.doesNotMatch(withoutEnv, /openspec\/records\/HEAD\.md/, 'detached 时不得拿字面量 HEAD 当分支名')
  fs.rmSync(dir, { recursive: true, force: true })
})

// ── QM-6 降级通道两路共同命中（W2）：结构锁按子串命中，注释里的同名字符串不得算接线 ──
test('结构锁的匹配域必须剥离 YAML 注释（把真步骤改成注释即判"未接线"）', () => {
  const { raw, wf } = readWorkflowForParse()
  assert.ok(/\n\s*#/.test(raw), 'workflow 里没有注释行 —— 这条域判据测不到东西')
  assert.ok(!/^\s*#/m.test(wf.split('\n').filter((l) => l.includes(GATE_TEST_CMD))[0] || ''),
    '匹配域里仍含注释行')
  assert.ok(wf.includes(GATE_TEST_CMD), '正文里确实有接线（剥离注释后仍在）')
  // 把真实那一行注释掉：剥离后必须整条消失，否则"没接线"这一判据永远不会红（装饰性门禁）
  const masked = wf.replace('          ' + GATE_TEST_CMD, '          # ' + GATE_TEST_CMD)
  assert.ok(!stripYamlComments(masked).includes(GATE_TEST_CMD),
    '真步骤改成注释后仍被算作接线 —— 这条锁是装饰性的')
})

// ── 出路④ × #3396 自动 stage：审计产物（.ccg/reviews/<40hex>.json）的新增不算夹带 ──
// 动因（实测 PR #3432）：#3396 让 pre-commit 把本次提交产生的判定记录一并 stage 进同一个提交，
// 于是「在任何跑过门禁的 worktree 里做纯回填」必然被④判成夹带新增 ⇒ 本地 enforce 恒红。
// 放宽只允许发生在**一个维度**上：状态必须是 A、文件名必须是 .ccg/reviews/<40 位小写十六进制>.json。
// 其余形态（大写、短 sha、别的后缀、M、D、别的目录、非载体文件）一律仍不算纯回填，
// 且 C2 收紧（至少一篇记录 M）不得被这些新增一起绕过。
const HEX40 = '0123456789abcdef0123456789abcdef01234567'
const AUDIT_PATH = '.ccg/reviews/' + HEX40 + '.json'

test('出路④放行审计产物新增，但只在 A + 精确文件名形态这一格', () => {
  const f = mod.isPureBackfillChangeSet
  assert.strictEqual(f(st([['M', 'openspec/records/a.md'], ['A', AUDIT_PATH]])), true,
    '记录 M + 审计产物 A 必须算纯回填（这条就是 PR #3432 被误判的形态）')
  assert.strictEqual(f(st([['M', 'openspec/records/a.md'], ['M', '.quality-gates.md'], ['A', AUDIT_PATH], ['A', '.ccg/reviews/' + HEX40.replace(/0$/, '1') + '.json']])), true,
    '多条审计产物 A 同时出现也必须算纯回填（钩子一次可能 stage 多条）')
})

test('审计产物白名单不得被形态邻近的写法穿过', () => {
  const f = mod.isPureBackfillChangeSet
  const near = [
    ['A', '.ccg/reviews/deadbeef.json'],                       // 短 sha
    ['A', '.ccg/reviews/x.json'],                              // 非 sha
    ['A', '.ccg/reviews/' + HEX40 + '.tmp.json'],              // 尾巴多一段
    ['A', '.ccg/reviews/' + HEX40.toUpperCase() + '.json'],    // 大写十六进制
    ['A', '.ccg/reviews/' + HEX40 + '.json.bak'],              // 换后缀
    ['A', '.ccg/reviews/sub/' + HEX40 + '.json'],              // 子目录
    ['A', '.ccg/' + HEX40 + '.json'],                          // 少一层目录
    ['M', AUDIT_PATH],                                         // 改既有审计产物（不是新增）
    ['D', AUDIT_PATH],                                         // 删他人审计产物一律不许借道
    ['A', 'docs/' + HEX40 + '.json'],                         // 别的目录同样形态
    ['A', 'scripts/evil.js'],                                  // 真·功能新增
    ['A', 'openspec/records/' + HEX40 + '.md'],                // 借记录名伪装
  ]
  near.forEach((e) => {
    assert.strictEqual(f(st([['M', 'openspec/records/a.md'], e])), false,
      `夹带形态必须仍判不是纯回填（${e[0]} ${e[1]}）`)
  })
})

test('审计产物不得替代 C2 收紧（只有记录 M 才算回填，光有 A 判定记录不构成）', () => {
  const f = mod.isPureBackfillChangeSet
  assert.strictEqual(f(st([['A', AUDIT_PATH]])), false, '只新增审计产物、无记录 M ⇒ 不是纯回填')
  assert.strictEqual(f(st([['M', '.quality-gates.md'], ['A', AUDIT_PATH]])), false,
    '只改门禁清单不带任何记录文件 ⇒ 仍不是纯回填（C2 那扇门不得被重新打开）')
  assert.strictEqual(f(st([['M', 'scripts/gate-record-debt-ledger.json'], ['A', AUDIT_PATH]])), false,
    '只改账本不带记录文件 ⇒ 同上')
})

test('evaluate 层：纯回填 + 审计产物新增 ⇒ 放行；纯回填 + 功能新增 ⇒ 仍红', () => {
  const okWithAudit = mod.evaluate({
    statuses: st([['M', '.quality-gates.md'], ['M', 'openspec/records/podcast-episode-x.md'],
      ['M', 'scripts/gate-record-debt-ledger.json'], ['A', AUDIT_PATH]]),
    headBranch: 'gate-backfill-x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main', 'gate-backfill-x']),
  })
  assert.strictEqual(okWithAudit.ok, true, '审计产物不得让合规回填判红（PR #3432 的现状）')

  const stillRed = mod.evaluate({
    statuses: st([['M', '.quality-gates.md'], ['M', 'openspec/records/podcast-episode-x.md'],
      ['M', 'scripts/gate-record-debt-ledger.json'], ['A', 'apps/desktop/electron/sneaky.js']]),
    headBranch: 'gate-backfill-x',
    exemptOnDisk: [],
    remoteBranches: new Set(['main', 'gate-backfill-x']),
  })
  assert.strictEqual(stillRed.ok, false, '夹带功能代码必须仍判红——本次放宽只动审计产物那一格')
})

// ── QM-6 降级通道第一路命中（W3）：保留名撞上分支名时，"改模板"就满足判据 ──
test('保留名（_TEMPLATE 这类）即便等于分支名也不得算修订记录', () => {
  const r = mod.evaluate({
    statuses: st([['M', 'openspec/records/_TEMPLATE.md']]),
    headBranch: '_TEMPLATE',
    exemptOnDisk: [],
    remoteBranches: new Set(['main', '_TEMPLATE']),
  })
  assert.deepStrictEqual(r.revisedRecords, [], 'RECORDS_RE 的保留名守卫必须同样作用于修订路径')
  assert.strictEqual(r.ok, false, '只改模板不得满足"本 PR 携带执行记录"')
})
