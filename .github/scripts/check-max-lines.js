#!/usr/bin/env node
/**
 * check-max-lines.js — 逐文件行数门禁（审计 P2·超大文件「新代码阻断、存量挂账」）
 *
 * 为什么已有 scripts/check-debt-budget.js 还要再加一个：
 * debt-budget 做的是**全仓聚合**棘轮（最大行数 / >=1000 行数 / >=500 行数），
 * 拆掉一个大文件同时新写一个大文件即可互相抵消而无人报警；且 eslint 的 max-lines
 * 规则在本仓只对 apps/desktop 生效，Python 侧（model_preset_service.py、
 * prompt_eval_service.py 均 1000+ 行）完全不在任何行数门禁覆盖内。
 * 本门禁做**逐文件**判定，口径（SCAN_DIRS / SOURCE_EXTS / EXCLUDE）与 debt-budget 一致。
 *
 * 四条硬规则：
 *   1. NEW_OVER_LIMIT —— 超过 limit 且未被有效挂账的源文件 → 阻断（新代码必须拆分）
 *   2. STALE_LEDGER_ENTRY —— 清单里的文件已不在受管扫描范围内（真删/改名/移出）→ 阻断
 *   3. DEBT_REPAID_LEDGER —— 清单里的文件仍在、但已降到 limit 以下（债已还）→ 阻断
 *      与 2 的区别决定处方：2 是账目腐烂，3 是债还完没销账；两者都用 --prune 单键清账。
 *      （历史事故：旧实现把 3 误报成 2 并统一建议 --update，而 --update 是整份重写，
 *       会顺手把别人十几个文件的存量漂移重新登记成新基线 —— 等于第二次开门。）
 *   4. LEDGER_GREW —— 存量文件较登记值增长超过 growthAllowance → 阻断
 *      （大文件允许小幅维护改动，不允许继续膨胀成新债）
 *
 * 墓碑（pruned）：已还清的路径在此留痕，作用有二：
 *   · 取消挂账豁免 —— 该路径重新超限时按 NEW_OVER_LIMIT 阻断，僵尸条目不得当免死金牌；
 *   · 容忍并发复活 —— 别的分支把已删条目改回 files 时只出⚠️提示不阻断，
 *     避免「一人还债、全链被无关红卡死」（audit 2026-09-22 实测因此逃逸 3 次）。
 *
 * 用法：
 *   node .github/scripts/check-max-lines.js                       # 检查（CI）
 *   node .github/scripts/check-max-lines.js --prune <相对路径>     # 单键清账并立碑（还债后的正确动作）
 *   node .github/scripts/check-max-lines.js --update              # 增量登记新超限文件（不动已有值、不删键）
 *   node .github/scripts/check-max-lines.js --update --rewrite    # 全量重生（会重排键、需人工审 diff）
 *   node .github/scripts/check-max-lines.js --json                # JSON 输出
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'max-lines-baseline.json');
// 与 scripts/check-debt-budget.js 保持同一扫描口径（用例里有字面量比对防漂移）
const SCAN_DIRS = ['apps/desktop/src', 'apps/desktop/electron', 'packages', 'ops-center/backend'];
const SOURCE_EXTS = ['.js', '.ts', '.vue', '.py', '.tsx', '.jsx', '.css', '.scss'];
const EXCLUDE = ['node_modules', 'dist', '.git', 'tests', 'test', '__tests__', 'dist-electron'];
const DEFAULT_LIMIT = 500;
const DEFAULT_GROWTH_ALLOWANCE = 200;

function walkDir(absDir, baseDir, out) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const fp = path.join(absDir, e.name);
    const rel = path.relative(baseDir, fp).replace(/\\/g, '/');
    if (EXCLUDE.some((x) => rel.includes(x))) continue;
    if (e.isDirectory()) { walkDir(fp, baseDir, out); continue; }
    if (!SOURCE_EXTS.includes(path.extname(e.name))) continue;
    let lines = 0;
    try { lines = fs.readFileSync(fp, 'utf8').split('\n').length; } catch (_) { continue; }
    out.push({ path: rel, lines });
  }
  return out;
}

const hasKey = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

/** 扫描全部受管源文件，返回相对扫描根的路径 → 行数 */
function scanAllLines(rootDir) {
  const out = {};
  for (const f of scanFiles(rootDir)) out[f.path] = f.lines;
  return out;
}

