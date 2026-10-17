'use strict';
/**
 * 深度评审收口后的「台账回写」：把裁决绑定到一份具体代码上，供 check-pr-exec-record 复核。
 *
 * 四步，顺序不可换（换了就留下「字段说闭环、外部证据还没有」的窗口）：
 *   1. 解析 base/head 成完整 sha（ref 名是移动指针，不得入锚）
 *   2. 找判定记录：按 base..HEAD 的**自有提交**逐个算内容键取名（与判定器同一个取名实现）；算不出键就不猜
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
 *   I2 「分支起点」候选可能拿到**别人的**裁决（34 个 worktree 共享一份对象库）。上游把记录名改成
 *      内容寻址（ccg-record-content-addressing）后，这一格由名字本身消掉：命中内容键就意味着那份
 *      变更确实是它。代价见 pickRecord 注释末尾的「不猜」。
 *
 * 依赖：只 require node 内置模块 + git/gh 子进程（与判据同侧，CI 的 changes 作业没有 Install deps）。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const LIB = require('./lib/ccg-evidence-hash.js');
const JUDGE = require('./check-pr-exec-record.js');
// 记录名由判定器单点定义（recordFileName）；这里直接复用它，不再抄第二份取名判据。
// require 安全：ccg-review-decider.js 有 require.main 守卫，被 require 时不会执行 CLI。
const DECIDER = require('./ccg-review-decider.js');

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
 * 判定记录寻址 —— 与判定器**同一个取名实现**（§7.1，上游 ccg-record-content-addressing 之后）。
 *
 * 记录名不再指向某个提交，而指向**那份变更本身**：
 *   name = DECIDER.recordFileName(key, parent)，key = 该提交排除 .ccg 的 diff 的 sha256；
 *   key 取不到（纯 .ccg 提交 ⇒ diff 为空）时判定器回落 `<parent>.json`。
 * 候选因此按「本分支自有提交」（base..HEAD，新→旧）逐个展开，三种落盘形态各探一次：
 *   ① 内容键名           —— pre-commit 全量 add 后提交（最常见）
 *   ② `<c>.json`         —— 手工在提交后跑判定器（index 干净 ⇒ sha 记的正是 HEAD）
 *   ③ `<c.parent>.json`  —— 纯 .ccg 提交的回落名，以及改名之前落的历史记录
 * 每条命中都要过两道归属核对（见 probeOk）：记录自报的 sha 必须等于该探针的所有者，
 * 记录里的 stagedDiffHash（若有）必须等于本次算出的键。
 *
 * ⚠ 为什么不再把分支起点 B 本身当候选：B 是**上游提交**，它那条记录描述的是别人的变更集，
 *   收口时借用它 = 把别人的裁决钉在本 PR 上。旧实现的做法是「按 `<B>.json` 找 + 事后甄别」，
 *   内容寻址把前提本身消掉了 —— 名字由内容决定，命中即同源，没有可借之物。
 *   如实记代价：base 解析不到、或 base..HEAD 为空（内容键算不出）时**一律不猜**，退回「找不到记录」，
 *   由调用方（deep-review.sh 与判据）把它读成欠账，而不是读成一次成功。
 */
