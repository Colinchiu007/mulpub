#!/usr/bin/env node
/**
 * check-debt-baseline-change.js — 「债务基线被调大」的机械锁
 *
 * 动因：`scripts/debt-baseline.json` 是 `check-debt-budget.js` 的上限账本，而 `--update` 是
 * 「重算即接受」。历史上出现过 5 次「为了让自己的 PR 不红而把数改大」的冲动，PR #4012 的记录里
 * 把这件事登记成了待办第 2 条，并点名可抄的先例是 `check-doc-abs-paths.js` 的 `judgeLedgerDrift`
 * （为容忍自己的新增而调大账本 ⇒ 当场判「账本被放宽」红）。
 *
 * 但 debt 基线与那本账不一样：**确实存在"如实记录主干现状"的正当场景** —— 主干上他人已合并的
 * 增长会让每个后续 PR 都撞同一堵墙，各自"重新归因"一次。所以正解不是禁掉调大，而是让调大
 * **必须留下机器可查的证据**。本判据因此要求四条，一条不缺：
 *
 *   R1 点名：每一条被调大的指标，本 PR 的执行记录里必须出现其键名（不许笼统说"调整了基线"）。
 *   R2 定性：记录必须含「接受漂移」字样 —— 把"记账"与"清理"这两个常被混为一谈的动作分开写。
 *   R3 指向：记录必须含「跟进」或「后续」—— 点名被推迟的那次真实清理，不接受"记完就忘"。
 *   R4 无余量：调大后的上限必须**等于当场实测**。这是本锁唯一有牙的一条：R1–R3 都是纸面痕迹，
 *      一句话就能写出来；而"上限 = 实测"把「顺手多留 500 行以防以后红」这条路堵死。
 *      （留余量不是保守，是把未来的增长提前免检 —— 本仓把它记作"装饰性门禁"的同型。）
 *
 * 另有 R5：`maxFilePath` 变了而 `maxFileLines` 没降 ⇒ 红。那是"换个短文件当最大值来绕开上涨"的
 * 形态（#4012 的记录明确写了它**没有**这样做，所以这条正当路径必须能被机械验证，不能只靠声明）。
 *
 * 退出码三档，绝不混用：
 *   0  合规 / 本 PR 未触及基线 / 非 PR 事件无 base（advisory 留痕）
 *   1  发现违规（含"未测量却调大"、记录缺失、形状被改）
 *   2  判据自身故障（git 取不到数、基线 JSON 读不到、实测取不到读数）—— 把工具的失明读成
 *      "没问题"是本仓反复踩过的坑，所以取证失败一律红在"我自己坏了"这一档。
 *
 * 用法：
 *   node scripts/check-debt-baseline-change.js [--base=<ref>] [--head=<ref>] [--head-branch=<name>]
 *     [--repo=<仓库根>] [--json]
 *   CI 侧 base/head 必须复用 classify step 的产物，不在这里再算一遍第二套取源。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASELINE_REL = 'scripts/debt-baseline.json';
const RECORD_DIR_REL = 'openspec/records';
const DRIFT_MARKER = '接受漂移';
const DEFERRAL_RE = /(跟进|后续)/;

// 与 check-debt-budget.js 同源：测量实现只有一份，本判据只消费它的读数，不自建第二份数行数逻辑。
const debtBudget = require('./check-debt-budget');

// 取证用的 git 环境。默认**原样继承** process.env —— 本机与 CI 跑的就是那台机器真实的 git 档。
// 只有显式给了 --git-config-global 时才换成一份中性夹具档：测试的"绿"不得依赖这台机器的
// core.autocrlf / safe.directory 之类配置（check-debt-budget.test.js 同口径）。
function buildGitEnv(globalCfg) {
  if (!globalCfg) return process.env;
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) {
    if (/^(GIT_CONFIG_(GLOBAL|SYSTEM|NOSYSTEM)|GIT_DIR|GIT_WORK_TREE)$/i.test(k)) delete env[k];
  }
  env.GIT_CONFIG_GLOBAL = globalCfg;
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
}

function git(repo, args, ctx) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: (ctx && ctx.env) || process.env,
  });
}

// `git cat-file -e` 成功时**什么都不打印**，判存在与否只能取 rc（本仓实测踩过：拿 stdout 判 ⇒ 恒走 else）。
// rc 语义：0 = 对象存在；1 = 该 rev 下没有这个路径（合法情形：本 PR 首次新建基线）；
// 128 = ref 本身解析不了（取证失败，必须与"没有这个文件"分开报）。
function blobExistsAt(repo, rev, rel, ctx) {
  try {
    git(repo, ['cat-file', '-e', `${rev}:${rel}`], ctx);
    return 'yes';
  } catch (e) {
    const rc = e && e.status;
    if (rc === 1) return 'no';
    if (rc === 128) return 'unreachable';
    return 'unreachable';
  }
}

function readBlobText(repo, rev, rel, ctx) {
  return git(repo, ['show', `${rev}:${rel}`], ctx);
}

function mergeBase(repo, base, head, ctx) {
  return String(git(repo, ['merge-base', base, head], ctx) || '').trim();
}

function changedFiles(repo, from, to, ctx) {
  const out = git(repo, ['diff', '--name-only', from, to], ctx);
  return String(out).split('\n').map((s) => s.trim()).filter(Boolean);
}

// 键的"是不是指标"由**值类型**判，不写死名单：数值键才是上限，字符串/数组键是元数据。
// 写死名单会漂 —— 下一个会话加一个数值键，如果忘了登记进名单，那条键就永久不受本锁管。
function isMetric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function diffMetrics(baseObj, headObj) {
  const increased = [];
  const decreased = [];
  const unchanged = [];
  for (const key of Object.keys(headObj)) {
    const hv = headObj[key];
    if (!isMetric(hv)) continue;
    const bv = baseObj ? baseObj[key] : undefined;
    if (bv === undefined || !isMetric(bv)) {
      // 基线里凭空多出一个数值键：按"从 0 调大"处理（fail closed，不当成看不见）。
      increased.push({ key, from: null, to: hv });
      continue;
    }
    if (hv > bv) increased.push({ key, from: bv, to: hv });
    else if (hv < bv) decreased.push({ key, from: bv, to: hv });
    else unchanged.push({ key, value: hv });
  }
  return { increased, decreased, unchanged };
}

function shapeChanged(baseObj, headObj) {
  if (!baseObj) return false;
  const a = Object.keys(baseObj).sort();
  const b = Object.keys(headObj).sort();
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
    if (typeof baseObj[a[i]] !== typeof headObj[b[i]]) return true;
  }
  return false;
}

/** R1–R3：记录面的三条纸面要求。纯函数，便于逐条变异反证。 */
function judgeRecord(increasedKeys, recordText) {
  const violations = [];
  if (!recordText) {
    violations.push({
      code: 'RECORD_MISSING',
      detail: `调大了 ${increasedKeys.length} 条指标却找不到本 PR 的执行记录（${RECORD_DIR_REL}/<分支名>.md，且改动集里也没有新增的记录文件）`,
    });
    return violations;
  }
  const normalized = String(recordText).replace(/\r/g, '');
  for (const key of increasedKeys) {
    if (!normalized.includes(key)) {
      violations.push({
        code: 'RECORD_MUST_NAME_METRIC',
        detail: `记录没有点名被调大的指标「${key}」—— 笼统一句"调整了基线"不构成证据`,
      });
    }
  }
  if (!normalized.includes(DRIFT_MARKER)) {
    violations.push({
      code: 'DRIFT_ACK_MISSING',
      detail: `记录必须含「${DRIFT_MARKER}」：本次改的是记账还是清理，必须是写出来的判断而不是读者的猜测`,
    });
  }
  if (!DEFERRAL_RE.test(normalized)) {
    violations.push({
      code: 'DEFERRAL_MISSING',
      detail: '记录必须含「跟进」或「后续」并点名被推迟的那次真实清理（哪个文件、判据是什么），不接受记完就忘',
    });
  }
  return violations;
}

