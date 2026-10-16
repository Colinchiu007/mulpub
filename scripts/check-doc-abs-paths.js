#!/usr/bin/env node
/**
 * check-doc-abs-paths.js — 文档绝对路径有效性门禁
 *
 * ## 为什么存在（#3000 的逃逸分析）
 *
 * 仓库根目录 2026-10-06 改名后，文档里的**绝对路径**不会跟着改，于是静默失效：
 * 运维手册里 `cd D:\...\<旧名>\apps\desktop` 照着敲必然失败。
 * 此前**没有任何门禁**检查「文档写的本机路径是否还存在」——
 * check-no-brand-residue.js 只管品牌词，不管路径有效性。
 *
 * ## 扫描范围：只查本次改动的文档（同 check-docs-sync.sh 的口径）
 *
 * 这是 2026-10-07 实测后的关键设计决定。最初版本扫全仓，实测检出 100+ 处"失效"，
 * 逐条核对后**绝大多数不是缺陷**：
 *   - 历史文档引用**已删除**的临时 worktree / `D:\Temp\` 临时产物
 *   - CI runner 路径（`C:\Users\RUNNER`）
 *   - 归档快照记录的当时事实
 * 要求把它们逐条"修好"等于**篡改历史**。
 *
 * 真正的缺陷类别只有一个：**有人改了这个文档，而文档里的路径是陈的**。
 * 这正是 `--base..--head` 改动集能精确覆盖的形态，也与同族门禁
 * `check-docs-sync.sh` 保持同一口径。`--all` 保留全量审计模式（人工用）。
 *
 * ## 判定口径（刻意保守，宁可漏报不可误伤）
 *
 * 只在同时满足下列**全部**条件时报红：
 *   1. 出现在**本次改动**的受管文档里（`--all` 时为全仓受管文档）
 *   2. 形如 Windows 本机绝对路径（盘符 + 冒号 + 斜杠）
 *   3. 该盘符**在本机真实存在**（非本机盘符无从判定，直接跳过）
 *   4. 不指向 CI runner 账号 / 云沙箱（那是别的机器的环境）
 *   5. 逐级 Test-Path 时，某一级在磁盘上确实不存在
 *
 * **不判红**的情况（各有回归测试锁住）：
 *   - 纯产品品牌名 / npm scope —— 品牌不是路径
 *   - Linux 部署路径 `/opt/...` `/srv/...`、云沙箱 `/sessions/...` —— 非本机
 *   - 占位符路径（`<cdpPort>`、`${VAR}`、`*`、`...`）——判据只看**路径串自身**含不含这些记号；
 *     整行里别处出现（例如 Markdown 加粗的那个 `*`）**不构成豁免**
 *   - 归档快照目录（记录的是当时事实）
 *
 * ## 三个实测踩坑（改这块代码前必读）
 *
 * 1. **盘符根必须用 `'D:' + path.sep`**，不能写 `'D:'.replace(/:$/, path.sep)`——
 *    后者产出**两字符** `D\`（replace 把冒号一起吃掉了），后续 path.join 拼出
 *    `\Data\...` 这类无盘符相对路径，existsSync 恒 false → 全量误报。
 * 2. **路径段不能贪心吞标点**。早期用宽松的 `[^\\/:*?"<>|\r\n]+` 收段，会把
 *    `D:\...\ops-center`。截。整句吞成一个路径。段字符集必须排除中文句读。
 * 3. **`--root` 必须同时认 `--root=X` 与 `--root X`**。只认等号形式时，
 *    空格形式会被静默忽略 → 扫到**真实仓库**而不是 fixture，所有自测假红。
 *
 * ## 用法
 *
 *   node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD
 *   node scripts/check-doc-abs-paths.js --all --root=<dir>      # 全量审计（人工）
 *
 * exit 0 = 通过；exit 1 = 检出失效路径（明细写 stderr）。
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ---- CLI ----
// 同时接受 `--root=X` 与 `--root X` 两种形式（见文件头「实测踩坑 3」）。
const argv = process.argv.slice(2);
let root = path.join(__dirname, '..');
let base = null;
let head = 'HEAD';
let all = false;
let writeBaseline = false;
let simulateNoDrives = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => {
    const v = argv[i + 1];
    if (v === undefined) {
      process.stderr.write(`[check-doc-abs-paths] ${a} 缺少取值\n`);
      process.exit(2);
    }
    i += 1;
    return v;
  };
  if (a.startsWith('--root=')) root = path.resolve(a.slice('--root='.length));
  else if (a === '--root') root = path.resolve(next());
  else if (a.startsWith('--base=')) base = a.slice('--base='.length);
  else if (a === '--base') base = next();
  else if (a.startsWith('--head=')) head = a.slice('--head='.length);
  else if (a === '--head') head = next();
  else if (a === '--all') all = true;
  else if (a === '--write-baseline') writeBaseline = true;
  else if (a === '--simulate-no-drives') simulateNoDrives = true;
  else if (a === '--help' || a === '-h') {
    process.stdout.write(
      '用法: node scripts/check-doc-abs-paths.js [--base=<ref> --head=<ref>] [--all] [--root=<dir>] [--write-baseline]\n' +
      '退出码: 0=合规 / 1=发现失效路径或基线被走差 / 2=自身故障（参数缺值、基线读不到或非法）\n'
    );
    process.exit(0);
  }
}

// ---- 受管范围 ----
const SCAN_ROOTS = ['01-docs', 'docs', 'openspec', '.github', 'scripts', '.hermes', '.ccg'];
const SCAN_EXTS = new Set(['.md', '.sh', '.ps1', '.js', '.yml', '.yaml', '.json']);
const SCAN_EXCLUDE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'dist-electron', 'coverage',
  '.playwright-browsers', 'build', '.next',
]);
// 归档快照：记录当时事实，改写即篡改历史
const ARCHIVE_DIR_PATTERNS = [
  /(^|\/)openspec\/changes\/archive\//,
  /(^|\/)\.ci-forensics\//,
  /(^|\/)\.plan\//,
  /(^|\/)01-docs\/retros\//,
  /(^|\/)01-docs\/archive\//,
  /(^|\/)\.adversarial\//,
  /(^|\/)\.workbuddy\//,
];

// ---- 本机绝对路径：盘符 + 冒号 ----
// 必须排除 POSIX 绝对路径（/opt、/srv、/sessions…）与 URL（https://、file:///）。
// 关键判据：盘符**后紧跟**冒号+斜杠，且冒号前只有一个 ASCII 字母。
//
// 段字符集必须排除中文句读（见文件头「实测踩坑 2」）：早期用宽松的
// `[^\\/:*?"<>|\r\n]+` 收段，会把 `D:\...\ops-center`。截。整句吞成一个路径。
const WIN_SEG = '[A-Za-z0-9 _.\\-\\u4e00-\\u9fff]';
// 段内允许的成对包裹符（Markdown 行内代码 / 括号包裹路径片段）
const WRAP_TAIL = [
  '`[^`]*`',
  '\\([^)]*\\)',
  '（[^）]*）',
  '\\[[^\\]]*\\]',
].join('|');
const SEG = `(?:${WRAP_TAIL}|${WIN_SEG}+)`;
const WIN_ABS_RE = new RegExp(
  `(^|[^\\w])((?:[A-Za-z]:[\\\\/](?:${SEG}[\\\\/])*${SEG}))`,
  'g'
);

// 占位符 / 变量 / 通配符：静态无法判定，一律跳过。
// ⛔ 只能对**提取出来的路径串**用这个判据，绝不能对整行用（2026-10-14 实测的洞：
// 词表里的裸星号会把"加了粗的那一行"整行豁免掉）。
const PLACEHOLDER_RE = /<[^>]*>|\$\{[^}]*\}|\$[A-Za-z_]\w*|\*|\.\.\./;

// 非本机路径：CI runner 账号 / 云沙箱。这些写在文档里是**记录别的机器的环境**，
// 按本机 Test-Path 判定必然误报（2026-10-07 实测：`C:\Users\RUNNER` 在本机
// C: 存在，于是被判"失效"，实为 CI runner 账号）。
const NON_LOCAL_PATH_RE =
  /^[A-Za-z]:[\\/]Users[\\/](?:RUNNER|runneradmin|runner|Administrator|administrator)[\\/]/i;

function looksLikeRealPath (frag) {
  // 冒号后必须紧跟斜杠（`C:/` 或 `C:\`），否则不是路径（排除 `C: 是分区符`、`A:1 比例`）
  if (!/^[A-Za-z]:[\\/]/.test(frag)) return false;
  // 非本机环境（CI runner 账号 / 云沙箱）不是本机路径，无从判定
  if (NON_LOCAL_PATH_RE.test(frag)) return false;
  return true;
}

/**
 * 本机真实存在的盘符集合。
 *
 * CI runner 上不存在 `D:`，若对非本机盘符也做判定，任何 `D:\...` 都会被判"失效"
 * ——纯环境噪声。只认本机盘符：无法判定 ≠ 失效。
 */
