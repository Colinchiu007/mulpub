'use strict';
/**
 * git-domain.test.js — 共享判据「git 的域」的回归锁
 *
 * 为什么单独存在：`check-max-lines`（#3876 已改成 git 域）与 `check-debt-budget`（本次）
 * 两个门禁要共用同一份取域实现。两个消费者各自的集成锁测的是"过滤有没有生效"，
 * 而"域本身算得对不对"这件事必须在共享实现上有自己的锁 —— 否则实现改坏时，
 * 两边各自的夹具可能恰好都不覆盖那一格。
 *
 * 判据语义（六条，逐条对应下面的用例）：
 *  ① 受管（在索引里）= 在域内
 *  ② 未跟踪且被 .gitignore 忽略 = 不在域内（假红的根因）
 *  ③ 未跟踪且未被忽略 = 在域内（未 add 的新文件仍是新增债）
 *  ④ 被跟踪但同时命中 .gitignore（历史 `git add -f` 的产物）= 仍在域内（并集，不是 check-ignore）
 *  ⑤ 取不到 git 读数（非工作树 / git 不可执行）= 抛错，不得静默返回空集合
 *  ⑥ 空集合 = 抛错（"0 个文件"不等于"没有债"，把工具的失明读成结论是本仓反复出现的同型错误）
 *
 * 另加一条机器态锁：system 档配置（core.excludesFile）不得能改域 ——
 * 实测唯一开关是 GIT_CONFIG_NOSYSTEM=1，delete GIT_CONFIG_SYSTEM 挡不住。
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { gitDomain } = require('./git-domain');

/** 在 root 之外放一份空 gitconfig，屏蔽机器上的全局配置；system 档用 GIT_CONFIG_NOSYSTEM 关掉。 */
function gitEnv(root) {
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) {
    if (/^(GIT_CONFIG_(GLOBAL|SYSTEM|NOSYSTEM)|GIT_DIR|GIT_WORK_TREE|HOME|USERPROFILE)$/i.test(k)) delete env[k];
  }
  const cfg = path.join(os.tmpdir(), `git-domain-cfg-${process.pid}-${path.basename(root)}.txt`);
  fs.writeFileSync(cfg, '', 'utf8');
  env.GIT_CONFIG_GLOBAL = cfg;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = 'git-domain-test';
  env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = 't@example.invalid';
  env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = '2026-01-01T00:00:00 +0000';
  return { env, cfg };
}

function mkRoot() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `git-domain-${process.pid}-`));
  return fs.realpathSync(base);
}

function rmRf(p) {
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch (_) { /* 清理失败不得掩盖判定 */ }
}

/** 建一个真 git 仓：写文件 → 按需 add/commit → 返回 {root, env, cfg}。commit:false 用于"空仓库"夹具。 */
function repo({ ignore = '', files = {}, addAll = true, forceAdd = [], commit = true } = {}) {
  const root = mkRoot();
  const { env, cfg } = gitEnv(root);
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' 失败：' + (r.stderr || r.stdout));
    return r;
  };
  git(['init', '-q']);
  if (ignore) fs.writeFileSync(path.join(root, '.gitignore'), ignore, 'utf8');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  if (commit) {
    if (addAll) git(['add', '-A']);
    for (const rel of forceAdd) git(['add', '-f', '--', rel]);
    git(['commit', '-q', '-m', 'fixture']);
  }
  return { root, env, cfg, git };
}

function cleanup(f) { rmRf(f.root); rmRf(f.cfg); }

test('① 受管文件在域内，且键是相对 root 的正斜杠形态', () => {
  const f = repo({ files: { 'a.js': 'x\n', 'sub/b.js': 'y\n' } });
  try {
    const d = gitDomain(f.root);
    assert.ok(d.has('a.js'), '根级受管文件必须在域内');
    assert.ok(d.has('sub/b.js'), '子目录受管文件必须在域内（正斜杠，不带 ./ 前缀）');
    assert.ok(![...d].some((p) => p.includes('\\')), 'Windows 下也不得吐反斜杠');
    assert.ok(![...d].some((p) => path.isAbsolute(p)), '键必须是相对 root 的，不是绝对路径');
  } finally { cleanup(f); }
});

