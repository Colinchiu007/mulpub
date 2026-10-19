---
record: reverse-findings-batch3
task: 竞品逆向第三批 —— a_bogus 还原 / 百度 verifyToken / 签名调度层注入 JS / 功能面清点 + X-Bogus 判断更正
date: 2026-10-19
---

## 本次执行记录：竞品逆向第三批（reverse-findings-batch3，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**（4 新增 + 2 更正 + 索引），隔离 worktree `mp-reverse-findings-batch3` / 裸分支 `reverse-findings-batch3` |
| 第一性原因（QM-5 ①） | ✅ | 此前「X-Bogus = jsVMP 须搬 VM」是**基于「有 jsvmp 函数」这一表象的推断**，从未实测其输出是否依赖输入。本批实测后否证 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸在「把『文件里有 VM』读成『算法在 VM 里』」，且**从未跑过它的输出**。三层测试（国标向量 / 差分 / 结构判据）才能拦住这类误判 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 仓外新增 2 个测试：`abogus-signature.test.js`(12 例) + `baidu-verify-token.test.js`(10 例)；仓内 2 篇旧文档就地加更正块 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①调度层文档 §5 完整留档三层更正与根因；②`深挖补充报告-第5轮.md` 就地加更正块（含三条证据）；③`融媒宝-完整拆解.md` §4.5.5 标题标注更正 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致；删除行仅「内嵌 jsVMP 字节码」等被替换的表述，无意外删除 |
| 接线棘轮 | N/A | 未新增仓内 `*.test.js`（测试在仓外 `<REA_WORKSPACE>`）|
| QM-1 打包 / QM-4 视觉 | N/A | 纯文档 |
| QM-6 CCG 双模型外部评审 | 未执行 | docs-only 快速通道；**不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导 |

### 本批实测数字（全部可复算）

| 项 | 读数 | 来源 |
|---|---|---|
| `a_bogus` 输出 | **44 字符**，64 字符字母表 | `abogus-signature.cjs` |
| SM3 国标向量 | `"abc"` = `66c7f0f4…8f4ba8e0` ✅<br>`"abcd"×16` = `debe9ff9…9c0c5732` ✅ | 独立于竞品 |
| `a_bogus` 差分 | **112 组全等**（4 URL × 4 data × 7 UA）| 冻结 Date.now/Math.random |
| `a_bogus` 测试 | **12 例全绿** | `node --test` |
| 百度 verifyToken 差分 | 与竞品内嵌 CryptoJS **逐字节一致**（4 token × 5 载荷）| `baidu-verify-token.cjs` |
| 百度 verifyToken 测试 | **10 例全绿**（含 NIST SP 800-38A 向量）| `node --test` |
| exe 注入 JS 提取 | 17,176 段 ASCII → **856 段有信息量** / 12 类 / **7 桥** / 289 URL | `extract-exe-injected-js.cjs` |
| 抖音 ticket-guard | 10 段注入脚本，读 3 个 `security-sdk/*` localStorage 键 | 同上 |
| 登录自动化 | **431 段**（点选 285 / 取账号 93 / 填表 93）| 同上 |
| 功能模块清点 | **21 个**（dist 10 view + 11 目录）；只拆过 2 个 | `extract-dist-view-inventory.cjs` |
| `sign4.js` VM 占比 | 解释器 21,515 字符(**73%**) / VM 字节码仅 **1,120 字节**(7.6%) | 本地实测 |
| `sign4.js` 输入敏感性 | params/data/UA **全部不变**，仅时间戳变 | 冻结时钟逐变实验 |

### 遗留（不假装已闭合）
1. **注入片段如何传给 CEF 未取证**（只看到片段字符串与 `%s` 格式串，未见 `ExecuteJavaScript` 装配点）。
2. **`cssSign` / `gen__NS_sig3` / `ZTSDK` 的实现都属平台页面**，竞品只调用不实现 —— 要还原需抓平台页面。
3. **289 个 URL 未分类**（平台 / 自家后端 / 静态资源）。
4. **全部结论为静态**，未运行竞品、未向任何平台发请求。
5. **`chuangzuozhe.js`（3.4 MB）性质仍未定**（无 webpack chunk 名、无抖音标识）。
