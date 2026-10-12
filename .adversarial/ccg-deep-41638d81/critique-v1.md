{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "就绪判定不可靠：loadURL resolve（did-finish-load）或 15s 超时都不保证 web_session 已种下——主站可能整页加载后才由 JS/XHR 种 cookie，或因未识别登录态跳去登录页。若仍缺 web_session，-100 根因会在无任何针对性反馈下复现。",
      "suggestion": "race 结束后用 session.cookies.get() 校验 web_session，缺失时输出独立失败标记日志（不阻断），让该修复是否真生效可观测。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "performance",
      "finding": "补跳无条件执行：即使同会话早前登录过主站、cookie 已含 web_session，也强制 loadURL 主站并等整页 did-finish-load，每次 xhs 登录成功路径都新增一次主站往返+整页加载延迟。",
      "suggestion": "先快速读一次 cookie 判定缺 web_session 才补跳；只需移 Redirect 前做一次 cookies.get 短路。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "核心前提未取证却写进断言：机制依赖 creator 会话 Cookie 为父域(.xiaohongshu.com)作用域且主站愿据此授 web_session。若实际是 host-only 作用域或主站不授，机制整体失效而测试全绿（fixture 直接把假设固化为断言）。",
      "suggestion": "用 CDP 实测/手工 E2E 取证主站确实种下 web_session，取证结果以注释或文档固化，勿把未验证假设写成断言。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "契约测试锁的是『调用了 loadURL』而非『快照包含 web_session』：_extractAuthData 桩无条件返回含 web_session 的 cookie，即使二段式整体失效（URL 对但主站不种 cookie），C2/C3/C4 依旧全绿，目标缺陷可以长期存活。",
      "suggestion": "为 xhs 增加『无 redirect 时快照缺 web_session』的桩场景，断言 redirect 后才补齐；再对真实 hasCapturedCredentials 逻辑做一次集成式断言。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "makeManager 用 Object.create(prototype) 跳过构造函数并手工补约 20 个实例字段，字段更名或构造逻辑变更会静默漂移；改用 # 私有字段后测试直接失效，测试与实现字段名强耦合。",
      "suggestion": "优先走真实构造函数+依赖注入（注入 session/logger 桩），把字段级手工桩收敛到最小面。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "15s 兜底命中后未取消仍在途的 loadURL：主站导航可能在快照抓取期间才落地，页面导航状态与抓取时序竞争，后置错误仅被 catch 吞掉无痕，影响抓取确定性。",
      "suggestion": "超时分支先调用 webContents.stop() 再抓快照，并确认靠后落地的导航不影响会话快照判定。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 9,
    "performance": 7,
    "maintainability": 6
  }
}