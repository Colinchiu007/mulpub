'use strict';
/**
 * check-no-hot-carrier-edit.test.js — 热写面禁改门禁的行为锁（change: changelog-record-carrier，tasks 3）
 *
 * 口径：本文件由 quality-gate.yml 的 `changes` 作业 `Gate 2b9 - Hot-carrier edit gate` 点名执行；
 * （2b2–2b8 已被占：#3724 合入后 `Gate 2b5 - CCG evidence anchor` 也在用，编 2b9 避开。）
 * changes 作业无 Install deps ⇒ T10 机械守住"只 require node 内置"。
 *
 * 为什么每条都是行为锁（真起子进程跑 CLI、断 rc 与点名），而不是读源码里的字符串：
 * 本仓反复记录的「装饰性门禁」形态就是"断言那行字在文件里存在"。这里要防的是**判据选错了
 * 输入**（按文件现状而不是 PR 差量），那在源码文本上完全看不出来。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const CRITERION = path.join(__dirname, 'check-no-hot-carrier-edit.js');
const tmpDirs = [];

function git (cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}
function mkRepo () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-hce-'));
  tmpDirs.push(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['config', 'user.email', 't@t']);
  // 真实仓根有这两个热点文件；夹具必须也有，否则"没命中"可能只是因为文件不存在。
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# CHANGELOG\n');
  fs.mkdirSync(path.join(dir, '01-docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '01-docs', 'learnings.md'), '# learnings\n');
  fs.mkdirSync(path.join(dir, 'openspec', 'records'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'seed']);
  return dir;
}
function run (dir, args) {
  // ⛔ 必须显式传 --root=<夹具>：判据默认取自己所在仓库的根，只设子进程 cwd 不会改变取证根。
  // 漏了这一条时 7 个用例全都会"判 PASS"，因为真仓的差量里没有台账 —— 那是**夹具造成的假绿**，
  // 比假红危险（本仓记过：夹具对所有输入返回同一份数据 ⇒ 一整类缺陷对它结构性免疫）。
  const r = spawnSync(process.execPath, [CRITERION, `--root=${dir}`, ...args], { cwd: dir, encoding: 'utf8' });
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function commitChange (dir, rel, content, msg) {
  fs.writeFileSync(path.join(dir, rel), content, 'utf8');
  git(dir, ['add', rel]);
  git(dir, ['commit', '-q', '-m', msg || `edit ${rel}`]);
}

test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

test('T1 差量改了 CHANGELOG.md ⇒ 点名并给出正解（写进执行记录的小节）', () => {
  const dir = mkRepo();
  commitChange(dir, 'CHANGELOG.md', '# CHANGELOG\n# [未发布] 新条目\n');
  const r = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 1, 'enforce 档必须真的拦');
  assert.match(r.out, /CHANGELOG\.md/);
  assert.match(r.out, /openspec\/records/, '红文案要指回正解，不能只说"不许改"');
});

test('T2 差量改了 01-docs/learnings.md ⇒ 同样点名', () => {
  const dir = mkRepo();
  commitChange(dir, '01-docs/learnings.md', '# learnings\n## 新教训\n');
  const r = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 1);
  assert.match(r.out, /learnings\.md/);
});

test('T3 没碰热写面 ⇒ PASS，且首行读数在场', () => {
  const dir = mkRepo();
  commitChange(dir, 'README.md', 'y\n');
  const r = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 0, r.out);
  assert.match(r.out, /^HOT-CARRIER .*判定=PASS/);
});

test('T4 关键负控：他人把台账改进主干、我 rebase 上去 ⇒ 我的差量仍不含台账 ⇒ PASS', () => {
  const dir = mkRepo();
  const base = git(dir, ['rev-parse', 'HEAD']);
  // 别人（在 main 上）动了 CHANGELOG.md
  commitChange(dir, 'CHANGELOG.md', '# CHANGELOG\n# [未发布] 别人那条\n');
  const mainTip = git(dir, ['rev-parse', 'HEAD']);
  // 我的分支从 base 出发，只改 README
  git(dir, ['checkout', '-q', '-b', 'mine', base]);
  commitChange(dir, 'README.md', 'mine\n');
  // rebase 到含他人台账改动的 main 上
  git(dir, ['rebase', '-q', mainTip]);
  const r = run(dir, ['--base=' + mainTip, '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 0, `rebase 带进来的他人台账改动不该算我头上：\n${r.out}`);
  // 反向自检：如果判据改成"读文件现状"，夹具里 CHANGELOG.md 明明含他人的新行 ⇒ 会红。
  // 这条断言证明本用例真的处在"按现状必错"的形态上，而不是两边都绿的空转。
  assert.ok(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8').includes('别人那条'));
});

test('T5 授权出口：本次差量新增授权文件且 applies_to_base 匹配 ⇒ 放行并打印 授权=on', () => {
  const dir = mkRepo();
  // 授权里写的坐标 = 这次差量的 merge-base。此刻 HEAD 还是根提交，加一笔之后
  // merge-base(HEAD^, HEAD) 就是它 —— 不能在加笔之前去问 HEAD^（那时它不存在）。
  const mb = git(dir, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# CHANGELOG\n# [未发布] 发版聚合\n');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'hot-carrier-write-authorization.json'),
    JSON.stringify({ applies_to_base: mb, authorizedPaths: ['CHANGELOG.md'], reason: 'release 聚合' }, null, 2) + '\n', 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'aggregate release']);
  const r = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 0, r.out);
  assert.match(r.out, /授权=on/);
});

test('T6 授权文件在 base 已存在 ⇒ 不放行（常驻通行证会让后续每个 PR 白蹭）', () => {
  const dir = mkRepo();
  const base = git(dir, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'hot-carrier-write-authorization.json'),
    JSON.stringify({ applies_to_base: git(dir, ['merge-base', base, base]), authorizedPaths: ['CHANGELOG.md'], reason: '早就存在的' }, null, 2) + '\n', 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'auth landed earlier']);
  // 之后有人改台账，但没有"新增"授权文件
  commitChange(dir, 'CHANGELOG.md', '# CHANGELOG\n# [未发布] 蹭旧证\n');
  const r = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 1, r.out);
  assert.match(r.out, /授权=off/);
});

test('T7 applies_to_base 与实际 merge-base 不符 ⇒ 不放行并点名原因', () => {
  const dir = mkRepo();
  // 台账改动与授权文件必须在**同一笔**提交里：拆成两笔的话最后一笔差量里就没有热写面了，
  // 判据会正确判 PASS —— 那是一条"看着在测、实际什么都没测"的空转用例（装饰性用例的同型）。
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# CHANGELOG\n# [未发布] 坐标错了\n');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'hot-carrier-write-authorization.json'),
    JSON.stringify({ applies_to_base: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', authorizedPaths: ['CHANGELOG.md'], reason: '陈旧坐标' }, null, 2) + '\n', 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'stale auth']);
  const r = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 1, r.out);
  assert.match(r.out, /AUTH_BASE_MISMATCH|applies_to_base/);
});

test('T5b 坐标对、但 authorizedPaths 没覆盖那个文件 ⇒ 仍不放行（变异 MH 的落点）', () => {
  const dir = mkRepo();
  const mb = git(dir, ['rev-parse', 'HEAD']);
  // 授权只登记了 learnings，实际改的却是 CHANGELOG —— 若"坐标对就算授权"，
  // 一份通行证会替所有热写面顶罪（正是本仓记过的"一个授权蹭多个面"形态）。
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# CHANGELOG\n# [未发布] 未登记的路径\n');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'hot-carrier-write-authorization.json'),
    JSON.stringify({ applies_to_base: mb, authorizedPaths: ['01-docs/learnings.md'], reason: '只批了 learnings' }, null, 2) + '\n', 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'partial auth']);
  const r = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 1, r.out);
  assert.match(r.out, /AUTH_PATH_UNCOVERED/);
  assert.match(r.out, /授权=off/);
});

test('T6b 工作树里有历史落地的授权文件也不生效（CI 检出的是 merge ref，变异 MC 的落点）', () => {
  const dir = mkRepo();
  const seed = git(dir, ['rev-parse', 'HEAD']);
  // main：先落一份授权（applies_to_base = seed）。它落地之后就常驻在工作树里。
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'hot-carrier-write-authorization.json'),
    JSON.stringify({ applies_to_base: seed, authorizedPaths: ['CHANGELOG.md'], reason: '上次发版留下的' }, null, 2) + '\n', 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'auth landed on main']);
  // 另一个分支从 seed 出发改了台账；merge-base(seed, 该分支) 恰是 seed，
  // 也就是那份历史授权的坐标 —— 若判据按"文件存在/坐标对"放行，这次蹭车就成功了。
  git(dir, ['checkout', '-q', '-b', 'feature', seed]);
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# CHANGELOG\n# [未发布] 蹭旧证\n');
  git(dir, ['add', 'CHANGELOG.md']);
  git(dir, ['commit', '-q', '-m', 'edit changelog']);
  const feature = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', 'main']); // 恢复"工作树里带着那份授权"的现场
  const r = run(dir, [`--base=${seed}`, `--head=${feature}`, '--mode=enforce']);
  assert.strictEqual(r.rc, 1, `历史落地的授权不得成为常驻通行证：\n${r.out}`);
  assert.match(r.out, /授权=off/);
  assert.ok(fs.existsSync(path.join(dir, 'scripts', 'hot-carrier-write-authorization.json')), '本用例确实站在"文件就在工作树里"的形态上');
});

test('T6c 历史授权常驻在工作树**和 head blob** 里、且坐标恰好还成立 ⇒ 仍必须因"不是本次新增"而拒绝', () => {
  // 为什么单有 T6/T6b 不够（变异 MC 报 NOT_CAUGHT 后补的这一条）：
  // T6b 里 feature 分支不含那份授权，`git show head:AUTH` 直接读不到 ⇒ 被"读不到"这一格挡下，
  // 挡它的不是 addedAuth 规则，而是第二道独立守卫 —— 那叫防御重叠，不构成反证。
  // 本条把重叠拆掉：授权同时存在于工作树与 head blob，applies_to_base 也正好等于本次 merge-base，
  // 唯一还能拒绝它的就是"必须是本次差量新增"。
  const dir = mkRepo();
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'hot-carrier-write-authorization.json'),
    JSON.stringify({ applies_to_base: 'pending', authorizedPaths: ['CHANGELOG.md'], reason: '上次发版留下的常驻证' }, null, 2) + '\n', 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'auth on main (placeholder)']);
  const authCommit = git(dir, ['rev-parse', 'HEAD']);
  // 把坐标改成"下一次从 main 分叉时的 merge-base"，即这个 authCommit 自己。
  fs.writeFileSync(path.join(dir, 'scripts', 'hot-carrier-write-authorization.json'),
    JSON.stringify({ applies_to_base: authCommit, authorizedPaths: ['CHANGELOG.md'], reason: '坐标与后来者的 merge-base 重合' }, null, 2) + '\n', 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'auth coordinates point at themselves']);
  const mainTip = git(dir, ['rev-parse', 'HEAD']);
  // 从 main tip 分叉的 PR：merge-base 恰等于那份历史授权声明的坐标。
  git(dir, ['checkout', '-q', '-b', 'pr', mainTip]);
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# CHANGELOG\n# [未发布] 蹭一张仍然有效的旧通行证\n');
  git(dir, ['add', 'CHANGELOG.md']);
  git(dir, ['commit', '-q', '-m', 'edit changelog']);
  assert.ok(fs.existsSync(path.join(dir, 'scripts', 'hot-carrier-write-authorization.json')), '前提：授权就在工作树里');
  // base 取"引入授权那笔"：这正是 CI 里 PR 建好后 main 没再前进时的 base.sha ——
  // merge-base(base, head) == 授权里写的坐标，唯一还能拒绝的就只剩"必须是本次差量新增"。
  const r = run(dir, [`--base=${authCommit}`, '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 1, `常驻通行证即使坐标成立也不得放行：\n${r.out}`);
  assert.match(r.out, /授权=off/);
  assert.match(r.out, /不是本次差量新增/);
});

test('T8 同一份差量在 advisory 档不阻断，但仍打印同一份点名（档位由判据自己声明）', () => {
  const dir = mkRepo();
  commitChange(dir, 'CHANGELOG.md', '# CHANGELOG\n# [未发布] 消化窗口\n');
  const a = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=advisory']);
  const e = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(a.rc, 0, 'advisory 不得阻断在飞 PR');
  assert.strictEqual(e.rc, 1, 'enforce 必须阻断同一份差量');
  assert.match(a.out, /MODE=advisory/);
  assert.match(e.out, /MODE=enforce/);
  assert.ok(a.out.includes('CHANGELOG.md') && e.out.includes('CHANGELOG.md'), '两档点名内容必须一致，只在是否阻断上分档');
});

test('T9 取证失败一律按未证实处理：坏 ref ⇒ rc=2，不得读成"没有违规"', () => {
  const dir = mkRepo();
  const r = run(dir, ['--base=no-such-ref', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 2, r.out);
  const badMode = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=loose']);
  assert.strictEqual(badMode.rc, 2, '未知 mode 必须拒绝，不能静默回落默认档');
});

test('T10 判据只允许 require node 内置模块（changes 作业无 Install deps）', () => {
  const src = fs.readFileSync(CRITERION, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const reqs = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.ok(reqs.length > 0, '解析退化成空集合时本锁恒真');
  for (const q of reqs) assert.match(q, /^node:/, `第三方/相对依赖 ${q} 会让 changes 作业 MODULE_NOT_FOUND`);
});

test('T11 热写面清单必须显式登记，未知新增不自动纳入（判据范围要写得出来）', () => {
  const dir = mkRepo();
  commitChange(dir, 'AGENTS.md', '# agents\nnew\n');
  const r = run(dir, ['--base=HEAD^', '--head=HEAD', '--mode=enforce']);
  assert.strictEqual(r.rc, 0, 'AGENTS.md 不在热写面清单内，不得被"看着像共享写面"就拦');
});
