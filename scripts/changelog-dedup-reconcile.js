#!/usr/bin/env node
'use strict';
/*
 * changelog-dedup-reconcile.js — CHANGELOG 清理结果的**独立**对账器
 *
 * 为什么需要它（QM-6 F-A，2026-10-07）：清理动作由 `check-changelog-duplicate-entries.js --dedup` 产生，
 * 而"清干净了没有"如果也由同一个脚本自己说，就是**被验证者与验证者同源** ——
 * 它对"块被挑错、标题被吃掉、新增行混进别的内容"这三类错误天生失明。
 * 规格里那条「对账证据 MUST NOT 复用产生清理的脚本自己的结论」要求的是第三个视角。
 *
 * 与 dedupe() 的关系：本器**不调用** dedupe 来产出任何东西；它只做核对。
 * 唯一一次调用 dedupe 是拿清理后的文本当被测对象，验证"再削一次应为 0 份"这条幂等性质。
 * 条目模型仍共用 changelog-entries.js —— 那是**判据口径**的单一实现，不是"结论"的复用。
 *
 * 用法：
 *   node scripts/changelog-dedup-reconcile.js --base=<sha> --head=HEAD [--root=<dir>]
 * 退出码：0 全部核对通过；1 任一核对不成立（点名是哪一条）；2 用法错误。
 */

const { execFileSync } = require('node:child_process');
const entries = require('./changelog-entries.js');

const FILE = 'CHANGELOG.md';

function parseArgs (argv) {
  const opts = { base: 'HEAD^', head: 'HEAD', root: process.cwd() };
  for (const a of argv) {
    if (a.startsWith('--base=')) opts.base = a.slice(7);
    else if (a.startsWith('--head=')) opts.head = a.slice(7);
    else if (a.startsWith('--root=')) opts.root = a.slice(7);
    else if (a.startsWith('--')) { console.error('unknown option: ' + a); process.exit(2); }
  }
  return opts;
}

function git (root, args) {
  return execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
}

/**
 * 独立核对五件事，全部成立才算"这次清理是无损的"：
 *  A1 base 的每一个标题在 head 里**至少还剩一份**，且 head 独有标题只能出现一次；
 *  A2 head 里保留下来的每一份块都能在 base 中找到**逐字节相同**的同源块（不是"相似"、不是 CR 归一后相等）；
 *  A3 保留的那一份就是 pickKeeper 会选的那一份（门禁说留哪份 == 修复真留哪份）；
 *  A4 再削一次必须 removed=0（幂等）；
 *  A5 除"base 没有的标题"的那些块之外，head 里不得出现任何**来源不明**的块；
 *     行级 `+/-` 只作为**信息**打印 —— 去重会把幸存块挪到该标题首次出现的槽位，
 *     所以行级新增必然包含重排噪声，把它当成"必须为 0"的判据是错的（本器第一版就是这么写、并被真实数据判红）。
 */
