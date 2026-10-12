{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "consistency",
      "finding": "D7 要求官方 Key 路径 SHALL 调用 createKmsFromEnv、不得另立第三套判断；但该函数是 JS（cloud-accounts/index.js），Python 迁移 CLI 无法调用，选择语义（keyring 优先、空白 vs 未配、双缺 INVALID）必在 Python 复刻，而 D1 防漂移锁与 D11 对拍均不覆盖选择逻辑。复刻错则生产可能静默用 local 单密钥封印全部官方 Key。",
      "suggestion": "将 KMS 选择语义纳入对拍与单测断言（含 alg 字面量），或两侧读取同一声明式配置，禁止 Python 独立实现判断。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "consistency",
      "finding": "D5 幂等判据（'有信封且可解开'即跳过）与续跑查询（envelope IS NULL）不一致：若存在'有信封但解不开'的行（误挂另一密钥环封印的残留），续跑会跳过它，D6 变红后却无修复路径被定义。",
      "suggestion": "续跑判据改为'无信封 OR 解不开'，并为 CLI 增加坏行重封印动作（--repair），与幂等判据对齐。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "security",
      "finding": "OQ2 未定案时步骤 7 不 gating：迁移 CLI 的 KMS 自检只验证往返成功、不验证 provider，生产若只配 MP_CLOUD_KMS_LOCAL_KEY 会静默用 local 单密钥封印全部官方 Key，错误在删列后固化且不可见。",
      "suggestion": "迁移 CLI 默认拒绝以 local provider 封印官方 Key，需显式 --allow-local（仅 CI/开发），使误配在迁移即失败。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "completeness",
      "finding": "key_service 写路径（双写期与仅信封期）遇 KMS 不可用的失败语义未定义；信封表 key_id 的 ON DELETE 行为未指定，删 official_keys 行可能留孤儿信封，D6-1 不覆盖。",
      "suggestion": "写明写路径 KMS 故障 fail-closed 及提示；FK 设 ON DELETE CASCADE，并把'无孤儿信封'纳入巡检。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "feasibility",
      "finding": "D11 要求密钥环包裹格式（id 前缀+iv+tag+密文）双向解析对拍 SHALL 进 CI；但 D12 的 CI 只配 MP_CLOUD_KMS_LOCAL_KEY（无密钥 id 前缀），keyring 格式对拍在 CI 无 fixture 可跑，需求与 CI 环境矛盾。",
      "suggestion": "为对拍提供独立 keyring fixture，或将 keyring 字节解析做成纯函数，测试注入字节样本（与 KMS 环境无关）。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "clarity",
      "finding": "D7 '明文不出模块：短时句柄/直接完成调用'未定义句柄接口形态与存活期；Node 服务端代调及 Python model_preset_service:1122 把 Key 发给上游如何落进该约束不明。",
      "suggestion": "spec 阶段给出句柄最小接口（如 withKey(callback)），明确不可序列化、不可长期持有、用完即弃。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "security",
      "finding": "D5 的 KMS 自检只证明'当前 KMS 往返可用'，不能证明所挂密钥环即运维意图之环；挂空/新环时自检通过、迁移与 D6 全绿，错误延至未来轮转才暴露。",
      "suggestion": "迁移报告记录环文件的密钥 id 列表，与部署文档登记的预期清单比对后才放行。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "consistency",
      "finding": "D10 优化提示（provider_plans 若步骤 3 前定型则用 v2 起步）与主决定'v1 锁定'并列，未说明两分支如何汇合、以及中途切换对步骤 3/5/6 与 D6-4 变异反证的影响。",
      "suggestion": "明确该提示仅步骤 1 决策前有效，步骤 1 后一律 v1，避免中途切换 AAD 材料。"
    }
  ],
  "dimensionScores": {
    "completeness": 7,
    "consistency": 6,
    "clarity": 7,
    "feasibility": 6,
    "security": 6
  }
}