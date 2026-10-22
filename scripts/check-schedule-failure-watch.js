'use strict'
/* 判据本体：定时作业是否都在「CI 失败自动报警」的名单里（双向：漏覆盖 与 名单陈旧 都算红）。
 *
 * 断言两件事，方向相反、缺一不可：
 *  A. 凡带 `on.schedule:` 的工作流，其 `name:` 必须在 ci-failure-handler 的
 *     `on.workflow_run.workflows` 名单里 —— 漏一个就是"挂了没人知道"那一类（cleanup 连红 8 天的真因）。
 *  B. 名单里的每个名字必须还能在某个 .github/workflows/*.yml 的 `name:` 上找到 ——
 *     有人改名/删工作流而名单留着，读起来像"已覆盖"，实际那条永远不会触发。
 *
 * 解析刻意不用第三方 YAML 库：落点 `changes` 作业没有 Install deps，只准用 node 内置。
 * 行尾按当场真实 eol 归一（本仓 workflows 多为 i/lf w/crlf），并**先剥注释行**再找 key，
 * 否则 `# 每天 22:10 UTC` 这类说明文字会被当成一次声明。
 */
const fs = require('node:fs')
const path = require('node:path')

function loadWorkflows (root) {
  const dir = path.join(root, '.github', 'workflows')
  let names
  try { names = fs.readdirSync(dir) } catch (e) { throw new Error('SCANNER_FAULT: 读不到 ' + dir + ' :: ' + e.message) }
  const rows = []
  for (const f of names.filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n')
    const body = raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    const name = (raw.match(/^name:[ \t]*(.+?)[ \t]*$/m) || [, ''])[1].replace(/^["']|["']$/g, '')
    rows.push({
      file: f,
      name,
      scheduled: /^\s{2}schedule:[ \t]*$/m.test(body),
      hasCron: /cron[:]/.test(body),
      runList: (() => {
        const m = body.match(/^\s{4}workflows[:]\s*\[([^\]]*)\]/m)
        if (!m) return null
        return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      })(),
    })
  }
  return rows
}

function judge (root) {
  // 三条"工具失明"都必须走同一档，不得退化成"没有定时作业 ⇒ 全绿"：
  // 读不到目录、目录里一个 yml 都没有、handler 清单解析不出来。
  let rows
  try { rows = loadWorkflows(root) } catch (e) { return { verdict: 'SCANNER_FAULT', reason: e.message } }
  if (!rows.length) return { verdict: 'SCANNER_FAULT', reason: `.github/workflows 里一个 yml 都没枚举到（根：${root}）` }
  const handler = rows.find((r) => r.file === 'ci-failure-handler.yml')
  if (!handler || !handler.runList) return { verdict: 'SCANNER_FAULT', reason: '读不到 handler 的 workflows 清单' }
  const scheduled = rows.filter((r) => r.scheduled)
  // 预筛自证：声明了 schedule 却找不到 cron，说明我的形状判据抓到了别的东西
  const oddShape = scheduled.filter((r) => !r.hasCron).map((r) => r.file)
  const byName = new Set(rows.map((r) => r.name).filter(Boolean))
  const uncovered = scheduled.filter((r) => !handler.runList.includes(r.name))
  const stale = handler.runList.filter((n) => !byName.has(n))
  return {
    verdict: (uncovered.length || stale.length || oddShape.length) ? 'FAIL' : 'OK',
    total: rows.length,
    scheduledCount: scheduled.length,
    scheduledNames: scheduled.map((r) => r.name),
    listCount: handler.runList.length,
    uncovered, stale, oddShape,
  }
}

if (require.main === module) {
  const root = process.argv[2] || process.cwd()
  const r = judge(root)
  if (r.verdict === 'SCANNER_FAULT') { console.log('SCANNER_FAULT ' + r.reason); process.exit(2) }
  console.log(`SCHEDULE-WATCH root=${root} workflows=${r.total} scheduled=${r.scheduledCount} list=${r.listCount} 未覆盖=${r.uncovered.length} 陈旧名单项=${r.stale.length} 形状可疑=${r.oddShape.length} 判定=${r.verdict}`)
  console.log('  scheduled=' + r.scheduledNames.join(' | '))
  for (const u of r.uncovered) console.log(`  UNCOVERED ${u.file} name="${u.name}"`)
  for (const s of r.stale) console.log(`  STALE_LIST_ENTRY "${s}"（没有任何工作流叫这个名）`)
  for (const o of r.oddShape) console.log(`  ODD_SHAPE ${o}（声明 schedule 却找不到 cron ⇒ 判据可能抓错）`)
  process.exit(r.verdict === 'OK' ? 0 : 1)
}
module.exports = { judge, loadWorkflows }
