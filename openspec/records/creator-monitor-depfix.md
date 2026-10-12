---
record: creator-monitor-depfix
task: 博主监控页整页不可用修复（依赖接线 / 添加博主 / 凭证入口 / 文案分因）
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

# 博主监控页整页不可用修复（creator-monitor-depfix，2026-10-12）

> 分支：`creator-monitor-depfix`（隔离 worktree `mp-creator-monitor-depfix`，**非 C 盘**，D 盘）；共享根保持 `main`。
> 范围：🛠 运行时代码变更（主进程接线 + 1 个新服务 + IPC/preload + 渲染层 2 个新组件 + 文案）+ 📝 文档
> ⇒ 完整质量节拍；`classify-docs-only.js` 判 `false`（混合 PR，重型 job 不短路）。
> 上游依据：`01-docs/PRD-CREATOR-MONITOR-COLLECT-2026-10-07.md` §17（本次新增）+ `openspec/specs/creator-monitor/spec.md`（本次 +4 Requirement）。

| 门禁 | 状态 | Fresh 证据 |
| ---- | ---- | ---------- |
| 变更类型与隔离 | PASS | `git rev-parse --abbrev-ref HEAD` = `creator-monitor-depfix`；worktree 在 `D:\Data\projects\mp-worktrees`（非 C 盘）；`node scripts/verify-worktree-deps.js` OK（11 项消费方解析到当前 worktree）；共享根 `D:\Data\projects\mulpub` 保持 `main`、写保护 watcher Running |
| 方案与规格先行 | PASS | 先定位根因（4 条）再改代码；PRD §17 与 spec 4 条 Requirement 逐条对账实现与回归锁；两处既有文案指引（指向不存在的设置字段）一并改正 |
| TDD | PASS | 本增量 8 个测试文件 **199 passed / 0 failed**（credential 33、dependency-probe 8、collector-runtime 15、wiring-e2e 9、ipc-handlers/creator 66、phase5-ipc 28、container.setup.creator 6、CreatorMonitor 34）。先写锁后修实现：三条锁在修好前**实测变红**（见下「变异反证」）；QM-6 W1/I2 处置各带新增用例 |
| 变异反证（3 条，取失败用例口径，已实测变红后回滚） | PASS | **同一轮实跑**（3 处同时注入，4 个文件 58 例 ⇒ **11 failed / 47 passed**，逐条归属清晰）：① M1 把 `phase5-ipc.js` 的取值口改回 `context` 自身 ⇒ **1 红**（`phase5-ipc.test.js`「从 context.container.get 解析 creator 依赖」）；② M2 注释掉 `container.setup.creator.js` 的 `creatorCredentialProvider` 注册 ⇒ **3 红**（`container.setup.creator.test.js`：注册四项 / 凭证提供者可解析 / 形状供给）；③ M3 从 `creator-collector-runtime.js` 去掉 `resolveChannelId` ⇒ **7 红**（`creator-wiring.e2e.test.js` 替身形状对账 + 真实方法集 2 条，`creator-collector-runtime.test.js` 5 条）。三处**均按原文还原**（`grep MUTATION` 0 命中）并复跑 ⇒ **58 passed / 0 failed** |
| 跨平面契约锁 | PASS | 「替身方法集 ⊆ 真实对象方法集」直接比对真实 `createCreatorCollector` 的返回对象——夹具替对方**造方法**是本轮最关键的逃逸路径（C3），已机械封堵 |
| 凭证安全锁 | PASS | 明文不落盘（`safeStorage:v1:` 前缀）/ 读到明文**拒用**并报 decrypt_failed / `status()` 序列化无 key / 日志无 key 片段 / safeStorage 不可用**零落盘** / 读失败与「未配置」不合并；6 类输入非法枚举 |
| 文案分因锁 | PASS | 主进程侧 11 个降级通道消息含「未就绪」且**不含**「依赖」；渲染侧 `service-unavailable` 时页面**不含**「缺少采集依赖」「请执行：」（两条独立锁，防任一侧回退） |
| 静态门禁 | PASS | `check-ipc-bridge` 459 handlers / 477 preload / 0 已知缺口；`check-ipc-sender-guard` 493 注册点、显式守卫 66.1%（≥65%）、0 绕过；`check-locale-sync --pair-base` PASS / `--cjk` PASS（基线 1489、当前 1224、无新增硬编码）/ `--keys` PASS（1910 key 均存在）；`check-frontend-consistency` PASS（windowConfirm 0 / rendererIpcDirect 0）；`check-font-size-scale` PASS（34/790）；`check-no-brand-residue` PASS（8128 tracked 文件）；`check-unwired-tests` PASS；`check-text-encoding-integrity` PASS（无新增损坏）；ESLint 改动文件 0 error |
| i18n 成对 | PASS | `locales/collection/{zh,en}.js` 各新增 36 键（顺序一致）；`--keys` 与 `--cjk` 双档 PASS。⚠ 实测记录：裸 `@` 在 vue-i18n **字符串**消息里是链接语法（编译抛 `Invalid linked format`），生产侧 `toMessageFunctions` 已把全部字符串叶子转成函数故安全，**测试桩**含 `@` 的词条必须写成函数形式（本次已在 CreatorMonitor.test.js 注明） |
| QM-1 打包 | PASS | `node scripts/verify-worktree-deps.js` OK → `pnpm run build:dir` rc=0；asar 核对见下方「QM-1 明细」 |
| QM-2 代码审查必检项 | PASS | 全部 `require` 路径可解析（`ipc-contract.test.js` 强制入口文件本地 require 通过）；preload 改源 ⇒ `node scripts/build-preload.js` 已重生成 `index.bundle.js` 与 `home-shell-preload.bundle.js`；新增通道在**两个 bundle** 中均可 grep 到；IPC 参数为纯 JSON 字面量；凭证明文只在写通道单向进入主进程，读方向零回传 |
| QM-4 视觉 | N/A（如实说明） | 本 PR 新增两个弹窗组件与一处横幅，均为**新组件**、不改既有视图布局；`collection` 视图的像素基线与本改动的关系交由 CI Gate 7b 判定（本机未跑像素套件，不做「本地已过」的假声明） |
| QM-6 双模型评审 | PASS | 后端 claude：Critical 0 / Warning 1 / Info 3（**W1 已修**：新增 read_failed 态 + 专门文案 + 三态互斥测试；I2 已修：删死代码 getCredential + 反向锁；I3 改文案；I4 观测项）。前端 opencode 3 次未产出结构化 findings ⇒ **critic-only**，其 3 个疑点由主代理用机械门禁逐条核验（详见 QM-6 明细），不冒充双模型通过 |
| 未闭合（诚实记录） | — | ① 未做真机端到端（本机无可用 YouTube Data API Key）；② Python `content-aggregator` 是否已装，Node 侧无法区分（只到「桥在不在跑」）；③ creator 通道的许可级别仍为 authenticated，与旧头注「已登记 public」不符——本次只改注释，许可策略变更需人工裁决；④ 字幕腿的自动安装引导（复用 asr-installer）未做 |
| 记忆沉淀 | PASS | ① **外部记忆（仓库文档）**：PRD §17 + `openspec/specs/creator-monitor/spec.md`（+4 Requirement / 9 Scenario）+ 本记录 + `CHANGELOG.md` 置顶条目 + `01-docs/learnings.md` 新章节（append-only，两口径 `--numstat` 对账见下注）。② **外部记忆（本机 gstack learnings.jsonl）**：追加 4 条（`container-get-throws-on-unregistered-name-so-fallback-must-catch` / `defensive-ternary-on-a-nonexistent-method-hides-a-total-outage` / `test-double-must-not-invent-methods-the-real-collaborator-lacks` / `bare-at-sign-in-i18n-string-messages-throws-invalid-linked-format`），文件 157 → **161 行**、逐行 `JSON.parse` 校验 **0 坏行**。③ **EverOS**（本机 v1.4.1 @127.0.0.1:8000，健康检查 200）：`POST /api/v1/memory/add`（session `mp-creator-monitor-depfix-20261012`）回 `accumulated`、`/api/v1/memory/flush` 回 **`extracted`**；**读回产物为判据**——`~/.everos/default_app/default_project/users/agent/episodes/episode-2026-10-12.md`（**11483 B**）中 grep 到哨兵串 `creator-monitor-depfix` / `resolveChannelId` / `service-unavailable` 各命中（另两条哨兵被抽取层改写，属已知形态，不以自造标签为准）。④ **内置记忆**：本会话 DSH 会话档由 harness 自动落盘（无对外写 API），未手工伪造。 |
| 远程同步 | PENDING | 待本 PR 合并后回填 PASS + merge SHA，并在**同一次提交**删除 `scripts/gate-record-debt-ledger.json` 的登记项 |

