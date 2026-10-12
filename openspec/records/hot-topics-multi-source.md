---
record: hot-topics-multi-source
task: 热门选题扩展小红书/凤凰网/抖音多端点数据源、新增 AI 一级分类、修复「科技类混入不沾边内容」的分类根因
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 合并后由后续回填 PR 回填 PASS + merge SHA，并在同一次提交删除本记录文件的三 sync_ 字段与 gate-record-debt-ledger.json 的登记项
sync_backfill_owner: hot-topics-multi-source
---

## 本次执行记录：热门选题多源扩展 + AI 分类 + 归类准确性（hot-topics-multi-source，2026-10-12）

> 支撑分支 `hot-topics-multi-source`（裸分支名）｜worktree `D:/Data/projects/mp-worktrees/mp-hot-topics-multi-source`（D 盘托管根，非 C 盘）｜基线 `origin/main` = `6fedf8627`
> 入口：`bash scripts/session-init.sh hot-topics-multi-source`（`gwm-task.sh start`），依赖 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 三步均 OK（11 个 workspace 链接解析到本 worktree）
> 判定 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=false**（含 `apps/desktop/` 与 `ops-center/` 运行时代码，走完整质量节拍，**不得**走 docs-only 快速通道）
> 用户原话三条诉求：① 扩展更多数据源，调研抖音/小红书/今日头条/头条号/凤凰网在开源项目里是否已有热榜或热门内容获取实现，能复用就复用；② 类别中再增加一个 AI 分类；③ 分析归类标准与逻辑，优化「科技类下有不沾边内容」的准确性

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 会话隔离 | PASS | worktree `mp-hot-topics-multi-source` 建在 D 盘托管根，分支 `hot-topics-multi-source`，基线 `origin/main = 6fedf8627`；共享根 `D:/Data/projects/mulpub` 保持 main 且 clean（`session-init.sh` 审计通过并 ff-only 到 `6fedf8627`）。未在共享根落盘 |
| TDD | PASS | 三个新增测试文件先于实现落笔（`classifier.test.js` 32 例 / `hot-topics-new-sources.test.js` 18 例 / `hot-topics-boost-classify.test.js` 6 例）。红灯实证：先写断言跑出 3 红（渲染层 key 缺 `ai`、`AI 应用落地加速` 落 general、`classifyTopicMulti` 次标签无 `ai`），实现后转绿 |
| 定向测试 | PASS | `npx vitest run`（8 个相关测试文件：`hot-topics/classifier.test.js`、`hot-topics/scorer.test.js`、`hot-topics-service.test.js`、`hot-topics-new-sources.test.js`、`hot-topics-boost-classify.test.js`、`content-categories.test.js`（主进程）、`src/features/content/content-categories.test.js`（渲染层）、`src/views/HotTopics.test.js`）→ **8 files / 197 tests passed** |
| 全量回归 | PASS | `npx vitest run electron/services/ src/views/HotTopics.test.js src/features/content/content-categories.test.js` → **379 passed \| 1 skipped（380 files）/ 7276 passed \| 1 skipped（7277 tests）**，exit 0 |
| 运营端 pytest | PASS | `cd ops-center/backend && python -m pytest tests/test_content_categories_api.py -q` → **7 passed**（含内置目录由 10 类改 11 类后的顺序断言） |
| 静态门禁 | PASS | 本机实跑：`node scripts/check-no-brand-residue.js` → PASS（扫描 8099 个 tracked 文件）；`node .github/scripts/check-locale-sync.js --pair-base origin/main` → PASS、`--keys` → PASS（1875 key）、`--cjk` → PASS（基线 1489 / 当前 1224，无新增硬编码）；`npx eslint <18 个改动文件> --quiet` → exit 0 |
| 行尾对账 | PASS | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐行一致（EOL-CONSISTENT）。`CHANGELOG.md`（CRLF）与 `01-docs/learnings.md`（CRLF）的插入走「显式 CRLF + 只拼头部」而非全文规范化，插入后整文件 `CRLF=19855 bareLF=0` / `CRLF=17480 bareLF=0`（零裸 LF，无伪全量 diff） |
| QM-1 打包 | PASS | `node scripts/verify-worktree-deps.js` OK → `pnpm run build:vue` rc=0（vite built in 37.77s）→ `pnpm exec electron-builder --win --dir --publish never` rc=0（electron-builder 25.1.8 / electron 43.7.7，`dist-electron\win-unpacked`，asar **151022004 B**）。builder 两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`）为**worktree 既有状态、与本次改动无关** |
| QM-1 asar 清单 | PASS | `pnpm exec asar list` 命中 `\electron\services\hot-topics-service.js`、`\electron\services\hot-topics\channels.js`、`\electron\services\hot-topics\classifier.js`、`\electron\services\hot-topics\scorer.js`、`\electron\services\content-categories.js`、`\dist\assets\hot-topics-*.js` |
| QM-1 require 链 | PASS | `asar extract` 后从**产物** require 三个改动模块：`classifier` → `keys= 11 contains ai= true`；`channels` → `parsers= 13 has xiaohongshu= true has ifeng= true`；`hot-topics-service` → `channels= 10 boostKeys= finance,tech,emotion,health,ai,education,international`。`@multi-publish/shared-utils/src/safe-http-url.js` require 成功 |
| QM-1 启动冒烟 | PASS（**取证通道与既往记录不同，见下**） | 打包 exe 在 **interactive 用户会话**内经 `explorer.exe` 拉起：`Multi-Publish` 进程 **4 个**（PID 14884/17200/25080/29388）、存活 **12s** 被本会话逐个终止、终止后计数回到基线 **0**（无残留）。`%APPDATA%\@multi-publish\desktop\logs\app-2026-10-12.log` 写入 `[NOTIFY] window main-window-shown {}`。**禁用标记逐项 0 命中**：`Failed to load platform config`=0 / `PluginLoader`=0 / `mkdir failed`=0 / `ENOTDIR`=0 / `app.asar`=0 / `ERR_FILE_NOT_FOUND`=0 |
| QM-1 取证边界（**新发现，如实登记**） | 未闭合 | ① **harness 直接 spawn 的进程无法跑起本应用**：`Start-Process`／`&` 启动时进程**立即以 rc=0 退出**，且默认与隔离 userData **零变更**（Chromium 未初始化、无日志、无 Singleton 文件）——原因是该上下文非 interactive 用户会话，GUI 建窗失败即静默退出；正解是经 `explorer.exe` 拉起（本轮已用）。② **Windows GUI 子系统下 stdout/stderr 恒为空**：显式带 `ELECTRON_ENABLE_LOGGING=1`、加 `--user-data-dir=` 也拿不到任何输出（后者还被 exe 以 `bad option` 拒绝并 rc=9）。⇒ AGENTS 里「捕获 stderr 判三类禁用标记」这条判据在本机**结构性不可区分**（既往记录里的「stderr 三类命中 0」同样无法证明应用跑起来过）。**本记录因此改以「日志文件 + 进程存活 + 进程计数回基线」为判据**，并把这一口径差异显式登记，不冒充沿用了旧判据 |
| QM-6 评审 | 未执行（如实登记） | 本轮未运行跨模型对抗评审。代码改动集中在分类词表/解析器/渠道配置，逻辑以断言锁定（197 例定向 + 7276 例全量）；**不声称「双模型通过」**。纳入 PR 正文的未完成项 |
| 记忆沉淀 | PASS | ① **外部记忆（仓库）**：`01-docs/learnings.md` 置顶新增 4 个章节（CRLF 保真、零裸 LF）；② **外部记忆（本机 gstack）**：`~/.gstack/projects/Colinchiu007-Multi-Publish/learnings.jsonl` **149 → 152 行**，逐行 `JSON.parse` 校验 **0 坏行**；③ **EverOS**：session `mp-hot-topics-multi-source-20261012` 走 `POST /api/v1/memory/add`（`message_count:2, status:accumulated`）→ `POST /api/v1/memory/flush` 回 **`status:"extracted"`**，落盘产物 `~/.everos/default_app/default_project/users/agent/episodes/episode-2026-10-12.md`（2943 B）与 `.../.atomic_facts/atomic_fact-2026-10-12.md`（14431 B）中 grep 哨兵词 **6/7 命中**（`hot-topics-multi-source` / `DOMAIN_LEVEL_RAW` / `aweme-lq.snssdk.com` / `xiaohongshu` / `ifeng` / `MIN_SCORE`）⇒ **判据取产物，不取接口应答**；④ **内置记忆**：DSH 会话档由 harness 自动落盘（无对外写 API），未手工伪造文件 |
| 删除守卫限制（如实登记） | 环境限制 | 两处临时入口文件（`.tmp-changelog-entry.md`、`.tmp-learnings-entry.md`）先跑 `node scripts/safe-delete.js <file> --dry-run` → 判据全过（`未跟踪、非目录、在工作区内`），**实跑失败**：`mavis-trash` 在本机不存在。处置：核验 `Resolve-Path` 绝对路径逐字相符 + 断言 `Test-Path -PathType Leaf` + 确认 `git status` 为 `??`，再做**单文件** `Remove-Item -LiteralPath`，未使用任何递归删除、未绕过守卫判据 |
| 远程同步 | PENDING | 待 PR 合并后回填 PASS + merge SHA，并在**同一次提交**删除 `scripts/gate-record-debt-ledger.json` 的登记项 |

### 本轮根因与修法（QM-5 口径）

**症状**：用户报「科技类别下，有时候存在和科技不沾边的内容」。

**第一性根因（三条机制级，均与关键词质量无关）**：

1. **原生分类整批错配**：`bilibili['知识'] = 'tech'`、`weibo/bilibili['科学科普'] = 'tech'`、
   `toutiao/weibo['汽车'] = 'tech'` —— 把**整个栏目的泛称**映射成一个具体分类。
2. **补拉渠道硬挂分类**：`_collectBoostChannel` 把条目 `category` **无条件**写成 `source.boostCategory`，
   分类器完全不参与。
3. **原生映射无条件压过关键词**：`rawCategory='科技'` + 《今晚吃什么》也判 `tech`。

**修法（三层缺一不可）**：原生分类分**三档**（可信原生 / 宽泛桶 `RAW_CATEGORY_WEAK_MAP` /
域级泛称 `DOMAIN_LEVEL_RAW`），补拉条目「先过分类器、只有 general 才兜底 `boostCategory`」，
关键词分 strong/weak + `MIN_SCORE=3`，拉丁词走词边界 + 全角归一，`general` 收窄为「无信号」专属。

**逃逸分析**：v2 的既有测试只锁了「渠道原生分类 → 分类」这条**正向映射**（`classifyTopic('科技','toutiao','任意文本') === 'tech'`），
**没有任何一条断言「原生分类与实际文本相矛盾时该听谁的」** —— 于是「整批映射错配」这类缺陷 100% 逃逸。
本轮的回归保护落在 `classifier.test.js` 的「根因回归锁」describe（6 条机制级反例），
且**保留了 v2 契约测试并写明变更理由**（`科技` 域级泛称、`汽车` 归综合、`科学科普` 归综合、AI 独立成类），
不删旧断言来制造假绿。

**新发现（两条可复用）**：① Windows GUI 子系统下 stdout/stderr 恒为空 ⇒「捕获 stderr」不是可用判据；
② harness 直接 spawn 的 GUI 进程会立即 rc=0 静默退出 ⇒ 冒烟必须经 interactive 会话拉起。
