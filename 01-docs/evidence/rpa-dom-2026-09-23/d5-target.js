/**
 * dump5：单轮定向取证——三平台 live 页面里"所有含发布/投稿/确定文本的元素（不限标签）"
 * + 编辑器/标题字段候选 + 页面滚动容器底部栏，用于修正 publish_btn / title_input 选择器。
 */
'use strict'
const fs = require('fs')
const http = require('http')
const path = require('path')
const WebSocket = require('ws')
const { CdpClient } = require('D:/Data/projects/mp-worktrees/mp-hot-topics-video-publish-e2e/apps/desktop/tests/e2e/lib/cdp-client')
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
  const leaf = (e) => e.children.length === 0 || /^(BUTTON|A|I|SPAN|DIV)$/.test(e.tagName)
  const desc = (e) => ({ tag: e.tagName.toLowerCase(), cls: String(e.className||'').slice(0,90), id: e.id||'', text: (e.innerText||'').trim().slice(0,24), visible: !!e.offsetParent, disabled: !!e.disabled, rect: (()=>{const r=e.getBoundingClientRect();return Math.round(r.x)+','+Math.round(r.y)+','+Math.round(r.width)+','+Math.round(r.height)})() })
  const pubLike = Array.from(document.querySelectorAll('*')).filter(e => leaf(e) && /^(发布|发 布|发表|提交|立即投稿|发布作品|下一步|确定)$/.test((e.innerText||'').trim())).slice(0,25).map(desc)
  const fields = Array.from(document.querySelectorAll('input,textarea,[contenteditable],[role=textbox]')).map(e => ({ ...desc(e), ph: e.placeholder||'', type: e.type||'', ce: e.getAttribute('contenteditable') })).filter(f => f.visible)
  const bodyText = (document.body.innerText||'').replace(/\\s+/g,' ').slice(0, 1200)
  return { url: location.href, scrollY: window.scrollY, docH: document.body.scrollHeight, viewH: window.innerHeight, pubLike, fields, bodyText }
})()`
;(async () => {
  const list = await listTargets()
  for (const t of list) {
    if (t.type !== 'page' || !/kuaishou|bilibili|douyin/.test(t.url || '')) continue
    const p = /kuaishou/.test(t.url) ? 'kuaishou' : (/bilibili/.test(t.url) ? 'bilibili' : 'douyin')
    try {
      const cdp = await attachByTargetId(t.id)
      const d = await cdp.evaluate(EXPR)
      cdp.close()
      fs.writeFileSync(path.join(OUT, 'd5-' + p + '.json'), JSON.stringify(d, null, 1))
      console.log(p + ' pubLike=' + d.pubLike.map(x => x.tag + ':' + x.text + (x.visible ? '' : '(hid)')).join(',') + ' fields=' + d.fields.length)
    } catch (e) { console.log(p + ' FAIL ' + e.message) }
  }
  process.exit(0)
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
