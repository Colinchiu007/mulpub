'use strict'
/**
 * check-main-red 的回归锁（node --test，零网络、零 gh）
 *
 * 四条写法纪律：
 * 1. 取数一律注入假 collector——**任何用例都不许真调 gh**（仓内 network-egress-guard 会红，
 *    而且"线上恰好能取到"不是判据）。
 * 2. 夹具必须与**真实两种响应形状**逐字同形：`gh pr checks` 给 `state`（大写枚举），
 *    `gh api .../check-runs` 给 `status`（小写）+ `conclusion`。夹具若自造第三种形状
 *    （把大写值塞进 status），判据对真形状的缺陷就结构性免疫（AGENTS「契约夹具不得替对方剥壳」同型）。
 * 3. 每条正向都要配一条**方向相反**的对照：豁免只豁免既有红、skipped 不算主干红、
 *    "取不到数"不得读成"没有红"。少一条对照，判据就可以在改坏时照样绿。
 * 4. 最后一条是**接线锁**：本判据必须被 merge-when-green 的两个入口调用，且必须发生在合并动作之前。
 *    「实现存在且单测全绿」不等于「有人调它」——本仓把它记作「装饰性链路」。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')

const { judge, bucketOf, readout, resolveRepoSlug, mentionsName } = require('./lib/main-red')
const { parseArgs, run, createGhCollector, parseCheckRunLines } = require('./check-main-red')

/** `gh pr checks --json name,state` 的真实形状 */
const prRow = (name, state) => ({ name, state })
/** `gh api .../commits/<sha>/check-runs` 的真实形状（结果在 conclusion，status 是小写） */
const apiRow = (name, conclusion) => ({ name, status: 'completed', conclusion })
const apiPending = (name) => ({ name, status: 'in_progress', conclusion: null })

test('两种响应形状必须落进同一个桶（否则一侧的读数其实是探针失明）', () => {
  assert.strictEqual(bucketOf(prRow('A', 'FAILURE')), 'fail')
  assert.strictEqual(bucketOf(apiRow('A', 'failure')), 'fail')
  assert.strictEqual(bucketOf(prRow('A', 'SUCCESS')), 'pass')
  assert.strictEqual(bucketOf(apiRow('A', 'success')), 'pass')
  assert.strictEqual(bucketOf(prRow('A', 'PENDING')), 'pending')
  assert.strictEqual(bucketOf(apiPending('A')), 'pending')
  assert.strictEqual(bucketOf(apiRow('A', 'skipped')), 'skipped')
  // 形状不合合同：completed 却没有 conclusion ⇒ 不猜，落 unknown（既不算红也不算绿）
  assert.strictEqual(bucketOf({ name: 'A', status: 'completed', conclusion: null }), 'unknown')
})

test('主干绿 + 本 PR 全绿 ⇒ OK / exit 0', () => {
  const v = judge({
    prRows: [prRow('QG Changes', 'SUCCESS'), prRow('Gate Result', 'SUCCESS')],
    mainRows: [apiRow('QG Changes', 'success')],
  })
  assert.strictEqual(v.verdict, 'OK')
  assert.strictEqual(v.code, 0)
})

test('本 PR 有红且主干无同名红 ⇒ NEW_RED，并点名是哪一条', () => {
  const v = judge({
    prRows: [prRow('QG Unit Tests', 'SUCCESS'), prRow('QG Desktop Shards (1/2)', 'FAILURE')],
    mainRows: [apiRow('QG Unit Tests', 'success')],
  })
  assert.strictEqual(v.verdict, 'NEW_RED')
  assert.strictEqual(v.code, 1)
  assert.deepStrictEqual(v.newRed, ['QG Desktop Shards (1/2)'])
})

test('PR 的红与主干的红同名、且主干仍红 ⇒ STOP_MAIN_RED（不是"已解释"）', () => {
  const v = judge({
    prRows: [prRow('QG Coverage', 'FAILURE')],
    mainRows: [apiRow('QG Coverage', 'failure'), apiRow('Gate Result', 'failure')],
  })
  assert.strictEqual(v.verdict, 'STOP_MAIN_RED')
  assert.strictEqual(v.code, 2)
  assert.deepStrictEqual(v.inherited, ['QG Coverage'])
  assert.ok(v.mainFail.includes('Gate Result'), '主干另一格也必须被点名，否则归因不完整')
})

test('显式归因后：既有红放行、但新增红仍然拦（豁免的作用域只有差集外）', () => {
  const withOnlyInherited = judge({
    prRows: [prRow('QG Coverage', 'FAILURE')],
    mainRows: [apiRow('QG Coverage', 'failure')],
    allowMainRed: 'QG Coverage：本 PR 就是去修那条分片红（证据：main push run 39171164409）',
  })
  assert.strictEqual(withOnlyInherited.verdict, 'OK')
  assert.strictEqual(withOnlyInherited.code, 0)

  const withNewToo = judge({
    prRows: [prRow('QG Coverage', 'FAILURE'), prRow('QG Visual', 'FAILURE')],
    mainRows: [apiRow('QG Coverage', 'failure')],
    allowMainRed: 'QG Coverage：同上',
  })
  assert.strictEqual(withNewToo.verdict, 'NEW_RED', '把豁免写成"全部放行"就是关掉这道门')
  assert.deepStrictEqual(withNewToo.newRed, ['QG Visual'])
})
test('只有 pending ⇒ INCOMPLETE；pending 与「已被证明的新增红」并存时必须 NEW_RED（第三轮 i3）', () => {
  const onlyPending = judge({ prRows: [prRow('QG Static', 'IN_PROGRESS')], mainRows: [apiRow('QG Changes', 'success')] })
  assert.strictEqual(onlyPending.verdict, 'INCOMPLETE')
  assert.strictEqual(onlyPending.code, 3)
  const pendingApi = judge({ prRows: [apiPending('QG Static')], mainRows: [] })
  assert.strictEqual(pendingApi.verdict, 'INCOMPLETE', 'check-runs 形状的未完成态也必须被认出来')
  // ⛔ 这条是本档的实质：一条红已经落地，别的格子还没跑完**不能**把它降级成「未证实」。
  // 原版先判 pending ⇒ 最该拦的那一档反而放行去等，AGENTS 四档里 NEW_RED 的优先级被 pending 吃掉了。
  const redPlusPending = judge({
    prRows: [prRow('QG Static', 'IN_PROGRESS'), prRow('QG Coverage', 'FAILURE')],
    mainRows: [apiRow('QG Coverage', 'success')],
  })
  assert.strictEqual(redPlusPending.verdict, 'NEW_RED', 'pending 不得把已被证明的新增红藏成未证实')
  assert.deepStrictEqual(redPlusPending.newRed, ['QG Coverage'])
  assert.match(redPlusPending.reason, /另有 1 条未完成/, '读数要如实说明还有格子没跑完，不得假装全部收敛')
  const none = judge({ prRows: [], mainRows: [apiRow('QG Changes', 'success')] })
  assert.strictEqual(none.verdict, 'INCOMPLETE')
  assert.strictEqual(none.code, 3)
})

