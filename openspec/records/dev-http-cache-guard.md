---
record: dev-http-cache-guard
task: dev 环境渲染层 HTTP 缓存治理——就绪/加载路径不再被 Chromium 旧副本劫持（改了代码不生效、账号页 does not provide an export）
date: 2026-10-15
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（dev-http-cache-guard）尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（三形态同改：frontmatter 三字段 + 表格行 + 删 ledger 登记项，同一次提交）
---

## 本次执行记录：dev 渲染层 HTTP 缓存治理（dev-http-cache-guard，2026-10-15）【混合 PR】

| 环节 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离声明 | ✅ | `apps/desktop/electron/**` 运行时改动（新模块 + `window.js` 接线）⇒ 完整质量节拍。**用项目规定入口** `scripts/start-mp-task.ps1 -TaskName dev-http-cache-guard` 创建隔离 worktree `mp-dev-http-cache-guard` + 裸分支 `dev-http-cache-guard`（当时共享根已 clean，故走的是 sanctioned 入口而非手工 `git worktree add`）；`pre-code-edit-guard.ps1` exit 0；依赖 53.5s 装好、`ensure-electron` v43.7.7、`verify-worktree-deps` OK（11 消费方） |
| 第一性原因 QM-5 ① | ✅ | 账号页报 `does not provide an export named 'PLATFORM_CREATOR_HOME_URLS'`。**四层取证**：源码有导出 ✓；磁盘 `.vite/deps` 产物有导出 ✓；HTTP GET 该 URL 返回 200 且 6 个导出 ✓；**渲染层 import 同一 URL 只拿到 4 个导出** ✗ ⇒ 渲染进程 HTTP 磁盘缓存里躺着旧副本，服务端一直是新的。根因：Vite 给预构建产物发 `Cache-Control: max-age=31536000, immutable`（当前 vite 为 `no-cache`+ETag，见反向证据），而 URL 的 `?v=<hash>` 指纹不含 workspace 源码内容 ⇒ 源码变了、URL 没变 ⇒ Chromium 命中旧条目且**不做校验**。磁盘层已由 #3502 修，**渲染层一直裸露** |
| 逃逸分析 QM-5 ② | ✅ | ① 全部既有测试夹具都是「注入的假 session」，**没有任何用例覆盖真实 Electron `webRequest.onHeadersReceived` 对响应头的改写**（本机 4 种起 Electron 探针的方式均失败，见已知边界）；② 无任何模块关注「dev server 响应头的缓存语义」这个维度；③ 代码审查盲区：`isDev` 早已存在，但它只决定 loadURL/loadFile，没人问「loadURL 之前渲染层的缓存状态是否干净」 |
| 系统性漏洞 QM-5 ③ | ✅ | 分类：**测试场景缺失 + 审查盲区**。根因是「dev server 的缓存语义由 Vite 单方面决定，客户端侧无治理」——同一维度也存在于 `base-python-bridge` 的 `healthCheck` 类只表达存活的模式，但本 PR 只收敛渲染层缓存这一处 |
| 修复 QM-5 ④ | ✅ | 新增 `services/dev-cache-guard.js`，**两条腿缺一不可**：①dev 启动时 `clearCache()` 杀掉**已污染**条目；②对 dev server origin 强制 `no-store` 并抹掉 `ETag`/`Last-Modified` 挡住**再次**污染。只做①挡不住再次污染；只做②清不掉已污染副本（实测即"改了还不生效"）。**CCG 两轮评审后又收敛三处**：(a) **腿①必须可 await**——`clearCache()` 是异步的，抢跑会让 immutable 旧条目**不发网络请求**、`onHeadersReceived` 不触发 ⇒ 首屏仍旧副本，故 `window.js` 用 `Promise.race([cacheCleared, 1.5s 超时])` 之后再 `loadURL`；(b) **注册 fail-open**——`onHeadersReceived` 对非法 URL pattern 会同步抛错，包 try/catch 降级为「只清缓存」而非让 dev 起不来，幂等标记移到注册成功之后；(c) **session 取窗口实际值**——`mainWindow.webContents.session` 而非硬编码 `defaultSession`（否则窗口将来改用 partition 即静默失效），并消费返回值写日志。`window.js` 在 `loadURL(dev server)` **之前**安装守卫。**刻意不做**：不动 Vite 配置（服务端侧非根因，且改它会同时影响所有客户端） |
| 防再犯 QM-5 ⑤ | ✅ | **30 条**回归测试：URL 解析型域名判据（子串判据会被 `evil.test/127.0.0.1` 穿透）、打包状态优先（源码结构锁钉住"不读任何开发环境变量"）、幂等、清缓存失败不阻断、响应头大小写不敏感、畸形入参不抛、非回环 URL 不改写、缺 `Cache-Control` 时也补、**接线锁 2 条**、**注册失败 fail-open**、**filter 缩窄到 vite 端口**、**腿①可 await**、**i1 窗口 session 与安装留痕**、**行为锁**（顺序语义）、**`DEV_URL_FILTERS` 逐条仅回环**（含「判据不是恒真」的反向验证锁）、**回环判据覆盖 `127.0.0.0/8`**；另有 `window.test.js` 的 loadURL 时序适配 |
| TDD 与相关域全量 | ⚠ 相关域绿，但**被 CI 抓到真缺口**（已修） | 先红（模块不存在 → `Cannot find module`）→ 实现 → **30/30**；`window.test.js` **58/58**；两文件合跑 **88/88**。services 目录全量因本机 node=59/electron=9 争用下 vitest 主进程 CPU 8s 仅增 0.16s（实质卡死）而中止，当时改跑精确相关域，判据写的是「我的改动只触及 `window.js` + 新模块」。**⛔ 该判据不成立，CI 直接证伪**：`electron/services/observability-messagekey.test.js` 的 T6.1 是**跨文件契约锁**——它扫描 `window.js` 等文件里的 `notify('module','event')` 字面量并断言每个都有清单登记。我在 `window.js` 新增的 `notify('dev-cache-guard','install-result')` **未登记进 `ALLOWED_KEYS`** ⇒ `AssertionError: 未在清单登记: dev-cache-guard:install-result`，`QG Desktop Shards (1/2)` 判红（3 tests failed / 8646 passed，另 2 条为既有 flaky）。**已修**：module 统一为 `'window'`（与同文件其余 13 处一致，原写法还偏离了该文件的命名约定）、event 加子域前缀 ⇒ compact `window:dev-cache-guard-install-result`，并登记进 `ALLOWED_KEYS`（清单与全仓 notify 总数同步 +1，满足 `expect(total).toBe(ALLOWED_KEYS.size)` 与规模下界 126）。修后本地**补跑该契约锁 32/32 绿**，我的两文件仍 88/88 绿。**教训（已可复述）**：与本改动相关的锁不只在「我改的文件」里，还在**「扫描我改的文件的锁」**里——后者无法靠"改动面"推理出来，只能靠跑全量或至少跑扫描域命中的锁 | **⛔ 第二条同类缺口（亦由 CI 抓到）**：`src/index.test.js` 的 CSP 锁断言 `expect(windowSource).not.toContain('onHeadersReceived')`（意图是「CSP 只由页面声明、主进程不做 session 级响应头覆盖」），而我在 `window.js` 的**解释性注释**里写了该字样 ⇒ 被文本判据命中。实现侧（`dev-cache-guard.js` 的 `onHeadersReceived`）不在该锁扫描域、也不改 CSP，故只**改注释措辞**即可。修后 `src/index.test.js` 4/4 绿。**两条合并的结论**：「只跑相关域」这一次决定连续漏掉两条跨文件扫描锁（`observability-messagekey` 的 notify 登记锁 + `src/index.test.js` 的 CSP 文本锁），是**系统性**盲区而非偶发失手。
| 变异反证 | ✅ | **第一轮 8/8 CAUGHT**：砍清缓存 / 砍 no-store / 打包应用也接管 / 域名判据退化为子串 / 守卫挪到 loadURL 之后 / 守卫挪到生产分支 / 接线锁误用 `indexOf`（**先红后修锁**）/ 域名判据反转。**第二轮 8/8 达预期**：cacheCleared 抢跑 CAUGHT ｜ 去 try/catch **CAUGHT（57 条全崩）** ｜ 幂等标记提前 CAUGHT×2 ｜ filter 不缩窄 CAUGHT ｜ defaultSession CAUGHT ｜ 守卫顺序倒置 CAUGHT ｜ **M8 loadURL 抢跑：修前 NOT-CAUGHT → 加行为锁后 CAUGHT** ｜ **M13 多行格式化：修前 STILL-LAYOUT-DEPENDENT → 改正则后 OK**。**第三轮 3/3 CAUGHT**：M14 `isLoopbackHost` 退回只认 `.1` ｜ M15 filter 混入 `https://*/*`（红在两处）｜ M16 i2 结构锁判据改恒真（红在**反向验证锁** ⇒ 证明该锁本身不是恒真）。全部还原后基线复跑 88/88 绿。**契约锁这一条无需另做变异**：它自己就是"红→修→绿"的实证（CI 先红、修复后 32/32 绿） |
| 接线锁自纠错（两次） | ✅ | 第一次：首版锁用 `source.indexOf("installDevCacheGuard")` 取**字符串首次出现**，而该串在文件里出现两次（顶部 require + 调用点）⇒ 锁恒绿、**根本没在跑**（M5 变异 rc=0 抓到），修正为「剔除 require 行 + 比调用点位置」。第二次：加固后仍以 `indexOf('…({')` 判据，M13 变异（多行格式化）再次变红 ⇒ 全部改为**正则** `installDevCacheGuard\s*\(` / `loadURL\s*\(`，并用**花括号计数**取 `if (isDev)` 整块（不再切片到首个 `} else {`）。两次都由变异抓出，而非自查发现 |
| 真实运行时取证 | ✅ | 独立起 Electron 探针 4 种方式均失败（见已知边界），改走**已部署的真实应用**：live2 检出到本分支 commit → WMI 拉起 → CDP 在渲染层实测：`/@vite/client`、第二次请求、**事故模块** `platform-definitions.ts` 三者响应头均为 `no-store, no-cache, must-revalidate, max-age=0` 且 **`etag=null`**（4/4 PASS）。**反向证据**：绕过 Electron 直连 vite，服务端对同一些 URL 返回 `no-cache` + `ETag` ⇒ 渲染层与服务端不一致，差异只能来自我的 `onHeadersReceived` |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；`git diff --check` 无空白错误 |
| 品牌残留 / docs 同步 | ✅ | 无 locale 改动；无 spec 变更；`check-no-brand-residue.js` 见 CI |
| QM-1 打包（第三轮重跑） | ✅ | 改动 electron 代码后**重跑**：`build:vue` exit 0（1m1s）→ `electron-builder --win --x64 --publish never` exit 0，NSIS + blockmap。asar **15002 条**含 `electron/services/dev-cache-guard.js`（1 命中）与 `logger`（8 命中），无 `dist-electron`/`.vite` 泄漏；解包后 `require(rpa-engine)` OK、`require(dev-cache-guard)` **6 个导出**；**打包产物内容级复核**：含 `isLoopbackHost`（+ 127/8 判据）、**无 `LOOPBACK_HOSTS` 残留** ⇒ 第三轮修复确实进了交付产物 |
| QM-1 启动测试（三层判据 + **存活断言**） | ✅ | **按 AGENTS.md 当日新增规范（fix-qm1-electron-run-as-node）重跑**。**决定性取证**：本机父环境**带着 `ELECTRON_RUN_AS_NODE=1`**（实测 `process.env`）——该变量会让**任何** Electron 可执行文件以纯 Node 模式启动并静默退出（rc=0、stdout/stderr 空、不建窗口），与「启动干净」**完全同形**。**因此上一轮本行的「8 秒内 exit 0 自行退出（既有环境特性，同机对照证实非回归）」是假绿**：根因即此污染；且原「同机对照」之所以表现一致，是因为**对照构建同样继承了该变量**——两者都是根本没启动，不构成对照。**显式传 env 剔除后重跑：8 秒窗口期内进程存活 = true、stderr 0 字节（第③层 PASS）、stdout 7510 字节 ⇒ 真 PASS**。本 worktree 残留 Multi-Publish 进程 = 0（按 exe 路径含本 worktree 精确过滤逐个终止，未按名批量杀） |
| QM-4 视觉 | N/A | 无 `.vue` / 样式 / DOM 结构变更 |
| QM-6 CCG 深度审查（**DUAL 已执行**，三轮 22 条） | ✅ 已执行；三轮裁决全部落盘 | **第三轮为 DUAL**（最终提交 611 行 > 200 阈值）：**跨家族校验通过（proposer=opencode / critic=claude）**，基线 `origin/main..57d6400d9`（594 行），critic 产出 **8 条**，5 条待裁决**已逐条填 verdict/rationale**。**i5「DUAL 未执行、`status=pending`、如实登记 ≠ 闭环」指控成立并接受**：门禁白名单 `{cleared, needs_revision, self_play_resolved}` 的共同语义是「裁决已产出并落盘」（`check-pr-exec-record.js` L352-354），而我上一轮带着 `status=pending` 的 1232 行运行时代码提交了它；更早我还曾把「本机无 `codeagent-wrapper`」写进记录（后经 `--check-deps` 证伪——它在 `/c/Users/邱领/.claude/bin/`，PowerShell 的 `where` 查不到），即以**错误的环境结论**为未执行背书。**本轮已补齐**：DUAL 实跑 + 5 条裁决落盘 + 两条 `.ccg` 记录 status 回填。**第三轮新发现且已修**：i2（`DEV_URL_FILTERS` 缺「仅回环」结构锁，断言是与常量自比较 ⇒ 混入第三方域名仍全绿）、i8（回环判据漏 `127.0.0.0/8`）。**基线落差说明**：第三轮 diff 基线落后于我的修复提交 `da5210ddb`，故 i1/i3/i4/i6/i7 是**独立第三方从同一份旧代码重复命中同样的缺陷**（i1 已连续三轮被不同评审命中）——这加强了原判而非推翻它。**产物位置**：`.adversarial/ccg-deep-57d6400d/`（该目录按 `.gitignore` **有意**不进主干：「工作产物不进主干，判定记录 `.ccg/reviews/*.json` 才是留痕」；上一轮我误将 `ccg-deep-fd8d774e/` 4 文件提交入库，本轮已 `git rm --cached` 撤回） |
| 已知边界（不假装闭合） | ✅ | ① **本机无法起独立 Electron 探针**：四种方式均令 `require('electron')` 返回 exe 路径字符串（`process.type` undefined）⇒ 运行时取证只能借"已部署应用 + CDP"，**未能做到"arbitrary 最小 main"级隔离**；② `no-store` 让 dev 每次重取资源，dev-only、对打包应用零影响；③ ~~未覆盖 clearCache 时序~~ **已修**（第二轮 i1）；④ QM-1 的两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`）为环境缺口；⑤ `clearCache()` **无「按 origin 清理」的原生 API** ⇒ 启动清的是整个 session 缓存，已被 i5 的 filter 缩窄**部分**抵消；实际**不**波及第三方平台页面（那些在 `persist:auth-*`/`persist:account-*` partition session）；⑥ **源码文本锁无法覆盖顺序语义**（M8 变异全绿），故补行为锁；行为锁弱于真机验证；⑦ **本机 `ELECTRON_RUN_AS_NODE=1` 常驻**——任何未显式传 env 的 Electron 启动验证都会得到「静默退出 + 零输出」的假绿；本轮已按新规范修复该判据，但该变量**仍在父环境**，后续会话任何手工启动验证都需同样处理；⑧ `.ccg` 记录 status 由我按白名单语义**人工登记**（引擎无回写入口，`ccg-gate.js` 只读）——该人工动作本身是新的信任点，如实标注；⑨ **i2 的结构锁只覆盖 filter 常量的 host 形态**，不能证明 Chromium 真的接受这些 pattern（真机 filter 命中需独立 Electron 探针，受边界①限制） |
| 远程同步 | PENDING | 待本 PR 合并后由后续回填 PR 同一次提交改写 PASS + merge SHA 并销账 |

### CCG 深度审查 22 条处置（三轮：7 + 7 + 8，全部逐条落地）

> **第三轮（DUAL）的完整处置表见 `.quality-gates.md` 同名段的「第三轮」小节**，此处只记要点：
> 第三轮为 **DUAL**（611 行 > 200 阈值），**跨家族校验通过（proposer=opencode / critic=claude）**，
> 基线 `origin/main..57d6400d9`（594 行），critic 产出 8 条（correctness 7 / security 7 / performance 8 / maintainability 6）。
> **两条是新发现且真实、已修**：i2（`DEV_URL_FILTERS` 缺「仅回环」结构锁——原断言是与常量自比较，混入
> `https://*/*` 时全部测试仍绿，于是 no-store 可能溢出第三方响应）、i8（回环判据只认 `127.0.0.1`，忽略
> `127.0.0.0/8`，handler 内判定漏网）。**i5「DUAL 未执行、如实登记 ≠ 闭环」成立并接受**，本轮已补齐。
> 其余 i1/i3/i4/i6/i7 因**评审基线落后于我的修复提交**（`da5210ddb`），属独立第三方从同一份旧代码
> **重复命中**同样的缺陷——其中 i1（`clearCache` 未 await 导致首屏时序）已**连续三轮**被不同评审命中，
> 这加强了原判：它是真问题，我的修复方向正确。


