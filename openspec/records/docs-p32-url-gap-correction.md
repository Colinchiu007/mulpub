---
record: docs-p32-url-gap-correction
task: 修正 P3-2 评估结论 —— 判据①的 URL/模式类缺口也需真机取证
date: 2026-10-14
---

## 本次执行记录：修正 P3-2 评估结论（docs-p32-url-gap-correction，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见下
  —— 本 PR 只改 `01-docs/PLAN-*.md` ⇒ 预期 `docs-only=true`。

## 为什么要修正

第 82 轮（PR #3556）写进 PLAN 的评估里有句错话：

> 「判据①的四类缺口**均可由 agent 完成**，不依赖账号，可与 1/2 并行」

本轮读 `platform-definitions.js` L441-457 的既有约束后发现：**URL/模式类不可猜**。

## 依据（源码注释，非推测）

| 行 | 约束 |
| --- | --- |
| L447 | 「每个值的 host 必须与同平台 `PLATFORM_LOGIN_URLS` **同源**（**跨域＝开到别的站点**）」⇒ 写错是**安全问题** |
| L449-454 | 小红书的 `PLATFORM_CREATOR_HOME_URLS` 是 **2026-10-13 真机取证**（CDP 逐帧 `/`→`/login`→`/new/home`）得来，并单独产出 PRD |
| — | `PLATFORM_LOGIN_SUCCESS_PATTERNS` 是**登录成功判据**，猜错会让「未登录」被当成「已登录」 |

## 修正内容

把「四类缺口」改为**可完成性表**，明确分开：

| 缺口 | 判据 | agent 能否独立完成 |
| --- | --- | --- |
| `platforms.yaml` 配置段 | 4 | ✅ 可 |
| `publish-capabilities.json` 元数据 | 5 | ✅ 可 |
| 三张上限表 | 7/8 | ✅ 可 |
| 测试与文案 | 11 | ✅ 可 |
| **`platform-definitions.js` 三个 URL/模式表** | 1/2/3 | ❌ **不可**（需真机取证）|

前置条件也从「判据②③的唯一解锁条件」改为「判据①②③的**共同**解锁条件」。

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 行尾对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致 |
| 品牌残留 | PASS | `check-no-brand-residue.js` exit=0 |
| 文档同步 | PASS | `classify-docs-only.js` → `docs-only=true` |
| 执行记录 | PASS | 本文件即按出路①新增 |
| 远程同步 | PASS | #3560 merge `3734a676b` |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS（#3560 @ 3734a676b）

## 备注

- 本 PR **只修正自己上一笔（#3556）写错的话**，不改他人的记录块。
- 这印证了本会话反复出现的一类问题：**「看起来能并行」的结论，往往没验证到约束层**。
  约束不在 PLAN 文档里，而在源码注释中 —— 所以「读先例」必须读到注释。
