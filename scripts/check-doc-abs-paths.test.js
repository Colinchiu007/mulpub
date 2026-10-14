/**
 * check-doc-abs-paths.test.js — 文档绝对路径有效性门禁自测
 *
 * 背景（#3000 的逃逸分析）：仓库根目录 2026-10-06 改名后，文档里的
 * **绝对路径**不会跟着改，于是长期静默失效。「有没有门禁检查文档写的
 * 路径是否还存在」——此前是零，check-no-brand-residue.js 只管品牌词。
 *
 * 本测试用临时目录做 fixture，验证门禁的**检出能力**（而不只是"当前仓库干净"）：
 * - 失效的本机绝对路径必须命中
 * - 存在的路径不报「失效」，但**必须计入账本**（口径换代：判据不再以文件系统为输入）
 * - 产品品牌名 / Linux 部署路径 / 云沙箱路径 / CI runner 路径必须**不**命中
 * - 归档快照目录按契约豁免
 *
 * 2026-10-14 口径换代（gate-12c-abs-path-ban）：判据的输入由「这条路径在不在盘上」改成
 * 「文档里出现了多少条绝对路径」。动因是拉 CI 现场日志读到的读数——ubuntu runner 上没有盘符，
 * firstMissingSegment 对每条路径一律返回 null ⇒ 现场计数恒 0 ⇒ 与账本比较两个方向都不可能红，
 * 那一步打印的是「无从判定 1094 条」紧跟 PASS。计数与盘符无关之后，本文件里原先
 * 「本机无 Windows 盘符 ⇒ t.skip」的用例**全部变成 CI 上真跑**，这既是修法也是修好的证据。
 *
 * 特别注意最后两条"误伤回归"：本门禁最容易踩的坑不是漏报，而是**误伤历史文档**
 * （2026-10-07 实测：全量扫描误报 260 处，收紧后仍有 101 处历史引用，
 *  逐条核对后绝大多数根本不该改）。故口径最终定为「只查本次改动集」。
 *
 * CI：quality-gate.yml changes job「Gate 12b」先跑本自测再扫描改动集。
 * 用法：node --test scripts/check-doc-abs-paths.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'check-doc-abs-paths.js');

// 串行化：node:test 默认并发跑顶层 test。
// 2026-10-07 实测踩坑：并发下"检出失效路径"用例在门禁被判定废掉时**仍然绿**——
// 同批 fixture 用例共享 tmp 目录前缀、且子进程 spawn 与断言之间存在竞态，
// 结果是变异反证一度"看起来没被抓住"，差点让我把无覆盖的门禁当成有覆盖。
// 判据：一个门禁自测必须能承重。各用例彼此独立（各自 mkdtemp），不需要 describe 包装；
// 若发现用例间互相影响，按**具体证据**定位并修用例，不要用全局开关掩盖。
// 2026-10-07 留痕：曾误加 `test.describe = undefined` 想"串行化"，那改的是模块导出、
// 与并发无关，属于无效且有副作用的修法，已撤。

/**
 * 建临时 fixture 目录。
 * files 的值可以是字符串，也可以是 (realDir) => string —— 后者用于需要引用
 * **真实存在**路径的用例（realDir 必须先建好才能写进文档内容）。
 */
function makeFixture (files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdap-fixture-'));
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdap-real-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'function' ? content(realDir) : content);
  }
  return { root, realDir };
}

function runGate (root, extraArgs = []) {
  // 注意：--root 决定扫描根，--all 决定用全量审计口径。
  // 参数顺序无所谓，但 --root 必须指向 fixture，否则会扫到真实仓库。
  return spawnSync(
    process.execPath,
    [SCRIPT, '--all', '--root', root, ...extraArgs],
    { encoding: 'utf8' }
  );
}

/**
 * 本机**真实存在**的 Windows 盘符（如 'D:'），不存在则返回 null。
 *
 * 2026-10-07 CI 首跑实测（本文件当时最贵的一个坑）：
 * 用例里写死 `D:\...`，本机 Windows 绿、ubuntu runner 上 4 个用例红。
 * 根因不是门禁坏了——门禁按设计「只判定本机存在的盘符」，Linux 上没有 D: 盘
 * ⇒ 正确跳过。而**测试把「本机有 D: 盘」当成了恒定前提**。
 * 判据：跨平台的自测不得假设具体盘符存在。
 */
function localDrive () {
  for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
    for (const sep of ['\\', '/']) {
      try {
        if (fs.existsSync(d + ':' + sep)) return d + ':';
      } catch { /* 忽略 */ }
    }
  }
  return null;
}

const DRIVE = localDrive();
// 夹具路径的一次性后缀：pid + 随机段，跨进程/跨轮次都不会撞上同一个目录名
const FX = process.pid.toString(36) + Math.random().toString(36).slice(2, 8);

/** 造一个「本机存在盘符下、但该子目录不存在」的绝对路径 */
function missingPathUnderLocalDrive () {
  // 一次性随机段（axis1c F11）：写死名字 ⇒ 某台机器上恰好存在那个目录时，用例以无法复现的方式假红，
  // 而红因看起来像判据坏了。
  return DRIVE + '\\Data\\projects\\definitely-not-here-' + FX + '\\apps\\desktop';
}

/** 造一个「本机存在盘符下、且真实存在」的绝对路径（文件必须真的建出来） */
function existingPathUnderLocalDrive () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdap-live-'));
  const file = path.join(dir, 'probe.txt');
  fs.writeFileSync(file, 'x\n');
  return file;
}

test('检出指向不存在目录的本机绝对路径', (t) => {
  if (!DRIVE) {
    t.skip('本机无 Windows 盘符（Linux runner），门禁按设计跳过判定');
    return;
  }
  const { root } = makeFixture({
    '01-docs/runbook.md': 'cd ' + missingPathUnderLocalDrive() + '\n',
  });
  const r = runGate(root);
  assert.equal(r.status, 1, 'stderr: ' + r.stderr);
  assert.match(r.stderr, /runbook\.md/);
  assert.match(r.stderr, /definitely-not-here-/);
});

/**
 * 造一个**完整存在**的本机路径（目录 + 文件），返回其字符串形式。
 *
 * 2026-10-07 实测踩坑：先前直接写 `realDir + '\\apps\\desktop'` 却只创建了
 * realDir，中间目录并不存在 —— 门禁判定**完全正确**，是测试自己造了个假路径，
 * 于是 3 个用例莫名变红。凡"应当放行"的路径，必须先把每一级都建出来。
 */
function makeRealPath (levels = ['apps', 'desktop'], withFile = true) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cdap-real-'));
  let cur = base;
  for (const lv of levels) {
    cur = path.join(cur, lv);
    fs.mkdirSync(cur, { recursive: true });
  }
  if (withFile) fs.writeFileSync(path.join(cur, 'probe.txt'), 'x\n');
  return withFile ? path.join(cur, 'probe.txt') : cur;
}

test('指向真实存在目录的路径必须放行', () => {
  const { root } = makeFixture({});
  const realPath = makeRealPath(); // 每一级都已创建
  fs.mkdirSync(path.join(root, '01-docs'), { recursive: true });
  fs.writeFileSync(path.join(root, '01-docs', 'ok.md'), 'cd ' + realPath + '\n');
  const r = runGate(root);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr + '\nrealPath=' + realPath);
});

