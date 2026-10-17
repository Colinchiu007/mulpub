// 合并回填：两篇记录的远程同步 PENDING → PASS + merge SHA，同次提交删除 sync_* 三字段
const fs = require('fs')
const R = 'D:\\Data\\projects\\mp-worktrees\\mp-visual-gate-enforce\\'
const jobs = [
  { f: 'openspec\\records\\visual-gate-full-coverage.md', merge: '96ed8171139706364699673cb37c6e3f009cb8f8', pr: '#3800', time: '2026-10-17T14:06:16+08:00', branch: 'visual-gate-full-coverage' },
  { f: 'openspec\\records\\visual-gate-single-entry.md',    merge: 'ce3f25cdf8d0deb166d9ec445902c386f1d1a3d4', pr: '#3804', time: '2026-10-17T15:16:27+08:00', branch: 'visual-gate-single-entry' },
]
for (const j of jobs) {
  const p = R + j.f
  const hasCRLF = fs.readFileSync(p, 'utf8').includes('\r\n')
  let lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
  const before = lines.length
  lines = lines.filter(l => !/^sync_(status|reason|backfill_owner):/.test(l))
  const i = lines.findIndex(l => /^\|\s*远程同步\s*\|/.test(l))
  if (i < 0) { console.error(`❌ ${j.f}: 未找到「远程同步」表格行`); process.exit(1) }
  lines[i] = `| 远程同步 | PASS | PR ${j.pr} 已 squash 合并，merge SHA \`${j.merge}\`（${j.time}）；远端分支 \`${j.branch}\` 已删（\`git ls-remote --heads\` 0 行）；\`git log origin/main --grep='(${j.pr})\$'\` 恰好 1 行；frontmatter 的 \`sync_*\` 三字段已在本次提交删除（本记录无 ledger 登记项） |`
  fs.writeFileSync(p, lines.join(hasCRLF ? '\r\n' : '\n'), 'utf8')
  const text = fs.readFileSync(p, 'utf8')
  const checks = {
    '无 sync_ 字段': !/^sync_/m.test(text),
    '远程同步为 PASS': /\|\s*远程同步\s*\|\s*PASS\s*\|/.test(text),
    '含 merge SHA': text.includes(j.merge),
    '无 PENDING 残留': !/\|\s*远程同步\s*\|\s*PENDING/.test(text),
  }
  console.log(`${j.f}: 删 ${before - lines.length} 行 sync_ 字段`)
  console.log('  ' + JSON.stringify(checks))
  if (Object.values(checks).some(v => !v)) process.exit(1)
}
console.log('✅ 两篇回填完成')
