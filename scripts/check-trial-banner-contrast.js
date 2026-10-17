#!/usr/bin/env node
/**
 * 对比度自检（dash-full-entitlement / fix-dashboard-trial-banner）
 *
 * 用途：CI Gate 7c（暗色文本对比度）跑一次要 4 分钟且要真浏览器，本地排查太慢。
 * 这里用与 Gate 7c 相同的 WCAG 相对亮度公式，直接校验本次改动涉及的色对，
 * 改色前先跑它 —— 不必等 CI 才知道达标与否。
 *
 * 判据：正文/UI 文本 ≥ 3:1（与 contrast-audit.js 的阈值一致）
 */
function srgbToLinear (v) {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
function luminance ([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}
function contrast (a, b) {
  const l1 = luminance(a)
  const l2 = luminance(b)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}
const hex = (h) => {
  const s = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
}

// 本次改动的色对（改动前的旧值一并列出，作为回归对照）
const CASES = [
  // 当前方案：实底 + 白字（对主题切换免疫的两种底色都达标）
  { name: '亮色 #b91c1c 底 + 白字', fg: '#ffffff', bg: '#b91c1c', min: 3 },
  { name: '亮色 hover #991b1b 底 + 白字', fg: '#ffffff', bg: '#991b1b', min: 3 },
  { name: '暗色（tokens 覆盖后）#c2410c 底 + 白字', fg: '#ffffff', bg: '#c2410c', min: 3 },
  // 回归对照：以下三档是**修复前**两轮的真实失败形态，锁在此处防止后人改回去。
  // 每条都标注它被 CI Gate 7c 实测抓到的 ratio。
  { name: '[回归·第1轮] 暗色 #c2410c 字 vs #c2410c 底（实测 1:1，文字隐形）', fg: '#c2410c', bg: '#c2410c', expectBelow: 1.01 },
  { name: '[回归·第2轮] 亮色 #b91c1c 字 落在 暗色 #c2410c 底（实测 1.25）', fg: '#b91c1c', bg: '#c2410c', expectBelow: 3 },
  { name: '[回归·原值] 亮色 #f56c6c 字 vs #f3f0ff 底（实测 2.58，不达标）', fg: '#f56c6c', bg: '#f3f0ff', expectBelow: 3 },
]

let failed = 0
console.log('=== 对比度自检（阈值 3:1）===')
for (const c of CASES) {
  const ratio = contrast(hex(c.fg), hex(c.bg))
  const r = Math.round(ratio * 100) / 100
  if (c.expectBelow !== undefined) {
    const ok = ratio < c.expectBelow
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${c.name}: ${r}:1（预期 < ${c.expectBelow}）`)
  } else {
    const ok = ratio >= c.min
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${c.name}: ${r}:1（需 ≥ ${c.min}）`)
  }
}
console.log(failed === 0 ? '\nPASS：全部符合预期' : `\nFAIL：${failed} 条不符合预期`)
process.exit(failed === 0 ? 0 : 1)
