import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import zh from '@/locales/zh'
import en from '@/locales/en'

const GLOSSARY_FILE = path.resolve(__dirname, '../../../../01-docs/i18n-glossary.md')

const SEPARATOR_ROW = /^\|[-\s|]+$/

function isSeparatorRow (line) {
  const t = String(line).trim()
  // 分隔行必须"只有 | - 空格"且至少含一个 - —— 否则 `|   |` 这种空单元格行会被误判成表头下界
  return SEPARATOR_ROW.test(t) && t.includes('-')
}

/**
 * 解析术语表。
 *
 * ⛔ 只收 **`| zh | en | … |` 那一张（或几张）表**，其余 markdown 表一律不读。
 * 旧实现按"任何以 | 开头、第二列不是 `zh` 的行"当术语对，于是 2026-10-19 有人在词典里加了一张
 * **说明表**（表头是 `| 位置 | 现值 | 语义 | 处置 |`），表头自己就变成了一条术语「位置 / 现值」，
 * 判据当场把它送去 locale 里找 —— zh 侧有"位置"这个词、en 侧没有"现值"，于是 `QG Desktop Shards` 红。
 * 那是**判据的输入选错了**，不是内容错：说明表不该被当成术语，而写文档的人也无法从文件里看出
 * "这张表会被测试读成术语对"。
 *
 * 新口径的三条硬约束（都有对应锁，见下面 describe）：
 * ① 表头 = "下一行是分隔行"的那一行；只有表头前两列是 `zh` / `en` 时才进入术语模式；
 * ② 遇到非表格行立刻退出术语模式（术语表被小标题切断也算断开）；
 * ③ 术语模式之外收集到的行**一律丢弃**，所以任何说明表、目录表都不会再污染判定域。
 */
function parseGlossary (content) {
  const lines = content.split('\n')
  const entries = []
  let inTermTable = false
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed.startsWith('|')) {
      inTermTable = false
      continue
    }
    const cells = trimmed.split('|').map(c => c.trim())
    if (isSeparatorRow(trimmed)) continue
    if (isSeparatorRow(lines[i + 1] || '')) {
      // 本行是表头：按前两列决定这张表是不是术语表
      inTermTable = cells[1] === 'zh' && cells[2] === 'en'
      continue
    }
    if (!inTermTable) continue
    const zhTerm = cells[1]
    const enTerm = cells[2]
    if (!zhTerm || !enTerm) continue
    entries.push({ zh: zhTerm, en: enTerm })
  }
  return entries
}

function allStringValues (node, out = []) {
  for (const value of Object.values(node)) {
    if (typeof value === 'string') out.push(value)
    else if (value && typeof value === 'object') allStringValues(value, out)
  }
  return out
}

describe('多语言术语词典（i18n-content-sync L3）', () => {
  const content = fs.readFileSync(GLOSSARY_FILE, 'utf8')
  const entries = parseGlossary(content)

  it('术语词典至少登记了核心产品名词', () => {
    expect(entries.length).toBeGreaterThan(0)
    const zhTerms = entries.map(e => e.zh)
    expect(zhTerms).toContain('故事讲述')
    expect(zhTerms).toContain('启动流水线')
  })

  it('词典中的每个术语在 zh/en locale 中出现状态一致（防止只改中文没改英文）', () => {
    const zhValues = allStringValues(zh)
    const enValues = allStringValues(en)
    for (const entry of entries) {
      const zhUsed = zhValues.some(v => v.includes(entry.zh))
      // en 侧不区分大小写（兼容 'pipeline' / 'Pipeline' 等用法差异）
      const enUsed = enValues.some(v => v.toLowerCase().includes(entry.en.toLowerCase()))
      expect(zhUsed, `术语「${entry.zh} / ${entry.en}」在 zh locale 中${zhUsed ? '已' : '未'}出现，但 en locale ${enUsed ? '已' : '未'}出现——zh/en 出现状态不一致，请成对同步`).toBe(enUsed)
    }
  })

  // ── 解析器自身的合同（2026-10-19 由 CI 当场抓出，见 parseGlossary 上方注释）──
  it('判定域只含术语表：真实词典里不得混进说明表的行', () => {
    const zhs = entries.map(e => e.zh)
    // 事故现场：说明表表头 `| 位置 | 现值 | 语义 | 处置 |` 被当成一条术语「位置 / 现值」
    expect(zhs).not.toContain('位置')
    expect(entries.map(e => e.en)).not.toContain('现值')
    // 通用形态判据：术语列是**词**，不是代码单元或带箭头的迁移说明
    for (const e of entries) {
      expect(e.zh.includes('`'), `术语列出现代码单元：${e.zh}`).toBe(false)
      expect(e.zh.includes('→'), `术语列出现迁移说明：${e.zh}`).toBe(false)
    }
  })

  it('解析器规模下界（防止解析退化把判定域清空——空域的"零欠账"是假绿）', () => {
    expect(entries.length).toBeGreaterThanOrEqual(100)
  })

  it('解析器行为合同：只认 `zh|en` 表头，非表格行即退出术语模式', () => {
    const fixture = [
      '| zh | en | 机器 ID |',
      '|----|----|----|',
      '| 甲 | Alpha | a.id |',
      '',
      '## 说明小节',
      '',
      '| 位置 | 现值 | 语义 | 处置 |',
      '|---|---|---|---|',
      '| 某文件 | 首页 | 只是说明 | 保留 |',
      '',
      '| zh | en |',
      '|----|----|',
      '| 乙 | Beta |',
      '| 丙 | Gamma |',
      '普通段落，不是表',
      '| 丁 | Delta |',
    ].join('\n')
    // 两张术语表都要读到（术语表可以有多张），说明表整张排除，
    // 而"非表格行"之后的裸 | 行（| 丁 |）不再属于任何表 ⇒ 不收
    expect(parseGlossary(fixture)).toEqual([
      { zh: '甲', en: 'Alpha' },
      { zh: '乙', en: 'Beta' },
      { zh: '丙', en: 'Gamma' },
    ])
  })
})
