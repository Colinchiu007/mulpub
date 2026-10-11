// 回归锁：check-changelog-growth.js
// 动因是实测事故 —— b531bdfe7（PR #2884）把 CHANGELOG.md 从 1,133 条整份替换成 2 条并全绿合入。
// 本文件用 node --test 跑，必须被 quality-gate.yml 的 changes job 显式点名（否则等于没写）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { FILE, HEADING_RE, headingsOf, compareMultisets, collect, main, AUTH_PATH, readBlobOrNullText, resolveSha } = require('./check-changelog-growth.js');

test('导出的判据面必须齐（缺一个就是判据搬家）', () => {
  assert.equal(FILE, 'CHANGELOG.md');
  assert.ok(HEADING_RE instanceof RegExp);
  for (const fn of [headingsOf, compareMultisets, collect, main]) assert.equal(typeof fn, 'function');
});

test('条目标题识别：CRLF 工作树与 LF blob 必须读出同一种标题（混行尾会把一条读成两条）', () => {
  const lf = '# [未发布] A\n\n正文\n# [未发布] B\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.deepEqual(headingsOf(crlf.replace(/\r/g, '')), ['# [未发布] A', '# [未发布] B']);
  // 直接喂 CRLF 文本时，trimEnd 必须吃掉 \r，否则两种口径的标题永不相等
  assert.deepEqual(headingsOf(crlf), ['# [未发布] A', '# [未发布] B']);
  // 二级标题与引用不得算条目；但**无括号的一级标题必须算** —— 见下一条用例的取证。
  assert.deepEqual(headingsOf('## 二级\n# [已发布] 真条目\n'), ['# [已发布] 真条目']);
});

// QM-6 外部评审实测成立（2026-10-05）：origin/main 的 CHANGELOG.md 有 1,164 行一级标题，其中
// 1,140 行是 `# [` 形，另有 **2 种真条目走 `# fix(自检门禁): …（#2648，2026-09-30）` 这种无括号形**
// （各重复 4 次），唯一非条目的一级标题是 `# CHANGELOG`（文档自身标题，重复 16 次）。
// 原 HEADING_RE=/^# \[/ 对这 8 行完全失明 —— 删掉其中任何一条，棘轮照报 PASS，
// 而这正是本门禁存在的唯一理由（#2884 截断事故）。所以口径改为「一级标题，排除节标题」。
test('无括号形条目也必须算：删除 # fix(...) 一条必须报丢（原 /^# \\[/ 判据对它失明）', () => {
  assert.deepEqual(
    headingsOf('# fix(自检门禁): fifo 断言（#2648，2026-09-30）\n\n正文\n'),
    ['# fix(自检门禁): fifo 断言（#2648，2026-09-30）'],
    '无括号的一级标题就是条目，不得漏算');
  // 节标题不得算条目：否则它一旦被人改写就会制造假丢失
  assert.deepEqual(headingsOf('# CHANGELOG\n\n# [未发布] A\n'), ['# [未发布] A']);
  assert.deepEqual(headingsOf('# changelog\n'), [], '大小写不同的节标题也不算');
  // 但不能把判据放宽成"任何 # 开头"：`#hashtag` 不是标题
  assert.deepEqual(headingsOf('#nospace 不是标题\n'), [], '缺空格的 # 不是 markdown 标题');
});

