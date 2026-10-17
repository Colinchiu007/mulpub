// 「分支内容是否已完整进主干」的机械判据 —— 删本地分支前的闸门（只读，不删任何东西）。
//
// 为什么要有这个文件（2026-10-16）：这条判据此前只以 AGENTS.md 的散文存在，每轮清理由会话临时手写探针执行。
// 散文判据挡不住两类事故：① 判据本体写错（旧口径「`git diff --stat <tip> <mergeSHA>` 为空」在 5 例真实合并里
// 3 例假阳性）；② 判据非空时人照样删——本轮真实发生一次（差量 52/10/5 行仍删了 worktree 与分支）。
// 所以把它变成一条命令：红了就停手，绿了才允许走 safe-worktree-remove.ps1 + `git branch -D`。
//
// 判据本体（对应 AGENTS.md「收尾链上的已知假失败」的 C 口径）：
//   ① 普通文件逐字节比 blob —— 强判据，零成本。
//   ② 不等时不得直接判丢失，也不得直接放行：必须同时成立
//        (a) 双向行级多重集（我的新增行都在、我删掉的行不复现），
//        (b) 该文件上除本次合并之外还有具名他人提交可解释差异。
//      —— 「共用写面」不再靠手抄文件名名单；名单第 6 个热写面一出现就会被当普通文件比、当场复刻假阳性。
//   ③ 判据自己取不到读数一律按「未证实」处理并走独立退出码 2 —— 把工具的失明读成结论，是本仓「装饰性门禁」的同型。
//
// 退出码：0 全部落地（可删）/ 1 存在 LOST 或 UNATTRIBUTED（禁止删）/ 2 判据自身故障（fail-closed，同样禁止据此删）。
// 依赖：只用 node 内置模块 —— 本文件被 quality-gate.yml 的 changes job 点名，而那个 job 没有 Install deps。
'use strict';

const { execFileSync } = require('child_process');

const VERDICTS = ['IDENTICAL', 'DRIFT-ATTRIBUTED', 'LOST', 'UNATTRIBUTED', 'JUDGE_ERROR'];
const EXIT_OK = 0;
const EXIT_LOST = 1;
const EXIT_JUDGE_ERROR = 2;

// 好判据优先级：同一文件对多个 merge SHA 分别判时取最好的那个（一个分支被两个 PR 用过的情形）。
const RANK = { 'IDENTICAL': 0, 'DRIFT-ATTRIBUTED': 1, 'UNATTRIBUTED': 2, 'LOST': 3, 'JUDGE_ERROR': 4 };

// 行切分：保留每个换行符属于上一行（lookbehind split），CRLF/LF 混存文件不得被统一行尾。
function splitLines(s) {
  return s === '' ? [] : s.split(/(?<=\n)/);
}

// 比较用的归一化：去掉行尾换行与首尾空白。**只用于比较，不用于产物**（产物一律回显原始行）。
function key(line) {
  return line.replace(/[\r\n]+$/, '').trim();
}

