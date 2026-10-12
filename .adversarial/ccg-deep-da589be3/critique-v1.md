{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "hasPostLoginProofCookie 内 view.webContents 访问无防护：短路/轮询/重试三处都可能同步 throw（r3-i4 只护了 loadURL），视图销毁竞态下 waitForPostLoginSession 拒绝、登录卡死，违反『绝不阻断登录』不变式。",
      "suggestion": "函数体整体包 try/catch，或先查 webContents.isDestroyed() 再访问，三处统一防护。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "功能有效性全系『主站会种 web_session』这一未验证行为；主站不种（风控/未识别登录态）时每次登录固定多等 17.5s、窗口跳 www，结果仍 -100，不比现状好，降级面未量化。",
      "suggestion": "真机前置验证主站种 cookie 行为；失败路径统计发生率再定预算，或先缩至 2-3s。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "PRD §15『就绪判据=loadURL resolve』与实现（凭证轮询，注释明言不以 loadURL resolve 为准）同 PR 内互相矛盾，文档失同步。",
      "suggestion": "PRD 就绪判据改为『凭证轮询命中』，并注明 15s+2.5s 兜底时序。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "真实 web_session 的 domain 形状未取证，测试只定版 .xiaohongshu.com；若主站种 host-only www.xiaohongshu.com 而 isPlatformCookieDomain 严格匹配，proof 永不命中，每次登录白等满预算。",
      "suggestion": "真机核对 web_session 真实 domain，补 host-only 域形状用例。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "只配 redirect 忘配 PLATFORM_POST_LOGIN_PROOF_COOKIES 时每次登录静默等满 17.5s，无配置一致性校验，后续新增平台必踩坑。",
      "suggestion": "平台定义处加断言：redirect 存在 ⇒ proof 表项非空。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "performance",
      "finding": "cookies.get({}) 每 500ms 全量拉会话 cookie，最多约 30 次，多平台共会话的 cookie jar 场景浪费。",
      "suggestion": "cookies.get 按 name/domain 过滤，避免全量扫描。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "短路仅验名+值+域，不验时效；服务端已失效的旧 web_session 会跳过补跳，-100 静默重现。",
      "suggestion": "短路限『本次登录期内新增』的 proof cookie，或快照加新鲜度标记。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "manager 已按表过滤未配置平台，模块内同步 return 路径实际是死代码，『零微任务』注释叙事与接线不符。",
      "suggestion": "删 manager 前置门闩改由模块统一判定，或删模块内冗余检查，避免两处漂移。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 8,
    "performance": 7,
    "maintainability": 6
  }
}