test('真仓库：删掉一条无括号条目必须报丢（夹具同时含两种形状，防只测括号形）', () => {
  const repo = makeRepo();
  const base = '# [未发布] A\n\na\n# fix(自检门禁): fifo 断言（#2648）\n\nb\n# CHANGELOG\n\nt\n';
  commitChangelog(repo, base, 'base');
  assert.equal(collect({ base: 'HEAD', head: 'HEAD', root: repo.dir }).headTotal, 2,
    '两种形状都算上才是 2 条（# CHANGELOG 是节标题，不计）');
  // 删掉无括号那条，保留括号那条 —— 旧判据在这一档会报 lost=0
  commitChangelog(repo, '# [未发布] A\n\na\n# CHANGELOG\n\nt\n', 'drop bracketless entry');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.equal(r.lost.length, 1, '无括号条目被删必须报丢');
  assert.equal(r.lost[0].heading, '# fix(自检门禁): fifo 断言（#2648）');
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('多重集口径：4 份副本删到 3 份必须报丢（集合口径会读成通过）', () => {
  const base = ['x', 'x', 'x', 'x'];
  const r = compareMultisets(base, ['x', 'x', 'x']);
  assert.equal(r.lost.length, 1);
  assert.deepEqual(r.lost[0], { heading: 'x', wanted: 4, got: 3 });
  assert.equal(r.baseTotal, 4);
  assert.equal(r.headTotal, 3);
});

test('整份重写（等条数、换内容）也必须报丢 —— 这条排除「只比总数」的弱判据', () => {
  const r = compareMultisets(['A', 'B', 'C'], ['D', 'E', 'F']);
  assert.equal(r.lost.length, 3);
  assert.equal(r.baseTotal, r.headTotal, '总数相等但内容全换 —— 证明本门禁不是数量阈值');
});

test('fail closed：base 读出 0 条标题必须抛，不得判成「零丢失」', () => {
  const fakeGit = () => Buffer.from('\n正文没有条目\n', 'utf8');
  assert.throws(
    () => collect({ base: 'BASE', head: 'HEAD', git: fakeGit }),
    /fail closed.*空遍历不得判为/s,
  );
});

test('fail closed：blob 读不到必须抛（不能静默当空文件）', () => {
  const fakeGit = () => { const e = new Error('boom'); e.stderr = 'fatal: not found'; throw e; };
  assert.throws(() => collect({ base: 'BASE', head: 'HEAD', git: fakeGit }), /读不到 BASE:CHANGELOG.md/);
});

// ── 真 git 集成：用 os.tmpdir 自建仓库，避免依赖本仓工作树形态／也避免污染它 ──
// 宿主 git 配置必须隔离掉（autocrlf 等），否则「blob 里是不是 LF」这个结论会随机器漂移。
function makeRepo() {
  const dir = path.join(os.tmpdir(), 'mp-changelog-growth-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  const emptyConfig = path.join(dir, 'empty-gitconfig');
  fs.writeFileSync(emptyConfig, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig, HOME: dir, USERPROFILE: dir };
  const g = (args, opts = {}) => execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', maxBuffer: 1 << 26, env, ...opts,
  });
  g(['init', '-q', '-b', 'main']);
  return { dir, g, env };
}

function commitChangelog(repo, content, msg) {
  fs.writeFileSync(path.join(repo.dir, 'CHANGELOG.md'), content);
  repo.g(['add', 'CHANGELOG.md']);
  repo.g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg]);
}

test('真仓库四档：顶插=过 / 截断=红 / 副本删一份=红 / 恢复=过（判据必须来自真 git 而不是假对象）', () => {
  const repo = makeRepo();
  const { dir, env } = repo;
  const base = '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n';
  commitChangelog(repo, base, 'base');

  // 0) 夹具自证：blob 里必须是 LF，否则「CRLF 工作树 / LF blob」这条归一判据根本没被测到
  const blob = execFileSync('git', ['-C', dir, 'cat-file', 'blob', 'HEAD:CHANGELOG.md'], { maxBuffer: 1 << 26, env }).toString('utf8');
  assert.ok(!blob.includes('\r'), '夹具的 blob 必须是 LF');

  // 1) 顶插一条 -> PASS
  commitChangelog(repo, '# [未发布] C\n\nc\n' + base, 'prepend');
  const r1 = collect({ base: 'HEAD^', head: 'HEAD', root: dir });
  assert.deepEqual(r1.lost, [], '顶插不得报丢');
  assert.equal(r1.baseTotal, 3);
  assert.equal(r1.headTotal, 4);

  // 2) 事故复现：整份替换成 1 条 -> 必须报丢 3 种
  commitChangelog(repo, '# [未发布] D\n\nd\n', 'truncate（复刻 #2884 形态）');
  const r2 = collect({ base: 'HEAD^', head: 'HEAD', root: dir });
  assert.equal(r2.lost.length, 3, 'A / B(2 份) / C 全不见了');
  const bLost = r2.lost.find((l) => l.heading === '# [未发布] B');
  assert.deepEqual({ wanted: bLost.wanted, got: bLost.got }, { wanted: 2, got: 0 });

  // 3) 只删重复副本中的一份 -> 仍须报丢（集合口径会漏，这条就是为它写的）
  commitChangelog(repo, '# [未发布] D\n\nd\n# [未发布] A\n\na\n# [未发布] B\n\nb2\n# [未发布] B\n\nb3\n# [未发布] C\n\nc\n', 'restore');
  const r3 = collect({ base: 'HEAD^', head: 'HEAD', root: dir });
  assert.equal(r3.lost.length, 0, '恢复到「A/B×2/C/D」超集，不得报丢');
  commitChangelog(repo, '# [未发布] D\n\nd\n# [未发布] A\n\na\n# [未发布] B\n\nb2\n# [未发布] C\n\nc\n', 'drop one B copy');
  const r4 = collect({ base: 'HEAD^', head: 'HEAD', root: dir });
  assert.equal(r4.lost.length, 1);
  assert.equal(r4.lost[0].heading, '# [未发布] B');

  // 4) main() 的退出码必须由判据驱动（红=1，绿=0）
  assert.equal(main(['--root=' + dir, '--base=HEAD^', '--head=HEAD']), 1, '副本被删那一档 main() 必须返回 1');
  commitChangelog(repo, '# [未发布] D\n\nd\n# [未发布] A\n\na\n# [未发布] B\n\nb2\n# [未发布] B\n\nb3\n# [未发布] C\n\nc\n', 'restore again');
  assert.equal(main(['--root=' + dir, '--base=HEAD^', '--head=HEAD']), 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════
// 一次性书面授权例外（openspec change: dedup-changelog-history）
//
// 动因是实测，不是推测：把「同题削到 1 份」写成**自动**例外时，本文件第 112 行那条
// `真仓库四档…副本删一份=红` 当场翻绿（本机跑过 ⇒ tests 11 / pass 10 / fail 1，随后逐字节还原）。
// 那条断言的注释明写「只删重复副本中的一份 -> 仍须报丢（集合口径会漏，这条就是为它写的）」，
// 属于 owner 有意选定的不变量，不由清理 PR 改宽。所以例外只在「head 相对 base 新增授权文件」时才存在。
// ══════════════════════════════════════════════════════════════════════

// AUTH_PATH 一律从被测模块取（QM-6 F-C：本文件原先自己复制了一份同名字符串，
// 模块改路径时这里会静默测不到东西）。
function commitFiles(repo, files, msg) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo.dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    repo.g(['add', '--', rel]);
  }
  repo.g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg]);
}

