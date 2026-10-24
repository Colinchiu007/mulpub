'use strict';
/**
 * 变异反证驱动：qm6-exit-capabilities（change: qm6-exit-capability-probe）
 *
 * 目的不是"证明测试能红"，而是证明**每条锁真的在守它声称的那个东西**。
 * 七条硬约束沿用上一刀（PR #4234 固化、PR #4305 复用的那版）：
 *  1. 动手前先读原始字节建基线，每条变异前复核"文件没被别人改过"；
 *  2. 锚点必须恰命中 1 次，且目标文本在改前不得已存在；
 *  3. 应用后先 `node --check`，语法坏掉记 PROBLEM 而不是 MISSED；
 *  4. 每个靶子套件必须真的被收集（`# tests N`，N ≥ 下界）；一个没跑的文件在摘要里与"跑了且绿"同形；
 *  5. 还原后立即重跑一次被测锁，全绿才继续下一条；
 *  6. MISSED 只允许是声明过的重叠，且重叠须由另一条变异机械证明 —— 本刀 `ALLOWED_MISSED` 留空；
 *  7. 写后必须回读：锚点命中数只证明"它在原文里唯一"，不证明"盘上现在是被改后的内容"。
 * 另加本刀特有的一条：**expectGreen 是会被打脸的声明**（上一刀 m18 实测被否证过一次），
 * 所以凡"某套件必须照绿"的断言，红了即 PROBLEM，不得读成"少红一条也算过"。
 *
 * 用法：node scripts/qm6-exit-capabilities.mutation.js [id …]
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CAPS = 'scripts/qm6-exit-capabilities.js';
const LOCKS = 'scripts/qm6-exit-capabilities.test.js';
const PROBE = 'scripts/ccg-convergence-probe.js';
const PROBET = 'scripts/ccg-convergence-probe.test.js';
const WF = '.github/workflows/quality-gate.yml';
const MUT = 'scripts/qm6-exit-capabilities.mutation.js';

const SUITES = [
  { file: LOCKS, minTests: 24 },
  { file: PROBET, minTests: 12 },
];

const M = [
  {
    id: 'n1', file: CAPS,
    note: 'upheld 谓词改成恒 true ⇒ 探针会宣布一条根本不存在的出口，而下一条 PR 会照着它写"机制已闭合"',
    from: '  return /\\breturn\\b/.test(blk) && /Capable|Satisfied|resolvedEvidence|resolution\\b|externalReview/.test(blk);',
    to: '  return true;',
    expect: ['A2'],
  },
  {
    id: 'n2', file: CAPS,
    note: 'upheld 谓词改成恒 false ⇒ 将来真加了出口的 PR 也不会被看见（另一个方向的同一种谎）',
    from: '  return /\\breturn\\b/.test(blk) && /Capable|Satisfied|resolvedEvidence|resolution\\b|externalReview/.test(blk);',
    to: '  return false;',
    expect: ['A2'],
  },
  {
    id: 'n3', file: CAPS,
    note: '把"整块配对"退回"固定窗口" ⇒ 多几行注释就改变读数（本仓点名的窗口判据同型）',
    from: '  const blk = sliceBlock(body.slice(at).replace(/^[ \\t]*if[ \\t]*\\([^)]*\\)/, \'\'));',
    to: "  const blk = body.slice(at).split('\\n').slice(0, 3).join('\\n');",
    expect: ['A3'],
    expectGreen: [PROBET],
  },
  {
    id: 'n4', file: CAPS,
    note: '高危域谓词放宽成"文本里出现过谓词名" ⇒ 注释里提一句就会被当成解除臂在位',
    from: '  const hasPredicate = /^[ \\t]*function[ \\t]+externalReviewSatisfied[ \\t]*\\(/m.test(driverSrc);',
    to: '  const hasPredicate = /externalReviewSatisfied/.test(driverSrc);',
    expect: ['A1'],
  },
  {
    id: 'n5', file: CAPS,
    note: '工具署名谓词改成恒 true ⇒ 会说"自扮演收口可以署名"，而写回器今天仍在拒签',
    from: '  return /\\|\\|/.test(cond);',
    to: '  return true;',
    expect: ['A5'],
  },
  {
    id: 'n6', file: CAPS,
    note: '重演 #4062 的撤销方式：把一条谓词从导出面摘掉（不是改坏实现，是"删掉检测"本身）',
    from: '  externalReviewCapable, upheldExitCapable, toolSignatureCapable,',
    to: '  externalReviewCapable, toolSignatureCapable,',
    expect: ['A12'],
  },
  {
    id: 'n7', file: CAPS,
    note: '把 unknown 档折叠成 false ⇒ "vendor 被改名"与"这条出口不存在"在读数上同形（本刀立项的那条假话）',
    from: "  if (typeof driverSrc !== 'string' || driverSrc.trim() === '') return 'unknown';\n  if (!/blockingFromAdjudication/.test(driverSrc)) return 'unknown';",
    to: "  if (typeof driverSrc !== 'string' || driverSrc.trim() === '') return false;\n  if (!/blockingFromAdjudication/.test(driverSrc)) return false;",
    expect: ['A6'],
  },
  {
    id: 'n8', file: CAPS,
    note: '结论生成器改成无视入参 ⇒ 结论又变回一句与读数无关的散文',
    from: '  const phrase = (v, yes, no, unknown) => (v === \'unknown\' ? unknown : (v === true ? yes : no));',
    to: "  const phrase = (v, yes, no, unknown) => no;",
    expect: ['A8'],
  },
  {
    id: 'n9', file: CAPS,
    note: '三档不变量的检查改成恒过 ⇒ 谓词漏写 return（undefined）会被静默读成"没有出口"',
    from: '    if (!NOVEL.has(String(v))) throw new Error(',
    to: '    if (false) throw new Error(',
    expect: ['A7'],
  },
  {
    id: 'n10', file: PROBE,
    note: '探针把结论行写死回旧句子 ⇒ 假话复发，且只有 A10 会发现',
    from: "    + capabilities.conclusionLine(caps) + '\\n');",
    to: "    + '而 self-play 对 crypto 项无条件计阻断 ⇒ 深度审查闭环不可达\\n');",
    expect: ['A10'],
  },
  {
    id: 'n11', file: PROBE,
    note: '摘掉探针与读数器之间的接线（require 行）⇒ 读数存在但没有执行体',
    from: "const capabilities = require('./qm6-exit-capabilities.js');",
    to: 'const capabilities = null;',
    expect: ['A10'],
  },
  {
    id: 'n12', file: WF,
    note: '把契约锁从 Gate 2b6 的 run 正文里删掉 ⇒ 它存在但永不执行，而文件仍在（装饰性门禁的原始形态）',
    from: '          node --test scripts/qm6-exit-capabilities.test.js',
    to: '',
    expect: ['A11'],
    expectGreen: [PROBET],
  },
  {
    id: 'n13', file: PROBET,
    note: '把 P6 白名单收窄的代价做实：让 isThirdPartyRequire 恒 false ⇒ 真第三方 require 也能过关',
    from: "  if (id.startsWith('./') || id.startsWith('../')) return false;",
    to: '  return false;',
    expect: ['P9'],
  },
  {
    id: 'n14', file: CAPS,
    note: '两路比较改成恒 ok ⇒ "交叉验证"变成装饰：结构读法失效时探针照样报一致',
    from: '  if (structural !== behavioral) {',
    to: '  if (false) {',
    expect: ['A14'],
  },
  {
    id: 'n15', file: CAPS,
    note: '行为档入口改成"是函数就 unavailable" ⇒ 真跑路径整体不执行，交叉只剩结构一路'
      + '（锚点必须带上函数头：同一句守卫现在在正控里也有一份，只写那一行会命中 2 次）',
    from: 'function upheldExitBehavioral (fn, opts) {\n  if (typeof fn !== \'function\') return \'unavailable\';',
    to: 'function upheldExitBehavioral (fn, opts) {\n  if (typeof fn === \'function\') return \'unavailable\';',
    expect: ['A13'],
    alsoExpect: ['P10'],
  },
  {
    id: 'n16', file: CAPS,
    note: '摘掉"无凭证那份必须阻断"这道防呆 ⇒ 随便填两格就能被判成出口在位（行为档失去区分度）',
    from: "  if (bare.length === 0) throw new Error('无凭证那份居然不阻断 ⇒ 这条出口没有\"缺一格即拦\"的防呆，不得判在位');",
    to: '  if (bare.length === 0) return true;',
    expect: ['A13'],
  },
  {
    id: 'n17', file: PROBE,
    note: '探针把行为档常数覆盖成 unavailable ⇒ 调用还在、结果不再来自真跑（A15 只查在位，看不见这格；P10 才看得见）',
    from: '  caps.upheldBehavioral = behavioral.upheld;',
    to: "  caps.upheldBehavioral = 'unavailable';",
    expect: ['P10'],
  },
  {
    id: 'n18', file: PROBE,
    note: '摘掉"vendor 在位但行为档取不到数"这道守卫 ⇒ 两路全瞎时探针仍报"两路一致：不在位"，与真跑确认过的结论逐字同形',
    from: "  if (caps.upheldBehavioral === 'unavailable' && !capabilities.isBehavioralSkip(caps.behavioralSkip)) problems.push(",
    to: '  if (false) problems.push(',
    expect: ['P11'],
  },
  {
    id: 'n19', file: CAPS,
    note: '正控改成恒 true ⇒ "这份凭证确实被 vendor 消费"变成一句自我确认；行为档可以在空夹具上给出 false 读数',
    from: '  return out.length === 0;',
    to: '  return true;',
    expect: ['A16'],
  },
  {
    id: 'n20', file: CAPS,
    note: '摘掉"正控不成立即拒绝给结论"这道闸 ⇒ 夹具键名写错时"没有出口"这个读数什么也没测，却看着完全正常',
    from: "  if (opts && opts.receiptLive === false) return 'unavailable';",
    to: '  if (false) return \'unavailable\';',
    expect: ['A13'],
  },
  {
    id: 'n21', file: CAPS,
    note: '把解除臂词表里的 externalReview 摘掉 ⇒ vendor 今天唯一消费的凭证键写成的臂读不出来（那条臂的夹具就成了无人量的装饰）',
    from: '  return /\\breturn\\b/.test(blk) && /Capable|Satisfied|resolvedEvidence|resolution\\b|externalReview/.test(blk);',
    to: '  return /\\breturn\\b/.test(blk) && /Capable|Satisfied|resolvedEvidence|resolution\\b/.test(blk);',
    expect: ['A2'],
  },
  // ↓ 这四条的靶子是**驱动自己**（MUT）。锚点与目标串都写成两段拼接：
  //   直接写整串时，M 表里这行字面量本身就是文件内容的一部分，"命中恰 1 次"与"改前不得已存在"
  //   两道自检都会被自己反咬（实测：n22 报命中 2 次）。这是本仓「锚点唯一性被自己插入的文本反咬」
  //   的又一落点，正解是改**插入的写法**，不是放宽命中数要求。
  {
    id: 'n22', file: MUT,
    note: '摘掉"开工前证靶子干净"这道闸 ⇒ 驱动会把上一次崩溃留下的污染当成原始内容并在还原时写回它',
    from: '    assertCleanBaseline' + '(targets);',
    to: '    // (摘除这道' + '闸)',
    expect: ['A19'],
  },
  {
    id: 'n23', file: MUT,
    note: '摘掉 sidecar ⇒ 被信号杀掉时盘上留在"改坏的那一份"，而仓里没有任何可执行的出口（只有散文式的"请自行恢复"）',
    from: '  writeSidecar' + '(orig);',
    to: '  // (摘除 ' + 'sidecar)',
    expect: ['A19'],
  },
  {
    id: 'n24', file: MUT,
    note: '未知旗标不再拒绝 ⇒ 一次拼错的 `--limit` 会读成"整轮扫描"，而本驱动改的是受 git 管理的源文件',
    from: '  const unknown = flags.filter((a) => !KNOWN_FLAGS' + '.includes(a));',
    to: '  const unknown = flags.filter(() => ' + 'false);',
    expect: ['A18'],
  },
  {
    id: 'n25', file: MUT,
    note: '允许 --restore 与变异 id 混用 ⇒ 同一趟里既还原又改文件，还原结果不再是它声称的那份',
    from: "    if (only.length) throw new Error('--restore 必须单独使用" + '（它不做变异，只做还原）\');',
    to: '    if (false) throw new ' + "Error('--restore 必须单独使用（它不做变异，只做还原）');",
    expect: ['A18'],
  },
  {
    id: 'n26', file: MUT,
    note: '不拿单实例锁 ⇒ 两轮驱动并发改写同一批靶子、sidecar 互相覆盖，还原时拿错基线（锚点带换行是为了只命中 runAll 那一处）',
    from: '\n  acquireLock' + '();',
    to: '\n  // (不拿锁)',
    expect: ['A19'],
  },
  {
    id: 'n27', file: MUT,
    note: 'finally 里不释放锁 ⇒ 一次正常跑完就把这条工具永久封死（陈旧锁不自动破是设计，但正常路径必须释放）',
    from: '\n    releaseLock();',
    to: '\n    // (不释放锁)',
    expect: ['A19'],
  },
  {
    id: "n28", file: CAPS,
    note: "摘掉「顶层裸执行 main() 就禁止 require」那一格 ⇒ 2026-10-24 现场复发：--json 的 stdout 变成别人的输出",
    from: "  if (MAIN_INVOCATION.test(driverSrc) && !MAIN_GUARDED.test(driverSrc)) return { loadable: false, reason: 'executes-on-require' };",
    to: "  // (摘掉这一格 ⇒ 未守卫的驱动也会被 require，探针变成别人流水线的宿主)",
    expect: ["A21","P12"],
  },
  {
    id: "n29", file: CAPS,
    note: "判据退回「看见 process.exit 就禁」⇒ 函数体内的合法早退也被排除，唯一正常形态反被判成不可加载",
    from: "const MAIN_INVOCATION = /\\bprocess\\.exit\\(\\s*main\\s*\\(\\s*\\)\\s*\\)/;",
    to: "const MAIN_INVOCATION = /process\\.exit\\(/;",
    expect: ["A21"],
  },
  {
    id: "n30", file: CAPS,
    note: "把 no-exports 混进「按设计的跳过」表 ⇒ 真失明被读成「这台机器没装引擎」，P11 那条 rc=1 就此失效",
    from: "const BEHAVIORAL_SKIP_REASONS = Object.freeze(['unreadable', 'executes-on-require']);",
    to: "const BEHAVIORAL_SKIP_REASONS = Object.freeze(['unreadable', 'executes-on-require', 'no-exports']);",
    expect: ["A21","P11"],
  },
  {
    id: "n31", file: CAPS,
    note: "交叉文案丢掉真实成因 ⇒「装了但不敢跑」与「没装」同形（合并成因是本仓点名的同型）",
    from: "  if (behavioral === 'unavailable') return { ok: true, note: 'behavioral=skipped(' + (skipReason || 'no-vendor') + ')' };",
    to: "  if (behavioral === 'unavailable') return { ok: true, note: 'behavioral=skipped(no-vendor)' };",
    expect: ["A14","P12"],
  },
  {
    id: "n32", file: PROBE,
    note: "探针侧把可加载性早退改成不生效 ⇒ require 先跑起来；A21 那种「判据在模块里但没人用」必须靠这条才不是纸面的",
    from: "  if (!load.loadable) {",
    to: "  if (false) {",
    expect: ["P12"],
  },
  {
    id: "n33", file: PROBE,
    note: "摘掉「按成因表决定是否出声」这条接线 ⇒ no-exports 那一档的 rc=1 退化成静默 0，同时 A15 的接线锁红",
    from: "  if (caps.upheldBehavioral === 'unavailable' && !capabilities.isBehavioralSkip(caps.behavioralSkip)) problems.push(",
    to: "  if (caps.upheldBehavioral === 'unavailable' && false) problems.push(",
    expect: ["A15","P11"],
  },
  {
    id: "n34", file: CAPS,
    note: "把 MAIN_GUARDED 退回\"不认花括号\"的上一版形态 ⇒ A21 那条花括号夹具必须红（第 4 轮评审 i3 成立的现场，被禁形态本身）",
    from: "const MAIN_GUARDED = /\\bif\\s*\\(\\s*require\\.main\\s*===\\s*module\\s*\\)\\s*\\{?\\s*process\\.exit\\(\\s*main\\s*\\(\\s*\\)\\s*\\)/;",
    to: "const MAIN_GUARDED = /\\bif\\s*\\(\\s*require\\.main\\s*===\\s*module\\s*\\)\\s*process\\.exit\\(\\s*main\\s*\\(\\s*\\)\\s*\\)/;",
    expect: ["A21"],
  },
  {
    id: "n35", file: PROBE,
    note: "探针侧把成因判定写成恒真 ⇒ 任何 unavailable 都算\"按设计的跳过\"，真失明的 rc=1 整条消失（A15 + P11 各指名一条红）",
    from: "  if (caps.upheldBehavioral === 'unavailable' && !capabilities.isBehavioralSkip(caps.behavioralSkip)) problems.push(",
    to: "  if (caps.upheldBehavioral === 'unavailable' && !true) problems.push(",
    expect: ["A15","P11"],
  },
  {
    id: "n36", file: PROBE,
    note: "探针内联一份第二版成因表 ⇒ 行为一字不变但\"单一实现\"没了（A22 抓的就是这一格，A15/P 系列全都照样绿）",
    from: "  if (caps.upheldBehavioral === 'unavailable' && !capabilities.isBehavioralSkip(caps.behavioralSkip)) problems.push(",
    to: "  if (caps.upheldBehavioral === 'unavailable' && !['unreadable', 'executes-on-require'].includes(caps.behavioralSkip)) problems.push(",
    expect: ["A22","A15"],
    expectGreen: [PROBET],
  },
  {
    id: "n37", file: MUT,
    note: "差集恒空 ⇒ 副作用体检永远报\"现场干净\"，A23 的新增脏文件那一档当场红（n32 覆写 .ccg 的现场就是这么被吞掉的）",
    from: "  return after.filter((p) => !befor" + "e.has(p) && !targets.includes(p));",
    to: "  retu" + "rn [];",
    expect: ["A23"],
  },
  {
    id: "n38", file: MUT,
    note: "git 取不到读数时 return null ⇒ 把工具的失明读成\"没有副作用\"（本仓点名的同型），A23 的失明档红",
    from: "  } catch (e) {\n    return { id: 'side-effects', state: " + "'PROBLEM', why: `副作用无从判定（git 取不到读数）：${e.message}` };\n  }",
    to: "  } catch (e) {\n  " + "  return null;\n  }",
    expect: ["A23"],
  },
  {
    id: "n39", file: MUT,
    note: "套件不再在沙箱 env 里跑 ⇒ 反证拿本机 vendor 陪跑：n32 那一类靶子会真的跑起别人的评审流水线，且 MISSED/CAUGHT 集随本机状态漂移（A25 抓这一格）",
    from: "spawnSync(process.execPath, ['--test', suite.file], " + "{ cwd: ROOT, encoding: 'utf8', env: sandboxEnv() })",
    to: "spawnSync(process.execPath, ['--test', suite.file], { cwd: ROOT, encoding: 'utf8' })",
    expect: ["A25"],
  },
  {
    id: 'msanity', file: LOCKS,
    note: '驱动自己的体检：把一个期望值改成明显错的数；这条不红就是驱动没在读 TAP',
    from: "  assert.equal(C.toolSignatureCapable(WB_SINGLE), false, '今天只认 performedBy ⇒ 自扮演收口永拿不到 tier');",
    to: "  assert.equal(C.toolSignatureCapable(WB_SINGLE), true, 'sanity');",
    expect: ['A5'],
  },
];

const ALLOWED_MISSED = new Set();

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const write = (rel, text) => fs.writeFileSync(path.join(ROOT, rel), text, 'utf8');
/** 锚点按 LF 书写；按被改物的真实行尾展开（写回时不留混行尾）。 */
const expand = (text, s) => (text.includes('\r\n') ? s.split('\n').join('\r\n') : s);
const nameHit = (reds, want) => reds.some((r) => r === want || r.startsWith(want + ' '));

