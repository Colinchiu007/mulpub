---
branch: fix-ensure-deps-version-pin
date: 2026-10-17
sync_reason: 本 PR（fix-ensure-deps-version-pin）的远程同步待合并后由后续 docs PR 就地改写为 PASS 并删除本登记字段
sync_backfill_owner: fix-ensure-deps-version-pin 分支作者会话（合并收尾时回填）
---

# 本次执行记录：ensure-desktop-deps 的 sharp 版本硬编码假阳性 + restore 混版（fix-ensure-deps-version-pin，2026-10-17）【混合 PR】

> task: `ensure-desktop-deps.js --check` 恒报 `DESKTOP_DEPS_MISSING`（假阳性），且其 restore 分支会制造
> `@img/sharp-win32-x64` 混版导致 `Could not load the "sharp" module`、应用起不来。

## 一、第一性原因（QM-5 ①）

`scripts/ensure-desktop-deps.js:31` 把 sharp 平台包的**版本与关键文件名写死**：

```js
{ name: '@img/sharp-win32-x64', version: '0.35.1', files: ['index.cjs', 'lib/sharp-win32-x64-0.35.1.node'] }
```

仓库后来把 sharp 升到 0.35.5，于是：

1. **假阳性**：`--check` 按 `0.35.1.node` 找文件，实际只有 `0.35.5.node` ⇒ 恒报缺失（本机依赖其实健康）。
2. **混版（更严重）**：restore 分支按 0.35.1 走 `npm pack` → `fs.cpSync(..., { force: true })`。
   cpSync 是**合并**而非替换 ⇒ 把 0.35.1 的 `index.cjs` 覆盖进来，却**留下**原有的 0.35.5 的 `.node`，
   最终 `index.cjs` 指向一个不存在的文件 ⇒ `Could not load the "sharp" module using the win32-x64 runtime`
   ⇒ 主进程加载即抛异常 ⇒ 应用起不来（2026-10-17 本机实测，症状为窗口标题 `Error`、无 renderer 进程）。

第一性引入点：该硬编码随脚本首次落地（`version` 与 `package-lock.json 一致` 的注释表明初衷是**钉死**版本），
但 sharp 是**跟随桌面依赖升级**的包，钉死版本与「跟随升级」天然矛盾——这是设计错误，不是笔误。

## 二、逃逸分析（QM-5 ②）

| 层 | 为什么没拦住 |
| --- | --- |
| 单元测试（`ensure-desktop-deps.test.js`） | 14 条用例里唯一造「健康树」的那条直接遍历 `lib.FRAGILE` 并按 `p.files` 造文件 ⇒ **测试与实现共享同一个错误版本号**，永远自洽；没有任何用例从真实 `node_modules/sharp` 读版本 |
| 真实树 `--check` | 从未在 win32 上作为**必跑门禁**接线（只在启动脚本里被调用），所以恒红也没有人看到；本次是手工跑 `--check` 才暴露 |
| CI | CI 跑 Linux，`fragileFor` 按 `platformArch` 过滤掉 sharp 条目 ⇒ 这条判据在 CI 上**一次都没跑过** |
| 代码评审 | 升级 sharp 的 PR 没人被提示「要同步 FRAGILE 里的版本号」——没有任何机械提示 |

**共性**：版本号存在**两份**（`package.json`/lockfile 一份、`FRAGILE` 一份），没有判据保证它们一致。

## 三、系统性漏洞（QM-5 ③）

`scripts/ensure-desktop-deps.js` 的 FRAGILE 清单把**易变事实**（依赖版本）写死在判据里。
同类风险：清单里另外三条（`@img/colour` / `@element-plus/icons-vue` / `@ctrl/tinycolor`）同样是手抄版本，
只是尚未撞上「平台包二进制文件名含版本」这个放大机制。本次只修 sharp 一条（它有文件名推导问题），
其余三条按 PRD 纪律不顺手改（改动面扩大需重新评审），已在文档登记。

## 四、修复 + 回归保护（QM-5 ④）

