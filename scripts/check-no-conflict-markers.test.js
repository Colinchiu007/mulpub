'use strict'

/**
 * scripts/check-no-conflict-markers.js 的回归锁。
 *
 * 四条设计约束（缺任一条就会退化成装饰门禁）：
 *  ① **合法写法不得命中**：七个等号在本仓是合法 Markdown setext 下划线（实测多处正当用法），
 *    一并禁掉就是造一条会假红的锁；出现在行中间（文档在**引用**这个标记）也不得命中。
 *  ② **自身故障不得读成"没有残留"**：非仓库目录、受管文件读不到、承认清单形态不合法、
 *    CLI 参数用法错误 ⇒ 退出码 2，与"发现违规"(1) / "合规"(0) 严格分档；
 *    `--dry-run` 必须打印扫描域与承认数。
 *  ③ **承认清单是双向棘轮**：只按文件粒度承认时，"已登记文件又多了两行标记"既不触发
 *    未登记、也不触发陈旧 ⇒ 判据照绿（QM-6 外部评审命中）。所以基线计数是判据的一部分：
 *    实际 > 基线 即红；实际 < 基线 只是可见项（收口方向不该被拦）；已无标记 / 文件消失 ⇒ 陈旧红。
 *  ④ **位置本身就是判据**：调用行必须在**非 PR 早退之前**。挪到 `exit 0` 之后时 PR 档照跑、
 *    全部测试照绿，而 main push 档静默失去覆盖 —— 接线锁不钉这一维就等于没钉。
 *
 * 夹具一律走临时目录 + PID（AGENTS「文件系统测试隔离」），承认清单用 --ack-file 注入，
 * 不依赖内置清单——否则任何非本仓的域都会因"4 条登记项都不在这个仓库里"恒红。
 */

const test = require('node:test')
const assert = require('node:assert')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SCRIPT = path.join(__dirname, 'check-no-conflict-markers.js')
const REPO = path.resolve(__dirname, '..')

