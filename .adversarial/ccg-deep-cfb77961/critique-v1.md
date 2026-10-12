{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "预算耗尽先 stop() 在途导航再 2.5s 重试：stop 会中止正在异步种 web_session 的页面 JS/XHR，恰是 r2-i5 想救的『差临门一脚』场景，重试对该场景永远拿不到凭证，机制失效。",
      "suggestion": "重试窗口内保持导航存活，仍缺再 stop；或把重试移到 stop 之前。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "轮询以 Date.now()<deadline 与 budgetExhausted 双条件退出，末次 500ms 轮询续体可能先于 timeout 回调执行，此时 stop()/短重试/失败标记全部被跳过即直接 settle，兜底保障不成立。",
      "suggestion": "让 timeout 回调 resolve 单一退出信号，删除 deadline 判断，退出后统一走 stop+重试。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "web_session 若为 host-only 域(www.xiaohongshu.com)，isPlatformCookieDomain 只认 .xiaohongshu.com 则凭证永命不中，每次登录空耗 17.5s 且 -100 根因未闭合却只留静默日志；测试仅用 .xiaohongshu.com 理想域。",
      "suggestion": "核对 isPlatformCookieDomain 对 host-only 域匹配；测试补 host-only 域用例。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "loadURL 只 catch promise rejection；view 已销毁时 view.webContents 求值同步抛 TypeError 逃出模块，违反头注释『绝不阻断登录』不变式，可能让登录流程异常中断。",
      "suggestion": "整段包 try/catch，异常只留日志不抛出。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "performance",
      "finding": "每次小红书登录全量加载 www 首页并 500ms 轮询 cookies.get(≤30 次)，最长 15s+2.5s 兜底压在登录关键路径，延迟显著增加且无基线实测；轮询每次取全量 cookie。",
      "suggestion": "用轻量登录态探测替代整页加载；记录登录延迟基线。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "security",
      "finding": "redirect/proof 是共享通用表，未来新增条目(或配置被篡改)会让登录窗携带真实会话 Cookie 导航到任意 URL，当前无 scheme/host 校验。",
      "suggestion": "loadURL 前校验 scheme=https 且 host 落在平台域名白名单。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "导航到 www 后 _extractAuthData 读到的 localStorage 是 www 源，creator 域 localStorage 标记可能从快照丢失；若 xhs 依赖 LS 标记(参照 PLATFORM_LS_SESSION_MARKERS 机制)则引入回归。",
      "suggestion": "确认 xhs 不依赖 creator localStorage 标记，或提取前锁定原 origin。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "snapshotWillMissMainSiteSession 失败标记与 cookies.get 抛错转走补跳路径均无测试断言，『可观测/不阻断』声明未验证；C4 只断言行为了事。",
      "suggestion": "C4 补断言失败标记日志；补 cookies.get reject 用例。"
    }
  ],
  "dimensionScores": {
    "correctness": 5,
    "security": 7,
    "performance": 5,
    "maintainability": 7
  }
}