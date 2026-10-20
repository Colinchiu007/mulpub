#!/usr/bin/env node
'use strict';
/*
 * aggregate-changelog.js — 把执行记录里的变更说明聚合进台账（change: changelog-record-carrier）
 *
 * 为什么要有它（2026-10-20 实测）：`CHANGELOG.md` 与 `01-docs/learnings.md` 是「每 PR 在第 1 行插入」
 * 的共享写面，任意两个在飞 PR 必然抢同一位置。当场对 4 个可判定的非 MERGEABLE PR 跑
 * `git merge-tree --write-tree origin/main <pr-head>`，冲突文件**只有**这两个，没有第三类文件；
 * 最近 30 笔 main 提交里 20 笔动了 CHANGELOG。`scripts/changelog-dedup-regen.js` 的头注释已经把
 * 代价写清楚：main 每约 37 分钟前进一次、一轮 CI 25-30 分钟，所以"按 base 算我的块再 prepend"
 * 结构上不可能成功。本脚本把写入者收敛成一个：PR 只写 `openspec/records/<分支>.md`（按分支名一份，
 * 路径唯一 ⇒ 零冲突），台账由这里追加。
 *
 * 幂等键为什么必须是 **record 名**而不是标题文本：主干上同一标题存在多份历史副本（AGENTS.md
 * 2026-10-17 读数 `CHANGELOG.md` 3348 个重复行键；活数，引用前重取）。按标题判「已落」会把
 * 应当新搬的一条误判成已搬，症状是**静默少一条**——比多搬一条更难被发现。
 * 现存的 CHANGELOG 标题末尾括号本来就写着 change slug（例：`……（debt-cli-root-injection）`），
 * 与 `openspec/records/<slug>.md` 同名 ⇒ 这套键对存量现状直接生效，不会把已合并的条目搬第二遍。
 *
 * 行尾：逐行原样搬运，禁止"探测多数派后统一回写"（AGENTS.md 实测：统一回写一次改写 26 行，
 * 且此后任何并发合并都变成整文件冲突）。
 *
 * 依赖：只允许 node 内置 + 仓内 `./changelog-entries.js`（台账条目模型只有一份实现，
 * 判「什么是一条条目」不得在这里再写一遍正则）。CI 落点是 quality-gate.yml 的 `changes` 作业，
 * 该作业无 Install deps ⇒ 由 scripts/aggregate-changelog.test.js T8 机械守住这条。
 *
 * 用法：
 *   node scripts/aggregate-changelog.js                          # 默认 dry-run，只打印读数
 *   node scripts/aggregate-changelog.js --write                  # 真写入两个台账
 *   node scripts/aggregate-changelog.js --root=<dir> --dry-run   # 夹具根（行为锁用它，不碰真仓）
 * 退出码：0 正常（含"本轮无待搬"）；2 判据自身故障（根/台账读不到、参数非法）。
 * 「一条都没搬」不是失败态，所以它必须是 0 + 首行读数出声，而不是靠退出码区分。
 */

const fs = require('node:fs');
const path = require('node:path');
const entries = require('./changelog-entries.js');

// 小节标题逐字精确（`##` 后允许多空格、允许行尾 CR）—— 同 changelog-entries 的实测口径。
// 刻意不接受后缀变体：openspec/records/member-tier-contract.md:130（PR #4051）写的是
// `## CHANGELOG 条目（暂移到执行记录：热文件冲突说明）`，那是一位作者被热文件冲突逼出来的自发形态。
// 合同这里取严格，但该记录必须进 missingSection 出声，不能被读成"仓库里没有待搬条目"。
const CHANGELOG_SECTION_RE = /^##[ \t]+CHANGELOG 条目[ \t]*$/;
const LEARNINGS_SECTION_RE = /^##[ \t]+learnings[ \t]*$/;
const H2_RE = /^##[ \t]+\S/;
const FENCE_RE = /^\s{0,3}(?:`{3,}|~{3,})/;
const LESSON_RE = /^###[ \t]+lesson:[ \t]*\S/m;
const RECORD_NAME_RE = /（([^（）\r\n]+)）[ \t\r]*$/;
const MARKER_RE = /<!--\s*aggregate:record=([^\s>]+)\s*-->/g;
const DATE_RE = /^date:[ \t]*([^\s]+)[ \t]*$/m;

/** 逐行扫描并保留每行自己的行尾 —— split(/\r?\n/) 会把"这行原本用什么行尾"丢掉。 */
function scanLines (text) {
  const out = [];
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl + 1;
    const raw = text.slice(pos, end);
    out.push({ raw, content: raw.replace(/\r?\n$/, '') });
    if (nl === -1) break;
    pos = end;
  }
  return out.filter((l, i) => !(i === out.length - 1 && l.raw === ''));
}

/**
 * 找小节边界。围栏（``` / ~~~）内的行一律不参与判定 —— 规范文档与本仓多条门禁的注释里
 * 会原样抄写小节名，按 substring 找会把引用点当成小节起点（AGENTS.md「禁令与存在性判据
 * 必须按语义位置切」那条的同族）。
 */
function sectionMarks (lines) {
  const marks = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].content;
    if (FENCE_RE.test(c)) { fence = !fence; continue; }
    if (fence) continue;
    if (CHANGELOG_SECTION_RE.test(c)) marks.push({ kind: 'changelog', i });
    else if (LEARNINGS_SECTION_RE.test(c)) marks.push({ kind: 'learnings', i });
    else if (H2_RE.test(c)) marks.push({ kind: 'other', i });
  }
  return marks;
}

