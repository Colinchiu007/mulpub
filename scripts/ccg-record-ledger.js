'use strict';
/**
 * 深度评审收口后的「台账回写」：把裁决绑定到一份具体代码上，供 check-pr-exec-record 复核。
 *
 * 四步，顺序不可换（换了就留下「字段说闭环、外部证据还没有」的窗口）：
 *   1. 解析 base/head 成完整 sha（ref 名是移动指针，不得入锚）
 *   2. 找判定记录：HEAD → HEAD^ → 分支起点；**第三候选必须过内容同源校验**（见 pickRecord 注释）
 *   3. 只有 mode=dual、deepReview.required、status 已闭环、载荷非空才落证据
 *   4. 先贴 PR 评论并从 GitHub 读回确认，成功后才写台账字段
 *
 * 分工：本脚本是**尽力而为的写入侧**，失败只出声不阻断评审流程；真正的强制力在判据
 * （check-pr-exec-record 的 deepDebt）。这样「评论贴不上」不会把深度审查本身变成红，
 * 但「没有证据锚」一定会让 PR 变红 —— 判据看得见，写入侧不必装作看得见。
 *
 * ⚠ 内部评审（2026-10-16，双份独立命中）改写了本文件的三条口径，都记在这里免得被"顺手优化"回去：
 *   C1 真实调用方 `deep-review.sh` 用的是 `--base <值>`（空格形），而本脚本原先只认 `--base=<值>`
 *      ⇒ args.base 变成布尔 true ⇒ 收口在生产路径上**一次都没跑通过**（13 条 JS 层变异全抓不到，
 *      因为洞在 shell 边界）。现在两种写法都吃，并且 base 非字符串一律当场抛错。
 *   I6 head 侧原先写死字面量 'HEAD' ⇒ 评论里的范围在下一次推送后指向另一棵树。现在解析成 sha 入锚。
 *   I2 分支起点候选可能拿到**别人的**裁决（同名文件按父提交 sha 命名，34 个 worktree 共享一份 .git）。
 *      现在该候选必须过 stagedDiffHash 同源校验才敢用。
 *
 * 依赖：只 require node 内置模块 + git/gh 子进程（与判据同侧，CI 的 changes 作业没有 Install deps）。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const LIB = require('./lib/ccg-evidence-hash.js');
const JUDGE = require('./check-pr-exec-record.js');

const CLOSED = JUDGE.CLOSED_DEEP_REVIEW_STATUSES;

/** 该记录是否该落证据？dual + 已闭环。single/skip/pending/blocked 一律不落。 */
function shouldWriteLedger (rec) {
  if (!rec) return { ok: false, why: '没有判定记录' };
  if (rec.mode !== 'dual') return { ok: false, why: 'mode=' + rec.mode + ' ≠ dual，没有外部裁决可落' };
  const dr = rec.deepReview || {};
  if (dr.required !== true) return { ok: false, why: 'deepReview.required 不为 true，本次不需要深度审查' };
  const st = typeof dr.status === 'string' ? dr.status : '(缺失)';
  if (!CLOSED.has(st)) return { ok: false, why: 'status=' + st + ' 未闭环，落进台账等于自填通过章' };
  return {
    ok: true,
    status: st,
    rounds: dr.rounds || rec.rounds || 0,
    fingerprint: dr.critiqueFingerprint || '',
  };
}