function reconcile ({ base, head, root }) {
  const baseText = git(root, ['cat-file', 'blob', `${base}:${FILE}`]);
  const headText = git(root, ['cat-file', 'blob', `${head}:${FILE}`]);

  const bBlocks = entries.splitEntries(baseText).blocks;
  const hBlocks = entries.splitEntries(headText).blocks;
  if (!bBlocks.length) throw new Error(`fail closed：${base}:${FILE} 一条条目都没有`);
  if (!hBlocks.length) throw new Error(`fail closed：${head}:${FILE} 一条条目都没有（零条目不是"无损清理"）`);

  const bg = entries.groupByTitle(bBlocks);
  const hg = entries.groupByTitle(hBlocks);
  const failures = [];

  const baseSet = new Set(bBlocks);
  // A6（QM-6 后端 MAJOR-3）：preamble 必须逐字节不变 —— 块级判据看得见条目，看不见文件头。
  const bPre = entries.splitEntries(baseText).preamble
  const hPre = entries.splitEntries(headText).preamble
  if (bPre !== hPre) failures.push(`A6 文件头（第一条标题之前的 ${Buffer.byteLength(bPre)} 字节）被改写，清理不得顺手改 preamble`)
  let keptFromBase = 0;
  // 遍历 base∪head 的标题并集：原先只遍历 head 的分组，于是"base 有、head 一份都不剩"这种
  // 最危险的形状只能靠后面一个补判循环才抓到，而循环内的 ho.length===0 分支因此是死代码。
  for (const t of new Set([...bg.keys(), ...hg.keys()])) {
    const bo = bg.get(t) || [];
    const ho = hg.get(t) || [];
    if (bo.length === 0) {
      if (ho.length > 1) failures.push(`A1 base 没有的新标题被插了多份：${t.slice(0, 70)} ×${ho.length}`);
      continue;
    }
    if (ho.length === 0) { failures.push(`A1 标题整条消失：${t.slice(0, 70)}（base 有 ${bo.length} 份）`); continue; }
    if (ho.length > bo.length) failures.push(`A1 副本反而变多：${t.slice(0, 70)} ${bo.length}→${ho.length}`);
    for (const o of ho) {
      const blk = hBlocks[o.index];
      // 本次新增的标题（base 里没有）本来就不可能有同源块，A2 对它不适用；它的份数由 A1 管。
      if (bo.length > 0 && !baseSet.has(blk)) failures.push(`A2 保留块在 base 中找不到逐字节同源块：${t.slice(0, 70)}`);
      else if (bo.length > 0) keptFromBase++;
    }
    // A3 只对"被削减成一份"的标题成立：没削的标题（ho.length>1）本来就多份并存，
    // 拿 pickKeeper 去要求每一份都会把"什么都没清理"误报成"留错了份"（实测踩过）。
    if (bo.length > 1 && ho.length === 1) {
      const keeper = entries.pickKeeper(bo);
      if (bBlocks[keeper.index] !== hBlocks[ho[0].index]) {
        failures.push(`A3 留下的不是 pickKeeper 选定的那份：${t.slice(0, 70)}`);
      }
    }
  }

  const again = entries.dedupe(headText);
  if (again.removed !== 0) failures.push(`A4 幂等不成立：对已清理的文本再跑一次仍会削掉 ${again.removed} 份`);

  const numstat = git(root, ['diff', '--numstat', `${base}..${head}`, '--', FILE]).trim().split(/\s+/);
  const addedLines = Number(numstat[0] || 0);
  const deletedLines = Number(numstat[1] || 0);
  // A5：结果必须是「每个标题恰好一块」——这条与顺序无关，因此不受重排影响；
  //     行级 +/- 只打印不判，因为去重必然引入位置移动（第一版把"新增行为 0"写成判据，被真实数据判红）。
  const newTitles = [...hg.keys()].filter((t) => !bg.has(t));
  if (hBlocks.length !== hg.size) {
    failures.push(`A5 结果里仍有同题多份：head 有 ${hBlocks.length} 块却只有 ${hg.size} 种标题`);
  }
  if (hg.size !== bg.size + newTitles.length) {
    failures.push(`A5 标题总数不闭合：base ${bg.size} + 新增 ${newTitles.length} ≠ head ${hg.size}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    base_entries: bBlocks.length,
    head_entries: hBlocks.length,
    base_distinct: bg.size,
    head_distinct: hg.size,
    base_redundant: bBlocks.length - bg.size,
    head_redundant: hBlocks.length - hg.size,
    titles_reduced: [...bg.values()].filter((g) => g.length > 1).length,
    kept_byte_identical: keptFromBase,
    added_lines: addedLines,
    deleted_lines: deletedLines,
    bytes: [Buffer.byteLength(baseText), Buffer.byteLength(headText)],
  };
}

function main (argv) {
  const opts = parseArgs(argv);
  let r;
  try {
    r = reconcile(opts);
  } catch (e) {
    console.error('[changelog-dedup-reconcile] FAIL(closed)：' + e.message);
    return 1;
  }
  console.log('[changelog-dedup-reconcile] ' + JSON.stringify({
    base_entries: r.base_entries, head_entries: r.head_entries,
    base_distinct: r.base_distinct, head_distinct: r.head_distinct,
    base_redundant: r.base_redundant, head_redundant: r.head_redundant,
    titles_reduced: r.titles_reduced, kept_byte_identical: r.kept_byte_identical,
    added_lines: r.added_lines, deleted_lines: r.deleted_lines,
    bytes: r.bytes.join(' -> '),
  }));
  if (!r.ok) {
    for (const f of r.failures.slice(0, 20)) console.error('  ✗ ' + f);
    if (r.failures.length > 20) console.error(`  …（另有 ${r.failures.length - 20} 项）`);
    console.error(`[changelog-dedup-reconcile] FAIL：${r.failures.length} 项独立核对不成立`);
    return 1;
  }
  console.log('[changelog-dedup-reconcile] OK：A1 标题守恒 / A2 逐字节同源(raw，非 CR 归一) / A3 留的是 pickKeeper 那份 / A4 幂等 / A5 每标题恰好一块且标题集闭合 / A6 preamble 逐字节不变 —— 六项全过（行级 +/- 为重排所致，仅列作信息）');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { FILE, reconcile, main };
