#!/usr/bin/env node
/**
 * check-dep-audit.js — 依赖漏洞审计基线棘轮（审计 P2·依赖锁定 / [v2] 未覆盖维度补跑）
 *
 * 为什么要有这个门禁：审计报告 v2 明确指出「本轮未运行 npm audit / osv-scanner /
 * pip-audit，已知 CVE 结论缺失」。缺结论本身就是风险 —— 所以这里把两个扫描器接成
 * 可复现的常驻控制：
 *   - npm 侧：`pnpm audit --prod --json`（必须显式走官方 registry，
 *     npmmirror 镜像没有 audit 端点，会报 ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS）
 *   - python 侧：`pip-audit -r ops-center/backend/requirements.txt --format json`
 *
 * 判定（三条，全部按 advisory id 逐条比对，不做「数量阈值」这种可被抵消的口径）：
 *   1. NEW_ADVISORY        —— 出现基线之外的新公告 → 阻断（要么升级，要么登记并给结论）
 *   2. RESOLVED_STILL_BASELINED —— 基线里的公告已不再命中 → 阻断（清账，防基线腐化）
 *   3. BASELINE_META_INVALID —— 条目缺 decision / decision 非法 / reviewBy 已过期 → 阻断
 *      （挂账必须写清「为什么不马上修」和「什么时候回看」，不允许无限期挂账）
 *
 * 扫描器本身跑不起来（离线 / 端点不可达）时**不判失败**，改为 SCANNER_UNAVAILABLE 告警：
 * 让 PR 因网络抖动变红会让门禁被人为关掉，反而更危险。周计划任务是本门禁的权威来源。
 *
 * 用法：
 *   node scripts/check-dep-audit.js               # 检查（CI）
 *   node scripts/check-dep-audit.js --update      # 扫描并把新公告并入基线
 *   node scripts/check-dep-audit.js --json        # JSON 输出
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'dep-audit-baseline.json');
const PIP_REQUIREMENTS = 'ops-center/backend/requirements.txt';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const VALID_DECISIONS = ['upgrade-tracked', 'accepted-risk', 'not-exploitable', 'no-fix-available'];

function shellRun (cmd, args, opts = {}) {
  try {
    const res = spawnSync(cmd, args, {
      cwd: opts.cwd || ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    if (res.error) return { ok: false, error: String(res.error.message || res.error) };
    const out = String(res.stdout || '');
    const start = out.indexOf('{');
    if (start < 0) {
      return { ok: false, error: '扫描器无 JSON 输出：' + String(res.stderr || '').slice(0, 300) };
    }
    try {
      return { ok: true, json: JSON.parse(out.slice(start)) };
    } catch (e) {
      return { ok: false, error: 'JSON 解析失败: ' + e.message };
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** 默认扫描器：真实调 pnpm / pip-audit（用例注入假实现，避免依赖网络）。 */
function createDefaultRunners (registry) {
  return {
    npm: () => shellRun('pnpm', ['audit', '--prod', '--json', '--registry=' + registry]),
    pip: () => shellRun('pip-audit', ['-r', PIP_REQUIREMENTS, '--format', 'json', '--progress-spinner', 'off']),
  };
}

/** pnpm/npm audit JSON → 归一化条目。按 GHSA id 去重（同一公告可能命中多个 workspace）。 */
function parseNpmAudit (report) {
  const advisories = (report && report.advisories) || {};
  const out = new Map();
  for (const raw of Object.values(advisories)) {
    const id = raw.github_advisory_id || ('npm-' + raw.id);
    const findings = raw.findings || [];
    const roots = [...new Set(findings.flatMap((f) => (f.paths || []).map((p) => String(p).split('>')[0])))].sort();
    const prev = out.get(id);
    const entry = {
      source: 'npm',
      id,
      module: raw.module_name || 'unknown',
      severity: raw.severity || 'unknown',
      patched: raw.patched_versions || '',
      roots: prev ? [...new Set(prev.roots.concat(roots))].sort() : roots,
    };
    out.set(id, entry);
  }
  return [...out.values()];
}

/** pip-audit JSON → 归一化条目（pip-audit 不给严重度，统一 unknown，由人工在基线里补注）。 */
function parsePipAudit (report) {
  const deps = (report && report.dependencies) || [];
  const out = new Map();
  for (const dep of deps) {
    for (const vuln of dep.vulns || []) {
      const id = vuln.id || vuln.name;
      const fixes = (vuln.fix_versions || []).join(', ');
      if (out.has(id)) {
        const prev = out.get(id);
        if (!prev.module.includes(dep.name)) prev.module += ',' + dep.name;
        // 同一公告在不同包里的修复版本要合并展示，否则「无修复」会盖掉「可升级到 x.y」
        if (fixes && !prev.patched.includes(fixes)) {
          prev.patched = prev.patched ? prev.patched + ', ' + fixes : fixes;
        }
        continue;
      }
      out.set(id, {
        source: 'pip',
        id,
        module: dep.name || 'unknown',
        severity: 'unknown',
        patched: fixes,
        roots: ['ops-center/backend'],
      });
    }
  }
  return [...out.values()];
}

