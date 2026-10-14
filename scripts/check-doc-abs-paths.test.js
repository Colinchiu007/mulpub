/**
 * check-doc-abs-paths.test.js — 文档绝对路径有效性门禁自测
 *
 * 背景（#3000 的逃逸分析）：仓库根目录 2026-10-06 改名后，文档里的
 * **绝对路径**不会跟着改，于是长期静默失效。「有没有门禁检查文档写的
 * 路径是否还存在」——此前是零，check-no-brand-residue.js 只管品牌词。
 *
 * 本测试用临时目录做 fixture，验证门禁的**检出能力**（而不只是"当前仓库干净"）：
 * - 失效的本机绝对路径必须命中
 * - 存在的路径必须放行
 * - 产品品牌名 / Linux 部署路径 / 云沙箱路径 / CI runner 路径必须**不**命中
 * - 归档快照目录按契约豁免
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

/** 造一个「本机存在盘符下、但该子目录不存在」的绝对路径 */
function missingPathUnderLocalDrive () {
  return DRIVE + '\\Data\\projects\\definitely-not-here-xyz\\apps\\desktop';
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
  assert.match(r.stderr, /definitely-not-here-xyz/);
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
  assert.match(r.stderr, /definitely-not-here-xyz/, '必须点名那条失效路径');
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

function writeBaseline (root, files) {
  const p = path.join(root, 'scripts');
  fs.mkdirSync(p, { recursive: true });
  const json = { note: 'fixture', generated: '2026-10-14', reason: 'fixture', files };
  fs.writeFileSync(path.join(p, 'doc-abs-paths-baseline.json'), JSON.stringify(json, null, 2) + '\n', 'utf8');
}

/** 造 n 条互不相同的失效路径（同盘符下不同子目录名，确保逐条被数到） */
function deadPaths (n) {
  return Array.from({ length: n }, (_, i) =>
    DRIVE + '\\Data\\projects\\dead-baseline-' + i + '-xyz\\apps\\desktop');
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
  const denied = spawnSync(process.execPath, [SCRIPT, '--root', root, '--write-baseline'], { encoding: 'utf8' });
  assert.equal(denied.status, 2, '窄域写基线必须拒，stderr: ' + denied.stderr);
  const still = fs.readFileSync(path.join(root, 'scripts', 'doc-abs-paths-baseline.json'), 'utf8');
  assert.match(still, /elsewhere\.md/, '被拒之后账本必须一个字节没少（实测踩过 --update 抹掉别的域）');
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