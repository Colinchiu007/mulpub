---
record: wechat-mp-api-track
task: 微信公众号 API 发布轨（会话/图片上传/建草稿/回读）+ 消灭「假成功」+ DOM 轨群发保护预检
date: 2026-10-12
---

## 本次执行记录：微信公众号 API 发布轨 + 消灭假成功 + DOM 轨群发保护预检（wechat-mp-api-track，2026-10-12）【混合 PR】

- **变更类型**：运行时代码（`packages/api-publish-engine/**` + `apps/desktop/electron/**`）⇒ 隔离 worktree
  `D:\Data\projects\mp-worktrees\mp-wechat-mp-api-track`（标准入口 `scripts/start-mp-task.ps1 -TaskName wechat-mp-api-track` 创建，非 C 盘），
  裸分支 `wechat-mp-api-track`（基线 `origin/main`）。
- **上游依据**：参考产品（4.0）逆向工程产物 `packages/main/dist/index.cjs（本机逆向工程产物，不入库）`
  —— `publishGongZhongHaoArticle` / `buildArticles` / `createWeixinArticleMsgResponse` / `uploadWeixinImageResponse` /
  `getImageInfoFromUrlResponse` / `getUserInfoAsync` / `checkQrcodeOpen` 七段实测取证（端点、参数、封面槽位、失败码）。

### 根因（第一性）

`adapters/wechat_mp.js` 的 `publish()` 三缺陷叠加：① 忽略入参 `postData`；② 打的是**已发布内容列表**
端点 `appmsgpublish?sub=list`（与建草稿无关）；③ 只要 `base_resp.ret === 0` 就返回 `success: true`
⇒ 调用方 `publishViaApi()` 正常 resolve ⇒ 上层拿到**假成功**。
可达性实证：桌面路径不可达（`platforms.yaml` 的 `wechat_mp` = `has_api:false` + `publishMode:dom-only`），
但 `publish-api-server.js:1112` 用 `supportsApi()`（只看 REGISTRY 登记）⇒ HTTP 发布 API 可达。

### 门禁表

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| 变更类型与隔离声明 | PASS | 运行时代码已落隔离 worktree（路径见上），裸分支；共享根保持 `main` |
| TDD（先测试后实现） | PASS | 4 个 API 轨测试文件先落（57 例，注入假 HTTP 零真实网络）⇒ 其中 1 例按真实 loginpage 形态纠正正则后全绿 |
| 相关域测试 | PASS | 新增 57 + dom-guard 19 + rpa-view-platforms 83（+3）全绿 |
| 包全量回归 | PASS | `packages/api-publish-engine` `node scripts/run-tests.js` → **39 文件 / 327 例全绿** |
| 变异反证（QM-5 ④） | PASS | **6/6 全部变红**（M1 摘「无 appMsgId 即失败」/ M2 端点换回列表接口 / M3 封面只写 `cdn_url0` / M4 会话不 fail-closed / M5 预检不判 `massSend` / M6 回读去掉正文判据）；脚本逐条改坏→跑测试→`git checkout` 还原，运行后工作区干净 |
| 行数门禁 | PASS | `check-max-lines.js` 全绿；新文件 25–217 行（均 <500）；`rpa-view-platforms.js` **1475**（点名还账 targets=1476，未超） |
| ESLint（Gate 11） | PASS | `pnpm run lint` 0 error（首轮 1 处 `no-useless-assignment` 已修） |
| CCG verify-security | PASS（附豁免说明） | 本 PR **新增 5 个源文件扫描 高危 0**。剩余 1 条高危位于 `rpa-view-platforms.js:1010`（抖音简介 `innerHTML` 注入，语句内已净化 script/iframe/object/embed 与 `on*` 属性）——用 `git show origin/main:<file>` 的版本实跑复现同样 2 条高危（XSS + 敏感信息）⇒ **既有问题、非本 PR 引入**；本次提交按门禁自述的显式豁免 `SKIP_CCG_GATE=1` 放行。自造的 5 处 query 拼接已一律改 `URLSearchParams`（`token` 是外部输入，编码交给标准实现），顺带消掉 3 处 CCG `HARDCODED_SECRET` 朴素误报 |
| 行尾 / 编码对账 | PASS | `check-text-encoding-integrity.js` 无新增损坏；新增文件 LF + UTF-8 无 BOM |
| 品牌残留 | PASS | `check-no-brand-residue.js`；本 PR 文档一律写「参考产品」，不出现竞品真名 |
| 文档同步 | PASS | 新增 `01-docs/PRD-WECHAT-MP-API-TRACK-2026-10-12.md` + `openspec/changes/wechat-mp-api-publish-track/**` |
| 接线棘轮 | PASS | `check-unwired-tests.js`（4 个包内测试文件被 `run-tests.js` 的 `*.test.js` glob 自动发现；desktop 侧走 vitest glob） |
| QM-1 打包 | N/A | 未改 `package.json` 的 `files`、未新增被 require 的顶层依赖；改动集中在已被 asar 覆盖的 `electron/services` 与 `packages/api-publish-engine`。CI 打包 job 为准 |
| 远程同步 | PASS | PR #3375 已 squash 合并，merge SHA `305f3851c782882ec589dbd886df3f4388e53127`（committer 2026-10-12T09:06:17+08:00）；取证 `git log origin/main --grep='(#3375)$' --format=%H|%cI` **唯一 1 行**命中；`git ls-remote --heads origin wechat-mp-api-track` 返回 **0 行**，证远端分支已删；`sync_*` 三字段与 `scripts/gate-record-debt-ledger.json` 的本条登记已在同一次回填提交中删除 |