test('主干**同名**检查未落地 ⇒ 该条按未证实处理（第三轮 i3；第四轮 i5 收窄为按名字，不再整批降级）', () => {
  // 主干同名检查还没落地时判「新增红」，等于把未证实当证据——那条格子跑完可能正好是同名的既有红。
  const v = judge({ prRows: [prRow('QG Visual', 'FAILURE')], mainRows: [prRow('QG Visual', 'IN_PROGRESS')] })
  assert.strictEqual(v.verdict, 'INCOMPLETE')
  assert.strictEqual(v.code, 3)
  assert.match(v.reason, /主干侧 1 条（主干基准不稳/)
})

test('全部行形状不认识 ⇒ SELF_FAULT 而不是 OK（第三轮 i1，Critical：探针失明不得读成绿灯）', () => {
  const blind = judge({
    prRows: [{ name: 'QG Changes', status: 'completed' }, { name: 'GUI Changes', status: 'completed' }],
    mainRows: [{ name: 'QG Changes', status: 'completed' }],
  })
  assert.strictEqual(blind.verdict, 'SELF_FAULT', 'completed 而无 conclusion ⇒ 「一条红都没找到」其实是判据失明')
  assert.strictEqual(blind.code, 4)
  assert.match(blind.reason, /形状不认识/)
  assert.match(readout(blind, { mainSha: 'm', prSha: 'p' }), /unknown=2\/1/, 'unknown 计数必须进读数行，且分 PR/主干两档')
  const half = judge({ prRows: [prRow('A', 'SUCCESS'), { name: 'B', status: 'completed' }], mainRows: [] })
  assert.strictEqual(half.verdict, 'SELF_FAULT', '只有一条不认识也不许放行——不得用「其余都绿」抵掉那条失明')
})

test('check-runs 按行解析：单页多页同形、坏行点名行号、空文本不算「无检查」（第三轮 i2）', () => {
  const rows = parseCheckRunLines(
    '{"name":"A","status":"completed","conclusion":"success"}\n{"name":"B","status":"in_progress","conclusion":null}')
  assert.deepStrictEqual(rows, [
    { name: 'A', status: 'completed', conclusion: 'success' },
    { name: 'B', status: 'in_progress', conclusion: null },
  ])
  assert.throws(() => parseCheckRunLines('{"name":"A"}\n[{"name":"B"}]'), /第 2 行不是对象/, '多页拼接出来的第二个方括号数组必须被点名（它能被 JSON.parse 解成数组，所以拒它的必须是对象判据而不是解析判据）')
  assert.throws(() => parseCheckRunLines('"A"'), /第 1 行不是对象/, '标量不接受——它是宿主换了 jq 的结果')
  assert.deepStrictEqual(parseCheckRunLines(''), [], 'gh rc=0 而零行 = 这个 commit 上还没有检查；抛错会让 judge 的「零检查 ⇒ INCOMPLETE」档永不可达（第四轮 i3）')
})


test('主干上 skipped 的格子不算主干红 ⇒ PR 在该格红即为新增红', () => {
  const v = judge({
    prRows: [prRow('QG Static', 'FAILURE')],
    mainRows: [apiRow('QG Static', 'skipped')],
  })
  assert.strictEqual(v.verdict, 'NEW_RED', 'docs-only 短路的格子不是"已解释的红"')
  assert.deepStrictEqual(v.mainFail, [])
})

test('采集层没交出数组（判据自身故障）⇒ exit 4，与"发现红"的 1/2 分档', () => {
  assert.strictEqual(judge({ prRows: null, mainRows: [] }).code, 4)
  assert.strictEqual(judge({ prRows: undefined, mainRows: undefined }).verdict, 'SELF_FAULT')
})

test('读数行必须自己承认走的是哪一档，且把 sha 打出来（不留"测了什么都不知道"的读数）', () => {
  // 夹具带一条真实存在的主干读数：mainRows=[] 现在判 INCOMPLETE（第五轮 C1），而本用例要测的是
  // 「读数行是否承认档位」——零基准那一面由 C1 那条专测守住，不在这里兼顾。
  const line = readout(judge({ prRows: [prRow('A', 'FAILURE')], mainRows: [apiRow('QG Visual', 'success')] }), { mainSha: 'deadbeef', prSha: 'cafef00d' })
  assert.ok(line.startsWith('MAIN-RED verdict=NEW_RED exit=1'), line)
  assert.ok(line.includes('main=deadbeef') && line.includes('pr=cafef00d'), line)
  assert.ok(line.includes('newRed=1'), line)
})

test('parseArgs：未知旗标 / 非数字 pr / 空归因一律抛（参数不得静默忽略）', () => {
  assert.throws(() => parseArgs(['--pr', '1', '--alow-main-red', 'x']), /未知参数/)
  assert.throws(() => parseArgs([]), /缺 --pr/)
  assert.throws(() => parseArgs(['--pr', 'abc']), /必须是数字/)
  assert.throws(() => parseArgs(['--pr', '1', '--allow-main-red', '']), /必须带归因文本/)
  assert.strictEqual(parseArgs(['--pr=42', '--allow-main-red=修那条分片红']).pr, '42')
  assert.strictEqual(parseArgs(['--pr', '42', '--allow-main-red', '归因文本']).allowMainRed, '归因文本')
})

