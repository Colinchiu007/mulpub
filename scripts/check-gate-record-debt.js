#!/usr/bin/env node
// 门禁执行记录「远程同步」欠账棘轮。
//
// 为什么需要它（2026-09-28 在 origin/main 上实测）：`.quality-gates.md` 里有 127 条
// `| 远程同步 |` 行，其中 95 条已按既有口径回填成「PR #NNNN 于 … squash 合并，merge SHA …，
// origin/main 已核验，远端分支已删除」，但仍有 32 条停在 PENDING / OPEN / 待 PR 合并后核验 …
// —— 而**没有任何东西检测这笔欠账**。已合并的记录顶着"未收口"字样，会被下一个会话读成
// "这活儿还没干完"，于是重复开工。本门禁把那批残留变成显式、只能缩小的清单。
//
// 三条被实测钉住的设计前提（不是想当然）：
//   1) 状态列是自由文本（实测 22 种写法）⇒ 判定用闭合词表，未知写法一律算未收口（fail closed）；
//      否则"换个新词写 PENDING"就能绕过。
//   2) 记录标题是唯一可用的键：从 `（…，slug，date）` 抽 slug 只覆盖 319 条里的 160 条且撞 4 次，
//      不能用；标题全文在 319 条里只有 1 组重复。
//   3) 该文件 blob 是 LF、工作区是 CRLF（`i/lf w/crlf attr/text=auto`）⇒ 键必须先去尾部 CR，
//      否则同一内容在两种检出下判成两回事。
//
// 用法：node scripts/check-gate-record-debt.js [--json]
// 回归：node --test scripts/check-gate-record-debt.test.js

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const GATE_FILE = '.quality-gates.md'
const ROW_RE = /^\|\s*远程同步\s*\|/
const HEADING_RE = /^## /

// 第二源（change enforce-gate-record-presence D5）：每 PR 一篇记录文件，欠账登记写在文件自身的
// frontmatter 里。下划线开头的文件（_TEMPLATE.md 等）与 _exempt/ 子目录不参与记录计数——
// 模板自己就带一行 `| 远程同步 | PENDING |`，把它当记录扫就是一条永远的红。
const RECORDS_REL = path.join('openspec', 'records')
const RECORD_FIELD_REASON = 'sync_reason'
const RECORD_FIELD_OWNER = 'sync_backfill_owner'
// 第三个登记字段。AGENTS.md 要求回填时删「sync_* 三字段」，但门禁此前只看两个，
// 于是 11 篇把 `sync_status: PASS` 留在原地还能打印「登记字段无残留」——自述比判据宽。
const RECORD_FIELD_STATUS = 'sync_status'

// 已收口的写法。只允许这一侧扩张，新增未收口写法必须走 gate-record-debt-ledger.json。
const CLOSED_RE = /^(PASS|N\/A|✅|已)/

// ── 旧载体冻结锁（change: freeze-legacy-gate-carrier）────────────────────────────
// 为什么：每个 PR 都要往 `.quality-gates.md` 顶部插一块、并往 ledger 加一个键，而**所有会话共用同一份
// 工作树 / index / HEAD**。机器判定其实不需要这两处——记录文件源（`source:'records'`）读的是文件自身的
// frontmatter，全程不碰 ledger；ledger 只服务于旧载体的历史行（`source:'legacy'`）。于是"挤公共大文件"
// 这件事对判定是纯冗余，对并发却是真实的丢工风险（实测：同一条回填 #3602/#3606 相隔 20 分钟落两遍）。
// 判据：旧载体的**记录块集合**必须等于冻结基线——不许加块、不许删块；只允许就地改写已有块里的状态行
// （关闭一笔 8 月的旧账仍然可做）。比较用「排序后标题的 sha256 + 条数」，两条都不等即红。
// 为什么不用 `git show <冻结commit>:` 现算基线：CI 默认浅检出取不到该 commit，届时基线读不到 ⇒
//   要么静默跳过（空集恒真，本仓反复复发的形状），要么每跑必红。故基线入库成一个小 JSON。
const CARRIER_FREEZE_FILE = path.join(__dirname, 'gate-carrier-freeze.json')

function carrierSignature(headingTexts) {
  const sorted = headingTexts.slice().sort()
  return {
    count: sorted.length,
    sha256: crypto.createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex'),
    titles: sorted,
  }
}

