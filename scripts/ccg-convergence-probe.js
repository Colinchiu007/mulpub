'use strict';
/**
 * 深度审查「哪个出口在验证层真的可达」的探针。
 *
 * 动因（2026-10-17，#3724 §8 归因）：引擎的收敛判据有三个停止出口 ——
 *   ① 分数收敛（minScore >= scoreThreshold）
 *   ② stall（连续 stallRounds 轮无提升）
 *   ③ maxRounds（轮次耗尽）→ 第三档 self-play / escalated
 * 而 `ccg-deep-review.js` 的**验证层只跑一轮 critic**，并刻意把 `currentRound` 报成
 * `cfg.maxRounds`（它自己的注释写明：不这么报就会返回 `continue` 并被当成「无阻断」放行）。
 * 后果不是"少了个出口"，是**只剩一个出口**：②在单轮下永远不成立（`isStalled` 要求
 * `rounds.length >= stallRounds + 1`），①因为从不进入第 2 轮而无从抬分 ⇒ 每次深度审查必然
 * 落在 ③。于是「crypto 域条目在 ③ 里没有出口」（见 #3724 tasks §8.5/§8.8）不是边缘情况，
 * 而是主路径 —— 这是把这句话从形容词变成读数的东西。
 *
 * 判据取向：所有参数都**从 vendor 源码现读**（读不到即 rc=2），不在本文件里抄一份默认值 ——
 * 抄一份就是下一个"vendor 改了而这里恒绿"的漂移源。
 *
 * ⚠ 本篇结论的适用范围（2026-10-22 收窄，change: qm6-closure-writeback）：上面那段"只剩一个出口"
 *   量的是 `engine.convergenceDecision` 本身的形状，它**没变**，所以 ①-④ 照旧。变的是驱动在拿到
 *   那个返回值**之前**多了一道按严重度的出口（`verificationSeverityVerdict`，⑤ 读数）：无 Critical
 *   的评审不再必然滑向 self_play，而是写 `cleared`（`needs_revision` 只由决策层出——vendor 的严重度
 *   白名单里没有 `High`，见 P9 那条白名单断言）。所以"验证层必然落第三档"
 *   这句从今天起只对**含 Critical 的 diff** 成立 —— 引用它前先读 ⑤。
 *
 * 三档退出码（混档等于把"探针瞎了"读成"引擎变了"）：
 *   0 = 读数符合预期（③ 可达、② 在单轮下不可达、旧 bug 形态仍返回非终态、⑤ 严重度出口在位）
 *   1 = 读数偏离（vendor 行为变了 ⇒ 本文件与 tasks §8 的结论要重估；⑤ 补丁不在位也算这一档）
 *   2 = 探针自身取不到数（找不到引擎、读不出默认值、驱动 require 不动）
 *
 * 跑法：node scripts/ccg-convergence-probe.js
 */
const fs = require('fs');
const path = require('path');

const SAMPLE = path.join(__dirname, '..', 'openspec', 'changes', 'ccg-convergence-exit', 'artifacts', 'verification-layer-sample.json');

/**
 * 引擎与驱动都在 vendor 目录里。
 * ⛔ 候选面**只准**来自环境变量与用户技能目录，不得回落到 `__dirname`（QM-6 外部评审 i2 命中后收紧）：
 * 一旦把仓库自身列进候选，任何 PR 只要往 `scripts/` 放一份 `engine.js` + `ccg-deep-review.js`，
 * 本探针就会在 CI 里 `require()` 并**执行**那份由 PR 作者控制的代码 —— 探针的目的是测量上游引擎，
 * 仓库内那份同名文件本来就不是它的对象，留这个回落等于自己开一条代码执行面。
 */
/**
 * 许可根（**单一实现**）：locateVendor 的候选集与"探针能不能 require 这个文件"用的是同一张表。
 * 抄两份必然漂移，而这里的漂移等于"解析时认 A 根、加载时不查"——第 4 轮外部深审 i1 打的正是那一格。
 */