let seq = 0
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ncm-${process.pid}-${seq++}-`))
  const cfg = path.join(dir, 'no-gitconfig')
  fs.writeFileSync(cfg, '', 'utf8')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_SYSTEM: cfg }
  const git = (args) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n', 'utf8')
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(dir, name)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body, 'utf8')
  }
  git(['init', '-q', '-b', 'main'])
  git(['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'add', '-A'])
  git(['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'fixture'])
  return dir
}

// git rm + commit 用的第二条 git 通道（夹具的 env 里钉死了 GIT_CONFIG_*，不能靠宿主机身份）
function gitIn(dir, gitArgs) {
  const cfg = path.join(dir, 'no-gitconfig')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_SYSTEM: cfg }
  return execFileSync('git', ['-C', dir, ...gitArgs], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
}

function runCli(dir, { ack = {}, extra = [] } = {}) {
  const ackFile = path.join(dir, '.ncm-ack.json')
  fs.writeFileSync(ackFile, JSON.stringify(ack, null, 2), 'utf8')
  const r = spawnSync(process.execPath, [SCRIPT, `--root=${dir}`, `--ack-file=${ackFile}`, ...extra], {
    encoding: 'utf8',
  })
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// 登记项的唯一合法形态：{ markers: 基线行数, reason: 非空 }
const ACK = (file, markers = 2, reason = '测试注入：需人工选边') => ({ [file]: { markers, reason } })

const HUNK = ['| 门禁 | 状态 |', '<<<<<<< Updated upstream', '| A | PASS |', '=======', '| A | 待跑 |', '>>>>>>> Stashed changes', '']

test('夹具自身可用：干净临时仓库判 0', () => {
  const { rc, out } = runCli(makeRepo({ 'a.md': '# a\n' }))
  assert.strictEqual(rc, 0, `干净夹具应判 0，实际 rc=${rc} out=${out}`)
  assert.match(out, /OK：冲突标记残留 0 个文件/)
})

test('行首 <<<<<<< / >>>>>>> 必须被抓出并点名文件与行号', () => {
  const { rc, out } = runCli(makeRepo({ 'openspec/records/x.md': HUNK.join('\n') }))
  assert.strictEqual(rc, 1, `应判违规，实际 rc=${rc} out=${out}`)
  assert.match(out, /openspec\/records\/x\.md:2 \[ours\]/)
  assert.match(out, /openspec\/records\/x\.md:6 \[theirs\]/)
  assert.match(out, /修法：删标记行并保留两侧内容/)
})

test('负控：七个等号是合法 Markdown setext 下划线，不得命中', () => {
  const { rc, out } = runCli(makeRepo({ '01-docs/legit.md': '标题\n======\n\n段落：\n=======\n\n```\n=======\n```\n' }))
  assert.strictEqual(rc, 0, `纯等号行不得判红，实际 out=${out}`)
})

test('负控：标记出现在行中间（文档在引用它本身）不得命中', () => {
  const { rc, out } = runCli(
    makeRepo({
      '01-docs/about.md':
        '本仓曾出现行首七个尖括号的形态：文中写作 `<<<<<<< Updated upstream` 被提交进主干。\n判据写法 /^(<{7}|>{7})/ 只认行首。\n',
    }),
  )
  assert.strictEqual(rc, 0, `非行首出现不得判红，实际 out=${out}`)
})

test('CRLF 工作副本同样命中（行尾不得成为漏检面）', () => {
  const { rc, out } = runCli(makeRepo({ 'win.md': 'a\r\n<<<<<<< HEAD\r\nb\r\n' }))
  assert.strictEqual(rc, 1, `CRLF 文件里的标记必须被抓到，实际 out=${out}`)
  assert.match(out, /win\.md:2 \[ours\]/)
})

// 这条专门盯"行尾"那一维：带标签的 `<<<<<<< HEAD` 靠空格就能收尾，去掉 \r 处理也不会漏；
// 只有**无标签的裸标记行**在 CRLF 下才依赖那唯一一处行尾归一。缺这条用例，
// 收尾形态的退化就无人报警（实测第一轮反证 M3 正是这样假通过的）。
test('无标签的裸标记行在 CRLF 下必须命中', () => {
  const { rc, out } = runCli(makeRepo({ 'bare.md': 'a\r\n<<<<<<<\r\nb\r\n>>>>>>>\r\n' }))
  assert.strictEqual(rc, 1, `裸标记行必须被抓到，实际 rc=${rc} out=${out}`)
  assert.match(out, /bare\.md:2 \[ours\]/)
  assert.match(out, /bare\.md:4 \[theirs\]/)
})

test('中文标记行必须按 UTF-8 打印（latin1 直出会成乱码，读日志的人会跳过它）', () => {
  const { rc, out } = runCli(makeRepo({ 'zh.md': '<<<<<<< HEAD 中文说明\n' }))
  assert.strictEqual(rc, 1)
  assert.ok(out.includes('中文说明'), `输出必须含可读中文，实际=${JSON.stringify(out.slice(0, 260))}`)
  assert.ok(!/[ÃÅ][a-z©°]/.test(out), `不得出现 latin1 直出的 mojibake，实际=${JSON.stringify(out.slice(0, 260))}`)
})

test('自身故障分档：非仓库目录 => rc 2，不得读成"没有残留"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ncm-notrepo-${process.pid}-`))
  const r = spawnSync(process.execPath, [SCRIPT, `--root=${dir}`], { encoding: 'utf8' })
  assert.strictEqual(r.status, 2, `非仓库目录必须走"自身故障"档，实际 rc=${r.status}`)
  assert.match((r.stdout || '') + (r.stderr || ''), /判据自身故障/)
})

test('自身故障分档：受管却读不到的文件 => rc 2，不得静默跳过', () => {
  const dir = makeRepo({ 'ghost.md': 'x\n' })
  fs.unlinkSync(path.join(dir, 'ghost.md'))
  const { rc, out } = runCli(dir)
  assert.strictEqual(rc, 2, `读不到受管文件必须出声，实际 rc=${rc} out=${out}`)
  assert.match(out, /读不到/)
})

