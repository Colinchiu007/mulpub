{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Critical",
      "dimension": "correctness",
      "finding": "文本轨用 `count()>0`+`inner_text()` 但全程不查可见性：SPA 常驻的隐藏 modal/captcha/verify 模板容器只要含「请完成验证」「滑块」等默认文案，每次发布都误判 XHS_RISK_BLOCKED，正中方案自述最有害的误判；词表裸「滑块」也会命中封面裁剪等良性弹窗文案。",
      "suggestion": "读文案前先 `is_visible()` 过滤隐藏容器；词表删裸「滑块」，保留「滑块验证」「拖动滑块」等成句口径。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "每 host 只读 `.first` 元素文本：`[class*=\"modal\"]` 同时命中多个容器时，风控弹层不在 DOM 首位即漏判，照常发布进风控会话；`[class*=\"verify\"]`/`[class*=\"captcha\"]` 类名启发也可能命中常驻侧栏部件。",
      "suggestion": "去掉 `.first`，遍历 host 全部匹配项文本；或统一改为「可见容器内成句文案」单一口径。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "上传控件等待由 30s 收紧至 `NAVIGATE_READY_TIMEOUT_S=10s` 且 fail-closed：慢网 SPA 下控件未挂载即整体失败，媒体草稿连文本都不入库；旧路径至少保文本，10s 对已知慢站点偏紧，易常态化误伤。",
      "suggestion": "上传控件沿用 `UPLOAD_FALLBACK_WAIT_TIMEOUT_S=30s` 与编辑器一致，仅保留 fail-closed 语义；或给媒体草稿增加一次重试。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "守卫混入格式化耦合的子串断言（`'label=\"编辑器\"'`、`\"未就绪\"`、`\"wait_until(\" in src`）：引号/措辞调整即假红，与 PR-1 旧守卫假红属同一失效类；`==30.0`/`==10.0` 又与 selectors 常量重复定义。",
      "suggestion": "删格式化子串断言，保留调用图断言加行为用例；常量值断言改为从 selectors 导入引用，避免双份定义漂移。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "§4e③ 指出的系统洞未修：python-backend pytest 仍不在任何 CI workflow，新守卫同样不参与合并阻断；「本地实跑」正是上次漏检的人工环节，守卫变红依旧无声。",
      "suggestion": "将 xiaohongshu 相关 pytest（含 test_p4_wait_until）接入 gui-test.yml 或独立 workflow，使守卫红成为合并阻断项。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "`wait_until` 成功后二次 `_resolve_visible` 有 TOCTOU：控件在两次调用间隙被 SPA 重渲染移除则返回 None → 偶发 CODE_UPLOAD_FAILED；docstring「不臆断失败」与上传侧 fail-closed 语义矛盾。",
      "suggestion": "`wait_until` 返回时直接带回成功 locator，不再二次解析；docstring 改为「上传侧按 fail-closed 处理」。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "performance",
      "finding": "`_risk_present` 每次最多 5 次 `count()`+5 次 `inner_text()`，`inner_text()` 在大型 modal 子树强制排版；若流程多处调用则热路径 DOM 往返成倍。",
      "suggestion": "按页缓存风控判定结果；或合并为单次查询、仅取可见容器文本。"
    }
  ],
  "dimensionScores": {
    "correctness": 4,
    "security": 8,
    "performance": 7,
    "maintainability": 6
  }
}