function vendorRoots () {
  const dirs = [];
  if (process.env.CCG_ARL_DIR) dirs.push(path.join(process.env.CCG_ARL_DIR, 'scripts'));
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) dirs.push(path.join(home, '.claude', 'skills', 'adversarial-review-loop', 'scripts'));
  return dirs;
}

function locateVendor () {
  const dirs = vendorRoots();
  for (const d of dirs) {
    const engine = path.join(d, 'engine.js');
    const driver = path.join(d, 'ccg-deep-review.js');
    if (fs.existsSync(engine) && fs.existsSync(driver)) return { engine, driver };
  }
  return null;
}

/**
 * 读 vendor 两份源码并合成判据用的单一字符串。
 * 必须与 readDefaults 的入参**同源**：`confidenceWeight` 与 `selfPlay: { enabled: ... }` 只写在
 * 驱动里，`maxRounds/threshold/stallRounds/stallScoreDelta` 只写在引擎里 —— 只读其中一份必然读不出
 * 一部分参数（本探针第一版就栽在测试只喂了 engine，于是 P2 恒 null）。
 * 导出给测试复用，这样"测试用的读法"不可能与"main 用的读法"漂移。
 */
function readVendorSources (vendor) {
  const read = (file, label) => {
    try { return fs.readFileSync(file, 'utf8'); } catch (e) {
      throw new Error('读不到 ' + label + '：' + e.message);
    }
  };
  const engineSrc = read(vendor.engine, 'engine.js');
  const driverSrc = read(vendor.driver, 'ccg-deep-review.js');
  return { engineSrc, driverSrc, combinedSrc: engineSrc + '\n' + driverSrc };
}

