// 一次性脚本：填写 adversarial 裁决（prosecution/defense/verdict/rationale）
const fs = require('fs')
const f = '.adversarial/ccg-deep-bfc844cf/adjudication.json'
const j = JSON.parse(fs.readFileSync(f, 'utf-8'))

const rulings = {
  i1: {
    prosecution: 'hideGate()/dispose() 走 _win.close()，而 close handler 无条件 e.preventDefault()——程序化关闭同样被拦截，_win 置 null 后窗口仍存活，pass/升级后置顶窗永久残留并盖住主窗口，重复阻断时再建新窗叠加。',
    defense: 'close handler 意图只拦"用户侧关闭"；destroy() 不触发 close 拦截，可改用 destroy 绕开。但 dispose 当前确实调的是 close()。',
    verdict: 'upheld',
    rationale: '实测代码路径：dispose/hideGate 均调 _win.close()（enforce-gate.js dispose 段），close handler 无条件 preventDefault。窗口关闭意图与拦截语义冲突成立。修法：handler 判 _gateClosing 标志位（程序化关闭置位后再 close），或 dispose/hideGate 改用 destroy()（Electron 语义：destroy 不发 close 事件）。已在分支顶提交修复。',
  },
  i2: {
    prosecution: '_is_admin_cookie_session 只判 request.cookies 里是否存在同名 Cookie、不验签。catalog key 是打包进 exe 的静态共享密钥（桌面端人人持有），攻击者带 任意值假 cookie + 内置 catalog key + 旧版本头 → 版本门豁免 → 端点自身鉴权只验 key → 放行。426 执法层被一行 Cookie 绕过。',
    defense: '无 Cookie 的旧版本请求仍被正确拒绝（fail-closed）；运营后台真实会话确实带签名 cookie。但"伪造 cookie"零成本，defense 不成立。',
    verdict: 'upheld',
    rationale: '绕过路径可复现：假 cookie 值任意（判据只是 cookies.get(...) 真值）。修复：豁免必须验签——把豁免判据改为调用既有 get_current_session 依赖（JWT 验签 + pwd_fp 校验）成功才豁免；或改为"Cookie 会话必须同时通过 require_admin"。已在分支顶提交修复（version_gate.py 增 JWT 验签豁免）。',
  },
  i3: {
    prosecution: 'state 文件写入 monotonicRefMs 但全代码无读取点；回拨 <24h（容差内）时 elapsed 用墙钟差为负→按"刚同步过"处理，反复回拨可把 72h 宽限无限续期，PRD R4 防回拨声明落空。',
    defense: '回拨 >24h 已有 WARN + elapsed=0 处理；<24h 的回拨视为"时钟抖动"放行是设计取舍（PRD R4 写明不引入可信时钟重方案）。但"只写不读"是事实，单调时钟参考从未参与判定。',
    verdict: 'upheld',
    rationale: 'grep 证实 monotonicRefMs 仅 saveState 写入一处，无读取。修复：判定处同时读墙钟与单调钟——若单调钟差 <72h 用单调钟判定（免疫墙钟回拨），无单调参考（旧状态文件）才回落墙钟并 WARN。已在分支顶提交修复。',
  },
  i4: {
    prosecution: 'V4 仅当 min_version 非空时校验 enforce < min_version；min_version 为空 + enforce_enabled=1 + enforce_min_version=99.0.0 可通过 upsert，全员（含最新版）被硬锁，管理页二次确认只是 UI 层不构成服务端兜底。',
    defense: 'min_version 为空意味着运营未配置提示线，"阻断线 < 提示线"约束无锚点；应急解锁 = 关 enforce_enabled 总开关（Runbook R2 已写）。管理页有二次确认 + 语义说明。但"误配即全员锁"的防线确实只有 UI 层。',
    verdict: 'upheld',
    rationale: '服务端确无 max 上界校验。修复：upsert 增校验——enforce_min_version 不得高于 min_version（当 min_version 空时以 force_version 为上界；两者都空则要求 enforce ≤ 当前最新已知版本不可行，改为：min_version/force_version 全空时禁止启用 enforce（400：先配置提示线再启用阻断）。已在分支顶提交修复。',
  },
  i5: {
    prosecution: 'deps.gateTexts 在整个 diff 无注入点：phase5-ipc.js 的 handlerDependencies 无 gateTexts/enforceGate 相关键，get-texts 通道恒 event.returnValue = null；gate.js 首行 const t = window.enforceGate.texts 解构出 null，render() 里 t.gateTitle 抛 TypeError → 阻断窗白屏、唯一按钮也不渲染，被阻断用户连"升级"都无法点击。',
    defense: 'gate.js 的 readGateText 有 zh/en 字典兜底机制——但那在主进程侧（enforce-gate-text.js），gate 渲染层确实依赖 preload 传值。defense 不成立。',
    verdict: 'upheld',
    rationale: '实测：phase5-ipc.js 的 handlerDependencies 无 gateTexts 键（grep 0 命中），ipc-handler 读 deps.gateTexts || null 恒 null。修复：enforce-gate.js ipc-handler 改为 require("../../electron/services/enforce-gate-text") 直接读主进程字典（编译期常量，无需 deps 注入），sendSync 恒有值。已在分支顶提交修复。',
  },
}

for (const it of j.items) {
  const r = rulings[it.id]
  if (!r) { console.error('no ruling for', it.id); process.exit(1) }
  it.prosecution = r.prosecution
  it.defense = r.defense
  it.verdict = r.verdict
  it.rationale = r.rationale
}
fs.writeFileSync(f, JSON.stringify(j, null, 2), 'utf-8')
const filled = j.items.filter(it => it.verdict).length
console.log(`filled=${filled}/${j.items.length}`)