function existingDriveRoots () {
  const roots = new Set();
  for (const d of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
    for (const sep of ['\\', '/']) {
      try {
        if (fs.existsSync(d + ':' + sep)) roots.add(d.toUpperCase() + ':');
      } catch { /* 探测失败即视为不存在 */ }
    }
  }
  return roots;
}

function isArchived (relPath) {
  const norm = relPath.split(path.sep).join('/');
  return ARCHIVE_DIR_PATTERNS.some((re) => re.test(norm));
}

/** 该路径是否属于受管文档 */
function isManagedDoc (relPath) {
  const norm = relPath.split(path.sep).join('/');
  if (isArchived(norm)) return false;
  if (!SCAN_EXTS.has(path.extname(norm).toLowerCase())) return false;
  return SCAN_ROOTS.some((r) => norm === r || norm.startsWith(r + '/'));
}

/**
 * 逐级判定路径在本机是否存在；返回第一级缺失的相对片段，无缺失则 null。
 *
 * 只对**本机存在的盘符**判定（见 existingDriveRoots）；非本机盘符一律返回 null。
 */
function firstMissingSegment (frag, driveRoots) {
  const drive = frag.slice(0, 2).toUpperCase();
  if (!driveRoots.has(drive)) return null;

  const norm = frag.replace(/\//g, path.sep);
  const parts = norm.split(path.sep).filter(Boolean); // ['D:', 'Data', ...]
  // 盘符根必须是 `'D:' + path.sep`（三字符 `D:\`）——见文件头「实测踩坑 1」。
  let cur = parts[0] + path.sep;
  if (!fs.existsSync(cur)) return parts[0];
  for (let i = 1; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    if (!fs.existsSync(cur)) return parts.slice(0, i + 1).join('/');
  }
  return null;
}

function collectAllManaged () {
  const out = [];
  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // 该根未启用，不是错误
    }
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const rel = relDir ? path.join(relDir, e.name) : e.name;
      if (e.isDirectory()) {
        if (SCAN_EXCLUDE_DIRS.has(e.name)) continue;
        walk(abs, rel);
      } else if (SCAN_EXTS.has(path.extname(e.name).toLowerCase())) {
        if (isManagedDoc(rel)) out.push(rel);
      }
    }
  };
  for (const r of SCAN_ROOTS) walk(path.join(root, r), r);
  return out;
}

