/**
 * 融媒宝 data.zip 解出物的编码判定 + 结构概览。
 *
 * 背景：这些 .txt 是 GBK 编码（`media_url_list.txt` 的注释实测渲染成 `//΢⟨U+FFFD×1⟩Ź⟨U+FFFD×2⟩ں⟨U+FFFD×1⟩`），
 * 直接在 UTF-8 下读会得到乱码，从而误判「文件没内容」或「结构不明」。
 *
 * 本脚本对每个文件做**非破坏性**编码判定：
 *   * 先按严格 UTF-8 解码；成功且无替换字符 ⇒ utf-8
 *   * 失败/有替换 ⇒ 按 GBK 解码，并统计替换字符数
 * 只读，不写任何文件。
 * 用法: node probe-wemedia-data-encoding.cjs <dir>
 */
const fs = require('node:fs')
const path = require('node:path')

const DIR = process.argv[2]
if (!DIR) { console.error('用法: node probe-wemedia-data-encoding.cjs <dir>'); process.exit(2) }

const utf8strict = new TextDecoder('utf-8', { fatal: true })
const gbk = new TextDecoder('gbk')

function sniff (buf) {
  // BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { enc: 'utf-8-bom', text: utf8strict.decode(buf.subarray(3)) }
  try {
    const t = utf8strict.decode(buf)
    // 严格 UTF-8 成功但仍可能"碰巧"——高字节占比低时更可信
    return { enc: 'utf-8', text: t }
  } catch {
    const t = gbk.decode(buf)
    return { enc: 'gbk', text: t }
  }
}

function looksBase64 (buf) {
  // 只看前 4KB：base64 字符集占比 + 无空白 + 长度是 4 的倍数
  const n = Math.min(buf.length, 4096)
  let ok = 0
  for (let i = 0; i < n; i++) {
    const c = buf[i]
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2f || c === 0x3d || c === 0x0a || c === 0x0d) ok++
  }
  return ok / n > 0.98 && buf.length > 1024
}

const files = []
;(function walk (d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else files.push(p)
  }
})(DIR)

const rows = []
for (const f of files) {
  const rel = path.relative(DIR, f)
  if (rel === '_extract-manifest.json') continue
  const buf = fs.readFileSync(f)
  const isBin = /\.(gif|png|jpg)$/i.test(rel)
  const b64 = !isBin && looksBase64(buf)
  const { enc, text } = isBin ? { enc: 'binary', text: '' } : sniff(buf)
  const repl = (text.match(/\uFFFD/g) || []).length
  const lines = text ? text.split(/\r?\n/) : []
  rows.push({ rel, bytes: buf.length, enc, b64, repl, lines: lines.length, text, linesArr: lines })
}

console.log('=== 编码分布 ===')
const byEnc = {}
for (const r of rows) byEnc[r.enc] = (byEnc[r.enc] || 0) + 1
for (const [k, v] of Object.entries(byEnc).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${v} 个`)

console.log('\n=== 非 UTF-8 的文件（需按 GBK 读）===')
for (const r of rows.filter((x) => x.enc !== 'utf-8' && x.enc !== 'utf-8-bom' && x.enc !== 'binary')) console.log(`  [${r.enc}] ${r.rel}  ${r.bytes} B  替换字符=${r.repl}`)

console.log('\n=== 疑似 base64/加密的文件（内容不可直读）===')
for (const r of rows.filter((x) => x.b64)) console.log(`  ${r.rel}  ${(r.bytes / 1024).toFixed(1)} KB`)

console.log('\n=== 可直读文本文件的形态（前 3 行，按 GBK 正确解码）===')
const textish = rows.filter((r) => !r.b64 && r.enc === 'gbk' && r.bytes > 200 && r.bytes < 20000)
for (const r of textish.slice(0, 14)) {
  console.log(`\n  ── ${r.rel}  (${r.enc}, ${r.lines} 行, ${r.bytes} B)`)
  for (const l of r.linesArr.slice(0, 3)) console.log('     ' + l.slice(0, 150))
}

console.log('\n=== 分类映射文件的体量排行（categortmap / subcategort）===')
const maps = rows.filter((r) => /categort|subcategort/i.test(r.rel))
for (const r of maps.sort((a, b) => b.bytes - a.bytes).slice(0, 25)) {
  const sample = (r.linesArr.find((l) => l.trim()) || '').slice(0, 60)
  console.log(`  ${(r.bytes / 1024).toFixed(1).padStart(7)} KB  ${String(r.lines).padStart(4)} 行  ${r.rel.padEnd(38)} 首行: ${sample}`)
}
console.log(`  ... 共 ${maps.length} 个分类映射文件`)
