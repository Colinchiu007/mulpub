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
// 放宽只允许发生在**一个维度**上：状态必须是 A、文件名必须是 .ccg/reviews/<40 或 64 位小写十六进制>.json
// （2026-10-17 更正：原注释写「<40 位小写十六进制>」，与已放宽的 AUDIT_ARTIFACT_RE 不同步；
//  位宽与 alt 形态的**机器可验**口径见文件末尾「遗留收口」那条派生锁）。
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

// ── 2026-10-15 增：CCG 深度审查欠账（缺陷 D） ──────────────────────────
//
// 动因：ccg-review-decider 对 mode != skip 的改动会置
//   deepReview: { required: true, status: "pending", performedBy: null }
// 但没有任何环节检查它是否被执行过。而 ccg-gate.js 里 verify-quality /
// verify-change 都是「仅告警不阻断」，于是「需要深度审查」在流程上完全静默。
// 实测：我自己的 PR 就带着一条 pending 记录合了，直到用户问才发现。

/** 造一个临时 repo，写入给定的 .ccg/reviews 记录 */
function withReviewRecords (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-debt-'))
  for (const [name, rec] of Object.entries(files)) {
    const p = path.join(dir, '.ccg', 'reviews')
    fs.mkdirSync(p, { recursive: true })
    fs.writeFileSync(path.join(p, name), JSON.stringify(rec), 'utf8')
  }
  return dir
}

const SHA40 = 'a'.repeat(40)

