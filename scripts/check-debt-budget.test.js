'use strict';
/**
 * check-debt-budget.test.js — 债务熔断门禁的扫描域回归锁
 *
 * 动因（与 #3876 同根因的第二处）：本门禁的两处 walk 一直按磁盘扫，而 `apps/desktop/electron/**.bundle.js`
 * 这类构建产物既落在 SCAN_DIRS 内、又被 .gitignore 忽略 —— 本机跑过 build 就比 CI 多数个文件
 * 三个读数的归属见 check-debt-budget.js 文件头：95=git 域=CI，96=同树 A/B 造出一个被忽略产物，97=#80 那次带两个产物。这不是"本机更严"，
 * 是拿磁盘域去比一份按 CI 检出立的账 —— 同一条 #3782 漏改，只是被聚合口径吞掉了。
 *
 * 锁的两类：
 *  ① 行为锁：域过滤生效（gitignored 产物不计入 / 未跟踪未忽略的新文件计入 / 非工作树 fail closed）
 *  ② 防漂移锁：三个模块用的是**同一个函数对象**（函数身份比较，不是"源码里有没有 require"那种
 *     记录性断言 —— 后者会随改名/包装漂移，且测不出"又抄了一份"）
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const B = require('./check-debt-budget.js');
const SHARED = require('./lib/git-domain.js');

const ROOT = path.resolve(__dirname, '..');

function bigLines(n) {
  const parts = [];
  for (let i = 1; i <= n; i++) parts.push('line ' + i);
  return parts.join('\n') + '\n';
}

function mkRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `debt-budget-${process.pid}-`));
  const root = fs.realpathSync(base);
  const cfg = path.join(os.tmpdir(), `debt-budget-cfg-${process.pid}-${path.basename(base)}.txt`);
  fs.writeFileSync(cfg, '', 'utf8');
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) {
    if (/^(GIT_CONFIG_(GLOBAL|SYSTEM|NOSYSTEM)|GIT_DIR|GIT_WORK_TREE)$/i.test(k)) delete env[k];
  }
  env.GIT_CONFIG_GLOBAL = cfg;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = 'debt-budget-test';
  env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = 't@example.invalid';
  env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = '2026-01-01T00:00:00 +0000';
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + '：' + (r.stderr || r.stdout));
    return r;
  };
  git(['init', '-q', '--initial-branch=main']);
  return { root, cfg, env, git };
}

function cleanup(f) {
  try { fs.rmSync(f.root, { recursive: true, force: true, maxRetries: 3 }); } catch (_) { /* 清理失败不得掩盖判定 */ }
  try { fs.rmSync(f.cfg, { force: true }); } catch (_) { /* 同上 */ }
}

/** 写一个受管大文件 + 一个被忽略的大产物 + 一个未跟踪未忽略的大文件 */
function fixture(f) {
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'apps/desktop/electron/generated.bundle.js\n', 'utf8');
  fs.mkdirSync(path.join(f.root, 'apps/desktop/electron'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'apps/desktop/electron/tracked-big.js'), bigLines(600), 'utf8');
  // 构建产物：磁盘上存在、被忽略、600 行 —— 磁盘域会把它算进去，就是本次要修的假红本体
  fs.writeFileSync(path.join(f.root, 'apps/desktop/electron/generated.bundle.js'), bigLines(650), 'utf8');
  // 未 add 但未被忽略：新增债必须仍然可见
  fs.writeFileSync(path.join(f.root, 'apps/desktop/electron/untracked-big.js'), bigLines(700), 'utf8');
  f.git(['add', '-A']);
  f.git(['commit', '-q', '-m', 'fixture']);
  // commit 之后再落产物与新文件（前者被忽略、后者未跟踪）
  fs.writeFileSync(path.join(f.root, 'apps/desktop/electron/generated.bundle.js'), bigLines(650), 'utf8');
  fs.writeFileSync(path.join(f.root, 'apps/desktop/electron/untracked-big.js'), bigLines(700), 'utf8');
}

