// 回归锁：scripts/check-branch-merged.js —— 「分支内容是否已完整进主干」的机械判据
// 动因（2026-10-16 实测）：这条判据此前只以 AGENTS.md 的散文存在，每轮清理由会话临时手写探针执行；
// 本轮真实发生过一次「按旧文字判出差量 52/10/5 行，仍把分支删了」——因为没有任何东西拦那一步。
// 本文件用 node --test 跑，必须被 quality-gate.yml 的 changes job 显式点名（否则等于没写），
// 且只能 require node 内置模块（该 job 没有 Install deps，引第三方包当场 MODULE_NOT_FOUND）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SELF = path.join(__dirname, 'check-branch-merged.js');
const mod = require('./check-branch-merged.js');

// ---------------------------------------------------------------- 判据本体导出面
test('导出面必须齐（缺一个就是判据搬家）', () => {
  for (const fn of ['splitLines', 'reconcileCounts', 'netCounts', 'collect', 'main']) {
    assert.equal(typeof mod[fn], 'function', fn + ' 必须是函数');
  }
  assert.deepEqual(mod.VERDICTS, ['IDENTICAL', 'DRIFT-ATTRIBUTED', 'LOST', 'UNATTRIBUTED', 'JUDGE_ERROR']);
  assert.equal(mod.EXIT_OK, 0);
  assert.equal(mod.EXIT_LOST, 1);
  assert.equal(mod.EXIT_JUDGE_ERROR, 2);
});

// v3 判据本体的两条方向 + 他人净数的两条性质。
// 动因（2026-10-17 实测）：v2 的删除侧写的是"出现过即违规"，于是"删掉一份重复行且完整落地"被判 LOST；
// 新增侧写的是"主干份数 ≥ 我新增条数"，于是"base 已有 2 份、我加第 3 份、产物只落 2 份"说不清丢了什么。
// 本仓入库文档绝大多数是中文、热写面重复行极多（CHANGELOG.md 3348 个重复键、learnings.md 4104 个），
// 所以这一格不是理论练习，是那张"只能按行级判"的表自己会踩的坑。
test('份数与容量：主干份数少于我的份数才叫缺口，能被他人容量解释掉的不算；多的方向按"我是否净删除"分流', () => {
  const m = (arr) => mod.multisetOf(arr.map((s) => s + '\n'));
  const CAP = (o) => ({ add: new Map(o.add || []), rem: new Map(o.rem || []) });
  const rc = (tip, main, base, caps, landed) =>
    mod.reconcileCounts(m(tip), m(main), m(base), CAP(caps), () => (landed === undefined ? 0 : landed));
  assert.deepEqual(rc(['dup', 'tail'], ['dup', 'tail'], ['dup', 'dup', 'tail'], {}),
    { short: [], over: [] }, '我只删掉一份 dup 且逐字落了地 ⇒ 不得再算违规（v2 在这里报"删除行复现"）');
  assert.deepEqual(rc(['dup', 'dup', 'dup'], ['dup', 'dup'], ['dup', 'dup'], {}),
    { short: [{ key: 'dup', by: 1, capacity: 0, introducedByMe: true }], over: [] }, '我加了第三份而产物只落两份 ⇒ 必须点名缺了一份');
  assert.deepEqual(rc(['dup'], ['dup', 'dup'], ['dup', 'dup'], {}),
    { short: [], over: [{ key: 'dup', by: 1, capacity: 0, deletion: true }] },
    '我的删除被合并丢掉 ⇒ 多一份且方向标成 deletion（这是 LOST，不是"谁也没解释的多余内容"）');
  assert.deepEqual(rc(['x'], ['x', 'Y'], ['x'], {}),
    { short: [], over: [{ key: 'Y', by: 1, capacity: 0, deletion: false }] },
    '我从没写过的键多出来 ⇒ 只算"未归因"，不得谎报我的东西丢了');
  assert.deepEqual(rc(['MY'], [], [''], { rem: [['MY', 1]] }, 1),
    { short: [], over: [] }, '我的行确实随合并进过主干、又被他人净删掉 ⇒ 容量成立，判漂移不判丢失');
  assert.deepEqual(rc(['MY'], [], [''], { rem: [['MY', 1]] }, 0),
    { short: [{ key: 'MY', by: 1, capacity: 0, introducedByMe: true }], over: [] },
    '同一份容量，但该行从未随我的合并落地过 ⇒ 不得被救走（QM-6 那条洗白路径的另一半）');
  // 血统前提只作用于"我带来的份数"。继承自 fork 点的存量被主干删掉，不是我的工作，
  // 不得拿"我的合并产物里没有"拦清理（真实动因：bf520a13c 的 CHANGELOG 两行含 BEL 控制字节，
  // 主干后来修成正常文本；这两行是 fork 就有的存量 ⇒ 无条件套血统前提会压成假 LOST）。
  assert.deepEqual(rc(['S', 'S'], [], ['S', 'S'], { rem: [['S', 2]] }, 0),
    { short: [], over: [] },
    '份数与 base 相同（我没动过它）⇒ 他人的删除容量单独就能解释，不看 landed');
  assert.deepEqual(rc(['S', 'S'], [], ['S', 'S'], {}, 0),
    { short: [{ key: 'S', by: 2, capacity: 0, introducedByMe: false }], over: [] },
    '同一条负控：没人删过它而主干却少了 ⇒ 仍然必须报（上一条不许退化成"存量一律放行"）');
  assert.deepEqual(rc(['x'], ['x', 'K'], ['x'], { add: [['K', 2]] }),
    { short: [], over: [] }, '他人净增容量足以覆盖 ⇒ 差异可解释，不报 over');
});

test('他人净数按"同一笔内 + 与 − 相抵"算：加过又撤（净 0）不得替任何东西作保；空白行不参与', () => {
  const E = (sha, patch) => ({ sha: sha, subject: sha + ' x', net: mod.parsePatchNet(patch).net });
  const H = '@@ -1 +1,2 @@\n';                       // 没有 hunk 头，整段补丁都不算内容行 —— 上面那格必须带它
  assert.deepEqual(Array.from(mod.netCounts([E('a', H + '+k\n-k\n')])), [],
    '同一笔内加又撤 ⇒ 净 0 不进表（这是 T18/QM-6 那条洗白路径的根）');
  assert.deepEqual(Array.from(mod.netCounts([E('a', H + '+k\n'), E('b', H + '-k\n')])), [],
    '跨笔一加一撤同样净 0');
  assert.deepEqual(Array.from(mod.netCounts([E('a', H + '+k\n+k\n k\n')])),
    [['k', 2]], '上下文行不计，只数 hunk 内的 +/−');
  assert.deepEqual(Array.from(mod.netCounts([E('a', '@@ -1 +1 @@\n+\n')])), [],
    '空白行必须完全排除，否则每个文件都必红');
  assert.deepEqual(Array.from(mod.parsePatchNet('+k\n-k\n').net), [],
    '没有 @@ 的片段一律不认（正控：证明上面几格真的在走段落结构，而不是恒空解析）');
});

