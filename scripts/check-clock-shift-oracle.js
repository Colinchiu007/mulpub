#!/usr/bin/env node
'use strict';

/**
 * 时钟位移 oracle（v1 覆盖域 = apps/desktop 的 vitest 套件）。
 *
 * 要解决的问题（QM-5 第 5 步的"防止再次发生"）：本仓出现过「夹具写死绝对时间戳 +
 * 被测路径读真实时钟 + 窗口是相对量」的定时炸弹（#3459 / 被我抢慢一步的那笔同名修复）。
 * 我先按登记要求量了存量，结论是**静态形状规则不可行**：
 *   origin/main 1326 个测试文件里 148 个含绝对时间戳；其中"含窗口参数又没注入时钟"的 6 个，
 *   逐条判读**全是假阳性**（performance-overview 的窗口只决定日桶键、quick-collect-prompt 的
 *   windowHours 只用来拼文案）。⇒ "窗口参数是否真的被时钟消费"不是形状能判的。
 * 于是换成行为判据：**同一批用例跑两遍，第二遍把整个进程的"现在"推到未来**。
 * 只有"结果随墙上时钟变"的用例会单独红 —— 这就是引信的定义本身，不需要每个测试配合。
 *
 * 三条不可省的自证（缺任一条，"没有新增红"就可能是探针没跑起来）：
 * ① 位移那趟必须看到 `[CLOCK-SHIFT] active` 行（补丁真的装上了）；
 * ② 基线那趟的失败集合单独列出——差集只在"基线绿"时才是权威结论；
 * ③ 候选域大小必须 > 0 且实际被 vitest 收集（数到的文件数写进报告），否则空集判绿是假绿。
 *
 * 用法：
 *   node scripts/check-clock-shift-oracle.js                 # 自动取候选域（含绝对时间戳的 desktop 测试）
 *   node scripts/check-clock-shift-oracle.js --files=a.js,b.js
 *   node scripts/check-clock-shift-oracle.js --shift-days=45 --limit=20
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DESKTOP = path.join(REPO_ROOT, 'apps', 'desktop');
const VITEST = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const SETUP = path.join('apps', 'desktop', 'test-setup-clock-shift.js');

// 候选域**不得凭记忆写死目录**（本仓已实测：配平/统计类判据一旦用自己列的域，
// 就会和 vitest 真正收集的那份漂移）。这里直接从 apps/desktop/vitest.config.js 读
// `test.include`，把每个 glob 的头一段静态目录取出来当扫描根；取不出来就当场停，
// 而不是退化成"扫全仓"或"扫我记得的那几个目录"。
function includeDirsFromConfig() {
  const cfg = require(path.join(DESKTOP, 'vitest.config.js'));
  const patterns = (cfg && cfg.test && cfg.test.include) || [];
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error('[clock-oracle] 读不到 apps/desktop/vitest.config.js 的 test.include ⇒ 扫描域未知，不得判绿');
  }
  const dirs = new Set();
  for (const p of patterns) {
    const head = String(p).split('/')[0];
    if (!head || head === '**' || head.includes('*') || head.startsWith('.')) {
      throw new Error(`[clock-oracle] include 模式 ${p} 的头一段不是静态目录 —— 无法安全推出扫描根`);
    }
    dirs.add(head);
  }
  return [...dirs].sort();
}
const TEST_SUFFIX = /\.(test|spec)\.(js|ts)$/;
/**
 * 候选形态清单（决定哪些文件进位移对照）。
 *
 * ⚠️ 这是**预筛**，不是判据：判据永远是"位移趟比基线趟多红了什么"。预筛只决定省钱范围，
 * 所以取向是**宁可多收**——假阳性只多花一次 vitest，假阴性等于该引信永远不被测。
 * 覆盖面当场量得（`probe-selector` 于 apps/desktop 全域 936 个测试文件上实测）：
 *   仅 v1 那条日期串形态 = 118 个；下面五条并集 = 168 个 ⇒ v1 形态会整类漏掉
 *   数字纪元（13/10 位）与"跟内核时间打交道"这两族，各 9 与 2 个文件不在 v1 集合里。
 * 本 PR 实际抓到的那条（visual-ci 的 `Date.now()` vs `fs...mtimeMs`）属第五族，
 * 它当初进集合纯属侥幸（同文件另有 `new Date('2026-07-22T…')`）——所以第五族必须显式列出，
 * 不能靠"顺便命中"。
 *
 * 覆盖不到的形态（如实登记，不得读成"全域已测"）：不含任何时间字面量、也不碰内核时间，
 * 只从 env/IPC/文件里**间接**取"现在"的用例。这类要靠位移趟全域跑才有牙，而全域两趟 ≈ 72 分钟
 * （按本次实测单趟 4m32s × 936/118 外推）超出周巡检预算，故 v1 不收。
 */