test('结构前提：门禁把可注入 root 的取数函数与取域函数一起导出（否则测试只能跑真仓）', () => {
  assert.strictEqual(typeof B.collectMetrics, 'function', '必须导出 collectMetrics(root)');
  assert.strictEqual(typeof B.gitDomain, 'function', '必须导出它实际使用的取域函数，供身份比较');
});

test('gitignored 的构建产物不得计入 filesOver500（本机构建过就比 CI 多数的假红本体）', () => {
  const f = mkRepo();
  try {
    fixture(f);
    const m = B.collectMetrics(f.root, { env: f.env });
    assert.ok(m.filesOver500 >= 2, '受管大文件 + 未跟踪大文件都该计入，实得 ' + m.filesOver500);
    assert.ok(!m.filesOver500Paths.includes('apps/desktop/electron/generated.bundle.js'),
      '被忽略的产物不得进计数（它既不受管又被 .gitignore 排除）');
  } finally { cleanup(f); }
});

test('夹具必须有牙：那条产物确实在磁盘上、确实 ≥500 行、确实被忽略（否则上一条是探针失明不是判据通过）', () => {
  const f = mkRepo();
  try {
    fixture(f);
    const abs = path.join(f.root, 'apps/desktop/electron/generated.bundle.js');
    assert.ok(fs.existsSync(abs), '产物必须在磁盘上存在');
    assert.ok(fs.readFileSync(abs, 'utf8').split('\n').length > 500, '产物必须真的超 500 行');
    const ci = spawnSync('git', ['check-ignore', '-q', '--', 'apps/desktop/electron/generated.bundle.js'], { cwd: f.root, env: f.env });
    assert.strictEqual(ci.status, 0, '产物必须真的被 .gitignore 命中（git check-ignore rc=0）');
    // 反向自证：按"域"判据它不在域内，而按磁盘它在盘上 —— 两者必须能区分开
    assert.ok(!B.gitDomain(f.root).has('apps/desktop/electron/generated.bundle.js'));
  } finally { cleanup(f); }
});

test('未跟踪但未忽略的新文件必须计入（不收窄成只看索引）', () => {
  const f = mkRepo();
  try {
    fixture(f);
    const m = B.collectMetrics(f.root, { env: f.env });
    assert.ok(m.filesOver500Paths.includes('apps/desktop/electron/untracked-big.js'),
      '未 git add 的新增债必须可见，否则门禁给"新增"让路');
  } finally { cleanup(f); }
});

test('非工作树目录必须 fail closed：抛错，不得静默退回磁盘扫', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `debt-budget-bare-${process.pid}-`)));
  try {
    fs.mkdirSync(path.join(base, 'apps/desktop/electron'), { recursive: true });
    fs.writeFileSync(path.join(base, 'apps/desktop/electron/big.js'), bigLines(600), 'utf8');
    assert.throws(() => B.collectMetrics(base), /git/, '错误文案必须点名 git');
  } finally {
    try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }); } catch (_) { /* 同上 */ }
  }
});

test('防漂移：门禁与 #3876 的行数门禁共用同一个函数对象（函数身份，不是"源码里出现过 require"）', () => {
  const M = require('../.github/scripts/check-max-lines.js');
  assert.strictEqual(B.gitDomain, SHARED.gitDomain, 'check-debt-budget 必须用共享实现，不得另抄一份');
  assert.strictEqual(M.gitDomain, SHARED.gitDomain, 'check-max-lines 必须用共享实现，不得另抄一份');
});

