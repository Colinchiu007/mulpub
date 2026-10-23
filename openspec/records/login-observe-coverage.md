---
record: login-observe-coverage
task: 补正头条号登录期观测的覆盖面（真实生效的验证码入口此前既不在监测域、也不匹配锚点）
date: 2026-10-22
---

## 本次执行记录：补正头条号登录期观测的覆盖面（login-observe-coverage，2026-10-22）

> 变更 ID: `login-observe-domain-coverage` ｜ 分支: `login-observe-coverage`
> Worktree: `<worktree>/mp-login-observe-coverage`
> 关联: `01-docs/PRD-LOGIN-SLOT-REUSE-2026-10-21.md`（§5.5、§5.6）、
> `01-docs/TROUBLESHOOT-TOUTIAO-LOGIN-SLOW-2026-10-21.md`（§1.1、§3.2、§五）、
> `openspec/changes/login-observe-domain-coverage/`、上一刀 `openspec/records/login-partition-reuse.md`

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（`apps/desktop/electron/services/`）：隔离 worktree `<worktree>/mp-login-observe-coverage` + 裸分支 `login-observe-coverage`（`scripts/start-mp-task.ps1 -TaskName login-observe-coverage` 建，依赖经 `verify-worktree-deps` 验证就绪）；经 PR 落地，不直推 main |
| 第一性原因（QM-5 ①） | PASS | 上一刀的监测域清单取数口是**运行时的请求流**（首屏加载触发的域），而图形验证码组件是**点「发送验证码」之后才按需加载**的 ⇒ 首屏观测抓不到它。换取数口（抓 `https://mp.toutiao.com/` 的**登录页 HTML 静态引用**）后立刻看到漏的两条：承载真实验证码入口的「验证码中心」域与「风控 glue」域。⇒ **不是当时没看仔细，是取数口有结构性盲区** |
| 逃逸分析（QM-5 ②） | PASS | 域清单是**数据**（数组），没有「清单必须覆盖登录页静态引用域」这类**可表达的**判据；锚点是**字面量数组**，同样没有「必须覆盖真实链路上出现过的形态」的判据。既有反例锁只锁了「查询串/域名里出现标记不算」，没锁「真实形态必须命中」⇒ 两条断言的对象都是**实现**、不是需求 |
| 修复 + 回归保护（QM-5 ④） | PASS | ① 监测域补 2 条（`yhgfb-cn-static.com` / `bytetos.com`）；② 验证码判定新增**组合锚点**并抽成**具名谓词** `isCombinedCaptchaAnchor(path)`（版本目录段与组件段**同时**出现才算）；③ 老形态（`secsdk-captcha` / `webmssdk`）、「只认路径不认查询串/域名」、未登记平台过滤面**一字不动**。新增用例 5 组（真实入口命中 rc1/rc2、域覆盖双向断言、泛化反例 ×5、常量断言、具名谓词优先级）；本刀相关 9 个测试文件 **275 passed / 0 failed** |
| 防止再次发生（QM-5 ⑤） | PASS | ① 用例**从真实链路取样**：真实 URL 写字面量（不用常量拼，避免测试与实现同源导致「改了实现测试也跟着变」的失真）；② 泛化反例覆盖 5 种退化形态（缺组件段 / 缺版本目录段 / 带前缀段 `not-captcha/` / 百分号编码变体 / 查询串）；③ **变异反证 M1~M8 全 CAUGHT**，原始 harness 输出与 md5 逐一比对**附进 `.ccg/reviews`** 的评审记录（证据而非叙述）；④ 监测域清单处补**显式边界守卫**（只读 / 不外发 / 不拦截 / 不记凭证）——「扩大监测域 = 扩大被看见的请求集合」≠「扩大数据出站面」，这条以前只是隐式假设 |
| 行尾与 diff 对账 | PASS | 两口径 numstat 逐文件一致（无 CRLF/LF 漂移）：E1 与 E2 两批改动的 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 增删行数逐个相同 |
| 接线棘轮 | PASS | 未新增 `*.test.js` 文件（全部落在既有 `login-network-diagnostics.test.js` 内）⇒ 无需 workflow 接线；`observability-messagekey.test.js` 的「登记键总数 === notify 调用总数」锁仍通过（本刀**未新增 notify 事件名**） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（主进程服务与日志，无 UI 文件、无新依赖、无打包资源）⇒ 视觉门禁不适用；打包证据由 CI 侧取 |
| QM-6 CCG 双模型外部评审 | PASS | critic=`claude` / proposer=`opencode`（`scripts/ccg-review-backends.list`）；判定档 **SINGLE**（变更 ≤ 200 行且无敏感命中）—— 驱动的 single 档**仍然同时调用两个后端**（`cfgForMode` 的 base 即 `proposer: opencode` / `critic: claude`），只是轮数压到 1 轮、不强制 `requireCrossFamily` ⇒ **双家族实质参与**，不是单模型。已跑三轮：① 7 条（1C/4W/2I，最低分 6）② 7 条（2C/4W/1I+2I，最低分 5）③ 8 条（2C/4W/2I，最低分 4，其中 **2 条高危域须外部复核**）。逐条裁决已填 `.adversarial/ccg-deep-d2cd13a0/adjudication.json`（5/5）；第一轮记录已用 `debtClosure` 闭合（status=`needs_revision`，闭环白名单值）。第三轮的 2 条高危已修：①「边界只写在注释」→ 结构化 `OBSERVATION_GUARD` 清单 + **源码级契约锁**（变异 M9a/M9b/M9c 全 CAUGHT）；②「监测域缺来源验证链」→ 仓内证据快照 `evidence/login-page-host-snapshot.txt`（抓取时刻 + 每域一个实例资源路径）。第四轮针对本批修复的读数见 PR 评论与 `.ccg/reviews` |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