/** 本次改动的文件（--base..--head），与 check-docs-sync.sh 同口径 */
function collectChanged (baseRef, headRef) {
  let out;
  try {
    out = execFileSync('git', ['diff', '--name-only', `${baseRef}..${headRef}`], {
      cwd: root,
      encoding: 'utf8',
    });
  } catch {
    // 取证失败必须 fail-closed：回退到全量审计口径，不静默放过
    process.stderr.write(
      `[check-doc-abs-paths] git diff ${baseRef}..${headRef} 取证失败，回退到全量审计口径\n`
    );
    return collectAllManaged();
  }
  return out.split(/\r?\n/).filter(Boolean).filter(isManagedDoc);
}

// ---- 存量基线（按文件计数，只能缩小）--------------------------------------------
// 为什么要有它：豁免判据从"整行"收到"路径词元"之后，全量报错项 539 → 861（净新增 276，
// 散在 168 个文件，`01-docs/learnings.md` 一家独占 26）。**这两个数是"收紧那一刻新暴露的差量"，
// 不是账本规模**——账本当前含 432 个文件 / 866 处（re-sync 把 main 带进来的 3 个文件如实记入）。
// 这些绝大多数是**别人写下的历史留痕**
// （已删除的临时 worktree、当时的竞品目录……），而日常阻断口径是"改动集里的整份文件"——
// 只收紧不管存量，等于让每个碰 learnings 的会话都被 26 条历史行判红。
// 三条同时成立的口径：① 变多即红；② 变少也必须红（否则基线变成永久豁免，"只能缩小"就没人守）；
// ③ 基线里的文件不在扫描域 ⇒ 陈旧登记红。读不到/非法 ⇒ 退出码 2，既不判 0 也不判 1。
// ---- 外部评审（PR #3583 QM-6 两把轴）命中的四个判据，全部抽成可单测的纯函数 ----

/**
 * 账本键归一。**不能**用 `path.sep`：判据读的是账本里的字符串，而账本是在某台机器上写的，
 * 读它的人可能在另一个 OS 上（axis1c F9）。Linux 下 `split('/')` 对 `01-docs\a.md` 是恒等映射，
 * 那条键于是永不等于扫描域里的路径 ⇒ 报"陈旧登记"误红——一个纯粹由调用方 OS 决定的假违规。
 */
function normalizeBaselineKey (f) {
  return String(f).split(/[\\/]/).join('/');
}

/**
 * 词元尾部的**成对**强调记号（`**` / `__`）在 Markdown 里是闭合包裹，不是路径的一部分；
 * 而单个 `*` 是通配。区分二者是 F3c 的关键：`**D:\...\gone**` 若不剥掉尾部 `**`，
 * 裸星号规则就会替这条路径作保——与本轮修掉的洞同形，只是"紧贴路径"而不是"同行别处"。
 *
 * 只在**前导记号紧邻路径**时才剥（`**path**` 的形状）。实测理由：真仓库里存在
 * `…C:\Users\x`，**映射完全正常**` 这种"后一句话的星号被吸进词元"的形状（当场数到 1 处），
 * 它的前导并不以星号结尾；无条件剥尾星会把它的豁免面改掉，属于用一个洞换另一个洞。
 */
function stripPairedEmphasis (prefix, token) {
  const tail = /([*_]{2,})$/.exec(token);
  if (!tail) return token;
  const run = tail[1];
  if (!prefix.endsWith(run)) return token;
  return token.slice(0, token.length - run.length);
}

/** 数一批文本行里**命中了多少条** Windows 绝对路径（一行两条算两条）。不依赖盘符。 */
function countUnjudged (lines) {
  let n = 0;
  for (const line of lines || []) {
    WIN_ABS_RE.lastIndex = 0;
    let m;
    while ((m = WIN_ABS_RE.exec(line)) !== null) {
      if (looksLikeRealPath(m[2])) n += 1;
    }
  }
  return n;
}

/**
 * `--write-baseline` 的准入判定。两种拒绝各挡一条实测过的旁路：
 * - `!all`：窄域（改动集）跑一次会把整张账本按那一两个文件重写掉（先例：某门禁的 --update 抹掉别的域）。
 * - `!canJudge`：无盘符环境下现场计数**恒 0**，重写会把账本写成 `{"files":{}}` 并且**退出码 0**
 *   （axis1c F1）——一次"成功"的重写让门禁失去全部豁免面，与"门禁瞎了"读成结论同型。
 */
function judgeWriteBaseline ({ all, canJudge }) {
  if (!all) {
    return {
      verdict: 'refuse',
      why: '--write-baseline 必须搭配 --all —— 窄域（改动集）跑一次会把整张账本按那一两个文件重写掉'
    };
  }
  // 曾经这里还有一条 `!canJudge ⇒ 拒写`（axis1c F1），前提是「无盘符时现场计数恒 0」。
// 计数口径之后该前提不再成立（计数不再问文件系统），于是那条拒绝会**误伤**在 Linux 上正常生成账本的动作，
// 故删除；`!all` 那条仍然保留——窄域重写抹掉整张账本的风险与盘符无关。
  return { verdict: 'write', why: '' };
}

/** 跳过说明：PASS 与 FAIL 两个分支都必须拼上（axis1c F2 实测原实现只拼了 PASS）。 */
function formatSkipNote (canJudge) {
  return canJudge ? '' : '；本机无盘符 ⇒ 存在性核对未执行（计数判定照常执行，这正是口径换代的目的）';
}