function loadCarrierFreeze(file = CARRIER_FREEZE_FILE) {
  if (!fs.existsSync(file)) {
    throw new Error(`旧载体冻结基线缺失：${file} —— 冻结判据不得静默跳过（读不到基线 ≠ 没有漂移）`)
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!raw || typeof raw.headingSha256 !== 'string' || !Number.isInteger(raw.headingCount) || raw.headingCount <= 0) {
    throw new Error(`旧载体冻结基线不合法（缺 headingSha256 / headingCount）：${file}`)
  }
  return raw
}

// 同一篇执行记录把「远程同步」状态写在两个位置：表格行（权威，回填时改它）与 docs-only 模板的
// 声明式 bullet（`- 保留门禁：… | 远程同步 PENDING`）。既有判据只读前者，于是后者可以永久停在
// PENDING 而 rc=0（实测 origin/main 8 篇）。锚点必须是「行已闭合 + bullet 以状态词收尾」这个形状
// 组合，不能用宽式：宽式（含词即判）27 命中里 25 是散文误报，还含一处自指误报——有记录在行内代码
// 里引用 `| 远程同步 | PENDING |` 来描述这个盲区本身。token 字符类排除 `|` 与括号，散文不以状态词
// 收尾，因此不会命中。
// 未收口词表与行侧的 fail-closed 词表同源可查证，但 bullet 侧只认这张表：见上条实测教训。
const UNCLOSED_WORDS = 'PENDING|OPEN|待\\s*PR\\s*合并后核验|待\\s*合并|待\\s*回填|待\\s*后续|待补|进行中|未收口|未回填|（待填）'
const CLOSED_WORDS = 'PASS|N\\/A|✅|已\\S*'
const TAIL = '(?:[^\\S\\r\\n]*[（(][^）)]*[）)])?[^\\S\\r\\n]*$'
const HEAD = '远程同步[^\\S\\r\\n]*(?:[：:][^\\S\\r\\n]*)?'
const UNCLOSED_DECL_RE = new RegExp(HEAD + '(' + UNCLOSED_WORDS + ')' + TAIL)
const CLOSED_DECL_RE = new RegExp(HEAD + '(' + CLOSED_WORDS + ')' + TAIL)

function statusDeclarations(text) {
  const out = []
  text.split('\n').forEach((raw, i) => {
    if (ROW_RE.test(raw)) return
    const line = raw.replace(/\r$/, '')
    const open = line.match(UNCLOSED_DECL_RE)
    if (open) { out.push({ line: i + 1, status: normalize(open[1]), closed: false, text: line.slice(0, 120) }); return }
    const done = line.match(CLOSED_DECL_RE)
    if (done) { out.push({ line: i + 1, status: normalize(done[1]), closed: true, text: line.slice(0, 120) }) }
  })
  return out
}

// 重复的同一条 ## 记录标题。置顶型文档最典型的自我损坏就是把同一条记录写两遍
// （实测踩过：一次补丁把 1MB 的 .quality-gates.md 写成内容翻倍，标题计数 1→2）。
// 判据本身是单向包含（"每行都还在"）抓不到重复，所以这里显式统计标题出现次数。
// 本清单只能缩小：清理掉历史那份重复时顺手删除对应条目；新增重复一律判红。
const DUPLICATE_HEADINGS_ALLOWED = new Set([
  '本次执行记录：Story2Video 历史失败提示脱敏与模型账号细化（error-message-fix，2026-08-19）',
])

// 登记清单落在 JSON 里（与 scripts/debt-baseline.json 同形，便于逐条带原因）。
// heading -> { reason }：为什么本 PR 不回填它。只能缩小——回填一条记录时必须顺手删掉它的条目，
// 否则 stale 判红；这条耦合保证清单单调收敛。
// ── 跨源一致性（2026-10-14 加）：同一条变更的旧载体块与新记录文件必须同向收口。
//    动因：实测两次的「并发整取把已收口的回填倒退回 PENDING」，而既有判据只管**单源自洽**，
//    对「记录 PASS / 载体 PENDING」这种跨源矛盾恒 RC=0（#3495 那次就是这么漏过去的）。
//    身份键必须用括号定界的「（slug，」：实测「标题包含 slug」这种宽判据会把回填块
//    「回填 …（ops-ingress-only，…）」与它回填的那篇混算成同一条（那次 2/2 全是假阳）。
const CROSS_SLUG_RE = /（([a-z0-9][a-z0-9-]*)，/
// 回填型块的未收口行说的是**它自己那笔回填 PR**，不是它收口的那条变更 ⇒ 不参与跨源比对，
// 但必须打印出来（不拦截又不出声，等于把放过做成静默的）。正例是另起 slug：…-backfill。
const CROSS_BACKFILL_RE = /^本次执行记录：(?:\d+ 笔)?回填|远程同步回填|并销账/
// 上线时既有的真矛盾，逐条给理由；其作者回填后必须删掉本项（陈旧承认即红，清单只能缩小）。
const CROSS_SRC_ALLOWED = new Set(['ops-ingress-only']) // 他人会话的运行时代码记录块，本仓纪律是不代改

