---
record: reverse-findings-batch2
task: 竞品逆向 2026-10-19 补证批次 —— 前端全量清点 / TKK签名档 / 组件技术债 / 参考产品架构 + 端点数更正
date: 2026-10-19
---

## 本次执行记录：竞品逆向补证批次（reverse-findings-batch2，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**（4 新增 + 2 修改，全部在 `01-docs/research/`），隔离 worktree `mp-reverse-findings-batch2` / 裸分支 `reverse-findings-batch2` |
| 第一性原因（QM-5 ①） | ✅ | 三处空白各有独立动因：①`dist/` 89 个 js 与签名档此前**只清点不拆解**；②27 个组件版本面从未系统取证（此前只分析过 2 个 PE）；③参考产品只有产品视角、缺代码级判定 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸在「已分析的 2 个 PE 被当成了全貌」——`WEMedia.exe`+`MediaTaskMgr.dll` 之外 25 个组件无人看过，直到本轮才发现 OpenSSL 1.0.2g / libcurl 7.47.1 这层技术债 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 2 个测试（`tk-signature.test.js` 10 例 + `dump-pe-tables.test.js` 5 例，共 **15 例全绿**）；其中 `dump-pe-tables.test.js` 含**假阳回归锁**（8 个被误判组件不得再被判「需人工」、壳签名表不得含通用词）|
| 防止再次发生（QM-5 ⑤） | ✅ | ①签名文档写入「肉眼读两个相似函数不足以断言等价，必须跑数据」；②组件文档 §6 完整留档「假阳比漏检更坏」的自身 bug；③前端文档写明「宽正则命中数当结论」的踩坑（`rpa` 376 命中全是 `in-addr.arpa`）|
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致；`mtm-platform-apis.md` 的删除行仅「1339→1327」一处数字与被替换的 2 行说明 |
| 接线棘轮 | N/A | 未新增 `*.test.js` 到本仓（测试脚本在仓外 `<REA_WORKSPACE>`，不属本仓 CI 面）|
| QM-1 打包 / QM-4 视觉 | N/A | 纯文档，未触运行面 |
| QM-6 CCG 双模型外部评审 | 未执行 | docs-only 快速通道；**不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导 |

### 判定证据

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 预期 `docs-only=true`（files=6）
- `node scripts/check-no-brand-residue.js` → **PASS（扫描 10,480 个 tracked 文件）**
- `node scripts/check-doc-abs-paths.js` → **PASS（无新增本机绝对路径）**
  新文档一律用 `<REA_WORKSPACE>` / `<安装目录>` / `<解包根>` 占位，未引入盘符路径

### 本批次实测数字（全部可复算，均来自本机实际运行）

| 项 | 读数 | 来源 |
|---|---|---|
| CEF 前端扫描 | 316 文件 / 32.7 MB / **5 秒** | `extract-asset-js-inventory.cjs` |
| 前端去重 URL / 域名 / API 路径 | 967 / 175 / 98 | 同上 |
| **JS→原生回调** | **63 个（全枚举）** | 同上 |
| 自家后端 | **9 域名 / 333 URL** | 同上 + `analyze-selfbackend-domains.cjs` |
| 签名差分测试 | **10 例全绿**（84 组输入 × 2 变体 + 逐长度边界） | `tk-signature.test.js` |
| 签名变体首次分歧 | `len=31`（`860975.725073` vs `279451.159973`）| `probe-signature-variants.cjs` |
| 组件总数 | **27 个 PE，全部 PE32 x86** | `dump-all-components-pe.cjs` |
| 加壳判据 | **27/27 干净**（0 壳字符串命中 / 正常入口前导 / 节名完整）| 同上 |
| PE 判据假阳修复 | 8 个组件从「需人工」→ 干净 | `dump-pe-tables.test.js` 5 例 |
| 参考产品主进程 | 8.0 MB / 141,720 行 / **34 IPC / 27 个 `page-manager:*`** | `extract-yixiaoer-main-inventory.cjs` |
| 参考产品 RPA 词汇 | **0 命中**（puppeteer/playwright/cdp/chromedriver）| 同上 |
| 参考产品平台域名 | **220 个**（前 40 全是创作后台）| 同上 |
| 端点数复核 | **1,327**（两口径一致、逐条回溯 DLL 字节、零编造）| `validate-platform-apis.cjs` |

### 遗留（不假装已闭合）

1. **`dist/` 89 个 js 仍未逐 view 拆解** —— 本批次只做清点，`view-ai-clip`/`view-xhs-template` 已有专项文档。
2. **7 个业务 API 里仍只有 1 个有反编译证据** —— 其余 6 个签名仍属导出表推断。
3. **CVE 编号未逐条核对** —— 组件文档只做「版本 → 已知有修复」的定性判断。
4. **`socket.io` 在参考产品里的真实作用未定** —— 依赖与字段都在，但 `new Server` / `io()` 各 0 命中。
5. **所有结论均为静态** —— 未运行任何竞品、未向任何平台发过请求，「签名有效」「接口可用」均未证。