// v3 第一版就是靠"链上求和 == main−base"这条恒等式自检，抓到下面两个自己写的解析洞。
// 这两格必须单独钉：它们不是理论形态，本仓热写面（CHANGELOG / learnings 的分隔线）天天在过。
test('补丁解析必须按段落结构认内容行：删除一个 `---` 行不得被当成文件头吃掉', () => {
  const patch = [
    'diff --git a/f b/f',
    'index 111..222 100644',
    '--- a/f',
    '+++ b/f',
    '@@ -1,3 +1,2 @@',
    ' keep',
    '----',                      // 删掉一行 `---`：'-' 前缀 + 内容 '---'
    '+plus',
  ].join('\n');
  const { net, binary } = mod.parsePatchNet(patch);
  assert.equal(net.get('---'), -1, '删除的 `---` 必须计成 −1（v2 用 startsWith("---") 把它当头部整行吞掉）');
  assert.equal(net.get('plus'), 1, '新增行照常计 +1');
  assert.equal(net.has('a/f'), false, '段落头 --- a/f 不是内容行');
  assert.equal(net.has('b/f'), false, '段落头 +++ b/f 不是内容行');
  assert.equal(binary, false, '这段不是二进制');
  assert.equal(mod.parsePatchNet(['@@ -1 +1 @@', '--- foo', '+bar'].join('\n')).net.get('-- foo'), -1,
    'hunk 内以 --- 开头的内容行（删掉了 "-- foo"）同样必须计入');
  assert.equal(mod.parsePatchNet('diff --git a/x b/x\nBinary files a/x and b/x differ\n').binary, true,
    '二进制必须被认出来 —— 否则每个含 PNG 的分支都会被恒等式自检判成工具故障');
});

// 恒等式自检在真实仓上**总是闭合**（这正是它的目的：一旦不闭合就是我遇到了未知的 git 形态）。
// 因此它没有现场夹具可以反证 ⇒ 必须把本体抽成函数、用直接的正/负控锁钉住，
// 否则它就是一段"只会在出事时响，而谁也证明不了它会响"的装饰性代码。
test('恒等式自检：闭合时不出声，不闭合时必须抛"判据自身故障"（双向锁，缺负控等于没锁）', () => {
  const m = (arr) => mod.multisetOf(arr.map((s) => s + '\n'));
  assert.doesNotThrow(() => mod.assertChainCloses('f.md', m(['a', 'b']), m(['a', 'b', 'c']),
    new Map([['c', 1]])), '闭合的场景不得出声');
  assert.throws(() => mod.assertChainCloses('f.md', m(['a', 'b']), m(['a', 'b', 'c']), new Map()),
    (e) => e instanceof mod.JudgeError && /不闭合/.test(e.message),
    'main 比 base 多一行而链上求和为 0 ⇒ 必须判"我漏读了某种 git 形态"，不许静默当成没差异');
  assert.throws(() => mod.assertChainCloses('f.md', m(['a', 'b']), m(['a']), new Map([['b', 1]])),
    (e) => e instanceof mod.JudgeError, '方向反了（求和为正而实际少）同样必须响');
});

// 上一条只能证明函数自己有牙；这条证明它**被调用**。两段合起来才堵住两种失效：
//   摘掉调用点 ⇒ 这条红；摘掉函数里的断言 ⇒ 上一条红。
test('结构锁：classifyFile 必须真的调用恒等式自检（只测函数本体挡不住"调用点被删"）', () => {
  const src = fs.readFileSync(SELF, 'utf8');
  const start = src.indexOf('function classifyFile');
  assert.ok(start >= 0, '找不到 classifyFile —— 判据搬家了，本锁必须跟着改');
  const endRel = src.slice(start).search(/\r?\n\}\r?\n/);
  assert.ok(endRel > 0, '找不到 classifyFile 的顶层闭合括号（锚点失效）');
  const body = src.slice(start, start + endRel);
  assert.ok(/assertChainCloses\s*\(/.test(body),
    'classifyFile 体内必须调用 assertChainCloses —— 否则真实仓里那道自检一次都不会跑');
});

