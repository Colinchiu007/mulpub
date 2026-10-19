'use strict';
/**
 * scripts/check-blanket-fs-mock.test.js — 「blanket fs 夹具」棘轮自身的回归
 *
 * 为什么必须有：#2794 那颗（`__registerMock('fs', …)` 对本 realm 里每一个 require('fs') 谎报，
 * 而同一 realm 里真实执行的 `electron/index.js` 据此以为二进制没备好（实测与 `deps.inline:['electron']` 无关，
 * 摘掉它 banner 照样出现，见 `docs/deps-inline-electron-evaluation.md`），
 * 当场 spawn install.js 并把下载 banner 记到"正在跑的那条用例"名下）只修了一个文件。
 * 剩下的按实测是 12 个，全部带"本文件已 __enableElectronMock ⇒ 该路径不通"这类**逐文件核对过**的原因。
 * 没有棘轮的话，这个类会重新长回来，而且和上次一样：本地全绿、CI 里表现成随机超时。
 *
 * 夹具一律注入 files/readFile，不改真实工作树（反证不得执行被守卫的动作）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const mod = require('./check-blanket-fs-mock.js');
const { collectProblems, classify, stripComments } = mod;

function fixture(files, texts) {
  const readFile = (rel) => (Object.prototype.hasOwnProperty.call(texts, rel) ? texts[rel] : null);
  return { files, readFile };
}

/** 通过全部下界所需的最小合法域（面数地板与"域退化"判据要能自然满足） */
function manyFiles(extra) {
  const list = Object.assign({}, extra || {});
  const files = Object.keys(list);
  while (files.length < mod.MIN_TEST_FILES) {
    const n = files.length;
    const name = 'packages/pkg-' + n + '/src/a' + n + '.test.js';
    files.push(name);
    list[name] = '// 无 fs 夹具\n';
  }
  return { files, texts: list };
}

test('blanket fs 夹具必须判违规，沙箱限定+委托真实 fs 的必须放过', () => {
  const blanket = "const { vi } = require('vitest')\n__registerMock('fs', {\n  existsSync: vi.fn().mockReturnValue(false),\n})\n";
  const delegated = [
    "const { vi } = require('vitest')",
    "const realFs = require('node:fs')",
    "const SANDBOX = require('node:path').join(require('node:os').tmpdir(), 'x-' + process.pid)",
    'const isSandboxPath = (p) => {',
    "  const n = String(p).replace(/\\\\/g, '/')",
    "  const s = SANDBOX.replace(/\\\\/g, '/')",
    '  return n === s || n.startsWith(s + \'/\')',
    '}',
    "__registerMock('fs', {",
    '  existsSync: vi.fn((p) => (isSandboxPath(p) ? false : realFs.existsSync(p))),',
    '})',
  ].join('\n');

  const bad = classify(blanket);
  assert.equal(bad.verdict, 'BLANKET', 'blanket 夹具没被判出来');
  const good = classify(delegated);
  assert.equal(good.verdict, 'SANDBOX_DELEGATED', '已收敛形状被误判：' + JSON.stringify(good));

  const dom = manyFiles({ 'apps/desktop/tests/a.test.js': blanket });
  const r = collectProblems(Object.assign({ minTestFiles: 1, checkIgnored: false, knownBlanket: {} }, fixture(dom.files, dom.texts)));
  assert.ok(r.problems.some((p) => /BLANKET|blanket/.test(p) && /a\.test\.js/.test(p)),
    '新增 blanket 面必须红，实际：\n' + r.problems.join('\n'));

  const dom2 = manyFiles({ 'apps/desktop/tests/a.test.js': delegated });
  const r2 = collectProblems(Object.assign({ minTestFiles: 1, checkIgnored: false, knownBlanket: {} }, fixture(dom2.files, dom2.texts)));
  assert.deepEqual(r2.problems, [], '已收敛形状不得被判问题：\n' + r2.problems.join('\n'));
});

test('注释里的 __registerMock 不算夹具注册（否则判据可被一行注释绕过或误报）', () => {
  const commented = [
    "// __registerMock('fs', { existsSync: () => false })  // 历史写法，已删",
    '/* __registerMock("fs", { readFileSync: () => "" }) */',
    "const x = 1 // __registerMock('fs', {})",
  ].join('\n');
  assert.equal(classify(commented).verdict, 'NONE', '注释里的同名字样被当成了真实注册');
  assert.equal(stripComments("// a\nfoo(); // b\n").trim(), 'foo();', '剥注释实现没剥整行/行尾');
});