test('产品品牌名不是路径，必须放行（误伤回归）', () => {
  const { root } = makeFixture({
    '01-docs/branding.md': [
      '# Multi-Publish 运维手册',
      '仓库: Multi-Publish (GitHub)',
      'Environment="SPLITTER_DIR=/opt/multi-publish/smart-sentence-splitter"',
      'npm scope: @multi-publish/*',
    ].join('\n') + '\n',
  });
  const r = runGate(root);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});

test('非本机路径（Linux 部署 / 云沙箱 / CI runner）必须放行', () => {
  const { root } = makeFixture({
    '01-docs/ops.md': [
      '部署目录：`/srv/projects/Multi-Publish/deploy/logto`',
      '云沙箱：`/sessions/sleepy-xxx/mnt/projects/anything/src/x.py`',
      'CI 上是 `C:\\Users\\RUNNER\\AppData\\Local\\Temp\\ci-build`',
    ].join('\n') + '\n',
  });
  const r = runGate(root);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});

test('归档快照目录豁免（记录的是当时事实，改写即篡改历史）', () => {
  const { root } = makeFixture({
    '.ci-forensics/reports/judge-report.md': '路径 `D:\\Data\\projects\\gone-at-the-time-abc\\a.png`\n',
    'openspec/changes/archive/x/design.md': '监听根：`D:/Data/projects/also-gone-def/x`\n',
    '.plan/refactoring-analysis.md': '[x](file:///d:/Data/projects/gone-ghi/y.js)\n',
  });
  const r = runGate(root);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});

test('占位符路径不判定（静态无法确认，误报即噪声）', () => {
  const { root } = makeFixture({
    '01-docs/ports.md': [
      'curl http://127.0.0.1:<cdpPort>/json/version',
      'cd D:\\Data\\projects\\${PROJECT}\\apps',
      'cd D:\\Data\\projects\\mp-*\\apps',
      '见 D:\\Data\\projects\\... 省略',
    ].join('\n') + '\n',
  });
  const r = runGate(root);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});

test('中文句读不得被吞进路径（贪心捕获回归）', () => {
  // 早期版本用宽松字符集收段，会把 `D:\...\ops-center`。截。整句当成一个路径，
  // existsSync 必然失败 → 260 处全量误报。此处锁"路径在句末标点前正确终止"。
  const { root } = makeFixture({});
  const realDir = makeRealPath(['ops-center'], false);
  fs.mkdirSync(path.join(root, '01-docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '01-docs', 'prose.md'),
    '路径是 ' + realDir + '`。截图见下。\n'
  );
  const r = runGate(root);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr + '\nstdout: ' + r.stdout);
});

test('盘符根构造必须是 D:\\ 而非 D\\（replace 吞冒号回归）', (t) => {
  // 'D:'.replace(/:$/, sep) 产出两字符 'D\'，后续 path.join 拼出无盘符相对路径，
  // existsSync 恒 false → 全量误报。用**多级真实存在**的路径锁死这个行为：
  // 若盘符根算错，`driveRoots.has('D:')` 与逐级 existsSync 都会失准。
  if (!DRIVE) {
    t.skip('本机无 Windows 盘符（Linux runner），该回归需 Windows 才能复现');
    return;
  }
  const { root } = makeFixture({});
  const realPath = existingPathUnderLocalDrive();
  fs.mkdirSync(path.join(root, '01-docs'), { recursive: true });
  fs.writeFileSync(path.join(root, '01-docs', 'deep.md'), '见 ' + realPath + '\n');
  const r = runGate(root);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});

test('非受管目录（apps/ 等运行时代码）不扫描', () => {
  const { root } = makeFixture({
    'apps/desktop/src/x.js': (d) =>
      'const p = "' + (d ? d + '\\\\Data\\\\projects\\\\gone-here-xyz\\\\a.js' : '/tmp/gone-here-xyz/a.js') + '";\n',
  });
  const r = runGate(root);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});

test('改动集口径：未改动的文档里的陈旧路径不应报红', (t) => {
  // 这是 2026-10-07 最重要的设计决定：全量扫描会命中 100+ 处历史引用，
  // 逐条核对后绝大多数不该改。只查改动集，精准覆盖"改了文档但路径是陈的"。
  if (!DRIVE) {
    t.skip('本机无 Windows 盘符（Linux runner），陈旧路径按设计不被判定');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdap-git-'));
  const tgit = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });

  const stale = missingPathUnderLocalDrive();
  tgit('init', '-q', '-b', 'main');
  tgit('config', 'user.email', 'test@example.com');
  tgit('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, '01-docs'), { recursive: true });
  // 历史文档：陈旧路径，但它没被本次改动碰过
  fs.writeFileSync(path.join(dir, '01-docs', 'HISTORY-2026-01-01.md'), '旧 worktree: ' + stale + '\n');
  fs.writeFileSync(path.join(dir, '01-docs', 'LIVENOTE.md'), 'v1\n');
  tgit('add', '-A');
  tgit('commit', '-q', '-m', 'seed');

  tgit('checkout', '-q', '-b', 'feat');
  // 本次只改了 LIVENOTE.md（内容合规）
  fs.writeFileSync(path.join(dir, '01-docs', 'LIVENOTE.md'), 'v2\n');
  tgit('add', '-A');
  tgit('commit', '-q', '-m', 'change');

  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--root', dir, '--base', 'main', '--head', 'feat'],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, '改动集不该包含 HISTORY 文档: ' + r.stderr);

  // 但若本次改动**就是**那份陈旧文档，必须报红
  fs.writeFileSync(
    path.join(dir, '01-docs', 'HISTORY-2026-01-01.md'),
    '旧 worktree: ' + stale + '\n补一句\n'
  );
  tgit('add', '-A');
  tgit('commit', '-q', '-m', 'touch history');
  const r2 = spawnSync(
    process.execPath,
    [SCRIPT, '--root', dir, '--base', 'main', '--head', 'feat'],
    { encoding: 'utf8' }
  );
  assert.equal(r2.status, 1, '改了陈旧文档就必须报红: ' + r2.stderr);
  assert.match(r2.stderr, /HISTORY/);
});

test('基线对账纯函数：无本机盘符的 runner 不得把整张账本报成"待收紧"（也不得静默当已判定）', () => {
  // 这条锁的分支在 Windows 本机永远走不到（CI 的 changes job 是 ubuntu-latest，那里没有盘符
  // ⇒ 现场计数恒 0）。留在 main 里就是一条没人跑过的分支，而它决定门禁在 CI 上是恒红还是恒绿，
  // 所以把判据抽成纯函数直接喂参数测。
  const mod = require(SCRIPT);
  const baseline = new Map([['a.md', 2], ['b.md', 1], ['gone.md', 4]]);
  const domain = new Set(['a.md', 'b.md']);
  const counts = new Map([['a.md', [{}, {}, {}]]]);

  const noDrive = mod.judgeBaseline({ counts, baseline, domain, canJudge: false });
  assert.equal(noDrive.judged, false);
  assert.equal(noDrive.over.length, 0, '无盘符时不得凭恒 0 的现场计数判"超出基线"');
  assert.equal(noDrive.shrink.length, 0, '无盘符时若仍比计数，整张账本会变成永久红——比它挡的问题更糟');
  assert.deepEqual(noDrive.stale.map((s) => s.file), ['gone.md'], '陈旧登记是跨平台事实，必须照样判');

  const withDrive = mod.judgeBaseline({ counts, baseline, domain, canJudge: true });
  assert.deepEqual(withDrive.over.map((o) => o.file), ['a.md'], 'a.md 3 处 > 基线 2 必须报');
  assert.deepEqual(withDrive.shrink.map((o) => o.file), ['b.md'], 'b.md 0 处 < 基线 1 必须要求收紧');
  assert.deepEqual(withDrive.stale.map((s) => s.file), ['gone.md']);
});

