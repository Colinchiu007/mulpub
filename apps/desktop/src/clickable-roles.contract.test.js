// 非 button 可点击元素的键盘可达性合同（实施方案阶段 4.4 / audit-24 / WCAG 2.1.1 Keyboard）
//
// 三条不变量，都来自本批实测：
//  1) 域清点由模板扫描得出，不按类名或组件名猜。**必须排除渲染原生控件的组件**
//     （el-button / router-link / UiButton —— 后者实测 `tag` 默认值就是 "button"），
//     否则第一版探针把 109 个它们算成"缺口"，域虚高 3 倍，判据就成了噪音。
//  2) 已补 role="button" 的元素**不得有可见的可聚焦后代**：button 是 leaf 角色，
//     子树会被呈现为 presentational —— 本批正是这条把我自己的错误修法拦下来
//     （CreateView 两个上传区里有可见「移除」按钮、CreatorMonitor 列表项里有 3 个可见按钮，
//     给它们加 role 等于把那些按钮从无障碍树上抹掉，比原状更差）。
//  3) 欠账台账只能缩小，且每条必须带原因；新出现的未登记站点当场红。
//
// 判据域与规模都打印，扫描退化（域为空/骤降）会由下界断言抓住。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// 本文件就在 src/ 下：SRC 即 __dirname（上一版拼成 src/src 时是响亮 ENOENT，不是静默扫空）
const SRC = __dirname

// 渲染原生可聚焦控件的元素/组件（不算缺口）
const NATIVE = new Set(['button', 'a', 'input', 'label', 'select', 'summary'])
const RENDERS_NATIVE = /^(UiButton|RouterLink|router-link|el-[a-z-]+|component)$/

// ⛔ 本批核定登记（由本文件扫描当场得出，键 = 文件|标签|@click 表达式）
const LEDGER = [
  { key: "/components/PersonalFormDialog.vue|div|emit('close')",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/components/UpgradeModal.vue|div|emit('close')",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/components/ViralFormDialog.vue|div|emit('close')",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/views/AutomationView.vue|div|closeDialog",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/views/video-creation/ErrorDialog.vue|div|$emit('close')",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。" },
  { key: "/components/PodcastScriptEntry.vue|div|onCancel",
    reason: "遮罩层的\"点击空白处关闭\"，不是操作控件：给它 role=\"button\" 会把整个对话框子树呈现为 presentational（对话框内的输入与按钮全部从 a11y 树消失）。键盘等价物是 Esc 关闭 + 焦点陷阱（浮层互斥合同已覆盖挂起/恢复）。 另记一处真实待办：这里用的是 @click 而不是 @click.self（其余四例都是 .self），意味着点击对话框内部会冒泡触发取消 —— 那是行为缺陷，不属本判据域，已单独登记进执行记录。" },
  { key: "/components/ViralLibraryTable.vue|th|sortBy('likes')",
    reason: "th 承载列名与排序状态（aria-sort），给它 role=\"button\" 会剥夺单元格语义、破坏表格读法；正解是在 th 内放一个真 <button> 承载排序点击，属结构改造不是加属性。" },
  { key: "/components/ViralLibraryTable.vue|th|sortBy('collections')",
    reason: "th 承载列名与排序状态（aria-sort），给它 role=\"button\" 会剥夺单元格语义、破坏表格读法；正解是在 th 内放一个真 <button> 承载排序点击，属结构改造不是加属性。" },
  { key: "/components/ViralLibraryTable.vue|th|sortBy('comments')",
    reason: "th 承载列名与排序状态（aria-sort），给它 role=\"button\" 会剥夺单元格语义、破坏表格读法；正解是在 th 内放一个真 <button> 承载排序点击，属结构改造不是加属性。" },
  { key: "/components/ViralLibraryTable.vue|th|sortBy('like_collect_ratio')",
    reason: "th 承载列名与排序状态（aria-sort），给它 role=\"button\" 会剥夺单元格语义、破坏表格读法；正解是在 th 内放一个真 <button> 承载排序点击，属结构改造不是加属性。" },
  { key: "/views/ReplayTimeline.vue|h3|showEventList = !showEventList",
    reason: "标题作为列表折叠头：role=\"button\" 会失去 heading 语义（读屏靠 h 级跳读页面结构）。正解是 h3 内放 button 并保留标题层级。" },
  { key: "/views/CreateView.vue|div|$refs.pipelineFileInput?.click()",
    reason: "该上传区内部有**可见**的「移除」按钮（实测 nestedVisible=1）。给它 role=\"button\" 会让那些按钮从 a11y 树消失 —— 本批正是这条判据把我自己的错误修法拦下来并撤销的。正解是把「选择文件」提为区内显式 <button>，遮罩区保持非控件。" },
  { key: "/views/CreateView.vue|div|$refs.pipelineAudioInput?.click()",
    reason: "该上传区内部有**可见**的「移除」按钮（实测 nestedVisible=1）。给它 role=\"button\" 会让那些按钮从 a11y 树消失 —— 本批正是这条判据把我自己的错误修法拦下来并撤销的。正解是把「选择文件」提为区内显式 <button>，遮罩区保持非控件。" },
]

const CLICK_RE = /@click((?:\w+\.\w+|\.\w+)*)="((?:[^"\\]|\\.)*)"/
const INTERACTIVE_RE = /<(button|a|input|select|textarea|router-link|RouterLink|UiButton|el-button)\b([^>]*)?>/g

function vueFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.vue')) out.push(p)
    }
  }
  walk(dir)
  return out
}

/** 从 idx 行开始的开始标签全文（引号感知；引号内内容原样保留 —— 属性值就是判据要读的表达式） */
function startTag(lines, idx) {
  let joined = ''
  let inQuote = null
  for (let i = idx; i < Math.min(idx + 40, lines.length); i++) {
    const l = lines[i] + '\n'
    for (let c = 0; c < l.length; c++) {
      const ch = l[c]
      joined += ch
      if (inQuote) { if (ch === inQuote) inQuote = null; continue }
      if (ch === '"' || ch === "'") { inQuote = ch; continue }
      if (ch === '>') return { joined, endLine: i }
    }
  }
  throw new Error(`开始标签未闭合（行 ${idx + 1}）`)
}

function directBody(lines, endLine, tag, selfLineIdx) {
  const closeRe = new RegExp('</' + tag + '\\s*>')
  let body = ''
  for (let i = endLine; i < Math.min(endLine + 80, lines.length); i++) {
    const m = closeRe.exec(lines[i])
    if (m && i !== selfLineIdx) { body += lines[i].slice(0, m.index); break }
    body += lines[i] + '\n'
  }
  return body
}

function isHidden(attrs) {
  return /type="hidden"/.test(attrs) || /display:\s*none/.test(attrs) || /v-show="false"/.test(attrs)
}

function scan() {
  const sites = []
  for (const abs of vueFiles(SRC)) {
    const rel = '/' + path.relative(SRC, abs).replace(/\\/g, '/')
    const lines = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').split('\n')
    const tplEnd = lines.findIndex((l) => l.includes('</template>'))
    if (tplEnd <= 0) continue
    // 开始标签可出现在行中任意位置（同一行常有兄弟元素），所以扫整行而非只认行首
    for (let i = 0; i < tplEnd; i++) {
      const tagRe = /<([A-Za-z][\w.-]*)(?=[\s/>])/g
      let m
      while ((m = tagRe.exec(lines[i]))) {
        const tag = m[1]
        const lower = tag.toLowerCase()
        if (NATIVE.has(lower) || RENDERS_NATIVE.test(tag)) continue
        const idx = i
        let joined
        try { joined = startTag(lines, idx).joined } catch { continue }
        // 必须是"从本行这个位置起"的标签：startTag 从行首起算时会有偏差，故用切片校正
        const fromCol = lines[idx].slice(m.index)
        let joined2
        try { joined2 = startTag([fromCol, ...lines.slice(idx + 1)], 0).joined } catch { continue }
        joined = joined2
        if (tag !== /<([A-Za-z][\w.-]*)/.exec(joined)[1]) continue
        const cm = CLICK_RE.exec(joined)
        if (!cm) continue
        const attrs = joined.replace(/<[^>]*?[A-Za-z][\w.-]*/, '')
        const hasRole = /role="button"/.test(joined)
        const hasTab = /:?\btabindex=/.test(joined)
        const hasKey = /@key(down|up)/.test(joined)
        let nestedVisible = 0
        if (hasRole) {
          const endLine = startTag(lines, idx).endLine
          const body = directBody(lines, endLine, tag, idx)
          let n
          INTERACTIVE_RE.lastIndex = 0
          while ((n = INTERACTIVE_RE.exec(body))) if (!isHidden(n[2] || '')) nestedVisible++
        }
        sites.push({
          key: `${rel}|${tag}|${cm[2].slice(0, 40)}`,
          file: rel, tag, line: idx + 1, expr: cm[2],
          hasRole, hasTab, hasKey, nestedVisible,
          selfOnly: /@click\.self/.test(joined),
        })
      }
    }
  }
  return sites
}