function multisetOf(lines) {
  const m = new Map();
  for (const l of lines) {
    const k = key(l);
    if (k === '') continue;            // 空行/纯空白行不参与判定，否则每个文件都必红
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

// 原始行代表（按 key 取第一条原文），用于把结论打印成人能核对的文本。
function representatives(lines) {
  const map = new Map();
  for (const l of lines) {
    const k = key(l);
    if (k !== '' && !map.has(k)) map.set(k, l);
  }
  return map;
}

/**
 * 我的新增行必须逐条在主干出现 ≥ 我给的次数。
 * 返回"次数不足"的那些行（原始文本，去重后每键一条）。
 */
function compareAddedLines(addedLines, mainLines) {
  const need = multisetOf(addedLines);
  const have = multisetOf(mainLines);
  const rep = representatives(addedLines);
  const out = [];
  for (const [k, n] of need) if ((have.get(k) || 0) < n) out.push(rep.get(k));
  return out;
}

/**
 * 我删掉的行必须在主干**一次都不出现**。
 * 这是双向判据的后半：单向只证"我的东西都在"，证不出"我删掉的那行被后续合并带回来了"。
 */
function compareRemovedLines(removedLines, mainLines) {
  const have = multisetOf(mainLines);
  const rep = representatives(removedLines);
  const out = [];
  for (const k of new Set(removedLines.map(key))) {
    if (k !== '' && (have.get(k) || 0) > 0) out.push(rep.get(k));
  }
  return out;
}

// ---------------------------------------------------------------- git 只读封装
function git(root, args, allowFail) {
  try {
    return { ok: true, out: execFileSync('git', ['-C', root].concat(args), { encoding: 'buffer', maxBuffer: 1 << 28 }).toString('latin1') };
  } catch (e) {
    if (allowFail) return { ok: false, out: '', err: String(e.message || e).slice(0, 200) };
    throw new JudgeError('git ' + args.join(' ') + ' 失败：' + String(e.message || e).slice(0, 200));
  }
}

class JudgeError extends Error {}

function verifyRef(root, ref) {
  const r = git(root, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'], true);
  if (!r.ok) return null;
  return r.out.trim();
}

// 某 ref 的树里该文件是否存在及其 blob oid；不存在返回 null，ref 坏由调用方先挡掉。
function blobOid(root, ref, file) {
  const r = git(root, ['ls-tree', ref, '--', file], true);
  if (!r.ok) throw new JudgeError('ls-tree ' + ref + ' ' + file + ' 读不到');
  const line = r.out.split('\n').find((l) => l.trim() !== '');
  if (!line) return null;
  const m = /^(\d+)\s+\w+\s+([0-9a-f]{40})\t/.exec(line);
  if (!m) throw new JudgeError('ls-tree 输出解析不出 oid：' + line.slice(0, 60));
  return m[2];
}

function blobText(root, oid) {
  const r = git(root, ['cat-file', 'blob', oid], true);
  if (!r.ok) throw new JudgeError('cat-file ' + oid.slice(0, 8) + ' 读不到');
  return r.out;
}

// 我在 base..ref 上对这个文件的 +/- 行
function myLineDelta(root, base, ref, file) {
  const d = git(root, ['diff', '--unified=0', base, ref, '--', file], true);
  if (!d.ok) throw new JudgeError('diff ' + base + '..' + ref + ' -- ' + file + ' 失败');
  const added = [];
  const removed = [];
  for (const l of splitLines(d.out)) {
    const body = l.replace(/[\r\n]+$/, '');
    if (body.startsWith('+++') || body.startsWith('---') || body.startsWith('diff ') ||
      body.startsWith('index ') || body.startsWith('@@') || body.startsWith('\\')) continue;
    if (body.startsWith('+')) added.push(body.slice(1) + '\n');
    else if (body.startsWith('-')) removed.push(body.slice(1) + '\n');
  }
  return { added, removed };
}

// 差异归因：base..merge 里除本次合并自身外，还有谁碰过这个文件。
function attributionsFor(root, base, merge, file, mergeSha) {
  const l = git(root, ['log', '--format=%H%x09%h %s', base + '..' + merge, '--', file], true);
  if (!l.ok) throw new JudgeError('log 归因失败：' + file);
  const out = [];
  for (const line of splitLines(l.out)) {
    const body = line.replace(/[\r\n]+$/, '');
    if (!body) continue;
    const [sha, rest] = body.split('\t');
    if (sha === mergeSha) continue;                 // 本次合并自身不算他人
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;      // 形状断言：解析退化不得当"有归因"
    out.push({ sha, subject: rest });
  }
  return out;
}

// ---------------------------------------------------------------- 单文件判定
function classifyFile(root, { ref, merge, base, file }) {
  const mergeSha = verifyRef(root, merge);
  if (!mergeSha) throw new JudgeError('merge SHA 取不到 commit：' + merge);
  const tipBlob = blobOid(root, ref, file);
  const mergeBlob = blobOid(root, mergeSha, file);
  if (tipBlob !== null && tipBlob === mergeBlob) {
    return { verdict: 'IDENTICAL', attributions: [], missingAdded: [], reappearedRemoved: [] };
  }
  // blob 不等（含"我有它没有"与"它有我没了"两种）—— 降级到行级，但必须能归因
  const delta = myLineDelta(root, base, ref, file);
  const mainText = mergeBlob === null ? '' : blobText(root, mergeBlob);
  const missingAdded = compareAddedLines(delta.added, splitLines(mainText));
  const reappearedRemoved = compareRemovedLines(delta.removed, splitLines(mainText));
  const attributions = attributionsFor(root, base, mergeSha, file, mergeSha);
  if (missingAdded.length > 0 || reappearedRemoved.length > 0) {
    return { verdict: 'LOST', attributions, missingAdded, reappearedRemoved };
  }
  if (attributions.length === 0) {
    return { verdict: 'UNATTRIBUTED', attributions: [], missingAdded: [], reappearedRemoved: [] };
  }
  return { verdict: 'DRIFT-ATTRIBUTED', attributions, missingAdded: [], reappearedRemoved: [] };
}

/**
 * 对 (ref, merges[]) 跑判据，返回结构化结果。不打印、不决定退出码。
 * 任何"判据自己没读到数"的情形置 judgeError=true 并附原因 —— 调用方必须走 2，不得读成 0 或 1。
 */
function collect(opts) {
  const root = opts.root || process.cwd();
  const res = {
    ref: opts.ref, merges: opts.merges || [], files: [], judgeError: false, reasons: [],
  };
  try {
    if (!opts.ref || !verifyRef(root, opts.ref)) throw new JudgeError('--ref 取不到提交：' + opts.ref);
    const refSha = verifyRef(root, opts.ref);
    if (opts.merges.length === 0) throw new JudgeError('merge SHA 清单为空');
    if (opts.base && !verifyRef(root, opts.base)) throw new JudgeError('--base 取不到提交：' + opts.base);
    for (const m of opts.merges) if (!verifyRef(root, m)) throw new JudgeError('--merge 取不到提交：' + m);

    // 逐个 merge 各取自己的 merge-base 与差量文件集，最后按文件取"最好的那个结论"。
    const perFile = new Map();
    for (const merge of opts.merges) {
      const mergeSha = verifyRef(root, merge);
      const mb = git(root, ['merge-base', refSha, mergeSha], true);
      if (!mb.ok || mb.out.trim() === '') throw new JudgeError('取不到 merge-base：' + refSha.slice(0, 8) + ' / ' + mergeSha.slice(0, 8));
      const base = mb.out.trim();
      const d = git(root, ['diff', '--name-only', base, refSha], true);
      if (!d.ok) throw new JudgeError('取改动集失败：' + base.slice(0, 8) + '..' + refSha.slice(0, 8));
      const files = splitLines(d.out).map((l) => l.replace(/[\r\n]+$/, '')).filter((l) => l !== '');
      for (const f of files) {
        const one = classifyFile(root, { ref: refSha, merge: mergeSha, base, file: f });
        const prev = perFile.get(f);
        if (!prev || RANK[one.verdict] < RANK[prev.verdict]) {
          perFile.set(f, Object.assign({ file: f, merge: mergeSha }, one));
        }
      }
    }
    res.files = [...perFile.values()];
    // 反失明：改动集为空一律算判据故障。"零个文件 ⇒ 零个问题"读起来完全像通过，
    // 而真实清理场景里它只会发生在 ref/base 取错（本文档 §1 的第 ① 类事故）。
    if (res.files.length === 0) throw new JudgeError('改动集为空（ref 与 base 同指一处？请核对 --ref/--base/--merge）');
    for (const f of res.files) {
      if (f.verdict === 'JUDGE_ERROR') throw new JudgeError('文件判定异常：' + f.file);
    }
  } catch (e) {
    if (e instanceof JudgeError) {
      res.judgeError = true;
      res.reasons.push(e.message);
    } else {
      throw e;
    }
  }
  return res;
}

// ---------------------------------------------------------------- CLI
const KNOWN_FLAGS = ['--ref', '--merge', '--base', '--root', '--json', '--help'];
const BOOL_FLAGS = ['--json', '--help'];

function parseArgv(argv) {
  const o = { merges: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(0, eq) : a;
    if (!KNOWN_FLAGS.includes(name)) throw new JudgeError('未知旗标：' + a + '（可用：' + KNOWN_FLAGS.join(' ') + '）');
    if (BOOL_FLAGS.includes(name)) { o[name.slice(2)] = true; continue; }
    // --flag=v 与 --flag v 两种写法都必须生效（只认一种会把"smoke 只跑 4 个"静默放大成整域两趟，同族实测见 AGENTS.md）
    let val = eq >= 0 ? a.slice(eq + 1) : argv[i + 1];
    if (eq < 0 && (val === undefined || String(val).startsWith('--'))) throw new JudgeError('旗标 ' + name + ' 缺取值');
    if (eq < 0) i++;
    if (name === '--ref') o.ref = val;
    else if (name === '--merge') o.merges = String(val).split(',').map((s) => s.trim()).filter(Boolean);
    else if (name === '--base') o.base = val;
    else if (name === '--root') o.root = val;
  }
  return o;
}

// 打印用：内部按 latin1 保字节，输出时还原成 UTF-8，否则中文行会变成乱码。
function show(line) {
  return Buffer.from(String(line), 'latin1').toString('utf8').replace(/[\r\n]+$/, '');
}

function main(argv) {
  let o;
  try {
    o = parseArgv(argv);
  } catch (e) {
    console.error('[BRANCH-MERGED] 参数不合法：' + e.message);
    return EXIT_JUDGE_ERROR;
  }
  if (o.help) {
    console.log('用法：node scripts/check-branch-merged.js --ref <branch|sha|tag> --merge <sha>[,<sha>...] [--base main] [--root <repo>] [--json]');
    console.log('退出码：0 内容已完整进主干（可删分支）/ 1 存在 LOST 或 UNATTRIBUTED（禁止删）/ 2 判据自身故障（同样禁止据此删）');
    return EXIT_OK;
  }
  if (!o.ref) { console.error('[BRANCH-MERGED] 缺 --ref（不得当成"没有问题"）'); return EXIT_JUDGE_ERROR; }
  if (o.merges.length === 0) { console.error('[BRANCH-MERGED] 缺 --merge（一个分支被两个 PR 用过时必须传两个）'); return EXIT_JUDGE_ERROR; }

  const r = collect({ ref: o.ref, merges: o.merges, base: o.base, root: o.root || process.cwd() });
  const counts = { IDENTICAL: 0, 'DRIFT-ATTRIBUTED': 0, LOST: 0, UNATTRIBUTED: 0, JUDGE_ERROR: 0 };
  for (const f of r.files) counts[f.verdict] = (counts[f.verdict] || 0) + 1;

  if (o.json) {
    console.log(JSON.stringify(Object.assign({}, r, { counts: counts }), null, 2));
  } else {
    for (const f of r.files) {
      console.log(f.file + ' ' + f.verdict +
        (f.attributions && f.attributions.length ? ' ←归因: ' + f.attributions.map((a) => a.subject.slice(0, 60)).join(' / ') : '') +
        (f.missingAdded && f.missingAdded.length ? ' 缺失新增行=' + f.missingAdded.map(show).slice(0, 3).join(' | ') : '') +
        (f.reappearedRemoved && f.reappearedRemoved.length ? ' 删除行复现=' + f.reappearedRemoved.map(show).slice(0, 3).join(' | ') : ''));
    }
  }
  console.log('[BRANCH-MERGED] ref=' + String(o.ref).slice(0, 12) +
    ' merges=' + r.merges.length + ' files=' + r.files.length +
    ' identical=' + counts.IDENTICAL + ' drift=' + counts['DRIFT-ATTRIBUTED'] +
    ' lost=' + counts.LOST + ' unattributed=' + counts.UNATTRIBUTED +
    ' judge_error=' + (r.judgeError ? 1 : 0));
  if (r.judgeError) {
    for (const why of r.reasons) console.error('[BRANCH-MERGED] 判据自身故障（按"未证实"处理，不得据此删分支）：' + why);
    return EXIT_JUDGE_ERROR;
  }
  if (counts.LOST > 0 || counts.UNATTRIBUTED > 0) return EXIT_LOST;
  return EXIT_OK;
}

module.exports = {
  VERDICTS, EXIT_OK, EXIT_LOST, EXIT_JUDGE_ERROR,
  splitLines, key, multisetOf, compareAddedLines, compareRemovedLines,
  classifyFile, collect, main, parseArgv,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
