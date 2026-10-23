# 飞影 HiFly 首跑验证记录（真实 Token，2026-10-24）

Token：用户提供（`RXeJq26qiUaweJmZ`），premium 会员。
**积分纪律**：全程只用 1 条视频、最短文本。消耗 1596 → 1582（**14 分**），成片时长 **2 秒**。

## 一、免费接口核对（0 消耗）

| 接口 | 结果 | 结论 |
|---|---|---|
| `GET /account/credit` | `{ code:0, left:1596, membership_level:100, plan:"premium" }` | 字段与我实现一致 |
| `POST /tool/create_upload_url` | 未调（避免占用 file_id） | — |
| `GET /avatar/list?kind=1` | **2 条自己的形象** | ✅ |
| `GET /avatar/list?kind=2` | 20 条公共形象 | ✅ |
| `GET /voice/list?kind=0` | **0 条** | ⚠️ 见缺陷 2 |
| `GET /voice/list?kind=1` | **0 条**（未克隆过音色） | ⚠️ 见缺陷 2 |
| `GET /voice/list?kind=2` | 20 条/页，**共 109 条** | ✅ 翻页真实生效 |
| `GET /video/task?task_id=<假>` | 抛 `PROVIDER_ERROR: 操作失败` | ✅ 错误模型正确 |

## 二、真实响应形态（推翻 3 处此前的实现）

| 项 | 此前的实现（基于镜像推断） | 真实响应 | 影响 |
|---|---|---|---|
| `total` 字段 | 依赖 `data.total` 判翻页 | **不存在**——`data` 直接是数组 | 🔴 **翻页提前终止**，109 条只会拿到 100 条，丢 9 条 |
| 形象封面字段 | `preview_url` | **`cover_url`** | 🟠 形象无封面图 |
| 音色标识字段 | `voice_id` / `id` | **`voice`** | 🟠 音色 id 取空 ⇒ 整条丢弃 |
| 音色 kind | 硬编码 `'1'` | `1` = 自己的（0 条）、`2` = 公共（109 条） | 🔴 **用户连一个音色都选不了** |
| 音色名称字段 | `name` | **`title`** | 🟠 音色名为 id |

五处全部已修，并有测试锁定（`hifly.test.js` 38 例）。

## 三、视频生成首跑（1 条，最短）

```
POST /video/create_by_tts
{ avatar: 'qPUzZkrRdCqn_EoiGAj0Ng',   // 自己的第一个形象
  voice:  'BMB1UhRK-SPvfSrXcct1PA',   // 公共音色（普通话 女声）
  text:   '你好，这是测试。',
  title:  '首跑验证-最短' }
→ { code: 0, task_id: '1oP32ZoTsY4GqJBKf1N8SQ' }
```

轮询（10s 间隔）：

```
GET /video/task?task_id=1oP32ZoTsY4GqJBKf1N8SQ
→ { code: 0, status: 3, video_Url: 'https://hfcdn.lingverse.co/.../c4a725a5-....mp4', duration: 2 }
```

| 核对项 | 结果 |
|---|---|
| `taskId` 取自 `task_id` | ✅ |
| `status: 3` → `completed` | ✅ |
| `video_Url`（大写 U）→ `videoUrl` | ✅ 字段名确属文档原样，不是笔误 |
| `duration`（秒） | ✅ 2 秒 |
| 成片可下载 | ✅ 3,179,365 bytes MP4 |
| adapter 直接可用（非手写脚本） | ✅ 用仓库 `HiFlyAdapter` 打的 |

## 四、仍未验证的（需要额外素材，暂不动积分）

| 项 | 原因 |
|---|---|
| `create_by_image` / `create_by_video`（形象克隆） | 需要先上传素材换 `file_id`；且会消耗积分。用户要求「测试一两条即可」，未做 |
| `voice/create`（声音克隆） | 同上，且需要 mp3/m4a/wav 素材 |
| `deleteAvatar` / `deleteVoice` | 无己方可删资源（自己的 2 个形象是历史遗留，不是本次创建） |
| 字幕 `st_*` 9 字段 | 字段名来自官方文档，真实响应未核对；下发不额外计费但会多一次生成 |

## 五、结论

**飞影 adapter 的核心链路（认证 / 形象列表 / 音色列表 / 视频生成 / 状态轮询 / 成片下载）已用真实 Token 跑通。**

首暴露出 5 处契约偏差全部已修。剩余未验证项均需额外素材或积分，已在 `tasks.md` 登记为首跑 checklist 的后续项。