test('run() 的退出码取自判据，取数抛错时收敛到 4 而不是 0', async () => {
  // 主干侧走 mainRowsAt（run 集合），PR 侧走 checksAt（check-runs）——2026-10-22 起
  // 「check-runs 只用于 PR 侧」是契约，夹具必须同形，否则下面的判据对真实缺陷结构性免疫。
  const good = {
    repo: 'o/r',
    mainSha: () => 'm1',
    prHeadSha: () => 'p1',
    mainRowsAt: () => [apiRow('A', 'success')],
    checksAt: () => [apiRow('A', 'success'), apiRow('B', 'success')],
  }
  assert.strictEqual(await run(['--pr', '7'], good), 0)

  const boom = {
    repo: 'o/r',
    mainSha: () => 'm1',
    prHeadSha: () => { throw new Error('gh 挂了 rc=1') },
    mainRowsAt: () => [],
    checksAt: () => [],
  }
  assert.strictEqual(await run(['--pr', '7'], boom), 4, '取数失败不得被读成"主干没红"')

  const mainRed = {
    repo: 'o/r',
    mainSha: () => 'm1',
    prHeadSha: () => 'p1',
    mainRowsAt: () => [apiRow('QG Desktop Shards (2/2)', 'failure')],
    checksAt: () => [apiRow('QG Desktop Shards (2/2)', 'failure')],
  }
  assert.strictEqual(await run(['--pr', '7'], mainRed), 2)

  const newRed = {
    repo: 'o/r',
    mainSha: () => 'm1',
    prHeadSha: () => 'p1',
    mainRowsAt: () => [apiRow('A', 'success')],
    checksAt: () => [apiRow('A', 'success'), apiRow('QG Visual', 'failure')],
  }
  assert.strictEqual(await run(['--pr', '7'], newRed), 1)
})