test('自身故障分档：CLI 用法错误（--root 漏值）=> rc 2，不得落进"发现违规"档', () => {
  // 原实现把 root 解析放在 try 之外：`--root`（无 = 值）⇒ args 里存的是布尔 true ⇒
  // path.resolve(true) 抛未捕获 TypeError ⇒ Node 以 rc 1 收场。1 档的含义是"仓库里有标记"，
  // 于是"判据自己坏了"会被 CI 读成"检出违规"，而文案里一个文件名都没有。
  const r = spawnSync(process.execPath, [SCRIPT, '--root'], { encoding: 'utf8' })
  const outAll = (r.stderr || '') + (r.stdout || '')
  assert.strictEqual(r.status, 2, `漏值必须以"自身故障"档收场，实际 rc=${r.status} out=${outAll.slice(0, 300)}`)
  assert.match(outAll, /判据自身故障/)
  assert.doesNotMatch(outAll, /node:internal/, '不得把裸栈抛给读者')
})

test('自身故障分档：承认清单形态不合法 => rc 2，不得静默当成"没有基线约束"', () => {
  // 允许字符串形态就等于允许"没有基线的登记项"——那正是文件级承认的失明面，
  // 所以形态不对时判据必须自认坏了，而不是降级成只查"有没有登记过这个文件"。
  const { rc, out } = runCli(makeRepo({ 'b.md': '<<<<<<< HEAD\n' }), { ack: { 'b.md': '旧形态：只有理由没有基线' } })
  assert.strictEqual(rc, 2, `形态不合法应走 2 档，实际 rc=${rc} out=${out}`)
  assert.match(out, /承认清单形态不合法/)
})

test('退出码三档不得混档：违规(1) / 自身故障(2) 的文案各自唯一', () => {
  const bad = runCli(makeRepo({ 'b.md': '<<<<<<< HEAD\n' }))
  assert.strictEqual(bad.rc, 1)
  assert.match(bad.out, /FAIL：检出/)
  assert.doesNotMatch(bad.out, /判据自身故障/)
})

test('承认清单只能缩小：登记项所指文件已无标记 => 陈旧红', () => {
  const { rc, out } = runCli(makeRepo({ 'clean.md': '干净内容\n' }), { ack: ACK('clean.md', 2) })
  assert.strictEqual(rc, 1, `已无标记却仍登记 => 必须报陈旧，实际 rc=${rc} out=${out}`)
  assert.match(out, /stale: clean\.md/)
})

// stale 判据在源码里只有一行（登记项不在"有标记的文件集"里即为陈旧），但它在夹具上有两条
// 不同的到达路径：① 文件还在、标记被清掉；② 文件被 git rm、整个离开 ls-files。第 ② 条若哪天
// 被写成"文件读不到"，就会把「只能缩小的棘轮」和「判据自身故障 rc 2」两档混成一个出口，
// 所以单独钉一条并断言它**不得**走 rc 2 的文案。
test('承认清单只能缩小：登记项文件已被删除 => 报陈旧红(1)，不得混进自身故障档(2)', () => {
  const dir = makeRepo({ 'openspec/records/x.md': HUNK.join('\n'), 'keep.md': '# keep\n' })
  const ack = ACK('openspec/records/x.md', 2)
  assert.strictEqual(runCli(dir, { ack }).rc, 0, '已承认且不超基线的标记应判 0')
  gitIn(dir, ['rm', '-q', '-f', 'openspec/records/x.md'])
  gitIn(dir, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'drop ack target'])
  const { rc, out } = runCli(dir, { ack })
  assert.strictEqual(rc, 1, `删除登记项应报陈旧红(1)，实际 rc=${rc} out=${out}`)
  assert.match(out, /stale: openspec\/records\/x\.md/)
  assert.doesNotMatch(out, /判据自身故障/, '删除登记项不是判据自身故障，不得走 rc 2 文案')
})

test('双向棘轮：已登记文件的标记行数超过基线 => 红，且点名实际数与登记数', () => {
  // 这条锁的是本判据曾经的假绿面：文件级承认下，"同一篇又犯一次"既不触发未登记、
  // 也不触发陈旧，判据照绿。基线计数把它变成"只许 ≤"。
  const dir = makeRepo({ 'bad.md': '<<<<<<< A\n<<<<<<< B\n>>>>>>> C\n>>>>>>> D\n' })
  const { rc, out } = runCli(dir, { ack: ACK('bad.md', 2) })
  assert.strictEqual(rc, 1, `实际 4 > 基线 2 必须红，实际 rc=${rc} out=${out}`)
  assert.match(out, /grew: bad\.md 实际=4 登记基线=2/)
  assert.match(out, /不得通过抬高基线交差/)
  assert.doesNotMatch(out, /FAIL：检出/, '已登记文件不得再被报成"未登记"（两档文案必须可区分）')
})