describe('非 button 可点击元素的键盘可达性（阶段 4.4 / WCAG 2.1.1）', () => {
  const sites = scan()
  const fixed = sites.filter((s) => s.hasRole && s.hasTab && s.hasKey)
  const gaps = sites.filter((s) => !(s.hasRole && s.hasTab && s.hasKey))
  const gapKeys = [...new Set(gaps.map((g) => g.key))].sort()
  console.log(`[clickable-roles] 站点=${sites.length} 已补全=${fixed.length} 仍缺=${gapKeys.length}（去重键）`)

  it('扫描域非空且有规模下界（扫描器退化时"零缺口"读起来像全绿）', () => {
    expect(sites.length).toBeGreaterThanOrEqual(30)
    expect(fixed.length).toBeGreaterThanOrEqual(15)
  })

  it('已补 role="button" 的元素不得含可见可聚焦后代（button 是 leaf 角色）', () => {
    const bad = fixed.filter((s) => s.nestedVisible > 0)
    expect(bad, `这些站点会把内部按钮从 a11y 树抹掉：${bad.map((b) => `${b.file}:${b.line}(nested=${b.nestedVisible})`).join(', ')}`).toEqual([])
  })

  it('键盘处理必须逐字镜像鼠标处理（漏一个修饰键即行为分裂）', () => {
    const offenders = []
    for (const s of fixed) {
      const lines = fs.readFileSync(path.join(SRC, s.file), 'utf8').replace(/\r\n/g, '\n').split('\n')
      const joined = startTag(lines, s.line - 1).joined
      const enter = /@keydown\.enter(?:\.prevent)?="([^"]*)"/.exec(joined)
      const space = /@keydown\.space(?:\.prevent)?="([^"]*)"/.exec(joined)
      if (!enter || !space) offenders.push(`${s.file}:${s.line} 缺 Enter 或 Space`)
      else if (enter[1] !== s.expr || space[1] !== s.expr) offenders.push(`${s.file}:${s.line} keydown 表达式与 @click 不一致`)
    }
    expect(offenders, offenders.join(' | ')).toEqual([])
  })

  it('tabindex 不得为负（负值把元素移出 Tab 序列，等于没有键盘入口）', () => {
    for (const s of fixed) {
      const lines = fs.readFileSync(path.join(SRC, s.file), 'utf8').replace(/\r\n/g, '\n').split('\n')
      const joined = startTag(lines, s.line - 1).joined
      expect(joined, `${s.file}:${s.line} 应含 tabindex="0"`).toMatch(/tabindex="0"/)
    }
  })

  it('每一处未补全的站点都必须在台账里带原因登记，且台账不得陈旧', () => {
    const registered = LEDGER.map((l) => l.key).sort()
    const missing = gapKeys.filter((k) => !registered.includes(k))
    const stale = registered.filter((k) => !gapKeys.includes(k))
    console.log(`[clickable-roles] 未登记=${missing.length} 陈旧=${stale.length}`)
    if (missing.length) console.log('[clickable-roles] 待登记键：\n  ' + missing.join('\n  '))
    expect(missing, `新增未登记的键盘可达缺口：${missing.join(' , ')}`).toEqual([])
    expect(stale, `台账里这些键已不存在（站点被修好或改名），必须同步删除：${stale.join(' , ')}`).toEqual([])
  })

  it('台账规模上界（只能缩小；本批实测 gap=13 / 已补=18）', () => {
    expect(LEDGER.length).toBeLessThanOrEqual(13)
    expect(gapKeys.length).toBeLessThanOrEqual(LEDGER.length)
  })

  it('台账每条必须给出可判读的原因，且原因不得是空话', () => {
    for (const l of LEDGER) {
      expect(l.reason, `台账项缺少原因：${l.key}`).toBeTruthy()
      expect(l.reason.length).toBeGreaterThan(20)
    }
  })
})
