---
record: digital-human-multiprovider
task: 数字人 provider 多供应商化（去硬编码 + 接入飞影 HiFly）
date: 2026-10-23
---

## 本次执行记录：数字人 provider 多供应商化（digital-human-multiprovider）

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `mp-digital-human-multiprovider`（D 盘），分支 `digital-human-multiprovider` |
| 需求与方案 | ✅ | 提案 `openspec/changes/digital-human-multiprovider/proposal.md` + `tasks.md`；先查证飞影官方契约再动手 |
| TDD | ✅ | 新增 3 个测试文件 46 例（provider 解析 11 + hifly adapter 33 + provider 隔离 4 + 前端切换 2）；hifly 契约锁先 RED（10 例失败）后 GREEN |
| 回归零破坏 | ✅ | 17 个相关测试文件 **333/333** 全绿（含 heygen 48 例、既有克隆 38 例、preflight 47 例） |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 超大文件 | ✅ | `check-max-lines.js` 无新增（hifly 600 → 370+264；service 537 → 481，拆出 lock/helpers 两个 mixin） |
| 债务基线 | ✅ 经人工授权 | `modelProviderRequireFanOut` 65 → 66，**经用户明确授权**（理由见下） |
| locale 成对 | ✅ | zh/en 各 +6 键；`--keys` PASS（2236）、`--cjk` PASS（1125，无新增硬编码） |
| 同型风险锁 | ✅ | `same-type-risk-locks-r3.test.js` 18/0（修掉一处自建 mime 映射表） |
| 字号阶梯 | ✅ | `check-font-size-scale.js` PASS |
| 品牌残留 | ✅ | `check-no-brand-residue.js` PASS |
| QM-1 打包 | ✅ | `vite build` exit 0；asar 含 hifly / hifly-clone 两个新模块 |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导；本行不手写状态词 |

## 一、动手前查证：飞影官方契约

用户提供官方文档本地版
（`<用户本地官方文档副本：飞影数字人 API V2 技术文档.md>`，1814 行）。
**这份文档推翻了我此前基于第三方镜像的 5 个假设**，逐条修正：

| 项 | 镜像推断（错） | 官方文档（对） |
|---|---|---|
| 状态字段 | `status` 字符串 + `video_url` | `status` **整数**（1等待/2处理中/3完成/4失败）+ `video_Url`（大写 U）+ `duration` |
| 形象克隆端点 | `create_by_photo` / `create_by_video` | `create_by_image` / `create_by_video` |
| 声音克隆 | `voice/clone` | `voice/create`，`voice_type` 必填且目前只支持 8 |
| 素材上传 | 直接传 Blob | **两步**：`tool/create_upload_url` 换 `file_id` → PUT 上传 |
| 形象列表 kind | `kind=2` | `0`=全部 / `1`=自己的 / `2`=公共（不传默认 2）⇒ 必须传 **1** |

若没拿到文档就照镜像实现，`getVideoStatus` 会**永远返回 processing**（字符串
`'completed'` 映射不到整数键），用户看到的是「一直转圈但永不完成」。

## 二、改动清单

### 第一步：provider 能力化（去硬编码）

| 文件 | 改动 |
|---|---|
| `electron/services/digital-human-provider.js` | **新增**。`resolveDigitalHumanProviderId` / `listDigitalHumanProviders` / `DIGITAL_HUMAN_CAPABILITY`，优先级「显式覆盖 > 唯一命中 > 模型设置默认 > 排序首家」 |
| `digital-human-stages.js` | `resolveDigitalHumanProvider` 改调能力解析；`DIGITAL_HUMAN_PROVIDER` 降级为兜底常量 |
| `pipeline-model-preflight.js` | 第二处硬编码同样改走能力解析（**两处漂移的根因消除**） |
| `model-provider-seeds.js` | heygen 补 `capabilities:['video','digital_human']`；新增 hifly 种子 |
| `governor-provider-limits.js` + `PRESET_RATE_LIMITS` | 补 hifly（8rpm / 2 并发，与 heygen 同档） |

### 第二步：飞影 adapter

| 文件 | 行数 | 职责 |
|---|---|---|
| `adapters/hifly.js` | 370 | 视频生成 / 状态查询 / 形象音色列表（分页内消化）/ testConnection |
| `adapters/hifly-clone.js` | 264 | 形象克隆 + 声音克隆 + 素材上传两段式 + 克隆任务状态（max-lines 拆出，与 heygen-clone 同型） |

`_base/base.js` 的 `KNOWN_METHODS` 登记 `createAvatar` / `getAvatarStatus` /
`deleteAvatar` / `getVoiceCloneStatus`——不登记的话 `callAdapter` 的 `supports()` 闸门
会永久拦截（#3969 踩过）。

### 第三步：克隆产物 provider 隔离

```
registry 键：avatar-clones:v1:<providerId>:<ownerHash>
样本目录：  userData/avatar-clone-samples/<providerId>/<ownerHash>/<storageId>/
```

