// 直连本地 prompt-engine（8013）验证 template / llm 两条策略的实际可用性
const PORT = Number(process.argv[2] || 8013)
async function call(body, label) {
  const t0 = Date.now()
  try {
    const res = await fetch('http://127.0.0.1:' + PORT + '/v1/optimize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    console.log('== ' + label + ' http=' + res.status + ' ' + (Date.now() - t0) + 'ms')
    console.log('   ' + text.slice(0, 700).replace(/\s+/g, ' '))
  } catch (e) {
    console.log('== ' + label + ' ERR ' + e.message)
  }
}
;(async () => {
  const health = await fetch('http://127.0.0.1:' + PORT + '/v1/health').then(r => r.text()).catch(e => 'ERR ' + e.message)
  console.log('health:', String(health).slice(0, 300))
  const prompt = '凌晨两点的西北戈壁，风沙像刀片一样刮过帐篷，老张蹲在太阳能板旁。'
  await call({ prompt, optimization_strategy: 'template', creative_level: 5, max_length: 500, platform: 'generic', style: 'realistic' }, 'template')
  process.exit(0)
})()