/** 取某小节的正文：到下一个顶层 H2 为止；只剥首尾空行，块内空行逐字节保留。 */
function bodyOf (lines, marks, at) {
  const end = at + 1 < marks.length ? marks[at + 1].i : lines.length;
  let b = marks[at].i + 1;
  let e = end;
  while (b < e && lines[b].content === '') b += 1;
  while (e > b && lines[e - 1].content === '') e -= 1;
  return lines.slice(b, e).map((l) => l.raw).join('');
}

function parseRecordSections (text) {
  const lines = scanLines(String(text === undefined || text === null ? '' : text));
  const marks = sectionMarks(lines);
  const cl = marks.findIndex((m) => m.kind === 'changelog');
  const ln = marks.findIndex((m) => m.kind === 'learnings');
  const changelog = cl === -1 ? null : bodyOf(lines, marks, cl);
  const learnings = ln === -1 ? null : bodyOf(lines, marks, ln);
  return {
    changelog,
    learnings,
    // 小节存在但里面没有任何 `### lesson: <slug>` ⇒ 形状非法。缺席是合法状态，不判。
    learningsShapeError: learnings !== null && !LESSON_RE.test(learnings),
  };
}

/** 块的首个非空行必须是一条台账条目标题（沿用 changelog-entries 的唯一判据）。 */
function startsAsEntry (block) {
  const first = scanLines(block).find((l) => l.content !== '');
  return Boolean(first) && entries.isEntryHeading(first.content);
}

/** 把 record 名写进标题末尾括号，使「是否已落」可以从台账本身推导出来；已有同名后缀则不动。 */
function ensureSlugSuffix (block, name) {
  const lines = scanLines(block);
  const i = lines.findIndex((l) => l.content !== '');
  if (i === -1 || !entries.isEntryHeading(lines[i].content)) return block;
  const m = RECORD_NAME_RE.exec(lines[i].content);
  if (m && m[1] === name) return block;
  const eol = lines[i].raw.slice(lines[i].content.length);
  lines[i] = { content: `${lines[i].content}（${name}）`, raw: `${lines[i].content}（${name}）${eol}` };
  return lines.map((l) => l.raw).join('');
}

/** 台账里已经出现过的 record 名（按条目标题末尾括号推导）。 */
function landedRecordNames (archiveText) {
  const set = new Set();
  for (const h of entries.headingsOf(String(archiveText === undefined || archiveText === null ? '' : archiveText))) {
    const m = RECORD_NAME_RE.exec(h);
    if (m) set.add(m[1]);
  }
  return set;
}

/**
 * 台账里已存在的**完全裸标题**（标题末尾**不带任何括号组**的那些）。
 * 为什么需要它：迁移窗口内有人手写条目，那些标题没带 record 名后缀，landedRecordNames 看不见，
 * 于是同一条内容会被再搬一遍 —— 而往一份 3 MB 的人读台账里塞重复块，正是本仓付过
 * 3348 个重复行键代价的形态。
 * 为什么只收"完全裸标题"（QM-6 轮 2 的 i7）：若把 `# fix(x): 标题（#4051）` 这类**天然带括号**
 * 的标题也剥成裸标题来比，会把不同条目误判成重复 ⇒ **静默跳过一条真该搬的**。取舍是刻意的：
 * 误重复有另一把锁兜（`check-changelog-duplicate-entries` 拦"本 PR 让副本变多"），
 * 误跳过**没有任何东西会响**。宁可漏拦一次重复，不可静默吃掉一条真条目。
 * 这道闸也永远不是主键 —— 主键是 record 名（见 T4/T17b）。
 */
