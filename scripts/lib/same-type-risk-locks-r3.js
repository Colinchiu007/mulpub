/**
 * same-type-risk-locks-r3.js — 第三批「竞品缺陷同型风险」锁（R7 + R11）
 *
 * 来源：`01-docs/research/competitor-reverse-2026-10-13/derived/竞品缺陷同型风险清单.md` §2。
 * 第三批同时兑现 CCG 两轮评审的采纳承诺：共享 mask/matchBrave 抽为 `scripts/lib/code-mask.js`。
 *
 * ## R7 后缀 ↔ mime 同源（竞品 X-C2：选 JPG 下载内容却是 PNG）
 * 实测本仓有 4 处独立 mime↔ext 映射字面量（见 `scripts/lib/image-mime.js` 头注释）。
 * 已抽单一真源 `image-mime.js`；本锁锁「**不允许出现新的独立映射表**」：
 *   同一对象字面量内同时出现 `image/<fmt>` 值与对应 ext 键/值 ⇒ 红（新映射表）。
 * 豁免：`scripts/lib/image-mime.js` 本体（真源）、`scripts/**` 测试文件。
 * 配套行为锁：`scripts/image-mime.test.js` 锁真源表自身的映射正确性（jpg/jpeg 同 mime、mime→ext 往返）。
 *
 * ## R11 模块级状态累积（竞品 X-8 型：分页引擎单例 itemHeights 只增不清）
 * 形状：模块顶层 `new Map()/new Set()` + 存在 `.set(/.add(` 写 + **无任何 `.delete(/.clear(`**。
 * 判据（与 R5 的 visible 纪律一致——宽判据假阳多）：
 *   命中 ⇒ **出声不拦截**（审计面）。理由（侦察实证）：
 *   - 4 个样本里 3 个写清配对完整；
 *   - 唯一「只增」的 `auth-partition-reclaim.js` 两集合，注释明说「进程级、随会话增长、量级可忽略」
 *     —— **有意的只增语义**（豁免清单/已回收记录）。
 *   R11 的价值是把这类集合**显式化**：新增只增集合时审计面会出现，逼作者写一句「为什么只增」的注释。
 *
 * 纯函数；共享屏蔽由 `scripts/lib/code-mask.js` 提供（第三批兑现抽取承诺）。
 */

'use strict'

const { maskNonCode, matchBrace } = require('./code-mask')

/**
 * R7 豁免清单（三类，各有理由）：
 * ① 真源自身：packages/shared-utils/src/image-mime.js（FORMATS 表就是唯一登记处，扫它=自我报警）；
 * ② scripts/lib/image-mime.js（re-export 桥）；测试文件；
 * ③ **api-publish-engine 架构豁免**：该包是「可独立打包的零 workspace 依赖运行时」
 *    （category-resolver.js 头注释的约束；Docker runner 单独 COPY，无 workspace node_modules），
 *    不能 require shared-utils 真源 ⇒ media-fetch.js 的 mime→ext 表保持本文件。登记非漏改；
 *    失效模式 fail-closed：若该包未来解除零依赖约束，删掉本条即恢复扫描。
 */
const R7_ZERO_DEPS_EXEMPT = ['packages/api-publish-engine/src/publish/media-fetch.js']
const R7_EXEMPT = (p) => p === 'packages/shared-utils/src/image-mime.js' ||
  p === 'scripts/lib/image-mime.js' ||
  /(^|\/)(test|tests|__tests__)\//.test(p) ||
  /\.(test|spec)\.[cm]?[jt]s$/.test(p) ||
  R7_ZERO_DEPS_EXEMPT.includes(p)

const FMT_NAMES = ['jpeg', 'jpg', 'png', 'webp']

/**
 * R7：同对象字面量内同时出现 image/<fmt> 与对应 ext 字面量 ⇒ 独立映射表，红。
 * 判据实现：找 `{...}` 字面量（masked 文本配对），体内容同时满足
 *   ① 含 `image/jpeg|jpg`（正则文本） ② 含 `.jpg`/`'.jpg'`（ext 文本）
 * 即判（jpg/jpeg 视为同一族，避免重复报）。
 */
