# 全仓代码体检整改 · 收尾全量证据（2026-09-23）

> **来源**：`.adversarial/codebase-audit-20260922/proposal-v7.md`（12 轮双模型对抗评审终版）。问题清单是**连续编号 1–15**：P0 块 2 条（问题 1、2）+ P1 块 13 条（问题 3–15），其中**问题 8 经 v-final 从 P1 晋升 P0**（故 P0 定级实为 3 条，本表按修复批次记作 P0-1…P0-8 的编号即报告问题编号）；P2 为 **12 个专题条目**（含 1 条纯验收条款，实际偿还项 11），非编号问题。六轮 Critical 轨迹 4→1→0→0→0→0→0（取自 `summary.md`）。批次切分：第一批=问题 1/2/3/4/6/7/8，第二批=5/9/10/11/12/13，第三批=14/15 + P2 安全小项，第四批=P2 余项。
> **本文定位**：四批整改 + 收尾轮的**交付清单、逐条证据映射、门禁矩阵、红绿验证记录、遗留项与限期**，供复算与审计交接使用。过程叙述见 `docs/audit-remediation-batch{1,2,3,4}-2026-09-22.md`（第 1 批此前只有 PRD + CHANGELOG + 运维指引，缺一份与其他三批对称的专文档，本次补齐：两条启动闸门顺序、各条 `SystemExit`/`RuntimeError` 文案原文、SSRF 例外开关与已知 DNS 重绑边界都在 `batch1` 里）、`docs/audit-remediation-retro-2026-09-22.md`、`docs/audit-remediation-ledger-guard-2026-09-23.md`；需求口径固化在 `01-docs/PRD.md` 第九～十二节。
> **本文所有 SHA/时间/计数**均由 `gh pr view --json`、`git grep origin/main`、门禁脚本本地实跑取回，非回忆值。

## 一、交付清单（按合并顺序）

| PR | 主题 | 合并时间(UTC) | squash SHA | +/− | 文件 |
|---|---|---|---|---|---|
| #2214 | P0 安全应急（私钥/JWT/CORS/decrypt_key/主密钥/SSRF/systemd） | 2026-09-22 15:11:47 | `b2cdd29b17` | +537/−20 | 10 |
| #2215 | 对抗评审 r9–r12 产物归档 + proposal-v7 | 2026-09-22 14:48:54 | `6259cc8923` | +1736/−5 | 27 |
| #2226 | P1 第二批（配置密文化 / B站空壳硬约束 / 依赖治理 / SSRF 白名单 / Playwright 生命周期 / 成语守卫） | 2026-09-22 19:50:56 | `48dea7a5ef` | +1786/−60 | 29 |
| #2239 | P1-14 IPC 注入契约 fail-closed + P1-15 Cookie 会话/CSP/CSRF + P2 安全小项 | 2026-09-23 00:41:39 | `3da85855ba` | +3770/−341 | 64 |
| #2252 | P2 技术债余项（脆弱等待条件化 / N+1 单事务 / 级别缓存 / 静默 catch 留痕 / 行数与依赖门禁 / 枚举单一来源） | 2026-09-23 02:24:30 | `9a48af8938` | +4561/−344 | 61 |
| #2274 | 拆分缓存清理卡片（`LogsSettings.vue` 598→469 行），恢复逐文件行数门禁 | 2026-09-23 05:15:04 | `63ff037446` | +467/−139 | 11 |
| #2280 | 挂账清单三态语义 + 墓碑 + `--prune` + debt-guard 增 `push: main`（门禁逃逸根治） | 2026-09-23 08:12:32 | `45c2e24692` | +474/−33 | 8 |
| #2276 | P0-8 补漏：启动校验拒绝 systemd 未展开字面量（`$__`/`${`/裸变量） | 2026-09-23 09:33:29 | `8d4098948c` | +94/−0 | 4 |
| #2270 | Phase 4 复盘落库 + PRD 条目计数订正为实测 P2×12 | 2026-09-23 09:35:47 | `e925df7973` | +96/−1 | 3 |
| #2289 | **本文所载**收尾全量证据归档 + PRD 第十一节验收项订正 | 2026-09-23 10:06:14 | `a49531d203` | +142/−1 | 3 |
| #2291 | P0-1 收口：打包版不再吃内置 DEV 信任锚（**本文订正过程中挖出的真实缺陷**，非措辞问题） | 2026-09-23 10:36:53 | `55cd32baaa` | +210/−3 | 5 |
| 本次提交 | 订正本文 P0-1 行的私钥字面量计数（#2291 合并后 `git grep` 实测 7 处 / 6 个测试文件，原写 6 处 / 5 文件）；纯文档，不新增代码、不改门禁语义 | — | — | — | 2 |

