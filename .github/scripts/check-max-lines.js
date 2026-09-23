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
 * 三条硬规则：
 *   1. NEW_OVER_LIMIT —— 超过 limit 且不在挂账清单里的源文件 → 阻断（新代码必须拆分）
 *   2. STALE_LEDGER_ENTRY —— 清单里的文件已不存在，或已拆到 limit 以下 → 阻断
 *      （清单必须反映现实，不得留僵尸条目，也不得把已还的债继续挂着）
 *   3. LEDGER_GREW —— 存量文件较登记值增长超过 growthAllowance → 阻断
 *      （大文件允许小幅维护改动，不允许继续膨胀成新债）
 *
 * 用法：
 *   node .github/scripts/check-max-lines.js              # 检查（CI）
 *   node .github/scripts/check-max-lines.js --update     # 重新生成挂账清单
 *   node .github/scripts/check-max-lines.js --json       # JSON 输出
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

/** 扫描全部受管源文件，返回相对扫描根的路径 → 行数 */
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

/** 清单落盘：键按字典序排序，保证 --update 产出可复现（diff 只反映真实债务变化） */
function writeBaseline(files, meta, p) {
  const file = p || BASELINE_PATH;
  const body = {
    '//': '超大文件挂账清单（audit-batch-4）。limit 之上的存量文件在此登记；新文件超限一律阻断。更新：node .github/scripts/check-max-lines.js --update',
    limit: meta && meta.limit ? meta.limit : DEFAULT_LIMIT,
    growthAllowance: meta && meta.growthAllowance ? meta.growthAllowance : DEFAULT_GROWTH_ALLOWANCE,
    files: Object.keys(files).sort().reduce((acc, k) => { acc[k] = files[k]; return acc; }, {}),
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return body;
}

/**
 * 核心判定（纯函数，便于用例注入假清单/假扫描结果）。
 * @returns {{violations: string[], results: object}}
 */
function evaluate(baseline, scanned) {
  const limit = baseline && Number.isFinite(baseline.limit) ? baseline.limit : DEFAULT_LIMIT;
  const allowance = baseline && Number.isFinite(baseline.growthAllowance)
    ? baseline.growthAllowance : DEFAULT_GROWTH_ALLOWANCE;
  const ledger = (baseline && baseline.files) || {};
  const violations = [];

  for (const rel of Object.keys(scanned).sort()) {
    const lines = scanned[rel];
    if (Object.prototype.hasOwnProperty.call(ledger, rel)) {
      const grown = lines - ledger[rel];
      if (grown > allowance) {
        violations.push('LEDGER_GREW: ' + rel + ' 较登记值 ' + ledger[rel] + ' 膨胀 ' + grown + ' 行（容差 ' + allowance + '），请拆分或经审阅后 --update');
      }
      continue;
    }
    if (lines >= limit) {
      violations.push('NEW_OVER_LIMIT: ' + rel + ' ' + lines + ' 行 >= ' + limit + '，新代码不得引入超大文件（按既有 mixin/composable 范式拆分）');
    }
  }

  for (const rel of Object.keys(ledger).sort()) {
    if (!Object.prototype.hasOwnProperty.call(scanned, rel)) {
      violations.push('STALE_LEDGER_ENTRY: ' + rel + ' 已不在扫描结果中（文件已删/改名/移出受管目录），请 --update 清账');
      continue;
    }
    if (scanned[rel] < limit) {
      violations.push('STALE_LEDGER_ENTRY: ' + rel + ' 已降到 ' + limit + ' 行以下（现 ' + scanned[rel] + '），债务已还，请 --update 清账');
    }
  }

  return {
    violations,
    results: { overLimitCount: Object.keys(scanned).length, ledgerCount: Object.keys(ledger).length, limit, allowance },
  };
}

function main() {
  const args = process.argv.slice(2);
  const isUpdate = args.includes('--update');
  const isJson = args.includes('--json');
  const baselinePath = args.includes('--baseline') ? args[args.indexOf('--baseline') + 1] : null;
  const rootDir = args.includes('--root') ? args[args.indexOf('--root') + 1] : null;
  const bp = baselinePath || BASELINE_PATH;

  const base = readBaseline(bp);
  const limit = base && Number.isFinite(base.limit) ? base.limit : DEFAULT_LIMIT;
  const scanned = collectOverLimit(rootDir, limit);

  if (isUpdate) {
    const body = writeBaseline(scanned, base || { limit: DEFAULT_LIMIT }, bp);
    console.log('挂账清单已写入', bp, '（' + Object.keys(body.files).length + ' 个超限文件）');
    process.exit(0);
  }

  if (!base) {
    console.log('未找到挂账清单，正在生成初始基线：', bp);
    writeBaseline(scanned, { limit: DEFAULT_LIMIT }, bp);
    console.log('已生成，请复核后再次运行以执行门禁。');
    process.exit(0);
  }

  const { violations, results } = evaluate(base, scanned);
  if (isJson) {
    console.log(JSON.stringify({ results, scanned, violations }, null, 2));
  } else {
    console.log('=== 逐文件行数门禁 ===');
    console.log('limit=' + results.limit + ' growthAllowance=' + results.allowance
      + ' 超限文件=' + results.overLimitCount + ' 挂账=' + results.ledgerCount);
    for (const v of violations) console.log('❌ ' + v);
    if (!violations.length) console.log('✅ 无新增超大文件，挂账清单与现实一致。');
  }
  process.exit(violations.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { scanFiles, collectOverLimit, evaluate, readBaseline, writeBaseline, DEFAULT_LIMIT, DEFAULT_GROWTH_ALLOWANCE, SCAN_DIRS, SOURCE_EXTS, EXCLUDE };
