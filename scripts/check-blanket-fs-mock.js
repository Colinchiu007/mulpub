'use strict';
/**
 * scripts/check-blanket-fs-mock.js — 「blanket fs 夹具」不得增长（Gate 2c-e）
 *
 * 缺陷族（#2794 归因，实测现场在 #2783 的日志形状）：测试文件用
 * `__registerMock('fs', { existsSync: () => false, … })` 会经 `Module._load` 拦截
 * **该 realm 里每一个** `require('fs')`。而被测服务模块 require 进来的
 * `node_modules/electron/index.js` 也在同一 realm 里执行（实测：把 `vitest.config.js` 的
 * `deps.inline:['electron']` 摘掉后它照样执行，见 `docs/deps-inline-electron-evaluation.md`，
 * 所以**没有"改配置就不用管夹具"的退路**）—— 它对 `existsSync(distPath) === false` 的反应是
 * 「二进制没备好」⇒ 打 `Downloading Electron binary…` 并当场 spawn install.js。
 * 后果不是"下载"而是**下载被记到当时正在跑的那条用例名下**，
 * 表现成一条什么都没做的用例随机 15s 超时。
 *
 * 判据口径（每一条都对应一次实测踩坑，不是设计偏好）：
 *  ① 只在**可执行正文**里找注册点：注释、字符串内容都先被掩码掉。掩码用**同一套扫描器**产出两份
 *     等长文本（codeOnly 掩注释、skeleton 再掩字符串），因为"按 `//` 切行"会把
 *     `const url = 'a // b'; __registerMock('fs', …)` 里的真注册整段吃掉 ⇒ 静默漏检（QM-6 实测复现）。
 *  ② 判据覆盖 `__registerMock('fs'|'node:fs'|'fs/promises')` 与 `vi.mock`/`vi.doMock` 两种形态，
 *     且**文件里每一个注册点都要判**（只看第一个 ⇒ "第二个才是 blanket"能整条洗白，QM-6 实测复现）。
 *  ③ 通过条件是「沙箱来自 `os.tmpdir()` + 按**路径段**判 + 沙箱外**真的调用**真实 fs」。
 *     三件事各自都有已复现的绕过：700 字符窗口会把**邻近函数**里的合格比较借给一个恒真谓词；
 *     「文件里某处声明过 `require('fs')`」会把一个从不调用它的动词判成已委托；
 *     任意宽的常量前缀（`/tmp/anything`）会让大量真实路径落进"沙箱"。
 *
 * 现场残留按实测登记在 KNOWN_BLANKET（每条带逐文件核对过的原因，**只能缩小**）：
 * 这批文件里的绝大多数同时 `__enableElectronMock()`，即 electron 走的是 mock 而不是真 index.js，
 * 所以那颗雷今天不响；不响不是不存在 —— 一旦有人去掉那行 opt-in，同一个 realm 就回到 #2794 的形状。
 *
 * 本地同口径：node scripts/check-blanket-fs-mock.js
 */
const { execFileSync } = require('child_process');
const path = require('path');

const TEST_FILE_RE = /(^|\/)[^/]+\.test\.(js|mjs|cjs|ts)$/;
const VENDOR_PREFIXES = ['.quality-rhythm/', 'node_modules/'];
// 现场实测 1068 个被跟踪测试文件；下界取 800 只用于"遍历退化时必须红"，
// 不参与"合规"判定 —— 低于下界就不下结论（与 worktree 链接扫描 R3 同款坑）。
const MIN_TEST_FILES = 800;

/**
 * 欠账清单：文件 → 原因。原因必须是**核对过的事实**，不是"待办"。
 * 收敛一个文件 = 删掉它的登记项（销账与收敛必须同一次发生，否则报"陈旧登记"）。
 */
