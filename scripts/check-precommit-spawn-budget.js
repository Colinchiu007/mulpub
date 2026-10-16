#!/usr/bin/env node
/**
 * 结构判据：pre-commit 钩子对「判定记录自动暂存」这一段不得再用逐文件 fork git 的形态。
 *
 * 为什么需要它：成本规模锁（scripts/hooks/pre-commit.test.sh scenario16）是行为测量，
 * 只有跑到那段代码才有效；而"退回逐文件循环"这种改法可以在评审中被写成注释、被临时禁用、
 * 或在另一个入口里复活。本判据读的是钩子正文本身，与执行路径无关。
 *
 * 能力边界（QM-6 i3，必须如实写在这里，别让下一个读者以为它是主判据）：
 *   本判据只认三种**历史文本形态**，换成 while-read 逐条 git status、xargs 逐条 add 等变体即可绕过。
 *   真正与形态无关的主判据是 scripts/hooks/pre-commit.test.sh 的 scenario16（数 git 调用条数）；
 *   本判据是它的**补充绊线**（防"根本没跑到那段代码"的失效形态），不能替代前者。
 *
 * 计数的作用域（QM-6 第三轮 i3）：
 *   禁止形态与 required 写法按**全文**判——"任何地方重新出现逐文件形态"正是本绊线要抓的，与段落无关。
 *   棘轮预算按**暂存段**判。原因是实测：全文计数把无关的 `[sync-version]` 段 `git add
 *   apps/desktop/package.json` 也算进预算，预算因此恒等于「现状 + 0 余量」，任何人在别的段落
 *   加一条正常 `git add` 都会撞出一条与本判据语义无关的假红——假红逼人去改预算，
 *   而每改一次预算，棘轮就自弱一分。段作用域后该数只剩它真正该管的两次调用。
 *   全文计数并没有被丢掉：它仍在 metrics 里出声（gitAddCallsWholeFile），只是不参与判定。
 *   **段的边界靠锚点，锚点缺失一律不判通过**；此时的退出码归属是「只在没有其他违规时才记 SELF_FAULT(rc=2)」——
 *   已发现禁止形态时仍记违规(rc=1)——把真实违规降成"环境问题"等于给坏代码发通行证。
 *   锚点式切片在本仓有先例性风险（终点锚被搬走时 indexOf 返回 -1，slice 把负终点解释成
 *   "从末尾倒数"，区间静默放大到接近整份文件，守卫继续绿却不再测量它声称的代码）。
 *
 * 三条硬口径（本仓同族教训）：
 *   1) 判据必须先剥注释再匹配——否则合规正文里的示例注释会反向假红（结构锁不剥注释＝幽灵通道）。
 *   2) 「命中 0」不等于「合规」——required 判据带**下界断言**，读不到内容即判自身故障，不判通过。
 *   3) 例外/承认清单必须是**注入参数**而非常量——硬编码清单会让夹具恒被判陈旧。
 *
 * 依赖：只用 node 内置模块。落点 `.github/workflows/quality-gate.yml` 的 changes job 无 Install deps。
 */
'use strict';

const fs = require('fs');

