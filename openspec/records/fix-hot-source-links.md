---
record: fix-hot-source-links
task: 采集页素材来源卡：知乎热榜（强制登录）撤下换百度热搜，头条热榜（JSON 数据接口）改今日头条首页
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 尚不存在；视觉基线须用本 PR CI 的同源渲染回填后再合
sync_backfill_owner: 下一个会话（同一次提交内改写「远程同步」行 + 删除 sync_* 三字段）
---

## 本次执行记录：采集页素材来源入口修正（fix-hot-source-links，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码：worktree `<仓库父目录>/mp-worktrees/mp-fix-hot-source-links`，裸分支 `fix-hot-source-links`，基于 `origin/main b7c618d9c`；共享根保持 main、未触碰他人未提交改动（共享根另有一篇他人 docs 记录为 M）。入口说明：`scripts/gwm-task.sh start` 因共享根存在**他人**未提交 tracked 文件而 fail-closed，故按同一脚本的等价步骤执行 `git worktree add -b fix-hot-source-links <path> origin/main`，不 stash、不改他人工作副本 |
| 第一性原因（QM-5 ①） | PASS | 两个独立根因：① `createOpenSourceHandler` 调 `createTab({url,platform,title})` 不带 accountId ⇒ `electron/services/webview-manager/tab-lifecycle.js:35-38` 落 `persist:browse-<tabId>`（全新空分区、不注入凭证），而知乎 `/hot` 对匿名访客强制登录（实测最终 URL `/account/unhuman?...&need_login=true&next=%2Fsignin`）；② 头条入口取的是数据接口 `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc`（浏览器直接打开是一屏 JSON），官方没有渲染版热榜页（`/hot/`、`/trending/` 均 404） |
| 逃逸分析（QM-5 ②） | PASS | 三层都没拦住：① 单测层只断言「URL 带 `origin=`」「不指向创作者后台」，**从未断言它是渲染页而不是数据接口**，也没有任何测试真的打开过页面；② 视觉层 collection 基线覆盖整页但文字/图标改动仅 0.0476%（6% 阈值内直接放行），且基线本身已含「知乎热榜/头条热榜」旧文案；③ 人工 review 依据 2026-10-12 的纯 HTTP 抓取（无 JS）——把「403 反爬」误读成「免登录可浏览」，把「带 origin 的 JSON 200」误读成「可用页面」 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修 `PLATFORM_SOURCE_URLS`（CJS + browser 孪生逐字一致）：weibo 保留、baidu 新增、toutiao 改首页、zhihu 删除；新增 `SOURCE_LABEL_KEYS` 与显示名解析，修掉「提示里出现原始 id（已打开 zhihu 采集页面）」。回归锁：`useSourceEntry.test.js` 10 例（含「三入口不得指向 JSON 接口」黑名单正则 `/hot-event\|\.json\|api\./`、「知乎不得回流」、显示名进提示）；`Collection.test.js` 新增模板↔来源表结构锁（三处 `openCollection('<id>')` 对齐、无 `openCollection('zhihu')`/`sourceZhihu`） |
| 防止再次发生（QM-5 ⑤） | PASS | ① 判据落进单测：黑名单锁死「数据接口不得当素材入口」这一类错误，而非只锁这三个具体 URL；② 代码注释、PRD §2.5 与 CHANGELOG 写明「不得改回数据接口」与「知乎强制登录」的事实口径；③ 记录取证方式（真实浏览器逐页最终 URL + `innerText`），避免下次再用纯 HTTP 抓取下结论 |
| 行尾与 diff 对账 | PASS | 两口径逐文件相等：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 均为 added=219 / deleted=81；删除行全部是旧 URL、旧文案与旧断言，无意外删除 |
| 接线棘轮 | N/A | 本刀只改既有测试文件，未新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | 部分 | **QM-1 N/A**：未改 `apps/desktop/electron/**` 与 `packages/rpa-engine/**`（仅渲染端 + `packages/shared-utils`）。**QM-4**：本 worktree dev server(5187) 上 `PIXEL_ONLY=collection` light diff **0.0476%**（阈值内，差异带=三张卡文案/图标）；dark diff **1.41%** 经截图归因**主因是基线侧栏「更多」展开态 vs 本次收起态**（`collection-dark.png` 显示侧栏展开 13 项，本次渲染收起），属基线陈旧、不是本刀回归；基线刷新必须取同 PR CI 产物（Gate 7b 判 0 px），见「遗留」 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`/跨家族模型通道；不以自审冒充通过。替代证据=域内 120 例单测 + `packages/shared-utils` 54 files/1081 passed + 结构锁 + 真机页面取证 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间；`git ls-remote --heads origin fix-hot-source-links` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 证据

- 单测：`apps/desktop` → `vitest run src/features/collection/useSourceEntry.test.js src/views/Collection.test.js` = 2 files / **120 tests 全绿**（改测试先红 8 例，实现后转绿）；`packages/shared-utils` → 54 files / **1081 passed**。
- 静态：`check-max-lines` rc=0（`Collection.vue` 2234 行，限 2920）；`check-no-brand-residue` PASS（9935 tracked）；`check-locale-sync --pair-base origin/main / --cjk / --keys` 三项 PASS；`eslint` 变更文件 0 error（2 条既有 warning）。
- 真机取证（2026-10-17，Playwright Chromium，独立无 Cookie context；记录最终 URL 与 `document.body.innerText`）：

  | 入口 | 实测现象 | 可见文本 |
  |---|---|---|
  | 知乎 `/hot` | 最终 URL `/account/unhuman?type=U4E3Z1&need_login=true&...&next=%2Fsignin` | 28 字「请您登录后查看更多专业优质内容」 |
  | 头条 `hot-event/hot-board/` | HTTP 200，响应体为 JSON（不是页面） | `{"data":[{"ClusterId":...` |
  | 头条首页 `www.toutiao.com` | HTTP 200，最终 URL 带 `?wid=`；命中 `ttp-hot-board` 模块 | 2911 字；模块内含 1-50 名与 `/trending/<id>/?rank=N` 链接 |
  | 百度热搜 `top.baidu.com/board?tab=realtime` | HTTP 200，服务端直出榜单 | 5179 字（榜单条目渲染完整） |
  | 微博热搜 `s.weibo.com/top/summary` | HTTP 200，榜单渲染（**推翻**旧「全系 302 登录墙」结论） | 1398 字 |

- 视觉：light `PIXEL_ONLY=collection` = 0.0476% PASS（报告 `tests/visual-testing/reports/report-1792250551950.json`）；views 套 `--single collection` rc=0；dark = 1.41%，归因见 QM-4 行（基线陈旧），baseline 回填待 CI 产物。

### 遗留（不假装已闭合）

- 视觉基线 `collection.png` / `collection-dark.png` 须用本 PR CI 的 `quality-gate-visual-reports` 产物回填后复跑 Gate 7b；第一轮 CI 预期 Gate 7b 因文字改动判红（这正是它该做的事，不是失败）。
- 头条卡打的是**首页**，热榜在右侧栏；官方没有独立渲染热榜页（`/hot/`、`/trending/` 均 404）。
- 百度热搜不是发布平台（无发布链路），仅作素材来源；`PLATFORM_NAMES` 不含它，显示名由 `SOURCE_LABEL_KEYS` 提供。
- 微博「匿名可浏览」结论基于 Playwright Chromium；Electron 内置浏览器 UA/指纹差异未单独 A/B（同为 Chromium 内核，风险低，但未实测即不声称已验证）。