const KNOWN_BLANKET = {
  'apps/desktop/tests/offline-manager.test.js': '同上：__enableElectronMock() 已开，electron 真入口不在本 realm',
  'apps/desktop/tests/publish-alert.test.js': '文件内 3 处 require("electron") 全部落在 __enableElectronMock() 之后 ⇒ 走 mock；本文件的 fs 谎报未触达真 electron 探测路径',
  'apps/desktop/tests/publish-poller.test.js': '未开 electron mock，但本文件不 require 任何读 fs 的同 realm 第三方（sharp/sql.js/electron 计数均为 0，见 scripts/check-blanket-fs-mock.test.js 的真实仓库那条）',
  'apps/desktop/tests/rewrite-strategy-manager.test.js': '同上：__enableElectronMock() 已开',
  'apps/desktop/tests/rpa-view-manager-zhihu.test.js': '同上：__enableElectronMock() 已开',
  'apps/desktop/tests/rpa-view-manager.test.js': '同上：__enableElectronMock() 已开',
  'apps/desktop/tests/template-manager.test.js': '同上：__enableElectronMock() 已开',
  'apps/desktop/tests/usage-tracker.test.js': '同上：__enableElectronMock() 已开',
};

const REGISTRY_KEY = '__mpBlanketFsMockScan';

/* ------------------------------------------------------------------ 扫描器 */

// 运算符位置上出现的 `/` 是正则字面量的起点（否则是除法）。不覆盖 `return /x/` 这类
// 关键词结尾的情形 —— 那需要词法表，而本仓夹具里没有这种写法；判据失效方向是"少掩码"，
// 最坏结果是把正则里的花括号当代码数（多报违规），不会放过脏夹具。
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n', '']);

/**
 * 一次线性扫描产出两份**等长**文本：
 *  - `codeOnly`：注释字符掩成空格，字符串原样保留 —— 用来找注册点（字符串里的 `__registerMock`
 *    字样仍会被看见，但那是"字符串恰好长得像调用"，实测比"把代码切掉"安全）。
 *  - `skeleton`：再把字符串/正则的**内容**掩成空格（引号本身留着）—— 用来做花括号配对与
 *    函数体切分，这样 `` () => `{ x `` 这种不成对花括号不会把对象字面量边界数错。
 * 行首的 shebang 一并掩掉。
 */
function scanMask (text) {
  const s = String(text == null ? '' : text);
  const n = s.length;
  const code = s.split('');
  const skel = s.split('');
  const maskBoth = (from, to) => {
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) {
      if (s[i] === '\n' || s[i] === '\r') continue;
      code[i] = ' '; skel[i] = ' ';
    }
  };
  const maskSkel = (from, to) => {
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) {
      if (s[i] === '\n' || s[i] === '\r') continue;
      skel[i] = ' ';
    }
  };
  if (s.startsWith('#!')) maskBoth(0, s.indexOf('\n') < 0 ? n : s.indexOf('\n'));
  let i = 0;
  while (i < n) {
    const c = s[i];
    const d = s[i + 1];
    if (c === '/' && d === '/') { let j = i + 2; while (j < n && s[j] !== '\n') j++; maskBoth(i, j); i = j; continue }
    if (c === '/' && d === '*') { const k = s.indexOf('*/', i + 2); const end = k < 0 ? n : k + 2; maskBoth(i, end); i = end; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (s[j] === '\\') { j += 2; continue }
        if (s[j] === c) { j++; break }
        if (c !== '`' && s[j] === '\n') break;
        j++;
      }
      maskSkel(i + 1, Math.max(i + 1, j - 1));
      i = Math.max(j, i + 1);
      continue
    }
    if (c === '/') {
      let k = i - 1;
      while (k >= 0 && (s[k] === ' ' || s[k] === '\t')) k--;
      const prev = k >= 0 ? s[k] : '';
      if (prev === '\n' || k < 0 || REGEX_PRECEDERS.has(prev)) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          if (s[j] === '\\') { j += 2; continue }
          if (s[j] === '\n') break;
          if (s[j] === '[') inClass = true;
          else if (s[j] === ']') inClass = false;
          else if (s[j] === '/' && !inClass) { j++; break }
          j++;
        }
        i = Math.max(j, i + 1);
        continue
      }
    }
    i++;
  }
  return { codeOnly: code.join(''), skeleton: skel.join('') };
}

function stripComments (text) {
  return scanMask(text).codeOnly;
}

/* ------------------------------------------------------------ 注册点与结构 */

