/**
 * dump3：趁 smoke6 任务在跑，周期性深度 dump 三平台当前页面：
 * 重点提取所有 input/textarea/contenteditable 明细 + 含"标题"文本元素 + 发布按钮状态，
 * 用于修正 kuaishou title 选择器与判定上传完成后的真实表单结构。
 */
'use strict'
const fs = require('fs')
const http = require('http')
const path = require('path')
const WebSocket = require('ws')
const { CdpClient, sleep } = require('D:/Data/projects/mp-worktrees/mp-hot-topics-video-publish-e2e/apps/desktop/tests/e2e/lib/cdp-client')

const OUT = 'D:/Data/projects/Multi-Publish/.agent_context/staging/rpa-dom-dumps'
fs.mkdirSync(OUT, { recursive: true })

function listTargets () {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9279/json/list', (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

async function attachByTargetId (targetId) {
  const list = await listTargets()
  const t = list.find((x) => x.id === targetId)
  if (!t || !t.webSocketDebuggerUrl) throw new Error('target gone')
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 15000)
    ws.on('open', () => { clearTimeout(timer); resolve(true) })
    ws.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
  return new CdpClient(ws, t, 9279)
}

const EXPR = `(() => {
  const pick = (el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.type || '',
    text: (el.innerText || '').trim().slice(0, 30),
    cls: (el.className && String(el.className)).slice(0, 80),
    ph: el.placeholder || '',
    visible: Boolean(el.offsetParent),
    value: (el.value || '').slice(0, 20),
  })
  const inputs = Array.from(document.querySelectorAll('input,textarea,[contenteditable=true]')).map(pick)
  const videos = Array.from(document.querySelectorAll('video')).map(v => ({ src: String(v.currentSrc || v.src || '').slice(0, 100), visible: v.getClientRects().length > 0 }))
  const labelEls = Array.from(document.querySelectorAll('label,span,div')).filter(e => e.children.length === 0 && /标题/.test(e.innerText || '') && (e.innerText || '').length < 25).map(pick).slice(0, 8)
  const pubBtns = Array.from(document.querySelectorAll('button,[role=button]')).filter(e => /发布|投稿/.test(e.innerText || '') && (e.innerText || '').length < 15).map(e => ({ ...pick(e), disabled: !!e.disabled })).slice(0, 10)
  return { url: location.href, inputCount: inputs.length, inputs: inputs.filter(i => i.visible), videos, labelEls, pubBtns }
})()`

;(async () => {
  const deadline = Date.now() + Number(process.env.DUMP3_MS || 300000)
  let round = 0
  while (Date.now() < deadline) {
    round++
    const list = await listTargets()
    const seen = []
    for (const t of list) {
      if (t.type !== 'page') continue
      const url = t.url || ''
      const p = ['kuaishou', 'bilibili', 'douyin'].find((x) => url.includes(x === 'bilibili' ? 'bilibili' : x))
      if (!p) continue
      try {
        const cdp = await attachByTargetId(t.id)
        const dump = await cdp.evaluate(EXPR)
        cdp.close()
        const file = path.join(OUT, 'd3-' + round + '-' + p + '.json')
        fs.writeFileSync(file, JSON.stringify(dump, null, 1))
        seen.push(p + ' in=' + dump.inputs.length + ' vid=' + dump.videos.filter((v) => v.visible).length + ' pub=' + dump.pubBtns.filter((b) => b.visible).map((b) => b.text + (b.disabled ? '(dis)' : '')).join(','))
      } catch (e) { seen.push(p + ' FAIL') }
    }
    console.log(new Date().toISOString().slice(11, 19) + ' ' + seen.join(' | '))
    await sleep(20000)
  }
  process.exit(0)
})().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
