#!/usr/bin/env node
// 执行记录存在性判据（change: enforce-gate-record-presence）
//
// 它拦的是哪一种形态：一个 PR 合并进了 main，却在 `.quality-gates.md`、`openspec/records/`、
// PR 正文、PR 评论里**任何一处**都没留下执行记录。既有门禁 `check-gate-record-debt.js` 的两条
// 强制判据都以"记录存在"为前提（一条看已存在的行是否收口，一条看最顶部那篇是否带行），
// 所以对"整篇缺席"完全免疫 —— 这不是它写得不好，是它的定义域就到这儿（#2570 自己在
// 「遗留与已知漏洞」里写明了这点）。
//
// 实测依据（窗口 2026-09-26 起，origin/main first-parent 132 个提交；本仓 squash 落地是**单亲**
// 提交，用 --merges 几乎查不到）：未碰 .quality-gates.md 70 个；按 classify-docs-only 同一份
// 白名单判出非 docs-only 47 个；再查 PR 正文与评论，32 个确有门禁内容、但只有 2 个提到
// 「远程同步」——也就是缺的恰好是唯一可机器检的那一行。
//
// 三条被实测钉住的设计前提：
//   1) 变更集只有一份取源：复用 classify-docs-only.js 的 changedFileStatuses（它内部 merge-base
//      + `diff --name-status -z`）。本脚本自己**不得**再拼 git diff —— 否则两份口径漂移时，
//      同一个 PR 会出现"一处判纯文档、另一处判缺记录"这种不可归因的红。
//   2) 必须区分 A/M/D：只看文件路径会把"改了别人的记录"当成"自己写了记录"而放行。
//      实测 `-z` 形态是「状态 NUL 路径」交替、重命名带相似度数字（R100），两者都踩过。
//   3) forward-only：历史欠账只可见不拦截，否则一上线就红几十条而不可用。
//
// 模式（D8）：默认 enforce。第一步落地时 CI 显式传 `--mode=advisory`，此时判据打印
// `MODE=advisory` 并恒退出 0；该标记行本身被 check-pr-exec-record.test.js 钉住，
// 转阻断那一步就是删掉这个显式参数 —— 于是"还没接进判定"这件事有东西在检测，
// 不会像 release-gate 的视觉项那样永远停在"人工核查"。
//
// 用法：node scripts/check-pr-exec-record.js --base=<ref> [--head=HEAD] [--repo=<dir>]
//        [--mode=enforce|advisory] [--threshold=3] [--statuses=<json>] [--no-remote]
// 回归：node --test scripts/check-pr-exec-record.test.js

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { changedFileStatuses } = require('./classify-docs-only.js')

const RECORDS_RE = /^openspec\/records\/[^_][^/]*\.md$/
const EXEMPT_RE = /^openspec\/records\/_exempt\/[^_][^/]*\.md$/
// 记录/台账载体：回填型 PR（出路④）的变更集**全部**落在这些文件上才算纯回填。
// 与 .quality-gates.md 的「远程同步」行、scripts/gate-record-debt-ledger.json 的账本
// 是同一组实体。注意：载体文件**可以**承载行为变更（翻门槛/收缩账本），所以出路④
// 额外要求至少一篇记录文件的 M —— 见 isPureBackfillChangeSet（QM-6 前端 C2 收紧）。
const CARRIER_RE = /^(?:openspec\/records\/[^_][^/]*\.md|\.quality-gates\.md|scripts\/gate-record-debt-ledger\.json)$/
// 审计产物：#3396 的 pre-commit 会在每次提交后把本次产生的判定记录（.ccg/reviews/<pre-commit HEAD sha>.json）
// 自动 stage 进同一个提交。它们不承载门禁语义、不是功能改动，却会让「在任何跑过门禁的 worktree 里做
// 纯回填」被④判成夹带新增（实测 PR #3432：本地 enforce 红，而 CI 的 Gate Result 因 docs-only 通道照过）。
// 放宽只发生在一个维度上：状态必须是 A，且文件名必须精确匹配 .ccg/reviews/<小写十六进制>.json。
// M/D、短 sha、大写、多一段目录或后缀、别的目录、任何非载体文件 —— 一律仍不算纯回填；
// 且 C2 收紧（至少一篇记录 M）不因这些新增而被绕过。
//
// ★ 2026-10-16（ccg-record-content-addressing）：位宽由「只认 40」放宽为「**40 或 64**」。
//   40 位 = 历史形态（父 sha）；64 位 = 新形态（内容寻址键 stagedDiffHash，sha256）。
//   两种必须同时认：只认 64 会让全部历史记录被判夹带；而**不加约束**地放宽成任意 .json
//   会让 `scripts/evil.js` 一类真·功能新增借道这条白名单（既有负例锁见
//   check-pr-exec-record.test.js 的「审计产物白名单不得被形态邻近的写法穿过」）。
//
// ★★ 第三轮 i2 修正：必须**同时认 alt 形态**。
//   同名记录已有实质内容（findings 非空或已闭环）时，判定器把本次判定另存为
//   `<64hex>-again-<40sha>-<ISO时间戳>.json`（见 ccg-review-decider.js 的拒写分支）。
//   首版**没认这个形态** ⇒ 钩子若把它 stage 进同一次提交，出路④判「非纯回填」而假红；
//   不 stage 则审查结论与门禁脱钩。属「声称同源的三处漏了第四处」。
//   形态收得很紧：后缀必须形如 `-again-<40hex>_<14位T时间戳>`，且必须带 T 与 Z。
const AUDIT_ARTIFACT_RE = /^\.ccg\/reviews\/(?:[0-9a-f]{40}|[0-9a-f]{64})(?:-again-[0-9a-f]{40}-(?:\d{8}T\d{6}(?:\.\d{1,3})?Z|\d{4}-\d{2}-\d{2}T\d{9}Z))?\.json$/
// 目录级判据：落在 .ccg/reviews/ 且是 .json 就进入「该不该被扫」的讨论范围。
// 与 AUDIT_ARTIFACT_RE（已知形态）刻意分开，是为了让「命名又变了一次」这件事可被察觉：
// 2026-10-17 实测，0386afdfc（#3755）把判定记录从 <40hex> 换成 <stagedDiffHash=64hex>，
// 那次顺手把形态表也放宽了——但没有任何东西保证下一次改名还会管这里。
const REVIEWS_DIR_RE = /^\.ccg\/reviews\/[^/]+\.json$/

/**
 * 这份 json 是否确实是一条评审记录 —— 按内容判，不按文件名猜。
 * 只看 mode / deepReview / decidedBy 三个键：同目录下另有 workflowstructure-* 一类入库原件，
 * 把「目录里有 json」一律当失明来喊会让正常文档 PR 无故变红 —— 那是把锁换成噪音。
 */
function isReviewRecord (repo, rel) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'))
    if (!rec || typeof rec !== 'object') return false
    return rec.mode !== undefined || rec.deepReview !== undefined || rec.decidedBy !== undefined
  } catch { return false } // 损坏/非 JSON 由别的门禁负责，这里不重复报
}
const DEFAULT_THRESHOLD = 3

