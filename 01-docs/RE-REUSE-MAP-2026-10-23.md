# 逆向成果复用对照表（2026-10-23）

> 目的：把 `D:\Data\reverse-two-competitors` 里**可直接落地**的结论抽成一张表，避免再次出现「凭我们自己的代码猜方向」。
> 每条都注明出处文件与行号，便于复核。

## 1. 平台发布档（决定走 API 还是 DOM/RPA）

出处：`01-analysis/derived/平台能力矩阵.md` L34–44

| 平台 | key | 竞品发布档 | 本项目当前 | 结论 |
| --- | --- | --- | --- | --- |
| 抖音 | `douyin` | **API** | RPA/DOM（已达成） | 结果达成，档位不同 |
| 小红书 | `xiaohongshu` | DOM/RPA | RPA（草稿箱已达成） | 一致 |
| **视频号** | `tencent_video` | **API** | API（失败在传输层）→ 回退 RPA | **应修 API 轨** |
| **今日头条** | `toutiao` | **DOM/RPA** | RPA（失败在提交） | **不应切 API** |
| 快手 | `kuaishou` | API | — | — |
| 哔哩哔哩 | `bilibili` | API | — | — |
| 百家号 | `baijiahao` | API | — | — |
| 微信公众号 / 知乎 / 微博 | — | DOM/RPA | — | — |

**推论**：视频号的问题必须用 API 轨解决；把头条视频导向 API 是方向错误（平台自己也回 `竖版视频暂不支持 API 发布`）。

## 2. 视频号三段式上传：三步主机不同

出处：`01-analysis/融媒宝-完整拆解.md` §5.8 对照表

| 步骤 | 竞品原生层主机 |
| --- | --- |
| `applyuploaddfs` | `finderassistancea.video.qq.com` |
| `uploadpartdfs` | **`finderassistanced.video.qq.com`** |
| `completepartuploaddfs` | `finderassistancea.video.qq.com` |

**本项目改前**：三步共用一个 `baseURL` ⇒ 与实证不符。已按此改为分步主机（PR #4299）。

## 3. 视频号签名：纯本地，不走第三方签名

出处：`01-analysis/两边竞品风控方式对照.md` L170

- 竞品视频号链：本地 `createSign("SHA256")`（私信链）+ `QiehaoSm3` 文件哈希（上传校验）。
- 因此 **`signer-assembly` 不认识 `tencent_video` 属正常**，不应把它当作失败原因（该日志为 WARN，流程继续）。

## 4. 平台枚举：头条号与西瓜是两个 id

出处：`01-analysis/融媒宝-平台配置拆解-top10.md` 平台 id 表

| 名称 | id |
| --- | --- |
| 头条号 | 3 |
| 西瓜视频 | 32 |

但竞品「发布档」矩阵**未把西瓜列为发布目标**，因此我们让头条视频走西瓜上传页（`profile_v4/xigua/upload-video`）并不违背逆向结论。

## 5. 使用纪律

1. **动手前先查这张表**，特别是「发布档」一列——它决定修 API 还是修 DOM。
2. 引用时必须带**文件 + 行号**，不允许只写"逆向说过"。
3. 与本项目实现冲突时，先假定**逆向是实测**、我们是推测，除非有真机日志反证。
