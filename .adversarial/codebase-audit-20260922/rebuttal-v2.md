{
  "schemaVersion": 1,
  "round": 2,
  "responses": [
    {
      "issueId": "I1",
      "decision": "accepted",
      "evidence": "L1 现场取证证实评审正确，反转我 v2 建议：model_preset_service.py:964 从 services.key_service import decrypt_key（单参数，_get_fernet 用 Fernet(settings.encryption_key)），而 prompt_eval_service._fernet 用 Fernet(base64url(sha256(secret)))——两套派生方案互不可解（已读两文件确认）。OfficialKey.api_key 由 key_service 方案加密，正确最小修复是改回单参数 decrypt_key(key_row.api_key)（:991），而非切到 prompt_eval_service；若坚持切换须先统一密钥派生。红测试必须断言\"解密明文==保存时真实 Key\"并覆盖\"加密密钥未配置\"\"历史密文不可解\"两条路径，防 DoD 虚转绿。v3 采纳。"
    },
    {
      "issueId": "I2",
      "decision": "accepted",
      "evidence": "接受。轮换签名私钥必然换公钥，存量旧发行版内置旧默认公钥（.env.example:38-39 注释确认配对），验签 fail-closed 会拒绝新钥签发的配置。v3 在 P0 关闭前置补双钥/宽限期过渡：服务端并行接受新旧公钥（旧钥设到期日），新版客户端切新钥后回收；把\"存量客户端升级到安全阈值\"设为轮换完成勾选前置，而非仅\"评估\"。"
    },
    {
      "issueId": "I3",
      "decision": "accepted",
      "evidence": "接受。IDIOM_EXCLUSIONS 语义是\"被成语包含的关键词命中不算朝代证据\"（story-context-engine.js:319-329），\"孙权称帝\"是史实陈述非俗语，登记它会剔除真实三国题材的正向证据、现代题材再经 MODERN_TERMS 双重剔除。v3 改为只登记真惯用语（刘备借荆州/刘备摔阿斗），\"孙权称帝\"保留为史实证据，并补正向回归\"纯三国文本仅出现孙权称帝仍识别三国\"。"
    },
    {
      "issueId": "I4",
      "decision": "accepted",
      "evidence": "L1 现场取证：ops-center.service:11-13 用 Environment=OPS_JWT_SECRET=${PO_SECRET_KEY}，systemd 的 Environment= 不做 ${} shell 变量展开，进程收到字面量 ${PO_SECRET_KEY} 作为 JWT 秘密——是仓库里人人可复算的确定性公开常量，外部可伪造 admin 令牌，且 config.py get_jwt_secret 对该非空字面量恰好放行。比\"解析为空\"更严重。v3 更正机制描述并升为 P0 应急项：改用 EnvironmentFile= 注入真实随机值，启动校验额外拒绝含 ${ / $( 的字面量，防同类误配以同方式绕过弱密钥闸门。"
    },
    {
      "issueId": "I5",
      "decision": "rejected",
      "evidence": "L1 反例（定稿前补核现场推翻本条，也推翻我 rebuttal 初稿的接受）：登录限速/锁定/失败处置已存在——auth_service.py 头部合同注明\"内存计数（username+IP），5 次失败锁定 60s\"；实现：MAX_LOGIN_FAILURES/LOGIN_LOCK_SECONDS（:27）、_login_attempts key=username|ip（:31-32）、_is_locked（:89-95）、_record_failure 达阈值上锁（:98-107）、_sweep_expired_attempts 防随机用户名爆破内存无界增长（:38-43）；admin 未配置且 admins 表空时 fail-closed 503 无默认口令（:6,:79-80），admin 凭据缺失启动策略亦已闭环。评审\"没有速率限制/失败审计/锁定策略、空值场景未审计\"两个前提与源码不符，撤回建议。残余可改进项仅为\"失败告警\"（现仅内存计数无外发告警），属 P2 增强而非 P1 缺口，不改变批次归属。",
      "evidenceLevel": "L1"
    },
    {
      "issueId": "I6",
      "decision": "accepted",
      "evidence": "L1 现场取证：env.py:85-92 对未配置场景显式返回 unknown 并附 detail \"expected for ops-center; keys live in orchestrator/trendscope env\"，test_env_api.py:43-58 test_consistency_unknown_when_unset 锁定该行为——是跨服务诊断端点的预期设计，非\"误导性死代码\"。v3 降级表述为\"当前部署单元未注入这些变量导致恒 unknown，属部署配置问题非代码缺陷\"，处置改为在 orchestrator/trendscope 环境补跑该检查或删除 ops-center 暴露的该端点。"
    },
    {
      "issueId": "I7",
      "decision": "accepted",
      "evidence": "接受。v3 为第四批每项补验收断言：脆弱等待改成\"条件轮询+上限+超时原因\"并给一个验收用例；Python 侧（model_preset_service.py/prompt_eval_service.py 1000+ 行）引入与 lint max-lines 对等的最小行数门禁（新代码阻断，存量挂账）；flutter-skill-bridge 给 deadline（下个发版周期末）且判据输出入 CHANGELOG。"
    },
    {
      "issueId": "I8",
      "decision": "partially_accepted",
      "evidenceLevel": "L2",
      "evidence": "部分接受。报告原文用\"约 215/336\"已标注为近似口径（全量正则统计），非精确断言；评审复算 358/214 差异源于跨行定义与带参数 channel 的正则口径不同，两者都对各自口径成立。接受固化：v3 采纳把统计命令落地为 scripts/ipc-guard-count.js（精确解析 channel+守卫），CI 直接复用该脚本断言阈值并注明含/排除 .test.js，消除口径漂移；同时采纳\"license-access-control.js:31 是功能开关非 sender 守卫\"的更正。不改判为缺陷，因数值本就以\"约\"限定。"
    },
    {
      "issueId": "I9",
      "decision": "accepted",
      "evidence": "接受。未覆盖登记表不能\"登记即终态\"。v3 为其补\"触发节点/归属批次\"列：依赖 CVE 扫描与 CI secrets 暴露面绑定第四批且入发版 gate；代码签名链绑定下次发版；备份灾备绑定部署清单评审——使其成为可回追 backlog。"
    }
  ]
}