**合并纪律**：每个 PR 均独立 worktree（`D:\Data\projects\mp-worktrees\*`）→ 主题化提交 → rebase 到最新 `origin/main`（文档冲突按并集解，不丢任何一行）→ `gh pr merge --squash --auto`。

## 二、需求条目 → 落地证据（对 `origin/main` 逐条核验）

| 条目 | 证据（文件:行/符号） | 防复发位置 |
|---|---|---|
| P0-1 Ed25519 私钥入库 | 私钥字面量全仓 `git grep` 命中 **7 处 / 6 个测试文件**：真实 PEM 测试夹具 6 处 / 5 文件（`apps/desktop/electron/services/ops-center-sync.test.js:25`、`apps/desktop/electron/services/runtime-trust-anchor.test.js:25`（#2291 为四态裁决新增的 DEV 私钥夹具）、`ops-center/backend/tests/conftest.py:17`、`test_platform_defs_api.py:19`、`test_runtime_policy_api.py:23,32`），另 1 处 `test_p0_security.py:186` 是「`.env.example` 里不该出现 PEM」的断言本身；**非测试命中 0**。本行计数基准 `abc307cfa6`（#2291 合并后由 6 处 / 5 文件复算为 7 处 / 6 文件，见交付清单末行）。信任锚闸门：内置 DEV 公钥只对未打包态生效，**由 #2291 补齐**——`apps/desktop/electron/services/runtime-trust-anchor.js::resolveTrustAnchor` 四态裁决（有锚用锚 / 无锚+未打包回落 DEV / 无锚+已打包 `NO_PRODUCTION_TRUST_ANCHOR` / DEV 公钥被裁 `NO_PUBLIC_KEY`），接入 `ops-center-sync.js::verifyRuntimeSignature`（fail-closed，整份策略不应用） | `runtime-trust-anchor.test.js` 10 例（含「打包 + 无锚 → 即便签名用 DEV 私钥合法签也必须被拒」）+ `ops-center-sync.test.js` 60 例；指引 `ops-center/deploy/KEY-ROTATION-GUIDE.md` |
| P0-2 JWT 弱密钥闸门 | `ops-center/backend/config.py::_validate_jwt_secret`（长度 ≥32 / 弱值表 / 弱前缀）+ `run_startup_security_checks` 聚合 fail-closed | `test_p0_security.py`；systemd 未展开字面量补漏在 #2276（`_reject_unexpanded` + `tests/test_p0_jwt_literal.py`） |
| P0-3 `decrypt_key` 参数 | `ops-center/backend/services/key_service.py::decrypt_key`（单参数 + 精确异常），调用方 `model_preset_service.py` | `ops-center/backend/tests/test_key_service.py` 断言解密明文 == 真实 Key |
| P0-4 加密主密钥静默自生成 | `config.py`：缺 `OPS_ENCRYPTION_KEY` 且未显式放行 → `SystemExit`；`OPS_ALLOW_EPHEMERAL_KEY=true` 才允许临时密钥并打 warn | `[P0-4]` 启动闸门 |
| P0-6 CORS `*` + credentials | `config.py::_validate_cors_credentials` | 启动闸门第 7 条 |
| P0-7 SSRF | `ops-center/backend/services/model_preset_service.py::_validate_target_url`（scheme → 主机名字面量黑名单 → 字面 IP → `getaddrinfo` 每条 A 记录，四道判定；`198.18.0.0/15` 需 `OPS_ALLOW_PROXY_BENCHMARK_IPS=true` 才放行，CGNAT `100.64.0.0/10` 显式补入）——**重定向口径订正**：两处外呼均为 `httpx.AsyncClient(follow_redirects=False)`，即「不跟随 3xx」而非「逐跳复验」；已知边界：校验与连接各做一次独立 DNS 解析，存在重绑 TOCTOU 窗口（细节见 `docs/audit-remediation-batch1-2026-09-22.md` 第六节） | pytest 逐地址回归；JS 侧同口径 `packages/video-clone-engine/src/adapters/url-guard.js::assertSafeIngestUrl`（#2276 之外的 P1-11） |
| P0-8 systemd 注入公开常量 | `ops-center/deploy/ops-center.service`：`EnvironmentFile=` + `User=ops-center`（低权）+ 600 权限 | 部署清单评审 + #2276 的字面量拒绝 |
| P1-5 敏感配置明文落库 | `ops-center/backend/services/config_service.py::_apply_upsert`（单条与批量共用，写库前 Fernet 加密，掩码回显不覆盖真实凭据） | pytest（含「批量回退明文」变异红验证） |
| P1-9 B站真发请求 + 空壳硬约束 | 空壳响应的 `reason` 是 **`empty_content`**（提案稿里的 `api_stub_not_implemented` 从未落地，全仓 0 命中）：判定与处置在 `packages/collection-engine/src/platform-adapters/base-adapter.js:96-103` —— `isEmptyContent` → `log.blocked(...,'empty_content')` + `healthMonitor.record({success:false,reason:'empty_content'})` + `circuitBreaker.recordFailure` + `refundBudget` + `return {success:false,reason:'empty_content'}`；`bilibili-adapter.js:115-117` 空壳时优先浏览器兜底，无浏览器则原样上交给 `collect` 判失败 | `packages/collection-engine/tests/bilibili-adapter.test.js:71,77,137,138` 断言 `reason === 'empty_content'` 与 `[['health', false, 'empty_content'], ['cb-fail']]` |
| P1-10 shared-utils 顶层 require electron | `packages/shared-utils/package.json` `peerDependencies.electron` + 懒加载注入（`publish-history.js`/`scheduler.js`） | vitest |
| P1-11 ingest-url SSRF 白名单 | `packages/video-clone-engine/src/adapters/ingest-url.js`（守卫实现拆到同目录 `url-guard.js`，域名表单一事实来源） | `test/adapters/ingest-url.test.js` + `url-guard.test.js`（node --test） |
| P1-12 Playwright try/finally | `packages/python-backend/src/multi_publish/video_creation/character/character_animation_utils.py:78 finally:`（异常路径必关浏览器） | `packages/python-backend/tests/test_character_animation_lifecycle.py` 源码级断言含 `finally:` |
| P1-13 朝代成语守卫缺项 | `apps/desktop/electron/services/story-context-engine.js::IDIOM_EXCLUSIONS` 补登记真俗语 | 同名 `.test.js` 正向回归 |
| P1-14 IPC sender 守卫不一致 | 盘点脚本 `.github/scripts/check-ipc-sender-guard.js`（五分类 + `minGuardedRatio 0.65` + global/fallback 硬错误）；豁免清单 `apps/desktop/electron/ipc-guard-exemptions.json` | CI Gate 17（比例阈值 + 豁免双向校验） |
| P1-15 后台 JWT 存 localStorage | `ops-center/backend/routers/auth.py`（HttpOnly + SameSite=Lax）、`middleware/auth.py`（CSRF 头）、`main.py`（CSP）、前端 `http.js`/store/router/7 view | `tests/test_p1_15_session_cookie.py` + `.github/scripts/check-ops-session-hygiene.js`（CI Gate 18） |
| P2 脆弱等待 | `apps/desktop/electron/services/url-collector-page-wait.js`（条件轮询 + 上限 + 超时原因；由 547 行的 `url-collector.js` 拆出以满足 500 行棘轮） | `url-collector-content-ready.test.js` |
| P2 N+1 / 单事务 | `config_service.py` 批量 `rollback`/单事务语义与 `_apply_upsert` 复用 | pytest |
| P2 性能税 | `apps/desktop/electron/home-shell-preload.bundle.js::getAccessLevel`（同步查询改缓存）；`model_preset_service.py` DNS `getaddrinfo` 走 `asyncio.to_thread` | vitest / pytest |
| P2 静默 catch 留痕 | compose / knowledge-base / slideshow 三处降级分支补 `logger.warning`（19 测试绿） | 批次文档第四批第 4 节 |
| P2 枚举单一来源 | `packages/shared-utils/index.d.ts::PLATFORMS`，删除无接线重复副本 | vitest |
| P2 依赖漏洞 | `scripts/check-dep-audit.js` + `scripts/dep-audit-baseline.json`（29 条挂账 + `reviewBy` + 四种处置判定） | `dep-audit.yml`（实跑 `npm audit` + `pip-audit`） |
| P2 超大文件 | `.github/scripts/check-max-lines.js`（`DEFAULT_LIMIT=500`、膨胀容差 200、挂账 99 条 + `pruned` 墓碑） | `debt-guard.yml`「债务熔断检查」（required check，`pull_request` + `push: main` 双触发） |
| P2 `flutter-skill-bridge` 空壳 | 判据「全仓零引用」命中；git 中该目录 0 个 tracked 文件 → 无需删除动作 | 结论入 `CHANGELOG.md` 第四批条目 + PRD 第十节 |

