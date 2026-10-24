'use strict';
/**
 * scripts/qm6-exit-capabilities.test.js 的回归锁（node --test，只用内置模块，零出站、零网络）
 *
 * 本文件存在的**首要理由不是测这三个函数**，而是测"这三个函数还在不在"：
 * 2026-10-20 的实测事故里，PR #4062（一个 s2v 错误码修复）携带评审前的旧副本 squash 落地，
 * 把 PR #4067 在探针、探针测试、`ccg-convergence-exit/tasks.md` 三处的改动**整段撤销**
 * （`git show --stat 8fdd617b2` 当场读数：+1/−21、−25、−31），
 * 而唯一会因此变红的断言与它守护的实现**同批被删** ⇒ 同文件内的锁对这类撤销结构性无效。
 * ⇒ 检出必须住在不会被同一批旧副本带上的第三个文件里，并被 workflow 独立点名（A11）。
 *
 * 夹具纪律（AGENTS「两版实现答案不同的输入」）：每条谓词配一对源码，两版答案必须不同；
 * 同形（恒 true / 恒 false / 只看注释）当场红。
 * 真源码档（A9）**只断言"读得出"并打印读数，不把今天那面墙钉成契约** ——
 * 把一次观测写成断言，将来真加出口的 PR 会被自己的锁咬住（本仓「测试断言不得反向固化错误行为」同型）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const C = require('./qm6-exit-capabilities.js');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------------- 夹具：两版实现，答案必须不同 ---------------- */

const DRIVER_EXTERNAL_ON = [
  'function blockingFromAdjudication(adj) { return []; }',
  'function externalReviewSatisfied (i, adj) { return true; }',
  'const tpl = { expectedExternalBackend: critic };',
].join('\n');
const DRIVER_EXTERNAL_COMMENT_ONLY = [
  'function blockingFromAdjudication(adj) { return []; }',
  '// externalReviewSatisfied 下一版加进来',
  'const tpl = { expectedExternalBackend: critic };',
].join('\n');
const DRIVER_EXTERNAL_NO_TEMPLATE = [
  'function blockingFromAdjudication(adj) { return []; }',
  'function externalReviewSatisfied (i, adj) { return true; }',
].join('\n');

const DRIVER_UPHELD_OFF = [
  'function blockingFromAdjudication(adj) {',
  '  var blocking = [];',
  '  (adj.items || []).forEach(function (i) {',
  "    if (i.verdict === 'upheld') {",
  "      blocking.push({ id: i.id, reason: 'self_play_upheld' });",
  '    }',
  '  });',
  '  return blocking;',
  '}',
  'function externalReviewSatisfied (i) { return true; }',
  'const tpl = { expectedExternalBackend: critic };',
].join('\n');
const DRIVER_UPHELD_ON = [
  'function blockingFromAdjudication(adj) {',
  '  var blocking = [];',
  '  (adj.items || []).forEach(function (i) {',
  "    if (i.verdict === 'upheld') {",
  '      if (resolvedEvidenceSatisfied(i)) return;',
  "      blocking.push({ id: i.id, reason: 'self_play_upheld' });",
  '    }',
  '  });',
  '  return blocking;',
  '}',
  'function externalReviewSatisfied (i) { return true; }',
  'const tpl = { expectedExternalBackend: critic };',
].join('\n');
// 顶罪夹具：upheld 那条自己没有解除臂，但函数里别处有 return（高危域分支）。
// 用"整个函数体里有没有 return"当判据的实现在这一版上会说谎 —— A4 就是打这一格。
const DRIVER_UPHELD_RETURN_ELSEWHERE = [
  'function blockingFromAdjudication(adj) {',
  '  var blocking = [];',
  '  (adj.items || []).forEach(function (i) {',
  '    if (high(i)) { if (ok(i)) return; blocking.push(1); return; }',
  "    if (i.verdict === 'upheld') {",
  "      blocking.push({ id: i.id, reason: 'self_play_upheld' });",
  '    }',
  '  });',
  '  return blocking;',
  '}',
  'function externalReviewSatisfied (i) { return true; }',
  'const tpl = { expectedExternalBackend: critic };',
].join('\n');
// 窗口夹具：解除臂被推到 6 行注释**之后**。
// 只看 `if (i.verdict === 'upheld')` 之后固定几行的读法会漏掉那条臂 ⇒ 判 false；
// 按块配对的读法判 true。两版答案不同，A3 才有区分度（上一版把注释插在臂与 push 之间，
// 窗口读法照样看得见那条臂 ⇒ 驱动跑 n3 时直接 MISSED，是这条夹具自己没牙，不是变异没写对）。
const DRIVER_UPHELD_ON_WITH_COMMENTS = DRIVER_UPHELD_ON.replace(
  "      if (resolvedEvidenceSatisfied(i)) return;",
  ['      // 凭证形状见 design §1.2', '      // 缺一格仍计阻断', '      // 不在此处放宽', '      // 由工具重放校验', '      // 不采信自述', '      // 见 A3 反证',
    '      if (resolvedEvidenceSatisfied(i)) return;'].join('\n'));

const WB_SINGLE = [
  'function applyWriteback (o) {',
  "  if (dr.performedBy === expected) spoke.push('backend-matches')",
  "  else return { wrote: false, reason: 'backend-mismatch' }",
  '}',
].join('\n');
const WB_ALT_PATH = [
  'function applyWriteback (o) {',
  "  if (dr.performedBy === expected || externalDeliveryMatches(dr, expected)) spoke.push('backend-matches')",
  "  else return { wrote: false, reason: 'backend-mismatch' }",
  '}',
].join('\n');
const WB_GATED = [
  'function applyWriteback (o) {',
  "  if (dr.performedBy === expected || (dr.findingsBy === expected && archiveDigestOk(dr))) spoke.push('backend-matches')",
  '  else return { wrote: false }',
  '}',
].join('\n');

/* ---------------- A1-A5：三条谓词各自的区分度 ---------------- */

test('A1 高危域出口：定义 + 模板两格齐备才判在位；只在注释里提到不算定义', () => {
  assert.equal(C.externalReviewCapable(DRIVER_EXTERNAL_ON), true);
  assert.equal(C.externalReviewCapable(DRIVER_EXTERNAL_COMMENT_ONLY), false, '注释里提一句谓词名就算"解除臂在位" ⇒ 探针会去宣布一条不存在的出口');
  assert.equal(C.externalReviewCapable(DRIVER_EXTERNAL_NO_TEMPLATE), false, '没有期望后端字段 ⇒ 解除臂无从对账 ⇒ 不在位');
  assert.notEqual(C.externalReviewCapable(DRIVER_EXTERNAL_ON), C.externalReviewCapable(DRIVER_EXTERNAL_COMMENT_ONLY),
    '两版实现答案相同 ⇒ 这条谓词无区分度');
});

