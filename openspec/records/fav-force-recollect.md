---
record: fav-force-recollect
task: 勾「包含已采集（强制重采）」仍无结果：①forceRecollect 未穿透到 L6 内容缓存 ②采集失败被渲染成「完成」③收尾通知无条件报成功
date: 2026-10-18
branch: fav-force-recollect
---

# 执行记录：fav-force-recollect（2026-10-18）

## 0. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | 运行时代码（electron 主进程 + renderer）+ locale + 文档 |
| 隔离方式 | 独立 worktree `<仓库父目录>\mp-worktrees\mp-fav-force-recollect`，裸分支 `fav-force-recollect`，基线 `origin/main` = `436f6745c` |
| 动因 | 用户上一轮按提示勾「包含已采集（强制重采）」重试，仍「全部完成 + 结果区 0 新增」，报「怎么没生效」 |

## 1. 门禁结果

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 独立 worktree，基线 `436f6745c` |
| TDD | PASS | 三处先 RED（后端 3 / 采集器 1 / 渲染层 2+2 failed）→ 全 GREEN；改动面 **132/132**；collection 全集 **16 文件 / 300 用例**全绿 |
| QM-1 打包 + 启动三层判据 | PASS | 改了 `electron/ipc-handlers/zhihu-favlist.js` + `electron/services/url-collector.js` ⇒ 必跑：`build:dir` rc=0 + 8s 存活 + **stderr 0 字节（层③）**；`buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE` 并出声告警 |
| QM-2 代码必检项 | PASS | 无同步 CPU 原语/新全局注册；`forceRefresh` 是纯布尔透传；`reason` ≤200 字符截断、不透传堆栈 |
| i18n 成对与使用性 | PASS | `--keys`（**2105**，较上轮 +3）/ `--pair-base` / `--cjk` / `check-locale-button-name-sync` 四项 PASS；新增 5 个用户可见文案 zh/en 成对 |
| QM-4 视觉回归 | PASS（盲区同前） | 折叠组内文案与提示，像素门禁不覆盖（已登记遗留） |
| eslint（`apps/desktop` 内） | PASS | rc=0 |
| 行尾两口径对账 | PASS | commit 后取证 |
| QM-6 双模型评审 | 见第 4 节 | 按 decider 判定 |
| 文档同步 | PASS | PRD §4.3.8（含合同/显示项/校验/验收）+ BUGFIX 文档 + 本记录 |
| 远程同步 | PASS | PR **#3880** 已 squash 合并，merge SHA `e47e646ea582b1ff6581d87dcc1e057dbef89128`；远端分支已删（ls-remote 0 行）。main push 触发 quality-gate / GUI Tests / Electron CI / autonomous-loop / Build & Release / 债务熔断门禁 / Visual Tests 共 7 个 workflow，回读 **全部 success**（quality-gate / GUI Tests / Visual Tests / Build & Release / 债务熔断门禁 / Electron CI / autonomous-loop）。回填与销账同一次提交（本行 + bullet + 删 `sync_*` 三字段） |

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | QM-1 ✅ | QM-2 ✅ | i18n ✅ | QM-4 ✅ | eslint ✅ | 文档同步 ✅ | 行尾对账 ✅ | 远程同步 PASS

## 2. 三个缺陷（同一现象的三个来源）

1. **forceRecollect 未穿透内容缓存**：只跳过 duplicate 名单，`ContentCache` 仍命中并返回 `{success:true,title:'',content:''}` 空壳 → `isSubstantive` 判失败 → 「勾了没反应」。修：`collect` 支持 `opts.forceRefresh`，批量通道在 `forceRecollect` 时传 `true`。
2. **失败被画成「完成」**：后端 done 只有 code，渲染层无 `ok:false` 分支。修：done 事件带 `reason`（缓存说明 > 采集器 error > 兜底）+ 渲染层最高优先级失败分支。
3. **收尾无条件报成功**：`notifySuccess('collection.collectSuccess')` 不看结果。修：取消/有成功/全失败/全跳过四级分流。

## 3. 教训（写入三套记忆）

- **开关语义穿透铁律**：任何「强制刷新/忽略缓存」开关，必须逐层核对是否穿透到每一处复用点（去重名单 / 内容缓存 / 进程记忆 / 跨会话防线 / 磁盘快照）。只堵一层 = 「勾了没反应」，且与正常执行同形，极难自证。
- **连续两轮同处失守的根因**：上一轮修了「跳过显示成完成」，却没检查同一分支缺 `ok:false`；后端锁也只断言结果计数、不断言 collect 收到的 opts。**「补了 A 分支」要顺手问「这个 if 链还缺哪些状态」**。
- **收尾通知必须按 stats 分级**：无条件的 `notifySuccess` 是把「执行过」冒充「成功」，比明细更醒目。

## 4. QM-6 判定

以 `ccg-review-decider` 实际读数为准。评审焦点预判：`forceRefresh` 是否可能被滥用来绕过反爬节流？答复：`forceRefresh` 只跳过**内容缓存**，限流（interval/weekend-throttle）、熔断、`consumeBudget` 全部保持——从代码位置可见该判断在缓存检查处、在限流与熔断之后。

## 5. 未闭合（不假装闭合）

1. **用户这次的具体失败原因待真机复核**：修复后进度行会写出（缓存命中 / 采集器 error / 内容不可提取）。若为后两者 ⇒ 知乎侧反爬或页面结构变化，需单独定位采集器（超出本轮范围）。
2. **无真机验证**：结论来自代码链路 + 组件级断言。
3. **`ContentCache` 是内存 LRU**（非持久化）：重启后自然失效，「重启仍失败」⇒ 不是缓存问题，以新 reason 为准。
4. **开关语义穿透无机械判据**：本轮靠人工逐层核对。
