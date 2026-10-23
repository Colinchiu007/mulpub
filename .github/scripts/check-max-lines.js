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
 * 扫描域口径（不是磁盘域）：域 = git 索引内文件 ∪ 未被 .gitignore 排除的未跟踪文件，
 *   也就是 `git status` 与 CI 检出共同看的集合。动因：#3782（change bundle-untrack）把 5 个
 *   构建产物移出版本控制，其中 preload/index.bundle.js 与 home-shell-preload.bundle.js 既落在
 *   SCAN_DIRS 内又是 .js —— 旧的磁盘扫法让「本机刚跑过 build:preload」变成 NEW_OVER_LIMIT 假红，
 *   而 CI 的检出里根本没有这两个文件（两个域比一份账）。git 读数取不到时退出码 2 出声，
 *   不退回磁盘全量、不把空域当成「没有债」。
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
const { execFileSync } = require('child_process');
// 扫描域的实现只有一份：scripts/lib/git-domain.js（#3876 建立，本次收敛第二处消费者）。
// 为什么共享而不是各留一份：两个门禁比的是同一份账，域口径一分叉，症状就是「本机红 / CI 绿」。
// 六条语义（逐条有锁在 scripts/lib/git-domain.test.js）：不退回磁盘全量；不收窄成只看索引；
// 取不到读数一律抛错（调用方转退出码 2）；并集不是 check-ignore；路径相对 root；机器态会改域。
const { gitDomain } = require('../../scripts/lib/git-domain');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'max-lines-baseline.json');
// 与 scripts/check-debt-budget.js 保持同一扫描口径（用例里有字面量比对防漂移）
const SCAN_DIRS = ['apps/desktop/src', 'apps/desktop/electron', 'packages', 'ops-center/backend'];
const SOURCE_EXTS = ['.js', '.ts', '.vue', '.py', '.tsx', '.jsx', '.css', '.scss'];
const EXCLUDE = ['node_modules', 'dist', '.git', 'tests', 'test', '__tests__', 'dist-electron'];
const DEFAULT_LIMIT = 500;
const DEFAULT_GROWTH_ALLOWANCE = 200;

// M-7（超大文件棘轮只挡新增、不逼偿还）新增的两组常量。
//
// ① targets —— 点名还账。register 的 files 是「登记值 + 容差 200」的天花板，
//    也就是每个挂账文件都还能再胖 200 行。targets 把**指定文件**的天花板压到
//    登记值本身（容差 0）：谁被点名，谁从今天起一行都不能再涨。
//    取值必须 ≤ 当前登记值，否则一上线就红 —— 这不是 bug，是「先记下今天的位置」。
//
// ② 测试文件通道。此前 EXCLUDE 里的 'tests' / 'test' / '__tests__' 配合
//    `rel.includes(x)` 的**子串**匹配，把 .test.js / .spec.js 一并顺带排掉了
//    （'test' 是 'CreateView.test.js' 的子串）。结果是 1024 个测试文件全部门禁之外，
//    其中 102 个 >500 行、13 个 >1500 行，最长的 CreateView.test.js 6574 行 ——
//    比它所测的 CreateView.vue（5657 行）还长。这条通道给测试文件单列上限与
//    独立挂账表，不动源码侧的既有口径（新增而非改写，避免回归面）。
// 测试文件的扫描根比源码**多一个** apps/desktop/tests：源码侧不需要它（那里只有
// e2e/visual 夹具，不是受管源码），但 M-7 恰恰要把测试文件纳进视野，而当前最大的
// 几支测试文件（story2video-*、webview-manager）就在这个目录下。用源码的
// SCAN_DIRS 会让「测试文件进门禁」只覆盖内联测试、漏掉整个 tests/ 目录。
const TEST_SCAN_DIRS = SCAN_DIRS.concat(['apps/desktop/tests']);