test('第二处 walk 同一把域：互相 require 的**被忽略**生成物不得进依赖图（循环依赖指标也被磁盘域污染过）', () => {
  const f = mkRepo();
  try {
    fixture(f);
    // 两个被忽略的 bundle 互相 require —— 磁盘域会把它们收进图并报出环，CI 的检出里没有这两个文件
    fs.writeFileSync(path.join(f.root, 'apps/desktop/electron/a.bundle.js'),
      "require('./b.bundle.js');\n", 'utf8');
    fs.writeFileSync(path.join(f.root, 'apps/desktop/electron/b.bundle.js'),
      "require('./a.bundle.js');\n", 'utf8');
    fs.appendFileSync(path.join(f.root, '.gitignore'), '*.bundle.js\n', 'utf8');
    const m = B.collectMetrics(f.root, { env: f.env });
    assert.strictEqual(m.circularDeps, 0, '被忽略的生成物不得参与循环依赖判定，实得 ' + m.circularDeps
      + ' cycles=' + JSON.stringify(m.circularDepDetails));
    // 牙：同一对文件若改成"未忽略的受管源文件"，就必须报出环 —— 否则上面那条 0 是判据没跑起来
    fs.writeFileSync(path.join(f.root, 'apps/desktop/electron/a.js'), "require('./b.js');\n", 'utf8');
    fs.writeFileSync(path.join(f.root, 'apps/desktop/electron/b.js'), "require('./a.js');\n", 'utf8');
    f.git(['add', '-A']);
    f.git(['commit', '-q', '-m', 'cycle']);
    const m2 = B.collectMetrics(f.root, { env: f.env });
    assert.ok(m2.circularDeps >= 1, '正向对照失效：真环没被报出来，说明上一处的 0 不构成证据');
  } finally { cleanup(f); }
});

test('真仓：取域必须给得出读数（规模下界，防止解析退化成空集合还被当作通过）', () => {
  const d = B.gitDomain(ROOT);
  assert.ok(d.size > 5000, '真仓域规模下界，实得 ' + d.size);
});

/** CLI 分档必须用真子进程量 —— 退出码是这条门禁唯一的对外契约，而 rc 经管道会被 head/tail 吃掉。 */
function runCli(args) {
  const r = spawnSync(process.execPath, [path.join('scripts', 'check-debt-budget.js'), ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { rc: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

test('CLI 真仓档：rc=0 且必须打印 domain=（现场留痕，不是只在内存里算了个数）', () => {
  const r = runCli([]);
  assert.strictEqual(r.rc, 0, '真仓默认档必须通过，实得 rc=' + r.rc + '\n' + r.out.slice(0, 400));
  assert.match(r.out, /\[debt-budget\] domain=\d+ /, '留痕行必须给出域大小');
  assert.match(r.out, /filesOver500: \d+/, '计数指标必须照旧打印');
});

test('CLI 分档：取不到 git 读数 ⇒ 退出码 2，且不得与「指标超基线」的 1 混档', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `debt-budget-nonrepo-${process.pid}-`)));
  const r = runCli(['--root', dir]);
  assert.strictEqual(r.rc, 2, '非工作树必须 rc=2（1 留给"确实超基线"），实得 ' + r.rc);
  assert.match(r.out, /无法从 git 取得扫描域/, '错误必须点名是哪一层坏的');
  assert.ok(!/无法从 git 取得扫描域：.*无法从 git 取得扫描域/.test(r.out), '同一句话不得出现两遍（包装层重复拼前缀的实测形态）');
});

test('CLI：--root 缺值必须 rc=2 出声，不得静默按本仓跑（那会让"换棵树验证"变成没换）', () => {
  const r = runCli(['--root']);
  assert.strictEqual(r.rc, 2, '实得 rc=' + r.rc);
  assert.match(r.out, /--root/);
});

test('CLI：--root 指到仓库子目录必须 rc=2，不许"全零通过"（QM-6 后端轴 W1 的实测形态）', () => {
  const r = runCli(['--root', 'scripts']);
  assert.strictEqual(r.rc, 2, '子目录必须被拒，实得 rc=' + r.rc + '\n' + r.out.slice(0, 300));
  assert.match(r.out, /仓库根/, '文案必须点名是"root 不是仓库根"这一格');
  assert.ok(!/filesOver500: 0/.test(r.out), '绝不允许出现"指标全零 + 通过"的读数');
});