**第一轮**（claude critic，565 行）：

| 条目 | 裁决 | 处置 |
|------|------|------|
| i1 守卫硬编码 `defaultSession`，窗口若改 partition 即静默失效且零信号 | **upheld** | 改用 `mainWindow.webContents.session` + 消费返回值写 `install-result` 日志；两条锁钉住「不得出现 defaultSession」「必须消费 installed」 |
| i2 注册无 try/catch，`[::1]` pattern 若被拒会**同步抛错使 dev 崩** | **upheld** | 注册包 try/catch → 降级 `reason:'headers-rewrite-unavailable'`（保留清缓存腿）；幂等标记后移；IPv6 字面量不构造 filter |
| i3 接线锁依赖排版（首个 `} else {` + `indexOf('…({')`） | **upheld** | 改正则 + **花括号计数**取 dev 块 |
| i4 ledger 新增项为对象、其余为字符串 ⇒ 类型混用可能破坏消费端 | **dismissed**（采纳一致性部分） | 取证推翻前提：全量 **16 字符串 + 9 对象**（9 个历史会话同结构）⇒ 对象非新发明；唯一消费端 L107 本就兼容两形态。仅把本条改为字符串形态（去 `status`/`line` 死字段），**不**迁移既有 9 项 |
| i5 filter 覆盖回环**所有端口**，连带改写本机其他服务缓存语义 | 采纳 | 新增 `buildDevUrlFilters(devServerUrl)` 精确到 vite 端口 |
| i6 CDP 未见首帧 document 响应头；clearCache 与首载有竞态 | 采纳（升级为第二轮 i1） | 竞态被证明是**核心时序漏洞**而非边界，已修 |
| i7 模块头/测试头大段复述事故背景 | 采纳 | 模块头压到 4 行 + 指向本记录 |

