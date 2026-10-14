#!/usr/bin/env node
/**
 * import-platform-metric-matrix.js —— 把竞品「指标矩阵」ini 转成本仓的参考数据。
 *
 * 输入：厂商 `mediadatamgr.ini`（本项目实测副本在
 *       `01-docs/research/competitor-reverse-2026-10-13/platform-data/mediadatamgr.ini`）
 * 输出：`config/platform-metric-matrix.json`
 *
 * ## 定位：**参考数据，不是运行时真源**
 *
 * 运行时真源仍是 `account-metrics/adapters.js` 的实际字段解析。本表只用于两件事：
 *   ① UI 文案（告诉用户「这个平台能拿到哪些指标」）；
 *   ② 测试的交叉校验（`reconcileObservation`）。
 *
 * **★ 不得用于请求门控。** 厂商矩阵是**他们产品的**能力边界，不是本仓的 ——
 * 本仓实测能拿到的，即使厂商没声明，也应采信实测（`undeclared-but-present` 不是错误）。
 *
 * ## 为什么必须是**二维**结构
 *
 * 源文件有两个段，**同名不同义**：
 *   `[1]` 内容数据：`1:总收益 2:昨日收益 3:图文总阅读数 …`
 *   `[2]` 趋势数据：`1:收益   2:推荐     3:播放         …`
 * 段 1 的 `1` 与段 2 的 `1` **不是同一个指标**。压成「平台 → 指标」一维会让两者互相覆盖，
 * 因此产物结构是 `groups`（组 → 平台 → 指标 id），并在 `metricKeyMap` 里按组分别映射到本仓 metric key。
 * **两段的平台覆盖也不同**（实测 `[1]` 31 个平台 / `[2]` 27 个），二维结构同时解决了这一点。
 *
 * ## 范围：只覆盖**本项目已支持**的平台
 *
 * 与 `import-platform-taxonomy.js` 同一条纪律（用户 2026-10-13 明确要求）：
 * 只导入本项目 `config/platforms.yaml` 里已支持的平台，避免把用不上的表挂进来。
 * 未映射的厂商平台**如实登记进 `unmappedVendorPlatforms`**，不静默丢弃。
 *
 * ## ★ 一处刻意的小心：`tencent_video` 取厂商 **53（视频号）**，不是 21（腾讯视频）
 *
 * 厂商矩阵里 21 与 53 是**两个不同平台**。本项目 `config/platforms.yaml:93-98` 明写
 * `tencent_video` 是**视频号**、指向 `channels.weixin.qq.com`。
 * （对照：P0-1 的分类表只有「腾讯视频」的，故那里**排除**了 tencent_video —— 两处结论不同，
 * 但依据同一条纪律：**字段名相同 ≠ 语义相同**。）
 *
 * 用法：
 *   node scripts/import-platform-metric-matrix.js --source <ini 文件或目录> --out <json> [--check]
 *   --check 只校验（不写文件），产物与磁盘一致则 exit 0，否则 exit 1（供 CI 防漂移）
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** 本项目已支持的平台 → 厂商平台 ID。依据 config/platforms.yaml 与厂商 ini 的注释名逐条核对。 */
const SUPPORTED_PLATFORMS = {
  wechat_mp: 1, // 微信公众号
  toutiao: 3, // 头条号
  baijiahao: 4, // 百家号
  weibo: 10, // 微博
  zhihu: 12, // 知乎
  bilibili: 23, // 哔哩哔哩
  kuaishou: 35, // 快手
  douyin: 36, // 抖音
  xiaohongshu: 51, // 小红书
  tencent_video: 53, // 视频号（**不是** 21 腾讯视频，见文件头说明）
}