test('接线锁：两个合并入口都必须调本判据，且必须排在合并动作之前', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'merge-when-green.sh'), 'utf8')
  const ps = fs.readFileSync(path.join(__dirname, 'merge-when-green.ps1'), 'utf8')
  // 判"有没有被调用"必须落到**被调用的那个路径本身**，不能只 match 子串：
  // 把调用改成 `scripts/_nope-check-main-red.js` 时 `/check-main-red\.js/` 照样命中，
  // 于是"摘掉调用"这种变异全绿通过——本驱动第一版的 N3 就是这样被暴露成 MISSED 的。
  const invoked = (src) => {
    const hits = [...src.matchAll(/node\s+(['"]?)([^\s'"]*check-main-red\.js)\1/g)].map((m) => m[2])
    return [...new Set(hits)]
  }
  for (const [name, src] of [['sh', sh], ['ps1', ps]]) {
    const got = invoked(src)
    assert.deepStrictEqual(got, ['scripts/check-main-red.js'], name + ' 调用的必须是那一个真实脚本路径，实到 ' + JSON.stringify(got))
    assert.ok(fs.existsSync(path.join(path.dirname(__dirname), 'scripts', 'check-main-red.js')), '被调脚本必须存在（路径写错时闸门是静默 no-op）')
  }
  const shMergeIdx = sh.indexOf('pulls/${PR}/merge')
  const shGateIdx = sh.indexOf('check-main-red.js')
  assert.ok(shGateIdx >= 0 && shMergeIdx >= 0 && shGateIdx < shMergeIdx, 'sh：闸门必须在 REST 合并之前')
  const psMergeIdx = ps.indexOf('pulls/$PrNumber/merge')
  const psGateIdx = ps.indexOf('check-main-red.js')
  assert.ok(psGateIdx >= 0 && psMergeIdx >= 0 && psGateIdx < psMergeIdx, 'ps1：闸门必须在 REST 合并之前')
})

test('两个入口都不得自带第二份判定（判定被抄成两份必然漂移）', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'merge-when-green.sh'), 'utf8')
  const ps = fs.readFileSync(path.join(__dirname, 'merge-when-green.ps1'), 'utf8')
  for (const [name, src] of [['sh', sh], ['ps1', ps]]) {
    const code = src.split('\n').filter((l) => !/^\s*(#|\$|#\s)/.test(l) || l.indexOf('check-main-red') >= 0).join('\n')
    assert.ok(!/mainFail|newRed\s*=|inherited/.test(code), name + ' 里出现差集计算说明判定被抄了两份')
  }
})

test('规模下界（反失明）：判据本体必须保住五档语义，少一档说明有人把它改成了 no-op', () => {
  const src = fs.readFileSync(path.join(__dirname, 'lib', 'main-red.js'), 'utf8')
  for (const v of ['OK', 'NEW_RED', 'STOP_MAIN_RED', 'INCOMPLETE', 'SELF_FAULT']) {
    assert.ok(src.includes(v), '缺少档位 ' + v)
  }
  const exits = new Set([...src.matchAll(/code:\s*(\d)/g)].map((m) => m[1]))
  assert.ok(exits.size >= 5, '退出码档位不足 5 档（读数分档被合并了）')
  assert.ok(exits.has('0') && exits.has('1') && exits.has('2') && exits.has('3') && exits.has('4'), '退出码必须逐档可分辨：' + [...exits].join(','))
})

test('仓库 slug 解析不得依赖 gh 的 host 键（本机实测：未配置时 rc=1「could not find key host」）', () => {
  // 这条是**自己的 PR 上撞出来的**：第一版用 `gh config get host` 定 slug，
  // 而该键未设置时 gh 直接失败 ⇒ 闸门对任何人任何 PR 都恒判 SELF_FAULT。
  // 「闸门永远红」比「闸门漏判」更快被发现，但也同样是装饰性门禁的反面——它一次都拦不了。
  assert.deepStrictEqual(
    resolveRepoSlug({ remoteUrl: 'https://github.com/Colinchiu007/mulpub.git' }),
    { slug: 'Colinchiu007/mulpub', via: 'git-remote' })
  assert.deepStrictEqual(
    resolveRepoSlug({ remoteUrl: 'git@github.com:acme/widget.git' }),
    { slug: 'acme/widget', via: 'git-remote' })
  assert.deepStrictEqual(
    resolveRepoSlug({ remoteUrl: 'ssh://git@github.com/acme/widget' }),
    { slug: 'acme/widget', via: 'git-remote' })
  // 优先级：显式 > GH_REPO > git remote > 兜底
  assert.strictEqual(resolveRepoSlug({ explicit: 'a/b', ghRepoEnv: 'c/d', remoteUrl: 'https://github.com/e/f.git' }).slug, 'a/b')
  assert.strictEqual(resolveRepoSlug({ ghRepoEnv: 'c/d', remoteUrl: 'https://github.com/e/f.git' }).slug, 'c/d')
  assert.strictEqual(resolveRepoSlug({ remoteUrl: 'https://gitea.internal/team/repo.git' }).slug, 'team/repo')
  // 解析不出来的必须**出声**，不得回一个看起来能用的 slug
  assert.strictEqual(resolveRepoSlug({ remoteUrl: 'not-a-url' }).slug, null)
  assert.match(resolveRepoSlug({ remoteUrl: 'not-a-url' }).via, /git-remote-unparsed/)
  assert.strictEqual(resolveRepoSlug({}).slug, null)
  // 兜底常量是最后一格，且必须被标出来（静默用默认仓库 = 把别人的 CI 状态当自己的）
  const fb = resolveRepoSlug({ fallback: 'x/y' })
  assert.strictEqual(fb.slug, 'x/y')
  assert.match(fb.via, /fallback/)
})

test('createGhCollector 必须真的导出可用（接线：CLI 与判据之间的唯一缝）', () => {
  assert.strictEqual(typeof createGhCollector, 'function')
  const c = createGhCollector('someone/repo')
  assert.strictEqual(c.repo, 'someone/repo')
  assert.strictEqual(c.slugVia, '--repo', '显式传仓库时不得再猜')
})

test('读数行在任何非 SELF_FAULT 出口都必须是实数，不得出现 `=?`', () => {
  // `=?` 与 `=0` 在扫一眼时几乎同形，而后者意味着"这次拦下了 0 条新增红"——
  // 把"没算出来"印成看起来像算过的样子，就是本仓「把工具的失明读成结论」的读数版。
  const cases = [
    { prRows: [], mainRows: [] },
    { prRows: [prRow('A', 'IN_PROGRESS')], mainRows: [] },
    { prRows: [prRow('A', 'SUCCESS')], mainRows: [apiRow('A', 'success')] },
    { prRows: [prRow('A', 'FAILURE')], mainRows: [apiRow('A', 'failure')] },
    { prRows: [prRow('A', 'FAILURE')], mainRows: [] },
  ]
  cases.forEach((c, i) => {
    const v = judge(c)
    assert.notStrictEqual(v.verdict, 'SELF_FAULT', '第 ' + i + ' 组不该走自身故障档')
    const line = readout(v, { mainSha: 'm', prSha: 'p' })
    assert.ok(!line.includes('=?'), '读数缺计数：' + line)
  })
})

test('git 与 gh 不得混用（第一版把 rev-parse 发给了 gh ⇒ 闸门恒 SELF_FAULT）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-main-red.js'), 'utf8')
  // 判据只量代码：注释里要写清"曾经错过"，不剥注释这条锁会因为解释禁词而判红
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  assert.ok(!/run\(\s*\[\s*'rev-parse'/.test(code), "rev-parse 必须由 runGit 发，不能进 run()（那是 gh）")
  assert.match(code, /runGit\(\s*\[\s*'rev-parse',\s*'origin\/main'\s*\]/, 'main sha 的取法必须存在且走 git')
  // 正控：证明上面两条禁词不是"整份文件都读不到"造成的假通过
  assert.match(code, /spawnSync\('gh'/)
  assert.match(code, /spawnSync\('git'/)
})

test('主干上一条**无关的** pending 不得遮蔽 PR 侧已证实的红（第四轮 i5）', () => {
  const v = judge({
    prRows: [prRow('QG Visual', 'FAILURE')],
    mainRows: [prRow('QG Desktop Shards (1/2)', 'IN_PROGRESS')],
  })
  assert.strictEqual(v.verdict, 'NEW_RED', '整批降级会让「主干有 4 条在跑」变成任何 PR 的红都判不出来——那是把拦换成不拦')
  assert.deepStrictEqual(v.newRed, ['QG Visual'])
})

test('主干确红必须先于 PR 侧 pending 报 STOP_MAIN_RED（第四轮 i2）', () => {
  const v = judge({
    prRows: [prRow('QG Static', 'IN_PROGRESS')],
    mainRows: [apiRow('QG Coverage', 'failure')],
  })
  assert.strictEqual(v.verdict, 'STOP_MAIN_RED')
  assert.strictEqual(v.code, 2)
  assert.match(v.reason, /主干是红的/, '未完成态把「要有人去修 main」这个信号藏掉，正是本片要消灭的形态')
})

test('--allow-main-red 必须点名真实失败检查，否则不算裁决（第四轮 i4）', () => {
  const unnamed = judge({
    prRows: [prRow('QG Static', 'SUCCESS')],
    mainRows: [apiRow('QG Coverage', 'failure')],
    allowMainRed: '我确认过主干状态，可以放行',
  })
  assert.strictEqual(unnamed.verdict, 'SELF_FAULT', '任意非空字符串即全量放行 = 「写个非空串」就是出口')
  assert.strictEqual(unnamed.code, 4)
  const named = judge({
    prRows: [prRow('QG Static', 'SUCCESS')],
    mainRows: [apiRow('QG Coverage', 'failure')],
    allowMainRed: 'QG Coverage：本 PR 正是去修它，main push run 39171164409',
  })
  assert.strictEqual(named.verdict, 'OK')
  assert.deepStrictEqual(named.allowed, ['QG Coverage'], '放行面必须留下「到底豁免了哪几条」的现场')
})

test('取数前必须 fetch origin/main，否则过期 ref 把远端已红读成绿（第四轮 i1，Critical）', () => {
  // 结构锁：collector 里 fetch 必须排在 rev-parse **之前**。只断言「有没有调用 fetch」不够——
  // 顺序反了读到的还是旧快照，而这条锁存在本身就会让下一个会话以为「已经修过了」。
  const src = fs.readFileSync(path.resolve(__dirname, 'check-main-red.js'), 'utf8')
  const iFetch = src.indexOf("'fetch', 'origin', 'main'")
  const iRev = src.indexOf("rev-parse', 'origin/main'")
  assert.ok(iFetch > 0, 'mainSha 必须先 fetch：worktree 里的 remote-tracking ref 只是上次 fetch 的快照')
  assert.ok(iRev > iFetch, 'fetch 必须排在 rev-parse 之前，否则取的仍是旧 ref ⇒ 远端刚变红会被读成绿并 exit 0')
})


// ── 第五轮（fresh-context 对抗评审 C1-C7，2026-10-20）──────────────────────

test('主干侧零读数不得读成「主干绿」——判据原先只给 PR 侧设了零检查档（评审 C1，Critical）', () => {
  const v = judge({
    prRows: [prRow('Gate Result', 'SUCCESS'), prRow('QG Changes', 'SUCCESS')],
    mainRows: [],
  })
  assert.strictEqual(v.verdict, 'INCOMPLETE', 'mainRows=[] 时 mainFail/mainPending/mainUnknown 三集全空，原版一路走到最后一档打印「主干绿、本 PR 无红」并 exit 0——把「这次没读到主干」读成「主干是绿的」，正是本文件第 3 条口径要防的同型')
  assert.strictEqual(v.code, 3)
  assert.match(v.reason, /主干/, '文案必须点名是主干侧没读数，否则下一个读者会去 PR 侧找毛病')
})

test('豁免必须覆盖全部主干红，只点一条不得放行整批（评审 C3，High）', () => {
  const v = judge({
    prRows: [prRow('QG Changes', 'SUCCESS')],
    mainRows: [apiRow('QG Coverage', 'failure'), apiRow('QG Visual', 'failure'), apiRow('Gate Result', 'failure')],
    allowMainRed: 'QG Coverage：本 PR 正是去修它，main push run 39171164409',
  })
  assert.strictEqual(v.verdict, 'STOP_MAIN_RED', '原版只要 matched>=1 就 OK：点名 1 条即把另外 2 条没人读过的红一起豁免，而 AGENTS 把这条出口写成「本 PR 正是去修那条红的」')
  assert.strictEqual(v.code, 2)
  assert.match(v.reason, /QG Visual/, '未点名的主干红必须被念出来，否则「到底豁免了哪几条」这个现场仍然缺失')
})

test('豁免归因按名字边界匹配，不得让 Gate Result 替 Gate Result 2 顶罪（评审 C3 附带）', () => {
  assert.ok(mentionsName('Gate Result 2：修它，run 1', 'Gate Result 2'), '正控：真点名的必须命中')
  assert.ok(!mentionsName('Gate Result 2：修它，run 1', 'Gate Result'), '子串匹配会把相邻键名算成已点名——那是一条没人读过的红被静默豁免')
  const v = judge({
    prRows: [prRow('QG Changes', 'SUCCESS')],
    mainRows: [apiRow('Gate Result', 'failure'), apiRow('Gate Result 2', 'failure')],
    allowMainRed: 'Gate Result 2：本 PR 正是去修它',
  })
  assert.strictEqual(v.verdict, 'STOP_MAIN_RED')
})

test('commit status 的 EXPECTED/NO_STATE/STARTING 归 pending，不得落 unknown 把闸门钉成恒 rc=4（评审 C7）', () => {
  for (const s of ['EXPECTED', 'NO_STATE', 'STARTING']) {
    assert.strictEqual(bucketOf({ name: 'ext', state: s }), 'pending', s + ' 是「还没结果」，不是「形状不认识」')
  }
  assert.strictEqual(bucketOf({ name: 'ext', state: 'TOTALLY_NEW' }), 'unknown', '真未知枚举仍然 fail-closed')
})

test('接线锁必须剥注释，且闸门要排在第一个失败出口之前（评审 C2 的入口错位 + C4）', () => {
  const strip = (src) => src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const sh = strip(fs.readFileSync(path.join(__dirname, 'merge-when-green.sh'), 'utf8'))
  const ps = strip(fs.readFileSync(path.join(__dirname, 'merge-when-green.ps1'), 'utf8'))
  const cases = [
    ['sh', sh, ['exit 4', 'exit 5']],
    ['ps1', ps, ['没有任何 CI 检查', 'CI 检查未通过']],
  ]
  for (const [name, src, exits] of cases) {
    const gate = src.indexOf('check-main-red.js')
    assert.ok(gate >= 0, name + ' 剥注释后必须仍然命中判据调用（注释里的字样不算接线）')
    for (const e of exits) {
      const i = src.indexOf(e)
      assert.ok(i >= 0, name + ' 里找不到失败出口锚点「' + e + '」——锚点失效是探针失明，不是通过')
      assert.ok(gate < i, name + '：闸门排在「' + e + '」之后 ⇒ 在「主干红 ⇒ 每个 PR 的 Gate Result 跟着红」这个立项场景里它一次都不会执行')
    }
  }
})

test('合并请求必须绑定被验证过的那个 head sha（评审 C6）', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'merge-when-green.sh'), 'utf8')
  const ps = fs.readFileSync(path.join(__dirname, 'merge-when-green.ps1'), 'utf8')
  assert.match(sh, /-f\s+"sha=/, 'sh：不传 sha 时 GitHub 合并的是执行那一刻的 head，闸门验的 sha 与落进主干的产物可以不是同一笔')
  assert.match(ps, /"sha=/, 'ps1：同上')
})

test('ps1 的 Fail() 必须真把退出码交出去（EAP=Stop 下 Write-Error 吞掉 exit，本机实测塌成 rc=1）', (t) => {
  const ps = fs.readFileSync(path.join(__dirname, 'merge-when-green.ps1'), 'utf8')
  const at = ps.indexOf('function Fail')
  assert.ok(at > 0, '锚点必须存在，找不到即探针失明')
  const body = ps.slice(at, at + 400)
  assert.ok(!/Write-Error/.test(body), 'Fail() 里的 Write-Error 在 $ErrorActionPreference=Stop 下抛终止错误、后面的 exit $code 永不执行 ⇒ 2/3/4/5/6/7 全部塌成 rc=1，本判据的五档语义在入口路径上不可分辨')
  assert.match(body, /exit \$code/)
  if (process.platform === 'win32') {
    const os = require('node:os')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-ps-fail-rc-'))
    const probe = path.join(dir, 'probe.ps1')
    // 第六轮 i8：清理必须挂在 t.after() 上——断言失败时裸 rmSync 两行根本不会执行，temp 目录就地泄漏（泄漏本身不报错，所以只有磁盘知道）。
    t.after(() => { fs.rmSync(probe, { force: true }); fs.rmSync(dir, { recursive: true, force: true }) })
    fs.writeFileSync(probe, "$ErrorActionPreference = 'Stop'\n" + ps.slice(at, ps.indexOf('\n}', at) + 2) + "\nFail 'boom' 7\nWrite-Host 'AFTER_LINE_REACHED'\n", 'utf8')
    const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probe], { encoding: 'utf8' })
    assert.strictEqual(r.status, 7, '行为锁：退出码必须原样交出（同形态用 Write-Error 实测给 1）')
    assert.ok(!/AFTER_LINE_REACHED/.test(r.stdout || ''), 'Fail 之后不得继续执行')
    assert.ok(/FAIL\(7\): boom/.test(r.stderr || ''), '行为锁：失败必须同时进 stderr（只走 stdout 时，按 stderr 判失败的调用方会漏捕）；实到 ' + JSON.stringify(String(r.stderr).slice(0, 160)))
    console.log('[ps-fail-rc] platform=win32 probe_rc=' + r.status)
  } else {
    console.log('[ps-fail-rc] platform=' + process.platform + ' 行为锁不在本平台跑（结构锁仍守住）')
  }
})