/** 台账字段。written_by 固定值让判据能区分「引擎写」与「手填」；字段集与 lib 清单逐字对账。 */
function nextLedgerFields ({ status, rounds, payloadSha, baseSha, headSha, evidenceUrl, mode, writtenBy }) {
  const f = {
    ccg_mode: mode || 'dual',
    ccg_status: status,
    ccg_rounds: String(rounds || 0),
    ccg_evidence: evidenceUrl,
    ccg_payload_sha256: payloadSha,
    ccg_payload_base: baseSha,
    ccg_payload_head: headSha,
    ccg_written_by: writtenBy || 'deep-review',
  };
  const missing = LIB.LEDGER_FIELDS.filter(k => f[k] === undefined);
  const unknown = Object.keys(f).filter(k => !LIB.LEDGER_FIELDS.includes(k));
  if (missing.length || unknown.length) {
    throw new Error('台账字段与 lib 清单不一致：缺=' + missing.join(',') + ' 多=' + unknown.join(','));
  }
  if (!LIB.HEX40_RE.test(f.ccg_payload_base)) throw new Error('ccg_payload_base 必须是完整 sha，不得写 ref 名：' + f.ccg_payload_base);
  if (!LIB.HEX40_RE.test(f.ccg_payload_head)) throw new Error('ccg_payload_head 必须是完整 sha，不得写 ref 名：' + f.ccg_payload_head);
  if (!LIB.EVIDENCE_URL_RE.test(f.ccg_evidence)) throw new Error('ccg_evidence 必须是一条具体 PR 评论的 URL：' + f.ccg_evidence);
  return f;
}

/**
 * 判定记录寻址，三个候选按「记录写在谁名下」的真实成因排：
 *   HEAD    —— 手工在提交后跑过判定器
 *   HEAD^   —— pre-commit 时新 commit 尚未生成，记录写在父提交名下（最常见）
 *   baseSha —— **多提交分支**：在分支起点 B 上提交 c1 时 HEAD 就是 B，而收口发生在 cn 上，
 *              此时 HEAD 与 HEAD^ 都够不到 B。引擎侧本来有 diff 内容寻址兜底，
 *              写入侧漏了同一格（实测：本 PR rebase 后补第二个提交即命中该形态）。
 *
 * ⚠ 第三候选必须额外过 `stagedDiffHash` 同源校验，前两个不必 —— 这不是双重标准，是风险面不同：
 *   `.ccg/reviews/<sha>.json` 以父提交 sha 命名，而 34 个 worktree 共享同一份对象库；
 *   分支起点那种「公共提交」的记录**可能是别的会话在同一 tip 上写的**（实测 origin/main 的
 *   16 份 dual+closed 记录里有 3 份本身就是 main 的祖先）。按 HEAD/HEAD^ 命中不存在这个问题：
 *   那两个 sha 只在本次工作集里出现。校验不过就退回「找不到」，绝不借用陌生裁决。
 */
function pickRecord ({ repo, revParse, baseSha, sameAsDecider }) {
  const out = [];
  const load = (sha) => {
    const abs = path.join(repo, '.ccg', 'reviews', sha + '.json');
    if (!fs.existsSync(abs)) return null;
    let json;
    try { json = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null } // 损坏记录交给别的门禁报，这里不冒充裁决
    return { sha, file: '.ccg/reviews/' + sha + '.json', json };
  };
  for (const ref of ['HEAD', 'HEAD^']) {
    let sha = '';
    try { sha = revParse(ref); } catch { continue } // 仓库只有一笔提交时没有 HEAD^ —— 不是错误，跳过
    out.push(sha);
    const hit = load(sha);
    if (hit) return hit;
  }
  if (baseSha && LIB.HEX40_RE.test(baseSha)) {
    out.push(baseSha);
    const hit = load(baseSha);
    if (hit) {
      const claimed = hit.json && hit.json.stagedDiffHash;
      if (!claimed) {
        // 借用不成：宁缺不假。退回 no-record 比拿一份无法证明同源、且可能属于他人工作集的裁决安全。
        return { sha: baseSha, file: null, json: null, tried: out, skippedForeign: true };
      }
      let actual;
      try { actual = sameAsDecider(baseSha); } catch { actual = null }
      if (actual !== claimed) {
        return { sha: baseSha, file: null, json: null, tried: out, skippedForeign: true,
          why: '分支起点记录的 stagedDiffHash 与本次不符（声明 ' + String(claimed).slice(0, 12) + '… 实算 '
            + String(actual || '(取不到)').slice(0, 12) + '…）' };
      }
      return hit;
    }
  }
  return { sha: out[0] || '', file: null, json: null, tried: out };
}

