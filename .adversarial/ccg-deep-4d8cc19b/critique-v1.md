{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "强档英文词 captcha/canvas illegal/risk control 未加标识符边界：recaptcha、HTML5 canvas illegal state 等自动化/浏览器常见报错会判 strong 并挂起冻结账号，复发本次要消灭的裸子串误判类（误判比漏判更有害）。",
      "suggestion": "ASCII 强词统一加 (?<![A-Za-z0-9])…(?![A-Za-z0-9])，并把 recaptcha/canvas illegal 等并入 FALSE_POSITIVES 回归锁。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "classifyRisk 对字符串 code 直查 Set：RISK_CODES 数字码只有 number 形态，code:'601'/'10000015'（平台字符串回传）判不中，与 PRD§4.1『string|number 均合法』及注释『两形态都收』矛盾，真风控漏判。",
      "suggestion": "纯数字字符串 code 先 Number(code) 再查 Set，并补 '601'/'10000015' 字符串形态用例。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "publish-mode-runner 的 outcomeOfResult 仍持私有码表（无 601/RISK_BLOCKED），stop 分支双重闸门（outcome==='risk_blocked' 且 suspends）。引擎轨 code:601+普通文本→transient→降级 DOM 不挂起，桌面轨却挂起，两侧分裂，G6 单一真源未真正落地。",
      "suggestion": "outcomeOfResult 改查 RISK_CODES，或挂起闸门只以 riskVerdict.suspends 为准。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "attachRiskSignals 双实现：引擎 publishViaApi 内联仅认 loginExpired（无 login_expired），桌面独立函数认双形态；且 loginExpired 到 task-queue 即丢（只搬 errorCode/riskBlocked），新字段半程管线假完备。",
      "suggestion": "抽共用 attach 助手；task-queue 补 loginExpired 落 task，或从改动范围移除该字段。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "引擎 stop 分支 riskBlocked 用 !!(a.riskBlocked||a.risk_blocked) 真值强转，PRD§4.1 要求严格 ===true（'true'/1 不算），桌面经 task-queue 已严格布尔——两侧校验口径不一致。",
      "suggestion": "引擎处改 === true 严格比较，与桌面/PRD 对齐并补用例。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "文案计数自相矛盾：Impact 与 PRD§9 写『5 个新 key』，实际列出 6 个，CHANGELOG 又写 6，验收文档口径不一。",
      "suggestion": "统一为 6 并核对 zh/en 成对清单与基线快照。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "横幅粒度判定只认 accountId==null；空串 ''（==null 为假）会渲染空白账号名而非『全平台账号』标签，语义与 phase4 归一的 null 不一致。",
      "suggestion": "tracker normalize 将 '' 归一为 null，或用 accountId==null||'' 判平台级。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 8,
    "performance": 9,
    "maintainability": 7
  }
}