| 改动 | 文件 | 回归保护 |
| --- | --- | --- |
| 版本改为从已安装 `sharp/package.json` 读；`.node` 文件名按该版本推导；sharp 未安装 ⇒ 条目缺席（fail closed） | `scripts/ensure-desktop-deps.js` | `resolveSharpPlatform` 3 条用例（读版本/推导文件名、未安装返回 null、`fragileFor` 跟随版本） |
| `fragileFor` 增加 `root` 参数并贯穿 `collectMissing`/`restorePackage`（此前 restore 用 `DEFAULT_ROOT` 解析，测试树/其他 root 全失效） | 同上 | 变异 C：把 `root` 改回 `DEFAULT_ROOT` ⇒ 1 红 |
| 抽出 `purgeStaleBinaries()`（判据与动作分离），restore 在 cpSync **之前**清掉旧版本 `.node` | 同上 | `purgeStaleBinaries` 2 条行为用例（真删文件/保留当前版本/无 lib 不抛错）+ **接线锁**（restorePackage 必须调用且调用点在 cpSync 前） |
| 更新旧用例 5/8 以反映新契约 | `scripts/ensure-desktop-deps.test.js` | 见下 |

**TDD 见证**：先加 4 条新测试 ⇒ `# fail 4`（`resolveSharpPlatform` 不存在）；实现后转绿；
补 `purgeStaleBinaries` 行为测试与接线锁后 `# tests 18 / # pass 18 / # fail 0`。

**真实树验证**：本 worktree `node scripts/ensure-desktop-deps.js --check` ⇒ `DESKTOP_DEPS_OK`（rc=0），
假阳性消除；对照另两个 worktree（跑旧代码）仍报 `DESKTOP_DEPS_MISSING`，量化了影响面。

## 五、变异反证（5 条全部捕获，逐字节还原）

| 变异 | 结果 |
| --- | --- |
| A：`resolveSharpPlatform` 写死 0.35.1（退回手抄） | CAUGHT（1 红） |
| B：`restorePackage` 整段删掉清理调用（判据在、没人接） | CAUGHT（1 红，靠接线锁） |
| B2：`purgeStaleBinaries` 只返回空不删文件（装饰性防护） | CAUGHT（1 红） |
| C：`fragileFor` 忽略 `root` 参数（正是本次修掉的 bug） | CAUGHT（1 红） |
| D：sharp 未安装时返回写死的 0.35.5（猜版本，违反 fail closed） | CAUGHT（2 红） |

还原校验：变异前后 SHA-256 前 12 位一致（`b08711e9a158`）。

**过程中被抓到的自身缺陷（如实记录）**：第一轮变异 B/B2 **未被捕获**——我最初的「混版锁」只断言了
`findStalePlatformBinaries` 的返回值，没有断言 `restorePackage` 真的调用它。这说明「判据正确 ≠ 有人调用」，
于是补了 `purgeStaleBinaries` 行为测试 + 结构接线锁，第二轮 5/5 捕获。

## 六、预防措施（QM-5 ⑤）

1. **版本不再有两份**：sharp 平台包版本单一来源 = 已安装 `sharp/package.json`（与 lockfile 天然一致）。
2. **fail closed**：sharp 未安装 ⇒ 该条目不参与判据，不猜版本、不伪造文件名。
3. **接线锁**：把「判据→动作→调用点顺序」三者分别钉住，防装饰性防护。
4. **learnings 沉淀**：`2026-10-17 · fix-ensure-deps-version-pin` 节（见 `01-docs/learnings.md`）。
5. **遗留（不顺手改，登记）**：FRAGILE 另三条仍是手抄版本；建议后续单独评审「整单改为从 lockfile/已安装包解析」。

## 七、门禁与取证

| 门禁 | 读数 |
| --- | --- |
| TDD | 先红 4 条 → 后绿 `18 passed / 0 failed` |
| 变异反证 | 5/5 CAUGHT，逐字节还原 |
| 真实树 `--check` | `DESKTOP_DEPS_OK`（rc=0） |
| 变更类型判定 | `classify-docs-only.js` ⇒ 混合 PR（改 `scripts/` 自身），走完整节拍 |
| 行尾对账 | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致 |
| 品牌残留 | `check-no-brand-residue.js` |
| doc-abs-paths | `check-doc-abs-paths.js` |
| 行数门禁 | `check-max-lines.js` |
| locale keys | 本 PR 未改 locales（不适用） |
| 执行记录 | `check-pr-exec-record.js --mode=enforce` |
| CCG 提交门禁 | pre-commit 5 项 |
| QM-1 打包 | 本 PR 未改 `apps/desktop/electron/`，不适用 |
| QM-6 深度评审 | 见 `.ccg/reviews/<sha>.json` 与 `.adversarial/` 产物 |

| 远程同步 | PENDING |
