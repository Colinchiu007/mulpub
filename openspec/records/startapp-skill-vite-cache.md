---
record: startapp-skill-vite-cache
task: start-app skill 回灌 Vite 预构建缓存过期的实战经验（失败表加 missing-export 指纹、-InvalidateViteCache 降级为兜底、新增 Pitfalls 条目、v1.9.0）
date: 2026-10-23
branch: startapp-skill-vite-cache
---

## 本次执行记录：start-app skill 回灌 Vite 缓存经验（startapp-skill-vite-cache，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**：唯一改动面 `.agents/skills/start-app/SKILL.md`，命中 `CI_IGNORED_PATHS` 的 `.agents/**` ⇒ docs-only 通道。**但仍在独立 worktree 完成**（`<仓库父目录>/mp-worktrees/mp-startapp-skill-vite-cache` + 裸分支 `startapp-skill-vite-cache`），原因见「隔离决定」：共享根写保护 `allowedTop` 不含 `.agents`，就地编辑会被 watcher 隔离。**诚实记录**：严格入口 `start-mp-task.ps1` 因共享根存在他人 10 项未提交 WIP 而 fail-closed（`clean=false`），按项目 fallback 用 PowerShell 原生盘符路径手工 `git worktree add`（未碰共享根任何文件），创建后以 `git worktree list` + `git rev-parse --abbrev-ref HEAD` + `git rev-parse --show-toplevel` + `git status --porcelain`（0 项）四重实证非半失效；`pre-code-edit-guard.ps1` worktree 内 exit 0 |
| 第一性原因（QM-5 ①） | N/A | 本次不改代码，是把**已合并的**机制回灌到 skill。上游机制与根因见 `openspec/records/vite-deps-cache-guard.md`（PR #3502，merge `e585922c2`） |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸点在**知识与文案层**：机制落地后 skill 三处文案仍是旧世界——① 失败表只有「504 空白页 → `-InvalidateViteCache`」，而本次真实故障的首帧症状是 `does not provide an export named 'X'`，按表查不到该行；② `-InvalidateViteCache` 仍被写成首选修复，实际 v1.9.0 起已由 `dev.js` 自动预检覆盖；③ Pitfalls 无该故障的机制解释，下一个人仍会去查代码而不是查缓存。**没有任何门禁读 skill 文案与实现是否一致**——这类漂移只能靠人工回灌，本次即该动作 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 5 处改动（见「改动清单」）：`version: 1.8.0` → `1.9.0`；`-InvalidateViteCache` 降级为兜底；失败表新增 missing-export 行；504 行改为先看 `[vite-deps]` 日志；Pitfalls 新增「Vite 预构建缓存过期」条目（机制三事实 + 判据 + 三态留痕 + 排障 + 覆盖边界）。**每条断言都对齐实现原文**（下文「取证坐标」逐条给出文件与行号） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 失败表新增的指纹行让下次故障**按现象即可命中处置**，不必重新排查；② Pitfalls 条目写清「重启 dev server 也不会重建」这一反直觉事实（这是本次真正耗时的地方）；③ 三态日志字符串 `state=fresh/stale/clear-FAILED` 原样写进 skill，使排障时能对着日志判断是否走了自动预检；④ **覆盖边界如实记账**：WSL 路径不经 `dev.js`，写明须手工删缓存（缺陷见「遗留 L1」） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐字相等（`5 3` / `5 3`）。该文件 `git ls-files --eol` = `i/lf w/crlf attr/text=auto`，改动为 5 处局部替换+新增，**未整文件回写**（若整写，diff 会膨胀到 500 行） |
| 编码完整性 | ✅ | `bom=false`；`U+FFFD` 计数 0；关键中文串逐个 `includes` 命中（预构建缓存过期 / 兜底开关 / 严格大于 / version 1.9.0）；表格 2 列行 `split('\|').length === 4`、3 列行 `=== 5`，**表结构未被长文案破坏** |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS（本次新增文案无竞品品牌名） |
| docs-only 判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（提交后取证；预提交时 `HEAD==base` 会得 `files=0`，属取证顺序而非判定失灵） |
| 接线棘轮 | N/A | 未新增 `*.test.js`（改的是文档） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`；无 UI 变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 纯文档变更不强制（AGENTS.md QM-6 触发条件）。**不以自审冒充通过**；替代验证是「每条断言都有可复取的实现坐标」（见下） |
| 远程同步 | 由门禁推导 | 状态列不手写状态词（2026-10-17 起现行形态）；收口由 `scripts/lib/merge-ledger.js` 按主干 squash 尾注 `(#NNNN)` 推导。合并后 main push 回读证据写在 PR 评论里，不写回本文件 |

## 改动清单（`.agents/skills/start-app/SKILL.md`）

1. front matter `version: 1.8.0` → `1.9.0`（行为有变化，按语义化版本升 minor）。
2. 「检查环境齐备 → 3. 用已登录 profile 启动」的可选参数行：`-InvalidateViteCache` 从「陈旧 Vite 缓存导致 504 空白页时用」改为**兜底开关**，说明 v1.9.0 起 `dev.js` 已自动预检、正常不再需要手工指定，并点出两者**动作不同**（手工开关只把 `.vite\deps` 改名留档、保留 `_metadata.json`；`dev.js` 是整目录删除）。
3. 失败表新增一行：`does not provide an export named 'X'` → 根因（指纹不含 workspace 源码 / 重启不重建）+ 自动预检 + 日志指纹 + 「日志里没有 `[vite-deps]` 行 ⇒ 没走 `dev.js`」的反向判据。
4. 失败表既有「504 空白页」行改为**先看 `[vite-deps]` 日志**，再降级到 `-InvalidateViteCache`。
5. Pitfalls 新增「Vite 预构建缓存过期」条目：三个叠加事实、mtime 判据（严格大于、相等算 fresh、无 source 证据按 fresh）、三态留痕、`MP_VITE_DEPS_CACHE_CHECK=0` 的排障定位、为什么否决 `optimizeDeps.force: true`、**WSL 覆盖边界**。

## 取证坐标（每条断言都能当场重取）

- 自动预检接线：`apps/desktop/scripts/dev.js:8`（`require('./vite-dep-cache')`）、`:44-52`（spawn vite 前调用）、`:49-50`（`MP_VITE_DEPS_CACHE_CHECK=0` 分支与其日志原文）。
- 判据实现：`apps/desktop/scripts/vite-dep-cache.js` 头注（三事实与「为什么用 mtime 而非 commit 时间」）、`:111`（`checkViteDepCacheStaleness`）、`:155-166`（三态日志原文与删除动作）、`:151`（检查自身失败时的降级文案）。
- 手工开关的弱化形态：`scripts/start-desktop.ps1:306-312`（`Rename-Item` 只动 `deps`，保留 `_metadata.json`）。
- 覆盖范围：`scripts/start-desktop.ps1` 与快链路 `scripts/mp-applive-launcher.ps1:303` 都 spawn `node scripts/dev.js` ⇒ 受保护；`scripts/start-desktop-wsl.sh:130` **直接** `node $REPO_ROOT/node_modules/vite/bin/vite.js` ⇒ 不受保护（已在 skill 里如实标注）。

## 隔离决定（为什么 docs-only 仍有 worktree）

两个名单对 `.agents/**` 的处理**不一致**：

- `scripts/classify-docs-only.js` 的 `CI_IGNORED_PATHS` **含** `.agents/**` ⇒ 本变更判定为 docs-only 成立；
- `scripts/guard-shared-root-writes.ps1` 的 `allowedTop` **不含** `.agents` ⇒ 在共享根就地编辑会被常驻 watcher 判定为违规写、把文件移入 `%LOCALAPPDATA%\Mulpub\session-isolation\quarantine\`。

按「隔离守则优先」的保守解读：**能做隔离就隔离**，不去试探 watcher 的判据边界（试探的代价是一次静默隔离，且会产生一条 `violations.jsonl` 噪声）。因此本变更走了独立 worktree，与 docs-only 快速通道的「就地编辑」建议**不冲突但更保守**。

## 遗留（不假装已闭合）

- **L1 · WSL 启动路径无自动预检**：`scripts/start-desktop-wsl.sh:130` 直起 vite，绕过 `dev.js`。本次**只在 skill 里如实标注手工删除动作，未改脚本**——原因：① 属运行面改动，一旦改它本 PR 不再是 docs-only，需完整质量节拍；② 本机无法在 WSL 侧验证该改动（改了也拿不到证据，等于给下一个会话留一条未验证的运行时代码）。**建议**：后续单独 PR 把 `ensureFreshViteDepCache` 接进 WSL 脚本（或统一改走 `dev.js`），并在 WSL 内实跑取证。
- **L2 · `.agents/**` 两名单口径不一致**：见「隔离决定」。这属 **「谁来守门」类变更**（放宽写保护 `allowedTop` 等于扩大静默写入面），按 AGENTS.md「禁止自动合并」清单须人工过目，**不在本 PR 顺手修**，只在此登记并回报用户。
- **L3 · skill 三副本同步不在仓库内**：`.agents/skills/start-app/SKILL.md`（git 跟踪的单一事实源）、`<用户目录>/.claude/skills/start-app/SKILL.md`、`<网盘 skill-repo>/start-app/SKILL.md` 三份须在本 PR 合并后手工同步并核对 MD5 三方一致。**仓库内的门禁不覆盖后两份**——它们不经 git，漂移了没有任何东西会红。
- **L4 · 本次未做「按 skill 走一遍」的实跑验证**：文案对齐的是实现源码，不是重放一次故障。可复现路径：在装了旧缓存的 worktree 里删掉 `[vite-deps]` 相关日志后重启，应看到 `state=stale … action=cleared` 且页面恢复。留给下一次真实的缓存过期事件验证。
