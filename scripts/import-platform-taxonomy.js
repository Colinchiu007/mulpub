/**
 * import-platform-taxonomy.js — 把竞品数据里的「平台分类 ID 对照表」转成项目可用的 config。
 *
 * ## 为什么需要这个脚本
 *
 * 发布时若调用方不指定分类，代码会落到硬编码默认值：
 *   packages/api-publish-engine/src/publish/platforms/bilibili-video.js:77  → tid || 21
 *   packages/api-publish-engine/src/adapters/youtube.js:85                  → categoryId || "22"
 * 字段通路是通的（publish/task-data.js、publish/publish-request.js 白名单已含 category/categoryId），
 * **缺的是「中文分类名 → 平台侧数字 ID」的对照表**。本脚本生成它。
 *
 * ## 三条从实测得来、不可违背的设计约束
 *
 * ① **图文 / 视频是两套独立分类，同一 id 含义不同。**
 *    实测（B站）：id=21 在图文表是「萌宠」、在视频表是「日常」；id=4 图文是「动漫杂谈」、视频是「游戏」。
 *    ⇒ 产出必须按 contentType 分块，绝不可合并成一张表。
 *
 * ② **分类映射是「装在 .txt 里的 JSON」，形态不固定。**
 *    实测形态含：`{id,name,children}`、`{code,text}` 扁平、`{child:[…]}` 嵌套、
 *    `{childrenCate,level,parentCate,…}` 任意深度、顶层数组等。
 *    素材报告曾因「只认一种形态」把 11,623 个节点少算成 3,838（**少算 67%**）。
 *    ⇒ 采用**形态无关递归遍历**；遍历不到节点即视为未识别，**非零退出**，绝不静默产出空表。
 *
 * ③ **只导入带 ID 的映射（`*categortmap.txt`）。**
 *    `*subcategort.txt` 是同一批分类的**去 ID 镜像**（实测 B站 38 节点全部无 id，与 map 的 38 个一一对应），
 *    对「按名查 ID」毫无价值，导入只会让文件翻倍。
 *
 * ## 编码
 * 数据集 132 个文本文件中 54 个 UTF-8 / 78 个 GBK，且**同一目录内混用**（实测）
 * ⇒ 逐文件判定：先试严格 UTF-8，失败再按 GBK 解码。**不得按扩展名或目录批量判定。**
 *
 * ## 用法
 *   node scripts/import-platform-taxonomy.js --source <数据目录> --out config/platform-taxonomy.json
 *   node scripts/import-platform-taxonomy.js --source <目录> --out <文件> --check   # 只校验不写
 *
 * 退出码：0 = 成功；1 = 有未识别形态 / 目标平台文件缺失；2 = 参数错误。
 */
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

// ── 参数 ──────────────────────────────────────────────────────────────────
function parseArgs (argv) {
  const o = { source: null, out: null, check: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--source') o.source = argv[++i]
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--check') o.check = true
    else { console.error(`未知参数: ${a}`); console.error('用法: node scripts/import-platform-taxonomy.js --source <数据目录> --out <产出文件> [--check]'); process.exit(2) }
  }
  if (!o.source || (!o.out && !o.check)) {
    console.error('用法: node scripts/import-platform-taxonomy.js --source <数据目录> --out <产出文件> [--check]')
    process.exit(2)
  }
  return o
}

// ── 平台映射 ──────────────────────────────────────────────────────────────
// 只覆盖本项目 config/platforms.yaml 里已支持的平台中**确有条目 ID 数据**的那些。
// 文件名前缀 → 本项目平台 id。多前缀表示该平台有多个来源表（如头条系）。
const PLATFORM_PREFIXES = {
  bilibili: ['bilibili'],
  douyin: ['douyin'],
  toutiao: ['huitoutiao', 'qutoutiao'],
  baijiahao: ['baijia'],
  weibo: ['weibo'],
  zhihu: ['zhihu'],
  // ⚠️ `tencent_video` **刻意不导入**。本项目 config/platforms.yaml:93-98 明写：
  //    「本条的 id 是 tencent_video，但 name 是「视频号」、publish_url 指向 channels.weixin.qq.com
  //     —— 实际发布目标是微信视频号，不是腾讯视频（v.qq.com）；腾讯视频未接入」。
  //    而数据集里的 `tencentvideocategortmap.txt` 属于**腾讯视频**（实测 mediadatamgr.ini：
  //    21=腾讯视频、53=视频号）⇒ 把它的分类 ID 挂到视频号上就是「发错平台」。
  //    宁可少一个平台，也不接一张别的平台的表。
}