/**
 * 反证运行态的 vendor 沙箱：跑每一轮套件时把 `CCG_ARL_DIR` / `HOME` / `USERPROFILE` 指到一个空的临时目录，
 * 于是 `locateVendor()` 一律返回 null —— **本机装的是什么 vendor 都不参与反证**。
 *
 * 为什么必须这样（design §1.4 的同一条教训，落在驱动这一侧）：
 * ① 反证结果必须可复现。带着本机 vendor 跑，P1/P3 走"有引擎"那一档、P10-P12 走夹具那一档，
 *    同一次运行里混着两种机器态，换台机器 MISSED/CAUGHT 集会变；
 * ② 更要命的是 n32 那一类靶子：它摘掉的正是"不许 require 未守卫驱动"那道闸，
 *    带着真 vendor 跑就等于**让反证驱动在本机真的跑一遍评审流水线**（实测覆写了 `.ccg` 判定产物）。
 *    变异要测的是"探针会不会去 require 它"，那件事由 P12 的自建夹具证明就够了，不需要拿真引擎陪葬。
 * ③ 因此 `expect` 里没有任何一条指望 P1/P3 的"有引擎"分支（当场核对：39 条靶子里 0 条引用 P1/P3）。
 */
function vendorSandbox () {
  if (SANDBOX && fs.existsSync(SANDBOX)) return SANDBOX;
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'qm6-mut-vendorless-'));
  return SANDBOX;
}

