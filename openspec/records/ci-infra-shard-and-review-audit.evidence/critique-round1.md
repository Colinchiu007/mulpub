{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Critical",
      "dimension": "correctness",
      "finding": ".ccg/reviews/89986...json 的 sha 字段为 337d8f9ff，而 PR head 为 0ac3db3de，两者不符，审计证据与被审提交脱钩。",
      "suggestion": "将 JSON 里的 sha 更新为 head commit SHA，并验证 stagedDiffHash 与实际 diff 一致。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "audit 模块自定义 CLOSED_STATUSES，未与 check-pr-exec-record.js 的白名单共享源码，未来同步修改易遗漏。",
      "suggestion": "将 CLOSED_STATUSES 提取到共享模块并由两文件共同导入。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "proposal.md 混合已落地的审计实现与未落地的分片方案（未改 electron-ci.yml），文档边界模糊。",
      "suggestion": "将未落地方案拆分为独立 design-doc，并明确标注「未提交实现」的文件列表。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "performance",
      "finding": "auditHistoricalDebt 同步读取全部 .json 记录，无流式处理，记录数增长时耗时线性上升。",
      "suggestion": "增加可选 --stream 或分批读取，并记录当前耗时基线用于回归检测。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "security",
      "finding": "audit 路径接收 --repo=任意目录，无路径限制检查，可能读取非项目目录的 .ccg/reviews 数据。",
      "suggestion": "在 audit 入口增加路径校验，确保 repo 在工作区内且为 git 仓库。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": ".github/workflows 注释为中文，自动化门禁解析可能无法识别「无人守门」语义。",
      "suggestion": "将关键注释翻译为英文，或提取为机器可读的 gate-description 标签。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 7,
    "performance": 5,
    "maintainability": 4
  }
}