test('判定层：check() 在"现场 > 基线"时逐指标产出违规并把 pass 置 false（rc=1 那一档的唯一来源）', () => {
  const baseline = { maxFileLines: 100, maxFilePath: 'a.js', filesOver1000: 1, filesOver500: 2,
    modelProviderLines: 10, modelProviderRequireFanOut: 3, circularDeps: 0 };
  const current = { maxFileLines: 101, maxFilePath: 'b.js', filesOver1000: 2, filesOver500: 3,
    modelProviderLines: 11, modelProviderRequireFanOut: 4, circularDeps: 1, circularDepDetails: [['x', 'y']] };
  const { violations, results } = B.check(baseline, current);
  for (const tag of ['MAX_FILE_LINES', 'FILES_OVER_1000', 'FILES_OVER_500', 'MODEL_PROVIDER_FAN_OUT', 'CIRCULAR_DEPS']) {
    assert.ok(violations.some((v) => v.includes(tag)), '缺 ' + tag + ' 的违规项：' + JSON.stringify(violations));
  }
  assert.ok(results.every((r) => r.pass === false), '五项都必须置红：' + JSON.stringify(results.map((r) => [r.metric, r.pass])));
  // 正控：现场==基线必须全绿 —— 没有它，一个"恒红"的 check() 也能通过上面的断言
  const same = B.check(baseline, Object.assign({}, baseline, { circularDepDetails: [] }));
  assert.deepStrictEqual(same.violations, [], '现场==基线不得报违规：' + JSON.stringify(same.violations));
  assert.ok(same.results.every((r) => r.pass === true));
});

test('基线形状不许变：toPersisted 的键集必须逐字等于受管 debt-baseline.json 的键集', () => {
  const tracked = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'debt-baseline.json'), 'utf8')));
  const metrics = { scannedAt: 'x', maxFileLines: 1, maxFilePath: 'a', filesOver1000: 0, filesOver500: 0,
    filesOver500Paths: ['a'], filesOver1000Paths: [], domainSize: 9, modelProviderLines: 1,
    modelProviderRequireFanOut: 1, circularDeps: 0, circularDepDetails: [] };
  const persisted = Object.keys(B.toPersisted(metrics));
  assert.deepStrictEqual(persisted, tracked, '基线形状漂移：现场字段被写进受管账本，或漏写了既有键');
  assert.ok(!persisted.includes('domainSize') && !persisted.includes('filesOver500Paths'),
    '当场读数进账本就会变成"基线"（#3876 同型），必须只留在现场输出里');
});

test('第三处取数也必须吃同一把域：model-provider-manager 在磁盘存在但被忽略时扇出不得贡献（后端轴 I3）', () => {
  const f = mkRepo();
  try {
    fixture(f);
    const rel = 'apps/desktop/electron/services/model-provider-manager.js';
    fs.mkdirSync(path.join(f.root, 'apps/desktop/electron/services'), { recursive: true });
    fs.appendFileSync(path.join(f.root, '.gitignore'), rel + '\n', 'utf8');
    fs.writeFileSync(path.join(f.root, rel), "const a = require('./a');\nconst b = require('./b');\n", 'utf8');
    // A 档：磁盘上存在、被忽略 ⇒ 该项不得贡献扇出数（改前它走 existsSync，与域无关）
    const ignored = B.collectMetrics(f.root, { env: f.env });
    assert.strictEqual(ignored.modelProviderRequireFanOut, 0, '被忽略的单文件仍贡献扇出数 ⇒ 第三处取数没吃域');
    // 正控（同一把域的另一半）：把同一份内容 git add -f 成「被跟踪且命中忽略」，扇出必须被数到
    // —— 语义 ④：被跟踪就该被量。没有这一档，上面那个 0 可能是探针失明而不是判据通过
    f.git(['add', '-f', '--', rel]);
    f.git(['commit', '-q', '-m', 'track the ignored artifact']);
    const tracked = B.collectMetrics(f.root, { env: f.env });
    assert.strictEqual(tracked.modelProviderRequireFanOut, 2, '被跟踪但命中忽略时必须仍被量（并集不是 check-ignore）');
  } finally { cleanup(f); }
});
