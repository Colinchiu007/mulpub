# 全仓代码体检整改复盘（Phase 4 retro / learn）

- **任务标识**：`audit-remediation-20260922`
- **输入**：`.adversarial/codebase-audit-20260922/proposal-v7.md`（12 轮双模型对抗评审终版）
- **节拍**：`/quality-rhythm` 全流程；Bug 类修复一律走 QM-5 五步反哺（第一性原因 → 测试逃逸 → 系统性漏洞 → 修复+回归保护 → 防再发）
- **隔离**：每批一个 D 盘独立 worktree + 主题分支，PR 走 squash + auto-merge
- **数据口径**：以下所有数字均由本次会话内脚本现测（`gh api` / `git diff --numstat` / 门禁脚本本地实跑），非回忆值

---

## 一、结果盘点

| 批次 | 范围 | PR | 落地 sha | 规模（squash commit 相对父提交实测） |
|---|---|---|---|---|
| 第 1 批 | P0 全部（信任链）+ P1 的 3/4/6/7/8 | #2214 | `b2cdd29b17` | 10 文件 +537/−20 |
| 第 1 批附 | 对抗评审产物 27 个文件入库 | #2215 | `6259cc8923` | 27 文件 +1736/−5 |
| 第 2 批 | P1 的 5/9/10/11/12/13 | #2226 | `48dea7a5ef` | 29 文件 +1786/−60 |
| 第 3 批 | P1 的 14/15 + P2 安全小项 | #2239 | `3da85855ba` | 64 文件 +3770/−341 |
| 第 4 批 | P2 技术债余项 | #2252 | `9a48af8938` | 61 文件 +4561/−344 |

四批合计覆盖 proposal-v7 全部条目：P0×4（条目 1/2/4/8，问题 8 经 L1 取证晋升）、P1×11（条目 3/5/6/7/9~15）、P2×12。

**新增门禁**：4 道 CI 门禁 + 1 组运行期闸门。

| 门禁 | 载体 | 判据 | 阻断力 |
|---|---|---|---|
| 运行期安全闸门 | `ops-center/backend`（`run_startup_security_checks`） | 9 条 P0 校验，任一不通过 `SystemExit` | 服务不启动（fail-closed） |
| Gate 17 IPC 守卫覆盖 | `.github/scripts/check-ipc-sender-guard.js` | 显式守卫比例 `minGuardedRatio=0.65`，基线 407/404/3/273/134/0.671 + 豁免清单 | 比例跌破即红 |
| Gate 18 会话卫生 | `.github/scripts/check-ops-session-hygiene.js` | 必存在结构（`set_cookie`/`httponly=True`/`samesite`/`delete_cookie`/CSP 三类头/`CSRF_HEADER`/`withCredentials`/401 清态）+ 禁用模式（view 自建 axios、token 落 localStorage） | 回退旧写法即红 |
| 债务熔断（逐文件行数） | `.github/scripts/check-max-lines.js` | `limit=500` / `growthAllowance=200`，新代码阻断、存量 99 条挂账防腐、已还债必须清账（含 Python 对等口径，`.py` 25 条） | 新增超大文件即红 |
| 依赖漏洞审计 | `scripts/check-dep-audit.js` + `dep-audit.yml` | 实跑 npm + pip-audit，29 条挂账每条必须带 `decision`/`note`/`reviewBy=2026-12-31` | 新增未留痕公告即红 |

`quality-gate.yml` 现有 **53 个 step**（门禁累计，非本批新增数）。

**最后一批（#2252）CI 实测**：QG Static 2m49s / Coverage 18m49s / Desktop Shards 22m7s、21m23s / Browser E2E 4m6s / 依赖漏洞审计 29s / ops-center 后端 5m44s 全绿，auto-merge（SQUASH）于 2026-09-23T02:24:30Z 落地 `9a48af8938`。

## 二、门禁的真实拦截记录（有效性证据）

门禁不是摆设 —— 本任务里它们各自拦下过一次真实回退：

