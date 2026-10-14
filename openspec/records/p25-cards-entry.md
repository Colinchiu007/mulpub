---
record: p25-cards-entry
task: 修 Gate ① 假绿 —— structure-lock 两处解析缺陷 + 登记暴露出的既有欠账
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：修 Gate 假绿（p25-cards-entry，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见 CI
  —— 含 `apps/desktop/` ⇒ **混合 PR**，完整质量节拍。

## 现场：CI 一次红 5 个 job，其实是**两个**根因

| job | 根因 |
| --- | --- |
| QG Static | `check-renderer-cjs-boundary` 跨边界（上一提交已修）|
| **QG Desktop Shards (1/2) + QG Coverage** | **`src/locales/structure-lock.test.js` ①** |
| Gate Result | 上面两条的聚合 |

```
FAIL src/locales/structure-lock.test.js > ① 已迁移域：子模块键集合 == 装配文件中该命名空间键集合
AssertionError: zh.js cards 缺键 entryDesc: expected [] to include 'entryDesc'
```

## ★ 根因：这条判据**在 main 上从未真正生效过**（假绿）

两个解析缺陷叠加，让断言变成**空循环**：

| # | 缺陷 | 后果 |
| --- | --- | --- |
| ① | `topKeysOfObject` 假设命名空间是**多行字面量**。遇到单行展开 `cards: { ...cardsZh },` 时，同一行 `{` 让 depth=1、`}` 立刻归 0 ⇒ **第一行就 break** ⇒ 返回 `[]` |
| ② | `domainModuleKeys` 写死 `^ {2}(\w+):`（恰好两空格），而**既有 5 个域的子模块用 4 空格缩进**、`film-engineering` 还用**双引号键名** ⇒ 恒返回 `[]` |

**⇒ 断言是 `for (const k of zhDomain) expect(zhAsmKeys).toContain(k)` —— `zhDomain` 为空 ⇒ 一次都不跑。**

**⇒ 实测（写探针复刻两函数跑 main 与 worktree）：`hotTopics` / `contentCategories` / `emptyStates` / `automation` / `publishPage` 的 asmKeys 与 domainKeys **全部是 `[]`**。**

**⇒ 我的 `cards/zh.js` 恰好用 2 空格缩进 ⇒ 判据第一次被激活 ⇒ 立刻红。**

## 修法（三处，且不弱化）

| # | 改动 | 效果 |
| --- | --- | --- |
| ① | `topKeysOfObject` 区分三形态：`missing` / `spread`（含 target）/ `literal`（含 keys）| 单行展开不再返回 `[]` |
| ② | `domainModuleKeys` 改为取「`export default {` 内**最小缩进那一层**」的键，并允许引号键 | 对 2/4 空格两种既有风格都成立，且不会把嵌套键算进来 |
| ③ | 断言 ① 对 `spread` 形态改为**核对展开的是本域子模块**（`cardsZh` / `cardsEn`）| 这是比「比对键集合」**更强**的判据：单行展开下键集合按构造相等（恒等、无信息），而接错模块是真错 |
| ④ | 新增 `expect(zhDomain.length).toBeGreaterThan(0)` | **防再退化**：解析坏掉时会红，而不是又变空转 |

## ★ 修好后第一次真跑，立刻抓到**既有**漂移

`story2video` 的 zh/en 子模块键不对称：`composeSegments` 只在 zh、`composeProgress` 只在 en
（**main 上同样存在**，非本 PR 引入；探针实测两侧各 121 键、各独有 1 键）。

**处置：登记为显式欠账 `KNOWN_KEY_ASYMMETRY`（照文件里既有的 `PRECEDENT_DIRS` 模式），
而不是静默排除。**

- 登记项**要求写明 `onlyZh` / `onlyEn` 的具体键名** —— 形状变了仍然红（不是「加个名字就免检」）
- 为什么不顺手修：两侧各缺一个键，补哪侧都要**为该功能写原文案**，归属不在本 PR；
  **臆造翻译比留一条可见欠账更糟**
- **原状态是「判据空转 ⇒ 没人知道」，现在是「可见欠账 + 精确键名 + owner」**

## ★ 反证（证明门禁真的在跑）

```
把 cards 的展开接错模块：cards: { ...cardsZh }  ->  cards: { ...automationZh }
=> AssertionError: zh.js cards 展开的不是本域子模块: expected 'automationZh' to be 'cardsZh'   ✅ 红
还原 => Tests 4 passed   ✅ 绿
```

还原后 `git diff --numstat -- apps/desktop/src/locales/zh.js` **为空**（逐字节还原，未污染工作区）。

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| vitest `src/locales/` + `src/features/cards/` | PASS | **66 passed**（9 文件）|
| check-renderer-cjs-boundary | PASS | 361 文件，alias 10 项，0 未登记 |
| check-unwired-tests | PASS | exit=0 |
| check-locale-sync `--cjk` / `--keys` / `--pair-base` | PASS | 全 exit=0 |
| check-no-brand-residue | PASS | exit=0 |
| Gate 11 ESLint | PASS | exit=0 |
| 反证（接错模块） | PASS | 改动即红、还原即绿 |
| QM-1 打包 | 已覆盖 | 上上个提交改 `electron/` 时跑过（exit=0，asar 139.9 MB）；本提交不动 `electron/` |
| 行尾对账 | PASS | 两口径一致 |
| 远程同步 | PENDING | 本 PR 未合并 |

- 保留门禁：vitest 66 ✅ | 边界 ✅ | unwired ✅ | locale 三档 ✅ | 品牌 ✅ | Gate 11 ✅ | 反证 ✅ | 远程同步 PENDING

## 教训（第 110 轮）

**「本地跑的门禁清单」与「CI 跑的门禁清单」不是一回事。**

本轮我本地跑的是 vitest（cards 域）+ eslint + unwired + locale，
而两次 CI 红分别来自**不在我清单里**的两条：
`check-renderer-cjs-boundary`（静态边界门禁）与 `src/locales/structure-lock.test.js`（结构锁）。

**⇒ 处方：改渲染层 import 后跑边界门禁；改 locales 域后跑 `structure-lock.test.js`
（它在 `src/locales/` 下，`vitest run src/features/cards/` 收不到）。**

**★ 更一般**：**「加了一个新域/新模块」这个动作本身**会激活一批此前空转的判据 ——
因为很多判据是**遍历**式的（`readdirSync` 域目录、扫描渲染层文件）。
**新增一个被遍历到的对象，等于把该判据第一次真正打开。**
