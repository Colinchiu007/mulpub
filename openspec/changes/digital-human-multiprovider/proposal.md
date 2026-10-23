# Proposal: digital-human-multiprovider（数字人 provider 多供应商化 + 接入飞影 HiFly）

## Why

`avatar-spokesperson` 数字人流水线此前只支持 HeyGen 一家，且 provider 名在**两处硬编码**：

- `apps/desktop/electron/services/digital-human-stages.js:34` — `const DIGITAL_HUMAN_PROVIDER = 'heygen'`
- `apps/desktop/electron/services/pipeline-model-preflight.js:32` — 同一常量**又写一遍**（注释已说明要同步，但无机械约束）

后果：① 用户无法在设置里切换数字人服务商；② 两家 provider 的克隆形象会**串库**（registry 键不含 providerId）；③ 新增第三家要改三处以上。

本 change 做两件事：**去硬编码**（provider 能力化）+ **接入飞影 HiFly** 作为第二家。

## 已查证的飞影 API 事实

> ⚠ 官方文档站 `api.hifly.cc` / `api.lingverse.co` 在本机 DNS 解析到非公网 IP，无法直取。
> 以下事实来自官方文档搜索结果摘录 + 官方 skill 源码常量 + Apifox 镜像的 OpenAPI 导出，**属方向性证据**；
> 具体字段名与响应形状**必须在首跑时核对**（tasks.md T10）。

| 项 | 事实 | 来源 |
|---|---|---|
| Base URL | `https://hfw-api.hifly.cc/api/v2/hifly` | 官方 skill 源码常量 |
| 认证 | `Authorization: Bearer ${token}`；token 在个人中心→API 明细获取 | 官方文档「通用」 |
| 错误模型 | token 失败返回 401；**其他业务异常返回 200，须靠响应体 `code` 判错** | 官方文档「通用」 |
| 形象列表 | `GET /api/v2/hifly/avatar/list`，query `page`/`size`/`kind` | Apifox OpenAPI |
| 音色列表 | `GET /api/v2/hifly/voice/list`，query `page`/`size`/`kind`（均必填） | Apifox OpenAPI |
| 视频生成（文本驱动） | `POST /api/v2/hifly/video/create_by_tts`，body `{title, text, voice, avatar}` | Apifox OpenAPI |
| 任务查询 | `GET /api/v2/hifly/video/task`，query `task_id` | Apifox OpenAPI |
| 账户积分 | `GET /api/v2/hifly/account/credit` | Apifox OpenAPI |
| 形象克隆（视频） | `POST /api/v2/hifly/avatar/create_by_video` | 官方文档摘录 |
| 形象克隆（照片） | `POST /api/v2/hifly/avatar/create_by_photo` | 官方文档「Photo to Avatar」类目 |
| 声音克隆 | `POST /api/v2/hifly/voice/clone`，`title` ≤20 字符，API 创建上限 200 个 | 官方文档「Create Voice」 |
| 视频形态 | 支持 talking photo / 公共形象 + TTS / 克隆声音 | 官方 skill README |

与 HeyGen 的关键差异（决定 adapter 不能照抄）：

| 维度 | HeyGen | 飞影 HiFly |
|---|---|---|
| 认证头 | `X-Api-Key` | `Authorization: Bearer` |
| 视频生成字段 | `video_inputs[0].character/voice`（对象） | 顶层 `avatar` / `voice` / `text`（扁平） |
| 状态查询 | `/v1/video_status.get?video_id=` | `/api/v2/hifly/video/task?task_id=` |
| 形象/音色 id | `avatar_id` / `voice_id` | `avatar` / `voice` |
| 列表分页 | 无（全量） | `page`/`size`/`kind` |
| 免费档 | 有 | demo token 有水印 + 30s 限制 |

## What Changes

### ADDED Capabilities

- `digital-human-provider-capability`：数字人 provider 的能力发现契约——provider 通过 `capabilities` 声明 `digital_human`，前端与服务端都按能力而非硬编码名称解析。
- `hifly-adapter`：飞影数字人 adapter，实现与 HeyGen **同名同参**的接口（`generateVideo`/`getVideoStatus`/`listAvatars`/`listVoices`/`createAvatar`/`getAvatarStatus`/`deleteAvatar`/`cloneVoice`/`deleteVoice`）。