const LEDGER_FILE = path.join(__dirname, 'gate-record-debt-ledger.json')

function normalize(s) {
  return s.replace(/\r$/, '').trim()
}

function loadLedger(root) {
  // 必须认参数：测试一直按 `loadLedger(root)` 调用，而无参实现会永远读真实清单，
  // 于是"给了夹具目录却拿到生产 ledger"—— 静默读生产，属假绿通道。
  const file = root
    ? path.join(root, 'scripts', path.basename(LEDGER_FILE))
    : LEDGER_FILE
  if (!fs.existsSync(file)) return {}
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const out = {}
  for (const [heading, entry] of Object.entries(raw)) {
    const reason = typeof entry === 'string' ? entry : entry && entry.reason
    if (!reason || !String(reason).trim()) {
      throw new Error(`登记项缺少原因（每个欠账必须写明为什么没回填）：${heading}`)
    }
    out[heading] = String(reason).trim()
  }
  return out
}

// ── 第二源：openspec/records/*.md ────────────────────────────────────────────
// 缺席与读不动都必须抛错：一个不完整的遍历判出来是"零条违规"，那是假绿（与 worktree
// 链接扫描 R3 同形）。允许"目录存在但没有记录文件"——那是载体迁移的起点状态，不是扫描失败。
function listRecordFiles(recordsRoot) {
  if (!fs.existsSync(recordsRoot)) {
    throw new Error(`记录目录不存在：${recordsRoot}（openspec/records/ 缺失即 enforce-gate-record-presence tasks 1.1 未落地，不得当成"零条记录"通过）`)
  }
  let dirents
  try {
    dirents = fs.readdirSync(recordsRoot, { withFileTypes: true })
  } catch (e) {
    throw new Error(`无法枚举记录目录 ${recordsRoot}：${e.message}`)
  }
  return dirents
    .filter(d => d.isFile() && d.name.endsWith('.md') && !d.name.startsWith('_'))
    .map(d => d.name)
    .sort()
}

// frontmatter 只取 `---` 与 `---` 之间的 `key: value`；`#` 开头的注释行忽略（模板里要写说明）。
function readFrontmatter(text) {
  const out = {}
  const lines = text.split('\n')
  if ((lines[0] || '').replace(/\r$/, '') !== '---') return { fm: out, hasFm: false }
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    if (raw === '---') break
    if (/^\s*#/.test(raw) || !raw.trim()) continue
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw)
    if (m) out[m[1]] = m[2].trim()
  }
  return { fm: out, hasFm: true }
}

function readRecord(recordsRoot, fileName) {
  const text = fs.readFileSync(path.join(recordsRoot, fileName), 'utf8')
  const name = fileName.replace(/\.md$/, '')
  const { fm } = readFrontmatter(text)
  const allLines = text.split('\n')
  const rowLineIdx = allLines.findIndex(l => ROW_RE.test(l))
  const rowLine = rowLineIdx >= 0 ? allLines[rowLineIdx] : undefined
  const status = rowLine ? (rowLine.split('|').map(normalize)[2] || '') : null
  const reason = fm[RECORD_FIELD_REASON]
  const owner = fm[RECORD_FIELD_OWNER]
  const declared = statusDeclarations(text)
  // 「残留」按三字段判（回填即整段删）；「未收口必须登记」仍只要求 reason+owner，
  // 把 sync_status 算进那一侧等于让「只写 sync_status」就能冒充已登记。
  const hasAnyRegistration = [RECORD_FIELD_REASON, RECORD_FIELD_OWNER, RECORD_FIELD_STATUS]
    .some((k) => Object.prototype.hasOwnProperty.call(fm, k))
  return {
    name,
    fileName,
    rowPresent: !!rowLine,
    rowLineNo: rowLineIdx + 1,
    declared,
    status,
    closed: !!rowLine && CLOSED_RE.test(status),
    hasRegistration: hasAnyRegistration,
    reasonMissing: !reason || !String(reason).trim(),
    ownerMissing: !owner || !String(owner).trim(),
  }
}

