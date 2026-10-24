#!/usr/bin/env node
'use strict';
/*
 * check-spec-delta-coverage.js —— 主规格不得因本次合并而丢失基线内容
 *
 * 为什么需要它（实测，2026-10-24）：
 * openspec 的 delta 语义是**增量补丁**，不是完整重写。权威出处
 * `.opencode/skills/openspec-sync-specs/SKILL.md` 的「MODIFIED Requirements」一节：
 *
 *   **MODIFIED Requirements:**
 *   - Find the requirement in main spec
 *   - Apply the changes - this can be:
 *     - Adding new scenarios the main spec does not have yet
 *     - Modifying existing scenarios
 *     - Changing the requirement description
 *   - **Preserve scenarios/content not mentioned in the delta**
 *
 * 最后一行是**散文约定**：合并 delta 进主规格时，必须保留 delta 没提到的 Scenario/内容。
 * 而这句约定此前**没有任何机器消费者**（全仓 grep 「Preserve scenarios」只命中这份文档自身）——
 * 属于本仓反复出现过的「注册≠注入≠生效」家族：写了、没接线、没检查。
 *
 * 于是后果很具体：一次 delta 合并若把基线里的某条 Scenario 抹掉，
 * **全仓没有任何门禁会红**。本次实测（本 PR 自己的 merge）就撞上了这个洞：
 * 两个 change 的 delta 各只写了基线 5 条 Scenario 里的 3 条，
 * 靠人工逐条对账才没丢——**下一次靠自觉的概率就不是 1 了**。
 *
 * 本门禁把这句散文变成会红的东西：合并后（base ⊕ head）的主规格，
 * 必须包含基线（merge-base）主规格里的每一个 Requirement 与每一条 Scenario。
 *
 * 三条口径（每一条都有理由，不是顺手加的）：
 *
 * ① **事后对账，不事前查 delta。**
 *    事前判据（"delta 的 MODIFIED 块必须自包含基线全部 Scenario"）**是错的**：
 *    openspec 的 MODIFIED 是增量语义，delta 不自包含是**合法写法**。
 *    实测该误判会红 3 处，其中 2 处是本仓自己按增量语义写的 change。
 *    事后判据直接对着"合并结果"断言，不依赖作者怎么组织 delta。
 *
 * ② **基线取 merge-base，不是 base 分支当前 HEAD。**
 *    PR 打开期间 base 分支可能前进；若拿 base 的当前 HEAD 当基线，
 *    别人新加的 Scenario 会被算成"本次丢失"⇒ 假红。
 *    与 build.yml package-relevant、classify-docs-only.changedFileStatuses 同一口径。
 *
 * ③ **扫描域由变更集决定，不按目录遍历。**
 *    只对本次变更集里碰过的主规格做对账。理由：本判据要抓的是"本次合并弄丢了什么"，
 *    与"谁改的"无关；而全量扫描会要求每次 PR 都重扫 154 份主规格（实测 0.7 s，
 *    不算贵），却把"本 PR 到底动了哪些主规格"这个关键信息冲淡。
 *    扫描域由 git diff 决定 ⇒ 不会塌缩（不像目录遍历可能读到改名后的空集）。
 *
 * 退出码语义（与仓内其它判据一致，**看语义不看数字**）：
 *   0 = 通过（或"本 PR 不涉及主规格，无对象可判"）
 *   1 = 有违规（基线内容在合并后消失）
 *   2 = 判据自身故障（取证失败：base/head/ref 不可解析、变更集取不到等）
 *
 * 用法：node scripts/check-spec-delta-coverage.js --base=<ref> [--head=HEAD] [--repo=<dir>]
 * 回归：node --test scripts/check-spec-delta-coverage.test.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { changedFileStatuses } = require('./classify-docs-only');

const SPEC_FILE_RE = /^openspec\/specs\/.+\/spec\.md$/;
const CHANGE_DELTA_RE = /^openspec\/changes\/.+\/specs\/.+\/spec\.md$/;

function git(repo, args) {
  return execFileSync('git', ['-C', repo].concat(args), {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60000,
  });
}

/** 读某 ref 下的文件内容；不存在返回 null（用于"新增文件 base 侧没有"这种正常情况）。 */
function readAt(repo, ref, file) {
  try {
    return git(repo, ['show', `${ref}:${file}`]);
  } catch (e) {
    // git show 对"路径不存在"返回非 0。但也可能是 ref 本身不可解析 —— 那要报错，不能吞。
    const msg = String((e && e.stderr) || (e && e.message) || e);
    if (/does not exist|exists on disk, but not in|Path .* does not exist|bad revision|unknown revision/i.test(msg)) {
      return null;
    }
    throw new Error(`git show ${ref}:${file} 失败：${msg}`);
  }
}