// 本项目支持、但**本数据集里没有可安全使用的带 ID 分类数据**的平台。
// 显式登记（而不是默默不出现），让读取层能区分「没有这条数据」与「忘了导入」。
const PLATFORMS_WITHOUT_ID_DATA = [
  'kuaishou',      // 数据集中只有 *subcategort（去 ID 镜像）
  'wechat_mp',     // 同上（weixinvideosubcategort.txt 无 ID）
  'tencent_video', // 本项目的 tencent_video 指微信视频号；数据集里只有腾讯视频的表（见上）
]

// 来源快照信息。**不写生成时间**（那会破坏「连跑两次字节相同」的确定性；
// 何时生成由 git 历史记录）。快照日期与「未联网校验」是给读者的必要警示。
const SNAPSHOT_DATE = '2026-07-14'
const SOURCE_KIND = 'competitor-data-snapshot'

// ── 编码判定（逐文件，不按目录/扩展名）─────────────────────────────────────
const utf8strict = new TextDecoder('utf-8', { fatal: true })
const gbk = new TextDecoder('gbk')
function readText (p) {
  const b = fs.readFileSync(p)
  try { return { text: utf8strict.decode(b), enc: 'utf-8' } } catch { return { text: gbk.decode(b), enc: 'gbk' } }
}

