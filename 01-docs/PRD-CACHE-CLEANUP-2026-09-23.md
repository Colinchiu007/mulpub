# PRD：设置-通用「缓存清理」功能

- 版本：v1.0
- 日期：2026-09-23
- 关联模块：`apps/desktop`（Electron 主进程 + preload + Vue renderer）
- 状态：已实现，待 Review / CI

## 1. 背景与调研结论

本 PRD 起因于三个调研问题，结论如下（均经代码溯源核实）。

### 1.1 问题一：删除历史记录是否会同时删除成品视频与临时片段？

**结论：会删除「成品持久化副本」，但不会删除系统临时目录里的合成中间产物。**

- 历史记录删除链路：renderer `requestHistoryDeletion` → IPC `story2video:delete-project` → `Story2VideoProjectService.deleteProject(projectId)`。
- `deleteProject` 做两件事：① 从项目索引（store 键 `story2video_projects_v1`）移除条目；② 递归删除项目目录 `userData/story2video-projects/<ownerHash>/<projectId>`。
- 该目录内含合成完成后**持久化**的成品：`video.mp4`、`narration`、`bgm`、分段 `segment_*`、`project.json` 等（由 `_persistComposeArtifacts` 用 `copyFileAtomic` 从临时目录复制而来）。所以删除历史记录确实会删掉这份成品。
- **尽力而为**：Windows 下文件被占用（EPERM）时，索引仍删除成功，孤立目录残留并写告警日志；不阻断删除。
- **不清理的部分**：合成引擎在 `os.tmpdir()/story2video` 下的会话目录与成片副本（`sessionId_output.mp4` 等）**不在项目目录内**，删除历史记录不会触碰它们。

### 1.2 问题二：视频合成产生哪些临时文件、如何处理、是否永久保存？

**结论：临时文件全部在系统临时目录，非永久保存，有多重自动清理；但残留副本会累积，需手动回收入口。**

`Story2VideoComposeEngine` 的 `outputDir = os.tmpdir()/story2video`，产物分两类：

1. **会话目录 `sessionDir`（合成中）**：`seg_0000.mp4` 分段、`output.mp4` 拼接成片、旁白、水印、`bgm_mixed`、webm 透明视频等。
   - 每次合成结束（成功或失败）均调用 `_cleanupSession(sessionDir)` 递归删除。
2. **持久化到 `outputDir` 根的成片副本**：`sessionId_output.mp4`、`sessionId_narration.m4a`、`sessionId_segments/segment_0000.mp4`。
   - 启动 / 合成前调用 `_cleanupOldSessions(maxSessionAgeMs=24h)` 清理超过 24 小时的 `s2v_*` 目录。
   - 这份副本是「缓存」主体：删除历史记录不清理它，24h 后才被老化清理，期间持续占用磁盘。

其他相关临时目录（同属可清理缓存）：

- `os.tmpdir()/story2video/selected-media`：导入媒体，`gcImportedMedia()` 7 天老化回收。
- `os.tmpdir()/story2video/inputs/<runId>`：运行输入，`cleanupRunInputDir(runId)` 收尾删除。
- `os.tmpdir()/film-engineering/<runId>`：影视工程 run 产物（`shot_NNN.mp4`/`final.mp4`）。

### 1.3 问题三：是否有必要新增「清理缓存」并显示大小？

**结论：有必要。** 理由：

- 上述成片副本与会话残留会随使用累积（单次合成可达数百 MB～GB），仅靠 24h/7 天老化不足以即时释放空间。
- 用户删除历史后，磁盘上仍留有临时副本，缺少即时回收入口，易造成「删了却没释放空间」的困惑。
- 现有「设置-通用」已有同构的「日志清理」（LogsSettings.vue + `logs:info`/`logs:clear`），复用其模式新增「缓存清理」成本低、体验一致。

## 2. 功能范围

### P0（本迭代）

- 设置-通用页新增「缓存清理」卡片：
  - 显示缓存总占用大小、缓存文件数。
  - 分类显示「视频合成缓存」「影视工程缓存」各自占用大小。
  - 「刷新」按钮重新计算大小。
  - 「清理缓存」按钮清空临时缓存并提示释放量。
- 主进程 IPC：`cache:stats`（只读统计）、`cache:clear`（清理）。
- 安全边界：仅清理 `os.tmpdir()` 下的合成/影视工程临时目录，**绝不触碰** `userData` 持久项目与素材库。

### 非目标（P2）

- 不做「按项目选择性清理」；不提供自动清理策略配置（沿用既有 24h/7d 老化）。
- 不清理 Electron 自身 HTTP 缓存 / GPU 缓存（属另一类，本功能聚焦媒体生成临时产物）。

## 3. 详细规格

### 3.1 数据与目录

| 缓存项 key | 目录 | 说明 |
| --- | --- | --- |
| `story2video` | `os.tmpdir()/story2video` | 合成会话目录、成片副本、selected-media、inputs |
| `filmEngineering` | `os.tmpdir()/film-engineering` | 影视工程 run 产物 |

统计口径：递归遍历目录内**普通文件**字节数求和；跳过符号链接（防越界/环）；单个文件 stat 失败忽略不计。

### 3.2 主进程逻辑（services/cache-service.js）

