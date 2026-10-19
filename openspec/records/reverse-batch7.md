---
record: reverse-batch7
task: 竞品逆向第七批 —— 参考产品对照 / 平台画像 / 17van API 面 / sig3 调用图 / MediaTaskMgr 序言取证
date: 2026-10-19
---

## 本次执行记录：竞品逆向第七批（reverse-batch7，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**（5 新增 + 索引），隔离 worktree `mp-reverse-batch7` / 裸分支 `reverse-batch7`；三个子代理并行产出 + 主线两项补完 |
| 第一性原因（QM-5 ①） | ✅ | 三处**自我修正**均有实证：①`/key/map`「密钥分发」推断撤销（只有裸 URL 无调用点）；②参考产品「有本地签名」修正为「远端为主 1.5 平台兜底」（createSign 仅 3 处）；③上批 sig3 复刻预估依据「主脚本 226 条」——本轮发现主脚本只有 3 个 make-closure，重活在 sub2，预估更乐观 |
| 逃逸分析（QM-5 ②） | ✅ | `@223→sub64` 越界首看像取证错误，联立「实测出值 + 若执行必崩被空 catch 吞」才定位为死分支——逃逸点在「看到越界引用就怀疑自己解析错了」而非先怀疑目标代码有死分支 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 调用图边表全树扫描落 JSON；498 端点扫描脚本可重跑；对照证据 43 词全量落 JSON |
| 防止再次发生（QM-5 ⑤） | ✅ | make-closure「本层下标」格式事实写入调用图文档 §1 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致 |
| QM-1/QM-4/QM-6 | N/A | 纯文档；docs-only 快速通道 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导 |

### 本批实测数字
| 项 | 读数 |
|---|---|
| 参考产品风控词扫描 | 43 关键词，页面签名函数 9 个全 0 命中；createSign 仅 3 处 |
| 17van API 面 | 498 端点记录 / 244 唯一 path / 10 host；interface 135 |
| 平台画像 | 10 平台；platform-profiles.json 53KB |
| sig3 调用图 | make-closure 边表：主脚本 3 个闭包（sub8×2/sub2）+ 1 个死分支越界（sub64） |
| MediaTaskMgr | 7 业务 C API 序言级全判读（单例/回调槽/状态机守卫）；Ghidra 仍超时 |

### 遗留
1. sig3 逐字节复刻（sub2 阅读为主，oracle 已就绪）。
2. MediaTaskMgr 深反编译（Ghidra 超时 + batch_decompile 参数缺陷）。
3. /key/map、/danger 触发时机、deductCreate 粒度：均未证。
4. 参考产品远端签名服务服务端实现：云上不可静态取。
5. disasm-hxfalcon 通用化升级未落盘（代理未完成，现有版本已够用）。