const BASELINE_REL = 'scripts/doc-abs-paths-baseline.json';
// 账本口径版本。**判据代码是唯一真源**：账本里的 metric 与之不符即自身故障（退出码 2）。
// 存在性口径（dead_abs_paths_v1，只计盘上不存在者）在 ubuntu runner 上现场计数恒 0 ⇒
// 与账本比较两个方向都不可能红（实测读数：无从判定 1094 条 + PASS）。
// 计数口径（all_abs_paths_v2）把判据输入换成纯文本，于是它与机器有没有盘符无关。
const METRIC_VERSION = 'all_abs_paths_v2';
const BASELINE_NOTE = 'Gate 12c 的存量基线：按文件记录「本机绝对路径出现」的处数（与路径是否还存在无关）。只能缩小，不得为容忍新增而调大。';
const BASELINE_REASON_INITIAL = 'PLACEHOLDER_RE 由整行收紧到路径词元后新暴露的存量（2026-10-14 实测 539→861）';

function baselinePath () {
  return path.join(root, BASELINE_REL);
}

/**
 * 账本文本 → Map。**唯一实现**：工作树那份与 base 提交里那份必须走同一套解析与校验，
 * 否则两份口径会漂移（"base 处读得通、head 处读不通"这种漂移表现为把正当 re-sync 判成放宽）。
 * 返回 { map, error }；error 非空即"自身故障"，调用方一律走退出码 2，不得读成任何一种结论。
 */
function parseBaselineText (raw, label, opts) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    return { map: null, error: `${label} JSON 非法：${e.message}` };
  }
  if (!j || typeof j !== 'object' || !j.files || typeof j.files !== 'object') {
    return { map: null, error: `${label}结构不符（需 { files: { "<路径>": <非负整数> } }）` };
  }
  // 口径版本：head 侧必须逐字等于判据代码里的 METRIC_VERSION；不符即"自身故障"档，
  // **既不判 PASS 也不判 FAIL** —— 拿一代的计数去比另一代的账本，两种结论都没有依据。
  // base 侧关掉这条校验（requireMetric:false），它的 metric 只用于识别"换代发生了"。
  const requireMetric = !opts || opts.requireMetric !== false;
  if (requireMetric && j.metric !== METRIC_VERSION) {
    return { map: null, error: `${label}口径版本不符：账本 metric=${JSON.stringify(j.metric)}，本判据 METRIC_VERSION=${JSON.stringify(METRIC_VERSION)}` };
  }
  const metric = j.metric === undefined ? "dead_abs_paths_v1" : j.metric;
  const map = new Map();
  for (const [f, c] of Object.entries(j.files)) {
    if (!f || typeof c !== 'number' || !Number.isInteger(c) || c < 0) {
      return { map: null, error: `${label}条目非法：${JSON.stringify(f)} = ${JSON.stringify(c)}` };
    }
    map.set(normalizeBaselineKey(f), c);
  }
  return { map, error: null, metric };
}

/** 返回 { map, absent, error }。absent=账本还没建（按"空基线"从严），error=自身故障。 */
function loadBaseline (opts) {
  // requireMetric 默认开。唯一该关掉的时候是 `--write-baseline`：那次它马上要被整份覆盖，
  // 而 v1→v2 的迁移**必须**从一份没有 metric 的旧账本开始 —— 强校验会把迁移这条路自己焊死
  // （实测：`--all --write-baseline` 在 v1 账本上直接 rc=2，守卫拒绝执行它自己要求的那次迁移）。
  const requireMetric = !opts || opts.requireMetric !== false;
  const p = baselinePath();
  if (!fs.existsSync(p)) return { map: new Map(), absent: true, error: null };
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    return { map: null, absent: false, error: '读不到基线文件：' + e.message };
  }
  const r = parseBaselineText(raw, '基线', { requireMetric });
  if (r.error) return { map: null, absent: false, error: r.error };
  // requireMetric 已在 parse 里强校验过 ⇒ 这里必然是当代口径
  return { map: r.map, absent: false, error: null, metric: r.metric };
}

/**
 * 读 **base 提交里**那份账本（放宽检测的另一边）。
 * 返回 { map, missing, error }：
 * - missing=true：base 处还没有这份账本（本 PR 是首次引入）⇒ 调用方跳过放宽检测并**出声**，
 *   这不是故障，硬判 2 等于把"第一次落地"当成"门禁坏了"。
 * - error：base 引用本身无效 / 解析失败 ⇒ 自身故障（退出码 2）。
 * 走 execFileSync 直传参数（不经 shell）：Git Bash 会把 `ref:path` 改写成 `ref;path`，
 * 那会让"路径不存在"与"参数被吃掉"两种形状完全同形（本仓实测踩过）。
 */
function loadBaselineAt (ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: root, stdio: 'pipe'
    });
  } catch {
    return { map: null, missing: false, error: `base 引用 ${JSON.stringify(ref)} 不是有效提交` };
  }
  let raw;
  try {
    // stderr 必须自己接住：execFileSync 默认 **inherit** stderr，那会让 git 的
    // `fatal: path … exists on disk, but not in …` 直接混进门禁自己的输出，
    // 读日志的人会把它当成判据的结论（本仓口径：判据只认自己打出的行）。
    raw = execFileSync('git', ['show', `${ref}:${BASELINE_REL}`], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    const msg = String((e && e.stderr) || (e && e.stdout) || (e && e.message) || '');
    // 两种措辞说的是同一件事"该路径在那个提交里不存在"，都必须走 missing（=首次引入，跳过放宽检测）：
    //   `fatal: path 'x' does not exist in 'rev'`（盘上也没有）
    //   `fatal: path 'x' exists on disk, but not in 'rev'`（盘上有、那个提交里没有 ⇒ 正是本 PR 的形状）
    // 只认前一种会把"账本第一次落地"读成"门禁自身故障"（2026-10-14 真仓库第一跑实测踩中，退出码 2）。
    if (/does not exist in|exists on disk, but not in/i.test(msg)) {
      return { map: new Map(), missing: true, error: null };
    }
    return { map: null, missing: false, error: `读不到 base 处的账本：${msg.split(/\r?\n/)[0]}` };
  }
  // base 侧**不**校验 metric：换代 PR 里 base 就是上一代，强校验等于把迁移这件事本身判成故障。
  const r = parseBaselineText(raw, 'base 处账本', { requireMetric: false });
  if (r.error) return { map: null, missing: false, error: r.error };
  return { map: r.map, missing: false, error: null, metric: r.metric };
}

