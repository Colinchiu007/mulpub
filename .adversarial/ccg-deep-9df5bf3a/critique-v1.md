{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Critical",
      "dimension": "correctness",
      "finding": "确认链新增的两处一次性计数读取（流程开头读 baseline、recheck 的 goto 后读）都不等节点就绪；SPA 晚挂载是本轨自认前提，读不到即 None，baseline=None 会静默禁用唯一确认判据，慢网下每次真实保存都报 XHS_UNCONFIRMED——与 4e 刚修的一次性解析同类复发。",
      "suggestion": "baseline 与 recheck 都用 wait_until 对计数节点轮询就绪（上限沿用常量），读不到须留痕并继续等。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "判据「now>baseline」假定每次运行都新建草稿槽；自动保存复用既有槽（含上次失败残留草稿）时计数不增量，重试永远假失败；recheck 单次读取且无保存完成等待，大媒体刚传完也易读不到增量。",
      "suggestion": "对保存窗口多次轮询计数，判据改为计数≥基线且可附新增标题兜底；重试前显式记录并容忍既有基线。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "draft_box_count 用硬编码正则 `草稿箱\\((\\d+)\\)`，节点文本格式/全角括号/locale 变化即 parse None，唯一确认通道静默失效且无用例钉住格式。",
      "suggestion": "解析兼容半全角括号并留痕；把活体取证的原始节点文本作为样例钉进测试。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "performance",
      "finding": "草稿路径先等 CONFIRM_TIMEOUT_S=20s 的 XHR（4o 已证自动保存不打 /note），再全页 goto 重载读计数；每次成功保存固定 ≥20s 延迟加一次整页往返。",
      "suggestion": "4o 定案后把 XHR 等待降为短窗或并行，计数判据提到第一优先级。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "计数判据仅由一次人工观测（0→1）支撑，缺「已有草稿/重试/并发写入」用例；失败尝试因自动保存仍留下草稿，下次 baseline 被污染使判据恒假，且没有任何用例变红。",
      "suggestion": "补「基线>0 且保存复用槽」「失败后重试」两类用例；验收口径明确失败残留草稿的处理。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "公开发布路径仍调用 _recheck_draft_box(baseline=None)，标题兜底未禁用；XHR 与 URL 双 miss 时草稿箱相似标题会把公开发布误报成功且 url 指向草稿页。",
      "suggestion": "公开路径不进入草稿箱回查，或要求显式 success URL 跳转才确认。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "测试模块级 COUNTER_SEL 在 import 时绑定 xhs.DRAFT_BOX_COUNTER_SELECTOR；将来 monkeypatch 该常量后用例读旧值，验证对象错误且不会红。",
      "suggestion": "用例内每次读取 xhs.DRAFT_BOX_COUNTER_SELECTOR，不在模块顶层绑定。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "performance",
      "finding": "每次存草稿新增风险扫描+计数探测+全页 reload；risk_present 5 宿主×probe 32 的 DOM 往返多轮提及仍未缓解。",
      "suggestion": "计数与风险探测复用一次扫描；recheck 先在本页尝试读计数再决定是否重载。"
    }
  ],
  "dimensionScores": {
    "correctness": 5,
    "security": 8,
    "performance": 6,
    "maintainability": 6
  }
}