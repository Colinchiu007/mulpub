{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "security",
      "finding": "D4 契约仅提'127.0.0.1+token'，未定义 token 的生成、下发通道、TTL、轮换与撤销；经 argv/env 传入会被同机进程读取，防篡改但防不了窃取与重放。",
      "suggestion": "Spec 补 token 生命周期：启动时生成、短 TTL、单次有效，禁止经 argv/env 明文下发。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "security",
      "finding": "D1 将 evasions 以主世界注入，页面脚本可经 toString/行为探测对隐身代码本身指纹化，反成更稳定检测面，与 R3 evasion hash 检测面风险叠加。",
      "suggestion": "明确安装后自清理/极薄附着（不可直接 toString 读源），或说明与 D3 隔离域的配合方式。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "security",
      "finding": "D6 把 stealth 通道与 captcha 白名单做成可改配置，却无签名/完整性校验与篡改审计；本地改 JSON 即可静默绕过 kill-switch，回滚失效。",
      "suggestion": "配置加载时比对内置清单哈希或加签名，变更写入审计日志。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "completeness",
      "finding": "R2/R3 仅定'灰度校方差''首批取证'跟踪项，未定义首批样本量、异常中止条件与回滚触发阈值，风险敞口无量化出口。",
      "suggestion": "跟踪项补充具体阈值（检出率下限/误报上限）与中止回滚规则。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "completeness",
      "finding": "captcha 人工兜底未定义超时、取消与放弃路径；用户不干预时发布进度永久停留 captcha 相位，TERMINAL_PHASES 语义被破坏。",
      "suggestion": "设计补兜底超时/取消/失败终态及对应 UI 提示。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "consistency",
      "finding": "规格文件大小写混用：behavior/captcha 为 Spec.md，其余三个为 spec.md；大小写敏感 CI 与 glob 可能断链。",
      "suggestion": "统一小写 spec.md，并在 CI 加路径大小写校验。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "clarity",
      "finding": "D1 走 webFrame 主世界注入、D3 走 CDP createIsolatedWorld，双机制并存却不落边界：何种 evaluate 归哪个 world、worldName 冲突、页面探测可见性差异未说明。",
      "suggestion": "写明两机制职责边界与命名约定，并解释不复用同一 world 的原因。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "consistency",
      "finding": "文档时序矛盾：D2/D3 标'进 RED'，但 git log 显示行为层/隔离求值已实现且测试 GREEN；评审基准是计划还是回溯记录不明。",
      "suggestion": "每决策标注'已落地/待落地'，或补状态清单区分两者。"
    }
  ],
  "dimensionScores": {
    "completeness": 7,
    "consistency": 8,
    "clarity": 8,
    "feasibility": 8,
    "security": 7
  }
}