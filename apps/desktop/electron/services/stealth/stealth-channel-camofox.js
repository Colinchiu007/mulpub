// @ts-check
/**
 * stealth-channel-camofox.js — F3 camofox 隐身通道驱动（PRD §3.4 落点，tasks 7.2）
 *
 * 设计前提（design.md D2「行为层传输无关接口先行」，已随 PR-1 落地）：
 * 先定 `dispatch/getBounds/typeText` 三方法接口（纯 CDP Input/DOM 域词汇），
 * `cdp-input.js` 与**本驱动各实现一版**。故本文件与 cdp-input.js **同接口同返回语义**：
 *   getBounds(selector) → {x,y,width,height,nodeId} | null（失败返回 null，不抛）
 *   dispatch(kind,x,y,opts) → boolean（失败 false）
 *   typeText(text) → boolean
 *   dispatchSynthetic(events) → boolean
 *   performClickSequence(sequence) → boolean
 *
 * 与 cdp-input 的差异（F3 特有）：
 * 1. **传输是 CDP-over-WebSocket**（camoufox 的 --remote-debugging-port），不是 Electron
 *    的 wc.debugger。连接懒建立 + 会话内复用；close() 由 sidecar-host.stop() 触发。
 * 2. **页面侧派发走 Runtime.evaluate**：camoufox 里没有 executeJavaScript，合成 9 字段
 *    事件改用 CDP Runtime.evaluate 运携页面脚本逐条派发（与 cdp-input 的 executeJavaScript
 *    路线同语义）。
 * 3. **仅绑 127.0.0.1 + 一次性 token**（PRD §3.4 监听安全，评审 F5 同款）：WS URL 的 host
 *    必须是 127.0.0.1，非回环一律 fail-closed 拒绝建连；token 只出现在建连 URL 里
 *    （一次性消费），此后的 CDP 消息与日志一律不得再带它。
 * 4. per-op attach/detach 不适用：cdp-input 因 Electron 单 debugger 实例制才那样做，
 *    WS 是独立通道，无独占冲突。
 */
const { URL } = require('url')

/** CDP-over-WS 的 JSON-RPC 封装：id 自增 + pending map，响应按 id 归位 */
function createCdpClient (ws, logger) {
  let nextId = 1
  const pending = new Map()

  ws.onmessage = (raw) => {
    let msg
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw))
    } catch (_e) {
      return
    }
    if (msg && msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error('CDP error ' + msg.error.code + ': ' + msg.error.message))
      else resolve(msg.result)
    }
  }

  async function sendCommand (method, params = {}) {
    if (!ws || ws.readyState !== 1) throw new Error('camofox CDP 通道未就绪')
    const id = nextId++
    const payload = JSON.stringify({ id, method, params })
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        ws.send(payload)
      } catch (e) {
        pending.delete(id)
        reject(e)
      }
    })
  }

  function pendingCount () { return pending.size }

  return { sendCommand, pendingCount }
}

/**
 * 校验 WebSocket 端点：只允许 127.0.0.1。
 * PRD §3.4：CDP/WebSocket 仅绑 127.0.0.1；本函数是**调用侧**的 fail-closed 复核，
 * 不依赖上游是否真的只听了回环。
 * @param {string} url
 * @returns {{host: string, port: number}}
 */
function assertLoopbackEndpoint (url) {
  const u = new URL(url)
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
    throw new Error('camofox CDP 端点必须是 ws:// 或 wss://，实得 ' + u.protocol)
  }
  if (u.hostname !== '127.0.0.1') {
    throw new Error('camofox CDP 端点只允许绑 127.0.0.1，实得 ' + u.hostname + '（PRD §3.4 监听安全）')
  }
  return { host: u.hostname, port: Number(u.port) }
}

/**
 * @param {object} deps
 * @param {string} deps.endpoint WS 端点，形如 ws://127.0.0.1:<port>/devtools/page/<id>?token=<one-shot>
 * @param {() => any} deps.wsFactory 建连工厂（测试注入假的）
 * @param {object} [deps.logger]
 */
