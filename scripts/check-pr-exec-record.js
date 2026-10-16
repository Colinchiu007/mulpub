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
const AUDIT_ARTIFACT_RE = /^\.ccg\/reviews\/(?:[0-9a-f]{40}|[0-9a-f]{64})(?:-again-[0-9a-f]{40}-\d{8}T\d{6}(?:\.\d{1,3})?Z)?\.json$/
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
  // 信任边界（QM-6 后端 I4-info，文档化不改码）：出路④只校验文件/状态形态，不校验 M 内容
  // 是否真是回填凭据 —— PENDING→PASS 的真实性依赖人工 review 与 check-gate-record-debt.js
  // 的结构检查，这是文档门禁的固有信任边界。
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
      + '尚无法收口时在该文件 frontmatter 里写 sync_reason 与 sync_backfill_owner）；'
      + '②修订本分支自己那篇 openspec/records/<分支名>.md（回填证据走这条）；'
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
      const fm = parseFrontmatterFields(text)
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
  const applyDeepDebt = (target) => {
    // head 必须是 sha：判据要能核对「锚签在这一笔」，而调用方给的可能是 HEAD/分支名。
    // 解析失败不静默 —— 交空串进去，由台账那一支按「无法核对」处理。
    let headSha =
      typeof head === 'string' && /^[0-9a-f]{40}$/.test(head) ? head : ''
    if (!headSha) { try { headSha = require('./lib/ccg-evidence-hash.js').resolveCommitSha({ repo, ref: head || 'HEAD' }) } catch { headSha = '' } }
    const deepDebt = evaluateDeepReviewDebt(statuses, repo, { headBranch, headSha, payloadSha: makePayloadSha({ repo, head }) })
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

/** 解析 md 顶部 frontmatter 的 `key: value` 顶层行（跳过注释；遇第二个 --- 停）。
 *  本文件内只此一份解析实现：readExemptsOnDisk 与新台账读取都走它（两份必然口径分裂）。 */
function parseFrontmatterFields (text) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n')
  const out = {}
  if ((lines[0] || '').trim() !== '---') return out
  for (let i = 1; i < lines.length; i++) {
    const raw2 = lines[i]
    if (raw2.trim() === '---') break
    if (/^\s*#/.test(raw2)) continue
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw2)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

// 台账字段：由 deep-review 收口时写，不是人填的。缺一个都不算闭环（fail closed）。
// ★ 台账键清单由 lib 派生，不在这里手抄第二份。
// 手抄的那份原先少一个键（ccg_written_by），而且从名单里删掉任意键都不会红 ——
// 这份名单是「台账到底算不算存在」的开关本身，漏一个键就等于对该键失去检测。
const CCG_LEDGER_KEYS = require('./lib/ccg-evidence-hash.js').LEDGER_FIELDS
// 证据锚必须是 GitHub PR 面（PR 评论或 review 评论锚点）：本地文件里自填一个 URL 字符串不构成外部留痕，
// 但它至少把「伪造」从「改一行仓内文本」抬到「必须往公开 PR 写一条内容自洽的假评审」。
const { EVIDENCE_URL_RE: GITHUB_EVIDENCE_RE, HEX40_RE, HEX64_RE } = require('./lib/ccg-evidence-hash.js')
// ★ 形状判据不得在本文件再写一份字面量：写入侧（ccg-record-ledger）拿同一个常量自检它从 gh 读回的 URL，
//   两份一旦漂移，表现是「引擎自认合格、判据判它不合格」的死红。要求带 comment 片段是**收紧**：
//   裸 PR URL 等于「我在这个 PR 里说过话」，任何人都能填；只有指向一条具体评论才构成外部证据。

/** 在变更集里找本 PR 的台账记录文件：分支名精确优先，其次任何带 ccg_* 字段的记录文件。 */
function findCcgLedger ({ statuses, repo, headBranch, readFile }) {
  if (!headBranch) return null
  const rel = 'openspec/records/' + headBranch + '.md'
  const e = (statuses || []).find((x) => (x.status === 'A' || x.status === 'M') && x.file === rel)
  if (!e) return null
  let fields
  try { fields = parseFrontmatterFields(readFile(path.join(repo, rel))) } catch { return null }
  if (!CCG_LEDGER_KEYS.some((k) => Object.prototype.hasOwnProperty.call(fields, k))) return null
  // frontmatter 的 record: 与文件名必须同键（复制模板最容易留下「文件叫 A、内容写 B」）
  const declared = typeof fields.record === 'string' ? fields.record.trim() : ''
  if (declared && declared !== headBranch) return null
  return { file: rel, fields }
}

// ⛔ 曾经这里有一条兜底：变更集里「任何带 ccg_* 的记录文件」都拿来当取值源。
// 后果（内部评审 I3 实测）：回填型 PR 按 SOP 只会 M 到**别的分支**那篇记录，
// 于是它借用别人的台账 ⇒ 要么由绿转红、要么把别人的闭环当自己的。兜底已删。

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
/**
 * dual 记录的闭环判定源（2026-10-16 刀1，change: ccg-reviews-governance）：
 *
 * - **新源优先**：本 PR 的 `openspec/records/<分支>.md` 带任一 ccg_* 字段 ⇒ 一切以它为准。
 *   此时 json 侧即使写着 cleared 也不能放行 —— 否则「换一份已闭环的 json 进来」就是绕过。
 * - **双读一周期的原因（不是懒惰）**：实测 15 个在飞 open PR 里 13 个的变更集（2026-10-16 读数，会自增）带 .ccg/reviews 文件，
 *   它们不可能有尚不存在的字段；硬切等于**静默撤掉这 5 个 PR 的 dual 守卫**。
 *   无台账字段时沿用旧源，语义与换源前逐字一致。
 * - 新源闭环需同时满足四件事：状态在闭环词表 + ccg_mode 与判定模式一致 + 证据锚是 GitHub PR 面 +
 *   载荷哈希能重算且相等（哈希定义见 scripts/lib/ccg-evidence-hash.js，两侧共用一份）。
 */
function evaluateDeepReviewDebt (statuses, repo, opts) {
  const o = opts || {}
  const readFile = o.readFile || ((p) => fs.readFileSync(p, 'utf8'))
  const reasons = []
  const involved = (statuses || [])
    .filter((e) => (e.status === 'A' || e.status === 'M') && AUDIT_ARTIFACT_RE.test(e.file))
    .map((e) => e.file)
  if (involved.length === 0) return { reasons, checked: 0, source: 'none', ledgerFile: null }

  const ledger = findCcgLedger({ statuses, repo, headBranch: o.headBranch || '', readFile })
  let source = ledger ? 'ledger' : 'json'
  // 载荷哈希只取一次：多条记录共用同一份 diff，重复计算会把「一次取证」变成 N 次（也有时序不一致风险）
  let memoSha, memoBase
  const actualSha = (b) => { if (memoSha === undefined || memoBase !== b) { memoBase = b; memoSha = o.payloadSha(b) } return memoSha }

  const unresolved = []
  for (const rel of involved) {
    let rec = null
    try {
      rec = JSON.parse(readFile(path.join(repo, rel)))
    } catch { continue } // 损坏记录由别的门禁负责，这里不重复报
    if (!rec || !rec.deepReview || rec.deepReview.required !== true) continue
    // ★ 只看 mode === 'dual'（缺陷 G 的收窄，理由见文件内原文）
    if (rec.mode !== 'dual') continue
    const oldStatus = typeof rec.deepReview.status === 'string' ? rec.deepReview.status : '(缺失)'
    if (!ledger) {
      if (!CLOSED_DEEP_REVIEW_STATUSES.has(oldStatus)) {
        unresolved.push(rel + '（mode=' + rec.mode + '，status=' + oldStatus + '，decidedAt=' + (rec.decidedAt || '?') + '）')
      }
      continue
    }
    const f = ledger.fields
    const bad = []
    const st = typeof f.ccg_status === 'string' ? f.ccg_status.trim() : ''
    if (!st) bad.push('ccg_status 缺失')
    else if (!CLOSED_DEEP_REVIEW_STATUSES.has(st)) bad.push('ccg_status=' + st)
    const mode = typeof f.ccg_mode === 'string' ? f.ccg_mode.trim() : ''
    if (!mode) bad.push('ccg_mode 缺失')
    else if (mode !== rec.mode) bad.push('ccg_mode=' + mode + ' 与判定 mode=' + rec.mode + ' 不一致')
    const ev = typeof f.ccg_evidence === 'string' ? f.ccg_evidence.trim() : ''
    // F6 provenance：ccg_written_by 此前只被写出、无人读 ⇒ 装饰字段。现在参与否决。
    const by = typeof f.ccg_written_by === 'string' ? f.ccg_written_by.trim() : ''
    if (by !== 'deep-review') bad.push('ccg_written_by=' + (by || '(空)') + ' ≠ deep-review ⇒ 台账值是手填的，手填不构成闭环')
    // F7 锚签在哪一笔：head 侧也必须是完整 sha 且等于本次评审对象（与 base 同一条理由）
    const hdr = typeof f.ccg_payload_head === 'string' ? f.ccg_payload_head.trim() : ''
    if (!HEX40_RE.test(hdr)) bad.push('ccg_payload_head 缺失或非 40hex（不得写 ref 名）：' + (hdr || '(空)'))
    else if (typeof o.headSha === 'string' && HEX40_RE.test(o.headSha) && hdr !== o.headSha) {
      bad.push('锚签在别的提交上：声明 head ' + hdr.slice(0, 12) + '… 本次 head ' + o.headSha.slice(0, 12) + '…')
    }
    if (!GITHUB_EVIDENCE_RE.test(ev)) bad.push('ccg_evidence 证据锚缺失或非 GitHub PR 面（' + (ev || '(空)') + '）')
    const rb = typeof f.ccg_payload_base === 'string' ? f.ccg_payload_base.trim() : ''
    if (!HEX40_RE.test(rb)) bad.push('ccg_payload_base 缺失或非 40hex（必须写评审当时解析出的 merge-base sha；ref 名会随并发合并移动，写 ref 名的锚无法复核）：' + (rb || '(空)'))
    const declared = typeof f.ccg_payload_sha256 === 'string' ? f.ccg_payload_sha256.trim() : ''
    if (!HEX64_RE.test(declared) || declared === require('./lib/ccg-evidence-hash.js').EMPTY_DIFF_SHA256) bad.push('ccg_payload_sha256 缺失/非 64hex/等于空 diff 常量（那等于没描述任何代码）')
    else if (typeof o.payloadSha !== 'function') bad.push('无法重算载荷哈希（调用方未注入取证入口，取证失败不得算闭环）')
    else if (!HEX40_RE.test(rb)) { /* base 不合格已单独报，不重复报取证失败 */ }
    else {
      let actual = null
      try { actual = actualSha(rb) } catch (e) { bad.push('载荷哈希取证失败：' + (e && e.message ? String(e.message).split('\n')[0] : e)) }
      if (actual !== null && actual !== declared) {
        bad.push('载荷不符：声明 ' + declared.slice(0, 12) + '… 实算 ' + String(actual).slice(0, 12) + '… ⇒ 该裁决描述的不是这份代码')
      }
    }
    // F4 两源一致 —— 这是本次内部评审的主结论（C1）：台账里四个被判值全部可离线导出，
    // 单靠仓内文本就能凑出一条「看起来完全合法」的闭环。修法不是把 URL 变强（判据不能联网），
    // 而是让**引擎自己那份判定记录**成为必要条件：台账说闭环而 json 说没闭环时，两者必有一假，
    // 判据不去猜谁假，一律计欠账并点名两源读数。真实流程不误伤：写入侧本就要求 json 已闭环才落台账。
    if (bad.length === 0 && !CLOSED_DEEP_REVIEW_STATUSES.has(oldStatus)) {
      bad.push('两源不一致：台账 ccg_status=' + st + ' 已闭环，但引擎判定记录 status=' + oldStatus + ' ⇒ 台账来路不明')
    }
    if (bad.length) unresolved.push(rel + '（新源 ' + ledger.file + '：' + bad.join('；') + '；旧源 status=' + oldStatus + '）')
  }
  if (unresolved.length > 0) {
    reasons.push(
      'CCG 深度审查欠账 ' + unresolved.length + ' 条 —— 这些改动被判需要深度审查（deepReview.required=true）'
      + '但状态不在闭环白名单 {' + [...CLOSED_DEEP_REVIEW_STATUSES].join(', ') + '} 内'
      + '（本次取值源=' + source + (ledger ? '：' + ledger.file : '：台账无 ccg_* 字段，按旧 .ccg/reviews json 判') + '）：\n'
      + unresolved.slice(0, 8).map((p) => '    - ' + p).join('\n')
      + '\n    补跑：sh scripts/deep-review.sh（它会算载荷哈希、贴 PR 证据评论并回写台账字段；'
      + '确认该判定是假阳性时，在台账里写明原因并由判据复核，不接受手填闭环值）'
    )
  }
  return { reasons, checked: involved.length, source, ledgerFile: ledger ? ledger.file : null }
}


/** 载荷哈希的懒取实现：没 base（push 事件 / --statuses 夹具）时返回 undefined，由判据按「取证失败」处理。 */
function makePayloadSha ({ repo, head }) {
  // base 不再由调用方给定：重算一律用**锚里记录的 base sha**（理由见 lib 的 LEDGER_FIELDS 注释）。
  // 本文件只交出「怎么算」；算不出（base 非法 / diff 取不到）由 lib 抛错，判据按取证失败处理。
  const { computeReviewPayloadSha } = require('./lib/ccg-evidence-hash.js')
  return (base) => computeReviewPayloadSha({ repo, base, head })
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
//
// 本行同时是两份清单的**并集**（另一组来自 ccg-reviews-governance：parseFrontmatterFields /
// findCcgLedger / GITHUB_EVIDENCE_RE / makePayloadSha，由 scripts/ccg-record-ledger.js 直接消费）。
// 并集只准加不准减：删掉任一组的名字，会让那一组的消费者 require 到 undefined。
module.exports = { evaluate, resolveHeadBranch, readExemptsOnDisk, remoteBranchSet, isPureBackfillChangeSet, evaluateDeepReviewDebt, CLOSED_DEEP_REVIEW_STATUSES, parseFrontmatterFields, findCcgLedger, GITHUB_EVIDENCE_RE, makePayloadSha, RECORDS_RE, EXEMPT_RE, CARRIER_RE, DEFAULT_THRESHOLD, AUDIT_ARTIFACT_RE, auditAcceptedWidths, auditAcceptedAltForm, describeAuditWidths, stripCommentsForScan, AUDIT_NAME_WIDTH_MIN, AUDIT_NAME_WIDTH_MAX }

if (require.main === module) main(process.argv.slice(2))