test('A2 upheld 出口：无守卫判 false、有守卫判 true（将来加臂不必改探针一行）', () => {
  assert.equal(C.upheldExitCapable(DRIVER_UPHELD_OFF), false, '今天的真实形状：push 前无守卫');
  assert.equal(C.upheldExitCapable(DRIVER_UPHELD_ON), true, '加了"凭证齐备即 return"就必须自动翻成在位');
  assert.notEqual(C.upheldExitCapable(DRIVER_UPHELD_OFF), C.upheldExitCapable(DRIVER_UPHELD_ON));
  // 第三种写法：直接读 vendor 今天真正消费的那份键（`i.externalReview`），不带 Satisfied/Capable 字样。
  // 少了这条，谓词表里的 `externalReview` 那一项就是"写了但没人量"的装饰（n21 实测会 MISSED）。
  const BY_EXTERNAL_KEY = 'function blockingFromAdjudication(adj) {\n'
    + '  var blocking = [];\n  adj.items.forEach(function (i) {\n'
    + "    if (i.verdict === 'upheld') {\n      if (i.externalReview) { return; }\n"
    + "      blocking.push({ id: i.id, reason: 'self_play_upheld' });\n    }\n  });\n  return blocking;\n}\n";
  assert.equal(C.upheldExitCapable(BY_EXTERNAL_KEY), true,
    '解除臂写成型"读 externalReview 键"也必须被看见 —— 那正是 vendor 现在唯一的凭证词汇');
});

test('A3 upheld 出口对注释行数不敏感（钉死"固定窗口"这一类读法）', () => {
  assert.equal(C.upheldExitCapable(DRIVER_UPHELD_ON_WITH_COMMENTS), true,
    '解除臂与 push 之间多 6 行注释就改变读数 ⇒ 用的是窗口而不是块');
});

test('A4 别处的 return 不得替 upheld 那条臂顶罪', () => {
  assert.equal(C.upheldExitCapable(DRIVER_UPHELD_RETURN_ELSEWHERE), false,
    '整函数里出现过 return 就说"有解除臂"，是把高危域分支的 return 算到了 upheld 头上');
});

test('A5 工具署名出口：第二条路必须真的能通往"写"', () => {
  assert.equal(C.toolSignatureCapable(WB_SINGLE), false, '今天只认 performedBy ⇒ 自扮演收口永拿不到 tier');
  assert.equal(C.toolSignatureCapable(WB_ALT_PATH), true, '多一条支路 ⇒ 在位');
  assert.equal(C.toolSignatureCapable(WB_GATED), true, '带存档校验的支路同样算在位（按形状读，不认实现名）');
  assert.notEqual(C.toolSignatureCapable(WB_SINGLE), C.toolSignatureCapable(WB_ALT_PATH));
});

/* ---------------- A6-A8：失明档与"结论必须可追溯" ---------------- */

test('A6 读不出被声明物一律 unknown，且 unknown 不得被措辞成结论', () => {
  assert.equal(C.externalReviewCapable(''), 'unknown', '空输入是失明不是不在位');
  assert.equal(C.externalReviewCapable('const x = 1;'), 'unknown', '被声明物不存在 ⇒ 读不出');
  assert.equal(C.upheldExitCapable('function other () {}'), 'unknown');
  assert.equal(C.toolSignatureCapable(''), 'unknown');
  const line = C.conclusionLine({ externalReview: 'unknown', upheld: 'unknown', toolSignature: 'unknown' });
  assert.match(line, /读不出/);
  for (const claim of ['self-play 内无出口', '⇒ 永久阻断', '永拿不到 tier', '可解除', '可署 tier']) {
    assert.ok(!line.includes(claim), `失明档不得输出结论句「${claim}」：${line}`);
  }
});

test('A7 readCapabilities 如实聚合三档，并对越界返回值当场抛错', () => {
  const r = C.readCapabilities({ driverSrc: DRIVER_UPHELD_ON, writebackSrc: WB_SINGLE });
  assert.equal(r.unknown, 0);
  assert.deepEqual([r.externalReview, r.upheld, r.toolSignature], [true, true, false]);
  const empty = C.readCapabilities({ driverSrc: '', writebackSrc: '' });
  assert.equal(empty.unknown, 3, '两侧都读不出时 unknown 必须数得出来，不得被折叠成三个 false');
  assert.throws(() => C.readCapabilities({ driverSrc: DRIVER_UPHELD_ON, writebackSrc: WB_SINGLE }, { upheldExitCapable: () => undefined }),
    /非三档值/, '静默的 undefined 会被读成 false —— 那是把"实现坏了"伪装成"没有出口"');
  assert.throws(() => C.readCapabilities({ driverSrc: DRIVER_UPHELD_ON, writebackSrc: WB_SINGLE }, { toolSignatureCapable: () => 'maybe' }),
    /非三档值/);
});

test('A8 结论行每一句都可追溯到某个布尔（三向各翻转一次）', () => {
  const base = { externalReview: false, upheld: false, toolSignature: false };
  const l0 = C.conclusionLine(base);
  for (const k of ['externalReview', 'upheld', 'toolSignature']) {
    assert.notEqual(C.conclusionLine(Object.assign({}, base, { [k]: true })), l0,
      `${k} 翻转而结论行不变 ⇒ 那一格是被写死的，不是被读出来的`);
  }
});

/* ---------------- A13-A15：行为档（不需要 vendor，喂函数即可测） ---------------- */