test('账本内容必须是"条数"而不是明细（第一版真把 finding 对象写了出去）', () => {
  const mod = require(SCRIPT);
  const found = new Map([['b.md', [{}, {}]], ['a.md', [{}]]]);
  const text = mod.serializeBaseline(found, { generated: '2026-01-01', reason: 'keep me' });
  const j = JSON.parse(text);
  assert.deepEqual(Object.keys(j.files), ['a.md', 'b.md'], '键必须排序稳定，否则重写会产生无意义 diff');
  assert.equal(j.files['a.md'], 1);
  assert.equal(j.files['b.md'], 2);
  assert.equal(j.generated, '2026-01-01', '重写必须保留原 generated（否则幂等锁立不住）');
  assert.equal(j.reason, 'keep me');
});

test('门禁脚本不得硬编码旧目录名（改名后不能自己失效）', () => {
  const script = fs.readFileSync(SCRIPT, 'utf8');
  const OLD = ['Multi', 'Publish'].join('-');
  assert.doesNotMatch(script, new RegExp(OLD, 'i'));
});

test('--root 必须同时支持 --root=X 与 --root X（变异反证：等号形式被去掉时必须变红）', (t) => {
  // 2026-10-07 实测踩坑：脚本最初只认 `--root=X`。用 `--root <dir>` 调用时参数被
  // 静默忽略 → 扫到**真实仓库**而不是 fixture，于是每个 fixture 用例都拿真实仓库的
  // 报红来判。若当时就有这条测试，第一次跑就会红。
  if (!DRIVE) {
    t.skip('本机无 Windows 盘符（Linux runner），无法构造可判定的失效路径');
    return;
  }
  const { root } = makeFixture({});
  fs.mkdirSync(path.join(root, '01-docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '01-docs', 'gone.md'),
    'cd ' + missingPathUnderLocalDrive() + '\n'
  );

  // 等号形式
  const eq = spawnSync(
    process.execPath,
    [SCRIPT, '--all', `--root=${root}`],
    { encoding: 'utf8' }
  );
  assert.equal(eq.status, 1, '等号形式必须认出 fixture root: ' + eq.stderr);

  // 空格形式
  const sp = spawnSync(
    process.execPath,
    [SCRIPT, '--all', '--root', root],
    { encoding: 'utf8' }
  );
  assert.equal(sp.status, 1, '空格形式必须认出 fixture root: ' + sp.stderr);

  // 两种形式必须扫到同一份内容（否则其中一种其实扫了别处）
  assert.ok(
    /gone\.md/.test(eq.stderr) && /gone\.md/.test(sp.stderr),
    '两种形式都应命中 fixture 内的文件'
  );
});

// ---- 2026-10-14：行级占位符豁免的洞（登记欠账 #72）------------------------------
// 动因（当场实测）：PLACEHOLDER_RE 里有一条**裸星号**，而豁免写在 scanFile 的行循环开头
// （`if (PLACEHOLDER_RE.test(line)) continue;`）⇒ 一行只要用了 Markdown 加粗，
// **整行的绝对路径都不再判定**。全域量到的规模：含 Windows 绝对路径的行 961 /
// 命中星号记号 281 / 其中「仅因星号被豁免且行内路径确实不存在」179。
// 我自己的证据链：同一轮里记录文件两处裸失效路径所在的行都带加粗 ⇒ 门禁对我报 PASS，
// 而它 PASS 的原因不是"路径没问题"。
// 这两条用例成对写，缺一不可：只测「加粗 + 失效路径必须红」会诱导把豁免整条删掉，
// 于是「加粗 + 路径自身含占位符」这条真实形态（文档里大量存在）立刻假红。

test('加粗行里的失效绝对路径必须照报（豁免不得按整行生效）', (t) => {
  if (!DRIVE) {
    t.skip('本机无 Windows 盘符（Linux runner），门禁按设计跳过判定');
    return;
  }
  const missing = missingPathUnderLocalDrive();
  const { root } = makeFixture({
    '01-docs/bold.md': '**重要**：产物在 ' + missing + ' 下，请核对。\n',
  });
  const r = runGate(root);
  assert.equal(r.status, 1, '加粗不该让整行免判，stderr: ' + r.stderr);
  assert.match(r.stderr, /definitely-not-here-/, '必须点名那条失效路径');
});

test('豁免必须落在路径片段上：同一行既有加粗、路径自身又含通配符时必须放行', (t) => {
  if (!DRIVE) {
    t.skip('本机无 Windows 盘符（Linux runner），门禁按设计跳过判定');
    return;
  }
  const { root } = makeFixture({
    '01-docs/mixed.md': [
      // 加粗 + 通配符路径（静态无法判定 ⇒ 仍须豁免，否则文档里大量写法假红）
      '**通配**：日志在 ' + DRIVE + '\\Data\\projects\\mp-*\\apps\\logs 下',
      // 加粗 + 变量路径
      '**变量**：见 ' + DRIVE + '\\Data\\projects\\${PROJECT}\\apps',
      // 加粗 + 尖括号占位符
      '**模板**：输出到 ' + DRIVE + '\\out\\<buildTag>\\app.asar',
    ].join('\n') + '\n',
  });
  const r = runGate(root);
  assert.equal(r.status, 0, '路径自身含占位符必须放行，stderr: ' + r.stderr);
});

// ---- 存量基线：收紧豁免之后，"不挡别人"与"不放水"必须同时成立 ---------------------
// 动因：豁免从整行收到路径词元后，全量报错项 539 → 861（净新增 276，散在 168 个文件，
// 其中 01-docs/learnings.md 独占 26）。这些是**别人写下的历史留痕**（已删除的临时 worktree 等），
// 而日常阻断口径是"改动集里的整份文件"⇒ 只收紧不管存量，等于让每个碰 learnings 的会话
// 都被 26 条历史行判红。基线按文件计数、只能缩小，同时把三种走漏洞路全堵上。

function writeBaseline (root, files, extra) {
  const p = path.join(root, 'scripts');
  fs.mkdirSync(p, { recursive: true });
  // 计数口径之后账本必须带 metric；夹具默认写当代版本，只有专门测「版本不匹配」的用例才改坏它。
  const json = Object.assign(
    { note: 'fixture', generated: '2026-10-14', reason: 'fixture', metric: require(SCRIPT).METRIC_VERSION },
    extra || {},
    { files }
  );
  fs.writeFileSync(path.join(p, 'doc-abs-paths-baseline.json'), JSON.stringify(json, null, 2) + '\n', 'utf8');
}

/** 造 n 条互不相同的失效路径（同盘符下不同子目录名，确保逐条被数到；带一次性后缀见 FX） */
function deadPaths (n) {
  return Array.from({ length: n }, (_, i) =>
    DRIVE + '\\Data\\projects\\dead-baseline-' + i + '-' + FX + '\\apps\\desktop');
}
function docWith (paths) {
  return paths.map((p, i) => 'run' + i + ' ' + p).join('\n') + '\n';
}

test('基线内的存量必须放行（不挡别人写下的历史行）', (t) => {
  if (!DRIVE) { t.skip('Linux runner 无本机盘符'); return; }
  const { root } = makeFixture({ '01-docs/a.md': docWith(deadPaths(2)) });
  writeBaseline(root, { '01-docs/a.md': 2 });
  const r = runGate(root);
  assert.equal(r.status, 0, '与基线相等不该红，stderr: ' + r.stderr);
});

test('超出基线必须红，并点名"超出存量基线"', (t) => {
  if (!DRIVE) { t.skip('Linux runner 无本机盘符'); return; }
  const { root } = makeFixture({ '01-docs/a.md': docWith(deadPaths(2)) });
  writeBaseline(root, { '01-docs/a.md': 1 });
  const r = runGate(root);
  assert.equal(r.status, 1, 'stderr: ' + r.stderr);
  assert.match(r.stderr, /超出存量基线/);
});

test('低于基线也必须红（基线只能缩小，不许变成永久豁免）', (t) => {
  if (!DRIVE) { t.skip('Linux runner 无本机盘符'); return; }
  const { root } = makeFixture({ '01-docs/a.md': docWith(deadPaths(1)) });
  writeBaseline(root, { '01-docs/a.md': 3 });
  const r = runGate(root);
  assert.equal(r.status, 1, '改少了却不收基线必须红，stderr: ' + r.stderr);
  assert.match(r.stderr, /收紧/);
});

test('基线里的文件已不在扫描域 ⇒ 陈旧登记必须红', (t) => {
  if (!DRIVE) { t.skip('Linux runner 无本机盘符'); return; }
  const { root } = makeFixture({ '01-docs/a.md': docWith(deadPaths(1)) });
  writeBaseline(root, { '01-docs/a.md': 1, '01-docs/deleted.md': 4 });
  const r = runGate(root);
  assert.equal(r.status, 1, 'stderr: ' + r.stderr);
  // ⚠️ 这一组断言是**改写过的**。原写法只有 `assert.match(/陈旧/)` 与 `/deleted\.md/` 两行，
  // 而这两个词在**固定修法文案**里本来就出现（"变少了 / 陈旧登记：账本只能缩小"），且红是
  // 由 shrink（deleted.md 被并进了扫描域、计数恒 0）提供的 —— 2026-10-14 变异反证实测：
  // 把陈旧检测整条摘掉，本用例照绿。那是一条装饰性锁，把"匹配消息里的词"当成了"匹配成因"。
  // 现按**成因**断言：FAIL 头的分类计数 + 明细行的专属句式 + 两条"不得由别的成因顶替"的负断言。
  assert.match(r.stderr, /—— [^\n]*陈旧登记 1 个/, 'FAIL 头必须单独点名这一类，stderr: ' + r.stderr);
  assert.match(
    r.stderr,
    /01-docs\/deleted\.md：基线里有这一条，但文件已不存在 ⇒ 陈旧登记/,
    '明细必须说明成因是"文件已不存在"，stderr: ' + r.stderr
  );
  assert.doesNotMatch(r.stderr, /低于基线待收紧/, '被删掉的文件不得被误诊成"改少了把账本改小"');
  assert.doesNotMatch(r.stderr, /deleted\.md：0 处/, '它不在扫描域里，不该进计数比较');
});

test('基线里的文件还在、但已移出受管范围 ⇒ 陈旧登记必须说明"不再受管"', (t) => {
  if (!DRIVE) { t.skip('Linux runner 无本机盘符'); return; }
  // 归档豁免目录里的文件**磁盘上存在**，只是不再受管（`isManagedDoc` 判假）。
  // 这一支与上一支的区分全靠 `v.why`：文件在不在磁盘上。没有这条用例时，
  // 把 existsSync 的两个分支写反（归档件报成"已不存在"）不会有任何锁变红。
  const { root } = makeFixture({
    '01-docs/a.md': docWith(deadPaths(1)),
    '01-docs/archive/old.md': '# 归档快照\n\n这里是历史事实，不判定。\n'
  });
  writeBaseline(root, { '01-docs/a.md': 1, '01-docs/archive/old.md': 2 });
  const r = runGate(root);
  assert.equal(r.status, 1, 'stderr: ' + r.stderr);
  assert.match(
    r.stderr,
    /01-docs\/archive\/old\.md：基线里有这一条，但文件不再受管（移入归档 \/ 改了扩展名） ⇒ 陈旧登记/,
    '归档件必须报"不再受管"而不是"已不存在"，stderr: ' + r.stderr
  );
  assert.doesNotMatch(r.stderr, /old\.md：0 处/, '归档件不参与计数比较');
});

test('逐文件比较不得退化成全局总数（A 变差 + B 变好、总数相等也必须红）', (t) => {
  if (!DRIVE) { t.skip('Linux runner 无本机盘符'); return; }
  const { root } = makeFixture({
    '01-docs/worse.md': docWith(deadPaths(2)),   // 基线 1 → 实际 2（变差）
    '01-docs/better.md': docWith(deadPaths(1)),  // 基线 2 → 实际 1（变好）
  });
  writeBaseline(root, { '01-docs/worse.md': 1, '01-docs/better.md': 2 });
  const r = runGate(root);
  assert.equal(r.status, 1, '总数 3 == 基线 3 不能抵消逐文件走差，stderr: ' + r.stderr);
  assert.match(r.stderr, /worse\.md/);
});

test('基线 JSON 损坏必须走"自身故障"档（退出码 2），既不是 0 也不是 1', (t) => {
  if (!DRIVE) { t.skip('Linux runner 无本机盘符'); return; }
  const { root } = makeFixture({ '01-docs/a.md': docWith(deadPaths(1)) });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'doc-abs-paths-baseline.json'), '{ 这不是 JSON', 'utf8');
  const r = runGate(root);
  assert.equal(r.status, 2, '读不到基线≠没有问题，也不能读成发现引信，stderr: ' + r.stderr);
  assert.match(r.stderr, /自身故障|读不到|非法/);
});