/**
 * 解析主规格 → Map<Requirement 标题, Set<Scenario 名>>。
 *
 * 块边界：Requirement 块从 `### Requirement: X` 起，到下一个 `### Requirement:`
 * 或任何 1~3 级标题为止。`#### Scenario:` 是 4 级，不切块（Scenario 属于同一 Requirement）。
 * 同一标题重复出现时**并集合并**（不因重名误报），因为"重名"是主规格自身的既有形态。
 */
function parseSpec(text) {
  const reqs = new Map();
  let cur = null;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const reqM = /^###\s+Requirement:\s*(.+)$/.exec(line);
    if (reqM) {
      const title = reqM[1].trim();
      if (!reqs.has(title)) reqs.set(title, new Set());
      cur = reqs.get(title);
      continue;
    }
    const scnM = /^####\s+Scenario:\s*(.+)$/.exec(line);
    if (scnM) {
      if (cur) cur.add(scnM[1].trim());
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      // 1~3 级标题且不是 Requirement ⇒ 当前 Requirement 块结束。
      cur = null;
    }
  }
  return reqs;
}

/**
 * 从一份 change delta 里收集"声明过的合法删除/改名"。
 *   ## REMOVED Requirements → `### Requirement: X`        ⇒ X 允许从主规格消失
 *   ## RENAMED Requirements → `- FROM: ### Requirement: X` ⇒ X 允许从主规格消失（Y 应在 head 存在）
 */