test('同名 pending 摘掉的那条红必须进 counts 与读数行（第六轮 i4：只在 reason 里说过一次）', () => {
  // 这一格不是修辞：判定把「主干同名还没落地」的红从新增红里摘出来，此前**只在 reason 散文里提了一句**。
  // 读数行是下一个读者唯一能机械对账的地方，缺一个键就等于这次跑没算出来（本文件第 104 行那条纪律的同型）。
  const onlyUncertain = judge({
    prRows: [prRow('QG Changes', 'SUCCESS'), prRow('QG Coverage', 'FAILURE')],
    mainRows: [apiRow('QG Visual', 'success'), apiPending('QG Coverage')],
  })
  assert.strictEqual(onlyUncertain.verdict, 'INCOMPLETE', '同名 pending 时不得判新增红，也不得判绿：' + onlyUncertain.verdict)
  assert.strictEqual(onlyUncertain.counts.uncertain, 1, 'counts 必须带 uncertain 键且为实数，实到 ' + JSON.stringify(onlyUncertain.counts))
  assert.ok(readout(onlyUncertain, {}).includes('uncertain=1'), '读数行必须打出 uncertain=1，实到 ' + readout(onlyUncertain, {}))

  // 反向对照：一条**已落地**的新增红不被同名 pending 撤销，但两条都要在 counts 里看得见。
  const mixed = judge({
    prRows: [prRow('QG Coverage', 'FAILURE'), prRow('QG Visual', 'FAILURE')],
    mainRows: [apiRow('QG Changes', 'success'), apiPending('QG Coverage')],
  })
  assert.strictEqual(mixed.verdict, 'NEW_RED', '已证明的红不会被别的格子还没跑完撤销：' + mixed.verdict)
  assert.deepStrictEqual(mixed.newRed, ['QG Visual'], '新增红只该有 QG Visual，实到 ' + JSON.stringify(mixed.newRed))
  assert.strictEqual(mixed.counts.uncertain, 1, 'NEW_RED 档同样要如实报 uncertain 条数，实到 ' + JSON.stringify(mixed.counts))
  assert.ok(readout(mixed, {}).includes('newRed=1 uncertain=1'), '两个计数必须同排行出，实到 ' + readout(mixed, {}))

  // 全绿时 uncertain 必须是 0 而不是缺席（缺席与 0 快扫一眼同形）。
  const clean = judge({ prRows: [prRow('QG Changes', 'SUCCESS')], mainRows: [apiRow('QG Changes', 'success')] })
  assert.strictEqual(clean.counts.uncertain, 0, '合法终态也得给出 uncertain=0，实到 ' + JSON.stringify(clean.counts))
})