/** 纯流程：把可注入的东西全部从 deps 进来，于是「先评论后写字段」这条顺序可以被行为锁真跑一次。 */
function runLedger (deps) {
  const log = deps.log || (() => {});
  const head = deps.head || 'HEAD';
  let baseSha;
  try { baseSha = deps.resolveBase(); } catch (e) {
    log('base 解析失败：' + e.message + ' ⇒ 不落证据（没有可复核的 base，锚就是装饰）');
    return { rc: 2, wrote: 0, why: 'base-unresolvable' };
  }
  let headSha;
  try { headSha = deps.resolveHead(); } catch (e) {
    log('head 解析失败：' + e.message + ' ⇒ 不落证据');
    return { rc: 2, wrote: 0, why: 'head-unresolvable' };
  }
  const rec = deps.resolveRecord({ baseSha, headSha });
  if (!rec || !rec.file) {
    if (rec && rec.skippedForeign) {
      log('分支起点那份记录与本次不同源（' + (rec.why || '无 stagedDiffHash 或不匹配')
        + '）⇒ 不借用别人的裁决。请在本分支重新提交一次让判定器落新记录，再跑 sh scripts/deep-review.sh');
      return { rc: 1, wrote: 0, why: 'record-not-provable-here' };
    }
    log('未找到本次的判定记录（HEAD、HEAD^ 与分支起点 ' + String(baseSha).slice(0, 12) + '… 都没命中），不落证据。'
      + '先提交一次（pre-commit 会生成判定记录），再跑 sh scripts/deep-review.sh');
    return { rc: 1, wrote: 0, why: 'no-record' };
  }
  const sw = shouldWriteLedger(rec.json);
  if (!sw.ok) { log('不落证据：' + sw.why); return { rc: 0, wrote: 0, why: 'not-applicable' }; }

  let payload;
  try { payload = LIB.assertPayloadNonEmpty(deps.payload(baseSha, headSha)); } catch (e) {
    log('载荷取证失败：' + e.message + ' ⇒ 不落证据');
    return { rc: 2, wrote: 0, why: 'payload-empty-or-failed' };
  }

  const body = LIB.buildEvidenceComment({
    recordFile: rec.file, mode: rec.json.mode, status: sw.status, rounds: sw.rounds,
    fingerprint: sw.fingerprint, payloadSha: payload.sha, baseSha, headSha,
  });
  if (deps.dryRun) {
    log('DRY：将贴一条 PR 证据评论并写 ccg_payload_base=' + baseSha.slice(0, 12) + '… ccg_payload_head='
      + headSha.slice(0, 12) + '… ccg_payload_sha256=' + payload.sha.slice(0, 12) + '…');
    return { rc: 0, wrote: 0, why: 'dry-run', baseSha, headSha, payloadSha: payload.sha };
  }

  const pr = deps.findPr();
  if (!pr) {
    log('本分支没有关联的 open PR ⇒ 不落证据。开完 PR 重跑 sh scripts/deep-review.sh 即可补锚（判据在此之前会记一条欠账）。');
    return { rc: 1, wrote: 0, why: 'no-pr' };
  }
  const posted = deps.postComment({ prNumber: pr.number, body });
  if (!posted.ok) {
    log('贴评论失败：' + posted.err + ' ⇒ 不写字段（顺序反了就等于留下「字段说闭环、外部没有这条证据」的假闭环）');
    return { rc: 2, wrote: 0, why: 'comment-failed', pr };
  }
  let fields;
  try {
    fields = nextLedgerFields({ status: sw.status, rounds: sw.rounds, payloadSha: payload.sha,
      baseSha, headSha, evidenceUrl: posted.url, mode: rec.json.mode });
  } catch (e) {
    log('gh 返回的评论 URL 不合格：' + e.message + ' ⇒ 不写字段（宁缺不假）');
    return { rc: 2, wrote: 0, why: 'evidence-url-invalid', pr };
  }
  const written = deps.writeLedger(fields);
  log('OK pr=#' + pr.number + ' status=' + sw.status + ' base=' + baseSha.slice(0, 12) + '… head='
    + headSha.slice(0, 12) + '… payload=' + payload.sha.slice(0, 12) + '… 台账改动行数=' + written + '（0=已一致，幂等）');
  return { rc: 0, wrote: written, why: 'ok', pr, fields };
}

