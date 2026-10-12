{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "「就绪=loadURL resolve(did-finish-load)」与 web_session 种入机制脱节：注释承认主站可能整页加载后由 JS/XHR 异步种 cookie。did-finish-load 早于 JS 种 cookie 时，快照仍会缺 web_session，-100 复发——就绪代理与真实目标不一致。",
      "suggestion": "改为轮询 hasPostLoginProofCookie（如每隔一定间隔检查直至出现或超时），把「主站已种下会话」作为就绪判据而非 did-finish-load。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "C3b 的「快照结果锁」是自证：_extractAuthData 被桩成返回 sessionCookies.slice()，而 web_session 是用例向同一数组 push 后导入的。断言「快照含 web_session」必然成立，无法发现真实 _extractAuthData 漏读 cookie 的回归。",
      "suggestion": "让 _extractAuthData 桩读 currentView.webContents.session.cookies.get 桩返回来做投影，并让 sessionCookies.get 只返回同一数组，使断言走真实读取路径。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "补跳前 hasPostLoginProofCookie 只校验 name+value 非空，不查 expiry/domain/lastAccess。creator 域登录窗里若有别的账号或已过期的残留 web_session，会误短路跳过补跳，抓到过期/错账号会话，note 仍-100或冒充他人态。",
      "suggestion": "短路径校验改为同时核对 cookie.domain 含 www/.xiaohongshu、expiry>now，并记录 source(domain) 佐证来源，防旧会话误判。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "超时兜底路径抓到的快照仍缺 web_session，PR 声称的「-100 根因闭合」在慢响应场景不成立，且仅打 warning 不再重试或阻断。首次真实登录踩15s超时有较高概率仍复现 -100，结论欠实。",
      "suggestion": "超时后对 proof 缺失做一次性短重试（如延后 2-3s 再取一次且窗口为 2 次），或以可观测失败标记回归真机圈验，勿称已闭合。"
    },
    {
      "id": "i4",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "15000 常量私有于 auth-view-manager，测试用 16000 靠魔数对齐；证明 Cookie 表在 platform-definitions，等待时长归属两处，耦合隐式且易随改动失同步。",
      "suggestion": "把 POST_LOGIN_REDIRECT_WAIT_MS 随 redirect/proof 表一并导出到 platform-definitions，测试引用它推算计时而非硬编码。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "performance",
      "finding": "登录成功后在自动完成定时器回调内同步插入最长 15s 的全页 loadURL+DOM 等待，阻塞登录收尾；主站未就绪时窗口停在 www 首页、对用户可见且串联主流程，无进度提示。",
      "suggestion": "将补跳改为后台并行导航不阻塞 settle；若保留顺序等待，补跳前在登录窗加轻量过渡文案并缩短兜底窗口。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 8,
    "performance": 6,
    "maintainability": 6
  }
}