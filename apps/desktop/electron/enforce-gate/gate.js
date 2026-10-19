'use strict'
/**
 * enforce-gate 弹窗渲染脚本（CSP: script-src 'self'，无内联）。
 * 状态视图机：blocking / downloading / error / verify-failed，见 PRD §6。
 */
const t = window.enforceGate.texts
let currentDecision = null

const el = {
  title: document.getElementById('title'),
  body: document.getElementById('body'),
  version: document.getElementById('version'),
  error: document.getElementById('error'),
  progress: document.getElementById('progress'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  actionBtn: document.getElementById('actionBtn'),
  retryBtn: document.getElementById('retryBtn'),
}

function fmt (template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ''))
}

function show (opts) {
  el.version.style.display = opts.showVersion ? '' : 'none'
  el.error.style.display = opts.showError ? '' : 'none'
  el.progress.style.display = opts.showProgress ? '' : 'none'
  el.retryBtn.style.display = opts.showRetry ? '' : 'none'
  el.actionBtn.style.display = opts.showAction ? '' : 'none'
  el.actionBtn.disabled = !!opts.disableAction
}

function render (decision) {
  currentDecision = decision
  if (!decision) return
  if (decision.status === 'verify-failed') {
    el.title.textContent = t.gateVerifyFailed
    el.body.textContent = ''
    el.error.style.display = 'none'
    show({ showRetry: true, showAction: false })
    el.retryBtn.textContent = t.gateRetry
    return
  }
  // blocking 及其子状态
  el.title.textContent = t.gateTitle
  el.body.textContent = t.gateBody
  el.version.textContent = fmt(t.gateVersionLine, { current: decision.current || '', target: decision.target || '' })
  el.error.textContent = decision.error || ''
  el.actionBtn.textContent = t.gateUpgradeBtn
  if (decision.phase === 'downloading') {
    el.progressFill.style.width = (decision.percent || 0) + '%'
    el.progressText.textContent = fmt(t.gateDownloading, { percent: decision.percent || 0 })
    show({ showVersion: true, showProgress: true, showAction: true, disableAction: true })
  } else if (decision.phase === 'error') {
    show({ showVersion: true, showError: true, showAction: true })
    el.error.textContent = decision.error || t.gateFailed
  } else if (decision.phase === 'downloaded') {
    el.progressFill.style.width = '100%'
    el.progressText.textContent = t.installingHint || ''
    show({ showVersion: true, showProgress: true, showAction: true, disableAction: true })
  } else {
    show({ showVersion: true, showAction: true })
  }
}

el.actionBtn.addEventListener('click', () => { window.enforceGate.upgrade() })
el.retryBtn.addEventListener('click', () => { window.enforceGate.retryVerify() })
window.enforceGate.onState((payload) => { render(payload && payload.decision) })
window.enforceGate.onProgress((payload) => {
  if (!payload || !currentDecision || currentDecision.status !== 'blocking') return
  render({ ...currentDecision, phase: payload.type, percent: payload.percent, error: payload.type === 'error' ? (payload.message || t.gateFailed) : undefined })
})
window.enforceGate.requestState()