// ---------- 位宽/形态说明的**单一真源**（2026-10-17，ccg-record-width-message） ----------
//
// 为什么要有这一段：出路④的提示文案原先**手写**了位宽说明（`<40 位…>` 那种写法）。
// （此处**不复述**旧全句：本文件末尾的派生锁要求「源码里不得出现手写的位宽短语」，
//   若在此处完整引用一遍旧文案，就会与那条判据自相冲突 —— 复述历史不构成豁免。）
// 判据在 #3755 被放宽为「40 或 64 位 + alt 形态」时，只改了正则与上方注释，漏改这条用户可见文案
// ⇒ 两处独立可漂移的真源，且按提示排障的人会把 **64 位记录误判成不算纯回填**，
// 进而给一个真实满足④的 PR 硬加一份本不需要的记录文件（PR #3772 上实际踩到）。
//
// 修法不是「再写一遍 + 交叉核对」（那只是把第二处真源保留下来、加一把锁看着它），
// 而是**让文案由判据生成**：位宽集合从 `AUDIT_ARTIFACT_RE` 的**行为**推出，文案片段由该结果拼出。
// 这样「文案说的」与「判据做的」结构上是同一个值，不存在漂移的余地。
//
// 关键决定：**按行为探测、不按正则字面形状解析**。
// 理由是 QM-6 i1 指出的假阳性：若将来把正则改写成等价但不同形状的写法
// （`[0-9a-f]{40,64}`、`.{40}`、加 `/i` 等），任何「从字面里抠 `\{(\d+)\}`」的做法都会取空或取错，
// 于是锁变红却**分不清是文案错了还是正则重构了**。行为探测对等价改写免疫。
const AUDIT_NAME_WIDTH_MIN = 8
const AUDIT_NAME_WIDTH_MAX = 200
// alt 形态的 sha 段探测范围与 ISO 段候选（同样只用于**探测**，不用于断言形状）
const AUDIT_ALT_SHA_MIN = 4
const AUDIT_ALT_SHA_MAX = 80
const AUDIT_ALT_ISO_CANDS = [
  { text: '-20261017T120000Z', label: 'ISO 时间戳' },
  { text: '-20261017T120000.123Z', label: 'ISO 时间戳（含毫秒）' },
  // 生产方形态：`new Date().toISOString().replace(/[:.]/g, '')` 删掉冒号与点，但**日期里的连字符留着**
  // ⇒ 真实投影是 2026-10-18T021638562Z。前两条是想象形态（无生产方），它们与旧正则同源，
  //   所以行为探测曾自洽地绿而判据实际拒绝生产方写出的文件名 —— 候选表缺这一格，探测就看不见真形态。
  { text: '-2026-10-18T021638562Z', label: '生产方 ISO 投影（日期保留连字符）' },
]
function auditArtifactName (width, suffix) {
  return '.ccg/reviews/' + 'a'.repeat(width) + (suffix || '') + '.json'
}
/**
 * 判据**实际接受**的位宽集合（按行为探测得出，是文案的唯一真源）。
 *
 * QM-6 第三轮 i2/i5：结果**模块级缓存**并冻结。两条理由：
 *   ① 每次调用要跑 (MAX-MIN+1)=193 次正则探测，而它位于 evaluate() 的出错分支上；
 *      虽然只在要生成提示时触发，但没有理由每次都重算。
 *   ② alt 探测以 `auditAcceptedWidths()[0]` 为基准宽度。不缓存的话两处各算一次，
 *      任何一次内部状态变化都可能让两者读到不同结果（审阅者 i5 指出的不一致）；
 *      缓存后两个派生函数共用**同一次快照**，一致性由构造保证。
 *
 * 冷路径预算（QM-6 第四轮 i5 要求写明）：首次调用做 (MAX-MIN+1) 次 `RegExp.test`，
 * 在 V8 上是微秒级；且本函数**只在生成提示文案时**被调到 —— 判据通过（`submitted === true`）
 * 的路径上完全不执行。**故意不缩小扫描窗口**：把 8..200 收窄成 8..96 能省一半探测，
 * 但会让「未来出现 100 位记录名」从「被正确采纳」变成「fail-closed 报错」——
 * 那是拿正确性换微秒，方向错了。
 */
let _widthsCache
function auditAcceptedWidths () {
  if (_widthsCache !== undefined) return _widthsCache
  const out = []
  for (let w = AUDIT_NAME_WIDTH_MIN; w <= AUDIT_NAME_WIDTH_MAX; w++) {
    if (AUDIT_ARTIFACT_RE.test(auditArtifactName(w))) out.push(w)
  }
  _widthsCache = Object.freeze(out)
  return _widthsCache
}
/**
 * 判据**实际接受**的 alt 形态（按行为探测得出），形如：
 *   { shaWidths: [40], isos: ['ISO 时间戳'] }
 * 不接受 alt 形态时返回 null。
 *
 * ★ QM-6 第二轮 i1/i3：首版把 alt 描述**硬编码**成 `-again-<40 位 sha>-<ISO 时间戳>`。
 *   于是若判据把 alt 的 sha 宽度改成 `[0-9a-f]{32}`，探针（固定 `'b'.repeat(40)`）仍会失败、
 *   看起来「一切正常」，但真实行为已变、描述却还写着 40 位 ⇒ **文案又说谎了，只是这次
 *   没有探针能发现**。所以 alt 的 sha 宽度与 ISO 段都必须由探测得出，描述再由探测结果拼出。
 */
let _altFormCache
function auditAcceptedAltForm () {
  if (_altFormCache !== undefined) return _altFormCache
  const mainW = auditAcceptedWidths()[0]
  if (!mainW) { _altFormCache = null; return null }
  const shaWidths = []
  for (let w = AUDIT_ALT_SHA_MIN; w <= AUDIT_ALT_SHA_MAX; w++) {
    if (AUDIT_ARTIFACT_RE.test(auditArtifactName(mainW, '-again-' + 'b'.repeat(w) + AUDIT_ALT_ISO_CANDS[0].text))) {
      shaWidths.push(w)
    }
  }
  if (shaWidths.length === 0) { _altFormCache = null; return null }
  // 在已确认的 sha 宽度里，逐个试 ISO 段候选，收集被接受的那些
  const isos = AUDIT_ALT_ISO_CANDS
    .filter((c) => AUDIT_ARTIFACT_RE.test(auditArtifactName(mainW, '-again-' + 'b'.repeat(shaWidths[0]) + c.text)))
    .map((c) => c.label)
  _altFormCache = {
    shaWidths,
    isos,
    description: '-again-<' + shaWidths.join(' 或 ') + ' 位 sha>-<' + isos.join(' 或 ') + '>',
  }
  return _altFormCache
}
/**
 * 把源码削成「只含代码行」的视图：剥行内注释 + 剥全行注释。
 * 供派生锁扫描「文案里有没有手写的第二处说明」使用。
 *
 * ★ 为什么必须先规范化 \r\n（QM-6 第二轮 i2，真踩过）：
 *   JS 的 `.` **不匹配 \r**、`$` 也不在 \r 之前匹配 ⇒ 对 CRLF 文本用 `/\/\/.*$/`
 *   会**整体匹配失败**，行内注释剥离静默失效；而一旦不再用 `startsWith('//')` 兜底，
 *   全行注释也会漏掉 ⇒ 注释被当成代码，派生锁反向误伤自己的文档。
 *   本仓是 CRLF 工作副本，这个坑一定会踩到。
 */
function stripCommentsForScan (text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(stripTrailingComment)
    .filter((l) => {
      const s = l.trim()
      return Boolean(s) && !s.startsWith('*') && !s.startsWith('/*')   // 块注释续行/起始行
    })
    .join('\n')
}

