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
const judge = (r, ref, merges, base) =>
  mod.collect({ ref: ref || r.tip, merges: asList(merges, r.merge), root: r.dir, base: base || 'main' });
const cli = (r, ref, merges, base) =>
  mod.main(['--ref=' + (ref || r.tip), '--merge=' + asList(merges, r.merge).join(','),
    '--root=' + r.dir, '--base=' + (base || 'main')]);

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

test('T6 一个分支被两个 PR 用过 ⇒ 文件对"任一 merge"落地即算；漏传第二个 merge 必须红', () => {
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

  const both = mod.collect({ ref: r.tip2, merges: [merge1, r.merge], root: r.dir, base: 'main' });
  assert.equal(both.judgeError, false);
  assert.equal(both.files.length, 2, '两个 PR 的文件必须并集进判定');
  assert.ok(both.files.every((f) => f.verdict === 'IDENTICAL' || f.verdict === 'DRIFT-ATTRIBUTED'),
    '两侧都落地才该是 0：' + JSON.stringify(both.files.map((f) => [f.file, f.verdict])));
  assert.equal(mod.main(['--ref=' + r.tip2, '--merge=' + merge1 + ',' + r.merge, '--root=' + r.dir, '--base=main']), 0);

  // 只传第一个 merge（漏掉回填）⇒ 第二个 PR 的文件必须报错，不得静默当已落地
  assert.equal(mod.main(['--ref=' + r.tip2, '--merge=' + merge1, '--root=' + r.dir, '--base=main']), 1);
  r.rm();
});

test('T7 判据自身故障一律走独立退出码 2，不得与"发现问题"的 1 混档', () => {
  const r = baseRepo({ 'normal.txt': 'alpha\nbeta\n' });
  r.w('normal.txt', 'alpha\nBETA\n');
  r.tip = r.addCommit('mine');
  land(r, r.tip, ['normal.txt'], 'feat: mine (#9001)');
  assert.equal(mod.main(['--ref=' + r.tip, '--merge=' + r.merge, '--root=' + r.dir, '--base=no-such-ref']), 2,
    '取不到 base 属判据故障，不是"分支没合"');
  assert.equal(mod.main(['--ref=does-not-exist', '--merge=' + r.merge, '--root=' + r.dir, '--base=main']), 2);
  assert.equal(mod.main(['--ref=' + r.tip, '--merge=deadbeefdeadbeef', '--root=' + r.dir, '--base=main']), 2,
    'merge SHA 取不到树 ⇒ 判据失明，必须与 LOST 分档');
  assert.equal(mod.main(['--ref=' + r.tip, '--merge=' + r.merge, '--root=' + r.dir, '--base=main', '--nopex']), 2,
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
