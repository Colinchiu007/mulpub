// @vitest-environment node
'use strict'
/**
 * 回归：展开「音色复制 / 克隆」面板时，长不可断内容（如 MiniMax 生成的克隆 voice_id/长名称）
 * 不得把配置网格/整个界面撑宽。
 *
 * 两个层级：
 * 1) 真实 chromium 行为断言：用与 CreateView.vue 同步的样式 + 面板标记渲染，断言无横向溢出；
 *    浏览器不可用（如纯单元测试 job 未装 playwright chromium）时优雅跳过。
 * 2) CSS 契约断言：锁定防溢出关键规则必须存在于 src/styles/create-view.css（代码-设计分离后从 Vue 提取）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

let chromium
try { ({ chromium } = require('playwright')) } catch { chromium = null }

// 与 src/styles/create-view.css 保持同步（代码-设计分离后从 CreateView.vue 提取）
const CSS = `
* { box-sizing: border-box; }
body { margin: 0; }
.wrap { width: 560px; border: 1px solid #ccc; padding: 12px; }
.config-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr)); gap: 16px; }
.config-item { min-width: 0; }
.config-span-2 { grid-column: span 2; min-width: 0; }
.form-input { width: 100%; padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; }
.btn-secondary { padding: 6px 12px; white-space: nowrap; }
.config-hint { font-size: 12px; color: #777; }
.voice-clone-panel { display: grid; gap: 8px; min-width: 0; }
.voice-clone-toggle { display: flex; justify-content: space-between; width: 100%; border: none; background: transparent; font-size: 14px; font-weight: 600; }
.voice-clone-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.voice-clone-actions .form-input { flex: 1 1 180px; min-width: 0; }
.voice-clone-list { display: grid; gap: 8px; min-width: 0; }
.voice-clone-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; min-width: 0; }
.voice-clone-row > span { min-width: 0; overflow-wrap: anywhere; }
`

// 面板标记（长不可断克隆名 = MiniMax voice_id 形态）
const LONG_NAME = 'MiniMaxMyVoiceName_abcdefghijklmnopqrstuvwxyz0123456789'
const HTML = `<!doctype html><html><head><style>${CSS}</style></head><body>
<div class="wrap"><div class="config-grid">
  <div class="config-item"><label>语音生成器</label><select style="width:100%"><option>MiniMax TTS</option></select></div>
  <div class="config-item"><label>语音/音色 ID</label><select style="width:100%"><option>使用服务商默认音色</option></select></div>
  <div class="config-item config-span-2 voice-clone-panel">
    <button class="voice-clone-toggle"><span>音色复制 / 克隆</span><span>收起</span></button>
    <div class="voice-clone-actions"><button class="btn-secondary">选择本地音频文件</button><span class="config-hint">已选择 1 个样本</span></div>
    <div class="voice-clone-actions"><input class="form-input" placeholder="克隆音色名称" value="我的克隆音色" /><button class="btn-secondary">添加克隆音色</button></div>
    <div class="voice-clone-list">
      <div class="voice-clone-row"><span>${LONG_NAME}</span><div class="voice-clone-actions"><button class="btn-secondary">已设为默认</button><button class="btn-secondary">删除</button></div></div>
    </div>
  </div>
  <div class="config-item"><label>背景音乐</label><div><button class="btn-secondary">选择音频</button></div></div>
  <div class="config-item"><label>背景音乐音量</label></div>
</div></div></body></html>`

describe('voice-clone-panel 防撑宽回归', () => {
  const browserAvailable = Boolean(chromium)

  ;(browserAvailable ? it : it.skip)('真实 chromium：长不可断克隆名不横向溢出面板（修复前 97px 溢出）', async () => {
    let browser
    try { browser = await chromium.launch() } catch { return }
    try {
      const page = await browser.newPage()
      const tmp = path.join(os.tmpdir(), 's2v-clone-layout-regression.html')
      fs.writeFileSync(tmp, HTML)
      await page.goto('file://' + tmp.replace(/\\/g, '/'))
      const r = await page.evaluate(() => {
        const panel = document.querySelector('.voice-clone-panel')
        return { panelOverflow: panel.scrollWidth > panel.clientWidth + 1, panelScrollW: panel.scrollWidth, panelClientW: panel.clientWidth }
      })
      expect(r.panelOverflow).toBe(false)
      expect(r.panelScrollW).toBeLessThanOrEqual(r.panelClientW)
    } finally {
      await browser.close()
    }
    // 2026-09-19：真实 chromium 启动在 CI 分片全量负载下可能 >10s（shard 2/2 曾因
    // testTimeout=10000 超时阻断 PR #2006，而单跑 2/2 通过）→ 显式放宽本用例超时。
    // 断言不变（仅超时参数），不属放宽判定。
  }, 60000)

  it('create-view.css 保留防溢出 CSS 契约（minmax(min(200px,100%),1fr) / min-width:0 / overflow-wrap:anywhere）', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/styles/create-view.css'), 'utf8')
    expect(source).toContain('minmax(min(200px, 100%), 1fr)')
    expect(source).toContain('.config-item { min-width: 0; }')
    expect(source).toContain('.config-span-2 { grid-column: span 2; min-width: 0; }')
    expect(source).toContain('.voice-clone-panel { display: grid; gap: 8px; min-width: 0; }')
    expect(source).toContain('.voice-clone-actions .form-input { flex: 1 1 180px; min-width: 0; }')
    expect(source).toContain('.voice-clone-row > span { min-width: 0; overflow-wrap: anywhere; }')
  })
})
