#!/usr/bin/env node
/**
 * check-debt-budget.js — 债务熔断 CI 门禁
 *
 * 6 项指标量化基线，超阈值返回非零退出码阻断 merge。
 * 基线文件：scripts/debt-baseline.json（首次运行时自动生成）。
 *
 * 指标：
 *   1. 单文件最大行数（冻结现值，只降不升）
 *   2. >=1000 行文件数（不增）
 *   3. >=500 行文件数（不增）
 *   4. model-provider-manager.js require 扇出（不增）
 *   5. 循环依赖数（必须为 0）
 *   6. 覆盖率纳入面（Stage 3 后启用）
 *
 * 扫描域：与行数门禁（.github/scripts/check-max-lines.js）共用 scripts/lib/git-domain.js ——
 * 域 = git 索引 ∪ 未被 .gitignore 排除的未跟踪文件（= `git status` = CI 检出的口径）。
 * 改前本文件按 `fs.readdirSync` 走磁盘，而 `apps/desktop/electron/**.bundle.js` 这类构建产物
 * 既落在 SCAN_DIRS 内又被忽略 ⇒ 本机跑过 build 就比 CI 多数个文件（实测 97 vs 95，基线 101，
 * 靠 4 格余量没红）—— 拿磁盘域去比一份按 CI 检出立的账，就是 #3782 漏改的第二处（见 #3876）。
 * 取不到 git 读数（非工作树 / git 不可执行 / 空集合）一律退出码 2，与「指标超基线」的 1 分开。
 *
 * 用法：
 *   node scripts/check-debt-budget.js               # 检查（CI 模式）
 *   node scripts/check-debt-budget.js --update       # 更新基线
 *   node scripts/check-debt-budget.js --json         # JSON 输出
 *   node scripts/check-debt-budget.js --root <仓库根>  # 换一棵树跑（本机 A/B；取不到 git 读数退出码 2）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { gitDomain } = require('./lib/git-domain');

const BASELINE_PATH = path.join(__dirname, 'debt-baseline.json');
const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['apps/desktop/src', 'apps/desktop/electron', 'packages', 'ops-center/backend'];
const SOURCE_EXTS = new Set(['.js', '.ts', '.vue', '.py', '.tsx', '.jsx', '.css', '.scss']);
const EXCLUDE = ['node_modules', 'dist', '.git', 'tests', 'test', '__tests__', 'dist-electron'];
const MODEL_PROVIDER_PATH = 'apps/desktop/electron/services/model-provider-manager.js';

function countFilesByMinLines(dirs, minLines, root, domain) {
  let count = 0;
  let maxFile = { path: '', lines: 0 };
  const files = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      const relative = path.relative(root, fp).replace(/\\/g, '/');
      if (EXCLUDE.some(x => relative.includes(x))) continue;
      if (e.isDirectory()) { walk(fp); continue; }
      if (!SOURCE_EXTS.has(path.extname(e.name))) continue;
      // 域过滤在**读文件之前**：不受管又不被忽略之外的产物（磁盘上多出来的生成物）根本不该被量
      if (!domain.has(relative)) continue;
      try {
        const lines = fs.readFileSync(fp, 'utf8').split('\n').length;
        if (lines >= minLines) {
          count++;
          files.push({ path: relative, lines });
        }
        if (lines > maxFile.lines) maxFile = { path: relative, lines };
      } catch (_) {}
    }
  }

  for (const d of dirs) walk(path.join(root, d));
  return { count, maxFile, files };
}

function measureModelProviderFanOut(root) {
  const fp = path.join(root, MODEL_PROVIDER_PATH);
  if (!fs.existsSync(fp)) return { lines: 0, uniqueRequires: 0 };
  const s = fs.readFileSync(fp, 'utf8');
  const lines = s.split('\n').length;
  const matches = s.match(/require\(['"][^'"]+['"]\)/g);
  const unique = matches ? [...new Set(matches)].sort() : [];
  return { lines, uniqueRequires: unique.length };
}

function checkCircularDeps(root, domain) {
  // Simple DFS-based circular dependency detection
  const graph = new Map();
  const files = [];

  function collectFiles(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      const relative = path.relative(root, fp).replace(/\\/g, '/');
      if (EXCLUDE.some(x => relative.includes(x))) continue;
      if (e.isDirectory()) { collectFiles(fp); continue; }
      if (!/\.(js|ts|vue)$/.test(e.name)) continue;
      if (!domain.has(relative)) continue; // 与计数同一把域：磁盘上多出来的生成物不得进依赖图
      files.push(relative);
    }
  }

  for (const d of SCAN_DIRS) collectFiles(path.join(root, d));

  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(root, f), 'utf8');
      const reqs = content.match(/require\(['"]([^'"]+)['"]\)/g) || [];
      const imports = content.match(/from ['"]([^'"]+)['"]/g) || [];
      const deps = [];
      for (const r of [...reqs, ...imports]) {
        const m = r.match(/['"]([^'"]+)['"]/);
        if (!m) continue;
        const target = m[1];
        if (!target.startsWith('.')) continue;
        const resolved = path.normalize(path.join(path.dirname(f), target)).replace(/\\/g, '/');
        deps.push(resolved);
      }
      graph.set(f, deps);
    } catch (_) {}
  }

  // DFS to detect cycles
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const cycles = [];

  function dfs(node, stack) {
    color.set(node, GRAY);
    stack.push(node);
    const neighbors = graph.get(node) || [];
    for (const n of neighbors) {
      const c = color.get(n) || WHITE;
      if (c === GRAY) {
        const cycleStart = stack.indexOf(n);
        if (cycleStart >= 0) {
          cycles.push([...stack.slice(cycleStart), n]);
        }
      } else if (c === WHITE) {
        dfs(n, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const [node] of graph) {
    if ((color.get(node) || WHITE) === WHITE) dfs(node, []);
  }

  return { count: cycles.length, cycles };
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeBaseline(data) {
  const persist = {};
  for (const k of PERSISTED_KEYS) persist[k] = data[k];
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(persist, null, 2) + '\n', 'utf8');
  console.log('Baseline written to', BASELINE_PATH);
}

// 基线文件只持久化这 5 个数值口径 —— 域大小与逐文件清单是**现场证据**，写进受管账本就会把
// "当场读数"变成"基线"（#3876 同型教训：这类数会随仓库增长，钉进账本等于每次都要重算）。
const PERSISTED_KEYS = ['maxFileLines', 'maxFilePath', 'filesOver1000', 'filesOver500',
  'modelProviderLines', 'modelProviderRequireFanOut', 'circularDeps'];

function collectMetrics(rootDir) {
  const root = rootDir || ROOT;
  const domain = gitDomain(root); // 取不到读数就地抛错，由调用方转退出码 2（不退回磁盘扫）
  const r1000 = countFilesByMinLines(SCAN_DIRS, 1000, root, domain);
  const r500 = countFilesByMinLines(SCAN_DIRS, 500, root, domain);
  const mp = measureModelProviderFanOut(root);
  const cd = checkCircularDeps(root, domain);

  return {
    scannedAt: new Date().toISOString(),
    domainSize: domain.size,
    maxFileLines: r1000.maxFile.lines,
    maxFilePath: r1000.maxFile.path,
    filesOver1000: r1000.count,
    filesOver1000Paths: r1000.files.map(f => f.path),
    filesOver500: r500.count,
    filesOver500Paths: r500.files.map(f => f.path),
    modelProviderLines: mp.lines,
    modelProviderRequireFanOut: mp.uniqueRequires,
    circularDeps: cd.count,
    circularDepDetails: cd.cycles,
  };
}

function check(baseline, current) {
  const violations = [];
  const results = [];

  // 1. 单文件最大行数
  if (baseline && current.maxFileLines > baseline.maxFileLines) {
    violations.push(`MAX_FILE_LINES: ${current.maxFileLines} > baseline ${baseline.maxFileLines} (${current.maxFilePath})`);
  }
  results.push({ metric: 'maxFileLines', current: current.maxFileLines, baseline: baseline?.maxFileLines || null, pass: !violations.some(v => v.includes('MAX_FILE_LINES')) });

  // 2. >=1000 行文件数
  if (baseline && current.filesOver1000 > baseline.filesOver1000) {
    violations.push(`FILES_OVER_1000: ${current.filesOver1000} > baseline ${baseline.filesOver1000}`);
  }
  results.push({ metric: 'filesOver1000', current: current.filesOver1000, baseline: baseline?.filesOver1000 || null, pass: !violations.some(v => v.includes('FILES_OVER_1000')) });

  // 3. >=500 行文件数
  if (baseline && current.filesOver500 > baseline.filesOver500) {
    violations.push(`FILES_OVER_500: ${current.filesOver500} > baseline ${baseline.filesOver500}`);
  }
  results.push({ metric: 'filesOver500', current: current.filesOver500, baseline: baseline?.filesOver500 || null, pass: !violations.some(v => v.includes('FILES_OVER_500')) });

  // 4. model-provider-manager require 扇出
  if (baseline && current.modelProviderRequireFanOut > baseline.modelProviderRequireFanOut) {
    violations.push(`MODEL_PROVIDER_FAN_OUT: ${current.modelProviderRequireFanOut} > baseline ${baseline.modelProviderRequireFanOut}`);
  }
  results.push({ metric: 'modelProviderRequireFanOut', current: current.modelProviderRequireFanOut, baseline: baseline?.modelProviderRequireFanOut || null, pass: !violations.some(v => v.includes('MODEL_PROVIDER_FAN_OUT')) });

  // 5. 循环依赖数
  if (current.circularDeps > 0) {
    violations.push(`CIRCULAR_DEPS: ${current.circularDeps} cycle(s) detected`);
    for (const cycle of current.circularDepDetails) {
      violations.push(`  Cycle: ${cycle.join(' -> ')}`);
    }
  }
  results.push({ metric: 'circularDeps', current: current.circularDeps, baseline: 0, pass: current.circularDeps === 0 });

  return { violations, results };
}

function main() {
  const args = process.argv.slice(2);
  const isUpdate = args.includes('--update');
  const isJson = args.includes('--json');
  // --root：把取数指向另一个仓库根（本机 A/B 用；缺省仍是本仓 ROOT）。共享实现要求 root 必传，
  // 缺省口径必须由本文件自己补，不能让判据替调用方猜 —— 同 #3853 把 fragileFor 的 root 改成必传的口径。
  const rootIdx = args.indexOf('--root');
  const rootDir = rootIdx >= 0 ? args[rootIdx + 1] : null;
  if (rootIdx >= 0 && (!rootDir || rootDir.startsWith('--'))) {
    console.error('❌ --root 需要一个仓库根路径（拒绝静默降级为本仓）');
    process.exit(2);
  }

  let current;
  try {
    current = collectMetrics(rootDir || ROOT);
  } catch (e) {
    // 退出码 2 = 判据自身故障（取不到 git 读数），与 1 =「指标超基线」分开：
    // 把工具的失明读成"通过"或读成"债务"，都是本仓反复出现的同型错误。
    // 共享实现的文案已经自带"无法从 git 取得扫描域："前缀，这里再拼一次会变成两遍同句话
    // （实测输出 ❌ 无法从 git 取得扫描域：无法从 git 取得扫描域：…）—— 只加符号，不重复语义。
    console.error('❌ ' + (e && e.message ? e.message : String(e)));
    console.error('   本门禁拒绝据此出结论，也不退回磁盘全量 —— 磁盘上的生成物与 CI 检出不是一棵树（见 #3876）。');
    process.exit(2);
  }
  const baseline = readBaseline();

  if (isUpdate) {
    writeBaseline(current);
    process.exit(0);
  }

  if (!baseline) {
    console.log('No baseline found. Creating initial baseline...');
    writeBaseline(current);
    console.log('Debt budget baseline created. Run again to check.');
    process.exit(0);
  }

  const { violations, results } = check(baseline, current);

  if (isJson) {
    console.log(JSON.stringify({ current, baseline, violations, results }, null, 2));
    process.exit(violations.length > 0 ? 1 : 0);
  }

  console.log('=== 债务熔断检查 ===');
  console.log('[debt-budget] domain=' + current.domainSize + ' (git 索引 ∪ 未忽略的未跟踪文件)');
  console.log('');
  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    const baselineStr = r.baseline !== null ? ` (baseline: ${r.baseline})` : '';
    console.log(`${icon} ${r.metric}: ${r.current}${baselineStr}`);
  }
  console.log('');

  if (violations.length > 0) {
    console.log('❌ 债务熔断：以下指标超出基线：');
    for (const v of violations) {
      console.log(`   ${v}`);
    }
    console.log('');
    console.log('如需更新基线（如经审查确认的债务清理），请运行：');
    console.log('  node scripts/check-debt-budget.js --update');
    process.exit(1);
  }

  console.log('✅ 所有债务指标在基线内，通过。');
  process.exit(0);
}

// 被 require 时不得跑 main() —— 原实现在文件末尾无条件调用 main()，而它会 process.exit(0)：
// 任何 `require('./check-debt-budget')` 的测试都会在导入期把测试进程杀掉，而 node:test 把
// "文件退出 0"报成 `✔ <文件名>` + `tests 1 / pass 1`，于是一整份用例**一条都没跑却全绿**（本轮实测抓到）。
if (require.main === module) main();

module.exports = {
  collectMetrics, gitDomain, check, readBaseline, writeBaseline,
  SCAN_DIRS, SOURCE_EXTS, EXCLUDE, PERSISTED_KEYS,
};