## 三、门禁矩阵（全部可本地复跑）

| 门禁 | 判据 | 本地复跑 |
|---|---|---|
| 债务熔断检查（required） | 四类判定 `NEW_OVER_LIMIT` / `LEDGER_GREW` / `STALE_LEDGER_ENTRY` / `DEBT_REPAID_LEDGER` + 非阻断 `LEDGER_RESURRECTED` | `node .github/scripts/check-max-lines.js`；还债：`... --prune <路径>`；增量登记：`... --update`（全量重生需 `--update --rewrite`） |
| 依赖漏洞审计 | `NEW_ADVISORY` / 基线腐化 / 挂账到期 | `node scripts/check-dep-audit.js`（`NPM_AUDIT_REGISTRY=https://registry.npmjs.org`） |
| CI Gate 17 IPC 守卫 | 覆盖率比例 + 豁免清单双向校验 | `node .github/scripts/check-ipc-sender-guard.js --base-dir apps/desktop` |
| CI Gate 18 会话卫生 | 必存在结构 + 禁用模式 | `node .github/scripts/check-ops-session-hygiene.js` |
| Python 硬编码中文 | `file:line` 基线 79 条，新增即红 | `node .github/scripts/check-locale-sync.js --py-cjk` |
| 文档同步（doc-gate） | 改代码必须同批改 `PRD.md`/`CHANGELOG.md`/`docs/`/`01-docs/` | `bash scripts/check-docs-sync.sh --base=<b> --head=HEAD` |