test('② 未跟踪且被 .gitignore 忽略的产物不在域内（这就是"本机构建过就红"的根因）', () => {
  const f = repo({ ignore: 'built/**/*.js\n', files: { 'src/keep.js': 'x\n' }, addAll: true });
  try {
    fs.mkdirSync(path.join(f.root, 'built'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'built', 'index.bundle.js'), 'y\n', 'utf8');
    const d = gitDomain(f.root);
    assert.ok(d.has('src/keep.js'));
    assert.ok(!d.has('built/index.bundle.js'), '磁盘上存在但既不受管又被忽略 ⇒ 不得入域');
  } finally { cleanup(f); }
});

test('③ 未跟踪但未被忽略的新文件仍在域内（不收窄成只看索引）', () => {
  const f = repo({ files: { 'a.js': 'x\n' } });
  try {
    fs.writeFileSync(path.join(f.root, 'new-debt.js'), 'z\n', 'utf8');
    const d = gitDomain(f.root);
    assert.ok(d.has('new-debt.js'), '未 git add 的新增债必须可见，否则门禁给"新增"让路');
  } finally { cleanup(f); }
});

test('④ 被跟踪但同时命中 .gitignore（历史 git add -f）仍在域内 —— 并集不是 check-ignore', () => {
  const f = repo({
    ignore: 'built/out.js\n',
    files: { 'built/out.js': 'x\n' },
    addAll: false,
    forceAdd: ['built/out.js']
  });
  try {
    const d = gitDomain(f.root);
    assert.ok(d.has('built/out.js'), '索引里有它就该被量；按 check-ignore 排除会让"被跟踪的产物"静默免检');
  } finally { cleanup(f); }
});

test('⑤ 非工作树目录必须抛错，不得静默返回空集合', () => {
  const root = mkRoot();
  try {
    fs.writeFileSync(path.join(root, 'loose.js'), 'x\n', 'utf8');
    assert.throws(() => gitDomain(root), /git/, '错误文案必须点名 git，否则排查者不知道是哪一层坏的');
  } finally { rmRf(root); }
});

test('⑥ 空仓库（git 报 0 个文件）必须抛错 —— 空域不等于"没有债"', () => {
  // 夹具必须是"真的空"：init 后不 add 不 commit（空仓提交不了，硬提交会让夹具自己变非空 —— #3876 踩过同格）
  const f = repo({ files: {}, commit: false });
  try {
    assert.throws(() => gitDomain(f.root), /0|空/, '必须点名"空域"这一判据自身故障形态');
  } finally { cleanup(f); }
});