function collect({ root = process.cwd(), ledger = loadLedger(), duplicatesAllowed = DUPLICATE_HEADINGS_ALLOWED, crossSrcAllowed = CROSS_SRC_ALLOWED, recordsRoot = path.join(root, RECORDS_REL), carrierFreeze = null } = {}) {
  const file = path.join(root, GATE_FILE)
  if (!fs.existsSync(file)) throw new Error(`${GATE_FILE} 不存在：${file}`)
  const lines = fs.readFileSync(file, 'utf8').split('\n')

  const headings = []
  lines.forEach((l, i) => {
    if (HEADING_RE.test(l)) headings.push({ line: i, text: normalize(l.slice(3)) })
  })

  // 旧载体冻结漂移：基线由调用方注入（main 从冻结文件读，测试传夹具）。未注入 ⇒ 不参与判定，
  // 但**不得**由本函数默认去读生产文件，否则夹具会静量到真仓基线（同款假绿通道踩过一次）。
  let carrierDrift = null
  if (carrierFreeze) {
    const sig = carrierSignature(headings.map((h) => h.text))
    if (sig.sha256 !== carrierFreeze.headingSha256 || sig.count !== carrierFreeze.headingCount) {
      const base = new Set(carrierFreeze.headings || [])
      const now = new Set(sig.titles)
      carrierDrift = {
        countBefore: carrierFreeze.headingCount,
        countAfter: sig.count,
        shaBefore: carrierFreeze.headingSha256.slice(0, 12),
        shaAfter: sig.sha256.slice(0, 12),
        added: sig.titles.filter((t) => !base.has(t)),
        removed: (carrierFreeze.headings || []).filter((t) => !now.has(t)),
        baselineHasTitles: Array.isArray(carrierFreeze.headings),
      }
    }
  }

  const open = []
  const seen = new Set()
  let rowCount = 0
  for (let i = 0; i < lines.length; i++) {
    if (!ROW_RE.test(lines[i])) continue
    rowCount++
    const cells = lines[i].split('|').map(normalize)
    const status = cells[2] || ''
    if (CLOSED_RE.test(status)) continue
    let heading = null
    for (const h of headings) {
      if (h.line < i) heading = h.text
      else break
    }
    if (!heading) heading = '(文件首个 ## 之前，无法归属)'
    seen.add(heading)
    if (!Object.prototype.hasOwnProperty.call(ledger, heading)) {
      open.push({ line: i + 1, status, heading, evidence: cells[3] || '', source: 'legacy' })
    }
  }

  if (rowCount === 0) throw new Error(`未找到任何 远程同步 行（${file}）——空遍历不得判为"零欠账"`)

  // ── 覆盖检测：本文件原有机制只管「已存在的行是否收口」，对「整条记录根本没有这一行」
  //    完全失明。实测 origin/main 2026-09-28：316 篇形如执行记录的 `## ` 标题里有 **192 篇**
  //    没有 远程同步行，而门禁照样 RC=0 报 OK —— 缺席比说谎更糟，说谎至少下一个人看得见。
  //
  // 「执行记录」的判据（不是所有 ## 都是记录）：`^本次执行记录` 或标题含日期。
  // 实测 321 个 ## 标题里 316 个符合，剩下 5 个是结构性章节（固定强制门禁 / 提交前自检清单 /
  // 强制卡点规则 / 违规处理 / 质量节拍阶段对照），它们永远不该有这一行，必须排除。
  const blocks = headings.map((h, k) => ({
    ...h,
    end: k + 1 < headings.length ? headings[k + 1].line : lines.length,
  }))
  const isRecordHeading = (t) => /^本次执行记录/.test(t) || /20\d\d-\d\d-\d\d/.test(t)
  const records = blocks.filter(b => isRecordHeading(b.text))
  const recordsWithoutRow = records.filter(b => !lines.slice(b.line, b.end).some(l => ROW_RE.test(l)))
  // 强制项只有一条：**最顶部**那篇执行记录必须带这一行。记录按惯例插在文件顶部，所以"最新一篇"
  // 定义良好、无需基线、无需清单维护。已知漏洞如实记下：若某会话把新记录插在了非顶部位置，
  // 本条拦不住；历史 192 篇也不追溯（只做可见，不拦截），否则一上线就红成不可用。
  const topRecord = records[0] || null
  const topRecordMissingRow = !!topRecord && !lines.slice(topRecord.line, topRecord.end).some(l => ROW_RE.test(l))

  // 标题计数：同一 ## 标题出现两次即"同一条记录被写了两遍"，除明确登记的历史重复外一律判红
  const headingCounts = new Map()
  for (const h of headings) headingCounts.set(h.text, (headingCounts.get(h.text) || 0) + 1)
  const duplicates = [...headingCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([text, count]) => ({ text, count }))
    .filter(d => !duplicatesAllowed.has(d.text))

  const stale = Object.keys(ledger).filter(h => !seen.has(h))
  const registered = Object.keys(ledger).filter(h => seen.has(h))

  // ── 文件源扫描 ──
  const fileNames = listRecordFiles(recordsRoot)
  // 键形态重叠检查：文件名键与历史标题键共处一套语义会互相误伤（一把清单喂两套判据），
  // 任一文件名与历史 ledger 键全等即当场报错，不允许静默二选一。
  for (const fn of fileNames) {
    const key = fn.replace(/\.md$/, '')
    if (Object.prototype.hasOwnProperty.call(ledger, key)) {
      throw new Error(`两源键形态重叠：「${key}」既是记录文件名又是历史标题登记键，必须改名消除歧义`)
    }
  }
  const missingRecordRows = []
  const statusContradictions = []
  const statusMismatchVisible = []
  const staleRecordFields = []
  let recordsFromFiles = 0
  const closedRecordSlugs = []
  for (const fn of fileNames) {
    const rec = readRecord(recordsRoot, fn)
    recordsFromFiles++
    if (!rec.rowPresent) {
      missingRecordRows.push({ file: rec.fileName, reason: '整块缺 远程同步 行' })
      continue
    }
    if (rec.closed) {
      closedRecordSlugs.push({ slug: rec.fileName.replace(/\.md$/, ''), status: rec.status })
      // 表格行已收口，同篇的声明式 bullet 却仍写着未收口词 ⇒ 门禁只看得见前者、谎话无人检测
      for (const d of rec.declared.filter(x => !x.closed)) {
        statusContradictions.push({
          file: rec.fileName, rowLineNo: rec.rowLineNo, rowStatus: rec.status,
          bulletLine: d.line, bulletStatus: d.status, text: d.text,
        })
      }
      // 回填后必须删掉登记字段：允许两者共存就等于把"记得删登记项"这条人工耦合原样搬进新载体
      if (rec.hasRegistration) staleRecordFields.push(`${rec.fileName}（已 ${rec.status} 却仍留 ${RECORD_FIELD_REASON}/${RECORD_FIELD_OWNER}/${RECORD_FIELD_STATUS}）`)
      continue
    }
    // 反向（行未收口、bullet 宣称完成）实测 0 篇 ⇒ 只可见、不进拦截面：该方向无法区分
    // 「预写尚不存在的证据」与「措辞笔误」，而前者归取证纪律管，不该由本判据扩拦截面。
    for (const d of rec.declared.filter(x => x.closed)) {
      statusMismatchVisible.push({ file: rec.fileName, rowStatus: rec.status, bulletLine: d.line, bulletStatus: d.status })
    }
    // 未收口：登记随文件走，两个字段都必须非空，否则就是没登记
    if (rec.reasonMissing || rec.ownerMissing) {
      const why = rec.reasonMissing && rec.ownerMissing ? '缺登记字段'
        : rec.reasonMissing ? `缺非空 ${RECORD_FIELD_REASON}` : `缺非空 ${RECORD_FIELD_OWNER}`
      open.push({ line: 0, status: rec.status, heading: `${rec.fileName}（${why}）`, evidence: '', source: 'records' })
    }
  }

  // ── 跨源一致性：记录文件已 PASS，而**同 slug** 的旧载体块带着状态行却未收口 ⇒ 拦。
  // 三条口径缺一不可：① 只比「两边都有状态行」（缺行走既有可见不拦截——实测历史 213 篇缺行，
  //    并进拦截面等于把之后每个 PR 当场钉红）；② 身份括号定界；③ 回填型块排除但出声。
  const legacyBySlug = new Map()
  for (const b of blocks) {
    const m = CROSS_SLUG_RE.exec(b.text)
    if (!m) continue
    if (!legacyBySlug.has(m[1])) legacyBySlug.set(m[1], [])
    const rowLine = lines.slice(b.line, b.end).find((l) => ROW_RE.test(l))
    legacyBySlug.get(m[1]).push({
      line: b.line + 1,
      text: b.text,
      status: rowLine ? normalize((rowLine.split('|').map(normalize)[2] || '')) : null,
    })
  }
  const crossSrcViolations = []
  const crossSrcBackfillVisible = []
  let crossSrcPairs = 0
  for (const rec of closedRecordSlugs) {
    const bs = legacyBySlug.get(rec.slug) || []
    for (const b of bs) {
      if (!b.status) continue
      crossSrcPairs++
      if (CLOSED_RE.test(b.status)) continue
      if (CROSS_BACKFILL_RE.test(b.text)) {
        crossSrcBackfillVisible.push({ slug: rec.slug, line: b.line, text: b.text, status: b.status })
        continue
      }
      if (crossSrcAllowed.has(rec.slug)) continue
      crossSrcViolations.push({ slug: rec.slug, recordStatus: rec.status, line: b.line, text: b.text, status: b.status })
    }
  }
  // 承认清单不得变垃圾桶：清单里的 slug 若**本次仍读到它那条已收口记录**却不再构成矛盾 ⇒ 陈旧红。
  // 范围必须限定在本次可比记录内：实测不加这层限定，任何不含该 slug 的夹具仓库都会让
  // hasBlocking 恒真、既有 8 条测试集体红——判据越权不是夹具的错。
  const closedSlugSet = new Set(closedRecordSlugs.map((x) => x.slug))
  const crossSrcStaleAck = [...crossSrcAllowed].filter((slug) => {
    if (!closedSlugSet.has(slug)) return false
    const bs = legacyBySlug.get(slug) || []
    return !bs.some((b) => b.status && !CLOSED_RE.test(b.status) && !CROSS_BACKFILL_RE.test(b.text))
  })
  // 用不上的承认项不出声就会烂在清单里 ⇒ 列成可见项（不拦截：夹具/裁剪仓库天然命中）
  const crossSrcAcksNotApplicable = [...crossSrcAllowed].filter((slug) => !closedSlugSet.has(slug))
  // 反失明基线不在这里抛：本仓的规模下界一律写在「读真仓」的测试里（先例：podcast-error-codes
  // 的「扫描域非空」）。写进 collect() 会把「记录与载体本就不同源」的正常夹具判成失效，
  // 实测冲掉 8 条合法测试——那是判据越权。配对数仍随报告打印，测试用它做下界断言。

  // 旧载体 .quality-gates.md 的同形态矛盾：只计数打印、不拦截——逐块核对后确认那些块属其他会话
  // 的执行记录，本仓纪律是不代他人改写其执行记录。新 PR 的记录载体已被 enforce-gate-record-presence
  // 固定为 openspec/records/<分支>.md，旧载体不再新增，故规避路径不存在。
  let legacyVisibleContradictions = 0
  for (const b of blocks) {
    const blk = lines.slice(b.line, b.end)
    const row = blk.find(l => ROW_RE.test(l))
    if (!row) continue
    const st = normalize((row.split('|').map(normalize)[2] || ''))
    if (!CLOSED_RE.test(st)) continue
    legacyVisibleContradictions += statusDeclarations(blk.join('\n')).filter(d => !d.closed).length
  }

  const rowCountAll = rowCount + fileNames.length
  if (rowCountAll === 0) throw new Error(`两源都读到 0 条 远程同步 记录（${file} + ${recordsRoot}）——空遍历不得判为"零欠账"`)

  return {
    rowCount,
    headingCount: headings.length,
    recordCount: records.length,
    recordsWithoutRow,
    topRecord,
    topRecordMissingRow,
    carrierDrift,
    recordsFromFiles,
    missingRecordRows,
    statusContradictions,
    crossSrcViolations,
    crossSrcBackfillVisible,
    crossSrcPairs,
    crossSrcStaleAck,
    crossSrcAllowedSize: crossSrcAllowed.size,
    crossSrcAcksNotApplicable,
    statusMismatchVisible,
    legacyVisibleContradictions,
    staleRecordFields,
    open,
    stale,
    registered,
    duplicates,
  }
}

