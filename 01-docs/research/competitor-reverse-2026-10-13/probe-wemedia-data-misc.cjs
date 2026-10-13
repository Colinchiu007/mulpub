/**
 * 融媒宝 data 目录中「非分类映射」那几类文件的形态探查。
 * 覆盖：doc/*.csv、media_url_list.txt、media_class_set*.txt、comment_media_js.json、
 *       deepsearchercat.txt、mediadatamgr.ini、explosivearticle|explosivevideo|mediahot|mediaactivity/、
 *       new_user_guide / common_question / software_notify 三个家族的 OEM 变体、
 *       sensitivelibrary.txt（疑似加密）
 * 全部按 GBK/UTF-8 自动判别后读取；只读，不写文件。
 * 用法: node probe-wemedia-data-misc.cjs <dir>
 */
const fs = require('node:fs')
const path = require('node:path')

const DIR = process.argv[2]
const utf8strict = new TextDecoder('utf-8', { fatal: true })
const gbk = new TextDecoder('gbk')
function read (p) {
  const buf = fs.readFileSync(p)
  try { return { text: utf8strict.decode(buf), enc: 'utf-8', buf } } catch { return { text: gbk.decode(buf), enc: 'gbk', buf } }
}

function show (rel, lines = 8, width = 130) {
  const p = path.join(DIR, rel)
  if (!fs.existsSync(p)) { console.log(`\n── ${rel}  【不存在】`); return }
  const { text, enc, buf } = read(p)
  const ls = text.split(/\r?\n/)
  console.log(`\n── ${rel}   (${enc}, ${buf.length} B, ${ls.length} 行)`)
  for (const l of ls.slice(0, lines)) console.log('   ' + l.slice(0, width))
  if (ls.length > lines) console.log(`   ... 余 ${ls.length - lines} 行`)
}

console.log('########## doc/*.csv（数据字典文档）##########')
for (const f of fs.readdirSync(path.join(DIR, 'doc'))) show(path.join('doc', f), 10)

console.log('\n\n########## media_url_list.txt（平台数据接口地址）##########')
show('media_url_list.txt', 40)

console.log('\n\n########## media_class_set*.txt（DOM 选择器/类名集合）##########')
show('media_class_set.txt', 6)
show('media_class_set_new.txt', 6)

console.log('\n\n########## comment_media_js.json ##########')
show('comment_media_js.json', 12)

console.log('\n\n########## deepsearchercat.txt（搜索引擎清单）##########')
show('deepsearchercat.txt', 20)

console.log('\n\n########## mediadatamgr.ini（数据字段映射）##########')
show('mediadatamgr.ini', 40)

console.log('\n\n########## 四类按平台切分的小目录（各自文件数 + 样例）##########')
for (const d of ['explosivearticle', 'explosivevideo', 'mediahot', 'mediaactivity']) {
  const dp = path.join(DIR, d)
  if (!fs.existsSync(dp)) { console.log(`\n── ${d}/ 【不存在】`); continue }
  const fs2 = fs.readdirSync(dp)
  console.log(`\n── ${d}/   共 ${fs2.length} 个文件: ${fs2.join(', ')}`)
  const f0 = fs2[0]
  if (f0) {
    const { text, enc } = read(path.join(dp, f0))
    console.log(`   样例 ${f0} (${enc}):`)
    for (const l of text.split(/\r?\n/).slice(0, 6)) console.log('     ' + l.slice(0, 120))
  }
}

console.log('\n\n########## OEM 变体对照（同一文案的多渠道版本）##########')
for (const base of ['new_user_guide', 'common_question', 'software_notify']) {
  const cands = fs.readdirSync(DIR).filter((f) => f.startsWith(base) && f.endsWith('.txt')).sort()
  console.log(`\n── ${base}: ${cands.join(', ')}`)
  for (const c of cands) {
    const { text, enc, buf } = read(path.join(DIR, c))
    console.log(`   [${c}] ${enc}, ${buf.length} B, ${text.split(/\r?\n/).length} 行  首行: ${(text.split(/\r?\n/)[0] || '').slice(0, 80)}`)
  }
}

console.log('\n\n########## sensitivelibrary.txt（793 KB —— 判定其形态）##########')
{
  const p = path.join(DIR, 'sensitivelibrary.txt')
  const buf = fs.readFileSync(p)
  console.log(`  大小: ${buf.length} B`)
  console.log(`  前 80 字节 hex: ${buf.subarray(0, 80).toString('hex')}`)
  console.log(`  前 120 字节可见: ${buf.subarray(0, 120).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}`)
  const n = Math.min(buf.length, 65536)
  let b64 = 0; let ws = 0
  for (let i = 0; i < n; i++) {
    const c = buf[i]
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2f || c === 0x3d) b64++
    else if (c === 0x0a || c === 0x0d || c === 0x20 || c === 0x09) ws++
  }
  console.log(`  前 64KB 中 base64 字符占比: ${(b64 / n * 100).toFixed(2)}%   空白占比: ${(ws / n * 100).toFixed(2)}%`)
  console.log(`  换行数: ${(buf.toString('latin1').match(/\n/g) || []).length}`)
  console.log(`  是否为 base64（占比>98% 且无换行分行）: ${b64 / n > 0.98 ? '是' : '否'}`)
  console.log('  结论: 该文件不是明文词库 —— 需解密/解码才能取得词条；本报告不尝试破解。')
}
