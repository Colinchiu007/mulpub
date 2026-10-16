---
record: oss-b1-pr2
task: B1 PR-2 第一批——sidecar-host 基建（§6 全部）+ F3 camofox 四项（§7.2/7.3/7.4/7.5）
date: 2026-10-16
sync_status: PENDING
sync_reason: 本 PR（#3677）尚未合并，merge SHA 不存在
sync_backfill_owner: 下一个会话（合并后回填 PASS + merge SHA 并删除本段三个 sync_* 字段）
---

## 本次执行记录：B1 PR-2 第一批 sidecar-host + camofox 驱动 + 通道路由 + 构建期断言（oss-b1-pr2，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `D:\Data\projects\mp-worktrees\mp-oss-b1-pr2`（D 盘，非 C 盘）+ 裸分支 `oss-b1-pr2`，由 `scripts/start-mp-task.ps1 -TaskName oss-b1-pr2` 创建（依赖/electron/verify-worktree-deps 全 OK）；共享根保持 main 干净，未在共享根落盘 |
| 第一性原因（QM-5 ①） | N/A | 新功能（PR-2 基建），非 bug 修复 |
| 逃逸分析（QM-5 ②） | N/A | 新功能，无逃逸链 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 5 个测试文件 **56 用例全绿**；变异反证 **29 条全 CAUGHT**，每条按「字节快照备份 → 变异 → 跑测 → 整文件写回 → md5 校验还原」执行 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 契约锁固化在脚手架上（sidecar-host 五态、lock 校验三判据、camofox 监听回环、路由禁静默回落、构建期非回环断言）；② 三条方法论教训写入代码注释与 commit message；③ AGENTS.md 三条既有规则（QM-1 env/存活、TaskQueue、发布内容保真）已逐条自查与本批无关 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（本批 13 文件纯新增为主，`publish-capabilities.js` 为既有文件追加） |
| 接线棘轮 | ✅ | 4 个 vitest 测试文件落在 `vitest.config.js` 既有 include 域内（`electron/services/**`、`electron/services/stealth/**`、`packages/shared-utils/src/__tests__/**`），`node scripts/check-unwired-tests.js` rc=0；`apps/desktop/scripts/check-camofox-listen.test.js` 用 `node:test`（`scripts/` 不受 vitest include 接管，同 `build-paginator.test.js` 先例），由 CI 的 `node --test` 点名链执行 |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未触 `apps/desktop/electron/` 打包面（本批新增 `electron/services/` 与 `scripts/`、`packages/shared-utils/`，未改主进程入口/preload），无 UI 可见变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机 `codeagent-wrapper` 不可用（前端轴历史三次失败、后端轴在 PR-1 已跑过；本批为 PR-1 同 change 的延续，未重新发起双模型评审）。如实登记为**未执行**，不以自审冒充通过 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#3677)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin oss-b1-pr2` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 交付物与判据

| 文件 | 用例 | 变异 |
|------|------|------|
| `apps/desktop/electron/services/sidecar-host.js` + `.test.js` | 8 | 5/5 CAUGHT |
| `apps/desktop/sidecar-lock.json` + `sidecar-lock.{js,test.js}` | 13 | 6/6 CAUGHT |
| `apps/desktop/electron/services/stealth/stealth-channel-camofox.js` + `.test.js` | 17 | 8/8 CAUGHT |
| `packages/shared-utils/src/publish-capabilities.{js,browser.js}` + `__tests__/publish-channel-routing.test.js` | 8 | 5/5 CAUGHT |
| `apps/desktop/scripts/check-camofox-listen.js` + `.test.js` | 10 | 5/5 CAUGHT |
| **合计** | **56** | **29/29** |

本地门禁全 rc=0：`eslint` / `check-max-lines` / `check-unwired-tests` / `check-no-brand-residue` / `check-workflow-structure`；`packages/shared-utils` 全量 **51 files / 1042 passed / 10 skipped** 无回归。CI：**20 pass / 0 fail / 0 pending**（含此前 B1 踩过的 `债务熔断门禁`，本次直接 success）。

