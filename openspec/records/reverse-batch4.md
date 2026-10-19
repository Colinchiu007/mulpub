---
record: reverse-batch4
task: 竞品逆向第四批 —— 快手 sig3/hxfalcon 定性、smart-clip 桥契约、抖音 ticket-guard 契约 + X-Bogus 根因再更正
date: 2026-10-19
---

## 本次执行记录：竞品逆向第四批（reverse-batch4，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**（3 新增 + 1 更正 + 索引），隔离 worktree `mp-reverse-batch4` / 裸分支 `reverse-batch4` |
| 第一性原因（QM-5 ①） | ✅ | 上一批把「X-Bogus 输入无关」的根因写成单一原因；本批实测发现 `paramsarr1` **长度是 16 不是 0** ⇒ 根因须拆成两个独立缺陷（md5 对数组型输入返回常量 + WordArray 传给 hex 解码器） |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸在「只验证了结论（输入无关），没有验证**中间量**就下根因」——第一性原因是中间量观测不足 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 仓外 `probe-kuaishou-sig3.cjs` 把中间量观测固化成可重跑探针；仓内更正块带完整实测数据 |
| 防止再次发生（QM-5 ⑤） | ✅ | `融媒宝-快手sig3与hxfalcon引擎.md` §3 整节记录 harness 方法论坑（宿主内建跨 realm 爆栈 + 空 catch ⇒「返回 undefined」不构成证据）|
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致 |
| 接线棘轮 | N/A | 未新增仓内 `*.test.js`（探针在仓外 `<REA_WORKSPACE>`）|
| QM-1 打包 / QM-4 视觉 | N/A | 纯文档 |
| QM-6 CCG 双模型外部评审 | 未执行 | docs-only 快速通道；不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导 |

### 本批实测数字（全部可复算）

| 项 | 读数 | 来源 |
|---|---|---|
| `chuangzuozhe.js` 归属 | **快手**官方 bundle（`kuaishou`×21、`pack_loads` 自建加载器、抖音/小红书 0 命中）| 逐字取证 |
| `hxfalcon` API | `eval` / `run` / `call` / `createFiber`（+`realm`）| vm 原型链枚举 |
| `realm.global` | 27 键，含 `$encode` 与 `StopIteration` | 同上 |
| `gen__NS_sig3` 输出 | **56 位小写 hex，随输入变化**（3 组互不相同）| `probe-kuaishou-sig3.cjs` |
| smart-clip 接口 | 正向 **31**（同步返回仅 **4**）+ 反向 **14** = 45 | `extract-smart-clip-contract.cjs` |
| 页面 ID | 1=混剪 / 2=作品 / 3=草稿 / 4=一键成片 / 6=红薯模版 | 同上 |
| localStorage 键 | 14 个 | 同上 |
| 空实现回调 | `SetDownloadFontResult`（4 参，空函数体）| 同上 |
| ticket-guard 锚点 | **16/16 命中**（33 段，4.5 KB 区间）| `extract-ticket-guard-contract.cjs` |
| 失败守卫 | **4 处**，出口统一为 `(_account_id,'','','','','','',0)` | 同上 |
| 回调参数 | 8 个，第 4 参 `_ree_public_key` **恒空串**、第 8 参是成败位 | 同上 |
| `X-Bogus` 根因 | **两个独立缺陷**（md5 数组型输入返回常量 `487f7b22…`；WordArray→hex 解码器长度 0）| 干净沙箱实测 |

### 遗留（不假装已闭合）
1. `$encode` 字节码未解（在 `@14736` 混淆字符串表里）。
2. `sig3_data` 与 `x-ware-csrf-token` 的注入上下文未取证。
3. `ZTSDK` / `_ecdh_key_cache` 两级 Map 的键空间未取证（多账号取哪个密钥未证）。
4. `md5cookie` 的「md5」在哪一侧计算未证。
5. 全部为静态结论，未运行竞品、未向任何平台发请求。
