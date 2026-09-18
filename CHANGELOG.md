# [未发布] chore(ci): 刷新债务熔断基线时间戳与 modelProviderLines，恢复基线元数据自洽（2026-09-18）

### 变更
- `scripts/debt-baseline.json`：`scannedAt` 由陈旧的 `2026-09-12T18:24:48Z` 更新为 `2026-09-18T01:46:43Z` —— 此前基线数值（`maxFileLines 6511` / `filesOver500 87` / `modelProviderRequireFanOut 65`）已被更新为当前实际值，但时间戳未跟进，元数据不自洽，会误导按 `scannedAt` 判断「基线有多旧」。
- `modelProviderLines` `1241 -> 1242`（与实测一致；该项为参考值、不设门禁）。
- 生成方式：`node scripts/check-debt-budget.js --update`（脚本原生命令，非手改 JSON）。

### 验证
- 刷新后 `node scripts/check-debt-budget.js` → exit 0，全部指标 pass（maxFileLines 6511 / filesOver1000 31 / filesOver500 87 / fanOut 65 / circularDeps 0）。

---

