# Tasks — UX 审计 1.9（catch-all 404）

> 状态口径：`[x]` 只给**当场有命令输出**的步骤；未跑/未闭合的一律留空并写明缺什么。

## 1. 门禁判据（先红）

- [x] 1.1 `.github/scripts/check-route-registry.test.js` 新增 11 例（catchAll 缺失 / `catchAll:false` / 第二条 / 形状不符 / 带 navEntry / 带 internal / router 侧两条同形状 / redirect 视图 / 普通暗路由仍被要求（正控）/ 形状常量字面量对账 / 真实文件 `catchAllRoutes === 1`）
- [x] 1.2 判据未实现时实跑：`# tests 25 / pass 16 / fail 7`（7 条新用例全部变红；另 3 条「不放宽」正控当场即绿，证明规则 2 的既有约束未被削弱）
- [x] 1.3 `check-route-registry.js`：`CATCH_ALL_PATH` 常量 + `parseRegistry` 读 `catchAll`（缺失/`false` 一律 false）+ 规则 2 豁免仅 `catchAll===true` + 规则 6（至多一条 / path 全等 / 与 navEntry·internal·redirect 互斥 / router 侧至多一条）
- [x] 1.4 脚本头部规则清单注释、`--json` stats（新增 `catchAllRoutes`）、修复指引第 4 条同步
- [x] 1.5 重跑：`# tests 25 / # pass 25 / # fail 0`

## 2. 视图与接线

- [x] 2.1 `apps/desktop/src/views/NotFound.test.js`（13 例，含真实路由表解析行为锁、出口条件、防泄漏、zh/en、夹具前提自证）
- [x] 2.2 `apps/desktop/src/views/NotFound.vue`：消费 `useSpaNavHistory`；`replace('/')`；真实 `<button>` + `cohere-btn`；CSS 变量取色
- [x] 2.3 `locales/common/{zh,en}.js` 成对新增 6 键
- [x] 2.4 `router/index.js`：`export const routes` + 末尾 `/:pathMatch(.*)*`（注释写明「顺序不承重」）
- [x] 2.5 `config/route-registry.js`：`catchAll: true` 登记项 + 头部字段契约/规则清单同步
- [x] 2.6 `useTabDocumentTitle.js`：`resolveRouteTabTitle(path, routeName)` 新增 NotFound 分支；覆盖度测试排除模式路径；`reportTitle` 传 `route.name`

## 3. 反证与验证

- [x] 3.1 `node scripts/not-found-contract-mutate.js` → 基线三套件 `red=0`；`M1..M9` 全部 `CAUGHT`；`ALL_CAUGHT（9 条）`；5 个被改文件 `md5 identical=true`
- [x] 3.2 `node .github/scripts/check-route-registry.js` → `router 路由 37 / 登记 37 / 菜单项 22 / 暗路由 11 / 兜底 1` + `PASS`
- [x] 3.3 受影响套件实跑：`NotFound`(13) + `useTabDocumentTitle`(17) + `route-registry-entry-hosts`(4) + `useSpaNavHistory`(7) + `locales/structure-lock`(4) 全绿
- [x] 3.4 eslint 改动 8 文件 `ESLINT_RC=0`
- [x] 3.5 行尾对账：`git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径均为 1512（相等 ⇒ 无行尾改写）；`git ls-files --eol` 逐文件读数与归因写在执行记录「行尾现场」
- [x] 3.6 门禁实跑：`check-locale-sync.js --pair-base HEAD` PASS、`--cjk` PASS（基线 1330 / 当前 1124，无新增硬编码）、`check-no-brand-residue.js` PASS
- [ ] 3.7 桌面端全量 vitest 实跑（本 PR 只跑了受影响套件；全量由 CI Gate 4 承担，本地未跑即如实留空）

## 4. 文档与收口

- [x] 4.1 新建 `01-docs/PRD-ROUTE-FALLBACK-404-2026-10-21.md`（显示项/文案表/V1-V7 校验规则/门禁契约/验收/已知盲区）
- [x] 4.2 `01-docs/UX-AUDIT-2026-10-17.md` 阶段 1.9 行改为已完成 + 落点与验收口径
- [x] 4.3 `docs/frontend-interaction-spec.md` §9.2 字段表加 `catchAll`、新增 §9.5（登记样例 + 四条判据 + 标题映射例外理由）
- [x] 4.4 `openspec/records/ux-audit-404-route.md`（含 `## CHANGELOG 条目` / `## learnings`，远程同步行写「由门禁推导」）
- [ ] 4.5 QM-6 双模型外部评审：本 PR 改到门禁判据本体（高危面），只认 `tier=external`；评审未闭合前不得自动合并
- [ ] 4.6 PR 创建 → CI → 按判据自动合并 → main push 回读 → `check-branch-merged.js` → worktree 清理