1. **行数门禁拦下自己人**：第 4 批给 `url-collector.js` 加条件等待后，文件从 488 行涨到 547 行，被刚立的门禁判住（`FILES_OVER_500: 100 > baseline 99`）。处置口径是**拆文件**（新增 `url-collector-page-wait.js` + 保留薄委托），不是放宽基线。
2. **P1-5 加密语义被 rebase 撞出**：第 4 批 worktree 基线早于 #2226，批量改造初版把敏感配置**明文入库**。红验证阶段并入第 2 批的 `test_p1_config_secret.py` 后立即转红，证明历史套件确实在保护；随后把加密/掩码/审计语义收进单点 `_apply_upsert` 由两条入口共用。
3. **Gate 11 ESLint 拦住无害重构**：`access-level-bus.js` 的 `let windows = []` 初值永不参与判定（`catch` 已提前 `return 0`），被 `no-useless-assignment` 判红。按规则本意消除初值，不用 `eslint-disable` 放宽；本地复跑 `eslint --format json` 归因 + 17 vitest 绿 + 红验证（base 0 / mutated 1），CI 侧 QG Static 由红转绿。
4. **依赖门禁揪出「上限收得比修复版本还低」**：`requirements.txt` 的 `cryptography<46.0.0` 会把解析结果钉在漏洞版本上，`pip-audit` 当场报出 7 条公告，改为 `<51.0.0` 后 `pip install --dry-run` 验证可解析。
5. **CI 自身的坑也被抓**：`dep-audit.yml` 照抄 `cache: pnpm` 但该 job 不装依赖，`setup-node` 的 Post 步骤以 `Path Validation Error` 判红 —— 新门禁上线必须连着验证一次「空跑也绿」。

## 三、逃逸分析：这批缺陷当初为什么没被测出来

按 QM-5 第二步归纳，逃逸集中在三类系统性漏洞：

1. **「桩实现被当成真实现」缺少契约断言**。B 站采集适配器返回 `success: true` 但 title/desc 恒空，测试只断言"调用成功"。补的是一条**内容非空硬约束**（空结果必须带 `reason=api_stub_not_implemented`），而不是更多用例数量。
2. **"配置正确性"完全在测试盲区**。弱密钥、CORS `*` + credentials、加密主密钥静默自生成、systemd `Environment=` 不展开 `${}` —— 这些都在**部署期/启动期**成立或失败，单测跑的是"配置已正确"的假设。对策是把校验前移到启动闸门并 fail-closed，让缺陷在进程存活前暴露。
3. **异常路径没有留痕约定**。多处 `catch {}` 把「路径不存在 / 超时 / 解码失败」压成同一种沉默，线上无法归因。对策是新增 `createDegradationSink(onWarn)` 一类的**显式降级出口**，并规定"留痕自身绝不二次抛错"。

## 四、过程踩坑（跨项目可复用）

- **红验证要按语义归属选套件**：只跑本批新增文件会把"已被历史用例保护"误判成"测试是假的"。
- **两点 diff 会造出假象**：`git diff --name-only origin/main HEAD` 把"main 有、分支无"的文件标成 `D`，看起来像分支重复携带/删除了文件；PR 真实内容必须用三点（merge-base）口径。
- **混合行尾的超大 Markdown 只能字节级追加**：一次"整文件读入 + 统一行尾"的追加把 `01-docs/PRD.md` 变成 `+8647/−8398`（该文件本身 8553 CRLF + 8398 LF）。判据：追加后 `git diff --numstat` 必须 `deletions == 0`；异常时先用 `--ignore-cr-at-eol` 区分真实变更与行尾翻转（main 自身已把 `learnings.md` 翻成 CRLF，合并不可避免，但相对 `origin/main` 的净差应只有本分支新增行）。
- **追加型巨型文档的解冲突要按标题定位**：`CHANGELOG.md` / `learnings.md` 是「最新置顶」式，条目**不是**第一条，用位置定位会插错；必须以标题/唯一 ASCII 探针定位，并断言双方新增都在、行数 = 双方之和。
- **代理网络下 git TLS 抖动**：`schannel: failed to receive handshake` / `Recv failure: Connection was reset` 与 `gh api` 同时正常，说明是链路抖动而非权限问题；处置是带退避的重试循环，不改 git 全局配置。判定推送成功要看 ref 更新行（`37d36c6287..e66eedd4d4  HEAD -> ...`），PowerShell 里 `git push 2>&1` 赋值给变量后 `$LASTEXITCODE` 不可信。
- **`Set-Content -Encoding UTF8` 会给 commit message 塞 BOM**：PS5 下 `git commit -F` 会生成 `﻿docs(audit): …` 主题（BOM 参与首字符）。改用脚本以 `newline=""` 写无 BOM 的 UTF-8 文件，再 `git commit --amend -F`。
- **大仓 `git worktree add` 被超时打断会留下脏工作区 + stale `index.lock`**：症状是数千行 `D` 且 `index.lock` 存在。先确认无 git 进程存活 → 删锁 → `git reset --hard HEAD` 恢复（本次实测恢复 5910 个文件后 `git status` 归零），不要在脏工作区上直接改文件。
- **落盘脚本必须自我复核**：写文件工具偶发"报成功但磁盘无文件"，脚本执行前先 `Test-Path`，关键产物写完后用 `git diff --numstat` / 读取回验，而不是相信返回值。
- **CI 日志取不到时别硬啃**：job 日志是 302 到对象存储，Authorization 不能跟着跳转；但更快的路径往往是**本地复现同一条命令**（本例正是本地 eslint 才拿到真实 filePath）。
- **完成度审计要逐条对源码取证**：报告点名的"超大文件"要先定位真身（`publish-api-server.js` 实为 `packages/api-publish-engine/src/publish-api-server.js`），否则会把"没找到"误判成"已修"。同理，`flutter-skill-bridge` 的处置判据（全仓零引用即删）经 `git ls-files` 取证为**git 侧 0 个跟踪文件**，故无可删项 —— 不为不存在的模块补 README，也不因报告提了就动手删目录。
- **文档里的计数也要现测**：本复盘初稿沿用"P2×13"，与 `proposal-v7` 实测的 12 条 P2 bullet 不符，已随本 PR 在 PRD 与本文一并订正 —— 不可复算的完成态断言等同于缺陷。