function sandboxEnv () {
  const dir = vendorSandbox();
  const env = { ...process.env, CCG_ARL_DIR: dir, HOME: dir, USERPROFILE: dir };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[k];
  return env;
}

function suiteRun (suite) {
  const r = spawnSync(process.execPath, ['--test', suite.file], { cwd: ROOT, encoding: 'utf8', env: sandboxEnv() });
  const out = String(r.stdout || '');
  const m = out.match(/^# tests (\d+)$/m);
  const f = out.match(/^# fail (\d+)$/m);
  const reds = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1].trim());
  if (!m || !f) return { ok: false, why: `UNREADABLE(${suite.file}) 没有 # tests / # fail 行 rc=${r.status} stderr=${String(r.stderr).slice(0, 160)}` };
  const collected = Number(m[1]);
  if (collected < suite.minTests) return { ok: false, why: `UNREADABLE(${suite.file}) collected=${collected} < 下界 ${suite.minTests}` };
  if (r.status !== 0 && reds.length === 0) return { ok: false, why: `UNREADABLE(${suite.file}) rc=${r.status} 但失败清单为空（LOADFAIL/worker 被杀一类）：${out.slice(-300)}` };
  return { ok: true, suite: suite.file, collected, reds };
}

function restoreAll (orig) {
  for (const [f, text] of Object.entries(orig)) {
    if (read(f) !== text) write(f, text);
    if (read(f) !== text) throw new Error(`还原失败：${f}`);
  }
}