const DEFAULTS = {
  // 禁止形态：逐文件 fork git 的三种可识别写法
  // 注意 `"$rec"` 形态：判据必须认裸 `$var`，写成 `"\$\{"` 会对真实旧代码恒不命中（哑弹判据）。
  forbidden: [
    { id: 'GLOB_PER_FILE_LOOP', re: /\bfor\s+[A-Za-z_]\w*\s+in\s+[^\n]*\.ccg\/reviews[^\n]*\*\.[A-Za-z]/ },
    { id: 'PER_FILE_LS_FILES', re: /git\s+ls-files\s+--\s*"\$/ },
    { id: 'PER_FILE_DIFF_QUIET', re: /git\s+diff\s+--quiet\s+--\s*"\$/ },
  ],
  // 必须存在的常数次写法（各自下界 >=1）
  required: [
    { id: 'UNTRACKED_SCAN', re: /git\s+ls-files\s+--others\s+--exclude-standard\s+-z\b/, min: 1 },
    { id: 'MODIFIED_SCAN', re: /git\s+diff\s+--name-only\s+-z\b/, min: 1 },
    { id: 'BATCH_ADD_VIA_STDIN', re: /--pathspec-from-file=-\s+--pathspec-file-nul/, min: 1 },
    // pathspec 必须带 :(glob)：git 裸 pathspec 的 `*` 跨 `/`，会把 .ccg/reviews/inner/*.json
    // 纳入候选，使新形态成为旧 shell glob 集合的超集（实测，QM-6 第三轮 i1）。
    { id: 'GLOB_SCOPED_PATHSPEC', re: /:\(glob\)\.ccg\/reviews\/\*\.json/, min: 1 },
  ],
  // 棘轮预算的作用域：暂存段（起止锚点都必须恰好命中一次，否则判自身故障）
  section: {
    startRe: /^[ \t]*RECORD_PATHSPEC=/,
    endRe: /^[ \t]*rm -f "\$rev_tmp/,
  },
  // 棘轮预算：只数暂存段内的调用点，只能缩小不能放宽
  budgets: {
    recordPathspecMentions: 3, // 定义 1 + 两处扫描 2
    gitAddCalls: 2,            // 批量 1 + 回退逐条 1
  },
  allowlist: [], // 已知例外的 id 集合；必须由调用方注入，默认为空
};

/** 剥掉行注释与块注释行，但保留 shebang。返回 { code, commentOnly } 供"注释里的示例不算命中"用。 */
function stripComments(text) {
  const code = [];
  const comment = [];
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, idx) => {
    if (idx === 0 && line.startsWith('#!')) { code.push(line); return; }
    if (/^\s*#/.test(line)) { comment.push(line); return; }
    code.push(line);
  });
  return { code: code.join('\n'), commentOnly: comment.join('\n') };
}

function countMatches(re, text) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const m = text.match(g);
  return m ? m.length : 0;
}

/** 只数"命令位"的 git add：告警文案里也写着「批量 git add 失败」，按字符串计数会撑爆预算（实测）。 */
function countAddCalls(text) {
  return countMatches(/\bgit\s+add\b/, text.split('\n').filter(l => !/^\s*(echo|printf)\b/.test(l)).join('\n'));
}

/**
 * 取暂存段。返回 { ok:true, text } 或 { ok:false, reason }——
 * 锚点缺失/重复一律不判通过：区间切片在本仓有"终点锚丢失 ⇒ 负终点被解释成从末尾倒数 ⇒
 * 区间静默放大"的先例，所以这里宁可 fail closed 并点名是哪一锚。
 */
function extractSection(code, section) {
  const lines = code.split('\n');
  const starts = [];
  const ends = [];
  lines.forEach((l, i) => {
    if (section.startRe.test(l)) starts.push(i);
    if (section.endRe.test(l)) ends.push(i);
  });
  if (starts.length !== 1) return { ok: false, reason: 'start anchor hits=' + starts.length + ' (need exactly 1)' };
  if (ends.length !== 1) return { ok: false, reason: 'end anchor hits=' + ends.length + ' (need exactly 1)' };
  if (ends[0] < starts[0]) return { ok: false, reason: 'end anchor precedes start anchor' };
  return { ok: true, text: lines.slice(starts[0], ends[0] + 1).join('\n'), from: starts[0], to: ends[0] };
}