/** 扫描全部受管源文件 → [{path, lines}]（内部原语，两个对外视图都基于它） */
function scanFiles(rootDir) {
  const root = rootDir || ROOT;
  const out = [];
  for (const d of SCAN_DIRS) walkDir(path.join(root, d), root, out);
  return out;
}

/** 扫描结果 → 超限文件映射（键为相对扫描根的路径，与挂账清单同一坐标系） */
function collectOverLimit(rootDir, limit) {
  const max = limit || DEFAULT_LIMIT;
  const files = {};
  for (const f of scanFiles(rootDir)) {
    if (f.lines >= max) files[f.path] = f.lines;
  }
  return files;
}

function readBaseline(p) {
  const file = p || BASELINE_PATH;
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** 清单落盘：键按字典序排序，保证可复现（diff 只反映真实债务变化）；pruned 必须原样携带 */
function writeBaseline(files, meta, p) {
  const file = p || BASELINE_PATH;
  const body = {
    '//': '超大文件挂账清单（audit-batch-4）。limit 之上的存量文件在此登记；新文件超限一律阻断。'
      + '还完债用 --prune <路径> 单键清账（会同时在 pruned 立碑）；'
      + '--update 仅做增量登记，--update --rewrite 才全量重生（会掩盖别人的漂移，需人工审 diff）。',
    limit: meta && meta.limit ? meta.limit : DEFAULT_LIMIT,
    growthAllowance: meta && meta.growthAllowance ? meta.growthAllowance : DEFAULT_GROWTH_ALLOWANCE,
    files: Object.keys(files).sort().reduce((acc, k) => { acc[k] = files[k]; return acc; }, {}),
    pruned: Object.keys((meta && meta.pruned) || {}).sort().reduce((acc, k) => { acc[k] = meta.pruned[k]; return acc; }, {}),
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return body;
}

/**
 * 核心判定（纯函数，便于用例注入假清单/假扫描结果）。
 * @param existing 全部受管文件的 路径→行数；用于区分「文件真没了」与「债已还」。
 *                 缺省后退化为 scanned（仅包含超限文件，因此只能报出「不在扫描结果」类违规）。
 * @returns {{violations: string[], notices: string[], results: object}}
 */
function evaluate(baseline, scanned, existing) {
  const limit = baseline && Number.isFinite(baseline.limit) ? baseline.limit : DEFAULT_LIMIT;
  const allowance = baseline && Number.isFinite(baseline.growthAllowance)
    ? baseline.growthAllowance : DEFAULT_GROWTH_ALLOWANCE;
  const ledger = (baseline && baseline.files) || {};
  const pruned = (baseline && baseline.pruned) || {};
  const all = existing && typeof existing === 'object' ? existing : scanned;
  const violations = [];
  const notices = [];

  for (const rel of Object.keys(scanned).sort()) {
    const lines = scanned[rel];
    // 墓碑优先：同一路径一旦发过墓碑，登记值立即失效——它不得再充当免死金牌，
    // 重新超限按「新增债务」阻断（历史事故：僵尸条目被并发 PR 带回后，该文件可按容差静默涨回登记值）。
    if (hasKey(ledger, rel) && !hasKey(pruned, rel)) {
      const grown = lines - ledger[rel];
      if (grown > allowance) {
        violations.push('LEDGER_GREW: ' + rel + ' 较登记值 ' + ledger[rel] + ' 膨胀 ' + grown + ' 行（容差 ' + allowance + '），请拆分或经审阅后 --update');
      }
      continue;
    }
    if (lines >= limit) {
      violations.push('NEW_OVER_LIMIT: ' + rel + ' ' + lines + ' 行 >= ' + limit
        + '，新代码不得引入超大文件（按既有 mixin/composable 范式拆分）'
        + (hasKey(pruned, rel) ? '；该路径曾还清债务（墓碑 ' + pruned[rel] + ' 行），此次属重新欠债，不得重新挂账' : ''));
    }
  }

  for (const rel of Object.keys(ledger).sort()) {
    if (!hasKey(all, rel)) {
      violations.push('STALE_LEDGER_ENTRY: ' + rel + ' 已不在受管扫描范围内（文件已删/改名/移出受管目录），请 --prune ' + rel + ' 单键清账');
      continue;
    }
    if (all[rel] < limit) {
      if (hasKey(pruned, rel)) {
        // 已知复活：别的分支在还债 PR 之前切出，合并时把条目带了回来。不阻断链条，只留痕。
        notices.push('LEDGER_RESURRECTED: ' + rel + ' 挂账条目被并发改回，但墓碑表明债务已还清（现 '
          + all[rel] + ' 行 < ' + limit + '）——不阻断，下次触碰该清单时请 --prune ' + rel);
        continue;
      }
      violations.push('DEBT_REPAID_LEDGER: ' + rel + ' 债务已还（现 ' + all[rel] + ' 行 < ' + limit
        + '），请 --prune ' + rel + ' 单键清账；不要用 --update（整份重生成会连带把别人的存量漂移登记成新基线）');
    }
  }

  return {
    violations,
    notices,
    results: {
      overLimitCount: Object.keys(scanned).length,
      ledgerCount: Object.keys(ledger).length,
      prunedCount: Object.keys(pruned).length,
      limit,
      allowance,
    },
  };
}

/**
 * --update 的纯计算部分：默认只做增量登记。
 * 不抬高已有登记值（存量膨胀交给 LEDGER_GREW 判定，而不是悄悄改基线）、
 * 不删任何键（清账走 --prune，逐键、可审）、不覆盖 pruned。
 */
function computeUpdate(base, scanned) {
  const limit = base && Number.isFinite(base.limit) ? base.limit : DEFAULT_LIMIT;
  const old = (base && base.files) || {};
  const files = Object.keys(old).reduce((acc, k) => { acc[k] = old[k]; return acc; }, {});
  const pruned = Object.keys(((base && base.pruned) || {})).reduce((acc, k) => { acc[k] = base.pruned[k]; return acc; }, {});
  const changes = { added: [], blockedRaise: [], blockedRemove: [], skippedTombstone: [] };

  for (const rel of Object.keys(scanned).sort()) {
    if (hasKey(files, rel)) {
      if (scanned[rel] !== files[rel]) {
        changes.blockedRaise.push({ path: rel, registered: files[rel], current: scanned[rel] });
      }
      continue;
    }
    if (hasKey(pruned, rel)) { changes.skippedTombstone.push(rel); continue; }
    files[rel] = scanned[rel];
    changes.added.push(rel);
  }
  for (const rel of Object.keys(old).sort()) {
    if (!hasKey(scanned, rel)) changes.blockedRemove.push(rel);
  }

  const body = {
    '//': (base && base['//']) || '',
    limit,
    growthAllowance: base && Number.isFinite(base.growthAllowance) ? base.growthAllowance : DEFAULT_GROWTH_ALLOWANCE,
    files,
    pruned,
  };
  return { body, changes };
}

/**
 * --prune 的单键手术：只删目标键 + 在 pruned 立碑，其余键与顺序原样保留。
 * 拒绝为仍超限的文件立碑（否则等于自己给自己发免死金牌）。
 */
function pruneBaseline(rel, opts) {
  const o = opts || {};
  const file = o.baselinePath || BASELINE_PATH;
  const base = readBaseline(file);
  const ledger = (base && base.files) || {};
  if (!base || !hasKey(ledger, rel)) {
    return { error: '挂账清单里没有 ' + rel + '，无需清账（若该文件从未挂账，直接拆分即可）' };
  }
  const limit = Number.isFinite(base.limit) ? base.limit : DEFAULT_LIMIT;
  const known = o.lines && typeof o.lines === 'object';
  const cur = known && hasKey(o.lines, rel) ? o.lines[rel] : null;
  if (cur !== null && cur >= limit) {
    return { error: rel + ' 仍超限（现 ' + cur + ' 行 >= ' + limit + '），债务未还，不得发墓碑；请先拆分' };
  }
  const after = {};
  for (const k of Object.keys(base)) after[k] = base[k];
  after.files = Object.keys(ledger).reduce((acc, k) => { if (k !== rel) acc[k] = ledger[k]; return acc; }, {});
  after.pruned = Object.keys((base.pruned || {})).reduce((acc, k) => { acc[k] = base.pruned[k]; return acc; }, {});
  after.pruned[rel] = cur === null ? ledger[rel] : cur;
  fs.writeFileSync(file, JSON.stringify(after, null, 2) + '\n', 'utf8');
  return { changed: [rel], tombstoneAt: after.pruned[rel], baseline: after, file };
}

function main() {
  const args = process.argv.slice(2);
  const isUpdate = args.includes('--update');
  const isRewrite = args.includes('--rewrite');
  const isJson = args.includes('--json');
  const baselinePath = args.includes('--baseline') ? args[args.indexOf('--baseline') + 1] : null;
  const rootDir = args.includes('--root') ? args[args.indexOf('--root') + 1] : null;
  const pruneIdx = args.indexOf('--prune');
  const bp = baselinePath || BASELINE_PATH;

  const base = readBaseline(bp);
  const limit = base && Number.isFinite(base.limit) ? base.limit : DEFAULT_LIMIT;
  const all = scanAllLines(rootDir);
  const scanned = Object.keys(all).sort().reduce((acc, k) => { if (all[k] >= limit) acc[k] = all[k]; return acc; }, {});

  if (pruneIdx >= 0) {
    const rel = args[pruneIdx + 1];
    if (!rel || rel.startsWith('--')) {
      console.log('用法：node .github/scripts/check-max-lines.js --prune <仓内相对路径>');
      process.exit(2);
    }
    const out = pruneBaseline(rel, { baselinePath: bp, lines: all });
    if (out.error) { console.log('❌ ' + out.error); process.exit(2); }
    console.log('✅ 已单键清账：' + rel + ' → 从 files 移除，在 pruned 立碑（' + out.tombstoneAt + ' 行）');
    console.log('   仅改动该一处；其余挂账与顺序未动。');
    process.exit(0);
  }

  if (isUpdate) {
    if (!base) {
      console.log('未找到挂账清单，正在生成初始基线：', bp);
      writeBaseline(scanned, { limit: DEFAULT_LIMIT }, bp);
      process.exit(0);
    }
    if (isRewrite) {
      const body = writeBaseline(scanned, Object.assign({}, base, { pruned: base.pruned }), bp);
      console.log('挂账清单已全量重生：', bp, '（' + Object.keys(body.files).length + ' 个超限文件）');
      console.log('⚠️ --rewrite 会重排键并抬高/删除登记值，掩盖别人的存量漂移，必须人工逐行审 diff。');
      process.exit(0);
    }
    const { body, changes } = computeUpdate(base, scanned);
    fs.writeFileSync(bp, JSON.stringify(body, null, 2) + '\n', 'utf8');
    console.log('✅ 增量登记完成：新增 ' + changes.added.length + ' 条（现有 ' + Object.keys(body.files).length + ' 条）');
    for (const rel of changes.added) console.log('   + ' + rel + ' = ' + body.files[rel]);
    if (changes.blockedRaise.length) {
      console.log('⚠️ 拒绝抬高 ' + changes.blockedRaise.length + ' 个已有登记值（存量膨胀应拆分，不应改基线）：');
      for (const c of changes.blockedRaise) console.log('   ~ ' + c.path + ' 登记 ' + c.registered + ' → 现 ' + c.current);
    }
    if (changes.blockedRemove.length) {
      console.log('⚠️ 不会静默删账 ' + changes.blockedRemove.length + ' 条（逐键决策）：');
      for (const rel of changes.blockedRemove) console.log('   - ' + rel + ' → 如已拆分/已删：node .github/scripts/check-max-lines.js --prune ' + rel);
    }
    if (changes.skippedTombstone.length) {
      console.log('❗ 墓碑路径重新超限，不得重新挂账（必须拆）：' + changes.skippedTombstone.join(', '));
    }
    process.exit(0);
  }

  if (!base) {
    console.log('未找到挂账清单，正在生成初始基线：', bp);
    writeBaseline(scanned, { limit: DEFAULT_LIMIT }, bp);
    console.log('已生成，请复核后再次运行以执行门禁。');
    process.exit(0);
  }

  const { violations, notices, results } = evaluate(base, scanned, all);
  if (isJson) {
    console.log(JSON.stringify({ results, scanned, violations, notices }, null, 2));
  } else {
    console.log('=== 逐文件行数门禁 ===');
    console.log('limit=' + results.limit + ' growthAllowance=' + results.allowance
      + ' 超限文件=' + results.overLimitCount + ' 挂账=' + results.ledgerCount
      + ' 墓碑=' + results.prunedCount);
    for (const v of violations) console.log('❌ ' + v);
    for (const n of notices) console.log('⚠️ ' + n);
    if (!violations.length) console.log('✅ 无新增超大文件，挂账清单与现实一致。');
  }
  process.exit(violations.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  scanFiles, scanAllLines, collectOverLimit, evaluate, readBaseline, writeBaseline,
  computeUpdate, pruneBaseline,
  DEFAULT_LIMIT, DEFAULT_GROWTH_ALLOWANCE, SCAN_DIRS, SOURCE_EXTS, EXCLUDE,
};
