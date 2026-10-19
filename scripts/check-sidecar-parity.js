#!/usr/bin/env node
/**
 * 跨仓「单源规则表 + 共享向量」对账（sidecar ↔ mulpub）。
 *
 * ## 它补的是哪一半
 *
 * 两仓各有一条本仓对账（`sidecar-parity.lock.json` 登记 LF 归一化 sha256，各查自己那一半）。
 * 那两条挡得住「改了数据忘改锁」，**挡不住这个**：
 *
 *   有人在本仓把【数据 + 锁】一起更新（本仓 CI 全绿），而另一仓的【数据 + 锁】还是旧的。
 *   两仓各自内部一致，跨仓却已经漂了 —— 单仓判据永远看不见这一格。
 *
 * 本脚本同时读两个 checkout，把跨仓一致性变成一条判据。它不需要网络：给两个本地路径即可，
 * 由 `.github/workflows/sidecar-parity.yml` 在 clone 两个仓库后调用。
 *
 * ## 用法
 *
 *   node scripts/check-sidecar-parity.js --sidecar <path-to-smart-sentence-splitter>
 *   node scripts/check-sidecar-parity.js --sidecar <path> --json
 *
 * 退出码：0 一致 / 1 检测到漂移 / 2 用法或 IO 错误（不得读成"一致"）。
 *
 * ## 为什么只比「LF 归一化字节哈希」
 *
 * 跨语言侧（Python `json.dumps` 与 JS `JSON.stringify` 的浮点与转义规则不同）没有可靠的
 * 公共 JSON 规范化实现。用两套规范化再互相比较，等于在判据里埋一个自己就会漂移的东西。
 * 字节级 + 只抹平 CRLF 是最小、且 Python/JS 各三行就能实现的公共口径。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** LF 归一化后取 sha256（与 TS/JS/Python 三侧同一口径）。 */
