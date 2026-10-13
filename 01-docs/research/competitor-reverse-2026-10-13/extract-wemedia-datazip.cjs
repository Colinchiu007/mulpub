/**
 * 提取 融媒宝 data.zip —— 正确解码 GBK 文件名。
 *
 * 为什么不用 Expand-Archive：该 zip 的条目未置 UTF-8 标志位（general purpose bit 11 = 0），
 * 文件名以系统 ANSI 码页（GBK）存字节；.NET / PowerShell 会解码成乱码
 * （实测 `data/doc/⟨U+FFFD×8⟩.csv`），落盘后无法还原原名。
 *
 * 本脚本自行解析中央目录：
 *   * bit 11 = 1 或有非 ASCII 且能按 UTF-8 严格解码 ⇒ 按 UTF-8
 *   * 否则按 GBK 解码（Node 22 内置 full-ICU 支持 'gbk'）
 * 并逐一记录「原始字节 / 最终名 / 命中规则」，供事后核对。
 *
 * 只读源 zip；只写 <outDir>。不执行被解出的任何内容。
 * 用法: node extract-wemedia-datazip.cjs <zipPath> <outDir>
 */
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ZIP = process.argv[2]
const OUT = process.argv[3]
if (!ZIP || !OUT) { console.error('用法: node extract-wemedia-datazip.cjs <zipPath> <outDir>'); process.exit(2) }
if (fs.existsSync(OUT)) { console.error(`[中止] 输出目录已存在，拒绝覆盖: ${OUT}`); process.exit(2) }

const buf = fs.readFileSync(ZIP)
console.log(`源 zip : ${ZIP}  (${(buf.length / 1024).toFixed(1)} KB)`)

// ── 定位 EOCD（End of Central Directory），从尾部向前找签名 0x06054b50 ──
let eocd = -1
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
}
if (eocd < 0) { console.error('[中止] 未找到 EOCD，不是合法 zip'); process.exit(1) }

const total = buf.readUInt16LE(eocd + 10)
const cdSize = buf.readUInt32LE(eocd + 12)
const cdOff = buf.readUInt32LE(eocd + 16)
console.log(`条目数 : ${total}   中央目录 @${cdOff} (${cdSize} B)`)

const gbk = new TextDecoder('gbk')
const utf8strict = new TextDecoder('utf-8', { fatal: true })
function decodeName (raw, utf8Flag) {
  if (utf8Flag) return { name: utf8strict.decode(raw), rule: 'utf8(flag)' }
  const hasHigh = raw.some((b) => b > 0x7f)
  if (!hasHigh) return { name: raw.toString('latin1'), rule: 'ascii' }
  // 未置标志位：先试严格 UTF-8；失败再按 GBK
  try { return { name: utf8strict.decode(raw), rule: 'utf8(sniff)' } } catch { return { name: gbk.decode(raw), rule: 'gbk' } }
}

// ── 遍历中央目录 ──
const entries = []
let p = cdOff
for (let n = 0; n < total; n++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) { console.error(`[中止] 中央目录签名不符 @${p}`); process.exit(1) }
  const flags = buf.readUInt16LE(p + 8)
  const method = buf.readUInt16LE(p + 10)
  const crc = buf.readUInt32LE(p + 16)
  const compSize = buf.readUInt32LE(p + 20)
  const rawSize = buf.readUInt32LE(p + 24)
  const nameLen = buf.readUInt16LE(p + 28)
  const extraLen = buf.readUInt16LE(p + 30)
  const cmtLen = buf.readUInt16LE(p + 32)
  const lho = buf.readUInt32LE(p + 42)
  const rawName = buf.subarray(p + 46, p + 46 + nameLen)
  const { name, rule } = decodeName(Buffer.from(rawName), (flags & 0x800) !== 0)
  entries.push({ name, rawNameHex: Buffer.from(rawName).toString('hex'), rule, method, crc, compSize, rawSize, lho })
  p += 46 + nameLen + extraLen + cmtLen
}

// ── 解压 ──
function readLocalData (e) {
  const lp = e.lho
  if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error(`局部头签名不符 @${lp} for ${e.name}`)
  const lNameLen = buf.readUInt16LE(lp + 26)
  const lExtraLen = buf.readUInt16LE(lp + 28)
  const start = lp + 30 + lNameLen + lExtraLen
  const raw = buf.subarray(start, start + e.compSize)
  if (e.method === 0) return Buffer.from(raw)
  if (e.method === 8) return zlib.inflateRawSync(raw)
  throw new Error(`不支持的压缩方法 ${e.method} (${e.name})`)
}

fs.mkdirSync(OUT, { recursive: true })
const ruleCount = {}
const written = []
const skipped = []
for (const e of entries) {
  const base = path.basename(e.name)
  if (!base || e.name.endsWith('/')) { skipped.push({ ...e, why: '目录' }); continue }
  ruleCount[e.rule] = (ruleCount[e.rule] || 0) + 1
  // 归一化：去掉顶层 data/ 前缀，保留子目录；拒绝路径穿越
  let rel = e.name.replace(/\\/g, '/')
  if (rel.startsWith('data/')) rel = rel.slice(5)
  const norm = path.normalize(rel)
  if (norm.startsWith('..') || path.isAbsolute(norm)) { skipped.push({ ...e, why: '路径穿越' }); continue }
  const dest = path.join(OUT, norm)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const data = readLocalData(e)
  if (data.length !== e.rawSize) { console.error(`[中止] 尺寸不符 ${e.name}: 期望 ${e.rawSize} 实得 ${data.length}`); process.exit(1) }
  fs.writeFileSync(dest, data)
  written.push({ name: e.name, rel: norm, bytes: data.length, rule: e.rule })
}

console.log(`\n写入 ${written.length} 个文件 → ${OUT}`)
console.log('文件名解码规则命中: ' + Object.entries(ruleCount).map(([k, v]) => `${k}=${v}`).join('  '))
if (skipped.length) console.log(`跳过 ${skipped.length} 项: ` + skipped.map((s) => `${s.name}(${s.why})`).join(', '))

const suspect = written.filter((w) => /\uFFFD/.test(w.rel))
console.log(`\n含 U+FFFD 替换字符的文件名: ${suspect.length} ${suspect.length ? '[!] 解码可能仍有损' : '[OK]'}`)

// 清单落盘（供事后核对原始字节）
const manifest = {
  source: ZIP, sourceBytes: buf.length, extractedAt: new Date().toISOString(),
  entries: entries.map((e) => ({ finalName: e.name, rawNameHex: e.rawNameHex, rule: e.rule, method: e.method, size: e.rawSize })),
  written,
}
fs.writeFileSync(path.join(OUT, '_extract-manifest.json'), JSON.stringify(manifest, null, 2))
console.log('清单: ' + path.join(OUT, '_extract-manifest.json'))

console.log('\n=== 非 ASCII 文件名（核对解码是否正确）===')
for (const w of written.filter((x) => /[^\x00-\x7f]/.test(x.rel))) console.log(`  [${w.rule}] ${w.rel}  ${w.bytes} B`)