> 行尾两口径注：本增量 5 个文件在 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 之间差 **1 行**（`PRD-CREATOR-MONITOR-COLLECT`、`creator-dependency-probe.test.js`、`CreatorMonitor.test.js`、`CreatorMonitor.vue`、`creator-monitor/spec.md`）。已用 **blob 级取证**排除「行尾改写」：`git cat-file blob HEAD:<f>` 与索引 blob 的 CR 计数**均为 0**，且被替换的锚点行两侧**逐字节相等**（PRD 实测：HEAD 与 index 的第 1593 行同为 199 字符、`equal=true`）；差异来自 `w/crlf` 检出与 `text=auto` 在 diff 渲染层的口径差，不代表提交内容变化（本增量对文档均为纯追加）。

### QM-1 明细（asar 核对 + 启动测试的如实边界）

- 产物：`apps/desktop/dist-electron/win-unpacked/resources/app.asar`（151,098,942 B，`pnpm run build:dir` rc=0，含 `vite build`）。
- 核对项（逐条实跑，不取 rc 当判据）：
  1. `asar list` 含新模块与改动模块：`\electron\services\creator-credential.js`、`\electron\services\creator-collector-runtime.js`、`\electron\core\container.setup.creator.js`、`\electron\bootstrap\phase5-ipc.js`；
  2. asar 明文命中四个新通道字面量（`creator:credential-status` / `creator:credential-set` / `creator:credential-clear` / `creator:dependency-status`）共 **17** 处 ⇒ 证明两个 preload bundle 已随源码重生成，不是旧产物；
  3. `asar extract` 后 `require` 新服务并真实调用：`createCreatorCredentialProvider` 四态常量齐（`ok/not_configured/unavailable/decrypt_failed`）、`status()` 回 `not_configured`、`setApiKey('AIza'+35×'x')` 回 `saved`（加密往返通路可用）。
