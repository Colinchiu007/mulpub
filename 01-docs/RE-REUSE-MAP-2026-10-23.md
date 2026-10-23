# 逆向成果复用对照表（2026-10-23）

> 目的：把 **本机逆向工程目录** 里**可直接落地**的结论抽成一张表，避免再次出现「凭我们自己的代码猜方向」。
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
> ✅ **2026-10-23 更正（撤销此前的错误结论）**：上表主机**有效**。
>
> 此前曾据一次直连探测判定「三个主机全 404 / 已失效」，**该结论作废**：那次探测**未携带**
> `Authorization`（Step-1 下发的 authKey）与 `X-Arguments` 头，服务器返回 404 / `Parse Error` 属**探测方法无效**。
>
> **反证（竞品代码原文）**：`00-vendor-originals/refproduct/main-dist-index.cjs`：
> ```js
> $http.put("https://finderassistancea.video.qq.com/applyuploaddfs", K, { headers: W })
> // W["X-Arguments"] = apptype=251&filetype=…&weixinnum=…&filekey=…&filesize=…&taskid=…&scene=2
> ```
> 其 `X-Arguments` 与本项目 `buildXArguments` 逐字一致 ⇒ 主机与鉴权头配套使用即可。
>
> 落地：PR #4309（`tv-host-final`）把 apply/complete 指回 `finderassistancea`、part 指向 `finderassistanced`。
>
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

## 6. 逆向材料的覆盖边界（2026-10-23 实测）

能答：

| 问题 | 出处 |
| --- | --- |
| 某平台该走 API 还是 DOM/RPA | `derived/平台能力矩阵.md` L34–44 |
| 视频号三段式上传的三步主机 | `融媒宝-完整拆解.md` §5.8 |
| 视频号签名是否走第三方 | `两边竞品风控方式对照.md` L170 |
| 头条签名由谁完成 | `竞品分析报告.md` L642（`hostSdkAdapter` / `pageSubmitAdapter`，均属**签名层**） |
| 各平台内部枚举 id | `融媒宝-平台配置拆解-top10.md` |

不能答（本次已逐项检索，确认缺位）：

| 问题 | 检索关键词 | 结论 |
| --- | --- | --- |
| 视频号**发布**接口（post_create / post_draft） | `post_create` / `post_draft` / `publishdfs` / `cgi-bin` | 未记载 ⇒ 以本项目 `shipinhao-video.js` 与真机为准 |
| 头条 **DOM 发布流程**（按钮文案、表单步骤） | `toutiao` + `DOM/选择器/点击/提交` | 仅有发布档与签名层，**无流程细节** |
**2026-10-23 补充：三个来源逐一查证（头条 DOM 发布流程）**

| 来源 | 检索 | 结果 |
| --- | --- | --- |
| `01-analysis/*.md` | `toutiao` + DOM/选择器/点击/提交 | ❌ 只有发布档与签名层 |
| `00-vendor-originals/wemedia/Asset-sign2/chuangzuozhe.js`（3.4MB 注入脚本） | `预览并发布` / `toutiao` / `发表` | ❌ **0 命中** |
| `00-vendor-originals/refproduct/main-dist-index.cjs`（8.2MB 主包） | 同上 | ❌ 仅平台枚举与**作品列表读取**（`docId` / `getShortContentListAsync`），无发布流程 |

⇒ 结论：**头条发布 DOM 流程在逆向成果中确实不存在**。不要再检索，直接以本项目实现 + 真机为准。
| 头条视频封面流程 | `头条` + `封面/cover` | 未记载 |

**使用建议**：遇到上表「不能答」的三类问题，不要继续在逆向目录里翻，直接以**真机日志 + 本项目实现**为准，并把结论回写到本文件。