/**
 * 纯函数：账本自己有没有被**放宽**。
 * 判据只需要 git 对象，不需要盘符 ⇒ 这是 Gate 12c 第一条在 ubuntu CI 上也真实生效的写侧判据。
 *
 * 安全条件只有一个：某个键的计数上涨（含新增键）时，那份文档必须**不在本 PR 的改动集里**。
 * 理由是"计数只能反映那份文档里的条数"——blob 逐字不变就不可能由作者制造上涨，
 * 上涨只可能来自"本分支的 base 落后于该文档所在的提交"，即正当 re-sync 的形状。
 * 反过来，作者碰过那份文档、又把它的数调大，就是**用自己的红喂账本**：
 * `--all --write-baseline` 无差别抓现场，跑一次就能把"超出存量基线"的红抹掉。
 *
 * - widened：非空即 FAIL（退出码 1）。
 * - attributedToBase：放行，但**必须出声列出**——AGENTS 要求"接受漂移须在 PR 说明"，
 *   不列出来，下一个会话就分不清"正当 re-sync"与"投毒"。
 * - tightened：计数下降与删键，一律放行（这正是这条门禁想要的成果，判红只会逼人绕开守卫）。
 */
function judgeLedgerDrift ({ prev, next, changedDocs, prevMetric, nextMetric }) {
  const widened = [];
  const attributedToBase = [];
  const tightened = [];
  const generationChange = [];
  // 口径换代那一次逐文件计数不可比（同一批命中少了一个过滤器，只会 ≥）。
  // 这条豁免不是"改个字符串就能拿到"：head 侧 metric 必须等于判据代码里的 METRIC_VERSION
  // （parseBaselineText 强校验，不符即退出码 2），所以想第二次走这条路必须先回到上一代再回来，
  // 而那会在别的 PR 上先红 —— 换代按构造只能发生一次。
  const generation = prevMetric !== nextMetric;
  for (const [file, to] of next) {
    const from = prev.has(file) ? prev.get(file) : 0;
    if (to > from) {
      if (generation) generationChange.push({ file, from, to });
      else if (changedDocs.has(file)) widened.push({ file, from, to });
      else attributedToBase.push({ file, from, to });
    } else if (to < from) {
      tightened.push({ file, from, to });
    }
  }
  for (const [file, from] of prev) {
    if (!next.has(file)) tightened.push({ file, from, to: 0 });
  }
  return { widened, attributedToBase, tightened, generationChange };
}

/**
 * 纯函数：把"现场计数"与"基线"对账，给出三类违规。
 * 抽出来的理由：`canJudge=false` 那一支（无本机盘符的 runner）在本机永远走不到，
 * 留在 main 里就等于一条**没人跑过**的分支——而它恰恰决定 CI 上是恒红还是恒绿。
 * 现在它可以直接喂参数单测（见 check-doc-abs-paths.test.js 的"基线对账纯函数"三条）。
 *
 * - canJudge=false：**不做**逐文件计数比较（无盘符时现场计数恒 0，比较会把整张账本报成"待收紧"
 *   ⇒ 门禁在 runner 上永久红，比它挡的问题更糟），但仍然核对陈旧登记（文件在不在是跨平台事实）。
 * - over：变多 ⇒ 新增失效路径。
 * - shrink：变少 ⇒ 基线须收紧（"只能缩小"必须有人守，否则豁免永久化）。
 * - stale：账本里的文件已不在扫描域（删除 / 移出受管范围）。
 */
function judgeBaseline ({ counts, baseline, domain, canJudge }) {
  const over = [];
  const shrink = [];
  const stale = [];
  // 计数与盘符无关 ⇒ 这一支**不得**再被 canJudge 包住（结构锁盯着这一点，行为锁在自测里）。
  // canJudge 只决定「存在性明细能不能报」，见 main() 里的分支；它不再决定判不判。
  for (const f of domain) {
    const n = counts.has(f) ? counts.get(f).length : 0;
    const b = baseline.get(f) || 0;
    if (n > b) over.push({ file: f, n, b, list: counts.get(f) || [] });
    else if (n < b) shrink.push({ file: f, n, b });
  }
  for (const f of baseline.keys()) {
    if (!domain.has(f)) stale.push({ file: f });
  }
  return { over, shrink, stale, judged: canJudge };
}

/**
 * 把「文件 → 该文件的失效路径明细」写成账本。
 * ⛔ 存的必须是**条数**而不是明细本身：行号会随别人插行漂移，键漂移就等于账本对不上现场。
 */
function serializeBaseline (found, prev) {
  const files = {};
  for (const f of [...found.keys()].sort()) files[f] = found.get(f).length;
  return JSON.stringify({
    note: BASELINE_NOTE,
    // 首次生成写当天；之后再写**保留原值**——否则每天跑一次账本就多一处无意义 diff，
    // "重写必须幂等"这条锁也就永远立不住。
    metric: METRIC_VERSION,
    generated: (prev && prev.generated) || new Date().toISOString().slice(0, 10),
    reason: (prev && prev.reason) || BASELINE_REASON_INITIAL,
    files,
  }, null, 2) + '\n';
}