function pickRecord ({ repo, commits }) {
  const tried = [];
  let skippedForeign = false;
  let why = '';
  const list = Array.isArray(commits) ? commits : [];
  for (const c of list) {
    const sha = typeof c.sha === 'string' ? c.sha : '';
    if (!LIB.HEX40_RE.test(sha)) continue;
    const parent = typeof c.parent === 'string' && LIB.HEX40_RE.test(c.parent) ? c.parent : '';
    const key = typeof c.key === 'string' && LIB.HEX64_RE.test(c.key) ? c.key : '';
    const probes = [];
    // ① 内容键名：owner 取 parent（pre-commit 时 HEAD 就是父提交）；无父提交时取该提交本身
    if (key) probes.push({ name: DECIDER.recordFileName(key, parent || sha), owner: parent || sha, byKey: true });
    // ② 手工在提交后跑判定器（该提交在本分支自有集合内 ⇒ 不是别人的）
    probes.push({ name: sha + '.json', owner: sha, byKey: false });
    // ③ 空 diff 回落名 / 改名之前的历史记录。只在两种情况下承认 sha 名：
    //    本次非 .ccg diff 本来就是空（判定器自己也会用这个回落名），或父提交本身就是
    //    本分支的自有提交（那条记录必然描述我的变更集）。否则 `<base>.json` 会被读成
    //    "本分支的记录"，而它属于上游提交 —— 这正是 I2 要关的那一格。
    const parentInSet = list.some(x => x && x.sha === parent);
    if (parent && (key === '' || parentInSet)) probes.push({ name: parent + '.json', owner: parent, byKey: false });
    for (const p of probes) {
      const rel = '.ccg/reviews/' + p.name;
      const abs = path.join(repo, '.ccg', 'reviews', p.name);
      if (!fs.existsSync(abs)) continue;
      tried.push(rel);
      let json;
      // 两种"读不出裁决"都要跳过：解析失败，以及解析成功但**不是对象**（裸字符串 / 数组 / null
      // 都是合法 JSON 却没有 mode）—— 后者若被放行，调用方拿到的是字符串而 not-a-verdict 是静默的。
      try { json = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue } // 损坏记录交给别的门禁报，这里不冒充裁决
      if (!json || typeof json !== 'object' || Array.isArray(json)) continue;
      const claims = (json && typeof json.sha === 'string') ? json.sha : '';
      const claimedKey = (json && typeof json.stagedDiffHash === 'string' && json.stagedDiffHash) ? json.stagedDiffHash : '';
      // 键名探针的归属凭据是**内容键本身**，记录自报的 sha 只在它确实声明了时才参与核对；
      // sha 名探针只有 sha 一条凭据，必须逐字相等（缺字段即不借，缺证据不等于放行）。
      const shaOk = p.byKey ? (!claims || claims === p.owner) : (claims === p.owner);
      const keyOk = !claimedKey || claimedKey === key;
      if (shaOk && keyOk) return { sha: p.owner, file: rel, json, tried };
      skippedForeign = true;
      why = !shaOk
        ? '记录自报 sha=' + (claims || '(缺失)') + ' 与本次的 ' + p.owner + ' 不符（' + rel + '）'
        : '记录的 stagedDiffHash=' + claimedKey.slice(0, 12) + '… 与本次实算的键不符（' + rel + '）';
    }
  }
  return { sha: '', file: null, json: null, tried, skippedForeign, why };
}

