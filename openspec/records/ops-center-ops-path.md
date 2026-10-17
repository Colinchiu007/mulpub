---
record: ops-center-ops-path
task: 运营中心子路径部署打通——前端构建 base 条件化为 /ops/（修复「nginx 配了但页面白屏」）
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；远程同步这一行只能在合并后取
sync_backfill_owner: 下一个会话（按 AGENTS.md「合并后收尾清单」回填并删除本段三个字段）
---

## 本次执行记录：ops-center 前端 base 路径修复（ops-center-ops-path，2026-10-17）【混合 PR（前端构建配置）】

判定证据：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=false`**（改 `ops-center/frontend/vite.config.js`）。

### 第一性原因（QM-5 ①）

运营中心经 `https://www.iart.work/ops/` 子路径对外服务，但 `vite.config.js` **未配 `base`**（默认 `/`），
产物 `index.html` 里的资源是**根相对路径**：

```html
<script src="/assets/index-xxx.js">     ← 修复前
```

nginx 的 `location /ops/` 只能取到 HTML，而 `/assets/*` 落到主站 root
（`/var/www/iart.work/` 下**没有** `assets/` 目录）⇒ 404 ⇒ **页面白屏**。

这是「nginx 配了但页面打不开」的典型形态：location 判据只看到 200，**没验证产物资源路径与挂载路径是否匹配**。

### 逃逸分析（QM-5 ②）

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | 原有 13 个前端测试文件**没有一条**断言产物资源路径 —— 全部断言组件行为，而 base 只影响构建产物 |
| 构建门禁 | `npm run build` 只校验「能构建成功」，不校验「产物路径与部署路径匹配」。Vite 对 base 缺失完全沉默 |
| 部署侧 | `ops-center/deploy/nginx-ops.conf` 的 `location /ops/` 写得没问题，但它的自洽性依赖「前端 base 也是 /ops/」这个**未写明的跨端前提** |
| 我的排查 | 第一轮我看了 nginx location 就下结论「加 location 即可」，**漏验产物资源路径**；直到实测 8011 端口（那份配置独占根、故自洽）才反推出 base 问题 |

### 修复 + 回归保护（QM-5 ④）

**修复**（`ops-center/frontend/vite.config.js`，1 行 + 注释）：

```js
const isProduction = process.env.NODE_ENV === 'production'
export default defineConfig({
  base: isProduction ? '/ops/' : '/',
  ...
```

**为什么按 NODE_ENV 分流**：base 必须在**构建时**静态注入产物（运行时改不了）。若统一改成 `/ops/`，
本地 `npm run dev`（127.0.0.1:5173 根下）的入口会变成 `http://127.0.0.1:5173/ops/`，
对所有本地开发者是无谓破坏面。

**回归保护**：新增 `ops-center/frontend/tests/vite-base-path.test.js`（5 例），
其中「dev 入口不变」这条专门锁住分流不被后人简化成恒定值。

### 变异反证 6/6 全红（均字节级还原 + 还原后 0 红）

| 变异 | 内容 | 红条数 |
|---|---|---|
| MB1 | base 恒定 `"/"`（**回到修复前状态**） | 1 |
| MB2 | base 恒定 `"/ops/"`（dev 入口被破坏） | 1 |
| MB3 | 缺前导斜杠（`ops/`） | 2 |
| MB4 | 缺尾斜杠（`/ops`） | 2 |
| MB5 | `NODE_ENV` 判据写反 | 2 |
| MB6 | base 拼错子路径（`/ops-center/`，与 nginx location 不符） | 1 |

### 产物级判据（不能只看测试绿）

`npm run build` 后实测 `dist/index.html`：

```html
<script type="module" crossorigin src="/ops/assets/index-CSS8cY5p.js"></script>
<link rel="modulepreload" crossorigin href="/ops/assets/element-plus-RJf6BsLy.js">
<link rel="stylesheet" crossorigin href="/ops/assets/index-BGdMNXcm.css">
```