/** 组 id → 语义名 + 本仓 metric key 映射 */
const GROUP_DEFS = {
  1: {
    key: 'content',
    label: '内容数据',
    metricKeys: {
      1: 'income',
      2: 'incomeYesterday',
      3: 'readTotal',
      4: 'readYesterday',
      5: 'playTotal',
      6: 'playYesterday',
      7: 'fans',
      8: 'commentsYesterday',
      9: 'likesYesterday',
      10: 'sharesYesterday',
      11: 'fansGainYesterday',
    },
  },
  2: {
    key: 'trend',
    label: '趋势数据',
    metricKeys: { 1: 'income', 2: 'impressions', 3: 'play', 4: 'comments', 5: 'likes', 6: 'shares', 7: 'fansGain' },
  },
}

const SCHEMA_VERSION = 1

function die (msg) {
  console.error('❌ ' + msg)
  process.exit(1)
}

function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--source') out.source = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--check') out.check = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

/** 把 `--source` 解析成那个 ini 文件：允许直接给文件，或给含它的目录 */
function resolveIni (src) {
  if (!src || !fs.existsSync(src)) die(`--source 不存在：${src || '(空)'}`)
  const st = fs.statSync(src)
  if (st.isFile()) return src
  const direct = path.join(src, 'mediadatamgr.ini')
  if (fs.existsSync(direct)) return direct
  // 目录下递归找一个（只认这一个文件名，不做模糊匹配）
  const stack = [src]
  while (stack.length) {
    const d = stack.pop()
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name.toLowerCase() === 'mediadatamgr.ini') return p
    }
  }
  die(`在 ${src} 下没有找到 mediadatamgr.ini（若目录结构变了，请先确认文件名；不要在没有输入的情况下产出空表）`)
}

/**
 * 解析 ini 正文。
 *
 * 形态（实测）：
 *   `#1:总收益 2、昨日收益 …`   ← 段**之前**的注释行，声明该段的指标名
 *   `[1]`                        ← 段头
 *   `#微信公众号`                 ← 该平台的注释名
 *   `1=1,2,4,6,7,10,11`          ← 厂商平台 id = 可用指标 id 列表
 *
 * 解析纪律：
 *   · **段的指标名必须解析成功**，否则 fail-loud —— 名字是映射的锚点，缺了整张表就没有意义；
 *   · 段头必须严格 `[数字]`；
 *   · 平台行必须严格 `<数字>=<数字,数字,…>`；不认的行**收集进 problems**（不静默跳过）。
 */