/** 纯流程：把可注入的东西全部从 deps 进来，于是「先评论后写字段」这条顺序可以被行为锁真跑一次。 */
function runLedger (deps) {
  const log = deps.log || (() => {});
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
      log('命中的记录与本次不同源（' + (rec.why || 'sha 或 stagedDiffHash 核不上')
        + '）⇒ 不借用别人的裁决。请在本分支重新提交一次让判定器落新记录，再跑 sh scripts/deep-review.sh');
      return { rc: 1, wrote: 0, why: 'record-not-provable-here' };
    }
    log('未找到本次的判定记录（base=' + String(baseSha).slice(0, 12) + '… 之内的自有提交按内容键与 sha 名各探一次，命中 0 处），不落证据。'
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
 * 判定记录内容键的配方 —— 与 ccg-review-decider.js 在 pre-commit 算 stagedDiffHash 的调用
 * **逐字同源**：三个 diff 行为旗标 + 同一个 pathspec。由跨实现契约锁钉住
 * （ccg-record-ledger.test.js：真调 saveRecord 落盘 ⇒ pickRecord 必须命中同一文件）。
 *
 * 两个方向的坑都踩过，别改：
 *   · 提交瞬间 A = `git diff --cached …`；提交后与之逐字节等价的是 `git diff <parent> <c> …`
 *     —— **父在前**。反着写得到的是反向 diff，字节不同、哈希不同，寻址整条失效。
 *   · 首提交（无 parent）没有 `<p> <c>` 可写 ⇒ 用 `git show --format= <c>`，与 deep-review.sh
 *     的首提交分支同一口径（`--format=` 是为了只要 diff 部分、不带 commit 头）。
 *   · 必须按**字节**算（Buffer 直接 update），不能先转字符串：与 shell 侧的 `sha256sum < 文件` 对齐。
 */
const RECORD_DIFF_FLAGS = ['--no-textconv', '--no-ext-diff', '--no-renames'];
const RECORD_PATHSPEC = ['--', '.', ':(exclude).ccg'];

/** @returns {string} 64 位小写 hex；diff 为空（纯 .ccg 提交）时返回 ''（判定器此时回落父 sha 命名） */
function recordKeyAtCommit ({ repo, sha }) {
  if (!LIB.HEX40_RE.test(String(sha))) throw new Error('recordKeyAtCommit: sha 不是 40hex：' + sha);
  let parent = '';
  try {
    parent = String(cp.execFileSync('git', ['-C', repo, 'rev-parse', sha + '^'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch { parent = '' }
  const args = LIB.HEX40_RE.test(parent)
    ? ['-C', repo, 'diff'].concat(RECORD_DIFF_FLAGS, [parent, sha], RECORD_PATHSPEC)
    : ['-C', repo, 'show'].concat(RECORD_DIFF_FLAGS, ['--format=', sha], RECORD_PATHSPEC);
  const buf = cp.execFileSync('git', args, { maxBuffer: 268435456 });
  if (!Buffer.isBuffer(buf)) throw new Error('recordKeyAtCommit: git 未返回 Buffer');
  if (buf.length === 0) return '';
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * base..HEAD 的本分支自有提交（新→旧），每条带上 {sha, parent, key}。
 * base 不是 40hex（ref 名没解析、或仓库取不到 merge-base）⇒ 返回空数组：
 * 这一格必须与「有提交但没有记录」在文案上可区分，由 pickRecord 的 tried=0 透出。
 */
function branchCommitView ({ repo, baseSha }) {
  if (!baseSha || !LIB.HEX40_RE.test(String(baseSha))) return [];
  let stdout = '';
  try {
    stdout = String(cp.execFileSync('git', ['-C', repo, 'rev-list', baseSha + '..HEAD'],
      { encoding: 'utf8', maxBuffer: 67108864 }));
  } catch { return [] }
  return stdout.split('\n').map(s => s.trim()).filter(s => LIB.HEX40_RE.test(s)).map(sha => {
    let parent = '';
    try {
      parent = String(cp.execFileSync('git', ['-C', repo, 'rev-parse', sha + '^'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    } catch { parent = '' }
    let key = '';
    try { key = recordKeyAtCommit({ repo, sha }); } catch { key = '' }
    return { sha, parent, key };
  });
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
  const log = m => process.stdout.write('[ccg-ledger] ' + m + '\n');
  const branch = typeof args.branch === 'string' ? args.branch : git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commitView = (base) => branchCommitView({ repo, baseSha: base });

  // --locate：把「本次的判定记录在哪、mode 是什么」交回给 shell 入口。
  // 为什么要有这一档：deep-review.sh 原先自己按 HEAD/HEAD^ 找，找不到就早退，
  // 于是写入侧新增的「分支起点」候选从文档入口永远走不到（内部评审 I2）。
  // 寻址逻辑因此只留这一份实现，shell 只消费它的结论，不自己再抄一遍。
  if (args.locate) {
    let baseSha = '';
    try { baseSha = LIB.resolveBaseSha({ repo, base: baseLabel }); } catch { baseSha = '' }
    const r = pickRecord({ repo, commits: commitView(baseSha) });
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
    resolveRecord: ({ baseSha }) => pickRecord({ repo, commits: commitView(baseSha) }),
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
  branchCommitView,
  recordKeyAtCommit,
  RECORD_DIFF_FLAGS,
  RECORD_PATHSPEC,
  runLedger,
  parseArgs,
  ghRepoSlug,
  findPrReal,
  postCommentReal,
  main,
  CLOSED,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