/** 从 vendor 源码里**现读**判据用的默认值（读不出一律 null，由调用方判故障，不得猜）。 */
function readDefaults (src) {
  const num = (re) => { const m = re.exec(src); return m ? Number(m[1]) : null };
  return {
    maxRounds: num(/var maxRounds = \(cfg && cfg\.maxRounds\) \|\| (\d+);/),
    scoreThreshold: num(/var threshold = \(cfg && cfg\.scoreThreshold\) \|\| ([\d.]+)/),
    stallRounds: num(/var n = \(cfg && cfg\.stallRounds\) \|\| (\d+);/),
    stallScoreDelta: num(/var delta = \(cfg && cfg\.stallScoreDelta\) \|\| ([\d.]+);/),
    selfPlayEnabled: /selfPlay: \{ enabled: (true|false)/.test(src)
      ? /selfPlay: \{ enabled: true/.test(src) : null,
    confidenceWeight: num(/confidenceWeight: ([\d.]+)/),
  };
}

/** 验证层实际组装的 task 形状：从驱动源码里现读，而不是照我的想象构造。 */
function readDriverTaskShape (src) {
  const cur = /const task = \{[\s\S]{0,400}?currentRound:\s*([A-Za-z0-9_.]+)/.exec(src);
  const rounds = /const task = \{[\s\S]{0,600}?rounds: \[\{[\s\S]{0,200}?round: 1,/.test(src);
  return { currentRoundExpr: cur ? cur[1] : null, singleRoundLiteral: rounds };
}

/**
 * ⑤ 验证层「按严重度出终态」这一档在不在位 —— **行为判据**：真 require 驱动、真调用那个函数，
 * 不是"源码里有没有那个名字"（AGENTS 取证口径：判据域跟着被测性质走）。
 *
 * 动因（2026-10-22，change: qm6-closure-writeback）：真跑一轮外部评审后实测 —— 验证层单轮跑完
 * 把结论交给 `convergenceDecision`，那个函数只认 `minScore >= scoreThreshold` ⇒ 出 `converged`，
 * 而本仓闭集是 {cleared, needs_revision, self_play_resolved}，**没有 `converged`**。后果：外部模型
 * 真跑完、一条 Critical 都没有，产物在仓内仍读成未闭合 ⇒ 高危面 `tier=external` 只能手写。
 * 主干产物里 `converged` 出现 **0 次**——现读数与所站提交一起写在 design §12.2，
 * 由 `node scripts/ccg-artifact-shape-survey.js --ref=origin/main` 现取；所以这一格以前没人撞上过。
 *
 * 三档语义不得混：
 *   capable=null  驱动 require 不动 ⇒ **探针失明**（调用方给 rc=2，不得读成"补丁不在"）
 *   capable=false 函数没导出或行为不符 ⇒ **漂移**（调用方计入 problems，rc=1）
 *   capable=true  三个形状全对（白名单产得出的那三种）
 */
/** 把路径按**任意分隔符**切成小写段再比：Windows 上 realpath 给 `\\`、Git Bash 递进来的可能是 `/`，
 *  混着比会把同一个目录判成两个（第 6 轮外部深审 i7）。归一后只做前缀包含，不做字符串猜想。 */
function pathSegmentsUnder (rootReal, targetReal) {
  const seg = (p) => String(p).replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean)
  const a = seg(rootReal); const b = seg(targetReal)
  if (a.length > b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return a.length < b.length
}

function readSeverityCapability (vendor) {
  // ⛔ require 之前先判"这个文件的**实际落点**还在不在许可根内"（第 4 轮外部深审 i1，Security 轴 Critical）。
  //   本探针的既有前提就是"要真调用 vendor 的函数"，所以它天然要执行仓外代码——信任边界不新；
  //   但"解析时按候选根找到 driver"与"加载前不再确认"之间确实有一格空档：
  //   许可根里放一枚符号链接/junction 指向别处，就能让探针去执行一张表之外的文件。
  //   realpath 把这格补上：解析结果必须仍在 vendorRoots() 之内，否则按**失明**档出声（rc=2），
  //   不得退化成"补丁不在"（1）——那会把"探针拒绝加载"读成"引擎没打补丁"。
  // 两张文件都要复核，不只 driver：locateVendor 用的是"同目录里 engine.js + 驱动都在"这个存在性判据，
  // 而本函数只 require 驱动 —— 第 5 轮外部深审 i6 指出 engine 不在判定范围内是真实的一半对的：
  // 探针确实不执行 engine.js，但 readVendorSources 会**读**它，两个落点都必须在许可根内。
  const roots = vendorRoots();
  let realDriver = null; let realEngine = null;
  try {
    realDriver = fs.realpathSync(vendor.driver);
    realEngine = fs.realpathSync(vendor.engine);
  } catch (e) {
    return { capable: null, blind: 'realpath 驱动/引擎失败（读不到实际落点，探针不加载也不读任何东西）：' + (e && e.message ? e.message : String(e)) };
  }
  let inside = false;
  for (const r of roots) {
    let realRoot;
    try { realRoot = fs.realpathSync(r); } catch (_) { continue }
    // 只留 startsWith 这一条：前半个等值式（"文件直接躺在根里"）是后者的子集，
    // 留着它等于给判据添一条永远不单独起作用的分支（第 5 轮外部深审 i7）。
    if (pathSegmentsUnder(realRoot, realDriver)) { inside = true; break }
  }
  let insideEngine = false;
  for (const r of roots) {
    let realRoot;
    try { realRoot = fs.realpathSync(r); } catch (_) { continue }
    if (pathSegmentsUnder(realRoot, realEngine)) { insideEngine = true; break }
  }
  if (!inside || !insideEngine) {
    return { capable: null, blind: 'vendor 驱动/引擎的实际路径不在许可根内 ⇒ 探针拒绝加载与读取：'
      + JSON.stringify({ driver: realDriver, engine: realEngine, insideDriver: inside, insideEngine: insideEngine })
      + '（许可根=' + JSON.stringify(roots) + '）' };
  }
  let mod;
  try {
    delete require.cache[require.resolve(vendor.driver)];
    mod = require(vendor.driver);
  } catch (e) {
    return { capable: null, blind: 'require 驱动失败：' + (e && e.message ? e.message : String(e)) };
  }
  const f = mod && mod.verificationSeverityVerdict;
  if (typeof f !== 'function') {
    return { capable: false, exports: mod ? Object.keys(mod).join(',') : '(require 返回空)',
      why: '驱动没导出 verificationSeverityVerdict ⇒ 验证层仍只会出 converged/self_play/escalated' };
  }
  // 只测**白名单产得出的**形状：vendor 的 SEVERITY_WHITELIST 只认 Critical/Warning/Info
  // （白名单外的 severity 会让那次评审当场失败），所以刻意不测 "High ⇒ needs_revision"——
  // 外部深审第 3 轮 i3 打的就是"给到不了的状态编规则"。白名单本身由
  // ccg-convergence-probe.test.js 钉住内容，一变即红，不由这里的分支去猜。
  const cases = {
    withCritical: f([{ severity: 'Critical' }, { severity: 'Warning' }]),
    warnOnly: f([{ severity: 'Warning' }, { severity: 'Info' }]),
    empty: f([]),
  };
  const shapeOk = cases.withCritical === null
    && cases.warnOnly === 'cleared'
    && cases.empty === 'cleared';
  return { capable: shapeOk, cases: cases, shapeOk: shapeOk,
    why: shapeOk ? '' : '三个形状里有一个不对（有 Critical 必须交回三档；无 Critical 必须 cleared）' };
}

function main (argv) {
  const json = (argv || []).includes('--json');
  const vendor = locateVendor();
  if (!vendor) {
    process.stderr.write('[ccg-probe] rc=2 找不到 vendor 引擎（CCG_ARL_DIR / ~/.claude/skills/adversarial-review-loop/scripts 都没命中）'
      + ' —— 这是**探针失明**，不得读成"引擎没有这个问题"\n');
    return 2;
  }
  let driverSrc, combinedSrc, engine;
  try {
    const sources = readVendorSources(vendor);
    driverSrc = sources.driverSrc;
    combinedSrc = sources.combinedSrc;
  } catch (e) {
    process.stderr.write('[ccg-probe] rc=2 ' + e.message + '\n'); return 2;
  }
  try { engine = require(vendor.engine); } catch (e) {
    process.stderr.write('[ccg-probe] rc=2 require 引擎失败：' + (e && e.message ? e.message : e) + '\n'); return 2;
  }
  if (typeof engine.convergenceDecision !== 'function' || typeof engine.isStalled !== 'function') {
    process.stderr.write('[ccg-probe] rc=2 引擎没导出 convergenceDecision/isStalled ⇒ 判据接口变了，本探针需同步\n');
    return 2;
  }
  const sevCap = readSeverityCapability(vendor);
  if (sevCap.capable === null) {
    process.stderr.write('[ccg-probe] rc=2 ' + sevCap.blind + ' ⇒ 这是**探针失明**，不得读成"补丁不在位"\n');
    return 2;
  }
  const cfgDefaults = readDefaults(combinedSrc);
  const missing = Object.keys(cfgDefaults).filter((k) => cfgDefaults[k] === null || cfgDefaults[k] === undefined);
  if (missing.length) {
    process.stderr.write('[ccg-probe] rc=2 从 vendor 源码读不出默认参数：' + missing.join(',')
      + ' ⇒ 大概率是上游改了写法。宁可不报，也不要拿猜来的数当结论。\n');
    return 2;
  }
  let sample;
  try { sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8')); } catch (e) {
    process.stderr.write('[ccg-probe] rc=2 读不到真存档夹具：' + e.message + '\n'); return 2;
  }

  const cfg = {
    maxRounds: cfgDefaults.maxRounds,
    scoreThreshold: cfgDefaults.scoreThreshold,
    stallRounds: cfgDefaults.stallRounds,
    stallScoreDelta: cfgDefaults.stallScoreDelta,
    selfPlay: { enabled: cfgDefaults.selfPlayEnabled, confidenceWeight: cfgDefaults.confidenceWeight },
  };
  const minScore = sample.critique.minScore;
  const round1 = { round: 1, minScore, critique: { issues: sample.critique.findings },
    processed: { accepted: [], rejected: [], rejectedWithEvidence: [], partiallyAccepted: [] } };
  const shape = readDriverTaskShape(driverSrc);

  // ① shipped：验证层的真实形状（单轮 + currentRound 被报成 maxRounds）
  const shipped = engine.convergenceDecision({ currentRound: cfg.maxRounds, rounds: [round1] }, cfg);
  // ② 旧 bug 形状：单轮且 currentRound=1 ⇒ 历史上返回 continue，被驱动当成「无阻断」放行
  const legacy = engine.convergenceDecision({ currentRound: 1, rounds: [round1] }, cfg);
  // ③ stall 出口在单轮下是否可能触发
  const stall1 = engine.isStalled([round1], cfg);
  // ④ 分数收敛出口需要什么样的读数才可达（用来把"要几轮"量出来，而不是喊口号）
  const needScore = cfg.scoreThreshold;
  const convergedIfHigh = engine.convergenceDecision(
    { currentRound: 2, rounds: [round1, Object.assign({}, round1, { round: 2, minScore: needScore })] }, cfg);

  const readings = {
    vendor: { engine: vendor.engine, driver: vendor.driver },
    cfgReadFromSource: cfgDefaults,
    driverTaskShape: shape,
    severityCapability: sevCap,
    sample: { file: path.relative(process.cwd(), SAMPLE), minScore, roundsObserved: sample.critique.roundsObserved,
      observedStatus: sample.critique.observedStatus, cryptoItems: sample.critique.requiresExternalReview.length },
    ladder: {
      shippedVerificationLayer: { status: shipped.status, reason: shipped.reason, stop: shipped.stop },
      legacyCurrentRoundOne: { status: legacy.status, reason: legacy.reason, stop: legacy.stop },
      stallWithOneRound: stall1,
      secondRoundAtThreshold: { status: convergedIfHigh.status, reason: convergedIfHigh.reason },
    },
  };
  // 预期：① self_play（唯一可达的第三档）② continue（非终态，正是被兜底救回来的那一格）
  //       ③ 未 stall ④ converged。任一不符 ⇒ 说明 vendor 的行为或形状变了 ⇒ rc=1。
  const problems = [];
  if (shipped.status !== 'self_play') problems.push('验证层不再走第三档（status=' + shipped.status + '）');
  if (legacy.stop !== false) problems.push('单轮 currentRound=1 不再是静默放行形状（stop=' + legacy.stop + '）');
  if (stall1.stalled !== false) problems.push('单轮竟然能判 stall');
  if (convergedIfHigh.status !== 'converged') problems.push('第 2 轮达阈值仍不收敛，scoreThreshold 语义变了');
  if (shape.currentRoundExpr !== 'cfg.maxRounds') problems.push('驱动不再把 currentRound 报成 cfg.maxRounds（本探针结论需重估）');
  // ⑤ 补丁不在位 ⇒ 验证层的"过"写的是 `converged`，本仓闭集不认 ⇒ 高危面外部收口机制上不可达。
  //     这不是"引擎坏了"，是**技能升级会把本机补丁静默带回旧形态**（2026-10-20 那条 patch 同款风险），
  //     所以它必须是 rc=1 的漂移读数，而不是文档里的一句提醒。
  if (sevCap.capable !== true) {
    problems.push('验证层没有"按严重度出终态"这一档（' + (sevCap.why || '原因未报') + '）'
      + ' ⇒ 外部评审真跑完也会写成 converged，本仓闭集不认 ⇒ 高危面 tier=external 只能手写；'
      + '先重打 vendor 补丁（见 design §11），不要放宽本仓闭集去迁就它');
  }

  // --json 档的 stdout **只能是 JSON**：任何一行结论/告警拼在后面都会让调用方 parse 失败，
  // 而失败信息（"Unexpected non-whitespace character"）读起来像"探针坏了"，不像"它多嘴了"
  // —— 本探针第一版即如此（P1 首跑红在此）。机器档把人读的行一律改道 stderr。
  if (json) {
    readings.problems = problems;
    readings.verdict = problems.length ? 'DRIFT' : 'AS_EXPECTED';
    process.stdout.write(JSON.stringify(readings, null, 2) + '\n');
    if (problems.length) {
      process.stderr.write('[ccg-probe] 🔴 读数偏离预期：\n  - ' + problems.join('\n  - ')
        + '\n  ⇒ 出口可达性已变：#3724 tasks §8.5/§8.8 与本 change design 的结论必须重测，不得沿用。\n');
    }
    return problems.length ? 1 : 0;
  }

  process.stdout.write('[ccg-probe] cfg 现读自 vendor: ' + JSON.stringify(cfgDefaults) + '\n');
  process.stdout.write('[ccg-probe] 驱动 task 形状: currentRound=' + shape.currentRoundExpr
    + ' 单轮字面=' + shape.singleRoundLiteral + '\n');
  process.stdout.write('[ccg-probe] 夹具（真存档）: ' + readings.sample.file + ' minScore=' + minScore
    + ' crypto 项=' + readings.sample.cryptoItems + '\n');
  process.stdout.write('[ccg-probe] ① 验证层真实形状 ⇒ status=' + shipped.status + ' reason=' + shipped.reason
    + ' stop=' + shipped.stop + '\n');
  process.stdout.write('[ccg-probe] ② 旧 bug 形状(currentRound=1) ⇒ status=' + legacy.status + ' reason=' + legacy.reason
    + ' stop=' + legacy.stop + (legacy.stop === true ? '' : '  ← 非终态：驱动若不当兜底处理就是静默放行\n'));
  process.stdout.write('[ccg-probe] ③ 单轮下 stall ⇒ stalled=' + stall1.stalled
    + (stall1.rounds ? '' : '（' + stall1.detail + '，所以 stall 出口在此层不可达）') + '\n');
  process.stdout.write('[ccg-probe] ④ 第 2 轮打到阈值 ' + needScore + ' 才 converged ⇒ status=' + convergedIfHigh.status + '\n');
  process.stdout.write('[ccg-probe] ⑤ 验证层按严重度出终态（真 require 驱动真调用）⇒ capable=' + sevCap.capable
    + ' 三形状=' + JSON.stringify(sevCap.cases || {}) + '\n');
  if (problems.length) {
    process.stdout.write('[ccg-probe] 🔴 读数偏离预期：\n  - ' + problems.join('\n  - ')
      + '\n  ⇒ 出口可达性已变：#3724 tasks §8.5/§8.8 与本 change design 的结论必须重估，不得沿用。\n');
    return 1;
  }
  process.stdout.write('[ccg-probe] 结论：验证层三档出口里 ②(stall) 在单轮下恒不成立、①(score) 要第 2 轮才可能够到，'
    + '所以**有 Critical 时**只有 ③(maxRounds→self-play) 可达；'
    + '③ 里的 crypto/高危域条目自 2026-10-20 补丁起可用 externalReview 三格解除（不再是无条件阻断）。'
    + 'capable=' + sevCap.capable + ' 时，无 Critical 的评审由严重度直接出 cleared'
    + '（本仓闭集认得的词），不再落到 converged 那一格；needs_revision 只由决策层出，'
    + '验证层拿不到——白名单里没有 High。\n');
  return 0;
}

module.exports = { main, readDefaults, readVendorSources, readDriverTaskShape, readSeverityCapability, locateVendor, vendorRoots, SAMPLE };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
