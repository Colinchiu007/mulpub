// 查最近 5 条 story2video-compose run 的失败原因（含阶段与错误）
const { CdpClient } = require('D:/Data/projects/mp-worktrees/mp-hot-topics-video-publish-e2e/apps/desktop/tests/e2e/lib/cdp-client')
;(async () => {
  const cdp = await CdpClient.attach(9279, 'http://127.0.0.1:5231')
  const hist = await cdp.evaluate(`window.electronAPI.pipelineHistory({ pipeline: 'story2video-compose', limit: 12 }).then(r=>JSON.stringify(r.data||r))`)
  const arr = JSON.parse(hist)
  console.log('history count', arr.length)
  for (const h of arr.slice(0, 6)) {
    console.log('----', h.runId || h.id, h.status, h.phase || (h.currentPhase), new Date(h.updatedAt || h.createdAt || Date.now()).toISOString())
    const ctx = await cdp.evaluate(`window.electronAPI.pipelineGetRunContext(${JSON.stringify(h.runId || h.id)}).then(r=>JSON.stringify(r.data||r))`)
    const c = JSON.parse(ctx)
    const s = JSON.stringify(c)
    const errIdx = s.indexOf('"error"')
    console.log('  size', s.length, ' errors:', (s.match(/"error"\s*:\s*"[^"]{0,200}/g) || []).slice(0, 6).join('\n    '))
    console.log('  keys:', Object.keys(c).join(','))
    if (c.phases) console.log('  phases:', (c.phases || []).map((p) => p.name + ':' + p.status + (p.error ? '(' + String(p.error).slice(0, 90) + ')' : '')).join(' | '))
    const textIdx = s.indexOf('"text"')
    console.log('  text snippet:', textIdx > 0 ? s.slice(textIdx, textIdx + 160) : 'NO TEXT FIELD')
  }
  process.exit(0)
})().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