/**
 * R4：上限必须等于实测。纯函数，两个方向都要判：
 *   to > measured ⇒ 白留余量（本锁要拦的形态）
 *   to < measured ⇒ 上限压不到现实（check-debt-budget 也会红，这里同步点名，免得红在一个不相干的下游）
 */
function judgeAgainstReality(increased, measured) {
  const violations = [];
  const tight = [];
  for (const item of increased) {
    const m = measured ? measured[item.key] : undefined;
    if (m === undefined || !Number.isFinite(m)) {
      violations.push({
        code: 'MEASURE_UNAVAILABLE',
        detail: `取不到「${item.key}」的实测读数，无法证明上限没有多留余量（按未证实处理，不得当成通过）`,
      });
      continue;
    }
    if (item.to > m) {
      violations.push({
        code: `SLACK:${item.key}`,
        detail: `${item.key} 的上限被抬到 ${item.to}，而当场实测是 ${m}：多出的 ${item.to - m} 是白留的余量。调大只能调到实测值，未来的增长由未来的 PR 重新记账`,
      });
    } else if (item.to < m) {
      violations.push({
        code: `UNDER_REALITY:${item.key}`,
        detail: `${item.key} 的上限 ${item.to} 低于当场实测 ${m}：先按当场实测重算再来`,
      });
    } else {
      tight.push(item.key);
    }
  }
  return { violations, tight };
}