- ⚠ **「启动 8 秒存活」这一条在本机不可判，如实登记为未取证**：用户的应用实例**正在运行**（实测 6 个 `electron.exe`，均来自 `mp-app-live2`，带 `--user-data-dir=D:\Data\projects\mulpub\shared-user-data`，10:52 启动），打包实例被 Electron 单实例锁拒绝后**以 exit code 0 正常退出**（两次实跑：`Multi-Publish.exe` 无参数 ⇒ exit 0、stderr **0 行**；换 `--user-data-dir=<temp>` ⇒ 该 exe 回 `bad option`、exit 9，属参数面而非启动面）。**替代证据**为上面三项 asar 核对 + 退出码 0 + stderr 零行（无 `Failed to load platform config` / `ENOTDIR.*app.asar` / `Cannot find module`）。
- 明确不做：**不为了拿到这条证据去终止用户正在运行的应用实例**（AGENTS.md 明令：按名字批量 kill 必然误杀其他 worktree 的实例）。


### QM-6 明细（双模型并行，后端 claude 产出结构化 findings；前端 opencode 三次未产出 ⇒ critic-only，如实记账）

- **后端 claude**（session `964672be-a739-48f3-a093-e97f70064760`）：**Critical 0 / Warning 1 / Info 3**。
  正面确认（评审原话摘要）：四条根因"全部真实修复并被回归锁锁住（且验证过锁在修复前是红的）"；
  `resolveContextDep` 三态处理正确、结构锁 + 反向断言设计得好；凭证读写方向符合 PRD（唯一写通道、
  读方向零明文、非 `safeStorage:v1:` 前缀一律拒用）；e2e 方法集对账是"本轮最有价值的改进之一"。