/**
 * 注册点的**位置**必须在 skeleton 域找：`__registerMock('fs', {…})` 这件事，
 * "调用"是代码、`'fs'` 是字符串实参 —— 而 skeleton 只掩字符串的**内容**、留着引号，
 * 所以真调用一定还能被匹配到，而**写在字符串字面量里的那种**（例如回归夹具自己的
 * `"__registerMock('fs', {"`）内容已变空格，整条不再出现 ⇒ 不会被当成注册点。
 * 混用两域的代价本轮实测过：早先按 codeOnly 找点，夹具文件一旦从 untracked 变成 tracked，
 * 就被自己的测试文本判成 15 条 blanket 违规。
 * 模块 id 则反过来从 codeOnly 按同一 span 取原文判（skeleton 里它已经是空格）。
 */
const SITE_RES = [
  /__registerMock\(\s*(['"])[^'"]*\1\s*,/g,
  /\bvi(?:\.do)?\.mock\(\s*(['"])[^'"]*\1/g,
];
const FS_ID_RE = /['"](?:node:)?fs(?:\/promises)?['"]/;

/** 文件里**每一个** fs 注册点都要判（只看第一个 ⇒ 第二个是 blanket 就能整条洗白） */
function findRegistrationSites (skeleton, codeOnly) {
  const sites = [];
  for (const re of SITE_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(skeleton)) !== null) {
      const raw = codeOnly.slice(m.index, m.index + m[0].length);
      if (FS_ID_RE.test(raw)) sites.push(m.index);
    }
  }
  return sites.sort((a, b) => a - b);
}

/** 从 fromIndex 起做**字符串/注释感知**的花括号配对（在 skeleton 域配对），返回 [open, closeExclusive] */
function objectLiteralSpan (skeleton, fromIndex) {
  const open = skeleton.indexOf('{', fromIndex);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < skeleton.length; i++) {
    const c = skeleton[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return [open, i + 1] }
  }
  return null;
}

/**
 * 声明之后的函数体**位置**。位置在 skeleton 域算（字符串里的花括号不参与配对），
 * 内容由调用方从 codeOnly 域按同一位置切出 —— 两份文本等长，这是这套扫描器的关键不变量：
 * skeleton 掩掉字符串内容后，`require('node:fs')` 在 skeleton 里根本看不见，
 * 拿 skeleton 做"是否委托真实 fs"的匹配会把已收敛的夹具判成违规。
 */
function functionBodySpan (skeleton, declIndex) {
  const arrow = skeleton.indexOf('=>', declIndex);
  if (arrow < 0) return null;
  const after = skeleton.slice(arrow + 2);
  const lead = after.match(/^\s*/);
  const bodyStart = arrow + 2 + (lead ? lead[0].length : 0);
  if (skeleton[bodyStart] === '{') {
    const span = objectLiteralSpan(skeleton, bodyStart);
    return span || [bodyStart, Math.min(skeleton.length, bodyStart + 600)];
  }
  let depth = 0;
  let i = bodyStart;
  for (; i < skeleton.length; i++) {
    const c = skeleton[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth-- }
    else if (c === '\n' && depth === 0) break;
  }
  return [bodyStart, i];
}

/**
 * 只有这两个读动词被要求"沙箱外真的调用真实 fs"：#2794 实测在同 realm 里真正读 fs 的第三方
 * （`electron/index.js` 探二进制、`sql.js` 读 `.wasm`）用的就是 existsSync + readFileSync。
 * statSync / readdirSync **故意不在列内**：两处已收敛的夹具对 statSync 保留了固定返回值，
 * 理由是"换成真读会让不存在的沙箱外路径从 {size:1024} 变成抛 ENOENT"，那是本缺陷之外的语义漂移
 * （见 asset-generator.test.js 的注释）。把它们纳进来等于逼夹具改生产语义 —— 反证 F9 修完后
 * 第一版就是这么错的：非括号感知的实现体切分还会在 `{ size: 0, mtime: ... }` 的 `, mtime:` 处
 * 提前截断，把"确实委托了 realFs"的动词读成"没委托"。
 */
const READ_VERBS = ['existsSync', 'readFileSync'];

/** 收集一个片段里出现的标识符（去掉数字字面量噪声） */
function identifiersOf (chunk) {
  return (String(chunk || '').match(/[A-Za-z_$][\w$]*/g) || []);
}

function declRe (ident) {
  return new RegExp('(?:const|let|var)\\s+' + ident + '\\s*=');
}

/** 取 `const ident = …` 到该行末尾（codeOnly 域：注释已掩、字符串保留） */
function declRhs (code, ident) {
  const m = declRe(ident).exec(code);
  if (!m) return null;
  const start = m.index + m[0].length;
  let end = code.indexOf('\n', start);
  if (end < 0) end = code.length;
  return code.slice(start, end);
}

/**
 * 沙箱常量必须**可追溯到 `os.tmpdir()`**（AGENTS.md「文件系统测试隔离」）。
 * 沿 `const X = ...` 的右值标识符做**有界**一跳一跳解析（≤4 跳、≤8 个候选），
 * 因为现场写法是 `sandbox = TTS_SANDBOX.replace(...)`、而 `TTS_SANDBOX = path.join(os.tmpdir(), …)`。
 * 不要求这个的话，`const ALLOW = '/tmp/anything'` 甚至 `''` 都能拿到 SANDBOX_DELEGATED，
 * 于是"沙箱"退化成"任意宽的谎报前缀"（QM-6 probe D 实测复现）。
 */
function reachesTmpdir (code, ident, seen) {
  const visited = seen || new Set();
  if (!ident || visited.has(ident)) return false;
  visited.add(ident);
  if (visited.size > 8) return false;
  const rhs = declRhs(code, ident);
  if (rhs === null) return false;
  if (/tmpdir\s*\(/.test(rhs)) return true;
  for (const next of identifiersOf(rhs)) {
    if (next === ident) continue;
    if (reachesTmpdir(code, next, visited)) return true;
  }
  return false;
}

/**
 * 谓词的**自身函数体**必须做路径段比较，且比较的常量可追溯到 tmpdir。
 * 四条各堵一个已复现的绕过：
 *  - 声明必须带形参（`() => true` 直接否）；
 *  - 判据只看**它自己的体**（把邻近函数里的合格比较"借"给一个恒真谓词 ⇒ 否，probe E）；
 *  - `===` 与 `startsWith` 必须比**同一个**标识符（一个真沙箱、另一个随便写的常量 ⇒ 否）；
 *  - 比较对象必须来自 tmpdir（probe D：`const ALLOW = '/tmp/anything'` 不算沙箱）。
 *
 * 位置在 skeleton 域取（字符串里的括号不参与配对），内容一律从 codeOnly 域切 ——
 * 否则 `startsWith(x + '/')` 里的 `'/'` 与 `require('node:fs')` 早已被掩成空格，
 * 判据会对真夹具失明（第一版就把我自己的正控判成了违规）。
 */
function predicateIsSegmentSafe (code, skeleton, ident) {
  const m = new RegExp('(?:const|let|var)\\s+' + ident + '\\s*=\\s*\\(([^)]*[A-Za-z_$][^)]*)\\)\\s*=>').exec(code)
    || new RegExp('function\\s+' + ident + '\\s*\\(([^)]*[A-Za-z_$][^)]*)\\)').exec(code);
  if (!m) return false;
  const span = functionBodySpan(skeleton, m.index);
  if (!span) return false;
  const body = code.slice(span[0], span[1]);
  const eq = /===\s*([A-Za-z_$][\w$]*)/.exec(body);
  const sw = /startsWith\(\s*([A-Za-z_$][\w$]*)\s*\+\s*['"]\/['"]/.exec(body);
  if (!eq || !sw || eq[1] !== sw[1]) return false;
  return reachesTmpdir(code, eq[1]);
}

/** 动词实现体必须**真的调用**真实 fs 句柄上的同名方法，而不是"文件里某处 require 过 fs"（probe C1-b） */
function delegatesRealFs (code, impl, verb) {
  for (const id of identifiersOf(impl)) {
    const rhs = declRhs(code, id);
    if (rhs === null) continue;
    if (!/require\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/.test(rhs)) continue;
    const call = new RegExp('\\b' + id + '\\s*\\.\\s*' + verb + '\\s*\\(');
    if (call.test(impl)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ 判定 */

/**
 * 判定单个文件正文：NONE = 没有 fs 夹具（或所有注册点都不含被要求的读动词）。
 * 有多个注册点时取**最差**结论（任一 blanket 即 blanket）。
 */
function classify (text) {
  const { codeOnly, skeleton } = scanMask(text);
  const sites = findRegistrationSites(skeleton, codeOnly);
  if (!sites.length) return { verdict: 'NONE' };

  const missing = [];
  let judgedVerbs = 0;
  for (const site of sites) {
    const span = objectLiteralSpan(skeleton, site);
    if (!span) {
      judgedVerbs += 1;
      missing.push('取不到 mock 对象字面量（括号配对失败 ⇒ 无法证明它委托了真实 fs）');
      continue;
    }
    // 位置来自 skeleton，内容来自 codeOnly（等长 ⇒ 同一坐标；字符串在 codeOnly 里是完整的）
    const literal = codeOnly.slice(span[0], span[1]);
    for (const verb of READ_VERBS) {
      if (!new RegExp('\\b' + verb + '\\s*:').test(literal)) continue;
      judgedVerbs++;
      const m = new RegExp('\\b' + verb + '\\s*:\\s*([\\s\\S]*?)(?=,\\s*[A-Za-z_$][\\w$]*\\s*:|\\}$)').exec(literal);
      const impl = m ? m[1] : '';
      const idents = identifiersOf(impl);
      const pred = idents.find((id) => READ_VERBS.indexOf(id) < 0 && predicateIsSegmentSafe(codeOnly, skeleton, id));
      if (!pred) {
        missing.push(verb + ' 未按路径段判沙箱（裸 startsWith 会把 <沙箱>-evil 判进沙箱；恒真谓词 `() => true`、"借"邻近函数的合格比较、以及不来自 os.tmpdir() 的前缀都不算）');
        continue;
      }
      if (!delegatesRealFs(codeOnly, impl, verb)) {
        missing.push(verb + ' 没有在该实现体里真的调用真实 fs 句柄的同名方法（`<handle>.' + verb + '(…)`）—— 文件里某处 require 过 fs 不算委托');
      }
    }
  }
  if (!judgedVerbs) return { verdict: 'NONE' };
  if (missing.length) return { verdict: 'BLANKET', missing: missing.join('；') };
  return { verdict: 'SANDBOX_DELEGATED' };
}

/* ------------------------------------------------------------------ 取数 */

function listTrackedFiles (cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((f) => f.replace(/\\/g, '/'));
  } catch (e) {
    // 抛出去会让 main() 以裸栈收尾：判据仍然是 fail-closed，但读日志的人看不到"为什么"。
    throw new Error('git ls-files 失败 ⇒ 枚举不可信，本门禁拒绝下任何结论：' + String((e && e.message) || e).slice(0, 200));
  }
}

/**
 * `git check-ignore` 的退出码语义：0 = 被忽略，1 = 未被忽略，**>=128 = 命令自己失败了**。
 * 曾经写成 `-q -v` 并用 catch 一律判"未被忽略" —— git 直接 `cannot have both --quiet and --verbose`
 * 返回 128，于是这条自检**永久盲**（探针故障伪装成结论，反证 F10 实测暴露）。
 * 第二个洞是同族的：git 二进制取不到时 execFileSync 抛的错 `status` 是 **null** 而 code 是 ENOENT，
 * 旧写法 `typeof e.status === 'number' ? e.status : 1` 把它折成"未被忽略" ⇒ 探针没跑也报通过。
 * 现在三态如实返回，取不到 git 一律记 3（调用方对 >=2 必须红）。
 */
function checkIgnoreStatus (rel, cwd, run) {
  const exec = run || execFileSync;
  try {
    exec('git', ['-C', cwd, 'check-ignore', '--no-index', '-q', '--', rel], { stdio: 'ignore' });
    return 0;
  } catch (e) {
    if (typeof e.status === 'number') return e.status;
    return 3;
  }
}

/**
 * 纯判定：给定仓库快照（可注入夹具）返回问题清单；problems 为空 = 通过。
 */
function collectProblems (options) {
  const opts = options || {};
  const root = opts.root || path.resolve(__dirname, '..');
  const checkIgnored = opts.checkIgnored !== false;
  const known = opts.knownBlanket || KNOWN_BLANKET;
  const minTestFiles = typeof opts.minTestFiles === 'number' ? opts.minTestFiles : MIN_TEST_FILES;
  const list = opts.files || listTrackedFiles(root);
  const readFile = opts.readFile || ((rel) => require('fs').readFileSync(path.join(root, rel), 'utf8'));

  const problems = [];
  const testFiles = list.filter((f) => TEST_FILE_RE.test(f) && !VENDOR_PREFIXES.some((p) => f.startsWith(p)));
  let unreadable = 0;
  const blanket = [];
  let converged = 0;

  for (const f of testFiles) {
    let text;
    try {
      text = readFile(f);
    } catch (e) {
      unreadable++;
      problems.push('读不动测试文件（枚举不完整 ⇒ 不得判"全仓合规"）：' + f + ' ' + String(e.code || e.message).slice(0, 60));
      continue;
    }
    // 正文缺失（readFile 返回 null/undefined）与"读不动"是同一件事：枚举不完整。
    // 曾经写成 `continue` ⇒ 注入式夹具里少给一个键，那个文件就**静默不在判据域内**，
    // 而 scanned 仍然把它算进去（判"全仓合规"的分子里含着一个从没被测过的文件）。
    if (text === null || text === undefined) {
      unreadable++;
      problems.push('测试文件正文缺失（readFile 返回 ' + String(text) + ' ⇒ 该文件从未被判定，不得计入"已扫描"）：' + f);
      continue;
    }
    const c = classify(text);
    if (c.verdict === 'BLANKET') blanket.push(f);
    else if (c.verdict === 'SANDBOX_DELEGATED') converged++;
  }

  if (testFiles.length < minTestFiles) {
    problems.push('测试文件枚举退化（只有 ' + testFiles.length + ' 个，下限 ' + minTestFiles + '），判据不可信');
  }

  // blanket 侧：现场与清单必须**集合相等**（只能缩小；新增即红，留旧也红）
  const setBlanket = new Set(blanket);
  for (const f of setBlanket) {
    if (!Object.prototype.hasOwnProperty.call(known, f)) {
      problems.push('新增 blanket fs 夹具（必须收敛成"沙箱限定 + 沙箱外委托真实 fs"，或带**核对过的原因**登记，且登记只能缩小）：'
        + f + ' —— ' + (classify(readFileSafe(readFile, f)).missing || ''));
      continue;
    }
    if (!String(known[f] || '').trim()) problems.push('欠账登记缺原因（"待办/暂时"不是原因）：' + f);
  }
  for (const f of Object.keys(known)) {
    if (!setBlanket.has(f)) {
      problems.push('陈旧登记：' + f + ' 现场已不是 blanket（收敛了就同次删掉登记项 —— 销账与收敛必须同一次发生）');
    }
  }
  for (const f of Object.keys(known)) {
    if (!list.includes(f)) problems.push('欠账登记指向不存在的测试文件（键漂移不许静默）：' + f);
  }

  if (checkIgnored) {
    for (const rel of [path.relative(root, __filename), path.relative(root, __filename).replace(/\.js$/, '.test.js')]) {
      const st = checkIgnoreStatus(rel.replace(/\\/g, '/'), root);
      if (st === 0) {
        problems.push('门禁自身被 .gitignore 吞掉（scripts/*.js 那条默认忽略，须补 negation），CI 永远不会跑它：' + rel);
      } else if (st >= 2) {
        problems.push('check-ignore 自身失败（rc=' + st + '）⇒ "没被忽略"这个结论不可信，不得当作通过：' + rel);
      }
    }
  }

  return { problems, scanned: testFiles.length, unreadable, blanket, converged };
}

function readFileSafe (readFile, f) {
  try { return readFile(f); } catch (_) { return ''; }
}

function main () {
  let r;
  try {
    r = collectProblems();
  } catch (e) {
    console.error('FAIL: ' + String(e && e.message || e).slice(0, 400));
    process.exitCode = 1;
    return;
  }
  console.log('[blanket-fs-mock] 测试文件=' + r.scanned + '，blanket 现场=' + r.blanket.length
    + '，已收敛=' + r.converged + '，读不动=' + r.unreadable);
  if (r.problems.length) {
    r.problems.forEach((p) => console.error('FAIL: ' + p));
    process.exitCode = 1;
    return;
  }
  console.log('PASS: 没有新增 blanket fs 夹具，登记项与现场逐一对上（清单只能缩小）');
}

if (require.main === module) main();

module.exports = {
  collectProblems,
  classify,
  stripComments,
  scanMask,
  findRegistrationSites,
  objectLiteralSpan,
  predicateIsSegmentSafe,
  delegatesRealFs,
  reachesTmpdir,
  checkIgnoreStatus,
  KNOWN_BLANKET,
  MIN_TEST_FILES,
  TEST_FILE_RE,
  VENDOR_PREFIXES,
};
