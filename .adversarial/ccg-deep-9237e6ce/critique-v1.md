{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "编辑器等待的常量接线零行为保护：spy 用例只在媒体流里跑，上传先 fail-closed 中止、编辑器等待从未执行，seen 只含上传配对；日志用例也只断 title_input 不断哨兵值 0.05——编辑器等待若错配到 UPLOAD 常量(30s)，全绿只是变慢。",
      "suggestion": "在 test_editor_ready_timeout_leaves_a_reason_in_logs 断言日志含哨兵 0.05，或补无媒体流 spy 捕获编辑器配对。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "RISK_HOST_PROBE_LIMIT=32 仍是按 DOM 序截断：>32 个常驻隐藏模板先占位时第 33 位的真实风控层永不被扫，两轨同漏（本轮只是把悬崖从 8 移到 32）；且新常量无被引用/生效值断言，删接线不红。",
      "suggestion": "补 >probe_cap 隐藏模板边界的哨兵用例（可接受漏判须显式留痕），并为 PROBE_LIMIT 加引用+生效值守卫。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "RISK_TEXT_PATTERN 仍含裸「验证码」「风控」，与注释自称\"只收强指认短语、不收裸词\"直接矛盾；可见良性弹窗（账号绑定\"输入验证码\"）命中即判 XHS_RISK_BLOCKED 中止草稿保存。",
      "suggestion": "删裸「验证码」「风控」只留成句强指认短语，或同步改写注释口径，消除自述矛盾。"
    },
    {
      "id": "i4",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "盲等禁令正则只匹配 asyncio.sleep( 形式，`from asyncio import sleep` 写法可绕过；set_cover 的盲等 sleep(2) 被 <3.0 阈值合法化为永久存在的无条件等待。",
      "suggestion": "守卫改 AST 或补 from-import 形式匹配；set_cover 的 sleep(2) 改条件轮询封面上传控件。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "performance",
      "finding": "每次存草稿 risk_present 最坏 5 宿主×32 次 is_visible + 至多 8 次 inner_text≈200 次 DOM 往返；无命中时全扫是常态，慢网上逐次叠加延迟，恰在本 change 针对的慢网场景。",
      "suggestion": "按命中概率排序宿主并命中即短路；overlay 轨与文本轨对同一选择器合并单次探测。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "CI 门禁仍硬编码 5 个测试文件：新增发布器测试文件静默不入阻断，tests/ 目录与 workflow 清单无结构校验绑定，重蹈\"回归不阻断\"旧洞。",
      "suggestion": "加守卫断言：tests/ 下发布器测试文件集合与 CI 步骤所列一致，新增须显式登记。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "test_p4_wait_until 仍以源码字面量断 helper 名与 `count(\"await self._await_control(\") >= 2` 断言结构，重命名/收敛调用形式即假红，多轮评审反复点到同一锚点。",
      "suggestion": "降为最少结构断言（_await_control 存在+两处调用点），其余交行为用例承担。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 8,
    "performance": 7,
    "maintainability": 6
  }
}