/* ---------------- 基线卫生与异常终止的出口（QM-6 第二轮评审 i2） ---------------- */
// 本驱动**原地覆盖受 git 管理的源文件**。finally 只覆盖"抛错"这一条路：被 SIGTERM/断电杀掉时
// 盘上留的就是被改坏的那一份，而下一次运行会把它的字节当成"原始内容"（本仓实测过一次：
// 崩溃一次的驱动把污染态固化成 ORIG）。所以这里给两条机械出口，不写"请自行恢复"这种散文。
const SIDECAR = path.join(os.tmpdir(), 'qm6-exit-capabilities-mutation-orig.json');
const LOCK = SIDECAR + '.lock';
let SANDBOX = '';

/**
 * 单实例锁（QM-6 第三轮评审 i1 的可修那一半）：两个驱动同时跑会**同时改写同一批受 git 管理的源文件**，
 * 而 sidecar 是固定文件名 —— 后写的覆盖先写的，`--restore` 于是会还原成另一轮的基线。
 * 用 `wx` 标志原子建文件（存在即 EEXIST），锁里写 pid；被 SIGKILL 留下陈旧锁时**不自动破锁**：
 * 自动破锁等于把"两个进程互相踩对方的基线"这一整类故障重新打开，宁可让人来看一眼。
 */
