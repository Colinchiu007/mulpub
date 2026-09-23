/**
 * dump4：精确抓 kuaishou 编辑页结构（contenteditable outerHTML / class含title元素 / 按钮全文 / iframe）
 */
'use strict'
const fs = require('fs')
const http = require('http')
const path = require('path')
const WebSocket = require('ws')
const { CdpClient, sleep } = require('D:/Data/projects/mp-worktrees/mp-hot-topics-video-publish-e2e/apps/desktop/tests/e2e/lib/cdp-client')
const OUT = 'D:/Data/projects/Multi-Publish/.agent_context/staging/rpa-dom-dumps'

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
  const ce = Array.from(document.querySelectorAll('[contenteditable]')).map(e => ({ html: e.outerHTML.slice(0,400), text: (e.innerText||'').slice(0,60), visible: !!e.offsetParent }))
  const titleEls = Array.from(document.querySelectorAll('*')).filter(e => /title/i.test(String(e.className||'')) && e.children.length === 0).slice(0,20).map(e => ({ tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0,60), text: (e.innerText||'').trim().slice(0,40), ce: e.getAttribute('contenteditable'), visible: !!e.offsetParent }))
  const btns = Array.from(document.querySelectorAll('button,[role=button],a')).map(e => ({ text: (e.innerText||'').trim().slice(0,20), cls: String(e.className).slice(0,60), disabled: !!e.disabled, visible: !!e.offsetParent })).filter(b => b.visible && b.text)
  const frames = Array.from(document.querySelectorAll('iframe')).map(f => ({ src: String(f.src).slice(0,120), name: f.name, visible: !!f.offsetParent }))
  const divs = Array.from(document.querySelectorAll('div')).filter(d => d.children.length === 0 && /描述|标题|话题/.test(d.innerText||'') && (d.innerText||'').length < 40).slice(0,15).map(d => ({ cls: String(d.className).slice(0,60), text: (d.innerText||'').trim() }))
  return { url: location.href, ce, titleEls, btns: btns.slice(0,40), frames, divs }
})()`
;(async () => {
  const deadline = Date.now() + Number(process.env.DUMP4_MS || 420000)
  let round = 0
  while (Date.now() < deadline) {
    round++
    const list = await listTargets()
    for (const t of list) {
      if (t.type !== 'page' || !/kuaishou|bilibili|douyin/.test(t.url || '')) continue
      const p = /kuaishou/.test(t.url) ? 'kuaishou' : (/bilibili/.test(t.url) ? 'bilibili' : 'douyin')
      try {
        const cdp = await attachByTargetId(t.id)
        const d = await cdp.evaluate(EXPR)
        cdp.close()
        fs.writeFileSync(path.join(OUT, 'd4-' + round + '-' + p + '.json'), JSON.stringify(d, null, 1))
        console.log(new Date().toISOString().slice(11, 19) + ' ' + p + ' ce=' + d.ce.length + ' btns=' + d.btns.length + ' frames=' + d.frames.length)
      } catch (e) { console.log(p + ' FAIL ' + e.message) }
    }
    await sleep(30000)
  }
  process.exit(0)
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