function scanFile (relPath, driveRoots) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, relPath), 'utf8');
  } catch {
    return [];
  }
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    WIN_ABS_RE.lastIndex = 0;
    let m;
    while ((m = WIN_ABS_RE.exec(line)) !== null) {
      const frag = m[2];
      if (!looksLikeRealPath(frag)) continue;
      // 豁免只看**这条路径自己的词元**，不看整行。
      // 词元 = 从片段起点延伸到下一个空白为止的那一串（含包裹它的反引号、后面的全角标点等）。
      // 为什么不直接用 frag：`*`、`<...>`、`${}` 这些记号**根本不在 SEG 字符集里**，
      // 提取器会在它们之前截断，于是"路径自身含占位符"这个判断对 frag 恒为假——
      // 只看 frag 会把 `D:\...\mp-*\apps` 这类通配路径判成失效（实测：两条既有豁免用例当场红）。
      // 为什么不能退回 `test(line)`：词表里有一条**裸星号**，而 Markdown 加粗就是星号，
      // 于是"这行加了粗"＝整行绝对路径全部免判（2026-10-14 实测：全域含 Windows 绝对路径的
      // 行 961，命中星号 281，其中仅因星号被豁免且路径确实不存在的有 179 行；
      // 本仓自己的执行记录就靠这个洞躲过一次判定）。
      const tokenStart = m.index + m[1].length;
      const tokenEnd = (() => {
        let e = tokenStart;
        while (e < line.length && !/\s/.test(line[e])) e += 1;
        return e;
      })();
      // 先剥**成对包裹**的强调记号再判占位符：`**D:\...\gone**` 的尾部 `**` 是 Markdown 闭合，
      // 不是通配符。不剥 ⇒ 词表里那条裸星号继续替这条路径作保（外部评审 axis1c F3c，
      // 当场用五文件夹具复现：同批里裸路径被照报、加粗包裹的那条被豁免）。
      const token = stripPairedEmphasis(line.slice(0, tokenStart), line.slice(tokenStart, tokenEnd));
      if (PLACEHOLDER_RE.test(token)) continue;
      // 口径换代：无条件记一条。**存在性只是附加信息，不再是入域条件。**
      // 旧实现把 `if (missing)` 当作入域闸门，而 missing 在 Linux 上恒 null ⇒ 整份扫描恒空。
      const missing = firstMissingSegment(frag, driveRoots);
      findings.push({
        file: relPath.split(path.sep).join('/'),
        line: i + 1,
        path: frag,
        missing,
      });
    }
  }
  return findings;
}

/** 扫描一批文件，返回 `文件 -> 该文件的失效路径明细[]`（只含有命中的文件）。 */
function findingsByFile (files, driveRoots) {
  const map = new Map();
  for (const rel of files) {
    const list = scanFile(rel, driveRoots);
    if (list.length) map.set(rel.split(path.sep).join('/'), list);
  }
  return map;
}