test('A13 行为档真调 blockingFromAdjudication：今天的形状判不在位，加了出口的实现必须翻过来', () => {
  // 今天的 vendor 形状：无论有没有凭证都 push
  const today = (adj) => adj.items.filter((i) => i.verdict === 'upheld').map((i) => ({ id: i.id, reason: 'self_play_upheld' }));
  assert.equal(C.upheldExitBehavioral(today), false, '无解除臂 ⇒ 不在位');
  // 将来加了出口的实现：凭证齐备即不阻断（两份形状任读一份都算，见下条 A16 为什么要带两份）
  const withExit = (adj) => adj.items
    .filter((i) => i.verdict === 'upheld')
    .filter((i) => !(i.resolution && i.resolution.resolvedBy && i.resolution.verifiedBy && i.resolution.verifiedAt))
    .map((i) => ({ id: i.id, reason: 'self_play_upheld' }));
  assert.equal(C.upheldExitBehavioral(withExit), true, '两版实现答案相同 ⇒ 行为档无区分度，将来加了出口也看不见');
  // 第二版"加了臂"的实现读的是 externalReview（vendor 今天真正消费的那份键名），同样必须被看见
  const withExternalArm = (adj) => adj.items
    .filter((i) => i.verdict === 'upheld')
    .filter((i) => !(i.externalReview && i.externalReview.performedBy && i.externalReview.evidenceRef && i.externalReview.reviewedAt))
    .map((i) => ({ id: i.id, reason: 'self_play_upheld' }));
  assert.equal(C.upheldExitBehavioral(withExternalArm), true,
    '凭证只写一份键名时，读另一份键名的未来实现会被判成"没有出口"——那是假阴性，且看着完全正常');
  assert.equal(C.upheldExitBehavioral(undefined), 'unavailable', '拿不到函数不是"不在位"');
  assert.equal(C.upheldExitBehavioral(null), 'unavailable');
  // 无凭证那份必须阻断：否则"随便填两格"就能收口
  assert.throws(() => C.upheldExitBehavioral(() => []), /缺一格即拦/);
  assert.throws(() => C.upheldExitBehavioral(() => 'not-an-array'), /返回值不是数组/);
  // 正控不成立时拒绝给结论（本条锁的是"凭证形状没人消费 ⇒ 读数什么也没测"这一格）
  assert.equal(C.upheldExitBehavioral(today, { receiptLive: false }), 'unavailable',
    '正控 false 仍报 false ⇒ 把"我的夹具没人读"读成"这条出口不存在"');
  assert.equal(C.upheldExitBehavioral(today, { receiptLive: 'unavailable' }), false,
    '拿不到正控（无 vendor）不得反过来污染本函数自己的读数');
});

test('A16 正控：externalReview 那份凭证必须是 vendor 自己承认的形状，否则行为档一律 unavailable', () => {
  const live = (adj) => adj.items.filter((i) => !(i.highRiskDomains && i.highRiskDomains.length
    && i.externalReview && i.externalReview.performedBy && i.externalReview.evidenceRef && i.externalReview.reviewedAt))
    .filter((i) => i.verdict === 'upheld').map((i) => ({ id: i.id }));
  assert.equal(C.externalReviewReceiptLive(live), true, '这份实现认 externalReview 三格 ⇒ 正控必须为真');
  const ignoreAll = (adj) => adj.items.filter((i) => i.verdict === 'upheld').map((i) => ({ id: i.id }));
  assert.equal(C.externalReviewReceiptLive(ignoreAll), false, '凭证不被任何分支消费时正控必须报假 —— 这正是本条要抓的那种空转');
  assert.equal(C.externalReviewReceiptLive(undefined), 'unavailable');
  // 夹具那份凭证自己也要有牙：键名写错 = 恒不成立 = 正控恒 false，所以要按 vendor 的三格逐个点名
  assert.deepEqual(Object.keys(C.RECEIPT_EXTERNAL).sort(), ['evidenceRef', 'performedBy', 'reviewedAt'],
    '正控夹具的键名必须与 vendor 消费的那三个逐字一致');
  assert.equal(C.RECEIPT_EXTERNAL.performedBy, 'claude', 'performedBy 必须等于期望后端，且不得是 self-play（vendor 显式拒绝自证）');
  assert.doesNotMatch(C.RECEIPT_EXTERNAL.performedBy, /self[-_]?play|^agent$/i);
  assert.match(C.RECEIPT_EXTERNAL.evidenceRef, /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+#issuecomment-\d+$/,
    'evidenceRef 必须过 vendor 的形状判据，否则正控的失败是我的夹具坏了，不是 vendor 没有出口');
});

test('A14 两路比较：不一致必须不 ok，vendor 缺席必须算一致而不是失败', () => {
  assert.deepEqual(C.crossCheckUpheld(false, false), { ok: true, note: '两路一致：这条出口不在位' });
  assert.equal(C.crossCheckUpheld(true, true).ok, true);
  assert.equal(C.crossCheckUpheld(false, true).ok, false, '结构说不存在、真跑说存在 ⇒ 读数不可信，必须出声');
  assert.equal(C.crossCheckUpheld(true, false).ok, false, '反方向同样不得静默取其一');
  assert.equal(C.crossCheckUpheld(false, 'unavailable').ok, true, 'CI 上没有 vendor 是常态，不得因此判探针偏离');
  assert.equal(C.crossCheckUpheld('unknown', false).ok, true, '结构档失明时不参与比较（更不能被比较结果反推成结论）');
  // 跳过成因不得合并（2026-10-24 现场：本机装了 vendor 但一 require 就会跑别人的流水线，
  // 若文案统一成 no-vendor，读的人会以为"这台机器没装引擎"，而实情是"装了且不敢动" —— 两种修法完全不同）
  assert.match(C.crossCheckUpheld(false, 'unavailable', 'executes-on-require').note, /executes-on-require/,
    '真实成因必须出现在文案里');
  assert.doesNotMatch(C.crossCheckUpheld(false, 'unavailable', 'executes-on-require').note, /no-vendor/,
    '把"装了但不敢 require"写成 no-vendor 是合并成因');
  assert.match(C.crossCheckUpheld(false, 'unavailable', 'unreadable').note, /unreadable/);
  assert.match(C.crossCheckUpheld(false, 'unavailable').note, /no-vendor/, '没给成因时才回落 no-vendor（向后兼容的老形状）');
});