function format(r) {
  const out = []
  out.push(`远程同步行 ${r.rowCount} 条 / 执行记录 ${r.recordCount} 篇（全部 ## 标题 ${r.headingCount} 个）/ 已登记欠账 ${r.registered.length} 条 / 记录文件 ${r.recordsFromFiles} 篇（两源分列，不可合并成一个趋势数）`)
  out.push(`（可见项，不拦截：其中 ${r.recordsWithoutRow.length} 篇执行记录整块没有 远程同步 行，属历史缺口）`)
  if (r.missingRecordRows.length) {
    out.push(`❌ 记录文件整块缺 远程同步 行 ${r.missingRecordRows.length} 篇（每篇都必须独立可查，不再只查最顶部一篇）：`)
    for (const m of r.missingRecordRows) out.push(`  ${m.file} —— ${m.reason}`)
  }
  if (r.staleRecordFields.length) {
    out.push(`❌ 已回填却仍留登记字段的记录 ${r.staleRecordFields.length} 篇（回填后请删除这两个字段）：`)
    for (const s of r.staleRecordFields) out.push(`  ${s}`)
  }
  if (r.open.length) {
    out.push(`❌ 未登记的欠账 ${r.open.length} 条（新增未收口行必须带原因进 ${path.basename(LEDGER_FILE)}）：`)
    for (const o of r.open) out.push(`  L${o.line} [${o.status}] ${o.heading}`)
  }
  if (r.stale.length) {
    out.push(`❌ 欠账清单里的陈旧登记 ${r.stale.length} 条（该行已回填或标题已改，请删除对应条目）：`)
    for (const s of r.stale) out.push(`  ${s}`)
  }
  if (r.duplicates.length) {
    out.push(`❌ 同一条执行记录被写了两遍（${r.duplicates.length} 条标题重复；置顶型文档的自我损坏形态）：`)
    for (const d of r.duplicates) out.push(`  x${d.count} ${d.text}`)
    out.push('  处理：删掉多余那半（逐字节切除、不得整文件统一行尾），并把清理结果写进本次记录')
  }
  if (r.statusContradictions.length) {
    out.push(`❌ 同一篇记录的两种形态互相矛盾 ${r.statusContradictions.length} 处（表格行已收口，声明式 bullet 仍写着未收口词）：`)
    for (const c of r.statusContradictions) {
      out.push(`  ${c.file} L${c.bulletLine} [bullet=${c.bulletStatus}] ← 权威表格行 L${c.rowLineNo} 已是 [${c.rowStatus}]`)
    }
    out.push('  处理：把该 bullet 的状态词改成与权威行一致（无损——证据已在表格行里），或按既有 PASS 口径回填权威行；'
      + '两种形态都写、且同次改写，是 docs-only 记录的安全写法。')
  }
  if (r.crossSrcViolations.length) {
    out.push('❌ 跨源矛盾 ' + r.crossSrcViolations.length + ' 处：记录文件已 PASS，旧载体同 slug 的 远程同步 行仍未收口')
    out.push('   「已合并却被读成没干完」正是重复开工的入口；既有判据只看单源自洽，看不见这种跨源矛盾。')
    for (const c of r.crossSrcViolations) {
      out.push('  ' + c.slug + ' 记录=[' + c.recordStatus + '] 但载体 L' + c.line + '=[' + c.status + ']「' + c.text.slice(0, 60) + '」')
    }
    out.push('  处理：在**同一次提交**里把载体行与记录行一起改写（PASS + merge SHA）并删 ledger 登记项；'
      + '若该块属他人会话，由其作者回填后本条自动消解，且承认清单必须同步缩小。')
  }
  if (r.crossSrcStaleAck.length) {
    out.push('❌ 跨源承认清单已陈旧 ' + r.crossSrcStaleAck.length + ' 条（该 slug 已不再构成矛盾，必须从承认清单删除）：')
    for (const a of r.crossSrcStaleAck) out.push('  ' + a)
  }
  if (r.crossSrcBackfillVisible.length) {
    out.push('（可见项，不拦截：回填型载体块 ' + r.crossSrcBackfillVisible.length + ' 处的未收口行说的是它自己那笔回填 PR，不参与跨源比对）')
    for (const b of r.crossSrcBackfillVisible) {
      out.push('   · ' + b.slug + ' L' + b.line + ' [' + b.status + ']「' + b.text.slice(0, 46) + '」')
    }
  }
  out.push('（跨源比对现场：配对 ' + r.crossSrcPairs + ' 组 / 违例 ' + r.crossSrcViolations.length +
    ' / 承认 ' + r.crossSrcAllowedSize + ' / 回填型排除 ' + r.crossSrcBackfillVisible.length + '）')
  if (r.crossSrcAcksNotApplicable.length) {
    out.push('（可见项，不拦截：承认清单里 ' + r.crossSrcAcksNotApplicable.join(',') + ' 本次没读到对应的已收口记录——真仓里若长期如此就该删掉本项）')
  }
  if (r.statusMismatchVisible.length) {
    out.push(`（可见项，不拦截：反向矛盾 ${r.statusMismatchVisible.length} 处 — 表格行未收口而 bullet 宣称完成；实测 0 篇故不扩拦截面）`)
    for (const c of r.statusMismatchVisible) out.push(`   · ${c.file} L${c.bulletLine} [bullet=${c.bulletStatus}] 行=[${c.rowStatus}]`)
  }
  if (r.legacyVisibleContradictions) {
    out.push(`（可见项，不拦截：旧载体 .quality-gates.md 同形态矛盾 ${r.legacyVisibleContradictions} 处 — 属他人会话的记录块，不代改）`)
  }
  if (r.topRecordMissingRow && r.topRecord) {
    out.push(`（可见项，不拦截：旧载体最顶部记录缺 远程同步 行「${r.topRecord.text.slice(0, 60)}」—— 新 PR 的强制载体是 openspec/records/，该处已不判红）`)
  }
  if (r.carrierDrift) {
    const d = r.carrierDrift
    out.push('❌ 旧载体冻结被破坏：.quality-gates.md 的记录块集合不再等于冻结基线（新 PR 只允许写 openspec/records/，旧载体只许就地关闭已有行，不许加块/删块）')
    out.push(`   基线 条数=${d.countBefore} sha=${d.shaBefore}…  现状 条数=${d.countAfter} sha=${d.shaAfter}…`)
    if (d.added.length) {
      out.push(`   新增块 ${d.added.length} 个：`)
      d.added.slice(0, 10).forEach((t) => out.push(`     + ${t.slice(0, 90)}`))
      if (d.added.length > 10) out.push(`     …（其余 ${d.added.length - 10} 个省略）`)
    }
    if (d.removed.length) {
      out.push(`   消失块 ${d.removed.length} 个：`)
      d.removed.slice(0, 10).forEach((t) => out.push(`     - ${t.slice(0, 90)}`))
    }
    if (!d.baselineHasTitles) out.push('   （基线未含标题清单，只能报计数/哈希；要逐条点名请在冻结文件里补 headings）')
    out.push('   出路：① 把这块内容改写成 openspec/records/<分支名>.md（推荐）；② 确属有意变更存档面 → 由人工重算基线并在 PR 里单独说明（属"改谁来守门"，不走自动合并）。')
  }
  if (!r.open.length && !r.stale.length && !r.duplicates.length
    && !r.missingRecordRows.length && !r.staleRecordFields.length && !r.statusContradictions.length
    && !r.crossSrcViolations.length && !r.crossSrcStaleAck.length && !r.carrierDrift) {
    out.push('OK: 两源所有未收口的 远程同步 行均已登记，清单无陈旧项、记录标题无重复、记录文件登记字段无残留、旧载体与冻结基线一致')
  }
  return out.join('\n')
}