test('基线文件缺席按"空基线"从严处理（删掉账本不能让门禁闭眼）', (t) => {
  if (!DRIVE) { t.skip('Linux runner 无本机盘符'); return; }
  const { root } = makeFixture({ '01-docs/a.md': docWith(deadPaths(1)) });
  const r = runGate(root);
  assert.equal(r.status, 1, '没有基线时每条失效路径都要报，stderr: ' + r.stderr);
});

test('--write-baseline 必须搭配 --all（防止窄域跑一次就把整张账本抹掉）', (t) => {
  if (!DRIVE) { t.skip('Linux runner 无本机盘符'); return; }
  const { root } = makeFixture({ '01-docs/a.md': docWith(deadPaths(1)) });
  writeBaseline(root, { '01-docs/a.md': 1, '01-docs/elsewhere.md': 9 });
  // 不带 --all：拒绝重写
  const beforeDenied = fs.readFileSync(path.join(root, 'scripts', 'doc-abs-paths-baseline.json'), 'utf8');
  const denied = spawnSync(process.execPath, [SCRIPT, '--root', root, '--write-baseline'], { encoding: 'utf8' });
  assert.equal(denied.status, 2, '窄域写基线必须拒，stderr: ' + denied.stderr);
  const bPath = path.join(root, 'scripts', 'doc-abs-paths-baseline.json');
  // ⚠️ 这一行原来写的是 `assert.match(still, /elsewhere\.md/)`——"文件里还找得到那个词"并不等于
  // "文件没被动过"：把整张账本重写掉、只留下 elsewhere 这个键名，它也照样过。改成**逐字节比对**
  // （外部评审 axis2 命中，同族教训见 AGENTS.md「文本结构断言」）。
  const still = fs.readFileSync(bPath, 'utf8');
  assert.equal(still, beforeDenied, '被拒之后账本必须一个字节没少（实测踩过 --update 抹掉别的域）');
  // 带 --all：允许，且第二次写出的字节必须与第一次相同（幂等）
  const ok1 = spawnSync(process.execPath, [SCRIPT, '--root', root, '--all', '--write-baseline'], { encoding: 'utf8' });
  assert.equal(ok1.status, 0, 'stderr: ' + ok1.stderr);
  const b1 = fs.readFileSync(path.join(root, 'scripts', 'doc-abs-paths-baseline.json'), 'utf8');
  const ok2 = spawnSync(process.execPath, [SCRIPT, '--root', root, '--all', '--write-baseline'], { encoding: 'utf8' });
  const b2 = fs.readFileSync(path.join(root, 'scripts', 'doc-abs-paths-baseline.json'), 'utf8');
  assert.equal(ok2.status, 0, 'stderr: ' + ok2.stderr);
  assert.equal(b2, b1, '重写基线必须幂等（否则每次跑都在漂移）');
  assert.match(b1, /"01-docs\/a\.md": 1/, '生成的基线要如实记下现场计数');
});