/** `--k=v` 与 `--k v` 两种写法都要吃（C1：真实调用方用的是空格形）。 */
function parseArgs (argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (a === '--') continue;
    if (eq > 0) { args[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; } else { args[key] = true; }
  }
  return args;
}

/**
 * 与 decider 同口径的暂存 diff 哈希（`git diff --cached -- . :(exclude).ccg`）。
 *
 * ⚠ 这里**刻意不用** lib 里那套钉死的 diff 参数：要比对的是 decider 在提交瞬间算的数，
 * 两边必须逐字同一实现，否则钉死反而造成永久不等。载荷哈希钉配置是为了跨机可复核，
 * 这个哈希只求「同机同源」，两者目的不同、口径也不同 —— 别把它们合并。
 */
function deciderStagedDiffHashAtCommit ({ repo, sha }) {
  const out = cp.execFileSync('git', ['-C', repo, 'diff', sha, sha + '^1', '--', '.', ':(exclude).ccg'],
    { maxBuffer: 268435456 });
  const s = String(out);
  if (!s.trim()) return undefined;
  return crypto.createHash('sha256').update(s).digest('hex');
}

function findPrReal ({ repo, branch }) {
  try {
    const out = cp.execFileSync('gh', ['pr', 'view', branch, '--json', 'number,url'],
      { cwd: repo, encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
    const j = JSON.parse(out);
    if (!j || !j.number || !j.url) return null;
    return { number: Number(j.number), url: String(j.url) };
  } catch { return null; }
}

/**
 * 贴评论 + **从 GitHub 读回**确认。
 *
 * 为什么还要读回：判据只看 URL 形状，而形状是仓内文本 —— 若写入侧把「gh 报了个错」或
 * 「stdout 不是 URL」也当成成功，锚就退化成一串自说自话的字符。读回一次，
 * 才把「外部确实有这条证据」变成写入侧自己的验收，而不是留给判据去猜。
 * 读不回一律判失败，且**绝不伪造**一个 URL 顶上。owner/repo 一律取自本仓 remote，
 * 不从 gh 的输出里反推（内部评审 M6：反推会让 GHES/意外 host 变成「写入侧自认合格、判据恒拒」的死红）。
 */
function postCommentReal ({ repo, prNumber, body }) {
  try {
    const slug = ghRepoSlug({ repo });
    if (!slug) return { ok: false, err: '取不出本仓 owner/repo（remote 未配置？）' };
    const out = cp.execFileSync('gh', ['api', '-X', 'POST', 'repos/' + slug + '/issues/' + String(prNumber) + '/comments',
      '-F', 'body=@-'], { cwd: repo, input: body, encoding: 'utf8', timeout: 120000 });
    let created;
    try { created = JSON.parse(out); } catch { return { ok: false, err: 'gh api 未返回 JSON' }; }
    const url = created && created.html_url;
    if (!LIB.EVIDENCE_URL_RE.test(String(url))) return { ok: false, err: 'gh 返回的 html_url 不是具体评论（实得 `' + url + '`）' };
    const m = /#issuecomment-(\d+)$/.exec(url);
    if (!m) return { ok: false, err: '评论 URL 取不到 id（实得 `' + url + '`）' };
    const back = cp.execFileSync('gh', ['api', 'repos/' + slug + '/issues/comments/' + m[1], '--jq', '.html_url'],
      { cwd: repo, encoding: 'utf8', timeout: 60000 }).trim();
    if (back !== url) return { ok: false, err: '读回的评论 URL 与刚贴的不一致（贴出=`' + url + '` 读回=`' + back + '`）' };
    return { ok: true, url };
  } catch (e) {
    return { ok: false, err: String(e && e.message ? e.message.split('\n')[0] : e) };
  }
}

/** 本仓 owner/repo：只认 remote，不认任何子进程输出（免得把外部文本当身份来源）。 */
function ghRepoSlug ({ repo }) {
  try {
    const url = cp.execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
    return m ? m[1] + '/' + m[2] : '';
  } catch { return ''; }
}

function main (argv) {
  const args = parseArgs(argv || []);
  const repo = path.resolve(args.repo || process.cwd());
  const baseLabel = typeof args.base === 'string' ? args.base : 'origin/main';
  const git = a => cp.execFileSync('git', ['-C', repo].concat(a), { encoding: 'utf8' }).trim();
  const revParse = (r) => git(['rev-parse', r]);
  const log = m => process.stdout.write('[ccg-ledger] ' + m + '\n');
  const branch = typeof args.branch === 'string' ? args.branch : git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const sameAsDecider = (sha) => deciderStagedDiffHashAtCommit({ repo, sha });

  // --locate：把「本次的判定记录在哪、mode 是什么」交回给 shell 入口。
  // 为什么要有这一档：deep-review.sh 原先自己按 HEAD/HEAD^ 找，找不到就早退，
  // 于是写入侧新增的「分支起点」候选从文档入口永远走不到（内部评审 I2）。
  // 寻址逻辑因此只留这一份实现，shell 只消费它的结论，不自己再抄一遍。
  if (args.locate) {
    let baseSha = '';
    try { baseSha = LIB.resolveBaseSha({ repo, base: baseLabel }); } catch { baseSha = '' }
    const r = pickRecord({ repo, revParse, baseSha, sameAsDecider });
    if (!r.file) {
      process.stdout.write('LOCATE none ' + (r.skippedForeign ? 'foreign' : 'missing') + '\n');
      return 1;
    }
    let mode = '';
    try { mode = String(JSON.parse(fs.readFileSync(path.join(repo, r.file), 'utf8')).mode || ''); } catch { mode = '' }
    process.stdout.write('LOCATE ' + r.file + ' mode=' + (mode || '(unreadable)') + '\n');
    return 0;
  }

  const recPath = path.join(repo, 'openspec', 'records', branch + '.md');
  if (!fs.existsSync(recPath)) {
    process.stderr.write('[ccg-ledger] 本分支没有执行记录文件 openspec/records/' + branch + '.md'
      + ' —— 台账无处可写。按 AGENTS.md，新 PR 必须自带该文件；先补它再收口深度审查。\n');
    return 2;
  }
  const res = runLedger({
    repo,
    dryRun: !!args['dry-run'] || !!args.dryRun,
    log,
    resolveRecord: ({ baseSha }) => pickRecord({ repo, revParse, baseSha, sameAsDecider }),
    resolveBase: () => LIB.resolveBaseSha({ repo, base: baseLabel }),
    resolveHead: () => LIB.resolveCommitSha({ repo, ref: 'HEAD', label: 'resolveHeadSha' }),
    payload: (baseSha, headSha) => LIB.computeReviewPayload({ repo, base: baseSha, head: headSha }),
    findPr: () => findPrReal({ repo, branch }),
    postComment: ({ prNumber, body }) => postCommentReal({ repo, prNumber, body }),
    writeLedger: (fields) => {
      const cur = fs.readFileSync(recPath, 'utf8');
      let out;
      try { out = LIB.upsertFrontmatterFields(cur, fields); } catch (e) {
        log('写台账失败：' + e.message + ' ⇒ 不落（评论已贴出，重跑即可补齐字段）');
        return -1;
      }
      if (out.changed > 0) fs.writeFileSync(recPath, out.text, 'utf8');
      return out.changed;
    },
  });
  return res.rc;
}

module.exports = {
  shouldWriteLedger,
  nextLedgerFields,
  pickRecord,
  runLedger,
  parseArgs,
  ghRepoSlug,
  deciderStagedDiffHashAtCommit,
  findPrReal,
  postCommentReal,
  main,
  CLOSED,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
