# 任务：快捷采集·中文素材源扩展（quick-collect-cn-sources）

> 依赖顺序：S1 → S2 → S3（S4 待用户提供 Key）。TDD：每一项先落测试再写实现。
> 每项都必须在同一 PR 内补齐：`.quality-gates.md` 记录 + `openspec/records/quick-collect-cn-sources.md` + CHANGELOG。

## S1. 接线：中文榜单源进快捷采集（零新抓取）

- [x] S1.1 新增 `quick-collect-sources.js`：声明式源注册表（`SEARCH_SOURCE_IDS` / `TREND_SOURCE_IDS` / `ALL_SOURCE_IDS` /
  `getSource()` / `splitSources()` / `hostAllowed()`）；8 个中文榜单源 + 3 个英文 search 源；测试：闭集不重叠、
  未知 id 判定、`splitSources` 分流、`hostAllowed` 子域与大小写
- [x] S1.2 `quick-collect-command.js`：源闭集改为从 registry 派生（保持 `ALLOWED_SOURCES` 导出名与语义兼容）；
  测试：新增源可通过、未知源仍报 `QC_SOURCES_INVALID`
- [x] S1.3 `quick-collect-materials.js`：素材模型增 `timeKind` / `observedAt` / `sourceType` / `rank` / `hotValue` / `urlKind`；
  窗口按有效时间判定；`domain_mismatch` 归因；测试：observed 通过窗口 / published 照旧 / 两者皆缺 → `missing_time` /
  未来时间 → `future_time` / 域名不匹配 → `domain_mismatch`
- [x] S1.4 `quick-collect-prompt.js`：素材清单带源标签 + 名次 + 时间语义；system 增两条硬约束；测试：逐字断言
  「榜单素材不得写成发布时间」条款存在、observed 行含「抓取时刻」、published 行含「发布」
- [x] S1.5 `quick-collect-engine.js`：按 kind 分流（`searchFn` / `trendFn`）；三态口径扩为 `attempted`；
  `quickCollect` 增 `trendSources` / `sourceStats` / `timeKinds`；测试：纯英文指令行为不变（trendFn 不被调用）、
  纯 trend 指令可出结果且 `retrieval != 'skipped'`、trend 失败 ⇒ `partial`
- [x] S1.6 `ipc-handlers/quick-collect.js` + 依赖注入：由 `hotTopicsService` 组 `trendFn`（映射统一素材、带 fetchedAt→observedAt、
  rank、hotValue、homeUrl 兜底）；引擎重建身份包含 `hotTopicsService`；测试：注入假服务 ⇒ 素材进结果、未注入 ⇒ 降级不报错
- [x] S1.7 `quick-collect-presets.js`：`builtin-hot-topics` 等词条增补源（`builtin-ai-trends` 提示词逐字不动）；测试：源 id 全属闭集、
  逐字断言 AI 领域动向提示词
- [x] S1.8 渲染端 parity：`quick-collect-commands.js` 源清单镜像 + 跨平面 parity 测试；对话框「素材来源」分组提示（locale zh/en 成对）
- [x] S1.9 变异反证：① 摘掉 `timeKind` 分支 ⇒ observed 素材被 `missing_time` 丢掉；② 摘掉域名校验 ⇒ `domain_mismatch` 用例红；
  ③ 把 trend 源当 search 源 ⇒ 分流用例红；④ 提示词删硬约束行 ⇒ 断言红；⑤ registry 加一个源但渲染端镜像不加 ⇒ parity 红；
  ⑥ trendFn 未注入时抛错而非降级 ⇒ 降级用例红。逐条实测指名变红后回滚

- [x] S1.10 补遗（change：quick-collect-cn-verticals）：把 `hot-topics` 的两个**独立信道**垂类
  （`sina_finance` 新浪财经滚动、`ithome_tech` IT之家热榜）入册（`group:'cn-hot'`、`provider:'hot-topics'`、
  `hottest`+`observed`），`builtin-hot-topics` 吃到 8 主榜 + 2 垂类，`builtin-dev-tools` 加垂类科技；
  测试：注册表**闭集断言**锁死 `hot-topics` 恰好这 10 个 id、IPC 映射断言垂类素材同样是 `observed`+「抓取时刻」、
  词条覆盖断言；文档：PRD §4.1 补两行 + 5 垂类口径说明（另 3 个 board 级垂类随主榜到达，不另立源）。
- [x] S1.11 变异反证（补遗）：① 从注册表摘掉 `sina_finance` ⇒ 闭集断言红；② 把垂类 `timeKind` 改成 `published` ⇒
  provider/时间语义不变量红。两条实测变红后回滚。

