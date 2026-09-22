{
  "schemaVersion": 1,
  "round": 3,
  "responses": [
    {
      "issueId": "I1",
      "decision": "accepted",
      "evidence": "接受。v-final 将问题 8 标题标注【定级 P0，v-final 晋升】，并在 P0 章节末加指针说明（物理条目保留于 P1 块以维持 1-15 编号连续），总体结论补列第四项硬伤（JWT 字面量）。消除 P0/P1 双定位与摘要/清单/批次的矛盾。"
    },
    {
      "issueId": "I2",
      "decision": "accepted",
      "evidence": "接受。v-final 删除问题 8 内被 L1 证伪的旧机制句\"解析为空（触发问题 4 或直接拒启）\"，仅保留订正后的机制（公开常量→伪造 admin 令牌→P0），避免同条目正文与证伪并置。"
    },
    {
      "issueId": "I3",
      "decision": "accepted",
      "evidence": "接受。v-final 将问题 8 纳入 P0 关闭前置清单：新增\"逐机核对 systemd unit（ops-center.service 而非仅 .env/EnvironmentFile）是否残留 ${...} 字面量\"\"OPS_JWT_SECRET 已替换为独立随机值并作废历史令牌\"\"与 orchestrator 的 PO_SECRET_KEY 解耦已验证\"三项勾选项。"
    },
    {
      "issueId": "I4",
      "decision": "accepted",
      "evidence": "接受。v-final 删除第一批\"1-2 天\"总体口径，限定批预算=代码改动+单机 pytest/打包验证；泄露排查清单与客户端升级阈值单列为问题 1/2/8 的跨环境关闭前置，明确非本批可交付物。"
    },
    {
      "issueId": "I5",
      "decision": "accepted",
      "evidence": "接受。v-final 量化双钥/宽限期：旧默认公钥信任截至=轮换后 90 天、到期拒绝旧钥签发；\"安全阈值\"量化为 ≥95% 活跃客户端升级并配套强制升级/离线兜底；显式声明宽限期内旧客户端仍处已泄露私钥伪造的残余风险敞口。"
    },
    {
      "issueId": "I6",
      "decision": "accepted",
      "evidence": "接受。v-final 在未覆盖登记表前新增\"AGENTS.md QM-2 合同覆盖矩阵\"，逐条标注 covered/out-of-scope（附理由），未覆盖项复用 v3 的触发节点/归属批次机制登记，使体检与仓库既有安全基线对齐。"
    }
  ]
}