/** 容忍注释行与尾逗号的 JSON 解析（实测数据集里两种都有） */
function tryJson (text) {
  const s = text.trim()
  try { return { ok: true, value: JSON.parse(s) } } catch { /* 继续 */ }
  try { return { ok: true, value: JSON.parse(s.replace(/^\s*#.*$/gm, '').replace(/,\s*([}\]])/g, '$1')) } } catch { /* 继续 */ }
  return { ok: false }
}

// ── 形态无关遍历 ──────────────────────────────────────────────────────────
const ID_KEYS = ['id', 'code', 'cateId', 'cate_id', 'categoryId', 'category_id', 'channel_id', 'channelId', 'value']
const NAME_KEYS = ['name', 'text', 'title', 'label', 'channel', 'channel_chinese', 'cateName', 'cate_name']
const CHILD_KEYS = ['cates', 'child', 'children', 'childrenCate', 'sub', 'subs', 'list', 'items', 'cateList', 'childCate', 'childrenCates']

/**
 * 形态无关遍历，返回 { nodes, maxDepth, shape }。
 * nodes: [{ id, name, depth, parentId }]，**只含带 id 的节点**（无 id 的仅用于占位/层级判定）。
 */
function walkTaxonomy (root) {
  const nodes = []
  let maxDepth = 0
  const seenIds = new Map() // id → name
  const duplicates = []     // 同一 id 配**不同** name —— 源数据的真歧义
  let dedupedCount = 0      // 同一 (id, name) 的重复条目 —— 源数据噪音

  const push = (id, name, depth, parentId) => {
    const sid = String(id); const sname = String(name)
    const prev = seenIds.get(sid)
    // 百家号源文件里同一 (id, name) 会重复几十次（实测「教学」出现 42 次、8 组共 52 条多余）。
    // 完全相同的重复是无信息噪音，去重即可。
    if (prev === sname) { dedupedCount++; return }
    const ambiguous = prev !== undefined
    if (ambiguous) {
      // 同 id 不同 name：实测 B站视频表把 tid=36 同时给了「知识」和「科技」两个一级分类。
      // 发 tid=36 时平台按哪个解释，**从数据里无法判断** ⇒ 两侧都保留并打标，
      // 由读取层拒绝按该 id/名解析（返回 ambiguous 并列候选），而不是在这里丢掉一个。
      duplicates.push({ id: sid, names: [prev, sname] })
      for (const n of nodes) if (n.id === sid) n.ambiguous = true
    } else {
      seenIds.set(sid, sname)
    }
    const node = { id: sid, name: sname, depth, parentId: parentId == null ? null : String(parentId) }
    if (ambiguous) node.ambiguous = true
    nodes.push(node)
    if (depth > maxDepth) maxDepth = depth
  }

  /** 形态：{"一级分类名": ["二级名", …] | {子名: …} | null} —— **键即分类名，无 id**。
   *  本脚本只导带 id 的映射，故此形态下不产出节点；但仍需识别出来，
   *  以便区分「这个文件本来就没有 id」与「我没看懂」——前者不算未识别，后者必须报错。 */
  const isNameMapValue = (v) =>
    (Array.isArray(v) && v.every((x) => typeof x === 'string')) ||
    (v !== null && typeof v === 'object' && !Array.isArray(v)) ||
    v === null
  const isNameMap = root && !Array.isArray(root) && typeof root === 'object' &&
    Object.keys(root).length > 0 && Object.values(root).every(isNameMapValue)
  if (isNameMap) return { nodes, maxDepth: 0, shape: '键即分类名（无 id，不产出）', duplicates, dedupedCount: 0 }

  let sawAnyNodeShape = false
  function visit (node, depth, parentId) {
    if (depth > 32) return // 防御：实测最深 4 层，32 足够且能挡住环
    if (Array.isArray(node)) { for (const c of node) visit(c, depth, parentId); return }
    if (!node || typeof node !== 'object') return

    const idKey = Object.keys(node).find((k) => ID_KEYS.includes(k) && node[k] !== undefined && node[k] !== null && String(node[k]).trim() !== '')
    const nameKey = Object.keys(node).find((k) => NAME_KEYS.includes(k) && typeof node[k] === 'string' && node[k].trim())
    const childKey = Object.keys(node).find((k) => CHILD_KEYS.includes(k) && (Array.isArray(node[k]) || (node[k] && typeof node[k] === 'object')))

    if (nameKey) sawAnyNodeShape = true
    const myId = idKey ? String(node[idKey]) : null
    if (nameKey && idKey) push(node[idKey], node[nameKey], depth + 1, parentId)

    if (childKey) {
      const kids = node[childKey]
      const kidsArr = Array.isArray(kids) ? kids : [kids]
      for (const c of kidsArr) visit(c, depth + 1, myId)
    }
  }
  visit(root, 0, null)
  return { nodes, maxDepth, shape: sawAnyNodeShape ? 'id/name 对象' : '未识别', duplicates, dedupedCount }
}

// ── 主流程 ────────────────────────────────────────────────────────────────
function main () {
  const opts = parseArgs(process.argv.slice(2))

  if (!fs.existsSync(opts.source) || !fs.statSync(opts.source).isDirectory()) {
    console.error(`❌ 数据目录不存在或不是目录: ${opts.source}`)
    process.exit(1)
  }

  // 只取带 ID 的映射表；排序保证确定性（readdir 顺序不保证）
  const allFiles = fs.readdirSync(opts.source).filter((f) => /categortmap\.txt$/i.test(f)).sort()
  if (allFiles.length === 0) {
    console.error(`❌ 在 ${opts.source} 下没有找到任何 *categortmap.txt（带 ID 的映射表）`)
    console.error('   若数据目录结构变了，请先确认文件命名；不要在没有输入的情况下产出空表。')
    process.exit(1)
  }

  const platforms = {}
  const unrecognized = []   // 致命：读了文件但解析不出来（我没看懂）
  const missing = []        // 非致命：该平台在本数据集里压根没有映射文件（数据不覆盖）
  const filesRead = []
  let nodesTotal = 0
  let dedupedTotal = 0
  const conflicts = []

  for (const [platform, prefixes] of Object.entries(PLATFORM_PREFIXES)) {
    const hits = allFiles.filter((f) => prefixes.some((p) => f.toLowerCase().startsWith(p)))
    // 平台缺失**不是**未识别：本数据集不覆盖该平台，或该平台只有去 ID 的 *subcategort 镜像。
    // 判错这一格的后果：脚本无法在子集（如测试 fixture）上运行，且把「数据不覆盖」误报成「解析失败」。
    if (hits.length === 0) { missing.push(platform); continue }

    platforms[platform] = {}
    for (const f of hits) {
      const contentType = /video/i.test(f) ? 'video' : 'article'
      const src = path.join(opts.source, f)
      const { text, enc } = readText(src)
      const j = tryJson(text)
      if (!j.ok) { unrecognized.push({ platform, file: f, why: 'JSON 解析失败' }); continue }

      const st = walkTaxonomy(j.value)
      filesRead.push({ platform, contentType, file: f, encoding: enc, nodes: st.nodes.length, deduped: st.dedupedCount })
      for (const d of st.duplicates) conflicts.push({ platform, contentType, sourceFile: f, id: d.id, names: d.names })

      if (st.shape === '未识别') {
        unrecognized.push({ platform, file: f, why: '遍历不到任何分类节点（形态未识别）' })
        continue
      }
      if (st.nodes.length === 0) {
        // 识别出形态但没有带 id 的节点 —— 对本脚本而言等于没有可用数据，必须报出
        unrecognized.push({ platform, file: f, why: `形态为「${st.shape}」但不含任何带 id 的节点` })
        continue
      }

      // 同一平台的多个来源表（如头条系的 huitoutiao/qutoutiao）分别落键，不合并
      const key = platforms[platform][contentType] ? `${contentType}:${f.replace(/categortmap\.txt$/i, '').replace(/video$/i, '')}` : contentType
      platforms[platform][key] = {
        contentType,
        sourceFile: f,
        encoding: enc,
        nodeCount: st.nodes.length,
        maxDepth: st.maxDepth,
        nodes: st.nodes,
      }
      nodesTotal += st.nodes.length
      dedupedTotal += st.dedupedCount
    }
    if (Object.keys(platforms[platform]).length === 0) delete platforms[platform]
  }

  // ── fail-loud：任何未识别都不得静默通过 ──
  if (unrecognized.length > 0) {
    console.error(`❌ 有 ${unrecognized.length} 处未能识别，拒绝产出 —— 上面的数字是**下界**，不得作为结论。`)
    for (const u of unrecognized) console.error(`   · ${u.platform}${u.file ? ' / ' + u.file : ''}  —— ${u.why}`)
    console.error('   请为该形态补充支持后重跑；不要以「大概是 0」放过。')
    process.exit(1)
  }

  // 确定性：键排序
  const sortedPlatforms = {}
  for (const p of Object.keys(platforms).sort()) {
    const blocks = {}
    for (const k of Object.keys(platforms[p]).sort()) blocks[k] = platforms[p][k]
    sortedPlatforms[p] = blocks
  }

  const payload = {
    $comment: '平台分类对照表。由 scripts/import-platform-taxonomy.js 生成，勿手改。',
    version: 1,
    source: {
      kind: SOURCE_KIND,
      snapshotDate: SNAPSHOT_DATE,
      verifiedOnline: false,
      conflictsNote: '同一 id 配多个 name：源数据自身有歧义（实测 B站视频表 tid=36 同时是「知识」与「科技」）。读取层对这些 id/名拒绝解析并列出候选，不猜。',
      verifiedOnlineNote: '该快照取自竞品数据资产，**未经任何联网校验**。平台侧分类会变，按本表发布的分类可能已失效。',
      filesRead: filesRead.sort((a, b) => (a.platform + a.file).localeCompare(b.platform + b.file)),
    },
    conflicts,
    platformsWithoutIdData: [...new Set([...PLATFORMS_WITHOUT_ID_DATA, ...missing])].sort(),
    stats: {
      platforms: Object.keys(sortedPlatforms).length,
      nodes: nodesTotal,
      dedupedIdenticalEntries: dedupedTotal,
    },
    platforms: sortedPlatforms,
  }

  const json = JSON.stringify(payload, null, 2) + '\n'
  const sha = crypto.createHash('sha256').update(json, 'utf8').digest('hex')

  if (!opts.check) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true })
    fs.writeFileSync(opts.out, json, 'utf8')
  }

  console.log(`✅ 解析 ${allFiles.length} 个映射文件，导入 ${Object.keys(sortedPlatforms).length} 个平台 / ${nodesTotal} 个带 ID 的分类节点`)
  for (const [p, blocks] of Object.entries(sortedPlatforms)) {
    const parts = Object.entries(blocks).map(([k, b]) => `${k}=${b.nodeCount}(L${b.maxDepth})`)
    console.log(`   ${p.padEnd(15)} ${parts.join('  ')}`)
  }
  console.log(`   无 ID 数据的平台（显式登记）: ${PLATFORMS_WITHOUT_ID_DATA.join(', ')}`)
  console.log(`   源数据里完全重复的 (id,name) 条目已去重: ${dedupedTotal} 条`)
  console.log(`   ⌫ 快照 ${SNAPSHOT_DATE}，未联网校验`)
  if (!opts.check) console.log(`   产出 ${opts.out}  sha256=${sha.slice(0, 16)}…`)
}

main()
