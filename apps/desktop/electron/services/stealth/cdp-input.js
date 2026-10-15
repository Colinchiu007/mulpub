/**
 * cdp-input.js — Electron debugger CDP 输入驱动（PRD §3.2 传输驱动 1）
 *
 * 职责：把 behavior-engine 的**点序列/事件序列**翻译成 CDP 调用。不放任何算法
 * （算法全在 behavior-engine，本类只做传输）——评审 H3 的两驱动同接口的基础。
 *
 * CDP 语义映射：
 * - move/down/up → Input.dispatchMouseEvent（mouseMoved/mousePressed/mouseReleased，
 *   **可信事件**——平台侧看到的是真实输入设备事件）
 * - 9 字段 pointer/mouse 合成事件 → **页面侧派发**（CDP Input 域没有合成事件能力；
 *   social-auto-upload _native_click 同款路线：executeJavaScript 运携事件对象逐条派发）
 * - getBounds → DOM.enable→getDocument→querySelector→getBoxModel（中心点）
 *
 * 生命周期：per-op attach('1.3') + finally detach（Electron 单 debugger 实例制，
 * 与 rpa-view-helpers 上传路径同模式——F1-c 的 preload 注入不占 debugger，无冲突）。
 */
'use strict'

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {{webContents: any}} win BrowserWindow
 */
function createCdpInput (win) {
  const wc = win.webContents

  async function withDebugger (fn) {
    const dbg = wc.debugger
    // owned-detach（对齐 isolated-world 模式，QM-6 Warning-3）：仅会话归我们时才 detach——
    // 他方（上传路径/网络取证）已附着时复用会话，无条件 detach 会拆掉别人的 CDP 通道
    let owned = false
    try {
      if (!(typeof dbg.isAttached === 'function' && dbg.isAttached())) {
        await dbg.attach('1.3')
        owned = true
      }
    } catch (_e) { /* attach 被拒（他方刚附着）：复用现状，owned=false 不拆别人的会话 */ }
    try {
      return await fn(dbg)
    } finally {
      if (owned) {
        try { await dbg.detach() } catch (_e) { /* ignore */ }
      }
    }
  }

  return {
    /** 元素中心点 + 尺寸；失败返回 null（不抛） */
    async getBounds (selector) {
      return withDebugger(async (dbg) => {
        await dbg.sendCommand('DOM.enable')
        const doc = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
        const rootNodeId = doc && doc.root && doc.root.nodeId
        if (!rootNodeId) return null
        const q = await dbg.sendCommand('DOM.querySelector', { nodeId: rootNodeId, selector })
        if (!q || !q.nodeId) return null
        const box = await dbg.sendCommand('DOM.getBoxModel', { nodeId: q.nodeId })
        const content = box && box.model && box.model.content
        if (!content || content.length < 8) return null
        const xs = [content[0], content[2], content[4], content[6]]
        const ys = [content[1], content[3], content[5], content[7]]
        const x = (Math.min(...xs) + Math.max(...xs)) / 2
        const y = (Math.min(...ys) + Math.max(...ys)) / 2
        return { x, y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), nodeId: q.nodeId }
      }).catch(() => {
        // 失败只降级不抛；detach 已收归 withDebugger 的 owned 判定（他方附着时不得拆通道）
        return null
      })
    },

    /** 单点输入事件：move/down/up → CDP Input 域可信事件 */
    async dispatch (kind, x, y, opts = {}) {
      const typeMap = { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased' }
      const type = typeMap[kind]
      if (!type) return false
      return withDebugger(async (dbg) => {
        await dbg.sendCommand('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: opts.button || 'left',
          clickCount: kind === 'move' ? 0 : 1,
        })
        return true
      }).catch(() => false)
    },

    /**
     * 合成事件序列（behavior-engine 产出的 9 字段事件）：页面侧逐条派发。
     * 为什么不用 CDP：Input 域只有原始设备事件，没有带 pointerId/composed 等字段的
     * 合成事件——抖音 uc_verification_component 只认这套（social-auto-upload 实证）。
     */
    async dispatchSynthetic (events) {
      if (!Array.isArray(events) || events.length === 0) return true
      const script = '(function(){var evs=' + JSON.stringify(events) +
        ';for(var i=0;i<evs.length;i++){var e=evs[i];var t=e.kind;var opts={bubbles:!!e.bubbles,cancelable:!!e.cancelable,composed:!!e.composed,clientX:e.clientX,clientY:e.clientY};' +
        "if(t.indexOf('pointer')===0){opts.pointerId=e.pointerId;opts.pointerType=e.pointerType;opts.isPrimary=e.isPrimary;}" +
        "if(t.indexOf('mouse')===0||t==='click'){opts.button=e.button==null?0:e.button;}" +
        'var el=document.elementFromPoint(e.clientX,e.clientY)||document.body;' +
        "el.dispatchEvent(t.indexOf('pointer')===0?new PointerEvent(t,opts):new MouseEvent(t,opts));}" +
        'return true})()'
      try {
        await wc.executeJavaScript(script)
        return true
      } catch (_e) {
        return false
      }
    },

    /** 逐字符输入（Input.insertText 逐键，节拍由调用方按 planType 掌握） */
    async typeText (text) {
      const s = String(text == null ? '' : text)
      return withDebugger(async (dbg) => {
        for (const ch of s) {
          await dbg.sendCommand('Input.insertText', { text: ch })
        }
        return true
      }).catch(() => false)
    },

    /** 便捷：按 behavior-engine 序列完整执行一次点击（可信事件 + 合成事件 + 节拍） */
    async performClickSequence (sequence) {
      for (const ev of sequence.events) {
        if (ev.kind === 'move') {
          await this.dispatch('move', ev.x, ev.y)
        }
        if (ev.delayMs) await sleep(ev.delayMs)
      }
      await sleep(sequence.preClickSleepMs)
      await this.dispatch('down', sequence.events[sequence.events.length - 1].clientX, sequence.events[sequence.events.length - 1].clientY)
      await this.dispatch('up', sequence.events[sequence.events.length - 1].clientX, sequence.events[sequence.events.length - 1].clientY)
      await sleep(sequence.postClickSleepMs)
      await this.dispatchSynthetic(sequence.events.filter((e) => e.kind !== 'move'))
      return true
    },
  }
}

module.exports = { createCdpInput }