function readBaseline (p) {
  const file = p || BASELINE_PATH;
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sortEntries (entries) {
  return entries.slice().sort((a, b) => (a.source + a.id).localeCompare(b.source + b.id));
}

/** 基线落盘：新增条目只带 TODO 决策（必须人工补结论，否则 META_INVALID 立刻拦下）。 */
function writeBaseline (found, old, p) {
  const file = p || BASELINE_PATH;
  const prevList = (old && old.advisories) || [];
  const prev = new Map(prevList.map((e) => [e.source + '/' + e.id, e]));
  const advisories = sortEntries(found).map((e) => {
    const key = e.source + '/' + e.id;
    const before = prev.get(key);
    if (before) return Object.assign({}, before, { severity: e.severity, patched: e.patched, roots: e.roots });
    return {
      source: e.source, id: e.id, module: e.module, severity: e.severity,
      patched: e.patched, roots: e.roots, decision: 'TODO', note: '待补结论（新公告）',
    };
  });
  const body = {
    '//': '依赖漏洞审计挂账清单（audit-batch-4）。升级/新增依赖后请跑：node scripts/check-dep-audit.js --update 并补齐 decision/note。',
    reviewBy: (old && old.reviewBy) || '',
    advisories,
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return body;
}

/**
 * 核心判定（纯函数，用例注入假扫描结果）。
 * @returns {{violations: string[], scannedCount: number}}
 */
function evaluate (baseline, found, today) {
  const now = today || new Date().toISOString().slice(0, 10);
  const violations = [];
  const list = (baseline && baseline.advisories) || [];
  const ledger = new Map(list.map((e) => [e.source + '/' + e.id, e]));
  const hits = new Map(found.map((e) => [e.source + '/' + e.id, e]));

  for (const e of sortEntries(found)) {
    const key = e.source + '/' + e.id;
    const item = ledger.get(key);
    if (!item) {
      violations.push('NEW_ADVISORY: ' + key + ' (' + e.module + ' ' + e.severity + ', 修复版本 ' + (e.patched || '无') + ', 路径 ' + (e.roots || []).join('|') + ') —— 升级依赖，或在基线登记 decision + note');
      continue;
    }
    if (!item.decision || !VALID_DECISIONS.includes(item.decision)) {
      violations.push('BASELINE_META_INVALID: ' + key + ' 的 decision=' + JSON.stringify(item.decision) + ' 非法（允许 ' + VALID_DECISIONS.join('/') + '）');
    }
    if (!item.note || !String(item.note).trim()) {
      violations.push('BASELINE_META_INVALID: ' + key + ' 缺 note（挂账必须写清为什么不马上修）');
    }
  }

  for (const item of list) {
    const key = item.source + '/' + item.id;
    if (!hits.has(key)) {
      violations.push('RESOLVED_STILL_BASELINED: ' + key + ' 已不再命中（多半已升级），请 --update 清账');
    }
  }

  const reviewBy = baseline && baseline.reviewBy;
  if (!reviewBy || !/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) {
    violations.push('BASELINE_META_INVALID: 顶层 reviewBy 必须是 YYYY-MM-DD（当前 ' + JSON.stringify(reviewBy) + '）');
  } else if (reviewBy < now) {
    violations.push('REVIEW_DEADLINE_PASSED: 挂账复核日 ' + reviewBy + ' 已过（今天 ' + now + '），请重新评审并顺延 reviewBy');
  }

  return { violations, scannedCount: found.length, ledgerCount: list.length };
}

function main () {
  const args = process.argv.slice(2);
  const isUpdate = args.includes('--update');
  const isJson = args.includes('--json');
  const registry = process.env.NPM_AUDIT_REGISTRY || DEFAULT_REGISTRY;
  const runners = createDefaultRunners(registry);

  const results = {};
  const unavailable = [];
  for (const source of ['npm', 'pip']) {
    const res = runners[source]();
    if (!res || !res.ok) {
      unavailable.push(source + '(' + ((res && res.error) || 'unknown').slice(0, 160) + ')');
      results[source] = [];
      continue;
    }
    results[source] = source === 'npm' ? parseNpmAudit(res.json) : parsePipAudit(res.json);
  }
  const found = results.npm.concat(results.pip);

  if (unavailable.length && !isUpdate) {
    console.log('::warning::SCANNER_UNAVAILABLE: ' + unavailable.join(' ') + ' —— 本轮不判失败，周计划任务为权威来源');
    if (isJson) console.log(JSON.stringify({ unavailable, violations: [] }, null, 2));
    return 0;
  }
  if (unavailable.length) {
    console.error('扫描器不可用，拒绝写基线：' + unavailable.join(' '));
    return 1;
  }

  const bp = BASELINE_PATH;
  const base = readBaseline(bp);
  if (isUpdate) {
    const body = writeBaseline(found, base, bp);
    console.log('基线已写入', bp, '（' + body.advisories.length + ' 条；新增条目 decision=TODO 必须补结论）');
    return 0;
  }
  if (!base) {
    console.log('未找到基线，正在生成：' + bp);
    writeBaseline(found, null, bp);
    console.log('已生成，请补齐 decision/note 后再次运行以执行门禁。');
    return 0;
  }

  const { violations, scannedCount, ledgerCount } = evaluate(base, found);
  if (isJson) {
    console.log(JSON.stringify({ scannedCount, ledgerCount, found: sortEntries(found), violations }, null, 2));
  } else {
    console.log('=== 依赖漏洞审计门禁 ===');
    console.log('npm=' + results.npm.length + ' pip=' + results.pip.length + ' 命中=' + scannedCount + ' 挂账=' + ledgerCount);
    for (const v of violations) console.log('❌ ' + v);
    if (!violations.length) console.log('✅ 无新增已知漏洞公告，基线与现实一致且结论完整。');
  }
  return violations.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  evaluate,
  parseNpmAudit,
  parsePipAudit,
  readBaseline,
  writeBaseline,
  sortEntries,
  createDefaultRunners,
  shellRun,
  VALID_DECISIONS,
  DEFAULT_REGISTRY,
  BASELINE_PATH,
};