function authJson(over = {}) {
  return JSON.stringify(Object.assign({
    applies_to_base: 'REPLACED',
    reason: '清理 re-sync 型历史副本',
    owner_pr: '#0000',
    expected_titles_reduced: 1,
    expected_entries_after: 3,
  }, over), null, 2) + '\n';
}

// 注：这里曾有一个 headMergeBase 辅助函数定义后从未被调用（QM-6 F-C 抓到）。
// 删掉它，而不是"留着以后用"——死代码会让下一个人以为坐标系是这么算的。
// 真实语义写在模块注释里：applies_to_base 是 `--base` 解析出的 sha（CI 中由 merge-base 推导）。

test('授权例外：削到恰好 1 份 + 保留份逐字节同源 + distinct 齐全 ⇒ 过，且必须出声', () => {
  const repo = makeRepo();
  // base：B 有两份（b / b2），A 一份 —— 这就是待清理的"乘法型污染"形状
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  // head：新增授权文件 + B 削到 1 份，且留下的必须是 dedupe/pickKeeper 真会留的那一份（正文最长 = b2），
  // 否则 F-H 判据（"门禁说留哪份"必须等于"修复真留哪份"）就会判红。
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb2\n',
    [AUTH_PATH]: authJson({ applies_to_base: mb, expected_titles_reduced: 1, expected_entries_after: 2 }),
  }, 'dedup with authorization');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.deepEqual(r.lost, [], '授权成立时削到 1 份不得报丢');
  assert.ok(r.authorization, '结果必须携带授权凭据，否则"过"是不可解释的');
  assert.equal(r.authorization.titlesReduced, 1);
  assert.equal(r.authorization.copiesRemoved, 1);
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 0);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('例外生效必须出声：判据输出里必须出现「例外由授权触发」与减少量（静默放行＝判据被改宽而无人知道）', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n# [未发布] B\n\nb3\n' }, 'base');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  commitFiles(repo, {
    // 留的必须是 pickKeeper 真会留的那一份：b2 与 b3 等长，等长取首次出现 ⇒ 是 b2 不是 b3
    // （这一档正是 F-H 判据第一次生效的地方：夹具原先留 b3 被判红）
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb2\n',
    [AUTH_PATH]: authJson({ applies_to_base: mb, expected_titles_reduced: 1, expected_entries_after: 2 }),
  }, 'dedup 3->1 with authorization');
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => { lines.push(a.join(' ')); };
  console.error = (...a) => { lines.push(a.join(' ')); };
  let rc;
  try { rc = main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']); } finally { console.log = origLog; console.error = origErr; }
  const out = lines.join('\n');
  assert.equal(rc, 0, '这一档本应过');
  assert.match(out, /例外由授权触发/, '例外生效必须单独成行');
  assert.match(out, /共减少 2 份副本/, '必须把削减量写出来，不能只报 PASS');
  assert.match(out, /条目 4 -> 2/, '规模变化必须写出来');
  assert.match(out, new RegExp(AUTH_PATH.replace(/[/.]/g, (c) => '\\' + c)), '必须点名是哪张授权文件放的行');
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('授权例外负控一：distinct 标题少一个，授权也救不了（#2884 形态的兜底）', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  commitFiles(repo, {
    // A 整条不见了 —— 这正是 growth 存在的唯一理由
    'CHANGELOG.md': '# [未发布] B\n\nb\n',
    [AUTH_PATH]: authJson({ applies_to_base: mb, expected_titles_reduced: 1, expected_entries_after: 1 }),
  }, 'lost a distinct title');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  // 默认多重集判据先算，所以 A（消失）与 B（削份）都会进 lost；本用例关心的是：
  // 授权即使被核对，也**绝不能**把"某个标题一份都不剩"洗成通过。
  const a = r.lost.find((l) => l.heading === '# [未发布] A');
  assert.ok(a, 'A 整条消失必须出现在 lost 里');
  assert.equal(a.got, 0, 'got=0 才是 #2884 那种"标题不见了"的形状');
  assert.match(r.authorizationError || '', /标题消失/, '授权核对必须点名是"标题消失"挡住了，而不是只报一句丢了');
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('授权例外负控二：保留份被改写过 ⇒ 红（授权只覆盖删副本，不覆盖顺便改正文）', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb-改过了\n',
    [AUTH_PATH]: authJson({ applies_to_base: mb, expected_titles_reduced: 1, expected_entries_after: 2 }),
  }, 'kept copy is not byte-identical to any base copy');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.equal(r.lost.length, 1, '逐字节同源判据必须真的在跑');
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('授权例外负控三：只削一半（4 份削到 2 份）不算清理 ⇒ 红', () => {
  const repo = makeRepo();
  const four = '# [未发布] A\n\na\n' + '# [未发布] B\n\nb1\n# [未发布] B\n\nb2\n# [未发布] B\n\nb3\n# [未发布] B\n\nb4\n';
  commitFiles(repo, { 'CHANGELOG.md': four }, 'base');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb1\n# [未发布] B\n\nb2\n',
    [AUTH_PATH]: authJson({ applies_to_base: mb, expected_titles_reduced: 1, expected_entries_after: 2 }),
  }, 'reduced to 2 copies, not 1');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.equal(r.lost.length, 1, '例外只承认"削到恰好 1 份"');
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('授权例外负控四：applies_to_base 与本次 merge-base 不等 ⇒ 红，且不得静默退回默认判据', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base');
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n',
    [AUTH_PATH]: authJson({ applies_to_base: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', expected_titles_reduced: 1, expected_entries_after: 2 }),
  }, 'auth pinned to a wrong base');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.equal(r.lost.length, 1, '坐标系不符 ⇒ 例外不生效，于是这份削减就是普通丢失');
  assert.match(r.authorizationError || r.lostReason || '', /applies_to_base/, '必须点名是坐标系不符，不能只报"丢了"');
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('授权不可被后续 PR 白蹭：base 里已存在授权文件 ⇒ 例外不生效', () => {
  const repo = makeRepo();
  const mb0 = '# [未发布] A\n\na\n';
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n',
    [AUTH_PATH]: authJson({ applies_to_base: 'whatever-not-newly-added' }),
  }, 'base already carries an authorization file');
  commitFiles(repo, {
    'CHANGELOG.md': mb0 + '# [未发布] B\n\nb\n',
    [AUTH_PATH]: authJson({ applies_to_base: 'whatever-not-newly-added' }),
  }, 'auth present in base too => not newly added');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.equal(r.lost.length, 1, '"相对 base 新增"这一条必须真的在判');
  assert.match(r.authorizationError || '', /新增/, '要点名"不是本次新增"');
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('授权损坏一律 fail closed：JSON 不可解析 ⇒ rc=1 且文案点名授权（不得读成"没有授权"后按普通红混过去）', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n',
    [AUTH_PATH]: '{ this is not json',
  }, 'broken auth');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.match(r.authorizationError || '', /授权/, '坏授权必须单独出声');
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('期望数与实际不符 ⇒ 红（授权文件里的数字不是注释，是判据）', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n',
    [AUTH_PATH]: authJson({ applies_to_base: mb, expected_titles_reduced: 7, expected_entries_after: 99 }),
  }, 'auth numbers do not match reality');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.equal(r.lost.length > 0 || !!r.authorizationError, true, '数字对不上时不得判过');
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('无授权时行为必须与现状逐字相同：副本删一份仍红（这条是本 change 的核心不变量）', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base');
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n' }, 'dedup WITHOUT authorization');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  // QM-6 后端 MINOR-8：只断言 lost.length===1 的话，一个"永远恰好报一条"的坏实现也能过。
  // 必须钉住是**哪一条**、以及 wanted/got 的具体数，才真正跑到多重集算术。
  assert.equal(r.lost.length, 1);
  assert.deepEqual(r.lost[0], { heading: '# [未发布] B', wanted: 2, got: 1 }, '必须点名是哪条标题从几份掉到几份');
  assert.equal(r.authorization, undefined, '没有授权文件时结果里不得出现授权凭据');
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

// ── 单一实现锁：两把锁不得各有「什么是条目」（实测曾 1,184 vs 1,158 并存）──
test('条目模型只有一份实现：growth 与副本棘轮在同一份文本上数出的条目总数必须相等', () => {
  const entries = require('./changelog-entries.js');
  const growth = require('./check-changelog-growth.js');
  const dup = require('./check-changelog-duplicate-entries.js');
  const t = '# CHANGELOG\n\n# [未发布] A\n\na\n# fix(自检门禁): fifo（#2648）\n\nb\n## 二级不算\n# [未发布] B\n\nb2\n';
  const viaHeadings = growth.headingsOf(t).length;
  const viaSplit = entries.splitEntries(t).blocks.length;
  const viaDup = dup.analyze(t).entries;
  assert.equal(viaSplit, viaHeadings, 'splitEntries 与 headingsOf 必须同口径');
  assert.equal(viaDup, viaHeadings, '副本棘轮的条目域必须与 growth 一致（1,158≠1,184 那次分裂就是在这里被钉住的）');
  assert.equal(viaHeadings, 3, '节标题与二级标题不算条目，无括号形算');
  // canonical 口径的判据必须逐字来自 growth 现有的那条被实测纠正过的正则
  assert.equal(entries.HEADING_RE.source, growth.HEADING_RE.source);
  assert.equal(entries.HEADING_RE.flags, growth.HEADING_RE.flags);
});

// ── QM-6 三条 MAJOR/MINOR 的落点：读失败≠缺席、sha 形状、raw 字节同源 ──

test('readBlobOrNullText：ref 里存在却读不出来 ⇒ 抛（不得洗成"没有授权文件"）；ref 里不存在 ⇒ null', () => {
  const presentButUnreadable = (args) => {
    if (args[0] === 'ls-tree') return Buffer.from('scripts/changelog-dedup-authorization.json\n');
    const e = new Error('boom'); e.stderr = Buffer.from('fatal: unable to read object'); throw e;
  };
  assert.throws(
    () => readBlobOrNullText(presentButUnreadable, 'HEAD', 'scripts/changelog-dedup-authorization.json'),
    /在该 ref 里存在却读不出来/,
  );
  const absent = (args) => (args[0] === 'ls-tree' ? Buffer.from('') : Buffer.from('x'));
  assert.equal(readBlobOrNullText(absent, 'HEAD', 'scripts/changelog-dedup-authorization.json'), null);

  // 存在性必须由 ls-tree 决定，不得再靠错误文案猜（旧实现把 `exists on disk, but not in` 与真读失败混为一谈）
  const src = fs.readFileSync(path.join(__dirname, 'check-changelog-growth.js'), 'utf8');
  const at = src.indexOf('function readBlobOrNullText');
  assert.ok(at > 0, '函数必须存在（锚点找不到≠实现被删）');
  const body = src.slice(at, at + 1400);
  assert.ok(/ls-tree/.test(body), '存在性判定必须走 ls-tree');
  assert.doesNotMatch(body, /does not exist/, '不得再用文案正则把"读失败"判成"不存在"');
});

test('resolveSha：rev-parse 成功但输出不是 40 位 sha ⇒ 抛（坐标校验自己不得先失效）', () => {
  for (const bad of ['HEAD', 'not-a-sha', 'd1e2f3', '', '  \n']) {
    assert.throws(
      () => resolveSha(() => Buffer.from(bad + '\n'), 'HEAD^'),
      /不是 40 位 sha/,
      `输入 ${JSON.stringify(bad)} 本应被拒`,
    );
  }
  const sha = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(resolveSha(() => Buffer.from(sha + '\n'), 'HEAD'), sha);
});

test('raw 字节同源：只差一个 CR 的保留份不得算"逐字节相同"（QM-6 F-D）', () => {
  const repo = makeRepo();
  // base 里 B 的那一份正文行尾带孤立 CR；head 里改成了纯 LF —— 剥 CR 后两者"相同"，raw 则不同
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb2\r\n# [未发布] B\n\nb3\r\n' }, 'base');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb2\n',
    [AUTH_PATH]: authJson({ applies_to_base: mb, expected_titles_reduced: 1, expected_entries_after: 2 }),
  }, 'kept copy differs from base only by CR');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.match(r.authorizationError || '', /逐字节/, '必须被判成"保留份与 base 不同源"，而不是被 CR 归一洗掉');
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('head 独有的新标题被插两份 ⇒ 红（QM-6 F-E：旧实现只遍历 base 的标题组，对这一档完全失明）', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb2\n# [未发布] C\n\nc\n# [未发布] C\n\nc\n',
    [AUTH_PATH]: authJson({ applies_to_base: mb, expected_titles_reduced: 1, expected_entries_after: 4 }),
  }, 'legit dedup + a brand-new title duplicated twice');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.match(r.authorizationError || '', /新标题/, '必须点名是"base 没有的标题被插了多份"');
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('head 一条标题都没有 ⇒ 红（后端通道 Q4：判据退化成分支不能被读成"零丢失"）', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n' }, 'base');
  commitFiles(repo, { 'CHANGELOG.md': '\n这段正文里没有任何一级标题\n' }, 'head has zero entries');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.equal(r.headTotal, 0, '夹具自证：head 确实零条目');
  assert.equal(r.lost.length, 2, '两种标题都必须报丢，零条目不是"无丢失"');
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('授权损坏的三种形态各自 fail closed（缺必填字段 / JSON 是数组 / sha 形状非法）', () => {
  const cases = [
    { name: '缺 reason 字段', body: (() => { const o = { applies_to_base: 'x'.repeat(40), owner_pr: '#1', expected_titles_reduced: 1, expected_entries_after: 2 }; return JSON.stringify(o); })(), re: /缺少必填字段/ },
    { name: 'JSON 是数组', body: '[]', re: /必须是一个对象/ },
    { name: 'sha 形状非法（缩写或非 hex）', body: JSON.stringify({ applies_to_base: 'zz'.repeat(20), reason: 'r', owner_pr: '#1', expected_titles_reduced: 1, expected_entries_after: 2 }), re: /40 位 sha/ },
    { name: 'sha 是合法的 7 位缩写也不行', body: JSON.stringify({ applies_to_base: 'cbce325', reason: 'r', owner_pr: '#1', expected_titles_reduced: 1, expected_entries_after: 2 }), re: /完整 40 位/ },
  ];
  for (const c of cases) {
    const repo = makeRepo();
    commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base');
    commitFiles(repo, {
      'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb2\n',
      [AUTH_PATH]: c.body,
    }, 'broken auth: ' + c.name);
    const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
    assert.match(r.authorizationError || '', c.re, `${c.name} 的出声文案不对`);
    assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1, `${c.name} 必须 rc=1`);
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('多空格 / 制表符后的一级标题也是条目（QM-6 后端 MAJOR-4：写死"恰好一个空格"会留失明）', () => {
  // 三种合法 markdown 标题形态都必须被同一个口径认作条目
  assert.deepEqual(headingsOf('#  两个空格\n'), ['#  两个空格']);
  assert.deepEqual(headingsOf('#    五个空格\n'), ['#    五个空格']);
  assert.deepEqual(headingsOf('#\t制表符\n'), ['#\t制表符'], '制表符不算空格时这条会红 —— 判据必须覆盖它');
  // 但 `# CHANGELOG` 的多种空格形态都仍是节标题
  assert.deepEqual(headingsOf('#  CHANGELOG\n\n# [未发布] A\n'), ['# [未发布] A']);
  // 且无空格仍不是标题
  assert.deepEqual(headingsOf('#nospace 不是标题\n'), []);
});

test('授权通路下，文件头（preamble）被改写 ⇒ 红（QM-6 后端 MAJOR-3：块级判据看不见第一条标题之前等内容）', () => {
  const repo = makeRepo();
  commitFiles(repo, { 'CHANGELOG.md': '# 项目台账说明与许可声明\n\n---\n# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base with preamble');
  const mb = repo.g(['rev-parse', 'HEAD']).trim();
  commitFiles(repo, {
    // 削了 B 的副本（合法），却把文件头换成别的（不合法）
    'CHANGELOG.md': 'REPLACED HEADER\n# [未发布] A\n\na\n# [未发布] B\n\nb2\n',
    [AUTH_PATH]: authJson({ applies_to_base: mb, expected_titles_reduced: 1, expected_entries_after: 3 }),
  }, 'dedup but preamble rewritten');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.match(r.authorizationError || '', /文件头被改写/, '必须点名是 preamble：' + String(r.authorizationError));
  assert.equal(main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']), 1);
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('判据文件的扫描域不得为 0（防「解析退化成空集合」式假绿）', () => {
  const t = fs.readFileSync(path.join(__dirname, 'check-changelog-growth.js'), 'utf8');
  assert.ok(t.includes("Buffer.byteLength"), '必须同时留字节证据');
  assert.ok(/maxBuffer/.test(t), '读 blob 必须带 maxBuffer，否则 7.4MB 的 CHANGELOG 会 ENOBUFS');
});

// 接线锁（QM-6 之后补，动因是实测）：本门禁的 base 坐标系一旦写成 origin/main，就会把
// 「别人在我上次同步之后并入 main 的条目」读成本 PR 丢失 —— 本地实测该口径报 3 种丢失 rc=1，
// merge-base 口径 1145=1145 rc=0。这类"看起来更严格其实错坐标系"的改动，靠人记住是记不住的。
test('CI 接线锁：Gate 2c3 必须以 merge-base 为坐标系，且不得退回 origin/main', () => {
  const wfPath = path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml');
  const wf = fs.readFileSync(wfPath, 'utf8');
  const at = wf.indexOf('Gate 2c3 - CHANGELOG growth');
  assert.ok(at > 0, 'Gate 2c3 步骤必须存在于 quality-gate.yml');
  // 区间终点不能靠"下一个步骤名"（改名/搬家会让 indexOf 返回 -1，slice 的负终点被解释成倒数 ⇒ 静默放大到接近整份文件）
  const body = wf.slice(at);
  const end = body.search(/\n {6}- name:/);
  assert.ok(end > 0, '必须能定位本步骤的结束边界（找不到边界即红，不得静默扫全文）');
  const step = body.slice(0, end);
  assert.ok(step.includes('shell: bash'), '多命令 run 块必须 fail-fast（AGENTS.md：PowerShell 步骤不在中间命令非零时中止）');
  assert.ok(/git merge-base/.test(step), 'base 必须由 merge-base 推导，否则坐标系会随 main 前进漂移');
  assert.ok(!/--base\s*=\s*["']?(origin\/)?main["']?/.test(step), '不得把 base 写成 origin/main —— 那是别的 PR 的进度，不是本 PR 的起点');
  assert.ok(/\$\{MB:-\$BASE_REF\}/.test(step), 'merge-base 算不出时必须回落到 base_ref（更严方向回落，不许回落成空）');
  assert.ok(/node scripts\/check-changelog-growth\.js/.test(step) && /node --test/.test(step),
    '单测与门禁本体都必须接在同一步骤里（只接一个 = 另一半永不执行）');
});

// 一次性授权的生命周期锁（2026-10-09 决定 A：只退授权件，不改判据）。
// 动因是实测：授权文件 88669579 合入 main 后一直没退，而它声明的坐标系（expected_entries_after=349）
// 与今天 main 的台账规模（门禁 HEADING_RE 口径 365 条）已经对不上 —— 它既不再服务任何 PR（进不了通路：
// base 已含该文件即撞「不是本次新增」防白蹭），又让“一次性”在语义上变成常驻。真正解除死锁的是 re-sync 推 base。
//
// 判据形态是 **base ∧ head**，不是"任何地方有就红"（QM-6 前端路命中：无条件存在性断言会把
// 本文件自己在 527-528 行推荐的合法用法 —— 清理 PR 用 regen 现生成一份 —— 一并打红，
// 于是通路代码还在、流程层却已死）。四条边界：
//   base 有 + head 无  ⇒ 绿（这就是本次退役 PR 的形态）
//   base 无 + head 有  ⇒ 绿（合法的一次性新增，通路照旧可用）
//   base 有 + head 有  ⇒ 红（已落 main 还在被继承使用 = 常驻未退）
//   head 有但不在 AUTH_PATH ⇒ 红（改名/换位的常驻逃法）
test('一次性去重授权的生命周期：不得在已落 main 的情况下继续被携带', () => {
  const root = path.join(__dirname, '..');
  const git = (args) => execFileSync('git', ['-C', root].concat(args), { encoding: 'utf8' });
  const AUTH_RE = /(^|\/)changelog-dedup-authorization[^/]*\.json$/;
  const listOf = (lines) => lines.split('\n').map((l) => l.trim()).filter(Boolean);
  const offendersIn = (lines) => listOf(lines).filter((p) => AUTH_RE.test(p));

  // base 坐标系可显式注入（反证与本地复现都要用）；默认退到 merge-base HEAD origin/main；算不出即红，不得静默跳过。
  let baseRef = (process.env.MP_CHANGELOG_BASE_REF || '').trim();
  if (!baseRef) {
    try { baseRef = git(['merge-base', 'HEAD', 'origin/main']).trim(); } catch { baseRef = ''; }
  }
  assert.ok(/^[0-9a-f]{40}$/.test(baseRef) || (() => { try { git(['rev-parse', '--verify', baseRef + '^{commit}']); return true; } catch { return false; } })(),
    `base 坐标系算不出来（得到 ${JSON.stringify(baseRef)}）—— 本锁的判据完全依赖它，取不到必须红，不得当成"没有 base"放行`);

  const atHead = offendersIn(git(['ls-files']));
  const atBase = offendersIn(git(['ls-tree', '-r', '--name-only', baseRef]));
  assert.ok(listOf(git(['ls-files'])).length > 1000, 'tracked 清单解析退化 —— 空集合会让本锁恒真');
  assert.ok(listOf(git(['ls-tree', '-r', '--name-only', baseRef])).length > 1000, 'base 清单解析退化 —— 空集合会让本锁恒真');

  if (atBase.length > 0 && atHead.length > 0) {
    assert.fail(`一次性授权已随 base（${baseRef.slice(0, 12)}）落进 main，本次 head 仍带着它（${atHead.join(', ')}）= 常驻未退。` +
      '它声明的坐标系只服务那一次清理；要么在本次 PR 里删掉它（base 有 / head 无 = 退役 PR，本锁放行），' +
      '要么就是你正在借一份已消费的授权混过 growth 门禁。');
  }
  if (atHead.length > 0) {
    assert.deepEqual(atHead, [AUTH_PATH],
      `一次性授权只认规范路径 ${AUTH_PATH}；实际出现在 ${JSON.stringify(atHead)} —— 改名或换目录是绕开常驻判据的形态，不放行`);
  }
});

test('退的是授权件不是通路：常量/生成器/校验函数三样都必须在', () => {
  assert.equal(typeof AUTH_PATH, 'string', 'AUTH_PATH 仍是门禁导出的真源常量');
  assert.equal(AUTH_PATH, 'scripts/changelog-dedup-authorization.json', '路径不得被改名来绕开上一条锁');
  const regen = require('./changelog-dedup-regen.js');
  assert.equal(typeof regen.regenerate, 'function', '生成器必须还在（否则一次性授权再也造不出来）');
  assert.equal(regen.AUTH_PATH, AUTH_PATH, '生成器与门禁必须指向同一个路径（两份口径必然漂移）');
  const growth = require('./check-changelog-growth.js');
  assert.equal(typeof growth.evaluateAuthorization, 'function', '授权通路本体不得被顺手删掉');
  assert.equal(typeof growth.checkDedupShape, 'function', '形状四条判据不得被顺手删掉');
});

// ══ 自述与实际一致（openspec change 归档后补的锁，见 changelog-ledger-integrity 主规格 R2 场景「祖先」）══
// 动因：实测 RETIRE_REPO_ROOT 写死成 path.resolve(__dirname,'..')，祖先探测**不走** collect 注入的 root/git，
// 于是退休分支在单元层无法用夹具跑到（临时仓 sha 在真仓不存在 ⇒ isAncestor=false）。这条锁同时钉住两件事：
// ①退休必须机读可辨（authorization.retired）并在 stdout 单独成行、点名两个坐标系 sha；②探测必须认注入的 root。
test('退休放行必须与新鲜授权可区分：retired 进返回值、stdout 单独成行且带两个 sha', () => {
  const repo = makeRepo();
  // c1：授权声明的坐标系（之后成为 base 的祖先）
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] seed\n\ns\n' }, 'coordinate commit (ancestor of base)');
  const applied = repo.g(['rev-parse', 'HEAD']).trim();
  // c2 = base：B 有两份 —— 待清理形状
  commitFiles(repo, { 'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb\n# [未发布] B\n\nb2\n' }, 'base with duplicate');
  const curBase = repo.g(['rev-parse', 'HEAD']).trim();
  // c3 = head：B 削到 1 份（留 pickKeeper 那份 b2）+ 带一份坐标系指向 c1 的授权
  commitFiles(repo, {
    'CHANGELOG.md': '# [未发布] A\n\na\n# [未发布] B\n\nb2\n',
    [AUTH_PATH]: authJson({ applies_to_base: applied, expected_titles_reduced: 1, expected_entries_after: 2 }),
  }, 'dedup on an already-consumed coordinate');
  const r = collect({ base: 'HEAD^', head: 'HEAD', root: repo.dir });
  assert.equal(r.authorizationError, undefined, '退休通路不得报错：' + (r.authorizationError || ''));
  assert.deepEqual(r.lost, [], '祖先坐标系 + 形状与额度都对 ⇒ 放行（注意它**没有**放宽任何校核）');
  assert.ok(r.authorization, '结果必须带授权凭据');
  assert.equal(r.authorization.retired, true, '退休形态必须机读可辨（--json 模式下要能分）');
  const lines = [];
  const origLog = console.log, origErr = console.error;
  console.log = (...a) => { lines.push(a.join(' ')); };
  console.error = (...a) => { lines.push(a.join(' ')); };
  let rc;
  try { rc = main(['--root=' + repo.dir, '--base=HEAD^', '--head=HEAD']); } finally { console.log = origLog; console.error = origErr; }
  const out = lines.join('\n');
  assert.equal(rc, 0, '这一档本应过');
  assert.match(out, /授权坐标系已消费退休/, 'stdout 必须单独成行点名退休，否则与新鲜授权长得一模一样');
  assert.ok(out.includes(applied.slice(0, 12)), '必须打印授权声明的坐标系 sha');
  assert.ok(out.includes(curBase.slice(0, 12)), '必须打印本次 base 的 sha（缺一就无法归因是哪个坐标系被越过）');
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('regen 写进授权件的规格出处必须真实存在（归档后留旧路径 = 让下一次清理去追一个不存在的目录）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'changelog-dedup-regen.js'), 'utf8');
  const root = path.resolve(__dirname, '..');
  const refs = [...src.matchAll(/openspec\/changes\/[A-Za-z0-9._\/-]+/g)].map((m) => m[0].replace(/\/+$/, ''));
  assert.ok(refs.length >= 1, 'reason 字段本来就该带规格出处；一条都没有说明自述被删了');
  for (const rel of refs) {
    assert.ok(fs.existsSync(path.join(root, rel)), `regen 的 reason 指向不存在的路径 ${rel}（change 归档后要同步改成 archive/<date>-<name>/）`);
  }
});