/**
 * 剥掉一行末尾的 `// 注释`，**引号感知**。
 *
 * QM-6 第三轮 i3：首版无条件 `/\/\/.*$/` 截断 —— 字符串里的 `//`（URL、正则字面量）
 * 会被当成注释起点，把该行后半段**截掉**。方向是「少扫」不是「误报」，但仍会让派生锁
 * 漏掉藏在被截断区段里的手写短语（假绿）。真正的修法是语法分析器，可这个文件被
 * `changes` job 直接 require，**只能 require node 内置模块**（见 AGENTS.md 前提锁），
 * 引不进 acorn。所以退而求其次做**最小状态机**：只认引号外的 `//`。
 * 覆盖 `'`、`"`、```、`\` 转义；模板字符串里的 ${} 不细究（写门禁源码时不会用）。
 * 已知边界：正则字面量里的 `//`（如 /a\/\/b/）仍可能被误判为注释起点；
 * 该类字面量在本文件只出现在 stripTrailingComment 自身，且方向仍是「少扫」。
 */
function stripTrailingComment (line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i)
  }
  return line
}

/** 生成「<N 或 M 位小写十六进制>」这段说明；判据被改成无法探测的形状时 fail-closed 出声 */
function describeAuditWidths () {
  const ws = auditAcceptedWidths()
  if (ws.length === 0) {
    // QM-6 第二轮 i5：错误信息必须能区分「正则被重构」与「文案写错」，
    // 所以把正则字面量与探测范围一并打出来，让人一眼知道该改哪边。
    throw new Error('[check-pr-exec-record] 行为探测覆盖不到任何位宽：'
      + 'AUDIT_ARTIFACT_RE = ' + String(AUDIT_ARTIFACT_RE)
      + '；探测范围 ' + AUDIT_NAME_WIDTH_MIN + '..' + AUDIT_NAME_WIDTH_MAX + ' 位小写十六进制 + .json，全部不匹配。'
      + '这**不是**文案写错，而是判据形状超出了探测范围 —— 请同步 auditAcceptedWidths() 的探测方式'
      + '（fail-closed：宁可红，也不让文案与行为脱钩）')
  }
  return '<' + ws.join(' 或 ') + ' 位小写十六进制>'
}

// 出路④的判据核心（独立成纯函数以便直接单测，QM-6 前端 I1）：变更集非空、每条都是载体的 M
// （或精确形态的审计产物 A）、且至少一篇是记录文件（C2 收紧，理由见 evaluate 内注释）。
function isPureBackfillChangeSet (statuses) {
  return Array.isArray(statuses) && statuses.length > 0
    && statuses.every((e) => (e.status === 'M' && CARRIER_RE.test(e.file)) || (e.status === 'A' && AUDIT_ARTIFACT_RE.test(e.file)))
    && statuses.some((e) => e.status === 'M' && RECORDS_RE.test(e.file))
}

