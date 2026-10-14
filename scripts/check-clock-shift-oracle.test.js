'use strict';

/**
 * check-clock-shift-oracle.js 的回归锁（node --test，秒级，不起 vitest）。
 *
 * 这一族锁要挡的三类失效，本仓都真踩过：
 * ① 「判据本体没入库」（.gitignore 的 scripts/*.js 与未锚定的 test-*.js）；
 * ② 「扫描域写死凭记忆，和真正被收集的那份漂移」（Gate 4 的 --exclude 事故同族）；
 * ③ 「探针自己坏掉时读起来像通过」（setupFiles 里点名的文件缺席 ⇒ 第二趟只是重跑基线）。
 * 所以既有静态形状断言，也有**真起一个子进程**去证位移生效的行为断言。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const DESKTOP = path.join(REPO, 'apps', 'desktop');
const SETUP = path.join(DESKTOP, 'test-setup-clock-shift.js');
const CONTROL_TEST = path.join(DESKTOP, 'electron', 'services', 'clock-shift-oracle-control.test.js');
const mod = require('./check-clock-shift-oracle.js');

test('扫描域由 vitest 配置推导，且每个头一段都真实存在', () => {
  const dirs = mod.includeDirsFromConfig();
  assert.ok(Array.isArray(dirs) && dirs.length >= 1, `include 目录解析为空：${JSON.stringify(dirs)}`);
  for (const d of dirs) {
    assert.ok(fs.existsSync(path.join(DESKTOP, d)), `include 推出的目录不存在：apps/desktop/${d}`);
  }
  // 反"凭记忆写死"：域必须来自配置文件，而不是脚本里的一份常量清单
  const cfgText = fs.readFileSync(path.join(DESKTOP, 'vitest.config.js'), 'utf8');
  assert.match(cfgText, /include:\s*\[/);
});

test('候选集非空且每一项都是真实测试文件（空集不得读成"干净"）', () => {
  const scan = mod.collectCandidates();
  const list = scan.hits;
  assert.ok(list.length > 0, '候选集为空 —— 扫描域或绝对时间戳正则失效，而不是仓库真的干净');
  for (const rel of list.slice(0, 10)) {
    assert.match(rel, mod.TEST_SUFFIX, `候选项不是测试文件：${rel}`);
    assert.ok(fs.existsSync(path.join(DESKTOP, rel)), `候选项不存在：${rel}`);
  }
});

test('绝对时间戳正则：正例命中、真实时钟写法不得命中', () => {
  for (const good of [
    "const NOW = Date.parse('2026-10-11T04:00:00.000Z')",
    'const t = new Date("2026-09-27T00:00:00Z")',
    "expect(x).toBe('2026-10-02T00:00:00.000Z')",
  ]) {
    assert.ok(mod.ABS_RE.test(good), `正例未命中：${good}`);
  }
  for (const bad of [
    'const t = Date.now()',
    'const t = new Date().toISOString()',
    'const t = Date.parse(s)',
    'createdAt: Date.now() - 86400000',
  ]) {
    assert.ok(!mod.ABS_RE.test(bad), `负例误命中（会把相对当下也当引信）：${bad}`);
  }
});

test('预筛覆盖面必须当场出声：domain 严格大于 candidates 且两者都 >0，逐形态计数与清单同键', () => {
  const scan = mod.collectCandidates();
  assert.ok(scan.domainTotal > 0, `扫描域为空：${scan.domainTotal}`);
  assert.ok(scan.hits.length > 0, '候选集为空（同上一条判据，此处锁的是覆盖面数字本身）');
  // 严格 ">"：今天预筛是全域的**真子集**（936 vs 168）。若哪天有人把 domainTotal 写成 hits.length
  // 或把预筛换成全域，这条会红——那是必须**重新作声明**的时刻（"全域已测"与"预筛已测"是两句话）。
  assert.ok(scan.domainTotal > scan.hits.length, `domain=${scan.domainTotal} 与 candidates=${scan.hits.length} 必须严格不等：预筛现在是全域的真子集，两者相等意味着覆盖面声明已漂`);
  const wantKeys = mod.TIME_FORMS.map(([n]) => n).sort();
  const gotKeys = Object.keys(scan.byForm).sort();
  assert.deepEqual(gotKeys, wantKeys, `byForm 键集与形态清单不一致（新增形态忘了计数，覆盖面就会静默缩水）`);
  // 每条形态都必须真的收到东西：某条恒 0 说明该形态写错了（正控只在样本上成立、对真实仓库无效）
  for (const [name, src] of mod.TIME_FORMS) {
    assert.ok(scan.byForm[name] > 0, `形态 ${name}（${src}）在真实仓库里命中 0 个文件 —— 要么写错，要么已漂，必须当场看见`);
  }
});
test('CLI 参数解析：未知旗标必须 fail closed，--limit 的两种写法都要生效', () => {
  // 本轮实测动因：旧 argv() 只认 `--limit=4`，`--limit 4` 被**静默丢弃**，
  // 一次"只跑 4 个文件的 smoke"变成整域两趟（白跑十几分钟）。静默忽略参数=把跑什么交给运气。
  const sp = mod.parseArgs(['--limit', '4', '--shift-days', '90']);
  assert.equal(sp.limit, 4, '`--limit 4`（空格写法）必须生效');
  assert.equal(sp.shiftDays, 90, '`--shift-days 90`（空格写法）必须生效');
  const eq = mod.parseArgs(['--limit=4', '--shift-days=90']);
  assert.deepEqual([eq.limit, eq.shiftDays], [4, 90], '两种写法必须解析出同一结果');
  assert.deepEqual(sp.unknown, [], '合法参数不应有 unknown');

  // 未知旗标：不得当成"没看见"
  const bad = mod.parseArgs(['--limitt', '4']);
  assert.ok(bad.unknown.includes('--limitt'), '未知旗标必须被记进 unknown：' + JSON.stringify(bad.unknown));
  // 尾随的裸值也一并出声（它不属于任何已知旗标）——判据用"包含"而不是"长度恰好为 1"，
  // 因为"未知旗标后面跟着什么"本就不该被猜：只要求两件事都被列出来。
  assert.equal(bad.limit, 0, '未知旗标不得顺带把 limit 设上');
  assert.deepEqual(mod.parseArgs([]), { dryRun: false, shiftDays: 45, limit: 0, filesArg: '', unknown: [] }, '默认档必须原样');
  assert.equal(mod.parseArgs(['--dry-run']).dryRun, true);
  // 非法取值同样要出声（0/负数/非整数都会把位移量悄悄吃掉）
  assert.equal(mod.parseArgs(['--limit', '0']).unknown.length, 1, 'limit=0 必须被拒');
  assert.equal(mod.parseArgs(['--shift-days', 'abc']).unknown.length, 1, '非数字位移必须被拒');
  assert.equal(mod.parseArgs(['--limit']).unknown.length, 1, '缺值必须被拒，不得回退成"跑全域"');
});

test('单趟完整性判据：三种"没跑完"形态必须各自出声（没跑完不得读成零失败）', () => {
  const mk = (over) => Object.assign({ rc: 0, collected: 3, failed: [], missing: [] }, over);
  assert.equal(mod.judgePass(mk(), 3).ok, true, '跑齐 + rc=0 + 无失败 ⇒ 完整');

  const shortRun = mod.judgePass(mk({ collected: 2, missing: ['a.test.js'] }), 3);
  assert.equal(shortRun.ok, false, '少跑一个文件必须判不完整');
  assert.ok(shortRun.reasons.some((r) => r.startsWith('COLLECTED_MISMATCH')), `缺 COLLECTED_MISMATCH：${shortRun.reasons}`);
  assert.ok(shortRun.reasons.join(' ').includes('a.test.js'), '必须点名是哪个文件没跑，否则下次还得人再去比一次报告');

  const rcNoFail = mod.judgePass(mk({ rc: 1, failed: [] }), 3);
  assert.equal(rcNoFail.ok, false, 'rc≠0 而失败文件为 0 ⇒ 整趟没跑完，必须拦');
  assert.ok(rcNoFail.reasons.some((r) => r.startsWith('RC_WITHOUT_FAILURES')), `缺 RC_WITHOUT_FAILURES：${rcNoFail.reasons}`);

  const rcWithFail = mod.judgePass(mk({ rc: 1, failed: ['a.test.js'] }), 3);
  assert.equal(rcWithFail.ok, true, 'rc≠0 且确实点出了失败文件 ⇒ 属正常差集输入，不得当“没跑完”');

  assert.equal(mod.judgePass(mk({ collected: 0 }), 0).ok, true, '候选本来为空时不在这里判（由“空集 FAIL”那条负责，两条不得互相掩盖）');
  const nothing = mod.judgePass(mk({ rc: 1, collected: 0 }), 3);
  assert.ok(nothing.reasons.some((r) => r.startsWith('NOTHING_COLLECTED')), '候选非空而收集数为 0 必须单独出声');

  // 归一化：报告里是绝对路径，候选是 DESKTOP 相对路径，两者必须能对上（对不上就是恒差集 ⇒ 天天报不完整）
  // 绝对路径样本必须用**磁盘上真实存在**的文件：Gate 12c 判的就是"这条绝对路径在不在"，
  // 编一个不存在的绝对路径会让这条测试自己变成一处失效路径（本轮实测被门禁点过两次）。
  const REAL_ABS = [REPO, 'apps', 'desktop', 'tests', 'visual-ci.test.js'].join('/');
  assert.equal(mod.normalizeReportName(REAL_ABS), 'tests/visual-ci.test.js');
  assert.equal(mod.normalizeReportName('./tests/a.test.js'), 'tests/a.test.js');
  assert.deepEqual(
    mod.missingCandidates(['tests/a.test.js', 'tests/visual-ci.test.js'], [REAL_ABS]),
    ['tests/a.test.js'],
    'missingCandidates 必须只报真没跑的那个'
  );
});
test('候选形态清单：五种时间形态逐个正控，真实时钟写法一律不得命中（预筛只可多收不可漏收）', () => {
  const forms = mod.TIME_FORMS;
  assert.ok(Array.isArray(forms) && forms.length >= 5, `形态清单至少 5 条，实得 ${forms && forms.length}`);
  // 聚合判据不得带 g/y：带这两个标志的 RegExp，.test() 有 lastIndex 状态，逐文件判定会随顺序漂。
  assert.equal(mod.ABS_RE.flags, '', `聚合判据不应带任何正则标志：flags=${mod.ABS_RE.flags}`);
  const positives = [
    ['iso_date_string', 'const t = \'2026-07-22T10:00:00Z\''],
    ['iso_date_string', 'x = new Date("2026-07-22")'],
    ['epoch_ms', 'const now = 1753094400000'],
    ['epoch_s', 'const now = 1753094400'],
    ['date_utc', 'const t = Date.UTC(2026, 0, 1)'],
    ['kernel_time', 'if (st.mtimeMs < startedAt) return false'],
    ['kernel_time', 'fs.utimesSync(f, new Date(0), new Date(0))'],
  ];
  for (const [form, sample] of positives) {
    const entry = forms.find(([n]) => n === form);
    assert.ok(entry, `形态 ${form} 未在清单里登记`);
    assert.ok(new RegExp(entry[1]).test(sample), `单形态正控失效：${form} 没命中 ${JSON.stringify(sample)}`);
    assert.equal(mod.ABS_RE.test(sample), true, `聚合判据失效：${JSON.stringify(sample)} 没进候选`);
  }
  // 负控：与「固定时间」无关的写法。命中即说明预筛把全域拉进候选，位移趟预算会漂。
  const negatives = [
    'const t = Date.now()',
    'const d = new Date()',
    'await new Promise(r => setTimeout(r, 20_000))',
    'expect(performance.now() - start).toBeLessThan(1e3)',
    'const size = 1234567890',
  ];
  for (const text of negatives) {
    assert.equal(mod.ABS_RE.test(text), false, `负控失效：${JSON.stringify(text)} 不应进候选`);
  }
  // v1 只认日期串，实测整族漏掉「数字纪元」9 个文件与「内核时间」2 个文件 ⇒ 两族各钉一条独立断言
  assert.equal(mod.ABS_RE.test('1753094400000'), true, '13 位毫秒纪元必须进候选');
  assert.equal(mod.ABS_RE.test('mtimeMs'), true, '内核时间形态必须进候选（本 PR 抓到的那条引信就是这个形状）');
});

test('接线锁：setup 文件必须被 vitest 的 setupFiles 点名，且在末位之后仍在列', () => {
  const cfg = require(path.join(DESKTOP, 'vitest.config.js'));
  const setups = (cfg.test && cfg.test.setupFiles) || [];
  assert.ok(setups.includes('./test-setup-clock-shift.js'),
    `test-setup-clock-shift.js 不在 setupFiles 里 ⇒ 位移永远不生效，oracle 只剩"重跑基线"：${JSON.stringify(setups)}`);
  assert.ok(fs.existsSync(SETUP), 'setup 文件本体不在（.gitignore 的 test-*.js 是首要嫌疑）');
  assert.ok(fs.existsSync(CONTROL_TEST), '阳性对照用例不在 ⇒ "补丁没装上"与"没有引信"不可区分');
});

test('行为锁：设了 MP_TEST_NOW_SHIFT_MS 时 Date.now() 与零参 new Date() 都真的位移', () => {
  const probe = [
    `process.env.MP_TEST_NOW_SHIFT_MS = '${30 * 86400000}';`,
    `require(${JSON.stringify(SETUP)});`,
    'const i = globalThis.__mpClockShift;',
    "if (!i || !i.enabled) { console.log('NOT_ENABLED'); process.exit(1); }",
    'const drift = Date.now() - i.baseNow;',
    'const ctor = new Date().getTime() - i.baseNow;',
    "console.log(JSON.stringify({ enabled: i.enabled, driftOk: drift >= i.shiftMs - 5000, ctorOk: ctor >= i.shiftMs - 5000, shiftMs: i.shiftMs }));",
  ].join('\n');
  const out = execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  const j = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  assert.equal(j.enabled, true);
  assert.equal(j.driftOk, true, `Date.now 未位移：${out}`);
  assert.equal(j.ctorOk, true, `零参 new Date() 未位移：只替 Date.now 会漏这条（V8 里它不走 Date.now）`);
});

test('行为锁：不设位移时 setup 必须完全不碰 Date（常态跑法零影响）', () => {
  const probe = [
    'delete process.env.MP_TEST_NOW_SHIFT_MS;',
    `const before = Date;`,
    `require(${JSON.stringify(SETUP)});`,
    'const i = globalThis.__mpClockShift;',
    "console.log(JSON.stringify({ same: Date === before, enabled: !!(i && i.enabled) }));",
  ].join('\n');
  const out = execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  const j = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  assert.equal(j.enabled, false);
  assert.equal(j.same, true, '未开启位移却替换了全局 Date ⇒ 常态套件跑在与基线不同的环境里');
});

test('KNOWN 豁免清单：起始必须为空，条目不得重复', () => {
  // 起始为空是纪律：先让第一跑把存量红点摊开，再逐条带理由登记；
  // 一上来就写例外 = 把已知引信合法化（本仓「欠账清单只能缩小」同族）。
  assert.deepEqual(mod.KNOWN_CLOCK_DEPENDENT, [],
    'KNOWN 清单非空 ⇒ 必须在执行记录里逐条给出"它合理地依赖真实时间"的理由');
  assert.equal(new Set(mod.KNOWN_CLOCK_DEPENDENT).size, mod.KNOWN_CLOCK_DEPENDENT.length);
});

test('gitignore 反选真实生效：判据本体与 setup 本体都不得被静默忽略', () => {
  // 先查文本、再**直接问 git**：只看反选行在不在是记录性断言（规则改到别处、
  // 或有人新增一条更靠后的 `test-*.js`/`scripts/*.js` 都会让文本仍在而实际已被忽略）。
  const gi = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  const targets = [
    'scripts/check-clock-shift-oracle.js',
    'scripts/check-clock-shift-oracle.test.js',
    'apps/desktop/test-setup-clock-shift.js',
  ];
  for (const line of ['!scripts/check-clock-shift-oracle.js',
    '!scripts/check-clock-shift-oracle.test.js',
    '!apps/desktop/test-setup-clock-shift.js']) {
    assert.ok(gi.split(/\r?\n/).includes(line), `.gitignore 缺反选 ${line}`);
  }
  for (const rel of targets) {
    let ignored = false;
    let status = null;
    try {
      execFileSync('git', ['check-ignore', '--no-index', '-q', rel], { cwd: REPO, stdio: 'ignore' });
      ignored = true; // rc=0 ⇒ 被忽略
    } catch (e) {
      status = e && e.status;
      assert.equal(status, 1, `git check-ignore 对 ${rel} 返回意外退出码 ${status}（不是"未忽略"的 1）`);
    }
    assert.equal(ignored, false, `${rel} 被 .gitignore 静默忽略 ⇒ 判据/探针本体进不了仓库`);
  }
});