function scanIndependentMimeMaps (sources) {
  const findings = []
  const stats = { objectsScanned: 0, hits: 0 }
  for (const src of sources) {
    const { path, text } = src
    if (R7_EXEMPT(path)) continue
    // i3（CCG 416338fc）：配对必须在 mask 版文本上做（字符串内的花括号会让配对错位）；
    // i1（CCG 15e5134a）：mask 版**不得信任调用方的 _masked** —— scanAllR3 为 R7 传入的
    //   _masked 已被覆盖成 keep 版（R11 需要看字面量），复用等于把配对语义外包出去。
    //   故 R7 自己算 mask 版（每文件一次，成本可接受）。
    const maskedPair = maskNonCode(text)
    const maskedKeep = src._maskedKeep || maskNonCode(text, { strings: 'keep' })
    const objRe = /\{/g
    let m
    while ((m = objRe.exec(maskedPair)) !== null) {
      const close = matchBrace(maskedPair, m.index)
      if (close === -1 || close - m.index > 2000) continue
      const body = maskedKeep.slice(m.index, close + 1)
      stats.objectsScanned++
      // image/jpg 是 media-downloader 的历史兼容条目（非规范 mime，真实平台回包出现过），
      //   单独出现不构成「独立映射表」信号 —— 判据只认规范名 image/jpeg（jpe?g 会在 jpg 处误命中）。
      const hasJpegMime = /image\/jpeg/.test(body)
      const hasJpegExt = /['"`]?\.jpe?g['"`]?\s*:|['"`]\.jpe?g['"`]/.test(body)
      const hasJpgMimeCompat = /image\/jpg/.test(body)
      const hasPngPair = /image\/png/.test(body) && /['"`]?\.png['"`]?\s*:|['"`]\.png['"`]/.test(body)
      // i3（CCG 15e5134a）：png 信号必须独立判定 —— jpg 兼容条目只抑制 jpeg 族；
      //   实测「png 表 + image/jpg 别名」被旧条件整表抑制（假阴）。
      if ((hasJpegMime && hasJpegExt) || hasPngPair) {
        stats.hits++
        findings.push({
          rule: 'R7-independent-mime-map',
          path,
          detail: '出现独立的 mime↔扩展名字面量映射（应改用 @multi-publish/shared-utils/image-mime 单一真源）',
        })
      }
    }
  }
  return { ok: findings.length === 0, findings, stats }
}

/** 模块级可变集合声明（顶层 const NAME = new Map/Set）。 */
const MODULE_SET_RE = /(?:^|\n)const\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(Map|Set)\s*\(\s*\)/g

/**
 * R11：模块级 Map/Set 有写（.set(/.add() 无清（.delete(/.clear()）⇒ 出声不拦截（审计面）。
 * 只统计「模块顶层」（声明行缩进为 0）——函数内局部集合不在审计面。
 */
function scanModuleStateGrowth (sources) {
  const visible = []
  const stats = { moduleSets: 0, writeOnly: 0 }
  for (const src of sources) {
    const { path, text } = src
    const masked = src._masked || maskNonCode(text)
    MODULE_SET_RE.lastIndex = 0
    let m
    while ((m = MODULE_SET_RE.exec(masked)) !== null) {
      const declLine = masked.slice(0, m.index).split('\n').pop()
      if (/^\s/.test(declLine)) continue        // 缩进的声明不是模块顶层
      stats.moduleSets++
      const name = m[1]
      // ⚠ tail 必须从声明到文件尾：模块级集合天然服务全文件。不能传 matchBrace ——
      //   声明结尾是 `)`，从那里配对会把「下一个函数体」当范围，把文件里后面的 delete 全截掉
      //   （夹具当场抓出：写清配对完整的集合被误报为只写）。
      const tail = masked.slice(m.index)
      // i4（CCG 416338fc）：清写检测按「模块级名字」的成员调用精确匹配 ——
      //   整文件盲搜会把「局部同名 Map 的 tmp.delete()」误判为模块级清理（实测假阴成立）。
      const memberRe = new RegExp('\\b' + name + '\\.(set|add|delete|clear)\\(', 'g')
      let mm3
      let writes = false
      let clears = false
      while ((mm3 = memberRe.exec(tail)) !== null) {
        if (mm3[1] === 'set' || mm3[1] === 'add') writes = true
        else clears = true
      }
      if (writes && !clears) {
        stats.writeOnly++
        visible.push({
          path,
          name,
          kind: 'module-state-write-only',
          detail: '模块级 ' + m[2] + '「' + name + '」有写无清（若为有意的只增语义，请在该声明上方写明理由注释）',
        })
      }
    }
  }
  return { ok: true, findings: [], visible, stats }
}

/** 第三批两条一起跑（CLI 汇入总结果）。 */
function scanAllR3 (sources) {
  const prepared = sources.map((s) => ({
    ...s,
    _masked: s._masked || maskNonCode(s.text),
    _maskedKeep: s._maskedKeep || maskNonCode(s.text, { strings: 'keep' }),
  }))
  const r7 = scanIndependentMimeMaps(prepared.map((s) => ({ ...s, _masked: s._maskedKeep })))
  const r11 = scanModuleStateGrowth(prepared)
  return {
    ok: r7.ok,
    findings: r7.findings,
    visible: r11.visible,
    stats: { r7: r7.stats, r11: r11.stats },
  }
}

module.exports = { scanIndependentMimeMaps, scanModuleStateGrowth, scanAllR3, R7_EXEMPT }
