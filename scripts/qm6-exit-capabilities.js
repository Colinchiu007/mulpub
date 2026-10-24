'use strict';
/**
 * 收口出口能力读数（change: qm6-exit-capability-probe）
 *
 * 为什么单独一个文件（而不是长在 ccg-convergence-probe.js 里）：
 * 2026-10-20 的实测事故 —— PR #4062（一个 s2v 错误码修复）携带评审前的旧副本，
 * 把 PR #4067 在 `ccg-convergence-probe.js` + 它的 `.test.js` + `ccg-convergence-exit/tasks.md`
 * 三个文件里的改动**整段撤销**（`git show --stat 8fdd617b2` 当场读数：探针 +1/−21、测试 −25、tasks −31）。
 * 之所以无人发现：那条"发现它"的断言与它守护的实现**同批被删**。
 * 本模块因此被一个第三份文件的契约锁守（`qm6-exit-capabilities.test.js`），
 * 并由 `quality-gate.yml` 的 changes 作业独立点名一次。
 *
 * 三格出口（2026-10-23 现场读数，逐条可重取）：
 *   ① externalReview —— vendor 能表达"外部复核三格齐备即解除阻断" ⇒ **true**（本机 vendor 补丁）
 *   ② upheld         —— 被判成立的条目有"已修且已验证"的出口吗     ⇒ **false**（push 前无守卫）
 *   ③ toolSignature  —— 写 tier=external 那道合取有第二条路吗      ⇒ **false**（只认 performedBy）
 * ③ 的可复现性是刻意设计：它的输入是**仓内**文件，所以 CI runner 上也量得到；
 * ①② 的输入在 vendor 里，只有装了技能包的机器量得到 —— 两种读数必须分开报，
 * 混成一个数就等于让"换台机器"悄悄把结论换掉。
 *
 * 三档返回值：true / false / 'unknown'。
 * ⛔ 'unknown'（读不出被声明物）**不得**折叠成 false ——
 * "vendor 把函数改名了"与"这条出口确实不存在"是两件事，把前者报成后者，
 * 下一次就会有人拿着这条读数去改设计文档（本仓把这类折叠定性为把工具的失明读成结论）。
 *
 * 零出站；只吃字符串，不碰 git、不碰网络、不 require vendor。
 */

const NOVEL = new Set(['unknown', 'true', 'false']);