function bareTitles (archiveText) {
  const set = new Set();
  for (const h of entries.headingsOf(String(archiveText === undefined || archiveText === null ? '' : archiveText))) {
    const t = h.trim();
    if (!/[（(][^（()]*[)）]$/.test(t)) set.add(t);
  }
  return set;
}

/** 取块的首个非空行文本（注入后缀**之前**的标题），供裸标题闸做精确比对。 */
function firstLineContent (blockText) {
  const first = scanLines(blockText).find((l) => l.content !== '');
  return first ? first.content.trim() : '';
}

function readDate (file) {
  try {
    const m = DATE_RE.exec(fs.readFileSync(file, 'utf8').slice(0, 4096));
    return m ? m[1] : '';
  } catch (e) {
    return '';
  }
}

/** 排序：日期新的在前，同日按 record 名字典序 —— 并列必须稳定，否则两次运行插入顺序不同会造出幽灵 diff。 */
function orderPending (list) {
  return list.slice().sort((a, b) => (a.date === b.date
    ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    : (a.date < b.date ? 1 : -1)));
}

function collectRecords (root) {
  const dir = path.join(root, 'openspec', 'records');
  if (!fs.existsSync(dir)) throw new Error(`AGG_ROOT_MISSING: 读不到 ${dir} —— 读不到不等于仓库里没有待搬记录`);
  // 下划线开头的是占位物而非记录：`_TEMPLATE.md`（模板）、`_legacy-absent.md`（历史缺席占位）、
  // `_exempt/`（豁免目录）。把它们当候选会让每次 dry-run 读数虚高，且模板本身永远"缺小节"，
  // 于是 missing 计数恒 >0 —— 一个恒不为零的计数和一个恒绿的门禁一样没人看。
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.md') && !d.name.startsWith('_'))
    .map((d) => ({ name: d.name.slice(0, -3), path: path.join(dir, d.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function aggregate ({
  root = path.resolve(__dirname, '..'),
  dryRun = true,
  changelogRel = 'CHANGELOG.md',
  learningsRel = path.join('01-docs', 'learnings.md'),
} = {}) {
  const files = collectRecords(root);
  const r = {
    records: files.length, missingSection: [], malformed: [], learningsShapeError: [],
    landed: [], skipped: [], learningsLanded: [], learningsSkipped: [], duplicateRisk: [],
    text: '', learningsText: '', wrote: false, dryRun: Boolean(dryRun),
  };
  const pendingChangelog = [];
  const pendingLearnings = [];

  for (const f of files) {
    let raw;
    try {
      raw = fs.readFileSync(f.path, 'utf8');
    } catch (e) {
      // 读不动单篇不等于没有待搬：出声并继续，但绝不静默当它不存在。
      r.malformed.push(`${f.name} (unreadable)`);
      continue;
    }
    const p = parseRecordSections(raw);
    if (p.changelog === null) r.missingSection.push(f.name);
    else if (!startsAsEntry(p.changelog)) r.malformed.push(f.name);
    else pendingChangelog.push({
      name: f.name,
      date: readDate(f.path),
      // 裸标题闸比的是**注入后缀之前**的标题；存两个字段而不是现算，
      // 是为了让"比什么"这件事在数据结构上写明白，不靠读正则反推。
      title: firstLineContent(p.changelog),
      text: ensureSlugSuffix(p.changelog, f.name),
    });

    if (p.learnings !== null) {
      if (p.learningsShapeError) r.learningsShapeError.push(f.name);
      else pendingLearnings.push({ name: f.name, date: readDate(f.path), text: p.learnings });
    }
  }

  r.text = applyTo(r, orderPending(pendingChangelog), path.join(root, changelogRel), {
    bucket: 'landed', skipBucket: 'skipped', dryRun: r.dryRun,
  });
  r.learningsText = applyTo(r, orderPending(pendingLearnings), path.join(root, learningsRel), {
    bucket: 'learningsLanded', skipBucket: 'learningsSkipped', marker: true, dryRun: r.dryRun,
  });
  r.wrote = !r.dryRun && (r.landed.length > 0 || r.learningsLanded.length > 0);
  return r;
}

/**
 * 把待搬块追加到台账顶部。learnings 没有"标题末尾括号"这个天然承载位（块首是
 * `### lesson: <slug>`，硬塞 record 名会污染 slug），所以那里改用 HTML 注释标记；
 * 两处判重机制为什么不同（实测，不是偏好）：`CHANGELOG.md` 的条目是 H1，用同一把 `headingsOf` 量
 * `01-docs/learnings.md` 只数到 12 个 H1（7 种）—— 它的条目实际是 `## <标题>` / `### lesson: <slug>`。
 * 所以"标题末尾带 record 名"这套键在 learnings 上不成立：硬套会让第二趟照搬（永远判不出已落）。
 */
function applyTo (r, pending, file, opt) {
  if (!pending.length) return '';
  if (!fs.existsSync(file)) throw new Error(`AGG_ARCHIVE_MISSING: 读不到 ${file} —— 台账缺失时不得"新建一份只含本批条目"的文件`);
  const original = fs.readFileSync(file, 'utf8');
  const seen = opt.marker
    ? new Set([...original.matchAll(MARKER_RE)].map((m) => m[1]))
    : landedRecordNames(original);
  const bare = opt.marker ? null : bareTitles(original);
  const out = [];
  for (const b of pending) {
    if (seen.has(b.name)) { r[opt.skipBucket].push(b.name); continue; }
    // 第二道出声闸：裸标题已在台账里（手写条目没带后缀的那类），不搬、点名，不算已落。
    if (bare && bare.has(b.title)) { r.duplicateRisk.push(b.name); continue; }
    seen.add(b.name);
    r[opt.bucket].push(b.name);
    out.push(opt.marker ? `<!-- aggregate:record=${b.name} -->\n${b.text}` : b.text);
  }
  const rendered = out.join('') + original;
  if (!opt.dryRun && out.length) writeAtomic(file, rendered);
  return rendered;
}

/**
 * 原子替换：临时文件 + rename，Windows 上只对 EPERM/EACCES/EBUSY 做有界退避重试
 * （AGENTS「Windows 原子文件替换重试」：其它错误原样抛，禁止无限重试或退化成直接覆盖）。
 * 台账是 3 MB 的人读文件，半截写入比少搬一条更难收拾。
 */
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
function writeAtomic (file, text) {
  const tmp = `${file}.mp-agg-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  let delay = 20;
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (!RETRYABLE.has(e.code) || attempt >= 5) {
        try { fs.rmSync(tmp, { force: true }); } catch (_) { /* 原始错误更要紧，别把它盖掉 */ }
        throw e;
      }
      const until = Date.now() + delay;
      while (Date.now() < until) { /* 有界退避，不用 worker 死循环 */ }
      delay *= 2;
    }
  }
}

function formatReport (r) {
  return `AGGREGATE records=${r.records} missing=${r.missingSection.length} malformed=${r.malformed.length}`
    + ` learningsShape=${r.learningsShapeError.length} landed=${r.landed.length} skipped=${r.skipped.length}`
    + ` duprisk=${r.duplicateRisk.length} learningsLanded=${r.learningsLanded.length} mode=${r.dryRun ? 'dry' : 'write'}`;
}

function parseArgs (argv) {
  const opt = { dryRun: true, verbose: false };
  for (const a of argv) {
    if (a === '--dry-run') opt.dryRun = true;
    else if (a === '--write') opt.dryRun = false;
    else if (a === '--verbose') opt.verbose = true;
    else if (a.startsWith('--root=')) opt.root = path.resolve(a.slice('--root='.length));
    else throw new Error(`AGG_ARG: 未知或非法参数 ${a}（只接受 --write / --dry-run / --verbose / --root=<dir>）`);
  }
  return opt;
}

// 迁移期 593 篇记录全都"缺小节"，全量明细会把 CI 日志淹掉，于是首行读数和真实缺陷一起变成没人读的噪音。
// 默认每类只列前若干条，剩余给计数；首行读数永远是全量的，不受这里影响。
function printList (label, list, limit) {
  if (!list.length) return;
  const shown = list.slice(0, limit);
  for (const n of shown) console.log(`  ${label} ${n}`);
  if (list.length > shown.length) console.log(`  ${label} …(+${list.length - shown.length}，全量看 --verbose)`);
}

if (require.main === module) {
  try {
    const opt = parseArgs(process.argv.slice(2));
    const r = aggregate(opt);
    const limit = opt.verbose ? Infinity : 20;
    console.log(formatReport(r));
    printList('MISSING_SECTION', r.missingSection, limit);
    printList('MALFORMED', r.malformed, limit);
    printList('LEARNINGS_SHAPE', r.learningsShapeError, limit);
    printList('DUPLICATE_RISK', r.duplicateRisk, limit);
    printList('LAND', r.landed, limit);
    printList('SKIP', r.skipped, limit);
  } catch (e) {
    console.error(`[aggregate-changelog] 自身故障：${e.message}`);
    process.exit(2);
  }
}

module.exports = {
  parseRecordSections,
  startsAsEntry,
  ensureSlugSuffix,
  landedRecordNames,
  collectRecords,
  aggregate,
  formatReport,
  parseArgs,
};
