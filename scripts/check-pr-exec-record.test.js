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

test('QM-6 i2：decider 的行数统计与 hash 必须同一口径（都排除 .ccg）', () => {
  // 曾实测分离：stats 用 --cached --numstat（不排除 .ccg），hash 用排除 .ccg
  // ⇒ 纯 .ccg 提交 stats 非空而 hash 空 ⇒ 回落旧命名 ⇒ 回到要消灭的撞名。
  const src = fs.readFileSync(path.join(__dirname, 'ccg-review-decider.js'), 'utf8').replace(/\r\n/g, '\n')
  const s = src.indexOf('function collectStaged')
  const e = src.indexOf('\n}\n', s)
  const body = src.slice(s, e)
  const numstat = body.slice(body.indexOf('--numstat'), body.indexOf('--numstat') + 90)
  assert.match(numstat, /:\(exclude\)\.ccg/,
    'numstat 必须排除 .ccg —— 与 stagedDiffHash 同口径；否则同一份 diff 判出不同 mode 与不同名字')
  assert.match(body, /diff", "--cached", "-U0", "--", "\.", ":\(exclude\)\.ccg/,
    '-U0 也必须排除 .ccg（口径要对齐的是**两条**命令，不是只改第一条）')
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
test('丙 classifyEvidenceTier：闭集四档 + 其余一律 unknown（大小写/空格都不放过）', () => {
  const c = mod.classifyEvidenceTier
  assert.strictEqual(typeof c, 'function', '必须导出 classifyEvidenceTier')
  assert.strictEqual(c({ tier: 'external', evidence: '<TEMP>/qm6-backend.log#ses_probe0001' }), 'external')
  assert.strictEqual(c({ tier: 'external' }), 'external-unverified', '只有声明没有出处 ⇒ 不算外部证据')
  assert.strictEqual(c({ tier: 'external', evidence: '   ' }), 'external-unverified', '空白 evidence 等于没填')
  assert.strictEqual(c({ tier: 'external', evidence: 42 }), 'external-unverified', '非字符串 evidence 不得被 String() 蒙过去')
  assert.strictEqual(c({ tier: 'self-play' }), 'self-play')
  assert.strictEqual(c({ tier: 'none' }), 'none')
  for (const bad of [undefined, null, {}, { tier: null }, { tier: '' }, { tier: 'External' }, { tier: ' external ' }, { tier: 'claude' }, { tier: '自扮演' }]) {
    assert.strictEqual(c(bad), 'unknown', '取值不在闭集内一律 unknown：' + JSON.stringify(bad))
  }
})

test('丙 summarizeTierCoverage：五档计数 + 空集也必须给读数（反失明）', () => {
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
  assert.strictEqual(r.by.unknown, 2)
  assert.match(r.line, /TIER-COVERAGE/, '读数行必须有固定前缀，否则没人能在 CI 日志里 grep 到它')
  assert.match(r.line, /total=7/)
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