// first-parent + --diff-merges=first-parent 的落点：区间里出现真合并提交时，
// 链上求和仍然精确等于 main − base（恒等式成立 ⇒ 不报 rc=2）。摘掉这两个旗标由变异 M10 证伪。
test('链上有真合并提交时求和仍闭合（不得把"我看不清 git 的哪种形态"演成内容丢失）', () => {
  const r = baseRepo({ 'shared.txt': 'base line\n---\n' });
  r.w('shared.txt', 'MINE\nbase line\n---\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['shared.txt'], 'feat: mine (#9001)');
  const merge1 = r.merge;
  // 之后在主干做一次**真合并**（带一个旁支），让链上出现 merge commit
  r.g(['checkout', '-q', '-b', 'side', 'main']);
  r.w('shared.txt', 'MINE\nbase line\n---\nSIDE\n');
  r.addCommit('side work');
  r.g(['checkout', '-q', 'main']);
  r.w('other.txt', 'trunk only\n');
  r.addCommit('trunk work');
  r.g(['merge', '-q', '--no-ff', '-m', 'merge side into main', 'side']);
  const out = judge(r, r.tip, merge1);
  assert.equal(out.judgeError, false, '恒等式闭合失败就是归因面漏了 git 形态，必须修判据而不是放行：' + JSON.stringify(out.reasons));
  const f = out.files.find((x) => x.file === 'shared.txt');
  assert.ok(f, 'shared.txt 必须在判定域里');
  assert.ok(['IDENTICAL', 'DRIFT-ATTRIBUTED'].includes(f.verdict),
    '旁支合并不该把我的内容算成丢失：' + JSON.stringify(f));
  r.rm();
});

// 上一条里"链上求和"两种口径都能闭合，所以它测不到真实仓那 27 个合并提交造成的膨胀。
// 这一条才是机制本体：**解冲时凭空加一行**（两个父提交里都没有这行），
// 只有让合并提交对第一父出补丁才看得见它；摘掉那两个旗标 ⇒ 求和不闭合 ⇒ 判据必须自己报"我读不全"，
// 而不是把这行算成"我的内容丢了"。动因：真实仓 CHANGELOG.md 的 `---` 曾被少算成 short=1885。
test('T27 evil merge（解冲时凭空加行）必须由合并提交自己作证，不得被读成内容丢失', () => {
  const r = baseRepo({ 'shared.txt': 'base\n' });
  r.w('shared.txt', 'MINE\nbase\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['shared.txt'], 'feat: mine (#9001)');
  const merge1 = r.merge;
  r.g(['checkout', '-q', '-b', 'side', 'main']);
  r.w('shared.txt', 'MINE\nbase\nSIDE\n');            // 旁支：在尾部追加
  r.addCommit('side work');
  r.g(['checkout', '-q', 'main']);
  r.w('shared.txt', 'TRUNK\nMINE\nbase\n');           // 主干：在头部追加（与旁支不重叠 ⇒ 自动合并干净）
  r.addCommit('trunk work');
  r.g(['merge', '--no-ff', '--no-commit', '-m', 'merge side', 'side']);
  r.w('shared.txt', 'TRUNK\nMINE\nbase\nSIDE\nMERGE-ONLY\n');   // 只有合并提交自己知道的行
  r.addCommit('merge side (with manual resolution)');
  const out = judge(r, r.tip, merge1);
  assert.equal(out.judgeError, false,
    '合并提交的第一父差量必须计入归因面；否则这行会被算成"我的内容没落地"：' + JSON.stringify(out.reasons));
  const f = out.files.find((x) => x.file === 'shared.txt');
  assert.ok(f, 'shared.txt 必须在判定域里');
  assert.equal(f.verdict, 'DRIFT-ATTRIBUTED', '差异全部可归因 ⇒ 允许删分支：' + JSON.stringify(f));
  assert.deepEqual(f.missingAdded, [], '不得把 MERGE-ONLY 之外的任何东西报成丢失：' + JSON.stringify(f.missingAdded));
  assert.equal(mod.main(['--ref=' + r.tip, '--merge=' + merge1, '--root=' + r.dir]), 0);
  r.rm();
});

test('行切分必须保住各自的行尾（CRLF/LF 混存文件不得被统一）', () => {
  assert.deepEqual(mod.splitLines('a\r\nb\n'), ['a\r\n', 'b\n']);
  assert.deepEqual(mod.splitLines(''), []);
  assert.deepEqual(mod.splitLines('\n'), ['\n']);
});

// ---------------------------------------------------------------- git 夹具（真仓，禁 mock git）
function Repo() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bmp-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const w = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const addCommit = (msg) => { g(['add', '-A']); g(['commit', '-q', '-m', msg]); return g(['rev-parse', 'HEAD']); };
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@example.com']);
  g(['config', 'user.name', 'tester']);
  g(['config', 'commit.gpgsign', 'false']);
  return {
    dir, g, w, addCommit,
    rm: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// 一次"干净落地"的骨架：base → feature 改动 → 落回 main（squash 式，不产生 merge 提交）
function baseRepo(baseFiles) {
  const r = Repo();
  for (const [k, v] of Object.entries(baseFiles)) r.w(k, v);
  r.base = r.addCommit('base');
  r.g(['checkout', '-q', '-b', 'feature']);
  return r;
}

// 把某个 ref 的若干文件落到 main 上并 commit，模拟 squash 合并产物
function land(r, fromRef, files, msg, override) {
  r.g(['checkout', '-q', 'main']);
  for (const f of files) r.g(['checkout', '-q', fromRef, '--', f]);
  if (override) for (const [f, t] of Object.entries(override)) r.w(f, t);
  r.merge = r.addCommit(msg);
  return r.merge;
}

const asList = (x, fallback) => (x === undefined ? [fallback] : (Array.isArray(x) ? x : [x]));
// v2 起判定域 = --against（夹具里就是 main），差量起点由 merge-base(ref, against) 自己算，
// 不再由调用方传 base —— 上一版把 base 当参数传进来其实被忽略（v1 每个 merge 各算各的），
// 于是"我以为我在控制差量起点"是假的；现在它真的生效了，夹具就必须按真实语义省略它。
const judge = (r, ref, merges) =>
  mod.collect({ ref: ref || r.tip, merges: asList(merges, r.merge), root: r.dir });
const cli = (r, ref, merges) =>
  mod.main(['--ref=' + (ref || r.tip), '--merge=' + asList(merges, r.merge).join(','),
    '--root=' + r.dir]);

// ---------------------------------------------------------------- 场景
test('T1 普通文件逐字节相同 ⇒ IDENTICAL / rc=0', () => {
  const r = baseRepo({ 'normal.txt': 'alpha\nbeta\ngamma\n' });
  r.w('normal.txt', 'alpha\nBETA\ngamma\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['normal.txt'], 'feat: mine (#9001)');
  const out = judge(r);
  assert.equal(out.judgeError, false, '判据本体必须能跑：' + JSON.stringify(out.reasons));
  assert.deepEqual(out.files.map((f) => [f.file, f.verdict]), [['normal.txt', 'IDENTICAL']]);
  assert.equal(cli(r), 0);
  r.rm();
});

test('T2 热写面被他人后追加 ⇒ blob 不等、双向行级成立且有归因提交 ⇒ DRIFT-ATTRIBUTED / rc=0', () => {
  const r = baseRepo({ 'shared.txt': 'line1\nline2\nline3\n' });
  r.w('shared.txt', 'MY NEW LINE\nline1\nline2\n');     // 顶部插一行 + 删掉 line3
  r.tip = r.addCommit('mine');
  // 第二个会话先落一笔，也改了这个文件（这就是"归因提交"）
  r.g(['checkout', '-q', 'main']);
  r.w('shared.txt', 'line1\nline2\nline3\nOTHERS LINE\n');
  const other = r.addCommit('second session (#9000)');
  // 我的合并产物 = 两边都在（union 式解冲），于是 blob 与 tip 不等
  land(r, r.tip, [], 'feat: mine (#9001)', { 'shared.txt': 'MY NEW LINE\nline1\nline2\nOTHERS LINE\n' });
  const out = judge(r);
  const f = out.files.find((x) => x.file === 'shared.txt');
  assert.ok(f, 'shared.txt 必须在改动集里');
  assert.equal(f.verdict, 'DRIFT-ATTRIBUTED', 'blob 必不等（他人追加），只能靠"双向行级 + 归因"放行');
  assert.ok(f.attributions.some((a) => a.sha === other), '必须点出那笔他人提交：' + JSON.stringify(f.attributions));
  assert.ok(f.attributions.every((a) => a.sha !== r.merge), '归因不得把本次合并自身算成他人');
  assert.equal(cli(r), 0);
  r.rm();
});

test('T3 真丢失（我的新增行不在主干）⇒ LOST / rc=1', () => {
  const r = baseRepo({ 'normal.txt': 'alpha\nbeta\n' });
  r.w('normal.txt', 'alpha\nbeta\nMY NEW LINE\n');
  r.tip = r.addCommit('mine');
  // 合并产物把我的行弄丢了（落了 base 版；dummy.txt 只为让这笔提交非空）
  land(r, r.base, [], 'feat: 我的改动 (#9001)（实现漏落）', { 'normal.txt': 'alpha\nbeta\n', 'dummy.txt': 'x\n' });
  const out = judge(r);
  assert.equal(out.files[0].verdict, 'LOST');
  assert.deepEqual(out.files[0].missingAdded, ['MY NEW LINE\n']);
  assert.equal(cli(r), 1, '真丢失不得放行');
  r.rm();
});

test('T4 我删掉的行被合并带回 ⇒ LOST / rc=1（只查新增行的实现在这里必须误报落地）', () => {
  const r = baseRepo({ 'shared.txt': 'line1\nline2\nline3\n' });
  r.w('shared.txt', 'MY NEW LINE\nline1\nline2\n');     // 删了 line3
  r.tip = r.addCommit('mine');
  // 合并产物含我的新增行（新增行判据全过），但 line3 又回来了
  land(r, r.tip, [], 'feat: mine (#9001)', { 'shared.txt': 'MY NEW LINE\nline1\nline2\nline3\n' });
  const out = judge(r);
  assert.equal(out.files[0].verdict, 'LOST');
  assert.deepEqual(out.files[0].reappearedRemoved, ['line3\n'], '缺失这一半是双向判据的唯一价值所在');
  assert.equal(cli(r), 1);
  r.rm();
});

test('T5 blob 不等但该文件上除本次合并外没有任何他人提交 ⇒ UNATTRIBUTED / rc=1', () => {
  const r = baseRepo({ 'shared.txt': 'line1\nline2\n' });
  r.w('shared.txt', 'MY NEW LINE\nline1\nline2\n');
  r.tip = r.addCommit('mine');
  // 合并产物多出一行谁都没解释的 OTHER
  land(r, r.tip, [], 'feat: mine (#9001)', { 'shared.txt': 'MY NEW LINE\nline1\nline2\nOTHER\n' });
  const out = judge(r);
  assert.equal(out.files[0].verdict !== 'IDENTICAL', true, '夹具必须让 blob 不等，否则本例什么都没测');
  assert.equal(out.files[0].verdict, 'UNATTRIBUTED',
    '说不清差异来自谁就不能放行——本轮 52 行假阳性正是"差异无法归因"被读成"我的东西丢了"');
  assert.equal(cli(r), 1);
  r.rm();
});

test('T6 一个分支被两个 PR 用过 ⇒ 判定域是主干现状，漏传第二个 merge 不再误判丢失', () => {
  const r = baseRepo({ 'normal.txt': 'alpha\nbeta\n' });
  r.w('normal.txt', 'alpha\nBETA\n');
  r.tip1 = r.addCommit('first PR');
  land(r, r.tip1, ['normal.txt'], 'feat: first (#9001)');
  const merge1 = r.merge;
  // 同一分支继续开回填 PR
  r.g(['checkout', '-q', 'feature']);
  r.w('second.txt', 'backfill content\n');
  r.tip2 = r.addCommit('backfill PR');
  land(r, r.tip2, ['second.txt'], 'docs: 回填 (#9002)');

  const both = mod.collect({ ref: r.tip2, merges: [merge1, r.merge], root: r.dir });
  assert.equal(both.judgeError, false);
  assert.equal(both.files.length, 2, '两个 PR 的文件必须并集进判定');
  assert.ok(both.files.every((f) => f.verdict === 'IDENTICAL' || f.verdict === 'DRIFT-ATTRIBUTED'),
    '两侧都落地才该是 0：' + JSON.stringify(both.files.map((f) => [f.file, f.verdict])));
  assert.equal(mod.main(['--ref=' + r.tip2, '--merge=' + merge1 + ',' + r.merge, '--root=' + r.dir]), 0);

  // v1 在这里断言"只传第一个 merge ⇒ 必须红"。那条断言测的其实是判据自己的参考系太窄
  // （把回填 PR 的产物与 merge1 快照比），不是"内容没进主干"。v2 起判定域是主干，
  // 漏传 merge 只影响归因排除，不影响是否放行 —— 这里把它钉成显式契约，防止下一次又把
  // 判据参数当成证据来源。
  const oneOnly = mod.collect({ ref: r.tip2, merges: [merge1], root: r.dir });
  assert.equal(oneOnly.judgeError, false);
  assert.equal(oneOnly.files.filter((f) => f.verdict === 'LOST').length, 0,
    '内容都在主干上时，--merge 少传一个不得造假红');
  r.rm();
});

test('T7 判据自身故障一律走独立退出码 2，不得与"发现问题"的 1 混档', () => {
  const r = baseRepo({ 'normal.txt': 'alpha\nbeta\n' });
  r.w('normal.txt', 'alpha\nBETA\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['normal.txt'], 'feat: mine (#9001)');
  assert.equal(mod.main(['--ref=' + r.tip, '--merge=' + r.merge, '--root=' + r.dir, '--base=no-such-ref']), 2,
    '取不到 base 属判据故障，不是"分支没合"');
  assert.equal(mod.main(['--ref=does-not-exist', '--merge=' + r.merge, '--root=' + r.dir]), 2);
  assert.equal(mod.main(['--ref=' + r.tip, '--merge=deadbeefdeadbeef', '--root=' + r.dir]), 2,
    'merge SHA 取不到树 ⇒ 判据失明，必须与 LOST 分档');
  assert.equal(mod.main(['--ref=' + r.tip, '--merge=' + r.merge, '--root=' + r.dir, '--nopex']), 2,
    '未知旗标不得静默忽略');
  assert.equal(mod.main(['--merge=' + r.merge, '--root=' + r.dir]), 2, '缺 --ref 不得当成全绿');
  r.rm();
});

test('T8 反失明正控：改动集为空（ref 与 base 同指一处）必须报判据故障，不得读成"零问题 ⇒ 通过"', () => {
  const r = baseRepo({ 'normal.txt': 'alpha\n' });
  r.w('normal.txt', 'alpha\nbeta\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['normal.txt'], 'feat: mine (#9001)');
  const same = mod.main(['--ref=' + r.merge, '--merge=' + r.merge, '--root=' + r.dir, '--base=' + r.merge]);
  assert.equal(same, 2, '空改动集必须出声——"零个文件 ⇒ 零个问题"读起来完全像通过');
  assert.equal(mod.collect({ ref: r.merge, merges: [r.merge], root: r.dir, base: r.merge }).judgeError, true);
  r.rm();
});

test('T9 接线锁：判据本体必须被 git 跟踪（.gitignore 第 106 行 scripts/*.js 会静默吞掉它）', () => {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname, encoding: 'utf8' }).trim();
  const rel = path.relative(repoRoot, SELF).split(path.sep).join('/');
  const hit = execFileSync('git', ['check-ignore', '--no-index', '-v', rel],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (hit !== '') {
    assert.match(hit, /!\s*scripts\/(\*\.js|check-branch-merged\.js)/,
      '本体被 scripts/*.js 命中却没有 negation ⇒ CI 上 Cannot find module');
  }
  assert.equal(execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: repoRoot, encoding: 'utf8' }).trim(), rel);
});

// ---------------------------------------------------------------- v2：判定域必须是「主干现在」
// 动因（2026-10-17 在真实仓库实测，本判据上线当天就被自己的清理任务否证）：
// toutiao-ms-token（tip b0df701cf，7 个已合并 PR）报 lost=65 files=66，而它点名的 3628 行里
// **3369 行就在当前 origin/main 上**。根因不是主干丢了东西，是判定域钉死在「那几笔 merge 的快照」：
// 分支 re-sync 过 main 之后 merge-base(ref, merge) 退化成 merge 本身，差量于是含**别人后来合进主干的行**，
// 而那几份快照按定义还没有它们 ⇒ 逐份 LOST ⇒ 跨 merge 取 best 仍 LOST。
test('T10 分支 re-sync 吸收了 main 后来的提交 ⇒ 相对主干已无差量，不得再拿 merge 快照判丢失', () => {
  const r = baseRepo({ 'shared.txt': 'L1\n' });
  r.w('shared.txt', 'A1\nL1\n');
  const tip1 = r.addCommit('my PR');
  land(r, tip1, ['shared.txt'], 'feat: mine (#9001)');
  const merge1 = r.merge;
  // 别人往主干的同一文件又合了一笔
  r.g(['checkout', '-q', 'main']);
  r.w('shared.txt', 'A1\nL1\nOTHER\n');
  r.addCommit('someone else (#9002)');
  // 我的分支 re-sync 吸收它 —— 本仓混合 PR 解置顶冲突的标准动作，是最常见形态而不是罕见形态
  r.g(['checkout', '-q', 'feature']);
  r.g(['merge', '-q', '--no-edit', 'main']);
  const tip = r.g(['rev-parse', 'HEAD']);
  const out = mod.collect({ ref: tip, merges: [merge1], root: r.dir });
  assert.equal(out.judgeError, false,
    '内容与主干一致 ⇒ "无差量"是合法通过态，不得当成判据失明：' + JSON.stringify(out.reasons));
  assert.deepEqual(out.files, [], 'OTHER 不是这个分支引入的，不该进判定域');
  assert.equal(mod.main(['--ref=' + tip, '--merge=' + merge1, '--root=' + r.dir]), 0);
  r.rm();
});

test('T10b 同一 re-sync 夹具上，分支自己新增且没落主干的行仍必须 LOST（上一条不得变成 blanket pass）', () => {
  const r = baseRepo({ 'shared.txt': 'L1\n' });
  r.w('shared.txt', 'A1\nL1\n');
  const tip1 = r.addCommit('my PR');
  land(r, tip1, ['shared.txt'], 'feat: mine (#9001)');
  r.g(['checkout', '-q', 'main']);
  r.w('shared.txt', 'A1\nL1\nOTHER\n');
  r.addCommit('someone else (#9002)');
  r.g(['checkout', '-q', 'feature']);
  r.g(['merge', '-q', '--no-edit', 'main']);
  r.w('mine-only.txt', 'NEVER LANDED\n');           // re-sync 之后又开了半截，没走 PR
  const tip = r.addCommit('unfinished');
  const out = mod.collect({ ref: tip, merges: [r.g(['rev-parse', 'main'])], root: r.dir });
  assert.equal(out.judgeError, false, JSON.stringify(out.reasons));
  assert.deepEqual(out.files.map((f) => [f.file, f.verdict]), [['mine-only.txt', 'LOST']],
    '只有分支上独有的那一行该被点名，别人的行不得混进判定域');
  assert.equal(mod.main(['--ref=' + tip, '--merge=' + r.g(['rev-parse', 'main']), '--root=' + r.dir]), 1);
  r.rm();
});

test('T11 我删掉的行被后续 PR 正向上主干加回 ⇒ 有归因判 DRIFT，既不得静默放行也不得算丢失', () => {
  const r = baseRepo({ 'shared.txt': 'OLD\nKEEP\n' });
  r.w('shared.txt', 'KEEP\nMYLINE\n');            // 我删 OLD、加 MYLINE
  const tip = r.addCommit('mine');
  land(r, tip, ['shared.txt'], 'feat: mine (#9001)');
  const merge1 = r.merge;
  // 之后别人把 OLD 又加回主干（真实形态：同一功能以另一种方式回归）
  r.g(['checkout', '-q', 'main']);
  r.w('shared.txt', 'OLD\nKEEP\nMYLINE\n');
  r.addCommit('re-add OLD on purpose (#9002)');
  const out = mod.collect({ ref: tip, merges: [merge1], root: r.dir });
  const f = out.files.find((x) => x.file === 'shared.txt');
  assert.equal(f.verdict, 'DRIFT-ATTRIBUTED',
    '删除行按"主干现状"判，复现了就必须点名是谁加回的：' + JSON.stringify(f));
  assert.ok(f.attributions.length > 0, '必须给出归因提交');
  assert.equal(mod.main(['--ref=' + tip, '--merge=' + merge1, '--root=' + r.dir]), 0);
  r.rm();
});

test('T12 收紧参考系不得放过真丢失：只在分支上的行，主干与 merge 快照都没有 ⇒ 仍须 LOST / rc=1', () => {
  const r = baseRepo({ 'shared.txt': 'L1\n' });
  r.w('shared.txt', 'A1\nONLY_ON_BRANCH\nL1\n');
  const tip = r.addCommit('mine');
  // 落地时那一行被漏掉（模拟 squash 只带走部分差量）
  land(r, tip, ['shared.txt'], 'feat: mine (#9001)', { 'shared.txt': 'A1\nL1\n' });
  const out = mod.collect({ ref: tip, merges: [r.merge], root: r.dir });
  assert.equal(out.files[0].verdict, 'LOST', '参考系扩到主干之后，真丢失必须仍然看得见');
  assert.ok(out.files[0].missingAdded.some((l) => l.indexOf('ONLY_ON_BRANCH') >= 0), '要点名那一行');
  assert.equal(mod.main(['--ref=' + tip, '--merge=' + r.merge, '--root=' + r.dir]), 1);
  r.rm();
});

test('T13 --against 取不到一律判据故障（rc=2）；且每次运行必须打印实际用的参考系', () => {
  const r = baseRepo({ 'shared.txt': 'L1\n' });
  r.w('shared.txt', 'A1\nL1\n');
  const tip = r.addCommit('mine');
  land(r, tip, ['shared.txt'], 'feat: mine (#9001)');
  assert.equal(
    mod.main(['--ref=' + tip, '--merge=' + r.merge, '--root=' + r.dir, '--against=no-such-ref']), 2,
    '显式传进来的参考系取不到 ⇒ 不得退化成"只看 merge 快照"，那等于把判据变严伪装成通过');
  // 默认档必须出声它到底用了谁：origin/main 不存在时回落 main 是允许的，但不得静默
  const lines = [];
  const orig = console.log;
  try {
    console.log = (...a) => lines.push(a.join(' '));
    mod.main(['--ref=' + tip, '--merge=' + r.merge, '--root=' + r.dir]);
  } finally {
    console.log = orig;
  }
  const joined = lines.join('\n');
  assert.match(joined, /against=/, '必须打印参考系落点，否则"回落"永远看不见');
  assert.match(joined, /against=main@/, 'fixture 仓没有 origin/main ⇒ 应回落 main 并写明：' + joined.slice(0, 300));
  r.rm();
});

// 批量读数（2026-10-17，6 条已合并老分支）暴露的第二层：判定域换成主干之后仍有红，逐条读现场分三类——
//   ① 我的行曾在主干、之后被别的 PR 按正确方式改掉/删掉（如回填 PR 删 sync_* 字段）⇒ 该放行但要具名；
//   ② 那行从未出现在主干（别的会话未合并的工作）⇒ 必须继续红；
//   ③ 整份文件不在主干（MISSING_FILE）⇒ 必须继续红，不得被行级归因救走。
test('T14 我新增的行曾在主干、后被别的 PR 按正确方式改写 ⇒ 逐行归因成立则 DRIFT，并点名那笔提交', () => {
  const r = baseRepo({ 'code.txt': 'X\n' });
  r.w('code.txt', 'MY LINE\nX\n');
  const tip = r.addCommit('mine');
  land(r, tip, ['code.txt'], 'feat: mine (#9001)');      // 先正常落地：主干此刻有 MY LINE
  const merge1 = r.merge;
  r.g(['checkout', '-q', 'main']);
  r.w('code.txt', 'REWRITTEN LINE\nX\n');
  r.addCommit('refactor: rewrite that line (#9002)');     // 之后被人按正确方式改掉
  const out = mod.collect({ ref: tip, merges: [merge1], root: r.dir });
  assert.equal(out.judgeError, false, JSON.stringify(out.reasons));
  const f = out.files.find((x) => x.file === 'code.txt');
  assert.equal(f.verdict, 'DRIFT-ATTRIBUTED',
    '该行确实进过主干、又被具名提交改写 ⇒ 删分支不丢工作，但必须看得见是谁改的：' + JSON.stringify(f));
  assert.ok((f.lineAttributions || []).some((a) => /rewrite that line/.test(a.subject)),
    '必须点名那笔改写提交（逐行归因，不是"该文件有别人动过"）：' + JSON.stringify(f.lineAttributions));
  assert.equal(mod.main(['--ref=' + tip, '--merge=' + merge1, '--root=' + r.dir]), 0);
  r.rm();
});

test('T15 从未在主干出现过的行不得被逐行归因救走（上一条的负控，缺它 rescue 就是 blanket pass）', () => {
  const r = baseRepo({ 'code.txt': 'X\n' });
  r.w('code.txt', 'MY LINE\nX\n');
  r.w('dummy.txt', 'keep the merge non-empty\n');
  const tip = r.addCommit('mine');
  land(r, tip, ['code.txt', 'dummy.txt'], 'feat: mine (#9001)', { 'code.txt': 'X\n' });  // 落地时漏掉 MY LINE
  const out = mod.collect({ ref: tip, merges: [r.merge], root: r.dir });
  const f = out.files.find((x) => x.file === 'code.txt');
  assert.equal(f.verdict, 'LOST', '那行从没进过主干 ⇒ 任何归因都不该把它救走：' + JSON.stringify(f));
  assert.ok((f.lineAttributions || []).length === 0,
    '行级归因必须为空——非空即说明 rescue 在拿"别人动过这个文件"当证据：' + JSON.stringify(f.lineAttributions));
  assert.equal(mod.main(['--ref=' + tip, '--merge=' + r.merge, '--root=' + r.dir]), 1);
  r.rm();
});

test('T16 整份文件不在主干（MISSING_FILE）⇒ 仍 LOST，不得被行级归因救走', () => {
  const r = baseRepo({ 'code.txt': 'X\n' });
  r.w('code.txt', 'X\nY\n');                              // 这半边正常落地（先让合并非空）
  r.w('never-landed.md', 'UNIQUE CONTENT\n');            // 分支独有的整份文件
  const tip = r.addCommit('mine');
  land(r, tip, ['code.txt'], 'feat: mine (#9001)');       // 合并产物里没有 never-landed.md
  const out = mod.collect({ ref: tip, merges: [r.merge], root: r.dir });
  const f = out.files.find((x) => x.file === 'never-landed.md');
  assert.ok(f, '整份缺席的文件仍要进判定域：' + JSON.stringify(out.files.map((x) => [x.file, x.verdict])));
  assert.equal(f.verdict, 'LOST',
    'MISSING_FILE 与"某行被 main 扩写"必须分开计——前者删除即真丢工作：' + JSON.stringify(f));
  assert.equal(f.fileAbsentOnMain, true, '要单独标出"整份文件不在主干"这个形态');
  assert.equal(mod.main(['--ref=' + tip, '--merge=' + r.merge, '--root=' + r.dir]), 1);
  r.rm();
});

test('T17 中文行同样必须能逐行归因（判据内部按 latin1 保字节，任何把原文塞进 argv 的做法都会被 UTF-8 重编码）', () => {
  // 动因：真实仓 gate4-desktop-exclusion 的记录文件里，同一次判定中纯 ASCII 的
  // `sync_status: PENDING` 归因命中，紧随其后的两条**中文**行全部救不走 ——
  // 那是 `git log -S<行>` 经 execFileSync 把参数按 UTF-8 编码所致。本仓入库文档绝大多数是中文，
  // 所以这个盲区若不单独钉住，rescue 对绝大多数文件等于没实现。
  const r = baseRepo({ 'note.txt': 'BASE LINE\n' });
  r.w('note.txt', '我新增的中文行\nBASE LINE\n');
  const tip = r.addCommit('mine');
  land(r, tip, ['note.txt'], 'feat: 中文落地 (#9001)');
  const merge1 = r.merge;
  r.g(['checkout', '-q', 'main']);
  r.w('note.txt', '被改写的中文行\nBASE LINE\n');
  r.addCommit('docs: 按正确方式改写那行 (#9002)');
  const out = mod.collect({ ref: tip, merges: [merge1], root: r.dir });
  assert.equal(out.judgeError, false, JSON.stringify(out.reasons));
  const f = out.files.find((x) => x.file === 'note.txt');
  assert.deepEqual(f.missingAdded, [],
    '中文行不得因为编码而留在违规清单里：' + JSON.stringify(f.missingAdded.map((s) => s.slice(0, 30))));
  assert.equal(f.verdict, 'DRIFT-ATTRIBUTED', JSON.stringify(f));
  // 归因主题按 latin1 保字节，所以断言只取其中的 ASCII 编号（中文部分由打印层的 show() 还原）
  assert.ok((f.lineAttributions || []).some((a) => /#9002/.test(a.subject)),
    '必须点名那笔改写提交：' + JSON.stringify((f.lineAttributions || []).map((a) => a.subject.slice(0, 40))));
  assert.equal(mod.main(['--ref=' + tip, '--merge=' + merge1, '--root=' + r.dir]), 0);
  r.rm();
});

// QM-6 后端轴（codex，HEAD 9c808465a）命中的实质缺陷：逐行救走只看"范围内有提交动过同样文本"，
// 不看"这一行是不是随**本次合并**进过主干"。于是别人先加后撤的同文行，会把"我的行从未落地"洗成 DRIFT-ATTRIBUTED。
test('T18 救走必须以"该行随本次合并进过主干"为前提：别人加过又撤的同文行，不得替我的未落地行作保', () => {
  const r = baseRepo({ 'code.txt': 'X\n' });
  r.w('code.txt', 'MY LINE\nX\n');
  r.w('dummy.txt', 'keep the merge non-empty\n');
  const tip = r.addCommit('mine');
  // 合并产物漏掉 MY LINE（我的行从未落地）
  land(r, tip, ['code.txt', 'dummy.txt'], 'feat: mine (#9001)', { 'code.txt': 'X\n' });
  const merge1 = r.merge;
  // 之后别人在主干把同样文本加进来、又撤走 —— 与我的落地无关
  r.g(['checkout', '-q', 'main']);
  r.w('code.txt', 'MY LINE\nX\n');
  r.addCommit('someone else adds the same text (#9002)');
  r.g(['checkout', '-q', 'main']);
  r.w('code.txt', 'X\n');
  r.addCommit('someone else removes it again (#9003)');
  const out = mod.collect({ ref: tip, merges: [merge1], root: r.dir });
  const f = out.files.find((x) => x.file === 'code.txt');
  assert.equal(f.verdict, 'LOST',
    '分支是这行文本唯一的携带者 ⇒ 删了就真丢，无论这段文本是否曾以别人的身份出现在主干：' + JSON.stringify(f));
  assert.ok(f.missingAdded.some((l) => /MY LINE/.test(l)), '那一行必须仍留在违规清单里：' + JSON.stringify(f.missingAdded));
  assert.equal(mod.main(['--ref=' + tip, '--merge=' + merge1, '--root=' + r.dir]), 1);
  r.rm();
});

// ================================================================ v3：份数守恒与具名删除
// 动因 A（2026-10-17 实测，合成夹具 multiplicity-probe.cjs 坐实）：删除行判据写的是
// 「我删过的文本在主干**出现过**即违规」，于是「同名行有 N 份、我只删掉 1 份、且逐字落了地」被判处 LOST。
// 杀伤面恰好是本判据专为其特征的那两张热写面：origin/main 上 CHANGELOG.md 有 3348 个重复行键
// （单键最多 286 份）、01-docs/learnings.md 有 4104 个（最多 333 份）。
test('T19 删掉重复行的一份拷贝且完整落地 ⇒ DRIFT，不得判 LOST（份数守恒，不是"出现过即违规"）', () => {
  const r = baseRepo({ 'hot.md': 'dup\ndup\ntail\n' });
  r.w('hot.md', 'dup\ntail\n');                    // 只删掉一份 dup，另一份是应当保留的
  r.tip = r.addCommit('mine');
  r.g(['checkout', '-q', 'main']);
  r.w('hot.md', 'dup\ndup\ntail\nOTHER\n');        // 他人也动过这个文件（归因提交）
  const other = r.addCommit('second session (#9000)');
  land(r, r.tip, [], 'feat: mine (#9001)', { 'hot.md': 'dup\ntail\nOTHER\n' });  // 产物 = 我的删除 + 他人的行
  const out = judge(r);
  const f = out.files.find((x) => x.file === 'hot.md');
  assert.equal(f.verdict, 'DRIFT-ATTRIBUTED',
    '主干的 dup 份数 == 我 tip 的 dup 份数 ⇒ 我的删除逐字落地，差异只来自 OTHER：' + JSON.stringify(f));
  assert.deepEqual(f.reappearedRemoved, [], '不得把"仍然应当存在的那一份"当成被带回的删除：' + JSON.stringify(f.reappearedRemoved));
  assert.ok(f.attributions.some((a) => a.sha === other), '必须点名他人那笔：' + JSON.stringify(f.attributions));
  assert.equal(cli(r), 0);
  r.rm();
});

// T19 的负控：上一条若写成"删除行一律放行"就会同时放过真丢失。
// 合并把我的删除整份丢掉（主干仍有 2 份而我的 tip 只有 1 份）⇒ 份数超出必须仍是 LOST。
test('T20 重复行的删除被合并丢掉（主干份数 > 我的份数）⇒ 仍 LOST / rc=1（上一条不得退化为 blanket pass）', () => {
  const r = baseRepo({ 'hot.md': 'dup\ndup\ntail\n' });
  r.w('hot.md', 'dup\ntail\n');
  r.w('dummy.txt', 'keep the merge non-empty\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['dummy.txt'], 'feat: mine (#9001)', { 'hot.md': 'dup\ndup\ntail\n' });  // 删除没落地
  const out = judge(r);
  const f = out.files.find((x) => x.file === 'hot.md');
  assert.equal(f.verdict, 'LOST', '份数超出且无人可归因 ⇒ 我的删除确实被丢了：' + JSON.stringify(f));
  assert.ok(f.reappearedRemoved.some((l) => /^dup\n$/.test(l)), '违规清单必须点出那一行：' + JSON.stringify(f.reappearedRemoved));
  assert.equal(cli(r), 1);
  r.rm();
});

// 动因 B（真实仓样本，非合成）：openspec/records/_exempt/backfill-2767-2768-records.md
// 由 PR #2780（merge 8e90984bd）正常落地，之后被后续提交**按设计删除**（销账后豁免文件就该消失）。
// v2 遇到"整份文件不在主干"直接短路 LOST 且不做任何归因 ⇒ 分支 backfill-2767-2768-records 至今删不掉。
test('T21 落地后被具名提交整份删除 ⇒ DRIFT 并点名那笔删除，不得判 LOST', () => {
  const r = baseRepo({ 'seed.txt': 'A\n' });
  r.w('note.md', 'LINE ONE\nLINE TWO\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['seed.txt', 'note.md'], 'feat: mine (#9001)');     // 正常落地
  const landed = r.merge;
  r.g(['checkout', '-q', 'main']);
  r.g(['rm', '-q', 'note.md']);
  const deleter = r.addCommit('chore: 按设计清理该豁免文件 (#9002)');
  const out = judge(r, r.tip, landed);
  const f = out.files.find((x) => x.file === 'note.md');
  assert.ok(f, '缺席文件仍要进判定域：' + JSON.stringify(out.files.map((x) => [x.file, x.verdict])));
  assert.equal(f.verdict, 'DRIFT-ATTRIBUTED',
    '"曾经落地、后被具名提交删除"与"从未落地"是两件事，判据必须能分开：' + JSON.stringify(f));
  assert.ok(f.attributions.some((a) => a.sha === deleter), '必须点名那笔删除提交：' + JSON.stringify(f.attributions));
  assert.equal(cli(r, r.tip, landed), 0, '这种分支应当允许删');
  r.rm();
});

// T21 的负控：没人删它、是我的合并整份漏掉了它 ⇒ 仍 LOST（T16 已钉住同一形态，这里钉"归因不得反向吞掉"）。
// 具体做法：让删除提交与我的合并**同一次**发生（合并产物里就没有这个文件），归因面里没有他人 ⇒ 不许救走。
test('T22 整份缺席只能由"我的合并漏落"解释时不得被文件级归因救走（T16 的补强：归因集必须排除本次合并）', () => {  const r = baseRepo({ 'seed.txt': 'A\n' });
  r.w('note.md', 'LINE ONE\n');
  r.w('seed.txt', 'A\nB\n');                                       // 分支同时改 seed.txt，保证合并提交非空
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['seed.txt'], 'feat: mine (#9001)');              // 产物里只落了 seed.txt，note.md 被整份漏掉
  const out = judge(r);
  const f = out.files.find((x) => x.file === 'note.md');
  assert.equal(f.verdict, 'LOST', JSON.stringify(f));
  assert.equal(f.fileAbsentOnMain, true, '仍然要单独标出这个形态，不得被行级稀释');
  assert.equal(cli(r), 1);
  r.rm();
});

// 动因 C（v2 的第三类假阳性）：分支删掉一个文件、合并也照删 ⇒ 两侧 blob 都是"不存在"。
// v2 的第一道判据写成 `tipBlob !== null && tipBlob === againstBlob`，那个 null 前置让这种
// "完全落地"绕过了 IDENTICAL，直接落进 MISSING_FILE ⇒ LOST ⇒ 删文件的 PR 永远删不掉自己的分支。
test('T26 我删掉的文件在主干也不存在 ⇒ IDENTICAL（两侧同为缺席就是落地，不是丢失）', () => {
  const r = baseRepo({ 'keep.txt': 'A\n', 'drop.txt': 'D\n' });
  r.g(['rm', '-q', 'drop.txt']);
  r.w('keep.txt', 'A\nB\n');
  r.tip = r.addCommit('mine: 删掉 drop.txt');
  r.g(['checkout', '-q', 'main']);
  r.g(['rm', '-q', 'drop.txt']);
  r.g(['checkout', '-q', r.tip, '--', 'keep.txt']);
  r.merge = r.addCommit('feat: mine (#9001)');           // 合并产物同样没有 drop.txt
  const out = judge(r);
  const f = out.files.find((x) => x.file === 'drop.txt');
  assert.ok(f, '被我删掉的文件必须仍在判定域里（面 = base..tip 的差量）：' + JSON.stringify(out.files.map((x) => x.file)));
  assert.equal(f.verdict, 'IDENTICAL',
    '两侧都不存在 = 我的删除完整落地：' + JSON.stringify(f));
  assert.equal(cli(r), 0, '这种分支应当允许删');
  r.rm();
});

// 新增方向的份数缺口：v2 用"我的新增条数 ≤ 主干出现次数"判，base 已有 2 份、我加第 3 份而产物只落 2 份时
// need=1 ≤ have=2 ⇒ 判成无违规（只剩 UNATTRIBUTED），**说不清到底丢了哪一份**。守恒判据应当点名缺失。
test('T23 重复行的新增只落了一半 ⇒ LOST 且必须点出缺失的那一行（v2 在这里退化为说不清）', () => {
  const r = baseRepo({ 'hot.md': 'dup\ndup\n' });
  r.w('hot.md', 'dup\ndup\ndup\n');                 // 我加了第三份
  r.tip = r.addCommit('mine');
  land(r, r.tip, [], 'feat: mine (#9001)（漏落一份）', { 'hot.md': 'dup\ndup\n', 'other.txt': 'not in my changeset\n' });
  const out = judge(r);
  const f = out.files.find((x) => x.file === 'hot.md');
  assert.equal(f.verdict, 'LOST', '产物少了一份 ⇒ 我的内容没进主干：' + JSON.stringify(f));
  assert.ok(f.missingAdded.some((l) => /^dup\n$/.test(l)),
    '违规清单必须点名缺失行，不能只报"blob 不等且无人解释"：' + JSON.stringify(f.missingAdded));
  assert.equal(cli(r), 1);
  r.rm();
});

// 打印层：判据内部按 latin1 保字节，回显违规行原文时必须还原 UTF-8，
// 否则用户看到的证据是 å¤¹æ 一片 —— 证据不可读等于没有证据（本仓入库文档绝大多数是中文）。
test('T24 CLI 两条出口回显的中文违规行都必须是可读 UTF-8（plain 已走 show()，--json 曾漏）', () => {
  const r = baseRepo({ 'note.txt': 'BASE\n' });
  r.w('note.txt', '我的中文新增行\nBASE\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['note.txt'], 'feat: 漏落中文 (#9001)', { 'note.txt': 'BASE\nOTHER\n' });
  const runCli = (extra) => {
    try {
      return execFileSync(process.execPath,
        [SELF, '--ref=' + r.tip, '--merge=' + r.merge, '--root=' + r.dir].concat(extra),
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return String(e.stdout || ''); }
  };
  const plain = runCli([]);
  const json = runCli(['--json']);
  r.rm();
  for (const [label, out] of [['plain', plain], ['--json', json]]) {
    assert.ok(/我的中文新增行/.test(out),
      label + '：CLI 必须把被指控的那一行以人能核对的原文打出来，实测=' + JSON.stringify(out.slice(0, 400)));
    assert.ok(!/æ|â|Ã/.test(out), label + '：不得出现 latin1 未还原的痕迹：' + JSON.stringify(out.slice(0, 200)));
  }
});

// 出口形状锁：`--json` 是自动化消费者唯一读的那份，字段一旦少掉，读侧只会看到 undefined
// （本片重写打印层时就真的把 counts 丢了 —— 靠这条而不是靠"跑一下看看"来抓）。
test('T25 --json 出口必须带 counts 与逐文件判定，且与 plain 的计数一致', () => {
  const r = baseRepo({ 'shared.txt': 'line1\nline2\n', 'other.txt': 'x\n' });
  r.w('shared.txt', 'line1\nline2\nMINE\n');
  r.w('other.txt', 'x\ny\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['shared.txt', 'other.txt'], 'feat: mine (#9001)');
  const args = [SELF, '--ref=' + r.tip, '--merge=' + r.merge, '--root=' + r.dir];
  const json = (() => {
    try { return execFileSync(process.execPath, args.concat(['--json']), { encoding: 'utf8' }); }
    catch (e) { return String(e.stdout || ''); }
  })();
  const plain = (() => {
    try { return execFileSync(process.execPath, args, { encoding: 'utf8' }); }
    catch (e) { return String(e.stdout || ''); }
  })();
  const cut = json.lastIndexOf('}\n[BRANCH-MERGED]');
  assert.ok(cut > 0, '--json 之后仍必须打印机读末行 [BRANCH-MERGED]：' + JSON.stringify(json.slice(-120)));
  const j = JSON.parse(json.slice(0, cut + 1));
  for (const k of ['ref', 'merges', 'files', 'judgeError', 'against', 'againstSha', 'counts']) {
    assert.ok(k in j, '--json 缺字段 ' + k + '（消费侧会静默读到 undefined）');
  }
  for (const v of mod.VERDICTS) assert.equal(typeof j.counts[v], 'number', 'counts 必须逐个结论档位齐：' + JSON.stringify(j.counts));
  assert.equal(j.files.length, 2, JSON.stringify(j.files.map((f) => [f.file, f.verdict])));
  for (const f of j.files) {
    for (const k of ['file', 'verdict', 'attributions', 'lineAttributions', 'missingAdded', 'reappearedRemoved']) {
      assert.ok(k in f, f.file + ' 缺字段 ' + k);
    }
  }
  // 两种出口必须给同一个结论，否则"人看的"和"机器看的"会各自漂移
  const plainCounts = {};
  for (const v of mod.VERDICTS) plainCounts[v] = 0;
  for (const line of plain.split('\n')) {
    const m = /^[^\s]+ (IDENTICAL|DRIFT-ATTRIBUTED|LOST|UNATTRIBUTED|JUDGE_ERROR)(?:\s|\(|$)/.exec(line);
    if (m) plainCounts[m[1]]++;
  }
  for (const v of mod.VERDICTS) {
    assert.equal(j.counts[v], plainCounts[v],
      v + '：--json 计数 ' + j.counts[v] + ' 与 plain 逐行数到的 ' + plainCounts[v] + ' 不一致');
  }
  assert.ok(plainCounts.IDENTICAL > 0, 'plain 里一条判定都没数到 = 解析器失明，不是"计数为 0"');
  r.rm();
});