test('无名/非对象的行必须判 SELF_FAULT（第七轮 i7：namesBy 会静默跳过它们）', () => {
  // 这一格是判据本体最容易漏的一类：bucketOf(null) 归到 unknown，但 namesBy 先按名字过滤，
  // 无名行**既不进 fail 也不进 unknown 集合** ⇒「一条红都没找到」的读数其实是探针失明。
  const nameless = judge({
    prRows: [prRow('QG Changes', 'SUCCESS'), { state: 'FAILURE' }, null, { name: '   ', state: 'FAILURE' }],
    mainRows: [apiRow('QG Changes', 'success')],
  })
  assert.strictEqual(nameless.verdict, 'SELF_FAULT', '无名行不得被静默吞掉：' + nameless.verdict + ' ｜ ' + nameless.reason)
  assert.strictEqual(nameless.code, 4, '必须是 4 档（判据自身/宿主形状不可信），实到 ' + nameless.code)
  assert.ok(/无名或非对象/.test(nameless.reason), '红文案必须点名是哪种坏行，实到 ' + nameless.reason)

  const mainNameless = judge({ prRows: [prRow('QG Changes', 'SUCCESS')], mainRows: [{ status: 'completed', conclusion: 'failure' }] })
  assert.strictEqual(mainNameless.verdict, 'SELF_FAULT', '主干侧同理：' + mainNameless.verdict)

  // 正控：正常两侧各一行必须照旧走各自的档位，这条守卫不得把合法读数判成故障。
  const fine = judge({ prRows: [prRow('QG Changes', 'SUCCESS')], mainRows: [apiRow('QG Changes', 'success')] })
  assert.strictEqual(fine.verdict, 'OK', '合规形态必须仍绿：' + fine.verdict + ' ｜ ' + fine.reason)
})

test('PR 零读数但主干已红 ⇒ 必须报 STOP_MAIN_RED，不许被「无从判定」藏掉（第八轮 i1/i2）', () => {
  const mainRed = [apiRow('Gate Result', 'failure'), apiRow('QG Visual', 'success')]
  const v = judge({ prRows: [], mainRows: mainRed })
  assert.strictEqual(v.verdict, 'STOP_MAIN_RED', '主干红是既成事实，不因 PR 侧没读数而降级成未证实：' + v.verdict + ' ｜ ' + v.reason)
  assert.strictEqual(v.code, 2, '必须是 2 档（要有人去修 main），实到 ' + v.code)
  assert.ok(/Gate Result/.test(v.reason), '理由必须点名主干失败格子，实到 ' + v.reason)
  assert.ok(/本 PR 一条检查都没有/.test(v.reason), '理由必须同时说出 PR 侧零读数，否则会被读成主干侧问题：' + v.reason)

  // 豁免在这里不够格：--allow-main-red 豁免的是「既有红」，豁免不了一份「PR 侧根本没读数」。
  const allowed = judge({ prRows: [], mainRows: mainRed, allowMainRed: 'Gate Result：本 PR 就是去修它' })
  assert.strictEqual(allowed.verdict, 'INCOMPLETE', '带豁免仍不得判 OK：' + allowed.verdict + ' ｜ ' + allowed.reason)
  assert.strictEqual(allowed.code, 3, '实到 ' + allowed.code)

  // 原形态不得被这次改动打掉：主干绿 + PR 零读数 仍是 INCOMPLETE(3)。
  const green = judge({ prRows: [], mainRows: [apiRow('QG Visual', 'success')] })
  assert.strictEqual(green.verdict, 'INCOMPLETE', '主干绿时 PR 零读数仍是未证实：' + green.verdict)
  assert.strictEqual(green.code, 3)

  // i3：STOP_MAIN_RED 的理由要与 counts 同口径——uncertain 不能只活在机器面里。
  const withUnc = judge({
    prRows: [prRow('QG Changes', 'SUCCESS'), prRow('QG Coverage', 'FAILURE')],
    mainRows: [apiRow('Gate Result', 'failure'), apiPending('QG Coverage')],
  })
  assert.strictEqual(withUnc.verdict, 'STOP_MAIN_RED', '实到 ' + withUnc.verdict + ' ｜ ' + withUnc.reason)
  assert.strictEqual(withUnc.counts.uncertain, 1, 'counts 侧实到 ' + JSON.stringify(withUnc.counts))
  assert.ok(/1 条与主干同名未完成/.test(withUnc.reason), '理由必须带上同名未完成条数，实到 ' + withUnc.reason)
})

