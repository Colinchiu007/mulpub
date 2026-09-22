{
  "schemaVersion": 1,
  "round": 1,
  "issues": [
    {
      "id": "I1",
      "severity": "Critical",
      "dimension": "security",
      "finding": "问题 #1「Ed25519 运行时配置签名私钥随示例文件入库」（proposal-v1.md:11-14）：.env.example 内嵌真实 PEM 私钥并标注与桌面端默认公钥配对。报告虽判定“git 历史中的 PEM 永久公开，按已泄露处置”，但未在修复方案中明确要求强制轮换受影响密钥对及排查所有曾引用该 DEV KEY 的环境清单。",
      "suggestion": "修复方案必须补充：1) 从 .env.example 删除所有真实私钥内容，仅保留生成命令占位；2) 将该私钥视为已泄露，强制轮换桌面端默认公钥/私钥对并更新所有依赖环境；3) 明确列出“需人工确认并轮换”的清单项（部署环境、内置默认公钥的分发渠道、CI/CD Secret），并在回归清单中强制检查该清单是否闭环。"
    },
    {
      "id": "I2",
      "severity": "Critical",
      "dimension": "feasibility",
      "finding": "问题 #3「decrypt_key 调用参数错误被裸 except 吞掉」（proposal-v1.md:23-26）：以两参数调用单参数 key_service.decrypt_key，必抛 TypeError 后被 `except Exception: pass` 吞掉。报告给出修复为改用 `prompt_eval_service.decrypt_key(secret, value)`，但未说明如何处理历史密文解密失败场景以及该静默吞异常是否导致其他代码路径误判连接成功。",
      "suggestion": "修复时须先写复现红测试（能稳定复现 TypeError 被吞导致的假成功/假回退），修复后不再使用全量 `except Exception: pass`，改为：1) 精确捕获参数不匹配/解密失败；2) 失败时记录结构化 warn 日志（不泄露密文/密钥材料），按“测试连通性”场景返回可区分的 `decrypted=false, reason=...` 而非静默吞掉；3) 验证回退路径是否真正生效。"
    },
    {
      "id": "I3",
      "severity": "Critical",
      "dimension": "security",
      "finding": "问题 #4「加密主密钥缺失时静默自生成」（proposal-v1.md:26-28）：`OPS_ENCRYPTION_KEY` 为空时每次重启/每 worker 生成新内存密钥导致历史 `OfficialKey` 密文永久不可解。报告建议“fail-closed 拒启”，但未明确 worker 多实例场景（gunicorn/uvicorn 多 worker）下的拒启策略、启动顺序、以及对现存历史密文的迁移/处置方案。",
      "suggestion": "补充 fail-closed 细则：1) 启动期强制校验 `OPS_ENCRYPTION_KEY` 非空且格式有效（Fernet 长度/基础校验），任意 worker 校验失败即整进程退出并返回非零码；2) 明确生产环境禁止自生成，开发环境需显式允许并写入启动告警日志；3) 补充历史密文处理预案（检测到无法解密的密文时按条降级掩码并记录 audit，但不自动清洗），避免一刀切导致服务无法启动。"
    },
    {
      "id": "I4",
      "severity": "Critical",
      "dimension": "security",
      "finding": "问题 #9「B站采集\\\"API 优先\\\"分支是返回空数据的桩实现」（proposal-v1.md:38-40）：算好 `signedUrl` 后直接返回 `{ title:'', desc:'' }` 且 `success:true` 上报，静默污染下游。报告已核实但未给出“如何防止桩代码被误判为成功路径”的防御措施。",
      "suggestion": "禁止以 `success:true` 返回空数据：1) 该分支改为显式 `success:false, reason:'api_stub_not_implemented'` 或直接移除 API 优先分支统一走浏览器兜底；2) 增加数据完整性校验（title/desc 非空）作为成功条件，空结果一律视为失败；3) 增加 metrics/tag（`platform=bilibili, mode=api_stub`）记录污染事件，防止静默污染下游聚合。"
    },
    {
      "id": "I5",
      "severity": "Warning",
      "dimension": "consistency",
      "finding": "问题 #6「CORS 全开 + credentials」（proposal-v1.md:29-31）与问题 #15「管理后台 JWT 存 localStorage」（proposal-v1.md:54-56）在风险叠加上表述不一致：前者建议白名单收敛+启动告警，后者仅评估 Cookie 方案但未与 CORS 白名单/credentials 强制约束绑定。",
      "suggestion": "将两者整合为一致的会话安全矩阵：1) 当 `credentials=true` 时，`allow_origins` 禁止使用 `*`，且白名单必须精确匹配（不支持通配符子域需显式列出）；2) 若评估改用 HttpOnly+SameSite Cookie，会话存储变更需同步更新 CORS 策略、CSRF 防护假设、CSP；3) 在配置校验阶段直接拒绝危险组合（`*` + credentials=true）。"
    },
    {
      "id": "I6",
      "severity": "Warning",
      "dimension": "completeness",
      "finding": "IPC 守卫覆盖不一致（proposal-v1.md:51-54）列出约 215/336 个 handler 带守卫，但未明确“豁免清单”的管控方式。报告提议“CI 增加‘handler 必须声明 guarded 或豁免’静态检查防漂移”，但豁免本身缺乏最小权限原则和审计要求。",
      "suggestion": "补强豁免治理：1) 将豁免清单集中到单文件（显式注释+风险等级），禁止散落注释；2) 每个豁免项需说明业务理由、最小权限（只读/不可破坏性/不可外发）、到期日或移除条件；3) CI 静态检查不仅强制声明，还强制校验豁免清单条目数量/变更需审批，并在审计日志中记录豁免命中。"
    },
    {
      "id": "I7",
      "severity": "Warning",
      "dimension": "clarity",
      "finding": "验证方式（proposal-v1.md:83-92）对 P0/P1 修复后的“人工确认”要求描述模糊（如“人工确认曾使用该 dev 私钥/弱密钥的环境清单并完成轮换”），缺少可验证的关闭条件（Definition of Done）。同时“未逐行通读全部文件”的边界说明（90-92）未量化影响到哪些结论的置信度。",
      "suggestion": "将验证方式转化为可执行的 DoD：1) 每个 P0/P1 项新增“验证证据”（日志/pytest 断言/配置校验输出/打包验证截图等）和“关闭条件”（必须满足的布尔条件）；2) 人工确认项改为可核对清单（逐项勾选+责任人+完成时间），而非模糊描述；3) 边界说明补充：明确 IPC 守卫覆盖统计来自全量正则（可信度高），但大文件拆分（如 CreateView.vue 5589 行等 P2）未穷尽逐行，需在后续第三/四批中补充抽样覆盖范围。"
    },
    {
      "id": "I8",
      "severity": "Info",
      "dimension": "feasibility",
      "finding": "执行顺序（proposal-v1.md:76-82）将“decrypt_key 调用修正”（P1 #3）与“加密主密钥 fail-closed”（P1 #4）归入第一批安全应急是合理的，但未识别它们之间的顺序依赖：fail-closed 拒启可能会先于修复暴露历史密文不可解问题，导致服务启动阻断。",
      "suggestion": "第一批调整执行顺序或补充风险缓冲：1) 先处理 #3（修复调用与异常处理），确保连接测试路径行为正确；2) #4（fail-closed）与历史密文迁移预案同步评估，必要时先在预发布验证拒启策略和历史密文降级是否符合预期，再推向生产；3) 在第一批交付物中包含“启动失败应急预案”（回滚/临时配置指引），降低应急时的操作风险。"
    }
  ],
  "dimensionScores": {
    "completeness": 8,
    "consistency": 7.5,
    "clarity": 7.5,
    "feasibility": 8,
    "security": 9
  },
  "summary": "整体质量较高，P0/P1 风险识别清晰，但部分关键修复方案（密钥轮换闭环、静默异常处理、fail-closed 策略细则、IPC 豁免治理）缺乏可验证的 DoD 和顺序依赖预案。"
}
