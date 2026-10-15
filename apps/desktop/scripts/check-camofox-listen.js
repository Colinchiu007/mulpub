// @ts-check
/**
 * check-camofox-listen.js — 构建期断言（PR-2 §7.5 / tasks 7.5）
 *
 * 断言目标：camofox/CDP 监听**只绑 127.0.0.1**，无 `--remote-debugging-port` 非回环监听。
 * 判据来源：PRD §3.4「监听安全（评审 F5 同款）」——CDP/WebSocket 仅绑 127.0.0.1 + 一次性
 * token；构建期断言无 --remote-debugging-port 非回环。
 *
 * 为什么是构建期而不是运行期：非回环监听一旦进了产物，用户机上的任何同网段主机都能
 * 连上 CDP 驱动整个浏览器——那是远程代码执行面，不是"配置不当"。故必须在产物生成时
 * 拦住，而不是等运行时报错。
 *
 * 扫什么：caofland 相关源码（driver/postinstall/启动参数拼装）里出现
 *   --remote-debugging-port=<非回环 host:port> 形态一律判红。
 * 判据形态（保守）：只匹配**字面非回环监听目标**，回环（127.0.0.1 / localhost / ::1）
 * 与"端口取自变量/配置"的形态放行——后者由 assertLoopbackEndpoint 在运行期兜底
 * （stealth-channel-camofox.js），两处各管一段，不重复也不留洞。
 *
 * 纯判定与 IO 分离：collectViolations(sources) 可单测；CLI 包装只做读文件与退出码。
 */
const fs = require('fs')
const path = require('path')

/** 回环字面量（含 IPv6 回环的几种书写） */
const LOOPBACK_LITERALS = ['127.0.0.1', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1']

/**
 * 从源码文本中找出非回环的 --remote-debugging-port 监听目标。
 * @param {string} source 文件内容
 * @returns {Array<{ line: number, text: string, target: string }>}
 */
function findNonLoopbackDebugPort (source) {
  const out = []
  const lines = String(source).split(/\r?\n/)
  // 形态：--remote-debugging-port=host:port 或 --remote-debugging-port port（少见）
  const re = /--remote-debugging-port[=\s]+([^\s'"`]+)/g
  lines.forEach((text, idx) => {
    let m
    while ((m = re.exec(text)) !== null) {
      const target = m[1]
      // 纯端口（数字）→ 未显式指定 host，由运行期 assertLoopbackEndpoint 兜底，放行
      if (/^\d+$/.test(target)) continue
      // 方括号 IPv6 是**合法字面 host**，不是变量形态——必须先于下面的变量判定，
      // 否则 [2001:db8::1] 会被 [${}()[\]] 当成表达式放行（真实逃逸口）
      const isBracketV6 = /^\[[0-9a-fA-F:.]+\](:\d+)?$/.test(target)
      if (!isBracketV6 && /[${}()[\]]/.test(target)) continue
      // host 提取：
      //   方括号 IPv6  → 取括号内整体（含多个冒号，禁按第一个冒号切）
      //   裸 IPv6     → 整体去掉尾部 :port（同样含多个冒号；按第一个冒号切会得 ''，
      //                 于是 ::1 被误判成非回环——真实误报）
      //   IPv4/域名   → 按第一个冒号切
      let host
      if (isBracketV6) {
        host = target.replace(/^\[(.+?)\](?::\d+)?$/, '$1')
      } else if (target.split(':').length > 2) {
        host = target.replace(/:\d+$/, '')
      } else {
        host = target.split(':')[0]
      }
      if (LOOPBACK_LITERALS.includes(host)) continue
      out.push({ line: idx + 1, text: text.trim().slice(0, 120), target })
    }
  })
  return out
}

/**
 * 汇总一组来源的违规。
 * @param {Array<{ file: string, source: string }>} sources
 * @returns {{ ok: boolean, violations: Array<{ file: string, line: number, text: string, target: string }> }}
 */
function collectViolations (sources) {
  const violations = []
  for (const s of sources || []) {
    for (const v of findNonLoopbackDebugPort(s.source)) {
      violations.push({ file: s.file, ...v })
    }
  }
  return { ok: violations.length === 0, violations }
}

/** 默认扫描范围：camofox 驱动与其启动参数拼装（不含测试文件——测试本就该构造非回环用例） */
function defaultTargets (repoRoot) {
  return [
    'apps/desktop/electron/services/stealth/stealth-channel-camofox.js',
  ].map(rel => ({ rel, abs: path.join(repoRoot, rel) }))
}

/**
 * CLI 入口：扫默认目标，有违规则 exit 1 并打印可定位信息。
 * @param {string} repoRoot
 * @returns {{ ok: boolean, violations: unknown[], scanned: string[] }}
 */
function run (repoRoot) {
  const targets = defaultTargets(repoRoot)
  const sources = []
  const scanned = []
  for (const t of targets) {
    if (!fs.existsSync(t.abs)) continue
    sources.push({ file: t.rel, source: fs.readFileSync(t.abs, 'utf8') })
    scanned.push(t.rel)
  }
  const r = collectViolations(sources)
  if (!r.ok) {
    console.error('camofox 监听安全断言失败：出现非回环 --remote-debugging-port')
    for (const v of r.violations) {
      console.error('  ' + v.file + ':' + v.line + '  target=' + v.target)
      console.error('      ' + v.text)
    }
    console.error('PRD §3.4：CDP/WebSocket 仅允许绑 127.0.0.1。若确需可变 host，')
    console.error('请在运行期经 assertLoopbackEndpoint() 校验（本脚本对变量形态放行）。')
  }
  return { ok: r.ok, violations: r.violations, scanned }
}

module.exports = {
  LOOPBACK_LITERALS,
  findNonLoopbackDebugPort,
  collectViolations,
  defaultTargets,
  run,
}