// 点名还账的排除名单。
//
// 外部跨家族评审（opencode/deepseek）指出：首批 targets 里混进了**机器生成或随
// 业务例行增删**的文件，给它们 0 容差等于让门禁天天误红：
//   *.bundle.js         —— esbuild 产物，每次构建行数随依赖/API 变动，与手写行数无关
//   src/locales/*.js    —— i18n 词条表，任何一次新增文案都会让它变长
//   *.design-system.css —— 设计令牌表，同样随设计系统维护而变
// 这三类恰是 baseline 旧注释里「生成物行数随 API 变动、容差已被吃满」的同一批，
// 对它们设零增长容差与既有容差设计直接冲突（表现：任何一次 i18n 新增都让 CI 红）。
// 它们继续走「登记值 + 200」。
const TARGET_EXCLUDE_RE = [/\.bundle\.[cm]?js$/i, /(^|\/)src\/locales\//, /\.design-system\.css$/i];

// ⚠ targets 归属：目标值锚定在**设置那一刻的实际行数**，因此它会在「与设置无关的
//   PR」上触发。实测：设完 targets 后 main 上有人给 Collection.vue 加了 4 行，
//   于是下一个恰好开着的 PR（本 PR）被判红 —— 但那 4 行不是本 PR 加的。
//
//   处置原则：**漂移由漂移发生后第一个 rebase 的 PR 重新锚定**，而不是让无关 PR
//   替人背锅。重新锚定时必须 (a) 逐条列出漂移与方向、(b) 区分「变大」与「变小」——
//   目标值**高于**当前实际行数是危险的：那等于白送 (目标 - 当前) 行的免涨额度。
//   本 PR 实测：`PublishHistory.vue` 被 main 拆小了 16 行，若不重锚，
//   它就能在无人察觉的情况下再涨 16 行。
/** 是否可被点名还债（返回 false 的继续走登记值+200） */
function isTargetable(rel) {
  return !TARGET_EXCLUDE_RE.some((re) => re.test(rel));
}

const TEST_FILE_RE = /\.(test|spec)\./;
// 只挡真正的依赖与产物目录。**不能**在这里放 'test'/'tests' —— 那正是本次要放进来测的。
const TEST_SCAN_DIR_EXCLUDE = ['node_modules', 'dist', '.git', 'dist-electron'];
const DEFAULT_TEST_LIMIT = 1500;
const DEFAULT_TEST_GROWTH_ALLOWANCE = 200;


function walkDir(absDir, baseDir, out, domain) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const fp = path.join(absDir, e.name);
    const rel = path.relative(baseDir, fp).replace(/\\/g, '/');
    if (EXCLUDE.some((x) => rel.includes(x))) continue;
    // 目录照常递归（子目录里可能有域内文件）；只有「文件入不入表」受域约束，
    // 且判据放在读文件之前——不为被排除的产物付一次全文读取。
    if (e.isDirectory()) { walkDir(fp, baseDir, out, domain); continue; }
    if (!SOURCE_EXTS.includes(path.extname(e.name))) continue;
    if (!domain.has(rel)) continue;
    let lines = 0;
    // 读不到不等于「没有债」：登记 lines:null，由 main() 出声。原样 continue 会让
    // 「索引里有、磁盘已删」这一格完全静默（评审后端轴 W1 命中）。
    try { lines = fs.readFileSync(fp, 'utf8').split('\n').length; } catch (_) { out.push({ path: rel, lines: null }); continue; }
    out.push({ path: rel, lines });
  }
  return out;
}

/** 扫描测试文件（.test.* / .spec.*）。与源码扫描**并列而非替换**：源码侧的
 *  EXCLUDE 子串匹配保持原样，本函数只走 TEST_SCAN_DIR_EXCLUDE，
 *  因此不会把任何原先没被扫到的源码文件带进视野。 */
function scanTestFiles(rootDir, domainArg) {
  const root = rootDir || ROOT;
  const domain = domainArg || gitDomain(root);
  const out = {};
  const walk = (absDir) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const fp = path.join(absDir, e.name);
      if (e.isDirectory()) {
        if (TEST_SCAN_DIR_EXCLUDE.includes(e.name)) continue;
        walk(fp);
        continue;
      }
      if (!e.isFile()) continue;
      if (!TEST_FILE_RE.test(e.name)) continue;
      const rel = path.relative(root, fp).replace(/\\/g, '/');
      if (!domain.has(rel)) continue;
      let lines = 0;
      try { lines = fs.readFileSync(fp, 'utf8').split('\n').length; } catch (_) { continue; }
      out[rel] = lines;
    }
  };
  for (const d of TEST_SCAN_DIRS) walk(path.join(root, d));
  return out;
}

