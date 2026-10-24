# Tasks: dep-audit-new-advisories

> 目标：让 `node scripts/check-dep-audit.js` 在 origin/main 上 rc=0，解除对所有 PR 的 `Gate Result` 阻塞。
> 详细归因与分级理由见 `proposal.md`。

## 0. 前置确认

- [ ] 0.1 在最新 origin/main 上跑 `node scripts/check-dep-audit.js`，确认仍是那 10 条 NEW_ADVISORY（本提案写就时的读数）
- [ ] 0.2 确认没有其他会话正在处理同一批公告（查 `openspec/changes/` 有无相关提案、查近期依赖相关 PR）
- [ ] 0.3 确认工作区是隔离 worktree（纯依赖变更属运行时代码，按 AGENTS 不得在共享根就地改 `package.json` / `pnpm-lock.yaml`）

## 1. A 级：fast-uri + undici（预期消 7 条）

- [ ] 1.1 确认这两个包在根 `package.json` 无直接声明（本提案已核实：无），即它们是传递依赖
- [ ] 1.2 尝试方案一：`pnpm update fast-uri undici`（或在根目录 `pnpm update --depth <n>`），看 lockfile 能否收敛到 `fast-uri@3.1.9` / `undici@7.30.1`
- [ ] 1.3 若 1.2 无效，采用方案二：根 `package.json` 加 `pnpm.overrides`，形如
      ```json
      "pnpm": { "overrides": { "fast-uri": "^3.1.9", "undici": "^7.30.1" } }
      ```
      **采用此方案前必须**：确认无依赖方对旧版 API 有假设（`fast-uri` 的消费方含 `@vue/compiler-core` 等构建期包；`undici` 被 Electron 主进程消费）
- [ ] 1.4 `pnpm install --frozen-lockfile`
- [ ] 1.5 `node scripts/check-dep-audit.js` → 确认 fast-uri ×4 与 undici ×3 共 7 条消失
- [ ] 1.6 跑 `node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`
- [ ] 1.7 QM-1：`cd apps/desktop && pnpm run build:win`（含 asar 验证 + 启动烟测三层判据）
- [ ] 1.8 `cd apps/desktop && pnpm exec vitest run` 全量（防传递依赖升级打破构建/运行）

## 2. C 级：electron 登记 accepted-risk（消最后 1 条 high）

- [ ] 2.1 在 `scripts/dep-audit-baseline.json` 的 `advisories` 追加一条，字段：
      ```json
      {
        "source": "npm",
        "id": "GHSA-jr5w-w6x2-84p9",
        "module": "electron",
        "severity": "high",
        "patched": ">=43.8.1",
        "targetVersion": "43.8.1",
        "roots": ["."],
        "decision": "accepted-risk",
        "note": "<按 2.2 的三要素写>"
      }
      ```
- [ ] 2.2 `note` 必须含三要素（缺一不可，参照存量 `source-map-js` 条目的粒度）：
      ① **影响面**：electron 主进程 / 渲染进程是否触达该公告描述的漏洞路径
      ② **为什么不升级**：AGENTS 锁定 43.x；升级牵动 `ensure-electron.js`、`electron-ci.yml`、`electron-builder@25.1.8` 兼容性、QM-1 启动烟测四层
      ③ **复检条件**：建议写「`electron-builder` 或 `scripts/ensure-electron.js` 下一次改动时连带评估」
- [ ] 2.3 `node scripts/check-dep-audit.js` → 确认 rc=0（**此时主干即可转绿**）
- [ ] 2.4 不要顺手滚 `reviewBy`（属改守门参数，单独排期）

## 3. 收尾验证（必须在开 PR 前完成）

- [ ] 3.1 `node scripts/check-dep-audit.js` rc=0
- [ ] 3.2 `node scripts/check-debt-budget.js` rc=0（若 lockfile 行数暴涨需评估 `maxFileLines` 之外是否新增超大文件）
- [ ] 3.3 `node scripts/check-no-brand-residue.js` PASS
- [ ] 3.4 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` OK
- [ ] 3.5 执行记录写 `openspec/records/<分支名>.md`，**每篇都要带 `| 远程同步 | 由门禁推导 |` 表行**（#4341 实测踩过：漏一篇整块判红）
- [ ] 3.6 locale 若动了 `apps/desktop/src/locales/`：除 `check-locale-sync.js --keys` 外，**必须跑 `src/i18n/i18n.test.js`**（后者查两侧叶子键完全对称，#4341 实测踩过）

## 4. 合并后

- [ ] 4.1 回读 main push 的 `依赖漏洞审计门禁` run（`gh run list -R Colinchiu007/mulpub --workflow=364691268 --commit <merge SHA>`），必须 conclusion=success
- [ ] 4.2 确认 PR #4341 的 `Gate Result` 随之转绿（它的定时检查会自动走合并链）

## 5. B 级：body-parser + zod（单独排期，不与上面混）

- [ ] 5.1 `body-parser` 2.3.0 → 2.4.0：查 2.4.0 changelog 有无 breaking；`packages/ai-writer-api` 是直接消费方，跑其测试
- [ ] 5.2 `zod` 4.3.6 → 4.6.6：跨 3 个 minor，先查 `packages/remotion-composer` 的 schema 用法；确认无其他会话在跟
- [ ] 5.3 两者都通过后再跑 3.1~3.6 同一套验证
