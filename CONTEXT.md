# CONTEXT — 领域术语表

本文件只放**术语的规范含义**，不放实现细节、不放规格说明、不放决策理由（决策见 `docs/adr/`，规格见 `openspec/`、`01-docs/PRD*.md`）。

新增或修改术语时，先在此敲定名称，再动代码；同义词一律写进"避免用"栏，避免同一概念在代码里长出第二个名字。

## 账号域

| 术语 | 规范含义 | 避免用 |
| --- | --- | --- |
| **账号元数据** Account metadata | 不含任何登录凭证的公开描述：平台、显示名、平台昵称、平台账号 ID、粉丝数、头像、启用态、登录态、时间戳 | "账号信息"（会同时指代元数据和凭证） |
| **账号凭证** Account credential | 某平台一次有效登录的会话材料全集：cookies、localStorage、indexedDB。本机形态是 `credential-store` 里的 AES-256-GCM 密文 | "cookie"（凭证含非 cookie 部分） |
| **本地账号 ID** local account id | 本机真源 `accounts.json` 的主键，`uuid4` 前 8 位，由本机生成、**不跨设备稳定** | "账号 ID"（歧义） |
| **平台原生标识** platform uid | 平台侧对某个创作者账号的稳定主键（视频号 `finderUser.uniqId`、B站 `mid`、头条 `user.id`、抖音 `uid` 等），由带凭证调用平台 user-info 接口取得 | "platform_account_id"（本仓该字段历史由多条不同可靠性的路径写入，作字段名可用，作概念名会掩盖可靠性差异） |
| **合并键** merge key | 判定"两个设备上的两条记录是同一个账号"所依据的键：`(platform, platform_uid)`。昵称与显示名**永不**参与合并键 | "去重规则"（本仓 `server.py` 另有一套本机添加时的三分支 409 去重，语义不同，不可混称） |
| **云端账号** cloud account | 业务 API 里归属于一个登录身份、按合并键唯一的账号记录（元数据 + 加密凭证 + 可选墓碑） | "远端账号" |
| **账号镜像** account mirror | 云端账号相对本机真源的从属副本关系；镜像**不是**第二真源 | "同步数据" |
| **本机自证** local attestation | 登录态结论只能由**本机的**一次真实检测产生，不接受任何外部（含云端）带来的结论 | "验证"（歧义，凭证校验也常被叫验证） |
| **登录态三态** login status | `active` / `expired` / `unverified`；`unverified` 语义是"本轮无定论"，不是"已失效"。真源改写受单向证据规则约束（见 ADR-0005） | "是否登录" |
| **凭证冲突** credential conflict | 同一合并键下，本机凭证指纹与云端凭证指纹不一致的状态 | "同步失败" |
| **凭证指纹** credential digest | 对凭证内容算的 MD5/SHA-256 摘要，只用于**判断是否变更**，不用于识别账号身份 | "账号唯一标识" |
| **墓碑** tombstone | 一条合并键的"已删除"标记，作用是阻止该账号在后续同步中复活 | "软删除标记"（本仓库的墓碑**不**承担反向删除，见 ADR-0006） |

## 同步动作域

| 术语 | 规范含义 | 避免用 |
| --- | --- | --- |
| **云端** The cloud | 本特性语境下特指**业务 API**（`packages/api-publish-engine`，按登录身份归属、Logto Bearer + `X-Device-Id` 鉴权）。不含本机 python-backend，也不含 ops-center | "后端"（本仓有三套后端 + 一个本机子进程） |
| **一次同步** sync run | 用户点【同步】到过程区出终态之间的一次完整往返批次，全局单实例、可逐条中断恢复上报 | "同步任务"（本仓 `QueryStateTaskScheduler` 已有"任务"语义） |
| **同步摘要** sync digest | 弹窗确认前展示的"云端现有 xx 个账号"及其平台分布 | "预览"（歧义，浏览器预览另有所指） |
| **逐条结果** per-account outcome | 一次同步里每个账号的终态：新增 / 更新 / 已最新 / 跳过（命中墓碑）/ 失败（带原因码） | "进度"（进度是聚合计数，逐条结果是终态） |
| **同步方向** sync direction | 本特性是双向合并：本地→云端镜像（含凭证）、云端→本地恢复（含凭证）。登录态不在双向之列（ADR-0005） | "上传"/"下载"（单一方向词会让人误以为只有一条流） |

## 加密域

| 术语 | 规范含义 | 避免用 |
| --- | --- | --- |
| **信封加密** envelope encryption | 每条凭证用随机数据密钥（DK）以 AES-256-GCM 加密，DK 再由主密钥（MK）加密后与密文同存 | "字段加密" |
| **主密钥** master key (MK) | 保护 DK 的密钥，托管在服务端 KMS 抽象层之后，按登录身份隔离 | "密钥"（本仓另有本机 safeStorage 主密钥，二者不同物） |
| **本机主密钥** local master key | `credential-store` 用的 PBKDF2 派生密钥，由 Electron safeStorage 包裹落盘，**永不上云** | "主密钥"（与上条必须区分） |

## 跨域既有术语（沿用，不重定义）

登录承载视图分区 `persist:auth-*` / `persist:account-*`、唯一真源 `accounts.json`、`owner_subject`（Logto 用户 sub，本机与云端共用同一归属维度）、运营同步（ops-center → 桌面端的配置下发拉取，与账号无关）。