function main () {
  // 基线读不到 ⇒ 自身故障（退出码 2）。**既不得判 0（"没问题"）也不得判 1（"发现失效路径"）**——
  // 把"门禁瞎了"读成任何一种结论，都是给自己造假证据。
  const bl = loadBaseline({ requireMetric: !writeBaseline });
  if (bl.error) {
    process.stderr.write(
      `[check-doc-abs-paths] 自身故障：${bl.error} ⇒ 既不判 PASS 也不判 FAIL（退出码 2，与"发现失效路径"的 1 分开）\n`
    );
    return 2;
  }
  const baseline = bl.map;
  const baselineMetric = bl.metric;
  const scopeAll = all || !base;
  let driveRoots = existingDriveRoots();
  // --simulate-no-drives：把"这台机器没有盘符"这一档变成**可在任何机器上复现**的入参。
  // 没有它，ubuntu runner 那一支在 Windows 上永远测不到（与"可配置维度必须本机复现"同族纪律）。
  if (simulateNoDrives) driveRoots = new Set();

  // ---- 账本重写（唯一合法的生成入口）----
  if (writeBaseline) {
    const wb = judgeWriteBaseline({ all, canJudge: driveRoots.size > 0 });
    if (wb.verdict === 'refuse') {
      process.stderr.write(`[check-doc-abs-paths] 自身故障：${wb.why}\n`);
      return 2;
    }
    const allFiles = collectAllManaged();
    const found = findingsByFile(allFiles, driveRoots);
    let prev = null;
    try {
      const j = JSON.parse(fs.readFileSync(baselinePath(), 'utf8'));
      prev = { generated: j.generated, reason: j.reason };
    } catch { /* 首次生成或被人工删过：用默认值 */ }
    const total = [...found.values()].reduce((s, l) => s + l.length, 0);
    const added = [...found.keys()].filter((f) => !baseline.has(f));
    const gone = [...baseline.keys()].filter((f) => !found.has(f));
    const moved = [...found.keys()].filter((f) => baseline.has(f) && baseline.get(f) !== found.get(f).length);
    // 生成的账本落在 scripts/ 下；fixture 或首次生成时那个目录可能不存在（实测 ENOENT：
    // 取消 !canJudge 拒绝之前这段代码从没被走到过，所以这个前提一直是隐性的）。
    fs.mkdirSync(path.dirname(baselinePath()), { recursive: true });
    fs.writeFileSync(baselinePath(), serializeBaseline(found, prev));
    process.stderr.write(
      `[check-doc-abs-paths] 基线已重写：扫描域 ${allFiles.length} 个受管文件 / ` +
      `有失效路径的文件 ${found.size} 个 / 总处数 ${total}；` +
      `新增 ${added.length}、消失 ${gone.length}、计数变化 ${moved.length}\n`
    );
    return 0;
  }

  // ---- 判定 ----
  // 未给 --base 时不做改动集口径（全量审计），避免"看起来在查其实没查"
  const changedFiles = (scopeAll ? collectAllManaged() : collectChanged(base, head))
    .map((f) => f.split(path.sep).join('/'));
  // 扫描域 = 改动集 ∪（**磁盘上还存在的**基线受管文件）。并入基线文件是**让"变少也要收紧"和
  // "陈旧登记"在每个 PR 上都真实生效**——否则这两条只有跑 --all 时才看得见，而 CI 里没有 --all，等于没锁。
  // 并入时必须加 existsSync：账本里的文件已被删除，它就**不该**进计数比较——否则计数恒 0，
  // 会被报成"0 处 < 基线 N ⇒ 改少了把账本改小"，而真实原因是"这条登记的对象已经不存在"。
  // 两类修法不同（收紧账本 vs 删掉登记条目），诊断不能合并；且没有这条判据时
  // `stale` 那一类对"被删掉的文件"永远走不到（2026-10-14 变异反证实测：摘掉陈旧检测后
  // 行为锁照绿，因为红是由 shrink 提供的，而断言的 `陈旧`/`deleted\.md` 两个词都被固定
  // 修法文案命中 —— 一条装饰性锁）。
  // 实测代价（2026-10-14 当场重取，禁止沿用旧数）：`--all` 3079 个受管文件 2.8–3.2 s；
  // CI 口径 `--base=origin/main --head=HEAD` 改动 25 个 + 账本 432 个文件（10.4 MB）并入 ⇒ 1.8 s。
  // 这两个数随仓库增长，重取口径就是同一条命令本身。
  const domain = new Set();
  // 改动集这一侧同样要过滤存在性（外部评审 axis1c F5）：`git diff --name-only` **含删除路径**，
  // 原先只过滤账本并回那一侧，于是"本 PR 删掉一份已登记文档"会搭车进域、计数得 0，
  // 被报成"改少了把账本改小"（Windows）或什么都不报（ubuntu）——两种症状都不对，正解是陈旧登记。
  for (const f of changedFiles) {
    if (fs.existsSync(path.join(root, f))) domain.add(f);
  }
  for (const f of baseline.keys()) {
    if (isManagedDoc(f) && fs.existsSync(path.join(root, f))) domain.add(f);
  }
  const found = findingsByFile([...domain], driveRoots);

  const scopeDesc = scopeAll
    ? `全量审计（${domain.size} 个受管文件）`
    : `改动集 ${base}..${head}（改动 ${changedFiles.length} 个 + 基线并入，扫描 ${domain.size} 个文件）`;

  // 能不能做逐文件计数比较，取决于本机有没有盘符。CI 的 `changes` job 跑在 **ubuntu-latest**，
  // 那里 `C:`…`Z:` 都不存在 ⇒ firstMissingSegment 对每条路径都返回 null ⇒ 现场计数恒 0。
  // 此时若照常比较，会把整张账本全报成"待收紧"——门禁在 runner 上永久红，
  // 比它本该挡的问题更糟。所以这一支显式跳过计数比较，并且**出声说明跳过了什么**：
  // 静默 PASS 与静默恒红是同一种错，两者都让下一个人读不出"这次到底判没判"。
  const canJudge = driveRoots.size > 0;
  const verdict = judgeBaseline({ counts: found, baseline, domain, canJudge });
  for (const v of verdict.stale) {
    v.why = fs.existsSync(path.join(root, v.file))
      ? '不再受管（移入归档 / 改了扩展名）'
      : '已不存在';
  }
  const over = verdict.over;
  const shrink = verdict.shrink;
  const stale = verdict.stale;
  const skipNote = formatSkipNote(canJudge);
  // 存在性核对的缺口必须**出声成数**：本轮域内有多少条绝对路径没能核对（axis1c F7 的原始形状是
  // "静默 PASS 与静默恒红同一种错"）。口径换代之后计数判定已与盘符无关，这里只披露剩下的那一半缺口。
  let unjudgedNote = '';
  if (!canJudge) {
    const texts = [];
    for (const f of domain) {
      try { texts.push(fs.readFileSync(path.join(root, f), 'utf8')); } catch { /* 读不到就不计入 */ }
    }
    const n = countUnjudged(texts);
    unjudgedNote = `；存在性核对未执行 ${n} 条（本机无盘符；**计数判定已照常执行**）`;
  }

  // ---- 账本放宽检测（判据本身不需要盘符 ⇒ 在 ubuntu 的 changes job 上也真实生效）----
  // 只在"改动集口径"（给了 --base）下做：它比较的是 base 那份账本与当前账本，全量审计没有 base 可比。
  // 不做的两种情形都必须出声，不得静默：① --all；② base 处还没有账本（本 PR 是首次引入）。
  let drift = null;
  let driftSkip = '';
  let prevMetricShown = 'n/a';
  let nextMetricShown = 'n/a';
  if (scopeAll) {
    driftSkip = '账本放宽检测未执行（--all 无 base 可比）';
  } else if (base) {
    const at = loadBaselineAt(base);
    if (at.error) {
      process.stderr.write(
        `[check-doc-abs-paths] 自身故障：${at.error} ⇒ 既不判 PASS 也不判 FAIL（退出码 2）\n`
      );
      return 2;
    }
    prevMetricShown = String(at.metric);
    nextMetricShown = String(baselineMetric);
    if (at.missing) driftSkip = '账本放宽检测未执行（base 处还没有账本，本 PR 是首次引入）';
    else {
      drift = judgeLedgerDrift({
        prev: at.map, next: baseline, changedDocs: new Set(changedFiles),
        prevMetric: at.metric, nextMetric: baselineMetric
      });
    }
  }

  const widened = drift ? drift.widened : [];
  const attributed = drift ? drift.attributedToBase : [];

  // 归因出声放在判定**之前**，PASS 与 FAIL 两条路都要看得见：放行但不列出来，
  // 下一个会话就分不清"正当 re-sync"与"用自己的红喂账本"（AGENTS 要求接受漂移须写进 PR 说明）。
  if (attributed.length) {
    process.stderr.write(
      `[check-doc-abs-paths] 账本上调 ${attributed.length} 项，**归因于 base 与 head 之间别人带进来的内容**` +
      '（这些文档不在本次改动集里 ⇒ 放行；请把这份清单写进 PR 说明，作为"接受漂移而非清理"的出处）：\n'
    );
    for (const a of attributed) {
      process.stderr.write(`  ${a.file}：账本 ${a.from} → ${a.to}（该文档不在本次改动集里）\n`);
    }
  }
  if (drift && drift.generationChange.length) {
    process.stderr.write(
      `[check-doc-abs-paths] 账本口径换代（${prevMetricShown} → ${nextMetricShown}），逐文件计数不可比 ⇒ 本轮不判放宽；` +
      `共 ${drift.generationChange.length} 项计数上调。请把这条出声写进 PR 说明，作为"接受换代"的出处。\n`
    );
    for (const g of drift.generationChange) {
      process.stderr.write(`  ${g.file}：${g.from} → ${g.to}（口径换代，非放宽）\n`);
    }
  }
  if (driftSkip) process.stderr.write(`[check-doc-abs-paths] ${driftSkip}\n`);

  // 机读计数行：A/B 负控（"有盘符 vs 无盘符"两档命中数必须相同）需要一个不靠措辞的读数。
  const countsTotal = [...found.values()].reduce((s, l) => s + l.length, 0);
  process.stdout.write(`[check-doc-abs-paths] counts=${countsTotal} domain=${domain.size} files=${found.size} canJudge=${canJudge}\n`);

  if (!over.length && !shrink.length && !stale.length && !widened.length) {
    const totalBase = [...found.values()].reduce((s, l) => s + l.length, 0);
    process.stderr.write(
      `[check-doc-abs-paths] PASS（${scopeDesc}，无新增本机绝对路径；` +
      `基线内 ${baseline.size} 个文件 / 现场存量 ${totalBase} 处已按文件对齐；` +
      '已豁免归档快照、路径词元自身含占位符者与非本机路径' + skipNote + unjudgedNote + '）\n'
    );
    return 0;
  }

  const bits = [];
  if (over.length) bits.push(`超出存量基线 ${over.length} 个文件`);
  if (shrink.length) bits.push(`低于基线待收紧 ${shrink.length} 个`);
  if (stale.length) bits.push(`陈旧登记 ${stale.length} 个`);
  if (widened.length) bits.push(`账本被放宽 ${widened.length} 个`);
  process.stderr.write(`[check-doc-abs-paths] FAIL：${scopeDesc} —— ${bits.join('；')}${skipNote}${unjudgedNote}\n\n`);

  for (const v of widened) {
    process.stderr.write(
      `  ${v.file}：账本 ${v.from} → ${v.to}，而这份文档**在本次改动集里** ⇒ 账本被放宽` +
      '（碰过文档又把数调大 = 用自己的红喂账本；`--write-baseline` 会把这种新增一起记进去）\n'
    );
  }

  for (const v of over) {
    process.stderr.write(`  ${v.file}：${v.n} 处 > 基线 ${v.b}（超出存量基线）\n`);
    for (const f of v.list.slice(0, v.n - v.b + 2)) {
      process.stderr.write(`    L${f.line}: ${f.path}\n`);
      // 没核对过就不能说"磁盘上不存在"——那是把"判不了"写成结论（同一份输出在两种档位下要能读出来）。
      if (canJudge && f.missing) process.stderr.write(`           └─ 磁盘上不存在：${f.missing}\n`);
      else if (canJudge) process.stderr.write('           └─ 存在（但仍计入新增；计数口径不问存在性）\n');
      else process.stderr.write('           └─ 存在性核对未执行（本机无盘符）\n');
    }
  }
  for (const v of shrink) {
    process.stderr.write(`  ${v.file}：${v.n} 处 < 基线 ${v.b} ⇒ 基线须收紧（改少了就把账本改小）\n`);
  }
  for (const v of stale) {
    process.stderr.write(`  ${v.file}：基线里有这一条，但文件${v.why} ⇒ 陈旧登记，必须删掉该条目\n`);
  }
  process.stderr.write(
    '\n  修法：\n' +
    '  - 超出存量基线：把新增的失效路径改指现存目录，或改写成占位符形态（`<...>` / `$VAR` / 通配）。\n' +
    '    若这条路径记录的是"当时"的事实（已删除的临时 worktree、CI runner 路径等），\n' +
    '    它不该出现在本次改动里——考虑撤掉这次文档改动，或把该文件移入归档豁免目录。\n' +
    '  - 变少了 / 陈旧登记：账本只能缩小。跑 `node scripts/check-doc-abs-paths.js --all --write-baseline` 重新生成，\n' +
    '    并把这次收紧写进 PR 说明（**不得**为了容忍新增而把某个数调大）。\n' +
    '  - 账本被放宽：这份文档在本次改动集里，而账本给它的数变大了 ⇒ 两条正解二选一：\n' +
    '    改文档（把失效路径改指现存目录或写成占位符），或撤掉这次账本改动。\n' +
    '    **不得**用"跑一次 --write-baseline 把新增记进去"来消红——那正是本条要拦的形状。\n'
  );
  return 1;
}

// 被 require 时不退出进程（纯函数判据要能喂参数单测：无盘符 runner 那一支在本机永远走不到，
// 留在 main 里就等于一条没人跑过的分支）。
if (require.main === module) {
  process.exit(main());
}

module.exports = {
  judgeBaseline, judgeLedgerDrift, serializeBaseline, loadBaseline, loadBaselineAt,
  normalizeBaselineKey, stripPairedEmphasis, countUnjudged, judgeWriteBaseline, formatSkipNote,
  isManagedDoc, WIN_ABS_RE, PLACEHOLDER_RE, BASELINE_REL, METRIC_VERSION
};