**push 触发实证**（#2280 的必要性证明）：`debt-guard.yml` 运行记录 `run=853 event=push branch=main sha=45c2e24692 conclusion=success`——main 自身处于违规态时会在欠债的那次合并上显红，而不是让之后每个无关 PR 全链卡红。

## 四、红绿验证（QM-5 五步反哺）

| 批次 | 红验证方式 | 结果 |
|---|---|---|
| 第1批 | 新增 `test_p0_*.py` 先失败后通过；pytest 门禁 | 绿 |
| 第2批 | 逐条目「改前红 / 改后绿」：409 pytest、11/273/66 vitest、150 `node --test` | 全绿 + 每项各自红基线 |
| 第3批 | P1-15 后端 13 pytest；Gate 17/18 脚本 QM-5 红验证 | 全绿 |
| 第4批 | 9 个变异（含「批量写入回退明文」）逐个转红 | 9/9 命中 |
| #2274 | 拆分后行数门禁由红转绿 + 500 行棘轮不放宽 | 绿 |
| #2291 | 变异自证：撤掉 `verifyRuntimeSignature` 的信任锚接入（回退成旧的无条件回落）→ 「打包 + 无锚必须被拒」转红 **1 failed / 9 passed**；还原后字节一致、`vitest run` 两文件 **70 passed** |
| #2280 | `node --test` **17/17**；两个反向变异（取消墓碑豁免 → 回归③红；`--update` 顺手抬基线 → 回归⑦红）；`--prune` 幂等二次调用 rc=2 且字节不变 | 全绿 + 变异自证 |

关键方法论修正：**门禁脚本自身的判定分支必须按生产喂法构造输入**（`evaluate(base, collectOverLimit(root,limit), scanAllLines(root))`）。旧用例直接喂人造字典，形状是 `main()` 产不出来的，导致「债已还」分支是死代码却长期绿灯。