## 一、需求

2026-10-22 用户追问「头条号登录页加载慢是我本机的问题还是通用问题」。复测过程中发现：
上一刀交付的「记录图形验证码组件加载完成（灰显遮罩结束的时刻）」在**真实链路上不生效** ——
承载真正生效的验证码入口的那个域，**既不在**监测域清单里、**也不匹配**已登记的路径锚点。
⇒ 该域的失败请求 / HTTP≥400 / 慢请求**一条都不记**，灰显时刻读数**缺失**。
本刀只补这个缺口。

## 二、根因（判据；现场读数见 `design.md` §D6）

上一刀的监测域清单取数口是**运行时的请求流**（首屏加载触发的域），
而图形验证码组件是**点「发送验证码」之后才按需加载**的 ⇒ 首屏观测抓不到它。
换一个**互补**的取数口——抓 `https://mp.toutiao.com/` 的**登录页 HTML 静态引用**——立刻看到漏的两条：
承载真实验证码入口的「验证码中心」域与「风控 glue」域。

| 取数口 | 能看到 | 看不到 |
| --- | --- | --- |
| 运行时的请求流（上一刀） | 首屏加载触发的域 | 页面引用但**尚未被请求**的域（验证码组件正在其中） |
| 登录页 HTML 的静态引用（本刀） | 页面引用的一切域 | 纯运行时动态拼接、无静态引用的域 |

⇒ 两个取数口**互补，缺一不可**；上一刀只用了第一个。
域来源的可复现证据（抓取时刻 + 抓取内容 SHA-256 + 每域一个实例资源路径）见
`openspec/changes/login-observe-domain-coverage/evidence/login-page-host-snapshot.txt`；
现场读数（504 首包 16.68s、外部网络同样 504、登录页 48.9/56.3s、浏览器对照 23.8s、
真实验证码入口冷 2.65~2.96s / 命中边缘 0.13s）见 `design.md` §D6。