function acquireLock (lockPath) {
  const p = lockPath || LOCK;
  try {
    const fd = fs.openSync(p, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      let holder = '<unreadable>';
      try { holder = String(fs.readFileSync(p, 'utf8')).trim() || '<empty>' } catch (e2) { holder = '<unreadable:' + e2.code + '>' }
      throw new Error('另一个变异驱动正在跑（锁=' + p + '，持有者 pid=' + holder
        + '）。两个驱动会同时改写同一批靶子并互相覆盖 sidecar，还原时会拿错基线。'
        + '正解：先确认那个进程还在不在（不在才手工删这个锁文件），不要并发跑，也不要"重试到绿"。');
    }
    throw e;
  }
  return p;
}

function releaseLock (lockPath) {
  const p = lockPath || LOCK;
  try { fs.unlinkSync(p) } catch (e) { if (!e || e.code !== 'ENOENT') throw e }
}

function gitCleanAgainstHead (f, cwd) {
  const env = { ...process.env };
  // GIT_DIR 一类变量会静默压过 cwd（钩子窗口里实测踩过）：那时量的根本不是本仓的追踪态。
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[k];
  const r = spawnSync('git', ['status', '--porcelain', '--', f], { cwd: cwd || ROOT, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`git status 取不到读数（rc=${r.status}）⇒ 按未证实处理，不得在量不到基线时改文件：${String(r.stderr).slice(0, 160)}`);
  return String(r.stdout || '').trim() === '';
}

function assertCleanBaseline (targets, cwd) {
  const dirty = targets.filter((f) => !gitCleanAgainstHead(f, cwd));
  if (dirty.length) {
    throw new Error('靶子与 HEAD 不一致：' + dirty.join(', ')
      + '\n  ⇒ 驱动会把这份污染当成"原始内容"并在还原时写回它（本仓实测发生过一次）。'
      + '\n  正解：先提交，或 `git checkout HEAD -- <上面逐个精确路径>`（禁止宽目录），再重跑。');
  }
}

/**
 * 整个工作树的脏路径快照（QM-6 第 4 轮 i1/i6 逼出来的那一半，不是散文）。
 * 动因：n32 摘掉的正是"不许 require 未守卫驱动"那道闸 —— 那一轮变异在本机**真的**把 vendor 的
 * 评审流水线跑了起来，覆写了 `.ccg/reviews/*.json` 判定产物并在 `.adversarial/` 落了目录。
 * 驱动的还原范围只含靶子文件，对这类**外部副作用**完全失明：跑完照打 RESULT=OK，
 * 而盘上留着一份被改坏的评审产物 —— 那是"还原干净了"这句自我声明的假绿。
 * 现在跑前拍一张快照、跑完（还原之后）再拍一张，差集非空即 PROBLEM 并点名精确路径。
 */
function worktreeDirtyPaths (cwd) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[k];
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: cwd || ROOT, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`git status 取不到读数（rc=${r.status}）⇒ 副作用无从判定，不得当成"没有副作用"：${String(r.stderr).slice(0, 160)}`);
  const out = [];
  for (const line of String(r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    // porcelain 形状：`XY <path>`，重命名是 `R  old -> new` —— 取箭头右侧（工作树里真正被改动的那个名字）
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    out.push((arrow >= 0 ? rest.slice(arrow + 4) : rest).replace(/^"|"$/g, ''));
  }
  return out;
}