test('豁免放行前必须确认 PR 自己已有读数（第九轮 i1：allow 分支曾经直接返回 OK 而不看 prPending）', () => {
  const mainRows = [apiRow('Gate Result', 'failure'), apiRow('QG Visual', 'success')]
  const allow = 'Gate Result：本 PR 就是去修这条'
  const stillPending = judge({
    prRows: [prRow('QG Changes', 'SUCCESS'), prRow('QG Coverage', 'PENDING')],
    mainRows,
    allowMainRed: allow,
  })
  assert.strictEqual(stillPending.verdict, 'INCOMPLETE', 'PR 侧还有格子没跑完时豁免不得放行：' + stillPending.verdict + ' ｜ ' + stillPending.reason)
  assert.strictEqual(stillPending.code, 3, '实到 ' + stillPending.code)
  assert.ok(/PR 侧 1 条/.test(stillPending.reason), '理由必须点出未完成条数，实到 ' + stillPending.reason)
  assert.deepStrictEqual((stillPending.allowed || []).slice(), ['Gate Result'], '豁免本身要如实报点名了哪几条：' + JSON.stringify(stillPending.allowed))

  // 正控：PR 侧全绿 + 主干红被逐条点名，才允许 OK(0)。把这条一起钉住，防止修法退化成「有 allow 也一律拦」。
  const settled = judge({ prRows: [prRow('QG Changes', 'SUCCESS'), prRow('QG Coverage', 'SUCCESS')], mainRows, allowMainRed: allow })
  assert.strictEqual(settled.verdict, 'OK', '合规形态必须仍然放行：' + settled.verdict + ' ｜ ' + settled.reason)
  assert.strictEqual(settled.code, 0)

  // i2：prPending 必须进 counts 与读数行——否则「PR 侧还有 N 条没跑完」只有散文知道。
  assert.strictEqual(stillPending.counts.prPending, 1, 'counts 侧实到 ' + JSON.stringify(stillPending.counts))
  assert.ok(readout(stillPending, {}).includes('prPending=1'), '读数行必须打出 prPending=1，实到 ' + readout(stillPending, {}))
  assert.strictEqual(settled.counts.prPending, 0, '合法终态也要给实数，实到 ' + JSON.stringify(settled.counts))
})

// ── 2026-10-22（change: main-red-run-baseline）────────────────────────────
// 背景与实测依据见 openspec/changes/main-red-run-baseline/proposal.md：
// ① 主干侧读数被 `handle-ci-failure` 噪声淹没（实测 102 条检查行里 81 条是它）；
// ② 读数期间主干 tip 会移动（实测一次读数期间 2f5c0a32f → 8da92948），读数当场作废。

const { selectMainRuns } = require('./check-main-red')

/** 捕获 stdout 的小工具（入口的读数与理由都打在 stdout 上，断言必须落在产物上） */
async function captureStdout (fn) {
  const lines = []
  const orig = console.log
  console.log = (...args) => { lines.push(args.map(String).join(' ')) }
  try {
    const code = await fn()
    return { code, out: lines.join('\n') }
  } finally {
    console.log = orig
  }
}

test('主干基准必须来自 run 集合：workflow_run 触发的 run 不进基准，同一 workflow 只取最新一次', () => {
  const chosen = selectMainRuns([
    { id: 1, name: 'CI Failure Handler (Level 4)', event: 'workflow_run', run_number: 100, run_attempt: 1 },
    { id: 2, name: 'quality-gate', event: 'push', run_number: 10, run_attempt: 1 },
    { id: 3, name: 'quality-gate', event: 'push', run_number: 10, run_attempt: 2 },
    { id: 4, name: 'quality-gate', event: 'push', run_number: 11, run_attempt: 1 },
    { id: 5, name: 'Electron CI', event: 'push', run_number: 11, run_attempt: 1 },
  ])
  assert.deepStrictEqual(
    chosen.map((r) => r.id).sort(),
    [4, 5],
    'workflow_run 的 run 不得进主干基准（它挂到主干 tip 上是 GitHub 的语义，不是主干自己的验证）；'
      + '同一 workflow 必须取最新一次（run_number 最大者）',
  )
  // 重跑不增加 run_number，只增加 run_attempt ⇒ 只比一维会把「重跑已修复」读成「主干仍红」
  const rerun = selectMainRuns([
    { id: 7, name: 'quality-gate', event: 'push', run_number: 20, run_attempt: 1 },
    { id: 8, name: 'quality-gate', event: 'push', run_number: 20, run_attempt: 2 },
  ])
  assert.deepStrictEqual(rerun.map((r) => r.id), [8], '重跑的那次必须胜出')
  // 反失明：event 字段缺失 = 形状不认识 ⇒ 抛错，不得当作「不是 workflow_run」放行
  assert.throws(
    () => selectMainRuns([{ id: 9, name: 'quality-gate', run_number: 1, run_attempt: 1 }]),
    /缺 event 字段/,
    'event 字段缺失时不得静默放行——那等于把「没读到事件类型」读成「它是主干自己的验证」',
  )
})

test('结构锁：主干侧必须走 mainRowsAt，check-runs 只允许用于 PR 侧（噪声源不得回潮）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-main-red.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  assert.ok(/c\.mainRowsAt\(/.test(code), '主干侧必须调 mainRowsAt（读该 tip 的非 workflow_run run 集合）')
  const checksAtCalls = (code.match(/c\.checksAt\(/g) || []).length
  assert.strictEqual(checksAtCalls, 1, 'c.checksAt 只能出现一次（PR 侧）；主干侧回落到 check-runs 就是把 81/102 的噪声放回来')
})

