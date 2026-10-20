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
 * 三档退出码（混档等于把"探针瞎了"读成"引擎变了"）：
 *   0 = 读数符合预期（③ 可达、② 在单轮下不可达、旧 bug 形态仍返回非终态）
 *   1 = 读数偏离（vendor 行为变了 ⇒ 本文件与 tasks §8 的结论要重估）
 *   2 = 探针自身取不到数（找不到引擎、正则读不出默认值）
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
function locateVendor () {
  const dirs = [];
  if (process.env.CCG_ARL_DIR) dirs.push(path.join(process.env.CCG_ARL_DIR, 'scripts'));
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) dirs.push(path.join(home, '.claude', 'skills', 'adversarial-review-loop', 'scripts'));
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
 * vendor 是否能表达「外部复核已发生」（现读驱动源码，不靠记忆写死结论）。
 * 两条同时成立才算在位：解除阻断的谓词被**定义**（注释里提一句不算）+ 驱动把期望后端写进裁决模板。
 * 缺任一格 ⇒ 沿用旧结论「高危域在 self-play 内无出口」；在位 ⇒ 结论必须改成「填三格后可闭合」。
 */
function externalReviewCapable (driverSrc) {
  if (typeof driverSrc !== 'string' || driverSrc === '') return false;
  const hasPredicate = /^[ \t]*function[ \t]+externalReviewSatisfied[ \t]*\(/m.test(driverSrc);
  const hasExpected = /expectedExternalBackend[ \t]*:/.test(driverSrc);
  return hasPredicate && hasExpected;
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
    externalReviewCapable: externalReviewCapable(driverSrc),
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
  if (problems.length) {
    process.stdout.write('[ccg-probe] 🔴 读数偏离预期：\n  - ' + problems.join('\n  - ')
      + '\n  ⇒ 出口可达性已变：#3724 tasks §8.5/§8.8 与本 change design 的结论必须重估，不得沿用。\n');
    return 1;
  }
  if (externalReviewCapable(driverSrc)) {
    process.stdout.write('[ccg-probe] 结论：验证层三个停止出口里只有 ③(maxRounds→self-play) 可达；'
      + '且 vendor **已能表达外部复核**（externalReviewSatisfied + expectedExternalBackend 在位）'
      + '⇒ 高危域项填齐三格后可闭合为 self_play_resolved，不再是永久不可达。'
      + '（旧结论「含 crypto 发现的 diff 上闭环不可达」自此次表达起失效，不得再沿用。）\n');
    return 0;
  }
  process.stdout.write('[ccg-probe] 结论：验证层三个停止出口里只有 ③(maxRounds→self-play) 可达；'
    + '而 self-play 对 crypto 项无条件计阻断 ⇒ 「深度审查闭环」在含 crypto 发现的 diff 上不可达（除非真跑多轮把分数抬到 '
    + cfgDefaults.scoreThreshold + ' 以上）。\n');
  return 0;
}

module.exports = { externalReviewCapable, main, readDefaults, readVendorSources, readDriverTaskShape, locateVendor, SAMPLE };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