/**
 * 差集：跑后脏集 − 跑前脏集 − 靶子清单。唯一实现（A23 逐档测它）。
 * 三个入参都必须给：`before` 缺失会把"跑前就脏"的别人的在飞改动算成我的副作用；
 * `targets` 缺失会把还原失败的靶子重复报一遍（那是另一条断言的产物，不该混进来）。
 */
function sideEffectPaths (before, targets, after) {
  if (!(before instanceof Set)) throw new Error('sideEffectPaths：before 必须是 Set（缺它就等于把别人的在飞改动认领成本轮的副作用）');
  if (!Array.isArray(targets)) throw new Error('sideEffectPaths：targets 必须是数组');
  if (!Array.isArray(after)) throw new Error('sideEffectPaths：after 必须是数组（取不到读数不得当成空集，那由调用方的抛错分支负责）');
  return after.filter((p) => !before.has(p) && !targets.includes(p));
}

/**
 * 跑完之后的副作用体检（第 4 轮 i1/i6 的落点）。**必须是一个可以被单独调用的函数**：
 * 只把逻辑写在 `finally` 里，"返回恒空数组"这一格就永远测不到（本刀 n15 的同型教训 ——
 * 调用在位但结果被常数覆盖，源码形状锁看不见）。
 * 取不到读数（git 挂了）必须返回 PROBLEM 而不是 null —— 把失明读成"现场干净"是本仓点名的同型错误。
 */
function checkSideEffects (beforeSet, targets, cwd) {
  let after;
  try {
    after = worktreeDirtyPaths(cwd);
  } catch (e) {
    return { id: 'side-effects', state: 'PROBLEM', why: `副作用无从判定（git 取不到读数）：${e.message}` };
  }
  let fresh;
  try {
    fresh = sideEffectPaths(beforeSet, targets, after);
  } catch (e) {
    return { id: 'side-effects', state: 'PROBLEM', why: `副作用无从判定（差集入参坏了）：${e.message}` };
  }
  if (!fresh.length) return null;
  return {
    id: 'side-effects', state: 'PROBLEM',
    why: `变异在靶子之外留下了脏文件（驱动只还原靶子，这些还原不了）：${fresh.join(', ')}`
      + '\n  ⇒ 已知成因：n32 摘掉"不许 require 未守卫驱动"那道闸，那一轮真的跑起了 vendor 的评审流水线，'
      + '覆写了 .ccg/reviews/*.json 并写 .adversarial/。处置：`git checkout HEAD -- <上面逐个精确路径>`（禁宽目录），'
      + '然后重跑本轮；不要删掉这条断言来让它过。',
  };
}

function writeSidecar (orig) {
  const payload = { root: ROOT, writtenAt: new Date().toISOString(), files: orig };
  const tmp = SIDECAR + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, SIDECAR);
  const back = JSON.parse(fs.readFileSync(SIDECAR, 'utf8'));
  if (Object.keys(back.files).length !== Object.keys(orig).length) throw new Error('sidecar 写后回读文件数不符：' + SIDECAR);
  for (const f of Object.keys(orig)) if (back.files[f] !== orig[f]) throw new Error('sidecar 写后回读内容漂移：' + f);
  process.stdout.write('[mutation] 原始字节 sidecar=' + SIDECAR
    + '（异常终止后：node scripts/qm6-exit-capabilities.mutation.js --restore）\n');
}

function restoreFromSidecar () {
  if (!fs.existsSync(SIDECAR)) throw new Error('没有 sidecar：' + SIDECAR + '（说明本轮驱动还没开始改文件，或已被清理）');
  const back = JSON.parse(fs.readFileSync(SIDECAR, 'utf8'));
  if (back.root !== ROOT) throw new Error(`sidecar 的 root=${back.root} 与本次 ROOT=${ROOT} 不同源，拒绝跨仓还原`);
  const names = Object.keys(back.files || {});
  if (!names.length) throw new Error('sidecar 里没有任何文件记录，无从还原');
  for (const f of names) {
    if (read(f) !== back.files[f]) write(f, back.files[f]);
    if (read(f) !== back.files[f]) throw new Error('还原后回读仍不一致：' + f);
    process.stdout.write('[mutation] 已从 sidecar 还原 ' + f + '\n');
  }
  process.stdout.write('[mutation] 还原完成 writtenAt=' + back.writtenAt + ' files=' + names.length + '\n');
}

/**
 * CLI 解析单独成函数：A18 要**直接调它**而不是 spawn 本驱动 ——
 * spawn 出来的子进程若因某个变异而不再拒绝未知旗标，就会在父驱动正在改文件时**再开一轮变异扫描**，
 * 那两个进程会互相把对方的污染当成基线（本条不是假想：n24 试过，红在错误的地方）。
 */