// 记录/豁免的判据核心：输入全是数据，不碰 git、不碰网络 —— 这样每条规则都能单测，
// 而"从真实 git 取到 statuses"这一环由一条独立接缝测试守（夹具不得替实现剥壳）。
function evaluate({
  statuses = [],
  headBranch = '',
  branchSource = 'unknown',
  exemptOnDisk = [],
  remoteBranches = new Set(),
  threshold = DEFAULT_THRESHOLD,
} = {}) {
  const reasons = []
  const addedRecords = statuses
    .filter((e) => e.status === 'A' && RECORDS_RE.test(e.file))
    .map((e) => e.file)
  const addedExempts = statuses
    .filter((e) => e.status === 'A' && EXEMPT_RE.test(e.file))
    .map((e) => e.file)

  // 记录按分支名一一对应，所以"M 自己那篇"仍可作为本 PR 携带记录（回填/修订是同一条记录的
  // 正常演进）；M 别人的记录仍不算 —— 放宽只按文件名 == <分支名>.md 这一维发生，不是按状态放宽。
  // 两条收紧都是外部评审实测逼出来的：
  // ① 必须同时满足 RECORDS_RE —— 否则分支名撞上 _TEMPLATE 这类保留名时"改模板"就满足判据
  //    （实测 headBranch='_TEMPLATE' + M openspec/records/_TEMPLATE.md 曾判 ok=true）；
  // ② headBranch 必须是**真分支名**：detached HEAD 解析出的字面量 "HEAD" 由 resolveHeadBranch 置空，
  //    否则 ownRecordPath 退化成 openspec/records/HEAD.md，放宽在 CI 上永不触发（CI 恰是唯一生效处）。
  const candidateOwnPath = headBranch ? `openspec/records/${headBranch}.md` : ''
  const ownRecordPath = candidateOwnPath && RECORDS_RE.test(candidateOwnPath) ? candidateOwnPath : null
  const revisedRecords = statuses
    .filter((e) => e.status === 'M' && ownRecordPath && e.file === ownRecordPath)
    .map((e) => e.file)

  // 出路④（#2920 实测动因）：回填型 PR 的定义恰恰是 M **别的分支**那篇记录 —— 出路①②③对它
  // 全部不可用。判据取最窄形态：变更集**每一条**都是载体文件的 M（夹带任何 A/D/非载体文件即不算），
  // 且**至少含一篇记录文件的 M**（QM-6 前端 C2 收紧：载体文件自身可承载行为变更——
  // .quality-gates.md 可翻门槛、账本可收缩欠账；改动前「只 M 载体不带记录」是红的，
  // 放行若无此条件就把那扇门重新打开。回填的本质是修订记录，SOP 里销账与记录更新同次发生，
  // 因此无记录文件的载体集不构成回填）。M+D 混合（删记录）仍必须另交记录。
  //
  // 两条计数是**包含关系而非互斥**（QM-6 后端 W1 修正注释）：isPureBackfill 时
  // revisedRecords ⊆ backfillRevised（本分支那篇同时出现在两边，归属维度不同）；
  // 真正互斥的是出路④与豁免出路（掺进 A 豁免即不再纯回填）。
  //
  // 分支名必须可解析（QM-6 后端 W1）：出路④若不依赖 headBranch，CI 上 --head-branch 注入
  // 失效（detached 且无 GITHUB_HEAD_REF）会让纯 M 记录 PR 以 head分支=(空) 判绿 ——
  // resolveHeadBranch「宁可判没带记录，也不猜分支」的 fail-closed 设计被静默吞掉。
  // 因此分支名不可解析时出路④不适用，并出专用理由（区别于泛泛的"未携带记录"）。
  //
  // 信任边界（QM-6 后端 I4-info 起于"文档化不改码"，change: gate-record-sync-derived-status 之后口径变了）：
  // 出路④本身仍只校验文件/状态形态，不校验 M 的内容。但原先那句"PENDING→PASS 的真实性依赖人工 review"
  // 已经不成立也不需要了——新形态记录根本不写 PASS，收口由 check-gate-record-debt.js 按主干历史
  // （哪个带 (#NNNN) 尾注的已合并提交最近一次把这文件带进 main）**推导**，谎写在合并前会被判 prematureClaim。
  // 遗留的未校验面只剩旧形态（blob 里手写的 PASS），随存量顺路清理收敛，不再为它新建豁免。
  const backfillShaped = isPureBackfillChangeSet(statuses)
  const isPureBackfill = backfillShaped && headBranch !== ''
  const backfillRevised = isPureBackfill
    ? statuses.filter((e) => e.status === 'M').map((e) => e.file)
    : []
  if (backfillShaped && !isPureBackfill) {
    reasons.push('变更集形似纯回填，但分支名不可解析（detached 且无 CI 注入）⇒ 判据 fail-closed：'
      + '出路④需要可解析的分支名来区分「修订本分支记录」与「回填别人的记录」。'
      + '请由 CI 注入 PR head 分支名（GitHub Actions: GITHUB_HEAD_REF，本地传 --head-branch）。')
  }

  // 变更集为空 = 取不到证据，不等于"这个 PR 没改文件"。判红，不接受空清单当通过。
  if (!Array.isArray(statuses) || statuses.length === 0) {
    reasons.push('变更集为空或取证失败：无法判定本 PR 是否携带执行记录。判据按 fail-closed 处理，'
      + '请确认 --base/--head 可解析（merge-base 与 diff 由 classify-docs-only.changedFileStatuses 统一提供）')
  }

  const badExempts = exemptOnDisk.filter((e) => !String(e.reason || '').trim())
  for (const e of badExempts) {
    reasons.push(`豁免缺少非空原因：${e.branch || '(无名)'} —— 豁免必须是显式承认，不是静默绕过`)
  }

  // 同一分支既交记录又交豁免是矛盾：豁免的语义是"这次没有可记录的行为变更"。
  const hasRecord = addedRecords.length > 0 || revisedRecords.length > 0
  const bothForBranch = addedExempts.length > 0 && hasRecord
  if (bothForBranch) {
    reasons.push(`矛盾：本 PR 同时新增了记录文件与豁免文件（${addedRecords[0] || revisedRecords[0]} 与 ${addedExempts[0]}）。`
      + '二者语义互斥，请删除豁免那一侧')
  }

  // 提交性判定与结论判定必须分开：先算"有没有交东西"，把全部违规理由收集完，
  // 最后 ok = 无理由。先前写成 ok = 交了记录就算通过，于是"同时交记录与豁免"和
  // "待清理豁免超阈值"两条都出了理由却仍判通过 —— 那是装饰性门禁。
  const submitted = hasRecord || addedExempts.length > 0 || isPureBackfill
  if (!submitted && statuses.length > 0) {
    reasons.push('本 PR 未携带执行记录。四条合法出路任选其一：'
      + `①新增 openspec/records/<分支名>.md（按 _TEMPLATE.md，含门禁表与「远程同步」行；`
      + '该行**不需要事后回填**——收口由门禁按主干历史推导，合并前判 byDesign 不红；'
      + '可选写 delivered_by_pr 作意图声明，与主干事实不符会判红。别再写 sync_* 三字段）；'
      + '②修订本分支自己那篇 openspec/records/<分支名>.md（旧形态记录的收口改写走这条）；'
      + '③确属无需记录 ⇒ 新增 openspec/records/_exempt/<分支名>.md 并写明非空原因；'
      + '④纯回填（定义）：变更集全部是既有记录/台账载体（openspec/records/*.md、.quality-gates.md、'
      + 'scripts/gate-record-debt-ledger.json）的 M（允许 .ccg/reviews/' + describeAuditWidths()
      + '.json 形态的 A'
      + (auditAcceptedAltForm() ? '，可带 ' + auditAcceptedAltForm().description + ' 后缀' : '')
      + '——那是 #3396 的 pre-commit 自动 stage 的判定记录，不承载门禁语义），且至少含一篇 '
      + 'openspec/records/*.md 的 M ⇒ 满足此定义者直接放行（夹带其它新增、任何删除、任何非载体文件，'
      + '或只改门禁清单/账本而无记录文件，即不符合此定义）。')
  }

  // 已消费的豁免：分支已不在远端（合并即删分支）。要求"同 PR 内自删"在 squash 流程下不可实现，
  // 所以走可见计数 + 阈值。远端清单取不到时 consumedKnown=false，必须出声，不得静默当 0。
  const consumedKnown = remoteBranches instanceof Set
  const consumedExempts = !consumedKnown ? [] : exemptOnDisk
    .filter((e) => e.branch && e.branch !== headBranch && !remoteBranches.has(e.branch))
    .map((e) => `openspec/records/_exempt/${e.branch}.md`)
  if (consumedExempts.length >= threshold) {
    reasons.push(`待清理豁免已堆积 ${consumedExempts.length} 条（阈值 ${threshold}）：其分支已不在远端，`
      + '说明已被消费或废弃，请删除对应文件后放行：\n  ' + consumedExempts.join('\n  '))
  }

  const ok = reasons.length === 0

  function summary() {
    const bits = [
      `本 PR 变更文件 ${statuses.length} 个（A=${statuses.filter((e) => e.status === 'A').length} `
      + `M=${statuses.filter((e) => e.status === 'M').length} `
      + `D=${statuses.filter((e) => e.status === 'D').length}）`,
      `新增记录 ${addedRecords.length} 篇 / 修订本分支记录 ${revisedRecords.length} 篇 / 新增豁免 ${addedExempts.length} 篇`
        + (isPureBackfill ? ` / 回填型 PR（载体修订 ${backfillRevised.length} 篇）` : ''),
      // 载体 M 计数必须无条件打印（QM-6 前端 W9）：回填未成立时（载体 M 夹了代码），
      // 作者只看 "M=3" 无从判断差在哪，这一项让"差一个非载体文件"可见。
      `载体M=${statuses.filter((e) => e.status === 'M' && CARRIER_RE.test(e.file)).length}`,
      // 分支名与它的来源必须每次打印：detached 与注入的差异不在这里出声，就又会变成
      // "CI 上恒判没带记录、本机永远复现不了"的那类静默失效。
      `head分支=${headBranch || '(空)'} 来源=${ownRecordPath ? branchSource : branchSource + '(未启用修订判据)'}`,
      consumedKnown ? `待清理豁免 ${consumedExempts.length} 条` : '待清理豁免 consumed=unknown（远端分支清单取不到）',
    ]
    return bits.join(' ｜ ')
  }

  return { ok, reasons, addedRecords, addedExempts, revisedRecords, backfillRevised, isPureBackfill, ownRecordPath, consumedExempts, consumedKnown, summary }
}

function readExemptsOnDisk(repo) {
  const dir = path.join(repo, 'openspec', 'records', '_exempt')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.md') && !n.startsWith('_'))
    .map((n) => {
      const text = fs.readFileSync(path.join(dir, n), 'utf8')
      const fm = {}
      const lines = text.split('\n')
      if ((lines[0] || '').trim() === '---') {
        for (let i = 1; i < lines.length; i++) {
          const raw = (lines[i] || '').replace(/\r$/, '')
          if (raw === '---') break
          if (/^\s*#/.test(raw)) continue
          const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw)
          if (m) fm[m[1]] = m[2].trim()
        }
      }
      return { branch: fm.exempt_for || n.replace(/\.md$/, ''), reason: fm.reason || '' }
    })
}

function remoteBranchSet(repo) {
  try {
    const out = execFileSync('git', ['-C', repo, 'ls-remote', '--heads', 'origin'],
      { encoding: 'utf8', timeout: 60000 })
    return new Set(out.split('\n').filter(Boolean).map((l) => (l.split('\t')[1] || '').replace(/^refs\/heads\//, '').trim()))
  } catch (e) {
    return null
  }
}

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a)
    if (m) out[m[1]] = m[2]
    else if (a.startsWith('--')) out[a.slice(2)] = true
  }
  return out
}