// main 与测试共用这一条谓词：判据若被降级成「只打印」，hasBlocking 断言会当场变红。
function hasBlocking(r) {
  // 顶部记录带行已从拦截面**移入可见面**：那条规则唯一作用是"用位置猜哪篇最新"，而记录文件源
  // 有逐篇硬判据（missingRecordRows 在拦截面里），位置猜测不再必要。留它会继续逼每个会话去挤
  // 那个所有会话共用的大文件 —— 而那正是本判据要消灭的丢工窗口。
  return !!(r.open.length || r.stale.length || r.duplicates.length
    || r.missingRecordRows.length || r.staleRecordFields.length || r.statusContradictions.length
    || r.crossSrcViolations.length || r.crossSrcStaleAck.length || r.carrierDrift)
}

function main() {
  const root = path.resolve(__dirname, '..')
  // 冻结基线只在 CLI 侧读生产文件；collect() 保持可注入，避免测试静流量到真仓基线。
  const r = collect({ root, carrierFreeze: loadCarrierFreeze() })
  console.log(format(r))
  if (hasBlocking(r)) process.exit(1)
}

module.exports = {
  collect, format, loadLedger, normalize, hasBlocking, statusDeclarations,
  UNCLOSED_DECL_RE, CLOSED_DECL_RE,
  listRecordFiles, readRecord, readFrontmatter,
  CROSS_SLUG_RE, CROSS_BACKFILL_RE, CROSS_SRC_ALLOWED,
  RECORDS_REL, RECORD_FIELD_REASON, RECORD_FIELD_OWNER, RECORD_FIELD_STATUS,
  GATE_FILE, LEDGER_FILE, DUPLICATE_HEADINGS_ALLOWED,
  CARRIER_FREEZE_FILE, loadCarrierFreeze, carrierSignature,
}

if (require.main === module) main()