**第二轮**（同一引擎重跑，产出更深的 7 条）：

| 条目 | 处置 |
|------|------|
| i1 `clearCache()` 未 await ⇒ 旧条目在清完前被命中且 immutable **不发网络请求** ⇒ leg② 不触发 ⇒ **首屏仍旧副本** | **已修**：返回可 await 的 `cacheCleared`（永不 reject）+ `window.js` `Promise.race([cacheCleared, 1.5s])` 后再 `loadURL`；3 条新锁 + 1 条行为锁 |
| i2 注册无 try/catch + 幂等标记先于注册 ⇒ 半失败后永久 `already-installed` | **已修**（与第一轮 i2 独立同期命中，佐证真实性） |
| i3 失效路径全静默（reason 被丢弃）⇒ 再犯无诊断线索 | **已修**：`install-result` 日志含 installed/reason |
| i4 `localhost` 可能优先 IPv6 / 经 LAN-IP ⇒ 不生效且无提示；`hostname` 带括号与 Set 双条目冗余 | **已修**：`normalizeHostname` 去括号单值比对；LAN-IP 不在白名单属**有意**（只治本机），"无提示"由 i3 覆盖 |
| i5 锁仍基于文本布局，**无法真实证行为顺序** | **已修**：`loadAt` 改正则；i1 的 3 条锁残留 `({` 字面量一并改（由 M13 抓出）；**新增行为锁**（M8 证明其价值） |
| i6 根因注释三处复制 | 采纳（同第一轮 i7） |
| i7 每次启动清全 session 缓存 | 采纳为**已知边界⑤** |

### 关键取证数字

- 事故链路：源码 ✓ / 磁盘产物 ✓ / HTTP 200 且 6 导出 ✓ / **渲染层 4 导出 ✗**
- 真实运行时 4/4 PASS：三个 URL 响应头 `no-store, no-cache, must-revalidate, max-age=0`，`etag=null`
- 反向证据：同 URL 直连 vite 服务端为 `no-cache` + `ETag: W/"3af-..."` ⇒ 客户端侧差异确由守卫造成
- CCG：`claude` critic 评审 565 行 × 2 轮 ⇒ 14 条；裁决 4 条（i1/i2/i3 upheld、i4 dismissed）；i1 待外部复核
- 测试：26/26（新模块）+ 58/58（window）+ 84/84（合跑）；变异反证 **16/16**（两轮）
- 打包：NSIS 256.1MB，asar 14994 行，`dev-cache-guard` 6 导出，require 链 OK，启动 stderr 0 字节