test('⑦ 机器态能改域：env 是显式入参，两档 A/B 必须给出不同的域（否则"屏蔽机器态"这类断言无从验证）', () => {
  const f = repo({ files: { 'src/a.js': 'x\n' } });
  const sys = mkRoot();
  try {
    // ghost.js 必须是**未跟踪且未被本地 .gitignore 忽略**的文件：excludesFile 只作用于
    // `--others --exclude-standard` 这一半边，受管半边永远列得出来 —— 上一版把 ghost.js 提交了，
    // 于是"两档 A/B"退化成读同一份输出（M11 变异 0 红才暴露，见执行记录）。
    fs.writeFileSync(path.join(f.root, 'ghost.js'), 'y\n', 'utf8');
    // 造一份 system 档：全局忽略 ghost.js
    const ignoreFile = path.join(sys, 'system-ignore.txt');
    fs.writeFileSync(ignoreFile, 'ghost.js\n', 'utf8');
    const sysCfg = path.join(sys, 'gitconfig');
    fs.writeFileSync(sysCfg, '[core]\n\texcludesFile = ' + ignoreFile.replace(/\\/g, '/') + '\n', 'utf8');

    const withSystem = Object.assign({}, f.env, { GIT_CONFIG_SYSTEM: sysCfg });
    delete withSystem.GIT_CONFIG_NOSYSTEM; // 只"不覆盖"system 路径 —— 这正是 delete 挡不住的那一格
    const nosystem = Object.assign({}, withSystem, { GIT_CONFIG_NOSYSTEM: '1' });

    // ① 先证明这份 system 档**真的有能力**把文件藏出域（否则下面的对比是恒真的）
    const dirty = new Set(spawnSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: f.root, env: withSystem, encoding: 'utf8' })
      .stdout.split('\0').filter(Boolean));
    assert.ok(!dirty.has('ghost.js'), '前置失效：system 档没起作用，这一档测不到任何东西');
    // ② 判据本体如实继承调用方 env：带 system 档时它同样会缩（这是"域 == git status"的必然结果）
    const dSystem = gitDomain(f.root, { env: withSystem });
    assert.ok(!dSystem.has('ghost.js'), 'env 入参必须有牙：带 system 档时该文件应被藏出域');
    // ③ 同一棵树、同一份实现，只把 NOSYSTEM 置上就必须回到域内 —— 两档差额就是这条锁的测量对象
    const dClean = gitDomain(f.root, { env: nosystem });
    assert.ok(dClean.has('ghost.js'), '置 GIT_CONFIG_NOSYSTEM=1 后必须回到域内（唯一开关，delete 挡不住）');
    assert.ok(dSystem.size < dClean.size, '两档必须真的给出不同的域，否则 ②③ 都只是在读同一份输出');
  } finally { cleanup(f); rmRf(sys); }
});