function parseIni (text) {
  const lines = text.split(/\r?\n/)
  const groups = {} // gid -> { groupLabel, metricNames: {id:name}, platforms: {vendorId: [metricIds]} }
  const problems = []
  let cur = null
  let pendingNames = null

  /**
   * 从指标名注释行里抠出 `{id: name}`。
   *
   * 实测格式（**不是**规整的 `id:name` 序列）：
   *   `#1:总收益 2、昨日收益 3、图文总阅读数 4、昨天图文阅读数 5、总视频播放数 6、昨天视频播放数`
   *   `#7、粉丝数 8、昨日评论数 9、昨日点赞数 10、昨日分享数 11、 昨日涨粉数`
   * 即：**编号后的分隔符是 `:` 或 `、`（首个用 `:`，其后用 `、`）**，且**同一条声明会跨多行**。
   * 所以这里只按「编号 + 分隔符 + 到下一个编号为止」切，调用方负责跨行累积。
   */
  function parseMetricNames (comment) {
    const body = comment.replace(/^#\s*/, '')
    const names = {}
    const re = /(\d+)\s*[:：、]\s*([^0-9]*?)(?=(?:\s*\d+\s*[:：、])|$)/g
    let m
    while ((m = re.exec(body)) !== null) {
      const id = m[1]
      const name = m[2].replace(/[、,，\s]+$/, '').trim()
      if (name) names[id] = name
    }
    return names
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const sec = /^\[(\d+)\]$/.exec(line)
    if (sec) {
      const gid = sec[1]
      if (!GROUP_DEFS[gid]) { problems.push(`未知的段 [${gid}]`); cur = null; continue }
      if (groups[gid]) problems.push(`段 [${gid}] 重复出现`)
      groups[gid] = { label: GROUP_DEFS[gid].label, metricNames: pendingNames || {}, platforms: {} }
      if (!pendingNames || Object.keys(pendingNames).length === 0) {
        problems.push(`段 [${gid}] 之前没有解析出指标名（映射缺锚点，整张表不可用）`)
      }
      cur = gid
      pendingNames = null
      continue
    }

    if (line.startsWith('#')) {
      const names = parseMetricNames(line)
      // 指标名声明**跨多行**：`#1:总收益 2、昨日收益 …` / `#7、粉丝数 8、…`
      // ⇒ 累积而不是覆盖，否则段头一到就只剩最后一行。
      if (Object.keys(names).length >= 2) pendingNames = { ...(pendingNames || {}), ...names }
      else if (cur) {
        const m = /^#(.+)$/.exec(line)
        if (m) groups[cur]._pendingLabel = m[1].trim() // 平台的注释名
      }
      continue
    }

    const kv = /^(\d+)\s*=\s*([\d,\s]*)$/.exec(line)
    if (kv) {
      if (!cur) { problems.push(`平台行出现在任何段之前：${line}`); continue }
      const vendorId = kv[1]
      const ids = kv[2].split(',').map((s) => s.trim()).filter(Boolean)
      if (ids.length === 0) { problems.push(`段 [${cur}] 平台 ${vendorId} 的指标列表为空`); continue }
      const bad = ids.filter((i) => !groups[cur].metricNames[i])
      if (bad.length) problems.push(`段 [${cur}] 平台 ${vendorId} 引用了未声明的指标 id：${bad.join(',')}`)
      groups[cur].platforms[vendorId] = { ids, label: groups[cur]._pendingLabel || '' }
      continue
    }

    problems.push(`无法解析的行：${line}`)
  }

  for (const g of Object.values(groups)) delete g._pendingLabel
  return { groups, problems }
}

function build () {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('用法: node scripts/import-platform-metric-matrix.js --source <ini|目录> --out <json> [--check]')
    process.exit(0)
  }
  if (!args.source) die('必须传 --source')
  const iniPath = resolveIni(args.source)

  // 源文件编码：实测为 UTF-8（含中文指标名）。用 UTF-8 解码并检查替换字符 —— 若是 GBK 会大面积出 U+FFFD。
  const buf = fs.readFileSync(iniPath)
  const text = buf.toString('utf8')
  const replacements = (text.match(/\uFFFD/g) || []).length
  if (replacements > 0) {
    die(`${iniPath} 以 UTF-8 解码出现 ${replacements} 个替换字符 —— 该文件很可能不是 UTF-8，拒绝产出错表`)
  }

  const { groups: rawGroups, problems } = parseIni(text)
  if (problems.length) {
    console.error('❌ 解析发现问题，拒绝产出：')
    for (const p of problems.slice(0, 20)) console.error('   · ' + p)
    process.exit(1)
  }

  // 组装产物：只保留本项目已支持的平台
  const groups = {}
  for (const [gid, def] of Object.entries(GROUP_DEFS)) {
    const src = rawGroups[gid]
    if (!src) die(`源文件缺段 [${gid}]`)
    const metrics = {}
    // 按 GROUP_DEFS 的顺序输出，保证确定性
    for (const mid of Object.keys(def.metricKeys).sort((a, b) => Number(a) - Number(b))) {
      const name = src.metricNames[mid]
      if (!name) die(`段 [${gid}] 缺指标 ${mid} 的名称`)
      metrics[mid] = name
    }
    groups[gid] = { key: def.key, label: def.label, metrics, platforms: {} }
  }

  const unmappedVendorPlatforms = []
  const allVendorIds = new Set()
  for (const gid of Object.keys(GROUP_DEFS)) for (const vid of Object.keys(rawGroups[gid].platforms)) allVendorIds.add(vid)

  for (const [pid, vendorId] of Object.entries(SUPPORTED_PLATFORMS)) {
    const perGroup = {}
    for (const gid of Object.keys(GROUP_DEFS)) {
      const e = rawGroups[gid].platforms[String(vendorId)]
      if (e) perGroup[gid] = e.ids
    }
    if (Object.keys(perGroup).length === 0) die(`已支持平台 ${pid}（厂商 ${vendorId}）在源文件里一个段都没有`)
    groups['1'].platforms = groups['1'].platforms || {}
    // 每个组各存自己的平台表（二维结构的第二维）
    for (const gid of Object.keys(perGroup)) groups[gid].platforms[pid] = perGroup[gid]
  }

  for (const vid of [...allVendorIds].sort((a, b) => Number(a) - Number(b))) {
    if (Object.values(SUPPORTED_PLATFORMS).includes(Number(vid))) continue
    const labels = Object.keys(GROUP_DEFS)
      .map((gid) => rawGroups[gid].platforms[vid] && rawGroups[gid].platforms[vid].label)
      .filter(Boolean)
    unmappedVendorPlatforms.push({ vendorPlatformId: Number(vid), label: labels[0] || '' })
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    $comment:
      'GENERATED by scripts/import-platform-metric-matrix.js —— 请勿手改。' +
      '本表是**参考数据，不是运行时真源**（真源是 account-metrics/adapters.js 的实际字段解析）；' +
      '只用于 UI 文案与测试交叉校验，**不得用于请求门控**。' +
      '引用本表时必须带上 source.note：厂商矩阵是**他们的**能力边界，本仓实测能拿到的即使厂商未声明也应采信实测。',
    source: {
      kind: 'vendor-ini',
      file: path.basename(iniPath),
      note:
        '指标口径为厂商自定义分组，可能与本仓 metric key 不同名 —— 映射必须显式声明。' +
        '段 [1]（内容数据）与段 [2]（趋势数据）同名不同义（段 1 的 id=1 是「总收益」，段 2 的 id=1 是「收益」），' +
        '且两段平台覆盖不同，故 groups 是二维结构。',
      unmappedVendorPlatforms,
      unmappedCount: unmappedVendorPlatforms.length,
    },
    groups,
    metricKeyMap: Object.fromEntries(
      Object.entries(GROUP_DEFS).map(([gid, def]) => [gid, { ...def.metricKeys }])
    ),
    // 本仓已有适配器的指标 key（供交叉校验；不是从矩阵推出来的）
    knownMetricKeys: [
      ...new Set(Object.values(GROUP_DEFS).flatMap((d) => Object.values(d.metricKeys))),
    ].sort(),
  }
}

function main () {
  const args = parseArgs(process.argv.slice(2))
  const data = build()
  const json = JSON.stringify(data, null, 2) + '\n'

  if (args.check) {
    if (!args.out) die('--check 需要同时给 --out 以便比对')
    if (!fs.existsSync(args.out)) die(`--check：产物不存在 ${args.out}`)
    const onDisk = fs.readFileSync(args.out, 'utf8')
    if (onDisk !== json) {
      console.error('❌ --check 失败：磁盘产物与重生成不一致（矩阵已漂移，请重跑转换器）')
      process.exit(1)
    }
    console.log('✅ --check 通过：产物与重生成一致')
    return
  }

  if (!args.out) die('必须传 --out')
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
  fs.writeFileSync(args.out, json, 'utf8')
  const crypto = require('node:crypto')
  const sha = crypto.createHash('sha256').update(json).digest('hex')
  const platCount = Object.keys(data.groups['1'].platforms).length
  console.log(`   产出 ${args.out}  sha256=${sha.slice(0, 16)}…`)
  console.log(`   平台 ${platCount} 个  ·  未映射厂商平台 ${data.source.unmappedCount} 个（已如实登记，未静默丢弃）`)
}

main()