### 设计取舍（不假装只有一条路）

1. **不切默认轨**（`wechat_mp` 保持 `dom-only`）：① 本机无可用公众号会话，跨网络契约未取得真机证据；
   ② 「API 已建草稿但回读不齐」时，外层 `api-then-dom` 会降级 DOM 而**可能产生第二份草稿**
   ——契约已核实：`publishViaApi()` 把 `{success:false}` 转成 throw（`index.js:95`），
   `rpa-view-manager.js:144` 对 throw 降级。「重复草稿 vs 缺内容草稿」属产品取舍，本 PR 不单方面定默认。
2. **回读校验是本仓新增**（参考产品没有）：平台给了 `appMsgId` 不等于草稿内容齐全——上一轮的故障形态
   正是「保存成功但正文为空」，因此三项（标题/正文/封面）不齐即判失败，不做「警告但成功」。
3. **群发保护预检 fail-open**：它是增益而非正确性依据；变成硬阻断会让「未开通安全中心」的账号无法发布。
4. **照抄参考产品的中性默认字段表**（`draft-defaults.js`）而非省略：公众号编辑器保存是整表单提交，
   省略字段等于赌平台容错，而该容错没有一手证据。该表是**契约快照**，改动需同步 PRD 与测试。

### 遗留（不假装已闭合）

1. **真机验证 PENDING**：真实 `loginpage` HTML 核对六个正则（尤其 `user_name` / `ticket`）、
   真机建草稿核对标题+正文+封面三项齐全、回读页正文容器选择器——三项未做。
2. **`platforms.yaml` 切换前置**：真机证据 + 重复草稿取舍决策。
3. **既有缺陷（只记录，未改）**：`publish-api-server.js:1112` 用 `supportsApi()` 而非 `shouldUseApi()`。
4. **`api-then-dom` 的降级语义未动**（属其他平台既有行为）；本 PR 用集成测试钉住当前语义，避免被顺手改掉。
5. **`pre-commit` 的行尾规范化**会在下次 git 触碰时把新增文本文件转 CRLF（`warning: LF will be replaced by CRLF`）。
