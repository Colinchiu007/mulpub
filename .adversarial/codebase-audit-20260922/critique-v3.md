{
  "schemaVersion": 1,
  "round": 3,
  "issues": [
    {
      "id": "I1",
      "severity": "Warning",
      "dimension": "consistency",
      "finding": "问题 8 已在正文 [v3 更正]（proposal-v3.md:34）与第一批批注（:80）被内部晋升为 P0（JWT 秘密变公开常量可伪造 admin 令牌），但问题清单该条仍挂在『### P1 - MAJOR』标题之下，P0 章节（:10-18）仍只列 1/2 两条；同时总体结论（:5）『真正的硬伤集中在一条线……签名私钥入库、弱密钥闸门可绕过、加密主密钥静默自生成』仅列举三项，未包含新晋升的第 4 条 P0 级 JWT 字面量问题。同一文档内同一条目 P0/P1 定位并存，P0 章节与总体摘要与批次处置互相矛盾。",
      "suggestion": "把问题 8 整条上移至『### P0 - CRITICAL』章节并重排编号（或至少在其标题处标注官方定级 P0/P1 联动），同时更新总体结论摘要，将 JWT 字面量密钥问题并列为第四条硬伤；否则后续按 P0 清单排期的人会漏掉该条的关闭管理。"
    },
    {
      "id": "I2",
      "severity": "Warning",
      "dimension": "clarity",
      "finding": "问题 8 第 1 条 bullet（proposal-v3.md:34）仍保留旧机制表述『无 EnvironmentFile 来源解析为空（触发问题 4 或直接拒启）』，紧邻其后的 [v3 更正] 已以 L1 取证证伪该机制（systemd Environment= 不做 ${} 展开，进程收到的是公开常量字面量而非空值）。旧错误文本未划线废除，读者在 P1 段先读到被证伪的推演再读到订正，形成同条目内正文与证伪意图的并置矛盾，也与『已证伪』节的组织方式不一致。",
      "suggestion": "对旧机制描述加删除线或直接移除，仅保留 [v3 更正] 后的准确机制（公开常量→伪造 admin 令牌→P0）；将此类在条目内部的更正统一收敛到『已证伪/更正』小节集中呈现，避免正文残留多版本互相打架。"
    },
    {
      "id": "I3",
      "severity": "Warning",
      "dimension": "security",
      "finding": "P0 关闭前置泄漏排查清单（proposal-v3.md:90-96）只覆盖问题 1/2，且 grep 证据对象限定为『所有部署机 .env/EnvironmentFile』；新升 P0 的问题 8 的泄露载体是 deploy/ops-center.service:11-13 中 Environment=OPS_ENCRYPTION_KEY=${OPS_ENCRYPTION_KEY}/OPS_SECRET_KEY=${PO_SECRET_KEY}/OPS_JWT_SECRET=${PO_SECRET_KEY} 的字面量——它位于 systemd unit 文件而非 .env/EnvironmentFile，既不会被清单的逐机 grep 捕获，也没有为它安排 OPS_JWT_SECRET 的轮换/作废校验；若曾有生产部署使用该 unit，历史 admin 令牌即以公开常量签名，属于未被 P0 门控覆盖的泄露面。",
      "suggestion": "将问题 8 纳入 P0 泄漏排查清单：新增『逐机核对 systemd unit 中是否有 ${...} 字面量残留（grep 目标含 ops-center.service 而非仅 .env/EnvironmentFile）』『OPS_JWT_SECRET 已替换为独立随机值并轮换历史令牌』两个勾选项，并把『与 orchestrator 的 PO_SECRET_KEY 解耦已验证』写入 DoD。"
    },
    {
      "id": "I4",
      "severity": "Warning",
      "dimension": "feasibility",
      "finding": "第一批标注『均为 ops-center 局部改动，1-2 天』（proposal-v3.md:80），但同批附带的 P0 关闭前置（:90-96）包含跨环境运维动作：git log -S 全分支定位引入提交、逐机 .env/EnvironmentFile grep、CI secrets 与制品库清单核对、历史发行版发放范围确认，以及更关键的『存量客户端升级到安全阈值』（:95）——升级率是用户驱动的滞后指标，pytest 门禁（:80 回归以 pytest 为准）完全无法验证或关闭该前置。代码批预算与跨组织、跨发布周期的关闭前置在时间上不匹配。",
      "suggestion": "删除『1-2 天』总体口径，把批预算限定为『代码改动＋单机 pytest/打包验证』部分；泄漏排查清单与客户端升级阈值单列时间线，并明确它们是『问题 1/2 关闭前置』而非第一批可交付物，避免排期时被当作本批可完成项。"
    },
    {
      "id": "I5",
      "severity": "Info",
      "dimension": "feasibility",
      "finding": "双钥/宽限期过渡（proposal-v3.md:95）只对新客户端有效：旧发行版桌面端内置的是与已泄露 DEV KEY 配对的默认公钥（.env.example:38-39 注释已确认配对关系），服务端在宽限期内并行接受旧公钥，即等于继续信任用已泄露私钥签发的运行时配置——存量旧客户端在升级到安全阈值之前仍处于可被伪造的残余风险期，方案只写了『旧钥设到期日』却没量化到期日、没显式声明旧客户端残余风险敞口，也没有升级强制机制。",
      "suggestion": "在清单中补充：旧默认公钥的信任截至日期与到期后拒绝旧钥签发的切换日期、存量旧客户端残余风险期声明，以及将『安全阈值』量化为具体版本覆盖比例（如 ≥95% 活跃客户端升级）并附强制升级/离线兜底机制。"
    },
    {
      "id": "I6",
      "severity": "Info",
      "dimension": "completeness",
      "finding": "报告自称『全仓库代码综合体检』，但『未覆盖维度登记表』（proposal-v3.md:102-106）仅登记依赖 CVE/electron-builder 签名/灾备/CI 四类，未与仓库自身权威安全基线 AGENTS.md QM-2 的既有强制合同对照（如 API Key 单 writer 锁、IPC file URL canonical 目录边界、OIDC JWT/Opaque Token 与 introspection 判定、entitlement 时钟偏差容差、auto-updater 静默合同、R85 预设目录语义等均为 QM-2 点名的安全/健壮性门禁）。既然审查基线里已有强制合同清单，绕过它与把重点防范项漏进审计盲区等价，completeness 存在可补缺口。",
      "suggestion": "在登记表前新增『AGENTS.md QM-2 合同覆盖矩阵』一列，逐条标注 covered / out-of-scope（附理由），未覆盖项直接复用 v3 已建立的『触发节点/归属批次』机制登记，使体检结论与仓库既有安全基线对齐而非只依赖本报告自设维度。"
    }
  ],
  "dimensionScores": {
    "completeness": 7.5,
    "consistency": 7,
    "clarity": 7.5,
    "feasibility": 7,
    "security": 8
  },
  "summary": "v3 对 v2 全部 9 条评审的回应均成立且证据可现场核实（I1 反转为单参数 decrypt_key 与 key_service.py:38/model_preset_service.py:964,991 一致，被有效反驳项已如实撤回），但问题 8 升 P0 后未同步修正问题清单结构、总体结论摘要与 P0 关闭清单（JWT 字面量未纳入泄漏排查与轮换），且批一 1-2 天预算与跨环境关闭前置/客户端升级阈值在时间维度不匹配，需在批量推进前收口。"
}