/** ① 高危域条目：解除谓词被**定义** + 驱动把期望后端写进裁决模板。两格都要，缺任一不算在位。 */
function externalReviewCapable (driverSrc) {
  if (typeof driverSrc !== 'string' || driverSrc.trim() === '') return 'unknown';
  const hasPredicate = /^[ \t]*function[ \t]+externalReviewSatisfied[ \t]*\(/m.test(driverSrc);
  const declared = /externalReviewSatisfied/.test(driverSrc);
  if (!declared) return 'unknown'; // 被声明物不存在 ⇒ 读不出，而不是"没有出口"
  const hasExpected = /expectedExternalBackend[ \t]*:/.test(driverSrc);
  return hasPredicate && hasExpected;
}

/**
 * ② upheld 条目：`verdict === 'upheld'` 那条 push 之前有没有解除臂。
 * 取"整个函数体"再定位，不用固定行数窗口 —— 加一条注释就会把窗口判据骗过去（本仓实测同型）。
 */
function upheldExitCapable (driverSrc) {
  if (typeof driverSrc !== 'string' || driverSrc.trim() === '') return 'unknown';
  if (!/blockingFromAdjudication/.test(driverSrc)) return 'unknown';
  const start = driverSrc.search(/function[ \t]+blockingFromAdjudication[ \t]*\(/);
  if (start < 0) return 'unknown';
  const body = sliceFunctionBody(driverSrc.slice(start));
  if (body === null) return 'unknown';
  const at = body.search(/[ \t]*if[ \t]*\([ \t]*i\.verdict[ \t]*===?[ \t]*['"]upheld['"]/);
  if (at < 0) return 'unknown';
  // 只看那一条 if 自己的块（到它自己的闭合括号为止）：往后多读几行会把"下一条的 return"算成它的解除臂。
  const blk = sliceBlock(body.slice(at).replace(/^[ \t]*if[ \t]*\([^)]*\)/, ''));
  if (blk === null) return 'unknown';
  return /\breturn\b/.test(blk) && /Capable|Satisfied|resolvedEvidence|resolution\b|externalReview/.test(blk);
}

/**
 * ③ 工具署名：写回器在 `performedBy === expected` 之外是否还有第二条通往"写"的路径。
 * 形状判据：先确认这条合取**在**（读不出即 unknown），再看它的条件里有没有 `||` 分支。
 */
function toolSignatureCapable (writebackSrc) {
  if (typeof writebackSrc !== 'string' || writebackSrc.trim() === '') return 'unknown';
  if (!/performedBy/.test(writebackSrc) || !/expected/.test(writebackSrc)) return 'unknown';
  const m = /^[ \t]*if[ \t]*\(dr\.performedBy[ \t]*===?[ \t]*expected[^\)]*\)/m.exec(writebackSrc);
  if (!m) return 'unknown';
  const cond = m[0].replace(/^[ \t]*if[ \t]*\(/, '').replace(/\)$/, '');
  return /\|\|/.test(cond);
}

/**
 * 「这份驱动能不能被安全 require」—— 行为档的前提，必须先判它，再决定要不要执行。
 *
 * 动因是 2026-10-24 的现场：本机 vendor 驱动被另一个会话改写，末尾从
 * `if (require.main === module) process.exit(main())` 变成裸 `process.exit(main())`，
 * 于是本探针的那次 require **把别人的整条评审流水线跑了进来并 exit 掉本进程** ——
 * `--json` 档的 stdout 变成「判定记录按 diff 内容寻址命中…」，调用方 `JSON.parse` 当场炸，
 * 而报错读起来像"探针输出坏了"，不像"探针执行了不该执行的东西"。
 *
 * 四个成因不得合并（把「不该执行」与「执行了但拿不到函数」并成一句，
 * 下一个会话就会把静默跳过读成"两路一致"）：
 *   'ok'                  ⇒ 可以 require，且导出面在
 *   'no-exports'          ⇒ 可以 require 但没有导出面 ⇒ 行为档取不到函数，属**真失明**（要出声、要 rc=1）
 *   'executes-on-require' ⇒ 顶层无守卫地执行 main() ⇒ **禁止 require**（不代跑别人的流水线）
 *   'unreadable'          ⇒ 传进来的不是可读源码
 * 判据取"调用 main() 的那一句是否落在 require.main 守卫里"，不取"文件里出现过几处 process.exit"——
 * 驱动在函数体内用 `process.exit(2)` 做缺依赖早退是合法的（两份现场样本都有那一处），
 * 拿它当"不可加载"会把唯一正常的形态判成禁止执行。
 */
const MAIN_INVOCATION = /\bprocess\.exit\(\s*main\s*\(\s*\)\s*\)/;
const MAIN_GUARDED = /\bif\s*\(\s*require\.main\s*===\s*module\s*\)\s*process\.exit\(\s*main\s*\(\s*\)\s*\)/;
const BEHAVIORAL_SKIP_REASONS = new Set(['unreadable', 'executes-on-require']);

function driverLoadability (driverSrc) {
  if (typeof driverSrc !== 'string' || driverSrc.trim() === '') return { loadable: false, reason: 'unreadable' };
  if (MAIN_INVOCATION.test(driverSrc) && !MAIN_GUARDED.test(driverSrc)) return { loadable: false, reason: 'executes-on-require' };
  if (!/\bmodule\.exports\b/.test(driverSrc)) return { loadable: true, reason: 'no-exports' };
  return { loadable: true, reason: 'ok' };
}

/**
 * ② 的行为交叉验证：直接**调** vendor 导出的 `blockingFromAdjudication`（本文件不执行它，由调用方注入）。
 * 两份合成裁决唯一差别是那条 upheld 有没有处置凭证：
 *   无凭证 ⇒ 必须计阻断（否则"随便填两格"就能收口）
 *   有凭证 ⇒ 计不计阻断，就是这条出口在不在 —— 答案不同才算在位。
 * 为什么不留给结构读法单独说话：那个函数长什么样不重要，**它答什么**才决定一条 PR 会不会被永久钉住。
 *
 * 凭证带**两份形状**（QM-6 第一轮评审 i2/i5 逼出来的修正）：
 *   `externalReview.{performedBy,evidenceRef,reviewedAt}` —— vendor **今天真的认**的那一份
 *     （高危域那条出口就读它，见 `externalReviewReceiptLive` 的正控）；
 *   `resolution.{resolvedBy,verifiedBy,verifiedAt}` —— 假想中"给 upheld 补一臂"会读的那一份。
 * 只写后者是本模块最初版的错：那份键名 vendor 从未读过，于是"带凭证仍阻断"这句话
 * 是在拿一份**没有任何分支会消费的形状**做测量 —— 读数为 false 是碰巧对，不是量出来的。
 * @param {Function|undefined|null} fn vendor 的 blockingFromAdjudication
 * @returns {boolean|'unavailable'} 'unavailable' = 拿不到函数（CI 上没有 vendor），不得读成 false
 */
const RECEIPT_EXTERNAL = {
  // 形状夹具，不是真凭证：EXTERNAL_EVIDENCE_RE 只判 URL 形状，vendor 自己也不联网核真伪。
  // 用本仓真 URL + 不存在的评论号，是为了让"这是合成的"在源码里一眼可见（编一个像真号的 id 才是隐患）。
  performedBy: 'claude',
  evidenceRef: 'https://github.com/Colinchiu007/mulpub/pull/0#issuecomment-0',
  reviewedAt: '2026-10-23T00:00:00.000Z',
};
const RECEIPT_RESOLUTION = {
  resolvedBy: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  verifiedBy: 'scripts/qm6-exit-capabilities.test.js',
  verifiedAt: '2026-10-23T00:00:00.000Z',
};

function mkAdj (itemOverrides) {
  return {
    items: [Object.assign({
      id: 'i1', severity: 'Warning', verdict: 'upheld', highRiskDomains: [], finding: 'f',
    }, itemOverrides || {})],
    requiresExternalReview: [], expectedExternalBackend: 'claude', confidenceWeight: 0.6,
  };
}

function asBlocking (fn, adj, label) {
  const out = fn(adj);
  if (!Array.isArray(out)) throw new Error('blockingFromAdjudication 在' + label + '那份返回值不是数组，行为档无从比较');
  return out;
}

/**
 * 正控：vendor 自己声明的那份凭证（`externalReview` 三格）在**高危域那条**上必须真的能解除阻断。
 * 这一格的意义全在"正控"两个字：它证明本模块写的那份形状**确实被某个分支消费**。
 * 没有它，"带凭证仍阻断"可能只是"我写的键没人读"，而这两种情况在 false 这个读数上完全同形。
 * @returns {boolean|'unavailable'}
 */
function externalReviewReceiptLive (fn) {
  if (typeof fn !== 'function') return 'unavailable';
  const out = asBlocking(fn, mkAdj({ highRiskDomains: ['crypto'], externalReview: RECEIPT_EXTERNAL }), '正控');
  return out.length === 0;
}

/**
 * @param {Function|undefined|null} fn vendor 的 blockingFromAdjudication
 * @param {{receiptLive?: boolean|'unavailable'}} [opts] 正控读数；为 false 时本函数**拒绝**给结论
 *   （凭证没被任何分支消费过时，"没有出口"这个读数什么也没测 —— 报 unavailable 比报 false 诚实）
 */
function upheldExitBehavioral (fn, opts) {
  if (typeof fn !== 'function') return 'unavailable';
  const bare = asBlocking(fn, mkAdj(null), '无凭证');
  const receipted = asBlocking(fn,
    mkAdj({ externalReview: RECEIPT_EXTERNAL, resolution: RECEIPT_RESOLUTION }), '带凭证');
  if (bare.length === 0) throw new Error('无凭证那份居然不阻断 ⇒ 这条出口没有"缺一格即拦"的防呆，不得判在位');
  if (opts && opts.receiptLive === false) return 'unavailable';
  return receipted.length === 0;
}

/**
 * ③ 的行为交叉验证：喂两个"两版实现答案必须不同"的写回器源码给同一个结构读法，
 * 只有一条真跑路径可选（applyWriteback 会写文件），故 ③ 以源码形状为准 + 由契约锁的夹具保证区分度。
 */
/** 顶层函数体的括号配对切片；配不平返回 null（调用方按"取不到数"处理，不得当成"没有出口"）。 */
function sliceFunctionBody (srcFromKeyword) {
  return sliceBlock(srcFromKeyword);
}

/** 从第一个 `{` 起做括号配对；输入不含 `{` 或配不平均返回 null。 */
function sliceBlock (src) {
  if (typeof src !== 'string' || src === '') return null;
  const open = src.indexOf('{');
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

/**
 * 结构读法与行为真跑的交叉比较。放这里而不是放探针里，是为了让它**在 CI 上也可测**：
 * 探针里那段依赖 vendor 是否存在，而这个函数只吃两个值 —— 四种组合都能喂夹具。
 * @returns {{ok:boolean, note:string}} 不一致即不 ok（调用方据此 rc=1），'unavailable' 单独一档、不算不一致
 */
function crossCheckUpheld (structural, behavioral, skipReason) {
  // 跳过成因必须如实带出来：把 `executes-on-require` 报成 `no-vendor` 是合并成因，
  // 读的人会以为"这台机器没装引擎"，而实情是"装了但一 require 就会把别人的流水线跑进本进程"。
  if (behavioral === 'unavailable') return { ok: true, note: 'behavioral=skipped(' + (skipReason || 'no-vendor') + ')' };
  if (structural === 'unknown') return { ok: true, note: 'structural=unknown（不参与比较，也不得被比较结果改成结论）' };
  if (structural !== behavioral) {
    return { ok: false, note: `结构读法=${structural} 而真跑=${behavioral} ⇒ 两条路对同一条出口给出不同答案，读数不可信（结构谓词要重做）` };
  }
  return { ok: true, note: structural ? '两路一致：这条出口在位' : '两路一致：这条出口不在位' };
}

/** 三格一起读，返回**读数**而不是结论；结论由 `conclusionLine` 按读数生成。 */
function readCapabilities (sources, readers) {
  const s = sources || {};
  // 读法可注入：不是为"可测而加钩子"，而是因为这条聚合层唯一的价值就是"三档不变量"，
  // 而不变量只能在**坏返回值**上被证明（把下面这道检查改成恒过，本仓没有第二条路会发现）。
  const r = Object.assign({ externalReviewCapable, upheldExitCapable, toolSignatureCapable }, readers || {});
  const externalReview = r.externalReviewCapable(s.driverSrc);
  const upheld = r.upheldExitCapable(s.driverSrc);
  const toolSignature = r.toolSignatureCapable(s.writebackSrc);
  for (const [k, v] of Object.entries({ externalReview, upheld, toolSignature })) {
    if (!NOVEL.has(String(v))) throw new Error(`谓词 ${k} 返回了非三档值：${JSON.stringify(v)}（实现坏了，不是没有出口）`);
  }
  return {
    externalReview, upheld, toolSignature,
    unknown: [externalReview, upheld, toolSignature].filter((v) => v === 'unknown').length,
    readFrom: { driver: s.driverPath || null, writeback: s.writebackPath || null },
  };
}

/**
 * 结论行生成器：每一条分句都必须能追溯到一个布尔，否则它就是下一个"vendor 改了而这里恒绿"的漂移源。
 * 'unknown' 单独成一档措辞 —— 把"读不出"写成"没有出口"就是本次要防的那类假话。
 */
function conclusionLine (caps) {
  const c = caps || {};
  const phrase = (v, yes, no, unknown) => (v === 'unknown' ? unknown : (v === true ? yes : no));
  return [
    phrase(c.externalReview,
      '高危域条目：填齐外部复核三格后可解除（vendor 已能表达）',
      '高危域条目：self-play 内无出口',
      '高危域条目：读不出（vendor 缺席或被改名，不得当成无出口）'),
    phrase(c.upheld,
      '；upheld 条目：带处置凭证可解除',
      '；诚实标 upheld ⇒ 永久阻断（机制缺口，非本 PR 缺陷）',
      '；upheld 条目：读不出（不得当成无出口）'),
    phrase(c.toolSignature,
      '；工具署名：自扮演收口可署 tier',
      '；工具署名：自扮演收口永拿不到 tier=external（须人工补字段或全驳回）',
      '；工具署名：读不出（写回器形状变了）'),
  ].join('');
}

module.exports = {
  externalReviewCapable, upheldExitCapable, toolSignatureCapable,
  upheldExitBehavioral, externalReviewReceiptLive, crossCheckUpheld,
  readCapabilities, conclusionLine, sliceFunctionBody, sliceBlock,
  mkAdj, RECEIPT_EXTERNAL, RECEIPT_RESOLUTION,
  driverLoadability, BEHAVIORAL_SKIP_REASONS, MAIN_INVOCATION, MAIN_GUARDED,
};
