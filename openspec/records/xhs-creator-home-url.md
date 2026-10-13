---
record: xhs-creator-home-url
task: 创作者中心开卡首屏闪登录页——已登录账号用「路由入口 URL」开卡（小红书 `/` 而非 `/new/home`）
date: 2026-10-13
---

## 本次执行记录：创作者中心开卡首屏闪登录页（xhs-creator-home-url，2026-10-13）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`packages/shared-utils/src/platform-definitions.js`、`platform-definitions.browser.js` + `apps/desktop/src/views/Accounts.vue`）+ 3 个测试文件 + PRD ⇒ `classify-docs-only` 判 **false**（混合 PR），走完整门禁；隔离 worktree `D:\Data\projects\mp-worktrees\mp-xhs-creator-home-url`（D 盘）+ 裸分支 `xhs-creator-home-url`，基线 `origin/main` = `c6b4709cd`；`start-mp-task.ps1` 自动完成 `pnpm install --frozen-lockfile` + `ensure-electron.js`（v43.7.7）+ `verify-worktree-deps.js`（11 项消费方解析到本 worktree）；`pre-code-edit-guard.ps1` rc=0；共享根任务前后 `git status --porcelain` 空（保持 main clean） |
| 用户报障原文 | ✅ | 「启动的应用，点击小红书账号，还是会先跳转登录页闪动，然后才打开创作者中心。你查一下现在启动的应用，是用了最新代码吗？」 |
| 前置问题先答（版本核对） | ✅ | 先证伪「跑的是旧代码」：运行中实例（8 个 electron 进程）cwd/worktree = `mp-app-live2`，其 HEAD `c4436a23f` 含前置修复 `a22e424a7`（`git merge-base --is-ancestor` 为真），`utils.js`/`tab-lifecycle.js` 落盘时间 2026-10-12 10:46:25 早于进程启动 2026-10-13 00:33:53；真机日志当日 `blank bootstrap document requested` + `removed bootstrap about:blank history entry` 各 2 次（间隔 241ms，**无** `timed out after 2500ms`、无 fallback）⇒ **跑的是含修复的最新代码**，闪烁另有其因 |
| 第一性原因（QM-5 ①） | ✅ | 已登录账号点「创作者中心」用的是 `PLATFORM_DASHBOARD_URLS[platform]`，而 `PLATFORM_DASHBOARD_URLS.xiaohongshu === 'https://creator.xiaohongshu.com/'` 是该 SPA 的**路由入口**、不是**已登录首页**。平台从 `/` 启动时先渲染登录路由，待其内部鉴权请求（该分区缺主站 `web_session`，实测 `redirectReason=401`）返回后才跳 `/new/home`。真机 CDP 逐帧（运行中应用，`--remote-debugging-port=9279`）：`/`(t+0) → `/`(t+2.4s) → **`/login`(t+3.6s)** → **`/new/home`(t+4.8s)**；全程该分区 xhs Cookie 恒 19 个、登录态 Cookie 恒 **6/7**（缺 `web_session`）、localStorage 用户态 key 恒 3 个——**凭证从未缺失或变化**，唯一变量是入口 URL |
| 决定性 A/B（同分区同 Cookie） | ✅ | 同一账号分区、同一 Cookie 集合（登录态 6/7）下：开 `/` → 时间线 `/ → /login → /new/home`（**闪登录页**）；开 `/new/home` → 时间线 `/new/home`（**不闪**）。连续 12s 采样 URL 恒为 `/new/home`，Cookie 恒 19 个 |
| 未登录回归边界 | ✅ | 干净分区（无任何 Cookie）开 `/new/home`：`did-navigate` 344ms 到 `/new/home`、2648ms 落到 `/login?source=&redirectReason=401&lastUrl=%2Fnew%2Fhome` ⇒ **正常落到登录页，无死路**；因此失效账号以 `cleanSession` 打开同一 URL 仍然可用 |
| 逃逸分析（QM-5 ②） | ✅ | 四层：**单元层**——既有用例只断言 `PLATFORM_DASHBOARD_URLS` 键存在，**从未断言其取值等于「已登录首页」**；**集成/E2E 层**——既有断言查「开卡后最终 URL 正确」，而本 Bug 的**最终态是对的**（`/new/home`），只错在中间态；**视觉/人工层**——前置修复 PR #3362 把现象从「登录页 → 整页重载 → 创作者中心」减弱为「登录页闪 1.2s → 创作者中心」，人工验收极易判为已修好；**审查层**——常量名 `DASHBOARD_URLS`（「创作者后台」）的语义暗示掩盖了小红书该值 `===` 登录 URL 的事实（同文件已有注释承认 `wechat_mp` 两值相同） |
| 修复（QM-5 ④） | ✅ | 新增单一真源 `PLATFORM_CREATOR_HOME_URLS`（**只登记「已登录首页 ≠ dashboard URL」的平台**，未登记由调用方 `||` 回退），小红书登记 `https://creator.xiaohongshu.com/new/home`；`Accounts.vue::openCreatorCenter` 改为 `PLATFORM_CREATOR_HOME_URLS[platform] \|\| PLATFORM_DASHBOARD_URLS[platform]`。**不动** `PLATFORM_DASHBOARD_URLS`（其取值另被 `http-login-checker.js` 抓 HTML 提 uid、被 `checkLoginStatus` 用 hostname 兜底判定，改动影响面远超开卡动作）；**不动**主进程 `createNewTabPage`（缺口在「调用方选了哪个 URL」）；`openLoginPage`/`cleanSession`/`needsCleanLoginSession` 语义不变 |
| 系统性漏洞与防再犯（QM-5 ③⑤） | ✅ | 定位到**两处系统性缺口**：①**CJS/ESM 手工镜像**——渲染端经 `vite.config.js` 的 alias 消费 `platform-definitions.browser.js`（79 行手抄孪生文件），新增导出必须两处同步；漏一处即「单测全绿、真实构建拿到 `undefined`」（2026-09-05 已发生过一次 Vite 编译失败，本日同源复发）。②**镜像对账锁只保护手工名单**——`RENDERER_DATA_EXPORTS` 是人工登记数组，未登记的名字得不到保护。落地四项：**(a)** 浏览器镜像补 `PLATFORM_CREATOR_HOME_URLS`；**(b)** 该名单补登记；**(c)** 新增**消费方推导锁**——扫描 `apps/desktop/src` 全部 `.js/.ts/.vue` 的 `import { … }` 命名导入并逐个断言浏览器版存在同名导出，**不再依赖人手登记**，带反失明下界（文件数 > 500、导入点 ≥ 5、导入名种类 ≥ 4）与 **fail-loud** 定位（从 `import.meta.url` 逐级上溯找 `apps/desktop/src`，找不到即抛错，禁止静默跳过）；**(d)** PRD 固化取证口径与回滚路径 |
| TDD 与相关域全量 | ✅ | 先红后绿：`platform-definitions.test.js` 契约锁首跑 **4 红**（`PLATFORM_CREATOR_HOME_URLS` undefined）；`Accounts.test.js` 行为锁首跑 **2 红**（新用例）；实现后 shared-utils 两文件 **64/64 绿**、`Accounts.test.js` **119/119 绿**（含两条既有结构锁）、消费该模块的渲染端用例 **115 passed**、`packages/shared-utils` 全量 **851 passed / 10 skipped / 41 files** |
| 变异反证（7/7 实测变红） | ✅ | M1 删小红书登记项（契约锁 + 行为锁各红）、M2 登记值改回会闪页的 `/`（两锁各红）、M3 调用点去掉 `PLATFORM_CREATOR_HOME_URLS` 优先分支（行为锁红）、M4 值改跨域 host（契约锁红）、M5 值改空串（契约锁红）、**M6 浏览器镜像删该导出**（镜像/消费方锁红——**这条正是"单测绿、线上炸"的反证**）、**M7 把消费方推导锁的正则改成 no-op**（反失明下界红——证明锁在跑而非恒绿）。脚本 `D:\Temp\xhs-repro\mutations-xhs-url.js`、`mutations-xhs-mirror.js` 均在 `finally` 整体回写原文，逐条核对「已还原」 |
| 生产构建验证（替代 QM-1 的关键项） | ✅ | `cd apps/desktop && pnpm run build:vue` **rc=0**（19.17s）；产物 `dist/assets/platform-definitions.browser-B0vhteYv.js` 精确含 `creator.xiaohongshu.com/new/home` **1 处** ⇒ 真实 alias→镜像解析路径确实带上修复（单测因 `vitest.config.js` 只登记 `@` 而解析到 CJS 版，看不到这条，故必须跑构建） |
| 跨边界门禁 | ✅ | `node scripts/check-renderer-cjs-boundary.js` → PASS（已扫 **357** 个渲染层文件、alias 登记 **9** 项、无未登记的 CJS 跨边界导入） |
| ESLint | ✅ | `cd apps/desktop && pnpm run lint`（`eslint electron/ src/ --quiet`）**rc=0**，0 error |
| 逐文件行数门禁 | ✅ | 无新增超大文件：改动最大者为 `Accounts.test.js`（2028 → 2060 行，既有文件，仍在基线内）；新增测试块均在既有文件内追加，未新建超限文件 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐值相等（无幽灵行） |
| 静态门禁（本地已跑） | ✅ | `check-no-brand-residue.js` PASS；`check-text-encoding-integrity.js` OK（无新增 U+FFFD）；locale 未改（无新增用户可见文案 ⇒ 无 zh/en 成对校验需求） |
| QM-1 打包 | N/A（触发条件未命中） | 本次未修改 `apps/desktop/electron/` 与 `packages/rpa-engine/`（QM-1 的触发路径），改动面为 `packages/shared-utils`（新增一个导出，主进程零行为变化）+ 渲染端调用点。等效验证取**生产渲染构建**（`build:vue` 产物含目标 URL，见上）+ `check-renderer-cjs-boundary` PASS + 相关域测试全绿。补充说明：本 worktree 缺 `.playwright-browsers`（打包前需下载 ~170MB Chromium），如需 `electron-builder` 级证据须先补该前置 |
| QM-4 视觉 | N/A | 虽然改动含 `.vue` 文件，但变更内容是**开卡 URL 取值**，不涉及 DOM 结构、样式、布局、文案；无新增/修改任何用户可见字符串（`accountsPage.*` 两个既有提示未动） |
| 真机端到端（已取证部分 / 残余） | ✅ + 残余登记 | **已取证**：(a) 目标 URL 在本机真实账号分区上不闪（同一分区开 `/new/home` 连续 12s 无 `/login`）；(b) 生产构建产物含该 URL；(c) 行为锁证明点击路径会取该 URL。**残余**：以合并后代码重启应用做一次「点卡片」全链路点击复验（需重启用户的运行中实例，未在未授权情况下执行）——判据为 CDP 时间线全程不匹配 `/login` 且落点 `/new/home` |
| QM-6 CCG 双模型深度审查 | 见提交钩子判定 | 变更行数（253 insertions / 2 deletions）触发 `scripts/ccg-gate.js` 的 DUAL 判定时，须跑 `sh scripts/deep-review.sh` 并把逐条裁决落盘；本轮结论与裁决文件路径见 `.quality-gates.md` 同名记录 |
| OpenSpec change | 判定不建（如实记录） | 单点根因修复 + 一张新登记表，无方案级取舍、无新增 IPC 通道/存储/接口/依赖；同域先例（2026-10-09 账号标签 Cookie 恢复、2026-10-11 小红书登录二段式补跳、2026-10-11 账号标签首屏登录态）同样只产出 PRD + 执行记录 |
| 远程同步 | PASS（PR #3454 → `dbe8e0fa2`，2026-10-13T14:14:19+08:00） | 本行、`.quality-gates.md` 同名行回填、record frontmatter 三字段删除与 `scripts/gate-record-debt-ledger.json` 登记项删除在**同一次提交**完成

### 关联但不在本次范围（如实登记）

- 该账号登录态 Cookie 为 **6/7**，缺主站 `web_session`（`xhs-mainsite-login.test.js` 已记录该缺口；二段式补跳只在登录窗流程生效，且该账号凭证快照落盘于 2026-10-07，早于补跳修复）。本次修复让 `/new/home` 不经过需要主站会话的路由守卫，**当前现象消除**；依赖主站会话的功能仍受该缺口影响，属独立任务。
- `apps/desktop/vitest.config.js` 的 `resolve.alias` 未镜像 `vite.config.js` 的 9 项渲染端 alias（只登记了 `@`），因此**渲染端单测与真实构建的模块解析不一致**。本次以「消费方推导锁」在导出层面兜住该类风险；把 alias 表也镜像到 vitest 配置属更大的系统性改动，登记为后续任务。