function collectDeltaDeclarations(text) {
  const removed = new Set();
  const renamedFrom = new Set();
  let section = null;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const h2 = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements$/.exec(line);
    if (h2) {
      section = h2[1];
      continue;
    }
    if (/^##\s+/.test(line)) {
      section = null;
      continue;
    }
    if (section === 'REMOVED') {
      const m = /^###\s+Requirement:\s*(.+)$/.exec(line);
      if (m) removed.add(m[1].trim());
    } else if (section === 'RENAMED') {
      const m = /^-\s*FROM:\s*###\s+Requirement:\s*(.+)$/.exec(line);
      if (m) renamedFrom.add(m[1].trim());
    }
  }
  return { removed, renamedFrom };
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) {
      out[m[1]] = m[2];
      continue;
    }
    const m2 = /^--([^=]+)$/.exec(a);
    if (m2) out[m2[1]] = '';
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const repo = path.resolve(args.repo || process.cwd());

  if (!args.base || !String(args.base).trim()) {
    process.stderr.write('[check-spec-delta-coverage] 缺 --base=<ref>：本判据需要基线参照，'
      + '取不到参照就不是"通过"而是"没判"。\n');
    process.exit(2);
  }
  // 与 check-pr-exec-record 同口径：显式传空 = 取证失败，不回落 HEAD
  // （pull_request 检出下 HEAD 是合并提交，回落等于把"取证失败"伪装成"取到了"）。
  if (typeof args.head === 'string' && args.head.trim() === '') {
    process.stderr.write('[check-spec-delta-coverage] --head= 显式为空：取证失败必须显式报错，不得回落 HEAD。\n');
    process.exit(2);
  }
  const base = String(args.base).trim();
  const head = args.head === undefined ? 'HEAD' : String(args.head).trim();

  let statuses;
  let mergeBase;
  try {
    mergeBase = git(repo, ['merge-base', base, head]).trim();
    if (!mergeBase) throw new Error('merge-base 返回空');
    statuses = changedFileStatuses({ repo, base, head });
  } catch (e) {
    process.stderr.write('[check-spec-delta-coverage] 取证失败：' + String((e && e.message) || e) + '\n');
    process.exit(2);
  }
  if (!Array.isArray(statuses) || statuses.length === 0) {
    // 变更集为空 = 取不到证据，不等于"这个 PR 没改文件"。判红，不接受空清单当通过。
    process.stderr.write('[check-spec-delta-coverage] 变更集为空：取证失败，不得当作"本 PR 没改主规格"放行。\n');
    process.exit(2);
  }

  // ---- 扫描域：本次变更集里碰过的主规格（A/M/R；D 单列）----
  const targets = [];
  const added = [];
  const deleted = [];
  for (const e of statuses) {
    if (!SPEC_FILE_RE.test(e.file)) continue;
    if (e.status === 'D') {
      deleted.push(e.file);
    } else if (e.status === 'A') {
      added.push(e.file);
    } else {
      // R/C：base 侧读旧路径，head 侧读新路径
      targets.push({ headPath: e.file, basePath: (e.from && e.from !== e.file) ? e.from : e.file });
    }
  }

  // ---- 本 PR 的 change delta 里声明过的合法删除/改名 ----
  const declaredRemoved = new Set();
  const declaredRenamedFrom = new Set();
  for (const e of statuses) {
    if (!CHANGE_DELTA_RE.test(e.file) || e.status === 'D') continue;
    let text;
    try {
      text = readAt(repo, head, e.file);
    } catch (err) {
      process.stderr.write('[check-spec-delta-coverage] 取证失败：' + String(err.message || err) + '\n');
      process.exit(2);
    }
    if (text === null) continue;
    const d = collectDeltaDeclarations(text);
    for (const x of d.removed) declaredRemoved.add(x);
    for (const x of d.renamedFrom) declaredRenamedFrom.add(x);
  }

  if (targets.length === 0) {
    console.log('[check-spec-delta-coverage] 本 PR 未修改任何已有主规格 ⇒ 本判据无对象可判（非"通过"，是"无对象"）。');
    if (added.length) console.log('  新增主规格（无基线，不判丢失）：' + added.join(', '));
    if (deleted.length) {
      console.log('  删除主规格（整份消失，**不判丢失**但需人工确认是合法退役）：' + deleted.join(', '));
    }
    process.exit(0);
  }

  const violations = [];
  for (const t of targets) {
    let baseText;
    let headText;
    try {
      baseText = readAt(repo, mergeBase, t.basePath);
    } catch (e) {
      // base 侧：mergeBase 刚解析成功过，这里读不到就是真异常 ⇒ 判自身故障。
      process.stderr.write('[check-spec-delta-coverage] 取证失败：' + String((e && e.message) || e) + '\n');
      process.exit(2);
    }
    // head 侧读不到 ⇒ 取证不一致（git 自己说该路径是 M，head 上却没有）⇒ 判自身故障。
    // 不用"读工作区"兜底：那条路在 git 语义下不可达（路径在 head 上不存在时 diff 报 D 而非 M），
    // 留着它等于一个死分支 + 一个构造不出来的测试。
    headText = readAt(repo, head, t.headPath);
    if (headText === null) {
      process.stderr.write('[check-spec-delta-coverage] 取证失败：变更集记为修改，但 head 上读不到 '
        + t.headPath + '\n');
      process.exit(2);
    }
    if (baseText === null) {
      // base 侧没有该文件（合并基线上还不存在）⇒ 没有基线可丢，不判。
      continue;
    }
    const b = parseSpec(baseText);
    const h = parseSpec(headText);
    for (const [title, scenarios] of b) {
      if (!h.has(title)) {
        if (declaredRemoved.has(title) || declaredRenamedFrom.has(title)) continue;
        violations.push({
          file: t.headPath,
          kind: 'REQUIREMENT',
          title,
          detail: '整个 Requirement 在合并后消失',
          hint: '若这是有意删除或改名，请在 change 的 delta 里用 `## REMOVED Requirements` / '
            + '`## RENAMED Requirements`（- FROM: / - TO:）声明 —— openspec 的 MODIFIED 是增量语义，'
            + '未声明的消失一律按丢失判。',
        });
        continue;
      }
      const hs = h.get(title);
      for (const s of scenarios) {
        if (hs.has(s)) continue;
        violations.push({
          file: t.headPath,
          kind: 'SCENARIO',
          title,
          scenario: s,
          detail: 'Scenario 在合并后消失',
          hint: 'openspec 约定合并 delta 时必须「Preserve scenarios/content not mentioned in the delta」；'
            + '若确实要删这条 Scenario，当前 openspec delta 表达力不足，请在 change 的 proposal/tasks 里写明理由，'
            + '并把该 Scenario 从基线里显式移出后再合。',
        });
      }
    }
  }

  const scanned = targets.length;
  if (violations.length === 0) {
    console.log('[check-spec-delta-coverage] ✅ 基线内容无丢失：对账 ' + scanned + ' 份主规格'
      + '（基线 ' + mergeBase.slice(0, 10) + '）。'
      + (added.length ? ' 另有 ' + added.length + ' 份新增主规格（无基线）。' : '')
      + (deleted.length ? ' 另有 ' + deleted.length + ' 份被删除的主规格（不判丢失，请人工确认）。' : ''));
    process.exit(0);
  }

  process.stderr.write('[check-spec-delta-coverage] ❌ 合并后丢失了基线内容（' + violations.length + ' 处）：\n');
  for (const v of violations) {
    if (v.kind === 'REQUIREMENT') {
      process.stderr.write('  · ' + v.file + ' :: Requirement「' + v.title + '」—— ' + v.detail + '\n');
    } else {
      process.stderr.write('  · ' + v.file + ' :: Requirement「' + v.title + '」的 Scenario「'
        + v.scenario + '」—— ' + v.detail + '\n');
    }
    if (v.hint) process.stderr.write('      修法：' + v.hint + '\n');
  }
  process.stderr.write('  基线 = ' + mergeBase + '（merge-base of ' + base + ' / ' + head + '）\n');
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { parseSpec, collectDeltaDeclarations };