test('vi.mock 形态与 __registerMock 形态必须同域（否则换一种写法就逃出判据）', () => {
  const viaViMock = "import { vi } from 'vitest'\nvi.mock('fs', () => ({ existsSync: () => false }))\n";
  assert.equal(classify(viaViMock).verdict, 'BLANKET', "vi.mock('fs') 形态没被枚举到");
  const viaViMockNode = "vi.mock('node:fs', () => ({ existsSync: () => false }))\n";
  assert.equal(classify(viaViMockNode).verdict, 'BLANKET', 'node:fs 前缀形态没被枚举到');
});

test('欠账必须带原因；陈旧登记与键漂移当场红（销账与收敛必须同一次发生）', () => {
  const blanket = "__registerMock('fs', { existsSync: () => false })\n";
  const filesMap = { 'apps/desktop/tests/a.test.js': blanket };
  const dom = manyFiles(filesMap);
  const opts = { minTestFiles: 1, checkIgnored: false };

  const noReason = collectProblems(Object.assign({}, opts,
    { knownBlanket: { 'apps/desktop/tests/a.test.js': '' } }, fixture(dom.files, dom.texts)));
  assert.ok(noReason.problems.some((p) => /原因/.test(p)), '空原因的欠账必须红：\n' + noReason.problems.join('\n'));

  const stale = collectProblems(Object.assign({}, opts,
    { knownBlanket: { 'apps/desktop/tests/gone.test.js': '已不存在' } }, fixture(dom.files, dom.texts)));
  assert.ok(stale.problems.some((p) => /陈旧/.test(p)), '指向不存在文件的欠账必须红：\n' + stale.problems.join('\n'));

  const ok = collectProblems(Object.assign({}, opts,
    { knownBlanket: { 'apps/desktop/tests/a.test.js': '本文件已 __enableElectronMock，理由实测' } }, fixture(dom.files, dom.texts)));
  assert.deepEqual(ok.problems, [], '带原因的登记应放过：\n' + ok.problems.join('\n'));
});

test('枚举退化必须 fail closed，不得报成"全仓合规"', () => {
  const r = collectProblems(Object.assign({ minTestFiles: 500, checkIgnored: false, knownBlanket: {} }, fixture([], {})));
  assert.ok(r.problems.some((p) => /枚举|退化/.test(p)), '空域必须红，实际：\n' + r.problems.join('\n'));
});

test('读不动的文件不得静默跳过（不完整的遍历判全绿是假绿）', () => {
  const dom = manyFiles({ 'apps/desktop/tests/broken.test.js': 'x' });
  const opts = {
    minTestFiles: 1,
    checkIgnored: false,
    knownBlanket: {},
    files: dom.files,
    readFile: (rel) => {
      if (rel === 'apps/desktop/tests/broken.test.js') throw new Error('EACCES simulated');
      return Object.prototype.hasOwnProperty.call(dom.texts, rel) ? dom.texts[rel] : null;
    },
  };
  let r = null;
  assert.doesNotThrow(() => { r = collectProblems(opts); }, '读不动时不得把整个门禁炸掉，但必须报问题');
  assert.ok(r.problems.some((p) => /读不动|unreadable/i.test(p)), 'unreadable 必须出声：\n' + r.problems.join('\n'));
});

test('正文缺失（readFile 返回 null）不得算"已扫描"（夹具少给一个键 = 该文件从没被判定）', () => {
  const dom = manyFiles({});
  // manyFiles 给每个文件都备了正文；这里故意抹掉一个，模拟"枚举里有、判据域里没有"
  const ghost = dom.files[7];
  delete dom.texts[ghost];
  const r = collectProblems(Object.assign({ minTestFiles: 1, checkIgnored: false, knownBlanket: {} },
    fixture(dom.files, dom.texts)));
  assert.ok(r.problems.some((p) => /正文缺失|从未被判定/.test(p) && p.indexOf(ghost) >= 0),
    '缺正文必须点名该文件并出声：\n' + r.problems.join('\n'));
  assert.equal(r.unreadable, 1, '缺正文必须计入 unreadable，否则"读不动=0"这句现场话在说谎');
});