test('A21 驱动可加载性判据：四种成因各有夹具，且"顶层裸执行 main()"必须判禁止 require', () => {
  // 这条是 2026-10-24 事故的直接回归锁：探针当时把一份顶层 `process.exit(main())` 的驱动 require 了进来，
  // 于是 `--json` 的 stdout 变成别人流水线的输出，而报错读起来像"探针输出坏了"。
  const GUARDED = 'function main () { return 0; }\nmodule.exports = { blockingFromAdjudication };\nif (require.main === module) process.exit(main());\n';
  const BARE = 'function main () { return 0; }\nmodule.exports = { blockingFromAdjudication };\nprocess.exit(main());\n';
  const NO_EXPORTS = 'function main () { return 0; }\nif (require.main === module) process.exit(main());\n';
  const BARE_NO_EXPORTS = 'function main () { return 0; }\nprocess.exit(main());\n';
  assert.deepEqual(C.driverLoadability(GUARDED), { loadable: true, reason: 'ok' });
  assert.deepEqual(C.driverLoadability(BARE), { loadable: false, reason: 'executes-on-require' },
    '顶层裸执行 ⇒ 禁止加载。判错了就是"探针替别人跑一遍评审"');
  assert.deepEqual(C.driverLoadability(NO_EXPORTS), { loadable: true, reason: 'no-exports' },
    '可加载但没导出面 = 真失明，必须与"不敢加载"分开报');
  assert.deepEqual(C.driverLoadability(BARE_NO_EXPORTS), { loadable: false, reason: 'executes-on-require' },
    '两种毛病同时存在时，先报"不敢执行"——那才是会炸探针的那一条');
  assert.equal(C.driverLoadability('').reason, 'unreadable');
  assert.equal(C.driverLoadability(undefined).reason, 'unreadable');
  // 函数体内用 process.exit 早退是合法的（两份真实 vendor 都有那一处），不得据此判"不可加载"
  const EXIT_INSIDE_FN = 'function guard () { if (!x) process.exit(2); }\nmodule.exports = { y: 1 };\n';
  assert.equal(C.driverLoadability(EXIT_INSIDE_FN).reason, 'ok',
    '把合法早退判成禁止执行，会把唯一正常的形态整个排除掉（判据必须只盯"调用 main() 那一句"）');
  // 第 4 轮评审 i3（Warning，判**成立**）：带一层花括号的守卫写法今天会被判成 executes-on-require，
  // 于是行为档在一台完全正常的机器上永久只有一路。两种认的形态都要有夹具，且必须各配一条反向对照，
  // 否则"允许花括号"会被读成"文件里任何位置出现过守卫就算"。
  const GUARDED_BRACED = 'function main () { return 0; }\nmodule.exports = { z: 1 };\nif (require.main === module) {\n  process.exit(main());\n}\n';
  assert.deepEqual(C.driverLoadability(GUARDED_BRACED), { loadable: true, reason: 'ok' },
    '花括号形态（i3 现场）必须算可加载，否则这一格在别人机器上静默退化成一路');
  const GUARDED_BLOCK_OTHERS_FIRST = 'if (require.main === module) {\n  setup();\n  process.exit(main());\n}\n';
  assert.equal(C.driverLoadability(GUARDED_BLOCK_OTHERS_FIRST).reason, 'executes-on-require',
    '守卫块里先干别的再 exit —— 这一形态**刻意留在保守侧**（判成不许加载，代价是少一路读数并出声），'
    + '要放开必须先补一条"块内前置语句确实无害"的判据，不是靠正则顺带放过');
  const GUARD_NOWHERE_NEAR_EXIT = 'if (require.main === module) console.log("x");\nprocess.exit(main());\n';
  assert.equal(C.driverLoadability(GUARD_NOWHERE_NEAR_EXIT).reason, 'executes-on-require',
    '"文件里出现过守卫这句话"不等于"调用 main() 那一句被它管住" —— 这条负控就是防止我把上一条放宽成前者');
  // 成因表由本模块唯一持有：探针不得再抄第二份（抄了就会漂移）
  assert.deepEqual([...C.BEHAVIORAL_SKIP_REASONS].sort(), ['executes-on-require', 'unreadable'],
    '按设计的跳过只有这两档；no-exports/require-failed 属真失明，必须留在表外才会 rc=1');
  assert.equal(C.isBehavioralSkip('no-exports'), false,
    '把 no-exports 放进跳过表 = 把"引擎没导出函数"读成"这台机器没装引擎"，那条 rc=1 就此失效');
  assert.equal(C.isBehavioralSkip('executes-on-require'), true);
  assert.equal(C.isBehavioralSkip('unreadable'), true);
  assert.equal(C.isBehavioralSkip(null), false, '没有成因（探针自己的 ok 档）不得被当成按设计的跳过');
  // 第 4 轮评审 i2：这张表还要**运行时也改不动**。为什么用冻结数组而不是冻结 Set ——
  // 现场实测 `Object.freeze(new Set())` 之后 `.add` 照旧生效（Set 改的是内部槽，不是属性），
  // 那是假防线；冻结数组在严格模式下 push 直接抛。两条都要钉住，因为"换成 Set 更顺手"随时会发生。
  assert.ok(Array.isArray(C.BEHAVIORAL_SKIP_REASONS), '成因表必须是数组（冻结的 Set 拦不住 add）');
  assert.ok(Object.isFrozen(C.BEHAVIORAL_SKIP_REASONS), '成因表必须是冻结的');
  assert.throws(() => { C.BEHAVIORAL_SKIP_REASONS.push('no-exports'); },
    '冻结失效 ⇒ 消费方可以运行时扩一档，把真失明改成静默跳过，而 A21 上一条逐档断言就成了纸面的');
  assert.equal(C.isBehavioralSkip('no-exports'), false, '上一条即使没抛，表也必须仍是两档');
  const setProbe = Object.freeze(new Set(['a']));
  setProbe.add('b');
  assert.equal(setProbe.has('b'), true,
    '实测记录：freeze 拦不住 Set.add —— 这条是"为什么不用 Set"的依据，不是可选注释');

});

