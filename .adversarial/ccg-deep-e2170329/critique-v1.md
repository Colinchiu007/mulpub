{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "visible_texts/visible_count 用 total=min(count(),limit) 在 DOM 序上截断且先于可见性过滤：portal 渲染常把弹层 append 到 body 尾部，若前 8 个命中节点多为隐藏模板，真实可见风控层(index≥8)永不被扫，两轨同时漏判并放行发布；docstring『风控层靠前』是未验证假设。",
      "suggestion": "改为扫到收集够 limit 个可见元素为止（另设 DOM 硬上限），并补『风控层在末尾仍被抓』的用例。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "静态守卫仍按源码字面量断结构：'async def _await_upload_input('、'await dom.await_control('、count('await self._await_control(')≥2——helper 改名或调用形式调整即假红，正是 4f-i4 声称已除的格式耦合类，两轮评审点到仍未处理。",
      "suggestion": "降为最少结构断言（_await_control 存在+两处调用），其余交给哨兵值/日志行为用例。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "test_upload_wait_poll_count_matches_its_own_ceiling 断言 1<=calls<50 过宽：interval 误用 0.5（约2次查询）或超时误用 9.99 均落入区间，『误用等待常量』回归可假绿；候选链多元素还会放大查询次数。",
      "suggestion": "按 ceil(timeout/interval)±1 取确定性区间，并在用例内固定单元素候选链。"
    },
    {
      "id": "i4",
      "severity": "Info",
      "dimension": "performance",
      "finding": "risk_present 每次存草稿最多扫 overlay + 5 宿主 × 8 节点，每节点 is_visible+inner_text 两次 DOM 往返；无命中时全扫无短路，慢网下逐次叠加延迟。",
      "suggestion": "将宿主/limit 预算显式化；同一选择器在 overlay 与文本轨的重复扫描合并缓存。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "CI 步骤硬编码 5 个测试文件，无结构校验绑定 tests/ 目录与 workflow 清单；新增发布器测试文件静默不入门禁，重蹈『回归不阻断』旧洞。",
      "suggestion": "加守卫：tests/ 下发布器测试文件集合与 CI 步骤所列一致，新增须显式登记。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "test_upload_poll_constant_is_imported_in_publisher 只断 NAVIGATE_* 存在；UPLOAD_FALLBACK_POLL_INTERVAL_S 无『被引用+生效值』覆盖，发布器内硬编码间隔不红。",
      "suggestion": "把上传轮询间隔常量并入发布器引用与生效值断言。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "set_cover 仍保留盲等 sleep(2)，新守卫按 <3.0 数值判使其合法化；且正则只匹配 asyncio.sleep( 形式，'from asyncio import sleep' 写法可绕过禁令。",
      "suggestion": "set_cover 改轮询封面上传控件；守卫同时覆盖 from-import 形式或改用 AST。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 8,
    "performance": 7,
    "maintainability": 6
  }
}