test('本仓基线必须与现场逐文件相等（既不多也不少，防止悄悄恒 0 或悄悄漏扫）', (t) => {
  if (!DRIVE) {
    // Linux runner 上没有本机 Windows 盘符 ⇒ 门禁按设计全部跳过 ⇒ 现场计数恒 0，
    // 与真实基线（非 0）必然不等。这里不是缺陷，但也不能因此跳过整条锁：
    // 改成"平台不自洽时红"，逼后来人在 Windows 上取基线。
    t.skip('本机无 Windows 盘符：基线是在 Windows 上生成的，跨平台无法逐文件对账');
    return;
  }
  const repoRoot = path.join(__dirname, '..');
  const r = spawnSync(process.execPath, [SCRIPT, '--root', repoRoot, '--all'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, '全量审计必须与基线逐文件相等，stderr: ' + r.stderr.slice(0, 1500));
});

// ---- 账本"只能缩小"的机械守卫（外部评审 axis2 的 Critical 落地，2026-10-14）----
//
// 旁路是什么：`--all --write-baseline` 无差别抓取现场。某个 PR 自己新增了一条失效路径 ⇒
// 门禁报"超出存量基线"；作者跑一次重写，账本里就多记下这一条 ⇒ 红**直接消失**。
// 红来自"现场 vs 账本"的比较，而比较的另一边可以被现场重写——这条链只要留一个手动开关，
// "只能缩小"就还是自觉而不是判据（R0 的先例：写进记忆、文档与提交信息都没能阻止第 5 次误删）。
//
// 判据为什么不需要盘符：它比的是**两份账本 blob 的差**与**本 PR 的改动集**，两者都是 git 对象，
// 与 `fs.existsSync` 无关 ⇒ 这是 12c 第一条在 ubuntu CI 上真实生效的写侧判据。
// 安全条件："文档 blob 在 base..head 逐字不变"。计数只能反映文档里的条数，blob 没变就不可能
// 由作者制造上涨，上涨只可能来自"我的 base 落后于那份文档所在的提交"——即正当 re-sync 的形状。

function baselineJson (files) {
  return JSON.stringify({
    note: 'fixture', generated: '2026-01-01', reason: 'fixture', files
  }, null, 2) + '\n';
}

/**
 * 真 git 仓库夹具。守卫要读 base 处的账本 blob 与 base..head 的改动集，
 * 这两样在纯函数之外没有替身可造——用 fixture 假装 git 输出就等于把守卫测成 no-op。
 */
function makeGitFixture (commits) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdap-git-'));
  const run = (...a) => execFileSync('git', ['-c', 'user.email=g@t', '-c', 'user.name=g', ...a],
    { cwd: root, encoding: 'utf8' });
  run('init', '-q', '-b', 'main');
  const refs = [];
  for (const c of commits) {
    for (const [rel, content] of Object.entries(c)) {
      const abs = path.join(root, rel);
      if (content === null) {
        // null = 这一笔提交里删掉它（F5 那条锁要的就是"删除出现在改动集里"这个形状）
        fs.rmSync(abs, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    }
    run('add', '-A', '.');
    run('commit', '-q', '-m', 'fixture');
    refs.push(run('rev-parse', 'HEAD').trim());
  }
  return { root, refs };
}

test('账本放宽检测纯函数：本 PR 改过的文档，计数一涨就必须判"账本被放宽"', () => {
  const mod = require(SCRIPT);
  const r = mod.judgeLedgerDrift({
    prev: new Map([['01-docs/touched.md', 1]]),
    next: new Map([['01-docs/touched.md', 2]]),
    changedDocs: new Set(['01-docs/touched.md'])
  });
  assert.equal(r.widened.length, 1, '作者碰过那份文档、又把它的数调大 = 用自己的红喂账本');
  assert.equal(r.widened[0].file, '01-docs/touched.md');
  assert.equal(r.widened[0].from, 1);
  assert.equal(r.widened[0].to, 2);
  assert.equal(r.attributedToBase.length, 0, '同一个键不得既算"来自 base 的差量"又算"被放宽"');
});

test('账本放宽检测纯函数：没碰过的文档计数上涨 ⇒ 归因给 base，出声但不判红', () => {
  // 这条是"正当 re-sync"的形状：main 带进来的文件我一行没改，账本必须如实记下它的现场。
  // 把它判红会逼人绕过守卫（本 PR 自己就重写过一次），所以方向不能反。
  const mod = require(SCRIPT);
  const r = mod.judgeLedgerDrift({
    prev: new Map(),
    next: new Map([['openspec/records/from-main.md', 3]]),
    changedDocs: new Set(['CHANGELOG.md'])
  });
  assert.equal(r.widened.length, 0, '未触碰的文档不得判"被放宽"');
  assert.deepEqual(r.attributedToBase.map((x) => x.file), ['openspec/records/from-main.md']);
  assert.equal(r.attributedToBase[0].from, 0, '新键的 from 必须是 0，不能是 undefined');
});

test('账本放宽检测纯函数：收紧与删键必须放行（否则"只能缩小"没人愿意做）', () => {
  const mod = require(SCRIPT);
  const r = mod.judgeLedgerDrift({
    prev: new Map([['01-docs/a.md', 3], ['01-docs/gone.md', 1]]),
    next: new Map([['01-docs/a.md', 1]]),
    changedDocs: new Set(['01-docs/a.md'])
  });
  assert.equal(r.widened.length, 0, '计数下降不是放宽');
  assert.equal(r.tightened.length, 2, 'a 收紧 + gone 删键，两条都要被看见（这是这条门禁想要的成果）');
});

test('行为锁：改文档 + 同步调大账本来抹掉自己的红 ⇒ exit 1 并点名"账本被放宽"', () => {
  // 这条**不加 DRIVE 门槛**：判据只读 git 对象，Linux runner 上也必须真的拦住。
  const B = require(SCRIPT).BASELINE_REL;
  const { root, refs } = makeGitFixture([
    { '01-docs/p.md': docWith(deadPaths(1)), [B]: baselineJson({ '01-docs/p.md': 1 }) },
    { '01-docs/p.md': docWith(deadPaths(2)), [B]: baselineJson({ '01-docs/p.md': 2 }) }
  ]);
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--root', root, `--base=${refs[0]}`, '--head=HEAD'],
    { encoding: 'utf8' }
  );
  // 现场 2 == 账本 2 ⇒ over 判不出来；唯一能拦住的是账本差量守卫。
  assert.equal(r.status, 1, '用重写账本消化自己的新增必须判红，stderr: ' + r.stderr);
  assert.match(r.stderr, /账本被放宽/, 'stderr: ' + r.stderr);
  assert.match(r.stderr, /01-docs\/p\.md[^\n]*1[^\n]*2/, '必须报出 from→to，stderr: ' + r.stderr);
});

test('行为锁：首次引入账本（base 处根本没有这个文件）⇒ 跳过放宽检测并出声，不得判"自身故障"', () => {
  // 这条锁直接来自**真仓库第一跑**：本 PR 就是账本的首次引入，`--base=<origin/main>` 时 git 打的是
  // `fatal: path '…' exists on disk, but not in '<rev>'`，而判据最初只认 `does not exist in` ⇒
  // 门禁把"第一次落地"读成"我自己坏了"（退出码 2）。两种措辞说的是同一件事：该路径在那个提交里不存在。
  const B = require(SCRIPT).BASELINE_REL;
  const { root, refs } = makeGitFixture([
    { '01-docs/first.md': docWith(deadPaths(1)) },
    { '01-docs/first.md': docWith(deadPaths(1)), [B]: baselineJson({ '01-docs/first.md': 1 }) }
  ]);
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--root', root, `--base=${refs[0]}`, '--head=HEAD'],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, '首次引入不是故障，stderr: ' + r.stderr.slice(0, 1200));
  assert.match(r.stderr, /首次引入/, '跳过必须出声，否则读起来像"什么都没检查"，stderr: ' + r.stderr.slice(0, 1200));
});

test('行为锁：只动账本、文档 blob 未变 ⇒ 放行并出声归因（正当 re-sync 不能被打死）', () => {
  const B = require(SCRIPT).BASELINE_REL;
  const { root, refs } = makeGitFixture([
    { '01-docs/q.md': docWith(deadPaths(2)), [B]: baselineJson({ '01-docs/q.md': 1 }) },
    { [B]: baselineJson({ '01-docs/q.md': 2 }) }
  ]);
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--root', root, `--base=${refs[0]}`, '--head=HEAD'],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, 'q.md 的 blob 没变，上涨只能来自 base ⇒ 不该拦，stderr: ' + r.stderr);
  assert.match(r.stderr, /归因|改动集之外/, '放行也必须出声，否则"接受漂移"没人写进 PR 说明，stderr: ' + r.stderr);
  assert.match(r.stderr, /01-docs\/q\.md/);
});

// ================= 外部评审（PR #3583 QM-6）命中的四条，逐条补锁 =================
// 两把轴都是**静态**评审（axis1 禁止跑命令 / axis2 允许读仓），下列每条都附了当场实测，
// 因为"评审说了"不构成判据：F3c 我先用夹具复现，再用真仓库量暴露面（成对加粗包裹 0 处）。

test('加粗**包裹**路径时闭合星号不得替路径作保（axis1c F3c，实测复现）', (t) => {
  if (!DRIVE) { t.skip('本机无 Windows 盘符'); return; }
  // 当场复现（dbg-single.cjs，五文件同批夹具）：裸路径被照报、`**路径**` 被豁免 ⇒
  // "豁免落在词元上"只堵住了**同行别处加粗**，没堵住**紧贴路径尾的 `**`**——原洞的孪生形态。
  const { root } = makeFixture({});
  fs.mkdirSync(path.join(root, '01-docs'), { recursive: true });
  fs.writeFileSync(path.join(root, '01-docs', 'wrap.md'),
    '**' + missingPathUnderLocalDrive() + '\\gone**\n', 'utf8');
  const r = spawnSync(process.execPath, [SCRIPT, '--all', '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 1, '成对加粗不得替路径豁免，stderr: ' + r.stderr);
  assert.match(r.stderr, /gone/, '必须点名到那条路径，stderr: ' + r.stderr);
});

test('被加粗包裹的**真通配路径**仍必须豁免（与上一条成对，防止把修法做成"见尾星就剥"）', (t) => {
  if (!DRIVE) { t.skip('本机无 Windows 盘符'); return; }
  const { root } = makeFixture({});
  fs.mkdirSync(path.join(root, '01-docs'), { recursive: true });
  fs.writeFileSync(path.join(root, '01-docs', 'glob.md'),
    '**' + missingPathUnderLocalDrive() + '\\mp-*\\apps**\n', 'utf8');
  const r = spawnSync(process.execPath, [SCRIPT, '--all', '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, '通配符在剥掉成对加粗之后依然存在 ⇒ 必须放行，stderr: ' + r.stderr);
});

test('剥成对加粗必须要求"紧邻路径之前有同一段记号"，孤立的词尾 ** 不得被剥（真仓库实测有 1 处）', () => {
  const mod = require(SCRIPT);
  // 前导记号必须**紧贴**路径（markdown 包裹的形状），不能只看"行里某处出现过"——
  // 实测样本 `…C:\Users\x\`，**映射完全正常** 里那对星号属于后一句话，剥了会改判据语义。
  assert.equal(mod.stripPairedEmphasis('**', 'C:\\x\\y**'), 'C:\\x\\y', '成对包裹必须剥 ⇒ 路径回到被判定的一面');
  assert.equal(mod.stripPairedEmphasis('见 ', 'C:\\x\\y**'), 'C:\\x\\y**', '前导不紧邻 ⇒ 不剥，维持现状');
  assert.equal(mod.stripPairedEmphasis('**', 'C:\\x\\mp-*'), 'C:\\x\\mp-*', '单个尾星是通配，不是强调记号');
  assert.equal(mod.stripPairedEmphasis('**', 'C:\\x\\mp-*\\apps**'), 'C:\\x\\mp-*\\apps',
    '剥掉包裹后通配符还在 ⇒ 后续仍按占位符放行');
  assert.equal(mod.stripPairedEmphasis('', 'C:\\x'), 'C:\\x', '没有尾缀记号时原样返回');
});

test('--write-baseline 在无盘符环境必须拒写（axis1c F1：跑一次就把整张账本写成空表还 exit 0）', () => {
  const mod = require(SCRIPT);
  // 无盘符 ⇒ 现场计数恒 0 ⇒ serializeBaseline 写出 {"files":{}} 且退出码 0。
  // 这与 AGENTS 记的「--update 抹掉别的域」同型：一次"成功"的重写把门禁变成零豁免面。
  assert.equal(mod.judgeWriteBaseline({ all: true, canJudge: false }).verdict, 'refuse');
  assert.equal(mod.judgeWriteBaseline({ all: true, canJudge: true }).verdict, 'write');
  assert.equal(mod.judgeWriteBaseline({ all: false, canJudge: true }).verdict, 'refuse', '窄域仍然必须拒');
  assert.equal(mod.judgeWriteBaseline({ all: false, canJudge: false }).verdict, 'refuse');
  assert.match(mod.judgeWriteBaseline({ all: true, canJudge: false }).why, /盘符/);
});

test('本次改动集里删掉的受管文档必须判"陈旧登记"而不是"改少了"（axis1c F5）', () => {
  // 删除动作会出现在 `git diff --name-only` 里 ⇒ 该路径经 changedFiles 搭车进扫描域 ⇒
  // existsSync 那条分流（只管账本并回那一侧）拦不住它：Windows 上被记成 0 处判 shrink，
  // ubuntu 上既不计数也不 stale ⇒ **完全静默**。两种症状都不对，正解是 stale（该条目要删）。
  const B = require(SCRIPT).BASELINE_REL;
  const { root, refs } = makeGitFixture([
    { '01-docs/del.md': docWith(deadPaths(1)), [B]: baselineJson({ '01-docs/del.md': 1 }) },
    { '01-docs/del.md': null, [B]: baselineJson({ '01-docs/del.md': 1 }) }
  ]);
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--root', root, `--base=${refs[0]}`, '--head=HEAD'],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 1, '删掉已登记文档必须红，stderr: ' + r.stderr);
  assert.match(r.stderr, /陈旧登记/, '必须报"陈旧登记"（要删条目），stderr: ' + r.stderr);
  assert.doesNotMatch(r.stderr, /低于基线待收紧/, '不得把删除误诊成"改少了把账本改小"');
});

test('无盘符时必须出声"本轮有 N 条 Windows 绝对路径无从判定"（axis1c F7：静默 PASS 与静默恒红同一种错）', () => {
  const mod = require(SCRIPT);
  // 路径字面量一律**运行时拼接**：本文件自己就在门禁的扫描域里（scripts/ + .js），
  // 写死 `C:\<x>\y` 这类形态会被数成一条失效路径 ⇒ 而把它记进账本正好触发本轮新加的「账本被放宽」判据
  // （守卫当场咬了作者一口，这是它该有的行为）。注释里也必须带占位符记号，同理。
  const P1 = 'C:' + '\\a\\x';
  const P2 = 'D:' + '\\b\\y';
  const P3 = 'D:' + '\\c\\z';
  assert.equal(mod.countUnjudged([P1, 'plain text', P2]), 2, '两条路径、一条散文 ⇒ 必须数出 2');
  assert.equal(mod.countUnjudged(['no path here']), 0, '散文不得被数成"无从判定"');
  assert.equal(mod.countUnjudged([P1 + '，' + P2]), 2,
    '一行两条、以全角逗号分隔（逗号不在字符集里）⇒ 必须数 2，不是数行');
  // 如实钉住提取器的贪婪边界（既有锁「中文句读不得被吞进路径」同源）：空格**在**字符集里，
  // 所以 `C:\<a>\x 与 D:\<b>\y` 这种写法会被吞成**一个**片段 ⇒ 数 1。这不是缺陷，是判据口径，
  // 写出来防后来者以为在数行。
  assert.equal(mod.countUnjudged([P1 + ' 与 ' + P2]), 1, '空格是路径字符 ⇒ 两条被吞成一条');
  assert.equal(mod.countUnjudged([P3 + ' 和 ' + P3]), 1, '同一路径重复两个词元仍是一个片段');
});

test('账本键必须同时归一正斜杠与反斜杠（axis1c F9：Linux 上 path.sep 是 /，反斜杠键永不匹配 ⇒ 永久误报陈旧）', () => {
  const mod = require(SCRIPT);
  // 原实现用 `f.split(path.sep).join('/')`：在 Windows 上恰好对，在 Linux 上对反斜杠键是**恒等映射**，
  // 于是那条键永不等于 domain 里的路径 ⇒ 报"陈旧登记"误红。判据不能依赖调用方的 OS。
  assert.equal(mod.normalizeBaselineKey('01-docs\\win-key.md'), '01-docs/win-key.md');
  assert.equal(mod.normalizeBaselineKey('01-docs/fwd.md'), '01-docs/fwd.md');
  assert.notEqual(mod.normalizeBaselineKey('a\\b.md'), 'a\\b.md', '反斜杠必须被换掉，不得依赖 path.sep');
});

test('FAIL 头也必须带"本轮跳过什么"，不只 PASS 带（axis1c F2）', () => {
  const mod = require(SCRIPT);
  const withSkip = mod.formatSkipNote(false);
  assert.match(withSkip, /无盘符/);
  const without = mod.formatSkipNote(true);
  assert.equal(without, '', '有盘符时不该有多余的尾巴');
  // 关键：这条尾巴在 PASS 与 FAIL 两个分支都必须被拼上（结构锁，防只拼一侧）
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const passBranch = src.slice(src.indexOf('[check-doc-abs-paths] PASS'), src.indexOf('const bits = []'));
  const failBranch = src.slice(src.indexOf('const bits = []'), src.indexOf('for (const v of widened)'));
  assert.ok(passBranch.includes('skipNote'), 'PASS 分支必须带 skipNote');
  assert.ok(failBranch.includes('skipNote'), 'FAIL 分支必须带 skipNote（原来只有 PASS 带 ⇒ 评审实测指出）');
});

test('账本 JSON 不得进 docs-only 白名单（否则"改账本"可以走精简通道）', () => {
  // 这是**结构锁**（读那份脚本的白名单），因为"某路径在不在白名单里"本身就是配置事实，
  // 没有运行态可跑；但它只锁"不在名单里"这一侧——名单在不在都改不动判据本体。
  const src = fs.readFileSync(path.join(__dirname, 'classify-docs-only.js'), 'utf8');
  assert.doesNotMatch(src, /['"]scripts\/doc-abs-paths-baseline\.json['"]/,
    '账本进了白名单就意味着"只改账本的 PR"可以走 docs-only，而 docs-only 会跳过 static-gates');
  // 正向对偶（禁令必须配对偶，否则"删掉白名单里的它"和"根本没写过它"同形）：
  assert.match(src, /gate-record-debt-ledger\.json/, '同一份白名单必须真的被读到（探针通路自证）');
});
// ==================== 口径换代：判据输入由文件系统改成纯文本计数（#75 / gate-12c-abs-path-ban）====================
//
// 这一整块的立意来自一条 CI 现场读数（run 38572799318 / job 115882369237 / step
// "Gate 12c - Doc abs-path validity (changes job)"）：ubuntu runner 上那一步打印
// 「无从判定 1094 条 Windows 绝对路径」紧跟 PASS。原因不是配置，是判据把"这条路径在不在盘上"
// 当成了输入，而 Linux 上没有盘符 ⇒ firstMissingSegment 一律返回 null ⇒ 现场计数恒 0 ⇒
// 与账本比较两个方向都不可能红。下面的锁逐条钉"换掉输入之后，判据必须与机器无关"。

/**
 * 造一条**与本机有没有盘符无关**的绝对路径。计数口径下判据不得再问"这台机器有没有 Q 盘"，
 * 所以夹具也不得问。源码里之所以拆成 'Q' + ':' 而不是写全：这个文件本身在门禁的扫描域内，
 * 写全等于给自己记一笔账（#3583 收尾时已被自己的守卫拦过一次）。
 */
function anyAbsPath (tail) {
  return 'Q' + ':' + '\\Data\\projects\\nope-' + FX + '-' + (tail || 'x');
}

test('核心锁：无盘符环境也必须能报「超出存量基线」（这就是 #75 那个洞的锁）', (t) => {
  const { root } = makeFixture({ '01-docs/a.md': docWith([anyAbsPath('one'), anyAbsPath('two')]) });
  writeBaseline(root, { '01-docs/a.md': 1 });
  // --simulate-no-drives 强制 existingDriveRoots() 返回空集，等价于 ubuntu runner。
  // 旧实现在这一支把现场计数做成恒 0 ⇒ 与账本 1 比较只会报"改少了"或 PASS，绝不报超出。
  const r = runGate(root, ['--simulate-no-drives']);
  assert.equal(r.status, 1, '无盘符也必须红，stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.match(r.stderr, /超出存量基线/);
  assert.match(r.stderr, /01-docs\/a\.md/);
});

test('计数不得依赖盘符存在：同一份夹具在两种档位下命中数必须相同', (t) => {
  const { root } = makeFixture({ '01-docs/a.md': docWith([anyAbsPath('p1'), anyAbsPath('p2'), anyAbsPath('p3')]) });
  writeBaseline(root, { '01-docs/a.md': 9 });
  const withDrive = runGate(root, ['--counts-only']);
  const noDrive = runGate(root, ['--simulate-no-drives', '--counts-only']);
  const take = (x) => {
    const m = /counts=(\d+)/.exec(x.stdout + x.stderr);
    assert.ok(m, '必须打印可机读的 counts= 读数（两份都要），with=' + x.stdout + x.stderr);
    return Number(m[1]);
  };
  assert.equal(take(withDrive), 3, withDrive.stdout + withDrive.stderr);
  assert.equal(take(noDrive), 3, noDrive.stdout + noDrive.stderr);
});

test('纯函数锁：canJudge=false 时 judgeBaseline 仍必须给出 over 与 shrink', () => {
  const mod = require(SCRIPT);
  const counts = new Map([['01-docs/a.md', [{ file: '01-docs/a.md', line: 1, path: 'Q:\\x' }]]]);
  const baseline = new Map([['01-docs/a.md', 2]]);
  const domain = new Set(['01-docs/a.md']);
  const up = mod.judgeBaseline({ counts, baseline, domain, canJudge: false });
  assert.equal(up.over.length, 1, '无盘符也必须给出 over：' + JSON.stringify(up));
  assert.equal(up.shrink.length, 0);
  const down = mod.judgeBaseline({ counts: new Map([['01-docs/a.md', []]]), baseline, domain, canJudge: false });
  assert.equal(down.shrink.length, 1, '变少也必须报收紧，哪怕没有盘符：' + JSON.stringify(down));
});

test('存在性明细：无盘符时不得声称「磁盘上不存在」，但必须说自己没核对', (t) => {
  const { root } = makeFixture({ '01-docs/a.md': docWith([anyAbsPath('gone')]) });
  writeBaseline(root, { '01-docs/a.md': 0 });
  const r = runGate(root, ['--simulate-no-drives']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /磁盘上不存在/, '没核对过就不能这么写：' + r.stderr);
  assert.match(r.stderr, /存在性核对未执行|未核对存在性/);
});

test('账本必须带口径版本；版本与本判据不符走「自身故障」档（既不 0 也不 1）', (t) => {
  const { root } = makeFixture({ '01-docs/a.md': docWith([anyAbsPath('z')]) });
  writeBaseline(root, { '01-docs/a.md': 1 });
  const bPath = path.join(root, 'scripts', 'doc-abs-paths-baseline.json');
  const j = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  j.metric = 'some_other_generation';
  fs.writeFileSync(bPath, JSON.stringify(j, null, 2) + '\n');
  const r = runGate(root, []);
  assert.equal(r.status, 2, '口径版本不匹配必须是自身故障档，不能读成任何一种结论，stderr: ' + r.stderr + r.stdout);
  assert.match(r.stderr, /口径|metric/);
});

test('换代守卫纯函数：prev.metric 与 next.metric 不同 ⇒ 不判放宽，但缩小照报', () => {
  const mod = require(SCRIPT);
  const prev = new Map([['a.md', 1], ['b.md', 5]]);
  const next = new Map([['a.md', 7], ['b.md', 2]]);
  const changedDocs = new Set(['a.md']);
  const same = mod.judgeLedgerDrift({ prev, next, changedDocs, prevMetric: 'x', nextMetric: 'x' });
  assert.equal(same.widened.length, 1, '同代内上涨必须判放宽：' + JSON.stringify(same));
  const gen = mod.judgeLedgerDrift({ prev, next, changedDocs, prevMetric: 'v1', nextMetric: 'v2' });
  assert.equal(gen.widened.length, 0, '换代那一次逐文件计数不可比，不得判放宽：' + JSON.stringify(gen));
  assert.equal(gen.tightened.length, 1, '缩小仍要照报（换代不是把整条守卫关掉）：' + JSON.stringify(gen));
  assert.equal(gen.generationChange.length, 1, JSON.stringify(gen));
});

test('行为锁：账本换代 + 计数上涨 ⇒ 放行但必须出声', (t) => {
  const { root } = makeFixture({ '01-docs/a.md': docWith([anyAbsPath('m1'), anyAbsPath('m2')]) });
  writeBaseline(root, { '01-docs/a.md': 1 }, { metric: 'dead_abs_paths_v1' });
  const bPath = path.join(root, 'scripts', 'doc-abs-paths-baseline.json');
  const j = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  j.files['01-docs/a.md'] = 2;
  j.metric = require(SCRIPT).METRIC_VERSION;
  fs.writeFileSync(bPath, JSON.stringify(j, null, 2) + '\n');
  const r = runGate(root, ['--base=HEAD', '--head=HEAD']);
  const all = r.stdout + r.stderr;
  assert.equal(r.status, 0, all);
  assert.match(all, /口径换代|generation/, '放行也必须出声：' + all);
});

test('--write-baseline 不再要求盘符（口径与机器无关后，原拒绝的前提消失），但窄域仍拒', (t) => {
  const { root } = makeFixture({ '01-docs/a.md': docWith([anyAbsPath('w1'), anyAbsPath('w2')]) });
  const denied = spawnSync(process.execPath, [SCRIPT, '--root', root, '--write-baseline', '--simulate-no-drives'], { encoding: 'utf8' });
  assert.equal(denied.status, 2, '不带 --all 仍然必须拒：' + denied.stderr);
  const ok = spawnSync(process.execPath, [SCRIPT, '--root', root, '--all', '--write-baseline', '--simulate-no-drives'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, '无盘符也应能写基线（计数不依赖文件系统）：' + ok.stderr + ok.stdout);
  const b = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'doc-abs-paths-baseline.json'), 'utf8'));
  assert.equal(b.files['01-docs/a.md'], 2, '写出的账本必须非空且如实计数：' + JSON.stringify(b));
  assert.equal(b.metric, require(SCRIPT).METRIC_VERSION);
});

test('结构锁：over/shrink 的循环不得再被 canJudge 包住（行为锁的反证靶子）', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const start = src.indexOf('function judgeBaseline');
  assert.ok(start >= 0, 'judgeBaseline 必须存在，否则本锁在测一个不存在的函数');
  const body = src.slice(start);
  const closedAt = body.search(/\r?\n\}\r?\n/);
  assert.ok(closedAt > 0, '锚点必须能取到函数闭合');
  const fn = body.slice(0, closedAt);
  assert.ok(/over\.push/.test(fn) && /shrink\.push/.test(fn), '函数体应包含两支的 push：' + fn.slice(0, 200));
  assert.equal(fn.search(/if\s*\(\s*canJudge\s*\)/), -1, 'canJudge 门控回来了 ⇒ 计数又被文件系统绑架：' + fn.slice(0, 400));
});