- `getCacheRoots(overrides?)`：返回两个缓存根；`overrides` 供测试注入真实临时目录。
- `computeDirSize(dir)`：`{ totalBytes, fileCount }`，栈式遍历，逐条 `isPathWithin(entry, [dir])` 校验，`lstat` 判类型跳过 symlink。
- `getCacheStats()`：`{ totalBytes, fileCount, items:[{key,label,dir,totalBytes,fileCount}] }`。
- `clearCache()`：逐缓存根遍历顶层条目，`isPathWithin` 校验后先算 `entrySize` 再 `fs.rmSync(...,{recursive,force})`；删除失败（EBUSY/EPERM 被占用）静默跳过、不计入释放量、不阻塞其余。保留根目录本身。返回 `{ freedBytes, removedFiles, removedDirs, items }`。
- 复用 `story2video-paths.js` 的 `isPathWithin`（canonicalPath + realpathSync.native 防符号链接越界）。

### 3.3 IPC 契约（ipc-handlers/cache.js）

| 通道 | 入参 | 返回 | 权限 |
| --- | --- | --- | --- |
| `cache:stats` | 无 | `{ code:0, data:<getCacheStats> }`；异常 `{ code:EC.REQUEST_ERROR, message }` | public（未登录可用，设备本地操作） |
| `cache:clear` | 无 | `{ code:0, data:<clearCache> }`；异常同上 | public |

- `cache:clear` 成功后写 `log.info('Cache', '用户手动清理缓存', {freedBytes,removedFiles,removedDirs})`。
- 权限登记：`license-access-control.js` PUBLIC 列表加入 `cache:stats`/`cache:clear`；preload `access-control.js` PUBLIC_METHODS 加入 `cacheGetStats`/`cacheClear`。

### 3.4 preload / renderer API

- preload `system.js`：`cacheGetStats: () => invoke('cache:stats')`，`cacheClear: () => invoke('cache:clear')`；重新生成 `index.bundle.js` 与 `home-shell-preload.bundle.js`。
- `src/api/publisher.js`：`cacheGetStats()`/`cacheClear()` 经 `invokeWithFallback` 封装，降级返回 `{code:-1,data:{...空}}`。

### 3.5 交互逻辑（LogsSettings.vue，设置-通用页）

- 进入页面 `onMounted` 并行调用 `loadInfo()`（日志）与 `loadCache()`（缓存）。
- 「刷新」：`cacheLoading=true` → `cacheGetStats` → 回填 `cacheInfo`；按钮在加载中禁用。
- 「清理缓存」：`cacheClearing=true` → `cacheClear` → 成功后 `loadCache()` 重算 → 展示成功 toast「已释放 {size} 缓存」；失败展示「清理缓存失败，请稍后重试」；无缓存时按钮禁用（`!cacheInfo.totalBytes`）。

### 3.6 显示项

- 标题「缓存清理」+ 副标题（缓存来源说明）。
- 提示条（info）：「清理仅删除临时缓存，不会影响历史记录中已保存的成品视频与素材库。」
- 摘要：缓存总大小（`formatBytes`）、缓存文件数。
- 明细列表：视频合成缓存 / 影视工程缓存 各自大小（`formatBytes`），行 title 显示绝对路径。
- 加载态：骨架屏；空态：「暂无缓存文件」。

### 3.7 提示文字（i18n，zh/en 成对）

`settings.cache.{title,subtitle,dirLabel,totalSize,fileCount,clearBtn,clearing,empty,autoClearHint,clearedToast,clearFailedToast,itemStory2Video,itemFilmEngineering}`。`clearedToast` 使用 `{size}` 插值。

## 4. 数据校验与边界

- 大小格式化 `formatBytes`：非有限或 ≤0 显示 `0 B`；1024 进制，B 取整、KB/MB/GB 两位小数。
- 返回体字段缺失时前端一律回退默认值（`|| 0` / `Array.isArray`）。
- 目录不存在：统计为 0，不抛错。
- 并发安全：`clearCache` 与后台合成可能同时操作临时目录——删除按条目 best-effort，被占用条目跳过，不影响应用稳定性；文案建议「无合成任务运行时清理」为后续优化项。
- 越界防护：任何删除路径必须 `isPathWithin(entry,[root])`，root 只能是登记的 `os.tmpdir()` 子目录，杜绝删除 userData 或任意磁盘路径。

## 5. 验收标准

1. 设置-通用页出现「缓存清理」卡片，显示总大小、文件数、两类缓存明细。
2. 无缓存时明细显示空态、清理按钮禁用。
3. 点击「刷新」重新计算并回填。
4. 点击「清理缓存」后临时目录内容被清空（保留根目录），提示释放大小，明细归零。
5. 历史记录中的成品视频与素材库不受清理影响（`userData` 不在缓存根内）。
6. 后端单测（cache-service、cache IPC）通过；preload 契约测试通过；renderer 构建通过；zh/en locale 成对。

## 6. 测试

- `electron/services/cache-service.test.js`：roots 边界、递归统计、目录缺失、清理保留根、清理后归零、符号链接越界跳过（真实临时目录注入）。
- `electron/ipc-handlers/cache.test.js`：通道注册、stats/clear 转发、错误码、日志记录（cacheService 经 deps 注入 mock，绝不触碰真实临时目录）。
- 回归：`preload.test.js`（system 方法数 147、api 总数 319、PUBLIC_METHODS→主进程通道 public 一致性）、`build-preload.test.js`、`home-shell-preload.test.js`、locale-sync `--keys`。
