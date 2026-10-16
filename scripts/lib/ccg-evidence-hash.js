'use strict';
/**
 * 评审证据锚的单一实现：deep-review 写证据、check-pr-exec-record 验证据，两侧 MUST 用同一份
 * （两份实现必然口径漂移：换行、exclude 面、字段顺序任一不同就永远对不上，而且表现为
 *  「裁决不是这份代码」的假红 —— 那种红会被当成噪声，然后被人放宽）。
 *
 * 只 require node 内置模块 —— 消费方 quality-gate.yml 的 changes 作业没有 Install deps。
 */
const cp = require('child_process');
const crypto = require('crypto');

/**
 * 载荷 = `git diff <base> <head> -- . :(exclude)openspec/records :(exclude).ccg/reviews`
 *
 * 排除那两条是**自指防护**：证据 URL 与哈希本身要写进 `openspec/records/<分支>.md` 的 frontmatter，
 * 而钩子每笔提交还会重写 `.ccg/reviews/**`。若把它们算进载荷，「写下哈希」这一步就会改变载荷
 * ⇒ 校验必红（一次的哈希永远不等于写完之后的重算），结果是一条永远绿不了的判据 —— 那等于没有判据。
 */
const PAYLOAD_EXCLUDES = [':(exclude)openspec/records', ':(exclude).ccg/reviews'];

/**
 * diff 的**生成参数必须钉死**（2026-10-16 内部评审 C2 实测后补，作者此前没想到这一层）。
 *
 * 实测同一仓库状态、同一 base/head，只换本机 `[diff]` 配置：
 *   默认            → sha aa562c12…  bytes=180943
 *   diff.noprefix   → sha 2200d1ba…  bytes=180693
 *   diff.context=9  → sha 764c5b2a…  bytes=210397
 * 写入侧跑在开发者机器（Windows，任意全局 `[diff]` 段），判据跑在 ubuntu runner 的默认配置上
 * ⇒ 带这些配置的人**每次重跑收口都得到自己那个 sha**，与 CI 永远不等，且没有任何带内出路。
 * 本仓对这类假红的既有归宿只有一句：**被当噪声，然后被放宽**。所以这里不是「加保险」，
 * 而是把判据的可复核性从「取决于这台机器」收回「取决于这份代码」。
 */
/**
 * 载荷哈希要钉死的 diff 生成参数，分两处放（**位置本身就是 bug 源**）：
 *   `-c` 系列是 git 的**全局**选项，必须在 `diff` 子命令之前；
 *   `--no-ext-diff` / `--no-textconv` 是 `diff` **自己的**选项，放到子命令之前会直接
 *   `unknown option: --no-ext-diff`（本仓实测踩过：写错位置时整条判据一次都没跑起来过，
 *   而报错读起来像「参数拼错」不像「判据失效」，所以这里连位置一起写死并留注释）。
 */
const DIFF_PINS_GLOBAL = [
  '-c', 'diff.noprefix=false',
  '-c', 'diff.context=3',
  '-c', 'diff.algorithm=myers',
  '-c', 'diff.indentHeuristic=false',
  '-c', 'diff.mnemonicPrefix=false',
];
const DIFF_PINS_SUBCOMMAND = ['--no-ext-diff', '--no-textconv'];

/** 载荷哈希与 sha 的形状（两侧共用一份：写入侧据此自检，判据据此 fail closed）。 */
const HEX64_RE = /^[0-9a-f]{64}$/;
const HEX40_RE = /^[0-9a-f]{40}$/;

/**
 * 「base == head」这个空 diff 的哈希常量（`sha256('')`）。判据必须显式拒绝它：
 * 否则「载荷恰好 0 字节」的记录（只改文档/台账的那种）会让**任何**声称它的锚都自动同源。
 */
const EMPTY_DIFF_SHA256 = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');

function assertRef (what, label) {
  if (typeof what !== 'string' || !what.trim()) {
    // 文案里保留「缺 base」这个词：判据与既有测试都按它 grep，换词会让失败信息读起来像另一类故障
    throw new Error(label + ': 缺 base/head —— 需要一个 ref/sha 字符串，实得 ' + JSON.stringify(what)
      + '（`--base` 这类未取值的旗标会变成布尔 true；静默算出一个「看着像哈希的哈希」比当场报错更糟）');
  }
  return what.trim();
}

/** 供两侧与测试复用的参数构造（不导出裸字符串数组，避免两侧各拼一次）。 */
function payloadArgs (repo, base, head) {
  const b = assertRef(base, 'computeReviewPayload');
  const h = assertRef(head === undefined || head === null || head === '' ? 'HEAD' : head, 'computeReviewPayload');
  return ['-C', repo].concat(DIFF_PINS_GLOBAL,
    ['diff'].concat(DIFF_PINS_SUBCOMMAND, [b, h, '--', '.']),
    PAYLOAD_EXCLUDES);
}

/**
 * @returns {string} 64 位小写 hex
 * @throws 取证失败原样抛出（不返回空串 —— 空串哈希与「无改动」同形）
 */