test('⑧ 真实仓：域与 `git status` 口径一致（独立探针交叉量）', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const env = Object.assign({}, process.env);
  const probe = spawnSync('git', ['status', '--porcelain=v1', '-z', '-uall', '--no-renames'], { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(probe.status, 0, 'git status 探针必须可跑，否则这一格是探针失明不是判据通过');
  const statusUntracked = new Set(String(probe.stdout || '').split('\0').filter((rec) => rec.startsWith('?? ')).map((rec) => rec.slice(3)));
  const lsTracked = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(lsTracked.status, 0);
  const tracked = new Set(String(lsTracked.stdout || '').split('\0').filter(Boolean));

  const d = gitDomain(repoRoot);
  assert.ok(d.size > 5000, '真实仓规模下界（低于此数说明解析退化，不得据此出结论）：' + d.size);
  // 未跟踪半边由 status 独立验；受管半边与实现同命令，属同源，只能靠实现自己的语义锁（①–⑦）
  for (const p of statusUntracked) assert.ok(d.has(p), 'status 报的未跟踪文件必须出现在域内：' + p);
  for (const p of tracked) assert.ok(d.has(p), '索引里的文件必须出现在域内：' + p);
});

test('⑨ root 必传：缺参必须当场抛错，不得按"脚本所在目录"降级（同 #3853 的 fragileFor 口径）', () => {
  // 降级方向很诱人也更坏：把两个消费者各自隐式钉到"自己所在的仓库根"，
  // 于是 --root / 换树验证会静默变成"验证了本仓"，读数完全像通过。
  assert.throws(() => gitDomain(undefined), /必传/);
  assert.throws(() => gitDomain(''), /必传/);
});

test('⑪ root 必须是 git 报出的 toplevel：指到仓库子目录必须抛错（QM-6 后端轴 W1）', () => {
  // 真仓与夹具各测一档：只测一档时，"把比对改成只比长度"这类退化仍可能溜过去。
  const repoRoot = path.resolve(__dirname, '..', '..');
  assert.doesNotThrow(() => gitDomain(repoRoot), '仓库根本身必须通过（linked worktree 的 toplevel 就是它自己）');
  assert.throws(() => gitDomain(path.join(repoRoot, 'scripts')), /仓库根/, '指到子目录必须点名"root 必须是仓库根"');
  const f = repo({ files: { 'sub/x.js': 'a\n' } });
  try {
    assert.throws(() => gitDomain(path.join(f.root, 'sub')), /仓库根/);
    assert.doesNotThrow(() => gitDomain(f.root));
  } finally { cleanup(f); }
});

test('⑩ 消费者套件必须"整份真的跑了"：门禁若在 import 期 process.exit，node:test 会把整份文件报成 pass 1（本轮实测踩过）', () => {
  // 动因不是理论担忧：check-debt-budget.js 原实现在文件末尾无条件 main()，而 main() 会 process.exit(0)。
  // 于是第一版 `require('./check-debt-budget.js')` 直接杀掉测试进程，node:test 打印
  //   ✔ scripts\check-debt-budget.test.js   ℹ tests 1 / pass 1 / fail 0
  // —— 10 条用例一条都没跑，读数却完全像通过。这类"文件级假绿"只能由**汇总计数**抓到，
  // 所以这里按消费方视角交叉量一次：跑那个套件，要求 pass 恰等于它声明的用例数。
  const file = path.resolve(__dirname, '..', 'check-debt-budget.test.js');
  const src = fs.readFileSync(file, 'utf8');
  const declared = (src.match(/^test\(/gm) || []).length;
  assert.ok(declared >= 8, '消费者套件的用例数下界（读到 0 说明扫描本身坏了，不是"没用例"）：' + declared);
  // 子 runner 必须清掉继承的 runner 标记：node:test 会给 worker 进程注入 NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID，
  // 带着它们再 spawn `node --test` 会打印「run() is being called recursively … skipping running files」
  // 并以 **rc=0 + 零输出** 结束 —— 恰是"看起来跑了其实没跑"的形状（本轮实测）。
  const childEnv = Object.assign({}, process.env);
  for (const k of Object.keys(childEnv)) if (/^NODE_TEST_/i.test(k)) delete childEnv[k];
  const r = spawnSync(process.execPath, ['--test', path.relative(path.resolve(__dirname, '..', '..'), file)], {
    cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: childEnv,
  });
  // ⛔ 汇总行要先剥 \r 再按 ^…$ 匹配：Windows 上子进程输出是 CRLF，`/^(ℹ )?pass (\d+)$/m` 直接对上
  // 会恒不命中（$ 落在 \r 之前），于是解析出 NaN —— 看起来像"套件没跑"，实际是探针自己失明（本轮实测）。
  const out = (String(r.stdout || '') + String(r.stderr || '')).replace(/\r/g, '');
  const grab = (label) => {
    const m = out.match(new RegExp('(?:^|\\n)(?:ℹ|#) ' + label + ' (\\d+)', 'm'));
    if (!m) throw new Error('解析不到 ' + label + ' 行 —— 汇总格式变了必须同步改这条锁，不得当作 0。rc='
      + r.status + ' signal=' + r.signal + ' 输出尾部：\n' + out.slice(-600));
    return Number(m[1]);
  };
  const pass = grab('pass');
  const fail = grab('fail');
  const tests = grab('tests');
  console.log('[git-domain-suite-count] rc=' + r.status + ' tests=' + tests + ' pass=' + pass + ' fail=' + fail + ' declared=' + declared);
  assert.strictEqual(r.status, 0, '消费者套件必须整体通过，输出：\n' + out.slice(-800));
  assert.strictEqual(fail, 0, '消费者套件不得有失败');
  assert.strictEqual(tests, declared, '跑了几条 vs 声明几条必须相等 —— 不等就是"有文件/用例根本没执行"（本仓把这种状态叫装饰性门禁）');
  assert.strictEqual(pass, declared, 'pass 数必须等于声明数');
});