test('A15 探针必须把行为档与交叉比较都接上（只有结构读法＝本刀只做了一半）', () => {
  const src = read('scripts/ccg-convergence-probe.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.match(src, /upheldExitBehavioral\s*\(/, '没有行为档 ⇒ "那段代码长什么样"被当成"这条 PR 会不会被钉住"来用');
  assert.match(src, /crossCheckUpheld\s*\(/);
  assert.match(src, /if\s*\(\s*!xcheck\.ok\s*\)\s*problems\.push\(/,
    '不一致必须写成「守卫紧跟 problems.push」——只打印不进 problems 的比较是装饰（判据只认这一种形状，'
    + '因为探针其余 problems 都是同一写法）');
  // 2026-10-24 新增的那一半：require 之前必须先问"这份驱动能不能被安全加载"。
  // 只断言"两个调用都在文件里"不够 —— 顺序反了（先 require 再判）与没判完全同形。
  const at = (re) => { const i = src.search(re); assert.ok(i >= 0, '探针里找不到 ' + re + ' ⇒ 该接线被摘掉了'); return i; };
  const gate = at(/driverLoadability\s*\(/);
  const req = at(/require\(\s*driverFile\s*\)/);
  assert.ok(gate < req, '可加载性判定必须**排在 require 之前**；写在后面就等于已经跑过别人的流水线才想起来拦');
  at(/isBehavioralSkip\(/);
  assert.ok(src.search(/isBehavioralSkip\(/) < src.search(/return problems\.length \? 1 : 0/),
    '跳过成因表必须在"决定 rc"之前被读，否则真失明会被判成 0');
});

/* ---------------- A9-A12：真源码读数、结论生成与接线 ---------------- */

test('A9 真源码档：声明了就必须读得出、没声明就必须报"读不出"——不得把机器局部补丁钉成契约', () => {
  const drv = vendorDriver();
  const caps = C.readCapabilities({
    driverSrc: drv.src, writebackSrc: read('scripts/ccg-review-writeback.js'),
    driverPath: drv.path, writebackPath: 'scripts/ccg-review-writeback.js',
  });
  console.log(`[qm6-exit-capabilities] 真源码读数 vendor=${drv.path || 'ABSENT'} `
    + `externalReview=${caps.externalReview} upheld=${caps.upheld} toolSignature=${caps.toolSignature} unknown=${caps.unknown}`);
  console.log(`[qm6-exit-capabilities] 结论 ${C.conclusionLine(caps)}`);
  assert.notEqual(caps.toolSignature, 'unknown', '仓内写回器读不出那条合取 ⇒ 它被改名或搬家了，本锁与 AGENTS 的结论都要同步');
  // vendor 侧两格一律写成**蕴含式**。原因是一条现场教训：本条原先写"vendor 文件在位 ⇒ 三格必须读得出"，
  // 而 2026-10-24 11:48 另一个会话把本机那份**未提交的** vendor 补丁改写掉了（`externalReviewSatisfied`
  // 整个名字没了），于是这条红的内容是"我的机器前提变了"，不是"判据量出了什么" ——
  // 把机器局部状态当契约前提，等价于在别人机器上关掉这条锁（本仓「装饰性门禁」同型）。
  if (/externalReviewSatisfied/.test(drv.src)) {
    assert.notEqual(caps.externalReview, 'unknown', '驱动里出现了被声明物却读不出 ⇒ 是谓词的锚点坏了，不是引擎变了');
  } else {
    assert.equal(caps.externalReview, 'unknown',
      '驱动里根本没有那个名字时必须报"读不出"。折叠成 false 就是把工具的失明读成"这条出口不存在"');
    assert.match(C.conclusionLine(caps), /读不出/, '失明档的结论句必须自带"读不出"字样：' + C.conclusionLine(caps));
  }
  if (/function[ \t]+blockingFromAdjudication[ \t]*\(/.test(drv.src)) {
    assert.notEqual(caps.upheld, 'unknown', 'blockingFromAdjudication 在位却读不出 ⇒ 切块判据与这一版形状不匹配');
  } else {
    assert.equal(caps.upheld, 'unknown', '同一个道理：函数不在，是读不出，不是"没有出口"');
  }
  // 刻意**不断言**这几格今天是 true 还是 false：那是把一次观测钉成契约，将来真加出口的 PR 会被自己的锁咬住。
});

test('A10 探针必须改用读数生成结论，且不得再出现被撤销回来的那句写死结论', () => {
  const src = read('scripts/ccg-convergence-probe.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.match(src, /require\(['"]\.\/qm6-exit-capabilities\.js['"]\)/,
    '探针没接上读数器 ⇒ 它会重新打印一份与现场无关的结论（#4062 复发时的形状）');
  assert.match(src, /conclusionLine\s*\(/, '结论行必须由生成器产出，不接受字面量');
  assert.doesNotMatch(src, /self-play 对 crypto 项无条件计阻断/,
    '那句写死的旧结论必须不在；留着它，探针就会继续生产假话');
});

test('A11 接线锁：新锁与探针都必须被 workflow 的**可执行正文**点名', () => {
  const wf = read('.github/workflows/quality-gate.yml').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(wf.includes('node --test scripts/qm6-exit-capabilities.test.js'),
    '新锁没被点名 = 它永远不会被执行，而"有一条锁存在"这句话仍然是真的（装饰性门禁同型）');
  assert.ok(wf.includes('node --test scripts/ccg-convergence-probe.test.js'), '探针既有接线不得被顺手摘掉');
});

test('A12 导出面与追踪态：三个谓词与生成器都必须在模块导出上，且本体不被 .gitignore 吞掉', () => {
  // #4062 那次撤销的显形方式就是"导出面消失"。这里按名字逐个问，不接受"文件还在所以没事"。
  for (const name of ['externalReviewCapable', 'upheldExitCapable', 'toolSignatureCapable', 'upheldExitBehavioral',
    'externalReviewReceiptLive', 'crossCheckUpheld', 'readCapabilities', 'conclusionLine', 'driverLoadability']) {
    assert.equal(typeof C[name], 'function', `导出面缺 ${name} ⇒ 消费方会静默退化，而本仓的锁看不见"没人调用"这件事`);
  }
  // 跳过成因表由读数器一侧唯一持有：探针只准通过 `isBehavioralSkip` 问，不得再抄第二份
  assert.ok(Array.isArray(C.BEHAVIORAL_SKIP_REASONS) && Object.isFrozen(C.BEHAVIORAL_SKIP_REASONS),
    '跳过成因表必须是模块导出的那一份冻结表（探针侧的第二份由 A22 扫域抓）');
  assert.equal(typeof C.isBehavioralSkip, 'function', '唯一消费入口必须在导出面上');
  const rel = ['scripts/qm6-exit-capabilities.js', 'scripts/qm6-exit-capabilities.test.js', 'scripts/qm6-exit-capabilities.mutation.js'];
  const env = { ...process.env };
  // GIT_DIR 等会静默压过 cwd（钩子窗口里实测踩过），先清掉再问 git。
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[k];
  for (const f of rel) {
    const r = spawnSync('git', ['check-ignore', '--no-index', '-v', f], { cwd: ROOT, encoding: 'utf8', env });
    if (r.status === 0) {
      // 回显形状是 `<file>:<line>:<pattern>\t<path>` —— rc=0 对**反选**也返回 0，
      // 所以判"是否被忽略"只能看模式自己是不是 `!` 开头（本仓把按 rc 判忽略定性为假结论）。
      const hit = /^[^\t]*\t/.test(String(r.stdout || '')) ? String(r.stdout).split('\t')[0] : '';
      const pattern = hit.slice(hit.lastIndexOf(':') + 1);
      assert.ok(pattern.startsWith('!'), `${f} 最后命中的规则不是放行规则，而是：${JSON.stringify(pattern)}（完整回显：${hit}）`);
    }
    const t = spawnSync('git', ['ls-files', '--', f], { cwd: ROOT, encoding: 'utf8', env });
    if (t.status !== 0) throw new Error(`git ls-files 取不到读数（rc=${t.status}）⇒ 未证实：${String(t.stderr).slice(0, 120)}`);
    assert.equal(String(t.stdout).trim(), f, `${f} 不在索引里：新建脚本会被 .gitignore 的 scripts/*.js 静默吞掉，"锁已入仓"就成了假话`);
  }
});

/* ---------------- A17-A19：变异驱动的基线卫生（QM-6 第二轮评审 i2） ---------------- */

test('A24 反证运行态必须与本机 vendor 无关（否则 n32 那一类靶子会在本机真的跑起别人的流水线）', () => {
  const D = require('./qm6-exit-capabilities.mutation.js');
  const env = D.sandboxEnv();
  const dir = env.CCG_ARL_DIR;
  assert.ok(typeof dir === 'string' && dir.length > 0, '沙箱目录必须存在且非空字符串');
  assert.equal(dir, env.HOME, 'HOME 必须一起指过去，否则 ~/.claude/skills 那一路仍会命中本机引擎');
  assert.equal(dir, env.USERPROFILE, 'USERPROFILE 同理（Windows 上 locateVendor 读的就是它）');
  assert.ok(!fs.existsSync(path.join(dir, 'engine.js')) && !fs.existsSync(path.join(dir, 'ccg-deep-review.js')),
    '沙箱目录里不得有引擎/驱动两件，否则 locateVendor 会命中');
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) {
    assert.ok(!(k in env), `沙箱 env 不得带 ${k}（它会静默压过 cwd，实测踩过）`);
  }
  // 行为：探针本体在沙箱 env 下必须走"没有 vendor"那一档 —— rc=2 且点名失明，
  // 而不是 rc=0（把没测读成通过）也不是 rc=1（把没装读成读数矛盾）。
  const probe = path.join(ROOT, 'scripts', 'ccg-convergence-probe.js');
  const inSandbox = spawnSync(process.execPath, [probe], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(inSandbox.status, 2, '沙箱里探针必须 rc=2，实际 ' + inSandbox.status + '：' + String(inSandbox.stderr).slice(0, 200));
  assert.match(String(inSandbox.stderr), /探针失明/, '必须点名"探针失明"，不得让它读成"引擎没问题"');
  // 反失明正控：把 env 换回真实的，若本机装了引擎，rc 就**不该**是 2 —— 否则上面那两句
  // 可能只是因为探针本身坏了而恒成立。本机没装引擎时如实打日志（不 skip 整条锁）。
  const realHome = process.env.USERPROFILE || process.env.HOME || '';
  const realVendor = realHome && fs.existsSync(path.join(realHome, '.claude', 'skills', 'adversarial-review-loop', 'scripts', 'ccg-deep-review.js'));
  if (realVendor) {
    const out = spawnSync(process.execPath, [probe], { cwd: ROOT, encoding: 'utf8', env: { ...process.env } });
    assert.notEqual(out.status, 2, '本机装了引擎却仍 rc=2 ⇒ 探针或定位逻辑坏了，A24 的上面两句就成了空断言');
    console.log('[qm6-exit-capabilities] A24 正控：本机装了 vendor（rc=' + out.status + '），沙箱确实把它藏掉了');
  } else {
    console.log('[qm6-exit-capabilities] A24 正控：本机没有 vendor，正控无从执行（只打点，不据此判上面那两句已通过）');
  }
  // 结构锁：套件必须**在沙箱里跑**，且驱动开工前自证过沙箱生效
  const drv = read('scripts/qm6-exit-capabilities.mutation.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.match(drv, /'--test', suite\.file\][^\n]*env: sandboxEnv\(\)/,
    'suiteRun 不再传沙箱 env ⇒ 反证拿本机 vendor 陪跑（变异 n39 就钉这一格）');
  assert.match(drv, /id: 'sandbox', state: 'PROBLEM'/, '驱动必须自证沙箱生效，失效时打 PROBLEM 而不是继续跑');
});

test('A22 「按设计的跳过」这张表只准有一份实现 —— 别处内联同一条枚举即红', () => {
  // 这是"是否复用某实现"的锁。口径必须取**两版实现答案不同**的输入：
  // 今天只有读数器里那一条数组字面量；若下一个会话在探针/驱动里内联一份"顺手判一下"，
  // 两份表就会漂移，而漂移的方向恰好是把真失明写进跳过表（因为那样它自己就不红了）。
  const ENUM = "'unreadable', 'executes-on-require'";
  const files = ['scripts/qm6-exit-capabilities.js', 'scripts/ccg-convergence-probe.js',
    'scripts/check-pr-exec-record.js', 'scripts/ccg-review-writeback.js'];
  // ⚠ 变异驱动**必须在扫描域之外**：它的 M 表逐字引用了这条枚举当锚点，算进 owners 会让本锁恒红。
  // 这与 n22/n26 那次"锚点自反"同型 —— 正解是按域排除并把理由写在这一行，不是放宽判据本身。
  const owners = [];
  for (const f of files) {
    const src = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (src.includes(ENUM)) owners.push(f);
  }
  assert.deepEqual(owners, ['scripts/qm6-exit-capabilities.js'],
    '成因枚举只能出现在读数器那一条表定义里；多一个宿主就是第二份事实（实际命中：' + owners.join(', ') + '）');
  // 正控：这张表确实能被内联（否则上一条是"永不命中"的假锁）
  const fake = "const inlined = ['unreadable', 'executes-on-require'];";
  assert.ok(fake.includes(ENUM), '夹具形状坏了 ⇒ 上面那条锁测不出任何东西');
  // 消费入口也必须单一：探针只准调 isBehavioralSkip
  const probeBody = read('scripts/ccg-convergence-probe.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(probeBody, /BEHAVIORAL_SKIP_REASONS\s*\./,
    '探针直接摸表（.has/.includes）就是绕过唯一入口 ⇒ 加一档不需要改读数器，A21 逐档断言会漏');
  assert.match(probeBody, /isBehavioralSkip\(/, '探针必须通过唯一入口问成因');
});

test('A23 驱动必须能列出"靶子之外被改脏的文件"（第 4 轮 i1/i6：还原得了靶子，还原不了副作用）', () => {
  const D = require('./qm6-exit-capabilities.mutation.js');
  assert.equal(typeof D.worktreeDirtyPaths, 'function', '导出面缺 worktreeDirtyPaths ⇒ 副作用体检没法被测、也没法被信');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qm6-side-effect-'));
  const git = (args) => spawnSync('git', args, {
    cwd: repo, encoding: 'utf8',
    env: (() => { const e = { ...process.env }; for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete e[k]; return e; })(),
  });
  try {
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'test']);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n', 'utf8');
    git(['add', 'a.txt']);
    git(['commit', '-q', '-m', 'init']);
    assert.deepEqual(D.worktreeDirtyPaths(repo), [], '干净仓库必须读出空集，否则"差集非空即副作用"永远为真');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n', 'utf8');
    assert.deepEqual(D.worktreeDirtyPaths(repo), ['a.txt'], '改一个受管文件必须被列出来');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'x\n', 'utf8');
    assert.deepEqual(D.worktreeDirtyPaths(repo).sort(), ['a.txt', 'new.txt'], '未跟踪新文件也要列（.ccg 产物被覆写就是这一族）');
    // 重命名那一格的形状是 `R  old -> new`：判据必须取**箭头右侧**，取左侧等于报一个盘上不存在的路径
    fs.rmSync(path.join(repo, 'new.txt'), { force: true });
    git(['add', 'a.txt']);
    git(['commit', '-q', '-m', 'second']);
    git(['mv', 'a.txt', 'b.txt']);
    const renamed = D.worktreeDirtyPaths(repo);
    assert.ok(renamed.includes('b.txt'), 'rename 必须取箭头右侧（实际：' + JSON.stringify(renamed) + '）');
    assert.ok(!renamed.includes('a.txt'), '把左侧旧名报出来会让人去 checkout 一个不存在的路径（实际：' + JSON.stringify(renamed) + '）');
    // 取不到读数 ⇒ 抛错，不得读成"没有副作用"
    assert.throws(() => D.worktreeDirtyPaths(path.join(repo, 'no-such-dir')), /取不到读数|无从判定/,
      'git 失败被读成空集 = 把工具的失明读成"现场干净"');
    // 体检函数本身：它自己取"跑后快照"，所以入参是 (跑前集合, 靶子清单, cwd)。
    // 三档结果各有断言，且**失明档必须返回 PROBLEM 而不是 null**。
    const se = D.checkSideEffects;
    assert.equal(typeof se, 'function', '导出面缺 checkSideEffects ⇒ 体检长在 finally 里，测不到也反证不了');
    // 上面几格留下了一次未提交的 rename，先把夹具收干净再量"零副作用"——
    // 否则这条断言量到的是自己的夹具，不是被测函数。
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'third']);
    assert.deepEqual(D.worktreeDirtyPaths(repo), [], '夹具没收干净，下面的"零副作用"断言就是空的');
    assert.equal(se(new Set(), [], repo), null, '干净仓库不得虚报副作用');
    fs.writeFileSync(path.join(repo, 'leak.txt'), 'x\n', 'utf8');
    const hit = se(new Set(), [], repo);
    assert.equal(hit.state, 'PROBLEM', '跑后新出现的未跟踪文件必须报（.ccg 产物被覆写就是这一族）');
    assert.match(hit.why, /leak\.txt/, '文案必须点名精确路径，否则人没法还原');
    assert.equal(se(new Set(['leak.txt']), [], repo), null, '跑前就脏的（别人的在飞改动）不得认领成本轮副作用');
    const blind = se(new Set(), [], path.join(repo, 'no-such-dir'));
    assert.equal(blind.state, 'PROBLEM', 'git 挂掉被读成 null = 把工具的失明读成"没有副作用"（变异 n38 就钉这一格）');
    assert.match(blind.why, /无从判定/);
    assert.equal(se(undefined, [], repo).state, 'PROBLEM', '入参坏了也要出声，不得静默判干净');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
  // 结构锁：runAll 必须拍跑前快照，并在**还原之后**调用这次体检
  const drv = read('scripts/qm6-exit-capabilities.mutation.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const snap = drv.indexOf('const dirtyBefore = new Set(worktreeDirtyPaths())');
  const callAt = drv.indexOf('checkSideEffects(dirtyBefore, targets)');
  assert.ok(snap >= 0, '没有跑前快照 ⇒ 会把别人在飞的改动认领成本轮的副作用，这条体检就是噪声生成器');
  assert.ok(callAt >= 0, 'runAll 没调用这次体检 ⇒ 上面那组行为断言测的是没人用的函数');
  assert.ok(drv.lastIndexOf('restoreAll(orig);') < callAt,
    '体检必须排在还原**之后**：还原前量到的是变异本身，不是残留副作用');
  assert.match(drv, /if \(se\) results\.push\(se\);/, '体检结果必须进 results（只打印一行警告等于没有闸）');
  assert.match(drv, /x\.id !== 'side-effects'/,
    'side-effects 不得计入 TOTAL（它是驱动体检不是变异结果），但必须仍能把 RESULT 打成 FAIL');
  // 差集本体必须是**可单测的纯函数**：只锁"调用在位"锁不出"返回恒空数组"这一格
  // （本刀 n15 的同型教训：调用在位但结果被常数覆盖，源码形状锁看不见）。
  const sp = D.sideEffectPaths;
  assert.equal(typeof sp, 'function', '导出面缺 sideEffectPaths ⇒ 差集逻辑长在循环里，测不到也反证不了');
  assert.deepEqual(sp(new Set(), [], ['x.txt']), ['x.txt'], '跑后新出现的脏文件必须被列出来');
  assert.deepEqual(sp(new Set(['x.txt']), [], ['x.txt']), [], '跑前就脏的（别人的在飞改动）不得认领成本轮的副作用');
  assert.deepEqual(sp(new Set(), ['a.js'], ['a.js']), [], '靶子文件由靶子还原那条断言管，不重复报');
  assert.deepEqual(sp(new Set(['p']), ['q'], ['q', 'r', 'p']), ['r'], '三档同时生效：只留下真正的新增外部脏文件');
  assert.throws(() => sp(undefined, [], ['x']), /before 必须是 Set/, '缺跑前快照不得退化成"全部算副作用"或"全不算"');
  assert.throws(() => sp(new Set(), undefined, ['x']), /targets 必须是数组/);
  assert.throws(() => sp(new Set(), [], undefined), /after 必须是数组/,
    '取不到读数被当成空集 = 把工具的失明读成"现场干净"（本仓点名的同型）');
});


test('A17 驱动开工前必须证明靶子与 HEAD 一致；脏基线一律拒绝，不得把污染当成"原始内容"', () => {
  const D = require('./qm6-exit-capabilities.mutation.js');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm6-mut-baseline-'));
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[k];
  const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env });
  try {
    // 夹具由 git 自己生成（不在 git 里手写 .gitattributes），且只测 porcelain 读数、不涉内容归一化
    assert.equal(g(['init', '-q', '.']).status, 0, '夹具仓库建不起来，这条用例无从证明任何事');
    g(['config', 'user.email', 'fixture@example.invalid']);
    g(['config', 'user.name', 'fixture']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n', 'utf8');
    assert.equal(g(['add', '--', 'a.txt']).status, 0);
    assert.equal(g(['commit', '-q', '-m', 'base']).status, 0, '夹具必须有一个提交可以比对');
    assert.equal(D.gitCleanAgainstHead('a.txt', dir), true, '干净基线必须读出 true，否则下面那句"脏了才红"是空的');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n', 'utf8');
    assert.equal(D.gitCleanAgainstHead('a.txt', dir), false, '工作树被改过却仍报干净 ⇒ 这道闸恒开，污染会被固化成 ORIG');
    assert.throws(() => D.assertCleanBaseline(['a.txt'], dir), /与 HEAD 不一致/);
    // 取不到读数时必须抛错（未证实），不得当成"干净"或"脏"随便挑一个继续
    assert.throws(() => D.gitCleanAgainstHead('a.txt', path.join(dir, 'no-such-dir')), /取不到读数|未证实/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A18 驱动的旗标不得被静默忽略：未知旗标与 --restore 混用都必须当场拒绝', () => {
  // 直接调 parseCli，不 spawn 本驱动：spawn 出的子进程若因某个变异不再拒绝未知旗标，
  // 它会在父驱动正改文件时**再开一轮变异扫描**，两个进程互相把对方的污染当基线。
  const D = require('./qm6-exit-capabilities.mutation.js');
  assert.throws(() => D.parseCli(['--bogus']), /未知旗标/,
    '未知旗标被吞掉 ⇒ 一次"只跑某条变异"的意图会变成整轮扫描，而读数看着完全正常');
  assert.throws(() => D.parseCli(['--restore', 'n1']), /必须单独使用/,
    '--restore 与变异 id 混用 ⇒ "还原"和"改文件"同时发生，还原结果不是它声称的那份');
  assert.deepEqual(D.parseCli([]), { restore: false, only: [], allowDirty: false });
  assert.deepEqual(D.parseCli(['n3', 'n4']), { restore: false, only: ['n3', 'n4'], allowDirty: false },
    '位置参数必须原样交给变异 id 校验，不得在这里被二次吞掉');
  assert.deepEqual(D.parseCli(['--restore']), { restore: true, only: [], allowDirty: false });
  assert.equal(D.parseCli(['--allow-dirty']).allowDirty, true,
    '脏基线只有这一条显式出口；它被吞掉就等于默认拒绝变成了默认放行');
});

test('A19 卫生检查与单实例锁必须排在任何写动作之前（顺序错了就等于没有这道闸）', () => {
  const full = read('scripts/qm6-exit-capabilities.mutation.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  // 搜索域必须收敛到 runAll 那一段：M 表里就写着各条变异的锚点字面量，
  // 全文 indexOf 会先命中表里的那一份（n26 实测 MISSED 就是这么来的）。
  const start = full.indexOf('function runAll');
  assert.notEqual(start, -1, '驱动里没有 runAll ⇒ 本锁无从定位执行体，不是"没事"');
  const src = full.slice(start);
  const at = (needle) => {
    const i = src.indexOf(needle);
    assert.notEqual(i, -1, `runAll 里找不到 ${needle} ⇒ 这道闸被摘掉了，而本文件其余用例不会因此变红`);
    return i;
  };
  const lock = at('acquireLock();');
  const clean = at('assertCleanBaseline(targets)');
  const sidecar = at('writeSidecar(orig)');
  const writeLoop = at('write(m.file, before.split(expand(before, m.from))');
  assert.ok(lock < clean && clean < sidecar && sidecar < writeLoop,
    `顺序必须是「拿锁 → 证干净 → 存 sidecar → 才动文件」，实得 lock=${lock} clean=${clean} sidecar=${sidecar} writeLoop=${writeLoop}`);
  // 锁必须在 finally 里释放，且在文件还原之后（抛错路径上留一把死锁 = 下一次运行被不存在的进程挡住）
  const fin = src.slice(src.indexOf('} finally {'));
  assert.ok(fin.includes('restoreAll(orig);') && fin.includes('releaseLock();'),
    'finally 必须同时做「还原文件」和「释放锁」：' + fin.slice(0, 200));
  assert.ok(fin.indexOf('restoreAll(orig);') < fin.indexOf('releaseLock();'),
    '先还原再放锁：反过来会让第二个进程对着未还原的文件开工');
});

test('A20 单实例锁：并发第二轮必须当场拒绝，且不自动破锁；释放后能重新拿到', () => {
  const os = require('node:os');
  const D = require('./qm6-exit-capabilities.mutation.js');
  const p = path.join(os.tmpdir(), 'qm6-mut-lock-' + process.pid + '-' + Math.random().toString(36).slice(2));
  try {
    assert.equal(D.acquireLock(p), p, '第一次拿锁必须成功并返回锁路径');
    assert.ok(fs.existsSync(p), '锁文件必须真的落盘（拿锁只是内存标记的话，第二个进程看不见）');
    assert.match(String(fs.readFileSync(p, 'utf8')), /^\d+$/, '锁里必须写持有者 pid —— 没有它，被挡住的人无法归因是谁占着');
    assert.throws(() => D.acquireLock(p), /另一个变异驱动正在跑/,
      '并发第二轮被静默放行 ⇒ 两个进程会同时改写同一批靶子并互相覆盖 sidecar，还原时拿错基线');
    // 不自动破锁：陈旧锁也一律拒绝，让人来看一眼（自动破锁就是把这一类故障重新打开）
    fs.writeFileSync(p + '.stale', 'x', 'utf8');
    D.releaseLock(p + '.stale');
    assert.equal(fs.existsSync(p + '.stale'), false, 'releaseLock 必须真的删掉锁文件');
    D.releaseLock(p);
    assert.equal(fs.existsSync(p), false);
    D.acquireLock(p);
    assert.ok(fs.existsSync(p), '释放后必须能重新拿到（否则一次崩溃就永久封死这条工具）');
    D.releaseLock(p);
    D.releaseLock(p); // 幂等：ENOENT 不得抛错，finally 里二次释放是正常路径
  } finally {
    for (const f of [p, p + '.stale']) { try { fs.unlinkSync(f) } catch (e) { if (e.code !== 'ENOENT') throw e } }
  }
});

/* ---------------- 工具 ---------------- */

function vendorDriver () {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const dirs = [];
  if (process.env.CCG_ARL_DIR) dirs.push(path.join(process.env.CCG_ARL_DIR, 'scripts'));
  if (home) dirs.push(path.join(home, '.claude', 'skills', 'adversarial-review-loop', 'scripts'));
  for (const d of dirs) {
    const driver = path.join(d, 'ccg-deep-review.js');
    if (fs.existsSync(driver)) return { path: driver, src: fs.readFileSync(driver, 'utf8') };
  }
  return { path: null, src: '' };
}