test('负控：已登记文件的标记数低于基线 => 只作可见项，不得拦截', () => {
  // 反向也要钉住：若把判据写成"实际数必须等于基线"，属主会话解掉一半标记（正确的收敛方向）
  // 会被判红，于是这条门禁变成"要么不动、要么全清"，逼人一次改完或干脆不改。
  const dir = makeRepo({ 'half.md': '<<<<<<< A\n<<<<<<< B\n正文\n' })
  const { rc, out } = runCli(dir, { ack: ACK('half.md', 3) })
  assert.strictEqual(rc, 0, `低于基线属收敛方向，不得拦，实际 rc=${rc} out=${out}`)
  assert.match(out, /可见项，不拦截/)
  assert.match(out, /half\.md 3→2/)
})

test('非普通文件的受管项不计违规，但必须被计数并出声（"没扫到"不得伪装成"没有残留"）', () => {
  // 夹具做法：往索引里塞一条 120000（符号链接）模式的条目，而**磁盘上放一个真目录**占住那个名字。
  // 这样 `git ls-files` 会列出它，`readFileSync` 抛 EISDIR，`lstatSync` 成功且 `isFile()` 为 false
  // ⇒ 正好落在「本就不是普通文件」那一支。不用真符号链接是因为本机创建软链需要特权/开发者模式，
  // 而宿主差异会把这条锁变成"本机绿 CI 红"那一类。
  const dir = makeRepo({ 'real.md': '# real\n' })
  fs.writeFileSync(path.join(dir, 'blob-src.txt'), 'target\n', 'utf8')
  gitIn(dir, ['add', '-A'])
  const sha = gitIn(dir, ['hash-object', '-w', 'blob-src.txt']).trim()
  assert.ok(/^[0-9a-f]{40}$/.test(sha), `hash-object 必须回一个 40 位 sha，实际=${JSON.stringify(sha)}`)
  fs.mkdirSync(path.join(dir, 'weird-entry'))
  gitIn(dir, ['update-index', '--add', '--cacheinfo', `120000,${sha},weird-entry`])
  gitIn(dir, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'non-regular index entry'])

  const dry = runCli(dir, { extra: ['--dry-run'] })
  assert.strictEqual(dry.rc, 0, `非普通文件不得判违规，实际 rc=${dry.rc} out=${dry.out}`)
  assert.match(dry.out, /skipped=1/, `dry-run 必须把它计数出声，实际=${dry.out}`)
  const ok = runCli(dir)
  assert.match(ok.out, /非普通文件跳过=1/, `合规文案也必须出声，实际=${ok.out}`)
})

test('dry-run 必须打印扫描域、承认数、恶化数与跳过数（覆盖面的数字要能一句话重取）', () => {
  const { rc, out } = runCli(makeRepo({ 'a.md': '# a\n' }), { extra: ['--dry-run'] })
  assert.strictEqual(rc, 0, out)
  assert.match(
    out,
    /domain=\d+ files_with_markers=0 marker_lines=0 violations=0 acknowledged=0 stale=0 grew=0 skipped=\d+/,
  )
})

