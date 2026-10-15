---
record: brand-rename-tomfish
task: 把项目代码中所有中文产品名（UI 上大量显示为「社媒管家」）统一改为「汤姆鱼」，并建立品牌名机械防线
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: brand-rename-tomfish 分支作者（合并后由后续回填 PR 改写 PASS + merge SHA，并在同一次提交删除本三个 sync_* 字段）
---

# 产品中文名统一为「汤姆鱼」（brand-rename-tomfish，2026-10-15）

> 分支 `brand-rename-tomfish`（worktree `D:/Data/projects/mp-worktrees/mp-brand-rename-tomfish`，D 盘非 C 盘），起点 `8e9109a55` = 当时 origin/main。合同 = `openspec/changes/brand-rename-tomfish/specs/product-brand-name/spec.md`；判据本体 = `apps/desktop/src/i18n/brand-single-source.test.js`。用户要求：产品与项目中文名今后一律「汤姆鱼」，并持久化到内置记忆、外部记忆与 EverOS。

## 清点：这不是「改个文案」

改名前 `社媒管家` 全仓 **66 处命中 / 24 个文件**，分布在五个互不相干的层次：

| 层次 | 位置 | 漏改后果 |
|---|---|---|
| locale | `locales/tabs/zh.js` 等 8 文件 | 标签页标题、会员中心提示 |
| HTML 首帧 | `src/index.html` `<title>` | 应用窗口标题 |
| Vue 模板 | `views/FirstRun.vue` **硬编码中文** | 首次运行欢迎页 |
| 主进程常量 | `system-tray.js` / `identity-auth-window.js` / `onboarding.js` | 托盘、登录窗、引导 |
| 测试断言 | E2E / 视觉 / GUI 门禁共 14 文件 | 漏改即 CI 红 |

`Multi-Publish`（英文产品名）另有 **129 处命中**（electron 域），其中多数是工程标识。

## 分拣：四类，只有两类要改

| 类 | 处置 | 依据 |
|---|---|---|
| 用户可见产品名 | **改**（locale 8 + HTML 1 + Vue 2 + 主进程 3 + 测试 14） | 这是用户看到的产品名 |
| 工程标识 | **不改**（`productName`、`@multi-publish/*`、`--user-data-dir`、UA、`multi-publish.com`） | 改 user-data 目录名会丢用户登录态；改包名破坏锁文件与 CI；改 UA 影响平台风控 |
| 历史事实记录 | **不改**（`01-docs/**`、`openspec/records/**` 中的旧名） | 属取证现场与启动证据，改了会伪造历史 |
| 新增防线 | **加**（`brand-single-source.test.js` 4 例） | 漏改只能靠人眼 grep，无机械判据 |

## 意外收获：`--cjk` 门禁当场拦下一次「顺手改」

第一次改完跑 `check-locale-sync --cjk`：

```
FAIL：渲染端新增 1 处硬编码中文字符串（基线 1374 条，当前 1224 条）
  apps/desktop/src/views/FirstRun.vue
    apps/desktop/src/views/FirstRun.vue:11  "欢迎使用汤姆鱼"
```

原因是 `FirstRun.vue` 的欢迎语**原本就是硬编码中文**（存量债务），我把「社媒管家」换成「汤姆鱼」在 git 视角等于「新增一行中文硬编码」。项目纪律明确禁止用 `--update-baseline` 掩盖新增，所以正解不是刷基线，而是把它收进 locale：

```diff
- <h2 class="fr-step-title">欢迎使用汤姆鱼</h2>
+ <h2 class="fr-step-title">{{ $t('onboarding.welcome') }}</h2>
```

改完 `--cjk` 立即 PASS。这一条同时解决了三个问题：硬编码债务、en 用户看到中文、以及未来改名要改两个地方。

## 回归锁与变异反证

`src/i18n/brand-single-source.test.js`（4 例）：

1. locale 单一来源值正确（zh=汤姆鱼 / en=Tomfish / welcome 含品牌名）；
2. 渲染端 + 主进程源码零残留旧中文品牌名（命中即列出文件相对路径）；
3. `Multi-Publish` 仅存于白名单位置（命中即给出 `文件:行号` 与行内容）；
4. `index.html` `<title>` 与 `FirstRun.vue` 欢迎语绑定 locale（无硬编码中文）。