function computeReviewPayloadSha ({ repo = process.cwd(), base, head = 'HEAD' } = {}) {
  return computeReviewPayload({ repo, base, head }).sha;
}

/** 同上，但把 diff 字节数一起交出来 —— 写入侧要靠它拒绝「空载荷」（见 EMPTY_PAYLOAD_REASON）。 */
function computeReviewPayload ({ repo = process.cwd(), base, head = 'HEAD' } = {}) {
  // 刻意**不**用 GIT_CONFIG_GLOBAL 做 env 隔离：Windows/MSYS 下把它指到 NUL 会让 git 当场
  // `fatal: unable to access '//./nul'`（本机实测），判据直接从「算出一个数」退化成「一次都跑不起来」，
  // 而后者在读日志的人眼里更像参数错误而不是判据失效。命令行 `-c` 的优先级高于
  // 仓库/全局/系统配置，已经把要钉的都钉住了；外部 diff 驱动与 textconv 由
  // --no-ext-diff / --no-textconv 关掉。这条取舍写在这里，免得下一个会话"顺手补上"再踩一次。
  const buf = cp.execFileSync('git', payloadArgs(repo, base, head), { maxBuffer: 268435456 });
  if (!Buffer.isBuffer(buf)) throw new Error('git diff 未返回 Buffer，拒绝在非 Buffer 上算哈希');
  return { sha: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

/**
 * 把任意 ref 写法（ref 名 / sha / `origin/main`）解析成**可提交的完整 sha**。
 *
 * 必须解析后再入锚：ref 名是移动指针，把移动指针写进「不可变证据」等于写了一句将来无法复核的话。
 * 解析不到一律抛错 —— 返回空串会让「取不到 base」伪装成「取到了一个空 base」。
 */
function resolveCommitSha ({ repo = process.cwd(), ref, label = 'resolveCommitSha' } = {}) {
  const r = assertRef(ref, label);
  let out = '';
  try {
    out = cp.execFileSync('git', ['-C', repo, 'rev-parse', '--verify', r + '^{commit}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    throw new Error(label + ': `' + r + '` 解析不到提交（不是本仓可见的 ref/sha）：'
      + String(e && e.message ? e.message.split('\n')[0] : e));
  }
  if (!HEX40_RE.test(out)) throw new Error(label + ': git 返回的不是 40hex sha（实得 `' + out + '`）');
  return out;
}

/** 兼容旧调用名（判据与写入侧都按 base 语义用它）。 */
function resolveBaseSha ({ repo = process.cwd(), base } = {}) {
  return resolveCommitSha({ repo, ref: assertRef(base, 'resolveBaseSha'), label: 'resolveBaseSha' });
}

/** 空载荷判据：diff 一个字节都没有 ⇒ 这份「裁决」没有描述任何代码，落进台账就是自填通过章。 */
const EMPTY_PAYLOAD_REASON = '载荷 diff 为 0 字节 —— 当前 HEAD 与 base 之间没有任何改动可审（还没提交？base 取错？）';

function assertPayloadNonEmpty (payload) {
  if (!payload || typeof payload.sha !== 'string' || !HEX64_RE.test(payload.sha)) {
    throw new Error('assertPayloadNonEmpty: 载荷哈希不是 64hex');
  }
  if (!Number.isFinite(payload.bytes) || payload.bytes === 0) throw new Error(EMPTY_PAYLOAD_REASON);
  if (payload.sha === EMPTY_DIFF_SHA256) throw new Error(EMPTY_PAYLOAD_REASON + '（哈希等于空 diff 常量）');
  return payload;
}

/**
 * 台账里被本模块管理的字段（顺序即写入顺序，稳定 ⇒ 同一输入两次写入字节相同，可被 diff 校验）。
 *
 * `ccg_payload_base` 与 `ccg_payload_head` 都必须是 **完整 sha，不是 ref 名**。这是本机制能不能用的关键：
 * CI 侧 `--base` 拿的是 `classify` 算出的 merge-base sha（quality-gate.yml:133 → pr-base 产出），
 * 而评审在本地跑时手上只有 `origin/main` / `HEAD` 这两个**会移动的指针**。
 * 内部评审 I6 指出：我原先只钉了 base 一侧、head 侧仍写死字面量 `HEAD` —— 于是外部留痕里那句
 * 「载荷 = <sha>..HEAD」在下一次推送后指向另一棵树，抽查者按它重算会得到不同结果。
 * 判据一侧的后果更直接：假红的下场在本仓有既有口径，**会被当成噪声，然后被人放宽**。
 */
const LEDGER_FIELDS = ['ccg_mode', 'ccg_status', 'ccg_rounds', 'ccg_evidence', 'ccg_payload_sha256', 'ccg_payload_base', 'ccg_payload_head', 'ccg_written_by'];

/** 证据锚的 URL 形状：必须是 GitHub PR 面上**一条具体的评论**。 */
const EVIDENCE_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+#(?:issuecomment-\d+|discussion_r\d+)$/;

/**
 * 就地改写 md frontmatter 里的若干顶层键：只碰这些键所在的行，其余行**逐字节保留（含各自行尾）**。
 * 新键插在闭合 `---` 之前。
 *
 * ⚠ 这里曾经错过一次，且是两份独立评审各自复现的（内部评审 I4/I5）：先前写成
 *   `replace(/\r\n/g,'\n')` 再 `join(探测到的多数派 eol)` —— 于是「输入第 3 行是纯 LF 且未被点名」
 *   时它被补上 `\r`（实测 CR 2→8），而 `changed` 只报 1。那既是 AGENTS.md 明文禁止的
 *   「探测多数派后统一回写」，又让 changed 与真实改动面不一致。正解是**只按 \n 切分、永不碰行内 \r**，
 *   新行的行尾跟随**它下面那一行**原本的结尾。
 * @returns {{text:string, changed:number}} changed = 实际变动的行数（含插入行）
 */
function upsertFrontmatterFields (text, fields) {
  const raw = String(text);
  const lines = raw.split('\n');
  const hadTrailingEmpty = lines.length > 1 && lines[lines.length - 1] === '';
  const crOf = (l) => (/\r$/.test(l) ? '\r' : '');
  if ((lines[0] || '').replace(/\r$/, '').trim() !== '---') {
    throw new Error('upsertFrontmatterFields: 该文件没有 frontmatter（首行不是 ---），拒绝猜结构')
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, '').trim() === '---') { close = i; break }
  }
  if (close < 0) throw new Error('upsertFrontmatterFields: frontmatter 没有闭合的 ---，拒绝写入')
  let changed = 0;
  const missing = [];
  for (const k of LEDGER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue
    const value = fields[k] === '' || fields[k] == null ? '""' : String(fields[k]);
    const at = lines.findIndex((l, i) => i < close && new RegExp('^' + k + ':').test(l.replace(/\r$/, '')));
    if (at < 0) { missing.push({ k, value }); continue }
    const next = k + ': ' + value + crOf(lines[at]);
    if (lines[at] !== next) { lines[at] = next; changed++ }
  }
  if (missing.length) {
    // 插入位置是闭合 `---` 之前 ⇒ 逐行沿用「闭合行」的行尾档，绝不引入第三种行尾
    const eol = crOf(lines[close]);
    lines.splice(close, 0, ...missing.map((m) => m.k + ': ' + m.value + eol));
    changed += missing.length;
  }
  void hadTrailingEmpty;
  return { text: lines.join('\n'), changed }
}

/** PR 证据评论正文：把「判的是哪份代码」写成可机器重算的形式，而不是只写一句「已评审」。 */
function buildEvidenceComment (info) {
  const rows = [
    `CCG 深度评审证据锚（由 scripts/ccg-record-ledger.js 收口时自动写，请勿手改）`,
    ``,
    `- 判定记录: \`${info.recordFile}\``,
    `- 模式: ${info.mode} ｜ 状态: ${info.status} ｜ 轮次: ${info.rounds}`,
    `- critique 指纹: \`${info.fingerprint || 'n/a'}\``,
    `- 评审载荷 sha256: \`${info.payloadSha}\``,
    `  （载荷 = \`${info.baseSha}\`..\`${info.headSha}\` 的 diff，排除 \`openspec/records\` 与 \`.ccg/reviews\`；`,
    `    两端都是完整 sha，不写 ref 名 —— ref 会随并发合并/新提交移动，用移动指针重算会得到另一棵树。`,
    `    diff 生成参数已被钉死（diff.context=3、diff.noprefix=false、--no-ext-diff/--no-textconv、`,
    `    并隔离 GIT_CONFIG_GLOBAL/SYSTEM），否则同一份代码在不同机器的 [diff] 配置下会算出不同 sha。`,
    `    重算：node -e "console.log(require('./scripts/lib/ccg-evidence-hash.js').computeReviewPayloadSha({base:'${info.baseSha}',head:'${info.headSha}'}))"）`,
    ``,
    `> 本行存在的意义：把「伪造闭环」从「改一行仓内文本」抬到「必须同时满足 —— 仓内台账字段自洽、`,
    `> 公开 PR 上真有一条指向本次载荷的评论、且引擎自己的判定记录也已闭合」。`,
    `> 它不是密码学签名（载荷 sha256 无密钥，任何人重算都能得到同一个值），所以它证明的是`,
    `> 「裁决与这份代码同源」，不是「裁决可信」—— authenticity 仍靠人抽查。`,
  ]
  return rows.join('\n')
}

module.exports = {
  computeReviewPayloadSha,
  computeReviewPayload,
  payloadArgs,
  PAYLOAD_EXCLUDES,
  DIFF_PINS_GLOBAL,
  DIFF_PINS_SUBCOMMAND,
  LEDGER_FIELDS,
  EVIDENCE_URL_RE,
  HEX64_RE,
  HEX40_RE,
  EMPTY_PAYLOAD_REASON,
  EMPTY_DIFF_SHA256,
  resolveBaseSha,
  resolveCommitSha,
  assertPayloadNonEmpty,
  upsertFrontmatterFields,
  buildEvidenceComment,
};
