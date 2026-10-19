# 本次执行记录：小红书草稿落地到产品分区（xhs-draft-persisted，2026-10-19）【docs-only】

- 分支：`xhs-draft-persisted`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：PR #3953（小红书草稿首次取证，已合并 `0dde267606`）、PR #3956（抖音诊断，已合并 `950af9f3b6`）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §13.6 / §13.7 / §13.8（本轮改写）

## 一、本轮把 §13.6 的「未闭合」真的关掉了

上一轮的缺口是：草稿是在**拷贝出的临时 profile** 上造的，用户分区里看不到。
本轮用「三步验证法」闭环，**草稿已真正落在产品使用的 RPA 分区**：

| 阶段 | 动作 | 读数 |
| --- | --- | --- |
| 1 | 从真实分区 seed 临时 profile（`Network/Cookies` → `Default/Network/Cookies`，`shared-user-data/Local State` → 临时 profile 根）；上传视频 → 点「暂存离开」 | 起始 `草稿箱(0)` → 点击后 **`草稿箱(1)`** |
| 2 | 把临时 profile 的 `Default/{Local Storage,IndexedDB,Session Storage}` **回写**进真实分区 | 24 文件（5 / 14 / 5） |
| 3 | 从**真实分区**重新 seed 并打开发布页 | **`草稿箱(1)`**（截图取证） |

真实分区落盘证据（`session/Partitions/rpa-xiaohongshu-a1eac276/Default/`）：

| 路径 | 规模 |
| --- | --- |
| `IndexedDB/https_creator.xiaohongshu.com_0.indexeddb.leveldb` + `…indexeddb.blob` | **377.6 KB**（含视频缩略图 blob） |
| `Local Storage/leveldb` | 8.7 KB |
| `Session Storage` | 0.5 KB |

## 二、由此确定的两个实现硬约束（写进 §13.7）

### 2.1 分区目录**缺 `Local State`**

`session/Partitions/<p>/` 下没有 `Local State`（DPAPI 的 `encrypted_key` 在
`shared-user-data/Local State`）。⇒ **不能**把分区直接当 `--user-data-dir` 启动：
cookie 解不开，表现为「跳到登录页、`input[type=file]` 数量为 0」——
**看似未登录、实为解密失败**（上一轮在视频号上踩过这个坑，误判成「会话失效」）。

### 2.2 草稿是浏览器本地对象，物理位置确定

`<profile>/Default/Local Storage` + `<profile>/Default/IndexedDB`。⇒
**RPA 引擎必须让该分区持久化**；任何「临时 profile 跑完就丢」的做法都会让草稿消失。
另外**不要**设计「清 cache 后重试」的兜底 —— 那会把草稿一起删掉。

## 三、本轮的验证手段 ≠ 产品实现（如实标注）

「回写存储」是为了**取证**（证明草稿确实只存在于这两个目录），**不是**建议的产品做法。
产品化应由 RPA 引擎在真实分区上直接跑流程（Plywright `launchPersistentContext(分区路径)` 时
必须同时提供 `Local State`，或由应用以主 user-data-dir 启动）。
这条已写进 §13.8 第 4 条，避免后来者把验证脚本当实现参考。

## 四、仍未闭合（§13.8）

1. **100 篇上限的清理/去重策略**未实现（平台原文：超出后**默认删除最后一篇**，属静默丢失）。
2. 坐标点击需替代为更稳定位（当前「暂存离开」固定 `(683,955)` @1600×1000，换分辨率/缩放即失效）。
3. 草稿**内容完整性**（标题/正文/封面是否逐字存住）未逐项核对 —— 本轮只断言「计数 +1」。
4. 「回写存储」是验证手段，产品化未做（见 §三）。

## 五、性质与读数

- 性质：**docs-only**（只改 `01-docs/PRD-…md` 与本记录，无代码变更）
- 门禁：品牌残留 / 绝对路径 / 编码 / 记录债务（见 §六）
- 取证产物：`<TEMP>/xhs-persist-<ts>/`（含 `01-filled.png` / `02-after-save.png` / `03-verify.png` / `04-panel.png`）

## 六、远程同步

| 远程同步 | 由门禁推导 |