**变异反证实测**：把 `FirstRun.vue` 欢迎语改回旧品牌名 ⇒ 用例 ② 与 ④ **同时红（2 failed）**；恢复后 4/4 绿。这证明锁本身在跑，而不是只对业务改动敏感。

锁自身也要豁免：判据文本里必然出现被禁词（「社媒管家」与 `Multi-Publish` 都写在正则与注释里），所以锁按自身文件名跳过，否则第一轮就自触发。

## 白名单的两次修订（都是被实测逼出来的）

第一版白名单漏了两种合法残留，锁当场红：

| 命中 | 为什么合法 | 白名单怎么补 |
|---|---|---|
| `const userData = '.../Roaming/Multi-Publish'` | 变量名是 `userData` 而非 `user-data`，旧 user-data 目录名 | 补 `userData` 拼写 |
| `expect(app.userAgentFallback).not.toContain('Multi-Publish/')` | UA 夹具，断言的是「UA 里不含该串」 | 补 `userAgentFallback` |

两次都是「锁太严」而非「代码有问题」——但**修的是白名单并写明理由，不是把用例删掉**。

## QM-1：三层判据成立，但取法修了三轮

`electron-builder --win --dir` rc=0；隔离实例 12s 存活、**stderr 0 字节**（第③层成立）、**窗口标题 = 「汤姆鱼」**（`MainWindowHandle=237502546`）、asar 内 `<title>` = 「汤姆鱼」。

三轮取法修正（都是本轮实测踩出来的，前两轮 AGENTS.md 已有记录但仍复踩）：

1. **`--user-data-dir=<path>` 命令行参数被应用拒**（`bad option: --user-data-dir=...`）⇒ 改走 `ELECTRON_USER_DATA_DIR` 环境变量；
2. **直接跑 exe 静默退出 code=0、无任何输出** ⇒ 缺 `desktopDir` 应用路径参数，Electron 起来后无应用可加载。正解是用项目自己的 `apps/desktop/scripts/dev-launcher.js` 的 `buildElectronArgs` / `buildElectronEnv` 契约构造参数，而不是手搓；
3. **同名单实例锁让第二个实例静默退出**（本机跑着 `mp-app-live2` 的实例）⇒ 用全量副本 + 改名 exe（`TomfishBrandProbe.exe`）绕开，产物逐字节一致。

**已知边界（不假装已闭合）**：运行时欢迎页 DOM 未直接取到——CDP `/json/list` 受单实例锁竞争影响偶发返回 `[]`。最终以静态证据链兜底（asar `<title>` + locale 值 + 模板绑定），并如实登记；`fr-step-title` 的运行时渲染值未直接读到，其正确性由 V3/V5 与 `document.title`（一次成功抓到 = 「汤姆鱼」）间接保证。

## 顺带确认：两个预先存在的失败与本次无关

`ProfileMenu.test.js` 有 2 例失败（`memberCenter.signOut` 等断言）。用 `git stash` 把本次改动全部暂存后复跑，**仍 2 failed** ⇒ 与本次改名无关，不在本片修复范围内（如实登记，不顺手改他人账）。

## 交付清单

| 项 | 产物 |
|---|---|
| 运行时代码 | locale 8 文件（zh/en 成对）+ `index.html` + `FirstRun.vue` + `ProfileMenu.vue` + 主进程 3 文件 |
| 测试 | 14 文件品牌断言同步 + 新增 `brand-single-source.test.js`（4 例） |
| 契约 | `openspec/changes/brand-rename-tomfish/` 五件套（proposal / design / spec / tasks / 本记录） |
| 文档 | `01-docs/PRD-BRAND-RENAME-TOMFISH-2026-10-15.md` + `01-docs/PRD.md` 索引 + `01-docs/i18n-glossary.md` 术语登记 + `CHANGELOG.md` + `.quality-gates.md` |
| 门禁 | locale-sync 三件套 PASS / eslint 0 error / build:vue rc=0 / electron-builder rc=0 / QM-1 第③层 |
| 记忆 | 内置（DSH 会话档）+ 外部（`01-docs/learnings.md` + gstack `learnings.jsonl`）+ EverOS（add → flush → 落盘 grep 哨兵词） |

| 远程同步 | PENDING | 待 PR 合并后回填为 PASS + merge SHA，并在同一次提交删除 `scripts/gate-record-debt-ledger.json` 的登记项 |