function lfSha256(absPath) {
  const data = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * 纯比较核心：输入两侧的路径与哈希，输出问题清单（空数组 = 一致）。
 * 抽成纯函数是为了让测试能直接喂构造数据，不必落两棵真目录树。
 */
function compareParity(left, right) {
  const problems = [];

  // 1) 两个锁文件必须逐字相同（同一份登记表，两边抄的必须是同一份）
  // 1) 两个锁文件必须相同（同一份登记表，两边抄的必须是同一份）。
  //    比的是 **LF 归一化后**的内容：两仓检出行为不同（mulpub 的 .gitattributes 是 text=auto
  //    → Windows 工作树为 CRLF；sidecar 为 LF），用原字节比会稳定假红。
  //    这与全脚本「字节哈希 + 只抹平 CRLF」的口径一致——真实运行第一次就踩到了这一格。
  if (left.lockTextLf !== right.lockTextLf) {
    problems.push('锁文件两仓不一致（LF 归一化后仍不同）：' + left.label + ' 与 ' + right.label + ' 的 sidecar-parity.lock.json 内容不同');
  } else if (!left.lock || !right.lock) {
    problems.push('锁文件无法解析为 JSON：' + (left.lock ? right.label : left.label));
  }

  // 2) 各自数据要匹配各自的锁（本仓内部一致）
  for (const side of [left, right]) {
    if (!side.lock) continue;
    if (side.rulesSha !== side.lock.rulesLfSha256) {
      problems.push(side.label + ' 的规则表与【本仓锁】不一致（本仓对账应当已红，说明有人只改了锁或只改了数据）');
    }
    if (side.vectorsSha !== side.lock.vectorsLfSha256) {
      problems.push(side.label + ' 的向量与【本仓锁】不一致（同上）');
    }
  }

  // 3) 跨仓数据必须逐字相同（这才是本脚本存在的理由）
  return problems.concat(compareSharedArtifacts(left, right));
}

/**
 * 跨仓共享产物的逐对比较。
 *
 * `rules` / `vectors` 是**承重**的两份（有锁登记）；`corpus` / `golden` 是后加的第三、四份：
 * 语料与金标同样是两仓各存一份副本，而金标只在 mulpub 侧被消费 —— 若两仓副本漂了，
 * **没有任何单仓判据看得见**（sidecar 侧不读金标，mulpub 侧不看 sidecar）。
 * 缺一侧时如实报告「只在一侧存在」，不读成一致：那通常意味着忘了复制过去。
 */
function compareSharedArtifacts(left, right) {
  const problems = [];
  const pairs = [
    ['rules', '跨仓规则表已漂移'],
    ['vectors', '跨仓向量已漂移'],
    ['corpus', '跨仓语料已漂移'],
    ['golden', '跨仓金标已漂移'],
  ];
  for (const [key, label] of pairs) {
    const a = left[key + 'Sha'];
    const b = right[key + 'Sha'];
    if (!a && !b) continue; // 两侧都没有：不是本脚本要判的东西
    if (!a || !b) {
      problems.push(label + '：只在一侧存在（' + left.label + '=' + (a ? '有' : '缺') + '，'
        + right.label + '=' + (b ? '有' : '缺') + '）——通常是忘了把文件复制到另一仓');
      continue;
    }
    if (a !== b) {
      problems.push(label + '：' + left.label + '=' + a.slice(0, 12) + '… 与 '
        + right.label + '=' + b.slice(0, 12) + '… 不同');
    }
  }
  return problems;
}

/** 把一个 checkout 读成比较用的快照。语料/金标在旧 checkout 里可能不存在 ⇒ 如实给 null。 */
function readSide(label, rulesAbs, vectorsAbs, lockAbs, optional = {}) {
  const lockText = fs.readFileSync(lockAbs, 'utf8');
  let lock = null;
  try {
    lock = JSON.parse(lockText);
  } catch {
    lock = null;
  }
  const optionalSha = (p) => (p && fs.existsSync(p) ? lfSha256(p) : null);
  return {
    label,
    lock,
    lockText,
    // 锁文件的比较口径与数据一致：只抹平 CRLF。两仓检出行为不同，原字节比必假红。
    lockTextLf: lockText.replace(/\r\n/g, '\n'),
    rulesSha: lfSha256(rulesAbs),
    vectorsSha: lfSha256(vectorsAbs),
    corpusSha: optionalSha(optional.corpusAbs),
    goldenSha: optionalSha(optional.goldenAbs),
  };
}

const MULPUB_SIDE = {
  label: 'mulpub',
  rules: path.join('packages', 'story2video-engine', 'src', 'subtitle-rules.json'),
  vectors: path.join('packages', 'story2video-engine', 'tests', 'fixtures', 'subtitle_segmentation_vectors.json'),
  lock: path.join('packages', 'story2video-engine', 'tests', 'fixtures', 'sidecar-parity.lock.json'),
  corpus: path.join('packages', 'story2video-engine', 'tests', 'fixtures', 'subtitle_parity_corpus.json'),
  golden: path.join('packages', 'story2video-engine', 'tests', 'fixtures', 'subtitle_python_golden.json'),
};

const SIDECAR_SIDE = {
  label: 'sidecar',
  rules: path.join('src', 'splitter', 'scene_subtitle', 'subtitle_rules.json'),
  vectors: path.join('tests', 'vectors', 'subtitle_segmentation_vectors.json'),
  lock: path.join('tests', 'vectors', 'sidecar-parity.lock.json'),
  corpus: path.join('tests', 'vectors', 'subtitle_parity_corpus.json'),
  golden: path.join('tests', 'vectors', 'subtitle_python_golden.json'),
};

function collectDirProblems(dir, spec) {
  const missing = [spec.rules, spec.vectors, spec.lock].filter((rel) => !fs.existsSync(path.join(dir, rel)));
  return missing.map((rel) => spec.label + ' 缺少文件：' + rel + '（在 ' + dir + ' 下）');
}

function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const i = args.indexOf('--sidecar');
  if (i < 0 || !args[i + 1]) {
    console.error('用法: node scripts/check-sidecar-parity.js --sidecar <smart-sentence-splitter 路径> [--mulpub <mulpub 路径>] [--json]');
    return 2;
  }
  const sidecarDir = path.resolve(args[i + 1]);
  // --mulpub 默认取本脚本所在仓库；显式给值是为了让测试能喂两棵临时目录树，
  // 不必依赖真实 checkout 的当前内容（否则这份测试会随数据变化而漂移）。
  const m = args.indexOf('--mulpub');
  const mulpubDir = m >= 0 && args[m + 1] ? path.resolve(args[m + 1]) : path.resolve(__dirname, '..');

  const problems = [];
  for (const [dir, spec] of [[mulpubDir, MULPUB_SIDE], [sidecarDir, SIDECAR_SIDE]]) {
    if (!fs.existsSync(dir)) {
      problems.push(spec.label + ' 路径不存在：' + dir);
      continue;
    }
    problems.push(...collectDirProblems(dir, spec));
  }
  if (problems.length > 0) {
    if (json) console.log(JSON.stringify({ ok: false, problems }, null, 2));
    else for (const p of problems) console.error('✗ ' + p);
    return 2;
  }

  const left = readSide(MULPUB_SIDE.label,
    path.join(mulpubDir, MULPUB_SIDE.rules),
    path.join(mulpubDir, MULPUB_SIDE.vectors),
    path.join(mulpubDir, MULPUB_SIDE.lock),
    {
      corpusAbs: path.join(mulpubDir, MULPUB_SIDE.corpus),
      goldenAbs: path.join(mulpubDir, MULPUB_SIDE.golden),
    });
  const right = readSide(SIDECAR_SIDE.label,
    path.join(sidecarDir, SIDECAR_SIDE.rules),
    path.join(sidecarDir, SIDECAR_SIDE.vectors),
    path.join(sidecarDir, SIDECAR_SIDE.lock),
    {
      corpusAbs: path.join(sidecarDir, SIDECAR_SIDE.corpus),
      goldenAbs: path.join(sidecarDir, SIDECAR_SIDE.golden),
    });

  const verdict = compareParity(left, right);

  if (json) {
    console.log(JSON.stringify({
      ok: verdict.length === 0,
      mulpub: { rules: left.rulesSha, vectors: left.vectorsSha },
      sidecar: { rules: right.rulesSha, vectors: right.vectorsSha },
      problems: verdict,
    }, null, 2));
  } else {
    const fmt = (side) => {
      const parts = [
        'rules=' + side.rulesSha.slice(0, 12) + '…',
        'vectors=' + side.vectorsSha.slice(0, 12) + '…',
        'corpus=' + (side.corpusSha ? side.corpusSha.slice(0, 12) + '…' : '(缺)'),
        'golden=' + (side.goldenSha ? side.goldenSha.slice(0, 12) + '…' : '(缺)'),
      ];
      return '[sidecar-parity] ' + side.label.padEnd(7) + ' ' + parts.join(' ');
    };
    console.log(fmt(left));
    console.log(fmt(right));
    if (verdict.length === 0) {
      console.log('[sidecar-parity] PASS 两仓共享产物逐字节一致（LF 归一化）：规则表 / 向量 / 语料 / 金标');
    } else {
      for (const p of verdict) console.error('✗ ' + p);
      console.error('[sidecar-parity] 正解：把两仓的数据、锁、金标**同批**改成一致，不要只改一边。');
    }
  }
  return verdict.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { lfSha256, compareParity, readSide, main, MULPUB_SIDE, SIDECAR_SIDE };
