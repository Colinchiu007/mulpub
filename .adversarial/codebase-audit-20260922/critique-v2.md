{
  "schemaVersion": 1,
  "round": 2,
  "issues": [
    {
      "id": "I1",
      "severity": "Critical",
      "dimension": "feasibility",
      "finding": "回应 I2 声称修复为\"改用 prompt_eval_service.decrypt_key(secret, value)（两参数版本）\"（proposal-v2.md:24，rebuttal-v1.md I2），但该两服务使用不同的加密方案：OfficialKey.api_key 由 key_service 用 `Fernet(settings.encryption_key)`（原始 Fernet 格式密钥，key_service.py:15-29）加密，而 prompt_eval_service.decrypt_key 用 `Fernet(base64url(sha256(secret)))`（口令派生，prompt_eval_service.py:38-40,53-54）解密。除非 settings.encryption_key 恰好等于 sha256(口令) 派生值，否则两方案互不可解——修复后回退路径与当前一样解密失败。而 v2 设计的红测试只复现\"TypeError 被裸 except 吞掉→假回退\"（proposal-v2.md:24），不会断言解密出来的明文等于真实 Key，因此 DoD（红转绿）可虚转绿，bug 原样残留。",
      "suggestion": "正确最小修复是：model_preset_service.py:964 已 `from services.key_service import decrypt_key`（单参数），直接改为 `decrypt_key(key_row.api_key)`，与原加密路径一致。若坚持用 prompt_eval_service，必须先统一密钥派生（两处使用同一密钥材料/同一 Fernet 密钥）再替换。红测试必须同时断言\"解密出的明文 == 保存时的真实 Key\"（而非仅断言不抛 TypeError），并覆盖\"加密密钥未配置\"与\"历史密文不可解\"两条路径，避免 DoD 虚转绿。"
    },
    {
      "id": "I2",
      "severity": "Warning",
      "dimension": "feasibility",
      "finding": "问题 1/2 的\"强制轮换\"与桌面端内置默认公钥存在兼容断裂：签名的私钥轮换必然更换配对公钥，而旧发行版桌面端内置的是旧默认公钥（`.env.example:38-39` 注释明确\"桌面端内置的默认公钥与上面默认私钥配对\"）。轮换后存量客户端用旧公钥验签新密钥签发的公告/版本/敏感词/pipelineOptions 将全部验签失败（fail-closed 不应用），未覆盖。P0 关闭前置清单第 4 项只要求\"验证锚切换兼容窗口评估\"（proposal-v2.md:93），没有过渡技术方案。",
      "suggestion": "在清单中补充双钥/宽限期过渡策略：服务器端验签期间并行接受新旧两把公钥（旧钥设到期日），新版桌面端切换新钥后回收旧钥；或以离线默认配置兜底。把\"存量已升级版本占满/达到安全阈值\"设为轮换完成（DoD 勾选）的前置条件，而不是仅\"评估\"。"
    },
    {
      "id": "I3",
      "severity": "Warning",
      "dimension": "feasibility",
      "finding": "问题 13 的 v2 登记条目（proposal-v2.md:80）混入\"孙权称帝\"：这不是成语/俗语成分而是史实陈述。IDIOM_EXCLUSIONS 的语义是\"被成语包含的关键词命中不算朝代证据\"（story-context-engine.js:319-329），把\"孙权称帝\"登记进去会把真实三国题材中以\"孙权称帝\"为唯一孙权证据的整句命中剔除；现代题材引用史实经 MODERN_TERMS 中和后变成双重剔除，削弱正向识别。",
      "suggestion": "只登记真正惯用语（刘备借荆州、刘备摔阿斗等），\"孙权称帝\"按史实证据保留；负回归断言\"刘备借荆州\"不误判的同时，必须补正向用例\"纯三国文本单独出现'孙权称帝'仍识别三国\"，防止守卫过扩吞掉真阳性。"
    },
    {
      "id": "I4",
      "severity": "Warning",
      "dimension": "consistency",
      "finding": "问题 8 的机制描述不准确（proposal-v2.md:34）：systemd 的 `Environment=` 不做 shell 变量展开，`${OPS_ENCRYPTION_KEY}/${PO_SECRET_KEY}`（ops-center/deploy/ops-center.service:11-13）不会被\"解析为空\"，而是把字面量 `${...}` 作为明文环境值传给进程——JWT 秘密将变成仓库里人人皆知的确定性常量字面量，外部攻击者可据此伪造 admin 令牌，比\"为空\"更危险，且 `get_jwt_secret`（config.py:58-60）对这种非空字面量恰好放行。结论方向（修复）正确，但风险表述与\"触发问题 4 或直接拒启\"的推演不成立。",
      "suggestion": "更正机制描述并据此修订应急说明：该 unit 实为\"公开已知确定性密钥注入\"，属 P0 级；修复用 `EnvironmentFile=` 注入真实随机值，并在启动校验中额外拒绝含 `${`/`$(` 的字面量（防同类误配以相同方式绕过弱密钥闸门）。"
    },
    {
      "id": "I5",
      "severity": "Warning",
      "dimension": "security",
      "finding": "completeness 缺口：ops-center 本地管理员登录（`/api/auth/login`）没有速率限制/失败审计/锁定策略，报告对其仅正面确认了 PBKDF2 口令哈希质量（proposal-v2.md:5），未覆盖爆破面。与问题 15（JWT 存 localStorage 并 credentials）叠加后，登录爆破是低垂接管入口；`OPS_ADMIN_USERNAME/OPS_ADMIN_PASSWORD` 空值场景也未审计（auth_service 侧 admin 自包含认证）。",
      "suggestion": "在第三批追加：登录端点 per-IP 限速（如滑动窗口）+ 失败次数审计与告警 + 可选账号锁定；并把 admin 凭据缺失/弱口令的启动策略纳入问题 2 的配置校验范围。"
    },
    {
      "id": "I6",
      "severity": "Warning",
      "dimension": "consistency",
      "finding": "问题 8 中 \"routers/env.py:82-92 的 JWT 对齐检查在本进程内恒返回 unknown 属误导性死代码\" 定性过强：该检查是跨服务诊断端点，本进程无 PO_SECRET_KEY/TS_SECRET_KEY 时返回 unknown 是 arl 预期行为并附 detail 说明\"keys live in orchestrator/trendscope env\"（env.py:85-91），test_env_api.py:48-60 有明确用例锁定该行为。报告将其与\"误导性死代码\"并列，与正面结论及上游契约冲突。",
      "suggestion": "降级表述为\"该部署单元未注入这些变量，导致此检查在当前部署恒 unknown，属部署配置问题而非代码缺陷\"；结论改为：要么在 orchestrator/trendscope 环境补跑该检查，要么删除 ops-center 暴露的该端点，避免误标为死代码影响后续清理。"
    },
    {
      "id": "I7",
      "severity": "Warning",
      "dimension": "clarity",
      "finding": "P2 段（proposal-v2.md:56-68）仍大量使用\"择机偿还\"\"评估一下\"等含糊表述且无验收边界：`xiaohongshu.py:191 sleep 30s`、`url-collector.js:412` 等\"脆弱等待\"仅给出\"改条件等待\"方向，无改判成功标准；超大文件拆分对 Python 侧（model_preset_service.py/prompt_eval_service.py 1000+ 行）未给 `max-lines` 类硬约束，只有\"存量挂账\"。第四批\"flutter-skill-bridge 限期处置\"虽有 rg 判据但无截止工期。",
      "suggestion": "第四批每项补验收断言样例：脆弱等待改成\"条件轮询 + 上限 + 超时原因\"并给一个验收用例；超大文件对 Python 引入与 lint `max-lines` 对等的最小行数门禁（新代码阻断）；flutter-skill-bridge 给 deadline（如下个发版周期末）及判据输出到 CHANGELOG。"
    },
    {
      "id": "I8",
      "severity": "Info",
      "dimension": "completeness",
      "finding": "突破统计学口径：报告称\"336 个 ipcMain.handle 约 215 个带守卫\"（proposal-v2.md:52），本人只读复算 ipc-handlers/*.js 目录得 358/214（正则口径，含跨行定义与带参数 channel 的差异），统计脚本未随报告/后续 CI 检查落地复现，且 `license-access-control.js:31` 只做功能开关、不是 sender 守卫。v2 提出 CI 校验\"handler 必须声明 guarded 或豁免\"（proposal-v2.md:52），若检查器口径与手数口径不一致会产生漏检/误报。",
      "suggestion": "将 215/336 的统计命令固化为 `scripts/ipc-guard-count.js`（精确解析 ipcMain.handle 的 channel+守卫函数），CI 静态检查直接复用该脚本计数并断言阈值；同时在报告中注明统计包含/排除测试文件与 .test.js，避免口径漂移。"
    },
    {
      "id": "I9",
      "severity": "Info",
      "dimension": "clarity",
      "finding": "未覆盖维度登记表（proposal-v2.md:100-104）目前已\"登记即终态\"：npm audit/osv-scanner/pip-audit、electron-builder 代码签名、备份灾备、CI 工作流逐一未审，但没有为这些项给出触发节点或排期归属，其中依赖 CVE 与 CI secrets 暴露面是与 P0/P1 同源（供应链/凭据）风险，可能被长期搁置。",
      "suggestion": "为登记表补充\"触发节点/归属批次\"列：依赖 CVE 扫描与 CI secrets 暴露面审查绑定到发版 gate 或第四批（而非仅登记）；代码签名链绑定到下次发版；备份灾备绑定到部署清单。使之成为可回追的 backlog 而非仅 pml 免责声明。"
    }
  ],
  "dimensionScores": {
    "completeness": 8.5,
    "consistency": 7.5,
    "clarity": 7.5,
    "feasibility": 7,
    "security": 8.5
  },
  "summary": "v2 对 8 条旧评审全部实质接受且 DoD 化到位、核心证据基本可核实，但 I1 的 decrypt_key 修复方案存在加密方案错配（DoD 会虚转绿），轮换与 systemd 变量语义、成语登记过扩等 feasibility/consistency 问题需在批量推进前修正。"
}