test('读数期间主干 tip 移动 ⇒ 本次读数作废并有界重试（拿到稳定读数才判）', async () => {
  const seq = ['m1', 'm2', 'm2', 'm2']
  let i = 0
  const moving = {
    repo: 'o/r',
    mainSha: () => seq[Math.min(i++, seq.length - 1)],
    prHeadSha: () => 'p1',
    mainRowsAt: () => [apiRow('A', 'success')],
    checksAt: () => [apiRow('A', 'success')],
  }
  const { code, out } = await captureStdout(() => run(['--pr', '7', '--attempts', '3', '--retry-seconds', '0'], moving))
  assert.strictEqual(code, 0, '重试后拿到稳定读数就应判绿，实到 ' + code)
  assert.match(out, /MAIN-RED STALE/, '必须打印读数作废的事实，否则下一个读者不知道这次重试过')
  assert.match(out, /m1→m2/, '必须点名移动前后的 tip')
})

test('重试耗尽仍不稳定 ⇒ 判未证实(3)，且必须点名两个 sha（不得读成绿）', async () => {
  let k = 0
  const alwaysMoving = {
    repo: 'o/r',
    mainSha: () => 'm' + (k++),
    prHeadSha: () => 'p1',
    mainRowsAt: () => [apiRow('A', 'success')],
    checksAt: () => [apiRow('A', 'success'), apiRow('B', 'failure')],
  }
  const { code, out } = await captureStdout(() => run(['--pr', '7', '--attempts', '2', '--retry-seconds', '0'], alwaysMoving))
  assert.strictEqual(code, 3, '重试耗尽必须判未证实，实到 ' + code)
  assert.match(out, /INCOMPLETE/, '读数行必须自报档位')
  assert.match(out, /m\d+→m\d+/, '必须点名移动前后的 tip')
})

test('采集层缺 mainRowsAt ⇒ 判自身故障(4)，不得静默回落到 check-runs', async () => {
  const noMainRows = {
    repo: 'o/r',
    mainSha: () => 'm1',
    prHeadSha: () => 'p1',
    checksAt: () => [apiRow('A', 'success')],
  }
  const { code, out } = await captureStdout(() => run(['--pr', '7'], noMainRows))
  assert.strictEqual(code, 4, '缺 mainRowsAt 必须判自身故障，实到 ' + code)
  assert.match(out, /mainRowsAt/, '错误文案必须点名缺的是哪个接口')
})

test('主干侧零行仍按未证实处理（不得读成「主干绿」）', async () => {
  const emptyMain = {
    repo: 'o/r',
    mainSha: () => 'm1',
    prHeadSha: () => 'p1',
    mainRowsAt: () => [],
    checksAt: () => [apiRow('A', 'success')],
  }
  assert.strictEqual(await run(['--pr', '7'], emptyMain), 3, '主干零行不得读成绿')
})

test('基准作废（tip 移动）⇒ 未证实(3)，且不得把 PR 侧的红报成新增红', () => {
  const v = judge({
    prRows: [prRow('QG Visual', 'FAILURE')],
    mainRows: [apiRow('QG Coverage', 'success')],
    mainMoved: { from: 'aaaa1111', to: 'bbbb2222' },
  })
  assert.strictEqual(v.verdict, 'INCOMPLETE', '基准作废时差集不可归因，实到 ' + v.verdict)
  assert.strictEqual(v.code, 3)
  assert.deepStrictEqual(v.newRed, [], '基准作废时不得报新增红——那是把「不可归因」读成「证据」')
  assert.match(v.reason, /aaaa1111/, '必须点名读数时的 tip')
  assert.match(v.reason, /bbbb2222/, '必须点名读数后的 tip')
  assert.match(v.reason, /QG Visual/, 'PR 侧已证实的红必须被点名（但不判新增红）')
})

test('稳定窗参数必须校验：attempts < 1 / 非整数一律抛（参数不得静默取默认）', () => {
  assert.throws(() => parseArgs(['--pr', '1', '--attempts', '0']), /attempts/)
  assert.throws(() => parseArgs(['--pr', '1', '--attempts', 'x']), /attempts/)
  assert.throws(() => parseArgs(['--pr', '1', '--retry-seconds', '-1']), /retry-seconds/)
  assert.strictEqual(parseArgs(['--pr', '1']).attempts, 3)
  assert.strictEqual(parseArgs(['--pr', '1']).retrySeconds, 90)
  assert.strictEqual(parseArgs(['--pr', '1', '--attempts=5', '--retry-seconds=0']).attempts, 5)
})

test('稳定窗总等待必须有上限（评审 i4：attempts × retry-seconds 可传 ⇒ 重试可以无限睡）', async () => {
  assert.throws(() => parseArgs(['--pr', '1', '--max-wait-seconds', '-1']), /max-wait-seconds/)
  assert.throws(() => parseArgs(['--pr', '1', '--max-wait-seconds', 'x']), /max-wait-seconds/)
  assert.strictEqual(parseArgs(['--pr', '1']).maxWaitSeconds, 300, '默认值必须是有限的上限，不是无限')

  // 每次 mainSha 都不同 ⇒ 永远不稳定；上限到了就必须停手（而不是睡满 attempts × retry）
  let k = 0
  const alwaysMoving = {
    repo: 'o/r',
    mainSha: () => 'm' + (k++),
    prHeadSha: () => 'p1',
    mainRowsAt: () => [apiRow('A', 'success')],
    checksAt: () => [apiRow('A', 'success')],
  }
  const { code, out } = await captureStdout(() => run(
    ['--pr', '7', '--attempts', '99', '--retry-seconds', '3600', '--max-wait-seconds', '0'], alwaysMoving))
  assert.strictEqual(code, 3, '上限到 ⇒ 判未证实，实到 ' + code)
  assert.match(out, /STABLE-WAIT-CAP/, '必须打印「因上限停手」的事实，否则下一次读者会以为它重试满了')
  assert.ok(!/STALE attempt=2/.test(out), '上限为 0 时不得再进第二轮（否则上限形同虚设）')
})

test('基准作废档必须把 PR 侧已证实的失败名单交出来（评审 i1：不可归因 ≠ 没有）', () => {
  const v = judge({
    prRows: [prRow('QG Visual', 'FAILURE'), prRow('QG Unit Tests', 'FAILURE')],
    mainRows: [apiRow('QG Coverage', 'success')],
    mainMoved: { from: 'aaaa1111', to: 'bbbb2222' },
  })
  assert.deepStrictEqual(v.prFailNames, ['QG Unit Tests', 'QG Visual'], 'PR 侧已证实的失败名必须可机器读')
  assert.strictEqual(v.newRedComputed, false, 'newRed 在这一档是「未计算」，不得被读成「没有」')
  assert.strictEqual(v.counts.prFail, 2, 'counts.prFail 必须是真值（不是硬编码 0）')
  assert.strictEqual(v.counts.mainFail, 0)
})