test('沙箱判据必须是"按路径段"，裸 startsWith 不算收敛（<沙箱>-evil 会被谎报成不存在）', () => {
  const naked = [
    "const realFs = require('node:fs')",
    "const SANDBOX = '/tmp/mp-x'",
    "__registerMock('fs', {",
    '  existsSync: vi.fn((p) => (String(p).startsWith(SANDBOX) ? false : realFs.existsSync(p))),',
    '})',
  ].join('\n');
  const v = classify(naked);
  assert.equal(v.verdict, 'BLANKET', '裸 startsWith 被判成已收敛 ⇒ 近名目录仍在被谎报：' + JSON.stringify(v));
  assert.match(String(v.missing), /路径段|evil/, '原因文案没指出缺的是路径段判据：' + v.missing);
});

/** 已收敛形状的共同前缀（沙箱来自 os.tmpdir()，与现场两处夹具同形） */
const CONV_HEAD = [
  "const realFs = require('node:fs')",
  "const SBX = require('node:path').join(require('node:os').tmpdir(), 'mp-x-' + process.pid)",
  'const isSandboxPath = (p) => {',
  "  const n = String(p).replace(/\\\\/g, '/')",
  "  const s = SBX.replace(/\\\\/g, '/')",
  '  return n === s || n.startsWith(s + \'/\')',
  '}',
];
const CONV_BODY = [
  "__registerMock('fs', {",
  '  existsSync: vi.fn((p) => (isSandboxPath(p) ? false : realFs.existsSync(p))),',
  '  readFileSync: vi.fn((p, ...r) => (isSandboxPath(p) ? \'\' : realFs.readFileSync(p, ...r))),',
  '})',
];

test('正控：沙箱来自 os.tmpdir() + 按路径段 + 动词真调用句柄 ⇒ 必须放过', () => {
  assert.equal(classify(CONV_HEAD.concat(CONV_BODY).join('\n')).verdict, 'SANDBOX_DELEGATED');
});

test('字符串字面量里的 `//` 不得吃掉同一行的注册点（QM-6 C2：静默漏检方向）', () => {
  const same = "const url = 'string // with slash'; __registerMock('fs', { existsSync: () => false })";
  assert.equal(classify(same).verdict, 'BLANKET', '同行字符串里的 // 把真注册整段切掉了：' + JSON.stringify(classify(same)));
  // 反向：注释里的同名调用仍然不算
  assert.equal(classify("// __registerMock('fs', { existsSync: () => false })\n").verdict, 'NONE');
});

test('字符串/模板里的不成对花括号不得把边界数错（QM-6 W1：误报与洗白双向）', () => {
  const withTemplate = CONV_HEAD.concat([
    "__registerMock('fs', {",
    '  existsSync: vi.fn((p) => (isSandboxPath(p) ? false : realFs.existsSync(p))),',
    '  readFileSync: vi.fn((p) => (isSandboxPath(p) ? \'\' : realFs.readFileSync(p))),',
    '  banner: () => `{ x `',
    '})',
  ]).join('\n');
  assert.equal(classify(withTemplate).verdict, 'SANDBOX_DELEGATED',
    '已收敛形状因模板里的裸 `{` 被误判成违规 ⇒ 维护者会去改夹具而不是改判据');
  const dirtyTemplate = "__registerMock('fs', { existsSync: () => false, other: () => `{ x ` })";
  const v = classify(dirtyTemplate);
  assert.equal(v.verdict, 'BLANKET', '模板里的不成对花括号不得让 blanket 逃出：' + JSON.stringify(v));
});

test('邻近函数里的合格比较不得"借光"给恒真谓词（QM-6 probe E：700 字符窗口的洞）', () => {
  const borrow = CONV_HEAD.slice(0, 2).concat([
    'const isSandboxPath = (p) => true',
    'const helper = (x) => x === SBX || x.startsWith(SBX + \'/\')',
    "__registerMock('fs', {",
    '  existsSync: vi.fn((p) => (isSandboxPath(p) ? false : realFs.existsSync(p))),',
    '})',
  ]).join('\n');
  const v = classify(borrow);
  assert.equal(v.verdict, 'BLANKET', '恒真谓词靠邻近函数的比较拿到"已收敛"：' + JSON.stringify(v));
});

