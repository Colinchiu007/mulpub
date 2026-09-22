{
  "schemaVersion": 1,
  "round": 1,
  "responses": [
    {
      "issueId": "I1",
      "decision": "accepted",
      "evidence": "接受。v2 在问题 1/2 修复方案中明确\"视为已泄露→强制轮换密钥对\"，并在验证方式新增可勾选的泄露面排查清单（git log -S 检索 PEM/弱密钥历史提交、部署机 .env/EnvironmentFile、CI/CD Secret、内置默认公钥分发渠道清单），将\"轮换完成+清单闭环\"设为问题 1/2 的关闭前置条件（同时吸收 I7 的 DoD 要求）。"
    },
    {
      "issueId": "I2",
      "decision": "accepted",
      "evidence": "接受。报告修复方向已核实：key_service.py:38 单参数 vs prompt_eval_service 两参数版本存在，TypeError 被吞属实。v2 补细案：先写复现红测试锁定假回退；except 收窄为精确异常；失败返回可区分的 decrypted=false+reason 并记结构化 warn（不含密钥材料）；回归验证回退真实生效、连通性不再误报成功。"
    },
    {
      "issueId": "I3",
      "decision": "accepted",
      "evidence": "接受。v2 补 fail-closed 细则：启动期校验 OPS_ENCRYPTION_KEY 非空且 Fernet 格式有效，任一 worker 失败即整进程非零退出；生产禁止自生成，开发显式开关+启动告警；历史密文不可解按条降级掩码并记 audit，不自动清洗、不整表 500。并采纳 I8 顺序依赖：#3 先行、#4 与降级预案同批、预发布先验。"
    },
    {
      "issueId": "I4",
      "decision": "accepted",
      "evidence": "接受。v2 将问题 9 修复方案改为硬约束：success 绑定 title/desc 非空校验；空结果一律 success=false+reason=api_stub_not_implemented；或显式移除分支统一浏览器兜底；补污染事件打点（platform=bilibili, mode=api_stub）防静默下游聚合。"
    },
    {
      "issueId": "I5",
      "decision": "accepted",
      "evidence": "接受。v2 将问题 6 与 15 整合为会话安全矩阵：credentials=true 时 allow_origins 禁止 *（启动期配置校验直接拒绝该组合）、白名单精确匹配；Cookie 迁移必须同步更新 CORS/CSRF/CSP 三件套，两处条目互相引用验收。"
    },
    {
      "issueId": "I6",
      "decision": "accepted",
      "evidence": "接受。v2 补豁免治理：豁免清单集中单文件（显式业务理由+风险等级+到期日/移除条件），豁免下限=只读/非破坏/非外发；CI 既校验 handler 声明完备，也校验豁免条目变更需审批；豁免命中记审计日志。"
    },
    {
      "issueId": "I7",
      "decision": "accepted",
      "evidence": "接受。v2 验证方式全面 DoD 化（P0 关闭前置清单含责任人/证据形态；P1 关闭条件=红转绿+门禁+CHANGELOG）；假设与边界量化置信度：IPC 覆盖统计为全量正则（高置信），P2 超大文件未穷尽逐行，第三/四批执行时补抽样。"
    },
    {
      "issueId": "I8",
      "decision": "accepted",
      "evidence": "接受。v2 第一批内部显式排序：先 3（decrypt_key 修正）后 4（fail-closed），4 与历史密文掩码降级预案同批交付并先预发布验证，防启动阻断；第一批交付物含启动失败应急/回滚指引。"
    }
  ]
}