const TIME_FORMS = [
  // ① 带引号的日期串（含裸串——夹具常先存变量再 new Date/Date.parse）
  ['iso_date_string', "['\"`]20\\d\\d-\\d\\d-\\d\\d"],
  // ② 13 位毫秒纪元（2013–2133）
  ['epoch_ms', '\\b1[7-9]\\d{11}\\b'],
  // ③ 10 位秒纪元（会误收长度/ID 类数字，属可接受的假阳性）
  ['epoch_s', '\\b1[7-9]\\d{8}\\b'],
  // ④ Date.UTC(20NN
  ['date_utc', 'Date\\.UTC\\(\\s*20\\d\\d'],
  // ⑤ 与内核时钟交换过值的现场（跨时钟域比较的唯一可静态观察特征）
  ['kernel_time', 'mtimeMs|mtime\\b|birthtimeMs|atimeMs|atime\\b|utimes|lastWriteTime|LastWriteTime|stats\\('],
];
const ABS_RE = new RegExp(TIME_FORMS.map(([, src]) => src).join('|'));

/**
 * 已知的时钟依赖用例（**只可缩小**）。新增一条必须写清"为什么它合理地依赖真实时间"，
 * 否则就是又一根引信换了个地方躺着。v1 起始为空：让第一跑自己把存量红点摊开。
 */
const KNOWN_CLOCK_DEPENDENT = [];

// 纯函数：CLI 参数解析。**未知旗标一律报错而不是忽略** ——
// 本轮实测：`--limit 4` 被静默丢弃（旧 argv() 只认 `--limit=4`），一次"小域 smoke"变成了整域两趟，
// 白跑十几分钟。静默忽略参数等于把"我要求跑什么"交给运气，故这里 fail closed。
function parseArgs(argvList) {
  const knownValue = new Set(['shift-days', 'limit', 'files']);
  const knownFlag = new Set(['dry-run']);
  const out = { dryRun: false, shiftDays: 45, limit: 0, filesArg: '', unknown: [] };
  for (let i = 0; i < argvList.length; i += 1) {
    const a = String(argvList[i]);
    if (!a.startsWith('--')) { out.unknown.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (knownFlag.has(name) && eq < 0) { out.dryRun = true; continue; }
    if (!knownValue.has(name)) { out.unknown.push(a); continue; }
    // 值可以来自 `--name=v` 或 `--name v`；两种写法都必须生效（旧实现只认前者）
    let val;
    if (eq >= 0) { val = a.slice(eq + 1); }
    else {
      val = argvList[i + 1];
      if (val === undefined || String(val).startsWith('--')) { out.unknown.push(`${a}(缺值)`); continue; }
      i += 1;
    }
    if (name === 'shift-days') {
      const n = Number(val);
      if (!Number.isFinite(n) || n <= 0) { out.unknown.push(`--shift-days=${val}(必须为正数)`); continue; }
      out.shiftDays = n;
    } else if (name === 'limit') {
      const n = Number(val);
      if (!Number.isInteger(n) || n <= 0) { out.unknown.push(`--limit=${val}(必须为正整数)`); continue; }
      out.limit = n;
    } else {
      out.filesArg = val;
    }
  }
  return out;
}
function argv(name, fallback) {
  const pre = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : fallback;
}
function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e; // 读不动的目录必须抛错：不完整遍历判绿是假绿
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (TEST_SUFFIX.test(ent.name)) out.push(full);
  }
  return out;
}