test('动词必须**真的调用**真实 fs 句柄上的同名方法（QM-6 C1-b："某处 require 过 fs" 不算委托）', () => {
  const fakeDelegate = CONV_HEAD.concat([
    "__registerMock('fs', {",
    '  existsSync: vi.fn((p) => (isSandboxPath(p) ? false : (realFs ? false : false))),',
    '})',
  ]).join('\n');
  const v = classify(fakeDelegate);
  assert.equal(v.verdict, 'BLANKET', '引用了句柄却没调用它被判成已委托：' + JSON.stringify(v));
  assert.match(String(v.missing), /真的调用|没有在该实现体里/);
});

test('一个文件里多个 fs 注册点必须逐个判，取最差（QM-6 probe F：第二个才是 blanket）', () => {
  const twoSites = CONV_HEAD.concat(CONV_BODY, [
    "__registerMock('fs', {",
    '  existsSync: vi.fn().mockReturnValue(false),',
    '})',
  ]).join('\n');
  const v = classify(twoSites);
  assert.equal(v.verdict, 'BLANKET', '只看第一个注册点 ⇒ 第二个 blanket 整条洗白：' + JSON.stringify(v));
});

test('"沙箱"前缀必须可追溯到 os.tmpdir()；任意宽常量不算（QM-6 probe D）', () => {
  const wide = [
    "const realFs = require('node:fs')",
    "const ALLOW = '/tmp/anything-at-all'",
    'const isAllowed = (p) => {',
    "  const n = String(p).replace(/\\\\/g, '/')",
    "  const s = ALLOW.replace(/\\\\/g, '/')",
    '  return n === s || n.startsWith(s + \'/\')',
    '}',
    "__registerMock('fs', {",
    '  existsSync: vi.fn((p) => (isAllowed(p) ? false : realFs.existsSync(p))),',
    '})',
  ].join('\n');
  const v = classify(wide);
  assert.equal(v.verdict, 'BLANKET', '任意宽前缀被当成沙箱 ⇒ 大量真实路径可被谎报：' + JSON.stringify(v));
});

test('`===` 与 `startsWith` 必须比同一个标识符；谓词按名字精确解析，前缀名不算', () => {
  const mixed = CONV_HEAD.slice(0, 2).concat([
    'const isTwo = (p) => {',
    "  const a = SBX.replace(/\\\\/g, '/')",
    "  const b = '/etc'",
    "  return p === a || p.startsWith(b + '/')",
    '}',
    "__registerMock('fs', {",
    '  existsSync: vi.fn((p) => (isTwo(p) ? false : realFs.existsSync(p))),',
    '})',
  ]).join('\n');
  assert.equal(classify(mixed).verdict, 'BLANKET', '两个不同的比较对象拼出一个"看起来合格"的谓词');
  // 文件里存在一个**名字不同**的合格谓词（…Alias），实现体引用的是不存在的那个 ⇒ 不得按前缀借光
  const nearMiss = CONV_HEAD.slice(0, 2).concat(CONV_HEAD.slice(2).map((l) => l.replace('isSandboxPath', 'isSandboxPathAlias'))).concat([
    "__registerMock('fs', {",
    '  existsSync: vi.fn((p) => (isSandboxPath(p) ? false : realFs.existsSync(p))),',
    '})',
  ]).join('\n');
  assert.equal(classify(nearMiss).verdict, 'BLANKET', '谓词名字不匹配却拿到了"已收敛"⇒ 前缀借光');
});

test('掩码扫描器必须保长（skeleton 与 codeOnly 同长，否则"位置取自一份、内容取自另一份"会错位）', () => {
  const src = "const a = 'x // y'\n/* block */ const b = `{\"\n// tail\n";
  const { codeOnly, skeleton } = mod.scanMask(src);
  assert.equal(codeOnly.length, src.length, 'codeOnly 改变了长度');
  assert.equal(skeleton.length, src.length, 'skeleton 改变了长度');
  assert.equal(skeleton.indexOf('x'), -1, '字符串内容必须被掩掉');
  assert.ok(codeOnly.indexOf('x // y') > 0, 'codeOnly 必须保留字符串内容');
});