## 三、实现

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/electron/services/login-network-monitor.js` | 监测域 +2（`yhgfb-cn-static.com` / `bytetos.com`）；验证码判定新增**组合锚点**并抽成具名谓词 `isCombinedCaptchaAnchor(path)`；新增**结构化边界清单** `OBSERVATION_GUARD`（只读 / 不外发 / 不拦截 / 不记凭证 + 读体平台清单）；监测域清单处补边界注释并指向域来源证据 |
| `apps/desktop/electron/services/login-network-diagnostics.js` | 读体闸门改为**由 `OBSERVATION_GUARD.readsResponseBodyPlatforms` 驱动**（此前是「`AUTH_ENDPOINT_MATCHERS[platform]` 有没有」内嵌判断；边界由注释保证 ⇒ 删注释就无保障） |
| `apps/desktop/electron/services/login-network-diagnostics.test.js` | 用例扩到 **+8 组**：真实入口命中（rc1/rc2）、域覆盖双向断言、泛化反例 ×8（含 `not-captcha/` / `pre_captcha_suffix/` / `fake_sec_sdk_build/` 三种带前缀段）、常量断言、具名谓词优先级、**每条边界各有 forbidden/required 锁的逐条扫描（扫的是去注释后的代码）**、域来源证据必须在仓内 |
| `openspec/changes/login-observe-domain-coverage/evidence/login-page-host-snapshot.txt` | **域来源的可复现证据**：抓取时刻 + 抓取命令 + 抓取内容 **SHA-256** + 登录页静态引用的 14 个主机名及每个域的一个实例资源路径 |
| `openspec/changes/login-observe-domain-coverage/evidence/mutation-harness.cjs` | **变异反证的可复现载体（入仓）**：11 条变异（实现文件 8 条 + 读体闸门 3 条），判定口径 = vitest 退出码（0=ESCAPED / 1=CAUGHT / 其他=环境问题**不算** CAUGHT），跑后**每个被变异文件分别**比对 md5 |
| `apps/desktop/electron/services/login-network-diagnostics.test.js` | +5 组用例：真实入口命中（rc1/rc2）、域覆盖双向断言、泛化反例 ×5、常量断言、具名谓词优先级 |
| `01-docs/PRD-LOGIN-SLOT-REUSE-2026-10-21.md` | §5.5 监测域与形态补正；新增 §5.6「观测面覆盖补正」（动因 / 判据三行对照表 / 不做什么） |
| `01-docs/TROUBLESHOOT-TOUTIAO-LOGIN-SLOW-2026-10-21.md` | §1.1 复测读数（把「谁的锅」再拆细一层）；§3.2 标注清单已于 2026-10-22 补正（10 → **12 条**），域清单**仍不进仓内文档**；§五 改为「应用侧已做的三件事」 |
| `openspec/changes/login-observe-domain-coverage/` | change（proposal 含「影响面量化」表 / design / tasks / `specs/desktop-logging/spec.md` 增量） |

## 四、回归锁（测试先行）

| 契约 | 用例落点 |
| --- | --- |
| 真实生效的验证码入口被识别（含 rc1/rc2 两个冗余节点） | 「真实登录页的验证码入口（rc-verifycenter 形态）被判为验证码组件」 |
| 组合锚点**两段缺一不可** | 「验证码组件新形态不得泛化」+「组合锚点谓词两段缺一不可（具名谓词的优先级测试）」 |
| 泛化不得发生（缺段 / 跨段 / 前缀段 / 编码变体 / 查询串） | 同组 5 条反例 |
| 监测域覆盖真实验证码与风控域，且过滤面同步 | 「头条监测域必须覆盖真实登录页用到的风控与验证码域」 |
| 常量不得被悄悄改宽 | 「组合锚点的两段常量必须是预期的版本目录段与组件段」 |
| 观测层四条边界必须以**可执行清单**存在，读体闸门由清单驱动且排在读体调用之前 | 「观测层的每条边界都必须有可执行锁…」—— 逐条扫**去注释后的代码**：forbidden 形态零命中、required 形态必须存在；变异 M9a/M9b/M9c 三种退化全 CAUGHT |
| 监测域的**来源证据**必须在仓内 | 「监测域的来源证据必须在仓内…」—— 断言 `evidence/login-page-host-snapshot.txt` 存在、含两个新增域、含真实验证码入口形态 `sec_sdk_build`、含抓取时刻与来源 URL |

### 4.1 测试读数（Fresh）

| 范围 | 读数 |
| --- | --- |
| 本刀相关 9 个测试文件 | **277 passed / 0 failed** |
| 变异反证 M1~M9 | **全 CAUGHT**（M1/M2 监测域各去一条；M3/M4 组合锚点各去一段；M5 匹配恒 false；M6 锚点整体失效；M7/M8 具名谓词恒 false/恒 true；**M9a/M9b/M9c 读体闸门被删 / 改成永真 / 挪到读体调用之后**）；跑后**两个被变异文件各自**比对 md5 均相等，另比对测试文件 md5（跑前跑后相等 ⇒ harness 全程没动过它） |
| 变异反证首轮逃逸 | **M4 首轮 ESCAPED** ⇒ 暴露的是**用例弱点**（原负例 URL 路径里没有真正的 `/captcha/` 段 ⇒ 去掉条件也不变、钉不住），补强后 CAUGHT |
| 行数门禁 `.github/scripts/check-max-lines.js` | **无新增超大文件，挂账清单与现实一致** |
| `node scripts/openspec-sync-check.js` | **OK**：387 tasks / 97 active changes / 243 archives |
| `node scripts/check-doc-abs-paths.js --base=origin/main` | **PASS**（无新增本机绝对路径） |
| `node scripts/check-no-brand-residue.js` | **PASS**（扫描 11886 个 tracked 文件） |

## 五、遗留（不假装闭合）

- **本仓修不了字节侧那个 504**，也修不了本机链路的首包偏慢。本刀只保证「**该被看见的都被看见**」，
  **不保证**「看见之后能修」——这是两件事。
- **监测域清单是 2026-10-22 现场实测的形态，不是「永久正确」的清单**。平台改版若换形态（换域或换路径），
  仍需按本刀同法补测：抓登录页 HTML 的静态引用清单，与监测域清单比对。
- **域来源快照里有一个域刻意不在监测域清单内**：`www.douyin.com`（抖音域，登录页引用了它的脚本）。
  刻意**不**纳入：抖音域不是头条号登录链路必需的域，且它承载大量与登录无关的资源，
  纳入会把观测面无谓地扩大。快照如实列出它，便于后续复核时看到这条**已知且已裁决**的差异。
- **43MB 背景视频不受益于缓存复用**（206 分段响应不入 Chromium 磁盘缓存）——那是上一刀已登记的遗留。
- **第一轮外部评审针对的是 `d2cd13a0` 的 diff**，i2/i3/i4 三处修复由本 PR 随后的提交承载；
  用新增的回归锁（泛化反例 ×5、常量断言、具名谓词优先级）与变异反证 M1~M8 全 CAUGHT 反证其正确性。
