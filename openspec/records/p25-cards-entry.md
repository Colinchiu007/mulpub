---
record: p25-cards-entry
task: 修 Gate 2c 红 —— 渲染层跨 CJS 边界（建分页器 ESM 孪生 + vite alias）
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：修 Gate 2c 红（p25-cards-entry，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见 CI
  —— 含 `apps/desktop/` + `packages/` ⇒ **混合 PR**，走完整质量节拍。

## 现场（CI 红，本地四门禁却全绿）

```
[renderer-cjs-boundary] FAIL：渲染层有 1 处未登记的 CommonJS 跨边界导入（已扫 361 个文件）
  apps/desktop/src/features/cards/useArticlePagination.js  ->  @multi-publish/shared-utils/src/index.js
```

CI 里红的形态是 `scripts/check-renderer-cjs-boundary.test.js` 的
「真实仓库当前是绿的（正控）」失败 —— **与「分页器有 bug」毫无关系**。

**★ 逃逸链分析（为什么本地全绿）**：这类越界在
`vite build` / `vitest` / `tsc --noEmit` / `electron-builder` **四道全是绿的**
（rollup 的 commonjs 插件与 vite-node 自带 interop），**只有 dev server 会红**，
且报错形态是「整页渲染失败 + 一条 ESM 具名导出错误」。
`Gate 2c` 正是为此设的**静态**门禁 —— 它拦住了我。

## 我的缺陷（第 N 次「照抄先例没对齐」）

渲染层有 10 个 `*.browser.js` ESM 孪生先例（`safe-http-url` 等），
AGENTS.md 也明写「照 platform-definitions / account-name-guard / publish-capabilities 三先例」。
我却在 `useArticlePagination.js` 里直接
`import { cardPaginatorCore } from '@multi-publish/shared-utils/src/index.js'` ——
既跨了 CJS 边界，又引了 barrel（而非具体模块）。

## 修法（照既有形态，A 方案）

| 步骤 | 产物 |
| --- | --- |
| ① 建 ESM 孪生 | `packages/shared-utils/src/card-paginator-core.browser.js`（与 CJS 版逐行同源）|
| ② 登记 alias | `apps/desktop/vite.config.js` 加 `@multi-publish/shared-utils/src/card-paginator-core` |
| ③ 改导入 | `useArticlePagination.js` 引具体模块（不再是 barrel）|
| ④ 加 parity 回归 | `packages/shared-utils/src/__tests__/card-paginator-core-parity.test.js` |

## ★ parity 回归是「逐行同源」而不是「几个行为向量」

三组判据：

| 组 | 判据 |
| --- | --- |
| ① | 剥离模块包装（`'use strict'` / `module.exports` → `export`）与头注释后，**两文件逐行相同** |
| ② | 导出面**集合相等** + 常量取值相等 + 三个标点表元素与顺序相同 |
| ③ | 行为向量（吸附三类输入 / 装箱页数 / fail-closed）一致 |

**⇒ 第①组才是主力**：向量只能覆盖想得到的分支，**逐行比对覆盖全部（含想不到的）**。
**⇒ 另有规模下界断言**（剥离后 > 150 行）：防「剥离逻辑坏掉 → 空 vs 空」的假绿。

**★ 写这条时踩到一个小坑**：CJS 版 `'use strict'` 后跟一空行、ESM 版没有，
逐行比对在第 1 行就报漂移。**那是包装的一部分，不是逻辑漂移** ⇒
normalizer 需同时剥前导与尾部空行。测试先红后绿，证明它在真跑。

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| **check-renderer-cjs-boundary** | PASS | 361 个渲染层文件，**alias 登记 10 项**（原 9 项），0 处未登记 |
| 其自测 `check-renderer-cjs-boundary.test.js` | PASS | **3/3**（CI 里红的那 3 条）|
| vitest apps/desktop cards | PASS | **34 passed**（4 文件）|
| vitest shared-utils 分页器 + parity | PASS | **30 passed**（2 文件）|
| Gate 11 ESLint | PASS | exit=0 |
| check-unwired-tests | PASS | exit=0 |
| check-locale-sync --cjk / --keys | PASS | exit=0 |
| check-no-brand-residue | PASS | exit=0 |
| QM-1 打包 | 已覆盖 | 上一个提交改了 `electron/` 并跑过 QM-1（exit=0，asar 139.9 MB）；**本提交不动 `electron/`**，只动 vite 配置与渲染层/共享包，故不重复 |
| 行尾对账 | PASS | 两口径一致 |
| 远程同步 | PENDING | 本 PR 未合并 |

- 保留门禁：边界门禁 ✅ | 边界自测 3/3 ✅ | vitest 34+30 ✅ | Gate 11 ✅ | unwired ✅ | locale ✅ | 品牌 ✅ | 远程同步 PENDING

## 教训

**「本地四门禁全绿」不等于「CI 全绿」** —— 本轮本地跑的是
vitest / eslint / unwired / locale，而红的那条（`Gate 2c` 边界门禁）
**不在我习惯跑的清单里**。

**⇒ 处方：改渲染层 import 后，必须显式跑 `node scripts/check-renderer-cjs-boundary.js`。**
它与 dev server 的真实行为对应，而 build/vitest/tsc/打包四道都看不见这个问题。