test('check-ignore 探针自己坏掉时不得读成"未被忽略"（QM-6 probe G：status=null 那一格）', () => {
  // ① 真实 git：给一个不存在的仓库目录 ⇒ git 非零退出（实测 128），必须落进"探针坏了"这一档
  const st = mod.checkIgnoreStatus('scripts/whatever.test.js', path.join(os.tmpdir(), 'no-such-repo-' + process.pid));
  assert.ok(st >= 2, 'git 取不到/仓库不存在必须 >=2，实际=' + st);
  // ② 注入式：git 二进制根本取不到时 execFileSync 抛的错 status 是 **null**、code 是 ENOENT。
  //    旧映射 `typeof e.status === 'number' ? e.status : 1` 把它折成"未被忽略"⇒ 自检永久盲。
  //    这一格环境依赖判不出来，必须由夹具造。
  const enoent = () => { const e = new Error('spawn git ENOENT'); e.code = 'ENOENT'; e.status = null; throw e };
  assert.ok(mod.checkIgnoreStatus('scripts/x.test.js', '.', enoent) >= 2, 'ENOENT 被折成"未被忽略"');
  assert.equal(mod.checkIgnoreStatus('scripts/x.test.js', '.', () => undefined), 0, '正常退出必须读成"被忽略"');
});

test('判据域必须整体落在 docs-only 白名单之外（否则本门禁会在纯文档 PR 上被自己短路）', () => {
  // 外部评审 W2 的风险面：门禁住在被 docs-only 门控的 static-gates。真正让它不会自我关闭的理由
  // 不是"记得接线"，而是**它测量的对象（测试文件）永远不是文档** —— 所以任何新增 blanket 夹具的
  // PR 必然 docs-only=false。这条锁把那句推理变成断言：名单若被扩大到会吞掉某个测试文件，立刻红。
  const classifier = require('./classify-docs-only.js');
  // 样本清单：欠账登记 + 三个**门禁真实测量到**的测试文件。
  // `tests/onboarding.test.js` 随其被测模块（`electron/services/onboarding.js`，阶段 1 批次 B
  // 已删除第二个引导真源）一并删除后，登记面从 9 缩到 8；这里补一个真实样本把域维持在原规模，
  // **而不是把下界从 12 降到 11** —— 降下界等于为了让锁不响，抬样本才是让锁继续有覆盖。
  const domain = Object.keys(mod.KNOWN_BLANKET).concat([
    'apps/desktop/electron/core/container.setup.test.js',
    'apps/desktop/electron/services/asset-generator.test.js',
    'apps/desktop/electron/services/first-run.test.js',
    'scripts/check-blanket-fs-mock.test.js',
  ]);
  assert.ok(domain.length >= 12, '判据域样本太少，这条锁不构成覆盖：' + domain.length);
  for (const f of domain) {
    assert.strictEqual(classifier.isDocsOnly([f]), false,
      f + ' 命中了 CI_IGNORED_PATHS ⇒ 只改它的 PR 会被 docs-only 短路，本门禁从此不再运行');
  }
});

test('判据不得把"写在字符串字面量里的注册点"当真注册（夹具文件自己被 tracked 后就必须能过）', () => {
  // 这条锁的由来：本仓真实仓库自证在文件还是 untracked 时跑过一次 PASS，`git ls-files` 看不见它；
  // 提交后它进入判据域，就被自己的测试文本（"__registerMock('fs', {" 这类数组元素）判成 15 条违规。
  // 现场自证必须在**与 CI 相同的 tracked 形态**下跑，否则"跑过"不等于"CI 会跑过"。
  const r = collectProblems();
  const self = 'scripts/check-blanket-fs-mock.test.js';
  assert.ok(r.scanned >= mod.MIN_TEST_FILES, '枚举退化，这条自证没有意义：' + r.scanned);
  assert.ok(!r.blanket.includes(self),
    '门禁把自己的回归夹具判成 blanket（多半是注册点位置取自未掩码的那一份文本）：\n'
      + r.problems.filter((p) => p.indexOf(self) >= 0).join('\n'));
});

test('真实仓库：棘轮必须 0 问题，且欠账清单与现场逐一对上（现场自证）', () => {
  const r = collectProblems();
  assert.deepEqual(r.problems, [], '真实仓库上棘轮报问题：\n' + r.problems.join('\n'));
  assert.ok(r.scanned >= mod.MIN_TEST_FILES, '真实仓库测试面数不应低于下限，实际=' + r.scanned);
  assert.equal(r.unreadable, 0, '有文件读不动 ⇒ 枚举不完整，判据不可信');
  assert.equal(r.blanket.length, Object.keys(mod.KNOWN_BLANKET).length,
    '现场 blanket 数与清单条数不符（清单只能缩小）：现场=' + r.blanket.join(', '));
  assert.ok(r.converged >= 1, '至少要有 #2794 收敛掉的那一个，否则"已收敛"这条形状没有现场样本');
});