function createCamofoxInput (deps) {
  const { endpoint, wsFactory, logger = console } = deps
  const hostPort = assertLoopbackEndpoint(endpoint)
  let ws = null
  let client = null
  let closed = false

  function logWarn (...a) { try { logger.warn('Camofox', ...a) } catch (_e) { /* ignore */ } }

  async function ensureClient () {
    if (closed) throw new Error('camofox 通道已关闭')
    if (client) return client
    ws = wsFactory(endpoint)
    client = createCdpClient(ws, logger)
    return client
  }

  async function withCdp (fn) {
    try {
      const c = await ensureClient()
      return await fn(c)
    } catch (e) {
      logWarn('CDP 调用失败: ' + (e && e.message))
      return null
    }
  }

  return {
    hostPort,

    /** 元素中心点 + 尺寸；失败返回 null（不抛）——与 cdp-input 同语义 */
    async getBounds (selector) {
      return withCdp(async (c) => {
        await c.sendCommand('DOM.enable')
        const doc = await c.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
        const rootNodeId = doc && doc.root && doc.root.nodeId
        if (!rootNodeId) return null
        const q = await c.sendCommand('DOM.querySelector', { nodeId: rootNodeId, selector })
        if (!q || !q.nodeId) return null
        const box = await c.sendCommand('DOM.getBoxModel', { nodeId: q.nodeId })
        const content = box && box.model && box.model.content
        if (!content || content.length < 8) return null
        const xs = [content[0], content[2], content[4], content[6]]
        const ys = [content[1], content[3], content[4], content[7]]
        const x = (Math.min(...xs) + Math.max(...xs)) / 2
        const y = (Math.min(...ys) + Math.max(...ys)) / 2
        return { x, y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), nodeId: q.nodeId }
      })
    },

    /** 单点输入事件：move/down/up → CDP Input 域可信事件 */
    async dispatch (kind, x, y, opts = {}) {
      const typeMap = { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased' }
      const type = typeMap[kind]
      if (!type) return false
      const r = await withCdp(async (c) => {
        await c.sendCommand('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: opts.button || 'left',
          clickCount: kind === 'move' ? 0 : 1,
        })
        return true
      })
      return r === true
    },

    /**
     * 合成事件序列（9 字段）：页面侧逐条派发。camoufox 无 executeJavaScript，
     * 走 CDP Runtime.evaluate（returnByValue，禁 userGesture——可信事件另有 dispatch）。
     */
    async dispatchSynthetic (events) {
      if (!Array.isArray(events) || events.length === 0) return true
      const r = await withCdp(async (c) => {
        await c.sendCommand('Runtime.evaluate', {
          expression: '(function(){var evs=' + JSON.stringify(events) +
            ';for(var i=0;i<evs.length;i++){var e=evs[i];var t=e.kind;var opts={bubbles:!!e.bubbles,cancelable:!!e.cancelable,composed:!!e.composed,clientX:e.clientX,clientY:e.clientY};' +
            "if(t.indexOf('pointer')===0){opts.pointerId=e.pointerId;opts.pointerType=e.pointerType;opts.isPrimary=e.isPrimary;}" +
            "if(t.indexOf('mouse')===0||t==='click'){opts.button=e.button==null?0:e.button;}" +
            'var el=document.elementFromPoint(e.clientX,e.clientY)||document.body;' +
            "el.dispatchEvent(t.indexOf('pointer')===0?new PointerEvent(t,opts):new MouseEvent(t,opts));}" +
            'return true})()',
          returnByValue: true,
        })
        return true
      })
      return r === true
    },

    /** 逐字符输入（Input.insertText 逐键，节拍由调用方按 planType 掌握） */
    async typeText (text) {
      const s = String(text == null ? '' : text)
      const r = await withCdp(async (c) => {
        for (const ch of s) {
          await c.sendCommand('Input.insertText', { text: ch })
        }
        return true
      })
      return r === true
    },

    /** 便捷：按 behavior-engine 序列完整执行一次点击（可信事件 + 合成事件 + 节拍） */
    async performClickSequence (sequence) {
      for (const ev of sequence.events) {
        if (ev.kind === 'move') {
          await this.dispatch('move', ev.x, ev.y)
        }
        if (ev.delayMs) await new Promise((r) => setTimeout(r, ev.delayMs))
      }
      await new Promise((r) => setTimeout(r, sequence.preClickSleepMs))
      const last = sequence.events[sequence.events.length - 1]
      await this.dispatch('down', last.clientX, last.clientY)
      await this.dispatch('up', last.clientX, last.clientY)
      await new Promise((r) => setTimeout(r, sequence.postClickSleepMs))
      await this.dispatchSynthetic(sequence.events.filter((e) => e.kind !== 'move'))
      return true
    },

    // 幂等由「消费即置空」保证：首次 close 后 ws=null，后续调用走 if(ws&&...) 自然短路。
    // 不另加 if(closed) return —— 它与 ws=null 冗余叠加（变异 M6 实测：摘掉它无可观测差异），
    // 留两道互为备份的守卫只会让读者以为存在某个必须双保险的场景。
    async close () {
      closed = true
      try {
        if (ws && typeof ws.close === 'function') ws.close()
      } catch (e) {
        logWarn('关闭 CDP 通道失败: ' + (e && e.message))
      }
      ws = null
      client = null
    },

    /** 测试/诊断用：当前未归位的 in-flight 请求数 */
    pendingCount () {
      return client ? client.pendingCount() : 0
    },
  }
}

module.exports = {
  createCamofoxInput,
  createCdpClient,
  assertLoopbackEndpoint,
}
