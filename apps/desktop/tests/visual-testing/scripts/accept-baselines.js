/**
 * 视觉基线更新：把本轮 pixel 测试产出的 `-current.png` 渲染接受为新的基线。
 *
 * 为什么需要它：`test-runner.js` 的 UPDATE_BASELINE 只在**基线缺失**时创建，
 * 基线已存在时只做对比并判红 —— 所以「有意的视觉变更」无法靠 env 覆盖，
 * 只能由人工审核渲染结果后显式接受。
 *
 * 用法：node tests/visual-testing/scripts/accept-baselines.js [--theme=light|dark]
 *
 * 安全：只覆盖 base-screenshots 下**同名**的 PNG，不新增、不删除；
 *       源文件缺失则跳过并报告，不静默通过。
 */
const fs = require('node:fs')
const path = require('node:path')

const SHOTS_DIR = path.resolve(__dirname, '../screenshots')
const BASE_DIR = path.resolve(__dirname, '../base-screenshots')

/**
 * 把渲染文件名安全地嵌进正则：先转义所有正则元字符，
 * 否则文件名里的 `.`/`+`/`(` 等会被当成模式（CCG 评审 i6）。
 */
function escapeRegExp (value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function main () {
  const themeArg = (process.argv.find(a => a.startsWith('--theme=')) || '').split('=')[1]
  const theme = themeArg || 'light'
  const suffix = theme === 'dark' ? '-dark' : ''

  const files = fs.readdirSync(SHOTS_DIR)
    .filter(f => f.endsWith(`${suffix}-current.png`))
    // 亮色通道必须排除暗色渲染：`x-dark-current.png` 同样以 `-current.png` 结尾，
    // 不过滤会把暗色渲染当成亮色基线写进去（表现为基线与 CI 渲染 90%+ 漂移）。
    .filter(f => theme === 'dark' || !f.includes('-dark-current.png'))
    .sort()

  if (files.length === 0) {
    console.error(`没有找到 ${suffix}-current.png 渲染，先跑 pixel 测试`)
    process.exitCode = 1
    return
  }

  let updated = 0
  let missing = 0
  for (const render of files) {
    // `publish-history-dark-current.png` → 基线名 `publish-history-dark.png`
    // 注意保留 suffix 本身：视图名 + 主题后缀是基线名的一部分，
    // 替换成 `.png` 会把 `-dark` 一起吃掉（暗色基线被写成亮色名）。
    const target = render.replace(new RegExp(`${escapeRegExp(suffix)}-current\\.png$`), `${suffix}.png`)
    const source = path.join(SHOTS_DIR, render)
    const destination = path.join(BASE_DIR, target)
    if (!fs.existsSync(source)) {
      console.log(`  跳过（渲染缺失）：${target}`)
      missing += 1
      continue
    }
    fs.copyFileSync(source, destination)
    updated += 1
    console.log(`  基线已接受：${target}`)
  }
  console.log(`\n${theme} 基线接受完成：更新 ${updated} 个，跳过 ${missing} 个`)
}

main()