/** R5：换最大值文件绕开上涨。 */
function judgePathSwap(baseObj, headObj) {
  if (!baseObj) return [];
  const b = baseObj.maxFilePath;
  const h = headObj.maxFilePath;
  if (typeof b !== 'string' || typeof h !== 'string') return [];
  if (b === h) return [];
  const grew = typeof baseObj.maxFileLines === 'number' && typeof headObj.maxFileLines === 'number'
    && headObj.maxFileLines >= baseObj.maxFileLines;
  if (!grew) return [];
  return [{
    code: 'PATH_SWAPPED_WITHOUT_DROP',
    detail: `maxFilePath 从 ${b} 换成了 ${h}，而 maxFileLines 没有下降（${baseObj.maxFileLines}→${headObj.maxFileLines}）：这是"换个短文件当最大值"的形态，不是清理`,
  }];
}

function resolveRecordRel(repo, head, headBranch, changed, ctx) {
  if (headBranch) {
    const rel = `${RECORD_DIR_REL}/${headBranch}.md`;
    if (blobExistsAt(repo, head, rel, ctx) === 'yes') return { rel, source: 'branch' };
  }
  // 回退：detached HEAD 下分支名取不到，就认本 PR 自己新增的那篇记录。
  const added = (changed || []).filter((f) => f.startsWith(`${RECORD_DIR_REL}/`) && f.endsWith('.md'));
  if (added.length > 0) return { rel: added[0], source: 'changeset' };
  return { rel: null, source: 'none' };
}

function parseArgs(argv) {
  const opts = {
    base: process.env.DEBT_BASE || 'origin/main',
    head: 'HEAD',
    headBranch: process.env.DEBT_HEAD_BRANCH || '',
    repo: process.cwd(),
    json: false,
    noBase: false,
    gitConfigGlobal: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a.startsWith('--base=')) opts.base = a.slice(7);
    else if (a === '--base') opts.base = argv[++i];
    else if (a.startsWith('--head-branch=')) opts.headBranch = a.slice(14);
    else if (a.startsWith('--head=')) opts.head = a.slice(7);
    else if (a === '--head') opts.head = argv[++i];
    else if (a.startsWith('--repo=')) opts.repo = a.slice(7);
    else if (a.startsWith('--git-config-global=')) opts.gitConfigGlobal = a.slice(20);
    else {
      // 未知旗标与非法取值一律出声走"自身故障"档：静默忽略参数会把一次 smoke 放大成整域判定，
      // 也会把拼错的旗标读成"判据什么都没发现"。
      throw new UsageError(`未知旗标：${a}`);
    }
  }
  if (!opts.base) opts.noBase = true;
  return opts;
}

