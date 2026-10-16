---
record: cjk-font-selfcontained
task: 中文字体自包含——得意黑入库 + 修复 extraResources 死配置 / CSS @font-face / resolveCjkFont 未接线，接入字幕/水印/封面/占位图四条链
date: 2026-10-16
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由本会话开回填 PR，把表格行的「远程同步」改成 PASS + merge SHA，并在同一次提交删除本段三个 sync_* 字段
sync_backfill_owner: cjk-font-selfcontained 会话（本节作者）
---

## 本次执行记录：中文字体自包含 + 得意黑接入（cjk-font-selfcontained，2026-10-16）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/services/*`、`apps/desktop/src/styles/*`、`apps/desktop/src/public/fonts/*`、`packages/python-backend/templates/*`）+ 文档 ⇒ `classify-docs-only` 判 false（混合 PR）；隔离 worktree `D:\Data\projects\mp-worktrees\mp-cjk-font-selfcontained`（**D 盘，非 C 盘**，符合用户要求），裸分支 `cjk-font-selfcontained`；共享根保持 main、任务期间未在共享根落盘任何运行时文件 |
| 第一性原因（QM-5 ①） | ✅ | **三处遗留同源，根因是一次杂项提交的半截删除**。`git log --diff-filter=ADR --name-only -- '*.otf' '*.ttf'` 给出：PR #1361（`83b97cee6`，2026-09-03）引入 `apps/desktop/src/public/fonts/{NotoSansCJKsc-Regular.otf(16,437,364 B), NotoColorEmoji.ttf(10,673,480 B)}`，`git show --name-status` 明示该提交同时 `M` 了 `package.json` 与 `cohere-design-system.css`；随后 `08e7d95a6`（2026-09-04「chore: normalize line endings + accumulated workspace changes」）把**两个字体文件 `D` 掉**，但**没有**回滚另外两处引用 ⇒ ① `extraResources` 的 `dist/fonts→fonts` 成为死配置（每轮打包 `file source doesn't exist`）；② CSS `@font-face` 的两个 `url()` 恒 404。第三处（`resolveCjkFont` 只认 Windows 硬编码路径 + 从不与自包含字体接线）是同一特性的**未完成态**，非本次删除引入 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单元层**：`local-cover-generator.test.js` 只断言「产出合法 PNG + 尺寸正确」——**豆腐块的 PNG 同样合法**，断言与缺陷正交；`story2video-compose-engine.test.js` 的 fontfile 断言是**条件式**（`if (resolvedFont)`），本机有雅黑 ⇒ 恒真；`asset-generator` 的 drawtext **无任何字体断言**。②**集成层**：无「剥离 CJK 字体后渲染」的对照用例；文件系统层没有「打包产物内字体是否存在」的断言（旧 `check-asar` 只查 `dist/fonts` 源存在性一类形状）。③**E2E/视觉层**：本机是中文 Windows，雅黑兜底使三处缺陷**全部不可见**；视觉回归只覆盖 renderer 页面，不覆盖 sharp 栅格化与 ffmpeg 输出。④**审查层**：QM-2 清单无「native 工具参数路径编码」与「渲染判据须落在像素级」两条维度。⑤**构建层**：electron-builder 对不存在的 `extraResources.from` 只打 warning，**不失败**，于是「字体从未进包」这件事在 CI 上零信号 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①新增 `electron/services/font-resolver.js`（单一实现）：自包含优先解析 → **ASCII 副本**（`os.tmpdir()/mp-fonts/`，模块级常量名，幂等）→ 系统字体回落；导出 `resolveContentCjkFont()`（ffmpeg 用）与 `buildFontconfigForSharp()`（sharp 用）。②新增 `electron/services/.cover-rasterize-worker.js`：承载封面栅格化**子进程**（`FONTCONFIG_FILE` 必须在进程启动时注入）。③`local-cover-generator.js`：字体栈改自包含优先，栅格化走子进程。④`story2video-compose-engine.js`：`resolveCjkFont()` 委托 font-resolver（**并修掉一处历史 bug**：原候选写作 `'C:\\\\Windows\\\\Fonts\\\\msyh.ttc'`，JS 字符串里双层反斜杠 ⇒ 实际值 `C:\\Windows\\...`，`fs.existsSync` 永远匹配不到 ⇒ 系统字体回落一直是失效的）。⑤`asset-generator.js`：占位图 drawtext **补上** fontfile 注入（此前完全不注入）。⑥`cohere-design-system.css`：`@font-face` 指向真实存在的得意黑 + 20 处 UI 字体栈改 `'PingFang SC','Microsoft YaHei','Smiley Sans',…`。⑦`package.json` 的 `extraResources` 条目**保留不改**（它的 `from: dist/fonts` 现在有真源了）。⑧3 个 Python 模板字体栈首选项从已删的 `'Noto Sans CJK SC'` 改为 `'Segoe UI','Microsoft YaHei','PingFang SC'` |
| **核心发现（本轮最贵的一条）** | ✅ 已修 + 已留锁 | **ffmpeg `drawtext` 的 `fontfile=` 对非 ASCII 路径静默失败**。四组隔离对照把变量钉死（同一字体文件、只改路径形态）：`ascii_dir_ascii_file → bytes=5495`（有字形）；`ascii_dir_cjk_file` / `cjk_dir_ascii_file` / `cjk_dir_cjk_file` **一律 `bytes=765`（豆腐块）**，且 `rc=0`、stderr 干净、不抛异常。⇒ 用户把应用装到 `D:\软件\社媒管家\`（或 Windows 用户名含中文导致 `%TEMP%` 含中文）时，自包含字体**形同虚设**。修法即 ASCII 副本层；回归锁见 `font-resolver.test.js` 契约⓪/①/③/④b + `bundled-font-packaging.test.js` 契约⑤ |
| **第二个核心发现** | ✅ 已修 + 已留锁 | **sharp 加载不了未注册到 fontconfig 的字体**，且 SVG 经 sharp 栅格化**不读 `@font-face`**。三条被否证的路（与对照逐字节相同）：`font` 传字体**文件**、`font` 传字体**目录**、CSS `@font-face`+`url()`。唯一可行 = 给渲染**子进程**注入 `FONTCONFIG_FILE`（该变量由 libfontconfig 在**进程启动时**读取，同进程改 `process.env` 无效）。两个静默失效点当场踩到并修：`<dir>` 必须是**目录**（传单个 `.ttf`/`.otf` 会被当目录处理）；路径必须转**正斜杠**（反斜杠触发 `ambiguous path` 并跳过该目录）——后者是 `bundled-font-packaging.test.js` 契约⑤ 第一版判红抓出来的**实现缺陷**（我最初只做了 ASCII 校验、忘了斜杠归一） |
| 判据必须取产物，不取「看起来对」 | ✅ | **本机装了中文系统字体会给出假绿**。第一版判据是「渲染结果里有没有字」（白色像素数 / 字节数），而本机有微软雅黑 ⇒ 即使自包含字体完全没生效，画面照样有中文 ⇒ 判据恒过。正解 = **A/B 取 sha 差异**：仅系统字体时封面 SVG 渲染 `sha=85c1cc5c8df0`；把得意黑目录加入 fontconfig 后 `sha=66a901dc912f` ⇒ 两者不同才证明字体被采用。同族形态本轮第三次命中（前两次：EverOS `accumulated` ≠ 已落盘、视觉基线本地刷新 ≠ CI 渲染） |
| **端到端实证（无 CJK 环境）** | ✅ | 把 fontconfig 隔离为仅西文（模拟英文版/精简版 Windows），跑**真实** `generateLocalCover`：`code=0 / 1080x1440 / 126,087 B / whitePx=33735`，**目视确认封面标题「社媒管家封面端到端实测」与徽章「内容封面」完整渲染**（且字形带得意黑特征性倾斜）。对照：同一份代码在旧实现下同环境产出全豆腐块（标题/徽章/关键词三条全灭，实测 5.639% 像素差异） |
| 字体资产取舍（用户问题「4 个文件都需要用吗」） | ✅ 结论：**只需 1 个** | 逐文件解析（`cmap`/`name`/`OS/2`/`post`/`head`）：`SmileySans-Oblique.otf` 1.91 MB（CFF/OTF，9440 码位 = CJK 基本区 8050 + 扩展 A 79 + CJK 标点 20 + 全角 100 + ASCII 95）**入库**；`SmileySans-Oblique.ttf` 2.51 MB（同字形、大 0.6 MB）**不入库**；两个 `.woff2`（1.30/1.15 MB）**不入库**（Web 专用容器，ffmpeg/sharp 均不认，本方案 UI 不使用得意黑故无消费方）。**四文件全是斜体（Oblique）**——`italicAngle=-8.0`、`fsSelection italic=1`、`fullname=得意黑 斜体`，即得意黑 2.0.0 只发布斜体字形，不存在正体版本。许可证 SIL OFL 1.1 全文随包（`SmileySans-OFL-LICENSE.txt`）。Windows/macOS 双平台用**同一份 OTF**，无平台分叉 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①`font-resolver.test.js`（20 例）：判据函数**正反两面直接拷打**、副本落点写死字面量、中文源路径、不抛异常（含目录源触发 `statSync` 抛错、目标被同名目录占位两种形态）、优先级可观测、系统候选 ASCII；②`bundled-font-packaging.test.js`（14 例）：字体在库/体积区间/sfnt 魔数/无 woff2、OFL 许可证内容、`extraResources` 有真源、CSS 不指向已删字体、UI 字体栈顺序、fontconfig 可用性；③`story2video-compose-engine.test.js` 新增 4 例：字幕与水印**都**注入 ASCII 安全 fontfile、二者**同源**、副本落点固定、结果缓存；④`01-docs/PRD-CJK-FONT-SELFCONTAINED-2026-10-16.md`（含数据校验 12 项 / 端到端流程 / 排障表 / 验收 8 条 / 风险与局限）；⑤`01-docs/learnings.md` 置顶 6 条；⑥`CHANGELOG.md` 顶部条目；⑦`AGENTS.md` QM-2 新增「创作内容中文字体自包含契约」；⑧三处记忆（内置会话档 / 外部 learnings + gstack jsonl / EverOS） |
| TDD 与相关域全量 | ✅ | 先写测试后写实现：`font-resolver.test.js` 11 例红 → 实现 → 绿；随后补强到 20 例。**desktop 全量：953 passed \| 1 skipped（954 文件）/ 16974 passed \| 5 skipped（16979 用例），exit code 0**（本地串行实测，`maxWorkers:1`）。eslint 对 7 个改动/新增文件 **0 error**（4 warning 中 3 条为本轮引入的未使用变量，已清理；剩 1 条 `asset-generator.js:1270 _stderrTail` 为 HEAD 既有） |
| 变异反证 | ✅ **6/7 CAUGHT**（正控 GREEN、还原逐字节 IDENTICAL） | 7 条变异：M1 去掉 ASCII 化直接返回源路径 / M2 `isAsciiSafe` 恒真 / M3 系统候选跳过 ASCII 校验 / M4 `catch` 改 `throw` / M5 副本文件名加随机数 / M6 去掉幂等短路 / M7 跳过 bundled 分支只走 system。**首轮仅 1/7 捕获**，暴露出四个真实测试盲区并逐条补强：① 判据函数自身未被拷打（只断言「返回路径是 ASCII」而用例传入的路径本就 ASCII ⇒ M2 假绿）；② `catch` 分支用「文件不存在」触发不到（那条路走 `existsSync` 提前返回 ⇒ 改用「源是目录」让 `statSync` 抛错）；③ 用**导入的常量**当期望值 = 自己对自己（⇒ 写死字面量）；④ **时间型断言不可靠**（「幂等 ⇒ 耗时 < 50ms」在 SSD 上对重复拷贝 1.9 MB 也可能通过 ⇒ 改用 mtime 不变）。**唯一未捕获的 M3 如实登记**：`SYSTEM_FONT_CANDIDATES` 是模块级常量且全 ASCII，删运行时校验在当前数据下**语义等价**，任何行为断言都区分不出——属防御性冗余，**不制造依赖实现细节的脆弱测试去凑红** |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **逐值相等**：`CHANGELOG.md` **14/0**、`01-docs/learnings.md` **13/0**（纯头部追加、零删除）。新写文档前先测三文件 EOL（`CHANGELOG.md` CRLF=21522/bareLF=0、`learnings.md` CRLF=19666/0、`AGENTS.md` CRLF=1151/0 全纯 CRLF），拼接时按本仓已登记的「恢复原文件 + 只拼头部插入（显式 CRLF）」做法执行，拼接后复测 CRLF 保真（21536/0 与 19679/0） |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → **rc=0**「检查域内测试文件 89 个 / OK: 全部测试均已接线或按欠账登记」（3 个新增/改动的测试文件均在域内且已接线，无需改 workflow） |
| 静态门禁（本地已跑） | ✅ | `pnpm exec eslint`（7 文件）**0 error**；`node scripts/verify-worktree-deps.js` OK（11 项消费方解析到本 worktree） |
| QM-1 打包 | 见下「构建验证」节 | 触发条件成立（改了 `apps/desktop/electron/**`）⇒ 跑 `pnpm run build:dir`（= `build:preload` + `build:paginator` + `vite build` + `electron-builder --dir`） |
| QM-4 视觉 | 见下「构建验证」节 | renderer 有 CSS 变更（`@font-face` + 20 处字体栈）。**预期影响面**：字体栈把 `'Noto Sans CJK SC'`（本机不存在）换成 `'PingFang SC'`（macOS 字体，本机也不存在）⇒ 本机实际解析链不变（都落到 `'Microsoft YaHei'`），像素应零漂移；由 CI 的 `QG Visual` 作最终判据 |
| QM-6 CCG 双模型外部评审 | **阻塞（如实登记，非「无工具」）** | 判定器输出 `mode=dual`（971 行 > 200 行阈值），**要求跨家族双模型审查**。**工具链齐全**：`sh scripts/deep-review.sh --check-deps` → `体检通过：后端可用`（`codeagent-wrapper` `/c/Users/邱领/.claude/bin/codeagent-wrapper.exe`、`claude` v2.1.301、`opencode` v1.18.34 三者均解析成功）。**但评审两次实跑均失败**，且我用**引擎打印的确切命令形态**复现，定位到**两层独立阻塞**：<br>① **引擎侧参数 bug（可修，但非根因）**：引擎拼出 `claude -p --dangerously-skip-permissions --setting-sources  --output-format stream-json …`，`--setting-sources` 的值为**空**，新版 claude CLI 于是把下一个 flag 当成它的取值 ⇒ `Error processing --setting-sources: Invalid setting source: --output-format. Valid options are: user, project, local`；<br>② **根因：`claude` 后端无可用订阅配额**：去掉该参数后同一调用返回 `{"is_error":true,"error":"authentication_failed","api_error_status":403}`，正文 `Failed to authenticate. API Error: 403 Subscription quota is insufficient or no subscription is configured: subscription quota insufficient, need=12686`。引擎侧只把它折叠成 `评审失败: exit 1 [claude]`，所以**光看引擎输出会误判成「后端不可用」，实际是「后端存在但配额为空」**。<br>结论：**DUAL 跨家族评审在本机无法完成**（claude 是必需 critic，无可替换配置）。按 AGENTS.md **不以自审冒充通过**，本行登记为**未覆盖**。连带后果见「遗留 7」：`check-pr-exec-record --mode=enforce` 因此不通过（`deepReview.status=pending` 不在闭环白名单 `{cleared,needs_revision,self_play_resolved}` 内），**故本 PR 不满足自动合并判据第 4 条，已停止自动合并并上报用户**。CI 侧该门禁以 `--mode=advisory` 运行（`quality-gate.yml:145`），不会因此判红 |
| **⛔ 打包后自查抓到的 CRITICAL 缺陷（本轮第二次「判据取产物」）** | ✅ 已修 + 已补有牙的锁 | **打完包后我没有停在「rc=0 + stderr 空」，而是拿真实产物复核了「解析链路是否真能用上那份字体」——抓到本 PR 最严重的缺陷**：`resolveAppRoot()` 写成 `path.dirname(process.resourcesPath)`（当成安装根），而 `extraResources` 的 `to:"fonts"` 实际落在 **`resources` 目录下** ⇒ 候选 1 `win-unpacked/fonts/...`、候选 2 `win-unpacked/src/public/fonts/...` **`exists` 全 false** ⇒ `resolveContentCjkFont()` 返回 **`source='system'`**。**即：安装后的应用永远不会使用自带得意黑**，无 CJK 字体的机器上照样豆腐块——**整个「自包含」特性在生产上完全失效，而打包 rc=0、启动 stderr 0 字节、全量测试全绿**。实测取证（真实产物 + 覆写 `process.resourcesPath`）：修复前 `{"fontFile":"C:\\Windows\\Fonts\\msyh.ttc","source":"system"}`；修复后 `{"fontFile":"...\\.tmp\\mp-fonts\\SmileySans-Oblique.otf","source":"bundled"}`，副本字节 2,003,884 == 源。**首版测试为什么没抓到**：两条断言是**条件式**的（`if (r.fontFile && r.source === 'bundled')`），`source` 不是 bundled 时**静默跳过**；且从 `apps/desktop` 作 cwd 跑 vitest 时 dev 候选 `<cwd>/src/public/fonts/` **恰好存在** ⇒ 在测试环境里恒为 bundled，缺陷**只在打包态显形**。补的锁：`font-resolver.test.js` 契约⑥ 4 例——自建真实 `resources/fonts/` 布局 + 覆写 `process.resourcesPath`，**无条件断言** `source==='bundled'` 且副本字节等于那份假字体、且副本不在 resources 下。**定向变异 M8**（改回 `dirname(resourcesPath)` 的事故写法）：正控 GREEN ⇒ 变异 **CAUGHT**，2 条指名用例变红，还原逐字节 IDENTICAL |
| QM-1 打包（修复后重跑） | ✅ | 因上条缺陷修改了 `apps/desktop/electron/services/font-resolver.js`，**QM-1 证据已过期 ⇒ 重新打包**（这是 AGENTS.md「每次修改 electron/ 下代码后必须打包」的机械要求，不是可选项）。`pnpm run build:dir` **rc=0**；日志里 `file source doesn't exist` **只剩 `.playwright-browsers` 一条，`dist/fonts` 那条已消失**（死配置修复的直接证据）。产物核对：`<产物>/resources/fonts/` 含 `SmileySans-Oblique.otf`(2,003,884 B) + `SmileySans-OFL-LICENSE.txt`(3,690 B)；三处（`src/public/fonts` → `dist/fonts` → `resources/fonts`）**SHA256 全等 `139B5DCBE70D6D52`**。启动验证：**存活单列断言通过**（12 s 窗口内 `alive=true`）、`stderr_bytes=0` ⇒ 三层判据**第③层 PASS**、零红线命中；父环境带 `ELECTRON_RUN_AS_NODE=1`，脚本按纪律**出声告警**并用 `buildChildEnv()` 剔除（否则会以纯 Node 模式静默退出、与「启动干净」同形 ⇒ 假绿）。**修复后再次复核解析**：`packagedFontCandidates()[0]` 命中真实路径、`source=bundled` |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin cjk-font-selfcontained` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

### 构建验证（QM-1）

命令：`cd apps/desktop && pnpm run build:dir`（= `build:preload` → `build:paginator` → `vite build` → `electron-builder --dir`）。

判据（三层，不只看 rc）：① 构建与打包 rc=0；② **`dist/fonts/` 与 `<产物>/resources/fonts/` 两个产物都存在且字节与源一致**（这是本 PR 的核心交付物，`extraResources` 从死配置变真配置的证据）；③ 启动验证按 AGENTS.md 三层判据 + 存活单独断言（子进程 `env` 经 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE`）。

（本节的实测数值在下方「构建验证结果」小节给出。）

### 构建验证结果（QM-1，修复后重跑）

命令：`cd apps/desktop && pnpm run build:dir`（= `build:preload` → `build:paginator` → `vite build` → `electron-builder --dir`）

| 项 | 结果 |
| --- | --- |
| 构建 + 打包 rc | **0**（`✓ built in 39.82s`；`electron-builder version=25.1.8`；`electron=43.7.7`；`appOutDir=dist-electron\win-unpacked`） |
| `file source doesn't exist` 告警 | **只剩 `.playwright-browsers` 一条**；**`dist/fonts` 那条已消失**（本 PR 修复死配置的直接证据） |
| `dist/fonts/`（Vite 拷贝产物） | `SmileySans-Oblique.otf` 2,003,884 B + `SmileySans-OFL-LICENSE.txt` 3,690 B |
| `<产物>/resources/fonts/`（extraResources 落点） | 同上两文件、字节相同 |
| 三处 SHA256 对账 | `src/public/fonts` = `dist/fonts` = `resources/fonts` = **`139B5DCBE70D6D52`**（全等） |
| exe 体积 | 239,075,328 B（≈239 MB；字体占 1.91 MB ≈ 0.8%） |
| 启动存活（单列断言） | **`alive=true` @ 12,005 ms**（窗口期内未退出） |
| stderr | **0 字节** ⇒ 三层判据第③层 **PASS**；红线命中 **0** |
| stdout | 22,458 B（正常的启动日志，无异常） |
| env 纪律 | 父环境带 `ELECTRON_RUN_AS_NODE=1` ⇒ 脚本**出声告警** + `buildChildEnv()` 剔除（回归锁 `scripts/qm1-child-env.test.js` 已存在，本轮未改） |
| 打包态字体解析复核（真实产物） | `packagedFontCandidates()[0]` = `<win-unpacked>/resources/fonts/SmileySans-Oblique.otf`（`exists=true`）；`resolveContentCjkFont()` → `source=bundled`、`fontFile` 为 ASCII 副本、副本字节 2,003,884 == 源 |

启动验证结论：**QM-1 PASS**。

### 遗留（不假装已闭合）

1. **得意黑只有斜体字形**：`italicAngle=-8.0`、`fsSelection italic=1`，字幕/封面/水印的中文一律带 `-8°` 倾斜。这是**字体设计本身**（用户点名要求使用该字体），不是 CSS 或渲染问题。若将来需要正体字幕，须另行获取字体文件并在 `font-resolver` 增加第二候选——属独立切片。
2. **macOS 未实测**：本机无 macOS 环境。方案不含平台分支（`buildFontconfigForSharp` 非 win32 时用 `/usr/share/fonts`；OTF 跨平台），但**未取得实机证据**。由 CI 的 macOS job（如有）与用户实机承担。
3. **UI 字体栈的 `'Noto Sans CJK SC'` 已彻底移除**：本轮把 20 处字体栈的该首选项换成 `'PingFang SC'`，并把 `'Smiley Sans'` 放在系统字体**之后**作兜底。含义是：装了 Noto Sans CJK SC 的用户（部分 Linux 发行版预装）**不再**优先用它，改用系统默认中文字体。这是刻意的（原首选项在 Windows/macOS 上恒落空，属无效配置项），但**等于改变了 Linux 用户的字体选择**，已在 PRD §4.6 记录。
4. **`os.tmpdir()` 含中文时诚实降级**：Windows 用户名含中文会导致 `%TEMP%` 路径含中文 ⇒ `isAsciiSafe(dest)` 判 false ⇒ `font-resolver` 返回 `''` 回落系统字体。**这是刻意的**（宁可用系统字体，也不产出豆腐块当成功），但属已知功能缺口：该类用户的字幕/封面不会用上得意黑。修法需改用其他 ASCII 落点（如应用安装目录下的 ASCII 子目录），本轮未做。
5. **首次调用会拷贝 1.9 MB**：`font-resolver` 在进程首次解析时把字体复制到 tmp（幂等，命中即跳过）。这是「绕开 ffmpeg 路径敏感性」的必要成本，实测对启动无可感影响，但**未做启动耗时基准**。
6. **`.cover-rasterize-worker.js` 以点号开头**：与仓内既有命名习惯（`electron/services/` 下无点前缀文件）不一致，选用点前缀是为了与「可被 require 的服务模块」区分。若仓内有 lint/门禁对该前缀有意见，可改名为 `cover-rasterize-worker.js`（`rasterizeCover` 里有一处 `worker` 路径引用需同步）。
7. **QM-6 未执行，且已阻断自动合并（本 PR 停在此处等用户裁决）**：工具链齐全（`--check-deps` 通过），但 `claude` 后端返回 **403 无订阅配额**（`authentication_failed`），DUAL 跨家族评审无法完成。连带两条后果：① `.ccg/reviews/b98122a3….json` 的 `deepReview.status` 停在 `pending`，不在闭环白名单 `{cleared, needs_revision, self_play_resolved}` 内 ⇒ `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` **不通过**（实测 1 条理由），而 AGENTS.md 自动合并判据第 4 条要求它为 OK ⇒ **自动合并不满足，已停止并上报**；② **刻意不把 `status` 改成闭环值** —— 那正是该门禁存在的理由（「被判需要深度审查却从未执行」的静默路径），伪造闭环等于亲手制造它要防的那类假绿。**可选出路（需用户裁决）**：为 claude 后端恢复订阅/配额后我重跑 `sh scripts/deep-review.sh`；或用户明确授权「本次以未执行 QM-6 合并」并在记录中留痕。**不做的事**：不删 `.ccg/reviews/*.json` 绕过门禁、不把 status 置为 `cleared`。
8. **引擎侧另有一个可独立修的参数 bug（不在本 PR 范围，仅登记）**：`ccg-deep-review.js` 拼出的 `claude` 命令含**空值** `--setting-sources`，新版 claude CLI（≥2.1.301）会把它后面的 `--output-format` 当成取值 ⇒ 参数解析错误。修法是「无值时不拼该参数」或显式传 `user,project,local`。**本轮不顺手改**，理由是它属「改谁来守门」（评审引擎自身），按 AGENTS.md 必须人工过目；且改完仍会被 ②（配额）挡住，两处混在一起无法分别归因。
