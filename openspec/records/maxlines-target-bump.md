---
record: maxlines-target-bump
task: 修复主干红：rpa-view-platforms.js 越过点名目标，按门禁许可上调 targets
date: 2026-10-23
---

# 主干红：TARGET_GREW

## 1. 现象

2026-10-23 17:16，`main`（`7718f8987`）的 `债务熔断检查` 红：

```
❌ TARGET_GREW: apps/desktop/electron/services/rpa-view-platforms.js
   现 1497 行已超过点名目标 1484 行（超 13）。
被点名还账的文件一律零增长容差：降到目标以下，
或在 review 中说明理由后一并上调 targets
```

影响面：**所有 open PR 都被判 `STOP_MAIN_RED`（rc=2）**，包括我手上已全绿的
`#4328`（对账脚本修复）——它 `newRed=0`，纯粹被主干拖红。

## 2. 归因

`git log` 指向 `f84e1f79f`（2026-10-23 16:39，PR **#4276**
`fix(toutiao): click add-video before upload`）——该提交给这个文件加了
「先点添加视频再上传」的分支，净增 13 行，越过 `targets` 里 1484 的还账目标。

`files` 里的基线（1422）没动，动的是 `targets`（点名还账目标）——所以是
「被点名文件零增长容差」这条判据命中，不是普通的 500 行阈值。

## 3. 处置

按报错文案给出的**第二条出口**：上调 `targets`，并在此说明理由。

`.github/scripts/max-lines-baseline.json`：

```diff
- "apps/desktop/electron/services/rpa-view-platforms.js": 1484
+ "apps/desktop/electron/services/rpa-view-platforms.js": 1497
```

**为什么是 1497 而不是更大**：1497 就是当前实测行数（本地 1496，CI 1497，差在行尾）。
把它设成「恰好等于现状」，等于**不给任何新增长留空间**——下一次再涨 1 行仍然会红。
若设成 1500/1520 之类，就等于顺手放宽了棘轮，那才是真正削弱这条门禁。

**为什么不选择「降到 1484 以下」**：#4276 的改动是修 toutiao 发布链路的功能性修复
（不点「添加视频」直接上传会失败），删行等于回退功能。在这个文件里再挤 13 行属于
拿别人的功能换行数，风险大于收益。

## 4. 判据

- `node .github/scripts/check-max-lines.js` → **rc=0**（超限文件 94 / 挂账 94 / 点名还账 20，均与基线一致）
- 只改一个数字，不动 `files` 基线、不动 `growthAllowance`、不动任何源码

## 5. 收尾顺序

本 PR 合并后 main 转绿 → 再合 `#4328`（对账脚本修复，已全绿、只因主干红被挡）。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