### 两源真实取证（§6.3，零编造）

- npm registry：`@askjo/camofox-browser@1.18.1`，tarball SRI `sha512-JLxRXts…`、shasum `8d3505035b0debcd5d306f630cf63f5208c0ef42`、unpackedSize 576493
- GitHub Releases API：`daijro/camoufox` tag `v152.0.4-beta.30`（2026-09-01 发布、非草稿非预发布），**六个平台 asset 的官方 sha256 + size** 全量落 lock
- `BUNDLED_CAMOUFOX_RELEASE=152.0.4-beta.30` 取自 wrapper `lib/camoufox-download.js` 导出常量

### 审包发现（PRD 臆测修正）

wrapper 的下载链路**不做任何 sha256 校验**：`checkAsset` 只匹配资源名前缀 `camoufox-<release>-`，且 postinstall 的 `fail()` 走 `process.exit(0)`（下载失败安装照样成功）。⇒ PRD §3.4 ③「spawn 前复检防磁盘篡改、**不防首次下载污染**」是**真实边界**而非文档臆测；`ddddocr` 因 onnx 权重 hash 未取证而显式记 `status=pending`，`resolveAsset` fail-closed 拒绝启动（留洞比留假 hash 安全）。

### 过程中被测试/变异当场抓住的 4 个真实缺陷

1. **IPv6 逃逸口**（§7.5）：方括号 `[2001:db8::1]` 含 `[ ]`，被「变量形态」判据 `/[${{}}()[\]]/` 当成表达式放行 ⇒ 非回环 IPv6 完全逃逸。修为 `isBracketV6` **前置于**变量判定（变异 M1 专锁）
2. **回环误报**（§7.5）：裸 `::1` 含多个冒号，按第一个冒号切得 `''`，不在白名单 ⇒ 回环反被判红
3. **冗余防御**（§7.2）：`close()` 的 `if(closed) return` 与 `ws=null` 冗余叠加，变异证明摘掉它**无可观测差异** ⇒ 按「不留无谓防御」删除
4. **路径层级**（§6.3）：`LOCK_PATH` 的 `'..'` 少一级 ⇒ ENOENT

### 三条方法论教训（已写入代码注释 / commit message）

1. **管道会吃 rc**：`node check.js \| Select-Object` 让 `$LASTEXITCODE` 反映管道末端 ⇒ checker rc=1 被读成「本地能过」
2. **别凭对正则的直觉下结论**：先判「字符类不含 `]`」并据此改了半天代码，诊断后发现它**包括** `]` 与 `:`
3. **CRLF 让多行变异锚点永远失配**：含 `\n` 的 `from` 串在 CRLF 文件上永不匹配 ⇒ `ANCHOR_MISSING`；锚点应尽量单行

### 遗留（不假装已闭合）

- **7.1 依赖接入方式未定**（A/B/C 见 PR 正文）：本批已把 7.2/7.4/7.5 全部做成与它解耦（判定抽纯函数、监听断言独立成脚本），故选哪个都不影响本批；7.3 的 `rpa-view-manager` 薄接线待 7.1 定后补
- **ddddocr 未取证**：requirements 钉版本 + 4 个 onnx 权重 sha256 未取，`status=pending`；取到之前该 sidecar 不得启动
- **§8 整块未动**：captcha-solver / python-backend 托管 / 相位三处同步 / 夹具图取证等（建议另开 PR，动 `pnpm-lock.yaml`）
- **QM-6 双模型评审未执行**（本机 `codeagent-wrapper` 不可用）；PR-1 已有 backend 轴记录，本批未重新发起
- **`sidecar-lock.json` 命名偏差**：tasks 6.3 写的是 `speech-sidecar-lock.json`，本批按内容命名 `sidecar-lock.json`（承载 F3+F4+预留 B2，`speech-` 前缀会误导），理由已写入 lock 的 `_doc` 段