function collectCandidates() {
  const all = [];
  for (const d of includeDirsFromConfig()) walk(path.join(DESKTOP, d), all);
  const hits = [];
  // byForm：逐形态命中数。**覆盖面必须当场可重取**——否则"预筛收了哪些形态"只剩注释里的一个数，
  // 下一个人既无法复核也无法在它漂掉时察觉（本仓把"量过一次就写死"反复当成证据用坏了）。
  const byForm = Object.create(null);
  for (const [name] of TIME_FORMS) byForm[name] = 0;
  for (const f of all) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch (e) {
      throw new Error(`[clock-oracle] 读不到 ${f}：${e.message}（遍历不完整不得判绿）`);
    }
    if (!ABS_RE.test(text)) continue;
    hits.push(path.relative(DESKTOP, f).split(path.sep).join('/'));
    for (const [name, src] of TIME_FORMS) {
      if (new RegExp(src).test(text)) byForm[name] += 1;
    }
  }
  hits.sort();
  return { hits, byForm, domainTotal: all.length };
}

// 把报告里的文件名归一到与候选清单同一种写法（候选是 DESKTOP 相对路径）。
function normalizeReportName(name) {
  return String(name || '')
    .split(path.sep).join('/')
    .replace(/^.*?apps\/desktop\//, '')
    .replace(/^\.\//, '');
}

// 纯函数：候选清单 vs 这一趟真正收集到的文件 ⇒ 给出"哪些没跑"。
// 动因（2026-10-14 实测缺口）：位移趟 collected=167 / candidates=168，
// `electron/bootstrap/resume-guard.test.js` 整份没跑（该文件单独两档都绿），
// 而旧逻辑只看"有没有失败文件"，照样打印 PASS —— 一个没跑的文件在摘要里与"跑了且绿"同形。
function missingCandidates(files, reportNames) {
  const got = new Set(reportNames.map(normalizeReportName));
  return files.map((f) => normalizeReportName(f)).filter((f) => !got.has(f)).sort();
}

// 纯函数：**这一趟到底算不算跑完**。三种 fail-closed 形态各自独立成条，因为成因不同：
//   NOTHING_COLLECTED   = 扫描/参数漂了（候选非空却一个都没收到）
//   COLLECTED_MISMATCH  = 有文件没跑（本轮实测就是这一个）
//   RC_WITHOUT_FAILURES = 进程级异常（worker 被杀 / 未处理错误 / 报告写坏），
//                         这条最阴：它读起来完全像"全绿"
function judgePass(pass, candidateCount) {
  const reasons = [];
  if (pass.collected === 0 && candidateCount > 0) reasons.push(`NOTHING_COLLECTED(rc=${pass.rc})`);
  if (pass.collected !== candidateCount) {
    reasons.push(`COLLECTED_MISMATCH collected=${pass.collected} candidates=${candidateCount} missing=${JSON.stringify((pass.missing || []).slice(0, 5))}`);
  }
  if (pass.rc !== 0 && pass.failed.length === 0) {
    reasons.push(`RC_WITHOUT_FAILURES rc=${pass.rc} failing_files=0 ⇒ 整趟没跑完（进程级异常），不得读成"零失败"`);
  }
  return { ok: reasons.length === 0, reasons };
}
function runVitest(files, { shiftMs, tag }) {
  const jsonPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `clock-${tag}-`)), 'report.json');
  const env = Object.assign({}, process.env, {
    MP_TEST_NOW_SHIFT_MS: String(shiftMs),
    CI: '1',
  });
  const args = [VITEST, 'run', ...files,
    '--reporter=verbose', `--reporter=json`, `--outputFile.json=${jsonPath}`];
  let stdout = '';
  let rc = 0;
  try {
    stdout = execFileSync(process.execPath, args, {
      cwd: DESKTOP, env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    rc = typeof e.status === 'number' ? e.status : -1;
    stdout = String(e.stdout || '') + String(e.stderr || '');
  }
  let failed = [];
  const reported = [];
  let collected = 0;
  if (fs.existsSync(jsonPath)) {
    try {
      const rep = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      for (const a of rep.testResults || []) {
        collected++;
        const rel = path.relative(DESKTOP, a.name || a.testFilePath || '').split(path.sep).join('/');
        reported.push(rel);
        const bad = (a.assertionResults || []).filter((r) => r.status === 'failed');
        if (bad.length || a.status === 'failed') failed.push(rel);
      }
    } catch (e) {
      throw new Error(`[clock-oracle] 解析 ${tag} 报告失败：${e.message}（报告不完整即停，不得当成"零失败"）`);
    }
  } else if (!/Test Files\s/.test(stdout)) {
    throw new Error(`[clock-oracle] ${tag} 那趟既无 JSON 报告也无 vitest 汇总行 ⇒ 跑没跑起来都不知道`);
  }
  failed = [...new Set(failed)].sort();
  const missing = missingCandidates(files, reported);
  return { rc, stdout, failed, collected, missing, json: jsonPath };
}

function dryRun() {
  // 不跑 vitest 的自检模式：让**判据本体**在每次 PR 上都真的被执行一次。
  // 没有它，这个 CLI 只有本地手动跑过 ⇒ 会像本仓吃过的那样烂成"工具还在、域已经漂"。
  const dirs = includeDirsFromConfig();
  const scan = collectCandidates();
  const files = scan.hits;
  const forms = TIME_FORMS.map(([n]) => `${n}=${scan.byForm[n] ?? "MISSING"}`).join(' ');
  const setupOk = fs.existsSync(SETUP);
  const controlOk = fs.existsSync(path.join(DESKTOP, 'electron', 'services', 'clock-shift-oracle-control.test.js'));
  const vitestOk = fs.existsSync(VITEST);
  console.log(`[clock-oracle dry-run] include_dirs=${dirs.join(',')} domain=${scan.domainTotal} candidates=${files.length} forms=${forms} `
    + `setup=${setupOk} control_test=${controlOk} vitest=${vitestOk}`);
  const problems = [];
  if (!dirs.length) problems.push('include 推出的扫描域为空');
  if (!files.length) problems.push('候选集为空（扫描域或正则失效 ⇒ 不得读成"仓库干净"）');
  if (!setupOk) problems.push(`缺 ${SETUP}`);
  if (!controlOk) problems.push('缺阳性对照用例 clock-shift-oracle-control.test.js');
  if (!vitestOk) problems.push('缺 vitest 本体（本机依赖未就绪，正式跑会假通过）');
  if (problems.length) {
    for (const p of problems) console.log('FAIL: ' + p);
    return 1;
  }
  console.log('PASS: 判据本体可加载、扫描域非空、探针与对照都在位。');
  return 0;
}

function main() {
  if (hasFlag('dry-run')) return dryRun();
  const opts = parseArgs(process.argv.slice(2));
  if (opts.unknown.length) throw new Error(`无法识别的参数：${opts.unknown.join(' , ')}（宁可不跑，也不把"我要跑什么"静默换成别的范围）`);
  const { shiftDays, limit: limitRaw, filesArg } = opts;
  const shiftMs = Math.round(shiftDays * 86400000);

  const scan = collectCandidates();
  let files = filesArg ? filesArg.split(',').map((s) => s.trim()).filter(Boolean) : scan.hits;
  if (!filesArg) console.log(`[clock-oracle] 预筛覆盖面 domain=${scan.domainTotal} candidates=${scan.hits.length} forms=${TIME_FORMS.map(([n]) => `${n}=${scan.byForm[n]}`).join(' ')}`);
  if (limitRaw) files = files.slice(0, limitRaw);
  console.log(`[clock-oracle] domain=apps/desktop(vitest) shift_days=${shiftDays} candidates=${files.length}${limitRaw ? `（已按 --limit 截断，全域 ${scan.hits.length}）` : ''}`);
  if (!files.length) {
    console.log('FAIL: 候选域为空 —— 要么扫描域写错了，要么真的没有绝对时间戳夹具；两者都必须先证明再看结论');
    return 1;
  }
  if (!fs.existsSync(VITEST)) {
    console.log(`FAIL: 找不到 vitest（${VITEST}）⇒ 本机依赖未就绪，不得判"通过"`);
    return 1;
  }
  if (!fs.existsSync(path.join(DESKTOP, 'test-setup-clock-shift.js'))) {
    console.log(`FAIL: 缺少 ${SETUP} —— oracle 的补丁文件不在，跑第二遍等于重跑基线`);
    return 1;
  }

  const base = runVitest(files, { shiftMs: 0, tag: 'base' });
  const baseJudge = judgePass(base, files.length);
  console.log(`[clock-oracle] baseline rc=${base.rc} collected=${base.collected} failing_files=${base.failed.length} judge=${baseJudge.ok ? 'COMPLETE' : 'INCOMPLETE'}`);
  if (!baseJudge.ok) {
    for (const r of baseJudge.reasons) console.log('FAIL(基线趟): ' + r);
    console.log('  —— 基线没跑完 ⇒ 差集没有可信的参照系，直接停，不得拿"位移趟没多红"当结论');
    return 1;
  }
  if (base.failed.length) {
    console.log('  基线已红（与位移无关，不计入差集）：');
    for (const f of base.failed.slice(0, 20)) console.log('   - ' + f);
  }

  const moved = runVitest(files, { shiftMs, tag: 'moved' });
  const movedJudge = judgePass(moved, files.length);
  const active = /\[CLOCK-SHIFT\] active/.test(moved.stdout);
  console.log(`[clock-oracle] moved rc=${moved.rc} collected=${moved.collected} failing_files=${moved.failed.length} patch_active=${active} judge=${movedJudge.ok ? 'COMPLETE' : 'INCOMPLETE'}`);
  if (!movedJudge.ok) {
    for (const r of movedJudge.reasons) console.log('FAIL(位移趟): ' + r);
    console.log('  —— 位移趟最后 20 行原始输出（供归因，本身不作判据）：');
    for (const l of String(moved.stdout || '').split('\n').filter(Boolean).slice(-20)) console.log('   | ' + l.slice(0, 160));
    return 1;
  }
  if (!active) {
    console.log('FAIL: 位移那趟没打印 [CLOCK-SHIFT] active ⇒ 补丁没装上，"没有新增红"是假绿（本 oracle 自我失明）');
    return 1;
  }

  const baseSet = new Set(base.failed);
  const clockDependent = moved.failed.filter((f) => !baseSet.has(f)).sort();
  const knownSet = new Set(KNOWN_CLOCK_DEPENDENT);
  const fresh = clockDependent.filter((f) => !knownSet.has(f));
  const stale = KNOWN_CLOCK_DEPENDENT.filter((k) => !clockDependent.includes(k));

  console.log(`[clock-oracle] CLOCK_SHIFT_ONLY_FAILURES=${clockDependent.length} fresh=${fresh.length} stale_known=${stale.length}`);
  for (const f of clockDependent) console.log(`  ${knownSet.has(f) ? 'known' : 'NEW '} ${f}`);
  for (const f of stale) console.log(`  STALE-KNOWN（已不再随位移红，必须从清单删掉） ${f}`);

  if (fresh.length) {
    console.log('FAIL: 存在"只在时钟被推到未来后才红"的用例 = 引信。修法二选一：把夹具改成相对当下，'
      + '或把时钟显式注入被测方（先例 #3459 用 2020-01-01 固定时钟 + 1 小时前的素材）。');
    return 1;
  }
  if (stale.length) {
    console.log('FAIL: KNOWN 清单里有陈旧项 —— 清单只能缩小，缩小必须就地删。');
    return 1;
  }
  if (base.failed.length) {
    console.log('ORACLE_NOT_AUTHORITATIVE: 基线本身有红 ⇒ 只能说"位移没引入新红"，不能说"没有引信"。');
    return 0;
  }
  console.log('PASS: 位移 45 天后同一批用例零新增红 —— 该域内无"随墙上时钟老化"的用例。');
  return 0;
}

if (require.main === module) {
  let code = 0;
  try {
    code = main();
  } catch (e) {
    console.log('ERROR(clock-oracle 自身故障，与"发现引信"区分开): ' + e.message);
    code = 2;
  }
  process.exit(code);
}

module.exports = { collectCandidates, includeDirsFromConfig, ABS_RE, TIME_FORMS, KNOWN_CLOCK_DEPENDENT, TEST_SUFFIX, judgePass, missingCandidates, normalizeReportName, parseArgs };