test('缺陷D：deepReview.required=true 且 status=pending ⇒ 必须报欠账', () => {
  const repo = withReviewRecords({
    [`${SHA40}.json`]: { mode: 'dual', deepReview: { required: true, status: 'pending', performedBy: null } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(
      st([['A', `.ccg/reviews/${SHA40}.json`]]),
      repo
    )
    assert.strictEqual(r.checked, 1)
    assert.strictEqual(r.reasons.length, 1, `应报 1 条欠账理由，实际 ${r.reasons.length}`)
    assert.match(r.reasons[0], /深度审查欠账/, '理由必须点名是「深度审查欠账」')
    assert.match(r.reasons[0], /deep-review\.sh/, '理由必须给出补跑命令，否则不可执行')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('缺陷D反证：deepReview 已是闭环状态（白名单内）不得报欠账', () => {
  // 注意用 'cleared' 而不是自造的 'done' —— 判据是**闭环白名单**，
  // 白名单外的任何值（含看起来很像成功的 'done'）都会被判欠账。
  const repo = withReviewRecords({
    [`${SHA40}.json`]: { mode: 'dual', deepReview: { required: true, status: 'cleared', performedBy: 'claude' } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(
      st([['A', `.ccg/reviews/${SHA40}.json`]]),
      repo
    )
    assert.strictEqual(r.checked, 1)
    assert.deepStrictEqual(r.reasons, [], '已闭环不得报欠账')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('缺陷D（实测形态）：self_play_pending 必须算欠账 —— 黑名单写法正是在这里漏掉的', () => {
  // 真实事故：引擎跑完 writeBack 写的是 self_play_pending
  // （= 自扮演裁决「5/5 条仍无 verdict」，公开承认未闭环），
  // 而初版判据写的是 `status === 'pending'`（黑名单）⇒ 静默放行。
  const repo = withReviewRecords({
    [`${SHA40}.json`]: {
      mode: 'dual',
      deepReview: { required: true, status: 'self_play_pending', performedBy: 'self-play(pending)' },
    },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['M', `.ccg/reviews/${SHA40}.json`]]), repo)
    assert.strictEqual(r.reasons.length, 1, 'self_play_pending 必须被判欠账')
    assert.match(r.reasons[0], /self_play_pending/, '理由里必须点名真实状态，便于归因')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('缺陷D：fail-closed —— 未知状态与缺失状态都算欠账（引擎新增状态不得自动放行）', () => {
  const cases = [
    { name: '未知状态', deepReview: { required: true, status: 'some_future_status' } },
    { name: 'status 缺失', deepReview: { required: true } },
    { name: 'status 非字符串', deepReview: { required: true, status: 42 } },
    { name: 'engine 报错', deepReview: { required: true, status: 'error' } },
    { name: '升级待外部复核', deepReview: { required: true, status: 'escalated' } },
    { name: '评审不完整', deepReview: { required: true, status: 'incomplete_review' } },
    { name: '阻断', deepReview: { required: true, status: 'blocked' } },
  ]
  for (const c of cases) {
    const repo = withReviewRecords({ [`${SHA40}.json`]: { mode: 'dual', deepReview: c.deepReview } })
    try {
      const r = mod.evaluateDeepReviewDebt(st([['A', `.ccg/reviews/${SHA40}.json`]]), repo)
      assert.strictEqual(r.reasons.length, 1, `${c.name} 必须被判欠账（fail-closed）`)
    } finally { fs.rmSync(repo, { recursive: true, force: true }) }
  }
})

test('缺陷D：白名单本身必须是非空且只含「已出裁决」的形态（防止被改成空集=全放行）', () => {
  const wl = mod.CLOSED_DEEP_REVIEW_STATUSES
  assert.ok(wl instanceof Set, '必须导出 Set 供本锁核对')
  assert.ok(wl.size > 0, '白名单为空 ⇒ 所有记录都被判欠账，等于门禁失效（方向相反但同样不可用）')
  for (const forbidden of ['pending', 'self_play_pending', 'error']) {
    assert.ok(!wl.has(forbidden), `未闭环状态 ${forbidden} 绝不允许出现在闭环白名单里`)
  }
})

test('缺陷G：mode=single 不得被要求闭环「双模型深度审查」（否则形成无法闭合的循环）', () => {
  // 引擎对 mode !== 'skip' 一律置 deepReview.required = true —— 那是「是否需要评审」，
  // 不是「是否需要双模型深度评审」。判定器自己把两者分得很清楚：
  //   dual   → 「要求 双模型(<critic> + <proposer>) 深度审查」（后端对由清单派生，不写死名字）
  //   single → 「常规专家分派」（§12.6）
  // 初版对 single 也要求闭环 ⇒ 每次提交都要跑 15 分钟双模型审查，
  // 而写完审查结果再提交时又生出新的 single 记录 ⇒ 无法闭合。本 PR 实测撞上过。
  const single = withReviewRecords({
    [`${SHA40}.json`]: { mode: 'single', deepReview: { required: true, status: 'pending' } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', `.ccg/reviews/${SHA40}.json`]]), single)
    assert.deepStrictEqual(r.reasons, [], 'single 未闭环不得判欠账')
    assert.strictEqual(r.checked, 1, '仍须被检查到（不是跳过文件）')
  } finally { fs.rmSync(single, { recursive: true, force: true }) }

  // 反向锁：dual 未闭环必须判欠账 —— 防止「为省事把判据整个关掉」
  const dual = withReviewRecords({
    [`${SHA40}.json`]: { mode: 'dual', deepReview: { required: true, status: 'pending' } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', `.ccg/reviews/${SHA40}.json`]]), dual)
    assert.strictEqual(r.reasons.length, 1, 'dual 未闭环必须判欠账（原始诉求不能被收窄掉）')
  } finally { fs.rmSync(dual, { recursive: true, force: true }) }
})

test('缺陷D：mode=skip 的记录（required=false）不得报欠账', () => {
  const repo = withReviewRecords({
    [`${SHA40}.json`]: { mode: 'skip', deepReview: { required: false, status: 'pending', performedBy: null } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(
      st([['A', `.ccg/reviews/${SHA40}.json`]]),
      repo
    )
    assert.strictEqual(r.checked, 1)
    assert.deepStrictEqual(r.reasons, [], 'docs-only 快通道的 skip 不得被当成欠账')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('缺陷D：本次变更集不涉及任何 .ccg 记录时不得报（不扫全仓历史）', () => {
  const repo = withReviewRecords({
    [`${SHA40}.json`]: { mode: 'dual', deepReview: { required: true, status: 'pending', performedBy: null } },
  })
  try {
    // 变更集里没有 .ccg/reviews 文件 —— 那条 pending 是历史遗留，不该拦本 PR
    const r = mod.evaluateDeepReviewDebt(
      st([['A', 'scripts/foo.js']]),
      repo
    )
    assert.strictEqual(r.checked, 0)
    assert.deepStrictEqual(r.reasons, [], '不得扫全仓历史 pending，否则所有 PR 都会被历史遗留拦红')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('缺陷D：损坏的 JSON 记录不抛异常，但必须点名出声（实测没有任何别的门禁在校验它可解析）', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-debt-'))
  const p = path.join(repo, '.ccg', 'reviews')
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, `${SHA40}.json`), '{ 这不是合法 JSON', 'utf8')
  try {
    const r = mod.evaluateDeepReviewDebt(
      st([['A', `.ccg/reviews/${SHA40}.json`]]),
      repo
    )
    assert.strictEqual(r.checked, 1, '损坏记录仍算「本次涉及」')
    assert.match(r.reasons.join('\n'), /解析不动/, '损坏记录必须点名出声，不能再交给一个并不存在的「别的门禁」')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})


// ═══════════════════════════════════════════════════════════════════
// 记录名内容寻址（ccg-record-content-addressing，2026-10-16）
// ═══════════════════════════════════════════════════════════════════

const HEX64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const AUDIT_PATH64 = '.ccg/reviews/' + HEX64 + '.json'

test('内容寻址：64 位十六进制的记录名也必须算审计产物（新方案正向锁）', () => {
  const f = mod.isPureBackfillChangeSet
  assert.strictEqual(f(st([['M', 'openspec/records/a.md'], ['A', AUDIT_PATH64]])), true,
    '新命名（64 位）的审计产物 A 必须与旧的 40 位同等放行；否则每次提交都会被判夹带')
})

test('第三轮 i2：-again- alt 形态也必须算审计产物（否则 amend 提交被假判非纯回填）', () => {
  // 判定器在「同名记录已有实质内容」时把本次判定另存为
  // <64hex>-again-<40sha>-<ISO时间戳>.json。钩子若 stage 它，而本正则不认这个形态
  // ⇒ 出路④判「非纯回填」而**假红**；不 stage 则审查结论与门禁脱钩。
  const HEX40 = '0123456789abcdef0123456789abcdef01234567'
  const alt = '.ccg/reviews/' + HEX64 + '-again-' + HEX40 + '-20261016T063000Z.json'
  assert.strictEqual(mod.isPureBackfillChangeSet(st([['M', 'openspec/records/a.md'], ['A', alt]])), true,
    'alt 形态必须被认，否则 amend 后的提交会被判夹带')
  const altMs = '.ccg/reviews/' + HEX64 + '-again-' + HEX40 + '-20261016T063000.123Z.json'
  assert.strictEqual(mod.isPureBackfillChangeSet(st([['M', 'openspec/records/a.md'], ['A', altMs]])), true,
    '带毫秒的时间戳也必须被认')
})

test('第三轮 i2 负向：alt 形态的邻近写法仍必须被拒（放宽不得连坐）', () => {
  const HEX40 = '0123456789abcdef0123456789abcdef01234567'
  const near = [
    '.ccg/reviews/' + HEX64 + '-again-' + HEX40 + '.json',
    '.ccg/reviews/' + HEX64 + '-again-' + HEX40 + '-20261016.json',
    '.ccg/reviews/' + HEX64 + '-again-' + HEX40 + '-20261016T0630Z.json',
    '.ccg/reviews/' + HEX64 + '-again-' + HEX40.toUpperCase() + '-20261016T063000Z.json',
    '.ccg/reviews/' + HEX64 + '-again.json',
    '.ccg/reviews/' + HEX64 + '-again-x.json',
    '.ccg/reviews/' + HEX64 + '-again-' + HEX40 + '-20261016T063000Z.json.bak',
    '.ccg/reviews/sub/' + HEX64 + '-again-' + HEX40 + '-20261016T063000Z.json',
  ]
  near.forEach((p) => {
    assert.strictEqual(mod.isPureBackfillChangeSet(st([['M', 'openspec/records/a.md'], ['A', p]])), false,
      `alt 邻近形态必须仍判不是纯回填（${p}）`)
  })
})

test('内容寻址：邻近形态仍必须被拒（放宽不得连坐）', () => {
  const f = mod.isPureBackfillChangeSet
  const near64 = [
    ['A', '.ccg/reviews/' + HEX64.slice(0, 63) + '.json'],   // 63 位
    ['A', '.ccg/reviews/' + HEX64 + '0.json'],               // 65 位
    ['A', '.ccg/reviews/' + HEX64.toUpperCase() + '.json'],  // 大写
    ['A', '.ccg/reviews/' + HEX64 + '.json.bak'],            // 换后缀
    ['A', '.ccg/reviews/sub/' + HEX64 + '.json'],            // 子目录
    ['A', '.ccg/' + HEX64 + '.json'],                        // 少一层目录
    ['M', AUDIT_PATH64],                                     // 改既有（不是新增）
    ['D', AUDIT_PATH64],                                     // 删他人记录
  ]
  near64.forEach((e) => {
    assert.strictEqual(f(st([['M', 'openspec/records/a.md'], e])), false,
      `邻近形态必须仍判不是纯回填（${e[0]} ${e[1]}）`)
  })
})

test('fail-open 反向锁：64 位命名的 dual+pending 记录仍必须判欠账', () => {
  // 这是本方案最大的风险：若 AUDIT_ARTIFACT_RE 放宽后**没接进**欠账检查，
  // 新命名的记录会对门禁隐形 —— 门禁从「看得见但撞名」退化成「完全看不见」。
  const repo = withReviewRecords({
    [HEX64 + '.json']: { mode: 'dual', deepReview: { required: true, status: 'pending', performedBy: null } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', '.ccg/reviews/' + HEX64 + '.json']]), repo)
    assert.strictEqual(r.checked, 1, '新命名记录必须进入检查范围，否则是 fail-open')
    assert.strictEqual(r.reasons.length, 1, `新命名的未闭环 dual 记录必须报欠账，实际 ${r.reasons.length}`)
    assert.match(r.reasons[0], /深度审查欠账/)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('口径不倒退：64 位命名的 single+pending 不得判欠账（缺陷G 的收窄保持）', () => {
  const repo = withReviewRecords({
    [HEX64 + '.json']: { mode: 'single', deepReview: { required: true, status: 'pending', performedBy: null } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', '.ccg/reviews/' + HEX64 + '.json']]), repo)
    assert.strictEqual(r.checked, 1)
    assert.deepStrictEqual(r.reasons, [], 'single 不得因改名而开始要求闭环（那是已被修掉的不收敛循环）')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})


// ═══════════════════════════════════════════════════════════════════
// QM-6 复审追加（2026-10-16）：i1 的 fail-open 收口 + i2 口径统一
// ═══════════════════════════════════════════════════════════════════

test('QM-6 i1：deep-review.sh 找不到记录时必须点名「commit -a 分叉」，不许静默 exit 0', () => {
  // 实测：git commit -a 时 A(--cached) != B(HEAD^..HEAD)，判定器按 A 取名落盘、
  // 脚本按 B 找不到 ⇒ 深度审查被跳过。旧命名下这只是「漏跑」；新命名下它会
  // **掩盖一个真实故障**，所以早退前必须给出可执行的自检命令。
  //
  // 判据取**实质**而非字面：必须点名实测故障形态（commit -a）+ 给出两个口径的自检命令。
  // 首版用「内容寻址分叉」字面做锚，结果文案一改写锁就假红 —— 那是判据脆弱，不是实现错。
  const sh = fs.readFileSync(path.join(__dirname, 'deep-review.sh'), 'utf8')
  // ★ 锚点必须是**行首代码形态**，不能用裸字符串：脚本注释里就写着「静默 exit 0」
  // （L523），裸 indexOf('exit 0') 会命中注释 ⇒ 判据假红（本轮实测踩过两次）。
  // 用 /^ {2}exit 0$/m 只匹配行首两个空格 + exit 0 的代码行。
  const codeExits = [...sh.matchAll(/^ {2}exit 0$/gm)].map((m) => m.index)
  const iNoRec = sh.indexOf('判定记录: 无')
  const iWarn = sh.indexOf('git commit -a')
  // 取「判定记录: 无」之后的第一个**代码** exit 0 —— 即它所在 if 块的早退点
  const iExit = codeExits.find((p) => p > iNoRec)
  assert.ok(iWarn > 0, '告警段必须点名实测故障形态 git commit -a')
  assert.ok(iExit !== undefined, '找不到早退 exit 0，本锁需同步更新')
  assert.ok(iWarn < iExit, '告警必须在早退 exit 0 之前，否则永不输出')
  const seg = sh.slice(iWarn, iExit)
  assert.doesNotMatch(seg, /^ {2}exit 0$/m, '告警段自身不得含 exit 0（否则会吃掉「之后第一个 exit 0」这个锚点）')
  assert.match(sh, /git diff --cached --no-textconv --no-ext-diff --no-renames -- \. ':\(exclude\)\.ccg'/,
    '告警里必须给出可复现的自检命令（提交前口径），否则读者无从判断')
  assert.match(sh, /git diff HEAD\^ HEAD --no-textconv --no-ext-diff --no-renames -- \. ':\(exclude\)\.ccg'/,
    '必须同时给出提交后口径的自检命令 —— 只给一条无法判断是否分叉')
})

test('QM-6 i2（2026-10-20 随实现迁移改写）：判定面不得消费 .ccg，而命名配方必须继续排除它', () => {
  // 原锁的意图有两条，写法只测到一条：
  //   ①「同一份 diff 不得判出两种 mode」—— 当年靠两条 git 命令都带 :(exclude).ccg 实现；
  //   ②「记录命名不得因 .ccg 而回落」—— 靠 stagedDiffHash 那次**独立** git 调用带 pathspec。
  // 原实现把①写成了 grep collectStaged 的字面 ⇒ 它锁的是**机制**而不是意图：
  // change: ccg-decider-exclude-self-artifacts 把排除从 git pathspec 移到 JS 单点谓词
  // （实测：pathspec 让 .ccg 在 git 层就消失，report-only 计数在暂存档恒为 0 —— 观测点被自己关掉）。
  // 所以①现在只能按行为测；②照旧按配方测（那一条没迁移，仍然必须在）。
  const dec = require('./ccg-review-decider.js')
  // 夹具必须与真实生产者同形：纯 .ccg 的暂存改动，collectFromDiff 现在产出的是
  // changedLines 有行、codeChangedLines 空、ccgChangedLines 有行。把产物行同时塞进 codeChangedLines
  // 去断言"judge 不看 codeChangedLines"是一条假不变式 —— judge 本来就该看它。
  const mk = (lines) => ({
    files: [{ file: '.ccg/reviews/a.json', rawFile: '.ccg/reviews/a.json', binary: false, added: lines.length, deleted: 0 }],
    changedLines: lines, codeChangedLines: [], docChangedLines: [], ccgChangedLines: lines,
    lineReadGaps: [], codeFiles: [],
  })
  const judged = dec.judge(mk(['const apiSecret = "x";', '// 加密说明']))
  assert.strictEqual(judged.stats.changedLines, 0, '判定面的规模不得消费 .ccg 行（行为断言，不是 grep 字面）')
  assert.strictEqual(judged.stats.sensitiveContentHits, 0, '判定面的敏感内容命中不得消费 .ccg 行')
  assert.ok(judged.stats.ccgSensitiveContentHits >= 1, '被排除的命中必须仍被计数（排除的是消费，不是观测）')
  assert.strictEqual(dec.isSelfArtifact('.ccg/reviews/a.json'), true, '谓词必须认得自身产物')
  assert.strictEqual(dec.isSelfArtifact('scripts/a.js'), false, '谓词不得把源码读成自身产物（读成即整条敏感判定失明）')
  const src = fs.readFileSync(path.join(__dirname, 'ccg-review-decider.js'), 'utf8').replace(/\r\n/g, '\n')
  const h = src.indexOf('diff", "--cached", "--no-textconv"')
  assert.ok(h > 0, 'stagedDiffHash 的那次 git 调用必须还能定位到（搬家了就要同步本锁，不得让它静默失效）')
  assert.match(src.slice(h, h + 200), /:\(exclude\)\.ccg/,
    '命名配方必须继续排除 .ccg —— 这一条没随本刀迁移；摘掉它会让纯产物提交与真实提交算出同一个键，回到要消灭的撞名')
})

test('遗留收口：提示文案必须**由判据生成**，且源码里不得再出现手写的位宽说明', () => {
  // 动因（2026-10-17，收口 #3772 登记的遗留）：出路④的提示文案原先**手写**了
  // `<40 位小写十六进制>`。判据在 #3755 放宽为「40 或 64 位 + alt 形态」时漏改这条文案
  // ⇒ 按提示排障的人会把 64 位记录误判成「不算纯回填」，于是给一个真实满足④的 PR
  // 硬加一份本不需要的记录文件（#3772 上实际踩到）。
  //
  // ★ 本锁针对的**不是**「两处写一样」，而是「只剩一处」：
  //   实现已把文案改成由 `describeAuditWidths()` 生成（位宽由正则**行为**推出）。
  //   所以这里核两件事：
  //     ① 生成结果与判据行为一致（生成器本身没写错）；
  //     ② 源码里**所有**形如 `<N [或 M] 位小写十六进制>` 的短语都必须**逐字等于**生成结果
  //        —— 有人手写第二处，当场红。
  //
  // ★ QM-6 评审 6 条全部指向上一版锁的脆弱性，本版逐条收口：
  //   i1 只按正则字面形状抠 `\{(\d+)\}` ⇒ 改成**行为探测**（等价改写 `{40,64}`/`.{40}`/大写 都不受影响）
  //   i2/i5/i6 靠硬编码中文锚点切片 ⇒ **不再切片**，改为全源码逐处核对短语
  //   i3 `new RegExp` 丢 flags ⇒ 不再从源码重建正则，直接用模块导出的常量
  //   i4 只探全 a 串与相邻宽度 ⇒ 补 alt 形态、非十六进制拒绝、前后缀拒绝
  const gate = require('./check-pr-exec-record.js')
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  // ★ 只扫**代码行**，剥掉纯注释行：注释不面向用户，且禁止注释引用形态会让这把锁敌视文档
  //   （本仓已确立同型做法：结构类判据必须先剥注释行再断言，否则会被「字面在注释里」骗过或反向误伤）。
  // ★ QM-6 第二轮 i2：只剥**全行**注释不够 —— 行尾注释（`const x = 1 // <40 位…>`）会留在 code 里，
  //   于是被 matchAll 当成「手写第二处」，或者反过来让真正的第二处藏进注释而漏检。
  //   所以先剥行内 `//...` 再剥全行注释。
  //   已知代价：字符串里的 `//`（如 URL）会被一并截断 —— 但那只会让**注释后半段**不参与扫描，
  //   真实字符串里的手写短语在 `//` 之前就完整保留，方向安全（宁可漏掉注释，不可漏掉代码）。
  // 剥注释的实现已抽成 gate 的纯函数 stripCommentsForScan()（可单独单测，见本条末尾的 i2 行为用例），
  // 这里只消费它 —— 判据本体与「给判据看的代码视图」共用同一实现，避免两处各写一份再漂移。
  const code = gate.stripCommentsForScan(src)

  // ① 生成结果与判据行为一致
  const widths = gate.auditAcceptedWidths()
  assert.ok(widths.length > 0,
    'AUDIT_ARTIFACT_RE 在探测范围 ' + gate.AUDIT_NAME_WIDTH_MIN + '..' + gate.AUDIT_NAME_WIDTH_MAX
    + ' 内不接受任何十六进制名 —— 判据可能被改写成行为探测覆盖不到的形态（fail-closed）')
  for (const w of widths) {
    assert.ok(gate.AUDIT_ARTIFACT_RE.test('.ccg/reviews/' + 'a'.repeat(w) + '.json'),
      `声明的 ${w} 位记录名必须真的能通过 AUDIT_ARTIFACT_RE`)
  }
  // 相邻（未被接受的）位宽必须真的过不了 —— 防止「声明 N 位但正则实际是别的宽度」
  for (const off of [-1, 1]) {
    const probe = widths[0] + off
    if (probe <= 0 || widths.includes(probe)) continue
    assert.ok(!gate.AUDIT_ARTIFACT_RE.test('.ccg/reviews/' + 'a'.repeat(probe) + '.json'),
      `${probe} 位记录名不得通过（否则「${widths[0]} 位」这个声明是假的）`)
  }
  // 非十六进制必须被拒（QM-6 i4：此前只探全 a 串，锚定/字符类坏了可能探不出）
  for (const bad of ['g', 'A', '-', '_', ' ']) {
    const w = widths[0]
    assert.ok(!gate.AUDIT_ARTIFACT_RE.test('.ccg/reviews/' + bad.repeat(w) + '.json'),
      `${JSON.stringify(bad)} 不是小写十六进制，重复 ${w} 次必须被拒`)
  }
  // 路径外的同形名字必须被拒（锚定检查）
  assert.ok(!gate.AUDIT_ARTIFACT_RE.test('x/.ccg/reviews/' + 'a'.repeat(widths[0]) + '.json'),
    '前导路径必须被拒（^ 锚定）')
  assert.ok(!gate.AUDIT_ARTIFACT_RE.test('.ccg/reviews/' + 'a'.repeat(widths[0]) + '.json.bak'),
    '多余后缀必须被拒（$ 锚定）')

  const expected = gate.describeAuditWidths()
  assert.strictEqual(expected, '<' + widths.join(' 或 ') + ' 位小写十六进制>',
    '生成器必须把**全部**被接受的位宽都写出来（少写会误导，多写会让人以为存在那种形态）')

  // ② 源码里所有手写形态的位宽短语，都必须逐字等于生成结果（不得有第二处真源）
  const found = [...code.matchAll(/<\s*\d+(?:\s*或\s*\d+)*\s*位小写十六进制\s*>/g)].map((m) => m[0])
  for (const phrase of found) {
    assert.strictEqual(phrase, expected,
      '源码里出现了手写的位宽说明 ' + JSON.stringify(phrase)
      + '，但判据生成的是 ' + JSON.stringify(expected)
      + ' —— 文案必须由 describeAuditWidths() 生成，不得另外手写一处（那正是本次要修的遗留）')
  }
  // 接线锁：生成器必须真的被**调用**进文案里。
  // 不写成「源码里必须出现 expected 这个字面量」——因为 expected 是运行时生成的，
  // 要求它出现在源码里等于要求手写一份，与本次修法自相矛盾。
  // ★ 必须是**拼接形式** `+ describeAuditWidths()`，不能只出现标识符：
  //   M32 变异实测过「只查 /describeAuditWidths\(/」会被**函数定义与导出**那一行满足，
  //   于是把文案改回纯手写也照样绿 —— 接线锁必须锁「返回值被拼进文案」，而不是「函数存在」。
  assert.ok(/\+\s*describeAuditWidths\s*\(\s*\)/.test(code),
    '出路④的提示文案必须以拼接形式使用 describeAuditWidths()（+ describeAuditWidths()）生成位宽说明，'
    + '不得手写（手写即第二处真源；函数"存在"不算接线）')

  // ③ alt 形态同源：判据接受 ⇒ 文案由同一个探测结果拼出；不接受 ⇒ 文案不得声称
  const alt = gate.auditAcceptedAltForm()
  // 反向锁（QM-6 第二轮 i1/i3）：判据**明明接受**一个真实 alt 形态时，探测不得报 null。
  // 否则一旦探测范围塌缩（例如把 AUDIT_ALT_SHA_MAX 改小），alt 相关的断言整段被跳过 ⇒ 静默失效。
  const realisticAlt = '.ccg/reviews/' + 'a'.repeat(widths[0]) + '-again-' + 'b'.repeat(40) + '-20261017T120000Z.json'
  if (gate.AUDIT_ARTIFACT_RE.test(realisticAlt)) {
    assert.ok(alt !== null,
      '判据接受 ' + realisticAlt + ' ⇒ auditAcceptedAltForm() 必须报出 alt 形态，不得返回 null'
      + '（返回 null 会让 alt 相关断言整段静默跳过）')
  }
  if (alt) {
    assert.ok(gate.AUDIT_ARTIFACT_RE.test(
      '.ccg/reviews/' + 'a'.repeat(64) + '-again-' + 'b'.repeat(40) + '-20261017T120000Z.json'),
    '探测说接受 alt 形态，实际必须真能过')
    assert.ok(/\+\s*auditAcceptedAltForm\s*\(\s*\)/.test(code),
      'alt 形态说明必须以拼接形式使用 auditAcceptedAltForm()（+ auditAcceptedAltForm()），不得手写')
    // QM-6 第二轮 i1/i3 后，alt 的 sha 宽度与 ISO 段也由**探测**得出，不再是硬编码字面量。
    // 所以这里核三件事，且都不依赖「某段字面量恰好长什么样」：
    //  a) 探测出的每个 sha 宽度都真能过、且紧邻宽度真过不了（行为自洽）
    //  b) 描述由探测结果拼出（shaWidths 与 isos 都出现在 description 里）
    //  c) 代码行里不得出现第二处 \`-again-<\` 字面量（唯一真源仍只有生成器）
    for (const w of alt.shaWidths) {
      assert.ok(gate.AUDIT_ARTIFACT_RE.test(
        '.ccg/reviews/' + 'a'.repeat(widths[0]) + '-again-' + 'b'.repeat(w) + '-20261017T120000Z.json'),
      '探测出的 alt sha 宽度 ' + w + ' 必须真能过判据')
    }
    for (const off of [-1, 1]) {
      const probe = alt.shaWidths[0] + off
      if (probe < 1 || alt.shaWidths.includes(probe)) continue
      assert.ok(!gate.AUDIT_ARTIFACT_RE.test(
        '.ccg/reviews/' + 'a'.repeat(widths[0]) + '-again-' + 'b'.repeat(probe) + '-20261017T120000Z.json'),
      'alt sha 宽度 ' + probe + ' 必须被拒（否则「' + alt.shaWidths[0] + ' 位」是假声明）')
    }
    assert.ok(alt.description.includes('<' + alt.shaWidths.join(' 或 ') + ' 位 sha>'),
      'alt 描述里的 sha 宽度必须由探测结果拼出，实际描述 = ' + JSON.stringify(alt.description))
    for (const iso of alt.isos) {
      assert.ok(alt.description.includes(iso),
        'alt 描述必须包含探测到的 ISO 形态 ' + JSON.stringify(iso) + '，实际 = ' + JSON.stringify(alt.description))
    }
    // 接线锁（QM-6 第二轮 i1/i3 的**残余**，必须单独锁）：
    // 光"描述里出现了正确宽度"不够 —— 硬编码的 `-again-<40 位 sha>` 在 sha 宽度恰好是 40 时
    // 会**碰巧**通过。所以要锁「描述是**拼**出来的」：代码行里必须出现 shaWidths.join / isos.join。
    assert.ok(/shaWidths\.join\s*\(/.test(code),
      'alt 描述里的 sha 宽度必须由 shaWidths.join() 拼出，不得硬编码（硬编码在数值恰好相同时会假绿）')
    assert.ok(/isos\.join\s*\(/.test(code),
      'alt 描述里的 ISO 段必须由 isos.join() 拼出，不得硬编码')
    const altLiteralCount = (code.match(/-again-</g) || []).length
    assert.strictEqual(altLiteralCount, 1,
      'alt 形态说明在代码行里只允许出现 1 处（生成器拼接的那处）；实际 ' + altLiteralCount
      + ' 处 ⇒ 有人手写了第二处，或生成器被拆散')
  }
  // ★ QM-6 第二轮 i2 的**行为用例**：注释剥离必须同时覆盖「全行注释」与「行尾注释」，
  //   且不得把真实字符串里的短语一起吃掉。三条一起才能证明这个是判据，不是巧合。
  const PH = '<40 位小写十六进制>'
  assert.ok(!gate.stripCommentsForScan('// 说明 ' + PH).includes(PH),
    '全行注释里的位宽短语必须被剥掉（否则派生锁会反向误伤自己的文档）')
  assert.ok(!gate.stripCommentsForScan('const x = 1 // 说明 ' + PH).includes(PH),
    '**行尾注释**里的位宽短语也必须被剥掉（只剥全行注释不够 —— 这正是 i2 指出的）')
  assert.ok(gate.stripCommentsForScan("msg = '允许 ' + " + JSON.stringify(PH)).includes(PH),
    '真实字符串里的位宽短语**不得**被剥掉（剥过头就再也发现不了手写第二处）')
  assert.ok(!gate.stripCommentsForScan(' * 块注释续行 ' + PH).includes(PH),
    '块注释续行（* 开头）必须被剥掉')
  // ★ QM-6 第三轮 i3 的行为用例：`//` 在**字符串里**时不得被当成注释起点。
  //   首版无条件 /\/\/.*$/ 会把 "http://x" 之后整段截掉 —— 方向是「少扫」，
  //   但藏在被截断区段里的手写短语就会**假绿**。引号感知版必须保住它。
  assert.ok(gate.stripCommentsForScan("const u = 'http://x/' + " + JSON.stringify(PH)).includes(PH),
    '字符串里的 // （URL）不得触发截断 —— 否则它后面的手写短语会被静默漏检')
  assert.ok(!gate.stripCommentsForScan("const u = 1 // " + PH).includes(PH),
    '真正在引号外的 // 之后必须被剥掉')
  assert.ok(gate.stripCommentsForScan('const s = "a\\"b//c" + ' + JSON.stringify(PH)).includes(PH),
    '转义引号内的 // 也不得触发截断')

  // ★ QM-6 第三轮 i2/i5 的行为用例：位宽探测必须**缓存且冻结**，
  //   两次调用返回同一个对象 ⇒ alt 探测与主探测共用同一次快照，不可能读到不一致结果。
  const w1 = gate.auditAcceptedWidths()
  const w2 = gate.auditAcceptedWidths()
  assert.strictEqual(w1, w2,
    'auditAcceptedWidths() 必须缓存（同一数组身份）——否则 193 次探测每次重跑，且与 alt 探测可能不同步')
  assert.ok(Object.isFrozen(w1),
    'auditAcceptedWidths() 的结果必须冻结 —— 调用方（含测试）不得就地改动这份「唯一真源」')

  // CRLF 回归锁：CRLF 文本与 LF 文本必须得到同样的结果（否则 `.` 不匹配 \r 的坑会重现）
  assert.deepStrictEqual(
    gate.stripCommentsForScan('const a = 1 // x\r\n// y\r\nconst b = 2'),
    gate.stripCommentsForScan('const a = 1 // x\n// y\nconst b = 2'),
    'CRLF 与 LF 必须剥出相同结果（规范化 \\r\\n 那一步不能省）')

})

// ── 扫描域 × 命名形态演进（0386afdfc = #3755 内容寻址命名）────────────────────
// 该次改动把判定记录改名成 .ccg/reviews/<stagedDiffHash>.json（64 位十六进制，见
// ccg-review-decider.js:496-500 的 recordFileName：拿到 64 位哈希就用它，否则退回 40 位），
// 并在**同一个 PR** 里放宽了 AUDIT_ARTIFACT_RE（现认 40hex / 64hex / -again-<40hex>-<时间戳>），
// 还自带一条「fail-open 反向锁：64 位命名的 dual+pending 记录仍必须判欠账」（见本文件 970 行附近）。
// ⚠ 本节初稿写的是「新产物对扫描完全隐形」——那是**误判**：取证读的是共享根工作副本里
//   #3755 之前的旧行号，把快照当成了现状。实测主干 845 个产物（761 个 40 位 + 17 个 64 位）
//   全部参与判定，且那 17 个正是改名之后的新产物。
// 真正没被覆盖的是「下一次再改命名」：那时若没人同步放宽形态表，involved 会静默缩到 0，
// 而 `involved.length === 0` 的早退让「扫到 0 条」与「没有欠账」逐字同形。
// 下面三条锁守的是这一格（前瞻 + 不过宽），不是已修好的那一格；
// 另记一条方法论：新写锁之前先 grep 同名/同格既有锁——本节初稿的 57 号用例就与 970 行逐字同格，已删。
const SHA64 = 'b'.repeat(64)
const SHA56 = 'c'.repeat(56) // 假想的「下一次改名」——出声判据必须接住它，而不是只补今天这一格

test('扫描域正控：64 位命名 + 外部轴闭环 ⇒ 不得报欠账（防「多扫一点就全红」）', () => {
  const repo = withReviewRecords({
    [`${SHA64}.json`]: { mode: 'dual', deepReview: { required: true, status: 'cleared', performedBy: 'claude' } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', `.ccg/reviews/${SHA64}.json`]]), repo)
    assert.strictEqual(r.checked, 1)
    assert.deepStrictEqual(r.reasons, [], '已闭环不得因命名形态变化而误报')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('扫描域不得静默收窄：形态不认识但确实是评审记录 ⇒ 必须出声（而不是当作没扫到）', () => {
  const repo = withReviewRecords({
    [`${SHA56}.json`]: { mode: 'dual', deepReview: { required: true, status: 'pending', performedBy: null } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', `.ccg/reviews/${SHA56}.json`]]), repo)
    assert.strictEqual(r.reasons.length, 1, `不认识形态必须报 1 条，实际 ${r.reasons.length}`)
    assert.match(r.reasons[0], /扫描域形态不认识|形态不认识/)
    assert.ok(r.reasons[0].includes(SHA56), '必须点名是哪个文件，否则下一次没人能归因')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('扫描域不得过宽：同目录里的非评审 json 不得触发上述出声', () => {
  // 主干 .ccg/reviews 下另有 67 个非 sha 命名的入库原件（workflowstructure-* 等），
  // 若把"目录里有 json"一律当失明来喊，会让正常文档 PR 无故变红——那是把一条锁换成噪音。
  const repo = withReviewRecords({ 'workflowstructure-notes.json': { hello: 1 } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', '.ccg/reviews/workflowstructure-notes.json']]), repo)
    assert.deepStrictEqual(r.reasons, [])
    assert.strictEqual(r.checked, 0)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

// ── 删除方向不得逃逸：changedInDir 原先只筛 A/M，于是 `git rm` 一条 pending 的 dual 产物
// 就等于把欠账连记录一起抹掉，而且不报错。这不是假想场景：并行会话 #3776 现场正是
// 「中途提交被判 dual+pending、永久挡住 PR」，其合规出口写的是「把 status 改成闭环值」；
// 而删除是同一条出口的免审计版本。修法是读 base blob 判内容，读不到必须出声而不是静默。
const SHA64B = 'd'.repeat(64)
const SHA64C = 'e'.repeat(64)

test('删除方向不得逃逸：D 掉的是一条未闭环 dual 记录 ⇒ 必须报欠账并点名', () => {
  const repo = withReviewRecords({}) // 工作树里已经没有它了（这正是 D 的含义）
  const baseContent = JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'pending', performedBy: null } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['D', `.ccg/reviews/${SHA64B}.json`]]), repo, () => baseContent)
    assert.strictEqual(r.reasons.length, 1, `删除未闭环 dual 记录必须报 1 条，实际 ${r.reasons.length}`)
    assert.match(r.reasons[0], /删除/)
    assert.match(r.reasons[0], /深度审查欠账|未闭环/)
    assert.ok(r.reasons[0].includes(SHA64B), '必须点名是哪条记录')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('删除方向不得误喊①：D 掉的是已闭环 dual 记录 ⇒ 正常清理，不得出声', () => {
  const repo = withReviewRecords({})
  const baseContent = JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'cleared', performedBy: 'claude' } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['D', `.ccg/reviews/${SHA64B}.json`]]), repo, () => baseContent)
    assert.deepStrictEqual(r.reasons, [])
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('删除方向不得误喊②：D 掉的是 single 记录 ⇒ 与缺陷G 口径一致，不得报（否则把噪音当防线）', () => {
  const repo = withReviewRecords({})
  const baseContent = JSON.stringify({ mode: 'single', deepReview: { required: true, status: 'pending', performedBy: null } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['D', `.ccg/reviews/${SHA64B}.json`]]), repo, () => baseContent)
    assert.deepStrictEqual(r.reasons, [])
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('删除方向不得误喊③：D 掉的非评审 json ⇒ 不得报', () => {
  const repo = withReviewRecords({})
  try {
    const r = mod.evaluateDeepReviewDebt(st([['D', '.ccg/reviews/workflowstructure-notes.json']]), repo, () => JSON.stringify({ hello: 1 }))
    assert.deepStrictEqual(r.reasons, [])
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('删除方向不得把「读不到 base」读成「没欠账」：取不到内容必须出声（未证实 ≠ 已通过）', () => {
  const repo = withReviewRecords({})
  try {
    // 浅克隆 / base ref 解不出来 / 没注入第三个参数，三种情况都必须落在这条出口上
    const r1 = mod.evaluateDeepReviewDebt(st([['D', `.ccg/reviews/${SHA64B}.json`]]), repo, () => { throw new Error('fatal: bad object') })
    assert.strictEqual(r1.reasons.length, 1, `读不到 base 必须出声，实际 ${r1.reasons.length}`)
    assert.match(r1.reasons[0], /读不到|未证实|无法取证/)
    const r2 = mod.evaluateDeepReviewDebt(st([['D', `.ccg/reviews/${SHA64C}.json`]]), repo)
    assert.strictEqual(r2.reasons.length, 1, '未注入 readAtBase（第三个参数缺失）同样必须出声')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('接线锁：main() 必须把 base 读取器传给 evaluateDeepReviewDebt（三参数调用）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  assert.match(src, /evaluateDeepReviewDebt\(statuses, repo, [A-Za-z_$]/,
    '只补判据不接线等于没修 —— 调用点必须显式传第三个参数')
})
test('刀A §7.4-A：alt 形态必须接受生产方真实投影（候选表与正则不得同源于想象）', () => {
  const { AUDIT_ARTIFACT_RE: RE } = require('./check-pr-exec-record.js')
  const sha = 'a'.repeat(40)
  // 形态由生产方决定：投影现算，不从判据/候选表取（否则探针与判据继续同源同错）
  const stamp = new Date().toISOString().replace(/[:.]/g, '')
  assert.match(stamp, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{9}Z$/, '生产方投影形态变了，本锁的前提需重估：' + stamp)
  assert.ok(RE.test('.ccg/reviews/' + sha + '-again-' + 'b'.repeat(40) + '-' + stamp + '.json'), '判据仍拒绝生产方写出的文件名：' + stamp)
  const src = require('fs').readFileSync(require('path').join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  assert.ok(src.indexOf("text: '-2026-10-18T021638562Z'") >= 0, '生产方形态未进候选表 ⇒ 行为探测看不见它')
})

test('刀A §7.4-B：新增位数形态不得退化成通配（逐位负控）', () => {
  const { AUDIT_ARTIFACT_RE: RE } = require('./check-pr-exec-record.js')
  const p = (iso) => '.ccg/reviews/' + 'a'.repeat(40) + '-again-' + 'b'.repeat(40) + '-' + iso + '.json'
  assert.ok(RE.test(p('2026-10-18T021638562Z')), '正控必须接受')
  for (const bad of ['2026-10-18T02163856Z', '2026-10-18T0216385622Z', '2026-10-18T021638562',
    '202610180T021638562Z', '2026-10-18t021638562Z', '2026-1-18T021638562Z']) {
    assert.strictEqual(RE.test(p(bad)), false, '负控被放过（退化风险）：' + bad)
  }
})

// ══════════════════════════════════════════════════════════════════════════
//  后端请求值 × 实际执行者对账（change: qm6-review-backend-config）
//  本刀的全部理由：status 是「有人写了个词」，performedBy 才是「谁真的跑了」。
// ══════════════════════════════════════════════════════════════════════════

test('judgeBackendMismatch：不适用必须返回 null，且三种不适用各自点名理由', () => {
  const J = mod.judgeBackendMismatch
  assert.strictEqual(typeof J, 'function', '判据必须导出，否则本锁退化成读源码字面')

  // ① 历史产物没有 reviewBackends ⇒ 不判（**不得追溯变红**，这是本刀能安全上线的前提）
  assert.strictEqual(J({
    mode: 'dual',
    deepReview: { required: true, status: 'cleared', performedBy: 'claude' },
  }), null, '无 reviewBackends 的旧记录不得被判不符')

  // ② 闭环状态 + 空 performedBy ⇒ **必须报**（QM-6 评审 i1/i4 采纳后改窄）：
  //   「cleared」是一个断言，没有署名执行者的断言没有凭据；只在覆盖时追责会让默认
  //   路径整体不设防，而那正是绝大多数 PR 走的路径。
  assert.strictEqual(typeof J({
    reviewBackends: { critic: 'codex', proposer: 'opencode', overridden: true },
    deepReview: { status: 'cleared', performedBy: '' },
  }), 'string', '闭环却无署名执行者必须报')
  // 未闭环 + 空 performedBy ⇒ 不重复报（交回闭环判据，避免同一屏两条诊断互相误导）
  assert.strictEqual(J({
    reviewBackends: { critic: 'codex', proposer: 'opencode', overridden: true },
    deepReview: { status: 'pending', performedBy: '' },
  }), null, '未闭环时空 performedBy 不在本判据里重复报')
  // 未覆盖 + 空 performedBy + 闭环 ⇒ 仍报（署名义务不分档）
  assert.strictEqual(typeof J({
    reviewBackends: { critic: 'codex', proposer: 'opencode' },
    deepReview: { status: 'cleared', performedBy: '   ' },
  }), 'string', '署名义务不得被 overridden 挡掉')

  // ③ performedBy 读不出任何后端名（自扮演 / agent 自评那类）⇒ 本判据不管
  assert.strictEqual(J({
    reviewBackends: { critic: 'codex', proposer: 'opencode', overridden: true },
    deepReview: { status: 'self_play_resolved', performedBy: 'self-play' },
  }), null, '自扮演不是「换了后端」，归自扮演豁免那条管')

  // 相符 ⇒ null（三种合规写法都要认，不得只认全等）
  // 复合名（评审 i5）：请求名作为**有界子串**出现在任一记号里即算相符 ——
  // claude-agent / codex_cli / 带前缀的产物名都不该被误判成不符（那是假红）。
  for (const performed of ['codex', 'claude+codex', 'codex, opencode', ' CODEX ',
    'claude-agent+opencode', 'x_codex_v2', 'we-codex-them']) {
    assert.strictEqual(J({
      reviewBackends: { critic: 'codex', proposer: 'opencode', overridden: true },
      deepReview: { status: 'cleared', performedBy: performed },
    }), null, `应判相符：${performed}`)
  }
  // 请求的 proposer 出现在执行者里也算相符（覆盖只换了 critic 时不得误拦）
  assert.strictEqual(J({
    reviewBackends: { critic: 'codex', proposer: 'opencode', overridden: true },
    deepReview: { status: 'cleared', performedBy: 'opencode' },
  }), null)
})

test('judgeBackendMismatch：闭环但执行者是别的后端 ⇒ 出声并写出两侧值', () => {
  const J = mod.judgeBackendMismatch
  const r = J({
    reviewBackends: { critic: 'codex', proposer: 'opencode', from: { critic: 'env' }, overridden: true },
    deepReview: { status: 'cleared', performedBy: 'claude' },
  })
  assert.strictEqual(typeof r, 'string', '必须报不符，实得 ' + JSON.stringify(r))
  assert.match(r, /codex/)
  assert.match(r, /claude/)
  // 同族单后端配置下只写一个名字，不得凭空补一个 proposer
  const same = J({
    reviewBackends: { critic: 'codex', proposer: 'codex', overridden: true },
    deepReview: { status: 'cleared', performedBy: 'claude' },
  })
  assert.match(same, /^codex ≠ claude$/)
})

test('evaluateDeepReviewDebt 真跑：不符判红、相符判过、无字段的历史产物不追溯（三条互不成全）', () => {
  const os = require('node:os')
  const fsp = require('node:fs')
  const pth = require('node:path')
  const repo = fsp.mkdtempSync(pth.join(os.tmpdir(), `qm6-debt-${process.pid}-`))
  try {
    // rel 一律用 **正斜杠**：判据的 REVIEWS_DIR_RE 匹配的是 git 风格的仓库相对路径，
    // 而 pth.join 在 Windows 上给反斜杠 ⇒ 扫描域会静默收 0 条，"三条都没读"读起来像全绿。
    const write = (name, rec) => {
      fsp.mkdirSync(pth.join(repo, '.ccg', 'reviews'), { recursive: true })
      fsp.writeFileSync(pth.join(repo, '.ccg', 'reviews', name), JSON.stringify(rec))
      return '.ccg/reviews/' + name
    }
    const mk = (performedBy, withField) => {
      const rec = {
        mode: 'dual',
        decidedAt: '2026-10-18T00:00:00.000Z',
        deepReview: { required: true, status: 'cleared', performedBy },
      }
      if (withField) rec.reviewBackends = { critic: 'codex', proposer: 'opencode', overridden: true }
      return rec
    }
    const mismatchFile = write('a'.repeat(40) + '.json', mk('claude', true))
    const okFile = write('b'.repeat(40) + '.json', mk('codex', true))
    const legacyFile = write('c'.repeat(40) + '.json', mk('claude', false))
    // 逐条用自己的 sha 前缀做指纹：用路径片段会命中三条共有的 `.ccg/reviews` 前缀，
    // 那种断言既不红也不证任何东西（本仓「探针恒真」同型）。
    const FP = { bad: 'a'.repeat(12), ok: 'b'.repeat(12), legacy: 'c'.repeat(12) }

    const statuses = [mismatchFile, okFile, legacyFile].map((f) => ({ status: 'A', file: f }))
    const r = mod.evaluateDeepReviewDebt(statuses, repo, () => null)

    // ★ 必须断言「扫到了几条」，只看"有没有红"会把"三条都没被读"读成相符/历史两档都成立。
    assert.strictEqual(r.checked, 3, `判定域应为 3 条，实得 ${r.checked} —— 文件名形态没被认领会恒 0`)
    const joined = r.reasons.join('\n')
    assert.match(joined, /后端不符/, `应报后端不符，实得：${joined}`)
    assert.ok(joined.includes(FP.bad), '理由必须点名那条不符的记录文件：' + joined)
    assert.ok(mismatchFile.includes(FP.bad), '夹具自证：指纹必须落在被报的那条上')
    assert.ok(!joined.includes(FP.ok), '相符那条不得被报：' + joined)
    assert.ok(!joined.includes(FP.legacy), '无字段的历史产物不得被追溯报：' + joined)

    // 反向自证：把不符那条改成相符，整屏必须全绿（证明上面那条红不是恒真判据）
    const allOk = [write('d'.repeat(40) + '.json', mk('codex', true)), okFile, legacyFile]
      .map((f) => ({ status: 'A', file: f }))
    const r2 = mod.evaluateDeepReviewDebt(allOk, repo, () => null)
    assert.strictEqual(r2.checked, 3)
    assert.deepStrictEqual(r2.reasons, [], `全相符应无理由，实得：${r2.reasons.join(' | ')}`)
  } finally {
    fsp.rmSync(repo, { recursive: true, force: true })
  }
})

test('后端对账的四档「不适用」必须各自可证，其中「没覆盖过」那一档不得被恒真掩盖', () => {
  const J = mod.judgeBackendMismatch
  // ② overridden 不为 true ⇒ 不判。这一档是**风险最大的假绿位**：
  //   如果判据实际不看 overridden，那"没覆盖过所以不判"的断言会与"相符所以不判"完全同形，
  //   上一组用例就一条都没测到东西。所以这里要造一个**两侧确实不同**的记录：
  //   只有当判据真的按 overridden 收口时，它才返回 null。
  assert.strictEqual(
    J({
      reviewBackends: { critic: 'codex', proposer: 'opencode' }, // 无 overridden
      deepReview: { status: 'cleared', performedBy: 'claude' },
    }),
    null,
    '未显式覆盖 ⇒ 驱动默认值就是权威，不得把上游默认与本仓清单的差异判成失守'
  )
  // 对照：同一份记录只是补上 overridden:true，就必须出声（证明上一条不是因为"名字相同"而 null）
  assert.strictEqual(
    typeof J({
      reviewBackends: { critic: 'codex', proposer: 'opencode', overridden: true },
      deepReview: { status: 'cleared', performedBy: 'claude' },
    }),
    'string',
    '补上 overridden 后必须变红 —— 否则上一条是恒真断言'
  )
  // ③ 自扮演闭合不插手（它是既有门禁显式承认的出口，收紧它属改豁免政策，须人工过目）
  assert.strictEqual(
    J({
      reviewBackends: { critic: 'codex', proposer: 'opencode', overridden: true },
      deepReview: { status: 'self_play_resolved', performedBy: 'self-play' },
    }),
    null,
    'self_play_resolved 归「高危域不得自扮演」那条管，本判据不得顺手判红'
  )
  // 但 cleared 顶着「自扮演字样」而没有真后端执行 ⇒ 必须报（status 说了谎就要抓）
  assert.strictEqual(
    typeof J({
      reviewBackends: { critic: 'codex', proposer: 'opencode', overridden: true },
      deepReview: { status: 'cleared', performedBy: 'self-play' },
    }),
    'string',
    'cleared + 无后端执行者必须报不符：闭环词表不是免检'
  )
})

test('有界子串口径的两条负控：碎片不得匹配、请求复合名而只跑简单名必须仍判不符', () => {
  // 评审 i5 采纳外部口径后的另一半：只修假红不修假绿。
  const J = mod.judgeBackendMismatch
  const base = (critic, performedBy) => J({
    reviewBackends: { critic, proposer: 'opencode', overridden: true },
    deepReview: { status: 'cleared', performedBy },
  })
  // 碎片不得把长名点着（clau ⊄ 边界内的 claude）
  assert.strictEqual(typeof base('clau', 'claude'), 'string', '碎片被误配 ⇒ 假绿')
  assert.strictEqual(typeof base('laude', 'claude'), 'string', '中段碎片被误配 ⇒ 假绿')
  // 请求复合名而实际只跑了简单名 ⇒ 仍是缺评审，必须报
  assert.strictEqual(typeof base('claude-agent', 'claude'), 'string',
    '请求 claude-agent 而实际 claude 必须仍判不符')
  // 同一份请求名作为完整记号出现 ⇒ 相符
  assert.strictEqual(base('claude-agent', 'claude-agent'), null, '完整记号应相符')
})

// ── QM-6 丙：分级与覆盖率读数（先可见不拦）──────────────────────────────────
test('丙 classifyEvidenceTier：闭集四档（含生产方写的 unknown）；空白先归一，野值另立 unrecognized', () => {
  const c = mod.classifyEvidenceTier
  assert.strictEqual(typeof c, 'function', '必须导出 classifyEvidenceTier')
  assert.strictEqual(c({ tier: 'external', evidence: '<TEMP>/qm6-backend.log#ses_probe0001' }), 'external')
  assert.strictEqual(c({ tier: 'external' }), 'external-unverified', '只有声明没有出处 ⇒ 不算外部证据')
  assert.strictEqual(c({ tier: 'external', evidence: '   ' }), 'external-unverified', '空白 evidence 等于没填')
  assert.strictEqual(c({ tier: 'external', evidence: 42 }), 'external-unverified', '非字符串 evidence 不得被 String() 蒙过去')
  assert.strictEqual(c({ tier: 'self-play' }), 'self-play')
  assert.strictEqual(c({ tier: 'none' }), 'none')
  // 口径变更（2026-10-19 后端轴 Critical#2 / Info#6）：旧版把"字段缺席"与"值写错/带空白"
  // 合成一个 unknown，于是**尾随空格**就是高危面上最廉价的绕行（掉进 unknown 被放过）。
  // 现在空白先归一，野值单独成 unrecognized 档。
  assert.strictEqual(c({ tier: ' external ', evidence: 'PR #3900' }), 'external',
    '尾随/前导空白不是另一种语义；不归一会把"删除字段"之外的最廉价注入留在绕行面上')
  assert.strictEqual(c({ tier: 'unknown' }), 'unknown', 'unknown 是生产方给新产物的初始值，必须仍在闭集内')
  for (const absent of [undefined, null, {}, { tier: null }, { tier: '   '}]) {
    assert.strictEqual(c(absent), 'unknown', '字段缺席 = 历史记录形态，不得与野值同档：' + JSON.stringify(absent))
  }
  for (const wild of [{ tier: 'External' }, { tier: 'claude' }, { tier: '自扮演' }, { tier: 42 }, { tier: { v: 1 } }]) {
    assert.strictEqual(c(wild), 'unrecognized', '字段在而值不认识 ⇒ 是写错或伪造的声明：' + JSON.stringify(wild))
  }
})

test('丙 summarizeTierCoverage：六档计数 + 空集也必须给读数（反失明）', () => {
  const s = mod.summarizeTierCoverage
  const r = s([
    { tier: 'external', evidence: 'ses_probe0001' }, { tier: 'external', evidence: 'PR #3777' },
    { tier: 'external' }, { tier: 'self-play' }, { tier: 'none' }, {}, { tier: 'CLAUDE' }
  ])
  assert.strictEqual(r.total, 7)
  assert.strictEqual(r.by.external, 2)
  assert.strictEqual(r.by['external-unverified'], 1)
  assert.strictEqual(r.by['self-play'], 1)
  assert.strictEqual(r.by.none, 1)
  assert.strictEqual(r.by.unknown, 1, '字段缺席')
  assert.strictEqual(r.by.unrecognized, 1, '值不认识必须单独成档，与缺席可分辨')
  assert.match(r.line, /TIER-COVERAGE/, '读数行必须有固定前缀，否则没人能在 CI 日志里 grep 到它')
  assert.match(r.line, /total=7/)
  assert.match(r.line, /unknown\(字段缺席\)=1 unrecognized\(值不认识\)=1/,
    `两档必须在打印面上就分形，否则"没人写 tier"与"有人写错 tier"同形：${r.line}`)
  const e = s([])
  assert.strictEqual(e.total, 0)
  assert.match(e.line, /TIER-COVERAGE .*total=0/, '空集不得"什么都不打印"——那与"没接这条锁"逐字同形')
})

test('丙：覆盖率**先可见不拦**——tier 缺失不得让 PR 变红（转拦另起一片）', () => {
  const repo = withReviewRecords({
    [SHA64 + '.json']: { mode: 'dual', deepReview: { required: true, status: 'cleared', performedBy: 'claude', findings: null } },
  })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', '.ccg/reviews/' + SHA64 + '.json']]), repo)
    assert.deepStrictEqual(r.reasons, [], '已闭环记录缺 tier 时只该出现在覆盖率读数里，不该在此刻判红（一上线红两百条＝逼人把门削宽）')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('丙：main 必须打印覆盖率行（接线锁，防"函数导出了但没人调"）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  assert.match(src, /summarizeTierCoverage\(/, 'main 里必须真的调用它')
  assert.match(src, /TIER-COVERAGE/, '读数行前缀必须出现在源码里（不是只存在于测试）')
})
// 升级：「先可见不拦」原来只断言纯函数 reasons 为空 ⇒ 把 ok=false 写进 applyDeepDebt
// 时全量 0 红（M-T5 实测），等于没锁。改成真跑一次 CLI：rc 与 stdout 都是产物。
test('丙：真跑 CLI —— dual+cleared 但无 tier 的记录必须 rc=0 且打印覆盖率行（可见不拦）', () => {
  const cp = require("child_process");const os = require("os");const path2 = require("path");
  const repo = fs.mkdtempSync(path2.join(os.tmpdir(), "tier-cli-"));
  const RUN = (a) => cp.execFileSync(process.execPath, a, { cwd: repo, encoding: 'utf8' });
  const RUNx = (a) => { try { const o = cp.execFileSync(process.execPath, a, { cwd: repo, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }); return { rc: 0, out: o } } catch (e) { return { rc: (e && e.status) || 1, out: String((e && e.stdout) || '') + String((e && e.stderr) || '') } } };
  const git = (a) => cp.execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  try {
    git(['init', '-q', '-b', 'main', repo]);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base']);
    git(['checkout', '-q', '-b', 'pr']);
    const HEATH = 'f'.repeat(64);
    fs.mkdirSync(path2.join(repo, '.ccg', 'reviews'), { recursive: true });
    fs.writeFileSync(path2.join(repo, '.ccg', 'reviews', HEATH + '.json'),
      JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'cleared', performedBy: 'claude', findings: null } }, null, 2), 'utf8');
    fs.mkdirSync(path2.join(repo, 'openspec', 'records'), { recursive: true });
    fs.writeFileSync(path2.join(repo, 'openspec', 'records', 'pr.md'), '---\nrecord: pr\n---\n\n## 记录\n', 'utf8');
    git(['add', '-A']);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'add artifact without tier']);
    const script = path2.join(__dirname, 'check-pr-exec-record.js');
    const res = RUNx([script, `--repo=${repo}`, '--base=main', '--head=pr', '--mode=enforce', '--no-remote']);
    assert.ok(/TIER-COVERAGE/.test(res.out), `stdout 必须含覆盖率行，实际 rc=${res.rc} 输出开头=${JSON.stringify(res.out.slice(0, 200))}`);
    assert.strictEqual(res.rc, 0, `覆盖率不得把 PR 判红（先可见不拦）。rc=${res.rc} out=${JSON.stringify(res.out.slice(0, 300))}`);
    // ★ 两档读数各**恰好一行**。本档走的是 --no-remote（r 与 r2 各调一次 applyDeepDebt），
    //   实跑现场是 TRANSITION-CHECK 逐字打了两遍而 TIER 只有一遍 —— 只断言"含这行"对重复完全免疫。
    const count = (needle) => res.out.split(needle).length - 1
    assert.strictEqual(count('TIER-COVERAGE'), 1, `覆盖率读数必须恰好打印一次，实际 ${count('TIER-COVERAGE')} 次`);
    assert.strictEqual(count('TRANSITION-CHECK'), 1, `转变读数必须恰好打印一次（打两遍与"量了两次两个数"在日志里无法分辨），实际 ${count('TRANSITION-CHECK')} 次`);
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

// ── 2026-10-17 后端轴 findings 的处置落锁（critical #1/#2/#3 + 自查发现的 A/M 逃逸）────
// 口径：这一批是「读不动 ≠ 没有」的第四与第五个落点 —— 此前注释写着"由别的门禁负责"，
// 实测全仓唯一另一处逐条 parse 的 ccg-gate.js 也是 catch 跳过 ⇒ 那句话声称的门禁不存在。
const SHA64U = 'd'.repeat(64)

test('后端命中：变更集里有解析不动的评审产物 ⇒ 必须点名出声（损坏不等于没欠账）', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-corrupt-'))
  const rel = '.ccg/reviews/' + SHA64U + '.json'
  fs.mkdirSync(path.join(repo, '.ccg', 'reviews'), { recursive: true })
  fs.writeFileSync(path.join(repo, rel), '{"mode":"dual","deepReview":{"status":"clea', 'utf8')
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', rel]]), repo, () => null)
    assert.strictEqual(r.reasons.length, 1, `解析不动的产物必须报 1 条，实际 ${r.reasons.length}：${JSON.stringify(r.reasons)}`)
    assert.match(r.reasons[0], /解析不动/, '文案必须点明是"读不动"，不能写成"没有欠账"')
    assert.ok(r.reasons[0].includes(SHA64U), '必须点名是哪个文件，否则归因不了')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('后端命中：D 掉的记录 base 内容解析不动 ⇒ 走未证实出口出声，不得静默 continue', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-corrupt-d-'))
  const rel = '.ccg/reviews/' + SHA64U + '.json'
  try {
    const r = mod.evaluateDeepReviewDebt(st([['D', rel]]), repo, () => '{"mode":"dual","xx')
    assert.strictEqual(r.reasons.length, 1, `base 读得动但解析不动必须报 1 条，实际 ${r.reasons.length}`)
    assert.match(r.reasons[0], /无法取证/, '必须走「未证实」这条既有出口')
    assert.ok(r.reasons[0].includes('base 内容解析不动'), '必须区分"读不到"与"读不动"，否则下一次排障找错方向')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('后端命中：evidence 必须是可核指针 —— 单个字符 x 不得被判成 external', () => {
  assert.strictEqual(mod.classifyEvidenceTier({ tier: 'external', evidence: 'x' }), 'external-unverified',
    '非空 ≠ 可复核：一个字符就声称做过外部评审，必须降级')
  assert.strictEqual(mod.classifyEvidenceTier({ tier: 'external', evidence: '我做过了' }), 'external-unverified',
    '自由文本散文同样不可核')
  for (const good of ['PR #3777 后端轴交付', 'ses_abc12345678', '3d77f06b-c417-436a-a513-aca14165aa3c']) {
    assert.strictEqual(mod.classifyEvidenceTier({ tier: 'external', evidence: good }), 'external',
      '可核形态（PR 引用 / 会话 id / uuid）应判 external：' + good)
  }
})

// ── tasks 2.x 收口矩阵 + tasks 8.1 转变检测（2026-10-19 降级梯 切片D）──────────────
// 场景脑暴（先想清再写）：
//   正常：高危面 + 真实外部出处 ⇒ 放行 / 非高危面 + self-play ⇒ 本切片不拦
//   异常：高危面 + self-play ⇒ 拦 / 任意面 + tier=none 却闭环 ⇒ 拦 / 伪造闭环（无出处无原因）⇒ 拦
//   边界：tier 缺失(unknown) ⇒ 不拦（转拦另片，防不可闭合循环）/ base 取不到 ⇒ 不得读成「没转变」
//   负控：清单只可缩小 / 每条前缀必须命中真实受管文件（命中 0 = 装饰前缀）
const RISK_GATE = 'scripts/check-pr-exec-record.js'
const SELF_PLAY = { required: true, status: 'self_play_resolved', tier: 'self-play', evidence: null, performedBy: 'self-play', findings: null }
const EXT_OK = { required: true, status: 'cleared', tier: 'external', evidence: 'ses_probe0001', performedBy: 'claude', findings: null }

function repoWithFile (rel, obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-matrix-'))
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, JSON.stringify(obj), 'utf8')
  return dir
}
const ART = '.ccg/reviews/' + 'f'.repeat(64) + '.json'

test('2.1 高危面清单：非空、每条前缀都命中真实受管文件（命中 0 即装饰）、规模下界', () => {
  const list = mod.HIGH_RISK_SURFACES
  assert.ok(Array.isArray(list) && list.length >= 6, `清单至少 6 类，实际 ${list && list.length}`)
  for (const s of list) {
    assert.ok(typeof s.prefix === 'string' && s.prefix.length > 0, '每条必须有 prefix')
    assert.ok(typeof s.why === 'string' && s.why.length >= 8, `前缀 ${s.prefix} 缺 why（无出处的条目不许进清单）`)
  }
  const tracked = require('node:child_process').execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean)
  for (const s of list) {
    // 归因**走判据自己的匹配实现**，不在这里重抄一遍前缀规则：
    // 一条 raw 命中 9、实际归因 7 的条目（`fingerprint` 加了 exts）用裸子串数会谎报覆盖面。
    const hits = tracked.filter((f) => mod.highRiskPrefixOf(f) === s.prefix).length
    assert.ok(hits >= 1, `前缀 ${s.prefix} 在当前实现下命中 0 个受管文件 ⇒ 它守的是一个不存在的面，是装饰性条目`)
  }
})

// ── 2026-10-19 QM-6 第二轴（跨家族 codex）11 条 findings 的处置落锁 ──────────────
// 口径：Critical 必修；Warning 逐条评估后修或否证。下面每条都指名它来自哪条 finding，
// 免得下一个会话把这批用例当"顺手加的测试"删掉。
const ART2 = '.ccg/reviews/' + 'a'.repeat(64) + '.json'

test('评审#6：高危面收口必须点名"是哪个文件把变更集拉进高危域"（否则误伤无法归因）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: SELF_PLAY })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART], ['M', RISK_GATE]]), repo, () => null)
    const block = r.reasons.find((x) => /收口不成立/.test(x)) || ''
    assert.ok(block.includes(RISK_GATE),
      `红文案必须写出触发高危面的具体文件（本仓判据纪律：误伤要先能归因），实际 ${JSON.stringify(block.slice(0, 260))}`)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('评审#1：出口文案不得示范自家合同禁止的动作（tier 目前只能由会话手写，必须把这层说出来）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: SELF_PLAY })
  try {
    const block = mod.evaluateDeepReviewDebt(st([['A', ART], ['M', RISK_GATE]]), repo, () => null)
      .reasons.find((x) => /收口不成立/.test(x)) || ''
    assert.match(block, /deep-review\.sh/, '第一出口必须是"跑真评审（工具回写）"')
    assert.match(block, /由会话手写/, '工具侧写入（tasks 8.1b）未落地 ⇒ 手写 tier 这件事必须在文案里说出来，不能装作它是合规路径')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('评审#2：同一产物同时命中矩阵与转变 ⇒ 只点名一次（"N 条"必须等于"N 篇产物"）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: SELF_PLAY })
  const base = JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'pending', tier: 'self-play' } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['M', ART], ['M', RISK_GATE]]), repo, () => base)
    const block = r.reasons.find((x) => /收口不成立/.test(x)) || ''
    const head = /收口不成立 (\d+) 条/.exec(block)
    assert.ok(head, `必须打出条数抬头，实际 ${JSON.stringify(block.slice(0, 200))}`)
    assert.strictEqual(Number(head[1]), 1, `一条产物被两条分支各数一遍 ⇒ 抬头虚高：${block.slice(0, 200)}`)
    const occurrences = block.split(ART).length - 1
    assert.strictEqual(occurrences, 1, `同一产物在红文案里出现 ${occurrences} 次，归因会变成两条独立欠账`)
    // 两种信息都不得丢：既要说收口的**分级**不对，也要说**这次动作**是凭空收口
    assert.match(block, /高危面/)
    assert.match(block, /收口无出处/)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('评审#6：未闭环那一档的补救文案必须指名两个机械出口（照旧文案做会被新转变检测判红）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: { required: true, status: 'pending', tier: 'unknown' } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART]]), repo, () => null)
    const block = r.reasons.find((x) => /深度审查欠账/.test(x)) || ''
    assert.match(block, /closureNote/, '必须指名 closureNote 这个字段名 —— "写明原因"是散文，写字段才是出口')
    assert.match(block, /高危面|tier=external/, '必须区分两档出口：高危面要 tier=external + 可核 evidence')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('评审#8：转变读数不得是常量占位 —— 状态词由读数派生，且未证实要能归因', () => {
  const allGood = mod.summarizeTransitionCheck([{ file: ART, baseReadable: true, wasClosed: false, nowClosed: true, corroborated: true }])
  assert.match(allGood.line, /转变=通过/, `全核对且都有出处必须自己说出来：${allGood.line}`)
  assert.match(allGood.line, /扫描域=\d+/, '读数必须含扫描域规模，否则"没得核"与"核了全过"同形')
  const bad = mod.summarizeTransitionCheck([{ file: ART, baseReadable: false }])
  assert.match(bad.line, /转变=有疑/)
  assert.ok(bad.line.includes(ART), `未证实的条目必须点名（≤8 条），否则红完还不知道是哪篇：${bad.line}`)
  const none = mod.summarizeTransitionCheck([])
  assert.match(none.line, /转变=无转变/, '空集也要与"有待判项"区分：' + none.line)
})

test('评审#9：三个消费者必须逐输入同结论（行为一致性，不是 grep 形状）', () => {
  const files = [
    RISK_GATE, 'scripts/ccg-review-decider.js', 'scripts/deep-review.sh',
    '.github/workflows/quality-gate.yml', 'apps/desktop/electron/services/credential-store.js',
    'packages/api-publish-engine/src/auth/validate-account.js', 'packages/shared-utils/src/login-state.js',
    'apps/desktop/electron/services/draft-fingerprint.js', './scripts/check-pr-exec-record.js',
    'apps/desktop/electron/ipc-handlers/account.js', '01-docs/PRD.md',
  ]
  for (const f of files) {
    const hits = mod.highRiskHits([{ status: 'M', file: f }])
    assert.strictEqual(mod.isHighRiskSurface(f), hits.length > 0, `isHighRiskSurface 与 highRiskHits 对 ${f} 结论不同`)
    assert.strictEqual(mod.highRiskPrefixOf(f), hits.length > 0 ? hits[0].prefix : null, `highRiskPrefixOf 与 highRiskHits 对 ${f} 不同`)
  }
})

test('评审#4：高危面清单按成员钉死（静默删条目必须红，新增必须同时改这份基线）', () => {
  const PINNED = [
    'apps/desktop/electron/services/credential-',
    'apps/desktop/electron/services/account-state-lock.js',
    'packages/api-publish-engine/src/auth/',
    'packages/shared-utils/src/login-state.js',
    'fingerprint',
    '.github/workflows/',
    'scripts/check-',
    'scripts/ccg-review-',
    'scripts/lib/ccg-review-',
    'scripts/deep-review',
  ]
  const got = mod.HIGH_RISK_SURFACES.map((s) => s.prefix)
  assert.deepStrictEqual(got.slice().sort(), PINNED.slice().sort(),
    '清单变了 ⇒ 必须同时改本用例的基线并给出实测出处；这是"只能靠显式改动来放宽/收窄"的执行体')
  assert.strictEqual(got.length, PINNED.length)
})

test('评审#10：dual 产物被改名（R100/C75）不得静默逃出三个方向', () => {
  const OLD = '.ccg/reviews/' + 'b'.repeat(64) + '.json'
  const NEW = '.ccg/reviews/' + 'c'.repeat(64) + '.json'
  const repo = repoWithFile(NEW, { mode: 'dual', deepReview: { required: true, status: 'pending', tier: 'unknown' } })
  try {
    const r = mod.evaluateDeepReviewDebt(
      [{ status: 'R100', file: NEW, from: OLD }], repo,
      () => JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'pending' } }))
    const block = r.reasons.join('\n')
    assert.ok(block.length > 0, `改名携带未闭环产物必须出声（取源本来就同时给旧路径与新路径），实际理由为空`)
    assert.match(block, /改名|重命名/, `文案必须说出这是改名，不得伪装成"删除"或"新增"：${block.slice(0, 240)}`)
    assert.ok(block.includes(NEW) && block.includes(OLD), `两个路径都要点名，否则归因不到那一笔：${block.slice(0, 240)}`)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('评审#3：转变检测的 base 必须取 merge-base，不能取 base ref 的最新内容', () => {
  const cp = require('node:child_process')
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-mergebase-'))
  const git = (a) => cp.execFileSync('git', a, { cwd: repo, encoding: 'utf8' })
  const art = (obj) => {
    fs.mkdirSync(path.join(repo, '.ccg', 'reviews'), { recursive: true })
    fs.writeFileSync(path.join(repo, ART2), JSON.stringify(obj), 'utf8')
  }
  const commit = (m) => { git(['add', '-A']); git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', m]) }
  try {
    git(['init', '-q', '-b', 'main', repo])
    fs.mkdirSync(path.join(repo, 'openspec', 'records'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'openspec', 'records', 'pr.md'), '---\nrecord: pr\n---\n\n## 记录\n', 'utf8')
    art({ mode: 'dual', deepReview: { required: true, status: 'pending', tier: 'unknown' } })
    commit('merge-base：产物 pending')
    git(['checkout', '-q', '-b', 'pr'])
    art({ mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'self-play', performedBy: 'self-play' } })
    commit('pr：把 pending 改成 cleared，无出处')
    git(['checkout', '-q', 'main'])
    art({ mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'external', evidence: 'PR #3900', performedBy: 'claude' } })
    commit('main：他人把同一篇合规闭环（base ref 因此领先 merge-base）')
    // ★ 必须把工作树停在 pr：判据读产物内容走的是**工作树**（CI 检出的就是 PR head），
    //   停在 main 会让它读到别人那份 external 闭环，量的就不是这一次转变了。
    git(['checkout', '-q', 'pr'])
    const script = path.join(__dirname, 'check-pr-exec-record.js')
    let res
    try {
      res = { rc: 0, out: cp.execFileSync(process.execPath, [script, `--repo=${repo}`, '--base=main', '--head=pr', '--head-branch=pr', '--mode=enforce', '--no-remote'], { cwd: repo, encoding: 'utf8' }) }
    } catch (e) { res = { rc: (e && e.status) || 1, out: String((e && e.stdout) || '') + String((e && e.stderr) || '') } }
    assert.match(res.out, /收口无出处/,
      `读 main 的最新内容会把"他人已闭环"读成"本来就闭环"⇒ 凭空收口被静默放行。rc=${res.rc} out=${JSON.stringify(res.out.slice(0, 420))}`)
    assert.match(res.out, /base=pending/, '必须打印 merge-base 那侧的状态，归因才看得出取的是哪一份')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

// ── 2026-10-19 QM-6 后端轴（claude，session bc44397d-0f13-43f9-a814-82db03ed202c）────
test('评审C1：evidence 的"可核指针"形状必须拒绝 5 字符伪文件名与夹在噪声里的 40 hex', () => {
  assert.strictEqual(mod.isResolvableEvidence('x.md'), false,
    '`.md` 后缀出现在任意位置就算可核 ⇒ `evidence:"x.md"` 一句假声明即走高危面放行（后端轴 Critical#1）')
  assert.strictEqual(mod.isResolvableEvidence('see file: aaaa.md or b.md'), false, '夹在散文里的短文件名不算指针')
  assert.strictEqual(mod.isResolvableEvidence('reports/judge-report.md'), true, '真实文件名形态必须放行（不得把合规出口一起削掉）')
  assert.strictEqual(mod.isResolvableEvidence('a'.repeat(40)), true,
    '整串就是一个 40 hex 对象 id —— 形状层只能到这里。**形状不等于存在**：这一格是判据的能力边界，写在这儿是让下一个读者知道它测到了什么')
  assert.strictEqual(mod.isResolvableEvidence('prefix' + 'a'.repeat(40) + 'suffix'), false,
    '无边界时任何散文里嵌一段 hex 都能冒充 commit id')
  for (const good of ['PR #3900 后端轴', 'ses_probe0001', '3d77f06b-c417-436a-a513-aca14165aa3c']) {
    assert.strictEqual(mod.isResolvableEvidence(good), true, '既有可核形态不得退化：' + good)
  }
})

test('评审C2/I6：tier 先去空白再判闭集；缺失与"值不认识"必须是两个档', () => {
  assert.strictEqual(mod.classifyEvidenceTier({ tier: 'external ', evidence: 'PR #3900' }), 'external',
    '`tier:"external "`（尾随空格）掉进 unknown ⇒ 高危面静默放行，是删字段之外最廉价的注入变体')
  assert.strictEqual(mod.classifyEvidenceTier({ tier: '  self-play', evidence: null }), 'self-play')
  assert.strictEqual(mod.classifyEvidenceTier({ tier: 'extrenal', evidence: 'PR #3900' }), 'unrecognized',
    '字段在、值不认识 ⇒ 必须与"字段缺席"分开：前者是伪造/写错的声明，后者是历史记录')
  assert.strictEqual(mod.classifyEvidenceTier({ evidence: 'PR #3900' }), 'unknown',
    '主干实测 142 篇已闭环产物里 139 篇整字段缺席 ⇒ 那一档必须仍不拦，否则当场造出无法闭合的循环')
})

test('评审C2：已闭环却带"不认识的 tier 值"⇒ 任意面都判不成立（fail-closed，且实跑证明它不误伤存量）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'external-ish', evidence: 'PR #3900' } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART]]), repo, () => null)
    assert.strictEqual(r.reasons.length, 1, `tier 值不认识必须红（不得读成"没声明过"而放过）：${JSON.stringify(r.reasons)}`)
    assert.match(r.reasons[0], /tier 取值不认识|unrecognized/)
    assert.ok(r.reasons[0].includes(ART))
    // 红文案必须把闭集**念出来**：实测主干 40 笔里已有 3 条自造 tier 值
    // （docs-false-positive / superseded / dual，closureNote 全空）⇒ 发明词汇的人不是坏，是看不见清单。
    for (const t of ['external', 'self-play', 'none', 'unknown']) {
      assert.ok(r.reasons[0].includes(t), `闭集缺 ${t} 一项 ⇒ 下一次还会有人自造值：${r.reasons[0]}`)
    }
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('评审W4：closureNote 的光秃长度阈值可被 20 个字符满足 ⇒ 必须带轮次与处置结论', () => {
  assert.strictEqual(mod.closureCorroboration({ required: true, status: 'cleared', closureNote: 'x'.repeat(20) }) !== 'note', true,
    '20 个任意字符就换到"有出处"，那这条出口与非出口之间没有差别')
  assert.strictEqual(
    mod.closureCorroboration({ required: true, status: 'cleared', closureNote: '轮2 外部 claude 交付 6 条：3 upheld 已实现、2 dismissed 给可证伪理由、1 Info 登记' }),
    'note', '主干既有约定（轮次 + 逐条处置）必须仍然放行')
})

test('评审W3：非高危面的 M 转变比矩阵严，这是**写进用例的取舍**而不是口径漂移', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: SELF_PLAY })
  const base = JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'pending', tier: 'self-play' } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['M', ART]]), repo, () => base)
    assert.match(r.reasons.join('\n'), /收口无出处/,
      '矩阵在非高危面放过 self-play，但"把 pending 翻成闭环值"这个**动作**本身要有出处（出口是 closureNote）。'
      + '这条不对称是刻意的，红文案必须把它说出来；不锁住就会被下一个会话"顺手统一口径"削平')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

// ── 2026-10-19 QM-6 第 2 轮（后端 claude session 7a4d7847-48e1-4480-9c7b-7c9d7c9c5b72）────
test('第2轮R2-2：高危面上"A 状态新增即写闭环值而没有任何出处"必须拦（判据自指的后门）', () => {
  // 现场形态：有人改了判据本体，同时在本次提交里新增一条 `status:cleared` 而**不写 tier** 的产物。
  // 转变检测对它结构性失明（没有 base 可比），矩阵若继续把 unknown 一律放过，
  // 那"给自己贴一张 cleared"就是零成本绕行 —— 这一格正是 R2-2 命中的后门。
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: { required: true, status: 'cleared', performedBy: 'claude', findings: null } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART], ['M', RISK_GATE]]), repo, () => null)
    assert.strictEqual(r.reasons.length, 1, `高危面上的凭空收口必须红：${JSON.stringify(r.reasons)}`)
    assert.match(r.reasons[0], /本次新增（A）即写成闭环值|无 base 可比/)
    assert.ok(r.reasons[0].includes(ART))
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
  // 非高危面这一档**必须仍然不拦**（缺陷G 的不可闭合循环），否则就是拿收紧当装饰
  const plain = repoWithFile(ART, { mode: 'dual', deepReview: { required: true, status: 'cleared', performedBy: 'claude', findings: null } })
  try {
    const ok = mod.evaluateDeepReviewDebt(st([['A', ART]]), plain, () => null)
    assert.deepStrictEqual(ok.reasons, [], `非高危面的 unknown 仍不拦（转拦另片）：${JSON.stringify(ok.reasons)}`)
  } finally { fs.rmSync(plain, { recursive: true, force: true }) }
})

test('第2轮R2-3：merge-base 取不到时按未证实处理，不得退回 base ref 假装"已核对"', () => {
  // 浅克隆 / 无共同祖先 ⇒ `git merge-base` 抛错。此时读 base ref 的最新内容正是 finding#3
  // 要修的那个缺陷本身，只 warn 一行继续按"已核对"判等于把修好的洞重新打开。
  const cp = require('node:child_process')
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-shallow-'))
  const git = (a) => cp.execFileSync('git', a, { cwd: repo, encoding: 'utf8' })
  try {
    git(['init', '-q', '-b', 'main', repo])
    fs.mkdirSync(path.join(repo, '.ccg', 'reviews'), { recursive: true })
    fs.mkdirSync(path.join(repo, 'openspec', 'records'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'openspec', 'records', 'pr.md'), '---\nrecord: pr\n---\n\n## 记录\n', 'utf8')
    fs.writeFileSync(path.join(repo, ART2), JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'self-play' } }), 'utf8')
    git(['add', '-A'])
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'single commit, no merge-base with a disjoint ref'])
    git(['checkout', '-q', '-b', 'orphan-head'])
    const script = path.join(__dirname, 'check-pr-exec-record.js')
    // `--base` 指到一个与 head **无共同祖先**的 ref（用一个临时空仓库的 HEAD 当 base）
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-disjoint-'))
    try {
      cp.execFileSync('git', ['init', '-q', '-b', 'main', other], { encoding: 'utf8' })
      cp.execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'disjoint'], { cwd: other, encoding: 'utf8' })
      const baseSha = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: other, encoding: 'utf8' }).trim()
      let res
      try {
        res = { rc: 0, out: cp.execFileSync(process.execPath, [script, `--repo=${repo}`, `--base=${baseSha}`, '--head=orphan-head', '--head-branch=pr', '--mode=enforce', '--no-remote'], { cwd: repo, encoding: 'utf8' }) }
      } catch (e) { res = { rc: (e && e.status) || 1, out: String((e && e.stdout) || '') + String((e && e.stderr) || '') } }
      assert.notStrictEqual(res.rc, 0, `base 解不出时必须非零退出，不得继续判：rc=${res.rc}`)
      // 取源层先炸（`changedFileStatuses` 自己就要解 merge-base），所以 main() 里那条
      // `[TRANSITION-BASE]` 分支在这个形态下**结构性到不了** —— 真正要锁的是"失败链上没有
      // 任何一处把自己读成已核对"。把 blobBaseRef 的退回改成 baseRef 也照样红，因为它根本
      // 走不到；这一格记下来是为了让下一个读者知道这条兜底分支为什么没有独立正控。
      assert.doesNotMatch(res.out, /已核对=[1-9]/,
        `解不出 base 却报"已核对"就是假绿：${res.out.slice(0, 300)}`)
      assert.match(res.out, /取证失败|Not a valid commit/, '必须点名为取不到差量，而不是"没有欠账"')
    } finally { fs.rmSync(other, { recursive: true, force: true }) }
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('第2轮R2-3b：外部注入变更集 + merge-base 解不出 ⇒ 必须走「未证实」，不得退回读 base ref', () => {
  // 这条是那条兜底分支的**可达**路径：变更集由 `--statuses` 注入（不再来自 merge-base），
  // 而 `--base` 与 `--head` 可以解不出公共祖先（浅克隆 / 别的 fork / 已回收的 ref）。
  // 若此时把 blobBaseRef 留成 baseRef，读到的是那个 ref 上的**内容**而不是分叉点的版本，
  // finding#3 那个洞就在这里重新打开 —— 用 `已核对=` 的读数把它显出来。
  const cp = require('node:child_process')
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-inject-base-'))
  const git = (a) => cp.execFileSync('git', a, { cwd: repo, encoding: 'utf8' })
  try {
    cp.execFileSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' })
    fs.mkdirSync(path.join(repo, '.ccg', 'reviews'), { recursive: true })
    fs.writeFileSync(path.join(repo, ART2), JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'pending', tier: 'unknown' } }), 'utf8')
    git(['add', '-A'])
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base：pending'])
    const baseSha = git(['rev-parse', 'HEAD']).trim()
    // 工作树里把它改成闭环值（自扮演），但**不提交** —— 变更集靠 --statuses 注入
    fs.writeFileSync(path.join(repo, ART2), JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'self-play', performedBy: 'self-play' } }), 'utf8')
    const script = path.join(__dirname, 'check-pr-exec-record.js')
    const statuses = JSON.stringify([{ status: 'M', file: ART2 }])
    let res
    try {
      res = { rc: 0, out: cp.execFileSync(process.execPath, [script, `--repo=${repo}`, `--statuses=${statuses}`, `--base=${baseSha}`, '--head=MP-NO-SUCH-REF', '--mode=enforce', '--no-remote'], { cwd: repo, encoding: 'utf8' }) }
    } catch (e) { res = { rc: (e && e.status) || 1, out: String((e && e.stdout) || '') + String((e && e.stderr) || '') } }
    assert.match(res.out, /TRANSITION-BASE/, `merge-base 解不出必须出声：rc=${res.rc} out=${JSON.stringify(res.out.slice(0, 300))}`)
    assert.match(res.out, /未证实=1/, `转变核对必须降级成"未证实"而不是"已核对"：${res.out.slice(0, 300)}`)
    assert.doesNotMatch(res.out, /已核对=[1-9]/, '同一条读数里不得用"已核对"给一次取源失败背书')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('第2轮R2-4：evidence 里的 ses_ 片段必须有词边界（`noteses_X` 不算会话 id）', () => {
  assert.strictEqual(mod.isResolvableEvidence('noteses_ABCDEF12 处理'), false,
    '无左边界时任意散文里嵌一段 ses_ 就冒充会话 id')
  assert.strictEqual(mod.isResolvableEvidence('ses_probe0001'), true, '整串就是会话 id：合规出口不得被削')
  assert.strictEqual(mod.isResolvableEvidence('评审会话 ses_probe0001 交付 6 条'), true, '前后有文字的指针仍是指针')
})

test('第2轮R2-5：跨目录的单词面必须限定扩展名，否则文档与夹具也把它拉进高危域', () => {
  assert.strictEqual(mod.isHighRiskSurface('services/draft-fingerprint.js'), true,
    '真目标（内容指纹的唯一实现）必须仍算高危')
  assert.strictEqual(mod.isHighRiskSurface('01-docs/fingerprint-analysis.md'), false,
    '一篇**讲到**指纹的文档不是指纹面 —— 裸子串匹配会把文档变更集拔高到"需外部出处"')
  assert.strictEqual(mod.isHighRiskSurface('apps/desktop/electron/services/draft-fingerprint.test.js'), true,
    '与指纹面同目录的回归锁算这一面的一部分（改了它=改了守的东西）')
  assert.strictEqual(mod.isHighRiskSurface('01-docs/evidence/zhihu-stealth-mainworld-2026-10-15/fingerprint-baseline-stealth-off.txt'), false,
    '实测这 2 份取证 txt 是裸子串匹配唯一的非代码命中 ⇒ exts 限定就是把它们请出去')
  const ent = mod.HIGH_RISK_SURFACES.find((s) => s.prefix === 'fingerprint')
  assert.ok(Array.isArray(ent.exts) && ent.exts.length > 0, '带 exts 的条目必须显式声明适用范围，判据不猜')
})

test('第2轮R2-7：expandRenames 无改名时也不得把调用方的数组引用原样递下去', () => {
  const list = [{ status: 'M', file: 'a.js' }]
  const out = mod.expandRenames(list)
  assert.notStrictEqual(out, list, '两条分支返回类型必须一致（一条给新数组一条给原引用，下一个读者会踩）')
  assert.deepStrictEqual(out, list)
  out.push({ status: 'A', file: 'b.js' })
  assert.strictEqual(list.length, 1, '返回值不得与被调方数组共享底层存储')
})

test('第2轮R2-1：矩阵的门槛是"变更集命中高危面"（产物本身是 PR 级的，不存在按文件归属）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: SELF_PLAY })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART], ['M', 'apps/desktop/src/Home.vue']]), repo, () => null)
    assert.deepStrictEqual(r.reasons, [], '变更集没命中高危面 ⇒ 自扮演仍算闭环（§六 第 2 条的既有口径）')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
  // 命中时**必须点名是哪个文件拉进来的**，并且不得写成"这篇产物在 X 上"（张冠李戴）
  const risky = repoWithFile(ART, { mode: 'dual', deepReview: SELF_PLAY })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART], ['M', RISK_GATE]]), risky, () => null)
    const block = r.reasons.find((x) => /收口不成立/.test(x)) || ''
    assert.ok(block.includes('变更集命中高危面'), `要说清归属是"本次变更集"而非这篇产物：${block.slice(0, 240)}`)
    assert.ok(!new RegExp(ART + '（高危面').test(block), '不得把高危面属性写在产物自己名下')
    assert.ok(block.includes(RISK_GATE), '必须点名拉进来的文件')
  } finally { fs.rmSync(risky, { recursive: true, force: true }) }
})

// ── 2026-10-20 跨家族轴第 2 轮（codex session 见记录 §五 X2 表）：四条已验真的缺陷落锁 ──
const ART_OLD = '.ccg/reviews/' + 'b'.repeat(64) + '.json'
const ART_NEW = '.ccg/reviews/' + 'c'.repeat(64) + '.json'
const PENDING_BASE = () => JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'pending' } })

test('X2-6：C75（复制）不得当成"旧路径被删"—— 源文件还在，制造的是假欠账', () => {
  const repo = repoWithFile(ART_NEW, { mode: 'dual', deepReview: { required: true, status: 'pending', tier: 'unknown' } })
  try {
    const r = mod.evaluateDeepReviewDebt([{ status: 'C75', file: ART_NEW, from: ART_OLD }], repo, PENDING_BASE)
    const block = r.reasons.join('\n')
    assert.ok(block.length > 0, '复制出来的新产物仍是 pending ⇒ 该报欠账（这一半是对的）')
    assert.ok(!/改名/.test(block), `C 不是改名，不得报"借改名带走未闭环记录"：${block.slice(0, 240)}`)
    assert.ok(!block.includes(ART_OLD), `旧路径仍然存在，不得被点名：${block.slice(0, 240)}`)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('X2-7：改名且把闭环状态带到新路径（external + 可核 evidence）⇒ 不得再报欠账', () => {
  // 我的红文案亲口建议"把闭环状态与新路径一起带过去"，可 renamedUnclosed 只看 base 侧
  // ⇒ 照文案做的人仍然红，这是"门禁与自己的出口打架"的又一落点。
  const repo = repoWithFile(ART_NEW, { mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'external', evidence: 'ses_probe0001' } })
  try {
    const r = mod.evaluateDeepReviewDebt([{ status: 'R100', file: ART_NEW, from: ART_OLD }], repo, PENDING_BASE)
    const block = r.reasons.join('\n')
    assert.ok(!/改名|重命名/.test(block), `新路径已合规收口，不该再有"改名带走"这条红：${block.slice(0, 260)}`)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('X2-9：后端真源所在的 scripts/lib/ccg-review-* 必须在高危清单上', () => {
  assert.strictEqual(mod.highRiskPrefixOf('scripts/lib/ccg-review-backends.js'), 'scripts/lib/ccg-review-',
    '决定"谁来评审"的解析器不在守门面上 ⇒ 改它不会触发任何收口要求')
  assert.ok(mod.HIGH_RISK_SURFACES.some((s) => s.prefix === 'scripts/lib/ccg-review-'), '清单必须显式登记该条')
})

test('X2-8：段起点匹配要留住 .github/scripts/ 那 42 个真判据，同时排除上游 vendored 副本', () => {
  // 跨家族轴 X2-8 说"子串过匹配"，实测成立；但**正解不是把匹配钉到仓库根**：
  // 本仓 scripts/check- 的非根位命中有 42 个真判据本体（.github/scripts/ 40 + apps/desktop/scripts/ 2），
  // 钉到根就是把 CI 侧那批门禁脚本整体免检 —— 那是为了消 1 个误伤而造 42 个漏洞。
  assert.strictEqual(mod.highRiskPrefixOf('.github/scripts/check-locale-sync.js'), 'scripts/check-',
    'CI 侧门禁脚本同样是判据本体，段起点匹配的存在理由就是它')
  assert.strictEqual(mod.highRiskPrefixOf('apps/desktop/scripts/check-camofox-listen.js'), 'scripts/check-',
    '包内的门禁脚本仍算门禁面，收窄不得把它一起削掉')
  // 实测唯一的段起点误伤：上游技能制品的嵌套 workflow。GitHub 只调度顶层 .github/workflows/，
  // 这份副本永远不会被排队执行 ⇒ 改它不等于改本仓守门人 ⇒ 按子树排除，且清单只能缩小。
  assert.strictEqual(mod.highRiskPrefixOf('.quality-rhythm/.github/workflows/mechanism-check.yml'), null,
    'vendored 副本不得算作本仓高危面')
  assert.ok(mod.VENDORED_SUBTREES.includes('.quality-rhythm/'), '排除机制必须显式登记在清单里，不许散落在判据内')
  // 黏在别的词后面 ⇒ 不是那个面。上一版这里用的是 `vendor/`（本仓并不存在该目录），
  // 而变异 P34（把段起点判据摘成任意子串）实测 NOT_CAUGHT —— 说明这两条断言当时都抓不到它。
  // 下面两条是**能区分两种写法**的真判别串。
  assert.strictEqual(mod.highRiskPrefixOf('xscripts/check-y.js'), null,
    '前缀黏在别的词尾（xscripts/）不算 scripts/check- —— 段起点这一维必须有判别用例')
  assert.strictEqual(mod.highRiskPrefixOf('backup.github/workflows/ci.yml'), null,
    '同理：.github/workflows/ 黏在 backup 之后不算 workflows 面')
  assert.strictEqual(mod.isHighRiskSurface('01-docs/archive/github/workflows/notes.md'), false)
  assert.strictEqual(mod.highRiskPrefixOf(RISK_GATE), 'scripts/check-', '判据本体自指不得因收窄而失效')
})

test('X2-11：末行不得在"未证实>0"时仍打光秃秃的 OK', () => {
  const t = mod.summarizeTransitionCheck([{ file: ART, baseReadable: false }], 1)
  assert.strictEqual(t.unverifiable, 1)
  assert.match(mod.verdictLine({ ok: true, transition: t }), /^OK（.*未证实=1/,
    `通过但要显出没核到的条数，否则"全过"与"探针失明"同形：${mod.verdictLine({ ok: true, transition: t })}`)
  assert.match(mod.verdictLine({ ok: false }), /^不通过/, '真不通过时不得被装饰成 OK')
  // 跨家族轴 i1：字段缺失/改名 ⇒ NaN ⇒ `NaN > 0` 恒 false ⇒ 末行退回光秃秃的 OK。
  // 缺字段必须按"不可知"出声，不得当 0。
  assert.match(mod.verdictLine({ ok: true, transition: { unverifiable: undefined, uncorroborated: undefined } }),
    /^OK（但转变读数缺字段/, '读数缺字段时不得打光秃秃的 OK：' + mod.verdictLine({ ok: true, transition: {} }))
  assert.match(mod.verdictLine({ ok: true }), /^OK: /, '没有转变对象时保持原文案（不得把"没有扫描域"也报成缺字段）')
  assert.match(mod.verdictLine({ ok: false }), /^不通过/, '真不通过时不得被装饰成 OK')
})

test('X2-12（接线锁）：判定行必须真的接到 transition —— 只测纯函数抓不到"report 看不见"', () => {
  // X2-11 测的是 verdictLine 本体；本轮缺陷在**装配**：main 把 transition 挂在 deepDebt 上，
  // 而 report() 拿到的是 evaluate() 的结果对象，那里没有 transition ⇒ loose 恒 0 ⇒ 照样打光秃秃的 OK。
  // 这类"函数对、装配错"只能按本文件既有惯例用接线锁钉（先例：'丙：main 必须打印覆盖率行'）。
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  assert.match(src, /function main[\s\S]*target\.transition\s*=\s*deepDebt\.transition/,
    'applyDeepDebt 必须把 transition 一并挂到被打印的那份结果上')
  assert.match(src, /function report[\s\S]{0,400}?lines\.push\(verdictLine\(r\)\)/,
    'report 的判定行必须由 verdictLine 产出')
  assert.ok(!src.includes('if (r.ok) lines.push(verdictLine(r))'),
    '判定行不得只在 ok 分支走 verdictLine —— 两支各写一遍时非 OK 支永远看不见 loose 计数')
})
test('X2-5①：路径形态的 evidence 必须被存在性探针验到，否则降 external-unverified', () => {
  // 跨家族轴 Critical：形状判据对「根本不存在但长得像路径」完全免疫，而高危面只认 external
  // ⇒ 编一个 reports/judge-report.md 就能收口。这一格把形状判据升级为半语义。
  const dr = { tier: 'external', evidence: 'reports/judge-report.md' }
  assert.strictEqual(mod.classifyEvidenceTier(dr), 'external',
    '不注入探针时保持形状语义 —— 单测与仓外调用方不得被静默改判（探针是注入参数，不是全局开关）')
  assert.strictEqual(mod.classifyEvidenceTier(dr, () => false), 'external-unverified',
    '路径证据验不到 ⇒ 与"形状不对"同档，不得算可核出处')
  assert.strictEqual(mod.classifyEvidenceTier(dr, () => true), 'external')
  // 其余四档指向仓库外的对象（PR / 会话 / uuid / oid），本仓上下文无法 cat-file ⇒ 不得被误伤
  for (const ev of ['PR #3987 后端轴', 'ses_probe0001', 'a'.repeat(40), '0b0a1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d']) {
    assert.strictEqual(mod.classifyEvidenceTier({ tier: 'external', evidence: ev }, () => false), 'external',
      ev + ' 不是路径形态，存在性判据不得伸手')
  }
  assert.strictEqual(mod.evidenceForm('reports/judge-report.md'), 'path')
  assert.strictEqual(mod.evidenceForm('PR #3987'), 'pr')
  assert.strictEqual(mod.evidenceForm('ses_probe0001'), 'session')
  assert.strictEqual(mod.evidenceForm('a'.repeat(40)), 'oid')
  assert.strictEqual(mod.evidenceForm('x'), null)
  assert.strictEqual(mod.evidenceForm('x'), null)
  // 跨家族轴 i3：path 形态本来就接受两种分隔符，探针却拒绝反斜杠 ⇒ 同一对象两种判法。
  // 归一现在是纯函数，能直测。
  assert.strictEqual(mod.repoObjectPath('reports\\judge-report.md'), 'reports/judge-report.md')
  assert.strictEqual(mod.repoObjectPath('reports/judge-report.md'), 'reports/judge-report.md')
  assert.strictEqual(mod.repoObjectPath('reports/judge-report.md#L10'), 'reports/judge-report.md')
  assert.strictEqual(mod.repoObjectPath('C:\\Temp\\judge.md'), '', '盘符不是仓内对象')
  assert.strictEqual(mod.repoObjectPath('/etc/passwd'), '', '绝对路径不是仓内对象')
  assert.strictEqual(mod.repoObjectPath('../../outside.md'), '', '上跳不是仓内对象')
})

test('X2-5②：真跑债务判据 —— 高危面上"路径证据但不存在"必须红，存在则过', () => {
  const dr = { mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'external', evidence: 'reports/judge-report.md' } }
  const statuses = st([['A', ART], ['M', RISK_GATE]]) // 变更集命中高危面（判据本体自指）
  const repo = repoWithFile(ART, dr)
  try {
    const missing = mod.evaluateDeepReviewDebt(statuses, repo, () => null, () => false)
    assert.strictEqual(missing.reasons.length, 1,
      `路径证据验不到时必须点名，实际 ${JSON.stringify(missing.reasons)}`)
    assert.ok(missing.reasons[0].includes(ART), '红必须指名产物')
    const present = mod.evaluateDeepReviewDebt(statuses, repo, () => null, () => true)
    assert.deepStrictEqual(present.reasons, [], '同一个证据只要验得到就该过 —— 否则这条判据只是在拦"我没注入探针"')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('X2-10：TIER-COVERAGE 必须走 expandRenames —— 改名带过去的闭环产物不得从读数里消失', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'self-play' } })
  try {
    const renamed = [{ status: 'R', from: '.ccg/reviews/' + '0'.repeat(64) + '.json', file: ART }]
    assert.strictEqual(mod.dualClosedDeepReviews(renamed, repo).length, 1,
      'R 展开成 A(新路径) 后必须进读数；债务扫描走同一个展开，两条读数才同域')
    assert.strictEqual(mod.summarizeTierCoverage(mod.dualClosedDeepReviews(st([['A', ART]]), repo)).total, 1)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('X2-14：每条 why 里写的"实测命中 N 个"是**下界**，归因跌破即红（超出只打印不拦）', () => {
  // 跨家族轴 i4 否证了原来的等值判据：无关 PR 增删任意一个匹配文件（新增 .github/scripts/check-*.js、
  // 删一份取证 txt）都会把**本条**打红，而失败信息不指向那个改动 —— 这是把"注释里的数"造成
  // 一条跨 PR 的耦合。牙要留，方向只留一个：**覆盖变窄是事故，覆盖变宽不是**。
  // 所以对账取 why 里**最后一个** `命中 N 个`（fingerprint 那条写了演进链 9→7，最后一个才是本条口径），
  // 断言 owned >= claimed；每次把实测构成打印出来，让"数漂了"这件事在现场可见而不是靠人记得改注释。
  const tracked = require('node:child_process').execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean)
  let claimed = 0
  const rows = []
  for (const s of mod.HIGH_RISK_SURFACES) {
    const all = s.why.match(/命中\s*\d+\s*个/g) || []
    if (all.length === 0) { rows.push(s.prefix + '=' + tracked.filter((f) => mod.highRiskPrefixOf(f) === s.prefix).length + '(无声明)'); continue }
    claimed++
    const last = all[all.length - 1]
    const want = Number(/(\d+)/.exec(last)[1])
    const owned = tracked.filter((f) => mod.highRiskPrefixOf(f) === s.prefix).length
    assert.ok(owned >= want,
      s.prefix + ' why 声明实测下界 ' + want + ' 个，当前归因只有 ' + owned + ' 个 ⇒ 命中域被削窄（改匹配/exts/删条目都会到这里）：' + s.why)
    rows.push(s.prefix + '=' + owned + '(下界' + want + ')')
  }
  assert.ok(claimed >= 6, `带实测下界的条目不得少于 6（实际 ${claimed}）—— 一个都没有就说明这条锁在空转`)
  console.log('[HIGH-RISK-ATTRIBUTION] ' + rows.join(' '))
})

test('X2-4（接线锁）：merge-base 在判据里只准算一次，变更集与 base 侧 blob 共用同一个 SHA', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  const code = mod.stripCommentsForScan(src)
  const calls = code.split("'merge-base'").length - 1
  assert.strictEqual(calls, 1,
    `'merge-base' 的实参只准出现一次（实际 ${calls}）—— 两次调用之间 base ref 前进，`
    + '变更集与 blob 就不同源，wasClosed 会被读成别人的闭环（跨家族轴 X2-4）')
  assert.match(code, /changedFileStatuses\(\{\s*repo,\s*base:\s*blobBaseRef \|\| baseRef/,
    '变更集必须取那个已经算好的 merge-base')
  assert.match(code, /return execFileSync\('git', \['-C', repo, 'show', `\$\{blobBaseRef\}:\$\{rel\}`\]/,
    'base 侧 blob 必须取同一个 merge-base')
})

test('X2-12（扩锁）：单一实现锁必须挡住"行为等价的第二份匹配"，而不只是挡住同形写法', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  const start = src.indexOf('function highRiskPrefixOf')
  const end = src.indexOf('\n}', start)
  assert.ok(start >= 0 && end > start, '锚点定位失败 ⇒ 本锁测量域不可信')
  const outside = src.slice(0, start) + src.slice(end)
  assert.ok(!outside.includes('for (const s of HIGH_RISK_SURFACES)'),
    'for...of 版的第二份匹配与 .find() 版行为等价，只禁方法名等于没禁')
  assert.ok(!outside.includes('for (const surface of HIGH_RISK_SURFACES)'), '同上，换个变量名也一样')
  assert.ok(!outside.includes('includes(s.prefix)') && !outside.includes('includes(surface.prefix)'),
    'includes 形态的第二份匹配同样不得出现')
  assert.ok(!/HIGH_RISK_SURFACES\s*\.\s*(reduce|every|flatMap|filter)/.test(outside),
    '清单的遍历面收敛在 highRiskPrefixOf；其余消费点只准走导出的谓词')
})


test('引擎模板与判据互不认账：PR 评论 URL 必须是可核形态（否则照引擎写证据的人被自家门禁判红）', () => {
  // .adversarial/*/adjudication.json 的 instructions 原文要求 externalReview.evidenceRef 写成
  // https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>，而本判据此前一律不认。
  const ok = 'https://github.com/Colinchiu007/mulpub/pull/3987#issuecomment-6283101492'
  assert.strictEqual(mod.evidenceForm(ok), 'url')
  assert.strictEqual(mod.classifyEvidenceTier({ tier: 'external', evidence: ok }, () => false), 'external',
    'URL 形态不得被"存在性探针"伸手（它指向的是 GitHub 上的对象，不在本仓 cat-file 域内）')
  // 负控：形似但不是 PR 评论的串一律不认，不得把"含 github.com"当成出处
  for (const bad of [
    'https://github.com/o/r/pull/abc',
    'https://github.com/o/r/issues/123',
    'https://evil.example.com/o/r/pull/123',
    'x https://github.com/o/r/pull/123',
    'https://github.com/o/r/pull/123/../..',
  ]) assert.strictEqual(mod.evidenceForm(bad), null, bad + ' 不该算可核指针')
})


test('i5：段内双点不是上跳（真实文件名不得被探针拒掉）', () => {
  // 上一版用 raw.indexOf('..') 一律拒 ⇒ `v1..md` 这种合法文件名被判"不是仓内对象"，
  // 在高危面上把**真证据**降成 external-unverified ⇒ 误红。上跳只在整段时成立。
  assert.strictEqual(mod.repoObjectPath('reports/v1..md'), 'reports/v1..md')
  assert.strictEqual(mod.repoObjectPath('a/b..c.json'), 'a/b..c.json')
  assert.strictEqual(mod.repoObjectPath('../outside.md'), '')
  assert.strictEqual(mod.repoObjectPath('a/../b.md'), '')
  assert.strictEqual(mod.repoObjectPath('..//b.md'), '')
  assert.strictEqual(mod.repoObjectPath('reports\\judge.md'), 'reports/judge.md')
})

test('i6：显式 null 与缺字段同档，不得被 Number(null)=0 洗成"零条没核到"', () => {
  assert.match(mod.verdictLine({ ok: true, transition: { unverifiable: null, uncorroborated: null } }),
    /^OK（但转变读数缺字段/, 'null 走"不可知"：' + mod.verdictLine({ ok: true, transition: { unverifiable: null, uncorroborated: null } }))
  assert.match(mod.verdictLine({ ok: true, transition: { unverifiable: 2, uncorroborated: null } }),
    /^OK（但转变读数缺字段/, '一半可读一半不可读时整体按不可知，不得只报可读那半')
  assert.match(mod.verdictLine({ ok: true, transition: { unverifiable: 2, uncorroborated: 1 } }),
    /未证实=2 无出处=1/, '两个都是数字时照常报数（这条是上一格的负控：判据不得恒真')
})

test('i4：路径形态的证据必须属于本次变更集（真跑探针）', () => {
  const cp = require('node:child_process'); const os = require('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evprobe-'))
  const run = (a) => cp.execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  const rel = '01-docs/evidence/judge-report.md'
  try {
    run(['init', '-q', '-b', 'main', dir])
    fs.mkdirSync(path.join(dir, '01-docs', 'evidence'), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), '# 报告\n', 'utf8')
    run(['add', '-A'])
    run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base'])
    const probe = mod.makeEvidenceProbe({ statuses: [{ status: 'M', file: 'scripts/check-x.js' }], repo: dir, head: 'HEAD' })
    // ① 存在但不在变更集 ⇒ 不可核（"指一份仓里本来就有的文档"不再算出处）
    assert.strictEqual(probe(rel), false, '仓内既有文件不等于本 PR 的证据')
    assert.strictEqual(probe('01-docs/evidence/judge-report.md#L1'), false, '带锚点也不得绕过归属判据')
    // ② 属于变更集且真存在 ⇒ 可核
    const probe2 = mod.makeEvidenceProbe({ statuses: [{ status: 'A', file: rel }], repo: dir, head: 'HEAD' })
    assert.strictEqual(probe2(rel), true, '本 PR 新增且真在 head 里的路径必须验得到')
    // ③ 属于变更集但 head 里没有 ⇒ 不可核（归属不等于存在）
    const probe3 = mod.makeEvidenceProbe({ statuses: [{ status: 'A', file: 'reports/never-committed.md' }], repo: dir, head: 'HEAD' })
    assert.strictEqual(probe3('reports/never-committed.md'), false, '写进变更集不等于对象存在')
    // ④ 改名形态：两侧路径都算"归属"，但存在性只认 head 里真有的那一份。
    // （上一条断言原先写的是 probe4(rel)——旧路径在这份夹具里**确实存在**于 head，
    //   所以它返回 true 是正确行为，是我的用例把场景编错了；改成断言"新路径不存在"这一格。）
    const probe4 = mod.makeEvidenceProbe({ statuses: [{ status: 'R', from: rel, file: '01-docs/evidence/moved.md' }], repo: dir, head: 'HEAD' })
    assert.strictEqual(probe4('01-docs/evidence/moved.md'), false, '归属过了但 head 里没这个新路径 ⇒ 仍按不可核')
    assert.strictEqual(probe4(rel), true, 'from 侧也算归属，且旧路径在 head 里真存在 ⇒ 可核（不得因为"它被改过名"就一律拒）')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('i1+i2（否证产物）：C 不合成 D，viaRename 只被 D 方向消费', () => {
  // 评审说"C 的合成 A 仍带 viaRename ⇒ 债务判据报『改名带走』并点名未删除的旧路径"。
  // 实测不成立：D 方向的合成只对 R 发生（本断言就是那条否证的产物），A 侧的 viaRename 无人消费。
  const expanded = mod.expandRenames([{ status: 'C', from: ART_OLD, file: ART_NEW }])
  assert.deepStrictEqual(expanded.filter((e) => e.status === 'D').map((e) => e.file), [],
    'C 的源文件仍在树里，合成 D 等于凭空造一笔"删除未闭环记录"')
  const rExpanded = mod.expandRenames([{ status: 'R', from: ART_OLD, file: ART_NEW }])
  assert.strictEqual(rExpanded.filter((e) => e.status === 'D')[0].viaRename, ART_NEW,
    'D 侧 viaRename 必须指向**新路径**——renamedCarriesClosure 读的就是它')
  // 复制一条未闭环产物 ⇒ 报的是"A 新增即闭环/未闭环"这一档，文案里不得出现"改名"
  const repo = repoWithFile(ART_NEW, { mode: 'dual', deepReview: { required: true, status: 'pending', tier: 'unknown' } })
  try {
    const r = mod.evaluateDeepReviewDebt([{ status: 'C', from: ART_OLD, file: ART_NEW }], repo, () => null)
    const txt = r.reasons.join(' | ')
    assert.ok(!/改名/.test(txt), 'C 场景不得出现改名措辞：' + txt)
    assert.ok(txt.indexOf(ART_OLD) < 0, 'C 场景不得点名未被删除的旧路径：' + txt)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('i3（否证产物）：merge-base 解不出时 readAtBase 走短路返回 null，不读暂存区', () => {
  // 评审的机理是"blobBaseRef='' ⇒ git show ':rel' ⇒ 读 index ⇒ 若证据恰被 staged 就把 wasClosed 读成 true"。
  // 这一条用真跑 CLI 判生死：把 base 指成一个**无共同祖先**的孤立分支，merge-base 必失败 ⇒
  // 若真读了 index，读数会是"已核对=1"；短路返回 null 才是"未证实=1"。
  const cp = require('node:child_process'); const os = require('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-null-'))
  const run = (a) => cp.execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  try {
    run(['init', '-q', '-b', 'main', dir])
    fs.mkdirSync(path.join(dir, '.ccg', 'reviews'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'openspec', 'records'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.ccg', 'reviews', SHA64 + '.json'),
      JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'external', evidence: 'ses_probe0001' } }, null, 2), 'utf8')
    fs.writeFileSync(path.join(dir, 'openspec', 'records', 'pr.md'), '---\nrecord: pr\n---\n\n## 记录\n', 'utf8')
    run(['add', '-A'])
    run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'head side'])
    run(['checkout', '-q', '--orphan', 'unrelated'])
    run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'orphan root'])
    run(['checkout', '-q', 'main'])
    const res = (() => {
      try {
        return { rc: 0, out: cp.execFileSync(process.execPath, [path.join(__dirname, 'check-pr-exec-record.js'),
          '--repo=' + dir, '--base=unrelated', '--mode=enforce',
          '--statuses=' + JSON.stringify([{ status: 'M', file: '.ccg/reviews/' + SHA64 + '.json' }])], { cwd: dir, encoding: 'utf8' }) }
      } catch (e) { return { rc: (e && e.status) || 1, out: String((e && e.stdout) || '') } }
    })()
    assert.match(res.out, /\[TRANSITION-BASE\] merge-base 取不到/, '必须先出声：' + res.out.slice(0, 200))
    assert.match(res.out, /TRANSITION-CHECK .*未证实=1/, '取不到 base 只能记未证实：' + res.out.slice(0, 300))
    assert.match(res.out, /已核对=0/, '不得把"读不到"洗成"已核对"（那正是 i3 担心的 index 读法）')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('i7（扩锁）：第二份匹配的所有等价形态都要被点名，不只是 find/map 两个方法名', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  const start = src.indexOf('function highRiskPrefixOf')
  const end = src.indexOf('\n}', start)
  assert.ok(start >= 0 && end > start, '锚点定位失败 ⇒ 本锁测量域不可信')
  const outside = src.slice(0, start) + src.slice(end)
  assert.ok(!/HIGH_RISK_SURFACES\s*\.\s*(some|every|reduce|flatMap|forEach|map|filter|find|some)/.test(outside),
    '清单的方法式遍历只准发生在 highRiskPrefixOf 里')
  assert.ok(!/HIGH_RISK_SURFACES\s*\[/.test(outside), '下标遍历 HIGH_RISK_SURFACES[i] 也是第二份实现')
  assert.ok(!outside.includes('of HIGH_RISK_SURFACES'), 'for...of / for...in 同罪')
})


test('X2-5③（接线锁）：探针必须由 main 造好并注进两处消费点，且构造晚于 statuses', () => {
  // 变异 P30（把 main 里的 existsAtHead 改成 undefined）实测 132 条**全绿** ——
  // 因为债务用例自己注入探针，main 的装配根本不在任何用例的跑道上。这一格只能接线锁。
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  const code = mod.stripCommentsForScan(src)
  assert.match(code, /const existsAtHead = makeEvidenceProbe\(\{ statuses, repo, head \}\)/,
    'main 必须用工厂造探针（含 statuses ⇒ 归属判据在真实调用链上）')
  assert.match(code, /evaluateDeepReviewDebt\(statuses, repo, readAtBase, existsAtHead\)/,
    '债务判据必须收到探针')
  assert.match(code, /summarizeTierCoverage\(dualClosedDeepReviews\(statuses, repo\), existsAtHead\)/,
    '覆盖率读数也必须收到，否则两行读数各说各话')
  const iStatuses = code.indexOf('let statuses')
  const iProbe = code.indexOf('const existsAtHead = makeEvidenceProbe')
  const iDebt = code.indexOf('const deepDebt = evaluateDeepReviewDebt')
  assert.ok(iStatuses >= 0 && iProbe > iStatuses,
    '探针的构造必须晚于 statuses —— 放在前面会读到 TDZ 里的 statuses（实测 SyntaxError 形态）')
  assert.ok(iDebt > iProbe, '探针必须在债务判据之前建好')
})


test('2.1 单一匹配实现：高危面前缀匹配只准有一处（highRiskPrefixOf）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  const start = src.indexOf('function highRiskPrefixOf')
  assert.ok(start >= 0, '必须存在唯一的高危面匹配实现 highRiskPrefixOf')
  const end = src.indexOf('\n}', start)
  // 锚点形态变了就红，不得静默把区间放大到整份文件（本仓「结构锁锚点静默失效」的同型错误）
  assert.ok(end > start, 'highRiskPrefixOf 的闭合括号锚点定位不到 ⇒ 本锁的测量域不可信')
  const outside = src.slice(0, start) + src.slice(end)
  assert.ok(!/HIGH_RISK_SURFACES\s*\.\s*(some|filter|find|forEach|map)/.test(outside),
    '清单的遍历只准发生在 highRiskPrefixOf 里：另抄一份会让「摘掉判据」的变异只红一半（P1 实测 PARTIAL 的成因）')
  assert.ok(!outside.includes('indexOf(s.prefix'),
    '前缀比较不得出现在第二个地方 —— 同上，两处口径必然漂移')
  assert.match(src, /function isHighRiskSurface[\s\S]{0,240}?return highRiskPrefixOf\(file\) !== null/,
    'isHighRiskSurface 必须是 highRiskPrefixOf 的薄封装')
  assert.match(src, /function highRiskHits[\s\S]{0,600}?highRiskPrefixOf\(e\.file\)/,
    'highRiskHits 的变更集分组必须走同一个匹配实现')
})

test('2.2 自指：改判据本体的文件必须被判高危（含 workflows 与 credential 类）', () => {
  assert.strictEqual(mod.isHighRiskSurface(RISK_GATE), true, '判据本体必须自指为高危')
  assert.strictEqual(mod.isHighRiskSurface('scripts/ccg-review-decider.js'), true, '判定写入方同样是守门人')
  assert.strictEqual(mod.isHighRiskSurface('.github/workflows/quality-gate.yml'), true)
  assert.strictEqual(mod.isHighRiskSurface('apps/desktop/electron/services/credential-store.js'), true)
  assert.strictEqual(mod.isHighRiskSurface('apps/desktop/electron/ipc-handlers/account.js'), false,
    '未登记的前缀不得判高危 —— 加面要走实测出处，不得靠猜')
})

test('2.3 矩阵①：高危面 + self-play 收口 ⇒ 必须欠账并点名', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: SELF_PLAY })
  try {
    const r = mod.evaluateDeepReviewDebt(
      st([['A', ART], ['M', RISK_GATE]]), repo, () => null)
    assert.match(r.reasons.join('\n'), /高危面/, `高危面上的自扮演必须拦：${JSON.stringify(r.reasons)}`)
    assert.ok(r.reasons.join('\n').includes(ART), '必须点名是哪条产物')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('2.3 矩阵②：高危面 + 真实外部出处 ⇒ 放行（矩阵不得把外部评审一起拦掉）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: EXT_OK })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART], ['M', RISK_GATE]]), repo, () => null)
    assert.deepStrictEqual(r.reasons, [], `external + 可核 evidence 在高危面上应当通过，实际 ${JSON.stringify(r.reasons)}`)
    assert.strictEqual(r.checked, 1)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('2.3 矩阵③：tier=none 却写闭环 ⇒ 任意面都欠账（自称没评审却宣称完成）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'none', evidence: null } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART]]), repo, () => null)
    assert.strictEqual(r.reasons.length, 1, `tier=none 的闭环必须报 1 条，实际 ${JSON.stringify(r.reasons)}`)
    assert.match(r.reasons[0], /tier=none|未评审/)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('2.3 边界（不可闭合循环负控）：非高危面上 tier 缺失(unknown) 的已闭环记录仍不拦', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: { required: true, status: 'cleared', performedBy: 'claude', findings: null } })
  try {
    // ⚠ 2026-10-19 第 2 轮评审后去掉 `["M", RISK_GATE]`：高危面上「A + 闭环值 + 无 tier」现在必须红
    //   （那是 R2-2 指出的零成本后门），由用例 `第2轮R2-2` 单独钉住。
    //   这里留住的是另一半合同：非高危面不得被加严成"必须跑完外部评审才能提交"（缺陷G 同型）。
    const r = mod.evaluateDeepReviewDebt(st([['A', ART]]), repo, () => null)
    assert.deepStrictEqual(r.reasons, [],
      '历史/新记录天生 tier=unknown；此刻加严就是造出「无法闭合的循环」（缺陷G 同型）。转拦前提是 unknown 占比降下来')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('8.1 转变①：base 非闭环 → head 闭环，既无外部出处也无书面原因 ⇒ 必须点名（伪造闭环）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'unknown' } })
  const base = JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'pending', tier: 'unknown' } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['M', ART]]), repo, () => base)
    assert.strictEqual(r.reasons.length, 1, `凭空收口必须报 1 条，实际 ${JSON.stringify(r.reasons)}`)
    assert.match(r.reasons[0], /收口无出处|无外部评审出处/)
    assert.ok(r.reasons[0].includes(ART))
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('8.1 转变②：同一转变带 closureNote（主干既有约定）⇒ 非高危面放行、高危面仍拦', () => {
  const closed = { mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'unknown', closureNote: '轮1 外部 claude 交付 6 条，3 upheld 已实现、2 dismissed 给可证伪理由' } }
  const base = JSON.stringify({ mode: 'dual', deepReview: { required: true, status: 'pending' } })
  const plain = repoWithFile(ART, closed)
  const risky = repoWithFile(ART, closed)
  try {
    const ok = mod.evaluateDeepReviewDebt(st([['M', ART]]), plain, () => base)
    assert.deepStrictEqual(ok.reasons, [], `带书面原因的收口在非高危面应当放行，实际 ${JSON.stringify(ok.reasons)}`)
    const bad = mod.evaluateDeepReviewDebt(st([['M', ART], ['M', RISK_GATE]]), risky, () => base)
    assert.match(bad.reasons.join('\n'), /高危面/, '高危面上的收口必须有可核外部出处，书面原因不足以放行')
  } finally { fs.rmSync(plain, { recursive: true, force: true }); fs.rmSync(risky, { recursive: true, force: true }) }
})

test('8.1 转变③：base 取不到时不得当成「没有转变」（未证实 ≠ 已核对）', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: { required: true, status: 'cleared', tier: 'unknown' } })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['M', ART]]), repo, () => null)
    assert.deepStrictEqual(r.reasons, [], 'base 不可读时不在这里报（避免把工具失明变成假红），但必须留下可见痕迹')
    // ★ 必须走判据路径断言：只测 summarizeTransitionCheck 的计数，变异「把读不到 base 的那条
    //   push 改成已核对」就抓不到（P4 实测 NOT_CAUGHT 的成因 —— 计数函数被手搓 rows 测过了）。
    assert.strictEqual(r.transition.unverifiable, 1,
      `判据必须真的把「读不到 base」这条喂进转变读数，实际 ${JSON.stringify(r.transition)}`)
    assert.strictEqual(r.transition.checked, 0, '未证实的条数不得混进「已核对」')
    assert.match(r.transition.line, /未证实=1/, `读不到 base 必须单列计数，不得静默归零：${r.transition.line}`)
    const cov = mod.summarizeTransitionCheck([{ file: ART, baseReadable: false, wasClosed: false, nowClosed: true, corroborated: false }])
    assert.match(cov.line, /未证实=1/)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('2.3 边界（不过拦负控）：非高危面 + self-play 收口 ⇒ 本切片不拦，且欠账必须留到 4.x 的货币判据', () => {
  const repo = repoWithFile(ART, { mode: 'dual', deepReview: SELF_PLAY })
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART]]), repo, () => null)
    assert.deepStrictEqual(r.reasons, [],
      `非高危面上的自扮演此刻仍算闭环（等 tasks 4.x 的变异产物货币才收紧）。实际 ${JSON.stringify(r.reasons)}`)
    assert.strictEqual(r.checked, 1)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})
