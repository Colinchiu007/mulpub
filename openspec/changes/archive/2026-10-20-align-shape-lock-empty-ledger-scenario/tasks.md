# 任务

## 1. 取证

- [x] 1.1 证明矛盾真实存在且在同一份 blob 里（不是两个版本混读）：从 `origin/main` 读该 spec，正文含「键数本身不设数字下限」、同一 Requirement 的最后一个 Scenario 含「键数为 0 … MUST 红（规模下界）」；两串各命中恰 1 次。
- [x] 1.2 证明 `openspec validate` 抓不到它：归档前后各跑一次 `--all --strict`，失败集 22 条逐字不变 ⇒ 校验器只查结构/必需段，不查条目内自洽。

## 2. 规格

- [x] 2.1 写 `MODIFIED Requirements` delta：正文与其余 Scenario 逐字保留，只把末个 Scenario 改写成"读不到 ⇒ 红 / 合法为空 ⇒ 不红 / 防清空交给行为判据"三档。
- [x] 2.2 `openspec validate <本 change> --strict` 通过（`MODIFIED` 能在主规格匹配到同名 Requirement）。

## 3. 收尾

- [x] 3.1 与本 PR 的代码半（#4001 分支上的 `keys.length > 0` 摘除 + 接线锁）同批落地，不留"规格与代码相反"的中间态过夜。
- [x] 3.2 在执行记录里补这一格：谁发现的（我自己核对归档结果时）、为什么 validate 没抓到、以及"正文与 Scenario 互斥"要当成一类可复发的形状记住。