| 文件 | 改动 |
|---|---|
| `avatar-clone-registry.js` | 新增纯函数 `buildRegistryKey` / `buildSampleRelativeDir`（**同一套分段规则**，防两处漂移）；`isSafeSampleStorage` 放行 4 段新目录 + 兼容 3 段老目录 |
| `avatar-clone-service.js` | owner 带 `providerId`；`_normalizeRequest` / `normalizeCreateRequest` / `normalizeIdRequest` 透传 |
| `avatar-clone-storage.js` | `persistSample` 改为**只从 `descriptor.relativeDir` 派生路径** |
| `avatar-clone-lock.js` | **新增**。registry 写锁抽出（service 537 → 481） |
| `avatar-clone-helpers.js` | **新增**。工具方法抽出 |

### 第四步：前端服务商切换

- 数字人配置区加「数字人服务商」下拉，只列 `capabilities` 含 `digital_human` 的项
- `switchAvatarProvider`：清空已选形象/音色 → invalidate 目录缓存 → 带新 providerId 重拉三份列表
- `useAvatarClone` 的 load/create/delete 全部透传 providerId

## 三、实现中被测试逼出来的 6 个真缺陷

1. **`isSafeSampleStorage` 与我的目录改动冲突**：它硬要求 3 段目录，我加 provider 段后
   变成 4 段，**所有 registry 写入被拒**（表现为「create compensated: registry write failed」）。
   修正为放行 3/4 段，老数据不迁移但仍可见。
2. **storage 自己拼路径导致幽灵故障**：`persistSample` 里 `root/owner.hash/storageId`
   按 3 段拼，而 registry 记的是 4 段 ⇒ 「registry 写成功但 `existsSync` 为 false」。
   改为只从 `descriptor.relativeDir` 派生。
3. **`_normalizeRequest` 判负导致只读入口全红**：我把「input 必须是 object」写死，
   结果 `listClones()` 无参调用返回 -1，11 例测试红。改为对 undefined/null 回落默认 provider。
4. **`normalizeCreateRequest` / `normalizeIdRequest` 不透传 providerId**：导致
   `createClone({providerId:'hifly'})` 实际写进 heygen 的 registry（provider 隔离失效）。
5. **`switchAvatarProvider` 的 reset 顺序**：`reset()` 递增 requestId，若在发请求**之后**
   调会把新请求判成「过期」而静默丢弃（表现是切换后列表不刷新）。改为先 reset 再发。
6. **`loadAvatarClones` 未透传 providerId**：切换服务商后克隆面板仍显示上一家的形象。

## 四、债务基线抬升说明（modelProviderRequireFanOut 65 → 66）

**触发**：在 `model-provider-manager.js` 注册 `require('./adapters/hifly')`，该文件的
unique require 数净增 1。

**为什么这是功能代价而非债务腐烂**：该指标衡量「manager 的直接依赖数」，
接第二家数字人服务商**必然**多一个 adapter require。若为了不涨指标而改用
注册表/懒加载模式，要把 65 个现有 adapter 的注册方式一起改，风险面远大于此。

**授权**：已向用户明示增量构成与三个选项，用户选择「授权抬到 66，理由写进 PR」。

## 五、遗留（不假装已闭合）

- **真实飞影 Token 首跑未执行**：端点与字段来自用户提供的官方文档本地版，
  但真实 Token 下的响应形状未经核对（尤其 `avatar/list` 的 `kind` 语义与分页 `total`）。
  首跑 checklist 见 `tasks.md` §7.1（6 步：验认证 → 列形象 → 上传素材 → 克隆形象 →
  克隆声音 → 用它生成一条视频）。
- **前端切到飞影后的端到端未验证**：需真实 Token 才能跑通「切到飞影 → 克隆 → 生成视频」全链。
- **声音克隆前端入口未做**：adapter 已就绪且已登记 `KNOWN_METHODS`，但 UI 仍只有
  形象克隆的照片/视频两个入口；上传录音的入口需另行立项。
- **飞影字幕参数未接**：`st_show` 等 9 个字幕字段已在 adapter 契约里预留，UI 未开放。

## CHANGELOG 条目

# feat(video): 数字人支持多服务商切换，并接入飞影 HiFly

- 「数字人口播」流水线新增「数字人服务商」下拉：已配置 HeyGen 与飞影 HiFly 两家时可在两者间切换，切换后自动重拉形象、音色与克隆列表，并清空已选形象/音色（避免误选另一家资源）。只配置了一家时下拉禁用并提示如何去添加。
- 新增飞影 HiFly 数字人 adapter，覆盖视频生成、任务查询、形象/音色列表、形象与声音克隆、素材上传全链路；形象与音色列表的分页在 adapter 内消化，上层仍拿全量数组。
- 克隆形象改为按服务商隔离存放：在 HeyGen 克隆的形象不会出现在飞影的下拉里，反之亦然；切换服务商不影响另一家已创建的克隆形象。
- 修正数字人 provider 的解析方式：此前 provider 名在两处硬编码为 HeyGen，现在统一按 `digital_human` 能力解析，新增第三家只需在种子数据里声明能力并写一个 adapter。