/** 纯函数判据：输入钩子正文文本，返回 violations / metrics。不做 IO。 */
function analyze(text, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const forbidden = o.forbidden || DEFAULTS.forbidden;
  const required = o.required || DEFAULTS.required;
  const section = o.section || DEFAULTS.section;
  const budgets = Object.assign({}, DEFAULTS.budgets, o.budgets || {});
  const allowlist = new Set(o.allowlist || []);
  const stripped = stripComments(text);
  const code = stripped.code;
  const comments = stripped.commentOnly;
  const violations = [];
  const metrics = {
    hits: {},
    codeChars: code.length,
    commentLines: comments.split('\n').filter(l => l.trim() !== '').length,
  };

  if (code.length < 200) {
    // 读不出内容时绝不判通过——解析退化会让"零命中"看起来像合规（本仓反复踩过的假绿形态）
    violations.push({ id: 'SOURCE_TOO_SMALL_OR_EMPTY', detail: 'code chars=' + code.length });
    return { ok: false, selfFault: true, violations, metrics };
  }

  for (const f of forbidden) {
    const inCode = countMatches(f.re, code);
    const inComment = countMatches(f.re, comments);
    metrics.hits[f.id] = inCode;
    if (inCode > 0 && !allowlist.has(f.id)) {
      violations.push({ id: f.id, detail: 'code hits=' + inCode, note: '禁止形态出现在可执行正文' });
    }
    if (inCode === 0 && inComment > 0 && !allowlist.has(f.id)) {
      // 只在注释里出现不算违规，但必须出声，否则"判据到底有没有在看这段"下次无从判断
      metrics.hits[f.id + '_commentOnly'] = inComment;
    }
  }
  for (const r of required) {
    const n = countMatches(r.re, code);
    metrics.hits[r.id] = n;
    const min = typeof r.min === 'number' ? r.min : 1;
    if (n < min && !allowlist.has(r.id)) {
      violations.push({ id: 'MISSING_' + r.id, detail: 'hits=' + n + ' min=' + min, note: '常数次写法缺席，或判据读不到正文' });
    }
  }

  const sec = extractSection(code, section);
  if (!sec.ok) {
    // 作用域判不出来 ⇒ 预算这一维根本没被测量，必须与"发现违规"分档报出
    violations.push({ id: 'SECTION_ANCHOR_UNRESOLVED', detail: sec.reason, note: '段作用域预算无法定位，不得当作通过' });
    metrics.hits.gitAddCallsWholeFile = countAddCalls(code);
    return { ok: false, selfFault: violations.filter(v => v.id !== 'SECTION_ANCHOR_UNRESOLVED').length === 0, violations, metrics };
  }
  metrics.sectionLines = sec.to - sec.from + 1;
  // 全文计数继续出声（不判定）：别处新增 git add 仍能在 CI 日志里被看见
  metrics.hits.gitAddCallsWholeFile = countAddCalls(code);

  const mentions = countMatches(/RECORD_PATHSPEC/, sec.text);
  metrics.hits.recordPathspecMentions = mentions;
  if (mentions > budgets.recordPathspecMentions) {
    violations.push({ id: 'BUDGET_RECORD_PATHSPEC_MENTIONS', detail: mentions + ' > ' + budgets.recordPathspecMentions });
  }
  const adds = countAddCalls(sec.text);
  metrics.hits.gitAddCalls = adds;
  if (adds > budgets.gitAddCalls) {
    violations.push({ id: 'BUDGET_GIT_ADD_CALLS', detail: adds + ' > ' + budgets.gitAddCalls });
  }

  return { ok: violations.length === 0, violations, metrics };
}

function checkFile(absPath, opts) {
  let raw;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return { ok: false, selfFault: true, violations: [{ id: 'HOOK_UNREADABLE', detail: String(e.message || e) }], metrics: {} };
  }
  const r = analyze(raw, opts);
  r.source = absPath;
  return r;
}

function main(argv) {
  const args = argv || process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const path = positional[0] || 'scripts/hooks/pre-commit';
  const res = checkFile(path, {});
  const mark = res.selfFault ? 'SELF_FAULT' : (res.ok ? 'OK' : 'VIOLATION');
  console.log('[spawn-budget] ' + mark + ' file=' + path);
  console.log('[spawn-budget] metrics=' + JSON.stringify(res.metrics));
  if (res.violations.length) {
    res.violations.forEach(v => console.log('  VIOLATION ' + v.id + ': ' + v.detail + (v.note ? ' — ' + v.note : '')));
  }
  if (res.selfFault) return 2; // 与"发现违规"分档：把"门禁瞎了"和"代码有问题"混档会误导排障
  return res.ok ? 0 : 1;
}

module.exports = { analyze, checkFile, stripComments, countMatches, extractSection, DEFAULTS, main };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
