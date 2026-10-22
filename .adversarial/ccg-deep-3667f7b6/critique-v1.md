{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1-adj",
      "severity": "Critical",
      "dimension": "maintainability",
      "finding": "adjudication.json 使用 self-play 对高危域（crypto/auth）做裁决，违反自身规则：highRiskDomains 非空时必须 externalReview 三格填满（performedBy==claude、可验证 URL、ISO 时间），且 highRiskNote 明确写「不允许自扮演豁免」。实际 performedBy/evidenceRef/reviewedAt 全为 null，adjudicatedBy 却是 self-play。",
      "suggestion": "立即撤回 self-play 裁决；补 full externalReview（performedBy=claude、evidenceRef=https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>、reviewedAt=ISO）；若无法补齐则按 high_risk_requires_external 阻断，不得以 confidenceWeight=0.6 放行。"
    },
    {
      "id": "i2-adj",
      "severity": "Critical",
      "dimension": "correctness",
      "finding": "adjudication 对 i1/i2 声称「已删除 .ccg/reviews/b38ecfbb*.json 与 .ccg/reviews/86e2add5*.json（中间态记录）」，但提交 diff 里这三条记录（51cfda48、86e2add5、b38ecfbb）仍以 new file 模式出现，且 sha 字段指向旧提交（99365bd5、d99bff15、2dbda692），与当前分支 head 3667f7b67 无关。裁决理由与实际提交内容不符。",
      "suggestion": "重新生成与当前 diff 内容寻址（stagedDiffHash）严格匹配的审计记录；删除所有指向非当前提交 SHA 的中间态文件，并在 adjudication 的 fixApplied 中列出被删文件的精确哈希，供后续复核。"
    },
    {
      "id": "i3-adj",
      "severity": "Critical",
      "dimension": "correctness",
      "finding": "proposal-v1.md 声明 base=origin/main、head=780717afc...，但实际工作树分支 head 为 3667f7b67（git status 及 commit 3667f7b）；.ccg/reviews/6cc829...（sha=3254ec9b）与 .adversarial/ccg-deep-780717af/ 目录内所有文件引用的 SHA（780717af、99365bd5、2dbda692、51cfda48）均与当前提交无关，审计轨迹与被审代码脱节。",
      "suggestion": "将 adjudication、proposal、所有 .ccg/reviews 记录的 SHA / stagedDiffHash 重对齐到实际 head 3667f7b67；若这些记录是历史中间态则从仓库删除并在 adjudication 中注明删除 SHA，避免后续复盘误判改动规模（1588 行）或模式（dual/single）。"
    },
    {
      "id": "i4-adj",
      "severity": "Critical",
      "dimension": "maintainability",
      "finding": "高危域条目 i4（auth）同样缺 externalReview 三格（performedBy/evidenceRef/reviewedAt 为空），而 adjudication 仍标 verdict=upheld 且无阻断说明。security 维度在 critique-v1.md 只得 6 分（低于合格线），但 adjudication 未体现任何安全门禁拦截。",
      "suggestion": "对 auth 高危项同样执行外部复核（expectedExternalBackend=claude）；在 adjudication 中补写 performedBy、真实可点评论 URL、ISO 时间戳；若无法完成则 verdict 改为 blocked 且 PR 不得合并。"
    },
    {
      "id": "i5-adj",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "adjudication 的 items 只覆盖 i1、i2、i3、i4、i5、i8，缺失 i6（security：accept-baselines.js RegExp 注入，已在 diff 中修复 escapeRegExp 但未入 adjudication）与 i7（correctness：transition:all 替换后新 transform/box-shadow 过渡与组件级动画潜在冲突，未裁决、未修复、未记录）。",
      "suggestion": "补录 i6（verdict=dismissed 或 upheld 并注明已应用 escapeRegExp）与 i7（给出明确 verdict：若已验证无冲突写 dismissed 并附测试命令；若存在写 upheld 并列出受影响组件与回归测试）；items 数组必须与 critique-v1.md 的 issue 列表一一对应。"
    },
    {
      "id": "i6-adj",
      "severity": "Warning",
      "dimension": "security",
      "finding": "i6（accept-baselines.js 的 RegExp 注入）虽在代码 diff 中已修（新增 escapeRegExp），但 adjudication.json 未包含该条目，意味着安全修复未经过正式裁决与外部复核记录，未来回溯时无法确认修复是否经审。",
      "suggestion": "在 adjudication items 中新增 i6，verdict 根据实际验证结果填写（若已跑通测试写 upheld 并引用测试文件路径），并确保高危域（若有）同样填满 externalReview 三格。"
    },
    {
      "id": "i7-adj",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "i7（cohere-design-system.css 替换 transition:all 后新增 transform/box-shadow 过渡可能与组件级动画冲突）在 adjudication 完全缺失；diff 中 premium-design-system.css 新增了大量 transition 属性列举（transform/box-shadow），但无任何回归测试或视觉基线对比证明无冲突。",
      "suggestion": "在 adjudication 补录 i7；运行 `pnpm test:visual:pixel`（亮/暗双主题，阈值 0.06）并将结果写入 fixApplied 或 rationale；若基线漂移超过阈值则 verdict=upheld 并要求修复后重做基线。"
    },
    {
      "id": "i8-score",
      "severity": "Info",
      "dimension": "performance",
      "finding": "dimensionScores 维度分：correctness=5、security=6、performance=5、maintainability=3，整体偏低。adjudication 以 confidenceWeight=0.6、self-play 方式在高危域放行，未提供公开可点证据 URL，审计轨迹与实际提交 SHA 不一致，这些均会降低可维护性与正确性评分的可信度。",
      "suggestion": "修复上述 i1-i7 后重新计算维度分：若所有高危项完成外部复核且基线零漂移，correctness/maintainability 可提升至 ≥7；performance 需附真实 Electron 窗口 GPU 帧率数据（而非仅静态背景推论）才可提升至 ≥6。"
    }
  ],
  "dimensionScores": {
    "correctness": 4,
    "security": 5,
    "performance": 5,
    "maintainability": 3
  }
}