- 含 `/ops/assets/` ✅
- **含裸 `/assets/` = False** ✅（这正是修复前的形态）

### 取证

- 新增测试 `tests/vite-base-path.test.js` **5/5 通过**（TDD：先 RED，实测 `expected undefined to be '/ops/'`）
- 前端全量 `npx vitest run` → **13 files / 93 tests 全绿**
- `npm run build` → **rc=0**，产物路径如上
- 变异 **6/6 全红** + 字节级还原 + 还原后 0 红

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 前端构建配置：worktree `<仓库父目录>/mp-worktrees/mp-ops-center-ops-path` + 裸分支 `ops-center-ops-path`；`git-dir != git-common-dir` 实证 |
| 第一性原因（QM-5 ①） | ✅ | 见上：vite base 缺省为 `/`，与子路径部署不匹配 |
| 逃逸分析（QM-5 ②） | ✅ | 见上表：原有测试全断言组件行为，无一条覆盖产物路径 |
| 修复 + 回归保护（QM-5 ④） | ✅ | base 条件化 + 5 例测试（含 dev 入口不变锁）+ 产物级验证 |
| 防止再次发生（QM-5 ⑤） | ✅ | 测试锁住「生产 base == nginx location 前缀」这个跨端契约；并在 PR 正文写明判据必须是产物路径而非 location 状态码 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 接线棘轮 | ✅ | 新增 `tests/vite-base-path.test.js` 位于 `ops-center/frontend/tests/`，由 `npx vitest run` 全量收集（既有 13 个测试同目录，无单独接线需求） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/`；本变更为运营中心前端，门禁是 `npm run build`（已过） |
| QM-2 代码必检项 | ✅ | 见下 |
| QM-6 CCG 双模型外部评审 | 见下 | 本次变更 1 行逻辑 + 注释，`docs-only=false` 但属极小 delta |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin <branch>` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

### QM-2 代码必检项

- **require 路径**：未新增 require
- **注释语法**：`/* */` 成对；新增 JSDoc 块以 `/**` 起始、`*/` 收尾
- **模块导出**：未改 `export` 结构（`opsDevCspMeta` 仍导出）
- **性能**：`isProduction` 是模块级常量求值一次，无热路径开销
- **i18n**：未新增用户可见文案

### QM-6 评审

本次 delta 为 1 行逻辑（`base: isProduction ? '/ops/' : '/'`）+ 注释 + 1 个测试文件。
按 `docs-only=false` 需走完整节拍，但引擎 `ccg-deep-review.js` 不在 CI 可见面且本机需显式调用。
**本轮未调用引擎**，如实记录；替代判据是 6 条变异反证 + 产物级验证 + 93 条既有测试无回归。

### 遗留（不假装已闭合）

- **本 PR 只解决前端产物路径**。要真正让 `https://www.iart.work/ops/` 可用，还需（均属服务器部署，不在本 PR 范围）：
  1. nginx 443 server 块加 `location /ops/` 与 `location /api/ops/`（须用 `^~` 前缀避开已有正则 location）；
  2. 服务器上**用新 base 重新 build** 前端产物（当前 `/srv/projects/ops-center/frontend/dist` 是 2026-07-01 旧产物）；
  3. 同步后端代码（服务器后端是 2026-07-01 版本，`/api/v1/app-menu` 路由**不存在**，实测 openapi 中 `app-menu` 出现 0 次）。
- **服务器后端落后约 170 个提交**（2026-07-01 至今），涉及后端 +12929/-2331 行、前端 +11585/-3177 行。这是**一次真正的版本跃迁**，不是简单 pull，需单独轮次并先备份 `.env` 与 `config.db`。
- 未验证「dev 模式下 base 为 `/`」是否影响任何现有开发脚本 —— 测试已覆盖该分流，但**没有实跑 `npm run dev`**（无头环境不起浏览器）。