## S2. 时间线源：带发布时间的免费中文/技术源

- [x] S2.1 新增 `quick-collect-trend-sources.js`：RSS/Atom 轻量解析（`<item>/<entry>`、`<title>`、`<link>`、`<pubDate>`/`<published>`）
  + JSON 解析（V2EX hot、HF daily_papers）；`MAX_BYTES=512KB`、`MAX_PER_SOURCE=20`；测试：5 个真实响应片段夹具（含 CDATA、
  实体、缺 link、缺时间）+ 超长响应截断 + HF `MM/DD/YYYY` 解析
- [x] S2.2 源清单落 registry：`solidot` / `sspai` / `oschina` / `ithome` / `v2ex`（时间线）/ `arxiv_cs_ai` / `hf_papers` / `qbitai` / `infoq_cn`；
  每条带 `expectedDomains` / `intervalMinutes`；测试：每条源都有时间字段解析器、都有域名清单
- [x] S2.3 抓取层接入引擎：`trendFn` 由 `hot-topics` + `feed` 两个 provider 合成；测试：provider 部分失败 ⇒ `partial` 且失败源在 `sourceStats`
- [x] S2.4 计划性空榜：arXiv 周末空 ⇒ `emptyBySchedule`；测试：周六夹具 → 标记而非 failed；UI 文案区分（locale 成对）
- [x] S2.5 内置词条增补 S2 源（`builtin-ai-trends` 提示词仍逐字不动）
- [x] S2.6 变异反证：① 时间解析退化为 `Date.now()` ⇒ published 窗口用例红；② HF 时间格式改成 ISO ⇒ 该源用例红；
  ③ 去掉字节上限 ⇒ 超限夹具用例红；④ 去掉 per-source 截断 ⇒ 条数用例红

## S3. 政策/合规源（HTML/RSS 化，逐一实测后入册）

- [x] S3.1 端点实测（2026-10-11，7 个候选）：**平台官方页全部 JS/登录态渲染（0 条目）**；监管站点列表页可解析标题但**缺条目级时间**；网信办子栏目路径 404 ⇒ 按纪律**无源入册**。证据表见 PRD §4.3
- [x] S3.2 不实现解析器（无实测通过的源可接）——**以 PRD §4.3 的证据表收口**，避免用必然半坏的 HTML 解析冒充能力
- [x] S3.3 不做增补；`builtin-platform-policy` 维持英文社区源，缺口在 PRD §4.3 与 §15 如实登记（含三条后续路径 A/B/C，待用户拍板）
- [x] S3.4 无需变异反证（无实现）；**决策本身已被证据锁住**：没有"能拿到条目级时间"的源，任何解析器都只能靠猜

## S4. 付费中文检索（阻塞：待用户提供 Key 与预算）

- [x] S4.1 不实现任何调用；**不在 registry 留占位开关位**（registry 只允许实测通过的源，占位会让"支持付费源"与"只登记名字"无法区分）；已在 PRD §4.4 与本节如实登记为「待用户提供凭证/预算」
- [ ] S4.2（**阻塞：待用户提供 Key 与预算**）若提供：新增 provider + 密钥只从设置读、绝不落日志（沿用既有凭证脱敏纪律）

## 收尾（每个切片各自一套）

- [ ] PRD 增补（本节切片对应章节）+ CHANGELOG 顶部条目
- [ ] `.quality-gates.md` 记录（含 `| 远程同步 | PENDING |`）+ `scripts/gate-record-debt-ledger.json` 登记
- [ ] `openspec/records/quick-collect-cn-sources.md` 执行记录（TDD 数字、变异反证、门禁、QM-1/QM-4、未闭合）
- [ ] 静态门禁：`check-max-lines`（Collection 域） / `check-locale-sync` 三档 / `check-ipc-bridge` / `check-ipc-sender-guard` /
  `check-frontend-consistency` / `check-no-brand-residue` / `check-ps1-bom`（不涉及）/ ESLint error 级
- [ ] QM-1：`verify-worktree-deps` + `pnpm run build:dir` rc=0 + asar 内容核对
- [ ] QM-4：若结果卡/对话框文案变化 ⇒ 按**同一次 CI run** 的 artifact 重取基线并逐字节自证 sha256
- [ ] 记忆沉淀：`01-docs/learnings.md` 新章节 + 本机 gstack `learnings.jsonl` + EverOS session flush
- [ ] PR：推送 → `gh pr create` → CI 全绿 → `--squash --delete-branch`（判据取产物）→ 回填 PR 合并 → worktree 按 R1-R5 清理