test('真实仓库自证：残留必须与内置承认清单逐条对上（基线既不得超也不得欠）', () => {
  const { collect, KNOWN_CONFLICT_MARKERS } = require(SCRIPT)
  const r = collect(REPO)
  assert.ok(r.total > 5000, `扫描域异常小（${r.total}），说明列文件这一步退化了`)
  assert.strictEqual(r.unreadable, 0, `有 ${r.unreadable} 个受管文件读不到，不能据此判"无残留"`)
  assert.deepStrictEqual(
    [...r.offending].sort(),
    Object.keys(KNOWN_CONFLICT_MARKERS).sort(),
    `残留与承认清单不一致：未登记=${JSON.stringify(r.violations)} 陈旧=${JSON.stringify(r.stale)}`,
  )
  assert.deepStrictEqual(r.violations, [], '不得有未登记的残留')
  assert.deepStrictEqual(r.stale, [], '承认清单不得含陈旧项')
  assert.deepStrictEqual(r.grew, [], '已登记文件的标记数不得高于基线')
  // 基线不得被"抬高到富余"来交差：CLI 只拦增长，所以这里额外要求内置清单与实际数**逐条相等**。
  // 不对称是有意的：真实仓库里有人正在收敛某篇（标记数暂时低于登记数）就该删登记而不是留富余。
  assert.deepStrictEqual(r.shrunken, [], `内置基线必须与实况逐条相等，若已减少请同步改写或删除登记：${JSON.stringify(r.shrunken)}`)
  // 下界从清单派生，不得硬编 8：属主会话合法解掉一篇并删登记后，硬编下界会把正确动作判红
  // 并把人往"扫描域退化了"的错方向指。
  assert.ok(
    r.hits.length >= Object.keys(KNOWN_CONFLICT_MARKERS).length,
    `标记行数下界 ${r.hits.length} < 登记项数 ${Object.keys(KNOWN_CONFLICT_MARKERS).length}（每条登记至少 1 行标记）`,
  )
  // 扩张方向的棘轮：新增一条登记目前只受"改判据源码可见 diff"约束，这里补一个必须显式改动的数。
  assert.ok(
    Object.keys(KNOWN_CONFLICT_MARKERS).length <= 4,
    `承认清单条目数上界 4 被突破（现 ${Object.keys(KNOWN_CONFLICT_MARKERS).length}）—— 新增登记必须连同这条断言一起改，并说明为什么不能机械修`,
  )
})

test('接线锁：判据与测试必须落在 changes job 的非 PR 早退**之前**，且调用行不得带 --ack-file', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'quality-gate.yml'), 'utf8').replace(/\r/g, '')
  assert.ok(
    /node --test scripts\/check-no-conflict-markers\.test\.js/.test(wf),
    '回归测试本身必须接线（否则等于没写：本仓无自动收集）',
  )
  const callLines = wf.split('\n').filter((l) => /check-no-conflict-markers\.js/.test(l) && !/--test/.test(l))
  assert.strictEqual(callLines.length, 1, `判据调用行应恰好 1 条，实际 ${JSON.stringify(callLines.map((x) => x.trim()))}`)
  assert.ok(
    !/--ack-file/.test(callLines[0]),
    `CI 调用行不得注入 --ack-file（那是测试口子，接进 CI 就等于允许关掉棘轮）：${callLines[0].trim()}`,
  )
  const iTest = wf.indexOf('node --test scripts/check-no-conflict-markers.test.js')
  const iRun = wf.indexOf('node scripts/check-no-conflict-markers.js')
  const j = wf.indexOf('\n  static-gates:')
  assert.ok(iTest > 0 && iRun > 0, '两行都必须存在')
  assert.ok(j === -1 || iRun < j, '判据必须落在 changes job（不被 docs-only 短路的位置）')
  // 位置本身就是判据：非 PR 早退之后的调用，PR 档照样跑、全部测试照样绿，而 main push 档
  // 静默失去覆盖 —— 只看"在 static-gates 之前"验不出这一维。
  const iExit = wf.indexOf('if [ "${{ github.event_name }}" != "pull_request" ]; then')
  assert.ok(iExit > 0, '夹具前提：quality-gate.yml 必须仍存在那段非 PR 早退（它消失时应显式报警而不是让这条锁静默通过）')
  assert.ok(iTest < iExit && iRun < iExit, '判据与它的回归测试必须落在非 PR 早退之前（main push 档的覆盖就靠这个位置）')
  // 两行必须**相邻**且顺序固定（先跑锁再跑判据）：拆到不同步骤后，"摘掉判据行"这种退化
  // 可能只少掉一行而另一行仍在，读 CI 日志的人会看到测试名以为它被判定过。
  const order = wf.split('\n').findIndex((l) => l.trim() === 'node --test scripts/check-no-conflict-markers.test.js')
  const order2 = wf.split('\n').findIndex((l) => l.trim() === 'node scripts/check-no-conflict-markers.js')
  assert.ok(order >= 0 && order2 === order + 1, `两行必须相邻且锁在前、判据在后，实际行号 test=${order} run=${order2}`)
})