## 五、基线现状（可复核数字）

- 行数挂账：`files` 99 条（`.py` 25 条），`pruned` 1 条（`apps/desktop/src/components/LogsSettings.vue: 469`），`limit=500`、`growthAllowance=200`。
- 依赖挂账：`scripts/dep-audit-baseline.json` 29 条，每条含 `decision ∈ {upgrade-tracked, accepted-risk, not-exploitable, no-fix-available}` 与 `reviewBy`。
- IPC 守卫：407 注册点 / explicit 273 / 覆盖率 67.1%（阈值 65%）。
- Python 中文文案基线：79 条。

## 六、遗留项与限期

| 项 | 状态 / 限期 |
|---|---|
| `QG Coverage` 的 `electron/tests/test_scheduler_parity.test.js`（模拟器 vs 真实 governor 六组对拍，含 `max_concurrent_observed`）在负载下偶发不相等 | **定性为偶发（负载相关），非回归**：同一时期含代码改动的 #2274 / #2275 / #2279 / #2281 / #2282 五个 PR 的 `QG Coverage` 全部 `SUCCESS/pass`，只有 #2276、#2270 的个别 run 失败于该用例（改动内容全在 Python 侧，与该 desktop 调度器时序断言无因果）。处置方向：按「脆弱等待」同口径改为条件化断言或注入固定时钟，已登记为独立缺陷，不阻塞本整改。 |
| `flutter-skill-bridge` 无回潮确认 | 下个发版周期末（2026-10-31）复核判据仍成立 |
| P0 泄露面逐机排查 7 项 | 运维在部署评审中签字（指引已交付：`KEY-ROTATION-GUIDE.md` + PRD 第三节） |
| electron-builder 代码签名 / auto-updater 更新链、备份恢复与灾备、CI secrets 暴露面全仓逐条审计 | 未审，绑定发版前专项（PRD 第十节） |
| `CHANGELOG.md` 行尾混合（CRLF/LF 并存） | 观察项：自动并集解冲突需按 keepends 处理；建议后续统一 `.gitattributes` 的 `text eol=crlf` 或全量规范化（独立 PR，勿夹带） |

## 七、记忆沉淀指针

- **内置记忆**：`四类判定处置口径与墓碑语义`（行数门禁）、`按生产喂法验证可达性 + 变异自证`（测试规范），以及前四批的 worktree/CI/gh 网络重试等 5 条工具经验。
- **外部记忆**：`~/.gstack/projects/Colinchiu007-Multi-Publish/learnings.jsonl` → `key=stateful-gate-escape-tombstone`（type=pitfall）。
- **EverOS**：`状态型CI门禁逃逸与墓碑设计：债务熔断检查复发3次及修复方案`、`单侧喂数据掩盖死分支：Multi-Publish 2026-09-23 测试规范实例`、`Debt Ratchet Correct Accounting: --update Command Risks and Proper Debt Repayment Workflow`。
- **仓内文档**：PRD 第九～十二节、`docs/audit-remediation-*`、`01-docs/learnings.md` 收尾三坑、`CHANGELOG.md` 各批条目。

## 八、复算指引（任何人在本地可重跑）

```bash
# 1) 行数门禁 + 墓碑语义 + 17 个用例
node .github/scripts/check-max-lines.js
node --test .github/scripts/check-max-lines.test.js
# 2) 依赖审计判定逻辑（不联网）
node --test scripts/check-dep-audit.test.js
# 3) IPC / 会话卫生
node .github/scripts/check-ipc-sender-guard.js --base-dir apps/desktop
node .github/scripts/check-ops-session-hygiene.js
# 4) 桌面端信任锚四态（P0-1）
npx vitest run runtime-trust-anchor.test.js ops-center-sync.test.js
# 5) 后端安全闸门
cd ops-center/backend && python -m pytest -q tests/test_p0_security.py tests/test_p1_15_session_cookie.py tests/test_key_service.py
# 6) 私钥字面量只剩测试夹具（测量基准 abc307cfa6：7 处 grep 命中 / 6 个测试文件，非测试 0）
git grep -n -E -e "BEGIN (RSA |EC )?PRIVATE KEY" origin/main -- "*.py" "*.js" "*.ts" "*.vue"
```