## 五、遗留与限期（不假装完成）

| 项 | 状态 | 限期/处置 |
|---|---|---|
| 密钥逐机泄露面排查（`git log -S`、部署机 `.env`、CI secrets、旧客户端发放范围） | 本仓只交付判据与指引（`ops-center/deploy/KEY-ROTATION-GUIDE.md`） | **不由代码合并且关闭**，须部署评审逐项签字 |
| 行数挂账 99 条（含 `.py` 25 条，最大 `CreateView.vue` 5657 行） | 挂账防腐，未还 | 按版本迭代逐文件拆分，只允许清账不允许加项 |
| 依赖公告 29 条 | 每条带 `decision`/`note` | `reviewBy=2026-12-31` |
| `routers/env.py` 的 JWT 对齐诊断端点 | 非 orchestrator 环境恒 `unknown` | 补跑环境或移除（体检 v5 裁定为部署配置问题，非死代码） |
| SSRF 校验的 DNS 重绑定窗口 | 已在 PRD 显式声明为残余风险 | 需要连接层 pinning 才能收敛 |
| electron-builder 产物签名/自动更新链路、灾备演练 | 报告登记为未覆盖维度 | 未列入本四批范围，需另立任务 |

## 六、对节拍本身的改进建议

1. **新门禁上线必须自带「空跑也绿」验证**（本任务两次踩到：CI 缓存步骤、基线漂移）。
2. **红验证写进 PR 描述的必填项**：列变异清单 + 每条的 base/mutated 结果，否则评审只能看"测试通过"这种弱证据。
3. **多批并行时先做 merge 主线的动作**：#2239 与 #2252 并行期间 main 前进了 3 次，第 4 批 rebase 时撞出的语义冲突（P1-5）比代码冲突危险得多。后续批次应在上一批 MERGED 后立即同步基线。
4. **文档同步门禁要认 PRD 字面量**：本次把整改口径写进 PRD 时，先取 554 行逐字源码证据再下笔，避免"文档写完成态、源码不匹配"的漂移。

---

**状态（2026-09-23 收尾）**：四批全部 MERGED —— #2214 `b2cdd29b17`、#2215 `6259cc8923`、#2226 `48dea7a5ef`、#2239 `3da85855ba`、#2252 `9a48af8938`（mergedAt 2026-09-23T02:24:30Z）。详细规格见 `docs/audit-remediation-batch2-2026-09-22.md`（356 行）、`docs/audit-remediation-batch3-2026-09-22.md`（316 行）、`docs/audit-remediation-batch4-2026-09-22.md`（411 行），需求总章见 `01-docs/PRD.md`「全仓代码体检整改」节 + 运营中心 `12A.26` 节。本文件随 docs-only 分支 `codex/audit-retro-20260922` 入库，同 PR 订正 PRD 条目计数。
