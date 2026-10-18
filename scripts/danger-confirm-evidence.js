'use strict'
/**
 * danger-confirm-evidence.js —— 给 scripts/danger-confirm-debt.json 的每条豁免补现场证据
 *
 * 为什么要有执行体：登记表要求「A 档（本文件看不到确认）必须写 confirmed_by」。
 * 那句去向只能靠读代码得到；没有这个入口，下一个会话要么凭函数名猜（把声明当契约钉成 Bug），
 * 要么整条登记免检。本脚本对每个调用点打印：所在函数体、该文件里的全部确认痕迹（带行号）。
 *
 * 用法（在仓库根）：node scripts/danger-confirm-evidence.js [--root=apps/desktop/src]
 * 退出码：0 打印完成 / 2 判据自身故障
 */
const fs = require('fs')
const path = require('path')
const { check, maskNonCode, findFunctions } = require('./check-danger-confirm')

function main (argv) {
  let root = 'apps/desktop/src'
  for (const a of argv) {
    if (a.startsWith('--root=')) root = a.slice(7)
    else if (a.startsWith('--')) { console.error(`FAIL(parser): 未知旗标 ${a}`); return 2 }
  }
  const repoRoot = process.env.MP_REPO_ROOT || process.cwd()
  let r
  try { r = check(repoRoot, root) } catch (e) { console.error(`FAIL(scanner): ${e.message}`); return 2 }
  const sites = r.tierA.concat(r.tierB)
  for (const v of sites) {
    let body = '<top-level>'
    const confirms = []
    try {
      const abs = path.join(repoRoot, v.file)
      const src = fs.readFileSync(abs, 'utf8')
      const masked = maskNonCode(src)
      const scope = findFunctions(masked)
        .filter(s => s.name === v.fn)
        .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]
      if (scope) body = src.slice(scope.start, Math.min(scope.end + 1, scope.start + 900))
      const re = /notifyConfirm|confirmDanger|ElMessageBox|ConfirmDialog|showConfirm|window\.confirm/g
      let m
      while ((m = re.exec(src)) !== null && confirms.length < 8) {
        confirms.push(src.slice(0, m.index).split('\n').length + ':' + m[0])
      }
    } catch (e) {
      console.error(`FAIL(read): ${v.file} —— ${e.message}`)
      return 2
    }
    console.log(`==== ${v.file}#${v.fn}  [${v.tier}]  ${v.api}()`);
    console.log(`     确认痕迹: ${confirms.length ? confirms.join(' ') : '(全文件无)'}`);
    console.log(`     函数体: ${JSON.stringify(body.replace(/\r/g, ''))}`);
  }
  console.log(`TOTAL sites=${sites.length} A=${r.tierA.length} B=${r.tierB.length} unregistered=${r.unregistered.length} missing_evidence=${r.missingEvidence.length} stale=${r.stale.length}`)
  return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