const KNOWN_FLAGS = ['--restore', '--allow-dirty'];

function parseCli (argv) {
  const flags = (argv || []).filter((a) => a.startsWith('-'));
  // 未知旗标一律出声：本驱动改的是受 git 管理的源文件，"旗标被静默忽略"读起来就是"按预期跑了"。
  const unknown = flags.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknown.length) throw new Error(`未知旗标：${unknown.join(',')}（本驱动只认 ${KNOWN_FLAGS.join(' / ')}，其余参数是个别变异 id）`);
  const only = (argv || []).filter((a) => !a.startsWith('-'));
  if (flags.includes('--restore')) {
    if (only.length) throw new Error('--restore 必须单独使用（它不做变异，只做还原）');
    return { restore: true, only: [], allowDirty: false };
  }
  return { restore: false, only, allowDirty: flags.includes('--allow-dirty') };
}

function runAll (onlyArg, allowDirty) {
  const only = onlyArg || [];
  if (only.length) {
    const unknown = only.filter((id) => !M.some((m) => m.id === id));
    if (unknown.length) throw new Error(`未知变异 id：${unknown.join(',')}（参数不得被静默忽略）`);
  }
  const targets = [...new Set(M.map((m) => m.file))];
  // 运行态自证（放在拿锁与任何写动作之前，失败就直接退出，不留还原负担）：
  // 在沙箱 env 里跑一次探针本体，必须走"没有 vendor"那一档（rc=2 且点名失明）。
  // 这不是装饰 —— 沙箱失效时反证会拿真 vendor 陪跑，n32 那一类靶子就会在本机真的跑起评审流水线
  // （实测覆写过 `.ccg` 判定产物），而 MISSED/CAUGHT 集会随本机状态漂移。
  const probePath = path.join(ROOT, 'scripts/ccg-convergence-probe.js');
  const pv = spawnSync(process.execPath, [probePath], { cwd: ROOT, encoding: 'utf8', env: sandboxEnv() });
  if (pv.status !== 2 || !/探针失明/.test(String(pv.stderr || ''))) {
    process.stdout.write(`SANDBOX=FAIL rc=${pv.status} stderr=${String(pv.stderr).slice(0, 160)}\n`);
    return {
      results: [{
        id: 'sandbox', state: 'PROBLEM',
        why: 'vendor 沙箱失效：探针在沙箱 env 下必须 rc=2 且点名"探针失明"，反证不得拿本机 vendor 陪跑',
      }],
      attempted: 0,
    };
  }
  process.stdout.write(`[mutation] 反证运行态 vendor=sandbox(${vendorSandbox()}) —— 本机 vendor 不参与反证（design §1.4）\n`);
  acquireLock();
  try {
  if (allowDirty) {
    // 显式留痕的出口，不是把闸关掉：脏基线仍然打印出来，sidecar 也照写，异常终止时 `--restore` 仍能回到这一份。
    const dirty = targets.filter((f) => !gitCleanAgainstHead(f));
    process.stdout.write('[mutation] ⚠ --allow-dirty：以下靶子与 HEAD 不一致，本轮的"原始内容"就是这份未提交状态：'
      + (dirty.length ? dirty.join(', ') : '(无)') + '\n');
  } else {
    assertCleanBaseline(targets);
  }
  const orig = Object.fromEntries(targets.map((f) => [f, read(f)]));
  writeSidecar(orig);
  // 跑前拍一张"整棵工作树哪些文件是脏的"快照：靶子之外的新增脏文件就是变异的**外部副作用**
  // （n32 那一轮的现场就是 `.ccg/reviews/*.json` 被覆写）。还原动作只管靶子，所以这里必须另拍一张。
  const dirtyBefore = new Set(worktreeDirtyPaths());
  for (const m of M) {
    const from = expand(orig[m.file], m.from);
    const hits = orig[m.file].split(from).length - 1;
    if (hits !== 1) throw new Error(`${m.id} 在 ${m.file} 的锚点命中 ${hits} 次（要求恰为 1）`);
    if (m.to !== '' && orig[m.file].split(expand(orig[m.file], m.to)).length - 1 !== 0) throw new Error(`${m.id} 的目标文本在改前已存在于 ${m.file}`);
  }
  const namePool = read(LOCKS) + read(PROBET);
  for (const m of M) {
    for (const want of [...m.expect, ...(m.alsoExpect || [])]) {
      if (!namePool.includes(`'${want}`)) throw new Error(`${m.id} 要求 ${want} 必须红，但锁文件里没有这个用例名（探针指向不存在的东西）`);
    }
    for (const g of m.expectGreen || []) if (!SUITES.some((s) => s.file === g)) throw new Error(`${m.id} 要求 ${g} 保持绿，但它不在靶子套件清单里`);
  }

  const results = [];
  let attempted = 0;
  try {
    for (const m of M) {
      if (only.length && !only.includes(m.id)) continue;
      attempted++;
      const before = read(m.file);
      if (before !== orig[m.file]) { results.push({ id: m.id, state: 'PROBLEM', why: `开工前 ${m.file} 已被改过，拒绝在脏基线上做变异` }); break }
      write(m.file, before.split(expand(before, m.from)).join(expand(before, m.to)));
      const applied = read(m.file);
      if (m.to !== '' && applied === before) { results.push({ id: m.id, state: 'PROBLEM', why: '写后回读没有变化，替换未落地' }); restoreAll(orig); break }
      if (m.file.endsWith('.js')) {
        const c = spawnSync(process.execPath, ['--check', m.file], { cwd: ROOT, encoding: 'utf8' });
        if (c.status !== 0) { results.push({ id: m.id, state: 'PROBLEM', why: `变异把语法改坏了：${String(c.stderr).split('\n').slice(0, 2).join(' / ')}` }); restoreAll(orig); continue }
      }
      const runs = SUITES.map(suiteRun);
      restoreAll(orig);
      const bad = runs.find((x) => !x.ok);
      if (bad) { results.push({ id: m.id, state: 'PROBLEM', why: bad.why }); continue }
      const greenViolated = (m.expectGreen || []).filter((g) => runs.some((x) => x.suite === g && x.reds.length > 0));
      if (greenViolated.length) { results.push({ id: m.id, state: 'PROBLEM', why: `声明保持绿的套件红了：${greenViolated.join(',')}（驱动当场否证这条声明）` }); continue }
      const reds = runs.flatMap((x) => x.reds);
      const wantAll = [...m.expect, ...(m.alsoExpect || [])];
      const caught = m.expect.filter((e) => nameHit(reds, e));
      const also = wantAll.filter((e) => !m.expect.includes(e) && nameHit(reds, e));
      const unexpected = reds.filter((r) => !wantAll.some((e) => nameHit([r], e)));
      if (reds.length === 0) results.push({ id: m.id, state: ALLOWED_MISSED.has(m.id) ? 'MISSED(声明的重叠)' : 'MISSED', why: m.note, reds: [] });
      else if (caught.length !== m.expect.length || also.length !== wantAll.length - m.expect.length)
        results.push({ id: m.id, state: 'PROBLEM', why: `期望指名红缺席：缺 ${wantAll.filter((e) => !nameHit(reds, e)).join(',')}；实际红：${reds.join(' | ') || '(无)'}` });
      else results.push({ id: m.id, state: 'CAUGHT', why: m.note, reds, collected: runs.map((x) => `${path.basename(x.suite)}=${x.collected}`).join(' '), also: also.length ? also : undefined, unexpected: unexpected.length ? unexpected : undefined });
      const recheck = SUITES.map(suiteRun).filter((x) => !x.ok || x.reds.length > 0);
      if (recheck.length) { results.push({ id: `${m.id}-restore`, state: 'PROBLEM', why: `还原后被测锁仍红/未跑：${JSON.stringify(recheck.map((x) => x.why || x.reds))}` }); break }
    }
  } finally {
    restoreAll(orig);
    // 跑完（还原之后）再体检一次：靶子之外**新出现**的脏文件就是变体的外部副作用。
    // 不认领成设计、不放宽、也不"顺手替人还原"——判据只负责让它可见并拒绝 RESULT=OK。
    const se = checkSideEffects(dirtyBefore, targets);
    if (se) results.push(se);
  }
    return { results, attempted };
  } finally {
    // 锁在**外层** finally 释放：内层 finally 只保证文件还原，抛错路径上锁不能留在盘上，
    // 否则下一次运行会被一个已经不存在的进程挡住。
    releaseLock();
  }
}

