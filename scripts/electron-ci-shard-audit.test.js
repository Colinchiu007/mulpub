/**
 * `scripts/electron-ci-shard-audit.js` 的回归锁。
 *
 * 这个审计本体存在的唯一理由：`STEP_BUDGET_PROVENANCE` 里的数字必须**有东西能重取**，
 * 否则"量过一次之后没人再量"就是注释里的愿望（本仓对 *_PROVENANCE 的三条口径：常量旁给出处、
 * 每次真跑留痕、复测入口落在仓库里且输出字段与 provenance 逐字段对齐）。
 * 因此这里最硬的一条是「字段对齐」与「零样本不得读成通过」——
 * 后者是"探针失明"的入口：审计取不到数时若返回 0，下一个会话会把"没量到"读成"预算没问题"。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = require('./electron-ci-shard-audit.js');
const step = require('./electron-ci-desktop-step.js');
const REPO = path.resolve(__dirname, '..');

const P = step.STEP_BUDGET_PROVENANCE;

test('清单：FIELDS 只能由人改，且 provenance 的两个口径字段必须出现在审计输出里', () => {
  assert.deepEqual(audit.FIELDS, ['runs', 'shards', 'minShardMin', 'p50ShardMin', 'maxShardMin',
    'budgetFloorSec', 'stepBudgetSec', 'safetyMultiplier', 'collectedAt', 'source'],
    '输出字段清单被改动 ⇒ 同步核对 STEP_BUDGET_PROVENANCE 是否还能逐字段对上');
  const s = audit.summarize([10], 'x', 1);
  // 「逐字段对齐」的具体含义：审计报出的 safetyMultiplier / collectedAt **就是** provenance 里那两个值。
  // 只写"输出里有个叫 safetyMultiplier 的键"是不够的——键在值错照样骗人。
  assert.equal(s.safetyMultiplier, P.safetyMultiplier);
  assert.equal(s.collectedAt, P.collectedAt);
  assert.equal(s.stepBudgetSec, Math.round(step.STEP_BUDGET_MS / 1000));
});

test('当前仓内读数必须支持当前预算：budget ≥ max × 倍数，且贴脸单独成档不被放行', () => {
  const floor = Math.round(P.maxObservedShardMin * 60 * P.safetyMultiplier);
  const budget = Math.round(step.STEP_BUDGET_MS / 1000);
  assert.ok(budget >= floor, '预算低于实测地板 ⇒ 改形状或重测，不得放宽本判据（floor=' + floor + ' budget=' + budget + '）');
  assert.ok(budget >= floor * 1.1, '贴脸（余量 <10%）单独判 HUGGING，不得混进 OK');
  assert.ok(budget > P.maxObservedShardMin * 60, '预算必须大于观测最大值本身');
});

test('逐片墙钟的锚必须只认新形状：带时间戳与 ANSI 前缀的真实行取得到，旧形状行取不到', () => {
  const ESC = String.fromCharCode(27);
  const real = '2026-10-21T07:52:30.4123456Z ' + ESC + '[32m[electron-ci-step] shard=--shard=1/2 '
    + 'verdict=ok elapsed=1500000ms completed=9000 summary=2' + ESC + '[39m\n';
  const got = audit.parseShardElapsed(real);
  assert.equal(got.length, 1, 'Actions 日志每行带时间戳前缀，不剥就恒不命中（本仓踩过的同型失明）');
  assert.equal(got[0].elapsedMs, 1500000);
  assert.equal(got[0].shard, '--shard=1/2');
  // 负控：旧形状（没有 elapsed= 的自证行）必须取不到，否则这条锚测的是"任何像日志的东西"
  assert.equal(audit.parseShardElapsed('2026-10-21T07:52:30Z [electron-ci-timeout-budget] elapsed=2100s budget=2100s rc=124\n').length, 0);
  assert.equal(audit.parseShardElapsed('').length, 0);
});

test('锚必须解析得动 runStep **真打印**的那一行（生产者↔消费者同一条缝，不能各写一份形状）', async () => {
  // 手写夹具会跟着判据一起写错（两边同形 ⇒ 永远绿）。这里把被测模块的 report 原文喂给锚。
  const spawnImpl = (argv) => ({
    shard: argv.find((a) => /^--shard=/.test(a)),
    done: Promise.resolve({ rc: 0, stdout: ' ✓ a > b 1ms\n Tests 1 passed\n', stderr: '' }),
  });
  const res = await step.runStep({
    spawnImpl, budgetMs: 5000,
    now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  const got = audit.parseShardElapsed(res.report);
  assert.equal(got.length, 2, 'report 里有两行逐片读数，锚必须各取到一条。report=' + JSON.stringify(String(res.report).split(/\r?\n/)));
  assert.deepEqual(got.map((g) => g.shard).sort(), ['--shard=1/2', '--shard=2/2']);
  for (const g of got) assert.ok(Number.isFinite(g.elapsedMs), 'elapsedMs 必须是数：' + JSON.stringify(g));
  // 且这些样本喂回 summarize 后必须产出真实读数（不是 NaN 档）
  const s = audit.summarize(got.map((g) => g.elapsedMs / 60000), 'new-shape', 1);
  assert.equal(s.shards, 2);
  assert.ok(['OK', 'HUGGING', 'BELOW_FLOOR'].indexOf(s.verdict) >= 0, '有样本时不得报 NO_SAMPLES：' + s.verdict);
});

test('采样两档不得混记：新形状有样本时一次都不查 legacy；legacy 必须自报"下界"', () => {
  let legacyQueried = 0;
  // 夹具改注入 spawnImpl（而不是整份取数面）：这样重试、退避上限、非法值校验与 JSON.parse
  // 都真的跑一遍——注入 api 的那条路曾在 collect 里旁通一切（外部评审 r2-i7）。
  const okJson = (v) => ({ status: 0, stdout: JSON.stringify(v), stderr: '' });
  const okText = (t) => ({ status: 0, stdout: t, stderr: '' });
  const SHARD_LOG = '[electron-ci-step] shard=--shard=1/2 verdict=ok elapsed=1200000ms completed=1 summary=1\n';
  const spawnImpl = (cmd, args) => {
    if (String(args[1]).indexOf('/logs') >= 0) return okText(SHARD_LOG);
    if (args[0] === 'run' && String(args[2]).indexOf('electron-ci.yml') >= 0) return okJson([{ databaseId: 1, status: 'completed' }]);
    if (args[0] === 'run') { legacyQueried++; return okJson([]); }
    return okJson({ jobs: [{ id: 9, name: 'electron-tests', conclusion: 'success' }] });
  };
  const s = audit.collect({ runs: 2, spawnImpl, notice: () => {} });
  assert.equal(s.shards, 1);
  assert.equal(legacyQueried, 0, '新形状已有逐片实测时退回 legacy 会把"每片独占 runner"的下界当现场');
  assert.match(String(s.source), /new-shape/);

  const spawnImpl2 = (cmd, args) => {
    if (String(args[1]).indexOf('/logs') >= 0) return okText('本趟没有新形状自证行\n');
    if (args[0] === 'run' && String(args[2]).indexOf('electron-ci.yml') >= 0) return okJson([{ databaseId: 1, status: 'completed' }]);
    if (args[0] === 'run') return okJson([{ databaseId: 7, status: 'completed' }]);
    if (String(args[1]).indexOf('runs/1/') >= 0) return okJson({ jobs: [{ id: 9, name: 'electron-tests', conclusion: 'success' }] });
    return okJson({ jobs: [{ name: 'QG Desktop Shards (1/2)', conclusion: 'success',
      started_at: '2026-10-21T00:00:00Z', completed_at: '2026-10-21T00:20:00Z' }] });
  };
  const s2 = audit.collect({ runs: 2, spawnImpl: spawnImpl2, notice: () => {} });
  assert.match(String(s2.source), /legacy/);
  assert.match(String(s2.source), /下界|不含争用/, 'legacy 档必须自己说明它是下界，否则会被读成实测争用值');
});

test('runs 是趟数而不是不同耗时值的个数（14 片 7 趟不得读成 14 趟）', () => {
  const s = audit.summarize([11.2, 11.2, 23.2, 23.2], 'x', 7);
  assert.equal(s.runs, 7);
  assert.equal(s.shards, 4);
  assert.equal(s.maxShardMin, 23.2);
});

test('verdict 四档各自可分辨：NO_SAMPLES / BELOW_FLOOR / HUGGING / OK', () => {
  const budgetSec = Math.round(step.STEP_BUDGET_MS / 1000);
  // 由预算反推"让 floor 落在哪"的 max（分钟）：floor = max*60*safetyMultiplier
  const maxFor = (ratio) => budgetSec / (60 * P.safetyMultiplier) * ratio;
  assert.equal(audit.summarize([maxFor(0.8)], 'x', 1).verdict, 'OK', '余量 ≥10%');
  assert.equal(audit.summarize([maxFor(1.0)], 'x', 1).verdict, 'HUGGING', '贴脸单独成档：这是"该重测/该抬"的事前证据，不是通过');
  assert.equal(audit.summarize([maxFor(1.5)], 'x', 1).verdict, 'BELOW_FLOOR', '低于地板必须单独成档，修法与贴脸不同');
  assert.equal(audit.summarize([], 'x', 0).verdict, 'NO_SAMPLES');
});

test('三档退出码各自可达：零样本与自身故障都是非零，不得把"没量到"读成"预算没问题"', () => {
  const sink = () => true;
  // ① 零样本 ⇒ 2 且出声
  const z = [];
  assert.equal(audit.main(['--runs=1'], { collectImpl: () => audit.summarize([], 'none', 0), write: (s) => z.push(String(s)) }), 2);
  assert.ok(z.some((l) => l.includes('NO_SAMPLES')), '零样本必须出声，不能只留一个数');
  // ② 采集自身抛错 ⇒ 2 且点名 SELF_FAULT（把工具的失败读成"没有欠账"是本仓的同型事故）
  const e = [];
  assert.equal(audit.main(['--runs=1'], { collectImpl: () => { throw new Error('GH_FAILED x'); }, write: (s) => e.push(String(s)) }), 2);
  assert.ok(e.some((l) => l.includes('SELF_FAULT')));
  // ③ 读数不支持预算 ⇒ 1，且文案禁止"放宽判据"
  const h = [];
  const budgetMin = step.STEP_BUDGET_MS / 60000;
  const hugMax = budgetMin / P.safetyMultiplier; // max*1.5 恰好等于预算 ⇒ 余量 0% ⇒ HUGGING
  assert.equal(audit.main(['--runs=1'], { collectImpl: () => audit.summarize([hugMax], 'x', 1), write: (s) => h.push(String(s)) }), 1);
  assert.ok(h.some((l) => l.includes('HUGGING')));
  assert.ok(h.some((l) => l.includes('不得') && l.includes('放宽判据')));
  // ④ 未知旗标必须抛（静默忽略会把"只跑 N 趟的 smoke"放大成整域）
  assert.throws(() => audit.parseArgs(['--limitt=3']), /未知参数/);
  assert.throws(() => audit.parseArgs(['--runs=abc']), /未知参数/);
  assert.deepEqual(audit.parseArgs(['--runs=4']), { runs: 4 });
  assert.deepEqual(audit.parseArgs(['--limit=4']), { runs: 4 });
});

test('接线：审计的回归锁必须点名在 changes job，且本体必须有 .gitignore 反选', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'quality-gate.yml'), 'utf8');
  assert.ok(wf.includes('node --test scripts/electron-ci-shard-audit.test.js'),
    '未接线的判据等于没写（本仓无自动收集，逐条显式点名）');
  const gi = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert.ok(gi.includes('!scripts/electron-ci-shard-audit.js'),
    '第 106 行 scripts/*.js 会把本体静默忽略 ⇒ 本地全绿、CI 上 Cannot find module');
  // 反选必须写成 gitignore 的 negation 模式（`!` 开头），**注释必须用 #**：
  // 把注释写成 `! 说明文字` 会得到三条永远匹配不到任何东西的坏模式（本 PR 实测踩过并修正）。
  const bangCommentLines = gi.split(/\r?\n/).filter((l) => /^! /.test(l));
  assert.deepEqual(bangCommentLines, [], '.gitignore 里 `!` 是 negation 不是注释，`! ` 开头的行是坏模式');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-22（任务 #94）：重测入口对瞬时网络故障零重试 ⇒ 实测 5 次才成功 1 次。
// 一条 `gh` 调用连吃 4 次 SELF_FAULT（rc=2），断点在 `run list` 与 `jobs/<id>/logs`
// 之间飘移，签名全是传输层强断。先加分类器，再把重试落在 collect 真正走的那条路上
// （只导出一个没人调用的工具函数 = 装饰性锁）。
//
// ⛔ 反向要求同样硬：把「判据不成立」也重试一遍 = 藏红。404 / 未知旗标 / GH011 /
// JSON 解析失败 都是**永远不会因为重试而变好**的失败，必须一次就抛。
test('瞬时故障分类 · 连接被强断 / EOF 判瞬时（签名取自本机 2026-10-22 现场读数，不是编的）', () => {
  const { isTransientGhFailure } = audit;
  assert.equal(isTransientGhFailure(
    'GH_FAILED run list --workflow=electron-ci.yml :: Get https://api.github.com/repos/o/r/actions/workflows/electron-ci.yml: read tcp 192.168.6.204:58314->198.18.0.241:443: wsarecv: An existing connection was forcibly closed by the remote host.'),
    true, 'wsarecv 强断是本轮真实打挂采集的那一条');
  assert.equal(isTransientGhFailure(
    'GH_FAILED api repos/o/r/actions/jobs/119169154201/logs --allow-escape-sequences :: Get https://productionresultssa1.blob.core.windows.net/x: unexpected EOF'),
    true, 'blob 主机 EOF 也是传输层');
});

test('瞬时故障分类 · 服务端 5xx 与超时判瞬时', () => {
  const { isTransientGhFailure } = audit;
  assert.equal(isTransientGhFailure('gh: Server Error (HTTP 502)'), true);
  assert.equal(isTransientGhFailure('GH_SPAWN_FAILED spawnSync gh ETIMEDOUT'), true);
});

test('瞬时故障分类 · 判据类失败一律不得判瞬时（重试它们就是把红藏起来）', () => {
  const { isTransientGhFailure } = audit;
  const permanent = [
    'GH_FAILED api repos/o/r/actions/runs/1/jobs :: gh: Not Found (HTTP 404)',
    'GH_SPAWN_FAILED spawnSync gh ENOENT',
    'unknown flag: --repo',
    'GH011: Repository rule violations found for refs/heads/main',
    'Unexpected token < in JSON at position 0',
    'no checks reported on the branch',
  ];
  for (const msg of permanent) {
    assert.equal(isTransientGhFailure(msg), false,
      '把永远不会变的失败读成瞬时 ⇒ 反复重试同一个错误: ' + msg);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 上面三把锁只证明分类器存在。分类器不被 collect 调用 = 装饰性门禁（本仓记过的同型），
// 所以这三条一律**注入 gh 的 spawn 后端**、经真实 `collect()` 路径驱动，
// 不断言"源码里出现过 withTransientRetry 这个单词"。
test('重试落在 collect 真走的路上：瞬时故障抖两次后第三次成功 ⇒ 仍采到逐片样本并出声每次重试', () => {
  const calls = []
  const notices = []
  // 与真 spawnSync 同形的结果对象（Node 实测：超时 error.code=ETIMEDOUT + status=null + signal；
  // 这里模拟的是"进程起来了但 gh 自己因 TLS 强断非零退出"，stderr 带现场签名）
  const transient = (n) => ({ status: 1, stdout: '', error: undefined,
    stderr: 'Get https://api.github.com/x: read tcp 1.2.3.4:1->198.18.0.241:443: wsarecv: An existing connection was forcibly closed by the remote host. (第 ' + n + ' 次)' })
  const okRunList = () => ({ status: 0, stderr: '', error: undefined, stdout: JSON.stringify([{ databaseId: 1, status: 'completed' }]) })
  const okJobs = () => ({ status: 0, stderr: '', error: undefined, stdout: JSON.stringify({ jobs: [{ name: 'electron-tests', id: 7 }] }) })
  const okLogs = () => ({ status: 0, stderr: '', error: undefined,
    stdout: '[electron-ci-step] shard=--shard=1/2 verdict=ok elapsed=1320000ms completed=1 summary=1 共享预算=2700000ms\n' })

  function spawnImpl (cmd, args) {
    calls.push(args.join(' '))
    if (calls.length <= 2) return transient(calls.length)
    if (args[0] === 'run') return okRunList()
    // 顺序要紧：作业日志端点 `.../actions/jobs/<id>/logs` 里也含 `/jobs`，
    // 先判 /jobs 会把 logs 那一次派发成 jobs ⇒ 采到 0 片，红的看着像实现没做。
    if (args[1].indexOf('/logs') > 0) return okLogs() // 端点路径在 args[1]；args[2] 是 --allow-escape-sequences
    if (args[0] === 'api') return okJobs() // 索引要紧：gh api 的 args[0] 才是 'api'，args[1] 是端点路径
    return okLogs()
  }

  const s = audit.collect({
    runs: 1,
    spawnImpl,
    sleepImpl: () => {},          // 测试里不真等；退避时长由下一条锁单独管
    notice: (line) => notices.push(line),
  })
  assert.equal(s.shards, 1, '抖两次之后应当采到那一片')
  assert.equal(s.samples[0], 22, '1320000ms = 22 分钟')
  assert.ok(notices.some((n) => /attempt=2/.test(n)), '每次重试必须出声（不打印attempt就无法区分"慢"与"坏"）：' + JSON.stringify(notices))
  assert.equal(calls.length, 5, '前 2 次瞬时失败 + run list / jobs / logs 各一次 = 5 次调用')
});

test('判据类失败只试一次：HTTP 404 不得被重试洗成"多跑几次就绿了"', () => {
  let calls = 0
  const spawnImpl = () => {
    calls++
    return { status: 1, stdout: '', error: undefined, stderr: 'gh: Not Found (HTTP 404)' }
  }
  assert.throws(() => audit.collect({ runs: 1, spawnImpl, sleepImpl: () => {}, notice: () => {} }),
    (e) => /GH_FAILED/.test(e.message), '不可重试的失败必须原样抛，而不是静默换一档')
  assert.equal(calls, 1, '404 重试 ' + calls + ' 次 ⇒ 把一个稳定的判据故障洗成概率事件')
});

test('重试必须有界：一直抖也要停下来抛，且把试了几次写进文案', () => {
  let calls = 0
  const spawnImpl = () => {
    calls++
    return { status: 1, stdout: '', error: undefined, stderr: 'unexpected EOF' }
  }
  assert.throws(() => audit.collect({ runs: 1, spawnImpl, sleepImpl: () => {}, notice: () => {} }),
    (e) => /attempts=\d+/.test(e.message) && /EOF/.test(e.message),
    '耗尽重试后必须既抛又带上试过的次数（"试了但还是坏"与"一次就坏"是两种归因）')
  assert.equal(calls, audit.GH_RETRY_ATTEMPTS_DEFAULT, '调用次数必须等于登记的预算，不得无限重试')
});

// 这两条覆盖"已经实现但还没被前面几条跑到"的分支：env/参数覆盖与非法值回落。
// 它们写完就是绿的（行为已在 RED 压力下实现），所以**必须靠变异证明有牙**
// （M6 放行 timeout=0 那类形态：把 resolvePositiveInt 的 `n < 1` 改成 `n < 0` 必须红）。
test('重试预算可被覆盖以便排障，但非法值必须回落默认并出声（0 等于关掉重试）', () => {
  const notices = []
  const { resolvePositiveInt, GH_RETRY_ATTEMPTS_DEFAULT, GH_RETRY_BASE_MS_DEFAULT } = audit
  assert.equal(resolvePositiveInt(undefined, GH_RETRY_ATTEMPTS_DEFAULT, 'X', () => {}), GH_RETRY_ATTEMPTS_DEFAULT)
  assert.equal(resolvePositiveInt('7', GH_RETRY_ATTEMPTS_DEFAULT, 'X', (m) => notices.push(m)), 7, '合法覆盖必须生效，否则 env 是摆设')
  assert.equal(resolvePositiveInt('0', GH_RETRY_ATTEMPTS_DEFAULT, 'X', (m) => notices.push(m)), GH_RETRY_ATTEMPTS_DEFAULT,
    '0 = 一次都不试，读起来却像"按配置跑了"')
  assert.equal(resolvePositiveInt('abc', GH_RETRY_BASE_MS_DEFAULT, 'X', (m) => notices.push(m)), GH_RETRY_BASE_MS_DEFAULT,
    'NaN 会让 for 循环整条失效 ⇒ 永不重试也永不报错')
  assert.equal(resolvePositiveInt('-2', GH_RETRY_ATTEMPTS_DEFAULT, 'X', (m) => notices.push(m)), GH_RETRY_ATTEMPTS_DEFAULT)
  assert.ok(notices.length >= 3, '三档非法各要一条告警，实测 ' + notices.length + ' 条 ⇒ 静默回落就是把配置失效藏起来')
  assert.ok(notices.every((m) => /非法/.test(m)), '告警文案要写明"非法"和回落值：' + JSON.stringify(notices))
});

test('attempts 是接进 collect 的活参数，不是只存在于常量里（collect 必须按它自己收到的值试）', () => {
  let calls = 0
  const spawnImpl = () => { calls++; return { status: 1, stdout: '', error: undefined, stderr: 'wsarecv: forcibly closed' } }
  assert.throws(() => audit.collect({ runs: 1, attempts: 2, spawnImpl, sleepImpl: () => {}, notice: () => {} }),
    /attempts=2/)
  assert.equal(calls, 2, 'collect 收到 attempts=2 却试了 ' + calls + ' 次 ⇒ 参数没接进重试环，env 覆盖是假的')
});

// ─────────────────────────────────────────────────────────────────────────────
// QM-6 外部评审（critic=claude，真跨家族）四条 Warning 全部成立后的回归锁。
// 三条可判定的（i1 尾换行 / i2 锁禁止了自己声明的出路 / i4 HTTP 形态太窄）先写红测试；
// i3 是"文字过度声明 + 参数选小了"，改常数与文案，其可判定部分由 i4 之外的既有锁覆盖。
test('i1 回归：源文件必须以换行收尾（外部评审拿 \ No newline at end of file 实物证据打的红）', () => {
  const fs = require('node:fs')
  const src = fs.readFileSync(require.resolve('./electron-ci-shard-audit.js'), 'utf8')
  assert.ok(/(?:\r?\n)$/.test(src),
    '末行没有终止符 ⇒ 与提案自己声明的「统一行尾、落盘前断言」矛盾，且 diff 会多出一行幽灵改动')
  // 形状自证：判据本身能区分"有尾换行"与"没有"（否则这条锁是装饰）
  assert.equal(/(?:\r?\n)$/.test('x }'), false, '判据对无尾换行的样本必须给 false')
});

test('i4 回归：HTTP 5xx 的多种真实形态都要判瞬时，而 4xx 与毫秒数不得被误判', () => {
  const { isTransientGhFailure } = audit
  // 正控：真实里常见的三种写法（评审指出的盲区）
  for (const m of ['gh: HTTP 502 Bad Gateway', 'GH_FAILED api x :: HTTP/1.1 500 Internal Server Error',
    'server replied HTTP/2 503']) {
    assert.equal(isTransientGhFailure(m), true, '这一形态属于可重试的 5xx：' + m)
  }
  // 负控：把判据写宽最容易撞上的两类假阳
  for (const m of ['gh: Not Found (HTTP 404)', 'HTTP 301 Moved', 'elapsed=500ms', 'port 1502 in use',
    'HTTP 200 OK']) {
    assert.equal(isTransientGhFailure(m), false, '不得判瞬时（4xx/重定向/数字里带 5xx 形状）：' + m)
  }
});


test('r2-i2 回归：判定读完整 stderr，打印才截断 —— 签名落在第 200 字符之后不得被判成"一次就抛"', () => {
  // 动因（外部评审第 2 轮 i2）：runGhOnce 原先把 stderr 截到 200 字符**之后**才造 Error，
  // 于是 isTransientGhFailure 只能看见截断文本。真实 gh / Go 报错常把
  // `wsarecv: … forcibly closed` 写在多行输出末尾（本仓 2026-10-22 现场就是两行），
  // 那条签名一旦落在 200 字符之后，要治这一类故障的判据对它完全失明。
  const longTail = 'gh: could not complete the request\n'.repeat(12)
    + 'read tcp 192.168.6.204:54852->198.18.0.241:443: wsarecv: An existing connection was forcibly closed by the remote host.'
  assert.ok(longTail.length > 200,
    '夹具必须真的把签名推到 200 字符之后，否则这条锁测不到任何东西：len=' + longTail.length)
  const sleeps = []
  let calls = 0
  const api = audit.makeGhApi({
    spawnImpl: () => { calls++; return { status: 1, stderr: longTail, stdout: '' } },
    sleepImpl: (ms) => sleeps.push(ms),
    notice: () => {},
    attempts: 3, baseMs: 10,
  })
  assert.throws(() => api.ghJson(['run', 'list']), /attempts=3/)
  assert.equal(calls, 3,
    '只试了 ' + calls + ' 次 ⇒ 截断把瞬时签名挡在判据之外，这条重试对本仓真实报错形态完全失效')
  assert.equal(sleeps.length, 2)
})

test('r2-i2 对偶：全文判定不得变宽判据 —— 404 藏在长 stderr 尾部仍一次就抛，且打印仍然截断', () => {
  const noise = 'y'.repeat(5000) + ' HTTP 404 Not Found'
  let calls = 0
  const api = audit.makeGhApi({
    spawnImpl: () => { calls++; return { status: 1, stderr: noise, stdout: '' } },
    sleepImpl: () => {}, notice: () => {}, attempts: 3, baseMs: 10,
  })
  let msg = ''
  try { api.ghJson(['run', 'list']) } catch (e) { msg = String(e.message) }
  assert.equal(calls, 1, '判据类失败（404）不得因为"读全文"被洗成概率事件')
  assert.ok(msg.length < 400, '归因文案必须仍然截断，否则一次 gh 失败能把日志刷出几十 KB：len=' + msg.length)
})

test('r2-i4 回归：退避总时长有硬上限 —— attempts=100 / baseMs=30000 不得把人质成 42 小时', () => {
  const notes = []
  const sleeps = []
  const api = audit.makeGhApi({
    spawnImpl: () => ({ status: 1, stderr: 'wsarecv: An existing connection was forcibly closed', stdout: '' }),
    sleepImpl: (ms) => sleeps.push(ms),
    notice: (l) => notes.push(l),
    attempts: 100, baseMs: 30000,
  })
  assert.throws(() => api.ghJson(['run', 'list']), /backoffBudget=/)
  const total = sleeps.reduce((a, b) => a + b, 0)
  assert.ok(total <= audit.GH_RETRY_BACKOFF_BUDGET_MS_DEFAULT,
    '退避总时长 ' + total + 'ms 超过硬上限 ⇒ 注释里的"有界"只是对善意输入的假设')
  assert.ok(sleeps.length < 99, '预算耗尽后必须停手，而不是按配置把 100 次硬等下去')
  assert.ok(notes.some((l) => /退避预算/.test(l)), '停止原因必须出声，否则下一次只看到"重试了几次"')
})

test('r2-i4 对偶：默认档配置不受上限影响（不得为了安全把正常重试砍成一次都不试）', () => {
  const sleeps = []
  let calls = 0
  const api = audit.makeGhApi({
    spawnImpl: () => {
      calls++
      return calls < 3 ? { status: 1, stderr: 'EOF', stdout: '' } : { status: 0, stdout: '[]' }
    },
    sleepImpl: (ms) => sleeps.push(ms), notice: () => {},
    attempts: audit.GH_RETRY_ATTEMPTS_DEFAULT, baseMs: audit.GH_RETRY_BASE_MS_DEFAULT,
  })
  assert.deepEqual(api.ghJson(['run', 'list']), [])
  assert.equal(calls, 3)
  assert.equal(sleeps.length, 2)
})

test('r2-i8 回归：空串是最容易手滑的"关掉重试"写法，必须回落默认并出声（静默吞掉等于配置坏了没人知道）', () => {
  const notes = []
  assert.equal(audit.resolvePositiveInt('', 5, 'MP_AUDIT_GH_ATTEMPTS', (l) => notes.push(l)), 5)
  assert.equal(notes.length, 1,
    'MP_AUDIT_GH_ATTEMPTS= 与"未设置"必须可区分：' + JSON.stringify(notes))
  // 未设置才是安静路径（每次正常跑都是它），不能被这条改动变成噪音。
  const quiet = []
  assert.equal(audit.resolvePositiveInt(undefined, 5, 'MP_AUDIT_GH_ATTEMPTS', (l) => quiet.push(l)), 5)
  assert.equal(quiet.length, 0, '未设置 ⇒ 静默取默认；只有"写了但写坏"才要出声')
})

test('r2-i11 回归：makeGhApi 收到 attempts<1 必须当场点名，不得抛"读 undefined.message"的 TypeError', () => {
  const api = audit.makeGhApi({
    spawnImpl: () => ({ status: 0, stdout: '[]' }),
    sleepImpl: () => {}, notice: () => {}, attempts: 0, baseMs: 10,
  })
  assert.throws(() => api.ghJson(['run', 'list']), /BAD_GH_API_OPTS[\s\S]*attempts/,
    '循环体一次都不执行时，抛出的必须是"参数不合法"，不是 TypeError —— 后者读起来像引擎坏了')
})

test('r2-i7 回归：取数面只剩一条 —— collect 不得再接受能整体绕过重试与非法值校验的 opts.api', () => {
  assert.throws(
    () => audit.collect({ runs: 1, api: { ghJson: () => [], ghText: () => '' } }),
    /opts\.api/,
    '注入整份取数面 ⇒ attempts/baseMs 的校验与重试全部被绕开，而代码注释声称只有一条默认路')
})