- **处置**（逐条，全部在本次提交内落地）：
  - **W1（CONFIRMED，已修）**：settings **读取失败**被并入 `decrypt_failed`，与我自己的注释及
    PRD §7.4「三态必须可区分」的意图矛盾——读失败时重填**无效**，会让用户反复重填。
    处置：新增第五态 `read_failed`（`CREDENTIAL_STATUS.READ_FAILED`），渲染层横幅与弹窗各给专门文案
    （`creatorCredentialStatusReadFailed` zh/en 成对），测试从「读失败=decrypt_failed」改写为
    「读取失败 / 无该键 / 解密失败三者互不相等」，spec「凭证安全」Requirement 与 PRD §17.3.6 同步。
  - **I2（CONFIRMED，已修）**：`getCredential()` 是死代码且形状差半截（只有 apiKey、没有 pythonBridge）——
    改接它会让字幕腿静默消失。处置：**删除**该方法并留注释说明"供给形状的唯一实现在容器适配闭包"，
    加一条 `expect(p.getCredential).toBeUndefined()` 的反向锁。
  - **I3（PLAUSIBLE，已改文案）**：桥整体缺失时也返回 pip 命令，可能把「没有桥」与「缺包」混同展示。
    处置：文案改为「**若确认缺少该包**，可在终端执行：{command}」（zh/en 同步）——命令保留为修复提示
    但不再暗示已确诊；`installHint` 数据本体不动（Node 侧确实不可区分，见 §17.3.4）。
  - **I4（PLAUSIBLE，观测项，不改）**：`wired` 判定与 `creatorQuota` 派生的轻微一致性空档。
    当前装配下 `wired=true` 时 quota 必然存在，无现实缺陷；留作观测，不为假想形状加防御。
- **前端 opencode**：三次调用（含从中性 cwd 重试、输出重定向到文件避开 EPIPE）均未产出 JSON findings
  ——它把预算花在分块读 diff 上，返回的是工作过程摘要（session `ses_ed1ef740affebDwodGSg30hMdG`）。
  按 AGENTS.md「3 次全败才跳过」记为 **critic-only**，其摘要里的三个疑点由主代理逐条机械核验：
  ① e2e 替身是否仍手搓方法 ⇒ 已被本轮新增的「替身方法集 ⊆ 真实对象方法集」锁覆盖（真实对象现在确有
  `resolveChannelId`，对账用例 9/9 绿）；② preload 与 handler 通道一致性 ⇒ `check-ipc-bridge`
  459/477/0 缺口 PASS；③ locale zh/en 成对 ⇒ `check-locale-sync --pair-base/--keys` PASS。

### 本增量在做什么（一句话）

把「博主监控页打开就只剩一句『缺少采集依赖。请执行：』、点关注毫无反应、全应用无处填 API Key」
修成可用状态：依赖从容器正确解析、凭证提供者注册并接上、采集器补齐频道解析入口、
文案按 reason 分因、并补上「添加博主」与「配置 API Key」两条真正可达的入口。

### 不做的事（边界）

- 不动许可策略（creator 通道仍为 authenticated，改策略需人工裁决）。
- 不新增 npm / pip 依赖，不改 `content-aggregator` 的复用方式，不改采集与配额逻辑。
- 不碰 `Collection.vue`（2920 行存量挂账文件）：页签按钮与页面挂载点均为既有接线。
- 不做字幕腿的自动安装（只给确切命令），不虚构「已确诊缺包」。