const hasKey = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

/** 扫描全部域内源文件，返回相对扫描根的路径 → 行数（读不到的不入表，由 main() 出声） */
function scanAllLines(rootDir, domain) {
  const out = {};
  for (const f of scanFiles(rootDir, domain)) if (f.lines !== null) out[f.path] = f.lines;
  return out;
}

/** 扫描全部域内源文件 → [{path, lines}]（内部原语，两个对外视图都基于它；读不到 = lines:null） */
function scanFiles(rootDir, domainArg) {
  const root = rootDir || ROOT;
  const domain = domainArg || gitDomain(root);
  const out = [];
  for (const d of SCAN_DIRS) walkDir(path.join(root, d), root, out, domain);
  return out;
}

/** 扫描结果 → 超限文件映射（键为相对扫描根的路径，与挂账清单同一坐标系） */
function collectOverLimit(rootDir, limit, domain) {
  const max = limit || DEFAULT_LIMIT;
  const files = {};
  for (const f of scanFiles(rootDir, domain)) {
    if (Number.isFinite(f.lines) && f.lines >= max) files[f.path] = f.lines;
  }
  return files;
}

function readBaseline(p) {
  const file = p || BASELINE_PATH;
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** 清单落盘：键按字典序排序，保证可复现（diff 只反映真实债务变化）。
 *  pruned 必须原样携带；M-7 起 testLimit / targets / testFiles / testPruned
 *  也必须携带 —— 这四个键一旦在 --update 时被漏掉，门禁会静默退回「只挡新增、
 *  测试文件全不管」的旧行为，且**不报任何错**（实测：跑一次 --update 四键全没）。
 *  这是典型的「删掉也不变红」变更，只能靠显式携带 + 回归锁挡住。
 */
function writeBaseline(files, meta, p) {
  const file = p || BASELINE_PATH;
  const m = meta || {};
  const sortedCopy = (obj) => Object.keys(obj || {}).sort().reduce((acc, k) => { acc[k] = obj[k]; return acc; }, {});
  const body = {
    '//': '超大文件挂账清单（audit-batch-4）。limit 之上的存量文件在此登记；新文件超限一律阻断。'
      + '还完债用 --prune <路径> 单键清账（会同时在 pruned 立碑）；'
      + '--prune-test <路径> 清测试账；'
      + '--update 仅做增量登记，--update --rewrite 才全量重生（会掩盖别人的漂移，需人工审 diff）。',
    limit: m.limit ? m.limit : DEFAULT_LIMIT,
    growthAllowance: m.growthAllowance ? m.growthAllowance : DEFAULT_GROWTH_ALLOWANCE,
    testLimit: Number.isFinite(m.testLimit) ? m.testLimit : DEFAULT_TEST_LIMIT,
    files: sortedCopy(files),
    targets: sortedCopy(m.targets),
    pruned: sortedCopy(m.pruned),
    testFiles: sortedCopy(m.testFiles),
    testPruned: sortedCopy(m.testPruned),
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
/**
 * 同 PR 重锚 targets（2026-10-23，change: maxlines-reanchor）。
 *
 * 背景：targets 是「点名还账」的零增长天花板，取值锚定设置那一刻的行数。
 * 于是任何**合法功能增长**都会撞 TARGET_GREW，而当时的处置是「由下一个 PR 重新锚定」。
 * 实测 2026-10-23：一次越线的功能改动（#4276）把 main 打红，全仓所有 PR 被判
 * STOP_MAIN_RED 挡住，最后由无关会话开 #4329 才修好 —— 把「谁引入、谁负责」变成了
 * 「谁碰上、谁背锅」。
 *
 * 现在的契约：**允许同一个 PR 在自己的 diff 里上调 targets，但只允许恰好锚定当前行数**。
 * 三条判据把「合法增长」与「偷偷放宽」分开：
 *   ① TARGET_BUMP_UNJUSTIFIED —— 上调了目标，但文件当前行数并未超过原目标（没有增长可解释这次上调）
 *   ② TARGET_BUMP_HEADROOM  —— 新目标 ≠ 当前行数（高出来的部分就是白送的免涨额度）
 *   ③ TARGET_REMOVED        —— 直接删掉某个目标（等于永久解除零增长约束）
 * 三条都只在**本 PR 改了 targets** 时才会命中，无关 PR 不受影响。
 */
function targetAudit (targets, baseInfo, linesOf, violations, notices) {
  // ⚠ 三档必须分清，合成夹具与真跑不能同形（2026-10-23 实测踩到）：
  //   undefined = 调用方**没有要求**做这次审计（合成夹具：G.evaluate(base, scanned, existing) 只传 3–4 个参）
  //              ⇒ 直接返回：不推 notice、不推 violation。
  //              漏掉这一档 ⇒ fail-closed 那条 violation 会在 **CI 里**（GITHUB_ACTIONS=true）
  //              落到每一条合成夹具用例上 ⇒ 整个测试文件在 CI 红、而本机全绿
  //              （实测：not ok 1「新代码阻断：超限且未挂账 → NEW_OVER_LIMIT」，2 !== 1）。
  //   null      = 调用方要求审计但**取不到 base**（真跑时读不到 base 提交）
  //              ⇒ CI 内 fail-closed（推 violation），本机推 notice。
  //   对象      = base 读到了 ⇒ 正常做三条判据。
  if (baseInfo === undefined) return;
  if (!baseInfo || !baseInfo.targets) {
    // 取不到 base 就无法判断「上调是否有增长支撑」。CI 里必须 fail-closed ——
    // 静默跳过等于给「偷偷放宽」开一条无人守门的通道；本地无 base 只提示。
    if (process.env.GITHUB_ACTIONS === 'true') {
      violations.push('TARGET_BASE_UNAVAILABLE: 取不到 base 的 targets 基线，无法校验本次是否在放宽零增长约束（CI 内 fail-closed）');
    } else {
      notices.push('本地无 base 基线，已跳过 targets 放宽校验（CI 会强制校验）');
    }
    return;
  }
  const before = baseInfo.targets;
  for (const rel of Object.keys(targets)) {
    const now = linesOf(rel);
    if (before[rel] === undefined) {
      if (now !== undefined && targets[rel] !== now) {
        violations.push('TARGET_BUMP_HEADROOM: ' + rel + ' 新增点名目标 ' + targets[rel]
          + ' ≠ 当前 ' + now + ' 行 —— 新目标必须恰好锚定当前行数，不给免涨额度');
      }
      continue;
    }
    if (targets[rel] > before[rel]) {
      if (!(now > before[rel])) {
        violations.push('TARGET_BUMP_UNJUSTIFIED: ' + rel + ' 目标从 ' + before[rel] + ' 上调到 ' + targets[rel]
          + '，但文件当前只有 ' + now + ' 行、并未超过原目标 —— 上调必须有实际增长支撑');
      } else if (targets[rel] !== now) {
        violations.push('TARGET_BUMP_HEADROOM: ' + rel + ' 目标 ' + targets[rel] + ' ≠ 当前 ' + now
          + ' 行 —— 上调只允许恰好等于当前行数（超出的部分就是白送的免涨额度）');
      }
    }
  }
  for (const rel of Object.keys(before)) {
    if (!hasKey(targets, rel)) {
      violations.push('TARGET_REMOVED: ' + rel + ' 的点名目标被删除 —— 删目标等于永久解除零增长约束');
    }
  }
}

/**
 * 从 base 提交读 targets 基线；取不到返回 null（由 targetAudit 决定 fail-closed）。
 *
 * ⚠ base 的取法**不能假定 `origin/main` 存在** —— 那是本仓 CI 的真实形态：
 * `actions/checkout@v4` 默认 `fetch-depth: 1` 且不建 origin/main 的远程跟踪 ref，
 * 于是 `git show origin/main:.github/scripts/max-lines-baseline.json` 在 runner 上
 * 必然失败 ⇒ targetAudit 永远拿不到 base ⇒ fail-closed 规则**永远红**。
 * 实测（2026-10-23，PR #4337）：主干上判 `TARGET_BASE_UNAVAILABLE`，
 * 而同一份代码在本机 rc=0 —— 差的就是这一个 ref。
 *
 * 取法（与 quality-gate.yml 的 Gate 2c3「base 必须取 merge-base」同族，回落方向是「更严」）：
 *   ① MP_BASE_REF（调用方显式给；CI 里由 workflow 算 merge-base 后传入）
 *   ② origin/main（本地开发的常规形态）
 *   ③ HEAD^1（CI 的 pull_request 事件检出的是 merge ref ⇒ 第一父即 base 分支头）
 *   ④ HEAD^（push 事件：squash 合并 = 单提交 ⇒ 上一提交即 base）
 * 四条都取不到 ⇒ 返回 null ⇒ fail-closed（不静默放行）。
 *
 * @returns {{targets: object, ref: string}|null}
 */
function readBaseTargets (rootDir, baseRef) {
  const candidates = [baseRef, 'origin/main', 'HEAD^1', 'HEAD^'].filter(Boolean);
  for (const ref of candidates) {
    try {
      const raw = execFileSync('git', ['-C', rootDir, 'show', ref + ':.github/scripts/max-lines-baseline.json'], { encoding: 'utf8' });
      const json = JSON.parse(raw);
      return { targets: json.targets || {}, ref };
    } catch (e) { /* 该 ref 取不到 ⇒ 试下一个 */ }
  }
  return null;
}

function evaluate(baseline, scanned, existing, testData, baseInfo) {
  const limit = baseline && Number.isFinite(baseline.limit) ? baseline.limit : DEFAULT_LIMIT;
  const allowance = baseline && Number.isFinite(baseline.growthAllowance)
    ? baseline.growthAllowance : DEFAULT_GROWTH_ALLOWANCE;
  const ledger = (baseline && baseline.files) || {};
  const pruned = (baseline && baseline.pruned) || {};
  const targets = (baseline && baseline.targets) || {};              // M-7 点名还账
  const testLedger = (baseline && baseline.testFiles) || {};         // M-7 测试文件挂账
  const testPruned = (baseline && baseline.testPruned) || {};
  const testLimit = baseline && Number.isFinite(baseline.testLimit)
    ? baseline.testLimit : DEFAULT_TEST_LIMIT;
  const all = existing && typeof existing === 'object' ? existing : scanned;
  const violations = [];
  const notices = [];
  const linesOf = (rel) => (hasKey(all, rel) ? all[rel] : scanned[rel]);
  targetAudit(targets, baseInfo, linesOf, violations, notices);

  for (const rel of Object.keys(scanned).sort()) {
    const lines = scanned[rel];
    // 点名还账优先于墓碑与登记：被 targets 点名的文件天花板 = targets 值，容差 0。
    if (hasKey(targets, rel) && isTargetable(rel)) {
      const ceiling = targets[rel];
      if (lines > ceiling) {
        violations.push('TARGET_GREW: ' + rel + ' 现 ' + lines + ' 行已超过点名目标 ' + ceiling
          + ' 行（超 ' + (lines - ceiling) + '）。被点名还账的文件一律零增长容差：'
          + '降到目标以下，或在 review 中说明理由后一并上调 targets');
      }
      continue;
    }
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

  // ── 测试文件通道（M-7）──────────────────────────────────────────────────
// 与源码用完全独立的上限与挂账表：测试文件天然比被测代码长（断言 + 夹具 + mock），
// 套用同一个 500 会逼出一堆无意义的拆分；但完全不管就出现了 6574 行的
// CreateView.test.js。故单列 testLimit，存量按同一套「登记 + 容差」模式接住。
//
// 走独立的第四个参数 testData（{scanned, all}），**不**往 existing 里塞魔法键——
// existing 是「路径→行数」映射，塞 `__tests__` 这种键会和真实文件重名。
  const testScanned = (testData && testData.scanned) || {};
  const testAll = (testData && testData.all) || testScanned;
  for (const rel of Object.keys(testScanned).sort()) {
    const lines = testScanned[rel];
    if (hasKey(testPruned, rel)) continue; // 测试文件的墓碑同理
    if (hasKey(testLedger, rel)) {
      const grown = lines - testLedger[rel];
      if (grown > DEFAULT_TEST_GROWTH_ALLOWANCE) {
        violations.push('TEST_LEDGER_GREW: ' + rel + ' 较登记值 ' + testLedger[rel]
          + ' 膨胀 ' + grown + ' 行（容差 ' + DEFAULT_TEST_GROWTH_ALLOWANCE
          + '），测试文件同样要拆（按被测模块/场景分文件），别再堆成一个');
      }
      continue;
    }
    if (lines >= testLimit) {
      violations.push('TEST_OVER_LIMIT: ' + rel + ' ' + lines + ' 行 >= ' + testLimit
        + '，测试文件超过上限。新增的超限测试不得进来；存量已挂账的按 TEST_LEDGER_GREW 管');
    }
  }
  for (const rel of Object.keys(testLedger).sort()) {
    if (!hasKey(testAll, rel)) {
      violations.push('TEST_STALE_LEDGER_ENTRY: ' + rel + ' 已不在测试文件扫描范围内（文件已删/改名），请 --prune-test ' + rel);
      continue;
    }
    if (testAll[rel] < testLimit) {
      violations.push('TEST_DEBT_REPAID: ' + rel + ' 已降到 ' + testAll[rel] + ' 行 < ' + testLimit
        + '，请 --prune-test ' + rel + ' 单键清账');
    }
  }

  return {
    violations,
    notices,
    results: {
      overLimitCount: Object.keys(scanned).length,
      ledgerCount: Object.keys(ledger).length,
      prunedCount: Object.keys(pruned).length,
      targetCount: Object.keys(targets).length,
      limit,
      allowance,
      testLimit,
      testOverLimitCount: Object.keys(testScanned).length,
      testLedgerCount: Object.keys(testLedger).length,
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
    testLimit: base && Number.isFinite(base.testLimit) ? base.testLimit : DEFAULT_TEST_LIMIT,
    files,
    // ↓ M-7：四个新键必须原样搬运。漏掉任何一个，--update 都会把它**静默**抹掉，
    //   而门禁对此毫无察觉（外圈评审实测：跑一次 --update 四键全没）。
    targets: (base && base.targets) || {},
    pruned,
    testFiles: (base && base.testFiles) || {},
    testPruned: (base && base.testPruned) || {},
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
  // targets 里的同名条目必须一起摘掉：留着会让这个文件今后被 0 容差盯着，
  // 而它已经还债降到 limit 以下 —— 一条永远命不中的点名目标 = 永久僵尸条目，
  // 且没人说得清它还在盯什么。外部跨家族评审（opencode/deepseek）指出的问题。
  if (hasKey(base.targets || {}, rel)) {
    after.targets = Object.keys(base.targets).reduce((acc, k) => { if (k !== rel) acc[k] = base.targets[k]; return acc; }, {});
  }
  if (hasKey(base.testFiles || {}, rel)) {
    after.testFiles = Object.keys(base.testFiles).reduce((acc, k) => { if (k !== rel) acc[k] = base.testFiles[k]; return acc; }, {});
  }
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
  // 域由 git 给（见 gitDomain）。取不到读数一律退出码 2，绝不退回磁盘全量——
  // 那正是被修的假红来源：本机构建过就红，而 CI 的检出里根本没有那些产物。
  let domain;
  try { domain = gitDomain(rootDir || ROOT); } catch (e) {
    console.log('❌ ' + (e && e.message ? e.message : String(e)));
    console.log('   门禁拒绝出结论：退出码 2 = 判据自身故障（与「发现违规」的 1 分开，混档等于把失明读成结论）。');
    process.exit(2);
  }
  if (!isJson) console.log('[max-lines] domain=' + domain.size + ' (git 索引 ∪ 未忽略的未跟踪文件)');
  // 一次扫描出两个视图：域内但读不到内容的路径（索引有、磁盘无，或读失败）必须点名，
  // 不能让它和「扫过了且没问题」在同一段输出里同形。
  const scanList = scanFiles(rootDir, domain);
  const all = {};
  for (const f of scanList) if (f.lines !== null) all[f.path] = f.lines;
  const unreadable = scanList.filter((f) => f.lines === null);
  // 只在 plain 档出声：--json 档里任何非 JSON 行都会把消费方炸掉（留痕锁只管第一行，挡不住这种）。
  if (unreadable.length && !isJson) {
    console.log('⚠️ 域内但读不到内容 ' + unreadable.length + ' 个（索引里有、磁盘上没有，或读失败）：'
      + unreadable.slice(0, 5).map((f) => f.path).join(', ') + (unreadable.length > 5 ? ' …' : ''));
  }
  const scanned = Object.keys(all).sort().reduce((acc, k) => { if (all[k] >= limit) acc[k] = all[k]; return acc; }, {});

  // M-7：测试文件走独立通道与独立上限，与源码扫描并列而非替换。
  const allTests = scanTestFiles(rootDir, domain);
  const testLimit = base && Number.isFinite(base.testLimit) ? base.testLimit : DEFAULT_TEST_LIMIT;
  const scannedTests = Object.keys(allTests).sort()
    .reduce((acc, k) => { if (allTests[k] >= testLimit) acc[k] = allTests[k]; return acc; }, {});

  const pruneTestIdx = args.indexOf('--prune-test');
  if (pruneTestIdx >= 0) {
    const rel = args[pruneTestIdx + 1];
    if (!rel || rel.startsWith('--')) {
      console.log('用法: node .github/scripts/check-max-lines.js --prune-test <相对路径>');
      process.exit(2);
    }
    const ledger = (base && base.testFiles) || {};
    if (!hasKey(ledger, rel)) {
      console.log('✗ 测试挂账清单里没有 ' + rel + '（可能已还清，或从未登记），不做墓碑');
      process.exit(2);
    }
    const cur = hasKey(allTests, rel) ? allTests[rel] : null;
    if (cur !== null && cur >= testLimit) {
      console.log('✗ ' + rel + ' 现 ' + cur + ' 行 >= ' + testLimit + '，测试债务未还清，不得清账');
      process.exit(2);
    }
    const after = Object.assign({}, base);
    after.testFiles = Object.keys(ledger).reduce((a, k) => { if (k !== rel) a[k] = ledger[k]; return a; }, {});
    after.testPruned = Object.keys(base.testPruned || {}).reduce((a, k) => { a[k] = base.testPruned[k]; return a; }, {});
    after.testPruned[rel] = cur === null ? ledger[rel] : cur;
    fs.writeFileSync(bp, JSON.stringify(after, null, 2) + '\n', 'utf8');
    console.log('✓ 已清测试账：' + rel + ' · 从 testFiles 移出 · testPruned 记为 ' + after.testPruned[rel] + ' 行');
    process.exit(0);
  }

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

  // 只在用默认基线时读 base：--baseline 覆盖（测试夹具）无法假定 base 提交里有同名文件。
  // --baseline 覆盖（测试夹具/--prune 等）时**没有 base 提交的概念** ⇒ 不做这次审计（undefined）；
  // 其余路径要求审计：读不到 base 时传 null ⇒ targetAudit 在 CI 内 fail-closed。
  const baseInfo = baselinePath ? undefined : (readBaseTargets(rootDir || ROOT, process.env.MP_BASE_REF || 'origin/main') || null);
  const { violations, notices, results } = evaluate(base, scanned, all, { scanned: scannedTests, all: allTests }, baseInfo);
  if (isJson) {
    console.log(JSON.stringify({ results, scanned, scannedTests, violations, notices, domainSize: domain.size }, null, 2));
  } else {
    console.log('=== 逐文件行数门禁 ===');
    console.log('limit=' + results.limit + ' growthAllowance=' + results.allowance
      + ' 超限文件=' + results.overLimitCount + ' 挂账=' + results.ledgerCount
      + ' 墓碑=' + results.prunedCount + ' 点名还账=' + results.targetCount);
    console.log('testLimit=' + results.testLimit
      + ' 测试超限=' + results.testOverLimitCount + ' 测试挂账=' + results.testLedgerCount);
    for (const v of violations) console.log('❌ ' + v);
    for (const n of notices) console.log('⚠️ ' + n);
    if (!violations.length) console.log('✅ 无新增超大文件，挂账清单与现实一致。');
  }
  process.exit(violations.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  scanFiles, scanAllLines, collectOverLimit, scanTestFiles, evaluate, readBaseline, writeBaseline, gitDomain,
  computeUpdate, pruneBaseline, readBaseTargets,
  DEFAULT_LIMIT, DEFAULT_GROWTH_ALLOWANCE, DEFAULT_TEST_LIMIT, DEFAULT_TEST_GROWTH_ALLOWANCE,
  SCAN_DIRS, SOURCE_EXTS, EXCLUDE, isTargetable,
};