if (require.main === module) {
  const cli = parseCli(process.argv.slice(2));
  if (cli.restore) {
    // 还原也要拿同一把锁：对着"另一个驱动正在改"的文件做还原，等于把那一轮的中间态写回基线。
    acquireLock();
    try { restoreFromSidecar() } finally { releaseLock() }
    process.exit(0);
  }
  const { results, attempted } = runAll(cli.only, cli.allowDirty);
  for (const r of results) {
    console.log(`${r.state.padEnd(18)} ${r.id} ${r.why}`);
    if (r.collected) console.log(`  收集：${r.collected}`);
    if (r.reds && r.reds.length) console.log(`  红：${r.reds.join(' | ')}`);
    if (r.also) console.log(`  同时红：${r.also.join(' | ')}`);
    if (r.unexpected) console.log(`  未预期但红：${r.unexpected.join(' | ')}`);
  }
  const ca = results.filter((x) => x.state === 'CAUGHT').length;
  const mi = results.filter((x) => x.state.startsWith('MISSED')).length;
  const pr = results.filter((x) => x.state === 'PROBLEM').length;
  // `side-effects` 不是"一条变异的结果"，是驱动对自身还原范围的体检 —— 与 `-restore` 同理不计进 TOTAL，
  // 但它必须以 PROBLEM 把 RESULT 打成 FAIL（"跑完了但盘上留着被改坏的评审产物"不得读成通过）。
  const total = results.filter((x) => !x.id.endsWith('-restore') && x.id !== 'side-effects').length;
  console.log(`SUMMARY CAUGHT=${ca} MISSED=${mi} PROBLEM=${pr} TOTAL=${total} ATTEMPTED=${attempted}`);
  const ok = pr === 0 && mi === ALLOWED_MISSED.size && total === attempted;
  console.log(ok ? 'RESULT=OK' : 'RESULT=FAIL');
  process.exit(ok ? 0 : 1);
}

module.exports = {
  vendorSandbox, sandboxEnv,
  M, SUITES, runAll, restoreFromSidecar, assertCleanBaseline, gitCleanAgainstHead, parseCli,
  acquireLock, releaseLock, SIDECAR, LOCK, worktreeDirtyPaths, sideEffectPaths, checkSideEffects,
};