### MODIFIED Requirements

- `avatar-voice-clone`：registry 键与样本目录补 `providerId` 段，两家克隆产物不再串库。
- `avatar-spokesperson`：preflight 的数字人 provider 解析从常量改为能力解析。

## 设计决策

| # | 决策 | 理由 |
|---|---|---|
| Q1 | **provider 能力化而非新建 category** | 仓内已有 `capabilities` 机制（`minimax-multimodal` 在用）。新建 `digital_human` category 会牵动 model-provider 全链路；加 capability 只改解析处 |
| Q2 | **两处常量合成一个解析函数** | `resolveDigitalHumanProvider` 已存在且支持 `params.videoProvider` 覆盖，扩展成「覆盖 > capability 查找 > 唯一数字人 provider」三級，preflight 复用同一函数 |
| Q3 | **克隆 registry 键补 providerId** | `avatar-clones:v1:<ownerHash>` → `avatar-clones:v1:<providerId>:<ownerHash>`；样本目录同步。**老数据不迁移**（旧键自然失效，用户重新克隆） |
| Q4 | **adapter 接口与 HeyGen 同名同参** | `digital-human-stages.js` 已按 `{character,voice,script}` 调用，adapter 内部做字段映射（飞影是扁平 `avatar`/`voice`/`text`）。上层零改动 |
| Q5 | **形象克隆类型映射** | 飞影 `create_by_photo`/`create_by_video` 对应现有 `type: 'photo'/'digital_twin'`，adapter 内部映射，service/IPC/UI 零改动 |
| Q6 | **不引入「provider 自动降级」** | 一家失败不自动切另一家（配额/账号/合规都不同），只做明确失败 + 提示用户去设置切换 |
| Q7 | **列表分页在 adapter 内消化** | 飞影要求 page/size/kind 必填，adapter 内部固定 `size=100` 并翻完，对上层仍返回全量数组 |

### 前端切换交互

数字人配置区新增 **provider 下拉**（「数字人服务商」）：

| 状态 | 表现 |
|---|---|
| 只配了一家 | 下拉仅一项，选中态可见（不隐藏，让用户知道有这个概念） |
| 配了多家 | 可切换；切换后**立即** invalidate 目录缓存并重拉形象/音色/克隆列表 |
| 一家都没配 | 整区替换为「前往配置」引导（现状保持） |
| 切换后已选形象失效 | 清空 `avatarId`/`avatarVoiceId` 并常驻提示「请重新选择数字人形象」 |

## Impact

- **主进程**：`digital-human-stages.js`、`pipeline-model-preflight.js`（去硬编码）；`avatar-clone-registry.js`、`avatar-clone-storage.js`（键补 providerId）；新增 `adapters/hifly.js`；`_base/base.js` 的 `KNOWN_METHODS` 补登记；`model-provider-seeds.js` 两家都加 `capabilities: ['video','digital_human']`。
- **IPC**：`avatar-catalog` 三通道入参已含 `providerId`，无需改；`avatar-clone` 五通道需透传 providerId（或由主进程按当前选中 provider 解析——**选后者**，前端少传一个参数）。
- **前端**：`CreateView.vue` 数字人配置区加 provider 下拉；`useAvatarCatalog` / `useAvatarClone` 支持 provider 维度缓存；locales zh/en 成对新增约 12 键。
- **文档**：PRD、user-manual、i18n-glossary。

## 验证边界（如实声明）

- **无飞影真实 Token**：`DEFAULT_TOKEN` 是官方 skill 的 demo token（30s 限制 + 水印），仅可用于冒烟不能用于交付验证。真实 Token 需用户提供。
- **官方文档未逐字核对**：字段名来自 Apifox 镜像与官方 skill 常量，首跑必须逐字段核对（tasks.md T10）。
- **HeyGen 零回归**：既有 242 例必须全绿。