/**
 * 分支名解析：显式参数 > GITHUB_HEAD_REF（PR 事件的 head 分支）> git rev-parse。
 * `actions/checkout` 在 pull_request 事件检出的是 detached merge ref，
 * `git rev-parse --abbrev-ref HEAD` 必返回字面量 "HEAD" —— 那不是分支名，拿它拼
 * `openspec/records/HEAD.md` 会让"修订自己那篇记录"这条出路在 CI 上恒不成立，
 * 而 CI 恰是这条判据唯一真正执行的地方（本机永远有真分支名）。
 * 所以 detached 且没有上游注入时返回空串：宁可判"没带记录"，也不猜一个不存在的分支。
 * @returns {{branch: string, source: 'arg'|'env'|'git'|'detached'}}
 */
function resolveHeadBranch({ argBranch = '', envHeadRef = '', gitBranch = '' } = {}) {
  const arg = String(argBranch || '').trim()
  if (arg) return { branch: arg, source: 'arg' }
  const env = String(envHeadRef || '').trim()
  if (env) return { branch: env, source: 'env' }
  const git = String(gitBranch || '').trim()
  if (!git || git === 'HEAD') return { branch: '', source: 'detached' }
  return { branch: git, source: 'git' }
}

function main(argv) {
  const args = parseArgs(argv)
  const repo = args.repo || process.cwd()
  // #2923 遗留：显式 `--head=`（空串）必须拒绝，不得经 `|| 'HEAD'` 回落 —— CI 检出下 HEAD 是
  // 合并提交，回落等于把「取证失败」伪装成「取到了」。（未传 --head 仍默认 HEAD，本机直跑不受影响。）
  if (typeof args.head === 'string' && args.head.trim() === '') {
    process.stderr.write('[check-pr-exec-record] --head= 显式为空：取证失败必须显式报错，'
      + '不得回落 HEAD（pull_request 检出下 HEAD 是合并提交）。请由 CI 注入 PR 的 head SHA'
      + '（GitHub Actions: pull_request.head.sha）。\n')
    process.exit(2)
  }
  const head = args.head || 'HEAD'
  const mode = args.mode === 'advisory' ? 'advisory' : 'enforce'
  const threshold = Number(args.threshold || DEFAULT_THRESHOLD)
  let statuses
  if (typeof args.statuses === 'string') {
    try { statuses = JSON.parse(args.statuses) } catch (e) {
      process.stderr.write(`[check-pr-exec-record] --statuses 不是合法 JSON：${e.message}\n`)
      process.exit(2)
    }
  } else {
    if (!args.base) {
      // push 到 main 的事件没有 PR base，而本判据只对 PR 有意义。这里不能无条件 exit(2)：
      // 那会让每个 push run 都红（enforce 阶段更严重）。交回 mode 决定，advisory 只留痕。
      process.stdout.write(`缺 --base：本判据只对 pull_request 事件有意义（需要 PR base 才能算变更集）。mode=${mode}\n`)
      if (mode === 'advisory') process.exit(0)
      process.stderr.write('用法: node scripts/check-pr-exec-record.js --base=<ref> [--head=HEAD] [--repo=<dir>] [--mode=advisory]\n')
      process.exit(2)
    }
    try {
      statuses = changedFileStatuses({ repo, base: args.base, head })
    } catch (e) {
      // 取不到变更集时也必须尊重 mode：checkout 若是浅克隆，merge-base 会失败，
      // 而"在 advisory 阶段就把 job 判红"正是本仓点名的 runner-only red 事故形状。
      process.stderr.write(`[check-pr-exec-record] ${e.message}\n`)
      if (mode === 'advisory') {
        process.stdout.write('MODE=advisory（取证失败，advisory 阶段不拦；转阻断前必须先确认 base/head 可解析）\n')
        process.exit(0)
      }
      process.exit(1)
    }
  }
  let gitBranch = ''
  try { gitBranch = execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim() } catch { /* 取不到就按空串走判据 */ }
  const resolved = resolveHeadBranch({
    argBranch: typeof args['head-branch'] === 'string' ? args['head-branch'] : '',
    envHeadRef: process.env.GITHUB_HEAD_REF || '',
    gitBranch,
  })
  const headBranch = resolved.branch
  const remoteBranches = args['no-remote'] || args.statuses !== undefined ? (args['no-remote'] ? null : new Set([headBranch])) : remoteBranchSet(repo)

  const r = evaluate({
    statuses,
    headBranch,
    branchSource: resolved.source,
    exemptOnDisk: readExemptsOnDisk(repo),
    remoteBranches: remoteBranches || new Set(),
    threshold,
  })
  // ★ 2026-10-15 增（缺陷 D）：CCG 深度审查欠账检查。
  //   与 evaluate 独立：它是「附加债」而非「记录缺失」，
  //   所以只在 evaluate 已通过时追加理由（否则一次报一类，避免噪声淹没主因）。
  //
  //   ⚠️ 必须同时应用到下面的 `r2` 分支：`--no-remote` 时 remoteBranches 为 null，
  //   控制流会重新 evaluate 出 r2 并 return report(r2) —— 若只改 r，欠账会被静默丢弃。
  // base 与变更集同源：--statuses 外部注入时可能没有可用 base，readAtBase 会返回 null 走未证实出口
  const baseRef = typeof args.base === 'string' ? args.base.trim() : ''
  // 丙：覆盖率读数。不参与判定 —— 一上线红两百条会逼人把门削宽（本仓点名的失败形态）。
  let tierLinePrinted = false
  const applyDeepDebt = (target) => {
    if (!tierLinePrinted) {
      tierLinePrinted = true
      process.stdout.write(summarizeTierCoverage(dualClosedDeepReviews(statuses, repo)).line + String.fromCharCode(10))
    }
    // D 方向需要 base 的 blob 才能判「删掉的那条当时是否已闭环」；取不到就返回 null，
    // 由判据按「未证实」出声，而不是静默放行。变更集本身仍只有 changedFileStatuses 一个取源。
    const readAtBase = (rel) => {
      if (typeof baseRef !== 'string' || !baseRef.trim()) return null
      try {
        return execFileSync('git', ['-C', repo, 'show', `${baseRef}:${rel}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
      } catch { return null }
    }
    const deepDebt = evaluateDeepReviewDebt(statuses, repo, readAtBase)
    if (deepDebt.reasons.length > 0) {
      target.ok = false
      target.reasons.push(...deepDebt.reasons)
    }
    return target
  }
  applyDeepDebt(r)
  // 取不到远端清单时不能悄悄按"0 条待清理"过 —— 显式传 null 让 evaluate 自己标 unknown
  if (!remoteBranches) {
    const r2 = evaluate({ statuses, headBranch, branchSource: resolved.source, exemptOnDisk: readExemptsOnDisk(repo), remoteBranches: null, threshold })
    return report(applyDeepDebt(r2), mode)
  }
  return report(r, mode)
}

/**
 * 深度审查的**闭环状态白名单** —— 只有落在这里的状态才算「审查已出裁决」。
 *
 * ★ 判据取白名单而非黑名单（2026-10-15 实测纠正，QM-6 评审 i2 引出）：
 *   初版写的是 `status === 'pending'`（黑名单），只认判定器落下的初始值。
 *   而引擎 ccg-deep-review.js 跑完会写回**别的**状态：实测本 PR 的记录被写成
 *   `self_play_pending`（= 自扮演裁决「5/5 条仍无 verdict」，**公开承认未闭环**），
 *   于是新版门禁照样放行 —— 换一个失败形态就绕过了，正是本仓反复出现的
 *   「判据被改宽」同型错误。
 *   改成白名单后，引擎将来新增任何状态都会**自动**计入欠账（fail-closed）。
 *
 *   来自引擎 writeBack 的取值全集（grep `status:` 穷举）：
 *     cleared / needs_revision / blocked / incomplete            —— diff 层裁决
 *     self_play_resolved / self_play_blocked / self_play_pending
 *     escalated / incomplete_review / error / skipped_by_mode
 *
 * 为什么 cleared / needs_revision / self_play_resolved 算闭环：
 *   三者都意味着**裁决已经产出并落盘**（cleared=放行、needs_revision=无 Critical
 *   但留 High 建议、self_play_resolved=第三档出口已裁决）。本门禁要防的是
 *   「深度审查静默地从未发生」，不是「建议项没改完」—— 后者属评审环节。
 */
const CLOSED_DEEP_REVIEW_STATUSES = new Set([
  'cleared',
  'needs_revision',
  'self_play_resolved',
])

// ── QM-6 丙：来源分档与覆盖率读数（先可见不拦，见 design §9.1）────────────
// 分级只读结构化 tier（闭集）+ evidence；MUST NOT 读 performedBy 散文
//（实测 34 种取值、12 条以 self-play 开头却声明做过外部复核 ⇒ 前缀判据会误判真外部证据）。
const EVIDENCE_TIERS = new Set(['external', 'self-play', 'none'])

/**
 * 出处必须是「可复核的指针」，不是「非空字符串」。
 * 动因（2026-10-17 外部评审命中 + 本机探针实测）：把 evidence 写成单个字符 x 就能被判成
 * external —— 非空判据对「凭空造一条已评审」没有任何抵抗力。这里只认三种可事后核的形态：
 * PR 引用（# + 3 位以上数字）、评审会话 id（ses_ 前缀）、UUID 形态的 session/trace id。
 * 刻意不清洗、不猜、不接受自由文本：形状不对就降 external-unverified（可见不拦，转拦另片）。
 */
function isResolvableEvidence (ev) {
  const s = String(ev).trim()
  if (/#\d{3,}/.test(s)) return true
  if (/ses_[0-9A-Za-z]{6,}/.test(s)) return true
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s)) return true
  if (/[0-9a-f]{40}/.test(s)) return true
  if (/\.(?:log|json|md|txt)(\b|[#/])/.test(s)) return true
  return false
}

function classifyEvidenceTier (dr) {
  if (!dr || typeof dr !== 'object') return 'unknown'
  const t = dr.tier
  if (typeof t !== 'string' || t !== t.trim() || !EVIDENCE_TIERS.has(t)) return 'unknown'
  if (t === 'external') {
    const ev = dr.evidence
    return (typeof ev === 'string' && ev.trim() !== '' && isResolvableEvidence(ev)) ? 'external' : 'external-unverified'
  }
  return t
}

/** 空集也必须出行：否则"这条锁没跑"与"没有记录"在日志里逐字同形。 */
function summarizeTierCoverage (records) {
  const by = { external: 0, 'external-unverified': 0, 'self-play': 0, none: 0, unknown: 0 }
  for (const dr of records) by[classifyEvidenceTier(dr)]++
  const total = records.length
  const line = 'TIER-COVERAGE dual-closed total=' + total +
    ' external=' + by.external + ' external-unverified=' + by['external-unverified'] +
    ' self-play=' + by['self-play'] + ' none=' + by.none + ' unknown=' + by.unknown +
    '（可见不拦；转拦前提：unknown 占比降下来 —— design §9.1 丙）'
  return { total, by, line }
}

/** 变更集里「dual 且已闭环」的记录 —— 覆盖率只统计这一批（新记录天生带 tier）。 */
function dualClosedDeepReviews (statuses, repo) {
  const out = []
  for (const e of statuses) {
    if ((e.status !== 'A' && e.status !== 'M') || !AUDIT_ARTIFACT_RE.test(e.file)) continue
    let rec = null
    try { rec = JSON.parse(fs.readFileSync(path.join(repo, e.file), 'utf8')) } catch { continue }
    if (!rec || rec.mode !== 'dual' || !rec.deepReview) continue
    if (CLOSED_DEEP_REVIEW_STATUSES.has(rec.deepReview.status)) out.push(rec.deepReview)
  }
  return out
}

/**
 * ★ 2026-10-15 增（缺陷 D）：检查 `.ccg/reviews/*.json` 里被判定需要深度审查
 * （`deepReview.required === true`）但**状态不在闭环白名单里**的记录。
 *
 * 动因：`ccg-review-decider.js` 对 mode != skip 的改动会置
 * `deepReview: { required: true, status: "pending", performedBy: null }`，
 * 但**没有任何环节检查它是否被执行过**。而 `ccg-gate.js` 里
 * `verify-quality` / `verify-change` 都是「仅告警不阻断」，
 * 于是「需要深度审查」这件事在流程上完全静默 —— 提交照常通过，
 * 只有一条 pending 记录躺在没人看的 `.ccg/reviews/` 里。
 *
 * 实测教训（2026-10-15）：我自己的 PR 就带着一条 pending 记录合了，
 * 直到用户问「哪些步骤需要补跑」才发现。
 *
 * 设计取舍（不误伤）：
 *   - 只查**本次变更集涉及**的记录文件（A 或 M 的 .ccg/reviews/*.json），
 *     不扫全仓 —— 否则历史遗留的 pending 会让所有 PR 红。
 *   - 记录本身是审计产物（AUDIT_ARTIFACT_RE），其 sha 命名与 squash 合并后的
 *     HEAD 不同，所以按「本次改动是否带上它」判定，不按 sha 反查。
 *   - `status` 缺失/非字符串一律算欠账（fail-closed），不给「字段被删」留后门。
 */
function evaluateDeepReviewDebt (statuses, repo, readAtBase) {
  const reasons = []
  const changedInDir = statuses
    .filter((e) => (e.status === 'A' || e.status === 'M') && REVIEWS_DIR_RE.test(e.file))
    .map((e) => e.file)
  const involved = changedInDir.filter((f) => AUDIT_ARTIFACT_RE.test(f))

  // ★ 扫描域不得静默收窄：形态不认识、但内容确实是评审记录 ⇒ 必须点名出声。
  //   否则「involved 为空」与「没有欠账」逐字同形，而本函数正是靠这个 return 早退的。
  const escaped = changedInDir.filter((f) => !AUDIT_ARTIFACT_RE.test(f) && isReviewRecord(repo, f))
  if (escaped.length > 0) {
    reasons.push(
      `扫描域形态不认识 ${escaped.length} 条 —— 这些文件在 .ccg/reviews/ 下、内容带 mode/deepReview/decidedBy`
      + `（确实是评审记录），但文件名不匹配 AUDIT_ARTIFACT_RE 的已知形态，故未参与欠账判定：\n`
      + escaped.slice(0, 8).map((p) => `    - ${p}`).join('\n')
      + '\n    正解：把新形态登记进 AUDIT_ARTIFACT_RE 并补一条该形态的用例；'
      + '     不得反过来改判据去忽略它 —— 那等于给下一批产物集体装上隐形。'
    )
  }


  // ★ 删除方向不得逃逸（对齐本文件头部不变量 2「必须区分 A/M/D」——那条要求早就写在注释里，
  //   但欠账扫描只筛 A/M，等于自己违反自己的不变量）：D 掉的若是一条未闭环的 dual 产物，
  //   欠账就连同记录一起消失且不报错。现场不是假想：#3776 的处境正是「中途提交被判 dual+pending
  //   挡住 PR」，门禁给的合规出口是「写明原因并把 status 置为闭环值」，而删除是同一条出口的
  //   **免审计版本**。内容只能从 base 的 blob 读，工作树里已经没有这个文件了。
  const removedUnclosed = []
  const unreadable = []
  const unparsed = []
  for (const e of statuses) {
    if (e.status !== 'D' || !REVIEWS_DIR_RE.test(e.file)) continue
    const rel = e.file
    let txt = null
    try {
      txt = typeof readAtBase === 'function' ? readAtBase(rel) : null
    } catch { txt = null }
    if (txt === null || txt === undefined) { unreadable.push(rel); continue } // 未证实 ≠ 已通过
    let rec = null
    try { rec = JSON.parse(txt) } catch { unreadable.push(rel + '（base 内容解析不动）'); continue }
    if (!rec || typeof rec !== 'object') continue
    if (rec.mode === undefined && rec.deepReview === undefined && rec.decidedBy === undefined) continue
    if (rec.mode !== 'dual') continue // single 不在本判据范围（缺陷G 口径，不得改成噪音）
    const st = rec.deepReview && typeof rec.deepReview.status === 'string' ? rec.deepReview.status : '(缺失)'
    if (!CLOSED_DEEP_REVIEW_STATUSES.has(st)) removedUnclosed.push(`${rel}（mode=dual，status=${st}，decidedAt=${rec.decidedAt || '?'}）`)
  }
  if (removedUnclosed.length > 0) {
    reasons.push(
      `CCG 深度审查欠账：本次变更集删除了 ${removedUnclosed.length} 条未闭环的 dual 判定记录 —— `
      + `删除产物不等于完成评审。若判定确属假阳性，走门禁的合规出口（在记录里写明原因并把 status 置为闭环值），`
      + `而不是删文件：\n`
      + removedUnclosed.slice(0, 8).map((p) => `    - ${p}`).join('\n')
      + '\n    补跑：sh scripts/deep-review.sh'
    )
  }
  if (unreadable.length > 0) {
    reasons.push(
      `扫描域无法取证 ${unreadable.length} 条：这些 .ccg/reviews 记录在本次变更集里被删除，而 base 版本读不到或读不动，`
      + `因此无法判定删除前是否已闭环 —— 「读不到」不得读成「没欠账」：\n`
      + unreadable.slice(0, 8).map((p) => `    - ${p}`).join('\n')
      + '\n    常见成因：浅克隆解不出 merge-base、调用方未注入 readAtBase、base ref 已被回收。'
    )
  }

  if (involved.length === 0) return { reasons, checked: 0 }

  const unresolved = []
  const backendMismatch = []
  // ⚠ 刻意**不**要求「本次新增的 dual 产物必须带 reviewBackends」（QM-6 评审 i4 提的那条更严的口径）。
  //   试做并实测过：它会把所有**在本刀之前**生成的在飞 PR 产物判红（他们的记录里没有这个字段，
  //   而他们没做错任何事）——一条 required check 因别人的落地而红，正是本仓反复记过的爆炸半径。
  //   于是 i4 按 dismissed 处置，代价如实登记在下面那条「遗留」里：
  //   绕过通道是「生成后手动删掉 reviewBackends」，那需要改动一个已入库的 JSON，
  //   而现存的锁（判定器必写该字段 + 请求值 × performedBy 对账）把它限制在"刻意伪造"范围内。
  for (const rel of involved) {
    let rec = null
    try {
      rec = JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'))
    } catch { unparsed.push(rel); continue } // 实测没有任何门禁在校验它可解析（ccg-gate.js 同目录也是跳过）⇒ 只能在这里出声
    if (!rec || !rec.deepReview || rec.deepReview.required !== true) continue
    // ★ 2026-10-15 实测补正（缺陷 G）：只看 mode === 'dual'。
    //   引擎对 mode !== 'skip' 一律置 required=true —— 那是「是否需要评审」，
    //   不是「是否需要**双模型深度**评审」。判定器自己的输出分得很清楚：
    //     dual   → 「要求 双模型(<critic> + <proposer>) 深度审查」（后端对由
    //               scripts/ccg-review-backends.list 派生，本文件不得再抄具体名字）
    //     single → 「常规专家分派」（§12.6）
    //   初版对 single 也要求闭环 ⇒ 每次提交都要跑 15 分钟双模型审查，
    //   而写完审查结果再提交时又生成新的 single 记录 ⇒ **无法闭合的循环**。
    //   本 PR 实测撞上过。收窄到 dual：既保住原始诉求（被判要双模型审查却从未执行），
    //   又不把「单人专家分派」这种机器无法核验的路径假扮成可判据。
    if (rec.mode !== 'dual') continue
    const st = typeof rec.deepReview.status === 'string' ? rec.deepReview.status : '(缺失)'
    if (!CLOSED_DEEP_REVIEW_STATUSES.has(st)) {
      unresolved.push(`${rel}（mode=${rec.mode || '?'}，status=${st}，decidedAt=${rec.decidedAt || '?'}）`)
    }
    // 闭环了，但**执行者不是被请求的那个后端** ⇒ 仍然不闭合。
    // 这一格是本刀的全部理由：status 是"有人写了个词"，performedBy 才是"谁真的跑了"。
    const mismatch = judgeBackendMismatch(rec)
    if (mismatch) backendMismatch.push(`${rel}（请求 ${mismatch}）`)
  }
  if (unresolved.length > 0) {
    reasons.push(
      `CCG 深度审查欠账 ${unresolved.length} 条 —— 这些改动被判需要深度审查（deepReview.required=true）`
      + `但状态不在闭环白名单 {${[...CLOSED_DEEP_REVIEW_STATUSES].join(', ')}} 内：\n`
      + unresolved.slice(0, 8).map((p) => `    - ${p}`).join('\n')
      + `\n    补跑：sh scripts/deep-review.sh（或确认该判定是假阳性后，在记录里写明原因并把 status 置为闭环值）`
    )
  }
  if (backendMismatch.length > 0) {
    reasons.push(
      `CCG 深度审查欠账（后端不符）${backendMismatch.length} 条 —— 记录已闭环，但 deepReview.performedBy `
      + `与本次判定**请求**的评审后端对不上。「设了后端却没生效」不是"换个名字照样过"，而是这次评审`
      + `根本不是你要的那一路（跨家族对照缺席 / 模型能力假设不成立）：\n`
      + backendMismatch.slice(0, 8).map((p) => `    - ${p}`).join('\n')
      + '\n    正解：按记录里的请求值重跑一次（sh scripts/deep-review.sh --critic <名>）；'
      + '\n    若确实要让驱动接受覆盖，见 openspec change qm6-review-backend-config 的两条出口'
      + '（修上游驱动的验证层分支 / 把驱动 vendor 进本仓 scripts/）。'
      + '\n    不得反向处置：把 reviewBackends 字段删掉会让本判据整体失效（历史产物按"不适用"跳过），'
      + '那是拆锁不是还账。'
    )
  }


  if (unparsed.length > 0) {
    reasons.push(
      `变更集里有 ${unparsed.length} 条 .ccg/reviews 产物解析不动 —— 它们既不参与欠账判定、也不参与覆盖率统计，`
      + `而「读不动」不等于「没欠账」：把 status 写坏或把文件截断，正是本判据要消灭的逃逸形态。\n`
      + unparsed.slice(0, 8).map((p) => `    - ${p}`).join('\n')
      + '\n    正解：让 pre-commit 重新生成该产物（或 sh scripts/deep-review.sh 补跑），不要手工修补 JSON。'
    )
  }
  return { reasons, checked: involved.length }
}

/**
 * 「**请求**的后端」与「**实际**执行评审的后端」对账（change: qm6-review-backend-config）。
 *
 * 为什么必须有这一条：2026-10-18 实测三种「换 critic」的旋钮全部静默失效
 * ——改 config.toml（驱动不读它）、给入口传 --critic（当时入口只转发 --sha）、
 * 直连驱动传 --critic（驱动**验证层**不应用覆盖，覆盖块只挂在决策层分支）。
 * 三种情况下评审照跑、结论照出、status 照闭环，而**没有任何东西知道评审者是谁**。
 * 「设了没生效」如果只能靠人盯终端，它就等价于没有这条判据。
 *
 * 返回 null 表示不适用（不判、不拦），四种不适用都如实写明理由，不假装已核验：
 *   ① 记录里没有 reviewBackends —— 本字段之前的历史产物一律不受影响（**不得追溯变红**）；
 *   ② `overridden !== true` —— 没人改过后端时，驱动自己的默认值就是权威，两侧本来就可能
 *      不同（上游改了默认 ≠ 本仓失守）。本判据要抓的是**「我指定了，却没人按我指定的跑」**；
 *   ③ status === self_play_resolved —— 自扮演是既有门禁显式承认的出口，不属于"换了后端"，
 *      归「高危域不得自扮演豁免」那条管（本判据不得顺手把它判红，否则等于在仓侧偷改豁免政策）；
 *   ④ performedBy 为空 —— 状态已是闭环词表内 ⇒ 判「无署名执行者的闭环不成立」（评审 i1/i4 后改）；
 * ⚠ 曾经用「performedBy 里读不出后端名」当第 ③ 档的判据，被自己的用例否证了：
 *   `self-play` 按非字母切分会得到 ['self','play'] 两个**看起来完全像后端名**的记号，
 *   于是"读不出名字"永远不成立。凡是靠"这个名字长得像不像后端"做判据的地方都会踩同一条，
 *   所以这里改成按**显式字段**判（overridden / status），不按形态猜。
 * 判据用**记号集**而不是字符串相等：performedBy 可能是 `claude+opencode` 这类复合值，
 * 拿全等比会把合规判成违规；而"再按 - . _ 拆词族判成员"会把 claude-opencode 与无关请求误合
 * （假绿）。两头都对的口径是**有界子串**：由外部模型复核后采纳，见 change 的 design.md D5′。
 */
function judgeBackendMismatch (rec) {
  if (!rec || typeof rec !== 'object') return null
  const req = rec.reviewBackends
  if (!req || typeof req !== 'object' || typeof req.critic !== 'string' || !req.critic) return null
  const dr = rec.deepReview
  if (!dr || typeof dr !== 'object') return null
  // ② 自扮演闭合走它自己的审计路径，本判据不插手（收紧它属改豁免政策，须人工过目）
  if (dr.status === 'self_play_resolved') return null
  const performed = typeof dr.performedBy === 'string' ? dr.performedBy.trim() : ''
  const closed = CLOSED_DEEP_REVIEW_STATUSES.has(dr.status)
  // 署名义务**不分是否覆盖**（QM-6 评审 i1/i4）：带着 reviewBackends 的记录是本轮之后的新产物，
  // 状态写成闭环而 performedBy 为空 = 没有署名执行者的闭环，默认路径也拦。
  if (!performed) {
    return closed
      ? `闭环状态 ${dr.status} 却无 deepReview.performedBy —— 没有署名执行者的闭环不成立`
      : null
  }
  // ③ 等值比对只在显式覆盖过时判：没人指定后端时，驱动自己的默认值就是权威
  if (req.overridden !== true) return null
  // 记号化：按非 [A-Za-z0-9._-] 切（`+` / 空格 / 逗号都是分隔），但**不**拆 - . _
  const tokens = performed.split(/[^A-Za-z0-9._-]+/).filter(Boolean).map((t) => t.toLowerCase())
  if (tokens.length === 0) return null
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 有界子串（评审 i5，经外部模型复核后采纳其第三种口径）：请求名两侧必须是边界。
  // claude-agent 认得 claude（修假红）；claude 认不出 claude-agent（不引入假绿）；
  // 也不会让 clau 这类碎片把 claude 误配。
  const contains = (t, w) =>
    t === w || new RegExp('(?:^|[^A-Za-z0-9])' + esc(w) + '(?:$|[^A-Za-z0-9])').test(t)
  const wanted = [req.critic, req.proposer].filter((x) => typeof x === 'string' && x).map((x) => x.toLowerCase())
  if (tokens.some((t) => wanted.some((w) => contains(t, w)))) return null
  return `${req.critic}${req.proposer && req.proposer !== req.critic ? '/' + req.proposer : ''} ≠ ${performed}`
}

function report(r, mode) {
  const lines = [r.summary()]
  for (const x of r.reasons) lines.push(`- ${x}`)
  if (r.ok) lines.push('OK: 本 PR 携带执行记录或带原因的豁免')
  else lines.push(`不通过：${r.reasons.length} 条理由`)
  if (mode === 'advisory') {
    lines.push('MODE=advisory（尚未接进判定；转阻断 = 删掉 CI 里的 --mode=advisory，'
      + '该标记行由 check-pr-exec-record.test.js 钉住，不会悄悄停在观察态）')
    process.stdout.write(lines.join('\n') + '\n')
    process.exit(0)
  }
  process.stdout.write(lines.join('\n') + '\n')
  process.exit(r.ok ? 0 : 1)
}

// ── 派生说明的公开接口（2026-10-17，ccg-record-width-message） ──────────────────
// 这组导出的用途**只有一个**：让测试能核验「提示文案 == 由判据生成的结果」，
// 从而不必在测试或文案里再抄一遍位宽（抄一遍就是第三处漂移源）。
//   AUDIT_ARTIFACT_RE    判据本体（测试直接用它做行为断言，不从源码重建，避免丢 flags）
//   auditAcceptedWidths  判据**实际接受**的位宽集合（行为探测 + 模块级缓存/冻结）
//   auditAcceptedAltForm 判据**实际接受**的 alt 形态（sha 宽度 + ISO 段，行为探测）
//   describeAuditWidths  由 auditAcceptedWidths 拼出的 `<N 或 M 位小写十六进制>`
//   stripCommentsForScan 把源码削成「只含代码行」的视图（引号感知剥注释 + 规范化 CRLF）
// 生产路径只用 describeAuditWidths / auditAcceptedAltForm().description；
// 其余导出不改变判据行为，仅为可测性存在。
module.exports = { isResolvableEvidence, classifyEvidenceTier, summarizeTierCoverage, evaluate, resolveHeadBranch, readExemptsOnDisk, remoteBranchSet, isPureBackfillChangeSet, evaluateDeepReviewDebt, judgeBackendMismatch, CLOSED_DEEP_REVIEW_STATUSES, RECORDS_RE, EXEMPT_RE, CARRIER_RE, DEFAULT_THRESHOLD, AUDIT_ARTIFACT_RE, auditAcceptedWidths, auditAcceptedAltForm, describeAuditWidths, stripCommentsForScan, AUDIT_NAME_WIDTH_MIN, AUDIT_NAME_WIDTH_MAX }

if (require.main === module) main(process.argv.slice(2))