class UsageError extends Error {}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv || process.argv.slice(2));
  } catch (e) {
    console.error(`[debt-baseline-change] SELF_FAILURE ${e.message}`);
    return 2;
  }

  if (opts.noBase) {
    console.log('[debt-baseline-change] NO_BASE advisory（非 PR 事件或取源为空，本锁只作用于 PR）exit=0');
    return 0;
  }

  const ctx = { env: buildGitEnv(opts.gitConfigGlobal) };

  let mb;
  try {
    mb = mergeBase(opts.repo, opts.base, opts.head, ctx);
  } catch (e) {
    console.error(`[debt-baseline-change] SELF_FAILURE merge-base(${opts.base}..${opts.head}) 取不到：${e.message}`);
    return 2;
  }
  if (!mb) {
    console.error(`[debt-baseline-change] SELF_FAILURE merge-base 为空`);
    return 2;
  }

  let changed;
  try {
    changed = changedFiles(opts.repo, mb, opts.head, ctx);
  } catch (e) {
    console.error(`[debt-baseline-change] SELF_FAILURE diff 取证失败：${e.message}`);
    return 2;
  }

  if (!changed.includes(BASELINE_REL)) {
    console.log(`[debt-baseline-change] NOT_TOUCHED files=${changed.length} exit=0`);
    return 0;
  }

  let headObj;
  let baseObj = null;
  try {
    headObj = JSON.parse(readBlobText(opts.repo, opts.head, BASELINE_REL, ctx));
  } catch (e) {
    console.error(`[debt-baseline-change] SELF_FAILURE 读不到 head 侧 ${BASELINE_REL}：${e.message}`);
    return 2;
  }
  const presence = blobExistsAt(opts.repo, mb, BASELINE_REL, ctx);
  if (presence === 'unreachable') {
    console.error(`[debt-baseline-change] SELF_FAILURE ${opts.base} 不可解析，无法比较基线`);
    return 2;
  }
  if (presence === 'yes') {
    try {
      baseObj = JSON.parse(readBlobText(opts.repo, mb, BASELINE_REL, ctx));
    } catch (e) {
      console.error(`[debt-baseline-change] SELF_FAILURE 读不到 base 侧 ${BASELINE_REL}：${e.message}`);
      return 2;
    }
  }

  const violations = [];
  const notes = [];

  if (shapeChanged(baseObj, headObj)) {
    notes.push('SHAPE_CHANGED（基线键集与 base 侧不一致，数值键按类型现场判定；本仓另有 check-debt-budget.test.js 的键集逐字锁）');
  }

  const { increased, decreased } = diffMetrics(baseObj, headObj);
  if (presence === 'no') notes.push('BASE_ABSENT：base 侧没有基线文件，全部数值键按"从 0 调大"处理');

  if (increased.length === 0 && decreased.length === 0) {
    console.log(`[debt-baseline-change] 触及=true 调大=0 调小=0 违规=0 PASS（只改了元数据/口径未变）`);
    return 0;
  }

  const record = resolveRecordRel(opts.repo, opts.head, opts.headBranch, changed, ctx);
  let recordText = null;
  if (record.rel) {
    try {
      recordText = readBlobText(opts.repo, opts.head, record.rel, ctx);
    } catch (e) {
      recordText = null;
    }
  }

  if (increased.length > 0) {
    violations.push(...judgeRecord(increased.map((i) => i.key), recordText));
    let measured = null;
    try {
      measured = debtBudget.collectMetrics(opts.repo, { env: ctx.env });
    } catch (e) {
      violations.push({
        code: 'MEASURE_UNAVAILABLE',
        detail: `collectMetrics 取不到读数（无法验证上限等于实测）：${e && e.message ? e.message : e}`,
      });
    }
    const r4 = judgeAgainstReality(increased, measured);
    violations.push(...r4.violations);
    notes.push(`实测一致=${r4.tight.length}/${increased.length}`);
  }
  violations.push(...judgePathSwap(baseObj || {}, headObj));

  const readout = `[debt-baseline-change] 触及=true 调大=${increased.length} 调小=${decreased.length} `
    + `记录=${record.rel || '<缺失>'}(${record.source}) 违规=${violations.length} ${violations.length ? 'FAIL' : 'PASS'}`;
  if (opts.json) {
    console.log(JSON.stringify({ increased, decreased, recordRel: record.rel, recordSource: record.source, violations, notes }, null, 2));
  } else {
    for (const v of violations) console.log(`  ✗ ${v.code}: ${v.detail}`);
    for (const n of notes) console.log(`  · ${n}`);
    console.log(readout);
  }
  return violations.length > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  main, diffMetrics, shapeChanged, judgeRecord, judgeAgainstReality, judgePathSwap,
  resolveRecordRel, blobExistsAt, changedFiles, mergeBase, readBlobText,
  BASELINE_REL, RECORD_DIR_REL, DRIFT_MARKER, isMetric,
};
