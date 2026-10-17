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
  for (const fn of ['splitLines', 'compareAddedLines', 'compareRemovedLines', 'collect', 'main']) {
    assert.equal(typeof mod[fn], 'function', fn + ' 必须是函数');
  }
  assert.deepEqual(mod.VERDICTS, ['IDENTICAL', 'DRIFT-ATTRIBUTED', 'LOST', 'UNATTRIBUTED', 'JUDGE_ERROR']);
  assert.equal(mod.EXIT_OK, 0);
  assert.equal(mod.EXIT_LOST, 1);
  assert.equal(mod.EXIT_JUDGE_ERROR, 2);
});

// ---------------------------------------------------------------- 纯判据函数
test('新增行按多重集比：主干出现次数必须 ≥ 我给的次数（"存在即可"抓不到重复行缺口）', () => {
  assert.deepEqual(mod.compareAddedLines(['a\n', 'a\n', 'b\n'], ['a\n', 'b\n']), ['a\n']);
  assert.deepEqual(mod.compareAddedLines(['a\n', 'a\n', 'b\n'], ['a\n', 'a\n', 'b\n']), []);
  assert.deepEqual(mod.compareAddedLines(['}\n', '}\n', '}\n'], ['}\n']), ['}\n'],
    '代码文件里三个孤立 } 的缺口必须被抓住，否则行级判据对普通文件完全失效');
});

test('删除行按多重集比：我删掉的行在主干复现即违规；空白行与 trim 后为空的行一律不参与', () => {
  assert.deepEqual(mod.compareRemovedLines(['旧写法\n'], ['新写法\n', '旧写法\n']), ['旧写法\n']);
  assert.deepEqual(mod.compareRemovedLines(['旧写法\n'], ['新写法\n']), []);
  assert.deepEqual(mod.compareRemovedLines(['   \n', '\n', '\r\n'], ['\n', 'x\n']), [],
    '空行/纯空白行不得算复现，否则每个文件都必红');
  assert.deepEqual(mod.compareRemovedLines(['k\n', 'k\n', 'k\n'], ['k\n']), ['k\n'],
    '删除行去重后比较：主干出现一次即算复现，不看次数');
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
