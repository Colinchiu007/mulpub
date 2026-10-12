{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Critical",
      "dimension": "correctness",
      "finding": "整个修复值的核心前提未经验证：主站是否真会识别 creator 父域登录并种下 web_session。记录明确标真机验证 PENDING、-100 根因闭合以真机为准。若该假设不成立，二段式只是死代码且不修复 -100。",
      "suggestion": "合并前必须真机验证该机制；或加 feature-flag，未验证默认关闭；无法验证则明确降级为探索性改动而非修复。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "兜底路径先 stop() 再短重试。代码自述主站常在整页加载后才由 JS/XHR 异步种会话，而 stop() 恰会中止在途 XHR；若 15s 时 XHR 尚未完成，短重试永远轮不到 web_session，设计初衷（会话差临门一脚）反而失效。",
      "suggestion": "短重试前不调用 stop()，改为延后 stop 或仅对已 resolve 的导航 stop；短重试内多轮询并延长。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "performance",
      "finding": "登录成功到抓快照之间阻塞 15s+2.5s，期间登录窗口整个切换为主站页，用户可见且可能交互/重复触发登录或风控，延迟与观感都受影响。",
      "suggestion": "补跳期间遮罩或隐藏登录窗口；或按实际命中均值（1-3s）缩短预算并轮询提前结束。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "while 循环在每次 poll 前重评 deadline；若凭证在预算最后 500ms 段内出现，循环因时间耗尽直接退出，该凭证被漏检并误入降级路径，边界竞态恰好避开设计想捕获的命中。",
      "suggestion": "循环退出后再做一次凭证校验，或将 deadline 延长一个 poll 间隔再判降级。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "生产源码内嵌大量 CCG 评审编号注释（r1-i2/r2-i3/r3-i2/r4-i1/CI Gate4 等），把过程跟踪噪音混进设计意图，长期可读性与评审溯源混淆。",
      "suggestion": "评审处置编号移至 openspec/records，源码注释仅保留设计意图与不变式。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "C3a 结构锁只断言字符串包含（toContain），锁『同名接线』低于锁定设计意图；若平台定义改表名或导出结构，测试仍可能假绿。",
      "suggestion": "结构锁改为断言导出符号与常量值，而非源码字符串包含。"
    }
  ],
  "dimensionScores": {
    "correctness": 5,
    "security": 7,
    "performance": 5,
    "maintainability": 6
  }
}